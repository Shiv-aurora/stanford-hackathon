# Constellation

**Secure parallel agent swarms for confidential work.**

Constellation takes one sensitive task, splits it into narrow compartments, and runs those compartments in parallel across Flower workers.

No ordinary worker receives the full secret.

> **Parallelization gives speed. Compartmentalization gives privacy.**

## Why

Today, powerful AI agents are often given an entire codebase, dataset, research project, credential set, or investigation context.

That creates a large blast radius: if one agent is compromised, prompt-injected, misconfigured, or simply over-privileged, the whole secret can be exposed.

Constellation changes the security model.

A trusted coordinator decomposes the mission into need-to-know tasks. Each worker receives only the minimum context required for its compartment. Workers execute independently and return narrow outputs to the coordinator.

**A compromised worker cannot leak information it never received.**

## Architecture

```text
                         CONFIDENTIAL MISSION
                                  │
                                  ▼
                   ┌──────────────────────────┐
                   │ Flower ServerApp         │
                   │ Trusted Coordinator      │
                   │                          │
                   │ • decompose mission      │
                   │ • assign compartments    │
                   │ • enforce context slices │
                   │ • quarantine workers     │
                   │ • synthesize result      │
                   └─────────────┬────────────┘
                                 │
                 narrow context │ narrow context
                    slices only │
              ┌──────────────────┼──────────────────┐
              ▼                  ▼                  ▼
       ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
       │ ClientApp   │    │ ClientApp   │    │ ClientApp   │
       │ SuperNode 1 │    │ SuperNode 2 │    │ SuperNode 3 │
       │ Worker W-01 │    │ Worker W-02 │    │ Worker W-03 │
       └─────────────┘    └─────────────┘    └─────────────┘
             │                  │                  │
          8% context         11% context         6% context
```

The Flower **ServerApp is the trusted coordinator**. Compartmentalized workers execute as Flower **ClientApps on SuperNodes**.

## Compromise containment

Constellation assumes a worker can fail.

When a worker is compromised:

```text
Prompt injection detected
        ↓
Worker isolated
        ↓
Tainted output invalidated
        ↓
Worker quarantined
        ↓
Replacement dispatched to another node
        ↓
Other compartments continue
        ↓
Trusted coordinator synthesizes only valid outputs
```

The rest of the swarm does not need to restart.

## Demo

The hackathon demo uses confidential AI research.

One research mission is decomposed into workers such as:

- literature
- architecture
- optimizer
- data analysis
- systems
- benchmark
- evaluation
- reviewer

Each worker has a different task and context slice. The UI exposes exactly what a worker can and cannot access.

During the demo, one worker encounters a simulated prompt-injection attack. Constellation quarantines the compartment, discards its output, creates a clean replacement, and continues the mission.

## Features

- Need-to-know mission decomposition
- Narrow per-worker context slices
- Parallel Flower worker execution
- Flower ServerApp trusted coordinator
- Flower ClientApp / SuperNode worker compartments
- Worker context exposure metrics
- Allowed vs blocked context inspection
- Prompt-injection compromise demo
- Automatic quarantine
- Tainted-output rejection
- Clean replacement workers
- Replacement-node avoidance
- Mission progress and swarm metrics
- Trusted final synthesis
- Human approval step
- React/Vite mission-control UI
- FastAPI control plane
- Deterministic fallback mode for demo resilience

## Security model

Implemented in the hackathon prototype:

- context compartmentalization
- separate logical Flower worker nodes
- worker-specific network identity metadata
- quarantine and replacement
- output invalidation
- no direct worker-to-worker context sharing
- trusted coordinator reconstruction

Production extensions would add stronger deployment isolation such as:

- separate containers or VMs
- independent egress identities
- scoped ephemeral credentials
- per-worker network allowlists
- capability-based resource access
- auditable policy enforcement

Those production controls are architectural extensions, not claims about the current prototype.

## Run

### Backend

```bash
cd backend
uv sync
uv run uvicorn main:app --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open the real API-backed demo:

```text
http://localhost:5173/?mode=api
```

The frontend also supports a deterministic standalone demo:

```text
http://localhost:5173/
```

## Run directly with Flower

```bash
cd backend
uv sync
uv run flwr run .
```

Run the built-in compromise scenario:

```bash
uv run flwr run . --run-config 'attack="literature"'
```

The Flower configuration should provide enough SuperNodes for the initial workers plus at least one spare replacement node.

## Tests

```bash
cd backend
uv run pytest
```

```bash
cd frontend
npm run typecheck
npm run build
```

## Stack

- Flower
- Python 3.11+
- FastAPI
- Pydantic
- Ray / Flower Simulation Runtime
- React
- TypeScript
- Vite

## Core idea

Human organizations already protect sensitive operations with compartments and need-to-know access.

**Constellation brings that security model to AI agents.**
