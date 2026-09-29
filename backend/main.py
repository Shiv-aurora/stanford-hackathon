"""Constellation API shell.

Run from backend/:  uvicorn main:app --reload

Subsystems are resolved at import time: the real module under services/ is used
when present, otherwise the deterministic stand-in from demo_seed.py. Set
CONSTELLATION_FALLBACK=1 to force the stand-ins.
"""

import importlib
import os
import time
import uuid
from typing import Any, Callable, Dict, List

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import demo_seed
from models import (
    AttackResponse,
    Mission,
    MissionCreate,
    MissionResult,
    MissionStatus,
    SecurityEvent,
    Worker,
    WorkerStatus,
)
from state import store

FORCE_FALLBACK = os.environ.get("CONSTELLATION_FALLBACK") == "1"
# Per-worker delay for the fallback runtime so the UI can watch status transitions.
FALLBACK_DELAY = float(os.environ.get("CONSTELLATION_WORKER_DELAY", "0.5"))


def _load(module: str, name: str, fallback: Callable) -> Callable:
    if FORCE_FALLBACK:
        return fallback
    try:
        return getattr(importlib.import_module(module), name)
    except (ImportError, AttributeError):
        return fallback


def _load_optional(module: str, name: str) -> Callable | None:
    if FORCE_FALLBACK:
        return None
    try:
        return getattr(importlib.import_module(module), name)
    except (ImportError, AttributeError):
        return None


# Wiring points for the other subsystems.
decompose_mission = _load("services.decomposer", "decompose_mission", demo_seed.decompose_mission)
run_workers = _load(
    "services.flower_runtime",
    "run_workers",
    lambda specs, on_update=None: demo_seed.run_workers(specs, on_update, FALLBACK_DELAY),
)
security_attack = _load_optional("services.security", "attack_worker")
synthesize = _load("services.coordinator", "synthesize", demo_seed.synthesize)
calculate_progress = _load("services.coordinator", "progress", demo_seed.progress)
calculate_metrics = _load("services.coordinator", "metrics", demo_seed.metrics)


app = FastAPI(title="Constellation")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _mission_or_404(mission_id: str) -> Mission:
    mission = store.get_mission(mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail="mission not found")
    return mission


def _refresh_mission(mission_id: str) -> None:
    """Recompute progress/status; the coordinator synthesizes once all active workers finish."""
    with store.lock:
        mission = store.missions[mission_id]
        if mission.status == MissionStatus.APPROVED:
            return
        workers = store.mission_workers(mission_id)
        mission.progress = calculate_progress(workers)
        active = demo_seed.active_workers(workers)
        finished = all(w.status in (WorkerStatus.COMPLETE, WorkerStatus.FAILED) for w in active)
        if active and finished:
            if any(w.status == WorkerStatus.COMPLETE for w in active):
                mission.status = MissionStatus.COMPLETE
                mission.result = synthesize(workers)
            else:
                mission.status = MissionStatus.FAILED
        else:
            mission.status = MissionStatus.RUNNING
            mission.result = None


def _apply_update(update: Any) -> None:
    worker_id = _get(update, "worker_id") or _get(update, "id")
    with store.lock:
        worker = store.get_worker(worker_id)
        # Late results from a quarantined worker must never land.
        if worker is None or worker.quarantined:
            return
        for field in ("status", "output", "error", "started_at", "finished_at"):
            value = _get(update, field)
            if value is not None:
                setattr(worker, field, WorkerStatus(value) if field == "status" else value)
        _refresh_mission(worker.mission_id)


def _execute(worker_ids: List[str]) -> None:
    specs: List[Dict[str, Any]] = []
    for worker_id in worker_ids:
        worker = store.get_worker(worker_id)
        if worker is not None:
            spec = worker.model_dump(mode="json")
            # `context` is intentionally excluded from API serialization, so
            # add the worker's own private fragment explicitly for execution.
            spec["context"] = dict(worker.context)
            specs.append(spec)
    try:
        results = run_workers(specs, on_update=_apply_update)
        for result in results or []:
            _apply_update(result)
    except Exception as exc:  # keep the demo alive; surface as failed workers
        for spec in specs:
            _apply_update({"worker_id": spec["id"], "status": "failed", "error": str(exc)})


@app.get("/health")
def health() -> Dict[str, Any]:
    return {"status": "ok"}


