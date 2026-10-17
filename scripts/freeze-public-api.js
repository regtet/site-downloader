/**
 * 把公开 JSON 冻进 logs/local-public-api/<siteId>/。
 * 不带登录 token。只保存 HTTP 200 且 code===1（或没有 code 字段）的 JSON。
 *
 * 用法: node scripts/freeze-public-api.js [719win]
 */
const dns = require('dns');
const fs = require('fs');
const https = require('https');
const path = require('path');

if (typeof dns.setDefaultResultOrder === 'function') dns.setDefaultResultOrder('ipv4first');

const siteId = process.argv[2] || '719win';
const root = path.join(__dirname, '..');
const outDir = path.join(root, 'logs', 'local-public-api', siteId);
const agent = new https.Agent({ keepAlive: true, family: 4, maxSockets: 6 });

function readJson(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (_) { return null; }
}

function collectUrls() {
  const urls = new Set();
  const add = (raw) => {
    const u = String(raw || '').split('?')[0];
    if (/^https:\/\//i.test(u) && /\.json$/i.test(u)) urls.add(u);
  };
  const catalog = readJson(path.join(root, 'logs', 'official-shapes', 'catalog.json'));
  if (Array.isArray(catalog)) {
    for (const row of catalog) add(row && row.sampleUrl);
  }
  for (const file of [
    path.join(root, 'dist', siteId + '.com', 'network.json'),
    path.join(root, 'output', siteId, 'network.json'),
    path.join(root, 'input', siteId, 'network.json')
  ]) {
    const rows = readJson(file);
    if (!Array.isArray(rows)) continue;
    for (const row of rows) add(row && (row.url || (row.request && row.request.url)));
  }
  const { MIGRATION_MAP } = require('../src/adapter/series/aniw-lobby/migration-map');
  const host = 'https://oniw917.719win.bet';
  for (const [apiPath, route] of Object.entries(MIGRATION_MAP)) {
    if (!route || route.op !== 'upstream.passthrough') continue;
    if (apiPath === '/api/active/get') continue;
    for (const suffix of [
      '.json',
      '/language/pt.json',
      '/currency/BRL.json',
      '/currency/BRL/language/pt.json',
      '/default.json'
    ]) {
      urls.add(host + '/hall' + apiPath + suffix);
    }
  }
  urls.add(host + '/hall/api/active/category/currency/BRL/language/pt.json');
  urls.add(host + '/hall/api/active/categoryV2/currency/BRL/language/pt.json');
  for (const extra of extraGameUrls()) urls.add(extra);
  return [...urls];
}

function fetchUrl(url) {
  return new Promise((resolve) => {
    const req = https.get(url, {
      agent,
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0',
        Accept: 'application/json'
      }
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size < 12e6) chunks.push(c);
      });
      res.on('end', () => {
        resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ status: 0, body: '' }));
  });
}

function acceptable(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed || trimmed.startsWith('<')) return false;
  if (trimmed[0] !== '{' && trimmed[0] !== '[') return false;
  let json;
  try { json = JSON.parse(trimmed); } catch (_) { return false; }
  if (json == null || typeof json !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(json, 'code')) {
    const code = Number(json.code);
    if (code !== 0 && code !== 1) return false;
  }
  return true;
}

