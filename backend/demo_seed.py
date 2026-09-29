"""Deterministic stand-ins for the decomposer, runtime, security, and coordinator.

These exist only so the API branch runs by itself. main.py prefers the real
subsystem modules under services/ when they are importable.
"""

import time
from typing import Any, Callable, Dict, Iterable, List, Optional

from models import MissionMetrics, Worker, WorkerStatus

# role, task, allowed_context, context_exposure
_AI_RESEARCH_SLICES = [
    ("literature", "Summarize recent public work on sparse mixture-of-experts routing.",
     ["public arXiv abstracts"], 0.10),
    ("architecture", "Propose two candidate router layer designs.",
     ["router layer interface spec"], 0.20),
    ("optimizer", "Recommend a learning-rate schedule for a 1B-parameter run.",
     ["model size", "token budget"], 0.15),
    ("data-analysis", "Characterize token-length distribution of the training shard sample.",
     ["anonymized shard statistics"], 0.20),
    ("systems", "Estimate GPU memory and throughput for the proposed batch size.",
     ["hardware profile", "batch size"], 0.15),
    ("benchmark", "Select three public benchmarks relevant to reasoning quality.",
     ["public benchmark list"], 0.10),
    ("evaluation", "Draft an evaluation protocol with ablation checkpoints.",
     ["checkpoint cadence"], 0.20),
    ("reviewer", "Review the evaluation protocol for statistical pitfalls.",
     ["evaluation protocol draft"], 0.25),
]

_BLOCKED = ["full mission prompt", "proprietary dataset", "other workers' outputs"]


def decompose_mission(prompt: str) -> List[Dict[str, Any]]:
    """Fallback decomposer: fixed AI-research slices; never copies the prompt into workers."""
    specs = []
    for i, (role, task, allowed, exposure) in enumerate(_AI_RESEARCH_SLICES, start=1):
        specs.append({
            "role": role,
            "task": task,
            "allowed_context": list(allowed),
            "blocked_context": list(_BLOCKED),
            "context_exposure": exposure,
            "network_identity": f"node-{i:02d}",
        })
    return specs


def run_workers(
    worker_specs: Iterable[Any],
    on_update: Optional[Callable[[Dict[str, Any]], None]] = None,
    delay: float = 0.0,
) -> List[Dict[str, Any]]:
    """Fallback runtime: sequential, seeded outputs, queued -> running -> complete."""
    results = []
    for spec in worker_specs:
        worker_id = spec["id"]
        if on_update:
            on_update({"worker_id": worker_id, "status": "running", "started_at": time.time()})
        if delay:
            time.sleep(delay)
        result = {
            "worker_id": worker_id,
            "status": "complete",
            "output": f"[{spec['role']}] seeded result for: {spec['task']}",
            "finished_at": time.time(),
        }
        if on_update:
            on_update(result)
        results.append(result)
    return results


def quarantine_and_replace(worker: Worker, replacement_id: str, network_identity: str) -> Dict[str, Any]:
    """Fallback security: taint + quarantine the worker, discard output, clone its narrow slice."""
    quarantined = worker.model_copy(update={
        "status": WorkerStatus.QUARANTINED,
        "tainted": True,
        "quarantined": True,
        "output": None,
        "finished_at": time.time(),
    })
    replacement = Worker(
        id=replacement_id,
        mission_id=worker.mission_id,
        role=worker.role,
        task=worker.task,
        allowed_context=list(worker.allowed_context),
        blocked_context=list(worker.blocked_context),
        context_exposure=worker.context_exposure,
        network_identity=network_identity,
        replacement_for=worker.id,
    )
    detail = (
        f"Simulated prompt injection detected on {worker.id} ({worker.network_identity}); "
        f"output invalidated, replacement {replacement_id} spawned on {network_identity}."
    )
    return {"quarantined": quarantined, "replacement": replacement, "detail": detail}


def _is_valid(worker: Worker) -> bool:
    return worker.status == WorkerStatus.COMPLETE and not worker.tainted and not worker.quarantined


def synthesize(workers: List[Worker]) -> str:
    """Fallback coordinator synthesis: concatenate valid outputs in worker order."""
    lines = [f"- {w.role}: {w.output}" for w in workers if _is_valid(w) and w.output]
    return "Constellation mission synthesis\n" + "\n".join(lines)


def active_workers(workers: List[Worker]) -> List[Worker]:
    return [w for w in workers if w.status not in (WorkerStatus.QUARANTINED, WorkerStatus.REPLACED)]


def progress(workers: List[Worker]) -> float:
    active = active_workers(workers)
    if not active:
        return 0.0
    done = sum(1 for w in active if w.status in (WorkerStatus.COMPLETE, WorkerStatus.FAILED))
    return round(done / len(active), 4)


def metrics(workers: List[Worker]) -> MissionMetrics:
    return MissionMetrics(
        total_workers=len(workers),
        completed_workers=sum(1 for w in workers if _is_valid(w)),
        quarantined_workers=sum(1 for w in workers if w.quarantined),
        max_context_exposure=max((w.context_exposure for w in workers), default=0.0),
    )
