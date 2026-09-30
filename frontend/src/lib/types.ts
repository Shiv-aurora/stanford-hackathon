// The one frontend-facing data shape. Visual components only ever read these
// types; both the mock engine and the backend adapter (lib/api.ts) produce them.

/** Visual worker state. Mirrors the mockup's status table plus backend-only states. */
import type { ChatMode, LabId } from './labs';

export type UiStatus =
  | 'queued' // backend: queued
  | 'run' // Running
  | 'done' // Complete
  | 'detect' // Injection detected
  | 'iso' // Isolated
  | 'quar' // Quarantined
  | 'revoke' // Access revoked
  | 'prov' // Provisioning (replacement coming up)
  | 'reply' // Answering a follow-up question (task already complete)
  | 'failed'; // backend: failed

export type OutputState = 'pending' | 'accepted' | 'rejected';

export type MissionStatus = 'created' | 'running' | 'complete' | 'approved' | 'failed';

export interface ContextFile {
  name: string;
  meta: string;
}

export interface WorkerView {
  /** Backend worker id (stable key). */
  key: string;
  /** Position in the swarm (0-based). A replacement takes over its predecessor's slot. */
  slot: number;
  /** Display id, e.g. "W-04". */
  id: string;
  /** Star name, e.g. "Rigel". */
  star: string;
  role: string;
  task: string;
  /** One-line summary of what the worker holds, e.g. "3 search queries". */
  holds: string;
  /** Context exposure as % of the project (0–100). */
  share: number;
  /** Network identity (demo metadata) or "detached" once isolated. */
  ip: string;
  /** Sandbox id shown in the inspector. */
  sandbox: string;
  status: UiStatus;
  /** Task progress 0–100. */
  pct: number;
  /** Replacement worker created during this mission. */
  isNew: boolean;
  replacementFor: string | null;
  /** Allowed context (what the worker receives). */
  allowed: ContextFile[];
  /** Blocked context (removed before dispatch). */
  blocked: string[];
  instruction: string;
  /** e.g. "2.4k tokens"; empty when unknown. */
  tokens: string;
  /** What an attacker could reach / not reach if this worker were compromised. */
  reach: string[];
  unreach: string[];
  output: string | null;
  outputState: OutputState;
  tainted: boolean;
  /** Answering a follow-up question from the coordinator or the operator. */
  answering: boolean;
}

/** One turn of the coordinator chat. */
export interface ChatMessage {
  id: string;
  role: 'user' | 'coordinator';
  /** 'security': a blocked attack (text = the injected instruction; routedTo = [compromised, replacement]). */
  kind: 'text' | 'security';
  /** null while the coordinator is still working on it. */
  text: string | null;
  pending: boolean;
  /** Workers the coordinator asked (need-to-know). */
  routedTo: { key: string; star: string }[];
  /** Compartments the question matched; empty when every worker was asked. */
  categories: string[];
}

/** One entry of a worker's conversation, as the trusted coordinator sees it. */
export interface TranscriptEntry {
  id: string;
  kind: 'dispatch' | 'reply' | 'operator' | 'coordinator' | 'attack' | 'security' | 'error';
  text: string;
  /** Time in ms. */
  at: number;
  /** dispatch only: the exact context fragments sent. */
  context: { label: string; text: string }[];
  note: string | null;
}

/** Containment sequence. Phase 1–6 = Detect, Isolate, Quarantine, Revoke, Replace, Continue. */
export interface Incident {
  phase: 1 | 2 | 3 | 4 | 5 | 6;
  /** Slot of the compromised worker. */
  slot: number;
  /** Snapshot of the compromised worker (status reflects the containment phase). */
  attacked: WorkerView;
  /** Replacement worker; visible from phase 5. */
  replacement: WorkerView | null;
  /** How many of the compromised worker's outputs were quarantined. */
  quarantinedOutputs: number;
}

/** One entry in the sidebar's mission list. */
export interface MissionSummary {
  id: string;
  /** Code name, e.g. "Orion". */
  name: string;
  status: MissionStatus;
}

export interface MissionView {
  mode: 'mock' | 'api';
  id: string;
  /** Code name shown in the UI, e.g. "Orion". */
  name: string;
  prompt: string;
  /** Line under the mission title. */
  subtitle: string;
  status: MissionStatus;
  /** One row per slot: the compromised worker until it is replaced, then its replacement. */
  workers: WorkerView[];
  /** Every worker that ever existed, including compromised ones (for the inspector). */
  allWorkers: WorkerView[];
  incident: Incident | null;
  /** Mission progress 0–100. */
  progress: number;
  doneCount: number;
  result: string | null;
  approved: boolean;
  /** Set when the backend cannot be reached (api mode only). */
  error: string | null;
  /** Every mission of the current lab for the sidebar, newest first (includes this one). */
  missions: MissionSummary[];
  /** Lab whose missions are shown. */
  lab: LabId;
  /** Coordinator chat: the mission prompt, its synthesis, then follow-ups. */
  chat: ChatMessage[];
  /** Why a follow-up can't be sent right now; null when it can. */
  chatBlocked: string | null;
  /** Time from dispatch to the assembled answer, once complete. */
  durationMs: number | null;
  /** Models the workers can run on (api mode); empty in mock mode. */
  models: { id: string; label: string }[];
  /** Model this chat's workers use ('' = default). */
  model: string;
  /** Conversation of the worker being watched (see watchWorker). */
  transcript: { key: string; entries: TranscriptEntry[] } | null;
  /** Whether the lab can be switched (api mode only; mock replays the AI Lab demo). */
  labSwitchable: boolean;
}

export interface MissionActions {
  /** Trigger the demo prompt-injection on a worker (by backend key). */
  attack(workerKey: string): void;
  /** Restart the demo with the same prompt. */
  reset(): void;
  approve(): void;
  createMission(prompt: string, mode?: ChatMode, model?: string): void;
  /** Open an empty chat (the next message starts a new mission). */
  newChat(): void;
  /** Open another mission from the sidebar. */
  selectMission(id: string): void;
  /** Switch to another lab's missions. */
  selectLab(id: LabId): void;
  /** Ask the coordinator a follow-up; it routes it to the workers that need it. */
  sendMessage(text: string): void;
  /** Send one worker a follow-up; it answers from its own slice only. */
  messageWorker(workerKey: string, text: string): void;
  /** Keep this worker's conversation fresh in view.transcript (null to stop). */
  watchWorker(workerKey: string | null): void;
}
