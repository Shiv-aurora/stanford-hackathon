import type { CSSProperties } from 'react';
import { Column, crumb, crumbHere, crumbSep } from '../components/Shell';
import { CheckIcon, FileIcon, LockIcon } from '../components/Icons';
import { MONO, OUTPUT_PILL, STY } from '../lib/theme';
import type { MissionView, WorkerView } from '../lib/types';

const card: CSSProperties = {
  borderRadius: 12,
  border: '1px solid #242428',
  backgroundColor: 'rgba(16,16,19,0.72)',
  padding: 20,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
const cardTitle: CSSProperties = { fontSize: 15, fontWeight: 600 };
const cardSub: CSSProperties = { fontSize: 13, color: '#B4B4B4' };
const label: CSSProperties = { fontSize: 12, fontWeight: 500, color: '#B4B4B4' };

/** Default worker when none is selected: the mockup shows Altair (slot 1). */
export function pickWorker(view: MissionView, key: string | null): WorkerView | null {
  if (key) {
    const hit = view.allWorkers.find((w) => w.key === key);
    if (hit) return hit;
  }
  return view.workers[1] ?? view.workers[0] ?? null;
}

function isolationRows(w: WorkerView) {
  const detached = w.ip === 'detached';
  const revoked = w.status === 'revoke';
  return [
    { k: 'Machine', v: 'Dedicated microVM, destroyed when done' },
    { k: 'Network', v: detached ? 'Detached · all traffic blocked' : 'Own identity · all outbound traffic denied' },
    { k: 'Filesystem', v: `Ephemeral · ${w.allowed.length} read-only ${w.allowed.length === 1 ? 'file' : 'files'}` },
    { k: 'Credentials', v: revoked ? 'Token revoked · coordinator notified' : 'One token · coordinator only · 30 min' },
    { k: 'Memory', v: 'Starts empty, nothing carried out' },
    { k: 'Peers', v: 'Cannot see or message other workers' },
  ];
}

export function Compartments({
  view,
  workerKey,
  onSelect,
}: {
  view: MissionView;
  workerKey: string | null;
  onSelect: (key: string) => void;
}) {
  const w = pickWorker(view, workerKey);

  if (!w) {
    return (
      <Column
        header={
          <>
            <span style={crumb}>{view.name}</span>
            <span style={crumbSep}>/</span>
            <span style={crumbHere}>Compartments</span>
          </>
        }
      >
        <main style={{ padding: '28px 32px', fontSize: 14, color: '#8E8E8E' }}>{view.error ? 'Waiting for the backend…' : 'No workers yet.'}</main>
      </Column>
    );
  }

  const S = STY[w.status];
  const out = OUTPUT_PILL[w.outputState];
  const rejected = w.outputState === 'rejected';

  return (
    <Column
      header={
        <>
          <span style={crumb}>{view.name}</span>
          <span style={crumbSep}>/</span>
          <span style={crumb}>Compartments</span>
          <span style={crumbSep}>/</span>
          <span style={crumbHere}>{w.star}</span>
        </>
      }
    >
      <main style={{ flexGrow: 1, minHeight: 0, boxSizing: 'border-box', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>{w.star}</h1>
              <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: S[1], background: S[2] }}>{S[0]}</span>
              {w.isNew && (
                <span style={{ fontSize: 11, fontWeight: 600, color: '#FCD34D', background: 'rgba(245,158,11,0.15)', padding: '1px 6px', borderRadius: 4 }}>NEW</span>
              )}
            </div>
            <span style={{ fontSize: 14, color: '#B4B4B4' }}>
              {w.id} · {w.task}
            </span>
          </div>
          <span style={{ marginLeft: 'auto', fontFamily: MONO, fontSize: 13, color: '#8E8E8E' }}>
            {w.sandbox} · {w.ip}
          </span>
        </div>

        <div role="group" aria-label="Worker" style={{ alignSelf: 'flex-start', display: 'flex', gap: 2, padding: 4, borderRadius: 12, background: '#1F1F23' }}>
          {view.allWorkers.map((t) => {
            const on = t.key === w.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                onClick={() => onSelect(t.key)}
                style={{
                  height: 36,
                  padding: '0 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: on ? '#3A3A3A' : 'transparent',
                  color: on ? '#ECECEC' : '#B4B4B4',
                  fontSize: 14,
                  fontWeight: on ? 500 : 400,
                }}
              >
                {t.star}
              </button>
            );
          })}
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 20 }}>
          {/* Receives — allowed / blocked context */}
          <section style={card}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={cardTitle}>Receives</span>
              <span style={cardSub}>
                {w.tokens ? w.tokens + ' · ' : ''}
                {w.share}% of project context
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {w.allowed.map((f) => (
                <div key={f.name} style={{ height: 44, display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid #1F1F23' }}>
                  <FileIcon />
                  <span style={{ fontFamily: MONO, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.name}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8E8E8E', whiteSpace: 'nowrap' }}>{f.meta}</span>
                </div>
              ))}
            </div>
            <div style={{ padding: '12px 14px', borderRadius: 10, background: '#1F1F23', display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={label}>Instruction</span>
              <span style={{ fontSize: 14, lineHeight: 1.5 }}>{w.instruction}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={label}>Removed before dispatch</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {w.blocked.map((x) => (
                  <span
                    key={x}
                    style={{ fontSize: 13, color: '#8E8E8E', textDecoration: 'line-through', padding: '4px 10px', borderRadius: 999, border: '1px solid #333333' }}
                  >
                    {x}
                  </span>
                ))}
              </div>
            </div>
            {/* Output — accepted by the coordinator, or rejected when tainted. */}
            <div
              style={{
                marginTop: 'auto',
                padding: '12px 14px',
                borderRadius: 10,
                background: rejected ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.03)',
                border: `1px solid ${rejected ? 'rgba(239,68,68,0.25)' : '#1F1F23'}`,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={label}>Output</span>
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 500, padding: '2px 8px', borderRadius: 999, color: out[1], background: out[2] }}>{out[0]}</span>
              </div>
              <span
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: rejected ? '#FCA5A5' : w.output ? '#D4D4D4' : '#8E8E8E',
                  textDecoration: rejected ? 'line-through' : 'none',
                }}
              >
                {w.output ?? 'Not returned yet. Outputs go to the coordinator only.'}
              </span>
              {rejected && <span style={{ fontSize: 12, color: '#B4B4B4' }}>Excluded from the synthesis · never reached other workers</span>}
            </div>
          </section>

          {/* Isolation */}
          <section style={card}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={cardTitle}>Isolation</span>
              <span style={cardSub}>Nothing is shared with other workers by default</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {isolationRows(w).map((r) => (
                <div key={r.k} style={{ padding: '12px 0', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid #1F1F23' }}>
                  <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: 14, fontWeight: 500 }}>{r.k}</span>
                    <span style={{ fontSize: 13, color: '#B4B4B4' }}>{r.v}</span>
                  </div>
                  <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, fontWeight: 500, color: '#86EFAC' }}>
                    <CheckIcon />
                    Enforced
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* If compromised — context exposure */}
          <section style={card}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={cardTitle}>{w.tainted ? 'Compromised' : 'If compromised'}</span>
              <span style={cardSub}>
                {w.tainted ? 'What the attacker got from ' : 'What an attacker could get from '}
                {w.star}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.03em', color: w.tainted ? '#FCA5A5' : undefined }}>{w.share}%</span>
              <span style={{ fontSize: 14, color: '#B4B4B4' }}>of the project</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={label}>Reachable</span>
              {w.reach.map((x) => (
                <span key={x} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#EF4444', flexShrink: 0 }} />
                  {x}
                </span>
              ))}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={label}>Out of reach</span>
              {w.unreach.map((x) => (
                <span key={x} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14, color: '#D4D4D4' }}>
                  <LockIcon size={13} stroke="#8E8E8E" width={2} />
                  {x}
                </span>
              ))}
            </div>
            <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid #1F1F23', fontSize: 13, lineHeight: 1.5, color: '#B4B4B4' }}>
              Outputs go through a schema check and injection scan, then to the coordinator only.
            </div>
          </section>
        </div>
      </main>
    </Column>
  );
}
