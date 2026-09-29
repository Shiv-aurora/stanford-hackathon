# Final Integration Worker

Read `VISION.md`, `CONTRACT.md`, the current backend, and the current frontend before changing anything.

## Goal

Make the already-built Constellation frontend and backend run end-to-end through the real subsystem implementations.

This is NOT a feature task and NOT a redesign task.

Preserve the current UI exactly.

## Current state

Already merged on main:

- FastAPI API/state
- deterministic decomposer
- Flower runtime
- security/quarantine module
- trusted coordinator
- React/Vite frontend
- mock frontend mode
- frontend API adapter
- minimal CI

The frontend API route shapes already match the backend. Vite proxies `/api/*` to FastAPI and strips the `/api` prefix.

## Known integration gaps to fix

### 1. Real security module is not wired

`backend/main.py` currently tries to load:

`services.security.quarantine_and_replace`

but the real security module exposes `attack_worker`.

Because of this mismatch, the API silently uses `demo_seed.quarantine_and_replace` instead of the real security implementation.

Fix the wiring so POST `/workers/{worker_id}/attack` uses the real security implementation.

Preserve the API response shape expected by the frontend:

- quarantined worker
- replacement worker
- security event

Do not rewrite the security subsystem.

### 2. Actual context fragments are dropped before execution

The decomposer produces both:

- `allowed_context`: category labels
- `context`: the actual narrow text fragments

But `backend/main.py` only persists the labels, and `flower_runtime.py` currently executes using those labels as if they were the context.

Fix this minimally so each Flower worker receives the actual narrow fragment text while the UI can still display the clean allowed/blocked labels.

A good minimal approach is:

- add an optional internal `context` field to the backend Worker model if needed
- persist `spec.context` when creating workers
- make Flower runtime execution use only values from that worker's own context map
- keep `allowed_context` / `blocked_context` unchanged for the UI
- never send the full mission prompt to ordinary workers

Do not broaden worker visibility.

### 3. Verify API mode end-to-end

Run backend and frontend together.

Use frontend API mode, e.g. `?mode=api`.

Verify this exact flow:

1. create mission
2. 8 AI-research workers appear
3. workers execute
4. inspect worker context exposure
5. attack a worker
6. real security module quarantines it
7. tainted output is excluded
8. replacement worker is created
9. replacement executes
10. other workers remain unaffected
11. mission completes
12. coordinator synthesizes final result
13. approve mission

### 4. Preserve demo fallback

Mock mode must continue to work.

Do not remove deterministic fallback behavior.

## Tests

Run all backend tests.

Run frontend typecheck/build.

Add only focused integration tests needed to prevent interface regressions.

At minimum verify:

- real security function is used
- actual narrow context reaches execution
- no full mission prompt is sent into ordinary worker payloads
- attack -> replacement -> synthesis works
- frontend production build passes

## Scope restrictions

Do NOT:

- redesign UI
- add new pages
- add authentication
- add a database
- add deployment infrastructure
- introduce a new framework
- refactor unrelated code
- change the product concept

Fix only integration issues.

## Done

When everything passes:

1. commit all changes to `worker/integration`
2. push branch
3. do not merge
4. report tests/build results and any remaining limitation
