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