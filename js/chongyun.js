/* chongyun.js — Chongyun's full kit (owner: CHONGYUN). Cryo / claymore / exorcist (方士).
   Normal  滅邪四式: heavy greatsword SWEEPS (wide fan, big knockback, slow). While moving he swings where he faces
           (if that fan is empty he turns to the nearest enemy); standing still he auto-turns to the nearest enemy.
           Only swings when an enemy is close. Physical + "blunt" (shatters frozen enemies) — cryo inside the frost field.
           Chains of 1..4 swings (cy_combo); with 3+ swings the LAST one is an overhead slam that hits all around.
           levels: cy_power (damage), cy_arc (reach + fan angle), cy_combo (swings per chain). Meta 矢の本数 = +1 swing,
           meta 射程 = bigger reach (≤×1.4), 攻撃速度 = shorter rest.
           evolution evo_cy_normal 霊刃奥義・霜天断雲: always cryo, every sweep throws an ice sword-wave (pierces),
           the finishing slam raises a ring of ice spikes that freeze, reach ×1.2.
   Skill   霊刃・重華積霜 (F): ground slam (cryo AoE) + 霜の領域 frost field for 10 s: while Chongyun stands inside, attack
           speed +15..30 % and his sweeps become cryo; enemies inside are slowed and chilled (cryo aura).
           固有天賦「追氷剣」: when the field ends a spirit blade drops on its centre (skill damage, cryo).  levels: cy_skill
   Burst   霊刃・雲開星落 (Q): 3 (Lv3+: 4) GIANT spirit blades fall one after another onto enemy clusters. levels: cy_burst
   Stats (lv0 defaults here, levels in upgrades.js): cyMul cyReach cyArc cyCombo cySkillMul cyHaste cyBurstMul cyBurstN */
