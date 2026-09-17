'use strict';

const express = require('express');
const db = require('../db');
const rateLimit = require('../middleware/rateLimit');
const { visibleFor } = require('../lib/announcements');
const { getSetting } = require('../lib/settings');
const { generateKey } = require('../lib/keys');

const router = express.Router();

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || '';
}

function logResult(key, ip, deviceId, result, message) {
  try {
    db.prepare(
      'INSERT INTO logs (key, ip, device_id, result, message) VALUES (?, ?, ?, ?, ?)'
    ).run(key, ip, deviceId || '', result, message);
  } catch (err) {
    console.error('failed to write log:', err.message);
  }
}

router.post('/validate', rateLimit, (req, res) => {
  const body = req.body || {};
  const key = typeof body.key === 'string' ? body.key.trim().toUpperCase() : '';
  const deviceId = typeof body.device_id === 'string' ? body.device_id.trim() : '';
  const ip = clientIp(req);

  if (!key) {
    logResult('', ip, deviceId, 'BAD_REQUEST', '缺少 key');
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: '缺少 key 参数' });
  }

  const row = db.prepare('SELECT * FROM keys WHERE key = ?').get(key);

  if (!row) {
    logResult(key, ip, deviceId, 'INVALID_KEY', '验证码不存在');
    return res.status(200).json({ ok: false, error: 'INVALID_KEY', message: '验证码无效' });
  }

  if (row.status === 'revoked') {
    logResult(key, ip, deviceId, 'REVOKED', '验证码已被取消');
    return res.status(200).json({ ok: false, error: 'REVOKED', message: '验证码已被取消' });
  }

  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
    logResult(key, ip, deviceId, 'EXPIRED', '验证码已过期');
    return res.status(200).json({ ok: false, error: 'EXPIRED', message: '验证码已过期' });
  }

  if (row.device_id) {
    if (!deviceId) {
      logResult(key, ip, deviceId, 'DEVICE_MISMATCH', '缺少设备标识');
      return res.status(200).json({ ok: false, error: 'DEVICE_MISMATCH', message: '缺少设备标识' });
    }
    if (row.device_id !== deviceId) {
      logResult(key, ip, deviceId, 'DEVICE_MISMATCH', '设备不匹配');
      return res.status(200).json({ ok: false, error: 'DEVICE_MISMATCH', message: '该验证码已绑定其他设备' });
    }
  } else {
    if (deviceId) {
      db.prepare('UPDATE keys SET device_id = ? WHERE id = ?').run(deviceId, row.id);
      row.device_id = deviceId;
    }
  }

  logResult(key, ip, deviceId, 'ok', '校验通过');
  db.prepare('UPDATE keys SET last_seen = datetime(\'now\') WHERE id = ?').run(row.id);
  return res.json({
    ok: true,
    data: {
      key,
      status: 'active',
      expires_at: row.expires_at || null,
      last_seen: new Date().toISOString(),
      server_time: new Date().toISOString(),
      announcements: visibleFor(deviceId),
    },
  });
});

// 公告拉取:软件启动时随校验一起拿到,也可以单独调用刷新
router.get('/announcements', rateLimit, (req, res) => {
  const deviceId = typeof req.query.device_id === 'string' ? req.query.device_id.trim() : '';
  res.json({ ok: true, data: visibleFor(deviceId) });
});

// 开放模式:新用户(还没有验证码)首次打开软件时自动分发一个验证码并绑定机器码
router.post('/open/distribute', rateLimit, (req, res) => {
  const deviceId = typeof (req.body || {}).device_id === 'string' ? req.body.device_id.trim() : '';
  if (!deviceId) {
    return res.status(400).json({ ok: false, error: 'BAD_REQUEST', message: '缺少 device_id 参数' });
  }

  if (getSetting('open_mode') !== '1') {
    return res.json({ ok: false, error: 'OPEN_MODE_DISABLED', message: '开放模式未开启' });
  }

  // 该机器码已有验证码则原样返回(含已取消的,管理员取消依然生效),避免重复发码
  const existing = db
    .prepare('SELECT key FROM keys WHERE device_id = ? ORDER BY id DESC LIMIT 1')
    .get(deviceId);
  if (existing) {
    logResult(existing.key, clientIp(req), deviceId, 'ok', '开放模式:机器码已有验证码,原样返回');
    return res.json({ ok: true, data: { key: existing.key, device_id: deviceId } });
  }

  // 新机器码:创建验证码并直接绑定
  let key = '';
  for (let i = 0; i < 10; i++) {
    const k = generateKey();
    if (!db.prepare('SELECT 1 FROM keys WHERE key = ?').get(k)) {
      key = k;
      break;
    }
  }
  if (!key) {
    return res.status(500).json({ ok: false, error: 'INTERNAL', message: '无法生成唯一验证码' });
  }
  const remark = `开放模式自动分发 ${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}`;
  db.prepare('INSERT INTO keys (key, remark, device_id) VALUES (?, ?, ?)').run(key, remark, deviceId);
  logResult(key, clientIp(req), deviceId, 'ok', '开放模式:自动分发验证码');
  return res.json({ ok: true, data: { key, device_id: deviceId } });
});

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;