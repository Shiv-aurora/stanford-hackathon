"""In-memory mission/worker storage. Thread-safe: runtime callbacks arrive from worker threads."""

import threading
from typing import Dict, List, Optional

from models import Mission, SecurityEvent, Worker


class Store:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self.missions: Dict[str, Mission] = {}
        self.workers: Dict[str, Worker] = {}
        self.events: Dict[str, List[SecurityEvent]] = {}

    @property
    def lock(self) -> threading.RLock:
        return self._lock

    def reset(self) -> None:
        with self._lock:
            self.missions.clear()
            self.workers.clear()
            self.events.clear()

    def add_mission(self, mission: Mission) -> Mission:
        with self._lock:
            self.missions[mission.id] = mission
            self.events.setdefault(mission.id, [])
            return mission

    def get_mission(self, mission_id: str) -> Optional[Mission]:
        with self._lock:
            return self.missions.get(mission_id)

    def add_worker(self, worker: Worker) -> Worker:
        with self._lock:
            self.workers[worker.id] = worker
            mission = self.missions[worker.mission_id]
            if worker.id not in mission.worker_ids:
                mission.worker_ids.append(worker.id)
            return worker

    def get_worker(self, worker_id: str) -> Optional[Worker]:
        with self._lock:
            return self.workers.get(worker_id)

    def mission_workers(self, mission_id: str) -> List[Worker]:
        with self._lock:
            mission = self.missions.get(mission_id)
            if mission is None:
                return []
            return [self.workers[w] for w in mission.worker_ids if w in self.workers]

    def add_event(self, event: SecurityEvent) -> None:
        with self._lock:
            self.events.setdefault(event.mission_id, []).append(event)


store = Store()