'use strict';
(function () {
  const U = G.u, W = G.weapons, TAU = Math.PI * 2;
  const CY = '#9be8ff', CYL = '#e2f8ff', CYD = '#2f86c8', STEEL = '#eef3ff', CYB = '#b4e4ff';
  const reduced = () => !!(G.save && G.save.data.settings.reducedFx);
  const glow = (c, s) => G.assets.glow(c, s);
  const LIFT = 0.6; // swings are drawn at waist height

  /* ============================ cached procedural sprites ============================ */
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  /** generic broad greatsword pointing to +x (not a Genshin weapon design) */
  function makeGreatsword() {
    const c = mk(256, 64), x = c.getContext('2d'), cy = 32;
    let g = x.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, 'rgba(155,232,255,0)'); g.addColorStop(0.35, 'rgba(155,232,255,.3)'); g.addColorStop(1, 'rgba(210,245,255,.55)');
    x.fillStyle = g; x.beginPath(); x.moveTo(56, cy - 22); x.lineTo(236, cy - 16); x.lineTo(256, cy); x.lineTo(236, cy + 16); x.lineTo(56, cy + 22); x.closePath(); x.fill();
    x.fillStyle = '#2a2030'; x.fillRect(6, cy - 5, 40, 10);
    x.fillStyle = '#6b5a7a'; for (let i = 0; i < 5; i++) x.fillRect(9 + i * 7, cy - 5, 3, 10);
    x.fillStyle = '#d9b45a'; x.beginPath(); x.arc(7, cy, 7, 0, TAU); x.fill();
    x.fillStyle = '#e8c878'; x.beginPath(); x.moveTo(44, cy - 22); x.lineTo(56, cy - 12); x.lineTo(56, cy + 12); x.lineTo(44, cy + 22); x.lineTo(40, cy + 14); x.lineTo(40, cy - 14); x.closePath(); x.fill();
    x.fillStyle = CY; x.beginPath(); x.arc(49, cy, 4.5, 0, TAU); x.fill();
    g = x.createLinearGradient(0, cy - 15, 0, cy + 15); g.addColorStop(0, '#ffffff'); g.addColorStop(0.4, '#d6ecff'); g.addColorStop(0.6, '#8fc7f0'); g.addColorStop(1, '#3f78b8');
    x.fillStyle = g; x.beginPath(); x.moveTo(56, cy - 14); x.lineTo(226, cy - 12); x.lineTo(252, cy); x.lineTo(226, cy + 12); x.lineTo(56, cy + 14); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 2; x.beginPath(); x.moveTo(60, cy - 2); x.lineTo(232, cy - 1); x.stroke();
    x.strokeStyle = 'rgba(20,50,110,.85)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(56, cy - 14); x.lineTo(226, cy - 12); x.lineTo(252, cy); x.lineTo(226, cy + 12); x.lineTo(56, cy + 14); x.stroke();
    return c;
  }
  /** huge translucent spirit blade pointing DOWN (+y): burst + passive */
  function makeSpiritBlade() {
    const c = mk(128, 448), x = c.getContext('2d'), cx = 64;
    let g = x.createRadialGradient(cx, 260, 10, cx, 260, 220); g.addColorStop(0, 'rgba(155,232,255,.55)'); g.addColorStop(1, 'rgba(155,232,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 448);
    // hilt + rune guard
    x.fillStyle = '#cfefff'; x.fillRect(cx - 6, 4, 12, 70);
    x.fillStyle = '#6fc4ee'; for (let i = 0; i < 5; i++) x.fillRect(cx - 6, 10 + i * 12, 12, 4);
    x.fillStyle = '#ffffff'; x.beginPath(); x.arc(cx, 8, 9, 0, TAU); x.fill();
    x.fillStyle = '#bfefff'; x.beginPath(); x.moveTo(cx - 52, 84); x.quadraticCurveTo(cx, 60, cx + 52, 84); x.lineTo(cx + 36, 100); x.quadraticCurveTo(cx, 86, cx - 36, 100); x.closePath(); x.fill();
    x.fillStyle = CYD; x.beginPath(); x.moveTo(cx, 72); x.lineTo(cx + 9, 86); x.lineTo(cx, 100); x.lineTo(cx - 9, 86); x.closePath(); x.fill();
    // crystal blade
    g = x.createLinearGradient(cx - 30, 0, cx + 30, 0); g.addColorStop(0, 'rgba(90,170,230,.85)'); g.addColorStop(0.45, 'rgba(235,250,255,.95)'); g.addColorStop(0.55, 'rgba(200,240,255,.95)'); g.addColorStop(1, 'rgba(60,140,210,.85)');
    x.fillStyle = g; x.beginPath(); x.moveTo(cx - 28, 98); x.lineTo(cx + 28, 98); x.lineTo(cx + 22, 380); x.lineTo(cx, 444); x.lineTo(cx - 22, 380); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 3; x.beginPath(); x.moveTo(cx, 104); x.lineTo(cx, 430); x.stroke();
    x.strokeStyle = 'rgba(30,90,160,.8)'; x.lineWidth = 2; x.beginPath(); x.moveTo(cx - 28, 98); x.lineTo(cx - 22, 380); x.lineTo(cx, 444); x.lineTo(cx + 22, 380); x.lineTo(cx + 28, 98); x.stroke();
    // exorcist runes on the blade
    x.strokeStyle = 'rgba(40,120,200,.75)'; x.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) { const y = 140 + i * 58; x.beginPath(); x.moveTo(cx - 10, y); x.lineTo(cx + 10, y); x.moveTo(cx, y - 10); x.lineTo(cx, y + 12); x.moveTo(cx - 7, y + 8); x.lineTo(cx + 7, y + 8); x.stroke(); }
    return c;
  }
  /** ice rune circle (exorcist seal) for ground markers */
  function makeRune() {
    const c = mk(256, 256), x = c.getContext('2d'); x.translate(128, 128);
    x.strokeStyle = CYL; x.lineWidth = 5; x.beginPath(); x.arc(0, 0, 120, 0, TAU); x.stroke();
    x.lineWidth = 2.5; x.beginPath(); x.arc(0, 0, 104, 0, TAU); x.stroke();
    x.beginPath(); x.arc(0, 0, 58, 0, TAU); x.stroke();
    x.lineWidth = 3;
    for (let k = 0; k < 2; k++) { x.beginPath(); for (let i = 0; i < 3; i++) { const a = -Math.PI / 2 + k * Math.PI / 3 + i * TAU / 3; const px = Math.cos(a) * 104, py = Math.sin(a) * 104; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.closePath(); x.stroke(); }
    x.lineWidth = 2; for (let i = 0; i < 24; i++) { const a = i * TAU / 24; x.beginPath(); x.moveTo(Math.cos(a) * 106, Math.sin(a) * 106); x.lineTo(Math.cos(a) * (i % 2 ? 114 : 119), Math.sin(a) * (i % 2 ? 114 : 119)); x.stroke(); }
    // snowflake in the middle
    x.lineWidth = 4; for (let i = 0; i < 6; i++) { const a = i * TAU / 6; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 46, Math.sin(a) * 46); x.moveTo(Math.cos(a) * 28, Math.sin(a) * 28); x.lineTo(Math.cos(a + 0.35) * 38, Math.sin(a + 0.35) * 38); x.moveTo(Math.cos(a) * 28, Math.sin(a) * 28); x.lineTo(Math.cos(a - 0.35) * 38, Math.sin(a - 0.35) * 38); x.stroke(); }
    return c;
  }
  /** soft frost disc for the field */
  function makeFrostDisc() {
    const c = mk(256, 256), x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, 'rgba(225,244,255,.26)'); g.addColorStop(0.7, 'rgba(200,232,255,.32)'); g.addColorStop(0.93, 'rgba(170,220,255,.6)'); g.addColorStop(1, 'rgba(170,220,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    // frost crystals scattered on the ground
    x.strokeStyle = 'rgba(235,250,255,.45)'; x.lineWidth = 2;
    for (let i = 0; i < 26; i++) {
      const a = i * 2.39996, d = 22 + (i * 37 % 90), px = 128 + Math.cos(a) * d, py = 128 + Math.sin(a) * d, s = 5 + (i % 4) * 2;
      for (let k = 0; k < 3; k++) { const b = k * Math.PI / 3 + i; x.beginPath(); x.moveTo(px - Math.cos(b) * s, py - Math.sin(b) * s); x.lineTo(px + Math.cos(b) * s, py + Math.sin(b) * s); x.stroke(); }
    }
    return c;
  }
  /** ice crescent (evolution sword-wave), opening to -x */
  function makeCrescent() {
    const c = mk(128, 192), x = c.getContext('2d'); x.translate(20, 96);
    const g = x.createLinearGradient(0, 0, 100, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, 'rgba(155,232,255,.85)'); g.addColorStop(1, '#f2fcff');
    x.fillStyle = g; x.beginPath(); x.moveTo(0, -92); x.quadraticCurveTo(150, 0, 0, 92); x.quadraticCurveTo(80, 0, 0, -92); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 3; x.beginPath(); x.moveTo(6, -80); x.quadraticCurveTo(132, 0, 6, 80); x.stroke();
    return c;
  }
  /** cluster of ice spikes (evolution slam) — base at bottom centre */
  function makeSpikes() {
    const c = mk(128, 160), x = c.getContext('2d');
    const spike = (bx, w, h, lean) => {
      const g = x.createLinearGradient(bx - w, 0, bx + w, 0); g.addColorStop(0, '#5aa8e0'); g.addColorStop(0.5, '#f2fcff'); g.addColorStop(1, '#7cc4f0');
      x.fillStyle = g; x.beginPath(); x.moveTo(bx - w, 158); x.lineTo(bx + lean, 158 - h); x.lineTo(bx + w, 158); x.closePath(); x.fill();
      x.strokeStyle = 'rgba(255,255,255,.8)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(bx, 156); x.lineTo(bx + lean, 160 - h); x.stroke();
    };
    spike(40, 13, 90, -14); spike(88, 13, 96, 14); spike(64, 18, 150, 0); spike(24, 8, 50, -10); spike(104, 8, 56, 10);
    return c;
  }
  const SPR = {};
  function spr() {
    if (SPR.ready) return SPR;
    SPR.sword = SPR.sword || makeGreatsword();
    SPR.spirit = SPR.spirit || makeSpiritBlade();
    SPR.rune = SPR.rune || makeRune();
    SPR.disc = makeFrostDisc();
    SPR.cres = makeCrescent();
    SPR.spikes = makeSpikes();
    SPR.ready = true; return SPR;
  }

  /** round HUD / menu icons */
  function makeIcon(kind) {
    const c = mk(128, 128), x = c.getContext('2d');
    const sw = SPR.sword || (SPR.sword = makeGreatsword()), sb = SPR.spirit || (SPR.spirit = makeSpiritBlade());
    const g = x.createRadialGradient(64, 64, 6, 64, 64, 62); g.addColorStop(0, 'rgba(170,236,255,.6)'); g.addColorStop(1, 'rgba(40,120,200,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const sword = (a, s, cx, cy) => { x.save(); x.translate(cx, cy); x.rotate(a); x.drawImage(sw, -128 * s, -32 * s, 256 * s, 64 * s); x.restore(); };
    const blade = (s, cx, cy, rot) => { x.save(); x.translate(cx, cy); x.rotate(rot || 0); x.drawImage(sb, -64 * s, -224 * s, 128 * s, 448 * s); x.restore(); };
    const arc = (r, a0, a1, w, col) => { x.strokeStyle = col; x.lineWidth = w; x.lineCap = 'round'; x.beginPath(); x.arc(64, 70, r, a0, a1); x.stroke(); };
    if (kind === 'sword') sword(-Math.PI / 4, 0.46, 64, 64);
    else if (kind === 'power') { sword(-Math.PI / 4, 0.46, 64, 64); x.fillStyle = '#fff6c8'; x.font = 'bold 44px sans-serif'; x.fillText('!', 88, 46); }
    else if (kind === 'arc') { arc(48, Math.PI * 1.05, Math.PI * 1.95, 12, 'rgba(155,232,255,.8)'); arc(48, Math.PI * 1.05, Math.PI * 1.95, 3, '#ffffff'); sword(-Math.PI / 2 + 0.9, 0.3, 64 + Math.cos(-0.2) * 24, 70 - 30); }
    else if (kind === 'combo') { for (let i = 0; i < 3; i++) { x.strokeStyle = i === 1 ? '#ffffff' : CY; x.lineWidth = 7; x.lineCap = 'round'; x.beginPath(); x.moveTo(22 + i * 14, 100 - i * 4); x.quadraticCurveTo(60, 20 + i * 10, 106 - i * 6, 40 + i * 18); x.stroke(); } }
    else if (kind === 'skill') {
      x.save(); x.translate(64, 64); x.strokeStyle = '#eafaff'; x.lineWidth = 5; x.lineCap = 'round';
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 50, Math.sin(a) * 50); x.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); x.lineTo(Math.cos(a + 0.4) * 42, Math.sin(a + 0.4) * 42); x.moveTo(Math.cos(a) * 30, Math.sin(a) * 30); x.lineTo(Math.cos(a - 0.4) * 42, Math.sin(a - 0.4) * 42); x.stroke(); }
      x.restore(); blade(0.2, 64, 58);
    } else if (kind === 'burst') { blade(0.17, 34, 58, 0.12); blade(0.2, 64, 54, 0); blade(0.17, 94, 58, -0.12); x.fillStyle = 'rgba(230,250,255,.9)'; for (let i = 0; i < 7; i++) { x.beginPath(); x.arc(14 + i * 17, 112 - (i % 2) * 6, 3, 0, TAU); x.fill(); } }
    return c;
  }
  const ICONS = { cy_sword: 'sword', cy_power: 'power', cy_arc: 'arc', cy_combo: 'combo', cy_skill: 'skill', cy_burst: 'burst' };
  G.proceduralIcons = G.proceduralIcons || {};
  try { for (const k in ICONS) { const c = makeIcon(ICONS[k]); G.assets.img['icon_' + k] = c; G.proceduralIcons[k] = c; } }
  catch (e) { console.warn('[chongyun] icons', e); }

  /* ============================ stats ============================ */
  const st = (R, k, d) => { const v = R.stats[k]; return v != null ? v : d; };
  const evo = R => !!R.evolved.evo_cy_normal;
  function swingMul(R) { return st(R, 'cyMul', 2.0); }
  function reach(R) {
    const S = R.stats, ch = R.char, k = U.clamp((S.range || 8.5) / (ch.range || 8.5), 1, 1.4);
    return st(R, 'cyReach', 3.0) * k * (S.areaMul || 1) * (evo(R) ? 1.2 : 1);
  }
  function halfArc(R) { return st(R, 'cyArc', 70) * Math.PI / 180 + (evo(R) ? 0.1 : 0); }
  function chainLen(R) { return Math.min(6, st(R, 'cyCombo', 1) + (R.stats.extraProjectiles || 0)); }
  function restTime(R) { const S = R.stats; return (S.normalInterval || 1.7) * (S.featherCd || 1) / Math.max(0.3, S.haste || 1) * Math.max(0.4, 1 - (S.cdr || 0)); }
  function gapTime(R) { return 0.3 / Math.sqrt(Math.max(0.5, R.stats.haste || 1)); }
  /** sweeps are cryo inside the frost field (or always after the evolution) */
  function infused(R) { return evo(R) || !!R.wstate.cyIn; }

  /* ============================ NORMAL: 滅邪四式 ============================ */
  // allocation-free targeting / collision (module scratch + bound callbacks)
  const Q = { R: null, x: 0, y: 0, fx: 0, fy: 0, r: 0, cos: 0, n: 0, best: null, bd: 0, hits: 0, all: false };
  const HO = { mul: 1, element: 'physical', gauge: 0, src: 'cy_normal', knock: 1, kx: 0, ky: 0, blunt: true };
  function nearestCb(e) {
    if (e.dead || e.spawnT > 0.2) return;
    const dx = e.x - Q.x, dy = e.y - Q.y, d = dx * dx + dy * dy;
    if (d < Q.bd) { Q.bd = d; Q.best = e; }
  }
  function fanCountCb(e) {
    if (e.dead || e.spawnT > 0.25) return;
    const dx = e.x - Q.x, dy = e.y - Q.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > Q.r + e.r) return;
    if (d < 1 || (dx * Q.fx + dy * Q.fy) / d >= Q.cos) { Q.n++; return true; }
  }
  function fanHitCb(e) {
    if (e.dead || e.spawnT > 0.25) return;
    const dx = e.x - Q.x, dy = e.y - Q.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d > Q.r + e.r) return;
    if (!Q.all && d >= 1 && (dx * Q.fx + dy * Q.fy) / d < Q.cos) return;
    HO.kx = d > 0.01 ? dx / d : Q.fx; HO.ky = d > 0.01 ? dy / d : Q.fy;
    G.combat.hit(Q.R, e, HO);
    Q.hits++;
  }
  function nearest(R, x, y, r) { Q.x = x; Q.y = y; Q.best = null; Q.bd = r * r; R.grid.query(x, y, r, nearestCb); return Q.best; }
  /** choose the swing direction into Ws.cyDx/cyDy; false = nobody close enough */
  function aim(R, Ws) {
    const p = R.player, r = reach(R), t = nearest(R, p.x, p.y, r + 1.4);
    if (!t) return false;
    let fx = p.face.x, fy = p.face.y;
    if (p.moving) { // keep the facing direction if that fan has someone in it
      Q.x = p.x; Q.y = p.y; Q.fx = fx; Q.fy = fy; Q.r = r; Q.cos = Math.cos(halfArc(R)); Q.n = 0;
      R.grid.query(p.x, p.y, r + 0.5, fanCountCb);
      if (Q.n) { Ws.cyDx = fx; Ws.cyDy = fy; return true; }
    }
    const dx = t.x - p.x, dy = t.y - p.y, l = Math.sqrt(dx * dx + dy * dy) || 1;
    Ws.cyDx = dx / l; Ws.cyDy = dy / l; return true;
  }

  /* ---- swing visual: a field that draws the sweeping band + the greatsword at its leading edge ---- */
  function swingDraw(ctx, f) {
    const k = f.t / f.life, sw = Math.min(1, f.t / 0.1), head = U.ease.outCubic(sw);
    const a0 = f.ang - f.half * f.dir, span = 2 * f.half * f.dir, ah = a0 + span * head;
    const cx = f.x, cy = f.y - LIFT, r = f.r, fade = 1 - k * k;
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'butt';
    if (f.slam) { // overhead slam: expanding full ring band
      const rr = r * (0.35 + 0.65 * U.ease.outCubic(Math.min(1, f.t / 0.14)));
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = f.col; ctx.lineWidth = r * 0.35 * (1 - k); ctx.globalAlpha = 0.3 * fade;
      ctx.beginPath(); ctx.arc(f.x, f.y, rr * 0.92, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.08; ctx.globalAlpha = 0.9 * fade;
      ctx.beginPath(); ctx.arc(f.x, f.y, rr, 0, TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4 * fade; ctx.drawImage(glow(f.col, 64), f.x - rr, f.y - rr, rr * 2, rr * 2);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; return;
    }
    const lo = Math.min(a0, ah), hi = Math.max(a0, ah);
    // wide soft band (3 layers, tail fades; normal blending so the ice stays blue over the grass) + bright outer edge
    const band = r * 0.62, rm = r - band / 2;
    ctx.globalCompositeOperation = 'source-over';
    for (let i = 0; i < 3; i++) {
      ctx.strokeStyle = i === 2 ? '#ffffff' : f.col; ctx.lineWidth = band * (1 - i * 0.3); ctx.globalAlpha = fade * (0.22 + i * 0.12);
      const tail = (hi - lo) * i * 0.3;
      ctx.beginPath(); if (f.dir > 0) ctx.arc(cx, cy, rm + i * band * 0.12, lo + tail, hi); else ctx.arc(cx, cy, rm + i * band * 0.12, lo, hi - tail); ctx.stroke();
    }
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 0.09; ctx.globalAlpha = fade * 0.95;
    ctx.beginPath(); ctx.arc(cx, cy, r - 0.05, lo, hi); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = fade * 0.35; ctx.drawImage(glow(f.col, 64), cx + Math.cos(ah) * r * 0.7 - r * 0.5, cy + Math.sin(ah) * r * 0.7 - r * 0.5, r, r);
    // greatsword ghost at the head of the sweep (only while sweeping)
    if (sw < 1 || k < 0.55) {
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = sw < 1 ? 1 : Math.max(0, 1 - (k - 0.35) * 5);
      const L = r * 1.02, h = L * 64 / 256;
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(ah); ctx.drawImage(SPR.sword, 0, -h / 2, L, h); ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  let lastSwingSfx = 0;
  function strike(R, Ws, idx, last, slam) {
    const p = R.player, S = R.stats, r = reach(R) * (slam ? 0.95 : 1), ice = infused(R), ev = evo(R);
    const fx = Ws.cyDx, fy = Ws.cyDy, dir = idx % 2 ? -1 : 1, half = halfArc(R);
    spr();
    // sprite: jump to the "swung" frame
    p.anim.t = 0.2; p.anim.lock = Math.max(p.anim.lock, 0.18);
    const col = ice ? CYB : STEEL;
    W.field(R, { x: p.x, y: p.y, r, ang: Math.atan2(fy, fx), half, dir, slam, col, life: slam ? 0.34 : 0.28, ground: !!slam, draw: swingDraw,
      update(R2, dt, f) { if (!f.slam) { f.x = R2.player.x; f.y = R2.player.y; } } });
    // damage
    HO.mul = swingMul(R) * (slam ? 1.5 : 1) * (ev ? 1.1 : 1);
    HO.element = ice ? 'cryo' : 'physical'; HO.gauge = ice ? 1 : 0; HO.blunt = true;
    HO.src = ev ? 'evo_cy_normal' : 'cy_normal';
    HO.knock = last ? (slam ? 2.6 : 1.9) : 0.6;
    Q.R = R; Q.x = p.x; Q.y = p.y; Q.fx = fx; Q.fy = fy; Q.r = r; Q.cos = Math.cos(half + 0.12); Q.hits = 0; Q.all = !!slam;
    R.grid.query(p.x, p.y, r + 0.3, fanHitCb);
    const hits = Q.hits;
    // feel
    if (slam) {
      G.fx.shockwave && G.fx.shockwave(p.x, p.y, r * 1.1, ice ? CY : '#e8dcb8');
      G.fx.shake(0.45); if (hits) G.fx.hitstop(0.05);
      if (!reduced()) G.fx.burst(p.x, p.y - 0.2, 14, ice ? CYL : '#e8dcb8', { max: r * 3, life: 0.45, size: 0.14, grav: 8 });
      G.audio.sfx('rockImpact', { x: p.x, y: p.y, vol: 0.75, pitch: 0.8 });
      if (ev) spikeRing(R, p.x, p.y, r);
    } else {
      if (hits) { G.fx.shake(last ? 0.3 : 0.16); if (R.realTime - lastSwingSfx > 0.12) G.fx.hitstop(last ? 0.035 : 0.02); G.fx.kick && G.fx.kick(fx, fy, last ? 3.5 : 2); }
      if (!reduced()) {
        const a = Math.atan2(fy, fx);
        for (let i = 0; i < (ice ? 10 : 5); i++) { const b = a + U.rand(-half, half), d = U.rand(r * 0.5, r); G.fx.particle({ x: p.x + Math.cos(b) * d, y: p.y - LIFT + Math.sin(b) * d, vx: -Math.sin(b) * 4 * dir + Math.cos(b) * 2, vy: Math.cos(b) * 4 * dir + Math.sin(b) * 2, life: U.rand(0.25, 0.45), size: U.rand(0.06, 0.13), color: ice ? (U.chance(0.5) ? CY : CYL) : STEEL, glow: true, drag: 3, grav: ice ? 3 : 0 }); }
      }
      if (ev) fireWave(R, fx, fy);
    }
    if (R.realTime - lastSwingSfx > 0.08) {
      lastSwingSfx = R.realTime;
      G.audio.sfx('windBlast', { x: p.x, y: p.y, vol: slam ? 0.5 : 0.4, pitch: slam ? 0.7 : 0.9 + idx * 0.08 });
      if (hits) G.audio.sfx(ice ? 'cryo' : 'arrowHit', { x: p.x, y: p.y, vol: 0.6, pitch: ice ? 1 : 0.6 });
    }
  }

  /* ---- evolution: ice sword-waves + spike ring ---- */
  function waveDraw(ctx, q) {
    const k = q.t / q.life, a = Math.atan2(q.vy, q.vx), s = q.size * (0.8 + k * 0.5);
    ctx.save(); ctx.translate(q.x, q.y - LIFT); ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k * k) * 0.95;
    ctx.drawImage(glow(CY, 64), -s * 0.9, -s * 0.9, s * 1.6, s * 1.8);
    ctx.drawImage(SPR.cres, -s * 0.35, -s * 0.75, s * 0.66, s * 1.5);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.restore();
  }
  function waveUpdate(R, dt, q) { if (!reduced() && U.chance(0.4)) G.fx.particle({ x: q.x + U.rand(-0.4, 0.4), y: q.y - LIFT + U.rand(-0.4, 0.4), vx: q.vx * 0.1, vy: q.vy * 0.1 + 1, life: 0.4, size: U.rand(0.06, 0.12), color: CYL, glow: true, grav: 4 }); }
  function fireWave(R, fx, fy) {
    const p = R.player, r = reach(R), sp = 14 * (R.stats.projSpeed || 1);
    W.fire(R, { x: p.x + fx * r * 0.6, y: p.y + fy * r * 0.6, vx: fx * sp, vy: fy * sp, life: 0.6, r: 0.9, mul: swingMul(R) * 0.6, element: 'cryo', gauge: 0.5,
      src: 'evo_cy_normal', pierce: 6, knock: 0.8, size: 2.6, update: waveUpdate, draw: waveDraw });
  }
  function spikeDraw(ctx, f) {
    const k = f.t / f.life, up = U.ease.outBack(Math.min(1, f.t / 0.14)), a = k > 0.7 ? (1 - k) / 0.3 : 1, s = f.s;
    ctx.globalAlpha = a; ctx.drawImage(SPR.spikes, f.x - s * 0.4, f.y - s * up + 0.1, s * 0.8, s * up);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.4; ctx.drawImage(glow(CY, 32), f.x - s * 0.5, f.y - s * 0.6, s, s * 0.8);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function spikeHit(e) { if (!e.def.boss && !e.dead) G.combat.freeze(Q.R, e, e.def.elite ? 0.5 : 1.0); }
  function spikeRing(R, x, y, r) {
    const n = reduced() ? 5 : 8, rot = U.rand(0, TAU), mul = swingMul(R) * 0.8;
    for (let i = 0; i < n; i++) {
      const a = rot + i * TAU / n, sx = x + Math.cos(a) * r * 0.85, sy = y + Math.sin(a) * r * 0.85;
      W.field(R, { x: sx, y: sy, s: 2.3, life: 1.0, minor: true, ground: false, draw: spikeDraw });
      Q.R = R;
      G.combat.aoe(R, sx, sy, 1.3, { mul, element: 'cryo', gauge: 1, src: 'evo_cy_normal', knock: 1.2, each: spikeHit });
    }
    G.audio.sfx('cryo', { x, y, vol: 0.8, pitch: 0.8 });
  }

  function updateNormal(R, dt) {
    const Ws = R.wstate, p = R.player;
    if (Ws.cyIdx == null) { Ws.cyIdx = -1; Ws.cyT = 0.4; Ws.cyNext = 0; Ws.cyN = 1; Ws.cyDx = 1; Ws.cyDy = 0; }
    if (evo(R) && W.evoFirst(R, 'evo_cy_normal')) {
      W.evoFanfare(R, p.x, p.y, CY, 6, 'evo_cy_normal');
      Ws.cyDx = p.face.x; Ws.cyDy = p.face.y; spr(); spikeRing(R, p.x, p.y, reach(R));
      for (let i = 0; i < 6; i++) { const a = i * TAU / 6; fireWave(R, Math.cos(a), Math.sin(a)); }
    }
    if (Ws.cyIdx < 0) {
      Ws.cyT -= dt;
      if (Ws.cyT > 0) return;
      if (!aim(R, Ws)) { Ws.cyT = 0.08; return; }
      Ws.cyIdx = 0; Ws.cyN = chainLen(R);
      Ws.cyNext = 0.17;                                               // wind-up: the raised-sword frame
      G.player.pose(R, 'attack', Ws.cyNext + 0.25, { x: Ws.cyDx, y: Ws.cyDy });
      if (!reduced()) G.fx.sparkle && G.fx.sparkle(p.x + Ws.cyDx * 0.3, p.y - 1.8, infused(R) ? CYL : '#ffffff', 2, 0.3);
      return;
    }
    Ws.cyNext -= dt;
    if (Ws.cyNext > 0) return;
    const i = Ws.cyIdx, N = Ws.cyN, last = i === N - 1, slam = last && N >= 3;
    strike(R, Ws, i, last, slam);
    if (last) { Ws.cyIdx = -1; Ws.cyT = restTime(R); return; }
    // next swing of the chain: re-aim (keeps chasing the crowd), wind-up again
    Ws.cyIdx = i + 1;
    if (!aim(R, Ws)) { Ws.cyDx = p.face.x; Ws.cyDy = p.face.y; }
    const nextSlam = Ws.cyIdx === N - 1 && N >= 3;
    Ws.cyNext = gapTime(R) + (nextSlam ? 0.08 : 0);
    G.player.pose(R, 'attack', Ws.cyNext + 0.25, { x: Ws.cyDx, y: Ws.cyDy });
  }

  /* ============================ SKILL: 霊刃・重華積霜 ============================ */
  const SKILL_CD = 15, FIELD_R = 4.5, FIELD_T = 10;
  function skillCdBase(R) { return SKILL_CD * Math.max(0.4, 1 - (R.stats.cdr || 0)); }
  function skillMul(R) { return st(R, 'cySkillMul', 3.0); }
  const FQ = { R: null, until: 0, chill: false };
  function fieldCb(e) {
    if (e.dead) return;
    e.slowUntil = FQ.until;
    if (FQ.chill && !(e.frozenUntil > FQ.R.time)) G.combat.applyAura(FQ.R, e, 'cryo', 0.5);
  }
  function fieldDraw(ctx, f) {
    const a = Math.min(1, f.t / 0.3, (f.life - f.t) / 0.6), r = f.r * (0.6 + 0.4 * U.ease.outCubic(Math.min(1, f.t / 0.35)));
    ctx.globalAlpha = a * 0.95; ctx.drawImage(SPR.disc, f.x - r, f.y - r, r * 2, r * 2);
    ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.t * 0.25);
    ctx.globalAlpha = a * (0.5 + 0.12 * Math.sin(f.t * 3));
    ctx.drawImage(SPR.rune, -r * 0.8, -r * 0.8, r * 1.6, r * 1.6);
    ctx.restore();
    ctx.strokeStyle = CYL; ctx.lineWidth = 0.08; ctx.globalAlpha = a * 0.7;
    ctx.setLineDash([0.7, 0.45]); ctx.lineDashOffset = -f.t * 1.6;
    ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    // the last 2 s blink so the player knows it is about to end
    if (f.life - f.t < 2 && Math.sin(f.t * 14) > 0) { ctx.globalAlpha = a * 0.25; ctx.lineWidth = 0.2; ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function fieldUpdate(R, dt, f) {
    const p = R.player, dx = p.x - f.x, dy = p.y - f.y;
    f.inside = dx * dx + dy * dy <= f.r * f.r;
    if (!reduced() && U.chance(0.35)) { const a = U.rand(0, TAU), d = Math.sqrt(U.rnd()) * f.r; G.fx.mote && G.fx.mote(f.x + Math.cos(a) * d, f.y + Math.sin(a) * d, U.chance(0.5) ? CYL : CY, U.rand(0.06, 0.1)); }
  }
  function fieldTick(R, f) {
    f.n = (f.n || 0) + 1;
    FQ.R = R; FQ.until = R.time + 0.45; FQ.chill = f.n % 8 === 1; // chill (cryo aura) every 2 s
    R.grid.query(f.x, f.y, f.r, fieldCb);
  }
  function fieldEnd(R, f) {
    const Ws = R.wstate; if (Ws.cyField === f) Ws.cyField = null;
    // 固有天賦「追氷剣」: a spirit blade drops on the centre
    dropSpirit(R, f.x, f.y, 3.2 * (R.stats.areaMul || 1), skillMul(R), 'cy_skill', 0.9, 0.22);
  }
  function castSkill(R) {
    const Ws = R.wstate, p = R.player, S = R.stats;
    spr();
    G.player.pose(R, 'skill', 0.5, p.face);
    if (Ws.cyField) { Ws.cyField.kill = true; }                      // re-cast ends the old field (its blade still drops)
    const fxIm = G.assets.img.skillfx_chongyun;
    if (fxIm) W.field(R, { x: p.x, y: p.y, life: 0.66, ground: false,
      draw(ctx, f) {
        const fr = Math.min(7, Math.floor(f.t * 12)), cw = fxIm.width / 4, ch = fxIm.height / 2, s = 4.8;
        ctx.globalAlpha = Math.min(1, (f.life - f.t) / 0.12);
        ctx.drawImage(fxIm, (fr % 4) * cw, (fr >> 2) * ch, cw, ch, f.x - s / 2, f.y - 1.3 - s / 2, s, s);
        ctx.globalAlpha = 1;
      } });
    // the slam lands when the flipbook's blades hit the ground (~0.3 s)
    W.field(R, { x: p.x, y: p.y, life: 0.3, ground: true, onEnd(R2, f0) {
      const r = 3.6 * (R2.stats.areaMul || 1);
      const n = G.combat.aoe(R2, f0.x, f0.y, r, { mul: skillMul(R2), element: 'cryo', gauge: 2, src: 'cy_skill', knock: 2.2 });
      G.fx.shockwave && G.fx.shockwave(f0.x, f0.y, r, CY); G.fx.ring && G.fx.ring(f0.x, f0.y, r * 0.9, CYL);
      G.fx.shake(0.7); G.fx.hitstop(0.05); G.fx.zoomPunch && G.fx.zoomPunch(0.03);
      if (!reduced()) for (let i = 0; i < 18; i++) { const a = U.rand(0, TAU), s2 = U.rand(3, 9); G.fx.particle({ x: f0.x, y: f0.y - 0.3, vx: Math.cos(a) * s2, vy: Math.sin(a) * s2 * 0.6 - 3, life: U.rand(0.4, 0.8), size: U.rand(0.08, 0.18), color: U.chance(0.5) ? CY : CYL, glow: true, grav: 9, drag: 1.5 }); }
      G.audio.sfx('cryo', { x: f0.x, y: f0.y }); G.audio.sfx('rockImpact', { x: f0.x, y: f0.y, vol: 0.7 });
      if (n > 0) spawnParticles(R2, f0.x, f0.y, n >= 3 ? 4 : 3, 2.5);
    } });
    Ws.cyField = W.field(R, { x: p.x, y: p.y, r: FIELD_R * (S.areaMul || 1), life: FIELD_T * (S.durationMul || 1), tick: 0.25, next: 0.3, ground: true,
      update: fieldUpdate, onTick: fieldTick, onEnd: fieldEnd, draw: fieldDraw, inside: true });
    G.fx.reactionText && G.fx.reactionText(p.x, p.y - 2.6, '霜の領域！', CYL);
  }
  function spawnParticles(R, x, y, n, value) {
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, TAU), s = U.rand(3, 6);
      G.loot.add(R, { type: 'energy', x: x + Math.cos(a) * 0.3, y: y + Math.sin(a) * 0.3, value, el: 'cryo', vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(5, 8), magnet: true, sp: -7 - i * 1.5 });
    }
  }
  /** frost field buff: attack speed re-applied on top of computeStats (survives refreshStats) + infusion flag */
  function updateField(R) {
    const Ws = R.wstate, S = R.stats, f = Ws.cyField;
    if (Ws.cyStatsRef !== S) { Ws.cyStatsRef = S; Ws.cyBaseHaste = S.haste; }
    const inside = !!(f && !f.kill && f.t < f.life && f.inside);
    if (inside && !Ws.cyIn) { const p = R.player; G.fx.ring && G.fx.ring(p.x, p.y, 1.2, CY); }
    Ws.cyIn = inside;
    S.haste = Ws.cyBaseHaste + (inside ? st(R, 'cyHaste', 0.15) : 0);
  }
  /** frost glow around Chongyun while his sweeps are infused */
  function auraUpdate(R, dt, o) { if (R.charId !== 'chongyun') return false; o.x = R.player.x; o.y = R.player.y - 0.03; }
  function auraDraw(ctx, o) {
    const R = G.run; if (!R || !infused(R)) return;
    const p = R.player, t = R.time;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.28 + 0.1 * Math.sin(t * 5);
    ctx.drawImage(glow(CY, 64), p.x - 1.1, p.y - 2.1, 2.2, 2.4);
    ctx.strokeStyle = CYL; ctx.lineWidth = 0.05; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.8, 0.34, 0, t * 2, t * 2 + 4.2); ctx.stroke();
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    if (!reduced() && U.chance(0.12)) G.fx.mote && G.fx.mote(p.x + U.rand(-0.5, 0.5), p.y - U.rand(0.3, 1.6), CYL, 0.07);
  }
  function ensureProps(R, Ws) {
    if (Ws.cyProp) return;
    Ws.cyProp = { x: R.player.x, y: R.player.y - 0.03, update: auraUpdate, draw: auraDraw };
    R.props.push(Ws.cyProp);
  }

  /* ============================ spirit blades (burst + passive) ============================ */
  function spiritDraw(ctx, f) {
    // phase 1 (t < land): rune marker grows; the blade falls during the last FALL seconds. phase 2: stuck in the ground, fading.
    const FALL = f.fall, land = f.land, big = f.big, r = f.r, s = f.size;
    if (f.t < land) {
      const k = f.t / land;
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.t * 1.4);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.25 + 0.45 * k;
      ctx.drawImage(SPR.rune, -r, -r, r * 2, r * 2); ctx.restore();
      ctx.globalAlpha = 0.18 * k; ctx.fillStyle = CY; ctx.beginPath(); ctx.arc(f.x, f.y, r * k, 0, TAU); ctx.fill();
      const fk = (f.t - (land - FALL)) / FALL;
      if (fk > 0) { // falling blade with a light streak
        const y = f.y - (1 - fk * fk) * 14 - s * 0.05;
        ctx.globalAlpha = 0.6; ctx.drawImage(glow(CY, 64), f.x - s * 0.18, y - s * 1.6, s * 0.36, s * 1.9);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        ctx.drawImage(SPR.spirit, f.x - s * 0.143, y - s, s * 0.286, s);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      return;
    }
    const k = (f.t - land) / (f.life - land), a = k > 0.6 ? (1 - k) / 0.4 : 1, sink = s * 0.3;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.5;
    ctx.drawImage(glow(CY, 64), f.x - r * 0.8, f.y - r * 0.8, r * 1.6, r * 1.6);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = a * (big ? 1 : 0.95);
    // stuck: draw only the part above the ground
    ctx.drawImage(SPR.spirit, 0, 0, 128, 448 * (1 - sink / s), f.x - s * 0.143, f.y - s + sink, s * 0.286, s - sink);
    ctx.globalAlpha = 1;
  }
  function spiritTick(R, f) { // single tick = the impact
    if (f.hit) return; f.hit = true;
    const n = G.combat.aoe(R, f.x, f.y, f.r, { mul: f.mul, element: 'cryo', gauge: 2, src: f.src, knock: 2.4, critBonus: 0.1 });
    G.fx.explosion(f.x, f.y, f.r * 0.8, { color: CY, kind: 'cryo' });
    G.fx.shockwave && G.fx.shockwave(f.x, f.y, f.r * 1.15, CYL);
    G.fx.shake(f.big ? 1.1 : 0.8); G.fx.hitstop(f.big ? 0.07 : 0.045); G.fx.zoomPunch && G.fx.zoomPunch(f.big ? 0.05 : 0.03);
    if (!reduced()) {
      for (let i = 0; i < 16; i++) { const a = U.rand(0, TAU), s2 = U.rand(4, 11); G.fx.particle({ x: f.x, y: f.y - 0.4, vx: Math.cos(a) * s2, vy: Math.sin(a) * s2 * 0.6 - 4, life: U.rand(0.5, 0.9), size: U.rand(0.1, 0.22), color: U.chance(0.5) ? CY : '#ffffff', glow: true, grav: 10, drag: 1.2 }); }
      G.fx.hitSpark(f.x, f.y - 0.4, 'cryo', true);
    }
    G.audio.sfx('bigExplosion', { x: f.x, y: f.y, vol: f.big ? 0.9 : 0.7, pitch: 1.2 }); G.audio.sfx('cryo', { x: f.x, y: f.y });
    return n;
  }
  /** a giant spirit blade that lands after `land` seconds at (x,y) */
  function dropSpirit(R, x, y, r, mul, src, land, fall, big) {
    spr();
    const size = (big ? 6.6 : 5.4) * Math.min(1.4, Math.max(0.8, r / 3.4));
    return W.field(R, { x, y, r, mul, src, big: !!big, size, land, fall: fall || 0.22, life: land + 1.3, tick: land, next: land, ground: false, onTick: spiritTick, draw: spiritDraw });
  }

  /* ============================ BURST: 霊刃・雲開星落 ============================ */
  const BURST_R = 3.4;
  const pickEx = [], pickPts = [];
  function exCollect(e) { pickEx.push(e); }
  function castBurst(R) {
    const p = R.player, S = R.stats;
    spr();
    const n = st(R, 'cyBurstN', 3), mul = st(R, 'cyBurstMul', 7.0) * (1 + (S.burstBonus || 0)), r = BURST_R * (S.areaMul || 1) * (S.burstArea || 1);
    G.player.pose(R, 'skill', 0.7, p.face);
    G.fx.zoomPunch && G.fx.zoomPunch(0.08); G.fx.flash && G.fx.flash(CYL, 0.35);
    G.fx.pillar && G.fx.pillar(p.x, p.y, CY, 12, 1.8, 0.9);
    G.fx.rays && G.fx.rays(p.x, p.y - 1, 5, '#e8fbff', 1);
    G.bus.emit('notice', { text: '霊刃・雲開星落！', color: CYL });
    // targets: the densest clusters (never two blades on the same spot); fallback = a line in front
    pickEx.length = 0; pickPts.length = 0;
    for (let i = 0; i < n; i++) {
      const t = W.cluster(R, p.x, p.y, 11, 2.6, pickEx);
      let tx, ty;
      if (t) { tx = t.x; ty = t.y; }
      else { const d = 3 + i * 2.8; tx = p.x + p.face.x * d + U.rand(-0.5, 0.5); ty = p.y + p.face.y * d + U.rand(-0.5, 0.5); }
      pickPts.push(tx, ty);
      R.grid.query(tx, ty, r * 0.9, exCollect);
    }
    for (let i = 0; i < n; i++) {
      const big = i === n - 1;
      dropSpirit(R, pickPts[i * 2], pickPts[i * 2 + 1], big ? r * 1.25 : r, big ? mul * 1.3 : mul, 'cy_burst', 0.55 + i * 0.42, 0.24, big);
    }
    pickEx.length = 0;
    // sky: darkens to icy blue with snow over the whole screen while the blades come down
    const life = 0.55 + n * 0.42 + 0.9;
    W.field(R, { x: p.x, y: p.y, life, tick: 0.12, next: 0, ground: true,
      onTick() {
        if (reduced()) return;
        const he = G.render.halfExtents(), cam = G.view.cam;
        for (let i = 0; i < 8; i++) G.fx.particle({ x: cam.x + U.rand(-he.x, he.x), y: cam.y + U.rand(-he.y, he.y * 0.6), vx: U.rand(-1, 1), vy: 5, life: U.rand(0.5, 0.9), size: U.rand(0.05, 0.1), color: '#ffffff', glow: true, drag: 0 });
      },
      draw(ctx, f) {
        const a = Math.min(1, f.t / 0.3, (f.life - f.t) / 0.5);
        const he = G.render.halfExtents(), cam = G.view.cam; ctx.globalAlpha = a * 0.2; ctx.fillStyle = '#0a2a4a';
        ctx.fillRect(cam.x - he.x - 2, cam.y - he.y - 2, he.x * 2 + 4, he.y * 2 + 4); ctx.globalAlpha = 1;
      } });
  }

  /* ============================ KIT ============================ */
  G.weapons.kits.chongyun = {
    update(R, dt) {
      ensureProps(R, R.wstate);
      updateField(R);
      updateNormal(R, dt);
    },
    skill(R) { castSkill(R); },
    skillCd(R) { return skillCdBase(R); },
    burst(R) { castBurst(R); },
  };
  G.bus.on('runStart', R => { if (R && R.charId === 'chongyun') { try { spr(); } catch (e) { console.warn('[chongyun] sprites', e); } } });
  G.chongyun = { reach, halfArc, chainLen, restTime, infused };
})();
