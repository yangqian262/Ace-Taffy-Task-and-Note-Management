'use strict';
/* ------------------------------------------------------------
   别的程序全屏时，桌宠要自动让开。

   Windows 上没有现成的 Electron API，这里直接问系统：
   - GetForegroundWindow + GetWindowRect + GetMonitorInfo
     前台窗口是否正好铺满它所在的那块屏幕（比的是 rcMonitor，
     所以最大化的窗口不会误判 —— 最大化只到 rcWork）
   - SHQueryUserNotificationState 是系统自己在用的「该不该弹通知」
     状态，全屏独占 / 演示模式 / 锁屏时会变成非 QUNS_ACCEPTS，
     用它补刀那些窗口矩形不准的独占全屏。
   两者任一成立就算全屏。

   FFI 用 koffi：纯 N-API，预编译二进制，Electron 里不用编译直接能 require
   （better-sqlite3 那种 ABI 坑不会再踩一遍）。koffi 缺失或加载失败时
   整个功能静默降级，不影响主程序。
   ------------------------------------------------------------ */

let api = null;
let loadError = null;
let warned = false;

function load() {
  if (api || loadError) return api;
  try {
    const koffi = require('koffi');
    const RECT = koffi.struct('ZZQY_RECT', {
      left: 'int32', top: 'int32', right: 'int32', bottom: 'int32'
    });
    const MONITORINFO = koffi.struct('ZZQY_MONITORINFO', {
      cbSize: 'uint32',
      rcMonitor: RECT,
      rcWork: RECT,
      dwFlags: 'uint32'
    });
    const user32 = koffi.load('user32.dll');
    const shell32 = koffi.load('shell32.dll');
    api = {
      RECT: RECT,
      MONITORINFO: MONITORINFO,
      GetForegroundWindow: user32.func('void *GetForegroundWindow()'),
      GetWindowRect: user32.func('bool GetWindowRect(void *h, _Out_ ZZQY_RECT *r)'),
      MonitorFromWindow: user32.func('void *MonitorFromWindow(void *h, uint32 flags)'),
      GetMonitorInfoW: user32.func('bool GetMonitorInfoW(void *m, _Inout_ ZZQY_MONITORINFO *mi)'),
      GetShellWindow: user32.func('void *GetShellWindow()'),
      SHQueryUserNotificationState: shell32.func('int SHQueryUserNotificationState(_Out_ int *st)')
    };
  } catch (e) {
    loadError = e;
  }
  return api;
}

const QUNS = {
  NOT_PRESENT: 1,          // 锁屏 / 屏保
  BUSY: 2,                 // 有全屏程序在跑，或演示设置开着
  D3D_FULLSCREEN: 3,       // 独占全屏（游戏 / 部分播放器）
  PRESENTATION_MODE: 4,    // 演示模式
  ACCEPTS: 5,              // 正常状态
  QUIET_TIME: 6,           // 专注助手
  APP: 7
};

// 前台窗口的「全屏」判定。允许 2px 误差，某些播放器会差一两个像素。
function judge(a) {
  const hwnd = a.GetForegroundWindow();
  const res = { full: false, covers: false, quns: 0, why: '' };
  if (!hwnd) { res.why = 'no-fg'; return res; }

  // 桌面上点一下也会让 Progman 成为前台窗口，它铺满整屏 —— 得排掉
  if (hwnd === a.GetShellWindow()) { res.why = 'desktop'; return res; }

  const st = [0];
  try {
    if (a.SHQueryUserNotificationState(st) === 0) {
      res.quns = st[0];
    }
  } catch (_) {}

  const r = {};
  let covers = false;
  if (a.GetWindowRect(hwnd, r)) {
    const mon = a.MonitorFromWindow(hwnd, 2 /* NEAREST */);
    const mi = { cbSize: 40 };
    if (a.GetMonitorInfoW(mon, mi) && mi.rcMonitor) {
      const m = mi.rcMonitor;
      const pad = 2;
      covers = Math.abs(r.left - m.left) <= pad &&
        Math.abs(r.top - m.top) <= pad &&
        r.right >= m.right - pad &&
        r.bottom >= m.bottom - pad;
    }
  }
  res.covers = covers;

  // 独占全屏 / 演示模式：窗口矩形不一定准，直接认系统状态。
  // 特意不认 QUNS.NOT_PRESENT（锁屏 / 屏保 / 用户离开）：
  // 那时本来也看不见她， hide()/show() 一趟反而会在唤醒之后留下
  // 窗口状态不一致，表现为「放一会儿回来她就点不动了」。
  if (res.quns === QUNS.D3D_FULLSCREEN || res.quns === QUNS.PRESENTATION_MODE ||
      res.quns === QUNS.BUSY) {
    res.full = true;
    res.why = 'quns-' + res.quns;
  } else if (covers) {
    res.full = true;
    res.why = 'covers';
  }
  return res;
}

/* 返回 { stop, probe, state } —— probe 给自测用，返回判定细节 */
function start(opts) {
  const o = opts || {};
  const a = load();
  if (!a) {
    if (!warned) {
      warned = true;
      if (o.onError) o.onError(loadError || new Error('koffi unavailable'));
    }
    return null;
  }

  let last = null;
  let stopped = false;
  let fails = 0;

  const tick = () => {
    if (stopped) return;
    // 关掉这个功能时连探测都省了
    if (o.enabled && !o.enabled()) {
      if (last !== false) { last = false; if (o.onChange) o.onChange(false, { full: false, why: 'disabled' }); }
      return;
    }
    let res = null;
    try {
      res = judge(a);
      fails = 0;
    } catch (e) {
      fails++;
      if (fails === 3) { // 连着三次都不行就别再折腾了
        if (o.onError) o.onError(e);
        stop();
      }
      return;
    }
    if (res.full !== last) {
      last = res.full;
      if (o.onChange) o.onChange(res.full, res);
    }
  };

  const timer = setInterval(tick, o.interval || 1000);
  if (timer.unref) timer.unref();
  tick();

  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  }

  return {
    stop: stop,
    probe: () => { try { return judge(a); } catch (e) { return { full: false, why: 'err:' + e.message }; } },
    get state() { return last; }
  };
}

module.exports = {
  available: () => !!load(),
  start: start,
  judge: judge,          // 判定逻辑单独可测：传一个假的 api 对象进去
  QUNS: QUNS
};
