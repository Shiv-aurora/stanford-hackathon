import type { CSSProperties } from 'react';
import { useMission } from '../lib/useMission';
import { Column, crumbHere } from '../components/Shell';
import { ArrowIcon, CheckIcon, CrossIcon } from '../components/Icons';
import { MONO } from '../lib/theme';

// Static view of the longer-term Flower federation layer (see VISION.md).
// Content is verbatim from the mockup.

const STATS = [
  { k: 'Participating labs', v: '3', sub: 'Defense · AI · Biotech' },
  { k: 'Current round', v: '14', sub: 'next in 4 min' },
  { k: 'Shared models', v: '6', sub: 'all at v14' },
  { k: 'Raw data shared', v: '0 B', sub: 'by design' },
];

const LABS = [
  { name: 'Defense Lab', n: '10', t: '2 min ago', you: false },
  { name: 'AI Lab', n: '8', t: 'Just now', you: true },
  { name: 'Biotech Lab', n: '12', t: '4 min ago', you: false },
];

const CROSSES = ['Clipped, noised weight updates', 'Round participation', 'Aggregate eval scores'];
const NEVER = ['Missions', 'Code and datasets', 'Prompts and outputs', 'Attack transcripts'];

const MODELS = [
  { name: 'Task decomposition', d: 'Splits a mission into small, solvable fragments' },
  { name: 'Routing', d: 'Matches each fragment to the right worker and tools' },
  { name: 'Permission assignment', d: 'Grants the least access a fragment needs' },
  { name: 'Attack detection', d: 'Flags injected instructions and odd worker behavior' },
  { name: 'Context minimization', d: 'Strips identifying detail before dispatch' },
  { name: 'Security policy', d: 'Chooses isolation, quarantine and revocation' },
];

