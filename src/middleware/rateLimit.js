'use strict';

const MAX = parseInt(process.env.RATE_LIMIT_MAX || '30', 10);
const WINDOW_MS = 60 * 1000;

const hits = new Map();

function cleanup() {
  const now = Date.now();
  for (const [ip, entry] of hits) {
    if (now - entry.start >= WINDOW_MS) {
      hits.delete(ip);
    }
  }
}

setInterval(cleanup, WINDOW_MS).unref();

function rateLimit(req, res, next) {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);

  if (!entry || now - entry.start >= WINDOW_MS) {
    hits.set(ip, { start: now, count: 1 });
    return next();
  }

  entry.count += 1;
  if (entry.count > MAX) {
    return res.status(429).json({
      ok: false,
      error: 'RATE_LIMITED',
      message: '请求过于频繁,请稍后再试',
    });
  }
  next();
}

module.exports = rateLimit;