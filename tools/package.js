/* ============================================================
   打包成便携版：把 Electron 运行时和源码拼成一个可直接双击的目录
   用法：node tools/package.js
   产物：release/自在极意/自在极意.exe
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'release', '自在极意');
const DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const APP_NAME = '自在极意';

/* 只带运行需要的东西；assets/pet/_tools 是素材生成脚本，不进包
   node_modules 只带 koffi（全屏检测用的 FFI）和它的平台二进制，
   千万别整个 node_modules 拷进去 —— 那里面是 electron 运行时本体 */
const COPY = [
  'index.html',
  'pet.html',
  'package.json',
  'css',
  'js',
  'electron',
  'assets/pet',
  'assets/icon',
  'node_modules/koffi',
  'node_modules/@koromix'
];

const SKIP_DIR = new Set(['_tools', '__pycache__']);

const TRASH = path.join(ROOT, '.pkg-trash');

/* 有的环境把 fs.rmSync / unlinkSync 换成了「移到回收站」，
   对打包产物这种体量会失败。统一改成改名挪走，快且不会被拦。 */
function discard(p) {
  if (!fs.existsSync(p)) return;
  try {
    fs.mkdirSync(TRASH, { recursive: true });
    const dst = path.join(TRASH, path.basename(p) + '-' + Date.now());
    fs.renameSync(p, dst);
  } catch (e) {
    console.warn('  无法挪走 ' + p + '：' + e.message);
  }
}

/* 目录整个挪不走时（里面有被系统句柄锁住的文件），退化成逐项清空：
   能挪走的挪走，锁住的留下，至少不会把上一版的旧源码混进来。 */
function clearDir(dir) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const n of names) {
    const p = path.join(dir, n);
    let st;
    try { st = fs.statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) {
      clearDir(p);
      try { fs.rmdirSync(p); } catch (_) {}
    } else {
      discard(p);
    }
  }
}

function rmrf(p) {
  if (!fs.existsSync(p)) return;
  discard(p);
  if (fs.existsSync(p)) clearDir(p);
}

function safeUnlink(p) {
  discard(p);
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (SKIP_DIR.has(name)) continue;
    // Electron 自带的示例应用：我们自带 resources/app，它不会被加载。
    // 少数机器上这个文件被系统句柄锁住，既删不掉也覆盖不了，直接不复制。
    if (name === 'default_app.asar') continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    const st = fs.statSync(s);
    if (st.isDirectory()) copyDir(s, d);
    else {
      try {
        fs.copyFileSync(s, d);
      } catch (e) {
        // 上一版留下的运行时文件偶尔被系统句柄锁住（Defender / 索引 / 刚退出的进程），
        // 既删不掉也覆盖不了。它和源文件来自同一个 dist、大小一致，沿用即可。
        let same = false;
        try { same = fs.statSync(d).size === st.size; } catch (_) {}
        if (!same) throw e;
      }
    }
  }
}

