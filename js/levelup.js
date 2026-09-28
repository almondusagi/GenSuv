/* levelup.js — PROGRESSION UIs (owner: PROGRESSION):
     G.ui.levelUp(R, offer, onPick)            gorgeous level-up card picker (keys 1-4 / arrows / Enter, reroll)
     G.ui.chest(R, tier, keys, mora, done, got) Genshin-wish-style chest reveal (tap to skip)
     G.progressionUI.renderMeta(container)      天賦の星図 star-map skill tree over G.data.meta (G.data.metaTree layout)
     G.progressionUI.renderConstellation(container)  Amber 命ノ星座 C1–C6
     G.progressionUI.glyph(name) / art(key) / ensureCss()  shared helpers (also used by relics.js)
   All CSS is scoped under .pg-* and injected as <style id="progression-css">. */
'use strict';
G.progressionUI = (function () {
  const U = G.u;
  const RC = { 3: '#6fb7ff', 4: '#c28bff', 5: '#ffc34a' };

  /* ------------------------------------------------------------------ glyphs (simple original SVG symbols) */
  const P = {
    atk: '<path d="M20.5 2.5l1 1-10.8 12.3-2.5-2.5z"/><path d="M5.2 12.6l6.2 6.2-1.6 1.6-1.6-1.3-3.3 3.3-1.5-1.5 3.3-3.3-1.3-1.6z"/>',
    hp: '<path d="M12 21.2s-8.6-5.4-8.6-11.4A4.8 4.8 0 0 1 12 6.9a4.8 4.8 0 0 1 8.6 2.9c0 6-8.6 11.4-8.6 11.4z"/>',
    def: '<path d="M12 1.8l8.4 3.1v6.2c0 5.3-3.6 9.4-8.4 11.1-4.8-1.7-8.4-5.8-8.4-11.1V4.9z"/>',
    shield: '<path d="M12 1.8l8.4 3.1v6.2c0 5.3-3.6 9.4-8.4 11.1-4.8-1.7-8.4-5.8-8.4-11.1V4.9z"/><path fill="#0006" d="M12 5l5 1.9v4.3c0 3.3-2.1 6-5 7.2z"/>',
    shieldR: '<path d="M12 4.5l6 2.2v4.4c0 3.8-2.6 6.7-6 7.9-3.4-1.2-6-4.1-6-7.9V6.7z"/><path d="M1 12l3-3v6zM23 12l-3-3v6z"/>',
    shieldD: '<path d="M12 4.5l6 2.2v4.4c0 3.8-2.6 6.7-6 7.9-3.4-1.2-6-4.1-6-7.9V6.7z"/><path d="M12 0l1.5 3h-3zM2 6l3.2 1-1.6 2.3zM22 6l-3.2 1 1.6 2.3zM12 24l-1.5-3h3z"/>',
    speed: '<path d="M3 4.5h4.2l7.2 7.5-7.2 7.5H3l7.2-7.5z"/><path d="M11 4.5h4.2l7.2 7.5-7.2 7.5H11l7.2-7.5z"/>',
    haste: '<path d="M22 12l-7-7v4.5H2v5h13V19z"/><path fill="#0005" d="M2 11h13v2H2z"/>',
    er: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M13.5 4.5L7.5 13h4l-1 6.5 6-8.5h-4z"/>',
    cr: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="1.8"/><path d="M11 0h2v5h-2zM11 19h2v5h-2zM0 11h5v2H0zM19 11h5v2h-5z"/>',
    cd: '<path d="M12 .8l2.6 7.4 7.6-1.6-5.2 5.8 5.2 5.8-7.6-1.6L12 23.2l-2.6-7.4-7.6 1.6 5.2-5.8-5.2-5.8 7.6 1.6z"/>',
    boom: '<path d="M12 1l2 6 5-4-1.5 6.2L23 10l-5 3.5 3.5 5.5-6-1.6L13 23l-2.2-5.8L5 20l2.6-5.4L1 12.5l6.4-1.8L4 4.5l6 2.6z"/>',
    magnet: '<path d="M4 3h5v9a3 3 0 0 0 6 0V3h5v9a8 8 0 0 1-16 0z"/><path fill="#0006" d="M4 3h5v3.2H4zM15 3h5v3.2h-5z"/>',
    mora: '<circle cx="12" cy="12" r="10"/><path fill="#0005" d="M12 5l5 7-5 7-5-7z"/><circle cx="12" cy="12" r="2" fill="#fff8"/>',
    chest: '<path d="M3 10h18v11H3z"/><path d="M4.5 3.5h15L21 9H3z"/><path fill="#0006" d="M10 12h4v4h-4z"/>',
    reroll: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5h-3.4A5.1 5.1 0 1 1 12 6.9v3.3l5.6-5-5.6-5z"/>',
    revive: '<path d="M12 1c1.5 4 6 5.5 6 11a6 6 0 0 1-12 0c0-2.4 1.2-4 2.4-5.2.2 2 1 3 2 3.2C10 7.5 10.8 4 12 1z"/><path fill="#0006" d="M11 11h2v3h3v2h-3v3h-2v-3H8v-2h3z"/>',
    star: '<path d="M12 1.6l3.1 6.9 7.5.8-5.6 5 1.6 7.4L12 17.9l-6.6 3.8L7 14.3l-5.6-5 7.5-.8z"/>',
    flower: '<circle cx="12" cy="5.6" r="4"/><circle cx="18.2" cy="10.2" r="4"/><circle cx="15.8" cy="17.6" r="4"/><circle cx="8.2" cy="17.6" r="4"/><circle cx="5.8" cy="10.2" r="4"/><circle cx="12" cy="12" r="3.2" fill="#0005"/>',
    plume: '<path d="M20.5 2C11 3 5.5 9 4.5 17.5L3 22l1.6.3 1.5-4.3C15 17 20 11 20.5 2z"/><path fill="#0005" d="M6.5 17.2L17 6l.6.6L7.4 18z"/>',
    sands: '<path d="M5 1.5h14v2.4l-5.2 8.1 5.2 8.1v2.4H5v-2.4l5.2-8.1L5 3.9z"/><path fill="#0005" d="M8 5h8l-4 5.8zM12 15.5l3.8 5H8.2z"/>',
    goblet: '<path d="M5 1.5h14c0 5.6-2.6 9-5.4 10v6h4.4v4.2H6v-4.2h4.4v-6C7.6 10.5 5 7.1 5 1.5z"/><path fill="#0005" d="M7.2 3.5h9.6c-.5 3-2 5.2-4.8 5.9C9.2 8.7 7.7 6.5 7.2 3.5z"/>',
    circlet: '<path d="M1.5 7.5l5.5 4.3L12 3.5l5 8.3 5.5-4.3-2.2 12.4H3.7z"/><circle cx="12" cy="14.5" r="2.2" fill="#0005"/>',
    arrows: '<path d="M21.5 2.5l.6 5.2-1.9-1.9-9.4 9.4-1.4-1.4 9.4-9.4-1.9-1.9z"/><path d="M21.5 9.5l.6 5.2-1.9-1.9-6.4 6.4-1.4-1.4 6.4-6.4-1.9-1.9z" opacity=".75"/><path d="M14.5 2.5l.6 5.2-1.9-1.9-6.4 6.4-1.4-1.4 6.4-6.4-1.9-1.9z" opacity=".75"/><path d="M3 21l3.2-6.2 3 3z"/>',
    eye: '<path d="M12 5C6.5 5 2.6 9.2 1 12c1.6 2.8 5.5 7 11 7s9.4-4.2 11-7c-1.6-2.8-5.5-7-11-7zm0 11.2a4.2 4.2 0 1 1 0-8.4 4.2 4.2 0 0 1 0 8.4z"/><circle cx="12" cy="12" r="2"/>',
    book: '<path d="M2 4.5C5 3 8.5 3 12 5c3.5-2 7-2 10-.5V20c-3-1.5-6.5-1.5-10 .5-3.5-2-7-2-10-.5z"/><path fill="#0006" d="M11.2 6.2h1.6v13h-1.6z"/>',
    lock: '<path d="M6 10V7a6 6 0 0 1 12 0v3h1.5v12h-15V10zm3 0h6V7a3 3 0 0 0-6 0z"/>',
  };
  function glyph(name, cls) {
    return '<svg class="pg-glyph ' + (cls || '') + '" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' + (P[name] || P.star) + '</svg>';
  }
  const stars = n => '<span class="pg-stars">' + glyph('star').repeat(n) + '</span>';

  /* ------------------------------------------------------------------ upgrade art */
  const EL_CELL = { pyro: [0, 0], hydro: [1, 0], cryo: [0, 1], electro: [1, 1] };
  const STAT_COL = { atk: '#ff8a5c', hp: '#6ff09a', def: '#ffd24a', speed: '#5cf2c8', haste: '#ffb86b', er: '#c28bff', cr: '#ff6a8a', cd: '#ff9ad0',
    magnet: '#7fe3ff', shield: '#ffd24a', shieldR: '#ffe38a', shieldD: '#ffb347', mora: '#ffd24a', chest: '#ffb347', reroll: '#9fe8c8', revive: '#ff8a5c', boom: '#ff7a3d' };
  function elBadge(el) {
    if (EL_CELL[el]) { const c = EL_CELL[el]; return `<i class="pg-elb" style="background-position:${c[0] * 100}% ${c[1] * 100}%"></i>`; }
    if (el === 'anemo' || el === 'geo') return `<i class="pg-elb pg-elb-g" style="color:${G.EL[el].color}">${glyph(el === 'anemo' ? 'speed' : 'def')}</i>`;
    return '';
  }
  function art(key, big) {
    const up = G.upgrades[key] || (G.progression.def && G.progression.def(key)) || {};
    let h = '';
    if (key === 'explosion_radius') h = '<i class="pg-sheet" style="background-image:url(assets/fx_explosion.webp);background-size:400% 200%;background-position:66.66% 0"></i>';
    else if (up.cat === 'stat' && up.glyph) h = `<i class="pg-orb" style="--c:${STAT_COL[up.glyph] || '#fff'}">${glyph(up.glyph)}</i>`;
    else if (up.cat === 'bless') h = `<i class="pg-orb pg-gorb" style="--c:#ffc34a">${glyph(up.glyph || 'star')}</i><img class="pg-gico" src="assets/icon_${up.icon || 'relic'}.webp" alt="" draggable="false">`;
    else h = `<img src="assets/icon_${up.icon || 'relic'}.webp" alt="" draggable="false">`;
    if (up.badge) h += `<b class="pg-badge">${up.badge}</b>`;
    if (up.el && up.cat !== 'stat') h += elBadge(up.el);
    return `<div class="pg-art${big ? ' big' : ''}">${h}</div>`;
  }
  const CAT = { char: 'アンバー専用', launcher: 'ランチャー', stat: 'ステータス', evo: '進化', special: 'ボーナス', bless: '★5 天啓' };
  const nl = s => String(s || '').replace(/\n/g, '<br>');

  /* ------------------------------------------------------------------ CSS */
  const CSS = `
.pg-ov{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;overflow:hidden;
  background:radial-gradient(ellipse at 50% 45%,#16384acc 0,#07141bee 70%);font-family:var(--font,sans-serif);color:#fff4d6;z-index:30;
  padding:calc(8px + env(safe-area-inset-top,0px)) calc(12px + env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) calc(12px + env(safe-area-inset-left,0px))}
.pg-ov.closing{animation:pgFade .2s ease-in forwards}
@keyframes pgFade{to{opacity:0}}
.pg-rays{position:absolute;left:50%;top:40%;width:170vmax;height:170vmax;margin:-85vmax 0 0 -85vmax;pointer-events:none;opacity:.22;
  background:repeating-conic-gradient(from 0deg,#ffe7a8 0 5deg,transparent 5deg 15deg);-webkit-mask:radial-gradient(circle,#000 0,transparent 55%);mask:radial-gradient(circle,#000 0,transparent 55%);
  animation:pgSpin 30s linear infinite}
@keyframes pgSpin{to{transform:rotate(360deg)}}
.pg-glyph{width:1em;height:1em;display:inline-block;vertical-align:-.12em}
.pg-stars{display:inline-flex;gap:1px;color:#ffd24a;filter:drop-shadow(0 1px 1px #0009)}
.pg-stars .pg-glyph{width:.95em;height:.95em}
/* ---- level-up title ---- */
.pg-lvtitle{position:relative;text-align:center;margin-bottom:clamp(6px,2vh,18px);pointer-events:none}
.pg-lvtitle h2{margin:0;font-size:clamp(34px,8vh,68px);font-weight:900;letter-spacing:.04em;font-style:italic;line-height:1;
  background:linear-gradient(180deg,#fffbe8 10%,#ffe07a 45%,#ff9d3c 90%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 14px #ffb34788) drop-shadow(0 3px 0 #7a3a0a);animation:pgTitle .45s cubic-bezier(.2,1.6,.4,1) both}
.pg-lvtitle .pg-lvnum{display:inline-block;margin-top:4px;padding:2px 14px;border-radius:99px;font-weight:900;font-size:clamp(13px,2.6vh,18px);
  background:linear-gradient(90deg,transparent,#0008 20%,#0008 80%,transparent);color:#ffe7a8;animation:pgUp .4s .1s both}
@keyframes pgTitle{0%{transform:scale(2.6) rotate(-6deg);opacity:0}100%{transform:none;opacity:1}}
@keyframes pgUp{0%{transform:translateY(12px);opacity:0}100%{transform:none;opacity:1}}
/* ---- cards ---- */
.pg-cards{position:relative;display:flex;gap:clamp(8px,1.6vw,20px);justify-content:center;align-items:stretch;perspective:900px;max-width:100%}
.pg-card{--rc:#6fb7ff;--bg1:#27476f;--bg2:#4d7fb8;position:relative;width:clamp(150px,21vw,236px);min-height:clamp(250px,58vh,390px);padding:0;border:0;border-radius:14px;
  background:#101f2b;color:#fff4d6;text-align:center;cursor:pointer;display:flex;flex-direction:column;overflow:hidden;font-family:inherit;outline:none;
  box-shadow:0 0 0 2px var(--rc),0 10px 28px #000a;transform-origin:50% 80%;animation:pgCardIn .32s cubic-bezier(.2,1.25,.4,1) both;animation-delay:var(--d,0s);
  transition:transform .12s ease-out,box-shadow .12s ease-out,filter .12s;pointer-events:none}
.pg-cards.ready .pg-card{pointer-events:auto}
.pg-card.r4{--rc:#c28bff;--bg1:#43336f;--bg2:#8a62c2}
.pg-card.r5{--rc:#ffc34a;--bg1:#6b3f1c;--bg2:#c7832f}
@keyframes pgCardIn{0%{transform:translateY(60px) rotateY(80deg) scale(.8);opacity:0}100%{transform:none;opacity:1}}
.pg-card:hover,.pg-card.sel{transform:translateY(-8px) scale(1.04);box-shadow:0 0 0 3px var(--rc),0 0 26px var(--rc),0 14px 30px #000b;z-index:2}
.pg-card.sel::after{content:"";position:absolute;inset:0;border-radius:inherit;box-shadow:inset 0 0 0 2px #fff8;pointer-events:none}
.pg-card .pg-top{position:relative;height:clamp(96px,24vh,168px);flex:none;background:radial-gradient(circle at 50% 60%,#fff3 0,transparent 60%),linear-gradient(160deg,var(--bg2),var(--bg1));overflow:hidden}
.pg-card .pg-top::before{content:"";position:absolute;inset:-50%;background:repeating-conic-gradient(from 0deg,#fff1 0 8deg,transparent 8deg 24deg);animation:pgSpin 18s linear infinite}
.pg-card.r5 .pg-top::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,#fff6 45%,transparent 60%);background-size:250% 100%;animation:pgShine 1.8s ease-in-out infinite}
@keyframes pgShine{0%{background-position:150% 0}100%{background-position:-100% 0}}
.pg-art{position:absolute;left:50%;top:50%;height:80%;max-width:72%;aspect-ratio:1;transform:translate(-50%,-44%);display:flex;align-items:center;justify-content:center}
.pg-art img,.pg-art .pg-sheet{width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 4px 6px #0008);background-repeat:no-repeat}
.pg-card:hover .pg-art img,.pg-card.sel .pg-art img{animation:pgBob .6s ease-in-out infinite alternate}
@keyframes pgBob{to{transform:translateY(-5px) rotate(-4deg)}}
.pg-orb{width:78%;aspect-ratio:1;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:clamp(34px,8vh,64px);
  background:radial-gradient(circle at 35% 30%,#fff9,var(--c) 45%,#0006 100%);box-shadow:0 0 22px var(--c),inset 0 0 0 3px #fff6}
.pg-orb .pg-glyph{filter:drop-shadow(0 2px 2px #0008)}
.pg-badge{position:absolute;right:2%;bottom:4%;min-width:1.6em;padding:0 .3em;border-radius:99px;background:#fff;color:#b3261e;font-size:clamp(13px,2.4vh,18px);font-weight:900;line-height:1.5;box-shadow:0 2px 6px #0008}
.pg-elb{position:absolute;left:0;top:0;width:30%;aspect-ratio:1;background:url(assets/icon_vfx_auras.webp) no-repeat;background-size:200% 200%;filter:drop-shadow(0 1px 3px #000)}
.pg-elb-g{background:none;display:flex;align-items:center;justify-content:center;font-size:clamp(16px,3vh,26px)}
.pg-new,.pg-lvl{position:absolute;top:8px;right:8px;z-index:2;font-weight:900;font-size:clamp(11px,2vh,14px);padding:2px 9px;border-radius:99px}
.pg-new{background:linear-gradient(90deg,#ff5a4d,#ffb347);color:#fff;box-shadow:0 0 10px #ff7a3d;animation:pgPulse 1s ease-in-out infinite alternate}
@keyframes pgPulse{to{transform:scale(1.12)}}
.pg-cat{position:absolute;left:8px;top:8px;z-index:2;font-size:clamp(10px,1.8vh,12px);font-weight:800;padding:1px 7px;border-radius:6px;background:#0007;color:#fff}
.pg-key{position:absolute;left:8px;bottom:6px;z-index:2;width:22px;height:22px;border-radius:6px;background:#0008;border:1px solid #fff5;font-size:12px;font-weight:900;line-height:20px;color:#fff}
.pg-body{flex:1;display:flex;flex-direction:column;align-items:center;gap:3px;padding:6px 10px 10px;background:linear-gradient(#0e1c27,#132634)}
.pg-body .pg-stars{font-size:clamp(11px,2.2vh,15px);margin-top:-2px}
.pg-name{font-weight:900;font-size:clamp(15px,3.2vh,21px);line-height:1.15;text-shadow:0 2px 0 #0008}
.pg-pips{display:flex;gap:3px;margin:1px 0 2px}
.pg-pips i{width:clamp(8px,1.6vh,11px);height:clamp(8px,1.6vh,11px);transform:rotate(45deg);border:1.5px solid var(--rc);border-radius:2px;background:#0005}
.pg-pips i.on{background:var(--rc);box-shadow:0 0 6px var(--rc)}
.pg-pips i.next{background:#fff;border-color:#fff;animation:pgPip .5s ease-in-out infinite alternate}
@keyframes pgPip{from{transform:rotate(45deg) scale(1)}to{transform:rotate(45deg) scale(1.35);box-shadow:0 0 8px #fff}}
.pg-desc{font-size:clamp(11.5px,2.3vh,14.5px);line-height:1.4;color:#e8f1ef;font-weight:700}
.pg-desc b{color:#ffe07a;font-weight:900}
.pg-hint{margin-top:auto;font-size:clamp(10px,1.9vh,12px);font-weight:800;color:#ffd98a;background:#ffb3471f;border:1px dashed #ffb34788;border-radius:8px;padding:2px 7px;line-height:1.35}
.pg-hint.have{color:#fff;background:#ffb34755;border-style:solid;animation:pgPulse .8s ease-in-out infinite alternate}
.pg-foot{display:flex;gap:12px;align-items:center;justify-content:center;margin-top:clamp(8px,2.2vh,18px);animation:pgUp .3s .35s both}
.pg-btn{font-family:inherit;font-weight:900;font-size:clamp(13px,2.6vh,16px);color:#fff4d6;border:2px solid #f0d49a;border-radius:99px;padding:7px 18px;min-height:40px;
  background:linear-gradient(#2b5664,#173b43);box-shadow:0 4px 12px #0008;cursor:pointer;transition:transform .1s,filter .1s}
.pg-btn:hover:not(:disabled){transform:scale(1.06);filter:brightness(1.2)}
.pg-btn:active:not(:disabled){transform:scale(.96)}
.pg-btn:disabled{opacity:.45;cursor:default}
.pg-btn.gold{background:linear-gradient(#ffe07a,#e0a13a);color:#4a2a05;border-color:#fff3c4}
.pg-tip{font-size:12px;color:#fff9;font-weight:700}
.pg-cards.picked .pg-card{animation:pgOut .25s ease-in forwards}
.pg-cards.picked .pg-card.chosen{animation:pgChosen .32s ease-out forwards}
@keyframes pgOut{to{transform:translateY(40px) scale(.85);opacity:0}}
@keyframes pgChosen{40%{transform:translateY(-14px) scale(1.12);filter:brightness(1.8)}100%{transform:translateY(-30px) scale(1.05);opacity:0;filter:brightness(2.5)}}
/* ---- chest (wish) ---- */
.pg-chest{background:radial-gradient(ellipse at 50% 60%,#1c2f55 0,#070b18 75%);cursor:pointer}
.pg-sky{position:absolute;inset:0;pointer-events:none;background-image:radial-gradient(1.5px 1.5px at 20% 30%,#fff,transparent),radial-gradient(1px 1px at 70% 20%,#fff,transparent),
  radial-gradient(1.5px 1.5px at 85% 60%,#fffc,transparent),radial-gradient(1px 1px at 40% 80%,#fff,transparent),radial-gradient(1px 1px at 55% 45%,#fffa,transparent),
  radial-gradient(1.5px 1.5px at 10% 70%,#fff,transparent),radial-gradient(1px 1px at 30% 12%,#fff,transparent),radial-gradient(1px 1px at 92% 35%,#fff,transparent);
  background-size:320px 240px;animation:pgTwinkle 3s ease-in-out infinite alternate;opacity:.8}
@keyframes pgTwinkle{to{opacity:.35}}
.pg-tier{position:absolute;top:calc(10px + env(safe-area-inset-top,0px));left:0;right:0;text-align:center;font-weight:900;font-size:clamp(16px,3.4vh,24px);letter-spacing:.1em;
  color:#fff4d6;text-shadow:0 0 12px var(--tc,#6fb7ff),0 2px 0 #0009;animation:pgUp .3s both}
.pg-box{position:absolute;left:50%;top:52%;width:clamp(110px,26vh,200px);aspect-ratio:1;transform:translate(-50%,-50%);animation:pgDrop .5s cubic-bezier(.3,1.5,.5,1) both}
.pg-box img{width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 0 20px var(--tc,#6fb7ff))}
.pg-box.shake{animation:pgShake .45s linear infinite}
.pg-box.gone{animation:pgBoxOpen .3s ease-in forwards}
@keyframes pgDrop{0%{transform:translate(-50%,-160%) scale(.6);opacity:0}100%{transform:translate(-50%,-50%);opacity:1}}
@keyframes pgShake{0%,100%{transform:translate(-50%,-50%) rotate(0)}25%{transform:translate(-52%,-50%) rotate(-5deg)}75%{transform:translate(-48%,-50%) rotate(5deg)}}
@keyframes pgBoxOpen{to{transform:translate(-50%,-50%) scale(1.7);opacity:0;filter:brightness(4)}}
.pg-meteor{position:absolute;left:0;top:0;width:34vmax;height:6px;border-radius:99px;transform-origin:100% 50%;pointer-events:none;
  background:linear-gradient(90deg,transparent,var(--mc) 70%,#fff);box-shadow:0 0 18px var(--mc),0 0 42px var(--mc);animation:pgMeteor .85s cubic-bezier(.5,0,.8,.6) forwards}
.pg-meteor::after{content:"";position:absolute;right:-14px;top:50%;width:30px;height:30px;margin-top:-15px;border-radius:50%;background:radial-gradient(circle,#fff 0,var(--mc) 40%,transparent 70%)}
@keyframes pgMeteor{0%{transform:translate(calc(-4vw - 34vmax),-8vh) rotate(30deg);opacity:0}15%{opacity:1}85%{opacity:1}100%{transform:translate(calc(50vw - 34vmax),52vh) rotate(30deg);opacity:0}}
.pg-bloom{position:absolute;inset:0;pointer-events:none;background:radial-gradient(circle at 50% 55%,#fff 0,var(--mc) 30%,transparent 75%);animation:pgBloom .7s ease-out forwards}
@keyframes pgBloom{0%{opacity:0}15%{opacity:1}100%{opacity:0}}
.pg-reveal{position:relative;display:flex;gap:clamp(8px,1.8vw,22px);justify-content:center;align-items:flex-end;margin-top:clamp(20px,5vh,40px)}
.pg-slot{position:relative;width:clamp(140px,20vw,210px);display:flex;flex-direction:column;align-items:center}
.pg-pillar{position:absolute;left:50%;bottom:30%;width:70%;height:120vh;transform:translateX(-50%);pointer-events:none;
  background:linear-gradient(0deg,var(--rc) 0,transparent 80%);opacity:0;filter:blur(4px);-webkit-mask:linear-gradient(90deg,transparent,#000 30%,#000 70%,transparent);mask:linear-gradient(90deg,transparent,#000 30%,#000 70%,transparent)}
.pg-slot.show .pg-pillar{animation:pgPillar 1.1s ease-out forwards}
@keyframes pgPillar{0%{opacity:0;transform:translateX(-50%) scaleX(.2)}25%{opacity:.95;transform:translateX(-50%) scaleX(1.1)}100%{opacity:.35;transform:translateX(-50%) scaleX(.8)}}
.pg-slot .pg-card{width:100%;min-height:clamp(210px,50vh,330px);opacity:0;animation:none;pointer-events:none;cursor:default}
.pg-slot.show .pg-card{animation:pgRise .45s cubic-bezier(.2,1.3,.4,1) forwards}
.pg-slot.instant .pg-card{animation:none;opacity:1}
.pg-slot.instant .pg-pillar{opacity:.3}
@keyframes pgRise{0%{opacity:0;transform:translateY(40px) scale(.7);filter:brightness(3)}100%{opacity:1;transform:none;filter:none}}
.pg-evo-banner{position:absolute;left:0;right:0;top:18%;text-align:center;pointer-events:none;z-index:5;font-weight:900;font-style:italic;font-size:clamp(44px,12vh,96px);letter-spacing:.08em;
  background:linear-gradient(180deg,#fff 0,#ffe07a 40%,#ff9d3c 100%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 24px #ffb347) drop-shadow(0 4px 0 #7a3a0a);animation:pgEvo 1.6s ease-out forwards}
@keyframes pgEvo{0%{transform:scale(3);opacity:0}15%{transform:scale(1);opacity:1}75%{opacity:1}100%{transform:scale(1.1) translateY(-20px);opacity:0}}
.pg-card.evo{box-shadow:0 0 0 3px #ffc34a,0 0 34px #ffb347,0 10px 28px #000a}
.pg-card.evo .pg-top{background:radial-gradient(circle at 50% 60%,#fff8 0,transparent 55%),conic-gradient(from 0deg,#ff9d3c,#ffe07a,#ff6a3d,#ffe07a,#ff9d3c)}
.pg-sparks{position:absolute;inset:0;pointer-events:none;overflow:hidden}
.pg-spark{position:absolute;width:8px;height:8px;border-radius:50%;background:radial-gradient(circle,#fff,var(--sc,#ffd24a) 50%,transparent 70%);animation:pgSpark var(--t,1s) ease-out forwards}
@keyframes pgSpark{0%{transform:translate(0,0) scale(1);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(.2);opacity:0}}
.pg-mora{position:relative;margin-top:clamp(8px,2.5vh,20px);display:flex;align-items:center;gap:8px;font-weight:900;font-size:clamp(20px,5vh,40px);color:#ffe07a;text-shadow:0 0 14px #ffb347,0 3px 0 #6b3f00;opacity:0}
.pg-mora.show{animation:pgUp .3s forwards}
.pg-mora img{width:1.3em;height:1.3em}
.pg-coin{position:absolute;width:clamp(22px,5vh,36px);height:clamp(22px,5vh,36px);pointer-events:none;animation:pgCoin var(--t,1.2s) cubic-bezier(.2,.7,.5,1) forwards}
@keyframes pgCoin{0%{transform:translate(0,0) rotate(0);opacity:1}60%{opacity:1}100%{transform:translate(var(--dx),var(--dy)) rotate(var(--r,360deg));opacity:0}}
.pg-close{position:absolute;bottom:calc(12px + env(safe-area-inset-bottom,0px));left:0;right:0;display:flex;justify-content:center;opacity:0;pointer-events:none}
.pg-close.show{opacity:1;pointer-events:auto;animation:pgUp .25s both}
.pg-skip{position:absolute;right:calc(14px + env(safe-area-inset-right,0px));top:calc(10px + env(safe-area-inset-top,0px));font-size:12px;font-weight:800;color:#fff9;padding:4px 10px;border:1px solid #fff4;border-radius:99px}
/* ---- home panels ---- */
.pg-panel{font-family:var(--font,sans-serif);color:#fff4d6;width:100%;max-height:100%;overflow:auto;-webkit-overflow-scrolling:touch;padding:4px 2px 10px;touch-action:pan-y}
.pg-ph{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 2px 10px}
.pg-ph h3{margin:0;font-size:clamp(16px,3.2vh,22px);font-weight:900}
.pg-purse{display:inline-flex;align-items:center;gap:6px;font-weight:900;font-size:clamp(15px,3vh,20px);color:#ffe07a;background:#0007;border:1px solid #ffd24a66;border-radius:99px;padding:3px 14px 3px 6px}
.pg-purse img{width:26px;height:26px}
.pg-purse.bump{animation:pgBump .3s}
@keyframes pgBump{50%{transform:scale(1.15);color:#fff}}
.pg-mgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(170px,46%),1fr));gap:10px}
.pg-mt{position:relative;display:flex;flex-direction:column;gap:5px;padding:10px;border-radius:12px;background:linear-gradient(160deg,#1b3b47,#10252e);border:1.5px solid #f0d49a44;box-shadow:0 4px 12px #0006;overflow:visible}
.pg-mt.max{border-color:#ffc34a;background:linear-gradient(160deg,#4a3514,#1d1a10)}
.pg-mt.pop{animation:pgBump .35s}
.pg-mt .pg-mh{display:flex;align-items:center;gap:8px}
.pg-mt .pg-orb{width:40px;height:40px;flex:none;font-size:22px}
.pg-mt .pg-mn{font-weight:900;font-size:15px;line-height:1.1}
.pg-mt .pg-ml{font-size:11px;color:#ffe7a8;font-weight:800}
.pg-mt .pg-pips{flex-wrap:wrap;--rc:#ffc34a}
.pg-mt .pg-pips i{width:9px;height:9px}
.pg-mt .pg-md{font-size:12px;line-height:1.35;color:#d9e8e4;font-weight:700;min-height:2.7em}
.pg-mt .pg-md b{color:#ffe07a}
.pg-mt .pg-btn{padding:5px 10px;min-height:36px;font-size:14px;display:flex;align-items:center;justify-content:center;gap:5px}
.pg-mt .pg-btn img{width:20px;height:20px}
.pg-mt .pg-btn.poor{border-color:#ff8a7a88;color:#ffb4a8}
/* constellation */
.pg-cons{display:flex;gap:14px;align-items:stretch;flex-wrap:wrap}
.pg-map{position:relative;flex:1 1 320px;min-height:230px;border-radius:16px;overflow:hidden;background:radial-gradient(ellipse at 40% 40%,#233a6b 0,#0a1124 75%);border:1.5px solid #9fb8ff44}
.pg-map svg{position:absolute;inset:0;width:100%;height:100%}
.pg-map .pg-ghost{position:absolute;right:4%;bottom:0;height:88%;opacity:.13;filter:grayscale(.3) drop-shadow(0 0 20px #9fb8ff);pointer-events:none}
.pg-node{cursor:pointer}
.pg-node circle.halo{fill:url(#pgHalo);opacity:.0;transition:opacity .2s}
.pg-node.on circle.halo{opacity:1}
.pg-node.next circle.halo{opacity:.7;animation:pgNodePulse 1.2s ease-in-out infinite alternate}
.pg-node.sel circle.ring{stroke:#fff;stroke-width:2.5}
.pg-node path{fill:#56627d;transition:fill .3s}
.pg-node.on path{fill:#ffe9a8}
.pg-node.next path{fill:#9fb8ff}
@keyframes pgNodePulse{to{opacity:.25}}
.pg-link{stroke:#8ea2d066;stroke-width:1.5;stroke-dasharray:3 4}
.pg-link.on{stroke:#ffe9a8;stroke-width:2.5;stroke-dasharray:none;filter:drop-shadow(0 0 4px #ffd24a)}
.pg-cinfo{flex:1 1 240px;display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;background:#0e1f29e6;border:1.5px solid #f0d49a44}
.pg-cinfo .pg-cn{font-size:12px;font-weight:800;color:#9fb8ff}
.pg-cinfo h4{margin:0;font-size:20px;font-weight:900}
.pg-cinfo p{margin:0;font-size:14px;line-height:1.45;font-weight:700;color:#e8f1ef}
.pg-cinfo .pg-cstate{font-size:13px;font-weight:900}
.pg-clist{display:flex;flex-direction:column;gap:3px;font-size:12px;font-weight:700;color:#cbd6e8;margin-top:auto}
.pg-clist span.on{color:#ffe07a}
.pg-flare{position:absolute;width:160px;height:160px;margin:-80px 0 0 -80px;border-radius:50%;pointer-events:none;background:radial-gradient(circle,#fff 0,#ffe07a 25%,transparent 70%);animation:pgFlare .9s ease-out forwards}
@keyframes pgFlare{0%{transform:scale(.2);opacity:1}100%{transform:scale(2.4);opacity:0}}
/* relics */
.pg-rtop{display:flex;gap:12px;flex-wrap:wrap;align-items:stretch;margin-bottom:12px}
.pg-rbox{flex:0 0 auto;display:flex;align-items:center;gap:10px;padding:8px 14px 8px 8px;border-radius:14px;background:linear-gradient(160deg,#1f5046,#10292a);border:1.5px solid #9fe8c877}
.pg-rbox img{width:64px;height:64px;filter:drop-shadow(0 0 10px #9fe8c8)}
.pg-rbox.has img{animation:pgBob .8s ease-in-out infinite alternate}
.pg-rbox b{display:block;font-size:15px;font-weight:900}
.pg-rbox small{font-size:12px;color:#cfe;font-weight:700}
.pg-rsum{flex:1 1 220px;display:flex;flex-wrap:wrap;gap:5px;align-content:flex-start;padding:8px;border-radius:12px;background:#0007}
.pg-chip{font-size:12px;font-weight:800;padding:2px 8px;border-radius:99px;background:#ffffff14;border:1px solid #ffffff22;white-space:nowrap}
.pg-chip.set{background:#9fe8c833;border-color:#9fe8c888;color:#dfffee}
.pg-chip.off{opacity:.45}
.pg-eq{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-bottom:12px}
.pg-rp{--rc:#c28bff;position:relative;border-radius:12px;padding:6px 6px 7px;background:linear-gradient(170deg,var(--bg2,#5a4a82),var(--bg1,#2a2140) 55%,#101b24 56%);
  border:1.5px solid var(--rc);text-align:center;cursor:pointer;min-width:0;font-family:inherit;color:#fff4d6;transition:transform .1s}
.pg-rp:hover{transform:translateY(-3px)}
.pg-rp.r5{--rc:#ffc34a;--bg1:#4b2c14;--bg2:#b8763a}
.pg-rp.r4{--rc:#c28bff;--bg1:#2f2450;--bg2:#7b58b4}
.pg-rp.empty{--rc:#ffffff33;background:#0006;cursor:default}
.pg-rp .pg-rg{font-size:clamp(26px,6vh,40px);color:#fff;filter:drop-shadow(0 2px 3px #0009)}
.pg-rp.empty .pg-rg{color:#ffffff33}
.pg-rp .pg-rs{font-size:11px;font-weight:800;color:#ffe7a8;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pg-rp .pg-stars{font-size:9px}
.pg-rp .pg-rl{position:absolute;top:3px;right:4px;font-size:11px;color:#ffe07a}
.pg-rp .pg-req{position:absolute;top:3px;left:4px;font-size:10px;font-weight:900;background:#ffe07a;color:#4a2a05;border-radius:4px;padding:0 3px}
.pg-inv{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:6px}
.pg-inv .pg-rp{padding:4px 3px 5px}
.pg-inv .pg-rg{font-size:26px}
.pg-rdet{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:#000a;animation:pgUp .15s both;font-family:var(--font,sans-serif);color:#fff4d6}
.pg-rcard{width:min(340px,92vw);max-height:92vh;overflow:auto;border-radius:16px;background:#101d27;border:2px solid var(--rc);box-shadow:0 0 30px var(--rc);--rc:#c28bff}
.pg-rcard.r5{--rc:#ffc34a}
.pg-rcard .pg-rtop2{display:flex;align-items:center;gap:10px;padding:12px;background:linear-gradient(160deg,var(--rc),#0000 80%)}
.pg-rcard .pg-rg{font-size:52px;color:#fff;filter:drop-shadow(0 3px 4px #0009)}
.pg-rcard h4{margin:0;font-size:18px;font-weight:900}
.pg-rcard .pg-rmain{font-size:20px;font-weight:900;color:#ffe07a}
.pg-rcard ul{list-style:none;margin:0;padding:8px 14px;display:flex;flex-direction:column;gap:4px;font-weight:800;font-size:14px}
.pg-rcard ul li::before{content:"・";color:#ffe07a}
.pg-rcard .pg-rset{padding:0 14px 8px;font-size:12px;color:#bfe;font-weight:700;line-height:1.4}
.pg-rcard .pg-racts{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;padding:6px 12px 14px}
.pg-rcard .pg-cmp{padding:0 14px 6px;font-size:12px;font-weight:900}
.pg-rcard .pg-cmp.up{color:#7dff8a}.pg-rcard .pg-cmp.down{color:#ff8a7a}
.pg-empty{grid-column:1/-1;padding:18px;text-align:center;color:#fff9;font-weight:700;font-size:13px}
@media (max-height:480px){
  .pg-ov{justify-content:flex-start;padding-top:calc(4px + env(safe-area-inset-top,0px))}
  .pg-card{min-height:0;height:min(262px,66vh)}
  .pg-card .pg-top{height:34%}
  .pg-desc{font-size:11.5px;line-height:1.3}
  .pg-body{padding:4px 7px 7px;gap:2px}
  .pg-lvtitle{margin-bottom:6px}
  .pg-lvtitle h2{font-size:30px}
  .pg-lvtitle .pg-lvnum{font-size:12px;margin-top:2px;padding:0 12px}
  .pg-foot{margin-top:6px}
  .pg-tip{display:none}
  .pg-btn{min-height:36px;padding:5px 14px}
  .pg-chest{justify-content:center}
  .pg-tier{top:6px;font-size:16px}
  .pg-slot .pg-card{height:min(236px,60vh);min-height:0}
  .pg-reveal{margin-top:0}
  .pg-mora{position:absolute;right:calc(20px + env(safe-area-inset-right,0px));bottom:10px;margin:0;font-size:24px}
  .pg-close{bottom:6px}
}
@media (max-width:560px){ .pg-eq{grid-template-columns:repeat(5,minmax(0,1fr));gap:4px} .pg-rp .pg-rs{font-size:10px} }
/* ---- dopamine v2 ---- */
@keyframes pgCardIn{0%{transform:translateY(-70px) rotateY(100deg) scale(1.15);opacity:0}55%{transform:translateY(8px) rotateY(0) scale(1.04,.94);opacity:1}75%{transform:translateY(-4px) scale(.99,1.02)}100%{transform:none;opacity:1}}
.pg-card.r4 .pg-top::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 35%,#fff3 48%,transparent 60%);background-size:250% 100%;animation:pgShine 2.6s ease-in-out infinite}
.pg-cards .pg-card.r5{animation-name:pgCardIn,pgGoldGlow;animation-duration:.32s,1.4s;animation-iteration-count:1,infinite;animation-direction:normal,alternate;animation-delay:var(--d,0s),.4s}
@keyframes pgGoldGlow{from{box-shadow:0 0 0 2px #ffc34a,0 0 12px #ffb347,0 10px 28px #000a}to{box-shadow:0 0 0 3px #ffe07a,0 0 34px #ffb347,0 10px 28px #000a}}
.pg-chainx{display:inline-block;margin-left:.25em;font-size:.8em;color:#fff;-webkit-text-fill-color:#fff;background:none;animation:pgChainPop .45s cubic-bezier(.2,2,.4,1) both;filter:drop-shadow(0 0 10px #ff5a4d)}
@keyframes pgChainPop{0%{transform:scale(3) rotate(20deg);opacity:0}100%{transform:none;opacity:1}}
.pg-ov.chain .pg-lvtitle h2{filter:hue-rotate(var(--chainHue,0deg)) drop-shadow(0 0 18px #ff7a3d) drop-shadow(0 3px 0 #7a3a0a)}
.pg-ov.chain .pg-rays{opacity:.34;animation-duration:9s}
.pg-more{display:inline-block;margin-left:10px;padding:0 9px;border-radius:99px;background:#ff5a4d;color:#fff;font-size:.85em;animation:pgPulse .5s ease-in-out infinite alternate}
.pg-build-mini{position:absolute;left:calc(10px + env(safe-area-inset-left,0px));bottom:calc(8px + env(safe-area-inset-bottom,0px));max-width:min(46vw,520px);display:flex;flex-direction:column;gap:4px;pointer-events:none;opacity:.95;animation:pgUp .3s .4s both}
.pg-brow{display:flex;flex-wrap:wrap;gap:4px}
.pg-bi{--rc:#6fb7ff;position:relative;width:40px;height:40px;border-radius:9px;background:#0b1a24d9;box-shadow:0 0 0 1.5px var(--rc)}
.pg-bi.r4{--rc:#c28bff}.pg-bi.evo,.pg-bi.r5{--rc:#ffc34a;box-shadow:0 0 0 2px #ffc34a,0 0 10px #ffb347}
.pg-bi .pg-art,.pg-ri .pg-art{position:absolute;inset:3px;width:auto;height:auto;max-width:none;transform:none;left:3px;top:3px}
.pg-bi .pg-art .pg-orb{width:100%;font-size:18px;box-shadow:none}
.pg-bi .pg-elb,.pg-ri .pg-elb,.pg-bi .pg-badge,.pg-ri .pg-badge{display:none}
.pg-bi b{position:absolute;right:-3px;bottom:-5px;font-size:9.5px;font-weight:900;background:#000c;color:#ffe7a8;border-radius:5px;padding:0 3px;line-height:1.35}
.pg-recs{display:flex;flex-wrap:wrap;gap:4px}
.pg-rec{display:flex;align-items:center;gap:3px;padding:2px 8px 2px 3px;border-radius:99px;background:#0b1a24d9;border:1px solid #ffffff22;font-weight:900;font-size:12px;color:#fff9}
.pg-rec .pg-ri{position:relative;display:inline-block;width:26px;height:26px;border-radius:50%;background:#ffffff12}
.pg-rec .pg-ri .pg-orb{width:100%;font-size:12px;box-shadow:none}
.pg-rec .pg-ri.gold{background:#ffc34a44;box-shadow:0 0 0 1.5px #ffc34a}
.pg-rec .pg-rt{display:flex;flex-direction:column;line-height:1.1;margin-left:3px}
.pg-rec .pg-rt b{font-size:11.5px;color:#fff4d6}.pg-rec .pg-rt i{font-style:normal;font-size:10.5px;color:#9fe8c8}
.pg-rec.near{border-color:#ffb347;background:#3a2410e6}.pg-rec.near i{color:#ffb347}
.pg-rec.ready{border-color:#ffc34a;background:#4a3514f0;animation:pgPulse .6s ease-in-out infinite alternate}.pg-rec.ready i{color:#ffe07a}
.pg-rec.done{opacity:.6}
.pg-rec .pg-ri.max{box-shadow:0 0 0 1.5px #7dff8a}.pg-rec .pg-ri.none{opacity:.4;filter:grayscale(.8)}
.pg-brow.big .pg-bi{width:54px;height:54px}.pg-brow.big .pg-bi b{font-size:11px}
.pg-recs.big .pg-rec{font-size:14px;padding:4px 12px 4px 5px}.pg-recs.big .pg-ri{width:34px;height:34px}.pg-recs.big .pg-rt b{font-size:13.5px}.pg-recs.big .pg-rt i{font-size:12px}
/* jackpot */
.pg-chest.jackpot{background:radial-gradient(ellipse at 50% 60%,#5a3b12 0,#1a0f05 75%)}
.pg-jp{color:#ffe07a;text-shadow:0 0 14px #ffb347;animation:pgPulse .4s ease-in-out infinite alternate;display:inline-block}
.pg-jpban{position:absolute;left:0;right:0;top:30%;text-align:center;pointer-events:none;z-index:6;font-weight:900;font-size:clamp(46px,13vh,110px);font-style:italic;
  background:linear-gradient(180deg,#fff,#ffe07a 40%,#ff9d3c);-webkit-background-clip:text;background-clip:text;color:transparent;filter:drop-shadow(0 0 26px #ffb347) drop-shadow(0 4px 0 #7a3a0a);animation:pgEvo 1.3s ease-out forwards}
.pg-chest.many .pg-slot{width:clamp(104px,16.5vw,196px)}
.pg-chest.many .pg-name{font-size:clamp(12px,2.6vh,18px)}
/* evolution cutscene */
.pg-evocut{position:absolute;inset:0;z-index:8;pointer-events:none;background:radial-gradient(circle at 50% 42%,#3a2408f0 0,#000f 70%);animation:pgFadeIn .25s both}
.pg-evocut.out{animation:pgFade .35s forwards}
@keyframes pgFadeIn{from{opacity:0}}
.pg-evo-rays{position:absolute;left:50%;top:42%;width:170vmax;height:170vmax;margin:-85vmax 0 0 -85vmax;opacity:0;background:repeating-conic-gradient(from 0deg,#ffe07a 0 4deg,transparent 4deg 12deg);
  -webkit-mask:radial-gradient(circle,#000 0,transparent 45%);mask:radial-gradient(circle,#000 0,transparent 45%);animation:pgSpin 6s linear infinite,pgRaysIn .4s 1s forwards}
@keyframes pgRaysIn{to{opacity:.55}}
.pg-evo-a,.pg-evo-b,.pg-evo-core{position:absolute;top:42%;left:50%;width:clamp(90px,22vh,170px);aspect-ratio:1;margin:calc(clamp(90px,22vh,170px) / -2) 0 0 calc(clamp(90px,22vh,170px) / -2)}
.pg-evo-a .pg-art,.pg-evo-b .pg-art,.pg-evo-core .pg-art{position:absolute;inset:0;width:100%;height:100%;max-width:none;transform:none;left:0;top:0}
.pg-evocut .pg-orb{width:100%;font-size:clamp(40px,10vh,80px)}
.pg-evo-a{animation:pgFuseA 1.05s cubic-bezier(.6,0,.9,.5) forwards}
.pg-evo-b{animation:pgFuseB 1.05s cubic-bezier(.6,0,.9,.5) forwards}
@keyframes pgFuseA{0%{transform:translateX(-36vw) scale(.8);opacity:0}25%{opacity:1;transform:translateX(-26vw) scale(1)}100%{transform:translateX(0) rotate(540deg) scale(.4);opacity:.9;filter:brightness(3)}}
@keyframes pgFuseB{0%{transform:translateX(36vw) scale(.8);opacity:0}25%{opacity:1;transform:translateX(26vw) scale(1)}100%{transform:translateX(0) rotate(-540deg) scale(.4);opacity:.9;filter:brightness(3)}}
.pg-evo-flash{position:absolute;inset:0;background:radial-gradient(circle at 50% 42%,#fff 0,#ffe07a 25%,transparent 65%);opacity:0;animation:pgBloom .8s 1s ease-out forwards}
.pg-evo-core{opacity:0;animation:pgCore .6s 1.05s cubic-bezier(.2,1.6,.4,1) forwards;filter:drop-shadow(0 0 24px #ffb347)}
@keyframes pgCore{0%{transform:scale(2.4);opacity:0}100%{transform:scale(1.25);opacity:1}}
.pg-evo-name{position:absolute;left:0;right:0;top:calc(42% + clamp(60px,15vh,120px));text-align:center;opacity:0;animation:pgUp .4s 1.3s forwards;display:flex;flex-direction:column;align-items:center;gap:2px}
.pg-evo-name small{font-size:clamp(14px,3vh,22px);font-weight:900;color:#ffe07a;letter-spacing:.3em}
.pg-evo-name span{font-size:clamp(30px,8vh,64px);font-weight:900;color:#fff;text-shadow:0 0 18px #ffb347,0 3px 0 #7a3a0a}
.pg-evo-name .pg-stars{font-size:clamp(16px,3.4vh,26px)}
@media (max-height:480px){ .pg-build-mini{display:none} .pg-evo-name{top:calc(42% + 58px)} }
@media (max-height:640px){ .pg-build-mini .pg-brow{display:none} }
/* ---- v3: level-up cards ---- */
.pg-lvl{background:#0009;color:#ffe7a8}
.pg-key.up{bottom:calc(clamp(11px,2.1vh,14px) * 1.2 + 12px)}
.pg-lvl i{font-style:normal;color:#7dff8a;margin:0 2px}
.pg-lvl.max{background:linear-gradient(90deg,#ffb347,#ffe07a);color:#4a2a05;box-shadow:0 0 10px #ffb347}
.pg-lvl.max i{color:#7a3a0a}
.pg-new.gold{background:linear-gradient(90deg,#ffb347,#fff3b0,#ffb347);color:#5a2a00;box-shadow:0 0 14px #ffd24a}
.pg-evob{position:absolute;left:0;right:0;bottom:0;z-index:3;text-align:center;font-weight:900;font-size:clamp(11px,2.1vh,14px);line-height:1.2;padding:3px 4px;pointer-events:none}
.pg-evob.near{background:linear-gradient(90deg,#ff5a4de6,#ffb347e6);color:#fff;text-shadow:0 1px 0 #0006;animation:pgEvoNear .7s ease-in-out infinite alternate}
.pg-evob.unlock{background:linear-gradient(90deg,#b8761a,#fff3b0,#ffc34a,#fff3b0,#b8761a);background-size:300% 100%;color:#4a2a05;animation:pgEvoUnl 1.6s linear infinite;box-shadow:0 -4px 14px #ffd24a88}
@keyframes pgEvoNear{to{filter:brightness(1.25);letter-spacing:.04em}}
@keyframes pgEvoUnl{to{background-position:-300% 0}}
.pg-cards .pg-card.unlock{--rc:#ffc34a;animation-name:pgCardIn,pgGoldGlow;animation-duration:.42s,1.1s;animation-iteration-count:1,infinite;animation-direction:normal,alternate;animation-delay:var(--d,0s),.5s}
.pg-card.unlock .pg-top::after{content:"";position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,#fff7 45%,transparent 60%);background-size:250% 100%;animation:pgShine 1.4s ease-in-out infinite}
.pg-card.bless .pg-top{background:radial-gradient(circle at 50% 55%,#fff9 0,transparent 55%),conic-gradient(from 0deg,#ffb347,#fff3b0,#ff9d3c,#ffe07a,#ffb347)}
.pg-card.bless .pg-top::before{background:repeating-conic-gradient(from 0deg,#fff4 0 6deg,transparent 6deg 18deg);animation-duration:6s}
.pg-card.bless .pg-body{background:linear-gradient(#2a1c08,#17130a)}
.pg-card.bless .pg-name{color:#ffe07a}
.pg-gorb{width:70%!important}
.pg-gico{position:absolute;right:-6%;bottom:-4%;width:52%!important;height:52%!important;filter:drop-shadow(0 3px 5px #000a)!important}
.pg-card{animation-duration:.42s}
.pg-land{position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:4;opacity:0;background:radial-gradient(circle at 50% 35%,#fff 0,var(--rc) 40%,transparent 75%);
  animation:pgLand .55s ease-out calc(var(--d,0s) + .2s) both}
.pg-card[data-fx="5"] .pg-land{animation-duration:.9s;background:radial-gradient(circle at 50% 35%,#fff 0,#ffe07a 45%,#ffb34700 80%)}
@keyframes pgLand{0%{opacity:0}18%{opacity:.85}100%{opacity:0}}
.pg-ov.fast .pg-card{animation-duration:.26s}
.pg-ov.fast .pg-land{animation-duration:.3s}
.pg-ov.fast .pg-lvtitle h2{animation-duration:.2s}
.pg-ov.fast .pg-foot{animation-delay:.1s}
.pg-cards.picked .pg-card:not(.chosen){animation:pgOut .25s ease-in forwards}
.pg-cards.picked .pg-card.chosen{animation:pgSuck .46s cubic-bezier(.5,0,.85,.4) forwards;z-index:5}
.pg-ov.fast .pg-cards.picked .pg-card.chosen{animation-duration:.36s}
@keyframes pgSuck{0%{transform:none}22%{transform:translateY(-18px) scale(1.14);filter:brightness(1.9)}100%{transform:translate(var(--tx,0),var(--ty,200px)) scale(.1) rotate(-14deg);opacity:.15;filter:brightness(2.6)}}
.pg-pickring{position:absolute;width:40px;height:40px;margin:-20px 0 0 -20px;border-radius:50%;border:4px solid var(--rc);box-shadow:0 0 20px var(--rc),inset 0 0 12px var(--rc);pointer-events:none;z-index:6;animation:pgRing .5s ease-out forwards}
@keyframes pgRing{from{transform:scale(.4);opacity:1}to{transform:scale(8);opacity:0}}
.pg-ov.gold .pg-rays{background:repeating-conic-gradient(from 0deg,#ffe07a 0 5deg,transparent 5deg 12deg);opacity:.42;animation-duration:10s}
.pg-goldban{position:absolute;top:calc(12px + env(safe-area-inset-top,0px));right:calc(18px + env(safe-area-inset-right,0px));z-index:7;padding:6px 14px;border-radius:10px;font-weight:900;font-size:clamp(14px,2.8vh,20px);
  background:linear-gradient(90deg,#b8761a,#fff3b0,#ffc34a);color:#4a2a05;box-shadow:0 0 22px #ffd24a,0 4px 0 #7a3a0a;pointer-events:none;animation:pgGoldBan 2s ease-out forwards}
@keyframes pgGoldBan{0%{transform:scale(2.5) rotate(-12deg);opacity:0}12%{transform:scale(1) rotate(6deg);opacity:1}80%{opacity:1}100%{transform:rotate(6deg) translateY(-10px);opacity:0}}
/* ---- v3: chest tiers, colour-changing meteor, slot machine ---- */
.pg-crays{position:absolute;left:50%;top:52%;width:150vmax;height:150vmax;margin:-75vmax 0 0 -75vmax;pointer-events:none;opacity:0;
  background:repeating-conic-gradient(from 0deg,var(--tc) 0 4deg,transparent 4deg 14deg);-webkit-mask:radial-gradient(circle,#000 0,transparent 50%);mask:radial-gradient(circle,#000 0,transparent 50%);animation:pgSpin 14s linear infinite}
.pg-chest.t-exquisite .pg-crays{opacity:.18}
.pg-chest.t-precious .pg-crays{opacity:.32;animation-duration:9s}
.pg-chest.t-luxurious{background:radial-gradient(ellipse at 50% 55%,#5a3b12 0,#140c04 78%)}
.pg-chest.t-luxurious .pg-crays{opacity:.3;animation-duration:7s;background:repeating-conic-gradient(from 0deg,#ffe07a 0 5deg,transparent 5deg 15deg)}
.pg-chest.t-luxurious .pg-mora{font-size:clamp(34px,9vh,72px)}
.pg-chest.t-common .pg-box{width:clamp(80px,18vh,140px)}
.pg-chest.t-precious .pg-box{width:clamp(130px,32vh,240px)}
.pg-chest.t-luxurious .pg-box{width:clamp(150px,38vh,280px)}
.pg-boxglow{position:absolute;inset:-35%;border-radius:50%;background:radial-gradient(circle,var(--tc) 0,transparent 65%);opacity:.5;animation:pgPulse .6s ease-in-out infinite alternate;pointer-events:none}
.pg-chest.t-common .pg-boxglow{opacity:.25}
.pg-chest.t-luxurious .pg-boxglow,.pg-chest.t-precious .pg-boxglow{inset:-60%;opacity:.7}
.pg-box.shake2{animation:pgShake .16s linear infinite}
.pg-box.shake2 img{filter:drop-shadow(0 0 30px var(--tc)) brightness(1.6)}
.pg-meteor.m4{height:8px}
.pg-meteor.m5{height:11px;box-shadow:0 0 24px var(--mc),0 0 60px var(--mc),0 0 90px #fff6}
.pg-meteor.bump{filter:brightness(2.4)}
.pg-meteor{transition:filter .2s}
.pg-spin{position:absolute;left:0;right:0;bottom:0;height:clamp(210px,50vh,330px);display:none;flex-direction:column;align-items:center;justify-content:center;border-radius:14px;overflow:hidden;
  background:linear-gradient(#1a2a44,#0c1526);box-shadow:0 0 0 2px #ffffff88,0 0 20px #9fb8ff66;animation:pgSpinGlow .3s ease-in-out infinite alternate}
.pg-slot.spinning .pg-spin{display:flex}
.pg-spinwin{position:relative;width:62%;aspect-ratio:1;filter:blur(.6px)}
.pg-spinwin .pg-art{animation:pgRoll .075s linear infinite}
.pg-spin b{font-size:clamp(26px,6vh,44px);font-weight:900;color:#fff;text-shadow:0 0 14px #9fb8ff;animation:pgPulse .25s ease-in-out infinite alternate}
.pg-spin::before,.pg-spin::after{content:"";position:absolute;left:0;right:0;height:26%;z-index:2;pointer-events:none}
.pg-spin::before{top:0;background:linear-gradient(#0c1526,transparent)}
.pg-spin::after{bottom:0;background:linear-gradient(transparent,#0c1526)}
@keyframes pgRoll{from{transform:translate(-50%,-110%)}to{transform:translate(-50%,10%)}}
@keyframes pgSpinGlow{to{box-shadow:0 0 0 2px #fff,0 0 30px #c9d6ff}}
.pg-flare.big{width:240px;height:240px;margin:-120px 0 0 -120px}
/* ---- v3: 天賦の星図 (star-map skill tree) ---- */
.st-prog{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px;font-weight:800;color:#cfe;margin-right:auto;margin-left:6px}
.st-prog b{color:#ffe07a}
.st-prog em{font-style:normal;display:inline-flex;align-items:center;gap:3px;padding:1px 9px;border-radius:99px;background:#0007;border:1px solid #ffffff22}
.st-prog em img{width:16px;height:16px}
.st-prog .st-can{color:#7dff8a;border-color:#7dff8a88;animation:pgPulse .7s ease-in-out infinite alternate}
.st-wrap{display:flex;flex-wrap:wrap;gap:10px;align-items:stretch}
.st-map{position:relative;flex:1 1 100%;min-width:0;aspect-ratio:1.42;border-radius:16px;overflow:hidden;background:radial-gradient(ellipse at 50% 50%,#1d2f5e 0,#0a1124 72%);border:1.5px solid #9fb8ff44;box-shadow:inset 0 0 40px #0008}
.st-map svg{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.st-info{--c:#f0d49a;flex:1 1 100%;min-width:0;display:grid;grid-template-columns:1fr auto;column-gap:14px;row-gap:4px;align-items:center;padding:10px 12px;border-radius:14px;background:#0e1f29e6;border:1.5px solid var(--c);box-shadow:0 0 18px -8px var(--c)}
.st-br{font-size:12px;font-weight:800;color:var(--c)}
.st-br b{color:#ffe07a}
.st-name{display:flex;align-items:center;gap:8px;font-size:clamp(16px,3vh,20px);font-weight:900;line-height:1.15}
.st-name .pg-orb{width:36px;height:36px;flex:none;font-size:19px}
.st-desc{font-size:13px;font-weight:700;color:#d9e8e4;line-height:1.35}
.st-up{display:inline-flex;align-items:center;gap:5px;font-weight:900;font-size:clamp(14px,2.8vh,18px);margin-left:6px}
.st-up span{color:#9fb0d0}.st-up i{color:#7dff8a;font-style:normal}.st-up b{color:#ffe07a}
.st-fx{font-size:13px;font-weight:800;line-height:1.4}
.st-fx b{color:#ffe07a}.st-fx i{font-style:normal;color:#7dff8a;margin:0 3px}
.st-info>*{grid-column:1}
.st-act{grid-column:2!important;grid-row:1/span 6;display:flex;flex-direction:column;gap:4px;align-items:stretch;min-width:120px}
.st-buy{display:flex;align-items:center;justify-content:center;gap:5px;white-space:nowrap}
.st-buy small{font-size:.8em;margin-left:2px}
.st-buy img{width:20px;height:20px}
.pg-btn.poor{filter:saturate(.35) brightness(.8)}
.st-need{font-size:12px;font-weight:800;color:#ffb4a8;text-align:center}
.st-need b{color:#fff}
.st-lock{margin-top:auto;font-size:12.5px;font-weight:800;color:#9fb0d0;display:flex;gap:6px;align-items:center;line-height:1.3}
.st-link{stroke:#8ea2d044;stroke-width:1.2;stroke-dasharray:2 4}
.st-link.reach{stroke:var(--c);opacity:.6;stroke-width:1.6;stroke-dasharray:3 4;animation:stDash 1.2s linear infinite}
.st-link.on{stroke:var(--c);stroke-width:3.2;stroke-dasharray:none;filter:url(#stGlow)}
.st-flow{stroke:#fff;stroke-width:1.4;stroke-dasharray:3 14;stroke-linecap:round;opacity:.85;animation:stDash .9s linear infinite}
@keyframes stDash{to{stroke-dashoffset:-17}}
.st-surge{stroke:#fff;stroke-width:6;stroke-linecap:round;filter:url(#stGlow);stroke-dasharray:200;stroke-dashoffset:200;animation:stSurge .55s ease-out forwards}
@keyframes stSurge{70%{stroke-dashoffset:0;opacity:1}100%{stroke-dashoffset:0;opacity:0}}
.st-node{cursor:pointer;outline:none}
.st-hit{fill:transparent}
.st-halo{color:var(--c);opacity:0;transition:opacity .3s;pointer-events:none}
.st-node.lit .st-halo{opacity:.5}
.st-node.can .st-halo{opacity:.95;animation:stPulse .9s ease-in-out infinite alternate}
.st-node.max .st-halo{opacity:.8;color:#ffd24a}
@keyframes stPulse{to{opacity:.35}}
.st-track{fill:none;stroke:#ffffff1c;stroke-width:3}
.st-arc{fill:none;stroke:var(--c);stroke-width:3;stroke-linecap:round}
.st-node.max .st-arc{stroke:#ffe07a}
.st-core{fill:#0b1430;stroke:#8ea2d0;stroke-width:1.2;transform-box:fill-box;transform-origin:center}
.st-node.lit .st-core{fill:#172a4f;stroke:var(--c)}
.st-node.can .st-core{stroke:#fff;stroke-dasharray:3 2}
.st-node.max .st-core{fill:#4a3514;stroke:#ffe07a}
.st-gl{fill:#56627d}
.st-node.lit .st-gl,.st-node.can .st-gl,.st-node.open .st-gl{fill:#fff}
.st-node.max .st-gl{fill:#ffe9a8}
.st-node.locked{opacity:.5}
.st-lv{font-size:9.5px;font-weight:900;fill:#cbd6e8;paint-order:stroke;stroke:#0a1124;stroke-width:3px;pointer-events:none}
.st-node.max .st-lv{fill:#ffe07a}
.st-node.sel .st-core{stroke:#fff;stroke-width:2.6;stroke-dasharray:none}
.st-node.sel,.st-node:focus-visible{filter:drop-shadow(0 0 6px #fffa)}
.st-kring{fill:#0b143088;stroke:var(--c);stroke-width:1.4;opacity:.75;stroke-dasharray:4 3;transform-box:fill-box;transform-origin:center;animation:pgSpin 10s linear infinite}
.st-node.lit .st-kring{fill:#3a2a0f88;stroke:#ffe07a;opacity:1}
.st-node.pop .st-core{animation:stPop .45s cubic-bezier(.2,1.8,.4,1)}
@keyframes stPop{0%{transform:scale(1.8)}100%{transform:none}}
.st-node.newly .st-halo{opacity:.9;animation:stPulse .3s ease-in-out 6 alternate}
.st-tw{animation:pgTwinkle 2.4s ease-in-out infinite alternate;animation-delay:var(--td,0s)}
.st-root .st-rcore{fill:#1b4b5a;stroke:#9fe8ff;stroke-width:2}
.st-root .st-halo{opacity:.7}
@media (max-height:480px){
  .pg-metap .pg-ph{margin-bottom:6px}
  .pg-metap .pg-ph .pg-purse{display:none}
  .pg-metap .pg-ph h3{font-size:15px}
  .st-wrap{gap:6px}
  .st-map{aspect-ratio:1.85}
  .st-name{font-size:14px}
  .st-up{font-size:13px}
  .st-fx{font-size:11.5px}
  .st-info{padding:6px 9px;row-gap:2px}
  .st-br{display:none}
  .st-act{min-width:0}
  .st-act .pg-btn{min-height:34px;padding:4px 10px;font-size:13px}
  .st-desc,.st-fx{font-size:12px}
  .st-name .pg-orb{width:28px;height:28px;font-size:15px}
  .pg-chest.t-precious .pg-box,.pg-chest.t-luxurious .pg-box{width:clamp(110px,34vh,200px)}
  .pg-spin{height:min(236px,60vh)}
  .pg-goldban{font-size:13px;padding:4px 10px}
}
/* ---- rules v6: chest choice (new launchers are only gained here) ---- */
.pg-qcard .pg-top{background:radial-gradient(circle at 50% 60%,#fff5 0,transparent 60%),linear-gradient(160deg,#8a62c2,#2a1d55)}
.pg-qmark{font-size:clamp(54px,13vh,96px);font-weight:900;color:#fff;text-shadow:0 0 18px #c28bff,0 0 36px #ffe07a,0 4px 0 #3a2270;animation:pgPulse .7s ease-in-out infinite alternate}
.pg-choice{position:absolute;inset:0;z-index:9;display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:default;
  background:radial-gradient(ellipse at 50% 52%,#3a2a6ae6 0,#07081af2 75%);animation:pgFadeIn .25s both;
  padding:calc(8px + env(safe-area-inset-top,0px)) calc(12px + env(safe-area-inset-right,0px)) calc(8px + env(safe-area-inset-bottom,0px)) calc(12px + env(safe-area-inset-left,0px))}
.pg-choice.out{animation:pgFade .3s ease-in forwards;pointer-events:none}
.pg-choice-title{text-align:center;font-weight:900;font-size:clamp(24px,5.4vh,44px);line-height:1.1;margin-bottom:clamp(6px,2vh,16px);
  background:linear-gradient(180deg,#fffbe8 10%,#ffe07a 50%,#ff9d3c 95%);-webkit-background-clip:text;background-clip:text;color:transparent;
  filter:drop-shadow(0 0 12px #c28bffaa) drop-shadow(0 3px 0 #3a1a60);animation:pgTitle .4s cubic-bezier(.2,1.6,.4,1) both}
.pg-choice-title small{display:block;font-size:.46em;letter-spacing:.12em;margin-bottom:2px}
.pg-choice-note{margin-top:clamp(6px,2vh,14px);font-weight:800;font-size:clamp(12px,2.3vh,15px);color:#fff4d6;background:#0009;border:1px solid #c28bff88;border-radius:99px;padding:3px 14px;animation:pgUp .3s .3s both}
.pg-choice-note b{color:#ffe07a}
@media (max-height:480px){ .pg-choice{justify-content:flex-start} .pg-choice-title{font-size:22px;margin-bottom:4px} .pg-choice-note{margin-top:4px;font-size:11.5px} }
@media (prefers-reduced-motion:reduce){ .pg-rays,.pg-card .pg-top::before{animation:none} }
`;
  function ensureCss() {
    if (document.getElementById('progression-css')) return;
    const s = document.createElement('style'); s.id = 'progression-css'; s.textContent = CSS; document.head.append(s);
  }

  /* ------------------------------------------------------------------ card builder */
  function cardHtml(R, key, o) {
    o = o || {};
    const up = G.progression.def(key) || { name: key, rarity: 3, desc: () => '' };
    const cur = key[0] === '_' ? 0 : (R.levels[key] || 0);
    const lv = o.level != null ? o.level : cur + 1;           // the level this card gives
    const isNew = o.isNew != null ? o.isNew : cur === 0;
    const r = up.rarity || 3;
    let pips = '';
    if (up.max > 1 && up.max < 20) { for (let i = 1; i <= up.max; i++) pips += `<i class="${i < lv ? 'on' : i === lv ? (o.result ? 'on' : 'next') : ''}"></i>`; pips = `<div class="pg-pips">${pips}</div>`; }
    let flag = '';
    if (up.cat === 'evo') flag = '<span class="pg-new">進化！</span>';
    else if (up.cat === 'bless') flag = '<span class="pg-new gold">超レア！</span>';
    else if (key[0] !== '_' && isNew) flag = '<span class="pg-new">NEW!</span>';
    else if (key[0] !== '_') flag = `<span class="pg-lvl${lv >= up.max ? ' max' : ''}">Lv.${lv - 1}<i>→</i>${lv}${lv >= up.max ? ' MAX' : ''}</span>`;
    // evolution progress for this pick (level-up offers only; chest results are already applied)
    const ev = !o.result && up.cat !== 'evo' && key[0] !== '_' && G.upgradeHelpers.evoAfterPick ? G.upgradeHelpers.evoAfterPick(R, key) : null;
    o.evoInfo = ev;
    let evb = '';
    if (ev && ev.unlock) evb = `<div class="pg-evob unlock">★ 進化解放！ →「${ev.evo}」</div>`;
    else if (ev && ev.left <= 3) evb = `<div class="pg-evob near">進化まで あと${ev.left}！</div>`;
    const hint = !evb && up.cat !== 'evo' && up.cat !== 'bless' && key[0] !== '_' ? G.upgradeHelpers.evoHint(R, key) : null;
    const hintHtml = hint ? `<div class="pg-hint${hint.have ? ' have' : ''}">${hint.text}</div>` : '';
    const catTxt = up.cat === 'char' && up.char && G.data.characters[up.char] ? G.data.characters[up.char].name + '専用' : (CAT[up.cat] || '');
    return `<div class="pg-top"><span class="pg-cat">${catTxt}</span>${flag}${art(key)}${o.num ? `<span class="pg-key${evb ? ' up' : ''}">${o.num}</span>` : ''}${evb}</div>
      <div class="pg-body">${stars(r)}<div class="pg-name">${up.name}</div>${pips}<div class="pg-desc">${nl(up.desc ? up.desc(Math.max(1, lv)) : '')}</div>${hintHtml}</div>`;
  }
  function makeCard(R, key, o) {
    const up = G.progression.def(key) || {};
    o = o || {};
    const b = document.createElement(o.tag || 'button');
    const html = cardHtml(R, key, o);
    const unlock = o.evoInfo && o.evoInfo.unlock;
    b.className = 'pg-card r' + (up.rarity || 3) + (up.cat === 'evo' ? ' evo' : '') + (up.cat === 'bless' ? ' bless' : '') + (unlock ? ' unlock' : '');
    b.dataset.fx = up.rarity >= 5 || unlock ? 5 : (up.rarity || 3);
    b.innerHTML = html;
    return b;
  }

  function sparks(parent, x, y, n, color, spread) {
    if (G.save.data.settings.reducedFx) n = Math.ceil(n / 3);
    const box = document.createElement('div'); box.className = 'pg-sparks'; parent.append(box);
    for (let i = 0; i < n; i++) {
      const s = document.createElement('i'); s.className = 'pg-spark';
      const a = Math.random() * U.TAU, d = (0.4 + Math.random() * 0.6) * (spread || 180);
      s.style.cssText = `left:${x}px;top:${y}px;--sc:${color};--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d}px;--t:${0.6 + Math.random() * 0.6}s`;
      box.append(s);
    }
    setTimeout(() => box.remove(), 1400);
  }
  function coins(parent, x, y, n, spread, up) {
    if (G.save.data.settings.reducedFx) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const c = document.createElement('img'); c.className = 'pg-coin'; c.src = 'assets/icon_mora.webp'; c.draggable = false;
      const a = up ? -Math.PI / 2 + (Math.random() - 0.5) * 1.6 : Math.random() * U.TAU, d = (0.5 + Math.random() * 0.5) * spread;
      c.style.cssText = `left:${x - 14}px;top:${y - 14}px;--dx:${Math.cos(a) * d}px;--dy:${Math.sin(a) * d + (up ? spread * 0.4 : 0)}px;--t:${0.7 + Math.random() * 0.8}s;--r:${(Math.random() - 0.5) * 900}deg;animation-delay:${Math.random() * (up ? 0.9 : 0.1)}s`;
      parent.append(c); setTimeout(() => c.remove(), 2200);
    }
  }

  /* ------------------------------------------------------------------ LEVEL UP */
  const reduced = () => !!(G.save.data.settings && G.save.data.settings.reducedFx);
  function levelUp(R, offer, onPick) {
    ensureCss();
    const ov = document.createElement('div'); ov.className = 'pg-ov pg-lvup';
    const chain = R.lvChain || 1, more = R.pendingLevels || 0, fast = chain > 1;
    if (chain > 1) ov.classList.add('chain', 'fast');
    ov.style.setProperty('--chainHue', Math.min(chain - 1, 6) * -18 + 'deg');
    ov.innerHTML = `<div class="pg-rays"></div><div class="pg-lvtitle"><h2>LEVEL UP!${chain > 1 ? `<span class="pg-chainx">×${chain}</span>` : ''}</h2>
      <div class="pg-lvnum">Lv.${R.player.level - 1} → Lv.${R.player.level}${more ? `<span class="pg-more">つづく！ あと${more}回</span>` : ''}</div></div>
      <div class="pg-cards"></div><div class="pg-foot"><button class="pg-btn pg-reroll"></button><span class="pg-tip">1〜${offer.length}キー / タップで えらぶ</span></div>
      <div class="pg-build pg-build-mini"></div>`;
    renderBuild(ov.querySelector('.pg-build'), R, true);
    const close = G.ui.modal(ov);
    const box = ov.querySelector('.pg-cards'), rb = ov.querySelector('.pg-reroll');
    let cur = offer.slice(), sel = -1, done = false, readyT = 0;
    const timers = [];
    function render(flip) {
      timers.forEach(clearTimeout); timers.length = 0;
      box.classList.remove('ready'); box.innerHTML = '';
      const step = fast || flip ? 0.07 : 0.15, d0 = flip ? 0 : fast ? 0.02 : 0.12;
      let gold = false;
      cur.forEach((key, i) => {
        const c = makeCard(R, key, { num: i + 1 });
        const fx = +c.dataset.fx, d = d0 + i * step;
        c.dataset.pick = key; c.style.setProperty('--d', d + 's');
        c.addEventListener('click', () => pick(i));
        c.addEventListener('pointerenter', () => { setSel(i); G.audio.sfx('uiHover'); });
        const land = document.createElement('i'); land.className = 'pg-land'; c.append(land);
        box.append(c);
        if (fx >= 5) gold = true;
        // landing: rarity-coloured flash + sound (★5 = sparkles + wish sting)
        timers.push(setTimeout(() => {
          if (done || !c.isConnected) return;
          if (fx >= 5) {
            G.audio.sfx('chestReveal', { rarity: 5 });
            const r = c.getBoundingClientRect(); sparks(ov, r.left + r.width / 2, r.top + r.height * 0.3, 36, '#ffd24a', 240);
            G.fx && G.fx.flash && G.fx.flash('#ffe07a', 0.25);
          } else if (fx === 4 && !fast) G.audio.sfx('uiHover');
        }, (d + 0.2) * 1000));
      });
      ov.classList.toggle('gold', gold);
      if (gold && !flip) { const g = document.createElement('div'); g.className = 'pg-goldban'; g.textContent = '★5 天啓カード出現！'; ov.append(g); setTimeout(() => g.remove(), 2000); }
      readyT = setTimeout(() => box.classList.add('ready'), fast || flip ? 200 : 180 + cur.length * 150);
      sel = -1;
      rb.innerHTML = `${glyph('reroll')} 引き直し ×${R.rerolls || 0}`;
      rb.disabled = !(R.rerolls > 0);
    }
    function setSel(i) {
      sel = i; box.querySelectorAll('.pg-card').forEach((c, j) => c.classList.toggle('sel', j === i));
    }
    function pick(i) {
      if (done || !box.classList.contains('ready') || i < 0 || i >= cur.length) return;
      done = true; timers.forEach(clearTimeout);
      const key = cur[i], chosen = box.children[i];
      const up = G.progression.def(key), fx = +chosen.dataset.fx || 3;
      // the chosen card pops, bursts and gets sucked into the build bar (bottom-left)
      const r = chosen.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const tgt = ov.querySelector('.pg-build-mini'), tr = tgt && tgt.offsetParent ? tgt.getBoundingClientRect() : null;
      const tx = tr && tr.width ? tr.left + 30 : 40, ty = tr && tr.height ? tr.top + 20 : innerHeight - 30;
      chosen.style.setProperty('--tx', (tx - cx) + 'px'); chosen.style.setProperty('--ty', (ty - cy) + 'px');
      chosen.classList.add('chosen'); box.classList.add('picked');
      const ring = document.createElement('i'); ring.className = 'pg-pickring'; ring.style.cssText = `left:${cx}px;top:${cy}px;--rc:${RC[fx] || RC[3]}`; ov.append(ring);
      G.audio.sfx('ui'); if (fx >= 4) G.audio.sfx('star', { rarity: fx });
      if (fx >= 5) G.audio.sfx('chestReveal', { rarity: 5 });
      sparks(ov, cx, cy, fx >= 5 ? 50 : 28, RC[fx] || RC[3], fx >= 5 ? 300 : 220);
      removeEventListener('keydown', onKey, true);
      setTimeout(() => { close(); onPick(key); }, fast ? 380 : 480);
    }
    function onKey(e) {
      if (done) return;
      const k = e.key;
      if (/^[1-9]$/.test(k)) { e.preventDefault(); e.stopPropagation(); pick(+k - 1); return; }
      if (k === 'ArrowRight' || k === 'ArrowDown' || k === 'd' || k === 'D') { setSel((sel + 1) % cur.length); G.audio.sfx('uiHover'); }
      else if (k === 'ArrowLeft' || k === 'ArrowUp' || k === 'a' || k === 'A') { setSel((sel - 1 + cur.length) % cur.length); G.audio.sfx('uiHover'); }
      else if (k === 'Enter' || k === ' ') { if (sel >= 0) pick(sel); else setSel(0); }
      else if (k === 'r' || k === 'R') doReroll();
      else return;
      e.preventDefault(); e.stopPropagation();
    }
    function doReroll() {
      if (done || !(R.rerolls > 0) || !box.classList.contains('ready')) { G.audio.sfx('denied'); return; }
      const n = G.progression.reroll(R, cur); if (!n) return;
      cur = n; clearTimeout(readyT); G.audio.sfx('chestReveal', { rarity: 3 }); render(true);
    }
    rb.addEventListener('click', doReroll);
    addEventListener('keydown', onKey, true);
    render(false);
  }

  /* ------------------------------------------------------------------ CHEST (wish) */
  const TIER = {
    common: { name: '普通の宝箱', c: '#6fb7ff', icon: 'chest', lv: 0 },
    exquisite: { name: '精巧な宝箱', c: '#c28bff', icon: 'chest', lv: 1 },
    precious: { name: '貴重な宝箱', c: '#ffc34a', icon: 'relic', lv: 2 },
    luxurious: { name: '豪華な宝箱', c: '#ffd24a', icon: 'relic', lv: 3 },
  };
  /** random keys for the slot-machine roulette */
  function rouletteKeys(R) {
    return Object.keys(G.upgrades).filter(k => { const u = G.upgrades[k]; return u.cat !== 'evo' && (!u.char || u.char === R.charId); });
  }
  function chest(R, tier, keys, mora, done, got) {
    ensureCss();
    got = got || keys.map(k => ({ key: k, level: R.levels[k] || 0, isNew: (R.levels[k] || 0) <= 1, rarity: (G.progression.def(k) || {}).rarity || 3, evo: (G.upgrades[k] || {}).cat === 'evo' }));
    const T = TIER[tier] || TIER.common;
    const jackpot = !!(got.jackpot || (R.lastChest && R.lastChest.jackpot && R.lastChest.items === got));
    const best = got.reduce((m, g) => Math.max(m, g.rarity || 3), tier === 'luxurious' ? 5 : tier === 'precious' ? 4 : 3);
    const top = jackpot ? 5 : best;
    const mc = RC[top];
    const ov = document.createElement('div');
    ov.className = 'pg-ov pg-chest t-' + (TIER[tier] ? tier : 'common') + (jackpot ? ' jackpot' : '') + (got.length > 3 ? ' many' : ''); ov.dataset.pick = 'chest';
    ov.style.setProperty('--tc', T.c); ov.style.setProperty('--mc', RC[3]);
    ov.innerHTML = `<div class="pg-sky"></div><div class="pg-crays"></div><div class="pg-tier">${T.name}${jackpot ? ' <b class="pg-jp">大当たり！</b>' : ''}</div><div class="pg-skip">タップでスキップ ▶▶</div>
      <div class="pg-box"><i class="pg-boxglow"></i><img src="assets/icon_${T.icon}.webp" alt="" draggable="false"></div>
      <div class="pg-reveal"></div><div class="pg-mora"><img src="assets/icon_mora.webp" alt=""><span>0</span></div>
      <div class="pg-close"><button class="pg-btn gold" data-pick="ok">OK！</button></div>`;
    const close = G.ui.modal(ov);
    const reveal = ov.querySelector('.pg-reveal'), boxEl = ov.querySelector('.pg-box'), moraEl = ov.querySelector('.pg-mora'), moraNum = moraEl.querySelector('span');
    const closeRow = ov.querySelector('.pg-close');
    const timers = [], spins = []; let finished = false, closed = false, moraShown = false;
    const at = (ms, fn) => timers.push(setTimeout(fn, ms));
    const pool = rouletteKeys(R);
    const slots = got.map((g, i) => {
      const s = document.createElement('div'); s.className = 'pg-slot'; s.style.setProperty('--rc', g.evo ? '#ffc34a' : RC[g.rarity || 3]);
      s.innerHTML = '<div class="pg-pillar"></div><div class="pg-spin"><div class="pg-spinwin"></div><b>？</b></div>';
      const c = g.choice ? choiceCard() : makeCard(R, g.key, { level: Math.max(1, g.level), isNew: g.isNew, result: true, tag: 'div' });
      s.append(c); reveal.append(s); return s;
    });
    reveal.style.display = 'none';
    function emitEvo(g) { if (g.evo && !g.emitted) { g.emitted = true; G.bus.emit('evolution', { key: g.key }); } }
    /* rules v6: a chest may hold one 「えらべる！」 slot — the only way to gain a NEW launcher (max 2 kinds per run).
       It spins/stops like the others, then after the reveal a 3-card picker opens; the pick flies into the slot. */
    const choiceI = got.findIndex(g => g.choice); let choosing = false, choicePick = null;
    function choiceCard() {
      const c = document.createElement('div'); c.className = 'pg-card r4 pg-qcard';
      c.innerHTML = `<div class="pg-top"><span class="pg-cat">ティマイオスの贈り物</span><span class="pg-new">えらべる！</span><div class="pg-art"><b class="pg-qmark">？</b></div></div>
        <div class="pg-body">${stars(4)}<div class="pg-name">1つ えらぼう！</div><div class="pg-desc">新しいランチャーが<br>手に入るチャンス！</div></div>`;
      return c;
    }
    function openChoice() {
      const g = got[choiceI]; if (choosing || !g || !g.choice) return false;
      choosing = true;
      const LR = G.launcherRules, left = LR ? LR.left(R) : 2, max = LR ? LR.MAX_KINDS : 2;
      const panel = document.createElement('div'); panel.className = 'pg-choice'; panel.dataset.pick = 'choice';
      panel.innerHTML = `<div class="pg-choice-title"><small>ティマイオスの贈り物</small>1つ えらんでね！</div><div class="pg-cards"></div>
        <div class="pg-choice-note">ランチャーは 1回の冒険で <b>${max}種類</b>まで（あと <b>${left}</b>種類）</div>`;
      ov.append(panel);
      const box = panel.querySelector('.pg-cards'); let picked = false;
      g.options.forEach((key, i) => {
        const c = makeCard(R, key, { num: i + 1 }); c.dataset.pick = key; c.style.setProperty('--d', (0.1 + i * 0.13) + 's');
        c.addEventListener('click', ev => { ev.stopPropagation(); pick(i); });
        c.addEventListener('pointerenter', () => G.audio.sfx('uiHover'));
        box.append(c);
        setTimeout(() => { if (c.isConnected && !picked) G.audio.sfx('chestReveal', { rarity: (G.progression.def(key) || {}).rarity || 3 }); }, (0.3 + i * 0.13) * 1000);
      });
      panel.addEventListener('click', ev => ev.stopPropagation());
      G.audio.sfx('star', { rarity: 4 }); G.fx && G.fx.flash && G.fx.flash('#c28bff', 0.2);
      setTimeout(() => box.classList.add('ready'), 250 + g.options.length * 130);
      function pick(i) {
        if (picked || !box.classList.contains('ready') || i < 0 || i >= g.options.length) return;
        picked = true;
        const key = g.options[i], chosen = box.children[i], slot = slots[choiceI];
        G.progression.resolveChoice(R, g, key);
        const r = chosen.getBoundingClientRect(), sr = slot.getBoundingClientRect();
        chosen.style.setProperty('--tx', (sr.left + sr.width / 2 - r.left - r.width / 2) + 'px'); chosen.style.setProperty('--ty', (sr.top + sr.height / 2 - r.top - r.height / 2) + 'px');
        chosen.classList.add('chosen'); box.classList.add('picked');
        const fx = g.rarity || 3;
        G.audio.sfx('ui'); G.audio.sfx('star', { rarity: fx });
        sparks(ov, r.left + r.width / 2, r.top + r.height / 2, 30, RC[fx], 230);
        setTimeout(() => {
          panel.classList.add('out'); setTimeout(() => panel.remove(), 320);
          const old = slot.querySelector('.pg-card'); if (old) old.remove();
          slot.style.setProperty('--rc', RC[fx]);
          slot.append(makeCard(R, key, { level: Math.max(1, g.level), isNew: g.isNew, result: true, tag: 'div' }));
          slot.classList.remove('instant', 'show'); void slot.offsetWidth; slot.classList.add('show');
          G.audio.sfx('chestReveal', { rarity: fx });
          setTimeout(() => { const q = slot.getBoundingClientRect(); sparks(ov, q.left + q.width / 2, q.top + q.height * 0.3, fx >= 4 ? 30 : 16, RC[fx], 200); }, 40);
          if ((G.upgrades[key] || {}).cat === 'launcher' && g.isNew) G.bus.emit('notice', { text: 'ティマイオスの「' + G.upgrades[key].name + '」を手に入れた！', color: '#c28bff' });
          choosing = false;
          closeRow.classList.add('show');
          setTimeout(() => { const b = closeRow.querySelector('button'); b && b.focus({ preventScroll: true }); }, 50);
        }, 460);
      }
      choicePick = pick;
      return true;
    }
    function stopSpins() { spins.forEach(clearInterval); spins.length = 0; }
    function showMora(instant) {
      if (moraShown || !mora) return; moraShown = true;
      moraEl.classList.add('show');
      const lvl = T.lv + (jackpot ? 1 : 0);
      if (instant) { moraNum.textContent = '+' + U.fmtNum(mora); return; }
      const t0 = performance.now(), dur = 500 + lvl * 350;
      const tick = () => { if (closed) return; const k = Math.min(1, (performance.now() - t0) / dur); moraNum.textContent = '+' + U.fmtNum(mora * U.ease.outCubic(k)); if (k < 1) { requestAnimationFrame(tick); if (Math.random() < 0.3) G.audio.sfx('mora'); } };
      tick();
      const r = moraEl.getBoundingClientRect();
      // mora fountain: bigger chests = a real geyser of coins
      coins(ov, r.left + r.width / 2, r.top + r.height / 2 - 20, [10, 18, 30, 46][Math.min(3, lvl)], Math.min(innerHeight * 0.75, 140 + lvl * 80), lvl >= 1);
    }
    function finish() {
      if (finished) return; finished = true;
      timers.forEach(clearTimeout); stopSpins();
      boxEl.remove(); ov.querySelectorAll('.pg-meteor,.pg-bloom,.pg-skip,.pg-evocut,.pg-jpban').forEach(n => n.remove());
      reveal.style.display = '';
      slots.forEach(s => { s.classList.remove('spinning'); if (!s.classList.contains('show')) s.classList.add('instant'); });
      got.forEach(emitEvo);
      showMora(true);
      if (openChoice()) return; // the OK button appears after the pick
      closeRow.classList.add('show');
      setTimeout(() => { const b = closeRow.querySelector('button'); b && b.focus({ preventScroll: true }); }, 50);
    }
    function doClose() {
      if (closed || choosing || (choiceI >= 0 && got[choiceI].choice)) return; closed = true; timers.forEach(clearTimeout); stopSpins();
      removeEventListener('keydown', onKey, true);
      got.forEach(emitEvo);
      G.audio.sfx('ui'); close(); done();
    }
    ov.addEventListener('click', e => { if (!finished) { finish(); return; } if (e.target.closest('.pg-close button') || !e.target.closest('.pg-card')) doClose(); });
    function onKey(e) {
      if (['Enter', ' ', 'Escape', 'e', 'E'].indexOf(e.key) < 0 && !/^[1-9]$/.test(e.key)) return; e.preventDefault(); e.stopPropagation();
      if (choosing) { if (/^[1-9]$/.test(e.key) && choicePick) choicePick(+e.key - 1); return; }
      if (!finished) finish(); else doClose();
    }
    addEventListener('keydown', onKey, true);

    // --- timeline: box drop → shake (harder for better chests) → burst → meteor that changes colour 青→紫→金 → slot machine ---
    const big = T.lv >= 2;
    G.audio.sfx('chestOpen', { tier });
    at(250, () => boxEl.classList.add('shake'));
    if (big) at(520, () => { boxEl.classList.add('shake2'); G.audio.sfx('roulette'); });
    at(850, () => {
      boxEl.classList.remove('shake', 'shake2'); boxEl.classList.add('gone');
      const bx = innerWidth / 2, by = innerHeight * 0.52;
      coins(ov, bx, by, [4, 10, 18, 30][T.lv] + (jackpot ? 16 : 0), 160 + T.lv * 60, true);
      sparks(ov, bx, by, 18 + T.lv * 10, T.c, 200 + T.lv * 40);
      const m = document.createElement('div'); m.className = 'pg-meteor m3'; ov.append(m); G.audio.sfx('star', { rarity: 3 });
    });
    const bump = (r, ms) => at(ms, () => {
      const m = ov.querySelector('.pg-meteor'); if (!m) return;
      m.classList.remove('m3', 'm4'); m.classList.add('m' + r, 'bump'); setTimeout(() => m.classList.remove('bump'), 200);
      ov.style.setProperty('--mc', RC[r]); G.audio.sfx('star', { rarity: r });
      G.fx && G.fx.flash && G.fx.flash(RC[r], 0.18);
    });
    if (top >= 4) bump(4, 1080);
    if (top >= 5) bump(5, 1300);
    if (jackpot) at(1350, () => { const b = document.createElement('div'); b.className = 'pg-jpban'; b.innerHTML = '大当たり！！'; ov.append(b); G.audio.sfx('evolution'); coins(ov, innerWidth / 2, innerHeight * 0.45, 30, 320, false); });
    at(1600, () => {
      ov.querySelectorAll('.pg-meteor').forEach(n => n.remove()); ov.style.setProperty('--mc', mc);
      const b = document.createElement('div'); b.className = 'pg-bloom'; ov.append(b); G.fx && G.fx.flash && G.fx.flash(mc, 0.3); reveal.style.display = '';
      // every slot starts spinning like a slot machine
      slots.forEach((s, i) => {
        s.classList.add('spinning');
        const win = s.querySelector('.pg-spinwin'); let n = i * 3;
        const roll = () => { win.innerHTML = art(pool[(n++ * 7 + i) % pool.length]); };
        roll(); spins.push(setInterval(roll, 75));
      });
      spins.push(setInterval(() => G.audio.sfx('roulette'), 150));
    });
    let t = jackpot ? 2500 : 2150;
    // stop order: normal items first (left→right), ★5 / evolution last for the climax
    const prio = g => g.evo ? 2 : g.choice ? 1.5 : g.rarity >= 5 ? 1 : 0; // the 「えらべる！」 slot stops after normal items
    const order = got.map((g, i) => i).sort((a, b) => (prio(got[a]) - prio(got[b])) || a - b);
    order.forEach(i => {
      const g = got[i];
      at(t, () => {
        const s = slots[i]; s.classList.remove('spinning');
        if (!ov.querySelector('.pg-slot.spinning')) stopSpins();
        if (g.evo) {
          evoCutscene(ov, g.key, () => { if (finished) return; s.classList.add('show'); const r = s.getBoundingClientRect(); sparks(ov, r.left + r.width / 2, r.top + r.height / 2, 40, '#ffd24a', 260); });
          emitEvo(g);
        } else {
          s.classList.add('show');
          G.audio.sfx('chestReveal', { rarity: g.rarity || 3 });
          setTimeout(() => { const r = s.getBoundingClientRect(); sparks(ov, r.left + r.width / 2, r.top + r.height * 0.3, g.rarity >= 5 ? 40 : 16, RC[g.rarity || 3], g.rarity >= 5 ? 260 : 150); }, 30);
        }
      });
      t += g.evo ? 3000 : (g.rarity >= 5 ? 700 : 430);
    });
    if (!got.length) { reveal.remove(); at(1700, stopSpins); }
    at(t + (mora ? 100 : 0), () => showMora(false));
    at(t + (mora ? 450 + T.lv * 350 : 150), finish);
  }

  /* ------------------------------------------------------------------ evolution cutscene (gacha ★5 feel) */
  function evoCutscene(parent, key, onDone) {
    const up = G.upgrades[key]; if (!up) { onDone && onDone(); return; }
    const c = document.createElement('div'); c.className = 'pg-evocut';
    c.innerHTML = `<div class="pg-evo-rays"></div><div class="pg-evo-a">${art(up.base, true)}</div><div class="pg-evo-b">${art(up.partner, true)}</div>
      <div class="pg-evo-flash"></div><div class="pg-evo-core">${art(key, true)}</div>
      <div class="pg-evo-name"><small>進化！</small><span>${up.name}</span>${stars(5)}</div>`;
    parent.append(c);
    G.audio.sfx('evolution'); G.audio.sfx('star', { rarity: 5 });
    setTimeout(() => { if (!c.isConnected) return; G.audio.sfx('chestReveal', { rarity: 5 }); sparks(c, innerWidth / 2, innerHeight * 0.42, 70, '#ffd24a', 420); coins(c, innerWidth / 2, innerHeight * 0.42, 8, 260, false); G.fx && G.fx.flash && G.fx.flash('#ffe07a', 0.5); }, 1050);
    setTimeout(() => { c.classList.add('out'); onDone && onDone(); }, 2500);
    setTimeout(() => c.remove(), 2900);
  }

  /* ------------------------------------------------------------------ build panel (owned items + evolution recipes) */
  // rule = G.upgradeHelpers.evoLeft (upgrades.js): every requirement at MAX
  function recipeState(R, e) {
    if (R.evolved[e.key]) return { done: true, text: '進化ずみ！' };
    const left = G.upgradeHelpers.evoLeft(R, e);
    if (left === 0) return { ready: true, text: '宝箱で進化！' };
    return { left, text: `ぜんぶMAXまで あと${left}` };
  }
  const reqIcons = (R, e) => e.requires.map(k => { const u = G.upgrades[k], l = R.levels[k] || 0; return `<span class="pg-ri${l >= u.max ? ' max' : l > 0 ? '' : ' none'}" title="${u.name} ${l >= u.max ? 'MAX' : 'Lv' + l + '/' + u.max}">${art(k)}</span>`; }).join('+');
  /** renders the player's current build into container (also usable from the pause menu: G.progressionUI.renderBuild(el, G.run)) */
  function renderBuild(container, R, mini) {
    ensureCss(); if (!container || !R) return;
    const own = Object.keys(R.levels).filter(k => { const u = G.upgrades[k]; return u && R.levels[k] > 0 && u.cat !== 'evo'; });
    const order = { char: 0, launcher: 1, stat: 2 };
    own.sort((a, b) => order[G.upgrades[a].cat] - order[G.upgrades[b].cat]);
    const recipes = (G.evolutions || []).filter(e => { const u = G.upgrades[e.key]; return (!u.char || u.char === R.charId) && e.requires.some(k => (R.levels[k] || 0) > 0); })
      .map(e => ({ e, st: recipeState(R, e) })).sort((a, b) => (!!a.st.done - !!b.st.done) || (!!b.st.ready - !!a.st.ready) || ((a.st.left || 0) - (b.st.left || 0)));
    const items = own.map(k => {
      const u = G.upgrades[k], lv = R.levels[k], evo = (G.evolutions || []).find(e => e.base === k && R.evolved[e.key]);
      return `<div class="pg-bi r${u.rarity}${evo ? ' evo' : ''}" title="${u.name}">${art(evo ? evo.key : k)}<b>${lv >= u.max ? 'MAX' : 'Lv' + lv}</b></div>`;
    }).join('');
    const rec = recipes.slice(0, mini ? 2 : 9).map(({ e, st }) => `<div class="pg-rec${st.ready ? ' ready' : st.done ? ' done' : st.left <= 2 ? ' near' : ''}">
      ${reqIcons(R, e)}→<span class="pg-ri gold">${art(e.key)}</span>
      <span class="pg-rt"><b>${G.upgrades[e.key].name}</b><i>${st.text}</i></span></div>`).join('');
    container.innerHTML = mini ? `<div class="pg-brow">${items}</div>${rec ? `<div class="pg-recs">${rec}</div>` : ''}`
      : `<div class="pg-ph"><h3>いまの装備</h3></div><div class="pg-brow big">${items || '<span class="pg-empty">まだなし</span>'}</div>
         <div class="pg-ph" style="margin-top:8px"><h3>進化レシピ</h3></div><div class="pg-recs big">${rec || '<span class="pg-empty">武器を取ると ここに出るよ</span>'}</div>`;
    return container;
  }

  /* ------------------------------------------------------------------ HOME: Mora shop */
  function purse(el) { el.innerHTML = `<img src="assets/icon_mora.webp" alt="">${U.fmtNum(G.save.data.mora || 0)}`; }
  function fmtTotal(d, lv) {
    if (d.pct) return '+' + Math.round(d.per * lv * 100) + '%';
    return '+' + Math.round(d.per * lv * 10) / 10;
  }
  /* 天賦の星図: star-map skill tree over the same G.save.data.meta levels (old saves keep every level). */
  function metaFx(d, lv) {
    if (lv <= 0 && (d.max === 1)) return 'なし';
    if (d.pct) return '+' + Math.round(d.per * lv * 100) + '%';
    return '+' + Math.round(d.per * lv * 10) / 10;
  }
  function metaLine(key, d, lv) {
    if (key === 'reroll') return `引き直し 合計 <b>${2 + lv}回</b>`;
    if (d.max === 1) return lv ? '<b>解放ずみ！</b>' : 'まだ';
    return `${d.name} <b>${metaFx(d, lv)}</b>`;
  }
  function renderMeta(container) {
    ensureCss();
    const S = G.save.data; if (!S.meta || typeof S.meta !== 'object') S.meta = {};
    const TR = G.data.metaTree, NODES = TR.nodes, keys = Object.keys(NODES).filter(k => G.data.meta[k]);
    container.innerHTML = '';
    const root = document.createElement('div'); root.className = 'pg-panel pg-metap';
    root.innerHTML = `<div class="pg-ph"><h3>天賦の星図</h3><span class="st-prog"></span><span class="pg-purse"></span></div>
      <div class="st-wrap"><div class="st-map"><svg viewBox="0 0 400 300" preserveAspectRatio="xMidYMid meet"></svg></div><div class="st-info"></div></div>`;
    container.append(root);
    const svg = root.querySelector('svg'), info = root.querySelector('.st-info'), map = root.querySelector('.st-map');
    const pEl = root.querySelector('.pg-purse'), prog = root.querySelector('.st-prog');
    const lvOf = k => (k === 'root' ? 1 : (S.meta[k] | 0));
    const open = k => { const n = NODES[k]; return !n || n.parent === 'root' || lvOf(n.parent) > 0 || lvOf(k) > 0; };
    const costOf = k => G.data.metaCost(k, lvOf(k));
    const state = k => { const d = G.data.meta[k], l = lvOf(k); if (l >= d.max) return 'max'; if (!open(k)) return 'locked'; return (S.mora || 0) >= costOf(k) ? 'can' : 'open'; };
    let sel = keys.find(k => state(k) === 'can') || keys.find(k => state(k) === 'open') || keys[0];
    // static backdrop (stars + faint branch nebulae) built once
    let bg = `<defs><filter id="stGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <radialGradient id="stHalo"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset=".3" stop-color="currentColor" stop-opacity=".55"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/></radialGradient></defs>`;
    const neb = { atk: [90, 80], def: [90, 220], wind: [310, 80], gold: [310, 220] };
    for (const b in neb) bg = bg.replace('</defs>', `<radialGradient id="stNeb_${b}"><stop offset="0" stop-color="${TR.branches[b].c}" stop-opacity=".16"/><stop offset="1" stop-color="${TR.branches[b].c}" stop-opacity="0"/></radialGradient></defs>`)
      + `<circle cx="${neb[b][0]}" cy="${neb[b][1]}" r="110" fill="url(#stNeb_${b})"/>`;
    for (let i = 0; i < 70; i++) { const x = (i * 97 + 13) % 400, y = (i * 53 + i * i * 7) % 300; bg += `<circle class="st-tw" style="--td:${(i % 7) * 0.4}s" cx="${x}" cy="${y}" r="${(i % 3) * 0.4 + 0.4}" fill="#fff" opacity="${0.15 + (i % 4) * 0.1}"/>`; }
    const R = 15, C = 2 * Math.PI * (R + 3.5);
    function draw() {
      let h = bg, links = '', nodes = '';
      let total = 0, have = 0, canN = 0, minNeed = Infinity;
      for (const k of keys) {
        const n = NODES[k], d = G.data.meta[k], l = lvOf(k), st = state(k), par = n.parent === 'root' ? TR.root : NODES[n.parent];
        const col = TR.branches[n.br].c;
        total += d.max; have += Math.min(l, d.max);
        if (st === 'can') canN++;
        if (st === 'open') minNeed = Math.min(minNeed, costOf(k) - (S.mora || 0));
        const lit = l > 0, reach = !lit && open(k);
        links += `<line class="st-link${lit ? ' on' : reach ? ' reach' : ''}" style="--c:${col}" data-link="${k}" x1="${par.x}" y1="${par.y}" x2="${n.x}" y2="${n.y}"/>`;
        if (lit) links += `<line class="st-flow" style="--c:${col}" x1="${par.x}" y1="${par.y}" x2="${n.x}" y2="${n.y}"/>`;
        const ks = !!d.keystone, r = ks ? R + 4 : R, frac = Math.min(1, l / d.max);
        const shape = ks ? `<polygon class="st-kring" points="0,${-r - 7} ${r + 7},0 0,${r + 7} ${-r - 7},0"/>` : '';
        nodes += `<g class="st-node ${st}${ks ? ' ks' : ''}${k === sel ? ' sel' : ''}${lit ? ' lit' : ''}" data-node="${k}" tabindex="0" role="button" aria-label="${d.name}" style="--c:${col}" transform="translate(${n.x} ${n.y})">
          <circle class="st-halo" r="${r + 16}" fill="url(#stHalo)"/>${shape}
          <circle class="st-hit" r="${r + 9}"/>
          <circle class="st-track" r="${r + 3.5}"/>
          <circle class="st-arc" r="${r + 3.5}" stroke-dasharray="${(C * frac * (r + 3.5) / (R + 3.5)).toFixed(1)} 999" transform="rotate(-90)"/>
          <circle class="st-core" r="${r}"/>
          <g class="st-gl" transform="translate(${-r * 0.62} ${-r * 0.62}) scale(${(r * 1.24 / 24).toFixed(3)})">${P[d.glyph] || P.star}</g>
          <text class="st-lv" y="${r + 14}" text-anchor="middle">${l >= d.max ? 'MAX' : l + '/' + d.max}</text></g>`;
      }
      h += links + `<g class="st-root" transform="translate(${TR.root.x} ${TR.root.y})"><circle class="st-halo" r="34" fill="url(#stHalo)" style="color:#9fe8ff"/><circle r="15" class="st-rcore"/>
        <g transform="translate(-9.5 -9.5) scale(.8)" fill="#e9fbff">${P.speed}</g><text y="29" text-anchor="middle" class="st-lv">旅立ち</text></g>` + nodes;
      svg.innerHTML = h;
      svg.querySelectorAll('.st-node').forEach(g => {
        const k = g.dataset.node;
        g.addEventListener('click', () => { if (sel === k) { buy(k); return; } sel = k; G.audio.sfx('uiHover'); draw(); });
        g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (sel === k) buy(k); else { sel = k; draw(); } } });
      });
      prog.innerHTML = `<b>★ ${have}</b> / ${total}` + (canN ? ` <em class="st-can">強化できる星 ×${canN}！</em>` : isFinite(minNeed) ? ` <em>次の強化まで あと <img src="assets/icon_mora.webp" alt="">${U.fmtNum(minNeed)}</em>` : '');
      drawInfo();
      purse(pEl);
    }
    function drawInfo() {
      const k = sel, d = G.data.meta[k], n = NODES[k], l = lvOf(k), st = state(k), col = TR.branches[n.br].c, cost = costOf(k);
      const parName = n.parent === 'root' ? '' : G.data.meta[n.parent].name;
      let act = '';
      if (st === 'max') act = `<button class="pg-btn gold" disabled>MAX！</button>`;
      else if (st === 'locked') act = `<div class="st-lock">${glyph('lock')} 先に「${parName}」を Lv1 にしよう</div>`;
      else act = `<button class="pg-btn gold st-buy${st === 'can' ? '' : ' poor'}"><img src="assets/icon_mora.webp" alt="">${U.fmtNum(cost)}<small>で強化</small></button>` +
        (st === 'open' ? `<div class="st-need">あと <b>${U.fmtNum(cost - (S.mora || 0))}</b> モラ！</div>` : '');
      const up = l < d.max ? `<span class="st-up"><span>Lv.${l}</span><i>→</i><b>Lv.${l + 1}</b></span>` : '<span class="st-up"><b>MAX</b></span>';
      const plain = d.max === 1 || k === 'reroll' || d.keystone;
      const fx = l < d.max ? `<div class="st-fx">${metaLine(k, d, l)} <i>→</i> ${metaLine(k, d, l + 1)}</div>` : `<div class="st-fx">${metaLine(k, d, l)}</div>`;
      info.style.setProperty('--c', col);
      info.innerHTML = `<div class="st-br">${TR.branches[n.br].name}${d.keystone ? ' ・ <b>要の星</b>' : ''}</div>
        <div class="st-name"><i class="pg-orb" style="--c:${col}">${glyph(d.glyph)}</i><span>${d.name}</span>${up}</div>
        ${plain ? `<div class="st-desc">${d.desc}</div>` : ''}${d.max === 1 ? '' : fx}<div class="st-act">${act}</div>`;
      const b = info.querySelector('.st-buy'); if (b) b.addEventListener('click', () => buy(k));
    }
    function buy(key) {
      const d = G.data.meta[key], lv = lvOf(key), st = state(key);
      if (st === 'max') return;
      if (st !== 'can') {
        G.audio.sfx('denied');
        const b = info.querySelector('.st-buy, .st-lock'); b && b.animate([{ transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'none' }], { duration: 200 });
        return;
      }
      const cost = costOf(key);
      S.mora -= cost; S.meta[key] = lv + 1; G.save.write();
      const maxed = lv + 1 >= d.max;
      G.audio.sfx('mora'); G.audio.sfx('star', { rarity: d.keystone || maxed ? 5 : 4 }); if (maxed) G.audio.sfx('levelup');
      const wasLit = lv > 0;
      draw();
      // light travels along the link, the node flares, coins + sparks
      const g = svg.querySelector(`.st-node[data-node="${key}"]`), mr = map.getBoundingClientRect();
      if (g) {
        const r = g.querySelector('.st-core').getBoundingClientRect(), x = r.left - mr.left + r.width / 2, y = r.top - mr.top + r.height / 2;
        const f = document.createElement('div'); f.className = 'pg-flare' + (maxed ? ' big' : ''); f.style.left = x + 'px'; f.style.top = y + 'px'; map.append(f); setTimeout(() => f.remove(), 1000);
        sparks(map, x, y, maxed || d.keystone ? 40 : 22, TR.branches[NODES[key].br].c, maxed ? 170 : 110);
        coins(map, x, y, 8, 80, false);
        g.classList.add('pop');
      }
      if (!wasLit) {
        const ln = svg.querySelector(`.st-link[data-link="${key}"]`);
        if (ln) { const s2 = ln.cloneNode(); s2.setAttribute('class', 'st-surge'); svg.insertBefore(s2, svg.querySelector('.st-root')); setTimeout(() => s2.remove(), 900); }
        // children just became reachable: make them blink once
        for (const k of keys) if (NODES[k].parent === key) { const c = svg.querySelector(`.st-node[data-node="${k}"]`); c && c.classList.add('newly'); }
      }
      pEl.classList.remove('bump'); void pEl.offsetWidth; pEl.classList.add('bump');
      G.bus.emit('moraChange', S.mora);
    }
    draw();
    return root;
  }

  /* ------------------------------------------------------------------ HOME: constellation */
  const NODES = [[70, 200], [120, 120], [185, 70], [250, 105], [300, 175], [345, 95]]; // a hopping-bunny arc
  function setConstellation(n) {
    const S = G.save.data; if (!S.constellation || typeof S.constellation !== 'object') S.constellation = {};
    S.constellation.amber = n;
  }
  function renderConstellation(container) {
    ensureCss();
    const C = G.progression.constellations;
    container.innerHTML = '';
    const root = document.createElement('div'); root.className = 'pg-panel pg-consp';
    root.innerHTML = `<div class="pg-ph"><h3>命ノ星座 — アンバー</h3><span class="pg-purse"></span></div>
      <div class="pg-cons"><div class="pg-map"><img class="pg-ghost" src="assets/icon_amber.webp" alt=""><svg viewBox="0 0 400 260" preserveAspectRatio="xMidYMid meet"></svg></div><div class="pg-cinfo"></div></div>`;
    container.append(root);
    const svg = root.querySelector('svg'), info = root.querySelector('.pg-cinfo'), map = root.querySelector('.pg-map'), pEl = root.querySelector('.pg-purse');
    let sel = Math.min(5, G.progression.constellationLevel());
    function draw() {
      const n = G.progression.constellationLevel();
      let h = `<defs><radialGradient id="pgHalo"><stop offset="0" stop-color="#fff"/><stop offset=".25" stop-color="#ffe07a"/><stop offset="1" stop-color="#ffe07a" stop-opacity="0"/></radialGradient></defs>`;
      for (let i = 0; i < 40; i++) { const x = (i * 97) % 400, y = (i * 53 + i * i) % 260; h += `<circle cx="${x}" cy="${y}" r="${(i % 3) * 0.4 + 0.5}" fill="#fff" opacity="${0.2 + (i % 4) * 0.12}"/>`; }
      for (let i = 1; i < NODES.length; i++) h += `<line class="pg-link${i < n ? ' on' : ''}" x1="${NODES[i - 1][0]}" y1="${NODES[i - 1][1]}" x2="${NODES[i][0]}" y2="${NODES[i][1]}"/>`;
      NODES.forEach(([x, y], i) => {
        const st = i < n ? 'on' : i === n ? 'next' : 'off';
        h += `<g class="pg-node ${st}${i === sel ? ' sel' : ''}" data-i="${i}" transform="translate(${x} ${y})"><circle class="halo" r="34"/>
          <circle class="ring" r="17" fill="#0b1430" stroke="${i < n ? '#ffe07a' : '#8ea2d0'}" stroke-width="1.5"/>
          <path transform="translate(-11 -11) scale(.92)" d="${'M12 1.6l3.1 6.9 7.5.8-5.6 5 1.6 7.4L12 17.9l-6.6 3.8L7 14.3l-5.6-5 7.5-.8z'}"/>
          <text y="33" text-anchor="middle" font-size="12" font-weight="900" fill="${i < n ? '#ffe07a' : '#9fb0d0'}">C${i + 1}</text></g>`;
      });
      svg.innerHTML = h;
      svg.querySelectorAll('.pg-node').forEach(g => g.addEventListener('click', () => { sel = +g.dataset.i; G.audio.sfx('uiHover'); draw(); }));
      const c = C[sel], owned = sel < n, isNext = sel === n, cost = c.cost;
      info.innerHTML = `<div class="pg-cn">第${sel + 1}重 ・ C${sel + 1}</div><h4>${c.name}</h4><p>${c.text}</p>
        <div class="pg-cstate">${owned ? '<span style="color:#7dff8a">✓ 解放ずみ</span>' : isNext ? '' : `<span style="color:#9fb0d0">先に C${n + 1} を解放しよう</span>`}</div>
        ${isNext ? `<button class="pg-btn gold pg-cbuy"><img src="assets/icon_mora.webp" alt="" style="width:20px;height:20px;vertical-align:-4px"> ${U.fmtNum(cost)} で解放</button>` : ''}
        <div class="pg-clist">${C.map((x, i) => `<span class="${i < n ? 'on' : ''}">C${i + 1} ${x.short}${i < n ? ' ✓' : ''}</span>`).join('')}</div>`;
      const b = info.querySelector('.pg-cbuy');
      if (b) { if ((G.save.data.mora || 0) < cost) b.classList.add('poor'); b.addEventListener('click', () => unlock(sel)); }
      purse(pEl);
    }
    function unlock(i) {
      const n = G.progression.constellationLevel(), c = C[i]; if (i !== n) return;
      if ((G.save.data.mora || 0) < c.cost) { G.audio.sfx('denied'); return; }
      G.save.data.mora -= c.cost; setConstellation(n + 1); G.save.write();
      G.audio.sfx('star'); G.audio.sfx('levelup');
      const r = map.getBoundingClientRect(), vb = svg.getBoundingClientRect();
      const sc = Math.min(vb.width / 400, vb.height / 260), ox = (vb.width - 400 * sc) / 2, oy = (vb.height - 260 * sc) / 2;
      const fx = document.createElement('div'); fx.className = 'pg-flare';
      fx.style.left = (vb.left - r.left + ox + NODES[i][0] * sc) + 'px'; fx.style.top = (vb.top - r.top + oy + NODES[i][1] * sc) + 'px';
      map.append(fx); setTimeout(() => fx.remove(), 1000);
      sparks(map, parseFloat(fx.style.left), parseFloat(fx.style.top), 30, '#ffe07a', 140);
      sel = Math.min(5, i + 1); draw();
      G.bus.emit('moraChange', G.save.data.mora);
    }
    draw();
    return root;
  }

  return { renderBuild, evoCutscene, ensureCss, glyph, art, stars, makeCard, cardHtml, sparks, coins, levelUp, chest, renderMeta, renderConstellation, RC, STAT_COL };
})();

// override the default dialogs from ui.js
G.ui.levelUp = G.progressionUI.levelUp;
G.ui.chest = G.progressionUI.chest;
