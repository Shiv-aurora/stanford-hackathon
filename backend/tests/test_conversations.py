"""Coordinator chat, worker transcripts and follow-up messages."""

import threading
import time

import pytest
from fastapi.testclient import TestClient

import main as api_main
from services import decomposer
from services.decomposer import DEFENSE_DEMO_MISSION
from services.swarm import LocalTransport, Swarm
from state import store


def _wait(predicate, timeout=10):
    deadline = time.time() + timeout
    while time.time() < deadline:
        if predicate():
            return
        time.sleep(0.02)
    raise AssertionError("timed out")


@pytest.fixture(params=["fallback", "coordinator"])
def client(request, monkeypatch):
    """Run every test without the coordinator service and through it."""
    # conftest forces the demo_seed stand-ins; use the real lab split and router.
    monkeypatch.setattr(api_main, "decompose_mission", decomposer.decompose_mission)
    monkeypatch.setattr(api_main, "route_question", decomposer.route_question)
    swarm = None
    if request.param == "coordinator":
        swarm = Swarm()
        threading.Thread(target=swarm.run, args=(LocalTransport,), daemon=True).start()
        assert swarm.ready.wait(5) and swarm.alive
        monkeypatch.setattr(api_main, "get_swarm", lambda: swarm)
    else:
        monkeypatch.setattr(api_main, "get_swarm", None)
    store.reset()
    yield TestClient(api_main.app)
    if swarm is not None:
        swarm.stop()


def _mission(client):
    m = client.post("/mission", json={"prompt": DEFENSE_DEMO_MISSION, "lab": "defense"}).json()
    _wait(lambda: client.get(f"/mission/{m['id']}").json()["status"] == "complete")
    workers = client.get(f"/mission/{m['id']}/workers").json()
    return m, {w["role"]: w for w in workers}


def _transcript(client, worker_id):
    return client.get(f"/workers/{worker_id}/transcript").json()


def test_transcript_shows_exact_dispatch_and_reply(client):
    _, workers = _mission(client)
    legal = workers["legal_review"]
    log = _transcript(client, legal["id"])
    assert [e["kind"] for e in log] == ["dispatch", "reply"]
    sent = log[0]
    assert sent["text"] == legal["task"]
    assert list(sent["context"]) == ["rules_of_engagement"]
    assert "human authorization" in sent["context"]["rules_of_engagement"]
    # Only its own slice: nothing from other compartments or the objective.
    assert "Bastion" not in str(sent) and "Intelligence" not in str(sent)
    assert log[1]["text"] == legal["output"]


def test_message_worker_replies_without_touching_task_output(client):
    m, workers = _mission(client)
    w = workers["sensor_engineer"]
    entry = client.post(f"/workers/{w['id']}/messages", json={"text": "Which radar covers the east?"}).json()
    assert entry["kind"] == "operator"
    _wait(lambda: _transcript(client, w["id"])[-1]["kind"] == "reply")
    reply = _transcript(client, w["id"])[-1]
    assert reply["message_id"] == entry["message_id"]
    after = {x["id"]: x for x in client.get(f"/mission/{m['id']}/workers").json()}[w["id"]]
    assert after["output"] == w["output"] and not after["answering"]
    assert client.get(f"/mission/{m['id']}").json()["status"] == "complete"


def test_coordinator_chat_routes_on_need_to_know(client):
    m, workers = _mission(client)
    chat = client.get(f"/mission/{m['id']}/messages").json()
    assert [c["role"] for c in chat] == ["user", "coordinator"]
    assert chat[0]["text"] == DEFENSE_DEMO_MISSION
    assert chat[1]["text"] == client.get(f"/mission/{m['id']}").json()["result"]

    q, a = client.post(f"/mission/{m['id']}/messages", json={"text": "Are the jammers enough against the swarm?"}).json()
    assert q["role"] == "user" and a["pending"]
    asked = {w_id for w_id in a["routed_to"]}
    expected = {w["id"] for w in workers.values() if {"effectors", "threat_assessment"} & set(w["allowed_context"])}
    assert asked == expected and len(asked) < len(workers)

    _wait(lambda: not client.get(f"/mission/{m['id']}/messages").json()[-1]["pending"])
    answer = client.get(f"/mission/{m['id']}/messages").json()[-1]
    assert answer["text"].startswith(f"Asked {len(asked)} of {len(workers)} workers")
    # Workers that were not asked never saw the question.
    for w in workers.values():
        kinds = [e["kind"] for e in _transcript(client, w["id"])]
        assert ("coordinator" in kinds) == (w["id"] in asked)


def test_unmatched_question_asks_every_worker(client):
    m, workers = _mission(client)
    _, a = client.post(f"/mission/{m['id']}/messages", json={"text": "Summarise everything."}).json()
    assert len(a["routed_to"]) == len(workers) and a["categories"] == []


def test_quarantined_worker_transcript_and_replacement(client):
    m, workers = _mission(client)
    target = workers["red_team"]["id"]
    rep = client.post(f"/workers/{target}/attack").json()["replacement"]
    assert [e["kind"] for e in _transcript(client, target)][-2:] == ["attack", "security"]
    assert client.post(f"/workers/{target}/messages", json={"text": "hi"}).status_code == 409
    rep_log = _transcript(client, rep["id"])
    assert rep_log[0]["kind"] == "dispatch" and rep_log[0]["note"] == f"Replacement for {target}"
    assert rep_log[0]["context"] == _transcript(client, target)[0]["context"]


def test_chat_requires_finished_mission(client):
    m = client.post("/mission", json={"prompt": DEFENSE_DEMO_MISSION, "lab": "defense"}).json()
    with store.lock:
        store.missions[m["id"]].status = api_main.MissionStatus.RUNNING
    assert client.post(f"/mission/{m['id']}/messages", json={"text": "status?"}).status_code == 409
    assert client.post(f"/mission/{m['id']}/messages", json={"text": ""}).status_code == 422
