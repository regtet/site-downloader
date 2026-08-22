/**
 * 限流记录未进 migration-map 的 API 请求，便于夜间消化
 */
const fs = require('fs');
const path = require('path');

const hits = new Map();
let lastFlush = 0;
const FLUSH_MS = 30000;
const LOG_EVERY_N = 5;

function normalizeApiPath(pathname) {
  let p = String(pathname || '').split('?')[0];
  if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
  return p;
}

function isApiPath(pathname) {
  const p = normalizeApiPath(pathname);
  // lobby / OSS json / domain 探测：故意透传上游，不进 migration-map
  if (!p.startsWith('/api/')) return false;
  if (/\.json$/i.test(p)) return false;
  if (p.startsWith('/api/lobby/')) return false;
  if (p.startsWith('/api/domain/')) return false;
  return true;
}

function noteUnmapped(pathname, method) {
  const p = normalizeApiPath(pathname);
  if (!isApiPath(p)) return;
  const key = String(method || 'POST').toUpperCase() + ' ' + p;
  const row = hits.get(key) || { count: 0, firstAt: Date.now(), lastAt: 0 };
  row.count += 1;
  row.lastAt = Date.now();
  hits.set(key, row);

  if (row.count === 1 || row.count % LOG_EVERY_N === 0) {
    console.log('[bridge] unmapped (add to migration-map)', key, 'x' + row.count);
  }

  const now = Date.now();
  if (now - lastFlush >= FLUSH_MS) {
    lastFlush = now;
    flush();
  }
}

function flush() {
  try {
    const root = path.join(__dirname, '..', '..', 'logs');
    fs.mkdirSync(root, { recursive: true });
    const top = [...hits.entries()]
      .map(([k, v]) => ({ key: k, count: v.count, firstAt: v.firstAt, lastAt: v.lastAt }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 80);
    fs.writeFileSync(
      path.join(root, 'runtime-unmapped.json'),
      JSON.stringify({ at: new Date().toISOString(), totalKeys: hits.size, top }, null, 2)
    );
  } catch (_) { /* ignore */ }
}

module.exports = {
  noteUnmapped,
  isApiPath,
  normalizeApiPath,
  flush,
  hits
};
