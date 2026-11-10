/* ============================================================
   自在极意 · 数据层
   单一数据源。两种落盘方式：
     · 桌面版：走 Electron 主进程（SQLite，失败自动回退 JSON）
     · 浏览器：localStorage（原型阶段，双击 index.html 就能用）
   写入失败会显式降级为内存态，不假装成功。
   ============================================================ */
(function (global) {
  'use strict';

  const KEY = 'zizai.jiyi.v3';
  const Bridge = global.host && global.host.loadSync ? global.host : null;
  const S = { data: null, persist: true, lastError: null };
  let silentSave = false;   // 应用远端变更时不要回写，否则两个窗口互相反弹
  let infoCache = null;

  function now() { return Date.now(); }

  function defaults() {
    return {
      v: 3,
      inited: true,
      tasks: [],
      items: [],
      contents: {},
      versions: {},
      settings: {
        theme: 'light',
        fontSize: 'md',
        petVisible: true,
        petSize: 180,
        petHiddenUntil: 0,
        hideOnFullscreen: true,
        petPos: null,
        autoStart: false,
        minimizeTray: true,
        outlineOn: false
      },
      ui: { lastView: 'todo', lastTrash: 'task' }
    };
  }

  /* ---------- 演示数据 ---------- */
  function seed() {
    const d = defaults();
    const t = now();
    const H = 3600 * 1000, D = 86400000;

    const mk = (o) => Object.assign({
      id: U.uid('t'), title: '', desc: '', dueAt: null,
      createdAt: t, updatedAt: t, status: 'todo',
      completedAt: null, deletedAt: null, deletedFrom: null
    }, o);

    d.tasks = [
      mk({
        title: '把自在极意的待办页面骨架跑通',
        desc: '正在办理最多两件，第 3 件要拦下来；超时只变色提醒，不自动处理。',
        status: 'doing', createdAt: t - 2 * D, dueAt: t + 5 * H
      }),
      mk({
        title: '整理笔记页的下钻交互',
        desc: '根层列表 ↔ 笔记集章节列表原地切换，返回时恢复滚动位置。',
        status: 'doing', createdAt: t - 2 * D
      }),
      mk({
        title: '桌宠尺寸档位与位置记忆',
        desc: '120 / 180 / 240 三档 + 自由滑杆，拖动后记住坐标。',
        createdAt: t - 1 * D, updatedAt: t - 1 * D
      }),
      mk({
        title: '写清楚数据落盘的异常路径',
        desc: '保存失败必须显式告知，并保留未保存内容。',
        createdAt: t - 1 * D, updatedAt: t - 1 * D, dueAt: t + 2 * D
      }),
      mk({
        title: '把纸张排版的对齐再核一遍',
        desc: '正文列 604px 居中，行高 1.7，段落间距 1.1em。',
        createdAt: t - 3 * H, dueAt: t - 40 * 60 * 1000
      }),
      mk({
        title: '录一段心流模式的动效',
        desc: '',
        createdAt: t - 3 * H
      }),
      mk({
        title: '回顾本周完成的事',
        desc: '已完成的任务都留在回收站里，不自动清理。',
        status: 'done', createdAt: t - 2 * D, completedAt: t - 6 * H
      })
    ];

    const item = (o) => Object.assign({
      id: U.uid('n'), type: 'note', parentId: null, title: '',
      createdAt: t, updatedAt: t, deletedAt: null, fav: false
    }, o);

    const nb1 = item({ type: 'notebook', title: '项目研发', createdAt: t - 6 * D, updatedAt: t - 2 * H, fav: true });
    const ch1 = item({ type: 'chapter', parentId: nb1.id, title: '需求与约束', createdAt: t - 6 * D, updatedAt: t - 2 * H });
    const ch2 = item({ type: 'chapter', parentId: nb1.id, title: '视觉规范落地', createdAt: t - 6 * D, updatedAt: t - 5 * H });
    const ch3 = item({ type: 'chapter', parentId: nb1.id, title: '动效参数表', createdAt: t - 5 * D, updatedAt: t - 1 * D });

    const nb2 = item({ type: 'notebook', title: '硬件调试', createdAt: t - 12 * D, updatedAt: t - 9 * D });
    const ch4 = item({ type: 'chapter', parentId: nb2.id, title: '串口握手记录', createdAt: t - 11 * D, updatedAt: t - 9 * D });

    const folder = item({ type: 'folder', title: '资料归档', createdAt: t - 20 * D, updatedAt: t - 20 * D });
    const note2 = item({ type: 'note', title: '关于「柔和」的三条判断', createdAt: t - 3 * D, updatedAt: t - 3 * D, fav: true });
    const draft = item({ type: 'draft', title: '随手记：窗口尺寸的取舍', createdAt: t - 30 * H, updatedAt: t - 30 * H });

    d.items = [nb1, ch1, ch2, ch3, nb2, ch4, folder, note2, draft];
    d.items.forEach((it, i) => { it.order = i; });

    d.contents[ch1.id] = {
      html: '<h1>一句话定位</h1><p>把「正在做的事」和「长期的知识」放在同一个安静空间里：左边管理事务，右边书写内容，桌面上还有一只陪伴的桌宠。</p>' +
        '<h2>核心约束</h2><p>动画不得牺牲响应速度与数据准确性；没有经过确认的设计不进入开发；数据优先，保存失败必须显式告知。</p>' +
        '<blockquote>任何视觉反馈都不得延迟状态写入。</blockquote>',
      plain: '一句话定位 核心约束 动画不得牺牲响应速度',
      wc: 96, savedAt: t - 2 * H
    };
    d.contents[ch2.id] = {
      html: '<h1>色彩</h1><p>暖米白打底，纸张比底色更亮一档；强调色只有淡粉与浅紫，任何高饱和都被排除在外。</p>' +
        '<h2>圆角与阴影</h2><p>纸张 16px，卡片 12px，控件 10px。阴影统一带暖色偏移，不用纯黑。</p>' +
        '<h3>间距</h3><p>4px 基准，页面左右留白 40px，纸张内边距 48px。</p>',
      plain: '色彩 圆角与阴影 间距',
      wc: 120, savedAt: t - 5 * H
    };
    d.contents[note2.id] = {
      html: '<p>柔和不是把颜色调淡，而是让每一次变化都有过程。</p><ul><li>低饱和配色只是表皮</li><li>过渡时长按交互类型分开设置</li><li>不做夸张弹跳，允许的弹性不超过 3%</li></ul>',
      plain: '柔和不是把颜色调淡', wc: 48, savedAt: t - 3 * D
    };
    d.contents[draft.id] = {
      html: '<p>1280 × 820 是舒适的下限；再窄，纸张就要掉到 604 以下了。</p><p>所以笔记页选双栏下钻，而不是三栏。</p>',
      plain: '1280 x 820', wc: 32, savedAt: t - 30 * H
    };

    return d;
  }

  /* ---------- 读写 ---------- */
  function normalize(d) {
    const base = defaults();
    const out = Object.assign(base, d || {});
    out.settings = Object.assign(base.settings, d && d.settings);
    out.ui = Object.assign(base.ui, d && d.ui);
    out.tasks = Array.isArray(out.tasks) ? out.tasks : [];
    out.items = Array.isArray(out.items) ? out.items : [];
    out.contents = out.contents && typeof out.contents === 'object' ? out.contents : {};
    out.versions = out.versions && typeof out.versions === 'object' ? out.versions : {};
    out.tasks.forEach((t) => {
      if (!t.status) t.status = 'todo';
      if (t.updatedAt == null) t.updatedAt = t.createdAt || now();
    });
    out.items.forEach((it, i) => { if (typeof it.order !== 'number') it.order = i; });
    return out;
  }

  /** 这份数据是不是还没真正初始化过（只有 settings 的空壳） */
  function looksUninitialized(st) {
    if (!st) return true;
    if (st.inited) return false;
    // 网页版导出的旧数据没有 inited 标记，但有内容，不能当空壳
    const noTasks = !Array.isArray(st.tasks) || st.tasks.length === 0;
    const noItems = !Array.isArray(st.items) || st.items.length === 0;
    const noTheme = !(st.settings && st.settings.theme);
    return noTasks && noItems && noTheme;
  }

  function load() {
    /* ---------- 桌面版 ---------- */
    if (Bridge) {
      let res = null;
      try {
        res = Bridge.loadSync();
      } catch (e) {
        S.persist = false;
        S.lastError = e;
      }
      if (res && res.state && !looksUninitialized(res.state)) {
        S.data = normalize(res.state);
        return;
      }
      // 主进程还是空的：把网页版留在 localStorage 里的数据接过来，再写进库
      let legacy = null;
      try { legacy = localStorage.getItem(KEY); } catch (e) {}
      if (legacy) {
        try {
          S.data = normalize(JSON.parse(legacy));
          save();
          return;
        } catch (e) { S.lastError = e; }
      }
      S.data = seed();
      save();
      return;
    }

    /* ---------- 浏览器 ---------- */
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (e) {
      S.persist = false;
      S.lastError = e;
    }
    if (raw) {
      try {
        S.data = normalize(JSON.parse(raw));
      } catch (e) {
        S.data = seed();
        S.lastError = e;
      }
    } else {
      S.data = seed();
      save();
    }
  }

  function save() {
    if (!S.persist) return false;
    if (silentSave) return true;

    if (Bridge) {
      let ok = false;
      try {
        ok = Bridge.saveSync(S.data);
      } catch (e) {
        S.lastError = e;
      }
      if (!ok) {
        S.persist = false;
        S.lastError = S.lastError || new Error('写入磁盘失败');
        document.dispatchEvent(new CustomEvent('app:store', {
          detail: { kind: 'error', message: '数据写入失败，本次改动只在当前会话有效' }
        }));
      }
      return !!ok;
    }

    try {
      localStorage.setItem(KEY, JSON.stringify(S.data));
      return true;
    } catch (e) {
      S.persist = false;
      S.lastError = e;
      return false;
    }
  }

  /* ---------- 桌面版：另一个窗口改了数据 ---------- */
  if (Bridge && Bridge.onChanged) {
    Bridge.onChanged((payload) => {
      if (!payload || !payload.state) return;
      const before = S.data ? Object.assign({}, S.data.settings) : {};
      silentSave = true;
      S.data = normalize(payload.state);
      silentSave = false;
      const after = S.data.settings || {};
      const changed = Object.keys(after).filter((k) => before[k] !== after[k]);
      document.dispatchEvent(new CustomEvent('app:store', {
        detail: { kind: changed.length ? 'settings' : 'remote', keys: changed, from: 'remote' }
      }));
    });
  }

  /** 数据存放信息（设置页展示用） */
  function storageInfo() {
    if (!Bridge) {
      return { backend: 'localStorage', dir: '浏览器本地存储', persist: S.persist };
    }
    if (!infoCache) {
      try { infoCache = Bridge.info(); } catch (e) { infoCache = null; }
    }
    return infoCache || { backend: 'unknown', dir: '—', persist: S.persist };
  }

  function emit(kind, detail) {
    document.dispatchEvent(new CustomEvent('app:store', { detail: Object.assign({ kind: kind }, detail || {}) }));
  }

  /* ---------- 任务 ---------- */
  function tasks() { return S.data.tasks; }

  function activeTasks() {
    return S.data.tasks.filter((t) => t.status === 'todo' || t.status === 'doing');
  }

  function byStatus(status) {
    return S.data.tasks.filter((t) => t.status === status);
  }

  function isOverdue(t) {
    return !!(t.dueAt && t.status !== 'done' && t.status !== 'deleted' && Date.now() > t.dueAt);
  }

  function addTask(o) {
    const t = Object.assign({
      id: U.uid('t'), title: '', desc: '', dueAt: null,
      createdAt: now(), updatedAt: now(), status: 'todo',
      completedAt: null, deletedAt: null, deletedFrom: null
    }, o || {});
    S.data.tasks.push(t);
    save();
    emit('task', { id: t.id });
    return t;
  }

  function updateTask(id, patch) {
    const t = S.data.tasks.find((x) => x.id === id);
    if (!t) return null;
    Object.assign(t, patch, { updatedAt: now() });
    save();
    emit('task', { id: id });
    return t;
  }

  function removeFromArray(arr, id) {
    const i = arr.findIndex((x) => x.id === id);
    if (i >= 0) arr.splice(i, 1);
  }

  function moveTask(id, status) {
    const t = S.data.tasks.find((x) => x.id === id);
    if (!t) return;
    removeFromArray(S.data.tasks, id);
    t.status = status;
    t.updatedAt = now();
    // 插入到同组末尾，保持组内顺序
    let lastIdx = -1;
    S.data.tasks.forEach((x, i) => { if (x.status === status) lastIdx = i; });
    if (lastIdx === -1) S.data.tasks.push(t);
    else S.data.tasks.splice(lastIdx + 1, 0, t);
    save();
    emit('task', { id: id });
  }

  function completeTask(id) {
    const t = S.data.tasks.find((x) => x.id === id);
    if (!t) return null;
    t.status = 'done';
    t.completedAt = now();
    t.updatedAt = now();
    save();
    emit('task', { id: id, completed: true });
    return t;
  }

  function trashTask(id) {
    const t = S.data.tasks.find((x) => x.id === id);
    if (!t) return null;
    t.deletedFrom = t.status;
    t.status = 'deleted';
    t.deletedAt = now();
    save();
    emit('task', { id: id });
    return t;
  }

  function restoreTask(id) {
    const t = S.data.tasks.find((x) => x.id === id);
    if (!t) return null;
    removeFromArray(S.data.tasks, id);
    t.status = 'todo';
    t.completedAt = null;
    t.deletedAt = null;
    t.deletedFrom = null;
    t.updatedAt = now();
    S.data.tasks.push(t);
    save();
    emit('task', { id: id });
    return t;
  }

  function purgeTask(id) {
    removeFromArray(S.data.tasks, id);
    save();
    emit('task', { id: id });
  }

  function reorder(kind, ids) {
    const map = new Map(S.data.tasks.map((t) => [t.id, t]));
    const others = S.data.tasks.filter((t) => t.status !== kind);
    const picked = ids.map((id) => map.get(id)).filter(Boolean);
    const firstIdx = S.data.tasks.findIndex((t) => t.status === kind);
    // 组内顺序替换：把该组元素按新顺序放回原位置区间
    const result = [];
    let inserted = false;
    S.data.tasks.forEach((t) => {
      if (t.status === kind) {
        if (!inserted) { picked.forEach((p) => result.push(p)); inserted = true; }
      } else {
        result.push(t);
      }
    });
    S.data.tasks = result;
    save();
    emit('task', {});
  }

  /* ---------- 笔记 ---------- */
  // 数组里万一手滑混进 null / undefined，整个笔记页会跟着崩（读 .deletedAt 直接抛），
  // 所以这里一次性滤干净，不让坏数据扩散到渲染层。
  function allItems() { return (S.data.items || []).filter(Boolean); }
  function items() { return allItems().filter((i) => !i.deletedAt); }
  function trashItems() { return allItems().filter((i) => i.deletedAt); }
  function getItem(id) { return allItems().find((i) => i.id === id) || null; }

  function children(parentId) {
    return items()
      .filter((i) => (i.parentId || null) === (parentId || null))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  function addItem(type, parentId, title) {
    const siblings = allItems().filter((i) => (i.parentId || null) === (parentId || null));
    const maxOrder = siblings.reduce((m, i) => Math.max(m, i.order || 0), -1);
    const defTitle = type === 'folder' ? '未命名文件夹'
      : type === 'notebook' ? '未命名笔记集'
        : '未命名笔记';
    const it = {
      id: U.uid('n'), type: type, parentId: parentId || null,
      title: title || defTitle, createdAt: now(), updatedAt: now(),
      deletedAt: null, fav: false, order: maxOrder + 1
    };
    S.data.items.push(it);
    if (type !== 'folder' && type !== 'notebook') {
      S.data.contents[it.id] = { html: '', plain: '', wc: 0, savedAt: now() };
    }
    save();
    emit('note', { id: it.id });
    return it;
  }

  function updateItem(id, patch) {
    const it = getItem(id);
    if (!it) return null;
    Object.assign(it, patch, { updatedAt: now() });
    save();
    emit('note', { id: id });
    return it;
  }

  function descendants(id) {
    const out = [];
    const walk = (pid) => {
      allItems().forEach((i) => {
        if (i.parentId === pid) { out.push(i); walk(i.id); }
      });
    };
    walk(id);
    return out;
  }

  function trashItem(id) {
    const it = getItem(id);
    if (!it) return;
    const all = [it].concat(descendants(id));
    all.forEach((x) => { x.deletedAt = now(); });
    save();
    emit('note', { id: id });
  }

  function restoreItem(id) {
    const it = getItem(id);
    if (!it) return;
    const all = [it].concat(descendants(id));
    all.forEach((x) => { x.deletedAt = null; });
    save();
    emit('note', { id: id });
  }

  function purgeItem(id) {
    const kill = new Set([id].concat(descendants(id).map((x) => x.id)));
    S.data.items = allItems().filter((i) => !kill.has(i.id));
    kill.forEach((k) => {
      delete S.data.contents[k];
      delete S.data.versions[k];
    });
    save();
    emit('note', {});
  }

  function moveItem(id, targetParentId) {
    const it = getItem(id);
    if (!it) return false;
    if (targetParentId === id) return false;
    // 不能移入自己的子孙
    if (descendants(id).some((d) => d.id === targetParentId)) return false;
    const siblings = allItems().filter((i) => (i.parentId || null) === (targetParentId || null));
    const maxOrder = siblings.reduce((m, i) => Math.max(m, i.order || 0), -1);
    it.parentId = targetParentId || null;
    it.order = maxOrder + 1;
    it.updatedAt = now();
    save();
    emit('note', { id: id });
    return true;
  }

  function content(id) {
    return S.data.contents[id] || { html: '', plain: '', wc: 0, savedAt: 0 };
  }

  function setContent(id, html, plain) {
    const wc = (plain || '').replace(/\s+/g, '').length;
    S.data.contents[id] = { html: html, plain: plain || '', wc: wc, savedAt: now() };
    const it = getItem(id);
    if (it) it.updatedAt = now();
    const ok = save();
    emit('note', { id: id, saved: ok });
    return ok;
  }

  function pushVersion(id, html, plain) {
    const list = S.data.versions[id] || [];
    const last = list[list.length - 1];
    if (last && last.html === html) return;
    list.push({ at: now(), html: html, plain: plain || '' });
    // 保留最近 30 版
    while (list.length > 30) list.shift();
    S.data.versions[id] = list;
    save();
  }

  function versions(id) {
    return (S.data.versions[id] || []).slice().reverse();
  }

  /* ---------- 搜索 ---------- */
  function searchNotes(q) {
    const kw = (q || '').trim().toLowerCase();
    if (!kw) return [];
    const out = [];
    allItems().forEach((it) => {
      if (it.deletedAt) return;
      const c = S.data.contents[it.id];
      const inTitle = (it.title || '').toLowerCase().indexOf(kw) >= 0;
      const inBody = c && (c.plain || '').toLowerCase().indexOf(kw) >= 0;
      if (inTitle || inBody) out.push({ item: it, inTitle: inTitle, inBody: !!inBody });
    });
    return out;
  }

  /* ---------- 设置 ---------- */
  function setting(k, v) {
    if (v === undefined) return S.data.settings[k];
    S.data.settings[k] = v;
    save();
    emit('settings', { key: k });
    return v;
  }
  function ui(k, v) {
    if (v === undefined) return S.data.ui[k];
    S.data.ui[k] = v;
    save();
    return v;
  }

  /* ---------- 工具 ---------- */
  function stripHtml(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function htmlToText(html) {
    const d = document.createElement('div');
    d.innerHTML = html || '';
    d.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
    d.querySelectorAll('p,div,h1,h2,h3,h4,li,blockquote,pre,tr').forEach((n) => n.append('\n'));
    return (d.textContent || '').replace(/\n{3,}/g, '\n\n').trim();
  }

  function stats() {
    const doing = byStatus('doing').length;
    const todo = byStatus('todo').length;
    const done = byStatus('done').length;
    const notes = items().filter((i) => i.type === 'note' || i.type === 'draft' || i.type === 'chapter').length;
    return { doing: doing, todo: todo, done: done, notes: notes };
  }

  function resetAll(withSeed) {
    S.data = withSeed === false ? defaults() : seed();
    save();
    emit('reset', {});
  }

  /** 用一份外部快照整体替换（从备份恢复） */
  function replaceAll(raw) {
    S.data = normalize(raw);
    save();
    emit('reset', {});
  }

  load();

  global.Store = {
    get data() { return S.data; },
    get persist() { return S.persist; },
    get lastError() { return S.lastError; },
    isDesktop: !!Bridge,
    storageInfo: storageInfo,
    save: save,
    resetAll: resetAll,
    replaceAll: replaceAll,
    setting: setting,
    ui: ui,
    tasks: tasks,
    activeTasks: activeTasks,
    byStatus: byStatus,
    isOverdue: isOverdue,
    addTask: addTask,
    updateTask: updateTask,
    moveTask: moveTask,
    completeTask: completeTask,
    trashTask: trashTask,
    restoreTask: restoreTask,
    purgeTask: purgeTask,
    reorder: reorder,
    items: items,
    trashItems: trashItems,
    getItem: getItem,
    children: children,
    descendants: descendants,
    addItem: addItem,
    updateItem: updateItem,
    trashItem: trashItem,
    restoreItem: restoreItem,
    purgeItem: purgeItem,
    moveItem: moveItem,
    content: content,
    setContent: setContent,
    pushVersion: pushVersion,
    versions: versions,
    searchNotes: searchNotes,
    stripHtml: stripHtml,
    htmlToText: htmlToText,
    stats: stats
  };
})(window);
