# Constellation on SuperGrid

The default web runtime submits one Flower run per mission to
`@qxh2001/security`. The **ServerApp runs on SuperGrid** and owns decomposition,
worker dispatch, quarantine/replacement, and synthesis. Each **worker gets one
previously unused SuperNode**, which executes the ClientApp. A node stays
reserved for the whole run, even after its task finishes. Replacements use
fresh nodes; there is no least-loaded reuse or local fallback in SuperGrid mode.

```text
                   SuperGrid / ServerApp
                    ├─ Worker SuperNode A / ClientApp
                    ├─ Worker SuperNode B / ClientApp
                    ├─ Replacement SuperNode / ClientApp
                    └─ Trusted control SuperNode / ClientApp
                         └─ Loopback FastAPI ↔ Browser
```

## Configure and run

From `backend/`:

```bash
uv sync
uv run flwr login supergrid
uv run flwr federation list supergrid --federation @qxh2001/security
cp .env.example .env
```

Set `CONSTELLATION_CONTROL_NODE_ID` to a dedicated, trusted SuperNode in this
federation. The coordinator uses Flower `query.control` messages to exchange
signed requests with this node; its ClientApp relays them only to the loopback
API. No public HTTPS endpoint, tunnel or inbound port is required.

Start that control node alongside the local backend (after registering its own
key and adding it to the federation):

```bash
uv run flower-supernode --superlink fleet-supergrid.flower.ai:443 \
  --auth-supernode-private-key /absolute/path/to/control-node-private-key \
  --host 127.0.0.1 --port 9110 --allow-runtime-dependency-installation \
  --node-config 'constellation-control=true constellation-api="http://127.0.0.1:8011"'
uv run uvicorn main:app --host 127.0.0.1 --port 8011
```

Only the trusted control node gets `constellation-control=true`. It can see the
whole mission and must be isolated from untrusted worker operators. It refuses
worker tasks and is excluded from all worker allocation and capacity counts.
Worker nodes reject control requests. Signature, timestamp and replay checks
still run on the API; no credentials or full mission are placed in run-config.

The research demo requires **10 registered SuperNodes**: one control node, eight
original workers and one fresh replacement. `CONSTELLATION_FLOWER_NODES=9`
counts only worker capacity. More replacements need more fresh worker nodes.

Run one backend process without auto-reload; control sessions are in memory.
From `frontend/`, run `npm ci` then:

```bash
VITE_API_TARGET=http://127.0.0.1:8011 npm run dev
```

API mode is the default. The UI shows the run ID and actual worker SuperNode IDs.
An existing mission can be opened with `?mission=m-...`. Use `?mode=mock` only
for the standalone visual preview.

The optional HTTPS transport remains available when `CONSTELLATION_CONTROL_NODE_ID`
is empty and `CONSTELLATION_BRIDGE_URL` is set; its setup follows below.

## Local-only callback proxy

When the API remains on a laptop, run the restricted callback proxy separately:

```bash
# First terminal: ordinary API, kept on loopback.
uv run uvicorn main:app --host 127.0.0.1 --port 8011
# Second terminal: callbacks only, also loopback until a tunnel is authorized.
uv run uvicorn callback_proxy:app --host 127.0.0.1 --port 8012
```

The proxy permits only POST requests to `/internal/supergrid/{mission}/session`
and `/internal/supergrid/{mission}/sync`, preserves signed bytes/headers, and
limits callback bodies to 2 MiB. Mission, worker, documentation and health
routes are unavailable through this proxy. Set `CONSTELLATION_LOCAL_API` if the
ordinary API uses another loopback port.

After authorizing a tunneling provider, point its HTTPS tunnel at **port 8012**,
set `CONSTELLATION_BRIDGE_URL` to the generated HTTPS origin, and restart the
ordinary API. A tunnel provider can handle plaintext at TLS termination; use
synthetic demo missions for initial connectivity testing. Temporary URLs stop
working when the tunnel exits and may change when restarted.

A public URL reachable from your browser is not sufficient: SuperGrid's outbound
proxy must permit that destination too. If the cloud log says
`Bridge handshake retry: Tunnel connection failed: 403 Forbidden`, the request
was rejected before reaching the callback proxy. Ask the Flower administrator
to allow the HTTPS callback destination (or provide an approved endpoint).
Do not disable TLS verification or remove callback authentication to address it.
The synthetic CLI smoke test below can still validate worker execution without
the web callback, but does not validate the interactive web workflow.

## How the web bridge works

1. FastAPI runs `flwr run . supergrid --federation ... --format json` and records
   the returned run ID. The run-config carries only a mission ID, HTTPS bridge
   address, minimum node count and control timeout. The mission text and secrets
   are **not** put in run-config or the Flower App Bundle; ClientApps can access
   shared run-config.
