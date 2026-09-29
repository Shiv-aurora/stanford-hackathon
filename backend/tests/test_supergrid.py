import base64
import io
import json
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from fastapi.testclient import TestClient

import main
from models import Mission, MissionStatus, Worker
from services.remote_protocol import ANNOUNCEMENT, SignedBridge, signing_bytes, validate_bridge_url
from services.supergrid import Session, Snapshot, SuperGrid, supergrid
from state import store


@pytest.fixture
def bridge(monkeypatch):
    store.reset()
    supergrid.sessions.clear()
    monkeypatch.setattr(main, 'FORCE_FALLBACK', False)
    monkeypatch.setenv('CONSTELLATION_RUNTIME', 'supergrid')
    mission = store.add_mission(Mission(id='m-test', prompt='PRIVATE MISSION', runtime='supergrid'))
    signer = SignedBridge('https://bridge.example', mission.id, '123')
    session = Session(mission.id, public_key=signer.key.public_key(), run_id='123')
    supergrid.sessions[mission.id] = session
    return TestClient(main.app), mission, signer, session


def signed(client, signer, action, value, headers=None):
    path = f'/internal/supergrid/{signer.mission_id}/{action}'
    raw = json.dumps(value).encode()
    import uuid
    stamp, nonce = str(int(time.time())), uuid.uuid4().hex
    signature = signer.key.sign(signing_bytes('POST', path, stamp, nonce, raw))
    h = {'content-type': 'application/json', 'x-constellation-time': stamp,
         'x-constellation-nonce': nonce, 'x-constellation-signature': base64.b64encode(signature).decode()}
    h.update(headers or {})
    return client.post(path, content=raw, headers=h)


def worker(wid='w1', node='101', **kw):
    return Worker(id=wid, mission_id='m-test', role='review', task='review slice',
                  node_id=node, network_identity=f'supernode-{node}', status='complete',
                  output='reviewed', **kw).model_dump(mode='json')


def snapshot(workers=None, **kw):
    return {'workers': workers if workers is not None else [worker()],
            'status': 'complete', 'result': 'valid synthesis', **kw}


def test_unsigned_and_wrong_key_cannot_read_mission(bridge):
    client, mission, signer, _ = bridge
    path = f'/internal/supergrid/{mission.id}/session'
    assert client.post(path, json={}).status_code == 403
    wrong = SignedBridge('https://bridge.example', mission.id, '123')
    assert signed(client, wrong, 'session', {}).status_code == 403
    assert signed(client, signer, 'session', {}).json() == {'prompt': 'PRIVATE MISSION'}


def test_replayed_signed_request_rejected(bridge):
    client, _, signer, _ = bridge
    resp = signed(client, signer, 'session', {})
    assert resp.status_code == 200
    replay = client.post(resp.request.url.path, content=resp.request.content, headers=dict(resp.request.headers))
    assert replay.status_code == 403


def test_snapshot_exposes_actual_node_but_not_private_context(bridge):
    client, mission, signer, _ = bridge
    w = worker()
    w['context'] = {'private': 'not for browser'}
    assert signed(client, signer, 'sync', snapshot([w])).status_code == 200
    body = client.get(f'/mission/{mission.id}/workers').json()
    assert body[0]['node_id'] == '101'
    assert body[0]['runtime'] == 'supergrid'
    assert 'context' not in body[0]
    assert mission.control_available


def test_cross_mission_and_duplicate_node_snapshots_rejected(bridge):
    client, _, signer, _ = bridge
    w = worker()
    w['mission_id'] = 'someone-else'
    assert signed(client, signer, 'sync', snapshot([w])).status_code == 422
    assert signed(client, signer, 'sync', snapshot([worker(), worker('w2')])).status_code == 422
    assert not store.workers


