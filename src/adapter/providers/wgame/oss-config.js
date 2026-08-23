/**
 * HAR/OSS 静态 JSON 快照：上游 -1 或网络失败时回退
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
  if (siteDir) candidates.push(path.join(siteDir, 'har-oss-snapshot.json'));
  candidates.push(path.join(root, 'logs', `har-oss-snapshot-${siteId}.json`));
  return candidates;
}

function loadOssSnapshot(siteDir) {
  for (const p of snapshotCandidates(siteDir)) {
    const j = readJsonSafe(p);
    if (j && j.endpoints) return j;
  }
  return null;
}

function normPath(pathname) {
  let p = String(pathname || '').split('?')[0];
  if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
  return p;
}

/** 将 POST /api/foo 映射到常见 OSS GET json path */
function ossJsonCandidates(pathname, siteCode) {
  const p = normPath(pathname);
  const code = siteCode || '12025';
  const out = [];
  if (p === '/api/active/category' || p === '/api/active/categoryV2') {
    out.push('/api/active/category/currency/BRL/language/pt.json');
    out.push('/api/active/categoryV2/currency/BRL/language/pt.json');
  }
  if (p === '/api/active/getByTemplate') {
    out.push('/api/active/getByTemplate/currency/BRL.json');
  }
  if (p === '/api/active/isShowV2') {
    out.push('/api/active/isShowV2/default.json');
  }
  if (p === '/api/finance/pay/payTypeSetting') {
    out.push('/api/finance/pay/payTypeSetting/language/pt.json');
  }
  if (p === '/api/finance/payPopup/settingAndSlogans') {
    out.push('/api/finance/payPopup/settingAndSlogans/currency/BRL/language/pt.json');
  }
  if (p === '/api/finance/maxChargeRate') {
    out.push('/api/finance/maxChargeRate/currency/BRL/osType/4.json');
  }
  if (p === '/api/member/user/vipInfoV2') {
    out.push(`/api/member/user/vipInfoV2/currency/BRL/siteCode/${code}/language/pt.json`);
    out.push('/api/member/user/vipInfoV2/currency/BRL/language/pt.json');
  }
  if (p === '/api/member/vipInfoUnLogin') {
    out.push(`/api/member/vipInfoUnLogin/currency/BRL/siteCode/${code}/language/pt.json`);
  }
  if (p === '/api/gohal/staffAllV3') {
    out.push('/api/gohal/staffAllV3/currency/BRL/language/pt.json');
  }
  if (p === '/api/agent/promote/config/index') {
    out.push('/api/agent/promote/config/index/currency/BRL/language/pt.json');
  }
  if (p === '/api/agent/promote/commissionMarquee') {
    out.push('/api/agent/promote/commissionMarquee/currency/BRL/language/pt.json');
  }
  if (/\.json$/i.test(p)) out.push(p);
  return out;
}

function getOssSnapshotBody(siteDir, pathname, method) {
  const snap = loadOssSnapshot(siteDir);
  if (!snap || !snap.endpoints) return null;
  const m = String(method || 'GET').toUpperCase();
  const p = normPath(pathname);
  const keys = [m + ' ' + p];
  for (const alt of ossJsonCandidates(p)) {
    keys.push('GET ' + alt);
  }
  for (const key of keys) {
    const row = snap.endpoints[key];
    if (row && row.body != null) {
      return {
        body: String(row.body),
        contentType: row.contentType || 'application/json; charset=utf-8',
        source: 'har-oss'
      };
    }
  }
  return null;
}

module.exports = {
  loadOssSnapshot,
  getOssSnapshotBody,
  ossJsonCandidates,
  snapshotCandidates
};
