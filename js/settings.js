/* ============================================================
   自在极意 · 设置 与 回收站
   ============================================================ */
(function (global) {
  'use strict';

  const Settings = {};
  const Trash = { tab: 'task', bound: false };

  const ICON = U.icon;

  /* ================= 设置 ================= */
  function row(title, desc, ctl) {
    return '<div class="set-row"><div class="set-row-main">' +
      '<div class="set-row-title">' + title + '</div>' +
      (desc ? '<div class="set-row-desc">' + desc + '</div>' : '') +
      '</div><div class="set-row-ctl">' + ctl + '</div></div>';
  }

  function seg(key, options, current) {
    return '<div class="seg" data-seg="' + key + '">' + options.map((o) =>
      '<button class="seg-btn' + (o.v === current ? ' is-on' : '') + '" data-v="' + o.v + '">' + o.t + '</button>'
    ).join('') + '</div>';
  }

  function sw(key, on) {
    return '<button class="switch' + (on ? ' is-on' : '') + '" data-sw="' + key + '" role="switch" aria-checked="' + (on ? 'true' : 'false') + '"></button>';
  }

  // 桌宠此刻是不是真在桌面上：总开关之外还要算「隐藏 1 小时」。
  // 设置页的开关按这个显示，否则她明明不在，开关却亮着，用户点一下反而把她关掉。
  function petOnNow(st) {
    return st.petVisible !== false && !(st.petHiddenUntil && st.petHiddenUntil > Date.now());
  }

  Settings.render = function () {
    const box = U.$('#settingsBody');
    if (!box) return;
    const st = Store.data.settings;
    const desk = !!Store.isDesktop;
    const info = Store.storageInfo ? Store.storageInfo() : null;
    const backend = info && info.backend === 'sqlite' ? 'SQLite'
      : info && info.backend === 'json' ? '本地数据库'
        : 'localStorage';
    const persistNote = Store.persist
      ? (desk ? '数据存在本机数据目录，关掉程序也不会丢。每天首次启动自动备份一份。'
        : '数据保存在本机浏览器存储里，关闭窗口不会丢。')
      : '当前环境无法持久化，本次会话结束后数据会丢失。';

    let html = '';

    /* 外观 */
    html += '<div class="set-group"><div class="set-group-head">外观</div>';
    html += row('主题', '切换时全局 300ms 交叉淡入，不做瞬间变色',
      seg('theme', [{ v: 'light', t: '浅色' }, { v: 'dark', t: '深色' }], st.theme));
    html += row('界面字号', '只影响界面密度，不改变笔记正文的字号层级',
      seg('fontSize', [{ v: 'sm', t: '小' }, { v: 'md', t: '标准' }, { v: 'lg', t: '大' }], st.fontSize));
    html += '</div>';

    /* 桌宠 */
    html += '<div class="set-group"><div class="set-group-head">桌宠</div>';
    html += row('显示桌宠', '关闭后桌宠完全退出，桌面不再占位', sw('petVisible', petOnNow(st)));
    html += '<div class="set-row"><div class="set-row-main">' +
      '<div class="set-row-title">桌宠尺寸</div>' +
      '<div class="set-row-desc">默认 180px，约等于 1080p 屏幕高度的 1/6</div></div>' +
      '<div class="set-row-ctl"><div class="size-pick">' +
      [120, 180, 240].map((v) => '<button class="size-btn' + (st.petSize === v ? ' is-on' : '') + '" data-size="' + v + '">' + v + '</button>').join('') +
      '</div><input type="range" class="size-slider" min="100" max="300" step="10" value="' + st.petSize + '" data-size-range></div></div>';
    html += row('待机情绪', '让她当场演一段待机情绪，看看都有哪些表情',
      '<button class="btn btn-plain" data-act="pet-random">演一段</button>');
    html += row('跟着鼠标走', '她会小碎步跟在你光标后面，适合演示；平时建议关掉',
      sw('petFollow', st.petFollow === true));
    html += row('全屏时自动躲开', '看视频、打游戏、放演示时暂时隐藏，退出全屏自己回来',
      sw('hideOnFullscreen', st.hideOnFullscreen !== false));
    html += row('爱说话', '关闭后只在超时、完成任务和心流切换时开口',
      sw('petChatty', st.petChatty !== false));
    html += row('叫她一声', '把她从角落叫到屏幕中间',
      '<button class="btn btn-plain" data-act="pet-come">叫她过来</button>');
    html += row('开机自动启动', desk ? '登录 Windows 后自动运行，静默待在托盘里'
      : '需要桌面版；网页版不可用',
      desk ? sw('autoStart', st.autoStart === true) : '<span class="field-hint" style="margin:0">桌面版</span>');
    html += '</div>';

    /* 笔记 */
    html += '<div class="set-group"><div class="set-group-head">笔记</div>';
    html += row('自动保存间隔', '停止输入 300ms 后异步写入，写入不阻塞编辑',
      '<span class="field-hint" style="margin:0">300ms</span>');
    html += row('历史版本保留', '每 5 分钟或每 50 次编辑记一版，保留最近 30 版',
      '<span class="field-hint" style="margin:0">开启</span>');
    html += row('文章大纲', '正文宽度足够时，点右上角按钮浮出，不占正文宽度',
      '<span class="field-hint" style="margin:0">按需浮现</span>');
    html += '</div>';

    /* 数据 */
    html += '<div class="set-group"><div class="set-group-head">数据</div>';
    html += row('数据位置', persistNote, '<span class="field-hint" style="margin:0">' + backend + '</span>');
    if (desk) {
      html += row('数据目录',
        '<span class="set-row-path">' + U.esc((info && info.dir) || '—') + '</span>' +
        '<span class="set-row-note">待办、笔记和备份都存在这里，可以换到任意磁盘；程序本身不会跟着移动。</span>',
        '<button class="btn btn-plain" data-act="change-dir">更换位置</button>' +
        '<button class="btn btn-plain" data-act="open-dir">打开</button>');
    }
    html += row('导出全部数据', desk ? '导出一份当前数据库，可直接备份或迁移到另一台电脑'
      : '导出为 JSON，可用于备份或迁移到桌面版',
      '<button class="btn btn-plain" data-act="export-all">导出</button>');
    html += row('从备份恢复', '选择一个之前导出的文件，会覆盖当前数据',
      '<button class="btn btn-plain" data-act="import-all">选择文件</button>');
    html += row('载入示例数据', '把待办与笔记恢复成初始演示内容',
      '<button class="btn btn-plain" data-act="seed">载入</button>');
    html += row('清空全部数据', '任务、笔记、设置全部清空，不可撤销',
      '<button class="btn btn-danger" data-act="reset">清空</button>');
    html += '</div>';

    /* 通用 */
    html += '<div class="set-group"><div class="set-group-head">通用</div>';
    html += row('最小化到托盘', desk ? '关闭窗口时收进托盘，桌宠继续待在桌面上'
      : '需要桌面版；网页版关闭即退出',
      desk ? sw('minimizeTray', st.minimizeTray !== false) : '<span class="field-hint" style="margin:0">桌面版</span>');
    html += '</div>';

    /* 关于 */
    const ver = (window.host && window.host.versions)
      ? '桌面版 v1.0 · Electron ' + window.host.versions.electron
      : '网页版原型 v1.0';
    html += '<div class="set-group"><div class="set-group-head">关于</div>' +
      '<div class="set-about"><div class="set-about-logo">自</div>' +
      '<div><div class="set-about-name">自在极意</div>' +
      '<div class="set-about-meta">' + ver + ' · 待办 / 笔记 / 桌宠</div></div></div>' +
      '<div class="set-note">按《自在极意 产品需求文档 v1.0》实现。桌宠素材取自三视图合成稿，已切分并去白底；' +
      '眨眼与瞳孔级视线跟随需要分层素材，当前用整体微位移代替。</div></div>';

    box.innerHTML = html;
    // #settingsBody 这个节点不重建，只换它里面的 innerHTML。
    // 以前每次 render 都 addEventListener 一层：boot 一次、切到设置页一次、
    // 桌宠窗口改数据推送过来又一次……点一下开关会连跑 N 个处理器，
    // 状态来回翻转，桌宠闪一下就没了，还连着弹一串「已出现 / 已隐藏」。
    // 所有交互都委托到 box 上，绑一次就够。
    if (!box._settingsBound) {
      bind(box);
      box._settingsBound = true;
    }
  };

  function applyTheme(v) {
    document.documentElement.setAttribute('data-theme', v);
    Store.setting('theme', v);
  }
  function applyFontSize(v) {
    document.documentElement.setAttribute('data-fs', v);
    Store.setting('fontSize', v);
  }
  Settings.applyAppearance = function () {
    const st = Store.data.settings;
    document.documentElement.setAttribute('data-theme', st.theme || 'light');
    document.documentElement.setAttribute('data-fs', st.fontSize || 'md');
  };

  function bind(box) {
    box.addEventListener('click', (e) => {
      const segBtn = e.target.closest('.seg-btn');
      if (segBtn) {
        const wrap = segBtn.closest('.seg');
        const key = wrap.dataset.seg;
        wrap.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('is-on'));
        segBtn.classList.add('is-on');
        if (key === 'theme') { applyTheme(segBtn.dataset.v); UI.toast('已切换到' + (segBtn.dataset.v === 'dark' ? '深色' : '浅色')); }
        if (key === 'fontSize') applyFontSize(segBtn.dataset.v);
        return;
      }

      const swBtn = e.target.closest('[data-sw]');
      if (swBtn) {
        const key = swBtn.dataset.sw;
        // 桌宠开关以「她此刻是否真的在桌面上」为准：托盘、桌宠右键菜单、
        // 隐藏 1 小时、全屏检测随时会改状态，DOM 上的 is-on 可能慢一拍。
        const on = key === 'petVisible'
          ? !petOnNow(Store.data.settings || {})
          : !swBtn.classList.contains('is-on');
        swBtn.classList.toggle('is-on', on);
        swBtn.setAttribute('aria-checked', on ? 'true' : 'false');
        Store.setting(key, on);
        if (key === 'petVisible') {
          // 「隐藏 1 小时」留下的时间戳不清掉，主进程会立刻判定仍该收起，
          // 她就只是露个脸又消失。托盘和侧栏都清了，这里不能漏。
          if (Store.setting('petHiddenUntil')) Store.setting('petHiddenUntil', 0);
          Pet.setVisible(on);
          UI.toast(on ? '桌宠已出现' : '桌宠已隐藏');
        }
        if (key === 'petFollow') {
          Pet.setFollow(on);
          UI.toast(on ? '小塔菲跟着你了' : '小塔菲自己玩去了');
        }
        if (key === 'petChatty') {
          UI.toast(on ? '她会多唠叨几句' : '她安静了');
        }
        if (key === 'hideOnFullscreen') {
          UI.toast(on ? '全屏时会自动躲起来' : '全屏时也留在屏幕上',
            on ? undefined : { warn: true });
        }
        if (key === 'autoStart' && window.host && window.host.setAutoStart) {
          window.host.setAutoStart(on).then((ok) => {
            if (!ok) {
              swBtn.classList.toggle('is-on', !on);
              Store.setting('autoStart', !on);
              UI.toast('系统不允许设置开机自启', { warn: true });
            } else {
              UI.toast(on ? '登录后会自己起来' : '已取消开机自启');
            }
          });
        }
        if (key === 'minimizeTray') {
          UI.toast(on ? '关闭窗口后我会待在托盘里' : '关闭窗口就是退出程序');
        }
        return;
      }

      const sizeBtn = e.target.closest('[data-size]');
      if (sizeBtn) {
        const v = Number(sizeBtn.dataset.size);
        Store.setting('petSize', v);
        Pet.setSize(v);
        box.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === v));
        const range = box.querySelector('[data-size-range]');
        if (range) range.value = v;
        return;
      }

      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;

      if (a === 'pet-random') { Pet.emote(); UI.toast('换了个情绪'); return; }
      if (a === 'pet-come') { Pet.comeHere(); return; }

      if (a === 'open-dir' && window.host && window.host.openDataDir) {
        window.host.openDataDir();
        return;
      }

      // 换数据位置：系统对话框选目录 → 主进程复制 → 重载页面读新库
      if (a === 'change-dir' && window.host && window.host.chooseDataDir) {
        window.host.chooseDataDir().then(function (r) {
          if (!r || r.canceled) return;
          if (r.ok) {
            UI.toast('数据已搬到新位置');
            setTimeout(function () { location.reload(); }, 700);
            return;
          }
          if (r.needConfirm) {
            UI.confirm({
              title: '这个文件夹里已经有数据',
              sub: '直接改用那份数据吗？当前数据会留在原位，不会被删除。',
              okText: '改用这份'
            }).then(function (ok) {
              if (!ok) return;
              window.host.migrateDataDir(r.dir, { adopt: true }).then(function (r2) {
                if (r2 && r2.ok) {
                  UI.toast('已切换到那份数据');
                  setTimeout(function () { location.reload(); }, 700);
                } else {
                  UI.toast((r2 && r2.error) || '切换失败', { warn: true });
                }
              });
            });
            return;
          }
          UI.toast(r.error || '更换失败', { warn: true });
        });
        return;
      }

      if (a === 'export-all') {
        // 桌面版走系统对话框，直接落一份可独立备份的数据库
        if (window.host && window.host.exportData) {
          act.disabled = true;
          window.host.exportData().then((r) => {
            act.disabled = false;
            if (!r) return;
            if (r.ok) UI.toast('已导出到 ' + r.path.split(/[\\/]/).pop(), { duration: 3600 });
            else UI.toast('导出失败：' + r.error, { warn: true, duration: 4200 });
          });
          return;
        }
        const data = JSON.stringify(Store.data, null, 1);
        U.download('自在极意_备份_' + U.dayKey(Date.now()) + '.json', data, 'application/json');
        UI.toast('已导出全部数据');
        return;
      }

      if (a === 'import-all') {
        const input = U.el('input', { type: 'file', accept: '.json,application/json' });
        input.onchange = () => {
          const f = input.files[0];
          if (!f) return;
          U.readFile(f).then((text) => {
            try {
              const d = JSON.parse(text);
              if (!d || !Array.isArray(d.tasks)) throw new Error('格式不对');
              UI.confirm({ title: '用备份覆盖当前数据？', sub: '当前数据会被替换，建议先导出一份。', okText: '覆盖', danger: true })
                .then((ok) => {
                  if (!ok) return;
                  Store.replaceAll(d);
                  location.reload();
                });
            } catch (err) {
              UI.toast('这个文件不是有效的备份', { warn: true });
            }
          });
        };
        input.click();
        return;
      }

      if (a === 'seed') {
        UI.confirm({ title: '载入示例数据？', sub: '当前的待办与笔记会被演示内容替换。', okText: '载入' })
          .then((ok) => { if (ok) { Store.resetAll(true); location.reload(); } });
        return;
      }

      if (a === 'reset') {
        UI.confirm({ title: '清空全部数据？', sub: '任务、笔记、设置都会被删除，无法撤销。', okText: '全部清空', danger: true })
          .then((ok) => { if (ok) { Store.resetAll(false); location.reload(); } });
        return;
      }
    });

    // 滑块每次 render 都会换成新节点，所以也走 box 上的委托，
    // 不能给节点本身挂监听（那样只在第一次 render 有效）。
    box.addEventListener('input', (e) => {
      const range = e.target.closest && e.target.closest('[data-size-range]');
      if (!range) return;
      const v = Number(range.value);
      Pet.setSize(v);
      box.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('is-on', Number(b.dataset.size) === v));
    });
    box.addEventListener('change', (e) => {
      const range = e.target.closest && e.target.closest('[data-size-range]');
      if (range) Store.setting('petSize', Number(range.value));
    });
  }

  /* ================= 回收站 ================= */
  /* 只取「自己这一层」被删的条目。删笔记集时它的章节会一起标记删除，
     全列出来既冗余，又会让人误以为能单独恢复（恢复子项后父项还躺在回收站里，
     列表里根本看不到它）。恢复父项时 Store.restoreItem 会把整棵树一起恢复。 */
  function topTrashNotes() {
    return Store.trashItems().filter((n) => !n.parentId || !(Store.getItem(n.parentId) || {}).deletedAt);
  }

  Trash.render = function (tab) {
    if (tab) Trash.tab = tab;
    const box = U.$('#trashList');
    if (!box) return;
    U.$$('#trashTabs .seg-btn').forEach((b) => b.classList.toggle('is-on', b.dataset.trash === Trash.tab));

    if (Trash.tab === 'task') {
      const list = Store.tasks().filter((t) => t.status === 'done' || t.status === 'deleted')
        .sort((a, b) => (b.completedAt || b.deletedAt || 0) - (a.completedAt || a.deletedAt || 0));
      if (!list.length) {
        box.innerHTML = '<div class="trash-empty">回收站是空的<br>完成或删除的任务会出现在这里</div>';
        return;
      }
      box.innerHTML = list.map((t) => {
        const done = t.status === 'done';
        return '<div class="trash-item" data-tid="' + t.id + '">' +
          '<div class="trash-main">' +
          '<div class="trash-title' + (done ? '' : ' is-deleted') + '">' + U.esc(t.title) + '</div>' +
          '<div class="trash-meta"><span>' + (done ? '已完成' : '已删除') + ' · ' + U.fmtDateTime(done ? (t.completedAt || t.updatedAt) : (t.deletedAt || t.updatedAt)) + '</span>' +
          (t.desc ? '<span>·</span><span>' + U.esc(t.desc.slice(0, 24)) + '</span>' : '') + '</div></div>' +
          '<div class="trash-actions">' +
          '<button class="btn btn-ghost" data-tact="restore">恢复</button>' +
          '<button class="btn btn-danger" data-tact="purge">永久删除</button>' +
          '</div></div>';
      }).join('');
      return;
    }

    const notes = topTrashNotes();
    if (!notes.length) {
      box.innerHTML = '<div class="trash-empty">还没有删除的笔记<br>列表里右键或「…」可以删除</div>';
      return;
    }
    box.innerHTML = notes.map((n) => {
      const p = n.parentId && Store.getItem(n.parentId);
      const kids = Store.descendants(n.id).filter((x) => x.deletedAt).length;
      const kind = n.type === 'folder' ? '文件夹' : n.type === 'notebook' ? '笔记集' : '';
      return '<div class="trash-item" data-nid="' + n.id + '">' +
        '<div class="trash-main">' +
        '<div class="trash-title">' + U.esc(n.title || '未命名') + '</div>' +
        '<div class="trash-meta"><span>' + (kind ? kind + ' · ' : '') + '已删除 · ' + U.fmtDateTime(n.deletedAt || n.updatedAt) + '</span>' +
        (kids ? '<span>·</span><span>含 ' + kids + ' 个子项</span>' : '') +
        (p ? '<span>·</span><span>原属于 ' + U.esc(p.title) + '</span>' : '') + '</div></div>' +
        '<div class="trash-actions">' +
        '<button class="btn btn-ghost" data-nact="restore">恢复</button>' +
        '<button class="btn btn-danger" data-nact="purge">永久删除</button>' +
        '</div></div>';
    }).join('');
  };

  Trash.bind = function () {
    if (Trash.bound) return;
    Trash.bound = true;

    U.$('#trashTabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-trash]');
      if (!b) return;
      Trash.tab = b.dataset.trash;
      Store.ui('lastTrash', Trash.tab);
      Trash.render();
    });

    U.$('#trashList').addEventListener('click', (e) => {
      const act = e.target.closest('[data-tact]');
      if (act) {
        const id = act.closest('[data-tid]').dataset.tid;
        if (act.dataset.tact === 'restore') {
          Store.restoreTask(id);
          Trash.render();
          UI.toast('已恢复到待办列表末尾');
        } else {
          const t = Store.tasks().find((x) => x.id === id);
          UI.confirm({ title: '永久删除？', sub: '「' + U.esc(t ? t.title : '') + '」将无法恢复。', okText: '永久删除', danger: true })
            .then((ok) => { if (ok) { Store.purgeTask(id); Trash.render(); UI.toast('已永久删除'); } });
        }
        return;
      }
      const nact = e.target.closest('[data-nact]');
      if (nact) {
        const id = nact.closest('[data-nid]').dataset.nid;
        if (nact.dataset.nact === 'restore') {
          const kids = Store.descendants(id).filter((x) => x.deletedAt).length;
          Store.restoreItem(id);
          Trash.render();
          UI.toast(kids ? '已恢复，连带 ' + kids + ' 个子项' : '已恢复');
        } else {
          UI.confirm({ title: '永久删除？', sub: '这条笔记及其子项都会消失。', okText: '永久删除', danger: true })
            .then((ok) => { if (ok) { Store.purgeItem(id); Trash.render(); UI.toast('已永久删除'); } });
        }
      }
    });

    U.$('#btnEmptyTrash').addEventListener('click', () => {
      const isTask = Trash.tab === 'task';
      const count = isTask
        ? Store.tasks().filter((t) => t.status === 'done' || t.status === 'deleted').length
        : topTrashNotes().length;
      if (!count) { UI.toast('已经是空的了'); return; }
      UI.confirm({
        title: '清空' + (isTask ? '待办' : '笔记') + '回收站？',
        sub: '共 ' + count + ' 项，清空后无法恢复。',
        okText: '清空',
        danger: true
      }).then((ok) => {
        if (!ok) return;
        if (isTask) {
          Store.tasks().filter((t) => t.status === 'done' || t.status === 'deleted')
            .map((t) => t.id).forEach((id) => Store.purgeTask(id));
        } else {
          topTrashNotes().slice().forEach((n) => Store.purgeItem(n.id));
        }
        Trash.render();
        UI.toast('已清空');
      });
    });
  };

  global.Settings = Settings;
  global.Trash = Trash;
})(window);
