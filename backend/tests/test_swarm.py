"""Trusted coordinator runs the whole mission (services.swarm)."""

import threading
import time

import pytest
from fastapi.testclient import TestClient

import main as api_main
from services import swarm as swarm_mod
from services.flower_app import StandaloneMission
from services.flower_runtime import flower_available
from services.swarm import LocalTransport, Swarm
from state import store

PROMPT = "Confidential: design a sparse MoE router for our unreleased 1B model."


def _start_local() -> Swarm:
    swarm = Swarm()
    threading.Thread(target=swarm.run, args=(LocalTransport,), daemon=True).start()
    assert swarm.ready.wait(5) and swarm.alive
    return swarm


def _wait(predicate, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("timed out")


def test_coordinator_runs_mission_and_contains_attack():
    swarm = _start_local()
    try:
        mission = StandaloneMission(PROMPT)
        specs = swarm.submit_mission("m1", mission).result(5)
        assert 6 <= len(specs) <= 10
        target = specs[0]["id"]
        event = swarm.attack("m1", target).result(5)
        assert target in event["message"]
        _wait(lambda: mission.result is not None)
    finally:
        swarm.stop()

    workers = mission.workers
    bad = workers[target]
    assert bad["quarantined"] and bad["output"] is None  # late reply dropped
    (rep,) = [w for w in workers.values() if w["replacement_for"] == target]
    assert rep["status"] == "complete"
    assert all(w["status"] == "complete" for w in workers.values() if w is not bad)
    assert "Excluded 1 quarantined" in mission.result
    assert f"Coverage: {len(specs)}/{len(specs)}" in mission.result


def test_api_delegates_mission_and_attack_to_coordinator(monkeypatch):
    swarm = _start_local()
    monkeypatch.setattr(api_main, "get_swarm", lambda: swarm)
    store.reset()
    client = TestClient(api_main.app)
    try:
        mission = client.post("/mission", json={"prompt": PROMPT}).json()
        assert swarm.has_mission(mission["id"])
        assert mission["worker_ids"]
        get = lambda: client.get(f"/mission/{mission['id']}").json()
        _wait(lambda: get()["status"] == "complete")

        target = mission["worker_ids"][0]
        body = client.post(f"/workers/{target}/attack").json()
        rep = body["replacement"]
        assert body["quarantined"]["quarantined"] and rep["replacement_for"] == target
        _wait(lambda: get()["status"] == "complete")
        workers = {w["id"]: w for w in client.get(f"/mission/{mission['id']}/workers").json()}
        assert workers[rep["id"]]["status"] == "complete"
        assert get()["result"]
        assert client.post(f"/workers/{target}/attack").status_code == 409
    finally:
        swarm.stop()


@pytest.mark.skipif(not flower_available(), reason="flwr[simulation] not installed")
def test_coordinator_runs_inside_flower_serverapp(monkeypatch):
    monkeypatch.setattr(swarm_mod, "NUM_NODES", 4)
    swarm = swarm_mod.get_swarm(use_flower=True)
    try:
        assert swarm.runtime == "flower"
        mission = StandaloneMission(PROMPT)
        specs = swarm.submit_mission("m-flower", mission).result(30)
        _wait(lambda: mission.result is not None, timeout=60)
        assert all(w["status"] == "complete" for w in mission.workers.values())
        assert f"Coverage: {len(specs)}/{len(specs)}" in mission.result
    finally:
        swarm_mod.shutdown_swarm()
    assert not swarm.alive
