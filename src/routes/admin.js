'use strict';

const express = require('express');
const db = require('../db');
const { generateKey } = require('../lib/keys');
const auth = require('../middleware/auth');

const router = express.Router();

const KEY_DETAILS = `
  SELECT k.*,
    (SELECT COUNT(*) FROM logs l WHERE l.key = k.key) AS log_count
  FROM keys k
`;

function uniqueKey() {
  for (let i = 0; i < 10; i++) {
    const k = generateKey();
    const exists = db.prepare('SELECT 1 FROM keys WHERE key = ?').get(k);
    if (!exists) return k;
  }
  throw new Error('无法生成唯一验证码');
}

router.post('/login', (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password !== auth.PASSWORD) {
    return res.status(401).json({ ok: false, error: 'BAD_PASSWORD', message: '密码错误' });
  }
  const token = auth.createSession();
  res.setHeader('Set-Cookie', auth.cookieHeader(token));
  return res.json({ ok: true });
});

router.post('/logout', auth.requireAuth, (req, res) => {
  const m = (req.headers.cookie || '').match(/(?:^|;\s*)lic_admin=([^;]+)/);
  if (m) auth.destroySession(m[1]);
  res.setHeader('Set-Cookie', auth.clearCookieHeader());
  res.json({ ok: true });
});

router.post('/keys', auth.requireAuth, (req, res) => {
  const { remark, expires_at } = req.body || {};
  let key;
  try {
    key = uniqueKey();
  } catch (err) {
    return res.status(500).json({ ok: false, error: 'INTERNAL', message: err.message });
  }
  let expires = null;
  if (typeof expires_at === 'string' && expires_at) {
    const t = new Date(expires_at).getTime();
    if (Number.isNaN(t)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'expires_at 格式无效' });
    }
    expires = new Date(t).toISOString();
  }
  const info = db
    .prepare('INSERT INTO keys (key, remark, expires_at) VALUES (?, ?, ?)')
    .run(key, typeof remark === 'string' ? remark.trim() : '', expires);
  const row = db.prepare('SELECT * FROM keys WHERE id = ?').get(info.lastInsertRowid);
  res.json({ ok: true, data: row });
});

router.get('/keys', auth.requireAuth, (req, res) => {
  const rows = db.prepare(`${KEY_DETAILS} ORDER BY k.id DESC`).all();
  res.json({ ok: true, data: rows });
});

router.patch('/keys/:id', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM keys WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '验证码不存在' });

  const { status, remark, expires_at, unbind_device } = req.body || {};

  if (status !== undefined) {
    if (!['active', 'revoked'].includes(status)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'status 无效' });
    }
    if (status === 'revoked') {
      db.prepare('UPDATE keys SET status = ?, revoked_at = datetime(\'now\') WHERE id = ?').run(status, id);
    } else {
      db.prepare('UPDATE keys SET status = ?, revoked_at = NULL WHERE id = ?').run(status, id);
    }
  }

  if (remark !== undefined) {
    db.prepare('UPDATE keys SET remark = ? WHERE id = ?').run(typeof remark === 'string' ? remark.trim() : '', id);
  }

  if (expires_at !== undefined) {
    let expires = null;
    if (typeof expires_at === 'string' && expires_at) {
      const t = new Date(expires_at).getTime();
      if (Number.isNaN(t)) {
        return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'expires_at 格式无效' });
      }
      expires = new Date(t).toISOString();
    }
    db.prepare('UPDATE keys SET expires_at = ? WHERE id = ?').run(expires, id);
  }

  if (unbind_device === true) {
    db.prepare('UPDATE keys SET device_id = NULL WHERE id = ?').run(id);
  }

  const updated = db.prepare(`${KEY_DETAILS} WHERE k.id = ?`).get(id);
  res.json({ ok: true, data: updated });
});

router.delete('/keys/:id', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const info = db.prepare('DELETE FROM keys WHERE id = ?').run(id);
  if (info.changes === 0) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '验证码不存在' });
  }
  res.json({ ok: true });
});

