# Worker 6 — UI Framework Conversion

Read `VISION.md` and `CONTRACT.md` first.

## Objective

Turn the provided Constellation UI mockup into a normal editable React/Vite frontend while preserving the design as exactly as practical.

The mockup is already designed. Do NOT redesign it.

## You own

- `frontend/package.json`
- `frontend/index.html`
- `frontend/vite.config.*`
- `frontend/src/main.*`
- `frontend/src/App.*`
- `frontend/src/components/**`
- `frontend/src/styles/**`
- frontend assets needed to reproduce the reference

Do NOT modify:
- `backend/**`
- `frontend/src/lib/**`
- `frontend/src/data/**`
- `frontend/src/state/**`
- `frontend/src/types/**`

Those paths belong to the UI data worker.

## Reference

Use the provided Constellation HTML mockup as the visual source of truth.

Preserve:
- overall layout
- spacing
- typography
- colors
- borders
- cards/panels
- sidebar/navigation
- swarm graph
- worker detail/compartment view
- security/quarantine states
- federation view
- visible metrics

Do not invent new visual language.
Do not simplify the design because it is easier to code.

## Implementation

Use React + Vite.

For data, components may temporarily accept local inline placeholder props if needed. Keep data dependencies shallow so the final API/state layer can be wired in without changing the visual components.

The UI must support the visible demo states:
- mission view
- live workers
- worker selected/details
- quarantined worker
- replacement worker
- final result

Do not implement backend logic.

## Acceptance

- `npm install` and `npm run dev` work
- the frontend visually matches the supplied mockup closely
- major interactions/screens represented by the mockup render correctly
- no backend code is added
- tests/build pass if configured

When complete, commit everything to this branch.
Do not merge.
