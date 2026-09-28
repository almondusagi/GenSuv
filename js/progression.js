/* progression.js — stats pipeline, XP/levels, level-up offers, rerolls, chests & evolutions,
   elemental resonance, Amber constellations (owner: PROGRESSION).
   Catalogue lives in upgrades.js (G.upgrades). UIs live in levelup.js (G.ui.levelUp / G.ui.chest / G.progressionUI).

   Extra R.stats flags provided for COMBAT (all always present):
     normalMul      Amber normal arrow ATK multiplier (1.00 → 2.75 via amber_normal)
     normalHaste    extra normal-attack rate multiplier from amber_normal (1 + 0.08·lv); S.haste is separate
     bunnyMul       Baron Bunny explosion ATK multiplier (3.0 → 9.0), constellation C2/C3 already baked in
     normalInterval seconds between normal volleys at haste 1 (char.atkInterval; balance v5 = 1.2)
     range          normal/charged auto-aim reach in units (char.range × meta 射程)
     chargedPeriod  base seconds between charged shots (char.chargedPeriod)
     bunnyCharges   Baron Bunny charges (1; 2 with C4 — evo_amber_skill also means 2)
     bunnyCdMul     Baron Bunny cooldown multiplier (1; 0.8 with C4)
     rainMul        Fiery Rain per-hit ATK multiplier (1.8 → 4.5), C5 and relic 4pc already baked in
     rainDur        Fiery Rain duration seconds (8 → 10)
     extraArrows    extra arrows per normal volley from C1 (0/1), each deals extraArrowMul × normal damage
     extraArrowMul  damage ratio of those C1 arrows (0.6)
     burstBuff      true with C6: while R.buffs.burstBuffUntil > R.time, ATK/speed +15% (handled here)
     shieldRange    shield aura radius in units (3 base; shield_range)
     shieldDmg      shield aura damage ×ATK per second (0.6 base; shield_damage) — ticked HERE (see shieldAura)
     resonance      {pyro,hydro,cryo,electro,anemo,geo,all} booleans (already applied to the stats)
     offerCount     level-up card count (3, or 4 with the 2nd relic set)                                  */
