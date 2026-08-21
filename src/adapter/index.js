/**
 * 适配层入口：站点配置 → series 匹配 path → provider 执行 OP → series 映射响应
 *
 *   dist(目标站) --HTTP--> series(aniw-lobby) --OP--> provider(wgame)
 */
const { isAdapterApiHost } = require('./hosts');
const { loadAdapterConfig } = require('./config');
const { PROXY_PREFIX, parseProxyTarget } = require('../preview-proxy');
const fs = require('fs');
const path = require('path');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'X-SD-Adapter': 'series'
  });
  res.end(body);
}

function resolveSiteConfig(options) {
  if (options.adapterConfig && options.adapterConfig.seriesMod) {
    return options.adapterConfig;
  }
  const siteDir = options.siteDir || '';
  if (siteDir) return loadAdapterConfig(siteDir, fs, path);
  return {
    series: 'aniw-lobby',
    provider: 'wgame',
    seriesMod: require('./series').getSeries('aniw-lobby'),
    providerMod: require('./providers').getProvider('wgame'),
    hosts: [],
    apiHostPatterns: [],
    excludeHosts: [],
    providerOptions: {}
  };
}

function resolveAdapterPath(reqUrl, hostCfg, series) {
  const pathname = reqUrl.pathname || '';
  if (pathname === PROXY_PREFIX || pathname.startsWith(PROXY_PREFIX + '/')) {
    const target = parseProxyTarget(reqUrl);
    if (!target) return null;
    if (!isAdapterApiHost(target.hostname, hostCfg)) return null;
    if (!series || !series.matchRoute(target.pathname)) return null;
    return { pathname: target.pathname, via: 'proxy', host: target.hostname };
  }
  if (!series || !series.matchRoute(pathname)) return null;
  return { pathname, via: 'local', host: null };
}

/**
 * @returns {Promise<boolean>} true if handled
 */
async function tryHandleAdapter(req, res, options = {}) {
  const cfg = resolveSiteConfig(options);
  const series = cfg.seriesMod;
  const provider = cfg.providerMod;
  if (!series || !provider) return false;

  const host = req.headers.host || '127.0.0.1';
  let reqUrl;
  try {
    reqUrl = new URL(req.url || '/', `http://${host}`);
  } catch (_) {
    return false;
  }

  const hostCfg = options.adapterHosts || {
    hosts: cfg.hosts,
    apiHostPatterns: cfg.apiHostPatterns,
    excludeHosts: cfg.excludeHosts
  };

  const resolved = resolveAdapterPath(reqUrl, hostCfg, series);
  if (!resolved) return false;

  const matched = series.matchRoute(resolved.pathname);
  if (!matched) return false;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }
  if (req.method !== 'POST' && req.method !== 'GET') {
    sendJson(res, 405, { code: 405, msg: 'method not allowed', data: null });
    return true;
  }

  let body = {};
  if (req.method === 'POST') {
    try {
      const raw = await readRawBody(req);
      if (raw.length) {
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch (_) {
          body = raw;
        }
      }
    } catch (err) {
      sendJson(res, 400, { code: 400, msg: String(err && err.message || err), data: null });
      return true;
    }
  }

  const providerResult = await provider.execute(matched.op, {
    body,
    headers: req.headers || {},
    siteDir: options.siteDir || '',
    providerOptions: cfg.providerOptions
  });
  const result = series.mapResponse(matched.op, providerResult);

  console.log(
    '[adapter]',
    cfg.series + '/' + cfg.provider,
    req.method,
    resolved.via === 'proxy' ? `(proxy ${resolved.host})` : '',
    matched.path,
    '->',
    matched.op,
    result.code,
    result.msg
  );
  sendJson(res, 200, result);
  return true;
}

module.exports = {
  tryHandleAdapter,
  resolveAdapterPath,
  loadAdapterConfig
};
