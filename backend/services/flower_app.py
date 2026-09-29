"""Flower ServerApp/ClientApp for Constellation workers.

These module-level apps are what `flwr run` / Flower Hub load (see
[tool.flwr.app.components] in pyproject.toml). The FastAPI backend reuses
the same ClientApp and `dispatch` via services.flower_runtime.run_workers.
"""

from __future__ import annotations

import json
import time
from typing import Any, Callable

from flwr.app import ConfigRecord, Context, Message, RecordDict
from flwr.clientapp import ClientApp
from flwr.serverapp import Grid, ServerApp

from services.flower_runtime import COMPLETE, FAILED, RUNNING, _payload, execute_task

client_app = ClientApp()


@client_app.query()
def run_task(msg: Message, context: Context) -> Message:
    """Run one worker task. The message carries only this worker's slice."""
    task = msg.content["task"]
    payload = {
        "id": task["id"],
        "role": task["role"],
        "task": task["task"],
        "allowed_context": list(task["allowed_context"]),
        "network_identity": task["network_identity"],
        "fail": bool(task["fail"]),
    }
    output, source = execute_task(payload)
    reply = RecordDict(
        {"result": ConfigRecord({"worker_id": payload["id"], "output": output, "source": source})}
    )
    return Message(reply, reply_to=msg)


def dispatch(
    grid: Grid,
    payloads: list[dict[str, Any]],
    set_status: Callable[..., None],
    timeout: float,
) -> None:
    """Send one worker per SuperNode and report status as replies arrive."""
    deadline = time.time() + timeout
    while len(node_ids := sorted(grid.get_node_ids())) < len(payloads):
        if time.time() > deadline:
            raise TimeoutError("Flower nodes did not register")
        time.sleep(0.05)

    messages = [
        (Message(RecordDict({"task": ConfigRecord(p)}), dst_node_id=node_id, message_type="query"), p["id"], node_id)
        for node_id, p in zip(node_ids, payloads)
    ]
    ids = grid.push_messages([m for m, _, _ in messages])
    by_msg: dict[str, str] = {}
    for msg_id, (_, worker_id, node_id) in zip(ids, messages):
        by_msg[msg_id] = worker_id
        set_status(worker_id, RUNNING, runtime="flower", node_id=str(node_id))

    waiting = set(by_msg)
    while waiting and time.time() < deadline:
        for reply in grid.pull_messages(list(waiting)):
            msg_id = reply.metadata.reply_to_message_id
            waiting.discard(msg_id)
            worker_id = by_msg[msg_id]
            if reply.has_error():
                set_status(worker_id, FAILED, error=reply.error.reason)
            else:
                result = reply.content["result"]
                set_status(worker_id, COMPLETE, output=result["output"], source=result["source"])
        time.sleep(0.05)


DEMO_SPECS = [
    {"id": "w1", "role": "literature", "task": "Summarise prior work", "allowed_context": ["paper-abstracts"]},
    {"id": "w2", "role": "data", "task": "Profile the evaluation dataset", "allowed_context": ["dataset-schema"]},
    {"id": "w3", "role": "eval", "task": "Propose evaluation metrics", "allowed_context": ["benchmark-list"]},
    {"id": "w4", "role": "risk", "task": "List failure modes", "allowed_context": ["threat-model"]},
]

server_app = ServerApp()


@server_app.main()
def main(grid: Grid, context: Context) -> None:
    """Standalone entry point for `flwr run`: runs the `worker-specs` config."""
    raw = context.run_config.get("worker-specs", "")
    specs = json.loads(raw) if raw else DEMO_SPECS
    payloads = [_payload(s, i) for i, s in enumerate(specs)]

    def report(worker_id: str, status: str, **fields: Any) -> None:
        detail = fields.get("output") or fields.get("error") or ""
        print(f"{worker_id} {status} {detail}".rstrip())

    dispatch(grid, payloads, report, float(context.run_config.get("timeout", 120)))
