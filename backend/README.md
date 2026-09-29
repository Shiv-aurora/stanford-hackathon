# Constellation

Secure parallel agent swarm for confidential work. The whole mission runs
inside Flower:

- **ServerApp = trusted coordinator.** It decomposes the mission, sends each
  worker only its own task and context slice, quarantines and replaces an
  attacked worker, and synthesizes the final result (`services/swarm.py`).
- **ClientApp = untrusted worker**, one per SuperNode (`services/flower_app.py`).

**A compromised worker cannot leak information it never received.**

## Run with Flower

```bash
uv sync
uv run flwr run .                                    # built-in AI-research demo mission
uv run flwr run . --run-config 'attack="literature"' # inject an attack mid-mission
uv run flwr run . --run-config 'prompt="Confidential: ..."'
```

Set `options.num-supernodes` (in `~/.flwr/config.toml`) to at least the number
of workers plus one spare node for replacements, e.g. 10.

The FastAPI backend (`uvicorn main:app`) runs the same coordinator as one
long-lived ServerApp; `POST /mission` and `POST /workers/{id}/attack` are
handed to it. Set `CONSTELLATION_RUNTIME=local` to run the coordinator over
local threads instead of Flower.

Missions belong to a lab (`"lab": "ai" | "defense" | "biotech"` on
`POST /mission`, default `ai`). Defense and biotech missions get their lab's
8-worker decomposition (see `services/decomposer.py`); `GET /missions?lab=…`
lists one lab's missions.

## Optional model calls

Set `FLWR_MODEL_API_ENDPOINT`, `FLWR_MODEL_ID` and `FLWR_MODEL_API_KEY`
(OpenAI Responses-compatible endpoint) on the nodes, or copy `.env.example` to
a local `.env` (never committed or bundled). Without them, workers return
deterministic seeded output.

## Tests

```bash
uv run pytest
```
