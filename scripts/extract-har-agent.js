/**
 * 从 HAR 提取代理相关接口快照（当前 HAR 通常只有 getIpBindInfo / reportViewV2）
 * 用法: node scripts/extract-har-agent.js [679win] [harPath]
 */
const fs = require('fs');
const path = require('path');

const siteId = process.argv[2] || '679win';
const harPath = process.argv[3] || path.join(process.env.USERPROFILE || '', 'Downloads', '679win.com.har');
const outDir = path.join(__dirname, '..', 'output', siteId);
const outPath = path.join(outDir, 'har-agent-snapshot.json');
const logPath = path.join(__dirname, '..', 'logs', `har-agent-snapshot-${siteId}.json`);

function normPath(url) {
  let u = String(url || '').split('?')[0];
  u = u.replace(/^https?:\/\/[^/]+/i, '');
  if (u.startsWith('/hall/api/')) u = u.slice('/hall'.length);
  return u;
}

function parseJson(text) {
  try {
    return JSON.parse(text || '');
  } catch (_) {
    return null;
  }
}

function main() {
  if (!fs.existsSync(harPath)) {
    console.error('HAR not found:', harPath);
    process.exit(1);
  }
  let existing = { endpoints: {}, agent: {} };
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
    if (!/\/agent\/promote\//i.test(p)) continue;
    const key = String(e.request.method || 'POST').toUpperCase() + ' ' + p;
    const resp = parseJson(e.response.content && e.response.content.text);
    if (!resp) continue;
    endpoints[key] = {
      status: e.response.status,
      request: parseJson(e.request.postData && e.request.postData.text) || {},
      response: resp
    };
  }

  const getIp = endpoints['POST /api/agent/promote/getIpBindInfo'];
  const agent = Object.assign({}, existing.agent || {});
  if (getIp && getIp.response && getIp.response.data) {
    agent.getIpBindInfo = Object.assign({}, agent.getIpBindInfo || {}, getIp.response.data);
  }
  const snapshot = {
    extractedAt: new Date().toISOString(),
    sourceHar: harPath,
    sourceCaptures: existing.sourceCaptures || [],
    endpointCount: Object.keys(endpoints).length,
    endpoints,
    agent,
    importedFromCapture: existing.importedFromCapture || 0,
    note: Object.keys(agent).length > 1
      ? 'HAR merged with existing agent snapshot'
      : 'HAR missing indexInfo/myTotalData; set AGENT_HTTP_BASE or capture more HAR'
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
