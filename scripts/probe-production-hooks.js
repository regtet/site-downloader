/**
 * 探测生产 PAY_HTTP_URL / AGENT_HTTP_BASE 是否可用（需环境变量或 adapter-hosts 非 localhost）
 * 用法: node scripts/probe-production-hooks.js [679win]
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { URL } = require('url');
const { loadPayConfig } = require('../src/adapter/providers/wgame/pay-config');
const { loadAgentConfig } = require('../src/adapter/providers/wgame/agent-config');
const { isLocalDevUrl } = require('../src/production-hooks');

const siteId = process.argv[2] || '679win';
const root = path.join(__dirname, '..');
const siteDir = path.join(root, 'output', siteId);
const outPath = path.join(root, 'logs', `production-probe-${siteId}.json`);

function postJson(url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (err) {
      reject(err);
      return;
    }
    const data = Buffer.from(JSON.stringify(body || {}));
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + (u.search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
      },
      timeout: timeoutMs || 20000
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { /* ignore */ }
        resolve({
          status: res.statusCode,
          json,
          raw: raw.slice(0, 500)
        });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    req.write(data);
    req.end();
  });
}

function pickPayData(json) {
  if (!json || typeof json !== 'object') return null;
  return json.data && typeof json.data === 'object' ? json.data : json;
}

async function probePay(url) {
  const body = { amount: 10, money: 10, orderNo: 'PROBE' + Date.now(), channelId: 210563 };
  try {
    const res = await postJson(url, body);
    const data = pickPayData(res.json);
    return {
      ok: !!(data && (data.qrCode || data.qrcode || data.url || data.payUrl || data.orderNo)),
      status: res.status,
      hasQr: !!(data && (data.qrCode || data.qrcode)),
      hasUrl: !!(data && (data.url || data.payUrl)),
      orderNo: data && (data.orderNo || data.order_no || data.outTradeNo) || '',
      error: null
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

async function probeAgent(base) {
  const url = String(base).replace(/\/$/, '') + '/indexInfo';
  try {
    const res = await postJson(url, { token: 'probe' });
    const data = pickPayData(res.json);
    return {
      ok: !!(data && typeof data === 'object'),
      status: res.status,
      keys: data && typeof data === 'object' ? Object.keys(data).slice(0, 12) : [],
      error: null
    };
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) };
  }
}

async function main() {
  const result = {
    at: new Date().toISOString(),
    siteId,
    skipped: false,
    pay: null,
    agent: null
  };

  if (!fs.existsSync(siteDir)) {
    result.skipped = true;
    result.reason = 'site dir missing';
    writeOut(result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(1);
  }

  const pay = loadPayConfig(siteDir, {});
  const agent = loadAgentConfig(siteDir, {});
  const payUrl = pay.createOrder && pay.createOrder.httpUrl;
  const agentBase = agent.httpBase;

  if ((!payUrl || isLocalDevUrl(payUrl)) && (!agentBase || isLocalDevUrl(agentBase))) {
    result.skipped = true;
    result.reason = 'set PAY_HTTP_URL / AGENT_HTTP_BASE or non-localhost adapter-hosts';
    writeOut(result);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  if (payUrl && !isLocalDevUrl(payUrl)) {
    result.pay = Object.assign({ url: payUrl }, await probePay(payUrl));
  }
  if (agentBase && !isLocalDevUrl(agentBase)) {
    result.agent = Object.assign({ base: agentBase }, await probeAgent(agentBase));
  }

  result.ok = [result.pay, result.agent]
    .filter(Boolean)
    .every((s) => s.ok);
  writeOut(result);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

function writeOut(result) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
