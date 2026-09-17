'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const db = new Database(path.join(DATA_DIR, 'license.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS keys (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL UNIQUE,
  remark     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'active',        -- active | revoked
  expires_at TEXT,                                   -- ISO string or NULL (永不过期)
  device_id  TEXT,                                   -- 首次校验绑定的设备
  last_seen  TEXT,                                   -- 最后一次校验(打开软件)时间
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE IF NOT EXISTS logs (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  key        TEXT NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  device_id  TEXT NOT NULL DEFAULT '',
  result     TEXT NOT NULL,                          -- ok | 错误码
  message    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcements (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  content       TEXT NOT NULL,
  link_url      TEXT NOT NULL DEFAULT '',          -- 可选,客户端用默认浏览器打开
  target_type   TEXT NOT NULL DEFAULT 'all',       -- all | device
  target_device TEXT NOT NULL DEFAULT '',          -- 旧字段,单设备;已由 targets 表取代
  publish_at    TEXT NOT NULL,                     -- ISO UTC,到点后客户端可见(定时发送)
  ended_at      TEXT,                              -- 结束时间;非空表示已结束,不再对用户可见
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS announcement_targets (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  announcement_id INTEGER NOT NULL REFERENCES announcements(id) ON DELETE CASCADE,
  device_id      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_keys_status ON keys(status);
CREATE INDEX IF NOT EXISTS idx_ann_publish ON announcements(publish_at);
CREATE INDEX IF NOT EXISTS idx_ann_target ON announcements(target_type, target_device);
CREATE INDEX IF NOT EXISTS idx_ann_tg_ann ON announcement_targets(announcement_id);
CREATE INDEX IF NOT EXISTS idx_ann_tg_dev ON announcement_targets(device_id);
CREATE INDEX IF NOT EXISTS idx_logs_key ON logs(key);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_ip ON logs(ip);
`);

const cols = db.prepare('PRAGMA table_info(keys)').all();
if (!cols.some((c) => c.name === 'last_seen')) {
  db.exec(`ALTER TABLE keys ADD COLUMN last_seen TEXT`);
}

const annCols = db.prepare('PRAGMA table_info(announcements)').all();
if (!annCols.some((c) => c.name === 'ended_at')) {
  db.exec(`ALTER TABLE announcements ADD COLUMN ended_at TEXT`);
}

// 旧的单设备定向公告迁移到 targets 表
db.exec(
  `INSERT INTO announcement_targets (announcement_id, device_id)
   SELECT id, target_device FROM announcements
   WHERE target_type = 'device' AND target_device != ''
     AND id NOT IN (SELECT announcement_id FROM announcement_targets)`
);

module.exports = db;