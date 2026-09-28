/* ningguang.js — Ningguang's full kit (owner: NINGGUANG). Geo / catalyst.
   Normal  千金の石粒: every volley (1.1 s at haste 1) 7 golden pebbles spray out around her and HOME into the nearest
           enemies (Peachone-like). 1 pebble = 25 % ATK = 1/4 of Amber's lv0 arrow (Amber normalMul lv0 = 1.0).
           levels: ng_gems (+3 pebbles / lv, 7→22), ng_power (25→60 %).
           evolution evo_ng_normal 天権の宝石雨 (ng_gems + ng_power + haste all MAX): +6 pebbles, bigger gems that pierce
           1 and shatter into a small geo splash on every hit, and every 5 s a rain of 12 big gems falls on the enemies.
   Skill   璇璣屏 (F): a golden jade screen (10 s) stands in front of her, across her facing direction. Damages the
           enemies around it when it rises. Normal enemies and enemy projectiles/rocks can NOT pass it (G.barrier),
           elites and bosses pass through but are slowed while inside; the player walks through freely.
           Passive 屏風の加護: a pebble that flies through the screen deals +30 %.   levels: ng_skill
   Burst   天権崩玉 (Q): all pebbles of the current volley size (7, 16, …) gather behind her and fire together in the
           direction she faces — bigger, bigger hitbox, piercing, 10× damage.   levels: ng_burst (size, extra volleys, rock blasts)
   Stats read from R.stats (set by upgrades.js mods, lv0 defaults here): ngGems ngMul ngSkillMul ngWall ngBurstLv.
   Also uses the shared S.haste, S.range, S.extraProjectiles (meta 矢の本数 → +2 pebbles each), S.normalDmg, S.projSpeed.
   Performance: pebbles live in a module pool (no per-frame allocation), collision via one bound grid callback. */
