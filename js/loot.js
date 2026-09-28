/* loot.js — drops & pickups: element particles (XP), energy, Mora, food, chests, crystallize shards, relics, wind magnet.
   Pickup object: {type:'xp'|'energy'|'mora'|'food'|'chest'|'crystal'|'relic'|'magnet', x,y, value, tier, el, t, vx,vy, magnet(bool)}
   Owner: PROGRESSION. */
'use strict';
G.loot = (function () {
  const U = G.u;
  // XP tiers (Genshin-like element particle colours): small cyan / purple / gold / big red-pink
  const XP_TIERS = [[40, '#ff6a8a', 0.5], [10, '#ffd24a', 0.38], [3, '#c28bff', 0.29], [0, '#7fe3ff', 0.22]];
  const tierOf = v => { for (const t of XP_TIERS) if (v >= t[0]) return t; return XP_TIERS[3]; };
  const MAX_PICKUPS = 420;

  function initRun(R) { R.pickups = []; R.chestsDropped = 0; R.lastChestT = -99; R.xpChain = 0; R.xpChainT = 0; }

  function add(R, o) {
    o.t = 0; o.vx = o.vx != null ? o.vx : U.rand(-2, 2); o.vy = o.vy != null ? o.vy : U.rand(-3, -1); o.z = 0; o.vz = o.vz != null ? o.vz : U.rand(3, 5);
    R.pickups.push(o);
    if (R.pickups.length > MAX_PICKUPS) mergeXp(R);
    return o;
  }
  /** merge far-away XP into one big gem near the player (keeps perf stable, Vampire-Survivors style) */
  function mergeXp(R) {
    let total = 0; const keep = [], p = R.player;
    for (const o of R.pickups) { if (o.type === 'xp' && !o.magnet && U.dist2(o.x, o.y, p.x, p.y) > 100) total += o.value; else keep.push(o); }
    R.pickups = keep;
    if (total > 0) {
      const a = U.rand(0, U.TAU), d = U.rand(5, 7);
      keep.push({ type: 'xp', x: p.x + Math.cos(a) * d, y: p.y + Math.sin(a) * d, value: total, t: 0, vx: 0, vy: 0, z: 0, vz: 6, big: true });
    }
  }

  function dropXp(R, x, y, value) { return add(R, { type: 'xp', x, y, value, big: value >= 40 }); }

  function onEnemyKilled(R, e) {
    const def = e.def || {}, S = R.stats;
    const big = e.boss || e.elite;
    if (big) { // bosses & elites burst into a fountain of particles
      const n = e.boss ? 14 : 6, per = Math.max(1, Math.round((def.xp || 10) / n * (e.boss ? 3 : 1.5)));
      for (let i = 0; i < n; i++) { const a = i / n * U.TAU; add(R, { type: 'xp', x: e.x, y: e.y, value: per, vx: Math.cos(a) * 5, vy: Math.sin(a) * 5, vz: U.rand(5, 8) }); }
    } else dropXp(R, e.x, e.y, def.xp || 1);
    // energy particles for the burst (Genshin: particles charge energy)
    if (U.chance(big ? 1 : 0.07)) add(R, { type: 'energy', x: e.x, y: e.y, value: e.boss ? 20 : e.elite ? 8 : 1.5 });
    // kill bounty (balance v5): every defeat quietly adds a little Mora, so even a short failed run brings some home
    R.mora += (def.xp || 1) * 0.15 * ((S && S.moraMul) || 1) / (1 + (R.kills || 0) / 2500);
    if (U.chance(big ? 1 : (R.levels && R.levels.bless_mora ? 0.16 : 0.08))) {
      const n = e.boss ? 8 : e.elite ? 3 : 1;
      for (let i = 0; i < n; i++) add(R, { type: 'mora', x: e.x + U.rand(-0.4, 0.4), y: e.y, value: e.boss ? 20 : e.elite ? 8 : U.randi(1, 3), vz: U.rand(4, 7) });
    }
    // food: rare normally; when HP is low a chicken shows up much more often (pity timer guarantees one)
    const hpF = R.player.hp / R.player.maxHp, sinceFood = R.time - (R.lastFoodT || -99);
    if (hpF < 0.45 && sinceFood > 10 && (U.chance(hpF < 0.3 ? 0.06 : 0.025) || (hpF < 0.3 && sinceFood > 25))) {
      R.lastFoodT = R.time; add(R, { type: 'food', x: e.x, y: e.y, food: 'chicken', vz: 7 });
    } else if (!big && U.chance(0.004)) { R.lastFoodT = R.time; add(R, { type: 'food', x: e.x, y: e.y, food: U.chance(0.75) ? 'chicken' : 'feast' }); }
    // wind magnet: rare random drop + a "vacuum" drop whenever lots of particles lie around (every ≥75 s)
    if (!big && U.chance(0.0025)) add(R, { type: 'magnet', x: e.x, y: e.y });
    else if (!big && R.time - (R.lastMagnetT || 0) > 75 && R.pickups.length > 90) { R.lastMagnetT = R.time; add(R, { type: 'magnet', x: e.x, y: e.y, vz: 7 }); }
    if (e.reward) add(R, { type: 'chest', x: e.x, y: e.y, tier: e.reward, vz: 8 });
    else if (!big && evoWaiting(R) && R.time - Math.max(R.evoReadyT, R.lastChestT) > 20 && !R.pickups.some(o => o.type === 'chest')) {
      // an evolution is ready: make sure a chest shows up soon (it will glow gold)
      R.lastChestT = R.time; add(R, { type: 'chest', x: e.x, y: e.y, tier: 'exquisite', random: true, vz: 9 });
      G.bus.emit('notice', { text: '光る宝箱が出た！ 進化のチャンス！', color: '#ffd24a' });
    } else if (!big && launcherWaiting(R) && !R.pickups.some(o => o.type === 'chest')) {
      // rules v6: new launchers come only from the chest choice → make sure such a chest shows up now and then
      R.lastChestT = R.time; add(R, { type: 'chest', x: e.x, y: e.y, tier: 'common', random: true, vz: 9 });
      G.bus.emit('notice', { text: '宝箱だ！ ランチャーを えらべるかも！', color: '#c28bff' });
    } else if (!big && R.chestsDropped < 5 && R.time - R.lastChestT > 45 && !R.pickups.some(o => o.type === 'chest' && o.random)
      && U.chance(0.0035 * ((S && S.chestMul) || 1))) {
      R.chestsDropped++; R.lastChestT = R.time; add(R, { type: 'chest', x: e.x, y: e.y, tier: U.chance(0.1) ? 'exquisite' : 'common', random: true, vz: 7 });
    }
    if (e.relic) add(R, { type: 'relic', x: e.x - 0.8, y: e.y, vz: 9 });
  }

  /** rules v6 pity: no chest for a while and a new launcher could be picked (0 owned: 25 s gap from 0:55, 1 owned: 70 s) */
  let lwT = -1, lwV = false;
  function launcherWaiting(R) {
    const LR = G.launcherRules; if (!LR || R.time < 55) return false;
    const n = LR.owned(R).length, gap = n === 0 ? 25 : 70;
    if (n >= LR.MAX_KINDS || R.time - Math.max(R.lastChestT, R.lastChestOpenT || -99) < gap) return false;
    if (R.time - lwT > 1 || lwT > R.time) { lwT = R.time; lwV = G.progression.newLaunchers(R).length > 0; }
    return lwV;
  }
  let evoCacheT = -1, evoCacheV = false;
  function evoWaiting(R) {
    if (evoCacheT === R.time) return evoCacheV;
    evoCacheT = R.time; evoCacheV = !!(G.progression.evoReady && G.progression.evoReady(R).length);
    return evoCacheV;
  }

  function dropCrystal(R, x, y, el) { return add(R, { type: 'crystal', x, y, el, life: 15, vz: 5 }); }

  function collect(R, o) {
    const p = R.player, S = R.stats;
    switch (o.type) {
      case 'xp': {
        R.xpChain = R.realTime - R.xpChainT < 0.35 ? R.xpChain + 1 : 0; R.xpChainT = R.realTime;
        G.progression.addXp(R, o.value * S.xpMul); G.audio.sfx('xp', { chain: Math.min(R.xpChain, 16), value: o.value }); G.player.addEnergy(R, 0.04 * o.value);
        if (o.value >= 40) G.fx.ring && G.fx.ring(p.x, p.y, 2.5, '#ff6a8a');
        break;
      }
      case 'energy': G.player.addEnergy(R, o.value); G.audio.sfx('energy'); break;
      case 'mora': { const v = Math.round(o.value * S.moraMul); R.mora += v; G.fx.number(p.x, p.y - 2.2, v, { color: '#ffd24a', size: 0.7, prefix: '◎' }); G.audio.sfx('mora'); break; }
      case 'food':
        if (o.food === 'chicken') { G.player.heal(R, p.maxHp * 0.5); G.bus.emit('notice', { text: 'スイートフラワー鶏肉！ HP回復', color: '#7dff8a' }); }
        else { R.buffs = R.buffs || {}; R.buffs.feastUntil = R.time + 20; G.player.refreshStats(R); G.bus.emit('notice', { text: '仙跳牆！ 20秒間 攻撃力×2', color: '#ffb347' }); }
        G.audio.sfx('food'); break;
      case 'crystal': {
        G.player.addShield(R, p.maxHp * 0.12 * (S.shieldMul || 1), 15);
        G.audio.sfx('shield'); G.bus.emit('shield', o.el);
        if (G.fx.ring) G.fx.ring(p.x, p.y, (S.shieldRange || 3), (G.EL[o.el] || G.EL.geo).color);
        break;
      }
      case 'chest': G.progression.openChest(R, o.tier); break;
      case 'relic': R.relicsFound = (R.relicsFound || 0) + 1; G.bus.emit('notice', { text: 'モンドの遺物を手に入れた！', color: '#9fe8c8' }); G.audio.sfx('relic'); break;
      case 'magnet':
        for (const q of R.pickups) if (q.type === 'xp' || q.type === 'mora' || q.type === 'energy') { if (!q.magnet) { q.magnet = true; q.sp = -4; } }
        G.audio.sfx('magnet'); G.fx.ring && G.fx.ring(p.x, p.y, 8, '#5cf2c8'); G.fx.swirl && G.fx.swirl(p.x, p.y, 4, '#5cf2c8');
        G.bus.emit('notice', { text: '風よ、集え！', color: '#5cf2c8' });
        break;
    }
    G.bus.emit('pickup', o);
  }

  function update(R, dt) {
    const p = R.player, S = R.stats;
    const range = S.pickup;
    for (let i = R.pickups.length - 1; i >= 0; i--) {
      const o = R.pickups[i]; o.t += dt;
      // pop-out arc
      if (o.vz || o.z > 0) {
        o.z += o.vz * dt; o.vz -= 18 * dt;
        if (o.z <= 0) { o.z = 0; o.vz = o.vz < -3 ? -o.vz * 0.35 : 0; }
        if (!o.magnet) { o.x += o.vx * dt * 0.4; o.y += o.vy * dt * 0.2; }
      }
      if (o.life && o.t > o.life) { R.pickups.splice(i, 1); continue; }
      const dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy) || 0.001;
      const autoRange = o.type === 'chest' || o.type === 'relic' || o.type === 'food' || o.type === 'magnet' ? 1.3 : o.type === 'crystal' ? range * 0.8 : range;
      if (!o.magnet && d < autoRange && o.t > 0.25) { o.magnet = true; o.sp = -3.5; } // tiny hop away, then rush in
      if (o.magnet) {
        o.sp = Math.min(38, (o.sp || 0) + (55 + (o.sp > 0 ? o.sp * 2.2 : 0)) * dt);
        const step = Math.min(d, o.sp * dt);
        o.x += dx / d * step; o.y += dy / d * step;
      }
      if (d < 0.6) { R.pickups.splice(i, 1); collect(R, o); }
    }
  }

  function draw(ctx) {
    const R = G.run, t = R.realTime;
    for (const o of R.pickups) {
      if (!G.render.onScreen(o.x, o.y, 2)) continue;
      const y = o.y - o.z - 0.3 - Math.sin(t * 4 + o.x) * 0.06;
      if (o.type === 'xp' && o.star) { drawStarOrb(ctx, o, y, t); continue; }
      if (o.type === 'xp') {
        const tier = tierOf(o.value), c = tier[1], s = tier[2];
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = o.magnet ? 0.8 : 0.55;
        ctx.drawImage(G.assets.glow(c, 32), o.x - s * 2.2, y - s * 2.2, s * 4.4, s * 4.4);
        if (o.magnet && o.sp > 8) { // speed streak
          const dx = R.player.x - o.x, dy = R.player.y - o.y, d = Math.hypot(dx, dy) || 1, L = Math.min(1.2, o.sp * 0.03);
          ctx.strokeStyle = c; ctx.lineWidth = s * 0.8; ctx.globalAlpha = 0.45; ctx.beginPath(); ctx.moveTo(o.x, y); ctx.lineTo(o.x - dx / d * L, y - dy / d * L); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = c; ctx.save(); ctx.translate(o.x, y); ctx.rotate(t * 2 + o.x);
        ctx.beginPath(); ctx.moveTo(0, -s); ctx.lineTo(s * 0.6, 0); ctx.lineTo(0, s); ctx.lineTo(-s * 0.6, 0); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.8; ctx.beginPath(); ctx.arc(-s * 0.15, -s * 0.3, s * 0.18, 0, U.TAU); ctx.fill(); ctx.globalAlpha = 1;
        ctx.restore();
      } else if (o.type === 'energy') {
        ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(G.assets.glow('#ff9a4a', 32), o.x - 0.55, y - 0.55, 1.1, 1.1);
        ctx.globalCompositeOperation = 'source-over';
        ctx.fillStyle = '#ffe0b0'; ctx.beginPath(); ctx.arc(o.x, y, 0.15, 0, U.TAU); ctx.fill();
      } else if (o.type === 'mora') G.render.icon(ctx, 'mora', o.x, y, 0.62);
      else if (o.type === 'food') G.render.icon(ctx, o.food, o.x, y, 0.9);
      else if (o.type === 'crystal') {
        const blink = o.life && o.t > o.life - 3 && (Math.floor(t * 8) & 1);
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5;
        ctx.drawImage(G.assets.glow((G.EL[o.el] || G.EL.geo).color, 32), o.x - 0.7, y - 0.7, 1.4, 1.4);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = blink ? 0.4 : 1;
        G.render.icon(ctx, 'crystal', o.x, y, 0.7); ctx.globalAlpha = 1;
      } else if (o.type === 'magnet') {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + Math.sin(t * 6) * 0.2;
        ctx.drawImage(G.assets.glow('#5cf2c8', 32), o.x - 0.9, y - 0.9, 1.8, 1.8); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        G.render.icon(ctx, 'wind', o.x, y, 0.9, Math.sin(t * 3) * 0.2);
      } else if (o.type === 'relic') {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55 + Math.sin(t * 4) * 0.2;
        ctx.drawImage(G.assets.glow('#9fe8c8', 64), o.x - 1.5, y - 1.5, 3, 3); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        G.render.icon(ctx, 'relic', o.x, y, 1.3);
      } else if (o.type === 'chest') {
        if (evoWaiting(R)) { drawEvoChest(ctx, o, y, t); continue; }
        const col = o.tier === 'luxurious' ? '#ffd24a' : o.tier === 'precious' ? '#ffb347' : o.tier === 'exquisite' ? '#c28bff' : '#6fb7ff';
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 + Math.sin(t * 5) * 0.2;
        ctx.drawImage(G.assets.glow(col, 64), o.x - 1.4, y - 1.2, 2.8, 2.8);
        // light pillar so chests are easy to spot
        ctx.globalAlpha = 0.25 + Math.sin(t * 3) * 0.08; ctx.fillStyle = col; ctx.fillRect(o.x - 0.12, y - 6, 0.24, 6);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        G.render.icon(ctx, 'chest', o.x, y, o.tier === 'luxurious' || o.tier === 'precious' ? 1.6 : 1.2);
      }
    }
  }

  /** golden star orb (kill milestones) */
  function drawStarOrb(ctx, o, y, t) {
    const s = 0.62 + Math.sin(t * 8) * 0.05;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.75;
    ctx.drawImage(G.assets.glow('#ffd24a', 64), o.x - 2, y - 2, 4, 4);
    ctx.globalAlpha = 0.25 + Math.sin(t * 5) * 0.1; ctx.fillStyle = '#ffe07a'; ctx.fillRect(o.x - 0.1, y - 5, 0.2, 5);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.translate(o.x, y); ctx.rotate(t * 1.5);
    ctx.fillStyle = '#ffd24a'; ctx.strokeStyle = '#fff6c8'; ctx.lineWidth = 0.06;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) { const a = i / 10 * U.TAU - Math.PI / 2, r = i & 1 ? s * 0.45 : s; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(-s * 0.15, -s * 0.2, s * 0.16, 0, U.TAU); ctx.fill();
    ctx.restore(); ctx.globalAlpha = 1;
  }
  /** chest while an evolution is ready: rainbow-gold pillar + bouncing 「進化！」 tag */
  const EVO_COL = ['#ffd24a', '#ff9d3c', '#ff6a8a', '#c28bff', '#7fe3ff', '#7dff8a'];
  function drawEvoChest(ctx, o, y, t) {
    const col = EVO_COL[Math.floor(t * 6) % EVO_COL.length];
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.65 + Math.sin(t * 7) * 0.2; ctx.drawImage(G.assets.glow('#ffd24a', 64), o.x - 2.2, y - 2, 4.4, 4.4);
    ctx.globalAlpha = 0.35; ctx.drawImage(G.assets.glow(col, 64), o.x - 1.6, y - 1.6, 3.2, 3.2);
    ctx.globalAlpha = 0.35 + Math.sin(t * 4) * 0.1; ctx.fillStyle = '#ffe07a'; ctx.fillRect(o.x - 0.28, y - 9, 0.56, 9);
    ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.fillRect(o.x - 0.07, y - 9, 0.14, 9);
    for (let i = 0; i < 3; i++) { // rising sparkles
      const k = (t * 0.8 + i / 3) % 1; ctx.globalAlpha = 1 - k;
      ctx.drawImage(G.assets.glow(EVO_COL[i * 2], 32), o.x - 0.3 + Math.sin(t * 3 + i * 2) * 0.6, y - k * 5 - 0.3, 0.6, 0.6);
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    G.render.icon(ctx, 'chest', o.x, y + Math.sin(t * 10) * 0.05, 1.7, Math.sin(t * 12) * 0.08);
    ctx.save(); ctx.translate(o.x, y - 1.9 - Math.abs(Math.sin(t * 4)) * 0.35); ctx.scale(1 / 40, 1 / 40);
    ctx.font = '900 26px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.lineWidth = 6; ctx.strokeStyle = '#5a2a00'; ctx.strokeText('進化！', 0, 0);
    ctx.fillStyle = '#ffe07a'; ctx.fillText('進化！', 0, 0);
    ctx.restore();
  }

  return { initRun, add, dropXp, dropCrystal, onEnemyKilled, collect, update, draw, mergeXp };
})();
