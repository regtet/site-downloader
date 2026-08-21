const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const PROXY_PREFIX = '/__sd_proxy__';
const BOOT_PATH = '/__sd_boot.js';

/** 本地应优先走磁盘的路径（构建产物）；其余同源请求基地址改为源站 */
const LOCAL_STATIC_PREFIX_RE = /^\/(assets|libs|vendors|v1assets|v1fonts|v1locales|cocos|__sd_)\b/i;

const STATIC_PATH_EXT_RE = /\.(?:js|mjs|cjs|css|map|json|wasm|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|m4a|txt|xml|lottie)(?:$|\?)/i;

/** @deprecated 保留兼容；实际以 isLikelySameOriginApiPath 为准 */
const SAME_ORIGIN_API_PREFIX_RE = /^\/(member|api|apis|promo|promo_v2|gameapi|game|hall|auth|pay|wallet|agent|user|webapi|gateway|cdn-cgi)\b/i;

function isLocalStaticPath(pathname) {
  const p = String(pathname || '');
  if (!p || p === '/') return false;
  if (LOCAL_STATIC_PREFIX_RE.test(p)) return true;
  if (STATIC_PATH_EXT_RE.test(p)) return true;
  return false;
}

function isLikelySameOriginApiPath(pathname, search) {
  const p = String(pathname || '');
  if (!p || p === '/') return false;
  if (isLocalStaticPath(p)) return false;
  if (SAME_ORIGIN_API_PREFIX_RE.test(p)) return true;
  if (search && /(?:^|[?&])pa=/.test(search)) return true;
  return false;
}

function isFetchLikeRequest(req) {
  const headers = (req && req.headers) || {};
  const dest = String(headers['sec-fetch-dest'] || '').toLowerCase();
  if (dest === 'document' || dest === 'iframe' || dest === 'frame') return false;
  if (dest === 'empty') return true;
  const accept = String(headers.accept || '').toLowerCase();
  if (accept.includes('application/json')) return true;
  if (headers['x-requested-with']) return true;
  const method = String((req && req.method) || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') return true;
  return false;
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
  'content-length'
]);

function resolveSourceOrigin(siteDir, fs, path) {
  try {
    const manifestPath = path.join(siteDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest && manifest.source) {
        return new URL(manifest.source).origin;
      }
    }
  } catch (_) { /* ignore */ }
  try {
    return 'https://' + path.basename(siteDir);
  } catch (_) {
    return '';
  }
}

