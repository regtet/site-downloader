/**
 * 实网 wgame 探测：登录 → 支付渠道 → 下单 → 代理邀请
 * 需设置 WGAME_TEST_ACCOUNT / WGAME_TEST_PASSWORD
 * 用法: node scripts/wgame-live-probe.js [679win]
 */
const fs = require('fs');
const path = require('path');
const { wgameAuth } = require('../src/adapter/providers/wgame/client');
const { loadWgameConfig } = require('../src/adapter/providers/wgame/config');

const siteId = process.argv[2] || '679win';
const root = path.join(__dirname, '..');
const siteDir = path.join(root, 'output', siteId);
const outPath = path.join(root, 'logs', `wgame-live-probe-${siteId}.json`);

async function probeStep(label, fn) {
  try {
    const data = await fn();
    return { ok: true, label, data };
  } catch (err) {
    return { ok: false, label, error: String(err && err.message || err) };
  }
}

async function main() {
  const account = process.env.WGAME_TEST_ACCOUNT || '';
  const password = process.env.WGAME_TEST_PASSWORD || '';
  const result = {
    at: new Date().toISOString(),
    siteId,
    skipped: false,
    steps: {}
  };

  if (!account || !password) {
    const cfg = loadWgameConfig(siteDir);
    const reach = await probeStep('wssReachability', async () => {
      const probeAccount = 'probe_' + Date.now();
      try {
        await wgameAuth({
          action: 'register',
          account: probeAccount,
          password: 'Probe1234!',
          wssUrl: cfg.wssUrl,
          packageId: cfg.packageId,
          timeoutMs: Math.max(Number(cfg.timeoutMs) || 20000, 25000),
          nGmType: cfg.nGmType
        });
        return { reachable: true, registerCode: 0, wssUrl: cfg.wssUrl };
      } catch (err) {
        const code = err && err.code != null ? Number(err.code) : null;
        // 170=同IP限注册，说明 WSS 已通
        if (code === 170) {
          return { reachable: true, registerCode: 170, wssUrl: cfg.wssUrl, note: 'ip-limit; wss ok' };
        }
        throw err;
      }
    });
    result.skipped = true;
    result.reason = 'set WGAME_TEST_ACCOUNT and WGAME_TEST_PASSWORD';
    result.wssReachability = {
      ok: reach.ok,
      wssUrl: cfg.wssUrl,
      registerCode: reach.data && reach.data.registerCode,
      note: reach.data && reach.data.note,
      error: reach.error
    };
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  const cfg = loadWgameConfig(siteDir);
  const base = {
    account,
    password,
    wssUrl: cfg.wssUrl,
    packageId: cfg.packageId,
    timeoutMs: Math.max(Number(cfg.timeoutMs) || 20000, 30000),
    nGmType: cfg.nGmType
  };

  const login = await probeStep('login', () => wgameAuth(Object.assign({}, base, { action: 'login' })));
  result.steps.login = {
    ok: login.ok,
    userId: login.data && login.data.userId,
    error: login.error
  };
  if (!login.ok) {
    result.ok = false;
    writeOut(result);
    process.exit(1);
  }

  const channels = await probeStep('payChannels', () => wgameAuth(Object.assign({}, base, {
    action: 'login',
    hallAction: 'payChannels'
  })));
  const chList = channels.data && channels.data.payChannels;
  result.steps.payChannels = {
    ok: channels.ok,
    count: Array.isArray(chList) ? chList.length : 0,
    error: channels.error
  };

  let channelId = 0;
  if (Array.isArray(chList) && chList.length > 0) {
    const open = chList.filter((c) => c && (c.nStatus == null || Number(c.nStatus) !== 0));
    const first = open[0] || chList[0];
    channelId = Number(
      first.nChannelId != null ? first.nChannelId
        : (first.channelId != null ? first.channelId
          : (first.id != null ? first.id : first.nChannelID))
    ) || 0;
  }

  if (channelId > 0) {
    const charge = await probeStep('payCharge', () => wgameAuth(Object.assign({}, base, {
      action: 'login',
      hallAction: 'payCharge',
      charge: { channelId, amount: 10 }
    })));
    const info = charge.data && charge.data.charge && charge.data.charge.orderInfo;
    result.steps.payCharge = {
      ok: charge.ok,
      hasQr: !!(info && (info.qrcode || info.qrCode)),
      hasUrl: !!(charge.data && charge.data.charge && charge.data.charge.szChargeUrl),
      error: charge.error
    };
  } else {
    result.steps.payCharge = { ok: false, skipped: true, reason: 'no channel' };
  }

  const invite = await probeStep('proxyInvite', () => wgameAuth(Object.assign({}, base, {
    action: 'login',
    hallAction: 'proxyInvite'
  })));
  const inv = invite.data && invite.data.proxyInvite;
  result.steps.proxyInvite = {
    ok: invite.ok,
    hasCode: !!(inv && inv.szInviteCode),
    directCount: inv && inv.nDirectCount,
    error: invite.error
  };

  result.ok = Object.values(result.steps).every((s) => s.ok || s.skipped);
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
