/* ============================================================
   自在极意 · 待办模块
   ============================================================ */
(function (global) {
  'use strict';

  const Todo = {};
  let flowMode = false;
  let createState = null;   // { status, el }
  let drag = null;          // { id, kind, card, box, x0, y0, pid, active, line }
  let suppressClick = 0;    // 拖完松手的那一下别再触发「点标题进编辑」

  const ICON = U.icon;

  function view() { return U.$('#view-todo'); }

  /* ---------------- 渲染 ---------------- */
  function dueText(t) {
    if (!t.dueAt) return '';
    const sameDayDue = U.dayKey(t.dueAt) === U.dayKey(Date.now());
    return (sameDayDue ? '今天 ' : U.fmtMD(t.dueAt) + ' ') + U.fmtHM(t.dueAt) + ' 前';
  }

  function cardHtml(t, kind) {
    const overdue = Store.isOverdue(t);
    const isDoing = kind === 'doing';
    const due = dueText(t);
    const near = t.dueAt && !overdue && (t.dueAt - Date.now() < 6 * 3600 * 1000);
    const badge = overdue
      ? '<span class="badge badge-overdue">已超时 · ' + U.fmtHM(t.dueAt) + '</span>'
      : (isDoing ? '<span class="badge">进行中</span>' : '');

    return '' +
      '<article class="task-card ' + (isDoing ? 'doing-card' : 'todo-card') + (overdue ? ' is-overdue' : '') + '"' +
      ' data-id="' + t.id + '" data-key="' + t.id + '" data-kind="' + kind + '">' +
      '<button class="pill-btn" data-act="' + (isDoing ? 'complete' : 'start') + '" title="' + (isDoing ? '任务完成' : '任务开始') + '">' +
      '<span class="pill-dot">' + ICON(isDoing ? 'check' : 'chev-r') + '</span>' +
      '<span class="pill-txt">' + (isDoing ? '任务完成' : '任务开始') + '</span>' +
      '</button>' +
      '<div class="task-main">' +
      '<div class="task-meta"><span>' + U.fmtMD(t.createdAt) + ' · 创建</span>' + badge + '</div>' +
      '<h3 class="task-title" data-field="title">' + U.esc(t.title || '未命名任务') + '</h3>' +
      (t.desc ? '<p class="task-desc" data-field="desc">' + U.esc(t.desc) + '</p>' : '') +
      (due ? '<div class="task-due' + (near ? ' is-near' : '') + '">' + ICON('clock') + '<span>' + due + '</span></div>' : '') +
      '</div>' +
      '<div class="task-tools">' +
      (isDoing ? '' : '<div class="arrow-group">' +
        '<button class="arrow-btn" data-act="up" title="上移" aria-label="上移">' + ICON('up') + '</button>' +
        '<button class="arrow-btn" data-act="down" title="下移" aria-label="下移">' + ICON('down') + '</button>' +
        '</div>') +
      '<span class="grip" data-grip="1" title="拖动排序">' + ICON('grip') + '</span>' +
      '<button class="tool-btn" data-act="edit" title="编辑">' + ICON('pencil') + '</button>' +
      '<button class="tool-btn is-danger" data-act="trash" title="移入回收站">' + ICON('trash') + '</button>' +
      '</div>' +
      '</article>';
  }

  function groupLabel(ts, count) {
    return '<div class="group-head"><span>' + U.fmtMD(ts) + ' · 创建</span>' +
      '<span class="group-count">' + count + ' 项</span></div>';
  }

  function renderDoing() {
    const grid = U.$('#doingGrid');
    const flowBox = U.$('#flowTasks');
    const list = Store.byStatus('doing');
    const html = list.map((t) => cardHtml(t, 'doing')).join('');
    grid.innerHTML = html;
    if (flowBox) flowBox.innerHTML = html;
    U.$('#doingCount').textContent = list.length + ' / 2';

    const addBtn = U.$('#btnAddDoing');
    const full = list.length >= 2;
    addBtn.disabled = full;
    addBtn.title = full ? '正在办理已满 2 项' : '新建正在办理';

    if (createState && createState.status === 'doing' && !full) {
      grid.appendChild(createState.el);
    }
    U.$('#doingEmpty').hidden = !(list.length === 0 && !(createState && createState.status === 'doing'));
  }

  function renderTodo() {
    const box = U.$('#todoList');
    const list = Store.byStatus('todo');
    let html = '';
    let prevDay = null;
    list.forEach((t) => {
      const key = U.dayKey(t.createdAt);
      if (key !== prevDay) {
        const count = list.filter((x) => U.dayKey(x.createdAt) === key).length;
        html += groupLabel(t.createdAt, count);
        prevDay = key;
      }
      html += cardHtml(t, 'todo');
    });
    box.innerHTML = html;
    U.$('#todoCount').textContent = list.length + ' 项';

    if (createState && createState.status === 'todo') {
      if (box.firstChild) box.insertBefore(createState.el, box.firstChild);
      else box.appendChild(createState.el);
    }
    U.$('#todoEmpty').hidden = !(list.length === 0 && !(createState && createState.status === 'todo'));
    updateArrows();
  }

  function updateArrows() {
    const cards = U.$$('#todoList .task-card');
    cards.forEach((c, i) => {
      const up = c.querySelector('[data-act="up"]');
      const down = c.querySelector('[data-act="down"]');
      if (up) up.disabled = i === 0;
      if (down) down.disabled = i === cards.length - 1;
    });
  }

  function renderMeta() {
    const s = Store.stats();
    const overdue = Store.activeTasks().filter((t) => Store.isOverdue(t)).length;
    U.$('#todoSub').textContent = overdue > 0
      ? '有 ' + overdue + ' 项已经超时了，先处理它们'
      : '一次只办一件事，最多两件在手';
    U.$('#footStat').textContent = '待办 ' + s.todo + ' · 已完成 ' + s.done + ' · 笔记 ' + s.notes;
  }

  Todo.render = function () {
    renderDoing();
    renderTodo();
    renderMeta();
  };

  Todo.refreshOverdue = function () {
    const cards = U.$$('.task-card');
    let changed = false;
    cards.forEach((el) => {
      const t = Store.tasks().find((x) => x.id === el.dataset.id);
      if (!t) return;
      const od = Store.isOverdue(t);
      if (od !== el.classList.contains('is-overdue')) changed = true;
    });
    if (changed) Todo.render();
    else renderMeta();
  };

  /* ---------------- 原位创建 ---------------- */
  function closeCreate(save) {
    if (!createState) return;
    const { el, status } = createState;
    const title = el.querySelector('.create-title').value.trim();
    const desc = el.querySelector('.create-desc').value.trim();
    const dateV = el.querySelector('[data-due-date]').value;
    const timeV = el.querySelector('[data-due-time]').value;
    createState = null;
    el.remove();
    if (save !== false && title) {
      if (status === 'doing' && Store.byStatus('doing').length >= 2) {
        UI.toast('正在办理已满 2 项', { warn: true });
        Todo.render();
        return;
      }
      const dueAt = U.toDueTs(dateV, timeV);
      Store.addTask({
        title: title, desc: desc, status: status, dueAt: dueAt
      });
      if (timeV && !dateV) UI.toast('没填完成日期，完成时间已忽略', { warn: true });
      else UI.toast(status === 'doing' ? '已加入正在办理' : '已加入待办');
    }
    Todo.render();
  }

  function openCreate(status) {
    if (status === 'doing' && Store.byStatus('doing').length >= 2) {
      UI.toast('已满 2 项，完成或移出一项后继续', { warn: true });
      return;
    }
    if (createState) closeCreate(true);
    const el = U.el('div', { class: 'create-card' });
    el.innerHTML =
      '<input class="create-title" placeholder="要做的事（回车创建）" maxlength="120">' +
      '<textarea class="create-desc" placeholder="补一句描述，可选" rows="1"></textarea>' +
      '<div class="create-row">' +
      '<label class="create-due-field">' + ICON('clock') +
      '<input type="date" data-due-date aria-label="完成日期">' +
      '<input type="time" data-due-time aria-label="完成时间">' +
      '</label>' +
      '<span class="create-hint">完成日期留空，则永不超时</span>' +
      '<div class="create-foot">' +
      '<button class="btn btn-ghost" data-act="cancel">取消</button>' +
      '<button class="btn btn-soft" data-act="save">创建</button>' +
      '</div></div>';

    createState = { status: status, el: el };

    const titleInput = el.querySelector('.create-title');
    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); closeCreate(true); }
      if (e.key === 'Escape') { e.preventDefault(); closeCreate(false); }
    });
    el.querySelector('.create-desc').addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); closeCreate(false); }
    });
    el.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]');
      if (!act) return;
      if (act.dataset.act === 'cancel') closeCreate(false);
      if (act.dataset.act === 'save') closeCreate(true);
    });

    if (status === 'doing') renderDoing(); else renderTodo();
    // 截止时间默认留空 —— 只有用户主动填了日期才会超时。
    // 空着的输入框淡一档，免得「年/月/日」看起来像已经填了东西。
    const dueDate = el.querySelector('[data-due-date]');
    const dueTime = el.querySelector('[data-due-time]');
    const syncEmpty = () => {
      dueDate.classList.toggle('is-empty', !dueDate.value);
      dueTime.classList.toggle('is-empty', !dueTime.value);
    };
    dueDate.addEventListener('input', syncEmpty);
    dueTime.addEventListener('input', syncEmpty);
    syncEmpty();
    setTimeout(() => titleInput.focus(), 30);
  }

  /* ---------------- 完整编辑 ---------------- */
  function editTask(id) {
    const t = Store.tasks().find((x) => x.id === id);
    if (!t) return;
    const body = U.el('div', {});
    body.innerHTML =
      '<label class="field"><span class="field-label">任务名称</span>' +
      '<input class="field-input" data-f="title" maxlength="120" value="' + U.esc(t.title) + '"></label>' +
      '<label class="field"><span class="field-label">描述</span>' +
      '<textarea class="field-area" data-f="desc" rows="3">' + U.esc(t.desc || '') + '</textarea></label>' +
      '<div class="field-row">' +
      '<label class="field"><span class="field-label">完成日期</span>' +
      '<input class="field-input" type="date" data-f="date" value="' + U.tsToDateInput(t.dueAt) + '"></label>' +
      '<label class="field"><span class="field-label">完成时间</span>' +
      '<input class="field-input" type="time" data-f="time" value="' + (t.dueAt ? U.tsToTimeInput(t.dueAt) : '') + '"></label>' +
      '</div>' +
      '<p class="field-hint">只填日期表示当天 23:59 到期；都留空则永不超时。' +
      (t.dueAt ? '<button type="button" class="hint-link" data-f="clear-due">清除截止时间</button>' : '') +
      '</p>';

    // 旧数据（或手误）留下的截止时间，一键清掉，不用跟日期控件的日历较劲
    const clearDue = body.querySelector('[data-f="clear-due"]');
    if (clearDue) {
      clearDue.addEventListener('click', () => {
        body.querySelector('[data-f="date"]').value = '';
        body.querySelector('[data-f="time"]').value = '';
        clearDue.remove();
        UI.toast('已清空，保存后不再超时');
      });
    }

    const api = UI.modal({
      title: '编辑任务',
      sub: '修改会自动保存',
      body: body,
      actions: [
        {
          label: '移入回收站', kind: 'danger', onClick: () => {
            setTimeout(() => {
              UI.confirm({ title: '移入回收站？', sub: '可以在回收站里恢复。', okText: '移入', danger: true })
                .then((ok) => { if (ok) { Store.trashTask(id); Todo.render(); UI.toast('已移入回收站'); } });
            }, 60);
          }
        },
        { label: '取消', kind: 'ghost' },
        {
          label: '保存', kind: 'soft', onClick: () => {
            const g = (k) => body.querySelector('[data-f="' + k + '"]').value;
            const title = g('title').trim() || '未命名任务';
            const dateV = g('date'), timeV = g('time');
            Store.updateTask(id, {
              title: title,
              desc: g('desc').trim(),
              dueAt: U.toDueTs(dateV, timeV)
            });
            Todo.render();
            if (timeV && !dateV) UI.toast('没填完成日期，完成时间已忽略', { warn: true });
            else UI.toast('已保存');
          }
        }
      ]
    });
    return api;
  }

  /* ---------------- 行内快速编辑 ---------------- */
  function inlineEdit(el, id, field) {
    if (el.isContentEditable) return;
    const t = Store.tasks().find((x) => x.id === id);
    if (!t) return;
    const original = field === 'title' ? t.title : (t.desc || '');
    el.setAttribute('contenteditable', 'true');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finish = (commit) => {
      el.removeAttribute('contenteditable');
      if (!commit) {
        el.textContent = original;
        return;
      }
      const val = (el.textContent || '').replace(/\s+/g, ' ').trim();
      const patch = {};
      if (field === 'title') {
        if (!val) { el.textContent = original; return; }
        patch.title = val;
      } else {
        patch.desc = val;
      }
      Store.updateTask(id, patch);
      UI.toast('已保存');
    };

    el.addEventListener('blur', () => finish(true), { once: true });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); el.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); el.textContent = original; finish(false); el.blur(); }
    });
  }

  /* ---------------- 排序 ---------------- */
  function moveByStep(id, dir) {
    const list = Store.byStatus('todo');
    const idx = list.findIndex((x) => x.id === id);
    const next = idx + dir;
    if (idx < 0 || next < 0 || next >= list.length) return;
    const ids = list.map((x) => x.id);
    const tmp = ids[idx];
    ids[idx] = ids[next];
    ids[next] = tmp;
    const container = U.$('#todoList');
    U.flip(container, () => {
      Store.reorder('todo', ids);
      renderTodo();
    }, 220);
  }

  /* ---------------- 拖拽 ----------------
     不用原生 HTML5 drag：Electron 里 draggable 在 pointerdown 时才打开，
     原生拖拽经常起不来（表现为「按着把手拖毫无反应」）。这里用指针事件自己算，
     顺带把可拖面积从 20×26 的把手扩展到整张卡片，并支持触屏。 */
  const DRAG_HOLD = 4;     // 位移小于这个值算点击，不算拖拽
  const EDGE = 64;         // 距离视口上下边缘多近开始自动滚动
  const EDGE_STEP = 12;

  function scrollerOf(box) {
    return box.closest('.view') || document.scrollingElement;
  }

  function beginDrag(card, e) {
    drag = {
      id: card.dataset.id,
      kind: card.dataset.kind,
      card: card,
      box: card.parentElement,
      x0: e.clientX, y0: e.clientY,
      pid: e.pointerId,
      active: false,
      index: 0,
      line: null
    };
    try { card.setPointerCapture(e.pointerId); } catch (err) {}
  }

  function autoScroll(y) {
    const sc = scrollerOf(drag.box);
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    if (y < r.top + EDGE) sc.scrollTop -= EDGE_STEP;
    else if (y > r.bottom - EDGE) sc.scrollTop += EDGE_STEP;
  }

  function placeLine(x, y) {
    const box = drag.box;
    const cards = Array.prototype.slice.call(box.querySelectorAll('.task-card:not(.is-dragging)'));
    let line = drag.line;
    if (!line) {
      // 浮层定位：插进 grid 里会真的把卡片挤走，落点就会算错
      line = U.el('div', { class: 'drop-line is-floating' });
      document.body.appendChild(line);
      drag.line = line;
    }
    // 双列网格里光比 y 会错位，用「离哪张卡最近」来定插入点
    let best = -1;
    let bestD = Infinity;
    let before = true;
    for (let i = 0; i < cards.length; i++) {
      const r = cards[i].getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const d = Math.abs(x - cx) * 0.55 + Math.abs(y - cy);
      if (d < bestD) {
        bestD = d;
        best = i;
        before = y < cy;
      }
    }
    if (best < 0) {
      line.style.display = 'none';
      drag.index = 0;
      return;
    }
    const r = cards[best].getBoundingClientRect();
    line.style.display = '';
    line.style.left = Math.round(r.left) + 'px';
    line.style.top = Math.round(before ? r.top - 7 : r.bottom + 7) + 'px';
    line.style.width = Math.round(r.width) + 'px';
    drag.index = best + (before ? 0 : 1);
  }

  function moveDrag(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (!drag.active) {
      if (Math.abs(e.clientX - drag.x0) < DRAG_HOLD && Math.abs(e.clientY - drag.y0) < DRAG_HOLD) return;
      drag.active = true;
      drag.card.classList.add('is-dragging');
      document.body.classList.add('task-dragging');
      const sel = window.getSelection && window.getSelection();
      if (sel && sel.removeAllRanges) sel.removeAllRanges();
    }
    if (e.cancelable) e.preventDefault();
    autoScroll(e.clientY);
    placeLine(e.clientX, e.clientY);
  }

  function finishDrag(commit) {
    if (!drag) return;
    const d = drag;
    drag = null;

    // 先在 DOM 还在的时候把新顺序算出来
    let next = null;
    if (commit && d.active) {
      const cards = Array.prototype.slice.call(d.box.querySelectorAll('.task-card:not(.is-dragging)'));
      const ids = cards.map((c) => c.dataset.id);
      const index = Math.max(0, Math.min(d.index || 0, ids.length));
      ids.splice(index, 0, d.id);
      next = { kind: d.kind, ids: ids };
    }

    d.card.classList.remove('is-dragging');
    document.body.classList.remove('task-dragging');
    d.card.removeEventListener('pointermove', moveDrag);
    d.card.removeEventListener('pointerup', upDrag);
    d.card.removeEventListener('pointercancel', cancelDrag);
    try { d.card.releasePointerCapture(d.pid); } catch (err) {}
    if (d.line) d.line.remove();

    if (!next) return;
    const now = Store.byStatus(next.kind).map((t) => t.id);
    if (now.join('|') === next.ids.join('|')) return;   // 位置没变，别白闪一下

    U.flip(d.box, () => {
      Store.reorder(next.kind, next.ids);
      if (next.kind === 'todo') renderTodo(); else renderDoing();
    }, 240);
  }

  function upDrag(e) {
    if (!drag || e.pointerId !== drag.pid) return;
    if (drag.active) suppressClick = Date.now();
    finishDrag(true);
  }

  function cancelDrag(e) {
    if (!drag || (e && e.pointerId !== drag.pid)) return;
    finishDrag(false);
  }

  /* ---------------- 事件 ---------------- */
  function bind() {
    const v = view();

    v.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      const card = e.target.closest('.task-card');
      if (!card) return;
      const id = card.dataset.id;
      const kind = card.dataset.kind;

      if (!btn) return;
      const act = btn.dataset.act;

      if (act === 'complete') {
        card.classList.add('is-completing');
        btn.classList.add('is-done');
        const box = card.parentElement;
        setTimeout(() => {
          U.flip(box, () => {
            Store.completeTask(id);
            Todo.render();
          }, 260);
          if (flowMode) {
            const left = Store.byStatus('doing').length;
            U.$('#flowDone').hidden = left > 0;
          }
          UI.toast('已完成，已放入回收站');
          if (window.Pet) Pet.celebrate();
        }, 420);
        return;
      }

      if (act === 'start') {
        if (Store.byStatus('doing').length >= 2) {
          UI.toast('正在办理已满 2 项，先完成一件', { warn: true });
          return;
        }
        U.flip(card.parentElement, () => {
          Store.moveTask(id, 'doing');
          Todo.render();
        }, 260);
        UI.toast('已开始，移到正在办理');
        return;
      }

      if (act === 'up') return moveByStep(id, -1);
      if (act === 'down') return moveByStep(id, 1);

      if (act === 'edit') return editTask(id);

      if (act === 'trash') {
        UI.confirm({
          title: '移入回收站？',
          sub: '「' + U.esc(Store.tasks().find((x) => x.id === id).title) + '」会进回收站，之后可以恢复。',
          okText: '移入', danger: true
        }).then((ok) => {
          if (!ok) return;
          U.flip(card.parentElement, () => {
            Store.trashTask(id);
            Todo.render();
          }, 260);
          UI.toast('已移入回收站');
        });
        return;
      }
    });

    // 行内编辑
    v.addEventListener('click', (e) => {
      if (Date.now() - suppressClick < 260) return;   // 刚拖完，别顺手打开编辑
      const field = e.target.closest('[data-field]');
      if (!field) return;
      const card = field.closest('.task-card');
      if (!card) return;
      inlineEdit(field, card.dataset.id, field.dataset.field);
    });

    // 拖拽：整张卡片都能抓，按钮除外（按钮要留给点击）
    v.addEventListener('pointerdown', (e) => {
      if (!e.isPrimary || e.button !== 0 || drag) return;
      const card = e.target.closest('.task-card');
      if (!card) return;
      if (e.target.closest('button, a, input, textarea, select')) return;
      beginDrag(card, e);
      card.addEventListener('pointermove', moveDrag);
      card.addEventListener('pointerup', upDrag);
      card.addEventListener('pointercancel', cancelDrag);
    });

    // 新建
    U.$('#btnAddDoing').addEventListener('click', () => openCreate('doing'));
    U.$('#btnAddTodo').addEventListener('click', () => openCreate('todo'));

    // 心流模式
    U.$('#btnFlow').addEventListener('click', () => Todo.enterFlow());
    U.$('#btnFlowExit').addEventListener('click', () => Todo.exitFlow());

    // Esc 退出心流：只在没有弹窗/菜单抢焦点时生效；拖拽中按 Esc 只取消拖拽
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (drag) { cancelDrag(); e.preventDefault(); return; }
      if (!flowMode) return;
      if (global.UI && UI.isBusy && UI.isBusy()) return;
      e.preventDefault();
      Todo.exitFlow();
    });
  }

  /* ---------------- 心流模式 ---------------- */
  /* 进出是一段过场：页面让位 → 幕布下沉 → 卡片依次就位；退出时反过来。 */
  Todo.enterFlow = function () {
    if (flowMode) return;
    flowMode = true;
    const v = view();
    v.dataset.enter = 'none';
    v.classList.remove('is-returning');

    // 先把卡片铺好，加 class 之后它们才有机会播放入场
    renderDoing();
    U.$('#flowDone').hidden = Store.byStatus('doing').length > 0;

    const btn = U.$('#btnFlowExit');
    btn.setAttribute('aria-hidden', 'false');
    btn.tabIndex = 0;
    U.$('#flowStage').setAttribute('aria-hidden', 'false');

    // 强制一次样式计算，确保过渡从初始态开始而不是被合并
    void v.offsetWidth;
    v.classList.add('is-flow');

    if (global.Pet && Pet.onFlowStart) Pet.onFlowStart();
    setTimeout(() => UI.toast('已进入心流模式，只留这件事'), 320);
  };

  Todo.exitFlow = function (silent) {
    if (!flowMode) return;
    flowMode = false;
    const v = view();

    const btn = U.$('#btnFlowExit');
    btn.setAttribute('aria-hidden', 'true');
    btn.tabIndex = -1;
    U.$('#flowStage').setAttribute('aria-hidden', 'true');
    U.$('#flowDone').hidden = true;

    // 幕布和按钮先退，页面 160ms 后才浮回来（时序写在 CSS 里）
    v.classList.remove('is-flow');
    if (global.Pet && Pet.onFlowEnd) Pet.onFlowEnd();

    // 等幕布散得差不多再重排列表，避免和过渡抢同一帧
    setTimeout(() => {
      Todo.render();
      requestAnimationFrame(() => {
        v.classList.add('is-returning');
        setTimeout(() => v.classList.remove('is-returning'), 620);
      });
    }, 130);

    if (!silent) UI.toast('心流已散，接着来吧');
  };

  Todo.isFlow = () => flowMode;

  Todo.focusTask = function (id) {
    const run = () => {
      const card = U.$('.task-card[data-id="' + id + '"]');
      if (!card) return;
      card.scrollIntoView({ block: 'center', behavior: 'smooth' });
      card.classList.add('is-flash');
      setTimeout(() => card.classList.remove('is-flash'), 1000);
    };
    // 心流里点超时提醒：先散幕，等页面真正可见了再定位
    if (flowMode) {
      Todo.exitFlow(true);
      setTimeout(run, 360);
      return;
    }
    run();
  };

  Todo.bind = bind;

  global.Todo = Todo;
})(window);
