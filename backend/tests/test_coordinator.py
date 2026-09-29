import os
import sys
from enum import Enum
from typing import List, Optional

import pytest
from pydantic import BaseModel, Field

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services import coordinator  # noqa: E402
from services.coordinator import (  # noqa: E402
    active_workers,
    approve,
    collect_outputs,
    is_valid,
    metrics,
    mission_status,
    progress,
    refresh_mission,
    synthesize,
)

SECRET = "LEAKED: full project context"


def worker(wid, role, status="complete", output=None, exposure=0.1, **extra):
    base = {
        "id": wid,
        "mission_id": "m-1",
        "role": role,
        "task": f"{role} task",
        "status": status,
        "allowed_context": [role],
        "blocked_context": ["full mission prompt"],
        "context_exposure": exposure,
        "tainted": False,
        "quarantined": False,
        "output": output if output is not None else (f"{role} findings" if status == "complete" else None),
        "network_identity": f"node-{wid[-2:]}",
        "replacement_for": None,
    }
    base.update(extra)
    return base


@pytest.fixture
def mixed():
    """w02 attacked and replaced by w05; w03 tainted with a late output; w04 still running."""
    return [
        worker("m-1-w01", "literature", exposure=0.10),
        worker("m-1-w02", "architecture", status="quarantined", output=None,
               tainted=True, quarantined=True, exposure=0.25),
        worker("m-1-w03", "optimizer", output=SECRET, tainted=True, exposure=0.15),
        worker("m-1-w04", "systems", status="running", exposure=0.20),
        worker("m-1-w05", "architecture", output="clean architecture review",
               replacement_for="m-1-w02", exposure=0.25),
    ]


# -- collection ---------------------------------------------------------------


def test_is_valid_rules():
    assert is_valid(worker("w01", "a"))
    assert not is_valid(worker("w01", "a", status="running"))
    assert not is_valid(worker("w01", "a", status="failed"))
    assert not is_valid(worker("w01", "a", tainted=True))
    assert not is_valid(worker("w01", "a", quarantined=True))
    assert not is_valid(worker("w01", "a", output="   "))


def test_collect_ignores_unsafe_and_accepts_replacement(mixed):
    ids = [w["id"] for w in collect_outputs(mixed)]
    # replacement takes the original's slot position (architecture before optimizer/systems)
    assert ids == ["m-1-w01", "m-1-w05"]


def test_quarantined_worker_with_late_output_is_ignored():
    late = worker("w01", "a", status="quarantined", output=SECRET, quarantined=True)
    # Status reset by a buggy late update must still not leak.
    reset = worker("w02", "b", status="complete", output=SECRET, quarantined=True)
    assert collect_outputs([late, reset]) == []
    assert SECRET not in synthesize([late, reset])


def test_replacement_chain_uses_latest_valid():
    chain = [
        worker("w01", "a", status="quarantined", output=None, quarantined=True, tainted=True),
        worker("w01-r1", "a", status="quarantined", output=None, quarantined=True, tainted=True,
               replacement_for="w01"),
        worker("w01-r2", "a", output="final a", replacement_for="w01-r1"),
        worker("w02", "b"),
    ]
    assert [w["id"] for w in collect_outputs(chain)] == ["w01-r2", "w02"]


def test_cyclic_replacement_does_not_hang():
    ws = [worker("x", "a", replacement_for="y"), worker("y", "b", replacement_for="x")]
    assert len(collect_outputs(ws)) <= 2


# -- progress + metrics -------------------------------------------------------


def test_progress_counts_active_only(mixed):
    # active: w01, w03, w04, w05 -> finished: w01, w03, w05
    assert [w["id"] for w in active_workers(mixed)] == ["m-1-w01", "m-1-w03", "m-1-w04", "m-1-w05"]
    assert progress(mixed) == 0.75


def test_progress_edges():
    assert progress([]) == 0.0
    assert progress([worker("w01", "a", status="queued")]) == 0.0
    assert progress([worker("w01", "a"), worker("w02", "b", status="failed")]) == 1.0
    assert 0.0 <= progress([worker("w01", "a", status="running"), worker("w02", "b")]) <= 1.0


def test_metrics(mixed):
    m = metrics(mixed)
    assert m["total_workers"] == 5
    assert m["completed_workers"] == 2
    assert m["quarantined_workers"] == 1
    assert m["max_context_exposure"] == 0.25
    assert m["replacement_workers"] == 1
    assert m["tainted_workers"] == 2
    assert m["running_workers"] == 1
    assert m["active_workers"] == 4
    assert m["progress"] == 0.75


