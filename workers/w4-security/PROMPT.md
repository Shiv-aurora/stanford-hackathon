# Worker 4 — Security + Quarantine

Read `VISION.md` and `CONTRACT.md` first.

## Objective

Implement the demo security path: compromise one worker, quarantine only that compartment, invalidate its output, create a clean replacement, and let the mission continue.

## You own

- `backend/services/security.py`
- focused security tests

Avoid editing shared API/model files.

## Implement

Keep this simple.

Support:
- lightweight prompt-injection detection using obvious patterns/heuristics
- mark worker `tainted = true`
- move worker to `quarantined`
- invalidate/discard its output
- create a replacement worker with the same narrow task/context
- set `replacement_for`
- assign a new demo `network_identity`
- produce a small security-event payload the API/UI can display

The attack button may explicitly trigger this path. We do not need a production detector.

Core demo invariant:

**Compromising one worker must not expose or mutate the context of unrelated workers.**

## Do not build

- ML security classifier
- real credential systems
- real network isolation
- policy DSL
- SIEM/logging platform

## Acceptance

A test can take one normal worker, inject/trigger an attack, quarantine it, invalidate its output, spawn a replacement, and verify unrelated workers are untouched.

Finish with a clean commit on your branch.
