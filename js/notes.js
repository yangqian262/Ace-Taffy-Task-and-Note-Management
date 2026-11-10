/* ============================================================
   自在极意 · 笔记模块（双栏下钻 + 纸张编辑器）
   ============================================================ */
(function (global) {
  'use strict';

  const Notes = {};
  const ICON = U.icon;

  // 窄到这个宽度以下，列表改成抽屉浮层（能盖住正文，所以必须有明确的收起入口）
  const DRAWER_W = 1040;
  Notes.DRAWER_W = DRAWER_W;

  function notesView() { return U.$('#view-notes'); }

  // 列表是否正显示：窄屏看抽屉开没开，宽屏看是不是被收起来了
  function listVisible() {
    const v = notesView();
    if (!v) return true;
    return window.innerWidth <= DRAWER_W
      ? v.classList.contains('is-drawer')
      : !v.classList.contains('is-collapsed');
  }

  function setListVisible(show) {
    const v = notesView();
    if (!v) return;
    if (window.innerWidth <= DRAWER_W) v.classList.toggle('is-drawer', !!show);
    else v.classList.toggle('is-collapsed', !show);
    if (typeof syncEmptyHint === 'function') syncEmptyHint();
  }
  const state = {
    openId: null,
    drillId: null,          // 下钻的文件夹 / 笔记集 id
    tabs: [],
    query: '',
    chapQuery: '',
    outlineOpen: false,
    savedAt: 0,
    edits: 0,
    lastSnap: 0,
    pendingSave: null,
    rootScroll: 0
  };

  let saveTimer = null;

  const TYPE_ICON = { folder: 'folder', notebook: 'book', chapter: 'doc', note: 'note', draft: 'draft' };
  const TYPE_NAME = { folder: '文件夹', notebook: '笔记集', chapter: '章节', note: '独立笔记', draft: '草稿' };
  const TYPE_DEF_TITLE = { folder: '未命名文件夹', notebook: '未命名笔记集', chapter: '未命名章节', note: '未命名笔记', draft: '未命名草稿' };

  /* ---------------- 工具 ---------------- */
  function pathOf(id) {
    const arr = [];
    let cur = Store.getItem(id);
    let guard = 0;
    while (cur && guard++ < 12) {
      arr.unshift(cur);
      cur = cur.parentId ? Store.getItem(cur.parentId) : null;
    }
    return arr;
  }

  function chapCount(id) {
    return Store.items().filter((i) => i.parentId === id).length;
  }

  function hl(text, kw) {
    const s = U.esc(text || '');
    if (!kw) return s;
    const k = U.esc(kw).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return s.replace(new RegExp(k, 'gi'), (m) => '<mark>' + m + '</mark>');
  }

  function rowHtml(item, opts) {
    const o = opts || {};
    const kw = o.kw !== undefined ? o.kw : state.query;
    const isOn = state.openId === item.id;
    const hasChild = item.type === 'folder' || item.type === 'notebook';
    const count = hasChild ? Store.items().filter((i) => i.parentId === item.id).length : 0;
    const meta = hasChild ? count : U.relTime(item.updatedAt);
    return '<button class="nrow' + (isOn ? ' is-on' : '') + (item.fav ? ' is-fav' : '') + '" data-id="' + item.id + '">' +
      (o.number ? '<span class="chap-no">' + o.number + '</span>' : '<span class="nrow-ico">' + ICON(TYPE_ICON[item.type]) + '</span>') +
      '<span class="nrow-title">' + hl(item.title || TYPE_DEF_TITLE[item.type], kw) + '</span>' +
      '<span class="nrow-star">' + ICON('star') + '</span>' +
      (o.number ? '' : '<span class="nrow-meta">' + meta + '</span>') +
      (hasChild ? '<span class="nrow-chev">' + ICON('chev-r') + '</span>' : '') +
      (o.noMenu ? '' : '<span class="nrow-more" data-more="' + item.id + '" role="button" tabindex="-1" aria-label="更多操作">' + ICON('more') + '</span>') +
      '</button>';
  }

  /* ---------------- 列表 ---------------- */
  function renderList() {
    const body = U.$('#nlistBody');
    const head = U.$('.nlist-head');
    const searchBox = U.$('.nlist-search');
    const oldDrill = U.$('.drill-search');
    if (oldDrill) oldDrill.remove();
    body.scrollTop = 0;

    if (state.query) {
      head.querySelector('.nlist-title').textContent = '搜索结果';
      searchBox.hidden = false;
      const res = Store.searchNotes(state.query);
      if (!res.length) {
        body.innerHTML = '<div class="nlist-empty"><strong>没有匹配的内容</strong>试试换个关键词</div>';
        return;
      }
      let html = '<div class="ngroup-label">共 ' + res.length + ' 条</div>';
      res.forEach((r) => {
        const p = pathOf(r.item.id).slice(0, -1).map((x) => x.title).join(' / ');
        html += '<button class="nrow' + (state.openId === r.item.id ? ' is-on' : '') + '" data-id="' + r.item.id + '">' +
          '<span class="nrow-ico">' + ICON(TYPE_ICON[r.item.type]) + '</span>' +
          '<span class="nrow-title" style="display:flex;flex-direction:column;gap:1px">' +
          '<span>' + hl(r.item.title, state.query) + '</span>' +
          (p ? '<span style="font-size:11px;color:var(--ink-faint)">' + U.esc(p) + '</span>' : '') +
          '</span></button>';
      });
      body.innerHTML = html + footHtml();
      return;
    }

    if (state.drillId) {
      renderDrill(body, head, searchBox);
      return;
    }

    head.querySelector('.nlist-title').textContent = '笔记';
    searchBox.hidden = false;
    U.$('#btnMove').disabled = !state.openId;

    const roots = Store.children(null);
    const recent = Store.items()
      .filter((i) => i.type === 'note' || i.type === 'draft' || i.type === 'chapter')
      .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 3);
    const favs = Store.items().filter((i) => i.fav);

    let html = '';
    if (recent.length) {
      html += '<div class="ngroup-label">最近编辑</div>';
      recent.forEach((i) => { html += rowHtml(i); });
    }
    if (favs.length) {
      html += '<div class="ngroup-label">收藏</div>';
      favs.forEach((i) => { html += rowHtml(i); });
    }
    if (roots.length) {
      html += '<div class="ngroup-label">全部内容</div>';
      roots.forEach((i) => { html += rowHtml(i); });
    }
    if (!roots.length && !recent.length) {
      html += '<div class="nlist-empty"><strong>还没有任何内容</strong>先创建一个笔记集<br>或随手记一条草稿</div>';
    }
    body.innerHTML = html + footHtml();
  }

  function footHtml() {
    return '<div class="nlist-foot">' +
      '<button class="nrow" data-act="trash-entry">' + ICON('trash') + '<span class="nrow-title">回收站</span></button>' +
      '<button class="nrow" data-act="new-menu">' + ICON('plus') + '<span class="nrow-title">新建</span></button>' +
      '</div>';
  }

  function renderDrill(body, head, searchBox) {
    const nb = Store.getItem(state.drillId);
    if (!nb) { state.drillId = null; renderList(); return; }
    head.querySelector('.nlist-title').textContent = nb.type === 'folder' ? '文件夹' : '笔记集';
    searchBox.hidden = true;
    U.$('#btnMove').disabled = !state.openId;

    const unit = nb.type === 'folder' ? '条目' : '章节';
    let html = '<button class="drill-back" data-act="back">' + ICON('arrow-left') + '<span>返回笔记列表</span></button>' +
      '<div class="drill-head">' +
      '<div class="drill-title">' + U.esc(nb.title) + '</div>' +
      '<button class="drill-more" data-act="drill-more" data-id="' + nb.id + '" title="更多操作" aria-label="更多操作">' +
      ICON('more') + '</button>' +
      '</div>' +
      '<div class="drill-sub">' + (nb.type === 'folder' ? '文件夹' : '笔记集') + ' · ' + chapCount(nb.id) + ' 个' + unit + '</div>' +
      '<div class="nlist-search drill-search">' + ICON('search', 'nlist-search-ico') +
      '<input type="text" placeholder="搜索' + unit + '" value="' + U.esc(state.chapQuery) + '" autocomplete="off"></div>' +
      '<div data-chap-list></div>' +
      footHtml();

    body.innerHTML = html;
    paintChapters();

    const inp = body.querySelector('.drill-search input');
    if (inp) {
      inp.addEventListener('input', U.debounce(function () {
        state.chapQuery = this.value;
        paintChapters();
      }, 150));
    }
    const nrowOn = body.querySelector('.nrow.is-on');
    if (nrowOn) U.scrollIntoCenter(nrowOn, body);
  }

  function paintChapters() {
    const box = U.$('[data-chap-list]');
    if (!box) return;
    const nb = Store.getItem(state.drillId);
    if (!nb) return;
    const kids = Store.children(nb.id).filter((i) => {
      if (!state.chapQuery) return true;
      return (i.title || '').toLowerCase().indexOf(state.chapQuery.toLowerCase()) >= 0;
    });
    if (!kids.length) {
      box.innerHTML = '<div class="nlist-empty">' + (state.chapQuery ? '没有匹配的章节' : '这里还是空的<br>点下面的「新建」添加') + '</div>';
      return;
    }
    box.innerHTML = kids.map((it, i) =>
      rowHtml(it, { number: it.type === 'chapter' ? String(i + 1).padStart(2, '0') : '', kw: state.chapQuery })
    ).join('');
  }

  /* ---------------- 标签页 ---------------- */
  function renderTabs() {
    const bar = U.$('#tabbar');
    if (state.tabs.length <= 1) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    bar.hidden = false;
    bar.innerHTML = state.tabs.map((id) => {
      const it = Store.getItem(id);
      if (!it) return '';
      return '<button class="tab' + (state.openId === id ? ' is-on' : '') + '" data-tab="' + id + '">' +
        '<span class="tab-name">' + U.esc(it.title || TYPE_DEF_TITLE[it.type]) + '</span>' +
        '<span class="tab-x" data-close="' + id + '">' + ICON('x') + '</span>' +
        '</button>';
    }).join('');
  }

  /* ---------------- 面包屑 ---------------- */
  function renderCrumbs() {
    const box = U.$('#crumbs');
    // 进入笔记集 / 文件夹时 openId 是空的，路径要跟着 drillId 走
    const id = state.openId || state.drillId;
    if (!id) { box.innerHTML = ''; return; }
    const p = pathOf(id);
    box.innerHTML = p.map((it, i) => {
      const last = i === p.length - 1;
      return '<button class="crumb' + (last ? ' is-last' : '') + '" data-crumb="' + it.id + '">' +
        U.esc(it.title || TYPE_DEF_TITLE[it.type]) + '</button>' +
        (last ? '' : '<span class="crumb-sep">/</span>');
    }).join('');
  }

  /* ---------------- 编辑器 ---------------- */
  function setStatus(kind, text) {
    const el = U.$('#saveStatus');
    el.className = 'save-status' + (kind === 'saving' ? ' is-saving' : kind === 'error' ? ' is-error' : '');
    el.textContent = text || '';
  }

  /* 空编辑区的文案与按钮：普通空态 vs 「正站在某个笔记集里」 */
  function paintEmpty(drill) {
    const box = U.$('#edEmpty');
    if (!box) return;
    const title = box.querySelector('.ed-empty-title');
    const sub = box.querySelector('.ed-empty-sub');
    U.$$('[data-empty-kind]', box).forEach((n) => {
      n.hidden = n.dataset.emptyKind === (drill ? 'box' : 'general') ? false : true;
    });
    if (drill) {
      if (title) title.textContent = drill.title || TYPE_DEF_TITLE[drill.type];
      if (sub) {
        sub.textContent = TYPE_NAME[drill.type] + ' · 共 ' + chapCount(drill.id) + ' 项，点左侧任意一项开始编辑';
      }
      const add = box.querySelector('[data-empty-act="new-in-box"]');
      if (add) add.textContent = drill.type === 'folder' ? '在文件夹里新建笔记' : '在本集新建一章';
    } else {
      if (title) title.textContent = '还没有打开任何内容';
      if (sub) {
        // 列表收着的时候「左侧选一条」是句空话（窄窗口抽屉收起、宽窗口左栏折叠都一样）
        sub.textContent = listVisible()
          ? '左侧选一条，或者新建'
          : '点左上角按钮展开笔记列表，或直接新建';
      }
    }
  }

  // 空态下的提示要跟着抽屉开合变化，只在空态且非下钻时刷新
  function syncEmptyHint() {
    const main = U.$('#nmain');
    if (!main || !main.classList.contains('is-empty') || main.classList.contains('is-drill')) return;
    paintEmpty(null);
  }

  function renderEditor() {
    const main = U.$('#nmain');
    const it = state.openId ? Store.getItem(state.openId) : null;
    const drill = !it && state.drillId ? Store.getItem(state.drillId) : null;
    // is-drill：正在浏览笔记集/文件夹。此时右上角不该整片隐藏，
    // 否则「更多 → 删除」就跟着一起消失了，等于删不掉最外层。
    main.classList.toggle('is-drill', !!drill);
    paintEmpty(drill);
    if (!it) {
      main.classList.add('is-empty');
      U.$('#btnStar').classList.remove('is-on');
      U.$('#tabbar').hidden = true;
      return;
    }
    main.classList.remove('is-empty');

    const title = U.$('#noteTitle');
    title.value = it.title || '';
    const c = Store.content(it.id);
    U.$('#noteBody').innerHTML = c.html || '';
    U.$('#noteMeta').innerHTML =
      '<span>' + TYPE_NAME[it.type] + '</span><span>·</span>' +
      '<span>' + (c.wc || 0) + ' 字</span><span>·</span>' +
      '<span>更新于 ' + U.relTime(it.updatedAt) + '</span>';
    setStatus('', c.savedAt ? '已保存 · ' + U.relTime(c.savedAt) : '');
    U.$('#btnStar').classList.toggle('is-on', !!it.fav);
    U.$('#paperScroll').scrollTop = 0;
    renderOutline();
  }

  function debounceSave() {
    setStatus('saving', '正在保存…');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      doSave();
    }, 300);
  }

  function doSave() {
    const id = state.openId;
    if (!id) return;
    const body = U.$('#noteBody');
    const html = body.innerHTML;
    const plain = Store.stripHtml(html);
    const ok = Store.setContent(id, html, plain);
    if (!ok) {
      setStatus('error', '保存失败，请检查存储状态');
      UI.toast('保存失败，内容已保留在页面中', { warn: true });
      return;
    }
    state.savedAt = Date.now();
    state.edits++;
    setStatus('', '已保存 · 刚刚');
    // 告诉桌宠「我在写东西」，她会偶尔凑过来看一眼
    document.dispatchEvent(new CustomEvent('app:writing'));
    U.$('#noteMeta').innerHTML =
      '<span>' + TYPE_NAME[Store.getItem(id).type] + '</span><span>·</span>' +
      '<span>' + (plain.replace(/\s+/g, '').length) + ' 字</span><span>·</span>' +
      '<span>更新于 刚刚</span>';

    const needSnap = state.edits % 50 === 0 || (Date.now() - state.lastSnap > 5 * 60 * 1000);
    if (needSnap) {
      state.lastSnap = Date.now();
      Store.pushVersion(id, html, plain);
    }
    renderTabs();
  }

  function flushSave() {
    clearTimeout(saveTimer);
    if (state.openId) doSave();
  }

  /* ---------------- 打开 ---------------- */
  function openItem(id, opts) {
    const o = opts || {};
    const it = Store.getItem(id);
    if (!it) return;
    if (state.openId && state.openId !== id) flushSave();

    if (it.type === 'chapter' && it.parentId) state.drillId = it.parentId;
    if (it.type === 'folder' || it.type === 'notebook') {
      state.drillId = id;
      state.chapQuery = '';
      state.openId = null;
      renderTabs(); renderCrumbs(); renderEditor(); renderList();
      return;
    }

    state.openId = id;
    if (state.tabs.indexOf(id) < 0) {
      if (state.tabs.length >= 10) {
        state.tabs.shift();
        UI.toast('最多同时打开 10 个标签', { warn: true });
      }
      state.tabs.push(id);
    }
    renderTabs();
    renderCrumbs();
    renderEditor();
    renderList();
    if (o.focusTitle) {
      const t = U.$('#noteTitle');
      t.focus();
      t.select();
    }
  }
  Notes.openItem = openItem;

  Notes.render = function () {
    renderList();
    renderTabs();
    renderCrumbs();
    renderEditor();
  };

  /* ---------------- 新建 ---------------- */
  function newMenu(anchor) {
    const items = [
      { label: '新建独立笔记', icon: 'note', onClick: () => createItem('note') },
      { label: '新建笔记集', icon: 'book', onClick: () => createItem('notebook') },
      { label: '新建文件夹', icon: 'folder', onClick: () => createItem('folder') }
    ];
    if (state.drillId) {
      const nb = Store.getItem(state.drillId);
      if (nb) {
        items.unshift({
          label: nb.type === 'folder' ? '新建子项' : '新建章节', icon: 'doc',
          onClick: () => createItem('chapter', state.drillId)
        });
      }
    }
    UI.menu(anchor, { items: items });
  }

  function createItem(type, parentId) {
    let pid = parentId || null;
    if (!pid && state.drillId) {
      const nb = Store.getItem(state.drillId);
      if (nb && nb.type === 'notebook' && type !== 'folder' && type !== 'notebook') pid = nb.id;
    }
    const it = Store.addItem(type, pid, TYPE_DEF_TITLE[type]);
    if (type === 'folder' || type === 'notebook') {
      state.drillId = it.id;
      state.openId = null;
      renderList(); renderTabs(); renderCrumbs(); renderEditor();
      // 直接进入重命名
      const row = U.$('.drill-title');
      if (row) inlineRename(row, it.id);
    } else {
      openItem(it.id, { focusTitle: true });
    }
    UI.toast('已创建' + TYPE_NAME[type]);
  }

  function inlineRename(el, id) {
    el.setAttribute('contenteditable', 'true');
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const s = window.getSelection();
    s.removeAllRanges(); s.addRange(r);
    const done = () => {
      el.removeAttribute('contenteditable');
      const v = (el.textContent || '').trim() || TYPE_DEF_TITLE[Store.getItem(id).type];
      Store.updateItem(id, { title: v });
      renderList(); renderCrumbs(); renderTabs();
      if (state.openId === id) U.$('#noteTitle').value = v;
    };
    el.addEventListener('blur', done, { once: true });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); el.textContent = Store.getItem(id).title; el.blur(); }
    });
  }

  /* ---------------- 工具栏 ---------------- */
  const PALETTE = [
    { name: '主文字', value: '#3A3733' }, { name: '次要', value: '#8C8378' },
    { name: '淡粉', value: '#C08E86' }, { name: '暖红', value: '#A5645C' },
    { name: '浅紫', value: '#8E7AA6' }, { name: '墨绿', value: '#5F7A6A' },
    { name: '土黄', value: '#9A7B47' }, { name: '灰蓝', value: '#61758C' }
  ];
  const HILITES = [
    { name: '浅粉', value: '#F7E7E3' }, { name: '米黄', value: '#F7F0DE' },
    { name: '浅紫', value: '#EDE7F2' }, { name: '浅绿', value: '#E4EDE6' },
    { name: '浅蓝', value: '#E3EAF1' }
  ];

  function focusEditor() {
    const body = U.$('#noteBody');
    body.focus();
    return body;
  }

  function insertHtmlAtCaret(html) {
    const body = focusEditor();
    const sel = window.getSelection();
    if (!sel.rangeCount || !body.contains(sel.anchorNode)) {
      body.insertAdjacentHTML('beforeend', html);
      return;
    }
    document.execCommand('insertHTML', false, html);
  }

  function exec(cmd, val) {
    focusEditor();
    try { document.execCommand(cmd, false, val === undefined ? null : val); } catch (e) {}
    debounceSave();
    syncToolbar();
  }

  function syncToolbar() {
    const map = { bold: 'bold', italic: 'italic', underline: 'underline', strikeThrough: 'strikeThrough', insertUnorderedList: 'insertUnorderedList', insertOrderedList: 'insertOrderedList' };
    Object.keys(map).forEach((k) => {
      const btn = U.$('.tb-btn[data-cmd="' + k + '"]');
      if (!btn) return;
      let on = false;
      try { on = document.queryCommandState(map[k]); } catch (e) {}
      btn.classList.toggle('is-on', !!on);
    });
    let block = 'p';
    try { block = (document.queryCommandValue('formatBlock') || 'p').toLowerCase(); } catch (e) {}
    const label = { p: '正文', div: '正文', h1: 'H1', h2: 'H2', h3: 'H3', blockquote: '引用', pre: '代码' }[block] || '正文';
    U.$('#blockLabel').textContent = label;
  }

  function bindToolbar() {
    const tb = U.$('#editorToolbar');

    tb.addEventListener('mousedown', (e) => {
      // 防止工具栏点击丢失选区
      if (e.target.closest('.tb-btn')) e.preventDefault();
    });

    tb.addEventListener('click', (e) => {
      const btn = e.target.closest('.tb-btn');
      if (!btn) return;
      const cmd = btn.dataset.cmd;
      const menu = btn.dataset.menu;

      if (menu === 'block') {
        UI.menu(btn, {
          align: 'left',
          items: [
            { label: '正文', checked: true, onClick: () => exec('formatBlock', '<p>') },
            { label: '标题 1', onClick: () => exec('formatBlock', '<h1>') },
            { label: '标题 2', onClick: () => exec('formatBlock', '<h2>') },
            { label: '标题 3', onClick: () => exec('formatBlock', '<h3>') },
            { sep: true },
            { label: '引用', onClick: () => exec('formatBlock', '<blockquote>') },
            { label: '代码块', onClick: () => exec('formatBlock', '<pre>') }
          ]
        });
        return;
      }
      if (menu === 'color') {
        UI.colorMenu(btn, PALETTE, (v) => exec('foreColor', v));
        return;
      }
      if (menu === 'hilite') {
        UI.colorMenu(btn, HILITES, (v) => exec('hiliteColor', v));
        return;
      }
      if (menu === 'more') {
        UI.menu(btn, {
          align: 'right',
          items: [
            { label: '左对齐', onClick: () => exec('justifyLeft') },
            { label: '居中', onClick: () => exec('justifyCenter') },
            { label: '右对齐', onClick: () => exec('justifyRight') },
            { sep: true },
            { label: '清除格式', onClick: () => exec('removeFormat') },
            { label: '正文设为纯文本', onClick: () => exec('formatBlock', '<p>') }
          ]
        });
        return;
      }

      switch (cmd) {
        case 'bold': case 'italic': case 'underline': case 'strikeThrough':
        case 'insertUnorderedList': case 'insertOrderedList':
        case 'undo': case 'redo':
          exec(cmd);
          break;
        case 'quote': exec('formatBlock', '<blockquote>'); break;
        case 'hr': insertHtmlAtCaret('<hr><p><br></p>'); debounceSave(); break;
        case 'code': exec('formatBlock', '<pre>'); break;
        case 'checklist': {
          const html = '<div class="ck-item"><span class="ck-box" contenteditable="false"></span><span class="ck-txt">待办事项</span></div>';
          insertHtmlAtCaret(html);
          debounceSave();
          break;
        }
        case 'table': {
          let rows = 3, cols = 3;
          let html = '<table><tbody>';
          for (let r = 0; r < rows; r++) {
            html += '<tr>';
            for (let c = 0; c < cols; c++) {
              html += r === 0 ? '<th>列 ' + (c + 1) + '</th>' : '<td><br></td>';
            }
            html += '</tr>';
          }
          html += '</tbody></table><p><br></p>';
          insertHtmlAtCaret(html);
          debounceSave();
          break;
        }
        case 'image': {
          const input = U.$('#fileInput');
          input.value = '';
          input.onchange = async () => {
            const f = input.files && input.files[0];
            if (!f) return;
            if (f.size > 1.6 * 1024 * 1024) {
              UI.toast('图片超过 1.6MB，本地存储放不下', { warn: true });
              return;
            }
            const url = await U.readFile(f, 'dataURL');
            insertHtmlAtCaret('<img src="' + url + '" alt="' + U.esc(f.name) + '"><p><br></p>');
            debounceSave();
          };
          input.click();
          break;
        }
        case 'link': {
          const body = U.el('div', {});
          body.innerHTML = '<label class="field"><span class="field-label">链接地址</span>' +
            '<input class="field-input" data-f="url" placeholder="https://" value="https://"></label>' +
            '<label class="field"><span class="field-label">显示文字</span>' +
            '<input class="field-input" data-f="text" placeholder="留空则用地址"></label>';
          UI.modal({
            title: '插入链接',
            body: body,
            actions: [
              { label: '取消', kind: 'ghost' },
              {
                label: '插入', kind: 'soft', onClick: () => {
                  const url = body.querySelector('[data-f="url"]').value.trim();
                  const text = body.querySelector('[data-f="text"]').value.trim() || url;
                  if (!url) return false;
                  insertHtmlAtCaret('<a href="' + U.esc(url) + '" target="_blank" rel="noreferrer">' + U.esc(text) + '</a>&nbsp;');
                  debounceSave();
                }
              }
            ]
          });
          break;
        }
        default: break;
      }
    });

    document.addEventListener('selectionchange', U.throttle(() => {
      const body = U.$('#noteBody');
      if (!body) return;
      const sel = window.getSelection();
      if (sel.anchorNode && body.contains(sel.anchorNode)) syncToolbar();
    }, 200));
  }

  /* ---------------- 大纲 ---------------- */
  function renderOutline() {
    const box = U.$('#outlineBody');
    const body = U.$('#noteBody');
    if (!box || !body) return;
    const hs = Array.prototype.slice.call(body.querySelectorAll('h1,h2,h3'));
    if (!hs.length) {
      box.innerHTML = '<div class="outline-empty">用 H1–H3 写小标题就会出现在这里</div>';
      return;
    }
    box.innerHTML = hs.map((h, i) => {
      h.dataset.oid = 'h' + i;
      return '<button class="outline-item" data-oid="h' + i + '" data-lv="' + h.tagName.slice(1) + '">' +
        U.esc(h.textContent || '') + '</button>';
    }).join('');
  }

  function bindOutline() {
    U.$('#outline').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-oid]');
      if (!btn) return;
      const h = U.$('#noteBody [data-oid="' + btn.dataset.oid + '"]');
      if (h) h.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
    U.$('#btnOutline').addEventListener('click', () => {
      state.outlineOpen = !state.outlineOpen;
      U.$('#outline').classList.toggle('is-on', state.outlineOpen);
      U.$('#btnOutline').classList.toggle('is-on', state.outlineOpen);
      if (state.outlineOpen) renderOutline();
    });
  }

  /* ---------------- 历史版本 ---------------- */
  function versionsDialog() {
    const id = state.openId;
    if (!id) return;
    const list = Store.versions(id);
    const body = U.el('div', {});
    if (!list.length) {
      body.innerHTML = '<p class="field-hint">还没有历史版本。每 5 分钟或每 50 次编辑会自动记录一次。</p>';
      UI.modal({ title: '历史版本', body: body, actions: [{ label: '知道了', kind: 'soft' }] });
      return;
    }
    let html = '<div class="list-plain">';
    list.forEach((v, i) => {
      html += '<button class="list-row" data-vi="' + i + '">' +
        '<span class="list-row-ico">' + ICON('clock') + '</span>' +
        '<span>' + U.relTime(v.at) + '</span>' +
        '<span class="list-row-meta">' + (v.plain || '').replace(/\s+/g, '').length + ' 字</span>' +
        '</button>';
    });
    html += '</div><div class="ver-preview" data-preview>选择一条查看内容</div>';
    body.innerHTML = html;

    const preview = body.querySelector('[data-preview]');
    let picked = 0;
    body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-vi]');
      if (!row) return;
      picked = Number(row.dataset.vi);
      body.querySelectorAll('.list-row').forEach((r) => r.classList.remove('is-on'));
      row.classList.add('is-on');
      preview.innerHTML = list[picked].html || '<em>（空）</em>';
      preview.scrollTop = 0;
    });

    UI.modal({
      title: '历史版本',
      sub: '恢复前会把当前内容存为新版本，不会丢东西。',
      wide: true,
      body: body,
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '恢复到这一版', kind: 'soft', onClick: () => {
            const v = list[picked];
            if (!v) return false;
            const cur = Store.content(id);
            Store.pushVersion(id, cur.html, cur.plain);
            Store.setContent(id, v.html, v.plain);
            renderEditor();
            UI.toast('已恢复，当前内容已另存为一版');
          }
        }
      ]
    });
  }

  /* ---------------- 移动 ---------------- */
  function moveDialog(targetId) {
    const id = targetId || state.openId;
    if (!id) return;
    const it = Store.getItem(id);
    if (!it) return;
    const body = U.el('div', {});
    let target = null;

    function build() {
      const banned = new Set(Store.descendants(id).map((x) => x.id));
      banned.add(id);
      let html = '<div class="list-plain">';
      html += '<button class="list-row' + (target === null ? ' is-on' : '') + '" data-target="root">' +
        '<span class="list-row-ico">' + ICON('doc') + '</span><span>根目录</span></button>';
      const walk = (pid, depth) => {
        Store.children(pid).forEach((n) => {
          if (banned.has(n.id)) return;
          if (n.type !== 'folder' && n.type !== 'notebook') return;
          html += '<button class="list-row' + (target === n.id ? ' is-on' : '') + '" data-target="' + n.id + '"' +
            ' style="padding-left:' + (10 + depth * 16) + 'px">' +
            '<span class="list-row-ico">' + ICON(TYPE_ICON[n.type]) + '</span><span>' + U.esc(n.title) + '</span></button>';
          walk(n.id, depth + 1);
        });
      };
      walk(null, 1);
      html += '</div>';
      body.innerHTML = html;
    }
    build();

    body.addEventListener('click', (e) => {
      const row = e.target.closest('[data-target]');
      if (!row) return;
      target = row.dataset.target === 'root' ? null : row.dataset.target;
      build();
    });

    UI.modal({
      title: '移动到…',
      sub: '「' + U.esc(it.title) + '」',
      body: body,
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '移动', kind: 'soft', onClick: () => {
            const ok = Store.moveItem(id, target);
            if (!ok) { UI.toast('不能移动到自己的子级里', { warn: true }); return false; }
            // 只在自己被移走时才跟着换目录，别把用户当前浏览的位置一起改掉
            if (state.drillId === id) state.drillId = target;
            renderList(); renderCrumbs();
            UI.toast('已移动');
          }
        }
      ]
    });
  }

  /* ---------------- 条目菜单（列表行「…」与右键共用） ---------------- */
  function descendantsOf(id) {
    // Store.descendants 是递归的，这里只关心数量与 id 集合
    const kids = Store.descendants(id) || [];
    return kids;
  }

  function renameDialog(id) {
    const it = Store.getItem(id);
    if (!it) return;
    const input = U.el('input', {
      class: 'field-input',
      type: 'text',
      value: it.title || '',
      placeholder: TYPE_DEF_TITLE[it.type] || '标题',
      maxlength: '120'
    });
    const wrap = U.el('div', {}, [input]);
    const dlg = UI.modal({
      title: '重命名' + (TYPE_NAME[it.type] || ''),
      sub: '名字随时可以再改',
      body: wrap,
      actions: [
        { label: '取消', kind: 'ghost' },
        {
          label: '保存', kind: 'soft', onClick: () => {
            const v = input.value.trim() || TYPE_DEF_TITLE[it.type] || '未命名';
            Store.updateItem(id, { title: v });
            if (state.openId === id) U.$('#noteTitle').value = v;
            renderList(); renderCrumbs(); renderTabs();
            UI.toast('已重命名');
          }
        }
      ]
    });
    setTimeout(() => { input.focus(); input.select(); }, 60);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const v = input.value.trim() || TYPE_DEF_TITLE[it.type] || '未命名';
        Store.updateItem(id, { title: v });
        if (state.openId === id) U.$('#noteTitle').value = v;
        renderList(); renderCrumbs(); renderTabs();
        dlg.close();
        UI.toast('已重命名');
      }
    });
  }

  /* 删除任意条目：文件夹 / 笔记集 / 章节 / 单篇笔记都能走这里。
     注意「打开笔记集」时 openId 是 null、drillId 指向它，
     所以删除入口不能只看 openId —— 这正是之前删不掉外层笔记集的原因。 */
  function deleteItem(id) {
    const it = Store.getItem(id);
    if (!it) return;
    const kids = descendantsOf(id);
    const isBox = it.type === 'folder' || it.type === 'notebook';
    const sub = kids.length
      ? '「' + it.title + '」和里面的 ' + kids.length + ' 项都会一起进入回收站，之后可以从回收站整份恢复。'
      : '「' + it.title + '」会进入回收站，之后可以恢复。';
    UI.confirm({
      title: isBox ? '删除这个' + TYPE_NAME[it.type] + '？' : '移到回收站？',
      sub: sub,
      okText: '移入回收站',
      danger: true
    }).then((ok) => {
      if (!ok) return;
      // 正在编辑的内容先把待写入的计时器掐掉，否则删完还会回写一次
      clearTimeout(saveTimer);
      Store.trashItem(id);

      const killed = new Set([id].concat(kids.map((x) => x.id)));
      state.tabs = state.tabs.filter((t) => !killed.has(t));
      if (killed.has(state.openId)) state.openId = null;
      if (killed.has(state.drillId)) state.drillId = null;
      renderTabs(); renderCrumbs(); renderEditor(); renderList();
      UI.toast(kids.length ? '已移入回收站，共 ' + (kids.length + 1) + ' 项' : '已移入回收站');
    });
  }

  function itemMenu(id, at) {
    const it = Store.getItem(id);
    if (!it) return;
    const isBox = it.type === 'folder' || it.type === 'notebook';
    const kids = descendantsOf(id);
    const items = [];
    items.push({
      label: isBox ? '进入' : '打开',
      icon: isBox ? TYPE_ICON[it.type] : 'doc',
      onClick: () => openItem(id)
    });
    items.push({ label: '重命名', icon: 'pencil', onClick: () => renameDialog(id) });
    items.push({
      label: it.fav ? '取消收藏' : '加入收藏', icon: 'star',
      onClick: () => {
        Store.updateItem(id, { fav: !it.fav });
        renderList();
        UI.toast(it.fav ? '已取消收藏' : '已加入收藏');
      }
    });
    // 根级条目没有「移动」的意义，但保持入口一致更好
    items.push({ label: '移动到…', icon: 'log-out', onClick: () => moveDialog(id) });
    if (isBox && kids.length) {
      items.push({ labelOnly: TYPE_NAME[it.type] + ' · ' + kids.length + ' 项' });
    }
    items.push({ sep: true });
    items.push({ label: '删除', icon: 'trash', danger: true, onClick: () => deleteItem(id) });
    UI.menu(null, { at: at, align: 'right', items: items });
  }

  /* ---------------- 导出 ---------------- */
  function htmlToMd(html) {
    const d = document.createElement('div');
    d.innerHTML = html;
    const walk = (node) => {
      let out = '';
      node.childNodes.forEach((n) => {
        if (n.nodeType === 3) { out += n.textContent; return; }
        if (n.nodeType !== 1) return;
        const tag = n.tagName.toLowerCase();
        const inner = walk(n);
        switch (tag) {
          case 'h1': out += '\n# ' + inner.trim() + '\n\n'; break;
          case 'h2': out += '\n## ' + inner.trim() + '\n\n'; break;
          case 'h3': out += '\n### ' + inner.trim() + '\n\n'; break;
          case 'p': out += inner.trim() + '\n\n'; break;
          case 'br': out += '\n'; break;
          case 'strong': case 'b': out += '**' + inner + '**'; break;
          case 'em': case 'i': out += '*' + inner + '*'; break;
          case 'u': out += '<u>' + inner + '</u>'; break;
          case 's': case 'strike': out += '~~' + inner + '~~'; break;
          case 'a': out += '[' + inner + '](' + (n.getAttribute('href') || '') + ')'; break;
          case 'img': out += '\n![' + (n.getAttribute('alt') || '') + '](' + (n.getAttribute('src') || '').slice(0, 64) + '...)\n'; break;
          case 'blockquote': out += inner.split('\n').filter(Boolean).map((l) => '> ' + l).join('\n') + '\n\n'; break;
          case 'ul': out += inner + '\n'; break;
          case 'ol': out += inner + '\n'; break;
          case 'li': out += '- ' + inner.trim() + '\n'; break;
          case 'hr': out += '\n---\n\n'; break;
          case 'pre': out += '\n```\n' + n.textContent + '\n```\n\n'; break;
          case 'table': {
            const rows = Array.prototype.slice.call(n.querySelectorAll('tr'));
            rows.forEach((tr, ri) => {
              const cells = Array.prototype.slice.call(tr.children).map((c) => c.textContent.trim());
              out += '| ' + cells.join(' | ') + ' |\n';
              if (ri === 0) out += '|' + cells.map(() => ' --- |').join('') + '\n';
            });
            out += '\n';
            break;
          }
          case 'div':
            if (n.classList.contains('ck-item')) {
              out += '- [' + (n.classList.contains('is-done') ? 'x' : ' ') + '] ' + inner.trim() + '\n';
            } else out += inner + '\n';
            break;
          default: out += inner;
        }
      });
      return out;
    };
    return walk(d).replace(/\n{3,}/g, '\n\n').trim();
  }

  function exportAs(kind) {
    const id = state.openId;
    if (!id) return;
    flushSave();
    const it = Store.getItem(id);
    const c = Store.content(id);
    const name = (it.title || '未命名').replace(/[\\/:*?"<>|]/g, '_');

    if (kind === 'md') {
      U.download(name + '.md', '# ' + it.title + '\n\n' + htmlToMd(c.html), 'text/markdown;charset=utf-8');
      UI.toast('已导出 Markdown');
      return;
    }
    if (kind === 'html') {
      const doc = '<!DOCTYPE html><meta charset="utf-8"><title>' + U.esc(it.title) + '</title>' +
        '<style>body{max-width:700px;margin:60px auto;padding:0 24px;font-family:"Microsoft YaHei",sans-serif;line-height:1.7;color:#3A3733}h1{font-size:28px}h2{font-size:22px}h3{font-size:18px}img{max-width:100%}blockquote{border-left:3px solid #E5C6BF;margin:1.2em 0;padding-left:16px;color:#8C8378}pre{background:#F4EFE6;padding:14px;border-radius:10px;overflow:auto}table{border-collapse:collapse}td,th{border:1px solid #EDE6DC;padding:7px 10px}</style>' +
        '<h1>' + U.esc(it.title) + '</h1>' + c.html;
      U.download(name + '.html', doc, 'text/html;charset=utf-8');
      UI.toast('已导出 HTML');
      return;
    }
    if (kind === 'print') {
      const w = window.open('', '_blank');
      if (!w) { UI.toast('浏览器拦下了新窗口', { warn: true }); return; }
      w.document.write('<!DOCTYPE html><meta charset="utf-8"><title>' + U.esc(it.title) + '</title>' +
        '<style>@page{margin:22mm 18mm}body{font-family:"Microsoft YaHei",sans-serif;line-height:1.75;color:#333}h1{font-size:26px}h2{font-size:20px}h3{font-size:16px}img{max-width:100%}blockquote{border-left:3px solid #E5C6BF;margin:1.2em 0;padding-left:14px;color:#777}pre{background:#f5f2ec;padding:12px;border-radius:8px;white-space:pre-wrap}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 9px}</style>' +
        '<h1>' + U.esc(it.title) + '</h1>' + c.html);
      w.document.close();
      setTimeout(() => { w.focus(); w.print(); }, 300);
      return;
    }
  }

  /* ---------------- 导入 ---------------- */
  function importFiles(files, asAttachment) {
    Array.from(files).forEach((f) => {
      const lower = f.name.toLowerCase();
      if (f.size > 20 * 1024 * 1024) { UI.toast('文件超过 20MB：' + f.name, { warn: true }); return; }
      if (!/\.(md|markdown|txt)$/.test(lower)) {
        UI.toast('目前支持 .md / .txt 导入：' + f.name, { warn: true });
        return;
      }
      U.readFile(f).then((text) => {
        const title = f.name.replace(/\.(md|markdown|txt)$/i, '');
        if (asAttachment) {
          insertHtmlAtCaret('<p><strong>' + U.esc(f.name) + '</strong> · ' + Math.round(f.size / 1024) + 'KB</p>');
          debounceSave();
          return;
        }
        const it = Store.addItem('note', null, title);
        const html = /\.md$|\.markdown$/.test(lower) ? mdToHtml(text) : text.split(/\n{2,}/).map((p) => '<p>' + U.esc(p).replace(/\n/g, '<br>') + '</p>').join('');
        Store.setContent(it.id, html, Store.stripHtml(html));
        openItem(it.id);
        UI.toast('已导入 ' + f.name);
      });
    });
  }

  function mdToHtml(md) {
    const lines = md.split(/\r?\n/);
    let out = '';
    let inCode = false, inList = false;
    const inline = (s) => U.esc(s)
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/`(.+?)`/g, '<code>$1</code>');

    lines.forEach((raw) => {
      const line = raw;
      if (/^```/.test(line.trim())) {
        if (inCode) { out += '</pre>'; inCode = false; }
        else { out += '<pre>'; inCode = true; }
        return;
      }
      if (inCode) { out += U.esc(line) + '\n'; return; }
      if (/^\s*[-*+]\s+/.test(line)) {
        if (!inList) { out += '<ul>'; inList = true; }
        out += '<li>' + inline(line.replace(/^\s*[-*+]\s+/, '')) + '</li>';
        return;
      }
      if (inList) { out += '</ul>'; inList = false; }
      const h = line.match(/^(#{1,3})\s+(.*)$/);
      if (h) { out += '<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>'; return; }
      if (/^>\s?/.test(line)) { out += '<blockquote>' + inline(line.replace(/^>\s?/, '')) + '</blockquote>'; return; }
      if (!line.trim()) return;
      out += '<p>' + inline(line) + '</p>';
    });
    if (inList) out += '</ul>';
    if (inCode) out += '</pre>';
    return out;
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    // 只绑一次：这些节点是常驻的，重复绑定会让一次点击触发两遍
    if (bind.done) return;
    bind.done = true;
    const view = U.$('#view-notes');

    // 列表点击
    U.$('#nlistBody').addEventListener('click', (e) => {
      // 「…」按钮：行尾的更多操作。必须先拦下，否则会冒泡成「打开这一行」
      const more = e.target.closest('[data-more]');
      if (more) {
        e.preventDefault();
        const mr = more.getBoundingClientRect();
        itemMenu(more.dataset.more, { x: mr.right, y: mr.bottom + 2 });
        return;
      }

      const act = e.target.closest('[data-act]');
      if (act) {
        if (act.dataset.act === 'back') {
          state.drillId = null;
          state.chapQuery = '';
          renderList();
          return;
        }
        if (act.dataset.act === 'trash-entry') {
          if (global.App) App.go('trash', { trash: 'note' });
          return;
        }
        if (act.dataset.act === 'new-menu') {
          newMenu(act);
          return;
        }
        if (act.dataset.act === 'drill-more') {
          const dr = act.getBoundingClientRect();
          itemMenu(act.dataset.id, { x: dr.right, y: dr.bottom + 2 });
          return;
        }
      }
      const row = e.target.closest('.nrow[data-id]');
      if (!row) return;
      const id = row.dataset.id;
      const it = Store.getItem(id);
      if (!it) return;
      if (it.type === 'folder' || it.type === 'notebook') {
        state.drillId = id;
        state.chapQuery = '';
        state.openId = null;
        renderTabs(); renderCrumbs(); renderEditor(); renderList();
      } else {
        openItem(id);
        if (window.innerWidth <= DRAWER_W) view.classList.remove('is-drawer');
      }
    });

    // 右键任意一行 → 和「…」同一条菜单
    U.$('#nlistBody').addEventListener('contextmenu', (e) => {
      const row = e.target.closest('.nrow[data-id]');
      if (!row) return;
      e.preventDefault();
      itemMenu(row.dataset.id, { x: e.clientX, y: e.clientY });
    });

    // 拖拽导入
    const nb = U.$('#nlistBody');
    ['dragenter', 'dragover'].forEach((ev) => {
      nb.addEventListener(ev, (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          nb.style.background = 'var(--accent-soft)';
        }
      });
    });
    nb.addEventListener('dragleave', () => { nb.style.background = ''; });
    nb.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      nb.style.background = '';
      importFiles(e.dataTransfer.files, false);
    });

    const paper = U.$('#paperScroll');
    paper.addEventListener('dragover', (e) => {
      if (e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
    });
    paper.addEventListener('drop', (e) => {
      if (!e.dataTransfer || !e.dataTransfer.files.length) return;
      e.preventDefault();
      const f = e.dataTransfer.files[0];
      if (/^image\//.test(f.type)) {
        if (f.size > 1.6 * 1024 * 1024) { UI.toast('图片超过 1.6MB', { warn: true }); return; }
        U.readFile(f, 'dataURL').then((url) => {
          insertHtmlAtCaret('<img src="' + url + '" alt="' + U.esc(f.name) + '"><p><br></p>');
          debounceSave();
        });
      } else {
        importFiles(e.dataTransfer.files, true);
      }
    });

    // 标签页
    U.$('#tabbar').addEventListener('click', (e) => {
      const close = e.target.closest('[data-close]');
      if (close) {
        e.stopPropagation();
        const id = close.dataset.close;
        state.tabs = state.tabs.filter((x) => x !== id);
        if (state.openId === id) {
          flushSave();
          state.openId = state.tabs.length ? state.tabs[state.tabs.length - 1] : null;
          renderTabs(); renderCrumbs(); renderEditor(); renderList();
        } else renderTabs();
        return;
      }
      const tab = e.target.closest('[data-tab]');
      if (tab) openItem(tab.dataset.tab);
    });

    // 面包屑
    U.$('#crumbs').addEventListener('click', (e) => {
      const c = e.target.closest('[data-crumb]');
      if (!c) return;
      const it = Store.getItem(c.dataset.crumb);
      if (!it) return;
      if (it.type === 'folder' || it.type === 'notebook') {
        state.drillId = it.id;
        state.openId = null;
        state.chapQuery = '';
        renderList(); renderTabs(); renderCrumbs(); renderEditor();
      } else openItem(it.id);
    });

    // 搜索
    const search = U.$('#noteSearch');
    search.addEventListener('input', U.debounce(function () {
      state.query = this.value.trim();
      U.$('#noteSearchClear').hidden = !state.query;
      renderList();
    }, 180));
    U.$('#noteSearchClear').addEventListener('click', () => {
      search.value = '';
      state.query = '';
      U.$('#noteSearchClear').hidden = true;
      renderList();
    });

    // 新建
    U.$('#btnNewNote').addEventListener('click', (e) => newMenu(e.currentTarget));
    U.$('#btnMove').addEventListener('click', moveDialog);
    U.$('#btnEmptyNew').addEventListener('click', () => createItem('note'));
    U.$('#btnEmptyNotebook').addEventListener('click', () => createItem('notebook'));
    // 站在笔记集 / 文件夹里时的三个动作。判空是因为自测页的 DOM 是精简版
    const drillNew = U.$('#btnDrillNew');
    if (drillNew) {
      drillNew.addEventListener('click', () => {
        const box = state.drillId ? Store.getItem(state.drillId) : null;
        if (!box) return;
        createItem(box.type === 'folder' ? 'note' : 'chapter', box.id);
      });
    }
    const drillRename = U.$('#btnDrillRename');
    if (drillRename) drillRename.addEventListener('click', () => {
      if (state.drillId) renameDialog(state.drillId);
    });
    const drillDelete = U.$('#btnDrillDelete');
    if (drillDelete) drillDelete.addEventListener('click', () => {
      if (state.drillId) deleteItem(state.drillId);
    });

    // 标题
    const title = U.$('#noteTitle');
    title.addEventListener('input', () => {
      if (!state.openId) return;
      Store.updateItem(state.openId, { title: title.value });
      debounceSave();
      U.$('#tabbar').querySelectorAll('.tab').forEach((t) => {
        if (t.dataset.tab === state.openId) t.querySelector('.tab-name').textContent = title.value || '未命名';
      });
      renderCrumbs();
    });
    title.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); U.$('#noteBody').focus(); }
    });
    title.addEventListener('blur', () => {
      if (!state.openId) return;
      const v = title.value.trim() || '未命名笔记';
      if (v !== title.value) title.value = v;
      Store.updateItem(state.openId, { title: v });
      renderList();
    });

    // 正文
    const body = U.$('#noteBody');
    body.addEventListener('input', () => {
      debounceSave();
      clearTimeout(body._outlineTimer);
      body._outlineTimer = setTimeout(renderOutline, 600);
    });
    body.addEventListener('click', (e) => {
      const ck = e.target.closest('.ck-box');
      if (ck) {
        const item = ck.closest('.ck-item');
        if (item) {
          item.classList.toggle('is-done');
          debounceSave();
        }
      }
    });
    body.addEventListener('mousedown', (e) => {
      if (e.target.closest('.ck-box')) e.preventDefault();
    });
    body.addEventListener('paste', (e) => {
      const files = e.clipboardData && e.clipboardData.files;
      if (files && files.length) {
        const f = files[0];
        if (/^image\//.test(f.type)) {
          e.preventDefault();
          U.readFile(f, 'dataURL').then((url) => {
            insertHtmlAtCaret('<img src="' + url + '" alt="粘贴的图片"><p><br></p>');
            debounceSave();
          });
        }
      }
    });

    // 收藏
    U.$('#btnStar').addEventListener('click', () => {
      if (!state.openId) return;
      const it = Store.getItem(state.openId);
      const next = !it.fav;
      Store.updateItem(state.openId, { fav: next });
      U.$('#btnStar').classList.toggle('is-on', next);
      renderList();
      UI.toast(next ? '已加入收藏' : '已取消收藏');
    });

    // 更多
    U.$('#btnNoteMore').addEventListener('click', (e) => {
      if (!state.openId) {
        // 没打开内容但下钻在某个笔记集里：让「更多」作用于这个笔记集本身
        if (state.drillId) {
          const r = e.currentTarget.getBoundingClientRect();
          itemMenu(state.drillId, { x: r.right, y: r.bottom + 6 });
        }
        return;
      }
      const it = Store.getItem(state.openId);
      const items = [
        { label: it.fav ? '取消收藏' : '加入收藏', icon: 'star', onClick: () => U.$('#btnStar').click() },
        { label: '移动到…', icon: 'log-out', onClick: moveDialog },
        { label: '历史版本', icon: 'clock', onClick: versionsDialog },
        { sep: true },
        { label: '导出 Markdown', icon: 'doc', onClick: () => exportAs('md') },
        { label: '导出 HTML', icon: 'doc', onClick: () => exportAs('html') },
        { label: '导出 PDF（打印）', icon: 'doc', onClick: () => exportAs('print') }
      ];
      if (it.type === 'draft') {
        items.push({ sep: true });
        items.push({
          label: '草稿转为笔记集第一章', icon: 'book', onClick: () => {
            const nb = Store.addItem('notebook', null, it.title);
            Store.moveItem(it.id, nb.id);
            Store.updateItem(it.id, { type: 'chapter' });
            openItem(nb.id);
            UI.toast('已转为笔记集');
          }
        });
      }
      items.push({ sep: true });
      items.push({
        label: '删除', icon: 'trash', danger: true, onClick: () => {
          UI.confirm({
            title: '移到回收站？', sub: '「' + U.esc(it.title) + '」及其子项会进入回收站。',
            okText: '移入回收站', danger: true
          }).then((ok) => {
            if (!ok) return;
            Store.trashItem(it.id);
            state.tabs = state.tabs.filter((x) => x !== it.id);
            state.openId = null;
            renderTabs(); renderCrumbs(); renderEditor(); renderList();
            UI.toast('已移入回收站');
          });
        }
      });
      UI.menu(e.currentTarget, { align: 'right', items: items });
    });

    // 列表显隐：窄屏是抽屉浮层，宽屏是并排的左栏，两种都得能收起来
    U.$('#btnDrawer').addEventListener('click', () => setListVisible(!listVisible()));
    U.$('#btnListClose').addEventListener('click', () => setListVisible(false));
    U.$('#nlistMask').addEventListener('click', () => setListVisible(false));
    // 拉宽到并排布局时，别把抽屉状态留着；缩窄时同理清掉折叠态
    window.addEventListener('resize', () => {
      if (window.innerWidth > DRAWER_W) view.classList.remove('is-drawer');
      else view.classList.remove('is-collapsed');
      syncEmptyHint();
    });

    bindToolbar();
    bindOutline();
  }

  Notes.importFiles = importFiles;
  Notes.bind = bind;
  Notes.toggleList = () => setListVisible(!listVisible());
  Notes.syncEmptyHint = syncEmptyHint;

  global.Notes = Notes;
})(window);
