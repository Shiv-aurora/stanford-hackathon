# Worker UI — Exact Frontend Reconstruction

Read `VISION.md` and `CONTRACT.md` first.

## Objective

Rebuild the provided Constellation HTML mockup as a proper React + Vite frontend while preserving the visual design as exactly as practical.

This is NOT a redesign task.

The supplied Constellation HTML mockup is the visual source of truth.

## You own

Everything under:

- `frontend/**`

Do NOT modify:

- `backend/**`
- `VISION.md`
- `CONTRACT.md`

## Required stack

Use:

- React
- Vite
- normal editable source files
- lightweight CSS/components
- no unnecessary framework additions

Do not keep the original bundled artifact as the runtime implementation.

## Visual requirement

The finished frontend should look as close to the supplied HTML as possible.

Preserve:

- layout
- spacing
- typography
- colors
- borders
- cards/panels
- navigation
- swarm visualization
- worker detail panel
- context exposure information
- quarantine/security states
- metrics
- federation view
- all visible labels and hierarchy

Do not simplify the design.
Do not introduce a different design system.
Do not add generic AI/cybersecurity styling.
Do not change the product concept.

## Demo behavior

The frontend must support the complete demo locally using deterministic mock state:

1. confidential mission shown
2. approximately 8 workers appear
3. workers show running/completed states
4. selecting a worker shows:
   - task
   - allowed context
   - blocked context
   - context exposure
   - node/network identity
5. trigger an attack on one worker
6. worker becomes quarantined
7. tainted output is visibly rejected
8. replacement worker appears
9. other workers continue
10. final synthesized result appears
11. human approval state can be shown

## Data architecture

Create one small frontend data adapter, for example:

`frontend/src/lib/api.ts`

The visual components should consume one stable frontend-facing data shape.

Support two modes:

### mock mode
Default.
Fully deterministic.
Must work with no backend running.

### api mode
Uses the backend endpoints in `CONTRACT.md`:

- `GET /health`
- `POST /mission`
- `GET /mission/{id}`
- `GET /mission/{id}/workers`
- `POST /workers/{id}/attack`
- `GET /mission/{id}/result`
- `POST /mission/{id}/approve`

Do not alter the visual components to accommodate backend quirks. Adapt backend responses inside the data layer.

## Important hackathon constraint

This is a 5-hour demo.

Do NOT add:

- database
- auth
- websocket infrastructure unless absolutely necessary
- complex state management
- new backend
- deployment infrastructure
- unnecessary abstractions

The UI is king.

## Acceptance

Done means:

1. `npm install` works
2. `npm run dev` works
3. production build works
4. UI closely matches the supplied HTML mockup
5. complete demo works in mock mode
6. API adapter exists and matches `CONTRACT.md`
7. backend code is untouched
8. commit everything to `worker/ui`
9. do not merge

Do not stop midway. Finish the entire frontend task, test it, and leave a clean merge-ready branch.
