/* hud.js — in-run heads-up display (owner: UI).
   Canvas part (screen space, CSS px) is drawn by render.js via G.hud.draw(ctx) every frame:
     XP bar + level badge, portrait + HP/shield, owned weapon row, big timer (+stage progress), Mora/kills with count-up,
     combo counter with hype milestones, skill/burst dials (desktop; on touch the #touch buttons get fed instead),
     boss bar (segmented, damage trail), off-screen arrows (chests/boss), low-HP vignette, FPS.
   DOM part (#hudfx, below #ui) shows banners for bus events: stageEvent, bossWarning, notice, resonance, evolution, bossKilled.
   Layout keeps clear of the touch controls (stick left-bottom, skill/burst right-bottom, pause top-right) and safe-area insets. */
'use strict';
G.hud = (function () {
  const V = G.view, U = G.u, TAU = Math.PI * 2;
  const FONT = '"M PLUS Rounded 1c","Hiragino Maru Gothic ProN","BIZ UDPGothic","Yu Gothic","Noto Sans JP","Noto Sans CJK JP",sans-serif';
  const SERIF = '"Shippori Mincho B1","Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","Noto Serif CJK JP",serif';
  const HYPE = [50, 100, 200, 300, 500, 750, 1000, 1500, 2000, 3000, 5000];

  /* ---------- safe-area probe ---------- */
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
    'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.append(probe);
  const layer = document.createElement('div'); layer.id = 'hudfx'; document.body.append(layer);

  const safe = { l: 0, r: 0, t: 0, b: 0 };
  let k = 1, lw = -1, lh = -1, lt = null, F = {}, C = {}, L = {};
  const st = {};
  function resetState() {
    Object.assign(st, { kills: 0, mora: 0, killsPop: 0, moraPop: 0, lastKills: 0, lastMora: 0, sec: -1, secTxt: '00:00', minPulse: 0,
      xp: 0, lvl: 1, lvPop: 0, lvTxt: 'Lv.1', hpT: 1, hpS: 1, hpTxt: '', hpA: -1, hpB: -1, hpC: -1, bossTT: '', bossTW: 0, bossFor: null, combo: 0, comboShow: 0, comboA: 0, comboPop: 0, comboTxt: '0',
      nextHype: 0, hype: null, bossE: null, bossHp: 1, bossTrail: 1, bossHold: 0, bossA: 0, alpha: 0, sMax: 1, bMax: 1, energyShow: 0,
      tb: { s: -1, b: -1, r: null, e: -1, sr: null }, owned: [], killTxt: '0', moraTxt: '0', killN: 0, moraN: 0, skT: 0, fpsTxt: '', fpsT: 0, t: 0, readyT: 0 });
  }
  resetState();

  function readSafe() {
    const cs = getComputedStyle(probe);
    safe.t = parseFloat(cs.paddingTop) || 0; safe.r = parseFloat(cs.paddingRight) || 0;
    safe.b = parseFloat(cs.paddingBottom) || 0; safe.l = parseFloat(cs.paddingLeft) || 0;
  }
  function px(n) { return Math.max(9, Math.round(n)) + 'px '; }
  function layout(ctx) {
    readSafe();
    lw = V.w; lh = V.h; lt = G.input.touchMode;
    k = U.clamp(Math.min(V.w / 1280, V.h / 720), 0.62, 1.25);
    const phone = V.h < 520;
    F.timer = '900 ' + px(34 * k) + FONT;
    F.big = '900 ' + px(20 * k) + FONT;
    F.mid = '800 ' + px(14 * k) + FONT;
    F.small = '800 ' + px(11 * k) + FONT;
    F.tiny = '900 ' + px(9.5 * k) + FONT;
    F.combo = '900 ' + px(46 * k) + FONT;
    F.comboL = '900 ' + px(13 * k) + FONT;
    F.hype = 'italic 900 ' + px((phone ? 30 : 36) * k) + FONT;
    F.boss = '800 ' + px(17 * k) + SERIF;
    F.bossT = '900 ' + px(11 * k) + FONT;
    F.dial = '900 ' + px(15 * k) + FONT;
    F.key = '900 ' + px(11 * k) + FONT;
    // geometry
    L.xpH = Math.max(6, Math.round(8 * k));
    L.pr = Math.round(27 * k);                                   // portrait radius
    L.px = safe.l + Math.round(14 * k); L.py = safe.t + L.xpH + Math.round(10 * k);
    L.barX = L.px + L.pr * 2 + Math.round(10 * k); L.barW = Math.round(U.clamp(230 * k, 150, 280)); L.barH = Math.max(10, Math.round(13 * k));
    L.barY = L.py + L.pr - L.barH / 2 + Math.round(2 * k);
    L.iconS = Math.max(20, Math.round(28 * k)); L.iconY = L.py + L.pr * 2 + Math.round(10 * k);
    L.tx = V.w / 2; L.ty = safe.t + L.xpH + Math.round(34 * k);
    L.progW = Math.round(150 * k); L.progY = L.ty + Math.round(9 * k);
    L.bossW = Math.round(Math.min(560, V.w * (phone ? 0.5 : 0.44))); L.bossY = L.progY + Math.round(30 * k);
    L.bossH = Math.max(8, Math.round(10 * k));
    L.rx = V.w - safe.r - Math.round(16 * k) - (lt ? 64 : 0);   // leave room for the touch pause button
    L.ry = safe.t + L.xpH + Math.round(24 * k);
    L.cy = safe.t + L.xpH + Math.round((lt ? 118 : 138) * k);
    // desktop dials
    L.bR = Math.round(40 * k); L.sR = Math.round(31 * k);
    L.bX = V.w - safe.r - Math.round(66 * k); L.bY = V.h - safe.b - Math.round(66 * k);
    L.sX = L.bX - Math.round(98 * k); L.sY = L.bY + Math.round(12 * k);
    // cached gradients
    C.shade = ctx.createLinearGradient(0, 0, 0, Math.round(110 * k) + safe.t);
    C.shade.addColorStop(0, 'rgba(4,10,20,.55)'); C.shade.addColorStop(1, 'rgba(4,10,20,0)');
    C.xp = ctx.createLinearGradient(0, 0, V.w, 0);
    C.xp.addColorStop(0, '#2fd6b0'); C.xp.addColorStop(0.6, '#8ff7e2'); C.xp.addColorStop(1, '#fff3c4');
    C.hp = ctx.createLinearGradient(L.barX, 0, L.barX + L.barW, 0);
    C.hp.addColorStop(0, '#62d66f'); C.hp.addColorStop(1, '#b6f27a');
    C.hpLow = ctx.createLinearGradient(L.barX, 0, L.barX + L.barW, 0);
    C.hpLow.addColorStop(0, '#e2463b'); C.hpLow.addColorStop(1, '#ff8a5a');
    C.boss = ctx.createLinearGradient(L.tx - L.bossW / 2, 0, L.tx + L.bossW / 2, 0);
    C.boss.addColorStop(0, '#c9283a'); C.boss.addColorStop(1, '#ff7a4a');
    const disc = (x, y, r) => { const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, r * 0.1, x, y, r); g.addColorStop(0, '#4a5d82'); g.addColorStop(0.75, '#16223a'); g.addColorStop(1, '#0c1424'); return g; };
    C.bDisc = disc(L.bX, L.bY, L.bR); C.sDisc = disc(L.sX, L.sY, L.sR);
    C.bless = ctx.createLinearGradient(0, L.iconY, 0, L.iconY + L.iconS);
    C.bless.addColorStop(0, '#c98a2c'); C.bless.addColorStop(0.55, '#7a4a14'); C.bless.addColorStop(1, '#4a2a0a');
    C.port = ctx.createRadialGradient(L.px + L.pr, L.py + L.pr * 0.6, 2, L.px + L.pr, L.py + L.pr, L.pr);
    C.port.addColorStop(0, '#b0643a'); C.port.addColorStop(1, '#3a1f22');
  }

  /* ---------- helpers ---------- */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, r); return; }
    r = Math.min(r, w / 2, h / 2);
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function text(ctx, s, x, y, font, fill, align, stroke, sw) {
    ctx.font = font; ctx.textAlign = align || 'left';
    if (stroke) { ctx.lineWidth = sw || 3; ctx.strokeStyle = stroke; ctx.strokeText(s, x, y); }
    ctx.fillStyle = fill; ctx.fillText(s, x, y);
  }
  function img(name) { return G.assets.img['icon_' + name]; }
  function drawIcon(ctx, name, x, y, s, a) {
    const im = img(name); if (!im) return;
    const h = s, w = s * im.width / im.height;
    if (a != null) ctx.globalAlpha = a;
    ctx.drawImage(im, x - w / 2, y - h / 2, w, h);
    if (a != null) ctx.globalAlpha = 1;
  }
  function refreshOwned(R) {
    const order = { bless: 0, evo: 1, char: 2, launcher: 3 };
    st.owned = Object.keys(R.levels || {}).filter(key => {
      const up = G.upgrades[key]; return up && R.levels[key] > 0 && order[up.cat] != null;
    }).sort((a, b) => (order[G.upgrades[a].cat] - order[G.upgrades[b].cat]));
  }

  /* per-frame helpers hoisted out of draw() (no closures / allocations per frame) */
  const rowW = [0, 0], rowT = ['', ''];
  function counterRow(ctx, y, txt, ic, pop, col, slot) {
    const s = 1 + pop * 0.22;
    ctx.save(); ctx.translate(L.rx, y); ctx.scale(s, s);
    text(ctx, txt, 0, 0, F.big, col, 'right', 'rgba(8,14,26,.85)', Math.max(3, 4 * k));
    if (rowT[slot] !== txt) { rowT[slot] = txt; rowW[slot] = ctx.measureText(txt).width; }   // measure only when the text changes
    drawIcon(ctx, ic, -rowW[slot] - 14 * k, -7 * k, 22 * k);
    ctx.restore();
  }
  function progMark(ctx, mx, my, col) {
    const r = 4 * k; ctx.beginPath(); ctx.moveTo(mx, my - r); ctx.lineTo(mx + r, my); ctx.lineTo(mx, my + r); ctx.lineTo(mx - r, my); ctx.closePath();
    ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.stroke();
  }
  function offPtr(ctx, x, y, ic, col, big, now) {
    const m = 30 * k, top = safe.t + L.xpH + m + 60 * k, cx = V.w / 2, cy = V.h / 2;
    const cam = V.cam, S = V.scale * cam.zoom * (1 + cam.punch);
    const sx = (x - cam.x) * S + V.w / 2, sy = (y - cam.y) * S + V.h / 2;
    if (sx > -10 && sx < V.w + 10 && sy > -10 && sy < V.h + 10) return;
    const dx = sx - cx, dy = sy - cy;
    const tx = dx ? ((dx > 0 ? V.w - safe.r - m : safe.l + m) - cx) / dx : Infinity;
    const ty = dy ? ((dy > 0 ? V.h - safe.b - m : top) - cy) / dy : Infinity;
    const t = Math.min(tx, ty), ax = cx + dx * t, ay = cy + dy * t, ang = Math.atan2(dy, dx);
    const r = (big ? 17 : 14) * k, bob = Math.sin(now * 5) * 3 * k;
    ctx.save(); ctx.translate(ax + Math.cos(ang) * bob, ay + Math.sin(ang) * bob);
    ctx.rotate(ang); ctx.beginPath(); ctx.moveTo(r + 9 * k, 0); ctx.lineTo(r - 1, -6 * k); ctx.lineTo(r - 1, 6 * k); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.rotate(-ang);
    ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fillStyle = 'rgba(12,20,36,.88)'; ctx.fill(); ctx.lineWidth = 1.6; ctx.strokeStyle = col; ctx.stroke();
    drawIcon(ctx, ic, 0, 0, r * 1.5);
    ctx.restore();
  }
  /* cached glow sprites (avoid per-frame key-string building in G.assets.glow) */
  const GL = {}, DIG = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  const COMBO_COL = ['#fff7e6', '#ffe08a', '#ffab5e', '#ff6fd0'];
  const RAINBOW = []; for (let i = 0; i < 18; i++) RAINBOW.push('hsl(' + (i * 20) + ',100%,72%)');
  const FLAME = ['#ffe7a8', '#ffb347', '#ff7a3d', '#ff5a2a'];
  function glow(col, size) { const key = col + size; return GL[key] || (GL[key] = G.assets.glow(col, size)); }

  /* ---------- main draw ---------- */
  function draw(ctx) {
    const R = G.run; if (!R) return;
    if (V.w !== lw || V.h !== lh || G.input.touchMode !== lt) layout(ctx);
    const dt = Math.min(0.1, G.fx && G.fx.lastDt || 1 / 60);
    const now = performance.now() / 1000; const rdt = st.t ? Math.min(0.1, now - st.t) : 1 / 60; st.t = now;
    const p = R.player, S = G.save.data.settings;
    const touch = lt;
    st.alpha += ((R.over ? 0 : 1) - st.alpha) * Math.min(1, rdt * (R.over ? 3 : 6));
    if (st.alpha < 0.01) return;
    ctx.save();
    ctx.globalAlpha = st.alpha;
    ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    const A = st.alpha;

    const hpF = p.maxHp > 0 ? U.clamp(p.hp / p.maxHp, 0, 1) : 0;

    // top shade for legibility
    ctx.fillStyle = C.shade; ctx.fillRect(0, 0, V.w, Math.round(110 * k) + safe.t);

    /* ===== XP bar ===== */
    const xpF = p.xpNeed > 0 ? U.clamp(p.xp / p.xpNeed, 0, 1) : 0;
    if (p.level !== st.lvl) { if (st.lvl && p.level > st.lvl) { st.lvPop = 1; st.xp = 0; } st.lvl = p.level; st.lvTxt = 'Lv.' + p.level; }
    st.xp += (xpF - st.xp) * Math.min(1, rdt * 10);
    const xh = L.xpH, xw = V.w;
    ctx.fillStyle = 'rgba(6,12,24,.78)'; ctx.fillRect(0, 0, xw, xh + safe.t);
    const fw = xw * st.xp;
    ctx.fillStyle = C.xp; ctx.fillRect(0, safe.t, fw, xh);
    if (fw > 4) {
      // shimmer + glowing tip
      const sp = ((now * 380) % (xw + 200)) - 100;
      if (sp < fw) { ctx.globalAlpha = A * 0.5; ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.max(0, sp - 40), safe.t, Math.min(80, fw - Math.max(0, sp - 40)), xh * 0.45); ctx.globalAlpha = A; }
      ctx.globalCompositeOperation = 'lighter';
      const g = glow('#9ffff0', 64), gs = xh * 5;
      ctx.drawImage(g, fw - gs / 2, safe.t + xh / 2 - gs / 2, gs, gs);
      ctx.globalCompositeOperation = 'source-over';
    }
    if (st.xp > 0.86) {
      // almost there: the whole bar breathes and the tip flares ("もうすぐレベルアップ!")
      const q = (st.xp - 0.86) / 0.14, pul = 0.5 + 0.5 * Math.sin(now * (8 + q * 8));
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = A * (0.18 + 0.32 * q) * pul; ctx.fillStyle = '#eafff9'; ctx.fillRect(0, safe.t, fw, xh);
      ctx.globalAlpha = A * (0.5 + 0.5 * pul) * q; const gs2 = xh * (9 + 6 * q);
      ctx.drawImage(glow('#fff3c4', 64), fw - gs2 / 2, safe.t + xh / 2 - gs2 / 2, gs2, gs2);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = A;
    }
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, safe.t + xh, xw, 1);
    if (st.lvPop > 0) { ctx.globalAlpha = A * st.lvPop; ctx.fillStyle = '#fff7d0'; ctx.fillRect(0, safe.t, xw, xh); ctx.globalAlpha = A; st.lvPop = Math.max(0, st.lvPop - rdt * 1.6); }

    /* ===== portrait + HP ===== */
    const pcx = L.px + L.pr, pcy = L.py + L.pr;
    ctx.fillStyle = C.port; ctx.beginPath(); ctx.arc(pcx, pcy, L.pr, 0, TAU); ctx.fill();
    const pim = img(R.char.portrait || R.charId);
    if (pim) {
      ctx.save(); ctx.beginPath(); ctx.arc(pcx, pcy, L.pr - 1.5, 0, TAU); ctx.clip();
      const ph = L.pr * 3.1, pw = ph * pim.width / pim.height;
      ctx.drawImage(pim, pcx - pw / 2, pcy - L.pr * 1.12, pw, ph);
      ctx.restore();
    }
    ctx.lineWidth = Math.max(2, 2.2 * k); ctx.strokeStyle = '#d3bc8e'; ctx.beginPath(); ctx.arc(pcx, pcy, L.pr, 0, TAU); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,244,214,.5)'; ctx.beginPath(); ctx.arc(pcx, pcy, L.pr + 3 * k, -2.4, -0.7); ctx.stroke();
    // level badge
    {
      const s = 1 + st.lvPop * 0.35, bw = 44 * k, bh = 17 * k, bx = pcx, by = pcy + L.pr - 2 * k;
      ctx.save(); ctx.translate(bx, by); ctx.scale(s, s);
      rr(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2); ctx.fillStyle = '#16233a'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#d3bc8e'; ctx.stroke();
      ctx.textBaseline = 'middle'; text(ctx, st.lvTxt, 0, 0.5, F.tiny, st.lvPop > 0.05 ? '#fff3b0' : '#f5deb0', 'center'); ctx.textBaseline = 'alphabetic';
      ctx.restore();
    }
    // HP bar with trail + shield
    st.hpT = st.hpT > hpF ? Math.max(hpF, st.hpT - rdt * 0.45) : hpF;
    const bx = L.barX, by = L.barY, bw = L.barW, bh = L.barH;
    text(ctx, R.char.name || '', bx + 2, by - 5 * k, F.small, '#fff4d6', 'left', 'rgba(0,0,0,.75)', 3);
    rr(ctx, bx - 2, by - 2, bw + 4, bh + 4, (bh + 4) / 2); ctx.fillStyle = 'rgba(6,12,24,.8)'; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(211,188,142,.7)'; ctx.stroke();
    ctx.save(); rr(ctx, bx, by, bw, bh, bh / 2); ctx.clip();
    ctx.fillStyle = '#ffffff'; ctx.globalAlpha = A * 0.55; ctx.fillRect(bx, by, bw * st.hpT, bh); ctx.globalAlpha = A;
    ctx.fillStyle = hpF < 0.3 ? C.hpLow : C.hp; ctx.fillRect(bx, by, bw * hpF, bh);
    ctx.fillStyle = 'rgba(255,255,255,.28)'; ctx.fillRect(bx, by, bw * hpF, bh * 0.38);
    if (p.shield > 0) { const sf = U.clamp(p.shield / p.maxHp, 0, 1); ctx.fillStyle = 'rgba(255,210,74,.85)'; ctx.fillRect(bx, by + bh * 0.55, bw * sf, bh * 0.45); }
    ctx.restore();
    const h1 = Math.ceil(p.hp), h3 = Math.ceil(p.shield || 0);
    if (h1 !== st.hpA || p.maxHp !== st.hpB || h3 !== st.hpC) { st.hpA = h1; st.hpB = p.maxHp; st.hpC = h3; st.hpTxt = U.fmtNum(Math.max(0, Math.ceil(p.hp))) + ' / ' + U.fmtNum(p.maxHp) + (p.shield > 0 ? '  +' + U.fmtNum(Math.ceil(p.shield)) : ''); }
    ctx.textBaseline = 'middle'; text(ctx, st.hpTxt, bx + bw - 6, by + bh / 2 + 0.5, F.tiny, '#ffffff', 'right', 'rgba(0,0,0,.7)', 2.5); ctx.textBaseline = 'alphabetic';
    // energy strip under HP (desktop info; touch shows ring on the button)
    const cost = R.char.energyCost || 1, enF = U.clamp(p.energy / cost, 0, 1);
    st.energyShow += (enF - st.energyShow) * Math.min(1, rdt * 8);
    rr(ctx, bx, by + bh + 4 * k, bw * 0.6, Math.max(3, 4 * k), 2); ctx.fillStyle = 'rgba(6,12,24,.75)'; ctx.fill();
    rr(ctx, bx, by + bh + 4 * k, bw * 0.6 * st.energyShow, Math.max(3, 4 * k), 2); ctx.fillStyle = enF >= 1 ? (Math.sin(now * 8) > 0 ? '#ffe7a8' : '#ff9a4a') : '#ff7a3d'; ctx.fill();

    /* ===== owned weapons row ===== */
    {
      const s = L.iconS, gap = Math.round(5 * k); let x = L.px, y = L.iconY;
      const maxX = Math.max(L.barX + L.barW, L.px + 6 * (s + gap));
      for (let i = 0; i < st.owned.length; i++) {
        const key = st.owned[i], up = G.upgrades[key]; if (!up) continue;
        if (x + s > maxX) { x = L.px; y += s + gap + 4; }
        const evo = up.cat === 'evo' || R.evolved[key], bless = up.cat === 'bless';
        if (bless) {
          // ★5 天啓カード: gold slot with a breathing halo and a star badge
          const pul = 0.5 + 0.5 * Math.sin(now * 3.2 + i);
          ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = A * (0.35 + 0.35 * pul);
          const gs = s * 2.1; ctx.drawImage(glow('#ffcf6b', 64), x + s / 2 - gs / 2, y + s / 2 - gs / 2, gs, gs);
          ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = A;
          rr(ctx, x, y, s, s, 6 * k); ctx.fillStyle = C.bless; ctx.fill();
          ctx.lineWidth = 2; ctx.strokeStyle = pul > 0.5 ? '#fff4c4' : '#ffcf6b'; ctx.stroke();
        } else {
          rr(ctx, x, y, s, s, 6 * k); ctx.fillStyle = evo ? 'rgba(90,58,20,.9)' : 'rgba(16,26,44,.82)'; ctx.fill();
          ctx.lineWidth = evo ? 1.6 : 1; ctx.strokeStyle = evo ? '#ffe7a8' : 'rgba(211,188,142,.55)'; ctx.stroke();
        }
        if (up.hudIcon || up.icon) drawIcon(ctx, up.hudIcon || up.icon, x + s / 2, y + s / 2, s * 0.8);
        const lv = R.levels[key] || 0, mx = up.max || 1;
        if (bless) text(ctx, '★', x + s - 1, y + 9 * k, F.tiny, '#fff4c4', 'right', 'rgba(90,50,0,.9)', 2.5);
        else if (!evo) {
          const t = lv >= mx ? 'M' : DIG[lv] || String(lv);
          ctx.textBaseline = 'alphabetic';
          text(ctx, t, x + s - 2, y + s - 2, F.tiny, lv >= mx ? '#ffd86b' : '#ffffff', 'right', 'rgba(0,0,0,.85)', 2.5);
        }
        x += s + gap;
      }
    }

    /* ===== timer + stage progress ===== */
    const sec = Math.floor(R.time);
    if (sec !== st.sec) {
      if (st.sec >= 0 && Math.floor(sec / 60) !== Math.floor(st.sec / 60) && sec > 0) st.minPulse = 1;
      st.sec = sec; st.secTxt = U.fmtTime(sec);
    }
    {
      const s = 1 + st.minPulse * 0.28 * U.ease.outCubic(st.minPulse);
      ctx.save(); ctx.translate(L.tx, L.ty - 12 * k); ctx.scale(s, s);
      const col = R.time >= 600 ? '#ffd86b' : st.minPulse > 0.05 ? '#fff0b0' : '#fff7e6';
      text(ctx, st.secTxt, 0, 12 * k, F.timer, col, 'center', 'rgba(8,14,26,.85)', Math.max(3, 5 * k));
      ctx.restore();
      if (st.minPulse > 0) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = A * st.minPulse * 0.8;
        const gs = 170 * k; ctx.drawImage(glow('#ffe7a8', 128), L.tx - gs / 2, L.ty - 12 * k - gs / 2, gs, gs);
        ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = A;
        st.minPulse = Math.max(0, st.minPulse - rdt * 1.1);
      }
      // progress towards 10:00 (boss markers at 5:00 and 10:00)
      const dur = (G.data.stages[R.stageId] || {}).duration || 600, pw = L.progW, x0 = L.tx - pw / 2, py = L.progY;
      const pf = U.clamp(R.time / dur, 0, 1);
      rr(ctx, x0, py, pw, Math.max(3, 3 * k), 2); ctx.fillStyle = 'rgba(6,12,24,.7)'; ctx.fill();
      rr(ctx, x0, py, pw * pf, Math.max(3, 3 * k), 2); ctx.fillStyle = '#d3bc8e'; ctx.fill();
      progMark(ctx, x0 + pw * 0.5, py + 1.5 * k, pf >= 0.5 ? '#fff3b0' : '#c95a5a');
      progMark(ctx, x0 + pw, py + 1.5 * k, pf >= 1 ? '#fff3b0' : '#5cf2c8');
    }

    /* ===== Mora & kills (top-right) ===== */
    {
      if (R.kills !== st.lastKills) { st.lastKills = R.kills; st.killsPop = 1; }
      const mora = Math.floor(R.mora); if (mora !== st.lastMora) { if (mora > st.lastMora) st.moraPop = 1; st.lastMora = mora; }
      st.kills += (R.kills - st.kills) * Math.min(1, rdt * 12); if (Math.abs(R.kills - st.kills) < 0.5) st.kills = R.kills;
      st.mora += (mora - st.mora) * Math.min(1, rdt * 9); if (Math.abs(mora - st.mora) < 0.5) st.mora = mora;
      const kr = Math.round(st.kills); if (kr !== st.killN) { st.killN = kr; st.killTxt = U.fmtNum(kr); }
      const mr = Math.round(st.mora); if (mr !== st.moraN) { st.moraN = mr; st.moraTxt = U.fmtNum(mr); }
      counterRow(ctx, L.ry, st.moraTxt, 'mora', st.moraPop, '#ffe08a', 0);
      counterRow(ctx, L.ry + 26 * k, st.killTxt, 'hilichurl', st.killsPop * 0.6, '#fff7e6', 1);
      st.killsPop = Math.max(0, st.killsPop - rdt * 6); st.moraPop = Math.max(0, st.moraPop - rdt * 4);
    }

    /* ===== combo ===== */
    {
      const c = R.combo || 0;
      if (c > st.combo) { st.comboPop = 1; st.comboShow = c; st.comboTxt = String(c); }
      if (c < st.combo && c === 0) st.nextHype = 0;
      st.combo = c;
      while (st.nextHype < HYPE.length && c >= HYPE[st.nextHype]) {
        st.hype = { text: HYPE[st.nextHype] + ' COMBO!', t: 0, tier: st.nextHype };
        st.nextHype++; try { G.audio.sfx('comboUp', { level: st.nextHype }); } catch (e) { }
      }
      const target = c >= 10 ? 1 : 0;
      st.comboA += (target - st.comboA) * Math.min(1, rdt * (target ? 10 : 2.2));
      if (st.comboA > 0.02 && st.comboShow >= 10) {
        const cs = st.comboShow, tier = cs >= 1000 ? 4 : cs >= 500 ? 3 : cs >= 200 ? 2 : cs >= 50 ? 1 : 0;
        const col = tier >= 4 ? RAINBOW[((now * 9) | 0) % RAINBOW.length] : COMBO_COL[tier];
        const s = 1 + st.comboPop * (0.3 + tier * 0.06);
        const decay = R.comboTimer > 0 ? U.clamp(R.comboTimer / 2.2, 0, 1) : 0;
        // the bigger the combo the more it trembles (reducedFx: calmer)
        const jit = (S.reducedFx ? 0.4 : 1) * (tier * 0.9 + st.comboPop * 3) * k;
        const jx = jit ? Math.sin(now * 53) * jit : 0, jy = jit ? Math.cos(now * 47) * jit * 0.7 : 0, jr = tier >= 2 ? Math.sin(now * 31) * 0.012 * tier : 0;
        ctx.save(); ctx.globalAlpha = A * st.comboA; ctx.translate(L.rx + jx, L.cy + jy); ctx.rotate(jr); ctx.scale(s, s);
        if (tier >= 1) { ctx.globalCompositeOperation = 'lighter'; const gs = 110 * k; ctx.globalAlpha = A * st.comboA * (0.35 + 0.15 * tier); ctx.drawImage(glow(col, 128), -gs * 0.7, -gs * 0.62, gs, gs * 0.8); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = A * st.comboA; }
        text(ctx, st.comboTxt, 0, 0, F.combo, col, 'right', 'rgba(8,14,26,.9)', Math.max(4, 6 * k));
        text(ctx, 'COMBO', 0, 16 * k, F.comboL, '#f5deb0', 'right', 'rgba(8,14,26,.9)', 3);
        // decay bar
        const dw = 70 * k; rr(ctx, -dw, 22 * k, dw, 3 * k, 2); ctx.fillStyle = 'rgba(6,12,24,.7)'; ctx.fill();
        rr(ctx, -dw, 22 * k, dw * decay, 3 * k, 2); ctx.fillStyle = col; ctx.fill();
        ctx.restore();
        st.comboPop = Math.max(0, st.comboPop - rdt * 7);
      }
      if (st.hype) {
        const h = st.hype; h.t += rdt;
        const T = 1.6, f = h.t / T;
        if (f >= 1) st.hype = null;
        else {
          const inK = U.ease.outBack(Math.min(1, h.t / 0.25)), out = f > 0.75 ? 1 - (f - 0.75) / 0.25 : 1;
          const cols = ['#ffe08a', '#ffab5e', '#ff7a5a', '#ff6fd0', '#b48bff', '#6fe8ff'];
          const col = cols[Math.min(cols.length - 1, h.tier)];
          ctx.save(); ctx.globalAlpha = A * out;
          // pops out right under the combo counter (keeps the centre of the screen free for the fight / big banners)
          ctx.translate(L.rx + (1 - inK) * 60 * k, L.cy + 58 * k - f * 14 * k); ctx.scale(0.4 + 0.6 * inK, 0.4 + 0.6 * inK); ctx.rotate(-0.06);
          ctx.globalCompositeOperation = 'lighter'; const gs = 230 * k; ctx.drawImage(glow(col, 128), -gs * 0.85, -gs * 0.3, gs, gs * 0.45); ctx.globalCompositeOperation = 'source-over';
          text(ctx, h.text, 0, 12 * k, F.hype, '#ffffff', 'right', col, Math.max(5, 8 * k));
          text(ctx, h.text, 0, 12 * k, F.hype, '#fffbe8', 'right');
          ctx.restore();
        }
      }
    }

    /* ===== boss bar ===== */
    {
      const b = R.boss && !R.boss.dead ? R.boss : null;
      if (b && b !== st.bossE) { st.bossE = b; st.bossHp = 1; st.bossTrail = 1; st.bossA = 0; }
      const tgt = b ? 1 : 0; st.bossA += (tgt - st.bossA) * Math.min(1, rdt * (b ? 4 : 3));
      const e = st.bossE;
      if (e && st.bossA > 0.02) {
        const f = e.dead ? 0 : U.clamp(e.hp / e.maxHp, 0, 1);
        if (f < st.bossHp - 0.0001) st.bossHold = 0.5;
        st.bossHp = f;
        if (st.bossHold > 0) st.bossHold -= rdt; else st.bossTrail = Math.max(f, st.bossTrail - rdt * 0.35);
        const w = L.bossW, x0 = L.tx - w / 2, y = L.bossY, h = L.bossH;
        ctx.save(); ctx.globalAlpha = A * st.bossA;
        const def = e.def || {};
        ctx.textBaseline = 'alphabetic';
        if (st.bossFor !== e) { st.bossFor = e; st.bossTT = def.bossTitle ? '「' + def.bossTitle + '」 ' : ''; ctx.font = F.bossT; st.bossTW = st.bossTT ? ctx.measureText(st.bossTT).width : 0; }
        if (st.bossTT) text(ctx, st.bossTT, x0, y - 7 * k, F.bossT, '#f5deb0', 'left', 'rgba(0,0,0,.8)', 3);
        const tw = st.bossTW;
        text(ctx, def.name || '', x0 + tw, y - 7 * k, F.boss, e.enraged ? '#ff9a8a' : '#fff4d6', 'left', 'rgba(0,0,0,.85)', 3.5);
        rr(ctx, x0 - 3, y - 3, w + 6, h + 6, 3); ctx.fillStyle = 'rgba(6,10,20,.85)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = e.enraged ? '#ff5a5a' : 'rgba(211,188,142,.8)'; ctx.stroke();
        ctx.fillStyle = 'rgba(255,240,220,.8)'; ctx.fillRect(x0, y, w * st.bossTrail, h);
        ctx.fillStyle = C.boss; ctx.fillRect(x0, y, w * f, h);
        if (e.enraged) { ctx.globalAlpha = A * st.bossA * (0.3 + 0.3 * Math.sin(now * 10)); ctx.fillStyle = '#ffffff'; ctx.fillRect(x0, y, w * f, h); ctx.globalAlpha = A * st.bossA; }
        ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(x0, y, w * f, h * 0.35);
        ctx.fillStyle = 'rgba(6,10,20,.8)';
        for (let i = 1; i < 10; i++) ctx.fillRect(Math.round(x0 + w * i / 10) - 1, y, 2, h);
        // end diamonds
        for (const dx of [x0 - 8 * k, x0 + w + 8 * k]) { ctx.beginPath(); ctx.moveTo(dx, y + h / 2 - 5 * k); ctx.lineTo(dx + 4 * k, y + h / 2); ctx.lineTo(dx, y + h / 2 + 5 * k); ctx.lineTo(dx - 4 * k, y + h / 2); ctx.closePath(); ctx.fillStyle = '#d3bc8e'; ctx.fill(); }
        ctx.restore();
        if (!b && st.bossA < 0.03) st.bossE = null;
      }
    }

    /* ===== skill / burst ===== */
    {
      const sCd = Math.max(0, p.skillCd || 0), bCd = Math.max(0, p.burstCd || 0);
      if (sCd > st.sMax || sCd <= 0) st.sMax = Math.max(sCd, 0.001);
      if (bCd > st.bMax || bCd <= 0) st.bMax = Math.max(bCd, 0.001);
      const sF = sCd > 0 ? U.clamp(sCd / st.sMax, 0, 1) : 0, bF = bCd > 0 ? U.clamp(bCd / st.bMax, 0, 1) : 0;
      const ready = enF >= 1 && bCd <= 0;
      if (ready && !st.tb.sr) st.readyT = 1;
      st.tb.sr = ready;
      if (touch) {
        const tb = st.tb;
        if (Math.abs(tb.s - sF) > 0.008 || Math.abs(tb.b - bF) > 0.008 || tb.r !== ready || Math.abs(tb.e - enF) > 0.008) {
          tb.s = sF; tb.b = bF; tb.r = ready; tb.e = enF;
          try { G.input.setButtons(sF, bF, ready, enF, sCd, bCd); } catch (e) { }
        }
      } else {
        dial(ctx, L.sX, L.sY, L.sR, C.sDisc, R.char.skillIcon || 'bunny', sF, sCd, sCd <= 0, null, 'F', now, A);
        dial(ctx, L.bX, L.bY, L.bR, C.bDisc, R.char.burstIcon || 'rain', bF, bCd, ready, enF, 'Q', now, A);
      }
    }

    /* ===== off-screen pointers ===== */
    {
      if (R.pickups) { let n = 0; for (let i = 0; i < R.pickups.length && n < 4; i++) { const o = R.pickups[i]; if (o.type === 'chest' || o.type === 'relic') { offPtr(ctx, o.x, o.y, o.type === 'chest' ? 'chest' : 'relic', '#ffd86b', false, now); n++; } } }
      if (R.boss && !R.boss.dead) offPtr(ctx, R.boss.x, R.boss.y, R.boss.def.atlas === 'venti' ? 'venti' : 'ruin', '#ff5a5a', true, now);
    }

    /* ===== FPS ===== */
    if (S.showFps) {
      st.fpsT -= rdt; if (st.fpsT <= 0) { st.fpsT = 0.5; st.fpsTxt = Math.round(G.fps) + ' FPS'; }
      text(ctx, st.fpsTxt, L.px, L.iconY + L.iconS * (st.owned.length > 6 ? 2 : 1) + 20 * k, F.small, G.fps < 45 ? '#ff9a8a' : '#9fffd9', 'left', 'rgba(0,0,0,.8)', 3);
    }
    ctx.restore();
  }

  function dial(ctx, x, y, r, disc, ic, cdF, cd, ready, enF, key, now, A) {
    if (ready && enF != null) flames(ctx, x, y, r, now, A);
    if (ready) {
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = A * (enF != null ? 0.55 + 0.3 * Math.sin(now * 5) : 0.35);
      const gs = r * 3.6; ctx.drawImage(glow(enF != null ? '#ffb347' : '#ffe7a8', 128), x - gs / 2, y - gs / 2, gs, gs);
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = A;
    }
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fillStyle = disc; ctx.fill();
    drawIcon(ctx, ic, x, y, r * 1.35, cd > 0 ? 0.55 : 1);
    if (cdF > 0) {
      ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + TAU * cdF); ctx.closePath();
      ctx.fillStyle = 'rgba(4,8,16,.62)'; ctx.fill();
      ctx.textBaseline = 'middle'; text(ctx, cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1), x, y + 1, F.dial, '#ffffff', 'center', 'rgba(0,0,0,.8)', 3); ctx.textBaseline = 'alphabetic';
    }
    ctx.lineWidth = Math.max(2, 2 * k); ctx.strokeStyle = ready ? '#fff4d6' : '#d3bc8e'; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
    if (enF != null) {
      const rr2 = r + 6 * k; ctx.lineWidth = Math.max(3, 4 * k); ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(6,12,24,.75)'; ctx.beginPath(); ctx.arc(x, y, rr2, 0, TAU); ctx.stroke();
      if (enF > 0) { ctx.strokeStyle = enF >= 1 ? '#ffe7a8' : '#ff7a3d'; ctx.beginPath(); ctx.arc(x, y, rr2, -Math.PI / 2, -Math.PI / 2 + TAU * enF); ctx.stroke(); }
      ctx.lineCap = 'butt';
    }
    // key hint
    const kx = x - r * 0.72, ky = y + r * 0.72, kr = 9 * k;
    ctx.beginPath(); ctx.arc(kx, ky, kr, 0, TAU); ctx.fillStyle = '#ece5d8'; ctx.fill();
    ctx.textBaseline = 'middle'; text(ctx, key, kx, ky + 0.5, F.key, '#3f4659', 'center'); ctx.textBaseline = 'alphabetic';
    if (ready && enF != null) text(ctx, 'READY', x, y - r - 12 * k, F.key, '#ffe7a8', 'center', 'rgba(0,0,0,.8)', 3);
  }

  /** flickering flame tongues licking around a ready burst dial (cheap: a handful of bezier petals, additive) */
  function flames(ctx, x, y, r, now, A) {
    const n = G.save.data.settings.reducedFx ? 6 : 10;
    ctx.save(); ctx.translate(x, y); ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + now * 0.9, f = 0.55 + 0.45 * Math.sin(now * 11 + i * 2.3) * Math.sin(now * 7.3 + i);
      const len = r * (0.42 + 0.38 * f), w = r * 0.26;
      ctx.rotate(a); ctx.globalAlpha = A * (0.35 + 0.4 * f);
      ctx.fillStyle = FLAME[i & 3];
      ctx.beginPath(); ctx.moveTo(r * 0.92, -w); ctx.quadraticCurveTo(r + len * 0.55, -w * 0.9, r + len, Math.sin(now * 9 + i) * w * 0.5);
      ctx.quadraticCurveTo(r + len * 0.55, w * 0.9, r * 0.92, w); ctx.closePath(); ctx.fill();
      ctx.rotate(-a);
    }
    ctx.restore();
  }

  /* ---------- DOM banners ---------- */
  const E = (...a) => G.ui.el(...a);
  function add(node, life) { layer.append(node); setTimeout(() => node.remove(), life); return node; }
  let noteN = 0;
  const on = (ev, fn) => G.bus.on(ev, d => { try { if (G.scene === 'run' && G.run) fn(d); } catch (e) { console.error('[hud]', ev, e); } });
  let lastNote = { text: '', t: 0, node: null };
  on('stageEvent', ev => {
    if (!ev) return;
    if (ev.kind === 'surge') {
      // spawner also emits a plain notice with the same text right before — replace it with the big surge band
      layer.querySelectorAll('.bn-note').forEach(n => { if (n.textContent === ev.text) n.remove(); });
      layer.querySelectorAll('.bn-surge').forEach(n => n.remove());
      const col = ev.color || '#ff7a9a';
      add(E('div', { class: 'bn bn-surge', style: `--c:${col}` }, E('div', { class: 'sx' }, E('i', null, '》》'), E('div', null, E('small', null, 'HORDE SURGE'), ev.text || '大群が来る！'), E('i', null, '《《'))), 3000);
      try { G.audio.sfx('bossWarning', { soft: true }); } catch (e) { }
      return;
    }
    if (ev.kind === 'bossPhase') {
      const recent = performance.now() - lastNote.t < 400 ? lastNote : null;
      if (recent && recent.node) recent.node.remove();
      const name = (ev.boss && ev.boss.def && ev.boss.def.name) || 'ボス';
      big('phase', 'PHASE ' + (ev.phase || 2), ev.phase >= 3 ? name + ' ・ 最後の嵐' : name + ' ・ 覚醒', recent ? recent.text : '', 2800);
      return;
    }
    if (!ev.banner || ev.boss) return;
    layer.querySelectorAll('.bn-stage').forEach(n => n.remove());
    add(E('div', { class: 'bn bn-stage' }, E('div', { class: 'bx' }, E('small', null, U.fmtTime(ev.time || G.run.time)), ev.banner)), 2900);
  });
  on('bossWarning', ev => {
    layer.querySelectorAll('.bn-warn,.warn-vig').forEach(n => n.remove());
    try { G.audio.sfx('bossWarning'); } catch (e) { }
    if (!G.save.data.settings.reducedFx) add(E('div', { class: 'warn-vig' }), 3200);
    add(E('div', { class: 'bn bn-warn' }, E('div', { class: 'wband' }, E('div', { class: 'wt' }, 'WARNING')), E('div', { class: 'ws' }, (ev && ev.banner) || '強敵接近')), 3500);
  });
  const GOLD_RX = /群れボーナス|宝箱|進化|星の大玉|★/;
  function isGold(n) { return !!(n.gold || (n.color && /^#ffd24a$/i.test(n.color)) || GOLD_RX.test(n.text)); }
  let goldN = 0;
  function goldBanner(n) {
    // 「群れボーナス！」「宝箱ヒルチャール」etc: a gold ribbon with a shine sweep and bursting stars
    const low = G.save.data.settings.reducedFx, sad = /逃げられ|にげられ/.test(n.text);
    const i = goldN++ % 2;
    layer.querySelectorAll('.bn-gold').forEach(g => { if (g._slot === i) g.remove(); });
    const m = n.text.match(/^(.+?[！!])\s*(.*)$/);
    const main = m ? m[1] : n.text, sub = m ? m[2] : '';
    const stars = E('div', { class: 'gstars' });
    if (!low && !sad) for (let j = 0; j < 10; j++) { const a = (j / 10) * Math.PI * 2; stars.append(E('i', { style: `--tx:${Math.round(Math.cos(a) * (120 + Math.random() * 80))}px;--ty:${Math.round(Math.sin(a) * (40 + Math.random() * 30))}px;--d:${(Math.random() * 0.15).toFixed(2)}s` }, '✦')); }
    const node = E('div', { class: 'bn bn-gold' + (sad ? ' sad' : '') }, E('div', { class: 'gx' }, stars, E('b', { class: 'gm' }, main), sub ? E('small', null, sub) : null));
    node._slot = i; node.style.marginTop = (i * 52) + 'px';
    add(node, 3000);
    // plain notices already on screen slide down out of the ribbon's way
    layer.querySelectorAll('.bn-note').forEach(q => { q.classList.add('below'); });
    try { G.audio.sfx(sad ? 'denied' : 'star', { rarity: 4 }); } catch (e) { }
    return node;
  }
  on('notice', n => {
    if (!n || !n.text) return;
    if (isGold(n)) { lastNote = { text: n.text, t: performance.now(), node: goldBanner(n) }; return; }
    const i = noteN++ % 3;
    const node = E('div', { class: 'bn bn-note' + (layer.querySelector('.bn-gold') ? ' below' : '') }, E('div', { class: 'nx', style: `color:${n.color || '#fff'}` }, n.text));
    node.style.marginTop = (i * 36) + 'px';
    add(node, 2700);
    lastNote = { text: n.text, t: performance.now(), node };
  });
  function big(cls, kick, title, desc, life) {
    layer.querySelectorAll('.bn-big').forEach(n => n.remove());
    add(E('div', { class: 'bn bn-big ' + cls }, E('div', { class: 'glow' }), E('div', { class: 'bk' }, kick), E('div', { class: 'bt' }, title), desc ? E('div', { class: 'bd' }, desc) : null), life || 2900);
  }
  on('resonance', d => {
    const name = (d && (d.name || (G.data.resonance && G.data.resonance[d.key] && G.data.resonance[d.key].name))) || '元素共鳴';
    const desc = (d && (d.desc || (G.data.resonance && G.data.resonance[d.key] && G.data.resonance[d.key].desc))) || '';
    big('res', '元素共鳴', name, desc);
  });
  on('evolution', d => {
    const up = d && G.upgrades[d.key];
    big('evo', 'EVOLUTION ・ 進化！', up ? up.name : '進化', up && up.short ? up.short : '');
    refreshOwned(G.run);
  });
  on('bossKilled', e => { if (!e || !e.def) return; big('kill', 'DEFEATED', e.def.name + ' 撃破！', e.def.final ? '' : 'ごほうびの宝箱をひろおう！', 2600); });
  on('bossEnrage', e => { add(E('div', { class: 'bn bn-note' }, E('div', { class: 'nx', style: 'color:#ff9a8a' }, ((e && e.def && e.def.name) || 'ボス') + ' が本気になった！')), 2700); });
  G.bus.on('upgrade', () => { if (G.run) refreshOwned(G.run); });
  G.bus.on('runStart', R => { resetState(); layer.innerHTML = ''; refreshOwned(R); lw = -1; touchIcons(R); });
  /** touch skill/burst buttons show this character's icons (procedural ones as data URLs, cached) */
  const iconUrlCache = {};
  function iconUrl(name) {
    if (iconUrlCache[name]) return iconUrlCache[name];
    const c = G.proceduralIcons && G.proceduralIcons[name];
    let u = 'assets/icon_' + name + '.webp';
    if (c) { try { u = c.toDataURL('image/png'); } catch (e) { } }
    return (iconUrlCache[name] = u);
  }
  function touchIcons(R) {
    try {
      const ch = (R && R.char) || {};
      const s = document.querySelector('#tSkill img'), b = document.querySelector('#tBurst img');
      if (s) { const u = iconUrl(ch.skillIcon || 'bunny'); if (s.getAttribute('src') !== u) s.setAttribute('src', u); }
      if (b) { const u = iconUrl(ch.burstIcon || 'rain'); if (b.getAttribute('src') !== u) b.setAttribute('src', u); }
    } catch (e) { }
  }
  G.hudIconUrl = iconUrl;
  G.bus.on('scene', s => { if (s !== 'run') layer.innerHTML = ''; });
  G.bus.on('runEnd', () => setTimeout(() => { layer.querySelectorAll('.bn-note,.bn-stage,.bn-warn,.warn-vig').forEach(n => n.remove()); }, 400));
  addEventListener('resize', () => { lw = -1; });

  return { draw, layer };
})();
