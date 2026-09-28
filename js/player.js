/* player.js — the controlled character: movement, facing, HP/shield/energy, taking damage, drawing.
   Final stats come from G.progression.computeStats(R) (base char + mora meta + relics + run upgrades). */
'use strict';
G.player = (function () {
  const U = G.u;
  /* rules v6: every character is invulnerable for BURST_GUARD seconds after casting the elemental burst.
     Hooked on the shared 'burst' bus event (emitted by G.weapons.tryBurst before the kit's burst) → works for any kit. */
  const BURST_GUARD = 2;
  G.bus.on('burst', () => {
    const R = G.run, p = R && R.player; if (!p || R.over) return;
    p.burstGuard = BURST_GUARD; p.invuln = Math.max(p.invuln || 0, BURST_GUARD);
  });
  function init(R) {
    const ch = R.char;
    R.player = {
      x: 0, y: 0, vx: 0, vy: 0, face: { x: 0, y: 1 }, aim: { x: 0, y: 1 },
      hp: ch.hp, maxHp: ch.hp, shield: 0, shieldMax: 0, shieldTime: 0,
      energy: 0, level: 1, xp: 0, xpNeed: G.data.xpNeed(1),
      invuln: 0, flash: 0, anim: { state: 'idle', t: 0, lock: 0 },
      skillCd: 0, burstCd: 0, revived: false, moving: false, hurtTimer: 0,
      r: 0.38, h: 2.25,
    };
    G.player.refreshStats(R);
    R.player.hp = R.player.maxHp;
  }

  function refreshStats(R) {
    const p = R.player; const oldMax = p.maxHp;
    R.stats = G.progression.computeStats(R);
    p.maxHp = Math.round(R.stats.maxHp);
    if (oldMax && p.maxHp > oldMax) p.hp += p.maxHp - oldMax; // growing max HP heals by the same amount
    p.hp = Math.min(p.hp, p.maxHp);
  }

  /* movement feel: analog stick response curve (full speed at ~80% tilt, gentle creep near the centre),
     quick start, extra-snappy turns, short skid on stop, and a "wind stride" that builds up while running */
  const MV = { x: 0, y: 0 };
  function moveInput() {
    const mv = G.input.move; let x = mv.x, y = mv.y; const m = Math.hypot(x, y);
    if (m > 0.01 && m < 0.999) { const k = Math.pow(Math.min(1, m / 0.8), 0.85) / m; x *= k; y *= k; }
    MV.x = x; MV.y = y; return MV;
  }
  function update(R, dt) {
    const p = R.player, S = R.stats, mv = moveInput();
    const moving = Math.abs(mv.x) + Math.abs(mv.y) > 0.01;
    // wind stride: after ~0.45 s of continuous running the speed builds up to +12 % (resets when stopping)
    p.runT = moving ? (p.runT || 0) + dt : Math.max(0, (p.runT || 0) - dt * 4);
    const stride = U.clamp((p.runT - 0.45) / 0.5, 0, 1);
    p.stride = stride;
    const speed = S.speed * (1 + 0.12 * stride);
    const tx = mv.x * speed, ty = mv.y * speed;
    // accel: fast start, very fast turn (reversing feels crisp), slightly softer stop (a tiny skid)
    const dot = p.vx * tx + p.vy * ty, turning = moving && dot < 0;
    const acc = !moving ? 55 : turning ? 140 : 70;
    p.vx = U.approach(p.vx, tx, acc * dt); p.vy = U.approach(p.vy, ty, acc * dt);
    p.x += p.vx * dt; p.y += p.vy * dt;
    // squash & stretch events for the sprite: start = stretch, stop/turn = squash
    if (moving && !p.moving) p.squash = -0.1; else if (!moving && p.moving) p.squash = 0.12; else if (turning && !(p.squash > 0.05)) p.squash = 0.07;
    if (p.squash) { p.squash *= Math.exp(-dt * 12); if (Math.abs(p.squash) < 0.004) p.squash = 0; }
    if (moving) { const l = Math.hypot(mv.x, mv.y); p.face.x = mv.x / l; p.face.y = mv.y / l; }
    p.moving = moving;
    // animation state (attack/skill poses are locked for a moment)
    p.anim.t += dt;
    if (p.anim.lock > 0) p.anim.lock -= dt;
    else { const st = moving ? 'walk' : 'idle'; if (p.anim.state !== st) { p.anim.state = st; p.anim.t = 0; } }
    if (p.invuln > 0) p.invuln -= dt;
    if (p.burstGuard > 0) p.burstGuard -= dt;
    if (p.flash > 0) p.flash -= dt * 6;
    if (p.hurtTimer > 0) p.hurtTimer -= dt;
    if (p.shieldTime > 0) { p.shieldTime -= dt; if (p.shieldTime <= 0) { p.shield = 0; } }
    // regen from stats (e.g. relic / upgrade)
    if (S.regen > 0 && p.hp > 0) p.hp = Math.min(p.maxHp, p.hp + S.regen * dt);
    // cooldowns
    p.skillCd = Math.max(0, p.skillCd - dt); p.burstCd = Math.max(0, p.burstCd - dt);
    // actions
    if (G.input.consume('skill')) G.weapons.trySkill(R);
    if (G.input.consume('burst')) G.weapons.tryBurst(R);
  }

  /** play a locked pose (attack/skill/burst) facing a direction */
  function pose(R, state, dur, dir) {
    const p = R.player; p.anim.state = state; p.anim.t = 0; p.anim.lock = dur || 0.25;
    if (dir) { p.aim.x = dir.x; p.aim.y = dir.y; }
  }

  /** damage the player; returns HP actually lost. src: {x,y,kind,element} */
  function hurt(R, amount, src) {
    const p = R.player; if (p.invuln > 0 || R.over || p.hp <= 0) return 0;
    const S = R.stats;
    let dmg = amount * 100 / (100 + S.def);
    dmg *= (1 - (S.dmgReduction || 0));
    if (p.shield > 0) { const a = Math.min(p.shield, dmg); p.shield -= a; dmg -= a; G.fx.shieldHit && G.fx.shieldHit(p.x, p.y); }
    dmg = Math.round(dmg);
    p.invuln = 0.45; p.flash = 1;
    if (dmg > 0) {
      p.hp -= dmg; p.hurtTimer = 0.4;
      G.fx.number(p.x, p.y - 1.8, dmg, { color: '#ff4d4d', size: 0.9, player: true });
      G.fx.shake(0.35 + Math.min(0.6, dmg / p.maxHp * 3));
      G.fx.hurtFlash && G.fx.hurtFlash(Math.min(1, dmg / p.maxHp * 4));
      G.audio.sfx('hurt');
      G.bus.emit('playerHurt', { amount: dmg, src });
      if (p.hp <= 0) {
        if (S.revival && !p.revived) { p.revived = true; p.hp = Math.round(p.maxHp * 0.5); p.invuln = 3; G.bus.emit('revive'); G.fx.revive && G.fx.revive(p.x, p.y); }
        else { p.hp = 0; }
      }
    }
    return dmg;
  }

  function heal(R, amount) {
    const p = R.player; const before = p.hp; p.hp = Math.min(p.maxHp, p.hp + amount);
    const got = Math.round(p.hp - before);
    if (got > 0) { G.fx.number(p.x, p.y - 1.9, got, { color: '#7dff8a', size: 0.8, prefix: '+' }); G.fx.healBurst && G.fx.healBurst(p.x, p.y); }
    return got;
  }

  function addEnergy(R, amount) {
    const p = R.player; const cost = R.char.energyCost;
    const was = p.energy >= cost;
    p.energy = Math.min(cost, p.energy + amount * R.stats.recharge);
    if (!was && p.energy >= cost) G.bus.emit('burstReady');
  }

  function addShield(R, amount, time) {
    const p = R.player; p.shield = Math.max(p.shield, amount); p.shieldMax = Math.max(p.shield, p.shieldMax || 0, amount); p.shieldTime = time || 15;
  }

  /* ---- visuals (owner: VFX) ---- */
  const vis = { lastT: 0, dustT: 0, emberT: 0, lastFx: 0, lastFy: 1, sparkT: 0 };
  function draw(ctx) {
    const R = G.run, p = R.player, t = G.time, fx = G.fx;
    const reduced = G.save.data.settings.reducedFx;
    const dt = Math.min(0.1, Math.max(0, t - vis.lastT)); vis.lastT = t;
    const el = G.EL[R.char.element] || G.EL.pyro;
    const full = p.energy >= R.char.energyCost && !(p.burstCd > 0);
    const frac = p.maxHp ? p.hp / p.maxHp : 1;
    const paused = G.game.isPaused();
    G.render.shadow(ctx, p.x, p.y, 0.62, 0.36);
    // element glow under the feet (brighter when the burst is ready)
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.26 + Math.sin(t * 3) * 0.06 + (full ? 0.18 + Math.sin(t * 6) * 0.08 : 0);
    ctx.drawImage(G.assets.glow(el.color, 64), p.x - 1.2, p.y - 0.55, 2.4, 1.1);
    if (frac < 0.3 && p.hp > 0) { // low-HP heartbeat glow
      const per = 0.55 + frac * 1.2, ph = (t % per) / per, beat = Math.exp(-ph * 10);
      ctx.globalAlpha = 0.25 + beat * 0.55; ctx.drawImage(G.assets.glow('#ff2a3a', 64), p.x - 1.5, p.y - 2.1, 3, 2.6);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    // burst-ready ground sigil: two counter-rotating arcs
    if (full) {
      ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
      ctx.strokeStyle = el.light; ctx.lineWidth = 0.06; ctx.globalAlpha = 0.55 + Math.sin(t * 5) * 0.2;
      ctx.beginPath(); for (let j = 0; j < 3; j++) { const a0 = t * 1.6 + j * 2.094; ctx.ellipse(p.x, p.y, 0.95, 0.4, 0, a0, a0 + 1.3); } ctx.stroke();
      ctx.strokeStyle = el.color; ctx.lineWidth = 0.04;
      ctx.beginPath(); for (let j = 0; j < 3; j++) { const a0 = -t * 2.2 + j * 2.094; ctx.moveTo(p.x + Math.cos(a0) * 1.15, p.y + Math.sin(a0) * 0.5); ctx.ellipse(p.x, p.y, 1.15, 0.5, 0, a0, a0 + 0.8); } ctx.stroke();
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // movement dust puffs + pyro embers (emitted from here, rate-limited in real time)
    if (!paused && fx) {
      const sp = Math.hypot(p.vx, p.vy);
      if (p.moving && sp > 1) {
        vis.dustT -= dt;
        const turn = p.face.x * vis.lastFx + p.face.y * vis.lastFy < 0.3;
        if (vis.dustT <= 0 || turn) { vis.dustT = 0.13; fx.dust && fx.dust(p.x, p.y + 0.05, p.vx / sp, p.vy / sp, turn ? 5 : 1); }
        vis.lastFx = p.face.x; vis.lastFy = p.face.y;
      }
      vis.emberT -= dt;
      if (!reduced && vis.emberT <= 0) { vis.emberT = full ? 0.06 : 0.22; fx.mote && fx.mote(p.x + (Math.random() - 0.5) * 0.9, p.y - Math.random() * 1.6, full ? el.light : el.color); }
      if (full && !reduced) { vis.sparkT -= dt; if (vis.sparkT <= 0) { vis.sparkT = 0.35; fx.sparkle && fx.sparkle(p.x, p.y - 1.2, '#ffe6a8', 1, 0.8); } }
    }
    // blink while invulnerable
    const blink = p.invuln > 0 && p.hurtTimer > 0 && (Math.floor(t * 20) & 1);
    const face = p.anim.lock > 0 ? p.aim : p.face;
    // squash & stretch while walking
    const spd = Math.hypot(p.vx, p.vy), stepF = 9 + spd * 0.9;
    const bob = p.moving ? Math.abs(Math.sin(p.anim.t * stepF)) * (0.05 + 0.03 * (p.stride || 0)) : Math.sin(t * 2.4) * 0.015;
    const sq = p.squash || 0;
    // lean into the run (rotate about the feet); stronger while the wind stride is up
    const lean = U.clamp(p.vx / Math.max(1, R.stats.speed), -1.2, 1.2) * (0.07 + 0.05 * (p.stride || 0));
    if (!paused && fx && !reduced && (p.stride || 0) > 0.6 && spd > 2) {
      vis.windT = (vis.windT || 0) - dt;
      if (vis.windT <= 0) { vis.windT = 0.05; fx.particle({ x: p.x - p.vx * 0.06 + (Math.random() - 0.5) * 0.9, y: p.y - 0.3 - Math.random() * 1.6, vx: -p.vx * 0.9, vy: -p.vy * 0.9, life: 0.22, size: 0.09, color: '#e8fff6', streak: true, drag: 2 }); }
    }
    // orbiting burst-ready sparks (behind half)
    const orb = (front) => {
      if (!full) return;
      ctx.globalCompositeOperation = 'lighter';
      for (let j = 0; j < 3; j++) {
        const a = t * 2.6 + j * 2.094, sn = Math.sin(a); if ((sn > 0) !== front) continue;
        const ox = p.x + Math.cos(a) * 0.85, oy = p.y - 1.05 + sn * 0.32 + Math.sin(t * 3 + j) * 0.12, s = 0.2 + (front ? 0.06 : 0);
        ctx.globalAlpha = front ? 0.95 : 0.6; ctx.drawImage(G.assets.glow(el.light, 32), ox - s * 1.5, oy - s * 1.5, s * 3, s * 3);
        ctx.globalAlpha = 1; ctx.drawImage(G.assets.glow('#ffffff', 16), ox - s * 0.45, oy - s * 0.45, s * 0.9, s * 0.9);
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    };
    orb(false);
    if (lean) { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(lean); ctx.translate(-p.x, -p.y); }
    G.render.drawActor(ctx, { atlas: (G.run && G.run.char && G.run.char.atlas) || 'amber', x: p.x, y: p.y, h: p.h, face, anim: p.anim, flash: p.flash, alpha: blink ? 0.45 : 1, sx: 1 - bob * 0.5 + sq * 0.8, sy: 1 + bob - sq });
    if (lean) ctx.restore();
    orb(true);
    if (p.burstGuard > 0) drawGuard(ctx, p, el, t);
    // 狙い撃ち wind-up: a hot glow gathers at the bow
    const cw = R.wstate && R.wstate.chargeWind;
    if (cw > 0) {
      const k = 1 - cw / 0.3, bx = p.x + p.aim.x * 0.45, by = p.y - 1.0 + p.aim.y * 0.3, s = 0.5 + k * 0.9;
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + 0.5 * k;
      ctx.drawImage(G.assets.glow('#ff7a3d', 64), bx - s, by - s, s * 2, s * 2);
      ctx.globalAlpha = 0.9; ctx.drawImage(G.assets.glow('#fff1c8', 32), bx - s * 0.35, by - s * 0.35, s * 0.7, s * 0.7);
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    }
    // facing arrow (spec: always clearly visible) — drawn on the ground ring, in front of the sprite
    {
      const fx2 = p.face.x, fy2 = p.face.y, ax = p.x + fx2 * 1.2, ay = p.y - 0.12 + fy2 * 0.72, pulse = 1 + Math.sin(t * 6) * 0.08;
      const ang = Math.atan2(fy2 * 0.6, fx2);
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(ang); ctx.scale(pulse, pulse);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55;
      ctx.drawImage(G.assets.glow(el.color, 32), -0.45, -0.35, 0.9, 0.7);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.lineJoin = 'round';
      ctx.fillStyle = '#fffaf0'; ctx.strokeStyle = 'rgba(60,20,5,.85)'; ctx.lineWidth = 0.06;
      ctx.beginPath(); ctx.moveTo(0.34, 0); ctx.lineTo(-0.1, 0.22); ctx.lineTo(-0.02, 0); ctx.lineTo(-0.1, -0.22); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(0.02, 0); ctx.lineTo(-0.3, 0.16); ctx.lineTo(-0.24, 0); ctx.lineTo(-0.3, -0.16); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    // shield bubble
    if (p.shield > 0) G.fx.drawShield ? G.fx.drawShield(ctx, p) : null;
    // small HP bar under the player (Vampire Survivors style)
    const w = 1.2;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(p.x - w / 2, p.y + 0.22, w, 0.13);
    ctx.fillStyle = frac > 0.35 ? '#7dff8a' : (Math.sin(t * 10) > 0 ? '#ff5a4d' : '#ff9a8a'); ctx.fillRect(p.x - w / 2 + 0.02, p.y + 0.24, (w - 0.04) * Math.max(0, frac), 0.09);
    if (p.shield > 0) { ctx.fillStyle = '#ffd24a'; ctx.fillRect(p.x - w / 2 + 0.02, p.y + 0.24, (w - 0.04) * Math.min(1, p.shield / p.maxHp), 0.04); }
  }

  /** burst invulnerability bubble: pops in, shimmering hex ring + orbiting sparks, blinks during the last 0.6 s */
  function drawGuard(ctx, p, el, t) {
    const gd = p.burstGuard, k = U.clamp((BURST_GUARD - gd) / 0.15, 0, 1), pop = 1 + (1 - k) * 0.5;
    const a = gd < 0.6 ? (Math.floor(t * 14) & 1 ? 0.3 : 0.95) : 1;
    const cx = p.x, cy = p.y - 1.0, rx = 1.0 * pop, ry = 1.3 * pop;
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.45 * a; ctx.drawImage(G.assets.glow(el.light || '#fff3c4', 64), cx - rx * 1.4, cy - ry * 1.3, rx * 2.8, ry * 2.6);
    ctx.globalAlpha = 0.85 * a; ctx.lineWidth = 0.07; ctx.strokeStyle = '#fff3c4';
    ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, U.TAU); ctx.stroke();
    ctx.globalAlpha = 0.6 * a; ctx.lineWidth = 0.05; ctx.strokeStyle = el.color || '#ffb347';
    ctx.beginPath();
    for (let i = 0; i <= 6; i++) { const q = t * 1.8 + i * U.TAU / 6, x = cx + Math.cos(q) * rx * 0.86, y = cy + Math.sin(q) * ry * 0.86; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
    ctx.stroke();
    ctx.globalAlpha = a;
    for (let i = 0; i < 4; i++) { const q = -t * 3.2 + i * U.TAU / 4, x = cx + Math.cos(q) * rx, y = cy + Math.sin(q) * ry; ctx.drawImage(G.assets.glow('#ffffff', 16), x - 0.16, y - 0.16, 0.32, 0.32); }
    ctx.restore();
  }

  return { init, update, refreshStats, pose, hurt, heal, addEnergy, addShield, draw };
})();
