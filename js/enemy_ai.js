/* enemy_ai.js — per-behaviour enemy AI: G.enemyAI[aiName] = (R, e, dt, nx, ny, dist) -> {x,y} velocity | null.
   Every attack: wind-up pose + readable telegraph (≥0.6 s for anything that hurts a lot) → motion → impact.
   Attack visuals live in G.enemyFx (enemies.js) and all wear the black-purple enemy aura.
   Also: init(R,e), reset(e) (cancel attack, used for taunts/recycling), drawExtra(ctx,e,x,y,H,t). */
'use strict';
G.enemyAI = (function () {
  const U = G.u;
  const V = { x: 0, y: 0 };
  const FX = () => G.enemyFx;
  function vel(x, y) { V.x = x; V.y = y; return V; }
  function set(e, st, dur) { e.st = st; e.stT = 0; e.stDur = dur || 0; }
  function reset(e) {
    e.st = 'move'; e.stT = 0; e.pose = null; e.tele = null; e.faceLock = false; e.dashing = false; e.held = null; e.charge = null;
    e.shakeAmp = 0; e.squash = 0; if (!e.def.boss) e.z = 0; if (e.cd < 0.6) e.cd = 0.6;
  }
  function vis(e, m) { return G.render.onScreen(e.x, e.y, m == null ? -0.8 : m); }
  function faceTo(e, x, y) { const fx = x - e.x, fy = y - e.y; if (Math.abs(fx) + Math.abs(fy) > 0.01) { e.face.x = fx; e.face.y = fy; } }
  function hz(R, h) { return G.enemies.hazard(R, h); }
  function sfx(n, at) { G.enemyFx.sfx(n, at ? at.x : null, at ? at.y : null); }
  function notice(text, color) { G.bus.emit('notice', { text, color: color || '#ff5a7a' }); }
  function near(R, e, r) { const p = R.player; return U.dist(e.x, e.y, p.x, p.y) < r; }
  function shake(R, x, y, a, range) { const p = R.player, d = U.dist(x, y, p.x, p.y); if (d < range) G.fx.shake(a * (1 - d / range) + 0.05); }
  function countType(R, type) { let n = 0; for (const h of R.hazards) if (h.type === type) n++; return n; }

  const A = { reset };

  A.init = function (R, e) {
    const ai = e.def.ai;
    e.cd = ai === 'ruin' ? 3 : ai === 'venti' ? 2.2 : ai === 'brute' ? 1.6 : U.rand(0.8, 2.4);
    if (ai === 'ruin') { e.armorMul = 0.6; e.cycle = 0; }
    if (ai === 'venti') { e.phase = 1; e.z = 0.6; e.armorMul = 1; e.cycle = 0; e.orbitDir = 1; e.turnT = 4; }
  };

  /* ---------- 棍棒ヒルチャール: shambling walk + club lunge ---------- */
  A.melee = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; const p = R.player;
    if (e.st === 'move') {
      e.cd -= dt;
      if (e.cd <= 0 && dist < 2.7 && vis(e)) {
        set(e, 'wind', 0.55); e.faceLock = true; e.lx = nx; e.ly = ny; faceTo(e, p.x, p.y); e.pose = 'raise'; e.charge = { type: 'club', k: 0 };
        e.tele = { type: 'cone', x: e.x, y: e.y, ang: Math.atan2(ny, nx), len: 2.7, spread: 0.7, k: 0 };
        return vel(0, 0);
      }
      const sh = 0.72 + 0.42 * Math.max(0, Math.sin(e.anim.t * 5.5 + e.id));
      return vel(nx * e.sp * sh + Math.sin(e.anim.t * 2 + e.id) * 0.25, ny * e.sp * sh);
    }
    if (e.st === 'wind') {
      const k = e.stT / e.stDur; e.tele.k = k; e.tele.x = e.x; e.tele.y = e.y; e.shakeAmp = 0.03 + 0.04 * k; e.charge.k = k;
      if (k >= 1) {
        set(e, 'lunge', 0.18); e.pose = 'strike'; e.shakeAmp = 0; e.tele = null; e.dashing = true; e.charge = null;
        hz(R, { type: 'zone', x: e.x + e.lx * 1.55, y: e.y + e.ly * 1.55, r: 1.15, delay: 0, life: 0.15, dmg: e.dmg, style: 'none', src: e.kind });
        FX().slash(e.x + e.lx * 1.2, e.y + e.ly * 1.2 - 0.6, Math.atan2(e.ly, e.lx), 1.3);
      }
      return vel(0, 0);
    }
    if (e.st === 'lunge') { if (e.stT >= e.stDur) { set(e, 'recover', 0.35); e.dashing = false; } return vel(e.lx * 7, e.ly * 7); }
    if (e.st === 'recover') { if (e.stT >= e.stDur) { reset(e); e.cd = U.rand(2.4, 4); } return vel(0, 0); }
    reset(e); return null;
  };

  /* ---------- slimes: hop bursts (+ elemental slimes discharge) ---------- */
  A.hopper = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; e.cd -= dt; const p = R.player;
    const d = e.def;
    if (e.st === 'move') set(e, 'rest', U.rand(0.25, 0.5));
    if (e.st === 'rest') {
      e.z = 0; e.squash = 0.14 * Math.sin(Math.min(1, e.stT / e.stDur) * Math.PI);
      if (d.burst && e.cd <= 0 && dist < 5 && vis(e)) {
        set(e, 'charge', 0.85); e.shakeAmp = 0.04; e.charge = { type: 'spark', k: 0, color: d.burst.color };
        hz(R, { type: 'zone', x: e.x, y: e.y, r: d.burst.r, delay: 0.85, life: 0.3, dmg: e.dmg * 1.2, style: 'spark', color: d.burst.color, hue: d.burst.hue, follow: e, src: e.kind });
        return vel(0, 0);
      }
      if (d.crush && e.cd <= 0 && dist < 9 && dist > 1.5 && vis(e)) { // big slime: squat, then a huge leap that crushes the target circle
        set(e, 'crushWind', 0.55); e.pose = 'raise'; e.ax = p.x + (p.vx || 0) * 0.4; e.ay = p.y + (p.vy || 0) * 0.4; e.sx0 = e.x; e.sy0 = e.y;
        e.tele = { type: 'circle', x: e.ax, y: e.ay, r: d.crush.r, k: 0 }; return vel(0, 0);
      }
      if (e.stT >= e.stDur) { set(e, 'hop', d.hopT || 0.45); e.hx = nx; e.hy = ny; }
      return vel(nx * e.sp * 0.15, ny * e.sp * 0.15);
    }
    if (e.st === 'hop') {
      const k = Math.min(1, e.stT / e.stDur), s = Math.sin(k * Math.PI);
      e.z = s * (d.hopH || 0.55) * (e.scale || 1); e.squash = -0.1 * s;
      e.hx += (nx - e.hx) * Math.min(1, dt * 3); e.hy += (ny - e.hy) * Math.min(1, dt * 3);
      if (k >= 1) {
        e.z = 0; set(e, 'rest', U.rand(0.25, 0.55));
        if (e.r >= 0.6 && vis(e, 1)) { FX().ring(e.x, e.y, e.r * 2.4, 0.35, 0.15, '#c9a86a'); FX().dust(e.x - 0.4, e.y, 0.5); FX().dust(e.x + 0.4, e.y, 0.5); shake(R, e.x, e.y, 0.08, 5); }
      }
      const sp = e.sp * 1.9; return vel(e.hx * sp, e.hy * sp);
    }
    if (e.st === 'crushWind') {
      const k = e.stT / e.stDur; e.squash = 0.28 * U.ease.outCubic(k); e.shakeAmp = 0.03 + 0.04 * k; e.tele.k = k * 0.35;
      if (k >= 1) { set(e, 'crushAir', 0.8); e.pose = 'strike'; e.shakeAmp = 0; e.squash = 0; FX().dust(e.x - 0.5, e.y, 0.6); FX().dust(e.x + 0.5, e.y, 0.6); FX().ring(e.x, e.y, 1.8, 0.3, 0.15, '#c9a86a'); }
      return vel(0, 0);
    }
    if (e.st === 'crushAir') {
      const k = Math.min(1, e.stT / e.stDur), s = Math.sin(k * Math.PI);
      e.z = s * 3.2; e.squash = -0.18 * s; e.tele.k = 0.35 + 0.65 * k; e.dashing = false;
      e.x = U.lerp(e.sx0, e.ax, U.ease.inOutSine(k)); e.y = U.lerp(e.sy0, e.ay, U.ease.inOutSine(k));
      if (k >= 1) {
        e.z = 0; e.squash = 0.3; e.tele = null;
        hz(R, { type: 'zone', x: e.x, y: e.y, r: d.crush.r, delay: 0, life: 0.2, dmg: e.dmg * 1.4, style: 'slam', src: e.kind });
        set(e, 'crushLand', 0.5); e.pose = 'idle'; e.cd = U.rand(d.crush.cd[0], d.crush.cd[1]);
      }
      return vel(0, 0);
    }
    if (e.st === 'crushLand') { e.squash = 0.3 * (1 - e.stT / e.stDur); if (e.stT >= e.stDur) { reset(e); set(e, 'rest', 0.3); } return vel(0, 0); }
    if (e.st === 'charge') {
      const k = e.stT / e.stDur; e.squash = 0.2 * k; e.shakeAmp = 0.03 + 0.05 * k; if (e.charge) e.charge.k = k;
      if (k >= 1) { e.shakeAmp = 0; e.squash = 0; e.charge = null; set(e, 'rest', 0.5); e.cd = U.rand(d.burst.cd[0], d.burst.cd[1]); }
      return vel(0, 0);
    }
    reset(e); return null;
  };

  /* ---------- 弓ヒルチャール: keeps ~9 units, aims with a dark aim line, fires an aura arrow ---------- */
  A.archer = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; const p = R.player;
    if (e.st === 'move') {
      e.cd -= dt;
      if (e.cd <= 0 && dist < 14 && vis(e, -1.2)) {
        set(e, 'aim', 0.65); e.faceLock = true; e.pose = 'raise'; e.ax = p.x; e.ay = p.y; e.charge = { type: 'bow', k: 0 };
        e.tele = { type: 'aim', x: e.x, y: e.y, x2: p.x, y2: p.y, k: 0 };
        return vel(0, 0);
      }
      const f = dist > 10 ? 1 : dist < 7.5 ? -0.9 : 0.05, side = ((e.id & 1) ? 1 : -1) * 0.5;
      return vel((nx * f - ny * side) * e.sp, (ny * f + nx * side) * e.sp);
    }
    if (e.st === 'aim') {
      const k = e.stT / e.stDur; faceTo(e, p.x, p.y);
      if (k < 0.7) { e.ax = p.x; e.ay = p.y; }
      const a = Math.atan2(e.ay - e.y, e.ax - e.x), c = Math.cos(a), s = Math.sin(a);
      const T = e.tele; T.x = e.x + c * 0.5; T.y = e.y + s * 0.5; T.x2 = e.x + c * 15; T.y2 = e.y + s * 15; T.k = k; e.charge.k = k; e.charge.a = a;
      if (k >= 1) {
        hz(R, { type: 'arrow', x: e.x + c * 0.6, y: e.y + s * 0.6, vx: c * 11, vy: s * 11, r: 0.3, life: 1.8, dmg: e.dmg * 0.8, src: 'arrow', color: '#c070ff', lift: 1 });
        sfx('enemyArrow', e); set(e, 'recover', 0.35); e.pose = 'strike'; e.tele = null; e.charge = null;
        FX().ring(e.x + c * 0.8, e.y + s * 0.8, 0.8, 0.25, 0.1); FX().burst(e.x + c * 0.7, e.y + s * 0.7 - 1, 0.7);
      }
      return vel(0, 0);
    }
    if (e.st === 'recover') { if (e.stT >= e.stDur) { reset(e); e.cd = U.rand(3, 4.4); } return vel(0, 0); }
    reset(e); return null;
  };

  /* ---------- 突撃ヒルチャール: dark charge lane → fast dash with dust ---------- */
  A.charger = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; const p = R.player;
    if (e.st === 'move') {
      e.cd -= dt;
      if (e.cd <= 0 && dist < 8.5 && vis(e)) {
        set(e, 'prep', 0.75); e.faceLock = true; e.pose = 'raise'; e.lx = nx; e.ly = ny;
        e.tele = { type: 'lane', x: e.x, y: e.y, ang: Math.atan2(ny, nx), len: 9.5, w: 1.25, k: 0 };
        return vel(0, 0);
      }
      return vel(nx * e.sp, ny * e.sp);
    }
    if (e.st === 'prep') {
      const k = e.stT / e.stDur;
      if (k < 0.55) { e.lx = nx; e.ly = ny; faceTo(e, p.x, p.y); }
      e.tele.x = e.x; e.tele.y = e.y; e.tele.ang = Math.atan2(e.ly, e.lx); e.tele.k = k; e.shakeAmp = 0.03 + 0.05 * k;
      if (U.chance(dt * 10)) FX().dust(e.x - e.lx * 0.5, e.y - e.ly * 0.3, 0.35);
      if (k >= 1) { set(e, 'dash', 0.62); e.pose = 'strike'; e.tele = null; e.dashing = true; e.shakeAmp = 0; FX().ring(e.x, e.y, 1.4, 0.3, 0.15, '#c9a86a'); }
      return vel(0, 0);
    }
    if (e.st === 'dash') {
      if (U.chance(dt * 25)) FX().dust(e.x + U.rand(-0.3, 0.3), e.y + U.rand(-0.1, 0.2), 0.45);
      if (U.chance(dt * 18)) FX().after(e, 0.4);
      if (e.stT >= e.stDur) { set(e, 'recover', 0.6); e.dashing = false; e.pose = 'idle'; }
      return vel(e.lx * 12.5, e.ly * 12.5);
    }
    if (e.st === 'recover') { if (e.stT >= e.stDur) { reset(e); e.cd = U.rand(3.2, 4.8); } return vel(0, 0); }
    reset(e); return null;
  };

  /* ---------- シャーマン: keeps distance, hydro orb or shield bubbles on hilichurls ---------- */
  const SHIELDABLE = { mote: 1, charger: 1, spitter: 1, shielder: 1, elite: 1 };
  A.shaman = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; const p = R.player;
    if (e.st === 'move') {
      e.cd -= dt;
      if (e.cd <= 0 && dist < 13 && vis(e, -1)) {
        e.faceLock = true; faceTo(e, p.x, p.y); e.pose = 'raise';
        let targets = null;
        if (U.chance(0.5)) {
          targets = [];
          R.grid.query(e.x, e.y, 7, o => { if (o !== e && !o.dead && SHIELDABLE[o.kind] && !(o.bubble > 0) && o.spawnT <= 0) targets.push(o); return targets.length >= 4; });
          if (!targets.length) targets = null;
        }
        if (targets) { set(e, 'castShield', 0.9); e.targets = targets; e.charge = { type: 'shield', k: 0 }; }
        else { set(e, 'castOrb', 0.75); e.charge = { type: 'orb', k: 0, color: '#3fa9ff' }; }
        sfx('enemyCast', e);
        return vel(0, 0);
      }
      const f = dist > 9.5 ? 1 : dist < 6.5 ? -0.8 : 0, side = ((e.id & 1) ? 1 : -1) * 0.35;
      return vel((nx * f - ny * side) * e.sp, (ny * f + nx * side) * e.sp);
    }
    if (e.st === 'castOrb') {
      const k = e.stT / e.stDur; e.charge.k = k; faceTo(e, p.x, p.y);
      if (k >= 1) {
        const a = Math.atan2(p.y - e.y, p.x - e.x);
        hz(R, { type: 'orb', x: e.x + Math.cos(a) * 0.7, y: e.y + Math.sin(a) * 0.7, vx: Math.cos(a) * 5.2, vy: Math.sin(a) * 5.2, r: 0.42, life: 3.2, home: 0.9, homeT: 1.6, dmg: e.dmg * 1.3, src: 'hydroOrb', color: '#3fa9ff', lift: 1.1 });
        set(e, 'recover', 0.4); e.pose = 'strike'; e.charge = null;
      }
      return vel(0, 0);
    }
    if (e.st === 'castShield') {
      const k = e.stT / e.stDur; e.charge.k = k;
      if (k >= 1) {
        for (const o of e.targets) if (!o.dead) { o.bubble = o.maxHp * 0.5; o.bubbleUntil = R.time + 9; FX().ring(o.x, o.y - o.def.h * 0.45, 1.5, 0.4, 0.15, '#6fd0ff'); }
        FX().ring(e.x, e.y, 2.5, 0.5, 0.2, '#6fd0ff');
        set(e, 'recover', 0.45); e.pose = 'strike'; e.charge = null; e.targets = null;
      }
      return vel(0, 0);
    }
    if (e.st === 'recover') { if (e.stT >= e.stDur) { reset(e); e.cd = U.rand(3, 4.5); } return vel(0, 0); }
    reset(e); return null;
  };

  /* ---------- 盾ヒルチャール: rips a boulder out of the ground, heaves it in a real arc ---------- */
  A.rockthrower = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; const p = R.player;
    if (e.st === 'move') {
      e.cd -= dt;
      if (e.cd <= 0 && dist < 13 && vis(e, -1)) {
        set(e, 'lift', 1.0); e.faceLock = true; faceTo(e, p.x, p.y); e.pose = 'idle'; e.held = { k: 0, rip: 0, gx: nx * 0.75, gy: ny * 0.35 };
        FX().crater(e.x + nx * 0.75, e.y + ny * 0.35 + 0.1, 0.8, 2.2);
        return vel(0, 0);
      }
      const f = dist > 9 ? 1 : dist < 5 ? -0.7 : 0.25;
      return vel(nx * f * e.sp, ny * f * e.sp);
    }
    if (e.st === 'lift') {
      const k = e.stT / e.stDur, H0 = e.held; faceTo(e, p.x, p.y);
      // 0–0.3 s: crouch & rip the boulder out of the ground (it rises, trembling, spitting debris)
      // 0.3–0.55 s: heave it overhead (body stretches up)   then: hold & aim, trembling harder
      H0.rip = Math.min(1, e.stT / 0.3); H0.k = e.stT < 0.3 ? 0 : Math.min(1, (e.stT - 0.3) / 0.25);
      e.squash = e.stT < 0.3 ? 0.14 * Math.sin(H0.rip * Math.PI * 0.5) : 0.14 * (1 - H0.k) - 0.06 * H0.k;
      if (e.stT >= 0.3 && e.pose !== 'raise') { e.pose = 'raise'; FX().debris(e.x + H0.gx, e.y + H0.gy, 6, 3.5, 0.8); FX().dust(e.x + H0.gx, e.y + H0.gy, 0.7); shake(R, e.x, e.y, 0.1, 6); }
      if (e.stT < 0.3 && U.chance(dt * 16)) FX().dust(e.x + H0.gx + U.rand(-0.4, 0.4), e.y + H0.gy, 0.4);
      e.shakeAmp = e.stT < 0.3 ? 0.035 : 0.03 + 0.05 * k;
      if (e.stT >= 0.35) {
        if (!e.tele) { e.tele = { type: 'circle', x: 0, y: 0, r: 1.7, k: 0 }; }
        // target locks where the player is heading (short lead), shown immediately on the ground
        if (e.stT < 0.55) { e.ax = p.x + (p.vx || 0) * 0.3; e.ay = p.y + (p.vy || 0) * 0.3; }
        e.tele.x = e.ax; e.tele.y = e.ay; e.tele.k = (e.stT - 0.35) / (e.stDur - 0.35) * 0.3;
      }
      if (k >= 1) {
        const H = e.def.h * (e.scale || 1);
        hz(R, { type: 'rock', x: e.x, y: e.y, h0: H * 1.05 + 0.4, x1: e.ax, y1: e.ay, life: 0.95, peak: 3.4, r: 1.7, k0: 0.3, dmg: e.dmg * 1.5, size: 1.35, src: 'rock' });
        sfx('rockThrow', e);
        set(e, 'throw', 0.45); e.pose = 'strike'; e.held = null; e.tele = null; e.shakeAmp = 0; e.squash = 0;
        FX().dust(e.x, e.y, 0.6); FX().ring(e.x, e.y, 1.6, 0.3, 0.14, '#c9a86a');
      }
      return vel(0, 0);
    }
    if (e.st === 'throw') { e.squash = 0.1 * Math.max(0, 1 - e.stT / 0.2); if (e.stT >= e.stDur) { reset(e); e.cd = U.rand(3.2, 4.6); } return vel(0, 0); }
    reset(e); return null;
  };

  /* ---------- ヒルチャール暴徒 (mini-boss): ground slam, charge, enrage ---------- */
  A.brute = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; const p = R.player;
    if (!e.enraged && e.hp < e.maxHp * 0.4) {
      e.enraged = true; notice('ヒルチャール暴徒が怒った！'); FX().burst(e.x, e.y - 1.5, 2.5, 2); G.fx.shake(0.3); sfx('bossRoar', e);
    }
    const fast = e.enraged ? 0.8 : 1;
    if (e.st === 'move') {
      e.cd -= dt;
      if (e.cd <= 0 && vis(e, 0)) {
        if (dist < 5.5) {
          set(e, 'slamWind', 0.95 * fast); e.faceLock = true; faceTo(e, p.x, p.y); e.pose = 'raise';
          e.tele = { type: 'circle', x: e.x, y: e.y, r: 3.3, k: 0 }; return vel(0, 0);
        }
        if (dist < 12) {
          set(e, 'prep', 0.8 * fast); e.faceLock = true; e.pose = 'raise'; e.lx = nx; e.ly = ny;
          e.tele = { type: 'lane', x: e.x, y: e.y, ang: Math.atan2(ny, nx), len: 11, w: 1.8, k: 0 }; return vel(0, 0);
        }
      }
      return vel(nx * e.sp, ny * e.sp);
    }
    if (e.st === 'slamWind') {
      const k = e.stT / e.stDur; e.tele.k = k; e.tele.x = e.x; e.tele.y = e.y; e.shakeAmp = 0.03 + 0.07 * k;
      if (k >= 1) {
        hz(R, { type: 'zone', x: e.x, y: e.y, r: 3.3, delay: 0, life: 0.3, dmg: e.dmg * 1.3, style: 'slam', src: 'slam' });
        if (e.enraged) {
          for (let i = 0; i < 4; i++) {
            const a = U.rand(0, U.TAU), rr = U.rand(1.5, 4.5);
            hz(R, { type: 'rock', x: e.x, y: e.y, h0: 1, x1: p.x + Math.cos(a) * rr, y1: p.y + Math.sin(a) * rr, delay: i * 0.08, life: 0.9, peak: 3, r: 1.3, dmg: e.dmg * 0.8, size: 0.75, src: 'rock' });
          }
        }
        set(e, 'recover', 0.8); e.pose = 'strike'; e.tele = null; e.shakeAmp = 0;
      }
      return vel(0, 0);
    }
    if (e.st === 'prep') {
      const k = e.stT / e.stDur;
      if (k < 0.55) { e.lx = nx; e.ly = ny; faceTo(e, p.x, p.y); }
      e.tele.x = e.x; e.tele.y = e.y; e.tele.ang = Math.atan2(e.ly, e.lx); e.tele.k = k; e.shakeAmp = 0.03 + 0.06 * k;
      if (U.chance(dt * 12)) FX().dust(e.x - e.lx * 0.6, e.y, 0.5);
      if (k >= 1) { set(e, 'dash', 0.7); e.pose = 'strike'; e.tele = null; e.dashing = true; e.shakeAmp = 0; sfx('bossRoar', e); }
      return vel(0, 0);
    }
    if (e.st === 'dash') {
      if (U.chance(dt * 30)) FX().dust(e.x + U.rand(-0.5, 0.5), e.y + U.rand(-0.1, 0.2), 0.6);
      if (U.chance(dt * 20)) FX().after(e, 0.45, e.enraged ? '#ff2d6f' : '#8a3cff');
      if (e.stT >= e.stDur) { set(e, 'recover', 0.7); e.dashing = false; e.pose = 'idle'; }
      return vel(e.lx * 13, e.ly * 13);
    }
    if (e.st === 'recover') { if (e.stT >= e.stDur) { reset(e); e.cd = e.enraged ? U.rand(1.2, 2) : U.rand(2, 3); } return vel(0, 0); }
    reset(e); return null;
  };

  /* ---------- 遺跡守衛 (5:00 boss): missile barrage / spinning sweep / charging stomp, weak-spot core ---------- */
  const RUIN_SEQ = ['missiles', 'beam', 'stomp', 'spin', 'missiles', 'beam', 'spin', 'stomp'];
  A.ruin = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; const p = R.player;
    if (!e.enraged && e.hp < e.maxHp * 0.35) { e.enraged = true; notice('遺跡守衛 暴走！', '#ff8a3d'); sfx('bossRoar', e); G.fx.shake(0.5); }
    const fast = e.enraged ? 0.8 : 1;
    if (e.st === 'move') {
      e.armorMul = 0.6; e.core = false;
      e.cd -= dt;
      e.stepT = (e.stepT || 0) + dt;
      if (e.stepT > 0.55) { e.stepT = 0; if (vis(e, 2)) { FX().dust(e.x + U.rand(-0.8, 0.8), e.y, 0.6); shake(R, e.x, e.y, 0.06, 10); } }
      if (dist > 15) return vel(nx * 3.6, ny * 3.6); // catch up, no attacks
      if (e.cd <= 0 && vis(e, 1)) {
        const atk = RUIN_SEQ[e.cycle++ % RUIN_SEQ.length];
        e.faceLock = true; faceTo(e, p.x, p.y); e.pose = 'raise';
        if (atk === 'missiles') { set(e, 'mPrep', 1.0); e.charge = { type: 'launch', k: 0 }; sfx('enemyCast', e); }
        else if (atk === 'beam') { set(e, 'bPrep', 1.1 * fast); e.charge = { type: 'eye', k: 0 }; e.lockA = Math.atan2(ny, nx); e.tele = { type: 'lane', x: e.x, y: e.y, ang: e.lockA, len: 16, w: 1.5, k: 0 }; sfx('beamCharge', e); }
        else if (atk === 'spin') { set(e, 'sPrep', 0.95 * fast); e.tele = { type: 'circle', x: e.x, y: e.y, r: 4.2, k: 0, hue: '#8a2f1a' }; }
        else { set(e, 'cPrep', 0.85 * fast); e.lx = nx; e.ly = ny; e.tele = { type: 'lane', x: e.x, y: e.y, ang: Math.atan2(ny, nx), len: 12, w: 2.6, k: 0 }; }
        return vel(0, 0);
      }
      return vel(nx * e.sp, ny * e.sp);
    }
    // --- missile barrage ---
    if (e.st === 'mPrep') {
      const k = e.stT / e.stDur; e.charge.k = k; e.shakeAmp = 0.04 + 0.06 * k;
      if (k >= 1) {
        const n = e.enraged ? 16 : 12, H = e.def.h;
        for (let i = 0; i < n; i++) {
          let tx, ty;
          if (i === 0) { tx = p.x + (p.vx || 0) * 0.8; ty = p.y + (p.vy || 0) * 0.8; }
          else { const a = U.rand(0, U.TAU), rr = U.rand(1.2, 6.5); tx = p.x + Math.cos(a) * rr; ty = p.y + Math.sin(a) * rr; }
          hz(R, { type: 'zone', x: tx, y: ty, r: 1.45, delay: 1.25 + i * 0.1, life: 0.4, dmg: e.dmg * 0.75, style: 'missile', src: 'missile' });
          FX().streak(e.x + (i & 1 ? 1 : -1) * H * 0.18, e.y - H * 0.6 - i * 0.05, '#ff9a3d');
        }
        sfx('explosion', e); G.fx.shake(0.2);
        set(e, 'mFire', 0.6); e.pose = 'strike'; e.charge = null; e.shakeAmp = 0;
      }
      return vel(0, 0);
    }
    if (e.st === 'mFire') {
      if (e.stT >= e.stDur) {
        set(e, 'overheat', 3.2); e.pose = 'idle'; e.core = true; e.armorMul = 2.2;
        if (!R.spawn || !R.spawn.coreHint) { if (R.spawn) R.spawn.coreHint = true; notice('光るコアを狙え！ 大ダメージ！', '#ffb347'); }
      }
      return vel(0, 0);
    }
    if (e.st === 'overheat') {
      e.core = true; e.armorMul = 2.2;
      if (U.chance(dt * 8)) FX().smoke(e.x + U.rand(-0.8, 0.8), e.y - e.def.h * U.rand(0.6, 0.95), 0.5);
      if (e.stT >= e.stDur) { reset(e); e.core = false; e.cd = 1.4 * fast; }
      return vel(0, 0);
    }
    // --- eye beam: the eye charges (aim line tracks, then locks) → a scorching beam that slowly sweeps after the player ---
    if (e.st === 'bPrep') {
      const k = e.stT / e.stDur; e.charge.k = k; e.shakeAmp = 0.02 + 0.04 * k;
      const want = Math.atan2(p.y - e.y, p.x - e.x);
      if (k < 0.65) e.lockA += U.clamp(U.angDiff(e.lockA, want), -3 * dt, 3 * dt);
      faceTo(e, e.x + Math.cos(e.lockA), e.y + Math.sin(e.lockA));
      e.tele.x = e.x; e.tele.y = e.y; e.tele.ang = e.lockA; e.tele.k = k;
      if (k >= 1) {
        e.tele = null; e.shakeAmp = 0; e.pose = 'strike'; set(e, 'beam', e.enraged ? 2.4 : 1.8); e.charge.k = 1;
        e.beamHz = hz(R, { type: 'beam', x: e.x, y: e.y, ang: e.lockA, len: 16, w: 1.2, life: e.stDur, tick: 0.3, dmg: e.dmg * 0.5, follow: e, src: 'beam' });
        sfx('beam', e); G.fx.shake(0.25); FX().burst(e.x, e.y - e.def.h * 0.64, 1.6, 1);
      }
      return vel(0, 0);
    }
    if (e.st === 'beam') {
      const want = Math.atan2(p.y - e.y, p.x - e.x), sw = e.enraged ? 0.75 : 0.5;
      e.lockA += U.clamp(U.angDiff(e.lockA, want), -sw * dt, sw * dt);
      if (e.beamHz) e.beamHz.ang = e.lockA;
      faceTo(e, e.x + Math.cos(e.lockA), e.y + Math.sin(e.lockA));
      if (U.chance(dt * 10)) shake(R, e.x, e.y, 0.08, 12);
      if (e.stT >= e.stDur) { if (e.beamHz) e.beamHz.done = true; e.beamHz = null; e.charge = null; set(e, 'overheat', 2.2); e.pose = 'idle'; e.core = true; e.armorMul = 2.2; }
      return vel(0, 0);
    }
    // --- spinning sweep ---
    if (e.st === 'sPrep') {
      const k = e.stT / e.stDur; e.tele.k = k; e.tele.x = e.x; e.tele.y = e.y; e.shakeAmp = 0.04 + 0.06 * k;
      if (k >= 1) {
        e.tele = null; e.shakeAmp = 0; set(e, 'spin', 2.6);
        hz(R, { type: 'zone', x: e.x, y: e.y, r: 4.0, delay: 0, life: 2.6, persist: true, tick: 0.45, dmg: e.dmg * 0.55, style: 'spin', follow: e, src: 'spin' });
        sfx('windBlast', e);
      }
      return vel(0, 0);
    }
    if (e.st === 'spin') {
      const a = e.stT * 16; e.face.x = Math.cos(a); e.face.y = Math.sin(a); e.pose = 'strike';
      if (U.chance(dt * 20)) FX().dust(e.x + U.rand(-3, 3), e.y + U.rand(-1.5, 1.5), 0.6);
      if (e.stT >= e.stDur) { set(e, 'dizzy', 1.3); e.pose = 'idle'; e.armorMul = 1.4; }
      return vel(nx * 1.7, ny * 1.7);
    }
    if (e.st === 'dizzy') { e.armorMul = 1.4; if (e.stT >= e.stDur) { reset(e); e.cd = 1.2 * fast; } return vel(0, 0); }
    // --- charging stomp ---
    if (e.st === 'cPrep') {
      const k = e.stT / e.stDur;
      if (k < 0.5) { e.lx = nx; e.ly = ny; faceTo(e, p.x, p.y); }
      e.tele.x = e.x; e.tele.y = e.y; e.tele.ang = Math.atan2(e.ly, e.lx); e.tele.k = k; e.shakeAmp = 0.04 + 0.06 * k;
      if (k >= 1) { set(e, 'charge', 0.75); e.pose = 'strike'; e.tele = null; e.dashing = true; e.shakeAmp = 0; sfx('bossRoar', e); }
      return vel(0, 0);
    }
    if (e.st === 'charge') {
      if (U.chance(dt * 30)) FX().dust(e.x + U.rand(-1, 1), e.y + U.rand(-0.2, 0.3), 0.8);
      if (U.chance(dt * 14)) FX().after(e, 0.35, '#ff7a3d');
      if (U.chance(dt * 10)) shake(R, e.x, e.y, 0.1, 9);
      if (e.stT >= e.stDur) {
        e.dashing = false; set(e, 'stompWind', 0.7 * fast); e.pose = 'raise'; faceTo(e, p.x, p.y);
        e.tele = { type: 'circle', x: e.x, y: e.y, r: 3.8, k: 0, hue: '#8a2f1a' };
      }
      return vel(e.lx * 14, e.ly * 14);
    }
    if (e.st === 'stompWind') {
      const k = e.stT / e.stDur; e.tele.k = k; e.shakeAmp = 0.05 + 0.08 * k;
      if (k >= 1) {
        hz(R, { type: 'zone', x: e.x, y: e.y, r: 3.8, delay: 0, life: 0.3, dmg: e.dmg * 1.2, style: 'slam', src: 'stomp' });
        if (e.enraged) hz(R, { type: 'wave', x: e.x, y: e.y, r0: 3.8, r1: 10, w: 0.45, life: 0.9, dmg: e.dmg * 0.5, color: '#ff7a3d', src: 'stomp' });
        set(e, 'recover', 0.8); e.pose = 'strike'; e.tele = null; e.shakeAmp = 0; e.armorMul = 1.2;
      }
      return vel(0, 0);
    }
    if (e.st === 'recover') { if (e.stT >= e.stDur) { reset(e); e.cd = 1.3 * fast; } return vel(0, 0); }
    reset(e); return null;
  };

  /* ---------- ウェンティ (10:00 final boss) ---------- */
  const VSEQ = {
    1: ['fan', 'storm', 'tornado', 'dash', 'fan', 'storm', 'dash'],
    2: ['fan', 'wall', 'inhale', 'spiral', 'tornado', 'dash', 'storm', 'fan', 'spiral'],
    3: ['barrage', 'inhale', 'wall', 'fan', 'tornado', 'dash', 'spiral', 'storm', 'wall'],
  };
  function ventiPhase(R, e, ph) {
    e.phase = ph; reset(e); set(e, 'phase', 2.0); e.armorMul = 0.05; e.pose = 'strike';
    hz(R, { type: 'push', x: e.x, y: e.y, r: 9, force: 10, life: 0.8, dmg: 0 });
    FX().ring(e.x, e.y, 9, 0.8, 0.5, '#5cf2c8'); FX().ring(e.x, e.y, 6, 0.6, 0.35); FX().burst(e.x, e.y - 1.2, 3.5, 1);
    G.fx.flash && G.fx.flash('#d8fff4', 0.35); G.fx.shake(0.6); sfx('windBlast', e); sfx('tornado', e);
    notice(ph === 2 ? '風が荒れ狂う…！' : '最後の嵐がくる！', '#7dffd8');
    G.bus.emit('stageEvent', { kind: 'bossPhase', phase: ph, boss: e });
  }
  function windShot(R, e, a, speed, dmgMul, delay, r) {
    hz(R, { type: 'wind', x: e.x + Math.cos(a) * 0.6, y: e.y + Math.sin(a) * 0.6, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: r || 0.32, delay: delay || 0, life: 4.5, dmg: e.dmg * dmgMul, src: 'windArrow', color: '#5cf2c8', lift: 1.1 });
  }
  function stormAt(R, e, x, y, delay, r) { hz(R, { type: 'zone', x, y, r: r || 1.6, delay, life: 0.45, dmg: e.dmg * 0.85, style: 'storm', src: 'storm' }); }

  A.venti = function (R, e, dt, nx, ny, dist) {
    e.stT += dt; const p = R.player;
    e.z = (e.st === 'phase' ? 1.4 : 0.55) + 0.15 * Math.sin(R.time * 2.2);
    if (e.enraged && !e.enrApplied) { e.enrApplied = true; e.dmg *= 1.4; notice('ウェンティが本気になった！', '#7dffd8'); sfx('bossRoar', e); }
    if (e.st !== 'phase') {
      if (e.phase === 1 && e.hp < e.maxHp * 0.6) { ventiPhase(R, e, 2); return vel(0, 0); }
      if (e.phase === 2 && e.hp < e.maxHp * 0.25) { ventiPhase(R, e, 3); return vel(0, 0); }
    }
    const ph = e.phase, cdm = (ph === 1 ? 1.35 : ph === 2 ? 1.05 : 0.8) * (e.enraged ? 0.65 : 1);
    if (U.chance(dt * 6)) G.fx.particle && G.fx.particle({ x: e.x + U.rand(-0.8, 0.8), y: e.y - U.rand(0.3, 2.2), vx: U.rand(-1, 1), vy: U.rand(-1.5, -0.3), life: 0.7, size: 0.08, color: '#9fffe4', glow: true });
    switch (e.st) {
      case 'phase': {
        if (e.stT >= e.stDur) { reset(e); e.armorMul = 1; e.cd = 0.6; }
        return vel(0, 0);
      }
      case 'move': {
        e.armorMul = 1;
        e.cd -= dt; e.turnT -= dt; if (e.turnT <= 0) { e.turnT = U.rand(3, 5); e.orbitDir *= -1; }
        if (dist > 14) { // feather teleport near the player
          FX().after(e, 0.7, '#5cf2c8'); FX().ring(e.x, e.y, 2, 0.4, 0.2, '#5cf2c8');
          const a = U.rand(0, U.TAU); e.x = p.x + Math.cos(a) * 7; e.y = p.y + Math.sin(a) * 7;
          FX().ring(e.x, e.y, 2.5, 0.45, 0.25, '#5cf2c8'); sfx('windBlast', e); set(e, 'appear', 0.6); return vel(0, 0);
        }
        if (e.cd <= 0 && vis(e, -0.5)) {
          const seq = VSEQ[ph]; let atk = seq[e.cycle++ % seq.length];
          if (atk === 'tornado' && countType(R, 'tornado') >= (ph === 3 ? 2 : 1)) atk = 'storm';
          e.atk = atk; e.faceLock = true; faceTo(e, p.x, p.y); e.pose = 'raise';
          if (atk === 'fan') { set(e, 'fanWind', 0.75); e.vol = 0; e.nvol = ph === 1 ? 2 : 3; e.fanN = ph === 1 ? 5 : ph === 2 ? 7 : 9; e.fanS = ph === 3 ? 1.5 : 1.1; e.lockA = Math.atan2(ny, nx); e.tele = { type: 'fan', x: e.x, y: e.y, ang: e.lockA, spread: e.fanS, n: e.fanN, len: 10, k: 0 }; }
          else if (atk === 'storm') set(e, 'stormWind', 0.45);
          else if (atk === 'tornado') set(e, 'tornWind', 0.6);
          else if (atk === 'dash') {
            set(e, 'dashWind', 0.7);
            const d = U.norm(p.x - e.x, p.y - e.y), L = Math.min(14, dist + 4.5);
            e.lx = d.x; e.ly = d.y; e.dashLeft = L;
            e.tele = { type: 'lane', x: e.x, y: e.y, ang: Math.atan2(d.y, d.x), len: L, w: 1.5, k: 0 };
          }
          else if (atk === 'wall') set(e, 'wallWind', 0.35);
          else if (atk === 'inhale') { set(e, 'inhaleWind', 0.7); e.charge = { type: 'inhale', k: 0 }; sfx('enemyCast', e); }
          else { set(e, 'spiralWind', 0.8); e.charge = { type: 'wind', k: 0 }; e.spinDir = (e.cycle & 1) ? 1 : -1; e.barrage = atk === 'barrage'; }
          return vel(0, 0);
        }
        const want = ph === 3 ? 6 : 7, f = U.clamp((dist - want) * 0.6, -1, 1), tng = 0.75 * e.orbitDir;
        const s = e.sp * 1.35;
        return vel((nx * f - ny * tng) * s, (ny * f + nx * tng) * s);
      }
      case 'appear': { if (e.stT >= e.stDur) { reset(e); e.cd = Math.max(e.cd, 0.4); } return vel(0, 0); }
      /* wind-arrow fans */
      case 'fanWind': {
        const k = e.stT / e.stDur; faceTo(e, p.x, p.y);
        if (k < 0.7 && e.vol === 0) e.lockA = Math.atan2(ny, nx);
        e.tele.x = e.x; e.tele.y = e.y; e.tele.ang = e.lockA + (e.vol & 1 ? e.fanS / (e.fanN - 1) / 2 : 0); e.tele.k = k;
        if (k >= 1) {
          const n = e.fanN, off = e.tele.ang;
          for (let i = 0; i < n; i++) windShot(R, e, off + (i / (n - 1) - 0.5) * e.fanS, 9, 0.55);
          sfx('windBlast', e); FX().ring(e.x, e.y, 1.6, 0.3, 0.15, '#5cf2c8');
          e.vol++; e.pose = 'strike';
          if (e.vol < e.nvol) { set(e, 'fanWind', 0.35); e.pose = 'raise'; } // follow-up volleys keep the same (already telegraphed) aim, offset half a step
          else { reset(e); e.cd = 1.2 * cdm; }
        }
        return vel(0, 0);
      }
      /* storm circles */
      case 'stormWind': {
        if (e.stT >= e.stDur) {
          const n = ph === 1 ? 5 : ph === 2 ? 7 : 9, r = ph === 3 ? 1.8 : 1.6;
          stormAt(R, e, p.x + (p.vx || 0) * 0.5, p.y + (p.vy || 0) * 0.5, 1.0, r);
          for (let i = 1; i < n; i++) { const a = U.rand(0, U.TAU), rr = U.rand(1.8, 5); stormAt(R, e, p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, 1.0 + i * 0.12, r); }
          sfx('enemyCast', e); e.pose = 'strike'; reset(e); e.cd = 0.9 * cdm;
        }
        return vel(0, 0);
      }
      /* tornado that pulls */
      case 'tornWind': {
        if (e.stT >= e.stDur) {
          const a = U.rand(0, U.TAU);
          hz(R, { type: 'tornado', x: p.x + Math.cos(a) * 4, y: p.y + Math.sin(a) * 4, r: 0.9, delay: 0.9, life: ph === 3 ? 6.5 : 5.5, pull: ph === 3 ? 2.9 : 2.3, pullR: 6, speed: ph === 3 ? 1.8 : 1.4, dmg: e.dmg * 0.35, tick: 0.5, src: 'tornado' });
          sfx('tornado', e); reset(e); e.cd = 1.0 * cdm;
        }
        return vel(0, 0);
      }
      /* feather dash with afterimages */
      case 'dashWind': {
        const k = e.stT / e.stDur; e.tele.k = k; e.tele.x = e.x; e.tele.y = e.y;
        if (U.chance(dt * 10)) FX().after(e, 0.3, '#5cf2c8');
        if (k >= 1) {
          e.tele = null; set(e, 'dashGo', 0.8); e.pose = 'strike'; e.dashing = true;
          e.dashHz = hz(R, { type: 'dash', x: e.x, y: e.y, r: 0.9, life: 0.8, dmg: e.dmg * 0.9, follow: e, src: 'featherDash' });
          sfx('windBlast', e);
        }
        return vel(0, 0);
      }
      case 'dashGo': {
        const s = 22; e.dashLeft -= s * dt;
        if (U.chance(dt * 40)) FX().after(e, 0.55, '#5cf2c8');
        if (e.dashLeft <= 0 || e.stT >= e.stDur) {
          e.dashing = false; if (e.dashHz) e.dashHz.done = true;
          if (ph >= 2) { const n = ph === 3 ? 14 : 10, o = U.rand(0, 1); for (let i = 0; i < n; i++) windShot(R, e, (i + o) / n * U.TAU, 3.6, 0.45, 0.45, 0.3); }
          FX().ring(e.x, e.y, 2.2, 0.35, 0.2, '#5cf2c8');
          reset(e); e.cd = 0.8 * cdm; return vel(0, 0);
        }
        return vel(e.lx * s, e.ly * s);
      }
      /* 吸い込み: the god draws everything in, then blasts it away (danger circle around Venti) */
      case 'inhaleWind': {
        const k = e.stT / e.stDur; e.charge.k = k;
        if (k >= 1) {
          const T = ph === 3 ? 2.6 : 2.2;
          set(e, 'inhale', T); e.pose = 'strike';
          e.inhHz = hz(R, { type: 'push', x: e.x, y: e.y, r: 12, force: ph === 3 ? -3.6 : -3.0, life: T, dmg: 0, follow: e, inhale: true });
          hz(R, { type: 'zone', x: e.x, y: e.y, r: 2.8, delay: T, life: 0.3, dmg: e.dmg * 1.1, style: 'storm', follow: e, src: 'inhale' });
          sfx('inhale', e); notice('吸いこまれる！ はなれて！', '#7dffd8');
        }
        return vel(0, 0);
      }
      case 'inhale': {
        e.charge.k = 1;
        if (e.stT >= e.stDur) {
          e.charge = null; e.inhHz = null;
          hz(R, { type: 'wave', x: e.x, y: e.y, r0: 2.8, r1: 11, w: 0.5, life: 0.9, dmg: e.dmg * 0.45, color: '#5cf2c8', src: 'inhale' });
          const n = ph === 3 ? 16 : 12, o = U.rand(0, 1); for (let i = 0; i < n; i++) windShot(R, e, (i + o) / n * U.TAU, 5, 0.45, 0.05, 0.3);
          FX().ring(e.x, e.y, 6, 0.5, 0.4, '#5cf2c8'); G.fx.shake(0.4); sfx('windBlast', e);
          reset(e); e.cd = 1.2 * cdm;
        }
        return vel(0, 0);
      }
      /* closing wind wall with gaps */
      case 'wallWind': {
        if (e.stT >= e.stDur) {
          const cx = p.x, cy = p.y, R0 = 9, gapW = 0.62, g1 = U.rand(0, U.TAU), gaps = [g1, g1 + Math.PI + U.rand(-0.8, 0.8)];
          const segs = [], N = 48;
          const inGap = a => gaps.some(g => Math.abs(U.angDiff(a, g)) < gapW / 2);
          let start = null;
          for (let i = 0; i <= N; i++) { const a = i / N * U.TAU, gap = inGap(a); if (!gap && start === null) start = a; if ((gap || i === N) && start !== null) { segs.push([start, a]); start = null; } }
          const boss = e;
          hz(R, { type: 'ringTele', x: cx, y: cy, r: R0, life: 1.0, gaps, gapW, segs, dmg: 0,
            onEnd(R2) {
              if (boss.dead) return;
              for (let i = 0; i < N; i++) {
                const a = i / N * U.TAU; if (inGap(a)) continue;
                const sp = 3.3;
                hz(R2, { type: 'wind', x: cx + Math.cos(a) * R0, y: cy + Math.sin(a) * R0, vx: -Math.cos(a) * sp, vy: -Math.sin(a) * sp, r: 0.34, life: (R0 - 0.6) / sp, dmg: boss.dmg * 0.6, src: 'windWall', color: '#5cf2c8', lift: 0.9 });
              }
              sfx('windBlast', e);
            } });
          sfx('enemyCast', e); e.pose = 'strike'; reset(e); e.cd = 1.6 * cdm;
        }
        return vel(0, 0);
      }
      /* rotating bullet spiral (phase 3: barrage = spiral + storms) */
      case 'spiralWind': {
        const k = e.stT / e.stDur; e.charge.k = k;
        if (k >= 1) { set(e, 'spiral', ph === 3 ? 3.4 : 2.8); e.pose = 'strike'; e.emitT = 0; e.baseA = Math.atan2(ny, nx); e.stormT = 0; sfx('tornado', e); }
        return vel(0, 0);
      }
      case 'spiral': {
        e.charge.k = 1;
        const arms = ph === 3 ? 4 : 3;
        e.baseA += e.spinDir * 1.25 * dt; e.emitT -= dt;
        if (e.emitT <= 0) { e.emitT = 0.14; for (let i = 0; i < arms; i++) windShot(R, e, e.baseA + i / arms * U.TAU, 4.3, 0.45, 0.1, 0.3); }
        if (e.barrage) {
          e.stormT -= dt;
          if (e.stormT <= 0) { e.stormT = 1.2; stormAt(R, e, p.x, p.y, 1.0, 1.6); for (let i = 0; i < 2; i++) { const a = U.rand(0, U.TAU); stormAt(R, e, p.x + Math.cos(a) * 3, p.y + Math.sin(a) * 3, 1.1, 1.6); } sfx('enemyCast', e); }
        }
        if (e.stT >= e.stDur) { reset(e); e.cd = 1.2 * cdm; }
        return vel(0, 0);
      }
    }
    reset(e); return null;
  };

  /* ---------- per-enemy extras drawn on top of the sprite ---------- */
  A.drawExtra = function (ctx, e, x, y, H, t) {
    const F = G.enemyFx;
    if (e.held) { // boulder ripped out of the ground in front of the feet, then heaved overhead
      const hd = e.held, s = 1.55 * (e.scale || 1), tr = Math.sin(t * 60) * (e.shakeAmp || 0) * 0.8;
      const gx = e.x + hd.gx, gy = e.y + hd.gy, top = y - H * 1.17;
      let bx, by, sc = 1;
      if (hd.k <= 0) { // rising out of the earth: only the part above ground shows
        const r = U.ease.outCubic(hd.rip); bx = gx + tr; by = gy + s * 0.5 - r * s * 0.75; sc = 0.75 + 0.25 * r;
      } else { const k = U.ease.outBack(hd.k); bx = U.lerp(gx, x, Math.min(1, hd.k * 1.3)) + tr; by = U.lerp(gy - s * 0.25, top, k); }
      F.darkAura(ctx, bx, by, s * 0.85 * sc, t + e.id, 0.55 + 0.45 * hd.rip);
      const ss = s * sc, vis = hd.k <= 0 ? Math.max(0.05, Math.min(ss, gy + 0.05 - (by - ss / 2))) : ss, B = F.boulder();
      ctx.drawImage(B, 0, 0, B.width, B.height * vis / ss, bx - ss / 2, by - ss / 2, ss, vis);
      if (hd.k > 0 && hd.k < 1) F.auraLite(ctx, bx, by + ss * 0.4, ss * 0.5, t, 1 - hd.k); // dirt still falling off
    }
    const c = e.charge;
    if (c) {
      const fl = Math.hypot(e.face.x, e.face.y) || 1, fx = e.face.x / fl;
      if (c.type === 'club') { // club raised overhead, soaked in dark energy
        const cx = x - fx * 0.25 + (fx >= 0 ? 0.35 : -0.35) * 0.3, cy = y - H * 1.02, r = 0.35 + 0.35 * c.k;
        F.darkAura(ctx, cx, cy, r, t * 1.5 + e.id, 0.5 + 0.5 * c.k);
        if (c.k > 0.7) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = (c.k - 0.7) / 0.3; ctx.drawImage(G.assets.glow('#ff5ad8', 32), cx - 0.4, cy - 0.4, 0.8, 0.8); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
      } else if (c.type === 'bow') { // dark arrow nocked and drawn: grows brighter as the shot nears
        const a = c.a != null ? c.a : Math.atan2(e.face.y, e.face.x), ca = Math.cos(a), sa = Math.sin(a);
        const bx = x + ca * 0.45, by = y - H * 0.5 + sa * 0.3, pull = 0.15 + 0.35 * c.k;
        F.auraLite(ctx, bx, by, 0.35 + 0.35 * c.k, t * 2 + e.id, 0.5 + 0.5 * c.k);
        ctx.save(); ctx.translate(bx, by); ctx.rotate(a);
        ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 0.07; ctx.beginPath(); ctx.moveTo(-pull - 0.2, 0); ctx.lineTo(0.5, 0); ctx.stroke();
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.4 + 0.6 * c.k; ctx.fillStyle = '#e8c6ff';
        ctx.beginPath(); ctx.moveTo(0.72, 0); ctx.lineTo(0.45, -0.12); ctx.lineTo(0.45, 0.12); ctx.closePath(); ctx.fill();
        ctx.drawImage(G.assets.glow('#b04dff', 32), 0.3, -0.35, 0.7, 0.7);
        ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      } else if (c.type === 'spark') { // elemental slime swelling with its discharge, wrapped in dark aura
        const r = H * (0.35 + 0.25 * c.k), cy = y - H * 0.4;
        F.auraLite(ctx, x, cy, r * 1.2, t * 2 + e.id, 0.4 + 0.5 * c.k);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + 0.5 * c.k * (0.6 + 0.4 * Math.sin(t * 30));
        ctx.drawImage(G.assets.glow(c.color || '#d59bff', 64), x - r * 1.4, cy - r * 1.4, r * 2.8, r * 2.8); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      } else if (c.type === 'eye') { // ruin guard eye charging a beam
        const cx = x + fx * H * 0.08, cy = y - H * 0.64, r = 0.3 + 0.9 * c.k;
        F.darkAura(ctx, cx, cy, r * 1.2, t * 2, 0.5 + 0.5 * c.k);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 40);
        ctx.drawImage(G.assets.glow('#ff8a3d', 64), cx - r * 1.5, cy - r * 1.5, r * 3, r * 3);
        ctx.fillStyle = '#fff2c8'; ctx.beginPath(); ctx.arc(cx, cy, 0.12 + 0.15 * c.k, 0, U.TAU); ctx.fill();
        if (c.k < 1) { ctx.strokeStyle = '#ffb36a'; ctx.lineWidth = 0.05; ctx.globalAlpha = c.k; for (let i = 0; i < 6; i++) { const a = i / 6 * U.TAU + t * 3, d = 1.6 * (1 - c.k) + 0.3; ctx.beginPath(); ctx.moveTo(cx + Math.cos(a) * d, cy + Math.sin(a) * d); ctx.lineTo(cx + Math.cos(a) * (d + 0.4), cy + Math.sin(a) * (d + 0.4)); ctx.stroke(); } }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      } else if (c.type === 'orb') {
        const ox = x + e.face.x / (Math.hypot(e.face.x, e.face.y) || 1) * 0.5, oy = y - H * 0.75, r = 0.15 + 0.3 * c.k;
        F.darkAura(ctx, ox, oy, r * 1.6, t + e.id, 0.4 + 0.6 * c.k);
        ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(G.assets.glow(c.color, 64), ox - r * 1.8, oy - r * 1.8, r * 3.6, r * 3.6); ctx.globalCompositeOperation = 'source-over';
      } else if (c.type === 'shield') {
        ctx.globalAlpha = 0.5 * c.k; ctx.strokeStyle = '#6fd0ff'; ctx.lineWidth = 0.08;
        ctx.beginPath(); ctx.ellipse(e.x, e.y, 1.6, 0.7, 0, 0, U.TAU); ctx.stroke();
        ctx.save(); ctx.translate(e.x, e.y); ctx.scale(1, 0.45); ctx.rotate(t * 2); ctx.globalAlpha = 0.6 * c.k; ctx.strokeStyle = '#b04dff';
        ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * U.TAU * 2; ctx.lineTo(Math.cos(a) * 1.4, Math.sin(a) * 1.4); } ctx.closePath(); ctx.stroke(); ctx.restore();
        if (e.targets) {
          ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#8fe0ff'; ctx.lineWidth = 0.05; ctx.globalAlpha = 0.5 * c.k;
          ctx.beginPath(); for (const o of e.targets) if (!o.dead) { ctx.moveTo(x, y - H * 0.8); ctx.lineTo(o.x, o.y - o.def.h * 0.5); } ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
        }
        ctx.globalAlpha = 1;
      } else if (c.type === 'launch') { // ruin guard shoulder launchers heating up
        for (let s = -1; s <= 1; s += 2) {
          const lx = x + s * H * 0.17, ly = y - H * 0.88, r = 0.3 + 0.5 * c.k;
          F.auraLite(ctx, lx, ly, r, t * 3 + s, 0.6 + 0.4 * c.k);
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + 0.5 * c.k; ctx.drawImage(G.assets.glow('#ff8a3d', 64), lx - r * 1.4, ly - r * 1.4, r * 2.8, r * 2.8); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        }
      } else if (c.type === 'wind' || c.type === 'inhale') { // venti gathering a storm
        const r = 0.4 + 1.1 * c.k, cy = y - H * 0.55;
        F.darkAura(ctx, x, cy, r, t, 0.35 + 0.4 * c.k);
        const ws = G.assets.img.icon_vfx_wind;
        if (ws) {
          const cs = ws.width / 4; ctx.globalCompositeOperation = 'lighter';
          for (let i = 0; i < 3; i++) { const f = (Math.floor(t * 12) + i * 3) % 8; ctx.globalAlpha = 0.55 * c.k; ctx.save(); ctx.translate(x, cy); ctx.rotate(t * 6 + i * 2.1); ctx.drawImage(ws, (f & 3) * cs, (f >> 2) * cs, cs, cs, -r * 1.3, -r * 1.3, r * 2.6, r * 2.6); ctx.restore(); }
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
        }
      }
    }
    if (e.def.ai === 'ruin' && e.spawnT <= 0) { // weak-spot core
      const up = G.render.dirRow(e.face.x, e.face.y) === 3;
      const cx = x + (Math.abs(e.face.x) > Math.abs(e.face.y) ? Math.sign(e.face.x) * H * 0.1 : 0), cy = y - H * 0.64;
      if (e.core) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 12), r = 0.7 + 0.25 * pulse;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.9; ctx.drawImage(G.assets.glow('#ffb347', 64), cx - r * 2, cy - r * 2, r * 4, r * 4);
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#fff0b0'; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.arc(cx, cy, 0.9 + 0.4 * (1 - pulse), 0, U.TAU); ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        // bouncing arrow marker
        const ay = cy - H * 0.55 - Math.abs(Math.sin(t * 6)) * 0.4;
        ctx.globalAlpha = 1; ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = '#3a1a00'; ctx.lineWidth = 0.06;
        ctx.beginPath(); ctx.moveTo(cx, ay + 0.45); ctx.lineTo(cx - 0.35, ay); ctx.lineTo(cx + 0.35, ay); ctx.closePath(); ctx.fill(); ctx.stroke();
      } else if (!up) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 3);
        ctx.drawImage(G.assets.glow('#ff7a3d', 32), cx - 0.5, cy - 0.5, 1, 1); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
    }
    if (e.def.ai === 'venti' && e.spawnT <= 0) { // wind swirl around the god
      const ws = G.assets.img.icon_vfx_wind;
      if (ws && !G.save.data.settings.reducedFx) {
        const cs = ws.width / 4, n = e.phase === 3 ? 3 : 2;
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < n; i++) { const f = (Math.floor(t * 10) + i * 4) % 8, r = H * 0.55; ctx.globalAlpha = 0.28 + 0.1 * e.phase; ctx.save(); ctx.translate(x, y - H * 0.45); ctx.scale(1, 0.55); ctx.rotate(t * 3 + i * Math.PI); ctx.drawImage(ws, (f & 3) * cs, (f >> 2) * cs, cs, cs, -r, -r, r * 2, r * 2); ctx.restore(); }
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      }
    }
  };

  // read-only attack sequences for the debug panel (js/debugpanel.js forces a chosen boss attack via e.cycle)
  A.seqs = { ruin: RUIN_SEQ, venti: VSEQ };
  return A;
})();