def test_remote_attack_ack_and_approval(bridge):
    client, mission, signer, session = bridge
    signed(client, signer, 'sync', snapshot())
    future = supergrid.attack('w1')
    assert mission.result is None
    assert client.post(f'/mission/{mission.id}/approve').status_code == 409
    reply = signed(client, signer, 'sync', snapshot()).json()
    command = reply['commands'][0]
    bad = worker(tainted=True, quarantined=True)
    bad.update(status='quarantined', output=None)
    replacement = worker('w1-r1', '102', replacement_for='w1')
    response = {'quarantined': bad, 'replacement': replacement,
                'event': {'mission_id': mission.id, 'worker_id': 'w1', 'replacement_id': 'w1-r1',
                          'detail': 'quarantined', 'timestamp': time.time()}}
    resp = signed(client, signer, 'sync', snapshot([bad, replacement],
                  responses={command['id']: {'result': response}}))
    assert resp.status_code == 200
    assert future.result().replacement.node_id == '102'
    assert not session.commands
    assert client.post(f'/mission/{mission.id}/approve').json()['approved']
    assert signed(client, signer, 'sync', snapshot([bad, replacement])).json()['approved']
    assert session.closed


def test_submission_failure_does_not_run_locally(bridge, monkeypatch):
    client, _, _, _ = bridge
    monkeypatch.setenv('CONSTELLATION_BRIDGE_URL', '')
    local = Mock(side_effect=AssertionError('local runtime must not be used'))
    monkeypatch.setattr(main, 'get_swarm', local)
    resp = client.post('/mission', json={'prompt': 'confidential new research'})
    assert resp.status_code == 503
    assert 'HTTPS' in resp.json()['detail']
    local.assert_not_called()


def test_launch_uses_only_public_run_config(tmp_path, monkeypatch):
    store.reset()
    service = SuperGrid()
    mission = store.add_mission(Mission(id='m-test', prompt='NEVER INCLUDE THIS IN THE FAB'))
    session = service.sessions[mission.id] = Session(mission.id)
    captured = []
    def cli(binary, args, timeout=120):
        captured.append(args)
        if args[0] == 'run':
            from pathlib import Path
            config = Path(args[args.index('--run-config') + 1]).read_text()
            assert mission.prompt not in config
            assert 'token' not in config
            assert 'private' not in config
            assert 'bridge-url' in config
            session.closed = True
        return {'success': True, 'run-id': '456'}
    monkeypatch.setattr(service, '_cli', cli)
    proc = Mock(stdout=io.StringIO(''))
    proc.poll.return_value = 0
    monkeypatch.setattr('services.supergrid.subprocess.Popen', lambda *a, **k: proc)
    service._launch(mission.id, '@qxh2001/security', 'https://bridge.example', 'flwr')
    assert captured[0][:5] == ['run', '.', 'supergrid', '--federation', '@qxh2001/security']
    assert mission.run_id == '456'


def test_only_matching_run_key_is_pinned(bridge):
    _, _, signer, _ = bridge
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    pub = base64.b64encode(signer.key.public_key().public_bytes(Encoding.Raw, PublicFormat.Raw)).decode()
    session = Session('m-test', run_id='123')
    lines = [ANNOUNCEMENT + json.dumps({'mission_id': 'm-test', 'run_id': 'wrong', 'public_key': pub}),
             ANNOUNCEMENT + json.dumps({'mission_id': 'm-test', 'run_id': '123', 'public_key': pub})]
    supergrid._read_key(session, SimpleNamespace(stdout=io.StringIO('\n'.join(lines))))
    assert session.public_key is not None


def test_only_https_bridge_allowed():
    for url in ('', 'http://localhost:8000', 'https://user:secret@host', 'https://host?token=x'):
        with pytest.raises(ValueError):
            validate_bridge_url(url)


