/* ============================================================
   自在极意 · Electron 主进程

   两个窗口：
     mainWin  普通窗口，承载待办 / 笔记 / 设置
     petWin   覆盖整块屏幕的透明置顶窗口，只渲染桌宠

   为什么桌宠窗口要铺满屏幕而不是「一个小窗口跟着走」：
     移动一个 OS 窗口每帧都要走 DWM 合成，拖动时明显掉帧；
     铺满屏幕后用 CSS transform 在窗口内移动，是纯 GPU 合成。
     代价是窗口会挡住鼠标 —— 用 setIgnoreMouseEvents(forward)
     让事件穿透，只在指针压到桌宠身上时才临时关掉穿透。
   ============================================================ */
'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
const {
  app, BrowserWindow, ipcMain, screen, Tray, Menu, shell,
  nativeImage, dialog, session, powerMonitor
} = require('electron');

const { Storage } = require('./storage');
const Fullscreen = require('./fullscreen');

const ROOT = path.join(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const HIDDEN_START = process.argv.indexOf('--hidden') >= 0;
const SMOKE = process.argv.indexOf('--smoke') >= 0;
const DIAG = process.argv.indexOf('--diag-idle') >= 0;
const SHOTS = process.argv.indexOf('--shots') >= 0;   // 生成 README 展示图

// 自测会把「新建笔记 / 打几个字」写进数据。必须换成一次性目录，
// 否则每跑一次冒烟，用户的真实数据里就多几篇测试笔记。
if (SMOKE || DIAG || SHOTS) {
  const tag = DIAG ? 'diag' : SHOTS ? 'shots' : 'smoke';
  const tmp = path.join(ROOT, '_' + tag + '-data');
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  // 上一轮进程可能还没退干净，目录删不掉。这时**绝不能复用**：
  // 残留的 location.json 会让这一轮跑到别处去，测试数据也会一轮轮累积
  // （笔记集被前一轮删光后，后面每轮都找不到目标，整页还会跟着报错）。
  const dir = fs.existsSync(tmp)
    ? path.join(ROOT, '_' + tag + '-data-' + Date.now())
    : tmp;
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
}

let mainWin = null;
let petWin = null;
let tray = null;
let storage = null;
let quitting = false;
let stateRev = 0;
let bootHidden = false;
let pendingPatches = [];
let petPenetrate = true;
let petGeo = null;               // 页面上报的可点矩形，主进程据此自己判定
let petGeoAt = 0;                // 最后一次收到几何的时间（兼作心跳）
let petHoldActive = false;       // 按住 / 菜单期间的快通道
let petHoldAt = 0;
let penWatch = null;
let penForceAt = 0;
let lastPetReload = 0;
let fakeCursor = null;       // 冒烟测试用它代替真实光标

/* ------------------------------------------------------------
   数据目录

   说的是「用户创建的东西」——待办、笔记、设置、备份、日志——
   不是程序本身。默认放哪：
     · 绿色版：exe 旁边的 data/，整个文件夹可以拷着走
     · 老版本升级上来的：沿用 userData 根目录，数据不会「消失」
     · 以上都不可写时：userData/data/
   用户可以把它换到任意盘，指针记在 location.json（几百字节，
   留在系统盘无妨）；Chromium 的缓存本来就在系统盘，不跟过来。
   ------------------------------------------------------------ */
function locationFile() {
  return path.join(app.getPath('userData'), 'location.json');
}

function isWritable(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.w-' + process.pid + '-' + Date.now());
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (_) {
    return false;
  }
}

function readLocation() {
  try {
    const o = JSON.parse(fs.readFileSync(locationFile(), 'utf8'));
    return o && typeof o.dataDir === 'string' && o.dataDir ? o.dataDir : null;
  } catch (_) {
    return null;
  }
}

function writeLocation(dir) {
  try {
    fs.writeFileSync(locationFile(), JSON.stringify({ dataDir: dir, at: Date.now() }, null, 2));
    return true;
  } catch (e) {
    log('写 location.json 失败：' + e.message);
    return false;
  }
}

function resolveDataDir() {
  const custom = readLocation();
  if (custom && isWritable(custom)) return custom;
  if (custom) log('自定义数据目录不可用，回退默认：' + custom);

  const legacy = app.getPath('userData');
  // 老版本把 data.json 直接放在 userData 根上，升级后必须沿用
  if (fs.existsSync(path.join(legacy, 'data.json'))) return legacy;

  if (app.isPackaged) {
    const port = path.join(path.dirname(app.getPath('exe')), 'data');
    if (isWritable(port)) return port;
  }
  return path.join(legacy, 'data');
}

function copyTree(src, dst) {
  let names = [];
  try { names = fs.readdirSync(src); } catch (_) { return; }
  fs.mkdirSync(dst, { recursive: true });
  for (const n of names) {
    const s = path.join(src, n);
    const d = path.join(dst, n);
    let st;
    try { st = fs.statSync(s); } catch (_) { continue; }
    if (st.isDirectory()) copyTree(s, d);
    else { try { fs.copyFileSync(s, d); } catch (_) {} }
  }
}

const DATA_FILES = ['data.json', 'data.json.bak', 'data.db', 'data.db-wal', 'data.db-shm'];

/** 把一个目录里的数据整体搬到另一个目录，并把指针改过去 */
async function migrateDataDir(target, opts) {
  const adopt = !!(opts && opts.adopt);
  const from = storage ? storage.dir : null;
  if (!from) return { ok: false, error: '数据层还没准备好' };

  const a = path.resolve(from);
  const b = path.resolve(target);
  if (a === b) return { ok: false, error: '这就是当前的数据目录' };
  if (b.indexOf(a + path.sep) === 0) return { ok: false, error: '不能选当前目录里面的子文件夹' };
  if (a.indexOf(b + path.sep) === 0) return { ok: false, error: '不能选当前目录的上一级文件夹' };
  if (!isWritable(b)) return { ok: false, error: '这个位置不可写，换个文件夹试试' };

  const dstJson = path.join(b, 'data.json');
  const hasData = fs.existsSync(dstJson) && fs.statSync(dstJson).size > 2;
  if (hasData && !adopt) {
    return { ok: false, needConfirm: true, dir: b, error: '这个文件夹里已经有一份数据' };
  }

  let moved = 0;
  if (!hasData) {
    // 先把内存里的状态落盘，再复制，保证搬走的是最新一份
    try { const cur = storage.load(); if (cur) storage.save(cur); } catch (_) {}
    try {
      fs.mkdirSync(b, { recursive: true });
      for (const f of DATA_FILES) {
        const s = path.join(a, f);
        if (!fs.existsSync(s)) continue;
        fs.copyFileSync(s, path.join(b, f));
        moved++;
      }
      copyTree(path.join(a, 'backup'), path.join(b, 'backup'));
      copyTree(path.join(a, 'logs'), path.join(b, 'logs'));
    } catch (e) {
      return { ok: false, error: '复制数据失败：' + e.message };
    }
    // 复制完再核对一遍大小，别让用户以为搬成功了其实是个空文件
    const srcSize = fs.existsSync(path.join(a, 'data.json')) ? fs.statSync(path.join(a, 'data.json')).size : 0;
    const dstSize = fs.existsSync(dstJson) ? fs.statSync(dstJson).size : -1;
    if (srcSize > 0 && srcSize !== dstSize) {
      return { ok: false, error: '复制校验没通过，数据仍在原处' };
    }
  }

  if (!writeLocation(b)) return { ok: false, error: '无法记住新位置（写指针失败）' };

  try { storage.close(); } catch (_) {}
  storage = null;
  initStorage();
  log('数据目录已切换', a, '→', b, '后端', storage.backend, '复制文件数', moved);
  return { ok: true, dir: b, from: a, backend: storage.backend, adopted: hasData };
}

async function chooseDataDir(win) {
  const cur = storage ? storage.dir : resolveDataDir();
  const r = await dialog.showOpenDialog(win, {
    title: '选择数据存放位置',
    defaultPath: path.dirname(cur),
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: '用这个文件夹',
    message: '待办、笔记和备份会存到这里；程序本身不会移动。'
  });
  if (r.canceled || !r.filePaths || !r.filePaths[0]) return { ok: false, canceled: true };
  return migrateDataDir(r.filePaths[0]);
}

/* ------------------------------------------------------------
   日志：写到 userData/logs/main.log，出问题时不用开开发者工具
   ------------------------------------------------------------ */
let logPath = null;
function log() {
  const line = '[' + new Date().toISOString() + '] ' +
    Array.prototype.map.call(arguments, (a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  try {
    if (!logPath) return;
    fs.appendFileSync(logPath, line + '\n');
  } catch (_) {}
  if (process.argv.indexOf('--dev') >= 0) process.stdout.write(line + '\n');
}

/* ------------------------------------------------------------
   数据
   ------------------------------------------------------------ */
function initStorage() {
  // 冒烟测试一律用一次性目录，绝不碰用户真实数据，也不碰打包目录；
  // 但测试里主动换过位置时要尊重指针，否则测不了迁移。
  // 指针只认落在程序目录里的（也就是临时目录）——万一残留指向用户的真实目录，
  // 宁可忽略：自测在上面删笔记是不可接受的。
  let dir;
  if (SMOKE || DIAG || SHOTS) {
    const loc = readLocation();
    // 只认落在「程序目录」或「系统临时目录」里的指针——前者是自测的一次性目录，
    // 后者是测「换数据目录」时自己造的目标。这个白名单之外的（比如用户的真实
    // 数据目录）一律忽略：自测在上面删笔记是不可接受的。
    const roots = [path.resolve(ROOT) + path.sep, path.resolve(os.tmpdir()) + path.sep];
    const inSandbox = loc && roots.some((r) => path.resolve(loc).indexOf(r) === 0);
    dir = inSandbox ? loc : app.getPath('userData');
  } else {
    dir = resolveDataDir();
  }
  fs.mkdirSync(path.join(dir, 'logs'), { recursive: true });
  logPath = path.join(dir, 'logs', 'main.log');
  storage = new Storage(dir, log);
  log('数据目录', dir, '后端', storage.backend);
  const bk = storage.dailyBackup();
  if (bk) log('已生成今日备份', bk);
}

function getState() {
  if (!storage) return null;
  return storage.load();
}

/** 桌宠窗口只改少数字段，走浅层 patch，避免覆盖主窗口刚写的内容 */
function mergeInto(st, patch) {
  if (!patch || typeof patch !== 'object') return st;
  Object.keys(patch).forEach((k) => {
    const v = patch[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && st[k] && typeof st[k] === 'object' && !Array.isArray(st[k])) {
      Object.assign(st[k], v);
    } else {
      st[k] = v;
    }
  });
  return st;
}

function applyPatch(patch) {
  const st = getState();
  // 主窗口还没建库（首次启动并发）时先挂起，否则会写出一个只有 settings 的空壳，
  // 主窗口随后读到这个空壳就再也不会生成演示数据了。
  if (!st || !Array.isArray(st.tasks)) {
    pendingPatches.push(patch);
    log('数据尚未初始化，patch 已挂起');
    return null;
  }
  mergeInto(st, patch);
  storage.save(st);
  // 设置可能刚被改过，立刻反映到全屏开关上，别等 5 秒兜底
  if (st.settings) fsFlag = { at: Date.now(), on: st.settings.hideOnFullscreen !== false };
  stateRev += 1;
  broadcastState(null);
  return st;
}

function broadcastState(fromWebContents) {
  const st = getState();
  const payload = { rev: stateRev, state: st };
  [mainWin, petWin].forEach((w) => {
    if (!w || w.isDestroyed()) return;
    if (fromWebContents && w.webContents.id === fromWebContents.id) return;
    try { w.webContents.send('store:changed', payload); } catch (_) {}
  });
}

/* ------------------------------------------------------------
   主窗口
   ------------------------------------------------------------ */
/* ------------------------------------------------------------
   主窗口尺寸

   以前每次打开都是 1280×820，用户调好的大小下次就没了。
   现在：默认给一个更紧凑的尺寸（约 1070×900，一屏装下
   正在办理 + 待办列表，不用滚动），之后记住用户自己拖的
   尺寸和位置，下次原样回来。
   ------------------------------------------------------------ */
function winStateFile() {
  return path.join(app.getPath('userData'), 'window.json');
}

const WIN_DEFAULT = { width: 860, height: 750 };
const WIN_MIN = { width: 760, height: 600 };

function loadWinState() {
  try {
    const o = JSON.parse(fs.readFileSync(winStateFile(), 'utf8'));
    return o && typeof o === 'object' ? o : null;
  } catch (_) {
    return null;
  }
}

function saveWinState(win) {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.isMaximized() ? (win._restoreBounds || win.getNormalBounds()) : win.getBounds();
    fs.writeFileSync(winStateFile(), JSON.stringify({
      x: b.x, y: b.y, width: b.width, height: b.height,
      maximized: win.isMaximized()
    }));
  } catch (_) {}
}

/** 上次的尺寸可能来自另一台显示器，先夹回当前可用区，别让窗口跑到看不见的地方 */
function fitToScreen(o, wa) {
  const maxW = Math.round(wa.width * 0.98);
  const maxH = Math.round(wa.height * 0.98);
  const width = Math.max(WIN_MIN.width, Math.min(o.width || WIN_DEFAULT.width, maxW));
  const height = Math.max(WIN_MIN.height, Math.min(o.height || WIN_DEFAULT.height, maxH));
  const onScreen = typeof o.x === 'number' && typeof o.y === 'number' &&
    o.x > -width * 0.5 && o.x < wa.x + wa.width - 80 &&
    o.y > -20 && o.y < wa.y + wa.height - 80;
  return {
    width: width,
    height: height,
    x: onScreen ? o.x : undefined,
    y: onScreen ? o.y : undefined,
    maximized: !!o.maximized
  };
}

function createMainWin() {
  // 默认给一屏能看全的尺寸；125% 缩放的 1080p 屏可用区只有 1229×690 左右，
  // 所以仍按可用区收一收，不能顶出屏幕。
  const wa = screen.getPrimaryDisplay().workArea;
  const saved = loadWinState();
  const base = saved || {
    width: Math.min(WIN_DEFAULT.width, Math.round(wa.width * 0.94)),
    height: Math.min(WIN_DEFAULT.height, Math.round(wa.height * 0.94))
  };
  const geo = fitToScreen(base, wa);

  const win = new BrowserWindow({
    width: geo.width,
    height: geo.height,
    x: geo.x,
    y: geo.y,
    minWidth: Math.min(WIN_MIN.width, geo.width),
    minHeight: Math.min(WIN_MIN.height, geo.height),
    center: geo.x === undefined,
    show: false,
    backgroundColor: '#faf6f1',
    title: '自在极意',
    icon: iconPath('app.ico') || iconPath('app_256.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  });

  if (geo.maximized) win.maximize();

  win.loadFile(path.join(ROOT, 'index.html'));

  // 记住用户拖出来的尺寸和位置，下次打开原样回来
  let winSaveTimer = null;
  const touchWin = () => {
    clearTimeout(winSaveTimer);
    winSaveTimer = setTimeout(() => saveWinState(win), 500);
  };
  win.on('resize', touchWin);
  win.on('move', touchWin);
  win.on('maximize', touchWin);
  win.on('unmaximize', touchWin);

  win.once('ready-to-show', () => {
    if (HIDDEN_START) { bootHidden = true; return; }
    win.show();
  });

  // 关闭 → 进托盘（设置项 minimizeTray 默认开）
  win.on('close', (e) => {
    saveWinState(win);
    if (quitting) return;
    const st = getState();
    const toTray = !st || !st.settings || st.settings.minimizeTray !== false;
    if (toTray) {
      e.preventDefault();
      win.hide();
      if (process.platform === 'win32') {
        // 首次隐藏给个提示，否则用户以为程序退出了
        if (!win._trayHinted) {
          win._trayHinted = true;
          notifyTray();
        }
      }
      return;
    }
    quitting = true;
    app.quit();
  });

  win.on('enter-full-screen', () => setPetSuppressed(true));
  win.on('leave-full-screen', () => setPetSuppressed(false));

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

let trayHintTimer = null;
function notifyTray() {
  try {
    if (tray && process.platform === 'win32') {
      tray.displayBalloon({
        title: '自在极意还在运行',
        content: '窗口已收进托盘，点托盘图标可以再打开。',
        iconType: 'info'
      });
    }
  } catch (_) {}
}

/* ------------------------------------------------------------
   桌宠窗口
   ------------------------------------------------------------ */
let petSuppressed = false;   // 自己进了全屏 / 用户主动收起
let fsSuppress = false;      // 别的程序全屏
let petVisuallyHidden = false; // 页面侧是否已经套上「看不见」的样式
let fsWatcher = null;
let smokeRep = null;         // 冒烟期间挂上报告对象，用来记全屏事件

function petBounds() {
  const d = screen.getPrimaryDisplay();
  // 用 workArea：窗口底边正好压在任务栏上沿，她默认站位就不会陷进任务栏
  return d.workArea;
}

function createPetWin() {
  const b = petBounds();
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,          // 点她不抢主窗口焦点，正在写的字不会失焦
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload-pet.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(ROOT, 'pet.html'));

  win.once('ready-to-show', () => { win.showInactive(); });

  // 页面重载后抑制状态会丢，加载完成就补发一次
  win.webContents.on('did-finish-load', () => {
    const hidden = petSuppressed || fsSuppress || !isPetEnabled();
    petVisuallyHidden = hidden;
    try { win.webContents.send('pet:suppress', hidden); } catch (_) {}
  });

  // 分辨率 / 缩放变化后重铺，否则她会卡在旧屏幕上
  win._rebindDisplay = () => {
    if (win.isDestroyed()) return;
    const nb = petBounds();
    win.setBounds(nb);
  };

  return win;
}

function setPetSuppressed(on) {
  petSuppressed = !!on;
  syncPetWindow();
}

function isPetEnabled() {
  const st = getState();
  if (!st || !st.settings) return true;
  const s = st.settings;
  if (s.petVisible === false) return false;
  if (s.petHiddenUntil && s.petHiddenUntil > Date.now()) return false;
  return true;
}

/**
 * 桌宠的「显示 / 收起」——注意：这里**绝不 hide() 那个 OS 窗口**。
 *
 * 实测（koffi 调 WindowFromPoint + 真实 mouse_event）：
 * 透明的 focusable:false 置顶窗口只要 hide() 再 showInactive() 一次，
 * 之后系统层命中测试仍然指向它、WS_EX_TRANSPARENT 也正常，
 * 但 Chromium 不再把 pointerdown / contextmenu 投递给渲染进程 ——
 * 她看得见，却完全点不动，右键菜单也弹不出来。重新置顶、重刷穿透、
 * 甚至重载页面都救不回来。用户说的「放一会儿就完全不能操作」就是它：
 * 屏保 / 全屏视频让她被 hide/show 了一趟。
 *
 * 所以收起 = 页面加一层 visibility:hidden + 窗口全穿透；窗口本身一直显示。
 */
function syncPetWindow() {
  if (!petWin || petWin.isDestroyed()) return;
  const hidden = petSuppressed || fsSuppress || !isPetEnabled();

  if (!petWin.isVisible()) {
    petWin.showInactive();
    petWin.setAlwaysOnTop(true, 'screen-saver');
    penForceAt = 0;
  }
  if (hidden !== petVisuallyHidden) {
    petVisuallyHidden = hidden;
    try { petWin.webContents.send('pet:suppress', hidden); } catch (_) {}
  }
  if (hidden) applyPenetrate(true);
  penTick();
}

/** 冒烟测试用：她此刻是不是「看得见」（窗口本身一直显示） */
function petShown() { return !petVisuallyHidden; }

/* ------------------------------------------------------------
   鼠标穿透的方向盘 —— 单向、可自愈

   桌宠窗口铺满整屏，平时必须让点击落到下面的应用里，只有指针压到她身上
   才临时关掉穿透。这是整只桌宠最容易坏的一环：

     旧版是「主进程推光标 → 页面判定 → 回一个开关 → 主进程执行」的闭环，
     外加一条「6 秒没回话就强制穿透」的超时保护。任何一处状态错位
     （页面本地去重、抬手事件丢失、窗口 hide/show、锁屏唤醒、页面卡死），
     窗口就会静默停在穿透态：她看得见，却点不到，连右键菜单都弹不出来。
     两轮补丁都在修这个闭环里的某一环，于是总有下一环。

     现在改成单向：页面只上报「可点矩形 + 是否按住 + 心跳」，
     主进程自己读系统光标、自己算、自己设置窗口状态。
     · 没有回环，也就不存在两侧状态错位；
     · 每 800ms 无条件重刷一次系统状态，窗口 hide/show、锁屏唤醒、
       DPI 变化之后变量与真实样式脱节，最多 0.8 秒自愈；
     · 页面不上报几何 = 页面出问题 → 重载页面，而不是偷偷把窗口改成穿透。
   ------------------------------------------------------------ */
function applyPenetrate(on) {
  on = !!on;
  petPenetrate = on;
  if (!petWin || petWin.isDestroyed()) return;
  if (on) petWin.setIgnoreMouseEvents(true, { forward: true });
  else petWin.setIgnoreMouseEvents(false);
}

function desiredPenetrate(cur) {
  if (!petWin || petWin.isDestroyed() || !petWin.isVisible()) return true;

  // 按住 / 菜单：整块窗口都要能接鼠标（菜单蒙层要接「点外面关闭」）
  if (petHoldActive && Date.now() - petHoldAt < 30000) return false;
  if (petGeo && petGeo.held) return false;

  // 页面失联期间不能让整屏被挡住，但也不能悄悄把她「弄丢」——
  // penTick 会重载页面把她救回来
  if (!petGeo || Date.now() - petGeoAt > 1200) return true;

  const rects = petGeo.rects || [];
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i];
    if (cur.x >= r[0] && cur.x <= r[2] && cur.y >= r[1] && cur.y <= r[3]) return false;
  }
  return true;
}

function reloadPetWindow(reason, force) {
  const now = Date.now();
  if (!force && now - lastPetReload < 20000) return;
  lastPetReload = now;
  log('桌宠页面重新载入：' + reason);
  petGeo = null;
  petGeoAt = 0;
  applyPenetrate(true);
  try { petWin.webContents.reload(); } catch (e) { log('重载失败 ' + e.message); }
}

/** 一次判定。定时器调它，页面每次上报几何也立刻调它（把首击延迟压到最小） */
function penTick() {
  if (!petWin || petWin.isDestroyed()) return;
  const now = Date.now();

  if (petWin.isVisible()) {
    if (petGeoAt && now - petGeoAt > 4000) {
      reloadPetWindow('超过 4 秒没有上报命中区域');
    } else if (!petGeoAt && lastPetReload && now - lastPetReload > 8000) {
      // 上次重载后页面一直没起来，再试一次，别让她变成一张点不动的贴纸
      reloadPetWindow('重载后页面仍未就绪', true);
    }
  }

  const p = fakeCursor || screen.getCursorScreenPoint();
  const b = petWin.getBounds();
  const cur = { x: Math.round(p.x - b.x), y: Math.round(p.y - b.y) };
  const want = desiredPenetrate(cur);

  // 无条件周期重刷：变量和 Windows 真实窗口样式有可能脱节，
  // 重复调用 setIgnoreMouseEvents 是幂等的，代价可以忽略
  const force = now - penForceAt >= 800;
  if (force) penForceAt = now;
  if (want !== petPenetrate || force) applyPenetrate(want);
}

function startPetPenetrateWatch() {
  if (penWatch) return;
  penWatch = setInterval(penTick, 50);
  log('鼠标穿透跟随已启用（主进程单向判定）');
}

/** 系统状态变化后把窗口重新「摆正」：尺寸 / 置顶 / 穿透 / 显示 */
function resetPetWindow() {
  if (!petWin || petWin.isDestroyed()) return;
  try {
    petWin.setBounds(petBounds());
    petWin.setAlwaysOnTop(true, 'screen-saver');
    penForceAt = 0;                 // 下一轮立刻强制重刷穿透
    if (!petSuppressed && !fsSuppress && isPetEnabled() && !petWin.isVisible()) {
      petWin.showInactive();
    }
  } catch (e) { log('桌宠窗口重置失败 ' + e.message); }
}

/* ------------------------------------------------------------
   别的程序全屏时藏起来（看视频 / 打游戏 / 演示）
   只改「显示状态」，不动设置：全屏结束时按设置原样回来。
   ------------------------------------------------------------ */
let fsFlag = { at: 0, on: true };

// 设置里的开关。900ms 一次的轮询不该每次都去读盘，保存时顺手刷新 + 5 秒兜底
function hideOnFullscreenEnabled() {
  const now = Date.now();
  if (now - fsFlag.at < 5000) return fsFlag.on;
  const st = getState();
  fsFlag = { at: now, on: !st || !st.settings || st.settings.hideOnFullscreen !== false };
  return fsFlag.on;
}

function startFullscreenWatch() {
  if (process.platform !== 'win32') return;
  fsWatcher = Fullscreen.start({
    interval: 900,
    enabled: hideOnFullscreenEnabled,
    onChange: (on, res) => {
      if (fsSuppress === on) return;
      fsSuppress = on;
      log('外部全屏 ' + (on ? '开始，收起桌宠' : '结束，恢复桌宠') +
        (res && res.why ? '（' + res.why + '）' : ''));
      syncPetWindow();
      // 冒烟测试要用到这个状态
      if (smokeRep) {
        smokeRep.fsLog = (smokeRep.fsLog || []).concat([{ on: on, why: res && res.why }]);
      }
    },
    onError: (e) => log('全屏检测不可用：', e && e.message)
  });
  if (fsWatcher) log('全屏检测已启用');
}

/* ------------------------------------------------------------
   托盘
   ------------------------------------------------------------ */
function iconPath(name) {
  const p = path.join(ASSETS, 'icon', name);
  return fs.existsSync(p) ? p : null;
}

function createTray() {
  const p = iconPath('tray.png') || iconPath('app_256.png');
  if (!p) { log('缺少托盘图标，跳过托盘'); return; }
  let img = nativeImage.createFromPath(p);
  if (process.platform === 'win32') img = img.resize({ width: 16, height: 16 });
  tray = new Tray(img);
  tray.setToolTip('自在极意');
  rebuildTrayMenu();
  tray.on('click', () => showMain());
  tray.on('double-click', () => showMain());
}

function rebuildTrayMenu() {
  if (!tray) return;
  const st = getState();
  const petOn = isPetEnabled();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '打开自在极意', click: () => showMain() },
    { type: 'separator' },
    {
      label: petOn ? '隐藏桌宠' : '显示桌宠',
      click: () => {
        const on = !petOn;
        applyPatch({ settings: { petVisible: on, petHiddenUntil: 0 } });
        syncPetWindow();
        rebuildTrayMenu();
      }
    },
    {
      label: '把桌宠叫到中间',
      enabled: petOn,
      click: () => petInvoke('comeHere', [])
    },
    {
      // 万一还出现「看得见却点不动」，给用户一个立刻自救的入口
      label: '桌宠点不动？重置一下',
      enabled: petOn,
      click: () => {
        resetPetWindow();
        reloadPetWindow('用户从托盘手动重置', true);
        rebuildTrayMenu();
      }
    },
    { type: 'separator' },
    { label: '打开数据目录', click: () => shell.openPath(storage ? storage.dir : app.getPath('userData')) },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() }
  ]));
}

