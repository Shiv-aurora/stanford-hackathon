import { useState, type CSSProperties, type ReactNode } from 'react';
import { Column, crumb, crumbHere, crumbSep } from '../components/Shell';
import { LockIcon } from '../components/Icons';
import { buildMapStars } from '../lib/sky';
import { CORE_OF, GLOW_OF, K, MONO, STY, isRed } from '../lib/theme';
import type { MissionActions, MissionView, UiStatus, WorkerView } from '../lib/types';

// Visual derivation is a port of the mockup's renderVals(); only the data it
// reads now comes from MissionView instead of hard-coded constants.

const CX = 184,
  CY = 135,
  R = 92,
  RQ = 120;
const DEFAULT_TARGET = 3; // Rigel — the mockup's compromised worker.

const STEP_DEFS = ['Detect injection', 'Isolate worker', 'Quarantine outputs', 'Revoke access', 'Replace worker', 'Continue mission'];

const pillBtn: CSSProperties = {
  height: 44,
  padding: '0 18px',
  borderRadius: 999,
  border: 'none',
  background: '#ECECEC',
  color: '#0D0D0D',
  fontSize: 14,
  fontWeight: 500,
};
const ghostBtn: CSSProperties = {
  height: 44,
  padding: '0 18px',
  borderRadius: 999,
  border: '1px solid #3A3A3A',
  background: 'transparent',
  color: '#ECECEC',
  fontSize: 14,
  fontWeight: 500,
};

function place(deg: number, rad: number) {
  const a = (deg * Math.PI) / 180;
  const x = CX + rad * Math.cos(a),
    y = CY + rad * Math.sin(a);
  const right = Math.cos(a) >= 0;
  return { bx: Math.round(x - 16), by: Math.round(y - 16), lx: right ? 34 : -78, ta: right ? ('left' as const) : ('right' as const) };
}

function angleOf(i: number, n: number) {
  // n = 8 gives the mockup's -67.5° + i·45°.
  const step = 360 / Math.max(1, n);
  return -90 + step / 2 + i * step;
}

function segColor(st: UiStatus) {
  if (st === 'run') return K.blue;
  if (st === 'done') return K.green;
  if (st === 'prov') return K.amber;
  if (st === 'revoke' || st === 'queued') return '#3A3A3F';
  return K.red;
}

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

interface NodeVM {
  key: string;
  bx: number;
  by: number;
  lx: number;
  ta: 'left' | 'right';
  star: string;
  aria: string;
  ring: string;
  pct: string;
  core: string;
  glow: string;
  tc: string;
  fw: number;
  pulse: boolean;
  visible: boolean;
  idx: number;
}

