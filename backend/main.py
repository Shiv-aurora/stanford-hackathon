"""Constellation API shell.

Run from backend/:  uvicorn main:app --reload

Subsystems are resolved at import time: the real module under services/ is used
when present, otherwise the deterministic stand-in from demo_seed.py. Set
CONSTELLATION_FALLBACK=1 to force the stand-ins.
"""

import importlib
import logging
import os
import re
import threading
import time
import uuid
from typing import Any, Callable, Dict, List, Optional

from fastapi import BackgroundTasks, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

import demo_seed
from models import (
    AttackResponse,
    ChatMessage,
    MessageCreate,
    Mission,
    MissionCreate,
    MissionResult,
    MissionStatus,
    SecurityEvent,
    TranscriptEntry,
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
# Coordinator-side injection check on what each worker processed.
detect_injection = _load("services.security", "detect_injection", lambda text: [])
log = logging.getLogger("constellation")
# Need-to-know routing for follow-up questions; the fallback asks every worker.
route_question = _load("services.decomposer", "route_question", lambda question, domain=None: set())
# Trusted coordinator service: runs decompose -> workers -> attack handling ->
# synthesis inside the Flower ServerApp. None means the in-process fallbacks.
get_swarm = _load_optional("services.swarm", "get_swarm")
SWARM_TIMEOUT = float(os.environ.get("CONSTELLATION_SWARM_TIMEOUT", "120"))


app = FastAPI(title="Constellation")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _warm_coordinator() -> None:
    # Start the Flower coordinator in the background so the first mission is fast.
    if get_swarm is not None:
        threading.Thread(target=get_swarm, name="constellation-warmup", daemon=True).start()


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _mission_or_404(mission_id: str) -> Mission:
    mission = store.get_mission(mission_id)
    if mission is None:
        raise HTTPException(status_code=404, detail="mission not found")
    return mission


def _refresh_mission(mission_id: str, synthesize_now: bool = True) -> None:
    """Recompute progress/status; the coordinator synthesizes once all active workers finish.

    With the swarm coordinator, updates pass synthesize_now=False and the
    coordinator triggers synthesis itself via _ApiMission.finish().
    """
    with store.lock:
        mission = store.missions[mission_id]
        if mission.status == MissionStatus.APPROVED:
            return
        workers = store.mission_workers(mission_id)
        mission.progress = calculate_progress(workers)
        active = demo_seed.active_workers(workers)
        finished = all(w.status in (WorkerStatus.COMPLETE, WorkerStatus.FAILED) for w in active)
        if active and finished and synthesize_now:
            if any(w.status == WorkerStatus.COMPLETE for w in active):
                mission.status = MissionStatus.COMPLETE
                mission.result = synthesize(workers)
            else:
                mission.status = MissionStatus.FAILED
        else:
            mission.status = MissionStatus.RUNNING
            mission.result = None


def _log(worker: Worker, kind: str, text: str, **extra: Any) -> None:
    """Append to the worker's conversation (trusted coordinator view only)."""
    worker.log.append({"id": f"e-{uuid.uuid4().hex[:8]}", "kind": kind, "text": text, "at": time.time(), **extra})


def _apply_update(update: Any, synthesize_now: bool = True) -> None:
    worker_id = _get(update, "worker_id") or _get(update, "id")
    with store.lock:
        worker = store.get_worker(worker_id)
        # Late results from a quarantined worker must never land.
        if worker is None or worker.quarantined:
            return
        status = _get(update, "status")
        status = WorkerStatus(status) if status is not None else None
        if worker.pending_message is not None:
            # A follow-up reply goes to the conversation, never over the task output.
            if status == WorkerStatus.COMPLETE:
                _finish_reply(worker, _get(update, "output"))
            elif status == WorkerStatus.FAILED:
                _finish_reply(worker, None, _get(update, "error"))
            return
        before = worker.status
        for field in ("status", "output", "error", "started_at", "finished_at"):
            value = _get(update, field)
            if value is not None:
                setattr(worker, field, WorkerStatus(value) if field == "status" else value)
        if status == WorkerStatus.COMPLETE and before != WorkerStatus.COMPLETE and (hits := _injected(worker)):
            # The coordinator's check: this worker processed injected instructions.
            # Hold its output (it never reaches the synthesis) and contain it.
            worker.status = WorkerStatus.RUNNING
            _log(worker, "reply", worker.output or "")
            _log(worker, "security", f"Coordinator check: prompt injection found in what this worker processed "
                                     f"({', '.join(hits)}). Output held back; quarantining.")
            threading.Thread(target=_auto_contain, args=(worker.id,), daemon=True).start()
            _refresh_mission(worker.mission_id, False)
            return
        if status == WorkerStatus.COMPLETE and before != WorkerStatus.COMPLETE and worker.output:
            _log(worker, "reply", worker.output)
        elif status == WorkerStatus.FAILED and before != WorkerStatus.FAILED:
            _log(worker, "error", worker.error or "worker failed")
        _refresh_mission(worker.mission_id, synthesize_now)


def _injected(worker: Worker) -> List[str]:
    """Injection heuristics that fire on the worker's context (2+ signals to avoid false alarms)."""
    hits = sorted({h for text in worker.context.values() for h in detect_injection(text)})
    return hits if len(hits) >= 2 else []


def _pieces(text: str) -> List[str]:
    return text.splitlines() if "\n" in text else re.split(r"(?<=[.!?])\s+", text)


def _sanitize(text: str) -> str:
    """Drop the sentences (or code lines) that carry injected instructions."""
    sep = "\n" if "\n" in text else " "
    return sep.join(p for p in _pieces(text) if not detect_injection(p))


def _auto_contain(worker_id: str) -> None:
    worker = store.get_worker(worker_id)
    if worker is None or worker.quarantined:
        return
    try:
        swarm = get_swarm() if get_swarm is not None else None
        if swarm is not None and swarm.has_mission(worker.mission_id):
            _await(swarm.attack(worker.mission_id, worker_id))
        else:
            _execute([_quarantine(worker_id).replacement.id])
    except Exception:
        log.exception("automatic containment failed for %s", worker_id)


def _finish_reply(worker: Worker, output: Optional[str], error: Optional[str] = None) -> None:
    """Record a follow-up reply; complete the coordinator answer once every routed worker replied."""
    message_id = worker.pending_message
    worker.pending_message = None
    worker.answering = False
    if output:
        _log(worker, "reply", output, message_id=message_id)
    else:
        _log(worker, "error", error or "no reply", message_id=message_id)
    mission = store.missions[worker.mission_id]
    for msg in mission.chat:
        if msg["id"] != message_id:
            continue
        msg["replies"][worker.id] = output
        if len(msg["replies"]) >= len(msg["routed_to"]):
            msg["text"] = _compose_answer(msg, mission)
            msg["pending"] = False


def _compose_answer(msg: Dict[str, Any], mission: Mission) -> str:
    """The coordinator's answer: only the replies of the workers it asked."""
    active = [w for w in store.mission_workers(mission.id) if not w.quarantined]
    asked = len(msg["routed_to"])
    if msg["categories"]:
        head = (
            f"Asked {asked} of {len(active)} workers on a need-to-know basis "
            f"({', '.join(msg['categories'])})."
        )
    else:
        head = f"No single compartment matched, so all {asked} workers were asked."
    lines = [head]
    for worker_id in msg["routed_to"]:
        w = store.get_worker(worker_id)
        reply = msg["replies"].get(worker_id)
        lines.append(f"- {w.role if w else worker_id}: {reply or '(no reply)'}")
    return "\n".join(lines)


def _ask(worker: Worker, text: str, message_id: str, kind: str) -> Dict[str, Any]:
    """Mark `worker` as answering and build its follow-up payload (own slice + question)."""
    worker.pending_message = message_id
    worker.answering = True
    _log(worker, kind, text, message_id=message_id)
    spec = _execution_spec(worker)
    spec["message"] = text
    return spec


def _send_followups(mission_id: str, specs: List[Dict[str, Any]], background: BackgroundTasks) -> None:
    swarm = get_swarm() if get_swarm is not None else None
    if swarm is not None and swarm.has_mission(mission_id):
        # Through the coordinator (and Flower), like the original dispatch.
        for spec in specs:
            _await(swarm.dispatch(mission_id, spec))
    else:
        background.add_task(_run_followups, specs)


def _run_followups(specs: List[Dict[str, Any]]) -> None:
    try:
        run_workers(specs, on_update=_apply_update)
    except Exception as exc:  # keep the demo alive; the pending answers fail
        for spec in specs:
            _apply_update({"worker_id": spec["id"], "status": "failed", "error": str(exc)})


def _execution_spec(worker: Worker) -> Dict[str, Any]:
    spec = worker.model_dump(mode="json")
    # `context` is intentionally excluded from API serialization, so add the
    # worker's own private fragment explicitly for execution.
    spec["context"] = dict(worker.context)
    return spec


def _execute(worker_ids: List[str]) -> None:
    specs: List[Dict[str, Any]] = []
    for worker_id in worker_ids:
        worker = store.get_worker(worker_id)
        if worker is not None:
            specs.append(_execution_spec(worker))
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


def _create_workers(mission: Mission) -> List[Worker]:
    workers = []
    domain = "code" if mission.mode == "code" else mission.lab
    for i, spec in enumerate(decompose_mission(mission.prompt, domain=domain), start=1):
        workers.append(store.add_worker(Worker(
            id=f"{mission.id}-w{i:02d}",
            mission_id=mission.id,
            role=_get(spec, "role"),
            task=_get(spec, "task"),
            allowed_context=list(_get(spec, "allowed_context", [])),
            blocked_context=list(_get(spec, "blocked_context", [])),
            context=dict(_get(spec, "context", {})),
            context_exposure=_get(spec, "context_exposure", 0.0),
            network_identity=_get(spec, "network_identity") or f"node-{i:02d}",
        )))
    for w in workers:
        _log(w, "dispatch", w.task, context=dict(w.context))
    return workers


class _ApiMission:
    """Mission handler run by the trusted coordinator (services.swarm).

    Every method is called from the coordinator loop inside the Flower
    ServerApp; the API routes only submit work and wait for the answer.
    """

    def __init__(self, mission_id: str) -> None:
        self.mission_id = mission_id

    def decompose(self) -> List[Dict[str, Any]]:
        with store.lock:
            mission = store.missions[self.mission_id]
            workers = _create_workers(mission)
            mission.status = MissionStatus.RUNNING
            return [_execution_spec(w) for w in workers]

    def on_update(self, update: Dict[str, Any]) -> None:
        _apply_update(update, synthesize_now=False)

    def attack(self, worker_id: str) -> tuple:
        response = _quarantine(worker_id)
        return response, _execution_spec(response.replacement)

    def finish(self) -> None:
        _refresh_mission(self.mission_id, synthesize_now=True)


def _await(future: Any) -> Any:
    try:
        return future.result(timeout=SWARM_TIMEOUT)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"coordinator unavailable: {exc}") from exc