function showMain() {
  if (!mainWin || mainWin.isDestroyed()) {
    mainWin = createMainWin();
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  if (!mainWin.isVisible()) mainWin.show();
  mainWin.focus();
}

/* ------------------------------------------------------------
   桌宠指令转发
   ------------------------------------------------------------ */
function petInvoke(fn, args) {
  if (!petWin || petWin.isDestroyed()) return false;
  if (!petWin.isVisible()) { syncPetWindow(); }
  try { petWin.webContents.send('pet:invoke', { fn: fn, args: args || [] }); } catch (_) { return false; }
  return true;
}

/* ------------------------------------------------------------
   IPC
   ------------------------------------------------------------ */
function bindIpc() {
  // 启动时同步取一次整棵树：store.js 是同步语义，改成异步要动所有调用点
  ipcMain.on('store:load', (e) => {
    e.returnValue = { rev: stateRev, state: getState() };
  });

  ipcMain.on('store:save', (e, json) => {
    if (!storage) { e.returnValue = false; return; }
    let ok = storage.save(json);
    // 设置可能刚被改过（比如刚关掉「全屏时自动躲开」），别等轮询的 5 秒兜底
    if (ok) {
      try {
        const s2 = typeof json === 'string' ? JSON.parse(json) : json;
        if (s2 && s2.settings) {
          fsFlag = { at: Date.now(), on: s2.settings.hideOnFullscreen !== false };
        }
      } catch (_) {}
    }

    // 主窗口刚写好第一份完整数据：把之前挂起的 patch 补上
    if (ok && pendingPatches.length) {
      try {
        const st = JSON.parse(JSON.stringify(json));
        pendingPatches.forEach((p) => mergeInto(st, p));
        pendingPatches = [];
        ok = storage.save(st);
      } catch (err) {
        log('补写挂起的 patch 失败', err.message);
      }
    }

    stateRev += 1;
    broadcastState(e.sender);
    rebuildTrayMenu();
    syncPetWindow();
    e.returnValue = ok;
  });

  ipcMain.on('store:patch', (e, patch) => {
    applyPatch(patch);
    rebuildTrayMenu();
    syncPetWindow();
    e.returnValue = true;
  });

  ipcMain.on('store:info', (e) => { e.returnValue = storage ? storage.info() : null; });

  // 页面上报可点矩形（兼作心跳）。主进程自己算穿透，不再回消息给页面
  ipcMain.on('pet:geo', (e, g) => {
    if (!g || !Array.isArray(g.rects)) return;
    petGeo = g;
    petGeoAt = Date.now();
    // 立刻重算一次：指针刚移到她身上时，不等下一轮定时器就能接住这一次点击
    penTick();
  });

  // 按下 / 抬手的快通道：不等 120ms 的几何轮询，立刻独占 / 释放鼠标
  ipcMain.on('pet:hold', (e, on) => {
    petHoldActive = !!on;
    petHoldAt = Date.now();
    if (petHoldActive) applyPenetrate(false);
    else penForceAt = 0;
  });

  // 主窗口 → 桌宠窗口
  ipcMain.handle('pet:invoke', (e, fn, args) => petInvoke(fn, args));

  // 主窗口要开关桌宠 / 改尺寸
  ipcMain.handle('pet:sync', () => { syncPetWindow(); return isPetEnabled(); });

  // 开机自启
  ipcMain.handle('sys:autoStart', (e, on) => setAutoStart(on));
  ipcMain.handle('sys:autoStart:get', () => getAutoStart());

  // 打开数据目录 / 换位置 / 导出
  const curDataDir = () => (storage ? storage.dir : app.getPath('userData'));
  ipcMain.handle('sys:openDataDir', () => shell.openPath(curDataDir()));
  ipcMain.handle('sys:dataDir', () => (storage ? storage.info() : { dir: curDataDir(), backend: 'none' }));
  ipcMain.handle('sys:chooseDataDir', () => chooseDataDir(mainWin));
  ipcMain.handle('sys:migrateDataDir', (e, target, opts) => migrateDataDir(target, opts));

  ipcMain.handle('sys:export', async () => {
    const r = await dialog.showOpenDialog(mainWin, {
      title: '选择导出位置',
      properties: ['openDirectory', 'createDirectory']
    });
    if (r.canceled || !r.filePaths.length) return null;
    try {
      const dst = storage.exportTo(r.filePaths[0]);
      return { ok: true, path: dst };
    } catch (err) {
      return { ok: false, error: String(err.message || err) };
    }
  });

  // 桌宠窗口双击 / 点举牌 → 把主窗口叫出来并切到对应页面
  ipcMain.on('nav:request', (e, view) => {
    showMain();
    if (mainWin && !mainWin.isDestroyed()) {
      try { mainWin.webContents.send('nav', String(view || 'todo')); } catch (_) {}
    }
  });

  // 心流：主窗口进入专注时，桌宠窗口要跟着压暗/换位置
  ipcMain.on('flow:state', (e, on) => {
    if (!petWin || petWin.isDestroyed()) return;
    try { petWin.webContents.send('pet:flow', !!on); } catch (_) {}
  });
}

function getAutoStart() {
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch (_) {
    return false;
  }
}

function setAutoStart(on) {
  try {
    app.setLoginItemSettings({
      openAtLogin: !!on,
      openAsHidden: true,
      args: ['--hidden']
    });
    applyPatch({ settings: { autoStart: !!on } });
    return true;
  } catch (e) {
    log('设置开机自启失败', e.message);
    return false;
  }
}

/* ------------------------------------------------------------
   退出
   ------------------------------------------------------------ */
function quitApp() {
  quitting = true;
  app.quit();
}

/* ------------------------------------------------------------
   冒烟测试：截图 + 关键状态落盘，然后退出
   ------------------------------------------------------------ */
function runSmoke() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (w, name) => {
    if (!w || w.isDestroyed()) return null;
    try {
      const img = await w.webContents.capturePage();
      const p = path.join(ROOT, '_shot_' + name + '.png');
      fs.writeFileSync(p, img.toPNG());
      return p;
    } catch (e) {
      log('截图失败', name, e.message);
      return null;
    }
  };

  (async () => {
    await wait(4500);
    const rep = { storage: storage.info(), files: [], probes: {} };
    smokeRep = rep;

    // 收集两个窗口的 console 报错，页面里抛的异常会在这里露出来
    rep.consoleErrors = [];
    [mainWin, petWin].forEach((w) => {
      if (!w || w.isDestroyed()) return;
      w.webContents.on('console-message', (e, level, message, line, sourceId) => {
        if (level >= 3) {
          const where = String(sourceId || '').split('/').pop();
          rep.consoleErrors.push((w === mainWin ? 'main: ' : 'pet: ') + message +
            (where ? ' @' + where + ':' + line : ''));
        }
      });
    });

    try {
      rep.probes.main = await mainWin.webContents.executeJavaScript(
        '({ dpr: window.devicePixelRatio, w: innerWidth, h: innerHeight,' +
        ' isDesktop: !!(window.host && window.host.isDesktop),' +
        ' petProxied: !!(window.Pet && window.Pet.isProxied),' +
        ' storeBackend: (Store.storageInfo() || {}).backend,' +
        ' tasks: Store.tasks().length, views: document.querySelectorAll(".view").length,' +
        ' activeView: document.body.dataset.view })'
      );
      rep.probes.pet = await petWin.webContents.executeJavaScript(
        '({ w: innerWidth, h: innerHeight,' +
        ' imgSrc: (document.getElementById("petImg") || {}).src,' +
        ' imgW: (document.getElementById("petImg") || {}).naturalWidth,' +
        ' petRect: (function(){var r=document.getElementById("petBody").getBoundingClientRect();' +
        '   return {x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)};})(),' +
        ' expr: (window.Pet && Pet.setExpr) ? "ok" : "missing" })'
      );
    } catch (e) {
      rep.probes.error = String(e.message || e);
    }

    await interact(rep, wait);

    if (process.argv.indexOf('--probe-notes') >= 0) {
      await probeNotes(rep, wait);
      await probeNotesOps(rep, wait);
    }

    // 设置页单独留一张图，方便核对「数据目录」那一行的排版
    await mainWin.webContents.executeJavaScript('App.go("settings"), "ok"');
    await wait(600);
    await mainWin.webContents.executeJavaScript(
      '(function(){var n=[].slice.call(document.querySelectorAll(".set-row"));' +
      ' var t=n.filter(function(x){var h=x.querySelector(".set-row-title");' +
      '   return h && h.textContent.trim()==="数据目录";})[0];' +
      ' if(t) t.scrollIntoView({block:"center"}); return "ok";})()'
    );
    await wait(500);
    rep.files.push(await shot(mainWin, 'settings'));
    await mainWin.webContents.executeJavaScript('App.go("todo"), "ok"');
    await wait(600);

    rep.files.push(await shot(mainWin, 'main'));
    rep.files.push(await shot(petWin, 'pet'));

    // 桌宠是否真的在屏幕右下角且尺寸正确
    try {
      rep.petBounds = petWin.getBounds();
      rep.petVisible = petShown();
    } catch (_) {}

    fs.writeFileSync(path.join(ROOT, '_smoke.json'), JSON.stringify(rep, null, 2));
    log('冒烟完成', JSON.stringify(rep.interact || {}));
    setTimeout(() => quitApp(), 400);
  })().catch((e) => {
    // 任何一步炸掉都要落盘并退出，别留一个挂着的进程
    try {
      const rep2 = Object.assign({}, smokeRep || {}, { fatal: String((e && e.stack) || e) });
      fs.writeFileSync(path.join(ROOT, '_smoke.json'), JSON.stringify(rep2, null, 2));
      log('冒烟中断：' + String((e && e.message) || e));
    } catch (_) {}
    setTimeout(() => quitApp(), 400);
  });
}

