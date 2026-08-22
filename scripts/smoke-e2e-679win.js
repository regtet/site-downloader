/**
 * 679win 全链路冒烟：注册→登录→弹窗→充值 MOCK QR→代理邀请
 * 用法: node scripts/smoke-e2e-679win.js [679win]
 * 需 yarn start 在 3000，或仅静态服模式（自动起临时 preview）
 */
const http = require('http');
const path = require('path');
const fs = require('fs');

const siteId = process.argv[2] || '679win';
const root = path.join(__dirname, '..');
const siteDir = path.join(root, 'output', siteId);
const logsDir = path.join(root, 'logs');
const outPath = path.join(logsDir, `smoke-e2e-${siteId}.json`);

function post(port, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body || {}));
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': payload.length,
          ...(token ? { token } : {})
        },
        timeout: 35000
      },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          let json = null;
          try { json = JSON.parse(data); } catch (_) { /* ignore */ }
          resolve({ status: res.statusCode, json, raw: data.slice(0, 300) });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout ' + urlPath)); });
    req.write(payload);
    req.end();
  });
}

async function tryPreviewViaMain() {
  try {
    const start = await post(3000, '/api/preview/start', { path: siteDir });
    if (start.json && start.json.port) {
      return { port: start.json.port, url: start.json.url, via: 'yarn' };
    }
    if (start.port) return { port: start.port, url: start.url, via: 'yarn' };
  } catch (_) { /* ignore */ }
  return null;
}

