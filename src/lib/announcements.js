'use strict';

const db = require('../db');

// 已到发布时间、且面向该机器码(或全体)的公告,新发布的在前
function visibleFor(deviceId) {
  const now = new Date().toISOString();
  const rows = db
    .prepare(
      `SELECT a.id, a.content, a.link_url, a.target_type, a.publish_at
       FROM announcements a
       WHERE a.publish_at <= ?
         AND a.ended_at IS NULL
         AND (a.target_type = 'all'
              OR EXISTS (
                SELECT 1 FROM announcement_targets t
                WHERE t.announcement_id = a.id AND t.device_id = ?
              ))
       ORDER BY a.publish_at DESC, a.id DESC
       LIMIT 20`
    )
    .all(now, deviceId || '');
  return rows.map((r) => ({
    id: r.id,
    content: r.content,
    link_url: r.link_url || null,
    publish_at: r.publish_at,
    target: r.target_type === 'all' ? 'all' : 'device',
  }));
}

module.exports = { visibleFor };
