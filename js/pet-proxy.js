/* ============================================================
   自在极意 · 主窗口里的桌宠代理

   桌面版桌宠住在独立的透明置顶窗口里，主窗口不该再画一只。
   但 todo.js / settings.js / app.js 仍会调 Pet.celebrate() 之类，
   所以这里把 window.Pet 换成一个转发器：所有调用原样送给桌宠窗口执行。
   ============================================================ */
(function (global) {
  'use strict';

  const host = global.host;
  if (!host || !host.petInvoke) return;

  const APIS = [
    'setExpr', 'celebrate', 'expressRandom', 'checkOverdue',
    'onFlowStart', 'onFlowEnd', 'comeHere', 'toggleFollow', 'setFollow',
    'setVisible', 'setSize', 'hideFor', 'quit', 'emote',
    'walkTo', 'strideTo', 'sleep', 'wake', 'pat'
  ];

  const P = { installed: true, isProxied: true };

  APIS.forEach((fn) => {
    P[fn] = function () {
      const args = Array.prototype.slice.call(arguments);
      // 返回值是 Promise，调用方目前都不依赖同步结果
      return host.petInvoke(fn, args).catch(() => false);
    };
  });

  // 主窗口不渲染桌宠：init 是空实现，避免和独立窗口抢素材与计时器
  P.init = function () {};
  P.mood = function () {
    const st = global.Store && Store.data && Store.data.settings;
    return (st && typeof st.petMood === 'number') ? st.petMood : 74;
  };
  P.emote = function () { return host.petInvoke('emote', []); };

  global.Pet = P;
  global.PetProxy = P;
})(window);
