/* ============================================================
   自在极意 · 工具函数
   ============================================================ */
(function (global) {
  'use strict';

  const U = {};

  U.$ = (sel, root) => (root || document).querySelector(sel);
  U.$$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

  U.el = function (tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'class') node.className = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k === 'text') node.textContent = v;
        else if (k === 'dataset') Object.assign(node.dataset, v);
        else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
        else node.setAttribute(k, v);
      });
    }
    (children || []).forEach((c) => {
      if (c === null || c === undefined) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };

  U.icon = function (name, cls) {
    return '<svg class="' + (cls || '') + '" aria-hidden="true"><use href="#ic-' + name + '"/></svg>';
  };

  U.uid = function (prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  };

  U.clamp = (v, min, max) => Math.min(max, Math.max(min, v));

  U.debounce = function (fn, wait) {
    let t = null;
    const wrapped = function () {
      const args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(() => fn.apply(ctx, args), wait);
    };
    wrapped.cancel = () => clearTimeout(t);
    wrapped.flush = function () { clearTimeout(t); };
    return wrapped;
  };

  U.throttle = function (fn, wait) {
    let last = 0, timer = null;
    return function () {
      const now = Date.now(), ctx = this, args = arguments;
      const remain = wait - (now - last);
      if (remain <= 0) { last = now; fn.apply(ctx, args); }
      else if (!timer) {
        timer = setTimeout(() => { timer = null; last = Date.now(); fn.apply(ctx, args); }, remain);
      }
    };
  };

  U.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ---------- 时间 ---------- */
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);

  U.startOfDay = function (ts) {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  };

  U.dayKey = function (ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };

  U.fmtMD = function (ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };

  U.fmtYMD = function (ts) {
    const d = new Date(ts);
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  };

  U.fmtHM = function (ts) {
    const d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };

  U.fmtDateTime = function (ts) {
    return U.fmtMD(ts) + ' ' + U.fmtHM(ts);
  };

  U.relTime = function (ts) {
    if (!ts) return '';
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60 * 1000) return '刚刚';
    if (diff < 60 * 60 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
    const d0 = U.startOfDay(now), d1 = U.startOfDay(ts);
    const dayDiff = Math.round((d0 - d1) / 86400000);
    if (dayDiff === 0) return '今天 ' + U.fmtHM(ts);
    if (dayDiff === 1) return '昨天 ' + U.fmtHM(ts);
    if (dayDiff < 7) return dayDiff + ' 天前';
    return U.fmtMD(ts);
  };

  // 把 date input 的 "2026-11-06" + time "18:00" 合成时间戳
  U.toTs = function (dateStr, timeStr) {
    if (!dateStr) return null;
    const parts = dateStr.split('-').map(Number);
    const t = (timeStr || '00:00').split(':').map(Number);
    return new Date(parts[0], parts[1] - 1, parts[2], t[0] || 0, t[1] || 0, 0, 0).getTime();
  };

  // 待办到期时间：没填日期 → null（永不超时）；只填日期 → 当天 23:59
  U.toDueTs = function (dateStr, timeStr) {
    if (!dateStr) return null;
    return U.toTs(dateStr, timeStr || '23:59');
  };

  U.tsToDateInput = function (ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  };
  U.tsToTimeInput = function (ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  };

  /* ---------- 文件 ---------- */
  U.download = function (filename, content, mime) {
    const blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
  };

  U.readFile = function (file, as) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      if (as === 'dataURL') fr.readAsDataURL(file);
      else fr.readAsText(file, 'utf-8');
    });
  };

  /* ---------- FLIP：让列表重排有过程 ---------- */
  U.flip = function (container, mutate, duration) {
    const prev = new Map();
    Array.prototype.forEach.call(container.children, (child) => {
      const key = child.dataset.key;
      if (key) prev.set(key, child.getBoundingClientRect());
    });
    mutate();
    Array.prototype.forEach.call(container.children, (child) => {
      const key = child.dataset.key;
      const before = key && prev.get(key);
      if (!before) return;
      const after = child.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) return;
      if (child.animate) {
        child.animate(
          [{ transform: 'translate(' + dx + 'px,' + dy + 'px)' }, { transform: 'translate(0,0)' }],
          { duration: duration || 280, easing: 'cubic-bezier(.22,.61,.36,1)' }
        );
      }
    });
  };

  /* ---------- DOM ---------- */
  U.isEditing = function () {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return el.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  };

  U.scrollIntoCenter = function (el, scroller) {
    if (!el) return;
    const root = scroller || el.parentElement;
    if (!root) return;
    const r = el.getBoundingClientRect();
    const rr = root.getBoundingClientRect();
    if (r.top < rr.top + 40 || r.bottom > rr.bottom - 40) {
      root.scrollTop += r.top - rr.top - rr.height / 2 + r.height / 2;
    }
  };

  U.wait = (ms) => new Promise((r) => setTimeout(r, ms));

  global.U = U;
})(window);