@app.post("/mission", response_model=Mission)
def create_mission(body: MissionCreate, background: BackgroundTasks) -> Mission:
    mission = store.add_mission(
        Mission(id=f"m-{uuid.uuid4().hex[:8]}", prompt=body.prompt, created_at=time.time(), lab=body.lab, mode=body.mode)
    )
    now = time.time()
    mission.chat = [
        {"id": f"c-{uuid.uuid4().hex[:8]}", "role": "user", "text": body.prompt, "at": now},
        # The coordinator's first reply is the mission synthesis itself.
        {"id": f"c-{uuid.uuid4().hex[:8]}", "role": "coordinator", "kind": "mission", "at": now},
    ]
    if get_swarm is not None:
        # The coordinator decomposes and dispatches inside the Flower ServerApp.
        _await(get_swarm().submit_mission(mission.id, _ApiMission(mission.id)))
        return mission
    _create_workers(mission)
    mission.status = MissionStatus.RUNNING
    background.add_task(_execute, list(mission.worker_ids))
    return mission


@app.get("/missions", response_model=List[Mission])
def list_missions(lab: Optional[str] = None) -> List[Mission]:
    """Missions in creation order, optionally for one lab (in-memory, so empty after a restart)."""
    with store.lock:
        return [m for m in store.missions.values() if lab is None or m.lab == lab]