function extraGameUrls() {
  const urls = [];
  const host = 'https://oniw917.719win.bet';
  const hotPath = path.join(outDir, 'api', 'game', 'hall', 'hotListV2', 'currency', 'BRL', 'language', 'pt.json');
  const linkPath = path.join(outDir, 'api', 'game', 'hall', 'listPlatformCateExtLink', 'currency', 'BRL', 'language', 'pt.json');
  const platforms = new Set([13, 200]);
  const categories = new Set([0, 1, 2, 3, 5, 11]);
  const hot = readJson(hotPath);
  const rows = hot && hot.data;
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row && typeof row.g10 === 'number') platforms.add(row.g10);
    }
  }
  const link = readJson(linkPath);
  const linkRows = link && link.data;
  if (Array.isArray(linkRows)) {
    for (const row of linkRows) {
      if (row && typeof row.p0 === 'number') categories.add(row.p0);
    }
  }
  for (const categoryId of categories) {
    urls.push(host + '/hall/api/game/hall/listSubGameSummary/categoryId/' + categoryId + '/currency/BRL/language/pt.json');
    for (const platformId of platforms) {
      urls.push(host + '/hall/api/game/hall/listPlatformGameV2/categoryId/' + categoryId + '/currency/BRL/language/pt/platformId/' + platformId + '.json');
      urls.push(host + '/hall/api/game/hall/liveVideo/gamePlatformId/' + platformId + '.json');
    }
  }
  for (const useType of [0, 1, 2, 3]) {
    urls.push(host + '/hall/api/lobby/finance/getPayFieldOss/currency/BRL/language/pt/useType/' + useType + '.json');
  }
  urls.push(host + '/hall/api/lobby/currencyInfo/getAllCurrency.json');
  urls.push(host + '/hall/api/lobby/versionUpdate/getVersionList.json');
  urls.push(host + '/hall/api/game/hall/liveGame.json');
  urls.push(host + '/hall/api/game/hall/liveGame/currency/BRL/language/pt.json');
  return urls;
}

function savePath(url) {
  const u = new URL(url);
  let p = u.pathname;
  if (p.startsWith('/hall/')) p = p.slice('/hall/'.length);
  else p = p.replace(/^\/+/, '');
  return path.join(outDir, p);
}

async function mapPool(items, limit, fn) {
  const ret = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const i = cursor++;
      ret[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return ret;
}

function postJson(url, headers, body) {
  return new Promise((resolve) => {
    const u = new URL(url);
    const req = https.request({
      agent,
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      family: 4,
      timeout: 15000,
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve({ status: 0, body: '' }));
    req.end(body);
  });
}

async function freezeActivityDetails() {
  const categoryFile = path.join(outDir, 'api', 'active', 'category', 'currency', 'BRL', 'language', 'pt.json');
  if (!fs.existsSync(categoryFile)) return { saved: 0, tried: 0 };
  let json;
  try { json = JSON.parse(fs.readFileSync(categoryFile, 'utf8')); } catch (_) { return { saved: 0, tried: 0 }; }
  const data = json.data && typeof json.data === 'object' ? json.data : json;
  const list = data.activeList || data.categoryList || [];
  const ids = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.activeId != null) ids.push(Number(node.activeId));
    if (Array.isArray(node.activeList)) node.activeList.forEach(walk);
  };
  walk(list);
  const unique = [...new Set(ids.filter((n) => n > 0))].slice(0, 40);
  const hosts = readJson(path.join(root, 'output', siteId, 'adapter-hosts.json')) || {};
  const siteCode = String(hosts.siteCode || process.env.SITE_CODE || '');
  let detailUrl = 'https://aniw917.719win.vip/hall/api/active/get';
  try {
    if (hosts.upstreamOrigin) detailUrl = new URL('/hall/api/active/get', hosts.upstreamOrigin).href;
  } catch (_) { /* keep default */ }
  let saved = 0;
  for (const activeId of unique) {
    const body = JSON.stringify({ activeId });
    const headers = {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-data-mode': 'plain',
      currency: 'BRL',
      language: 'pt',
      'Content-Length': Buffer.byteLength(body)
    };
    if (siteCode) headers.sitecode = siteCode;
    const res = await postJson(detailUrl, headers, body);
    if (res.status !== 200 || !acceptable(res.body)) continue;
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) { continue; }
    if (!parsed.data || Number(parsed.data.id) !== activeId || typeof parsed.data.name !== 'string' || !parsed.data.name) continue;
    const dest = path.join(outDir, 'api', 'active', 'get', String(activeId) + '.json');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, res.body);
    saved += 1;
  }
  return { saved, tried: unique.length };
}

