/* ============================================================
   自在极意 · 桌宠窗口的宿主层

   pet.js 原本跑在应用主窗口里，直接读 Store 和 UI。
   桌面版把桌宠搬到独立透明窗口后，这个文件就负责三件事：

     1. 给 pet.js 一套和主窗口同名的 Store / UI 桩，
        让 pet.js 一行都不用改；
     2. 把主进程推来的数据变化翻译成 pet.js 认识的 app:store 事件；
     3. 鼠标命中检测 —— 窗口铺满屏幕，只有指针压到她身上时
        才关掉穿透，其余时候让点击落到下面的应用里。
   ============================================================ */
(function (global) {
  'use strict';

  const host = global.petHost;
  const initial = host && host.loadSync ? (host.loadSync() || {}) : {};

  let state = initial.state || {};
  let lastSettings = Object.assign({}, state.settings || {});
  let lastTasks = state.tasks || [];

  /* ---------------- Store 桩 ---------------- */
  const Store = {
    get data() { return state; },
    get persist() { return true; },
    get lastError() { return null; },

    setting(k, v) {
      if (v === undefined) return state.settings ? state.settings[k] : undefined;
      state.settings = state.settings || {};
      state.settings[k] = v;
      if (host) host.patch({ settings: { [k]: v } });
      return v;
    },

    ui(k, v) {
      state.ui = state.ui || {};
      if (v === undefined) return state.ui[k];
      state.ui[k] = v;
      if (host) host.patch({ ui: { [k]: v } });
      return v;
    },

    save() { return true; },

    tasks() { return state.tasks || []; },
    byStatus(s) { return (state.tasks || []).filter((t) => t.status === s); },
    activeTasks() { return (state.tasks || []).filter((t) => t.status === 'todo' || t.status === 'doing'); },
    isOverdue(t) {
      return !!(t && t.dueAt && t.status !== 'done' && t.status !== 'deleted' && Date.now() > t.dueAt);
    }
  };
  global.Store = Store;

  /* ---------------- UI 桩 ---------------- */
  const UI = {};
  let menuOpen = false;

  UI.toast = function (msg, opts) {
    const box = document.getElementById('toastHost');
    if (!box) return;
    box.style.display = '';
    const node = U.el('div', { class: 'toast' + ((opts && opts.warn) ? ' is-warn' : '') }, [
      U.el('span', { class: 'toast-dot' }),
      U.el('span', { text: msg })
    ]);
    box.appendChild(node);
    setTimeout(() => {
      node.classList.add('is-out');
      setTimeout(() => {
        node.remove();
        if (!box.children.length) box.style.display = 'none';
      }, 220);
    }, (opts && opts.duration) || 2000);
  };

  UI.closeMenu = function () {
    const layer = document.getElementById('menuLayer');
    if (!layer) return;
    layer.classList.remove('is-on');
    layer.innerHTML = '';
    menuOpen = false;
    reportGeo(true);
  };

  UI.menu = function (anchor, o) {
    const opts = o || {};
    UI.closeMenu();
    const layer = document.getElementById('menuLayer');
    const scrim = U.el('div', { class: 'menu-scrim' });
    const box = U.el('div', { class: 'menu', role: 'menu' });

    (opts.items || []).forEach((it) => {
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
        UI.closeMenu();
        if (it.onClick) setTimeout(it.onClick, 0);
      });
      box.appendChild(btn);
    });

    layer.appendChild(scrim);
    layer.appendChild(box);
    layer.classList.add('is-on');
    scrim.addEventListener('pointerdown', UI.closeMenu);

    const r = anchor.getBoundingClientRect();
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let left = opts.align === 'right' ? r.right - bw : r.left;
    let top = r.bottom + 6;
    if (top + bh > window.innerHeight - 8) top = Math.max(8, r.top - bh - 6);
    left = U.clamp(left, 8, window.innerWidth - bw - 8);
    box.style.left = left + 'px';
    box.style.top = top + 'px';

    menuOpen = true;
    // 菜单一出来整块屏幕都要能接鼠标（蒙层要接「点外面关闭」），
    // 立刻把 held 报给主进程，不等下一轮轮询
    reportGeo(true);
    return box;
  };

  UI.isBusy = () => menuOpen;
  UI.confirm = () => Promise.resolve(true);
  UI.alert = () => Promise.resolve(true);
  UI.modal = () => ({ close() {} });
  UI.colorMenu = () => null;
  global.UI = UI;

  /* 双击桌宠 / 点举牌 → 回到主程序对应页面 */
  global.App = {
    go(view) {
      if (host) host.mainGo(view || 'todo');
    },
    current: () => 'todo',
    toast: (m, o) => UI.toast(m, o)
  };

  /* ---------------- 命中区域上报 ----------------
     窗口「穿不穿透」由主进程单独决定 —— 它是窗口状态的唯一真相源。
     页面只负责上报三件事：她（以及气泡 / 举牌 / 菜单）现在占哪些矩形、
     有没有按住或开着菜单、页面还活着。每 120ms 无条件上报一次，顺带当心跳。

     以前是「主进程推光标 → 页面判定 → 回一个开关 → 主进程执行」的闭环，
     还配了「6 秒收不到消息就强制穿透」的超时保护。两侧任何一处状态错位，
     窗口就会永久停在穿透态：她看得见、点不到，连右键菜单都弹不出来。
     现在没有回环：主进程拿几何自己算，算错了下一轮 60ms 就纠正；
     页面死了就重载页面，而不是偷偷把窗口改成穿透。
     -------------------------------------------------------- */
  let held = false;             // 拖拽 / 菜单期间整块窗口都要能接鼠标
  let holdAt = 0;
  let lastGeo = '';
  let suppressed = false;       // 全屏 / 用户收起：窗口还在，但她整个不可见

  function rectOf(n) {
    if (!n || n.hidden) return null;
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return null;
    const r = n.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return null;
    return [Math.round(r.left), Math.round(r.top), Math.round(r.right), Math.round(r.bottom)];
  }

  function collectGeo() {
    // 收起时一个可点区域都不给：窗口全穿透，点击照常落到下面的应用
    if (suppressed) return { rects: [], held: false, ts: Date.now() };
    const pet = document.getElementById('pet');
    const rects = [];
    // 她收起来了就一个可点区域都不给，别挡住下面的窗口
    if (pet && !pet.classList.contains('is-hidden')) {
      const b = rectOf(document.getElementById('petBody'));
      if (b) {
        // 图片两侧有透明边，各内收 3%；宁可多挡一点空白也别让手落空
        const pad = Math.round((b[2] - b[0]) * 0.03);
        rects.push([b[0] + pad, b[1] - 4, b[2] - pad, b[3] + 6]);
      }
    }
    const boxes = ['.pet-bubble', '.pet-sign', '.menu'];
    for (let i = 0; i < boxes.length; i++) {
      const r = rectOf(document.querySelector(boxes[i]));
      if (r) rects.push(r);
    }
    // 抬手事件丢了（切窗口 / 弹窗抢焦点）时别把窗口钉死
    if (held && Date.now() - holdAt > 20000) held = false;
    return { rects: rects, held: held || menuOpen, ts: Date.now() };
  }

  function reportGeo(force) {
    if (!host || !host.geo) return;
    const g = collectGeo();
    const key = JSON.stringify(g.rects) + '|' + g.held;
    if (!force && key === lastGeo) return;
    lastGeo = key;
    try { host.geo(g); } catch (_) {}
  }

  function hold(on) {
    held = !!on;
    holdAt = Date.now();
    if (host && host.hold) host.hold(held);   // 快通道：按下立刻关穿透
    reportGeo(true);
  }
  global.petHold = hold;

  // 无条件定时上报：她在 transform 里走动时几何每帧都在变，也省得做变化检测
  setInterval(() => reportGeo(true), 80);

  // 快通道：穿透状态下 forward 会把 mousemove 送进来，指针一动就立刻上报，
  // 主进程随即重算一次，不用等定时器 —— 否则移到她身上的第一次点击会被吞掉
  let moveTimer = null;
  window.addEventListener('mousemove', () => {
    if (moveTimer) return;
    moveTimer = setTimeout(() => { moveTimer = null; reportGeo(true); }, 25);
  }, true);

  // 窗口失焦时立刻报一次，避免状态停留在旧的几何上
  window.addEventListener('blur', () => reportGeo(true));

  // 收起 / 恢复：OS 窗口永远不 hide/show（那样会让 Chromium 停止投递鼠标事件），
  // 只切一层 visibility 样式，并让主进程知道「现在没有可点区域」
  if (host && host.onSuppress) {
    host.onSuppress((on) => {
      suppressed = !!on;
      document.documentElement.classList.toggle('pet-suppressed', suppressed);
      if (suppressed) {
        held = false;
        menuOpen = false;
        const layer = document.getElementById('menuLayer');
        if (layer) { layer.classList.remove('is-on'); layer.innerHTML = ''; }
      }
      reportGeo(true);
    });
  }

  /* ---------------- 主进程数据推送 ---------------- */
  if (host) {
    host.onChanged((payload) => {
      if (!payload || !payload.state) return;
      const prev = lastSettings;
      state = payload.state;
      const next = state.settings || {};
      lastTasks = state.tasks || [];

      // 把 settings 的差异翻译成 pet.js 认得的 app:store 事件
      const keys = Object.keys(next);
      keys.forEach((k) => {
        if (prev[k] === next[k]) return;
        if (k === 'petPos') return;          // 位置由她自己记，回推会造成回路
        document.dispatchEvent(new CustomEvent('app:store', {
          detail: { kind: 'settings', key: k }
        }));
      });
      lastSettings = Object.assign({}, next);

      // 任务变了：刷新气泡内容 + 重新检查超时
      if (JSON.stringify(lastTasks) !== JSON.stringify(state.tasks)) {
        document.dispatchEvent(new CustomEvent('app:store', { detail: { kind: 'task' } }));
      }
    });

    host.onInvoke((msg) => {
      if (!msg || !msg.fn) return;
      const fn = global.Pet && global.Pet[msg.fn];
      if (typeof fn !== 'function') return;
      try { fn.apply(global.Pet, msg.args || []); } catch (e) { console.warn('pet invoke', msg.fn, e); }
    });

    host.onFlow((on) => {
      if (!global.Pet) return;
      if (on && Pet.onFlowStart) Pet.onFlowStart();
      if (!on && Pet.onFlowEnd) Pet.onFlowEnd();
    });
  }

  global.PetHost = {
    debug() {
      const g = collectGeo();
      return { rects: g.rects, held: g.held, menuOpen: menuOpen, heldRaw: held };
    }
  };
})(window);
