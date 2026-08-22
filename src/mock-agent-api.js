/**
 * 开发用自有代理报表 HTTP 模拟。
 * 生产在 adapter-hosts.json 配置 agent.httpBase + routes 指向真实 API。
 */
const { DEFAULT_AGENT, emptyAgentListData } = require('./adapter/providers/wgame/agent-config');
const { readJsonBody } = require('./mock-cashier');

const ROUTE_KEY = {
  '/indexInfo': 'indexInfo',
  '/agentPromotion': 'agentPromotion',
  '/myTotalData': 'myTotalData',
  '/myPeriodData': 'myPeriodData',
  '/myCommission': 'myCommission',
  '/agentMode': 'agentMode',
  '/promoteConfig': 'promoteConfig',
  '/commissionMarquee': 'commissionMarquee',
  '/getIpBindInfo': 'getIpBindInfo',
  '/directReport': 'directReport',
  '/teamDataV2': 'teamDataV2',
  '/myCommissionDetail': 'myCommissionDetail',
  '/myPerformance': 'myPerformance',
  '/myPerformanceDetail': 'myPerformanceDetail',
  '/clubCommission': 'clubCommission',
  '/clubCommissionDetail': 'clubCommissionDetail',
  '/clubPerformance': 'clubPerformance',
  '/clubPerformanceUser': 'clubPerformanceUser',
  '/directFin': 'directFin',
  '/memberInfo': 'memberInfo',
  '/bindingReport': 'bindingReport'
};

function createMockAgentResponse(routeKey, body) {
  const key = ROUTE_KEY[routeKey] || routeKey.replace(/^\//, '');
  let data = DEFAULT_AGENT[key];
  if (data == null) data = emptyAgentListData(key);
  if (key === 'commissionMarquee' && !Array.isArray(data)) data = [];
  if (body && body.token && typeof data === 'object' && !Array.isArray(data)) {
    data = Object.assign({}, data, { _mockToken: String(body.token).slice(0, 12) });
  }
  return { code: 1, msg: 'ok', data };
}

async function handleMockAgentRequest(req, res, pathname) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 405, msg: 'POST only' }));
    return true;
  }
  const prefix = '/api/dev/mock-agent';
  if (!pathname.startsWith(prefix)) return false;
  const suffix = pathname.slice(prefix.length) || '/indexInfo';
  try {
    const body = await readJsonBody(req);
    const payload = createMockAgentResponse(suffix, body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 400, msg: String(err && err.message || err) }));
  }
  return true;
}

function isMockAgentPath(pathname) {
  return String(pathname || '').startsWith('/api/dev/mock-agent');
}

module.exports = {
  createMockAgentResponse,
  handleMockAgentRequest,
  isMockAgentPath,
  ROUTE_KEY
};
