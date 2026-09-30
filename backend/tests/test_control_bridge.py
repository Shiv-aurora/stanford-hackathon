from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from services.control_bridge import relay_control
from services.flower_app import GridTransport, run_task
from backend.tests.test_grid_transport import Grid, payload


def test_worker_node_refuses_control_messages():
    with pytest.raises(ValueError, match='not a trusted control'):
        relay_control(None, SimpleNamespace(node_config={}))


def test_control_node_refuses_worker_tasks():
    with pytest.raises(ValueError, match='cannot execute worker'):
        run_task(None, SimpleNamespace(node_config={'constellation-control': True}))


@pytest.mark.parametrize('origin', ['https://example.com', 'http://localhost.evil', 'http://127.0.0.1:8011/mission'])
def test_relay_only_connects_to_fixed_loopback(origin):
    with pytest.raises(ValueError, match='loopback'):
        relay_control(None, SimpleNamespace(node_config={'constellation-control': True, 'constellation-api': origin}))


def test_control_node_does_not_count_as_worker_capacity():
    with pytest.raises(TimeoutError):
        GridTransport(Grid(9), 9, .01, excluded_nodes={5})


def test_relay_rejects_non_callback_path():
    message = SimpleNamespace(content={'control': {'path': '/mission', 'body': b'{}'}})
    with pytest.raises(ValueError, match='control path'):
        relay_control(message, SimpleNamespace(node_config={'constellation-control': True}))
