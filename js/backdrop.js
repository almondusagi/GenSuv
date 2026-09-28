/* backdrop.js — animated canvas behind menus (owner: UI).
   G.drawBackdrop(ctx, dt) is called by main.js whenever no run is being rendered.
   title_bg.webp with slow Ken-Burns + pointer parallax, god rays from the sun, drifting dandelion seeds / petals,
   curling wind streaks and glowing motes. Modes: 'title' (vivid), 'home' (blurred & dimmed), 'dim' (farewell).
   Everything cached (sprites / gradients); no per-frame allocations in the particle loops. */
'use strict';
G.backdrop = (function () {
  const V = G.view, TAU = Math.PI * 2;
  let t = 0, intro = 1, introT = 0, gust = 0, mode = 'title', modeK = 0, dimK = 0;
  let px = 0, py = 0, tpx = 0, tpy = 0;
  let spr = null, blurBg = null, vig = null, vigW = 0, vigH = 0, shade = null;
  const P = [];         // particles (seed / petal / mote)
  const W = [];         // wind streaks {x,y,sp,amp,ph,len,hist:[...], n}
  let W_HIST = 18;
  const B = [];         // distant birds {x,y,s,ph,sp}
  const TW = [];        // twinkles {x,y,t,life,s} in normalised image coords
  let autoGust = 5, swarm = 0;
  const FG = [];        // foreground bokeh petals

  addEventListener('pointermove', e => { tpx = e.clientX / (innerWidth || 1) - 0.5; tpy = e.clientY / (innerHeight || 1) - 0.5; }, { passive: true });

  function mk(w, h) { return G.assets.makeCanvas(w, h); }
  function buildSprites() {
    spr = {};
    // dandelion seed: pappus (radial filaments) + stalk
    const s = mk(48, 64), x = s.getContext('2d');
    x.translate(24, 22); x.strokeStyle = 'rgba(255,255,255,.85)'; x.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (i / 13 - 0.5) * 2.6;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(Math.cos(a) * 17, Math.sin(a) * 17); x.stroke();
      x.fillStyle = 'rgba(255,255,255,.9)'; x.beginPath(); x.arc(Math.cos(a) * 17, Math.sin(a) * 17, 1.3, 0, TAU); x.fill();
    }
    x.strokeStyle = 'rgba(240,235,220,.9)'; x.lineWidth = 1.2; x.beginPath(); x.moveTo(0, 0); x.lineTo(0, 30); x.stroke();
    x.fillStyle = '#d8c9a0'; x.beginPath(); x.ellipse(0, 32, 1.6, 3.2, 0, 0, TAU); x.fill();
    spr.seed = s;
    // petals (white + pale gold) and leaves (anemo teal)
    const petal = (c1, c2, w, h) => {
      const c = mk(w * 2 + 4, h * 2 + 4), p = c.getContext('2d'); p.translate(c.width / 2, c.height / 2);
      const g = p.createLinearGradient(-w, 0, w, 0); g.addColorStop(0, c1); g.addColorStop(1, c2);
      p.fillStyle = g; p.beginPath(); p.moveTo(-w, 0); p.quadraticCurveTo(0, -h * 1.1, w, 0); p.quadraticCurveTo(0, h * 1.1, -w, 0); p.fill();
      return c;
    };
    spr.petalW = petal('#ffffff', '#f3eee0', 9, 5);
    spr.petalG = petal('#fff6d6', '#f6d98f', 8, 4.5);
    spr.leaf = petal('#b9fff0', '#3fcfa8', 9, 4);
    spr.mote = G.assets.glow('#fff1c0', 64);
    spr.moteT = G.assets.glow('#a8fff0', 64);
    spr.sun = G.assets.glow('#fff4cf', 256);
    // god rays: soft wedges radiating from the centre
    const R = 512, r = mk(R, R), q = r.getContext('2d'); q.translate(R / 2, R / 2);
    const rg = q.createRadialGradient(0, 0, 0, 0, 0, R / 2);
    rg.addColorStop(0, 'rgba(255,244,210,.55)'); rg.addColorStop(0.35, 'rgba(255,236,190,.22)'); rg.addColorStop(1, 'rgba(255,236,190,0)');
    q.fillStyle = rg;
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 22; i++) {
      const a = rnd() * TAU, w = 0.03 + rnd() * 0.09;
      q.beginPath(); q.moveTo(0, 0); q.arc(0, 0, R / 2, a - w, a + w); q.closePath(); q.fill();
    }
    spr.rays = r;
    // element motes (Genshin element colours) + lens-flare ghost ring + twinkle star
    spr.moteE = ['#ff9a5a', '#6cc4ff', '#bff6ff', '#d9a2ff', '#7dffd8', '#ffe07a'].map(c => G.assets.glow(c, 64));
    const gh = mk(128, 128), gx = gh.getContext('2d'), gg = gx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gg.addColorStop(0, 'rgba(255,240,200,.05)'); gg.addColorStop(0.72, 'rgba(255,240,200,.12)'); gg.addColorStop(0.86, 'rgba(200,255,240,.35)'); gg.addColorStop(1, 'rgba(200,255,240,0)');
    gx.fillStyle = gg; gx.fillRect(0, 0, 128, 128); spr.ghost = gh;
    const tw = mk(64, 64), tx = tw.getContext('2d'); tx.translate(32, 32);
    const tg = tx.createRadialGradient(0, 0, 0, 0, 0, 10); tg.addColorStop(0, 'rgba(255,255,255,1)'); tg.addColorStop(1, 'rgba(255,255,255,0)'); tx.fillStyle = tg; tx.fillRect(-10, -10, 20, 20);
    tx.fillStyle = 'rgba(255,252,235,.9)'; for (let i = 0; i < 2; i++) { tx.beginPath(); tx.moveTo(-30, 0); tx.lineTo(0, -1.6); tx.lineTo(30, 0); tx.lineTo(0, 1.6); tx.closePath(); tx.fill(); tx.rotate(Math.PI / 2); }
    spr.twinkle = tw;
    // big out-of-focus foreground petals (depth of field)
    const bokeh = (src) => { const c = mk(96, 64), q = c.getContext('2d'); if ('filter' in q) q.filter = 'blur(3px)'; q.drawImage(src, 16, 10, 64, 44); return c; };
    spr.bokeh = [bokeh(spr.petalW), bokeh(spr.petalG), bokeh(spr.leaf)];
  }
  function buildBlur() {
    const im = G.assets.img.title_bg; if (!im) return;
    const w = 640, h = Math.round(640 * im.height / im.width), c = mk(w, h), x = c.getContext('2d');
    if ('filter' in x) x.filter = 'blur(5px) saturate(1.15) brightness(.62)';
    x.drawImage(im, -12, -8, w + 24, h + 16);
    if (!('filter' in x)) { x.fillStyle = 'rgba(8,16,30,.45)'; x.fillRect(0, 0, w, h); }
    blurBg = c;
  }

  function reset() {
    P.length = 0; W.length = 0;
    const low = G.save.data.settings.reducedFx;
    const n = low ? 0.45 : 1, w = V.w || 1280, h = V.h || 720;
    const add = (type, count) => { for (let i = 0; i < Math.round(count * n); i++) P.push(spawn({ type }, true, w, h)); };
    add(0, 16); add(1, 22); add(2, 38);
    const ws = low ? 3 : 7;
    for (let i = 0; i < ws; i++) W.push(newStreak({ hist: new Float32Array(W_HIST * 2) }, true, w, h));
    B.length = 0; for (let i = 0; i < (low ? 3 : 6); i++) B.push({ x: Math.random() * w, y: h * (0.08 + Math.random() * 0.22), s: 0.5 + Math.random() * 0.6, ph: Math.random() * 6, sp: 14 + Math.random() * 16 });
    TW.length = 0;
    FG.length = 0; if (!low) for (let i = 0; i < 4; i++) FG.push({ x: Math.random() * w, y: Math.random() * h, z: 1.6 + Math.random() * 1.4, rot: Math.random() * 6, vr: (Math.random() - 0.5) * 2, k: i % 3, ph: Math.random() * 6 });
  }
  function spawn(p, anywhere, w, h) {
    const r = Math.random;
    p.x = anywhere ? r() * w : -40 - r() * 120; p.y = r() * h * (p.type === 2 ? 1 : 0.95);
    p.z = 0.5 + r() * 0.9;                    // depth: size & speed
    p.vx = (18 + r() * 34) * p.z; p.vy = (r() - 0.62) * 12;
    p.rot = r() * TAU; p.vr = (r() - 0.5) * (p.type === 1 ? 3.2 : 0.8); p.ph = r() * TAU;
    p.kind = p.type === 1 ? (r() < 0.55 ? 0 : r() < 0.6 ? 1 : 2) : p.type === 2 ? (r() < 0.6 ? 0 : r() < 0.45 ? 1 : 2 + Math.floor(r() * 6)) : 0;
    p.a = p.type === 2 ? 0.25 + r() * 0.6 : 0.65 + r() * 0.35;
    return p;
  }
  function newStreak(s, anywhere, w, h) {
    const r = Math.random;
    s.x = anywhere ? r() * w : -r() * w * 0.4 - 60; s.y = h * (0.12 + r() * 0.76);
    s.sp = 260 + r() * 260; s.amp = 16 + r() * 34; s.ph = r() * TAU; s.f = 0.006 + r() * 0.006; s.n = 0; s.w = 1 + r() * 1.8; s.a = 0.18 + r() * 0.3;
    return s;
  }

  function coverRect(im, zoom, ox, oy) {
    const w = V.w, h = V.h, s = Math.max(w / im.width, h / im.height) * zoom;
    const dw = im.width * s, dh = im.height * s;
    return { x: (w - dw) / 2 + ox, y: (h - dh) / 2 + oy, w: dw, h: dh, s };
  }

  function draw(ctx, dt) {
    if (!spr) buildSprites();
    if (!blurBg) buildBlur();
    const w = V.w, h = V.h;
    if (P.length === 0 && W.length === 0) reset();
    t += dt; introT += dt; gust = Math.max(0, gust - dt * 0.9); swarm = Math.max(0, swarm - dt);
    // the wind breathes: a soft gust every few seconds sends the petals & streaks racing
    autoGust -= dt; if (autoGust <= 0) { autoGust = 6 + Math.random() * 4; gust = Math.min(1.4, gust + 0.45); swarm = 1.6; if (W.length) { const s0 = W[(Math.random() * W.length) | 0]; newStreak(s0, false, V.w || 1280, V.h || 720); s0.a = 0.55; s0.w = 2.4; } }
    intro = Math.max(0, 1 - introT / 1.4);
    modeK += ((mode === 'home' ? 1 : 0) - modeK) * Math.min(1, dt * 3);
    dimK += ((mode === 'dim' ? 1 : 0) - dimK) * Math.min(1, dt * 2);
    px += (tpx - px) * Math.min(1, dt * 2.5); py += (tpy - py) * Math.min(1, dt * 2.5);
    const low = G.save.data.settings.reducedFx;

    ctx.setTransform(V.dpr, 0, 0, V.dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#0b1626'; ctx.fillRect(0, 0, w, h);

    // ---- background image with Ken-Burns ----
    const im = G.assets.img.title_bg;
    const kb = 0.5 - 0.5 * Math.cos(t * TAU / 46);
    const zoom = 1.07 + 0.06 * kb + gust * 0.03;
    const ox = -px * 26 + (kb - 0.5) * 30, oy = -py * 16 + (kb - 0.5) * -10;
    let rect = null;
    if (im) {
      rect = coverRect(im, zoom, ox, oy);
      if (modeK < 0.99) { ctx.drawImage(im, rect.x, rect.y, rect.w, rect.h); }
      if (modeK > 0.01 && blurBg) {
        ctx.globalAlpha = modeK; const br = coverRect(blurBg, zoom * 1.02, ox * 0.6, oy * 0.6);
        ctx.drawImage(blurBg, br.x, br.y, br.w, br.h); ctx.globalAlpha = 1;
      }
    }

    // ---- god rays + sun glow ----
    ctx.globalCompositeOperation = 'lighter';
    if (rect) {
      const sx = rect.x + rect.w * (1420 / 1672), sy = rect.y + rect.h * (240 / 941);
      const ra = (1 - modeK * 0.6) * (1 - dimK);
      const S = h * 2.1 * (1 + 0.05 * Math.sin(t * 0.5));
      ctx.save(); ctx.translate(sx, sy);
      ctx.rotate(t * 0.018); ctx.globalAlpha = (0.30 + 0.08 * Math.sin(t * 0.7)) * ra; ctx.drawImage(spr.rays, -S / 2, -S / 2, S, S);
      if (!low) { ctx.rotate(-t * 0.041); ctx.globalAlpha = (0.18 + 0.06 * Math.sin(t * 1.1 + 1)) * ra; ctx.drawImage(spr.rays, -S * 0.4, -S * 0.4, S * 0.8, S * 0.8); }
      ctx.restore();
      const g = h * 0.9 * (1 + 0.04 * Math.sin(t * 1.3));
      ctx.globalAlpha = 0.5 * ra; ctx.drawImage(spr.sun, sx - g / 2, sy - g / 2, g, g);
      if (!low) {
        // lens-flare ghosts along the sun → screen-centre axis (they slide with the parallax)
        const ax = w / 2 - sx, ay = h / 2 - sy;
        for (let i = 0; i < 5; i++) {
          const f = [0.35, 0.6, 0.85, 1.25, 1.6][i], z = h * [0.05, 0.12, 0.07, 0.2, 0.1][i];
          ctx.globalAlpha = (0.35 + 0.15 * Math.sin(t * 0.8 + i)) * ra * (i === 3 ? 0.6 : 1);
          ctx.drawImage(i & 1 ? spr.ghost : spr.moteT, sx + ax * f - z, sy + ay * f - z, z * 2, z * 2);
        }
        // twinkles: sunlight glinting off water & leaves in the picture
        if (TW.length < 9 && Math.random() < dt * 4) TW.push({ x: 0.05 + Math.random() * 0.9, y: 0.35 + Math.random() * 0.6, t: 0, life: 0.6 + Math.random() * 0.7, s: 10 + Math.random() * 18 });
        for (let i = TW.length - 1; i >= 0; i--) {
          const q = TW[i]; q.t += dt; if (q.t >= q.life) { TW.splice(i, 1); continue; }
          const k = Math.sin(Math.PI * q.t / q.life), z = q.s * k; ctx.globalAlpha = 0.85 * k * ra;
          ctx.drawImage(spr.twinkle, rect.x + rect.w * q.x - z, rect.y + rect.h * q.y - z, z * 2, z * 2);
        }
      }
    }
    ctx.globalAlpha = 1;
    // distant birds gliding over the sky (simple flapping V silhouettes)
    ctx.globalCompositeOperation = 'source-over'; ctx.strokeStyle = 'rgba(28,40,52,.55)'; ctx.lineCap = 'round';
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; b.x += b.sp * dt * (1 + gust); if (b.x > w + 40) { b.x = -40; b.y = h * (0.08 + Math.random() * 0.22); }
      const fl = Math.sin(t * 7 * (1.2 - b.s * 0.3) + b.ph), s = 7 * b.s, yy = b.y + Math.sin(t * 0.6 + b.ph) * 6;
      ctx.globalAlpha = (1 - dimK) * (1 - modeK * 0.5); ctx.lineWidth = 1.2 + b.s;
      ctx.beginPath(); ctx.moveTo(b.x - s, yy - fl * s * 0.6); ctx.quadraticCurveTo(b.x - s * 0.4, yy - s * 0.2, b.x, yy); ctx.quadraticCurveTo(b.x + s * 0.4, yy - s * 0.2, b.x + s, yy - fl * s * 0.6); ctx.stroke();
    }
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'lighter';

    // ---- wind streaks (curling polylines with fading tails) ----
    const windBoost = 1 + gust * 5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (let i = 0; i < W.length; i++) {
      const s = W[i];
      s.x += s.sp * windBoost * dt;
      const yy = s.y + Math.sin(s.x * s.f + s.ph) * s.amp + Math.sin(s.x * s.f * 2.7 + s.ph) * s.amp * 0.25;
      const hs = s.hist;
      for (let k = W_HIST - 1; k > 0; k--) { hs[k * 2] = hs[k * 2 - 2]; hs[k * 2 + 1] = hs[k * 2 - 1]; }
      hs[0] = s.x; hs[1] = yy; if (s.n < W_HIST) s.n++;
      if (s.x - 400 > w) newStreak(s, false, w, h);
      const n = s.n; if (n < 3) continue;
      ctx.strokeStyle = '#eafff8';
      for (let k = 1; k < n; k++) {
        const f = 1 - k / n;
        ctx.globalAlpha = s.a * f * (1 - dimK) * (1 - modeK * 0.4);
        ctx.lineWidth = s.w * (0.4 + f);
        ctx.beginPath(); ctx.moveTo(hs[k * 2 - 2], hs[k * 2 - 1]); ctx.lineTo(hs[k * 2], hs[k * 2 + 1]); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // ---- particles ----
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      const sway = Math.sin(t * 1.3 + p.ph);
      p.x += (p.vx * windBoost + sway * 6) * dt;
      p.y += (p.vy + Math.cos(t * 0.9 + p.ph) * 10 * p.z - gust * 30 + (swarm > 0 && p.type === 1 ? Math.sin(p.x * 0.012 + t * 3) * 60 * Math.min(1, swarm) : 0)) * dt;
      p.rot += p.vr * dt * (1 + gust * 3);
      if (p.x > w + 60 || p.y < -60 || p.y > h + 60) spawn(p, false, w, h);
      if (p.type === 2) {
        ctx.globalCompositeOperation = 'lighter';
        const s = (10 + 16 * p.z) * (0.75 + 0.25 * Math.sin(t * 2.2 + p.ph));
        ctx.globalAlpha = p.a * (0.6 + 0.4 * Math.sin(t * 1.7 + p.ph * 2)) * (1 - dimK * 0.5);
        ctx.drawImage(p.kind === 0 ? spr.mote : p.kind === 1 ? spr.moteT : spr.moteE[p.kind - 2], p.x - s / 2, p.y - s / 2, s, s);
      } else {
        ctx.globalCompositeOperation = 'source-over';
        const im2 = p.type === 0 ? spr.seed : p.kind === 0 ? spr.petalW : p.kind === 1 ? spr.petalG : spr.leaf;
        const sc = p.type === 0 ? 0.55 * p.z : 0.9 * p.z;
        ctx.globalAlpha = p.a * (1 - dimK * 0.6);
        ctx.save(); ctx.translate(p.x, p.y);
        ctx.rotate(p.type === 0 ? sway * 0.35 + 0.3 : p.rot);
        if (p.type === 1) ctx.scale(1, 0.35 + 0.65 * Math.abs(Math.sin(p.rot * 0.7 + p.ph)));  // tumbling
        ctx.drawImage(im2, -im2.width * sc / 2, -im2.height * sc * (p.type === 0 ? 0.34 : 0.5), im2.width * sc, im2.height * sc);
        ctx.restore();
      }
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
    // ---- foreground bokeh petals (fast, big, blurred) ----
    for (let i = 0; i < FG.length; i++) {
      const f = FG[i];
      f.x += (120 * f.z * (1 + gust * 3)) * dt; f.y += (Math.sin(t * 0.8 + f.ph) * 30 - 10 - gust * 40) * dt; f.rot += f.vr * dt * (1 + gust * 2);
      if (f.x > w + 150 || f.y < -150 || f.y > h + 150) { f.x = -150 - Math.random() * w * 0.6; f.y = Math.random() * h; }
      const im = spr.bokeh[f.k], sc = f.z * (0.8 + 0.2 * modeK);
      ctx.globalAlpha = 0.55 * (1 - dimK) * (1 - modeK * 0.3);
      ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(f.rot); ctx.scale(sc, sc * (0.4 + 0.6 * Math.abs(Math.sin(f.rot * 0.8 + f.ph)))); ctx.drawImage(im, -48, -32); ctx.restore();
    }
    ctx.globalAlpha = 1;

    // ---- grading: vignette + mode tints ----
    if (!vig || vigW !== w || vigH !== h) {
      vigW = w; vigH = h;
      vig = ctx.createRadialGradient(w * 0.55, h * 0.45, Math.min(w, h) * 0.25, w * 0.55, h * 0.5, Math.max(w, h) * 0.78);
      vig.addColorStop(0, 'rgba(4,10,20,0)'); vig.addColorStop(1, 'rgba(4,10,20,.62)');
      shade = ctx.createLinearGradient(0, 0, 0, h);
      shade.addColorStop(0, 'rgba(8,16,30,.55)'); shade.addColorStop(0.5, 'rgba(8,16,30,.2)'); shade.addColorStop(1, 'rgba(8,16,30,.7)');
    }
    ctx.fillStyle = vig; ctx.fillRect(0, 0, w, h);
    if (modeK > 0.01) { ctx.globalAlpha = modeK; ctx.fillStyle = shade; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    if (dimK > 0.01) { ctx.globalAlpha = dimK * 0.55; ctx.fillStyle = '#040812'; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
    if (gust > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = gust * 0.25; ctx.fillStyle = '#bff8ee'; ctx.fillRect(0, 0, w, h); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    if (intro > 0) { ctx.globalAlpha = intro * intro; ctx.fillStyle = '#050a12'; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; }
  }

  G.drawBackdrop = draw;
  G.bus.on('saveReset', () => { P.length = 0; W.length = 0; });
  return {
    draw,
    setMode(m) { mode = m || 'title'; },
    intro() { introT = 0; intro = 1; },
    gust(a) { gust = Math.min(1.4, gust + (a || 1)); },
    reset,
  };
})();
