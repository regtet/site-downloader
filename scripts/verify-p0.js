/**
 * P0 运行验证：Adapter 单测 +（可选）实网登录链
 *
 *   node scripts/verify-p0.js
 *   set WGAME_TEST_ACCOUNT=xx& set WGAME_TEST_PASSWORD=yy& node scripts/verify-p0.js
 */
require('../src/system-proxy').applySystemProxy({ log: true });

const fs = require('fs');
const path = require('path');
const http = require('http');
const { StaticServer } = require('../src/static-server');
const { memberProfile, adaptWalletGold, adaptMemberProfile } = require('../src/adapter/series/aniw-lobby/adapters');
const { MIGRATION_MAP } = require('../src/adapter/series/aniw-lobby/migration-map');
const { getSeries } = require('../src/adapter/series');
const { getProvider } = require('../src/adapter/providers');

const root = path.join(__dirname, '..');
const { inputDir, outputDir, toSiteId } = require('./site-paths');
const siteId = toSiteId(process.env.SITE_ID || process.argv[2] || '679win');
const migrated = outputDir(siteId);
const input = inputDir(siteId);
const fallbackDist = path.join(root, 'dist', '679win.com');
const siteDir = fs.existsSync(migrated)
  ? migrated
  : (fs.existsSync(input) ? input : fallbackDist);

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log('  OK ', msg);
  } else {
    failed++;
    console.error('  FAIL', msg);
  }
}

function testAdapters() {
  console.log('\n[1] Adapter 字段（不伪造）');
  const {
    memberProfile,
    adaptWalletGold,
    adaptMemberProfile,
    adaptVipSummary,
    adaptVipDetails,
    adaptAvatars,
    adaptPayPending,
    DEFAULT_PORTRAIT
  } = require('../src/adapter/series/aniw-lobby/adapters');

  const user = {
    account: 'u1',
    session: 'sk_test',
    userId: '42',
    game_gold: 12.5,
    nickname: 'Nick',
    phone: '119',
    vip_level: 3,
    face_id: '7',
    device_id: 'dev',
    account_type: 2
  };
  const m = memberProfile(user);
  assert(m.username === 42, 'username is numeric member id');
  assert(m.nickname === 'Nick', 'nickname from wgame when present');
  assert(m.session_key === 'sk_test' && m.jwt_token === 'sk_test', 'session aliases');
  assert(m.userkey === 'sk_test', 'userkey uses session (no fil_ protocol)');
  assert(m.game_gold === 12.5, 'game_gold');
  assert(m.account_type === 2, 'account_type from wgame');
  assert(m.currency === 'BRL', 'site default currency BRL');
  assert(m.permissionOpt && m.permissionOpt.hasPassword === true, 'permissionOpt.hasPassword');
  assert(m.permissionOpt.hasPhone === true, 'permissionOpt.hasPhone from session');
  assert(m.bonus === '0' && m.totalGold === '12.5', 'bonus/totalGold shape');
  assert(String(m.portrait_id).startsWith('https://'), 'portrait_id CDN url');
  assert(m.vip_level === 3, 'vip_level');

  const lean = memberProfile({ account: 'a', session: 's', userId: '10001', game_gold: 0, nickname: '' });
  assert(lean.username === 10001, 'username from userId number');
  assert(lean.nickname === 'a', 'nickname falls back to account for profile display');
  const leanBare = memberProfile({ session: 's', userId: '10001', game_gold: 0, nickname: '' });
  assert(leanBare.nickname === '', 'empty nickname without account');
  assert(lean.phone === '' || lean.phone === undefined || lean.mobile_phone === '', 'empty phone');
  assert(String(lean.portrait_id).startsWith('https://'), 'default CDN portrait');

  const w = adaptWalletGold({ ok: true, data: { game_gold: 9 } });
  assert(w.code === 1 && w.data.game_gold === 9, 'walletGold');
  assert(w.data.totalGold === '9', 'wallet totalGold string');

  const fail = adaptMemberProfile({ ok: false, code: 139, msg: 'Password error' });
  assert(fail.code === 139 && fail.data === null, 'login fail envelope');

  const vip = adaptVipSummary({ ok: true, data: { vip_level: 2 } });
  assert(vip.code === 1 && vip.data.vip === 2, 'vip summary');

  const vd = adaptVipDetails({ ok: true, data: { vip_level: 0 } });
  assert(vd.code === 1 && vd.data.vip === 0 && vd.data.current_style === 2, 'vipDetails official shape');
  assert(vd.data.icon_style && vd.data.icon_color, 'vipDetails icons');

  const av = adaptAvatars({ ok: true, data: { face_id: '3' } });
  assert(av.code === 1 && Array.isArray(av.data.list) && av.data.list.length >= 1, 'avatars list');

  const pay = adaptPayPending({ ok: false, code: 10060, msg: 'pending' });
  assert(pay.code === 10060 && pay.data === null, 'pay pending fails explicitly');
}

