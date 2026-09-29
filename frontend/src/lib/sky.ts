// Seeded starfield generators, ported from the mockup so every screen draws the
// exact same stars (seed 97 = Overview, 131 = Compartments, 173 = Federation).

export interface SkyStar {
  x: string;
  y: string;
  d: string;
  c: string;
  o: string;
  g: string;
  anim: string;
}

function rng(seed: number) {
  let v = seed;
  return () => {
    v = (v * 16807) % 2147483647;
    return v / 2147483647;
  };
}

const skyCache = new Map<number, SkyStar[]>();

/** Background sky over the 1180×900 content area. Positions are % so it stretches with the window. */
export function buildSky(seed: number): SkyStar[] {
  const cached = skyCache.get(seed);
  if (cached) return cached;
  const rnd = rng(seed);
  const out: SkyStar[] = [];
  let tries = 0;
  while (out.length < 170 && tries < 5000) {
    tries++;
    const x = rnd() * 1180,
      y = rnd() * 900;
    const dx = (x - 590) / 590,
      dy = (y - 450) / 450;
    const d = Math.min(1, Math.sqrt(dx * dx * 0.85 + dy * dy * 0.65));
    if (rnd() > 0.05 + 0.95 * Math.pow(d, 2.4)) continue;
    const big = rnd() < 0.09;
    const t = rnd();
    const tw = rnd() < 0.14;
    out.push({
      x: ((x / 1180) * 100).toFixed(3) + '%',
      y: ((y / 900) * 100).toFixed(3) + '%',
      d: big ? '2px' : rnd() < 0.55 ? '1px' : '1.5px',
      c: t < 0.07 ? '#F2B48C' : t < 0.2 ? '#C3D5FF' : '#FFFFFF',
      o: (0.15 + rnd() * 0.5 * (0.45 + d * 0.55)).toFixed(2),
      g: big ? '0 0 5px rgba(255,255,255,0.45)' : 'none',
      anim: tw ? 'ctw ' + (3 + rnd() * 4).toFixed(1) + 's ease-in-out ' + (rnd() * 5).toFixed(1) + 's infinite' : 'none',
    });
  }
  skyCache.set(seed, out);
  return out;
}

export interface MapStar {
  x: string;
  y: string;
  d: string;
  o: string;
}

let mapStars: MapStar[] | null = null;

/** Faint stars inside the swarm map. */
export function buildMapStars(): MapStar[] {
  if (mapStars) return mapStars;
  const rnd = rng(313);
  const out: MapStar[] = [];
  for (let k = 0; k < 55; k++) {
    out.push({
      x: (rnd() * 366).toFixed(1) + 'px',
      y: (rnd() * 268).toFixed(1) + 'px',
      d: rnd() < 0.15 ? '1.5px' : '1px',
      o: (0.12 + rnd() * 0.35).toFixed(2),
    });
  }
  mapStars = out;
  return out;
}