async function freezeGuestPosts() {
  const hosts = readJson(path.join(root, 'output', siteId, 'adapter-hosts.json')) || {};
  const siteCode = String(hosts.siteCode || process.env.SITE_CODE || '');
  let origin = 'https://aniw917.719win.vip';
  try { if (hosts.upstreamOrigin) origin = new URL(hosts.upstreamOrigin).origin; } catch (_) { /* keep */ }
  const jobs = [
    ['/api/active/returnGold/summary/v3', {}],
    ['/api/active/returnGold/ratiotable', {}],
    ['/api/active/cutADeal/list', {}],
    ['/api/active/turntable/luckyIntegralList', {}],
    ['/api/active/announcement', {}],
    ['/api/agent/promote/config/getAgentConfig', {}],
    ['/api/finance/payPopup/content', {}],
    ['/api/game/hall/listSearchGameV2', { gameName: '' }]
  ];
  const categoryFile = path.join(outDir, 'api', 'active', 'category', 'currency', 'BRL', 'language', 'pt.json');
  const category = readJson(categoryFile);
  const ids = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (node.activeId != null) ids.push(Number(node.activeId));
    if (Array.isArray(node.activeList)) node.activeList.forEach(walk);
  };
  if (category) walk(category.data || category);
  for (const activeId of [...new Set(ids.filter((n) => n > 0))].slice(0, 40)) {
    jobs.push(['/api/active/cutADeal/list', { activeId }, String(activeId)]);
    jobs.push(['/api/active/turntable/luckyIntegralList', { activeId }, String(activeId)]);
  }
  let saved = 0;
  for (const [apiPath, payload, id] of jobs) {
    const body = JSON.stringify(payload);
    const headers = {
      'User-Agent': 'Mozilla/5.0',
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'x-data-mode': 'plain',
      currency: 'BRL',
      language: 'pt',
      'Content-Length': Buffer.byteLength(body)
    };
    if (siteCode) headers.sitecode = siteCode;
    const res = await postJson(origin + '/hall' + apiPath, headers, body);
    if (res.status !== 200 || !acceptable(res.body)) continue;
    let parsed;
    try { parsed = JSON.parse(res.body); } catch (_) { continue; }
    if (!parsed || Number(parsed.code) !== 1 || parsed.data == null) continue;
    const rel = id ? apiPath.replace(/^\//, '') + '/' + id + '.json' : apiPath.replace(/^\//, '') + '.json';
    const dest = path.join(outDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, res.body);
    saved += 1;
  }
  return { saved, tried: jobs.length };
}

async function main() {
  const urls = collectUrls();
  fs.mkdirSync(outDir, { recursive: true });
  let saved = 0;
  let skipped = 0;
  await mapPool(urls, 4, async (url) => {
    const destEarly = savePath(url);
    if (fs.existsSync(destEarly) && fs.statSync(destEarly).size > 2) {
      saved += 1;
      return;
    }
    const res = await fetchUrl(url);
    if (res.status !== 200 || !acceptable(res.body)) {
      skipped += 1;
      return;
    }
    const dest = savePath(url);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, res.body);
    saved += 1;
  });
  const details = await freezeActivityDetails();
  const guests = await freezeGuestPosts();
  const report = {
    siteId,
    at: new Date().toISOString(),
    urls: urls.length,
    saved,
    skipped,
    activityDetails: details,
    guestPosts: guests,
    outDir
  };
  const packaged = path.join(root, 'output', siteId, 'local-api');
  if (fs.existsSync(path.join(root, 'output', siteId))) {
    const { copyRecursive } = require('./site-paths');
    copyRecursive(outDir, packaged);
    report.packaged = packaged;
  }
  fs.writeFileSync(path.join(root, 'logs', `freeze-public-api-${siteId}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err && err.stack || err);
  process.exit(1);
});
