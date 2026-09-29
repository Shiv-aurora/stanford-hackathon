import io
import json
import threading

import pytest

from services import flower_runtime as rt
from services.flower_runtime import COMPLETE, FAILED, QUEUED, RUNNING, run_workers

SPECS = [
    {"id": "w1", "role": "literature", "task": "Summarise prior work", "allowed_context": ["paper-A"], "network_identity": "node-01"},
    {"id": "w2", "role": "data", "task": "Profile dataset", "allowed_context": ["dataset-schema"], "network_identity": "node-02"},
    {"id": "w3", "role": "eval", "task": "Design eval", "allowed_context": [], "network_identity": "node-03"},
    {"id": "w4", "role": "risk", "task": "List risks", "allowed_context": ["threat-model"], "network_identity": "node-04", "fail": True},
]


@pytest.fixture(autouse=True)
def no_model(monkeypatch):
    for k in ("FLWR_MODEL_API_ENDPOINT", "FLWR_MODEL_ID", "FLWR_MODEL_API_KEY", "CONSTELLATION_RUNTIME"):
        monkeypatch.delenv(k, raising=False)


def collect(**kwargs):
    events = []
    lock = threading.Lock()

    def on_update(r):
        with lock:
            events.append((r.worker_id, r.status))

    results = run_workers(SPECS, on_update=on_update, **kwargs)
    return results, events


def assert_results(results, events, runtime):
    by_id = {r.worker_id: r for r in results}
    assert [r.worker_id for r in results] == ["w1", "w2", "w3", "w4"]
    for wid in ("w1", "w2", "w3"):
        r = by_id[wid]
        assert r.status == COMPLETE and r.runtime == runtime and r.source == "seeded"
        assert r.history == [QUEUED, RUNNING, COMPLETE]
        assert [s for w, s in events if w == wid] == [QUEUED, RUNNING, COMPLETE]
    assert by_id["w4"].status == FAILED and "simulated" in by_id["w4"].error
    assert by_id["w4"].history == [QUEUED, RUNNING, FAILED]
    # Each worker only ever saw its own slice.
    assert "paper-A" in by_id["w1"].output and "dataset-schema" not in by_id["w1"].output
    assert "paper-A" not in by_id["w2"].output
    assert "no context" in by_id["w3"].output


@pytest.mark.skipif(not rt.flower_available(), reason="flwr[simulation] not installed")
def test_flower_path_runs_each_worker_on_its_own_node():
    results, events = collect(use_flower=True)
    assert_results(results, events, runtime="flower")
    assert len({r.node_id for r in results}) == len(SPECS)
    # Deterministic: same output as the local path.
    local = run_workers(SPECS, use_flower=False)
    assert [r.output for r in results] == [r.output for r in local]


@pytest.mark.skipif(not rt.flower_available(), reason="flwr[simulation] not installed")
def test_overlapping_flower_runs_do_not_deadlock():
    # A replacement dispatched while the mission's simulation is still running.
    results = {}

    def run(name, specs):
        results[name] = run_workers(specs, use_flower=True)

    first = threading.Thread(target=run, args=("mission", SPECS[:3]))
    first.start()
    run("replacement", [{**SPECS[0], "id": "w1-r1"}])
    first.join()
    assert [r.runtime for r in results["mission"] + results["replacement"]] == ["flower"] * 4
    assert all(r.status == COMPLETE for r in results["mission"] + results["replacement"])


def test_local_fallback_forced():
    results, events = collect(use_flower=False)
    assert_results(results, events, runtime="local")


def test_env_forces_local(monkeypatch):
    monkeypatch.setenv("CONSTELLATION_RUNTIME", "local")
    called = []
    monkeypatch.setattr(rt, "_run_flower", lambda *a: called.append(1))
    results = run_workers(SPECS[:1])
    assert not called and results[0].runtime == "local"


def test_falls_back_when_flower_breaks(monkeypatch):
    def boom(payloads, tracker):
        tracker.set("w1", RUNNING, runtime="flower", node_id="1")
        raise RuntimeError("ray exploded")

    monkeypatch.setattr(rt, "flower_available", lambda: True)
    monkeypatch.setattr(rt, "_run_flower", boom)
    results = run_workers(SPECS, use_flower=True)
    assert [r.status for r in results] == [COMPLETE, COMPLETE, COMPLETE, FAILED]
    assert all(r.runtime == "local" for r in results)


def test_empty_specs():
    assert run_workers([]) == []


def test_accepts_objects_and_defaults():
    class Spec:
        id = "x"
        role = "r"
        task = "t"
        allowed_context = ["c"]

    (r,) = run_workers([Spec()], use_flower=False)
    assert r.status == COMPLETE and r.network_identity == "node-01"


def test_model_call_uses_only_worker_slice(monkeypatch):
    monkeypatch.setenv("FLWR_MODEL_API_ENDPOINT", "https://example.invalid/v1/responses")
    monkeypatch.setenv("FLWR_MODEL_ID", "test-model")
    monkeypatch.setenv("FLWR_MODEL_API_KEY", "secret")
    sent = []

    def fake_urlopen(req, timeout):
        body = json.loads(req.data)
        sent.append(body)
        assert req.headers["Authorization"] == "Bearer secret"
        reply = {"output": [{"type": "reasoning"}, {"type": "message", "content": [{"type": "output_text", "text": "model says hi"}]}]}
        return io.BytesIO(json.dumps(reply).encode())

    monkeypatch.setattr(rt.urlrequest, "urlopen", fake_urlopen)
    results = run_workers(SPECS[:2], use_flower=False)
    assert [(r.output, r.source) for r in results] == [("model says hi", "model")] * 2
    prompts = {b["input"][1]["content"] for b in sent}
    assert any("paper-A" in p and "dataset-schema" not in p for p in prompts)
    assert all(b["model"] == "test-model" for b in sent)


def test_model_failure_falls_back_to_seeded(monkeypatch):
    monkeypatch.setenv("FLWR_MODEL_API_ENDPOINT", "https://example.invalid/v1/responses")
    monkeypatch.setenv("FLWR_MODEL_ID", "m")
    monkeypatch.setenv("FLWR_MODEL_API_KEY", "k")

    def fail(*a, **k):
        raise OSError("network down")

    monkeypatch.setattr(rt.urlrequest, "urlopen", fail)
    (r,) = run_workers(SPECS[:1], use_flower=False)
    assert r.status == COMPLETE and r.source == "seeded"


def test_payload_prefers_private_fragment_text():
    top_level_text = "TOP LEVEL MISSION TEXT"
    spec = {
        "id": "ctx",
        "role": "architecture",
        "task": "Review isolated router interface",
        "allowed_context": ["router_interface"],
        "context": {"router_interface": "Only this narrow router fragment."},
        "network_identity": "node-99",
        "top_level_text": top_level_text,
    }
    payload = rt._payload(spec, 0)
    assert payload["allowed_context"] == ["router_interface"]
    assert payload["context"] == ["Only this narrow router fragment."]
    assert top_level_text not in json.dumps(payload)
