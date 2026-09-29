import copy
from dataclasses import dataclass, field

from pydantic import BaseModel

from services.security import (
    DEFAULT_ATTACK,
    attack_worker,
    create_replacement,
    detect_injection,
)


def make_workers():
    roles = [
        ("literature", ["paper-A"], ["dataset-schema", "threat-model"]),
        ("data", ["dataset-schema"], ["paper-A", "threat-model"]),
        ("eval", ["eval-metrics"], ["paper-A"]),
        ("risk", ["threat-model"], ["dataset-schema"]),
    ]
    return [
        {
            "id": f"w{i + 1}",
            "mission_id": "m1",
            "role": role,
            "task": f"{role} task",
            "status": "complete",
            "allowed_context": allowed,
            "blocked_context": blocked,
            "context_exposure": 0.125,
            "tainted": False,
            "quarantined": False,
            "output": f"{role} findings",
            "network_identity": f"node-{i + 1:02d}",
            "replacement_for": None,
        }
        for i, (role, allowed, blocked) in enumerate(roles)
    ]


def test_detects_obvious_injection_but_not_normal_text():
    assert {"instruction_override", "context_exfiltration", "external_url"} <= set(detect_injection(DEFAULT_ATTACK))
    assert detect_injection("Summarise the related work on sparse attention.") == []
    assert detect_injection(None) == []


def test_attack_quarantines_replaces_and_leaves_others_untouched():
    workers = make_workers()
    target, others = workers[1], [workers[0], *workers[2:]]
    before = copy.deepcopy(others)

    event, replacement = attack_worker(target, workers)

    # compromised worker: tainted, quarantined, output invalidated
    assert target["tainted"] is True
    assert target["quarantined"] is True
    assert target["status"] == "quarantined"
    assert target["output"] is None

    # clean replacement with the same narrow task/context and a new identity
    assert replacement["replacement_for"] == "w2"
    assert replacement["id"] == "w2-r1"
    assert replacement["status"] == "queued"
    assert replacement["tainted"] is False and replacement["quarantined"] is False
    assert replacement["output"] is None
    assert (replacement["role"], replacement["task"]) == (target["role"], target["task"])
    assert replacement["allowed_context"] == target["allowed_context"]
    assert replacement["allowed_context"] is not target["allowed_context"]
    assert replacement["network_identity"] == "node-05"
    assert replacement["network_identity"] not in {w["network_identity"] for w in workers}

    # core invariant: unrelated workers are unchanged
    assert others == before

    # event payload the API/UI can display
    assert event["worker_id"] == "w2"
    assert event["replacement_id"] == "w2-r1"
    assert event["output_invalidated"] is True
    assert event["had_output"] is True
    assert event["exposed_context"] == ["dataset-schema"]
    assert event["old_network_identity"] == "node-02"
    assert event["replacement_network_identity"] == "node-05"
    assert event["detected_patterns"]


def test_attack_can_be_forced_or_skipped_when_nothing_detected():
    workers = make_workers()
    event, replacement = attack_worker(workers[0], workers, payload="hello", force=False)
    assert replacement is None and event["quarantined"] is False
    assert workers[0]["status"] == "complete" and workers[0]["output"] == "literature findings"

    event, replacement = attack_worker(workers[0], workers, payload="hello")
    assert replacement is not None and workers[0]["status"] == "quarantined"


def test_repeated_replacements_get_unique_ids_and_identities():
    workers = make_workers()
    _, r1 = attack_worker(workers[0], workers)
    workers.append(r1)
    _, r2 = attack_worker(r1, workers)
    assert r2["id"] == "w1-r2"
    assert r2["replacement_for"] == "w1-r1"
    assert r2["network_identity"] == "node-06"


class PydWorker(BaseModel):
    id: str
    mission_id: str
    role: str
    task: str
    status: str = "running"
    allowed_context: list[str] = []
    blocked_context: list[str] = []
    context_exposure: float = 0.0
    tainted: bool = False
    quarantined: bool = False
    output: str | None = None
    network_identity: str = "node-01"
    replacement_for: str | None = None


@dataclass
class DcWorker:
    id: str
    mission_id: str
    role: str
    task: str
    status: str = "running"
    allowed_context: list[str] = field(default_factory=list)
    blocked_context: list[str] = field(default_factory=list)
    tainted: bool = False
    quarantined: bool = False
    output: str | None = None
    network_identity: str = "node-01"
    replacement_for: str | None = None


def test_works_with_pydantic_and_dataclass_workers():
    for cls in (PydWorker, DcWorker):
        target = cls(id="w1", mission_id="m1", role="data", task="t", allowed_context=["a"], output="x")
        other = cls(id="w2", mission_id="m1", role="eval", task="u", allowed_context=["b"], network_identity="node-02")
        other_before = copy.deepcopy(other)

        event, replacement = attack_worker(target, [target, other])

        assert isinstance(replacement, cls)
        assert target.status == "quarantined" and target.tainted and target.output is None
        assert replacement.replacement_for == "w1" and replacement.network_identity == "node-03"
        assert replacement.allowed_context == ["a"] and replacement.allowed_context is not target.allowed_context
        assert other == other_before
        assert event["replacement_id"] == "w1-r1"


def test_create_replacement_does_not_carry_taint():
    w = make_workers()[0]
    w.update(tainted=True, quarantined=True, status="quarantined", output=None)
    r = create_replacement(w, [w])
    assert (r["tainted"], r["quarantined"], r["status"]) == (False, False, "queued")
