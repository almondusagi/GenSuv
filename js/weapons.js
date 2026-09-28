/* weapons.js — player attack framework: character kits (normal / skill / burst), Timaeus launchers,
   player projectiles and player-owned fields. Kits live in amber.js (etc.), launchers in launchers.js.
   Projectile: {x,y,vx,vy,life,r,mul,element,gauge,pierce,hits:[ids],src,sprite,size,trail,knock,noHit,
                update(R,dt,p), onHit(R,p,e), onEnd(R,p,hitEnd), draw(ctx,p), drawGround(ctx,p)}
   Field:      {x,y,r,life,t,tick,next,update(R,dt,f),onTick(R,f),onEnd(R,f),draw(ctx,f),ground:true|false,minor}
   Helpers:    lob(R,{x,y,tx,ty,time,height,sprite,size,spin,onLand,glow,smoke}) — arcing thrown object
               boom(R,x,y,r,{color,life}) — light-weight sprite explosion visual (no damage)
               launcherCd(R, base) — cooldown for launchers scaled by haste / cdr
               cluster(R,x,y,range,rr) — enemy with most neighbours (good throw target) */
'use strict';
G.weapons = (function () {
  const U = G.u;
  const kits = {};       // charId -> { update(R,dt), skill(R), burst(R), skillCd?(R) }
  const launchers = {};  // key -> { update(R,dt,lv) }
  const MAX_PROJ = 300, MAX_FIELDS = 140;

  function initRun(R) { R.projectiles = []; R.fields = []; R.wstate = { evoFresh: {} }; }
  /* first activation after an evolution gets a special, extra-loud moment */
  G.bus.on('evolution', d => { const R = G.run; if (R && d && d.key) { (R.wstate.evoFresh || (R.wstate.evoFresh = {}))[d.key] = true; } });
  /** true exactly once: the first time an evolved weapon fires after being obtained */
  function evoFirst(R, key) { const f = R.wstate.evoFresh; if (f && f[key]) { f[key] = false; return true; } return false; }
  /** fanfare for that first activation: slow-mo, flash, ring, big name text */
  function evoFanfare(R, x, y, color, r, key) {
    G.fx.slowmo(0.25, 0.45); G.fx.flash && G.fx.flash(color, 0.35); G.fx.zoomPunch && G.fx.zoomPunch(0.07); G.fx.shake(0.9);
    G.fx.ring && G.fx.ring(x, y, r || 6, color);
    G.fx.sparkle && G.fx.sparkle(x, y - 1, '#fff3c4', 24, 2);
    G.fx.pillar && G.fx.pillar(x, y, color, 10, 2.4, 1);
    if (key) G.fx.reactionText && G.fx.reactionText(x, y - 3, evoName(key) + '！', '#fff0b0');
    G.audio.sfx('bigExplosion', { x, y });
  }
  function evoName(key) { const u = G.upgrades && G.upgrades[key]; return u ? u.name : '進化'; }
  const reduced = () => !!(G.save && G.save.data.settings.reducedFx);

  function fire(R, p) {
    p.t = 0; if (!p.hits) p.hits = []; p.pierce = p.pierce || 0; p.r = p.r || 0.3; p.life = p.life || 1.2;
    p.vx = p.vx || 0; p.vy = p.vy || 0;
    if (R.projectiles.length >= MAX_PROJ) {
      // drop the oldest plain projectile (never one with a pending onEnd like a thrown bomb)
      let i = -1; for (let k = 0; k < R.projectiles.length; k++) if (!R.projectiles[k].onEnd) { i = k; break; }
      if (i >= 0) R.projectiles.splice(i, 1); else return p;
    }
    R.projectiles.push(p); return p;
  }
  function field(R, f) {
    f.t = 0; f.next = f.next != null ? f.next : 0;
    if (R.fields.length >= MAX_FIELDS) {
      let i = -1; for (let k = 0; k < R.fields.length; k++) if (R.fields[k].minor) { i = k; break; }
      if (i >= 0) R.fields.splice(i, 1); else if (f.minor) return f;
    }
    R.fields.push(f); return f;
  }

  /* ---- swept projectile collision without per-step closure allocation ---- */
  let cP = null, cR = null, cDead = false;
  function hasHit(p, id) { const h = p.hits; if (h.has) return h.has(id); for (let i = 0; i < h.length; i++) if (h[i] === id) return true; return false; }
  function addHit(p, id) { if (p.hits.add) p.hits.add(id); else p.hits.push(id); }
  function collide(e) {
    const p = cP;
    if (e.spawnT > 0.25 || hasHit(p, e.id)) return;
    addHit(p, e.id);
    if (p.onHit) p.onHit(cR, p, e);
    else G.combat.hit(cR, e, { mul: p.mul, element: p.element, gauge: p.gauge, src: p.src, knock: p.knock || 0.4, kx: p.dx, ky: p.dy });
    if (p.pierce-- <= 0) { cDead = true; return true; }
  }

  function update(R, dt) {
    const kit = kits[R.charId]; if (kit) kit.update(R, dt);
    for (const key in launchers) { const lv = R.levels[key] || 0; if (lv > 0) launchers[key].update(R, dt, lv); }
    // projectiles (swept circle vs grid)
    const P = R.projectiles;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; if (!p) continue;
      p.t += dt;
      if (p.update) p.update(R, dt, p);
      let dead = false;
      if (p.noHit) { p.x += p.vx * dt; p.y += p.vy * dt; }
      else {
        const sp = Math.hypot(p.vx, p.vy), steps = Math.max(1, Math.ceil(sp * dt / 0.35));
        p.dx = sp > 0 ? p.vx / sp : 0; p.dy = sp > 0 ? p.vy / sp : 0;
        cP = p; cR = R; cDead = false;
        for (let s = 0; s < steps && !cDead; s++) {
          p.x += p.vx * dt / steps; p.y += p.vy * dt / steps;
          R.grid.query(p.x, p.y, p.r, collide);
        }
        dead = cDead; cP = null;
      }
      if (dead || p.t >= p.life || p.kill) {
        const j = P[i] === p ? i : P.indexOf(p); if (j >= 0) P.splice(j, 1);
        p.onEnd && p.onEnd(R, p, dead);
      }
    }
    // fields
    const F = R.fields;
    for (let i = F.length - 1; i >= 0; i--) {
      const f = F[i]; if (!f) continue;
      f.t += dt;
      if (f.update) f.update(R, dt, f);
      if (f.tick && f.t >= f.next) { f.next += f.tick; f.onTick && f.onTick(R, f); }
      if (f.t >= f.life || f.kill) { const j = F[i] === f ? i : F.indexOf(f); if (j >= 0) F.splice(j, 1); f.onEnd && f.onEnd(R, f); }
    }
  }

  function trySkill(R) {
    const p = R.player, kit = kits[R.charId]; if (!kit) return false;
    if (p.skillCd > 0) { G.audio.sfx('denied'); return false; }
    if (kit.skill(R) === false) { G.audio.sfx('denied'); return false; }
    p.skillCd = kit.skillCd ? kit.skillCd(R) : R.char.skillCd;
    G.bus.emit('skill', R.charId);
    return true;
  }
  function tryBurst(R) {
    const p = R.player, kit = kits[R.charId]; if (!kit) return false;
    if (p.energy < R.char.energyCost || p.burstCd > 0) { G.audio.sfx('denied'); return false; }
    p.energy = 0; p.burstCd = R.char.burstCd;
    G.bus.emit('burst', R.charId);
    kit.burst(R);
    return true;
  }

  /* ---------------- drawing ---------------- */
  function drawGround(ctx) {
    const R = G.run; if (!R) return;
    for (const f of R.fields) if (f.ground !== false && f.draw) f.draw(ctx, f);
    for (const p of R.projectiles) if (p.drawGround) p.drawGround(ctx, p);
  }
  function drawAir(ctx) {
    const R = G.run; if (!R) return;
    for (const p of R.projectiles) {
      if (p.draw) { p.draw(ctx, p); continue; }
      if (p.trail) {
        ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.6;
        ctx.drawImage(G.assets.glow(p.trail, 32), p.x - 0.6, p.y - 0.6 - 0.9, 1.2, 1.2);
        ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
      }
      if (p.sprite) G.render.icon(ctx, p.sprite, p.x, p.y - 0.9, p.size || 1, Math.atan2(p.vy, p.vx));
    }
    for (const f of R.fields) if (f.ground === false && f.draw) f.draw(ctx, f);
  }

  /* nearest targets helper: returns up to n enemies sorted by distance within range */
  const nbuf = [];
  function nearestN(R, x, y, range, n) {
    nbuf.length = 0;
    R.grid.query(x, y, range, e => { if (!(e.spawnT > 0.2)) { e._d2 = (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y); nbuf.push(e); } });
    nbuf.sort((a, b) => a._d2 - b._d2);
    const out = nbuf.slice(0, n); nbuf.length = 0; return out;
  }
  /** best cluster centre among nearby enemies: the enemy with most neighbours within rr (elites/bosses weigh more) */
  function cluster(R, x, y, range, rr, exclude) {
    const cand = nearestN(R, x, y, range, 16);
    let best = null, bc = -1;
    for (const e of cand) {
      if (exclude && exclude.indexOf(e) >= 0) continue;
      let c = 0; R.grid.query(e.x, e.y, rr, () => { c++; });
      c += (e.elite || e.boss ? 4 : 0) - U.dist(e.x, e.y, x, y) * 0.05;
      if (c > bc) { bc = c; best = e; }
    }
    return best;
  }

  /** thrown object on a parabolic arc. o: {x,y,tx,ty,time,height,sprite,size,spin,onLand(R,o,x,y),glow,smoke} */
  function lob(R, o) {
    const T = o.time || 0.6;
    return fire(R, {
      x: o.x, y: o.y, vx: (o.tx - o.x) / T, vy: (o.ty - o.y) / T, life: T, noHit: true, z: 0,
      update(R2, dt, p) {
        p.z = Math.sin(Math.min(1, p.t / T) * Math.PI) * (o.height || 2.5);
        if (o.smoke && !reduced() && U.chance(0.4)) G.fx.particle({ x: p.x, y: p.y - p.z - 0.5, vx: U.rand(-0.4, 0.4), vy: U.rand(-0.8, -0.2), life: 0.4, size: 0.1, color: o.smoke, glow: true });
      },
      onEnd(R2, p) { o.onLand && o.onLand(R2, o, o.tx, o.ty); },
      drawGround(ctx, p) { const k = Math.min(1, p.t / T); G.render.shadow(ctx, p.x, p.y, 0.3 + 0.2 * (1 - Math.sin(k * Math.PI)), 0.25); },
      draw(ctx, p) {
        const z = p.z || 0, s = o.size || 1;
        if (o.glow) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.55; ctx.drawImage(G.assets.glow(o.glow, 64), p.x - s, p.y - z - 0.5 - s, s * 2, s * 2); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; }
        G.render.icon(ctx, o.sprite, p.x, p.y - z - 0.5, s, (o.spin || 0) * p.t);
      },
    });
  }

  /** sprite-sheet explosion visual (fx_explosion.webp, 8 frames) + additive glow; purely cosmetic */
  function boom(R, x, y, r, o) {
    o = o || {};
    const life = o.life || 0.42, color = o.color || '#ff8a3d';
    // prefer the VFX pooled light blast (no field allocation, matches G.fx.explosion's look)
    if (G.fx && G.fx.boom) { G.fx.boom(x, y, r, { color, kind: o.kind || 'small', life }); return null; }
    return field(R, {
      x, y, r, life, ground: false, minor: true,
      draw(ctx, f) {
        const k = f.t / f.life, im = G.assets.img.fx_explosion;
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = Math.max(0, 1 - k) * 0.9;
        const g = r * (1.1 + k * 0.6);
        ctx.drawImage(G.assets.glow(color, 64), x - g, y - g * 0.8 - r * 0.2, g * 2, g * 1.6);
        ctx.globalCompositeOperation = 'source-over';
        if (im) {
          const fr = Math.min(7, Math.floor(k * 8)), cw = im.width / 4, ch = im.height / 2;
          const s = r * 2.3;
          ctx.globalAlpha = k > 0.75 ? (1 - k) / 0.25 : 1;
          ctx.drawImage(im, (fr % 4) * cw, Math.floor(fr / 4) * ch, cw, ch, x - s / 2, y - s * 0.62, s, s);
        }
        ctx.globalAlpha = 1;
      },
    });
  }

  function launcherCd(R, base) {
    const S = R.stats;
    return base / Math.max(0.3, S.haste || 1) * Math.max(0.35, 1 - (S.cdr || 0));
  }

  return { kits, launchers, evoFirst, evoFanfare, evoName, initRun, update, fire, field, trySkill, tryBurst, drawGround, drawAir, nearestN, cluster, lob, boom, launcherCd, reduced };
})();
