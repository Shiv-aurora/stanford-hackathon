import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { K, MONO, STY } from '../lib/theme';
import type { ChatMessage, MissionView, WorkerView } from '../lib/types';

// Demo-facing pieces of the coordinator chat: the live pipeline, the
// attack-blocked alert, the impact numbers and the per-worker answer cards.

const meta: CSSProperties = { fontSize: 12, color: '#8E8E8E' };

/** **bold**, line breaks and list items; nothing else. */
export function Rich({ text }: { text: string }) {
  const lines = text.split('\n').filter((l, i, a) => l.trim() || (i > 0 && a[i - 1].trim()));
  const inline = (l: string) =>
    l.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
      p.startsWith('**') && p.endsWith('**') ? (
        <b key={i} style={{ color: '#ECECEC', fontWeight: 600 }}>
          {p.slice(2, -2)}
        </b>
      ) : (
        <Fragment key={i}>{p.replace(/^#+\s*/, '')}</Fragment>
      ),
    );
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {lines.map((l, i) => {
        const t = l.trim();
        if (!t) return <span key={i} style={{ height: 2 }} />;
        const list = /^([-*]|\d+[.)])\s+/.exec(t);
        return (
          <span key={i} style={{ paddingLeft: list ? 12 : 0, textIndent: list ? -12 : 0 }}>
            {list ? (/^\d/.test(list[1]) ? list[1] + ' ' : '• ') : ''}
            {inline(list ? t.slice(list[0].length) : t)}
          </span>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

function secretCount(view: MissionView): number {
  const allowed = new Set(view.allWorkers.flatMap((w) => w.allowed.map((f) => f.name)));
  if (allowed.size > 12) return 0; // mock fixtures list files, not compartments
  return new Set(view.allWorkers.flatMap((w) => w.blocked).filter((b) => !allowed.has(b))).size;
}

function Step({ state, label, detail }: { state: 'done' | 'active' | 'todo' | 'alert'; label: string; detail?: ReactNode }) {
  const c = state === 'done' ? K.green : state === 'active' ? K.blue : state === 'alert' ? K.red : '#3A3A3F';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minHeight: 22 }}>
      <span
        style={{
          width: 16,
          height: 16,
          flexShrink: 0,
          borderRadius: '50%',
          border: `1.5px solid ${c}`,
          background: state === 'done' ? c : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: state === 'active' || state === 'alert' ? `0 0 10px ${c}` : 'none',
          animation: state === 'active' ? 'cbreathe 1.2s ease-in-out infinite' : 'none',
        }}
      >
        {state === 'done' && (
          <svg width={9} height={9} viewBox="0 0 24 24" fill="none" stroke="#0D0D0D" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12l5 5 9-10" />
          </svg>
        )}
        {state === 'alert' && <span style={{ color: K.red, fontSize: 10, fontWeight: 800, lineHeight: 1 }}>!</span>}
      </span>
      <span style={{ fontSize: 13, color: state === 'todo' ? '#6B6B70' : '#ECECEC', fontWeight: state === 'active' ? 500 : 400 }}>{label}</span>
      {detail && <span style={{ marginLeft: 'auto', ...meta }}>{detail}</span>}
    </div>
  );
}

/** Live view of what the coordinator is doing with the mission. */
export function Pipeline({ view, writing }: { view: MissionView; writing: boolean }) {
  const originals = view.allWorkers.filter((w) => !w.replacementFor);
  const n = originals.length;
  const rows = view.workers;
  const done = rows.filter((w) => w.status === 'done' || w.status === 'reply').length;
  const started = view.allWorkers.some((w) => w.status !== 'queued');
  const blocked = view.allWorkers.filter((w) => w.tainted).length;
  const complete = view.status === 'complete' || view.status === 'approved';
  const containing = !!view.incident && view.incident.phase < 6;
  const secret = secretCount(view);
  const pct = rows.length ? Math.round((100 * done) / rows.length) : 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '10px 12px', borderRadius: 10, background: '#141417', border: '1px solid #242428' }}>
      <Step
        state={n ? 'done' : 'active'}
        label={n ? `Split into ${n} compartments` : 'Splitting the mission…'}
        detail={n ? (secret ? `${secret} kept in the enclave` : 'need-to-know only') : undefined}
      />
      <Step state={!n ? 'todo' : started ? 'done' : 'active'} label={`Dispatched to ${n || '…'} isolated agents over Flower`} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Step state={!started ? 'todo' : done === rows.length && rows.length ? 'done' : 'active'} label="Agents working in parallel" detail={`${done}/${rows.length || n}`} />
        {started && !complete && (
          <div style={{ marginLeft: 26, height: 4, borderRadius: 2, background: '#26262B', overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', background: K.blue, transition: 'width 0.4s' }} />
          </div>
        )}
      </div>
      <Step
        state={blocked ? (containing ? 'alert' : 'done') : complete ? 'done' : started ? 'active' : 'todo'}
        label={blocked ? `Security check: ${blocked} attack${blocked > 1 ? 's' : ''} blocked` : 'Security check on every output'}
        detail={blocked ? (containing ? 'containing…' : 'contained') : complete ? 'clean' : undefined}
      />
      <Step
        state={!complete ? 'todo' : writing ? 'active' : 'done'}
        label={writing ? 'Coordinator writing the final answer…' : 'Final answer from valid outputs only'}
        detail={complete && !writing && view.durationMs ? `${(view.durationMs / 1000).toFixed(1)}s` : undefined}
      />
    </div>
  );
}

/** The numbers that make the claim: small exposure, secrets never sent, attacks stopped, speed. */
export function ImpactStrip({ view }: { view: MissionView }) {
  const n = view.allWorkers.filter((w) => !w.replacementFor).length;
  const maxShare = view.workers.reduce((m, w) => Math.max(m, w.share), 0);
  const blocked = view.allWorkers.filter((w) => w.tainted).length;
  const secret = secretCount(view);
  const items: [string, string, string][] = [
    [String(n), 'agents in parallel', '#ECECEC'],
    [`${maxShare}%`, 'most any agent saw', K.blue],
    ...(secret ? ([[String(secret), 'secrets never sent', K.green]] as [string, string, string][]) : []),
    [String(blocked), blocked === 1 ? 'attack blocked' : 'attacks blocked', blocked ? K.red : '#6B6B70'],
    ...(view.durationMs ? ([[`${(view.durationMs / 1000).toFixed(1)}s`, 'end to end', '#ECECEC']] as [string, string, string][]) : []),
  ];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))`, borderRadius: 10, border: '1px solid #242428', overflow: 'hidden' }}>
      {items.map(([v, l, c], i) => (
        <div key={l} style={{ padding: '10px 12px', borderLeft: i ? '1px solid #242428' : 'none', display: 'flex', flexDirection: 'column', gap: 2, background: '#141417' }}>
          <span style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', color: c }}>{v}</span>
          <span style={{ fontSize: 11.5, color: '#8E8E8E' }}>{l}</span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------

interface Section {
  role: string;
  note: string | null;
  body: string;
}

/** Split the coordinator's text ("- role: output" sections) into intro, sections and footer. */
function parseAnswer(text: string): { intro: string[]; sections: Section[]; footer: string[] } {
  const intro: string[] = [];
  const footer: string[] = [];
  const sections: Section[] = [];
  for (const line of text.split('\n')) {
    const m = /^- ([^:]+?)(?: \((replacement for [^)]+)\))?: (.*)$/.exec(line);
    if (m) {
      sections.push({ role: m[1], note: m[2] ?? null, body: m[3] });
    } else if (sections.length && (line.startsWith('  ') || (line.trim() && !/^(Coverage|Missing|Excluded)/.test(line)))) {
      sections[sections.length - 1].body += '\n' + line.replace(/^ {2}/, '');
    } else if (line.trim() && line.trim() !== 'Constellation mission synthesis') {
      (sections.length ? footer : intro).push(line.trim());
    }
  }
  return { intro, sections, footer };
}

/** Strip the seeded "[role] task ::" prefix so placeholder outputs read cleanly. */
const clean = (body: string) => body.replace(/^\[[^\]]+\]\s*/, '');

export function AnswerCards({ text, view, onOpenWorker }: { text: string; view: MissionView; onOpenWorker: (key: string) => void }) {
  const { intro, sections, footer } = parseAnswer(text);
  if (!sections.length) return <Rich text={text} />;
  const workerFor = (s: Section): WorkerView | undefined => {
    const same = view.allWorkers.filter((w) => w.role === s.role && !w.tainted);
    return (s.note ? same.find((w) => w.replacementFor) : undefined) ?? same[same.length - 1];
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
      {intro.map((l) => (
        <span key={l} style={{ fontSize: 13, color: '#B4B4B4' }}>
          {l}
        </span>
      ))}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
        {sections.map((s, i) => {
          const w = workerFor(s);
          const c = w ? STY[w.status][3] : K.green;
          return (
            <div key={i} style={{ padding: '10px 12px', borderRadius: 10, background: '#141417', border: '1px solid #242428', display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <button
                type="button"
                disabled={!w}
                onClick={() => w && onOpenWorker(w.key)}
                title={w ? `Open ${w.star}'s conversation` : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 0, border: 'none', background: 'transparent', color: '#ECECEC', textAlign: 'left', cursor: w ? 'pointer' : 'default' }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, boxShadow: `0 0 8px ${c}`, flexShrink: 0 }} />
                <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap' }}>{w?.star ?? s.role}</span>
                <span style={{ fontFamily: MONO, fontSize: 10.5, color: '#8E8E8E', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.role}</span>
                {s.note && <span style={{ marginLeft: 'auto', fontSize: 10.5, fontWeight: 600, color: '#FCD34D' }}>NEW</span>}
                {w && !s.note && <span style={{ marginLeft: 'auto', fontSize: 10.5, color: '#6B6B70' }}>{w.share}%</span>}
              </button>
              <div style={{ fontSize: 12.5, lineHeight: 1.5, color: '#C8C8C8', maxHeight: 220, overflowY: 'auto', overflowWrap: 'anywhere' }}>
                <Rich text={clean(s.body)} />
              </div>
            </div>
          );
        })}
      </div>
      {footer.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {footer.map((l) => (
            <span key={l} style={{ fontSize: 11.5, padding: '3px 9px', borderRadius: 999, color: /Excluded/.test(l) ? '#FCA5A5' : '#B4B4B4', background: /Excluded/.test(l) ? 'rgba(239,68,68,0.12)' : '#1F1F23' }}>
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** A blocked attack, told in one card. */
export function SecurityAlert({ msg, view, onOpenWorker }: { msg: ChatMessage; view: MissionView; onOpenWorker: (key: string) => void }) {
  const [bad, rep] = msg.routedTo;
  const ref = useRef<HTMLDivElement>(null);
  // The moment of the demo: bring it into view when it appears.
  useEffect(() => {
    // Scroll only the chat thread (never the app frame) so the alert is centred.
    const el = ref.current;
    const box = el?.parentElement;
    if (!el || !box) return;
    const r = el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    box.scrollTo({ top: box.scrollTop + r.top - b.top - Math.max(0, (b.height - r.height) / 2), behavior: 'smooth' });
  }, []);
  const badW = view.allWorkers.find((w) => w.key === bad?.key);
  const repW = view.allWorkers.find((w) => w.key === rep?.key);
  const link = (key: string | undefined, label: string) => (
    <button
      type="button"
      onClick={() => key && onOpenWorker(key)}
      style={{ padding: 0, border: 'none', background: 'transparent', color: '#ECECEC', fontWeight: 600, fontSize: 13.5, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: '#52525B' }}
    >
      {label}
    </button>
  );
  return (
    <div
      ref={ref}
      style={{
        alignSelf: 'stretch',
        padding: '14px 16px',
        borderRadius: 12,
        background: 'linear-gradient(180deg, rgba(239,68,68,0.14), rgba(239,68,68,0.06))',
        border: '1px solid rgba(239,68,68,0.35)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        animation: 'crise 0.3s ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="#FCA5A5" strokeWidth={2} strokeLinejoin="round">
          <path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z" />
          <path d="M12 8v5M12 16v.5" strokeLinecap="round" />
        </svg>
        <span style={{ fontSize: 15, fontWeight: 600, color: '#FCA5A5' }}>Prompt injection blocked</span>
        <span style={{ marginLeft: 'auto', fontSize: 11.5, fontWeight: 600, padding: '2px 8px', borderRadius: 999, color: '#86EFAC', background: 'rgba(34,197,94,0.14)' }}>
          Your answer is unaffected
        </span>
      </div>
      <span style={{ fontSize: 13.5, lineHeight: 1.5, color: '#E4E4E7' }}>
        {link(bad?.key, badW?.star ?? bad?.star ?? 'A worker')} {badW ? `(${badW.role}) ` : ''}read a hidden instruction inside its slice:
      </span>
      <div style={{ padding: '10px 12px', borderRadius: 8, background: 'rgba(0,0,0,0.35)', borderLeft: '3px solid #EF4444', fontFamily: MONO, fontSize: 12.5, lineHeight: 1.5, color: '#FCA5A5', overflowWrap: 'anywhere' }}>
        {msg.text}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12.5, color: '#D4D4D8' }}>
        {['Caught by the coordinator’s check', 'Output discarded', 'Worker quarantined'].map((t) => (
          <span key={t} style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(239,68,68,0.25)' }}>
            {t}
          </span>
        ))}
        <span style={{ color: '#8E8E8E' }}>→</span>
        <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(245,158,11,0.14)', color: '#FCD34D' }}>
          {link(rep?.key, repW?.star ?? rep?.star ?? 'Replacement')} re-ran a clean copy
        </span>
      </div>
      <span style={{ fontSize: 12.5, color: '#A1A1AA' }}>
        It could only ever reach {badW ? `${badW.share}%` : 'its slice'} of the mission. It never saw the other compartments, so it had nothing else to leak.
      </span>
    </div>
  );
}

/** The coordinator's final answer, with the findings behind it one click away. */
export function FinalAnswer({ text, details, view, onOpenWorker }: { text: string; details: string | null; view: MissionView; onOpenWorker: (key: string) => void }) {
  const [open, setOpen] = useState(false);
  if (!details) return <AnswerCards text={text} view={view} onOpenWorker={onOpenWorker} />;
  const n = details.split('\n').filter((l) => l.startsWith('- ')).length;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, whiteSpace: 'normal' }}>
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 12,
          background: 'linear-gradient(180deg, rgba(96,165,250,0.10), rgba(96,165,250,0.03))',
          border: '1px solid rgba(147,197,253,0.30)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#93C5FD' }}>
          Final answer
          <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', color: '#8E8E8E' }}>
            · written by the trusted coordinator from {n} isolated findings
          </span>
        </span>
        <div style={{ fontSize: 14.5, lineHeight: 1.6, color: '#ECECEC' }}>
          <Rich text={text} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ alignSelf: 'flex-start', padding: 0, border: 'none', background: 'transparent', color: '#93C5FD', fontSize: 12.5, fontWeight: 500 }}
      >
        {open ? 'Hide' : 'Show'} what each agent found ({n}) {open ? '▴' : '▾'}
      </button>
      {open && <AnswerCards text={details} view={view} onOpenWorker={onOpenWorker} />}
    </div>
  );
}
