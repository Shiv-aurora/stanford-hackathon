"""Trusted coordinator service for Constellation.

The coordinator loop is the only place a whole mission is handled:

    decompose -> dispatch narrow slices -> quarantine/replace on attack
              -> collect outputs -> synthesize

It runs *inside* the Flower ServerApp (see services/flower_app.py), so the
trusted coordinator and the untrusted worker ClientApps both live in the
Flower federation: the ServerApp is the trusted hub, each SuperNode is an
untrusted worker. If Flower is unavailable the same loop runs over a local
thread pool instead.

One long-lived Swarm serves every mission. A single Flower simulation is kept
running because ending one shuts Ray down process-wide, which would kill any
other mission still in flight.

Callers talk to the loop through thread-safe futures:

    swarm = get_swarm()
    specs = swarm.submit_mission(key, handler).result()
    response = swarm.attack(key, worker_id).result()

`handler` is the mission's trusted bookkeeping (the API store, or plain dicts
for `flwr run`). The loop calls, always from its own thread:

    handler.decompose() -> list[worker spec]
    handler.on_update(update_dict)           # queued/running/complete/failed
    handler.attack(worker_id) -> (response, replacement spec | None)
    handler.finish()                         # all active workers finished
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Callable, Protocol

from services.flower_runtime import (
    COMPLETE,
    FAILED,
    QUEUED,
    RUNNING,
    _payload,
    execute_task,
    flower_available,
)

log = logging.getLogger(__name__)

NUM_NODES = int(os.environ.get("CONSTELLATION_FLOWER_NODES", "10"))
READY_TIMEOUT_S = float(os.environ.get("CONSTELLATION_FLOWER_READY_TIMEOUT", "90"))
TICK_S = 0.05


class MissionHandler(Protocol):
    def decompose(self) -> list[Any]: ...
    def on_update(self, update: dict[str, Any]) -> None: ...
    def attack(self, worker_id: str) -> tuple[Any, Any | None]: ...
    def finish(self) -> None: ...


class Transport(Protocol):
    """How the coordinator reaches workers (Flower grid or local threads)."""

    runtime: str

    def submit(self, payload: dict[str, Any], avoid: set[str]) -> str: ...
    def poll(self) -> list[dict[str, Any]]: ...
    def close(self) -> None: ...


@dataclass
class _Mission:
    handler: Any
    inflight: set[str] = field(default_factory=set)
    quarantined: set[str] = field(default_factory=set)
    node_of: dict[str, str] = field(default_factory=dict)
    finished: bool = True


class Swarm:
    def __init__(self) -> None:
        self._inbox: queue.Queue[tuple[str, tuple, Future]] = queue.Queue()
        self._missions: dict[str, _Mission] = {}
        self._owner: dict[str, str] = {}  # worker id -> mission key
        self._stop = threading.Event()
        self.ready = threading.Event()
        self.alive = False
        self.runtime: str | None = None
        self._index = 0

    # -- caller side (any thread) -------------------------------------------

    def submit_mission(self, key: str, handler: Any) -> Future:
        return self._put("mission", key, handler)

    def attack(self, key: str, worker_id: str) -> Future:
        return self._put("attack", key, worker_id)

    def has_mission(self, key: str) -> bool:
        return key in self._missions

    def stop(self) -> None:
        self._stop.set()

    def _put(self, kind: str, *args: Any) -> Future:
        fut: Future = Future()
        if not self.alive:
            fut.set_exception(RuntimeError("coordinator is not running"))
        else:
            self._inbox.put((kind, args, fut))
        return fut

    # -- coordinator loop (runs inside the Flower ServerApp) ----------------

    def run(self, make_transport: Callable[[], Transport], until_idle: bool = False,
            on_tick: Callable[[], None] | None = None) -> None:
        """Coordinator main loop. Returns when stopped (or idle, if until_idle)."""
        self.alive = True
        transport: Transport | None = None
        try:
            transport = make_transport()
            self.runtime = transport.runtime
            self.ready.set()
            while not self._stop.is_set():
                self._drain_inbox(transport)
                for update in transport.poll():
                    self._on_result(update)
                self._finish_missions()
                if on_tick is not None:
                    on_tick()
                if until_idle and self._inbox.empty() and all(m.finished for m in self._missions.values()):
                    break
                time.sleep(TICK_S)
        finally:
            self.alive = False
            self.ready.set()  # unblock anyone waiting on startup
            self._abort_pending()
            if transport is not None:
                transport.close()

    def _drain_inbox(self, transport: Transport) -> None:
        while True:
            try:
                kind, args, fut = self._inbox.get_nowait()
            except queue.Empty:
                return
            try:
                if kind == "mission":
                    fut.set_result(self._start_mission(transport, *args))
                elif kind == "attack":
                    fut.set_result(self._attack(transport, *args))
            except BaseException as exc:
                fut.set_exception(exc)

    def _start_mission(self, transport: Transport, key: str, handler: Any) -> list[Any]:
        specs = handler.decompose()
        if hasattr(transport, "require_capacity"):
            transport.require_capacity(len(specs))
        mission = self._missions[key] = _Mission(handler=handler)
        for spec in specs:
            self._dispatch(transport, key, mission, spec)
        return specs

    def _attack(self, transport: Transport, key: str, worker_id: str) -> Any:
        mission = self._missions.get(key)
        if mission is None:
            raise KeyError(f"unknown mission {key}")
        if worker_id not in mission.node_of or worker_id in mission.quarantined:
            raise ValueError("worker is not available for attack")
        response, replacement = mission.handler.attack(worker_id)
        # Any late reply from the compromised worker is dropped from now on.
        mission.quarantined.add(worker_id)
        mission.inflight.discard(worker_id)
        if replacement is not None:
            avoid = {mission.node_of[worker_id]} if worker_id in mission.node_of else set()
            self._dispatch(transport, key, mission, replacement, avoid)
        return response

    def _dispatch(self, transport: Transport, key: str, mission: _Mission, spec: Any, avoid: set[str] = frozenset()) -> None:
        payload = _payload(spec, self._index)
        self._index += 1
        worker_id = payload["id"]
        self._owner[worker_id] = key
        mission.inflight.add(worker_id)
        mission.finished = False
        try:
            node = transport.submit(payload, set(avoid))
        except Exception as exc:
            self._on_result({"worker_id": worker_id, "status": FAILED, "error": str(exc)})
            return
        mission.node_of[worker_id] = node
        self._notify(mission, {"worker_id": worker_id, "status": RUNNING, "runtime": transport.runtime,
                               "node_id": node, "started_at": time.time()})

    def _on_result(self, update: dict[str, Any]) -> None:
        worker_id = update["worker_id"]
        mission = self._missions.get(self._owner.get(worker_id, ""))
        if mission is None or worker_id in mission.quarantined or worker_id not in mission.inflight:
            return
        mission.inflight.discard(worker_id)
        self._notify(mission, {**update, "finished_at": time.time()})

    def _finish_missions(self) -> None:
        for mission in self._missions.values():
            if not mission.finished and not mission.inflight:
                mission.finished = True
                try:
                    mission.handler.finish()
                except Exception:
                    log.exception("mission synthesis failed")

    def _notify(self, mission: _Mission, update: dict[str, Any]) -> None:
        try:
            mission.handler.on_update(update)
        except Exception:
            log.exception("mission update failed")

    def _abort_pending(self) -> None:
        while True:
            try:
                _, _, fut = self._inbox.get_nowait()
            except queue.Empty:
                break
            fut.set_exception(RuntimeError("coordinator stopped"))
        for mission in self._missions.values():
            for worker_id in list(mission.inflight):
                self._notify(mission, {"worker_id": worker_id, "status": FAILED, "error": "coordinator stopped"})
            mission.inflight.clear()


class LocalTransport:
    """Fallback: run worker tasks in a local thread pool."""

    runtime = "local"

    def __init__(self, max_workers: int = NUM_NODES) -> None:
        self._pool = ThreadPoolExecutor(max_workers=max_workers, thread_name_prefix="constellation-worker")
        self._done: queue.Queue[dict[str, Any]] = queue.Queue()
        self._slot = 0

    def submit(self, payload: dict[str, Any], avoid: set[str]) -> str:
        self._slot += 1
        node = f"local-{self._slot}"

        def work() -> None:
            try:
                output, source = execute_task(payload)
                self._done.put({"worker_id": payload["id"], "status": COMPLETE, "output": output, "source": source})
            except Exception as exc:
                self._done.put({"worker_id": payload["id"], "status": FAILED, "error": str(exc)})

        self._pool.submit(work)
        return node

    def poll(self) -> list[dict[str, Any]]:
        out = []
        while True:
            try:
                out.append(self._done.get_nowait())
            except queue.Empty:
                return out

    def close(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)


# ---------------------------------------------------------------------------
# Process-wide service
# ---------------------------------------------------------------------------

_lock = threading.Lock()
_swarm: Swarm | None = None


def _start_local(swarm: Swarm) -> None:
    threading.Thread(target=swarm.run, args=(LocalTransport,), name="constellation-coordinator", daemon=True).start()


def _start_flower(swarm: Swarm) -> None:
    from services.flower_runtime import run_coordinator_simulation

    threading.Thread(
        target=run_coordinator_simulation,
        args=(swarm, NUM_NODES),
        name="constellation-flower",
        daemon=True,
    ).start()


def get_swarm(use_flower: bool | None = None) -> Swarm:
    """Return the running coordinator, starting it (Flower first) if needed."""
    global _swarm
    with _lock:
        if _swarm is not None and _swarm.alive:
            return _swarm
        if use_flower is None:
            use_flower = os.environ.get("CONSTELLATION_RUNTIME", "flower") != "local"
        swarm = Swarm()
        if use_flower and flower_available():
            _start_flower(swarm)
            if not swarm.ready.wait(READY_TIMEOUT_S) or not swarm.alive:
                log.warning("Flower coordinator did not start; using local coordinator")
                swarm.stop()
                swarm = Swarm()
        if not swarm.alive and not swarm.ready.is_set():
            _start_local(swarm)
            swarm.ready.wait(10)
        _swarm = swarm
        return swarm


def shutdown_swarm(timeout: float = 30) -> None:
    """Stop the coordinator (and the Flower simulation behind it)."""
    global _swarm
    with _lock:
        swarm, _swarm = _swarm, None
    if swarm is not None:
        swarm.stop()
        deadline = time.time() + timeout
        while swarm.alive and time.time() < deadline:
            time.sleep(TICK_S)


__all__ = ["Swarm", "LocalTransport", "get_swarm", "shutdown_swarm", "QUEUED", "RUNNING", "COMPLETE", "FAILED"]
