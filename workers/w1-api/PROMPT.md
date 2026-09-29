# Worker 1 — API + In-Memory Core

Read `VISION.md` and `CONTRACT.md` first.

## Objective

Build the minimal FastAPI backend shell that the UI can talk to.

## You own

- `backend/main.py`
- `backend/models.py`
- `backend/state.py`
- `backend/demo_seed.py` if useful
- focused API/core tests

Do not implement the internals of decomposition, Flower runtime, security, or synthesis.

## Implement

1. Pydantic models matching `CONTRACT.md`.
2. In-memory mission and worker storage.
3. FastAPI app with CORS enabled for local frontend development.
4. Required routes:
   - `GET /health`
   - `POST /mission`
   - `GET /mission/{mission_id}`
   - `GET /mission/{mission_id}/workers`
   - `POST /workers/{worker_id}/attack`
   - `GET /mission/{mission_id}/result`
   - `POST /mission/{mission_id}/approve`
5. Keep route logic thin. It is fine to use small temporary fallback behavior so this branch runs by itself.
6. Make the service boundaries easy to wire after merge.

## Do not build

- database
- auth
- queues
- websockets unless absolutely necessary
- Docker/Kubernetes
- production networking
- UI

## Acceptance

The FastAPI app starts, `/health` works, a mission can be created/read, worker-shaped demo state can be returned, and tests pass.

Finish with a clean commit on your branch.
