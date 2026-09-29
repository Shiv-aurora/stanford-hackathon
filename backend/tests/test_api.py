import pytest
from fastapi.testclient import TestClient

import main as api_main
from main import app
from models import Mission
from state import store

PROMPT = "Confidential: design a sparse MoE router for our unreleased 1B model."


@pytest.fixture
def client():
    store.reset()
    return TestClient(app)


def _create(client):
    resp = client.post("/mission", json={"prompt": PROMPT})
    assert resp.status_code == 200
    return resp.json()


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_create_and_read_mission(client):
    mission = _create(client)
    assert 6 <= len(mission["worker_ids"]) <= 10

    fetched = client.get(f"/mission/{mission['id']}").json()
    assert fetched["status"] == "complete"
    assert fetched["progress"] == 1.0
    assert fetched["result"]


def test_empty_prompt_rejected(client):
    assert client.post("/mission", json={"prompt": ""}).status_code == 422


def test_unknown_ids_404(client):
    assert client.get("/mission/nope").status_code == 404
    assert client.get("/mission/nope/workers").status_code == 404
    assert client.get("/mission/nope/result").status_code == 404
    assert client.post("/mission/nope/approve").status_code == 404
    assert client.post("/workers/nope/attack").status_code == 404


def test_workers_are_compartmentalized(client):
    mission = _create(client)
    workers = client.get(f"/mission/{mission['id']}/workers").json()
    identities = {w["network_identity"] for w in workers}
    assert len(identities) == len(workers)
    for w in workers:
        assert w["mission_id"] == mission["id"]
        assert w["status"] == "complete"
        assert 0.0 <= w["context_exposure"] <= 1.0
        assert PROMPT not in w["task"]
        assert PROMPT not in w["allowed_context"]
        assert PROMPT not in (w["output"] or "")


def test_attack_quarantines_and_replaces(client):
    assert api_main.security_attack is not None
    assert api_main.security_attack.__module__ == "services.security"
    mission = _create(client)
    target = mission["worker_ids"][2]
    before = {w["id"]: w for w in client.get(f"/mission/{mission['id']}/workers").json()}

    resp = client.post(f"/workers/{target}/attack")
    assert resp.status_code == 200
    body = resp.json()
    bad, rep = body["quarantined"], body["replacement"]
    assert bad["status"] == "quarantined" and bad["tainted"] and bad["quarantined"]
    assert bad["output"] is None
    assert rep["replacement_for"] == target
    assert rep["task"] == bad["task"]
    assert rep["allowed_context"] == bad["allowed_context"]
    assert rep["network_identity"] != bad["network_identity"]
    assert rep["status"] == "queued"
    assert rep["started_at"] is None and rep["finished_at"] is None
    assert body["event"]["worker_id"] == target
    assert "Prompt injection" in body["event"]["detail"]

    workers = {w["id"]: w for w in client.get(f"/mission/{mission['id']}/workers").json()}
    assert workers[rep["id"]]["status"] == "complete"
    # Unrelated workers are untouched.
    for wid, w in before.items():
        if wid != target:
            assert workers[wid] == w

    result = client.get(f"/mission/{mission['id']}/result").json()
    assert result["status"] == "complete"
    assert result["metrics"]["quarantined_workers"] == 1
    assert result["metrics"]["total_workers"] == len(before) + 1
    assert result["metrics"]["completed_workers"] == len(before)
    assert result["result"].count("\n- ") == len(before)

    assert client.post(f"/workers/{target}/attack").status_code == 409


def test_approve_flow(client):
    mission = _create(client)
    resp = client.post(f"/mission/{mission['id']}/approve")
    assert resp.status_code == 200
    assert resp.json()["approved"] is True
    assert resp.json()["status"] == "approved"
    assert client.post(f"/workers/{mission['worker_ids'][0]}/attack").status_code == 409


def test_approve_requires_complete(client):
    mission = store.add_mission(Mission(id="m-pending", prompt=PROMPT))
    assert client.post(f"/mission/{mission.id}/approve").status_code == 409


def test_cors_enabled(client):
    resp = client.options(
        "/health",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "GET"},
    )
    assert resp.headers.get("access-control-allow-origin") in ("*", "http://localhost:5173")
