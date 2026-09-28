/* core.js — global namespace, utilities, event bus, save data, assets, spatial grid.
   Classic script (no modules) so the game runs from file:// by double-click. */
'use strict';
var G = window.G = window.G || {};

G.VERSION = '2.0.0-web';
G.cfg = {
  step: 1 / 60,            // fixed simulation step
  enemyHpMul: 2,           // global enemy HP multiplier (owner request 2026-09-27: x2)
  enemyDmgMul: 3,          // global enemy attack multiplier (owner request 2026-09-27: x3)
  viewUnits: 17,           // world units visible vertically at zoom 1 (landscape)
  runDuration: 600,        // 10 minutes
  maxEnemies: 320,
  maxParticles: 1800,
  maxNumbers: 90,
  despawnDist: 34,         // enemies further than this from the player get recycled
  spawnRing: [15.5, 19],   // spawn distance band (units)
};

/* ---------------- utilities ---------------- */
G.u = (function () {
  const TAU = Math.PI * 2;
  let seed = (Math.random() * 2 ** 31) | 0;
  function rnd() { // mulberry32 (seedable for tests)
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  return {
    TAU,
    seed(s) { seed = s | 0; },
    rnd,
    rand(a, b) { return a + (b - a) * rnd(); },
    randi(a, b) { return Math.floor(a + (b - a + 1) * rnd()); },
    chance(p) { return rnd() < p; },
    pick(arr) { return arr[Math.floor(rnd() * arr.length)]; },
    weighted(list, wKey) { // list of objects with weight property (or [item, w] pairs)
      let tot = 0; for (const it of list) tot += (wKey ? it[wKey] : it[1]);
      let r = rnd() * tot;
      for (const it of list) { r -= (wKey ? it[wKey] : it[1]); if (r <= 0) return wKey ? it : it[0]; }
      return wKey ? list[list.length - 1] : list[list.length - 1][0];
    },
    shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; },
    clamp(v, a, b) { return v < a ? a : v > b ? b : v; },
    lerp(a, b, t) { return a + (b - a) * t; },
    invLerp(a, b, v) { return (v - a) / (b - a); },
    approach(v, target, d) { return v < target ? Math.min(target, v + d) : Math.max(target, v - d); },
    dist(ax, ay, bx, by) { const x = ax - bx, y = ay - by; return Math.sqrt(x * x + y * y); },
    dist2(ax, ay, bx, by) { const x = ax - bx, y = ay - by; return x * x + y * y; },
    angle(ax, ay, bx, by) { return Math.atan2(by - ay, bx - ax); },
    norm(x, y) { const l = Math.sqrt(x * x + y * y) || 1; return { x: x / l, y: y / l }; },
    angDiff(a, b) { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; },
    ease: {
      outCubic: t => 1 - Math.pow(1 - t, 3),
      inCubic: t => t * t * t,
      outQuad: t => 1 - (1 - t) * (1 - t),
      inOutSine: t => -(Math.cos(Math.PI * t) - 1) / 2,
      outBack: t => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
      outElastic: t => t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * (TAU / 3)) + 1,
      outExpo: t => t === 1 ? 1 : 1 - Math.pow(2, -10 * t),
    },
    fmtTime(s) { s = Math.max(0, Math.floor(s)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); },
    fmtNum(n) { return Math.round(n).toLocaleString('ja-JP'); },
  };
})();

/* ---------------- event bus ---------------- */
G.bus = (function () {
  const map = new Map();
  return {
    on(evt, fn) { if (!map.has(evt)) map.set(evt, []); map.get(evt).push(fn); return () => this.off(evt, fn); },
    off(evt, fn) { const l = map.get(evt); if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } },
    emit(evt, data) {
      const l = map.get(evt); if (!l) return;
      for (let i = 0; i < l.length; i++) { try { l[i](data); } catch (e) { console.error('[bus]', evt, e); } }
    },
  };
})();

