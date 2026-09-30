// Frontend data adapter.
//
// Visual components consume one stable shape (MissionView, see ./types). Two
// sources produce it:
//   mock (default) – deterministic simulation, no backend needed (./mock)
//   api            – the FastAPI backend from CONTRACT.md
//
// Pick the mode with `?mode=api` in the URL or VITE_CONSTELLATION_MODE=api.
// Backend quirks are absorbed here, never in the components.

import { DEMO_PROMPT, MockMission, TICK_MS } from './mock';
import type { Incident, MissionActions, MissionStatus, MissionView, UiStatus, WorkerView } from './types';

// ---------------------------------------------------------------------------
// Contract types (CONTRACT.md)

export type BackendWorkerStatus = 'queued' | 'running' | 'complete' | 'failed' | 'quarantined' | 'replaced';

export interface BackendWorker {
  id: string;
  mission_id: string;
  role: string;
  task: string;
  status: BackendWorkerStatus;
  allowed_context: string[];
  blocked_context: string[];
  context_exposure: number;
  tainted: boolean;
  quarantined: boolean;
  output: string | null;
  network_identity: string;
  replacement_for: string | null;
  // Optional extras some backends send.
  error?: string | null;
  started_at?: number | null;
  finished_at?: number | null;
  node_id?: string | null;
  runtime?: string | null;
}

export interface BackendMission {
  runtime?: string;
  run_id?: string | null;
  federation?: string | null;
  error?: string | null;
  control_available?: boolean;
  id: string;
  prompt: string;
  status: MissionStatus;
  worker_ids: string[];
  progress: number;
  result: string | null;
  approved: boolean;
}

export interface BackendResult {
  mission_id: string;
  status: MissionStatus;
  progress: number;
  result: string | null;
  approved: boolean;
  metrics?: Record<string, number>;
}

export interface AttackResponse {
  quarantined: BackendWorker;
  replacement: BackendWorker;
  event?: { detail?: string; timestamp?: number };
}

// ---------------------------------------------------------------------------
// HTTP client — one function per CONTRACT.md route.

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api';

async function http<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const res = await fetch(API_BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const j = await res.json();
      if (j && typeof j.detail === 'string') detail = j.detail;
    } catch {
      /* not json */
    }
    throw new Error(`${method} ${path} → ${res.status} ${detail}`);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => http<{ status: string }>('GET', '/health'),
  createMission: (prompt: string) => http<BackendMission>('POST', '/mission', { prompt }),
  getMission: (id: string) => http<BackendMission>('GET', `/mission/${encodeURIComponent(id)}`),
  getWorkers: (id: string) => http<BackendWorker[]>('GET', `/mission/${encodeURIComponent(id)}/workers`),
  attackWorker: (workerId: string) => http<AttackResponse>('POST', `/workers/${encodeURIComponent(workerId)}/attack`),
  getResult: (id: string) => http<BackendResult>('GET', `/mission/${encodeURIComponent(id)}/result`),
  approveMission: (id: string) => http<BackendMission>('POST', `/mission/${encodeURIComponent(id)}/approve`),
};

// ---------------------------------------------------------------------------
// Backend → view mapping

const STARS = ['Vega', 'Altair', 'Deneb', 'Rigel', 'Sirius', 'Capella', 'Antares', 'Polaris', 'Arcturus', 'Procyon', 'Aldebaran', 'Betelgeuse'];
const REPLACEMENT_STARS = ['Spica', 'Regulus', 'Castor', 'Pollux', 'Mimosa', 'Hadar'];
const EXTRA_UNREACH = ['Other workers’ outputs', 'Any other credential'];
/** Containment advances one step every 2 mock ticks. */
const PHASE_MS = TICK_MS * 2;

function displayId(id: string, fallback: number): string {
  const m = /w(\d+)$/i.exec(id);
  return 'W-' + String(m ? Number(m[1]) : fallback).padStart(2, '0');
}

function baseStatus(s: BackendWorkerStatus): UiStatus {
  switch (s) {
    case 'queued':
      return 'queued';
    case 'running':
      return 'run';
    case 'complete':
      return 'done';
    case 'failed':
      return 'failed';
    case 'quarantined':
      return 'quar';
    case 'replaced':
      return 'revoke';
  }
}

