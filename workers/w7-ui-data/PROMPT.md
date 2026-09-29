# Worker 7 — Frontend Data + Demo State

Read `VISION.md` and `CONTRACT.md` first.

## Objective

Build the thin frontend data layer that lets the finished UI run against deterministic demo data now and the real backend later without changing visual components.

Do NOT redesign or build UI components.

## You own

- `frontend/src/types/**`
- `frontend/src/data/**`
- `frontend/src/state/**`
- `frontend/src/lib/api.*`
- `frontend/src/hooks/**` if useful
- focused tests for this layer

Do NOT modify:
- `backend/**`
- `frontend/src/components/**`
- `frontend/src/styles/**`
- `frontend/src/App.*`
- `frontend/src/main.*`

## Implement

Create frontend-facing types for:
- Mission
- Worker
- SecurityEvent
- MissionResult
- metrics

Keep them compatible with `CONTRACT.md`.

Build deterministic fixtures for the main AI-research demo:
- one confidential mission
- about 8 workers
- realistic roles/tasks
- different context exposure values
- allowed and blocked context
- one literature/research worker that can be attacked
- replacement worker
- final synthesized result

Build a tiny data adapter with two modes:

1. `mock` mode — default and fully deterministic
2. `api` mode — calls the backend contract

Backend endpoints:
- `GET /health`
- `POST /mission`
- `GET /mission/{id}`
- `GET /mission/{id}/workers`
- `POST /workers/{id}/attack`
- `GET /mission/{id}/result`
- `POST /mission/{id}/approve`

Expose a small interface that components can consume, for example:
- createMission
- getMission
- getWorkers
- attackWorker
- getResult
- approveMission

Also implement a simple demo-state helper so mock mode can visibly progress:

mission created -> workers running -> some complete -> selected worker attacked -> quarantined -> replacement appears -> final result

No complex state library is required. Use simple React-friendly state/data structures.

## Important

The UI is the source of truth for the experience.

Do not make components adapt to backend quirks. The adapter should translate backend responses into the frontend view model if needed.

Keep mock mode available even after API mode works so the demo cannot fail because of backend/network issues.

## Acceptance

- deterministic fixtures exist for the complete demo
- the API adapter matches `CONTRACT.md`
- mock and API modes share the same frontend-facing interface
- attack/quarantine/replacement state can be represented
- focused tests pass
- no visual component files are modified

When complete, commit everything to this branch.
Do not merge.