@app.post("/mission", response_model=Mission)
def create_mission(body: MissionCreate, background: BackgroundTasks) -> Mission:
    mission = store.add_mission(
        Mission(id=f"m-{uuid.uuid4().hex[:8]}", prompt=body.prompt, created_at=time.time())
    )
    for i, spec in enumerate(decompose_mission(body.prompt), start=1):
        store.add_worker(Worker(
            id=f"{mission.id}-w{i:02d}",
            mission_id=mission.id,
            role=_get(spec, "role"),
            task=_get(spec, "task"),
            allowed_context=list(_get(spec, "allowed_context", [])),
            blocked_context=list(_get(spec, "blocked_context", [])),
            context=dict(_get(spec, "context", {})),
            context_exposure=_get(spec, "context_exposure", 0.0),
            network_identity=_get(spec, "network_identity") or f"node-{i:02d}",
        ))
    mission.status = MissionStatus.RUNNING
    background.add_task(_execute, list(mission.worker_ids))
    return mission


@app.get("/missions", response_model=List[Mission])
def list_missions() -> List[Mission]:
    """Every mission in creation order (in-memory, so empty after a restart)."""
    with store.lock:
        return list(store.missions.values())


@app.get("/mission/{mission_id}", response_model=Mission)
def get_mission(mission_id: str) -> Mission:
    return _mission_or_404(mission_id)


@app.get("/mission/{mission_id}/workers", response_model=List[Worker])
def get_workers(mission_id: str) -> List[Worker]:
    _mission_or_404(mission_id)
    return store.mission_workers(mission_id)


@app.post("/workers/{worker_id}/attack", response_model=AttackResponse)
def attack_worker(worker_id: str, background: BackgroundTasks) -> AttackResponse:
    with store.lock:
        worker = store.get_worker(worker_id)
        if worker is None:
            raise HTTPException(status_code=404, detail="worker not found")
        if worker.quarantined:
            raise HTTPException(status_code=409, detail="worker already quarantined")
        mission = store.missions[worker.mission_id]
        if mission.status == MissionStatus.APPROVED:
            raise HTTPException(status_code=409, detail="mission already approved")

        if security_attack is not None:
            # Real security path: the module mutates the compromised worker in
            # place and returns (security_event, clean_replacement).
            event_data, replacement = security_attack(worker, store.mission_workers(mission.id))
            if replacement is None:
                raise HTTPException(status_code=500, detail="security replacement was not created")
            # The security module assigns plain status strings; keep the enum type.
            worker.status = WorkerStatus(worker.status)
            replacement.status = WorkerStatus(replacement.status)
            # A fresh run: don't inherit the compromised worker's timing/error.
            replacement.started_at = replacement.finished_at = replacement.error = None
            quarantined = worker
            detail = _get(event_data, "message", "worker quarantined")
            event_timestamp = float(_get(event_data, "timestamp", time.time()))
        else:
            # Deterministic fallback kept for demo resilience.
            n = len(mission.worker_ids) + 1
            outcome = demo_seed.quarantine_and_replace(
                worker, f"{mission.id}-w{n:02d}", f"node-{n:02d}"
            )
            quarantined = _get(outcome, "quarantined")
            replacement = _get(outcome, "replacement")
            detail = _get(outcome, "detail", "worker quarantined")
            event_timestamp = time.time()

        store.workers[worker.id] = quarantined
        store.add_worker(replacement)
        event = SecurityEvent(
            mission_id=mission.id,
            worker_id=worker.id,
            replacement_id=replacement.id,
            detail=detail,
            timestamp=event_timestamp,
        )
        store.add_event(event)
        _refresh_mission(mission.id)

    background.add_task(_execute, [replacement.id])
    return AttackResponse(quarantined=quarantined, replacement=replacement, event=event)


@app.get("/mission/{mission_id}/result", response_model=MissionResult)
def get_result(mission_id: str) -> MissionResult:
    mission = _mission_or_404(mission_id)
    workers = store.mission_workers(mission_id)
    return MissionResult(
        mission_id=mission.id,
        status=mission.status,
        progress=mission.progress,
        result=mission.result,
        approved=mission.approved,
        metrics=calculate_metrics(workers),
    )


@app.post("/mission/{mission_id}/approve", response_model=Mission)
def approve_mission(mission_id: str) -> Mission:
    with store.lock:
        mission = _mission_or_404(mission_id)
        if mission.status not in (MissionStatus.COMPLETE, MissionStatus.APPROVED):
            raise HTTPException(status_code=409, detail="mission not complete")
        mission.approved = True
        mission.status = MissionStatus.APPROVED
        return mission
