'use strict';

const fs = require('fs');
const path = require('path');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
    const idx = trimmed.indexOf('=');
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}
loadEnv();

const express = require('express');
const validateRouter = require('./routes/validate');
const adminRouter = require('./routes/admin');

const app = express();
const PORT = parseInt(process.env.PORT || '8080', 10);

app.set('trust proxy', true);
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', validateRouter);
app.use('/api/admin', adminRouter);

app.use('/api', (req, res) => {
  res.status(404).json({ ok: false, error: 'NOT_FOUND', message: '接口不存在' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, error: 'INTERNAL', message: '服务器内部错误' });
});

app.listen(PORT, () => {
  console.log(`License server listening on http://0.0.0.0:${PORT}`);
});