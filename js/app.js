/* ============================================================
   自在极意 · 应用骨架（路由 / 初始化）
   ============================================================ */
(function (global) {
  'use strict';

  const App = {};
  const ORDER = { todo: 0, notes: 1, trash: 2, settings: 3 };
  let current = null;

  const VIEWS = {
    todo: '#view-todo',
    notes: '#view-notes',
    trash: '#view-trash',
    settings: '#view-settings'
  };

  function railSet(view) {
    U.$$('.rail-btn[data-nav]').forEach((b) => {
      b.classList.toggle('is-on', b.dataset.nav === view);
    });
  }

  App.go = function (view, opts) {
    const o = opts || {};
    if (!VIEWS[view]) view = 'todo';
    const target = U.$(VIEWS[view]);
    if (!target) return;

    const dir = current && ORDER[view] < ORDER[current] ? 'left' : 'right';
    if (current === view && !o.force) {
      // 同页重复点击：只重渲染
    }

    U.$$('.view').forEach((v) => v.classList.remove('is-on'));
    target.dataset.enter = current ? dir : 'none';

    // 进入前的渲染
    if (view === 'todo') Todo.render();
    if (view === 'notes') Notes.render();
    if (view === 'trash') { Trash.tab = o.trash || Store.ui('lastTrash') || 'task'; Trash.render(Trash.tab); }
    if (view === 'settings') Settings.render();

    void target.offsetWidth;
    // 正常走下一帧，让入场过渡有起始状态；但窗口被遮挡时 Chromium 会暂停帧回调，
    // 那时若没人兜底，视图会一直停在 opacity:0 / pointer-events:none，整页点不动。
    let shown = false;
    const showView = () => {
      if (shown) return;
      shown = true;
      // 连续切页时，上一轮挂起的回调别把旧视图又点亮成 is-on
      if (current === view) target.classList.add('is-on');
    };
    requestAnimationFrame(showView);
    setTimeout(showView, 120);

    current = view;
    railSet(view);
    Store.ui('lastView', view);
    document.body.dataset.view = view;
    if (view === 'notes' && window.innerWidth <= (window.Notes && Notes.DRAWER_W || 1040)) {
      U.$('#view-notes').classList.remove('is-drawer');
      // 空态提示要看「列表当前是收着的」才对，重渲染后再刷新一次
      if (Notes && Notes.syncEmptyHint) Notes.syncEmptyHint();
    }
  };

  App.current = () => current;
  App.toast = function (msg, opts) { UI.toast(msg, opts); };

  function bindRail() {
    U.$('#rail').addEventListener('click', (e) => {
      const btn = e.target.closest('.rail-btn[data-nav]');
      if (btn) {
        const nav = btn.dataset.nav;
        // 窄窗口下「笔记」按钮已经在本页时，改成开/关笔记列表 —— 否则列表一展开
        // 就只剩这个图标能关掉它，用户得靠猜
        if (nav === 'notes' && current === 'notes' && window.Notes &&
            window.Notes.toggleList && window.innerWidth <= (Notes.DRAWER_W || 1040)) {
          window.Notes.toggleList();
          return;
        }
        App.go(nav);
        return;
      }
      if (e.target.closest('#petToggle')) {
        // 和设置页共用同一套真值判断：桌宠窗口 / 托盘 / 全屏检测也会改它
        const on = Store.setting('petVisible') === false;
        Store.setting('petVisible', on);
        if (Store.setting('petHiddenUntil')) Store.setting('petHiddenUntil', 0);
        Pet.setVisible(on);
        UI.toast(on ? '桌宠已出现' : '桌宠已隐藏');
        if (current === 'settings') Settings.render();
      }
    });

    // 页面内的 data-nav 快捷入口
    document.addEventListener('click', (e) => {
      const t = e.target.closest('.link-btn[data-nav]');
      if (t) App.go(t.dataset.nav);
    });
  }

  function tick() {
    // 每 30s 检查超时状态，只更新必要的 UI
    if (current === 'todo') Todo.refreshOverdue();
  }

  function boot() {
    Settings.applyAppearance();
    Todo.bind();
    Notes.bind();                     // 只 render 不 bind 的话，笔记页所有按钮和输入都是死的
    Notes.render();
    Trash.bind();
    Settings.render();
    Pet.init();                       // 桌面版这是空实现，真正的桌宠在独立窗口里
    bindRail();
    bindDesktop();

    const last = Store.ui('lastView') || 'todo';
    App.go(last === 'settings' ? 'todo' : last);
    current = current || 'todo';

    if (!Store.persist) {
      setTimeout(() => {
        UI.toast('当前环境无法写入磁盘，数据只在本次会话有效', { warn: true, duration: 4200 });
      }, 900);
    }

    setInterval(tick, 30000);

    // 主题跟随系统时不影响手动选择，这里只处理首次进入
    if (!Store.data.settings.theme) Settings.applyAppearance();
  }

  /* ---------- 桌面版专属接线 ---------- */
  function bindDesktop() {
    const host = window.host;
    if (!host) return;

    // 托盘 / 桌宠双击要求切页面
    if (host.onNavigate) {
      host.onNavigate((view) => App.go(view));
    }

    // 写盘失败要说出来，不能让用户以为存上了
    document.addEventListener('app:store', (e) => {
      const d = e.detail || {};
      if (d.kind === 'error' && d.message) {
        UI.toast(d.message, { warn: true, duration: 5000 });
      }
      // 桌宠窗口改了设置（隐藏、尺寸），设置页要及时反映。
      // 这里直接重绘，不要合并到 requestAnimationFrame：主窗口被桌宠那个
      // 铺满屏幕的置顶窗口盖住时，帧回调可能被节流甚至不触发，开关就会停在旧状态。
      // render 现在只换 innerHTML（委托只绑一次），多刷几次没有副作用。
      if (d.from === 'remote' && App.current() === 'settings') Settings.render();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  global.App = App;
})(window);
