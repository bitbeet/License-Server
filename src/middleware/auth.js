'use strict';

const crypto = require('crypto');

const PASSWORD = process.env.ADMIN_PASSWORD || 'change-me';
const COOKIE_NAME = 'lic_admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

const sessions = new Map();

function createSession() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + SESSION_TTL_MS);
  return token;
}

function destroySession(token) {
  sessions.delete(token);
}

function isAuthenticated(req) {
  const token = (req.headers.cookie || '')
    .split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${COOKIE_NAME}=`));
  if (!token) return false;
  const value = token.slice(COOKIE_NAME.length + 1);
  const exp = sessions.get(value);
  if (!exp) return false;
  if (Date.now() > exp) {
    sessions.delete(value);
    return false;
  }
  return true;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  return res.status(401).json({ ok: false, error: 'UNAUTHORIZED', message: '未登录' });
}

function cookieHeader(token) {
  const expires = new Date(Date.now() + SESSION_TTL_MS).toUTCString();
  return `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expires}`;
}

function clearCookieHeader() {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

module.exports = {
  PASSWORD,
  createSession,
  destroySession,
  isAuthenticated,
  requireAuth,
  cookieHeader,
  clearCookieHeader,
};