function toWorker(w: BackendWorker, slot: number, star: string, index: number, pct: number): WorkerView {
  const allowed = w.allowed_context ?? [];
  const blocked = w.blocked_context ?? [];
  const status = baseStatus(w.status);
  const rejected = w.tainted || w.quarantined;
  return {
    key: w.id,
    slot,
    id: displayId(w.id, index + 1),
    star,
    role: w.role,
    task: w.task,
    holds: allowed.length ? allowed.join(' · ') : 'No context',
    share: Math.round((w.context_exposure ?? 0) * 100),
    ip: w.node_id ? `SuperNode ${w.node_id}` : w.network_identity || 'Unassigned',
    sandbox: w.node_id ? 'ClientApp' : 'Awaiting assignment',
    status,
    pct,
    isNew: !!w.replacement_for,
    replacementFor: w.replacement_for,
    allowed: allowed.map((name) => ({ name, meta: 'read-only slice' })),
    blocked,
    instruction: w.task,
    tokens: '',
    reach: [...allowed, 'The one-line instruction'],
    unreach: Array.from(new Set([...blocked, ...EXTRA_UNREACH])).slice(0, 6),
    output: rejected ? w.output ?? 'Tainted output discarded before it reached the coordinator.' : w.output,
    outputState: rejected ? 'rejected' : w.status === 'complete' ? 'accepted' : 'pending',
    tainted: w.tainted,
  };
}

function emptyView(prompt: string, error: string | null): MissionView {
  return {
    mode: 'api',
    id: '',
    name: 'Orion',
    prompt,
    subtitle: 'Confidential AI research · connecting to coordinator',
    status: 'created',
    workers: [],
    allWorkers: [],
    incident: null,
    progress: 0,
    doneCount: 0,
    result: null,
    approved: false,
    error,
  };
}

type Listener = () => void;
const STORE_KEY = 'constellation.api.mission';

export class ApiMission implements MissionActions {
  private missionId: string | null = null;
  private createdAt = Date.now();
  private mission: BackendMission | null = null;
  private workers: BackendWorker[] = [];
  private result: BackendResult | null = null;
  private error: string | null = null;
  private prompt = DEMO_PROMPT;
  /** Client-side timing so progress bars and the containment steps animate. */
  private runningSince = new Map<string, number>();
  private attackedAt = new Map<string, number>();
  private frozenPct = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private listeners = new Set<Listener>();
  private view: MissionView = emptyView(DEMO_PROMPT, null);

  constructor() {
    try {
      const linked = new URLSearchParams(window.location.search).get('mission');
      const saved = linked && /^m-[a-zA-Z0-9_-]+$/.test(linked)
        ? { id: linked, createdAt: Date.now() }
        : JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      if (saved && typeof saved.id === 'string') {
        this.missionId = saved.id;
        this.createdAt = saved.createdAt || Date.now();
      }
    } catch {
      /* storage unavailable */
    }
  }

