/* debug.js — test helpers usable from the console or headless tests.
   G.debug.speed = N    run N simulation steps per step (fast-forward)
   G.debug.god(true)    invulnerable player
   G.debug.skip(sec)    jump the run clock forward (spawner events fire)
   G.debug.give(key,n)  grant upgrade levels;  G.debug.evo(key) grant an evolution
   G.debug.xp(n)        add XP;  G.debug.energy() fill burst energy
   G.debug.spawn(kind,n) spawn enemies around the player
   G.debug.autopick     automatically pick the first level-up option (for bots) */
'use strict';
G.debug = {
  speed: 1, autopick: false, godMode: false,
  god(on) { this.godMode = on !== false; if (G.run) G.run.player.invuln = this.godMode ? 1e9 : 0; },
  skip(sec) { if (!G.run) return; G.run.time += sec; },
  give(key, n) { if (!G.run) return; for (let i = 0; i < (n || 1); i++) G.progression.apply(G.run, key); },
  evo(key) { if (!G.run) return; G.run.evolved[key] = true; G.run.levels[key] = 1; G.player.refreshStats(G.run); G.bus.emit('evolution', { key }); },
  xp(n) { if (G.run) G.progression.addXp(G.run, n); },
  energy() { if (G.run) G.run.player.energy = G.run.char.energyCost; },
  spawn(kind, n) { if (!G.run) return; const p = G.run.player; for (let i = 0; i < (n || 1); i++) { const a = Math.random() * 6.28; G.enemies.spawn(G.run, kind, p.x + Math.cos(a) * 8, p.y + Math.sin(a) * 8); } },
  state() { const R = G.run; if (!R) return { scene: G.scene }; return { t: +R.time.toFixed(1), lv: R.player.level, hp: Math.round(R.player.hp), kills: R.kills, enemies: R.enemies.filter(e => !e.dead).length, fps: Math.round(G.fps), levels: R.levels, evolved: R.evolved, over: R.over, victory: R.victory, dmg: R.damageBySrc }; },
};