function testMap() {
  console.log('\n[2] migration-map');
  const series = getSeries('aniw-lobby');
  assert(series.matchRoute('/hall/api/member/login').op === 'auth.login', 'login map');
  assert(series.matchRoute('/api/member/register').adapter === 'registerProfile', 'register wraps userInfos');
  assert(series.matchRoute('/api/active/tasks/newcomer_benefit_pop').adapter === 'emptyList', 'newcomer pop empty list');
  assert(series.matchRoute('/api/member/user/registerPopupDlgInfo').adapter === 'emptyList', 'register popup empty list');
  assert(series.matchRoute('/api/member/getFastLogin').op === 'user.info', 'getFastLogin → session');

  const {
    adaptRegisterProfile,
    adaptEmptyList
  } = require('../src/adapter/series/aniw-lobby/adapters');
  const reg = adaptRegisterProfile({
    ok: true,
    data: { account: 'u', session: 'sk', userId: '99', game_gold: 0 }
  });
  assert(
    reg.code === 1 && reg.data && reg.data.userInfos && reg.data.userInfos.username === 99,
    'register data.userInfos'
  );
  assert(reg.data.needApprove === false, 'register needApprove false');
  const el = adaptEmptyList({ ok: true, data: {} });
  assert(el.code === 1 && Array.isArray(el.data) && el.data.length === 0, 'emptyList is []');

  assert(series.matchRoute('/api/member/user/info').adapter === 'memberProfile', 'user.info');
  assert(series.matchRoute('/api/gameCenter/gold').op === 'wallet.gold', 'gold');
  assert(series.matchRoute('/api/member/user/vip').adapter === 'vipSummary', 'vip');
  assert(series.matchRoute('/api/member/user/avatars').adapter === 'avatars', 'avatars');
  assert(series.matchRoute('/api/finance/pay/payListV4').adapter === 'payList', 'payList config-driven');
  assert(series.matchRoute('/api/finance/pay/payTypeV4').adapter === 'payType', 'payType config-driven');
  assert(series.matchRoute('/api/finance/pay/payplatformlistV3').adapter === 'payChannels', 'payChannels');
  assert(series.matchRoute('/api/finance/pay/offlineOrderV3').adapter === 'payCreate', 'payCreate');
  assert(series.matchRoute('/api/finance/pay/payInfos').adapter === 'payInfos', 'payInfos');
  assert(series.matchRoute('/api/finance/certify/withdrawRecord').adapter === 'emptyRecords', 'withdrawRecord empty');
  assert(series.matchRoute('/api/finance/certify/withdrawSettingV3').adapter === 'withdrawPending', 'withdrawSetting pending');
  assert(series.matchRoute('/api/member/logout').adapter === 'logout', 'logout');
  assert(series.matchRoute('/api/gohal/heartbeat').adapter === 'lobbyOk', 'heartbeat');
  assert(series.matchRoute('/api/active/getRedDotV2').adapter === 'redDotEmpty', 'redDotEmpty');
  assert(series.matchRoute('/api/member/getFingerprint').adapter === 'fingerprint', 'fingerprint');
  assert(series.matchRoute('/api/member/listAccount').adapter === 'listAccount', 'listAccount');
  assert(series.matchRoute('/api/member/user/vipInfoV2').adapter === 'vipInfoV2', 'vipInfoV2 session adapter');
  assert(series.matchRoute('/api/gameCenter/gameApi/login').adapter === 'gameLaunch', 'game launch mapping');
  const { buildGameLaunchData, deriveLobbyGameUrlFromWss } = require('../src/adapter/providers/wgame/game-config');
  const launch = buildGameLaunchData(
    { platfromid: '200', gameid: 88 },
    { nickname: 'Nick' },
    { enabled: true, clientPath: 'gogamesac/clientv3/index.html', lobbyGameUrl: 'https://www.example.com/gogameccc/', fallbackToDefault: true, defaultTarget: { kindId: 3, roomId: 0, gameName: 'WGame', direction: 1 }, mappings: [] },
    null
  );
  assert(launch && launch.game_url === 'https://www.example.com/gogameccc/clientv3/index.html', 'absolute game_url for third-party');
  assert(launch.gameid === 3, 'wgame kindId as gameid');
  assert(deriveLobbyGameUrlFromWss('wss://server.679win2.com') === 'https://www.679win2.com/gogameccc/', 'lobby url from wss');
  const {
    parseWgameWebConfigText,
    parseBoolish,
    deriveLobbyGameUrlFromProxyList,
    resolveWgameWebRoot
  } = require('../src/adapter/providers/wgame/wgame-web-config');
  assert(parseBoolish(1) && parseBoolish('true') && !parseBoolish(0), 'wgame_web debug parse');
  const sample = parseWgameWebConfigText(`
    debug: 1,
    baseWssUrl: 'wss://server.prod.com',
    mockWssUrl: 'wss://server.test.com',
    packageId: 46,
    proxyShareUrlList: ['https://a.com', 'https://www.b.com']
  `);
  assert(sample.debug && sample.wssUrl === 'wss://server.test.com', 'debug=1 uses mockWssUrl');
  const prod = parseWgameWebConfigText(`debug: false, baseWssUrl: 'wss://p.com', mockWssUrl: 'wss://t.com'`);
  assert(prod.wssUrl === 'wss://p.com', 'debug off uses baseWssUrl');
  assert(
    deriveLobbyGameUrlFromProxyList(['https://679win2.com', 'https://www.679win2.com'])
      === 'https://www.679win2.com/gogameccc/',
    'lobby from proxyShareUrlList'
  );
  const commented = parseWgameWebConfigText(`
    debug: 1,
    // mockWssUrl: 'ws://192.168.50.117:38051',
    mockWssUrl: 'wss://server.brmt777.com',
    baseWssUrl: 'wss://server.679win2.com',
    packageId: 46
  `);
  assert(commented.mockWssUrl === 'wss://server.brmt777.com', 'ignore commented mockWssUrl');
  assert(commented.wssUrl === 'wss://server.brmt777.com', 'debug uses active mockWssUrl');
  const { loadWgameConfig } = require('../src/adapter/providers/wgame/config');
  const zeroPkg = loadWgameConfig(null);
  if (zeroPkg.wgameWeb && zeroPkg.wgameWeb.debug) {
    assert(zeroPkg.packageId === 0, 'packageId 0 from wgame_web');
  }
  const webRoot = resolveWgameWebRoot();
  if (webRoot) {
    const { loadWgameConfig } = require('../src/adapter/providers/wgame/config');
    const cfg = loadWgameConfig(path.join(__dirname, '..', 'output', '679win'));
    assert(cfg.wgameWeb && cfg.wgameWeb.root, 'wgame_web linked');
    console.log('  OK  wgame_web', cfg.wgameWeb.branch || 'detached', cfg.wgameWeb.serverMode, cfg.wssUrl);
  }
  assert(series.matchRoute('/api/agent/promote/config/agentMode').adapter === 'agentBlob', 'agentMode config-driven');
  assert(series.matchRoute('/api/active/receivedAwardList').adapter === 'emptyRecords', 'award list empty not forged');
  assert(series.matchRoute('/api/active/receiveOne').adapter === 'featurePending', 'receiveOne pending not empty-ok');
  assert(series.matchRoute('/api/agent/promote/getIpBindInfo').adapter === 'agentBlob', 'agent bind config-driven');
  assert(series.matchRoute('/api/agent/promote/report/indexInfo').adapter === 'agentBlob', 'agent indexInfo');
  assert(series.matchRoute('/api/agent/promote/report/indexDirect').adapter === 'agentBlob', 'agent indexDirect');
  assert(series.matchRoute('/api/agent/promote/reportPc/agentInfo').adapter === 'agentBlob', 'agent reportPc info');
  assert(series.matchRoute('/api/agent/promote/report/teamDataV2').adapter === 'emptyRecords', 'agent teamDataV2');
  assert(series.matchRoute('/api/finance/pay/orderInfo').adapter === 'payOrderInfo', 'pay orderInfo');
  assert(Object.keys(MIGRATION_MAP).length >= 80, 'map size');

  const writeOk = Object.entries(MIGRATION_MAP).filter(([p, e]) => {
    if (e.adapter !== 'lobbyOk') return false;
    return /cancelOrder|setdefault|rejectManual|cancelFavorites|cancelFollow|cancelLike|\/delete$|\/delall$|customDel|\/bind|\/receive|\/redeem|\/upload|\/settle$|transferConfirm|offlineOrder/i.test(p);
  });
  assert(writeOk.length === 0, 'no lobbyOk on mutating paths');
}

