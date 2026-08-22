/**
 * Export production API contract (pay cashier + agent report shapes).
 * Usage: node scripts/export-api-contract.js [679win]
 */
const fs = require('fs');
const path = require('path');
const { DEFAULT_AGENT } = require('../src/adapter/providers/wgame/agent-config');
const { createMockCashierOrder } = require('../src/mock-cashier');
const { createMockAgentResponse } = require('../src/mock-agent-api');

const siteId = process.argv[2] || '679win';
const root = path.join(__dirname, '..');
const outPath = path.join(root, 'logs', `api-contract-${siteId}.json`);
const siteOutPath = path.join(root, 'output', siteId, 'api-contract.json');

const paySample = createMockCashierOrder({
  amount: 100,
  money: 100,
  orderNo: 'SAMPLE_ORDER',
  channelId: 210563
});

const agentRoutes = [
  '/indexInfo',
  '/myTotalData',
  '/myCommission',
  '/agentPromotion',
  '/agentMode',
  '/promoteConfig',
  '/getIpBindInfo',
  '/teamDataV2',
  '/myCommissionDetail',
  '/myPerformance',
  '/clubCommission',
  '/clubCommissionDetail',
  '/directReport',
  '/bindingReport'
];

const agentSamples = {};
for (const route of agentRoutes) {
  agentSamples[route] = createMockAgentResponse(route, { token: 'session_token' });
}

const contract = {
  exportedAt: new Date().toISOString(),
  siteId,
  pay: {
    env: 'PAY_HTTP_URL',
    method: 'POST',
    requestExample: {
      amount: 100,
      money: 100,
      orderNo: 'WG1234567890',
      channelId: 210563,
      token: 'session_from_login',
      userId: '10001',
      account: 'member_account'
    },
    responseExample: paySample,
    requiredFields: ['data.orderNo', 'data.qrCode or data.url']
  },
  agent: {
    env: 'AGENT_HTTP_BASE',
    method: 'POST',
    routes: {
      indexInfo: '/indexInfo',
      myTotalData: '/myTotalData',
      myCommission: '/myCommission',
      agentPromotion: '/agentPromotion',
      agentMode: '/agentMode',
      promoteConfig: '/promoteConfig',
      getIpBindInfo: '/getIpBindInfo',
      teamDataV2: '/teamDataV2',
      myCommissionDetail: '/myCommissionDetail',
      myPerformance: '/myPerformance',
      clubCommission: '/clubCommission',
      clubCommissionDetail: '/clubCommissionDetail',
      directReport: '/directReport',
      bindingReport: '/bindingReport'
    },
    requestExample: { token: 'session_from_login', userId: '10001', account: 'member_account' },
    samples: agentSamples,
    defaultShape: {
      indexInfo: DEFAULT_AGENT.indexInfo,
      myTotalData: DEFAULT_AGENT.myTotalData,
      myCommission: DEFAULT_AGENT.myCommission,
      agentPromotion: DEFAULT_AGENT.agentPromotion
    }
  }
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(contract, null, 2));
if (fs.existsSync(path.dirname(siteOutPath))) {
  fs.writeFileSync(siteOutPath, JSON.stringify(contract, null, 2));
}
console.log(JSON.stringify({ ok: true, outPath, siteOutPath }, null, 2));
