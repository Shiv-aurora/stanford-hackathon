"""Cloud-side bookkeeping for the chat UI; only narrow tasks go to worker nodes."""
from __future__ import annotations

import re
import threading
import time
import uuid
from typing import Any

from services.decomposer import decompose_mission, route_question
from services.flower_app import StandaloneMission
from services.flower_runtime import write_final_answer
from services.security import detect_injection


def entry(kind: str, text: str, **extra: Any) -> dict:
    return {"id": f"e-{uuid.uuid4().hex[:8]}", "kind": kind, "text": text, "at": time.time(), **extra}


def sanitize(text: str) -> str:
    pieces = text.splitlines() if "\n" in text else re.split(r"(?<=[.!?])\s+", text)
    return ("\n" if "\n" in text else " ").join(p for p in pieces if not detect_injection(p))


class RemoteMission(StandaloneMission):
    def __init__(self, session: dict, mission_id: str, swarm: Any):
        super().__init__(session["prompt"], mission_id)
        self.lab = session.get("lab", "ai")
        self.mode = session.get("mode", "chat")
        self.model = session.get("model", "")
        self.swarm = swarm
        self.chat = session.get("chat") or [
            {"id": "initial-user", "role": "user", "text": self.prompt, "at": time.time()},
            {"id": "initial-answer", "role": "coordinator", "kind": "mission", "at": time.time()},
        ]
        self.answer = None
        self.answer_status = "none"
        self._revision = 0
        self._containments: dict[str, Any] = {}

    def decompose(self) -> list[dict]:
        domain = "code" if self.mode == "code" else self.lab
        for spec in decompose_mission(self.prompt, self.mission_id, domain=domain):
            worker = {**spec.model_dump(), "mission_id": self.mission_id, "status": "queued",
                      "output": None, "tainted": False, "quarantined": False,
                      "replacement_for": None, "model": self.model, "answering": False}
            worker["log"] = [entry("dispatch", worker["task"], context=dict(worker["context"]))]
            self.workers[worker["id"]] = worker
        return list(self.workers.values())

    def on_update(self, update: dict) -> None:
        worker = self.workers[update["worker_id"]]
        status = update.get("status")
        if worker.get("pending_message"):
            if status in ("complete", "failed"):
                self._finish_reply(worker, update.get("output"), update.get("error"))
            return
        before = worker["status"]
        super().on_update(update)
        if status == "complete" and before != "complete":
            worker["log"].append(entry("reply", worker["output"] or ""))
            hits = {h for text in worker["context"].values() for h in detect_injection(text)}
            if len(hits) >= 2 and not worker["quarantined"]:
                # Hold this result until the coordinator has replaced this worker.
                worker["status"] = "running"
                self._containments[worker["id"]] = self.swarm.attack(self.mission_id, worker["id"])
        elif status == "failed" and before != "failed":
            worker["log"].append(entry("error", worker.get("error") or "worker failed"))

    def check_containment(self) -> None:
        for wid, future in list(self._containments.items()):
            if future.done():
                future.result()  # containment failures must fail the run, not release tainted results
                del self._containments[wid]

    def attack(self, worker_id: str) -> tuple:
        worker = self.workers[worker_id]
        if worker.get("pending_message"):
            self._finish_reply(worker, None, "quarantined before replying")
        event, replacement = super().attack(worker_id)
        self._revision += 1
        self.answer, self.answer_status = None, "none"
        worker["log"].append(entry("security", event["message"]))
        if replacement is not None:
            replacement["context"] = {k: sanitize(v) for k, v in worker["context"].items()}
            replacement["answering"] = False
            replacement.pop("pending_message", None)
            replacement["log"] = [entry("dispatch", replacement["task"], context=dict(replacement["context"]),
                                        note=f"Replacement for {worker_id} · injected instructions removed")]
            alert = {"id": f"c-{uuid.uuid4().hex[:8]}", "role": "coordinator", "kind": "security",
                     "text": event.get("attack_preview", event["message"]),
                     "routed_to": [worker_id, replacement["id"]], "at": time.time()}
            at = next((i for i, m in enumerate(self.chat) if m.get("kind") == "mission"), len(self.chat))
            self.chat.insert(at, alert)
        return event, replacement

    def finish(self) -> None:
        self.check_containment()
        if self._containments or any(w["status"] not in ("complete", "failed")
                                     for w in self.workers.values() if not w["quarantined"]):
            return
        if self.result is not None:
            return  # follow-ups never overwrite the original task synthesis
        super().finish()
        revision = self._revision
        self.answer_status = "writing"
        findings = [(w["role"], w["output"]) for w in self.workers.values()
                    if w["status"] == "complete" and not w["quarantined"] and not w["tainted"] and w["output"]]

        def write() -> None:
            answer = write_final_answer(sanitize(self.prompt), findings, self.model or None)
            if revision == self._revision:
                self.answer = answer
                self.answer_status = "done" if answer else "failed"
        threading.Thread(target=write, daemon=True).start()

    def followup(self, text: str, worker_id: str | None = None) -> Any:
        if not self.result or any(w.get("answering") for w in self.workers.values()):
            raise ValueError("Wait for the mission and pending replies to finish")
        ready = [w for w in self.workers.values()
                 if w["status"] == "complete" and not w["quarantined"] and not w["tainted"]]
        categories = sorted(route_question(text, self.lab))
        if worker_id:
            routed = [w for w in ready if w["id"] == worker_id]
        else:
            routed = [w for w in ready if set(categories) & set(w["allowed_context"])]
            if not routed:
                routed, categories = ready, []
        if not routed:
            raise ValueError("No worker is available for this question")
        mid = f"c-{uuid.uuid4().hex[:8]}"
        question = {"id": f"c-{uuid.uuid4().hex[:8]}", "role": "user", "text": text, "at": time.time()}
        answer = {"id": mid, "role": "coordinator", "text": None, "pending": True,
                  "routed_to": [w["id"] for w in routed], "categories": categories,
                  "replies": {}, "question": text, "at": time.time()}
        if not worker_id:
            self.chat += [question, answer]
        for worker in routed:
            worker["answering"], worker["pending_message"] = True, mid
            log_entry = entry("operator" if worker_id else "coordinator", text, message_id=mid)
            worker["log"].append(log_entry)
            self.swarm.dispatch(self.mission_id, {**worker, "message": text})
        return log_entry if worker_id else [question, answer]

    def _finish_reply(self, worker: dict, output: str | None, error: str | None = None) -> None:
        mid = worker.pop("pending_message")
        worker["answering"] = False
        worker["log"].append(entry("reply" if output else "error", output or error or "no reply", message_id=mid))
        for msg in self.chat:
            if msg["id"] != mid:
                continue
            msg["replies"][worker["id"]] = output
            if len(msg["replies"]) == len(msg["routed_to"]):
                findings = [(self.workers[wid]["role"], msg["replies"][wid])
                            for wid in msg["routed_to"] if msg["replies"][wid]]
                details = "\n".join(f"- {role}: {reply}" for role, reply in findings)
                msg["writing"] = True
                def write(msg=msg, findings=findings, details=details) -> None:
                    answer = write_final_answer(sanitize(msg["question"]), findings, self.model or None)
                    msg.update(text=answer or details, details=details if answer else None, writing=False, pending=False)
                threading.Thread(target=write, daemon=True).start()
