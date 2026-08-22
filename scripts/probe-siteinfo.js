/** 探测 getSiteInfo 在 OSS / aniw 上的可达性 */
require('../src/system-proxy').ensureSystemProxyEnv && require('../src/system-proxy').ensureSystemProxyEnv();
const axios = require('axios');

async function probe(url, method) {
  try {
    const res = await axios({
      url,
      method,
      timeout: 20000,
      validateStatus: () => true,
      headers: {
        Accept: 'application/json,*/*',
        'User-Agent': 'Mozilla/5.0',
        Origin: 'https://www.679win.com',
        Referer: 'https://www.679win.com/'
      },
      data: method === 'POST' ? {} : undefined
    });
    const ct = String(res.headers['content-type'] || '');
    let body = res.data;
    if (typeof body !== 'string') body = JSON.stringify(body);
    return { url, method, status: res.status, ct: ct.slice(0, 60), body: String(body).slice(0, 160) };
  } catch (err) {
    return { url, method, error: String(err && err.message || err) };
  }
}

async function main() {
  const oss = 'https://oniw976.679win.cc';
  const aniw = 'https://aniw976.679win.me';
  const paths = [
    '/api/lobby/site/getSiteInfo',
    '/hall/api/lobby/site/getSiteInfo',
    '/api/lobby/webapi/optimizationV2/site/config'
  ];
  const out = [];
  for (const p of paths) {
    out.push(await probe(oss + p, 'GET'));
    out.push(await probe(aniw + p, 'POST'));
  }
  console.log(JSON.stringify(out, null, 2));
}

main();
