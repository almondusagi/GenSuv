/* debug.js — test helpers usable from the console or headless tests.
   G.debug.speed = N    run N simulation steps per step (fast-forward)
   G.debug.god(true)    invulnerable player
   G.debug.skip(sec)    jump the run clock forward (spawner events fire)
   G.debug.give(key,n)  grant upgrade levels;  G.debug.evo(key) grant an evolution
   G.debug.xp(n)        add XP;  G.debug.energy() fill burst energy
   G.debug.spawn(kind,n) spawn enemies around the player
   G.debug.autopick     automatically pick the first level-up option (for bots)
   --- added for the debug panel (js/debugpanel.js); all are no-ops unless called ---
   G.debug.jumpTo(sec, skipEvents=true)   set the run clock; skipped stage events do NOT fire (boss warnings too)
   G.debug.setSpeed(x)  0.25 / 0.5 / 1 / 2 / 4 (slow-motion runs each step with dt×x, fast-forward = extra steps)
   G.debug.setLevel(key, lv)  set an upgrade level directly (clamped to MAX, no cards / notices)
   G.debug.spawnBoss(kind, phase)  boss in front of the player; venti phase 1-3, ruin phase 2 = 暴走
   G.debug.bossAttack(e, atk)  make boss e start attack `atk` right now (uses G.enemyAI.seqs)
   G.debug.aiStop(on) / spawnStop(on)  freeze enemy AI / the stage director
   G.debug.killAll(withBoss)  kill every enemy (bosses too when withBoss)
   G.debug.evoCheck(R)  evolution conditions compared across every judge (see debugpanel 進化チェッカー) */
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

  /* ---------------- debug panel helpers ---------------- */
  jumpTo(sec, skipEvents) {
    const R = G.run; if (!R) return;
    sec = Math.max(0, +sec || 0);
    R.time = sec;
    const S = R.spawn, st = G.data.stages[R.stageId];
    if (S && st && skipEvents !== false) {
      let i = 0; while (i < st.events.length && st.events[i].time < sec) i++;
      S.evIdx = i; S.warned = {};
      for (const ev of st.events) if (ev.boss && ev.time <= sec + 0.01 && ev.time < sec) S.warned[ev.time] = true;
      if (S.finalPhase && sec < 600) S.finalPhase = false;
    }
    if (R.time < 180) R.earlyDone = false;
    G.player.refreshStats(R);
  },
  setSpeed(x) {
    x = +x || 1;
    this.slow = x < 1 ? x : 1;
    this.speed = x >= 1 ? Math.round(x) : 1;
    if (x < 1 && !G.game._dbgStep) { // wrap once: slow-motion = the same fixed step with a smaller dt
      const orig = G.game.step; G.game._dbgStep = orig;
      G.game.step = function (dt) { return orig.call(this, dt * (G.debug.slow || 1)); };
    }
  },
  setLevel(key, lv) {
    const R = G.run, up = G.upgrades[key]; if (!R || !up) return;
    lv = Math.max(0, Math.min(up.max, lv | 0));
    if (lv > 0) R.levels[key] = lv; else delete R.levels[key];
    if (up.cat === 'evo') { if (lv > 0) R.evolved[key] = true; else delete R.evolved[key]; }
    G.player.refreshStats(R);
  },
  spawnBoss(kind, phase) {
    const R = G.run; if (!R) return null; const p = R.player;
    const f = Math.hypot(p.face.x, p.face.y) > 0.1 ? p.face : { x: 0, y: -1 }, n = Math.hypot(f.x, f.y) || 1, d = kind === 'venti' ? 6.5 : 7.5;
    const e = G.enemies.spawn(R, kind, p.x + f.x / n * d, p.y + f.y / n * d * 0.8, { reward: kind === 'venti' ? 'luxurious' : 'precious' });
    if (!e) return null;
    phase = phase | 0;
    if (kind === 'venti' && phase >= 2) { e.phase = phase; e.hp = e.maxHp * (phase === 2 ? 0.55 : 0.2); }
    if (kind === 'ruin' && phase >= 2) e.hp = e.maxHp * 0.3; // below 35% → 暴走 on its next AI tick
    return e;
  },
  bossAttack(e, atk) {
    const R = G.run, seqs = G.enemyAI && G.enemyAI.seqs; if (!R || !e || e.dead || !seqs) return false;
    const ai = e.def.ai; let seq;
    if (ai === 'ruin') seq = seqs.ruin;
    else if (ai === 'venti') {
      if (seqs.venti[e.phase].indexOf(atk) < 0) { for (const ph of [1, 2, 3]) if (seqs.venti[ph].indexOf(atk) >= 0) { e.phase = ph; break; } }
      seq = seqs.venti[e.phase];
    } else return false;
    const i = seq.indexOf(atk); if (i < 0) return false;
    if (G.enemyAI.reset) G.enemyAI.reset(e);
    if (ai === 'venti' && atk === 'tornado') R.hazards = R.hazards.filter(h => h.type !== 'tornado'); // else it turns into 'storm'
    e.st = 'move'; e.stT = 0; e.cycle = i; e.cd = 0; e.spawnT = 0; e.invulnSpawn = false; e.frozenUntil = 0;
    const p = R.player, dx = e.x - p.x, dy = e.y - p.y, dist = Math.hypot(dx, dy);
    if (dist > 7.5 || !G.render.onScreen(e.x, e.y, -1.5)) { const a = dist > 0.1 ? Math.atan2(dy, dx) : -Math.PI / 2; e.x = p.x + Math.cos(a) * 6; e.y = p.y + Math.sin(a) * 4.5; }
    return true;
  },
  aiStop(on) {
    this.aiStopped = !!on;
    const A = G.enemyAI; if (!A || A._dbgWrapped) return;
    A._dbgWrapped = true; const Z = { x: 0, y: 0 };
    for (const k in A) {
      if (typeof A[k] !== 'function' || k === 'init' || k === 'reset' || k === 'drawExtra') continue;
      const f = A[k]; A[k] = function (R, e) { if (G.debug.aiStopped) { Z.x = 0; Z.y = 0; return Z; } return f.apply(this, arguments); };
    }
  },
  spawnStop(on) {
    this.spawnStopped = !!on;
    const S = G.spawner; if (!S || S._dbgWrapped) return;
    S._dbgWrapped = true; const f = S.update;
    S.update = function (R, dt) { if (G.debug.spawnStopped) return; return f.apply(this, arguments); };
  },
  killAll(withBoss) {
    const R = G.run; if (!R) return 0; let n = 0;
    for (const e of R.enemies.slice()) { if (e.dead || (e.boss && !withBoss)) continue; G.enemies.kill(R, e, 'debug'); n++; }
    R.hazards.length = 0;
    return n;
  },
  /** every evolution for this character, with each judge's answer.
      own = recomputed here from G.evolutions + G.upgrades[].max, badge = G.upgradeHelpers.evoLeft()==0 (level-up badge / build panel),
      chest = G.progression.evoReady() (what a chest actually gives), ready = G.upgrades[evo].ready() */
  evoCheck(R) {
    R = R || G.run; if (!R) return [];
    const out = [];
    const chestList = G.progression.evoReady(R);
    for (const e of G.evolutions) {
      const up = G.upgrades[e.key];
      if (up.char && up.char !== R.charId) continue;
      const mats = e.requires.map(k => { const u = G.upgrades[k]; const lv = R.levels[k] || 0; return { key: k, name: u ? u.name : k, lv, max: u ? u.max : 0, ok: !!u && lv >= u.max, cat: u && u.cat }; });
      const own = mats.every(m => m.ok);
      const evolved = !!R.evolved[e.key];
      const badge = G.upgradeHelpers.evoLeft(R, e) === 0;
      const chest = chestList.indexOf(e.key) >= 0;
      const ready = !!up.ready(R);
      const expectChest = own && !evolved;
      const match = badge === own && chest === expectChest && ready === expectChest;
      out.push({ key: e.key, name: up.name, mats, own, evolved, badge, chest, ready, match, left: G.upgradeHelpers.evoLeft(R, e) });
    }
    return out;
  },
};
