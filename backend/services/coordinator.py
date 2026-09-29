"""Trusted local coordinator for Constellation.

The coordinator is the only component that sees every worker's output, and the
only one that reconstructs the combined mission result. Nothing it produces is
sent back into ordinary workers.

    collect_outputs(workers)  -> valid outputs, one per task slot
    progress(workers)         -> 0.0..1.0 over active workers
    metrics(workers)          -> basic swarm metrics
    synthesize(workers)       -> deterministic final result
    refresh_mission(m, ws)    -> update mission progress/status/result
    approve(mission)          -> human approval of a completed mission

An output is valid only if its worker is `complete`, not tainted, not
quarantined, and actually produced text. Quarantined or tainted outputs are
never used, even if a late result slipped through. A replacement worker's
output fills the task slot of the worker it replaced.

Workers and missions may be dicts, dataclasses or Pydantic models with the
CONTRACT.md fields; statuses may be enums or plain strings.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Iterable

QUEUED = "queued"
RUNNING = "running"
COMPLETE = "complete"
FAILED = "failed"
QUARANTINED = "quarantined"
REPLACED = "replaced"

MISSION_RUNNING = "running"
MISSION_COMPLETE = "complete"
MISSION_APPROVED = "approved"
MISSION_FAILED = "failed"

INACTIVE = (QUARANTINED, REPLACED)
FINISHED = (COMPLETE, FAILED)

__all__ = [
    "is_valid",
    "active_workers",
    "collect_outputs",
    "progress",
    "metrics",
    "synthesize",
    "mission_status",
    "refresh_mission",
    "approve",
]


# ---------------------------------------------------------------------------
# Field access (dict / dataclass / Pydantic)
# ---------------------------------------------------------------------------


def _get(obj: Any, key: str, default: Any = None) -> Any:
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _set(obj: Any, **fields: Any) -> None:
    for key, value in fields.items():
        if isinstance(obj, dict):
            obj[key] = value
        else:
            setattr(obj, key, value)


def _status(obj: Any) -> str:
    status = _get(obj, "status")
    return str(getattr(status, "value", status) or "")


def _coerce_status(obj: Any, value: str) -> Any:
    """Keep the caller's status type: an enum field stays an enum."""
    current = _get(obj, "status")
    if isinstance(current, Enum):
        return type(current)(value)
    return value


# ---------------------------------------------------------------------------
# Collection
# ---------------------------------------------------------------------------


def is_valid(worker: Any) -> bool:
    """True if this worker's output may be used in the final synthesis."""
    output = _get(worker, "output")
    return (
        _status(worker) == COMPLETE
        and not _get(worker, "tainted", False)
        and not _get(worker, "quarantined", False)
        and isinstance(output, str)
        and bool(output.strip())
    )


def active_workers(workers: Iterable[Any]) -> list[Any]:
    """Workers still counted toward the mission (not quarantined or replaced)."""
    return [
        w for w in workers
        if _status(w) not in INACTIVE and not _get(w, "quarantined", False)
    ]


def _slots(workers: list[Any]) -> dict[str, str]:
    """Map each worker id to the id of the original worker whose task slot it fills."""
    by_id = {_get(w, "id"): w for w in workers}
    roots: dict[str, str] = {}
    for w in workers:
        root = _get(w, "id")
        seen = {root}
        while (parent := _get(by_id.get(root), "replacement_for")) and parent not in seen:
            seen.add(parent)
            root = parent
        roots[_get(w, "id")] = root
    return roots


def collect_outputs(workers: Iterable[Any]) -> list[Any]:
    """Valid workers, one per task slot, in original slot order.

    A replacement takes its original's position. If a slot somehow has more
    than one valid worker, the latest in the replacement chain wins.
    """
    workers = list(workers)
    roots = _slots(workers)
    order: dict[str, int] = {}
    chosen: dict[str, Any] = {}
    for w in workers:
        root = roots[_get(w, "id")]
        order.setdefault(root, len(order))
        if is_valid(w):
            chosen[root] = w  # later entries are later replacements
    return [chosen[root] for root in sorted(chosen, key=order.__getitem__)]


# ---------------------------------------------------------------------------
# Progress + metrics
# ---------------------------------------------------------------------------


def progress(workers: Iterable[Any]) -> float:
    """Fraction of active workers that have finished (complete or failed)."""
    active = active_workers(workers)
    if not active:
        return 0.0
    done = sum(1 for w in active if _status(w) in FINISHED)
    return round(done / len(active), 4)


