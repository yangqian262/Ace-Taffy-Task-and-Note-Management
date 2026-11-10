/* 桌宠窗口 preload */
'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petHost', {
  loadSync() { return ipcRenderer.sendSync('store:load'); },
  patch(p) { return ipcRenderer.sendSync('store:patch', p); },
  // 页面只上报「哪些矩形能点、有没有按住」，穿不穿透由主进程自己算
  geo(g) { ipcRenderer.send('pet:geo', g); },
  // 按下 / 抬手的快通道：不等 120ms 的几何轮询，立刻独占鼠标
  hold(on) { ipcRenderer.send('pet:hold', !!on); },
  mainGo(view) { ipcRenderer.send('nav:request', String(view || 'todo')); },

  // 主进程通知「收起 / 恢复」：窗口本身不隐藏，只是页面变透明
  onSuppress(fn) {
    const h = (_e, on) => fn(!!on);
    ipcRenderer.on('pet:suppress', h);
    return () => ipcRenderer.removeListener('pet:suppress', h);
  },

  onChanged(fn) {
    const h = (_e, payload) => fn(payload);
    ipcRenderer.on('store:changed', h);
    return () => ipcRenderer.removeListener('store:changed', h);
  },
  onInvoke(fn) {
    const h = (_e, msg) => fn(msg);
    ipcRenderer.on('pet:invoke', h);
    return () => ipcRenderer.removeListener('pet:invoke', h);
  },
  onFlow(fn) {
    const h = (_e, on) => fn(!!on);
    ipcRenderer.on('pet:flow', h);
    return () => ipcRenderer.removeListener('pet:flow', h);
  }
});
