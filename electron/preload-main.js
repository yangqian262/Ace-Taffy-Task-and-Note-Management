/* 主窗口 preload：只暴露必要的桥，不把 node 交给页面 */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('host', {
  isDesktop: true,
  platform: process.platform,
  versions: {
    electron: process.versions.electron,
    node: process.versions.node,
    chrome: process.versions.chrome
  },

  /* 数据：同步读取（启动一次），写入走同步确认 */
  loadSync() { return ipcRenderer.sendSync('store:load'); },
  saveSync(json) { return ipcRenderer.sendSync('store:save', json); },
  patch(p) { return ipcRenderer.sendSync('store:patch', p); },
  info() { return ipcRenderer.sendSync('store:info'); },

  /* 另一个窗口（桌宠）改了数据时收到 */
  onChanged(fn) {
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on('store:changed', h);
    return () => ipcRenderer.removeListener('store:changed', h);
  },

  /* 桌宠 */
  petInvoke(fn, args) { return ipcRenderer.invoke('pet:invoke', fn, args); },
  petSync() { return ipcRenderer.invoke('pet:sync'); },

  /* 系统 */
  setAutoStart(on) { return ipcRenderer.invoke('sys:autoStart', on); },
  getAutoStart() { return ipcRenderer.invoke('sys:autoStart:get'); },
  openDataDir() { return ipcRenderer.invoke('sys:openDataDir'); },
  dataDir() { return ipcRenderer.invoke('sys:dataDir'); },
  chooseDataDir() { return ipcRenderer.invoke('sys:chooseDataDir'); },
  migrateDataDir(dir, opts) { return ipcRenderer.invoke('sys:migrateDataDir', dir, opts); },
  exportData() { return ipcRenderer.invoke('sys:export'); },

  /* 心流状态同步给桌宠窗口 */
  flowState(on) { ipcRenderer.send('flow:state', on ? 1 : 0); },

  /* 主进程要求切换页面（托盘菜单等） */
  onNavigate(fn) {
    const h = (_e, view) => fn(view);
    ipcRenderer.on('nav', h);
    return () => ipcRenderer.removeListener('nav', h);
  }
});
