/**
 * Bridge 冒烟：注入会话后批量打已映射路由，检查不抛错且有 code
 * 用法: node scripts/smoke-bridge-routes.js [679win]
 */
const http = require('http');
const path = require('path');
const { createStaticServer } = require('../src/static-server');
const { loadAdapterConfig } = require('../src/adapter/config');
const { getProvider } = require('../src/adapter/providers');
const { MIGRATION_MAP } = require('../src/adapter/series/aniw-lobby/migration-map');

const siteId = process.argv[2] || '679win';
const siteDir = path.join(__dirname, '..', 'output', siteId);

function request(port, urlPath, token) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from('{}');
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: urlPath,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': body.length,
          token
        },
        timeout: 8000
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try {
            json = JSON.parse(text);
          } catch (_) {}
          resolve({ status: res.statusCode, json, adapter: res.headers['x-sd-adapter'] });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout ' + urlPath));
    });
    req.write(body);
    req.end();
  });
}

async function main() {
  const cfg = loadAdapterConfig(siteDir, require('fs'), path);
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

  const provider = getProvider('wgame');
  const fake = {
    account: 'smoke_user',
    session: 'sk_smoke_' + Date.now(),
    userId: '20002',
    game_gold: 1,
    nickname: '',
    vip_level: 0,
    account_type: 2,
    device_id: 'fp_smoke'
  };
  provider.sessions.set(fake.account, { user: fake, at: Date.now() });
  provider.sessions.set('sk:' + fake.session, { user: fake, at: Date.now() });
  provider.sessions.set('uid:' + fake.userId, { user: fake, at: Date.now() });

  const paths = Object.keys(MIGRATION_MAP).sort();
  // 抽样：核心 + 每类若干 + 全部 pending/empty 的代表
  const sample = [
    '/api/member/user/info',
    '/api/member/listAccount',
    '/api/member/getFingerprint',
    '/api/member/user/vipInfoV2',
    '/api/agent/promote/getIpBindInfo',
    '/api/gameCenter/gold',
    '/api/finance/pay/payListV4',
    '/api/finance/certify/withdrawRecord',
    '/api/active/getRedDotV2',
    '/api/message/list/all',
    '/api/gohal/heartbeat'
  ];
  // 再随机抽 40 条
  for (let i = 0; i < paths.length && sample.length < 50; i += Math.max(1, Math.floor(paths.length / 40))) {
    const p = paths[i];
    if (!sample.includes(p)) sample.push(p);
  }

  const results = [];
  let fail = 0;
  for (const p of sample) {
    try {
      const res = await request(port, p, fake.session);
      const ok =
        res.status === 200
        && res.adapter === 'migration-bridge'
        && res.json
        && res.json.code != null;
      if (!ok) fail += 1;
      results.push({
        path: p,
        ok,
        code: res.json && res.json.code,
        adapter: MIGRATION_MAP[p] && MIGRATION_MAP[p].adapter
      });
    } catch (err) {
      fail += 1;
      results.push({ path: p, ok: false, error: String(err && err.message || err) });
    }
  }

  server.close();
  const out = {
    at: new Date().toISOString(),
    mapSize: paths.length,
    sampled: sample.length,
    failed: fail,
    results
  };
  const outPath = path.join(__dirname, '..', 'logs', `smoke-bridge-${siteId}.json`);
  require('fs').mkdirSync(path.dirname(outPath), { recursive: true });
  require('fs').writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ sampled: sample.length, failed: fail, outPath }, null, 2));
  process.exit(fail ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
