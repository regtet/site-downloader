require('../src/playwright-env');
const { chromium } = require('playwright');
const http = require('http');

function postJson(port, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload));
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

(async () => {
  const started = await postJson(3000, '/api/preview/start', {
    path: require('path').join(__dirname, '..', 'output', '713win'),
    mode: 'ours'
  });
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: 'http://127.0.0.1:7890', bypass: '127.0.0.1,localhost' }
  });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('request', (req) => {
    if (!/active\/category|\/api\/active\//i.test(req.url())) return;
    const h = req.headers();
    const keys = Object.keys(h).sort();
    console.log('URL', req.url().slice(0, 160));
    console.log('KEYS', keys.join(','));
    console.log('HAS', ['token', 'newjwt', 'authorization', 'userid', 'cookie'].filter((k) => h[k]).join(','));
  });
  page.on('response', async (res) => {
    if (!/active\/category/i.test(res.url())) return;
    let t = '';
    try { t = (await res.text()).slice(0, 80); } catch (_) { t = 'na'; }
    console.log('RES', res.status(), res.headers()['x-sd-auth-sanitized'] || '-', t.replace(/\s+/g, ' '));
  });
  const login = await postJson(started.port, '/hall/api/member/login', {
    username: process.env.OUR_ACCOUNT,
    account: process.env.OUR_ACCOUNT,
    userpass: process.env.OUR_PASSWORD,
    password: process.env.OUR_PASSWORD,
    _sdPlain: 1
  });
  const ui = login && login.data;
  if (!ui || !ui.session_key) throw new Error('login failed ' + JSON.stringify(login).slice(0, 180));
  await page.goto('http://127.0.0.1:' + started.port + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((userInfos) => {
    const payload = JSON.stringify({ userInfos });
    localStorage.setItem('web__lobby__persisted__user', payload);
    localStorage.setItem('token', userInfos.session_key || '');
  }, ui);
  await page.goto('http://127.0.0.1:' + started.port + '/home/event?eventCurrent=1', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);
  const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 200));
  console.log('TEXT', text);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
