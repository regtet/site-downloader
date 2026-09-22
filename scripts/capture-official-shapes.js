/**
 * 登录官方站，走主页面，记下浏览器解开后的接口结构。
 * 账号从环境变量读取。产物在 logs/official-shapes/，不入库。
 */
require('../src/playwright-env');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const outDir = path.join(__dirname, '..', 'logs', 'official-shapes');
const base = process.env.OFFICIAL_BASE || 'https://719win.com';

const routes = [
  '/',
  '/home/event?eventCurrent=1',
  '/home/task?eventCurrent=1',
  '/home/vip',
  '/home/cashback',
  '/home/canReceive',
  '/home/claim',
  '/home/mine',
  '/home/withdraw',
  '/home/promote',
  '/home/notice',
  '/home/security',
  '/home/setting',
  '/home/records',
  '/home/center-wallet',
  '/home/yuebao',
  '/home/discount'
];

const HOOK = `(() => {
  if (window.__sdCapHook) return;
  window.__sdCapHook = true;
  window.__sdCaps = [];
  window.__sdLastUrl = '';
  function note(url, body) {
    try {
      if (!body || typeof body !== 'object' || Array.isArray(body)) return;
      if (!Object.prototype.hasOwnProperty.call(body, 'code')) return;
      if (!Object.prototype.hasOwnProperty.call(body, 'data')) return;
      var u = String(url || window.__sdLastUrl || '');
      if (u.indexOf('/api/') === -1 && u.indexOf('/hall/') === -1) return;
      window.__sdCaps.push({ url: u, body: body });
      if (window.__sdCaps.length > 400) window.__sdCaps.shift();
    } catch (e) {}
  }
  var origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    var value = origParse.call(this, text, reviver);
    note(window.__sdLastUrl, value);
    return value;
  };
  var xoOpen = XMLHttpRequest.prototype.open;
  var xoSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__sdUrl = String(url || '');
    return xoOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    this.addEventListener('load', function () {
      var url = self.__sdUrl || '';
      window.__sdLastUrl = url;
      var raw = self.response;
      if (typeof raw === 'string') {
        try { note(url, origParse(raw)); } catch (e) {}
      } else {
        note(url, raw);
      }
    });
    return xoSend.apply(this, arguments);
  };
})();`;

function shapeOf(value, depth) {
  if (depth > 5) return 'deep';
  if (value == null) return null;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      len: value.length,
      item: value.length ? shapeOf(value[0], depth + 1) : null
    };
  }
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = shapeOf(value[key], depth + 1);
    return out;
  }
  return typeof value;
}

function sampleOf(value, depth) {
  if (depth > 4) return null;
  if (value == null || typeof value !== 'object') {
    if (typeof value === 'string') return value.slice(0, 80);
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 1).map((item) => sampleOf(item, depth + 1));
  const out = {};
  for (const key of Object.keys(value).slice(0, 40)) out[key] = sampleOf(value[key], depth + 1);
  return out;
}

function normPath(raw) {
  let p = String(raw || '').split('?')[0].split('#')[0];
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch (_) { /* ignore */ }
  if (p.startsWith('/hall/api/')) p = '/api/' + p.slice('/hall/api/'.length);
  p = p.replace(/\/currency\/[^/]+/gi, '');
  p = p.replace(/\/language\/[^/]+/gi, '');
  p = p.replace(/\/osType\/[^/]+/gi, '');
  p = p.replace(/\/platformType\/[^/]+/gi, '');
  p = p.replace(/\/siteCode\/[^/]+/gi, '');
  p = p.replace(/\.json$/i, '');
  p = p.replace(/\/default$/i, '');
  return p.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

async function loginUi(page) {
  await page.waitForTimeout(3000);
  const loginBtn = page.getByText('Login', { exact: true });
  await loginBtn.first().click({ timeout: 8000 });
  const user = page.getByPlaceholder(/Celular|Conta|account|usu[aá]rio/i).first();
  try {
    await user.waitFor({ timeout: 5000 });
  } catch (_) {
    await loginBtn.nth(1).click({ timeout: 5000 }).catch(() => loginBtn.first().click({ force: true }));
    await user.waitFor({ timeout: 8000 });
  }
  const pass = page.getByPlaceholder(/senha|password/i).first();
  await user.click({ force: true });
  await user.fill(process.env.OFFICIAL_ACCOUNT || '');
  await pass.click({ force: true });
  await pass.fill(process.env.OFFICIAL_PASSWORD || '');
  const submit = page.locator('.ui-button').filter({ hasText: /^Login$/ }).last();
  await submit.click({ force: true, timeout: 8000 });
  await page.waitForTimeout(10000);
  const still = await page.getByPlaceholder(/senha|password/i).count();
  if (still) {
    await submit.click({ force: true, timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(8000);
  }
}

async function drain(page, bucket, pageKey) {
  const rows = await page.evaluate(() => {
    const list = window.__sdCaps || [];
    window.__sdCaps = [];
    return list;
  });
  for (const row of rows) {
    bucket.push({ page: pageKey, url: row.url, body: row.body });
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    proxy: { server: 'http://127.0.0.1:7890', bypass: '127.0.0.1,localhost' }
  });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true
  });
  await context.addInitScript(HOOK);
  const page = await context.newPage();
  const bucket = [];
  const pageNotes = {};
  try {
    await page.goto(base + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await loginUi(page);
    await page.screenshot({ path: path.join(outDir, 'after-login.png') });
    const logged = await page.evaluate(() => (document.body.innerText || '').slice(0, 180));
    pageNotes.login = logged;
    for (const route of routes) {
      try {
        await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(7000);
        await drain(page, bucket, route);
        pageNotes[route] = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 160));
      } catch (err) {
        pageNotes[route] = 'ERR ' + String(err && err.message || err).slice(0, 120);
      }
    }
    try {
      await page.goto(base + '/home/mine', { waitUntil: 'domcontentloaded', timeout: 45000 });
      const dep = page.getByText('Depósito', { exact: true }).first();
      if (await dep.count()) await dep.click({ timeout: 4000 }).catch(() => {});
      await page.waitForTimeout(6000);
      await drain(page, bucket, 'deposit-dialog');
    } catch (_) { /* deposit dialog optional */ }
  } finally {
    await browser.close();
  }

  const byPath = {};
  for (const row of bucket) {
    const key = normPath(row.url);
    if (!key || key === '/') continue;
    const prev = byPath[key];
    const size = JSON.stringify(row.body || {}).length;
    if (!prev || size > prev.size) {
      byPath[key] = {
        path: key,
        sampleUrl: String(row.url || '').slice(0, 180),
        page: row.page,
        code: row.body && row.body.code,
        size,
        shape: shapeOf(row.body && row.body.data, 0),
        sample: sampleOf(row.body && row.body.data, 0)
      };
    }
  }
  const catalog = Object.values(byPath).sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(outDir, 'pages.json'), JSON.stringify(pageNotes, null, 2));
  console.log(JSON.stringify({
    base,
    login: pageNotes.login,
    pages: Object.keys(pageNotes).length,
    apis: catalog.length,
    paths: catalog.map((row) => row.path + ' code=' + row.code)
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
