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
  const switchable = labs.length > 1;
  return (
    <aside
      style={{
        position: 'relative',
        width: 260,
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
      <div style={{ height: 44, display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px' }}>
        <LogoIcon />
        <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Constellation</span>
      </div>
      <button
        type="button"
        onClick={onNewMission}
        style={{
          margin: '8px 0 10px',
          height: 44,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '0 12px',
          borderRadius: 10,
          border: '1px solid #26262A',
          background: '#141417',
          color: '#ECECEC',
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        <PlusIcon />
        New mission
      </button>
      <nav aria-label="Main" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <a href="#/" style={navItem(active === 'chat')} aria-current={active === 'chat' ? 'page' : undefined}>
          <ChatIcon />
          Chat
        </a>
        <div style={{ marginTop: 14, padding: '0 12px 6px', fontSize: 12, fontWeight: 500, color: '#8E8E8E' }}>Under the hood</div>
        <a href="#/overview" style={navItem(active === 'overview')} aria-current={active === 'overview' ? 'page' : undefined}>
          <OverviewIcon />
          Swarm
        </a>
        <a href="#/compartments" style={navItem(active === 'compartments')} aria-current={active === 'compartments' ? 'page' : undefined}>
          <ShieldIcon />
          Compartments
        </a>
        <a href="#/federation" style={navItem(active === 'federation')} aria-current={active === 'federation' ? 'page' : undefined}>
          <FederationIcon />
          Federation
        </a>
        <a href="#/overview" style={navItem(false)}>
          <LogIcon />
          Security log
        </a>
      </nav>
      <div style={{ marginTop: 20, padding: '0 12px 6px', fontSize: 12, fontWeight: 500, color: '#8E8E8E' }}>Missions</div>
      <div style={{ minHeight: 0, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
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
      <div style={{ position: 'relative', marginTop: 'auto', borderTop: '1px solid #1C1C1F' }}>
        {menu && switchable && (
          <div
            role="menu"
            aria-label="Switch lab"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
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
            gap: 10,
            padding: '0 8px',
            border: 'none',
            background: 'transparent',
            color: '#ECECEC',
            textAlign: 'left',
            cursor: switchable ? 'pointer' : 'default',
          }}
        >
          <span style={avatar(30, 12)}>{lab.initials}</span>
          <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1 }}>
            <span style={{ fontSize: 14, fontWeight: 500 }}>{lab.name}</span>
            <span style={{ fontSize: 12, color: '#8E8E8E' }}>Coordinator admin</span>
          </div>
          {switchable && (
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
