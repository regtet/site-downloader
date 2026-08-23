/**
 * Migration Bridge —— 目标 dist 与我们后端之间的唯一边界
 *
 *   目标 dist UI/JS
 *         │
 *         ▼
 *   ┌─ Migration Bridge ─────────────┐
 *   │ ① 请求映射  migration-map       │
 *   │ ② 数据 Adapter  series.adapters │
 *   │ ③ 登录态    provider session    │
 *   └────────────┬───────────────────┘
 *                ▼
 *            provider (wgame)
 *
 * 不在这里改 HTML/CSS/目标 JS；只保证返回「目标接口格式」。
 */
const { isAdapterApiHost } = require('./hosts');
const { loadAdapterConfig } = require('./config');
const { PROXY_PREFIX, parseProxyTarget } = require('../preview-proxy');
const { OP } = require('./ops');
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

function sendJson(res, status, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(status, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'X-SD-Adapter': 'migration-bridge'
  }, extraHeaders || {}));
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

function shouldPassthroughAuth(cfg, matched) {
  try {
    const { loadWgameConfig } = require('./providers/wgame/config');
    const wcfg = Object.assign(
      {},
      loadWgameConfig(cfg._siteDir || ''),
      cfg.providerOptions || {}
    );
    const mode = String(wcfg.mode || 'wgame').toLowerCase();
    if (mode !== 'upstream' && mode !== 'passthrough' && mode !== 'real') return false;
    return (
      matched.op === OP.AUTH_LOGIN
      || matched.op === OP.AUTH_REGISTER
      || matched.op === OP.AUTH_CHECK_REGISTER
    );
  } catch (_) {
    return false;
  }
}

/**
 * @returns {Promise<boolean>} true if handled
 */
async function tryHandleAdapter(req, res, options = {}) {
  const cfg = resolveSiteConfig(options);
  cfg._siteDir = options.siteDir || '';
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

  // ① 请求映射
  const resolved = resolveAdapterPath(reqUrl, hostCfg, series);
  if (!resolved) return false;

  const matched = series.matchRoute(resolved.pathname);
  if (!matched) return false;

  if (shouldPassthroughAuth(cfg, matched)) return false;
  if (matched.op === OP.UPSTREAM) {
    const siteDir = cfg._siteDir || options.siteDir || '';
    const { getOssSnapshotBody } = require('./providers/wgame/oss-config');
    const { getPopupBody } = require('./providers/wgame/popup-config');

    function sendRawBody(contentType, body, adapterTag) {
      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return true;
      }
      let out = String(body == null ? '' : body);
      if (out.indexOf('{$WG_BUCKET_SITE$}') !== -1) {
        out = out.replace(/\{\$WG_BUCKET_SITE\$\}/g, `http://${host}`);
      }
      res.writeHead(200, {
        'Content-Type': contentType || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
        'X-SD-Adapter': adapterTag || 'oss-har'
      });
      res.end(out);
      return true;
    }

    function sendUpstreamFallback() {
      if (req.method === 'OPTIONS') {
        sendJson(res, 204, {});
        return true;
      }
      const useEmptyList = matched.adapter === 'emptyList';
      const result = series.mapResponse(
        useEmptyList ? OP.EMPTY_RECORDS : OP.LOBBY_OK,
        { ok: true, data: useEmptyList ? [] : {} },
        { adapter: useEmptyList ? 'emptyList' : matched.adapter }
      );
      sendJson(res, 200, result, { 'X-SD-Adapter': 'upstream-fallback' });
      return true;
    }

    const snap = getOssSnapshotBody(siteDir, resolved.pathname, req.method);
    if (snap && snap.body) {
      return sendRawBody(snap.contentType, snap.body, 'oss-har');
    }

    if (matched.adapter === 'emptyList') {
      const blob = getPopupBody(siteDir, resolved.pathname, req.method);
      if (blob && blob.body) {
        return sendRawBody(blob.contentType || 'text/plain; charset=utf-8', blob.body, 'popup-har');
      }
    }

    return sendUpstreamFallback();
  }

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

  // provider 执行（③ 登录态在 auth.* / user.info / wallet 内维护）
  const providerResult = await provider.execute(matched.op, {
    body,
    headers: req.headers || {},
    siteDir: options.siteDir || '',
    providerOptions: cfg.providerOptions,
    routePath: matched.path,
    adapter: matched.adapter
  });

  // ② 数据适配
  const result = series.mapResponse(matched.op, providerResult, { adapter: matched.adapter });

  console.log(
    '[bridge]',
    cfg.series + '/' + cfg.provider,
    req.method,
    matched.path,
    '→',
    matched.op + '/' + matched.adapter,
    result.code
  );
  sendJson(res, 200, result);
  return true;
}

module.exports = {
  tryHandleAdapter,
  resolveAdapterPath,
  loadAdapterConfig
};