def test_metrics_empty():
    m = metrics([])
    assert (m["total_workers"], m["completed_workers"], m["quarantined_workers"], m["max_context_exposure"]) == (0, 0, 0, 0.0)


# -- synthesis ----------------------------------------------------------------


def test_synthesis_is_deterministic_and_safe(mixed):
    out = synthesize(mixed)
    assert out == synthesize(list(mixed))
    assert "literature findings" in out
    assert "clean architecture review" in out
    assert "replacement for m-1-w02" in out
    assert SECRET not in out
    assert "Coverage: 2/4" in out
    assert "optimizer" in out and "systems" in out  # listed as missing
    assert "Excluded 2 quarantined/tainted" in out
    # one "- role: output" bullet per valid output (backend/main.py tests rely on this)
    assert out.count("\n- ") == len(collect_outputs(mixed)) == 2


def test_synthesis_with_no_valid_outputs():
    out = synthesize([worker("w01", "a", status="failed")])
    assert "No valid worker outputs" in out
    assert "Coverage: 0/1" in out


def test_synthesis_includes_prompt_only_when_given():
    assert "Mission:" not in synthesize([worker("w01", "a")])
    assert "Mission: secret goal" in synthesize([worker("w01", "a")], prompt="secret goal")


# -- mission state + approval -------------------------------------------------


def test_mission_status():
    assert mission_status([]) == "running"
    assert mission_status([worker("w01", "a", status="running")]) == "running"
    assert mission_status([worker("w01", "a"), worker("w02", "b", status="failed")]) == "complete"
    assert mission_status([worker("w01", "a", status="failed")]) == "failed"
    # a quarantined worker with no replacement yet does not block completion
    assert mission_status([worker("w01", "a"), worker("w02", "b", status="quarantined", quarantined=True)]) == "complete"


def test_refresh_and_approve_dict_mission(mixed):
    mission = {"id": "m-1", "prompt": "p", "status": "running", "progress": 0.0, "result": None, "approved": False}
    refresh_mission(mission, mixed)
    assert mission["status"] == "running" and mission["result"] is None and mission["progress"] == 0.75
    with pytest.raises(ValueError):
        approve(mission)

    mixed[3].update(status="complete", output="systems estimate")
    refresh_mission(mission, mixed)
    assert mission["status"] == "complete" and mission["progress"] == 1.0
    assert "systems estimate" in mission["result"] and SECRET not in mission["result"]

    approve(mission)
    assert mission["approved"] is True and mission["status"] == "approved"
    approve(mission)  # idempotent

    frozen = mission["result"]
    mixed.append(worker("m-1-w06", "late", status="running"))
    refresh_mission(mission, mixed)
    assert mission["status"] == "approved" and mission["result"] == frozen


# -- Pydantic + enum compatibility (mirrors CONTRACT.md shapes) ---------------


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
    context_exposure: float = 0.0
    tainted: bool = False
    quarantined: bool = False
    output: Optional[str] = None
    network_identity: str = ""
    replacement_for: Optional[str] = None


class Mission(BaseModel):
    id: str
    prompt: str
    status: MissionStatus = MissionStatus.CREATED
    worker_ids: List[str] = Field(default_factory=list)
    progress: float = 0.0
    result: Optional[str] = None
    approved: bool = False


class MissionMetrics(BaseModel):
    total_workers: int
    completed_workers: int
    quarantined_workers: int
    max_context_exposure: float


def test_pydantic_workers_and_mission(mixed):
    workers = [Worker(**w) for w in mixed]
    workers[3].status = WorkerStatus.COMPLETE
    workers[3].output = "systems estimate"
    mission = Mission(id="m-1", prompt="p", status=MissionStatus.RUNNING)

    refresh_mission(mission, workers)
    assert mission.status is MissionStatus.COMPLETE
    assert mission.progress == 1.0
    assert SECRET not in mission.result

    approve(mission)
    assert mission.status is MissionStatus.APPROVED and mission.approved

    # metrics() output validates against the API's MissionMetrics model
    m = MissionMetrics.model_validate(metrics(workers))
    assert (m.total_workers, m.completed_workers, m.quarantined_workers, m.max_context_exposure) == (5, 3, 1, 0.25)


def test_api_wiring_names_exist():
    # backend/main.py loads these names from services.coordinator
    for name in ("synthesize", "progress", "metrics"):
        assert callable(getattr(coordinator, name))
