/* debugpanel.js — developer debug panel (owner: DEBUG TOOLS). Invisible to normal players.
   Enter / leave debug mode:  Shift + A + W + D pressed together (PC)  ·  tap the version text on the title screen 7 times (phone).
   The mode is remembered in localStorage ('mondo_debug' = '1') until it is switched off again.
   While debug mode is on, a small「DEBUG」button stays at the bottom of the screen to reopen the panel.
   Opening the panel pauses the run (G.game.pause('debug')).
   Tabs: 出撃 (debug sortie with custom start conditions + presets) · 進化 (evolution checker) · 強化 · 敵・ボス · 時間 · プレイヤー · 表示.
   Nothing here runs game logic while debug mode is off: every hook (AI stop, spawn stop, slow motion, hitboxes) is installed
   lazily the first time it is used. Helpers live in js/debug.js (G.debug.*). */
'use strict';
G.debugPanel = (function () {
  const el = G.ui.el, U = G.u;
  const K_ON = 'mondo_debug', K_PRE = 'mondo_debug_presets', K_CFG = 'mondo_debug_cfg', K_RESTORE = 'mondo_debug_restore';
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { } },
    json(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } },
  };
  let on = ls.get(K_ON) === '1';
  let wrap = null, body = null, tabsBar = null, head = null, fab = null, overlay = null;
  let isOpen = false, tab = 'evo', refresher = null, openedAt = 0, lastTab = null;
  // persistent toggles (memory only)
  const T = { god: false, noCd: false, infEnergy: false, hitbox: false, overlay: false, skipEvents: true, closeOnAttack: true, lvCards: true, speed: 1, bossKind: 'ruin', bossPhase: 1, enemyKind: 'mote', enemyN: 5, champion: false };
  const sfx = n => { try { G.audio.sfx(n); } catch (e) { } };

  /* ============================== sortie config ============================== */
  const defCfg = () => ({ char: 'amber', time: '0:00', level: 1, levels: {}, evolved: {}, meta: 'keep', mora: '', noRecord: true, ignoreLauncher: false, god: false });
  let cfg = Object.assign(defCfg(), ls.json(K_CFG, {}));
  const saveCfg = () => ls.set(K_CFG, JSON.stringify(cfg));
  function parseTime(s) {
    s = String(s || '').trim(); if (!s) return 0;
    const m = s.match(/^(\d+):(\d{1,2})$/); if (m) return (+m[1]) * 60 + (+m[2]);
    const n = parseFloat(s); return isFinite(n) ? Math.max(0, n) : 0;
  }
  const fmtT = t => { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };
  const charName = id => (G.data.characters[id] || {}).name || id;
  /** upgrade keys this character can own, grouped */
  function keysFor(charId) {
    const g = { char: [], launcher: [], stat: [], bless: [] };
    for (const k in G.upgrades) {
      const u = G.upgrades[k]; if (!g[u.cat]) continue;
      if (u.char && u.char !== charId) continue;
      g[u.cat].push(k);
    }
    return g;
  }
  const evosFor = charId => G.evolutions.filter(e => { const u = G.upgrades[e.key]; return !u.char || u.char === charId; });
  const GROUP = { char: 'キャラ専用', launcher: 'ランチャー', stat: '汎用ステータス', bless: '★5 天啓' };

  /* ============================== save protection ============================== */
  function restoreSave() {
    const raw = ls.get(K_RESTORE); if (!raw) return;
    ls.del(K_RESTORE);
    let st; try { st = JSON.parse(raw); } catch (e) { return; }
    const S = G.save.data, settings = S.settings;
    if (st.full) { for (const k of Object.keys(S)) delete S[k]; Object.assign(S, st.full); S.settings = settings; }
    else if (st.meta) { S.meta = st.meta.meta; if (st.meta.constellation === undefined) delete S.constellation; else S.constellation = st.meta.constellation; }
    G.save.write();
  }
  G.bus.on('assetsReady', restoreSave);                                        // page reloaded in the middle of a debug run
  G.bus.on('runEnd', R => { if (R && R.debugRun) restoreSave(); });
  G.bus.on('scene', name => { if (name !== 'run' && !G.run) restoreSave(); });

  function sortie(c) {
    c = c || cfg;
    const g = keysFor(c.char), allowed = new Set([].concat(g.char, g.launcher, g.stat, g.bless));
    const lau = Object.keys(c.levels).filter(k => allowed.has(k) && G.upgrades[k].cat === 'launcher' && c.levels[k] > 0);
    if (lau.length > G.launcherRules.MAX_KINDS && !c.ignoreLauncher) { toast('ランチャーが ' + lau.length + '種 — 2種までにするか「制限を無視」をONに', true); return; }
    restoreSave();
    close(true);
    const S = G.save.data;
    if (String(c.mora).trim() !== '' && isFinite(+c.mora)) { S.mora = Math.max(0, Math.floor(+c.mora)); G.save.write(); }
    const st = {};
    if (c.noRecord) st.full = JSON.parse(JSON.stringify(S));
    if (c.meta !== 'keep') {
      st.meta = { meta: JSON.parse(JSON.stringify(S.meta || {})), constellation: S.constellation === undefined ? undefined : JSON.parse(JSON.stringify(S.constellation)) };
      const M = {};
      if (c.meta === 'max') for (const k in G.data.meta) M[k] = G.data.meta[k].max;
      S.meta = M;
      const con = (S.constellation && typeof S.constellation === 'object') ? Object.assign({}, S.constellation) : {};
      con.amber = c.meta === 'max' ? 6 : 0; S.constellation = con;
    }
    if (st.full || st.meta) ls.set(K_RESTORE, JSON.stringify(st));
    G.startRun(c.char);
    const R = G.run; if (!R) return;
    R.debugRun = true;
    for (const k in c.levels) { const lv = c.levels[k] | 0; if (lv > 0 && allowed.has(k)) R.levels[k] = Math.min(G.upgrades[k].max, lv); }
    for (const k in c.evolved) if (c.evolved[k] && G.upgrades[k] && evosFor(c.char).some(e => e.key === k)) { R.evolved[k] = true; R.levels[k] = 1; }
    const p = R.player, L = Math.max(1, Math.min(200, c.level | 0 || 1));
    p.level = L; p.xp = 0; p.xpNeed = G.data.xpNeed(L); R.offerN = Math.max(R.offerN || 0, L - 1);
    G.player.refreshStats(R); p.hp = p.maxHp;
    const t = parseTime(c.time); if (t > 0) G.debug.jumpTo(t, true);
    G.progression.checkResonance(R); G.progression.checkEvoReady(R);
    G.bus.emit('upgrade', { key: null, level: 0 }); // HUD: refresh the owned-upgrade icons
    if (c.god) { T.god = true; }
    if (T.god) G.debug.god(true);
    tab = 'evo';
    toast('デバッグ出撃: ' + charName(c.char) + ' ' + fmtT(t) + ' Lv' + L);
  }

  /* ============================== mode on / off ============================== */
  function setMode(v) {
    on = !!v; ls.set(K_ON, on ? '1' : '0');
    if (!on) {
      close(); T.god = T.noCd = T.infEnergy = T.hitbox = T.overlay = false; T.speed = 1;
      if (G.debug.godMode) G.debug.god(false);
      if (G.debug.slow !== undefined || G.debug.speed !== 1) G.debug.setSpeed(1);
      if (G.debug.aiStopped) G.debug.aiStop(false);
      if (G.debug.spawnStopped) G.debug.spawnStop(false);
      toast('デバッグモード OFF');
    } else toast('デバッグモード ON（Shift+A+W+D でOFF）');
    syncFab(); syncOverlay();
  }
  function toggleMode() { if (on) setMode(false); else { setMode(true); open(); } }

  // --- Shift + A + W + D chord (own key-state tracking, fires once when the 4th key goes down) ---
  const held = new Set(); let latched = false;
  const CH = () => (held.has('ShiftLeft') || held.has('ShiftRight')) && held.has('KeyA') && held.has('KeyW') && held.has('KeyD');
  addEventListener('keydown', e => {
    held.add(e.code);
    if (CH()) { if (!latched) { latched = true; e.preventDefault(); toggleMode(); } }
  }, true);
  addEventListener('keyup', e => { held.delete(e.code); if (!CH()) latched = false; }, true);
  addEventListener('blur', () => { held.clear(); latched = false; });

  // --- phone: 7 taps in a row on the title screen's version text ---
  let taps = 0, lastTap = 0;
  addEventListener('pointerdown', e => {
    const t = e.target && e.target.closest && e.target.closest('.title-foot'); if (!t) return;
    const now = performance.now(); taps = now - lastTap < 700 ? taps + 1 : 1; lastTap = now;
    if (taps >= 7) { taps = 0; setTimeout(toggleMode, 380); } // after the tap's own click has landed
  }, true);

  /* ============================== DOM ============================== */
  function toast(text, bad) {
    const t = el('div', { class: 'dbg-toast' + (bad ? ' bad' : '') }, text); document.body.append(t);
    setTimeout(() => t.classList.add('out'), 1800); setTimeout(() => t.remove(), 2300);
  }
  function syncFab() {
    if (on && !fab) {
      fab = el('button', { class: 'dbg-fab', type: 'button', 'data-nonav': '', onclick: e => { e.stopPropagation(); isOpen ? close() : open(); } }, 'DEBUG');
      fab.addEventListener('pointerdown', e => e.stopPropagation());
      document.body.append(fab);
    } else if (!on && fab) { fab.remove(); fab = null; }
  }
  function syncOverlay() {
    const want = on && T.overlay;
    if (want && !overlay) { overlay = el('div', { class: 'dbg-ov' }); document.body.append(overlay); }
    else if (!want && overlay) { overlay.remove(); overlay = null; }
  }
  function build() {
    wrap = el('div', { class: 'dbg-wrap' });
    const pnl = el('div', { class: 'dbg-panel' });
    head = el('div', { class: 'dbg-info' });
    const top = el('div', { class: 'dbg-head' },
      el('b', { class: 'dbg-logo' }, 'DEBUG'), head,
      el('button', { class: 'dbg-b warn', type: 'button', onclick: () => setMode(false) }, 'デバッグOFF'),
      el('button', { class: 'dbg-b close', type: 'button', onclick: () => close() }, '✕ 閉じる'));
    tabsBar = el('div', { class: 'dbg-tabs' });
    body = el('div', { class: 'dbg-body' });
    pnl.append(top, tabsBar, body); wrap.append(pnl);
    wrap.addEventListener('keydown', e => { e.stopPropagation(); if (e.code === 'Escape') close(); });
    wrap.addEventListener('keyup', e => e.stopPropagation());
    wrap.addEventListener('pointerdown', e => { if (e.target === wrap) close(); });
    document.body.append(wrap);
  }
  const inRun = () => !!(G.run && G.scene === 'run');
  const TABS = [['sortie', '出撃'], ['evo', '進化'], ['up', '強化'], ['enemy', '敵・ボス'], ['time', '時間'], ['player', 'プレイヤー'], ['view', '表示']];
  function open(t) {
    if (!on) return;
    if (!wrap) build();
    if (t) tab = t;
    if (!inRun()) tab = 'sortie';
    isOpen = true; openedAt = performance.now(); wrap.classList.add('show');
    if (G.run && !G.run.over) G.game.pause('debug');
    render();
  }
  function close(silent) {
    if (!isOpen) return; isOpen = false;
    if (wrap) { wrap.classList.remove('show'); const a = document.activeElement; if (a && wrap.contains(a)) a.blur(); }
    if (G.run) G.game.resume('debug');
    refresher = null;
    if (!silent) sfx('ui');
  }

  /* small widgets */
  const B = (label, on, cls, title) => el('button', { class: 'dbg-b ' + (cls || ''), type: 'button', title: title || false, onclick: e => { if (performance.now() - openedAt < 300) return; sfx('ui'); on && on(e); } }, label); // ignore the ghost click of the tap that opened the panel
  const chk = (label, val, set) => { const i = el('input', { type: 'checkbox' }); i.checked = !!val; i.addEventListener('change', () => { set(i.checked); }); return el('label', { class: 'dbg-chk' + (val ? ' on' : '') }, i, el('span', null, label)); };
  const tog = (label, val, set) => B((val ? '● ' : '○ ') + label, () => { set(!val); render(); }, val ? 'on' : '');
  const sec = (title, ...kids) => el('section', { class: 'dbg-sec' }, title ? el('h4', null, title) : null, ...kids);
  const row = (...kids) => el('div', { class: 'dbg-row' }, ...kids);
  const seg = (opts, cur, set) => el('div', { class: 'dbg-seg' }, opts.map(([v, l]) => B(l, () => { set(v); render(); }, v === cur ? 'on' : '')));
  const num = (val, set, w) => { const i = el('input', { class: 'dbg-in', type: 'text', inputmode: 'decimal', value: String(val), style: w ? 'width:' + w + 'px' : false }); i.addEventListener('change', () => set(i.value)); return i; };
  const sel = (opts, cur, set) => { const s = el('select', { class: 'dbg-in' }, opts.map(([v, l]) => { const o = el('option', { value: v }, l); if (v === cur) o.selected = true; return o; })); s.addEventListener('change', () => set(s.value)); return s; };

  function render() {
    if (!wrap || !isOpen) return;
    const run = inRun();
    if (!run) tab = 'sortie';
    tabsBar.innerHTML = '';
    for (const [id, label] of TABS) {
      const dis = !run && id !== 'sortie';
      tabsBar.append(el('button', { class: 'dbg-tab' + (tab === id ? ' on' : ''), type: 'button', disabled: dis, onclick: () => { tab = id; sfx('ui'); render(); } }, label));
    }
    const y = lastTab === tab ? body.scrollTop : 0; lastTab = tab; body.innerHTML = ''; refresher = null;
    const f = { sortie: rSortie, evo: rEvo, up: rUp, enemy: rEnemy, time: rTime, player: rPlayer, view: rView }[tab] || rSortie;
    try { f(body); } catch (e) { console.error('[debugpanel]', e); body.append(el('p', { class: 'dbg-bad' }, 'パネルの描画エラー: ' + e.message)); }
    body.scrollTop = y;
    info();
  }
  function info() {
    if (!head) return;
    const R = G.run;
    head.textContent = R ? `${charName(R.charId)}  ⏱${fmtT(R.time)}  Lv${R.player.level}  敵${R.enemies.filter(e => !e.dead).length}  ${Math.round(G.fps)}fps` : `画面: ${G.scene}（出撃前）`;
  }

  /* ---------------- 出撃 ---------------- */
  function rSortie(b) {
    const c = cfg, g = keysFor(c.char);
    const set = (k, v) => { c[k] = v; saveCfg(); };
    const lvOf = k => c.levels[k] | 0;
    const setLv = (k, v) => { const m = G.upgrades[k].max; v = Math.max(0, Math.min(m, v | 0)); if (v) c.levels[k] = v; else delete c.levels[k]; saveCfg(); render(); };
    b.append(sec('キャラ', el('div', { class: 'dbg-seg' }, G.data.roster.map(id => B(charName(id), () => { set('char', id); render(); }, c.char === id ? 'on' : '')))));
    b.append(sec('開始時刻・レベル',
      row(el('span', { class: 'dbg-lb' }, '時刻'), num(c.time, v => { set('time', v); render(); }, 70),
        ...[['0:00', 0], ['2:55', 175], ['4:50', 290], ['5:00', 300], ['9:50', 590], ['10:00', 600]].map(([l]) => B(l, () => { set('time', l); render(); }, c.time === l ? 'on sm' : 'sm'))),
      row(el('span', { class: 'dbg-lb' }, 'レベル'), num(c.level, v => { set('level', Math.max(1, parseInt(v) || 1)); render(); }, 60),
        ...[1, 10, 20, 40].map(n => B('Lv' + n, () => { set('level', n); render(); }, c.level === n ? 'on sm' : 'sm')))));
    // upgrades
    const lau = g.launcher.filter(k => lvOf(k) > 0);
    const ups = sec('開始時の強化',
      row(B('ぜんぶMAX', () => { for (const cat in g) if (cat !== 'bless') for (const k of g[cat]) c.levels[k] = G.upgrades[k].max; saveCfg(); render(); }),
        B('ぜんぶ0', () => { c.levels = {}; saveCfg(); render(); }),
        chk('ランチャー2種制限を無視', c.ignoreLauncher, v => { set('ignoreLauncher', v); render(); })),
      lau.length > G.launcherRules.MAX_KINDS ? el('p', { class: c.ignoreLauncher ? 'dbg-warn' : 'dbg-bad' }, `⚠ ランチャー ${lau.length}種（ゲームでは1回の冒険で${G.launcherRules.MAX_KINDS}種まで）` + (c.ignoreLauncher ? ' — 無視して出撃します' : ' — このままでは出撃できません')) : null);
    for (const cat of ['char', 'launcher', 'stat', 'bless']) {
      if (!g[cat].length) continue;
      ups.append(el('h5', null, GROUP[cat]), el('div', { class: 'dbg-grid' }, g[cat].map(k => upRow(k, lvOf(k), v => setLv(k, v)))));
    }
    b.append(ups);
    const evs = evosFor(c.char);
    b.append(sec('進化済みにする', el('div', { class: 'dbg-grid' }, evs.map(e => {
      const u = G.upgrades[e.key];
      return el('div', { class: 'dbg-up' + (c.evolved[e.key] ? ' max' : '') },
        chk(u.name, c.evolved[e.key], v => { if (v) c.evolved[e.key] = true; else delete c.evolved[e.key]; saveCfg(); render(); }),
        B('素材MAX', () => { for (const k of e.requires) c.levels[k] = G.upgrades[k].max; saveCfg(); render(); }, 'sm', e.requires.map(k => G.upgrades[k].name).join('＋')));
    }))));
    b.append(sec('恒久強化（天賦の星図・命ノ星座）',
      seg([['keep', '今のまま'], ['zero', '全部0'], ['max', '全部MAX']], c.meta, v => set('meta', v)),
      el('p', { class: 'dbg-note' }, '「全部0／全部MAX」はこの出撃のあいだだけ。終わると元にもどります。')));
    b.append(sec('モラ・記録',
      row(el('span', { class: 'dbg-lb' }, '所持モラ'), num(c.mora, v => set('mora', v.trim()), 90), el('span', { class: 'dbg-note' }, '空欄=変えない（今 ' + U.fmtNum(G.save.data.mora || 0) + '）')),
      row(chk('セーブに記録しない（撃破数・モラ・図鑑を出撃前にもどす）', c.noRecord, v => set('noRecord', v))),
      row(chk('無敵で出撃', c.god, v => set('god', v)))));
    // presets
    const pres = ls.json(K_PRE, []);
    b.append(sec('プリセット', el('div', { class: 'dbg-grid' }, [0, 1, 2, 3, 4].map(i => {
      const p = pres[i];
      return el('div', { class: 'dbg-up' }, el('span', { class: 'dbg-pn' }, p ? p.name : '（空き）'),
        B('保存', () => { const q = ls.json(K_PRE, []); q[i] = { name: charName(cfg.char) + ' ' + cfg.time + ' Lv' + cfg.level, cfg: JSON.parse(JSON.stringify(cfg)) }; ls.set(K_PRE, JSON.stringify(q)); toast('プリセット' + (i + 1) + 'に保存'); render(); }, 'sm'),
        p ? B('読込', () => { cfg = Object.assign(defCfg(), p.cfg); saveCfg(); toast('読込: ' + p.name); render(); }, 'sm') : null);
    }))));
    b.append(el('div', { class: 'dbg-go' }, B('⚔ この条件で出撃', () => sortie(cfg), 'go')));
  }
  function upRow(k, lv, setLv) {
    const u = G.upgrades[k];
    return el('div', { class: 'dbg-up' + (lv >= u.max ? ' max' : lv > 0 ? ' has' : '') },
      el('span', { class: 'dbg-un', title: k }, u.name),
      B('−', () => setLv(lv - 1), 'pm'), el('b', { class: 'dbg-lv' }, lv + '/' + u.max), B('+', () => setLv(lv + 1), 'pm'),
      B('MAX', () => setLv(u.max), 'sm'));
  }

  /* ---------------- 進化チェッカー ---------------- */
  const yes = v => el('span', { class: v ? 'dbg-ok' : 'dbg-ng' }, v ? '✓' : '✗');
  function afterRunChange(R) {
    G.player.refreshStats(R);
    G.progression.checkResonance(R); G.progression.checkEvoReady(R);
    G.bus.emit('upgrade', { key: null, level: 0 });
  }
  function rEvo(b) {
    const R = G.run, list = G.debug.evoCheck(R);
    const bad = list.filter(x => !x.match).length;
    const ready = G.progression.evoReady(R);
    const lo = G.launcherRules.owned(R);
    b.append(el('div', { class: 'dbg-sum' + (bad ? ' bad' : '') },
      bad ? `⚠ 判定の不一致が ${bad}件 あります（赤い行）` : '✓ すべての進化で 定義・バッジ・宝箱 の判定が一致しています',
      el('br'), `宝箱で今もらえる進化: ${ready.length ? ready.map(k => G.upgrades[k].name).join('、') : 'なし'}　／　ランチャー ${lo.length}/${G.launcherRules.MAX_KINDS}種`));
    b.append(el('p', { class: 'dbg-note' }, '定義 = upgrades.js の requires（ぜんぶMAX）を ここで計算 ／ バッジ = evoLeft()==0（レベルアップのカード・装備画面）／ 宝箱 = progression.evoReady()（宝箱が実際に出す）／ ready = 進化カードの ready()'));
    list.sort((p, q) => (G.upgrades[q.key].char ? 1 : 0) - (G.upgrades[p.key].char ? 1 : 0)); // this character's own evolution first
    for (const x of list) {
      const e = G.evolutions.find(v => v.key === x.key);
      const status = x.evolved ? el('span', { class: 'dbg-tag evo' }, '進化済み') : x.own ? el('span', { class: 'dbg-tag ok' }, '条件成立') : el('span', { class: 'dbg-tag' }, 'あと ' + x.left + ' Lv');
      const mats = el('div', { class: 'dbg-mats' }, x.mats.map(m => {
        const ap = !m.ok && G.upgradeHelpers.evoAfterPick(R, m.key);
        return el('div', { class: 'dbg-mat' + (m.ok ? ' ok' : m.lv > 0 ? ' has' : '') }, yes(m.ok), el('span', { class: 'dbg-mn' }, m.name), el('b', null, m.lv + ' / ' + m.max),
          ap ? el('small', null, ap.unlock ? 'カード:★進化解放' : 'カード:あと' + ap.left) : null);
      }));
      const judges = el('div', { class: 'dbg-judge' + (x.match ? '' : ' bad') },
        '定義 ', yes(x.own), '　バッジ ', yes(x.badge), '　宝箱 ', yes(x.chest), '　ready ', yes(x.ready), '　→ ', x.match ? el('b', { class: 'dbg-ok' }, '一致') : el('b', { class: 'dbg-ng' }, '不一致！'));
      b.append(el('div', { class: 'dbg-evo' + (x.match ? '' : ' bad') + (x.evolved ? ' done' : '') },
        el('div', { class: 'dbg-evh' }, el('b', null, x.name), el('small', null, x.key), status), mats, judges,
        row(B('素材を全部MAX', () => { for (const k of e.requires) G.debug.setLevel(k, G.upgrades[k].max); afterRunChange(R); render(); }, 'sm'),
          B('進化の宝箱を今すぐ開く', () => { close(true); G.progression.openChest(R, 'common'); }, 'sm'),
          x.evolved ? B('進化を取り消す', () => { G.debug.setLevel(x.key, 0); afterRunChange(R); render(); }, 'sm') :
            B('直接進化させる', () => { close(true); G.progression.apply(R, x.key); }, 'sm gold'))));
    }
  }

  /* ---------------- 強化 ---------------- */
  function rUp(b) {
    const R = G.run, g = keysFor(R.charId);
    const setLv = (k, v) => { G.debug.setLevel(k, v); afterRunChange(R); render(); };
    b.append(sec('画面を出す',
      row(B('レベルアップ画面を今すぐ出す', () => { close(true); G.progression.openLevelUp(R); }, 'gold')),
      row(el('span', { class: 'dbg-lb' }, '宝箱'), ...[['common', '普通'], ['exquisite', '精巧'], ['precious', '貴重'], ['luxurious', '豪華']].map(([t, l]) => B(l + 'の宝箱', () => { close(true); G.progression.openChest(R, t); }, 'sm')))));
    const lau = G.launcherRules.owned(R);
    const s = sec('強化レベル',
      row(B('ぜんぶMAX', () => { for (const cat of ['char', 'launcher', 'stat']) for (const k of g[cat]) G.debug.setLevel(k, G.upgrades[k].max); afterRunChange(R); render(); }),
        B('ぜんぶリセット（進化も）', () => { for (const k of Object.keys(R.levels)) G.debug.setLevel(k, 0); afterRunChange(R); render(); }, 'warn')),
      lau.length > G.launcherRules.MAX_KINDS ? el('p', { class: 'dbg-warn' }, `⚠ ランチャー ${lau.length}種（通常は${G.launcherRules.MAX_KINDS}種まで）`) : null);
    for (const cat of ['char', 'launcher', 'stat', 'bless']) {
      if (!g[cat].length) continue;
      s.append(el('h5', null, GROUP[cat]), el('div', { class: 'dbg-grid' }, g[cat].map(k => upRow(k, R.levels[k] || 0, v => setLv(k, v)))));
    }
    b.append(s);
  }

  /* ---------------- 敵・ボス ---------------- */
  const ATK = { missiles: 'ミサイル連射', beam: '目のビーム', stomp: '突進ストンプ', spin: '回転なぎはらい', fan: '風の矢（扇）', storm: '嵐の落下', tornado: '竜巻', dash: '突風ダッシュ', wall: '風の壁', inhale: '吸い込み', spiral: 'らせん弾', barrage: '弾幕' };
  const liveBosses = R => R.enemies.filter(e => !e.dead && e.boss);
  function rEnemy(b) {
    const R = G.run, E = G.data.enemies;
    const kinds = Object.keys(E).filter(k => !E[k].boss);
    b.append(sec('敵をスポーン（プレイヤーのまわり）',
      row(sel(kinds.map(k => [k, E[k].name + (E[k].elite ? '（エリート）' : '')]), T.enemyKind, v => { T.enemyKind = v; }),
        ...[1, 5, 10, 30].map(n => B('×' + n, () => { T.enemyN = n; render(); }, T.enemyN === n ? 'on sm' : 'sm')),
        chk('チャンピオン（金）', T.champion, v => { T.champion = v; })),
      row(B('スポーン', () => {
        const p = R.player;
        for (let i = 0; i < T.enemyN; i++) { const a = i / T.enemyN * U.TAU + Math.random() * 0.4, d = 5.5 + Math.random() * 2.5; G.enemies.spawn(R, T.enemyKind, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, { champion: T.champion, reward: T.champion ? 'common' : null }); }
        toast(E[T.enemyKind].name + ' ×' + T.enemyN); render();
      }, 'gold'))));
    const bk = Object.keys(E).filter(k => E[k].boss);
    const phases = T.bossKind === 'venti' ? [[1, '第1段階'], [2, '第2段階'], [3, '第3段階']] : [[1, '通常'], [2, '暴走（HP35%以下）']];
    if (!phases.some(p => p[0] === T.bossPhase)) T.bossPhase = 1;
    b.append(sec('ボスをスポーン',
      row(seg(bk.map(k => [k, E[k].name]), T.bossKind, v => { T.bossKind = v; T.bossPhase = 1; })),
      row(el('span', { class: 'dbg-lb' }, '段階'), seg(phases, T.bossPhase, v => { T.bossPhase = v; })),
      row(B('ボスを出す', () => { const e = G.debug.spawnBoss(T.bossKind, T.bossPhase); toast(e ? E[T.bossKind].name + ' 出現' : '出せませんでした', !e); render(); }, 'gold'))));
    const bosses = liveBosses(R);
    const bs = sec('いるボスと技の発動');
    if (!bosses.length) bs.append(el('p', { class: 'dbg-note' }, 'ボスがいません。上の「ボスを出す」で出してください。'));
    for (const e of bosses) {
      const seqs = G.enemyAI.seqs || {}, ai = e.def.ai;
      const atks = ai === 'ruin' ? seqs.ruin : ai === 'venti' ? [].concat(seqs.venti[1], seqs.venti[2], seqs.venti[3]) : [];
      const uniq = atks.filter((a, i) => atks.indexOf(a) === i);
      bs.append(el('div', { class: 'dbg-boss' },
        el('div', { class: 'dbg-evh' }, el('b', null, e.def.name), el('small', null, `HP ${Math.round(e.hp / e.maxHp * 100)}%` + (ai === 'venti' ? ` ・ 第${e.phase}段階` : e.enraged ? ' ・ 暴走' : '') + ` ・ 状態 ${e.st}`)),
        row(el('span', { class: 'dbg-lb' }, 'HP'), ...[100, 60, 30, 10].map(v => B(v + '%', () => { e.hp = e.maxHp * v / 100; render(); }, 'sm')), B('倒す', () => { G.enemies.kill(R, e, 'debug'); render(); }, 'sm warn')),
        el('div', { class: 'dbg-seg wrap' }, uniq.map(a => {
          const phs = ai === 'venti' ? [1, 2, 3].filter(ph => seqs.venti[ph].indexOf(a) >= 0) : [];
          return B(ATK[a] || a, () => { G.debug.bossAttack(e, a); if (T.closeOnAttack) close(true); else render(); }, 'sm', a + (phs.length ? '（第' + phs.join('・') + '段階）' : ''));
        }))));
    }
    bs.append(row(chk('技ボタンを押したらパネルを閉じて見る', T.closeOnAttack, v => { T.closeOnAttack = v; })));
    b.append(bs);
    b.append(sec('まとめて',
      row(tog('AI停止', !!G.debug.aiStopped, v => G.debug.aiStop(v)), tog('スポーン停止（時間イベントも）', !!G.debug.spawnStopped, v => G.debug.spawnStop(v))),
      row(B('全敵撃破（ボス以外）', () => { toast(G.debug.killAll(false) + '体 撃破'); render(); }), B('ボスもふくめて全滅', () => { toast(G.debug.killAll(true) + '体 撃破'); render(); }, 'warn'))));
  }

  /* ---------------- 時間 ---------------- */
  function evLabel(ev) {
    const t = ev.boss ? 'ボス' : ev.surge ? '群れ' : ev.treasure ? '宝箱' : ev.kind === 'elite' ? '暴徒' : 'イベント';
    return [t, ev.banner || ev.notice || (ev.treasure ? '宝箱ヒルチャール（' + (ev.reward || '') + '）' : (G.data.enemies[ev.kind] || {}).name || ev.kind)];
  }
  function rTime(b) {
    const R = G.run, st = G.data.stages[R.stageId];
    const go = t => { G.debug.jumpTo(t, T.skipEvents); toast('⏱ ' + fmtT(t) + ' へジャンプ'); render(); };
    let inp;
    b.append(sec('時刻ジャンプ　（いま ' + fmtT(R.time) + '）',
      row(inp = num(fmtT(R.time), () => { }, 70), B('ジャンプ', () => go(parseTime(inp.value)), 'gold'),
        B('−30秒', () => go(R.time - 30), 'sm'), B('+30秒', () => go(R.time + 30), 'sm'), B('+60秒', () => go(R.time + 60), 'sm')),
      row(chk('途中のイベントをとばす（OFF＝通りすぎたイベントが全部いっきに起きる）', T.skipEvents, v => { T.skipEvents = v; }))));
    const list = el('div', { class: 'dbg-evl' });
    st.events.forEach((ev, i) => {
      const [kind, text] = evLabel(ev), done = R.spawn && i < R.spawn.evIdx;
      list.append(el('div', { class: 'dbg-ev' + (ev.boss ? ' boss' : '') + (done ? ' done' : '') },
        el('b', null, fmtT(ev.time)), el('span', { class: 'dbg-tag' + (ev.boss ? ' evo' : '') }, kind), el('span', { class: 'dbg-evt' }, text),
        B('5秒前へ', () => go(Math.max(0, ev.time - 5)), 'sm'), B('ちょうど', () => go(ev.time), 'sm')));
    });
    b.append(sec('ステージのイベント（灰色 = もう起きた）', list));
    b.append(sec('ゲーム速度', seg([[0.25, '×0.25'], [0.5, '×0.5'], [1, '×1'], [2, '×2'], [4, '×4']], T.speed, v => { T.speed = v; G.debug.setSpeed(v); })));
  }

  /* ---------------- プレイヤー ---------------- */
  function rPlayer(b) {
    const R = G.run, p = R.player;
    b.append(el('div', { class: 'dbg-sum' }, `HP ${Math.round(p.hp)} / ${Math.round(p.maxHp)}　エネルギー ${Math.round(p.energy)} / ${R.char.energyCost}　スキルCT ${p.skillCd.toFixed(1)}s　爆発CT ${p.burstCd.toFixed(1)}s　Lv${p.level}　モラ ${Math.floor(R.mora)}`));
    b.append(sec('いつでも',
      row(tog('無敵', T.god, v => { T.god = v; G.debug.god(v); }), tog('CT 常に0', T.noCd, v => { T.noCd = v; }), tog('エネルギー無限', T.infEnergy, v => { T.infEnergy = v; }))));
    b.append(sec('いますぐ',
      row(B('HP全回復', () => { p.hp = p.maxHp; render(); }), B('エネルギー満タン', () => { G.debug.energy(); render(); }), B('スキル/爆発 CT0', () => { p.skillCd = 0; p.burstCd = 0; render(); })),
      row(B('レベル +1', () => lvUp(1)), B('レベル +5', () => lvUp(5)), chk('レベルアップのカードを出す', T.lvCards, v => { T.lvCards = v; })),
      row(B('モラ +100', () => { R.mora += 100; render(); }), B('モラ +1000', () => { R.mora += 1000; render(); }))));
    function lvUp(n) {
      if (T.lvCards) { let need = 0, L = p.level; for (let i = 0; i < n; i++) need += (i === 0 ? p.xpNeed - p.xp : G.data.xpNeed(L + i)); G.progression.addXp(R, need + 0.01); close(true); }
      else { p.level += n; p.xp = 0; p.xpNeed = G.data.xpNeed(p.level); render(); }
    }
  }

  /* ---------------- 表示 ---------------- */
  function rView(b) {
    const R = G.run;
    b.append(sec('表示',
      row(tog('当たり判定を表示', T.hitbox, v => { T.hitbox = v; if (v) hookDraw(); }), tog('FPS・敵数・粒子数を表示', T.overlay, v => { T.overlay = v; syncOverlay(); })),
      el('p', { class: 'dbg-note' }, '当たり判定の色: 緑=プレイヤー（点線=回収範囲）／赤=敵（橙=ボス・エリート）／桃=敵の攻撃・予告／水色=屏風などのかべ／黄=自分の弾')));
    const stBox = el('div', { class: 'dbg-stats' });
    const fill = () => {
      const S = R.stats || {}, p = R.player, fs = G.fx.stats ? G.fx.stats() : {};
      const pc = v => Math.round((v || 0) * 100) + '%';
      const rows = [
        ['FPS', Math.round(G.fps)], ['敵の数', R.enemies.filter(e => !e.dead).length], ['敵の攻撃', R.hazards.length], ['自分の弾', (R.projectiles || []).length],
        ['粒子', fs.particles || 0], ['エフェクト', fs.effects || 0], ['拾いもの', (R.pickups || []).length], ['時刻', fmtT(R.time)],
        ['攻撃力', Math.round(S.atk)], ['最大HP', Math.round(p.maxHp)], ['防御力', Math.round(S.def)], ['移動速度', (S.speed || 0).toFixed(2)],
        ['攻撃速度', pc(S.haste)], ['クールダウン短縮', pc(S.cdr)], ['会心率', pc(S.critRate)], ['会心ダメージ', pc(S.critDmg)],
        ['元素チャージ', pc(S.recharge)], ['範囲', pc(S.areaMul)], ['持続', pc(S.durationMul)], ['爆発範囲', '×' + (S.explosionMul || 1)],
        ['与ダメ', '+' + pc(S.dmgBonus)], ['被ダメ軽減', pc(S.dmgReduction)], ['回収範囲', (S.pickup || 0).toFixed(1)], ['射程', (S.range || 0).toFixed(1)],
        ['通常の間隔', (S.normalInterval || 0).toFixed(2) + 's'], ['経験値', pc(S.xpMul)], ['追加の弾', S.extraProjectiles || 0], ['共鳴', Object.keys(S.resonance || {}).join(' ') || 'なし'],
      ];
      stBox.innerHTML = '';
      for (const [k, v] of rows) stBox.append(el('div', null, el('span', null, k), el('b', null, String(v))));
    };
    fill(); refresher = fill;
    b.append(sec('いまの数値（R.stats）', stBox));
  }

  /* ============================== hitboxes ============================== */
  function hookDraw() {
    if (G.render._dbgDraw) return;
    const orig = G.render.drawRun; G.render._dbgDraw = orig;
    G.render.drawRun = function (ctx) { orig.apply(this, arguments); if (on && T.hitbox && G.run) { try { drawHit(ctx); } catch (e) { console.error('[debugpanel]', e); } } };
  }
  function circ(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, Math.max(0.02, r), 0, U.TAU); ctx.stroke(); }
  function rect(ctx, x, y, ang, len, w, fromStart) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(ang); ctx.strokeRect(fromStart ? 0 : -len / 2, -w / 2, len, w); ctx.restore();
  }
  function drawShape(ctx, o) {
    if (o.type === 'lane' || (o.len && o.ang != null)) rect(ctx, o.x, o.y, o.ang || 0, o.len || 1, o.w || 1, true);
    else if (o.type === 'fan' && o.r) { ctx.beginPath(); ctx.moveTo(o.x, o.y); ctx.arc(o.x, o.y, o.r, (o.ang || 0) - (o.spread || 0.5), (o.ang || 0) + (o.spread || 0.5)); ctx.closePath(); ctx.stroke(); }
    else if (o.r) circ(ctx, o.x, o.y, o.r);
  }
  function drawHit(ctx) {
    const R = G.run, V = G.view, px = 1 / (V.scale * V.cam.zoom);
    G.render.beginWorld(ctx);
    ctx.lineWidth = 1.6 * px; ctx.globalAlpha = 0.95;
    // own projectiles & fields
    ctx.strokeStyle = '#ffe14a';
    for (const q of R.projectiles || []) if (q.r && q.x != null) circ(ctx, q.x, q.y, q.r);
    ctx.globalAlpha = 0.45; for (const f of R.fields || []) if (f.r && f.x != null) circ(ctx, f.x, f.y, f.r); ctx.globalAlpha = 0.95;
    // barriers (凝光の屏風 etc.)
    ctx.strokeStyle = '#4ae3ff';
    for (const w of R.barriers || []) if (!w.dead) rect(ctx, w.x, w.y, Math.atan2(w.uy, w.ux), w.half * 2, w.th * 2, false);
    // enemies + their telegraphs
    for (const e of R.enemies) {
      if (e.dead || !G.render.onScreen(e.x, e.y, 3)) continue;
      ctx.strokeStyle = e.boss || e.elite ? '#ff9a3c' : '#ff4d4d'; circ(ctx, e.x, e.y, e.r);
      if (e.tele) { ctx.strokeStyle = '#ff5ad8'; ctx.setLineDash([4 * px, 3 * px]); drawShape(ctx, e.tele); ctx.setLineDash([]); }
    }
    // enemy attacks
    ctx.strokeStyle = '#ff5ad8';
    for (const h of R.hazards) { if (h.t < h.delay) ctx.setLineDash([4 * px, 3 * px]); drawShape(ctx, h); ctx.setLineDash([]); }
    // player (+ pickup radius)
    const p = R.player; ctx.strokeStyle = '#5dff7a'; circ(ctx, p.x, p.y, p.r);
    if (R.stats && R.stats.pickup) { ctx.globalAlpha = 0.5; ctx.setLineDash([6 * px, 5 * px]); circ(ctx, p.x, p.y, R.stats.pickup); ctx.setLineDash([]); }
    ctx.restore();
  }

  /* ============================== per-frame upkeep (only while debug mode is on) ============================== */
  let upT = 0, last = 0;
  function tick(ts) {
    requestAnimationFrame(tick);
    if (!on) return;
    const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;
    const R = G.run;
    if (R && R.player && !R.over) {
      if (T.noCd) { R.player.skillCd = 0; R.player.burstCd = 0; }
      if (T.infEnergy && R.char) R.player.energy = R.char.energyCost;
    }
    upT += dt; if (upT < 0.3) return; upT = 0;
    if (overlay) {
      const fs = G.fx && G.fx.stats ? G.fx.stats() : {};
      overlay.textContent = R ? `FPS ${Math.round(G.fps)}  敵 ${R.enemies.filter(e => !e.dead).length}  攻撃 ${R.hazards.length}  弾 ${(R.projectiles || []).length}  粒子 ${fs.particles || 0}  ⏱${fmtT(R.time)}` + (T.speed !== 1 ? `  ×${T.speed}` : '') : `FPS ${Math.round(G.fps)}`;
    }
    if (isOpen) {
      info();
      if (isOpen && tab !== 'sortie' && !inRun()) render();       // run ended while the panel was open
      if (refresher) refresher();
    }
  }
  requestAnimationFrame(tick);
  G.bus.on('runStart', () => { if (on && T.god) setTimeout(() => G.debug.god(true), 0); });
  G.bus.on('scene', () => { if (isOpen) render(); });
  G.bus.on('assetsReady', () => { syncFab(); syncOverlay(); });

  return { get on() { return on; }, setMode, toggleMode, open, close, sortie, get cfg() { return cfg; }, set cfg(v) { cfg = Object.assign(defCfg(), v); saveCfg(); }, T };
})();
