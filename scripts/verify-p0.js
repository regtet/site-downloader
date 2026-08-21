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
  assert(m.username === 'u1', 'username');
  assert(m.nickname === 'Nick', 'nickname');
  assert(m.session_key === 'sk_test' && m.jwt_token === 'sk_test', 'session aliases');
  assert(m.userkey === '42', 'userkey');
  assert(m.game_gold === 12.5, 'game_gold');
  assert(m.account_type === 2, 'account_type from wgame only');
  assert(m.currency === undefined, 'no forged currency');
  assert(m.permissionOpt === undefined, 'no forged permissionOpt');
  assert(m.bonus === undefined, 'no forged bonus');
  assert(m.platfromid === undefined, 'no forged platfromid');
  assert(m.portrait_id === DEFAULT_PORTRAIT, 'portrait_id is URL path not face id');
  assert(m.face_id === '7', 'keep raw face_id separately');
  assert(m.vip_level === 3, 'vip_level');

  const lean = memberProfile({ account: 'a', session: 's', userId: '1', game_gold: 0 });
  assert(lean.phone === undefined, 'omit missing phone');
  assert(lean.portrait_id === DEFAULT_PORTRAIT, 'default portrait always');

  const w = adaptWalletGold({ ok: true, data: { game_gold: 9 } });
  assert(w.code === 1 && w.data.game_gold === 9 && w.data.totalGold === 9, 'walletGold aliases');
  assert(w.data.bonus === undefined, 'wallet no forged bonus');

  const fail = adaptMemberProfile({ ok: false, code: 139, msg: 'Password error' });
  assert(fail.code === 139 && fail.data === null, 'login fail envelope');

  const vip = adaptVipSummary({ ok: true, data: { vip_level: 2 } });
  assert(vip.code === 1 && vip.data.vip === 2 && vip.data.need_deposit === undefined, 'vip no forged deposit');

  const av = adaptAvatars({ ok: true, data: { face_id: '3' } });
  assert(av.code === 1 && Array.isArray(av.data.list) && av.data.list.length >= 1, 'avatars list');

  const pay = adaptPayPending({ ok: false, code: 10060, msg: 'pending' });
  assert(pay.code === 10060 && pay.data === null, 'pay pending fails explicitly');
}

function testMap() {
  console.log('\n[2] migration-map');
  const series = getSeries('aniw-lobby');
  assert(series.matchRoute('/hall/api/member/login').op === 'auth.login', 'login map');
  assert(series.matchRoute('/api/member/getFastLogin').op === 'user.info', 'getFastLogin → session');
  assert(series.matchRoute('/api/member/user/info').adapter === 'memberProfile', 'user.info');
  assert(series.matchRoute('/api/gameCenter/gold').op === 'wallet.gold', 'gold');
  assert(series.matchRoute('/api/member/user/vip').adapter === 'vipSummary', 'vip');
  assert(series.matchRoute('/api/member/user/avatars').adapter === 'avatars', 'avatars');
  assert(series.matchRoute('/api/finance/pay/payListV4').adapter === 'payPending', 'payList pending fail');
  assert(series.matchRoute('/api/member/user/vipInfoV2') === null, 'vipInfoV2 still pending');
  assert(series.matchRoute('/api/active/receivedAwardList') === null, 'no empty stub for activity');
  assert(Object.keys(MIGRATION_MAP).length >= 15, 'map size');
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

  const server = new StaticServer({ spaFallback: true, host: '127.0.0.1' });
  const info = await server.start(siteDir, 3765);
  const port = info.port;
  console.log('  server', info.url);

  try {
    // home：应能回 OSS/本地，不经 wgame
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
    // 更准：adapter 头不存在则 OK
    const homeIsBridge = home.headers['x-sd-adapter'] === 'migration-bridge';
    assert(!homeIsBridge, 'getSiteInfo not handled by migration-bridge');

    const account = process.env.WGAME_TEST_ACCOUNT || '';
    const password = process.env.WGAME_TEST_PASSWORD || '';

    if (!account || !password) {
      console.log('\n[3b] 跳过实网登录（设置 WGAME_TEST_ACCOUNT / WGAME_TEST_PASSWORD）');
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
        account_type: 2
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
      assert(infoRes.json.data.permissionOpt === undefined, 'user.info no forged permissionOpt');
      assert(
        infoRes.json.data.portrait_id
        && String(infoRes.json.data.portrait_id).startsWith('/lobby_asset/'),
        'user.info portrait_id is asset path'
      );

      const fast = await httpRequest(port, 'POST', '/api/member/getFastLogin', {
        body: { encryptString: 'x' },
        headers: { token: fake.session }
      });
      assert(fast.json && fast.json.code === 1, 'getFastLogin session-reuse code=1');
      assert(fast.json.data && fast.json.data.username === 'verify_p0', 'getFastLogin profile');

      const gold = await httpRequest(port, 'POST', '/api/gameCenter/gold', {
        body: {},
        headers: { token: fake.session }
      });
      assert(gold.json && gold.json.code === 1 && gold.json.data.game_gold === 88, 'wallet.gold');
      assert(gold.json.data.bonus === undefined, 'wallet no forged bonus');

      const vip = await httpRequest(port, 'POST', '/api/member/user/vip', {
        body: {},
        headers: { token: fake.session }
      });
      assert(vip.json && vip.json.code === 1 && vip.json.data.vip === 1, 'user.vip from session');
      assert(vip.json.data.need_deposit === undefined, 'vip no forged deposit');

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
      assert(pay.json && pay.json.code === 10060 && pay.json.data === null, 'payList explicit pending fail');
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
  await testLive();
  console.log('\n==== Result: passed=%d failed=%d ====', passed, failed);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