function parseProxyTarget(reqUrl) {
  const parsed = typeof reqUrl === 'string'
    ? new URL(reqUrl, 'http://127.0.0.1')
    : reqUrl;
  if (!parsed.pathname.startsWith(PROXY_PREFIX)) return null;

  const rest = parsed.pathname.slice(PROXY_PREFIX.length);
  let target = '';
  if (parsed.searchParams.has('url')) {
    target = parsed.searchParams.get('url') || '';
  } else if (rest.startsWith('/')) {
    target = decodeURIComponent(rest.slice(1));
  }
  if (!target) return null;

  let url;
  try {
    url = new URL(target);
  } catch (_) {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  return url;
}

function buildBootScript(sourceOrigin) {
  const origin = JSON.stringify(sourceOrigin || '');
  const prefix = JSON.stringify(PROXY_PREFIX + '/');
  return `/*! site-downloader preview proxy boot */
(function () {
  var SOURCE_ORIGIN = ${origin};
  var PROXY_PREFIX = ${prefix};
  if (!SOURCE_ORIGIN) return;
  if (window.__SD_PROXY_BOOT__) return;
  window.__SD_PROXY_BOOT__ = true;

  // 仅本地包内构建产物留在 127.0.0.1；/static、/cdn-cgi、/member 等基地址改为源站
  var LOCAL_PREFIX = /^\\/(assets|libs|vendors|v1assets|v1fonts|v1locales|cocos|__sd_)\\b/i;
  var STATIC_EXT = /\\.(?:js|mjs|cjs|css|map|json|wasm|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|mp4|webm|mp3|m4a)(?:$|\\?)/i;

  function absUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href).href;
      if (input && typeof input.url === 'string') return new URL(input.url, location.href).href;
    } catch (e) {}
    return null;
  }

  function isLocalStaticPath(pathname) {
    if (!pathname || pathname === '/') return false;
    if (LOCAL_PREFIX.test(pathname)) return true;
    if (STATIC_EXT.test(pathname)) return true;
    return false;
  }

  function toProxy(href) {
    return PROXY_PREFIX + encodeURIComponent(href);
  }

  /**
   * 同源业务路径：基地址直接换成源站（如 /cdn-cgi/rum → https://源站/cdn-cgi/rum）
   * 跨域 API：仍走本地代理，以便替换 Origin/Referer
   */
  function planUrl(href) {
    try {
      var u = new URL(href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.origin === location.origin) {
        if (isLocalStaticPath(u.pathname)) return null;
        return SOURCE_ORIGIN + u.pathname + u.search + u.hash;
      }
      return toProxy(href);
    } catch (e) {
      return null;
    }
  }

  var rawFetch = window.fetch;
  if (typeof rawFetch === 'function') {
    window.fetch = function (input, init) {
      var href = absUrl(input);
      var next = href && planUrl(href);
      if (!next) return rawFetch.apply(this, arguments);
      if (input && typeof input === 'object' && typeof Request !== 'undefined' && input instanceof Request) {
        return rawFetch.call(this, new Request(next, input));
      }
      return rawFetch.call(this, next, init);
    };
  }

  var XO = window.XMLHttpRequest;
  if (XO) {
    var open = XO.prototype.open;
    XO.prototype.open = function (method, url) {
      var href = absUrl(url);
      var next = href && planUrl(href);
      if (next) arguments[1] = next;
      return open.apply(this, arguments);
    };
  }

  if (navigator.sendBeacon) {
    var rawBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      var href = absUrl(url);
      var next = href && planUrl(href);
      if (next) return rawBeacon(next, data);
      return rawBeacon(url, data);
    };
  }
})();
`;
}

function injectBootIntoHtml(html, sourceOrigin) {
  if (!sourceOrigin || !html) return html;
  if (html.includes('__SD_PROXY_BOOT__') || html.includes(BOOT_PATH)) return html;
  const tag = `<script src="${BOOT_PATH}"></script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  return tag + html;
}

function copyRequestHeaders(req, sourceOrigin) {
  const out = {};
  const headers = req.headers || {};
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'origin' || lower === 'referer') continue;
    // 浏览器打到本地代理的 cookie 属于 127.0.0.1，不能转给上游
    if (lower === 'cookie') continue;
    // 避免上游 gzip 后我们剥掉 content-encoding 导致正文损坏
    if (lower === 'accept-encoding') continue;
    out[key] = headers[key];
  }
  out['Accept-Encoding'] = 'identity';
  if (sourceOrigin) {
    out.Origin = sourceOrigin;
    out.Referer = sourceOrigin.endsWith('/') ? sourceOrigin : sourceOrigin + '/';
  }
  if (!out['User-Agent'] && !out['user-agent']) {
    out['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  return out;
}

function filterResponseHeaders(headers) {
  const out = {};
  for (const key of Object.keys(headers || {})) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    // 同源代理后 CORS / cookie 域对浏览器无意义且易干扰
    if (lower === 'access-control-allow-origin') continue;
    if (lower === 'access-control-allow-credentials') continue;
    if (lower === 'access-control-allow-headers') continue;
    if (lower === 'access-control-allow-methods') continue;
    if (lower === 'access-control-expose-headers') continue;
    if (lower === 'set-cookie') continue;
    if (lower === 'content-encoding') continue;
    if (lower === 'content-length') continue;
    out[key] = headers[key];
  }
  return out;
}

function proxyRequest(req, res, target, sourceOrigin) {
  const isHttps = target.protocol === 'https:';
  const lib = isHttps ? https : http;
  const headers = copyRequestHeaders(req, sourceOrigin);
  headers.Host = target.host;

  const upstream = lib.request(
    {
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (isHttps ? 443 : 80),
      path: target.pathname + target.search,
      method: req.method || 'GET',
      headers,
      timeout: 30000
    },
    (upRes) => {
      const outHeaders = filterResponseHeaders(upRes.headers);
      outHeaders['X-SD-Proxy'] = '1';
      res.writeHead(upRes.statusCode || 502, outHeaders);
      upRes.pipe(res);
    }
  );

  upstream.on('timeout', () => {
    upstream.destroy();
    if (!res.headersSent) {
      res.writeHead(504, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('proxy timeout');
    }
  });

  upstream.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: 'proxy failed', message: String(err && err.message || err) }));
    }
  });

  if (req.method === 'GET' || req.method === 'HEAD') {
    upstream.end();
  } else {
    req.pipe(upstream);
  }
}

/**
 * 本地缺失的静态资源（如 /static/editor/...）回源到源站，避免预览基址落在 127.0.0.1 后直接 404。
 * @returns {boolean}
 */
function tryFallbackMissingAsset(req, res, sourceOrigin, pathname, search) {
  if (!sourceOrigin || !pathname) return false;
  const method = (req.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return false;

  let target;
  try {
    target = new URL(pathname + (search || ''), sourceOrigin.endsWith('/') ? sourceOrigin : sourceOrigin + '/');
  } catch (_) {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

  proxyRequest(req, res, target, sourceOrigin);
  return true;
}

/**
 * @returns {boolean} true if handled
 */
function tryHandleProxy(req, res, sourceOrigin) {
  const host = req.headers.host || '127.0.0.1';
  const reqUrl = new URL(req.url || '/', `http://${host}`);

  if (reqUrl.pathname === BOOT_PATH) {
    const body = buildBootScript(sourceOrigin);
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
    return true;
  }

  const target = parseProxyTarget(reqUrl);
  if (!target) return false;

  if (!sourceOrigin) {
    res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'preview source origin missing' }));
    return true;
  }

  proxyRequest(req, res, target, sourceOrigin);
  return true;
}

module.exports = {
  PROXY_PREFIX,
  BOOT_PATH,
  resolveSourceOrigin,
  parseProxyTarget,
  buildBootScript,
  injectBootIntoHtml,
  tryHandleProxy,
  tryFallbackMissingAsset,
  isLikelySameOriginApiPath,
  isFetchLikeRequest
};
