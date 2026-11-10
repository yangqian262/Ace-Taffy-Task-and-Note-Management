/* ============================================================
   临时诊断：桌宠「放置一会儿后完全点不动」
   在系统层面测三件事，每 20 秒一次：
     1. 窗口的扩展样式里有没有 WS_EX_TRANSPARENT（鼠标穿透的底层实现）
     2. WindowFromPoint 认为光标下是哪个窗口 —— 这一条直接决定点击能不能落到她身上
     3. 真发一次真实鼠标点击，页面有没有收到 pointerdown
   结果逐行写 _diag-idle.jsonl。跑完自己退出。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { ipcMain } = require('electron');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '_diag-idle.jsonl');

const WS_EX_TRANSPARENT = 0x00000020;
const WS_EX_LAYERED = 0x00080000;
const GWL_EXSTYLE = -20;
const MOUSEEVENTF_LEFTDOWN = 0x0002;
const MOUSEEVENTF_LEFTUP = 0x0004;
const MOUSEEVENTF_RIGHTDOWN = 0x0008;
const MOUSEEVENTF_RIGHTUP = 0x0010;

function loadApi() {
  const koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const POINT = koffi.struct('POINT', { x: 'long', y: 'long' });
  return {
    koffi,
    POINT,
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hWnd, int nIndex)'),
    WindowFromPoint: user32.func('void *__stdcall WindowFromPoint(POINT pt)'),
    GetAncestor: user32.func('void *__stdcall GetAncestor(void *hwnd, uint gaFlags)'),
    GetCursorPos: user32.func('bool __stdcall GetCursorPos(_Out_ POINT *pt)'),
    SetCursorPos: user32.func('bool __stdcall SetCursorPos(int x, int y)'),
    mouse_event: user32.func('void __stdcall mouse_event(uint dwFlags, int dx, int dy, uint dwData, uintptr_t dwExtraInfo)')
  };
}

module.exports = function startDiag(opts) {
  const { petWin, log } = opts;
  const minutes = opts.minutes || 4;
  let api;
  try { api = loadApi(); } catch (e) { log('诊断不可用：' + e.message); return; }

  const hwnd = petWin.getNativeWindowHandle().readBigUInt64LE(0);
  log('诊断开始 hwnd=' + hwnd);

  try { fs.writeFileSync(OUT, ''); } catch (_) {}

  try { fs.writeFileSync(OUT, ''); } catch (_) {}

  // 页面里装一个计数器（每次采样都装一遍，页面重载后也还在）
  const installProbe = () => petWin.webContents.executeJavaScript(
    'if(!window.__diagInit){window.__diagInit=1;window.__diagDowns=0;' +
    'window.addEventListener("pointerdown",function(){window.__diagDowns++},true);} "ok"'
  );

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  async function sample(i) {
    const rec = { i, t: new Date().toISOString() };
    try { await installProbe(); } catch (_) {}

    // 页面还活着吗
    let alive = false, rect = null, geoMs = -1;
    try {
      const t0 = Date.now();
      rect = await Promise.race([
        petWin.webContents.executeJavaScript(
          '(function(){var e=document.getElementById("pet");if(!e)return null;var r=e.getBoundingClientRect();' +
          'return {x:r.left,y:r.top,w:r.width,h:r.height,cls:e.className,vis:getComputedStyle(e).opacity};})()'
        ),
        wait(2500).then(() => '__timeout__')
      ]);
      geoMs = Date.now() - t0;
      alive = rect !== '__timeout__' && rect !== null;
      if (rect === '__timeout__') rect = null;
    } catch (e) {
      rec.jsErr = String(e && e.message || e);
    }
    rec.alive = alive;
    rec.jsMs = geoMs;
    rec.rect = rect;
    rec.visible = petWin.isVisible();
    rec.pen = opts.getPen();
    rec.hold = opts.getHold();

    // 系统层面的真相
    try {
      const ex = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      rec.exStyle = ex;
      rec.wsTransparent = !!(ex & WS_EX_TRANSPARENT);
      rec.wsLayered = !!(ex & WS_EX_LAYERED);
    } catch (e) { rec.exErr = String(e.message || e); }

    if (rect && rect.w > 1) {
      const b = petWin.getBounds();
      // 窗口内是 CSS 像素（等于 DIP），而 SetCursorPos / WindowFromPoint 要物理像素
      const dip = { x: b.x + rect.x + rect.w / 2, y: b.y + rect.y + rect.h / 2 };
      const phy = require('electron').screen.dipToScreenPoint(dip);
      const cx = Math.round(phy.x);
      const cy = Math.round(phy.y);
      rec.probe = { cx, cy, dip, scale: require('electron').screen.getDisplayMatching(b).scaleFactor };
      try {
        const hit = api.WindowFromPoint({ x: cx, y: cy });
        const root = hit ? api.GetAncestor(hit, 2) : null;
        const asNum = (v) => {
          if (!v) return 0;
          try { return Number(api.koffi.address(v)); } catch (_) { return 0; }
        };
        rec.hwndUnderCursor = asNum(root || hit);
        rec.cursorOnPetWin = rec.hwndUnderCursor === Number(hwnd);
      } catch (e) { rec.wfpErr = String(e.message || e); }

      // 真点一下
      if (i > 0) {
        const saved = {};
        try { api.GetCursorPos(saved); } catch (_) {}
        let downBefore = 0;
        try { downBefore = await petWin.webContents.executeJavaScript('window.__diagDowns||0'); } catch (_) {}
        api.SetCursorPos(cx, cy);
        await wait(350);
        rec.penBeforeClick = opts.getPen();   // 指针落上去之后，窗口应该已经不穿透
        // 此刻系统层面的真相：样式、光标下是哪个窗口
        try {
          const exAt = Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
          const hitAt = api.WindowFromPoint({ x: cx, y: cy });
          const rootAt = hitAt ? api.GetAncestor(hitAt, 2) : null;
          const asNum = (v) => { if (!v) return 0; try { return Number(api.koffi.address(v)); } catch (_) { return 0; } };
          rec.atClick = {
            wsTransparent: !!(exAt & WS_EX_TRANSPARENT),
            ex: exAt,
            hwndUnderCursor: asNum(rootAt || hitAt),
            isPetWin: asNum(rootAt || hitAt) === Number(hwnd),
            petHwnd: Number(hwnd)
          };
        } catch (e) { rec.atClickErr = String(e.message || e); }
        api.mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, 0);
        await wait(30);
        api.mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, 0);
        await wait(600);
        let downAfter = 0;
        try { downAfter = await petWin.webContents.executeJavaScript('window.__diagDowns||0'); } catch (_) {}
        rec.downBefore = downBefore;
        rec.downAfter = downAfter;
        rec.clickArrived = downAfter > downBefore;
        // 光标还压在她身上的时候读页面内部状态，这一步是关键
        rec.penAfterClick = opts.getPen();
        try {
          rec.page = await Promise.race([
            petWin.webContents.executeJavaScript('window.PetHost && window.PetHost.debug ? window.PetHost.debug() : "no-debug"'),
            wait(2000).then(() => '__timeout__')
          ]);
        } catch (e) { rec.pageErr = String(e.message || e); }

        // 右键：菜单到底弹不弹得出来（用户报的第二个现象）
        try {
          api.mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, 0);
          await wait(30);
          api.mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, 0);
          await wait(400);
          rec.menu = await Promise.race([
            petWin.webContents.executeJavaScript(
              '(function(){var l=document.getElementById("menuLayer");return {cls:l&&l.className,n:l?l.querySelectorAll(".menu-item").length:-1};})()'
            ),
            wait(2000).then(() => '__timeout__')
          ]);
          await petWin.webContents.executeJavaScript('window.UI && UI.closeMenu && UI.closeMenu()');
        } catch (e) { rec.menuErr = String(e.message || e); }

        // 把光标放回去，别打扰用户
        try { api.SetCursorPos(saved.x || 0, saved.y || 0); } catch (_) {}
      }
    }

    // 第 3 轮做一次「藏起来再放出来」：全屏自动躲开走的就是这条路
    if (i === 2 && !opts.noCycle) {
      try {
        if (opts.setSuppress && !opts.rawCycle) {
          // 应用现在的真实路径：全屏收起不再 hide() OS 窗口
          opts.setSuppress(true);
          await wait(900);
          opts.setSuppress(false);
          await wait(900);
        } else {
          // 旧路径（已知会让 Chromium 停止投递鼠标事件），用来证明探针有效
          petWin.hide();
          await wait(900);
          if (opts.restore) opts.restore();
          else petWin.showInactive();
          await wait(900);
        }
        rec.cycled = opts.rawCycle ? 'raw-hide-show' : 'visual-suppress';
        rec.afterCycle = {
          visible: petWin.isVisible(),
          pen: opts.getPen(),
          ex: Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)),
          wsTransparent: !!(Number(api.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) & WS_EX_TRANSPARENT)
        };
      } catch (e) { rec.cycleErr = String(e.message || e); }
    }

    try { fs.appendFileSync(OUT, JSON.stringify(rec) + '\n'); } catch (_) {}
    log('诊断 #' + i + ' ' + JSON.stringify({ alive: rec.alive, pen: rec.pen, wsT: rec.wsTransparent, onPet: rec.cursorOnPetWin, click: rec.clickArrived, cls: rect && rect.cls }));
    return rec;
  }

  (async () => {
    await wait(12000);
    const total = Math.round((minutes * 60 * 1000) / 20000);
    for (let i = 0; i < total; i++) {
      await sample(i);
      await wait(20000);
    }
    log('诊断结束');
    try { fs.appendFileSync(OUT, JSON.stringify({ ev: 'done' }) + '\n'); } catch (_) {}
    setTimeout(() => { try { opts.done && opts.done(); } catch (_) {} }, 300);
  })();
};
