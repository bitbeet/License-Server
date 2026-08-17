'use strict';

const crypto = require('crypto');

const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomChar() {
  return CHARSET[crypto.randomInt(0, CHARSET.length)];
}

function generateKey() {
  const chars = [];
  for (let i = 0; i < 24; i++) {
    chars.push(randomChar());
  }
  const s = chars.join('');
  return `${s.slice(0, 6)}-${s.slice(6, 12)}-${s.slice(12, 18)}-${s.slice(18, 24)}`;
}

module.exports = { generateKey };