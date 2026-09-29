# Constellation on SuperGrid

The default web runtime submits one Flower run per mission to
`@qxh2001/security`. The **ServerApp runs on SuperGrid** and owns decomposition,
worker dispatch, quarantine/replacement, and synthesis. Each **worker gets one
previously unused SuperNode**, which executes the ClientApp. A node stays
reserved for the whole run, even after its task finishes. Replacements use
fresh nodes; there is no least-loaded reuse or local fallback in SuperGrid mode.

```text
Browser → FastAPI control plane → SuperGrid / ServerApp
                                      ↓       ↓       ↓
                                SuperNode  SuperNode  SuperNode
                                ClientApp  ClientApp  ClientApp
                                Worker A   Worker B   Worker C
```

## Configure and run

From `backend/`:

```bash
uv sync
uv run flwr login supergrid
uv run flwr federation list supergrid --federation @qxh2001/security
cp .env.example .env
```

Set `CONSTELLATION_BRIDGE_URL` in `.env` to the public HTTPS origin that routes
`/internal/supergrid/*` to this backend. SuperGrid's ServerApp needs outbound
HTTPS access to that address. Keep the ordinary mission/worker endpoints on a
trusted local or authenticated network; they are not a production auth system.
For example, an HTTPS reverse proxy can expose only the callback paths:

```caddyfile
bridge.example.com {
    handle /internal/supergrid/* {
        reverse_proxy 127.0.0.1:8000
    }
    respond 404
}
```

The federation must contain **at least 9 SuperNodes** for the eight-worker
research demo and one replacement. More attacks need more fresh nodes. The
`CONSTELLATION_FLOWER_NODES` setting is a minimum required capacity; it does not
provision nodes or change the federation. Either a SuperGrid simulation
federation or a deployment federation can be used. Register and connect real
SuperNodes separately for a deployment federation.

```bash
uv run uvicorn main:app --host 127.0.0.1 --port 8000
```

Run exactly one backend process, without auto-reload: mission state and control
sessions are in memory. In another terminal, from `frontend/`:

```bash
npm ci
npm run dev
```

Open `http://localhost:5173/`. API mode is the default. The UI shows the remote
run ID, federation and actual SuperNode IDs. Use `?mode=mock` only for the
standalone visual preview.

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