router.get('/logs', auth.requireAuth, (req, res) => {
  const { key = '', ip = '', result = '', limit = '100' } = req.query;
  const lim = Math.min(Math.max(parseInt(limit, 10) || 100, 1), 500);

  const conds = [];
  const params = [];
  if (key) {
    conds.push('l.key = ?');
    params.push(String(key).toUpperCase());
  }
  if (ip) {
    conds.push('l.ip LIKE ?');
    params.push(`%${ip}%`);
  }
  if (result) {
    conds.push('l.result = ?');
    params.push(String(result));
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  params.push(lim);

  const rows = db
    .prepare(`SELECT l.* FROM logs l ${where} ORDER BY l.id DESC LIMIT ?`)
    .all(...params);
  res.json({ ok: true, data: rows });
});

router.get('/stats', auth.requireAuth, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) AS n FROM keys').get().n;
  const active = db.prepare("SELECT COUNT(*) AS n FROM keys WHERE status = 'active'").get().n;
  const revoked = db.prepare("SELECT COUNT(*) AS n FROM keys WHERE status = 'revoked'").get().n;
  const bound = db.prepare('SELECT COUNT(*) AS n FROM keys WHERE device_id IS NOT NULL').get().n;
  const checks = db.prepare('SELECT COUNT(*) AS n FROM logs').get().n;
  const okChecks = db.prepare("SELECT COUNT(*) AS n FROM logs WHERE result = 'ok'").get().n;
  res.json({ ok: true, data: { total, active, revoked, bound, checks, okChecks } });
});

// ---------- 公告 ----------

// 已绑定机器码列表,供公告定向选择
router.get('/devices', auth.requireAuth, (req, res) => {
  const rows = db
    .prepare(
      `SELECT device_id, key, remark, last_seen FROM keys
       WHERE device_id IS NOT NULL AND device_id != ''
       ORDER BY last_seen DESC`
    )
    .all();
  res.json({ ok: true, data: rows });
});

router.post('/announcements', auth.requireAuth, (req, res) => {
  const body = req.body || {};
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  const linkUrl = typeof body.link_url === 'string' ? body.link_url.trim() : '';
  const targetType = body.target_type === 'device' ? 'device' : 'all';

  // 批量勾选传 target_devices 数组;兼容旧的单个 target_device
  let devices = [];
  if (targetType === 'device') {
    const raw = Array.isArray(body.target_devices) ? body.target_devices : [body.target_device];
    devices = [...new Set(raw.filter((d) => typeof d === 'string' && d.trim()).map((d) => d.trim()))];
    if (devices.length === 0) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: '指定用户时至少勾选一个机器码' });
    }
  }
  if (!content) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: '公告内容不能为空' });
  }
  if (linkUrl && !/^https?:\/\//i.test(linkUrl)) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: '链接必须以 http:// 或 https:// 开头' });
  }

  let publishAt = new Date().toISOString(); // 默认即刻发送
  if (typeof body.publish_at === 'string' && body.publish_at) {
    const t = new Date(body.publish_at).getTime();
    if (Number.isNaN(t)) {
      return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: 'publish_at 格式无效' });
    }
    publishAt = new Date(t).toISOString();
  }

  const insertAnn = db.prepare(
    'INSERT INTO announcements (content, link_url, target_type, target_device, publish_at) VALUES (?, ?, ?, ?, ?)'
  );
  const insertTarget = db.prepare('INSERT INTO announcement_targets (announcement_id, device_id) VALUES (?, ?)');
  let row;
  db.transaction(() => {
    row = insertAnn.run(content, linkUrl, targetType, '', publishAt);
    const annId = row.lastInsertRowid;
    for (const d of devices) insertTarget.run(annId, d);
  })();

  row = db.prepare('SELECT * FROM announcements WHERE id = ?').get(row.lastInsertRowid);
  row.target_devices = devices;
  res.json({ ok: true, data: row });
});

router.get('/announcements', auth.requireAuth, (req, res) => {
  const rows = db.prepare('SELECT * FROM announcements ORDER BY id DESC').all();
  const targets = db.prepare('SELECT announcement_id, device_id FROM announcement_targets').all();
  const byAnn = new Map();
  for (const t of targets) {
    if (!byAnn.has(t.announcement_id)) byAnn.set(t.announcement_id, []);
    byAnn.get(t.announcement_id).push(t.device_id);
  }
  for (const r of rows) r.target_devices = byAnn.get(r.id) || [];
  res.json({ ok: true, data: rows });
});

router.delete('/announcements/:id', auth.requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const info = db.transaction(() => {
    db.prepare('DELETE FROM announcement_targets WHERE announcement_id = ?').run(id);
    return db.prepare('DELETE FROM announcements WHERE id = ?').run(id);
  })();
  if (info.changes === 0) {
    return res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '公告不存在' });
  }
  res.json({ ok: true });
});

module.exports = router;