@app.get("/mission/{mission_id}", response_model=Mission)
def get_mission(mission_id: str) -> Mission:
    return _mission_or_404(mission_id)


@app.get("/mission/{mission_id}/workers", response_model=List[Worker])
def get_workers(mission_id: str) -> List[Worker]:
    _mission_or_404(mission_id)
    return store.mission_workers(mission_id)


def _quarantine(worker_id: str) -> AttackResponse:
    """Quarantine `worker_id` and create its replacement (not yet executed)."""
    with store.lock:
        worker = store.get_worker(worker_id)
        if worker is None:
            raise HTTPException(status_code=404, detail="worker not found")
        if worker.quarantined:
            raise HTTPException(status_code=409, detail="worker already quarantined")
        mission = store.missions[worker.mission_id]
        if mission.status == MissionStatus.APPROVED:
            raise HTTPException(status_code=409, detail="mission already approved")
        if worker.pending_message is not None:
            # Its follow-up reply would be dropped; don't leave the question hanging.
            _finish_reply(worker, None, "quarantined before replying")

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
            injected = _get(event_data, "attack_preview") or "Simulated prompt injection."
            injected = next((p for t in worker.context.values() for p in _pieces(t) if detect_injection(p)), injected)
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
            injected = "Simulated prompt injection."
            replacement.context = dict(worker.context)

        _log(quarantined, "attack", injected)
        _log(quarantined, "security", detail)
        # The replacement starts a clean conversation with the same narrow slice,
        # minus any injected text the coordinator found in it.
        cleaned = {k: _sanitize(v) for k, v in worker.context.items()}
        stripped = cleaned != worker.context
        replacement.context = cleaned
        replacement.log = []
        replacement.pending_message = None
        replacement.answering = False
        _log(replacement, "dispatch", replacement.task, context=dict(replacement.context),
             note=f"Replacement for {worker.id}" + (" · injected text removed" if stripped else ""))
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
        _refresh_mission(mission.id, synthesize_now=False)
        return AttackResponse(quarantined=quarantined, replacement=replacement, event=event)


