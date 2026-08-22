/**
 * 将 PAY_HTTP_URL / AGENT_HTTP_BASE 写入 output/<siteId>/adapter-hosts.json
 * 用法:
 *   set PAY_HTTP_URL=https://pay.example.com/create
 *   set AGENT_HTTP_BASE=https://agent.example.com
 *   node scripts/apply-production-env.js 679win
 */
const fs = require('fs');
const path = require('path');
const { applyProductionHooks } = require('../src/production-hooks');
const { toSiteId, outputDir } = require('../src/migrate');

function main() {
  const siteId = toSiteId(process.argv[2] || '679win');
  const hostsPath = path.join(outputDir(siteId), 'adapter-hosts.json');
  if (!fs.existsSync(hostsPath)) {
    console.error('adapter-hosts.json missing:', hostsPath);
    process.exit(1);
  }
  const hosts = JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
  applyProductionHooks(hosts);
  fs.writeFileSync(hostsPath, JSON.stringify(hosts, null, 2), 'utf8');
  const payUrl = hosts.providerOptions && hosts.providerOptions.pay
    && hosts.providerOptions.pay.createOrder
    && hosts.providerOptions.pay.createOrder.httpUrl;
  const agentBase = hosts.providerOptions && hosts.providerOptions.agent
    && hosts.providerOptions.agent.httpBase;
  console.log(JSON.stringify({
    ok: true,
    siteId,
    hostsPath,
    payHttpUrl: payUrl || '',
    agentHttpBase: agentBase || '',
    fromEnv: {
      PAY_HTTP_URL: process.env.PAY_HTTP_URL || null,
      AGENT_HTTP_BASE: process.env.AGENT_HTTP_BASE || null
    }
  }, null, 2));
}

main();
