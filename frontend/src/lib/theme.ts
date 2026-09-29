import type { OutputState, UiStatus } from './types';

// Palette and status tables lifted verbatim from the mockup's render logic.
export const K = { blue: '#60A5FA', green: '#22C55E', red: '#EF4444', amber: '#F59E0B', gray: '#737373' };

export const MONO = "'Geist Mono', monospace";

/** [label, text colour, pill background, dot/bar colour] */
export const STY: Record<UiStatus, [string, string, string, string]> = {
  run: ['Running', '#93C5FD', 'rgba(59,130,246,0.16)', K.blue],
  done: ['Complete', '#86EFAC', 'rgba(34,197,94,0.14)', K.green],
  detect: ['Injection detected', '#FCA5A5', 'rgba(239,68,68,0.16)', K.red],
  iso: ['Isolated', '#FCA5A5', 'rgba(239,68,68,0.16)', K.red],
  quar: ['Quarantined', '#FCA5A5', 'rgba(239,68,68,0.16)', K.red],
  revoke: ['Access revoked', '#B4B4B4', '#26262B', K.gray],
  prov: ['Provisioning', '#FCD34D', 'rgba(245,158,11,0.15)', K.amber],
  reply: ['Answering', '#93C5FD', 'rgba(59,130,246,0.16)', K.blue],
  // Backend-only states, drawn from the same palette.
  queued: ['Queued', '#B4B4B4', '#26262B', K.gray],
  failed: ['Failed', '#FCA5A5', 'rgba(239,68,68,0.16)', K.red],
};

export const GLOW_OF: Record<UiStatus, string> = {
  run: 'rgba(96,165,250,0.75)',
  done: 'rgba(34,197,94,0.55)',
  detect: 'rgba(239,68,68,0.85)',
  iso: 'rgba(239,68,68,0.85)',
  quar: 'rgba(239,68,68,0.85)',
  revoke: 'transparent',
  prov: 'rgba(245,158,11,0.8)',
  reply: 'rgba(96,165,250,0.75)',
  queued: 'transparent',
  failed: 'rgba(239,68,68,0.85)',
};

export const CORE_OF: Record<UiStatus, string> = {
  run: '#DBEAFE',
  done: '#BBF7D0',
  detect: '#FECACA',
  iso: '#FECACA',
  quar: '#FECACA',
  revoke: '#737373',
  prov: '#FDE68A',
  reply: '#DBEAFE',
  queued: '#737373',
  failed: '#FECACA',
};

export const isRed = (st: UiStatus) => st === 'detect' || st === 'iso' || st === 'quar' || st === 'failed';

/** Pill for a worker's output state: [label, text, background]. */
export const OUTPUT_PILL: Record<OutputState, [string, string, string]> = {
  pending: ['Pending', '#B4B4B4', '#26262B'],
  accepted: ['Accepted', '#86EFAC', 'rgba(34,197,94,0.14)'],
  rejected: ['Rejected · tainted', '#FCA5A5', 'rgba(239,68,68,0.16)'],
};
