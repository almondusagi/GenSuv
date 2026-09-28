/* combat.js — damage pipeline, crits, elemental auras & reactions (Genshin-based, simplified).
   Everyone deals damage to enemies through G.combat.hit / G.combat.aoe so numbers, reactions,
   hit flashes, knockback, kill credit and stats stay consistent.
   Extra (optional) API: G.combat.applyAura(R, e, el, gauge) — apply an element without damage
   (used by the cryo "snowfall" launcher). */
'use strict';
G.combat = (function () {
  const U = G.u;
  const AURA_ELEMENTS = { pyro: 1, hydro: 1, cryo: 1, electro: 1 };
  const REACT = {
    vaporize:     { name: '蒸発',   color: '#ffb27a' },
    melt:         { name: '溶解',   color: '#ffcf9a' },
    overloaded:   { name: '過負荷', color: '#ff6b8b' },
    electrocharged:{ name: '感電',  color: '#d59bff' },
    frozen:       { name: '凍結',   color: '#b9f6ff' },
    superconduct: { name: '超電導', color: '#c6b9ff' },
    swirl:        { name: '拡散',   color: '#7dffd8' },
    crystallize:  { name: '結晶化', color: '#ffe27a' },
    shatter:      { name: '氷砕き', color: '#e8fbff' },
  };
  // per-step budgets so chain reactions stay spectacular but never tank the frame rate
  const budget = { overloaded: 0, swirl: 0, text: 0, num: 0, bigNum: 0 };
  let lastHitstop = -1, lastCrystal = -1, lastKick = -1, lastMass = -99;
  // reaction chain ("反応連鎖"): reactions within a short window build a counter shown at milestones
  const chain = { n: 0, t: -99, shown: 0 };

  function initRun(R) { R.damageBySrc = {}; R.reactions = {}; R.damageDealt = R.damageDealt || 0; lastHitstop = -1; lastCrystal = -1; lastKick = -1; lastMass = -99; chain.n = 0; chain.t = -99; chain.shown = 0; R.maxChain = 0; }
  const reduced = () => !!(G.save && G.save.data.settings.reducedFx);

  /** transformative reaction base damage (scales with run level like Genshin's level multiplier) */
  function reactionBase(R, mul) { return R.stats.atk * mul * (1 + 0.05 * (R.player.level - 1)) * (1 + (R.stats.reactionBonus || 0)); }

  function countReaction(R, key, e) {
    R.reactions[key] = (R.reactions[key] || 0) + 1;
    G.bus.emit('reaction', { type: key, x: e.x, y: e.y, enemy: e });
    if (budget.text-- > 0) G.fx.reactionText && G.fx.reactionText(e.x, e.y - e.def.h * 0.9, REACT[key].name, REACT[key].color);
    // chain counter: keeps growing while reactions keep coming (gap < 1.6 s)
    if (R.time - chain.t > 1.6) { chain.n = 0; chain.shown = 0; }
    chain.t = R.time; chain.n++;
    if (chain.n > (R.maxChain || 0)) R.maxChain = chain.n;
    const step = chain.n < 50 ? 10 : chain.n < 200 ? 25 : 100;
    if (chain.n >= 10 && chain.n >= chain.shown + step) {
      chain.shown = chain.n - (chain.n % step);
      const p = R.player, hot = chain.shown >= 50;
      G.fx.reactionText && G.fx.reactionText(p.x + U.rand(-0.6, 0.6), p.y - 3.1, '反応連鎖 ×' + chain.shown + '!', hot ? '#ffe27a' : '#9ff3ff');
      if (hot) { G.fx.zoomPunch && G.fx.zoomPunch(0.02); G.fx.sparkle && G.fx.sparkle(p.x, p.y - 2.6, '#ffe9a8', 10, 1.2); }
      G.audio.sfx('comboUp', { vol: 0.5 });
    }
    // reaction sfx is played by AUDIO from the 'reaction' bus event
  }

  /** apply an element to enemy e; returns {mul, reaction} for the triggering hit */
  function applyElement(R, e, el, gauge, opts) {
    const now = R.time; let mul = 1, reaction = null;
    let aura = e.aura && e.aura.until > now ? e.aura : null;
    if (!el || el === 'physical') {
      if (e.frozenUntil > now && opts && opts.blunt) { reaction = 'shatter'; e.frozenUntil = now; }
      return { mul, reaction };
    }
    if (gauge <= 0) return { mul, reaction };
    // elemental slimes carry their element like in Genshin (innate aura): Amber's pyro arrows vaporize hydro slimes,
    // melt cryo slimes and blow up electro slimes (overloaded) even without launchers. Re-arms 1.2 s after a reaction.
    if (!aura && e.def.element && AURA_ELEMENTS[e.def.element] && now >= (e.innateNext || 0) && el !== e.def.element) {
      aura = e.aura = { el: e.def.element, gauge: 1, until: now + 1e6, innate: true };
    }
    if (el === 'anemo') {
      if (aura) { reaction = 'swirl'; const ael = aura.el; aura.gauge -= 0.5 * gauge; if (aura.gauge <= 0 || aura.innate) { e.aura = null; if (aura.innate) e.innateNext = now + 1.2; } swirl(R, e, ael); }
      else if (e.frozenUntil > now) { reaction = 'swirl'; swirl(R, e, 'cryo'); }
      return { mul, reaction };
    }
    if (el === 'geo') {
      if (e.frozenUntil > now) { reaction = 'shatter'; e.frozenUntil = now; }
      else if (aura) {
        reaction = 'crystallize';
        if (R.time - lastCrystal > 0.45) { lastCrystal = R.time; G.loot && G.loot.dropCrystal && G.loot.dropCrystal(R, e.x + U.rand(-0.4, 0.4), e.y + U.rand(-0.4, 0.4), aura.el); }
        aura.gauge -= 0.5 * gauge; if (aura.gauge <= 0 || aura.innate) { e.aura = null; if (aura.innate) e.innateNext = now + 1.2; }
      }
      return { mul, reaction };
    }
    if (!aura) { e.aura = { el, gauge, until: now + 3 + 4 * gauge }; return { mul, reaction }; }
    const a = aura.el;
    if (a === el) { aura.gauge = Math.max(aura.gauge, gauge); aura.until = Math.max(aura.until, now + 3 + 4 * gauge); return { mul, reaction }; }
    switch (a + '+' + el) {
      case 'hydro+pyro': reaction = 'vaporize'; mul = 1.5; break;
      case 'pyro+hydro': reaction = 'vaporize'; mul = 2; break;
      case 'cryo+pyro': reaction = 'melt'; mul = 2; break;
      case 'pyro+cryo': reaction = 'melt'; mul = 1.5; break;
      case 'pyro+electro': case 'electro+pyro': reaction = 'overloaded'; break;
      case 'cryo+electro': case 'electro+cryo': reaction = 'superconduct'; break;
      case 'hydro+electro': case 'electro+hydro': reaction = 'electrocharged'; break;
      case 'hydro+cryo': case 'cryo+hydro': reaction = 'frozen'; break;
    }
    if (reaction === 'vaporize' || reaction === 'melt') mul *= 1 + (R.stats.amplifyBonus || 0);
    if (reaction && aura.innate) { e.innateNext = now + 1.2; e.aura = null; }
    // consume aura
    aura.gauge -= (mul >= 2 ? 2 : mul > 1 ? 0.5 : 1) * gauge;
    if (aura.gauge <= 0 || reaction === 'overloaded' || reaction === 'superconduct' || reaction === 'frozen') e.aura = null;
    if (reaction === 'overloaded') overloaded(R, e);
    else if (reaction === 'superconduct') superconduct(R, e);
    else if (reaction === 'electrocharged') { e.ecUntil = now + 4; e.ecNext = now + 0.25; e.aura = { el: 'hydro', gauge: 1, until: now + 4 }; e.aura2 = 'electro'; }
    else if (reaction === 'frozen') freeze(R, e, e.def.boss ? 0.6 : e.def.elite ? 1.4 : 2.8);
    return { mul, reaction };
  }

  function freeze(R, e, dur) {
    e.frozenUntil = Math.max(e.frozenUntil || 0, R.time + dur);
    e.kx = e.ky = 0;
    if (!reduced()) G.fx.burst(e.x, e.y - e.def.h * 0.4, 8, '#e6fdff', { max: 4, life: 0.4, size: 0.14 });
  }

  /** apply an element without dealing damage (weather/aura effects) */
  function applyAura(R, e, el, gauge) {
    if (!e || e.dead) return null;
    const aura = e.aura && e.aura.until > R.time ? e.aura : null;
    // amplifying reactions need a damaging hit: a damage-less source just overwrites the aura
    if (aura && aura.el !== el && ((aura.el === 'pyro' && (el === 'cryo' || el === 'hydro')) || (el === 'pyro' && (aura.el === 'cryo' || aura.el === 'hydro')))) {
      e.aura = { el, gauge, until: R.time + 3 + 4 * gauge }; return null;
    }
    const r = applyElement(R, e, el, gauge, null);
    if (r.reaction) countReaction(R, r.reaction, e);
    return r.reaction;
  }

  // overload blasts carry a little pyro (gauge 0.5): electro/cryo/hydro-marked neighbours react again → explosive chains
  function overloaded(R, e) {
    const r = 1.8 * R.stats.explosionMul; // "explosion" type: Amber's passive (x2) applies
    const dmg = reactionBase(R, 2.0); // balance v5: 2.8→2.4→2.0, radius 2.2→1.8 (was a screen-clearer in the opening)
    if (budget.overloaded-- > 0) {
      G.fx.explosion && G.fx.explosion(e.x, e.y, r, { color: '#ff5a7a', kind: 'overload' });
      G.audio.sfx('explosion', { x: e.x, y: e.y });
      aoe(R, e.x, e.y, r, { flat: dmg, element: 'pyro', gauge: 0.5, src: 'overloaded', knock: 1.6, noCrit: true, isReaction: true, exclude: e, color: '#ff8aa0' });
      hit(R, e, { flat: dmg, element: 'pyro', gauge: 0, src: 'overloaded', knock: 1.6, noCrit: true, isReaction: true, color: '#ff8aa0' });
    } else {
      // over budget: still hurt the trigger target (and knock it) so chains remain rewarding
      hit(R, e, { flat: dmg, element: 'pyro', gauge: 0, src: 'overloaded', knock: 1.2, noCrit: true, isReaction: true, color: '#ff8aa0' });
    }
  }
  function superconduct(R, e) {
    const r = 3 * (R.stats.areaMul || 1);
    G.fx.ring && G.fx.ring(e.x, e.y, r, '#c6b9ff');
    if (!reduced()) G.fx.burst(e.x, e.y - 0.6, 14, '#d7ceff', { max: 7, life: 0.5 });
    aoe(R, e.x, e.y, r, { flat: reactionBase(R, 0.9), element: 'cryo', gauge: 0, src: 'superconduct', noCrit: true, isReaction: true, color: '#c6b9ff',
      each: t => { t.vulnUntil = R.time + 8; } });
  }
  function swirl(R, e, el) {
    const r = 3.4 * (R.stats.areaMul || 1);
    const c = G.EL[el].color;
    const dmg = reactionBase(R, 1.0);
    if (budget.swirl-- > 0) {
      G.fx.swirl && G.fx.swirl(e.x, e.y, r, c);
      if (!reduced()) { // coloured spiral arms
        for (let i = 0; i < 14; i++) {
          const a = i / 14 * U.TAU, s = 3 + (i % 3) * 1.5;
          G.fx.particle({ x: e.x + Math.cos(a) * 0.4, y: e.y - 0.5 + Math.sin(a) * 0.3, vx: Math.cos(a + 1.2) * s, vy: Math.sin(a + 1.2) * s * 0.7, life: 0.5, size: 0.16, color: c, glow: true, drag: 2.5 });
        }
      }
      aoe(R, e.x, e.y, r, { flat: dmg, element: el, gauge: 1, src: 'swirl', noCrit: true, isReaction: true, noSwirlChain: true, exclude: e, color: c });
    }
    hit(R, e, { flat: dmg, element: el, gauge: 0, src: 'swirl', noCrit: true, isReaction: true, color: c });
  }

  /**
   * Hit a single enemy.
   * opts: { mul (×ATK) | flat, element, gauge(default 1), src, knock, kx,ky (knock dir), noCrit, isReaction, blunt, silent, color }
   * returns damage dealt (0 if enemy invalid)
   */
  function hit(R, e, opts) {
    if (!e || e.dead || (e.spawnT > 0.001 && e.invulnSpawn)) return 0;
    const S = R.stats; const el = opts.element || 'physical';
    let dmg = opts.flat != null ? opts.flat : (opts.mul || 1) * S.atk;
    if (!opts.isReaction) dmg *= 1 + (S.dmgBonus || 0) + ((S.elBonus && S.elBonus[el]) || 0);
    let crit = false;
    if (!opts.noCrit && U.rnd() < S.critRate + (opts.critBonus || 0)) { crit = true; dmg *= 1 + S.critDmg; }
    let reaction = null;
    if ((!opts.isReaction || opts.gauge) && !(opts.noSwirlChain && el === 'anemo')) {
      const r = applyElement(R, e, el, opts.gauge == null ? 1 : opts.gauge, opts);
      dmg *= r.mul; reaction = r.reaction;
    }
    if (e.vulnUntil > R.time) dmg *= 1.35;
    if (reaction === 'shatter') dmg += reactionBase(R, 2.2);
    if (e.def.boss && e.armorMul) dmg *= e.armorMul;
    dmg = Math.max(1, Math.round(dmg * (0.95 + U.rnd() * 0.1)));
    e.hp -= dmg; e.flash = 1; e.lastHit = R.time;
    R.damageDealt = (R.damageDealt || 0) + dmg;
    const src = opts.src || el;
    R.damageBySrc[src] = (R.damageBySrc[src] || 0) + dmg;
    if (reaction) countReaction(R, reaction, e);
    // knockback (bosses resist, frozen enemies don't slide)
    if (opts.knock && !e.def.boss && !(e.frozenUntil > R.time)) {
      let kx = opts.kx, ky = opts.ky;
      if (kx == null) { const n = U.norm(e.x - R.player.x, e.y - R.player.y); kx = n.x; ky = n.y; }
      const k = opts.knock * (e.def.elite ? 0.3 : 1) / Math.max(0.6, e.r * 1.6);
      e.kx += kx * k * 8; e.ky += ky * k * 8;
    }
    // quiet: ambient damage (weather, burning ground) only pops numbers for crits/reactions
    if (!opts.silent && !(opts.quiet && !crit && !reaction)) {
      const amp = reaction === 'vaporize' || reaction === 'melt' || reaction === 'shatter';
      const big = crit || amp;
      // number size grows with the hit's weight relative to ATK: big hits look BIG (crits and amplified reactions extra)
      const rel = dmg / S.atk;
      // number budget per step: crits/reactions are the fun ones, but hundreds of them per second in a late-game horde
      // turn into unreadable (and costly) noise; the heaviest hits always get through
      const fancy = crit || reaction, huge = rel >= 12;
      if (!fancy || (huge ? budget.bigNum-- > 0 : budget.num-- > 0)) {
        const size = 0.46 + Math.min(0.62, Math.log10(1 + rel) * 0.3) + (amp ? 0.16 : 0) + (crit && rel > 6 ? 0.08 : 0);
        G.fx.number(e.x, e.y - e.def.h * 0.75, dmg, { element: el, crit, reaction: reaction && REACT[reaction].name, color: opts.color, size });
      }
      G.fx.hitSpark && G.fx.hitSpark(e.x, e.y - e.def.h * 0.4, el, big);
      // hit-stop: tiny freeze on meaty crits, a longer one on genuinely huge hits (both rate-limited so hordes never stutter)
      const since = R.realTime - lastHitstop;
      if (big && rel > 9 && since > 0.3) { lastHitstop = R.realTime; G.fx.hitstop(rel > 30 ? 0.06 : 0.04); }
      else if (crit && !opts.isReaction && rel > 2.5 && since > 0.22) { lastHitstop = R.realTime; G.fx.hitstop(0.018); }
      // directional camera kick on heavy single hits (respects the screen-shake setting inside G.fx.kick)
      if (big && rel > 5 && R.realTime - lastKick > 0.18 && G.fx.kick) { lastKick = R.realTime; G.fx.kick(opts.kx != null ? opts.kx : e.x - R.player.x, opts.ky != null ? opts.ky : e.y - R.player.y, Math.min(7, 2 + rel * 0.15)); }
    }
    G.bus.emit('enemyHit', { enemy: e, dmg, crit, element: el, reaction, src: opts.src });
    if (e.hp <= 0) G.enemies.kill(R, e, src);
    return dmg;
  }

  /** area hit; returns number of enemies hit. opts as hit() plus {each(enemy), exclude, max, filter(e)} */
  const pool = []; let depth = 0;
  function aoe(R, x, y, radius, opts) {
    const list = pool[depth] || (pool[depth] = []); list.length = 0;
    depth++;
    try {
      R.grid.query(x, y, radius, e => { if (e !== opts.exclude && !e.dead && (!opts.filter || opts.filter(e))) list.push(e); });
      if (opts.max && list.length > opts.max) { list.sort((a, b) => U.dist2(a.x, a.y, x, y) - U.dist2(b.x, b.y, x, y)); list.length = opts.max; }
      const o = Object.assign({}, opts);
      let n = 0; const k0 = R.kills;
      for (let i = 0; i < list.length; i++) {
        const e = list[i]; if (e.dead) continue;
        const dx = e.x - x, dy = e.y - y, l = Math.sqrt(dx * dx + dy * dy) || 1;
        o.kx = dx / l; o.ky = dy / l;
        hit(R, e, o);
        if (opts.each) opts.each(e);
        n++;
      }
      massKill(R, x, y, R.kills - k0);
      return n;
    } finally { depth--; list.length = 0; }
  }

  /** "big moment" when one blast wipes a crowd: brief slow-motion + punch (rate-limited, never during boss fights' spam) */
  function massKill(R, x, y, k) {
    if (k < 8 || R.realTime - lastMass < 2.2) return;
    lastMass = R.realTime;
    const huge = k >= 18;
    G.fx.slowmo(huge ? 0.3 : 0.45, huge ? 0.28 : 0.16);
    G.fx.zoomPunch && G.fx.zoomPunch(huge ? 0.045 : 0.025);
    G.fx.shake(huge ? 0.55 : 0.3);
    if (huge) { G.fx.flash && G.fx.flash('#fff3d6', 0.12); G.fx.reactionText && G.fx.reactionText(x, y - 2.4, k + '体 撃破!', '#ffd27a'); }
  }

  /** per-step status effects: electro-charged ticks; resets reaction budgets */
  function update(R, dt) {
    budget.overloaded = 5; budget.swirl = 7; budget.text = 10; budget.num = 1; budget.bigNum = 2;
    const now = R.time;
    for (let i = 0; i < R.enemies.length; i++) {
      const e = R.enemies[i];
      if (e.dead) continue;
      if (e.ecUntil > now && now >= e.ecNext) {
        e.ecNext = now + 0.6;
        const base = reactionBase(R, 0.9);
        hit(R, e, { flat: base, element: 'electro', gauge: 0, src: 'electrocharged', noCrit: true, isReaction: true, color: '#d59bff' });
        G.fx.zap && G.fx.zap(e.x, e.y - 0.8);
        // arc to up to two nearby wet enemies
        let arcs = 0;
        R.grid.query(e.x, e.y, 3.2, o => {
          if (o === e || !o.aura || o.aura.el !== 'hydro') return;
          hit(R, o, { flat: base * 0.8, element: 'electro', gauge: 0, src: 'electrocharged', noCrit: true, isReaction: true, color: '#d59bff' });
          G.fx.lightning && G.fx.lightning(e.x, e.y - 0.8, o.x, o.y - 0.8, '#d59bff');
          if (++arcs >= 2) return true;
        });
      } else if (e.ecUntil && e.ecUntil <= now) { e.ecUntil = 0; e.aura2 = null; }
    }
  }

  /** display name / icon for a damageBySrc key (results screen): upgrades and blessings by key, plus combat-only srcs */
  const SRC = {
    amber_charged: ['狙い撃ち', 'amber_arrow'], xq_normal: ['古華剣法・流水の舞', 'xingqiu'], ng_normal: ['千金の石粒', 'ningguang'], cy_normal: ['滅邪四式', 'chongyun'],meteor: ['bless_meteor'], firework: ['bless_firework'], dandelion: ['bless_dandelion'],
  };
  function srcName(k) {
    const m = SRC[k], up = G.upgrades && G.upgrades[m && m.length === 1 ? m[0] : k];
    if (up && up.name) return up.name;
    if (m && m.length > 1) return m[0];
    return REACT[k] ? REACT[k].name : null;
  }
  function srcIcon(k) {
    const m = SRC[k], up = G.upgrades && G.upgrades[m && m.length === 1 ? m[0] : k];
    if (up && up.icon) return up.icon;
    return m && m.length > 1 ? m[1] : null;
  }

  return { initRun, hit, aoe, update, applyElement, applyAura, freeze, reactionBase, REACT, AURA_ELEMENTS, srcName, srcIcon };
})();
