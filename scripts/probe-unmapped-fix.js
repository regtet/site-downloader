require('../src/system-proxy').applySystemProxy({ log: false });
const path = require('path');
const http = require('http');
const { StaticServer } = require('../src/static-server');

function req(port, method, p, body) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    const r = http.request(
      { hostname: '127.0.0.1', port, path: p, method, headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => resolve({
          status: res.statusCode,
          adapter: res.headers['x-sd-adapter'],
          json: JSON.parse(data)
        }));
      }
    );
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

(async () => {
  const siteDir = path.join(__dirname, '..', 'output', '679win');
  const server = new StaticServer({ spaFallback: true, host: '127.0.0.1' });
  const info = await server.start(siteDir, 3771);
  const tests = [
    ['GET', '/api/platform/lang', null],
    ['POST', '/api/platform/config', {}],
    ['POST', '/api/platform/site', {}],
    ['GET', '/api/finance/maxChargeRate', null],
    ['GET', '/api/active/category', null],
    ['POST', '/api/active/tasks/newcomer_benefit_pop', {}],
    ['POST', '/api/agent/promote/commissionMarquee', {}]
  ];
  for (const [method, p, body] of tests) {
    const r = await req(info.port, method, p, body);
    console.log(
      method,
      p,
      'adapter=' + (r.adapter || '-'),
      'code=' + (r.json && r.json.code),
      Array.isArray(r.json && r.json.data) ? 'array[' + r.json.data.length + ']' : ''
    );
  }
  await server.stop();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
