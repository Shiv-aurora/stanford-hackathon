// Frontend data adapter.
//
// Visual components consume one stable shape (MissionView, see ./types). Two
// sources produce it:
//   mock (default) – deterministic simulation, no backend needed (./mock)
//   api            – the FastAPI backend from CONTRACT.md
//
// Pick the mode with `?mode=api` in the URL or VITE_CONSTELLATION_MODE=api.
// Backend quirks are absorbed here, never in the components.

import { LABS, labOf, type LabId } from './labs';
import { MockMission, TICK_MS } from './mock';
import type { ChatMessage, Incident, MissionActions, MissionStatus, MissionSummary, MissionView, TranscriptEntry, UiStatus, WorkerView } from './types';

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
  answering?: boolean;
}

export interface BackendChatMessage {
  id: string;
  role: 'user' | 'coordinator';
  text: string | null;
  pending: boolean;
  routed_to: string[];
  categories: string[];
  at: number;
}

export interface BackendTranscriptEntry {
  id: string;
  kind: TranscriptEntry['kind'];
  text: string;
  at: number;
  context: Record<string, string>;
  message_id?: string | null;
  note?: string | null;
}

export interface BackendMission {
  id: string;
  prompt: string;
  status: MissionStatus;
  worker_ids: string[];
  progress: number;
  result: string | null;
  approved: boolean;
  created_at?: number | null;
  lab?: string;
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
  listMissions: (lab: LabId) => http<BackendMission[]>('GET', `/missions?lab=${lab}`),
  createMission: (prompt: string, lab: LabId) => http<BackendMission>('POST', '/mission', { prompt, lab }),
  getMission: (id: string) => http<BackendMission>('GET', `/mission/${encodeURIComponent(id)}`),
  getWorkers: (id: string) => http<BackendWorker[]>('GET', `/mission/${encodeURIComponent(id)}/workers`),
  attackWorker: (workerId: string) => http<AttackResponse>('POST', `/workers/${encodeURIComponent(workerId)}/attack`),
  getResult: (id: string) => http<BackendResult>('GET', `/mission/${encodeURIComponent(id)}/result`),
  approveMission: (id: string) => http<BackendMission>('POST', `/mission/${encodeURIComponent(id)}/approve`),
  getMessages: (id: string) => http<BackendChatMessage[]>('GET', `/mission/${encodeURIComponent(id)}/messages`),
  postMessage: (id: string, text: string) => http<BackendChatMessage[]>('POST', `/mission/${encodeURIComponent(id)}/messages`, { text }),
  getTranscript: (workerId: string) => http<BackendTranscriptEntry[]>('GET', `/workers/${encodeURIComponent(workerId)}/transcript`),
  messageWorker: (workerId: string, text: string) =>
    http<BackendTranscriptEntry>('POST', `/workers/${encodeURIComponent(workerId)}/messages`, { text }),
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

function sandboxId(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return 'sbx-' + (h >>> 0).toString(16).slice(-4).padStart(4, '0');
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
  const status = w.answering ? 'reply' : baseStatus(w.status);
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
    ip: w.network_identity || '—',
    sandbox: sandboxId(w.id),
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
    answering: !!w.answering,
  };
}

/** Same keywords the backend decomposer uses to pick its AI-research split. */
const AI_KEYWORDS = ['model', 'training', 'transformer', 'llm', 'neural', 'optimizer', 'benchmark', 'dataset', 'gpu', 'architecture', 'fine-tun', 'inference'];

function missionKind(prompt: string, lab: LabId): string {
  // Defense and biotech missions always get their lab's decomposition.
  if (lab !== 'ai') return labOf(lab).kind;
  const p = prompt.toLowerCase();
  return AI_KEYWORDS.filter((k) => p.includes(k)).length >= 2 ? 'Confidential AI research' : 'Confidential research';
}

/** Code name for a lab's `index`-th mission. */
function codeName(lab: LabId, index: number): string {
  const names = labOf(lab).codeNames;
  const base = names[index % names.length];
  const round = Math.floor(index / names.length);
  return round ? `${base} ${round + 1}` : base;
}

