/**
 * 打印充值/代理对接状态与下一步操作。
 * 用法: node scripts/wire-status.js [679win]
 */
const fs = require('fs');
const path = require('path');
const { loadPayConfig } = require('../src/adapter/providers/wgame/pay-config');
const { loadAgentConfig } = require('../src/adapter/providers/wgame/agent-config');
const { loadWgameConfig } = require('../src/adapter/providers/wgame/config');
const { isLocalDevUrl } = require('../src/production-hooks');

const siteId = process.argv[2] || '679win';
const root = path.join(__dirname, '..');
const siteDir = path.join(root, 'output', siteId);
const capturesDir = path.join(root, 'output', '_captures');

function readJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

function main() {
  const hosts = readJson(path.join(siteDir, 'adapter-hosts.json')) || {};
  const providerOptions = hosts.providerOptions || hosts.wgame || {};
  const pay = loadPayConfig(siteDir, {});
  const agent = loadAgentConfig(siteDir, {});
  const payUrl = pay.createOrder && pay.createOrder.httpUrl;
  const agentBase = agent.httpBase;
  const captureCount = fs.existsSync(capturesDir)
    ? fs.readdirSync(capturesDir).filter((f) => f.endsWith('.json')).length
    : 0;
  const harAgent = readJson(path.join(siteDir, 'har-agent-snapshot.json'));
  const agentKeys = harAgent && harAgent.agent ? Object.keys(harAgent.agent) : [];

  const paySource = String(pay.source || '').toLowerCase();
  const agentSource = String(agent.source || '').toLowerCase();
  const wgamePay = pay.enabled !== false && paySource === 'wgame' && !pay.allowPlaceholderFallback;
  const wgameAgent = agent.enabled !== false && agentSource === 'wgame';
  const productionPay = !!((payUrl && !isLocalDevUrl(payUrl)) || wgamePay);
  const productionAgent = !!((agentBase && !isLocalDevUrl(agentBase)) || wgameAgent);

  const wgameProbe = readJson(path.join(root, 'logs', `wgame-live-probe-${siteId}.json`));

  const status = {
    siteId,
    at: new Date().toISOString(),
    authPopups: providerOptions.fallbackMockOnIpLimit
      ? 'unsafe fallback enabled (registration errors may be mocked)'
      : 'production-safe (registration failures are returned to the UI)',
    pay: {
      devMock: !!(payUrl && isLocalDevUrl(payUrl)),
      source: paySource || null,
      backend: wgamePay ? 'wgame shopItemList/payCharge' : (productionPay ? 'external-http' : null),
      productionUrl: payUrl && !isLocalDevUrl(payUrl) ? payUrl : null,
      env: process.env.PAY_HTTP_URL || null,
      harChannels: readJson(path.join(siteDir, 'har-pay-snapshot.json'))?.channelsByPayKind?.['100']?.list?.length || 0
    },
    agent: {
      devMock: !!(agentBase && isLocalDevUrl(agentBase)),
      source: agentSource || null,
      backend: wgameAgent ? 'wgame proxyStatistics/proxyUserList/proxySubBetConfig' : (productionAgent ? 'external-http' : null),
      productionBase: agentBase && !isLocalDevUrl(agentBase) ? agentBase : null,
      env: process.env.AGENT_HTTP_BASE || null,
      harAgentKeys: agentKeys,
      captureFiles: captureCount
    },
    wgameTestAccount: !!(process.env.WGAME_TEST_ACCOUNT && process.env.WGAME_TEST_PASSWORD),
    wgame: (() => {
      const cfg = loadWgameConfig(siteDir);
      return {
        wssUrl: cfg.wssUrl,
        packageId: cfg.packageId,
        web: cfg.wgameWeb || null
      };
    })(),
    wgameWssUrl: loadWgameConfig(siteDir).wssUrl,
    wssReachability: wgameProbe && wgameProbe.wssReachability ? wgameProbe.wssReachability : null,
    contract: path.join('output', siteId, 'api-contract.json'),
    blocked: [],
    next: []
  };

  if (!productionPay && !process.env.PAY_HTTP_URL) {
    status.blocked.push('production pay: set PAY_HTTP_URL');
    status.next.push('$env:PAY_HTTP_URL="https://你的收银台/api/create"; yarn apply-production-env ' + siteId);
  }
  if (!productionAgent && !process.env.AGENT_HTTP_BASE) {
    status.blocked.push('production agent: set AGENT_HTTP_BASE or capture agent page');
    status.next.push('$env:AGENT_HTTP_BASE="https://你的代理API"; yarn apply-production-env ' + siteId);
    status.next.push('或: yarn start → 登录 → 代理页抓包 → yarn import-capture-agent ' + siteId);
  }
  if (!status.wgameTestAccount) {
    status.next.push('可选实网验证：设置 WGAME_TEST_ACCOUNT + WGAME_TEST_PASSWORD');
    status.next.push('$env:WGAME_TEST_ACCOUNT="账号"; $env:WGAME_TEST_PASSWORD="密码"; yarn wgame-live-probe ' + siteId);
  }
  if (productionPay || productionAgent) {
    status.next.push('yarn probe-production-hooks ' + siteId);
    status.next.push('VERIFY_PRODUCTION_HOOKS=1 yarn verify-p0 ' + siteId);
  }
  status.next.push('yarn smoke-e2e ' + siteId);
  status.next.push('yarn night-continue ' + siteId);

  const outPath = path.join(root, 'logs', `wire-status-${siteId}.json`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(status, null, 2));
  console.log(JSON.stringify(status, null, 2));
}

main();
