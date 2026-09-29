import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { CheckIcon, CrossIcon, LockIcon } from './Icons';
import { MONO, OUTPUT_PILL, STY } from '../lib/theme';
import type { MissionView } from '../lib/types';

// The mockup has no result or composer screens; these dialogs are built only
// from its existing pieces (card, pills, instruction box, table rows).

const pillBtn: CSSProperties = { height: 40, padding: '0 18px', borderRadius: 999, border: 'none', background: '#ECECEC', color: '#0D0D0D', fontSize: 14, fontWeight: 500 };
const ghostBtn: CSSProperties = { height: 40, padding: '0 18px', borderRadius: 999, border: '1px solid #3A3A3A', background: 'transparent', color: '#ECECEC', fontSize: 14, fontWeight: 500 };
const label: CSSProperties = { fontSize: 12, fontWeight: 500, color: '#B4B4B4' };

function Dialog({ title, onClose, width, children }: { title: string; onClose: () => void; width: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 50,
        background: 'rgba(5,5,7,0.72)',
        backdropFilter: 'blur(2px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'cfade 0.2s ease-out',
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={{
          width,
          maxHeight: 'calc(100% - 96px)',
          borderRadius: 14,
          border: '1px solid #202024',
          background: '#0E0E11',
          boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          outline: 'none',
          animation: 'crise 0.25s cubic-bezier(.2,.7,.2,1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

function DialogHead({ title, pill, sub, onClose }: { title: string; pill?: [string, string, string]; sub: ReactNode; onClose: () => void }) {
  return (
    <div style={{ padding: '20px 24px 16px', display: 'flex', alignItems: 'flex-start', gap: 12, borderBottom: '1px solid #1F1F23' }}>
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em' }}>{title}</span>
          {pill && <span style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: pill[1], background: pill[2] }}>{pill[0]}</span>}
        </div>
        <span style={{ fontSize: 13, color: '#8E8E8E' }}>{sub}</span>
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{ width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <CrossIcon size={16} stroke="#8E8E8E" />
      </button>
    </div>
  );
}

export function ResultDialog({ view, onApprove, onClose }: { view: MissionView; onApprove: () => void; onClose: () => void }) {
  const inc = view.incident;
  const verified = view.workers.filter((w) => w.outputState === 'accepted').length;
  const rejected = view.allWorkers.filter((w) => w.outputState === 'rejected');
  const pill: [string, string, string] = view.approved ? ['Approved', '#86EFAC', 'rgba(34,197,94,0.14)'] : ['Awaiting approval', '#FCD34D', 'rgba(245,158,11,0.15)'];
  return (
    <Dialog title="Coordinator synthesis" onClose={onClose} width={720}>
      <DialogHead
        title="Coordinator synthesis"
        pill={pill}
        onClose={onClose}
        sub={
          <>
            Reconstructed in the enclave from {verified} verified {verified === 1 ? 'fragment' : 'fragments'}
            {rejected.length > 0 && ` · ${rejected.length} tainted ${rejected.length === 1 ? 'output' : 'outputs'} rejected`}
          </>
        }
      />
      <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 18, overflowY: 'auto' }}>
        <div style={{ padding: '12px 14px', borderRadius: 10, background: '#1F1F23', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={label}>Result</span>
          <span style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{view.result ?? 'The coordinator is still collecting fragments.'}</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <span style={{ ...label, paddingBottom: 6 }}>Fragments</span>
          {view.allWorkers.map((w) => {
            const S = STY[w.status];
            const out = OUTPUT_PILL[w.outputState];
            const bad = w.outputState === 'rejected';
            return (
              <div key={w.key} style={{ minHeight: 52, padding: '8px 0', display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #1F1F23' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: S[3] }} />
                <div style={{ width: 128, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{w.star}</span>
                  <span style={{ fontFamily: MONO, fontSize: 12, color: '#8E8E8E' }}>{w.id}</span>
                </div>
                <span
                  style={{
                    flexGrow: 1,
                    minWidth: 0,
                    fontSize: 13,
                    lineHeight: 1.45,
                    color: bad ? '#FCA5A5' : '#B4B4B4',
                    textDecoration: bad ? 'line-through' : 'none',
                  }}
                >
                  {w.output ?? '—'}
                </span>
                <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: out[1], background: out[2], whiteSpace: 'nowrap' }}>
                  {out[0]}
                </span>
              </div>
            );
          })}
        </div>

        {inc && (
          <div style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', fontSize: 13, lineHeight: 1.45, color: '#B4B4B4' }}>
            {inc.attacked.star} was compromised and only ever held {inc.attacked.holds} ({inc.attacked.share}% of the project). Its output never reached the synthesis
            {inc.replacement ? `; ${inc.replacement.star} re-ran the fragment.` : '.'}
          </div>
        )}
      </div>
      <div style={{ padding: '16px 24px', borderTop: '1px solid #1F1F23', display: 'flex', alignItems: 'center', gap: 10 }}>
        {view.approved ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#86EFAC' }}>
            <CheckIcon />
            Approved by AI Lab · released from the enclave
          </span>
        ) : (
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#8E8E8E' }}>
            <LockIcon size={13} stroke="#8E8E8E" width={2} />
            Held in the enclave until a human approves it
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 10 }}>
          <button type="button" onClick={onClose} style={ghostBtn}>
            Close
          </button>
          {!view.approved && (
            <button type="button" disabled={view.status !== 'complete'} onClick={onApprove} style={{ ...pillBtn, opacity: view.status === 'complete' ? 1 : 0.5 }}>
              Approve result
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

export function NewMissionDialog({ initialPrompt, mode, onLaunch, onClose }: { initialPrompt: string; mode: 'mock' | 'api'; onLaunch: (p: string) => void; onClose: () => void }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  return (
    <Dialog title="New mission" onClose={onClose} width={600}>
      <DialogHead
        title="New mission"
        pill={['Restricted', '#D4D4D4', 'rgba(255,255,255,0.06)']}
        onClose={onClose}
        sub="Only the coordinator sees the full brief. Each worker receives a narrow fragment."
      />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onLaunch(prompt);
        }}
        style={{ display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <label htmlFor="mission-prompt" style={label}>
            Confidential objective
          </label>
          <textarea
            id="mission-prompt"
            className="c-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={6}
            autoFocus
            style={{
              resize: 'none',
              padding: '12px 14px',
              borderRadius: 10,
              border: '1px solid #26262A',
              background: '#141417',
              color: '#ECECEC',
              font: "14px/1.5 'Geist', system-ui, sans-serif",
            }}
          />
          <span style={{ fontSize: 12, color: '#8E8E8E' }}>
            {mode === 'api' ? 'Sent to the coordinator at POST /mission.' : 'Mock mode · the demo mission replays deterministically.'}
          </span>
        </div>
        <div style={{ padding: '16px 24px', borderTop: '1px solid #1F1F23', display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
          <button type="button" onClick={onClose} style={ghostBtn}>
            Cancel
          </button>
          <button type="submit" disabled={!prompt.trim()} style={{ ...pillBtn, opacity: prompt.trim() ? 1 : 0.5 }}>
            Launch mission
          </button>
        </div>
      </form>
    </Dialog>
  );
}