async function main() {
  if (!fs.existsSync(DIST)) {
    console.error('没找到 Electron 运行时，先跑一次 npm install');
    process.exit(1);
  }

  console.log('清理', OUT);
  rmrf(OUT);
  fs.mkdirSync(OUT, { recursive: true });

  console.log('复制 Electron 运行时…');
  copyDir(DIST, OUT);

  // 只留中英文本地化包，其余几十个语言包纯占体积
  const loc = path.join(OUT, 'locales');
  if (fs.existsSync(loc)) {
    for (const f of fs.readdirSync(loc)) {
      if (!/^(zh-CN|zh-TW|en-US|en-GB)\.pak$/.test(f)) {
        safeUnlink(path.join(loc, f));
      }
    }
  }

  const appDir = path.join(OUT, 'resources', 'app');
  fs.mkdirSync(appDir, { recursive: true });

  console.log('复制应用源码…');
  for (const rel of COPY) {
    const s = path.join(ROOT, rel);
    if (!fs.existsSync(s)) { console.warn('  跳过（不存在）', rel); continue; }
    const d = path.join(appDir, rel);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else {
      fs.mkdirSync(path.dirname(d), { recursive: true });
      fs.copyFileSync(s, d);
    }
  }

  // 去掉 Electron 自带的示例应用，否则可能被优先加载
  const defApp = path.join(OUT, 'resources', 'default_app.asar');
  if (fs.existsSync(defApp)) safeUnlink(defApp);

  // 上一次冒烟测试留在 app 目录里的截图、报告和一次性数据目录不要带出去。
  // 它们含测试用的待办/笔记，甚至一个指向临时目录的 location.json，
  // 打进分发包既占体积，又容易让人误以为是真实数据。
  for (const name of fs.readdirSync(appDir)) {
    if (/^_shot_.*\.png$/.test(name) || /^_smoke-data/.test(name) ||
        name === '_smoke.json' || name === '_st.html') {
      rmrf(path.join(appDir, name));
    }
  }

  // 运行时不需要 devDependencies，把 package.json 精简一份
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  delete pkg.devDependencies;
  delete pkg.scripts;
  pkg.main = 'electron/main.js';
  fs.writeFileSync(path.join(appDir, 'package.json'), JSON.stringify(pkg, null, 2));

  // 改名 + 尝试换图标
  const exeOld = path.join(OUT, 'electron.exe');
  const exeNew = path.join(OUT, APP_NAME + '.exe');
  if (fs.existsSync(exeOld)) {
    fs.renameSync(exeOld, exeNew);
  }
  const ico = path.join(OUT, 'resources', 'app', 'assets', 'icon', 'app.ico');
  await setExeIcon(exeNew, ico);

  // 留一份说明。分发给别人时这份文件就是「安装说明」，得写准：
  // 绿色版数据默认在 exe 旁边的 data/，不是 %APPDATA%。
  fs.writeFileSync(path.join(OUT, '使用说明.txt'),
    APP_NAME + ' · 绿色版 v1.0.0\r\n' +
    '=====================================\r\n\r\n' +
    '【怎么运行】\r\n' +
    '把整个文件夹解压到任意位置，双击「' + APP_NAME + '.exe」即可，\r\n' +
    '不需要安装、不写注册表。建议不要解压到 C:\\Program Files 里。\r\n' +
    '注意：exe 必须和旁边的 resources 文件夹、各种 .dll 放在一起，\r\n' +
    '单独把 exe 拷出来是跑不起来的。路径带中文没问题。\r\n\r\n' +
    '【数据存在哪】\r\n' +
    '默认放在本文件夹的 data\\ 子目录，跟着整个文件夹走。\r\n' +
    '也可以在「设置 → 数据目录」里换到任意盘，\r\n' +
    '这个位置记在 %APPDATA%\\' + APP_NAME + '\\location.json。\r\n' +
    '每天首次启动自动备份到数据目录的 backup\\，保留最近 7 份。\r\n' +
    '卸载：删掉整个文件夹即可；要连数据一起清空，再删 data\\ 和上面的 %APPDATA% 目录。\r\n\r\n' +
    '【首次运行提示】\r\n' +
    'Windows 可能弹「已保护你的电脑」，点「更多信息 → 仍要运行」即可。\r\n' +
    '这是因为没有购买代码签名证书，不是病毒，也不影响使用。\r\n\r\n' +
    '托盘图标在右下角，关闭窗口默认收进托盘，右键托盘可以退出。\r\n',
    'utf8');

  const size = dirSize(OUT);
  console.log('完成：' + exeNew);
  console.log('体积：' + (size / 1024 / 1024).toFixed(0) + ' MB');
}

/* 改 exe 的图标和产品名。没有 rcedit 就跳过 —— 不影响运行 */
function setExeIcon(exe, ico) {
  let rcedit;
  try {
    rcedit = require('rcedit').rcedit;   // v5 是 ESM 转出来的具名导出
  } catch (e) {
    console.log('（未安装 rcedit，exe 图标保持 Electron 默认；窗口和托盘图标仍是自己的）');
    return null;
  }
  if (!fs.existsSync(ico)) return null;
  return rcedit(exe, {
    icon: ico,
    'version-string': {
      ProductName: APP_NAME,
      FileDescription: APP_NAME,
      CompanyName: APP_NAME,
      OriginalFilename: APP_NAME + '.exe',
      InternalName: APP_NAME
    },
    'file-version': '1.0.0.0',
    'product-version': '1.0.0.0'
  }).then(() => console.log('已写入 exe 图标与版本信息'))
    .catch((e) => console.log('写图标失败（不影响运行）：' + e.message));
}

function dirSize(p) {
  let n = 0;
  for (const name of fs.readdirSync(p)) {
    const s = path.join(p, name);
    const st = fs.statSync(s);
    n += st.isDirectory() ? dirSize(s) : st.size;
  }
  return n;
}

main();
