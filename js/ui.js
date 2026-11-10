/* ============================================================
   自在极意 · 交互基础件：Toast / 弹窗 / 浮层菜单
   ============================================================ */
(function (global) {
  'use strict';

  const UI = {};
  let openMenus = 0;
  const modalStack = [];

  /* ---------------- Toast ---------------- */
  UI.toast = function (msg, opts) {
    const host = U.$('#toastHost');
    if (!host) return;
    const o = opts || {};
    const node = U.el('div', { class: 'toast' + (o.warn ? ' is-warn' : '') }, [
      U.el('span', { class: 'toast-dot' }),
      U.el('span', { text: msg })
    ]);
    host.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => node.remove(), 200);
    }, o.duration || 2000);
  };

  /* ---------------- 弹窗 ---------------- */
  UI.modal = function (opts) {
    const o = opts || {};
    const layer = U.el('div', { class: 'modal-layer', role: 'dialog', 'aria-modal': 'true' });
    const box = U.el('div', { class: 'modal' + (o.wide ? ' is-wide' : '') });

    const head = U.el('div', { class: 'modal-head' }, [
      U.el('div', {}, [
        U.el('div', { class: 'modal-title', text: o.title || '' }),
        o.sub ? U.el('div', { class: 'modal-sub', html: o.sub }) : null
      ]),
      o.closable === false ? null : U.el('button', {
        class: 'icon-btn', 'aria-label': '关闭', onclick: () => api.close()
      }, [U.el('span', { html: U.icon('x') })])
    ]);

    const body = U.el('div', { class: 'modal-body' });
    if (typeof o.body === 'string') body.innerHTML = o.body;
    else if (o.body) body.appendChild(o.body);

    const foot = U.el('div', { class: 'modal-foot' });
    const actions = o.actions || [{ label: '知道了', kind: 'soft' }];

    const api = { close: close, el: box, layer: layer };
    let closed = false;
    let lastFocus = document.activeElement;

    function close(result) {
      if (closed) return;
      closed = true;
      layer.classList.remove('is-on');
      const i = modalStack.indexOf(api);
      if (i >= 0) modalStack.splice(i, 1);
      setTimeout(() => layer.remove(), 200);
      if (lastFocus && lastFocus.focus && document.contains(lastFocus)) {
        try { lastFocus.focus({ preventScroll: true }); } catch (e) {}
      }
      if (typeof o.onClose === 'function') o.onClose(result);
    }

    actions.forEach((a) => {
      const btn = U.el('button', {
        class: 'btn ' + (a.kind === 'soft' ? 'btn-soft' : a.kind === 'danger' ? 'btn btn-danger' : 'btn-ghost'),
        text: a.label
      });
      btn.addEventListener('click', () => {
        if (a.onClick) {
          const r = a.onClick(api);
          if (r === false) return;
        }
        close(a.value);
      });
      foot.appendChild(btn);
    });

    box.append(head, body, foot);
    layer.appendChild(box);
    layer.addEventListener('pointerdown', (e) => {
      if (e.target === layer && o.dismissible !== false) close(null);
    });

    document.body.appendChild(layer);
    requestAnimationFrame(() => layer.classList.add('is-on'));
    modalStack.push(api);

    setTimeout(() => {
      const target = box.querySelector('input, textarea, [data-autofocus], .btn-soft');
      if (target && target.focus) target.focus({ preventScroll: true });
    }, 60);

    return api;
  };

  UI.confirm = function (opts) {
    const o = typeof opts === 'string' ? { title: opts } : (opts || {});
    return new Promise((resolve) => {
      let done = false;
      UI.modal({
        title: o.title || '确认操作',
        sub: o.sub || '',
        body: o.body || null,
        actions: [
          { label: o.cancelText || '取消', kind: 'ghost' },
          {
            label: o.okText || '确定',
            kind: o.danger ? 'danger' : 'soft',
            onClick: () => { done = true; resolve(true); }
          }
        ],
        onClose: () => { if (!done) resolve(false); }
      });
    });
  };

  UI.alert = function (title, sub) {
    return new Promise((resolve) => {
      UI.modal({ title: title, sub: sub || '', actions: [{ label: '知道了', kind: 'soft', onClick: () => resolve(true) }], onClose: () => resolve(false) });
    });
  };

  /* ---------------- 浮层菜单 ---------------- */
  function closeMenu() {
    const layer = U.$('#menuLayer');
    if (!layer) return;
    layer.classList.remove('is-on');
    layer.innerHTML = '';
    openMenus = 0;
  }
  UI.closeMenu = closeMenu;

  UI.menu = function (anchor, opts) {
    const o = opts || {};
    closeMenu();
    const layer = U.$('#menuLayer');
    const scrim = U.el('div', { class: 'menu-scrim' });
    const box = U.el('div', { class: 'menu', role: 'menu' });

    (o.items || []).forEach((it) => {
      if (it.sep) { box.appendChild(U.el('div', { class: 'menu-sep' })); return; }
      if (it.labelOnly) { box.appendChild(U.el('div', { class: 'menu-label', text: it.labelOnly })); return; }
      const btn = U.el('button', {
        class: 'menu-item' + (it.danger ? ' is-danger' : '') + (it.checked ? ' is-checked' : ''),
        role: 'menuitem'
      }, [
        it.icon ? U.el('span', { html: U.icon(it.icon) }) : null,
        U.el('span', { text: it.label })
      ]);
      btn.addEventListener('click', () => {
        closeMenu();
        if (it.onClick) setTimeout(it.onClick, 0);
      });
      box.appendChild(btn);
    });

    if (o.body) box.appendChild(o.body);
    layer.appendChild(scrim);
    layer.appendChild(box);
    layer.classList.add('is-on');
    scrim.addEventListener('pointerdown', closeMenu);

    // 定位。o.at 给的是右键位置（没有可锚定的元素时用）
    const r = o.at
      ? { left: o.at.x, right: o.at.x, top: o.at.y, bottom: o.at.y }
      : anchor.getBoundingClientRect();
    const bw = box.offsetWidth, bh = box.offsetHeight;
    let left = o.align === 'right' ? r.right - bw : r.left;
    let top = r.bottom + 6;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 6);
    left = U.clamp(left, 8, window.innerWidth - bw - 8);
    box.style.left = left + 'px';
    box.style.top = top + 'px';

    openMenus = 1;
    return box;
  };

  /* 颜色选择面板 */
  UI.colorMenu = function (anchor, colors, onPick) {
    const wrap = U.el('div', {});
    wrap.appendChild(U.el('div', { class: 'menu-label', text: '选择颜色' }));
    const grid = U.el('div', { class: 'menu-swatches' });
    colors.forEach((c) => {
      const b = U.el('button', { class: 'swatch', title: c.name, 'aria-label': c.name });
      b.style.background = c.value;
      b.addEventListener('click', () => { closeMenu(); onPick(c.value); });
      grid.appendChild(b);
    });
    wrap.appendChild(grid);
    return UI.menu(anchor, { body: wrap, align: 'left' });
  };

  /* ---------------- 全局键 ---------------- */
  UI.isBusy = function () { return !!(openMenus || modalStack.length); };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (openMenus) { closeMenu(); return; }
      if (modalStack.length) {
        e.preventDefault();
        modalStack[modalStack.length - 1].close(null);
      }
    }
  });

  global.UI = UI;
})(window);
