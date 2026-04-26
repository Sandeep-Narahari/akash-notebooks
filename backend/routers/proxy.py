from __future__ import annotations

import asyncio
import uuid
from typing import Optional
from urllib.parse import urlparse

import websockets
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect
from websockets.exceptions import ConnectionClosed

import database as db
from models import SessionStatus

router = APIRouter(prefix="/api/sessions", tags=["proxy"])

# Back-off schedule for upstream reconnect attempts.
# After the last entry, the final delay is reused indefinitely so we keep
# retrying forever as long as the browser is still connected.
_BACKOFF = [0, 0.5, 1.0, 2.0, 4.0, 8.0]


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
    upstream_ws_url = (
        f"{ws_scheme}://{parsed.netloc}/api/kernels/{kernel_id}/channels"
        f"?session_id={stable_session}"
    )
    extra_headers = {"Authorization": f"token {session.jupyter_token}"}

    browser_disconnected = False
    attempt = 0

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

                # Upstream closed while browser is still here — increment back-off and retry.
                attempt += 1

        except (ConnectionClosed, OSError, websockets.exceptions.WebSocketException):
            if browser_disconnected:
                break
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