function formatClock(ms: number): string {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function emptyView(prompt: string, error: string | null, lab: LabId): MissionView {
  return {
    mode: 'api',
    id: '',
    name: labOf(lab).codeNames[0],
    prompt,
    subtitle: `${labOf(lab).kind} · connecting · coordinator in enclave`,
    status: 'created',
    workers: [],
    allWorkers: [],
    incident: null,
    progress: 0,
    doneCount: 0,
    result: null,
    approved: false,
    error,
    missions: [],
    lab,
    labSwitchable: true,
    chat: [],
    chatBlocked: 'Connecting to the coordinator…',
    transcript: null,
  };
}

function toEntry(e: BackendTranscriptEntry): TranscriptEntry {
  return {
    id: e.id,
    kind: e.kind,
    text: e.text,
    at: e.at * 1000,
    context: Object.entries(e.context ?? {}).map(([label, text]) => ({ label, text })),
    note: e.note ?? null,
  };
}

type Listener = () => void;
const STORE_KEY = 'constellation.api.mission';

export class ApiMission implements MissionActions {
  private lab: LabId = 'ai';
  private missionId: string | null = null;
  private createdAt = Date.now();
  private mission: BackendMission | null = null;
  /** Every mission on the backend, in creation order (for the sidebar and code names). */
  private missionList: BackendMission[] = [];
  private workers: BackendWorker[] = [];
  private result: BackendResult | null = null;
  private chat: BackendChatMessage[] = [];
  /** Worker whose conversation is on screen, and its entries. */
  private watched: string | null = null;
  private transcript: BackendTranscriptEntry[] = [];
  /** A follow-up is being posted (keeps the composer disabled until the POST returns). */
  private sending = false;
  private error: string | null = null;
  private prompt = LABS[0].demoPrompt;
  /** A POST /mission is in flight, so the poll must not start another demo mission. */
  private creating = false;
  /** Client-side timing so progress bars and the containment steps animate. */
  private runningSince = new Map<string, number>();
  private attackedAt = new Map<string, number>();
  private frozenPct = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  /** A poll was requested while one was in flight (e.g. right after switching missions). */
  private again = false;
  private listeners = new Set<Listener>();
  private view: MissionView = emptyView(LABS[0].demoPrompt, null, 'ai');

  constructor() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
      if (saved && LABS.some((l) => l.id === saved.lab)) {
        this.lab = saved.lab;
        this.prompt = labOf(this.lab).demoPrompt;
      }
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

  sendMessage = (text: string) => {
    const id = this.missionId;
    if (!id || !text.trim() || this.sending) return;
    this.sending = true;
    this.emit();
    api
      .postMessage(id, text.trim())
      .then((added) => {
        if (this.missionId === id) this.chat = [...this.chat.filter((m) => !added.some((a) => a.id === m.id)), ...added];
        this.error = null;
      })
      .catch((e: unknown) => this.fail(e))
      .finally(() => {
        this.sending = false;
        void this.poll();
      });
  };

  messageWorker = (workerKey: string, text: string) => {
    if (!text.trim()) return;
    api
      .messageWorker(workerKey, text.trim())
      .then((entry) => {
        if (this.watched === workerKey) this.transcript = [...this.transcript, entry];
        this.error = null;
        this.emit();
        void this.poll();
      })
      .catch((e: unknown) => this.fail(e));
  };

  watchWorker = (workerKey: string | null) => {
    if (workerKey === this.watched) return;
    this.watched = workerKey;
    this.transcript = [];
    this.emit();
    if (workerKey) void this.poll();
  };

  selectLab = (id: LabId) => {
    if (id === this.lab) return;
    this.lab = id;
    this.prompt = labOf(id).demoPrompt;
    this.missionId = null;
    this.mission = null;
    this.missionList = [];
    this.workers = [];
    this.result = null;
    this.chat = [];
    this.runningSince.clear();
    this.attackedAt.clear();
    this.frozenPct.clear();
    this.error = null;
    this.persist(null);
    this.emit();
    // Opens the lab's newest mission, or starts its demo mission if it has none.
    void this.poll();
  };

  selectMission = (id: string) => {
    if (id === this.missionId) return;
    const m = this.missionList.find((x) => x.id === id);
    if (!m) return;
    this.open(m);
    void this.poll();
  };

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
    const lab = this.lab;
    this.prompt = prompt.trim() || labOf(lab).demoPrompt;
    this.creating = true;
    api
      .createMission(this.prompt, lab)
      .then((m) => {
        this.creating = false;
        if (lab !== this.lab) return; // switched labs meanwhile; it shows up in that lab's list
        this.missionList = [...this.missionList.filter((x) => x.id !== m.id), m];
        this.open(m);
        return this.poll();
      })
      .catch((e: unknown) => {
        this.creating = false;
        this.fail(e);
      });
  };

  /** Switch the view to `m`, dropping the previous mission's client-side timing. */
  private open(m: BackendMission) {
    this.missionId = m.id;
    this.createdAt = m.created_at ? m.created_at * 1000 : Date.now();
    this.mission = m;
    this.workers = [];
    this.result = null;
    this.chat = [];
    this.runningSince.clear();
    this.attackedAt.clear();
    this.frozenPct.clear();
    this.error = null;
    this.persist(m.id);
    this.emit();
  }

  private persist(id: string | null) {
    try {
      sessionStorage.setItem(STORE_KEY, JSON.stringify({ id, createdAt: this.createdAt, lab: this.lab }));
    } catch {
      /* storage unavailable */
    }
  }

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
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      const lab = this.lab;
      const list = await api.listMissions(lab);
      if (lab !== this.lab) return; // switched labs while the list was loading
      this.missionList = list;
      if (!this.missionId) {
        // Reopen the lab's newest mission rather than starting a new one on every page load.
        const newest = this.missionList[this.missionList.length - 1];
        if (!newest) {
          if (!this.creating) this.createMission(labOf(lab).demoPrompt);
          return;
        }
        this.open(newest);
      }
      const id = this.missionId as string;
      let mission: BackendMission;
      try {
        mission = await api.getMission(id);
      } catch (e) {
        // Backend restarted and lost its in-memory mission: pick another or start fresh.
        if (e instanceof Error && / 404 /.test(e.message)) {
          if (this.missionId === id) this.missionId = null;
          return;
        }
        throw e;
      }
      const watched = this.watched;
      const [workers, chat, transcript] = await Promise.all([
        api.getWorkers(id),
        api.getMessages(id),
        watched ? api.getTranscript(watched).catch(() => [] as BackendTranscriptEntry[]) : Promise.resolve([] as BackendTranscriptEntry[]),
      ]);
      const finished = mission.status === 'complete' || mission.status === 'approved';
      const result = finished ? await api.getResult(id) : null;
      // The user may have switched missions while these requests were in flight.
      if (this.missionId !== id) return;
      this.mission = mission;
      this.workers = workers;
      this.result = result;
      this.chat = chat;
      if (watched === this.watched) this.transcript = transcript;
      this.error = null;
    } catch (e) {
      this.error = e instanceof Error ? `Backend unreachable (${e.message})` : 'Backend unreachable';
    } finally {
      this.busy = false;
      this.emit();
      if (this.again) {
        this.again = false;
        void this.poll();
      }
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
    if (!m) return emptyView(this.prompt, this.error, this.lab);
    const listed = this.missionList.some((x) => x.id === m.id) ? this.missionList : [...this.missionList, m];
    const missions: MissionSummary[] = listed
      .map((x, i) => ({ id: x.id, name: codeName(this.lab, i), status: x.id === m.id ? m.status : x.status }))
      .reverse();
    const name = missions.find((x) => x.id === m.id)?.name ?? labOf(this.lab).codeNames[0];
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
    const doneCount = workers.filter((w) => w.status === 'done' || w.status === 'reply').length;
    const finished = m.status === 'complete' || m.status === 'approved';
    const progress = finished ? 100 : workers.length ? workers.reduce((s, w) => s + w.pct, 0) / workers.length : 0;

    return {
      mode: 'api',
      id: m.id,
      name,
      prompt: m.prompt,
      subtitle: `${missionKind(m.prompt, this.lab)} · started ${formatClock(this.createdAt)} · coordinator in enclave`,
      status: m.status,
      workers,
      allWorkers,
      incident,
      progress,
      doneCount,
      result: this.result?.result ?? m.result,
      approved: m.approved,
      error: this.error,
      missions,
      lab: this.lab,
      labSwitchable: true,
      chat: this.chat.map(
        (c): ChatMessage => ({
          id: c.id,
          role: c.role,
          text: c.text,
          pending: c.pending,
          routedTo: c.routed_to.map((key) => ({ key, star: starOf.get(key) ?? key })),
          categories: c.categories,
        }),
      ),
      chatBlocked: this.sending
        ? 'Sending…'
        : this.workers.some((w) => w.answering)
          ? 'The coordinator is still answering.'
          : m.status === 'complete' || m.status === 'approved'
            ? null
            : m.status === 'failed'
              ? 'The mission failed.'
              : 'Follow-ups open once the mission completes.',
      transcript: this.watched ? { key: this.watched, entries: this.transcript.map(toEntry) } : null,
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
  return import.meta.env.VITE_CONSTELLATION_MODE === 'api' ? 'api' : 'mock';
}

export function createMissionSource(mode: Mode = resolveMode()): MissionSource {
  if (mode === 'api') return new ApiMission();
  const speed = Number(new URLSearchParams(window.location.search).get('speed')) || 1;
  return new MockMission(Math.max(0.25, Math.min(10, speed)));
}
