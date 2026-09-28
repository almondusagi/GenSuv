/* game.js — run lifecycle, pause stack, fixed-step simulation order.
   G.run is the single source of truth for an active run (null outside of runs). */
'use strict';
G.game = (function () {
  function newRun(charId, stageId) {
    const ch = G.data.characters[charId];
    const R = {
      charId, stageId: stageId || 'mondstadt', char: ch,
      time: 0,              // run clock (seconds) — stops while paused
      realTime: 0,
      pauses: new Set(),    // reasons: 'menu','levelup','chest','blur','cutin','result'
      over: false, victory: false,
      player: null,
      enemies: [], props: [],
      grid: new G.Grid(2.5),
      kills: 0, mora: 0, relicsFound: 0,
      damageDealt: 0, reactions: {}, maxCombo: 0,
      combo: 0, comboTimer: 0,
      levels: {},           // upgrade key -> level (run upgrades)
      evolved: {},          // evolution key -> true
      boss: null, bossDefeated: false,
      rerolls: 3, banishes: 0,
      notices: [],
    };
    return R;
  }

  const api = {
    start(charId, stageId) {
      const R = G.run = newRun(charId || 'amber', stageId);
      G.player.init(R);
      G.progression.initRun(R);
      G.weapons.initRun(R);
      G.enemies.initRun(R);
      G.spawner.initRun(R);
      G.loot.initRun(R);
      G.combat.initRun(R);
      G.fx.clear();
      G.view.cam.x = R.player.x; G.view.cam.y = R.player.y;
      G.input.clear();
      G.bus.emit('runStart', R);
      return R;
    },
    pause(reason) { if (G.run) { G.run.pauses.add(reason); G.bus.emit('pauseChange', true); } },
    resume(reason) { if (G.run) { G.run.pauses.delete(reason); G.input.clear(); if (!G.run.pauses.size) G.bus.emit('pauseChange', false); } },
    isPaused() { return !G.run || G.run.pauses.size > 0; },

    /** one fixed simulation step */
    step(dt) {
      const R = G.run; if (!R || R.over) return;
      R.realTime += dt;
      if (api.isPaused()) return;
      if (G.input.consume('pause')) { G.bus.emit('requestPause'); return; }
      const hs = G.fx.hitstopActive();
      const sdt = hs ? 0 : dt * (G.fx.timeScale || 1);
      if (sdt > 0) {
        R.time += sdt;
        G.player.update(R, sdt);
        // rebuild spatial grid of enemies
        R.grid.clear();
        for (let i = 0; i < R.enemies.length; i++) if (!R.enemies[i].dead) R.grid.insert(R.enemies[i]);
        G.spawner.update(R, sdt);
        G.enemies.update(R, sdt);
        G.weapons.update(R, sdt);
        G.combat.update(R, sdt);
        G.loot.update(R, sdt);
        G.progression.update(R, sdt);
        for (let i = R.props.length - 1; i >= 0; i--) { const p = R.props[i]; if (p.update && p.update(R, sdt, p) === false) R.props.splice(i, 1); }
        // combo decay
        if (R.combo > 0) { R.comboTimer -= sdt; if (R.comboTimer <= 0) R.combo = 0; }
        // compact dead enemies occasionally
        if ((R.enemies.length & 31) === 0 || R.enemies.length > G.cfg.maxEnemies) R.enemies = R.enemies.filter(e => !e.dead);
      }
      if (G.debug && G.debug.godMode) R.player.hp = Math.max(R.player.hp, 1);
      if (R.player.hp <= 0 && !R.over) api.end(false);
    },

    /** end the run; victory=true when the final boss is defeated */
    end(victory, reason) {
      const R = G.run; if (!R || R.over) return;
      R.over = true; R.victory = !!victory; R.endReason = reason || (victory ? 'clear' : 'defeat');
      const S = G.save.data;
      S.mora += Math.floor(R.mora);
      S.stats.runs++; S.stats.kills += R.kills; S.stats.totalMora += Math.floor(R.mora);
      if (victory) S.stats.clears++;
      S.stats.bestTime = Math.max(S.stats.bestTime, Math.floor(R.time));
      S.stats.bestKills = Math.max(S.stats.bestKills, R.kills);
      if (R.relicsFound) S.relics.unopened += R.relicsFound;
      G.save.write();
      G.bus.emit('runEnd', R);
    },
    /** leave the run and go back to the home screen (keeps mora already banked by end()) */
    leave() { G.run = null; G.fx.clear(); },
  };
  return api;
})();