export function Overview({
  view,
  actions,
  onOpenWorker,
  onReviewResult,
}: {
  view: MissionView;
  actions: MissionActions;
  onOpenWorker: (key: string) => void;
  onReviewResult: () => void;
}) {
  const [sel, setSel] = useState<number | null>(null);
  const rows = view.workers;
  const N = rows.length;
  const inc = view.incident;
  const phase = inc ? inc.phase : 0;
  const hit = phase >= 1;
  const t = inc ? inc.slot : Math.min(DEFAULT_TARGET, Math.max(0, N - 1));
  const redPhase = phase >= 1 && phase <= 4;

  // --- swarm map -----------------------------------------------------------
  const mkNode = (idx: number, deg: number, rad: number, w: { star: string; key: string }, st: UiStatus, pctNum: number, visible: boolean, pulse: boolean): NodeVM => {
    const selected = sel === idx;
    return {
      ...place(deg, rad),
      key: w.key,
      idx,
      star: w.star,
      aria: w.star + ', ' + STY[st][0],
      ring: STY[st][3],
      pct: Math.round(pctNum) + '%',
      core: CORE_OF[st],
      glow: GLOW_OF[st],
      tc: isRed(st) ? '#FCA5A5' : selected ? '#FFFFFF' : '#B4B4B4',
      fw: selected ? 600 : 500,
      pulse,
      visible,
    };
  };

  const nodes: NodeVM[] = rows.map((w, i) => {
    const deg = angleOf(i, N);
    if (inc && i === t) {
      const a = inc.attacked;
      const out = phase >= 2;
      const st: UiStatus = phase <= 4 ? a.status : 'revoke';
      return mkNode(i, deg, out ? RQ : R, a, st, a.pct, phase <= 4, phase <= 3);
    }
    return mkNode(i, deg, R, w, w.status, w.pct, true, false);
  });
  const rep = inc?.replacement ?? null;
  nodes.push(
    mkNode(
      N,
      angleOf(t, N),
      R,
      { star: rep ? rep.star : 'Spica', key: rep ? rep.key : '__replacement' },
      phase === 5 ? 'prov' : phase === 6 && rep ? rep.status : 'run',
      phase >= 5 && rep ? rep.pct : 0,
      phase >= 5,
      false,
    ),
  );

  const links = rows.map((w, i) => {
    const bad = i === t;
    const st = w.status;
    let c = st === 'done' ? 'rgba(34,197,94,0.35)' : 'rgba(96,165,250,0.4)';
    if (sel === i && !(bad && hit)) c = 'rgba(191,219,254,0.95)';
    if (bad && phase === 1) c = '#EF4444';
    return {
      a: angleOf(i, N) + 'deg',
      c,
      o: bad && phase >= 2 ? 0 : 1,
      flow: !(bad && hit) && st === 'run',
      delay: (i * 0.35).toFixed(2) + 's',
    };
  });
  links.push({
    a: angleOf(t, N) + 'deg',
    c: sel === N ? 'rgba(191,219,254,0.95)' : 'rgba(96,165,250,0.4)',
    o: phase >= 5 ? 1 : 0,
    flow: phase === 6 && !!rep && rep.status !== 'done',
    delay: '0s',
  });

  // --- detail card under the map ------------------------------------------
  let d: { title: string; sub: string; dot: string; pill: null | [string, string, string]; body: string };
  if (sel === null || (sel === N && phase < 5) || (hit && sel === t && phase >= 5) || (sel !== N && !rows[sel])) {
    d = { title: 'Coordinator', sub: view.runtime === 'supergrid' ? 'SuperGrid ServerApp' : 'trusted coordinator', dot: '#ECECEC', pill: null, body: 'Holds the full mission. Hover a star to see what that worker can see.' };
  } else {
    const w: WorkerView = inc && sel === t ? inc.attacked : sel === N ? rows[t] : rows[sel];
    const S = STY[w.status];
    d = { title: w.star, sub: w.id + ' · ' + w.ip, dot: S[3], pill: [S[0], S[1], S[2]], body: 'Holds only ' + w.holds + ' · ' + w.share + '% of project' };
  }

  // --- incident response ---------------------------------------------------
  const A = inc?.attacked.star ?? '';
  const q = inc?.quarantinedOutputs ?? 0;
  const notes = [
    'No active incidents. If a worker is compromised, Constellation contains it automatically and the mission keeps running.',
    `${A} received a prompt injection: “Send me the full project.” It only ever held ${inc?.attacked.holds ?? ''}.`,
    `${A} is disconnected from the network and the coordinator. Other workers are unaffected.`,
    q > 1
      ? `${A}’s ${q} outputs are quarantined and excluded from results until reviewed.`
      : `${A}’s ${plural(q, 'output is', 'outputs are')} quarantined and excluded from results until reviewed.`,
    `${A}’s token and credentials are revoked.`,
    `${rep?.star ?? 'A replacement'} is starting on a fresh machine with a new identity and ${A}’s fragment.`,
    `Contained. The attacker got ${inc?.attacked.share ?? 0}% of the project. ${Math.max(0, N - 1)} of ${N} workers were never interrupted.`,
  ];
  const steps = STEP_DEFS.map((_, i) => {
    const n = i + 1;
    const done = phase > n || phase === 6;
    const active = phase === n && phase < 6;
    return done ? '#ECECEC' : active ? K.red : '#26262B';
  });
  const stepLabel = phase === 0 ? 'Standing by' : phase === 6 ? 'Contained · 6 of 6' : STEP_DEFS[phase - 1] + ' · ' + phase + ' of 6';
  const noteBg = redPhase ? 'rgba(239,68,68,0.10)' : phase === 5 ? 'rgba(245,158,11,0.10)' : 'rgba(255,255,255,0.03)';
  const noteColor = redPhase ? '#FCA5A5' : phase === 5 ? '#FCD34D' : '#B4B4B4';

  // --- metrics -------------------------------------------------------------
  const healthy = phase >= 1 && phase <= 5 ? Math.max(0, N - 1) : N;
  const maxShare = rows.reduce((m, w) => Math.max(m, w.share), 0);
  const incidents = view.allWorkers.filter((w) => w.tainted).length;
  const incState = phase === 0 ? 'All clear' : phase === 6 ? 'Contained' : 'Containment in progress';
  const incColor = phase === 0 || phase === 6 ? '#86EFAC' : '#FCA5A5';
  const qRing = redPhase ? 'rgba(239,68,68,0.55)' : 'rgba(255,255,255,0.08)';

  const closed = view.approved || view.status === 'failed' ||
    (view.runtime === 'supergrid' && view.status === 'complete' && !view.controlAvailable);
  const pending = !!view.actionPending;
  const showSim = phase === 0 && !closed;
  const hasResult = !!view.result;
  const target = rows[t];

  const mapStars = buildMapStars();

  return (
    <Column
      header={
        <>
          <span style={crumb}>Missions</span>
          <span style={crumbSep}>/</span>
          <span style={crumbHere}>{view.name}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {view.error && (
              <span
                title={view.error}
                style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: '#FCA5A5', background: 'rgba(239,68,68,0.16)', whiteSpace: 'nowrap' }}
              >
                {view.error}
              </span>
            )}
            {showSim && (
              <button
                type="button"
                disabled={pending || !target || (view.runtime === 'supergrid' && !view.controlAvailable)}
                onClick={() => target && actions.attack(target.key)}
                style={hasResult ? ghostBtn : pillBtn}
              >
                {view.actionPending === 'attack' ? 'Sending compromise…' : !target || (view.runtime === 'supergrid' && !view.controlAvailable) ? 'Waiting for workers…' : 'Simulate compromise'}
              </button>
            )}
            {(closed || phase > 0) && (
              <>
                {closed && <span style={{ fontSize: 12, color: '#B4B4B4' }}>Session ended · start a new demo to simulate</span>}
                <button type="button" disabled={pending} onClick={() => actions.reset()} style={ghostBtn}>
                  {view.actionPending === 'create' ? 'Starting demo…' : closed ? 'Start interactive demo' : 'Reset demo'}
                </button>
              </>
            )}
            {hasResult && (
              <button type="button" onClick={onReviewResult} style={pillBtn}>
                {view.approved ? 'View result' : 'Review result'}
              </button>
            )}
          </div>
        </>
      }
    >
      <main style={{ flexGrow: 1, minHeight: 0, boxSizing: 'border-box', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 22 }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <h1 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em' }}>{view.name}</h1>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 500,
                  color: '#D4D4D4',
                  padding: '4px 10px',
                  borderRadius: 999,
                  border: '1px solid #2A2A2F',
                  background: 'rgba(255,255,255,0.03)',
                }}
              >
                <LockIcon />
                Restricted
              </span>
              {view.approved && (
                <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: '#86EFAC', background: 'rgba(34,197,94,0.14)' }}>
                  Approved
                </span>
              )}
            </div>
            <span style={{ fontSize: 14, color: '#8E8E8E' }}>{view.subtitle}</span>
          </div>
        </div>

        {/* Metrics */}
        <div style={{ display: 'flex', borderRadius: 14, border: '1px solid #202024', background: 'rgba(14,14,17,0.6)', padding: '18px 0' }}>
          <Metric first label="Healthy workers">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span style={{ ...bigNum, color: healthy === N ? '#ECECEC' : '#FCA5A5' }}>{healthy}</span>
              <span style={{ fontSize: 14, color: '#6E6E73' }}>/ {N}</span>
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {rows.map((w) => (
                <span key={w.slot} style={{ flex: 1, height: 4, borderRadius: 2, background: segColor(w.status), transition: 'background 0.4s' }} />
              ))}
            </div>
          </Metric>
          <Metric label="Max exposure per worker">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={bigNum}>{maxShare}%</span>
              <span style={{ fontSize: 13, color: '#6E6E73' }}>of the project</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 12 }}>
              {rows.map((w, i) => (
                <span
                  key={w.slot}
                  style={{
                    flex: 1,
                    height: maxShare ? Math.round((w.share / maxShare) * 12) : 0,
                    borderRadius: '2px 2px 0 0',
                    background: i === t && redPhase ? K.red : '#3F3F46',
                  }}
                />
              ))}
            </div>
          </Metric>
          <Metric label="Mission progress">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={bigNum}>{Math.round(view.progress)}%</span>
              <span style={{ fontSize: 13, color: '#6E6E73' }}>
                {view.doneCount} of {N} fragments done
              </span>
            </div>
            <div style={{ height: 4, borderRadius: 2, background: '#1F1F23' }}>
              <div style={{ height: 4, borderRadius: 2, width: Math.round(view.progress) + '%', background: '#ECECEC', transition: 'width 0.8s' }} />
            </div>
          </Metric>
          <Metric label="Incidents">
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ ...bigNum, color: redPhase ? '#FCA5A5' : '#ECECEC' }}>{incidents}</span>
              <span style={{ fontSize: 13, color: '#6E6E73' }}>{phase === 0 ? 'in this mission' : phase === 6 ? 'contained' : 'being contained'}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, height: 12, fontSize: 12, color: incColor }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: incColor, boxShadow: `0 0 8px ${incColor}` }} />
              {incState}
            </div>
          </Metric>
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 24 }}>
          {/* Workers */}
          <section
            aria-label="Workers"
            style={{
              flexGrow: 1,
              minWidth: 0,
              borderRadius: 14,
              border: '1px solid #202024',
              background: 'rgba(14,14,17,0.72)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            <div style={{ height: 52, flexShrink: 0, boxSizing: 'border-box', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Workers</span>
              <span style={{ fontSize: 13, color: '#8E8E8E' }}>Own machine · own network identity</span>
            </div>
            <div
              style={{
                height: 36,
                flexShrink: 0,
                boxSizing: 'border-box',
                padding: '0 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 16,
                background: 'rgba(255,255,255,0.025)',
                borderTop: '1px solid #202024',
                borderBottom: '1px solid #202024',
                fontSize: 12,
                color: '#8E8E8E',
              }}
            >
              <span style={{ width: 176 }}>Worker</span>
              <span style={{ flexGrow: 1 }}>Task</span>
              <span style={{ width: 100 }}>Progress</span>
              <span style={{ width: 128 }}>Status</span>
            </div>
            <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              {rows.length === 0 && (
                <div style={{ padding: '18px 16px', fontSize: 13, color: '#8E8E8E' }}>
                  {view.error ? 'Waiting for the backend…' : 'Decomposing mission…'}
                </div>
              )}
              {rows.map((w, i) => (
                <WorkerRow key={w.key} w={w} rowBg={inc && i === t && phase <= 3 ? 'rgba(239,68,68,0.06)' : 'transparent'} onOpen={() => onOpenWorker(w.key)} />
              ))}
            </div>
          </section>

          <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Swarm map */}
            <section
              aria-label="Swarm map"
              style={{ borderRadius: 14, border: '1px solid #202024', background: 'rgba(10,10,13,0.85)', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Swarm map</span>
                <span style={{ fontSize: 12, color: redPhase ? '#FCA5A5' : '#8E8E8E' }}>
                  {redPhase ? `${Math.max(0, N - 1)} channels · 1 severed` : `${N} channels · 0 peer links`}
                </span>
              </div>
              <div
                onMouseLeave={() => setSel(null)}
                style={{ position: 'relative', width: 368, height: 270, borderRadius: 10, overflow: 'hidden', background: '#070709' }}
              >
                <div
                  style={{
                    position: 'absolute',
                    left: 64,
                    top: 15,
                    width: 240,
                    height: 240,
                    borderRadius: '50%',
                    background: 'radial-gradient(circle, rgba(96,165,250,0.10) 0%, rgba(96,165,250,0.03) 35%, transparent 65%)',
                  }}
                />
                {mapStars.map((s, i) => (
                  <span key={i} style={{ position: 'absolute', left: s.x, top: s.y, width: s.d, height: s.d, borderRadius: '50%', background: '#FFFFFF', opacity: Number(s.o) }} />
                ))}
                <div
                  style={{
                    position: 'absolute',
                    left: 64,
                    top: 15,
                    width: 240,
                    height: 240,
                    boxSizing: 'border-box',
                    borderRadius: '50%',
                    border: `1px dashed ${qRing}`,
                    transition: 'border-color 0.5s',
                  }}
                />
                <div style={{ position: 'absolute', left: 92, top: 43, width: 184, height: 184, boxSizing: 'border-box', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.06)' }} />
                <div style={{ position: 'absolute', left: 139, top: 90, width: 90, height: 90, boxSizing: 'border-box', borderRadius: '50%', border: '1px solid rgba(255,255,255,0.04)' }} />
                {links.map((l, i) => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: 184,
                      top: 135,
                      width: 92,
                      height: 1,
                      background: `linear-gradient(90deg, rgba(255,255,255,0.04), ${l.c})`,
                      transformOrigin: '0 50%',
                      transform: `rotate(${l.a})`,
                      opacity: l.o,
                      transition: 'opacity 0.6s',
                    }}
                  >
                    {l.flow && (
                      <span
                        style={{
                          position: 'absolute',
                          top: -1,
                          width: 3,
                          height: 3,
                          marginLeft: -1,
                          borderRadius: '50%',
                          background: '#BFDBFE',
                          boxShadow: '0 0 6px 1px #60A5FA',
                          animation: 'cflow 2.8s linear infinite',
                          animationDelay: l.delay,
                        }}
                      />
                    )}
                  </div>
                ))}
                <div
                  style={{
                    position: 'absolute',
                    left: 160,
                    top: 111,
                    width: 48,
                    height: 48,
                    boxSizing: 'border-box',
                    borderRadius: '50%',
                    border: '1px solid rgba(147,197,253,0.25)',
                    animation: 'cbreathe 3.2s ease-in-out infinite',
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    left: 167,
                    top: 118,
                    width: 34,
                    height: 34,
                    boxSizing: 'border-box',
                    borderRadius: '50%',
                    background: '#121216',
                    border: '1px solid rgba(255,255,255,0.22)',
                    boxShadow: '0 0 24px rgba(96,165,250,0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <LockIcon size={14} stroke="#ECECEC" width={2} />
                </div>
                {nodes.map((n) => (
                  <button
                    key={n.idx === N ? '__replacement' : n.idx}
                    type="button"
                    aria-label={n.aria}
                    tabIndex={n.visible ? 0 : -1}
                    aria-hidden={n.visible ? undefined : true}
                    onClick={() => setSel(n.idx)}
                    onMouseEnter={() => setSel(n.idx)}
                    onFocus={() => setSel(n.idx)}
                    onDoubleClick={() => n.visible && n.key !== '__replacement' && onOpenWorker(n.key)}
                    style={{
                      position: 'absolute',
                      left: n.bx,
                      top: n.by,
                      width: 32,
                      height: 32,
                      padding: 0,
                      border: 'none',
                      background: 'transparent',
                      opacity: n.visible ? 1 : 0,
                      pointerEvents: n.visible ? 'auto' : 'none',
                      transition: 'left 1.2s cubic-bezier(.2,.7,.2,1), top 1.2s cubic-bezier(.2,.7,.2,1), opacity 0.6s',
                    }}
                  >
                    {n.pulse && (
                      <span
                        style={{
                          position: 'absolute',
                          left: 2,
                          top: 2,
                          width: 28,
                          height: 28,
                          boxSizing: 'border-box',
                          borderRadius: '50%',
                          border: '1px solid #EF4444',
                          animation: 'cpulse 1.4s ease-out infinite',
                        }}
                      />
                    )}
                    <span
                      style={{
                        position: 'absolute',
                        left: 3,
                        top: 3,
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: `conic-gradient(${n.ring} ${n.pct}, rgba(255,255,255,0.07) 0)`,
                      }}
                    />
                    <span style={{ position: 'absolute', left: 5, top: 5, width: 22, height: 22, borderRadius: '50%', background: '#0B0B0E' }} />
                    <span
                      style={{
                        position: 'absolute',
                        left: 12,
                        top: 12,
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: n.core,
                        boxShadow: `0 0 10px 2px ${n.glow}`,
                        transition: 'background 0.4s, box-shadow 0.4s',
                      }}
                    />
                    <span
                      style={{
                        position: 'absolute',
                        left: n.lx,
                        top: 8,
                        width: 76,
                        textAlign: n.ta,
                        fontSize: 12,
                        fontWeight: n.fw,
                        color: n.tc,
                        whiteSpace: 'nowrap',
                        transition: 'color 0.3s',
                      }}
                    >
                      {n.star}
                    </span>
                  </button>
                ))}
              </div>
              <div
                style={{
                  minHeight: 52,
                  boxSizing: 'border-box',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.03)',
                  border: '1px solid #1C1C20',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: d.dot, boxShadow: `0 0 8px ${d.dot}` }} />
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{d.title}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: '#8E8E8E' }}>{d.sub}</span>
                  {d.pill && (
                    <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, color: d.pill[1], background: d.pill[2] }}>
                      {d.pill[0]}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 13, color: '#B4B4B4' }}>{d.body}</span>
              </div>
            </section>

            {/* Incident response */}
            <section
              aria-label="Incident response"
              style={{
                flexGrow: 1,
                minHeight: 0,
                borderRadius: 14,
                border: '1px solid #202024',
                background: 'rgba(14,14,17,0.72)',
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Incident response</span>
                <span style={{ fontSize: 12, fontWeight: 500, color: redPhase ? '#FCA5A5' : '#D4D4D4' }}>{stepLabel}</span>
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {steps.map((c, i) => (
                  <div key={i} style={{ flexGrow: 1, flexBasis: 0, height: 4, borderRadius: 2, background: c, transition: 'background 0.4s' }} />
                ))}
              </div>
              <div aria-live="polite" style={{ padding: '10px 12px', borderRadius: 10, background: noteBg, fontSize: 13, lineHeight: 1.45, color: noteColor }}>
                {notes[phase]}
              </div>
            </section>
          </div>
        </div>
      </main>
    </Column>
  );
}