2. Before starting any ClientApps, ServerApp generates an ephemeral Ed25519 key
   and announces its **public** key in that run's private server log. The API
   pins that key from the authenticated `flwr log` stream. This relies on the
   trusted SuperGrid control/log channel. Private signing material stays in the
   ServerApp process and is never sent to clients or logs.
3. ServerApp signs HTTPS requests to fetch the mission and exchange snapshots
   and commands. The API checks signatures, timestamps and single-use nonces.
   Worker messages contain only their individual task/context slice.
4. The API mirrors public worker state; raw context fragments stay remote.
   Browser attack requests become idempotent commands executed by ServerApp.
   A pending attack prevents approval of stale synthesis.
5. Human approval ends the control session and run. Otherwise the control
   window expires after `CONSTELLATION_CONTROL_TTL` seconds (default 900).
   Startup/connection failures are reported in mission state, never silently
   executed locally. Run shutdown is attempted on backend shutdown/failure.

Trust includes the web control plane and the SuperGrid environment hosting
ServerApp. SuperNode ownership is enforced **within each run**; infrastructure
must isolate concurrent runs and reset node environments as appropriate.
A SuperNode ID is not a claim of an independent VM, container or IP address.
The current attack demo invalidates outputs and stops assigning work to a
compromised node; it does not revoke that node's infrastructure credentials.

## CLI smoke test (public synthetic demo only)

This runs the built-in non-secret sample without the web bridge:

```bash
uv run flwr run . supergrid --federation @qxh2001/security \
  --run-config 'attack="literature"' --stream
```

Use the web bridge for confidential prompts. Do not pass secrets through shared
`--run-config prompt=...`. For a local development simulation use
`CONSTELLATION_RUNTIME=flower`; for local threads use
`CONSTELLATION_RUNTIME=local`. Neither is used automatically in SuperGrid mode.

Optional model calls require `FLWR_MODEL_API_ENDPOINT`, `FLWR_MODEL_ID` and
`FLWR_MODEL_API_KEY` on the worker nodes. Without them, worker outputs are
seeded/deterministic. Do not pass model credentials through shared run-config.

## Verify

```bash
uv run pytest
uv run flwr build
```

Tests cover signed bridge requests and replay rejection, the full web→remote
coordinator→worker→attack→replacement→approval flow with a simulated Grid,
unique node allocation, exhausted capacity, timeouts, and existing modules.
Cloud acceptance additionally requires an authenticated Flower account, a
configured federation and a reachable HTTPS bridge.

References: [run apps on SuperGrid](https://flower.ai/docs/framework/how-to-run-flower-apps-on-supergrid.html),
[CLI JSON output](https://flower.ai/docs/framework/how-to-use-cli-json-output.html).


## Live validation — 2026-09-29

Federation: `@qxh2001/security`. ServerApp executed on SuperGrid; nine registered
SuperNodes ran as separate processes with separate identities/runtime directories
on one development machine. Worker outputs used the built-in deterministic demo,
without an external model API.

- Run `5332936222788350605` finished as `finished:completed`.
- Eight original workers were assigned eight distinct real SuperNode IDs.
- The literature worker on `322420576836707870` was quarantined; its replacement
  ran on unused node `18192719775122554503`.
- Final synthesis reported `Coverage: 8/8` and excluded one quarantined output.
- The `CONSTELLATION_RUN_SUMMARY` log entry records the worker/node mapping.

The original HTTPS web flow failed its cloud test. Run `6218429797578914393` failed
before retrieving the mission: SuperGrid's outbound proxy returned
`Tunnel connection failed: 403 Forbidden` for the Cloudflare temporary callback
origin. No request reached the local callback proxy. External probes reached it
successfully, with ordinary API routes returning 404 and unsigned callbacks 403.
An outbound-approved HTTPS callback is required for the real interactive web
workflow. The signed web lifecycle, including attack, replacement and approval,
is covered by the integration test using a simulated Grid.


### Native control relay — verified 2026-09-30 UTC

Run `1204237711088322358`, mission `m-2310fb16`, used dedicated control node
`7566367092358460027` and no public callback (the Cloudflare tunnel was stopped).
The real web API received running/completed snapshots, delivered an attack to
ServerApp, and received the quarantine and replacement acknowledgement. Nine
distinct worker node IDs were observed, excluding the control node; final
coverage was 8/8 with one quarantined output excluded. The web approval endpoint
accepted approval and the cloud control session closed. These checks used the
synthetic mission and deterministic outputs. Backend tests: 91 passed; frontend
production build passed. The initial SuperGrid queue took several minutes.
