/* barrier.js — generic player-made walls (owner: NINGGUANG; used by 凝光の璇璣屏, free for any kit).
   A barrier is a thick line segment on the ground:
     b = { x, y (centre), ux, uy (unit vector ALONG the wall), half (half length), th (half thickness),
           until (R.time when it disappears) | dead, slow (0..1: elite/boss movement multiplier while inside; default 0.3),
           blockHazards (default true), onBlock(R,b,h) (enemy projectile stopped), onPass(R,b,e) (elite/boss slowed),
           hitT (R.time of the last block, for drawing) }
   Rules: normal enemies can NOT cross (they slide along it / walk around the ends); elites and bosses pass through
   but are slowed while inside; enemy projectiles (arrow/orb/bullet/wind/projectile) and thrown rocks are stopped;
   the player is never affected. Ground zones / beams / shockwaves are not blocked.
   Hooks (optional, no-ops when R.barriers is empty): enemies.js calls G.barrier.enemy(R,e,x0,y0) after an enemy moved,
   and G.barrier.hazard(R,h,x0,y0) after a hazard moved. No allocations in the hot path. */
'use strict';
G.barrier = (function () {
  const BLOCK_H = { arrow: 1, orb: 1, bullet: 1, wind: 1, projectile: 1, rock: 1 };
  function add(R, b) {
    if (!R.barriers) R.barriers = [];
    if (b.slow == null) b.slow = 0.3;
    if (b.blockHazards == null) b.blockHazards = true;
    b.hitT = -9; b.dead = false;
    R.barriers.push(b); return b;
  }
  function alive(R, b) { return !b.dead && (b.until == null || R.time < b.until); }
  /** drop expired barriers (call once per frame from any kit, cheap) */
  function prune(R) {
    const B = R.barriers; if (!B) return;
    for (let i = B.length - 1; i >= 0; i--) if (!alive(R, B[i])) { B[i] = B[B.length - 1]; B.pop(); }
  }
  /** along / side coordinates of a point (side > 0 = the side the normal (-uy, ux) points to) */
  let LA = 0, LS = 0;
  function local(b, x, y) { const dx = x - b.x, dy = y - b.y; LA = dx * b.ux + dy * b.uy; LS = -dx * b.uy + dy * b.ux; }

  function enemy(R, e, x0, y0) {
    const B = R.barriers; if (!B || !B.length) return;
    const mx = e.x - x0, my = e.y - y0;
    if (mx * mx + my * my > 6.25) return;           // teleports / respawn jumps are not walls' business
    const big = !!(e.elite || e.boss);
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (!alive(R, b)) continue;
      local(b, x0, y0); const s0 = LS;
      local(b, e.x, e.y); const a1 = LA, s1 = LS;
      const lim = b.th + e.r * 0.75;
      if (Math.abs(a1) > b.half + e.r * 0.35) continue;
      const crossed = (s0 > 0) !== (s1 > 0) && Math.abs(s0 - s1) > 1e-6;
      if (!crossed && Math.abs(s1) >= lim) continue;
      if (big) {
        // elites / bosses: allowed through, but the whole step is shortened while touching the wall
        const k = b.slow;
        e.x = x0 + (e.x - x0) * k; e.y = y0 + (e.y - y0) * k;
        b.passT = R.time;
        b.onPass && b.onPass(R, b, e);
        return;
      }
      // normal enemies: keep them on the side they came from (only the normal component is corrected → they slide)
      const side = Math.abs(s0) > 1e-4 ? (s0 > 0 ? 1 : -1) : (s1 >= 0 ? 1 : -1);
      const want = side * lim, d = want - s1;
      e.x += -b.uy * d; e.y += b.ux * d;
      if (e.kx || e.ky) { const kn = -e.kx * b.uy + e.ky * b.ux; if (kn * side < 0) { e.kx += b.uy * kn; e.ky -= b.ux * kn; } }
    }
  }

  function hazard(R, h, x0, y0) {
    const B = R.barriers; if (!B || !B.length || h.done || !BLOCK_H[h.type] || h.t < h.delay) return;
    const hr = h.r || 0.3;
    for (let i = 0; i < B.length; i++) {
      const b = B[i]; if (!b.blockHazards || !alive(R, b)) continue;
      local(b, x0, y0); const s0 = LS;
      local(b, h.x, h.y); const a1 = LA, s1 = LS;
      if (Math.abs(a1) > b.half + hr * 0.5) continue;
      const crossed = (s0 > 0) !== (s1 > 0);
      if (!crossed && Math.abs(s1) >= b.th + hr) continue;
      h.done = true; h.dmg = 0; h.blocked = true;
      b.hitT = R.time;
      b.onBlock && b.onBlock(R, b, h);
      return;
    }
  }

  /** is a point inside any barrier strip? (optional helper for kits) → barrier or null */
  function at(R, x, y, pad) {
    const B = R.barriers; if (!B) return null;
    for (let i = 0; i < B.length; i++) { const b = B[i]; if (!alive(R, b)) continue; local(b, x, y); if (Math.abs(LA) <= b.half && Math.abs(LS) <= b.th + (pad || 0)) return b; }
    return null;
  }
  /** did the segment (x0,y0)→(x1,y1) cross barrier b? */
  function crosses(b, x0, y0, x1, y1) {
    local(b, x0, y0); const s0 = LS; local(b, x1, y1);
    return (s0 > 0) !== (LS > 0) && Math.abs(LA) <= b.half;
  }

  G.bus.on('runStart', R => { if (R) R.barriers = []; });
  return { add, prune, alive, enemy, hazard, at, crosses };
})();
