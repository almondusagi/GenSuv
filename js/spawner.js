/* spawner.js — stage director: continuous horde spawning, horde surges, minute mini-bosses, bosses, victory.
   Flow (Mondstadt): hilichurls & slimes → archers/chargers → rock throwers & elemental slimes → 5:00 Ruin Guard
   (horde thins) → heavier mixes, champions, surges → 10:00 Venti (horde blown away, trickle only) → victory. */
'use strict';
G.spawner = (function () {
  const U = G.u;
  const HARD_CAP = 232;
  function initRun(R) { R.spawn = { acc: 0, evIdx: 0, finalPhase: false, warned: {}, enraged: false, alive: 0, powerK: powerK() }; }
  /** 0..1 — how much of the home-upgrade power curve this save owns (offense-weighted). A strong save gets a bigger,
      faster horde (rate ×(1+2.4k), cap ×(1+1.3k)) so maxed runs fill the screen instead of running out of targets. */
  const POWER_W = { power: 3, haste: 3, multishot: 3, range: 1, crit_rate: 1, crit_damage: 1, ks_fire: 1, wisdom: 1, vitality: 1 };
  function powerK() {
    const M = (G.save && G.save.data.meta) || {}; let have = 0, tot = 0;
    for (const k in POWER_W) { const d = G.data.meta[k]; if (!d) continue; tot += POWER_W[k]; have += POWER_W[k] * Math.min(1, (M[k] || 0) / d.max); }
    const c = G.progression && G.progression.constellationLevel ? G.progression.constellationLevel() / 6 : 0;
    return U.clamp((have + c) / (tot + 1), 0, 1);
  }

  function interp(list, t) {
    for (let i = 1; i < list.length; i++) if (t <= list[i][0]) { const a = list[i - 1], b = list[i], f = (t - a[0]) / (b[0] - a[0]); return [U.lerp(a[1], b[1], f), U.lerp(a[2], b[2], f)]; }
    const b = list[list.length - 1]; return [b[1], b[2]];
  }
  function interp1(list, t) {
    for (let i = 1; i < list.length; i++) if (t <= list[i][0]) { const a = list[i - 1], b = list[i], f = (t - a[0]) / (b[0] - a[0]); return U.lerp(a[1], b[1], f); }
    return list[list.length - 1][1];
  }
  const poolCache = new Map();
  function mixAt(stage, t) {
    let m = stage.mixes[0][1]; for (const [time, mix] of stage.mixes) if (t >= time) m = mix;
    let pool = poolCache.get(m); if (!pool) { pool = Object.keys(m).map(k => [k, m[k]]); poolCache.set(m, pool); }
    return pool;
  }

  /** a point on a ring around the player, biased towards the movement direction */
  function ringPoint(R, dist) {
    const p = R.player; const he = G.render.halfExtents();
    let a = U.rand(0, U.TAU);
    const mv = Math.hypot(p.vx, p.vy); if (mv > 0.5 && U.chance(0.45)) a = Math.atan2(p.vy, p.vx) + U.rand(-0.9, 0.9);
    const d = dist || Math.max(he.x, he.y) + U.rand(1.5, 4);
    return { x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d };
  }

  function countAlive(R) { let n = 0; const es = R.enemies; for (let i = 0; i < es.length; i++) if (!es[i].dead) n++; return n; }

  /* surge bookkeeping: wipe a whole surge quickly → 群れボーナス (chest + mora shower) */
  let surgeSeq = 1;
  function surge(R, ev) {
    const p = R.player, room = Math.max(0, HARD_CAP + 20 - countAlive(R)), n = Math.min(ev.count, room);
    const S = R.spawn, sg = { id: surgeSeq++, left: 0, total: 0, until: R.time + (ev.bonusT || 40), done: false };
    S.surges = S.surges || []; S.surges.push(sg);
    const opt = { fast: true, surge: sg };
    const put = (kind, x, y, o) => { const e = G.enemies.spawn(R, kind, x, y, o || opt); if (e) { sg.left++; sg.total++; } return e; };
    if (ev.surge === 'wall') { // tsunami: a long wall marching straight across the screen
      const mv = Math.hypot(p.vx, p.vy), base = (mv > 0.5 ? Math.atan2(p.vy, p.vx) : U.rand(0, U.TAU)), c = Math.cos(base), sn = Math.sin(base);
      const rows = ev.rows || 2, per = Math.ceil(n / rows), span = ev.span || 26, march = { x: -c, y: -sn, t: ev.marchT || 7 };
      const mo = { fast: true, surge: sg, march };
      for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
        const off = (i / Math.max(1, per - 1) - 0.5) * span + (r & 1) * 0.5, d = ev.radius + r * 1.2;
        put(U.pick(ev.kinds), p.x + c * d - sn * off, p.y + sn * d + c * off, mo);
      }
    } else if (ev.surge === 'ring') {
      const off = U.rand(0, U.TAU);
      for (let i = 0; i < n; i++) {
        const a = off + i / n * U.TAU, r = ev.radius + (i & 1) * 0.8;
        put(U.pick(ev.kinds), p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
      }
    } else { // arc: a marching front from one side (ahead of the player's movement if moving)
      const mv = Math.hypot(p.vx, p.vy), base = mv > 0.5 ? Math.atan2(p.vy, p.vx) : U.rand(0, U.TAU);
      for (let i = 0; i < n; i++) {
        const row = i % 2, a = base + ((i >> 1) / Math.max(1, (n >> 1) - 1) - 0.5) * 1.6, r = ev.radius + row * 1.4;
        put(U.pick(ev.kinds), p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
      }
    }
    // one golden champion rides along with every big surge (drops a chest)
    if (n >= 20 && ev.golden !== false) { const a = U.rand(0, U.TAU); put(ev.kinds[0], p.x + Math.cos(a) * (ev.radius + 2), p.y + Math.sin(a) * (ev.radius + 2), { fast: true, surge: sg, champion: true, reward: 'common' }); }
    G.bus.emit('notice', { text: ev.notice, color: ev.color || '#ff7a9a' });
    G.bus.emit('stageEvent', { kind: 'surge', text: ev.notice, color: ev.color || '#ff7a9a', time: ev.time });
    G.audio.sfx('bossWarning');
  }

  /** the god arrives: the whole horde is blown away (rewards drop — a last shower of loot) */
  function blowAway(R) {
    const p = R.player;
    for (const e of R.enemies) {
      if (e.dead || (e.boss && e.def.final)) continue;
      if (e.boss) { // an older boss is torn apart by the god's gust — it still drops its reward
        G.enemyFx.burst(e.x, e.y - 2, 4.5, 2); G.enemyFx.ring(e.x, e.y, 5, 0.8, 0.4, '#5cf2c8'); G.enemyFx.debris(e.x, e.y, 14, 8, 1.2);
        G.enemies.kill(R, e, 'wind'); continue;
      }
      if (G.render.onScreen(e.x, e.y, 2)) { G.enemyFx.ring(e.x, e.y, 1.2, 0.4, 0.12, '#5cf2c8'); G.enemies.kill(R, e, 'wind'); }
      else e.dead = true;
    }
    R.hazards.length = 0;
    G.enemyFx.ring(p.x, p.y, 14, 1.0, 0.6, '#5cf2c8');
    G.fx.flash && G.fx.flash('#e8fff8', 0.5); G.fx.shake(0.6);
    G.audio.sfx('windBlast');
  }

  /** a treasure-carrying hilichurl that runs away — catch it for a chest */
  function treasure(R, ev) {
    const pt = ringPoint(R, 9);
    const e = G.enemies.spawn(R, ev.kind || 'mote', pt.x, pt.y, { champion: true, treasure: true, treasureT: ev.escape || 22, reward: ev.reward || 'exquisite', hpMul: ev.hpMul || 0.6 });
    if (e) { e.dmg *= 0.3; }
    G.bus.emit('notice', { text: ev.notice || '宝箱ヒルチャールだ！ にがすな！', color: '#ffd24a' });
    G.audio.sfx('star');
  }
  G.bus.on('enemyKilled', ev => {
    const e = ev && ev.enemy, sg = e && e.surge, R = G.run; if (!sg || sg.done || !R) return;
    if (--sg.left > 0) return;
    sg.done = true;
    if (R.time > sg.until || sg.total < 12) return;
    G.loot.add(R, { type: 'chest', x: e.x, y: e.y, tier: sg.total >= 40 ? 'exquisite' : 'common', vz: 9 });
    for (let i = 0; i < 6; i++) G.loot.add(R, { type: 'mora', x: e.x + U.rand(-1, 1), y: e.y + U.rand(-1, 1), value: 10 + Math.floor(sg.total / 4), vz: U.rand(5, 9) });
    G.bus.emit('notice', { text: '群れボーナス！ ぜんめつ ' + sg.total + '体！', color: '#ffd24a' });
    G.enemyFx.ring(e.x, e.y, 4, 0.6, 0.4, '#ffd24a');
    G.fx.burst && G.fx.burst(e.x, e.y - 0.6, 24, '#ffe27a', { max: 9, life: 0.8, stars: true });
    G.audio.sfx('comboUp');
  });

  function update(R, dt) {
    const st = G.data.stages[R.stageId], t = R.time, S = R.spawn;
    // scripted events
    while (S.evIdx < st.events.length && t >= st.events[S.evIdx].time) {
      const ev = st.events[S.evIdx++];
      if (ev.surge) { surge(R, ev); continue; }
      if (ev.treasure) { treasure(R, ev); continue; }
      if (ev.final) { S.finalPhase = true; blowAway(R); }
      const n = ev.count || 1;
      for (let i = 0; i < n; i++) {
        let pt;
        if (ev.boss) { // rise in view, in front of the player
          const p = R.player, f = Math.hypot(p.face.x, p.face.y) > 0.1 ? p.face : { x: 0, y: -1 };
          const d = ev.kind === 'venti' ? 6.5 : 7.5;
          pt = { x: p.x + f.x * d, y: p.y + f.y * d * 0.8 };
        } else pt = n > 1 ? ringPoint(R, 10 + i) : ringPoint(R, 9.5);
        G.enemies.spawn(R, ev.kind, pt.x, pt.y, { hpMul: ev.hpMul, dmgMul: ev.dmgMul, reward: i === 0 ? ev.reward : (ev.reward === 'exquisite' ? 'common' : ev.reward), relic: ev.relic && i === 0 });
      }
      G.bus.emit('stageEvent', ev);
    }
    // pre-warnings 5 seconds ahead of bosses
    for (const ev of st.events) if (ev.boss && !S.warned[ev.time] && t >= ev.time - 5 && t < ev.time) { S.warned[ev.time] = true; G.bus.emit('bossWarning', ev); G.audio.sfx('bossWarning'); }
    // continuous horde
    let [rate, cap] = interp(st.waves, Math.min(t, st.duration));
    const pk = S.powerK || 0; rate *= 1 + 2.4 * pk; cap *= 1 + 1.3 * pk;
    const midBoss = R.boss && !R.boss.dead && !R.boss.def.final && t - (R.boss.bornT || t) < 75; // horde thins for the first 75 s of the fight
    if (S.finalPhase) { rate *= 0.12; cap = 30; }
    else if (midBoss) { rate *= 0.35; cap *= 0.45; }
    // "never an empty screen": if very few are alive, spawn faster
    const alive = S.alive = countAlive(R);
    if (!S.finalPhase && alive < cap * 0.35) rate *= 1.6 + 0.8 * pk;
    cap = Math.min(cap, HARD_CAP);
    if (alive < cap) {
      S.acc += rate * dt;
      const pool = mixAt(st, t);
      const champ = st.champion ? interp1(st.champion, t) : 0;
      let budget = cap - alive;
      while (S.acc >= 1 && budget > 0) {
        S.acc -= 1;
        // occasionally spawn a small pack for a "wave" feeling
        const pack = U.chance(0.12) ? U.randi(4, 8) : 1;
        const kind = U.weighted(pool);
        const c = ringPoint(R);
        for (let i = 0; i < pack && budget > 0; i++, budget--) {
          G.enemies.spawn(R, kind, c.x + U.rand(-1.2, 1.2), c.y + U.rand(-1.2, 1.2), { champion: !S.finalPhase && champ > 0 && U.chance(champ) });
        }
      }
    } else S.acc = 0;
    if (R.victoryAt && t >= R.victoryAt && !R.over) G.game.end(true, 'clear');
    // enrage timer for the final boss (13:00)
    if (S.finalPhase && R.boss && R.boss.def.final && t > 780 && !S.enraged) { S.enraged = true; R.boss.enraged = true; G.bus.emit('bossEnrage', R.boss); }
  }

  G.bus.on('bossKilled', e => {
    const R = G.run; if (!R) return;
    // grand finale: a golden shockwave rolls out from the fallen boss and pops the horde in order (loot shower)
    G.enemyFx.finale(R, e.x, e.y, e.def.final ? 9 : 11, e.def.final ? 30 : 16);
    if (e.def.final) { R.bossDefeated = true; R.victoryAt = R.time + 3.2; }
  });
  return { initRun, update, ringPoint, powerK };
})();
