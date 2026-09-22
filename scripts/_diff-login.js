/**
 * 登录官方与本地预览，记录 /api 响应摘要并对比。
 * 账号从环境变量读取，不写入仓库。
 */
require('../src/playwright-env');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const siteDir = path.join(__dirname, '..', 'output', '713win');
const outDir = path.join(__dirname, '..', 'logs', 'diff-login');
const officialBase = process.env.OFFICIAL_BASE || 'https://713win.com';

const routes = [
  { key: 'home', path: '/' },
  { key: 'event', path: '/home/event?eventCurrent=1' },
  { key: 'mine', path: '/home/mine' },
  { key: 'promote', path: '/home/promote' }
];

function postJson(port, urlPath, payload) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify(payload || {}));
    const req = http.request({
      hostname: '127.0.0.1', port, path: urlPath, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': body.length }
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch (e) { reject(new Error(data.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function summarize(text) {
  if (!text) return { empty: true };
  let json;
  try { json = JSON.parse(text); } catch (_) {
    return { raw: String(text).slice(0, 120) };
  }
  const data = json && json.data;
  const keys = data && typeof data === 'object' && !Array.isArray(data) ? Object.keys(data).slice(0, 12) : [];
  const len = Array.isArray(data) ? data.length
    : (data && Array.isArray(data.list) ? data.list.length : undefined);
  return {
    code: json && json.code,
    msg: json && (json.msg || json.message || ''),
    keys,
    len,
    bytes: text.length
  };
}

async function loginUi(page, account, password, shotPrefix) {
  await page.waitForTimeout(3000);
  await page.screenshot({ path: path.join(outDir, shotPrefix + '-before.png') });
  const loginBtn = page.getByText('Login', { exact: true });
  await loginBtn.first().click({ timeout: 8000 });
  const user = page.getByPlaceholder(/Celular|Conta|account|usu[aá]rio/i).first();
  try {
    await user.waitFor({ timeout: 5000 });
  } catch (_) {
    await loginBtn.nth(1).click({ timeout: 5000 }).catch(() => loginBtn.first().click({ force: true }));
    await user.waitFor({ timeout: 8000 });
  }
  await page.screenshot({ path: path.join(outDir, shotPrefix + '-modal.png') });
  const pass = page.getByPlaceholder(/senha|password/i).first();
  await user.waitFor({ timeout: 10000 });
  await user.click({ force: true });
  await user.fill(account);
  await pass.click({ force: true });
  await pass.fill(password);
  page.on('response', async (res) => {
    if (!/member\/login/i.test(res.url())) return;
    let sample = '';
    try { sample = (await res.text()).slice(0, 400); } catch (_) { sample = 'unreadable'; }
    fs.appendFileSync(path.join(outDir, shotPrefix + '-login.txt'), res.status() + ' ' + res.url() + '\n' + sample + '\n\n');
  });
  await pass.press('Enter');
  await page.waitForTimeout(12000);
  const still = await pass.count();
  if (still) {
    const btn = page.locator('.ui-button').filter({ hasText: /^Login$/ }).last();
    if (await btn.count()) await btn.click({ force: true, timeout: 5000 }).catch(() => {});
  }
  await page.waitForTimeout(7000);
  await page.screenshot({ path: path.join(outDir, shotPrefix + '-after.png') });
}

async function walk(page, base, label) {
  const apis = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/api\//i.test(url)) return;
    const short = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    let sample = '';
    try {
      const ct = res.headers()['content-type'] || '';
      if (/json|text|javascript|octet/i.test(ct) || !ct) sample = await res.text();
    } catch (_) { /* body consumed */ }
    apis.push({ status: res.status(), path: short, ...summarize(sample) });
  });

  const pages = {};
  for (const r of routes) {
    try {
      await page.goto(base.replace(/\/$/, '') + r.path, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForTimeout(7000);
      const shot = path.join(outDir, label + '-' + r.key + '.png');
      await page.screenshot({ path: shot, fullPage: false });
      pages[r.key] = await page.evaluate(() => ({
        url: location.href,
        text: (document.body.innerText || '').replace(/\s+/g, ' ').slice(0, 280)
      }));
    } catch (err) {
      pages[r.key] = { error: String(err && err.message || err) };
    }
  }
  return { pages, apis };
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const started = await postJson(3000, '/api/preview/start', { path: siteDir, mode: 'ours' });
  const port = started.port;
  if (!port) throw new Error('preview start failed ' + JSON.stringify(started));
  const localBase = 'http://127.0.0.1:' + port;

  const browser = await chromium.launch({
    headless: true,
    proxy: { server: 'http://127.0.0.1:7890', bypass: '127.0.0.1,localhost' }
  });

  const offCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const ourCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true });
  const offPage = await offCtx.newPage();
  const ourPage = await ourCtx.newPage();
  const errors = { official: [], ours: [] };
  function watch(page, bucket) {
    page.on('pageerror', (err) => bucket.push(String(err && err.message || err).slice(0, 180)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') bucket.push(msg.text().slice(0, 180));
    });
  }
  watch(offPage, errors.official);
  watch(ourPage, errors.ours);

  let official = { pages: {}, apis: [] };
  let ours;
  try {
    if (process.env.ONLY_OURS !== '1') {
      await offPage.goto(officialBase + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
      await loginUi(offPage, process.env.OFFICIAL_ACCOUNT, process.env.OFFICIAL_PASSWORD, 'official');
      official = await walk(offPage, officialBase, 'official');
    }

    await ourPage.goto(localBase + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await loginUi(ourPage, process.env.OUR_ACCOUNT, process.env.OUR_PASSWORD, 'ours');
    ours = await walk(ourPage, localBase, 'ours');
  } finally {
    await browser.close();
  }

  function index(list) {
    const map = {};
    for (const row of list) {
      const prev = map[row.path];
      if (!prev || (row.bytes || 0) > (prev.bytes || 0)) map[row.path] = row;
    }
    return map;
  }
  const a = index(official.apis);
  const b = index(ours.apis);
  const onlyOfficial = Object.keys(a).filter((k) => !b[k]);
  const onlyOurs = Object.keys(b).filter((k) => !a[k]);
  const differ = [];
  for (const k of Object.keys(a)) {
    if (!b[k]) continue;
    const left = a[k];
    const right = b[k];
    if (left.code !== right.code || (left.len || 0) !== (right.len || 0) || (left.bytes || 0) > 80 && (right.bytes || 0) < 40) {
      differ.push({ path: k, official: left, ours: right });
    }
  }
  const badOurs = Object.values(b).filter((r) => r.code && r.code !== 1);

  const report = {
    port, officialBase,
    officialPages: official.pages,
    ourPages: ours.pages,
    officialApiCount: official.apis.length,
    ourApiCount: ours.apis.length,
    onlyOfficial,
    onlyOurs,
    differ: differ.slice(0, 80),
    badOurs
  };
  const outPath = path.join(outDir, 'report.json');
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    port,
    officialApiCount: report.officialApiCount,
    ourApiCount: report.ourApiCount,
    errors,
    onlyOfficial: onlyOfficial.length,
    onlyOurs: onlyOurs.length,
    differ: differ.length,
    badOurs: badOurs.map((r) => r.path + ' code=' + r.code),
    outPath
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
