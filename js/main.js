/* main.js — boot, scene switching, main loop (fixed-step simulation + per-frame render). */
'use strict';
(function () {
  G.scene = 'boot';
  G.time = 0;
  G.setScene = function (name) { G.scene = name; document.body.classList.toggle('in-run', name === 'run'); G.bus.emit('scene', name); };
  G.startRun = function (charId) {
    G.audio.init();
    G.ui.clearAll();
    G.game.start(charId);
    G.setScene('run');
    G.audio.bgm('battle');
  };

  let acc = 0, last = 0, fpsT = 0, fpsN = 0; G.fps = 60;
  function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.1, (ts - last) / 1000 || 0); last = ts;
    G.time += dt;
    fpsT += dt; fpsN++; if (fpsT >= 0.5) { G.fps = fpsN / fpsT; fpsT = 0; fpsN = 0; }
    G.input.update();
    const ctx = G.view.ctx;
    if (G.scene === 'run' && G.run) {
      acc += dt; let n = 0;
      while (acc >= G.cfg.step && n < 5) { for (let k = 0; k < (G.debug ? G.debug.speed : 1); k++) G.game.step(G.cfg.step); acc -= G.cfg.step; n++; }
      if (n >= 5) acc = 0;
      G.fx.update(dt);
      // camera follows the player with a little lead in the movement direction
      const p = G.run.player, cam = G.view.cam;
      const lx = p.vx * 0.18, ly = p.vy * 0.18;
      const k = 1 - Math.exp(-8 * dt);
      cam.x += (p.x + lx - cam.x) * k; cam.y += (p.y + ly - cam.y) * k;
      cam.punch *= Math.exp(-10 * dt);
      G.render.drawRun(ctx);
    } else if (G.drawBackdrop) {
      G.drawBackdrop(ctx, dt);
    } else {
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = '#0b2029'; ctx.fillRect(0, 0, G.view.canvas.width, G.view.canvas.height);
    }
  }

  function boot() {
    if (window.__MONDO_WRAP) return; // portrait wrapper hosts the real game in a rotated iframe
    G.save.load();
    G.view.canvas = document.getElementById('game');
    G.view.ctx = G.view.canvas.getContext('2d', { alpha: false });
    G.ui.init();
    G.input.init();
    G.render.resize();
    addEventListener('resize', () => G.render.resize());
    G.bus.on('touchMode', () => G.render.resize());
    // audio must start from a user gesture
    const unlock = () => { G.audio.init(); };
    addEventListener('pointerdown', unlock, { passive: true }); addEventListener('keydown', unlock);
    // pause when the tab/app loses focus
    document.addEventListener('visibilitychange', () => { if (document.hidden && G.scene === 'run' && G.run && !G.run.over && !G.game.isPaused()) G.bus.emit('requestPause'); });
    const bar = document.createElement('div'); bar.className = 'boot'; bar.innerHTML = '<div class="boot-title">モンドの風跡</div><div class="boot-bar"><i></i></div>';
    document.getElementById('ui').append(bar);
    requestAnimationFrame(frame);
    G.assets.load(f => { const i = bar.querySelector('i'); if (i) i.style.width = (f * 100).toFixed(0) + '%'; }).then(() => {
      bar.remove();
      G.bus.emit('assetsReady');
      if (false && 'serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});
      const q = new URLSearchParams(location.search);
      if (q.has('autostart')) G.startRun('amber'); else G.screens.title();
    });
  }
  window.addEventListener('error', e => { console.error('[game error]', e.message, e.filename, e.lineno); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
