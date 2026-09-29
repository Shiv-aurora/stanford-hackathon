# Constellation

Secure parallel agent swarm for confidential work. A trusted coordinator splits
one sensitive mission into narrow worker tasks; each worker runs as a Flower
`ClientApp` on its own SuperNode and receives only its own task and context slice.

**A compromised worker cannot leak information it never received.**

## Run with Flower

```bash
uv sync
uv run flwr run .                       # built-in demo: 4 workers
uv run flwr run . --run-config 'worker-specs="[{\"id\":\"w1\",\"role\":\"data\",\"task\":\"Profile dataset\",\"allowed_context\":[\"schema\"]}]"'
```

Missions belong to a lab (`"lab": "ai" | "defense" | "biotech"` on
`POST /mission`, default `ai`). Defense and biotech missions get their lab's
8-worker decomposition (see `services/decomposer.py`); `GET /missions?lab=…`
lists one lab's missions.

A worker spec has `id`, `role`, `task`, `allowed_context` and optional
`network_identity`. Keep `num-supernodes` >= the number of workers.

## Optional model calls

Set `FLWR_MODEL_API_ENDPOINT`, `FLWR_MODEL_ID` and `FLWR_MODEL_API_KEY`
(OpenAI Responses-compatible endpoint) on the nodes, or copy `.env.example` to
a local `.env` (never committed or bundled). Without them, workers return
deterministic seeded output.

## Tests

```bash
uv run pytest
```
