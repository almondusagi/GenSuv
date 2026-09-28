/* enemies.js — enemy spawning, update loop, hazards (enemy attacks), death, drawing + G.enemyFx (enemy VFX).
   Enemy object fields (contract):
     isEnemy, kind, def, x, y, r, hp, maxHp, speed, dmg, face{x,y}, anim{state,t,lock},
     flash, kx, ky (knockback velocity), aura{el,gauge,until}, frozenUntil, vulnUntil, ecUntil,
     dead, spawnT, elite, boss, reward (chest tier dropped on death), relic (bool), cd (attack timer), ai state fields…
   AI state (enemy_ai.js): st, stT, pose ('raise'|'strike'|'idle'|null), tele (telegraph drawn on the ground),
     faceLock, dashing, z (height), squash, shakeAmp, held (lifted boulder), charge (casting orb), bubble (shaman shield).
   Every enemy attack is drawn wrapped in a black-purple aura (G.enemyFx.darkAura). */
'use strict';
G.enemies = (function () {
  const U = G.u;
  let nextId = 1, frame = 0;
  const POSE = { raise: { state: 'attack', t: 0 }, strike: { state: 'attack', t: 0.21 }, idle: { state: 'idle', t: 0 } };
  const FROZEN = { state: 'walk', t: 0 };

  function initRun(R) { R.enemies = []; R.hazards = []; FX.clear(); }

  function growth(R) {
    const g = G.data.stages[R.stageId].growth; const t = R.time;
    for (let i = 1; i < g.length; i++) if (t <= g[i][0]) { const a = g[i - 1], b = g[i], f = Math.max(0, (t - a[0]) / (b[0] - a[0])); return [U.lerp(a[1], b[1], f), U.lerp(a[2], b[2], f)]; }
    const b = g[g.length - 1]; return [b[1], b[2]];
  }

  /** spawn an enemy of kind at x,y. opts: {hpMul, dmgMul, speedMul, reward, relic, champion, fast (short spawn-in)} */
  function spawn(R, kind, x, y, opts) {
    opts = opts || {};
    const def = G.data.enemies[kind]; if (!def) return null;
    const [hg, dg] = def.boss ? [1, 1] : growth(R);
    const champ = !!opts.champion && !def.boss && !def.elite;
    const hp = Math.round(def.hp * hg * (opts.hpMul || 1) * (champ ? 4 : 1) * (G.cfg.enemyHpMul || 1));
    const sd = def.boss ? 1.6 : def.elite ? 0.9 : opts.fast ? 0.35 : 0.6;
    const e = {
      isEnemy: true, id: nextId++, kind, def, x, y, r: def.r * (champ ? 1.15 : 1), hp, maxHp: hp,
      speed: def.speed * (opts.speedMul || 1), dmg: def.dmg * dg * (opts.dmgMul || 1) * (champ ? 1.3 : 1) * (G.cfg.enemyDmgMul || 1),
      face: { x: 0, y: 1 }, anim: { state: 'walk', t: U.rand(0, 2), lock: 0 },
      flash: 0, kx: 0, ky: 0, aura: null, frozenUntil: 0, vulnUntil: 0, ecUntil: 0,
      dead: false, spawnT: sd, spawnDur: sd, cd: U.rand(0.8, 2.2), elite: !!def.elite || champ, champion: champ, boss: !!def.boss,
      reward: opts.reward || null, relic: !!opts.relic, touchCd: 0,
      scale: champ ? 1.18 : 1, st: 'move', stT: 0, pose: null, tele: null, z: 0, sp: def.speed, bubble: 0, bubbleUntil: 0,
    };
    e.bornT = R.time;
    if (opts.treasure) { e.treasure = true; e.treasureUntil = R.time + (opts.treasureT || 22); e.speed *= 1.25; }
    if (opts.march) { e.mx = opts.march.x; e.my = opts.march.y; e.marchUntil = R.time + (opts.march.t || 6); }
    if (opts.surge) e.surge = opts.surge;
    if (def.boss) e.invulnSpawn = true;
    R.enemies.push(e);
    G.enemyAI && G.enemyAI.init && G.enemyAI.init(R, e);
    if (def.boss) {
      R.boss = e; G.bus.emit('bossSpawn', e);
      G.fx.bossIntro && G.fx.bossIntro(e);
      FX.sfx('bossRoar', x, y, true);
      FX.ring(x, y, 6, 0.9, 0.4); FX.burst(x, y - 1, 4, 3);
    }
    return e;
  }

  function kill(R, e, src) {
    if (e.dead) return;
    e.dead = true; e.hp = 0; e.tele = null; e.held = null;
    R.kills++; R.combo++; R.comboTimer = 2.2; if (R.combo > R.maxCombo) R.maxCombo = R.combo;
    G.loot.onEnemyKilled(R, e);
    G.fx.death ? G.fx.death(e) : null;
    if (e.boss || e.elite) FX.burst(e.x, e.y - e.def.h * 0.4, e.def.h * (e.boss ? 0.9 : 0.6), U.randi(0, 3));
    FX.sfx(e.boss ? 'bossDeath' : e.elite ? 'eliteDeath' : 'kill', e.x, e.y, e.boss || e.elite);
    G.bus.emit('enemyKilled', { enemy: e, src });
    if (e === R.boss) { R.boss = null; G.bus.emit('bossKilled', e); }
  }

  /* shaman bubble: absorbs part of incoming damage */
  G.bus.on('enemyHit', ev => {
    const e = ev.enemy; if (!e || e.dead || !(e.bubble > 0)) return;
    const a = Math.min(e.bubble, ev.dmg * 0.75); e.bubble -= a; e.hp += a;
    if (e.bubble <= 0) { e.bubble = 0; FX.ring(e.x, e.y - e.def.h * 0.45, 1.4, 0.35, 0.12, '#6fd0ff'); G.fx.burst && G.fx.burst(e.x, e.y - e.def.h * 0.45, 8, '#8fe0ff', { max: 5, life: 0.35 }); }
  });

  function update(R, dt) {
    frame++;
    const p = R.player, now = R.time, grid = R.grid, cell = grid.cell, gmap = grid.map;
    const es = R.enemies, AI = G.enemyAI;
    for (let i = 0; i < es.length; i++) {
      const e = es[i]; if (e.dead) continue;
      if (e.dieAt && now >= e.dieAt) { FX.pop(e.x, e.y - e.def.h * 0.4, '#ffd27a'); kill(R, e, e.dieSrc || 'finale'); continue; }
      if (e.flash > 0) e.flash -= dt * 7;
      if (e.spawnT > 0) { e.spawnT -= dt; if (e.spawnT <= 0) { e.invulnSpawn = false; if (e.boss || e.elite) FX.ring(e.x, e.y, e.r * 3, 0.5, 0.18); } else continue; }
      e.anim.t += dt;
      if (e.bubble > 0 && e.bubbleUntil < now) e.bubble = 0;
      const bx0 = e.x, by0 = e.y; // for the optional player-wall hook (G.barrier, e.g. 凝光の璇璣屏)
      // knockback velocity decays quickly
      if (e.kx || e.ky) { e.x += e.kx * dt; e.y += e.ky * dt; const d = Math.pow(0.0005, dt); e.kx *= d; e.ky *= d; if (Math.abs(e.kx) + Math.abs(e.ky) < 0.02) e.kx = e.ky = 0; }
      if (e.frozenUntil > now) continue;
      const pdx = p.x - e.x, pdy = p.y - e.y, pdist = Math.sqrt(pdx * pdx + pdy * pdy) || 1;
      let nx = pdx / pdist, ny = pdy / pdist, dist = pdist;
      const taunted = e.taunt && e.taunt.until > now && !e.boss;
      if (taunted) {
        const tx = e.taunt.x - e.x, ty = e.taunt.y - e.y; dist = Math.sqrt(tx * tx + ty * ty) || 1; nx = tx / dist; ny = ty / dist;
        if (e.st !== 'move' && AI && AI.reset) AI.reset(e);
      }
      e.sp = e.speed * (e.slowUntil > now ? 0.6 : 1) * (e.enraged ? 1.3 : 1);
      const special = e.treasure || e.marchUntil > now;
      const ai = !taunted && !special && AI && AI[e.def.ai];
      let vx, vy;
      const mv = ai ? ai(R, e, dt, nx, ny, dist) : null;
      if (mv) { vx = mv.x; vy = mv.y; } else if (taunted && dist < 0.8) { vx = vy = 0; }
      else if (e.treasure && !taunted) { // treasure carrier: runs away in a wobbly line, escapes after a while
        const w = Math.sin(now * 2.3 + e.id) * 0.7, s = e.sp * (dist < 6 ? 1.25 : 0.85);
        vx = (-nx - ny * w) * s; vy = (-ny + nx * w) * s;
        if (((frame + e.id) & 7) === 0) FX.sparkle(e.x, e.y - e.def.h * 0.6);
        if (now > e.treasureUntil) { e.dead = true; G.bus.emit('notice', { text: '宝箱ヒルチャールに逃げられた…', color: '#ffd24a' }); FX.ring(e.x, e.y, 1.6, 0.4, 0.2, '#ffd24a'); continue; }
      } else if (e.marchUntil > now && !taunted) { vx = e.mx * e.sp * 1.35; vy = e.my * e.sp * 1.35; }
      else { vx = nx * e.sp; vy = ny * e.sp; }
      e.x += vx * dt; e.y += vy * dt;
      if (!e.faceLock && Math.abs(vx) + Math.abs(vy) > 0.05) { e.face.x = vx; e.face.y = vy; }
      if (e.anim.lock > 0) e.anim.lock -= dt;
      // separation against grid neighbours (every other frame per enemy; no closures)
      if (((e.id + frame) & 1) === 0 && !e.boss) {
        const cx = Math.floor(e.x / cell), cy = Math.floor(e.y / cell);
        let checks = 0;
        for (let gx = cx - 1; gx <= cx + 1 && checks < 14; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const b = gmap.get(grid.key(gx, gy)); if (!b) continue;
          for (let j = 0; j < b.length; j++) {
            const o = b[j]; if (o === e || o.dead) continue;
            const ox = e.x - o.x, oy = e.y - o.y, rr = e.r + o.r, d2 = ox * ox + oy * oy;
            if (d2 < rr * rr && d2 > 1e-6) {
              const d = Math.sqrt(d2), push = (rr - d) * (o.boss ? 1.4 : o.elite && !e.elite ? 0.9 : 0.7);
              e.x += ox / d * push; e.y += oy / d * push; if (++checks >= 14) break;
            }
          }
        }
      }
      if (R.barriers && R.barriers.length && G.barrier) G.barrier.enemy(R, e, bx0, by0);
      // contact damage (with the player, not the taunt point)
      if (e.touchCd > 0) e.touchCd -= dt;
      const cd = Math.hypot(p.x - e.x, p.y - e.y);
      if (cd < e.r + p.r + 0.15 && e.touchCd <= 0 && (e.z || 0) < 0.6) {
        e.touchCd = 0.8; G.player.hurt(R, e.dmg * (e.dashing ? 1.4 : 1), { x: e.x, y: e.y, kind: e.kind });
      }
      // recycle far away normal enemies in front of the player so the horde keeps up
      if (!e.boss && !e.elite && cd > G.cfg.despawnDist) {
        const a = U.rand(0, U.TAU), rr = U.rand(G.cfg.spawnRing[0], G.cfg.spawnRing[1]);
        const fx = p.vx || 0, fy = p.vy || 0; const lead = Math.hypot(fx, fy) > 0.1 ? U.norm(fx, fy) : { x: 0, y: 0 };
        e.x = p.x + Math.cos(a) * rr + lead.x * 6; e.y = p.y + Math.sin(a) * rr + lead.y * 6;
        AI && AI.reset && AI.reset(e);
      }
    }
    updateHazards(R, dt);
    FX.update(dt);
  }

  /* ================= hazards: enemy-owned attacks =================
     h: {type, x, y, vx, vy, r, delay (telegraph s), life, dmg, src, ...type fields}
     types: arrow | orb | bullet | wind | rock (arc) | zone | lane (visual) | wave | tornado | push | ringTele (visual) | dash
     Generic: follow (entity), onEnd(R,h), onHit(R,h). */
  function hazard(R, h) {
    h.type = h.type || h.kind || 'zone'; h.kind = h.kind || h.type;
    h.t = 0; h.delay = h.delay || 0; h.life = h.life == null ? 1 : h.life; h.hitCd = 0; h.seed = U.rnd() * 100;
    if (h.type === 'rock') { h.x0 = h.x; h.y0 = h.y; h.rot = 0; h.z = h.h0 || 0; }
    R.hazards.push(h); return h;
  }
  function hurtP(R, h, dmg) { return G.player.hurt(R, dmg == null ? h.dmg : dmg, { x: h.x, y: h.y, kind: h.src || h.type }); }
  function inR(p, x, y, r) { const dx = p.x - x, dy = p.y - y, rr = r + p.r; return dx * dx + dy * dy < rr * rr; }

  const qlvG = () => G.save.data.settings.reducedFx ? 0 : (G.quality ? G.quality.level : 3);
  const HZ = {
    projectile: {
      update(R, h, dt) {
        if (h.t < h.delay) { if (h.follow && !h.follow.dead) { h.x = h.follow.x + (h.ox || 0); h.y = h.follow.y + (h.oy || 0); } return; }
        const p = R.player;
        if (h.home && h.t - h.delay < (h.homeT || 1.5)) {
          const a = Math.atan2(h.vy, h.vx), b = Math.atan2(p.y - h.y, p.x - h.x), d = U.clamp(U.angDiff(a, b), -h.home * dt, h.home * dt), s = Math.hypot(h.vx, h.vy);
          h.vx = Math.cos(a + d) * s; h.vy = Math.sin(a + d) * s;
        }
        if (h.accel) { const s = Math.hypot(h.vx, h.vy), ns = Math.max(0.5, s + h.accel * dt); h.vx *= ns / s; h.vy *= ns / s; }
        if (h.curve) { const a = Math.atan2(h.vy, h.vx) + h.curve * dt, s = Math.hypot(h.vx, h.vy); h.vx = Math.cos(a) * s; h.vy = Math.sin(a) * s; }
        h.x += h.vx * dt; h.y += h.vy * dt;
        if (h.dmg > 0 && inR(p, h.x, h.y, h.r)) {
          if (hurtP(R, h) >= 0) { h.done = true; FX.pop(h.x, h.y, h.color); h.onHit && h.onHit(R, h); }
        }
        if (U.dist2(h.x, h.y, p.x, p.y) > 900) h.done = true;
      },
    },
    rock: {
      update(R, h, dt) {
        if (h.t < h.delay) return;
        const k = Math.min(1, (h.t - h.delay) / h.life);
        h.x = U.lerp(h.x0, h.x1, k); h.y = U.lerp(h.y0, h.y1, k);
        h.z = (h.h0 || 0) * (1 - k) + h.peak * 4 * k * (1 - k);
        h.rot += (h.spin || 7) * dt;
        if (k >= 1) {
          h.done = true; h.x = h.x1; h.y = h.y1; h.z = 0;
          if (inR(R.player, h.x1, h.y1, h.r)) hurtP(R, h);
          FX.rockImpact(h.x1, h.y1, h.r, h.size || 1);
        }
      },
    },
    zone: {
      update(R, h, dt) {
        if (h.follow) { if (h.follow.dead) { h.done = true; return; } h.x = h.follow.x; h.y = h.follow.y; }
        if (!h.fired && h.t >= h.delay) {
          h.fired = true;
          if (h.dmg > 0 && !h.persist && inR(R.player, h.x, h.y, h.r)) hurtP(R, h);
          FX.zoneImpact(h);
        }
        if (h.fired && h.persist && h.dmg > 0) {
          if (h.hitCd > 0) h.hitCd -= dt;
          else if (inR(R.player, h.x, h.y, h.r)) { hurtP(R, h); h.hitCd = h.tick || 0.5; }
        }
      },
    },
    lane: { update(R, h) { if (h.follow && h.follow.dead) h.done = true; } },
    ringTele: { update() { } },
    wave: {
      update(R, h, dt) {
        if (h.t < h.delay) return;
        const k = (h.t - h.delay) / h.life; h.cr = U.lerp(h.r0 || 0, h.r1, U.ease.outCubic(Math.min(1, k)));
        if (!h.spent && h.dmg > 0) {
          const d = U.dist(h.x, h.y, R.player.x, R.player.y);
          if (Math.abs(d - h.cr) < (h.w || 0.6) + R.player.r) { h.spent = true; hurtP(R, h); }
        }
      },
    },
    tornado: {
      update(R, h, dt) {
        if (h.t < h.delay) return;
        const p = R.player, d = U.dist(h.x, h.y, p.x, p.y) || 1;
        const s = h.speed || 1.5; h.x += (p.x - h.x) / d * s * dt; h.y += (p.y - h.y) / d * s * dt;
        const pr = h.pullR || 6;
        if (d < pr && d > 0.3) { const f = h.pull * (1 - d / pr * 0.6); p.x += (h.x - p.x) / d * f * dt; p.y += (h.y - p.y) / d * f * dt; }
        if (h.hitCd > 0) h.hitCd -= dt; else if (d < h.r + p.r) { hurtP(R, h); h.hitCd = h.tick || 0.5; }
        if (U.chance(dt * 18)) FX.dust(h.x + U.rand(-1, 1), h.y + U.rand(-0.4, 0.4), 0.5, '#bfe8dc');
      },
    },
    push: {
      update(R, h, dt) {
        if (h.follow) { if (h.follow.dead) { h.done = true; return; } h.x = h.follow.x; h.y = h.follow.y; }
        if (h.inhale && U.chance(dt * (qlvG() >= 2 ? 40 : 14))) { const a = U.rand(0, U.TAU), r = U.rand(5, 10); FX.add({ k: 'suck', x: h.x + Math.cos(a) * r, y: h.y + Math.sin(a) * r * 0.8, tx: h, a, r0: r, life: U.rand(0.5, 0.8) }); }
        const p = R.player, d = U.dist(h.x, h.y, p.x, p.y) || 1, k = 1 - h.t / h.life;
        if (d < h.r) { p.x += (p.x - h.x) / d * h.force * k * dt; p.y += (p.y - h.y) / d * h.force * k * dt; }
      },
    },
    beam: { // ground lane from the follower along h.ang; ticks damage while the player stands in it
      update(R, h, dt) {
        if (!h.follow || h.follow.dead) { h.done = true; return; }
        h.x = h.follow.x; h.y = h.follow.y;
        const p = R.player, c = Math.cos(h.ang), s = Math.sin(h.ang), dx = p.x - h.x, dy = p.y - h.y, along = dx * c + dy * s, perp = Math.abs(-dx * s + dy * c);
        if (h.hitCd > 0) h.hitCd -= dt;
        else if (along > 0 && along < h.len && perp < h.w / 2 + p.r) { hurtP(R, h); h.hitCd = h.tick || 0.3; }
        if (U.chance(dt * 22)) { const d = U.rand(1.5, h.len); FX.dust(h.x + c * d + U.rand(-0.3, 0.3), h.y + s * d, 0.45, '#5a3a2a'); }
      },
    },
    dash: { // damaging hitbox that follows a dashing enemy
      update(R, h, dt) {
        if (!h.follow || h.follow.dead) { h.done = true; return; }
        h.x = h.follow.x; h.y = h.follow.y;
        if (!h.spent && inR(R.player, h.x, h.y, h.r)) { h.spent = true; hurtP(R, h); }
      },
    },
  };
  HZ.arrow = HZ.orb = HZ.bullet = HZ.wind = HZ.projectile;

  function updateHazards(R, dt) {
    const hs = R.hazards;
    for (let i = hs.length - 1; i >= 0; i--) {
      const h = hs[i]; h.t += dt;
      const T = HZ[h.type] || HZ.zone, hx0 = h.x, hy0 = h.y;
      T.update(R, h, dt);
      if (R.barriers && R.barriers.length && G.barrier) G.barrier.hazard(R, h, hx0, hy0);
      if (h.done || h.t >= h.delay + h.life) { h.onEnd && h.onEnd(R, h); hs[i] = hs[hs.length - 1]; hs.pop(); }
    }
  }

  /* ================= drawing ================= */
  const ST_COL = { idle: 0, walk: 2, attack: 4 }, ST_FPS = { idle: 2.2, walk: 7, attack: 5 };
  function frameCol(anim) { const b = ST_COL[anim.state] || 0; return b + (Math.floor((anim.t || 0) * (ST_FPS[anim.state] || 5)) & 1); }
  /** draw a coloured silhouette of an actor frame (outlines, afterimages) */
  function drawSil(ctx, atlas, color, x, y, h, row, col, sx, sy, alpha) {
    const im = FX.silhouette(atlas, color); if (!im) return;
    const cell = G.assets.actors[atlas].cell, w = h * (sx || 1), hh = h * (sy || 1);
    const a = ctx.globalAlpha; ctx.globalAlpha = a * alpha;
    ctx.drawImage(im, col * cell, row * cell, cell, cell, x - w / 2, y - hh + h * 0.07, w, hh);
    ctx.globalAlpha = a;
  }

  /* per-kind sprite cache (resolved once: no string keys / object literals per frame) */
  function kindSprites(def) {
    let k = def._spr;
    if (k && k.img) return k;
    const meta = G.assets.actors[def.atlas]; if (!meta) return null;
    const img = def.filter ? G.assets.tinted('actor_' + def.atlas, def.filter) : G.assets.img['actor_' + def.atlas];
    k = def._spr = { img, white: G.assets.white[def.atlas], cell: meta.cell, cols: meta.cols };
    return k;
  }
  const ST_BASE = { idle: 0, walk: 2, attack: 4, skill: 4, burst: 4, hurt: 0 };
  const ST_RATE = { idle: 2.2, walk: 7, attack: 5 };

  function drawEnemy(ctx, e) {
    const def = e.def, R = G.run, t = R.time;
    const K = kindSprites(def); if (!K || !K.img) return;
    const q = G.save.data.settings.reducedFx ? 0 : (G.quality ? G.quality.level : 3);
    const H = def.h * (e.scale || 1);
    let sp = 1;
    if (e.spawnT > 0) { sp = 1 - e.spawnT / e.spawnDur; FX.drawPortal(ctx, e.x, e.y, e.r * 1.6 + H * 0.25, sp, t); }
    const spawning = sp < 1;
    const z = e.z || 0;
    G.render.shadow(ctx, e.x, e.y, e.r * 1.25 * (spawning ? Math.min(1, sp * 1.5) : 1) * (1 - Math.min(0.45, z * 0.12)), 0.3);
    if (!spawning && (e.enraged || (e.elite && (q >= 2 || !e.champion)))) FX.auraLite(ctx, e.x, e.y - 0.1, e.r * 1.9, t + e.id, e.enraged ? 0.75 : 0.4);
    const frozen = e.frozenUntil > t;
    let anim = e.anim;
    if (frozen) { FROZEN.state = e.anim.state === 'attack' ? 'attack' : 'walk'; anim = FROZEN; }
    else if (e.pose) anim = POSE[e.pose] || e.anim;
    let sx = 1, sy = 1;
    if (e.squash) { sy = 1 - e.squash; sx = 1 + e.squash * 0.8; }
    else if (def.ai === 'hopper' && !frozen) { const s = Math.sin(e.anim.t * 7 + e.id); sy = 1 + s * 0.05; sx = 1 - s * 0.04; }
    let x = e.x, y = e.y - z;
    if (e.shakeAmp && !frozen) x += Math.sin(t * 73 + e.id) * e.shakeAmp;
    // attack body language: lean back while winding up, snap forward on the strike
    const atk = !spawning && !frozen && (e.pose === 'raise' || e.pose === 'strike' || e.dashing || !!e.held || !!e.charge || (e.st === 'charge' && def.ai === 'hopper'));
    if (atk && !e.boss) {
      const fl = Math.hypot(e.face.x, e.face.y) || 1, fx = e.face.x / fl, fy = e.face.y / fl;
      if (e.pose === 'raise') { const k = Math.min(1, (e.stT || 0) / 0.3); sy *= 1 + 0.07 * k; sx *= 1 - 0.05 * k; x -= fx * 0.14 * k; y -= fy * 0.08 * k; }
      else if (e.pose === 'strike') { const k = Math.max(0, 1 - (e.stT || 0) / 0.28); sx *= 1 + 0.12 * k; sy *= 1 - 0.1 * k; x += fx * 0.32 * k; y += fy * 0.2 * k; }
    }
    // hit reaction: squash pop while flashing; elites/bosses stagger when nearly dead
    if (e.flash > 0 && !frozen) { const f = Math.min(1, e.flash); sx *= 1 + 0.12 * f; sy *= 1 - 0.1 * f; }
    if ((e.elite || e.boss) && e.hp < e.maxHp * 0.22 && !frozen) x += Math.sin(t * 17 + e.id) * 0.05;
    const row = G.render.dirRow(e.face.x, e.face.y);
    // frame column (same rules as G.render.drawActor)
    const st = anim.state || 'idle'; let base = ST_BASE[st] || 0; if (base >= K.cols) base = 4;
    const col = base + (Math.floor((anim.t || 0) * (ST_RATE[st] || 5)) & 1);
    const cell = K.cell, w = sx * H, h = sy * H, dx = x - w / 2;
    let dy = y - h + H * 0.07, srcH = cell, dh = h;
    const a0 = ctx.globalAlpha;
    if (spawning) { // rise out of the portal: crop the frame at the ground line (no clip/save)
      const k = U.ease.outCubic(sp); dy += H * (1 - k);
      const vis = Math.max(0, Math.min(h, e.y + 0.04 - dy)); if (vis <= 0.01) return;
      dh = vis; srcH = cell * vis / h; ctx.globalAlpha = a0 * (0.35 + 0.65 * k);
    }
    if (atk) { // every attacking enemy wears the black-purple aura: smoky ground aura + dark outline + violet pulse
      FX.auraLite(ctx, e.x, e.y - 0.05, e.r * 1.8 + 0.2, t * 1.3 + e.id, 0.6);
      const ol = FX.outlineSheet(def.atlas, '#14001f');
      if (ol) { const oc = ol.cell, px = w * ol.r * 1.6, py = h * ol.r * 1.6; ctx.globalAlpha = a0 * (e.elite || e.boss ? 0.85 : 0.6); ctx.drawImage(ol.c, col * oc, row * oc, oc, oc, dx - px, dy - py, w + px * 2, h + py * 2); ctx.globalAlpha = a0; }
      if (q >= 2 && ((frame + e.id) % 11) === 0) FX.wisp(e.x + U.rand(-e.r, e.r), e.y - H * U.rand(0.2, 0.7));
    }
    if (e.elite && !spawning) {
      const ol = FX.outlineSheet(def.atlas, e.enraged ? '#ff2d6f' : e.treasure ? '#ffd24a' : e.champion ? '#ffd24a' : '#c890ff');
      if (ol) { const oc = ol.cell, px = w * ol.r, py = h * ol.r; ctx.globalAlpha = a0 * 0.9; ctx.drawImage(ol.c, col * oc, row * oc, oc, oc, dx - px, dy - py, w + px * 2, h + py * 2); ctx.globalAlpha = a0; }
    }
    ctx.drawImage(K.img, col * cell, row * cell, cell, srcH, dx, dy, w, dh);
    if (e.flash > 0 && K.white) { ctx.globalAlpha = a0 * Math.min(1, e.flash); ctx.drawImage(K.white, col * cell, row * cell, cell, srcH, dx, dy, w, dh); }
    ctx.globalAlpha = a0;
    if (spawning) return;
    if (atk && q >= 2 && !e.enraged) { ctx.globalCompositeOperation = 'lighter'; drawSil(ctx, def.atlas, '#7a22ff', x, y, H, row, col, sx, sy, 0.12 + 0.08 * Math.sin(t * 14 + e.id)); ctx.globalCompositeOperation = 'source-over'; }
    if (e.enraged && q >= 2) { ctx.globalCompositeOperation = 'lighter'; drawSil(ctx, def.atlas, '#ff2a6a', x, y, H, row, col, sx, sy, 0.16 + 0.1 * Math.sin(t * 10)); ctx.globalCompositeOperation = 'source-over'; }
    // boss/AI extras (weak-spot core, lifted boulder, casting orb, wind aura…)
    if ((e.held || e.charge || e.boss) && G.enemyAI && G.enemyAI.drawExtra) G.enemyAI.drawExtra(ctx, e, x, y, H, t);
    if (e.bubble > 0) {
      const by = y - H * 0.45, br = H * 0.42;
      ctx.globalAlpha = 0.22; ctx.fillStyle = '#5ab8ff'; ctx.beginPath(); ctx.arc(x, by, br, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 0.85; ctx.lineWidth = 0.07; ctx.strokeStyle = '#1a0a2e'; ctx.stroke();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 + 0.2 * Math.sin(t * 6 + e.id); ctx.lineWidth = 0.05; ctx.strokeStyle = '#9fe0ff';
      ctx.beginPath(); ctx.arc(x, by, br * 0.97, 0, U.TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    if (frozen) { ctx.globalAlpha = 0.45; ctx.fillStyle = '#bff4ff'; ctx.beginPath(); ctx.ellipse(e.x, y - H * 0.35, H * 0.32, H * 0.4, 0, 0, U.TAU); ctx.fill(); ctx.globalAlpha = 1; }
    if (e.aura && e.aura.until > t && G.fx.auraIcon) G.fx.auraIcon(ctx, e);
    if (e.elite && !e.boss && e.hp < e.maxHp) {
      const bw = H * 0.6, f = e.hp / e.maxHp, by = y - H * 0.98;
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(e.x - bw / 2 - 0.03, by - 0.03, bw + 0.06, 0.18);
      ctx.fillStyle = e.enraged ? '#ff2d6f' : '#ff5a4d'; ctx.fillRect(e.x - bw / 2, by, bw * f, 0.12);
      if (e.bubble > 0) { ctx.fillStyle = '#9fe0ff'; ctx.fillRect(e.x - bw / 2, by, bw * Math.min(1, e.bubble / e.maxHp), 0.05); }
    }
  }
  function drawGround(ctx) { FX.drawGround(ctx); }
  function drawAir(ctx) { FX.drawAir(ctx); }

  /* ================= G.enemyFx : enemy VFX (black-purple aura theme) ================= */
  const FX = (function () {
    let list = [];
    const MAXFX = 500;
    let discC = null, rimC = null, boulderC = null, chipC = null, runeC = null;
    const sil = {};
    let inShared = false;
    function mk(s) { return G.assets.makeCanvas(s, s); }
    function build() {
      const s = 128;
      discC = mk(s); let x = discC.getContext('2d'), g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(6,0,12,0.95)'); g.addColorStop(0.4, 'rgba(16,0,30,0.85)'); g.addColorStop(0.7, 'rgba(34,0,58,0.4)'); g.addColorStop(1, 'rgba(30,0,50,0)');
      x.fillStyle = g; x.fillRect(0, 0, s, s);
      rimC = mk(s); x = rimC.getContext('2d'); g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(60,10,110,0)'); g.addColorStop(0.46, 'rgba(60,10,110,0)'); g.addColorStop(0.62, 'rgba(90,30,170,0.6)');
      g.addColorStop(0.72, 'rgba(130,60,230,0.55)'); g.addColorStop(0.84, 'rgba(60,10,120,0.3)'); g.addColorStop(1, 'rgba(30,0,60,0)');
      x.fillStyle = g; x.fillRect(0, 0, s, s);
      // procedural boulder (generic rock, cracked with dark-violet energy)
      boulderC = mk(128); x = boulderC.getContext('2d');
      const pts = []; let seed = 7; const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
      for (let i = 0; i < 12; i++) { const a = i / 12 * U.TAU, rr = 46 + r() * 12; pts.push([64 + Math.cos(a) * rr, 64 + Math.sin(a) * rr * 0.92]); }
      x.beginPath(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath();
      g = x.createRadialGradient(48, 44, 6, 64, 64, 64); g.addColorStop(0, '#b3a99a'); g.addColorStop(0.55, '#7a7065'); g.addColorStop(1, '#3a332e');
      x.fillStyle = g; x.fill(); x.lineWidth = 5; x.strokeStyle = '#1c1512'; x.stroke();
      x.fillStyle = 'rgba(255,255,255,.18)'; x.beginPath(); x.ellipse(46, 40, 20, 12, -0.5, 0, U.TAU); x.fill();
      x.fillStyle = 'rgba(0,0,0,.22)'; x.beginPath(); x.ellipse(78, 86, 26, 16, 0.4, 0, U.TAU); x.fill();
      x.lineCap = 'round';
      const cracks = [[[40, 70], [58, 62], [66, 78], [84, 72]], [[70, 30], [64, 48], [76, 56]], [[30, 50], [44, 56]]];
      for (const c of cracks) {
        x.beginPath(); c.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]));
        x.strokeStyle = 'rgba(190,80,255,.55)'; x.lineWidth = 8; x.stroke(); x.strokeStyle = '#f0b8ff'; x.lineWidth = 2.5; x.stroke();
      }
      // dark casting circle (generic runes: rings, hexagram, tick marks)
      runeC = mk(256); x = runeC.getContext('2d'); x.translate(128, 128);
      g = x.createRadialGradient(0, 0, 0, 0, 0, 124); g.addColorStop(0, 'rgba(20,0,34,0.75)'); g.addColorStop(0.75, 'rgba(26,0,44,0.55)'); g.addColorStop(1, 'rgba(26,0,44,0)');
      x.fillStyle = g; x.beginPath(); x.arc(0, 0, 124, 0, U.TAU); x.fill();
      x.strokeStyle = '#b04dff'; x.lineWidth = 5; x.beginPath(); x.arc(0, 0, 112, 0, U.TAU); x.stroke();
      x.lineWidth = 2.5; x.beginPath(); x.arc(0, 0, 98, 0, U.TAU); x.stroke(); x.beginPath(); x.arc(0, 0, 58, 0, U.TAU); x.stroke();
      x.strokeStyle = '#8f45ff'; x.lineWidth = 3;
      x.beginPath(); for (let i = 0; i < 3; i++) { const a = i / 3 * U.TAU - Math.PI / 2; x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 96, Math.sin(a) * 96); } x.closePath(); x.stroke();
      x.beginPath(); for (let i = 0; i < 3; i++) { const a = i / 3 * U.TAU + Math.PI / 2; x[i ? 'lineTo' : 'moveTo'](Math.cos(a) * 96, Math.sin(a) * 96); } x.closePath(); x.stroke();
      x.strokeStyle = '#d68cff'; x.lineWidth = 3;
      for (let i = 0; i < 24; i++) { const a = i / 24 * U.TAU; x.beginPath(); x.moveTo(Math.cos(a) * 100, Math.sin(a) * 100); x.lineTo(Math.cos(a) * (i % 3 ? 106 : 111), Math.sin(a) * (i % 3 ? 106 : 111)); x.stroke(); }
      for (let i = 0; i < 8; i++) { const a = i / 8 * U.TAU + 0.2; x.beginPath(); x.arc(Math.cos(a) * 78, Math.sin(a) * 78, 6, 0, U.TAU); x.stroke(); }
      chipC = mk(32); x = chipC.getContext('2d');
      x.beginPath(); x.moveTo(6, 10); x.lineTo(20, 4); x.lineTo(28, 16); x.lineTo(18, 28); x.lineTo(5, 22); x.closePath();
      x.fillStyle = '#6e655b'; x.fill(); x.lineWidth = 2.5; x.strokeStyle = '#211a16'; x.stroke(); x.fillStyle = 'rgba(255,255,255,.2)'; x.fillRect(10, 9, 8, 5);
    }
    /** dilated coloured outline atlas (half resolution, built once per atlas+colour) */
    const olc = {};
    function outlineSheet(atlas, color) {
      const key = atlas + color; if (olc[key]) return olc[key];
      const sil1 = silhouette(atlas, color); if (!sil1) return null;
      const meta = G.assets.actors[atlas], cell = meta.cell / 2, pad = Math.round(cell * 0.06);
      const c = G.assets.makeCanvas(sil1.width / 2, sil1.height / 2), x = c.getContext('2d');
      // each cell is drawn shrunk into its slot with a pad so the dilated edge fits inside the cell
      const inner = cell - pad * 2, d = Math.max(1, Math.round(pad * 0.75));
      for (let r = 0; r < sil1.height / meta.cell; r++) for (let q = 0; q < meta.cols; q++) {
        for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; x.drawImage(sil1, q * meta.cell, r * meta.cell, meta.cell, meta.cell, q * cell + pad + Math.cos(a) * d, r * cell + pad + Math.sin(a) * d, inner, inner); }
      }
      return (olc[key] = { c, cell, r: pad / inner });
    }
    let portalC = null;
    function portalSprite() {
      if (portalC) return portalC;
      const s = 128; portalC = mk(s); const x = portalC.getContext('2d');
      x.translate(s / 2, s / 2); x.scale(1, 0.45);
      x.fillStyle = 'rgba(11,0,18,0.85)'; x.beginPath(); x.arc(0, 0, 58, 0, U.TAU); x.fill();
      x.strokeStyle = '#b04dff'; x.lineWidth = 7; x.beginPath(); x.arc(0, 0, 58, 0, U.TAU); x.stroke();
      x.strokeStyle = 'rgba(140,60,255,0.6)'; x.lineWidth = 4; x.beginPath(); x.arc(0, 0, 40, 0.3, 5.2); x.stroke();
      return portalC;
    }
    let auraSmall = null;
    /** 2×2 aura sheet pre-scaled to 128px cells (cheap to rotate/scale every frame) */
    function auraSheet() {
      if (auraSmall) return auraSmall;
      const im = G.assets.img.icon_enemy_aura; if (!im) return null;
      auraSmall = G.assets.makeCanvas(256, 256); auraSmall.getContext('2d').drawImage(im, 0, 0, 256, 256);
      return auraSmall;
    }
    const qlv = () => G.save.data.settings.reducedFx ? 0 : (G.quality ? G.quality.level : 3);
    function silhouette(atlas, color) {
      const key = atlas + '|' + color; if (sil[key]) return sil[key];
      const w = G.assets.white[atlas]; if (!w) return null;
      const c = G.assets.makeCanvas(w.width, w.height), x = c.getContext('2d');
      x.drawImage(w, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
      sil[key] = c; return c;
    }
    const reduced = () => G.save.data.settings.reducedFx;
    const RUNE_R = { orb: 1.5, shield: 1.9, launch: 3.2, wind: 2.6, spark: 1.1, inhale: 3.2 };

    /** own painter: dark smoky core + animated aura sheet frame + bright violet/magenta rim */
    function ownAura(ctx, x, y, r, t, alpha) {
      if (!discC) build();
      const a0 = ctx.globalAlpha, al = alpha == null ? 1 : alpha;
      ctx.globalAlpha = a0 * al * 0.8; ctx.drawImage(discC, x - r * 1.35, y - r * 1.35, r * 2.7, r * 2.7);
      const sheet = qlv() >= 1 ? auraSheet() : null;
      if (sheet) {
        const f = Math.floor(t * 9) & 3, rr = r * 1.45, rot = t * 1.3;
        ctx.globalAlpha = a0 * al * 0.9;
        ctx.translate(x, y); ctx.rotate(rot);
        ctx.drawImage(sheet, (f & 1) * 128, (f >> 1) * 128, 128, 128, -rr, -rr, rr * 2, rr * 2);
        ctx.rotate(-rot); ctx.translate(-x, -y);
      }
      const go = ctx.globalCompositeOperation; ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a0 * al * (0.6 + 0.35 * Math.sin(t * 9));
      ctx.drawImage(rimC, x - r * 1.25, y - r * 1.25, r * 2.5, r * 2.5);
      ctx.globalCompositeOperation = go; ctx.globalAlpha = a0;
    }
    /** shared entry: prefers the VFX owner's painter when present (guarded against recursion) */
    function darkAura(ctx, x, y, r, t, alpha) {
      const shared = G.fx && G.fx.darkAura;
      if (shared && shared !== darkAura && !inShared) { inShared = true; try { shared(ctx, x, y, r, t, alpha); } finally { inShared = false; } return; }
      ownAura(ctx, x, y, r, t, alpha);
    }
    /** cheap aura for many bullets: prefers VFX's G.fx.darkAuraLite (black smoke), else dark disc + faint violet rim */
    let inLite = false;
    function auraLite(ctx, x, y, r, t, alpha) {
      const shared = G.fx && G.fx.darkAuraLite;
      if (shared && !inLite) { inLite = true; try { shared(ctx, x, y, r, t, alpha); } finally { inLite = false; } return; }
      if (!discC) build();
      const a0 = ctx.globalAlpha, al = alpha == null ? 1 : alpha;
      ctx.globalAlpha = a0 * al * 0.85; ctx.drawImage(discC, x - r * 1.3, y - r * 1.3, r * 2.6, r * 2.6);
      const go = ctx.globalCompositeOperation; ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = a0 * al * (0.65 + 0.3 * Math.sin(t * 11));
      ctx.drawImage(rimC, x - r * 1.2, y - r * 1.2, r * 2.4, r * 2.4);
      ctx.globalCompositeOperation = go; ctx.globalAlpha = a0;
    }

    /* ---- telegraph painters (true circles/rects = exact hitboxes) ---- */
    function teleCircle(ctx, x, y, r, k, t, hue) {
      const pulse = 0.5 + 0.5 * Math.sin(t * (8 + 22 * k));
      ctx.globalAlpha = 0.3 + 0.12 * k; ctx.fillStyle = '#16001f'; ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 0.28 + 0.3 * k; ctx.fillStyle = hue || '#7a1fb0'; ctx.beginPath(); ctx.arc(x, y, Math.max(0.01, r * k), 0, U.TAU); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.lineWidth = 0.12; ctx.strokeStyle = '#0c0012'; ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.45 + 0.55 * pulse * (0.4 + 0.6 * k); ctx.lineWidth = 0.07; ctx.strokeStyle = k > 0.75 ? '#8f45ff' : '#b04dff';
      ctx.beginPath(); ctx.arc(x, y, r - 0.03, 0, U.TAU); ctx.stroke();
      // rotating rune ticks
      ctx.globalAlpha = 0.5; ctx.lineWidth = 0.05; ctx.strokeStyle = '#d68cff';
      const n = Math.max(6, Math.round(r * 5)), rot = t * 1.5;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const a = rot + i / n * U.TAU; ctx.moveTo(x + Math.cos(a) * (r + 0.08), y + Math.sin(a) * (r + 0.08)); ctx.lineTo(x + Math.cos(a) * (r + 0.28), y + Math.sin(a) * (r + 0.28)); }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    function teleLane(ctx, x, y, ang, len, w, k, t) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(ang);
      ctx.globalAlpha = 0.34; ctx.fillStyle = '#16001f'; ctx.fillRect(0, -w / 2, len, w);
      ctx.globalAlpha = 0.35 + 0.25 * k; ctx.fillStyle = '#7a1fb0'; ctx.fillRect(0, -w / 2, len * k, w);
      ctx.globalAlpha = 0.9; ctx.lineWidth = 0.1; ctx.strokeStyle = '#0c0012'; ctx.strokeRect(0, -w / 2, len, w);
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * (10 + 20 * k)); ctx.lineWidth = 0.06; ctx.strokeStyle = k > 0.75 ? '#8f45ff' : '#b04dff';
      ctx.beginPath(); ctx.moveTo(0, -w / 2); ctx.lineTo(len, -w / 2); ctx.moveTo(0, w / 2); ctx.lineTo(len, w / 2); ctx.stroke();
      ctx.globalAlpha = 0.55; ctx.strokeStyle = '#e6a8ff'; ctx.lineWidth = 0.08; ctx.beginPath();
      const off = (t * 6) % 1.4, cw = Math.min(w * 0.35, 0.45);
      for (let s = off; s < len - 0.3; s += 1.4) { ctx.moveTo(s, -cw); ctx.lineTo(s + cw, 0); ctx.lineTo(s, cw); }
      ctx.stroke();
      ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    function teleAim(ctx, x, y, x2, y2, k, t) {
      ctx.globalAlpha = 0.55; ctx.strokeStyle = '#12001a'; ctx.lineWidth = 0.22; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = 0.35 + 0.6 * k; ctx.strokeStyle = k > 0.7 ? '#8f45ff' : '#b04dff'; ctx.lineWidth = 0.08;
      ctx.setLineDash([0.35, 0.2]); ctx.lineDashOffset = -t * 4; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      const rr = 0.25 + 0.5 * (1 - k); ctx.lineWidth = 0.06; ctx.beginPath(); ctx.arc(x2, y2, rr, 0, U.TAU); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    function teleCone(ctx, x, y, ang, len, spread, k, t) {
      ctx.globalAlpha = 0.3; ctx.fillStyle = '#16001f'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, len, ang - spread, ang + spread); ctx.closePath(); ctx.fill();
      ctx.globalAlpha = 0.3 + 0.3 * k; ctx.fillStyle = '#7a1fb0'; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, len * k, ang - spread, ang + spread); ctx.closePath(); ctx.fill();
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + 0.4 * k; ctx.strokeStyle = k > 0.75 ? '#8f45ff' : '#b04dff'; ctx.lineWidth = 0.05;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, len, ang - spread, ang + spread); ctx.closePath(); ctx.stroke();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    function teleFan(ctx, x, y, ang, spread, n, len, k, t) {
      ctx.globalCompositeOperation = 'source-over';
      for (let i = 0; i < n; i++) {
        const a = ang + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0), x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
        ctx.globalAlpha = 0.45; ctx.strokeStyle = '#12001a'; ctx.lineWidth = 0.22; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
      }
      ctx.globalCompositeOperation = 'lighter';
      ctx.strokeStyle = k > 0.7 ? '#8f45ff' : '#9b5cff'; ctx.lineWidth = 0.06; ctx.globalAlpha = 0.3 + 0.6 * k;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const a = ang + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * len * (0.3 + 0.7 * k), y + Math.sin(a) * len * (0.3 + 0.7 * k)); }
      ctx.stroke();
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    }
    function drawTele(ctx, tl, t) {
      const k = U.clamp(tl.k || 0, 0, 1);
      if (tl.type === 'circle') teleCircle(ctx, tl.x, tl.y, tl.r, k, t, tl.hue);
      else if (tl.type === 'lane') teleLane(ctx, tl.x, tl.y, tl.ang, tl.len, tl.w, k, t);
      else if (tl.type === 'aim') teleAim(ctx, tl.x, tl.y, tl.x2, tl.y2, k, t);
      else if (tl.type === 'cone') teleCone(ctx, tl.x, tl.y, tl.ang, tl.len, tl.spread, k, t);
      else if (tl.type === 'fan') teleFan(ctx, tl.x, tl.y, tl.ang, tl.spread, tl.n, tl.len, k, t);
      else if (tl.type === 'multi') for (const s of tl.list) { s.k = tl.k; drawTele(ctx, s, t); }
    }

    /** dark casting circle on the ground (perspective-squashed, rotating, grows in with k) */
    function runeCircle(ctx, x, y, r, k, t, alpha) {
      if (!runeC) build();
      const rr = r * U.ease.outBack(Math.min(1, k * 1.8)), a0 = ctx.globalAlpha, rot = t * 1.4;
      if (rr <= 0.02) return;
      ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.5); ctx.rotate(rot);
      ctx.globalAlpha = a0 * (alpha == null ? 1 : alpha) * 0.95; ctx.drawImage(runeC, -rr, -rr, rr * 2, rr * 2);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a0 * (alpha == null ? 1 : alpha) * (0.25 + 0.35 * k) * (0.7 + 0.3 * Math.sin(t * 12));
      ctx.rotate(-rot * 2); ctx.drawImage(runeC, -rr * 0.7, -rr * 0.7, rr * 1.4, rr * 1.4);
      ctx.restore(); ctx.globalAlpha = a0;
    }
    function drawPortal(ctx, x, y, r, k, t) {
      const sc = k < 0.7 ? U.ease.outBack(Math.min(1, k / 0.35)) : 1 - (k - 0.7) / 0.3 * 0.6;
      const rr = Math.max(0.05, r * sc), a0 = ctx.globalAlpha;
      ctx.globalAlpha = a0 * 0.95; ctx.drawImage(portalSprite(), x - rr * 1.1, y - rr * 1.1, rr * 2.2, rr * 2.2); ctx.globalAlpha = a0;
      if (!reduced() && ((t * 60 | 0) + (x * 7 | 0)) % 6 === 0) api.smoke(x + U.rand(-rr, rr) * 0.7, y, 0.35);
    }

    /* ---- effect list ---- */
    function add(o) { if (list.length >= MAXFX) list.shift(); o.t = 0; list.push(o); return o; }
    const lastSfx = {};
    const api = {
      /** positional, crowd-throttled enemy SFX (force: bosses/elites always play) */
      sfx(name, x, y, force) {
        const now = performance.now(), gap = force ? 30 : 90;
        if (lastSfx[name] && now - lastSfx[name] < gap) return;
        if (!force && x != null && !G.render.onScreen(x, y, 4)) return;
        lastSfx[name] = now;
        G.audio.sfx(name, x != null ? { x, y } : undefined);
      },
      add, darkAura, auraLite, ownAura, drawTele, outlineSheet, teleCircle, teleLane, teleAim, drawPortal, silhouette,
      boulder() { if (!boulderC) build(); return boulderC; },
      clear() { list = []; },
      _count() { const o = {}; for (const f of list) o[f.k] = (o[f.k] || 0) + 1; return o; },
      ring(x, y, r, life, w, color) { return add({ k: 'ring', x, y, r, life: life || 0.5, w: w || 0.25, color: color || '#b04dff' }); },
      burst(x, y, r, frame) { return add({ k: 'burst', x, y, r, life: 0.55, f: frame == null ? U.randi(0, 3) : frame, rot: U.rand(0, U.TAU) }); },
      crater(x, y, r, life) { return add({ k: 'crater', x, y, r, life: life || 2.5, rot: U.rand(0, 3) }); },
      dust(x, y, r, color) { return add({ k: 'dust', x, y, r: r || 0.5, vx: U.rand(-0.8, 0.8), vy: U.rand(-0.6, 0.1), life: U.rand(0.45, 0.8), color: color || '#b8a58c' }); },
      smoke(x, y, r) { if (qlv() <= 1) return null; return add({ k: 'smoke', x, y, r: r || 0.4, vx: U.rand(-0.3, 0.3), vy: U.rand(-1.4, -0.7), life: U.rand(0.5, 0.9) }); },
      sparkle(x, y) { G.fx.particle && G.fx.particle({ x: x + U.rand(-0.4, 0.4), y: y + U.rand(-0.3, 0.3), vx: U.rand(-0.6, 0.6), vy: U.rand(-1.6, -0.6), life: 0.6, size: 0.1, color: '#ffe27a', glow: true }); },
      /** small black-purple wisp rising off an attacking enemy */
      wisp(x, y) { if (list.length > MAXFX - 60) return null; return add({ k: 'wisp', x, y, r: U.rand(0.18, 0.32), vx: U.rand(-0.25, 0.25), vy: U.rand(-1.8, -1.0), life: U.rand(0.45, 0.7) }); },
      runeCircle,
      /** expanding shockwave that pops normal enemies in order (boss finale); each dies when the wave reaches it */
      finale(R, x, y, speed, maxR) {
        for (const o of R.enemies) {
          if (o.dead || o.boss) continue; const d = U.dist(x, y, o.x, o.y);
          if (d < maxR) { o.dieAt = R.time + d / speed; o.dieSrc = 'finale'; }
        }
        api.ring(x, y, maxR, maxR / speed, 0.6, '#ffd27a');
      },
      debris(x, y, n, spd, size) {
        if (qlv() <= 1) n = Math.ceil(n / 2);
        for (let i = 0; i < n; i++) { const a = U.rand(0, U.TAU), s = U.rand(1.5, spd || 5); add({ k: 'chip', x, y, z: U.rand(0, 0.4), vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.7, vz: U.rand(4, 9), s: U.rand(0.18, 0.4) * (size || 1), rot: U.rand(0, 6), vr: U.rand(-12, 12), life: U.rand(0.7, 1.1) }); }
      },
      after(e, alpha, color) {
        const H = e.def.h * (e.scale || 1);
        return add({ k: 'after', x: e.x, y: e.y - (e.z || 0), atlas: e.def.atlas, h: H, row: G.render.dirRow(e.face.x, e.face.y), col: frameCol(e.pose ? POSE[e.pose] || e.anim : e.anim), life: 0.4, a: alpha || 0.6, color: color || '#8a3cff' });
      },
      slash(x, y, ang, r) { return add({ k: 'slash', x, y, ang, r, life: 0.24 }); },
      streak(x, y, color) { return add({ k: 'streak', x, y, life: 0.45, color: color || '#ff9a3d' }); },
      pop(x, y, color) {
        api.ring(x, y, 0.8, 0.25, 0.12);
        G.fx.burst && G.fx.burst(x, y, 6, color || '#c070ff', { max: 5, life: 0.3, size: 0.12 });
      },
      /** big boulder impact: shockwave, dark aura blast, debris, dust, crater, shake if near */
      rockImpact(x, y, r, size) {
        api.ring(x, y, r * 1.9, 0.5, 0.35); api.ring(x, y, r * 1.2, 0.3, 0.18, '#8f45ff');
        api.burst(x, y - 0.3, r * 1.05, 2); api.crater(x, y, r * 0.8, 3);
        api.debris(x, y, 9, 6, size); for (let i = 0; i < 7; i++) api.dust(x + U.rand(-r, r) * 0.7, y + U.rand(-r, r) * 0.4, U.rand(0.5, 0.9));
        G.fx.burst && G.fx.burst(x, y, 10, '#b04dff', { max: 7, life: 0.4, size: 0.16 });
        const p = G.run.player, d = U.dist(x, y, p.x, p.y);
        if (d < 7) G.fx.shake(0.45 * (1 - d / 7) + 0.1);
        api.sfx('rockImpact', x, y);
      },
      zoneImpact(h) {
        const st = h.style || 'slam', x = h.x, y = h.y, r = h.r;
        if (st === 'slam') {
          api.ring(x, y, r * 1.35, 0.5, 0.35); api.burst(x, y - 0.3, r * 0.9, 2); api.crater(x, y, r * 0.75, 2.5);
          api.debris(x, y, 8, 6); for (let i = 0; i < 6; i++) api.dust(x + U.rand(-r, r) * 0.8, y + U.rand(-r, r) * 0.5, 0.8);
          const p = G.run.player, d = U.dist(x, y, p.x, p.y); if (d < 9) G.fx.shake(0.4 * (1 - d / 9) + 0.12);
          api.sfx('rockImpact', x, y);
        } else if (st === 'missile') {
          api.ring(x, y, r * 1.3, 0.4, 0.3, '#ff7a3d'); api.burst(x, y - 0.2, r * 0.9, U.randi(0, 3)); api.crater(x, y, r * 0.6, 2);
          G.fx.burst && G.fx.burst(x, y, 12, '#ff8a3d', { max: 7, life: 0.45, size: 0.2 });
          G.fx.burst && G.fx.burst(x, y, 6, '#b04dff', { max: 5, life: 0.35 });
          const p = G.run.player, d = U.dist(x, y, p.x, p.y); if (d < 6) G.fx.shake(0.18);
          api.sfx('explosion', x, y);
        } else if (st === 'storm') {
          api.ring(x, y, r * 1.4, 0.45, 0.3, '#5cf2c8'); api.ring(x, y, r * 0.9, 0.35, 0.2);
          add({ k: 'gust', x, y, r, life: 0.6 });
          G.fx.burst && G.fx.burst(x, y, 10, '#7dffd8', { max: 8, life: 0.45, size: 0.15 });
          api.sfx('windBlast', x, y);
        } else if (st === 'spark') {
          api.ring(x, y, r * 1.3, 0.35, 0.25, h.color || '#c77dff');
          G.fx.burst && G.fx.burst(x, y, 12, h.color || '#d59bff', { max: 7, life: 0.35 });
          api.sfx(h.color && h.color.indexOf('9ff') >= 0 ? 'cryo' : 'electro', x, y);
        } else if (st === 'spin') { api.ring(x, y, r, 0.4, 0.3); }
      },
      update(dt) {
        for (let i = list.length - 1; i >= 0; i--) {
          const o = list[i]; o.t += dt;
          if (o.k === 'chip') {
            o.x += o.vx * dt; o.y += o.vy * dt; o.vz -= 22 * dt; o.z += o.vz * dt; o.rot += o.vr * dt;
            if (o.z < 0) { o.z = 0; if (o.vz < -3) { o.vz *= -0.35; o.vx *= 0.5; o.vy *= 0.5; o.vr *= 0.5; } else { o.vz = 0; o.vx *= 0.8; o.vy *= 0.8; } }
          } else if (o.k === 'suck') { const kk = o.t / o.life, rr = o.r0 * (1 - U.ease.inCubic(kk) * 0.95), a = o.a + kk * 1.6; o.px = o.x; o.py = o.y; o.x = o.tx.x + Math.cos(a) * rr; o.y = o.tx.y + Math.sin(a) * rr * 0.8; if (o.t < dt * 1.5) { o.px = o.x; o.py = o.y; }
          } else if (o.k === 'dust' || o.k === 'smoke' || o.k === 'wisp') { o.x += o.vx * dt; o.y += o.vy * dt; o.vx *= 0.96; }
          if (o.t >= o.life) { list[i] = list[list.length - 1]; list.pop(); }
        }
      },
      drawGround(ctx) {
        const R = G.run; if (!R) return; const t = R.time;
        if (!discC) build();
        for (const o of list) {
          const k = o.t / o.life;
          if (o.k === 'crater') {
            ctx.globalAlpha = 0.55 * (1 - k * k); ctx.fillStyle = '#1a0f14';
            ctx.beginPath(); ctx.ellipse(o.x, o.y, o.r, o.r * 0.62, 0, 0, U.TAU); ctx.fill();
            ctx.strokeStyle = '#2a0a36'; ctx.lineWidth = 0.06; ctx.beginPath();
            for (let j = 0; j < 6; j++) { const a = o.rot + j * 1.05; ctx.moveTo(o.x + Math.cos(a) * o.r * 0.6, o.y + Math.sin(a) * o.r * 0.37); ctx.lineTo(o.x + Math.cos(a) * o.r * 1.35, o.y + Math.sin(a) * o.r * 0.84); }
            ctx.stroke();
          } else if (o.k === 'ring') {
            const e = U.ease.outCubic(k), rr = o.r * (0.25 + 0.75 * e);
            ctx.globalAlpha = 0.6 * (1 - k); ctx.strokeStyle = '#0e0016'; ctx.lineWidth = o.w * (1 - k * 0.6) * 1.8;
            ctx.beginPath(); ctx.ellipse(o.x, o.y, rr, rr * 0.62, 0, 0, U.TAU); ctx.stroke();
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.9 * (1 - k); ctx.strokeStyle = o.color; ctx.lineWidth = o.w * 0.5 * (1 - k);
            ctx.beginPath(); ctx.ellipse(o.x, o.y, rr, rr * 0.62, 0, 0, U.TAU); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
          }
        }
        ctx.globalAlpha = 1;
        // dark casting circles under enemies that are channelling
        for (const e of R.enemies) {
          const c = e.charge; if (!c || e.dead || !RUNE_R[c.type]) continue;
          if (!G.render.onScreen(e.x, e.y, 4)) continue;
          runeCircle(ctx, e.x, e.y, RUNE_R[c.type] * (e.scale || 1), c.k || 0, t + e.id, 1);
        }
        // telegraphs owned by enemies (vanish if the attacker dies)
        for (const e of R.enemies) if (!e.dead && e.tele && e.spawnT <= 0) drawTele(ctx, e.tele, t);
        // hazards: ground layer
        for (const h of R.hazards) {
          if (!G.render.onScreen(h.x, h.y, (h.r || 1) + 12)) continue;
          const ty = h.type;
          if (ty === 'zone') {
            if (!h.fired) teleCircle(ctx, h.x, h.y, h.r, h.delay > 0 ? h.t / h.delay : 1, t, h.style === 'storm' ? '#1f7a6a' : h.style === 'missile' ? '#8a2f1a' : h.hue);
            else if (h.persist) {
              ctx.globalAlpha = 0.35; ctx.fillStyle = '#16001f'; ctx.beginPath(); ctx.arc(h.x, h.y, h.r, 0, U.TAU); ctx.fill(); ctx.globalAlpha = 1;
            }
          } else if (ty === 'beam') {
            ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(h.ang);
            ctx.globalAlpha = 0.55; ctx.fillStyle = '#12000c'; ctx.fillRect(0.6, -h.w * 0.65, h.len, h.w * 1.3);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t * 30); ctx.fillStyle = '#ff6a2a'; ctx.fillRect(0.6, -h.w * 0.3, h.len, h.w * 0.6);
            ctx.restore(); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          } else if (ty === 'lane') teleLane(ctx, h.x, h.y, h.ang, h.len, h.w, Math.min(1, h.t / h.life), t);
          else if (ty === 'rock') {
            if (h.t >= h.delay) {
              const k = Math.min(1, (h.t - h.delay) / h.life);
              teleCircle(ctx, h.x1, h.y1, h.r, (h.k0 || 0) + (1 - (h.k0 || 0)) * k, t);
              const zs = 1 - Math.min(1, h.z / (h.peak + 2));
              ctx.globalAlpha = 0.25 + 0.4 * zs; ctx.fillStyle = '#05000a';
              ctx.beginPath(); ctx.ellipse(h.x, h.y, 0.35 + 0.55 * zs * (h.size || 1), (0.35 + 0.55 * zs) * 0.45, 0, 0, U.TAU); ctx.fill(); ctx.globalAlpha = 1;
            }
          } else if (ty === 'wave' && h.t >= h.delay) {
            const k = (h.t - h.delay) / h.life, rr = h.cr || 0.1;
            ctx.globalAlpha = 0.55 * (1 - k * 0.5); ctx.strokeStyle = '#12001a'; ctx.lineWidth = (h.w || 0.6) * 1.6;
            ctx.beginPath(); ctx.arc(h.x, h.y, rr, 0, U.TAU); ctx.stroke();
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.8 * (1 - k * 0.6); ctx.strokeStyle = h.color || '#c05cff'; ctx.lineWidth = 0.09;
            ctx.beginPath(); ctx.arc(h.x, h.y, rr + (h.w || 0.6) * 0.6, 0, U.TAU); ctx.stroke();
            ctx.beginPath(); ctx.arc(h.x, h.y, Math.max(0.05, rr - (h.w || 0.6) * 0.6), 0, U.TAU); ctx.stroke();
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          } else if (ty === 'tornado') {
            if (h.t < h.delay) teleCircle(ctx, h.x, h.y, h.r * 1.6, h.t / h.delay, t, '#1f7a6a');
            else {
              ctx.globalAlpha = 0.35; ctx.strokeStyle = '#1a0026'; ctx.lineWidth = 0.08; ctx.setLineDash([0.4, 0.4]); ctx.lineDashOffset = t * 3;
              ctx.beginPath(); ctx.arc(h.x, h.y, h.pullR || 6, 0, U.TAU); ctx.stroke(); ctx.setLineDash([]);
              ctx.globalAlpha = 0.5; ctx.fillStyle = '#0a0010'; ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r * 1.3, h.r * 0.6, 0, 0, U.TAU); ctx.fill(); ctx.globalAlpha = 1;
            }
          } else if (ty === 'ringTele') {
            const k = h.t / h.life;
            ctx.globalAlpha = 0.35 + 0.4 * k; ctx.strokeStyle = '#12001a'; ctx.lineWidth = 0.5;
            for (const seg of h.segs) { ctx.beginPath(); ctx.arc(h.x, h.y, h.r, seg[0], seg[1]); ctx.stroke(); }
            ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = k > 0.7 ? '#8f45ff' : '#9b5cff'; ctx.lineWidth = 0.1; ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t * 16);
            for (const seg of h.segs) { ctx.beginPath(); ctx.arc(h.x, h.y, h.r, seg[0], seg[1]); ctx.stroke(); }
            ctx.strokeStyle = '#7dffd8'; ctx.globalAlpha = 0.6; ctx.lineWidth = 0.08;
            for (const g of h.gaps) { ctx.beginPath(); ctx.arc(h.x, h.y, h.r, g - h.gapW * 0.5, g + h.gapW * 0.5); ctx.stroke(); }
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          }
        }
      },
      drawAir(ctx) {
        const R = G.run; if (!R) return; const t = R.time;
        if (!discC) build();
        const many = R.hazards.length > 90;
        for (const h of R.hazards) {
          if (!G.render.onScreen(h.x, h.y, 3)) continue;
          const ty = h.type, lift = h.lift || 0, gy = h.y;
          if (lift && (ty === 'arrow' || ty === 'orb' || ty === 'bullet' || ty === 'wind')) {
            ctx.globalAlpha = 0.35; ctx.fillStyle = '#05000a'; ctx.beginPath(); ctx.ellipse(h.x, gy, h.r * 0.9, h.r * 0.4, 0, 0, U.TAU); ctx.fill(); ctx.globalAlpha = 1;
            h.y -= lift;
          }
          if (ty === 'arrow' && h.t >= h.delay) {
            const a = Math.atan2(h.vy, h.vx), c = Math.cos(a), s = Math.sin(a);
            // dark smoky trail
            ctx.globalAlpha = 0.5; ctx.strokeStyle = '#12001a'; ctx.lineWidth = 0.22; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(h.x - c * 2.2, h.y - s * 2.2); ctx.lineTo(h.x, h.y); ctx.stroke();
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7; ctx.strokeStyle = '#a24dff'; ctx.lineWidth = 0.07;
            ctx.beginPath(); ctx.moveTo(h.x - c * 1.6, h.y - s * 1.6); ctx.lineTo(h.x, h.y); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
            auraLite(ctx, h.x - c * 0.2, h.y - s * 0.2, 0.55, t + h.seed, 1);
            ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(a); ctx.scale(1.35, 1.35); ctx.globalAlpha = 1;
            ctx.strokeStyle = '#2b1a10'; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.moveTo(-0.7, 0); ctx.lineTo(0.2, 0); ctx.stroke();
            ctx.fillStyle = '#e8c6ff'; ctx.beginPath(); ctx.moveTo(0.42, 0); ctx.lineTo(0.12, -0.13); ctx.lineTo(0.12, 0.13); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#5a1f86'; ctx.beginPath(); ctx.moveTo(-0.72, 0); ctx.lineTo(-0.52, -0.14); ctx.lineTo(-0.44, 0); ctx.lineTo(-0.52, 0.14); ctx.closePath(); ctx.fill();
            ctx.restore(); ctx.lineCap = 'butt';
          } else if (ty === 'orb' && h.t >= h.delay) {
            const pr = h.r * (1 + 0.1 * Math.sin(t * 14 + h.seed));
            darkAura(ctx, h.x, h.y, h.r * 1.35, t + h.seed, 1);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.95;
            ctx.drawImage(G.assets.glow(h.color || '#3fa9ff', 64), h.x - pr * 1.6, h.y - pr * 1.6, pr * 3.2, pr * 3.2);
            ctx.fillStyle = '#e6f6ff'; ctx.globalAlpha = 0.9; ctx.beginPath(); ctx.arc(h.x, h.y, pr * 0.32, 0, U.TAU); ctx.fill();
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          } else if ((ty === 'bullet' || ty === 'wind')) {
            const born = h.t < h.delay ? h.t / Math.max(0.01, h.delay) : 1;
            const a = Math.atan2(h.vy, h.vx), rr = h.r * (0.4 + 0.6 * born);
            auraLite(ctx, h.x, h.y, rr * 1.5, t + h.seed, born);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = born;
            if (ty === 'wind') {
              ctx.save(); ctx.translate(h.x, h.y); ctx.rotate(a);
              ctx.drawImage(G.assets.glow(h.color || '#5cf2c8', 64), -rr * 2.4, -rr * 1.1, rr * 4, rr * 2.2);
              ctx.fillStyle = '#eafff8'; ctx.beginPath(); ctx.moveTo(rr * 1.4, 0); ctx.lineTo(-rr * 0.8, -rr * 0.42); ctx.lineTo(-rr * 0.5, 0); ctx.lineTo(-rr * 0.8, rr * 0.42); ctx.closePath(); ctx.fill();
              ctx.restore();
            } else {
              ctx.drawImage(G.assets.glow(h.color || '#c070ff', 32), h.x - rr * 1.5, h.y - rr * 1.5, rr * 3, rr * 3);
              ctx.fillStyle = '#fbeaff'; ctx.beginPath(); ctx.arc(h.x, h.y, rr * 0.38, 0, U.TAU); ctx.fill();
            }
            ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
          } else if (ty === 'rock' && h.t >= h.delay) {
            const sz = 1.15 * (h.size || 1), y = h.y - h.z - 0.3;
            { // dark smoky trail along the arc
              const kk = Math.min(1, (h.t - h.delay) / h.life), kp = Math.max(0, kk - 0.14);
              const px = U.lerp(h.x0, h.x1, kp), pz = (h.h0 || 0) * (1 - kp) + h.peak * 4 * kp * (1 - kp), py = U.lerp(h.y0, h.y1, kp) - pz - 0.3;
              ctx.lineCap = 'round'; ctx.globalAlpha = 0.45; ctx.strokeStyle = '#0e0016'; ctx.lineWidth = sz * 0.8;
              ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(h.x, y); ctx.stroke();
              ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55; ctx.strokeStyle = '#9b3cff'; ctx.lineWidth = sz * 0.22;
              ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(h.x, y); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
            }
            darkAura(ctx, h.x, y, sz * 0.85, t + h.seed, 1);
            ctx.translate(h.x, y); ctx.rotate(h.rot); ctx.drawImage(api.boulder(), -sz / 2, -sz / 2, sz, sz); ctx.rotate(-h.rot); ctx.translate(-h.x, -y);
            if (!many && U.chance(0.6)) api.smoke(h.x + U.rand(-0.2, 0.2), y, 0.35);
          } else if (ty === 'zone' && h.style === 'missile' && !h.fired && h.t > h.delay - 0.45) {
            const k = 1 - (h.delay - h.t) / 0.45, z = (1 - k) * 12;
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ff9a3d'; ctx.lineWidth = 0.12;
            ctx.beginPath(); ctx.moveTo(h.x, h.y - z - 2.5); ctx.lineTo(h.x, h.y - z); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
            auraLite(ctx, h.x, h.y - z, 0.45, t + h.seed, 1);
            ctx.fillStyle = '#3a2a22'; ctx.beginPath(); ctx.ellipse(h.x, h.y - z, 0.16, 0.4, 0, 0, U.TAU); ctx.fill();
            ctx.globalCompositeOperation = 'lighter'; ctx.drawImage(G.assets.glow('#ff8a3d', 32), h.x - 0.4, h.y - z + 0.1, 0.8, 0.8); ctx.globalCompositeOperation = 'source-over';
            ctx.globalAlpha = 1;
          } else if (ty === 'zone' && h.style === 'spin' && h.fired && h.persist) {
            const a0 = t * 11; ctx.lineCap = 'round';
            for (let j = 0; j < 2; j++) {
              const a = a0 + j * Math.PI;
              ctx.globalAlpha = 0.5; ctx.strokeStyle = '#12001a'; ctx.lineWidth = 0.6;
              ctx.beginPath(); ctx.arc(h.x, h.y - 1.2, h.r * 0.85, a - 0.9, a); ctx.stroke();
              ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.8; ctx.strokeStyle = '#ff7a3d'; ctx.lineWidth = 0.14;
              ctx.beginPath(); ctx.arc(h.x, h.y - 1.2, h.r * 0.85, a - 0.7, a); ctx.stroke();
              ctx.strokeStyle = '#c05cff'; ctx.lineWidth = 0.08; ctx.beginPath(); ctx.arc(h.x, h.y - 1.2, h.r * 0.95, a - 0.5, a); ctx.stroke();
              ctx.globalCompositeOperation = 'source-over';
            }
            ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
          } else if (ty === 'beam') {
            const f = h.follow, H = f.def.h * (f.scale || 1), ex = f.x, ey = f.y - (f.z || 0) - H * 0.64, c = Math.cos(h.ang), s = Math.sin(h.ang);
            const x2 = h.x + c * h.len, y2 = h.y + s * h.len, fl = 0.8 + 0.2 * Math.sin(t * 40), kin = Math.min(1, h.t / 0.12);
            ctx.lineCap = 'round';
            ctx.globalAlpha = 0.7 * kin; ctx.strokeStyle = '#0e0012'; ctx.lineWidth = h.w * 1.5; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.6 * kin; ctx.strokeStyle = '#9b3cff'; ctx.lineWidth = h.w * 1.1 * fl; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.globalAlpha = 0.9 * kin; ctx.strokeStyle = '#ff7a2a'; ctx.lineWidth = h.w * 0.6 * fl; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.globalAlpha = kin; ctx.strokeStyle = '#fff2c8'; ctx.lineWidth = h.w * 0.18; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.drawImage(G.assets.glow('#ff8a3d', 64), ex - 1.2, ey - 1.2, 2.4, 2.4);
            ctx.drawImage(G.assets.glow('#ff8a3d', 64), x2 - 1.5, y2 - 1.5, 3, 3);
            ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt'; ctx.globalAlpha = 1;
            auraLite(ctx, x2, y2, 1.1, t * 2, 0.9);
          } else if (ty === 'push' && h.inhale) {
            const k = Math.min(1, h.t / 0.3) * Math.min(1, (h.life - h.t) / 0.3);
            darkAura(ctx, h.x, h.y - 0.1, 1.6 + 0.2 * Math.sin(t * 8), t, 0.5 * k);
            ctx.globalAlpha = 0.3 * k; ctx.strokeStyle = '#12001a'; ctx.lineWidth = 0.1; ctx.setLineDash([0.5, 0.35]); ctx.lineDashOffset = t * 6;
            ctx.beginPath(); ctx.ellipse(h.x, h.y, h.r * 0.75, h.r * 0.6, 0, 0, U.TAU); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
          } else if (ty === 'tornado' && h.t >= h.delay) {
            const k = Math.min(1, (h.t - h.delay) / 0.4), fade = Math.min(1, (h.delay + h.life - h.t) / 0.4), al = k * fade;
            darkAura(ctx, h.x, h.y - 0.6, h.r * 1.6, t + h.seed, al * 0.9);
            const sheet = G.assets.img.icon_vfx_wind;
            if (sheet) {
              const cs = sheet.width / 4;
              ctx.globalCompositeOperation = 'lighter';
              for (let j = 0; j < 5; j++) {
                const f = (Math.floor(t * 12) + j) % 8, ly = h.y - 0.3 - j * 0.75, w = (0.9 + j * 0.45) * h.r * 1.2;
                ctx.globalAlpha = al * 0.75;
                ctx.save(); ctx.translate(h.x + Math.sin(t * 5 + j) * 0.15, ly); ctx.rotate(t * 9 + j * 1.3); ctx.scale(1, 0.45);
                ctx.drawImage(sheet, (f & 3) * cs, (f >> 2) * cs, cs, cs, -w, -w, w * 2, w * 2); ctx.restore();
              }
              ctx.globalCompositeOperation = 'source-over';
            }
            ctx.globalAlpha = al * 0.55; ctx.strokeStyle = '#1a0026'; ctx.lineWidth = 0.12;
            for (let j = 0; j < 4; j++) { const ly = h.y - 0.4 - j * 0.8, w = (0.7 + j * 0.4) * h.r; ctx.beginPath(); ctx.ellipse(h.x, ly, w, w * 0.3, 0, t * 6 + j, t * 6 + j + 3.5); ctx.stroke(); }
            ctx.globalAlpha = 1;
          }
          h.y = gy;
        }
        // effects (air)
        const sheet = auraSheet(), lowq = qlv() <= 1;
        for (const o of list) {
          const k = o.t / o.life;
          if (o.k === 'chip') {
            ctx.globalAlpha = 0.35; ctx.fillStyle = '#000'; ctx.beginPath(); ctx.ellipse(o.x, o.y, o.s * 0.5, o.s * 0.2, 0, 0, U.TAU); ctx.fill();
            ctx.globalAlpha = Math.min(1, (1 - k) * 3);
            const cy = o.y - o.z; ctx.translate(o.x, cy); ctx.rotate(o.rot); ctx.drawImage(chipC, -o.s / 2, -o.s / 2, o.s, o.s); ctx.rotate(-o.rot); ctx.translate(-o.x, -cy);
          } else if (o.k === 'dust') {
            ctx.globalAlpha = 0.45 * (1 - k); ctx.fillStyle = o.color; ctx.beginPath(); ctx.arc(o.x, o.y - 0.2, o.r * (0.6 + k), 0, U.TAU); ctx.fill();
          } else if (o.k === 'smoke') {
            if (lowq) continue;
            ctx.globalAlpha = 0.5 * (1 - k); ctx.drawImage(discC, o.x - o.r * (1 + k), o.y - o.r * (1 + k), o.r * 2 * (1 + k), o.r * 2 * (1 + k));
          } else if (o.k === 'suck') {
            if (o.px == null) continue;
            const ex = o.x + (o.x - o.px) * -6, ey = o.y + (o.y - o.py) * -6;
            ctx.lineCap = 'round'; ctx.globalAlpha = 0.5 * Math.sin(k * Math.PI); ctx.strokeStyle = '#12001a'; ctx.lineWidth = 0.2;
            ctx.beginPath(); ctx.moveTo(ex, ey - 0.5); ctx.lineTo(o.x, o.y - 0.5); ctx.stroke();
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.85 * Math.sin(k * Math.PI); ctx.strokeStyle = '#7dffd8'; ctx.lineWidth = 0.07;
            ctx.beginPath(); ctx.moveTo(ex, ey - 0.5); ctx.lineTo(o.x, o.y - 0.5); ctx.stroke(); ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt';
          } else if (o.k === 'wisp') {
            const rr = o.r * (1 - k * 0.5);
            ctx.globalAlpha = 0.6 * (1 - k); ctx.drawImage(discC, o.x - rr * 1.3, o.y - rr * 1.6, rr * 2.6, rr * 3.2);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6 * (1 - k); ctx.drawImage(G.assets.glow('#9b3cff', 32), o.x - rr * 0.5, o.y - rr * 0.5, rr, rr); ctx.globalCompositeOperation = 'source-over';
          } else if (o.k === 'burst' && sheet) {
            const rr = o.r * (0.7 + 0.6 * U.ease.outCubic(k)), ro = o.rot + k * 0.6;
            ctx.globalAlpha = 1 - k * k;
            ctx.translate(o.x, o.y); ctx.rotate(ro);
            ctx.drawImage(sheet, (o.f & 1) * 128, (o.f >> 1) * 128, 128, 128, -rr, -rr, rr * 2, rr * 2); ctx.rotate(-ro); ctx.translate(-o.x, -o.y);
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.7 * (1 - k); ctx.drawImage(rimC, o.x - rr, o.y - rr, rr * 2, rr * 2); ctx.globalCompositeOperation = 'source-over';
          } else if (o.k === 'after') {
            ctx.globalCompositeOperation = 'source-over';
            drawSil(ctx, o.atlas, o.color, o.x, o.y, o.h, o.row, o.col, 1, 1, o.a * (1 - k));
          } else if (o.k === 'slash') {
            const sw = U.ease.outCubic(Math.min(1, k * 1.6)), a0 = o.ang - 1.1, a1 = a0 + 2.2 * sw;
            ctx.lineCap = 'round'; ctx.globalAlpha = 0.75 * (1 - k); ctx.strokeStyle = '#12001a'; ctx.lineWidth = 0.42;
            ctx.beginPath(); ctx.arc(o.x, o.y, o.r, a0, a1); ctx.stroke();
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k; ctx.strokeStyle = '#c05cff'; ctx.lineWidth = 0.14;
            ctx.beginPath(); ctx.arc(o.x, o.y, o.r, a0 + 0.2, a1); ctx.stroke();
            ctx.strokeStyle = '#cfa8ff'; ctx.lineWidth = 0.05; ctx.beginPath(); ctx.arc(o.x, o.y, o.r * 1.05, a0 + 0.5, a1); ctx.stroke();
            ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt';
          } else if (o.k === 'streak') {
            const y = o.y - 2 - k * 14;
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k; ctx.strokeStyle = o.color; ctx.lineWidth = 0.14;
            ctx.beginPath(); ctx.moveTo(o.x, y); ctx.lineTo(o.x, y + 2.2); ctx.stroke(); ctx.globalCompositeOperation = 'source-over';
            auraLite(ctx, o.x, y, 0.4, o.t * 10, 1 - k);
          } else if (o.k === 'gust') {
            const ws = G.assets.img.icon_vfx_wind; if (!ws) continue;
            const cs = ws.width / 4, f = Math.min(7, Math.floor(k * 8)), w = o.r * 1.6;
            ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 1 - k * 0.5;
            ctx.drawImage(ws, (f & 3) * cs, (f >> 2) * cs, cs, cs, o.x - w, o.y - w * 1.2, w * 2, w * 2); ctx.globalCompositeOperation = 'source-over';
          }
        }
        ctx.globalAlpha = 1;
      },
    };
    return api;
  })();
  G.enemyFx = FX;

  return { initRun, spawn, kill, update, hazard, growth, drawEnemy, drawGround, drawAir, frameCol, drawSil };
})();