function testPayAgentEnv() {
  console.log('\n[2b] pay/agent 生产环境变量覆盖');
  const { loadPayConfig } = require('../src/adapter/providers/wgame/pay-config');
  const { loadAgentConfig } = require('../src/adapter/providers/wgame/agent-config');
  const { applyProductionHooks, isLocalDevUrl } = require('../src/production-hooks');
  const prevPay = process.env.PAY_HTTP_URL;
  const prevAgent = process.env.AGENT_HTTP_BASE;
  try {
    assert(!isLocalDevUrl('https://pay.example.com/create'), 'prod url not local');
    assert(isLocalDevUrl('http://127.0.0.1:3000/api/dev/mock-cashier/create'), 'mock url is local');
    const patched = applyProductionHooks({
      providerOptions: {
        pay: { createOrder: { httpUrl: '', mode: 'staticQr' } },
        agent: { httpBase: '' }
      }
    });
    process.env.PAY_HTTP_URL = 'https://pay.example.com/create';
    const pay = loadPayConfig(siteDir, {});
    assert(pay.createOrder.httpUrl === 'https://pay.example.com/create', 'PAY_HTTP_URL override');
    assert(pay.createOrder.mode === 'http', 'PAY_HTTP_URL sets http mode');
    process.env.AGENT_HTTP_BASE = 'https://agent.example.com';
    const agent = loadAgentConfig(siteDir, {});
    assert(agent.httpBase === 'https://agent.example.com', 'AGENT_HTTP_BASE override');
    assert(agent.useBuiltinMock === false, 'AGENT_HTTP_BASE disables builtin');
    delete process.env.PAY_HTTP_URL;
    delete process.env.AGENT_HTTP_BASE;
    const harPath = path.join(siteDir, 'har-pay-snapshot.json');
    const harLogPath = path.join(root, 'logs', `har-pay-snapshot-${siteId}.json`);
    if (fs.existsSync(harPath) || fs.existsSync(harLogPath)) {
      const payHar = loadPayConfig(siteDir, {});
      const ch = payHar.channelsByPayKind && payHar.channelsByPayKind['100'];
      assert(ch && Array.isArray(ch.list) && ch.list.length >= 1, 'HAR pay channels loaded');
      assert(String(ch.list[0].merch_desc || ch.list[0].channlName || ''), 'HAR channel name');
    }
    const agentHarPath = path.join(siteDir, 'har-agent-snapshot.json');
    const agentHarLog = path.join(root, 'logs', `har-agent-snapshot-${siteId}.json`);
    if (fs.existsSync(agentHarPath) || fs.existsSync(agentHarLog)) {
      const agentHar = loadAgentConfig(siteDir, {});
      assert(agentHar.getIpBindInfo != null, 'HAR agent getIpBindInfo loaded');
    }
  } finally {
    if (prevPay == null) delete process.env.PAY_HTTP_URL;
    else process.env.PAY_HTTP_URL = prevPay;
    if (prevAgent == null) delete process.env.AGENT_HTTP_BASE;
    else process.env.AGENT_HTTP_BASE = prevAgent;
  }
}

