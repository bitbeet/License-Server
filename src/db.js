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

CREATE INDEX IF NOT EXISTS idx_keys_status ON keys(status);
CREATE INDEX IF NOT EXISTS idx_logs_key ON logs(key);
CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at);
CREATE INDEX IF NOT EXISTS idx_logs_ip ON logs(ip);
`);

const cols = db.prepare('PRAGMA table_info(keys)').all();
if (!cols.some((c) => c.name === 'last_seen')) {
  db.exec(`ALTER TABLE keys ADD COLUMN last_seen TEXT`);
}

module.exports = db;