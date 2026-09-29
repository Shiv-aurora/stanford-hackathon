"""Shared Pydantic models. Field names follow CONTRACT.md; do not redesign."""

from enum import Enum
from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class WorkerStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    COMPLETE = "complete"
    FAILED = "failed"
    QUARANTINED = "quarantined"
    REPLACED = "replaced"


class MissionStatus(str, Enum):
    CREATED = "created"
    RUNNING = "running"
    COMPLETE = "complete"
    APPROVED = "approved"
    FAILED = "failed"


class Worker(BaseModel):
    id: str
    mission_id: str
    role: str
    task: str
    status: WorkerStatus = WorkerStatus.QUEUED
    allowed_context: List[str] = Field(default_factory=list)
    blocked_context: List[str] = Field(default_factory=list)
    # Actual narrow fragment text is internal-only: stored for execution but
    # excluded from API responses so the UI only sees access labels.
    context: Dict[str, str] = Field(default_factory=dict, exclude=True)
    context_exposure: float = Field(0.0, ge=0.0, le=1.0)
    tainted: bool = False
    quarantined: bool = False
    output: Optional[str] = None
    network_identity: str = ""
    replacement_for: Optional[str] = None
    # Optional extras allowed by the contract.
    error: Optional[str] = None
    started_at: Optional[float] = None
    finished_at: Optional[float] = None


class Mission(BaseModel):
    id: str
    prompt: str
    status: MissionStatus = MissionStatus.CREATED
    worker_ids: List[str] = Field(default_factory=list)
    progress: float = Field(0.0, ge=0.0, le=1.0)
    result: Optional[str] = None
    approved: bool = False
    # Optional extra: lets the UI order missions and show when each started.
    created_at: Optional[float] = None


class MissionCreate(BaseModel):
    prompt: str = Field(..., min_length=1)


class SecurityEvent(BaseModel):
    mission_id: str
    worker_id: str
    replacement_id: str
    kind: str = "prompt_injection"
    detail: str
    timestamp: float


class AttackResponse(BaseModel):
    quarantined: Worker
    replacement: Worker
    event: SecurityEvent


class MissionMetrics(BaseModel):
    total_workers: int
    completed_workers: int
    quarantined_workers: int
    max_context_exposure: float


class MissionResult(BaseModel):
    mission_id: str
    status: MissionStatus
    progress: float
    result: Optional[str] = None
    approved: bool
    metrics: MissionMetrics