@app.post("/workers/{worker_id}/attack", response_model=AttackResponse)
def attack_worker(worker_id: str, background: BackgroundTasks) -> AttackResponse:
    worker = store.get_worker(worker_id)
    if worker is None:
        raise HTTPException(status_code=404, detail="worker not found")
    swarm = get_swarm() if get_swarm is not None else None
    if swarm is not None and swarm.has_mission(worker.mission_id):
        # The coordinator quarantines and re-dispatches inside the ServerApp.
        return _await(swarm.attack(worker.mission_id, worker_id))
    response = _quarantine(worker_id)
    background.add_task(_execute, [response.replacement.id])
    return response


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


# ---------------------------------------------------------------------------
# Conversations: the coordinator chat and per-worker transcripts.
# ---------------------------------------------------------------------------


def _chat_view(mission: Mission, msg: Dict[str, Any]) -> ChatMessage:
    if msg.get("kind") == "mission":
        # The first coordinator reply mirrors the mission synthesis.
        finished = mission.status in (MissionStatus.COMPLETE, MissionStatus.APPROVED)
        text = mission.result if finished else None
        if mission.status == MissionStatus.FAILED:
            text = "The mission failed: no worker returned a valid output."
        workers = [w for w in store.mission_workers(mission.id) if not w.quarantined]
        return ChatMessage(
            id=msg["id"], role="coordinator", text=text, pending=text is None,
            routed_to=[w.id for w in workers], at=msg["at"],
        )
    return ChatMessage(
        id=msg["id"], role=msg["role"], text=msg.get("text"), pending=bool(msg.get("pending")),
        routed_to=list(msg.get("routed_to", [])), categories=list(msg.get("categories", [])), at=msg["at"],
    )