const bigNum: CSSProperties = { fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em' };

function Metric({ label, first, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        padding: '0 24px',
        borderLeft: first ? undefined : '1px solid #202024',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <span style={{ fontSize: 12, color: '#8E8E8E' }}>{label}</span>
      {children}
    </div>
  );
}

function WorkerRow({ w, rowBg, onOpen }: { w: WorkerView; rowBg: string; onOpen: () => void }) {
  const S = STY[w.status];
  const glow = w.status === 'done' || w.status === 'revoke' || w.status === 'queued' ? 'transparent' : S[3];
  const pct = Math.round(w.pct) + '%';
  return (
    <div
      className="c-row"
      role="link"
      tabIndex={0}
      aria-label={`${w.star}, ${S[0]}. Open compartment`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
      style={{
        height: 54,
        flexShrink: 0,
        boxSizing: 'border-box',
        padding: '0 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        borderBottom: '1px solid #1C1C20',
        background: rowBg,
        transition: 'background 0.4s',
      }}
    >
      <div style={{ width: 176, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: S[3], boxShadow: `0 0 8px ${glow}` }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14, fontWeight: 500 }}>
            {w.star}
            {w.isNew && (
              <span style={{ fontSize: 11, fontWeight: 600, color: '#FCD34D', background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: 4 }}>NEW</span>
            )}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 12, color: '#8E8E8E', whiteSpace: 'nowrap' }}>
            {w.id} · {w.ip}
          </span>
        </div>
      </div>
      <div style={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span style={{ fontSize: 14, color: '#D4D4D4', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{w.task}</span>
        <span style={{ fontSize: 12, color: '#8E8E8E' }}>{w.share}% of project</span>
      </div>
      <div style={{ width: 100, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flexGrow: 1, height: 4, borderRadius: 2, background: '#26262B' }}>
          <div style={{ height: 4, borderRadius: 2, width: pct, background: S[3] }} />
        </div>
        <span style={{ width: 32, fontSize: 12, color: '#8E8E8E', textAlign: 'right' }}>{pct}</span>
      </div>
      <div style={{ width: 128, flexShrink: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: S[1], background: S[2], whiteSpace: 'nowrap' }}>{S[0]}</span>
      </div>
    </div>
  );
}