async function startEmbeddedPreview() {
  const { createStaticServer } = require('../src/static-server');
  const { loadAdapterConfig } = require('../src/adapter/config');
  const cfg = loadAdapterConfig(siteDir, fs, path);
  const server = createStaticServer(siteDir, {
    host: '127.0.0.1',
    port: 0,
    adapterConfig: cfg,
    adapterHosts: {
      hosts: cfg.hosts || [],
      apiHostPatterns: cfg.apiHostPatterns || [],
      excludeHosts: cfg.excludeHosts || [],
      upstreamOrigin: cfg.upstreamOrigin || '',
      ossOrigin: cfg.ossOrigin || ''
    },
    spaFallback: true
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  return {
    port,
    url: `http://127.0.0.1:${port}`,
    via: 'embedded',
    close: () => new Promise((r) => server.close(r))
  };
}

async function main() {
  if (!fs.existsSync(siteDir)) {
    console.error('site dir missing:', siteDir);
    process.exit(1);
  }

  let preview = await tryPreviewViaMain();
  let owned = null;
  if (!preview) {
    owned = await startEmbeddedPreview();
    preview = owned;
  }

  const acc = 'e2e_' + Date.now();
  const pwd = 'Test1234!';
  const result = {
    at: new Date().toISOString(),
    siteId,
    preview: preview.url,
    via: preview.via,
    steps: {}
  };

  try {
    const reg = await post(preview.port, '/api/member/register', {
      account: acc,
      password: pwd,
      confirmPassword: pwd,
      device_id: 'fp_e2e'
    });
    result.steps.register = { code: reg.json && reg.json.code, ok: reg.json && reg.json.code === 1 };

    const login = await post(preview.port, '/api/member/login', {
      account: acc,
      password: pwd,
      userpass: pwd
    });
    result.steps.login = { code: login.json && login.json.code, ok: login.json && login.json.code === 1 };
    const token = login.json && login.json.data && login.json.data.session_key;

    const pop = await post(preview.port, '/api/member/user/registerPopupDlgInfo', {}, token);
    result.steps.registerPopup = {
      code: pop.json && pop.json.code,
      ok: pop.json && pop.json.code === 1 && Array.isArray(pop.json.data)
    };

    const popAlias = await post(preview.port, '/api/member/registerPopupDlgInfo', {}, token);
    result.steps.registerPopupAlias = {
      code: popAlias.json && popAlias.json.code,
      ok: popAlias.json && popAlias.json.code === 1 && Array.isArray(popAlias.json.data)
    };

    const newcomer = await post(preview.port, '/api/active/tasks/newcomer_benefit_pop', {}, token);
    result.steps.newcomerPop = {
      code: newcomer.json && newcomer.json.code,
      ok: newcomer.json && newcomer.json.code === 1 && Array.isArray(newcomer.json.data)
    };

    const payList = await post(preview.port, '/api/finance/pay/payListV4', {}, token);
    result.steps.payList = {
      code: payList.json && payList.json.code,
      ok: payList.json && payList.json.code === 1
    };

    const payChannels = await post(preview.port, '/api/finance/pay/payplatformlistV3', { payKind: 100 }, token);
    const chList = payChannels.json && payChannels.json.data && payChannels.json.data.list;
    const channelId = chList && chList[0] && (chList[0].id || chList[0].channelId || chList[0].payplatformid) || 900101;
    const harSnap = fs.existsSync(path.join(root, 'logs', `har-pay-snapshot-${siteId}.json`));
    result.steps.payChannels = {
      code: payChannels.json && payChannels.json.code,
      count: chList ? chList.length : 0,
      harExpected: harSnap,
      ok: payChannels.json && payChannels.json.code === 1
        && (!harSnap || (chList && chList.length >= 6))
    };

    const order = await post(preview.port, '/api/finance/pay/offlineOrderV3', {
      amount: 50,
      channelId
    }, token);
    const qr = order.json && order.json.data && order.json.data.qrCode;
    const orderNo = order.json && order.json.data && order.json.data.orderNo;
    result.steps.payOrder = {
      code: order.json && order.json.code,
      orderNo,
      mockQr: !!(qr && String(qr).includes('MOCK-')),
      ok: !!(order.json && order.json.code === 1 && qr)
    };

    if (orderNo) {
      const orderInfo = await post(preview.port, '/api/finance/pay/orderInfo', { orderNo }, token);
      result.steps.payOrderInfo = {
        code: orderInfo.json && orderInfo.json.code,
        ok: orderInfo.json && orderInfo.json.code === 1
      };
    }

    const promo = await post(preview.port, '/api/agent/promote/report/agentPromotion', {}, token);
    const invite = promo.json && promo.json.data && promo.json.data.linkList
      && promo.json.data.linkList[0] && promo.json.data.linkList[0].url;
    result.steps.agentPromotion = {
      code: promo.json && promo.json.code,
      hasInviteUrl: !!invite,
      ok: promo.json && promo.json.code === 1 && !!invite
    };

    const index = await post(preview.port, '/api/agent/promote/report/indexInfo', {}, token);
    result.steps.agentIndex = {
      code: index.json && index.json.code,
      ok: index.json && index.json.code === 1
    };

    const indexDirect = await post(preview.port, '/api/agent/promote/report/indexDirect', {}, token);
    result.steps.agentIndexDirect = {
      code: indexDirect.json && indexDirect.json.code,
      ok: indexDirect.json && indexDirect.json.code === 1
    };

    const teamData = await post(preview.port, '/api/agent/promote/report/teamDataV2', {}, token);
    result.steps.agentTeamData = {
      code: teamData.json && teamData.json.code,
      ok: teamData.json && teamData.json.code === 1
    };

    const clubCommission = await post(preview.port, '/api/agent/promote/report/clubCommission', {}, token);
    result.steps.agentClubCommission = {
      code: clubCommission.json && clubCommission.json.code,
      ok: clubCommission.json && clubCommission.json.code === 1
    };

    const agentMode = await post(preview.port, '/api/agent/promote/config/agentMode', {}, token);
    result.steps.agentMode = {
      code: agentMode.json && agentMode.json.code,
      ok: agentMode.json && agentMode.json.code === 1
    };

    const agentTotal = await post(preview.port, '/api/agent/promote/report/myTotalData', {}, token);
    result.steps.agentTotal = {
      code: agentTotal.json && agentTotal.json.code,
      ok: agentTotal.json && agentTotal.json.code === 1
    };

    const agentCommission = await post(preview.port, '/api/agent/promote/report/myCommissionV2', {}, token);
    result.steps.agentCommission = {
      code: agentCommission.json && agentCommission.json.code,
      ok: agentCommission.json && agentCommission.json.code === 1
    };

    try {
      const httpCashier = await post(3000, '/api/dev/mock-cashier/create', { amount: 66, orderNo: 'HTTP_E2E' });
      result.steps.httpCashier = {
        code: httpCashier.json && httpCashier.json.code,
        mockQr: !!(httpCashier.json && httpCashier.json.data && String(httpCashier.json.data.qrCode || '').includes('MOCK-')),
        ok: httpCashier.json && httpCashier.json.code === 1
      };
    } catch (err) {
      result.steps.httpCashier = { ok: false, error: String(err && err.message || err) };
    }

    try {
      const httpAgent = await post(3000, '/api/dev/mock-agent/indexInfo', {});
      const httpTeam = await post(3000, '/api/dev/mock-agent/teamDataV2', { token: 'e2e' });
      result.steps.httpAgent = {
        code: httpAgent.json && httpAgent.json.code,
        ok: httpAgent.json && httpAgent.json.code === 1
      };
      result.steps.httpAgentTeam = {
        code: httpTeam.json && httpTeam.json.code,
        ok: httpTeam.json && httpTeam.json.code === 1
          && Array.isArray(httpTeam.json.data && httpTeam.json.data.list)
      };
    } catch (err) {
      result.steps.httpAgent = { ok: false, error: String(err && err.message || err) };
    }

    result.ok = Object.values(result.steps).every((s) => s.ok);
  } catch (err) {
    result.ok = false;
    result.error = String(err && err.message || err);
  }

  if (owned && owned.close) await owned.close();

  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, outPath, steps: result.steps }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
