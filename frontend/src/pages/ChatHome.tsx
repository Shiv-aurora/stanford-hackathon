import type { CSSProperties } from 'react';
import { Column, crumb, crumbHere, crumbSep } from '../components/Shell';
import { LockIcon } from '../components/Icons';
import { CoordinatorChat } from '../components/Chat';
import { SplitGraph } from '../components/SplitGraph';
import type { MissionActions, MissionView } from '../lib/types';

// Home screen: talk to the coordinator, and watch how the mission is split.

const DEFAULT_TARGET = 3; // same worker the Overview's Simulate compromise hits

const pillBtn: CSSProperties = { height: 44, padding: '0 18px', borderRadius: 999, border: 'none', background: '#ECECEC', color: '#0D0D0D', fontSize: 14, fontWeight: 500 };
const ghostBtn: CSSProperties = { height: 44, padding: '0 18px', borderRadius: 999, border: '1px solid #3A3A3A', background: 'transparent', color: '#ECECEC', fontSize: 14, fontWeight: 500 };
const card: CSSProperties = {
  borderRadius: 14,
  border: '1px solid #202024',
  background: 'rgba(14,14,17,0.72)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  minHeight: 0,
};
const cardHead: CSSProperties = { height: 52, flexShrink: 0, boxSizing: 'border-box', padding: '0 16px', display: 'flex', alignItems: 'center', gap: 12 };

export function ChatHome({
  view,
  actions,
  onOpenConversation,
  onReviewResult,
}: {
  view: MissionView;
  actions: MissionActions;
  onOpenConversation: (key: string) => void;
  onReviewResult: () => void;
}) {
  const inc = view.incident;
  const phase = inc ? inc.phase : 0;
  const target = view.workers[inc ? inc.slot : Math.min(DEFAULT_TARGET, Math.max(0, view.workers.length - 1))];
  const hasResult = !!view.result;

  const A = inc?.attacked.star;
  const R = inc?.replacement?.star ?? 'A replacement';
  const banner = !inc
    ? null
    : phase <= 4
      ? { red: true, text: `${A} was hit by a prompt injection. It is being isolated and quarantined; it only ever held ${inc.attacked.share}% of the mission.` }
      : phase === 5
        ? { red: false, text: `${R} is replacing ${A} on a fresh node with the same narrow slice.` }
        : { red: false, text: `Contained. ${A}’s output was excluded from the answer and ${R} re-ran its fragment. No other worker was interrupted.` };

  return (
    <Column
      header={
        <>
          <span style={crumb}>Missions</span>
          <span style={crumbSep}>/</span>
          <span style={crumbHere}>{view.name}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {view.error && (
              <span title={view.error} style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: '#FCA5A5', background: 'rgba(239,68,68,0.16)' }}>
                API offline
              </span>
            )}
            {phase === 0 && (
              <button type="button" disabled={!target} onClick={() => target && actions.attack(target.key)} style={hasResult ? ghostBtn : pillBtn}>
                Simulate compromise
              </button>
            )}
            {phase > 0 && (
              <button type="button" onClick={() => actions.reset()} style={ghostBtn}>
                Reset demo
              </button>
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
      <main style={{ flexGrow: 1, minHeight: 0, boxSizing: 'border-box', padding: '24px 32px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 600, letterSpacing: '-0.025em' }}>{view.name}</h1>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500, padding: '3px 9px', borderRadius: 999, color: '#D4D4D4', background: '#1F1F23', border: '1px solid #2A2A2E' }}>
            <LockIcon />
            Restricted
          </span>
          <span style={{ fontSize: 13, color: '#8E8E8E' }}>{view.subtitle}</span>
        </div>

        <div style={{ flexGrow: 1, minHeight: 0, display: 'flex', gap: 20 }}>
          <section aria-label="Coordinator chat" style={{ ...card, flexGrow: 1, minWidth: 0 }}>
            <div style={cardHead}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Coordinator</span>
              <span style={{ marginLeft: 'auto', fontSize: 13, color: '#8E8E8E' }}>Only the coordinator ever sees the whole mission</span>
            </div>
            {banner && (
              <div
                aria-live="polite"
                style={{
                  margin: '0 16px',
                  padding: '9px 12px',
                  borderRadius: 10,
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: banner.red ? '#FCA5A5' : phase === 5 ? '#FCD34D' : '#86EFAC',
                  background: banner.red ? 'rgba(239,68,68,0.10)' : phase === 5 ? 'rgba(245,158,11,0.10)' : 'rgba(34,197,94,0.08)',
                }}
              >
                {banner.text}
              </div>
            )}
            <CoordinatorChat chat={view.chat} blocked={view.chatBlocked} onSend={actions.sendMessage} onOpenWorker={onOpenConversation} />
          </section>

          <section aria-label="Under the hood" style={{ ...card, width: 560, flexShrink: 0, padding: '0 16px 16px' }}>
            <div style={{ ...cardHead, padding: 0 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Under the hood</span>
              <span style={{ marginLeft: 'auto', fontSize: 12, color: '#8E8E8E' }}>Hover a worker · click to open it</span>
            </div>
            <SplitGraph view={view} onOpenWorker={onOpenConversation} />
          </section>
        </div>
      </main>
    </Column>
  );
}
