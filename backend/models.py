from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Resources
# ---------------------------------------------------------------------------

class Resources(BaseModel):
    cpu: float = 0.5         # vCPU (e.g. 0.5, 1.0, 2.0)
    memory: str = "512Mi"
    storage: str = "1Gi"
    gpu: int = 0
    gpu_model: Optional[str] = None


# ---------------------------------------------------------------------------
# Session
# ---------------------------------------------------------------------------

class SessionStatus(str, Enum):
    DEPLOYING = "deploying"
    CONNECTING = "connecting"
    READY = "ready"
    ERROR = "error"
    CLOSED = "closed"


class Session(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    dseq: Optional[int] = None
    api_key: str
    jupyter_token: str
    jupyter_url: Optional[str] = None
    kernel_id: Optional[str] = None
    status: SessionStatus = SessionStatus.DEPLOYING
    resources: Resources = Field(default_factory=Resources)
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    notebook_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Notebook cell & notebook
# ---------------------------------------------------------------------------

class NotebookCell(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    type: str = "code"
    source: str = ""
    outputs: list[Any] = Field(default_factory=list)
    execution_count: Optional[int] = None


class Notebook(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    cells: list[NotebookCell] = Field(default_factory=list)
    resources: Resources = Field(default_factory=Resources)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)
    api_key: Optional[str] = None


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------

class CreateSessionRequest(BaseModel):
    api_key: str
    resources: Resources = Field(default_factory=Resources)
    notebook_id: Optional[str] = None


class CreateSessionResponse(BaseModel):
    session_id: str
    status: str


class CreateNotebookRequest(BaseModel):
    name: str
    resources: Resources = Field(default_factory=Resources)


class UpdateNotebookRequest(BaseModel):
    name: Optional[str] = None
    cells: Optional[list[NotebookCell]] = None
    resources: Optional[Resources] = None


class ExecuteRequest(BaseModel):
    code: str