@app.get("/mission/{mission_id}/messages", response_model=List[ChatMessage])
def get_messages(mission_id: str) -> List[ChatMessage]:
    with store.lock:
        mission = _mission_or_404(mission_id)
        return [_chat_view(mission, m) for m in mission.chat]


@app.post("/mission/{mission_id}/messages", response_model=List[ChatMessage])
def post_message(mission_id: str, body: MessageCreate, background: BackgroundTasks) -> List[ChatMessage]:
    """Ask the coordinator a follow-up. It routes the question only to the
    workers whose compartment it concerns, then answers from their replies."""
    with store.lock:
        mission = _mission_or_404(mission_id)
        if mission.status not in (MissionStatus.COMPLETE, MissionStatus.APPROVED):
            raise HTTPException(status_code=409, detail="mission is still running")
        workers = store.mission_workers(mission_id)
        if any(w.answering for w in workers):
            raise HTTPException(status_code=409, detail="the coordinator is still answering")
        ready = [w for w in workers if w.status == WorkerStatus.COMPLETE and not w.quarantined and not w.tainted]
        if not ready:
            raise HTTPException(status_code=409, detail="no worker is available")
        categories = sorted(route_question(body.text, mission.lab))
        routed = [w for w in ready if set(categories) & set(w.allowed_context)] or ready
        if len(routed) == len(ready) and not any(set(categories) & set(w.allowed_context) for w in ready):
            categories = []  # nothing matched: every worker is asked
        now = time.time()
        question = {"id": f"c-{uuid.uuid4().hex[:8]}", "role": "user", "text": body.text, "at": now}
        answer = {
            "id": f"c-{uuid.uuid4().hex[:8]}", "role": "coordinator", "text": None, "pending": True,
            "routed_to": [w.id for w in routed], "categories": categories, "replies": {}, "at": now,
        }
        mission.chat += [question, answer]
        specs = [_ask(w, body.text, answer["id"], "coordinator") for w in routed]
        views = [_chat_view(mission, question), _chat_view(mission, answer)]
    _send_followups(mission_id, specs, background)
    return views


@app.get("/workers/{worker_id}/transcript", response_model=List[TranscriptEntry])
def get_transcript(worker_id: str) -> List[TranscriptEntry]:
    """Everything this worker was sent and replied (trusted coordinator view)."""
    with store.lock:
        worker = store.get_worker(worker_id)
        if worker is None:
            raise HTTPException(status_code=404, detail="worker not found")
        return [TranscriptEntry(**entry) for entry in worker.log]


@app.post("/workers/{worker_id}/messages", response_model=TranscriptEntry)
def message_worker(worker_id: str, body: MessageCreate, background: BackgroundTasks) -> TranscriptEntry:
    """Send one worker a follow-up. It answers from its own slice only."""
    with store.lock:
        worker = store.get_worker(worker_id)
        if worker is None:
            raise HTTPException(status_code=404, detail="worker not found")
        if worker.quarantined:
            raise HTTPException(status_code=409, detail="worker is quarantined; message its replacement")
        if worker.answering:
            raise HTTPException(status_code=409, detail="worker is already answering")
        if worker.status != WorkerStatus.COMPLETE:
            raise HTTPException(status_code=409, detail="worker has not finished its task yet")
        spec = _ask(worker, body.text, f"dm-{uuid.uuid4().hex[:8]}", "operator")
        entry = TranscriptEntry(**worker.log[-1])
        mission_id = worker.mission_id
    _send_followups(mission_id, [spec], background)
    return entry