/* ---------------- element colours (shared by every module) ---------------- */
G.EL = {
  pyro:    { name: '炎', color: '#ff7a3d', light: '#ffc07a', dark: '#b3261e' },
  hydro:   { name: '水', color: '#3fa9ff', light: '#9fd6ff', dark: '#1456b8' },
  cryo:    { name: '氷', color: '#9ff0ff', light: '#e6fdff', dark: '#3fb6d6' },
  electro: { name: '雷', color: '#c77dff', light: '#ecc9ff', dark: '#7a2fd6' },
  anemo:   { name: '風', color: '#5cf2c8', light: '#c2fff0', dark: '#1a9e83' },
  geo:     { name: '岩', color: '#ffd24a', light: '#fff0a8', dark: '#b8860b' },
  physical:{ name: '物理', color: '#ffffff', light: '#ffffff', dark: '#9aa0a6' },
};

/* ---------------- save data (localStorage, defensive) ---------------- */
G.save = (function () {
  const KEY = 'mondo_survivor_save_v2';
  function defaults() {
    return {
      version: 2,
      mora: 0,
      meta: {},            // permanent upgrade levels  { key: level }
      unlocks: {},         // e.g. { amber_skill: true }
      relics: { unopened: 0, owned: [], equipped: {} },
      stats: { runs: 0, clears: 0, kills: 0, bestTime: 0, bestKills: 0, totalMora: 0 },
      settings: {
        sfx: true, bgm: true, sfxVolume: 0.8, bgmVolume: 0.6,
        reducedFx: false, screenShake: 1, damageNumbers: true, showFps: false,
        touchControls: 'auto',  // auto | on | off
      },
      tutorialSeen: false,
    };
  }
  let data = defaults();
  function deepMerge(base, src) {
    for (const k in src) {
      if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && base[k] && typeof base[k] === 'object') deepMerge(base[k], src[k]);
      else base[k] = src[k];
    }
    return base;
  }
  return {
    get data() { return data; },
    load() {
      try { const raw = localStorage.getItem(KEY); if (raw) data = deepMerge(defaults(), JSON.parse(raw)); }
      catch (e) { console.warn('save load failed', e); data = defaults(); }
      return data;
    },
    write() { try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch (e) { return false; } },
    reset() { data = defaults(); this.write(); G.bus.emit('saveReset'); return data; },
    defaults,
  };
})();