  subscribe = (fn: Listener) => {
    this.listeners.add(fn);
    if (!this.timer) {
      void this.poll();
      this.timer = setInterval(() => void this.poll(), TICK_MS);
    }
    return () => {
      this.listeners.delete(fn);
      if (this.listeners.size === 0 && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
  };

  getView = () => this.view;

  attack = (workerKey: string) => {
    const w = this.view.allWorkers.find((x) => x.key === workerKey);
    this.attackedAt.set(workerKey, Date.now());
    this.frozenPct.set(workerKey, w ? w.pct : 0);
    api
      .attackWorker(workerKey)
      .then((res) => {
        this.upsert(res.quarantined);
        this.upsert(res.replacement);
        this.error = null;
        this.emit();
      })
      .catch((e: unknown) => {
        this.attackedAt.delete(workerKey);
        this.fail(e);
      });
  };

  reset = () => this.createMission(this.mission?.prompt || this.prompt);

  approve = () => {
    if (!this.missionId) return;
    api
      .approveMission(this.missionId)
      .then((m) => {
        this.mission = m;
        this.error = null;
        return this.refreshResult();
      })
      .then(() => this.emit())
      .catch((e: unknown) => this.fail(e));
  };

  createMission = (prompt: string) => {
    this.prompt = prompt.trim() || DEMO_PROMPT;
    api
      .createMission(this.prompt)
      .then((m) => {
        this.missionId = m.id;
        this.createdAt = Date.now();
        this.mission = m;
        this.workers = [];
        this.result = null;
        this.runningSince.clear();
        this.attackedAt.clear();
        this.frozenPct.clear();
        this.error = null;
        try {
          sessionStorage.setItem(STORE_KEY, JSON.stringify({ id: m.id, createdAt: this.createdAt }));
        } catch {
          /* storage unavailable */
        }
        return this.poll();
      })
      .catch((e: unknown) => this.fail(e));
  };

  private upsert(w: BackendWorker) {
    const i = this.workers.findIndex((x) => x.id === w.id);
    if (i >= 0) this.workers[i] = w;
    else this.workers.push(w);
  }

  private fail(e: unknown) {
    this.error = e instanceof Error ? e.message : String(e);
    this.emit();
  }

  private async refreshResult() {
    if (!this.missionId || !this.mission) return;
    if (this.mission.status === 'complete' || this.mission.status === 'approved') {
      this.result = await api.getResult(this.missionId);
    } else {
      this.result = null;
    }
  }

  private async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      if (!this.missionId) {
        await api.health();
        this.createMission(this.prompt);
        return;
      }
      try {
        this.mission = await api.getMission(this.missionId);
      } catch (e) {
        // Backend restarted and lost its in-memory mission: start a fresh one.
        if (e instanceof Error && / 404 /.test(e.message)) {
          this.missionId = null;
          return;
        }
        throw e;
      }
      this.workers = await api.getWorkers(this.missionId);
      await this.refreshResult();
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? `Backend unreachable (${e.message})` : 'Backend unreachable';
    } finally {
      this.busy = false;
      this.emit();
    }
  }

  private emit() {
    this.view = this.compute();
    this.listeners.forEach((fn) => fn());
  }

  private pctOf(w: BackendWorker, now: number): number {
    if (w.status === 'complete') return 100;
    if (w.status === 'queued') return 0;
    const frozen = this.frozenPct.get(w.id);
    if ((w.status === 'quarantined' || w.status === 'replaced') && frozen !== undefined) return frozen;
    let since = this.runningSince.get(w.id);
    if (since === undefined) {
      since = w.started_at ? Math.min(now, w.started_at * 1000) : now;
      this.runningSince.set(w.id, since);
    }
    // Backend reports no per-worker progress; ease towards 95% while running.
    return Math.min(95, 100 * (1 - Math.exp(-(now - since) / 6000)));
  }

