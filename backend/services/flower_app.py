"""Flower ServerApp/ClientApp for Constellation.

ServerApp = the trusted coordinator (services.swarm): decomposes the mission,
sends each ClientApp only its own slice, quarantines/replaces attacked
workers and synthesizes the result. ClientApp = one untrusted worker.

These module-level apps are what `flwr run` / Flower Hub load (see
[tool.flwr.app.components] in pyproject.toml). The FastAPI backend runs the
same coordinator loop as a long-lived ServerApp via services.swarm.
"""

from __future__ import annotations

import time
from typing import Any, Callable

from flwr.app import ConfigRecord, Context, Message, RecordDict
from flwr.clientapp import ClientApp
from flwr.serverapp import Grid, ServerApp

from services.flower_runtime import COMPLETE, FAILED, RUNNING, execute_task

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
        "context": list(task["context"]),
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


class GridTransport:
    """Coordinator transport over the Flower Grid: one Message per worker task."""

    runtime = "flower"

    def __init__(self, grid: Grid, num_nodes: int | None, timeout: float) -> None:
        """Wait for `num_nodes` SuperNodes (None: until the count stops changing)."""
        deadline = time.time() + timeout
        seen, stable_since = -1, time.time()
        while True:
            node_ids = sorted(grid.get_node_ids())
            if len(node_ids) != seen:
                seen, stable_since = len(node_ids), time.time()
            if num_nodes is not None and seen >= num_nodes:
                break
            if num_nodes is None and seen > 0 and time.time() - stable_since > 0.5:
                break
            if time.time() > deadline:
                raise TimeoutError("Flower nodes did not register")
            time.sleep(0.05)
        self._grid = grid
        self._nodes = node_ids
        self._load = {n: 0 for n in node_ids}
        self._by_msg: dict[str, tuple[str, int]] = {}  # message id -> (worker id, node)

    def submit(self, payload: dict[str, Any], avoid: set[str]) -> str:
        # Least-loaded SuperNode, never the node of a quarantined worker.
        candidates = [n for n in self._nodes if str(n) not in avoid] or self._nodes
        node = min(candidates, key=lambda n: self._load[n])
        msg = Message(RecordDict({"task": ConfigRecord(payload)}), dst_node_id=node, message_type="query")
        (msg_id,) = self._grid.push_messages([msg])
        self._by_msg[msg_id] = (payload["id"], node)
        self._load[node] += 1
        return str(node)

    def poll(self) -> list[dict[str, Any]]:
        if not self._by_msg:
            return []
        updates = []
        for reply in self._grid.pull_messages(list(self._by_msg)):
            worker_id, node = self._by_msg.pop(reply.metadata.reply_to_message_id)
            self._load[node] -= 1
            if reply.has_error():
                updates.append({"worker_id": worker_id, "status": FAILED, "error": reply.error.reason})
            else:
                result = reply.content["result"]
                updates.append({"worker_id": worker_id, "status": COMPLETE,
                                "output": result["output"], "source": result["source"]})
        return updates

    def close(self) -> None:
        pass


class StandaloneMission:
    """Trusted mission bookkeeping for `flwr run` (plain dicts, no API)."""

    def __init__(self, prompt: str) -> None:
        self.prompt = prompt
        self.workers: dict[str, dict[str, Any]] = {}
        self.result: str | None = None

    def decompose(self) -> list[dict[str, Any]]:
        from services.decomposer import decompose_mission

        for spec in decompose_mission(self.prompt, "mission"):
            worker = {**spec.model_dump(), "status": "queued", "output": None,
                      "tainted": False, "quarantined": False, "replacement_for": None}
            self.workers[worker["id"]] = worker
        return list(self.workers.values())

    def on_update(self, update: dict[str, Any]) -> None:
        worker = self.workers[update["worker_id"]]
        worker.update({k: v for k, v in update.items() if k in ("status", "output", "error")})
        detail = update.get("output") or update.get("error") or update.get("node_id") or ""
        print(f"{worker['id']:<28} {update['status']:<9} {detail}".rstrip())

    def attack(self, worker_id: str) -> tuple[dict[str, Any], dict[str, Any] | None]:
        from services.security import attack_worker

        # The previous synthesis is stale as soon as a worker is compromised.
        # It will be rebuilt only after the replacement finishes.
        self.result = None
        event, replacement = attack_worker(self.workers[worker_id], list(self.workers.values()))
        if replacement is not None:
            self.workers[replacement["id"]] = replacement
        print(f"SECURITY  {event['message']}")
        return event, replacement

    def finish(self) -> None:
        from services.coordinator import synthesize

        self.result = synthesize(list(self.workers.values()), self.prompt)


server_app = ServerApp()


@server_app.main()
def main(grid: Grid, context: Context) -> None:
    """`flwr run` entry point: the whole mission, coordinated by this ServerApp.

    Run config: `prompt` (empty = built-in demo mission), `attack` (a worker
    role to hit with the demo prompt-injection attack, or empty), `timeout`.
    """
    from services.decomposer import DEMO_MISSION, decompose_mission
    from services.swarm import Swarm

    cfg = context.run_config
    prompt = str(cfg.get("prompt", "")) or DEMO_MISSION
    mission = StandaloneMission(prompt)
    swarm = Swarm()
    swarm.alive = True  # accept work before the loop starts; it runs below
    swarm.submit_mission("mission", mission)

    target = str(cfg.get("attack", ""))
    if target:
        # Decomposition is deterministic, so the target id is known up front.
        # The attack is processed right after dispatch: it lands mid-mission.
        ids = [s.id for s in decompose_mission(prompt, "mission") if s.role == target]
        if ids:
            swarm.attack("mission", ids[0])
        else:
            print(f"SECURITY  no worker with role {target!r}; attack skipped")

    swarm.run(lambda: GridTransport(grid, None, float(cfg.get("timeout", 120))), until_idle=True)
    print("\n" + (mission.result or "No result."))
