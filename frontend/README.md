# Constellation UI

React + Vite rebuild of the Constellation HTML mockup (Mission control, Compartment inspector, Federation). Layout, type, colour, starfield and swarm-map motion are transcribed from the mockup's own markup and render logic; at 1440×900 every text element lands on the same pixel as the original.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-check + production build to dist/
npm run preview    # serve dist/ on http://localhost:4173
```

## Modes

| Mode | How | What it does |
| --- | --- | --- |
| `mock` | `?mode=mock` | Deterministic replay of the demo mission; no backend needed. |
| `api` (default) | no URL override, or `?mode=api` | Talks to FastAPI, which submits missions to SuperGrid. |

In api mode the browser calls `/api/*`, which Vite proxies to `VITE_API_TARGET` (default `http://127.0.0.1:8000`) in both `dev` and `preview`. Set `VITE_API_BASE` to call the backend directly instead (it allows CORS). See `.env.example`.

In api mode the profile block at the bottom of the sidebar switches between the three labs (AI, Defense, Biotech; see `src/lib/labs.ts`). The sidebar lists the current lab's missions (`GET /missions?lab=…`), newest first, with code names in creation order; clicking one opens it. Opening a lab reopens its newest mission, or starts the lab's demo mission if it has none. In mock mode the list is the mockup's static one and the lab is fixed to AI Lab.

Mock extras: `?speed=3` runs the simulation 3× faster (0.25–10).

## Demo script

1. **Overview**: mission Orion, 8 compartmentalized workers running, swarm map, 6% max exposure.
2. Hover a star to see what that worker holds. Click a worker row to open its compartment: task, allowed context (Receives), blocked context (Removed before dispatch), exposure, sandbox and network identity.
3. **Simulate compromise**: Rigel is hit by a prompt injection. It goes through detect, isolate (detached, pushed out of the ring), quarantine (tainted output rejected), and revoke. Then Spica replaces it (NEW) and the other 7 workers keep running.
4. When every fragment finishes, **Review result** opens the coordinator synthesis. Rigel's rejected output is struck through; **Approve result** records human approval.
5. **Chat** (toggle on the Workers card) is the coordinator conversation: the mission, its synthesis, then follow-ups. A follow-up goes only to the workers whose compartment it concerns (they light up on the swarm map); the coordinator answers from their replies.
6. **Conversation** (toggle on a worker's compartment page, or click a worker chip in the chat) shows exactly what the coordinator sent that worker (instruction + context fragments) and everything it replied, and lets you message it directly.
7. **Reset demo** replays the mission. **New mission** starts a new one (in api mode this calls `POST /mission`).

## Structure

```
src/
  lib/types.ts      MissionView / WorkerView: the one shape the components read
  lib/api.ts        data adapter: contract client + backend→view mapping + mode selection
  lib/mock.ts       deterministic mock mission (the mockup's tick/phase formulas)
  lib/useMission.ts React hook over the selected source
  lib/theme.ts      status palette from the mockup
  lib/sky.ts        seeded starfields (same seeds as the mockup)
  components/       Shell (frame, sidebar, sky, header), icons, result/new-mission dialogs
  pages/            Overview, Compartments, Federation
```

The backend has no per-worker progress, so in api mode running workers ease toward 95% until they report `complete`. Containment steps are paced on the client and capped by backend state: no replacement yet caps at Revoke, a queued replacement at Replace, and a running one at Continue.

In API mode, Federation shows the current SuperGrid run and actual node assignments. Follow [backend setup](../backend/README.md) for Flower login and the HTTPS callback bridge. Mock federation statistics remain illustrative.
