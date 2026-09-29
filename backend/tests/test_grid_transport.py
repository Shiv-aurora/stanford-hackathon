"""One worker per node, including completed and quarantined workers."""
import time

import pytest
from flwr.app import ConfigRecord, Message, RecordDict

from services.flower_app import GridTransport
from services.flower_runtime import _payload


@pytest.fixture(autouse=True)
def flower_task_identity(monkeypatch):
    from flwr.supercore.task_identity import TaskIdentity
    monkeypatch.setattr(TaskIdentity, '_run_id', 123)
    monkeypatch.setattr(TaskIdentity, '_task_id', 1)
    monkeypatch.setattr(TaskIdentity, '_node_id', 1)


class Grid:
    def __init__(self, count=3):
        self.nodes = list(range(1, count + 1))
        self.sent = []
        self.replies = []

    def get_node_ids(self):
        return self.nodes

    def push_messages(self, messages):
        ids = []
        for m in messages:
            mid = str(len(self.sent) + 1)
            m.metadata.__dict__["_message_id"] = mid
            self.sent.append(m)
            ids.append(mid)
        return ids

    def pull_messages(self, ids):
        replies, self.replies = self.replies, []
        return replies

    def complete(self, index=0):
        message = self.sent[index]
        task = message.content['task']
        self.replies.append(Message(RecordDict({'result': ConfigRecord({
            'worker_id': task['id'], 'output': 'valid result', 'source': 'seeded',
        })}), reply_to=message))


def payload(wid):
    return _payload({'id': wid, 'role': 'test', 'task': 'review',
                     'context': {'own': 'own slice'}}, 0)


def test_finished_nodes_are_not_reused():
    grid = Grid()
    transport = GridTransport(grid, 3, 1)
    assert transport.submit(payload('w1'), set()) == '1'
    grid.complete()
    assert transport.poll()[0]['status'] == 'complete'
    assert transport.submit(payload('w2'), set()) == '2'
    assert transport.submit(payload('replacement'), {'1'}) == '3'
    with pytest.raises(RuntimeError, match='unused SuperNode'):
        transport.submit(payload('fourth'), set())
    assert [m.metadata.dst_node_id for m in grid.sent] == [1, 2, 3]


def test_no_fallback_to_avoided_node():
    grid = Grid(1)
    transport = GridTransport(grid, 1, 1)
    with pytest.raises(RuntimeError, match='unused SuperNode'):
        transport.submit(payload('w1'), {'1'})
    assert not grid.sent


def test_capacity_preflight_sends_nothing():
    grid = Grid(2)
    transport = GridTransport(grid, 2, 1)
    with pytest.raises(RuntimeError, match='Need 8 unused'):
        transport.require_capacity(8)
    assert not grid.sent


def test_missing_reply_times_out_and_node_stays_reserved():
    grid = Grid(1)
    transport = GridTransport(grid, 1, 0.01)
    transport.submit(payload('w1'), set())
    time.sleep(0.02)
    assert transport.poll()[0]['status'] == 'failed'
    with pytest.raises(RuntimeError):
        transport.submit(payload('replacement'), set())
