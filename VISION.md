# Constellation

Constellation is a secure parallel agent swarm for confidential work.

A user gives Constellation one sensitive problem. A trusted local coordinator breaks it into small tasks and sends each worker only the minimum context needed for that task.

Workers run in parallel for speed. No ordinary worker should have enough context to reconstruct the full confidential project.

## Hackathon demo

We are building one real demo: confidential AI research.

Flow:

1. User submits one sensitive research mission.
2. Constellation creates about 8 compartmentalized workers.
3. Each worker receives a narrow task and context slice.
4. Workers execute in parallel.
5. The UI can inspect exactly what each worker can and cannot access.
6. One worker encounters a simulated prompt-injection attack.
7. That worker is quarantined, its output is invalidated, and a replacement is created.
8. Other workers continue.
9. The trusted coordinator reconstructs the final answer.

Core security claim:

**A compromised worker cannot leak information it never received.**

Core product thesis:

**Parallelization gives speed. Compartmentalization gives privacy.**

## Flower

Use Flower materially, but minimally.

The demo should truthfully use Flower in the worker execution path. Do not build production federation infrastructure.

Longer term, separate organizations could use Flower to improve shared routing/security models without sharing their confidential underlying projects. That future layer does not need to be fully implemented for this hackathon.

## What is simulated

For the demo, workers may display separate node or IP identities. We are NOT implementing real multi-machine networking or IP isolation during the hackathon.

The UI may represent the intended isolated deployment architecture. Do not claim separate IPs alone provide security.

## Build constraint

This is a 5-hour hackathon.

Backend exists to make the UI demo real.

Do not build:
- Kubernetes
- production auth
- persistent database
- real multi-IP networking
- universal policy engines
- multiple domain backends
- elaborate infrastructure

Prefer:
- FastAPI
- in-memory state
- deterministic demo fallbacks
- small modules
- simple tests

The only backend flow that must work is:

**mission -> decomposition -> parallel workers -> attack -> quarantine -> replacement -> final synthesis**
