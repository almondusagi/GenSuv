/* xingqiu.js — Xingqiu's full kit (owner: XINGQIU). Hydro / one-handed sword. Pure melee: the player must walk into
   the crowd — so the base hit is 2× Amber's arrow (Amber normalMul lv0 = 1.0 → Xingqiu 2.0).
   Normal  古華剣法・流水の舞: swords orbit around Xingqiu. Cycle = rest (cooldown) → spin (a short spin, then rest again).
           levels: xq_blades (sword count), xq_spin (spin speed + spin time), xq_power (damage), xq_feather 雷鳥の羽 (cooldown -5%/lv)
           evolution evo_xq_normal 古華奥義・千剣流水: never stops spinning, +2 swords, bigger, and every sword keeps
           shooting hydro blade-waves outward.
   Skill   古華剣・画雨籠山 (F): two big hydro slashes forward + 雨すだれの剣 (3 rain swords circle Xingqiu for 15 s:
           damage taken -20..35 %, each hit taken breaks one sword into a hydro counter-splash; when they are gone,
           heal 6 % max HP = 固有天賦「虹剣勢」). levels: xq_skill
   Burst   古華剣・裁雨留虹 (Q): for 8..11 s endless 五月雨斬り — rain swords pour down on the enemies in the direction
           Xingqiu FACES (turning moves the barrage), under a rainbow. levels: xq_burst
   Stats read from R.stats (set by upgrades.js mods, lv0 defaults here): xqMul xqBlades xqSpin xqSpinDur xqCdMul xqSkillMul
   xqRainDR xqBurstMul xqBurstDur. Also uses the shared S.haste, S.cdr, S.range (meta 射程 → bigger orbit),
   S.extraProjectiles (meta 矢の本数 → extra swords), S.durationMul. */
