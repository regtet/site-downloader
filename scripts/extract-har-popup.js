/**
 * 从 HAR 提取注册/下载弹窗快照（加密 POST 体 + newcomer OSS 配置）
 * 用法: node scripts/extract-har-popup.js [679win] [harPath]
 */
const fs = require('fs');
const path = require('path');

const siteId = process.argv[2] || '679win';
const harPath = process.argv[3] || path.join(process.env.USERPROFILE || '', 'Downloads', '679win.com.har');
const outDir = path.join(__dirname, '..', 'output', siteId);
const outPath = path.join(outDir, 'har-popup-snapshot.json');
const logPath = path.join(__dirname, '..', 'logs', `har-popup-snapshot-${siteId}.json`);

const POPUP_PATHS = [
  '/api/member/user/registerPopupDlgInfo',
  '/api/member/registerPopupDlgInfo',
  '/api/active/tasks/newcomer_benefit_pop'
];

function normPath(url) {
  let u = String(url || '').split('?')[0];
  u = u.replace(/^https?:\/\/[^/]+/i, '');
  if (u.startsWith('/hall/api/')) u = u.slice('/hall'.length);
  return u;
}

function main() {
  if (!fs.existsSync(harPath)) {
    console.error('HAR not found:', harPath);
    process.exit(1);
  }
  let existing = { endpoints: {} };
  for (const p of [outPath, logPath]) {
    try {
      if (fs.existsSync(p)) {
        existing = JSON.parse(fs.readFileSync(p, 'utf8'));
        break;
      }
    } catch (_) { /* ignore */ }
  }

  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const endpoints = Object.assign({}, existing.endpoints || {});
  for (const e of har.log.entries || []) {
    const p = normPath(e.request.url);
    const method = String(e.request.method || 'GET').toUpperCase();
    const isPopup = POPUP_PATHS.some((x) => p === x || p.startsWith(x));
    const isRewardJson = /\/api\/active\/tasks\/newcomer_benefit_reward\//i.test(p) && /\.json$/i.test(p);
    if (!isPopup && !isRewardJson) continue;
    const key = method + ' ' + p;
    const text = (e.response.content && e.response.content.text) || '';
    if (!text) continue;
    const ct = (e.response.content && e.response.content.mimeType) || 'text/plain';
    endpoints[key] = {
      status: e.response.status,
      contentType: ct,
      body: text
    };
  }

  const snapshot = {
    extractedAt: new Date().toISOString(),
    sourceHar: harPath,
    endpointCount: Object.keys(endpoints).length,
    endpoints,
    note: 'Encrypted POST bodies for register/download popups; OSS newcomer_benefit_reward json when present'
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(outPath, json);
  fs.writeFileSync(logPath, json);
  console.log(JSON.stringify({
    ok: true,
    outPath,
    logPath,
    endpointCount: snapshot.endpointCount,
    keys: Object.keys(endpoints)
  }, null, 2));
}

main();
