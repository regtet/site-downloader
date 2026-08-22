/**
 * 从 output/_captures/*.json 导入代理页 API 响应，合并到 har-agent-snapshot。
 * 用法: node scripts/import-capture-agent.js [679win] [capture.json]
 */
const fs = require('fs');
const path = require('path');

const siteId = process.argv[2] || '679win';
const captureArg = process.argv[3] || '';
const root = path.join(__dirname, '..');
const siteDir = path.join(root, 'output', siteId);
const capturesDir = path.join(root, 'output', '_captures');
const outPath = path.join(siteDir, 'har-agent-snapshot.json');
const logPath = path.join(root, 'logs', `har-agent-snapshot-${siteId}.json`);

const PATH_TO_KEY = {
  '/api/agent/promote/report/indexInfo': 'indexInfo',
  '/api/agent/promote/report/indexDirect': 'indexInfo',
  '/api/agent/promote/report/myTotalData': 'myTotalData',
  '/api/agent/promote/report/agentPromotion': 'agentPromotion',
  '/api/agent/promote/report/myCommissionV2': 'myCommission',
  '/api/agent/promote/config/agentMode': 'agentMode',
  '/api/agent/promote/config/index': 'promoteConfig',
  '/api/agent/promote/config/getAgentConfig': 'promoteConfig',
  '/api/agent/promote/getIpBindInfo': 'getIpBindInfo',
  '/api/agent/promote/reportPc/agentInfo': 'indexInfo',
  '/api/agent/promote/report/teamDataV2': 'teamDataV2',
  '/api/agent/promote/report/myCommissionDetailV3': 'myCommissionDetail',
  '/api/agent/promote/report/myPerformanceV2': 'myPerformance',
  '/api/agent/promote/report/myPerformanceDetailV2': 'myPerformanceDetail',
  '/api/agent/promote/report/clubCommission': 'clubCommission',
  '/api/agent/promote/report/clubCommissionDetail': 'clubCommissionDetail',
  '/api/agent/promote/report/clubPerformance': 'clubPerformance',
  '/api/agent/promote/report/clubPerformanceUserV1': 'clubPerformanceUser',
  '/api/agent/promote/report/directFinV4': 'directFin',
  '/api/agent/promote/report/memberInfo': 'memberInfo',
  '/api/agent/promote/binding/reportViewV2': 'bindingReport'
};

function normPath(urlOrPath) {
  let u = String(urlOrPath || '').split('?')[0];
  u = u.replace(/^https?:\/\/[^/]+/i, '');
  if (u.startsWith('/hall/api/')) u = u.slice('/hall'.length);
  return u;
}

function listCaptureFiles() {
  if (captureArg && fs.existsSync(captureArg)) return [path.resolve(captureArg)];
  if (!fs.existsSync(capturesDir)) return [];
  return fs.readdirSync(capturesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => path.join(capturesDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function loadExisting() {
  for (const p of [outPath, logPath]) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) { /* ignore */ }
  }
  return {
    extractedAt: null,
    sourceHar: '',
    endpointCount: 0,
    endpoints: {},
    agent: {}
  };
}

function pickData(entry) {
  if (!entry) return null;
  if (entry.data && typeof entry.data === 'object') return entry.data;
  if (entry.body && entry.body.data != null) return entry.body.data;
  return null;
}

function main() {
  const files = listCaptureFiles();
  const existing = loadExisting();
  const endpoints = Object.assign({}, existing.endpoints || {});
  const agent = Object.assign({}, existing.agent || {});
  let imported = 0;

  for (const file of files) {
    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (_) {
      continue;
    }
    const entries = raw.entries || [];
    for (const ent of entries) {
      const p = normPath(ent.pathname || ent.url);
      const key = PATH_TO_KEY[p];
      if (!key) continue;
      const data = pickData(ent);
      if (!data || typeof data !== 'object') continue;
      endpoints[`${ent.method || 'POST'} ${p}`] = {
        status: ent.status,
        response: ent.body || { code: ent.code, data }
      };
      agent[key] = Object.assign({}, agent[key] || {}, data);
      imported++;
    }
  }

  const snapshot = {
    extractedAt: new Date().toISOString(),
    sourceHar: existing.sourceHar || '',
    sourceCaptures: files,
    endpointCount: Object.keys(endpoints).length,
    endpoints,
    agent,
    importedFromCapture: imported,
    note: imported
      ? 'merged from manual capture; production still prefers AGENT_HTTP_BASE'
      : 'no agent capture yet; login+browse agent page then stop capture'
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(outPath, json);
  fs.writeFileSync(logPath, json);
  console.log(JSON.stringify({
    ok: true,
    imported,
    captureFiles: files.length,
    outPath,
    agentKeys: Object.keys(agent)
  }, null, 2));
}

main();