  private compute(): MissionView {
    const m = this.mission;
    if (!m) return emptyView(this.prompt, this.error);
    const now = Date.now();
    const byId = new Map(this.workers.map((w) => [w.id, w]));
    const ordered = [...(m.worker_ids.map((id) => byId.get(id)).filter(Boolean) as BackendWorker[])];
    for (const w of this.workers) if (!m.worker_ids.includes(w.id)) ordered.push(w);

    // Slots: original workers in order; a replacement inherits its predecessor's slot.
    const slotOf = new Map<string, number>();
    const originals = ordered.filter((w) => !w.replacement_for);
    originals.forEach((w, i) => slotOf.set(w.id, i));
    let repIndex = 0;
    const starOf = new Map<string, string>();
    originals.forEach((w, i) => starOf.set(w.id, STARS[i % STARS.length]));
    for (const w of ordered) {
      if (!w.replacement_for) continue;
      let slot = slotOf.get(w.replacement_for);
      if (slot === undefined) slot = originals.length + repIndex;
      slotOf.set(w.id, slot);
      starOf.set(w.id, REPLACEMENT_STARS[repIndex % REPLACEMENT_STARS.length]);
      repIndex++;
    }

    const views = new Map<string, WorkerView>();
    ordered.forEach((w, i) => views.set(w.id, toWorker(w, slotOf.get(w.id) ?? i, starOf.get(w.id) ?? w.id, i, this.pctOf(w, now))));

    // Most recent compromise drives the incident panel.
    const attackedList = ordered.filter((w) => w.quarantined || w.tainted);
    const latest = attackedList.sort((a, b) => (this.attackedAt.get(a.id) ?? 0) - (this.attackedAt.get(b.id) ?? 0)).pop();
    let incident: Incident | null = null;
    if (latest) {
      const repl = ordered.find((w) => w.replacement_for === latest.id) ?? null;
      const t0 = this.attackedAt.get(latest.id);
      const timerPhase = t0 === undefined ? 6 : Math.min(6, Math.floor((now - t0) / PHASE_MS) + 1);
      const cap = !repl ? 4 : repl.status === 'queued' ? 5 : 6;
      const phase = Math.max(1, Math.min(timerPhase, cap)) as Incident['phase'];
      const a = { ...views.get(latest.id)! };
      a.status = phase === 1 ? 'detect' : phase === 2 ? 'iso' : phase === 3 ? 'quar' : 'revoke';
      if (phase >= 2) a.ip = 'detached';
      if (phase < 3) {
        a.output = null;
        a.outputState = 'pending';
      }
      views.set(latest.id, a);
      let r: WorkerView | null = null;
      if (repl && phase >= 5) {
        r = { ...views.get(repl.id)! };
        if (phase === 5) r.status = 'prov';
        views.set(repl.id, r);
      }
      incident = { phase, slot: a.slot, attacked: a, replacement: r, quarantinedOutputs: latest.output ? 1 : 0 };
    }
    // Workers compromised in earlier incidents stay revoked.
    for (const w of attackedList) {
      if (latest && w.id === latest.id) continue;
      views.set(w.id, { ...views.get(w.id)!, status: 'revoke', ip: 'detached' });
    }

    // One row per slot: the newest worker in that slot that the incident phase allows to be shown.
    const rows: WorkerView[] = [];
    for (const w of ordered) {
      const v = views.get(w.id)!;
      if (incident && incident.replacement === null && w.replacement_for === incident.attacked.key) continue;
      rows[v.slot] = v;
    }
    const workers = rows.filter(Boolean);
    const hidden = incident && incident.replacement === null ? incident.attacked.key : null;
    const allWorkers = ordered.filter((w) => !hidden || w.replacement_for !== hidden).map((w) => views.get(w.id)!);
    const doneCount = workers.filter((w) => w.status === 'done').length;
    const finished = m.status === 'complete' || m.status === 'approved';
    const progress = finished ? 100 : workers.length ? workers.reduce((s, w) => s + w.pct, 0) / workers.length : 0;

    return {
      mode: 'api',
      id: m.id,
      name: 'Orion',
      prompt: m.prompt,
      subtitle: `Confidential AI research · ${m.runtime === 'supergrid' ? 'ServerApp on SuperGrid' : 'Local coordinator'} · ${m.run_id ? `run ${m.run_id}` : 'awaiting run'}`,
      runtime: m.runtime,
      runId: m.run_id,
      federation: m.federation,
      controlAvailable: m.control_available,
      status: m.status,
      workers,
      allWorkers,
      incident,
      progress,
      doneCount,
      result: this.result?.result ?? m.result,
      approved: m.approved,
      error: this.error ?? m.error ?? null,
    };
  }
}

// ---------------------------------------------------------------------------
// Source selection

export interface MissionSource extends MissionActions {
  subscribe(fn: () => void): () => void;
  getView(): MissionView;
}

export type Mode = 'mock' | 'api';

export function resolveMode(): Mode {
  const q = new URLSearchParams(window.location.search).get('mode');
  if (q === 'api' || q === 'mock') return q;
  return import.meta.env.VITE_CONSTELLATION_MODE === 'mock' ? 'mock' : 'api';
}

export function createMissionSource(mode: Mode = resolveMode()): MissionSource {
  if (mode === 'api') return new ApiMission();
  const speed = Number(new URLSearchParams(window.location.search).get('speed')) || 1;
  return new MockMission(Math.max(0.25, Math.min(10, speed)));
}
