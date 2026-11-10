/* ============================================================
   桌宠窗口的启动脚本
   放在 pet.js 之后：pet.js 只定义方法，init 由这里触发。
   ============================================================ */
(function () {
  'use strict';

  if (!window.petHost || !window.Pet) return;

  const el = document.getElementById('pet');

  // 拖拽期间必须独占鼠标：不然指针一离开她的矩形，穿透就打开，
  // 拖到一半会突然「松手」，她卡在原地而鼠标已经点在下面的窗口上。
  if (el) {
    el.addEventListener('pointerdown', () => window.petHold && window.petHold(true), true);
  }
  window.addEventListener('pointerup', () => window.petHold && window.petHold(false), true);
  window.addEventListener('pointercancel', () => window.petHold && window.petHold(false), true);
  // 捕获被系统收走（Alt+Tab、弹窗抢焦点）时也要解锁，否则窗口一直不穿透
  window.addEventListener('lostpointercapture', () => window.petHold && window.petHold(false), true);

  Pet.init();
})();
