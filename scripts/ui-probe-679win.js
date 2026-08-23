/**
 * UI 探测：登录后访问 5 类页面，截图 + 记录关键 API 响应
 * 用法: node scripts/ui-probe-679win.js [679win] [previewPort]
 */
require('../src/playwright-env');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const siteId = process.argv[2] || '679win';
const previewPort = Number(process.argv[3] || 0);
const siteDir = path.join(__dirname, '..', 'output', siteId);
const outDir = path.join(__dirname, '..', 'logs', 'ui-probe-' + siteId);
const account = process.env.WGAME_TEST_ACCOUNT || 'qq123123';
const password = process.env.WGAME_TEST_PASSWORD || 'qq123123';

async function resolvePort() {
  if (previewPort > 0) return previewPort;
  const http = require('http');
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({ path: siteDir }));
    const req = http.request({
      hostname: '127.0.0.1', port: 3000, path: '/api/preview/start', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data).port); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function apiLogin(port) {
  const http = require('http');
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      account, password, userpass: password
    }));
    const req = http.request({
      hostname: '127.0.0.1', port, path: '/api/member/login', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const port = await resolvePort();
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ignoreHTTPSErrors: true
  });
  const page = await context.newPage();
  const apiLog = [];
  const loginJson = await apiLogin(port);
  const userInfos = loginJson && loginJson.data;
  const token = userInfos && userInfos.session_key;

  await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  if (token && userInfos) {
    await page.evaluate((ui) => {
      try {
        const keys = [
          'web__lobby__persisted__user',
          'lobby@persisted@user',
          'LOBBY_USER_INFO'
        ];
        const payload = JSON.stringify({ userInfos: ui });
        for (const key of keys) {
          localStorage.setItem(key, payload);
        }
        localStorage.setItem('token', ui.session_key || '');
        sessionStorage.setItem('token', ui.session_key || '');
      } catch (_) { /* ignore */ }
    }, userInfos);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4000);
  }

  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/api\//i.test(url)) return;
    const short = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    if (!/(category|getByTemplate|payTypeSetting|payplatformlist|vipInfo|registerPopup|newcomer|agent|staffAll)/i.test(short)) return;
    let sample = '';
    try {
      const ct = res.headers()['content-type'] || '';
      if (/json|text|javascript/i.test(ct)) {
        sample = (await res.text()).slice(0, 200);
      }
    } catch (_) { /* ignore */ }
    apiLog.push({ status: res.status(), path: short, sample });
  });

  const report = { at: new Date().toISOString(), port, base, login: !!(token), pages: {}, apiLog };

  try {
    const routes = [
      { key: 'event', path: '/home/event?eventCurrent=1' },
      { key: 'pay', path: '/home/deposit' },
      { key: 'profile', path: '/home/mine' },
      { key: 'agent', path: '/home/promote' }
    ];

    for (const r of routes) {
      try {
        if (r.key === 'pay') {
          await page.goto(base + '/home/mine', { waitUntil: 'domcontentloaded', timeout: 60000 });
          await page.waitForTimeout(2000);
          const dep = page.locator('text=Depósito').first();
          if (await dep.count()) await dep.click();
          else await page.goto(base + r.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } else {
          await page.goto(base + r.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
        await page.waitForTimeout(6000);
        const shot = path.join(outDir, r.key + '.png');
        await page.screenshot({ path: shot, fullPage: true });
        const info = await page.evaluate(() => ({
          title: document.title,
          url: location.href,
          imgCount: document.querySelectorAll('img').length,
          text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 400)
        }));
        report.pages[r.key] = { shot, ...info };
      } catch (err) {
        report.pages[r.key] = { error: String(err && err.message || err) };
      }
    }
  } finally {
    await browser.close();
  }

  const outPath = path.join(outDir, 'report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: true, outPath, shots: Object.keys(report.pages) }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
