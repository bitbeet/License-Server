'use strict';

const express = require('express');
const db = require('../db');
const rateLimit = require('../middleware/rateLimit');

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
    },
  });
});

router.get('/health', (req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

module.exports = router;