const panel: CSSProperties = { borderRadius: 12, border: '1px solid #242428', backgroundColor: 'rgba(16,16,19,0.72)' };
const panelHead: CSSProperties = { height: 52, flexShrink: 0, boxSizing: 'border-box', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' };
const tableHead: CSSProperties = {
  height: 36,
  flexShrink: 0,
  boxSizing: 'border-box',
  padding: '0 16px',
  display: 'flex',
  alignItems: 'center',
  gap: 16,
  background: 'rgba(255,255,255,0.025)',
  borderTop: '1px solid #242428',
  borderBottom: '1px solid #242428',
  fontSize: 12,
  color: '#8E8E8E',
};
const chip: CSSProperties = { padding: '6px 10px', borderRadius: 8, background: '#1F1F23' };

export function Federation() {
  const { view } = useMission();
  if (view.mode === 'api') {
    return <Column header={<span style={crumbHere}>Federation</span>}>
      <main style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <h1 style={{ margin: 0 }}>SuperGrid federation</h1>
        <p style={{ color: '#B4B4B4' }}>
          {view.federation ?? 'Waiting for a mission'} · {view.runId ? `Run ${view.runId}` : 'Awaiting run assignment'}
        </p>
        <section style={{ ...panel, padding: 24, textAlign: 'center' }}>
          <strong>{view.runtime === 'supergrid' ? 'SuperGrid → ServerApp' : 'Local coordinator'}</strong>
          <p>Trusted coordinator · splits the mission and collects valid results</p>
          <div style={{ fontSize: 24 }}>↓</div>
          <p>One worker per SuperNode · each node runs a ClientApp</p>
        </section>
        <section style={{ ...panel, padding: 24 }}>
          {view.allWorkers.length === 0 && <p>Waiting for the ServerApp to assign workers.</p>}
          {view.allWorkers.map(w => <div key={w.key} style={{ display: 'flex', gap: 24, padding: '12px 0', borderBottom: '1px solid #242428' }}>
            <span style={{ flex: 1 }}>{w.role}</span><span style={{ flex: 2 }}>{w.ip}</span><span>{w.status}</span>
          </div>)}
        </section>
        <p style={{ color: '#8E8E8E' }}>Nodes remain assigned for the entire run. Replacements need a fresh node. Physical isolation depends on the federation deployment.</p>
        {view.error && <p role="alert" style={{ color: '#FCA5A5' }}>{view.error}</p>}
      </main>
    </Column>;
  }
  return (
    <Column
      header={
        <>
          <span style={crumbHere}>Federation</span>
          <span style={{ marginLeft: 6, fontSize: 12, fontWeight: 500, color: '#D4D4D4', background: '#2F2F2F', padding: '3px 8px', borderRadius: 6 }}>Powered by Flower</span>
        </>
      }
    >
      <main style={{ flexGrow: 1, minHeight: 0, boxSizing: 'border-box', padding: '28px 32px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>Federation</h1>
          <span style={{ fontSize: 14, color: '#B4B4B4' }}>Labs improve shared models together. Missions, code and data never leave each lab.</span>
        </div>

        <div style={{ display: 'flex', borderRadius: 14, border: '1px solid #202024', background: 'rgba(14,14,17,0.6)', padding: '18px 0' }}>
          {STATS.map((s, i) => (
            <div
              key={s.k}
              style={{ flex: 1, padding: '0 24px', borderLeft: `1px solid ${i === 0 ? 'transparent' : '#202024'}`, display: 'flex', flexDirection: 'column', gap: 8 }}
            >
              <span style={{ fontSize: 12, color: '#8E8E8E' }}>{s.k}</span>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.03em' }}>{s.v}</span>
                <span style={{ fontSize: 13, color: '#6E6E73' }}>{s.sub}</span>
              </div>
            </div>
          ))}
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 24 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section aria-label="Labs" style={{ ...panel, overflow: 'hidden' }}>
              <div style={panelHead}>
                <span style={{ fontSize: 15, fontWeight: 600 }}>Participating labs</span>
                <span style={{ fontSize: 13, color: '#8E8E8E' }}>Round 14</span>
              </div>
              <div style={tableHead}>
                <span style={{ flexGrow: 1 }}>Lab</span>
                <span style={{ width: 70 }}>Workers</span>
                <span style={{ width: 100 }}>Last update</span>
                <span style={{ width: 90 }}>Status</span>
              </div>
              {LABS.map((l) => (
                <div
                  key={l.name}
                  style={{ height: 52, boxSizing: 'border-box', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid #1F1F23', fontSize: 14 }}
                >
                  <span style={{ flexGrow: 1, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500 }}>
                    {l.name}
                    {l.you && <span style={{ fontSize: 12, fontWeight: 400, color: '#8E8E8E' }}>(you)</span>}
                  </span>
                  <span style={{ width: 70, color: '#D4D4D4' }}>{l.n}</span>
                  <span style={{ width: 100, color: '#D4D4D4' }}>{l.t}</span>
                  <span style={{ width: 90 }}>
                    <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: '#86EFAC', background: 'rgba(34,197,94,0.14)' }}>Reported</span>
                  </span>
                </div>
              ))}
            </section>

            <section aria-label="Boundary" style={{ ...panel, flexGrow: 1, padding: '16px 16px 18px', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>What leaves a lab</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', fontSize: 13 }}>
                <span style={chip}>Private swarm</span>
                <ArrowIcon />
                <span style={{ ...chip, background: 'rgba(59,130,246,0.16)', color: '#93C5FD' }}>Weight update</span>
                <ArrowIcon />
                <span style={chip}>Flower aggregator</span>
                <ArrowIcon />
                <span style={chip}>Shared models</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#B4B4B4' }}>Shared</span>
                  {CROSSES.map((x) => (
                    <span key={x} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                      <CheckIcon stroke="#86EFAC" />
                      {x}
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#B4B4B4' }}>Never shared</span>
                  {NEVER.map((x) => (
                    <span key={x} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#D4D4D4' }}>
                      <CrossIcon />
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            </section>
          </div>

          <section aria-label="Shared models" style={{ ...panel, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={panelHead}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Shared models</span>
              <span style={{ fontSize: 13, color: '#8E8E8E' }}>Improved every round</span>
            </div>
            <div style={tableHead}>
              <span style={{ flexGrow: 1 }}>Model</span>
              <span style={{ width: 56 }}>Version</span>
            </div>
            {MODELS.map((m) => (
              <div key={m.name} style={{ padding: '13px 16px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid #1F1F23' }}>
                <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{m.name}</span>
                  <span style={{ fontSize: 13, color: '#B4B4B4' }}>{m.d}</span>
                </div>
                <span style={{ width: 56, fontFamily: MONO, fontSize: 13, color: '#D4D4D4' }}>v14</span>
              </div>
            ))}
          </section>
        </div>
      </main>
    </Column>
  );
}
