# Worker 2 — Task Decomposition + Context Fragmentation

Read `VISION.md` and `CONTRACT.md` first.

## Objective

Implement the core Constellation behavior: turn one confidential research mission into a small swarm of narrow workers that each receive only a fragment of context.

## You own

- `backend/services/decomposer.py`
- focused decomposer tests

Avoid editing shared API/model files.

## Implement

Create a function equivalent to:

```python
decompose_mission(prompt: str) -> list[WorkerSpec]
```

For the primary AI-research demo, create about 8 workers such as:

- literature
- architecture
- optimizer
- data analysis
- systems
- benchmark
- evaluation
- reviewer

Each worker needs:
- id/role
- narrow task
- allowed_context
- blocked_context
- context_exposure between 0 and 1
- demo network identity such as `node-04`

Important: do not copy the entire original mission into every worker task/context.

Use a deterministic demo decomposition so the hackathon demo never depends on an LLM. A small generic fallback for arbitrary prompts is enough.

Do not build a general planning framework.

## Acceptance

Given one confidential AI-research prompt, the module returns 6-10 useful worker specs, no worker receives full project context, exposure values are valid, and tests pass.

Finish with a clean commit on your branch.
