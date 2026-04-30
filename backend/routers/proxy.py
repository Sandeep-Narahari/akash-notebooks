from __future__ import annotations

import asyncio
import json
import logging
import uuid
from typing import Optional
from urllib.parse import urlparse

import httpx
import websockets
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from websockets.exceptions import ConnectionClosed, InvalidHandshake

import database as db
from models import SessionStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["proxy"])

# Back-off schedule for upstream reconnect attempts.
# First entry is 0.5s — never 0 — to prevent a rapid reconnect storm where
# each new upstream connection immediately replaces the previous one on Jupyter,
# which closes the old upstream, which triggers another instant reconnect, etc.
_BACKOFF = [0.5, 1.0, 2.0, 4.0, 8.0]


async def _recover_kernel(session_id: str, jupyter_url: str, jupyter_token: str) -> Optional[str]:
    """Create a new Jupyter kernel and persist the new kernel_id in the DB."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{jupyter_url}/api/kernels",
                headers={"Authorization": f"token {jupyter_token}"},
                json={"name": "python3"},
            )
            resp.raise_for_status()
            new_kernel_id: str = resp.json()["id"]
        await db.update_session(session_id, kernel_id=new_kernel_id)
        logger.info("Kernel recovered for session %s → new kernel_id=%s", session_id, new_kernel_id)
        return new_kernel_id
    except Exception as exc:
        logger.warning("Kernel recovery failed for session %s: %s", session_id, exc)
        return None


@router.websocket("/{session_id}/channels")
async def kernel_proxy(
    websocket: WebSocket,
    session_id: str,
    kernel_id: str = Query(...),
    jupyter_session_id: Optional[str] = Query(default=None),
) -> None:
    session = await db.get_session(session_id)

    await websocket.accept()

    if session is None:
        await websocket.close(code=4404, reason="Session not found")
        return
    if session.status != SessionStatus.READY:
        await websocket.close(code=4503, reason=f"Session not ready (status={session.status})")
        return
    if not session.jupyter_url:
        await websocket.close(code=4503, reason="Jupyter URL not available")
        return

    parsed = urlparse(session.jupyter_url)
    ws_scheme = "wss" if parsed.scheme == "https" else "ws"
    # Use the stable session_id from the browser so Jupyter replays buffered
    # messages on reconnect instead of discarding them.
    stable_session = jupyter_session_id or str(uuid.uuid4())

    def _build_upstream_url(kid: str) -> str:
        return (
            f"{ws_scheme}://{parsed.netloc}/api/kernels/{kid}/channels"
            f"?session_id={stable_session}"
        )

    upstream_ws_url = _build_upstream_url(kernel_id)
    extra_headers = {"Authorization": f"token {session.jupyter_token}"}

    browser_disconnected = False
    attempt = 0

    async def _notify_kernel_restarting() -> None:
        """Tell the browser the upstream connection dropped so it can reject pending executions."""
        if browser_disconnected:
            return
        try:
            await websocket.send_text(json.dumps({
                "header": {
                    "msg_type": "status",
                    "msg_id": str(uuid.uuid4()),
                    "session": stable_session,
                    "username": "server",
                    "date": "",
                    "version": "5.3",
                },
                "parent_header": {},
                "metadata": {},
                "content": {"execution_state": "restarting"},
                "channel": "iopub",
                "buffers": [],
            }))
        except Exception:
            pass

    while not browser_disconnected:
        delay = _BACKOFF[min(attempt, len(_BACKOFF) - 1)]
        if delay > 0:
            await asyncio.sleep(delay)
        if browser_disconnected:
            break

        try:
            async with websockets.connect(
                upstream_ws_url,
                additional_headers=extra_headers,
                # Protocol-level pings keep the backend→Jupyter TCP connection
                # alive through Akash provider load-balancers.
                ping_interval=20,
                ping_timeout=20,
            ) as upstream_ws:
                attempt = 0  # reset back-off on successful connect

                async def _browser_to_jupyter() -> None:
                    nonlocal browser_disconnected
                    try:
                        while True:
                            msg = await websocket.receive()
                            if "bytes" in msg and msg["bytes"]:
                                await upstream_ws.send(msg["bytes"])
                            elif "text" in msg and msg["text"]:
                                await upstream_ws.send(msg["text"])
                    except (WebSocketDisconnect, RuntimeError):
                        browser_disconnected = True

                async def _jupyter_to_browser() -> None:
                    try:
                        async for msg in upstream_ws:
                            if isinstance(msg, bytes):
                                await websocket.send_bytes(msg)
                            else:
                                await websocket.send_text(str(msg))
                    except (ConnectionClosed, WebSocketDisconnect, RuntimeError):
                        pass

                tasks = [
                    asyncio.create_task(_browser_to_jupyter()),
                    asyncio.create_task(_jupyter_to_browser()),
                ]
                _done, _pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for t in _pending:
                    t.cancel()
                    try:
                        await t
                    except (asyncio.CancelledError, Exception):
                        pass

                if browser_disconnected:
                    break

                # Upstream closed while browser is still connected — notify browser so
                # any in-flight execute_request can be rejected immediately.
                await _notify_kernel_restarting()
                attempt += 1

        except InvalidHandshake as exc:
            if browser_disconnected:
                break
            # 404 = kernel no longer exists on Jupyter (e.g. server restarted).
            # Auto-recover by creating a fresh kernel and retrying immediately.
            status_code = getattr(getattr(exc, "response", None), "status_code", None)
            if status_code == 404:
                logger.warning(
                    "Kernel %s not found on Jupyter for session %s — recovering…",
                    kernel_id, session_id,
                )
                await _notify_kernel_restarting()
                new_id = await _recover_kernel(
                    session_id, session.jupyter_url, session.jupyter_token
                )
                if new_id:
                    kernel_id = new_id
                    upstream_ws_url = _build_upstream_url(kernel_id)
                    attempt = 0  # retry immediately with new kernel
                    continue
            attempt += 1

        except (ConnectionClosed, OSError, websockets.exceptions.WebSocketException):
            if browser_disconnected:
                break
            await _notify_kernel_restarting()
            attempt += 1

    # Browser disconnected normally — close cleanly.
    try:
        await websocket.close()
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Terminal proxy — no retry (terminals are ephemeral; just bridge until close)
# ---------------------------------------------------------------------------

@router.websocket("/{session_id}/terminal/{term_name}")
async def terminal_proxy(
    websocket: WebSocket,
    session_id: str,
    term_name: str,
) -> None:
    session = await db.get_session(session_id)

    await websocket.accept()

    if session is None:
        await websocket.close(code=4404, reason="Session not found")
        return
    if session.status != SessionStatus.READY:
        await websocket.close(code=4503, reason="Session not ready")
        return
    if not session.jupyter_url:
        await websocket.close(code=4503, reason="Jupyter URL not available")
        return

    parsed = urlparse(session.jupyter_url)
    ws_scheme = "wss" if parsed.scheme == "https" else "ws"
    upstream_url = (
        f"{ws_scheme}://{parsed.netloc}/terminals/websocket/{term_name}"
        f"?token={session.jupyter_token}"
    )

    try:
        async with websockets.connect(upstream_url, ping_interval=20, ping_timeout=20) as upstream_ws:
            async def _b2j() -> None:
                try:
                    while True:
                        msg = await websocket.receive()
                        if "bytes" in msg and msg["bytes"]:
                            await upstream_ws.send(msg["bytes"])
                        elif "text" in msg and msg["text"]:
                            await upstream_ws.send(msg["text"])
                except (WebSocketDisconnect, RuntimeError):
                    pass

            async def _j2b() -> None:
                try:
                    async for msg in upstream_ws:
                        if isinstance(msg, bytes):
                            await websocket.send_bytes(msg)
                        else:
                            await websocket.send_text(str(msg))
                except (ConnectionClosed, WebSocketDisconnect, RuntimeError):
                    pass

            tasks = [
                asyncio.create_task(_b2j()),
                asyncio.create_task(_j2b()),
            ]
            _done, _pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in _pending:
                t.cancel()
                try:
                    await t
                except (asyncio.CancelledError, Exception):
                    pass
    except Exception:
        pass

    try:
        await websocket.close()
    except Exception:
        pass
