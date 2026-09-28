/* audio.js — WebAudio synthesiser. Every SFX and every piece of music is generated in code at runtime
   (original compositions, no audio files, no Genshin/HoYoverse melodies).
   API (CONTRACT): G.audio.init() (first user gesture), sfx(name, opts), bgm(track|null), applySettings(), duck(amount, time)
   opts for sfx: {x,y} world position → stereo pan + distance attenuation, vol, pitch, rarity (chestReveal), type (reaction), combo (comboUp)
   Debug: G.audio._renderTest(what, seconds, {intensity}) → Promise<{rms,peak,clip,db}>  (what = track name or 'sfx:name')
          G.audio._renderWav(what, seconds, opts) → Promise<base64 WAV>, G.audio.state() */
'use strict';
G.audio = (function () {
  const AC = window.AudioContext || window.webkitAudioContext;
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const rr = (a, b) => a + Math.random() * (b - a);
  const cl = (v, a, b) => v < a ? a : v > b ? b : v;
  const pick = a => a[(Math.random() * a.length) | 0];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  let NYQ = 19000;                                   // safe ceiling for any oscillator/filter frequency (updated per context)
  const fq = x => !(x > 1) ? 1 : x > NYQ ? NYQ : x;  // central clamp: also catches NaN / ≤0
  const DEF_SETTINGS = { sfx: true, bgm: true, sfxVolume: 0.8, bgmVolume: 0.6 };
  const settings = () => (G.save && G.save.data && G.save.data.settings) || DEF_SETTINGS;

  // lighter mix on phones/tablets (coarse pointer or mobile UA): fewer SFX voices, top music layers capped
  const LITE = (function () { try { return (window.matchMedia && matchMedia('(pointer: coarse)').matches) || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent); } catch (e) { return false; } })();
  const MAX_VOICES = LITE ? 16 : 24;
  let ctx = null, A = null, timer = 0, wantTrack = null, cur = null, pausedFx = false, hiddenSuspended = false;

  /* =====================================================================================
     BUFFERS — noise, Karplus-Strong plucks, drum kit, reverb impulses (computed once per sample-rate)
     ===================================================================================== */
  const BUFS = {};
  function ks(d, sr, f, m) {
    const N = Math.max(2, Math.round(sr / f)), buf = new Float32Array(N);
    let mean = 0; for (let i = 0; i < N; i++) { buf[i] = Math.random() * 2 - 1; mean += buf[i]; } mean /= N;
    let p = 0; const soft = m < 50 ? 0.4 : m < 62 ? 0.7 : 0.85;
    for (let i = 0; i < N; i++) { p += (buf[i] - mean - p) * soft; buf[i] = p; }
    const target = m < 46 ? 0.5 : m < 58 ? 0.4 : m < 70 ? 0.3 : 0.2;   // amplitude left after 1 s
    const decay = Math.pow(target, 1 / f);
    let idx = 0, peak = 0;
    for (let i = 0; i < d.length; i++) {
      const a = buf[idx], b = buf[idx + 1 < N ? idx + 1 : 0];
      buf[idx] = (a + b) * 0.5 * decay; d[i] = a; idx = idx + 1 < N ? idx + 1 : 0;
      const q = a < 0 ? -a : a; if (q > peak) peak = q;
    }
    const k = 0.85 / (peak || 1); for (let i = 0; i < d.length; i++) d[i] *= k;
    for (let i = 0; i < 32 && i < d.length; i++) d[i] *= i / 32;
  }
  function impulse(d, sr, sec, bright, ch) {
    const n = d.length, pre = Math.floor(0.014 * sr); let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, env = Math.exp(-6.9 * t / sec);
      const x = (Math.random() * 2 - 1) * env;
      const k = cl(2 * Math.PI * bright * Math.exp(-t * 1.6) / sr, 0.015, 1);
      y += (x - y) * k; d[i] = i < pre ? 0 : y;
    }
    for (let e = 0; e < 8; e++) { const idx = pre + Math.floor((0.004 + Math.random() * 0.07 + ch * 0.003) * sr); if (idx < n) d[idx] += (Math.random() - 0.5) * 0.35 * Math.exp(-e * 0.2); }
  }
  function buffers(c) {
    const sr = c.sampleRate; if (BUFS[sr]) return BUFS[sr];
    const B = {}, TAU = Math.PI * 2;
    const mk = (sec, chs, fill) => { const n = Math.max(1, Math.floor(sec * sr)); const b = c.createBuffer(chs, n, sr); for (let ch = 0; ch < chs; ch++) fill(b.getChannelData(ch), sr, ch); return b; };
    B.white = mk(2, 1, d => { for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; });
    B.pink = mk(2, 1, d => {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < d.length; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.16; b6 = w * 0.115926;
      }
    });
    B.brown = mk(2, 1, d => { let l = 0; for (let i = 0; i < d.length; i++) { l = (l + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = l * 3.5; } });
    B.plBase = [40, 52, 64, 76];
    B.pl = B.plBase.map(m => mk(3.2, 1, (d, s) => ks(d, s, mtof(m), m)));
    B.irS = mk(1.5, 2, (d, s, ch) => impulse(d, s, 1.5, 5200, ch));
    B.irL = mk(3.2, 2, (d, s, ch) => impulse(d, s, 3.2, 4200, ch));
    // --- drum kit (synthesised offline into buffers so a hit costs just 2 nodes) ---
    const drum = (sec, fn) => mk(sec, 1, (d, s) => { const st = { ph: 0, ph2: 0, a: 0, b: 0 }; for (let i = 0; i < d.length; i++) d[i] = fn(i / s, st, s); });
    const nz = () => Math.random() * 2 - 1;
    B.kick = drum(0.5, (t, s, r) => { s.ph += TAU * (46 + 120 * Math.exp(-t * 30)) / r; let v = Math.tanh(Math.sin(s.ph) * Math.exp(-t * 8) * 1.8) * 0.6; if (t < 0.004) v += nz() * 0.45 * (1 - t / 0.004); return v; });
    B.snare = drum(0.35, (t, s, r) => { s.ph += TAU * (180 + 50 * Math.exp(-t * 40)) / r; const w = nz(); s.a += (w - s.a) * 0.3; return Math.sin(s.ph) * Math.exp(-t * 24) * 0.5 + (w - s.a) * Math.exp(-t * 14) * 0.8; });
    B.hat = drum(0.08, (t, s) => { const w = nz(); s.a += (w - s.a) * 0.55; return (w - s.a) * Math.exp(-t * 60) * 0.8; });
    B.ohat = drum(0.45, (t, s) => { const w = nz(); s.a += (w - s.a) * 0.55; return (w - s.a) * Math.exp(-t * 8) * 0.4; });
    B.frame = drum(0.5, (t, s, r) => { s.ph += TAU * (66 + 50 * Math.exp(-t * 28)) / r; const w = nz(); s.a += (w - s.a) * 0.07; return Math.sin(s.ph) * Math.exp(-t * 8) * 0.95 + s.a * Math.exp(-t * 35) * 1.6; });
    B.frameHi = drum(0.25, (t, s, r) => { s.ph += TAU * (160 + 70 * Math.exp(-t * 40)) / r; const w = nz(); s.a += (w - s.a) * 0.25; return Math.sin(s.ph) * Math.exp(-t * 20) * 0.6 + s.a * Math.exp(-t * 55) * 1.1; });
    B.shaker = drum(0.12, (t, s) => { const w = nz(); s.a += (w - s.a) * 0.5; const e = t < 0.018 ? t / 0.018 : Math.exp(-(t - 0.018) * 45); return (w - s.a) * e * 0.45; });
    B.tamb = drum(0.28, (t, s) => { const w = nz(); s.a += (w - s.a) * 0.7; const h = w - s.a; const j = Math.sin(TAU * 5300 * t) * 0.5 + Math.sin(TAU * 7700 * t) * 0.4; return (h * 0.35 + j * Math.abs(h) * 0.9) * Math.exp(-t * 15); });
    B.tomL = drum(0.6, (t, s, r) => { s.ph += TAU * (82 + 40 * Math.exp(-t * 18)) / r; const w = nz(); s.a += (w - s.a) * 0.1; return Math.sin(s.ph) * Math.exp(-t * 6) * 0.9 + s.a * Math.exp(-t * 40); });
    B.tomH = drum(0.45, (t, s, r) => { s.ph += TAU * (130 + 55 * Math.exp(-t * 20)) / r; const w = nz(); s.a += (w - s.a) * 0.15; return Math.sin(s.ph) * Math.exp(-t * 8) * 0.85 + s.a * Math.exp(-t * 45); });
    B.taiko = drum(1.1, (t, s, r) => { s.ph += TAU * (48 + 38 * Math.exp(-t * 14)) / r; const w = nz(); s.a += (w - s.a) * 0.05; return Math.tanh(Math.sin(s.ph) * Math.exp(-t * 3.6) * 1.5) * 0.7 + s.a * Math.exp(-t * 18) * 2; });
    B.crash = drum(2.4, (t, s) => { const w = nz(); s.a += (w - s.a) * 0.4; const h = w - s.a; s.b += (h - s.b) * 0.6; const ring = Math.sin(TAU * 3170 * t + Math.sin(TAU * 457 * t) * 3) * 0.5; return (s.b * 0.75 + ring * Math.abs(h) * 0.5) * Math.exp(-t * 2.1) * (t < 0.003 ? t / 0.003 : 1) * 0.8; });
    B.clank = drum(0.4, t => { const v = Math.sin(TAU * 587 * t) + 0.8 * Math.sin(TAU * 1381 * t) + 0.6 * Math.sin(TAU * 2213 * t) + 0.45 * Math.sin(TAU * 3571 * t); return v * 0.2 * Math.exp(-t * 13) + nz() * Math.exp(-t * 110) * 0.5; });
    B.tick = drum(0.035, (t, s) => { const w = nz(); s.a += (w - s.a) * 0.7; return (w - s.a) * Math.exp(-t * 140) * 0.6; });
    B.rim = drum(0.1, t => (Math.sin(Math.PI * 2 * 820 * t) * 0.6 + Math.sin(Math.PI * 2 * 1630 * t) * 0.3) * Math.exp(-t * 55) + nz() * Math.exp(-t * 200) * 0.3);
    return (BUFS[sr] = B);
  }

  /* =====================================================================================
     ENVIRONMENT — master chain, SFX bus, music bus (pause lowpass + duck), two reverbs
     ===================================================================================== */
  let SOFT = null;
  function softCurve() {
    if (SOFT) return SOFT;
    const n = 2048, k = new Float32Array(n), T0 = 0.7, H = 0.97 - T0;
    for (let i = 0; i < n; i++) { const x = i / (n - 1) * 2 - 1, ax = Math.abs(x); k[i] = ax <= T0 ? x : Math.sign(x) * (T0 + H * Math.tanh((ax - T0) / H)); }
    return (SOFT = k);
  }
  function makeEnv(c, live) {
    NYQ = Math.min(NYQ, 19000, c.sampleRate * 0.45);
    const E = { ctx: c, live, B: buffers(c) };
    const g = v => { const n = c.createGain(); n.gain.value = v; return n; };
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 3.2; comp.attack.value = 0.004; comp.release.value = 0.2;
    const lim = c.createDynamicsCompressor();
    lim.threshold.value = -2.5; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.001; lim.release.value = 0.08;
    // final safety: soft clipper (linear below 0.7, smooth knee to ±0.97) so dense moments never hard-clip
    const sc = c.createWaveShaper(); sc.curve = softCurve(); sc.oversample = 'none';
    E.master = g(0.9); E.master.connect(comp); comp.connect(lim); lim.connect(sc); sc.connect(c.destination);
    // SFX
    E.sfxVol = g(0.8); E.sfxVol.connect(E.master);
    E.sfxIn = g(1); E.sfxIn.connect(E.sfxVol);
    E.sfxRev = g(1); const cv1 = c.createConvolver(); cv1.buffer = E.B.irS; const r1 = g(0.55);
    E.sfxRev.connect(cv1); cv1.connect(r1); r1.connect(E.sfxVol);
    // music: tracks → music → pause lowpass → pause gain → duck → bgmVol → master
    E.bgmVol = g(0.5); E.bgmVol.connect(E.master);
    E.duck = g(1); E.duck.connect(E.bgmVol);
    E.pg = g(1); E.pg.connect(E.duck);
    E.pf = c.createBiquadFilter(); E.pf.type = 'lowpass'; E.pf.frequency.value = fq(20000); E.pf.Q.value = 0.9; E.pf.connect(E.pg);
    E.music = g(0.45);
    const hs = c.createBiquadFilter(); hs.type = 'lowshelf'; hs.frequency.value = 180; hs.gain.value = -2; // leave room for SFX thumps
    E.music.connect(hs); hs.connect(E.pf);
    E.musRev = g(1); const cv2 = c.createConvolver(); cv2.buffer = E.B.irL; const r2 = g(0.8);
    E.musRev.connect(cv2); cv2.connect(r2); r2.connect(E.music);
    // periodic waves
    const pw = arr => { const im = new Float32Array(arr), re = new Float32Array(arr.length); return c.createPeriodicWave(re, im); };
    E.W = {
      flute: pw([0, 1, 0.42, 0.17, 0.09, 0.045, 0.02]),
      whistle: pw([0, 1, 0.14, 0.05, 0.02]),
      reed: pw([0, 1, 0.85, 0.6, 0.5, 0.42, 0.33, 0.27, 0.2, 0.17, 0.12, 0.1, 0.08, 0.06]),
      organ: pw([0, 1, 0.5, 0.25, 0.3, 0.1, 0.12]),
    };
    return E;
  }

  /* =====================================================================================
     SFX PRIMITIVES (all times relative to voice start v.t; frequencies × v.p pitch variation)
     ===================================================================================== */
  function reg(v, src, end, nodes) { for (let i = 0; i < nodes.length; i++) v.nodes.push(nodes[i]); if (end > v.end) { v.end = end; v.last = src; } }
  function finish(v) {
    const nodes = v.nodes;
    const kill = () => { for (let i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) { /* already */ } } };
    if (v.last) v.last.onended = kill; else kill();
  }
  function ramp(param, to, t2, lin) { to = fq(to); if (lin) param.linearRampToValueAtTime(to, t2); else param.exponentialRampToValueAtTime(to, t2); }
  function envp(gp, t, a, h, d, vol) {
    gp.setValueAtTime(0, t); gp.linearRampToValueAtTime(vol, t + a);
    if (h) gp.setValueAtTime(vol, t + a + h);
    gp.exponentialRampToValueAtTime(0.0004, t + a + h + d);
  }
  function panTo(v, o, t, end, g, nodes) {
    if (o.pan1 == null || !v.c.createStereoPanner) return g;
    const pn = v.c.createStereoPanner(); pn.pan.setValueAtTime(o.pan1, t); pn.pan.linearRampToValueAtTime(o.pan2, end);
    g.connect(pn); nodes.push(pn); return pn;
  }
  /** oscillator tone: {type|w, f, f2, gd, lin, at, a, h, d, vol, det, lp|hp|bp, q, lp2, lfo:[rate,depth], fixed, dest} */
  function T(v, o) {
    const c = v.c, t = v.t + (o.at || 0), p = o.fixed ? 1 : v.p;
    const a = o.a || 0.003, h = o.h || 0, d = o.d || 0.1, end = t + a + h + d;
    const osc = c.createOscillator();
    if (o.w) osc.setPeriodicWave(A.W[o.w]); else osc.type = o.type || 'sine';
    if (!(o.f * p < NYQ)) return;
    osc.frequency.setValueAtTime(fq(o.f * p), t);
    if (o.f2) ramp(osc.frequency, o.f2 * p, t + (o.gd || (a + h + d)), o.lin);
    if (o.det) osc.detune.value = o.det;
    const g = c.createGain(); envp(g.gain, t, a, h, d, o.vol || 0.2);
    const nodes = [osc, g]; let head = osc;
    if (o.lp || o.hp || o.bp) {
      const bq = c.createBiquadFilter(); bq.type = o.lp ? 'lowpass' : o.hp ? 'highpass' : 'bandpass';
      bq.frequency.setValueAtTime(fq(o.lp || o.hp || o.bp), t); bq.Q.value = o.q || 0.8;
      if (o.lp2) ramp(bq.frequency, fq(o.lp2), end);
      osc.connect(bq); head = bq; nodes.push(bq);
    }
    if (o.lfo) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.lfo[0]; lg.gain.value = o.lfo[1]; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(end + 0.03); nodes.push(l, lg); }
    head.connect(g);
    panTo(v, o, t, end, g, nodes).connect(o.dest || v.o);
    osc.start(t); osc.stop(end + 0.03);
    reg(v, osc, end + 0.03, nodes);
  }
  /** filtered noise: {n:'white'|'pink'|'brown', ft, f, f2, f3, mid, q, at, a, h, d, vol, lfo:[rate,depth], rate, pan1, pan2} */
  function N(v, o) {
    const c = v.c, t = v.t + (o.at || 0), p = o.fixed ? 1 : v.p;
    const a = o.a || 0.003, h = o.h || 0, d = o.d || 0.1, end = t + a + h + d;
    const src = c.createBufferSource(); src.buffer = A.B[o.n || 'white']; src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const g = c.createGain(); envp(g.gain, t, a, h, d, o.vol || 0.2);
    const nodes = [src, g]; let head = src;
    if (o.ft) {
      const bq = c.createBiquadFilter(); bq.type = o.ft; bq.Q.value = o.q || 0.8;
      bq.frequency.setValueAtTime(fq(o.f * p), t);
      if (o.f3) { const tm = t + (o.mid != null ? o.mid : (a + h + d) / 2); ramp(bq.frequency, fq(o.f2 * p), tm); ramp(bq.frequency, fq(o.f3 * p), end); }
      else if (o.f2) ramp(bq.frequency, fq(o.f2 * p), end);
      if (o.lfo) { const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = o.lfo[0]; lg.gain.value = o.lfo[1]; l.connect(lg); lg.connect(bq.frequency); l.start(t); l.stop(end + 0.03); nodes.push(l, lg); }
      src.connect(bq); head = bq; nodes.push(bq);
    }
    head.connect(g);
    panTo(v, o, t, end, g, nodes).connect(o.dest || v.o);
    src.start(t, Math.random() * 1.5); src.stop(end + 0.03);
    reg(v, src, end + 0.03, nodes);
  }
  /** bell: fundamental + inharmonic partials */
  function Bell(v, f, at, d, vol, lite) {
    T(v, { f, at, a: 0.002, d, vol });
    T(v, { f: f * 2.756, at, a: 0.002, d: d * 0.45, vol: vol * 0.3 });
    if (!lite) T(v, { f: f * 5.404, at, a: 0.001, d: d * 0.2, vol: vol * 0.12 });
  }
  function pluckNode(E, dest, t, m, vol, len) {
    const B = E.B; let bi = 0, bd = 99;
    for (let i = 0; i < B.plBase.length; i++) { const dd = Math.abs(m - B.plBase[i]); if (dd < bd) { bd = dd; bi = i; } }
    const src = E.ctx.createBufferSource(); src.buffer = B.pl[bi]; src.playbackRate.value = Math.pow(2, (m - B.plBase[bi]) / 12);
    const g = E.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.setTargetAtTime(0, t + Math.max(0.03, len - 0.18), 0.05);
    src.connect(g); g.connect(dest); src.start(t); src.stop(t + len);
    return { src, nodes: [src, g], end: t + len };
  }
  function Pl(v, m, at, vol, len) { const r = pluckNode(A, v.o, v.t + (at || 0), m + 12 * Math.log2(v.p), vol, len || 0.5); reg(v, r.src, r.end, r.nodes); }
  function Smp(v, name, at, vol, rate) {
    const c = v.c, t = v.t + (at || 0), b = A.B[name];
    const src = c.createBufferSource(); src.buffer = b; if (rate) src.playbackRate.value = rate * v.p;
    const g = c.createGain(); g.gain.value = vol; src.connect(g); g.connect(v.o); src.start(t);
    reg(v, src, t + b.duration / (rate || 1) + 0.02, [src, g]);
  }
  function brassNote(c, dest, t, f, a, h, r, vol, bright) {
    const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = o2.type = 'sawtooth';
    f = fq(f); o1.frequency.value = f; o2.frequency.value = f; o1.detune.value = -6; o2.detune.value = 7;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.1; const fb = Math.min(4000, f * 1.3);
    lp.frequency.setValueAtTime(fb, t); lp.frequency.linearRampToValueAtTime(fq(Math.min(12000, fb + 2600 * bright)), t + a + 0.04);
    lp.frequency.setTargetAtTime(Math.min(9000, fb + 900 * bright), t + a + 0.05, 0.25);
    const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.setTargetAtTime(vol * 0.72, t + a, 0.25); g.gain.setTargetAtTime(0, t + a + h, r / 4);
    o1.connect(lp); o2.connect(lp); lp.connect(g); g.connect(dest);
    const end = t + a + h + r; o1.start(t); o2.start(t); o1.stop(end); o2.stop(end);
    return { src: o1, nodes: [o1, o2, lp, g], end };
  }
  function Brass(v, m, at, h, vol, bright) { const r = brassNote(v.c, v.o, v.t + (at || 0), mtof(m) * v.p, 0.035, h, 0.35, vol, bright == null ? 1 : bright); reg(v, r.src, r.end, r.nodes); }
  /** ominous layer for enemy attacks: detuned minor-2nd low saws + dark rumble */
  function dark(v, at, d, vol) {
    T(v, { type: 'sawtooth', f: 73, f2: 55, at, a: 0.03, d, vol, lp: 480, q: 3 });
    T(v, { type: 'sawtooth', f: 77.8, f2: 58, at, a: 0.03, d, vol: vol * 0.8, lp: 480, q: 3 });
    N(v, { n: 'brown', ft: 'lowpass', f: 350, at, a: 0.04, d, vol: vol * 2.2 });
  }
  function sparkles(v, n, at, span, lo, hi, vol) { for (let i = 0; i < n; i++) Bell(v, rr(lo, hi), at + Math.random() * span, rr(0.15, 0.35), vol * rr(0.6, 1), true); }
  function gravel(v, n, at, span, vol) { for (let i = 0; i < n; i++) N(v, { ft: 'bandpass', f: rr(1400, 3800), q: 2.5, at: at + Math.random() * span, d: rr(0.015, 0.035), vol: vol * rr(0.6, 1) }); }
  function crackle(v, n, at, span, vol) { for (let i = 0; i < n; i++) N(v, { ft: 'highpass', f: rr(3000, 6000), at: at + Math.random() * span, d: rr(0.008, 0.02), vol: vol * rr(0.5, 1) }); }
  const PENT = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
  const XPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31, 33, 36, 36]; // 17 steps (chain 0..16), top ≈ 6.3 kHz
  let xpStep = 0, xpLast = 0;
  const KILLS = [0, 2, 4, 7, 9, 12, 14, 16, 19];
  let killStep = 0, killLast = 0, rouStep = 0, rouLast = 0;

  /* =====================================================================================
     SFX LIBRARY
     ===================================================================================== */
  const SFX = {
    arrow(v) {
      Pl(v, 43 + rr(0, 4), 0, 0.3, 0.2);                                        // bow string twang
      T(v, { type: 'triangle', f: 330, f2: 170, d: 0.07, vol: 0.1 });
      N(v, { ft: 'bandpass', f: 1300, f2: 4200, q: 1.3, a: 0.012, d: 0.12, vol: 0.2 }); // whoosh
    },
    arrowHit(v) {
      N(v, { ft: 'bandpass', f: 2300, q: 1.4, d: 0.035, vol: 0.32 });
      T(v, { f: 250, f2: 85, d: 0.07, vol: 0.32 });
      N(v, { n: 'brown', ft: 'lowpass', f: 700, d: 0.06, vol: 0.3 });
    },
    kill(v) {
      // kill streak: rapid kills climb a pentatonic ladder (resets after 0.45 s of calm) → "ポポポポッ" rising pops
      const now = performance.now();
      killStep = now - killLast < 450 ? Math.min(killStep + 1, KILLS.length - 1) : 0; killLast = now;
      const f = 523 * Math.pow(2, KILLS[killStep] / 12) * rr(0.985, 1.015);
      T(v, { f, f2: f * 0.45, d: 0.09, vol: 0.2, fixed: 1 });
      T(v, { type: 'triangle', f: f * 2, f2: f, d: 0.045, vol: 0.05, fixed: 1 });
      T(v, { f: 190, f2: 70, d: 0.06, vol: 0.22 });                                  // body thump
      N(v, { ft: 'highpass', f: 2800, d: 0.025, vol: 0.07 });
      if (killStep >= 6) T(v, { f: f * 3, at: 0.02, d: 0.08, vol: 0.03, fixed: 1 });  // glitter on long streaks
    },
    crit(v) {  // critical hit: bright metallic "shing" + snap + sub punch
      N(v, { ft: 'highpass', f: 4500, d: 0.03, vol: 0.2 });
      T(v, { f: 2637, f2: 3520, d: 0.16, vol: 0.06 }); T(v, { f: 3951, d: 0.1, vol: 0.035 });
      T(v, { type: 'triangle', f: 1318, f2: 1760, d: 0.08, vol: 0.05 });
      T(v, { f: 150, f2: 55, d: 0.09, vol: 0.28 });
    },
    burstReady(v) {  // 元素爆発 ready: two rising glints + airy shimmer
      Bell(v, 1568, 0, 0.5, 0.07, true); Bell(v, 2349, 0.08, 0.7, 0.08, true);
      T(v, { f: 784, f2: 1568, a: 0.02, d: 0.25, vol: 0.05 });
      N(v, { ft: 'highpass', f: 6000, a: 0.08, d: 0.4, vol: 0.04 });
    },
    revive(v) {
      N(v, { n: 'pink', ft: 'bandpass', f: 300, f2: 5000, q: 1.4, a: 0.5, d: 0.3, vol: 0.35 });
      [60, 64, 67, 72, 76].forEach(m => T(v, { type: 'triangle', f: mtof(m), at: 0.5, a: 0.05, h: 0.4, d: 1.0, vol: 0.05 }));
      [84, 88, 91, 96].forEach((m, i) => Bell(v, mtof(m), 0.5 + i * 0.07, 0.8, 0.07, true));
      Smp(v, 'crash', 0.5, 0.18);
      duck(0.45, 1.6);
    },
    // ---- enemy big attacks (ENEMY request) — all carry the ominous "dark" layer ----
    beamCharge(v) {  // ≈1.1 s: rising whine with tremolo that speeds up, gathering static
      T(v, { type: 'sawtooth', f: 160, f2: 1400, a: 0.9, d: 0.2, vol: 0.05, lp: 900, lp2: 5000, q: 4, lfo: [18, 30] });
      T(v, { type: 'square', f: 80, f2: 700, a: 0.9, d: 0.2, vol: 0.025, lp: 1200 });
      T(v, { f: 320, f2: 2800, a: 0.95, d: 0.12, vol: 0.05 });
      N(v, { ft: 'bandpass', f: 400, f2: 6000, q: 3, a: 0.95, d: 0.15, vol: 0.14 });
      for (let i = 0; i < 6; i++) N(v, { ft: 'bandpass', f: rr(2500, 5000), q: 2, at: 0.3 + i * 0.12, d: 0.03, vol: 0.06 + i * 0.015 });
      dark(v, 0, 1.1, 0.06);
    },
    beam(v) {  // ≈0.9 s: searing laser blast
      N(v, { ft: 'bandpass', f: 3000, q: 0.8, d: 0.06, vol: 0.35 });
      T(v, { f: 120, f2: 38, d: 0.35, vol: 0.55 });
      T(v, { type: 'sawtooth', f: 440, f2: 330, a: 0.01, h: 0.5, d: 0.35, vol: 0.06, lp: 2600, lfo: [34, 25] });
      T(v, { type: 'sawtooth', f: 443, f2: 326, a: 0.01, h: 0.5, d: 0.35, vol: 0.05, lp: 2600, det: 20 });
      T(v, { type: 'square', f: 110, a: 0.01, h: 0.5, d: 0.3, vol: 0.04, lp: 700 });
      N(v, { n: 'pink', ft: 'bandpass', f: 1800, q: 1.2, a: 0.02, h: 0.45, d: 0.35, vol: 0.2, lfo: [23, 600] });
      dark(v, 0, 0.9, 0.08);
      duck(0.3, 0.9);
    },
    inhale(v) {  // ≈0.9 s: reverse wind — air rushing INTO the boss (swells up, pitch falls)
      N(v, { n: 'pink', ft: 'bandpass', f: 3200, f2: 350, q: 2.5, a: 0.8, d: 0.12, vol: 0.4 });
      N(v, { ft: 'highpass', f: 6000, f2: 1500, a: 0.75, d: 0.1, vol: 0.07 });
      T(v, { f: 900, f2: 180, a: 0.8, d: 0.12, vol: 0.05, lfo: [7, 40] });
      T(v, { f: 55, f2: 40, a: 0.6, d: 0.35, vol: 0.2 });
      dark(v, 0.1, 0.8, 0.05);
    },
    roulette(v) {  // slot-machine tick; consecutive ticks climb slightly (tension), resets after a pause
      const now = performance.now();
      rouStep = now - rouLast < 400 ? (rouStep + 1) % 24 : 0; rouLast = now;
      const k = rouStep % 8, f = 1400 * Math.pow(2, [0, 2, 4, 5, 7, 9, 11, 12][k] / 12);
      Smp(v, 'tick', 0, 0.9, 1);
      T(v, { type: 'triangle', f, d: 0.03, vol: 0.06, fixed: 1 });
      T(v, { f: f * 2, d: 0.015, vol: 0.02, fixed: 1 });
      if (k === 7) Bell(v, f * 1.5, 0.01, 0.15, 0.03, true);
    },
    eliteDeath(v) {
      T(v, { f: 150, f2: 38, d: 0.38, vol: 0.55 });
      N(v, { n: 'brown', ft: 'lowpass', f: 1600, f2: 250, d: 0.42, vol: 0.5 });
      N(v, { ft: 'bandpass', f: 3000, q: 0.8, d: 0.05, vol: 0.2 });
      Bell(v, 1318, 0.05, 0.6, 0.11); Bell(v, 1976, 0.11, 0.6, 0.09);
      Smp(v, 'crash', 0.02, 0.14);
    },
    bossDeath(v) {
      SFX.bigExplosion(v);
      T(v, { type: 'sawtooth', f: 240, f2: 38, d: 2.2, vol: 0.12, lp: 1400, lp2: 200 });   // mechanical groan
      Smp(v, 'crash', 0.05, 0.35); Smp(v, 'taiko', 0, 0.8);
      [60, 64, 67, 72, 76].forEach((m, i) => Brass(v, m, 0.55 + i * 0.02, 1.2, 0.05, 0.8));
      sparkles(v, 8, 0.6, 1.2, 1800, 4200, 0.07);
      duck(0.6, 2.4);
    },
    xp(v, o) {
      // rising crystal chime (Vampire-Survivors style). PROGRESSION may pass {chain:0..16}; otherwise rapid pickups climb on their own.
      const now = performance.now();
      if (o.chain != null) xpStep = cl(o.chain | 0, 0, XPS.length - 1);
      else if (now - xpLast < 600) xpStep = xpStep < XPS.length - 1 ? xpStep + 1 : XPS.length - 2 + (xpStep & 1 ? 0 : 1);
      else xpStep = 0;
      xpLast = now;
      const f = 784 * Math.pow(2, XPS[xpStep] / 12) * rr(0.998, 1.002), k = xpStep / (XPS.length - 1);
      T(v, { f, a: 0.002, d: 0.22 + k * 0.1, vol: 0.13, fixed: 1 });
      T(v, { f: f * 2.01, a: 0.001, d: 0.07, vol: 0.04, fixed: 1 });
      if (f * 3.98 < 12000) T(v, { f: f * 3.98, a: 0.001, d: 0.03, vol: 0.02, fixed: 1 });
      if (xpStep >= 7) T(v, { f: f * 1.5, at: 0.035, a: 0.002, d: 0.16, vol: 0.05, fixed: 1 });        // fifth sparkle
      if (xpStep >= 11) { T(v, { f: f * 2, at: 0.07, a: 0.002, d: 0.2, vol: 0.045, fixed: 1 }); N(v, { ft: 'highpass', f: 7000, a: 0.02, d: 0.18, vol: 0.03, fixed: 1 }); }
      if (xpStep >= 14) v.rs && (v.rs.gain.value = 0.35);
    },
    energy(v) { T(v, { f: 500, f2: 1100, d: 0.14, vol: 0.1, a: 0.01 }); Bell(v, 1568, 0.06, 0.3, 0.08, true); },
    mora(v) {
      T(v, { f: 2350, d: 0.08, vol: 0.1 }); T(v, { f: 3520, d: 0.06, vol: 0.06 });
      T(v, { f: 2800, at: 0.05, d: 0.16, vol: 0.1 }); T(v, { f: 4190, at: 0.05, d: 0.1, vol: 0.05 });
      N(v, { ft: 'highpass', f: 6000, d: 0.02, vol: 0.07 });
    },
    food(v) {
      [72, 76, 79].forEach((m, i) => T(v, { type: 'triangle', f: mtof(m), at: i * 0.06, d: 0.2, vol: 0.12 }));
      Bell(v, mtof(84), 0.18, 0.5, 0.08, true);
    },
    shield(v) {
      T(v, { f: 300, f2: 900, a: 0.05, d: 0.3, vol: 0.13 });
      N(v, { ft: 'bandpass', f: 2000, f2: 7000, q: 1.5, a: 0.12, d: 0.25, vol: 0.12 });
      Bell(v, 1760, 0.18, 0.6, 0.1); Bell(v, 2637, 0.25, 0.5, 0.07, true);
    },
    relic(v) {
      [76, 83, 88, 95].forEach((m, i) => Bell(v, mtof(m), i * 0.08, 0.9, 0.09));
      N(v, { ft: 'highpass', f: 5000, a: 0.2, d: 0.8, vol: 0.06 });
      T(v, { type: 'triangle', f: mtof(64), a: 0.1, d: 1, vol: 0.06 });
    },
    magnet(v) {
      T(v, { f: 300, f2: 1400, a: 0.05, d: 0.45, vol: 0.1, lfo: [14, 25] });
      N(v, { ft: 'bandpass', f: 500, f2: 4000, q: 2, a: 0.25, d: 0.2, vol: 0.12 });
      sparkles(v, 3, 0.3, 0.2, 2000, 3500, 0.05);
    },
    hurt(v) {
      T(v, { f: 175, f2: 55, d: 0.22, vol: 0.5 });
      T(v, { type: 'square', f: 125, f2: 60, d: 0.12, vol: 0.1, lp: 900 });
      N(v, { ft: 'bandpass', f: 900, q: 0.8, d: 0.08, vol: 0.28 });
    },
    explosion(v) {
      T(v, { f: 115, f2: 32, d: 0.5, vol: 0.7 });
      N(v, { n: 'brown', ft: 'lowpass', f: 2600, f2: 200, d: 0.55, vol: 0.7 });
      N(v, { ft: 'bandpass', f: 3400, q: 0.7, d: 0.06, vol: 0.25 });
      N(v, { n: 'pink', ft: 'lowpass', f: 900, at: 0.04, a: 0.05, d: 0.9, vol: 0.18 });
      crackle(v, 4, 0.05, 0.3, 0.12);
    },
    bigExplosion(v) {
      T(v, { f: 95, f2: 24, d: 0.9, vol: 0.9 });
      T(v, { f: 58, f2: 30, at: 0.06, d: 0.8, vol: 0.55 });
      N(v, { n: 'brown', ft: 'lowpass', f: 3200, f2: 150, d: 1.1, vol: 0.9 });
      N(v, { ft: 'bandpass', f: 2600, q: 0.6, d: 0.1, vol: 0.32 });
      N(v, { n: 'pink', ft: 'lowpass', f: 1300, f2: 280, at: 0.08, a: 0.06, d: 1.7, vol: 0.28 });
      Smp(v, 'crash', 0, 0.2, 0.7);
      crackle(v, 7, 0.05, 0.6, 0.12);
      duck(0.35, 0.8);
    },
    skill(v) {  // Baron Bunny toss — cute pop
      T(v, { f: 380, f2: 980, d: 0.09, vol: 0.24 });
      T(v, { type: 'triangle', f: 760, f2: 1900, at: 0.06, d: 0.08, vol: 0.1 });
      N(v, { ft: 'bandpass', f: 1500, f2: 3500, q: 1.4, a: 0.02, d: 0.14, vol: 0.1 });
      Bell(v, 1568, 0.1, 0.25, 0.07, true);
    },
    bunnyHop(v) {
      T(v, { type: 'triangle', f: 160, f2: 430, gd: 0.18, d: 0.26, vol: 0.2, lfo: [22, 35] });
      T(v, { f: 95, f2: 50, d: 0.08, vol: 0.3 });
    },
    burst(v) {
      N(v, { n: 'pink', ft: 'bandpass', f: 300, f2: 5000, q: 1.8, a: 0.72, d: 0.25, vol: 0.5 });     // rising whoosh
      [60, 64, 67, 71, 72].forEach((m, i) => T(v, { type: 'sawtooth', f: mtof(m), det: (i - 2) * 6, a: 0.6, d: 0.9, vol: 0.045, lp: 700, lp2: 2600, q: 2 })); // choir-ish swell
      T(v, { f: 105, f2: 28, at: 0.78, d: 0.8, vol: 0.85 });                                        // impact
      N(v, { n: 'brown', ft: 'lowpass', f: 3000, f2: 180, at: 0.78, d: 0.8, vol: 0.7 });
      Smp(v, 'crash', 0.78, 0.3);
      [2093, 2637, 3136, 4186].forEach((f, i) => Bell(v, f, 0.82 + i * 0.05, 0.5, 0.06, true));
      duck(0.55, 2.2);
    },
    burstRain(v) {
      N(v, { n: 'pink', ft: 'bandpass', f: 2500, q: 0.8, a: 0.4, d: 1.4, vol: 0.2 });
      N(v, { n: 'brown', ft: 'lowpass', f: 420, a: 0.3, d: 1.5, vol: 0.28 });
      for (let i = 0; i < 12; i++) { const f = rr(1700, 3600); T(v, { f, f2: f * 0.7, at: rr(0, 1.4), d: 0.06, vol: 0.045 }); }
      crackle(v, 6, 0.1, 1.3, 0.1);
    },
    levelup(v, o) {
      // chained level-ups ({chain:1..11}) climb in key and add layers
      const n = cl((o.chain | 0) || 1, 1, 11), up = Math.min(n - 1, 10) * 2;
      [72, 76, 79, 84, 88].forEach((m, i) => { T(v, { type: 'triangle', f: mtof(m + up), at: i * 0.055, d: 0.4, vol: 0.13 }); T(v, { f: mtof(m + up + 12), at: i * 0.055, d: 0.2, vol: 0.04 }); });
      [60, 64, 67].forEach(m => T(v, { type: 'sawtooth', f: mtof(m + up), a: 0.05, d: 0.8, vol: 0.035, lp: 2000, lp2: 600 }));
      sparkles(v, 5 + Math.min(n, 8), 0.28, 0.45 + n * 0.03, 2400, 5600, 0.06);
      if (n >= 3) [60, 67, 72].forEach(m => Brass(v, m + up, 0.27, 0.25, 0.05));
      if (n >= 5) { Smp(v, 'crash', 0.27, 0.12 + n * 0.012); Smp(v, 'taiko', 0.27, 0.4); }
      if (n >= 8) N(v, { ft: 'highpass', f: 6000, at: 0.27, a: 0.15, d: 0.9, vol: 0.06 });
      duck(0.3 + Math.min(n, 8) * 0.03, 0.8);
    },
    evolution(v) {
      // 2.5 s gacha cutscene sting: darkness swell (0–1.0) → fuse whoosh (0.9–1.3) → golden hit + choir (1.3) → shimmer tail
      [36, 37, 43, 44].forEach((m, i) => T(v, { type: 'sawtooth', f: mtof(m), det: i * 5, a: 1.0, d: 0.35, vol: 0.06, lp: 120, lp2: 1400, q: 4 }));
      N(v, { n: 'brown', ft: 'lowpass', f: 150, f2: 900, a: 1.1, d: 0.25, vol: 0.4 });
      T(v, { f: 38, a: 1.0, d: 0.3, vol: 0.4 });
      for (let i = 0; i < 12; i++) { const tt = 1.25 * (1 - Math.pow(1 - i / 12, 1.7)); Smp(v, 'tomL', tt, 0.08 + i * 0.03); }   // accelerating timpani
      N(v, { n: 'pink', ft: 'bandpass', f: 250, f2: 7000, q: 1.6, at: 0.75, a: 0.55, d: 0.12, vol: 0.5 });           // fuse whoosh
      N(v, { ft: 'highpass', f: 4000, f2: 9000, at: 0.8, a: 0.5, d: 0.05, vol: 0.12 });                              // reverse-cymbal swell
      const H = 1.3;
      T(v, { f: 100, f2: 28, at: H, d: 1.0, vol: 0.9 }); Smp(v, 'taiko', H, 0.9); Smp(v, 'kick', H, 0.8); Smp(v, 'crash', H, 0.4);
      [48, 60, 64, 67, 72, 76].forEach(m => Brass(v, m, H, 1.0, m < 55 ? 0.08 : 0.07));
      [64, 67, 72, 76, 79].forEach((m, i) => T(v, { type: 'sawtooth', f: mtof(m), det: (i - 2) * 7, at: H, a: 0.25, h: 0.5, d: 0.7, vol: 0.035, bp: 900, q: 1.2 })); // choir 'ah'
      [84, 88, 91, 96, 100, 103].forEach((m, i) => Bell(v, mtof(m), H + 0.05 + i * 0.06, 0.9, 0.07));
      N(v, { ft: 'highpass', f: 6000, at: H, a: 0.2, d: 1.2, vol: 0.07 });
      duck(0.7, 3);
    },
    chestOpen(v) {
      T(v, { type: 'sawtooth', f: 85, f2: 150, d: 0.32, vol: 0.06, lp: 900, lfo: [28, 18] });           // creak
      N(v, { ft: 'highpass', f: 3000, at: 0.3, d: 0.02, vol: 0.3 });                                   // latch
      T(v, { f: 80, f2: 48, at: 0.32, d: 0.12, vol: 0.35 });
      N(v, { ft: 'highpass', f: 3000, f2: 9000, at: 0.34, a: 0.45, d: 0.2, vol: 0.1 });                // anticipation
      T(v, { f: 400, f2: 1600, at: 0.34, a: 0.4, d: 0.15, vol: 0.05 });
    },
    chestReveal(v, o) {
      const r = o.rarity || 3;
      if (r >= 5) {
        T(v, { f: 90, f2: 30, d: 0.7, vol: 0.8 }); Smp(v, 'crash', 0, 0.35); Smp(v, 'taiko', 0, 0.6);
        [60, 64, 67, 72].forEach(m => Brass(v, m, 0.02, 0.2, 0.07));
        [65, 69, 72, 77].forEach(m => Brass(v, m, 0.3, 0.12, 0.07));
        [67, 71, 74, 79].forEach(m => Brass(v, m, 0.48, 0.12, 0.07));
        [72, 76, 79, 84, 88].forEach(m => Brass(v, m, 0.66, 1.4, 0.065));
        const up = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
        up.forEach((s, i) => Bell(v, mtof(84 + s), 0.66 + i * 0.045, 0.7, 0.06, true));
        N(v, { ft: 'highpass', f: 6000, at: 0.6, a: 0.3, d: 2, vol: 0.09 });
        Bell(v, 4186, 1.3, 1.5, 0.08);
        // golden choir halo + stereo glitter rain (祈願 feel, original voicing)
        [72, 76, 79, 84].forEach((m, i) => T(v, { type: 'sawtooth', f: mtof(m), det: (i - 1.5) * 8, at: 0.66, a: 0.3, h: 0.6, d: 1.2, vol: 0.028, bp: 1000, q: 1.2 }));
        for (let i = 0; i < 14; i++) { const p = rr(-0.9, 0.9); T(v, { f: rr(2600, 5200), at: 0.7 + Math.random() * 1.4, d: rr(0.12, 0.3), vol: 0.035, pan1: p, pan2: p }); }
        if (o.jackpot) {  // 大当たり: coin shower
          for (let i = 0; i < 26; i++) { const at = 0.6 + Math.pow(Math.random(), 0.7) * 1.6, f = rr(2200, 3400); T(v, { f, at, d: 0.09, vol: 0.05 }); T(v, { f: f * 1.34, at: at + 0.012, d: 0.12, vol: 0.035 }); }
          N(v, { ft: 'highpass', f: 5000, at: 0.6, a: 0.3, d: 1.6, vol: 0.05 });
          [72, 76, 79, 84].forEach(m => Brass(v, m + 12, 1.4, 0.8, 0.045));
          Smp(v, 'crash', 1.4, 0.25);
        }
        duck(o.jackpot ? 0.75 : 0.65, o.jackpot ? 3.4 : 2.8);
      } else if (r === 4) {
        T(v, { f: 70, f2: 45, d: 0.6, vol: 0.35 });
        N(v, { n: 'pink', ft: 'bandpass', f: 600, f2: 5000, q: 3, a: 0.25, d: 0.5, vol: 0.2 });
        [74, 78, 81, 85, 90, 93].forEach((m, i) => Bell(v, mtof(m), 0.1 + i * 0.06, 0.9, 0.08));
        [62, 66, 69, 73].forEach(m => T(v, { type: 'sawtooth', f: mtof(m), a: 0.2, d: 1.1, vol: 0.03, lp: 1500, q: 3 }));
        sparkles(v, 7, 0.3, 0.8, 2500, 5000, 0.05);
        duck(0.45, 1.6);
      } else {
        Pl(v, 76, 0, 0.25, 0.6); Pl(v, 83, 0.05, 0.2, 0.6);
        Bell(v, 1318, 0, 0.7, 0.14); Bell(v, 1976, 0.08, 0.8, 0.12);
        N(v, { ft: 'highpass', f: 5000, d: 0.3, vol: 0.05 });
      }
    },
    star(v, o) {
      // gacha meteor. {rarity:3} = blue shooting star, 4 = purple upgrade "shiiing", 5 = GOLD: big rising shimmer + major bloom
      const r = o.rarity || 3;
      if (r <= 3) {
        N(v, { ft: 'bandpass', f: 7000, f2: 1400, q: 3, a: 0.05, d: 0.6, vol: 0.22, pan1: -0.8, pan2: 0.8 });
        T(v, { f: 3200, f2: 1400, d: 0.5, vol: 0.05, pan1: -0.8, pan2: 0.8 });
        sparkles(v, 4, 0.35, 0.4, 3000, 5500, 0.05);
      } else if (r === 4) {
        N(v, { n: 'pink', ft: 'bandpass', f: 900, f2: 6000, q: 2.5, a: 0.18, d: 0.35, vol: 0.3, pan1: 0.6, pan2: -0.6 });
        T(v, { f: 70, f2: 44, d: 0.35, vol: 0.3 });
        [71, 74, 78, 83].forEach((m, i) => Bell(v, mtof(m + 12), 0.08 + i * 0.05, 0.7, 0.07, i > 1));   // B minor-ish shimmer = "purple"
        T(v, { type: 'sawtooth', f: mtof(59), a: 0.1, d: 0.6, vol: 0.03, lp: 1400, q: 3 });
        T(v, { type: 'sawtooth', f: mtof(66), det: 8, a: 0.1, d: 0.6, vol: 0.03, lp: 1400, q: 3 });
        duck(0.3, 0.8);
      } else {
        T(v, { f: 85, f2: 30, d: 0.8, vol: 0.75 }); Smp(v, 'taiko', 0, 0.6); Smp(v, 'crash', 0, 0.25);
        N(v, { n: 'pink', ft: 'bandpass', f: 600, f2: 8000, q: 2, a: 0.25, d: 0.5, vol: 0.3 });
        N(v, { ft: 'highpass', f: 5000, a: 0.15, d: 1.4, vol: 0.08, lfo: [11, 1200] });   // golden fizz
        // cascading golden arpeggio in D major (bright, open fifths) — original figure
        [62, 69, 74, 78, 81, 86, 90, 93, 98].forEach((m, i) => Bell(v, mtof(m + 12), 0.04 + i * 0.035, 0.8, 0.065, i > 4));
        [50, 57, 62, 66, 69].forEach(m => Brass(v, m + 12, 0.02, 0.4, 0.05, 0.9));
        [74, 78, 81].forEach((m, i) => T(v, { type: 'sawtooth', f: mtof(m), det: (i - 1) * 9, a: 0.15, h: 0.3, d: 0.8, vol: 0.03, bp: 1100, q: 1.3 }));  // choir 'ah'
        sparkles(v, 10, 0.2, 1.0, 3000, 6000, 0.05);
        duck(0.55, 1.6);
      }
    },
    pyro(v) {
      N(v, { ft: 'bandpass', f: 1300, f2: 550, q: 0.8, d: 0.25, vol: 0.32 });
      T(v, { f: 125, f2: 55, d: 0.2, vol: 0.28 });
      crackle(v, 3, 0, 0.22, 0.14);
    },
    hydro(v) {
      N(v, { ft: 'lowpass', f: 4200, f2: 400, q: 1.2, d: 0.3, vol: 0.34 });
      for (let i = 0; i < 3; i++) { const f = rr(500, 800); T(v, { f, f2: f * 2.2, at: 0.04 + i * 0.05, d: 0.05, vol: 0.09 }); }
    },
    cryo(v) {
      for (let i = 0; i < 3; i++) Bell(v, rr(2200, 3600), i * 0.04, 0.35, 0.07, true);
      N(v, { ft: 'highpass', f: 6000, d: 0.15, vol: 0.1 });
    },
    electro(v) {
      T(v, { type: 'sawtooth', f: 1400, f2: 180, d: 0.09, vol: 0.1 });
      T(v, { type: 'square', f: 70, d: 0.16, vol: 0.08, hp: 800 });
      N(v, { ft: 'bandpass', f: 3000, q: 1, d: 0.05, vol: 0.24 }); N(v, { ft: 'bandpass', f: 4200, q: 1.5, at: 0.06, d: 0.04, vol: 0.18 });
    },
    anemo(v) {
      N(v, { n: 'pink', ft: 'bandpass', f: 400, f2: 2000, f3: 600, q: 3, a: 0.1, d: 0.35, vol: 0.45 });
      T(v, { f: 600, f2: 900, a: 0.05, d: 0.25, vol: 0.04 });
    },
    geo(v) {
      N(v, { n: 'brown', ft: 'lowpass', f: 900, d: 0.18, vol: 0.5 });
      T(v, { f: 95, f2: 45, d: 0.15, vol: 0.4 });
      gravel(v, 4, 0, 0.12, 0.15);
    },
    reaction(v, o) {
      switch (o.type) {
        case 'vaporize':
          N(v, { ft: 'highpass', f: 2000, f2: 6500, a: 0.02, d: 0.5, vol: 0.24 });
          T(v, { f: 400, f2: 1400, d: 0.25, vol: 0.1 });
          for (let i = 0; i < 4; i++) { const f = rr(600, 1000); T(v, { f, f2: f * 2, at: 0.05 + i * 0.05, d: 0.04, vol: 0.06 }); }
          break;
        case 'melt':
          N(v, { ft: 'bandpass', f: 3000, f2: 1100, q: 0.7, d: 0.45, vol: 0.24 });
          T(v, { type: 'triangle', f: 700, f2: 240, d: 0.35, vol: 0.12 });
          Bell(v, 2200, 0, 0.3, 0.05, true);
          break;
        case 'overloaded':
          SFX.explosion(v); crackle(v, 6, 0, 0.35, 0.16);
          T(v, { type: 'sawtooth', f: 300, f2: 60, d: 0.3, vol: 0.08, lp: 1200 });
          break;
        case 'electrocharged':
          for (let i = 0; i < 4; i++) { T(v, { type: 'sawtooth', f: rr(900, 1500), f2: 200, at: i * 0.07, d: 0.05, vol: 0.07 }); N(v, { ft: 'bandpass', f: 2600, q: 1.2, at: i * 0.07, d: 0.03, vol: 0.14 }); }
          T(v, { type: 'square', f: 55, d: 0.3, vol: 0.05, hp: 600 });
          break;
        case 'frozen':
          N(v, { ft: 'highpass', f: 3000, d: 0.05, vol: 0.34 });
          T(v, { f: 3200, f2: 2400, d: 0.3, vol: 0.05 });
          for (let i = 0; i < 3; i++) Bell(v, rr(2400, 4200), 0.04 + i * 0.05, 0.4, 0.06, true);
          N(v, { ft: 'highpass', f: 8000, a: 0.05, d: 0.6, vol: 0.07 });
          break;
        case 'superconduct':
          T(v, { type: 'sawtooth', f: 2000, f2: 120, d: 0.35, vol: 0.09, lp: 3500 });
          N(v, { ft: 'bandpass', f: 3500, q: 1.5, d: 0.05, vol: 0.2 });
          for (let i = 0; i < 3; i++) Bell(v, rr(2600, 4000), 0.05 + i * 0.05, 0.3, 0.05, true);
          break;
        case 'swirl':
          N(v, { n: 'pink', ft: 'bandpass', f: 300, f2: 2600, f3: 500, q: 4, a: 0.2, d: 0.4, vol: 0.5, lfo: [9, 250] });
          T(v, { f: 500, f2: 1100, d: 0.4, vol: 0.05 });
          Bell(v, 1760, 0.2, 0.4, 0.06, true);
          break;
        case 'crystallize':
          [88, 95, 100].forEach((m, i) => Bell(v, mtof(m), i * 0.04, 0.6, 0.08));
          T(v, { f: 600, f2: 1200, d: 0.2, vol: 0.07 });
          N(v, { ft: 'highpass', f: 6000, a: 0.05, d: 0.4, vol: 0.06 });
          break;
        case 'shatter':
          for (let i = 0; i < 8; i++) T(v, { f: rr(2500, 6000), at: rr(0, 0.08), d: rr(0.05, 0.2), vol: 0.05 });
          N(v, { ft: 'highpass', f: 4000, d: 0.15, vol: 0.3 });
          T(v, { f: 150, f2: 60, d: 0.12, vol: 0.3 });
          break;
        default:
          Bell(v, rr(1400, 2000), 0, 0.4, 0.08); N(v, { ft: 'bandpass', f: 1500, f2: 4000, q: 1.5, d: 0.25, vol: 0.15 });
      }
    },
    denied(v) {
      T(v, { type: 'square', f: 220, d: 0.07, vol: 0.06, lp: 1200 });
      T(v, { type: 'square', f: 165, at: 0.09, d: 0.1, vol: 0.06, lp: 1200 });
    },
    ui(v) { T(v, { f: 1150, f2: 900, d: 0.05, vol: 0.11 }); T(v, { f: 2300, d: 0.025, vol: 0.025 }); },
    uiHover(v) { T(v, { f: 1760, d: 0.035, vol: 0.03, a: 0.004 }); },
    bossWarning(v) {
      for (let k = 0; k < 4; k++) {
        const vol = 0.04 + k * 0.018;
        T(v, { type: 'sawtooth', f: 440, at: k * 0.46, a: 0.02, h: 0.18, d: 0.05, vol, lp: 1800, fixed: 1 });
        T(v, { type: 'sawtooth', f: 587, at: k * 0.46 + 0.23, a: 0.02, h: 0.18, d: 0.05, vol, lp: 1800, fixed: 1 });
      }
      T(v, { f: 45, a: 0.8, d: 1.2, vol: 0.35 });
      N(v, { n: 'brown', ft: 'lowpass', f: 300, a: 1.0, d: 0.8, vol: 0.3 });
      duck(0.6, 2.6);
    },
    bossRoar(v) {
      T(v, { type: 'sawtooth', f: 78, f2: 44, a: 0.1, d: 1.4, vol: 0.2, lp: 700, lfo: [11, 6] });
      T(v, { type: 'square', f: 112, f2: 58, a: 0.1, d: 1.2, vol: 0.08, lp: 500 });
      N(v, { n: 'brown', ft: 'lowpass', f: 700, a: 0.15, d: 1.3, vol: 0.5 });
      T(v, { f: 40, a: 0.05, d: 1.2, vol: 0.45 });
      Smp(v, 'clank', 0, 0.5, 0.7); Smp(v, 'clank', 0.16, 0.4, 0.55); Smp(v, 'taiko', 0, 0.6);
      duck(0.45, 1.6);
    },
    windBlast(v) {
      N(v, { n: 'pink', ft: 'bandpass', f: 250, f2: 1400, f3: 350, q: 1.5, a: 0.12, d: 0.5, vol: 0.65 });
      T(v, { f: 80, f2: 42, d: 0.4, vol: 0.4 });
      dark(v, 0, 0.55, 0.09);
    },
    tornado(v) {
      N(v, { n: 'pink', ft: 'bandpass', f: 650, q: 5, a: 0.3, h: 0.3, d: 0.9, vol: 0.5, lfo: [6, 420] });
      N(v, { ft: 'highpass', f: 3000, a: 0.3, d: 1.1, vol: 0.06, lfo: [6, 1500] });
      T(v, { f: 45, a: 0.3, h: 0.3, d: 0.9, vol: 0.14, lfo: [6, 4] });
      dark(v, 0.1, 1.2, 0.06);
    },
    rockThrow(v) {
      N(v, { n: 'brown', ft: 'bandpass', f: 500, f2: 220, q: 1, d: 0.3, vol: 0.45 });
      T(v, { f: 140, f2: 70, d: 0.25, vol: 0.28 });
      dark(v, 0, 0.3, 0.08);
    },
    rockImpact(v) {
      T(v, { f: 90, f2: 32, d: 0.35, vol: 0.65 });
      N(v, { n: 'brown', ft: 'lowpass', f: 1500, f2: 200, d: 0.35, vol: 0.6 });
      gravel(v, 5, 0.02, 0.2, 0.15);
      T(v, { f: 50, f2: 28, at: 0.02, d: 0.6, vol: 0.45 });
      dark(v, 0, 0.5, 0.08);
    },
    enemyArrow(v) {
      Pl(v, 57, 0, 0.16, 0.14);
      N(v, { ft: 'bandpass', f: 2500, f2: 900, q: 1.5, d: 0.14, vol: 0.12 });
      T(v, { type: 'sawtooth', f: 180, f2: 90, d: 0.14, vol: 0.05, lp: 700 });
    },
    enemyCast(v) {
      T(v, { type: 'sawtooth', f: 220, a: 0.25, d: 0.3, vol: 0.045, lp: 900, det: -12 });
      T(v, { type: 'sawtooth', f: 233, a: 0.25, d: 0.3, vol: 0.045, lp: 900, det: 12 });
      N(v, { ft: 'bandpass', f: 600, f2: 2400, q: 2, a: 0.3, d: 0.2, vol: 0.1 });
      T(v, { f: 110, f2: 45, at: 0.45, d: 0.3, vol: 0.3 });
      dark(v, 0, 0.6, 0.06);
    },
    victory(v) {
      [0, 4, 7, 12, 16, 19, 24, 28, 31, 36].forEach((s, i) => Bell(v, mtof(72 + s), i * 0.05, 0.7, 0.06, true));
      Smp(v, 'crash', 0, 0.3); T(v, { f: 65, d: 0.6, vol: 0.4 });
    },
    defeat(v) {
      T(v, { f: 98, a: 0.01, d: 2.4, vol: 0.28, fixed: 1 }); T(v, { f: 98 * 2.76, a: 0.01, d: 1.2, vol: 0.07, fixed: 1 });
      T(v, { f: 98 * 1.5, a: 0.01, d: 1.6, vol: 0.06, fixed: 1 });
      N(v, { n: 'brown', ft: 'lowpass', f: 400, d: 0.6, vol: 0.25 });
    },
    start(v) {
      N(v, { n: 'pink', ft: 'bandpass', f: 300, f2: 6000, q: 1.2, a: 0.3, d: 0.15, vol: 0.4 });
      Smp(v, 'kick', 0.32, 0.8); Smp(v, 'crash', 0.32, 0.2);
      [62, 66, 69, 74].forEach(m => Brass(v, m, 0.32, 0.35, 0.07));
      [86, 90, 93, 98].forEach((m, i) => Bell(v, mtof(m), 0.34 + i * 0.04, 0.6, 0.06, true));
      duck(0.4, 1);
    },
    comboUp(v, o) {
      const lv = cl(o.combo || o.level || 1, 1, 12), f = 660 * Math.pow(2, Math.min(lv, 12) / 12);
      T(v, { type: 'triangle', f, f2: f * 1.5, d: 0.08, vol: 0.1 });
      T(v, { type: 'triangle', f: f * 1.5, at: 0.06, d: 0.14, vol: 0.1 });
      Bell(v, f * 3, 0.1, 0.25, 0.05, true);
    },
    resonance(v) {
      [72, 76, 79, 83, 88].forEach((m, i) => Bell(v, mtof(m), i * 0.07, 1.2, 0.08));
      [60, 67, 76].forEach(m => T(v, { type: 'sawtooth', f: mtof(m), a: 0.3, d: 1.2, vol: 0.03, lp: 1400 }));
      N(v, { ft: 'highpass', f: 5000, a: 0.3, d: 1, vol: 0.05 });
      duck(0.35, 1.2);
    },
  };
  // simple aliases (be lenient with names other owners might use)
  SFX.levelUp = SFX.levelup; SFX.hit = SFX.arrowHit; SFX.pickup = SFX.xp; SFX.heal = SFX.food; SFX.click = SFX.ui; SFX.hover = SFX.uiHover;
  SFX.physical = SFX.arrowHit; SFX.enemyDeath = SFX.kill;
  SFX.combo = SFX.comboUp; SFX.critHit = SFX.crit; SFX.hitCrit = SFX.crit; SFX.slot = SFX.roulette; SFX.rouletteTick = SFX.roulette; SFX.chargeBeam = SFX.beamCharge; SFX.laser = SFX.beam;

  const REV = { rockImpact: 0.3, rockThrow: 0.15, windBlast: 0.25, enemyCast: 0.35, enemyArrow: 0.12, arrow: 0.05, kill: 0.04, xp: 0.18, mora: 0.12, explosion: 0.2, bigExplosion: 0.3, burst: 0.35, burstRain: 0.3, levelup: 0.35,
    evolution: 0.4, chestReveal: 0.4, chestOpen: 0.2, star: 0.4, relic: 0.45, resonance: 0.5, bossRoar: 0.3, bossWarning: 0.3, bossDeath: 0.35,
    victory: 0.45, defeat: 0.5, start: 0.3, ui: 0.05, uiHover: 0.03, hurt: 0.06, cryo: 0.3, shield: 0.3, reaction: 0.2, tornado: 0.2, crit: 0.08, burstReady: 0.35, revive: 0.45, beamCharge: 0.25, beam: 0.3, inhale: 0.25, roulette: 0.04 };
  const LIMIT = { kill: 6, arrow: 4, arrowHit: 5, xp: 4, mora: 3, explosion: 4, bigExplosion: 2, hurt: 2, reaction: 5, enemyArrow: 3, enemyCast: 3,
    pyro: 3, hydro: 3, cryo: 3, electro: 3, anemo: 3, geo: 3, rockImpact: 3, uiHover: 2, crit: 2, roulette: 2, beamCharge: 2, beam: 2, inhale: 2, star: 3 };
  const GAP = { arrow: 45, arrowHit: 35, kill: 28, xp: 38, mora: 45, energy: 60, explosion: 60, bigExplosion: 120, hurt: 120, uiHover: 50, ui: 40,
    enemyArrow: 70, enemyCast: 90, rockImpact: 60, rockThrow: 80, pyro: 60, hydro: 60, cryo: 60, electro: 60, anemo: 60, geo: 60, reaction: 55,
    denied: 150, victory: 2000, defeat: 2000, start: 500, levelup: 200, evolution: 400, burst: 300, chestOpen: 250, bossWarning: 800, bossRoar: 600, comboUp: 80, star: 120, shield: 120, crit: 110, roulette: 45, burstReady: 800, revive: 1000, beamCharge: 300, beam: 250, inhale: 300 };
  const HIGH = new Set(['levelup', 'evolution', 'burst', 'burstRain', 'chestOpen', 'chestReveal', 'bossWarning', 'bossRoar', 'bossDeath', 'victory',
    'defeat', 'start', 'ui', 'denied', 'resonance', 'hurt', 'relic', 'comboUp', 'eliteDeath', 'star', 'roulette', 'burstReady', 'revive', 'beamCharge', 'beam', 'inhale']);
  const NOPV = new Set(['xp', 'ui', 'uiHover', 'levelup', 'evolution', 'chestReveal', 'victory', 'defeat', 'resonance', 'start', 'bossWarning', 'star', 'roulette', 'burstReady', 'revive']);
  // loudness trim per sound (frequent small sounds need to cut through the music)
  const GAIN = { kill: 2.9, arrow: 1.4, arrowHit: 2.5, hit: 2.5, physical: 2.5, enemyDeath: 2.5, xp: 2.2, pickup: 2.2, ui: 3.5, click: 3.5, uiHover: 4, hover: 4,
    electro: 2, hurt: 2, enemyArrow: 1.5, denied: 1.8, bunnyHop: 1.6, rockThrow: 1.5, pyro: 1.3, hydro: 1.3, cryo: 1.3, anemo: 1.3, geo: 1.3, comboUp: 1.5, skill: 1.5, mora: 1.4, crit: 1.6, roulette: 4.5, beamCharge: 1.4, beam: 1.3, inhale: 1.3, burstReady: 1.6 };
  const active = [], lastAt = {}, lastPlay = {};

  function voice(o, name) {
    const c = A.ctx, t = c.currentTime + 0.004;
    const out = c.createGain(); let vol = (o.vol != null ? o.vol : 1) * (GAIN[name] || 1), pan = o.pan || 0;
    const R = G.run;
    if (o.x != null && R && R.player) {
      const dx = o.x - R.player.x, dy = o.y != null ? o.y - R.player.y : 0;
      pan = cl(dx / 9, -1, 1) * 0.7; vol *= cl(1.2 - Math.sqrt(dx * dx + dy * dy) / 20, 0.35, 1);
    }
    out.gain.value = vol;
    const v = { c, t, p: o.pitch || (NOPV.has(name) ? 1 : 1 + rr(-0.035, 0.035)), o: out, nodes: [out], end: t, last: null };
    let tail = out;
    if (pan && c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = pan; out.connect(pn); tail = pn; v.nodes.push(pn); }
    tail.connect(A.sfxIn);
    const rv = REV[name] != null ? REV[name] : 0.1;
    if (rv > 0) { const rs = c.createGain(); rs.gain.value = rv; tail.connect(rs); rs.connect(A.sfxRev); v.nodes.push(rs); v.rs = rs; }
    return v;
  }

  function sfx(name, o) {
    if (!ctx || !A || ctx.state !== 'running') return;
    const s = settings(); if (!s.sfx || !(s.sfxVolume > 0)) return;
    const fn = SFX[name]; if (!fn) return;
    o = o || {};
    const key = name === 'reaction' ? 'reaction:' + (o.type || '') : name === 'chestReveal' || name === 'star' ? name + (o.rarity || 3) : name === 'levelup' ? name + (o.chain || 0) : name;
    const ms = performance.now(), gap = GAP[name] != null ? GAP[name] : 30;
    if (lastAt[key] && ms - lastAt[key] < gap) return;
    const now = ctx.currentTime; let n = 0, same = 0;
    for (let i = active.length - 1; i >= 0; i--) { if (active[i].end < now) active.splice(i, 1); else { n++; if (active[i].name === name) same++; } }
    if (same >= (LIMIT[name] || 4)) return;
    if (n >= MAX_VOICES && !HIGH.has(name)) return;
    lastAt[key] = ms; lastPlay[name] = ms;
    const v = voice(o, name);
    try { fn(v, o); } catch (e) { console.warn('[audio] sfx', name, e); }
    finish(v);
    active.push({ name, end: v.end });
  }

  function duck(amount, time) {
    if (!A) return;
    const c = A.ctx, t = c.currentTime, gp = A.duck.gain;
    amount = cl(amount == null ? 0.5 : amount, 0, 0.95); time = time == null ? 1 : time;
    gp.cancelScheduledValues(t); gp.setTargetAtTime(1 - amount, t, 0.04); gp.setTargetAtTime(1, t + time, 0.35);
  }

  /* =====================================================================================
     MUSIC — notation, instruments, sequencer
     Melody strings: tokens per step; digit = scale degree ([#b]? prefix, ' = octave up, , = octave down),
     '-' = hold, '.' = rest, '|' ignored. Chords: degree + M (major 3rd) | m (minor 3rd) | s (sus4) | 7, 'b' prefix = flat major; 'a:b' splits a bar.
     ===================================================================================== */
  const SCALES = { major: [0, 2, 4, 5, 7, 9, 11], minor: [0, 2, 3, 5, 7, 8, 10], dorian: [0, 2, 3, 5, 7, 9, 10], mixo: [0, 2, 4, 5, 7, 9, 10] };
  function dm(sp, deg, oct, acc) { const d = deg - 1, o = Math.floor(d / 7), i = d - o * 7; return sp.key + 12 * (oct + o) + SCALES[sp.scale][i] + acc; }
  function parseMel(str) {
    const toks = str.replace(/\|/g, ' ').trim().split(/\s+/), notes = []; let cur = null;
    toks.forEach((tk, i) => {
      if (tk === '-') { if (cur) cur.len++; return; }
      if (tk === '.') { cur = null; return; }
      const m = tk.match(/^([#b]?)(\d)([',]*)$/); if (!m) { cur = null; return; }
      let oct = 0; for (const ch of m[3]) oct += ch === "'" ? 1 : -1;
      cur = { s: i, len: 1, deg: +m[2], oct, acc: m[1] === '#' ? 1 : m[1] === 'b' ? -1 : 0 }; notes.push(cur);
    });
    return { n: toks.length, notes };
  }
  function parseChord(sp, tok) {
    const m = tok.match(/^(b?)(\d)(M|m)?(s)?(7)?$/); if (!m) return parseChord(sp, '1');
    const flat = m[1] === 'b', d = +m[2];
    const root = dm(sp, d, 0, flat ? -1 : 0);
    let third = flat ? root + 4 : dm(sp, d + 2, 0, 0); const fifth = flat ? root + 7 : dm(sp, d + 4, 0, 0);
    if (m[3] === 'M') third = root + 4; if (m[3] === 'm') third = root + 3;
    if (m[4]) third = flat ? root + 5 : dm(sp, d + 3, 0, 0);
    const tones = [root, third, fifth]; if (m[5]) tones.push(flat ? root + 10 : dm(sp, d + 6, 0, 0));
    return { root, tones };
  }
  function prep(sp) {
    if (sp._p) return; sp._p = true; sp._mels = {};
    for (const k in sp.mels) sp._mels[k] = parseMel(sp.mels[k]);
    for (const k in sp.sections) { const s = sp.sections[k]; s._ch = s.ch.map(tok => tok.split(':').map(x => parseChord(sp, x))); s.bars = s.ch.length; }
  }
  function voiceList(c, base) {
    let r = c.root; while (r < base) r += 12; while (r >= base + 12) r -= 12;
    const iv = c.tones.map(x => ((x - c.root) % 12 + 12) % 12).sort((a, b) => a - b), L = [];
    for (let o = 0; o < 4; o++) for (const x of iv) L.push(r + 12 * o + x);
    return L;
  }
  function voicing(c, center) { return c.tones.map(x => { let m = x; while (m < center - 6) m += 12; while (m >= center + 6) m -= 12; return m; }); }

  // ---- instrument channel settings (per track instance) ----
  const CH = {
    harp: { vol: 0.5, pan: -0.25, rev: 0.32 }, lyre: { vol: 0.55, pan: 0.18, rev: 0.4 },
    flute: { vol: 0.26, pan: 0.12, rev: 0.36, vib: [5.2, 11] }, whistle: { vol: 0.15, pan: -0.12, rev: 0.36, vib: [6.1, 15] },
    strings: { vol: 0.12, rev: 0.45, lp: 2400 }, counter: { vol: 0.11, pan: 0.3, rev: 0.45, lp: 3000, vib: [5, 9] },
    stringsS: { vol: 0.075, pan: 0.28, rev: 0.25, lp: 3400 }, accordion: { vol: 0.07, pan: -0.35, rev: 0.2, lp: 2600, vib: [5.5, 5] },
    bass: { vol: 0.2, rev: 0.04, lp: 900, q: 2 }, pbass: { vol: 0.5, rev: 0.08 },
    bell: { vol: 0.1, pan: 0.3, rev: 0.5 }, choir: { vol: 0.15, rev: 0.55, formant: true, vib: [4.6, 9] },
    brass: { vol: 0.1, pan: -0.08, rev: 0.3 }, brassLead: { vol: 0.13, pan: 0.05, rev: 0.32 }, choirLead: { vol: 0.2, rev: 0.55, formant: true, vib: [5, 14] },
    drum: { vol: 0.55, rev: 0.12 }, wind: { vol: 0.1, rev: 0.3 },
  };
  function clean(src, nodes, vib, param) {
    src.onended = () => { for (let i = 0; i < nodes.length; i++) { try { nodes[i].disconnect(); } catch (e) { /* ok */ } } if (vib) { try { vib.disconnect(param); } catch (e) { /* ok */ } } };
  }
  function windTone(E, ch, t, m, d, v, wave, chiff) {
    const c = E.ctx, f = Math.min(5000, mtof(m)), o = c.createOscillator(); o.setPeriodicWave(E.W[wave]); o.frequency.value = fq(f);
    if (ch.vib) ch.vib.connect(o.detune);
    const g = c.createGain(), a = 0.045, end = t + Math.max(0.06, d);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setTargetAtTime(v * 0.8, t + a, 0.18); g.gain.setTargetAtTime(0, end, 0.035);
    o.connect(g); g.connect(ch.in); o.start(t); o.stop(end + 0.2);
    const n = c.createBufferSource(); n.buffer = E.B.white; const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.frequency.value = fq(Math.min(12000, f * 2.5)); bf.Q.value = 1.5;
    const ng = c.createGain(); ng.gain.setValueAtTime(v * chiff, t); ng.gain.exponentialRampToValueAtTime(0.0005, t + 0.07);
    n.connect(bf); bf.connect(ng); ng.connect(ch.in); n.start(t, Math.random() * 1.5); n.stop(t + 0.08);
    clean(o, [o, g], ch.vib, o.detune); clean(n, [n, bf, ng]);
  }
  const INS = {
    harp(E, ch, t, m, d, v) { const r = pluckNode(E, ch.in, t, m, v, Math.min(3, d + 1.4)); clean(r.src, r.nodes); },
    pbass(E, ch, t, m, d, v) { const r = pluckNode(E, ch.in, t, m, v, Math.min(2, d + 0.25)); clean(r.src, r.nodes); },
    flute(E, ch, t, m, d, v) { windTone(E, ch, t, m, d, v, 'flute', 0.3); },
    whistle(E, ch, t, m, d, v) { windTone(E, ch, t, m, d, v, 'whistle', 0.18); },
    strings(E, ch, t, m, d, v) {
      const c = E.ctx, f = mtof(m), g = c.createGain(), a = Math.min(0.3, d * 0.4), end = t + d;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setTargetAtTime(0, end, 0.12);
      const nodes = [g]; let first = null;
      for (const det of [-8, 7]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq(f); o.detune.value = det; if (ch.vib) ch.vib.connect(o.detune); o.connect(g); o.start(t); o.stop(end + 0.55); nodes.push(o); if (!first) first = o; else clean(o, [], ch.vib, o.detune); }
      g.connect(ch.in); clean(first, nodes, ch.vib, first.detune);
    },
    stringsS(E, ch, t, m, d, v) {
      const c = E.ctx, f = mtof(m), g = c.createGain(), end = t + d;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.006); g.gain.setTargetAtTime(v * 0.35, t + 0.01, d * 0.35); g.gain.setTargetAtTime(0, end, 0.02);
      const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = o2.type = 'sawtooth'; o1.frequency.value = o2.frequency.value = fq(f); o2.detune.value = 9;
      o1.connect(g); o2.connect(g); g.connect(ch.in); o1.start(t); o2.start(t); o1.stop(end + 0.12); o2.stop(end + 0.12);
      clean(o1, [o1, o2, g]);
    },
    accordion(E, ch, t, m, d, v) {
      const c = E.ctx, f = mtof(m), g = c.createGain(), end = t + d;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.025); g.gain.setTargetAtTime(v * 0.85, t + 0.03, 0.1); g.gain.setTargetAtTime(0, end, 0.02);
      const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.setPeriodicWave(E.W.reed); o2.setPeriodicWave(E.W.reed);
      o1.frequency.value = o2.frequency.value = fq(f); o1.detune.value = -9; o2.detune.value = 10;
      o1.connect(g); o2.connect(g); g.connect(ch.in); o1.start(t); o2.start(t); o1.stop(end + 0.12); o2.stop(end + 0.12);
      clean(o1, [o1, o2, g]);
    },
    bass(E, ch, t, m, d, v) {
      const c = E.ctx, f = mtof(m), g = c.createGain(), end = t + d;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + 0.005); g.gain.setTargetAtTime(v * 0.55, t + 0.01, 0.12); g.gain.setTargetAtTime(0, end, 0.02);
      const o1 = c.createOscillator(), o2 = c.createOscillator(); o1.type = 'sawtooth'; o2.type = 'sine'; o1.frequency.value = fq(f); o2.frequency.value = fq(f);
      const g2 = c.createGain(); g2.gain.value = 0.55; o2.connect(g2); g2.connect(g);
      o1.connect(g); g.connect(ch.in); o1.start(t); o2.start(t); o1.stop(end + 0.12); o2.stop(end + 0.12);
      clean(o1, [o1, o2, g, g2]);
    },
    bell(E, ch, t, m, d, v) {
      const c = E.ctx, f = Math.min(6000, mtof(m)), g = c.createGain(), len = Math.max(1.2, d);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0005, t + len);
      const o1 = c.createOscillator(), o2 = c.createOscillator(), g2 = c.createGain();
      o1.frequency.value = fq(f); o2.frequency.value = fq(f * 2.756); g2.gain.setValueAtTime(0.3, t); g2.gain.exponentialRampToValueAtTime(0.001, t + len * 0.4);
      o1.connect(g); o2.connect(g2); g2.connect(g); g.connect(ch.in); o1.start(t); o2.start(t); o1.stop(t + len); o2.stop(t + len);
      clean(o1, [o1, o2, g, g2]);
    },
    choir(E, ch, t, m, d, v) {
      const c = E.ctx, f = mtof(m), g = c.createGain(), a = Math.min(0.45, d * 0.4), end = t + d;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + a); g.gain.setTargetAtTime(0, end, 0.14);
      const nodes = [g]; let first = null;
      for (const det of [-10, 11]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fq(f); o.detune.value = det; if (ch.vib) ch.vib.connect(o.detune); o.connect(g); o.start(t); o.stop(end + 0.65); nodes.push(o); if (!first) first = o; else clean(o, [], ch.vib, o.detune); }
      g.connect(ch.in); clean(first, nodes, ch.vib, first.detune);
    },
    brass(E, ch, t, m, d, v) { const r = brassNote(E.ctx, ch.in, t, mtof(m), 0.04, Math.max(0.02, d - 0.04), 0.25, v, 0.4 + v * 0.6); clean(r.src, r.nodes); },
    drum(E, ch, t, name, d, v) {
      const b = E.B[name]; if (!b) return;
      const src = E.ctx.createBufferSource(); src.buffer = b; const g = E.ctx.createGain(); g.gain.value = v;
      src.connect(g); g.connect(ch.in); src.start(t); clean(src, [src, g]);
    },
    wind(E, ch, t, m, d, v) {
      const c = E.ctx, src = c.createBufferSource(); src.buffer = E.B.pink; src.loop = true;
      const bf = c.createBiquadFilter(); bf.type = 'bandpass'; bf.Q.value = 2.2;
      bf.frequency.setValueAtTime(300, t); bf.frequency.exponentialRampToValueAtTime(1500, t + d * 0.45); bf.frequency.exponentialRampToValueAtTime(380, t + d);
      const g = c.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(v, t + d * 0.45); g.gain.linearRampToValueAtTime(0, t + d);
      src.connect(bf); bf.connect(g); g.connect(ch.in); src.start(t, Math.random()); src.stop(t + d + 0.05);
      clean(src, [src, bf, g]);
    },
  };

  /* ---------------- Track: one playing instance of a song ---------------- */
  function Track(E, sp, name) {
    prep(sp);
    const c = E.ctx;
    this.E = E; this.sp = sp; this.name = name; this.chs = {}; this.fi = 0; this.bi = 0; this.done = false;
    this.I = sp.adapt ? 0 : 3; this.fixedI = null; this.tr = 0; this.loops = 0; this.cprev = 72; this.lfos = []; this.pers = [];
    this.out = c.createGain(); this.out.gain.value = 0; this.out.connect(E.music);
    this.rv = c.createGain(); this.rv.gain.value = 0; this.rv.connect(E.musRev);
  }
  Track.prototype.start = function (t, fade) {
    const lv = this.sp.gain || 1;
    for (const g of [this.out, this.rv]) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(lv, t + Math.max(0.02, fade)); }
    this.nextT = t;
  };
  Track.prototype.stop = function (fade) {
    this.done = true; const t = this.E.ctx.currentTime;
    for (const g of [this.out, this.rv]) { g.gain.cancelScheduledValues(t); g.gain.setTargetAtTime(0, t, Math.max(0.01, fade / 3.5)); }
    setTimeout(() => this.dispose(), (fade + 4) * 1000);
  };
  Track.prototype.dispose = function () {
    for (const l of this.lfos) { try { l.stop(); } catch (e) { /* ok */ } }
    for (const n of this.pers) { try { n.disconnect(); } catch (e) { /* ok */ } }
    try { this.out.disconnect(); this.rv.disconnect(); } catch (e) { /* ok */ }
  };
  Track.prototype.channel = function (name) {
    let ch = this.chs[name]; if (ch) return ch;
    const cfg = CH[name] || CH[name.replace(/\d+$/, '')] || { vol: 0.3 }, c = this.E.ctx, P = this.pers;
    ch = { cfg }; ch.in = c.createGain(); P.push(ch.in); let last = ch.in;
    if (cfg.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = cfg.lp; f.Q.value = cfg.q || 0.7; last.connect(f); last = f; ch.lp = f; P.push(f); }
    if (cfg.formant) {
      const sum = c.createGain(); P.push(sum);
      for (const [f, q, gg] of [[320, 4, 0.7], [700, 6, 1], [1150, 7, 0.6], [2700, 9, 0.28]]) {
        const b = c.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = f; b.Q.value = q; const g = c.createGain(); g.gain.value = gg * 2.6;
        last.connect(b); b.connect(g); g.connect(sum); P.push(b, g);
      }
      last = sum;
    }
    ch.g = c.createGain(); ch.g.gain.value = cfg.vol; last.connect(ch.g); P.push(ch.g);
    let outN = ch.g;
    if (cfg.pan && c.createStereoPanner) { const pn = c.createStereoPanner(); pn.pan.value = cfg.pan; ch.g.connect(pn); outN = pn; P.push(pn); }
    outN.connect(this.out);
    if (cfg.rev) { const s = c.createGain(); s.gain.value = cfg.rev; outN.connect(s); s.connect(this.rv); P.push(s); }
    if (cfg.vib) {
      const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = cfg.vib[0]; lg.gain.value = cfg.vib[1];
      l.connect(lg); l.start(); this.lfos.push(l); P.push(l, lg); ch.vib = lg;
    }
    return (this.chs[name] = ch);
  };
  Track.prototype.updI = function () {
    if (this.fixedI != null) { this.I = this.fixedI; }
    else {
      const a = this.sp.adapt, R = G.run; if (!a || !R) return;
      let I = this.I;
      if (a === 'battle') { let n = 0; const es = R.enemies || []; for (let i = 0; i < es.length; i++) if (!es[i].dead) n++; I = cl(0.35 + (R.time || 0) / 170 + n / 110, 0, 3); }
      else if (a === 'boss') { const b = R.boss; const f = b && b.maxHp ? cl(b.hp / b.maxHp, 0, 1) : 0.5; I = 1 + 2 * (1 - f); }
      if (settings().reducedFx) I = Math.min(I, 1.7); else if (LITE) I = Math.min(I, 2.3);   // lighter arrangement on low-end devices
      this.I = I >= this.I ? I : Math.max(I, this.I - 0.6);
    }
    const s = this.chs.strings; if (s && s.lp && this.sp.adapt) s.lp.frequency.setTargetAtTime(1300 + this.I * 900, this.E.ctx.currentTime, 1.2);
  };
  Track.prototype.schedule = function (until) {
    const now = this.E.ctx.currentTime;
    if (this.E.live && this.nextT < now - 0.1) this.nextT = now + 0.05;  // fell behind (tab throttled) → resync
    let guard = 0;
    while (!this.done && this.nextT < until && guard++ < 64) this.bar();
  };
  Track.prototype.bar = function () {
    const sp = this.sp, sec = sp.sections[sp.form[this.fi]], bd = sp.beats * 60 / sp.bpm, t0 = this.nextT;
    if (this.bi % 4 === 0) this.updI();
    if (!this.E.live || settings().bgm) {
      const chords = sec._ch[this.bi % sec._ch.length];
      for (const p of sec.parts) {
        if (p.minI != null && this.I < p.minI) continue;
        if (p.maxI != null && this.I >= p.maxI) continue;
        try { gen(this, p, t0, bd, sec, this.bi, chords); } catch (e) { console.warn('[audio] part', e); }
      }
    }
    this.nextT += bd; this.bi++;
    if (this.bi >= sec.bars) {
      this.bi = 0; this.fi++;
      if (this.fi >= sp.form.length) {
        if (sp.loop == null || sp.loop < 0) this.done = true;
        else {
          this.fi = sp.loop; this.loops++;
          // avoid a samey loop: every other pass is lifted a step (battle only when the fight is hot)
          if (sp.lift) this.tr = (this.loops & 1) && (sp.adapt !== 'battle' || this.I >= 1.6) ? sp.lift : 0;
        }
      }
    }
  };
  function play(trk, p, ins, t, m, d, v) {
    const E = trk.E;
    t += ins === 'drum' ? rr(-0.002, 0.002) : rr(-0.008, 0.008);
    if (t < E.ctx.currentTime) t = E.ctx.currentTime;
    v *= rr(0.86, 1.06) * (p.vol || 1);
    if (ins !== 'drum' && trk.tr) m += trk.tr;
    INS[ins](E, trk.channel(p.chn || ins), t, m, d, v);
  }
  function gen(trk, p, t0, bd, sec, bi, chords) {
    const sp = trk.sp;
    if (p.first && bi !== 0) return; if (p.last && bi !== sec.bars - 1) return; if (p.every && bi % p.every) return;
    const chordAt = frac => chords[Math.min(chords.length - 1, Math.floor(frac * chords.length))];
    switch (p.fn) {
      case 'mel': {
        const M = sp._mels[p.mel], res = p.res || sp.mres, mb = Math.max(1, Math.round(M.n / res)), b = bi % mb, s0 = b * res, sd = bd / res;
        for (const n of M.notes) {
          if (n.s < s0 || n.s >= s0 + res) continue;
          const m = dm(sp, n.deg, n.oct + (p.oct || 0), n.acc), acc = (n.s - s0) % (res / (sp.beats || 4)) === 0 ? 1 : 0.85;
          play(trk, p, p.ins, t0 + (n.s - s0) * sd, m, n.len * sd * (p.leg || 0.93), acc);
        }
        break;
      }
      case 'arp': {
        const pat = p.pat, n = pat.length, sd = bd / n;
        for (let i = 0; i < n; i++) {
          const ch = pat[i]; if (ch === '.' || ch === '-') continue;
          let len = 1; while (pat[i + len] === '-') len++;
          const L = voiceList(chordAt(i / n), p.base);
          play(trk, p, p.ins, t0 + i * sd, L[+ch] || L[0], sd * len * (p.len || 1.4), i === 0 ? 1 : i % 4 === 0 ? 0.85 : 0.72);
        }
        break;
      }
      case 'pad': {
        const seg = bd / chords.length;
        chords.forEach((c, k) => { for (const m of voicing(c, p.c || 62)) play(trk, p, p.ins, t0 + k * seg, m, seg * 1.02, 0.8); if (p.root) play(trk, p, p.ins, t0 + k * seg, voiceList(c, p.root)[0], seg * 1.02, 0.7); });
        break;
      }
      case 'bass': {
        const s = p.pat, n = s.length, sd = bd / n;
        for (let i = 0; i < n; i++) {
          const ch = s[i]; if (ch === '.' || ch === '-') continue;
          let len = 1; while (s[i + len] === '-') len++;
          const c = chordAt(i / n); let r = c.root; while (r < p.base) r += 12; while (r >= p.base + 12) r -= 12;
          const lc = ch.toLowerCase(), m = lc === 'o' ? r + 12 : lc === '5' ? r + 7 : lc === '3' ? voiceList(c, r)[1] : r;
          play(trk, p, p.ins, t0 + i * sd, m, len * sd * 0.9, ch !== lc || i === 0 ? 1 : 0.72);
        }
        break;
      }
      case 'stab': {
        const s = p.pat, n = s.length, sd = bd / n;
        for (let i = 0; i < n; i++) {
          const ch = s[i]; if (ch === '.' || ch === '-') continue;
          let len = 1; while (s[i + len] === '-') len++;
          for (const m of voicing(chordAt(i / n), p.c || 64)) play(trk, p, p.ins, t0 + i * sd, m, len * sd * 0.7, ch === 'X' ? 1 : 0.7);
        }
        break;
      }
      case 'drums': {
        const P = p.fill && bi === sec.bars - 1 ? p.fill : p.pat;
        for (const k in P) {
          const s = P[k], n = s.length, sd = bd / n;
          for (let i = 0; i < n; i++) { const ch = s[i], vel = ch === 'X' ? 1 : ch === 'x' ? 0.7 : ch === 'o' ? 0.42 : 0; if (vel) play(trk, p, 'drum', t0 + i * sd, k, 0, vel); }
        }
        break;
      }
      case 'counter': {
        const n = p.steps || 4, sd = bd / n;
        for (let i = 0; i < n; i++) {
          const c = chordAt(i / n), cands = [];
          for (let m = p.lo; m <= p.hi; m++) for (const x of c.tones) if (((m - x) % 12 + 12) % 12 === 0) cands.push(m);
          if (!cands.length) continue;
          cands.sort((a, b) => (Math.abs(a - trk.cprev) + (a === trk.cprev ? 2.5 : 0)) - (Math.abs(b - trk.cprev) + (b === trk.cprev ? 2.5 : 0)));
          const m = cands[Math.random() < 0.7 ? 0 : Math.min(1, cands.length - 1)]; trk.cprev = m;
          play(trk, p, p.ins, t0 + i * sd, m, sd * 0.98, 0.8);
        }
        break;
      }
      case 'sparkle': {
        const n = p.n || 2;
        for (let i = 0; i < n; i++) {
          const st = (Math.random() * 8) | 0, c = chordAt(st / 8), L = voiceList(c, p.lo || 84);
          play(trk, p, p.ins || 'bell', t0 + st * bd / 8, L[(Math.random() * 4) | 0], 1.4, 0.7);
        }
        break;
      }
      case 'gliss': {
        const n = p.n || 12, span = (p.span || 1) * bd / sp.beats;
        for (let i = 0; i < n; i++) play(trk, p, p.ins || 'harp', t0 + (p.at || 0) * bd + i * span / n, dm(sp, 1 + i, p.oct || 0, 0), 0.6, 0.55 + i / n * 0.4);
        break;
      }
      case 'wind': play(trk, p, 'wind', t0, 0, bd * (p.len || 2), 1); break;
    }
  }

  /* =====================================================================================
     SONGBOOK — original compositions (pastoral European folk flavour)
     ===================================================================================== */
  const crash = { fn: 'drums', first: 1, pat: { crash: 'X' } };
  const SONGS = {};

  // ---------- TITLE: hopeful, adventurous, D major 106 bpm ----------
  (function () {
    const harp = { fn: 'arp', ins: 'harp', pat: '01234321', base: 50 };
    const harp16 = { fn: 'arp', ins: 'harp', pat: '0123432102345432', base: 50, vol: 0.62 };
    const pad = { fn: 'pad', ins: 'strings', c: 64 };
    const bass = { fn: 'bass', ins: 'pbass', pat: 'R---5---', base: 38 };
    const bass8 = { fn: 'bass', ins: 'pbass', pat: 'R-R-5-Ro', base: 38 };
    const bell = { fn: 'sparkle', ins: 'bell', n: 2, lo: 81 };
    const drA = { fn: 'drums', pat: { frame: 'X.......X.x.....', frameHi: '....x.......x..o', shaker: 'o.x.o.x.o.x.o.x.' } };
    const drC = { fn: 'drums', pat: { kick: 'X.......X.x.....', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.', tamb: '....x.......x...', frame: 'X.......X.......' },
      fill: { kick: 'X.......X.......', snare: '....X...X.x.XxXX', tomH: '........x.x.....', tomL: '............x.x.' } };
    const cnt = { fn: 'counter', ins: 'strings', chn: 'counter', lo: 66, hi: 79, steps: 2 };
    const acc = { fn: 'stab', ins: 'accordion', pat: '..x...x...x...x.', c: 66 };
    SONGS.title = {
      bpm: 106, gain: 1.1, beats: 4, key: 62, scale: 'major', mres: 8, loop: 1, lift: 0,
      mels: {
        A: "3 - 5 - 1' - 7 6 | 5 - - - 2 - 3 4 | 3 - 6 - 6 7 1' 7 | 6 - - - 4 - 5 6 | 5 - 3 - 1 - 3 5 | 7 - 6 - 5 - 7 - | 1' - 7 6 4 - 6 - | 5 - - - - - . .",
        B: "3 - - 2 1 - 6, - | 1 - - - 4 - 6 - | 5 - - 4 3 - 1 - | 2 - - - 5, - 7, - | 1 - 3 - 6 - 5 - | 4 - - - 6 - 1' - | 2' - 1' - 6 - 4 - | 5 - - - 4 - 2 -",
        C: "1' - - 7 6 - 5 - | 7 - - 1' 2' - 7 - | 5 - - 6 7 - 5 - | 1' - - - 3' - - - | 2' - 1' 7 6 - 4 - | 5 - 6 7 2' - 1' 7 | 1' - - - 5 - 3 - | 1' - - - - - . .",
        D: "6 - - - - - 5 - | 3 - - - - - . . | 4 - - - 6 - 1' - | 7 - - - 2' - - -",
        F: "1 - - - - - 5, 1 | 4 - - 5 6 - 1' - | 6 - 5 - 3 - 4 - | 5 - - - - - - -",
      },
      sections: {
        // opening: "ジャーン!" fanfare hit → harp gliss → timpani roll crescendo into the theme
        intro: { ch: ['1', '4', '6', '5s:5'], parts: [{ ...pad, vol: 0.7 }, bell,
          { fn: 'mel', ins: 'brass', chn: 'brassLead', mel: 'F', oct: 1 }, { fn: 'stab', ins: 'brass', pat: 'X---------------', c: 62, first: 1 },
          { fn: 'drums', first: 1, pat: { crash: 'X', taiko: 'X' } }, { fn: 'gliss', first: 1, n: 14, span: 2, at: 0.5, oct: 1 },
          { fn: 'arp', ins: 'harp', pat: '0123432101234321', base: 50, vol: 0.5, minI: 0 },
          { fn: 'drums', last: 1, pat: { tomL: 'o.o.o.oxoxxxXXXX', crash: '...............x' } },
          { fn: 'wind', every: 2, len: 2 }] },
        A: { ch: ['1', '5', '6', '4', '1', '5', '4', '5'], parts: [harp, pad, bass, { fn: 'mel', ins: 'flute', mel: 'A', oct: 1 }] },
        B: { ch: ['6', '4', '1', '5', '6', '4', '2', '5s:5'], parts: [harp16, pad, bass, drA, cnt, { fn: 'mel', ins: 'flute', mel: 'B', oct: 1 }] },
        C: { ch: ['4', '5', '3', '6', '2', '5', '1', '1'], parts: [harp16, pad, bass8, drC, crash, acc, { ...cnt, lo: 69, hi: 81 }, bell,
          { fn: 'pad', ins: 'choir', c: 67, vol: 0.8 }, { fn: 'stab', ins: 'brass', pat: 'X-----x-X---x---', c: 60, vol: 0.6 }, { fn: 'drums', every: 2, pat: { taiko: 'X.......X.......' } },
          { fn: 'mel', ins: 'flute', mel: 'C', oct: 1 }, { fn: 'mel', ins: 'whistle', mel: 'C', oct: 2, vol: 0.55 }] },
        A2: { ch: ['1', '5', '6', '4', '1', '5', '4', '5'], parts: [harp16, pad, bass8, drA, acc, bell, { fn: 'mel', ins: 'flute', mel: 'A', oct: 1 }, { fn: 'mel', ins: 'whistle', mel: 'A', oct: 2, vol: 0.45 }] },
        D: { ch: ['4', '6', '4', '5s'], parts: [{ ...harp, vol: 0.8 }, pad, { fn: 'mel', ins: 'flute', mel: 'D', oct: 1 }, { fn: 'gliss', last: 1, n: 12, span: 2, at: 0.5, oct: 1 }] },
      },
      form: ['intro', 'A', 'B', 'C', 'A2', 'D'],
    };
  })();

  // ---------- HOME: calm, cosy lyre waltz, G major 3/4 84 bpm ----------
  (function () {
    const arp = { fn: 'arp', ins: 'harp', pat: '0.2343', base: 43, vol: 0.8 };
    const arp2 = { fn: 'arp', ins: 'harp', pat: '024354', base: 43, vol: 0.7 };
    const pad = { fn: 'pad', ins: 'strings', c: 62, vol: 0.5 };
    const lyre = mel => ({ fn: 'mel', ins: 'harp', chn: 'lyre', mel, oct: 1 });
    SONGS.home = {
      bpm: 84, gain: 1.7, beats: 3, key: 55, scale: 'major', mres: 6, loop: 0,
      mels: {
        A: "3 - 5 - 1' - | 7 - 6 - - - | 4 - 6 - 1' - | 2' - 7 - - - | 1' - 7 - 5 - | 6 - 5 - 3 - | 4 - 3 - 2 - | 2 - - - - -",
        B: "6 - - - 5 4 | 5 - - - 2 - | 5 - - - 3 - | 1 - - - - - | 4 - 5 - 6 - | 5 - 3 - 1 - | 2 - 4 - 6 - | 5 - - - - -",
      },
      sections: {
        A: { ch: ['1', '6', '4', '5', '1', '6', '2', '5'], parts: [arp, pad, lyre('A'), { fn: 'sparkle', ins: 'bell', n: 1, every: 2, lo: 79 }] },
        B: { ch: ['4', '5', '3', '6', '4', '1', '2', '5'], parts: [arp, pad, { fn: 'mel', ins: 'flute', mel: 'B', oct: 1, vol: 0.8 }] },
        A2: { ch: ['1', '6', '4', '5', '1', '6', '2', '5'], parts: [arp2, pad, lyre('A'), { fn: 'mel', ins: 'flute', mel: 'A', oct: 1, vol: 0.4 }] },
        C: { ch: ['1', '3', '4', '1', '6', '2', '4', '5s:5'], parts: [arp2, pad, { fn: 'sparkle', ins: 'bell', n: 2, lo: 79 }, { fn: 'counter', ins: 'harp', chn: 'lyre', lo: 67, hi: 79, steps: 3, vol: 0.7 }] },
      },
      form: ['A', 'B', 'A2', 'C'],
    };
  })();

  // ---------- BATTLE: driving folk-rock reel, A dorian 4/4 140 bpm, adaptive layers ----------
  (function () {
    const harp = { fn: 'arp', ins: 'harp', pat: '02343234', base: 45, vol: 0.75 };
    const harp16 = { fn: 'arp', ins: 'harp', pat: '0234543202345432', base: 45, vol: 0.55 };
    const bass = { fn: 'bass', ins: 'bass', pat: 'RrroRr5o', base: 33 };
    const pad = { fn: 'pad', ins: 'strings', c: 64, vol: 0.8 };
    const lead = mel => ({ fn: 'mel', ins: 'flute', mel, oct: 1 });
    const lead2 = mel => ({ fn: 'mel', ins: 'whistle', mel, oct: 2, vol: 0.5, minI: 2.6 });
    const acc = { fn: 'stab', ins: 'accordion', pat: '.x.x.x.x', c: 64, minI: 1.2 };
    const ost = { fn: 'arp', ins: 'stringsS', pat: '0323032303230323', base: 57, minI: 1.8 };
    const cnt = { fn: 'counter', ins: 'strings', chn: 'counter', lo: 64, hi: 77, steps: 2, minI: 2.2 };
    const choir = { fn: 'pad', ins: 'choir', c: 67, minI: 2.6 };
    const dBase = { fn: 'drums', maxI: 0.8, pat: { kick: 'X.....x.X.x.....', hat: '..x...x...x...x.', frame: '....o.......o...' } };
    const dFull = { fn: 'drums', minI: 0.8, pat: { kick: 'X.....x.X.x.....', snare: '....X......oX...', hat: 'x.x.x.x.x.x.x.x.' },
      fill: { kick: 'X.....x.X.......', snare: '....X...X.xxXXXX', tomH: '........X.x.....', tomL: '............x.x.' } };
    const dHigh = { fn: 'drums', minI: 2, pat: { shaker: 'oxoxoxoxoxoxoxox', tamb: '....x.......x...' } };
    const dCrash = { ...crash, minI: 1.5 };
    const hits = { fn: 'stab', ins: 'brass', pat: 'X..X..X.....X.x.', c: 60, vol: 0.75, minI: 2.4 };            // brass hits when the screen is full
    const dTaiko = { fn: 'drums', minI: 2.8, pat: { taiko: 'X.......X..x....', tomL: '..........x...x.' } };  // war drums at max heat
    const core = [harp, bass, pad, acc, ost, dBase, dFull, dHigh, dCrash, hits, dTaiko];
    SONGS.battle = {
      bpm: 140, gain: 0.9, beats: 4, key: 57, scale: 'dorian', mres: 8, loop: 1, adapt: 'battle', lift: 2,
      mels: {
        A: "5 1' 1' 2' 3' 2' 1' 5 | 7 - 4 5 7 - 2' 7 | 6 - 4 6 1' 6 4 6 | 5 - 3 1 5 - . . | 5 1' 1' 2' 3' 2' 1' 5 | 7 - 2' 7 4' - 2' 7 | 1' - 6 4 6 - 1' 2' | 3' - 2' 1' #7 - 5 -",
        B: "6 - - 1' 4' - 3' 2' | 1' - 6 - 4 - 6 - | 5 - - - 1' - 3' - | 5' - - - 3' - - - | 4' - - 2' 7 - 2' - | 4' - 3' 2' 7 - 5 - | 6 - 1' - 4' - 3' 2' | 5 - #7 - 2' - 5' -",
        C: "3' - 3' 2' 3' 5' 3' 2' | 2' - 7 - 4' - 2' - | 1' - 6 - 1' 2' 3' 4' | 3' - - - 1' - 5 - | 5' - 3' 2' 3' - 5' - | 4' - 2' 7 2' - 7 5 | #7 - 5 #7 2' - #7 2' | 5' - - - - - . .",
      },
      sections: {
        intro: { ch: ['1', '1'], parts: [bass, dBase, dFull, { fn: 'gliss', last: 1, n: 14, span: 2, at: 0.5, oct: 1 }] },
        A: { ch: ['1', '7', '4', '1', '1', '7', '4', '5M'], parts: [...core, lead('A'), lead2('A')] },
        A2: { ch: ['1', '7', '4', '1', '1', '7', '4', '5M'], parts: [...core, cnt, choir, lead('A'), lead2('A')] },
        B: { ch: ['4', '4', '1', '1', '7', '7', '4', '5M'], parts: [harp16, bass, pad, acc, ost, dBase, dFull, dHigh, dCrash, cnt, choir, lead('B'), lead2('B')] },
        C: { ch: ['3', '7', '4', '1', '3', '7', '5M', '5M'], parts: [...core, cnt, { ...choir, minI: 2 }, lead('C'), lead2('C'), { fn: 'sparkle', ins: 'bell', n: 2, minI: 1.5 }] },
        D: { ch: ['4', '4', '7', '5M'], parts: [harp16, pad, { ...choir, minI: 0.5 }, { fn: 'bass', ins: 'bass', pat: 'R-------', base: 33 },
          { fn: 'drums', pat: { tomL: 'X..x..X.X..x..X.', frame: 'X.......X.......', shaker: 'o.o.o.o.o.o.o.o.' }, fill: { snare: 'x.x.x.x.xxxxXXXX', tomL: 'X.......X.......', kick: 'X...X...X...X.X.' } }] },
      },
      form: ['intro', 'A', 'A2', 'B', 'C', 'D'],
    };
  })();

  // ---------- BOSS (Ruin Guard): mechanical, tense E minor 132 bpm ----------
  (function () {
    const pulse = { fn: 'bass', ins: 'bass', pat: 'RrrrRrroRrrrRr5o', base: 40 };
    const dr = { fn: 'drums', pat: { kick: 'X..x..X...X..x..', snare: '....X.......X...', clank: '..x..x....x..x.x', tick: 'xoxoxoxoxoxoxoxo' },
      fill: { kick: 'X..x..X.X.X.X.X.', snare: '....X...X.X.XXXX', clank: 'x.x.x.x.x.x.x.x.', tomL: '........X...X...' } };
    const pad = { fn: 'pad', ins: 'strings', c: 59, vol: 0.85 };
    const stab = { fn: 'stab', ins: 'brass', pat: 'X..X..X.........', c: 55, vol: 0.8 };
    const harp = { fn: 'arp', ins: 'harp', pat: '0123212301232123', base: 52, vol: 0.5 };
    SONGS.boss = {
      bpm: 132, gain: 0.9, beats: 4, key: 52, scale: 'minor', mres: 8, loop: 1, adapt: 'boss', lift: 1,
      mels: {
        A: "1' - - - 7 1' 2' - | 3' - 2' - 1' - 7 - | 1' - - - 6 - 5 - | #7 - - - 5 - - - | 1' - - - 5' - 4' 3' | 2' - 3' - 1' - 7 - | 6 - 1' - 3' - 1' - | #7 - - - - - . .",
        B: "1' - - - - - - - | 4' - - - 3' - - - | 1' - - - - - - - | #7 - - - 2' - - - | 1' - - - - - - - | 4' - - - 6' - - - | 3' - - - 1' - - - | #7 - - - - - - -",
      },
      sections: {
        intro: { ch: ['1', '1'], parts: [pulse, { fn: 'drums', pat: { tick: 'xoxoxoxoxoxoxoxo', clank: 'x.......x.......' } }, { ...pad, vol: 0.6 }] },
        A: { ch: ['1', '1', '6', '5M', '1', '1', '6', '5M'], parts: [pulse, dr, pad, stab, harp, crash, { fn: 'mel', ins: 'brass', chn: 'brassLead', mel: 'A', oct: 1 }, { fn: 'mel', ins: 'bell', mel: 'A', oct: 2, vol: 0.5, minI: 2 }] },
        B: { ch: ['4', '4', '6', '5M', '4', '4', '6', '5M'], parts: [pulse, dr, pad, stab, harp, crash, { fn: 'mel', ins: 'choir', chn: 'choirLead', mel: 'B', oct: 1 }, { fn: 'counter', ins: 'strings', chn: 'counter', lo: 64, hi: 76, steps: 4, minI: 1.8 }] },
        C: { ch: ['1', '1'], parts: [pulse, { fn: 'pad', ins: 'choir', c: 64 }, { fn: 'drums', pat: { kick: 'X...X...X...X...', clank: '..x...x...x...x.', tick: 'xxxxxxxxxxxxxxxx' }, fill: { snare: 'x.x.x.x.xxxxXXXX', kick: 'X...X...X...X...' } }] },
      },
      form: ['intro', 'A', 'B', 'A', 'C'],
    };
  })();

  // ---------- FINAL (Venti): epic, windy, heroic D minor 150 bpm ----------
  (function () {
    const ost = { fn: 'arp', ins: 'stringsS', pat: '0323032303230323', base: 50 };
    const ostLo = { fn: 'arp', ins: 'stringsS', chn: 'stringsS2', pat: '0101010101010101', base: 38, minI: 1.6, vol: 0.9 };
    const dr = { fn: 'drums', pat: { taiko: 'X.......X..X....', kick: 'X...X...X...X...', snare: '....X.......X...', hat: 'x.x.x.x.x.x.x.x.' },
      fill: { taiko: 'X..X..X.X.X.XXXX', snare: '....X...X.X.XXXX', kick: 'X...X...X...X...' } };
    const dHigh = { fn: 'drums', minI: 2, pat: { shaker: 'oxoxoxoxoxoxoxox', tamb: '....x.......x...' } };
    const choir = { fn: 'pad', ins: 'choir', c: 64 };
    const pad = { fn: 'pad', ins: 'strings', c: 57, vol: 0.7 };
    const bass = { fn: 'bass', ins: 'bass', pat: 'RrrrRro5', base: 38 };
    const harp = { fn: 'arp', ins: 'harp', pat: '0234543202345432', base: 50, vol: 0.55 };
    const wind = { fn: 'wind', every: 2 };
    const stab = { fn: 'stab', ins: 'brass', pat: 'X.....X.....X...', c: 57, minI: 2 };
    const core = [ost, ostLo, dr, dHigh, choir, pad, bass, harp, wind, stab, crash];
    SONGS.final = {
      bpm: 150, gain: 0.85, beats: 4, key: 50, scale: 'minor', mres: 8, loop: 1, adapt: 'boss', lift: 1,
      mels: {
        A: "1' - - - 5 - 1' 2' | 3' - - 2' 1' - 6 - | 3' - - - 5 - 7 - | 7 - - - 1' - 2' - | 5' - - - 3' - 1' - | 4' - 3' - 2' - 1' - | 3' - - - 5' - 3' - | 2' - - - - - - -",
        B: "1' - - - 3' - - - | 2' - - - 7 - - - | 1' - - - - - 5 - | 1' - - - - - - - | 3' - - - 4' - - - | 5' - - - 4' - 2' - | #7 - - - 2' - - - | 5 - - - #7 - 2' -",
        C: "3' - - 4' 3' - 1' - | 2' - - - 4' - 5' - | 5' - - - 3' - - - | 3' - - - 1' - 6 - | 4' - - - 1' - 6 - | #7 - 2' - 5' - - - | 5' - - - 3' - 1' - | 1' - - - - - . .",
      },
      sections: {
        intro: { ch: ['1', '1'], parts: [ost, { fn: 'drums', pat: { taiko: 'X.......X..X....' } }, { fn: 'wind', first: 1 }, { ...choir, vol: 0.6 }] },
        A: { ch: ['1', '6', '3', '7', '1', '6', '3', '7'], parts: [...core, { fn: 'mel', ins: 'brass', chn: 'brassLead', mel: 'A', oct: 1 }] },
        B: { ch: ['6', '7', '1', '1', '6', '7', '5M', '5M'], parts: [...core, { fn: 'mel', ins: 'flute', mel: 'B', oct: 1 }, { fn: 'mel', ins: 'whistle', mel: 'B', oct: 2, vol: 0.6 }] },
        A2: { ch: ['1', '6', '3', '7', '1', '6', '3', '7'], parts: [...core, { fn: 'mel', ins: 'brass', chn: 'brassLead', mel: 'A', oct: 1 }, { fn: 'mel', ins: 'whistle', mel: 'A', oct: 2, vol: 0.4, minI: 1.5 }, { fn: 'counter', ins: 'strings', chn: 'counter', lo: 62, hi: 74, steps: 2 }] },
        C: { ch: ['6', '7', '3', '6', '4', '5M', '1', '1'], parts: [...core, { fn: 'mel', ins: 'brass', chn: 'brassLead', mel: 'C', oct: 1 }, { fn: 'mel', ins: 'whistle', mel: 'C', oct: 2, vol: 0.5 }, { fn: 'sparkle', ins: 'bell', n: 2 }] },
        D: { ch: ['6', '5M'], parts: [choir, pad, { fn: 'wind', first: 1 }, ost, { fn: 'drums', pat: { taiko: 'X.......X.......', tomL: '....x.......x...' }, fill: { taiko: 'X..X..X.X.X.XXXX', snare: 'x.x.x.x.xxxxXXXX' } }] },
      },
      form: ['intro', 'A', 'B', 'A2', 'C', 'D'],
    };
  })();

  // ---------- VICTORY: fanfare jingle, then a warm loop (C major 116 bpm) ----------
  (function () {
    const harp = { fn: 'arp', ins: 'harp', pat: '01234321', base: 48, vol: 0.8 };
    const pad = { fn: 'pad', ins: 'strings', c: 64, vol: 0.7 };
    SONGS.victory = {
      bpm: 116, gain: 1.15, beats: 4, key: 60, scale: 'major', mres: 8, loop: 1,
      mels: {
        J: "1 3 4 6 - 5 - 7 | 1' - - - - - . .",
        A: "5 - - - 3 - 1 - | 6 - - - 4 - 1' - | 1' - - - 7 - 6 - | 5 - - - - - . . | 3' - - - 1' - 5 - | 6 - 1' - 4' - 2' - | 2' - 1' - 6 - 4 - | 5 - - - - - . .",
      },
      sections: {
        jingle: { ch: ['4:5', '1'], parts: [
          { fn: 'mel', ins: 'brass', chn: 'brassLead', mel: 'J', oct: 1 }, { fn: 'mel', ins: 'bell', mel: 'J', oct: 2, vol: 0.7 },
          { fn: 'stab', ins: 'brass', pat: 'X---X---', c: 60, vol: 0.8 },
          { fn: 'drums', pat: { tomL: 'oooooooxxxxxXXXX' }, fill: { crash: 'X', taiko: 'X', kick: 'X' } },
          { fn: 'gliss', first: 1, n: 14, span: 3, oct: 1 }, { fn: 'bass', ins: 'pbass', pat: 'R---R---', base: 36 }] },
        A: { ch: ['1', '4', '6', '5', '1', '4', '2', '5'], parts: [harp, pad, { fn: 'mel', ins: 'flute', mel: 'A', oct: 1 }, { fn: 'bass', ins: 'pbass', pat: 'R---5---', base: 36 }, { fn: 'sparkle', ins: 'bell', n: 1 }] },
        B: { ch: ['6', '4', '1', '5', '6', '4', '5s', '5'], parts: [harp, pad, { fn: 'bass', ins: 'pbass', pat: 'R---5---', base: 36 }, { fn: 'sparkle', ins: 'bell', n: 2 }, { fn: 'counter', ins: 'harp', chn: 'lyre', lo: 67, hi: 79, steps: 4 }] },
      },
      form: ['jingle', 'A', 'B'],
    };
  })();

  // ---------- DEFEAT: short sad jingle (A minor 72 bpm), no loop ----------
  SONGS.defeat = {
    bpm: 72, beats: 4, key: 57, scale: 'minor', mres: 8, loop: -1,
    mels: { A: "6 - 5 - 4 - 3 - | 2 - - - #7, - - - | 1 - - - - - - -" },
    sections: {
      a: { ch: ['4', '5M', '1'], parts: [{ fn: 'mel', ins: 'flute', mel: 'A', oct: 1 }, { fn: 'pad', ins: 'strings', c: 60 }, { fn: 'arp', ins: 'harp', pat: '0123', base: 45, vol: 0.7 }, { fn: 'bass', ins: 'pbass', pat: 'R-------', base: 33 }] },
      end: { ch: ['1'], parts: [] },
    },
    form: ['a', 'end'],
  };

  /* =====================================================================================
     TRANSPORT
     ===================================================================================== */
  function bgm(name) {
    wantTrack = name || null;
    if (!ctx || !A) return;
    if (cur && cur.name === name && !cur.done) return;
    const now = ctx.currentTime, jingle = name === 'victory' || name === 'defeat', had = !!(cur && !cur.done);
    if (cur) { cur.stop(jingle ? 0.4 : 1.0); cur = null; }
    if (!name || !SONGS[name]) return;
    cur = new Track(A, SONGS[name], name);
    cur.start(now + (had && !jingle ? 0.3 : 0.06), had && !jingle ? 1.0 : 0.03);
    tick();
  }
  function tick() {
    if (!ctx || !A) return;
    const now = ctx.currentTime;
    if (ctx.state === 'running' && cur) cur.schedule(now + 0.2);
    const p = !!(G.scene === 'run' && G.run && !G.run.over && G.game && G.game.isPaused());
    if (p !== pausedFx) {
      pausedFx = p;
      A.pf.frequency.cancelScheduledValues(now); A.pg.gain.cancelScheduledValues(now);
      A.pf.frequency.setTargetAtTime(p ? 850 : fq(20000), now, p ? 0.12 : 0.3);
      A.pg.gain.setTargetAtTime(p ? 0.6 : 1, now, 0.15);
    }
  }
  function applySettings() {
    if (!A) return;
    const s = settings(), t = ctx.currentTime;
    const sv = s.sfx ? (s.sfxVolume != null ? s.sfxVolume : 0.8) : 0, bv = s.bgm ? (s.bgmVolume != null ? s.bgmVolume : 0.6) * 0.85 : 0;
    A.sfxVol.gain.setTargetAtTime(sv, t, 0.03); A.bgmVol.gain.setTargetAtTime(bv, t, 0.05);
  }
  function onVis() {
    if (!ctx) return;
    if (document.hidden) { if (ctx.state === 'running') { ctx.suspend().catch(() => {}); hiddenSuspended = true; } }
    else if (hiddenSuspended) { hiddenSuspended = false; ctx.resume().catch(() => {}); }
  }
  function init() {
    if (!AC) return;
    if (!ctx) {
      try { ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { try { ctx = new AC(); } catch (e2) { return; } }
      try { A = makeEnv(ctx, true); } catch (e) { console.warn('[audio] init failed', e); ctx = null; A = null; return; }
      applySettings();
      try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { /* iOS unlock */ }
      timer = setInterval(tick, 25);
      document.addEventListener('visibilitychange', onVis);
      if (ctx.addEventListener) ctx.addEventListener('statechange', () => { if (ctx.state === 'running' && wantTrack && !cur) bgm(wantTrack); });
    }
    if (ctx.state !== 'running' && !document.hidden) { const pr = ctx.resume(); if (pr && pr.catch) pr.catch(() => {}); }
    if (wantTrack && !cur) bgm(wantTrack);
  }
  // extra unlock listeners (iOS Safari needs touchend/click)
  ['touchend', 'click', 'pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => { if (!ctx || ctx.state !== 'running') init(); }, { passive: true, capture: true }));

  /* ---------------- automatic musical context from the game bus ---------------- */
  function autoSfx(name, o) { setTimeout(() => { const l = lastPlay[name]; if (!l || performance.now() - l > 250) sfx(name, o); }, 40); }
  if (G.bus) {
    const isFinal = e => !!(e && (e.final || (e.def && e.def.final) || e.kind === 'venti'));
    G.bus.on('bossSpawn', e => { bgm(isFinal(e) ? 'final' : 'boss'); duck(0.3, 1); });
    G.bus.on('bossKilled', e => { if (isFinal(e)) return; setTimeout(() => { const R = G.run; if (R && !R.over && !R.boss && cur && cur.name === 'boss') bgm('battle'); }, 1500); autoSfx('bossDeath'); });
    G.bus.on('runEnd', R => bgm(R && R.victory ? 'victory' : 'defeat'));
    G.bus.on('burst', () => { duck(0.5, 1.8); autoSfx('burst'); });
    G.bus.on('bossWarning', () => { duck(0.5, 2.5); autoSfx('bossWarning'); });
    G.bus.on('levelUp', () => autoSfx('levelup'));
    G.bus.on('evolution', () => autoSfx('evolution'));
    G.bus.on('resonance', () => autoSfx('resonance'));
    G.bus.on('chestOpen', () => autoSfx('chestOpen'));
    G.bus.on('reaction', r => { if (r && r.type) autoSfx('reaction', { type: r.type, x: r.x, y: r.y }); });
    G.bus.on('playerHurt', () => autoSfx('hurt'));
    G.bus.on('saveReset', () => applySettings());
    G.bus.on('burstReady', () => autoSfx('burstReady'));
    G.bus.on('revive', () => autoSfx('revive'));
    // critical hits: a light "shing" layered on the hit (throttled; the table GAP/LIMIT keep it from spamming)
    G.bus.on('enemyHit', h => { if (h && h.crit && !h.reaction && ctx && ctx.state === 'running') sfx('crit', { x: h.enemy && h.enemy.x, y: h.enemy && h.enemy.y, vol: h.dmg > 0 && h.enemy && h.enemy.maxHp && h.dmg > h.enemy.maxHp * 0.3 ? 1 : 0.6 }); });
  }

  /* ---------------- offline render test (debug / CI) ---------------- */
  function render(what, seconds, opts) {
    opts = opts || {}; seconds = seconds || 4;
    if (!OAC) return Promise.reject(new Error('no OfflineAudioContext'));
    const sr = 44100, oc = new OAC(2, Math.ceil(sr * seconds), sr), E = makeEnv(oc, false);
    E.sfxVol.gain.value = 0.8; E.bgmVol.gain.value = 0.6 * 0.85;
    if (what === 'mix') {  // stress test: opts.track (music) + opts.list [[name, atSec, o], ...] all into one render
      const saved = A; A = E;
      try {
        if (opts.track) { const trk = new Track(E, SONGS[opts.track], opts.track); if (opts.intensity != null) trk.fixedI = opts.intensity; trk.start(0, 0.01); trk.schedule(seconds); }
        (opts.list || []).forEach(([name, at, o]) => { o = o || {}; const v = voice(o, name); v.t += at || 0; SFX[name](v, o); finish(v); });
      } finally { A = saved; }
    } else if (what.indexOf('sfx:') === 0) {
      const name = what.slice(4), saved = A; A = E;
      try { const o = opts.o || {}; const v = voice(o, name); SFX[name](v, o); finish(v); } finally { A = saved; }
    } else {
      const trk = new Track(E, SONGS[what], what); if (opts.intensity != null) trk.fixedI = opts.intensity;
      if (opts.skipBars) { for (let i = 0; i < opts.skipBars; i++) { const sp = trk.sp, sec = sp.sections[sp.form[trk.fi]]; trk.bi++; if (trk.bi >= sec.bars) { trk.bi = 0; trk.fi++; if (trk.fi >= sp.form.length) trk.fi = Math.max(0, sp.loop); } } }
      trk.start(0, 0.01); trk.schedule(seconds);
    }
    return oc.startRendering();
  }
  function stats(buf) {
    let sum = 0, peak = 0, clip = 0, n = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) { const x = Math.abs(d[i]); sum += x * x; if (x > peak) peak = x; if (x > 0.99) clip++; n++; } }
    const rms = Math.sqrt(sum / n); return { rms: +rms.toFixed(4), db: +(20 * Math.log10(rms + 1e-9)).toFixed(1), peak: +peak.toFixed(3), clip };
  }
  function wav(buf) {
    const ch = buf.numberOfChannels, len = buf.length, bytes = new Uint8Array(44 + len * ch * 2), dv = new DataView(bytes.buffer);
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) bytes[o + i] = s.charCodeAt(i); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + len * ch * 2, true); ws(8, 'WAVEfmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, ch, true);
    dv.setUint32(24, buf.sampleRate, true); dv.setUint32(28, buf.sampleRate * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, len * ch * 2, true);
    const data = []; for (let c = 0; c < ch; c++) data.push(buf.getChannelData(c));
    let o = 44; for (let i = 0; i < len; i++) for (let c = 0; c < ch; c++) { dv.setInt16(o, cl(data[c][i], -1, 1) * 32767, true); o += 2; }
    let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  return {
    init, applySettings, sfx, bgm, duck,
    get ctx() { return ctx; },
    get track() { return cur ? cur.name : null; },
    get intensity() { return cur ? cur.I : 0; },
    sfxNames: Object.keys(SFX), tracks: Object.keys(SONGS), _songs: SONGS,
    state() { return { ctx: ctx ? ctx.state : 'none', track: cur && cur.name, intensity: cur && +cur.I.toFixed(2), voices: active.length, paused: pausedFx }; },
    _renderTest(what, seconds, opts) { return render(what, seconds, opts).then(stats); },
    _renderWav(what, seconds, opts) { return render(what, seconds, opts).then(b => ({ stats: stats(b), wav: wav(b) })); },
  };
})();
