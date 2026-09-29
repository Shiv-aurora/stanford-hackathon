# Worker 5 — Trusted Coordinator + Final Synthesis

Read `VISION.md` and `CONTRACT.md` first.

## Objective

Implement the trusted local coordinator that combines valid worker results into the final mission result.

## You own

- `backend/services/coordinator.py`
- focused coordinator tests

Avoid editing shared API/model files.

## Implement

Provide simple functions that:
- calculate mission progress
- collect completed worker outputs
- ignore failed/quarantined/tainted outputs
- accept replacement-worker outputs
- synthesize one final result
- expose basic metrics:
  - total workers
  - completed workers
  - quarantined workers
  - max context exposure
- support final human approval state through a small helper if useful

Use deterministic synthesis as the default. Optional LLM synthesis is fine only if there is always a fallback.

Only this trusted coordinator reconstructs the combined result. Do not send the reconstructed result back into ordinary workers.

## Do not build

- complex dependency scheduler
- long-term memory
- database
- general workflow engine

## Acceptance

Given a mixed set of complete, quarantined, and replacement workers, the coordinator ignores unsafe outputs, computes progress/metrics correctly, produces a final result, and tests pass.

Finish with a clean commit on your branch.
