from __future__ import annotations

import json
import os
from datetime import datetime
from typing import Any, Optional

import aiosqlite

from models import Notebook, Session, SessionStatus

DB_PATH = os.getenv("DB_PATH", "akash_notebooks.db")

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

CREATE_SESSIONS_TABLE = """
CREATE TABLE IF NOT EXISTS sessions (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL
)
"""

CREATE_NOTEBOOKS_TABLE = """
CREATE TABLE IF NOT EXISTS notebooks (
    id          TEXT PRIMARY KEY,
    data        TEXT NOT NULL,
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
)
"""

# ---------------------------------------------------------------------------
# Persistent connection
#
# Opening a new connection per operation adds ~1-5ms overhead per query.
# A single shared connection eliminates that cost. aiosqlite serialises all
# DB calls through a background thread so concurrent coroutines are safe.
# WAL mode allows parallel readers while a write is in progress.
# ---------------------------------------------------------------------------

_db: Optional[aiosqlite.Connection] = None


def _conn() -> aiosqlite.Connection:
    if _db is None:
        raise RuntimeError("Database not initialised — call init_db() first")
    return _db


async def init_db() -> None:
    global _db
    _db = await aiosqlite.connect(DB_PATH)
    # Performance settings
    await _db.execute("PRAGMA journal_mode=WAL")       # concurrent readers + one writer
    await _db.execute("PRAGMA synchronous=NORMAL")     # safe but faster than FULL
    await _db.execute("PRAGMA cache_size=-65536")      # 64 MB page cache
    await _db.execute("PRAGMA temp_store=MEMORY")      # temp tables in RAM
    await _db.execute("PRAGMA mmap_size=268435456")    # 256 MB memory-mapped I/O
    await _db.commit()
    await _db.execute(CREATE_SESSIONS_TABLE)
    await _db.execute(CREATE_NOTEBOOKS_TABLE)
    await _db.commit()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _serialize(obj: Any) -> str:
    if hasattr(obj, "model_dump"):
        return json.dumps(obj.model_dump(mode="json"))
    return json.dumps(obj)


def _now_iso() -> str:
    return datetime.utcnow().isoformat()


# ---------------------------------------------------------------------------
# Sessions
# ---------------------------------------------------------------------------

async def save_session(session: Session) -> None:
    db = _conn()
    await db.execute(
        "INSERT OR REPLACE INTO sessions (id, data, created_at) VALUES (?, ?, ?)",
        (session.id, _serialize(session), session.created_at.isoformat()),
    )
    await db.commit()


async def get_session(session_id: str) -> Optional[Session]:
    db = _conn()
    async with db.execute(
        "SELECT data FROM sessions WHERE id = ?", (session_id,)
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        return None
    return Session(**json.loads(row[0]))


async def update_session(session_id: str, **kwargs: Any) -> Optional[Session]:
    session = await get_session(session_id)
    if session is None:
        return None
    updated = session.model_copy(update=kwargs)
    await save_session(updated)
    return updated


async def delete_session(session_id: str) -> None:
    db = _conn()
    await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    await db.commit()


async def list_active_sessions(api_key: str) -> list[Session]:
    db = _conn()
    async with db.execute(
        "SELECT data FROM sessions ORDER BY created_at DESC"
    ) as cursor:
        rows = await cursor.fetchall()
    result = []
    for row in rows:
        try:
            s = Session(**json.loads(row[0]))
        except Exception:
            continue
        if s.api_key == api_key and s.status not in (SessionStatus.ERROR, SessionStatus.CLOSED):
            result.append(s)
    return result


# ---------------------------------------------------------------------------
# Notebooks
# ---------------------------------------------------------------------------

async def save_notebook(notebook: Notebook) -> None:
    db = _conn()
    await db.execute(
        "INSERT OR REPLACE INTO notebooks (id, data, created_at, updated_at) VALUES (?, ?, ?, ?)",
        (
            notebook.id,
            _serialize(notebook),
            notebook.created_at.isoformat(),
            notebook.updated_at.isoformat(),
        ),
    )
    await db.commit()


async def get_notebook(notebook_id: str) -> Optional[Notebook]:
    db = _conn()
    async with db.execute(
        "SELECT data FROM notebooks WHERE id = ?", (notebook_id,)
    ) as cursor:
        row = await cursor.fetchone()
    if row is None:
        return None
    return Notebook(**json.loads(row[0]))


async def list_notebooks(api_key: Optional[str] = None) -> list[Notebook]:
    db = _conn()
    async with db.execute(
        "SELECT data FROM notebooks ORDER BY created_at DESC"
    ) as cursor:
        rows = await cursor.fetchall()
    notebooks = []
    for row in rows:
        try:
            nb = Notebook(**json.loads(row[0]))
        except Exception:
            continue
        if api_key is None or nb.api_key is None or nb.api_key == api_key:
            notebooks.append(nb)
    return notebooks


async def update_notebook(notebook_id: str, **kwargs: Any) -> Optional[Notebook]:
    notebook = await get_notebook(notebook_id)
    if notebook is None:
        return None
    kwargs.setdefault("updated_at", datetime.utcnow())
    updated = notebook.model_copy(update=kwargs)
    await save_notebook(updated)
    return updated


async def delete_notebook(notebook_id: str) -> None:
    db = _conn()
    await db.execute("DELETE FROM notebooks WHERE id = ?", (notebook_id,))
    await db.commit()