/* 交互探测：穿透开关、点击反应、跨窗口指令、右键菜单 */
async function interact(rep, wait) {
  const r = { steps: [] };
  rep.interact = r;          // 先挂上：中途炸了也能从 _smoke.json 看到走到哪一步
  // 出错时把出问题的脚本一起报出来，否则只有一句「Script failed to execute」
  const jsPet = (code) => petWin.webContents.executeJavaScript(code).catch((e) => {
    throw new Error('pet 脚本失败(' + String(e.message || e) + ')：' + code.slice(0, 140));
  });

  // 先把她按到一个固定位置并停住：漫步途中取到的坐标，等发事件时她已经走了
  await jsPet('Pet.walkTo(Math.round(innerWidth * 0.72), Math.round(innerHeight * 0.52), 260), "ok"');
  await wait(800);

  // 抓主窗口里未捕获异常的堆栈：console-message 只有一句话，定位不到行
  try {
    await mainWin.webContents.executeJavaScript(
      'if (!window.__errs) { window.__errs = [];' +
      ' window.addEventListener("error", function (e) {' +
      '  window.__errs.push({ m: e.message, at: String(e.filename || "").split("/").pop() + ":" + e.lineno,' +
      '    s: (e.error && e.error.stack) || "" });' +
      ' }); } "ok"'
    );
  } catch (_) {}

  const pet = await jsPet(
    '(() => { const b = document.getElementById("petBody").getBoundingClientRect();' +
    ' return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height * 0.55) }; })()'
  );
  const move = (x, y) => petWin.webContents.sendInputEvent({ type: 'mouseMove', x: x, y: y });

  // 冒烟期间用假光标替代真实光标：穿透由主进程按光标轮询，
  // 不接管的话结果会取决于测试机上鼠标此刻停在哪
  const cb = petWin.getContentBounds();
  const cursorTo = (x, y) => { fakeCursor = { x: cb.x + x, y: cb.y + y }; };

  // 1) 指针移到她身上 → 应该关掉穿透
  cursorTo(pet.cx, pet.cy);
  move(pet.cx, pet.cy);
  await wait(320);
  if (petPenetrate) {                 // 第一次没命中再补一次，排除事件丢失
    move(pet.cx - 2, pet.cy + 2);
    await wait(320);
  }
  r.penetrateOnPet = petPenetrate;
  r.steps.push(['移到桌宠上', petPenetrate === false ? 'PASS' : 'FAIL(' + petPenetrate + ')']);

  // 2) 移开 → 应该恢复穿透
  cursorTo(40, 40);
  move(40, 40);
  await wait(300);
  r.penetrateAway = petPenetrate;
  r.steps.push(['移开后穿透', petPenetrate === true ? 'PASS' : 'FAIL(' + petPenetrate + ')']);

  // 3) 点她 → 应该有金币 + 表情变化
  cursorTo(pet.cx, pet.cy);
  move(pet.cx, pet.cy);
  await wait(150);
  petWin.webContents.sendInputEvent({ type: 'mouseDown', x: pet.cx, y: pet.cy, button: 'left', clickCount: 1 });
  petWin.webContents.sendInputEvent({ type: 'mouseUp', x: pet.cx, y: pet.cy, button: 'left', clickCount: 1 });
  await wait(420);
  const afterClick = await jsPet(
    '({ coins: document.querySelectorAll(".pet-coin").length,' +
    ' cls: document.getElementById("petBody").className,' +
    ' img: (document.getElementById("petImg").src || "").split("/").pop() })'
  );
  r.click = afterClick;
  r.steps.push(['单击有反应', (afterClick.coins > 0 || afterClick.cls) ? 'PASS' : 'FAIL']);

  // 3.5) 指针一动不动，她自己走过来停在指针底下 —— 用户报的「抓不动」就是这个场景。
  //      以前没有 mousemove 就不会重新判定，窗口一直穿透。现在靠主进程轮询纠正。
  const room = await jsPet(
    '({ W: innerWidth, H: innerHeight })'
  );
  const spot = { x: Math.round(room.W * 0.42), y: Math.round(room.H * 0.66) };
  await jsPet('Pet.walkTo(' + Math.round(room.W - 200) + ', 40, 400), "ok"');
  cursorTo(spot.x, spot.y);
  move(spot.x, spot.y);
  await wait(500);
  r.stillBefore = petPenetrate;

  let covered = false;
  for (let i = 0; i < 2 && !covered; i++) {
    await jsPet(
      '(function () { var b = document.getElementById("petBody").getBoundingClientRect();' +
      ' Pet.walkTo(Math.round(' + spot.x + ' - b.width / 2), Math.round(' + spot.y + ' - b.height / 2), 600);' +
      ' return "ok"; })()'
    );
    await wait(950);
    const c = await jsPet(
      '(function () { var b = document.getElementById("petBody").getBoundingClientRect();' +
      ' return { x0: b.left, x1: b.right, y0: b.top, y1: b.bottom }; })()'
    );
    covered = spot.x >= c.x0 && spot.x <= c.x1 && spot.y >= c.y0 && spot.y <= c.y1;
    r.stillCover = c;
  }
  r.stillAfter = petPenetrate;
  r.stillCovered = covered;
  r.steps.push(['指针不动、她自己走过来也能抓',
    (r.stillBefore === true && covered && r.stillAfter === false)
      ? 'PASS'
      : 'FAIL(前=' + r.stillBefore + ' 覆盖=' + covered + ' 后=' + r.stillAfter + ')']);

  // 4) 主窗口调 Pet.celebrate() → 桌宠窗口应该执行
  await mainWin.webContents.executeJavaScript('window.Pet && Pet.celebrate && Pet.celebrate(), "sent"');
  await wait(700);
  const afterRemote = await jsPet(
    '({ coins: document.querySelectorAll(".pet-coin").length,' +
    ' img: (document.getElementById("petImg").src || "").split("/").pop() })'
  );
  r.remoteCelebrate = afterRemote;
  r.steps.push(['跨窗口 celebrate', /money|laugh/.test(afterRemote.img) || afterRemote.coins > 0 ? 'PASS' : 'FAIL(' + afterRemote.img + ')']);

  // 5) 右键菜单能开，且开菜单时不穿透
  await jsPet('document.getElementById("pet").dispatchEvent(new MouseEvent("contextmenu",{bubbles:true,cancelable:true})); "ok"');
  await wait(260);
  const menu = await jsPet('({ n: document.querySelectorAll("#menuLayer .menu-item").length,' +
    ' on: !!document.querySelector("#menuLayer .menu.on, #menuLayer .menu") })');
  r.menu = { items: menu.n, penetrate: petPenetrate };
  r.steps.push(['右键菜单', menu.n >= 6 ? 'PASS' : 'FAIL(' + menu.n + '项)']);
  r.steps.push(['菜单不穿透', petPenetrate === false ? 'PASS' : 'FAIL']);

  // 6) 菜单里「睡一会儿」→ 闭眼脸
  const slept = await jsPet(
    '(() => {' +
    ' const it = [].slice.call(document.querySelectorAll("#menuLayer .menu-item"))' +
    '   .filter(n => n.textContent.indexOf("睡一会儿") >= 0)[0];' +
    ' if (!it) return "no-item"; it.click(); return "clicked"; })()'
  );
  await wait(700);
  const sleepState = await jsPet(
    '({ img: (document.getElementById("petImg").src || "").split("/").pop(),' +
    ' cls: document.getElementById("petBody").className,' +
    ' zzz: !document.getElementById("petZzz").hidden })'
  );
  r.sleep = sleepState;
  r.steps.push(['睡一会儿会闭眼', /front_sleep/.test(sleepState.img || '') ? 'PASS' : 'FAIL(' + slept + '/' + sleepState.img + ')']);

  // 6.5) 指针一动不动压在她身上，超过「心跳超时」阈值也得还抓得住
  //      曾经：页面判定结果没变就不再发消息 → 主进程以为页面死了，强制打开穿透，
  //      而页面仍自认不穿透 → 双方状态永久错位，她从此拖不动。用户说的「过一会就不行」。
  //      先把她钉在一个固定点：睡着时不会漫游，位置才稳定得住
  await jsPet('Pet.walkTo(Math.round(innerWidth * 0.38), Math.round(innerHeight * 0.58), 500), "ok"');
  await wait(800);
  const idlePet = await jsPet(
    '(function () { var b = document.getElementById("petBody").getBoundingClientRect();' +
    ' return { cx: Math.round(b.x + b.width / 2), cy: Math.round(b.y + b.height / 2) }; })()'
  );
  cursorTo(idlePet.cx, idlePet.cy);
  move(idlePet.cx, idlePet.cy);
  await wait(600);
  r.idleBefore = petPenetrate;
  await wait(7000);                  // 指针和她的位置都不动
  r.idleAfter = petPenetrate;
  r.steps.push(['静置 7 秒后仍然抓得住',
    (r.idleBefore === false && r.idleAfter === false)
      ? 'PASS' : 'FAIL(前=' + r.idleBefore + ' 后=' + r.idleAfter + ')']);

  // 7) 主窗口设置页能渲染桌面专属开关
  await mainWin.webContents.executeJavaScript('App.go("settings"), "ok"');
  await wait(600);
  const set = await mainWin.webContents.executeJavaScript(
    '({ rows: document.querySelectorAll(".set-row").length,' +
    ' autoStart: !!document.querySelector("[data-sw=\\"autoStart\\"]"),' +
    ' tray: !!document.querySelector("[data-sw=\\"minimizeTray\\"]"),' +
    ' openDir: !!document.querySelector("[data-act=\\"open-dir\\"]"),' +
    ' changeDir: !!document.querySelector("[data-act=\\"change-dir\\"]"),' +
    ' dirText: (function(){var n=[].slice.call(document.querySelectorAll(".set-row"));' +
    '   var t=n.filter(function(x){var h=x.querySelector(".set-row-title");' +
    '     return h && h.textContent.trim()==="数据目录";})[0];' +
    '   return t ? t.textContent.replace(/\\s+/g," ").slice(0,160) : "none";})() })'
  );
  r.settings = set;
  r.steps.push(['开机自启开关', set.autoStart ? 'PASS' : 'FAIL']);
  r.steps.push(['托盘开关', set.tray ? 'PASS' : 'FAIL']);
  r.steps.push(['数据目录行', set.openDir ? 'PASS' : 'FAIL']);
  r.steps.push(['数据目录能换位置', set.changeDir ? 'PASS' : 'FAIL']);
  r.steps.push(['数据目录行显示真实路径',
    /[\\/]/.test(set.dirText || '') ? 'PASS' : 'FAIL(' + set.dirText + ')']);

  // 7.5) 桌宠右键「退出桌宠」→ 设置页重新打开：只许出现一次，不许来回闪。
  //      曾经的坑：Settings.render() 每次都往同一个 #settingsBody 上叠一层
  //      click 委托；桌宠窗口的数据推送又会自动触发 render。点一次开关连跑
  //      N 个处理器，「已出现 / 已隐藏」交替弹，桌宠闪一下就又没了。
  await jsPet('Store.setting("petVisible", false), "ok"');
  await wait(400);
  // 再堆几次重绘（boot / 切页 / 远程推送），把旧版的绑定层数放大
  await mainWin.webContents.executeJavaScript('Settings.render(), Settings.render(), Settings.render(), "ok"');
  // 留下一个「隐藏 1 小时」的残留，重新显示时必须清掉
  await mainWin.webContents.executeJavaScript('Store.setting("petHiddenUntil", Date.now() + 3600000), "ok"');
  await wait(400);
  await mainWin.webContents.executeJavaScript(
    'window.__toastLog = []; window.__toastOrig = UI.toast;' +
    ' UI.toast = function (m, o) { window.__toastLog.push(String(m));' +
    '   return window.__toastOrig.apply(this, arguments); }; "ok"'
  );
  await mainWin.webContents.executeJavaScript(
    'document.querySelector("[data-sw=\\"petVisible\\"]").click(), "ok"'
  );
  await wait(800);
  const petToggle = await mainWin.webContents.executeJavaScript(
    '({ visible: Store.setting("petVisible"),' +
    ' hiddenUntil: Store.setting("petHiddenUntil"),' +
    ' toasts: window.__toastLog.slice(),' +
    ' on: !!document.querySelector("[data-sw=\\"petVisible\\"].is-on") })'
  );
  await mainWin.webContents.executeJavaScript('UI.toast = window.__toastOrig, "ok"');
  r.petToggle = petToggle;
  r.steps.push(['桌宠退出后能从设置稳定开回来',
    (petToggle.visible === true && petToggle.on && petShown())
      ? 'PASS' : 'FAIL(' + JSON.stringify(petToggle) + ')']);
  r.steps.push(['开关只弹一次提示（不来回闪）',
    (petToggle.toasts.filter((m) => m === '桌宠已出现').length === 1 &&
      !petToggle.toasts.some((m) => m === '桌宠已隐藏'))
      ? 'PASS' : 'FAIL(' + JSON.stringify(petToggle.toasts) + ')']);
  r.steps.push(['重新显示会清掉「隐藏 1 小时」',
    petToggle.hiddenUntil === 0 ? 'PASS' : 'FAIL(' + petToggle.hiddenUntil + ')']);

  // 7.6) 右键菜单里的「隐藏 1 小时」是另一条路：petVisible 仍是 true，
  //      只留了个未来时间戳。设置页开关得按「她是否真的在桌面上」显示，
  //      点一下就该把她叫回来，而不是反倒把总开关关掉。
  // 从桌宠窗口发，才和真实右键菜单同一条路：主窗口自己 save() 时
  // broadcastState 会排除发送者，开关不会被重绘。
  await jsPet('Store.setting("petHiddenUntil", Date.now() + 3600000), "ok"');
  await wait(550);
  const hideSwitch = await mainWin.webContents.executeJavaScript(
    '!!document.querySelector("[data-sw=\\"petVisible\\"].is-on")'
  );
  const hiddenByTimer = !petShown();
  await mainWin.webContents.executeJavaScript(
    'document.querySelector("[data-sw=\\"petVisible\\"]").click(), "ok"'
  );
  await wait(700);
  const timerRes = await mainWin.webContents.executeJavaScript(
    '({ visible: Store.setting("petVisible"), hiddenUntil: Store.setting("petHiddenUntil"),' +
    ' on: !!document.querySelector("[data-sw=\\"petVisible\\"].is-on") })'
  );
  r.petHideTimer = { switchBefore: hideSwitch, hiddenByTimer: hiddenByTimer, after: timerRes };
  r.steps.push(['「隐藏 1 小时」时开关显示为关',
    (hideSwitch === false && hiddenByTimer)
      ? 'PASS' : 'FAIL(' + JSON.stringify([hideSwitch, hiddenByTimer]) + ')']);
  r.steps.push(['「隐藏 1 小时」后一次点击就叫回来',
    (timerRes.visible === true && timerRes.hiddenUntil === 0 && timerRes.on && petShown())
      ? 'PASS' : 'FAIL(' + JSON.stringify(timerRes) + ')']);

  // 8) 主窗口写入要真的落到磁盘上（而不只是内存里）
  const before = (storage.load() || { tasks: [] }).tasks.length;
  await mainWin.webContents.executeJavaScript('Store.addTask({ title: "__probe__" }), "ok"');
  await wait(400);
  const after = (storage.load() || { tasks: [] }).tasks.length;
  r.steps.push(['写入能落盘', after === before + 1 ? 'PASS' : 'FAIL(' + before + '→' + after + ')']);
  await mainWin.webContents.executeJavaScript(
    'Store.data.tasks = Store.data.tasks.filter(function (t) { return t.title !== "__probe__"; }), Store.save(), "ok"'
  );
  await wait(200);

  // 8.5) 新建待办不填截止时间 → 不能判超时。
  //      曾经的坑：日期框默认预填「今天」+ 时间空 → 落到当天 00:00，一创建就是已超时。
  await mainWin.webContents.executeJavaScript('App.go("todo"), "ok"');
  await wait(500);
  const createRes = await mainWin.webContents.executeJavaScript(
    '(function(){' +
    ' document.getElementById("btnAddTodo").click();' +
    ' var card = document.querySelector(".create-card");' +
    ' if (!card) return { err: "no-card" };' +
    ' var inp = card.querySelector(".create-title");' +
    ' if (!inp) return { err: "no-input" };' +
    ' var d = card.querySelector("[data-due-date]").value;' +
    ' var t = card.querySelector("[data-due-time]").value;' +
    ' inp.value = "__due_probe__";' +
    ' card.querySelector(\'[data-act="save"]\').click();' +
    ' return { defaultDate: d, defaultTime: t };' +
    ' })()'
  );
  await wait(500);
  const probeTask = await mainWin.webContents.executeJavaScript(
    '(function(){ var t = Store.data.tasks.filter(function (x) { return x.title === "__due_probe__"; })[0];' +
    ' return t ? { due: t.dueAt, over: Store.isOverdue(t) } : null; })()'
  );
  r.steps.push([
    '新建不填截止不超时',
    probeTask && !probeTask.due && probeTask.over === false ? 'PASS'
      : 'FAIL(' + JSON.stringify(probeTask) + '｜默认 ' +
        (createRes && createRes.defaultDate) + ' ' + (createRes && createRes.defaultTime) + ')'
  ]);
  // 只填日期不填时间 → 当天 23:59，不该立刻超时
  const dateOnly = await mainWin.webContents.executeJavaScript(
    '(function(){ var now = Date.now();' +
    ' var ts = U.toDueTs(U.tsToDateInput(now), "");' +
    ' return { ts: ts, over: ts ? Date.now() > ts : null }; })()'
  );
  r.steps.push(['只填日期不立刻超时', dateOnly.ts && dateOnly.over === false ? 'PASS' : 'FAIL(' + JSON.stringify(dateOnly) + ')']);
  await mainWin.webContents.executeJavaScript(
    'Store.data.tasks = Store.data.tasks.filter(function (t) { return t.title !== "__due_probe__"; }), Store.save(), "ok"'
  );
  await wait(200);

  // 9) 笔记页要真的能用：事件绑定漏一次，整页就是死的
  await mainWin.webContents.executeJavaScript('App.go("notes"), "ok"');
  await wait(600);
  const noteMenu = await mainWin.webContents.executeJavaScript(
    '(function(){ document.getElementById("btnNewNote").click();' +
    ' return document.querySelectorAll("#menuLayer .menu-item").length; })()'
  );
  r.steps.push(['笔记页新建菜单', noteMenu >= 3 ? 'PASS' : 'FAIL(' + noteMenu + '项)']);
  const noteOpened = await mainWin.webContents.executeJavaScript(
    '(function(){' +
    ' var it = [].slice.call(document.querySelectorAll("#menuLayer .menu-item"))' +
    '   .filter(function(n){return n.textContent.indexOf("新建独立笔记")>=0;})[0];' +
    ' if (!it) return "no-item"; it.click(); return "ok"; })()'
  );
  await wait(600);
  const noteState = await mainWin.webContents.executeJavaScript(
    '({ title: document.getElementById("noteTitle").value,' +
    ' empty: document.getElementById("nmain").classList.contains("is-empty") })'
  );
  r.note = { opened: noteOpened, state: noteState };
  r.steps.push(['笔记页能新建',
    (!noteState.empty && noteState.title.indexOf('未命名') >= 0) ? 'PASS' : 'FAIL(' + noteState.title + ')']);

  // 10) 正文输入要能进编辑器，并且走完自动保存
  await mainWin.webContents.executeJavaScript(
    'var b = document.getElementById("noteBody"); b.focus(); "ok"');
  mainWin.webContents.sendInputEvent({ type: 'char', keyCode: 'Q' });
  await wait(1300);
  const typed = await mainWin.webContents.executeJavaScript(
    '({ text: document.getElementById("noteBody").innerText,' +
    ' status: document.getElementById("saveStatus").textContent })'
  );
  r.steps.push(['笔记正文能输入并保存',
    /Q/.test(typed.text) && typed.status.indexOf('已保存') >= 0
      ? 'PASS' : 'FAIL(' + typed.text.slice(0, 10) + '/' + typed.status + ')']);

  // 11) 删除最外层笔记集：入口不能再只有「打开某篇后的右上更多」
  const nbPick = await mainWin.webContents.executeJavaScript(
    '(function(){' +
    ' var all = Store.items();' +
    ' var nbs = all.filter(function(i){return i.type === "notebook" && !i.parentId && !i.deletedAt;});' +
    ' var nb = nbs[0];' +
    ' if (!nb) return { err: "no-notebook", total: all.length,' +
    '   types: all.map(function(i){return i.type + ":" + i.title;}) };' +
    ' window.__nb = nb.id; window.__nbTitle = nb.title;' +
    ' var ret = Notes.openItem(nb.id);' +
    ' return { id: nb.id, title: nb.title, n: nbs.length, ret: String(ret),' +
    '   cls: document.getElementById("nmain").className }; })()'
  );
  await wait(500);
  const drillState = await mainWin.webContents.executeJavaScript(
    '(function(){' +
    ' var m = document.querySelector("#nlistBody .drill-more");' +
    ' var bh = document.getElementById("btnNoteMore");' +
    ' return { hasMore: !!m,' +
    '  isDrill: document.getElementById("nmain").classList.contains("is-drill"),' +
    '  crumbs: document.querySelectorAll("#crumbs .crumb").length,' +
    '  moreVis: bh ? getComputedStyle(bh).visibility : "missing" }; })()'
  );
  r.drill = drillState;
  try { r.jsErrors = await mainWin.webContents.executeJavaScript('window.__errs || []'); } catch (_) {}
  r.steps.push(['笔记集里有删除入口',
    (drillState.hasMore && drillState.isDrill && drillState.crumbs >= 1)
      ? 'PASS' : 'FAIL(' + JSON.stringify(drillState) + ')']);
  r.steps.push(['笔记集里右上「更多」仍可见',
    drillState.moreVis === 'visible' ? 'PASS' : 'FAIL(' + drillState.moreVis + ')']);

  const delMenu = await mainWin.webContents.executeJavaScript(
    '(function(){' +
    ' var m = document.querySelector("#nlistBody .drill-more");' +
    ' if (!m) return []; m.click();' +
    ' return [].slice.call(document.querySelectorAll("#menuLayer .menu-item"))' +
    '   .map(function(n){ return n.textContent.trim(); }); })()'
  );
  await wait(260);
  r.delMenu = delMenu;
  r.steps.push(['笔记集「…」菜单含删除',
    delMenu.indexOf('删除') >= 0 ? 'PASS' : 'FAIL(' + delMenu.join('/') + ')']);

  const clickedDel = await mainWin.webContents.executeJavaScript(
    '(function(){' +
    ' var it = [].slice.call(document.querySelectorAll("#menuLayer .menu-item"))' +
    '   .filter(function(n){ return n.textContent.trim() === "删除"; })[0];' +
    ' if (!it) return "no-item"; it.click(); return "ok"; })()'
  );
  await wait(420);
  const confirmed = await mainWin.webContents.executeJavaScript(
    '(function(){' +
    ' var btns = [].slice.call(document.querySelectorAll(".modal-foot .btn"));' +
    ' var ok = btns.filter(function(b){ return b.textContent.indexOf("移入回收站") >= 0; })[0];' +
    ' if (!ok) return "no-ok:" + btns.map(function(b){ return b.textContent.trim(); }).join("/");' +
    ' ok.click(); return "ok"; })()'
  );
  await wait(650);
  const afterDel = await mainWin.webContents.executeJavaScript(
    '({ deleted: !!(Store.getItem(window.__nb) || {}).deletedAt,' +
    ' found: !!Store.getItem(window.__nb),' +
    ' inList: [].slice.call(document.querySelectorAll("#nlistBody .nrow[data-id]"))' +
    '   .some(function(x){ return x.dataset.id === window.__nb; }),' +
    ' stillDrill: document.getElementById("nmain").classList.contains("is-drill") })'
  );
  r.afterDel = { picked: nbPick, clicked: clickedDel, confirmed: confirmed, state: afterDel };
  r.steps.push(['删除笔记集后级联进回收站并从列表消失',
    (afterDel.deleted && !afterDel.inList && !afterDel.stillDrill)
      ? 'PASS' : 'FAIL(' + JSON.stringify(afterDel) + '/' + clickedDel + '/' + confirmed + ')']);

  await mainWin.webContents.executeJavaScript('App.go("trash", { trash: "note" }), "ok"');
  await wait(650);
  const trashInfo = await mainWin.webContents.executeJavaScript(
    '(function(){' +
    ' var titles = [].slice.call(document.querySelectorAll("#trashList .trash-item"))' +
    '   .map(function(n){ return n.querySelector(".trash-title").textContent; });' +
    ' var top = Store.trashItems().filter(function(n){' +
    '   return !n.parentId || !(Store.getItem(n.parentId) || {}).deletedAt; });' +
    ' return { titles: titles, top: top.length, all: Store.trashItems().length }; })()'
  );
  r.trashInfo = { info: trashInfo, nb: nbPick };
  r.steps.push(['回收站显示被删笔记集',
    (nbPick && trashInfo.titles.indexOf(nbPick.title) >= 0)
      ? 'PASS' : 'FAIL(' + trashInfo.titles.join('/') + ')']);
  r.steps.push(['回收站只列顶层条目不重复列子项',
    trashInfo.titles.length === trashInfo.top
      ? 'PASS' : 'FAIL(列出' + trashInfo.titles.length + '/顶层' + trashInfo.top + '/全部' + trashInfo.all + ')']);

  // 10.9) 笔记列表的收起/展开：窄屏是抽屉（要有遮罩），宽屏是左栏
  // 先真的切到笔记页 —— 视图没激活时 getBoundingClientRect 仍有值，命中测试会量到别的页
  await mainWin.webContents.executeJavaScript('App.go("notes", { force: true }), "ok"');
  await wait(500);
  const listToggle = await mainWin.webContents.executeJavaScript(
    '(function () {\n' +
    '  var v = document.getElementById("view-notes");\n' +
    '  var closeBtn = document.getElementById("btnListClose");\n' +
    '  var openBtn = document.getElementById("btnDrawer");\n' +
    '  var mask = document.getElementById("nlistMask");\n' +
    '  var narrow = window.innerWidth <= ((window.Notes && Notes.DRAWER_W) || 1040);\n' +
    '  function shown() {\n' +
    '    return narrow ? v.classList.contains("is-drawer") : !v.classList.contains("is-collapsed");\n' +
    '  }\n' +
    '  var closeVisible = getComputedStyle(closeBtn).display !== "none";\n' +
    '  openBtn.click();\n' +
    '  var opened = shown();\n' +
    '  var maskOn = getComputedStyle(mask).display !== "none";\n' +
    '  closeBtn.click();\n' +
    '  var closed = !shown();\n' +
    '  var maskOff = getComputedStyle(mask).display === "none";\n' +
    '  return { narrow: narrow, closeVisible: closeVisible, opened: opened, maskOn: maskOn, closed: closed, maskOff: maskOff };\n' +
    '})()'
  );
  // 抽屉收起有滑出动画：等它彻底落位，再等两帧让布局稳定，
  // 否则量到的是还在过渡中的位置（曾偶发把展开按钮量到 x=56，命中就成了空态层）
  await wait(900);
  const hitRep = await mainWin.webContents.executeJavaScript(
    '(async function () {\n' +
    // 这里不能用 requestAnimationFrame 等布局：主窗口被桌宠那个铺满屏幕的
    // 置顶窗口遮住时，Chromium 会暂停帧回调，整个 async 探针会永远不 resolve。
    '  await new Promise(function (r) { setTimeout(r, 60); });\n' +
    '  void document.body.offsetHeight;\n' +
    '  var openBtn = document.getElementById("btnDrawer");\n' +
    '  var main = document.getElementById("nmain");\n' +
    '  var hadEmpty = main.classList.contains("is-empty");\n' +
    '  if (!hadEmpty) main.classList.add("is-empty");\n' +
    '  void main.offsetHeight;\n' +
    // 打包版启动慢一点时，动画可能多走几帧：连续采样，任一帧命中就算数。
    // 真被空态层盖住的话 5 帧都不会命中，不会把真问题放过去。
    '  var br = null, el = null, hit = false;\n' +
    '  for (var i = 0; i < 5 && !hit; i++) {\n' +
    '    await new Promise(function (r) { setTimeout(r, 60); });\n' +
    '    void document.body.offsetHeight;\n' +
    '    br = openBtn.getBoundingClientRect();\n' +
    '    var pts = [[0.5, 0.5], [0.3, 0.5], [0.7, 0.5], [0.5, 0.3], [0.5, 0.7]];\n' +
    '    for (var j = 0; j < pts.length && !hit; j++) {\n' +
    '      el = document.elementFromPoint(br.left + br.width * pts[j][0], br.top + br.height * pts[j][1]);\n' +
    '      hit = !!(el && (el === openBtn || openBtn.contains(el)));\n' +
    '    }\n' +
    '  }\n' +
    '  var head = document.querySelector(".nhead");\n' +
    '  var bc = getComputedStyle(openBtn);\n' +
    '  if (!hadEmpty) main.classList.remove("is-empty");\n' +
    '  return { hit: hit, btn: [Math.round(br.left), Math.round(br.top), Math.round(br.width), Math.round(br.height)],\n' +
    '    at: el ? (el.id || String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className) || el.tagName) : "none",\n' +
    '    elInHead: el ? !!el.closest(".nhead") : false,\n' +
    '    btnCss: [bc.display, bc.visibility, bc.pointerEvents, bc.position, bc.zIndex].join("/"),\n' +
    '    z: getComputedStyle(head).zIndex, pos: getComputedStyle(head).position };\n' +
    '})()'
  );
  listToggle.hitEmpty = hitRep.hit;
  listToggle.hitInfo = hitRep;
  // 窄屏下再点一次导航栏「笔记」应该开关列表（用户原来的抱怨就是这个）
  const navRep = await mainWin.webContents.executeJavaScript(
    '(function () {\n' +
    '  var v = document.getElementById("view-notes");\n' +
    '  var rail = document.querySelector(".rail-btn[data-nav=\\"notes\\"]");\n' +
    '  if (!rail) return { err: "no-rail" };\n' +
    '  rail.click();\n' +
    '  var opened = v.classList.contains("is-drawer");\n' +
    '  rail.click();\n' +
    '  var closed = !v.classList.contains("is-drawer");\n' +
    '  return { opened: opened, closed: closed };\n' +
    '})()'
  );
  listToggle.navToggle = navRep;
  r.steps.push(['再点导航「笔记」能开关列表',
    (navRep.opened && navRep.closed) ? 'PASS' : 'FAIL(' + JSON.stringify(navRep) + ')']);
  r.listToggle = listToggle;
  r.steps.push(['笔记列表有收起按钮',
    listToggle.closeVisible ? 'PASS' : 'FAIL']);
  r.steps.push(['列表能展开也能收起',
    (listToggle.opened && listToggle.closed) ? 'PASS' : 'FAIL(' + JSON.stringify(listToggle) + ')']);
  r.steps.push(['窄屏抽屉有遮罩且收起后消失',
    listToggle.narrow ? ((listToggle.maskOn && listToggle.maskOff) ? 'PASS' : 'FAIL(' + JSON.stringify(listToggle) + ')')
      : 'PASS(宽屏无遮罩)']);
  r.steps.push(['空态下顶栏展开按钮点得到',
    listToggle.hitEmpty ? 'PASS' : 'FAIL(被空态遮住)']);

  // 11.5) 换数据目录：文件要真的复制过去，切回来还能读回同一份
  const dirFrom = storage.info().dir;
  const dirAlt = path.join(require('os').tmpdir(), 'zzqy-datadir-' + process.pid);
  const cntBefore = ((storage.load() || {}).tasks || []).length;
  const mvA = await migrateDataDir(dirAlt, { adopt: false });
  const altHasJson = fs.existsSync(path.join(dirAlt, 'data.json'));
  const cntAlt = ((storage.load() || {}).tasks || []).length;
  const ptrA = (function () {
    try { return JSON.parse(fs.readFileSync(locationFile(), 'utf8')).dataDir; } catch (_) { return null; }
  })();
  const mvB = await migrateDataDir(dirFrom, { adopt: true });
  const cntBack = ((storage.load() || {}).tasks || []).length;
  const same = await migrateDataDir(storage.info().dir, { adopt: true });
  r.dataDir = { from: dirFrom, alt: dirAlt, mvA: mvA, mvB: mvB };
  r.steps.push(['换数据目录会把数据复制过去',
    (mvA.ok && altHasJson && cntAlt > 0) ? 'PASS'
      : 'FAIL(' + JSON.stringify(mvA) + ' json=' + altHasJson + ' n=' + cntAlt + ')']);
  r.steps.push(['指针文件记住新位置',
    ptrA === path.resolve(dirAlt) ? 'PASS' : 'FAIL(' + ptrA + ')']);
  r.steps.push(['切回原目录数据一致',
    (mvB.ok && cntBack === cntBefore) ? 'PASS' : 'FAIL(' + JSON.stringify(mvB) + ' ' + cntBack + '/' + cntBefore + ')']);
  r.steps.push(['选同一个目录会被拦下', same.ok === false ? 'PASS' : 'FAIL']);

  // 11.6) 拖拽排序：整卡可拖（不再只认把手），并且真的换了顺序
  await wait(700);
  const dragRep = await mainWin.webContents.executeJavaScript(
    '(async function () {\n' +
    '  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));\n' +
    '  const snap = JSON.parse(JSON.stringify(Store.data.tasks));\n' +
    '  const mk = (id, title) => ({ id: id, title: title, desc: "", dueAt: null, createdAt: Date.now(), updatedAt: Date.now(), status: "doing", completedAt: null, deletedAt: null, deletedFrom: null });\n' +
    '  try {\n' +
    '    Store.data.tasks = Store.data.tasks.filter((t) => t.status !== "doing" && t.title !== "__drag1__" && t.title !== "__drag2__");\n' +
    '    Store.data.tasks.push(mk("__d1", "__drag1__"), mk("__d2", "__drag2__"));\n' +
    '    App.go("todo", { force: true });\n' +
    '    await sleep(420);\n' +
    '    const g = document.querySelectorAll("#doingGrid .task-card");\n' +
    '    if (g.length !== 2) return { err: "cards=" + g.length };\n' +
    '    const a = g[0].getBoundingClientRect(), b = g[1].getBoundingClientRect();\n' +
    '    const x0 = a.left + 80, y0 = a.top + 14, x1 = b.left + 80, y1 = b.bottom - 8;\n' +
    '    const fire = (el, type, x, y) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: type === "pointerup" ? 0 : 1, pointerId: 21, pointerType: "mouse", isPrimary: true }));\n' +
    '    const card = g[0];\n' +
    '    fire(card, "pointerdown", x0, y0);\n' +
    '    for (let i = 1; i <= 8; i++) fire(card, "pointermove", x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8);\n' +
    '    const mid = { line: !!document.querySelector(".drop-line"), body: document.body.classList.contains("task-dragging"), card: card.classList.contains("is-dragging") };\n' +
    '    fire(card, "pointerup", x1, y1);\n' +
    '    await sleep(420);\n' +
    '    const after = [].map.call(document.querySelectorAll("#doingGrid .task-card"), (c) => c.dataset.id);\n' +
    '    return { mid: mid, after: after, bodyAfter: document.body.classList.contains("task-dragging"), lineCleared: !document.querySelector(".drop-line"), ok: after[0] === "__d2" && after[1] === "__d1" };\n' +
    '  } finally {\n' +
    '    Store.data.tasks = snap;\n' +
    '    Store.save();\n' +
    '    Todo.render();\n' +
    '  }\n' +
    '})()'
  );
  r.drag = dragRep;
  r.steps.push(['拖拽中途有落点提示',
    (dragRep.mid && dragRep.mid.line && dragRep.mid.body && dragRep.mid.card) ? 'PASS'
      : 'FAIL(' + JSON.stringify(dragRep.mid || dragRep) + ')']);
  r.steps.push(['拖完顺序真的变了', dragRep.ok ? 'PASS' : 'FAIL(' + JSON.stringify(dragRep.after || dragRep) + ')']);
  r.steps.push(['松手后清理干净',
    (dragRep.lineCleared && dragRep.bodyAfter === false) ? 'PASS'
      : 'FAIL(' + JSON.stringify({ l: dragRep.lineCleared, b: dragRep.bodyAfter }) + ')']);

  // 11.9) 全屏检测：先用假的 api 对象把判定逻辑跑一遍，再用真的全屏窗口验证
  const fsJudge = (function () {
    const mon = { left: 0, top: 0, right: 1920, bottom: 1080 };
    const work = { left: 0, top: 0, right: 1920, bottom: 1040 };
    function mk(rect, quns, shellHwnd) {
      return {
        GetForegroundWindow: () => 7n,
        GetShellWindow: () => (shellHwnd ? 7n : 8n),
        GetWindowRect: (h, r) => { if (!rect) return false; Object.assign(r, rect); return true; },
        MonitorFromWindow: () => 9n,
        GetMonitorInfoW: (m, mi) => { mi.rcMonitor = mon; mi.rcWork = work; return true; },
        SHQueryUserNotificationState: (st) => { st[0] = quns; return 0; }
      };
    }
    const full = Fullscreen.judge(mk(mon, 5, false));
    const maximized = Fullscreen.judge(mk(work, 5, false));
    const desktop = Fullscreen.judge(mk(mon, 5, true));
    const d3d = Fullscreen.judge(mk({ left: 0, top: 0, right: 800, bottom: 600 }, 3, false));
    const idle = Fullscreen.judge(mk({ left: 100, top: 100, right: 900, bottom: 700 }, 5, false));
    // 锁屏 / 屏保不算全屏：这时 hide/show 一趟没有意义，还会留下窗口状态错位
    const notPresent = Fullscreen.judge(mk({ left: 100, top: 100, right: 900, bottom: 700 }, 1, false));
    return { full: full.full, maximized: maximized.full, desktop: desktop.full,
      d3d: d3d.full, idle: idle.full, notPresent: notPresent.full };
  })();
  r.fsJudge = fsJudge;
  r.steps.push(['铺满屏幕算全屏', fsJudge.full ? 'PASS' : 'FAIL']);
  r.steps.push(['最大化窗口不算全屏', fsJudge.maximized === false ? 'PASS' : 'FAIL']);
  r.steps.push(['点桌面不算全屏', fsJudge.desktop === false ? 'PASS' : 'FAIL']);
  r.steps.push(['独占全屏（窗口矩形不准）也算', fsJudge.d3d ? 'PASS' : 'FAIL']);
  r.steps.push(['普通窗口不算全屏', fsJudge.idle === false ? 'PASS' : 'FAIL']);
  r.steps.push(['锁屏屏保不收起桌宠', fsJudge.notPresent === false ? 'PASS' : 'FAIL']);

  if (fsWatcher) {
    // 真刀真枪：开一个铺满屏幕的窗口，看桌宠是不是自己让开了
    const petBefore = petShown();
    let fake = null;
    try {
      fake = new BrowserWindow({
        frame: false,
        show: false,
        skipTaskbar: true,
        alwaysOnTop: false,
        webPreferences: { backgroundThrottling: false }
      });
      fake.setBounds(screen.getPrimaryDisplay().bounds);
      fake.loadURL('data:text/html,<body style="margin:0;background:%23000"></body>');
      fake.once('ready-to-show', () => { fake.show(); fake.focus(); });
      fake.show();
      fake.focus();
      await wait(2400);
      const during = { probe: fsWatcher.probe(), petVisible: petShown() };
      r.fsLive = { petBefore: petBefore, during: during };
      if (during.probe && during.probe.full) {
        r.steps.push(['别的程序全屏时桌宠自动隐藏', during.petVisible ? 'FAIL(还看得见)' : 'PASS']);

        // 收起必须真的落到页面上，且 OS 窗口本身始终显示（不再 hide/show）
        const dom = await petWin.webContents.executeJavaScript(
          '({ hidden: document.documentElement.classList.contains("pet-suppressed"),' +
          ' geo: (window.PetHost && PetHost.debug) ? PetHost.debug().rects.length : -1 })'
        );
        r.fsDom = dom;
        r.steps.push(['收起时页面透明且无命中区', (dom.hidden && dom.geo === 0) ? 'PASS' : 'FAIL(' + JSON.stringify(dom) + ')']);

        // 开关得真的管用，否则那只是一个摆设
        await mainWin.webContents.executeJavaScript(
          'Store.setting("hideOnFullscreen", false), Store.save(), "ok"'
        );
        await wait(1900);
        const off = petShown();
        r.steps.push(['关掉开关后全屏也不再隐藏', off ? 'PASS' : 'FAIL(仍然藏着)']);

        await mainWin.webContents.executeJavaScript(
          'Store.setting("hideOnFullscreen", true), Store.save(), "ok"'
        );
        await wait(1900);
        const back = !petShown();
        r.steps.push(['打开开关后立刻又躲起来', back ? 'PASS' : 'FAIL(没反应)']);
        r.fsSwitch = { off: off, on: back };
      } else {
        r.steps.push(['别的程序全屏时桌宠自动隐藏',
          'SKIP(全屏窗口没抢到前台：' + (during.probe && during.probe.why) + ')']);
      }
      if (fake) { fake.destroy(); fake = null; }
      await wait(2400);
      const after = { probe: fsWatcher.probe(), petVisible: petShown() };
      r.fsAfter = after;
      if (after.probe && !after.probe.full) {
        r.steps.push(['退出全屏后桌宠回来', after.petVisible ? 'PASS' : 'FAIL(没回来)']);
      } else {
        r.steps.push(['退出全屏后桌宠回来', 'SKIP(仍有窗口盖满屏幕)']);
      }
    } catch (e) {
      if (fake) { try { fake.destroy(); } catch (_) {} }
      r.steps.push(['别的程序全屏时桌宠自动隐藏', 'FAIL(' + e.message + ')']);
    }
  } else {
    r.steps.push(['全屏检测模块可用', 'FAIL(koffi 没加载起来)']);
  }

  // 12) 关窗应该收进托盘，而不是退出应用
  mainWin.close();
  await wait(520);
  const closed = { visible: mainWin.isVisible(), destroyed: mainWin.isDestroyed(), tray: !!tray };
  r.closeToTray = closed;
  r.steps.push(['关闭收进托盘',
    (!closed.visible && !closed.destroyed && closed.tray) ? 'PASS' : 'FAIL']);
  showMain();
  await wait(420);
  r.steps.push(['能重新唤出', mainWin.isVisible() ? 'PASS' : 'FAIL']);

  /** 把结果落一份，脚本退出后还能看 */
  r.pass = r.steps.filter((s) => s[1] === 'PASS').length;
  r.total = r.steps.length;
  rep.interact = r;
}

