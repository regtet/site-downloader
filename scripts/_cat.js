const axios = require('axios');
const { applySystemProxy } = require('../src/system-proxy');
applySystemProxy({ log: false });

const headers = {
  'User-Agent': 'Mozilla/5.0',
  Origin: 'https://713win.com',
  Referer: 'https://713win.com/',
  siteCode: '12578',
  language: 'pt',
  currency: 'BRL',
  'x-version': '7.5.83',
  'content-type': 'application/json',
  accept: 'application/json, text/plain, */*'
};

async function hit(method, url, extra) {
  const res = await axios({
    url,
    method,
    headers: Object.assign({}, headers, extra || {}),
    data: method === 'GET' ? undefined : {},
    timeout: 20000,
    validateStatus: () => true,
    responseType: 'arraybuffer'
  });
  const text = Buffer.from(res.data || []).toString('utf8');
  const jsonish = text.trim().startsWith('{');
  console.log(method, extra && extra.newJwt ? 'withJwt' : 'noJwt', res.status, jsonish ? text.slice(0, 160) : ('cipher ' + text.length));
}

async function main() {
  const base = 'https://aniw317.713win.cc/hall/api/active/category?siteCode=12578&currency=BRL&language=pt';
  const login = require('fs').readFileSync('logs/diff-login/ours-login.txt', 'utf8');
  const m = login.match(/"session_key":"([^"]+)"/);
  const jwt = m ? m[1] : '';
  await hit('GET', base, {});
  await hit('GET', base, { newJwt: jwt, token: jwt });
}
main().catch((e) => { console.error(e.message); process.exit(1); });
