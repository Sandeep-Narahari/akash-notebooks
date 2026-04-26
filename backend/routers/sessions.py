from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import AsyncGenerator, Optional
from urllib.parse import urlparse

import httpx
from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse

import database as db
from models import (
    CreateSessionRequest,
    CreateSessionResponse,
    Session,
    SessionStatus,
)
from services.akash_service import AkashService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/sessions", tags=["sessions"])

# ---------------------------------------------------------------------------
# Per-session event log (append-only list) + wakeup signal.
#
# Using an append-only list instead of asyncio.Queue means any number of SSE
# consumers can connect/reconnect and replay all events from the beginning.
# Queue-based designs lose events when the consumer disconnects mid-stream.
# ---------------------------------------------------------------------------

# event log: list of dicts (progress events) terminated by None when done.
_event_log: dict[str, list] = {}
# wakeup signal: set whenever a new event is appended so SSE generators
# sleeping on wait() wake up immediately instead of timing out.
_event_signal: dict[str, asyncio.Event] = {}

# Strong references to background tasks to prevent garbage collection.
_background_tasks: set[asyncio.Task] = set()

_akash = AkashService()


def _get_log(session_id: str) -> list:
    return _event_log.setdefault(session_id, [])


def _get_signal(session_id: str) -> asyncio.Event:
    return _event_signal.setdefault(session_id, asyncio.Event())


def _append_event(session_id: str, event: dict | None) -> None:
    """Append event to log and wake all waiting SSE consumers."""
    _get_log(session_id).append(event)
    sig = _get_signal(session_id)
    sig.set()
    sig.clear()


# ---------------------------------------------------------------------------
# Background deploy task
# ---------------------------------------------------------------------------

async def _deploy_in_background(session_id: str, api_key: str, resources) -> None:
    """Run the full Akash deploy flow and update the session in the DB."""

    async def _emit(msg: str, step: int | None = None) -> None:
        event: dict = {"type": "progress", "message": msg}
        if step is not None:
            event["step"] = step
        _append_event(session_id, event)

    try:
        await db.update_session(session_id, status=SessionStatus.CONNECTING)
        await _emit("Connecting to Akash Network…", step=0)

        result = await _akash.full_deploy(api_key, resources, progress_cb=_emit)

        await db.update_session(
            session_id,
            status=SessionStatus.READY,
            dseq=result["dseq"],
            jupyter_url=result["jupyter_url"],
            jupyter_token=result["jupyter_token"],
            kernel_id=result["kernel_id"],
        )
        await _emit("READY")
    except Exception as exc:
        err = str(exc)
        logger.error("Deploy failed for session %s: %s", session_id, err)
        await db.update_session(
            session_id,
            status=SessionStatus.ERROR,
            error_message=err,
        )
        await _emit(f"ERROR: {err}")
    finally:
        # Append terminal marker — SSE consumers stop when they see None.
        _append_event(session_id, None)


# ---------------------------------------------------------------------------
# GET /api/sessions — list active sessions for the calling api_key
# ---------------------------------------------------------------------------

@router.get("")
async def list_sessions(x_api_key: Optional[str] = Header(default=None)) -> list[dict]:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="X-API-Key header required")
    sessions = await db.list_active_sessions(x_api_key)
    return [s.model_dump(mode="json") for s in sessions]


# ---------------------------------------------------------------------------
# POST /api/sessions — create a new session (fire-and-forget background task)
# ---------------------------------------------------------------------------

@router.post("", response_model=CreateSessionResponse, status_code=202)
async def create_session(body: CreateSessionRequest) -> CreateSessionResponse:
    import secrets

    session = Session(
        api_key=body.api_key,
        jupyter_token=secrets.token_hex(16),
        resources=body.resources,
        status=SessionStatus.DEPLOYING,
        notebook_id=body.notebook_id,
    )
    await db.save_session(session)

    # Pre-create log/signal so SSE consumers that connect immediately don't race.
    _event_log[session.id] = []
    _event_signal[session.id] = asyncio.Event()

    task = asyncio.create_task(
        _deploy_in_background(session.id, body.api_key, body.resources)
    )
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)

    return CreateSessionResponse(session_id=session.id, status="deploying")


# ---------------------------------------------------------------------------
# GET /api/sessions/{id} — fetch session details
# ---------------------------------------------------------------------------

@router.get("/{session_id}")
async def get_session(session_id: str) -> dict:
    session = await db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session.model_dump(mode="json")


# ---------------------------------------------------------------------------
# POST /api/sessions/{id}/restart — restart the Jupyter kernel
# ---------------------------------------------------------------------------

