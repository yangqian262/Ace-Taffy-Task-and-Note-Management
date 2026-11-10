/* ============================================================
   自在极意 · 主进程数据层

   两个后端：
     sqlite  better-sqlite3，单表 KV（state），WAL 模式
     json    原子写 + .bak 轮换（原生模块加载失败时的兜底）

   对外只有 load / save / info / backup / exportTo / importFrom
   —— 渲染进程不关心底层是哪个。
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');

const KEY = 'zizai.jiyi.v3';
const KEEP_BACKUPS = 7;

class Storage {
  constructor(dir, log) {
    this.dir = dir;
    this.log = log || (() => {});
    this.backend = 'none';
    this.db = null;
    this.jsonPath = path.join(dir, 'data.json');
    this.dbPath = path.join(dir, 'data.db');
    this.backupDir = path.join(dir, 'backup');
    this.dirty = false;
    this.lastError = null;

    ensureDir(dir);
    ensureDir(this.backupDir);
    this._open();
  }

  /* ---------------- 打开 ---------------- */
  _open() {
    if (this._openSqlite()) return;
    this._openJson();
  }

  _openSqlite() {
    let Database = null;
    try {
      Database = require('better-sqlite3');
    } catch (e) {
      // 常见于：原生模块没按 Electron ABI 重编译
      this.log('better-sqlite3 不可用，改用 JSON 存储：' + e.message);
      return false;
    }
    try {
      this.db = new Database(this.dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('synchronous = FULL');
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS state (' +
        '  key TEXT PRIMARY KEY,' +
        '  json TEXT NOT NULL,' +
        '  updated_at INTEGER NOT NULL' +
        ')'
      );
      this.db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)');
      this.backend = 'sqlite';
      return true;
    } catch (e) {
      this.lastError = e;
      this.log('SQLite 打开失败，改用 JSON 存储：' + e.message);
      try { if (this.db) this.db.close(); } catch (_) {}
      this.db = null;
      return false;
    }
  }

  _openJson() {
    this.backend = 'json';
    // JSON 一侧若已有数据，直接沿用；没有就从 sqlite 迁移过来
    if (!fs.existsSync(this.jsonPath) && fs.existsSync(this.dbPath)) {
      this.log('检测到 data.db，但 SQLite 不可用，跳过迁移');
    }
  }

  /* ---------------- 读 ---------------- */
  load() {
    try {
      if (this.backend === 'sqlite') {
        const row = this.db.prepare('SELECT json FROM state WHERE key = ?').get(KEY);
        if (!row) return this._loadLegacy();
        return JSON.parse(row.json);
      }
      if (!fs.existsSync(this.jsonPath)) return this._loadLegacy();
      const raw = fs.readFileSync(this.jsonPath, 'utf8');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      this.lastError = e;
      this.log('读取失败：' + e.message);
      // 主文件坏了就退到 .bak，别让用户看到空白应用
      return this._loadBak();
    }
  }

  _loadBak() {
    const bak = this.jsonPath + '.bak';
    try {
      if (fs.existsSync(bak)) {
        this.log('主数据损坏，已回退到 .bak');
        return JSON.parse(fs.readFileSync(bak, 'utf8'));
      }
    } catch (_) {}
    return null;
  }

  /** 首次运行：把渲染进程 localStorage 里的旧数据导进来 */
  _loadLegacy() {
    return null;
  }

  /* ---------------- 写 ---------------- */
  save(obj) {
    const text = JSON.stringify(obj);
    const at = Date.now();
    try {
      if (this.backend === 'sqlite') {
        this.db.prepare(
          'INSERT INTO state (key, json, updated_at) VALUES (?, ?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at'
        ).run(KEY, text, at);
        return true;
      }
      // JSON：先写临时文件，fsync 后 rename —— 断电也不会得到半截文件
      const tmp = this.jsonPath + '.tmp';
      const fd = fs.openSync(tmp, 'w');
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      if (fs.existsSync(this.jsonPath)) {
        try { fs.copyFileSync(this.jsonPath, this.jsonPath + '.bak'); } catch (_) {}
      }
      fs.renameSync(tmp, this.jsonPath);
      return true;
    } catch (e) {
      this.lastError = e;
      this.log('写入失败：' + e.message);
      return false;
    }
  }

  /* ---------------- 元信息 ---------------- */
  info() {
    return {
      backend: this.backend,
      dir: this.dir,
      dbPath: this.dbPath,
      jsonPath: this.jsonPath,
      backupDir: this.backupDir,
      error: this.lastError ? String(this.lastError.message || this.lastError) : null
    };
  }

  /* ---------------- 备份 ---------------- */
  /** 每天首次启动备一份，保留最近 N 份 */
  dailyBackup() {
    try {
      if (this.backend === 'sqlite') {
        this.db.pragma('wal_checkpoint(TRUNCATE)');
        const stamp = dayKey();
        const dst = path.join(this.backupDir, 'data-' + stamp + '.db');
        if (fs.existsSync(dst)) return null;
        if (!fs.existsSync(this.dbPath)) return null;
        fs.copyFileSync(this.dbPath, dst);
        prune(this.backupDir, KEEP_BACKUPS);
        return dst;
      }
      if (!fs.existsSync(this.jsonPath)) return null;
      const dst = path.join(this.backupDir, 'data-' + dayKey() + '.json');
      if (fs.existsSync(dst)) return null;
      fs.copyFileSync(this.jsonPath, dst);
      prune(this.backupDir, KEEP_BACKUPS);
      return dst;
    } catch (e) {
      this.log('备份失败：' + e.message);
      return null;
    }
  }

  listBackups() {
    try {
      return fs.readdirSync(this.backupDir)
        .filter((f) => /^data-.*\.(db|json)$/.test(f))
        .map((f) => {
          const p = path.join(this.backupDir, f);
          const st = fs.statSync(p);
          return { name: f, path: p, size: st.size, at: st.mtimeMs };
        })
        .sort((a, b) => b.at - a.at);
    } catch (_) {
      return [];
    }
  }

  /** 导出：SQLite 直接给 .db 副本，JSON 给 .json */
  exportTo(destDir) {
    const stamp = dayKey();
    const now = new Date();
    const hm = String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    if (this.backend === 'sqlite') {
      this.db.pragma('wal_checkpoint(TRUNCATE)');
      const dst = path.join(destDir, '自在极意_' + stamp + '_' + hm + '.db');
      fs.copyFileSync(this.dbPath, dst);
      return dst;
    }
    this.save(this.load() || {});
    const dst = path.join(destDir, '自在极意_' + stamp + '_' + hm + '.json');
    fs.copyFileSync(this.jsonPath, dst);
    return dst;
  }

  close() {
    try { if (this.db) this.db.close(); } catch (_) {}
    this.db = null;
  }
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
}

function dayKey() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth() + 1).padStart(2, '0') + '-' +
    String(d.getDate()).padStart(2, '0');
}

function prune(dir, keep) {
  try {
    const files = fs.readdirSync(dir)
      .filter((f) => /^data-.*\.(db|json)$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    files.slice(keep).forEach((x) => {
      try { fs.unlinkSync(path.join(dir, x.f)); } catch (_) {}
    });
  } catch (_) {}
}

module.exports = { Storage, KEY };
