"""Web-side SuperGrid launcher and authenticated state mirror.

Uses the supported Flower CLI for submission and private ServerApp logs. The
web process does not decompose, execute, quarantine, or synthesize remote work.
All those operations take place inside the submitted ServerApp.
"""
from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
import uuid
from concurrent.futures import Future
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from models import AttackResponse, Mission, MissionStatus, Worker
from services.remote_protocol import ANNOUNCEMENT, signing_bytes, validate_bridge_url
from state import store

ROOT = Path(__file__).resolve().parents[1]
router = APIRouter(prefix="/internal/supergrid")


@dataclass
class Session:
    mission_id: str
    public_key: Ed25519PublicKey | None = None
    run_id: str | None = None
    seen: dict[str, float] = field(default_factory=dict)
    commands: dict[str, dict] = field(default_factory=dict)
    futures: dict[str, Future] = field(default_factory=dict)
    last_contact: float = field(default_factory=time.monotonic)
    connected: bool = False
    closed: bool = False


class Snapshot(BaseModel):
    workers: list[Worker] = Field(default_factory=list)
    status: MissionStatus
    result: str | None = None
    error: str | None = None
    responses: dict[str, dict[str, Any]] = Field(default_factory=dict)
    closed: bool = False


class SuperGrid:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.lock = threading.RLock()

    def settings(self) -> tuple[str, str, str]:
        federation = os.environ.get("CONSTELLATION_FEDERATION", "@qxh2001/security")
        if not re.fullmatch(r"@[\w.-]+/[\w.-]+", federation):
            raise ValueError("CONSTELLATION_FEDERATION must be @account/federation")
        bridge = validate_bridge_url(os.environ.get("CONSTELLATION_BRIDGE_URL", ""))
        cli = shutil.which("flwr")
        if not cli:
            raise ValueError("Flower CLI not found; launch the backend using uv run")
        return federation, bridge, cli

    def submit(self, mission: Mission) -> None:
        federation, bridge, cli = self.settings()
        with self.lock, store.lock:
            self.sessions[mission.id] = Session(mission.id)
            mission.runtime = "supergrid"
            mission.federation = federation
        threading.Thread(target=self._launch, args=(mission.id, federation, bridge, cli),
                         name=f"supergrid-{mission.id}", daemon=True).start()

    @staticmethod
    def _cli(cli: str, args: list[str], timeout: float = 120) -> dict:
        result = subprocess.run([cli, *args, "--format", "json"], cwd=ROOT,
                                capture_output=True, text=True, timeout=timeout, stdin=subprocess.DEVNULL)
        try:
            body = json.loads(result.stdout)
        except ValueError:
            raise RuntimeError("Flower CLI returned invalid JSON; check Flower installation and login") from None
        if result.returncode or not body.get("success"):
            raise RuntimeError(str(body.get("error-message", "Flower command failed")))
        return body

    def _launch(self, mission_id: str, federation: str, bridge: str, cli: str) -> None:
        session = self.sessions[mission_id]
        logs = None
        try:
            # Keep the config outside the FAB. It contains identifiers only:
            # no prompt, API credentials, model keys, or signing secrets.
            config = {"bridge-url": bridge, "mission-id": mission_id,
                      "min-nodes": int(os.environ.get("CONSTELLATION_FLOWER_NODES", "9")),
                      "control-ttl": int(os.environ.get("CONSTELLATION_CONTROL_TTL", "900"))}
            with tempfile.NamedTemporaryFile(mode="w", suffix=".toml") as file:
                file.write("\n".join(f"{k} = {json.dumps(v)}" for k, v in config.items()))
                file.flush()
                body = self._cli(cli, ["run", ".", "supergrid", "--federation", federation,
                                       "--run-config", file.name])
            run_id = str(body["run-id"])
            if not run_id.isdigit():
                raise RuntimeError("Flower returned an invalid run ID")
            with self.lock, store.lock:
                session.run_id = run_id
                store.missions[mission_id].run_id = run_id
            logs = subprocess.Popen([cli, "log", run_id, "supergrid"], cwd=ROOT,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                    stdin=subprocess.DEVNULL, text=True, env={**os.environ, "PYTHONUNBUFFERED": "1"})
            threading.Thread(target=self._read_key, args=(session, logs), daemon=True).start()
            started = time.monotonic()
            while not session.closed:
                elapsed = time.monotonic() - (session.last_contact if session.connected else started)
                if elapsed > (90 if session.connected else 240):
                    raise RuntimeError("SuperGrid coordinator is unreachable; check the run logs and public bridge URL")
                if logs.poll() is not None:
                    raise RuntimeError("SuperGrid log stream ended before the control session closed")
                time.sleep(1)
        except Exception as exc:
            self.fail(mission_id, str(exc))
        finally:
            if logs is not None and logs.poll() is None:
                logs.terminate()
                try:
                    logs.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    logs.kill()
                    logs.wait()
            if session.run_id:
                try:
                    self._cli(cli, ["stop", session.run_id, "supergrid"], timeout=30)
                except Exception:
                    pass  # The run may already have ended; preserve the original result/error.

    def _read_key(self, session: Session, logs: Any) -> None:
        # Only the first pre-dispatch ServerApp announcement is accepted. Clients
        # are not dispatched until the resulting signed handshake succeeds.
        for line in logs.stdout:
            clean = re.sub(r"\x1b\[[0-9;]*m", "", line).strip()
            if not clean.startswith(ANNOUNCEMENT):
                continue
            try:
                value = json.loads(clean[len(ANNOUNCEMENT):])
                if value["mission_id"] != session.mission_id or str(value["run_id"]) != session.run_id:
                    continue
                key = Ed25519PublicKey.from_public_bytes(base64.b64decode(value["public_key"], validate=True))
            except (ValueError, KeyError):
                continue
            with self.lock:
                if session.public_key is None and not session.closed:
                    session.public_key = key

    def verify(self, mission_id: str, request: Request, body: bytes) -> Session:
        with self.lock:
            session = self.sessions.get(mission_id)
            if not session or not session.public_key or session.closed:
                raise HTTPException(403, "No authenticated ServerApp session")
            stamp = request.headers.get("x-constellation-time", "")
            nonce = request.headers.get("x-constellation-nonce", "")
            try:
                if abs(time.time() - float(stamp)) > 60 or not re.fullmatch(r"[a-f0-9]{32}", nonce):
                    raise ValueError()
                session.seen = {n: t for n, t in session.seen.items() if time.time() - t < 120}
                if nonce in session.seen:
                    raise ValueError()
                signature = base64.b64decode(request.headers.get("x-constellation-signature", ""), validate=True)
                session.public_key.verify(signature, signing_bytes(request.method, request.url.path, stamp, nonce, body))
            except (ValueError, InvalidSignature):
                raise HTTPException(403, "Invalid ServerApp signature") from None
            session.seen[nonce] = time.time()
            session.last_contact = time.monotonic()
            return session

    def apply(self, session: Session, value: Snapshot) -> dict:
        with self.lock, store.lock:
            mission = store.missions[session.mission_id]
            session.connected = True
            if any(w.mission_id != mission.id for w in value.workers):
                raise HTTPException(422, "Worker belongs to a different mission")
            if len({w.id for w in value.workers}) != len(value.workers):
                raise HTTPException(422, "Duplicate worker ID")
            nodes = [w.node_id for w in value.workers if w.node_id]
            if len(nodes) != len(set(nodes)):
                raise HTTPException(422, "Workers must have distinct SuperNodes")
            if mission.approved:
                session.closed = True
                return {"approved": True, "commands": []}
            for worker in value.workers:
                worker.runtime = "supergrid"
                store.add_worker(worker)
            mission.status = value.status
            mission.result = value.result
            mission.error = value.error
            from services.coordinator import progress
            mission.progress = progress(value.workers)
            mission.control_available = not value.closed
            for cid, response in value.responses.items():
                future = session.futures.get(cid)
                if future is None or future.done():
                    continue
                if response.get("error"):
                    future.set_exception(ValueError(response["error"]))
                else:
                    future.set_result(AttackResponse.model_validate(response["result"]))
                session.commands.pop(cid, None)
            if session.commands:
                mission.status, mission.result = MissionStatus.RUNNING, None
            if value.closed:
                session.closed = True
                for future in session.futures.values():
                    if not future.done():
                        future.set_exception(RuntimeError("SuperGrid control window closed"))
            return {"approved": False, "commands": list(session.commands.values())}

    def attack(self, worker_id: str) -> Future:
        with self.lock, store.lock:
            worker = store.workers[worker_id]
            mission = store.missions[worker.mission_id]
            session = self.sessions.get(mission.id)
            if not session or session.closed or not mission.control_available:
                raise ValueError("SuperGrid control session is unavailable")
            if mission.approved or worker.quarantined:
                raise ValueError("Mission approved or worker already quarantined")
            if session.commands:
                raise ValueError("An attack is already awaiting the coordinator")
            cid = uuid.uuid4().hex
            future = session.futures[cid] = Future()
            session.commands[cid] = {"id": cid, "worker_id": worker_id}
            # A previous result cannot be approved while attack handling is pending.
            mission.status, mission.result = MissionStatus.RUNNING, None
            return future

    def approve(self, mission: Mission) -> None:
        with self.lock, store.lock:
            session = self.sessions.get(mission.id)
            if session and session.commands:
                raise ValueError("Wait for the pending attack to finish")
            if mission.status != MissionStatus.COMPLETE and not mission.approved:
                raise ValueError("Mission not complete")
            mission.approved, mission.status = True, MissionStatus.APPROVED
            mission.control_available = False
            # ServerApp observes approval on its next signed sync and exits.

    def shutdown(self) -> None:
        # Stop known cloud runs before the web process exits; daemon launchers
        # alone cannot guarantee their finally blocks run on interpreter exit.
        with self.lock:
            active = [s for s in self.sessions.values() if not s.closed]
        cli = shutil.which("flwr")
        for session in active:
            self.fail(session.mission_id, "Web control plane stopped")
            if cli and session.run_id:
                try:
                    self._cli(cli, ["stop", session.run_id, "supergrid"], timeout=10)
                except Exception:
                    pass  # Remote control TTL still bounds an unreachable run.

    def fail(self, mission_id: str, error: str) -> None:
        with self.lock, store.lock:
            session = self.sessions[mission_id]
            session.closed = True
            mission = store.missions.get(mission_id)
            if mission:
                mission.control_available = False
                mission.error = error
                if not mission.approved:
                    mission.status, mission.result = MissionStatus.FAILED, None
            for future in session.futures.values():
                if not future.done():
                    future.set_exception(RuntimeError(error))


supergrid = SuperGrid()


@router.post("/{mission_id}/session")
async def open_session(mission_id: str, request: Request) -> dict:
    supergrid.verify(mission_id, request, await request.body())
    with store.lock:
        return {"prompt": store.missions[mission_id].prompt}


@router.post("/{mission_id}/sync")
async def sync_session(mission_id: str, request: Request) -> dict:
    raw = await request.body()
    session = supergrid.verify(mission_id, request, raw)
    try:
        snapshot = Snapshot.model_validate_json(raw)
    except ValueError:
        raise HTTPException(422, "Invalid coordinator snapshot") from None
    return supergrid.apply(session, snapshot)
