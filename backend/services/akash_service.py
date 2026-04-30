from __future__ import annotations

import asyncio
import secrets
from typing import Optional
from urllib.parse import urlparse

import httpx
import yaml

from models import Resources

CONSOLE_API_BASE = "https://console-api.akash.network"


# ---------------------------------------------------------------------------
# SDL builder (inline — no separate import)
# ---------------------------------------------------------------------------

def _build_jupyter_sdl(resources: Resources, jupyter_token: str) -> str:
    """Build Akash SDL YAML for a Jupyter scipy-notebook server."""

    resource_def: dict = {
        "cpu": {"units": float(resources.cpu)},
        "memory": {"size": resources.memory},
        "storage": [{"size": resources.storage}],
    }

    if resources.gpu > 0:
        resource_def["gpu"] = {
            "units": resources.gpu,
            "attributes": {
                "vendor": {
                    "nvidia": (
                        [{"model": resources.gpu_model}] if resources.gpu_model else []
                    )
                }
            },
        }

    sdl_dict: dict = {
        "version": "2.0",
        "services": {
            "jupyter": {
                "image": "pytorch/pytorch:2.2.2-cuda12.1-cudnn8-devel",
                "env": [
                    f"JUPYTER_TOKEN={jupyter_token}",
                    "JUPYTER_ENABLE_LAB=yes",

                ],
                "command": [
                    "bash",
                    "-c",
                    (
                        f"pip install jupyterlab && "
                        f"jupyter lab "
                        f"--ip=0.0.0.0 --port=8888 --no-browser --allow-root "
                        f"--ServerApp.token={jupyter_token} "
                        f"--MappingKernelManager.cull_idle_timeout=0 "
                        f"--MappingKernelManager.cull_interval=0 "
                        f"--ServerApp.shutdown_no_activity_timeout=0"
                    )
                ],
                "expose": [
                    {
                        "port": 8888,
                        "as": 80,
                        "to": [{"global": True}],
                    }
                ],
            }
        },
        "profiles": {
            "compute": {
                "jupyter": {
                    "resources": resource_def,
                }
            },
            "placement": {
                "akash": {
                    "pricing": {
                        "jupyter": {
                            "denom": "uact",
                            "amount": 10000,
                        }
                    }
                }
            },
        },
        "deployment": {
            "jupyter": {
                "akash": {
                    "profile": "jupyter",
                    "count": 1,
                }
            }
        },
    }

    return yaml.dump(sdl_dict, default_flow_style=False, sort_keys=False)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------

