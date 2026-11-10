/* ============================================================
   生成 README 展示图（仅开发用，不进发布包）
   用法：node_modules/electron/dist/electron.exe . --shots
   产物：docs/screenshots/*.png
   由 electron/main.js 在 --shots 时调用；跑的是真实桌面版窗口，
   数据落在一次性目录 _shots-data/，不碰用户数据。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const { app, nativeImage } = require('electron');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'screenshots');

/* 透明桌宠窗口截出来是一整块屏幕，角色只占一小块。
   按 alpha 找非透明像素的边界自动裁切，比写死坐标可靠。 */
function cropSubject(png, pad) {
  let img = nativeImage.createFromBuffer(png);
  const size = img.getSize();
  const bmp = img.toBitmap();          // BGRA
  let minX = size.width, minY = size.height, maxX = -1, maxY = -1;
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const i = (y * size.width + x) * 4;
      const a = bmp[i + 3];
      const b = bmp[i], g = bmp[i + 1], r = bmp[i + 2];
      // 两种背景都兼容：真透明(alpha=0) 或 截图时被拍成纯白
      if (a < 8) continue;
      if (r > 246 && g > 246 && b > 246) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return img;            // 没找到主体，原样返回
  minX = Math.max(0, minX - pad);
  minY = Math.max(0, minY - pad);
  maxX = Math.min(size.width, maxX + pad);
  maxY = Math.min(size.height, maxY + pad);
  // 留一点四周呼吸空间，同时别让画布比例太扁
  const w = maxX - minX, h = maxY - minY;
  const side = Math.max(w, h, 420);
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const rect = {
    x: Math.max(0, Math.min(size.width - side, Math.round(cx - side / 2))),
    y: Math.max(0, Math.min(size.height - side, Math.round(cy - side / 2))),
    width: Math.min(side, size.width),
    height: Math.min(side, size.height)
  };
  return img.crop(rect);
}

module.exports = function shots({ mainWin, petWin, log }) {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const run = (w, code) => w.webContents.executeJavaScript(code).catch(() => null);
  const shot = async (w, name) => {
    const png = (await w.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(OUT, name + '.png'), png);
    log('  截图', name);
  };

  (async () => {
    try {
      fs.mkdirSync(OUT, { recursive: true });
      await wait(3800);                       // 等两个窗口和示例数据都就绪
      await run(mainWin, 'mainWinProbe = 1'); // 触发一次渲染进程通信
      mainWin.setSize(1120, 840);
      mainWin.center();
      await wait(900);

      // 1. 待办：默认页，含「正在办理 / 待办事项 / 超时提醒」
      await run(mainWin, 'App.go("todo"); "ok"');
      await wait(650);
      await shot(mainWin, '01-todo');

      // 2. 笔记：进页面后点开第一篇，展示列表 + 正文
      await run(mainWin, 'App.go("notes"); "ok"');
      await wait(600);
      await run(mainWin,
        'var r=document.querySelector(".nrow[data-id]"); if(r) r.click(); "ok"');
      await wait(800);
      await shot(mainWin, '02-notes');

      // 3. 心流模式：只留当前在做的事
      await run(mainWin, 'App.go("todo"); "ok"');
      await wait(450);
      await run(mainWin, 'Todo.enterFlow(); "ok"');
      await wait(3400);                      // 过场动画 + 底部入场提示都走完
      await shot(mainWin, '03-flow');
      await run(mainWin, 'Todo.exitFlow(true); "ok"');
      await wait(450);

      // 4. 设置：滚回顶部，展示主题 / 桌宠 / 数据分组
      await run(mainWin, 'App.go("settings"); "ok"');
      await wait(650);
      await run(mainWin,
        'document.querySelectorAll(".view, #settingsBody, #views").forEach(function(e){e.scrollTop=0});' +
        'window.scrollTo(0,0); "ok"');
      await wait(500);
      await shot(mainWin, '04-settings');

      // 5. 桌宠：透明置顶窗口里真实渲染的角色，自动裁切主体
      const petPng = (await petWin.webContents.capturePage()).toPNG();
      const cropped = cropSubject(petPng, 70);
      fs.writeFileSync(path.join(OUT, '05-pet.png'), cropped.toPNG());
      log('  截图 05-pet');

      log('展示图已写入 ' + OUT);
    } catch (e) {
      log('生成展示图失败：' + (e && e.message));
    }
    setTimeout(() => app.quit(), 300);
  })();
};
