# Backend Contract

Read this before coding. Keep the backend small.

## Stack

- Python 3.11+
- FastAPI
- Pydantic
- in-memory state only
- Flower for the worker execution path
- no database

All backend code lives under `backend/`.

## Shared statuses

Worker status must be one of:

- `queued`
- `running`
- `complete`
- `failed`
- `quarantined`
- `replaced`

Mission status can be:

- `created`
- `running`
- `complete`
- `approved`
- `failed`

## Worker shape

Keep the shared worker model compatible with these fields:

```text
id: string
mission_id: string
role: string
task: string
status: WorkerStatus
allowed_context: list[string]
blocked_context: list[string]
context_exposure: float        # 0.0 to 1.0
tainted: bool
quarantined: bool
output: string | null
network_identity: string       # demo metadata such as node-04
replacement_for: string | null
```

Extra timing/error fields are allowed if useful, but do not redesign this object.

## Mission shape

```text
id: string
prompt: string
status: MissionStatus
worker_ids: list[string]
progress: float                # 0.0 to 1.0
result: string | null
approved: bool
```

## Required HTTP API

Keep these routes:

```text
GET  /health
POST /mission
GET  /mission/{mission_id}
GET  /mission/{mission_id}/workers
POST /workers/{worker_id}/attack
GET  /mission/{mission_id}/result
POST /mission/{mission_id}/approve
```

`POST /mission` accepts:

```json
{"prompt": "confidential research objective"}
```

`POST /workers/{worker_id}/attack` is the demo trigger. It should drive the selected worker through the security/quarantine/replacement flow.

## Service interfaces

Subsystems should expose simple Python functions with these responsibilities. Exact internal signatures can vary slightly, but preserve the responsibility boundary.

### Decomposer

```text
decompose_mission(prompt) -> worker specs
```

Creates roughly 6-10 narrow workers. Workers must not receive the complete original context by default.

### Runtime

```text
run_workers(worker specs) -> worker results/status updates
```

Uses the smallest legitimate Flower integration possible and has a deterministic fallback.

### Security

```text
attack/quarantine selected worker
invalidate tainted output
create replacement worker
```

No sophisticated security ML is required.

### Coordinator

```text
collect valid worker outputs
ignore quarantined outputs
synthesize final result
calculate mission progress/basic metrics
```

Only the trusted coordinator reconstructs the final result.

## Demo rules

- Primary scenario: confidential AI research.
- Seeded/deterministic behavior is acceptable.
- Worker network identities are demo metadata, not real networking.
- External LLM calls are optional. The demo must still run if they fail.
- Do not modify frontend code.
- Do not add infrastructure unless required for the core flow.

## Merge rule

Each worker owns its assigned module. Avoid changing shared files outside your ownership unless absolutely necessary.

Every branch should finish with:
- code implemented
- focused tests for its subsystem
- a clean commit
