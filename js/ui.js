/* ui.js — DOM overlay helpers shared by every screen + default level-up / chest dialogs.
   Layers inside #ui: screens are replaced via G.ui.show(); modals stack via G.ui.modal(). */
'use strict';
G.ui = (function () {
  let root;
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (k === 'class') e.className = v; else if (k === 'html') e.innerHTML = v; else if (k === 'text') e.textContent = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return e;
  }
  const api = {
    el,
    init() { root = document.getElementById('ui'); },
    get root() { return root; },
    /** replace the base screen layer */
    show(node) { api.clearScreen(); node.classList.add('ui-screen'); root.prepend(node); return node; },
    clearScreen() { root.querySelectorAll('.ui-screen').forEach(n => n.remove()); },
    /** push a modal on top; returns close() */
    modal(node) {
      node.classList.add('ui-modal'); root.append(node);
      return () => { node.classList.add('closing'); setTimeout(() => node.remove(), 180); };
    },
    clearModals() { root.querySelectorAll('.ui-modal').forEach(n => n.remove()); },
    clearAll() { root.innerHTML = ''; },
    /** clickable with sound */
    button(label, cls, onClick, extra) {
      return el('button', Object.assign({ class: 'btn ' + (cls || ''), onclick: e => { G.audio.sfx('ui'); onClick && onClick(e); } }, extra || {}), label);
    },
    /* ---- default dialogs (progression/UI owners may override these functions) ---- */
    levelUp(R, offer, onPick) {
      let close;
      const cards = offer.map(key => {
        const up = G.upgrades[key] || { name: key === '_heal' ? '休息' : 'モラ', desc: () => '' };
        const lv = (R.levels[key] || 0) + 1;
        return el('button', { class: 'card', onclick: () => { G.audio.sfx('ui'); close(); onPick(key); } },
          up.icon ? el('img', { src: 'assets/icon_' + up.icon + '.webp' }) : null,
          el('h3', null, up.name, ' Lv.' + lv), el('p', null, up.desc ? up.desc(lv) : ''));
      });
      close = api.modal(el('div', { class: 'screen', style: { background: '#0008' } }, el('h2', null, 'レベルアップ！'), el('div', { class: 'cards' }, cards)));
    },
    chest(R, tier, got, mora, done) {
      let close;
      close = api.modal(el('div', { class: 'screen', style: { background: '#0008' } }, el('h2', null, '宝箱'),
        el('div', { class: 'cards' }, got.map(k => el('div', { class: 'card' }, (G.upgrades[k] || { name: k }).name))),
        mora ? el('p', null, 'モラ +' + mora) : null,
        api.button('OK', '', () => { close(); done(); })));
    },
  };
  return api;
})();
