import { useState, type CSSProperties } from 'react';
import { Column, crumb, crumbHere, crumbSep } from '../components/Shell';
import { LockIcon } from '../components/Icons';
import { CoordinatorChat, Segmented } from '../components/Chat';
import { CODE_DEMO, labOf, type ChatMode, type Lab } from '../lib/labs';
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

/** Empty chat: type or paste anything, or start one of the demo scenarios. */
function EmptyChat({ lab, onStart }: { lab: Lab; onStart: (prompt: string, mode: ChatMode) => void }) {
  const [mode, setMode] = useState<ChatMode>('chat');
  const [text, setText] = useState('');
  const send = () => text.trim() && onStart(text.trim(), mode);
  const demos: { n: string; title: string; body: string; prompt: string; mode: ChatMode; tone: string }[] = [
    {
      n: '1',
      title: 'Confidential research',
      body: `Paste a sensitive ${lab.name} brief. The coordinator splits it across isolated agents and hands you one answer.`,
      prompt: lab.demoPrompt,
      mode: 'chat',
      tone: '#60A5FA',
    },
    {
      n: '2',
      title: 'Poisoned document',
      body: 'The same brief with a prompt injection hidden in one section. The agent that reads it is caught and replaced; your answer is unaffected.',
      prompt: lab.demoPrompt + ' ' + lab.injection,
      mode: 'chat',
      tone: '#EF4444',
    },
    {
      n: '3',
      title: 'Private code review',
      body: 'Paste proprietary code in Code mode. Each agent reviews one function and never sees the rest of the codebase.',
      prompt: CODE_DEMO,
      mode: 'code',
      tone: '#22C55E',
    },
  ];
  return (
    <div style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: 48 }}>
      <div style={{ width: '100%', maxWidth: 820, display: 'flex', flexDirection: 'column', gap: 22 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', textAlign: 'center' }}>
          <h1 style={{ margin: 0, fontSize: 30, fontWeight: 600, letterSpacing: '-0.025em' }}>What should the swarm work on?</h1>
          <span style={{ fontSize: 15, color: '#8E8E8E' }}>
            Paste anything confidential. The coordinator splits it so no single agent ever sees all of it.
          </span>
        </div>
        <div style={{ ...card, padding: 14, gap: 10 }}>
          <textarea
            className="c-textarea"
            aria-label="Message"
            value={text}
            rows={5}
            placeholder={mode === 'code' ? 'Paste code to review (optionally with a request)…' : 'Describe the task or paste a confidential brief…'}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            style={{
              resize: 'none',
              padding: '10px 12px',
              borderRadius: 10,
              border: '1px solid #26262A',
              background: '#141417',
              color: '#ECECEC',
              font: mode === 'code' ? "13px/1.5 'Geist Mono', monospace" : "15px/1.5 'Geist', system-ui, sans-serif",
            }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Segmented
              label="Mode"
              value={mode}
              options={[
                ['chat', 'Chat'],
                ['code', 'Code'],
              ]}
              onChange={setMode}
            />
            <span style={{ fontSize: 12, color: '#8E8E8E' }}>
              {mode === 'code' ? 'Split by function: each agent sees one piece of the code.' : `Split by topic for the ${lab.name}.`}
            </span>
            <button type="button" disabled={!text.trim()} onClick={send} style={{ ...pillBtn, height: 40, marginLeft: 'auto', opacity: text.trim() ? 1 : 0.5 }}>
              Send
            </button>
          </div>
        </div>
        <span style={{ fontSize: 12, fontWeight: 500, color: '#8E8E8E' }}>Try a demo</span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
          {demos.map((d) => (
            <button
              key={d.n}
              type="button"
              onClick={() => onStart(d.prompt, d.mode)}
              style={{
                ...card,
                padding: 16,
                gap: 8,
                textAlign: 'left',
                color: '#ECECEC',
                cursor: 'pointer',
                borderColor: '#26262A',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', background: d.tone, color: '#0D0D0D', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {d.n}
                </span>
                {d.title}
              </span>
              <span style={{ fontSize: 13, lineHeight: 1.5, color: '#B4B4B4' }}>{d.body}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

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
  const empty = view.mode === 'api' && !view.id && !view.error;
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
          <span style={crumb}>Chats</span>
          <span style={crumbSep}>/</span>
          <span style={crumbHere}>{empty ? 'New chat' : view.name}</span>
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            {view.error && (
              <span title={view.error} style={{ fontSize: 12, fontWeight: 500, padding: '3px 8px', borderRadius: 999, color: '#FCA5A5', background: 'rgba(239,68,68,0.16)' }}>
                API offline
              </span>
            )}
            {!empty && phase === 0 && (
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
        {empty ? (
          <EmptyChat lab={labOf(view.lab)} onStart={(prompt, mode) => actions.createMission(prompt, mode)} />
        ) : (
        <>
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
        </>
        )}
      </main>
    </Column>
  );
}
