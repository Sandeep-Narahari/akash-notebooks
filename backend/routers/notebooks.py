from __future__ import annotations

from datetime import datetime
from typing import Optional as Opt

from fastapi import APIRouter, Depends, Header, HTTPException

import database as db
from models import CreateNotebookRequest, Notebook, UpdateNotebookRequest

router = APIRouter(prefix="/api/notebooks", tags=["notebooks"])


# ---------------------------------------------------------------------------
# API key dependency
# ---------------------------------------------------------------------------

def _api_key_header(x_api_key: Opt[str] = Header(default=None)) -> str:
    if not x_api_key:
        raise HTTPException(status_code=401, detail="X-API-Key header required")
    return x_api_key


# ---------------------------------------------------------------------------
# GET /api/notebooks — list all notebooks
# ---------------------------------------------------------------------------

@router.get("")
async def list_notebooks(api_key: str = Depends(_api_key_header)) -> list[dict]:
    notebooks = await db.list_notebooks(api_key=api_key)
    return [n.model_dump(mode="json") for n in notebooks]


# ---------------------------------------------------------------------------
# POST /api/notebooks — create notebook
# ---------------------------------------------------------------------------

@router.post("", status_code=201)
async def create_notebook(
    body: CreateNotebookRequest,
    api_key: str = Depends(_api_key_header),
) -> dict:
    notebook = Notebook(
        name=body.name,
        resources=body.resources,
        api_key=api_key,
    )
    await db.save_notebook(notebook)
    return notebook.model_dump(mode="json")


# ---------------------------------------------------------------------------
# GET /api/notebooks/{id} — get notebook
# ---------------------------------------------------------------------------

@router.get("/{notebook_id}")
async def get_notebook(
    notebook_id: str,
    api_key: str = Depends(_api_key_header),
) -> dict:
    notebook = await db.get_notebook(notebook_id)
    if notebook is None:
        raise HTTPException(status_code=404, detail="Notebook not found")
    if notebook.api_key is not None and notebook.api_key != api_key:
        raise HTTPException(status_code=403, detail="Forbidden")
    return notebook.model_dump(mode="json")


# ---------------------------------------------------------------------------
# PUT /api/notebooks/{id} — update notebook
# ---------------------------------------------------------------------------

@router.put("/{notebook_id}")
async def update_notebook(
    notebook_id: str,
    body: UpdateNotebookRequest,
    api_key: str = Depends(_api_key_header),
) -> dict:
    notebook = await db.get_notebook(notebook_id)
    if notebook is None:
        raise HTTPException(status_code=404, detail="Notebook not found")
    if notebook.api_key is not None and notebook.api_key != api_key:
        raise HTTPException(status_code=403, detail="Forbidden")

    update_fields: dict = {"updated_at": datetime.utcnow()}

    if body.name is not None:
        update_fields["name"] = body.name
    if body.cells is not None:
        update_fields["cells"] = body.cells
    if body.resources is not None:
        update_fields["resources"] = body.resources

    updated = await db.update_notebook(notebook_id, **update_fields)
    if updated is None:
        raise HTTPException(status_code=404, detail="Notebook not found")
    return updated.model_dump(mode="json")


# ---------------------------------------------------------------------------
# DELETE /api/notebooks/{id} — delete notebook
# ---------------------------------------------------------------------------

@router.delete("/{notebook_id}", status_code=204)
async def delete_notebook(
    notebook_id: str,
    api_key: str = Depends(_api_key_header),
) -> None:
    notebook = await db.get_notebook(notebook_id)
    if notebook is None:
        raise HTTPException(status_code=404, detail="Notebook not found")
    if notebook.api_key is not None and notebook.api_key != api_key:
        raise HTTPException(status_code=403, detail="Forbidden")
    await db.delete_notebook(notebook_id)
