/**
 * 从 HAR 提取 OSS/UI 静态 JSON 快照（活动/充值/VIP/代理配置）
 * 用法: node scripts/extract-har-oss.js [679win] [harPath]
 */
const fs = require('fs');
const path = require('path');

const siteId = process.argv[2] || '679win';
const harPath = process.argv[3] || path.join(process.env.USERPROFILE || '', 'Downloads', '679win.com.har');
const outDir = path.join(__dirname, '..', 'output', siteId);
const outPath = path.join(outDir, 'har-oss-snapshot.json');
const logPath = path.join(__dirname, '..', 'logs', `har-oss-snapshot-${siteId}.json`);

const PATTERNS = [
  /\/api\/active\/category\//i,
  /\/api\/active\/getByTemplate\//i,
  /\/api\/active\/isShowV2\//i,
  /\/api\/active\/active_popRecharge\//i,
  /\/api\/finance\/pay\/payTypeSetting\//i,
  /\/api\/finance\/payPopup\//i,
  /\/api\/finance\/maxChargeRate\//i,
  /\/api\/member\/user\/vipInfoV2\//i,
  /\/api\/member\/vipInfoUnLogin\//i,
  /\/api\/gohal\/staffAllV3\//i,
  /\/api\/agent\/promote\/config\//i,
  /\/api\/agent\/promote\/commissionMarquee/i
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
    if (!PATTERNS.some((re) => re.test(p))) continue;
    const text = (e.response.content && e.response.content.text) || '';
    if (!text || text.length < 4) continue;
    const key = String(e.request.method || 'GET').toUpperCase() + ' ' + p;
    endpoints[key] = {
      status: e.response.status,
      contentType: (e.response.content && e.response.content.mimeType) || 'application/json',
      body: text
    };
  }

  const snapshot = {
    extractedAt: new Date().toISOString(),
    sourceHar: harPath,
    endpointCount: Object.keys(endpoints).length,
    endpoints
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(outPath, json);
  fs.writeFileSync(logPath, json);
  console.log(JSON.stringify({
    ok: true,
    outPath,
    endpointCount: snapshot.endpointCount,
    keys: Object.keys(endpoints).slice(0, 20)
  }, null, 2));
}

main();