'use strict';
G.upgrades = G.upgrades || {};
G.progression = (function () {
  const U = G.u;

  /* ---------------- Amber constellations (命ノ星座) ---------------- */
  const CONST = [
    { id: 'c1', name: '双つの矢', cost: 800, text: '通常攻撃で矢をもう1本撃つ（60%の威力）', short: '矢 +1本' },
    { id: 'c2', name: '伯爵の火薬', cost: 1500, text: 'ウサギ伯爵の爆発ダメージ +60%', short: '伯爵ダメ +60%' },
    { id: 'c3', name: '飛行記録更新', cost: 2400, text: '元素スキル レベル+3（伯爵の威力 ×1.3）', short: 'スキルLv +3' },
    { id: 'c4', name: 'うさぎ工房', cost: 3400, text: '伯爵のクールタイム -20%・同時に2回使える', short: 'CT-20%・2回' },
    { id: 'c5', name: '燃える矢の雨', cost: 4600, text: '元素爆発 レベル+3（矢の雨の威力 ×1.3）', short: '爆発Lv +3' },
    { id: 'c6', name: '燎原の火', cost: 6000, text: '元素爆発中、攻撃力と移動速度 +15%（10秒）', short: '攻撃・移動 +15%' },
  ];
  function constellationLevel() {
    const s = G.save.data; const v = s.constellation;
    const n = typeof v === 'number' ? v : (v && typeof v.amber === 'number' ? v.amber : 0);
    return U.clamp(n | 0, 0, 6);
  }

  /* ---------------- elemental resonance ---------------- */
  const RES = {
    pyro: { name: '熱誠の炎', desc: '攻撃力 +25%', el: 'pyro' },
    hydro: { name: '癒しの水', desc: '最大HP +25%・少しずつ回復', el: 'hydro' },
    cryo: { name: '粉砕の氷', desc: '会心率 +15%', el: 'cryo' },
    electro: { name: '高圧の雷', desc: '元素反応でエネルギー回復', el: 'electro' },
    anemo: { name: '迅速の風', desc: '移動速度 +10%・クールタイム -5%', el: 'anemo' },
    geo: { name: '堅牢の岩', desc: 'シールド +15%・与ダメージ +15%', el: 'geo' },
    all: { name: '万象の共鳴', desc: 'キャラとランチャー2種で 3つの元素！ 全ダメージ +20%・被ダメ -10%', el: 'all' },
  };
  const EARLY_T = 180;
  const LAUNCH_EL = ['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo'];
  const ALL_N = 3; // distinct elements needed for 万象の共鳴 (was 4 before the 2-launcher cap)
  function resonanceSet(R) {
    const out = {}; let n = 0;
    for (const el of LAUNCH_EL) if ((R.levels['launcher_' + el] || 0) > 0) { out[el] = true; n++; }
    // the character's own element counts toward the distinct-element total (Amber = pyro).
    // rules v6: max 2 launcher kinds per run → 万象の共鳴 = character + 2 launchers, all 3 elements different
    const own = R.char && R.char.element; const distinct = n + (own && !out[own] ? 1 : 0);
    if (distinct >= ALL_N) out.all = true;
    return out;
  }
  function applyResonance(S, res) {
    if (res.pyro) S.atk *= 1.25;
    if (res.hydro) { S.maxHp *= 1.25; S.regen += S.maxHp * 0.004; }
    if (res.cryo) S.critRate += 0.15;
    if (res.anemo) { S.speed *= 1.1; S.cdr += 0.05; }
    if (res.geo) { S.shieldMul *= 1.15; S.dmgBonus += 0.15; }
    if (res.all) { S.dmgBonus += 0.2; S.dmgReduction = 1 - (1 - S.dmgReduction) * 0.9; }
  }

  /* ---------------- stats ---------------- */
  function metaVal(k) { const M = G.save.data.meta || {}, D = G.data.meta[k]; return D ? (M[k] || 0) * D.per : 0; }
  function baseStats(R) {
    const ch = R.char, m = metaVal;
    return {
      atk: ch.atk * (1 + m('power')), maxHp: ch.hp * (1 + m('vitality')), def: (ch.def || 0) + m('defense'),
      speed: ch.speed * (1 + m('speed')), pickup: ch.pickup * (1 + m('gather')),
      critRate: 0.05 + m('crit_rate'), critDmg: 0.5 + m('crit_damage'),
      recharge: 1 + m('recharge'), haste: 1 + m('haste'), cdr: m('ks_burst') ? 0.08 : 0, areaMul: 1, durationMul: 1,
      normalInterval: ch.atkInterval || 0.78, range: (ch.range || 13.5) * (1 + m('range')), chargedPeriod: ch.chargedPeriod || 3.4,
      explosionMul: R.charId === 'amber' ? 2 : 1, // Amber passive: explosion radius ×2 (multiplicative)
      xpMul: 1 + m('wisdom'), moraMul: 1 + m('mora'), chestMul: 1 + m('chest'),
      dmgBonus: m('ks_fire'), elBonus: {}, reactionBonus: 0, amplifyBonus: 0, shieldMul: 1, regen: 0, dmgReduction: m('ks_guard') ? 0.08 : 0,
      projSpeed: 1, extraProjectiles: m('multishot'), revival: ((G.save.data.meta || {}).revival || 0) > 0,
      // PROGRESSION extras (see header)
      normalMul: 1, normalHaste: 1, bunnyMul: 3, bunnyCharges: 1, bunnyCdMul: 1, rainMul: 1.8, rainDur: 8,
      extraArrows: 0, extraArrowMul: 0.6, burstBuff: false, shieldRange: 3, shieldDmg: 0.6,
      resonance: {}, offerCount: 3, constellation: 0,
    };
  }

  function computeStats(R) {
    const S = baseStats(R);
    for (const key in R.levels) { const up = G.upgrades[key], lv = R.levels[key]; if (up && up.mods && lv > 0) up.mods(S, lv, R); }
    // constellations (Amber only)
    if (R.charId === 'amber') {
      const c = constellationLevel(); S.constellation = c;
      if (c >= 1) S.extraArrows += 1;
      if (c >= 2) S.bunnyMul *= 1.6;
      if (c >= 3) S.bunnyMul *= 1.3;
      if (c >= 4) { S.bunnyCdMul *= 0.8; S.bunnyCharges = 2; }
      if (c >= 5) S.rainMul *= 1.3;
      if (c >= 6) S.burstBuff = true;
    }
    if (R.evolved && R.evolved.evo_amber_skill) S.bunnyCharges = Math.max(S.bunnyCharges, 2);
    S.resonance = resonanceSet(R); applyResonance(S, S.resonance);
    if (G.relics && G.relics.applyMods) { try { G.relics.applyMods(S, R); } catch (e) { console.error(e); } }
    const b = R.buffs || {};
    if (b.feastUntil > R.time) S.atk *= 2;
    if (S.burstBuff && b.burstBuffUntil > R.time) { S.atk *= 1.15; S.speed *= 1.15; }
    // generous early game: bigger pickup radius (extra boost during the first 3 minutes)
    S.pickup += 1.0 + (R.time < EARLY_T ? 1.2 : 0);
    S.critRate = Math.min(1, S.critRate);
    S.recharge = Math.min(3, S.recharge);
    return S;
  }

  /* ---------------- run lifecycle ---------------- */
  function initRun(R) {
    R.pendingLevels = 0; R.lastOffer = []; R.offerN = 0; R.sinceLauncher = 0;
    R.rerolls = 2 + ((G.save.data.meta || {}).reroll || 0);
    R.buffs = R.buffs || {};
    R.resonanceSeen = {};
    R.shieldAuraT = 0; R.elecResT = 0;
    R.sinceGold = 0; R.evoAnnounced = {}; R.evoReadyT = -1; R.blessT = {}; R.fireworkQ = 0; R.dandelionN = 0; R.killMilestone = 0; R.metaStartDone = false;
    const res = resonanceSet(R); for (const k in res) R.resonanceSeen[k] = true;
  }

  function addXp(R, v) {
    const p = R.player; p.xp += v;
    let guard = 0;
    while (p.xp >= p.xpNeed && guard++ < 50) { p.xp -= p.xpNeed; p.level++; p.xpNeed = G.data.xpNeed(p.level); R.pendingLevels++; }
  }

  function update(R, dt) {
    if (R.pendingLevels > 0 && !G.game.isPaused() && !R.over) {
      R.pendingLevels--;
      G.bus.emit('levelUp', R.player.level);
      openLevelUp(R);
    }
    const b = R.buffs;
    if (b) {
      if (b.feastUntil && b.feastUntil <= R.time) { b.feastUntil = 0; G.player.refreshStats(R); }
      if (b.burstBuffUntil && b.burstBuffUntil <= R.time) { b.burstBuffUntil = 0; G.player.refreshStats(R); }
    }
    if (!R.earlyDone && R.time >= EARLY_T) { R.earlyDone = true; G.player.refreshStats(R); }
    shieldAura(R, dt);
    if (!R.metaStartDone) metaStart(R);
    blessingUpdate(R, dt);
  }

  /* ---------------- star-map keystones applied at the start of a run ---------------- */
  function metaStart(R) {
    R.metaStartDone = true;
    const M = G.save.data.meta || {}, p = R.player;
    if (M.ks_guard > 0 && p && p.maxHp) { G.player.addShield(R, p.maxHp * 0.3, 30); G.bus.emit('shield', 'geo'); }
    if (M.ks_burst > 0 && p && R.char) { p.energy = R.char.energyCost; }
  }

  /* ---------------- ★5 blessings (天啓カード) runtime — public APIs only ---------------- */
  const lv = (R, k) => (R.levels && R.levels[k]) || 0;
  function blessingUpdate(R, dt) {
    const p = R.player, S = R.stats; if (!p || !S) return;
    if (lv(R, 'bless_meteor')) {
      R.blessT.meteor = (R.blessT.meteor || 0) + dt;
      if (R.blessT.meteor >= 6) { R.blessT.meteor = 0; meteor(R); }
    }
    if (R.fireworkQ > 0 && lv(R, 'bless_firework')) {
      R.blessT.fw = (R.blessT.fw || 0) - dt;
      if (R.blessT.fw <= 0) { R.fireworkQ--; R.blessT.fw = 0.35; firework(R); }
    } else R.fireworkQ = 0;
    if (R.dandelionN >= 40 && lv(R, 'bless_dandelion')) { R.dandelionN = 0; dandelion(R); }
  }
  function meteor(R) {
    const p = R.player, S = R.stats;
    const best = G.weapons.cluster ? G.weapons.cluster(R, p.x, p.y, 12, 2.5) : (G.weapons.nearestN(R, p.x, p.y, 12, 1) || [])[0];
    if (!best) return;
    const tx = best.x, ty = best.y, r = 1.5 * Math.sqrt(S.explosionMul || 1) * (S.areaMul || 1);
    const T = 0.5;
    R.props.push({ x: tx, y: ty + 0.01, t: 0,
      update(R2, dt2, o) {
        o.t += dt2;
        if (o.t < T) return true;
        G.combat.aoe(R2, tx, ty, r, { mul: 7, element: 'pyro', gauge: 1, src: 'meteor', knock: 1.2 });
        G.fx.explosion && G.fx.explosion(tx, ty, r, { color: '#ffb347', kind: 'pyro' });
        G.fx.ring && G.fx.ring(tx, ty, r * 1.3, '#ffe07a');
        G.fx.shake && G.fx.shake(0.35);
        G.audio.sfx('explosion');
        return false;
      },
      draw(ctx, o) {
        const k = Math.min(1, o.t / T), sx = tx + 5 * (1 - k), sy = ty - 13 * (1 - k);
        ctx.save(); ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35 + 0.4 * k; ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 0.35; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(sx + 2.2, sy - 5.6); ctx.lineTo(sx, sy); ctx.stroke();
        ctx.globalAlpha = 1; ctx.drawImage(G.assets.glow('#ffd24a', 64), sx - 1.1, sy - 1.1, 2.2, 2.2);
        // target mark on the ground
        ctx.globalAlpha = 0.25 + 0.35 * k; ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 0.08;
        ctx.beginPath(); ctx.ellipse(tx, ty, r * (1.2 - 0.2 * k), r * 0.55 * (1.2 - 0.2 * k), 0, 0, U.TAU); ctx.stroke();
        ctx.restore();
      } });
  }
  const FW_COL = ['#ff6a8a', '#ffd24a', '#7fe3ff', '#c28bff', '#7dff8a'];
  function firework(R) {
    const p = R.player, S = R.stats, r = 3.2 * Math.sqrt((S.explosionMul || 1) / 2) * (S.areaMul || 1);
    G.combat.aoe(R, p.x, p.y, r, { mul: 9, element: 'pyro', gauge: 1, src: 'firework', knock: 2 });
    for (let i = 0; i < 4; i++) {
      const a = i / 4 * U.TAU + Math.random(), d = r * 0.55, c = FW_COL[(i + (R.player.level | 0)) % FW_COL.length];
      G.fx.burst && G.fx.burst(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d - 0.5, 18, c, { min: 3, max: 8, life: 0.9, stars: true });
      G.fx.ring && G.fx.ring(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 1.4, c);
    }
    G.fx.ring && G.fx.ring(p.x, p.y, r, '#ffe07a');
    G.fx.shake && G.fx.shake(0.3);
    G.audio.sfx('bigExplosion');
  }
  function dandelion(R) {
    const p = R.player;
    G.combat.aoe(R, p.x, p.y, 7, { mul: 2.5, element: 'anemo', gauge: 1, src: 'dandelion', knock: 4 });
    for (const q of R.pickups) if (q.type === 'xp' || q.type === 'mora' || q.type === 'energy') { if (!q.magnet) { q.magnet = true; q.sp = -4; } }
    G.fx.swirl && G.fx.swirl(p.x, p.y, 6, '#5cf2c8'); G.fx.ring && G.fx.ring(p.x, p.y, 7, '#5cf2c8');
    G.audio.sfx('windBlast');
    G.bus.emit('notice', { text: '蒲公英の風！ ぜんぶ吸い寄せる！', color: '#5cf2c8' });
  }

  /* ---------------- evolution readiness ("進化の準備OK！") ---------------- */
  function checkEvoReady(R) {
    R.evoAnnounced = R.evoAnnounced || {};
    for (const k of evoReady(R)) {
      if (R.evoAnnounced[k]) continue;
      R.evoAnnounced[k] = true; R.evoReadyT = R.time;
      G.bus.emit('notice', { text: '★ 進化の準備OK！ 宝箱で「' + G.upgrades[k].name + '」に！', color: '#ffd24a' });
      G.audio.sfx('star', { rarity: 5 });
    }
  }

  /** shield aura (sekaikan §9 本作独自の結晶強化): enemies inside the shield radius take geo damage every second.
      Set G.progression.shieldAuraByCombat = true if COMBAT implements it itself. */
  function shieldAura(R, dt) {
    const p = R.player, S = R.stats;
    if (api.shieldAuraByCombat || !(p.shield > 0) || !S.shieldDmg) { R.shieldAuraT = 0; return; }
    R.shieldAuraT += dt;
    if (R.shieldAuraT < 1) return;
    R.shieldAuraT -= 1;
    if (G.combat && G.combat.aoe) G.combat.aoe(R, p.x, p.y, S.shieldRange, { mul: S.shieldDmg, element: 'geo', gauge: 0, src: 'shield', knock: 0.2 });
  }

  /* ---------------- offers ---------------- */
  const SPECIAL = {
    _heal: { name: 'ひと休み', icon: 'chicken', cat: 'special', rarity: 3, max: 99, short: 'HP回復', desc: () => 'HPを <b>30%</b> 回復' },
    _mora: { name: 'モラ袋', icon: 'mora', cat: 'special', rarity: 3, max: 99, short: 'モラ獲得', desc: () => 'モラ <b>+60</b>' },
  };
  function def(key) { return G.upgrades[key] || SPECIAL[key]; }

  /** keys that may be offered. ctx.allowNewLauncher: include un-owned launchers (chest choice only — rules v6) */
  function available(R, ctx) {
    const out = [];
    for (const key in G.upgrades) {
      const up = G.upgrades[key]; const lv = R.levels[key] || 0;
      if (up.cat === 'evo') continue;
      if (up.cat === 'launcher' && lv === 0 && !(ctx && ctx.allowNewLauncher)) continue;
      if (up.char && up.char !== R.charId) continue; // never offer other characters' upgrades
      if (lv >= up.max) continue;
      if (up.unlock && !up.unlock(R)) continue;
      out.push(key);
    }
    return out;
  }
  /** evolutions ready right now — the rule itself lives in upgrades.js (G.upgradeHelpers.evoReady: every requirement MAX) */
  function evoReady(R) { return G.upgradeHelpers.evoReady(R); }
  function blessingPool(R) {
    return (G.blessings || []).filter(k => { const u = G.upgrades[k]; return u && !(R.levels[k] > 0) && (!u.char || u.char === R.charId); });
  }

  function weightOf(R, key, ctx) {
    const up = G.upgrades[key], lv = R.levels[key] || 0;
    let w = up.cat === 'char' ? 1.6 : up.cat === 'launcher' ? 1.3 : 1.0;
    if (lv > 0) w *= 2.2;                                  // level up what you already own
    if (up.cat === 'launcher' && lv === 0) w *= ctx.favourLaunch || 1;
    if (up.cat === 'char') w *= ctx.favourChar || 1;
    if (up.cat === 'stat') w *= ctx.favourStat || 1;
    if (lv === up.max - 1) w *= 1.3;                       // "one more to MAX!"
    const h = G.upgradeHelpers.evoHint(R, key); if (h && h.have) w *= 1.5; // synergy with an owned evolution partner
    if (ctx.avoid && ctx.avoid.indexOf(key) >= 0) w *= ctx.avoidMul != null ? ctx.avoidMul : 0.3; // anti-repeat
    return w;
  }
  function weightedTake(R, pool, ctx) {
    if (!pool.length) return null;
    const list = pool.map(k => [k, weightOf(R, k, ctx)]);
    const k = U.weighted(list);
    pool.splice(pool.indexOf(k), 1);
    return k;
  }

  /** build a level-up offer (array of keys). opts: {avoid:[keys], n} */
  function makeOffer(R, n, opts) {
    opts = opts || {}; n = n || (R.stats && R.stats.offerCount) || 3;
    let pool = available(R);
    const avoid = opts.avoid || R.lastOffer || [];
    const out = [];
    if (!pool.length) return ['_heal', '_mora'];
    // first level-up: Amber's three arrow upgrades (spirit of the old game)
    if ((R.offerN || 0) === 0 && !opts.avoid) {
      for (const k of ['amber_normal', 'amber_arrows', 'amber_pierce']) if (pool.indexOf(k) >= 0 && out.length < n) { out.push(k); pool.splice(pool.indexOf(k), 1); }
    }
    // rules v6: NEW launchers are never offered on level-up (chest choice only) — available() already skips them
    // weighted fill; avoid all-stat screens
    while (out.length < n && pool.length) {
      const stats = out.filter(k => G.upgrades[k].cat === 'stat').length;
      const k = weightedTake(R, pool, { avoid, favourStat: stats >= 2 ? 0.25 : 1, favourLaunch: 0.8 });
      if (k) out.push(k);
    }
    // ★5 gold blessing (rare, pity-timer): replaces one card
    const bl = blessingPool(R);
    if (!opts.noGold && bl.length && (R.offerN || 0) >= 4) {
      const luck = 1 + metaVal('ks_luck');
      const pity = (R.sinceGold || 0) >= 13;
      if (pity || U.chance((0.04 + 0.012 * (R.sinceGold || 0)) * luck)) {
        const k = U.pick(bl); if (out.length >= n) out.pop(); out.push(k); R.sinceGold = 0;
      } else R.sinceGold = (R.sinceGold || 0) + 1;
    }
    return U.shuffle(out);
  }

  /** reroll the current offer; returns the new offer or null when out of rerolls */
  function reroll(R, current) {
    if ((R.rerolls || 0) <= 0) return null;
    const next = makeOffer(R, current.length, { avoid: current, noGold: true });
    // only charge a reroll if something actually changed
    if (next.slice().sort().join() !== current.slice().sort().join()) R.rerolls--;
    R.lastOffer = next;
    return next;
  }

  function apply(R, key, o) {
    o = o || {};
    if (key === '_heal') { G.player.heal(R, R.player.maxHp * 0.3); return; }
    if (key === '_mora') { R.mora += 60; return; }
    const up = G.upgrades[key]; if (!up) return;
    R.levels[key] = (R.levels[key] || 0) + 1;
    if (up.onGain) up.onGain(R, R.levels[key]);
    G.player.refreshStats(R);
    G.bus.emit('upgrade', { key, level: R.levels[key] });
    if (up.cat === 'evo' && !o.deferEvo) G.bus.emit('evolution', { key });
    checkResonance(R);
    checkEvoReady(R);
  }

  function checkResonance(R) {
    const res = resonanceSet(R); R.resonanceSeen = R.resonanceSeen || {};
    for (const k in res) {
      if (R.resonanceSeen[k]) continue;
      R.resonanceSeen[k] = true;
      const d = RES[k];
      G.bus.emit('resonance', { key: k, name: d.name, desc: d.desc, el: d.el });
      G.audio.sfx('resonance');
      // activation burst around Amber in the element's colour (万象 = rainbow of all owned elements)
      const p = R.player, cols = k === 'all' ? LAUNCH_EL.filter(e => res[e] || (R.char && R.char.element === e)).map(e => G.EL[e].color) : [(G.EL[k] || {}).color || '#fff'];
      cols.forEach((c, i) => { G.fx.ring && G.fx.ring(p.x, p.y, 3 + i * 1.2, c); G.fx.burst && G.fx.burst(p.x, p.y - 0.8, 16, c, { min: 3, max: 7, life: 0.8, stars: true }); });
      G.fx.flash && G.fx.flash(cols[0], 0.2);
    }
  }

  function openLevelUp(R) {
    G.game.pause('levelup');
    const offer = makeOffer(R); R.lastOffer = offer; R.offerN = (R.offerN || 0) + 1;
    // chaining: several level-ups in a row → "LEVEL UP ×2, ×3…" with rising pitch
    R.lvChain = R.realTime - (R.lastLvCloseT != null ? R.lastLvCloseT : -9) < 0.6 ? (R.lvChain || 1) + 1 : 1;
    const p = R.player; if (G.fx.levelUpBurst) G.fx.levelUpBurst(p.x, p.y);
    G.audio.sfx('levelup', { chain: R.lvChain });
    G.player.heal(R, p.maxHp * 0.08); // every level-up heals a little (kid-friendly)
    const fin = key => { apply(R, key); R.lastLvCloseT = R.realTime; G.game.resume('levelup'); };
    if (G.debug && G.debug.autopick) { fin(offer[0]); return; }
    G.ui.levelUp(R, offer, fin);
  }

  /* ---------------- chests ---------------- */
  const CHEST = {
    common: { count: 1, mora: [20, 40], ctx: {} },
    exquisite: { count: 3, mora: [50, 80], ctx: {} },
    precious: { count: 3, mora: [120, 180], ctx: { favourChar: 6, favourLaunch: 3, favourStat: 0.4 } },
    luxurious: { count: 0, mora: [700, 900], ctx: {} },
  };
  const JACKPOT = { common: [0.1, 3], exquisite: [0.12, 5], precious: [0.2, 5] }; // [chance, item count]
  /** un-owned launchers that could be offered right now (time unlock + 2-kind cap) */
  function newLaunchers(R) {
    return available(R, { allowNewLauncher: true }).filter(k => G.upgrades[k].cat === 'launcher' && !(R.levels[k] > 0));
  }
  /** chest choice (rules v6): up to 2 new launchers + other upgrades, 3 cards. Returns keys or null. */
  function choiceOptions(R, got, ctx) {
    const nl = newLaunchers(R); if (!nl.length) return null;
    const out = [];
    while (out.length < 2 && nl.length) out.push(weightedTake(R, nl, {}));
    let pool = available(R).filter(k => out.indexOf(k) < 0 && !got.some(g => g.key === k));
    while (out.length < 3 && pool.length) out.push(weightedTake(R, pool, ctx || {}));
    if (out.length < 3) out.push('_heal');
    return U.shuffle(out);
  }
  /** apply the player's pick for a chest choice slot g (from rollChest). Mutates g into a normal result entry. */
  function resolveChoice(R, g, key) {
    if (!g || !g.choice) return g;               // already resolved
    if (g.options.indexOf(key) < 0) key = g.options[0];
    if (key[0] !== '_' && (!G.upgrades[key] || (R.levels[key] || 0) >= G.upgrades[key].max)) key = '_mora'; // already maxed by another slot
    const before = key[0] === '_' ? 0 : (R.levels[key] || 0);
    apply(R, key, { deferEvo: true });
    const d = def(key);
    g.choice = false; g.chosen = true; g.key = key; g.level = key[0] === '_' ? 0 : R.levels[key]; g.isNew = before === 0; g.evo = false; g.rarity = d.rarity || 3;
    return g;
  }
  /** pick & apply chest contents. Returns [{key, level, isNew, evo, rarity}] (+ at most one unresolved
      {key:'_choice', choice:true, options:[keys]} slot when a new launcher can be offered — see resolveChoice) */
  function rollChest(R, tier) {
    const C = CHEST[tier] || CHEST.common, got = [];
    let wantChoice = G.launcherRules && G.launcherRules.canNew(R);
    // 大当たり (golden jackpot): sometimes a chest rolls extra items
    const jp = JACKPOT[tier] && U.chance(JACKPOT[tier][0] * (1 + metaVal('ks_luck')));
    const count = jp ? JACKPOT[tier][1] : C.count;
    got.jackpot = !!jp;
    for (let i = 0; i < count; i++) {
      let key = evoReady(R)[0];              // evolution has absolute priority (Vampire-Survivors style)
      if (!key && wantChoice) {               // rules v6: the ONLY place a new launcher can be gained
        wantChoice = false;
        const options = choiceOptions(R, got, C.ctx);
        if (options) { got.push({ key: '_choice', choice: true, options, level: 0, isNew: true, evo: false, rarity: 4 }); continue; }
      }
      if (!key && i === 0 && (tier === 'precious' || got.jackpot)) { const bl = blessingPool(R); if (bl.length && U.chance(0.35)) key = U.pick(bl); }
      if (!key) {
        let pool = available(R);
        const fresh = pool.filter(k => !got.some(g => g.key === k || (g.options && g.options.indexOf(k) >= 0))); // prefer different items inside one chest (and not the choice cards)
        if (fresh.length) pool = fresh;
        if ((tier === 'precious' || got.jackpot) && i === 0) { // first slot of a precious chest is always ★4 (Amber / launcher)
          const hi = pool.filter(k => G.upgrades[k].rarity >= 4); if (hi.length) pool = hi;
        }
        key = weightedTake(R, pool, C.ctx);
      }
      if (!key) key = i % 2 ? '_mora' : '_heal';
      const before = R.levels[key] || 0;
      apply(R, key, { deferEvo: true });
      const d = def(key);
      got.push({ key, level: key[0] === '_' ? 0 : R.levels[key], isNew: before === 0, evo: d.cat === 'evo', rarity: d.rarity || 3 });
    }
    return got;
  }

  function openChest(R, tier) {
    tier = CHEST[tier] ? tier : 'common';
    G.game.pause('chest'); R.lastChestOpenT = R.time;
    G.bus.emit('chestOpen', { tier });
    const got = rollChest(R, tier);
    const C = CHEST[tier];
    const mora = Math.round(U.randi(C.mora[0], C.mora[1]) * ((R.stats && R.stats.moraMul) || 1) * (got.jackpot ? 2 : 1));
    R.mora += mora;
    R.lastChest = { tier, items: got, mora, jackpot: got.jackpot };
    const flush = () => { for (const g of got) if (g.evo && !g.emitted) { g.emitted = true; G.bus.emit('evolution', { key: g.key }); } };
    if (G.debug && G.debug.autopick) {
      for (const g of got) if (g.choice) resolveChoice(R, g, (G.debug.chestPick && G.debug.chestPick(g.options)) || g.options[0]);
      flush(); G.game.resume('chest'); return;
    }
    let closed = false;
    G.ui.chest(R, tier, got.map(g => g.key), mora, () => { if (closed) return; closed = true; for (const g of got) if (g.choice) resolveChoice(R, g, g.options[0]); flush(); G.game.resume('chest'); }, got);
  }

  // blessings & milestones
  G.bus.on('levelUp', () => { const R = G.run; if (R && lv(R, 'bless_firework')) R.fireworkQ = (R.fireworkQ || 0) + 1; });
  G.bus.on('enemyKilled', () => {
    const R = G.run; if (!R || !R.player) return;
    if (lv(R, 'bless_dandelion')) R.dandelionN = (R.dandelionN || 0) + 1;
    // kill milestones: every 100 kills a big golden "star orb" of XP drops next to the player
    // milestones: 100, 300, 600, 1000, then every 1000 kills (balance v5: was every 100 → level-up spam in big hordes)
    const k = R.kills || 0, m = k < 1000 ? (k >= 600 ? 3 : k >= 300 ? 2 : k >= 100 ? 1 : 0) : 3 + Math.floor(k / 1000);
    if (m > (R.killMilestone || 0)) {
      R.killMilestone = m;
      const p = R.player, a = U.rand(0, U.TAU);
      G.loot.add(R, { type: 'xp', x: p.x + Math.cos(a) * 2.5, y: p.y + Math.sin(a) * 2.5, value: Math.max(40, Math.round(p.xpNeed * 0.5)), big: true, star: true, vz: 10 });
      G.bus.emit('notice', { text: U.fmtNum(k) + '体撃破！ 星の大玉だ！', color: '#ffd24a' });
      G.audio.sfx('star', { rarity: 4 });
    }
  });
  G.bus.on('enemyHit', h => {
    const R = G.run; if (!R || !h || !h.crit || !lv(R, 'bless_favonius')) return;
    if (R.time - (R.blessT.fav || -9) < 0.8 || !U.chance(0.3)) return;
    R.blessT.fav = R.time; const e = h.enemy || R.player;
    G.loot.add(R, { type: 'energy', x: e.x, y: e.y, value: 2.5, vz: 6 });
  });

  // C6: burst buff; electro resonance: reactions restore energy
  G.bus.on('burst', () => {
    const R = G.run; if (!R || !R.stats || !R.stats.burstBuff) return;
    R.buffs = R.buffs || {}; R.buffs.burstBuffUntil = R.time + 10; G.player.refreshStats(R);
  });
  G.bus.on('reaction', () => {
    const R = G.run; if (!R || !R.stats || !R.stats.resonance || !R.stats.resonance.electro) return;
    if (R.time - (R.elecResT || -9) < 0.6) return;
    R.elecResT = R.time; G.player.addEnergy(R, 1.2);
  });

  const api = {
    computeStats, initRun, addXp, update, available, makeOffer, reroll, apply, openLevelUp, openChest, evoReady, rollChest, resolveChoice, newLaunchers,
    def, resonance: RES, constellations: CONST, constellationLevel, checkResonance, checkEvoReady, blessingPool, metaVal, shieldAuraByCombat: false,
  };
  return api;
})();