/* 笔记页探针：看点击到底落在哪个元素上，以及桌宠窗口有没有挡住 */
async function probeNotes(rep, wait) {
  const r = {};
  await mainWin.webContents.executeJavaScript('App.go("notes"), "ok"');
  await wait(700);

  r.rows = await mainWin.webContents.executeJavaScript(
    '[].slice.call(document.querySelectorAll("#nlistBody .nrow[data-id]")).map(function (n) {' +
    ' return { id: n.dataset.id, t: n.querySelector(".nrow-title").textContent.slice(0, 14),' +
    '  folder: !!n.querySelector(".nrow-chev") }; })'
  );

  // 直接调 API 打开一篇，排除「点击路径」的问题
  const noteId = (r.rows.filter((x) => !x.folder)[0] || {}).id;
  r.directOpen = await mainWin.webContents.executeJavaScript(
    '(function () { try { Notes.openItem(' + JSON.stringify(noteId) + '); }' +
    ' catch (e) { return "THROW " + e.message; }' +
    ' return { title: document.getElementById("noteTitle").value.slice(0, 20),' +
    '  len: document.getElementById("noteBody").innerHTML.length,' +
    '  empty: document.getElementById("nmain").classList.contains("is-empty"),' +
    '  edEmpty: (function(){var n=document.getElementById("edEmpty");' +
    '    return n ? getComputedStyle(n).display + "/" + getComputedStyle(n).pointerEvents : "none"; })() }; })()'
  );

  // 点进正文并打字
  const box = await mainWin.webContents.executeJavaScript(
    '(function(){var b=document.getElementById("noteBody").getBoundingClientRect();' +
    ' return {x: Math.round(b.x + 30), y: Math.round(b.y + 30), w: Math.round(b.width), h: Math.round(b.height),' +
    '  at: (function(){var e=document.elementFromPoint(b.x+30,b.y+30); return e?(e.tagName+"#"+e.id+"."+(e.className||"")):"null";})()};})()'
  );
  r.bodyBox = box;
  const before = await mainWin.webContents.executeJavaScript('document.getElementById("noteBody").innerHTML.length');
  mainWin.webContents.sendInputEvent({ type: 'mouseDown', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  mainWin.webContents.sendInputEvent({ type: 'mouseUp', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await wait(200);
  for (const ch of 'AB') {
    mainWin.webContents.sendInputEvent({ type: 'char', keyCode: ch });
    await wait(60);
  }
  await wait(400);
  r.typing = {
    before,
    after: await mainWin.webContents.executeJavaScript('document.getElementById("noteBody").innerHTML.length'),
    text: await mainWin.webContents.executeJavaScript('document.getElementById("noteBody").innerText.slice(0, 40)'),
    active: await mainWin.webContents.executeJavaScript('document.activeElement.tagName + "#" + (document.activeElement.id || "")')
  };

  // 桌宠窗口在笔记列表位置会不会抢鼠标
  try {
    // 先把她挪到右上角：否则她的矩形可能正好盖住编辑区，
    // 量到的就是「她挡着」而不是「窗口挡着」
    await petWin.webContents.executeJavaScript(
      'Pet.walkTo(Math.round(innerWidth - 180), 40, 300), "ok"'
    );
    await wait(700);
    const wb = petWin.getContentBounds();
    const mw = mainWin.getContentBounds();
    const pt = { x: Math.round(box.x), y: Math.round(box.y) };
    fakeCursor = { x: mw.x + pt.x, y: mw.y + pt.y };
    petWin.webContents.sendInputEvent({ type: 'mouseMove', x: pt.x - wb.x, y: pt.y - wb.y });
    await wait(320);
    r.penetrateOverEditor = petPenetrate;
    r.target = pt;
  } catch (e) { r.penetrateError = String(e.message || e); }

  /* 桌宠窗口的命中判定：整屏采样，看有多少区域会吃掉点击 */
  r.hitGrid = await petWin.webContents.executeJavaScript(
    '(function () {' +
    ' var W = innerWidth, H = innerHeight, hits = [], n = 0, tot = 0;' +
    ' for (var gy = 0; gy < 24; gy++) for (var gx = 0; gx < 40; gx++) {' +
    '   var x = Math.round((gx + 0.5) * W / 40), y = Math.round((gy + 0.5) * H / 24);' +
    '   tot++; if (PetHost.hitDesktop(x, y)) { n++; hits.push([x, y]); } }' +
    ' var bb = hits.length ? { x0: Math.min.apply(null, hits.map(function(p){return p[0];})),' +
    '   x1: Math.max.apply(null, hits.map(function(p){return p[0];})),' +
    '   y0: Math.min.apply(null, hits.map(function(p){return p[1];})),' +
    '   y1: Math.max.apply(null, hits.map(function(p){return p[1];})) } : null;' +
    ' return { w: W, h: H, hits: n, total: tot, bbox: bb, menuOpen: UI.isBusy() }; })()'
  );

  /* 真实点击到底落在哪个元素上（排除坐标被 DPI 缩放） */
  await mainWin.webContents.executeJavaScript(
    'window.__lastDown = null;' +
    'document.addEventListener("pointerdown", function (e) {' +
    '  window.__lastDown = e.target.tagName + "#" + (e.target.id || "") + "." + String(e.target.className || "").slice(0, 30) +' +
    '   " @" + Math.round(e.clientX) + "," + Math.round(e.clientY);' +
    '}, true); "ok"'
  );
  const rowPt = await mainWin.webContents.executeJavaScript(
    '(function(){var n=document.querySelector("#nlistBody .nrow[data-id]:not(:has(.nrow-chev))");' +
    ' var b=n.getBoundingClientRect();' +
    ' return {x: Math.round(b.x+b.width/2), y: Math.round(b.y+b.height/2), t: n.querySelector(".nrow-title").textContent.slice(0,12)};})()'
  );
  r.rowPt = rowPt;
  mainWin.webContents.sendInputEvent({ type: 'mouseDown', x: rowPt.x, y: rowPt.y, button: 'left', clickCount: 1 });
  mainWin.webContents.sendInputEvent({ type: 'mouseUp', x: rowPt.x, y: rowPt.y, button: 'left', clickCount: 1 });
  await wait(500);
  r.lastDown = await mainWin.webContents.executeJavaScript('window.__lastDown');
  r.afterRowClick = await mainWin.webContents.executeJavaScript(
    '({ title: document.getElementById("noteTitle").value.slice(0, 16),' +
    ' empty: document.getElementById("nmain").classList.contains("is-empty"),' +
    ' dpr: window.devicePixelRatio, iw: innerWidth, ih: innerHeight })'
  );

  rep.probeNotes = r;
}

/* 笔记页的常规操作：新建 / 收藏 / 菜单，看有没有半路抛异常 */
async function probeNotesOps(rep, wait) {
  const r = {};
  const js = (code) => mainWin.webContents.executeJavaScript(code);

  r.menuTest = await js(
    '(function(){ try {' +
    '  UI.menu(document.getElementById("btnNewNote"), { items: [{label:"A"},{label:"B"}] });' +
    '  var L = document.getElementById("menuLayer");' +
    '  return { kids: L.children.length, items: L.querySelectorAll(".menu-item").length,' +
    '    cls: L.className, html: L.innerHTML.slice(0, 90) };' +
    ' } catch (e) { return "THROW " + e.message; } })()'
  );

  // 抓住事件监听器里抛的异常：这类异常不会传回 el.click() 的调用方
  await js('window.__errs = []; window.__lastClick = null;' +
    'document.addEventListener("click", function (e) {' +
    '  window.__lastClick = (e.target.id || e.target.className || e.target.tagName).toString().slice(0, 30);' +
    '}, true);' +
    'window.addEventListener("error", function (e) {' +
    '  window.__errs.push(String(e.message) + " @ " + String(e.filename || "").split("/").pop() + ":" + e.lineno);' +
    '}); "ok"');

  r.clickFlow = await js(
    '(function(){ try {' +
    '  document.getElementById("btnNewNote").click();' +
    '  return { last: window.__lastClick, errs: window.__errs.slice(0, 4),' +
    '    items: document.querySelectorAll("#menuLayer .menu-item").length };' +
    ' } catch (e) { return "THROW " + e.message; } })()'
  );

  r.created = await js(
    '(function(){ try {' +
    '  var it = [].slice.call(document.querySelectorAll("#menuLayer .menu-item"))' +
    '    .filter(function(n){return n.textContent.indexOf("新建独立笔记")>=0;})[0];' +
    '  if (!it) return "no-menu-item:" + document.querySelectorAll("#menuLayer .menu-item").length;' +
    '  it.click(); return "clicked";' +
    ' } catch (e) { return "THROW " + e.message; } })()'
  );
  await wait(500);
  r.afterCreate = await js(
    '({ title: document.getElementById("noteTitle").value,' +
    ' empty: document.getElementById("nmain").classList.contains("is-empty"),' +
    ' errs: (window.__errs || []).slice(0, 3),' +
    ' items: document.querySelectorAll("#nlistBody .nrow[data-id]").length })'
  );
  await wait(200);

  r.star = await js(
    '(function(){ try { document.getElementById("btnStar").click();' +
    ' return document.getElementById("btnStar").classList.contains("is-on"); }' +
    ' catch (e) { return "THROW " + e.message; } })()'
  );
  await wait(300);

  r.more = await js(
    '(function(){ try {' +
    '  document.getElementById("btnNoteMore").click();' +
    '  return document.querySelectorAll("#menuLayer .menu-item").length;' +
    ' } catch (e) { return "THROW " + e.message; } })()'
  );
  await wait(300);
  await js('try { UI.closeMenu(); } catch(e) {} "ok"');

  // 打开历史版本对话框（会新建 modal，容易在某些状态炸）
  r.versions = await js(
    '(function(){ try {' +
    '  var m=[].slice.call(document.querySelectorAll("#menuLayer .menu-item"))' +
    '    .filter(function(n){return n.textContent.indexOf("历史版本")>=0;})[0];' +
    '  return m ? "had-menu" : "menu-closed";' +
    ' } catch (e) { return "THROW " + e.message; } })()'
  );

  rep.probeOps = r;
}

/* ------------------------------------------------------------
   生命周期
   ------------------------------------------------------------ */
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMain());

  app.whenReady().then(() => {
    app.setAppUserModelId('com.zizai.jiyi');
    // 桌面小工具不需要 File/Edit 那一排菜单；去掉后 Alt 也不会弹出灰条
    Menu.setApplicationMenu(null);
    initStorage();
    bindIpc();

    mainWin = createMainWin();
    petWin = createPetWin();
    createTray();
    startFullscreenWatch();
    startPetPenetrateWatch();

    // 渲染进程真的出问题时不能让她变成一张点不动的贴纸
    petWin.webContents.on('render-process-gone', (e, d) => {
      log('桌宠渲染进程退出：' + (d && d.reason));
      setTimeout(() => reloadPetWindow('渲染进程退出'), 600);
    });
    petWin.webContents.on('unresponsive', () => log('桌宠页面无响应，等命中区域心跳超时后重载'));

    // 分辨率 / 缩放变化，以及锁屏唤醒、休眠恢复之后，
    // 窗口的位置、置顶层、穿透样式都可能被系统重置，统一摆正一次
    const onDisplayChange = () => {
      if (petWin && petWin._rebindDisplay) petWin._rebindDisplay();
      resetPetWindow();
    };
    screen.on('display-metrics-changed', onDisplayChange);
    screen.on('display-added', onDisplayChange);
    screen.on('display-removed', onDisplayChange);
    powerMonitor.on('resume', () => { log('系统恢复'); resetPetWindow(); });
    powerMonitor.on('unlock-screen', () => { log('解锁'); resetPetWindow(); });

    // 主窗口被隐藏时桌宠继续活着；主窗口真正关闭时由 close 事件决定是否退出
    app.on('activate', () => showMain());

    // 每小时检查一次「隐藏一会儿」是否到期
    setInterval(() => syncPetWindow(), 60 * 1000);

    // 冒烟测试：--smoke 时把两个窗口各截一张图再退出，用来在无人工介入下验收渲染
    if (process.argv.indexOf('--smoke') >= 0) runSmoke();

    // README 展示图：--shots 走真实桌面窗口拍各功能页，脚本只在开发目录里，不进发布包
    if (SHOTS) {
      const mod = path.join(ROOT, 'tools', 'shots.js');
      if (fs.existsSync(mod)) {
        try { require(mod)({ mainWin, petWin, log }); }
        catch (e) { log('截图脚本启动失败：' + e.message); app.quit(); }
      } else { log('找不到 tools/shots.js'); app.quit(); }
    }

    // 开发用诊断：--diag-idle 每 20 秒在系统层面发一次真实点击，
    // 验证桌宠窗口长期运行后还接不接受鼠标（打包版不含 tools/，会直接跳过）
    if (DIAG) {
      const arg = process.argv.find((a) => a.indexOf('--diag-min=') === 0);
      const mins = arg ? Number(arg.split('=')[1]) || 4 : 4;
      const mod = path.join(ROOT, 'tools', 'diag-idle.js');
      if (fs.existsSync(mod)) {
        try {
          require(mod)({
            petWin, log, minutes: mins,
            getPen: () => petPenetrate,
            getHold: () => petHoldActive,
            noCycle: process.argv.indexOf('--diag-no-cycle') >= 0,
            rawCycle: process.argv.indexOf('--diag-raw-cycle') >= 0,
            restore: () => syncPetWindow(),
            setSuppress: (on) => { fsSuppress = !!on; syncPetWindow(); },
            done: () => quitApp()
          });
        } catch (e) { log('诊断启动失败：' + e.message); quitApp(); }
      } else {
        log('诊断模块不存在，按普通模式启动');
      }
    }
  });

  app.on('window-all-closed', () => {
    // 托盘常驻：不跟着窗口一起退
    if (process.platform !== 'darwin' && quitting) app.quit();
  });

  app.on('before-quit', () => {
    quitting = true;
  });

  app.on('will-quit', () => {
    if (fsWatcher) fsWatcher.stop();
    if (penWatch) clearInterval(penWatch);
    penWatch = null;
    if (storage) storage.close();
  });
}