function httpRequest(port, method, urlPath, { body, headers } = {}) {
  return new Promise((resolve, reject) => {
    const data = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method,
        headers: Object.assign(
          {
            Accept: 'application/json',
            ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {})
          },
          headers || {}
        )
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = JSON.parse(raw); } catch (_) { /* ignore */ }
          resolve({ status: res.statusCode, headers: res.headers, raw, json });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function testLive() {
  console.log('\n[3] 实机 Bridge @', siteDir);
  if (!fs.existsSync(siteDir)) {
    assert(false, 'site dir missing');
    return;
  }

  // 默认用开发 mock 收银台/代理（export 可保留生产 URL；设 VERIFY_PRODUCTION_HOOKS=1 测真接口）
  if (process.env.VERIFY_PRODUCTION_HOOKS !== '1') {
    if (!process.env.PAY_HTTP_URL) {
      process.env.PAY_HTTP_URL = 'http://127.0.0.1:3000/api/dev/mock-cashier/create';
    }
    if (!process.env.AGENT_HTTP_BASE) {
      process.env.AGENT_HTTP_BASE = 'http://127.0.0.1:3000/api/dev/mock-agent';
    }
  }

  const server = new StaticServer({ spaFallback: true, host: '127.0.0.1' });
  const info = await server.start(siteDir, 3765);
  const port = info.port;
  console.log('  server', info.url);

  try {
    // home：应能回 OSS/本地，不经 wgame；缺参时由服务端补官方 siteCode
    console.log('\n[3a] 首页配置（OSS/aniw，不接 wgame）');
    const home = await httpRequest(port, 'GET', '/api/lobby/site/getSiteInfo');
    assert(
      home.status === 200 || home.status === 404 || home.status === 502 || home.status === 403,
      'getSiteInfo 保持原链路 status=' + home.status + ' (非 bridge 空壳)'
    );
    assert(
      !home.headers['x-sd-adapter'] || home.headers['x-sd-adapter'] !== 'migration-bridge'
      || (home.json && home.json.code !== 1 && !home.json.data),
      'getSiteInfo 不应被 P0 bridge 空数据覆盖'
    );
    const homeIsBridge = home.headers['x-sd-adapter'] === 'migration-bridge';
    assert(!homeIsBridge, 'getSiteInfo not handled by migration-bridge');
    // 补 siteCode 后：应拿到官方站点配置 data.siteCode（非伪造）
    if (home.status === 200 && home.json) {
      const sc = home.json.data && home.json.data.siteCode;
      assert(!!sc, 'getSiteInfo data.siteCode from upstream');
      console.log('  OK  getSiteInfo siteCode=' + sc + ' status=' + (home.json.data && home.json.data.status));
      assert(
        home.json.code == null || home.json.code === 1 || Number(home.json.data && home.json.data.status) === 0,
        'getSiteInfo not Site-id-empty error'
      );
      assert(
        !(home.json.code === 118000000),
        'getSiteInfo must not be Site id empty (118000000)'
      );
    }

    // OSS 静态 *.json：短 /api 路径需补 /hall，否则 oniw AccessDenied
    console.log('\n[3a2] OSS 静态 json（/hall 前缀回源）');
    const ossJson = await httpRequest(
      port,
      'GET',
      '/api/active/category/currency/BRL/language/pt.json'
    );
    assert(ossJson.status === 200, 'OSS json status=' + ossJson.status);
    assert(
      !(typeof ossJson.raw === 'string' && /AccessDenied/i.test(ossJson.raw)),
      'OSS json not AccessDenied'
    );
    assert(
      !!(ossJson.json && (ossJson.json.code === 1 || ossJson.json.data)),
      'OSS json upstream envelope'
    );
    console.log(
      '  OK  OSS json code=' +
        (ossJson.json && ossJson.json.code) +
        ' list=' +
        !!(ossJson.json && ossJson.json.data && ossJson.json.data.activeList)
    );

    // domainMatch：短 /api 需 /hall 回 aniw（加密串由前端生成；此处只验证非 404 HTML）
    // 经本地代理偶发 502，最多重试 3 次
    let dm = null;
    for (let i = 0; i < 3; i++) {
      dm = await httpRequest(port, 'GET', '/api/domain/lobby/domainMatch?siteCode=12025');
      if (dm.status === 200 && dm.json) break;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
    assert(dm.status === 200, 'domainMatch status=' + dm.status);
    assert(
      !(typeof dm.raw === 'string' && /<html/i.test(dm.raw)),
      'domainMatch not upstream 404 HTML'
    );
    assert(!!dm.json, 'domainMatch JSON from aniw');
    console.log('  OK  domainMatch code=' + (dm.json && dm.json.code));
    const account = process.env.WGAME_TEST_ACCOUNT || '';
    const password = process.env.WGAME_TEST_PASSWORD || '';

    if (!account || !password) {
      console.log('\n[3b] 跳过实网登录（设置 WGAME_TEST_ACCOUNT / WGAME_TEST_PASSWORD）');
      try {
        const probePath = path.join(__dirname, '..', 'logs', `wgame-live-probe-${siteId}.json`);
        const probe = JSON.parse(fs.readFileSync(probePath, 'utf8'));
        const wss = probe && probe.wssReachability;
        const liveOk = probe && probe.steps && probe.steps.login && probe.steps.login.ok;
        const wssUrl = (wss && wss.wssUrl)
          || (probe && probe.steps && probe.steps.payChannels && 'wss://server.679win2.com');
        assert(
          (wss && wss.ok === true) || liveOk === true,
          'wgame WSS reachable (' + wssUrl + ')'
        );
        if (wss && wss.ok === true) {
          console.log('  OK  wgame WSS reachable', wss.wssUrl, 'code=' + wss.registerCode);
        } else {
          console.log('  OK  wgame live probe login ok');
        }
      } catch (err) {
        assert(false, 'wgame WSS probe: ' + ((err && err.message) || err) + ' (run yarn wgame-live-probe ' + siteId + ')');
      }

      console.log('\n[3a] register→login（IP170 fallback）+ 弹窗');
      const vpAcc = 'vp0_' + Date.now();
      const vpPwd = 'Test1234!';
      const regFlow = await httpRequest(port, 'POST', '/api/member/register', {
        body: {
          account: vpAcc,
          password: vpPwd,
          confirmPassword: vpPwd,
          device_id: 'fp_vp0'
        }
      });
      assert(regFlow.json && regFlow.json.code === 1, 'register flow code=1');
      assert(
        regFlow.json.data && regFlow.json.data.userInfos && regFlow.json.data.userInfos.session_key,
        'register flow userInfos.session_key'
      );
      const loginFlow = await httpRequest(port, 'POST', '/api/member/login', {
        body: { account: vpAcc, password: vpPwd, userpass: vpPwd }
      });
      assert(loginFlow.json && loginFlow.json.code === 1, 'login after register');
      assert(loginFlow.json.data && loginFlow.json.data.session_key, 'login session_key');
      const flowToken = loginFlow.json.data.session_key;
      const regPop = await httpRequest(port, 'POST', '/api/member/user/registerPopupDlgInfo', {
        body: {},
        headers: { token: flowToken }
      });
      assert(
        regPop.json && regPop.json.code === 1 && Array.isArray(regPop.json.data),
        'registerPopupDlgInfo empty array'
      );
      const regPopAlias = await httpRequest(port, 'POST', '/api/member/registerPopupDlgInfo', {
        body: {},
        headers: { token: flowToken }
      });
      assert(
        regPopAlias.json && regPopAlias.json.code === 1 && Array.isArray(regPopAlias.json.data),
        'registerPopupDlgInfo alias empty array'
      );
      const newcomerPop = await httpRequest(port, 'POST', '/api/active/tasks/newcomer_benefit_pop', {
        body: {},
        headers: { token: flowToken }
      });
      assert(
        newcomerPop.json && newcomerPop.json.code === 1 && Array.isArray(newcomerPop.json.data),
        'newcomer_benefit_pop empty array'
      );
      console.log('  OK  register→login + popups');

      const mockAgent = await httpRequest(port, 'POST', '/api/dev/mock-agent/indexInfo', { body: {} });
      assert(mockAgent.json && mockAgent.json.code === 1 && mockAgent.json.data, 'mock agent indexInfo');
      const mockTeam = await httpRequest(port, 'POST', '/api/dev/mock-agent/teamDataV2', { body: { token: 'v' } });
      assert(
        mockTeam.json && mockTeam.json.code === 1 && Array.isArray(mockTeam.json.data.list),
        'mock agent teamDataV2'
      );
      console.log('  OK  mock agent HTTP indexInfo+teamDataV2');

      // 用 provider 注入会话，验证 user.info + gold 链路
      console.log('\n[3b] 注入会话验证 user.info + wallet.gold');
      const provider = getProvider('wgame');
      const fake = {
        account: 'verify_p0',
        session: 'sk_verify_p0',
        userId: '10001',
        game_gold: 88,
        nickname: 'verify_p0',
        vip_level: 1,
        account_type: 2,
        device_id: 'fp_test'
      };
      provider.sessions.set(fake.account, { user: fake, at: Date.now() });
      provider.sessions.set('sk:' + fake.session, { user: fake, at: Date.now() });
      provider.sessions.set('uid:' + fake.userId, { user: fake, at: Date.now() });

      const infoRes = await httpRequest(port, 'POST', '/api/member/user/info', {
        body: {},
        headers: { token: fake.session }
      });
      assert(infoRes.headers['x-sd-adapter'] === 'migration-bridge', 'user.info via bridge');
      assert(infoRes.json && infoRes.json.code === 1, 'user.info code=1');
      assert(infoRes.json.data && infoRes.json.data.session_key === fake.session, 'user.info session');
      assert(infoRes.json.data.game_gold === 88, 'user.info gold');
      assert(infoRes.json.data.permissionOpt && infoRes.json.data.permissionOpt.hasPassword === true, 'permissionOpt');
      assert(
        infoRes.json.data.portrait_id
        && String(infoRes.json.data.portrait_id).startsWith('https://'),
        'user.info portrait_id CDN'
      );
      assert(infoRes.json.data.username === 10001 || infoRes.json.data.username === '10001', 'username is member id');
      assert(infoRes.json.data.nickname === 'verify_p0' || infoRes.json.data.nickname === '', 'nickname present or empty');

      const fast = await httpRequest(port, 'POST', '/api/member/getFastLogin', {
        body: { encryptString: 'x' },
        headers: { token: fake.session }
      });
      assert(fast.json && fast.json.code === 1, 'getFastLogin session-reuse code=1');
      assert(
        fast.json.data
        && (fast.json.data.username === 10001 || fast.json.data.username === '10001'),
        'getFastLogin profile'
      );

      const gold = await httpRequest(port, 'POST', '/api/gameCenter/gold', {
        body: {},
        headers: { token: fake.session }
      });
      assert(gold.json && gold.json.code === 1 && gold.json.data.game_gold === 88, 'wallet.gold');

      const vip = await httpRequest(port, 'POST', '/api/member/user/vip', {
        body: {},
        headers: { token: fake.session }
      });
      assert(vip.json && vip.json.code === 1 && vip.json.data.vip === 1, 'user.vip from session');

      const vipDetails = await httpRequest(port, 'POST', '/api/member/user/vipDetails', {
        body: {},
        headers: { token: fake.session }
      });
      assert(
        vipDetails.json
        && vipDetails.json.code === 1
        && vipDetails.json.data.current_style === 2
        && vipDetails.json.data.icon_style,
        'vipDetails official-like shape'
      );

      const avatars = await httpRequest(port, 'POST', '/api/member/user/avatars', {
        body: {},
        headers: { token: fake.session }
      });
      assert(avatars.json && avatars.json.code === 1 && avatars.json.data.list.length >= 1, 'user.avatars');

      const pay = await httpRequest(port, 'POST', '/api/finance/pay/payListV4', {
        body: {},
        headers: { token: fake.session }
      });
      assert(pay.headers['x-sd-adapter'] === 'migration-bridge', 'payList via bridge');
      assert(
        pay.json && pay.json.code === 1 && pay.json.data && Array.isArray(pay.json.data.list) && pay.json.data.list.length >= 1,
        'payList categories from config'
      );

      const payType = await httpRequest(port, 'POST', '/api/finance/pay/payTypeV4', {
        body: { type: 0 },
        headers: { token: fake.session }
      });
      assert(
        payType.json
        && payType.json.code === 1
        && payType.json.data
        && payType.json.data.payKind
        && Array.isArray(payType.json.data.payKind.list)
        && payType.json.data.payKind.list.length >= 1,
        'payType payKind.list'
      );

      const channels = await httpRequest(port, 'POST', '/api/finance/pay/payplatformlistV3', {
        body: { payKind: 100 },
        headers: { token: fake.session }
      });
      assert(
        channels.json
        && channels.json.code === 1
        && channels.json.data
        && Array.isArray(channels.json.data.list)
        && channels.json.data.list.length >= 1,
        'payChannels list'
      );

      const order = await httpRequest(port, 'POST', '/api/finance/pay/offlineOrderV3', {
        body: { money: '50', payCurrency: 'BRL' },
        headers: { token: fake.session }
      });
      assert(
        order.json
        && order.json.code === 1
        && order.json.data
        && order.json.data.success === true
        && order.json.data.orderNo
        && order.json.data.qrCode,
        'payCreate order+qr'
      );
      assert(
        String(order.json.data.qrCode).includes('MOCK-')
        || String(order.json.data.qrCode).includes('PLACEHOLDER')
        || String(order.json.data.qrCode).startsWith('000201'),
        'payCreate qr payload'
      );

      const orderInfo = await httpRequest(port, 'POST', '/api/finance/pay/orderInfo', {
        body: { orderNo: order.json.data.orderNo },
        headers: { token: fake.session }
      });
      assert(
        orderInfo.json
        && orderInfo.json.code === 1
        && orderInfo.json.data
        && orderInfo.json.data.orderNo === order.json.data.orderNo,
        'pay orderInfo poll'
      );

      const agentMode = await httpRequest(port, 'POST', '/api/agent/promote/config/agentMode', {
        body: {},
        headers: { token: fake.session }
      });
      assert(
        agentMode.json && agentMode.json.code === 1 && agentMode.json.data
        && agentMode.json.data.agent_id != null,
        'agentMode blob'
      );
      assert(
        agentMode.json.data.settleDurationDays != null,
        'agentMode settleDurationDays'
      );

      const agentIndex = await httpRequest(port, 'POST', '/api/agent/promote/report/indexInfo', {
        body: {},
        headers: { token: fake.session }
      });
      assert(agentIndex.json && agentIndex.json.code === 1 && agentIndex.json.data, 'agent indexInfo');
      assert(
        agentIndex.json.data.directCount != null || agentIndex.json.data.todayDirect != null,
        'agent indexInfo builtin mock shape'
      );

      const agentDirect = await httpRequest(port, 'POST', '/api/agent/promote/report/indexDirect', {
        body: {},
        headers: { token: fake.session }
      });
      assert(agentDirect.json && agentDirect.json.code === 1 && agentDirect.json.data, 'agent indexDirect');

      const agentPc = await httpRequest(port, 'GET', '/api/agent/promote/reportPc/agentInfo', {
        headers: { token: fake.session }
      });
      assert(agentPc.json && agentPc.json.code === 1 && agentPc.json.data, 'agent reportPc info');

      const agentTeam = await httpRequest(port, 'POST', '/api/agent/promote/report/teamDataV2', {
        body: {},
        headers: { token: fake.session }
      });
      assert(agentTeam.json && agentTeam.json.code === 1 && Array.isArray(agentTeam.json.data.list), 'agent teamDataV2');

      const agentClub = await httpRequest(port, 'POST', '/api/agent/promote/report/clubCommission', {
        body: {},
        headers: { token: fake.session }
      });
      assert(
        agentClub.json && agentClub.json.code === 1 && Array.isArray(agentClub.json.data.list),
        'agent clubCommission extra http'
      );

      const agentComm = await httpRequest(port, 'POST', '/api/agent/promote/report/myCommissionV2', {
        body: {},
        headers: { token: fake.session }
      });
      assert(agentComm.json && agentComm.json.code === 1 && agentComm.json.data, 'agent myCommissionV2');
      assert(agentComm.json.data.totalCommission != null, 'agent commission totalCommission');

      const wd = await httpRequest(port, 'POST', '/api/finance/certify/withdrawRecord', {
        body: {},
        headers: { token: fake.session }
      });
      assert(wd.json && wd.json.code === 1 && Array.isArray(wd.json.data.list), 'withdrawRecord empty list');

      const ws = await httpRequest(port, 'POST', '/api/finance/certify/withdrawSettingV3', {
        body: {},
        headers: { token: fake.session }
      });
      assert(ws.json && ws.json.code === 10060 && ws.json.data === null, 'withdrawSetting pending');

      const hb = await httpRequest(port, 'POST', '/api/gohal/heartbeat', {
        body: {},
        headers: { token: fake.session }
      });
      assert(hb.json && hb.json.code === 1, 'heartbeat lobbyOk');

      const rd = await httpRequest(port, 'POST', '/api/active/getRedDotV2', {
        body: {},
        headers: { token: fake.session }
      });
      assert(rd.json && rd.json.code === 1 && rd.json.data.activeCount === 0, 'redDotEmpty');

      const fp = await httpRequest(port, 'POST', '/api/member/getFingerprint', {
        body: {},
        headers: { token: fake.session }
      });
      assert(
        fp.json && fp.json.code === 1 && fp.json.data.deviceFingerprint === 'fp_test',
        'fingerprint from session'
      );

      const la = await httpRequest(port, 'POST', '/api/member/listAccount', {
        body: {},
        headers: { token: fake.session }
      });
      assert(
        la.json && la.json.code === 1 && Array.isArray(la.json.data.list) && la.json.data.list.length === 1,
        'listAccount current only'
      );

      const lo = await httpRequest(port, 'POST', '/api/member/logout', {
        body: {},
        headers: { token: fake.session }
      });
      assert(lo.json && lo.json.code === 1, 'logout ok');
      return;
    }

    console.log('\n[3b] 实网登录', account);
    const login = await httpRequest(port, 'POST', '/api/member/login', {
      body: { username: account, account, password, userpass: password, _sdPlain: 1 }
    });
    console.log('  login', login.json && login.json.code, login.json && login.json.msg);
    assert(login.json && login.json.code === 1, 'auth.login success');
    assert(login.json.data && login.json.data.session_key, 'auth.login session_key');
    const token = login.json.data.session_key;

    const u = await httpRequest(port, 'POST', '/api/member/user/info', {
      body: {},
      headers: { token }
    });
    assert(u.json && u.json.code === 1, 'user.info after login');
    assert(u.json.data.username, 'user.info username');

    const g = await httpRequest(port, 'POST', '/api/gameCenter/gold', {
      body: {},
      headers: { token }
    });
    assert(g.json && g.json.code === 1 && typeof g.json.data.game_gold === 'number', 'wallet.gold after login');
  } finally {
    await server.stop();
  }
}

async function main() {
  console.log('P0 verify siteDir =', siteDir);
  testAdapters();
  testMap();
  testPayAgentEnv();
  await testLive();
  console.log('\n==== Result: passed=%d failed=%d ====', passed, failed);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
