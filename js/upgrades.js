/* upgrades.js — full run-upgrade catalogue (owner: PROGRESSION).
   G.upgrades[key] = { name, icon, glyph?, cat:'char'|'launcher'|'stat'|'evo', char?, el?, max, rarity:3|4|5,
                       short, desc(lv) (text for reaching level lv), unlock(R), mods(S,lv,R), onGain(R,lv) }
   Numbers for Amber / launchers follow docs/CURRENT_CHOICE_CATALOG.md (COMBAT implements the attacks and reads
   R.levels / R.evolved; the helper stats S.normalMul, S.bunnyMul, S.rainMul, S.rainDur are provided for convenience).
   G.evolutions: [{key, base, partner}] and G.upgradeHelpers.partnerOf(key) for card hints. */
'use strict';
G.upgrades = {};
(function () {
  const pct = v => Math.round(v * 100) + '%';
  const sgn = v => (v >= 0 ? '+' : '') + Math.round(v * 100) + '%';
  const lvOf = (R, k) => (R && R.levels[k]) || 0;
  const add = (k, o) => { o.key = k; G.upgrades[k] = o; return o; };

  /* ================= Amber (★4) ================= */
  const NORMAL = [1.0, 1.35, 1.70, 2.05, 2.40, 2.75];
  const BUNNY = [3.0, 4.2, 5.4, 6.6, 7.8, 9.0]; // balance v5 (was 5.0→13.75): the Count no longer wipes the early screen alone
  const RAIN = [1.8, 2.34, 2.88, 3.42, 3.96, 4.50];
  const RAIN_DUR = [8, 8.4, 8.8, 9.2, 9.6, 10];

  add('amber_normal', {
    name: '炎の矢', icon: 'amber_arrow', cat: 'char', char: 'amber', el: 'pyro', max: 5, rarity: 4, short: '矢の威力＆連射',
    desc: lv => `矢の威力 ${pct(NORMAL[lv - 1])}→<b>${pct(NORMAL[lv])}</b>\n連射スピード +${lv * 8}%`,
    unlock: () => true,
    mods(S, lv) { S.normalMul = NORMAL[lv]; S.normalHaste = 1 + 0.08 * lv; },
  });
  add('amber_arrows', {
    name: '追加射撃', icon: 'amber_arrow', badge: '+1', cat: 'char', char: 'amber', el: 'pyro', max: 3, rarity: 4, short: '同時に撃つ矢 +1',
    desc: lv => `同時に撃つ矢 +1\n合計 <b>${lv + 1}本</b> の矢を別々の敵へ`,
    unlock: () => true,
  });
  add('amber_pierce', {
    name: '貫通の矢', icon: 'amber_arrow', badge: '貫', cat: 'char', char: 'amber', el: 'pyro', max: 4, rarity: 4, short: '矢が敵を貫通',
    desc: lv => `矢が敵を貫通する\n1本で最大 <b>${lv + 1}体</b> に命中`,
    unlock: () => true,
  });
  add('amber_skill', {
    name: 'ウサギ伯爵', icon: 'bunny', cat: 'char', char: 'amber', el: 'pyro', max: 5, rarity: 4, short: '伯爵の大爆発',
    desc: lv => `伯爵の爆発 ${pct(BUNNY[lv - 1])}→<b>${pct(BUNNY[lv])}</b>`,
    unlock: R => R.time >= 30,
    mods(S, lv) { S.bunnyMul = BUNNY[lv]; },
  });
  add('amber_burst', {
    name: '矢の雨', icon: 'rain', cat: 'char', char: 'amber', el: 'pyro', max: 5, rarity: 4, short: '元素爆発を強化',
    desc: lv => `1ヒット ${pct(RAIN[lv - 1])}→<b>${pct(RAIN[lv])}</b>\n降る時間 <b>${RAIN_DUR[lv]}秒</b>`,
    unlock: R => R.time >= 75,
    mods(S, lv) { S.rainMul = RAIN[lv]; S.rainDur = RAIN_DUR[lv]; },
  });
  add('explosion_radius', {
    name: '爆発範囲', icon: 'bomb', glyph: 'boom', cat: 'char', char: 'amber', el: 'pyro', max: 5, rarity: 4, short: 'すべての爆発が大きく',
    desc: lv => `爆発の大きさ ×1.2\n合計 <b>×${Math.pow(1.2, lv).toFixed(2)}</b>（固有天賦×2と掛け算）`,
    // needs an explosion source: the Count (Amber's skill is always available after 0:40), pyro launcher or explosive arrows
    unlock: R => R.time >= 40 || lvOf(R, 'launcher_pyro') > 0 || !!R.evolved.evo_amber_normal,
    mods(S, lv) { S.explosionMul *= Math.pow(1.2, lv); },
  });

  /* ================= Xingqiu (★4) — owner: XINGQIU (kit in js/xingqiu.js reads the S.xq* stats; lv0 defaults live there) ================= */
  const XQ_MUL = [2.0, 2.5, 3.0, 3.5, 4.0, 4.6];      // sword hit ×ATK (lv0 = 2× Amber's lv0 arrow)
  const XQ_BLADES = [1, 2, 3, 4];                     // swords
  const XQ_SPIN = [0.8, 1.15, 1.5, 1.85, 2.2];        // turns per second
  const XQ_DUR = [2.5, 2.9, 3.3, 3.7, 4.2];           // spin time (s) — owner: default ~2.5s
  const XQ_SKILL = [2.6, 3.1, 3.6, 4.1, 4.6, 5.2], XQ_DR = [0.2, 0.23, 0.26, 0.29, 0.32, 0.35];
  const XQ_BURST = [1.2, 1.4, 1.6, 1.8, 2.0, 2.3], XQ_BDUR = [8, 8.5, 9, 9.5, 10, 11];
  const XQ = (k, o) => add(k, Object.assign({ cat: 'char', char: 'xingqiu', el: 'hydro', rarity: 4, icon: 'xingqiu' }, o));
  XQ('xq_blades', { name: '剣の本数', badge: '+1', hudIcon: 'xq_blades', max: 3, short: '回る剣 +1本',
    desc: lv => `回る剣が1本ふえる\n合計 <b>${XQ_BLADES[lv]}本</b>`, unlock: () => true, mods(S, lv) { S.xqBlades = XQ_BLADES[lv]; } });
  XQ('xq_spin', { name: '旋回速度', badge: '速', hudIcon: 'xq_spin', max: 4, short: '剣が速く・長く回る',
    desc: lv => `回る速さ 秒間${XQ_SPIN[lv - 1]}→<b>${XQ_SPIN[lv]}回転</b>\n回る時間 <b>${XQ_DUR[lv]}秒</b>`, unlock: () => true,
    mods(S, lv) { S.xqSpin = XQ_SPIN[lv]; S.xqSpinDur = XQ_DUR[lv]; } });
  XQ('xq_power', { name: '剣の威力', badge: '威', hudIcon: 'xq_blade', max: 5, short: '剣のダメージUP',
    desc: lv => `剣の威力 ${pct(XQ_MUL[lv - 1])}→<b>${pct(XQ_MUL[lv])}</b>`, unlock: () => true, mods(S, lv) { S.xqMul = XQ_MUL[lv]; } });
  // 雷鳥の羽: general item (owner 2026-09-28) — every character's normal-attack cooldown -5%/lv (MAX Lv10 = -50%).
  // Key kept as 'xq_feather' because it is also the partner material of 行秋's evolution.
  XQ('xq_feather', { name: '雷鳥の羽', icon: 'feather', badge: '羽', hudIcon: 'feather', el: 'electro', max: 10, cat: 'stat', char: null, rarity: 4,
    short: '通常攻撃のクールタイム -5%',
    desc: lv => `通常攻撃の待ち時間 -5%\n合計 <b>-${lv * 5}%</b>` + (lv === 10 ? '（MAX）' : ''), unlock: () => true,
    mods(S, lv) { S.featherCd = 1 - 0.05 * lv; S.xqCdMul = S.featherCd; } });
  XQ('xq_skill', { name: '画雨籠山', badge: 'F', hudIcon: 'xq_skill', max: 5, short: '水の2連斬り＋雨すだれ',
    desc: lv => `斬撃 ${pct(XQ_SKILL[lv - 1])}→<b>${pct(XQ_SKILL[lv])}</b>\n雨すだれの剣 被ダメ <b>-${Math.round(XQ_DR[lv] * 100)}%</b>`, unlock: R => R.time >= 30,
    mods(S, lv) { S.xqSkillMul = XQ_SKILL[lv]; S.xqRainDR = XQ_DR[lv]; } });
  XQ('xq_burst', { name: '裁雨留虹', badge: 'Q', hudIcon: 'xq_burst', max: 5, short: '五月雨斬りを強化',
    desc: lv => `1本 ${pct(XQ_BURST[lv - 1])}→<b>${pct(XQ_BURST[lv])}</b>\n降る時間 <b>${XQ_BDUR[lv]}秒</b>` + (lv % 2 === 0 ? '・剣の数+1' : ''), unlock: R => R.time >= 75,
    mods(S, lv) { S.xqBurstMul = XQ_BURST[lv]; S.xqBurstDur = XQ_BDUR[lv]; } });

  /* ================= Ningguang (★4) — owner: NINGGUANG (kit in js/ningguang.js reads the S.ng* stats; lv0 defaults live there) ================= */
  const NG_GEMS = [7, 10, 13, 16, 19, 22];                   // pebbles per volley (+3 / lv)
  const NG_MUL = [0.25, 0.31, 0.37, 0.44, 0.51, 0.60];       // one pebble ×ATK (lv0 = 1/4 of Amber's lv0 arrow)
  const NG_SKILL = [2.3, 2.8, 3.3, 3.8, 4.3, 5.0], NG_WALL = [5.6, 5.9, 6.2, 6.5, 6.8, 7.2];
  const NG = (k, o) => add(k, Object.assign({ cat: 'char', char: 'ningguang', el: 'geo', rarity: 4, icon: 'ningguang' }, o));
  NG('ng_gems', { name: '石粒の数', badge: '+3', hudIcon: 'ng_gems', max: 5, short: '石粒 +3粒',
    desc: lv => `一度に飛ばす石粒 +3粒\n合計 <b>${NG_GEMS[lv]}粒</b>`, unlock: () => true, mods(S, lv) { S.ngGems = NG_GEMS[lv]; } });
  NG('ng_power', { name: '石粒の威力', badge: '威', hudIcon: 'ng_gem', max: 5, short: '石粒のダメージUP',
    desc: lv => `1粒の威力 ${pct(NG_MUL[lv - 1])}→<b>${pct(NG_MUL[lv])}</b>`, unlock: () => true, mods(S, lv) { S.ngMul = NG_MUL[lv]; } });
  NG('ng_skill', { name: '璇璣屏', badge: 'F', hudIcon: 'ng_skill', max: 5, short: '屏風を強化',
    desc: lv => `屏風のダメージ ${pct(NG_SKILL[lv - 1])}→<b>${pct(NG_SKILL[lv])}</b>\n屏風の長さ <b>${NG_WALL[lv]}</b>`, unlock: R => R.time >= 30,
    mods(S, lv) { S.ngSkillMul = NG_SKILL[lv]; S.ngWall = NG_WALL[lv]; } });
  NG('ng_burst', { name: '天権崩玉', badge: 'Q', hudIcon: 'ng_burst', max: 5, short: '一斉発射を強化',
    desc: lv => ['', '宝石が もっと大きくなる', '一斉発射 <b>2回</b> になる', '宝石が もっと大きくなる', '一斉発射 <b>3回</b> になる', '当たると <b>岩が爆発</b>する'][lv] + '\n（威力は石粒の10倍）',
    unlock: R => R.time >= 75, mods(S, lv) { S.ngBurstLv = lv; } });

  /* ================= Chongyun (★4) — owner: CHONGYUN (kit in js/chongyun.js reads the S.cy* stats; lv0 defaults live there) ================= */
  const CY_MUL = [2.4, 3.0, 3.6, 4.2, 4.8, 5.52];           // one sweep ×ATK = 行秋の剣 (XQ_MUL) ×1.2 (owner 2026-09-28)
  const CY_REACH = [3.0, 3.35, 3.7, 4.05, 4.5], CY_ARC = [70, 75, 80, 85, 90]; // sweep radius / half-angle (deg)
  const CY_COMBO = [1, 2, 3, 4];                             // swings per chain (3+: the last one is an all-round slam)
  const CY_SKILL = [3.0, 3.5, 4.0, 4.5, 5.0, 5.6], CY_HASTE = [0.15, 0.18, 0.21, 0.24, 0.27, 0.30];
  const CY_BURST = [7.0, 8.0, 9.0, 10.0, 11.0, 12.5];        // one giant spirit blade ×ATK (the last one ×1.3)
  const CYU = (k, o) => add(k, Object.assign({ cat: 'char', char: 'chongyun', el: 'cryo', rarity: 4, icon: 'chongyun' }, o));
  CYU('cy_power', { name: '大剣の威力', badge: '威', hudIcon: 'cy_power', max: 5, short: '薙ぎ払いのダメージUP',
    desc: lv => `薙ぎ払いの威力 ${pct(CY_MUL[lv - 1])}→<b>${pct(CY_MUL[lv])}</b>`, unlock: () => true, mods(S, lv) { S.cyMul = CY_MUL[lv]; } });
  CYU('cy_arc', { name: '剣閃の範囲', badge: '広', hudIcon: 'cy_arc', max: 4, short: '薙ぎ払いが広く・遠く',
    desc: lv => `とどく距離 ${CY_REACH[lv - 1]}→<b>${CY_REACH[lv]}</b>\n扇の広さ <b>${CY_ARC[lv] * 2}°</b>`, unlock: () => true,
    mods(S, lv) { S.cyReach = CY_REACH[lv]; S.cyArc = CY_ARC[lv]; } });
  CYU('cy_combo', { name: '連撃', badge: '連', hudIcon: 'cy_combo', max: 3, short: '1回で何度も振る',
    desc: lv => `1回に振る数 +1\n合計 <b>${CY_COMBO[lv]}連撃</b>` + (lv >= 2 ? '\n最後は まわり全部を たたきつけ！' : ''), unlock: () => true,
    mods(S, lv) { S.cyCombo = CY_COMBO[lv]; } });
  CYU('cy_skill', { name: '重華積霜', badge: 'F', hudIcon: 'cy_skill', max: 5, short: '氷の衝撃＋霜の領域',
    desc: lv => `衝撃 ${pct(CY_SKILL[lv - 1])}→<b>${pct(CY_SKILL[lv])}</b>\n領域の中で攻撃速度 <b>+${Math.round(CY_HASTE[lv] * 100)}%</b>`, unlock: R => R.time >= 30,
    mods(S, lv) { S.cySkillMul = CY_SKILL[lv]; S.cyHaste = CY_HASTE[lv]; } });
  CYU('cy_burst', { name: '雲開星落', badge: 'Q', hudIcon: 'cy_burst', max: 5, short: '巨大な霊刃を強化',
    desc: lv => `霊刃1本 ${pct(CY_BURST[lv - 1])}→<b>${pct(CY_BURST[lv])}</b>` + (lv === 3 ? '\n霊刃が <b>4本</b> になる！' : ''), unlock: R => R.time >= 75,
    mods(S, lv) { S.cyBurstMul = CY_BURST[lv]; S.cyBurstN = lv >= 3 ? 4 : 3; } });

  /* ================= Timaeus launchers (★4) — new ones come only from the chest choice, max 2 kinds (see G.launcherRules) ================= */
  const L = (k, o) => add('launcher_' + k, Object.assign({ cat: 'launcher', el: k, max: 5, rarity: 4 }, o));
  const PY = [4.5, 5.85, 7.2, 8.55, 9.9];
  L('pyro', { name: '炎型ランチャー', icon: 'bomb', short: '人形爆弾がドカン！', unlock: R => R.time >= 40,
    desc: lv => lv === 1 ? `人形爆弾を投げて大爆発\n威力 <b>${pct(PY[0])}</b>・12秒ごと` : `爆弾の威力 ${pct(PY[lv - 2])}→<b>${pct(PY[lv - 1])}</b>` });
  const HY = [0.8, 1.04, 1.28, 1.52, 1.76], HYR = [3.5, 3.78, 4.06, 4.34, 4.62];
  L('hydro', { name: '水型ランチャー', icon: 'bottle', short: '水たまりで連続ダメージ', unlock: R => R.time >= 70,
    desc: lv => lv === 1 ? `水入り瓶で水たまりを作る\n1ヒット <b>${pct(HY[0])}</b>・蒸発のチャンス！` : `威力 ${pct(HY[lv - 2])}→<b>${pct(HY[lv - 1])}</b>\n半径 <b>${HYR[lv - 1]}</b>` });
  const EL = [2, 2.6, 3.2, 3.8, 4.4];
  L('electro', { name: '雷型ランチャー', icon: 'lightning', short: '連鎖する雷', unlock: R => R.time >= 105,
    desc: lv => lv === 1 ? `雷が敵から敵へ連鎖\n威力 <b>${pct(EL[0])}</b>・最大4体` : `威力 ${pct(EL[lv - 2])}→<b>${pct(EL[lv - 1])}</b>\n連鎖 <b>${lv + 3}体</b>` });
  const AN = [0.5, 0.65, 0.8, 0.95, 1.1], ANR = [5, 5.35, 5.7, 6.05, 6.4];
  L('anemo', { name: '風型ランチャー', icon: 'wind', short: '敵を吸い込むつむじ風', unlock: R => R.time >= 140,
    desc: lv => lv === 1 ? `敵を吸い込むかぜおこし\n拡散で元素を広げる！` : `威力 ${pct(AN[lv - 2])}→<b>${pct(AN[lv - 1])}</b>\n半径 <b>${ANR[lv - 1]}</b>` });
  L('cryo', { name: '氷型ランチャー', icon: 'snow', short: '全体に氷を付着', unlock: R => R.time >= 180,
    desc: lv => lv === 1 ? `雪を降らせて全部の敵に氷付着\n溶解・凍結のチャンス！` : `雪の時間 ${(1 + 0.15 * (lv - 2)).toFixed(2)}秒→<b>${(1 + 0.15 * (lv - 1)).toFixed(2)}秒</b>` });
  const GE = [3.2, 4.16, 5.12, 6.08, 7.04], GEN = [2, 2, 3, 3, 4];
  L('geo', { name: '岩型ランチャー', icon: 'rock', short: '岩の造形物＋シールド', unlock: R => R.time >= 220,
    desc: lv => lv === 1 ? `岩の造形物を落として衝撃波\n威力 <b>${pct(GE[0])}</b>` : `落下威力 ${pct(GE[lv - 2])}→<b>${pct(GE[lv - 1])}</b>\n設置数 <b>${GEN[lv - 1]}</b>` });
  /* launcher rules (owner rule v6 — RULES):
     - a NEW launcher (Lv0→1) is only offered in the chest "えらぶ" choice (progression.available() skips it unless
       ctx.allowNewLauncher); owned launchers level up from level-ups and chests as usual.
     - at most MAX_KINDS different launchers per run: after that no un-owned launcher is offered anywhere (unlock=false). */
  const LKEYS = ['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo'].map(k => 'launcher_' + k);
  const lOwned = R => LKEYS.filter(k => lvOf(R, k) > 0);
  G.launcherRules = {
    MAX_KINDS: 2, keys: LKEYS,
    owned: lOwned,
    left: R => Math.max(0, G.launcherRules.MAX_KINDS - lOwned(R).length),
    canNew: R => lOwned(R).length < G.launcherRules.MAX_KINDS,
  };
  for (const k of LKEYS) {
    const u = G.upgrades[k], timeUnlock = u.unlock;
    u.timeUnlock = timeUnlock; u.chestOnlyNew = true;
    u.unlock = R => (lvOf(R, k) > 0 || G.launcherRules.canNew(R)) && timeUnlock(R);
  }

  /* ================= stats (★3) ================= */
  const ST = (k, o) => add(k, Object.assign({ cat: 'stat', rarity: 3 }, o));
  const tot = (label, per, lv, unit) => `${label} ${unit === '%' ? '+' + Math.round(per * 100) + '%' : '+' + per + (unit || '')}\n合計 <b>${unit === '%' ? '+' + Math.round(per * lv * 100) + '%' : '+' + Math.round(per * lv * 10) / 10 + (unit || '')}</b>`;
  ST('attack', { name: '攻撃力', icon: 'amber_arrow', glyph: 'atk', max: 5, short: '全部のダメージUP',
    desc: lv => tot('攻撃力', 0.15, lv, '%'), unlock: () => true, mods(S, lv) { S.atk *= 1 + 0.15 * lv; } });
  ST('hp', { name: '最大HP', icon: 'chicken', glyph: 'hp', max: 5, short: 'たおれにくくなる',
    desc: lv => tot('最大HP', 0.15, lv, '%') + '\nHPも少し回復', unlock: () => true,
    mods(S, lv) { S.maxHp *= 1 + 0.15 * lv; }, onGain(R) { G.player.heal(R, R.player.maxHp * 0.15); } });
  ST('defense', { name: '防御力', icon: 'crystal', glyph: 'def', max: 5, short: '受けるダメージDOWN',
    desc: lv => tot('防御力', 15, lv, '') + `\n（被ダメ -${Math.round((1 - 100 / (100 + 15 * lv)) * 100)}%）`, unlock: () => true,
    mods(S, lv) { S.def += 15 * lv; } });
  ST('speed', { name: '移動速度', icon: 'wind', glyph: 'speed', max: 5, short: 'はやく走れる',
    desc: lv => tot('移動速度', 0.05, lv, '%'), unlock: () => true, mods(S, lv) { S.speed *= 1 + 0.05 * lv; } });
  ST('harvest', { name: '回収範囲', icon: 'mora', glyph: 'magnet', max: 5, short: '粒子を遠くから吸い寄せ',
    desc: lv => `回収範囲 +0.8・経験値 +6%\n合計 <b>+${(0.8 * lv).toFixed(1)}・経験値+${6 * lv}%</b>`, unlock: () => true,
    mods(S, lv) { S.pickup += 0.8 * lv; S.xpMul *= 1 + 0.06 * lv; } });
  ST('haste', { name: '攻撃速度', icon: 'amber_arrow', glyph: 'haste', max: 8, short: '矢もランチャーも速く',
    desc: lv => tot('攻撃速度', 0.08, lv, '%'), unlock: R => R.time >= 45, mods(S, lv) { S.haste += 0.08 * lv; } });
  ST('recharge', { name: '元素チャージ効率', icon: 'rain', glyph: 'er', max: 5, short: '元素爆発をもっと撃てる',
    desc: lv => tot('チャージ効率', 0.12, lv, '%'), unlock: R => R.time >= 60, mods(S, lv) { S.recharge += 0.12 * lv; } });
  ST('crit_rate', { name: '会心率', icon: 'vfx_status', glyph: 'cr', max: 5, short: '会心が出やすく',
    desc: lv => tot('会心率', 0.05, lv, '%'), unlock: R => R.time >= 60, mods(S, lv) { S.critRate += 0.05 * lv; } });
  ST('crit_damage', { name: '会心ダメージ', icon: 'vfx_status', glyph: 'cd', max: 5, short: '会心の数字がデカく',
    desc: lv => tot('会心ダメージ', 0.2, lv, '%'), unlock: R => lvOf(R, 'crit_rate') > 0 || (R.stats && R.stats.critRate > 0.05),
    mods(S, lv) { S.critDmg += 0.2 * lv; } });
  const geo = R => lvOf(R, 'launcher_geo') > 0 || lvOf(R, 'shield_hp') > 0;
  ST('shield_hp', { name: 'シールド強化', icon: 'crystal', glyph: 'shield', max: 3, short: 'シールドが固く',
    desc: lv => tot('シールド量', 0.2, lv, '%'), unlock: geo, mods(S, lv) { S.shieldMul *= 1 + 0.2 * lv; } });
  ST('shield_range', { name: 'シールド範囲', icon: 'crystal', glyph: 'shieldR', max: 3, short: 'シールドが広く',
    desc: lv => tot('シールド範囲', 0.15, lv, '%'), unlock: geo, mods(S, lv) { S.shieldRange *= 1 + 0.15 * lv; } });
  ST('shield_damage', { name: 'シールド反撃', icon: 'rock', glyph: 'shieldD', max: 3, short: 'シールド内の敵にダメージ',
    desc: lv => tot('シールドの継続ダメージ', 0.2, lv, '%'), unlock: geo, mods(S, lv) { S.shieldDmg *= 1 + 0.2 * lv; } });

  /* ================= evolutions (★5) =================
     SINGLE SOURCE OF TRUTH for evolution conditions: `requires` = every listed upgrade must be owned AND at MAX level.
     (base = the weapon that transforms; partner = kept for older callers = the last non-base requirement.)
     Everything else (card badges, 進化準備OK notice, chest priority, glowing chest, build panel, codex) goes through
     G.upgradeHelpers.evoReqs / evoLeft / evoReady — never re-implement the rule elsewhere. */
  const EVO = [
    ['evo_amber_normal', '爆炎の矢', ['amber_normal', 'amber_arrows', 'amber_pierce', 'explosion_radius'], 'amber_arrow', '矢が当たるたびに爆発！\n炎の軌跡＋貫通+1'],
    ['evo_amber_skill', '伯爵大行進', ['amber_skill', 'recharge'], 'bunny', '伯爵を2体まで出せる\n敵を集めて ぴょん爆発×3→大爆発'],
    ['evo_amber_burst', '炎の大豪雨', ['amber_burst', 'crit_rate'], 'rain', '矢の雨の範囲 ×1.4\n燃える地面＋最後に流星の一斉射'],
    ['evo_launcher_pyro', 'ボンボン大爆撃', ['launcher_pyro', 'attack'], 'bomb', '人形爆弾が4つの子爆弾に分裂！'],
    ['evo_launcher_hydro', '大渦潮', ['launcher_hydro', 'harvest'], 'bottle', '水たまりが動く渦潮に\n敵を吸い込む'],
    ['evo_launcher_cryo', '永久凍土の吹雪', ['launcher_cryo', 'defense'], 'snow', '吹雪が氷ダメージを与え\nときどき全体を凍結'],
    ['evo_launcher_electro', '雷雲の審判', ['launcher_electro', 'crit_damage'], 'lightning', '雷雲がついてきて\n0.5秒ごとに落雷'],
    ['evo_launcher_anemo', '風神の大竜巻', ['launcher_anemo', 'speed'], 'wind', '巨大な竜巻が戦場を暴れ回り\n敵を巻き上げる'],
    ['evo_launcher_geo', '岩王の城壁', ['launcher_geo', 'hp'], 'rock', '造形物がシールドを送り\n衝撃波が巨大化'],
    ['evo_xq_normal', '古華奥義・千剣流水', ['xq_blades', 'xq_spin', 'xq_power', 'xq_feather'], 'xingqiu', '剣が止まらず回り続ける！\n剣+2本・大きく速く\n水の剣閃が飛んでいく'],
    ['evo_ng_normal', '天権の宝石雨', ['ng_gems', 'ng_power', 'haste'], 'ningguang', '石粒+6粒・大きな宝石に！\n当たると岩がはじけ\n空から宝石の雨が降る'],
    ['evo_cy_normal', '霊刃奥義・霜天断雲', ['cy_power', 'cy_arc', 'cy_combo', 'attack'], 'chongyun', '薙ぎ払いが いつでも氷元素に！\n氷の剣気が飛び、とどめの一撃で\nまわりに氷柱が突き出て凍らせる'],
  ];
  const maxOf = k => (G.upgrades[k] && G.upgrades[k].max) || 1;
  /** levels still missing for recipe e (every requirement to MAX). extraKey = pretend that key got +1 level. */
  const evoLeft = (R, e, extraKey) => {
    let n = 0;
    for (const k of e.requires) n += Math.max(0, maxOf(k) - (lvOf(R, k) + (extraKey === k ? 1 : 0)));
    return n;
  };
  G.evolutions = [];
  for (const [key, name, requires, icon, text] of EVO) {
    const base = requires[0], partner = requires[requires.length - 1], b = G.upgrades[base];
    const e = { key, base, partner, requires };
    G.evolutions.push(e);
    add(key, {
      name, icon, cat: 'evo', char: b.char, el: b.el, max: 1, rarity: 5, base, partner, requires, short: '進化！',
      desc: () => text,
      ready: R => !!R && !R.evolved[key] && (!b.char || b.char === R.charId) && evoLeft(R, e) === 0,
      unlock: () => false, // never in normal level-up offers — chests only
      onGain(R) { R.evolved[key] = true; },
    });
  }

  /* ================= ★5 blessings (天啓カード) — rare gold level-up cards, max 1 each =================
     Offered by progression.makeOffer (never from the normal weighted pool). Runtime behaviour lives in
     progression.js (blessingUpdate) using only public APIs (G.combat.aoe, G.fx.*, G.loot.add). */
  const BL = (k, o) => add(k, Object.assign({ cat: 'bless', rarity: 5, max: 1, gold: true, unlock: () => false }, o));
  BL('bless_meteor', { name: '流星の祝福', icon: 'amber_arrow', glyph: 'star', short: '流れ星が降ってくる！', el: 'pyro',
    desc: () => '6秒ごとに 敵の多い所へ\n流れ星が落ちて <b>大爆発！</b>\n（攻撃力 <b>700%</b>）' });
  BL('bless_firework', { name: '祝福の花火', icon: 'bomb', glyph: 'boom', short: 'レベルアップで花火！', el: 'pyro',
    desc: () => 'レベルアップするたびに\nまわりで <b>花火が大爆発</b>（900%）\n経験値 <b>+15%</b>', mods(S) { S.xpMul *= 1.15; } });
  BL('bless_dandelion', { name: '蒲公英の風', icon: 'wind', glyph: 'speed', short: '40体ごとに大旋風', el: 'anemo',
    desc: () => '敵を <b>40体</b> 倒すごとに\n大旋風で吹き飛ばし\n経験値を <b>全部吸い寄せる</b>' });
  BL('bless_favonius', { name: '西風の加護', icon: 'vfx_status', glyph: 'cr', short: '会心でエネルギー', el: 'anemo',
    desc: () => '会心率 <b>+12%</b>\n会心が出ると ときどき\n元素エネルギーが出る', mods(S) { S.critRate += 0.12; } });
  BL('bless_mora', { name: '黄金の夢', icon: 'mora', glyph: 'mora', short: 'モラざくざく',
    desc: () => 'モラ獲得量 <b>×1.6</b>\n敵がモラを <b>よく落とす</b>', mods(S) { S.moraMul *= 1.6; } });
  BL('bless_scout', { name: '偵察騎士の直感', icon: 'bunny', glyph: 'er', short: 'スキル・爆発を連発', char: 'amber', el: 'pyro',
    desc: () => 'ウサギ伯爵のクールタイム <b>-30%</b>\n元素チャージ効率 <b>+40%</b>', mods(S) { S.bunnyCdMul *= 0.7; S.recharge += 0.4; } });
  G.blessings = ['bless_meteor', 'bless_firework', 'bless_dandelion', 'bless_favonius', 'bless_mora', 'bless_scout'];

  G.upgradeHelpers = {
    /** requirement keys of an evolution (recipe object or evo key) */
    evoReqs(e) { if (typeof e === 'string') e = G.evolutions.find(x => x.key === e); return e ? e.requires : []; },
    /** recipes (for this run's character) that use `key` as a requirement */
    evoRecipesOf(R, key) { return G.evolutions.filter(e => e.requires.indexOf(key) >= 0 && (!G.upgrades[e.key].char || !R || G.upgrades[e.key].char === R.charId)); },
    /** short recipe text: 「炎の矢・追加射撃…をぜんぶMAX」 */
    evoRecipeText(e) { if (typeof e === 'string') e = G.evolutions.find(x => x.key === e); return e ? e.requires.map(k => G.upgrades[k].name).join('＋') + ' をぜんぶMAX' : ''; },
    /** hint for a card: {text, evoKey, have} or null. have = another requirement of that recipe is already owned */
    evoHint(R, key) {
      for (const e of G.evolutions) {
        if (R && R.evolved[e.key]) continue;
        const up = G.upgrades[e.key];
        if (up.char && R && up.char !== R.charId) continue;
        if (e.requires.indexOf(key) < 0) continue;
        const others = e.requires.filter(k => k !== key);
        const text = others.length > 1 ? '進化素材: ' + e.requires.length + 'つ全部MAXで「' + up.name + '」' : '進化素材: ' + G.upgrades[others[0]].name + 'もMAXで「' + up.name + '」';
        return { text, evo: up.name, key: e.key, have: others.some(k => lvOf(R, k) > 0), left: evoLeft(R, e) };
      }
      return null;
    },
    /** steps (level picks) left until evolution recipe e is ready; extraKey = hypothetical +1 level */
    evoLeft,
    /** keys of evolutions that are ready right now (all requirements MAX, not evolved yet) */
    evoReady(R) { const out = []; for (const e of G.evolutions) if (G.upgrades[e.key].ready(R)) out.push(e.key); return out; },
    /** what picking `key` does for evolutions: {unlock:true, evo} (recipe completes) | {left:n, evo} (closest recipe) | null */
    evoAfterPick(R, key) {
      let best = null;
      for (const e of G.evolutions) {
        if (!R || R.evolved[e.key]) continue;
        if (e.requires.indexOf(key) < 0) continue;
        const up = G.upgrades[e.key]; if (up.char && up.char !== R.charId) continue;
        const before = evoLeft(R, e), after = evoLeft(R, e, key);
        if (after >= before) continue; // this pick does not advance the recipe
        const r = after === 0 ? { unlock: true, evo: up.name, key: e.key } : { left: after, evo: up.name, key: e.key };
        if (!best || (r.unlock && !best.unlock) || (!best.unlock && r.left < best.left)) best = r;
      }
      return best;
    },
    pct, sgn,
  };
})();