/* ---------------- assets ---------------- */
G.assets = (function () {
  const img = {};
  const white = {};        // white silhouettes of actor atlases for hit flashes
  const tinted = {};       // tinted variants  key: name|filter
  const actors = {         // atlas layout: rows = down,left,right,up ; cols = idle2, walk2, attack2, (skill2)
    amber: { cols: 8, cell: 160 }, archer: { cols: 6, cell: 160 }, brute: { cols: 6, cell: 160 },
    hilichurl: { cols: 6, cell: 160 }, ruin: { cols: 6, cell: 160 }, shaman: { cols: 6, cell: 160 },
    slime: { cols: 6, cell: 160 }, venti: { cols: 6, cell: 160 },
    // owner-supplied 4-direction sheets (tools/build_pack.py)
    xingqiu: { cols: 8, cell: 160 }, ningguang: { cols: 8, cell: 160 }, chongyun: { cols: 8, cell: 160 },
  };
  const list = [];
  for (const a in actors) list.push(['actor_' + a, 'assets/actor_' + a + '.webp']);
  ['amber', 'amber_arrow', 'archer', 'bomb', 'bottle', 'brute', 'bunny', 'chest', 'chicken', 'chongyun', 'crystal', 'feast',
    'hilichurl', 'lightning', 'mora', 'ningguang', 'rain', 'relic', 'rock', 'ruin', 'shaman', 'slime', 'snow', 'venti', 'wind',
    'xingqiu', 'feather', 'vfx_auras', 'vfx_status', 'enemy_aura', 'vfx_embers', 'vfx_water', 'vfx_wind']
    .forEach(n => list.push(['icon_' + n, 'assets/icon_' + n + '.webp']));
  list.push(['fx_explosion', 'assets/fx_explosion.webp'], ['cutin_amber', 'assets/cutin_amber.webp'],
    ['cutin_xingqiu', 'assets/cutin_xingqiu.webp'], ['cutin_ningguang', 'assets/cutin_ningguang.webp'], ['cutin_chongyun', 'assets/cutin_chongyun.webp'],
    ['skillfx_xingqiu', 'assets/skillfx_xingqiu.webp'], ['skillfx_ningguang', 'assets/skillfx_ningguang.webp'], ['skillfx_chongyun', 'assets/skillfx_chongyun.webp'],
    ['paimon_flight', 'assets/paimon_flight.webp'],
    ['title_bg', 'assets/title_bg.webp'], ['floor', 'assets/floor.webp']);

  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

  return {
    img, white, actors, makeCanvas,
    load(onProgress) {
      let done = 0;
      return Promise.all(list.map(([name, src]) => new Promise(res => {
        const im = new Image();
        im.onload = () => { img[name] = im; done++; onProgress && onProgress(done / list.length); res(); };
        im.onerror = () => { console.warn('asset failed', src); done++; onProgress && onProgress(done / list.length); res(); };
        im.src = src;
      }))).then(() => this.prepare());
    },
    prepare() {
      // white silhouettes (hit flash). Drawing onto a canvas is allowed even from file:// (no pixel reads).
      for (const a in actors) {
        const src = img['actor_' + a]; if (!src) continue;
        const c = makeCanvas(src.width, src.height), x = c.getContext('2d');
        x.drawImage(src, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
        white[a] = c;
      }
    },
    /** tinted copy of an image using ctx.filter (e.g. 'hue-rotate(200deg)'); falls back to original when unsupported */
    tinted(name, filter) {
      const key = name + '|' + filter;
      if (tinted[key]) return tinted[key];
      const src = img[name]; if (!src) return null;
      const c = makeCanvas(src.width, src.height), x = c.getContext('2d');
      if ('filter' in x) x.filter = filter;
      x.drawImage(src, 0, 0);
      tinted[key] = c; return c;
    },
    /** glow sprite cache: radial gradient discs used for additive lighting */
    glow(color, size) {
      const key = 'glow|' + color + '|' + size;
      if (tinted[key]) return tinted[key];
      const c = makeCanvas(size, size), x = c.getContext('2d');
      const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, color); g.addColorStop(0.35, color.length === 7 ? color + '88' : color); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; x.fillRect(0, 0, size, size);
      tinted[key] = c; return c;
    },
  };
})();

/* ---------------- spatial hash for enemies ---------------- */
G.Grid = function (cell) {
  this.cell = cell || 2.5; this.map = new Map();
};
G.Grid.prototype.clear = function () { this.map.clear(); };
G.Grid.prototype.key = function (cx, cy) { return (cx + 4096) * 8192 + (cy + 4096); };
G.Grid.prototype.insert = function (o) {
  const k = this.key(Math.floor(o.x / this.cell), Math.floor(o.y / this.cell));
  let b = this.map.get(k); if (!b) { b = []; this.map.set(k, b); } b.push(o);
};
/** calls fn(o) for every object whose centre is within r (+ its own radius) of (x,y). return true from fn to stop. */
G.Grid.prototype.query = function (x, y, r, fn) {
  const c = this.cell, x0 = Math.floor((x - r - 2) / c), x1 = Math.floor((x + r + 2) / c), y0 = Math.floor((y - r - 2) / c), y1 = Math.floor((y + r + 2) / c);
  for (let cx = x0; cx <= x1; cx++) for (let cy = y0; cy <= y1; cy++) {
    const b = this.map.get(this.key(cx, cy)); if (!b) continue;
    for (let i = 0; i < b.length; i++) {
      const o = b[i]; if (o.dead) continue;
      const dx = o.x - x, dy = o.y - y, rr = r + (o.r || 0);
      if (dx * dx + dy * dy <= rr * rr) { if (fn(o) === true) return; }
    }
  }
};
/** nearest living object to (x,y) within maxR, optional filter */
G.Grid.prototype.nearest = function (x, y, maxR, filter) {
  let best = null, bd = maxR * maxR;
  this.query(x, y, maxR, o => { if (filter && !filter(o)) return; const d = (o.x - x) ** 2 + (o.y - y) ** 2; if (d < bd) { bd = d; best = o; } });
  return best;
};
