/* render.js — canvas setup, camera, world→screen transform, floor, actor sprites, draw orchestration.
   World units: 1 unit ≈ one Luanti node. Screen shows G.cfg.viewUnits units vertically. */
'use strict';
G.view = { canvas: null, ctx: null, w: 0, h: 0, dpr: 1, scale: 40, cam: { x: 0, y: 0, zoom: 1, punch: 0 } };

G.render = (function () {
  const V = G.view;
  let floorPattern = null, decorCache = new Map();

  /* ---- adaptive quality (owner: VFX/perf) ----
     level 3: full (dpr ≤ 2) · 2: dpr 1, full ambience · 1: dpr 1, light ambience · 0: no ambience, fewer particles.
     G.quality.auto steps down when fps < 45 for ~2 s and back up after a long stable stretch. */
  const Q = G.quality = G.quality || { level: 3, auto: true, max: 3, init: false };
  function qLevel() { return G.save.data.settings.reducedFx ? 0 : Q.level; }
  function resize() {
    const c = V.canvas;
    const touch = !!(G.input && G.input.touchMode) || (window.matchMedia && matchMedia('(pointer:coarse)').matches);
    if (!Q.init) { Q.init = true; Q.level = touch ? 2 : 3; }
    const lv = qLevel();
    V.dpr = Math.min(window.devicePixelRatio || 1, lv >= 3 ? (touch ? 1.5 : 2) : 1);
    V.w = window.innerWidth; V.h = window.innerHeight;
    c.width = Math.round(V.w * V.dpr); c.height = Math.round(V.h * V.dpr);
    c.style.width = V.w + 'px'; c.style.height = V.h + 'px';
    // keep roughly the same world area on every device; phones in landscape get a slightly closer camera
    const units = G.cfg.viewUnits * (V.h < 500 ? 0.92 : 1);
    V.scale = V.h / units;
    floorPattern = null;
  }
  const AQ = { low: 0, high: 0, last: 0, hold: 0, holdLen: 12 };
  function setQuality(l) {
    l = Math.max(0, Math.min(Q.max, l)); if (l === Q.level) return;
    Q.level = l; resize(); G.bus.emit('quality', l);
  }
  function adaptQuality() {
    const now = G.time || 0, dt = now - AQ.last; AQ.last = now;
    if (!Q.auto || !(dt > 0) || dt > 0.5 || G.game.isPaused() || G.save.data.settings.reducedFx) { AQ.low = AQ.high = 0; return; }
    const f = G.fps || 60;
    if (f < 45) { AQ.low += dt; AQ.high = 0; if (AQ.low > 2 && Q.level > 0) { AQ.low = 0; AQ.hold = now + AQ.holdLen; AQ.holdLen = Math.min(120, AQ.holdLen * 2); setQuality(Q.level - 1); } }
    else if (f > 57) { AQ.high += dt; AQ.low = Math.max(0, AQ.low - dt); if (AQ.high > 8 && now > AQ.hold && Q.level < Q.max) { AQ.high = 0; setQuality(Q.level + 1); } }
    else { AQ.low = Math.max(0, AQ.low - dt * 0.5); AQ.high = 0; }
  }

  /* ---- actor sprites ---- */
  function dirRow(fx, fy) { if (Math.abs(fx) > Math.abs(fy)) return fx < 0 ? 1 : 2; return fy < 0 ? 3 : 0; }
  const STATE_COL = { idle: 0, walk: 2, attack: 4, skill: 6, burst: 6, hurt: 0 };
  /**
   * Draw an actor frame. a: {atlas, x, y, h (world height of the 160px cell), face:{x,y}, anim:{state,t}, flash, alpha, sx, sy, filter}
   */
  const customActors = {}; // atlas/charId -> draw(ctx, a) for characters without a sprite sheet (e.g. xingqiu.js)
  function drawActor(ctx, a) {
    // characters drawn from their icon: either asked for by atlas, or the player drawn with the default 'amber' atlas
    let ca = customActors[a.atlas];
    if (!ca && a.atlas === 'amber') { const R = G.run; if (R && R.charId !== 'amber' && R.player && a.x === R.player.x && a.y === R.player.y) ca = customActors[R.charId]; }
    if (ca) { ca(ctx, a); return; }
    const meta = G.assets.actors[a.atlas]; if (!meta) return;
    let img = a.filter ? G.assets.tinted('actor_' + a.atlas, a.filter) : G.assets.img['actor_' + a.atlas];
    if (!img) return;
    const row = a.row != null ? a.row : dirRow(a.face ? a.face.x : 0, a.face ? a.face.y : 1);
    const st = (a.anim && a.anim.state) || 'idle';
    let base = STATE_COL[st] || 0; if (base >= meta.cols) base = 4;
    const t = (a.anim && a.anim.t) || 0;
    const fps = st === 'walk' ? 7 : st === 'idle' ? 2.2 : 5;
    const col = base + (Math.floor(t * fps) & 1);
    const cell = meta.cell, size = a.h || 2.2;
    const sx = (a.sx || 1) * size, sy = (a.sy || 1) * size;
    const dx = a.x - sx / 2, dy = a.y - sy + size * 0.07;
    const prevA = ctx.globalAlpha; if (a.alpha != null) ctx.globalAlpha = prevA * a.alpha;
    ctx.drawImage(img, col * cell, row * cell, cell, cell, dx, dy, sx, sy);
    if (a.flash > 0 && G.assets.white[a.atlas]) {
      ctx.globalAlpha = prevA * Math.min(1, a.flash);
      ctx.drawImage(G.assets.white[a.atlas], col * cell, row * cell, cell, cell, dx, dy, sx, sy);
    }
    ctx.globalAlpha = prevA;
  }

  /** soft elliptical shadow under actors */
  function shadow(ctx, x, y, r, alpha) {
    const im = ambSprites().shadow;
    ctx.globalAlpha = Math.min(1, (alpha == null ? 0.28 : alpha) * 1.55);
    ctx.drawImage(im, x - r * 1.3, y - r * 0.5, r * 2.6, r * 1.0);
    ctx.globalAlpha = 1;
  }

  /** icon sprite centred at (x,y) with world size s */
  function icon(ctx, name, x, y, s, rot, alpha) {
    const im = G.assets.img['icon_' + name]; if (!im) return;
    const w = s, h = s * im.height / im.width;
    if (alpha != null) ctx.globalAlpha = alpha;
    if (rot) { ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.drawImage(im, -w / 2, -h / 2, w, h); ctx.restore(); }
    else ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
    if (alpha != null) ctx.globalAlpha = 1;
  }

  /* ---- floor & ambient world (owner: VFX) ----
     Soft, low-contrast meadow so gameplay effects pop: pre-softened floor tile at ~1:1 texel scale,
     a huge macro light/dark variation layer, swaying decor, rolling wind-gust light bands,
     Genshin-style wind ribbons, drifting dandelion seeds & petals, moving cloud shadows,
     and a screen-space colour grade that turns day → golden hour → sunset over the 10 minutes. */
  const CH = 10; // chunk size in units
  const WX = 0.94, WY = 0.34;                  // wind direction (unit-ish)
  const GUST_L = 30, GUST_V = 7.5, GUST_W = 3.2; // gust band spacing / speed / half-width (units)
  const FLOOR_TILE = 16, MACRO_TILE = 70;
  let floorImg = null, macroImg = null, macroPattern = null;
  const amb = { seeds: [], ribbons: [], flies: [], glints: [], lastT: 0, spr: null };
  function hash(x, y) { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
  /** small deterministic PRNG (mulberry32) */
  function prng(seed) { let a = seed | 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function mkc(w, h) { return G.assets.makeCanvas(w, h); }
  function softDot(x, cx, cy, r, col, a) { const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, `rgba(${col},${a})`); g.addColorStop(1, `rgba(${col},0)`); x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2); }

  function buildFloor() {
    const im = G.assets.img.floor; if (!im) return null;
    const w = im.width, h = im.height, M = 8;
    // wrap-padded copy so the blur tiles seamlessly
    const pad = mkc(w + M * 2, h + M * 2), p = pad.getContext('2d');
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) p.drawImage(im, M + i * w, M + j * h);
    const c = mkc(w, h), x = c.getContext('2d');
    const hasFilter = 'filter' in x;
    if (hasFilter) x.filter = 'saturate(0.78) contrast(0.62) brightness(1.05)';
    x.drawImage(pad, -M, -M);
    if (hasFilter) { x.filter = 'blur(2.4px) saturate(0.8) contrast(0.6)'; x.globalAlpha = 0.72; x.drawImage(pad, -M, -M); x.filter = 'none'; }
    else { x.globalAlpha = 0.3; x.drawImage(pad, -M + 1, -M); x.drawImage(pad, -M, -M + 1); }
    x.globalAlpha = 0.3; x.fillStyle = '#6aa84e'; x.fillRect(0, 0, w, h);
    x.globalAlpha = 1;
    return c;
  }
  function buildMacro() {
    const S = 256, c = mkc(S, S), x = c.getContext('2d');
    const rnd = prng(37);
    for (let i = 0; i < 34; i++) {
      const cx = rnd() * S, cy = rnd() * S, r = 18 + rnd() * 30, light = rnd() > 0.45;
      const col = light ? '246,255,170' : '20,70,34', a = light ? 0.26 : 0.22;
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) softDot(x, cx + dx * S, cy + dy * S, r, col, a);
    }
    // a few warm sun-dappled patches
    for (let i = 0; i < 6; i++) { const cx = rnd() * S, cy = rnd() * S, r = 12 + rnd() * 16; for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) softDot(x, cx + dx * S, cy + dy * S, r, '255,236,160', 0.18); }
    return c;
  }
  function ambSprites() {
    if (amb.spr) return amb.spr;
    const seed = mkc(32, 32), a = seed.getContext('2d');
    a.strokeStyle = 'rgba(255,255,255,.85)'; a.lineWidth = 1.3;
    a.beginPath(); for (let i = 0; i < 9; i++) { const an = -Math.PI / 2 + (i - 4) * 0.33; a.moveTo(16, 18); a.lineTo(16 + Math.cos(an) * 11, 18 + Math.sin(an) * 11); } a.stroke();
    softDot(a, 16, 12, 9, '255,255,255', 0.55);
    a.strokeStyle = 'rgba(210,200,160,.9)'; a.lineWidth = 1.5; a.beginPath(); a.moveTo(16, 18); a.lineTo(16, 30); a.stroke();
    const petal = mkc(24, 16), b = petal.getContext('2d');
    b.fillStyle = '#ffe3ee'; b.beginPath(); b.ellipse(12, 8, 10, 5.5, 0, 0, Math.PI * 2); b.fill();
    b.fillStyle = 'rgba(255,170,200,.8)'; b.beginPath(); b.ellipse(15, 8, 6, 3.5, 0, 0, Math.PI * 2); b.fill();
    const petalW = mkc(24, 16), b2 = petalW.getContext('2d');
    b2.fillStyle = '#fffdf2'; b2.beginPath(); b2.ellipse(12, 8, 10, 5, 0, 0, Math.PI * 2); b2.fill();
    b2.fillStyle = 'rgba(255,230,140,.8)'; b2.beginPath(); b2.ellipse(6, 8, 4, 3, 0, 0, Math.PI * 2); b2.fill();
    const band = mkc(128, 32), c = band.getContext('2d'); c.scale(1, 0.25); softDot(c, 64, 64, 64, '255,250,200', 1);
    const cloud = mkc(256, 160), d = cloud.getContext('2d');
    const rnd = prng(71);
    for (let i = 0; i < 9; i++) softDot(d, 60 + rnd() * 136, 50 + rnd() * 60, 36 + rnd() * 30, '6,24,14', 0.5);
    const shadow = mkc(64, 32), e = shadow.getContext('2d'); e.scale(1, 0.5);
    const g = e.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(6,18,8,.95)'); g.addColorStop(0.5, 'rgba(6,18,8,.6)'); g.addColorStop(1, 'rgba(6,18,8,0)'); e.fillStyle = g; e.fillRect(0, 0, 64, 64);
    const beam = mkc(64, 256), f = beam.getContext('2d');
    const hg = f.createLinearGradient(0, 0, 64, 0); hg.addColorStop(0, 'rgba(255,240,190,0)'); hg.addColorStop(0.5, 'rgba(255,240,190,1)'); hg.addColorStop(1, 'rgba(255,240,190,0)'); f.fillStyle = hg; f.fillRect(0, 0, 64, 256);
    f.globalCompositeOperation = 'destination-in'; const vg = f.createLinearGradient(0, 0, 0, 256); vg.addColorStop(0, 'rgba(0,0,0,1)'); vg.addColorStop(1, 'rgba(0,0,0,0)'); f.fillStyle = vg; f.fillRect(0, 0, 64, 256);
    const vig = mkc(256, 256), v = vig.getContext('2d'); const rg = v.createRadialGradient(128, 128, 0, 128, 128, 181);
    rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(0.55, 'rgba(0,0,0,0)'); rg.addColorStop(0.85, 'rgba(0,0,0,.55)'); rg.addColorStop(1, 'rgba(0,0,0,.9)'); v.fillStyle = rg; v.fillRect(0, 0, 256, 256);
    const sky = mkc(4, 256), k = sky.getContext('2d'); const sg = k.createLinearGradient(0, 0, 0, 256);
    sg.addColorStop(0, 'rgba(255,255,255,1)'); sg.addColorStop(0.55, 'rgba(255,255,255,.25)'); sg.addColorStop(1, 'rgba(255,255,255,0)'); k.fillStyle = sg; k.fillRect(0, 0, 4, 256);
    const skyTint = new Map();
    // butterflies: 3 colours × 2 wing frames (open / folded)
    const fly = [];
    for (const [c1, c2] of [['#fff7d6', '#ffcf4a'], ['#e8f6ff', '#7ec8ff'], ['#ffe6f0', '#ff8ab8']]) {
      const fr = [];
      for (let f = 0; f < 2; f++) {
        const cv = mkc(32, 24), q = cv.getContext('2d'); q.translate(16, 12);
        const w = f ? 0.35 : 1;
        for (const sx of [-1, 1]) {
          q.save(); q.scale(sx * w, 1);
          const g = q.createLinearGradient(0, 0, 13, 0); g.addColorStop(0, c2); g.addColorStop(1, c1);
          q.fillStyle = g; q.beginPath(); q.ellipse(7, -4, 7.5, 6, -0.5, 0, Math.PI * 2); q.fill();
          q.beginPath(); q.ellipse(5.5, 5, 5, 4, 0.5, 0, Math.PI * 2); q.fill();
          q.restore();
        }
        q.fillStyle = '#4a3a2a'; q.fillRect(-0.8, -6, 1.6, 12);
        fr.push(cv);
      }
      fly.push(fr);
    }
    const glint = mkc(32, 32), gq = glint.getContext('2d'); softDot(gq, 16, 16, 7, '255,255,240', 0.9);
    gq.fillStyle = 'rgba(255,255,240,.9)'; gq.fillRect(15, 2, 2, 28); gq.fillRect(2, 15, 28, 2);
    amb.spr = { seed, petal, petalW, band, cloud, shadow, beam, vig, sky, skyTint, fly, glint };
    return amb.spr;
  }
  /** cached tinted copy of the sky gradient */
  function skyOf(col) { const S = ambSprites(); let c = S.skyTint.get(col); if (c) return c; c = mkc(4, 256); const x = c.getContext('2d'); x.drawImage(S.sky, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = col; x.fillRect(0, 0, 4, 256); S.skyTint.set(col, c); return c; }

  /** animated decor per chunk (tufts & dandelions sway in the wind); static flowers/stones are baked into the floor texture */
  function chunkDecor(cx, cy) {
    const k = cx + ',' + cy; let d = decorCache.get(k); if (d) return d;
    d = []; const rnd = prng((hash(cx, cy) * 4294967296) | 0);
    const n = 5 + Math.floor(rnd() * 5);
    for (let i = 0; i < n; i++) { const r = rnd(); d.push({ x: cx * CH + rnd() * CH, y: cy * CH + rnd() * CH, t: r < 0.68 ? 'tuft' : 'dandelion', v: rnd() }); }
    if (decorCache.size > 400) decorCache.clear();
    decorCache.set(k, d); return d;
  }
  /* static decor baked into the floor texture (period = texture size) */
  function drawStaticDecor(x, o) {
    const TAU = Math.PI * 2;
    if (o.t === 'flower') {
      x.fillStyle = 'rgba(30,70,30,.25)'; x.beginPath(); x.ellipse(o.x, o.y + 0.08, 0.16, 0.06, 0, 0, TAU); x.fill();
      x.fillStyle = o.v > 0.5 ? '#fbfff4' : '#fff1c2';
      for (let p = 0; p < 5; p++) { const a = p / 5 * TAU + o.v * 3; x.beginPath(); x.arc(o.x + Math.cos(a) * 0.085, o.y + Math.sin(a) * 0.075, 0.068, 0, TAU); x.fill(); }
      x.fillStyle = '#ffc93c'; x.beginPath(); x.arc(o.x, o.y, 0.048, 0, TAU); x.fill();
    } else if (o.t === 'stone') {
      x.fillStyle = 'rgba(20,50,25,.25)'; x.beginPath(); x.ellipse(o.x + 0.05, o.y + 0.06, 0.26 + o.v * 0.12, 0.12, 0, 0, TAU); x.fill();
      x.fillStyle = '#9a9d90'; x.beginPath(); x.ellipse(o.x, o.y, 0.22 + o.v * 0.12, 0.14 + o.v * 0.06, 0, 0, TAU); x.fill();
      x.fillStyle = '#c4c7b8'; x.beginPath(); x.ellipse(o.x - 0.05, o.y - 0.04, 0.12 + o.v * 0.06, 0.07, 0, 0, TAU); x.fill();
    } else if (o.t === 'path') {
      x.fillStyle = 'rgba(214,194,140,.1)'; x.beginPath(); x.ellipse(o.x, o.y, 1.1, 0.5, o.v, 0, TAU); x.fill();
    }
  }
  const FT = { tex: null, pat: null, ppu: 0, units: 0, key: '' };
  function ensureFloorTex() {
    const S = V.scale * V.dpr;
    const units = S * 32 <= 2048 ? 32 : 16;
    const tp = Math.round(Math.min(S, 2048 / units) * FLOOR_TILE), N = tp * (units / FLOOR_TILE);
    const key = N + '|' + units;
    if (FT.key === key && FT.tex) return FT;
    if (!floorImg && G.assets.img.floor) floorImg = buildFloor();
    if (!floorImg) return null;
    const c = mkc(N, N), x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    for (let i = 0; i < units / FLOOR_TILE; i++) for (let j = 0; j < units / FLOOR_TILE; j++) x.drawImage(floorImg, i * tp, j * tp, tp, tp);
    if (!macroImg) macroImg = buildMacro();
    x.globalAlpha = 0.85; x.drawImage(macroImg, 0, 0, N, N); x.globalAlpha = 1;
    // deterministic static decor, drawn wrapped so the texture tiles seamlessly
    const k = N / units; const rnd = prng(123457);
    const items = [], area = units * units / 100;
    for (let i = 0; i < area * 0.5; i++) items.push({ x: rnd() * units, y: rnd() * units, t: 'path', v: rnd() * 3 });
    for (let i = 0; i < area * 1.2; i++) items.push({ x: rnd() * units, y: rnd() * units, t: 'stone', v: rnd() });
    for (let i = 0; i < area * 5; i++) items.push({ x: rnd() * units, y: rnd() * units, t: 'flower', v: rnd() });
    for (let i = 0; i < area * 0.4; i++) { const fx = rnd() * units, fy = rnd() * units; for (let j = 0; j < 7; j++) items.push({ x: fx + (rnd() - 0.5) * 2.6, y: fy + (rnd() - 0.5) * 1.6, t: 'flower', v: rnd() }); }
    for (const o of items) for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      const px = o.x + ox * units, py = o.y + oy * units; if (px < -1.5 || py < -1.5 || px > units + 1.5 || py > units + 1.5) continue;
      x.setTransform(k, 0, 0, k, 0, 0); drawStaticDecor(x, { x: px, y: py, t: o.t, v: o.v });
    }
    FT.tex = c; FT.pat = null; FT.key = key; FT.units = units; FT.ppu = k;
    return FT;
  }
  /** wind gust intensity (0..1) at a world point — bands rolling across the meadow */
  function gust(x, y, t) {
    const u = x * WX + y * WY - t * GUST_V, ph = ((u / GUST_L) % 1 + 1) % 1, d = Math.min(ph, 1 - ph) * GUST_L / GUST_W;
    return Math.exp(-d * d);
  }
  function fillPattern(ctx, pat, img, tile, cam, halfW, halfH) {
    ctx.save();
    ctx.scale(tile / img.width, tile / img.height);
    ctx.fillStyle = pat;
    const k = img.width / tile;
    ctx.fillRect((cam.x - halfW) * k, (cam.y - halfH) * k, halfW * 2 * k, halfH * 2 * k);
    ctx.restore();
  }
  function drawFloor(ctx) {
    const cam = V.cam, S = V.scale * cam.zoom;
    const halfW = V.w / 2 / S + 2, halfH = V.h / 2 / S + 2;
    const TAU = G.u.TAU, lv = qLevel();
    // baked floor texture drawn in device space at 1:1 texel scale (fast blit path; scaled only during zoom)
    const F = ensureFloorTex(), m = ctx.getTransform();
    if (F) {
      if (!F.pat) F.pat = ctx.createPattern(F.tex, 'repeat');
      let sc = m.a / F.ppu; const tile = F.tex.width * sc;
      let ox = ((m.e % tile) + tile) % tile - tile, oy = ((m.f % tile) + tile) % tile - tile;
      if (Math.abs(sc - 1) < 0.004) { sc = 1; ox = Math.round(ox); oy = Math.round(oy); }
      ctx.setTransform(sc, 0, 0, sc, ox, oy); ctx.fillStyle = F.pat;
      ctx.fillRect(0, 0, (V.canvas.width - ox) / sc + 2, (V.canvas.height - oy) / sc + 2);
      ctx.setTransform(m);
    } else { ctx.fillStyle = '#4f8a40'; ctx.fillRect(cam.x - halfW, cam.y - halfH, halfW * 2, halfH * 2); }
    const now = G.time || 0;
    const x0 = Math.floor((cam.x - halfW) / CH), x1 = Math.floor((cam.x + halfW) / CH), y0 = Math.floor((cam.y - halfH) / CH), y1 = Math.floor((cam.y + halfH) / CH);
    if (lv >= 1) for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
      for (const o of chunkDecor(cx, cy)) {
        if (o.x < cam.x - halfW - 1 || o.x > cam.x + halfW + 1 || o.y < cam.y - halfH - 1 || o.y > cam.y + halfH + 1) continue;
        const gs = gust(o.x, o.y, now);
        if (o.t === 'tuft') {
          ctx.strokeStyle = o.v > 0.5 ? 'rgba(170,222,110,.9)' : 'rgba(92,158,70,.9)'; ctx.lineWidth = 0.05;
          const sway = Math.sin(now * 2 + o.y) * 0.06 + gs * 0.26;
          ctx.beginPath();
          for (let b = -2; b <= 2; b++) { ctx.moveTo(o.x + b * 0.07, o.y); ctx.quadraticCurveTo(o.x + b * 0.1 + sway * 0.4, o.y - 0.2, o.x + b * 0.14 + sway * WX, o.y - 0.36 + Math.abs(b) * 0.04 + sway * WY * 0.4); }
          ctx.stroke();
        } else {
          const sway = Math.sin(now * 1.3 + o.x) * 0.04 + gs * 0.14;
          ctx.strokeStyle = '#6ea35a'; ctx.lineWidth = 0.035; ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.quadraticCurveTo(o.x, o.y - 0.25, o.x + sway, o.y - 0.42); ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.beginPath(); ctx.arc(o.x + sway, o.y - 0.47, 0.17, 0, TAU); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(o.x + sway, o.y - 0.47, 0.1, 0, TAU); ctx.fill();
        }
      }
    }
    // rolling gust light bands across the grass (heavy ambience: top tier only)
    if (lv >= 3) {
      const A = ambSprites(), camU = cam.x * WX + cam.y * WY, span = Math.hypot(halfW, halfH) * 2.2;
      const nMin = Math.floor((camU - span / 2 - now * GUST_V) / GUST_L), nMax = Math.ceil((camU + span / 2 - now * GUST_V) / GUST_L);
      ctx.globalCompositeOperation = 'lighter';
      const ang = Math.atan2(WY, WX) + Math.PI / 2;
      ctx.globalAlpha = 0.075;
      for (let n = nMin; n <= nMax; n++) {
        const uc = n * GUST_L + now * GUST_V, off = uc - camU, bx = cam.x + WX * off, by = cam.y + WY * off;
        ctx.translate(bx, by); ctx.rotate(ang);
        ctx.drawImage(A.band, -span / 2, -GUST_W * 1.3, span, GUST_W * 2.6);
        ctx.rotate(-ang); ctx.translate(-bx, -by);
      }
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
  }

  /** world-space ambience drawn above actors: cloud shadows, wind ribbons, drifting seeds & petals */
  function drawAmbientWorld(ctx) {
    const lv = qLevel(); if (lv < 1) return;
    const A = ambSprites(), cam = V.cam, S = V.scale * cam.zoom, now = G.time || 0;
    const halfW = V.w / 2 / S, halfH = V.h / 2 / S;
    const dt = Math.min(0.1, Math.max(0, now - amb.lastT)); amb.lastT = now;
    // cloud shadows drifting with the wind (wrapped in a 96-unit tile around the camera)
    const T = 96;
    for (let i = 0; i < 0; i++) { // cloud shadows disabled (fill-rate heavy, read as spotlights)
      const bx = i * 37 + now * 1.6 * WX, by = i * 53 + now * 1.6 * WY;
      const cx = cam.x + ((bx - cam.x) % T + T * 1.5) % T - T / 2, cy = cam.y + ((by - cam.y) % T + T * 1.5) % T - T / 2;
      ctx.globalAlpha = 0.22; ctx.drawImage(A.cloud, cx - 13, cy - 8, 26, 16);
    }
    ctx.globalAlpha = 1;
    // wind ribbons
    const R = amb.ribbons;
    if (R.length < (lv >= 2 ? 3 : 1) && Math.random() < dt * 0.9) {
      R.push({ x: cam.x - WX * (halfW + 4) + (Math.random() - 0.5) * halfW * 1.6, y: cam.y + (Math.random() - 0.5) * halfH * 1.8 - WY * halfW, t: 0, life: 2.4 + Math.random() * 1.2, amp: 0.35 + Math.random() * 0.5, fr: 0.5 + Math.random() * 0.4, ph: Math.random() * 6, len: 7 + Math.random() * 5, loop: Math.random() < 0.45 });
    }
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.strokeStyle = '#ffffff';
    const nx = -WY, ny = WX;
    for (let i = R.length - 1; i >= 0; i--) {
      const r = R[i]; r.t += dt; if (r.t >= r.life) { R.splice(i, 1); continue; }
      r.x += WX * 11 * dt; r.y += WY * 11 * dt;
      const env = Math.sin(Math.PI * r.t / r.life), N = 18, seg = r.len / N;
      for (let part = 0; part < 3; part++) {
        ctx.globalAlpha = env * (part === 1 ? 0.5 : 0.25); ctx.lineWidth = part === 1 ? 0.07 : 0.045;
        ctx.beginPath();
        for (let j = part * 6; j <= part * 6 + 6; j++) {
          const s = j * seg, w = Math.sin(r.ph + s * r.fr + r.t * 2) * r.amp;
          let x = r.x - WX * s + nx * w, y = r.y - WY * s + ny * w;
          if (r.loop && j >= 6 && j <= 12) { const a = (j - 6) / 6 * Math.PI * 2; x += Math.cos(a) * 0.6 - 0.6; y += Math.sin(a) * 0.6; }
          j === part * 6 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // drifting dandelion seeds & petals
    const SD = amb.seeds, mx = halfW + 1.5, my = halfH + 1.5;
    const nSeed = lv >= 2 ? 34 : 14; if (SD.length > nSeed) SD.length = nSeed;
    while (SD.length < nSeed) SD.push({ x: cam.x + (Math.random() * 2 - 1) * mx, y: cam.y + (Math.random() * 2 - 1) * my, k: Math.random() < 0.55 ? 0 : Math.random() < 0.5 ? 1 : 2, ph: Math.random() * 6, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 3, s: 0.22 + Math.random() * 0.16 });
    for (const o of SD) {
      const g = gust(o.x, o.y, now);
      o.x += (WX * (1.1 + g * 3.5) + Math.sin(now * 0.9 + o.ph) * 0.35) * dt;
      o.y += (WY * (1.1 + g * 2) + Math.sin(now * 1.4 + o.ph * 2) * 0.3) * dt;
      o.rot += o.vr * dt * (1 + g * 3);
      if (o.x > cam.x + mx) o.x -= mx * 2; else if (o.x < cam.x - mx) o.x += mx * 2;
      if (o.y > cam.y + my) o.y -= my * 2; else if (o.y < cam.y - my) o.y += my * 2;
      const s = o.s, bob = Math.sin(now * 2 + o.ph) * 0.15;
      ctx.globalAlpha = 0.85;
      if (o.k === 0) { ctx.drawImage(A.seed, o.x - s, o.y - s + bob, s * 2, s * 2); }
      else {
        const im = o.k === 1 ? A.petal : A.petalW, flip = Math.cos(now * 3 + o.ph);
        ctx.save(); ctx.translate(o.x, o.y + bob); ctx.rotate(o.rot); ctx.scale(1, 0.35 + 0.65 * Math.abs(flip)); ctx.drawImage(im, -s * 0.6, -s * 0.4, s * 1.2, s * 0.8); ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (lv < 2) return;
    // butterflies fluttering across the meadow (wander + flap), and sun glints twinkling in the grass
    const FL = amb.flies;
    while (FL.length < 5) FL.push({ x: cam.x + (Math.random() * 2 - 1) * mx, y: cam.y + (Math.random() * 2 - 1) * my, c: FL.length % 3, ph: Math.random() * 9, hx: Math.random() * 6, s: 0.32 + Math.random() * 0.12 });
    for (const f of FL) {
      const hd = f.hx + Math.sin(now * 0.7 + f.ph) * 1.4;
      f.x += (Math.cos(hd) * 1.1 + WX * 0.6) * dt; f.y += (Math.sin(hd) * 0.8 + WY * 0.4) * dt;
      if (f.x > cam.x + mx) f.x -= mx * 2; else if (f.x < cam.x - mx) f.x += mx * 2;
      if (f.y > cam.y + my) f.y -= my * 2; else if (f.y < cam.y - my) f.y += my * 2;
      const im = A.fly[f.c][Math.sin(now * 17 + f.ph) > 0 ? 0 : 1], s = f.s, bob = Math.sin(now * 5 + f.ph) * 0.12;
      ctx.globalAlpha = 0.25; ctx.drawImage(A.shadow, f.x - s * 0.4, f.y + 0.5, s * 0.8, s * 0.3);
      ctx.globalAlpha = 0.95; ctx.drawImage(im, f.x - s, f.y - s * 0.75 + bob - 0.6, s * 2, s * 1.5);
    }
    const GL = amb.glints;
    if (GL.length < 7 && Math.random() < dt * 5) GL.push({ x: cam.x + (Math.random() * 2 - 1) * halfW, y: cam.y + (Math.random() * 2 - 1) * halfH, t: 0, life: 0.5 + Math.random() * 0.5, s: 0.18 + Math.random() * 0.14 });
    ctx.globalCompositeOperation = 'lighter';
    for (let i = GL.length - 1; i >= 0; i--) {
      const g = GL[i]; g.t += dt; if (g.t >= g.life) { GL.splice(i, 1); continue; }
      const k = Math.sin(Math.PI * g.t / g.life), s = g.s * k;
      ctx.globalAlpha = 0.7 * k; ctx.drawImage(A.glint, g.x - s, g.y - s, s * 2, s * 2);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
  }

  /** screen-space lighting: day→golden→sunset grade, sun beams, vignette — baked into one cached overlay
      (rebuilt only when the phase/size changes) and blitted 1:1 each frame. Called with a CSS-px transform. */
  const AT = { c: null, key: '' };
  function drawAtmosphere(ctx) {
    const R = G.run, lv = qLevel();
    const k = Math.min(1.05, (R ? R.time : 0) / (G.cfg.runDuration || 600));
    const sm = (a, b, v) => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
    const q = Math.round(k * 60) / 60, golden = sm(0.45, 0.85, q), sunset = sm(0.82, 1.0, q);
    const RS = G.render.atmoScale || 1, cw = Math.ceil(V.canvas.width / RS), ch = Math.ceil(V.canvas.height / RS), key = RS + '|' + cw + 'x' + ch + '|' + q + '|' + (lv >= 1 ? 1 : 0);
    if (AT.key !== key) {
      AT.key = key;
      if (!AT.c || AT.c.width !== cw || AT.c.height !== ch) AT.c = mkc(cw, ch);
      const x = AT.c.getContext('2d'), A = ambSprites(), W = cw, H = ch;
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, H); x.globalCompositeOperation = 'source-over';
      if (golden > 0.01) { x.globalAlpha = 1; x.fillStyle = `rgba(255,${Math.round(150 - 40 * sunset)},${Math.round(60 + 20 * sunset)},${(0.08 * golden + 0.07 * sunset).toFixed(3)})`; x.fillRect(0, 0, W, H); }
      if (sunset > 0.01) { x.fillStyle = `rgba(50,10,40,${(0.07 * sunset).toFixed(3)})`; x.fillRect(0, 0, W, H); }
      x.globalAlpha = 0.06 + 0.1 * golden + 0.1 * sunset;
      x.drawImage(skyOf(sunset > 0.3 ? '#ff7a4a' : golden > 0.3 ? '#ffb35a' : '#fff2c0'), 0, 0, W, H * 0.7);
      if (lv >= 1) {
        const ox = sunset > 0.5 ? W * 1.02 : W * -0.05, oy = -H * 0.25;
        for (let i = 0; i < 4; i++) {
          const ang = (sunset > 0.5 ? 0.62 : -0.5) + (i - 1.5) * 0.17;
          x.globalAlpha = (0.05 + 0.05 * golden + 0.04 * sunset) * (0.7 + 0.3 * Math.sin(i * 2.1));
          x.save(); x.translate(ox, oy); x.rotate(ang); x.drawImage(A.beam, -H * 0.09 * (1 + i % 2), 0, H * 0.18 * (1 + i % 2), H * 1.7); x.restore();
        }
      }
      x.globalAlpha = 0.34 + 0.14 * sunset; x.drawImage(A.vig, 0, 0, W, H);
      x.globalAlpha = 1;
    }
    const m = ctx.getTransform(); ctx.setTransform(1, 0, 0, 1, 0, 0); if (RS === 1) ctx.drawImage(AT.c, 0, 0); else ctx.drawImage(AT.c, 0, 0, cw * RS, ch * RS); ctx.setTransform(m);
  }

  /** set the world transform (call ctx.restore() afterwards) */
  function beginWorld(ctx) {
    const cam = V.cam, S = V.scale * cam.zoom * (1 + cam.punch);
    const sh = G.fx ? G.fx.shakeOffset() : { x: 0, y: 0 };
    ctx.save();
    ctx.setTransform(V.dpr * S, 0, 0, V.dpr * S, V.dpr * (V.w / 2 + sh.x) - cam.x * V.dpr * S, V.dpr * (V.h / 2 + sh.y) - cam.y * V.dpr * S);
  }

  /** world → CSS pixel screen coords */
  function toScreen(x, y) { const cam = V.cam, S = V.scale * cam.zoom * (1 + cam.punch); return { x: (x - cam.x) * S + V.w / 2, y: (y - cam.y) * S + V.h / 2 }; }
  /** is a world point on screen (with margin in units)? */
  function onScreen(x, y, m) {
    const cam = V.cam, S = V.scale * cam.zoom; m = m || 1;
    return Math.abs(x - cam.x) < V.w / 2 / S + m && Math.abs(y - cam.y) < V.h / 2 / S + m;
  }
  function halfExtents() { const S = V.scale * V.cam.zoom; return { x: V.w / 2 / S, y: V.h / 2 / S }; }

  /** full frame render for the run scene */
  const OFF = {}; 
  const sortBuf = [];
  function drawRun(ctx) {
    const R = G.run; if (!R) return;
    adaptQuality();
    ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    beginWorld(ctx);
    const PT = G.render.PT; let pt0 = PT ? performance.now() : 0;
    if (!OFF.floor) drawFloor(ctx); else { ctx.fillStyle='#4f8a40'; ctx.fillRect(V.cam.x-40,V.cam.y-30,80,60); }
    if (PT) { const n = performance.now(); PT.floor = (PT.floor || 0) + n - pt0; pt0 = n; }
    // ground layer: decals, telegraphs, fields
    G.fx.drawGround && G.fx.drawGround(ctx);
    G.weapons.drawGround && G.weapons.drawGround(ctx);
    G.enemies.drawGround && G.enemies.drawGround(ctx);
    G.loot.draw && G.loot.draw(ctx);
    // y-sorted actors
    sortBuf.length = 0;
    const es = R.enemies;
    for (let i = 0; i < es.length; i++) { const e = es[i]; if (!e.dead && onScreen(e.x, e.y, 3)) sortBuf.push(e); }
    sortBuf.push(R.player);
    for (const p of R.props) if (onScreen(p.x, p.y, 4)) sortBuf.push(p);
    sortBuf.sort((a, b) => a.y - b.y);
    for (const o of sortBuf) {
      if (o === R.player) G.player.draw(ctx);
      else if (o.isEnemy) G.enemies.drawEnemy(ctx, o);
      else if (o.draw) o.draw(ctx, o);
    }
    if (PT) { const n = performance.now(); PT.actors = (PT.actors || 0) + n - pt0; pt0 = n; }
    // ambience above actors (clouds, wind, seeds) + screen-space lighting grade (under effects so they pop)
    if (!OFF.amb) drawAmbientWorld(ctx);
    if (PT) { const n = performance.now(); PT.amb = (PT.amb || 0) + n - pt0; pt0 = n; }
    if (!OFF.atmo && qLevel() >= 1) { ctx.save(); ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0); drawAtmosphere(ctx); ctx.restore(); }
    if (PT) { const n = performance.now(); PT.atmo = (PT.atmo || 0) + n - pt0; pt0 = n; }
    // air layer: player projectiles → effects → damage numbers → ENEMY bullets last, so danger is never hidden
    G.weapons.drawAir && G.weapons.drawAir(ctx);
    if (PT) { const n = performance.now(); PT.wair = (PT.wair || 0) + n - pt0; pt0 = n; }
    G.fx.draw(ctx);
    if (PT) { const n = performance.now(); PT.fx = (PT.fx || 0) + n - pt0; pt0 = n; }
    G.fx.drawNumbers(ctx);
    if (PT) { const n = performance.now(); PT.nums = (PT.nums || 0) + n - pt0; pt0 = n; }
    G.enemies.drawAir && G.enemies.drawAir(ctx);
    if (PT) { const n = performance.now(); PT.eair = (PT.eair || 0) + n - pt0; pt0 = n; }
    ctx.restore();
    // screen space
    ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    G.fx.drawScreen && G.fx.drawScreen(ctx);
    G.hud && G.hud.draw(ctx);
    if (PT) { const n = performance.now(); PT.rest = (PT.rest || 0) + n - pt0; PT.frames = (PT.frames || 0) + 1; }
  }

  return { customActors, resize, drawActor, dirRow, shadow, icon, drawFloor, drawAmbientWorld, drawAtmosphere, gust, OFF, setQuality, _ft: () => FT, beginWorld, toScreen, onScreen, halfExtents, drawRun };
})();
