"""Shared Pydantic models. Field names follow CONTRACT.md; do not redesign."""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

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
    # True while the worker answers a follow-up question (its task is already done).
    answering: bool = False
    # Internal: the worker's conversation (served by /workers/{id}/transcript)
    # and the follow-up it is currently answering. Never sent to workers.
    log: List[Dict[str, Any]] = Field(default_factory=list, exclude=True)
    pending_message: Optional[str] = Field(None, exclude=True)


class Mission(BaseModel):
    id: str
    prompt: str
    status: MissionStatus = MissionStatus.CREATED
    worker_ids: List[str] = Field(default_factory=list)
    progress: float = Field(0.0, ge=0.0, le=1.0)
    result: Optional[str] = None
    approved: bool = False
    # Optional extras: when the mission started, and which lab owns it.
    created_at: Optional[float] = None
    lab: str = "ai"
    # "chat" splits by the lab's context categories; "code" splits pasted code by definition.
    mode: str = "chat"
    # Model id the workers use ("" = the default model).
    model: str = ""
    # The coordinator's final answer, written from the valid findings once the
    # mission completes. answer_status: none | writing | done | failed.
    answer: Optional[str] = None
    answer_status: str = "none"
    # Internal: the coordinator chat (served by /mission/{id}/messages).
    chat: List[Dict[str, Any]] = Field(default_factory=list, exclude=True)


Lab = Literal["ai", "defense", "biotech"]


class MissionCreate(BaseModel):
    prompt: str = Field(..., min_length=1)
    lab: Lab = "ai"
    mode: Literal["chat", "code"] = "chat"
    model: str = ""


class MessageCreate(BaseModel):
    text: str = Field(..., min_length=1, max_length=4000)


class ChatMessage(BaseModel):
    """One turn of the coordinator chat."""

    id: str
    role: Literal["user", "coordinator"]
    # "text" | "security" (a blocked attack, shown as an alert)
    kind: str = "text"
    text: Optional[str] = None
    # Per-worker findings behind the answer ("- role: output" lines).
    details: Optional[str] = None
    # The coordinator is writing the final answer from the findings.
    writing: bool = False
    pending: bool = False
    # Workers the coordinator asked (need-to-know), and the compartments matched.
    routed_to: List[str] = Field(default_factory=list)
    categories: List[str] = Field(default_factory=list)
    at: float


class TranscriptEntry(BaseModel):
    """One entry of a worker's conversation, as the trusted coordinator sees it."""

    id: str
    # dispatch | reply | operator | coordinator | attack | security | error
    kind: str
    text: str
    at: float
    # dispatch only: the exact context fragments sent to the worker.
    context: Dict[str, str] = Field(default_factory=dict)
    message_id: Optional[str] = None
    note: Optional[str] = None


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