def test_entire_remote_coordinator_lifecycle(bridge, monkeypatch):
    """Signed HTTP bridge + coordinator + Flower messages; simulated grid only."""
    from services.remote_coordinator import run_remote
    from services.flower_app import run_task
    from flwr.supercore.task_identity import TaskIdentity
    from backend.tests.test_grid_transport import Grid
    client, mission, _, session = bridge
    mission.prompt = 'Confidential research: our model architecture uses transformer experts. We train on a private dataset.'
    for field, value in (('_run_id', 123), ('_task_id', 1), ('_node_id', 1)):
        monkeypatch.setattr(TaskIdentity, field, value)
    session.public_key = None
    submitted = []

    class ExecutingGrid(Grid):
        def push_messages(self, messages):
            ids = super().push_messages(messages)
            for message in messages:
                submitted.append(message)
                self.replies.append(run_task(message, None))
            return ids

    def announce(self):
        session.public_key = self.key.public_key()

    def post(self, action, value):
        response = signed(client, self, action, value)
        response.raise_for_status()
        return response.json()

    monkeypatch.setattr(SignedBridge, 'announce', announce)
    monkeypatch.setattr(SignedBridge, 'post', post)
    context = SimpleNamespace(run_id=123, run_config={'bridge-url': 'https://bridge.example',
                              'mission-id': mission.id, 'min-nodes': 9, 'timeout': 2, 'control-ttl': 10})
    failures = []
    def run():
        try:
            run_remote(ExecutingGrid(9), context)
        except Exception as exc:
            failures.append(exc)
    thread = threading.Thread(target=run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 8
    while mission.status != MissionStatus.COMPLETE and time.monotonic() < deadline and not failures:
        time.sleep(.02)
    assert not failures
    assert mission.status == MissionStatus.COMPLETE
    assert len(mission.worker_ids) == 8
    target = mission.worker_ids[0]
    response = client.post(f'/workers/{target}/attack')
    assert response.status_code == 200, response.text
    while mission.status != MissionStatus.COMPLETE and time.monotonic() < deadline:
        time.sleep(.02)
    assert mission.status == MissionStatus.COMPLETE
    workers = store.mission_workers(mission.id)
    assert len(workers) == 9
    assert len({w.node_id for w in workers}) == 9
    assert store.workers[target].quarantined
    assert store.workers[target].output is None
    assert 'Coverage: 8/8' in mission.result
    for message in submitted:
        task = dict(message.content['task'])
        assert mission.prompt not in str(task)
        assert 'bridge-url' not in task and 'public_key' not in task
    assert client.post(f'/mission/{mission.id}/approve').status_code == 200
    thread.join(3)
    assert not thread.is_alive()
    assert not failures


def test_shutdown_stops_remote_run_before_returning(bridge, monkeypatch):
    _, mission, _, session = bridge
    cli = Mock(return_value={"success": True})
    monkeypatch.setattr(supergrid, '_cli', cli)
    monkeypatch.setattr('services.supergrid.shutil.which', lambda _: 'flwr')
    supergrid.shutdown()
    cli.assert_called_once_with('flwr', ['stop', '123', 'supergrid'], timeout=10)
    assert session.closed
    assert mission.status == MissionStatus.FAILED


@pytest.mark.parametrize("kind", ["http", "connection", "timeout"])
def test_handshake_failure_reports_transport_reason(monkeypatch, capsys, kind):
    from urllib.error import HTTPError, URLError
    from services.remote_coordinator import run_remote
    errors = {"http": HTTPError("https://bridge.example", 403, "Forbidden", {}, None),
              "connection": URLError("certificate verify failed"), "timeout": TimeoutError("timed out")}
    expected = {"http": "HTTP 403", "connection": "certificate verify failed", "timeout": "timed out"}
    monkeypatch.setattr(SignedBridge, 'announce', lambda self: None)
    monkeypatch.setattr(SignedBridge, 'post', Mock(side_effect=errors[kind]))
    monkeypatch.setattr('services.remote_coordinator.time.monotonic', Mock(side_effect=[0, 91]))
    context = SimpleNamespace(run_id=123, run_config={"bridge-url": "https://bridge.example", "mission-id": "m-test"})
    with pytest.raises(RuntimeError, match=expected[kind]):
        run_remote(None, context)
    assert expected[kind] in capsys.readouterr().out


def test_connection_diagnostic_is_retained_for_mission_error():
    session = Session('m-test', run_id='123')
    logs = SimpleNamespace(stdout=io.StringIO('Bridge handshake retry: Tunnel connection failed: 403 Forbidden\n'))
    SuperGrid()._read_key(session, logs)
    assert session.connection_error == 'SuperGrid callback failed: Tunnel connection failed: 403 Forbidden'


def test_successful_handshake_clears_old_connection_error(bridge):
    client, _, signer, session = bridge
    session.connection_error = 'SuperGrid callback failed: HTTP 403'
    assert signed(client, signer, 'session', {}).status_code == 200
    assert session.connection_error is None
