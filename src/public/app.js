async function api(url, method = 'GET', body) {
  const opt = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch(url, opt);
  if (r.status === 401) {
    location.href = '/login.html';
    throw new Error('未登录');
  }
  const j = await r.json().catch(() => ({ ok: false }));
  if (!j.ok) throw new Error(j.message || '请求失败');
  return j;
}

function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtShanghai(iso) {
  if (!iso) return '';
  const hasTz = /[Zz]$|[+-]\d{2}:\d{2}$/.test(iso.trim());
  const d = new Date(hasTz ? iso : iso.replace(' ', 'T') + 'Z');
  if (isNaN(d)) return iso;
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}