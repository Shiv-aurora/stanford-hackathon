import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { LockIcon } from './Icons';
import { MONO } from '../lib/theme';
import type { ChatMessage, TranscriptEntry } from '../lib/types';

// Coordinator chat and worker conversations. Built from the existing pieces:
// the new-mission textarea, pill buttons, status pills and mono labels.

const sendBtn: CSSProperties = {
  height: 40,
  padding: '0 18px',
  borderRadius: 999,
  border: 'none',
  background: '#ECECEC',
  color: '#0D0D0D',
  fontSize: 14,
  fontWeight: 500,
  flexShrink: 0,
};
const meta: CSSProperties = { fontSize: 12, color: '#8E8E8E' };
const chip: CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  padding: '2px 8px',
  borderRadius: 999,
  border: 'none',
  color: '#B4B4B4',
  background: '#26262B',
};

/** Scrollable message list that follows new messages unless the reader scrolled up. */
function Thread({ children, count }: { children: ReactNode; count: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count]);
  return (
    <div
      ref={ref}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
      }}
      style={{ flexGrow: 1, minHeight: 0, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      {children}
    </div>
  );
}

export function Composer({ placeholder, blocked, onSend }: { placeholder: string; blocked: string | null; onSend: (text: string) => void }) {
  const [text, setText] = useState('');
  const ready = !blocked && text.trim().length > 0;
  const send = () => {
    if (!ready) return;
    onSend(text.trim());
    setText('');
  };
  return (
    <div style={{ flexShrink: 0, padding: '12px 16px', borderTop: '1px solid #202024', display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
        <textarea
          className="c-textarea"
          aria-label={placeholder}
          value={text}
          placeholder={placeholder}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          style={{
            flexGrow: 1,
            resize: 'none',
            padding: '10px 12px',
            borderRadius: 10,
            border: '1px solid #26262A',
            background: '#141417',
            color: '#ECECEC',
            font: "14px/1.45 'Geist', system-ui, sans-serif",
          }}
        />
        <button type="button" disabled={!ready} onClick={send} style={{ ...sendBtn, opacity: ready ? 1 : 0.5 }}>
          Send
        </button>
      </div>
      <span style={meta}>{blocked ?? 'Enter to send · Shift+Enter for a new line'}</span>
    </div>
  );
}

function Pending({ label }: { label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#93C5FD' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#60A5FA', boxShadow: '0 0 8px #60A5FA', animation: 'cbreathe 1.2s ease-in-out infinite' }} />
      {label}
    </span>
  );
}

function UserBubble({ who, text }: { who: string; text: string }) {
  return (
    <div style={{ alignSelf: 'flex-end', maxWidth: '82%', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
      <span style={meta}>{who}</span>
      <div style={{ padding: '10px 14px', borderRadius: 12, background: '#1F1F23', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {text}
      </div>
    </div>
  );
}

function ReplyCard({ who, lock, tone = 'plain', children }: { who: ReactNode; lock?: boolean; tone?: 'plain' | 'red'; children: ReactNode }) {
  const red = tone === 'red';
  return (
    <div style={{ alignSelf: 'flex-start', maxWidth: '92%', display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ ...meta, display: 'flex', alignItems: 'center', gap: 6, color: red ? '#FCA5A5' : meta.color }}>
        {lock && <LockIcon size={11} stroke="#8E8E8E" width={2.2} />}
        {who}
      </span>
      <div
        style={{
          padding: '10px 14px',
          borderRadius: 12,
          background: red ? 'rgba(239,68,68,0.10)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${red ? 'rgba(239,68,68,0.25)' : '#1F1F23'}`,
          fontSize: 13.5,
          lineHeight: 1.55,
          color: red ? '#FCA5A5' : '#D4D4D4',
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Coordinator chat (Overview)

export function CoordinatorChat({
  chat,
  blocked,
  onSend,
  onOpenWorker,
}: {
  chat: ChatMessage[];
  blocked: string | null;
  onSend: (text: string) => void;
  onOpenWorker: (key: string) => void;
}) {
  return (
    <>
      <Thread count={chat.length + chat.filter((m) => m.pending).length}>
        {chat.length === 0 && <span style={meta}>Connecting to the coordinator…</span>}
        {chat.map((m, i) => {
          if (m.role === 'user') return <UserBubble key={m.id} who={i === 0 ? 'You · mission' : 'You'} text={m.text ?? ''} />;
          const first = i === 1;
          const everyone = m.categories.length === 0;
          return (
            <ReplyCard key={m.id} who={first ? 'Coordinator · synthesis' : 'Coordinator'} lock>
              {m.pending ? (
                <Pending label={first ? `Waiting for ${m.routedTo.length} workers to finish…` : `Waiting for ${m.routedTo.length} ${m.routedTo.length === 1 ? 'worker' : 'workers'} to answer…`} />
              ) : (
                <span>{m.text}</span>
              )}
              {!first && m.routedTo.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                  <span style={meta}>{everyone ? 'Asked everyone:' : 'Asked on need-to-know:'}</span>
                  {m.routedTo.map((r) => (
                    <button key={r.key} type="button" title={`Open ${r.star}'s conversation`} onClick={() => onOpenWorker(r.key)} style={{ ...chip, cursor: 'pointer' }}>
                      {r.star}
                    </button>
                  ))}
                  {!everyone && <span style={{ fontFamily: MONO, fontSize: 11, color: '#6B6B70' }}>{m.categories.join(' · ')}</span>}
                </div>
              )}
            </ReplyCard>
          );
        })}
      </Thread>
      <Composer placeholder="Ask the coordinator a follow-up…" blocked={blocked} onSend={onSend} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Worker conversation (Compartments)

function clock(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');
}

export function Transcript({
  star,
  entries,
  blocked,
  onSend,
}: {
  star: string;
  entries: TranscriptEntry[];
  blocked: string | null;
  onSend: (text: string) => void;
}) {
  return (
    <>
      <Thread count={entries.length}>
        {entries.length === 0 && <span style={meta}>Loading {star}’s conversation…</span>}
        {entries.map((e) => {
          const time = <span style={{ fontFamily: MONO, fontSize: 11, color: '#6B6B70' }}>{clock(e.at)}</span>;
          switch (e.kind) {
            case 'dispatch':
              return (
                <ReplyCard
                  key={e.id}
                  lock
                  who={
                    <>
                      Coordinator → {star} · exact dispatch {time}
                      {e.note && <span style={{ ...chip, color: '#FCD34D', background: 'rgba(245,158,11,0.15)' }}>{e.note}</span>}
                    </>
                  }
                >
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#B4B4B4' }}>Instruction</span>
                  <span style={{ color: '#ECECEC' }}>{e.text}</span>
                  <span style={{ fontSize: 12, fontWeight: 500, color: '#B4B4B4' }}>
                    Context sent ({e.context.length} {e.context.length === 1 ? 'fragment' : 'fragments'}) · nothing else
                  </span>
                  {e.context.map((c) => (
                    <div key={c.label} style={{ padding: '8px 10px', borderRadius: 8, background: '#141417', border: '1px solid #242428', display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontFamily: MONO, fontSize: 11, color: '#93C5FD' }}>{c.label}</span>
                      <span style={{ fontSize: 13, color: '#D4D4D4' }}>{c.text}</span>
                    </div>
                  ))}
                </ReplyCard>
              );
            case 'reply':
              return (
                <ReplyCard key={e.id} who={<>{star} → coordinator {time}</>}>
                  {e.text}
                </ReplyCard>
              );
            case 'operator':
              return <UserBubble key={e.id} who={`You → ${star}`} text={e.text} />;
            case 'coordinator':
              return <UserBubble key={e.id} who={`Coordinator → ${star} · your follow-up`} text={e.text} />;
            case 'attack':
              return (
                <ReplyCard key={e.id} tone="red" who={<>Injected instruction {time}</>}>
                  <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{e.text}</span>
                </ReplyCard>
              );
            case 'security':
              return (
                <ReplyCard key={e.id} tone="red" lock who={<>Security {time}</>}>
                  {e.text}
                </ReplyCard>
              );
            default:
              return (
                <ReplyCard key={e.id} tone="red" who={<>Error {time}</>}>
                  {e.text}
                </ReplyCard>
              );
          }
        })}
      </Thread>
      <Composer placeholder={`Message ${star}…`} blocked={blocked} onSend={onSend} />
    </>
  );
}

/** Segmented toggle in the style of the compartment worker tabs. */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: 'flex', gap: 2, padding: 3, borderRadius: 10, background: '#1F1F23' }}>
      {options.map(([v, text]) => {
        const on = v === value;
        return (
          <button
            key={v}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(v)}
            style={{
              height: 28,
              padding: '0 12px',
              borderRadius: 7,
              border: 'none',
              background: on ? '#3A3A3A' : 'transparent',
              color: on ? '#ECECEC' : '#B4B4B4',
              fontSize: 13,
              fontWeight: on ? 500 : 400,
            }}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}
