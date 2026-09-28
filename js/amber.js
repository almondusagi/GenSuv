/* amber.js — Amber's full kit (owner: COMBAT).
   Normal (auto): flaming arrows at the nearest enemies.         levels: amber_normal, amber_arrows, amber_pierce
   Skill  ウサギ伯爵: thrown Baron Bunny, hops ぴょん・ぴょん, explodes on the 3rd landing, taunts nearby enemies.
   Burst  矢の雨: a huge rain of flaming arrows FIXED at the cast position.
   Evolutions: evo_amber_normal 爆炎の矢, evo_amber_skill 伯爵大行進, evo_amber_burst 炎の大豪雨.
   Optional stat flags read from R.stats (default 0/1): extraArrows, extraProjectiles, extraPierce, bunnyCharges,
   bunnyDmg (+fraction), burstBonus (+fraction dmg), burstDuration (+seconds), burstArea (×), normalDmg (+fraction),
   projSpeed (×), durationMul (×), explosionMul (Amber passive ×2 + explosion_radius upgrades). */
'use strict';
(function () {
  const U = G.u, W = G.weapons;
  const reduced = () => !!(G.save && G.save.data.settings.reducedFx);
  const glow = (c, s) => G.assets.glow(c, s);
  const lv = (R, k) => R.levels[k] || 0;
  const BOMB_BASE_R = 2.4;             // pyro launcher doll-bomb base radius (see launchers.js)
  const BUNNY_BASE_R = BOMB_BASE_R * 1.15; // Baron Bunny explosion a bit bigger than the doll bomb (balance v5: was ×1.5)

  /* ============================ NORMAL ATTACK ============================ */
  // S.normalMul (PROGRESSION: amber_normal level, 1→2.75) already includes the level; fallback only if absent
  function arrowMul(R) { const S = R.stats; return (S.normalMul != null ? S.normalMul : 1.2 + 0.4 * lv(R, 'amber_normal')) * (1 + (S.normalDmg || 0)); }
  function arrowRate(R) { const S = R.stats; return S.normalHaste != null ? S.normalHaste : 1 + 0.08 * lv(R, 'amber_normal'); }

  function drawArrow(ctx, p) {
    const a = Math.atan2(p.vy, p.vx), y = p.y - 0.9, evo = p.evo;
    const grow = Math.min(1, p.t * 9);
    ctx.save(); ctx.translate(p.x, y); ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter';
    const L = (evo ? 3.2 : 2.3) * grow;
    ctx.globalAlpha = 0.7; ctx.drawImage(glow(evo ? '#ff4a1a' : '#ff7a3d', 64), -L + 0.2, evo ? -0.42 : -0.3, L + 0.4, evo ? 0.84 : 0.6);
    ctx.globalAlpha = 0.95; ctx.drawImage(glow('#ffe0a0', 32), -L * 0.45, -0.13, L * 0.45 + 0.55, 0.26);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    const im = G.assets.img.icon_amber_arrow;
    if (im) { const s = p.size, h = s * im.height / im.width; ctx.drawImage(im, -s / 2, -h / 2, s, h); }
    ctx.restore();
  }

  function arrowUpdate(R, dt, p) {
    if (G.fx.trail && p.px != null && !reduced()) G.fx.trail(p.px, p.py - 0.9, p.x, p.y - 0.9, p.evo ? '#ff5a1a' : '#ff9a3d', p.evo ? 0.26 : 0.18);
    p.px = p.x; p.py = p.y;
    const n = reduced() ? 0.15 : p.evo ? 0.9 : 0.5;
    if (U.rnd() < n) G.fx.particle({ x: p.x - p.dx * 0.3 + U.rand(-0.08, 0.08), y: p.y - 0.9 - p.dy * 0.3 + U.rand(-0.08, 0.08), vx: -p.vx * 0.06 + U.rand(-0.6, 0.6), vy: -p.vy * 0.06 + U.rand(-1.2, 0.2), life: U.rand(0.18, 0.38), size: U.rand(0.05, p.evo ? 0.13 : 0.09), color: U.chance(0.5) ? '#ffb347' : '#ff6a2a', glow: true, drag: 4 });
  }

  let lastEvoBoom = -1;
  function arrowHit(R, p, e) {
    G.combat.hit(R, e, { mul: p.mul, element: 'pyro', gauge: 1, src: 'amber_normal', knock: 0.6, kx: p.dx, ky: p.dy });
    G.audio.sfx('arrowHit', { x: e.x, y: e.y });
    if (p.evo) {
      const r = 1.3 * R.stats.explosionMul;
      // VFX-owned budgeted blast when available (cheap in crowds), else the sprite-field fallback
      // a full fireball every ~0.07 s (the readable "爆炎" beat), cheap booms in between
      if (R.realTime - lastEvoBoom > 0.07) { lastEvoBoom = R.realTime; G.fx.explosion(e.x, e.y, r, { color: '#ff7a3d', kind: 'small' }); }
      else if (G.fx.boom) G.fx.boom(e.x, e.y, r * 0.8, { color: '#ff7a3d', kind: 'small' }); else W.boom(R, e.x, e.y, r * 0.75, { color: '#ff7a3d', life: 0.38 });
      G.combat.aoe(R, e.x, e.y, r, { mul: p.baseMul * 0.45, element: 'pyro', gauge: 0.5, src: 'evo_amber_normal', knock: 0.8, exclude: e });
      if (!reduced()) G.fx.burst(e.x, e.y - 0.4, 8, '#ffb347', { max: r * 4, life: 0.4 });
      if (U.chance(0.35)) G.audio.sfx('explosion', { x: e.x, y: e.y, vol: 0.5 });
    }
  }

  function fireArrows(R) {
    const p = R.player, S = R.stats, evo = !!R.evolved.evo_amber_normal;
    const nFull = 1 + lv(R, 'amber_arrows') + (S.extraProjectiles || 0), nExtra = S.extraArrows || 0;
    const n = nFull + nExtra;
    const range = S.range || 13.5; // auto-aim reach (char base × meta 射程) — short when un-upgraded
    const targets = W.nearestN(R, p.x, p.y, range, n);
    if (!targets.length) return false;
    const pierce = lv(R, 'amber_pierce') + (S.extraPierce || 0) + (evo ? 1 : 0);
    if (evo && W.evoFirst(R, 'evo_amber_normal')) { W.evoFanfare(R, p.x, p.y, '#ff7a3d', 5, 'evo_amber_normal'); for (let k = 0; k < 16; k++) { const a = k / 16 * U.TAU; W.fire(R, { x: p.x, y: p.y, vx: Math.cos(a) * 22, vy: Math.sin(a) * 22, life: 0.6, r: 0.42, px: p.x, py: p.y, mul: arrowMul(R), baseMul: arrowMul(R), element: 'pyro', gauge: 1, src: 'evo_amber_normal', pierce: pierce + 2, size: 1.35, evo: true, update: arrowUpdate, onHit: arrowHit, draw: drawArrow }); } }
    const mul = arrowMul(R), speed = 23 * (S.projSpeed || 1);
    for (let i = 0; i < n; i++) {
      const t = targets[i % targets.length];
      // lead the target slightly; repeat shots at the same target fan out a little
      const extra = Math.floor(i / targets.length);
      let d = U.norm(t.x - p.x, t.y - p.y);
      if (extra) { const a = Math.atan2(d.y, d.x) + (extra % 2 ? 1 : -1) * 0.12 * Math.ceil(extra / 2); d = { x: Math.cos(a), y: Math.sin(a) }; }
      const m = i < nFull ? mul : mul * (S.extraArrowMul != null ? S.extraArrowMul : 0.6);
      W.fire(R, { x: p.x + d.x * 0.5, y: p.y + d.y * 0.5, vx: d.x * speed, vy: d.y * speed, life: Math.min(0.72, range * 1.35 / speed), r: evo ? 0.42 : 0.36, px: p.x + d.x * 0.5, py: p.y + d.y * 0.5,
        mul: m, baseMul: m, element: 'pyro', gauge: 1, src: 'amber_normal', pierce, size: evo ? 1.35 : 1.1, evo,
        update: arrowUpdate, onHit: arrowHit, draw: drawArrow });
    }
    const d0 = U.norm(targets[0].x - p.x, targets[0].y - p.y);
    G.player.pose(R, 'attack', 0.22, d0);
    // muzzle flare at the bow
    if (!reduced()) G.fx.burst(p.x + d0.x * 0.6, p.y - 0.9 + d0.y * 0.6, 5, '#ffcf7a', { max: 4, life: 0.25, size: 0.1 });
    G.audio.sfx('arrow', { x: p.x, y: p.y });
    return true;
  }

  /* ============================ CHARGED SHOT: 狙い撃ち ============================ */
  // Genshin Amber's fully-charged aimed shot: every few seconds she draws the bow (short glow wind-up) and fires a
  // huge flaming arrow at the toughest target nearby. Pierces everything, explodes on the first hit (Amber's passive
  // doubles explosion size), +25 % crit rate ("的確な射撃").
  function chargedPeriod(R) { return (R.stats.chargedPeriod || 3.4) / Math.max(0.35, R.stats.haste || 1) / Math.sqrt(arrowRate(R)); }
  function chargedTarget(R) {
    const p = R.player, c = W.nearestN(R, p.x, p.y, (R.stats.range || 13.5) + 0.5, 12);
    if (!c.length) return null;
    let best = c[0], bs = -1e9;
    for (const e of c) { const s = (e.boss ? 60 : e.elite ? 30 : 0) + e.hp / Math.max(1, R.stats.atk) * 0.5 - e._d2 * 0.02; if (s > bs) { bs = s; best = e; } }
    return best;
  }
  function drawCharged(ctx, p) {
    const a = Math.atan2(p.vy, p.vx), y = p.y - 0.9;
    ctx.save(); ctx.translate(p.x, y); ctx.rotate(a);
    ctx.globalCompositeOperation = 'lighter';
    const L = 4.6 * Math.min(1, p.t * 7), fl = 0.85 + 0.15 * Math.sin(p.t * 60);
    ctx.globalAlpha = 0.8; ctx.drawImage(glow('#ff4a1a', 64), -L + 0.4, -0.7 * fl, L + 0.9, 1.4 * fl);
    ctx.globalAlpha = 1; ctx.drawImage(glow('#ffe6a8', 32), -L * 0.55, -0.2, L * 0.55 + 0.9, 0.4);
    ctx.globalAlpha = 0.9; ctx.drawImage(glow('#fff6d8', 32), 0.1, -0.35, 0.9, 0.7);
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    const im = G.assets.img.icon_amber_arrow;
    if (im) { const s = p.size, h = s * im.height / im.width; ctx.drawImage(im, -s / 2, -h / 2, s, h); }
    ctx.restore();
  }
  function chargedUpdate(R, dt, p) {
    if (G.fx.trail && p.px != null) G.fx.trail(p.px, p.py - 0.9, p.x, p.y - 0.9, '#ff5a1a', 0.42);
    p.px = p.x; p.py = p.y;
    if (!reduced()) for (let i = 0; i < 2; i++) G.fx.particle({ x: p.x + U.rand(-0.15, 0.15), y: p.y - 0.9 + U.rand(-0.15, 0.15), vx: -p.vx * 0.08 + U.rand(-1, 1), vy: -p.vy * 0.08 + U.rand(-2, 0.5), life: U.rand(0.25, 0.5), size: U.rand(0.1, 0.2), color: U.chance(0.5) ? '#ffcf7a' : '#ff5a2a', glow: true, drag: 3 });
  }
  function chargedHit(R, p, e) {
    const first = !p.exploded;
    G.combat.hit(R, e, { mul: first ? p.mul : p.mul * 0.6, element: 'pyro', gauge: first ? 2 : 1, src: 'amber_charged', knock: first ? 2.2 : 1.2, kx: p.dx, ky: p.dy, critBonus: 0.25 });
    if (!first) return;
    p.exploded = true;
    const r = 1.3 * R.stats.explosionMul;
    G.fx.explosion(e.x, e.y, r, { color: '#ff7a3d', kind: 'small' });
    G.combat.aoe(R, e.x, e.y, r, { mul: p.mul * 0.5, element: 'pyro', gauge: 1, src: 'amber_charged', knock: 1.4, exclude: e, critBonus: 0.25 });
    G.fx.shake(0.35); G.audio.sfx('explosion', { x: e.x, y: e.y, vol: 0.8 });
  }
  function fireCharged(R, t) {
    const p = R.player, S = R.stats, d = U.norm(t.x - p.x, t.y - p.y), sp = 30 * (S.projSpeed || 1);
    const evo = !!R.evolved.evo_amber_normal;
    const mul = arrowMul(R) * 3.2 * (evo ? 1.25 : 1);
    W.fire(R, { x: p.x + d.x * 0.6, y: p.y + d.y * 0.6, vx: d.x * sp, vy: d.y * sp, life: 0.7, r: 0.6, px: p.x, py: p.y,
      mul, element: 'pyro', gauge: 2, src: 'amber_charged', pierce: 99, size: 1.9, update: chargedUpdate, onHit: chargedHit, draw: drawCharged });
    G.player.pose(R, 'attack', 0.3, d);
    G.fx.kick && G.fx.kick(-d.x, -d.y, 3);
    if (!reduced()) G.fx.burst(p.x + d.x * 0.7, p.y - 0.9 + d.y * 0.7, 12, '#ffcf7a', { max: 7, life: 0.3, size: 0.14, cone: 0.6, angle: Math.atan2(d.y, d.x) });
    G.fx.ring && G.fx.ring(p.x + d.x * 0.7, p.y - 0.4 + d.y * 0.7, 1.1, '#ffb347');
    G.audio.sfx('arrow', { x: p.x, y: p.y, pitch: 0.7, vol: 1 });
  }
  /** wind-up + release, driven from the kit update */
  function updateCharged(R, dt) {
    const Ws = R.wstate, p = R.player;
    if (Ws.chargeWind > 0) {
      Ws.chargeWind -= dt;
      // glow gathering at the bow
      if (!reduced() && U.chance(0.8)) { const a = U.rand(0, U.TAU), r = U.rand(0.8, 1.4); G.fx.particle({ x: p.x + Math.cos(a) * r, y: p.y - 1 + Math.sin(a) * r * 0.7, vx: -Math.cos(a) * r * 5, vy: -Math.sin(a) * r * 3.5, life: 0.18, size: 0.1, color: '#ffcf7a', glow: true, drag: 0 }); }
      if (Ws.chargeWind <= 0) {
        const t = chargedTarget(R);
        if (t) fireCharged(R, t);
        Ws.chargeT = 0;
      }
      return;
    }
    Ws.chargeT = (Ws.chargeT || 0) + dt;
    if (Ws.chargeT >= chargedPeriod(R) && W.nearestN(R, p.x, p.y, 13, 1).length) {
      Ws.chargeWind = 0.3;
      const t0 = chargedTarget(R); if (t0) G.player.pose(R, 'attack', 0.34, U.norm(t0.x - p.x, t0.y - p.y));
      G.fx.sparkle && G.fx.sparkle(p.x, p.y - 1.1, '#ffe6a8', 5, 0.5);
    }
  }

  /* ============================ SKILL: BARON BUNNY ============================ */
  // S.bunnyCharges (PROGRESSION) is the TOTAL (1, or 2 with C4 / evo_amber_skill)
  function maxCharges(R) { return Math.max(R.stats.bunnyCharges || 1, R.evolved.evo_amber_skill ? 2 : 1); }
  const SKILL_CD = 18;
  function skillCdBase(R) { return SKILL_CD * (R.stats.bunnyCdMul || 1) * Math.max(0.4, 1 - (R.stats.cdr || 0)); }

  // S.bunnyMul (PROGRESSION: 5→13.75, C2/C3 baked in); fallback only if absent
  function bunnyMul(R) { const S = R.stats; return (S.bunnyMul != null ? S.bunnyMul : 8 + 2.5 * lv(R, 'amber_skill')) * (1 + (S.bunnyDmg || 0)); }

  const HOP_T = [0.38, 0.82, 1.26, 1.7]; // throw lands at 0.38, hops land at .82 (ぴょん), 1.26 (ぴょん), 1.7 (BOOM)

  function spawnBunny(R) {
    const p = R.player, S = R.stats;
    // throw forward; if an enemy is roughly ahead, aim at it (max 5.5 units)
    let dx = p.face.x, dy = p.face.y;
    const t = W.nearestN(R, p.x + dx * 3, p.y + dy * 3, 4, 1)[0];
    let dist = 3.6;
    if (t) { const d = U.dist(p.x, p.y, t.x, t.y); if (d < 6.5) { const n = U.norm(t.x - p.x, t.y - p.y); dx = n.x; dy = n.y; dist = Math.max(1.5, Math.min(5.5, d - 0.5)); } }
    const evo = !!R.evolved.evo_amber_skill;
    const b = {
      x: p.x, y: p.y, sx0: p.x, sy0: p.y, tx: p.x + dx * dist, ty: p.y + dy * dist, t: 0, z: 0, stage: 0,
      squash: 0, evo, taunt: 0, dir: dx >= 0 ? 1 : -1, hx: 0, hy: 0, fanfare: evo && W.evoFirst(R, 'evo_amber_skill'),
      update: bunnyUpdate, draw: bunnyDraw,
    };
    R.props.push(b);
    G.player.pose(R, 'skill', 0.4, { x: dx, y: dy });
    G.audio.sfx('skill', { x: p.x, y: p.y });
  }

  function bunnyLand(R, b, idx) {
    b.squash = 1;
    G.audio.sfx('bunnyHop', { x: b.x, y: b.y });
    if (!reduced()) for (let i = 0; i < 10; i++) { const a = i / 10 * U.TAU; G.fx.particle({ x: b.x + Math.cos(a) * 0.35, y: b.y + Math.sin(a) * 0.15, vx: Math.cos(a) * 2.2, vy: Math.sin(a) * 0.9 - 0.3, life: 0.4, size: 0.12, color: '#d9c7a0', glow: false, drag: 5 }); }
    G.fx.ring && G.fx.ring(b.x, b.y, 1.1, '#ffd9b0');
    if (idx === 0) G.fx.reactionText && G.fx.reactionText(b.x, b.y - 2.1, b.evo ? '伯爵大行進！' : 'ちょうはつ！', '#ffc4d8');
    if (idx === 0 && b.evo) { // 伯爵大行進: the landing already goes off
      const r = BUNNY_BASE_R * R.stats.explosionMul * 0.5;
      G.fx.explosion(b.x, b.y, r, { color: '#ff8a3d', kind: 'hop' });
      G.combat.aoe(R, b.x, b.y, r, { mul: bunnyMul(R) * 0.35, element: 'pyro', gauge: 1, src: 'evo_amber_skill', knock: 1.2 });
    }
    if (idx === 1 || idx === 2) {
      G.fx.reactionText && G.fx.reactionText(b.x, b.y - 1.9, 'ぴょん', '#ffc4d8');
      if (b.evo) { // 伯爵大行進: every hop explodes
        const r = BUNNY_BASE_R * R.stats.explosionMul * 0.55;
        G.fx.explosion(b.x, b.y, r, { color: '#ff8a3d', kind: 'hop' });
        G.combat.aoe(R, b.x, b.y, r, { mul: bunnyMul(R) * 0.4, element: 'pyro', gauge: 1, src: 'evo_amber_skill', knock: 1.4 });
        G.audio.sfx('explosion', { x: b.x, y: b.y });
      }
    }
  }

  function bunnyUpdate(R, dt, b) {
    b.t += dt; if (b.squash > 0) b.squash = Math.max(0, b.squash - dt * 5);
    // position / height
    if (b.t < HOP_T[0]) {
      const k = b.t / HOP_T[0];
      b.x = U.lerp(b.sx0, b.tx, k); b.y = U.lerp(b.sy0, b.ty, k); b.z = Math.sin(k * Math.PI) * 2.2;
    } else {
      let i = 1; while (i < HOP_T.length - 1 && b.t >= HOP_T[i]) i++;
      const a = HOP_T[i - 1], c = HOP_T[i], k = U.clamp((b.t - a) / (c - a), 0, 1);
      b.z = Math.sin(k * Math.PI) * (i === 3 ? 1.35 : 0.95);
      b.x += b.hx * dt; b.y += b.hy * dt;
    }
    // landings
    while (b.stage < 3 && b.t >= HOP_T[b.stage]) {
      b.stage === 0 && (b.x = b.tx, b.y = b.ty);
      bunnyLand(R, b, b.stage);
      b.stage++;
      // next hop drifts a little toward the nearest enemy (alive-looking)
      const n = R.grid.nearest(b.x, b.y, 6);
      if (n) { const d = U.norm(n.x - b.x, n.y - b.y); b.hx = d.x * 1.3; b.hy = d.y * 1.3; b.dir = d.x >= 0 ? 1 : -1; } else { b.hx = b.hy = 0; }
    }
    // taunt: enemies nearby focus the bunny
    b.taunt -= dt;
    if (b.taunt <= 0) {
      b.taunt = 0.2;
      const until = R.time + 0.35;
      R.grid.query(b.x, b.y, b.evo ? 7.5 : 6, e => { if (!e.boss) { if (e.taunt) { e.taunt.x = b.x; e.taunt.y = b.y; e.taunt.until = until; } else e.taunt = { x: b.x, y: b.y, until }; } });
    }
    // fuse sparks after the first ぴょん
    if (b.stage >= 2 && !reduced() && U.chance(0.5)) G.fx.particle({ x: b.x + b.dir * 0.3, y: b.y - b.z - 1.35, vx: U.rand(-1.5, 1.5), vy: U.rand(-3, -1), life: 0.3, size: 0.07, color: '#ffd27a', glow: true, grav: 6 });
    if (b.t >= HOP_T[3]) { bunnyExplode(R, b); return false; }
  }

  function bunnyExplode(R, b) {
    const S = R.stats;
    const r = BUNNY_BASE_R * S.explosionMul * (b.evo ? 1.3 : 1);
    G.fx.explosion(b.x, b.y, r, { color: '#ff7a3d', kind: 'big' });
    W.boom(R, b.x, b.y, r * 0.55, { color: '#ffb347', life: 0.55 });
    G.fx.shake(1.1); G.fx.hitstop(0.05);
    G.fx.flash && G.fx.flash('#ffb347', 0.22);
    G.fx.zoomPunch && G.fx.zoomPunch(0.05);
    G.audio.sfx('bigExplosion', { x: b.x, y: b.y });
    if (!reduced()) {
      for (let i = 0; i < 26; i++) { const a = U.rand(0, U.TAU), s = U.rand(3, 11); G.fx.particle({ x: b.x, y: b.y - 0.6, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7 - 3, life: U.rand(0.5, 1), size: U.rand(0.1, 0.24), color: U.chance(0.5) ? '#ffcf7a' : '#ff5a2a', glow: true, grav: 9, drag: 1.5 }); }
    }
    const n = G.combat.aoe(R, b.x, b.y, r, { mul: bunnyMul(R) * (b.evo ? 1.25 : 1), element: 'pyro', gauge: 2, src: b.evo ? 'evo_amber_skill' : 'amber_skill', knock: 2.6 });
    // Genshin: the skill scatters pyro elemental particles that fly back to Amber and charge her burst
    if (n > 0) spawnParticles(R, b.x, b.y, 2 + Math.min(2, Math.floor(n / 4)), 2);
    if (b.fanfare) { W.evoFanfare(R, b.x, b.y, '#ff7a3d', r * 1.2, 'evo_amber_skill'); b.fanfare = false; }
  }

  function spawnParticles(R, x, y, n, value) {
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, U.TAU), s = U.rand(3, 6);
      G.loot.add(R, { type: 'energy', x: x + Math.cos(a) * 0.3, y: y + Math.sin(a) * 0.3, value, el: 'pyro', vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(5, 8), magnet: true, sp: -7 - i * 1.5 });
    }
  }

  function bunnyDraw(ctx, b) {
    const R = G.run;
    // taunt aura ring (pulsing) while alive
    const tr = b.evo ? 7.5 : 6, pulse = (R.time * 1.6) % 1;
    ctx.globalAlpha = 0.18 * (1 - pulse); ctx.strokeStyle = '#ff9ab8'; ctx.lineWidth = 0.08;
    ctx.beginPath(); ctx.arc(b.x, b.y, tr * (0.25 + 0.75 * pulse), 0, U.TAU); ctx.stroke(); ctx.globalAlpha = 1;
    G.render.shadow(ctx, b.x, b.y, 0.55 * (1 - Math.min(0.5, b.z * 0.15)), 0.3);
    // fuse glow gets hotter towards the explosion
    const heat = U.clamp((b.t - HOP_T[1]) / (HOP_T[3] - HOP_T[1]), 0, 1);
    if (heat > 0) {
      const blink = 0.5 + 0.5 * Math.sin(b.t * (10 + heat * 30));
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = heat * (0.4 + 0.5 * blink);
      ctx.drawImage(glow('#ff4a1a', 64), b.x - 1.3, b.y - b.z - 2.1, 2.6, 2.6);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // squash & stretch
    const sq = b.squash, air = b.z > 0.05 ? 1 : 0;
    const sx = (1 + sq * 0.35 - air * 0.08), sy = (1 - sq * 0.3 + air * 0.12);
    const im = G.assets.img.icon_bunny; if (!im) return;
    const size = 1.85, w = size * sx, h = size * im.height / im.width * sy;
    ctx.save(); ctx.translate(b.x, b.y - b.z); ctx.scale(b.dir, 1);
    ctx.drawImage(im, -w / 2, -h + 0.05, w, h);
    if (heat > 0.5 && Math.sin(b.t * 40) > 0.3) { ctx.globalAlpha = (heat - 0.5) * 1.2; ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(im, -w / 2, -h + 0.05, w, h); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    ctx.restore();
  }

  /* ============================ BURST: 矢の雨 ============================ */
  let rainDisc = null;
  function rainCanvas() {
    if (rainDisc) return rainDisc;
    const c = G.assets.makeCanvas(256, 256), x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 20, 128, 128, 128);
    g.addColorStop(0, 'rgba(255,140,60,0.10)'); g.addColorStop(0.75, 'rgba(255,110,40,0.20)'); g.addColorStop(0.93, 'rgba(255,90,30,0.42)'); g.addColorStop(1, 'rgba(255,90,30,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    rainDisc = c; return c;
  }

  function fallingArrow(R, f, tx, ty, opts) {
    const T = opts.big ? 0.42 : 0.26, ox = opts.big ? -3.2 : -2.0, oy = opts.big ? -12 : -8.5;
    W.fire(R, {
      x: tx + ox, y: ty + oy, vx: -ox / T, vy: -oy / T, life: T, noHit: true, big: opts.big, tx, ty,
      update(R2, dt, p) { if (p.big && !reduced() && U.chance(0.7)) G.fx.particle({ x: p.x, y: p.y, vx: U.rand(-1, 1), vy: U.rand(-2, 0), life: 0.35, size: 0.14, color: '#ffb347', glow: true }); },
      draw(ctx, p) {
        const a = Math.atan2(p.vy, p.vx), s = p.big ? 2.4 : 1.15;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.75;
        ctx.drawImage(glow(p.big ? '#ff4a1a' : '#ff7a3d', 64), -s * 2.2, -s * 0.28, s * 2.6, s * 0.56);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        const im = G.assets.img.icon_amber_arrow; if (im) ctx.drawImage(im, -s / 2, -s / 2, s, s);
        ctx.restore();
        // target marker on the ground
        const k = p.t / p.life; ctx.globalAlpha = 0.35 * k; ctx.strokeStyle = '#ffcf7a'; ctx.lineWidth = 0.05;
        ctx.beginPath(); ctx.arc(p.tx, p.ty, (p.big ? 1.2 : 0.5) * (1.4 - k * 0.6), 0, U.TAU); ctx.stroke(); ctx.globalAlpha = 1;
      },
      onEnd(R2) { opts.onImpact(R2, tx, ty); },
    });
  }

  // S.rainMul (PROGRESSION: 1.8→4.5 per hit, C5/relic baked in). Our rain drops ~8 small AoE arrows per 0.3s tick
  // instead of one big AoE, so each arrow deals 0.6 × rainMul.
  function burstMul(R) { const S = R.stats; return (S.rainMul != null ? S.rainMul * 0.6 : 1.0 + 0.3 * lv(R, 'amber_burst')) * (1 + (S.burstBonus || 0)); }

  function castBurst(R) {
    const p = R.player, S = R.stats, L = lv(R, 'amber_burst'), evo = !!R.evolved.evo_amber_burst;
    const cx = p.x, cy = p.y; // FIXED at cast position (spec)
    const r = 7 * S.explosionMul / 2 * (evo ? 1.4 : 1) * (S.burstArea || 1);
    const life = ((S.rainDur != null ? S.rainDur : 8 + 0.5 * L) + (S.burstDuration || 0)) * (S.durationMul || 1);
    G.player.pose(R, 'burst', 0.6, { x: 0, y: -1 });
    // cut-in (+ its slowmo) and the 'burst' sfx are fired from the 'burst' bus event emitted by G.weapons.tryBurst
    G.fx.zoomPunch && G.fx.zoomPunch(0.08);
    G.fx.flash && G.fx.flash('#ffcf7a', 0.35);
    G.fx.pillar && G.fx.pillar(p.x, p.y, '#ff9a3d', 12, 1.6, 0.9);
    G.fx.ring && G.fx.ring(cx, cy, r, '#ffcf7a');
    const fan = evo && W.evoFirst(R, 'evo_amber_burst');
    if (fan) W.evoFanfare(R, cx, cy, '#ff5a1a', r, 'evo_amber_burst');
    // opening volley shot into the sky
    for (let i = 0; i < (reduced() ? 8 : 22); i++) {
      const a = -Math.PI / 2 + U.rand(-0.5, 0.5), s = U.rand(26, 38);
      W.fire(R, { x: p.x, y: p.y - 1, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.35, noHit: true, size: 1.1, t0: i * 0.02, draw: drawArrow, update: arrowUpdate, dx: 0, dy: -1 });
    }
    const mul = burstMul(R);
    let ticks = 0;
    W.field(R, {
      x: cx, y: cy, r, life, tick: 0.3, next: 0.45, ground: true,
      onTick(R2, f) {
        ticks++;
        const n = reduced() ? 6 : 12 + (evo ? 5 : 0) + (fan ? 6 : 0);
        for (let i = 0; i < n; i++) {
          const a = U.rand(0, U.TAU), d = Math.sqrt(U.rnd()) * f.r * 0.95;
          const tx = f.x + Math.cos(a) * d, ty = f.y + Math.sin(a) * d * 0.95;
          fallingArrow(R2, f, tx, ty, { onImpact: rainImpact });
        }
        if (ticks % 2 === 1) G.audio.sfx('burstRain', { x: f.x, y: f.y });
        // cosmetic arrows streaking down over the WHOLE screen: the sky is full of fire
        if (!reduced()) {
          const he = G.render.halfExtents(), cam = G.view.cam;
          for (let i = 0; i < 14; i++) G.fx.particle({ x: cam.x + U.rand(-he.x, he.x), y: cam.y + U.rand(-he.y, he.y * 0.6), vx: 7, vy: 30, life: U.rand(0.18, 0.3), size: U.rand(0.12, 0.2), color: U.chance(0.5) ? '#ffb347' : '#ff7a3d', streak: true, drag: 0 });
        }
        if (evo && ticks % 2 === 0) burningGround(R2, f.x + U.rand(-f.r, f.r) * 0.7, f.y + U.rand(-f.r, f.r) * 0.7);
      },
      onEnd(R2, f) { if (evo) meteorVolley(R2, f); },
      draw(ctx, f) {
        const fi = Math.min(1, f.t / 0.35), fo = Math.min(1, (f.life - f.t) / 0.6), a = Math.min(fi, fo);
        // the sky darkens to a smouldering orange while the rain lasts
        { const he = G.render.halfExtents(), cam = G.view.cam; ctx.globalAlpha = a * 0.16; ctx.fillStyle = '#5a1a00'; ctx.fillRect(cam.x - he.x - 2, cam.y - he.y - 2, he.x * 2 + 4, he.y * 2 + 4); }
        ctx.globalAlpha = a; ctx.drawImage(rainCanvas(), f.x - f.r, f.y - f.r, f.r * 2, f.r * 2);
        // rotating dashed rim + inner rune ring
        ctx.strokeStyle = '#ffcf7a'; ctx.lineWidth = 0.09; ctx.globalAlpha = 0.75 * a;
        ctx.setLineDash([0.7, 0.45]); ctx.lineDashOffset = -f.t * 2.2;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * fi, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([0.25, 0.6]); ctx.lineDashOffset = f.t * 1.5; ctx.lineWidth = 0.06; ctx.globalAlpha = 0.5 * a;
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 0.82 * fi, 0, U.TAU); ctx.stroke();
        ctx.setLineDash([]); ctx.globalAlpha = 1;
      },
    });
    G.bus.emit('notice', { text: '矢の雨！', color: '#ffb347' });
    function rainImpact(R2, x, y) {
      G.combat.aoe(R2, x, y, 1.6, { mul, element: 'pyro', gauge: 0.5, src: evo ? 'evo_amber_burst' : 'amber_burst', knock: 0.5, critBonus: 0.1 });
      G.fx.hitSpark && G.fx.hitSpark(x, y - 0.1, 'pyro', false);
      if (!reduced()) {
        for (let i = 0; i < 5; i++) G.fx.particle({ x, y: y - 0.1, vx: U.rand(-2.5, 2.5), vy: U.rand(-4, -1.5), life: U.rand(0.25, 0.45), size: U.rand(0.06, 0.12), color: U.chance(0.5) ? '#ffcf7a' : '#ff6a2a', glow: true, grav: 10 });
        stuckArrow(R2, x, y);
      }
    }
  }

  /** arrow stuck in the ground that fades out (cheap minor field) */
  function stuckArrow(R, x, y) {
    const rot = Math.PI / 2 + 0.23 + U.rand(-0.1, 0.1);
    W.field(R, { x, y, life: 0.9, minor: true, ground: true,
      draw(ctx, f) {
        const k = f.t / f.life;
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * (1 - k);
        ctx.drawImage(glow('#ff7a3d', 32), x - 0.45, y - 0.25, 0.9, 0.5);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1 - k;
        G.render.icon(ctx, 'amber_arrow', x - 0.12, y - 0.38, 0.85, rot);
        ctx.globalAlpha = 1;
      } });
  }

  function burningGround(R, x, y) {
    const im = G.assets.img.icon_vfx_embers;
    W.field(R, { x, y, r: 1.5, life: 3.2, tick: 0.5, minor: true, ground: true,
      onTick(R2, f) { G.combat.aoe(R2, f.x, f.y, f.r, { mul: 0.45 * burstMul(R2), element: 'pyro', gauge: 0.3, src: 'evo_amber_burst', quiet: true }); },
      draw(ctx, f) {
        const a = Math.min(1, f.t / 0.2, (f.life - f.t) / 0.6);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.45 * a;
        ctx.drawImage(glow('#ff5a1a', 64), f.x - f.r * 1.2, f.y - f.r * 0.8, f.r * 2.4, f.r * 1.6);
        ctx.globalCompositeOperation = 'source-over';
        if (im) {
          const cw = im.width / 4, ch = im.height / 2;
          for (let i = 0; i < 3; i++) {
            const fr = (Math.floor(f.t * 10) + i * 3) % 8, ox = (i - 1) * 0.6, s = 1.1;
            ctx.globalAlpha = a; ctx.drawImage(im, (fr % 4) * cw, Math.floor(fr / 4) * ch, cw, ch, f.x + ox - s / 2, f.y - s + 0.2 - (i === 1 ? 0.15 : 0), s, s);
          }
        }
        ctx.globalAlpha = 1;
      } });
  }

  function meteorVolley(R, f) {
    const n = reduced() ? 6 : 12;
    G.fx.flash && G.fx.flash('#ff8a3d', 0.25);
    for (let i = 0; i < n; i++) {
      const a = i / n * U.TAU + U.rand(-0.2, 0.2), d = f.r * U.rand(0.15, 0.8);
      const tx = f.x + Math.cos(a) * d, ty = f.y + Math.sin(a) * d;
      setTimeoutRun(R, i * 0.07, () => fallingArrow(R, f, tx, ty, { big: true, onImpact: (R2, x, y) => {
        const r = 1.5 * R2.stats.explosionMul;
        G.fx.explosion(x, y, r, { color: '#ff5a1a', kind: 'meteor' });
        G.combat.aoe(R2, x, y, r, { mul: 4.5 * burstMul(R2), element: 'pyro', gauge: 1, src: 'evo_amber_burst', knock: 2 });
        G.audio.sfx('bigExplosion', { x, y });
      } }));
    }
  }
  /** delayed action in run-time (pauses with the game) */
  function setTimeoutRun(R, delay, fn) { W.field(R, { x: 0, y: 0, life: delay, onEnd: fn, ground: true }); }

  /* ============================ KIT ============================ */
  G.weapons.kits.amber = {
    update(R, dt) {
      const Ws = R.wstate, S = R.stats, p = R.player;
      // normal attack
      Ws.arrowT = (Ws.arrowT || 0) - dt;
      if (Ws.arrowT <= 0) {
        if (fireArrows(R)) Ws.arrowT = (S.normalInterval || 0.78) * (S.featherCd || 1) / (Math.max(0.2, S.haste) * arrowRate(R));
        else Ws.arrowT = 0.1;
      }
      updateCharged(R, dt);
      // bunny charges
      const mc = maxCharges(R);
      if (Ws.bunnyCharges == null) { Ws.bunnyCharges = mc; Ws.bunnyMax = mc; }
      if (mc > Ws.bunnyMax) { Ws.bunnyCharges += mc - Ws.bunnyMax; Ws.bunnyMax = mc; if (Ws.bunnyCharges > 0) p.skillCd = 0; } // new charge granted (C4 / evolution)
      else if (mc < Ws.bunnyMax) { Ws.bunnyMax = mc; Ws.bunnyCharges = Math.min(Ws.bunnyCharges, mc); }
      if (mc > 1) {
        if (Ws.bunnyCharges < mc) {
          Ws.bunnyRecharge = (Ws.bunnyRecharge || 0) + dt;
          if (Ws.bunnyRecharge >= skillCdBase(R)) { Ws.bunnyRecharge = 0; Ws.bunnyCharges++; if (Ws.bunnyCharges >= 1) p.skillCd = Math.min(p.skillCd, 0); }
        }
      }
    },
    skill(R) {
      const Ws = R.wstate;
      if (maxCharges(R) > 1) { if ((Ws.bunnyCharges || 0) <= 0) return false; Ws.bunnyCharges--; }
      spawnBunny(R);
    },
    skillCd(R) {
      const Ws = R.wstate, mc = maxCharges(R);
      if (mc > 1) return Ws.bunnyCharges > 0 ? 0.6 : Math.max(0.6, skillCdBase(R) - (Ws.bunnyRecharge || 0));
      return skillCdBase(R);
    },
    burst(R) { castBurst(R); },
    // exported for HUD / tests
    charges(R) { return { n: R.wstate.bunnyCharges == null ? maxCharges(R) : R.wstate.bunnyCharges, max: maxCharges(R) }; },
  };
})();
