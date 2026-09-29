import { useState } from 'react';
import { K, MONO, STY, isRed } from '../lib/theme';
import type { MissionView, UiStatus, WorkerView } from '../lib/types';

// "Under the hood": Mission -> Coordinator -> context fragments -> workers.
// Shows how one mission is split so no worker holds the whole thing.

const W = 600;
const X_MISSION = 44;
const X_COORD = 150;
const X_FRAG = 262;
const X_WORKER = 470;
const ROW = 40;
const TOP = 34;

function edgeColor(st: UiStatus): { c: string; dash: boolean; o: number } {
  if (st === 'run' || st === 'reply') return { c: K.blue, dash: true, o: 0.9 };
  if (st === 'done') return { c: K.green, dash: false, o: 0.45 };
  if (st === 'prov' || st === 'queued') return { c: K.amber, dash: true, o: 0.7 };
  if (st === 'revoke') return { c: '#525252', dash: true, o: 0.5 };
  return { c: K.red, dash: true, o: 0.9 };
}

const curve = (x1: number, y1: number, x2: number, y2: number) => {
  const mx = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`;
};

export function SplitGraph({ view, onOpenWorker }: { view: MissionView; onOpenWorker: (key: string) => void }) {
  const [hover, setHover] = useState<string | null>(null);
  const workers: WorkerView[] = view.allWorkers;

  // Fragments: the labels workers receive. Mock fixtures list files instead of
  // categories, so fall back to one node per worker there.
  const labels: string[] = [];
  for (const w of workers) for (const f of w.allowed) if (!labels.includes(f.name)) labels.push(f.name);
  const perWorker = labels.length > 12;
  const frags = perWorker
    ? workers.filter((w) => !w.replacementFor).map((w) => ({ id: w.key, label: w.holds, secret: false }))
    : [
        ...labels.map((l) => ({ id: l, label: l, secret: false })),
        // Blocked for everyone: never leaves the coordinator.
        ...Array.from(new Set(workers.flatMap((w) => w.blocked)))
          .filter((b) => !labels.includes(b))
          .map((b) => ({ id: b, label: b, secret: true })),
      ];
  const fragsOf = (w: WorkerView) =>
    perWorker ? [w.replacementFor ? workers.find((x) => x.id === w.replacementFor || x.key === w.replacementFor)?.key ?? w.key : w.key] : w.allowed.map((f) => f.name);

  // Pending follow-up: light up the route it took.
  const last = view.chat[view.chat.length - 1];
  const routed = new Set(last && last.role === 'coordinator' && last.pending && view.chat.length > 2 ? last.routedTo.map((r) => r.key) : []);

  const rows = Math.max(frags.length, workers.length, 1);
  const H = TOP + rows * ROW + 16;
  const fy = (i: number) => TOP + (i + 0.5) * ((rows * ROW) / Math.max(1, frags.length));
  const wy = (i: number) => TOP + (i + 0.5) * ((rows * ROW) / Math.max(1, workers.length));
  const cy = TOP + (rows * ROW) / 2;
  const fragY = new Map(frags.map((f, i) => [f.id, fy(i)]));

  const focus = hover ? new Set([hover]) : routed;
  const focusFrags = new Set(workers.filter((w) => focus.has(w.key)).flatMap(fragsOf));
  const dim = focus.size > 0;

  const shared = frags.filter((f) => !f.secret).length;
  const secret = frags.length - shared;
  const maxShare = workers.reduce((m, w) => Math.max(m, w.share), 0);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minHeight: 0, flexGrow: 1 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, fontSize: 12, color: '#8E8E8E' }}>
        <span>
          <b style={{ color: '#ECECEC', fontWeight: 500 }}>{workers.filter((w) => !w.replacementFor).length}</b> workers
        </span>
        <span>
          <b style={{ color: '#ECECEC', fontWeight: 500 }}>{shared}</b> fragments sent
        </span>
        {secret > 0 && (
          <span>
            <b style={{ color: '#ECECEC', fontWeight: 500 }}>{secret}</b> kept in the enclave
          </span>
        )}
        <span>
          max <b style={{ color: '#ECECEC', fontWeight: 500 }}>{maxShare}%</b> per worker
        </span>
      </div>
      <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto' }}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }} onMouseLeave={() => setHover(null)}>
          {/* column captions */}
          {[
            [X_MISSION, 'Mission'],
            [X_COORD, 'Coordinator'],
            [X_FRAG + 40, 'Context fragments'],
            [X_WORKER + 40, 'Workers'],
          ].map(([x, t]) => (
            <text key={t} x={x} y={14} textAnchor="middle" fontSize={10.5} fill="#6B6B70" style={{ letterSpacing: '0.08em', textTransform: 'uppercase' }}>
              {t}
            </text>
          ))}

          {/* mission -> coordinator */}
          <path d={curve(X_MISSION + 26, cy, X_COORD - 20, cy)} stroke="#ECECEC" strokeOpacity={0.35} strokeWidth={1.5} fill="none" />

          {/* coordinator -> fragments */}
          {frags.map((f) => (
            <path
              key={'cf' + f.id}
              d={curve(X_COORD + 20, cy, X_FRAG, fragY.get(f.id)!)}
              stroke={f.secret ? '#3A3A3F' : '#4A4A52'}
              strokeOpacity={dim && !focusFrags.has(f.id) ? 0.25 : 0.8}
              strokeWidth={1}
              strokeDasharray={f.secret ? '2 3' : undefined}
              fill="none"
            />
          ))}

          {/* fragments -> workers */}
          {workers.flatMap((w, wi) =>
            fragsOf(w).map((fid) => {
              const e = edgeColor(w.status);
              const on = focus.has(w.key);
              const y1 = fragY.get(fid);
              if (y1 === undefined) return null;
              return (
                <path
                  key={w.key + fid}
                  d={curve(X_FRAG + 120, y1, X_WORKER - 10, wy(wi))}
                  stroke={e.c}
                  strokeOpacity={dim ? (on ? 1 : 0.12) : e.o}
                  strokeWidth={on ? 2 : 1.25}
                  strokeDasharray={e.dash ? '4 4' : undefined}
                  fill="none"
                  style={e.dash ? { animation: 'cdash 0.9s linear infinite' } : undefined}
                />
              );
            }),
          )}

          {/* mission node */}
          <g>
            <rect x={X_MISSION - 26} y={cy - 18} width={52} height={36} rx={8} fill="#1F1F23" stroke="#3A3A3F" />
            <path d={`M ${X_MISSION - 8} ${cy - 8} h 12 l 4 4 v 12 h -16 z`} fill="none" stroke="#ECECEC" strokeWidth={1.4} />
            <text x={X_MISSION} y={cy + 34} textAnchor="middle" fontSize={10.5} fill="#8E8E8E">
              full prompt
            </text>
          </g>

          {/* coordinator node */}
          <g>
            <circle cx={X_COORD} cy={cy} r={26} fill="none" stroke="rgba(147,197,253,0.25)" style={{ animation: 'cbreathe 3.2s ease-in-out infinite' }} />
            <circle cx={X_COORD} cy={cy} r={20} fill="#121216" stroke="rgba(255,255,255,0.22)" />
            <svg x={X_COORD - 8} y={cy - 8} width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="#ECECEC" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 0 1 8 0v4" />
            </svg>
            <text x={X_COORD} y={cy + 40} textAnchor="middle" fontSize={10.5} fill="#8E8E8E">
              trusted enclave
            </text>
          </g>

          {/* fragment nodes */}
          {frags.map((f) => {
            const y = fragY.get(f.id)!;
            const on = focusFrags.has(f.id);
            const text = f.label.length > 20 ? f.label.slice(0, 19) + '…' : f.label;
            return (
              <g key={'f' + f.id} opacity={dim && !on ? 0.4 : 1}>
                <title>{f.secret ? `${f.label}: never sent to any worker` : f.label}</title>
                <rect
                  x={X_FRAG}
                  y={y - 11}
                  width={120}
                  height={22}
                  rx={6}
                  fill={f.secret ? 'transparent' : on ? 'rgba(96,165,250,0.14)' : '#17171A'}
                  stroke={f.secret ? '#3A3A3F' : on ? 'rgba(147,197,253,0.6)' : '#2A2A30'}
                  strokeDasharray={f.secret ? '3 3' : undefined}
                />
                {f.secret && (
                  <svg x={X_FRAG + 6} y={y - 5} width={10} height={10} viewBox="0 0 24 24" fill="none" stroke="#8E8E8E" strokeWidth={2.4}>
                    <rect x="5" y="11" width="14" height="10" rx="2" />
                    <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                  </svg>
                )}
                <text x={X_FRAG + (f.secret ? 20 : 8)} y={y + 3.5} fontSize={10} fontFamily={MONO} fill={f.secret ? '#6B6B70' : '#D4D4D4'}>
                  {text}
                </text>
              </g>
            );
          })}

          {/* worker nodes */}
          {workers.map((w, i) => {
            const y = wy(i);
            const S = STY[w.status];
            const on = focus.has(w.key);
            return (
              <g
                key={'w' + w.key}
                style={{ cursor: 'pointer' }}
                opacity={dim && !on ? 0.45 : 1}
                onMouseEnter={() => setHover(w.key)}
                onClick={() => onOpenWorker(w.key)}
              >
                <title>{`${w.star} · ${w.role} · ${S[0]} · holds ${w.share}% · click to open its conversation`}</title>
                <rect x={X_WORKER - 12} y={y - 16} width={W - X_WORKER + 8} height={32} fill="transparent" />
                <circle cx={X_WORKER} cy={y} r={9} fill="#0B0B0E" stroke={S[3]} strokeWidth={2} />
                <circle cx={X_WORKER} cy={y} r={3.5} fill={S[3]} style={{ filter: `drop-shadow(0 0 4px ${S[3]})` }} />
                {(w.status === 'run' || w.status === 'reply' || isRed(w.status)) && (
                  <circle cx={X_WORKER} cy={y} r={13} fill="none" stroke={S[3]} strokeOpacity={0.5} style={{ animation: 'cbreathe 1.2s ease-in-out infinite' }} />
                )}
                <text x={X_WORKER + 18} y={y - 2} fontSize={12} fontWeight={500} fill={isRed(w.status) ? '#FCA5A5' : '#ECECEC'}>
                  {w.star}
                  {w.isNew && (
                    <tspan fill="#FCD34D" fontSize={9.5} fontWeight={600}>
                      {'  NEW'}
                    </tspan>
                  )}
                </text>
                <text x={X_WORKER + 18} y={y + 11} fontSize={10} fontFamily={MONO} fill="#6B6B70">
                  {S[0].toLowerCase()} · {w.share}%
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
