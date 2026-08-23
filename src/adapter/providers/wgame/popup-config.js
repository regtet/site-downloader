/**
 * 注册/下载弹窗：HAR 抓包中的加密体或 OSS 配置快照
 */
const path = require('path');
const fs = require('fs');

function readJsonSafe(p) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { /* ignore */ }
  return null;
}

function snapshotCandidates(siteDir) {
  const root = path.join(__dirname, '..', '..', '..', '..');
  const siteId = siteDir ? path.basename(path.resolve(siteDir)) : '679win';
  const candidates = [];
  if (siteDir) candidates.push(path.join(siteDir, 'har-popup-snapshot.json'));
  candidates.push(path.join(root, 'logs', `har-popup-snapshot-${siteId}.json`));
  return candidates;
}

function loadPopupSnapshot(siteDir) {
  for (const p of snapshotCandidates(siteDir)) {
    const j = readJsonSafe(p);
    if (j && j.endpoints) return j;
  }
  return null;
}

function normPath(pathname) {
  let p = String(pathname || '');
  if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
  return p.split('?')[0];
}

function getPopupBody(siteDir, pathname, method) {
  const snap = loadPopupSnapshot(siteDir);
  if (!snap || !snap.endpoints) return null;
  const p = normPath(pathname);
  const key = String(method || 'POST').toUpperCase() + ' ' + p;
  const row = snap.endpoints[key];
  if (!row || row.body == null) return null;
  return {
    body: String(row.body),
    contentType: row.contentType || 'text/plain; charset=utf-8'
  };
}

module.exports = {
  loadPopupSnapshot,
  getPopupBody,
  snapshotCandidates
};
