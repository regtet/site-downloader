const path = require('path');
const axios = require('axios');
const { applySystemProxy } = require('../src/system-proxy');
const { loadAdapterConfig } = require('../src/adapter/config');
const provider = require('../src/adapter/providers/wgame');

applySystemProxy({ log: false });

async function main() {
  const siteDir = path.join(__dirname, '..', 'output', '713win');
  const cfg = loadAdapterConfig(siteDir, require('fs'), path);
  const login = await provider.execute('auth.login', {
    siteDir,
    body: {
      username: process.env.OUR_ACCOUNT,
      userpass: process.env.OUR_PASSWORD,
      _sdPlain: 1
    }
  });
  console.log('login', JSON.stringify({
    ok: login.ok,
    code: login.code,
    msg: login.msg,
    userId: login.data && login.data.userId,
    upstream: cfg.upstreamOrigin,
    siteCode: cfg.siteCode
  }));

  const origins = [
    'https://aniw317.713win.com',
    'https://aniw317.713win.cc',
    'https://713win.com'
  ];
  for (const origin of origins) {
    const url = origin + '/hall/api/active/category?siteCode=' + encodeURIComponent(cfg.siteCode || '') + '&currency=BRL&language=pt';
    try {
      const res = await axios.post(url, {}, {
        timeout: 15000,
        validateStatus: () => true,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Content-Type': 'application/json',
          Origin: 'https://713win.com',
          Referer: 'https://713win.com/'
        }
      });
      const text = Buffer.isBuffer(res.data) ? res.data.toString('utf8') : (typeof res.data === 'string' ? res.data : JSON.stringify(res.data));
      console.log(origin, res.status, text.slice(0, 180));
    } catch (err) {
      console.log(origin, 'ERR', err && err.message);
    }
  }
}

main().catch((err) => {
  console.error(err && err.message || err);
  process.exit(1);
});