'use strict';
(function () {
  const U = G.u, W = G.weapons, TAU = Math.PI * 2;
  const HY = '#3fa9ff', HYL = '#a8e4ff', HYD = '#1456b8';
  const reduced = () => !!(G.save && G.save.data.settings.reducedFx);
  const glow = (c, s) => G.assets.glow(c, s);
  const LIFT = 0.8; // swords float at chest height (world units above the feet)

  /* ============================ cached procedural sprites ============================ */
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  /** sword pointing to +x: grip → gold guard → water-steel blade */
  function makeBlade() {
    const c = mk(192, 44), x = c.getContext('2d'), cy = 22;
    // soft hydro aura around the blade
    let g = x.createLinearGradient(0, 0, 192, 0); g.addColorStop(0, 'rgba(63,169,255,0)'); g.addColorStop(0.3, 'rgba(63,169,255,.35)'); g.addColorStop(1, 'rgba(160,225,255,.5)');
    x.fillStyle = g; x.beginPath(); x.moveTo(40, cy - 13); x.lineTo(178, cy - 5); x.lineTo(192, cy); x.lineTo(178, cy + 5); x.lineTo(40, cy + 13); x.closePath(); x.fill();
    // grip + pommel
    x.fillStyle = '#1c2a4a'; x.fillRect(6, cy - 4, 30, 8);
    x.fillStyle = '#3d5d9c'; for (let i = 0; i < 4; i++) x.fillRect(9 + i * 7, cy - 4, 3, 8);
    x.fillStyle = '#e8c15a'; x.beginPath(); x.arc(6, cy, 6, 0, TAU); x.fill();
    // guard (gold, winged)
    x.fillStyle = '#ffd87a'; x.beginPath(); x.moveTo(36, cy - 14); x.quadraticCurveTo(46, cy - 4, 44, cy); x.quadraticCurveTo(46, cy + 4, 36, cy + 14); x.lineTo(32, cy + 10); x.lineTo(34, cy); x.lineTo(32, cy - 10); x.closePath(); x.fill();
    x.fillStyle = '#3fa9ff'; x.beginPath(); x.arc(38, cy, 3.2, 0, TAU); x.fill();
    // blade
    g = x.createLinearGradient(0, cy - 7, 0, cy + 7); g.addColorStop(0, '#f4fbff'); g.addColorStop(0.45, '#cfeaff'); g.addColorStop(0.55, '#7cc4ff'); g.addColorStop(1, '#3d7fd6');
    x.fillStyle = g; x.beginPath(); x.moveTo(44, cy - 6); x.lineTo(172, cy - 4); x.lineTo(190, cy); x.lineTo(172, cy + 4); x.lineTo(44, cy + 6); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.9)'; x.lineWidth = 1.4; x.beginPath(); x.moveTo(48, cy - 1); x.lineTo(176, cy - 0.5); x.stroke();
    x.strokeStyle = 'rgba(20,60,140,.8)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(44, cy - 6); x.lineTo(172, cy - 4); x.lineTo(190, cy); x.lineTo(172, cy + 4); x.lineTo(44, cy + 6); x.stroke();
    return c;
  }
  /** crescent water blade (evolution wave / skill slash), opening to -x, bulging to +x */
  function makeCrescent(col, core) {
    const c = mk(128, 192), x = c.getContext('2d');
    x.translate(20, 96);
    const g = x.createLinearGradient(0, 0, 100, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.55, col); g.addColorStop(1, core);
    x.fillStyle = g; x.beginPath();
    x.moveTo(0, -92); x.quadraticCurveTo(150, 0, 0, 92); x.quadraticCurveTo(80, 0, 0, -92); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,.95)'; x.lineWidth = 3; x.beginPath(); x.moveTo(6, -80); x.quadraticCurveTo(132, 0, 6, 80); x.stroke();
    return c;
  }
  /** rainbow arc (burst) */
  function makeRainbow() {
    const c = mk(512, 256), x = c.getContext('2d'), cols = ['#ff6a6a', '#ffb05a', '#ffe66a', '#7dff8a', '#5ad0ff', '#6a8aff', '#c47dff'];
    x.globalAlpha = 0.9;
    for (let i = 0; i < cols.length; i++) { x.strokeStyle = cols[i]; x.lineWidth = 11; x.beginPath(); x.arc(256, 250, 230 - i * 10, Math.PI, TAU); x.stroke(); }
    x.globalCompositeOperation = 'destination-in';
    const g = x.createLinearGradient(0, 0, 512, 0); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.2, '#000'); g.addColorStop(0.8, '#000'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(0, 0, 512, 256);
    return c;
  }
  /** round HUD / menu icons (procedural, no image pixels read) */
  function makeIcon(kind) {
    const c = mk(128, 128), x = c.getContext('2d'), bl = SPR.blade || (SPR.blade = makeBlade());
    const g = x.createRadialGradient(64, 64, 6, 64, 64, 62); g.addColorStop(0, 'rgba(120,200,255,.55)'); g.addColorStop(1, 'rgba(20,80,180,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const sword = (a, s, cx, cy) => { x.save(); x.translate(cx, cy); x.rotate(a); x.drawImage(bl, -96 * s, -22 * s, 192 * s, 44 * s); x.restore(); };
    if (kind === 'blade') { sword(-Math.PI / 4, 0.62, 64, 64); }
    else if (kind === 'blades') { for (let i = 0; i < 3; i++) sword(-Math.PI / 2 + i * TAU / 3, 0.34, 64 + Math.cos(-Math.PI / 2 + i * TAU / 3) * 30, 64 + Math.sin(-Math.PI / 2 + i * TAU / 3) * 30); }
    else if (kind === 'spin') {
      x.strokeStyle = '#bfe6ff'; x.lineWidth = 7; x.lineCap = 'round'; x.beginPath(); x.arc(64, 64, 44, 0.3, 4.6); x.stroke();
      x.fillStyle = '#bfe6ff'; x.beginPath(); x.moveTo(64 + Math.cos(4.6) * 44 + 10, 64 + Math.sin(4.6) * 44 - 14); x.lineTo(64 + Math.cos(4.6) * 44 + 16, 64 + Math.sin(4.6) * 44 + 8); x.lineTo(64 + Math.cos(4.6) * 44 - 10, 64 + Math.sin(4.6) * 44 + 4); x.fill();
      sword(-Math.PI / 4, 0.42, 64, 64);
    } else if (kind === 'skill') {
      for (let i = 0; i < 3; i++) sword(Math.PI / 2, 0.36, 34 + i * 30, 64 + (i === 1 ? -8 : 6));
      x.strokeStyle = 'rgba(210,240,255,.9)'; x.lineWidth = 3; for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(20 + i * 18, 14); x.lineTo(14 + i * 18, 34); x.stroke(); }
    } else if (kind === 'burst') {
      const rb = SPR.rainbow || (SPR.rainbow = makeRainbow()); x.drawImage(rb, 4, 18, 120, 60);
      for (let i = 0; i < 4; i++) sword(Math.PI / 2 + 0.35, 0.3, 28 + i * 24, 78 + (i & 1) * 12);
    } else if (kind === 'feather') {
      x.save(); x.translate(64, 64); x.rotate(-0.6);
      const fg = x.createLinearGradient(0, -52, 0, 52); fg.addColorStop(0, '#f1d6ff'); fg.addColorStop(0.5, '#b56bff'); fg.addColorStop(1, '#5a1fb0');
      x.fillStyle = fg; x.beginPath(); x.moveTo(0, -54); x.bezierCurveTo(30, -30, 26, 30, 0, 50); x.bezierCurveTo(-26, 30, -30, -30, 0, -54); x.fill();
      x.strokeStyle = '#fff4ff'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, -48); x.lineTo(0, 58); x.stroke();
      x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 1.5; for (let i = -3; i <= 3; i++) { x.beginPath(); x.moveTo(0, i * 12); x.lineTo(18, i * 12 - 10); x.moveTo(0, i * 12); x.lineTo(-18, i * 12 - 10); x.stroke(); }
      x.restore();
      x.strokeStyle = '#ffe98a'; x.lineWidth = 4; x.beginPath(); x.moveTo(98, 14); x.lineTo(86, 36); x.lineTo(100, 36); x.lineTo(88, 60); x.stroke();
    }
    return c;
  }
  const SPR = {};
  function spr() {
    if (SPR.ready) return SPR;
    SPR.blade = SPR.blade || makeBlade();
    SPR.cres = makeCrescent('rgba(63,169,255,.85)', '#e6f7ff');
    SPR.rainbow = SPR.rainbow || makeRainbow();
    SPR.ready = true; return SPR;
  }
  // HUD / menu icons: registered as G.assets.img['icon_xq_*'] (canvas) + G.proceduralIcons for DOM <img> (data URL)
  const ICONS = { xq_blade: 'blade', xq_blades: 'blades', xq_spin: 'spin', xq_skill: 'skill', xq_burst: 'burst', xq_feather: 'feather' };
  G.proceduralIcons = G.proceduralIcons || {};
  try {
    for (const k in ICONS) { const c = makeIcon(ICONS[k]); G.assets.img['icon_' + k] = c; G.proceduralIcons[k] = c; }
  } catch (e) { console.warn('[xingqiu] icons', e); }

  /* ============================ stats ============================ */
  const st = (R, k, d) => { const v = R.stats[k]; return v != null ? v : d; };
  function bladeMul(R) { return st(R, 'xqMul', 2.0); }
  function evo(R) { return !!R.evolved.evo_xq_normal; }
  function bladeCount(R) { return Math.min(10, st(R, 'xqBlades', 1) + (R.stats.extraProjectiles || 0) + (evo(R) ? 2 : 0)); }
  function spinRev(R) { return st(R, 'xqSpin', 0.8) * (evo(R) ? 1.2 : 1); }             // revolutions per second
  function spinDur(R) { return st(R, 'xqSpinDur', 2.5) * (R.stats.durationMul || 1); }
  function restTime(R) { const S = R.stats; return (S.normalInterval || 2.4) * st(R, 'xqCdMul', 1) / Math.max(0.3, S.haste || 1) * Math.max(0.4, 1 - (S.cdr || 0)); }
  function reach(R) { // sword tip radius; meta 射程 makes the orbit bigger (capped)
    const S = R.stats, ch = R.char, k = U.clamp((S.range || 8.5) / (ch.range || 8.5), 1, 1.4);
    return 2.35 * k * (S.areaMul || 1) * (evo(R) ? 1.25 : 1);
  }

  /* ============================ NORMAL: 流水の舞 (orbiting swords) ============================ */
  // allocation-free collision: module scratch + one bound callback for grid.query
  const HO = { mul: 1, element: 'hydro', gauge: 0.5, src: 'xq_normal', knock: 0.9, kx: 0, ky: 0 };
  const C = { R: null, px: 0, py: 0, r1: 0, a0: 0, sweep: 0, n: 1, thr: 0.3, hits: 0 };
  let lastHitSfx = 0;
  function bladeCheck(e) {
    if (e.dead || e.spawnT > 0.25) return;
    const R = C.R, dx = e.x - C.px, dy = e.y - C.py, d = Math.sqrt(dx * dx + dy * dy);
    if (d > C.r1 + e.r || d < 0.05) return;
    if (e._xqT != null && R.time - e._xqT < C.thr) return;
    const a = Math.atan2(dy, dx), pad = Math.min(0.7, (e.r + 0.3) / Math.max(0.5, d));
    for (let i = 0; i < C.n; i++) {
      let diff = (a - (C.a0 + i * TAU / C.n)) % TAU; if (diff < 0) diff += TAU;
      if (diff <= C.sweep + pad || diff >= TAU - pad) {
        e._xqT = R.time;
        HO.kx = dx / d; HO.ky = dy / d;
        G.combat.hit(R, e, HO);
        C.hits++;
        if (!reduced() || U.chance(0.3)) G.fx.hitSpark(e.x, e.y - 0.6, 'hydro', HO.mul > 3.5);
        return;
      }
    }
  }
  function spinStep(R, dt, Ws) {
    const p = R.player, n = bladeCount(R), rev = spinRev(R), prev = Ws.xqAng;
    Ws.xqAng += rev * TAU * dt;
    C.R = R; C.px = p.x; C.py = p.y; C.r1 = reach(R); C.a0 = prev; C.sweep = Ws.xqAng - prev; C.n = n; C.hits = 0;
    C.thr = Math.max(0.12, 0.7 / (rev * n));          // an enemy is hit at most once per sword pass
    HO.mul = bladeMul(R); HO.src = evo(R) ? 'evo_xq_normal' : 'xq_normal'; HO.gauge = 0.5;
    R.grid.query(p.x, p.y, C.r1 + 1.2, bladeCheck);
    if (C.hits && R.realTime - lastHitSfx > 0.07) { lastHitSfx = R.realTime; G.audio.sfx('arrowHit', { x: p.x, y: p.y, pitch: 1.35, vol: 0.7 }); }
    Ws.xqAng %= TAU * 64;
  }
  function startSpin(R, Ws) {
    const p = R.player;
    Ws.xqPhase = 1; Ws.xqT = 0; Ws.xqIn = 0;
    G.audio.sfx('hydro', { x: p.x, y: p.y, vol: 0.7 });
    if (!reduced()) G.fx.burst(p.x, p.y - LIFT, 8, HYL, { max: 6, life: 0.3, size: 0.1 });
    G.player.pose(R, 'attack', 0.25, null);
  }

  /* ---- evolution: blade waves ---- */
  function waveDraw(ctx, q) {
    const k = q.t / q.life, a = Math.atan2(q.vy, q.vx), s = q.size * (0.8 + k * 0.5);
    ctx.save(); ctx.translate(q.x, q.y - LIFT); ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k * k) * 0.95;
    ctx.drawImage(glow(HY, 64), -s * 0.9, -s * 0.9, s * 1.6, s * 1.8);
    ctx.drawImage(SPR.cres, -s * 0.35, -s * 0.75, s * 0.66, s * 1.5);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.restore();
  }
  function waveUpdate(R, dt, q) { if (!reduced() && U.chance(0.35)) G.fx.particle({ x: q.x + U.rand(-0.3, 0.3), y: q.y - LIFT + U.rand(-0.3, 0.3), vx: q.vx * 0.1, vy: q.vy * 0.1 + 1.5, life: 0.35, size: U.rand(0.06, 0.12), color: HYL, glow: true, grav: 6 }); }
  function fireWaves(R, Ws) {
    const p = R.player, n = bladeCount(R), r = reach(R), mul = bladeMul(R) * 0.6, sp = 13 * (R.stats.projSpeed || 1);
    for (let i = 0; i < n; i++) {
      const a = Ws.xqAng + i * TAU / n + 0.35, cx = Math.cos(a), cy = Math.sin(a);
      W.fire(R, { x: p.x + cx * r, y: p.y + cy * r, vx: cx * sp, vy: cy * sp, life: 0.55, r: 0.65, mul, element: 'hydro', gauge: 0.5,
        src: 'evo_xq_normal', pierce: 4, knock: 0.6, size: 1.6, update: waveUpdate, draw: waveDraw });
    }
    G.audio.sfx('arrow', { x: p.x, y: p.y, pitch: 1.6, vol: 0.35 });
  }

  /* ---- drawing: two props (behind / in front of Xingqiu) so swords pass around the body ---- */
  function drawOrbit(ctx, o) {
    const R = G.run; if (!R || R.charId !== 'xingqiu') return;
    const Ws = R.wstate, p = R.player; spr();
    const cx = p.x, cy = p.y - LIFT, front = o.front;
    if (!Ws.xqPhase) { // resting: a thin cooldown arc at the feet + a glint when ready
      if (front) return;
      const k = U.clamp(Ws.xqT / Math.max(0.01, Ws.xqRest || 1), 0, 1);
      ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = HY; ctx.lineWidth = 0.07; ctx.globalAlpha = 0.25 + 0.35 * k;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, 0.95, 0.42, 0, -Math.PI / 2, -Math.PI / 2 + TAU * k); ctx.stroke();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      return;
    }
    const n = bladeCount(R), r1 = reach(R), r0 = Math.min(0.75, r1 * 0.3), rm = (r0 + r1) / 2, L = r1 - r0 + 0.35;
    const vis = Math.min(1, Ws.xqIn / 0.12) * (Ws.xqOut != null ? Math.max(0, Ws.xqOut) : 1);
    const rev = spinRev(R), trail = Math.min(TAU / n * 0.7, 1.3, rev * TAU * 0.11), ev = evo(R);
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'butt';
    for (let i = 0; i < n; i++) {
      const a = Ws.xqAng + i * TAU / n, s = Math.sin(a);
      if ((s >= 0) !== front) continue;
      // swoosh: a fading annulus sector behind the sword
      ctx.lineWidth = L * 0.8;
      ctx.strokeStyle = ev ? '#4fb4ff' : HY;
      for (let k = 0; k < 3; k++) { ctx.globalAlpha = vis * (0.2 - k * 0.06); ctx.beginPath(); ctx.arc(cx, cy, rm, a - trail * (k + 1) / 3, a - trail * k / 3); ctx.stroke(); }
      ctx.globalAlpha = vis * 0.8; ctx.lineWidth = 0.06; ctx.strokeStyle = '#e8f7ff';
      ctx.beginPath(); ctx.arc(cx, cy, r1 - 0.05, a - trail, a); ctx.stroke();
    }
    for (let i = 0; i < n; i++) {
      const a = Ws.xqAng + i * TAU / n, s = Math.sin(a);
      if ((s >= 0) !== front) continue;
      const bx = cx + Math.cos(a) * rm, by = cy + Math.sin(a) * rm;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = vis * 0.55;
      ctx.drawImage(glow(HY, 64), bx - L * 0.6, by - L * 0.6, L * 1.2, L * 1.2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = vis;
      ctx.save(); ctx.translate(bx, by); ctx.rotate(a + 0.12); const h = L * 44 / 192 * (ev ? 1.25 : 1);
      ctx.drawImage(SPR.blade, -L / 2, -h / 2, L, h); ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ---- rain swords (skill buff) drawn close around the body ---- */
  function drawRain(ctx, o) {
    const R = G.run; if (!R || R.charId !== 'xingqiu') return;
    const Ws = R.wstate, p = R.player, n = Ws.xqRainN | 0; if (!n) return;
    spr();
    const t = R.time, fade = Math.min(1, (Ws.xqRainUntil - R.time) / 0.6, (R.time - Ws.xqRainT0) / 0.25);
    for (let i = 0; i < n; i++) {
      const a = t * 2.2 + i * TAU / 3, s = Math.sin(a);
      if ((s >= 0) !== o.front) continue;
      const x = p.x + Math.cos(a) * 0.95, y = p.y - 1.05 + s * 0.35 + Math.sin(t * 4 + i) * 0.06;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * fade; ctx.drawImage(glow(HY, 32), x - 0.35, y - 0.6, 0.7, 1.2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = (o.front ? 0.95 : 0.7) * fade;
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 2); ctx.drawImage(SPR.blade, -0.55, -0.13, 1.1, 0.26); ctx.restore();
    }
    // rain curtain: a thin shimmering ring at the feet
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.3 * fade; ctx.strokeStyle = HYL; ctx.lineWidth = 0.05;
    if (!o.front) { ctx.beginPath(); ctx.ellipse(p.x, p.y, 1.1, 0.45, 0, 0, TAU); ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  function propUpdate(R, dt, o) { if (R.charId !== 'xingqiu') return false; const p = R.player; o.x = p.x; o.y = p.y + (o.front ? 0.02 : -0.02); }
  function propDraw(ctx, o) { drawOrbit(ctx, o); drawRain(ctx, o); }
  function ensureProps(R, Ws) {
    if (Ws.xqProps) return;
    const p = R.player;
    Ws.xqProps = [{ x: p.x, y: p.y - 0.02, front: false, update: propUpdate, draw: propDraw }, { x: p.x, y: p.y + 0.02, front: true, update: propUpdate, draw: propDraw }];
    R.props.push(Ws.xqProps[0], Ws.xqProps[1]);
  }

  function updateNormal(R, dt) {
    const Ws = R.wstate;
    if (Ws.xqAng == null) { Ws.xqAng = -Math.PI / 2; Ws.xqPhase = 0; Ws.xqT = 0; Ws.xqRest = 0.6; Ws.xqWave = 0.5; }
    const ev = evo(R);
    if (ev && W.evoFirst(R, 'evo_xq_normal')) { const p = R.player; W.evoFanfare(R, p.x, p.y, HY, 6, 'evo_xq_normal'); if (!Ws.xqPhase) startSpin(R, Ws); fireWaves(R, Ws); }
    if (!Ws.xqPhase) {
      Ws.xqT += dt; Ws.xqRest = restTime(R);
      if (ev || Ws.xqT >= Ws.xqRest) startSpin(R, Ws);
      return;
    }
    Ws.xqT += dt; Ws.xqIn += dt;
    spinStep(R, dt, Ws);
    if (ev) {
      Ws.xqOut = null;
      Ws.xqWave -= dt;
      if (Ws.xqWave <= 0) { Ws.xqWave = 0.75 / Math.max(0.5, R.stats.haste || 1); fireWaves(R, Ws); }
      if (!reduced() && U.chance(0.25)) { const p = R.player, a = U.rand(0, TAU), r = reach(R); G.fx.particle({ x: p.x + Math.cos(a) * r, y: p.y - LIFT + Math.sin(a) * r, vx: -Math.sin(a) * 3, vy: Math.cos(a) * 3 + 1, life: 0.4, size: 0.1, color: HYL, glow: true, grav: 5 }); }
      return;
    }
    const D = spinDur(R), left = D - Ws.xqT;
    Ws.xqOut = left < 0.15 ? left / 0.15 : null;
    if (Ws.xqT >= D) { Ws.xqPhase = 0; Ws.xqT = 0; Ws.xqOut = null; }
  }

  /* ============================ SKILL: 古華剣・画雨籠山 ============================ */
  const SKILL_CD = 14;
  function skillCdBase(R) { return SKILL_CD * Math.max(0.4, 1 - (R.stats.cdr || 0)); }
  function skillMul(R) { return st(R, 'xqSkillMul', 2.6); }

  function slashDraw(ctx, f) {
    const k = f.t / f.life, s = f.r * (0.75 + 0.35 * U.ease.outCubic(k));
    ctx.save(); ctx.translate(f.x, f.y - 0.5); ctx.rotate(f.ang); ctx.scale(1, f.flip);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (1 - k) * 0.9;
    ctx.drawImage(glow(HY, 64), -s * 0.2, -s * 0.9, s * 1.3, s * 1.8);
    ctx.drawImage(SPR.cres, s * 0.05, -s * 0.95, s * 0.95, s * 1.9);
    ctx.globalAlpha = (1 - k) * 0.6; ctx.drawImage(SPR.cres, s * 0.2, -s * 0.7, s * 0.6, s * 1.4);
    ctx.restore(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  function slash(R, idx) {
    const p = R.player, fx = p.face.x, fy = p.face.y, ang = Math.atan2(fy, fx), r = 3.6 * (R.stats.areaMul || 1) * (idx ? 1.15 : 1);
    const cx = p.x + fx * 0.4, cy = p.y + fy * 0.4, half = idx ? 1.25 : 1.05;
    W.field(R, { x: cx, y: cy, r, ang, flip: idx ? -1 : 1, life: 0.28, ground: false, draw: slashDraw });
    const n = G.combat.aoe(R, cx, cy, r, { mul: skillMul(R) * (idx ? 1.15 : 1), element: 'hydro', gauge: 1, src: 'xq_skill', knock: 1.6,
      filter: e => { const a = Math.atan2(e.y - cy, e.x - cx); return Math.abs(U.angDiff(ang, a)) <= half || U.dist2(e.x, e.y, cx, cy) < 1.2; } });
    G.fx.shake(0.35); G.fx.kick && G.fx.kick(fx, fy, 4);
    G.audio.sfx('windBlast', { x: p.x, y: p.y, vol: 0.6 }); G.audio.sfx('hydro', { x: p.x, y: p.y });
    if (!reduced()) {
      for (let i = 0; i < 14; i++) { const a = ang + U.rand(-half, half), d = U.rand(0.8, r); G.fx.particle({ x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d - 0.5, vx: Math.cos(a) * 4, vy: Math.sin(a) * 4 - 2, life: U.rand(0.3, 0.55), size: U.rand(0.08, 0.16), color: U.chance(0.5) ? HY : HYL, glow: true, grav: 9 }); }
      G.fx.flipbook && G.fx.flipbook('water', cx + fx * r * 0.55, cy + fy * r * 0.55 + 0.2, r * 0.9, 0.45, { flip: !!idx });
    }
    return n;
  }
  function castSkill(R) {
    const Ws = R.wstate, p = R.player, S = R.stats;
    G.player.pose(R, 'skill', 0.45, p.face);
    const fxIm = G.assets.img.skillfx_xingqiu;
    if (fxIm) W.field(R, { x: p.x, y: p.y, life: 0.7, ground: false,
      update(R2, dt, f) { f.x = R2.player.x; f.y = R2.player.y; },
      draw(ctx, f) {
        const fr = Math.min(7, Math.floor(f.t * 12)), cw = fxIm.width / 4, ch = fxIm.height / 2, s = 4.2;
        ctx.globalAlpha = Math.min(1, (f.life - f.t) / 0.15);
        ctx.drawImage(fxIm, (fr % 4) * cw, (fr >> 2) * ch, cw, ch, f.x - s / 2, f.y - 1.1 - s / 2, s, s);
        ctx.globalAlpha = 1;
      } });
    const n = slash(R, 0);
    W.field(R, { x: 0, y: 0, life: 0.2, ground: true, onEnd: R2 => { const m = slash(R2, 1); if (n + m > 0) spawnParticles(R2, R2.player.x + R2.player.face.x * 2, R2.player.y + R2.player.face.y * 2, 3, 2.5); } });
    // 雨すだれの剣
    Ws.xqRainN = 3; Ws.xqRainT0 = R.time; Ws.xqRainUntil = R.time + 15 * (S.durationMul || 1);
    G.fx.reactionText && G.fx.reactionText(p.x, p.y - 2.6, '雨すだれの剣！', HYL);
    G.bus.emit('shield', 'hydro');
  }
  function spawnParticles(R, x, y, n, value) {
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, TAU), s = U.rand(3, 6);
      G.loot.add(R, { type: 'energy', x: x + Math.cos(a) * 0.3, y: y + Math.sin(a) * 0.3, value, el: 'hydro', vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(5, 8), magnet: true, sp: -7 - i * 1.5 });
    }
  }
  /** rain swords: damage reduction re-applied on top of whatever computeStats produced (survives refreshStats) */
  function updateRain(R) {
    const Ws = R.wstate, S = R.stats;
    if (Ws.xqStatsRef !== S) { Ws.xqStatsRef = S; Ws.xqBaseDR = S.dmgReduction || 0; }
    const on = (Ws.xqRainN | 0) > 0 && R.time < Ws.xqRainUntil;
    if ((Ws.xqRainN | 0) > 0 && !on) rainEnd(R);
    S.dmgReduction = on ? 1 - (1 - Ws.xqBaseDR) * (1 - st(R, 'xqRainDR', 0.2)) : Ws.xqBaseDR;
  }
  function rainEnd(R) {
    const Ws = R.wstate, p = R.player; Ws.xqRainN = 0;
    G.player.heal(R, p.maxHp * 0.06); // 固有天賦「虹剣勢」
  }
  G.bus.on('playerHurt', () => {
    const R = G.run; if (!R || R.charId !== 'xingqiu') return;
    const Ws = R.wstate; if (!((Ws.xqRainN | 0) > 0) || R.time >= Ws.xqRainUntil) return;
    Ws.xqRainN--;
    const p = R.player, r = 2.6;
    G.combat.aoe(R, p.x, p.y, r, { mul: skillMul(R) * 0.5, element: 'hydro', gauge: 1, src: 'xq_skill', knock: 2.2 });
    G.fx.ring && G.fx.ring(p.x, p.y, r, HY); G.fx.hitSpark(p.x, p.y - 1, 'hydro', true);
    G.audio.sfx('hydro', { x: p.x, y: p.y });
    if (Ws.xqRainN <= 0) rainEnd(R);
  });

  /* ============================ BURST: 古華剣・裁雨留虹 ============================ */
  function burstMul(R) { return st(R, 'xqBurstMul', 1.2); }
  const PATTERN = [4, 5, 7];
  const cone = [];               // reused target list
  let cQ = { x: 0, y: 0, fx: 0, fy: 0, len: 0, cos: 0 };
  function coneCollect(e) {
    if (e.dead || e.spawnT > 0.2) return;
    const dx = e.x - cQ.x, dy = e.y - cQ.y, d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.5 || d > cQ.len) return;
    if ((dx * cQ.fx + dy * cQ.fy) / d >= cQ.cos) cone.push(e);
  }
  function swordFallUpdate(R, dt, q) { if (!reduced() && U.chance(0.3)) G.fx.particle({ x: q.x, y: q.y, vx: U.rand(-0.5, 0.5), vy: U.rand(-1, 0), life: 0.25, size: 0.09, color: HYL, glow: true }); }
  function swordFallDraw(ctx, q) {
    const a = Math.atan2(q.vy, q.vx), s = q.size;
    ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7;
    ctx.drawImage(glow(HY, 64), -s * 1.6, -s * 0.28, s * 2.2, s * 0.56);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(SPR.blade, -s * 0.6, -s * 0.17, s * 1.2, s * 0.34);
    ctx.restore();
    const k = q.t / q.life; ctx.globalAlpha = 0.4 * k; ctx.strokeStyle = HYL; ctx.lineWidth = 0.05;
    ctx.beginPath(); ctx.ellipse(q.tx, q.ty, 0.9 * (1.4 - k * 0.6), 0.4 * (1.4 - k * 0.6), 0, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
  }
  function swordFallEnd(R, q) {
    G.combat.aoe(R, q.tx, q.ty, 1.5, { mul: q.mul, element: 'hydro', gauge: 0.5, src: q.src, knock: 0.7, critBonus: 0.1 });
    G.fx.hitSpark(q.tx, q.ty - 0.1, 'hydro', q.big);
    if (!reduced()) { G.fx.burst(q.tx, q.ty - 0.1, 5, HYL, { max: 5, life: 0.35, size: 0.1, grav: 10 }); if (U.chance(0.3)) G.fx.flipbook && G.fx.flipbook('water', q.tx, q.ty + 0.2, 1.5, 0.4, { flip: U.chance(0.5) }); }
  }
  function dropSword(R, tx, ty, mul, big, src, fx, fy) {
    const T = 0.2, ox = -fx * 2.2 + U.rand(-0.6, 0.6), oy = -7.5 - fy * 1.2;
    W.fire(R, { x: tx + ox, y: ty + oy, vx: -ox / T, vy: -oy / T, life: T, noHit: true, tx, ty, mul, big, src, size: big ? 3.0 : 2.0,
      update: swordFallUpdate, draw: swordFallDraw, onEnd: swordFallEnd });
  }
  function castBurst(R) {
    const p = R.player, S = R.stats, L = R.levels.xq_burst || 0;
    const life = st(R, 'xqBurstDur', 8) * (S.durationMul || 1) + (S.burstDuration || 0);
    spr();
    G.player.pose(R, 'burst', 0.6, p.face);
    G.fx.zoomPunch && G.fx.zoomPunch(0.08); G.fx.flash && G.fx.flash(HYL, 0.35);
    G.fx.pillar && G.fx.pillar(p.x, p.y, HY, 12, 1.8, 0.9);
    G.fx.ring && G.fx.ring(p.x, p.y, 5, HY);
    G.fx.rays && G.fx.rays(p.x, p.y - 1, 5, '#cfeeff', 1);
    G.bus.emit('notice', { text: '五月雨斬り！', color: HYL });
    const mul = burstMul(R) * (1 + (S.burstBonus || 0));
    let tick = 0;
    // ground cone (shows where the swords fall) + the barrage logic
    W.field(R, { x: p.x, y: p.y, r: 9.5, life, tick: 0.18, next: 0.25, ground: true,
      update(R2, dt, f) { const q = R2.player; f.x = q.x; f.y = q.y; f.ang = Math.atan2(q.face.y, q.face.x); },
      onTick(R2, f) {
        const q = R2.player, fx = q.face.x, fy = q.face.y;
        const n = (reduced() ? 2 : PATTERN[tick % 3]) + (L >> 1); tick++;
        cone.length = 0; cQ.x = q.x; cQ.y = q.y; cQ.fx = fx; cQ.fy = fy; cQ.len = f.r; cQ.cos = Math.cos(0.6);
        R2.grid.query(q.x, q.y, f.r, coneCollect);
        for (let i = 0; i < n; i++) {
          let tx, ty;
          if (cone.length && U.chance(0.65)) { const e = cone[(U.rnd() * cone.length) | 0]; tx = e.x + U.rand(-0.4, 0.4); ty = e.y + U.rand(-0.4, 0.4); }
          else { const a = Math.atan2(fy, fx) + U.rand(-0.55, 0.55), d = U.rand(1.6, f.r * 0.95); tx = q.x + Math.cos(a) * d; ty = q.y + Math.sin(a) * d; }
          dropSword(R2, tx, ty, mul, false, 'xq_burst', fx, fy);
        }
        cone.length = 0;
        if (tick % 5 === 0) { const a = Math.atan2(fy, fx), d = f.r * 0.55; dropSword(R2, q.x + Math.cos(a) * d, q.y + Math.sin(a) * d, mul * 2.2, true, 'xq_burst', fx, fy); }
        if (tick % 2) G.audio.sfx('burstRain', { x: q.x, y: q.y, vol: 0.8 });
        else G.audio.sfx('hydro', { x: q.x, y: q.y, vol: 0.6 });
        // cosmetic rain over the whole screen
        if (!reduced()) {
          const he = G.render.halfExtents(), cam = G.view.cam;
          for (let i = 0; i < 12; i++) G.fx.particle({ x: cam.x + U.rand(-he.x, he.x), y: cam.y + U.rand(-he.y, he.y * 0.6), vx: fx * 5, vy: 28, life: U.rand(0.16, 0.28), size: U.rand(0.08, 0.14), color: U.chance(0.6) ? HYL : HY, streak: true, drag: 0 });
        }
      },
      draw(ctx, f) {
        const fi = Math.min(1, f.t / 0.3), fo = Math.min(1, (f.life - f.t) / 0.5), a = Math.min(fi, fo);
        { const he = G.render.halfExtents(), cam = G.view.cam; ctx.globalAlpha = a * 0.14; ctx.fillStyle = '#062a5a'; ctx.fillRect(cam.x - he.x - 2, cam.y - he.y - 2, he.x * 2 + 4, he.y * 2 + 4); }
        const ang = f.ang || 0, h = 0.6;
        ctx.globalAlpha = a * 0.16; ctx.fillStyle = HY;
        ctx.beginPath(); ctx.moveTo(f.x, f.y); ctx.arc(f.x, f.y, f.r * fi, ang - h, ang + h); ctx.closePath(); ctx.fill();
        ctx.globalAlpha = a * 0.55; ctx.strokeStyle = HYL; ctx.lineWidth = 0.07; ctx.setLineDash([0.6, 0.4]); ctx.lineDashOffset = -f.t * 3;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * fi, ang - h, ang + h); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 1;
      },
    });
    // rainbow over Xingqiu (air layer)
    W.field(R, { x: p.x, y: p.y, life, ground: false,
      update(R2, dt, f) { f.x = R2.player.x; f.y = R2.player.y; },
      draw(ctx, f) {
        const a = Math.min(1, f.t / 0.4, (f.life - f.t) / 0.6), w = 5.2, h = 2.6, bob = Math.sin(f.t * 2) * 0.08;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * 0.55;
        ctx.drawImage(SPR.rainbow, f.x - w / 2, f.y - 3.9 + bob, w, h);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      } });
  }

  /* ============================ player actor (icon-based, no sprite sheet) ============================ */
  const vis = { dir: 1, white: null, phase: 0, lastT: 0, land: 0, wasUp: false };
  function whiteOf(im) {
    if (vis.white) return vis.white;
    const c = mk(im.width, im.height), x = c.getContext('2d');
    x.drawImage(im, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    return (vis.white = c);
  }
  function drawSelf(ctx, a) {
    const im = G.assets.img.icon_xingqiu; if (!im) return;
    const R = G.run, p = R && R.player, t = G.time;
    const dt = Math.min(0.1, Math.max(0, t - vis.lastT)); vis.lastT = t;
    const face = a.face || { x: 1, y: 0 };
    if (Math.abs(face.x) > 0.2) vis.dir = face.x < 0 ? -1 : 1;
    const moving = !!(p && p.moving), sp = p ? Math.hypot(p.vx, p.vy) : 0;
    // grounded walk cycle (owner: no bouncy hopping) — small step bob, slight forward lean, gentle sway
    if (moving && !G.game.isPaused()) vis.phase += dt * (6.2 + sp * 0.5);
    const step = moving ? Math.abs(Math.sin(vis.phase)) : 0;           // 0 at foot-plant, 1 mid-stride
    const z = step * 0.05 + (moving ? 0 : Math.sin(t * 2.4) * 0.02 + 0.02);
    const st2 = (a.anim && a.anim.state) || 'idle', act = st2 === 'attack' || st2 === 'skill' || st2 === 'burst';
    const H = 2.55, w = H * im.width / im.height;
    const plant = moving ? Math.pow(1 - step, 6) : 0;                   // tiny squash on each foot-plant
    let sx = (a.sx || 1) * (1 + plant * 0.025), sy = (a.sy || 1) * (1 - plant * 0.02 + step * 0.01);
    if (!moving) { const br = Math.sin(t * 2.4) * 0.015; sx *= 1 - br; sy *= 1 + br; }
    const lean = moving ? Math.min(1, sp / 5) * 0.06 * (Math.abs(face.x) > 0.2 ? 1 : 0) : 0;
    let rot = moving ? Math.sin(vis.phase) * 0.025 + lean * vis.dir : 0;
    if (act) { const k = Math.min(1, (a.anim.t || 0) / 0.08) * Math.max(0, 1 - (a.anim.t || 0) / 0.45); rot += vis.dir * 0.18 * k; sx *= 1 + 0.06 * k; sy *= 1 + 0.06 * k; }
    const prevA = ctx.globalAlpha;
    ctx.save(); ctx.translate(a.x, a.y - z); ctx.rotate(rot); ctx.scale(vis.dir * sx, sy);
    if (a.alpha != null) ctx.globalAlpha = prevA * a.alpha;
    ctx.drawImage(im, -w / 2, -H * 0.97, w, H);
    if (a.flash > 0) { ctx.globalAlpha = prevA * Math.min(1, a.flash); ctx.drawImage(whiteOf(im), -w / 2, -H * 0.97, w, H); }
    ctx.restore(); ctx.globalAlpha = prevA;
  }
  G.render.customActors = G.render.customActors || {};
  // G.render.customActors.xingqiu = drawSelf;  // replaced by actor_xingqiu.webp (4-direction sheet)

  /** burst cut-in banner built at runtime from the portrait (drawing only — no pixel reads) */
  function ensureCutin() {
    const im = G.assets.img.icon_xingqiu; if (!im || G.assets.img.cutin_xingqiu) return;
    const c = mk(1200, 420), x = c.getContext('2d');
    let g = x.createLinearGradient(0, 0, 1200, 420); g.addColorStop(0, '#04122e'); g.addColorStop(0.5, '#0c3f86'); g.addColorStop(1, '#0a2a5c');
    x.fillStyle = g; x.fillRect(0, 0, 1200, 420);
    g = x.createRadialGradient(820, 210, 20, 820, 210, 380); g.addColorStop(0, 'rgba(120,210,255,.75)'); g.addColorStop(1, 'rgba(63,169,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 1200, 420);
    x.globalAlpha = 0.5; x.drawImage(spr().rainbow, 520, -30, 620, 310); x.globalAlpha = 1;
    x.strokeStyle = 'rgba(200,236,255,.5)'; x.lineWidth = 3;
    for (let i = 0; i < 60; i++) { const px = (i * 97) % 1200, py = (i * 53) % 420; x.beginPath(); x.moveTo(px, py); x.lineTo(px - 18, py + 60); x.stroke(); }
    for (let i = 0; i < 9; i++) { x.save(); x.translate(80 + i * 120, 40 + (i % 3) * 30); x.rotate(Math.PI / 2 + 0.3); x.globalAlpha = 0.55; x.drawImage(SPR.blade, -96, -22, 192, 44); x.restore(); }
    x.globalAlpha = 1;
    const h = 520, w2 = h * im.width / im.height; x.drawImage(im, 820 - w2 / 2, 210 - h * 0.42, w2, h);
    G.assets.img.cutin_xingqiu = c;
  }
  G.bus.on('runStart', R => { if (R && R.charId === 'xingqiu') { try { spr(); ensureCutin(); } catch (e) { console.warn('[xingqiu] cutin', e); } } });

  /* ============================ KIT ============================ */
  G.weapons.kits.xingqiu = {
    update(R, dt) {
      ensureProps(R, R.wstate);
      updateNormal(R, dt);
      updateRain(R);
    },
    skill(R) { castSkill(R); },
    skillCd(R) { return skillCdBase(R); },
    burst(R) { castBurst(R); },
  };
  G.xingqiu = { reach, bladeCount, restTime, spinDur, spinRev };
})();
