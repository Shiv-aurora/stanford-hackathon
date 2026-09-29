# Worker 3 — Flower Runtime

Read `VISION.md` and `CONTRACT.md` first.

## Objective

Implement the smallest legitimate Flower-backed execution path for Constellation workers.

This is a hackathon demo, not production infrastructure.

## You own

- `backend/services/flower_runtime.py`
- any tiny Flower-specific config/module strictly needed for this runtime
- focused runtime tests

Avoid editing shared API/model files.

## Implement

Provide a simple runtime equivalent to:

```python
run_workers(worker_specs) -> worker results/status updates
```

Requirements:
- use Flower materially in the execution path
- support multiple compartmentalized worker tasks
- workers can run concurrently/parallel where practical
- produce simple status transitions: queued -> running -> complete/failed
- return worker outputs
- preserve each worker's narrow context
- provide a deterministic local fallback so the demo still works if external model/network setup fails

The worker output can be seeded or lightweight. The purpose is to prove the distributed/collaborative execution concept, not model intelligence.

## Do not build

- Kubernetes
- real multi-machine networking
- real IP isolation
- production federation deployment
- complicated queues
- a general agent framework

## Acceptance

A small list of worker specs can be executed through the Flower-backed path and produce results/statuses. The fallback path also works. Tests pass.

Finish with a clean commit on your branch.
