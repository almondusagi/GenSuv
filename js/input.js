/* input.js — keyboard / mouse / touch (landscape virtual stick + buttons) / gamepad.
   Game code reads:  G.input.move {x,y} (length<=1),  G.input.consume('skill'|'burst'|'pause') -> bool
   Touch layer DOM lives in #touch (built here, styled in css/style.css). */
'use strict';
G.input = (function () {
  const keys = new Set();
  const queued = new Set();            // one-shot actions waiting to be consumed
  const move = { x: 0, y: 0 };
  const stick = { active: false, id: -1, ox: 0, oy: 0, x: 0, y: 0, max: 56 };
  let touchMode = false, lastPointerType = 'mouse';
  let root, stickBase, stickKnob, stickDir, btnSkill, btnBurst, btnPause;

  const ACTIONS = {
    skill: ['KeyF', 'Space', 'KeyJ', 'ShiftLeft'],
    burst: ['KeyQ', 'KeyK', 'KeyR'],
    pause: ['Escape', 'KeyE', 'KeyP', 'Tab'],
  };
  function actionOf(code) { for (const a in ACTIONS) if (ACTIONS[a].includes(code)) return a; return null; }

  function onKey(e, down) {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    const a = actionOf(e.code);
    if (down) { if (!keys.has(e.code) && a) { queued.add(a); G.bus.emit('action', a); } keys.add(e.code); }
    else keys.delete(e.code);
    if (a || /^(Arrow|Key[WASD])/.test(e.code)) { if (G.scene === 'run') e.preventDefault(); }
    if (down) setTouchMode(false, 'key');
  }

  function setTouchMode(on, why) {
    const pref = G.save.data.settings.touchControls;
    if (pref === 'on') on = true; else if (pref === 'off') on = false;
    if (on === touchMode) return;
    touchMode = on;
    document.body.classList.toggle('touch', touchMode);
    G.bus.emit('touchMode', touchMode);
  }

  function build() {
    root = document.getElementById('touch');
    root.innerHTML = `
      <div class="t-stick-zone" id="tStickZone"></div>
      <div class="t-stick" id="tStick"><div class="t-base"></div><div class="t-dir" id="tDir"></div><div class="t-knob" id="tKnob"></div></div>
      <button class="t-btn t-skill" id="tSkill" aria-label="元素スキル"><span class="t-cd"></span><img alt="" src="assets/icon_bunny.webp"><em class="t-sec"></em><b>スキル</b></button>
      <button class="t-btn t-burst" id="tBurst" aria-label="元素爆発"><span class="t-fire" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></span><svg class="t-ring" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg><span class="t-cd"></span><img alt="" src="assets/icon_rain.webp"><em class="t-sec"></em><i class="t-rdy">READY!</i><b>爆発</b></button>
      <button class="t-btn t-pause" id="tPause" aria-label="休憩">❚❚</button>`;
    stickBase = document.getElementById('tStick'); stickKnob = document.getElementById('tKnob'); stickDir = document.getElementById('tDir');
    btnSkill = document.getElementById('tSkill'); btnBurst = document.getElementById('tBurst'); btnPause = document.getElementById('tPause');
    const zone = document.getElementById('tStickZone');

    zone.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse') return;
      if (stick.active && stick.id !== e.pointerId) return;           // a second finger in the zone must not steal the stick
      e.preventDefault();
      try { zone.setPointerCapture(e.pointerId); } catch (_) { }        // can throw (InvalidPointerId) on some browsers / synthetic events
      stick.active = true; stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY; stick.x = 0; stick.y = 0;
      stickBase.style.left = e.clientX + 'px'; stickBase.style.top = e.clientY + 'px';
      stickBase.classList.remove('rel'); stickBase.classList.add('on');
      updateKnob();
    });
    zone.addEventListener('pointermove', e => {
      if (!stick.active || e.pointerId !== stick.id) return;
      let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy; const l = Math.hypot(dx, dy);
      if (l > stick.max) { // drag the base along (floating stick feels better on phones)
        const k = (l - stick.max) / l; stick.ox += dx * k; stick.oy += dy * k; dx = e.clientX - stick.ox; dy = e.clientY - stick.oy;
        stickBase.style.left = stick.ox + 'px'; stickBase.style.top = stick.oy + 'px';
      }
      stick.x = dx / stick.max; stick.y = dy / stick.max; updateKnob();
    });
    const end = e => {
      if (e.pointerId !== stick.id) return;
      stick.active = false; stick.id = -1; stick.x = stick.y = 0;
      stickBase.classList.remove('on'); stickBase.classList.add('rel'); updateKnob();
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end); zone.addEventListener('lostpointercapture', end);

    const tap = (btn, action, buzz) => btn.addEventListener('pointerdown', e => {
      e.preventDefault(); e.stopPropagation(); queued.add(action); G.bus.emit('action', action);
      btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
      haptic(buzz);
    });
    tap(btnSkill, 'skill', 12); tap(btnBurst, 'burst', 18); tap(btnPause, 'pause', 8);
    btnSkill.addEventListener('contextmenu', e => e.preventDefault()); btnBurst.addEventListener('contextmenu', e => e.preventDefault());
  }
  function updateKnob() {
    const m = stick.max, x = stick.x, y = stick.y;
    stickKnob.style.transform = `translate(${(x * m).toFixed(1)}px, ${(y * m).toFixed(1)}px)`;
    const l = Math.min(1, Math.hypot(x, y));
    if (stickDir) { stickDir.style.opacity = l > 0.15 ? (0.35 + l * 0.65).toFixed(2) : '0'; if (l > 0.15) stickDir.style.transform = `rotate(${Math.atan2(y, x).toFixed(3)}rad)`; }
  }
  /** remaining-cooldown seconds on a touch button ("3.2" / "12"), empty when ready */
  function secText(b, sec) {
    const t = sec > 0.05 ? (sec >= 10 ? String(Math.ceil(sec)) : sec.toFixed(1)) : '';
    const n = b._sec || (b._sec = b.querySelector('.t-sec'));
    if (n && n._t !== t) { n._t = t; n.textContent = t; }
  }
  /** vibration feedback (touch devices only, respects the screen-shake setting as "physical feedback" preference) */
  let lastBuzz = 0;
  function haptic(pattern, minGap) {
    if (!touchMode || !navigator.vibrate) return;
    const s = G.save && G.save.data && G.save.data.settings; if (!s || s.vibrate === false) return;
    const now = performance.now(); if (minGap && now - lastBuzz < minGap) return; lastBuzz = now;
    try { navigator.vibrate(pattern); } catch (_) { }
  }
  G.bus.on('playerHurt', () => { if (G.scene === 'run') haptic(22, 280); });
  G.bus.on('burst', () => haptic([18, 40, 28], 0));
  G.bus.on('levelUp', () => haptic([10, 30, 14], 200));
  G.bus.on('evolution', () => haptic([20, 50, 20, 50, 40], 0));
  G.bus.on('bossWarning', () => haptic([60, 80, 60, 80, 60], 0));
  G.bus.on('bossKilled', () => haptic([30, 40, 80], 0));
  G.bus.on('scene', () => { stick.active = false; stick.id = -1; stick.x = stick.y = 0; if (stickBase) { stickBase.classList.remove('on'); updateKnob(); } });

  let gpPrev = {};
  function pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) {
      if (!p) continue;
      const ax = p.axes[0] || 0, ay = p.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.2) { move.x = ax; move.y = ay; }
      const map = { 0: 'skill', 1: 'burst', 2: 'skill', 3: 'burst', 9: 'pause' };
      for (const i in map) { const pr = p.buttons[i] && p.buttons[i].pressed; if (pr && !gpPrev[i]) queued.add(map[i]); gpPrev[i] = pr; }
      return;
    }
  }

  return {
    move,
    get touchMode() { return touchMode; },
    setTouchMode,
    haptic,
    init() {
      build();
      addEventListener('keydown', e => onKey(e, true));
      addEventListener('keyup', e => onKey(e, false));
      addEventListener('blur', () => { keys.clear(); stick.active = false; stick.id = -1; stick.x = stick.y = 0; G.bus.emit('blur'); });
      addEventListener('pointerdown', e => { lastPointerType = e.pointerType; if (e.pointerType === 'touch') setTouchMode(true, 'touch'); }, true);
      const canvas = document.getElementById('game');
      canvas.addEventListener('contextmenu', e => e.preventDefault());
      canvas.addEventListener('mousedown', e => {
        if (G.scene !== 'run') return;
        if (e.button === 0) queued.add('skill'); else if (e.button === 2) queued.add('burst');
      });
      const coarse = matchMedia && matchMedia('(pointer: coarse)').matches;
      setTouchMode(coarse || 'ontouchstart' in window, 'init');
    },
    /** per-frame: compute move vector from keyboard / stick / pad */
    update() {
      let x = 0, y = 0;
      if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
      if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
      if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
      if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
      if (x || y) { const l = Math.hypot(x, y); x /= l; y /= l; }
      if (stick.active) {
        let l = Math.hypot(stick.x, stick.y); const dead = 0.12;
        if (l > dead) { const k = Math.min(1, (l - dead) / (1 - dead)) / l; x = stick.x * k; y = stick.y * k; }
      }
      move.x = x; move.y = y;
      pollGamepad();
    },
    consume(action) { if (queued.has(action)) { queued.delete(action); return true; } return false; },
    clear() { queued.clear(); },
    /** update cooldown overlays on touch buttons: frac 0..1 remaining, ready flags */
    setButtons(skillFrac, burstFrac, burstReady, energyFrac, skillSec, burstSec) {
      if (!btnSkill) return;
      secText(btnSkill, skillSec); secText(btnBurst, burstSec);
      if (burstReady && !btnBurst.classList.contains('ready')) { btnBurst.classList.remove('flare'); void btnBurst.offsetWidth; btnBurst.classList.add('flare'); }
      btnSkill.style.setProperty('--cd', skillFrac.toFixed(3));
      btnBurst.style.setProperty('--cd', burstFrac.toFixed(3));
      btnBurst.style.setProperty('--en', energyFrac.toFixed(3));
      btnSkill.classList.toggle('ready', skillFrac <= 0);
      btnBurst.classList.toggle('ready', !!burstReady);
    },
  };
})();