def metrics(workers: Iterable[Any]) -> dict[str, Any]:
    """Basic swarm metrics. The first four keys are the contract's MissionMetrics."""
    workers = list(workers)
    statuses = [_status(w) for w in workers]
    exposures = [float(_get(w, "context_exposure", 0.0) or 0.0) for w in workers]
    return {
        "total_workers": len(workers),
        "completed_workers": sum(1 for w in workers if is_valid(w)),
        "quarantined_workers": sum(
            1 for w, s in zip(workers, statuses) if _get(w, "quarantined", False) or s == QUARANTINED
        ),
        "max_context_exposure": round(max(exposures, default=0.0), 4),
        "active_workers": len(active_workers(workers)),
        "running_workers": statuses.count(RUNNING),
        "queued_workers": statuses.count(QUEUED),
        "failed_workers": statuses.count(FAILED),
        "replacement_workers": sum(1 for w in workers if _get(w, "replacement_for")),
        "tainted_workers": sum(1 for w in workers if _get(w, "tainted", False)),
        "mean_context_exposure": round(sum(exposures) / len(exposures), 4) if exposures else 0.0,
        "progress": progress(workers),
    }


# ---------------------------------------------------------------------------
# Synthesis
# ---------------------------------------------------------------------------


def synthesize(workers: Iterable[Any], prompt: str | None = None) -> str:
    """Deterministically combine valid outputs into one final result.

    Quarantined/tainted outputs are excluded and only counted, never quoted.
    `prompt` is optional; the coordinator is trusted to see it.
    """
    workers = list(workers)
    valid = collect_outputs(workers)
    roots = _slots(workers)
    slot_roles: dict[str, Any] = {}
    for w in workers:
        slot_roles.setdefault(roots[_get(w, "id")], _get(w, "role"))
    covered = {roots[_get(w, "id")] for w in valid}
    missing = [role for root, role in slot_roles.items() if root not in covered]
    excluded = sum(
        1 for w in workers if _get(w, "tainted", False) or _get(w, "quarantined", False)
    )

    lines = ["Constellation mission synthesis"]
    if prompt:
        lines.append(f"Mission: {prompt.strip()}")
    for w in valid:
        note = f" (replacement for {_get(w, 'replacement_for')})" if _get(w, "replacement_for") else ""
        output = "\n  ".join(str(_get(w, "output")).strip().splitlines())
        lines.append(f"- {_get(w, 'role')}{note}: {output}")
    if not valid:
        lines.append("No valid worker outputs are available yet.")
    lines.append("")
    lines.append(f"Coverage: {len(covered)}/{len(slot_roles)} tasks with valid outputs.")
    if missing:
        lines.append("Missing: " + ", ".join(str(role) for role in missing) + ".")
    if excluded:
        lines.append(f"Excluded {excluded} quarantined/tainted output(s); they were not used.")
    return "\n".join(lines).rstrip()


# ---------------------------------------------------------------------------
# Mission state
# ---------------------------------------------------------------------------


def mission_status(workers: Iterable[Any]) -> str:
    """`running` until every active worker finishes; then `complete` or `failed`."""
    active = active_workers(workers)
    if not active or any(_status(w) not in FINISHED for w in active):
        return MISSION_RUNNING
    return MISSION_COMPLETE if any(_status(w) == COMPLETE for w in active) else MISSION_FAILED


def refresh_mission(mission: Any, workers: Iterable[Any]) -> Any:
    """Update `mission` progress/status/result in place. Approved missions are frozen."""
    if _status(mission) == MISSION_APPROVED or _get(mission, "approved", False):
        return mission
    workers = list(workers)
    status = mission_status(workers)
    result = synthesize(workers, _get(mission, "prompt")) if status == MISSION_COMPLETE else None
    _set(
        mission,
        progress=progress(workers),
        status=_coerce_status(mission, status),
        result=result,
    )
    return mission


def approve(mission: Any) -> Any:
    """Record human approval. Only a completed mission with a result can be approved."""
    if _status(mission) == MISSION_APPROVED:
        return mission
    if _status(mission) != MISSION_COMPLETE or not _get(mission, "result"):
        raise ValueError("mission must be complete with a result before approval")
    _set(mission, approved=True, status=_coerce_status(mission, MISSION_APPROVED))
    return mission
