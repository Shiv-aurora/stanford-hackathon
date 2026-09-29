"""Flower-backed worker runtime for Constellation.

run_workers(worker_specs) executes each compartmentalized worker task as a
Flower ClientApp on its own simulated SuperNode. A Flower ServerApp acts as
the dispatcher: it sends every worker exactly one message containing only
that worker's narrow task and allowed context, then collects replies.

If Flower (or its Ray simulation backend) is unavailable or fails, the same
task handler runs in a local thread pool so the demo keeps working.

Set CONSTELLATION_RUNTIME=local to force the fallback path.

Optional model calls: if FLWR_MODEL_API_ENDPOINT, FLWR_MODEL_ID and
FLWR_MODEL_API_KEY are set (OpenAI Responses-compatible endpoint, e.g. Nebius
Token Factory), each worker asks the model about its own slice only. Any
model/network error falls back to deterministic seeded output.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass, field
from typing import Any, Callable, Iterable, Mapping
from urllib import request as urlrequest

log = logging.getLogger(__name__)

QUEUED = "queued"
RUNNING = "running"
COMPLETE = "complete"
FAILED = "failed"

def _load_dotenv(path: str) -> None:
    """Fill missing env vars from backend/.env (real env vars win)."""
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, value = line.split("=", 1)
                    os.environ.setdefault(key.strip(), value.strip().strip("'\""))
    except OSError:
        pass


_load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env"))

FLOWER_TIMEOUT_S = float(os.environ.get("CONSTELLATION_FLOWER_TIMEOUT", "120"))
MODEL_TIMEOUT_S = float(os.environ.get("CONSTELLATION_MODEL_TIMEOUT", "30"))

StatusCallback = Callable[["WorkerResult"], None]

# One Flower simulation at a time per process: overlapping run_simulation
# calls share the in-process Ray cluster and deadlock. A replacement worker
# dispatched mid-mission waits for the running simulation, then gets its own.
_FLOWER_LOCK = threading.Lock()


@dataclass
class WorkerResult:
    worker_id: str
    status: str = QUEUED
    output: str | None = None
    error: str | None = None
    runtime: str | None = None  # "flower" or "local"
    source: str | None = None  # "model" or "seeded"
    node_id: str | None = None  # Flower node id (flower) or thread slot (local)
    network_identity: str | None = None
    started_at: float | None = None
    finished_at: float | None = None
    history: list[str] = field(default_factory=lambda: [QUEUED])

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ---------------------------------------------------------------------------
# Worker task: the only code that sees a worker's context.
# ---------------------------------------------------------------------------


def _seeded_output(payload: Mapping[str, Any]) -> str:
    labels = list(payload.get("allowed_context") or [])
    context = list(payload.get("context") or [])
    digest = hashlib.sha256(
        "|".join([payload["id"], payload["role"], payload["task"], *context]).encode()
    ).hexdigest()[:8]
    scope = ", ".join(labels) if labels else "no context"
    return (
        f"[{payload['role']}] {payload['task']} :: "
        f"analysed {len(context)} scoped fragment(s) ({scope}); finding-{digest}"
    )


def _model_config() -> tuple[str, str, str] | None:
    endpoint = os.environ.get("FLWR_MODEL_API_ENDPOINT")
    model = os.environ.get("FLWR_MODEL_ID")
    key = os.environ.get("FLWR_MODEL_API_KEY")
    if endpoint and model and key:
        return endpoint, model, key
    return None


def _extract_text(data: Mapping[str, Any]) -> str:
    if isinstance(data.get("output_text"), str) and data["output_text"].strip():
        return data["output_text"].strip()
    parts = []
    for item in data.get("output") or []:
        if item.get("type") != "message":
            continue
        for c in item.get("content") or []:
            if c.get("type") in ("output_text", "text") and c.get("text"):
                parts.append(c["text"])
    return "\n".join(parts).strip()


def _call_model(payload: Mapping[str, Any], config: tuple[str, str, str]) -> str:
    endpoint, model, key = config
    context = "\n".join(f"- {c}" for c in payload.get("context") or []) or "- (none)"
    body = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "You are one compartmentalized worker in a confidential research swarm. "
                    "Use only the context given. Answer in at most 3 short sentences."
                ),
            },
            {
                "role": "user",
                "content": f"Role: {payload['role']}\nTask: {payload['task']}\nContext:\n{context}",
            },
        ],
        "max_output_tokens": 600,
    }
    req = urlrequest.Request(
        endpoint,
        data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urlrequest.urlopen(req, timeout=MODEL_TIMEOUT_S) as resp:
        text = _extract_text(json.loads(resp.read()))
    if not text:
        raise ValueError("empty model response")
    return text


def execute_task(payload: Mapping[str, Any]) -> tuple[str, str]:
    """Run one worker task using only that worker's slice.

    `payload` holds only this worker's id, role, task, access labels,
    narrow context fragments, network identity, and optional `fail` flag.
    Returns (output, source).
    """
    if payload.get("fail"):
        raise RuntimeError(f"worker {payload['id']} failed (simulated)")
    config = _model_config()
    if config is not None:
        try:
            return _call_model(payload, config), "model"
        except Exception as exc:
            log.warning("model call failed for %s, using seeded output: %s", payload["id"], exc)
    return _seeded_output(payload), "seeded"


# ---------------------------------------------------------------------------
# Spec normalisation
# ---------------------------------------------------------------------------


def _get(spec: Any, key: str, default: Any = None) -> Any:
    if isinstance(spec, Mapping):
        return spec.get(key, default)
    return getattr(spec, key, default)


def _payload(spec: Any, index: int) -> dict[str, Any]:
    """Extract the narrow per-worker payload. Nothing else is sent."""
    labels = [str(c) for c in (_get(spec, "allowed_context") or [])]
    context_map = _get(spec, "context") or {}
    if isinstance(context_map, Mapping):
        context = [str(v) for v in context_map.values() if str(v).strip()]
    else:
        context = [str(v) for v in context_map if str(v).strip()]
    # Standalone/legacy specs may only have labels. Real backend workers pass
    # fragment text explicitly; labels are only a resilient fallback.
    if not context:
        context = list(labels)
    return {
        "id": str(_get(spec, "id") or f"worker-{index}"),
        "role": str(_get(spec, "role") or "worker"),
        "task": str(_get(spec, "task") or ""),
        "allowed_context": labels,
        "context": context,
        "network_identity": str(_get(spec, "network_identity") or f"node-{index + 1:02d}"),
        "fail": bool(_get(spec, "fail", False)),
    }


class _Tracker:
    """Thread-safe status bookkeeping that fires callbacks on transitions."""

    def __init__(self, payloads: list[dict[str, Any]], on_update: StatusCallback | None):
        self._lock = threading.Lock()
        self._on_update = on_update
        self.results = {
            p["id"]: WorkerResult(worker_id=p["id"], network_identity=p["network_identity"])
            for p in payloads
        }
        for r in self.results.values():
            self._emit(r)

    def _emit(self, result: WorkerResult) -> None:
        if self._on_update is None:
            return
        try:
            self._on_update(result)
        except Exception:  # never let a UI callback break execution
            log.exception("status callback failed")

    def set(self, worker_id: str, status: str, **fields: Any) -> None:
        with self._lock:
            r = self.results[worker_id]
            for k, v in fields.items():
                setattr(r, k, v)
            if r.status == status:  # e.g. re-dispatched locally after Flower failed
                return
            r.status = status
            r.history.append(status)
            if status == RUNNING:
                r.started_at = time.time()
            elif status in (COMPLETE, FAILED):
                r.finished_at = time.time()
        self._emit(r)

    def pending(self) -> list[str]:
        with self._lock:
            return [w for w, r in self.results.items() if r.status in (QUEUED, RUNNING)]


# ---------------------------------------------------------------------------
# Flower path
# ---------------------------------------------------------------------------


def _run_flower(payloads: list[dict[str, Any]], tracker: _Tracker) -> None:
    from flwr.app import Context
    from flwr.serverapp import Grid, ServerApp
    from flwr.simulation import run_simulation

    from services.flower_app import client_app, dispatch

    n = len(payloads)
    errors: list[BaseException] = []
    server = ServerApp()

    @server.main()
    def main(grid: Grid, context: Context) -> None:
        try:
            dispatch(grid, payloads, tracker.set, FLOWER_TIMEOUT_S)
        except BaseException as exc:  # surfaced after the simulation stops
            errors.append(exc)

    with _FLOWER_LOCK:
        run_simulation(
            server_app=server,
            client_app=client_app,
            num_supernodes=n,
            backend_config={
                "client_resources": {"num_cpus": 1, "num_gpus": 0.0},
                # Logical CPUs only: lets every worker run concurrently.
                "init_args": {"num_cpus": n, "include_dashboard": False, "log_to_driver": False},
            },
        )
    if errors:
        raise errors[0]


# ---------------------------------------------------------------------------
# Local fallback
# ---------------------------------------------------------------------------


def _run_local(payloads: list[dict[str, Any]], tracker: _Tracker) -> None:
    todo = [p for p in payloads if p["id"] in set(tracker.pending())]
    if not todo:
        return

    def work(slot: int, p: dict[str, Any]) -> None:
        tracker.set(p["id"], RUNNING, runtime="local", node_id=f"local-{slot}")
        try:
            output, source = execute_task(p)
            tracker.set(p["id"], COMPLETE, output=output, source=source)
        except Exception as exc:
            tracker.set(p["id"], FAILED, error=str(exc))

    with ThreadPoolExecutor(max_workers=len(todo)) as pool:
        for f in as_completed(pool.submit(work, i, p) for i, p in enumerate(todo)):
            f.result()


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def flower_available() -> bool:
    try:
        import flwr.simulation  # noqa: F401
        import ray  # noqa: F401
    except Exception:
        return False
    return True


def run_workers(
    worker_specs: Iterable[Any],
    on_update: StatusCallback | None = None,
    use_flower: bool | None = None,
) -> list[WorkerResult]:
    """Run worker specs in parallel and return one result per worker.

    worker_specs: dicts or objects with id, role, task, allowed_context,
        private context fragments, network_identity (optional `fail` flag).
    on_update: called with a WorkerResult on every status transition
        (queued -> running -> complete/failed).
    use_flower: force (True) or skip (False) the Flower path. Default: use
        Flower unless CONSTELLATION_RUNTIME=local or Flower is not installed.
    """
    payloads = [_payload(s, i) for i, s in enumerate(worker_specs)]
    if not payloads:
        return []
    tracker = _Tracker(payloads, on_update)

    if use_flower is None:
        use_flower = os.environ.get("CONSTELLATION_RUNTIME", "flower") != "local"
    if use_flower and flower_available():
        try:
            _run_flower(payloads, tracker)
        except Exception:
            log.exception("Flower runtime failed; falling back to local execution")

    # Anything Flower did not finish (or everything, if Flower was skipped).
    _run_local(payloads, tracker)
    return [tracker.results[p["id"]] for p in payloads]
