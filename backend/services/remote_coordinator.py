"""ServerApp entry point for a mission submitted by the web control plane."""
from __future__ import annotations

import time
from typing import Any
from urllib.error import HTTPError, URLError

from services.coordinator import mission_status
from services.flower_app import GridTransport
from services.remote_protocol import SignedBridge
from services.swarm import Swarm


def public_worker(worker: dict) -> dict:
    # Scoped transcript context returns only over the signed trusted control channel.
    # Worker lists still exclude context/logs; no transcripts enter Flower logs.
    return {k: v for k, v in worker.items() if k not in ("context", "pending_message", "model")}


def run_remote(grid: Any, context: Any) -> None:
    cfg = context.run_config
    control_node = int(cfg.get("control-node-id") or 0)
    if control_node:
        from services.control_bridge import GridBridge
        bridge = GridBridge(grid, control_node, str(cfg["mission-id"]), str(context.run_id))
    else:
        bridge = SignedBridge(str(cfg["bridge-url"]), str(cfg["mission-id"]), str(context.run_id))
    bridge.announce()
    # The API authenticates this key by reading this run's Flower server log.
    deadline = time.monotonic() + (240 if control_node else 90)
    last_error = None
    while True:
        try:
            session = bridge.post("session", {})
            break
        except (HTTPError, URLError, TimeoutError) as exc:
            # Report transport diagnostics only, never response bodies or mission data.
            detail = f"HTTP {exc.code}" if isinstance(exc, HTTPError) else str(getattr(exc, "reason", exc))
            if detail != last_error:
                print(f"Bridge handshake retry: {detail}", flush=True)
                last_error = detail
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Web bridge did not accept the ServerApp handshake: {detail}") from None
            time.sleep(1)

    from services.remote_mission import RemoteMission
    swarm = Swarm()
    swarm.alive = True
    mission = RemoteMission(session, str(cfg["mission-id"]), swarm)
    start = swarm.submit_mission(mission.mission_id, mission)
    pending: dict[str, Any] = {}
    responses: dict[str, dict] = {}
    last_sync = 0.0
    last_success = time.monotonic()
    expires = time.monotonic() + float(cfg.get("control-ttl", 900))
    error: str | None = None

    def sync() -> None:
        nonlocal last_sync, last_success, error
        now = time.monotonic()
        if now - last_sync < 0.5:
            return
        last_sync = now
        mission.check_containment()
        if start.done() and start.exception():
            error = str(start.exception())
        for command_id, future in list(pending.items()):
            if not future.done():
                continue
            try:
                event = future.result()
                bad = mission.workers[event["worker_id"]]
                replacement = mission.workers[event["replacement_id"]]
                responses[command_id] = {"result": {
                    "quarantined": public_worker(bad), "replacement": public_worker(replacement),
                    "event": {"mission_id": mission.mission_id, "worker_id": bad["id"],
                              "replacement_id": replacement["id"], "detail": event["message"],
                              "timestamp": event["timestamp"]},
                }}
            except Exception as exc:
                responses[command_id] = {"error": str(exc)}
            del pending[command_id]
        expired = now >= expires
        if expired and mission.result is None:
            error = "SuperGrid mission exceeded its control window"
        value = {
            "workers": [public_worker(w) for w in mission.workers.values()],
            "result": mission.result, "error": error,
            "chat": mission.chat, "answer": mission.answer, "answer_status": mission.answer_status,
            "status": "failed" if error else mission_status(list(mission.workers.values())),
            "responses": responses, "closed": expired or bool(error),
        }
        try:
            reply = bridge.post("sync", value)
            last_success = time.monotonic()
        except (HTTPError, URLError, TimeoutError):
            if time.monotonic() - last_success > 60:
                raise RuntimeError("Lost the web control connection; stopping the coordinator") from None
            return
        if expired or error or reply.get("approved"):
            swarm.stop()
            return
        for cmd in reply.get("commands", []):
            cid = cmd["id"]
            if cid not in pending and cid not in responses:
                if cmd.get("kind", "attack") == "attack":
                    pending[cid] = swarm.attack(mission.mission_id, cmd["worker_id"])
                else:
                    try:
                        responses[cid] = {"result": mission.followup(cmd["text"], cmd.get("worker_id"))}
                    except ValueError as exc:
                        responses[cid] = {"error": str(exc)}

    try:
        transport = GridTransport(grid, int(cfg.get("min-nodes", 9)), float(cfg.get("timeout", 120)),
                                  excluded_nodes={control_node} if control_node else set())
        swarm.run(lambda: transport, on_tick=sync)
    except Exception as exc:
        # Failure is explicit; never run confidential remote missions locally.
        try:
            bridge.post("sync", {"workers": [public_worker(w) for w in mission.workers.values()],
                                 "result": None, "status": "failed", "error": str(exc),
                                 "responses": {}, "closed": True})
        finally:
            raise