@router.post("/{session_id}/restart")
async def restart_kernel(session_id: str) -> dict:
    session = await db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.READY or not session.jupyter_url or not session.kernel_id:
        raise HTTPException(status_code=400, detail="Session not ready")

    restart_url = f"{session.jupyter_url}/api/kernels/{session.kernel_id}/restart"
    headers = {"Authorization": f"token {session.jupyter_token}"}

    try:
        async with httpx.AsyncClient(timeout=30.0) as c:
            resp = await c.post(restart_url, headers=headers)
        if resp.status_code not in (200, 204):
            raise HTTPException(status_code=502, detail=f"Jupyter restart failed: {resp.status_code}")
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Jupyter unreachable: {exc}") from exc

    return {"status": "restarted", "kernel_id": session.kernel_id}


# ---------------------------------------------------------------------------
# POST /api/sessions/{id}/terminal — create a Jupyter terminal
# ---------------------------------------------------------------------------

@router.post("/{session_id}/terminal")
async def create_terminal(session_id: str) -> dict:
    session = await db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.READY or not session.jupyter_url:
        raise HTTPException(status_code=400, detail="Session not ready")

    async with httpx.AsyncClient(timeout=10.0) as c:
        resp = await c.post(
            f"{session.jupyter_url}/api/terminals",
            headers={"Authorization": f"token {session.jupyter_token}"},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Failed to create terminal: {resp.status_code}")
    return resp.json()


# ---------------------------------------------------------------------------
# POST /api/sessions/{id}/upload — upload file to Jupyter workspace
# ---------------------------------------------------------------------------

@router.post("/{session_id}/upload")
async def upload_to_session(
    session_id: str,
    file: UploadFile = File(...),
) -> dict:
    session = await db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.status != SessionStatus.READY or not session.jupyter_url:
        raise HTTPException(status_code=400, detail="Session not ready")

    content = await file.read()
    encoded = base64.b64encode(content).decode()

    async with httpx.AsyncClient(timeout=60.0) as c:
        resp = await c.put(
            f"{session.jupyter_url}/api/contents/{file.filename}",
            headers={"Authorization": f"token {session.jupyter_token}"},
            json={"type": "file", "format": "base64", "content": encoded},
        )
    if resp.status_code not in (200, 201):
        raise HTTPException(status_code=502, detail=f"Upload failed: {resp.status_code}")
    return {"path": file.filename, "status": "uploaded"}


# ---------------------------------------------------------------------------
# DELETE /api/sessions/{id} — close Akash deployment + remove record
# ---------------------------------------------------------------------------

@router.delete("/{session_id}", status_code=204)
async def delete_session(session_id: str) -> None:
    session = await db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.dseq is not None:
        try:
            await _akash.close_deployment(session.api_key, session.dseq)
        except Exception:
            pass

    await db.delete_session(session_id)
    _event_log.pop(session_id, None)
    _event_signal.pop(session_id, None)


# ---------------------------------------------------------------------------
# GET /api/sessions/{id}/status-stream — SSE deployment progress
# ---------------------------------------------------------------------------

@router.get("/{session_id}/status-stream")
async def status_stream(session_id: str) -> StreamingResponse:
    session = await db.get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    async def _event_generator() -> AsyncGenerator[str, None]:
        # If already finished, send current DB state immediately.
        current = await db.get_session(session_id)
        if current and current.status in (
            SessionStatus.READY,
            SessionStatus.ERROR,
            SessionStatus.CLOSED,
        ):
            payload = json.dumps({
                "type": current.status,
                "status": current.status,
                "message": current.error_message or current.status,
                "jupyter_url": current.jupyter_url,
                "kernel_id": current.kernel_id,
            })
            yield f"data: {payload}\n\n"
            return

        log = _get_log(session_id)
        signal = _get_signal(session_id)
        idx = 0
        last_keepalive = asyncio.get_event_loop().time()

        while True:
            # Drain all available events from the log.
            while idx < len(log):
                event = log[idx]
                idx += 1

                if event is None:
                    # Terminal marker — read final state from DB.
                    final = await db.get_session(session_id)
                    if final:
                        payload = json.dumps({
                            "type": final.status,
                            "status": final.status,
                            "message": final.error_message or final.status,
                            "jupyter_url": final.jupyter_url,
                            "kernel_id": final.kernel_id,
                            "step": 4 if final.status == "ready" else None,
                        })
                        yield f"data: {payload}\n\n"
                    return

                yield f"data: {json.dumps(event)}\n\n"

            # Caught up — wait for new events with a keep-alive timeout.
            now = asyncio.get_event_loop().time()
            remaining = 30.0 - (now - last_keepalive)
            if remaining <= 0:
                yield ": keep-alive\n\n"
                last_keepalive = asyncio.get_event_loop().time()
                remaining = 30.0

            try:
                await asyncio.wait_for(asyncio.shield(signal.wait()), timeout=remaining)
            except asyncio.TimeoutError:
                yield ": keep-alive\n\n"
                last_keepalive = asyncio.get_event_loop().time()

    return StreamingResponse(
        _event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