'use strict';
(function () {
  const U = G.u, W = G.weapons, TAU = Math.PI * 2;
  const GO = '#ffcf4a', GOL = '#fff0a8', GOD = '#b8860b';
  const reduced = () => !!(G.save && G.save.data.settings.reducedFx);
  const glow = (c, s) => G.assets.glow(c, s);
  const LIFT = 1.0; // pebbles fly at chest height

  /* ============================ cached procedural sprites ============================ */
  const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  /** faceted golden gem, centred, 64×64 */
  function makeGem(big) {
    const c = mk(64, 64), x = c.getContext('2d'), cx = 32, cy = 32, w = big ? 22 : 18, h = big ? 28 : 24;
    const top = [cx, cy - h], rt = [cx + w, cy - 3], bot = [cx, cy + h], lt = [cx - w, cy - 3], mid = [cx, cy - 5];
    const face = (a, b, col) => { x.fillStyle = col; x.beginPath(); x.moveTo(a[0], a[1]); x.lineTo(b[0], b[1]); x.lineTo(mid[0], mid[1]); x.closePath(); x.fill(); };
    face(top, rt, big ? '#fff6c8' : '#ffeaa0'); face(rt, bot, '#e9a21a'); face(bot, lt, '#b8740a'); face(lt, top, '#ffd65a');
    x.strokeStyle = 'rgba(255,255,240,.95)'; x.lineWidth = 2;
    x.beginPath(); x.moveTo(top[0], top[1]); x.lineTo(rt[0], rt[1]); x.lineTo(bot[0], bot[1]); x.lineTo(lt[0], lt[1]); x.closePath(); x.stroke();
    x.strokeStyle = 'rgba(120,70,0,.55)'; x.lineWidth = 1; x.beginPath(); x.moveTo(lt[0], lt[1]); x.lineTo(mid[0], mid[1]); x.lineTo(rt[0], rt[1]); x.moveTo(mid[0], mid[1]); x.lineTo(bot[0], bot[1]); x.stroke();
    x.fillStyle = '#fff'; x.beginPath(); x.arc(cx - 5, cy - 12, big ? 3.2 : 2.6, 0, TAU); x.fill();
    return c;
  }
  /** little screen (skill icon) */
  function drawScreen(x, cx, cy, w, h) {
    x.fillStyle = '#6a4a18'; x.fillRect(cx - w / 2 - 4, cy + h / 2 - 2, w + 8, 8);
    let g = x.createLinearGradient(0, cy - h / 2, 0, cy + h / 2); g.addColorStop(0, '#fff8d8'); g.addColorStop(1, '#ffd35a');
    x.fillStyle = g; x.fillRect(cx - w / 2, cy - h / 2, w, h);
    x.strokeStyle = '#c8901a'; x.lineWidth = 5; x.strokeRect(cx - w / 2, cy - h / 2, w, h);
    x.lineWidth = 2; x.beginPath(); x.moveTo(cx, cy - h / 2); x.lineTo(cx, cy + h / 2); x.stroke();
    x.fillStyle = '#ffcf4a'; x.beginPath(); x.moveTo(cx, cy - h / 2 - 12); x.lineTo(cx + 9, cy - h / 2); x.lineTo(cx, cy - h / 2 + 8); x.lineTo(cx - 9, cy - h / 2); x.closePath(); x.fill();
    x.strokeStyle = '#8a5a10'; x.lineWidth = 1.5; x.stroke();
    g = x.createRadialGradient(cx, cy, 2, cx, cy, w * 0.6); g.addColorStop(0, 'rgba(255,255,255,.7)'); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(cx - w / 2, cy - h / 2, w, h);
  }
  function makeIcon(kind) {
    const c = mk(128, 128), x = c.getContext('2d');
    const g = x.createRadialGradient(64, 64, 6, 64, 64, 62); g.addColorStop(0, 'rgba(255,220,120,.6)'); g.addColorStop(1, 'rgba(200,140,20,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
    const gem = SPR.gem || (SPR.gem = makeGem(false)), big = SPR.gemBig || (SPR.gemBig = makeGem(true));
    const put = (im, cx, cy, s, rot) => { x.save(); x.translate(cx, cy); x.rotate(rot || 0); x.drawImage(im, -s / 2, -s / 2, s, s); x.restore(); };
    if (kind === 'gem') { put(big, 64, 64, 112); }
    else if (kind === 'gems') {
      for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + i * TAU / 7; put(gem, 64 + Math.cos(a) * 36, 64 + Math.sin(a) * 36, 40, a * 0.3); }
      put(big, 64, 64, 58);
    } else if (kind === 'skill') { drawScreen(x, 64, 70, 84, 62); }
    else if (kind === 'burst') {
      x.strokeStyle = 'rgba(255,230,140,.9)'; x.lineCap = 'round';
      for (let i = 0; i < 5; i++) { const y = 24 + i * 20; x.lineWidth = 5; x.beginPath(); x.moveTo(8, y + 8); x.lineTo(78, y); x.stroke(); put(big, 92, y, 46, Math.PI / 2); }
    }
    return c;
  }
  const SPR = {};
  function spr() {
    if (SPR.ready) return SPR;
    SPR.gem = SPR.gem || makeGem(false); SPR.gemBig = SPR.gemBig || makeGem(true);
    SPR.ready = true; return SPR;
  }
  const ICONS = { ng_gem: 'gem', ng_gems: 'gems', ng_skill: 'skill', ng_burst: 'burst' };
  G.proceduralIcons = G.proceduralIcons || {};
  try {
    for (const k in ICONS) { const c = makeIcon(ICONS[k]); G.assets.img['icon_' + k] = c; G.proceduralIcons[k] = c; }
  } catch (e) { console.warn('[ningguang] icons', e); }

  /* ============================ stats ============================ */
  const st = (R, k, d) => { const v = R.stats[k]; return v != null ? v : d; };
  function evo(R) { return !!R.evolved.evo_ng_normal; }
  function gemCount(R) { return Math.min(60, st(R, 'ngGems', 7) + 2 * (R.stats.extraProjectiles || 0) + (evo(R) ? 6 : 0)); }
  function gemMul(R) { return st(R, 'ngMul', 0.25) * (1 + (R.stats.normalDmg || 0)); }
  function volleyInterval(R) { const S = R.stats; return (S.normalInterval || 1.1) * (S.featherCd || 1) / Math.max(0.2, S.haste || 1); }
  function range(R) { return R.stats.range || 9; }

  /* ============================ pebble pool ============================ */
  const HN = 6;              // trail history points
  const POOL = [], ACT = [];
  function newGem() { return { x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 1, r: 0.3, mul: 0, mode: 0, target: null, pierce: 0, hits: [], hx: new Float32Array(HN), hy: new Float32Array(HN), hc: 0, size: 0.5, boost: 1, rot: 0, vr: 0, src: '', dead: false, wait: 0, ox: 0, oy: 0, fx: 0, fy: 0, sp: 0, tx: 0, ty: 0, blast: false, big: false }; }
  function takeGem() {
    const g = POOL.pop() || newGem();
    g.t = 0; g.target = null; g.pierce = 0; g.hits.length = 0; g.hc = 0; g.boost = 1; g.dead = false; g.wait = 0; g.blast = false; g.big = false;
    g.rot = U.rand(0, TAU); g.vr = U.rand(-9, 9);
    ACT.push(g); return g;
  }
  function freeAt(i) { const g = ACT[i]; ACT[i] = ACT[ACT.length - 1]; ACT.pop(); g.target = null; POOL.push(g); }
  function clearAll() { while (ACT.length) freeAt(ACT.length - 1); }

  /* ---- allocation-free nearest search ---- */
  const NQ = { x: 0, y: 0, bd: 0, best: null };
  function nearCb(e) { if (e.spawnT > 0.2) return; const d = (e.x - NQ.x) * (e.x - NQ.x) + (e.y - NQ.y) * (e.y - NQ.y); if (d < NQ.bd) { NQ.bd = d; NQ.best = e; } }
  function nearestTo(R, x, y, r) { NQ.x = x; NQ.y = y; NQ.bd = r * r; NQ.best = null; R.grid.query(x, y, r, nearCb); const b = NQ.best; NQ.best = null; return b; }
  const CAND = [];
  function candCb(e) { // score = distance², but already-hurt enemies are preferred (finish them off → kills feel snappy)
    if (e.spawnT > 0.2) return;
    const d2 = (e.x - NQ.x) * (e.x - NQ.x) + (e.y - NQ.y) * (e.y - NQ.y), f = e.maxHp > 0 ? e.hp / e.maxHp : 1;
    e._d2 = d2 + (f < 0.999 ? 0 : 400); CAND.push(e);
  }
  const byD2 = (a, b) => a._d2 - b._d2;

  /* ---- collision ---- */
  const HO = { mul: 1, element: 'geo', gauge: 0.4, src: 'ng_normal', knock: 0.3, kx: 0, ky: 0, critBonus: 0 };
  let CR = null, CG = null, lastSfx = 0, lastBig = 0;
  function gemCollide(e) {
    const g = CG;
    if (e.spawnT > 0.25) return;
    if (g.mode === 0 && !g.hits.length && g.target && !g.target.dead && e !== g.target && g.t < 1.2) return; // homing pebbles focus their own target
    const h = g.hits; for (let i = 0; i < h.length; i++) if (h[i] === e.id) return;
    h.push(e.id);
    const R = CR, sp = Math.hypot(g.vx, g.vy) || 1;
    HO.mul = g.mul * g.boost; HO.src = g.src; HO.kx = g.vx / sp; HO.ky = g.vy / sp;
    HO.gauge = g.mode === 1 ? 1 : 0.4; HO.knock = g.mode === 1 ? 1.2 : 0.3; HO.critBonus = g.mode === 1 ? 0.1 : 0;
    G.combat.hit(R, e, HO);
    if (g.mode === 1) { if (e === g.target) g.hitT = true; burstHit(R, g, e); }
    else {
      if (!reduced() || U.chance(0.3)) G.fx.hitSpark(e.x, e.y - 0.7, 'geo', g.boost > 1);
      if (g.big) evoShard(R, g, e);
      if (R.realTime - lastSfx > 0.05) { lastSfx = R.realTime; G.audio.sfx('arrowHit', { x: e.x, y: e.y, pitch: 1.7, vol: 0.45 }); }
    }
    if (g.pierce-- <= 0) { g.dead = true; return true; }
  }
  function evoShard(R, g, e) {
    G.combat.aoe(R, e.x, e.y, 1.15, { mul: g.mul * 0.45, element: 'geo', gauge: 0, src: 'evo_ng_normal', knock: 0.4, exclude: e, quiet: true });
    if (!reduced() && U.chance(0.5)) G.fx.burst(e.x, e.y - 0.5, 5, GO, { max: 5, life: 0.35, size: 0.1, grav: 12, up: 3 });
  }
  function burstHit(R, g, e) {
    if (R.realTime - lastBig > 0.035) {
      lastBig = R.realTime;
      G.fx.hitSpark(e.x, e.y - 0.7, 'geo', true);
      if (!reduced()) G.fx.burst(e.x, e.y - 0.4, 8, U.chance(0.5) ? GO : '#d9b27a', { max: 7, life: 0.45, size: 0.14, grav: 16, up: 4 });
      G.audio.sfx('rockImpact', { x: e.x, y: e.y, vol: 0.5, pitch: 1.2 });
    }
    if (g.blast) {
      G.combat.aoe(R, e.x, e.y, 1.5, { mul: g.mul * 0.3, element: 'geo', gauge: 0, src: 'ng_burst', knock: 0.8, exclude: e, quiet: true });
      if (G.fx.boom) G.fx.boom(e.x, e.y, 1.3, { color: GO, kind: 'geo' });
    }
  }

  /* ---- per-frame pebble update ---- */
  function steer(R, g, dt) {
    let t = g.target;
    if (!t || t.dead) { t = g.target = nearestTo(R, g.x, g.y, 11); if (!t && g.life > g.t + 0.35) g.life = g.t + 0.35; }
    const sp = Math.min(19, 5 + g.t * 34) * (R.stats.projSpeed || 1);
    if (t) {
      const dx = t.x - g.x, dy = t.y - g.y, d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(1, (2 + g.t * 17) * dt);
      g.vx += (dx / d * sp - g.vx) * k; g.vy += (dy / d * sp - g.vy) * k;
    }
  }
  function updateGems(R, dt) {
    CR = R;
    const B = R.barriers, hasB = !!(B && B.length);
    for (let i = ACT.length - 1; i >= 0; i--) {
      const g = ACT[i];
      g.t += dt; g.rot += g.vr * dt;
      if (g.mode === 1 && g.wait > 0) { // burst: gather in formation behind Ningguang, then launch
        g.wait -= dt;
        const p = R.player; g.x = U.lerp(g.x, p.x + g.ox, Math.min(1, dt * 14)); g.y = U.lerp(g.y, p.y + g.oy, Math.min(1, dt * 14));
        pushHist(g);
        if (g.wait <= 0) { g.t = 0; aimBurst(R, g); }
        else continue;
      }
      if (g.t >= g.life || g.dead) { endGem(R, g); freeAt(i); continue; }
      const x0 = g.x, y0 = g.y;
      if (g.mode === 0) steer(R, g, dt);
      else if (g.mode === 1) steerBurst(R, g, dt);
      if (g.mode === 2) { g.x += g.vx * dt; g.y += g.vy * dt; pushHist(g); continue; } // falling rain gem (no collision until it lands)
      const sp = Math.hypot(g.vx, g.vy), steps = Math.max(1, Math.ceil(sp * dt / 0.35));
      CG = g;
      for (let s = 0; s < steps && !g.dead; s++) { g.x += g.vx * dt / steps; g.y += g.vy * dt / steps; R.grid.query(g.x, g.y, g.r, gemCollide); }
      CG = null;
      if (hasB && g.boost === 1) {
        for (let k = 0; k < B.length; k++) if (G.barrier.alive(R, B[k]) && G.barrier.crosses(B[k], x0, y0, g.x, g.y)) {
          g.boost = 1.3; // 固有天賦「屏風の加護」
          if (!reduced()) G.fx.particle({ x: g.x, y: g.y - LIFT, vx: 0, vy: -1, life: 0.3, size: 0.35, color: GOL, glow: true });
          break;
        }
      }
      pushHist(g);
    }
  }
  function pushHist(g) {
    const hx = g.hx, hy = g.hy;
    for (let k = HN - 1; k > 0; k--) { hx[k] = hx[k - 1]; hy[k] = hy[k - 1]; }
    hx[0] = g.x; hy[0] = g.y; if (g.hc < HN) g.hc++;
  }
  function endGem(R, g) {
    if (g.mode === 2) { // rain gem lands
      G.combat.aoe(R, g.tx, g.ty, 1.6, { mul: g.mul, element: 'geo', gauge: 0.5, src: 'evo_ng_normal', knock: 1, critBonus: 0.1 });
      if (G.fx.boom) G.fx.boom(g.tx, g.ty, 1.5, { color: GO, kind: 'geo' }); else G.fx.hitSpark(g.tx, g.ty, 'geo', true);
      if (!reduced()) G.fx.burst(g.tx, g.ty - 0.2, 6, GO, { max: 6, life: 0.4, size: 0.12, grav: 14, up: 4 });
      if (U.chance(0.4)) G.audio.sfx('rockImpact', { x: g.tx, y: g.ty, vol: 0.45 });
    } else if (g.mode === 0 && !g.dead && g.t < g.life + 0.01 && !reduced()) {
      G.fx.particle({ x: g.x, y: g.y - LIFT, vx: 0, vy: 0.5, life: 0.2, size: 0.18, color: GO, glow: true });
    }
  }

  /* ---- drawing (one air-layer field draws every pebble) ---- */
  function drawGems(ctx) {
    const R = G.run; if (!R || R.charId !== 'ningguang' || !ACT.length) return;
    spr();
    const gl = glow(GO, 32);
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < ACT.length; i++) { // trails
      const g = ACT[i], n = g.hc; if (n < 2) continue;
      const lift = g.mode === 2 ? 0 : LIFT;
      ctx.strokeStyle = g.mode === 1 ? '#ffd86a' : g.boost > 1 ? '#fff0a8' : GO;
      ctx.lineWidth = g.size * (g.mode === 1 ? 0.55 : 0.4); ctx.globalAlpha = g.mode === 1 ? 0.7 : 0.45;
      ctx.beginPath(); ctx.moveTo(g.hx[0], g.hy[0] - lift);
      for (let k = 1; k < n; k++) ctx.lineTo(g.hx[k], g.hy[k] - lift);
      ctx.stroke();
      if (g.mode === 1) { ctx.globalAlpha = 0.9; ctx.strokeStyle = '#fffbe8'; ctx.lineWidth = g.size * 0.16; ctx.stroke(); }
    }
    for (let i = 0; i < ACT.length; i++) { // glows
      const g = ACT[i], s = g.size * (g.mode === 1 ? 2.2 : 1.7), y = g.y - (g.mode === 2 ? 0 : LIFT);
      ctx.globalAlpha = g.mode === 1 ? 0.8 : 0.55; ctx.drawImage(gl, g.x - s / 2, y - s / 2, s, s);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    for (let i = 0; i < ACT.length; i++) { // gems
      const g = ACT[i], s = g.size, y = g.y - (g.mode === 2 ? 0 : LIFT), im = g.mode === 0 && !g.big ? SPR.gem : SPR.gemBig;
      const c = Math.cos(g.rot) * s, sn = Math.sin(g.rot) * s;
      ctx.save(); ctx.transform(c, sn, -sn, c, g.x, y);
      ctx.drawImage(im, -0.5, -0.5, 1, 1);
      ctx.restore();
    }
  }
  function ensureField(R, Ws) {
    if (Ws.ngField && R.fields.indexOf(Ws.ngField) >= 0) return;
    Ws.ngField = W.field(R, { x: 0, y: 0, life: 1e9, ground: false,
      draw(ctx) { ctx.save(); drawGems(ctx); ctx.restore(); } });
  }

  /* ============================ NORMAL: 千金の石粒 ============================ */
  function startVolley(R, Ws) {
    const p = R.player;
    CAND.length = 0; NQ.x = p.x; NQ.y = p.y;
    R.grid.query(p.x, p.y, range(R), candCb);
    if (!CAND.length) return false;
    CAND.sort(byD2); if (CAND.length > 12) CAND.length = 12;
    Ws.ngQ = gemCount(R); Ws.ngQn = Ws.ngQ; Ws.ngEmit = 0; Ws.ngCi = 0; Ws.ngAcc = 0;
    Ws.ngT0 = CAND[0];
    const d = U.norm(CAND[0].x - p.x, CAND[0].y - p.y);
    G.player.pose(R, 'attack', 0.3, d);
    G.audio.sfx('geo', { x: p.x, y: p.y, vol: 0.45, pitch: 1.3 });
    if (evo(R) && W.evoFirst(R, 'evo_ng_normal')) { W.evoFanfare(R, p.x, p.y, GO, 6, 'evo_ng_normal'); Ws.ngRain = 0; }
    return true;
  }
  /** target for the next pebble: nearest enemies first, move on once the planned damage would already kill it */
  function nextTarget(R, Ws) {
    while (Ws.ngCi < CAND.length && CAND[Ws.ngCi].dead) { Ws.ngCi++; Ws.ngAcc = 0; }
    if (Ws.ngCi >= CAND.length) { Ws.ngCi = 0; Ws.ngAcc = 0; let k = 0; while (k < CAND.length && CAND[k].dead) k++; if (k >= CAND.length) return null; Ws.ngCi = k; }
    const e = CAND[Ws.ngCi];
    Ws.ngAcc += gemMul(R) * R.stats.atk;
    if (Ws.ngAcc >= e.hp * 1.15) { Ws.ngCi++; Ws.ngAcc = 0; }
    return e;
  }
  function emitGem(R, Ws) {
    const p = R.player, t = nextTarget(R, Ws), ev = evo(R);
    const g = takeGem();
    const a0 = t ? Math.atan2(t.y - p.y, t.x - p.x) : U.rand(0, TAU), a = a0 + U.rand(-2.0, 2.0), sp = U.rand(4.5, 8);
    g.mode = 0; g.target = t; g.x = p.x + Math.cos(a) * 0.35; g.y = p.y + Math.sin(a) * 0.25 - 0.1;
    g.vx = Math.cos(a) * sp; g.vy = Math.sin(a) * sp - 1.5;
    g.life = 2.2; g.r = ev ? 0.42 : 0.32; g.size = ev ? 0.62 : 0.44; g.big = ev;
    g.mul = gemMul(R); g.src = ev ? 'evo_ng_normal' : 'ng_normal'; g.pierce = ev ? 1 : 0;
    g.hx[0] = g.x; g.hy[0] = g.y; g.hc = 1;
  }
  function updateNormal(R, dt) {
    const Ws = R.wstate;
    if (Ws.ngT == null) { Ws.ngT = 0.5; Ws.ngQ = 0; Ws.ngRain = 3; }
    if (Ws.ngQ > 0) {
      Ws.ngEmit -= dt;
      const gap = Math.min(0.045, 0.32 / Math.max(1, Ws.ngQn));
      while (Ws.ngQ > 0 && Ws.ngEmit <= 0) { Ws.ngEmit += gap; Ws.ngQ--; emitGem(R, Ws); }
    }
    Ws.ngT -= dt;
    if (Ws.ngT <= 0) Ws.ngT = startVolley(R, Ws) ? volleyInterval(R) : 0.1;
    if (evo(R)) {
      Ws.ngRain -= dt;
      if (Ws.ngRain <= 0) { Ws.ngRain = 5 / Math.max(0.5, Math.sqrt(R.stats.haste || 1)); gemRain(R); }
    }
  }
  /* ---- evolution: 宝石の雨 ---- */
  function gemRain(R) {
    const p = R.player, he = G.render.halfExtents(), n = reduced() ? 8 : 12, mul = gemMul(R) * 3;
    CAND.length = 0; NQ.x = p.x; NQ.y = p.y; R.grid.query(p.x, p.y, Math.max(he.x, he.y), candCb);
    for (let i = 0; i < n; i++) {
      let tx, ty;
      if (CAND.length) { const e = CAND[(U.rnd() * CAND.length) | 0]; tx = e.x + U.rand(-0.3, 0.3); ty = e.y + U.rand(-0.3, 0.3); }
      else { tx = p.x + U.rand(-he.x, he.x) * 0.8; ty = p.y + U.rand(-he.y, he.y) * 0.8; }
      const g = takeGem(), T = 0.3 + i * 0.035, ox = -2.2, oy = -9;
      g.mode = 2; g.tx = tx; g.ty = ty; g.x = tx + ox; g.y = ty + oy; g.vx = -ox / T; g.vy = -oy / T; g.life = T;
      g.size = 0.95; g.mul = mul; g.big = true; g.hx[0] = g.x; g.hy[0] = g.y; g.hc = 1; g.vr = 4;
    }
    CAND.length = 0;
    G.audio.sfx('burstRain', { x: p.x, y: p.y, vol: 0.6, pitch: 1.3 });
  }

  /* ============================ SKILL: 璇璣屏 ============================ */
  const SKILL_CD = 12, WALL_LIFE = 10;
  function skillCdBase(R) { return SKILL_CD * Math.max(0.4, 1 - (R.stats.cdr || 0)); }
  function skillMul(R) { return st(R, 'ngSkillMul', 2.3); }
  let lastBlockSfx = 0;
  function onBlock(R, b, h) {
    const z = h.z || 0;
    G.fx.hitSpark(h.x, h.y - 0.8 - z, 'geo', false);
    if (!reduced()) G.fx.burst(h.x, h.y - 0.8 - z, 5, GOL, { max: 5, life: 0.3, size: 0.1 });
    if (R.realTime - lastBlockSfx > 0.12) { lastBlockSfx = R.realTime; G.audio.sfx('rockImpact', { x: h.x, y: h.y, vol: 0.4, pitch: 1.5 }); }
  }
  function onPass(R, b, e) {
    if (reduced() || !U.chance(0.2)) return;
    G.fx.particle({ x: e.x + U.rand(-0.4, 0.4), y: e.y - U.rand(0.2, 1.6), vx: U.rand(-0.6, 0.6), vy: -1.2, life: 0.45, size: 0.14, color: GO, glow: true });
  }
  /** shortest distance from a point to wall b's centre line */
  function segDist(b, x, y) { const dx = x - b.x, dy = y - b.y, a = U.clamp(dx * b.ux + dy * b.uy, -b.half, b.half); return Math.hypot(dx - a * b.ux, dy - a * b.uy); }
  function shatter(R, b) {
    if (b.broke) return; b.broke = true; b.dead = true; b.endT = R.time;
    G.audio.sfx('rockImpact', { x: b.x, y: b.y, vol: 0.7, pitch: 0.9 });
    if (!reduced()) for (let i = 0; i < 26; i++) {
      const a = U.rand(-b.half, b.half), h = U.rand(0.2, 3.2);
      G.fx.particle({ x: b.x + b.ux * a, y: b.y + b.uy * a - h, vx: U.rand(-2.5, 2.5), vy: U.rand(-4, -1), life: U.rand(0.45, 0.8), size: U.rand(0.1, 0.22), color: U.chance(0.6) ? GO : '#e8d6a8', glow: U.chance(0.6), grav: 14, drag: 1 });
    }
    G.fx.sparkle && G.fx.sparkle(b.x, b.y - 1.4, GOL, 10, b.half);
  }
  function castSkill(R) {
    const Ws = R.wstate, p = R.player, S = R.stats;
    const fx = p.face.x, fy = p.face.y, L = st(R, 'ngWall', 5.6) * Math.sqrt(S.areaMul || 1);
    let ux = -fy, uy = fx; if (ux < -1e-3 || (Math.abs(ux) <= 1e-3 && uy < 0)) { ux = -ux; uy = -uy; }
    if (Ws.ngWallB && !Ws.ngWallB.broke) shatter(R, Ws.ngWallB); // one screen at a time (like in Genshin)
    const b = G.barrier.add(R, { x: p.x + fx * 2.3, y: p.y + fy * 2.3, ux, uy, half: L / 2, th: 0.34, until: R.time + WALL_LIFE, slow: 0.35,
      onBlock, onPass, t0: R.time, broke: false, endT: 0 });
    Ws.ngWallB = b;
    G.player.pose(R, 'skill', 0.45, p.face);
    // rising blast around the screen
    const n = G.combat.aoe(R, b.x, b.y, b.half + 2.2, { mul: skillMul(R), element: 'geo', gauge: 1, src: 'ng_skill', knock: 1.4, filter: e => segDist(b, e.x, e.y) <= 2.2 + e.r });
    if (n > 0) spawnParticles(R, b.x, b.y, 3, 2.5);
    G.fx.shake(0.4); G.fx.ring && G.fx.ring(b.x, b.y, b.half + 0.6, GO);
    if (!reduced()) for (let i = 0; i < 16; i++) { const a = U.rand(-b.half, b.half); G.fx.particle({ x: b.x + ux * a, y: b.y + uy * a, vx: U.rand(-1, 1), vy: U.rand(-5, -2), life: U.rand(0.35, 0.6), size: U.rand(0.1, 0.18), color: U.chance(0.5) ? GO : '#d8b27a', glow: true, grav: 10 }); }
    G.audio.sfx('geo', { x: b.x, y: b.y }); G.audio.sfx('skill', { x: p.x, y: p.y, vol: 0.6 });
    R.props.push({ x: b.x, y: b.y, b, update: wallUpdate, draw: wallDraw });
  }
  function spawnParticles(R, x, y, n, value) {
    for (let i = 0; i < n; i++) {
      const a = U.rand(0, TAU), s = U.rand(3, 6);
      G.loot.add(R, { type: 'energy', x: x + Math.cos(a) * 0.3, y: y + Math.sin(a) * 0.3, value, el: 'geo', vx: Math.cos(a) * s, vy: Math.sin(a) * s, vz: U.rand(5, 8), magnet: true, sp: -7 - i * 1.5 });
    }
  }
  function wallUpdate(R, dt, o) {
    const b = o.b;
    if (!b.broke && R.time >= b.until) shatter(R, b);
    if (b.broke && R.time - b.endT > 0.4) return false;
  }
  /* drawn as a golden FOLDING screen (屏風): k panels zig-zagging along the wall line, each panel textured with one
     vertical slice of the skillfx_ningguang frame. The zig-zag gives the panels visible faces whatever the wall angle. */
  const ZP = new Float32Array(2 * 12);
  function wallDraw(ctx, o) {
    const R = G.run, b = o.b, im = G.assets.img.skillfx_ningguang; if (!R) return;
    const age = R.time - b.t0, L = b.half * 2, k = Math.max(3, Math.min(10, Math.round(L / 1.45)));
    const nx = -b.uy, ny = b.ux, z = 0.3 + 0.5 * Math.abs(b.uy); // steep walls fold deeper so their faces stay visible
    let fr = 6, alpha = 1, rise = U.ease.outCubic(Math.min(1, age / 0.42));
    if (b.broke) { const q = Math.min(1, (R.time - b.endT) / 0.4); fr = 7; alpha = 1 - q; rise = 1 - q * 0.35; }
    else fr = 5 + (Math.floor(age * 2) & 1);
    const left = b.until - R.time, blink = !b.broke && left < 1.5 ? 0.7 + 0.3 * Math.cos(left * 14) : 1;
    const H = 2.9 * Math.min(1.25, L / 5.6) * rise;
    for (let i = 0; i <= k; i++) { const a = -b.half + i * L / k, zz = (i & 1) ? z : -z; ZP[i * 2] = b.x + b.ux * a + nx * zz; ZP[i * 2 + 1] = b.y + b.uy * a + ny * zz; }
    // ground: soft shadow + thin golden line along the folds
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.globalAlpha = 0.3 * alpha; ctx.strokeStyle = '#3a2500'; ctx.lineWidth = 0.55;
    ctx.beginPath(); ctx.moveTo(ZP[0], ZP[1]); for (let i = 1; i <= k; i++) ctx.lineTo(ZP[i * 2], ZP[i * 2 + 1]); ctx.stroke();
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.5 * alpha; ctx.strokeStyle = GO; ctx.lineWidth = 0.09; ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    if (H < 0.05) return;
    const cw = im ? im.width / 4 : 256, ch = im ? im.height / 2 : 256, sc = cw / 256;
    const sx0 = (fr % 4) * cw + 35 * sc, sy0 = (fr >> 2) * ch + 48 * sc, sw = 187 * sc, sh = 140 * sc;
    const hit = Math.max(0, 1 - (R.time - b.hitT) / 0.25), pass = Math.max(0, 1 - (R.time - (b.passT || -9)) / 0.3);
    const shine = (b.broke ? 0 : 0.14 + 0.08 * Math.sin(age * 4)) + hit * 0.6 + pass * 0.3;
    const up = b.uy >= 0;
    for (let n = 0; n < k; n++) {
      const j = up ? n : k - 1 - n;
      const ax = ZP[j * 2], ay = ZP[j * 2 + 1], bx = ZP[j * 2 + 2], by = ZP[j * 2 + 3];
      ctx.save();
      ctx.transform(bx - ax, by - ay, 0, H, ax, ay - H);
      ctx.globalAlpha = alpha * blink;
      if (im) ctx.drawImage(im, sx0 + j * sw / k, sy0, sw / k, sh, 0, 0, 1, 1);
      else { ctx.fillStyle = GOL; ctx.fillRect(0, 0, 1, 1); }
      if (j & 1) { ctx.globalAlpha = 0.22 * alpha; ctx.fillStyle = '#5a3a00'; ctx.fillRect(0, 0.08, 1, 0.8); } // the fold facing away is a bit darker
      if (shine > 0.01) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(1, shine) * alpha; ctx.drawImage(glow(GOL, 32), -0.1, 0.05, 1.2, 0.9); ctx.globalCompositeOperation = 'source-over'; }
      ctx.restore();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }

  /* ============================ BURST: 天権崩玉 ============================ */
  function castBurst(R) {
    const p = R.player, S = R.stats, lv = st(R, 'ngBurstLv', 0);
    const volleys = 1 + (lv >= 2 ? 1 : 0) + (lv >= 4 ? 1 : 0), sizeK = 1 + 0.18 * ((lv >= 1 ? 1 : 0) + (lv >= 3 ? 1 : 0));
    const n = gemCount(R), mul = gemMul(R) * 10 * (1 + (S.burstBonus || 0));
    spr();
    G.player.pose(R, 'burst', 0.6, p.face);
    G.fx.zoomPunch && G.fx.zoomPunch(0.08); G.fx.flash && G.fx.flash(GOL, 0.35);
    G.fx.pillar && G.fx.pillar(p.x, p.y, GO, 11, 2, 0.9);
    G.fx.rays && G.fx.rays(p.x, p.y - 1, 5, GOL, 1);
    G.fx.ring && G.fx.ring(p.x, p.y, 4, GO);
    G.fx.sparkle && G.fx.sparkle(p.x, p.y - 1.2, GOL, 18, 1.8);
    G.bus.emit('notice', { text: '天権崩玉！', color: GOL });
    G.audio.sfx('geo', { x: p.x, y: p.y });
    for (let v = 0; v < volleys; v++) {
      if (v === 0) burstVolley(R, n, mul, sizeK, lv >= 5, 0.14);
      else W.field(R, { x: 0, y: 0, life: v * 0.55, ground: true, onEnd: R2 => burstVolley(R2, n, mul, sizeK, lv >= 5, 0.1) });
    }
  }
  /* Burst targeting (owner 2026-09-28): every pebble homes in at once.
     1) any on-screen enemy inside the facing cone (±60°) → those win, regardless of distance (nearest first)
     2) otherwise → the on-screen enemies closest to the facing direction (can be straight behind)
     3) no enemy on screen → fly straight ahead. */
  const BT = [];
  function facingTargets(R, out) {
    out.length = 0;
    const p = R.player, fx = p.face.x, fy = p.face.y, ex = G.render.halfExtents(), E = R.enemies;
    let cone = 0;
    for (let i = 0; i < E.length; i++) {
      const e = E[i]; if (e.dead || e.spawnT > 0.2) continue;
      const dx = e.x - p.x, dy = e.y - p.y;
      if (Math.abs(dx) > ex.x + 0.5 || Math.abs(dy) > ex.y + 0.5) continue; // on screen only
      const d = Math.sqrt(dx * dx + dy * dy) || 0.001, dot = (dx * fx + dy * fy) / d;
      e._bd = d; e._dot = dot; if (dot >= 0.5) cone++;
      out.push(e);
    }
    if (cone) { let k = 0; for (let i = 0; i < out.length; i++) if (out[i]._dot >= 0.5) out[k++] = out[i]; out.length = k; out.sort((a, b) => a._bd - b._bd); }
    else out.sort((a, b) => (b._dot - a._dot) || (a._bd - b._bd));
    return out;
  }
  function aimBurst(R, g) {
    const t = g.target; let dx = g.fx, dy = g.fy;
    if (t && !t.dead) { const ax = t.x - g.x, ay = t.y - g.y, l = Math.hypot(ax, ay) || 1; dx = dx * 0.35 + ax / l * 0.65; dy = dy * 0.35 + ay / l * 0.65; }
    const l = Math.hypot(dx, dy) || 1; g.vx = dx / l * g.sp; g.vy = dy / l * g.sp;
  }
  function steerBurst(R, g, dt) {
    if (g.hitT) return; // struck its target → keeps flying straight (piercing)
    let t = g.target;
    if (!t || t.dead) { facingTargets(R, BT); t = g.target = BT.length ? BT[(g.idx || 0) % BT.length] : null; BT.length = 0; if (!t) { g.hitT = true; return; } }
    const dx = t.x - g.x, dy = t.y - g.y, d = Math.sqrt(dx * dx + dy * dy) || 1, k = Math.min(1, (9 + g.t * 30) * dt);
    g.vx += (dx / d * g.sp - g.vx) * k; g.vy += (dy / d * g.sp - g.vy) * k;
  }
  function burstVolley(R, n, mul, sizeK, blast, gather) {
    const p = R.player, fx = p.face.x, fy = p.face.y, nx = -fy, ny = fx, sp = 25 * (R.stats.projSpeed || 1);
    facingTargets(R, BT);
    for (let i = 0; i < n; i++) {
      const g = takeGem(), lat = (n > 1 ? i / (n - 1) - 0.5 : 0) * Math.min(2.2, 0.5 + n * 0.07);
      g.mode = 1; g.wait = gather + U.rand(0, 0.04); g.idx = i; g.hitT = false;
      g.ox = nx * lat + fx * 0.6; g.oy = ny * lat + fy * 0.6;          // brief glint in front of her, then all fire at once
      g.x = p.x + U.rand(-0.2, 0.2); g.y = p.y + U.rand(-0.2, 0.2);
      g.target = BT.length ? BT[i % BT.length] : null;
      g.fx = fx; g.fy = fy; g.sp = sp * U.rand(0.96, 1.04);
      g.vx = 0; g.vy = 0; g.life = 1.3; g.r = 0.8 * sizeK; g.size = 1.15 * sizeK; g.big = true; g.blast = blast;
      g.mul = mul; g.src = 'ng_burst'; g.pierce = 9999; g.vr = U.rand(-4, 4);
      g.hx[0] = g.x; g.hy[0] = g.y; g.hc = 1;
    }
    BT.length = 0;
    // the moment they fly: kick + sound
    W.field(R, { x: 0, y: 0, life: gather + 0.02, ground: true, onEnd(R2) {
      const q = R2.player; G.fx.shake(0.6); G.fx.kick && G.fx.kick(q.face.x, q.face.y, 6);
      G.fx.ring && G.fx.ring(q.x + q.face.x * 1.2, q.y + q.face.y * 1.2, 2.2, GOL);
      G.audio.sfx('windBlast', { x: q.x, y: q.y, vol: 0.7, pitch: 1.3 }); G.audio.sfx('rockThrow', { x: q.x, y: q.y, vol: 0.8 });
    } });
  }

  G.bus.on('runStart', () => { clearAll(); });

  /* ============================ KIT ============================ */
  G.weapons.kits.ningguang = {
    update(R, dt) {
      ensureField(R, R.wstate);
      G.barrier.prune(R);
      updateNormal(R, dt);
      updateGems(R, dt);
    },
    skill(R) { castSkill(R); },
    skillCd(R) { return skillCdBase(R); },
    burst(R) { castBurst(R); },
  };
  G.ningguang = { gemCount, gemMul, volleyInterval, active: () => ACT.length, pool: () => POOL.length, list: () => ACT };
})();
