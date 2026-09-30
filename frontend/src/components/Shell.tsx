import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { buildSky } from '../lib/sky';
import { ChatIcon, CheckIcon, LogoIcon, LogIcon, FederationIcon, OverviewIcon, PlusIcon, ShieldIcon } from './Icons';
import type { Lab, LabId } from '../lib/labs';

export type NavKey = 'chat' | 'overview' | 'compartments' | 'federation';

// The mockup is drawn on a 1440×900 board. Larger windows get the same layout
// stretched; smaller windows get the whole board zoomed down so nothing clips.
const BOARD_W = 1440;
const BOARD_H = 900;

function useFit() {
  const calc = () => {
    // innerWidth/innerHeight can briefly read 0 while a window is resized.
    const w = window.innerWidth || BOARD_W;
    const h = window.innerHeight || BOARD_H;
    const z = Math.min(1, w / BOARD_W, h / BOARD_H);
    return { z, w: w / z, h: h / z };
  };
  const [fit, setFit] = useState(calc);
  useEffect(() => {
    const on = () => setFit(calc());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return fit;
}

export function Frame({ children }: { children: ReactNode }) {
  const { z, w, h } = useFit();
  return (
    <div
      style={{
        position: 'relative',
        width: w,
        height: h,
        zoom: z,
        boxSizing: 'border-box',
        background: '#09090B',
        color: '#ECECEC',
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      {children}
    </div>
  );
}

export function Sky({ seed }: { seed: number }) {
  const sky = buildSky(seed);
  return (
    <div
      aria-hidden="true"
      style={{ position: 'absolute', left: 260, top: 0, right: 0, bottom: 0, overflow: 'hidden', pointerEvents: 'none' }}
    >
      {sky.map((s, i) => (
        <span
          key={i}
          style={{
            position: 'absolute',
            left: s.x,
            top: s.y,
            width: s.d,
            height: s.d,
            borderRadius: '50%',
            background: s.c,
            opacity: Number(s.o),
            boxShadow: s.g,
            animation: s.anim,
          }}
        />
      ))}
    </div>
  );
}

const navItem = (active: boolean): CSSProperties =>
  active
    ? { height: 40, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: 8, background: '#1F1F23', textDecoration: 'none', fontSize: 14, fontWeight: 500 }
    : { height: 40, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: 8, textDecoration: 'none', fontSize: 14, color: '#B4B4B4' };

const missionItem = (active: boolean): CSSProperties =>
  active
    ? { height: 36, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: 8, textDecoration: 'none', fontSize: 14, background: '#17171A', border: '1px solid #26262A' }
    : { height: 36, display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderRadius: 8, textDecoration: 'none', fontSize: 14, color: '#B4B4B4' };

const avatar = (size: number, font: number): CSSProperties => ({
  width: size,
  height: size,
  flexShrink: 0,
  borderRadius: '50%',
  background: '#3A3A3A',
  color: '#ECECEC',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: font,
  fontWeight: 600,
});

const dot = (c: string): CSSProperties => ({ width: 7, height: 7, borderRadius: '50%', background: c });

export interface SidebarMission {
  id: string;
  name: string;
  dot: string;
  current: boolean;
}

export function Sidebar({
  active,
  missions,
  onSelectMission,
  onNewMission,
  lab,
  labs,
  onSelectLab,
}: {
  active: NavKey;
  missions: SidebarMission[];
  onSelectMission: (id: string) => void;
  onNewMission: () => void;
  lab: Lab;
  /** Labs to switch between; empty when switching is unavailable (mock mode). */
  labs: Lab[];
  onSelectLab: (id: LabId) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('constellation.sidebar') === 'collapsed';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem('constellation.sidebar', c ? 'open' : 'collapsed');
      } catch {
        /* storage unavailable */
      }
      return !c;
    });
  const switchable = labs.length > 1;
  const item = (on: boolean): CSSProperties => (collapsed ? { ...navItem(on), justifyContent: 'center', padding: 0 } : navItem(on));
  const section = (label: string) =>
    collapsed ? (
      <div style={{ margin: '10px 12px 6px', borderTop: '1px solid #1C1C1F' }} />
    ) : (
      <div style={{ marginTop: 14, padding: '0 12px 6px', fontSize: 12, fontWeight: 500, color: '#8E8E8E' }}>{label}</div>
    );
  return (
    <aside
      style={{
        position: 'relative',
        width: collapsed ? 64 : 260,
        transition: 'width 0.2s ease',
        flexShrink: 0,
        boxSizing: 'border-box',
        background: '#0E0E10',
        borderRight: '1px solid #1C1C1F',
        padding: '14px 12px',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
      }}
    >
      <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : undefined, gap: 10, padding: collapsed ? 0 : '0 8px' }}>
        {!collapsed && <LogoIcon />}
        {!collapsed && <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}>Constellation</span>}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{ marginLeft: collapsed ? 0 : 'auto', width: 32, height: 32, borderRadius: 8, border: 'none', background: 'transparent', color: '#8E8E8E', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" aria-hidden="true">
            <rect x="3" y="4" width="18" height="16" rx="2.5" />
            <path d="M9 4v16" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        onClick={onNewMission}
        title="New chat"
        aria-label="New chat"
        style={{
          margin: '8px 0 10px',
          height: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: collapsed ? 0 : '0 12px',
          justifyContent: collapsed ? 'center' : undefined,
          borderRadius: 10,
          border: '1px solid #26262A',
          background: '#141417',
          color: '#ECECEC',
          fontSize: 14,
          fontWeight: 500,
          whiteSpace: 'nowrap',
        }}
      >
        <PlusIcon />
        {!collapsed && 'New chat'}
      </button>
      <nav aria-label="Main" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <a href="#/" title="Chat" style={item(active === 'chat')} aria-current={active === 'chat' ? 'page' : undefined}>
          <ChatIcon />
          {!collapsed && 'Chat'}
        </a>
      </nav>
      {!collapsed && (
        <>
          {section('Chats')}
          <div style={{ minHeight: 0, flexShrink: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
            {missions.map((m) => (
              <a
                key={m.id}
                href="#/"
                onClick={() => onSelectMission(m.id)}
                aria-current={m.current ? 'true' : undefined}
                style={{ ...missionItem(m.current && active !== 'federation'), flexShrink: 0 }}
              >
                <span style={dot(m.dot)} />
                {m.name}
              </a>
            ))}
          </div>
        </>
      )}
      {/* Extra detail for the curious: kept at the bottom, out of the main flow. */}
      <nav aria-label="Under the hood" style={{ marginTop: 'auto', paddingBottom: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {section('Under the hood')}
        <a href="#/overview" title="Swarm" style={item(active === 'overview')} aria-current={active === 'overview' ? 'page' : undefined}>
          <OverviewIcon />
          {!collapsed && 'Swarm'}
        </a>
        <a href="#/compartments" title="Compartments" style={item(active === 'compartments')} aria-current={active === 'compartments' ? 'page' : undefined}>
          <ShieldIcon />
          {!collapsed && 'Compartments'}
        </a>
        <a href="#/federation" title="Federation" style={item(active === 'federation')} aria-current={active === 'federation' ? 'page' : undefined}>
          <FederationIcon />
          {!collapsed && 'Federation'}
        </a>
        <a href="#/overview" title="Security log" style={item(false)}>
          <LogIcon />
          {!collapsed && 'Security log'}
        </a>
      </nav>
      <div style={{ position: 'relative', borderTop: '1px solid #1C1C1F' }}>
        {menu && switchable && (
          <div
            role="menu"
            aria-label="Switch lab"
            style={{
              position: 'absolute',
              left: 0,
              right: collapsed ? undefined : 0,
              width: collapsed ? 220 : undefined,
              zIndex: 20,
              bottom: 'calc(100% + 6px)',
              padding: 6,
              borderRadius: 10,
              border: '1px solid #26262A',
              background: '#141417',
              boxShadow: '0 12px 32px rgba(0,0,0,0.5)',
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              animation: 'crise 0.15s ease-out',
            }}
          >
            <div style={{ padding: '4px 8px 6px', fontSize: 12, fontWeight: 500, color: '#8E8E8E' }}>Labs</div>
            {labs.map((l) => (
              <button
                key={l.id}
                type="button"
                role="menuitemradio"
                aria-checked={l.id === lab.id}
                onClick={() => {
                  setMenu(false);
                  onSelectLab(l.id);
                }}
                style={{
                  height: 40,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '0 8px',
                  borderRadius: 8,
                  border: 'none',
                  background: l.id === lab.id ? '#1F1F23' : 'transparent',
                  color: '#ECECEC',
                  fontSize: 14,
                  textAlign: 'left',
                }}
              >
                <span style={avatar(24, 10)}>{l.initials}</span>
                <span style={{ flexGrow: 1 }}>{l.name}</span>
                {l.id === lab.id && <CheckIcon size={13} stroke="#86EFAC" />}
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          disabled={!switchable}
          aria-label={switchable ? `${lab.name}, switch lab` : undefined}
          aria-haspopup={switchable ? 'menu' : undefined}
          aria-expanded={switchable ? menu : undefined}
          onClick={() => setMenu((v) => !v)}
          onBlur={(e) => {
            if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setMenu(false);
          }}
          style={{
            width: '100%',
            height: 52,
            display: 'flex',
            alignItems: 'center',
            justifyContent: collapsed ? 'center' : undefined,
            gap: 10,
            padding: collapsed ? 0 : '0 8px',
            border: 'none',
            background: 'transparent',
            color: '#ECECEC',
            textAlign: 'left',
            cursor: switchable ? 'pointer' : 'default',
          }}
        >
          <span style={avatar(30, 12)}>{lab.initials}</span>
          {!collapsed && (
            <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
              <span style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap' }}>{lab.name}</span>
              <span style={{ fontSize: 12, color: '#8E8E8E', whiteSpace: 'nowrap' }}>Coordinator admin</span>
            </div>
          )}
          {switchable && !collapsed && (
            <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="#8E8E8E" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
            </svg>
          )}
        </button>
      </div>
    </aside>
  );
}

/** Main column: header bar + page body. */
export function Column({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div style={{ position: 'relative', flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <header
        style={{
          height: 64,
          flexShrink: 0,
          boxSizing: 'border-box',
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          borderBottom: '1px solid #1F1F23',
        }}
      >
        {header}
      </header>
      {children}
    </div>
  );
}

export const crumb: CSSProperties = { fontSize: 14, color: '#8E8E8E' };
export const crumbSep: CSSProperties = { fontSize: 14, color: '#525252' };
export const crumbHere: CSSProperties = { fontSize: 14, fontWeight: 500 };