class AkashService:
    """Async service for deploying and managing Jupyter kernels on Akash Network."""

    def __init__(self, base_url: str = CONSOLE_API_BASE, timeout: float = 60.0):
        self._base_url = base_url
        self._timeout = timeout

    def _client(self, api_key: str) -> httpx.AsyncClient:
        return httpx.AsyncClient(
            base_url=self._base_url,
            headers={
                "x-api-key": api_key,
                "Content-Type": "application/json",
            },
            timeout=self._timeout,
        )

    # ------------------------------------------------------------------
    # Deploy
    # ------------------------------------------------------------------

    async def deploy_kernel_server(
        self,
        api_key: str,
        resources: Resources,
        jupyter_token: str,
    ) -> tuple[int, dict]:
        """Deploy a Jupyter server to Akash. Returns (dseq, manifest)."""
        sdl = _build_jupyter_sdl(resources, jupyter_token)
        print("=== SDL ===\n", sdl, "\n==========")
        async with self._client(api_key) as client:
            resp = await client.post(
                "/v1/deployments",
                json={"data": {"sdl": sdl, "deposit": 5}},
            )
            if not resp.is_success:
                raise RuntimeError(f"Deploy failed {resp.status_code}: {resp.text}")
            body = resp.json()
        data = body.get("data", body)
        dseq: int = data["dseq"]
        manifest: dict = data["manifest"]
        return dseq, manifest

    # ------------------------------------------------------------------
    # Bids
    # ------------------------------------------------------------------

    async def wait_for_bids(
        self,
        api_key: str,
        dseq: int,
        timeout: float = 60.0,
        poll_interval: float = 3.0,
    ) -> list[dict]:
        """Poll GET /v1/bids?dseq= until at least one bid arrives."""
        deadline = asyncio.get_event_loop().time() + timeout
        async with self._client(api_key) as client:
            while asyncio.get_event_loop().time() < deadline:
                resp = await client.get("/v1/bids", params={"dseq": dseq})
                resp.raise_for_status()
                body = resp.json()
                bids: list[dict] = body.get("data", body) if isinstance(body, dict) else body
                if len(bids) >= 1:
                    return bids
                await asyncio.sleep(poll_interval)
        raise TimeoutError(f"No bids received for dseq={dseq} within {timeout}s")

    # ------------------------------------------------------------------
    # Lease
    # ------------------------------------------------------------------

    async def accept_cheapest_bid(
        self,
        api_key: str,
        dseq: int,
        bid: dict,
        manifest: dict,
    ) -> dict:
        """POST /v1/leases with the cheapest bid and return the lease dict."""
        async with self._client(api_key) as client:
            payload = {
                "manifest": manifest,
                "leases": [
                    {
                        "dseq": str(dseq),
                        "gseq": bid["gseq"],
                        "oseq": bid["oseq"],
                        "provider": bid["provider"],
                    }
                ],
            }
            print("=== LEASE PAYLOAD (sans manifest) ===", payload["leases"])
            resp = await client.post("/v1/leases", json=payload)
            if resp.is_error:
                print("=== LEASE ERROR BODY ===", resp.text)
            resp.raise_for_status()
            body = resp.json()
            print("=== LEASE RESPONSE ===", body)
            data = body.get("data", body) if isinstance(body, dict) else body
            leases = data.get("leases") if isinstance(data, dict) else None
            return leases[0] if leases else data

    # ------------------------------------------------------------------
    # URL extraction
    # ------------------------------------------------------------------

    async def get_jupyter_url(self, lease: dict) -> Optional[str]:
        """
        Extract the public Jupyter URL from a lease response.

        With as:80 SDL, provider assigns a URI via HTTP router (services.jupyter.uris).
        Falls back to forwarded_ports then ips.
        """
        status = lease.get("status") or {}

        # Primary: URI from provider HTTP router (as: 80 in SDL)
        services: dict = status.get("services", {}) or {}
        jupyter_svc = services.get("jupyter", {}) or {}
        uris = jupyter_svc.get("uris") or []
        if uris:
            uri = uris[0]
            if not uri.startswith("http"):
                uri = f"http://{uri}"
            return uri

        # Fallback: forwarded_ports
        forwarded_ports: dict = status.get("forwarded_ports", {}) or {}
        jupyter_ports = forwarded_ports.get("jupyter") or forwarded_ports.get("8888") or []
        if not jupyter_ports and len(forwarded_ports) == 1:
            jupyter_ports = next(iter(forwarded_ports.values()), [])
        if jupyter_ports:
            port_entry = jupyter_ports[0]
            host = port_entry.get("host") or port_entry.get("externalHost")
            external_port = port_entry.get("externalPort") or port_entry.get("port", 8888)
            if host:
                return f"http://{host}:{external_port}"

        # Fallback: ips
        ips_map: dict = status.get("ips", {}) or {}
        for entries in ips_map.values():
            if entries:
                entry = entries[0]
                host = entry.get("IP") or entry.get("ip")
                port = entry.get("ExternalPort") or entry.get("Port") or 8888
                if host:
                    return f"http://{host}:{port}"

        return None

    # ------------------------------------------------------------------
    # Wait for Jupyter to become ready
    # ------------------------------------------------------------------

    async def wait_for_jupyter_ready(
        self,
        jupyter_url: str,
        token: str,
        timeout: float = 120.0,
        poll_interval: float = 5.0,
    ) -> bool:
        """
        Poll GET {jupyter_url}/api/kernels until HTTP 200.
        Returns True on success, raises TimeoutError on expiry.
        """
        deadline = asyncio.get_event_loop().time() + timeout
        headers = {"Authorization": f"token {token}"}
        async with httpx.AsyncClient(timeout=10.0) as client:
            while asyncio.get_event_loop().time() < deadline:
                try:
                    resp = await client.get(
                        f"{jupyter_url}/api/kernels",
                        headers=headers,
                    )
                    if resp.status_code == 200:
                        return True
                except (httpx.ConnectError, httpx.TimeoutException, httpx.RemoteProtocolError):
                    pass
                await asyncio.sleep(poll_interval)
        raise TimeoutError(
            f"Jupyter at {jupyter_url} did not become ready within {timeout}s"
        )

    # ------------------------------------------------------------------
    # Kernel management
    # ------------------------------------------------------------------

    async def create_kernel(self, jupyter_url: str, token: str) -> str:
        """POST {jupyter_url}/api/kernels and return the kernel_id."""
        headers = {"Authorization": f"token {token}"}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{jupyter_url}/api/kernels",
                headers=headers,
                json={"name": "python3"},
            )
            resp.raise_for_status()
            return resp.json()["id"]

    # ------------------------------------------------------------------
    # Close deployment
    # ------------------------------------------------------------------

    async def close_deployment(self, api_key: str, dseq: int) -> None:
        """DELETE /v1/deployments/{dseq}."""
        async with self._client(api_key) as client:
            resp = await client.delete(f"/v1/deployments/{dseq}")
            # 404 is acceptable — deployment may already be gone
            if resp.status_code not in (200, 204, 404):
                resp.raise_for_status()

    # ------------------------------------------------------------------
    # Full deploy flow
    # ------------------------------------------------------------------

    async def full_deploy(
        self,
        api_key: str,
        resources: Resources,
        progress_cb=None,
    ) -> dict:
        """
        Orchestrate the full Akash deployment flow:
          1. Generate token
          2. Build SDL and create deployment
          3. Wait for bids
          4. Accept cheapest bid, create lease
          5. Extract Jupyter URL from lease
          6. Wait for Jupyter to be ready
          7. Create kernel

        Returns:
            {dseq, jupyter_url, jupyter_token, kernel_id}

        The optional ``progress_cb`` is an async callable that receives a
        plain-text status message at each stage, used to feed SSE events.
        """

        async def _emit(msg: str, step: int | None = None) -> None:
            if progress_cb is not None:
                await progress_cb(msg, step)

        # 1. Generate token
        jupyter_token = secrets.token_hex(16)

        # 2. Create deployment  (step 0)
        await _emit("Creating Akash deployment…", step=0)
        dseq, manifest = await self.deploy_kernel_server(api_key, resources, jupyter_token)
        await _emit(f"Deployment created (dseq={dseq}). Waiting for bids…", step=1)

        # 3. Wait for bids  (step 1)
        bids = await self.wait_for_bids(api_key, dseq, timeout=90.0)
        cheapest_bid = min(
            bids,
            key=lambda b: float(b["bid"]["price"].get("amount", 1e18)),
        )
        cheapest_bid_id = cheapest_bid["bid"]["id"]
        await _emit(
            f"Received {len(bids)} bid(s). Accepting cheapest from {cheapest_bid_id.get('provider', 'unknown')}…",
            step=2,
        )

        # 4. Accept cheapest bid → create lease  (step 2)
        lease = await self.accept_cheapest_bid(api_key, dseq, cheapest_bid_id, manifest)
        await _emit("Lease accepted. Waiting for provider to expose Jupyter port…", step=3)

        # 5. Poll for the Jupyter URL — provider needs a moment to set up port forwarding
        jupyter_url: Optional[str] = None
        for attempt in range(20):
            jupyter_url = await self.get_jupyter_url(lease)
            if jupyter_url:
                break
            await asyncio.sleep(6)
            # Re-fetch lease details in case forwarded_ports arrive later
            try:
                async with self._client(api_key) as client:
                    resp = await client.get(f"/v1/deployments/{dseq}")
                    if resp.status_code == 200:
                        body = resp.json()
                        dep_data = body.get("data", body) if isinstance(body, dict) else body
                        leases_raw = dep_data.get("leases", [])
                        if leases_raw:
                            lease = leases_raw[0]
                            print("=== REFETCH LEASE ===", lease)
            except Exception:
                pass

        if not jupyter_url:
            raise RuntimeError(
                f"Could not determine Jupyter URL from lease for dseq={dseq}"
            )

        await _emit(f"Jupyter available at {jupyter_url}. Waiting for server to start…", step=3)

        # 6. Wait for Jupyter to respond
        await self.wait_for_jupyter_ready(jupyter_url, jupyter_token, timeout=180.0)
        await _emit("Jupyter server is ready. Creating kernel…", step=3)

        # 7. Create kernel  (step 4)
        kernel_id = await self.create_kernel(jupyter_url, jupyter_token)
        await _emit(f"Kernel created (id={kernel_id}). Session is READY.", step=4)

        return {
            "dseq": dseq,
            "jupyter_url": jupyter_url,
            "jupyter_token": jupyter_token,
            "kernel_id": kernel_id,
        }
