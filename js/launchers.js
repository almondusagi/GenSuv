/* launchers.js — the six Timaeus launchers (owner: COMBAT). Spec §13–19.
   G.weapons.launchers[key] = { update(R, dt, lv) }  (lv 1..5; called only while owned)
   pyro 人形爆弾 · hydro 水入り瓶 · cryo 雪降らし · electro 連鎖雷 · anemo かぜおこし · geo 創造力
   Evolutions (R.evolved): evo_launcher_pyro ボンボン大爆撃, _hydro 大渦潮, _cryo 永久凍土の吹雪,
   _electro 雷雲の審判, _anemo 風神の大竜巻, _geo 岩王の城壁.
   Stats read: haste, cdr (cooldown), explosionMul (pyro bomb), areaMul, durationMul, shieldMul, maxHp. */
'use strict';
(function () {
  const U = G.u, W = G.weapons, L = W.launchers;
  const reduced = () => !!(G.save && G.save.data.settings.reducedFx);
  const glow = (c, s) => G.assets.glow(c, s);
  const BOMB_BASE_R = 2.4;

  /* ---------- shared helpers ---------- */
  function ready(R, key, dt) {
    const k = 'L_' + key, S = R.wstate;
    if (S[k] == null) S[k] = 0.8; // first shot shortly after pick-up
    S[k] -= dt; return S[k] <= 0;
  }
  function setCd(R, key, v) { R.wstate['L_' + key] = v; }
  function later(R, delay, fn) { W.field(R, { x: 0, y: 0, life: delay, onEnd: fn }); }
  /** element sfx on launcher hits: positional, throttled per element */
  const lastEl = {};
  function elSfx(R, el, x, y, vol) { const t = R.realTime; if (lastEl[el] && t - lastEl[el] < 0.22 && lastEl[el] <= t) return; lastEl[el] = t; G.audio.sfx(el, { x, y, vol: vol || 0.7 }); }
  function viewRect() { const he = G.render.halfExtents(), c = G.view.cam; return { x0: c.x - he.x, y0: c.y - he.y, w: he.x * 2, h: he.y * 2 }; }

  /** expanding ground shock ring (cosmetic) */
  function wave(R, x, y, r, color, life, width) {
    W.field(R, { x, y, r, life: life || 0.45, minor: true, ground: true,
      draw(ctx, f) {
        const k = f.t / f.life, e = U.ease.outCubic(k);
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.22 * (1 - k); ctx.fillStyle = color;
        ctx.beginPath(); ctx.arc(x, y, r * e, 0, U.TAU); ctx.fill();
        ctx.globalAlpha = 0.9 * (1 - k); ctx.strokeStyle = color; ctx.lineWidth = (width || 0.3) * (1 - k * 0.7);
        ctx.beginPath(); ctx.arc(x, y, r * e, 0, U.TAU); ctx.stroke();
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      } });
  }

  /** jagged lightning bolt (cosmetic), flickers while alive */
  function bolt(R, x1, y1, x2, y2, o) {
    o = o || {};
    const segs = o.segs || 9, jit = o.jitter || 0.4;
    const pts = new Float32Array((segs + 1) * 2);
    function gen() {
      const nx = -(y2 - y1), ny = x2 - x1, l = Math.hypot(nx, ny) || 1;
      for (let i = 0; i <= segs; i++) {
        const f = i / segs, j = (i === 0 || i === segs) ? 0 : U.rand(-jit, jit) * (1 - Math.abs(f - 0.5));
        pts[i * 2] = U.lerp(x1, x2, f) + nx / l * j * 2; pts[i * 2 + 1] = U.lerp(y1, y2, f) + ny / l * j * 2;
      }
    }
    gen();
    let nextGen = 0.05;
    W.field(R, { x: x2, y: y2, life: o.life || 0.24, ground: false, minor: true,
      update(R2, dt, f) { if (f.t > nextGen) { nextGen += 0.05; gen(); } },
      draw(ctx, f) {
        const k = f.t / f.life, a = 1 - k * k;
        ctx.globalCompositeOperation = 'lighter';
        const path = () => { ctx.beginPath(); ctx.moveTo(pts[0], pts[1]); for (let i = 1; i <= segs; i++) ctx.lineTo(pts[i * 2], pts[i * 2 + 1]); };
        ctx.lineJoin = 'round'; ctx.lineCap = 'round';
        path();
        ctx.globalAlpha = 0.35 * a; ctx.strokeStyle = o.color || '#c77dff'; ctx.lineWidth = (o.width || 1) * 0.42; ctx.stroke();
        ctx.globalAlpha = 0.9 * a; ctx.strokeStyle = '#e6c8ff'; ctx.lineWidth = (o.width || 1) * 0.15; ctx.stroke();
        ctx.globalAlpha = a; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = (o.width || 1) * 0.055; ctx.stroke();
        ctx.globalAlpha = 0.8 * a; const g = 1.6 * (o.width || 1);
        ctx.drawImage(glow('#c77dff', 64), x2 - g, y2 - g, g * 2, g * 2);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt';
      } });
  }

  /* ============================ PYRO 人形爆弾 ============================ */
  function pyroMul(lv) { return 5 + 1.6 * (lv - 1); }
  function plantBomb(R, x, y, o) {
    const fuse = o.fuse || 0.65;
    R.props.push({ x, y, t: 0, bounce: 1,
      update(R2, dt, b) {
        b.t += dt; b.bounce = Math.max(0, b.bounce - dt * 4);
        if (!reduced() && U.chance(0.45)) G.fx.particle({ x: b.x + 0.2 * o.scale, y: b.y - 1.05 * o.scale, vx: U.rand(-1.2, 1.2), vy: U.rand(-2.5, -0.8), life: 0.25, size: 0.07, color: '#ffe08a', glow: true, grav: 5 });
        if (b.t >= fuse) { explodeBomb(R2, b.x, b.y, o); return false; }
      },
      draw(ctx, b) {
        const k = b.t / fuse, r = BOMB_BASE_R * G.run.stats.explosionMul * o.scale;
        // telegraph: danger ring grows with the fuse
        ctx.globalAlpha = 0.25 + 0.35 * k; ctx.strokeStyle = '#ff5a3a'; ctx.lineWidth = 0.07;
        ctx.setLineDash([0.5, 0.35]); ctx.beginPath(); ctx.arc(b.x, b.y, r * (0.4 + 0.6 * k), 0, U.TAU); ctx.stroke(); ctx.setLineDash([]);
        ctx.globalAlpha = 0.08 + 0.1 * k; ctx.fillStyle = '#ff5a3a'; ctx.fill(); ctx.globalAlpha = 1;
        G.render.shadow(ctx, b.x, b.y, 0.5 * o.scale, 0.3);
        const hop = Math.sin(b.bounce * Math.PI) * 0.35, s = 1.15 * o.scale * (1 + 0.08 * Math.sin(b.t * (12 + k * 40)));
        G.render.icon(ctx, 'bomb', b.x, b.y - 0.5 * o.scale - hop, s);
        const blink = Math.sin(b.t * (10 + k * 45)) > 0.2;
        if (blink) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.35 + 0.5 * k; ctx.drawImage(glow('#ff3a1a', 64), b.x - s, b.y - 0.5 * o.scale - hop - s, s * 2, s * 2); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
      } });
  }
  function explodeBomb(R, x, y, o) {
    const r = BOMB_BASE_R * R.stats.explosionMul * o.scale;
    G.fx.explosion(x, y, r, { color: '#ff7a3d', kind: o.scale < 1 ? 'small' : 'big' });
    W.boom(R, x, y, r * 0.55, { color: '#ffb347', life: 0.5 });
    if (o.scale >= 1) { G.fx.shake(0.7); G.audio.sfx('bigExplosion', { x, y }); } else if (!o.mini || U.chance(0.4)) G.audio.sfx('explosion', { x, y, vol: 0.6 });
    elSfx(R, 'pyro', x, y, 0.5);
    G.combat.aoe(R, x, y, r, { mul: o.mul, element: 'pyro', gauge: 1, src: o.src || 'launcher_pyro', knock: 2.2 * o.scale });
    if (!reduced()) for (let i = 0; i < 12; i++) { const a = U.rand(0, U.TAU), s = U.rand(2, 7); G.fx.particle({ x, y: y - 0.4, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 - 3, life: U.rand(0.5, 0.9), size: U.rand(0.1, 0.2), color: '#ffcf7a', glow: true, grav: 9, drag: 1.5 }); }
    if (o.split) {
      // ボンボン大爆撃: the doll bursts into a ring of cluster bombs that carpet the area (the first one after evolving: a double ring)
      // children home in on survivors around the blast (outside the main radius first), else they carpet a ring
      const n = o.fanfare ? 12 : 6, tg = W.nearestN(R, x, y, r * 2.6, 24);
      let ti = tg.length - 1;
      for (let k = 0; k < n; k++) {
        const ring = k < 6 ? 0 : 1;
        let tx, ty;
        while (ti >= 0 && tg[ti].dead) ti--;
        if (ti >= 0 && k % 2 === 0) { const t = tg[ti]; ti -= 2; tx = t.x + U.rand(-0.3, 0.3); ty = t.y + U.rand(-0.3, 0.3); }
        else { const a = (k % 6) / 6 * U.TAU + ring * 0.52 + U.rand(-0.15, 0.15), d = r * (ring ? 1.5 : 0.95) * U.rand(0.85, 1.1); tx = x + Math.cos(a) * d; ty = y + Math.sin(a) * d; }
        throwBomb(R, x, y, tx, ty, { mul: o.mul * 0.7, scale: 0.7, fuse: 0.16 + k * 0.03, time: 0.38 + ring * 0.12, src: 'evo_launcher_pyro', mini: true });
      }
      G.fx.shake(0.5);
    }
  }
  function throwBomb(R, x, y, tx, ty, o) {
    W.lob(R, { x, y, tx, ty, time: o.time || 0.55, height: o.scale < 1 ? 1.8 : 3.2, sprite: 'bomb', size: 1.05 * o.scale, spin: 8, glow: '#ff7a3d', smoke: '#ffb347',
      onLand(R2, lo, lx, ly) { plantBomb(R2, lx, ly, o); } });
  }
  L.launcher_pyro = {
    update(R, dt, lv) {
      if (!ready(R, 'pyro', dt)) return;
      const p = R.player, evo = !!R.evolved.evo_launcher_pyro, used = [];
      const count = (lv >= 4 ? 2 : 1) + (evo ? 1 : 0);
      let fan = false;
      for (let i = 0; i < count; i++) {
        const t = W.cluster(R, p.x, p.y, 12, 2.6, used); if (!t) break; used.push(t);
        let fanNow = false;
        if (evo && !fan && W.evoFirst(R, 'evo_launcher_pyro')) { fan = fanNow = true; W.evoFanfare(R, t.x, t.y, '#ff7a3d', 6, 'evo_launcher_pyro'); }
        throwBomb(R, p.x, p.y - 0.2, t.x + U.rand(-0.3, 0.3), t.y + U.rand(-0.3, 0.3), { mul: pyroMul(lv) * (evo ? 1.2 : 1), scale: evo ? 1.2 : 1, split: evo, fanfare: fanNow, src: evo ? 'evo_launcher_pyro' : 'launcher_pyro' });
      }
      setCd(R, 'pyro', used.length ? W.launcherCd(R, evo ? 8 : 10) : 0.3);
      if (used.length) G.audio.sfx('pyro', { x: p.x, y: p.y, vol: 0.5 });
    },
  };

  /* ============================ HYDRO 水入り瓶 ============================ */
  let puddleImg = null;
  function puddleCanvas() {
    if (puddleImg) return puddleImg;
    const c = G.assets.makeCanvas(256, 256), x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 10, 128, 128, 128);
    g.addColorStop(0, 'rgba(70,170,255,0.30)'); g.addColorStop(0.7, 'rgba(40,130,240,0.42)');
    g.addColorStop(0.9, 'rgba(150,215,255,0.62)'); g.addColorStop(0.97, 'rgba(220,245,255,0.55)'); g.addColorStop(1, 'rgba(220,245,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    puddleImg = c; return c;
  }
  function spawnPuddle(R, x, y, lv) {
    const S = R.stats, evo = !!R.evolved.evo_launcher_hydro;
    const r = (3.2 + 0.3 * (lv - 1)) * (S.areaMul || 1) * (evo ? 1.3 : 1);
    const life = (5.3 + 0.4 * (lv - 1)) * (S.durationMul || 1) + (evo ? 2.5 : 0);
    const mul = 1.0 + 0.3 * (lv - 1);
    // shatter
    G.audio.sfx('hydro', { x, y });
    G.fx.ring && G.fx.ring(x, y, r, '#9fd6ff');
    wave(R, x, y, r, '#3fa9ff', 0.4, 0.25);
    const n = reduced() ? 8 : 22;
    for (let i = 0; i < n; i++) { const a = U.rand(0, U.TAU), s = U.rand(2, 7); G.fx.particle({ x, y: y - 0.3, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.6 - U.rand(2, 5), life: U.rand(0.4, 0.8), size: U.rand(0.07, 0.16), color: i % 4 === 0 ? '#ffffff' : '#7cc4ff', glow: true, grav: 12, drag: 1.2 }); }
    G.combat.aoe(R, x, y, r * 0.8, { mul: mul * 2.4, element: 'hydro', gauge: 1, src: 'launcher_hydro', knock: 0.9 });
    const drops = [];
    for (let i = 0; i < 6; i++) drops.push({ a: U.rand(0, U.TAU), d: U.rand(0.1, 0.85), ph: U.rand(0, 3) });
    W.field(R, { x, y, r, life, tick: evo ? 0.45 : 0.7, next: 0.45, evo, drops, retarget: 0,
      update(R2, dt, f) {
        if (!f.evo) return;
        // 大渦潮: moving whirlpool that pulls enemies in
        f.retarget -= dt;
        if (f.retarget <= 0) { f.retarget = 0.8; const t = W.cluster(R2, f.x, f.y, 10, 2.5); f.tx = t ? t.x : f.x; f.ty = t ? t.y : f.y; }
        const d = U.dist(f.x, f.y, f.tx, f.ty); if (d > 0.3) { f.x += (f.tx - f.x) / d * 2.2 * dt; f.y += (f.ty - f.y) / d * 2.2 * dt; }
        const pr = f.r * 1.25;
        R2.grid.query(f.x, f.y, pr, e => {
          if (e.boss) return; const dx = f.x - e.x, dy = f.y - e.y, l = Math.hypot(dx, dy); if (l < 0.3) return;
          const s = (e.elite ? 0.35 : 1) * 3.2 * dt; e.x += dx / l * s + (-dy / l) * s * 0.6; e.y += dy / l * s + (dx / l) * s * 0.6;
        });
      },
      onEnd(R2, f) {
        if (!f.evo) return;
        // 大渦潮 finale: the whirlpool collapses into a towering water burst
        G.fx.explosion && G.fx.explosion(f.x, f.y, f.r * 1.1, { color: '#3fa9ff', kind: 'hydro' });
        wave(R2, f.x, f.y, f.r * 1.4, '#7cc4ff', 0.5, 0.35);
        G.fx.pillar && G.fx.pillar(f.x, f.y, '#7cc4ff', 8, f.r * 0.6, 0.7);
        G.combat.aoe(R2, f.x, f.y, f.r * 1.3, { mul: mul * 5, element: 'hydro', gauge: 2, src: 'evo_launcher_hydro', knock: 2.4 });
        G.audio.sfx('hydro', { x: f.x, y: f.y }); G.fx.shake(0.5);
      },
      onTick(R2, f) {
        elSfx(R2, 'hydro', f.x, f.y, 0.35);
        G.combat.aoe(R2, f.x, f.y, f.r, { mul, element: 'hydro', gauge: 1, src: f.evo ? 'evo_launcher_hydro' : 'launcher_hydro', knock: 0, each: e => { e.slowUntil = R2.time + 0.8; } });
        if (!reduced()) for (let i = 0; i < 4; i++) { const a = U.rand(0, U.TAU), d = U.rand(0, f.r); G.fx.particle({ x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d, vx: 0, vy: -U.rand(1, 2.5), life: 0.4, size: 0.1, color: '#bfe6ff', glow: true, grav: 6 }); }
      },
      draw(ctx, f) {
        const a = Math.min(1, f.t / 0.25, (f.life - f.t) / 1.2), t = f.t, r = f.r * (0.75 + 0.25 * Math.min(1, f.t / 0.25));
        ctx.globalAlpha = a; ctx.drawImage(puddleCanvas(), f.x - r, f.y - r, r * 2, r * 2);
        // ripples
        ctx.strokeStyle = '#d8f1ff'; ctx.lineWidth = 0.06;
        for (let i = 0; i < 3; i++) {
          const k = ((t * 0.55 + i / 3) % 1);
          ctx.globalAlpha = a * 0.5 * (1 - k); ctx.beginPath(); ctx.arc(f.x, f.y, r * (0.15 + 0.8 * k), 0, U.TAU); ctx.stroke();
        }
        for (const d of f.drops) { // little drip ripples
          const k = ((t * 0.9 + d.ph) % 1.3) / 1.3, px = f.x + Math.cos(d.a) * d.d * r, py = f.y + Math.sin(d.a) * d.d * r;
          ctx.globalAlpha = a * 0.6 * (1 - k); ctx.beginPath(); ctx.arc(px, py, 0.1 + k * 0.6, 0, U.TAU); ctx.stroke();
        }
        if (f.evo) { // whirlpool spiral
          ctx.globalCompositeOperation = 'lighter'; ctx.strokeStyle = '#9fd6ff'; ctx.lineWidth = 0.12;
          for (let k = 0; k < 4; k++) {
            ctx.globalAlpha = a * 0.55; ctx.beginPath();
            for (let s = 0; s <= 16; s++) { const u = s / 16, th = -t * 3.5 + k * U.TAU / 4 + u * 3.2, rr = r * (1 - u) * 0.95; const px = f.x + Math.cos(th) * rr, py = f.y + Math.sin(th) * rr; s ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
            ctx.stroke();
          }
          ctx.globalCompositeOperation = 'source-over';
        }
        // sparkle highlights
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = a * (0.35 + 0.2 * Math.sin(t * 4));
        ctx.drawImage(glow('#e6f7ff', 32), f.x - r * 0.45, f.y - r * 0.4, r * 0.35, r * 0.18);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      } });
  }
  L.launcher_hydro = {
    update(R, dt, lv) {
      if (!ready(R, 'hydro', dt)) return;
      const p = R.player, t = W.cluster(R, p.x, p.y, 11, 2.6);
      if (!t) { setCd(R, 'hydro', 0.3); return; }
      const tx = t.x + U.rand(-0.3, 0.3), ty = t.y + U.rand(-0.3, 0.3);
      const fan = R.evolved.evo_launcher_hydro && W.evoFirst(R, 'evo_launcher_hydro');
      W.lob(R, { x: p.x, y: p.y - 0.2, tx, ty, time: 0.55, height: 3, sprite: 'bottle', size: 0.95, spin: 10, glow: '#3fa9ff',
        onLand(R2) { spawnPuddle(R2, tx, ty, lv); if (fan) W.evoFanfare(R2, tx, ty, '#3fa9ff', 6, 'evo_launcher_hydro'); } });
      setCd(R, 'hydro', W.launcherCd(R, 10));
    },
  };

  /* ============================ CRYO 雪降らし ============================ */
  const flakes = [];
  function initFlakes() {
    if (flakes.length) return;
    for (let i = 0; i < 140; i++) flakes.push({ x: Math.random(), y: Math.random(), z: Math.random(), rot: Math.random() * 6, vr: (Math.random() - 0.5) * 2, big: i < 26 });
  }
  function snowWeather(R, lv) {
    const S = R.stats, evo = !!R.evolved.evo_launcher_cryo;
    const life = (6 + 1.5 * (lv - 1)) * (S.durationMul || 1) + (evo ? 3 : 0);
    initFlakes();
    G.audio.sfx('cryo');
    G.fx.flash && G.fx.flash('#e6fdff', 0.25);
    let ticks = 0;
    const f = W.field(R, { x: 0, y: 0, life, tick: 0.8, next: 0.05, ground: false, weather: true,
      onTick(R2) {
        ticks++;
        let sparkles = reduced() ? 3 : 14;
        const p = R2.player;
        for (let i = 0; i < R2.enemies.length; i++) {
          const e = R2.enemies[i]; if (e.dead) continue;
          G.combat.applyAura(R2, e, 'cryo', 1);
          if (sparkles > 0 && G.render.onScreen(e.x, e.y, 0) && U.chance(0.3)) { sparkles--; G.fx.burst(e.x, e.y - e.def.h * 0.5, 3, '#e6fdff', { max: 2.5, life: 0.4, size: 0.1 }); }
        }
        if (evo) {
          // 永久凍土の吹雪: blizzard damage + periodic mass freeze
          G.combat.aoe(R2, p.x, p.y, 20, { mul: 0.55 + 0.1 * lv, element: 'cryo', gauge: 0, src: 'evo_launcher_cryo', knock: 0, quiet: true, filter: e => G.render.onScreen(e.x, e.y, 1) });
          if (ticks % 3 === 0) {
            G.fx.flash && G.fx.flash('#bff4ff', 0.3); G.audio.sfx('cryo');
            R2.grid.query(p.x, p.y, 20, e => { if (G.render.onScreen(e.x, e.y, 1)) G.combat.freeze(R2, e, e.boss ? 0.4 : e.elite ? 0.9 : 1.6); });
          }
        }
      },
      draw(ctx, fl) {
        const a = Math.min(1, fl.t / 0.8, (fl.life - fl.t) / 1.0);
        const v = viewRect(), t = fl.t, cam = G.view.cam;
        // cold tint over the whole view
        ctx.globalAlpha = a * (evo ? 0.16 : 0.1); ctx.fillStyle = '#cfefff'; ctx.fillRect(v.x0, v.y0, v.w, v.h);
        const im = G.assets.img.icon_snow, n = reduced() ? 50 : flakes.length;
        ctx.fillStyle = '#ffffff';
        for (let i = 0; i < n; i++) {
          const s = flakes[i], depth = 0.5 + s.z * 0.8;
          const wx = v.x0 + (((s.x + t * 0.02 * (evo ? 3 : 1) * depth + Math.sin(t * 0.8 + i) * 0.01 - cam.x * 0.02 * depth) % 1 + 1) % 1) * v.w;
          const wy = v.y0 + (((s.y + t * 0.09 * depth * (evo ? 1.8 : 1) - cam.y * 0.02 * depth) % 1 + 1) % 1) * v.h;
          ctx.globalAlpha = a * (0.45 + 0.5 * s.z);
          if (s.big && im) G.render.icon(ctx, 'snow', wx, wy, 0.25 + s.z * 0.35, s.rot + t * s.vr, a * (0.55 + 0.45 * s.z));
          else { const r = 0.04 + s.z * 0.07; ctx.fillRect(wx - r, wy - r, r * 2, r * 2); }
        }
        ctx.globalAlpha = 1;
      } });
    return f;
  }
  L.launcher_cryo = {
    update(R, dt, lv) {
      if (!ready(R, 'cryo', dt)) return;
      snowWeather(R, lv); // works even with no enemies (spec)
      if (R.evolved.evo_launcher_cryo && W.evoFirst(R, 'evo_launcher_cryo')) W.evoFanfare(R, R.player.x, R.player.y, '#bff4ff', 9, 'evo_launcher_cryo');
      setCd(R, 'cryo', W.launcherCd(R, 24));
    },
  };

  /* ============================ ELECTRO 連鎖雷 ============================ */
  function electroMul(lv) { return 2.8 + 0.8 * (lv - 1); }
  function chainStrike(R, first, jumps, mul, src) {
    const hit = [first.id];
    // sky strike on the first target
    bolt(R, first.x + U.rand(-1.5, 1.5), first.y - 11, first.x, first.y - 0.6, { width: 1.3, life: 0.28, segs: 12, jitter: 0.6 });
    G.fx.zap && G.fx.zap(first.x, first.y - 0.6);
    wave(R, first.x, first.y, 1.6, '#c77dff', 0.3, 0.18);
    G.combat.hit(R, first, { mul: mul * 1.25, element: 'electro', gauge: 1, src, knock: 0.5 });
    G.audio.sfx('electro', { x: first.x, y: first.y });
    let cur = first, i = 0;
    (function step() {
      if (i >= jumps || !cur) return;
      const from = cur;
      const nx = R.grid.nearest(from.x, from.y, 5.5, e => hit.indexOf(e.id) < 0 && !(e.spawnT > 0.2));
      if (!nx) return;
      hit.push(nx.id); i++;
      later(R, 0.06, () => {
        bolt(R, from.x, from.y - 0.8, nx.x, nx.y - 0.8, { width: 0.8, life: 0.22, segs: 7, jitter: 0.35 });
        G.fx.lightning && G.fx.lightning(from.x, from.y - 0.8, nx.x, nx.y - 0.8, '#c77dff');
        G.combat.hit(R, nx, { mul, element: 'electro', gauge: 1, src, knock: 0.3 });
        elSfx(R, 'electro', nx.x, nx.y, 0.5);
        cur = nx; step();
      });
    })();
  }
  let cloudImg = null;
  function cloudCanvas() {
    if (cloudImg) return cloudImg;
    const c = G.assets.makeCanvas(360, 180), x = c.getContext('2d');
    const puffs = [[70, 112, 52], [128, 86, 64], [196, 78, 70], [262, 94, 58], [306, 118, 42], [160, 126, 60], [230, 128, 56], [104, 132, 44]];
    // dark underside
    for (const [px, py, r] of puffs) { const g = x.createRadialGradient(px, py + r * 0.3, r * 0.1, px, py + r * 0.2, r * 1.05); g.addColorStop(0, 'rgba(40,28,70,0.95)'); g.addColorStop(0.75, 'rgba(52,38,92,0.85)'); g.addColorStop(1, 'rgba(52,38,92,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py + r * 0.2, r * 1.05, 0, Math.PI * 2); x.fill(); }
    // lit billowing tops
    for (const [px, py, r] of puffs) { const g = x.createRadialGradient(px - r * 0.2, py - r * 0.45, r * 0.05, px, py - r * 0.1, r * 0.85); g.addColorStop(0, 'rgba(214,196,255,0.95)'); g.addColorStop(0.45, 'rgba(140,112,200,0.75)'); g.addColorStop(1, 'rgba(90,66,150,0)'); x.fillStyle = g; x.beginPath(); x.arc(px, py - r * 0.1, r * 0.85, 0, Math.PI * 2); x.fill(); }
    // electric rim along the bottom edge
    x.globalCompositeOperation = 'lighter';
    for (const [px, py, r] of puffs) { const g = x.createRadialGradient(px, py + r * 0.75, 1, px, py + r * 0.75, r * 0.6); g.addColorStop(0, 'rgba(199,125,255,0.45)'); g.addColorStop(1, 'rgba(199,125,255,0)'); x.fillStyle = g; x.fillRect(px - r, py, r * 2, r * 1.4); }
    cloudImg = c; return c;
  }
  function ensureCloud(R) {
    const Ws = R.wstate; if (Ws.thunderCloud && R.fields.indexOf(Ws.thunderCloud) >= 0) return;
    const p = R.player;
    Ws.thunderCloud = W.field(R, { x: p.x, y: p.y - 5, life: 1e9, tick: 0.5, next: 0.5, ground: false, fan: W.evoFirst(R, 'evo_launcher_electro'),
      update(R2, dt, f) { const pl = R2.player; f.x += (pl.x - f.x) * Math.min(1, dt * 3); f.y += (pl.y - 5.2 - f.y) * Math.min(1, dt * 3); },
      onTick(R2, f) {
        if (!R2.evolved.evo_launcher_electro) { f.kill = true; return; }
        const pl = R2.player, c = W.nearestN(R2, pl.x, pl.y, 10, 8);
        if (!c.length) return;
        const n = Math.min(c.length, 2);
        for (let k = 0; k < n; k++) {
          const t = c[Math.floor(U.rnd() * c.length)];
          bolt(R2, f.x + U.rand(-1.2, 1.2), f.y + 0.3, t.x, t.y - 0.6, { width: 1.4, life: 0.24, segs: 11, jitter: 0.55 });
          wave(R2, t.x, t.y, 1.4, '#c77dff', 0.25, 0.16);
          chainStrike2(R2, t, 2, electroMul(R2.levels.launcher_electro || 1) * 1.0);
        }
        f.flash = 1;
        if (f.fan) { f.fan = false; W.evoFanfare(R2, pl.x, pl.y, '#c77dff', 7, 'evo_launcher_electro'); for (let k = 0; k < Math.min(8, c.length); k++) { bolt(R2, f.x, f.y, c[k].x, c[k].y - 0.6, { width: 1.6, life: 0.35 }); chainStrike2(R2, c[k], 1, electroMul(R2.levels.launcher_electro || 1) * 1.5); } }
      },
      draw(ctx, f) {
        const t = G.run.time; f.flash = Math.max(0, (f.flash || 0) - 0.08);
        // storm shadow on the ground under the cloud
        const pl = G.run.player;
        ctx.globalAlpha = 0.22; ctx.drawImage(glow('#1a1030', 64), pl.x - 3.2, pl.y - 1.1, 6.4, 2.2);
        // storm cloud (cached procedural sprite): gently bobbing, lit from inside by lightning
        const cw = 7.2, ch = 3.6, bob = Math.sin(t * 1.7) * 0.12, cc = cloudCanvas();
        ctx.globalAlpha = 0.95; ctx.drawImage(cc, f.x - cw / 2, f.y - ch * 0.62 + bob, cw, ch);
        ctx.globalCompositeOperation = 'lighter';
        const fl = f.flash + (Math.sin(t * 23) > 0.93 ? 0.6 : 0);
        ctx.globalAlpha = Math.min(1, 0.25 + 0.6 * fl + 0.1 * Math.sin(t * 9));
        ctx.drawImage(glow('#c77dff', 64), f.x - 2.8, f.y - 1.4, 5.6, 2.8);
        if (fl > 0.3) { ctx.globalAlpha = fl * 0.7; ctx.drawImage(glow('#ffffff', 32), f.x - 1, f.y - 0.5, 2, 1); }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      } });
  }
  // lighter-weight chain for the cloud (no extra sky bolt)
  function chainStrike2(R, first, jumps, mul) {
    G.combat.hit(R, first, { mul, element: 'electro', gauge: 1, src: 'evo_launcher_electro', knock: 0.3 });
    G.fx.zap && G.fx.zap(first.x, first.y - 0.6);
    const hitIds = [first.id]; let cur = first;
    for (let i = 0; i < jumps; i++) {
      const nx = R.grid.nearest(cur.x, cur.y, 4.5, e => hitIds.indexOf(e.id) < 0); if (!nx) break;
      hitIds.push(nx.id);
      bolt(R, cur.x, cur.y - 0.8, nx.x, nx.y - 0.8, { width: 0.7, life: 0.2, segs: 6, jitter: 0.3 });
      G.combat.hit(R, nx, { mul: mul * 0.8, element: 'electro', gauge: 1, src: 'evo_launcher_electro', knock: 0.2 });
      cur = nx;
    }
    elSfx(R, 'electro', first.x, first.y, 0.4);
  }
  L.launcher_electro = {
    update(R, dt, lv) {
      if (R.evolved.evo_launcher_electro) ensureCloud(R);
      if (!ready(R, 'electro', dt)) return;
      const p = R.player, t = R.grid.nearest(p.x, p.y, 11, e => !(e.spawnT > 0.2));
      if (!t) { setCd(R, 'electro', 0.25); return; }
      chainStrike(R, t, 3 + lv, electroMul(lv), 'launcher_electro');
      setCd(R, 'electro', W.launcherCd(R, 4.2));
    },
  };

  /* ============================ ANEMO かぜおこし ============================ */
  function anemoMul(lv) { return 0.9 + 0.3 * (lv - 1); }
  function pull(R, x, y, r, str, dt) {
    R.grid.query(x, y, r, e => {
      if (e.boss) return; const dx = x - e.x, dy = y - e.y, l = Math.hypot(dx, dy); if (l < 0.35) return;
      const s = str * (e.elite ? 0.3 : 1) * (0.35 + 0.65 * (l / r)) * dt;
      e.x += dx / l * s - dy / l * s * 0.45; e.y += dy / l * s + dx / l * s * 0.45; // inward + a little swirl
    });
  }
  function vortex(R, x, y, lv) {
    const S = R.stats, r = (5 + 0.35 * (lv - 1)) * (S.areaMul || 1), life = (4 + 0.25 * (lv - 1)) * (S.durationMul || 1), mul = anemoMul(lv);
    G.audio.sfx('anemo', { x, y }); G.audio.sfx('tornado', { x, y });
    wave(R, x, y, r, '#5cf2c8', 0.5, 0.3);
    W.field(R, { x, y, r, life, tick: 0.65, next: 0.2,
      update(R2, dt, f) {
        pull(R2, f.x, f.y, f.r * 1.25, 4.8, dt);
        if (!reduced() && U.chance(0.7)) { const a = U.rand(0, U.TAU), d = f.r * U.rand(0.7, 1.1); G.fx.particle({ x: f.x + Math.cos(a) * d, y: f.y + Math.sin(a) * d - 0.3, vx: -Math.sin(a) * 6 - Math.cos(a) * 3, vy: Math.cos(a) * 6 - Math.sin(a) * 3, life: 0.5, size: 0.1, color: '#c2fff0', glow: true, drag: 1 }); }
      },
      onTick(R2, f) { elSfx(R2, 'anemo', f.x, f.y, 0.35); G.combat.aoe(R2, f.x, f.y, f.r, { mul, element: 'anemo', gauge: 1, src: 'launcher_anemo', knock: 0 }); },
      draw(ctx, f) { drawVortex(ctx, f.x, f.y, f.r, f.t, Math.min(1, f.t / 0.3, (f.life - f.t) / 0.5)); } });
  }
  function drawVortex(ctx, x, y, r, t, a) {
    ctx.globalAlpha = a * 0.12; ctx.fillStyle = '#5cf2c8'; ctx.beginPath(); ctx.arc(x, y, r, 0, U.TAU); ctx.fill();
    ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      ctx.strokeStyle = k % 2 ? '#c2fff0' : '#5cf2c8'; ctx.lineWidth = 0.14 - k * 0.012; ctx.globalAlpha = a * 0.55;
      ctx.beginPath();
      for (let s = 0; s <= 18; s++) { const u = s / 18, th = t * 4 + k * U.TAU / 5 + u * 3.6, rr = r * (1 - u * 0.9); const px = x + Math.cos(th) * rr, py = y + Math.sin(th) * rr; s ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
      ctx.stroke();
    }
    ctx.globalAlpha = a * 0.5; ctx.drawImage(glow('#5cf2c8', 64), x - 1.4, y - 1.4, 2.8, 2.8);
    ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt';
    G.render.icon(ctx, 'wind', x, y - 0.6, 1.5 + 0.15 * Math.sin(t * 6), t * 5, a);
    ctx.globalAlpha = 1;
  }
  function tornado(R, x, y, lv) {
    const S = R.stats, r = 2.8 * (S.areaMul || 1), life = (7 + 0.5 * lv) * (S.durationMul || 1), mul = anemoMul(lv) * 1.6;
    G.audio.sfx('tornado', { x, y }); G.audio.sfx('windBlast', { x, y });
    W.field(R, { x, y, r, life, tick: 0.3, next: 0.2, ground: false, retarget: 0,
      update(R2, dt, f) {
        f.retarget -= dt;
        if (f.retarget <= 0) { f.retarget = 1; const t = W.cluster(R2, R2.player.x, R2.player.y, 11, 2.5); f.tx = t ? t.x : R2.player.x + U.rand(-4, 4); f.ty = t ? t.y : R2.player.y + U.rand(-4, 4); }
        const d = U.dist(f.x, f.y, f.tx, f.ty); if (d > 0.3) { const sp = Math.min(4, d * 1.5); f.x += (f.tx - f.x) / d * sp * dt; f.y += (f.ty - f.y) / d * sp * dt; }
        pull(R2, f.x, f.y, f.r * 2.2, 7, dt);
        R2.grid.query(f.x, f.y, f.r, e => { e.slowUntil = R2.time + 0.3; e.liftUntil = R2.time + 0.3; });
        if (!reduced() && U.chance(0.8)) { const a = U.rand(0, U.TAU); G.fx.particle({ x: f.x + Math.cos(a) * f.r, y: f.y - U.rand(0, 3), vx: -Math.sin(a) * 7, vy: -U.rand(2, 5), life: 0.5, size: U.rand(0.08, 0.16), color: U.chance(0.3) ? '#d9c7a0' : '#c2fff0', glow: true, drag: 1 }); }
      },
      onTick(R2, f) { elSfx(R2, 'anemo', f.x, f.y, 0.3); G.combat.aoe(R2, f.x, f.y, f.r, { mul, element: 'anemo', gauge: 1, src: 'evo_launcher_anemo', knock: 0 }); },
      draw(ctx, f) {
        const a = Math.min(1, f.t / 0.4, (f.life - f.t) / 0.6), t = f.t, H = 6;
        ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
        ctx.globalAlpha = a * 0.4; ctx.drawImage(glow('#5cf2c8', 64), f.x - f.r * 1.3, f.y - f.r * 0.6, f.r * 2.6, f.r * 1.2);
        for (let i = 0; i < 14; i++) {
          const u = i / 13, yy = f.y - u * H, rr = f.r * (0.25 + u * 1.05) + Math.sin(t * 7 + i) * 0.1, sway = Math.sin(t * 2.5 + u * 3) * 0.5 * u;
          ctx.strokeStyle = i % 2 ? '#c2fff0' : '#5cf2c8'; ctx.lineWidth = 0.16; ctx.globalAlpha = a * (0.35 + 0.35 * (1 - u));
          const s0 = t * 9 + i * 0.7;
          ctx.beginPath(); ctx.ellipse(f.x + sway, yy, rr, rr * 0.3, 0, s0 % U.TAU, s0 % U.TAU + 4.2); ctx.stroke();
        }
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.lineCap = 'butt';
      } });
  }
  L.launcher_anemo = {
    update(R, dt, lv) {
      if (!ready(R, 'anemo', dt)) return;
      const p = R.player, t = W.cluster(R, p.x, p.y, 11, 3);
      if (!t) { setCd(R, 'anemo', 0.3); return; }
      if (R.evolved.evo_launcher_anemo) { tornado(R, t.x, t.y, lv); if (W.evoFirst(R, 'evo_launcher_anemo')) { W.evoFanfare(R, t.x, t.y, '#5cf2c8', 7, 'evo_launcher_anemo'); tornado(R, t.x + 3, t.y, lv); tornado(R, t.x - 3, t.y, lv); } }
      else vortex(R, t.x, t.y, lv);
      setCd(R, 'anemo', W.launcherCd(R, 13));
    },
  };

  /* ============================ GEO 創造力 ============================ */
  const GEO_COUNT = [2, 2, 3, 3, 4];
  function construct(R, x, y, lv, evo) {
    const S = R.stats, mulHit = 4 + 1.2 * (lv - 1), mulWave = 2 + 0.6 * (lv - 1);
    const wr = 3 * (S.areaMul || 1) * (evo ? 1.4 : 1);
    R.props.push({ x, y, t: 0, pulses: 0, glowT: 0,
      update(R2, dt, c) {
        const prev = c.t; c.t += dt; c.glowT = Math.max(0, c.glowT - dt * 3);
        if (prev < 0.12 && c.t >= 0.12) { // emergence
          G.combat.aoe(R2, c.x, c.y, 1.6, { mul: mulHit, element: 'geo', gauge: 1, src: 'launcher_geo', knock: 1.8, blunt: true });
          G.audio.sfx('rockImpact', { x: c.x, y: c.y }); G.fx.shake(0.25);
          wave(R2, c.x, c.y, 1.8, '#ffd24a', 0.35, 0.25);
          if (!reduced()) for (let i = 0; i < 12; i++) { const a = U.rand(0, U.TAU), s = U.rand(2, 6); G.fx.particle({ x: c.x, y: c.y - 0.2, vx: Math.cos(a) * s, vy: Math.sin(a) * s * 0.5 - U.rand(2, 5), life: U.rand(0.4, 0.7), size: U.rand(0.08, 0.17), color: i % 3 ? '#c9a66b' : '#ffd24a', glow: i % 3 === 0, grav: 14, drag: 1 }); }
        }
        const due = 1.12 + c.pulses;
        if (c.pulses < 3 && c.t >= due) {
          c.pulses++; c.glowT = 1;
          G.combat.aoe(R2, c.x, c.y, wr, { mul: mulWave, element: 'geo', gauge: 1, src: evo ? 'evo_launcher_geo' : 'launcher_geo', knock: 0.9, blunt: true });
          wave(R2, c.x, c.y, wr, '#ffd24a', 0.5, 0.35);
          G.fx.ring && G.fx.ring(c.x, c.y, wr, '#fff0a8');
          elSfx(R2, 'geo', c.x, c.y, 0.6);
          if (evo) { // 岩王の城壁: shield pulse to the player
            const pl = R2.player, amt = pl.maxHp * 0.1 * (S.shieldMul || 1);
            G.player.addShield(R2, Math.min(pl.maxHp * 0.4, Math.max(amt, (pl.shield || 0) + amt * 0.4)), 8);
            c.beam = 0.35;
            G.bus.emit('shield', 'geo');
          }
        }
        if (c.beam > 0) c.beam -= dt;
        if (c.t >= 3.6) return false;
      },
      draw(ctx, c) {
        const rise = U.ease.outBack(U.clamp(c.t / 0.18, 0, 1)), sink = U.clamp((c.t - 3.25) / 0.35, 0, 1);
        const hgt = rise * (1 - sink);
        const shake = c.t < 0.25 ? U.rand(-0.05, 0.05) : 0;
        G.render.shadow(ctx, c.x, c.y, 0.8, 0.35);
        // crack decal
        ctx.globalAlpha = 0.5 * (1 - sink); ctx.strokeStyle = '#4a3a20'; ctx.lineWidth = 0.06;
        ctx.beginPath(); for (let i = 0; i < 5; i++) { const a = i * 1.26 + 0.3; ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + Math.cos(a) * 1.1, c.y + Math.sin(a) * 0.55); } ctx.stroke(); ctx.globalAlpha = 1;
        const im = G.assets.img.icon_rock; if (!im) return;
        const s = 1.9, h = s * im.height / im.width;
        ctx.save(); ctx.beginPath(); ctx.rect(c.x - s, c.y - h - 1, s * 2, h + 1.12); ctx.clip(); // hide the part still underground
        ctx.drawImage(im, c.x - s / 2 + shake, c.y - h * hgt + 0.1, s, h);
        if (c.glowT > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = c.glowT * 0.8; ctx.drawImage(glow('#ffd24a', 64), c.x - 1.4, c.y - h * hgt - 0.2, 2.8, h + 0.4); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
        ctx.restore();
        if (c.beam > 0) { // shield link to the player
          const pl = G.run.player; ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = c.beam * 2; ctx.strokeStyle = '#ffe27a'; ctx.lineWidth = 0.12;
          ctx.beginPath(); ctx.moveTo(c.x, c.y - 1); ctx.lineTo(pl.x, pl.y - 1); ctx.stroke(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
        }
      } });
  }
  L.launcher_geo = {
    update(R, dt, lv) {
      if (!ready(R, 'geo', dt)) return;
      const p = R.player, evo = !!R.evolved.evo_launcher_geo, n = GEO_COUNT[Math.min(4, lv - 1)] + (evo ? 1 : 0);
      const cand = W.nearestN(R, p.x, p.y, 11, n * 4);
      if (!cand.length) { setCd(R, 'geo', 0.3); return; }
      const picks = [];
      for (const e of cand) { if (picks.length >= n) break; if (picks.every(q => U.dist2(q.x, q.y, e.x, e.y) > 6.25)) picks.push(e); }
      picks.forEach((e, i) => later(R, i * 0.08, () => construct(R, e.x, e.y, lv, evo)));
      if (evo && W.evoFirst(R, 'evo_launcher_geo')) W.evoFanfare(R, p.x, p.y, '#ffd24a', 6, 'evo_launcher_geo');
      setCd(R, 'geo', W.launcherCd(R, 13));
    },
  };
})();
