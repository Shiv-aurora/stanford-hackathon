/* Hangar One Underground: an endless tunnel runner under Hangar One at NASA Ames.
   Plain Three.js (r128), no build step. */
(function () {
  'use strict';
  const THREE = window.THREE;
  const V3 = THREE.Vector3;
  const QS = new URLSearchParams(location.search);
  const GOD = QS.has('god'); // test mode: no deaths, auto-turn

  // ---------- world constants
  const W = 9;            // corridor width
  const H = 6;            // corridor height
  const LANE = 3;         // lane spacing
  const TY = -10;         // tunnel floor height
  const RAMP_A = 14, RAMP_B = 52, SEG0_LEN = 210; // the ramp ends right under Hangar One's front wall
  const GRAV = 30, JUMP_V = 10.2, SLIDE_TIME = 0.75;
  const DIRS = [new V3(0, 0, -1), new V3(1, 0, 0), new V3(0, 0, 1), new V3(-1, 0, 0)];
  const RIGHT = d => DIRS[(d + 1) % 4];
  const yawOf = d => -d * Math.PI / 2;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[(Math.random() * a.length) | 0];
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = t => t * t * (3 - 2 * t);
  const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
  function lerpAngle(a, b, t) {
    let d = (b - a) % (Math.PI * 2);
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }
  const store = {
    get(k, f) { try { const v = localStorage.getItem(k); return v == null ? f : JSON.parse(v); } catch (e) { return f; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  };

  // ---------- renderer
  const canvas = document.getElementById('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 2600);
  const MAXANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 0.8 ? 84 : 70;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);

  // ---------- canvas textures
  function makeCanvas(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    return c;
  }
  function tex(w, h, draw, repeat) {
    const t = new THREE.CanvasTexture(makeCanvas(w, h, draw));
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = MAXANISO;
    return t;
  }
  function fillNoise(g, w, h, rgb, amt) {
    const img = g.createImageData(w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amt;
      d[i] = rgb[0] + n; d[i + 1] = rgb[1] + n; d[i + 2] = rgb[2] + n; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  }
  function stains(g, w, h, count, rgb, maxR, alpha) {
    for (let i = 0; i < count; i++) {
      const x = rand(0, w), y = rand(0, h), r = rand(maxR * 0.3, maxR);
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(${rgb},${alpha})`);
      gr.addColorStop(1, `rgba(${rgb},0)`);
      g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  function stripes(g, x, y, w, h, period, c1, c2) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    g.fillStyle = c1; g.fillRect(x, y, w, h); g.fillStyle = c2;
    for (let k = -h - period; k < w + h; k += period) {
      g.beginPath();
      g.moveTo(x + k, y + h); g.lineTo(x + k + period / 2, y + h);
      g.lineTo(x + k + period / 2 + h, y); g.lineTo(x + k + h, y);
      g.closePath(); g.fill();
    }
    g.restore();
  }
  const F_DISPLAY = '"Saira Stencil One", Impact, "Arial Black", sans-serif';
  const F_BODY = '"Barlow Condensed", "Arial Narrow", Arial, sans-serif';

  // NASA-style insignia: blue disc, stars, orbit, red vector, wordmark.
  function drawInsignia(g, cx, cy, R) {
    g.save();
    g.fillStyle = '#0b3d91';
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#fff';
    const stars = [[-.55, -.45, .035], [-.2, -.7, .025], [.35, -.55, .03], [.6, -.15, .02], [-.7, .05, .02], [.15, .65, .028], [-.45, .55, .022], [.65, .4, .025], [0, -.35, .018], [-.25, .25, .016]];
    for (const s of stars) { g.beginPath(); g.arc(cx + s[0] * R, cy + s[1] * R, s[2] * R * 1.4, 0, Math.PI * 2); g.fill(); }
    g.strokeStyle = '#fff'; g.lineWidth = R * 0.035;
    g.save(); g.translate(cx, cy); g.rotate(-0.5); g.beginPath(); g.ellipse(0, 0, R * 0.82, R * 0.3, 0, 0, Math.PI * 2); g.stroke(); g.restore();
    g.fillStyle = '#fc3d21';
    g.beginPath();
    g.moveTo(cx - R * 1.0, cy + R * 0.5);
    g.quadraticCurveTo(cx + R * 0.1, cy + R * 0.02, cx + R * 1.0, cy - R * 0.62);
    g.quadraticCurveTo(cx + R * 0.35, cy + R * 0.02, cx - R * 0.3, cy + R * 0.7);
    g.quadraticCurveTo(cx - R * 0.6, cy + R * 0.58, cx - R * 1.0, cy + R * 0.5);
    g.fill();
    g.restore();
    g.fillStyle = '#fff';
    g.font = `700 ${R * 0.52}px ${F_BODY}`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('NASA', cx, cy + R * 0.03);
  }

  // curved lettering around a circle (top reads clockwise, bottom reads left-to-right)
  function arcText(g, text, cx, cy, r, center, top, spacing) {
    const ws = [...text].map(c => g.measureText(c).width);
    const total = ws.reduce((a, b) => a + b, 0) + spacing * (ws.length - 1), span = total / r;
    let acc = 0;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    [...text].forEach((ch, i) => {
      const a = top ? center - span / 2 + (acc + ws[i] / 2) / r : center + span / 2 - (acc + ws[i] / 2) / r;
      g.save(); g.translate(cx + r * Math.cos(a), cy + r * Math.sin(a)); g.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2);
      g.fillText(ch, 0, 0); g.restore();
      acc += ws[i] + spacing;
    });
  }
  function star4(g, x, y, r) {
    g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r * 0.25, y - r * 0.25); g.lineTo(x + r, y); g.lineTo(x + r * 0.25, y + r * 0.25);
    g.lineTo(x, y + r); g.lineTo(x - r * 0.25, y + r * 0.25); g.lineTo(x - r, y); g.lineTo(x - r * 0.25, y - r * 0.25); g.closePath(); g.fill();
  }
  // Ames Research Center lapel pin: gold rim, white ring with curved lettering, insignia with the vector poking out top right
  function drawAmesPin(g, w) {
    const c = w / 2, gold = '#c9a24a', goldDark = '#8a6a1e';
    const ring = (r, fill) => { g.fillStyle = fill; g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.fill(); };
    const gr = g.createLinearGradient(0, 0, w, w); gr.addColorStop(0, '#f3dc8c'); gr.addColorStop(0.5, gold); gr.addColorStop(1, goldDark);
    ring(236, gr); ring(226, '#f7f6f1'); ring(158, gr); ring(151, '#1f3f99');
    g.fillStyle = '#2a2414'; g.font = `700 38px ${F_BODY}`;
    arcText(g, 'AMES RESEARCH CENTER', c, c, 192, -Math.PI / 2 - 0.12, true, 2.5);
    arcText(g, 'SILICON VALLEY, CA', c, c, 192, Math.PI / 2 + 0.05, false, 3.5);
    g.save(); g.beginPath(); g.arc(c, c, 151, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#fff';
    for (const [x, y, r] of [[300, 140, 9], [205, 170, 6], [350, 330, 7], [168, 352, 6], [330, 205, 4], [230, 380, 4]]) star4(g, x, y, r);
    for (let i = 0; i < 40; i++) { const a = rand(0, 6.28), r = rand(20, 145); g.fillRect(c + Math.cos(a) * r, c + Math.sin(a) * r, 2.2, 2.2); }
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5;
    g.save(); g.translate(c + 12, c + 4); g.rotate(-0.42); g.beginPath(); g.ellipse(0, 0, 48, 128, 0, 0, Math.PI * 2); g.stroke(); g.restore();
    g.restore();
    // the vector
    g.beginPath();
    g.moveTo(52, 362); g.quadraticCurveTo(250, 236, 506, 54); g.quadraticCurveTo(300, 270, 80, 380); g.quadraticCurveTo(62, 376, 52, 362); g.closePath();
    g.fillStyle = '#a3381c'; g.fill(); g.lineWidth = 4; g.strokeStyle = gold; g.stroke();
    // NASA wordmark, white with a gold outline
    g.font = `900 104px Georgia, "Times New Roman", serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    const letters = ['N', 'A', 'S', 'A'], xs = [-108, -36, 36, 108];
    letters.forEach((L, i) => { g.lineWidth = 7; g.strokeStyle = goldDark; g.strokeText(L, c + xs[i], c + 6); g.fillStyle = '#fff'; g.fillText(L, c + xs[i], c + 6); });
  }
  function heather(g, w, h) {
    const img = g.createImageData(w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { const n = 132 + (Math.random() - 0.5) * 34 + (Math.random() < 0.08 ? 22 : 0); d[i] = n; d[i + 1] = n; d[i + 2] = n + 2; d[i + 3] = 255; }
    g.putImageData(img, 0, 0);
  }
  function collar(g, w) { g.strokeStyle = 'rgba(70,70,72,.6)'; g.lineWidth = 6; g.beginPath(); g.ellipse(w / 2, -6, 56, 30, 0, 0, Math.PI); g.stroke(); }
  // "I was an Intern @NASA" back print: astronaut, blue disc, red orbit ring, satellite
  function drawShirtBack(g, w, h) {
    heather(g, w, h);
    const cx = w / 2 + 6, cy = 112, R = 66;
    g.strokeStyle = '#e0242a'; g.lineWidth = 8;
    g.save(); g.translate(cx, cy); g.rotate(-0.38); g.beginPath(); g.ellipse(0, 0, R + 34, 26, 0, Math.PI * 0.92, Math.PI * 1.92); g.stroke(); g.restore();
    g.fillStyle = '#1f3f99'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
    g.lineWidth = 5; g.strokeStyle = '#e0242a'; g.stroke();
    g.fillStyle = '#fff'; for (let i = 0; i < 18; i++) { const a = rand(0, 6.28), r = rand(10, R - 6); g.fillRect(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 2, 2); }
    star4(g, cx + 40, cy - 36, 5); star4(g, cx - 34, cy + 44, 4);
    g.strokeStyle = '#e0242a'; g.lineWidth = 8;
    g.save(); g.translate(cx, cy); g.rotate(-0.38); g.beginPath(); g.ellipse(0, 0, R + 34, 26, 0, Math.PI * 0.02, Math.PI * 0.92); g.stroke(); g.restore();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = `600 20px Arial, Helvetica, sans-serif`; g.fillText('I was an', cx - 6, cy - 30);
    g.font = `900 38px Arial, Helvetica, sans-serif`; g.lineWidth = 6; g.strokeStyle = '#fff'; g.strokeText('Intern', cx, cy + 4); g.fillStyle = '#e0242a'; g.fillText('Intern', cx, cy + 4);
    g.fillStyle = '#fff'; g.font = `600 24px Arial, Helvetica, sans-serif`; g.fillText('@NASA', cx, cy + 38);
    // astronaut floating at the upper left
    g.save(); g.translate(cx - 82, cy - 52); g.rotate(-0.25);
    g.fillStyle = '#f4f4f4'; g.strokeStyle = '#222'; g.lineWidth = 2;
    const blob = (x, y, ww, hh) => { g.beginPath(); g.ellipse(x, y, ww, hh, 0, 0, Math.PI * 2); g.fill(); g.stroke(); };
    blob(-14, 4, 7, 14); blob(16, -2, 7, 13); blob(-6, 26, 7, 14); blob(8, 28, 7, 14);
    blob(0, 8, 15, 18); blob(0, -16, 14, 13);
    g.fillStyle = '#1b1f2a'; g.beginPath(); g.ellipse(2, -16, 9, 7, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#9aa'; g.fillRect(-5, 4, 10, 7);
    g.restore();
    // satellite at the upper right
    g.save(); g.translate(cx + 82, cy - 70); g.rotate(0.7);
    g.fillStyle = '#222'; g.fillRect(-22, -4, 14, 8); g.fillRect(8, -4, 14, 8);
    g.fillStyle = '#ddd'; g.fillRect(-7, -7, 14, 14); g.strokeStyle = '#222'; g.strokeRect(-7, -7, 14, 14);
    g.restore();
    collar(g, w);
  }
  const T = {}; // textures
  function buildTextures() {
    T.wall = tex(256, 256, (g, w, h) => {
      fillNoise(g, w, h, [116, 112, 104], 22);
      stains(g, w, h, 14, '40,36,30', 60, 0.18);
      stains(g, w, h, 6, '90,70,40', 40, 0.12);
      g.fillStyle = 'rgba(30,28,25,.55)';
      g.fillRect(0, 0, 3, h); g.fillRect(0, 84, w, 2); g.fillRect(0, 168, w, 2);
      g.fillStyle = 'rgba(40,110,80,.55)'; g.fillRect(0, 120, w, 10); // painted utility band
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(0, 130, w, 2);
      stripes(g, 0, 230, w, 26, 32, '#e8b800', '#141414');
    }, true);
    T.floor = tex(256, 256, (g, w, h) => {
      fillNoise(g, w, h, [74, 73, 70], 24);
      stains(g, w, h, 10, '20,20,20', 50, 0.25);
      g.fillStyle = 'rgba(15,15,15,.7)'; g.fillRect(0, 0, w, 3); g.fillRect(0, 0, 3, h);
    }, true);
    T.ceil = tex(128, 128, (g, w, h) => { fillNoise(g, w, h, [52, 52, 54], 18); stains(g, w, h, 6, '10,10,10', 30, 0.3); }, true);
    T.tarmac = tex(256, 256, (g, w, h) => {
      fillNoise(g, w, h, [60, 62, 64], 30);
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(200,200,200,${rand(0.05, 0.2)})`; g.fillRect(rand(0, w), rand(0, h), 1.5, 1.5); }
      stains(g, w, h, 5, '20,20,20', 70, 0.15);
      g.fillStyle = 'rgba(20,20,20,.5)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
    }, true);
    T.metal = tex(256, 256, (g, w, h) => {
      fillNoise(g, w, h, [176, 182, 176], 10);
      for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(60,70,65,.55)'; g.fillRect(x, 0, 2, h); g.fillStyle = 'rgba(255,255,255,.25)'; g.fillRect(x + 2, 0, 1, h); }
      g.fillStyle = 'rgba(60,70,65,.4)'; g.fillRect(0, 0, w, 2);
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(90,95,85,${rand(0.03, 0.1)})`; g.fillRect(rand(0, w), 0, rand(2, 10), h); }
    }, true);
    T.metal.repeat.set(1 / 10, 1 / 10);
    T.metal2 = T.metal.clone(); T.metal2.needsUpdate = true; T.metal2.repeat.set(1 / 6, 1 / 6);
    // Hangar One siding, all light (no dark roof): u across the arch, v along the length (16 m per tile)
    const rows = [0.13, 0.27, 0.41], sky = [0.6, 0.68];
    T.hangarSkin = tex(1024, 128, (g, w, h) => {
      fillNoise(g, w, h, [226, 228, 224], 8);
      for (let y = 0; y < h; y += 8) { g.fillStyle = 'rgba(120,125,122,.25)'; g.fillRect(0, y, w, 1); }
      for (const s of rows) for (const u of [s / 2, 1 - s / 2]) for (const y of [20, 84]) { g.fillStyle = '#4a5560'; g.fillRect(u * w - 6, y, 12, 18); g.fillStyle = 'rgba(160,190,210,.5)'; g.fillRect(u * w - 6, y, 12, 4); }
      for (const u of [sky[0] / 2, 1 - sky[0] / 2, sky[1] / 2, 1 - sky[1] / 2]) { g.fillStyle = '#c4ced4'; g.fillRect(u * w - 14, 30, 28, 56); g.fillStyle = 'rgba(255,255,255,.5)'; g.fillRect(u * w - 14, 30, 28, 3); }
      g.fillStyle = 'rgba(90,95,92,.35)'; g.fillRect(w / 2 - 4, 0, 8, h);
      g.fillStyle = 'rgba(70,72,70,.5)'; g.fillRect(0, 0, 4, h); g.fillRect(w - 4, 0, 4, h);
    }, true);
    T.hangarDoor = tex(512, 512, (g, w, h) => {
      fillNoise(g, w, h, [228, 230, 226], 8);
      for (let x = 0; x < w; x += 16) { g.fillStyle = 'rgba(120,125,122,.25)'; g.fillRect(x, 0, 1, h); }
      for (const s of rows) { const y = (1 - s) * h; for (let x = 24; x < w; x += 64) { g.fillStyle = '#4a5560'; g.fillRect(x, y - 10, 22, 18); g.fillStyle = 'rgba(160,190,210,.5)'; g.fillRect(x, y - 10, 22, 4); } }
      g.fillStyle = 'rgba(70,72,70,.5)'; g.fillRect(0, h - 6, w, 6);
    });
    T.concrete = tex(256, 256, (g, w, h) => {
      fillNoise(g, w, h, [150, 149, 143], 14);
      stains(g, w, h, 6, '120,115,105', 60, 0.15);
      g.fillStyle = 'rgba(90,88,84,.5)'; g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
    }, true);
    T.windows = tex(256, 256, (g, w, h) => {
      fillNoise(g, w, h, [222, 208, 178], 12);
      for (let y = 20; y < h; y += 64) for (let x = 12; x < w; x += 42) { g.fillStyle = '#26323b'; g.fillRect(x, y, 26, 30); g.fillStyle = 'rgba(160,200,230,.25)'; g.fillRect(x, y, 26, 8); }
    }, true);
    T.louver = tex(256, 128, (g, w, h) => {
      g.fillStyle = '#8a8e8c'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) { g.fillStyle = '#2b3033'; g.fillRect(x + 2, y + 2, 12, 12); }
    }, true);
    T.plaid = tex(128, 128, (g, w, h) => {
      g.fillStyle = '#b3262b'; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(30,10,10,.55)';
      for (let i = 0; i < w; i += 32) { g.fillRect(i, 0, 12, h); g.fillRect(0, i, w, 12); }
      g.fillStyle = 'rgba(255,230,200,.35)';
      for (let i = 20; i < w; i += 32) { g.fillRect(i, 0, 2, h); g.fillRect(0, i, w, 2); }
    }, true);
    T.plaid.repeat.set(2, 2);
    T.waspBody = tex(64, 64, (g, w, h) => {
      for (let y = 0; y < h; y += 8) { g.fillStyle = (y / 8) % 2 ? '#1a1408' : '#f2c21b'; g.fillRect(0, y, w, 8); }
      g.fillStyle = '#1a1408'; g.fillRect(0, 0, w, 10); // head end
    });
    T.stripeHazard = tex(256, 64, (g, w, h) => stripes(g, 0, 0, w, h, 32, '#f5c400', '#151515'), true);
    T.barricade = tex(256, 64, (g, w, h) => stripes(g, 0, 0, w, h, 64, '#f4f1ea', '#ef6a12'), true);
    T.glow = tex(128, 128, (g, w) => {
      const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, w);
    });
    T.cloud = tex(128, 128, (g, w) => {
      for (let i = 0; i < 18; i++) {
        const x = rand(30, 98), y = rand(30, 98), r = rand(16, 34);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(0, 0, w, w);
      }
    });
    T.sky = tex(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#3f6fae'); gr.addColorStop(0.42, '#86aed4'); gr.addColorStop(0.5, '#e8d7bc'); gr.addColorStop(0.56, '#b9b8ae'); gr.addColorStop(1, '#6d6a62');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    T.nest = tex(128, 128, (g, w, h) => {
      fillNoise(g, w, h, [150, 140, 120], 30);
      g.strokeStyle = 'rgba(80,70,55,.6)'; g.lineWidth = 2;
      for (let y = 4; y < h; y += 7) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, y + Math.sin(x * 0.2 + y) * 3); g.stroke(); }
    }, true);
    T.pinCanvas = makeCanvas(512, 512, drawAmesPin);
    T.pin = new THREE.CanvasTexture(T.pinCanvas);
    T.pin.anisotropy = MAXANISO;
    T.shirtBack = tex(256, 296, drawShirtBack);
    T.shirtFront = tex(256, 296, (g, w, h) => { heather(g, w, h); collar(g, w); drawInsignia(g, w * 0.72, h * 0.24, 22); });
    T.shirt = tex(64, 64, (g, w, h) => heather(g, w, h));
    T.cabinet = tex(256, 320, (g, w, h) => {
      fillNoise(g, w, h, [128, 134, 130], 10);
      g.strokeStyle = 'rgba(30,30,30,.7)'; g.lineWidth = 4; g.strokeRect(10, 10, w - 20, h - 20); g.beginPath(); g.moveTo(w / 2, 10); g.lineTo(w / 2, h - 10); g.stroke();
      for (let y = 230; y < 300; y += 10) { g.fillStyle = '#2a2d2c'; g.fillRect(30, y, 70, 4); g.fillRect(w - 100, y, 70, 4); }
      g.fillStyle = '#fff'; g.fillRect(48, 40, 160, 150);
      g.fillStyle = '#d4161c'; g.fillRect(48, 40, 160, 38);
      g.fillStyle = '#fff'; g.font = `700 30px ${F_BODY}`; g.textAlign = 'center'; g.fillText('DANGER', 128, 71);
      bolt(g, 128, 132, 46, '#111');
      g.fillStyle = '#111'; g.font = `700 20px ${F_BODY}`; g.fillText('13.8 kV', 128, 182);
      g.fillStyle = '#f5c400'; g.beginPath(); g.arc(w - 40, 35, 9, 0, 7); g.fill();
    });
  }
  function bolt(g, cx, cy, s, color) {
    g.fillStyle = color; g.beginPath();
    g.moveTo(cx + s * 0.15, cy - s); g.lineTo(cx - s * 0.45, cy + s * 0.1); g.lineTo(cx - s * 0.02, cy + s * 0.1);
    g.lineTo(cx - s * 0.2, cy + s); g.lineTo(cx + s * 0.45, cy - s * 0.15); g.lineTo(cx + s * 0.02, cy - s * 0.15); g.closePath(); g.fill();
  }
  function signTex(kind) {
    return tex(512, 384, (g, w, h) => {
      const cfg = {
        hv: { band: '#d4161c', bandText: '#fff', word: 'DANGER', lines: ['HIGH VOLTAGE', 'KEEP OUT'] },
        gas: { band: '#f5c400', bandText: '#111', word: 'CAUTION', lines: ['TOXIC GAS', 'NO ENTRY WITHOUT SCBA'] },
        wasp: { band: '#ef6a12', bandText: '#111', word: 'WARNING', lines: ['STINGING INSECTS', 'NEST ACTIVE'] }
      }[kind];
      g.fillStyle = '#f4f1ea'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#111'; g.fillRect(0, 0, w, 120);
      g.fillStyle = cfg.band; g.fillRect(14, 14, w - 28, 92);
      g.fillStyle = cfg.bandText; g.font = `700 78px ${F_BODY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(cfg.word, w / 2, 62);
      if (kind === 'hv') bolt(g, 86, 250, 80, '#111');
      if (kind === 'gas') { g.fillStyle = '#111'; g.beginPath(); g.arc(86, 235, 52, 0, 7); g.fill(); g.fillRect(58, 270, 56, 36); g.fillStyle = '#f4f1ea'; g.beginPath(); g.arc(66, 232, 14, 0, 7); g.arc(106, 232, 14, 0, 7); g.fill(); }
      if (kind === 'wasp') { g.fillStyle = '#111'; g.beginPath(); g.ellipse(86, 250, 26, 58, 0, 0, 7); g.fill(); g.fillStyle = '#f5c400'; g.fillRect(60, 238, 52, 12); g.fillRect(60, 266, 52, 12); g.fillStyle = 'rgba(0,0,0,.5)'; g.beginPath(); g.ellipse(46, 214, 34, 14, -0.5, 0, 7); g.ellipse(126, 214, 34, 14, 0.5, 0, 7); g.fill(); }
      g.fillStyle = '#111'; g.textAlign = 'left';
      g.font = `700 60px ${F_BODY}`; g.fillText(cfg.lines[0], 160, 220);
      g.font = `600 34px ${F_BODY}`; g.fillText(cfg.lines[1], 160, 290);
    });
  }
  function stencilTex(text, color, size) {
    return tex(512, 128, (g, w, h) => {
      g.fillStyle = color || 'rgba(236,230,214,.8)';
      g.font = `${size || 64}px ${F_DISPLAY}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(text, w / 2, h / 2 + 4);
    });
  }
  function arrowTex(dir) {
    return tex(512, 256, (g, w, h) => {
      g.fillStyle = '#111'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#f5c400'; g.lineWidth = 10; g.strokeRect(8, 8, w - 16, h - 16);
      g.save(); g.translate(w / 2, h / 2 - 14); if (dir < 0) g.scale(-1, 1);
      g.fillStyle = '#f5c400';
      for (let i = -1; i <= 1; i++) {
        const x = i * 110;
        g.beginPath(); g.moveTo(x - 40, -70); g.lineTo(x + 10, -70); g.lineTo(x + 70, 0); g.lineTo(x + 10, 70); g.lineTo(x - 40, 70); g.lineTo(x + 20, 0); g.closePath(); g.fill();
      }
      g.restore();
      g.fillStyle = '#f5c400'; g.font = `600 30px ${F_BODY}`; g.textAlign = 'center';
      g.fillText(dir < 0 ? 'TUNNEL CONTINUES LEFT' : 'TUNNEL CONTINUES RIGHT', w / 2, h - 30);
    });
  }

  // ---------- materials + shared geometry
  const M = {}, G = {};
  function phong(color, extra) { return new THREE.MeshPhongMaterial(Object.assign({ color, shininess: 12 }, extra || {})); }
  function buildMaterials() {
    M.floor = phong(0xffffff, { map: T.floor, shininess: 30, specular: 0x222222 });
    M.wall = phong(0xffffff, { map: T.wall });
    M.ceil = phong(0xffffff, { map: T.ceil });
    M.beam = phong(0x3b3f44, { shininess: 40 });
    M.fixture = new THREE.MeshBasicMaterial({ color: 0xffe2a8 });
    M.redLamp = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
    M.pipeGreen = phong(0x3f7a5a, { shininess: 50 });
    M.pipeRust = phong(0x8a4b2a, { shininess: 20 });
    M.pipeGrey = phong(0x9aa3a8, { shininess: 60 });
    M.tray = phong(0x5a5e60);
    M.cable = phong(0x141414, { shininess: 80, specular: 0x555555 });
    M.hazard = phong(0xffffff, { map: T.stripeHazard });
    M.cabinetFront = phong(0xffffff, { map: T.cabinet });
    M.cabinetSide = phong(0x7f8682);
    M.ceramic = phong(0xc9b79a, { shininess: 90 });
    M.copper = phong(0xc77b3a, { shininess: 90, emissive: 0x220a00 });
    M.barrel = phong(0xe0b21a, { shininess: 50 });
    M.barrelBand = phong(0x222222);
    M.puddle = new THREE.MeshBasicMaterial({ color: 0x5cff3a, transparent: true, opacity: 0.55, depthWrite: false });
    M.barricade = phong(0xffffff, { map: T.barricade, emissive: 0x221005 });
    M.wood = phong(0x8a6a44);
    M.waspBody = phong(0xffffff, { map: T.waspBody, emissive: 0x2a1c00, shininess: 70 });
    M.wing = new THREE.MeshBasicMaterial({ color: 0xe6f0ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false });
    M.nest = phong(0xffffff, { map: T.nest });
    M.pinFace = new THREE.MeshBasicMaterial({ map: T.pin, side: THREE.DoubleSide, alphaTest: 0.5 });
    const add = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    M.arcOuter = add(0x4f9cff, 0.75);
    M.arcCore = add(0xf2f8ff, 1);
    const spr = (color, opacity) => new THREE.SpriteMaterial({ map: T.glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    M.glowBlue = spr(0x5aa8ff, 0.9);
    M.glowWarm = spr(0xffc070, 0.22);
    M.glowAmber = spr(0xffa000, 0.9);
    M.glowGreen = spr(0x6dff4a, 0.35);
    M.gas = [0, 1, 2].map(i => new THREE.SpriteMaterial({ map: T.cloud, color: [0x7dff4a, 0x9bff6a, 0x5fe03a][i], transparent: true, opacity: 0.62, depthWrite: false }));
    M.signs = { hv: signTex('hv'), gas: signTex('gas'), wasp: signTex('wasp') };
    for (const k in M.signs) M.signs[k] = new THREE.MeshPhongMaterial({ map: M.signs[k], emissive: 0x222222, shininess: 5 });
    M.arrow = { '-1': new THREE.MeshBasicMaterial({ map: arrowTex(-1) }), '1': new THREE.MeshBasicMaterial({ map: arrowTex(1) }) };
    const stencils = ['HANGAR 1 · SUBLEVEL B', 'UTILITY TUNNEL 4', 'N-211 ⟶', 'MOFFETT FIELD 1933', 'NO SMOKING', 'PUMP ROOM ⟶', 'USS MACON STORES', 'AUTHORIZED PERSONNEL ONLY', 'KEEP MOVING', 'AMES · BLDG 1'];
    M.stencils = stencils.map(s => new THREE.MeshBasicMaterial({ map: stencilTex(s, 'rgba(236,230,214,.75)', s.length > 18 ? 46 : 64), transparent: true, depthWrite: false }));

    G.box = new THREE.BoxGeometry(1, 1, 1);
    G.cyl = new THREE.CylinderGeometry(1, 1, 1, 14);
    G.pipe = new THREE.CylinderGeometry(1, 1, 1, 10, 1, true);
    G.sphere = new THREE.SphereGeometry(1, 16, 12);
    G.beam = new THREE.BoxGeometry(W, 0.35, 0.4);
    G.fixture = new THREE.BoxGeometry(1.5, 0.12, 0.5);
    G.lamp = new THREE.BoxGeometry(0.18, 0.3, 0.18);
    G.barrel = new THREE.CylinderGeometry(0.45, 0.45, 1.15, 16);
    G.band = new THREE.CylinderGeometry(0.47, 0.47, 0.08, 16);
    G.puddle = new THREE.CircleGeometry(1.2, 20);
    G.pin = new THREE.PlaneGeometry(1.0, 1.0);
    G.sign = new THREE.PlaneGeometry(1.6, 1.2);
    G.stencil = new THREE.PlaneGeometry(3.6, 0.9);
    G.arrow = new THREE.PlaneGeometry(4.2, 2.1);
    G.waspBody = new THREE.SphereGeometry(0.16, 10, 8);
    G.waspBody.scale(1, 1.7, 1); G.waspBody.rotateX(Math.PI / 2);
    G.wing = new THREE.PlaneGeometry(0.3, 0.12); G.wing.rotateX(-Math.PI / 2); G.wing.translate(0.15, 0, 0);
  }

  // ---------- electric arc ribbon
  class Arc {
    constructor(a, b, n, width, mat, amp) {
      this.a = a; this.b = b; this.n = n; this.w = width; this.amp = amp;
      this.pos = new Float32Array((n + 1) * 6);
      this.geo = new THREE.BufferGeometry();
      this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
      const idx = [];
      for (let i = 0; i < n; i++) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      this.geo.setIndex(idx);
      this.mesh = new THREE.Mesh(this.geo, mat);
      this.mesh.frustumCulled = false;
      this.update();
    }
    update() {
      const { a, b, n, w, amp, pos } = this;
      let off = 0, offz = 0;
      for (let k = 0; k <= n; k++) {
        const t = k / n, env = Math.sin(Math.PI * t);
        off = off * 0.4 + (Math.random() - 0.5) * 2 * amp;
        offz = offz * 0.4 + (Math.random() - 0.5) * amp;
        const x = lerp(a.x, b.x, t), y = lerp(a.y, b.y, t) + off * env, z = lerp(a.z, b.z, t) + offz * env;
        const i = k * 6;
        pos[i] = x; pos[i + 1] = y - w / 2; pos[i + 2] = z;
        pos[i + 3] = x; pos[i + 4] = y + w / 2; pos[i + 5] = z;
      }
      this.geo.attributes.position.needsUpdate = true;
      this.mesh.visible = Math.random() > 0.12;
    }
  }

  // ---------- wasp swarm (instanced)
  function makeSwarm(g, count, spread) {
    const bodies = new THREE.InstancedMesh(G.waspBody, M.waspBody, count);
    const wings = new THREE.InstancedMesh(G.wing, M.wing, count * 2);
    bodies.frustumCulled = wings.frustumCulled = false;
    g.add(bodies, wings);
    const ws = [];
    for (let i = 0; i < count; i++) {
      ws.push({ ox: rand(spread.x[0], spread.x[1]), oy: rand(spread.y[0], spread.y[1]), oz: rand(spread.z[0], spread.z[1]),
        r: rand(0.2, 0.55), f1: rand(2, 4.5) * (Math.random() < 0.5 ? -1 : 1), f2: rand(2, 5), ph: rand(0, 6.28) });
    }
    const dB = new THREE.Object3D(), dW = new THREE.Object3D(), m = new THREE.Matrix4();
    const sw = {
      cx: 0, bodies, wings,
      update(t) {
        for (let i = 0; i < ws.length; i++) {
          const w = ws[i], a = t * w.f1 + w.ph, s = Math.sign(w.f1);
          dB.position.set(sw.cx + w.ox + Math.cos(a) * w.r, w.oy + Math.sin(t * w.f2 + w.ph) * 0.22, w.oz + Math.sin(a) * w.r);
          dB.rotation.set(0, Math.atan2(Math.sin(a) * s, -Math.cos(a) * s), 0);
          dB.updateMatrix();
          bodies.setMatrixAt(i, dB.matrix);
          const flap = Math.sin(t * 70 + i) * 0.7;
          for (let side = 0; side < 2; side++) {
            dW.position.set(0, 0.1, 0.02);
            dW.rotation.set(0, side ? Math.PI : 0, 0.25 + flap);
            dW.updateMatrix();
            m.multiplyMatrices(dB.matrix, dW.matrix);
            wings.setMatrixAt(i * 2 + side, m);
          }
        }
        bodies.instanceMatrix.needsUpdate = true;
        wings.instanceMatrix.needsUpdate = true;
      },
      dispose() { if (bodies.dispose) bodies.dispose(); if (wings.dispose) wings.dispose(); }
    };
    sw.update(0);
    return sw;
  }

  // ---------- characters
  function makeHuman(o) {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const mk = (geo, mat, x, y, z, sx, sy, sz, parent) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); (parent || body).add(m); return m;
    };
    const torso = mk(G.box, o.torsoMats, 0, 1.36, 0, 0.64, 0.74, 0.36);
    const headG = new THREE.Group(); headG.position.set(0, 1.94, 0); body.add(headG);
    mk(G.sphere, o.skin, 0, 0, 0, 0.21, 0.23, 0.21, headG);
    const limb = (x, y, legs) => {
      const pivot = new THREE.Group(); pivot.position.set(x, y, 0); body.add(pivot);
      if (legs) {
        mk(G.box, o.pants, 0, -0.45, 0, 0.25, 0.9, 0.27, pivot);
        mk(G.box, o.shoe, 0, -0.9, -0.06, 0.27, 0.14, 0.4, pivot);
      } else {
        if (o.short) {
          mk(G.box, o.sleeve, 0, -0.14, 0, 0.21, 0.3, 0.23, pivot);
          mk(G.box, o.skin, 0, -0.44, 0, 0.14, 0.46, 0.15, pivot);
        } else mk(G.box, o.sleeve, 0, -0.32, 0, 0.18, 0.66, 0.2, pivot);
        mk(G.sphere, o.skin, 0, -0.7, 0, 0.09, 0.09, 0.09, pivot);
      }
      return pivot;
    };
    const legL = limb(-0.16, 0.95, true), legR = limb(0.16, 0.95, true);
    const armL = limb(-0.42, 1.68, false), armR = limb(0.42, 1.68, false);
    const rest = [headG, legL, legR, armL, armR].map(o => [o, o.position.clone()]);
    return { root, body, torso, headG, legL, legR, armL, armR, rest, phase: Math.random() * 6 };
  }
  function makeRunner() {
    const tee = phong(0xffffff, { map: T.shirt, shininess: 4 }), skin = phong(0xd9a37c);
    const torso = [tee, tee, tee, tee, phong(0xffffff, { map: T.shirtBack, shininess: 4 }), phong(0xffffff, { map: T.shirtFront, shininess: 4 })];
    const h = makeHuman({ torsoMats: torso, skin, pants: phong(0x2c3550), sleeve: tee, shoe: phong(0xf2f2f2), short: true });
    const hair = new THREE.Mesh(G.sphere, phong(0x2a1c14)); hair.scale.set(0.225, 0.17, 0.225); hair.position.set(0, 0.07, 0.02); h.headG.add(hair);
    const badge = new THREE.Mesh(G.box, phong(0xffffff)); badge.scale.set(0.1, 0.14, 0.02); badge.position.set(0.12, 1.42, -0.19); h.body.add(badge);
    return h;
  }
  function makeCowboy() {
    const shirt = phong(0xffffff, { map: T.plaid }), jeans = phong(0x2f4a7a), boots = phong(0x5a3418), skin = phong(0xc98d66);
    const h = makeHuman({ torsoMats: shirt, skin, pants: jeans, sleeve: shirt, shoe: boots });
    h.root.scale.setScalar(1.12);
    const hatMat = phong(0xa8743a, { shininess: 8 }), bandMat = phong(0x2a1a0e);
    const hat = new THREE.Group(); hat.position.set(0, 0.17, 0); hat.rotation.x = -0.12; h.headG.add(hat);
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.24, 0.32, 20), hatMat); crown.scale.z = 0.88; crown.position.y = 0.16; hat.add(crown);
    const dent = new THREE.Mesh(G.box, bandMat); dent.scale.set(0.02, 0.02, 0.3); dent.position.y = 0.325; hat.add(dent);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.245, 0.245, 0.06, 20), bandMat); band.scale.z = 0.88; band.position.y = 0.03; hat.add(band);
    const brimPts = [[0, 0], [0.24, 0], [0.4, 0.005], [0.52, 0.04], [0.6, 0.13], [0.62, 0.16]].map(p => new THREE.Vector2(p[0], p[1]));
    const brim = new THREE.Mesh(new THREE.LatheGeometry(brimPts, 28), new THREE.MeshPhongMaterial({ color: 0xa8743a, side: THREE.DoubleSide, shininess: 8 }));
    brim.scale.set(1.15, 1, 0.95); hat.add(brim);
    const stache = new THREE.Mesh(G.box, bandMat); stache.scale.set(0.22, 0.05, 0.05); stache.position.set(0, -0.06, -0.2); h.headG.add(stache);
    for (const s of [-1, 1]) { const eye = new THREE.Mesh(G.sphere, bandMat); eye.scale.setScalar(0.025); eye.position.set(s * 0.07, 0.04, -0.19); h.headG.add(eye); }
    const bandana = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 0.12, 12), phong(0xd02a1e)); bandana.position.set(0, 1.76, 0); h.body.add(bandana);
    const belt = new THREE.Mesh(G.box, bandMat); belt.scale.set(0.66, 0.08, 0.38); belt.position.set(0, 1.0, 0); h.body.add(belt);
    const buckle = new THREE.Mesh(G.box, phong(0xd6c26a, { shininess: 100 })); buckle.scale.set(0.16, 0.1, 0.03); buckle.position.set(0, 1.0, -0.2); h.body.add(buckle);
    const rope = phong(0xc9a86a);
    const coil = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.025, 6, 18), rope); coil.position.set(0.36, 1.0, 0); coil.rotation.y = Math.PI / 2; h.body.add(coil);
    const lasso = new THREE.Group(); lasso.position.set(0.3, 2.75, 0); h.body.add(lasso);
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.7, 0.025, 6, 32), rope); loop.rotation.x = Math.PI / 2; lasso.add(loop);
    h.lasso = lasso;
    return h;
  }
  function animateRun(h, dt, rate, pose) {
    h.phase += dt * rate;
    const s = Math.sin(h.phase);
    let lean = -0.14, by = Math.abs(Math.cos(h.phase)) * 0.07, legA = s * 0.95, armA = s * 0.8;
    if (pose === 'jump') { legA = 0; by = 0; lean = -0.05; }
    if (pose === 'idle') { legA = 0; armA = Math.sin(h.phase * 0.3) * 0.05; by = 0; lean = 0; }
    const tgt = pose === 'slide' ? 1.15 : lean;
    h.body.rotation.x = lerp(h.body.rotation.x, tgt, damp(18, dt));
    h.body.position.y = lerp(h.body.position.y, pose === 'slide' ? -0.62 : by, damp(18, dt));
    if (pose === 'slide') { h.legL.rotation.x = 0.25; h.legR.rotation.x = 0.05; h.armL.rotation.x = 2.4; h.armR.rotation.x = 2.2; return; }
    if (pose === 'jump') { h.legL.rotation.x = 0.7; h.legR.rotation.x = -0.4; h.armL.rotation.x = 2.6; h.armR.rotation.x = 2.4; return; }
    h.legL.rotation.x = legA; h.legR.rotation.x = -legA; h.armL.rotation.x = -armA; h.armR.rotation.x = armA;
  }

  // ---------- scene: lights, sky, outdoor
  let hemi, sun, playerLight;
  const hazLights = [];
  let outdoor, sky;
  function buildLights() {
    hemi = new THREE.HemisphereLight(0xdfeaff, 0x4a4234, 1.0); scene.add(hemi);
    sun = new THREE.DirectionalLight(0xfff0d0, 0.9); sun.position.set(-200, 300, 150); scene.add(sun);
    playerLight = new THREE.PointLight(0xffd9a0, 0, 30, 1.4); scene.add(playerLight);
    for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0x7cc4ff, 0, 22, 1.6); scene.add(l); hazLights.push(l); }
    scene.fog = new THREE.Fog(0xcfd9e0, 80, 1500);
    scene.background = new THREE.Color(0xcfd9e0);
  }
  // Hangar One cross-section: steep sides that round over the top. Sampled evenly by arc length,
  // base -> apex, as (radius, height) pairs so the same profile drives the body and the domed ends.
  function halfProfile(hw, hh, n, pw) {
    const dense = [];
    for (let i = 0; i <= 400; i++) { const x = hw * (1 - i / 400); dense.push([x, hh * (1 - Math.pow(x / hw, pw || 2.4))]); }
    const cum = [0];
    for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
    const total = cum[cum.length - 1], out = [];
    let j = 0;
    for (let k = 0; k <= n; k++) {
      const sk = total * k / n;
      while (j < dense.length - 2 && cum[j + 1] < sk) j++;
      const t = clamp((sk - cum[j]) / ((cum[j + 1] - cum[j]) || 1), 0, 1);
      out.push(new THREE.Vector2(lerp(dense[j][0], dense[j + 1][0], t), lerp(dense[j][1], dense[j + 1][1], t)));
    }
    out[n].x = 0.0001;
    return out;
  }
  // straight arched body from z=0 to z=-len; u runs across the arch, v along the length
  function archBody(half, len, vTile) {
    const N = half.length - 1, across = [];
    for (let k = 0; k <= N; k++) across.push([-half[k].x, half[k].y]);
    for (let k = N - 1; k >= 0; k--) across.push([half[k].x, half[k].y]);
    const cols = across.length, pos = [], uv = [], idx = [];
    for (let j = 0; j < 2; j++) for (let i = 0; i < cols; i++) { pos.push(across[i][0], across[i][1], -j * len); uv.push(i / (cols - 1), j * len / vTile); }
    for (let i = 0; i < cols - 1; i++) { const a = i, b = i + 1, c = cols + i, d = cols + i + 1; idx.push(a, b, c, b, d, c); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    return geo;
  }
  function addShell(g, geo, outMat, inMat, x, z) {
    const o = new THREE.Mesh(geo, outMat); o.position.set(x, 0, z); g.add(o);
    if (inMat) { const i = new THREE.Mesh(geo, inMat); i.position.set(x, 0, z); g.add(i); }
    return o;
  }
  function rect(g, mat, x0, x1, z0, z1, y, tile) {
    const w = x1 - x0, d = z0 - z1;
    const geo = new THREE.PlaneGeometry(w, d);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * d / tile);
    const m = new THREE.Mesh(geo, mat); m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); g.add(m); return m;
  }
  const HW = 45, HH = 60, HLEN = 240, HZF = -RAMP_B - HW - 2; // Hangar One, in meters: ~94 wide, 60 tall, 345 long
  function buildHangarOne(g) {
    const half = halfProfile(HW, HH, 48);
    const skin = phong(0xffffff, { map: T.hangarSkin, shininess: 30, specular: 0x2a2a2a });
    const doorSkin = phong(0xffffff, { map: T.hangarDoor, shininess: 30, specular: 0x2a2a2a });
    const inside = new THREE.MeshLambertMaterial({ color: 0x24272a, side: THREE.BackSide });
    addShell(g, archBody(half, HLEN, 16), skin, inside, 0, HZF);
    // "orange peel" ends: quarter domes that rotate around the end to open. The left front leaf is open, like the photo.
    const OPEN = 0.78;
    const leaf = (phi0, phiLen, rotY, z, sc) => {
      const geo = new THREE.LatheGeometry(half, 20, phi0, phiLen);
      for (const m of [doorSkin, inside]) { const l = new THREE.Mesh(geo, m); l.position.set(0, 0, z); l.rotation.y = rotY; l.scale.set(sc, 1.004, sc); g.add(l); }
    };
    leaf(0, Math.PI / 2, 0, HZF, 1);
    leaf(-Math.PI / 2, Math.PI / 2, -OPEN, HZF, 1.012);
    leaf(Math.PI / 2, Math.PI, 0, HZF - HLEN, 1);
    // ridge walkway and the door track at the joint
    const ridgeMat = phong(0xcfd3d2);
    const ridge = new THREE.Mesh(G.box, ridgeMat); ridge.scale.set(3.2, 1.6, HLEN); ridge.position.set(0, HH + 0.6, HZF - HLEN / 2); g.add(ridge);
    const trackPts = half.map(p => new V3(p.x * 1.004, p.y, HZF));
    const trackMat = phong(0xa9aeac);
    for (const sgn of [-1, 1]) g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(trackPts.map(p => new V3(p.x * sgn, p.y, p.z))), 48, 0.5, 5, false), trackMat));
    // dark floor inside
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x2c2e30 });
    rect(g, floorMat, -HW + 0.5, HW - 0.5, HZF, HZF - HLEN, 0.12, 20);
    for (const z of [HZF, HZF - HLEN]) { const c = new THREE.Mesh(new THREE.CircleGeometry(HW - 0.5, 40), floorMat); c.rotation.x = -Math.PI / 2; c.position.set(0, 0.12, z); g.add(c); }
    // the little control tower beside the hangar
    const tw = new THREE.Group(); tw.position.set(HW + 18, 0, HZF + 4); g.add(tw);
    const beige = phong(0xe2d6bd);
    addMesh(tw, G.cyl, beige, 0, 7, 0, 2.6, 14, 2.6);
    addMesh(tw, G.cyl, phong(0x33414a, { shininess: 90 }), 0, 15.2, 0, 3.4, 2.4, 3.4);
    addMesh(tw, G.cyl, beige, 0, 16.7, 0, 3.8, 0.6, 3.8);
    addMesh(tw, G.box, phong(0xece6d6), 6, 3, 2, 8, 6, 16);
  }
  function makeP3() {
    const p = new THREE.Group();
    const white = phong(0xf2f3f1, { shininess: 50 }), grey = phong(0x9ba3a8), dark = phong(0x1e2328, { shininess: 90 });
    const propMat = new THREE.MeshBasicMaterial({ color: 0x30343a, transparent: true, opacity: 0.45, depthWrite: false });
    const fus = addMesh(p, G.cyl, white, 0, 2.6, 0, 1.7, 26, 1.7); fus.rotation.x = Math.PI / 2;
    const nose = addMesh(p, G.sphere, white, 0, 2.6, -13, 1.7, 1.7, 3.4);
    const cock = addMesh(p, G.box, dark, 0, 3.4, -13.6, 2.2, 0.6, 1.6); cock.rotation.x = 0.4;
    const tail = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 0.45, 8, 14), white); tail.rotation.x = -Math.PI / 2; tail.position.set(0, 2.9, 17); p.add(tail);
    const mad = addMesh(p, G.cyl, grey, 0, 3.1, 23, 0.25, 4, 0.25); mad.rotation.x = Math.PI / 2;
    addMesh(p, G.box, white, 0, 2.2, -2, 30, 0.45, 4.2);
    for (const x of [-9.5, -4.6, 4.6, 9.5]) {
      const n = addMesh(p, G.cyl, white, x, 2.2, -3.6, 0.65, 5.5, 0.65); n.rotation.x = Math.PI / 2;
      const prop = addMesh(p, G.cyl, propMat, x, 2.2, -6.5, 1.8, 0.06, 1.8); prop.rotation.x = Math.PI / 2;
    }
    const fin = addMesh(p, G.box, white, 0, 6.6, 18.4, 0.35, 6.2, 5); fin.rotation.x = -0.35;
    addMesh(p, G.box, white, 0, 3.6, 19.5, 12.5, 0.3, 3);
    for (const [x, z] of [[-4.6, -1.5], [4.6, -1.5], [0, -10]]) addMesh(p, G.box, dark, x, 0.6, z, 0.4, 1.2, 0.6);
    return p;
  }
  function buildAirfield(g) {
    // concrete apron all around and behind the hangar, with runways and P-3s beyond
    const conc = phong(0xffffff, { map: T.concrete });
    rect(g, conc, -140, 520, -56, -1400, 0.05, 16);
    const asphalt = phong(0xffffff, { map: T.tarmac });
    const white = new THREE.MeshBasicMaterial({ color: 0xe9e9e4 }), yel = new THREE.MeshBasicMaterial({ color: 0xe0b100 });
    for (const rx of [250, 340]) {
      rect(g, asphalt, rx - 23, rx + 23, -120, -2600, 0.1, 14);
      for (let z = -150; z > -2600; z -= 40) { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 18), white); d.rotation.x = -Math.PI / 2; d.position.set(rx, 0.16, z); g.add(d); }
      for (const sx of [-21, 21]) { const e = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2480), white); e.rotation.x = -Math.PI / 2; e.position.set(rx + sx, 0.16, -1360); g.add(e); }
    }
    for (const [x0, x1, z] of [[60, 227, -450], [60, 227, -800]]) { // taxiways
      rect(g, asphalt, x0, x1, z + 11, z - 11, 0.1, 14);
      const c = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 0.5), yel); c.rotation.x = -Math.PI / 2; c.position.set((x0 + x1) / 2, 0.16, z); g.add(c);
    }
    const planes = [[95, -150, 0.3], [130, -205, 0.3], [70, -420, Math.PI / 2], [0, -470, Math.PI * 0.95], [150, -330, 0.3], [-70, -440, -Math.PI / 2]];
    for (const [x, z, r] of planes) { const p = makeP3(); p.position.set(x, 0, z); p.rotation.y = r; g.add(p); }
    const tugMat = phong(0xe8b400);
    for (let i = 0; i < 9; i++) addMesh(g, G.box, tugMat, 30 + i * 6.5, 0.6, -420 + (i % 3) * 3, 2.4, 1.2, 3.6);
    // Hangars 2 and 3 across the field
    const h2 = halfProfile(26, 34, 32, 2.0), mat2 = phong(0xa4a9a7, { map: T.metal2 }), in2 = new THREE.MeshLambertMaterial({ color: 0x2a2c2e, side: THREE.BackSide });
    for (const x of [470, 545]) {
      addShell(g, archBody(h2, 300, 12), mat2, in2, x, -380);
      for (const z of [-380, -680]) { const f = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(h2.map(p => new THREE.Vector2(p.x, p.y)).concat(h2.slice().reverse().map(p => new THREE.Vector2(-p.x, p.y))))), mat2); f.position.set(x, 0, z); g.add(f); }
    }
  }
  function buildCampus(g) {
    // NASA Ames side: parking lots, beige buildings, trees, the pressure spheres, the 80x120 wind tunnel
    const carGeo = new THREE.BoxGeometry(1.9, 1.4, 4.4);
    const lots = [[-58, -14, 40, -40], [18, 60, 40, -34], [-60, -20, 120, 60]];
    let n = 0; const cars = new THREE.InstancedMesh(carGeo, phong(0xffffff, { shininess: 70 }), 360);
    const dm = new THREE.Object3D(), palette = [0xb8bcc0, 0x2b2f36, 0xf0f0ee, 0x8f1d1d, 0x24467a, 0x5d6b73, 0xc9b38a, 0x9a2b2b, 0x3c5a3e];
    for (const [x0, x1, z0, z1] of lots) {
      for (let x = x0; x <= x1; x += 6.5) for (let z = z0; z >= z1; z -= 2.8) {
        if (Math.random() < 0.25 || n >= 360) continue;
        dm.position.set(x, 0.75, z); dm.rotation.set(0, Math.PI / 2 + rand(-0.06, 0.06), 0); dm.updateMatrix();
        cars.setMatrixAt(n, dm.matrix); cars.setColorAt(n, new THREE.Color(pick(palette))); n++;
      }
    }
    cars.count = n; g.add(cars);
    const beige = phong(0xffffff, { map: T.windows }), flat = phong(0xd9cfb9);
    for (const [x, z, w, h, d] of [[-95, -10, 40, 14, 30], [-140, -90, 60, 18, 34], [-110, 75, 34, 10, 26], [-190, 10, 36, 16, 44], [95, 70, 44, 12, 30], [80, 10, 26, 9, 20], [-75, 140, 50, 12, 24]]) {
      addMesh(g, G.box, [beige, beige, flat, flat, beige, beige], x, h / 2, z, w, h, d);
    }
    // the long arched wind-tunnel building behind the campus
    const h3 = halfProfile(22, 20, 24, 2.0);
    addShell(g, archBody(h3, 150, 12), phong(0xd0d2cf, { map: T.metal2 }), null, -150, -170);
    const sph = phong(0xe8eaea, { shininess: 80, specular: 0x555555 });
    for (let i = 0; i < 3; i++) addMesh(g, G.sphere, sph, -230 - i * 30, 14, -40, 13, 13, 13);
    const dish = new THREE.Mesh(new THREE.SphereGeometry(6, 16, 8, 0, Math.PI * 2, 0, 0.9), new THREE.MeshPhongMaterial({ color: 0xf2f2f2, side: THREE.DoubleSide }));
    dish.position.set(-120, 18, -60); dish.rotation.x = -1.1; g.add(dish);
    const nfac = new THREE.Mesh(G.box, [phong(0x9a9c98), phong(0x9a9c98), phong(0x9a9c98), phong(0x9a9c98), phong(0xffffff, { map: T.louver }), phong(0x9a9c98)]);
    nfac.scale.set(260, 45, 60); nfac.position.set(-360, 22.5, -560); g.add(nfac);
    const trees = new THREE.InstancedMesh(G.sphere, phong(0x3f6b3a), 70);
    for (let i = 0; i < 70; i++) {
      const x = rand(-260, -14) * (Math.random() < 0.25 ? -0.5 : 1), z = rand(-120, 160);
      if (Math.abs(x) < 12) { dm.position.set(-30, -50, 0); } else dm.position.set(x, rand(3, 5), z);
      const s = rand(3, 5.5); dm.scale.set(s, s * 1.1, s); dm.rotation.set(0, 0, 0); dm.updateMatrix(); trees.setMatrixAt(i, dm.matrix);
    }
    g.add(trees);
  }
  function buildOutdoor() {
    const g = new THREE.Group();
    sky = new THREE.Mesh(new THREE.SphereGeometry(2000, 32, 16), new THREE.MeshBasicMaterial({ map: T.sky, side: THREE.BackSide, fog: false, depthWrite: false }));
    scene.add(sky);
    const tar = phong(0xffffff, { map: T.tarmac });
    rect(g, tar, -1500, 1500, 1500, -RAMP_A, 0, 12);
    rect(g, tar, -1500, -W / 2, -RAMP_A, -1500, 0, 12);
    rect(g, tar, W / 2, 1500, -RAMP_A, -1500, 0, 12);
    rect(g, tar, -W / 2, W / 2, -RAMP_B, -1500, 0, 12);
    // taxi lines leading to the trench
    const yellow = new THREE.MeshBasicMaterial({ color: 0xe8b800 });
    for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 100), yellow); l.rotation.x = -Math.PI / 2; l.position.set(s * 6.2, 0.02, 30); g.add(l); }

    buildHangarOne(g);
    // trench walls, rails, headwall
    const wallT = phong(0xffffff, { map: T.wall });
    for (const s of [-1, 1]) {
      const wgeo = new THREE.PlaneGeometry(RAMP_B - RAMP_A, 10);
      const uv = wgeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (RAMP_B - RAMP_A) / 6, uv.getY(i) * 10 / H);
      const wm = new THREE.Mesh(wgeo, wallT); wm.rotation.y = s < 0 ? Math.PI / 2 : -Math.PI / 2; wm.position.set(s * W / 2, -5, -(RAMP_A + RAMP_B) / 2); g.add(wm);
      const rail = new THREE.Mesh(G.box, M.hazard); rail.scale.set(0.12, 0.12, RAMP_B - RAMP_A); rail.position.set(s * (W / 2 + 0.3), 1.05, -(RAMP_A + RAMP_B) / 2); g.add(rail);
      for (let z = RAMP_A; z <= RAMP_B; z += 7) { const p = new THREE.Mesh(G.box, M.beam); p.scale.set(0.1, 1.05, 0.1); p.position.set(s * (W / 2 + 0.3), 0.52, -z); g.add(p); }
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.6, RAMP_B - RAMP_A), M.hazard); edge.rotation.x = -Math.PI / 2; edge.position.set(s * (W / 2 + 0.3), 0.03, -(RAMP_A + RAMP_B) / 2); g.add(edge);
    }
    const slope = Math.atan2(-TY, RAMP_B - RAMP_A), rl = Math.hypot(-TY, RAMP_B - RAMP_A);
    const rgeo = new THREE.PlaneGeometry(W, rl); const ruv = rgeo.attributes.uv; for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i) * W / 4.5, ruv.getY(i) * rl / 4.5);
    const ramp = new THREE.Mesh(rgeo, M.floor); ramp.rotation.x = -Math.PI / 2 - slope; ramp.position.set(0, TY / 2, -(RAMP_A + RAMP_B) / 2); g.add(ramp);
    const head = new THREE.Mesh(new THREE.PlaneGeometry(W, -TY - H), new THREE.MeshBasicMaterial({ map: tex(512, 256, (c, w, h) => {
      c.fillStyle = '#16181b'; c.fillRect(0, 0, w, h); stripes(c, 0, 0, w, 34, 40, '#f5c400', '#16181b'); stripes(c, 0, h - 34, w, 34, 40, '#f5c400', '#16181b');
      c.fillStyle = '#f5c400'; c.font = `52px ${F_DISPLAY}`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('TUNNEL B · UNDER HANGAR 1', w / 2, h / 2 - 22);
      c.font = `600 34px ${F_BODY}`; c.fillStyle = '#ece6d6'; c.fillText('AUTHORIZED PERSONNEL ONLY', w / 2, h / 2 + 40);
    }) }));
    head.position.set(0, (TY + H) / 2, -RAMP_B); g.add(head);
    buildAirfield(g);
    buildCampus(g);
    // distant hills
    const hillMat = phong(0x6e7f7c, { shininess: 0 });
    for (const [x, z, sx, sy] of [[-900, -1300, 500, 160], [-300, -1450, 600, 220], [400, -1400, 520, 180], [1000, -1200, 480, 140], [-1300, -600, 300, 120]]) {
      const hl = new THREE.Mesh(G.sphere, hillMat); hl.scale.set(sx, sy, 160); hl.position.set(x, -20, z); g.add(hl);
    }
    scene.add(g);
    return g;
  }

  // ---------- path segments
  let segs = [];
  function groundY(seg, d) {
    if (seg.index !== 0) return TY;
    if (d <= RAMP_A) return 0;
    if (d >= RAMP_B) return TY;
    return TY * (d - RAMP_A) / (RAMP_B - RAMP_A);
  }
  function segWorld(seg, d, x, y, out) {
    out = out || new V3();
    const D = DIRS[seg.dir], R = RIGHT(seg.dir);
    out.set(seg.start.x + D.x * d + R.x * x, y, seg.start.z + D.z * d + R.z * x);
    return out;
  }
  function speedFor(s) { return Math.min(36, 14 + s * 0.0055); }

  function plane(seg, w, h, mat, us, vs) {
    const geo = new THREE.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / us, uv.getY(i) * h / vs);
    seg.owned.push(geo);
    return new THREE.Mesh(geo, mat);
  }
  function addMesh(parent, geo, mat, x, y, z, sx, sy, sz) {
    const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z);
    if (sx !== undefined) m.scale.set(sx, sy, sz);
    parent.add(m); return m;
  }
  function buildBody(seg, d0, d1) {
    const g = seg.group, len = d1 - d0, zc = -(d0 + d1) / 2;
    if (len <= 0) return;
    const fl = plane(seg, W, len, M.floor, 4.5, 4.5); fl.rotation.x = -Math.PI / 2; fl.position.set(0, TY, zc); g.add(fl);
    const ce = plane(seg, W, len, M.ceil, 4.5, 4.5); ce.rotation.x = Math.PI / 2; ce.position.set(0, TY + H, zc); g.add(ce);
    const wl = plane(seg, len, H, M.wall, 6, H); wl.rotation.y = Math.PI / 2; wl.position.set(-W / 2, TY + H / 2, zc); g.add(wl);
    const wr = plane(seg, len, H, M.wall, 6, H); wr.rotation.y = -Math.PI / 2; wr.position.set(W / 2, TY + H / 2, zc); g.add(wr);
    for (let d = Math.ceil(d0 / 6) * 6; d < d1; d += 6) addMesh(g, G.beam, M.beam, 0, TY + H - 0.18, -d);
    for (let d = Math.ceil(d0 / 12) * 12 + 3; d < d1; d += 12) {
      addMesh(g, G.fixture, M.fixture, 0, TY + H - 0.08, -d);
      const s = new THREE.Sprite(M.glowWarm); s.scale.set(5, 3, 1); s.position.set(0, TY + H - 0.7, -d); g.add(s);
    }
    for (let d = Math.ceil(d0 / 30) * 30 + 15; d < d1; d += 30) {
      const side = (Math.round(d / 30) % 2) ? -1 : 1;
      addMesh(g, G.lamp, M.redLamp, side * (W / 2 - 0.1), TY + 3.1, -d);
    }
    const pipe = (mat, x, y, r) => { const m = addMesh(g, G.pipe, mat, x, y, zc, r, len, r); m.rotation.x = Math.PI / 2; };
    pipe(M.pipeGreen, -W / 2 + 0.35, TY + 4.5, 0.24);
    pipe(M.pipeRust, -W / 2 + 0.28, TY + 5.15, 0.16);
    pipe(M.pipeGrey, W / 2 - 0.4, TY + 4.7, 0.3);
    addMesh(g, G.box, M.tray, W / 2 - 0.25, TY + 3.7, zc, 0.4, 0.08, len);
    addMesh(g, G.box, M.cable, W / 2 - 0.25, TY + 3.8, zc, 0.3, 0.08, len);
    if (len > 20 && Math.random() < 0.85) {
      const side = Math.random() < 0.5 ? -1 : 1;
      const st = new THREE.Mesh(G.stencil, pick(M.stencils));
      st.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      st.position.set(side * (W / 2 - 0.03), TY + 2.4, -rand(d0 + 6, d1 - 6));
      g.add(st);
    }
  }
  function buildJunction(seg) {
    const g = seg.group, L = seg.L;
    const fl = plane(seg, W, W, M.floor, 4.5, 4.5); fl.rotation.x = -Math.PI / 2; fl.position.set(0, TY, -L); g.add(fl);
    const ce = plane(seg, W, W, M.ceil, 4.5, 4.5); ce.rotation.x = Math.PI / 2; ce.position.set(0, TY + H, -L); g.add(ce);
    const fw = plane(seg, W, H, M.wall, 6, H); fw.position.set(0, TY + H / 2, -L - W / 2); g.add(fw);
    const side = -seg.turn; // closed side
    const sw = plane(seg, W, H, M.wall, 6, H); sw.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2; sw.position.set(side * W / 2, TY + H / 2, -L); g.add(sw);
    const ar = new THREE.Mesh(G.arrow, M.arrow[String(seg.turn)]); ar.position.set(0, TY + 3.4, -L - W / 2 + 0.03); g.add(ar);
    const beacon = new THREE.Sprite(M.glowAmber); beacon.scale.set(3, 3, 1); beacon.position.set(0, TY + H - 0.5, -L - W / 2 + 0.3); g.add(beacon);
    addMesh(g, G.lamp, new THREE.MeshBasicMaterial({ color: 0xffa000 }), 0, TY + H - 0.5, -L - W / 2 + 0.1);
    seg.updaters.push(t => { beacon.material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(t * 9)); });
    // pipe stubs bending into the wall so the corner reads as a corner
    addMesh(g, G.beam, M.beam, 0, TY + H - 0.18, -L);
  }
  function wallSign(seg, g, kind, side) {
    const s = new THREE.Mesh(G.sign, M.signs[kind]);
    s.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    s.position.set(side * (W / 2 - 0.04), TY + 2.3, 0.5);
    g.add(s);
  }

  // ---------- obstacles
  const LANES = [-LANE, 0, LANE];
  function obGroup(seg, d) { const g = new THREE.Group(); g.position.set(0, 0, -d); seg.group.add(g); return g; }
  function addArc(seg, g, a, b, n, w, mat, amp) { const arc = new Arc(a, b, n, w, mat, amp); g.add(arc.mesh); seg.owned.push(arc.geo); return arc; }
  const OB = {
    cable(seg, d) {
      const g = obGroup(seg, d);
      addMesh(g, G.box, M.hazard, 0, TY + 0.11, 0, W - 0.1, 0.22, 0.9);
      const c = addMesh(g, G.cyl, M.cable, 0, TY + 0.32, 0, 0.2, W - 0.2, 0.2); c.rotation.z = Math.PI / 2;
      const arcs = [];
      for (let k = 0; k < 3; k++) arcs.push(addArc(seg, g, new V3(-4.2, TY + 0.42, 0), new V3(4.2, TY + 0.42, 0), 28, k ? 0.1 : 0.05, k ? M.arcOuter : M.arcCore, 0.28));
      const glows = [-3, 0, 3].map(x => { const s = new THREE.Sprite(M.glowBlue); s.scale.set(2.6, 1.6, 1); s.position.set(x, TY + 0.5, 0); g.add(s); return s; });
      wallSign(seg, g, 'hv', -1); wallSign(seg, g, 'hv', 1);
      return { type: 'cable', d, depth: 0.9, boxes: [{ cx: 0, hw: W / 2, kind: 'low', clear: 0.82 }], cause: 'zap', low: true, elec: true,
        light: { x: 0, y: TY + 1, color: 0x6fb6ff },
        update() { arcs.forEach(a => a.update()); glows.forEach(s => { s.material.opacity = rand(0.5, 1); }); } };
    },
    arc(seg, d) {
      const g = obGroup(seg, d), y = TY + 1.95;
      for (const s of [-1, 1]) {
        addMesh(g, G.box, M.cabinetSide, s * (W / 2 - 0.35), TY + 1.8, 0, 0.6, 3.6, 0.6);
        const ins = addMesh(g, G.cyl, M.ceramic, s * (W / 2 - 0.95), y, 0, 0.13, 0.7, 0.13); ins.rotation.z = Math.PI / 2;
        for (let k = 0; k < 3; k++) { const disc = addMesh(g, G.cyl, M.ceramic, s * (W / 2 - 0.75 - k * 0.2), y, 0, 0.24, 0.05, 0.24); disc.rotation.z = Math.PI / 2; }
        addMesh(g, G.sphere, M.copper, s * (W / 2 - 1.35), y, 0, 0.16, 0.16, 0.16);
      }
      const arcs = [];
      for (let k = 0; k < 4; k++) arcs.push(addArc(seg, g, new V3(-(W / 2 - 1.4), y, 0), new V3(W / 2 - 1.4, y, 0), 30, k ? 0.13 : 0.06, k ? M.arcOuter : M.arcCore, 0.32));
      const glows = [-2, 0, 2].map(x => { const s = new THREE.Sprite(M.glowBlue); s.scale.set(3.4, 2.4, 1); s.position.set(x, y, 0); g.add(s); return s; });
      wallSign(seg, g, 'hv', -1);
      return { type: 'arc', d, depth: 0.8, boxes: [{ cx: 0, hw: W / 2, kind: 'high' }], cause: 'zap', elec: true,
        light: { x: 0, y, color: 0x7cc4ff },
        update() { arcs.forEach(a => a.update()); glows.forEach(s => { s.material.opacity = rand(0.5, 1); }); } };
    },
    panel(seg, d, lanes) {
      const g = obGroup(seg, d), arcs = [], boxes = [];
      for (const li of lanes) {
        const x = LANES[li];
        addMesh(g, G.box, [M.cabinetSide, M.cabinetSide, M.cabinetSide, M.cabinetSide, M.cabinetFront, M.cabinetSide], x, TY + 1.55, 0, 2.3, 3.1, 1.1);
        for (const s of [-1, 1]) addMesh(g, G.cyl, M.ceramic, x + s * 0.7, TY + 3.35, 0, 0.1, 0.4, 0.1);
        for (let k = 0; k < 2; k++) arcs.push(addArc(seg, g, new V3(x - 0.7, TY + 3.55, 0), new V3(x + 0.7, TY + 3.55, 0), 12, k ? 0.1 : 0.05, k ? M.arcOuter : M.arcCore, 0.25));
        const s = new THREE.Sprite(M.glowBlue); s.scale.set(2.5, 2, 1); s.position.set(x, TY + 3.5, 0); g.add(s);
        boxes.push({ cx: x, hw: 1.2, kind: 'full' });
      }
      return { type: 'panel', d, depth: 1.2, boxes, cause: 'zap', elec: true, lanes,
        light: { x: LANES[lanes[0]], y: TY + 3.4, color: 0x7cc4ff }, update() { arcs.forEach(a => a.update()); } };
    },
    gas(seg, d, lanes) {
      const g = obGroup(seg, d), puffs = [], boxes = [];
      for (const li of lanes) {
        const x = LANES[li];
        addMesh(g, G.barrel, M.barrel, x - 0.55, TY + 0.58, 0.2);
        addMesh(g, G.band, M.barrelBand, x - 0.55, TY + 0.85, 0.2);
        const tipped = addMesh(g, G.barrel, M.barrel, x + 0.5, TY + 0.46, -0.3); tipped.rotation.z = Math.PI / 2 + 0.1; tipped.scale.y = 0.95;
        const pd = addMesh(g, G.puddle, M.puddle, x + 0.3, TY + 0.02, 0); pd.rotation.x = -Math.PI / 2;
        for (let k = 0; k < 9; k++) {
          const s = new THREE.Sprite(M.gas[k % 3]);
          const p = { s, bx: x + rand(-0.9, 0.9), by: TY + rand(0.6, 3.2), bz: rand(-1.1, 1.1), sc: rand(2.2, 3.4), ph: rand(0, 6.28) };
          s.position.set(p.bx, p.by, p.bz); s.scale.setScalar(p.sc); g.add(s); puffs.push(p);
        }
        boxes.push({ cx: x, hw: 1.25, kind: 'full' });
      }
      wallSign(seg, g, 'gas', lanes.indexOf(0) >= 0 ? -1 : 1);
      return { type: 'gas', d, depth: 2.2, boxes, cause: 'gas', gas: true, lanes,
        light: { x: LANES[lanes[0]], y: TY + 1.5, color: 0x55ff3a },
        update(t) { for (const p of puffs) { p.s.position.y = p.by + Math.sin(t * 0.8 + p.ph) * 0.35; p.s.position.x = p.bx + Math.sin(t * 0.5 + p.ph * 2) * 0.25; p.s.scale.setScalar(p.sc * (1 + 0.15 * Math.sin(t * 1.3 + p.ph))); } } };
    },
    waspHigh(seg, d) {
      const g = obGroup(seg, d);
      const nx = rand(-2.5, 2.5);
      addMesh(g, G.sphere, M.nest, nx, TY + H - 1.1, 0, 0.75, 1.0, 0.75);
      addMesh(g, G.cyl, M.nest, nx, TY + H - 0.2, 0, 0.08, 0.4, 0.08);
      const sw = makeSwarm(g, 22, { x: [-3.9, 3.9], y: [TY + 1.6, TY + 2.7], z: [-0.8, 0.8] });
      seg.owned.push(sw);
      wallSign(seg, g, 'wasp', nx < 0 ? 1 : -1);
      return { type: 'waspHigh', d, depth: 2.0, boxes: [{ cx: 0, hw: W / 2, kind: 'high' }], cause: 'wasp', wasp: true,
        update(t) { sw.update(t); } };
    },
    waspLane(seg, d, lanes, drift) {
      const g = obGroup(seg, d), x = LANES[lanes[0]];
      const sw = makeSwarm(g, 14, { x: [-0.9, 0.9], y: [TY + 0.4, TY + 2.7], z: [-0.8, 0.8] });
      seg.owned.push(sw);
      sw.cx = x;
      const box = { cx: x, hw: 1.3, kind: 'full' }, ph = rand(0, 6.28);
      return { type: drift ? 'waspDrift' : 'waspLane', d, depth: 2.0, boxes: [box], cause: 'wasp', wasp: true, lanes, drift,
        update(t) { if (drift) { box.cx = sw.cx = Math.sin(t * 0.9 + ph) * LANE; } sw.update(t); } };
    },
    barricade(seg, d, lanes) {
      const g = obGroup(seg, d), boxes = [];
      for (const li of lanes) {
        const x = LANES[li];
        addMesh(g, G.box, M.barricade, x, TY + 0.68, 0, 2.3, 0.28, 0.1);
        addMesh(g, G.box, M.barricade, x, TY + 0.3, 0, 2.3, 0.18, 0.1);
        for (const s of [-1, 1]) { const l = addMesh(g, G.box, M.wood, x + s * 1.0, TY + 0.42, 0, 0.1, 0.9, 0.5); l.rotation.x = 0.2; }
        boxes.push({ cx: x, hw: 1.15, kind: 'trip', clear: 0.82 });
      }
      return { type: 'barricade', d, depth: 0.5, boxes, cause: 'trip', low: true, lanes };
    }
  };

  function freeLanePatterns(nBlocked) {
    const free = (Math.random() * 3) | 0;
    if (nBlocked === 2) return { blocked: [0, 1, 2].filter(l => l !== free), free: [free] };
    const b = (Math.random() * 3) | 0;
    return { blocked: [b], free: [0, 1, 2].filter(l => l !== b) };
  }
  function placePattern(seg, d, lv, last) {
    const table = [
      ['cable', 1], ['arc', 1], ['panel1', 1.1], ['gas1', 1.1], ['waspHigh', 0.9], ['barricade', 0.7],
      ['panel2', lv > 0.12 ? 0.9 : 0], ['gas2', lv > 0.18 ? 0.9 : 0], ['mix2', lv > 0.25 ? 1.2 : 0],
      ['waspLane', lv > 0.08 ? 0.8 : 0], ['waspDrift', lv > 0.4 ? 0.7 : 0], ['barricade2', lv > 0.2 ? 0.5 : 0]
    ].filter(e => e[1] > 0 && e[0] !== last);
    let sum = table.reduce((a, e) => a + e[1], 0), r = Math.random() * sum, type = table[0][0];
    for (const e of table) { r -= e[1]; if (r <= 0) { type = e[0]; break; } }
    const out = [];
    let free = [0, 1, 2];
    if (type === 'cable') out.push(OB.cable(seg, d));
    else if (type === 'arc') out.push(OB.arc(seg, d));
    else if (type === 'waspHigh') out.push(OB.waspHigh(seg, d));
    else if (type === 'waspDrift') { out.push(OB.waspLane(seg, d, [1], true)); free = []; }
    else if (type === 'mix2') {
      const p = freeLanePatterns(2); free = p.free;
      const kinds = ['panel', 'gas', 'waspLane'].sort(() => Math.random() - 0.5);
      out.push(OB[kinds[0]](seg, d, [p.blocked[0]]), OB[kinds[1]](seg, d, [p.blocked[1]]));
    } else {
      const n = /2$/.test(type) ? 2 : 1, base = type.replace(/[12]$/, '');
      const p = freeLanePatterns(n); free = p.free;
      out.push(OB[base](seg, d, p.blocked));
    }
    return { type, obs: out, free, low: type === 'cable' || type.startsWith('barricade') };
  }

  // ---------- pins
  function addPin(seg, d, x, hy) {
    const g = new THREE.Group(); g.position.set(x, groundY(seg, d) + hy, -d); seg.group.add(g);
    g.add(new THREE.Mesh(G.pin, M.pinFace));
    seg.pins.push({ g, d, x, hy, got: false, t: 0 });
  }
  function pinRun(seg, d0, d1, lane) {
    for (let d = d0; d <= d1; d += 2.4) addPin(seg, d, LANES[lane], 1.0);
  }
  function pinArc(seg, d, lane) {
    for (let k = -4; k <= 4; k++) { const t = k / 4; addPin(seg, d + k * 1.6, LANES[lane], 1.0 + 1.5 * (1 - t * t)); }
  }

  // ---------- segment lifecycle
  function makeSegment(prev) {
    const index = prev ? prev.index + 1 : 0;
    const dir = prev ? (prev.dir + prev.turn + 4) % 4 : 0;
    const start = prev ? prev.end.clone() : new V3(0, 0, 0);
    const L = index === 0 ? SEG0_LEN : Math.round(rand(64, 124));
    let turn;
    if (dir === 0) turn = Math.random() < 0.5 ? -1 : 1; else if (dir === 1) turn = -1; else turn = 1;
    const end = start.clone().addScaledVector(DIRS[dir], L);
    const seg = { index, dir, start, end, L, turn, s0: prev ? prev.s0 + prev.L : 0, group: new THREE.Group(), obstacles: [], pins: [], updaters: [], owned: [] };
    seg.group.position.copy(start);
    seg.group.rotation.y = yawOf(dir);
    scene.add(seg.group);
    buildBody(seg, index === 0 ? RAMP_B : W / 2, L - W / 2);
    buildJunction(seg);
    populate(seg);
    segs.push(seg);
    return seg;
  }
  function populate(seg) {
    const lv = clamp(seg.s0 / 3000, 0, 1);
    const v = speedFor(seg.s0 + seg.L * 0.5);
    let d = seg.index === 0 ? RAMP_B + 22 : W / 2 + 16;
    const endLimit = seg.L - W / 2 - 18;
    const marks = [];
    let last = null;
    if (seg.index === 0) {
      pinRun(seg, 5, 12, 1);
      pinRun(seg, 16, 50, 1);
    }
    while (d <= endLimit) {
      const p = placePattern(seg, d, lv, last);
      last = p.type;
      p.obs.forEach(o => {
        if (o.light) o.lightPos = segWorld(seg, d, o.light.x, o.light.y);
        o.world = segWorld(seg, d, 0, TY + 1.5);
        seg.obstacles.push(o);
      });
      marks.push({ d, p });
      d += Math.max(13, v * rand(0.95, 1.45));
    }
    // pins between obstacles
    const pts = [seg.index === 0 ? RAMP_B : W / 2 + 4].concat(marks.map(m => m.d), [seg.L - W / 2 - 6]);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i] + 5, b = pts[i + 1] - 5;
      if (b - a > 6 && Math.random() < 0.7) pinRun(seg, a, Math.min(b, a + rand(10, 22)), (Math.random() * 3) | 0);
    }
    for (const m of marks) {
      if (m.p.low && Math.random() < 0.55) pinArc(seg, m.d, (Math.random() * 3) | 0);
      else if (m.p.free.length && m.p.type !== 'waspHigh' && m.p.type !== 'arc' && Math.random() < 0.6) {
        const lane = pick(m.p.free);
        for (let k = -1; k <= 1; k++) addPin(seg, m.d + k * 2.4, LANES[lane], 1.0);
      }
    }
    for (const o of seg.obstacles) if (o.update) seg.updaters.push(t => o.update(t));
  }
  function disposeSegment(seg) {
    scene.remove(seg.group);
    for (const o of seg.owned) if (o && o.dispose) o.dispose();
  }
  function ensureSegments() {
    const cur = P.seg.index;
    while (segs[segs.length - 1].index < cur + 3) makeSegment(segs[segs.length - 1]);
    while (segs.length && segs[0].index < cur - 1) disposeSegment(segs.shift());
  }
  const segByIndex = i => segs.find(s => s.index === i);

  // ---------- audio
  const AU = {
    ctx: null, muted: store.get('hor.muted', false),
    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      const c = this.ctx = new AC();
      this.master = c.createGain(); this.master.gain.value = this.muted ? 0 : 0.55; this.master.connect(c.destination);
      const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), ch = nb.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
      this.noiseBuf = nb;
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 185;
      const lfo = c.createOscillator(); lfo.frequency.value = 27; const lg = c.createGain(); lg.gain.value = 30; lfo.connect(lg); lg.connect(o.frequency);
      const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = 800; bf.Q.value = 1.4;
      this.buzz = c.createGain(); this.buzz.gain.value = 0; o.connect(bf); bf.connect(this.buzz); this.buzz.connect(this.master); o.start(); lfo.start();
      const ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
      const hf = c.createBiquadFilter(); hf.type = 'highpass'; hf.frequency.value = 2500;
      this.hiss = c.createGain(); this.hiss.gain.value = 0; ns.connect(hf); hf.connect(this.hiss); this.hiss.connect(this.master); ns.start();
      const hum = c.createOscillator(); hum.type = 'sawtooth'; hum.frequency.value = 60;
      const hl = c.createBiquadFilter(); hl.type = 'lowpass'; hl.frequency.value = 260;
      this.hum = c.createGain(); this.hum.gain.value = 0; hum.connect(hl); hl.connect(this.hum); this.hum.connect(this.master); hum.start();
      const dr = c.createOscillator(); dr.type = 'triangle'; dr.frequency.value = 49;
      const dr2 = c.createOscillator(); dr2.type = 'sine'; dr2.frequency.value = 73.4;
      this.drone = c.createGain(); this.drone.gain.value = 0; dr.connect(this.drone); dr2.connect(this.drone); this.drone.connect(this.master); dr.start(); dr2.start();
    },
    levels(buzz, hiss, hum, drone) {
      if (!this.ctx) return; const t = this.ctx.currentTime;
      this.buzz.gain.setTargetAtTime(buzz, t, 0.08); this.hiss.gain.setTargetAtTime(hiss, t, 0.1);
      this.hum.gain.setTargetAtTime(hum, t, 0.1); this.drone.gain.setTargetAtTime(drone, t, 0.5);
    },
    tone(f, dur, o) {
      if (!this.ctx) return; o = o || {};
      const c = this.ctx, t = c.currentTime + (o.delay || 0), osc = c.createOscillator(), g = c.createGain();
      osc.type = o.type || 'sine'; osc.frequency.setValueAtTime(f, t);
      if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
      g.gain.setValueAtTime(o.vol || 0.2, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g); g.connect(this.master); osc.start(t); osc.stop(t + dur + 0.05);
    },
    burst(dur, o) {
      if (!this.ctx) return; o = o || {};
      const c = this.ctx, t = c.currentTime + (o.delay || 0), s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
      s.buffer = this.noiseBuf; s.playbackRate.value = o.rate || 1;
      f.type = o.ftype || 'bandpass'; f.frequency.value = o.freq || 2000; f.Q.value = o.q || 1;
      g.gain.setValueAtTime(o.vol || 0.3, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      s.connect(f); f.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    },
    pin() { this.tone(1318, 0.07, { type: 'square', vol: 0.05 }); this.tone(1976, 0.16, { type: 'square', vol: 0.05, delay: 0.055 }); },
    jump() { this.tone(300, 0.2, { type: 'triangle', vol: 0.14, to: 620 }); },
    slide() { this.burst(0.35, { vol: 0.16, freq: 900, q: 0.7 }); },
    turn() { this.burst(0.2, { vol: 0.12, freq: 1600, q: 0.8 }); },
    land() { this.tone(130, 0.08, { vol: 0.16, to: 60 }); },
    step() { this.burst(0.04, { vol: 0.05, freq: 500, q: 1.5 }); },
    stumble() { this.tone(95, 0.3, { type: 'square', vol: 0.12, to: 50 }); this.burst(0.18, { vol: 0.25, freq: 400 }); },
    yeehaw() { this.tone(420, 0.2, { type: 'sawtooth', vol: 0.05, to: 820 }); this.tone(820, 0.36, { type: 'sawtooth', vol: 0.05, to: 380, delay: 0.2 }); },
    crackle(v) { this.burst(0.03 + Math.random() * 0.03, { vol: v, freq: rand(2500, 7000), q: 2 }); },
    zap() { for (let i = 0; i < 9; i++) this.burst(0.06, { vol: 0.45, freq: rand(1500, 7000), q: 3, delay: i * 0.035 }); this.tone(70, 0.7, { type: 'sawtooth', vol: 0.25, to: 35 }); },
    gas() { this.burst(1.2, { vol: 0.35, freq: 2500, q: 0.4 }); this.tone(240, 0.5, { type: 'triangle', vol: 0.12, to: 120, delay: 0.1 }); this.tone(200, 0.4, { type: 'triangle', vol: 0.1, to: 100, delay: 0.55 }); },
    sting() { for (let i = 0; i < 4; i++) this.tone(rand(900, 1400), 0.12, { type: 'sawtooth', vol: 0.08, to: 300, delay: i * 0.08 }); },
    thud() { this.tone(70, 0.4, { vol: 0.5, to: 32 }); this.burst(0.25, { vol: 0.4, freq: 300 }); },
    setMuted(m) { this.muted = m; store.set('hor.muted', m); if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.02); }
  };

  // ---------- game state
  const ui = id => document.getElementById(id);
  const el = {
    hud: ui('hud'), score: ui('score'), dist: ui('dist'), pins: ui('pins'), toast: ui('toast'), yeehaw: ui('yeehaw'), fx: ui('fx'),
    title: ui('title'), pause: ui('pause'), over: ui('over'), loading: ui('loading'), bestTitle: ui('bestTitle'),
    overTitle: ui('overTitle'), overLine: ui('overLine'), overEyebrow: ui('overEyebrow'), oScore: ui('oScore'), oDist: ui('oDist'), oPins: ui('oPins'), oBest: ui('oBest'), newBest: ui('newBest'),
    btnMute: ui('btnMute')
  };
  let state = 'loading';
  let P, C, runner, cowboy, history, clock = 0, deathT = 0, deathCause = '', shake = 0, best = store.get('hor.best', 0);
  const hinted = new Set();
  const camPos = new V3(), camLook = new V3(), tmp = new V3(), tmp2 = new V3();
  let camYaw = 0, deathCamSide = 1;

  function resetWorld() {
    segs.forEach(disposeSegment); segs = [];
    const s0 = makeSegment(null);
    P = { seg: s0, d: 0, x: 0, tx: 0, lane: 1, h: 0, vy: 0, grounded: true, sliding: false, slideT: 0, fastFall: false,
      total: 0, speed: 14, yaw: 0, queuedTurn: false, stumbleT: 0, slowT: 0, pins: 0, stepT: 0 };
    C = { gap: 3.2, target: 3.2 };
    history = [{ s: -60, x: 0, y: 0, z: 60, yaw: 0 }, { s: 0, x: 0, y: 0, z: 0, yaw: 0 }];
    ensureSegments();
    outdoor.visible = true; sky.visible = true;
    runner.root.visible = true; cowboy.root.visible = true;
    restorePose(runner);
    clock = 0; camYaw = 0; shake = 0;
    updateCharacters(0);
    updateHud();
  }

  function playerWorld(out) { return segWorld(P.seg, P.d, P.x, groundY(P.seg, P.d) + P.h, out); }

  function changeLane(dir) {
    const nl = P.lane + dir;
    if (nl < 0 || nl > 2) { shake = Math.max(shake, 0.15); AU.land(); return; }
    // side-swipe into something we are already alongside
    for (const o of P.seg.obstacles) {
      if (Math.abs(P.d - o.d) > o.depth / 2 + 0.2) continue;
      for (const b of o.boxes) if (b.kind === 'full' && Math.abs(LANES[nl] - b.cx) < b.hw + 0.3) { stumble(); return; }
    }
    P.lane = nl; P.tx = LANES[nl];
  }
  function inTurnWindow() { const L = P.seg.L; return P.d > L - W / 2 - 14 && P.d < L + W / 2; }
  function input(action) {
    if (state === 'title') { if (action === 'start' || action === 'up') startRun(); return; }
    if (state === 'over') { if (action === 'start') startRun(); return; }
    if (state === 'paused') { if (action === 'start' || action === 'pause') resume(); return; }
    if (state !== 'play') return;
    if (action === 'pause') { pause(); return; }
    if (action === 'left' || action === 'right') {
      const s = action === 'left' ? -1 : 1;
      if (inTurnWindow() && s === P.seg.turn) { P.queuedTurn = true; return; }
      changeLane(s);
    } else if (action === 'up') {
      if (P.grounded) { P.vy = JUMP_V; P.grounded = false; P.sliding = false; AU.jump(); }
    } else if (action === 'down') {
      if (!P.grounded) { P.fastFall = true; P.vy = Math.min(P.vy, -8); }
      else if (!P.sliding) { P.sliding = true; P.slideT = SLIDE_TIME; AU.slide(); }
      else P.slideT = SLIDE_TIME;
    }
  }

  function stumble() {
    if (P.stumbleT > 0 && !GOD) { die('caught', 'caught'); return; }
    P.stumbleT = 7; P.slowT = 0.5; shake = 0.35;
    AU.stumble(); setTimeout(() => AU.yeehaw(), 120);
    el.yeehaw.classList.add('show'); setTimeout(() => el.yeehaw.classList.remove('show'), 1100);
  }

  let toastTimer = 0;
  function toast(text, ms) {
    el.toast.textContent = text; el.toast.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('show'), ms || 1600);
  }
  const HINTS = {
    cable: '↑ Jump the live cable', arc: '↓ Slide under the arc', panel: '← → Dodge the switchgear', gas: '← → Avoid the gas',
    waspHigh: '↓ Slide under the swarm', waspLane: '← → Dodge the wasps', waspDrift: 'Time it past the wasps', barricade: '↑ Jump, or you will trip'
  };

  function flash(color, op, dur) {
    el.fx.style.transition = 'none'; el.fx.style.background = color; el.fx.style.opacity = op;
    requestAnimationFrame(() => { el.fx.style.transition = `opacity ${dur || 0.6}s ease-out`; el.fx.style.opacity = 0; });
  }

  const DEATHS = {
    zap: ['Zapped', 'Thirteen thousand volts. Your hair will never lie flat again.', () => { AU.zap(); flash('#bfe3ff', 0.9, 0.9); }],
    gas: ['Gassed', 'You breathed in the green stuff. Should have held your breath.', () => { AU.gas(); flash('#6dff4a', 0.6, 1.4); }],
    wasp: ['Stung', 'The wasps of Moffett Field defend their tunnels.', () => { AU.sting(); flash('#ffb000', 0.6, 0.8); }],
    wall: ['Splat', 'You missed the turn and ran into a tunnel wall.', () => { AU.thud(); flash('#ffffff', 0.5, 0.5); shake = 0.8; }],
    caught: ['Caught', 'The cowboy got his lasso around you. Yeehaw.', () => { AU.yeehaw(); AU.thud(); flash('#fc3d21', 0.45, 0.8); }]
  };
  function die(cause, hit) {
    if (GOD) { if (cause === 'trip') stumble(); return; }
    if (state !== 'play') return;
    state = 'dead'; deathT = 0; deathCause = cause;
    startRagdoll(cause, hit || 'full');
    DEATHS[cause][2]();
    C.target = cause === 'caught' ? 1.2 : 1.8;
    AU.levels(0, 0, 0, 0.04);
  }
  function showGameOver() {
    state = 'over';
    const score = scoreOf();
    const isBest = score > best;
    if (isBest) { best = score; store.set('hor.best', best); }
    const d = DEATHS[deathCause];
    el.overTitle.textContent = d[0]; el.overLine.textContent = d[1];
    el.overEyebrow.textContent = `Run over · ${tunnelName()}`;
    el.oScore.textContent = score.toLocaleString(); el.oDist.textContent = `${Math.floor(P.total)} m`; el.oPins.textContent = P.pins; el.oBest.textContent = best.toLocaleString();
    el.newBest.hidden = !isBest;
    el.over.hidden = false; el.hud.hidden = true;
    ui('btnAgain').focus({ preventScroll: true });
  }
  const tunnelName = () => (P.seg.index === 0 ? (P.d < RAMP_A ? 'Moffett Field tarmac' : P.d < RAMP_B ? 'Tunnel ramp' : 'Under Hangar One') : `Tunnel B, junction ${P.seg.index}`);
  const scoreOf = () => Math.floor(P.total) + P.pins * 10;

  function startRun() {
    AU.init();
    if (state === 'over' || state === 'dead') resetWorld();
    el.title.hidden = true; el.over.hidden = true; el.pause.hidden = true; el.hud.hidden = false;
    state = 'play';
    C.gap = 3.6; C.target = 3.2; P.stumbleT = 0;
    setTimeout(() => { if (state === 'play' && P.total < 60) AU.yeehaw(); }, 300);
    toast('Run! Down the ramp, under Hangar One', 1900);
    canvas.focus && canvas.focus();
  }
  function pause() { if (state !== 'play') return; state = 'paused'; el.pause.hidden = false; if (AU.ctx) AU.ctx.suspend(); ui('btnResume').focus({ preventScroll: true }); }
  function resume() { if (state !== 'paused') return; state = 'play'; el.pause.hidden = true; if (AU.ctx) AU.ctx.resume(); last = performance.now(); }
  function toTitle() {
    resetWorld(); state = 'title';
    el.pause.hidden = true; el.over.hidden = true; el.hud.hidden = true; el.title.hidden = false;
    if (AU.ctx) { AU.ctx.resume(); AU.levels(0, 0, 0, 0); }
    updateBestTitle();
  }
  function updateBestTitle() { el.bestTitle.textContent = best ? `Best run: ${best.toLocaleString()}` : ''; }

  function updateHud() {
    el.score.textContent = scoreOf().toLocaleString();
    el.dist.textContent = `${Math.floor(P.total)} m · ${tunnelName()}`;
    el.pins.textContent = P.pins;
  }

  // ---------- simulation
  function updatePlay(dt) {
    P.speed = speedFor(P.total) * (P.slowT > 0 ? 0.6 : 1);
    P.slowT -= dt;
    const step = P.speed * dt;
    P.d += step; P.total += step;
    P.x += (P.tx - P.x) * damp(16, dt);
    const gy = groundY(P.seg, P.d);
    if (!P.grounded) {
      P.vy -= GRAV * (P.fastFall ? 2.4 : 1) * dt; P.h += P.vy * dt;
      if (P.h <= 0) {
        P.h = 0; P.grounded = true; P.vy = 0; AU.land();
        if (P.fastFall) { P.sliding = true; P.slideT = SLIDE_TIME; AU.slide(); }
        P.fastFall = false;
      }
    }
    if (P.sliding) { P.slideT -= dt; if (P.slideT <= 0) P.sliding = false; }
    if (P.grounded && !P.sliding) { P.stepT -= dt; if (P.stepT <= 0) { P.stepT = 4.2 / P.speed; AU.step(); } }

    // turning
    const L = P.seg.L;
    if (GOD && P.d > L - 2) P.queuedTurn = true;
    if (P.queuedTurn && P.d >= L - W / 2 + 0.8) doTurn();
    else if (P.d > L + W / 2 - 0.7) { P.d = L + W / 2 - 0.7; die('wall', 'wall'); return; }
    if (!hinted.has('turn') && P.seg.index === 0 && P.d > L - 34 && P.d < L - 20) { hinted.add('turn'); toast(P.seg.turn < 0 ? '← Turn left at the junction' : 'Turn right at the junction →', 1800); }

    // obstacles
    for (const o of P.seg.obstacles) {
      const dz = P.d - o.d;
      if (!hinted.has(o.type) && dz > -30 && dz < -16 && HINTS[o.type]) { hinted.add(o.type); toast(HINTS[o.type], 1500); }
      if (o.done || Math.abs(dz) > o.depth / 2 + 0.35) continue;
      for (const b of o.boxes) {
        if (Math.abs(P.x - b.cx) >= b.hw + 0.4) continue;
        if (b.kind === 'low' && P.h < b.clear) { die(o.cause, 'low'); return; }
        if (b.kind === 'high' && !P.sliding) { die(o.cause, 'high'); return; }
        if (b.kind === 'full') { die(o.cause, 'full'); return; }
        if (b.kind === 'trip' && P.h < b.clear) { o.done = true; stumble(); if (state !== 'play') return; }
      }
    }
    // pins
    for (const p of P.seg.pins) {
      if (p.got || Math.abs(P.d - p.d) > 1.0 || Math.abs(P.x - p.x) > 1.1) continue;
      const py = P.h + (P.sliding ? 0.5 : 0.9);
      if (Math.abs(py - p.hy) < 1.3) { p.got = true; P.pins++; AU.pin(); }
    }
    // chaser
    P.stumbleT -= dt;
    if (P.total > 30) C.target = P.stumbleT > 0 ? 3.0 : 17;
    C.gap += (C.target - C.gap) * damp(C.target < C.gap ? 2.2 : 0.5, dt);

    playerWorld(tmp);
    P.yaw = lerpAngle(P.yaw, yawOf(P.seg.dir), damp(14, dt));
    history.push({ s: P.total, x: tmp.x, y: groundY(P.seg, P.d), z: tmp.z, yaw: P.yaw });
    while (history.length > 2 && history[1].s < P.total - 40) history.shift();
    ensureSegments();
    updateHud();
  }
  function doTurn() {
    const next = segByIndex(P.seg.index + 1);
    playerWorld(tmp);
    tmp2.copy(tmp).sub(next.start);
    P.d = tmp2.dot(DIRS[next.dir]);
    P.x = clamp(tmp2.dot(RIGHT(next.dir)), -LANE, LANE);
    P.lane = clamp(Math.round(P.x / LANE) + 1, 0, 2); P.tx = LANES[P.lane];
    P.seg = next; P.queuedTurn = false;
    AU.turn();
    ensureSegments();
  }
  function historyAt(s, out) {
    const h = history;
    if (s <= h[0].s) { out.x = h[0].x; out.y = h[0].y; out.z = h[0].z + (h[0].s - s) * 0; out.yaw = h[0].yaw; extrapolate(h[0], h[1], s, out); return out; }
    for (let i = h.length - 1; i > 0; i--) {
      if (h[i - 1].s <= s) {
        const a = h[i - 1], b = h[i], t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
        out.x = lerp(a.x, b.x, t); out.y = lerp(a.y, b.y, t); out.z = lerp(a.z, b.z, t); out.yaw = lerpAngle(a.yaw, b.yaw, t);
        return out;
      }
    }
    const e = h[h.length - 1]; out.x = e.x; out.y = e.y; out.z = e.z; out.yaw = e.yaw; return out;
  }
  function extrapolate(a, b, s, out) {
    const len = Math.max(0.001, b.s - a.s), t = (s - a.s) / len;
    out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t; out.y = a.y;
  }
  const chaserPos = { x: 0, y: 0, z: 0, yaw: 0 };

  function updateCharacters(dt) {
    playerWorld(tmp);
    runner.root.position.copy(tmp);
    runner.root.rotation.y = state === 'title' ? 2.4 : P.yaw;
    let pose = 'run';
    if (state === 'title') pose = 'idle';
    else if (P.sliding) pose = 'slide';
    else if (!P.grounded) pose = 'jump';
    if (state !== 'dead' && state !== 'over') animateRun(runner, dt, state === 'title' ? 2 : P.speed * 0.75, pose);

    historyAt(P.total - C.gap, chaserPos);
    cowboy.root.position.set(chaserPos.x, chaserPos.y, chaserPos.z);
    cowboy.root.rotation.y = chaserPos.yaw;
    if (state === 'dead' || state === 'over') {
      const R = RIGHT(P.seg.dir), k = smooth(Math.min(1, deathT / 0.8)) * 1.6 * -deathCamSide;
      cowboy.root.position.x += R.x * k; cowboy.root.position.z += R.z * k;
    }
    const close = C.gap < 7 || state !== 'play';
    cowboy.root.visible = C.gap < 12 || state !== 'play';
    const moving = state === 'play' || (state === 'dead' && Math.abs(C.gap - C.target) > 0.1);
    animateRun(cowboy, dt, state === 'title' ? 2 : moving ? Math.max(8, P.speed * 0.7) : 2, moving ? 'run' : 'idle');
    cowboy.lasso.visible = close;
    if (close) { cowboy.armR.rotation.x = Math.PI - 0.15; cowboy.lasso.rotation.y += dt * 9; }
  }

  function updateDead(dt) {
    deathT += dt;
    C.gap += (C.target - C.gap) * damp(1.6, dt);
    runner.body.visible = deathCause !== 'zap' || deathT > 1 || Math.random() > 0.3;
    if (rag) { stepRagdoll(dt); applyRagdoll(); }
    if (state === 'dead' && deathT > 1.9) showGameOver();
  }

  // ---------- ragdoll: verlet points + stick constraints, posed back onto the rig
  const RAG_LINKS = [['head', 'neck'], ['head', 'shL'], ['head', 'shR'], ['neck', 'pelvis'], ['shL', 'shR'], ['shL', 'neck'], ['shR', 'neck'],
    ['hipL', 'hipR'], ['hipL', 'pelvis'], ['hipR', 'pelvis'], ['shL', 'hipL'], ['shR', 'hipR'], ['shL', 'hipR'], ['shR', 'hipL'],
    ['neck', 'hipL'], ['neck', 'hipR'], ['head', 'pelvis'], ['shL', 'haL'], ['shR', 'haR'], ['hipL', 'ftL'], ['hipR', 'ftR']];
  const RAG_R = { head: 0.21, neck: 0.17, pelvis: 0.17, shL: 0.12, shR: 0.12, haL: 0.09, haR: 0.09, hipL: 0.13, hipR: 0.13, ftL: 0.08, ftR: 0.08 };
  const RAG_H = 1 / 120;
  let rag = null;
  function startRagdoll(cause, hit) {
    const h = runner;
    h.root.updateMatrixWorld(true);
    const at = (o, x, y, z) => o.localToWorld(new V3(x, y, z));
    const pos = { head: at(h.headG, 0, 0, 0), neck: at(h.body, 0, 1.7, 0), pelvis: at(h.body, 0, 0.95, 0),
      shL: at(h.armL, 0, 0, 0), shR: at(h.armR, 0, 0, 0), haL: at(h.armL, 0, -0.7, 0), haR: at(h.armR, 0, -0.7, 0),
      hipL: at(h.legL, 0, 0, 0), hipR: at(h.legR, 0, 0, 0), ftL: at(h.legL, 0, -0.9, 0), ftR: at(h.legR, 0, -0.9, 0) };
    const f = DIRS[P.seg.dir], r = RIGHT(P.seg.dir), sp = P.speed, vy0 = P.grounded ? 0 : P.vy;
    const side = rand(-1, 1);
    const pts = {};
    for (const n in pos) {
      const upper = /^(head|neck|sh|ha)/.test(n), foot = /^ft/.test(n);
      const v = new V3().copy(f).multiplyScalar(sp * 0.55); v.y = vy0;
      if (hit === 'wall') { v.copy(f).multiplyScalar(upper ? -5.5 : -3); v.y = 2.5; }
      else if (hit === 'caught') { v.copy(f).multiplyScalar(-3.5); v.y = upper ? 5 : 3.5; }
      else if (cause === 'gas') { v.copy(f).multiplyScalar(upper ? sp * 0.3 : sp * 0.15); v.y = 0.3; }
      else if (hit === 'low') { if (foot) v.multiplyScalar(0.05); else if (upper) { v.addScaledVector(f, 2.5); v.y += 1.2; } }
      else if (hit === 'high') { if (upper) { v.copy(f).multiplyScalar(-2.5); v.y = 1.2; } else { v.multiplyScalar(1.1); v.y += foot ? 4.5 : 2.5; } }
      else if (cause === 'wasp') { v.multiplyScalar(0.35); v.y += upper ? 2.5 : 1; v.addScaledVector(r, rand(-2, 2)); }
      else { v.copy(f).multiplyScalar(upper ? -4 : -2); v.y = upper ? 2.5 : 1.5; } // ran into something solid
      if (cause === 'zap') v.y += 3;
      v.addScaledVector(r, side * (upper ? 1.2 : 0.4));
      pts[n] = { p: pos[n], q: pos[n].clone().addScaledVector(v, -RAG_H), r: RAG_R[n] };
    }
    const links = RAG_LINKS.map(([a, b]) => [pts[a], pts[b], pos[a].distanceTo(pos[b])]);
    rag = { pts, links, acc: 0, cause };
  }
  function stepRagdoll(dt) {
    rag.acc += dt;
    while (rag.acc >= RAG_H) {
      rag.acc -= RAG_H;
      const twitch = rag.cause === 'zap' && deathT < 0.9 ? 0.025 : 0;
      for (const n in rag.pts) {
        const o = rag.pts[n], p = o.p, q = o.q;
        const vx = (p.x - q.x) * 0.998, vy = (p.y - q.y) * 0.998, vz = (p.z - q.z) * 0.998;
        q.copy(p);
        p.x += vx; p.y += vy - GRAV * RAG_H * RAG_H; p.z += vz;
        if (twitch) { p.x += rand(-twitch, twitch); p.y += rand(0, twitch); p.z += rand(-twitch, twitch); }
      }
      for (let it = 0; it < 8; it++) {
        for (const [a, b, rest] of rag.links) {
          const dx = b.p.x - a.p.x, dy = b.p.y - a.p.y, dz = b.p.z - a.p.z;
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, k = (d - rest) / d * 0.5;
          a.p.x += dx * k; a.p.y += dy * k; a.p.z += dz * k;
          b.p.x -= dx * k; b.p.y -= dy * k; b.p.z -= dz * k;
        }
        for (const n in rag.pts) ragCollide(rag.pts[n]);
      }
    }
  }
  // keep a point inside the tunnel: floor, ceiling, side walls and the end wall
  function ragCollide(o) {
    const seg = P.seg, D = DIRS[seg.dir], R = RIGHT(seg.dir), p = o.p, q = o.q, r = o.r;
    const rx = p.x - seg.start.x, rz = p.z - seg.start.z;
    let d = rx * D.x + rz * D.z, lat = rx * R.x + rz * R.z;
    const walls = seg.index !== 0 || d >= RAMP_A, roof = seg.index !== 0 || d >= RAMP_B;
    let moved = false;
    if (walls) {
      const lim = W / 2 - r;
      if (d < seg.L - W / 2) { if (lat > lim) { lat = lim; moved = true; } else if (lat < -lim) { lat = -lim; moved = true; } }
      else { const closed = -seg.turn; if (lat * closed > lim) { lat = closed * lim; moved = true; } }
      if (d > seg.L + W / 2 - r) { d = seg.L + W / 2 - r; moved = true; }
    }
    // solid switchgear cabinets
    for (const ob of seg.obstacles) {
      if (ob.type !== 'panel' || Math.abs(d - ob.d) > 0.55 + r + 0.2 || p.y > TY + 3.1 + r) continue;
      for (const bx of ob.boxes) {
        const pd = 0.55 + r - Math.abs(d - ob.d), pl = 1.15 + r - Math.abs(lat - bx.cx), py = TY + 3.1 + r - p.y;
        if (pd <= 0 || pl <= 0 || py <= 0) continue;
        if (py < pd && py < pl) { const vy = p.y - q.y; p.y += py; q.y = p.y + vy * 0.2; }
        else if (pd < pl) { d += d < ob.d ? -pd : pd; moved = true; }
        else { lat += lat < bx.cx ? -pl : pl; moved = true; }
      }
    }
    if (moved) {
      const vx = p.x - q.x, vz = p.z - q.z;
      p.x = seg.start.x + D.x * d + R.x * lat; p.z = seg.start.z + D.z * d + R.z * lat;
      q.x = p.x - vx * 0.4; q.z = p.z - vz * 0.4;
    }
    const gy = groundY(seg, clamp(d, 0, seg.L + W)) + r;
    if (p.y < gy) {
      const vy = p.y - q.y;
      p.y = gy; q.y = gy + vy * 0.25;
      q.x = lerp(q.x, p.x, 0.05); q.z = lerp(q.z, p.z, 0.05);
    }
    if (roof && p.y > TY + H - r) { const vy = p.y - q.y; p.y = TY + H - r; q.y = p.y + vy * 0.3; }
  }
  const rM = new THREE.Matrix4(), rM2 = new THREE.Matrix4(), rInv = new THREE.Matrix4(), rS = new V3();
  const rUp = new V3(), rRight = new V3(), rBack = new V3(), rY = new V3(), rX = new V3(), rZ = new V3();
  function setWorld(obj, parentInv, M) { rM2.multiplyMatrices(parentInv, M); rM2.decompose(obj.position, obj.quaternion, rS); }
  function applyRagdoll() {
    const h = runner, P_ = n => rag.pts[n].p;
    const shMid = P_('shL').clone().add(P_('shR')).multiplyScalar(0.5);
    const hipMid = P_('hipL').clone().add(P_('hipR')).multiplyScalar(0.5);
    rUp.subVectors(shMid, hipMid).normalize();
    rRight.subVectors(P_('shR'), P_('shL')).add(tmp.subVectors(P_('hipR'), P_('hipL')));
    rRight.addScaledVector(rUp, -rRight.dot(rUp)).normalize();
    rBack.crossVectors(rRight, rUp);
    // body: local (0, 0.95, 0) sits on the pelvis point
    const bodyW = new THREE.Matrix4().makeBasis(rRight, rUp, rBack);
    bodyW.setPosition(P_('pelvis').clone().addScaledVector(rUp, -0.95));
    h.root.updateMatrixWorld(true);
    rInv.copy(h.root.matrixWorld).invert();
    setWorld(h.body, rInv, bodyW);
    const bodyInv = rInv.copy(bodyW).invert();
    // head follows the neck-to-head direction
    rY.subVectors(P_('head'), P_('neck')).normalize();
    rX.copy(rRight).addScaledVector(rY, -rRight.dot(rY)).normalize(); rZ.crossVectors(rX, rY);
    rM.makeBasis(rX, rY, rZ).setPosition(P_('head')); setWorld(h.headG, bodyInv, rM);
    // each limb pivot points from its joint towards the hand / foot
    for (const [obj, j, e] of [[h.armL, 'shL', 'haL'], [h.armR, 'shR', 'haR'], [h.legL, 'hipL', 'ftL'], [h.legR, 'hipR', 'ftR']]) {
      rY.subVectors(P_(j), P_(e)).normalize();
      rX.copy(rRight).addScaledVector(rY, -rRight.dot(rY));
      if (rX.lengthSq() < 1e-6) rX.copy(rBack);
      rX.normalize(); rZ.crossVectors(rX, rY);
      rM.makeBasis(rX, rY, rZ).setPosition(P_(j)); setWorld(obj, bodyInv, rM);
    }
  }
  function restorePose(h) {
    rag = null;
    h.body.position.set(0, 0, 0); h.body.rotation.set(0, 0, 0); h.body.visible = true;
    for (const [o, p] of h.rest) { o.position.copy(p); o.rotation.set(0, 0, 0); }
  }

  // camera
  function updateCamera(dt) {
    if (state === 'title' || state === 'loading') {
      const t = clock * 0.12;
      camPos.set(-4.5 + Math.sin(t) * 1.2, 2.4, 8.5 + Math.cos(t) * 0.8);
      camLook.set(-14, 9, -40);
      camera.position.copy(camPos); camera.lookAt(camLook);
      return;
    }
    const ty = yawOf(P.seg.dir);
    camYaw = lerpAngle(camYaw, ty, damp(state === 'play' ? 6 : 2, dt));
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const base = segWorld(P.seg, P.d, P.x * 0.55, groundY(P.seg, P.d) + P.h * 0.45, tmp2);
    if (rag) { base.copy(rag.pts.pelvis.p); base.y = Math.max(groundY(P.seg, P.d), base.y - 0.6); }
    let want = new V3(base.x - fx * 6.4, base.y + 4.9, base.z - fz * 6.4);
    let look = new V3(base.x + fx * 8, base.y + 0.9, base.z + fz * 8);
    if (state === 'dead' || state === 'over') {
      // elevated three-quarter view from behind, kept inside the tunnel
      const t = smooth(Math.min(1, deathT / 1.2)), seg = P.seg, D = DIRS[seg.dir], R = RIGHT(seg.dir);
      const rx = base.x - seg.start.x, rz = base.z - seg.start.z;
      const bd = rx * D.x + rz * D.z, bl = rx * R.x + rz * R.z;
      const cl = clamp(bl + (bl > 0 ? -2.4 : 2.4), -(W / 2 - 0.7), W / 2 - 0.7);
      deathCamSide = Math.sign(cl - bl) || 1;
      const cd = Math.max(bd - 3.4, seg.index === 0 ? 0 : -W / 2 + 0.7);
      const gy = groundY(seg, cd), cy = Math.min(base.y + 3.6, seg.index === 0 && cd < RAMP_B ? 99 : TY + H - 0.4);
      want.lerp(segWorld(seg, cd, cl, Math.max(gy + 1.5, cy), tmp), t);
      // on wide screens the game-over panel covers the left, so frame the body right of center
      const vd = tmp.clone().sub(base), rgt = new V3(-vd.z, 0, vd.x).normalize();
      const off = camera.aspect > 1.1 ? 1.5 : 0;
      look.lerp(new V3(base.x + rgt.x * off, base.y + 0.2, base.z + rgt.z * off), t);
    }
    if (camPos.lengthSq() === 0 || camPos.distanceTo(want) > 60) camPos.copy(want); else camPos.lerp(want, damp(state === 'play' ? 12 : 4, dt));
    if (camLook.lengthSq() === 0 || camLook.distanceTo(look) > 60) camLook.copy(look); else camLook.lerp(look, damp(14, dt));
    camera.position.copy(camPos);
    if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; shake = Math.max(0, shake - dt * 1.5); }
    camera.lookAt(camLook);
  }

  // environment blend: outdoors -> hangar -> tunnel
  const fogOut = new THREE.Color(0xcfd9e0), fogIn = new THREE.Color(0x06080b);
  function updateEnvironment() {
    let e = 1;
    if (state === 'title' || state === 'loading') e = 0;
    else if (P.seg.index === 0) e = smooth(clamp((P.d - 8) / (RAMP_B - 2), 0, 1));
    scene.fog.color.copy(fogOut).lerp(fogIn, e);
    scene.background.copy(scene.fog.color);
    scene.fog.near = lerp(80, 6, e); scene.fog.far = lerp(1500, 72, e);
    hemi.intensity = lerp(1.0, 0.32, e);
    hemi.color.setHex(0xdfeaff).lerp(new THREE.Color(0xffe2b8), e);
    sun.intensity = lerp(0.9, 0, e);
    playerLight.intensity = lerp(0, 1.5, e);
    const under = e >= 0.999 && P && (P.seg.index > 0 || P.d > RAMP_B + 10);
    outdoor.visible = !under; sky.visible = !under;
    sky.material.opacity = 1;
    AU.levels(AU.buzzLvl || 0, AU.hissLvl || 0, AU.humLvl || 0, 0.05 * e);
  }

  // hazards: pooled lights + proximity audio
  function updateHazards(t, dt) {
    if (!P) return;
    playerWorld(tmp);
    playerLight.position.set(tmp.x - Math.sin(P.yaw) * 3, tmp.y + 4.2, tmp.z - Math.cos(P.yaw) * 3);
    const cands = [];
    let buzz = 0, hiss = 0, hum = 0;
    for (const s of segs) {
      if (s.index < P.seg.index || s.index > P.seg.index + 1) continue;
      for (const o of s.obstacles) {
        const dist = o.world.distanceTo(tmp);
        if (dist > 45) continue;
        if (o.light) cands.push({ o, dist });
        const near = Math.max(0, 1 - dist / 26);
        if (o.wasp) buzz = Math.max(buzz, near * near * 0.22);
        if (o.gas) hiss = Math.max(hiss, near * near * 0.08);
        if (o.elec) { hum = Math.max(hum, near * 0.12); if (state === 'play' && Math.random() < near * dt * 18) AU.crackle(0.12 * near); }
      }
    }
    cands.sort((a, b) => a.dist - b.dist);
    hazLights.forEach((l, i) => {
      const c = cands[i];
      if (!c) { l.intensity = 0; return; }
      l.position.copy(c.o.lightPos); l.color.setHex(c.o.light.color);
      l.intensity = c.o.elec ? rand(1.2, 2.6) : 1.1 + Math.sin(t * 2) * 0.2;
    });
    AU.buzzLvl = state === 'play' ? buzz : 0; AU.hissLvl = state === 'play' ? hiss : 0; AU.humLvl = state === 'play' ? hum : 0;
  }

  function updateWorld(t, dt) {
    M.redLamp.color.setHex(Math.sin(t * 5) > 0 ? 0xff2a1a : 0x3a0806);
    M.gas.forEach((m, i) => { m.rotation += dt * (0.15 + i * 0.07) * (i % 2 ? -1 : 1); });
    for (const s of segs) {
      s.group.visible = !P || (s.index >= P.seg.index - 1 && s.index <= P.seg.index + 1);
      if (!s.group.visible) continue;
      for (const u of s.updaters) u(t);
      for (const p of s.pins) {
        if (p.got) {
          if (!p.g.visible) continue;
          p.t += dt; p.g.position.y += dt * 7; p.g.scale.setScalar(Math.max(0.01, 1 - p.t * 3.5));
          if (p.t > 0.28) p.g.visible = false;
        } else p.g.rotation.y = Math.sin(t * 3 + p.d * 0.3) * 0.9;
      }
    }
  }

  // ---------- loop
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (state === 'paused') { renderer.render(scene, camera); return; }
    clock += dt;
    if (state === 'play') updatePlay(dt);
    else if (state === 'dead' || state === 'over') updateDead(dt);
    if (state !== 'loading') updateCharacters(dt);
    updateWorld(clock, dt);
    updateHazards(clock, dt);
    updateEnvironment();
    updateCamera(dt);
    renderer.render(scene, camera);
  }

  // ---------- input wiring
  const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', Space: 'up', ArrowDown: 'down', KeyS: 'down', KeyP: 'pause', Escape: 'pause', Enter: 'start' };
  window.addEventListener('keydown', e => {
    if (e.code === 'KeyM') { toggleMute(); return; }
    const a = KEYS[e.code]; if (!a) return;
    if (e.target && e.target.tagName === 'BUTTON' && (e.code === 'Enter' || e.code === 'Space')) return; // let the button handle it
    e.preventDefault();
    if (e.repeat && (a === 'left' || a === 'right')) return;
    input(a);
  });
  let touch = null;
  canvas.addEventListener('touchstart', e => { const t = e.changedTouches[0]; touch = { x: t.clientX, y: t.clientY, used: false }; }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    if (!touch || touch.used) return;
    const t = e.changedTouches[0], dx = t.clientX - touch.x, dy = t.clientY - touch.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 28) return;
    touch.used = true;
    if (Math.abs(dx) > Math.abs(dy)) input(dx < 0 ? 'left' : 'right'); else input(dy < 0 ? 'up' : 'down');
  }, { passive: true });
  canvas.addEventListener('touchend', () => { touch = null; }, { passive: true });
  ui('btnStart').addEventListener('click', startRun);
  ui('btnAgain').addEventListener('click', startRun);
  ui('btnTitle').addEventListener('click', toTitle);
  ui('btnResume').addEventListener('click', resume);
  ui('btnQuit').addEventListener('click', toTitle);
  ui('btnPause').addEventListener('click', () => (state === 'paused' ? resume() : pause()));
  function toggleMute() { AU.setMuted(!AU.muted); el.btnMute.setAttribute('aria-pressed', String(AU.muted)); }
  el.btnMute.addEventListener('click', toggleMute);
  el.btnMute.setAttribute('aria-pressed', String(AU.muted));
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

  // ---------- boot
  async function boot() {
    try {
      if (document.fonts && document.fonts.load) {
        await Promise.race([
          Promise.all([document.fonts.load(`64px ${F_DISPLAY}`), document.fonts.load(`700 40px ${F_BODY}`), document.fonts.load(`600 40px ${F_BODY}`)]),
          new Promise(r => setTimeout(r, 1800))
        ]);
      }
    } catch (e) { /* fall back to system fonts */ }
    resize();
    buildTextures();
    buildMaterials();
    buildLights();
    outdoor = buildOutdoor();
    runner = makeRunner(); cowboy = makeCowboy();
    scene.add(runner.root, cowboy.root);
    document.querySelectorAll('.pin-ico').forEach(n => { n.style.backgroundImage = `url(${T.pinCanvas.toDataURL()})`; });
    resetWorld();
    state = 'title';
    updateBestTitle();
    el.loading.hidden = true;
    last = performance.now();
    requestAnimationFrame(frame);
    window.__hor = { get state() { return state; }, get P() { return P; }, get C() { return C; }, get rag() { return rag; }, get segs() { return segs; }, input, renderer, scene, camera, teleport(seg, d, lane) { P.seg = seg; P.d = d; P.lane = lane == null ? 1 : lane; P.x = P.tx = LANES[P.lane]; P.queuedTurn = false; ensureSegments(); camPos.set(0, 0, 0); camLook.set(0, 0, 0); } };
  }
  boot();
})();
