/* fx.js — visual effects & game feel (owner: VFX).
   Pooled particle system (struct-of-arrays, zero per-frame allocation), sprite-sheet flipbooks,
   element hit sparks, explosions, lightning, rings, damage numbers, reaction labels, screen shake
   (smooth-noise trauma model), hit-stop, slow-mo, zoom punch, cut-ins, boss intros, screen overlays.
   All public calls are cheap no-throw fire-and-forget; reducedFx scales everything down. */
'use strict';
G.fx = (function () {
  const U = G.u, TAU = Math.PI * 2;
  const api = { timeScale: 1 };
  const rnd = Math.random;                         // fx never consumes the seeded game RNG
  const rr = (a, b) => a + (b - a) * rnd();
  const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
  const settings = () => G.save.data.settings;
  const reduced = () => !!G.save.data.settings.reducedFx;
  const ROUND = '"M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic", sans-serif';
  const SERIF = '"Shippori Mincho B1", "Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif';

  /* ======================= colour + sprite helpers (creation time only) ======================= */
  function parseHex(c) {
    if (!c || c[0] !== '#') return null; let h = c.slice(1);
    if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(v => v + v).join('');
    h = h.slice(0, 6); const n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgba(c, a) { const p = parseHex(c); return p ? `rgba(${p[0]},${p[1]},${p[2]},${a})` : c; }
  const mk = (w, h) => G.assets.makeCanvas(w, h);
  function radial(x, cx, cy, r, stops) { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); for (const s of stops) g.addColorStop(s[0], s[1]); return g; }

  const SPR = [], sprMap = new Map();
  function sprite(key, make) { let i = sprMap.get(key); if (i === undefined) { i = SPR.length; SPR.push(make()); sprMap.set(key, i); } return i; }

  const MK = {
    core: c => sprite('core' + c, () => { const cv = mk(64, 64), x = cv.getContext('2d'); x.fillStyle = radial(x, 32, 32, 32, [[0, '#fff'], [0.13, rgba(c, 1)], [0.4, rgba(c, 0.3)], [1, rgba(c, 0)]]); x.fillRect(0, 0, 64, 64); return cv; }),
    soft: (c, a) => sprite('soft' + c + a, () => { const cv = mk(64, 64), x = cv.getContext('2d'); x.fillStyle = radial(x, 32, 32, 32, [[0, rgba(c, a)], [0.45, rgba(c, a * 0.45)], [1, rgba(c, 0)]]); x.fillRect(0, 0, 64, 64); return cv; }),
    streak: c => sprite('streak' + c, () => {
      const cv = mk(64, 16), x = cv.getContext('2d'); x.scale(1, 0.25);
      x.fillStyle = radial(x, 32, 32, 32, [[0, '#fff'], [0.3, rgba(c, 1)], [1, rgba(c, 0)]]); x.fillRect(0, 0, 64, 64); return cv;
    }),
    star: c => sprite('star' + c, () => {
      const cv = mk(64, 64), x = cv.getContext('2d'), st = SPR[MK.streak(c)];
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = radial(x, 32, 32, 14, [[0, '#fff'], [0.4, rgba(c, 0.8)], [1, rgba(c, 0)]]); x.fillRect(0, 0, 64, 64);
      x.drawImage(st, 0, 28, 64, 8);
      x.translate(32, 32); x.rotate(Math.PI / 2); x.drawImage(st, -32, -4, 64, 8);
      x.rotate(Math.PI / 4); x.globalAlpha = 0.6; x.drawImage(st, -18, -3, 36, 6); x.rotate(Math.PI / 2); x.drawImage(st, -18, -3, 36, 6);
      return cv;
    }),
    shard: (c, d) => sprite('shard' + c + d, () => {
      const cv = mk(32, 32), x = cv.getContext('2d');
      x.beginPath(); x.moveTo(16, 1); x.lineTo(22, 14); x.lineTo(16, 31); x.lineTo(10, 14); x.closePath();
      x.fillStyle = c; x.fill(); x.lineWidth = 1.4; x.strokeStyle = d; x.stroke();
      x.beginPath(); x.moveTo(16, 1); x.lineTo(16, 31); x.lineTo(10, 14); x.closePath(); x.fillStyle = 'rgba(255,255,255,.55)'; x.fill();
      return cv;
    }),
    chip: (c, d) => sprite('chip' + c + d, () => {
      const cv = mk(32, 32), x = cv.getContext('2d');
      x.beginPath(); x.moveTo(5, 11); x.lineTo(14, 4); x.lineTo(26, 7); x.lineTo(29, 19); x.lineTo(19, 28); x.lineTo(7, 24); x.closePath();
      x.fillStyle = c; x.fill(); x.lineWidth = 1.6; x.strokeStyle = d; x.stroke();
      x.beginPath(); x.moveTo(5, 11); x.lineTo(14, 4); x.lineTo(26, 7); x.lineTo(17, 15); x.closePath(); x.fillStyle = 'rgba(255,255,255,.4)'; x.fill();
      return cv;
    }),
    plus: c => sprite('plus' + c, () => {
      const cv = mk(32, 32), x = cv.getContext('2d');
      x.shadowColor = c; x.shadowBlur = 6; x.fillStyle = c;
      x.fillRect(12, 5, 8, 22); x.fillRect(5, 12, 22, 8);
      x.shadowBlur = 0; x.fillStyle = 'rgba(255,255,255,.7)'; x.fillRect(14, 7, 4, 18); x.fillRect(7, 14, 18, 4);
      return cv;
    }),
    rim: (c1, c2) => sprite('rim' + c1 + c2, () => {
      const cv = mk(128, 128), x = cv.getContext('2d');
      x.fillStyle = radial(x, 64, 64, 64, [[0, rgba(c1, 0)], [0.52, rgba(c1, 0)], [0.78, rgba(c1, 0.85)], [0.9, rgba(c2, 0.4)], [1, rgba(c2, 0)]]);
      x.fillRect(0, 0, 128, 128); return cv;
    }),
    scorch: v => sprite('scorch' + v, () => {
      const cv = mk(128, 128), x = cv.getContext('2d');
      x.fillStyle = radial(x, 64, 64, 60, [[0, 'rgba(18,8,2,.8)'], [0.55, 'rgba(34,16,6,.5)'], [1, 'rgba(34,16,6,0)']]); x.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 12; i++) {
        const a = rnd() * TAU, d = rr(26, 46), r = rr(7, 16), cx = 64 + Math.cos(a) * d, cy = 64 + Math.sin(a) * d;
        x.fillStyle = radial(x, cx, cy, r, [[0, 'rgba(28,12,4,.45)'], [1, 'rgba(28,12,4,0)']]); x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      x.strokeStyle = 'rgba(10,4,0,.45)'; x.lineWidth = 2; x.lineCap = 'round';
      for (let i = 0; i < 7; i++) {
        let a = rnd() * TAU, px = 64, py = 64; x.beginPath(); x.moveTo(px, py);
        for (let s = 0; s < 4; s++) { a += rr(-0.5, 0.5); px += Math.cos(a) * rr(8, 14); py += Math.sin(a) * rr(8, 14); x.lineTo(px, py); }
        x.stroke();
      }
      return cv;
    }),
    rays: c => sprite('rays' + c, () => {
      const cv = mk(256, 256), x = cv.getContext('2d'); x.translate(128, 128);
      x.fillStyle = radial(x, 0, 0, 128, [[0, rgba(c, 0.95)], [0.35, rgba(c, 0.4)], [1, rgba(c, 0)]]);
      x.beginPath();
      for (let i = 0; i < 16; i++) { const a = i / 16 * TAU + rr(-0.12, 0.12), w = rr(0.03, 0.09), L = rr(90, 128); x.moveTo(0, 0); x.lineTo(Math.cos(a - w) * L, Math.sin(a - w) * L); x.lineTo(Math.cos(a + w) * L, Math.sin(a + w) * L); x.closePath(); }
      x.fill();
      x.fillStyle = radial(x, 0, 0, 40, [[0, 'rgba(255,255,255,.9)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(-40, -40, 80, 80);
      return cv;
    }),
    pillar: c => sprite('pillar' + c, () => {
      const cv = mk(64, 256), x = cv.getContext('2d');
      const g = x.createLinearGradient(0, 0, 64, 0);
      g.addColorStop(0, rgba(c, 0)); g.addColorStop(0.28, rgba(c, 0.45)); g.addColorStop(0.5, '#fff'); g.addColorStop(0.72, rgba(c, 0.45)); g.addColorStop(1, rgba(c, 0));
      x.fillStyle = g; x.fillRect(0, 0, 64, 256);
      x.globalCompositeOperation = 'destination-in';
      const v = x.createLinearGradient(0, 0, 0, 256); v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.4, 'rgba(0,0,0,.75)'); v.addColorStop(0.93, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,.3)');
      x.fillStyle = v; x.fillRect(0, 0, 64, 256); return cv;
    }),
    hex: (c, l) => sprite('hex' + c, () => {
      const S = 256, cv = mk(S, S), x = cv.getContext('2d'), R = 124;
      x.fillStyle = radial(x, 128, 128, R, [[0, rgba(c, 0.03)], [0.7, rgba(c, 0.1)], [0.92, rgba(c, 0.35)], [1, rgba(c, 0.65)]]);
      x.beginPath(); x.arc(128, 128, R, 0, TAU); x.fill();
      // honeycomb, faded toward the centre via a masked layer
      const hc = mk(S, S), h = hc.getContext('2d'), hs = 17;
      h.strokeStyle = rgba(l, 0.9); h.lineWidth = 2;
      h.beginPath();
      for (let row = -1; row < S / (hs * 1.5) + 1; row++) for (let col = -1; col < S / (hs * 1.732) + 1; col++) {
        const cx = col * hs * 1.732 + (row & 1) * hs * 0.866, cy = row * hs * 1.5;
        for (let k = 0; k <= 6; k++) { const a = Math.PI / 6 + k * Math.PI / 3, px = cx + Math.cos(a) * hs, py = cy + Math.sin(a) * hs; k ? h.lineTo(px, py) : h.moveTo(px, py); }
      }
      h.stroke();
      h.globalCompositeOperation = 'destination-in';
      h.fillStyle = radial(h, 128, 128, R, [[0, 'rgba(0,0,0,.08)'], [0.65, 'rgba(0,0,0,.3)'], [0.97, 'rgba(0,0,0,.95)'], [1, 'rgba(0,0,0,0)']]);
      h.fillRect(0, 0, S, S);
      x.drawImage(hc, 0, 0);
      x.lineWidth = 5; x.strokeStyle = rgba(l, 0.95); x.beginPath(); x.arc(128, 128, R - 2, 0, TAU); x.stroke();
      x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.7)'; x.beginPath(); x.arc(128, 128, R - 8, 0, TAU); x.stroke();
      x.fillStyle = radial(x, 88, 78, 44, [[0, 'rgba(255,255,255,.55)'], [1, 'rgba(255,255,255,0)']]); x.fillRect(40, 30, 96, 96);
      return cv;
    }),
    vignette: (c, inner) => sprite('vig' + c + inner, () => {
      const cv = mk(256, 256), x = cv.getContext('2d');
      x.fillStyle = radial(x, 128, 128, 181, [[0, rgba(c, 0)], [inner, rgba(c, 0)], [0.72, rgba(c, 0.85)], [1, rgba(c, 1)]]); x.fillRect(0, 0, 256, 256); return cv;
    }),
    /* HD fireball: lumpy additive ball (white-hot core → mid → edge colour) */
    fireball: (c1, c2) => sprite('fb' + c1 + c2, () => {
      const S = 128, cv = mk(S, S), x = cv.getContext('2d');
      x.globalCompositeOperation = 'lighter';
      x.fillStyle = radial(x, 64, 64, 60, [[0, rgba(c2, 0.5)], [0.6, rgba(c2, 0.28)], [1, rgba(c2, 0)]]); x.fillRect(0, 0, S, S);
      for (let i = 0; i < 13; i++) {
        const a = i / 13 * TAU + rr(-0.2, 0.2), d = rr(16, 34), r = rr(13, 24), cx = 64 + Math.cos(a) * d, cy = 64 + Math.sin(a) * d;
        x.fillStyle = radial(x, cx, cy, r, [[0, rgba(i & 1 ? c1 : c2, 0.55)], [0.6, rgba(c2, 0.2)], [1, rgba(c2, 0)]]); x.fillRect(cx - r, cy - r, r * 2, r * 2);
      }
      x.fillStyle = radial(x, 64, 64, 30, [[0, 'rgba(255,255,245,.9)'], [0.25, rgba(c1, 0.75)], [1, rgba(c1, 0)]]); x.fillRect(0, 0, S, S);
      // dark-edged licks give the ball structure against bright ground
      x.globalCompositeOperation = 'source-atop';
      for (let i = 0; i < 7; i++) { const a = rnd() * TAU, d = rr(34, 50), r = rr(8, 14), cx = 64 + Math.cos(a) * d, cy = 64 + Math.sin(a) * d; x.fillStyle = radial(x, cx, cy, r, [[0, 'rgba(120,20,0,.35)'], [1, 'rgba(120,20,0,0)']]); x.fillRect(cx - r, cy - r, r * 2, r * 2); }
      return cv;
    }),
    /* lumpy smoke / steam puff */
    puff: c => sprite('puff' + c, () => {
      const cv = mk(64, 64), x = cv.getContext('2d');
      for (let i = 0; i < 7; i++) { const a = rnd() * TAU, d = rr(3, 12), r = rr(12, 19), cx = 32 + Math.cos(a) * d, cy = 32 + Math.sin(a) * d; x.fillStyle = radial(x, cx, cy, r, [[0, rgba(c, 0.55)], [0.55, rgba(c, 0.3)], [1, rgba(c, 0)]]); x.fillRect(0, 0, 64, 64); }
      return cv;
    }),
    /* 4-point lens glint (crits, crystals, shatter) */
    flare: c => sprite('flare' + c, () => {
      const cv = mk(128, 128), x = cv.getContext('2d'); x.globalCompositeOperation = 'lighter';
      const ray = (w, h, a) => { x.save(); x.translate(64, 64); x.rotate(a); x.scale(1, h / w); x.fillStyle = radial(x, 0, 0, w, [[0, 'rgba(255,255,255,1)'], [0.25, rgba(c, 0.8)], [1, rgba(c, 0)]]); x.fillRect(-w, -w, w * 2, w * 2); x.restore(); };
      ray(64, 3.5, 0); ray(64, 3.5, Math.PI / 2); ray(30, 2.5, Math.PI / 4); ray(30, 2.5, -Math.PI / 4);
      x.fillStyle = radial(x, 64, 64, 18, [[0, 'rgba(255,255,255,1)'], [0.4, rgba(c, 0.7)], [1, rgba(c, 0)]]); x.fillRect(0, 0, 128, 128);
      return cv;
    }),
    /* black smoke lobe for the enemy "dark aura": near-black body, faint violet fringe baked into the edge */
    darkSmoke: v => sprite('dsmoke' + v, () => {
      const S = 128, cv = mk(S, S), x = cv.getContext('2d');
      let seed = 7 + v * 131; const sr = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      // violet fringe first (larger, faint), then the black body on top so only a thin rim of violet shows
      for (let pass = 0; pass < 2; pass++) {
        let s2 = 7 + v * 131; const q = () => { s2 = (s2 * 16807) % 2147483647; return s2 / 2147483647; };
        for (let i = 0; i < 9; i++) {
          const a = q() * TAU, d = 8 + q() * 26, r = 16 + q() * 14, cx = 64 + Math.cos(a) * d, cy = 64 + Math.sin(a) * d * 0.9;
          const R = pass ? r : r * 1.18;
          x.fillStyle = pass ? radial(x, cx, cy, R, [[0, 'rgba(3,1,6,.95)'], [0.55, 'rgba(8,3,15,.8)'], [0.82, 'rgba(22,8,38,.35)'], [1, 'rgba(24,9,40,0)']])
            : radial(x, cx, cy, R, [[0, 'rgba(70,30,125,0)'], [0.7, 'rgba(78,34,140,.22)'], [0.9, 'rgba(96,48,170,.16)'], [1, 'rgba(96,48,170,0)']]);
          x.fillRect(cx - R, cy - R, R * 2, R * 2);
        }
      }
      // a few darker cores for depth
      for (let i = 0; i < 4; i++) { const cx = 44 + sr() * 40, cy = 44 + sr() * 40, r = 10 + sr() * 8; x.fillStyle = radial(x, cx, cy, r, [[0, 'rgba(0,0,0,.55)'], [1, 'rgba(0,0,0,0)']]); x.fillRect(cx - r, cy - r, r * 2, r * 2); }
      return cv;
    }),
    /* soft uneven violet halo ring (drawn at low alpha, source-over: tints the ground, never glows white) */
    darkRim: () => sprite('drim', () => {
      const cv = mk(128, 128), x = cv.getContext('2d');
      x.fillStyle = radial(x, 64, 64, 64, [[0, 'rgba(60,20,110,0)'], [0.6, 'rgba(60,20,110,0)'], [0.8, 'rgba(84,36,150,.55)'], [0.9, 'rgba(70,28,128,.25)'], [1, 'rgba(60,20,110,0)']]);
      x.fillRect(0, 0, 128, 128); return cv;
    }),
    /* ice block (frozen reaction) */
    ice: () => sprite('ice', () => {
      const cv = mk(128, 128), x = cv.getContext('2d');
      x.fillStyle = radial(x, 64, 80, 60, [[0, 'rgba(200,250,255,.45)'], [1, 'rgba(160,230,255,0)']]); x.fillRect(0, 0, 128, 128);
      const shard = (cx, cy, w, h, a) => {
        x.save(); x.translate(cx, cy); x.rotate(a);
        x.beginPath(); x.moveTo(0, -h); x.lineTo(w, -h * 0.35); x.lineTo(w * 0.8, h * 0.4); x.lineTo(0, h * 0.5); x.lineTo(-w * 0.85, h * 0.3); x.lineTo(-w, -h * 0.4); x.closePath();
        const g = x.createLinearGradient(-w, -h, w, h); g.addColorStop(0, 'rgba(240,255,255,.92)'); g.addColorStop(0.5, 'rgba(150,230,255,.72)'); g.addColorStop(1, 'rgba(70,170,230,.8)');
        x.fillStyle = g; x.fill(); x.lineWidth = 2; x.strokeStyle = 'rgba(255,255,255,.9)'; x.stroke();
        x.beginPath(); x.moveTo(0, -h); x.lineTo(-w * 0.2, h * 0.1); x.lineTo(-w, -h * 0.4); x.closePath(); x.fillStyle = 'rgba(255,255,255,.5)'; x.fill();
        x.restore();
      };
      shard(40, 86, 16, 30, -0.35); shard(88, 88, 15, 28, 0.4); shard(64, 70, 22, 46, 0.02); shard(52, 100, 12, 16, -0.9); shard(78, 104, 12, 15, 0.9);
      return cv;
    }),
  };
  /* explosion palettes per kind: [white-hot, mid, edge, smoke] */
  const PAL = {
    fire: ['#fff1b0', '#ff9a3d', '#ff3d1a', '#6e5a50'], big: ['#fff1b0', '#ff9a3d', '#ff3d1a', '#6e5a50'], meteor: ['#fff1b0', '#ff7a2a', '#e0200e', '#64504a'],
    hop: ['#fff1c0', '#ffae4a', '#ff5a2a', '#7a6a60'], small: ['#fff1c0', '#ffae4a', '#ff5a2a', '#7a6a60'],
    overload: ['#ffe0f0', '#ff4d7a', '#a02cff', '#6a5068'], electro: ['#f6e8ff', '#c77dff', '#6a2cff', '#5a5070'],
    hydro: ['#e8f8ff', '#5cc0ff', '#1a6cff', '#40607a'], cryo: ['#ffffff', '#bff4ff', '#4fc8ff', '#8ab4c8'],
    anemo: ['#f0fff8', '#6ff5cf', '#1ab89a', '#5a8a80'], geo: ['#fffbe0', '#ffd24a', '#e08a10', '#5a4a30'], dark: ['#f0d8ff', '#a64dff', '#3a0a6a', '#1a0a24'],
  };

  /* per-colour sprite bundles */
  const setCache = new Map();
  function cset(color, light, dark) {
    const key = color + (light || '') + (dark || '');
    let s = setCache.get(key); if (s) return s;
    const p = parseHex(color) || [255, 255, 255];
    light = light || `#${[p[0], p[1], p[2]].map(v => Math.min(255, Math.round(v + (255 - v) * 0.55)).toString(16).padStart(2, '0')).join('')}`;
    dark = dark || `#${[p[0], p[1], p[2]].map(v => Math.round(v * 0.45).toString(16).padStart(2, '0')).join('')}`;
    s = { color, light, dark, core: MK.core(color), coreL: MK.core(light), soft: MK.soft(color, 0.8), streak: MK.streak(color), star: MK.star(light), shard: MK.shard(light, dark), chip: MK.chip(color, dark) };
    setCache.set(key, s); return s;
  }
  function elset(el) { const E = G.EL[el] || G.EL.physical; return cset(E.color, E.light, E.dark); }

  /* ======================= particles (struct of arrays) ======================= */
  const PMAX = G.cfg.maxParticles || 1800;
  const px = new Float32Array(PMAX), py = new Float32Array(PMAX), pvx = new Float32Array(PMAX), pvy = new Float32Array(PMAX);
  const pt = new Float32Array(PMAX), pl = new Float32Array(PMAX), ps = new Float32Array(PMAX), ps1 = new Float32Array(PMAX);
  const pdr = new Float32Array(PMAX), pgr = new Float32Array(PMAX), pr = new Float32Array(PMAX), pvr = new Float32Array(PMAX);
  const pa = new Float32Array(PMAX), pw = new Float32Array(PMAX);
  const psp = new Uint16Array(PMAX), pk = new Uint8Array(PMAX), padd = new Uint8Array(PMAX);
  let np = 0;
  const K_GLOW = 0, K_STREAK = 1, K_ROT = 2, K_WISP = 3, K_SMOKE = 4;

  /** low-level emit. returns index or -1 */
  function P(kind, sp, add, x, y, vx, vy, life, size, size1, drag, grav, alpha) {
    if (np >= PMAX) return -1;
    const i = np++;
    pk[i] = kind; psp[i] = sp; padd[i] = add; px[i] = x; py[i] = y; pvx[i] = vx; pvy[i] = vy; pt[i] = 0; pl[i] = life > 0.01 ? life : 0.01;
    ps[i] = size; ps1[i] = size1; pdr[i] = drag; pgr[i] = grav; pa[i] = alpha; pr[i] = rnd() * TAU; pvr[i] = 0; pw[i] = 0;
    return i;
  }
  function pkill(i) {
    const j = --np; if (i === j) return;
    pk[i] = pk[j]; psp[i] = psp[j]; padd[i] = padd[j]; px[i] = px[j]; py[i] = py[j]; pvx[i] = pvx[j]; pvy[i] = pvy[j]; pt[i] = pt[j]; pl[i] = pl[j];
    ps[i] = ps[j]; ps1[i] = ps1[j]; pdr[i] = pdr[j]; pgr[i] = pgr[j]; pa[i] = pa[j]; pr[i] = pr[j]; pvr[i] = pvr[j]; pw[i] = pw[j];
  }
  /** spray n particles in random directions (optionally within a cone) */
  function spray(n, kind, sp, add, x, y, s0, s1, l0, l1, z0, z1, size1, drag, grav, alpha, ang, cone, up) {
    for (let k = 0; k < n; k++) {
      const a = cone ? ang + rr(-cone, cone) : rnd() * TAU, s = rr(s0, s1);
      const i = P(kind, sp, add, x, y, Math.cos(a) * s, Math.sin(a) * s * 0.8 - (up || 0), rr(l0, l1), rr(z0, z1), size1, drag, grav, alpha);
      if (i < 0) return;
      if (kind === K_ROT) pvr[i] = rr(-14, 14);
    }
  }
  /** particle budget multiplier: shrinks when the pool fills or reducedFx is on */
  function budget() { let m = reduced() ? 0.35 : G.quality && G.quality.level === 0 ? 0.5 : 1; const f = np / PMAX; if (f > 0.8) m *= 0.25; else if (f > 0.55) m *= 0.55; return m; }
  function nn(n, m) { const v = n * m; return (v | 0) + (rnd() < v - (v | 0) ? 1 : 0); }

  /* ======================= generic object pools ======================= */
  function Pool(max, make) { this.list = []; this.free = []; this.max = max; this.make = make; }
  Pool.prototype.get = function () { if (this.list.length >= this.max) return null; const o = this.free.pop() || this.make(); this.list.push(o); return o; };
  Pool.prototype.kill = function (i) { const l = this.list, o = l[i]; l[i] = l[l.length - 1]; l.pop(); o.ref = null; this.free.push(o); };
  Pool.prototype.clear = function () { while (this.list.length) this.kill(this.list.length - 1); };

  /* ---- flipbook sprite sheets ---- */
  function gridRects(cols, rows, cw, ch) { const a = new Float32Array(cols * rows * 4); let k = 0; for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { a[k++] = c * cw; a[k++] = r * ch; a[k++] = cw; a[k++] = ch; } return a; }
  function rowRects(ys, h) { const a = new Float32Array(32); let k = 0; for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { a[k++] = c * 128; a[k++] = ys[r]; a[k++] = 128; a[k++] = h; } return a; }
  const SHEETS = {
    explosion: { img: 'fx_explosion', frames: 8, rects: gridRects(4, 2, 256, 256) },
    embers: { img: 'icon_vfx_embers', frames: 8, rects: rowRects([85, 290], 165) },
    water: { img: 'icon_vfx_water', frames: 8, rects: rowRects([72, 290], 170) },
    wind: { img: 'icon_vfx_wind', frames: 8, rects: rowRects([85, 290], 165) },
    aura: { img: 'icon_enemy_aura', frames: 4, rects: gridRects(2, 2, 256, 256) },
  };
  const EXPL_FILTER = {
    overload: 'hue-rotate(-28deg) saturate(1.35)', electro: 'hue-rotate(245deg) saturate(1.2) brightness(1.1)',
    hydro: 'hue-rotate(185deg) saturate(1.1)', cryo: 'hue-rotate(165deg) saturate(0.55) brightness(1.45)',
    anemo: 'hue-rotate(125deg) saturate(0.9) brightness(1.2)', geo: 'hue-rotate(18deg) saturate(1.1) brightness(1.2)',
    dark: 'hue-rotate(250deg) saturate(0.8) brightness(0.55)',
  };
  const anims = new Pool(110, () => ({ sheet: null, img: null, x: 0, y: 0, w: 0, h: 0, t: 0, dur: 0.5, rot: 0, a: 1, add: 0, flip: 1, vy: 0, ref: null }));
  function anim(name, x, y, size, dur, o) {
    const sh = SHEETS[name]; if (!sh) return null;
    const a = anims.get(); if (!a) return null;
    a.sheet = sh; a.img = o && o.filter ? o.filter : null;
    a.x = x; a.y = y; a.w = size; a.h = size * sh.rects[3] / sh.rects[2]; a.t = -(o && o.delay || 0); a.dur = dur || 0.5;
    a.rot = o && o.rot != null ? o.rot : 0; a.a = o && o.alpha != null ? o.alpha : 1; a.add = o && o.add ? 1 : 0; a.flip = o && o.flip ? -1 : 1; a.vy = o && o.vy || 0;
    return a;
  }

  /* ---- world effects (rings, bolts, pillars, …) ---- */
  const E_RING = 1, E_SHOCK = 2, E_FLASH = 3, E_BLOOM = 4, E_BOLT = 5, E_TRAIL = 6, E_PILLAR = 7, E_RAYS = 8, E_SPIRAL = 9, E_SHIELD = 10, E_CORPSE = 11, E_DARK = 12, E_GROUNDGLOW = 13;
  const E_FIREBALL = 14, E_GLINT = 15, E_ICE = 16, E_HEAT = 17, E_TORNADO = 18;
  const effs = new Pool(700, () => ({ type: 0, x: 0, y: 0, x2: 0, y2: 0, vx: 0, vy: 0, r: 0, w: 0, t: 0, life: 1, color: '#fff', spr: 0, rot: 0, vr: 0, a: 1, n: 0, bn: 0, pts: new Float32Array(48), jit: 0, ref: null, face: { x: 0, y: 1 }, st: 'walk', at: 0, h: 0, filter: null, atlas: null }));
  function eff(type, x, y, r, color, life) {
    const e = effs.get(); if (!e) return null;
    e.type = type; e.x = x; e.y = y; e.r = r; e.color = color || '#fff'; e.t = 0; e.life = life || 0.4; e.w = 0.12; e.a = 1; e.rot = 0; e.vr = 0; e.n = 0; e.bn = 0; e.jit = 0; e.vx = 0; e.vy = 0;
    return e;
  }
  let heatN = 0; // live heat-distortion rings (self-copy of the canvas: keep ≤ 1)
  function heat(x, y, r, life) {
    // canvas self-copy: desktop full-quality only, one at a time, and never while the frame rate is already strained
    if (reduced() || heatN >= 1 || !G.quality || G.quality.level < 3 || (G.fps || 60) < 50 || (G.input && G.input.touchMode)) return;
    const e = eff(E_HEAT, x, y, r, '#fff', life || 0.45); if (e) heatN++;
  }
  function glint(x, y, s, color, life) { const e = eff(E_GLINT, x, y, s, color || '#fff6c8', life || 0.28); if (e) { e.spr = MK.flare(color || '#fff6c8'); e.rot = rr(-0.3, 0.3); } return e; }
  /** chromatic-aberration style edge fringe pulse (screen space) */
  let aberr = 0;
  function aberration(a) { if (!reduced()) aberr = Math.min(1, Math.max(aberr, a)); }
  const decals = new Pool(70, () => ({ x: 0, y: 0, r: 1, t: 0, life: 6, spr: 0, rot: 0, glow: 0, color: '#ff8a3d', ref: null }));

  /* ---- delayed real-time callbacks (boss death chains etc.) ---- */
  const timers = [];
  function later(t, fn) { timers.push({ t, fn }); }

  /* ======================= camera feel: shake / hitstop / slowmo / punch ======================= */
  let trauma = 0, pendTrauma = 0, kickX = 0, kickY = 0;
  let hitstopT = 0, hitstopCool = 0, slowScale = 1, slowT = 0;
  let flashA = 0, flashColor = '#fff', hurtA = 0, boomLoad = 0, lastLvl = -9, lastRevive = -9, lastCut = -9, lastHeal = -9;
  const shakeOut = { x: 0, y: 0 };
  function hash1(i) { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return (s - Math.floor(s)) * 2 - 1; }
  function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); const a = hash1(i), b = hash1(i + 1); return a + (b - a) * u; }
  function shakeMul() { const s = settings().screenShake; return s === false ? 0 : s === true || s == null ? 1 : +s || 0; }

  api.shake = a => { pendTrauma += (a || 0.3) * 0.5; };
  api.kick = (dx, dy, pxAmt) => { const m = shakeMul(); if (!m) return; const l = Math.hypot(dx, dy) || 1; kickX += dx / l * (pxAmt || 8) * m; kickY += dy / l * (pxAmt || 8) * m; };
  api.shakeOffset = () => {
    const m = shakeMul() * (reduced() ? 0.6 : 1);
    const amt = trauma * trauma * 26 * m, t = G.time * 16;
    shakeOut.x = noise1(t) * amt + kickX; shakeOut.y = noise1(t + 57.3) * amt + kickY;
    return shakeOut;
  };
  api.hitstop = t => { if (hitstopCool > 0 && hitstopT <= 0) return; hitstopT = Math.min(0.08, Math.max(hitstopT, t || 0.04)); };
  api.hitstopActive = () => hitstopT > 0;
  api.slowmo = (scale, dur) => {
    scale = Math.max(0.05, Math.min(1, scale == null ? 0.3 : scale)); dur = dur == null ? 0.4 : dur;
    if (slowT > 0) { slowScale = Math.min(slowScale, scale); slowT = Math.max(slowT, dur); } else { slowScale = scale; slowT = dur; }
  };
  api.zoomPunch = a => { const c = G.view.cam; c.punch = Math.min(0.14, Math.max(c.punch || 0, a == null ? 0.04 : a)); };
  api.flash = (color, a) => { flashColor = color || '#fff'; flashA = Math.min(reduced() ? 0.3 : 0.75, Math.max(flashA, a == null ? 0.5 : a)); };
  api.hurtFlash = a => { hurtA = Math.min(1, Math.max(hurtA, 0.4 + (a || 0) * 0.6)); };

  /* ======================= public spawners ======================= */
  const imgSpr = new Map();
  /** generic particle (compat). o: {x,y,vx,vy,life,size,color,glow,drag,grav,shrink,img,rot,vr,streak,additive,alpha,grow} */
  api.particle = o => {
    if (!o) return;
    let sp, kind = K_GLOW, add = 1;
    if (o.img) { sp = imgSpr.get(o.img); if (sp === undefined) { sp = SPR.length; SPR.push(o.img); imgSpr.set(o.img, sp); } kind = K_ROT; add = o.additive ? 1 : 0; }
    else if (o.streak) { sp = cset(o.color || '#fff').streak; kind = K_STREAK; }
    else if (o.smoke) { sp = MK.soft(o.color || '#888888', 0.7); kind = K_SMOKE; add = 0; }
    else sp = cset(o.color || '#fff').core;
    const i = P(kind, sp, add, o.x, o.y, o.vx || 0, o.vy || 0, o.life || 0.5, o.size || 0.15, o.grow || (o.shrink === false ? 1 : 0.2), o.drag == null ? 3 : o.drag, o.grav || 0, o.alpha == null ? 1 : o.alpha);
    if (i >= 0) { if (o.rot != null) pr[i] = o.rot; if (o.vr) pvr[i] = o.vr; }
  };
  /** radial burst of glowing particles. opts {min,max,life,size,grav,up,streak,stars,cone,angle} */
  api.burst = (x, y, n, color, opts) => {
    opts = opts || {}; const c = cset(color || '#fff'); n = nn(n || 8, budget());
    const kind = opts.streak ? K_STREAK : K_GLOW, sp = opts.streak ? c.streak : opts.stars ? c.star : c.core;
    spray(n, kind, sp, 1, x, y, opts.min || 2, opts.max || 7, 0.25, opts.life || 0.6, 0.06, opts.size || 0.18, 0.2, 3, opts.grav || 0, 1, opts.angle || 0, opts.cone || 0, opts.up || 0);
  };

  function bolt(x1, y1, x2, y2, color, w, life, branch) {
    const e = eff(E_BOLT, x1, y1, 0, color || '#c77dff', life || 0.2); if (!e) return null;
    e.x2 = x2; e.y2 = y2; e.w = w || 0.12; e.bn = branch ? 1 : 0; genBolt(e); return e;
  }
  function genBolt(e) {
    const x1 = e.x, y1 = e.y, dx = e.x2 - x1, dy = e.y2 - y1, L = Math.hypot(dx, dy) || 0.01, nx = -dy / L, ny = dx / L, P2 = e.pts;
    const n = Math.max(3, Math.min(14, Math.round(L * 2.4))); e.n = n; const amp = Math.min(0.85, L * 0.14);
    for (let i = 0; i <= n; i++) { const f = i / n, off = i === 0 || i === n ? 0 : (rnd() * 2 - 1) * amp * Math.sqrt(Math.sin(Math.PI * f)); P2[i * 2] = x1 + dx * f + nx * off; P2[i * 2 + 1] = y1 + dy * f + ny * off; }
    if (e.bn) {
      const bi = Math.max(1, Math.floor(n * rr(0.3, 0.6))), base = (n + 1) * 2; let bx = P2[bi * 2], by = P2[bi * 2 + 1];
      const ang = Math.atan2(dy, dx) + (rnd() < 0.5 ? -1 : 1) * rr(0.4, 0.9), bl = L * rr(0.2, 0.35) / 4;
      for (let j = 0; j < 5; j++) { P2[base + j * 2] = bx; P2[base + j * 2 + 1] = by; const a2 = ang + rr(-0.6, 0.6); bx += Math.cos(a2) * bl; by += Math.sin(a2) * bl; }
      e.bn = 5;
    }
  }

  /** element-flavoured impact spark */
  api.hitSpark = (x, y, el, big) => {
    const m = budget(); if (m < 0.3 && !big && rnd() < 0.5) return;
    const c = elset(el);
    P(K_GLOW, c.core, 1, x, y, 0, 0, big ? 0.12 : 0.08, big ? 1.0 : 0.55, 1.7, 0, 0, 1);
    switch (el) {
      case 'pyro':
        spray(nn(big ? 8 : 4, m), K_STREAK, c.streak, 1, x, y, 6, 13, 0.14, 0.3, 0.1, 0.17, 0.3, 5, 0, 1);
        spray(nn(big ? 5 : 2, m), K_GLOW, c.coreL, 1, x, y, 0.5, 2.5, 0.35, 0.7, 0.06, 0.11, 0.3, 1.5, -4, 1, 0, 0, 1.5);
        if (big && !reduced()) anim('embers', x, y + 0.2, 1.7, 0.42, { rot: rr(-0.3, 0.3), flip: rnd() < 0.5 });
        break;
      case 'hydro':
        spray(nn(big ? 9 : 5, m), K_GLOW, c.coreL, 1, x, y, 2, 5, 0.3, 0.55, 0.07, 0.13, 0.6, 1.2, 22, 1, -Math.PI / 2, 1.3, 3);
        if (big && !reduced()) anim('water', x, y + 0.25, 1.6, 0.5, { flip: rnd() < 0.5 });
        break;
      case 'cryo':
        spray(nn(big ? 7 : 4, m), K_ROT, c.shard, 0, x, y, 4, 9, 0.3, 0.55, 0.11, 0.19, 0.5, 3, 12, 1, 0, 0, 3);
        P(K_GLOW, c.star, 1, x + rr(-0.2, 0.2), y + rr(-0.2, 0.2), 0, 0, 0.3, big ? 0.7 : 0.45, 0.2, 0, 0, 1);
        break;
      case 'electro':
        for (let k = 0; k < (big ? 3 : 2); k++) { const a = rnd() * TAU, L = rr(0.5, big ? 1.4 : 0.9); bolt(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, c.color, 0.06, 0.12, false); }
        spray(nn(big ? 5 : 2, m), K_STREAK, c.streak, 1, x, y, 5, 10, 0.1, 0.2, 0.07, 0.12, 0.3, 5, 0, 1);
        break;
      case 'anemo': {
        const n = nn(big ? 8 : 5, m);
        for (let k = 0; k < n; k++) { const a = rnd() * TAU, s = rr(3, 6), i = P(K_STREAK, c.streak, 1, x + Math.cos(a) * 0.3, y + Math.sin(a) * 0.3, -Math.sin(a) * s + Math.cos(a) * 1.5, Math.cos(a) * s + Math.sin(a) * 1.5, rr(0.2, 0.38), rr(0.08, 0.13), 0.4, 3, 0, 1); if (i < 0) break; }
        if (big && !reduced()) anim('wind', x, y + 0.2, 1.8, 0.45, { rot: rr(-0.5, 0.5), flip: rnd() < 0.5 });
        break;
      }
      case 'geo':
        spray(nn(big ? 7 : 4, m), K_ROT, c.chip, 0, x, y, 3, 8, 0.35, 0.6, 0.1, 0.17, 0.6, 2.5, 16, 1, 0, 0, 3.5);
        P(K_GLOW, c.star, 1, x, y, 0, 0, 0.22, big ? 0.8 : 0.5, 0.3, 0, 0, 1);
        break;
      default:
        spray(nn(big ? 6 : 3, m), K_STREAK, c.streak, 1, x, y, 6, 12, 0.1, 0.22, 0.08, 0.13, 0.3, 5, 0, 1);
    }
  };

  /** big explosion: flash core + sprite frames + shockwave + debris + scorch + light bloom */
  api.explosion = (x, y, r, o) => {
    o = o || {}; r = r || 2;
    const kind = o.kind || 'fire', col = o.color || '#ff8a3d', c = cset(col);
    boomLoad += 1; const crowd = boomLoad > 5, m = budget() * (crowd ? 0.45 : 1), big = r >= 4.5 && !crowd, red = reduced();
    // visual radius is capped so chains of huge blasts never white-out the arena (damage radius is untouched)
    const vr = Math.min(r, crowd ? 3.2 : 5.2), pal = PAL[kind] || [cset(col).light, col, cset(col).dark, '#3a302a'];
    const cy = y - vr * 0.22, fade = crowd ? 0.6 : 1;
    // 1) white flash
    let e = eff(E_FLASH, x, cy, vr * 0.55, col, 0.1); if (e) { e.spr = MK.core('#fff8e8'); e.a = fade; }
    // 2) additive multi-layer fireball: outer mid-colour ball + white-hot inner ball
    e = eff(E_FIREBALL, x, cy, vr * 1.05, col, crowd ? 0.38 : 0.55); if (e) { e.spr = MK.fireball(pal[1], pal[2]); e.rot = rnd() * TAU; e.vr = rr(-1.5, 1.5); e.a = 0.95 * fade; }
    if (!crowd) { e = eff(E_FIREBALL, x + rr(-0.1, 0.1) * vr, cy - vr * 0.08, vr * 0.62, col, 0.32); if (e) { e.spr = MK.fireball(pal[0], pal[1]); e.rot = rnd() * TAU; e.vr = rr(-3, 3); } }
    // 3) hand-drawn flipbook as a softened additive fire texture (never an opaque pixel blob)
    anim('explosion', x, cy - vr * 0.05, Math.min(vr * 2.3, 9), big ? 0.62 : 0.5, { filter: explFilter(kind), rot: rr(-0.3, 0.3), flip: rnd() < 0.5, add: true, alpha: 0.8 * fade });
    if (big && !red) anim('explosion', x + rr(-0.3, 0.3) * vr, cy + rr(-0.2, 0.2) * vr, vr * 1.4, 0.45, { filter: explFilter(kind), delay: 0.08, flip: true, add: true, alpha: 0.7 });
    // 4) light bloom on the ground + around
    e = eff(E_BLOOM, x, y - vr * 0.1, vr * 2, col, crowd ? 0.3 : 0.45); if (e) { e.spr = c.soft; e.a = crowd ? 0.2 : 0.32; }
    e = eff(E_GROUNDGLOW, x, y, vr * 1.25, col, crowd ? 0.5 : 0.8); if (e) { e.spr = MK.soft(pal[2], 0.9); e.a = 0.45 * fade; }
    // 5) shockwave rings (+ heat distortion ripple on big ones)
    e = eff(E_SHOCK, x, y, vr * 1.3, pal[1], crowd ? 0.3 : 0.42); if (e) e.w = Math.min(0.32, vr * 0.07);
    if (!crowd) { e = eff(E_RING, x, y, vr * 1.7, '#ffffff', 0.5); if (e) { e.w = 0.06; e.t = -0.05; } }
    if (big || (vr >= 3.2 && !crowd && boomLoad < 2.5)) heat(x, y, vr * 1.5, 0.5);
    // 6) sparks (fast streaks), embers (rising, flickering), debris, smoke column
    const ec = cset(pal[1]);
    spray(nn(crowd ? 8 : 16, m), K_STREAK, ec.streak, 1, x, cy, vr * 3.5, vr * 8, 0.2, 0.45, 0.1, 0.2, 0.3, 3.5, 0, 1);
    for (let k = 0, n = nn(crowd ? 5 : 12, m); k < n; k++) { const i = P(K_WISP, ec.coreL, 1, x + rr(-0.6, 0.6) * vr, cy + rr(-0.4, 0.3) * vr, rr(-1.5, 1.5), rr(-1.5, -4.5), rr(0.7, 1.5), rr(0.05, 0.1), 0.3, 1.2, -1.5, 1); if (i < 0) break; pw[i] = rr(0.08, 0.25); }
    if (!crowd) spray(nn(5, m), K_ROT, MK.chip('#3a2a20', '#140a04'), 0, x, cy, vr * 2, vr * 4, 0.4, 0.7, 0.06, 0.12, 0.7, 1.8, 18, 1, 0, 0, 5);
    if (!red) {
      const sp = MK.puff(pal[3]), ns = nn(crowd ? 2 : big ? 8 : 5, m);
      for (let k = 0; k < ns; k++) { const a = rnd() * TAU, d = rr(0.1, 0.55) * vr; const i = P(K_SMOKE, sp, 0, x + Math.cos(a) * d, cy + Math.sin(a) * d * 0.6, Math.cos(a) * rr(0.3, 1.2), rr(-0.8, -2), rr(1.1, 2.1), vr * rr(0.22, 0.34), 2.1, 1.2, -0.5, 0.36); if (i < 0) break; pvr[i] = rr(-1, 1); }
    }
    if (kind === 'overload' || kind === 'electro') for (let k = 0; k < (crowd ? 1 : 4); k++) { const a = rnd() * TAU, L = vr * rr(0.8, 1.4); bolt(x, cy, x + Math.cos(a) * L, cy + Math.sin(a) * L * 0.75, kind === 'overload' ? '#ff6ad5' : '#c77dff', 0.1, 0.22, true); }
    // 7) scorch mark with glowing embers that cools down over time
    const d = decals.get(); if (d) { d.x = x; d.y = y; d.r = vr * 0.85; d.t = 0; d.life = crowd ? 5 : 9; d.spr = MK.scorch(Math.floor(rnd() * 3)); d.rot = rnd() * TAU; d.glow = MK.core(pal[1]); }
    api.shake(Math.min(1.1, (crowd ? 0.12 : 0.3) + r * 0.07));
    if (big) { api.zoomPunch(Math.min(0.07, 0.02 + r * 0.005)); aberration(0.5); }
  };
  /** light cosmetic blast for very frequent hits (evolved arrows, bomb splash): no decal / shake / smoke */
  api.boom = (x, y, r, o) => {
    r = Math.min(r || 1.5, 4); const col = (o && o.color) || '#ff8a3d', kind = (o && o.kind) || 'small', pal = PAL[kind] || PAL.small;
    boomLoad += 0.35; const crowd = boomLoad > 5, m = budget() * (crowd ? 0.4 : 1), cy = y - r * 0.2;
    let e = eff(E_FIREBALL, x, cy, r * 0.95, col, crowd ? 0.3 : 0.42); if (e) { e.spr = MK.fireball(pal[1], pal[2]); e.rot = rnd() * TAU; e.vr = rr(-2, 2); e.a = crowd ? 0.6 : 0.9; }
    if (!crowd) anim('explosion', x, cy, r * 2.1, (o && o.life) || 0.42, { filter: explFilter(kind), rot: rr(-0.3, 0.3), flip: rnd() < 0.5, add: true, alpha: 0.75 });
    e = eff(E_SHOCK, x, y, r * 1.15, pal[1], 0.3); if (e) e.w = Math.min(0.2, r * 0.06);
    spray(nn(crowd ? 3 : 7, m), K_STREAK, cset(pal[1]).streak, 1, x, cy, r * 3, r * 7, 0.15, 0.32, 0.08, 0.15, 0.3, 4, 0, 1);
  };
  const explFilterCache = {};
  function explFilter(kind) { let f = explFilterCache[kind]; if (f === undefined) f = explFilterCache[kind] = (EXPL_FILTER[kind] ? EXPL_FILTER[kind] + ' ' : '') + 'blur(1.6px) saturate(1.25)'; return f; }

  api.ring = (x, y, r, color) => {
    let e = eff(E_RING, x, y, r || 2, color || '#fff', 0.45); if (e) e.w = 0.2;
    e = eff(E_RING, x, y, (r || 2) * 0.8, '#ffffff', 0.35); if (e) { e.w = 0.07; e.t = -0.04; }
    e = eff(E_BLOOM, x, y, (r || 2) * 1.2, color || '#fff', 0.35); if (e) { e.spr = cset(color || '#fff').soft; e.a = 0.5; }
  };
  api.shockwave = (x, y, r, color) => { const e = eff(E_SHOCK, x, y, r || 3, color || '#fff', 0.45); if (e) e.w = Math.min(0.9, (r || 3) * 0.12); };

  let lastTornado = -9;
  api.swirl = (x, y, r, color) => {
    r = r || 3; color = color || G.EL.anemo.color; const c = cset(color), a = elset('anemo'), m = budget();
    let e = eff(E_SPIRAL, x, y, r, color, 0.6); if (e) { e.rot = rnd() * TAU; e.w = 0.26; }
    e = eff(E_BLOOM, x, y, r * 1.3, color, 0.45); if (e) { e.spr = c.soft; e.a = 0.6; }
    if (G.time - lastTornado > 0.25) { lastTornado = G.time; e = eff(E_TORNADO, x, y, Math.min(r, 3.5) * 0.45, color, 0.65); if (e) { e.rot = rnd() * TAU; e.spr = c.streak; } }
    if (!reduced()) { anim('wind', x - r * 0.1, y, r * 1.5, 0.5, { rot: rr(-0.4, 0.4) }); anim('wind', x + r * 0.1, y, r * 1.2, 0.5, { rot: Math.PI + rr(-0.4, 0.4), delay: 0.06, alpha: 0.8 }); }
    const n = nn(16, m);
    for (let k = 0; k < n; k++) {
      const ang = rnd() * TAU, d = rr(0.3, r * 0.8), s = rr(4, 8);
      const i = P(K_STREAK, k & 1 ? c.streak : a.streak, 1, x + Math.cos(ang) * d, y + Math.sin(ang) * d * 0.75, -Math.sin(ang) * s + Math.cos(ang) * 2, (Math.cos(ang) * s + Math.sin(ang) * 2) * 0.75, rr(0.3, 0.55), rr(0.1, 0.16), 0.3, 2.5, 0, 1);
      if (i < 0) break;
    }
  };
  api.lightning = (x1, y1, x2, y2, color) => {
    color = color || '#c77dff';
    bolt(x1, y1, x2, y2, color, 0.13, 0.24, true);
    const c = cset(color);
    P(K_GLOW, c.core, 1, x2, y2, 0, 0, 0.18, 0.9, 1.4, 0, 0, 1);
    P(K_GLOW, c.core, 1, x1, y1, 0, 0, 0.14, 0.6, 1.2, 0, 0, 0.8);
    spray(nn(4, budget()), K_STREAK, c.streak, 1, x2, y2, 5, 10, 0.1, 0.2, 0.07, 0.12, 0.3, 5, 0, 1);
  };
  api.zap = (x, y, color) => {
    color = color || '#d59bff'; const c = cset(color);
    for (let k = 0; k < 2; k++) { const a = rnd() * TAU, L = rr(0.6, 1.3); bolt(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L, color, 0.07, 0.15, false); }
    P(K_GLOW, c.core, 1, x, y, 0, 0, 0.16, 0.7, 1.3, 0, 0, 1);
  };
  api.trail = (x1, y1, x2, y2, color, w) => {
    if (effs.list.length > 520) return;
    const e = eff(E_TRAIL, x1, y1, 0, color || '#ffb347', 0.14); if (!e) return;
    e.x2 = x2; e.y2 = y2; e.w = w || 0.18; e.spr = cset(color || '#ffb347').streak;
  };
  api.beam = (x1, y1, x2, y2, color, w, life) => {
    const e = eff(E_TRAIL, x1, y1, 0, color || '#fff', life || 0.3); if (!e) return;
    e.x2 = x2; e.y2 = y2; e.w = w || 0.5; e.spr = cset(color || '#fff').streak;
  };
  api.pillar = (x, y, color, h, w, life) => {
    const e = eff(E_PILLAR, x, y, h || 8, color || '#ffd24a', life || 1); if (!e) return;
    e.w = w || 2.2; e.spr = MK.pillar(color || '#ffd24a');
  };
  api.rays = (x, y, r, color, life) => {
    const e = eff(E_RAYS, x, y, r || 5, color || '#ffe9a8', life || 0.9); if (!e) return;
    e.spr = MK.rays(color || '#ffe9a8'); e.rot = rnd() * TAU; e.vr = rr(0.3, 0.6) * (rnd() < 0.5 ? -1 : 1);
  };
  api.sparkle = (x, y, color, n, r) => {
    const c = cset(color || '#ffe9a8'); n = nn(n || 10, budget()); r = r || 1;
    for (let k = 0; k < n; k++) { const i = P(K_WISP, c.star, 1, x + rr(-r, r), y + rr(-r * 0.6, r * 0.3), rr(-0.5, 0.5), rr(-1.5, -4), rr(0.6, 1.2), rr(0.18, 0.32), 0.1, 1.2, 0, 1); if (i >= 0) pw[i] = rr(0.05, 0.2); }
  };
  api.flipbook = (name, x, y, size, dur, o) => anim(name, x, y, size, dur, o);
  /** dust puff at feet (movement) */
  api.dust = (x, y, dx, dy, n) => {
    if (reduced()) return; const m = budget(); n = nn(n || 2, m);
    for (let k = 0; k < n; k++) P(K_SMOKE, MK.soft('#e8dcb8', 0.6), 0, x + rr(-0.2, 0.2), y + rr(-0.05, 0.1), -(dx || 0) * rr(0.5, 1.5) + rr(-0.6, 0.6), -(dy || 0) * rr(0.3, 1) - rr(0.2, 0.7), rr(0.35, 0.6), rr(0.14, 0.22), 2.6, 3, 0, 0.5);
  };
  /** small rising element motes (auras, burning ground …) */
  api.mote = (x, y, color, size) => { const c = cset(color || '#ffb347'); const i = P(K_WISP, c.core, 1, x, y, rr(-0.3, 0.3), rr(-0.8, -2), rr(0.5, 1), size || rr(0.07, 0.12), 0.2, 0.6, 0, 1); if (i >= 0) pw[i] = rr(0.05, 0.15); };
  /** black-purple enemy-attack impact burst */
  api.darkBurst = (x, y, r) => {
    r = r || 1.5; const e = eff(E_DARK, x, y, r, '#9b4dff', 0.55); if (e) e.rot = rnd() * TAU;
    anim('aura', x, y - r * 0.2, r * 2.6, 0.45, { rot: rr(-0.4, 0.4) });
    const c = cset('#b36bff'), m = budget();
    spray(nn(8, m), K_STREAK, c.streak, 1, x, y, 3, 8, 0.2, 0.4, 0.08, 0.14, 0.3, 3, 0, 1);
    spray(nn(5, m), K_ROT, MK.shard('#2a1038', '#0a0010'), 0, x, y, 2, 6, 0.4, 0.7, 0.1, 0.18, 0.6, 2, 14, 1, 0, 0, 3);
    api.shake(0.2);
  };

  /* ======================= deaths ======================= */
  const kb = { n: 0, t: 0, sx: 0, sy: 0, cool: 0 }; // multi-kill window
  let killFrame = 0; // deaths this frame (hordes → cheaper pops)
  api.death = e => {
    if (!e || !e.def) return;
    const def = e.def, h = def.h || 2, cx = e.x, cy = e.y - h * 0.45;
    const now = G.run ? G.run.time : 0;
    // the pop takes the colour of the element that landed the killing blow (Amber → pyro orange), else the foe's own
    const kel = e._fxEl && e._fxEl !== 'physical' && G.EL[e._fxEl] ? e._fxEl : null;
    const col = kel ? G.EL[kel].color : def.element ? G.EL[def.element].color : e.aura && e.aura.until > now ? G.EL[e.aura.el].color : '#ffe2b0';
    const c = kel ? elset(kel) : cset(col), m = budget();
    kb.n++; kb.sx += e.x; kb.sy += e.y; killFrame++;
    const lite = killFrame > 6 || m < 0.3;            // many deaths in one frame: keep each pop cheap
    const small = h < 1.5, heavy = !e.elite && !e.boss && (h >= 2.3 || e.champion), crit = !!e._fxCrit;
    // corpse: normal foes are blown away spinning & dissolve into light; elites/bosses squash in place
    const fly = !e.elite && !e.boss && effs.list.length < 560;
    let dx = 0, dy = 0;
    if (fly) { const p = G.run && G.run.player; dx = p ? e.x - p.x : rr(-1, 1); dy = p ? e.y - p.y : rr(-1, 1); const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l; }
    if (effs.list.length < 600) {
      const k = eff(E_CORPSE, e.x, e.y, 0, col, e.boss ? 0.5 : e.elite ? 0.3 : 0.26);
      if (k) {
        k.atlas = def.atlas; k.filter = def.filter || null; k.h = h; k.face.x = e.face ? e.face.x : 0; k.face.y = e.face ? e.face.y : 1; k.st = e.anim ? e.anim.state : 'walk'; k.at = e.anim ? e.anim.t : 0;
        if (fly) { const s = rr(5, 8) * (heavy ? 0.6 : 1) * (crit ? 1.3 : 1); k.vx = dx * s; k.vy = dy * s * 0.8 - 1.5; k.vr = rr(6, 11) * (dx < 0 ? -1 : 1); }
      }
    }
    if (fly) {
      const ang = Math.atan2(dy, dx);
      // light shards bursting out along the blow direction + a small element-tinted pop
      spray(nn(lite ? 3 : 5, m), K_STREAK, c.streak, 1, cx, cy, 5, 11, 0.16, 0.3, 0.07, 0.12, 0.3, 4, 0, 1, ang, 0.9);
      if (!lite) {
        // "はじけ": white-hot pop → element-coloured crystal shards tumbling out with gravity + a thin pop ring
        let f = eff(E_FLASH, cx, cy, h * (small ? 0.42 : 0.55) * (crit ? 1.35 : 1), col, 0.11); if (f) f.spr = c.coreL;
        spray(nn(small ? 3 : heavy ? 7 : 5, m), K_ROT, c.shard, 0, cx, cy, 3, 8, 0.35, 0.6, 0.1, 0.17, 0.45, 2.2, 13, 1, ang, 1.5, 3);
        f = eff(E_RING, e.x, e.y - 0.05, h * (heavy ? 1.0 : 0.7), col, 0.24); if (f) f.w = heavy ? 0.2 : 0.14;
        if (effs.list.length < 320) { const b = eff(E_BLOOM, cx, cy, h * 0.6, col, 0.24); if (b) { b.spr = c.soft; b.a = 0.6; } }
        if (crit || heavy) glint(cx, cy + 0.5, heavy ? 1.5 : 1.1, c.light, 0.24);
      }
    }
    // soul wisps + element bits + dust
    const ws = cset('#d8fff4');
    const nw = e.boss ? 14 : e.elite ? 6 : lite ? 0 : nn(1.2, m);
    for (let k = 0; k < nw; k++) { const i = P(K_WISP, ws.core, 1, cx + rr(-0.3, 0.3), cy + rr(-0.3, 0.3), rr(-0.4, 0.4), rr(-1.4, -2.6), rr(0.8, 1.3), rr(0.16, 0.26), 0.5, 0.6, 0, 0.9); if (i >= 0) pw[i] = rr(0.15, 0.3); }
    spray(nn(e.elite || e.boss ? 26 : lite ? 3 : 7, m), K_GLOW, c.core, 1, cx, cy, 2, e.elite ? 9 : 6, 0.3, 0.6, 0.07, 0.14, 0.2, 3, 4, 1, 0, 0, 2);
    if (!lite) spray(nn(2, m), K_SMOKE, MK.soft('#d9c9a0', 0.5), 0, e.x, e.y - 0.2, 0.3, 1.2, 0.45, 0.7, 0.3, 0.45, 2.6, 2.5, -0.5, 0.45);
    if (def.ai === 'hopper' && !lite) spray(nn(5, m), K_GLOW, c.coreL, 1, cx, cy + 0.2, 2, 5, 0.3, 0.5, 0.08, 0.14, 0.5, 1.2, 20, 1, -Math.PI / 2, 1.2, 3);
    if (e.boss) return bossDeath(e, col);
    if (e.elite) {
      // heavy: longer freeze, slow-mo, flash, big punch
      api.slowmo(0.25, 0.4); api.flash('#fff6e0', 0.32); api.hitstop(0.08); aberration(0.55); glint(cx, cy + 0.5, 2.8, '#fff6c8', 0.45);
      api.rays(cx, cy, 5.5, '#ffe9a8', 0.8); api.ring(e.x, e.y, 4, col); later(0.08, () => api.ring(e.x, e.y, 6, '#ffffff'));
      let g = eff(E_GROUNDGLOW, e.x, e.y, 3.2, col, 0.7); if (g) g.spr = MK.soft(col, 0.9);
      api.sparkle(cx, cy, '#ffe9a8', 18, 1.3);
      spray(nn(12, m), K_ROT, c.shard, 0, cx, cy, 4, 11, 0.5, 0.9, 0.16, 0.28, 0.5, 2, 14, 1, 0, 0, 4);
      api.shake(0.9); api.zoomPunch(0.06);
      return;
    }
    // light feel for the small fry, a meatier thump for big bodies (shake is budgeted so hordes never turn to jelly)
    if (heavy) { if (trauma < 0.4) api.shake(0.2); api.hitstop(0.03); }
    else if (killFrame <= 2 && trauma < 0.18) api.shake(small ? 0.035 : 0.06);
  };
  function bossDeath(e, col) {
    const x = e.x, y = e.y - e.def.h * 0.45, kind = e.def.element || 'fire';
    api.slowmo(0.2, 2.0); api.shake(1); api.flash('#ffffff', 0.6); api.zoomPunch(0.09); api.hitstop(0.08);
    api.rays(x, y, 7, '#ffffff', 1.2);
    for (let i = 0; i < 7; i++) later(0.12 + i * 0.14, () => api.explosion(x + rr(-1.6, 1.6), y + rr(-1.2, 1.2), rr(1.8, 3), { kind: EXPL_FILTER[kind] ? kind : 'fire', color: col }));
    later(1.15, () => {
      api.explosion(x, y + 0.6, 7, { kind: EXPL_FILTER[kind] ? kind : 'fire', color: col });
      api.rays(x, y, 12, '#ffe9a8', 1.8); api.pillar(x, y + 1, '#ffe9a8', 16, 4, 1.6);
      api.flash('#fff8e0', 0.75); api.shake(1.2); api.zoomPunch(0.12);
      api.sparkle(x, y, '#ffe9a8', 50, 3);
    });
  }

  /* ======================= player-centric moments ======================= */
  api.levelUpBurst = (x, y) => {
    if (G.time - lastLvl < 0.3) return; lastLvl = G.time;
    if (x == null && G.run) { x = G.run.player.x; y = G.run.player.y; }
    api.pillar(x, y + 0.1, '#ff9a1a', 9, 2.4, 1.0);
    const e = eff(E_GROUNDGLOW, x, y, 2.6, '#ff9a1a', 0.9); if (e) e.spr = MK.soft('#ff9a1a', 0.9);
    api.ring(x, y, 3.2, '#ffc23a');
    api.sparkle(x, y - 0.6, '#fff0a8', 26, 1.1);
    api.flash('#ffe8a0', 0.18); api.zoomPunch(0.035);
    // a second, wider soft column + light motes streaming up the beam + an after-ring
    const w = eff(E_PILLAR, x, y + 0.1, 12, '#ffd86a', 1.3); if (w) { w.w = 4.2; w.spr = MK.pillar('#ffd86a'); w.a = 0.5; }
    const st = cset('#fff4c0'), m = budget();
    for (let k = 0, n = nn(18, m); k < n; k++) { const i = P(K_WISP, st.star, 1, x + rr(-0.5, 0.5), y - rr(0, 1.5), rr(-0.3, 0.3), -rr(5, 11), rr(0.6, 1.1), rr(0.16, 0.3), 0.1, 0.8, 0, 1); if (i >= 0) pw[i] = rr(0.1, 0.3); }
    later(0.12, () => { const e2 = eff(E_RING, x, y, 5, '#ffffff', 0.5); if (e2) e2.w = 0.12; });
    glint(x, y - 1, 2, '#fff6c8', 0.35);
  };
  api.revive = (x, y) => {
    if (G.time - lastRevive < 0.5) return; lastRevive = G.time;
    if (x == null && G.run) { x = G.run.player.x; y = G.run.player.y; }
    api.pillar(x, y + 0.1, '#ffb04a', 14, 3.4, 1.5); api.rays(x, y - 1, 7, '#ffd9a0', 1.4);
    api.ring(x, y, 5, '#ffd24a'); later(0.15, () => api.ring(x, y, 7, '#ffffff'));
    api.sparkle(x, y - 0.8, '#fff0a8', 40, 1.6); api.flash('#ffffff', 0.7); api.slowmo(0.3, 0.8); api.shake(0.6);
    api.reactionText(x, y - 2.6, '復活！', '#ffe27a');
  };
  api.healBurst = (x, y) => {
    if (G.time - lastHeal < 0.15) return; lastHeal = G.time;
    const sp = MK.plus('#7dff8a'), m = budget();
    for (let k = 0, n = nn(9, m); k < n; k++) { const i = P(K_WISP, sp, 1, x + rr(-0.8, 0.8), y - rr(0.2, 1.6), 0, rr(-1.2, -2.6), rr(0.6, 1), rr(0.14, 0.22), 0.5, 1, 0, 1); if (i >= 0) pw[i] = rr(0.04, 0.12); }
    api.sparkle(x, y - 0.8, '#b8ffc0', 8, 0.9);
    const e = eff(E_GROUNDGLOW, x, y, 1.9, '#7dff8a', 0.6); if (e) e.spr = MK.soft('#7dff8a', 0.8);
    api.ring(x, y, 1.8, '#7dff8a');
  };
  let shieldCol = '#ffd24a';
  api.shieldHit = (x, y) => {
    const e = eff(E_SHIELD, x, y - 0.95, 1.35, shieldCol, 0.3); if (e) e.spr = MK.hex(shieldCol, cset(shieldCol).light);
    spray(nn(6, budget()), K_ROT, cset(shieldCol).chip, 0, x, y - 0.95, 3, 7, 0.3, 0.5, 0.08, 0.14, 0.5, 2.5, 14, 1, 0, 0, 2);
    api.shake(0.25);
  };
  api.drawShield = (ctx, p) => {
    const t = G.time, r = 1.38, cx = p.x, cy = p.y - 0.95;
    const frac = clamp01(p.shield / Math.max(1, p.shieldMax || p.maxHp * 0.3));
    let a = (0.5 + 0.12 * Math.sin(t * 3)) * (0.45 + 0.55 * frac);
    if ((frac < 0.25 || (p.shieldTime > 0 && p.shieldTime < 2.5)) && Math.sin(t * 28) > 0) a *= 0.45;
    const c = cset(shieldCol);
    ctx.globalAlpha = Math.min(1, a * 1.25); ctx.drawImage(SPR[MK.hex(shieldCol, c.light)], cx - r, cy - r * 1.04, r * 2, r * 2.08);
    ctx.globalCompositeOperation = 'lighter';
    const band = (t * 0.55) % 1, by = cy - r + band * r * 2, bw = Math.sqrt(Math.max(0, 1 - (band * 2 - 1) ** 2)) * r * 1.7;
    ctx.globalAlpha = 0.22 * a; ctx.drawImage(SPR[MK.soft('#ffffff', 0.8)], cx - bw / 2, by - 0.18, bw, 0.36);
    ctx.globalAlpha = 0.9 * a + 0.1;
    for (let j = 0; j < 2; j++) { const an = t * 1.8 + j * Math.PI, gx = cx + Math.cos(an) * r * 0.93, gy = cy + Math.sin(an) * r * 0.97, s = 0.3 + 0.08 * Math.sin(t * 9 + j); ctx.drawImage(SPR[c.star], gx - s, gy - s, s * 2, s * 2); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  /* ======================= enemy helpers ======================= */
  const AURA_RECT = { pyro: [77, 68, 170], hydro: [269, 72, 170], cryo: [75, 276, 170], electro: [273, 276, 170] };
  api.auraIcon = (ctx, e) => {
    const R = G.run, a = e.aura; if (!a) return;
    const im = G.assets.img.icon_vfx_auras, t = G.time;
    const left = a.until - (R ? R.time : 0); if (left < 0.9 && Math.sin(t * 24) > 0.2) return;
    const s = 0.52, y = e.y - (e.def.h || 2) - 0.22 + Math.sin(t * 3 + (e.id || 0)) * 0.05;
    const two = e.aura2 && e.aura2 !== a.el;
    const drawOne = (el, x) => {
      const rc = AURA_RECT[el];
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45;
      ctx.drawImage(SPR[elset(el).soft], x - s * 0.9, y - s * 0.9, s * 1.8, s * 1.8);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      if (im && rc) ctx.drawImage(im, rc[0], rc[1], rc[2], rc[2], x - s / 2, y - s / 2, s, s);
      else { ctx.fillStyle = (G.EL[el] || G.EL.physical).color; ctx.beginPath(); ctx.arc(x, y, s * 0.3, 0, TAU); ctx.fill(); }
    };
    if (two) { drawOne(a.el, e.x - s * 0.5); drawOne(e.aura2, e.x + s * 0.5); } else drawOne(a.el, e.x);
  };
  /** shared black-purple aura painter for every enemy attack. r = radius (units), t = time, alpha 0..1 */
  /* "黒いオーラ": black smoke that churns and licks upward, a thin faint-violet fringe, a flicker of the
     black-lightning sheet inside. Everything except one tiny violet spark is drawn source-over, so it stays
     dark on the bright meadow (no white/pink additive halo). Respects the caller's globalAlpha. ~6–11 draws. */
  let auraSmoke = null, auraRimI = 0, auraSheetC = null;
  function auraSprites() {
    if (auraSmoke) return;
    auraSmoke = [SPR[MK.darkSmoke(0)], SPR[MK.darkSmoke(1)], SPR[MK.darkSmoke(2)]]; auraRimI = MK.darkRim();
    const im = G.assets.img.icon_enemy_aura; // pre-scaled 128px cells: cheap to rotate every frame
    if (im) { auraSheetC = mk(256, 256); auraSheetC.getContext('2d').drawImage(im, 0, 0, 256, 256); }
  }
  api.darkAura = (ctx, x, y, r, t, alpha) => {
    const pa0 = ctx.globalAlpha, a = (alpha == null ? 1 : alpha) * pa0; if (a <= 0.01 || !(r > 0)) return;
    if (t == null) t = G.time;
    auraSprites();
    const lv = reduced() ? 0 : G.quality ? G.quality.level : 3, rim = SPR[auraRimI], S = auraSmoke;
    // 1) the rim: uneven faint violet halo that breathes
    const br = 0.8 + 0.2 * noise1(t * 3.1 + x);
    const wob = Math.sin(t * 1.7) * r * 0.06;
    ctx.globalAlpha = a * 0.5 * br; ctx.drawImage(rim, x - r * 1.14 + wob, y - r * 1.16, r * 2.28, r * 2.26);
    // 2) smoke body: lobes orbit / swell out of phase → the silhouette never holds still
    const nl = lv >= 3 ? 4 : lv >= 2 ? 3 : 2, sp = t * 0.9;
    for (let i = 0; i < nl; i++) {
      const an = sp * (i & 1 ? -1 : 1) + i * 1.9, d = r * (0.2 + 0.12 * Math.sin(t * 2.3 + i * 2.1)), s = r * (0.95 + 0.14 * Math.sin(t * 3.7 + i * 1.3));
      ctx.globalAlpha = a * (lv >= 2 ? 0.7 : 0.85); ctx.drawImage(S[i % 3], x + Math.cos(an) * d - s, y + Math.sin(an) * d * 0.85 - s, s * 2, s * 2);
    }
    // 3) wisps of black smoke licking upward and thinning out
    if (lv >= 1) {
      const nw = lv >= 2 ? 3 : 2;
      for (let i = 0; i < nw; i++) {
        const f = (t * 0.75 + i / nw + x * 0.13) % 1, s = r * (0.62 - 0.3 * f), wx = x + Math.sin(t * 2.2 + i * 2.4) * r * 0.32 * (0.4 + f);
        ctx.globalAlpha = a * 0.7 * Math.sin(Math.PI * f); ctx.drawImage(S[(i + 1) % 3], wx - s, y - r * (0.35 + 1.05 * f) - s, s * 2, s * 2);
      }
    }
    // 4) black-lightning flicker inside the smoke (the painted aura sheet, rotating)
    if (lv >= 1 && auraSheetC) {
      const f = Math.floor(t * 9) & 3, rot = t * 0.9 + x, q = r * 1.05;
      ctx.translate(x, y); ctx.rotate(rot);
      ctx.globalAlpha = a * 0.6; ctx.drawImage(auraSheetC, (f & 1) * 128, (f >> 1) * 128, 128, 128, -q, -q, q * 2, q * 2);
      ctx.rotate(-rot); ctx.translate(-x, -y);
    }
    // 5) the only light: a faint violet ember at the heart (additive, very low)
    if (lv >= 3) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a * (0.1 + 0.08 * noise1(t * 7 + x * 2)); const g = r * 0.9; ctx.drawImage(SPR[MK.soft('#6a2cc8', 0.9)], x - g, y - g, g * 2, g * 2);
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.globalAlpha = pa0;
  };
  /** cheaper variant for many bullets (dark core + 1 lobe + rim) */
  api.darkAuraLite = (ctx, x, y, r, t, alpha) => {
    const pa0 = ctx.globalAlpha, a = (alpha == null ? 1 : alpha) * pa0; if (a <= 0.01 || !(r > 0)) return;
    if (t == null) t = G.time;
    auraSprites();
    ctx.globalAlpha = a * 0.5; ctx.drawImage(SPR[auraRimI], x - r * 1.25, y - r * 1.25, r * 2.5, r * 2.5);
    const s = r * (1 + 0.12 * Math.sin(t * 6)), s2 = r * 0.7;
    ctx.globalAlpha = a * 0.85; ctx.drawImage(auraSmoke[0], x - s, y - s, s * 2, s * 2);
    ctx.globalAlpha = a * 0.6; ctx.drawImage(auraSmoke[1], x - s2 + Math.sin(t * 4) * r * 0.15, y - s2 - r * 0.4, s2 * 2, s2 * 2);
    ctx.globalAlpha = pa0;
  };

  /* ======================= damage numbers & reaction labels ======================= */
  const NMAX = G.cfg.maxNumbers || 90;
  const nums = []; for (let i = 0; i < NMAX; i++) nums.push({ on: false, x: 0, y: 0, x0: 0, y0: 0, vx: 0, vy: 0, g: 0, t: 0, life: 1, v: 0, text: '', color: '#fff', size: 0.5, crit: false, player: false, prefix: '', react: null, rcolor: '#fff', pop: 0, merge: true, cv: null, cw: 0, ch: 0, rpx: 1, dirty: true });
  const LMAX = 28;
  const labels = []; for (let i = 0; i < LMAX; i++) labels.push({ on: false, x: 0, y: 0, vy: 0, t: 0, life: 1, text: '', color: '#fff', size: 0.62, glow: 0, big: false });
  let numActive = 0;
  const fontCache = {};
  const font = (px, serif) => { const k = px + (serif ? 's' : ''); return fontCache[k] || (fontCache[k] = serif ? `800 ${px}px ${SERIF}` : `900 ${px}px ${ROUND}`); };
  const fmt = v => U.fmtNum(v);
  const NUMCOL = { pyro: '#ff9a52', hydro: '#5cc0ff', cryo: '#aef6ff', electro: '#d49bff', anemo: '#6ff5cf', geo: '#ffd95a', physical: '#fffaf0' };

  api.number = (x, y, v, o) => {
    o = o || {};
    if (!settings().damageNumbers && !o.player) return;
    const color = o.color || NUMCOL[o.element] || NUMCOL.physical;
    const mergeable = !o.crit && !o.player && !o.prefix && !o.reaction;
    if (!o.crit && !o.player && !o.prefix && !o.reaction && numActive > (G.quality && G.quality.level === 0 ? 28 : 48)) return; // declutter hordes
    if (mergeable) {
      for (let i = 0; i < NMAX; i++) {
        const n = nums[i];
        if (n.on && n.merge && n.color === color && n.t < 0.32 && Math.abs(n.x0 - x) < 1.1 && Math.abs(n.y0 - y) < 1.3) {
          n.v += v; n.text = fmt(n.v); n.dirty = true; n.pop = 1; if (n.t > 0.12) n.t = 0.12; return;
        }
      }
    }
    let slot = null, oldest = -1;
    for (let i = 0; i < NMAX; i++) { const n = nums[i]; if (!n.on) { slot = n; break; } const k = n.t / n.life; if (k > oldest) { oldest = k; slot = n; } }
    const n = slot; n.on = true; n.merge = mergeable;
    const atk = G.run && G.run.stats ? G.run.stats.atk || 100 : 100;
    const mag = o.player || o.prefix ? 0 : Math.max(-0.15, Math.min(0.5, Math.log10(Math.max(1, v) / atk) * 0.2));
    n.v = v; n.prefix = o.prefix || ''; n.crit = !!o.crit; n.player = !!o.player;
    n.text = n.prefix + fmt(v) + (n.crit ? '!' : ''); n.dirty = true;
    n.color = color; n.size = (o.size || 0.5) * (1 + mag) * (n.crit ? 1.45 : 1);
    n.x = n.x0 = x + rr(-0.35, 0.35); n.y = n.y0 = y;
    n.vx = n.player ? 0 : rr(-1.3, 1.3); n.vy = n.player ? -2.6 : -rr(4.6, 6); n.g = n.player ? 3 : 11;
    n.t = 0; n.life = n.crit ? 1.05 : n.player ? 1.0 : 0.8; n.pop = 0;
    n.react = o.reaction || null; n.rcolor = '#fff';
    if (n.react) { for (let i = 0; i < LMAX; i++) { const l = labels[i]; if (l.on && l.text === n.react && l.t < 0.05) { n.rcolor = l.color; l.on = false; break; } } if (n.rcolor === '#fff') n.rcolor = color; n.life += 0.25; }
    if (numActive > 34 && !n.crit && !n.player) n.size *= 0.85; // hordes: keep the small stuff small
    if (n.crit) { api.sparkle(x, y - 0.2, '#ffe27a', 4, 0.5); if (G.time - lastCritGlint > 0.06) { lastCritGlint = G.time; glint(x, y + 0.5, 1.1 + mag, '#ffe27a', 0.26); } }
  };
  let lastCritGlint = -9;
  api.reactionText = (x, y, text, color) => {
    color = color || '#fff';
    for (let i = 0; i < LMAX; i++) { const l = labels[i]; if (l.on && l.text === text && l.t < 0.35 && Math.abs(l.x - x) < 2.2 && Math.abs(l.y - y) < 2.2) { l.t = Math.min(l.t, 0.06); l.big = true; return; } }
    let slot = null, oldest = -1;
    for (let i = 0; i < LMAX; i++) { const l = labels[i]; if (!l.on) { slot = l; break; } if (l.t > oldest) { oldest = l.t; slot = l; } }
    const l = slot; l.on = true; l.x = x; l.y = y - 0.3; l.vy = -1.6; l.t = 0; l.life = 1.1; l.text = text; l.color = color; l.size = text.length > 3 ? 0.74 : 0.84; l.big = false;
    l.glow = MK.core(parseHex(color) ? color : '#ffffff');
  };
  /* Genshin-style reaction label, pre-rendered once per (text, colour): skewed bold type, light→colour
     gradient, dark outline, coloured outer glow and a swoosh band behind it. */
  const labelCache = new Map(); let fontGen = 0;
  try { document.fonts && document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => { fontGen++; labelCache.clear(); }); } catch (err) { /* old browsers */ }
  const LFS = 64;
  function labelSprite(text, color) {
    const key = text + color; let s = labelCache.get(key); if (s) return s;
    const probe = mk(4, 4).getContext('2d'); probe.font = font(LFS); const tw = probe.measureText(text).width;
    const W = Math.ceil(tw + LFS * 1.4), H = Math.ceil(LFS * 1.9), cv = mk(W, H), x = cv.getContext('2d');
    const p = parseHex(color) || [255, 255, 255], light = `rgb(${p.map(v => Math.round(v + (255 - v) * 0.75)).join(',')})`, dark = `rgb(${p.map(v => Math.round(v * 0.55)).join(',')})`;
    x.translate(W / 2, H / 2);
    // swoosh band
    const g0 = x.createLinearGradient(-W / 2, 0, W / 2, 0); g0.addColorStop(0, rgba(color, 0)); g0.addColorStop(0.3, rgba(color, 0.42)); g0.addColorStop(0.7, rgba(color, 0.42)); g0.addColorStop(1, rgba(color, 0));
    x.fillStyle = g0; x.beginPath(); x.moveTo(-W / 2 + LFS * 0.4, LFS * 0.34); x.lineTo(W / 2, LFS * 0.2); x.lineTo(W / 2 - LFS * 0.4, LFS * 0.46); x.lineTo(-W / 2, LFS * 0.56); x.closePath(); x.fill();
    x.transform(1, 0, -0.16, 1, 0, 0);
    x.font = font(LFS); x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    x.shadowColor = color; x.shadowBlur = LFS * 0.3; x.lineWidth = LFS * 0.26; x.strokeStyle = 'rgba(24,10,20,.95)'; x.strokeText(text, 0, 0);
    x.shadowBlur = 0; x.lineWidth = LFS * 0.08; x.strokeStyle = dark; x.strokeText(text, 0, 0);
    const g = x.createLinearGradient(0, -LFS * 0.45, 0, LFS * 0.45); g.addColorStop(0, '#ffffff'); g.addColorStop(0.35, light); g.addColorStop(0.7, color); g.addColorStop(1, dark);
    x.fillStyle = g; x.fillText(text, 0, 0);
    s = { cv, w: W / LFS, h: H / LFS };
    if (labelCache.size > 80) labelCache.clear();
    labelCache.set(key, s); return s;
  }

  function numGlyph(n, px) {
    const f = font(px); numProbe.font = f;
    const tw = numProbe.measureText(n.text).width, W = Math.ceil(tw + px * 0.7), H = Math.ceil(px * 1.5);
    if (!n.cv || n.cv.width < W || n.cv.height < H) n.cv = mk(Math.max(W, n.cv ? n.cv.width : 0) + 32, Math.max(H, n.cv ? n.cv.height : 0) + 8);
    const x = n.cv.getContext('2d'); x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W + 2, H + 2);
    x.font = f; x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    const cx = W / 2, cy = H / 2;
    x.lineWidth = px * 0.3; x.strokeStyle = 'rgba(22,10,4,.92)'; x.strokeText(n.text, cx, cy);
    if (n.crit) {
      x.lineWidth = px * 0.13; x.strokeStyle = '#ffd54a'; x.strokeText(n.text, cx, cy);
      // crits: white-hot top → element colour (reads as "shiny")
      const g = x.createLinearGradient(0, cy - px * 0.45, 0, cy + px * 0.4); g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, n.color); g.addColorStop(1, n.color); x.fillStyle = g;
    } else x.fillStyle = n.color;
    x.fillText(n.text, cx, cy);
    n.cw = W; n.ch = H; n.rpx = px; n.dirty = false;
  }
  const numProbe = mk(4, 4).getContext('2d');
  function drawNumbersImpl(ctx) {
    const m = ctx.getTransform(), A = m.a, E = m.e, F = m.f, dpr = G.view.dpr || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const starSpr = SPR[cset('#ffd54a').star], flareSpr = SPR[MK.flare('#ffd54a')];
    for (let i = 0; i < NMAX; i++) {
      const n = nums[i]; if (!n.on) continue;
      const k = n.t / n.life;
      let sc;
      if (n.crit) sc = n.t < 0.12 ? 2.2 - 1.2 * U.ease.outBack(n.t / 0.12) : n.t < 0.42 ? 1 + 0.12 * Math.sin((n.t - 0.12) * 42) * (1 - (n.t - 0.12) / 0.3) : 1;
      else sc = n.t < 0.12 ? 0.35 + 0.65 * U.ease.outBack(n.t / 0.12) : 1;
      sc *= 1 + n.pop * 0.35;
      let al = 1; if (k > 0.72) { const f = (k - 0.72) / 0.28; al = 1 - f; sc *= 1 - f * 0.35; }
      const px = Math.max(8, Math.round(n.size * A / (n.crit ? 1 : 1)));
      let sx = A * n.x + E, sy = A * n.y + F;
      if (n.player && n.t < 0.25) sx += Math.sin(n.t * 70) * px * 0.08;
      const s = sc; if (s <= 0.02) continue;
      if (n.crit && n.t < 0.22) { const q = (1 - n.t / 0.22) * px * 0.12; sx += Math.sin(n.t * 90) * q; sy += Math.cos(n.t * 77) * q; }
      if (n.crit) {
        // rotating 4-point flare behind crits
        const fr = n.t * 1.6, fc = Math.cos(fr) * s, fs = Math.sin(fr) * s;
        ctx.setTransform(fc, fs, -fs, fc, sx, sy);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = al * (0.6 + 0.3 * Math.sin(n.t * 20)) * (n.t < 0.3 ? 1 : 0.7);
        ctx.drawImage(flareSpr, -px * 2.1, -px * 2.1, px * 4.2, px * 4.2);
        ctx.globalAlpha = al * 0.5; ctx.drawImage(starSpr, -px * 1.2, -px * 1.2, px * 2.4, px * 2.4);
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.setTransform(s, 0, 0, s, sx, sy);
      ctx.globalAlpha = al;
      // glyphs are rasterised once into the slot's own canvas (stroke+fill text every frame was the costliest fx draw)
      if (n.dirty || !n.cv || Math.abs(n.rpx - px) > px * 0.2) numGlyph(n, px);
      const q = px / n.rpx, gw = n.cw * q, gh = n.ch * q;
      ctx.drawImage(n.cv, 0, 0, n.cw, n.ch, -gw / 2, -gh / 2, gw, gh);
      if (n.react) {
        const lp = Math.max(9, px * 0.78), ly = -px * 1.05, ls = labelSprite(n.react, n.rcolor);
        ctx.drawImage(ls.cv, -ls.w * lp / 2, ly - ls.h * lp / 2, ls.w * lp, ls.h * lp);
      }
    }
    for (let i = 0; i < LMAX; i++) {
      const l = labels[i]; if (!l.on) continue;
      const k = l.t / l.life, px = l.size * A * (l.big ? 1.15 : 1);
      // pop: overshoot 1.45 → settle with a little bounce, then stretch-out fade at the end
      let sc = l.t < 0.1 ? 0.3 + 1.15 * U.ease.outCubic(l.t / 0.1) : l.t < 0.42 ? 1 + 0.45 * Math.cos((l.t - 0.1) / 0.32 * Math.PI * 2.5) * (1 - (l.t - 0.1) / 0.32) : 1;
      let sxk = 1, al = 1;
      if (k > 0.78) { const f = (k - 0.78) / 0.22; al = 1 - f; sxk = 1 + f * 0.5; sc *= 1 - f * 0.25; }
      if (sc <= 0.02) continue;
      const rot = Math.sin(l.t * 22) * 0.1 * (1 - clamp01(l.t / 0.42));
      const sx = A * l.x + E, sy = A * l.y + F, c = Math.cos(rot) * sc, s = Math.sin(rot) * sc;
      ctx.setTransform(c * sxk, s * sxk, -s, c, sx, sy);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = al * (l.t < 0.2 ? 0.9 : 0.45);
      ctx.drawImage(SPR[l.glow], -px * 1.8, -px * 1.0, px * 3.6, px * 2.0);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = al;
      const ls = labelSprite(l.text, l.color), lw = ls.w * px, lh = ls.h * px;
      ctx.drawImage(ls.cv, -lw / 2, -lh / 2, lw, lh);
      if (l.t < 0.16) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - l.t / 0.16) * 0.8; ctx.drawImage(ls.cv, -lw / 2, -lh / 2, lw, lh); ctx.globalCompositeOperation = 'source-over'; }
    }
    ctx.globalAlpha = 1; ctx.setTransform(m);
    void dpr;
  }

  /* ======================= cut-in & boss intro (screen space) ======================= */
  const cut = { on: false, t: 0, dur: 1.05, img: null, title: '', name: '', color: '#ff7a3d', ly: new Float32Array(26), lx: new Float32Array(26), ll: new Float32Array(26), fl: new Float32Array(48), grad: null, gradH: 0 };
  api.cutin = (charId, title) => {
    if (cut.on && cut.t < cut.dur * 0.75) return; if (G.time - lastCut < 0.8) return; lastCut = G.time;
    const ch = (G.data.characters && G.data.characters[charId]) || {};
    cut.on = true; cut.t = 0; cut.img = G.assets.img['cutin_' + charId] || null;
    cut.title = title || ch.burstName || '元素爆発'; cut.name = ch.name || ''; cut.color = (G.EL[ch.element] || G.EL.pyro).color; cut.grad = null;
    for (let i = 0; i < 26; i++) { cut.ly[i] = rnd(); cut.lx[i] = rnd(); cut.ll[i] = rr(0.08, 0.3); }
    for (let i = 0; i < 48; i++) cut.fl[i] = rnd();
    api.slowmo(0.12, 0.9); api.shake(0.35); api.flash(cut.color, 0.22);
  };
  function drawCutin(ctx, V) {
    const W = V.w, H = V.h, t = cut.t, D = cut.dur;
    const inK = U.ease.outExpo(clamp01(t / 0.2)), outK = U.ease.inCubic(clamp01((t - (D - 0.22)) / 0.22));
    const band0 = Math.min(H * 0.4, W * 0.24), bandH = band0 * (1 - outK * 0.97), cy = H * 0.47, ang = -0.13;
    // dim + focus lines
    const dim = Math.min(1, t / 0.08) * (1 - outK);
    ctx.fillStyle = `rgba(10,3,6,${(0.55 * dim).toFixed(3)})`; ctx.fillRect(0, 0, W, H);
    if (!reduced()) {
      ctx.fillStyle = `rgba(255,236,210,${(0.28 * dim).toFixed(3)})`; ctx.beginPath();
      const Rr = Math.hypot(W, H) * 0.6, cx0 = W / 2, cy0 = cy;
      for (let i = 0; i < 48; i++) {
        if (rnd() < 0.15) cut.fl[i] = rnd();
        const a = i / 48 * TAU + cut.fl[i] * 0.12, w = 0.004 + cut.fl[i] * 0.01, rin = Math.min(W, H) * (0.36 + cut.fl[i] * 0.16);
        ctx.moveTo(cx0 + Math.cos(a - w) * Rr, cy0 + Math.sin(a - w) * Rr); ctx.lineTo(cx0 + Math.cos(a) * rin, cy0 + Math.sin(a) * rin); ctx.lineTo(cx0 + Math.cos(a + w) * Rr, cy0 + Math.sin(a + w) * Rr);
      }
      ctx.fill();
    }
    const slide = (1 - inK) * W * 1.1 - outK * W * 0.25 - t * 30;
    ctx.save();
    ctx.translate(W / 2, cy); ctx.rotate(ang);
    const bw = W * 1.5;
    ctx.beginPath(); ctx.rect(-bw / 2, -bandH / 2, bw, bandH);
    ctx.save(); ctx.clip();
    ctx.fillStyle = '#2a0503'; ctx.fillRect(-bw / 2, -bandH / 2, bw, bandH);
    if (cut.img) {
      const asp = cut.img.width / cut.img.height, iw = Math.max(band0 * 1.12 * asp, W * 0.98), ih = iw / asp;
      ctx.drawImage(cut.img, -iw / 2 + W * 0.08 + slide, -ih / 2 - band0 * 0.02, iw, ih);
    }
    // speed lines racing across the band
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 26; i++) {
      const y = (cut.ly[i] - 0.5) * bandH, len = cut.ll[i] * bw, x = ((cut.lx[i] - t * (2.2 + cut.ll[i] * 3)) % 1 + 1) % 1 * (bw + len) - bw / 2 - len;
      ctx.globalAlpha = 0.25 + cut.ll[i]; ctx.fillStyle = i & 1 ? '#ffffff' : '#ffc27a'; ctx.fillRect(x, y, len, i % 3 === 0 ? 3 : 1.5);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.restore();
    // gold edges
    ctx.fillStyle = '#ffd88a'; ctx.fillRect(-bw / 2, -bandH / 2 - 4, bw, 4); ctx.fillRect(-bw / 2, bandH / 2, bw, 4);
    ctx.fillStyle = cut.color; ctx.fillRect(-bw / 2, -bandH / 2 - 9, bw, 3); ctx.fillRect(-bw / 2, bandH / 2 + 6, bw, 3);
    // title
    const tIn = U.ease.outBack(clamp01((t - 0.1) / 0.25)), fs = Math.round(Math.min(H * 0.15, W * 0.085));
    if (tIn > 0 && bandH > fs * 0.5) {
      const tx = -W * 0.26 + (1 - tIn) * -W * 0.4, ty = bandH * 0.12;
      ctx.globalAlpha = 1 - outK;
      ctx.font = font(Math.round(fs * 0.3)); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(20,4,2,.9)'; ctx.strokeText(cut.name + '・元素爆発', tx - fs * 1.45, ty - fs * 1.08);
      ctx.fillStyle = '#ffe7b8'; ctx.fillText(cut.name + '・元素爆発', tx - fs * 1.45, ty - fs * 1.08);
      ctx.font = font(fs, true); ctx.textAlign = 'center';
      if (!cut.grad || cut.gradH !== fs) { const g = ctx.createLinearGradient(0, ty - fs * 0.8, 0, ty + fs * 0.1); g.addColorStop(0, '#fffbe8'); g.addColorStop(0.45, '#ffd76a'); g.addColorStop(1, '#ff8a2a'); cut.grad = g; cut.gradH = fs; }
      ctx.lineWidth = fs * 0.16; ctx.strokeStyle = '#2a0703'; ctx.strokeText(cut.title, tx, ty);
      ctx.lineWidth = fs * 0.05; ctx.strokeStyle = '#fff2c8'; ctx.strokeText(cut.title, tx, ty);
      ctx.fillStyle = cut.grad; ctx.fillText(cut.title, tx, ty);
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    // entry flash
    if (t < 0.12) { ctx.globalAlpha = (1 - t / 0.12) * 0.5; ctx.fillStyle = '#fff4e0'; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  }

  let zoomOwned = false;
  const bi = { on: false, t: 0, dur: 3.3, e: null, name: '', title: '', final: false, accent: '#ff6b5a' };
  const introduced = new WeakSet();
  api.bossIntro = e => {
    if (!e || introduced.has(e)) return; introduced.add(e);
    const def = e.def || {};
    bi.on = true; bi.t = 0; bi.e = e; bi.name = def.name || 'ボス'; bi.title = def.bossTitle || '強敵'; bi.final = !!def.final;
    bi.accent = def.final ? '#5cf2c8' : '#ff6b5a';
    api.slowmo(0.35, 1.1); api.shake(0.7); api.flash(bi.accent, 0.25);
    const x = e.x, y = e.y;
    api.darkBurst(x, y, 2.4); api.shockwave(x, y, 7, bi.accent); api.rays(x, y - (def.h || 3) * 0.5, 6, def.final ? '#c2fff0' : '#ffb0a0', 1.4);
    if (def.final) api.swirl(x, y, 5, '#5cf2c8');
    // the sky darkens and lightning strikes around the boss
    const lc = def.final ? '#aefff0' : '#d9a8ff';
    const strike = (dx, dy, main) => {
      const tx = e.x + dx, ty = e.y + dy;
      bolt(tx + rr(-2, 2), ty - 16, tx, ty, lc, main ? 0.34 : 0.2, main ? 0.4 : 0.28, true);
      if (main) bolt(tx + rr(-3, 3), ty - 15, tx, ty, '#ffffff', 0.12, 0.3, true);
      const g = eff(E_GROUNDGLOW, tx, ty, main ? 3 : 1.8, lc, 0.5); if (g) g.spr = MK.soft(lc, 0.9);
      spray(nn(main ? 12 : 6, budget()), K_STREAK, cset(lc).streak, 1, tx, ty - 0.2, 5, 12, 0.15, 0.3, 0.08, 0.14, 0.3, 4, 0, 1, -Math.PI / 2, 1.3);
      bossFlash = Math.max(bossFlash, main ? 0.75 : 0.45); aberration(main ? 0.8 : 0.4); api.shake(main ? 0.6 : 0.3);
    };
    strike(0, 0.1, true);
    later(0.28, () => strike(rr(-5, -2.5), rr(-2, 2), false));
    later(0.62, () => strike(rr(2.5, 5), rr(-2, 2), false));
    later(1.05, () => strike(rr(-1, 1), 0.1, true));
  };
  let bossFlash = 0;
  function drawBossIntro(ctx, V) {
    // no letterbox bars: the top (HUD / boss bar, ~110px) and bottom-right (skill buttons) stay clear
    const W = V.w, H = V.h, t = bi.t, D = bi.dur;
    const env = t < 0.45 ? U.ease.outCubic(t / 0.45) : t > D - 0.5 ? clamp01(1 - (t - (D - 0.5)) / 0.5) : 1;
    ctx.globalAlpha = 0.28 * env; ctx.fillStyle = bi.final ? '#03121a' : '#0c0414'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.6 * env; ctx.drawImage(SPR[MK.vignette('#05040a', 0.3)], 0, 0, W, H);
    ctx.globalAlpha = 1;
    if (t < 0.3) return;
    const tt = t - 0.3, a = Math.min(1, tt / 0.3) * env;
    const fs = Math.round(Math.min(H * 0.095, W * 0.065)), cy = Math.min(H * 0.6, H - 150 - fs * 0.5);
    ctx.globalAlpha = 0.7 * a; ctx.drawImage(SPR[MK.soft('#000000', 0.9)], W * 0.18, cy - fs * 1.7, W * 0.64, fs * 3);
    ctx.globalAlpha = a;
    const lw = Math.min(1, tt / 0.6) * W * 0.22;
    ctx.fillStyle = bi.accent; ctx.fillRect(W / 2 - lw - fs * 0.2, cy - fs * 0.95, lw, 2); ctx.fillRect(W / 2 + fs * 0.2, cy - fs * 0.95, lw, 2);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = font(Math.max(11, Math.round(fs * 0.34))); ctx.fillStyle = bi.accent;
    ctx.fillText('⚠ ' + (bi.final ? '最終決戦 ・ ' : '強敵出現 ・ ') + bi.title, W / 2, cy - fs * 0.95);
    const shown = Math.min(bi.name.length, Math.floor(tt / 0.07) + 1), txt = bi.name.slice(0, shown);
    const pop = 1 + Math.max(0, 0.25 - (tt - (shown - 1) * 0.07)) * 0.6;
    ctx.save(); ctx.translate(W / 2, cy + fs * 0.1); ctx.scale(pop, pop);
    ctx.font = font(fs, true);
    ctx.lineWidth = fs * 0.14; ctx.strokeStyle = 'rgba(5,4,10,.95)'; ctx.strokeText(txt, 0, 0);
    ctx.fillStyle = '#fff8ec'; ctx.fillText(txt, 0, 0);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  /* ======================= update ======================= */
  let lastRealT = 0, trailAcc = 0, gradeT = 0, gradeCol = '#ff7a3d';
  const GRADE_DUR = 4.2;
  function worldPaused() {
    const R = G.run; if (!R || !R.pauses || !R.pauses.size) return false;
    if (R.pauses.size === 1 && R.pauses.has('cutin')) return false;
    return true;
  }
  api.debugFreeze = false; // tests: freeze fx time and step it manually with api.step(dt)
  api.step = dt => { const f = api.debugFreeze; api.debugFreeze = false; api.update(dt); api.debugFreeze = f; };
  api.update = (dt) => {
    if (!(dt > 0) || api.debugFreeze) return;
    // screen-space timers always run (real time)
    if (cut.on) { cut.t += dt; if (cut.t >= cut.dur) cut.on = false; }
    flashA = Math.max(0, flashA - dt * 3.2); hurtA = Math.max(0, hurtA - dt * 1.8);
    aberr = Math.max(0, aberr - dt * 2.6); bossFlash = Math.max(0, bossFlash - dt * 4);
    if (worldPaused()) return;
    lastRealT += dt; killFrame = 0;
    // feel
    trauma = Math.min(1, trauma + Math.min(0.45, pendTrauma)); pendTrauma = 0;
    trauma = Math.max(0, trauma - dt * (0.9 + trauma * 1.2));
    const kd = Math.exp(-16 * dt); kickX *= kd; kickY *= kd;
    if (hitstopT > 0) { hitstopT -= dt; if (hitstopT <= 0) hitstopCool = 0.14; } else if (hitstopCool > 0) hitstopCool -= dt;
    if (slowT > 0) { slowT -= dt; api.timeScale = slowScale; }
    else if (api.timeScale < 1) api.timeScale = Math.min(1, api.timeScale + dt * 3.2);
    boomLoad = Math.max(0, boomLoad - dt * 4);
    if (bi.on) {
      bi.t += dt; const cam = G.view.cam;
      const env = bi.t < 0.6 ? U.ease.inOutSine(bi.t / 0.6) : bi.t > bi.dur - 0.6 ? clamp01((bi.dur - bi.t) / 0.6) : 1;
      cam.zoom = 1 + 0.1 * env; zoomOwned = true;
      if (bi.t >= bi.dur) { bi.on = false; cam.zoom = 1; zoomOwned = false; }
    }
    for (let i = timers.length - 1; i >= 0; i--) { const tm = timers[i]; tm.t -= dt; if (tm.t <= 0) { timers.splice(i, 1); try { tm.fn(); } catch (err) { console.error(err); } } }

    // world-time for effects: slows with slow-mo, nearly freezes during hitstop
    const sdt = hitstopT > 0 ? dt * 0.08 : dt * Math.max(0.12, api.timeScale);
    for (let i = np - 1; i >= 0; i--) {
      const t = pt[i] + sdt; if (t >= pl[i]) { pkill(i); continue; }
      pt[i] = t;
      let d = 1 - pdr[i] * sdt; if (d < 0) d = 0;
      pvx[i] *= d; pvy[i] = pvy[i] * d + pgr[i] * sdt;
      px[i] += pvx[i] * sdt; py[i] += pvy[i] * sdt; pr[i] += pvr[i] * sdt;
    }
    const AL = anims.list; for (let i = AL.length - 1; i >= 0; i--) { const a = AL[i]; a.t += sdt; a.y += a.vy * sdt; if (a.t >= a.dur) anims.kill(i); }
    const EL = effs.list;
    for (let i = EL.length - 1; i >= 0; i--) {
      const e = EL[i]; e.t += e.type === E_CORPSE ? dt : sdt; e.rot += e.vr * sdt;
      if (e.type === E_BOLT && e.t > 0) { e.jit -= sdt; if (e.jit <= 0) { e.jit = 0.045; if (e.bn) e.bn = 1; genBolt(e); } }
      else if (e.type === E_CORPSE && e.vr) { e.x += e.vx * dt; e.y += e.vy * dt; const d = Math.exp(-3 * dt); e.vx *= d; e.vy = e.vy * d + 9 * dt; }
      if (e.t >= e.life) { if (e.type === E_HEAT) heatN--; effs.kill(i); }
    }
    // multi-kill: many foes down inside a short window → golden sweep ring + light flash
    kb.t += dt; kb.cool -= dt;
    if (kb.t > 0.35) {
      if (kb.n >= 10 && kb.cool <= 0 && G.run && G.run.player) {
        const cx = kb.sx / kb.n, cy = kb.sy / kb.n, p = G.run.player, big = kb.n >= 22;
        kb.cool = big ? 1.2 : 0.7;
        let e = eff(E_SHOCK, p.x, p.y, big ? 9 : 6, '#ffe07a', 0.55); if (e) e.w = 0.35;
        e = eff(E_GROUNDGLOW, cx, cy, big ? 6 : 4, '#ffd86a', 0.6); if (e) e.spr = MK.soft('#ffd86a', 0.8);
        api.sparkle(cx, cy - 0.6, '#fff0a8', big ? 22 : 12, big ? 3 : 2);
        api.flash('#fff3c8', big ? 0.16 : 0.08); aberration(big ? 0.55 : 0.3); api.zoomPunch(big ? 0.03 : 0.015); api.shake(big ? 0.35 : 0.2);
      }
      kb.t = 0; kb.n = 0; kb.sx = kb.sy = 0;
    }
    // XP / energy particles streaming into the player leave glittering trails
    const R = G.run;
    if (R && R.pickups && R.pickups.length) {
      trailAcc += dt; const every = reduced() ? 0.09 : 0.035;
      if (trailAcc >= every) {
        trailAcc = 0; let budgetN = np > PMAX * 0.7 ? 6 : 26;
        const PU = R.pickups;
        for (let i = 0; i < PU.length && budgetN > 0; i++) {
          const o = PU[i]; if (!o.magnet || (o.type !== 'xp' && o.type !== 'energy' && o.type !== 'mora')) continue;
          const v = o.value || 1, col = o.type === 'energy' ? '#ffffff' : o.type === 'mora' ? '#ffd24a' : v >= 40 ? '#ff6a8a' : v >= 10 ? '#ffd24a' : v >= 3 ? '#c28bff' : '#7fe3ff';
          const j = P(K_GLOW, cset(col).core, 1, o.x + rr(-0.1, 0.1), o.y - (o.z || 0) - 0.25 + rr(-0.1, 0.1), rr(-0.4, 0.4), rr(-0.4, 0.4), rr(0.2, 0.4), v >= 10 ? 0.16 : 0.11, 0.1, 1, 0, 0.9);
          if (j < 0) break; budgetN--;
        }
      }
    }
    if (gradeT > 0) gradeT = Math.max(0, gradeT - dt);
    const DL = decals.list; for (let i = DL.length - 1; i >= 0; i--) { const d = DL[i]; d.t += sdt; if (d.t >= d.life) decals.kill(i); }
    numActive = 0;
    for (let i = 0; i < NMAX; i++) {
      const n = nums[i]; if (!n.on) continue;
      numActive++; n.t += dt; if (n.t >= n.life) { n.on = false; continue; }
      n.vy += n.g * dt; n.vx *= Math.exp(-2 * dt); n.x += n.vx * dt; n.y += n.vy * dt * (n.vy > 0 ? 0.35 : 1);
      n.pop = Math.max(0, n.pop - dt * 6);
    }
    for (let i = 0; i < LMAX; i++) { const l = labels[i]; if (!l.on) continue; l.t += dt; if (l.t >= l.life) { l.on = false; continue; } l.y += l.vy * dt; l.vy *= Math.exp(-3 * dt); }
  };

  /* ======================= draw ======================= */
  api.drawGround = ctx => {
    const DL = decals.list; if (!DL.length) return;
    for (let i = 0; i < DL.length; i++) {
      const d = DL[i], k = d.t / d.life, a = k > 0.6 ? (1 - k) / 0.4 : 1;
      ctx.globalAlpha = 0.62 * a; ctx.drawImage(SPR[d.spr], d.x - d.r, d.y - d.r * 0.62, d.r * 2, d.r * 1.24);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < DL.length; i++) {
      const d = DL[i]; if (d.t > 2.6) continue;
      const fl = 0.8 + 0.2 * Math.sin(d.t * 23 + d.rot * 5);
      ctx.globalAlpha = Math.pow(1 - d.t / 2.6, 1.5) * 0.75 * fl; const r = d.r * (0.9 - d.t * 0.12); ctx.drawImage(SPR[d.glow], d.x - r, d.y - r * 0.6, r * 2, r * 1.2);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  };

  function drawParticles(ctx, add, A, E, F) {
    for (let i = 0; i < np; i++) {
      if (padd[i] !== add) continue;
      const k = pt[i] / pl[i], kind = pk[i];
      let a;
      if (kind === K_SMOKE) a = pa[i] * 4 * k * (1 - k); else { a = (1 - k) * 2.2; if (a > 1) a = 1; a *= pa[i]; }
      if (a < 0.01) continue;
      const s = ps[i] * (1 + (ps1[i] - 1) * k);
      let x = px[i]; const y = py[i];
      const img = SPR[psp[i]];
      ctx.globalAlpha = a;
      if (kind === K_STREAK) {
        const vx = pvx[i], vy = pvy[i], sp = Math.sqrt(vx * vx + vy * vy) + 1e-4, len = s * (1.1 + sp * 0.1);
        const c = vx / sp * A, sn = vy / sp * A;
        ctx.setTransform(c, sn, -sn, c, A * x + E, A * y + F); ctx.drawImage(img, -len, -s * 0.5, len * 2, s);
      } else if (kind === K_ROT) {
        const r = pr[i], c = Math.cos(r) * A, sn = Math.sin(r) * A;
        ctx.setTransform(c, sn, -sn, c, A * x + E, A * y + F); ctx.drawImage(img, -s, -s, s * 2, s * 2);
      } else {
        if (kind === K_WISP) x += Math.sin(pt[i] * 5 + pr[i]) * pw[i];
        ctx.setTransform(A, 0, 0, A, A * x + E, A * y + F); ctx.drawImage(img, -s, -s, s * 2, s * 2);
      }
    }
  }
  api.draw = ctx => {
    const m = ctx.getTransform(), A = m.a, E = m.e, F = m.f;
    const EL = effs.list;
    // ---- normal-composite layer: corpses, dark bursts, debris, smoke, flipbooks ----
    for (let i = 0; i < EL.length; i++) {
      const e = EL[i];
      if (e.type === E_CORPSE) {
        const k = e.t / e.life, sq = U.ease.outCubic(k);
        CA.atlas = e.atlas; CA.h = e.h; CA.face = e.face; CA.anim.state = e.st; CA.anim.t = e.at; CA.filter = e.filter;
        if (e.vr) {
          // blown away: spin around the body centre, shrink and fade into light
          const hc = e.h * 0.45, c = Math.cos(e.rot), s = Math.sin(e.rot);
          ctx.transform(c, s, -s, c, e.x, e.y - hc);
          CA.x = 0; CA.y = hc; CA.flash = 1; CA.sx = CA.sy = 1 - 0.55 * sq; CA.alpha = 1 - k * k;
          G.render.drawActor(ctx, CA); ctx.setTransform(m);
        } else {
          CA.x = e.x; CA.y = e.y; CA.flash = 1; CA.sx = 1 + 0.45 * sq; CA.sy = Math.max(0.05, 1 - 0.75 * sq); CA.alpha = 1 - k * 0.6;
          G.render.drawActor(ctx, CA);
        }
      } else if (e.type === E_ICE && e.t > 0) {
        const k = e.t / e.life, pop = e.t < 0.12 ? U.ease.outBack(e.t / 0.12) : 1, s = e.r * pop;
        ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 0.95;
        ctx.drawImage(SPR[e.spr], e.x - s, e.y - s * 1.55, s * 2, s * 2);
        ctx.globalAlpha = 1;
      } else if (e.type === E_DARK && e.t > 0) {
        const k = e.t / e.life; api.darkAura(ctx, e.x, e.y, e.r * (0.5 + 0.7 * U.ease.outCubic(k)), G.time + e.rot, 1 - k);
      }
    }
    drawParticles(ctx, 0, A, E, F);
    ctx.setTransform(m);
    const AL = anims.list;
    for (let i = 0; i < AL.length && !(api.dbgSkip && api.dbgSkip.anim); i++) {
      const a = AL[i]; if (a.t < 0) continue;
      const sh = a.sheet, k = a.t / a.dur, f = Math.min(sh.frames - 1, Math.floor(k * sh.frames)) * 4;
      const img = a.img ? G.assets.tinted(sh.img, a.img) : G.assets.img[sh.img]; if (!img) continue;
      ctx.globalAlpha = a.a * (k > 0.8 ? (1 - k) / 0.2 : 1);
      if (a.add) ctx.globalCompositeOperation = 'lighter';
      const c = Math.cos(a.rot) * A, s = Math.sin(a.rot) * A, R = sh.rects;
      ctx.setTransform(c * a.flip, s * a.flip, -s, c, A * a.x + E, A * a.y + F);
      ctx.drawImage(img, R[f], R[f + 1], R[f + 2], R[f + 3], -a.w / 2, -a.h / 2, a.w, a.h);
      if (a.add) ctx.globalCompositeOperation = 'source-over';
    }
    ctx.setTransform(m);
    // ---- additive layer ----
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < EL.length; i++) {
      const e = EL[i]; if (e.t < 0 || (api.dbgSkip && api.dbgSkip[e.type])) continue;
      const k = e.t / e.life;
      switch (e.type) {
        case E_BLOOM: { const a = (1 - k) * (1 - k) * e.a, s = e.r * (0.75 + 0.45 * U.ease.outCubic(k)); ctx.globalAlpha = a; ctx.drawImage(SPR[e.spr], e.x - s, e.y - s * 0.8, s * 2, s * 1.6); break; }
        case E_GROUNDGLOW: { const a = (1 - k) * e.a * 0.8, s = e.r; ctx.globalAlpha = a; ctx.drawImage(SPR[e.spr], e.x - s, e.y - s * 0.45, s * 2, s * 0.9); break; }
        case E_FLASH: { const s = e.r * (0.6 + 0.9 * k); ctx.globalAlpha = 1 - k; ctx.drawImage(SPR[e.spr], e.x - s, e.y - s, s * 2, s * 2); break; }
        case E_RING: {
          const q = U.ease.outCubic(k), r = e.r * (0.15 + 0.85 * q);
          ctx.globalAlpha = (1 - k) * 0.95; ctx.strokeStyle = e.color; ctx.lineWidth = e.w * (1 - k) + 0.02;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, r, r * 0.72, 0, 0, TAU); ctx.stroke(); break;
        }
        case E_SHOCK: {
          const q = U.ease.outExpo(k), r = e.r * (0.1 + 0.9 * q);
          ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = e.color; ctx.lineWidth = e.w * (1 - k) * 2 + 0.03;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, r, r * 0.7, 0, 0, TAU); ctx.stroke();
          ctx.globalAlpha = (1 - k); ctx.strokeStyle = '#fff'; ctx.lineWidth = e.w * (1 - k) * 0.6 + 0.02;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, r * 0.96, r * 0.67, 0, 0, TAU); ctx.stroke(); break;
        }
        case E_BOLT: {
          const P2 = e.pts, a = (1 - k) * (rnd() < 0.25 ? 0.55 : 1);
          ctx.beginPath(); ctx.moveTo(P2[0], P2[1]); for (let j = 1; j <= e.n; j++) ctx.lineTo(P2[j * 2], P2[j * 2 + 1]);
          if (e.bn) { const b = (e.n + 1) * 2; ctx.moveTo(P2[b], P2[b + 1]); for (let j = 1; j < 5; j++) ctx.lineTo(P2[b + j * 2], P2[b + j * 2 + 1]); }
          ctx.strokeStyle = e.color; ctx.globalAlpha = a * 0.3; ctx.lineWidth = e.w * 3.4; ctx.stroke();
          ctx.globalAlpha = a * 0.9; ctx.lineWidth = e.w * 1.3; ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = a; ctx.lineWidth = e.w * 0.5; ctx.stroke(); break;
        }
        case E_TRAIL: {
          const dx = e.x2 - e.x, dy = e.y2 - e.y, L = Math.hypot(dx, dy) / 2 + e.w; if (L < 0.01) break;
          const c = dx / (L * 2 - e.w * 2 || 1) * A, s = dy / (L * 2 - e.w * 2 || 1) * A, w = e.w * (1 - k * 0.7);
          ctx.globalAlpha = (1 - k) * 0.85; ctx.setTransform(c, s, -s, c, A * (e.x + e.x2) / 2 + E, A * (e.y + e.y2) / 2 + F);
          ctx.drawImage(SPR[e.spr], -L, -w, L * 2, w * 2); ctx.setTransform(m); break;
        }
        case E_PILLAR: {
          const w = e.w * (k < 0.12 ? U.ease.outBack(k / 0.12) : 1 - (k - 0.12) / 0.88 * 0.75), h = e.r * (0.7 + 0.3 * U.ease.outCubic(Math.min(1, k * 3)));
          ctx.globalAlpha = Math.pow(1 - k, 0.7) * e.a; ctx.drawImage(SPR[e.spr], e.x - w / 2, e.y - h, w, h);
          ctx.globalAlpha *= 0.6; ctx.drawImage(SPR[e.spr], e.x - w * 0.18, e.y - h * 1.05, w * 0.36, h * 1.05); break;
        }
        case E_RAYS: {
          const s = e.r * (0.55 + 0.6 * U.ease.outCubic(k)), a = (k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88) * 0.85;
          const c = Math.cos(e.rot) * A, sn = Math.sin(e.rot) * A;
          ctx.globalAlpha = a; ctx.setTransform(c, sn, -sn, c, A * e.x + E, A * e.y + F); ctx.drawImage(SPR[e.spr], -s, -s, s * 2, s * 2); ctx.setTransform(m); break;
        }
        case E_SPIRAL: {
          const r = e.r * (0.3 + 0.7 * U.ease.outCubic(k)), base = e.rot + e.t * 9;
          ctx.strokeStyle = e.color; ctx.lineWidth = e.w * (1 - k) + 0.02; ctx.globalAlpha = (1 - k);
          ctx.beginPath(); for (let j = 0; j < 3; j++) { const a0 = base + j * TAU / 3; ctx.moveTo(e.x + Math.cos(a0) * r, e.y + Math.sin(a0) * r * 0.72); ctx.ellipse(e.x, e.y, r, r * 0.72, 0, a0, a0 + 1.5); } ctx.stroke();
          ctx.strokeStyle = '#fff'; ctx.lineWidth = e.w * 0.35 * (1 - k) + 0.01;
          ctx.beginPath(); for (let j = 0; j < 3; j++) { const a0 = base + 0.5 + j * TAU / 3, r2 = r * 0.7; ctx.moveTo(e.x + Math.cos(a0) * r2, e.y + Math.sin(a0) * r2 * 0.72); ctx.ellipse(e.x, e.y, r2, r2 * 0.72, 0, a0, a0 + 1.1); } ctx.stroke();
          break;
        }
        case E_SHIELD: { const s = e.r * (1 + 0.22 * k); ctx.globalAlpha = (1 - k); ctx.drawImage(SPR[e.spr], e.x - s, e.y - s * 1.04, s * 2, s * 2.08); break; }
        case E_FIREBALL: {
          const s = e.r * (0.5 + 0.65 * U.ease.outCubic(k)), a = (k < 0.08 ? 1 : Math.pow(1 - (k - 0.08) / 0.92, 1.6)) * e.a;
          const c = Math.cos(e.rot) * A, sn = Math.sin(e.rot) * A;
          ctx.globalAlpha = a; ctx.setTransform(c, sn, -sn, c, A * e.x + E, A * e.y + F); ctx.drawImage(SPR[e.spr], -s, -s, s * 2, s * 2); ctx.setTransform(m); break;
        }
        case E_GLINT: {
          const s = e.r * (k < 0.25 ? U.ease.outBack(k / 0.25) : 1 - (k - 0.25) / 0.75 * 0.6), c = Math.cos(e.rot) * A, sn = Math.sin(e.rot) * A;
          ctx.globalAlpha = k < 0.25 ? 1 : 1 - (k - 0.25) / 0.75; ctx.setTransform(c, sn, -sn, c, A * e.x + E, A * (e.y - 0.5) + F); ctx.drawImage(SPR[e.spr], -s, -s, s * 2, s * 2); ctx.setTransform(m); break;
        }
        case E_TORNADO: {
          // stacked spinning loops rising into a funnel
          const a0 = (k < 0.15 ? k / 0.15 : 1 - (k - 0.15) / 0.85), rise = U.ease.outCubic(k);
          ctx.strokeStyle = e.color;
          for (let j = 0; j < 5; j++) {
            const f = j / 4, rr0 = e.r * (0.45 + f * 1.1) * (0.6 + 0.4 * rise), yy = e.y - f * e.r * 2.4 * (0.4 + 0.6 * rise), st = e.rot + e.t * (11 - j) + j * 1.3;
            ctx.globalAlpha = a0 * (0.6 - f * 0.3); ctx.lineWidth = 0.1 + 0.06 * (1 - f);
            ctx.beginPath(); ctx.ellipse(e.x + Math.sin(e.t * 6 + j) * 0.12 * f, yy, rr0, rr0 * 0.32, 0, st, st + 3.6); ctx.stroke();
          }
          ctx.strokeStyle = '#ffffff'; ctx.globalAlpha = a0 * 0.6; ctx.lineWidth = 0.04;
          ctx.beginPath(); ctx.ellipse(e.x, e.y - e.r * 0.9 * rise, e.r * 0.8, e.r * 0.26, 0, e.rot + e.t * 12, e.rot + e.t * 12 + 2.4); ctx.stroke();
          break;
        }
      }
    }
    drawParticles(ctx, 1, A, E, F);
    ctx.setTransform(m);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // heat distortion: a ring of the already-drawn frame, re-drawn slightly magnified (lens ripple)
    if (heatN > 0 && !api.dbgNoHeat) {
      const cv = ctx.canvas, CW = cv.width, CH = cv.height;
      for (let i = 0; i < EL.length; i++) {
        const e = EL[i]; if (e.type !== E_HEAT || e.t <= 0) continue;
        const k = e.t / e.life, R = A * e.r * (0.15 + 0.95 * U.ease.outCubic(k)), w = R * 0.32 + 6, sx = A * e.x + E, sy = A * e.y + F;
        if (R < 6) continue;
        const ext = R + w, x0 = Math.max(0, sx - ext), y0 = Math.max(0, sy - ext * 0.72), x1 = Math.min(CW, sx + ext), y1 = Math.min(CH, sy + ext * 0.72);
        if (x1 - x0 < 4 || y1 - y0 < 4) continue;
        const z = 1 + 0.07 * (1 - k);
        ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.save();
        ctx.beginPath(); ctx.ellipse(sx, sy, ext, ext * 0.72, 0, 0, TAU); ctx.ellipse(sx, sy, Math.max(1, R - w), Math.max(1, (R - w) * 0.72), 0, 0, TAU, true); ctx.clip();
        ctx.globalAlpha = 0.85 * (1 - k);
        ctx.drawImage(cv, x0, y0, x1 - x0, y1 - y0, sx + (x0 - sx) * z, sy + (y0 - sy) * z, (x1 - x0) * z, (y1 - y0) * z);
        ctx.restore();
      }
      ctx.setTransform(m); ctx.globalAlpha = 1;
    }
  };
  const CA = { atlas: null, x: 0, y: 0, h: 2, face: null, anim: { state: 'walk', t: 0 }, flash: 1, filter: null, sx: 1, sy: 1, alpha: 1 };
  api.drawNumbers = ctx => drawNumbersImpl(ctx);

  /* screen overlays: hurt vignette, heartbeat, burst-ready glow, flashes, cut-in, boss intro */
  api.drawScreen = ctx => {
    const V = G.view, R = G.run, W = V.w, H = V.h, t = G.time;
    if (R && R.player) {
      const p = R.player, frac = p.maxHp ? p.hp / p.maxHp : 1;
      if (R.char && p.energy >= R.char.energyCost && !(p.burstCd > 0) && !cut.on) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.2 + 0.12 * Math.sin(t * 4);
        ctx.drawImage(SPR[MK.vignette((G.EL[R.char.element] || G.EL.pyro).color, 0.55)], 0, 0, W, H);
        ctx.globalCompositeOperation = 'source-over';
      }
      if (frac < 0.3 && p.hp > 0) {
        const per = 0.55 + frac * 1.2, ph = (t % per) / per;
        const beat = Math.exp(-ph * 12) + (ph > 0.22 ? 0.65 * Math.exp(-(ph - 0.22) * 12) : 0);
        ctx.globalAlpha = Math.min(1, (0.3 + 0.5 * beat) * (1.3 - frac / 0.3 * 0.6));
        ctx.drawImage(SPR[MK.vignette('#b0001a', 0.4)], 0, 0, W, H);
      }
    }
    if (hurtA > 0) { ctx.globalAlpha = Math.min(1, hurtA * 0.95); ctx.drawImage(SPR[MK.vignette('#d0001c', 0.3)], 0, 0, W, H); }
    // elemental-burst colour grade: warm the whole frame + glowing element edges while the burst rages
    if (gradeT > 0) {
      const g = Math.min(1, gradeT / 0.6, (GRADE_DUR - gradeT) / 0.25);
      if (!reduced()) { ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.34 * g; ctx.fillStyle = gradeCol; ctx.fillRect(0, 0, W, H); }
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (0.3 + 0.08 * Math.sin(t * 7)) * g;
      ctx.drawImage(SPR[MK.vignette(gradeCol, 0.5)], 0, 0, W, H);
      ctx.globalCompositeOperation = 'source-over';
    }
    // chromatic-aberration style fringe: red / cyan edge glows pulled apart
    if (aberr > 0.02) {
      const o = aberr * Math.min(W, H) * 0.018;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = aberr * 0.4;
      ctx.drawImage(SPR[MK.vignette('#ff1e3c', 0.62)], -o, -o * 0.4, W + o, H + o * 0.4);
      ctx.drawImage(SPR[MK.vignette('#1ee6ff', 0.62)], 0, 0, W + o, H + o * 0.4);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (bossFlash > 0.01) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = bossFlash * 0.32; ctx.fillStyle = '#b9a0ff'; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
    ctx.globalAlpha = 1;
    if (bi.on) drawBossIntro(ctx, V);
    if (cut.on) drawCutin(ctx, V);
    if (flashA > 0.005) { ctx.globalAlpha = flashA; ctx.fillStyle = flashColor; ctx.fillRect(0, 0, W, H); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  };

  api.clear = () => {
    np = 0; anims.clear(); effs.clear(); decals.clear(); timers.length = 0;
    for (const n of nums) n.on = false; for (const l of labels) l.on = false;
    trauma = pendTrauma = kickX = kickY = 0; hitstopT = hitstopCool = 0; slowT = 0; slowScale = 1; api.timeScale = 1;
    flashA = hurtA = 0; boomLoad = 0; cut.on = false; bi.on = false; zoomOwned = false; shieldCol = '#ffd24a';
    heatN = 0; aberr = 0; bossFlash = 0; gradeT = 0; kb.n = 0; kb.t = 0; kb.sx = kb.sy = 0;
    if (G.view && G.view.cam) { G.view.cam.zoom = 1; G.view.cam.punch = 0; }
  };
  /** reset time/camera feel without wiping particles (run end, menus) */
  api.resetFeel = () => {
    slowT = 0; slowScale = 1; api.timeScale = 1; hitstopT = hitstopCool = 0; trauma = pendTrauma = kickX = kickY = 0;
    cut.on = false; bi.on = false; if (G.view && G.view.cam) { G.view.cam.punch = 0; if (zoomOwned) G.view.cam.zoom = 1; } zoomOwned = false;
    aberr = 0; bossFlash = 0; gradeT = 0;
  };
  api.stats = () => ({ particles: np, effects: effs.list.length, anims: anims.list.length, decals: decals.list.length, numbers: nums.filter(n => n.on).length });
  api.cutinActive = () => cut.on;
  api.bossIntroActive = () => bi.on;

  /* ======================= bus fallbacks (de-duplicated against direct calls) ======================= */
  G.bus.on('assetsReady', () => {
    // pre-warm sprite caches so the first hit / explosion does not hitch
    for (const el in G.EL) elset(el);
    MK.scorch(0); MK.scorch(1); MK.scorch(2); MK.rays('#ffe9a8'); MK.rays('#ffffff'); MK.pillar('#ff9a1a'); MK.pillar('#ffb04a'); MK.hex('#ffd24a', G.EL.geo.light);
    MK.darkSmoke(0); MK.darkSmoke(1); MK.darkSmoke(2); MK.darkRim(); MK.soft('#6a2cc8', 0.9); MK.vignette('#d0001c', 0.3); MK.vignette('#b0001a', 0.4);
    for (const k in PAL) { MK.fireball(PAL[k][1], PAL[k][2]); MK.fireball(PAL[k][0], PAL[k][1]); MK.puff(PAL[k][3]); G.assets.tinted('fx_explosion', explFilter(k)); }
    MK.puff('#ffffff'); MK.puff('#e8fbff'); MK.puff('#d9d0ff'); MK.flare('#ffd54a'); MK.flare('#fff6c8'); MK.flare('#ffffff'); MK.flare('#e6fdff'); MK.flare('#ffe27a'); MK.ice();
    MK.vignette('#ff1e3c', 0.62); MK.vignette('#1ee6ff', 0.62);
  });
  G.bus.on('runStart', () => api.clear());
  let lastGulp = 0;
  G.bus.on('pickup', o => {
    const R = G.run; if (!R || !o || (o.type !== 'xp' && o.type !== 'mora' && o.type !== 'energy')) return;
    const now = G.time; if (now - lastGulp < 0.04) return; lastGulp = now;
    const p = R.player, v = o.value || 1, col = o.type === 'energy' ? '#ffffff' : o.type === 'mora' ? '#ffd24a' : v >= 40 ? '#ff6a8a' : v >= 10 ? '#ffd24a' : v >= 3 ? '#c28bff' : '#7fe3ff';
    P(K_GLOW, cset(col).core, 1, p.x + rr(-0.2, 0.2), p.y - 0.9 + rr(-0.3, 0.3), 0, -1.2, 0.22, 0.5, 1.4, 1, 0, 0.55);
  });
  G.bus.on('enemyHit', d => { const e = d && d.enemy; if (e) { e._fxEl = d.element; e._fxCrit = d.crit; } });
  G.bus.on('runEnd', () => api.resetFeel());
  G.bus.on('levelUp', () => { const R = G.run; if (R && R.player) api.levelUpBurst(R.player.x, R.player.y); });
  G.bus.on('bossSpawn', e => api.bossIntro(e));
  G.bus.on('burst', charId => {
    const R = G.run; const id = charId || (R && R.charId); const ch = G.data.characters[id]; if (ch) api.cutin(id, ch.burstName);
    gradeCol = ((ch && G.EL[ch.element]) || G.EL.pyro).color; gradeT = GRADE_DUR; aberration(0.6);
  });
  G.bus.on('revive', () => { const R = G.run; if (R && R.player) api.revive(R.player.x, R.player.y); });
  G.bus.on('shield', el => { if (el && G.EL[el]) shieldCol = G.EL[el].color; });
  G.bus.on('burstReady', () => {
    const R = G.run; if (!R || !R.player) return; const p = R.player, c = (G.EL[R.char.element] || G.EL.pyro).color;
    api.ring(p.x, p.y, 2.6, c); api.sparkle(p.x, p.y - 1, '#ffe0a0', 12, 0.9); api.zoomPunch(0.02);
  });
  G.bus.on('evolution', () => {
    const R = G.run; if (!R || !R.player) return; const p = R.player;
    api.pillar(p.x, p.y + 0.1, '#ffa62e', 13, 3.2, 1.4); api.rays(p.x, p.y - 1, 7, '#ffd08a', 1.2); api.flash('#fff4d0', 0.5); api.sparkle(p.x, p.y - 1, '#fff0a8', 36, 1.5);
  });
  G.bus.on('bossEnrage', e => { api.flash('#ff2a2a', 0.3); api.shake(0.8); if (e) { api.darkBurst(e.x, e.y, 3); api.shockwave(e.x, e.y, 8, '#ff4d6d'); } });
  G.bus.on('playerHurt', d => { const R = G.run; if (!R || !d) return; aberration(Math.min(0.6, 0.25 + (d.amount || 0) / Math.max(1, R.player.maxHp) * 2)); if (!d.src || d.src.x == null) return; api.kick(R.player.x - d.src.x, R.player.y - d.src.y, 7); });
  const reactCool = {};
  G.bus.on('reaction', d => {
    if (!d) return; const x = d.x, h = d.enemy && d.enemy.def ? d.enemy.def.h : 2, y = d.y - h * 0.45, m = budget(), red = reduced();
    // per-type throttle: chains of 50 reactions still read clearly without flooding the pool
    const now = G.time, ck = d.type; if (reactCool[ck] && now - reactCool[ck] < (m < 0.5 ? 0.12 : 0.04)) return; reactCool[ck] = now;
    switch (d.type) {
      case 'vaporize': { // billowing white steam + hot orange pop
        const sp = MK.puff('#ffffff');
        for (let k = 0, n = nn(red ? 3 : 7, m); k < n; k++) { const i = P(K_SMOKE, sp, 0, x + rr(-0.5, 0.5), y + rr(-0.3, 0.3), rr(-1.2, 1.2), rr(-1.5, -3.2), rr(0.8, 1.3), rr(0.35, 0.55), 2.8, 1.5, -1.2, 0.85); if (i < 0) break; pvr[i] = rr(-1.5, 1.5); }
        spray(nn(6, m), K_GLOW, cset('#bfe6ff').core, 1, x, y, 2, 5, 0.3, 0.5, 0.06, 0.1, 0.4, 1.5, 16, 1, -Math.PI / 2, 1.2, 3);
        const e = eff(E_BLOOM, x, y, 1.8, '#ffb27a', 0.35); if (e) { e.spr = MK.soft('#ffb27a', 0.9); e.a = 0.8; }
        if (!red) anim('water', x, y + 0.2, 1.6, 0.4, { alpha: 0.8 }); api.hitSpark(x, y, 'pyro', true); break;
      }
      case 'melt': { // ice shards melting in a warm glow, drips falling
        const e = eff(E_BLOOM, x, y, 2, '#ffcf9a', 0.4); if (e) { e.spr = MK.soft('#ffb070', 0.9); e.a = 0.9; }
        const c = elset('cryo'); spray(nn(6, m), K_ROT, c.shard, 0, x, y, 2, 6, 0.35, 0.6, 0.12, 0.2, 0.2, 2, 10, 1, 0, 0, 3);
        spray(nn(8, m), K_GLOW, cset('#9fe8ff').core, 1, x, y, 0.5, 2, 0.4, 0.7, 0.05, 0.08, 0.6, 1, 14, 1);
        for (let k = 0, n = nn(7, m); k < n; k++) { const i = P(K_WISP, cset('#ff9a52').coreL, 1, x + rr(-0.5, 0.5), y + rr(-0.3, 0.3), rr(-0.5, 0.5), rr(-2, -3.5), rr(0.5, 0.9), rr(0.07, 0.12), 0.2, 1, -1, 1); if (i < 0) break; pw[i] = rr(0.08, 0.2); }
        api.hitSpark(x, y, 'pyro', true); break;
      }
      case 'overloaded': { // crimson-violet blast (explosion itself comes from combat) + crackling arcs
        const e = eff(E_BLOOM, x, y, 3, '#ff4d9a', 0.35); if (e) { e.spr = MK.soft('#ff4d9a', 0.9); e.a = 0.7; }
        for (let k = 0; k < 2; k++) { const a = rnd() * TAU, L = rr(1.2, 2.2); bolt(x, y, x + Math.cos(a) * L, y + Math.sin(a) * L * 0.7, '#ff7ae0', 0.08, 0.2, true); }
        break;
      }
      case 'electrocharged': { // arcs leap to nearby foes
        api.zap(x, y);
        const R = G.run; if (!R) break; let arcs = 0;
        for (let i = 0, n = Math.min(R.enemies.length, 160); i < n && arcs < 3; i++) {
          const t = R.enemies[i]; if (t === d.enemy || t.dead) continue; const dx = t.x - d.x, dy = t.y - d.y; if (dx * dx + dy * dy > 12) continue;
          bolt(x, y, t.x, t.y - (t.def ? t.def.h * 0.45 : 0.9), '#d59bff', 0.07, 0.2, false); arcs++;
          P(K_GLOW, cset('#d59bff').core, 1, t.x, t.y - (t.def ? t.def.h * 0.45 : 0.9), 0, 0, 0.16, 0.55, 1.3, 0, 0, 1);
        }
        break;
      }
      case 'frozen': { // encased in an ice block, frost mist at the feet
        const c = elset('cryo'); spray(nn(8, m), K_ROT, c.shard, 0, x, y, 2, 6, 0.4, 0.7, 0.14, 0.24, 0.6, 2.5, 8, 1, 0, 0, 2);
        if (effs.list.length < 520) { const e = eff(E_ICE, d.x, d.y + 0.05, Math.min(1.6, h * 0.55 + 0.2), '#bff4ff', 1.1); if (e) e.spr = MK.ice(); }
        api.ring(d.x, d.y, 1.6, '#bff4ff');
        if (!red) { const sp = MK.puff('#e8fbff'); for (let k = 0, n = nn(4, m); k < n; k++) { const a = rnd() * TAU; const i = P(K_SMOKE, sp, 0, d.x + Math.cos(a) * 0.6, d.y + Math.sin(a) * 0.3, Math.cos(a) * 1.2, Math.sin(a) * 0.5, rr(0.7, 1.1), rr(0.3, 0.45), 2.4, 1.5, 0, 0.7); if (i < 0) break; } }
        glint(x, y - 0.2, 1.1, '#e6fdff', 0.3); break;
      }
      case 'superconduct': { // purple cold nova hugging the ground
        let e = eff(E_SHOCK, d.x, d.y, 3.4, '#b39bff', 0.5); if (e) e.w = 0.3;
        e = eff(E_GROUNDGLOW, d.x, d.y, 3, '#9d8bff', 0.6); if (e) e.spr = MK.soft('#9d8bff', 0.8);
        if (!red) { const sp = MK.puff('#d9d0ff'); for (let k = 0, n = nn(8, m); k < n; k++) { const a = k / 8 * TAU; const i = P(K_SMOKE, sp, 0, d.x + Math.cos(a) * 0.5, d.y + Math.sin(a) * 0.35, Math.cos(a) * 4, Math.sin(a) * 2.6, rr(0.6, 0.9), rr(0.3, 0.4), 2.6, 2.5, 0, 0.7); if (i < 0) break; } }
        spray(nn(8, m), K_ROT, elset('cryo').shard, 0, x, y, 3, 7, 0.4, 0.6, 0.1, 0.16, 0.4, 2, 6, 1, 0, 0, 2);
        api.zap(x, y, '#c6b9ff'); break;
      }
      case 'swirl': break; // G.fx.swirl (tinted tornado) is called by combat with the swirled element colour
      case 'crystallize': { // geo shards + golden glint
        api.hitSpark(x, y, 'geo', true); glint(x, y, 1.2, '#ffe27a', 0.3);
        spray(nn(6, m), K_ROT, elset('geo').shard, 0, x, y, 3, 7, 0.4, 0.7, 0.12, 0.2, 0.5, 2, 12, 1, -Math.PI / 2, 1.2, 3);
        break;
      }
      case 'shatter': { // ice block bursts: big shards, white glint, shockwave, lens fringe
        const c = elset('cryo'); spray(nn(18, m), K_ROT, c.shard, 0, x, y, 4, 12, 0.45, 0.8, 0.16, 0.3, 0.5, 2.5, 14, 1, 0, 0, 3);
        spray(nn(8, m), K_STREAK, cset('#ffffff').streak, 1, x, y, 6, 12, 0.15, 0.3, 0.08, 0.14, 0.3, 4, 0, 1);
        api.shockwave(d.x, d.y, 2.6, '#e8fbff'); glint(x, y, 1.6, '#ffffff', 0.32); api.hitstop(0.05); aberration(0.35); break;
      }
    }
  });
  return api;
})();
