/* relics.js — モンドの遺物 (artifacts) (owner: PROGRESSION).
   Save: G.save.data.relics = { unopened:number, owned:[piece], equipped:{slot:id}, nextId }
   piece = { id, slot:'flower'|'plume'|'sands'|'goblet'|'circlet', set, rarity:4|5, main:{k,v}, subs:[{k,v}], lock }
   API: G.relics.open() -> pieces, G.relics.applyMods(S,R), G.relics.renderPanel(container), G.relics.summary() */
'use strict';
G.relics = (function () {
  const U = G.u;
  const SLOTS = [
    { id: 'flower', name: '生の花', glyph: 'flower', mains: ['hp_flat'] },
    { id: 'plume', name: '死の羽', glyph: 'plume', mains: ['atk_flat'] },
    { id: 'sands', name: '時の砂', glyph: 'sands', mains: ['atk_pct', 'atk_pct', 'hp_pct', 'er', 'speed'] },
    { id: 'goblet', name: '空の杯', glyph: 'goblet', mains: ['pyro', 'pyro', 'atk_pct', 'hp_pct', 'def_flat'] },
    { id: 'circlet', name: '理の冠', glyph: 'circlet', mains: ['cr', 'cd', 'atk_pct', 'hp_pct'] },
  ];
  const SLOT = {}; SLOTS.forEach(s => { SLOT[s.id] = s; });
  // name, pct?, main value (★5), substat roll range (★5), score weight
  const ST = {
    hp_flat: { n: 'HP', main: 400, sub: [25, 40], w: 0.25 },
    atk_flat: { n: '攻撃力', main: 40, sub: [3, 5], w: 0.6 },
    def_flat: { n: '防御力', main: 35, sub: [4, 7], w: 0.3 },
    atk_pct: { n: '攻撃力', pct: 1, main: 0.30, sub: [0.041, 0.058], w: 1 },
    hp_pct: { n: 'HP', pct: 1, main: 0.30, sub: [0.041, 0.058], w: 0.4 },
    er: { n: 'チャージ効率', pct: 1, main: 0.35, sub: [0.045, 0.065], w: 0.5 },
    cr: { n: '会心率', pct: 1, main: 0.20, sub: [0.027, 0.039], w: 1 },
    cd: { n: '会心ダメージ', pct: 1, main: 0.40, sub: [0.054, 0.078], w: 1 },
    pyro: { n: '炎元素ダメージ', pct: 1, main: 0.30, sub: null, w: 0.9 },
    speed: { n: '移動速度', pct: 1, main: 0.12, sub: [0.015, 0.025], w: 0.5 },
  };
  const SUBS = ['hp_flat', 'atk_flat', 'def_flat', 'atk_pct', 'hp_pct', 'er', 'cr', 'cd', 'speed'];
  const SETS = {
    wind: { name: '風跡の騎士', c: '#5cf2c8', b2: '攻撃力 +18%', b4: '元素爆発ダメージ +35%' },
    flame: { name: '烈火の狩人', c: '#ff7a3d', b2: '炎元素ダメージ +15%', b4: '爆発範囲 ×1.25・過負荷ダメージ +40%' },
    luck: { name: 'モラ商人の夢', c: '#ffd24a', b2: 'モラ獲得量 +25%', b4: 'レベルアップの選択肢が 4枚 に！' },
  };
  const SET_KEYS = Object.keys(SETS);

  function data() {
    const S = G.save.data;
    if (!S.relics || typeof S.relics !== 'object') S.relics = {};
    const r = S.relics;
    if (typeof r.unopened !== 'number' || !(r.unopened >= 0)) r.unopened = 0;
    if (!Array.isArray(r.owned)) r.owned = [];
    if (!r.equipped || typeof r.equipped !== 'object') r.equipped = {};
    r.owned = r.owned.filter(p => p && SLOT[p.slot] && p.main && ST[p.main.k] && Array.isArray(p.subs));
    for (const s in r.equipped) if (!r.owned.some(p => p.id === r.equipped[s])) delete r.equipped[s];
    if (!r.nextId) r.nextId = r.owned.reduce((m, p) => Math.max(m, p.id | 0), 0) + 1;
    return r;
  }
  const byId = id => data().owned.find(p => p.id === id);

  /* ---------------- generation ---------------- */
  function roll(slotId, rarity) {
    const sl = SLOT[slotId], mul = rarity === 5 ? 1 : 0.78;
    const mk = U.pick(sl.mains);
    const piece = { slot: slotId, set: U.pick(SET_KEYS), rarity, main: { k: mk, v: ST[mk].main * mul }, subs: [], lock: false };
    const nSub = rarity === 5 ? (U.chance(0.35) ? 4 : 3) : U.randi(1, 3);
    const pool = SUBS.filter(k => k !== mk);
    U.shuffle(pool);
    for (let i = 0; i < nSub; i++) { const k = pool[i]; piece.subs.push({ k, v: U.rand(ST[k].sub[0], ST[k].sub[1]) * mul }); }
    // bonus upgrade rolls (as if levelled) — the dopamine part
    const extra = rarity === 5 ? U.randi(2, 4) : U.randi(0, 2);
    for (let i = 0; i < extra; i++) { const s = U.pick(piece.subs); s.v += U.rand(ST[s.k].sub[0], ST[s.k].sub[1]) * mul; }
    for (const s of piece.subs) s.v = round(s.k, s.v);
    piece.main.v = round(mk, piece.main.v);
    return piece;
  }
  function round(k, v) { return ST[k].pct ? Math.round(v * 1000) / 1000 : Math.round(v); }
  function score(p) {
    if (!p) return -1;
    let s = (ST[p.main.k].w * p.main.v / (ST[p.main.k].sub ? ST[p.main.k].sub[1] : 0.058)) * 0.5;
    for (const x of p.subs) s += ST[x.k].w * x.v / ST[x.k].sub[1];
    return s + (p.rarity === 5 ? 1 : 0);
  }
  /** open one モンドの遺物: 5 pieces (one per slot), auto-equips improvements. Returns [{piece, equipped, prev}] */
  function open() {
    const r = data(); if (r.unopened <= 0) return null;
    r.unopened--;
    const out = [];
    for (const sl of SLOTS) {
      const p = roll(sl.id, U.chance(0.4) ? 5 : 4); p.id = r.nextId++; r.owned.push(p);
      const prev = byId(r.equipped[sl.id]);
      const better = !prev || score(p) > score(prev);
      if (better) r.equipped[sl.id] = p.id;
      out.push({ piece: p, equipped: better, prev: prev || null });
    }
    G.save.write();
    return out;
  }

  /* ---------------- stats ---------------- */
  function totals() {
    const r = data(), t = {}, sets = {};
    for (const sl of SLOTS) {
      const p = byId(r.equipped[sl.id]); if (!p) continue;
      t[p.main.k] = (t[p.main.k] || 0) + p.main.v;
      for (const s of p.subs) t[s.k] = (t[s.k] || 0) + s.v;
      sets[p.set] = (sets[p.set] || 0) + 1;
    }
    return { t, sets };
  }
  function applyMods(S, R) {
    const { t, sets } = totals();
    S.atk = (S.atk + (t.atk_flat || 0)) * (1 + (t.atk_pct || 0));
    S.maxHp = (S.maxHp + (t.hp_flat || 0)) * (1 + (t.hp_pct || 0));
    S.def += t.def_flat || 0;
    S.recharge += t.er || 0;
    S.critRate += t.cr || 0;
    S.critDmg += t.cd || 0;
    S.speed *= 1 + (t.speed || 0);
    if (t.pyro) S.elBonus.pyro = (S.elBonus.pyro || 0) + t.pyro;
    if (sets.wind >= 2) S.atk *= 1.18;
    if (sets.wind >= 4) S.rainMul *= 1.35;
    if (sets.flame >= 2) S.elBonus.pyro = (S.elBonus.pyro || 0) + 0.15;
    if (sets.flame >= 4) { S.explosionMul *= 1.25; S.reactionBonus += 0.4; }
    if (sets.luck >= 2) S.moraMul *= 1.25;
    if (sets.luck >= 4) S.offerCount = 4;
    S.relicSets = sets;
  }
  const fmt = (k, v) => ST[k].pct ? '+' + (Math.round(v * 1000) / 10) + '%' : '+' + Math.round(v);
  const label = (k, v) => ST[k].n + ' ' + fmt(k, v);

  function summary() {
    const { t, sets } = totals();
    return { stats: Object.keys(t).map(k => ({ k, name: ST[k].n, text: label(k, t[k]) })), sets: Object.keys(sets).map(s => ({ key: s, name: SETS[s].name, count: sets[s], b2: SETS[s].b2, b4: SETS[s].b4 })) };
  }

  /* ---------------- panel ---------------- */
  function renderPanel(container) {
    const UI = G.progressionUI; UI.ensureCss();
    const glyph = UI.glyph;
    container.innerHTML = '';
    const root = document.createElement('div'); root.className = 'pg-panel pg-relicp'; root.style.position = 'relative';
    container.append(root);
    function pieceTile(p, o) {
      o = o || {};
      const b = document.createElement('button');
      if (!p) { b.className = 'pg-rp empty'; b.innerHTML = `<div class="pg-rg">${glyph(SLOT[o.slot].glyph)}</div><div class="pg-rs">${SLOT[o.slot].name}</div><div class="pg-rs" style="color:#fff6">なし</div>`; return b; }
      b.className = 'pg-rp r' + p.rarity;
      b.innerHTML = `${p.lock ? `<span class="pg-rl">${glyph('lock')}</span>` : ''}${o.eq ? '<span class="pg-req">装備</span>' : ''}
        <div class="pg-rg" style="color:${SETS[p.set].c}">${glyph(SLOT[p.slot].glyph)}</div>${UI.stars(p.rarity)}
        <div class="pg-rs">${o.full ? SLOT[p.slot].name : ''}${o.full ? '<br>' : ''}${label(p.main.k, p.main.v)}</div>`;
      b.addEventListener('click', () => detail(p));
      return b;
    }
    function draw() {
      const r = data(), sm = summary();
      const eqIds = new Set(Object.values(r.equipped));
      root.innerHTML = `<div class="pg-ph"><h3>モンドの遺物</h3><span class="pg-purse"><img src="assets/icon_mora.webp" alt="">${U.fmtNum(G.save.data.mora || 0)}</span></div>
        <div class="pg-rtop"><div class="pg-rbox${r.unopened ? ' has' : ''}"><img src="assets/icon_relic.webp" alt=""><div><b>未開封 ×${r.unopened}</b><small>ボスをたおすと手に入る</small><br>
        <button class="pg-btn gold pg-open" ${r.unopened ? '' : 'disabled'} style="margin-top:4px">開く！</button></div></div>
        <div class="pg-rsum">${sm.stats.length ? sm.stats.map(s => `<span class="pg-chip">${s.text}</span>`).join('') : '<span class="pg-chip off">まだ装備なし</span>'}
        ${sm.sets.map(s => `<span class="pg-chip set${s.count >= 2 ? '' : ' off'}" style="border-color:${SETS[s.key].c}">${s.name} ${s.count}/4 ${s.count >= 2 ? '・' + s.b2 : ''}${s.count >= 4 ? '・' + s.b4 : ''}</span>`).join('')}</div></div>
        <div class="pg-eq"></div><div class="pg-ph" style="margin-top:4px"><h3 style="font-size:15px">持っている遺物 (${r.owned.length})</h3>
        <button class="pg-btn pg-salv" style="font-size:13px;min-height:32px;padding:3px 12px">★4をまとめて分解</button></div><div class="pg-inv"></div>`;
      const eq = root.querySelector('.pg-eq');
      for (const sl of SLOTS) eq.append(pieceTile(byId(r.equipped[sl.id]), { slot: sl.id, eq: true, full: true }));
      const inv = root.querySelector('.pg-inv');
      const list = r.owned.slice().sort((a, b) => (eqIds.has(b.id) - eqIds.has(a.id)) || (b.rarity - a.rarity) || (score(b) - score(a)));
      if (!list.length) inv.innerHTML = '<div class="pg-empty">遺物はまだありません。遺跡守衛やウェンティをたおそう！</div>';
      for (const p of list) inv.append(pieceTile(p, { eq: eqIds.has(p.id) }));
      root.querySelector('.pg-open').addEventListener('click', openAnim);
      root.querySelector('.pg-salv').addEventListener('click', () => {
        const n = salvageMany(p => p.rarity === 4 && !p.lock && !eqIds.has(p.id));
        if (!n) { G.audio.sfx('denied'); return; }
        G.audio.sfx('mora'); draw(); G.bus.emit('moraChange', G.save.data.mora);
      });
    }
    function salvageMany(f) {
      const r = data(); let got = 0, n = 0;
      r.owned = r.owned.filter(p => { if (f(p)) { got += p.rarity === 5 ? 120 : 40; n++; return false; } return true; });
      if (n) { G.save.data.mora = (G.save.data.mora || 0) + got; G.save.write(); }
      return n;
    }
    function detail(p) {
      const r = data(), eqd = r.equipped[p.slot] === p.id, cur = byId(r.equipped[p.slot]);
      const d = score(p) - score(cur);
      const ov = document.createElement('div'); ov.className = 'pg-rdet';
      ov.innerHTML = `<div class="pg-rcard r${p.rarity}"><div class="pg-rtop2"><div class="pg-rg" style="color:${SETS[p.set].c}">${glyph(SLOT[p.slot].glyph)}</div>
        <div><h4>${SLOT[p.slot].name}</h4>${UI.stars(p.rarity)}<div class="pg-rmain">${label(p.main.k, p.main.v)}</div></div></div>
        <ul>${p.subs.map(s => `<li>${label(s.k, s.v)}</li>`).join('')}</ul>
        <div class="pg-rset"><b style="color:${SETS[p.set].c}">${SETS[p.set].name}</b><br>2セット: ${SETS[p.set].b2}<br>4セット: ${SETS[p.set].b4}</div>
        ${!eqd && cur ? `<div class="pg-cmp ${d >= 0 ? 'up' : 'down'}">いまの装備より ${d >= 0 ? 'つよい ▲' : 'よわい ▼'}</div>` : ''}
        <div class="pg-racts"><button class="pg-btn gold a-eq" ${eqd ? 'disabled' : ''}>${eqd ? '装備中' : '装備する'}</button>
        <button class="pg-btn a-lock">${glyph('lock')} ${p.lock ? 'ロック解除' : 'ロック'}</button>
        <button class="pg-btn a-salv" ${p.lock || eqd ? 'disabled' : ''}>分解 +${p.rarity === 5 ? 120 : 40}</button>
        <button class="pg-btn a-x">とじる</button></div></div>`;
      const shut = () => ov.remove();
      ov.addEventListener('click', e => { if (e.target === ov) shut(); });
      ov.querySelector('.a-x').addEventListener('click', () => { G.audio.sfx('ui'); shut(); });
      ov.querySelector('.a-eq').addEventListener('click', () => { r.equipped[p.slot] = p.id; G.save.write(); G.audio.sfx('relic'); shut(); draw(); });
      ov.querySelector('.a-lock').addEventListener('click', () => { p.lock = !p.lock; G.save.write(); G.audio.sfx('ui'); shut(); draw(); detail(p); });
      ov.querySelector('.a-salv').addEventListener('click', () => { salvageMany(x => x.id === p.id); G.audio.sfx('mora'); shut(); draw(); G.bus.emit('moraChange', G.save.data.mora); });
      document.body.append(ov);
    }
    function openAnim() {
      const res = open(); if (!res) { G.audio.sfx('denied'); return; }
      draw();
      const best = res.reduce((m, x) => Math.max(m, x.piece.rarity), 4);
      const RC = UI.RC;
      const ov = document.createElement('div'); ov.className = 'pg-ov pg-chest'; ov.style.position = 'fixed'; ov.style.zIndex = 1000;
      ov.style.setProperty('--tc', '#9fe8c8'); ov.style.setProperty('--mc', RC[best]);
      ov.innerHTML = `<div class="pg-sky"></div><div class="pg-tier">モンドの遺物</div><div class="pg-skip">タップでスキップ ▶▶</div>
        <div class="pg-box"><img src="assets/icon_relic.webp" alt=""></div><div class="pg-reveal" style="display:none"></div>
        <div class="pg-close"><button class="pg-btn gold">OK！</button></div>`;
      document.body.append(ov);
      const reveal = ov.querySelector('.pg-reveal'), box = ov.querySelector('.pg-box');
      const timers = [], at = (ms, f) => timers.push(setTimeout(f, ms));
      let finished = false;
      const slots = res.map(x => {
        const p = x.piece, s = document.createElement('div'); s.className = 'pg-slot'; s.style.setProperty('--rc', RC[p.rarity]); s.style.width = 'clamp(92px,16vw,160px)';
        s.innerHTML = `<div class="pg-pillar"></div><div class="pg-card r${p.rarity}" style="min-height:0;height:auto">
          <div class="pg-top" style="height:clamp(70px,16vh,110px)">${x.equipped ? '<span class="pg-new">装備！</span>' : ''}
          <div class="pg-art" style="color:${SETS[p.set].c};font-size:clamp(40px,9vh,70px)">${glyph(SLOT[p.slot].glyph)}</div></div>
          <div class="pg-body">${UI.stars(p.rarity)}<div class="pg-name" style="font-size:clamp(13px,2.6vh,16px)">${SLOT[p.slot].name}</div>
          <div class="pg-desc"><b>${label(p.main.k, p.main.v)}</b><br>${p.subs.map(s => label(s.k, s.v)).join('<br>')}</div></div></div>`;
        reveal.append(s); return s;
      });
      function finish() {
        if (finished) return; finished = true; timers.forEach(clearTimeout);
        box.remove(); ov.querySelectorAll('.pg-meteor,.pg-bloom,.pg-skip').forEach(n => n.remove());
        reveal.style.display = ''; slots.forEach(s => { if (!s.classList.contains('show')) s.classList.add('instant'); });
        ov.querySelector('.pg-close').classList.add('show');
      }
      ov.addEventListener('click', e => { if (!finished) return finish(); ov.remove(); draw(); });
      G.audio.sfx('chestOpen', { tier: 'relic' });
      at(200, () => box.classList.add('shake'));
      at(750, () => { box.classList.add('gone'); const m = document.createElement('div'); m.className = 'pg-meteor'; ov.append(m); G.audio.sfx('star', { rarity: best }); });
      at(1500, () => { ov.querySelectorAll('.pg-meteor').forEach(n => n.remove()); const b = document.createElement('div'); b.className = 'pg-bloom'; ov.append(b); reveal.style.display = ''; });
      res.forEach((x, i) => at(1700 + i * 420, () => { slots[i].classList.add('show'); G.audio.sfx('chestReveal', { rarity: x.piece.rarity }); }));
      at(1700 + res.length * 420 + 200, finish);
    }
    draw();
    return root;
  }

  return { SLOTS, STATS: ST, SETS, data, open, roll, score, applyMods, totals, summary, renderPanel, label };
})();
