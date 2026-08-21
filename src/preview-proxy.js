const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

const PROXY_PREFIX = '/__sd_proxy__';
const BOOT_PATH = '/__sd_boot.js';
const SW_PATH = '/__sd_sw.js';

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

function buildBootScript(sourceOrigin, adapterHosts) {
  const origin = JSON.stringify(sourceOrigin || '');
  const prefix = JSON.stringify(PROXY_PREFIX + '/');
  const hostsJson = JSON.stringify(Array.isArray(adapterHosts) ? adapterHosts : []);
  return `/*! site-downloader preview proxy boot */
(function () {
  var SOURCE_ORIGIN = ${origin};
  var PROXY_PREFIX = ${prefix};
  var ADAPTER_HOSTS = ${hostsJson};
  if (!SOURCE_ORIGIN) return;
  if (window.__SD_PROXY_BOOT__) return;
  window.__SD_PROXY_BOOT__ = true;

  var LOCAL_ORIGIN = location.origin;
  var ADAPTER_HOST_SET = {};
  for (var hi = 0; hi < ADAPTER_HOSTS.length; hi++) ADAPTER_HOST_SET[String(ADAPTER_HOSTS[hi]).toLowerCase()] = true;

  function absUrl(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href).href;
      if (typeof URL !== 'undefined' && input instanceof URL) return input.href;
      if (input && typeof input.href === 'string' && typeof input.hostname === 'string') return String(input.href);
      if (input && typeof input.url === 'string') return new URL(input.url, location.href).href;
    } catch (e) {}
    return null;
  }

  function toProxy(href) {
    return PROXY_PREFIX + encodeURIComponent(href);
  }

  /** API 子域 aniw / oniw *.679win.*，不含主站 679win.com */
  function isAdapterApiHost(hostname) {
    if (!hostname) return false;
    var h = String(hostname).toLowerCase();
    if (h === '679win.com' || h === 'www.679win.com') return false;
    if (ADAPTER_HOST_SET[h]) return true;
    if (/\\.679win\\.(cc|me|co|net)$/i.test(h)) return true;
    if (/^(oniw|aniw)\\d*\\./i.test(h)) return true;
    return false;
  }

  /**
   * 仅业务 API（/hall/api、/api/...）改本地短 path
   * 图片/OSS（siteadmin 等）仍走 __sd_proxy__，避免资源丢了
   */
  function isLocalApiPath(pathname) {
    var p = pathname || '';
    return p.indexOf('/hall/api/') === 0 || p.indexOf('/api/') === 0;
  }

  function isAuthApiPath(pathname) {
    var p = pathname || '';
    return /\\/(?:hall\\/)?api\\/member\\/(?:login|agent\\/login|register|fastRegister|check\\/register|v2\\/fastLogin|getFastLogin|thirdPartyLogin)(?:\\/|$)/.test(p);
  }

  /** 从登录/注册表单采集明文账密（请求体是 AES，适配层解不了） */
  window.__sdAuthFields = { account: '', password: '', invite: '' };
  function lookLikeAccountInput(el) {
    if (!el || el.tagName !== 'INPUT') return false;
    var t = String(el.type || 'text').toLowerCase();
    if (t === 'password' || t === 'hidden' || t === 'checkbox' || t === 'radio' || t === 'submit' || t === 'button') return false;
    var id = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '') + ' ' + (el.autocomplete || '')).toLowerCase();
    if (/pass|pwd|senha|otp|code|captcha|verify/.test(id)) return false;
    if (/user|account|login|phone|email|mobile|tel|nome|conta/.test(id)) return true;
    return t === 'text' || t === 'tel' || t === 'email' || t === 'number';
  }
  function harvestAuthFields() {
    try {
      var inputs = document.querySelectorAll('input');
      var account = '';
      var password = '';
      var invite = '';
      for (var i = 0; i < inputs.length; i++) {
        var el = inputs[i];
        if (!el || el.disabled || el.readOnly) continue;
        var val = String(el.value || '');
        if (!val) continue;
        var meta = ((el.name || '') + ' ' + (el.id || '') + ' ' + (el.placeholder || '')).toLowerCase();
        var typ = String(el.type || '').toLowerCase();
        if (typ === 'password' || /pass|pwd|senha/.test(meta)) password = val;
        else if (/invite|checkcode|ncheck|referral|agent/.test(meta)) invite = val;
        else if (lookLikeAccountInput(el)) account = val;
      }
      if (account) window.__sdAuthFields.account = account;
      if (password) window.__sdAuthFields.password = password;
      if (invite) window.__sdAuthFields.invite = invite;
    } catch (e) {}
    return window.__sdAuthFields;
  }
  document.addEventListener('input', function () { harvestAuthFields(); }, true);
  document.addEventListener('change', function () { harvestAuthFields(); }, true);
  document.addEventListener('click', function () { harvestAuthFields(); }, true);

  function withPlainAuthBody(href, body) {
    try {
      var u = new URL(href, LOCAL_ORIGIN);
      if (!isAuthApiPath(u.pathname)) return body;
      var fields = harvestAuthFields();
      if (!fields.account && !fields.password) return body;
      var base = {};
      if (typeof body === 'string') {
        try { base = JSON.parse(body); } catch (e) { base = { encryptString: body }; }
      } else if (body && typeof body === 'object') {
        base = body;
      }
      // 保留密文供排查，同时附带明文供本地 adapter → wgame
      return JSON.stringify({
        username: fields.account,
        account: fields.account,
        userpass: fields.password,
        password: fields.password,
        inviteCode: fields.invite || undefined,
        encryptString: base.encryptString || undefined,
        _sdPlain: 1
      });
    } catch (e) {
      return body;
    }
  }

  function planUrl(href) {
    try {
      var u = new URL(href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.origin === LOCAL_ORIGIN) return null;
      // 业务 API → 本地短 path
      if (isAdapterApiHost(u.hostname) && isLocalApiPath(u.pathname)) {
        return LOCAL_ORIGIN + u.pathname + u.search + u.hash;
      }
      // 其它跨域（含 OSS 图片）→ 本地代理，带源站 Referer，避免防盗链
      return toProxy(href);
    } catch (e) {
      return null;
    }
  }

  /** img/script 等属性赋值不走 XHR，需单独改写到代理 */
  function rewriteMediaUrl(v) {
    if (!v || typeof v !== 'string') return v;
    if (v.indexOf('__sd_proxy__') !== -1) return v;
    var href = absUrl(v);
    var next = href && planUrl(href);
    return next || v;
  }

  try {
    var imgProto = window.HTMLImageElement && HTMLImageElement.prototype;
    if (imgProto) {
      var srcDesc = Object.getOwnPropertyDescriptor(imgProto, 'src');
      if (srcDesc && srcDesc.set) {
        Object.defineProperty(imgProto, 'src', {
          configurable: true,
          enumerable: srcDesc.enumerable,
          get: srcDesc.get,
          set: function (v) { return srcDesc.set.call(this, rewriteMediaUrl(v)); }
        });
      }
    }
    var rawSetAttr = Element.prototype.setAttribute;
    Element.prototype.setAttribute = function (name, value) {
      var n = String(name || '').toLowerCase();
      if ((n === 'src' || n === 'href' || n === 'poster' || n === 'srcset') && typeof value === 'string') {
        if (n === 'srcset') {
          value = value.split(',').map(function (part) {
            var bits = part.trim().split(/\\s+/);
            if (bits[0]) bits[0] = rewriteMediaUrl(bits[0]);
            return bits.join(' ');
          }).join(', ');
        } else {
          value = rewriteMediaUrl(value);
        }
      }
      return rawSetAttr.call(this, name, value);
    };
  } catch (e) {}

  /** 把荷载里的本地 origin 换成源站（如 RUM location 字段） */
  function rewriteJsonText(text) {
    if (!text || typeof text !== 'string') return text;
    if (text.indexOf(LOCAL_ORIGIN) === -1) return text;
    try {
      return JSON.stringify(rewriteUrlsInValue(JSON.parse(text)));
    } catch (e) {
      return text.split(LOCAL_ORIGIN).join(SOURCE_ORIGIN);
    }
  }

  function rewriteUrlsInValue(v) {
    if (typeof v === 'string') {
      return v.indexOf(LOCAL_ORIGIN) === -1 ? v : v.split(LOCAL_ORIGIN).join(SOURCE_ORIGIN);
    }
    if (Array.isArray(v)) {
      for (var i = 0; i < v.length; i++) v[i] = rewriteUrlsInValue(v[i]);
      return v;
    }
    if (v && typeof v === 'object') {
      for (var k in v) {
        if (Object.prototype.hasOwnProperty.call(v, k)) v[k] = rewriteUrlsInValue(v[k]);
      }
      return v;
    }
    return v;
  }

  function rewriteBodySync(data) {
    if (data == null) return data;
    if (typeof data === 'string') return rewriteJsonText(data);
    if (typeof URLSearchParams !== 'undefined' && data instanceof URLSearchParams) {
      return new URLSearchParams(rewriteJsonText(data.toString()));
    }
    if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
      var dec = typeof TextDecoder !== 'undefined' ? new TextDecoder().decode(data) : '';
      if (!dec || dec.indexOf(LOCAL_ORIGIN) === -1) return data;
      var enc = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(rewriteJsonText(dec)) : null;
      return enc ? enc.buffer : data;
    }
    if (typeof Uint8Array !== 'undefined' && data instanceof Uint8Array) {
      return rewriteBodySync(data.buffer);
    }
    return data;
  }

  function rewriteBodyAsync(data) {
    if (data == null) return Promise.resolve(data);
    if (typeof Blob !== 'undefined' && data instanceof Blob) {
      return data.text().then(function (text) {
        if (!text || text.indexOf(LOCAL_ORIGIN) === -1) return data;
        return new Blob([rewriteJsonText(text)], { type: data.type || 'application/json' });
      });
    }
    if (typeof Request !== 'undefined' && data instanceof Request) {
      return data.clone().text().then(function (text) {
        var rewritten = rewriteJsonText(text);
        return new Request(data, { body: rewritten === text ? undefined : rewritten });
      }).catch(function () { return data; });
    }
    return Promise.resolve(rewriteBodySync(data));
  }

  var rawFetch = window.fetch;
  if (typeof rawFetch === 'function') {
    window.fetch = function (input, init) {
      var href = absUrl(input);
      var next = href && planUrl(href);
      var body = init && init.body;
      var rumLike = !!(href && href.indexOf('cdn-cgi/rum') !== -1);
      var needBody = !!(body && (next || rumLike));
      var self = this;

      function dispatch(finalInit) {
        if (next || (href && isAuthApiPath((function () { try { return new URL(href).pathname; } catch (e) { return ''; } })()))) {
          var authHref = next || href;
          if (finalInit && finalInit.body != null) {
            finalInit = Object.assign({}, finalInit);
            finalInit.body = withPlainAuthBody(authHref, finalInit.body);
          }
        }
        if (next) {
          if (input && typeof input === 'object' && typeof Request !== 'undefined' && input instanceof Request) {
            return rawFetch.call(self, new Request(next, finalInit || {}));
          }
          return rawFetch.call(self, next, finalInit);
        }
        return rawFetch.call(self, input, finalInit);
      }

      if (needBody) {
        return rewriteBodyAsync(body).then(function (b) {
          var opts = init ? Object.assign({}, init) : {};
          opts.body = b;
          return dispatch(opts);
        });
      }
      if (!next) return rawFetch.apply(this, arguments);
      if (input && typeof input === 'object' && typeof Request !== 'undefined' && input instanceof Request) {
        return rawFetch.call(this, new Request(next, init || input));
      }
      return rawFetch.call(this, next, init);
    };
  }

  var XO = window.XMLHttpRequest;
  if (XO) {
    var xoOpen = XO.prototype.open;
    var xoSend = XO.prototype.send;
    XO.prototype.open = function (method, url) {
      // 不能改 arguments[1]：严格模式下对 axios 的 XHR 无效，会仍直连远端 API 域
      var args = Array.prototype.slice.call(arguments);
      var href = absUrl(args[1]);
      this.__sdHref = href;
      var next = href && planUrl(href);
      if (next) {
        args[1] = next;
        this.__sdHref = next;
        this.__sdRewrote = href;
        try { console.info('[sd-adapter] xhr', href, '->', next); } catch (e) {}
      }
      return xoOpen.apply(this, args);
    };
    XO.prototype.send = function (body) {
      var self = this;
      var href = this.__sdHref || this.__sdRewrote || '';
      // 登录注册：用表单明文替换 AES 密文 body
      if (body != null && href) {
        body = withPlainAuthBody(href, body);
      }
      if (body != null && href && (href.indexOf('cdn-cgi/rum') !== -1 || String(this.__sdHref || '').indexOf(LOCAL_ORIGIN) === 0)) {
        if (typeof Blob !== 'undefined' && body instanceof Blob) {
          rewriteBodyAsync(body).then(function (b) { xoSend.call(self, b); });
          return;
        }
        body = rewriteBodySync(body);
      }
      return xoSend.call(this, body);
    };
  }

  /** 不再整页替换 aniw/oniw 域名：会把 ossDomain/图片地址也改坏 */

  if (navigator.sendBeacon) {
    var rawBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function (url, data) {
      var href = absUrl(url);
      var next = (href && planUrl(href)) || url;

      function fire(body) {
        try {
          if (rawBeacon(next, body)) return true;
        } catch (e) {}
        try {
          if (rawFetch) {
            rawFetch(next, { method: 'POST', body: body, keepalive: true, mode: 'same-origin' });
            return true;
          }
        } catch (e2) {}
        return false;
      }

      if (data == null) return fire(data);
      if (typeof data === 'string') return fire(rewriteJsonText(data));
      if (typeof Blob !== 'undefined' && data instanceof Blob) {
        data.text().then(function (text) {
          fire(new Blob([rewriteJsonText(text)], { type: data.type || 'application/json' }));
        });
        return true;
      }
      return fire(rewriteBodySync(data));
    };
  }

  if (navigator.serviceWorker) {
    var swUrl = ${JSON.stringify(SW_PATH + '?v=3')};
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all((regs || []).map(function (r) { return r.unregister(); }));
    }).then(function () {
      return navigator.serviceWorker.register(swUrl, { scope: '/', updateViaCache: 'none' });
    }).then(function () {
      try { console.info('[sd-adapter] service worker v3 registered'); } catch (e) {}
    }).catch(function (err) {
      try { console.warn('[sd-adapter] sw register failed', err); } catch (e) {}
    });
  }

  try { console.info('[sd-adapter] boot ready', LOCAL_ORIGIN); } catch (e) {}
})();
`;
}

function buildServiceWorkerScript() {
  const proxyPrefix = JSON.stringify(PROXY_PREFIX + '/');
  return `/*! site-downloader api adapter sw v3 */
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

var PROXY_PREFIX = ${proxyPrefix};

function isApiHost(hostname) {
  var h = String(hostname || '').toLowerCase();
  if (!h || h === '679win.com' || h === 'www.679win.com') return false;
  if (/\\.679win\\.(cc|me|co|net)$/i.test(h)) return true;
  if (/^(oniw|aniw)\\d*\\./i.test(h)) return true;
  return false;
}

function isLocalApiPath(pathname) {
  var p = pathname || '';
  return p.indexOf('/hall/api/') === 0 || p.indexOf('/api/') === 0;
}

function relay(req, targetUrl) {
  return (async function () {
    var init = {
      method: req.method,
      headers: req.headers,
      credentials: 'same-origin',
      mode: 'same-origin',
      cache: 'no-store',
      redirect: 'follow'
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = await req.clone().arrayBuffer();
    }
    return fetch(targetUrl, init);
  })();
}

self.addEventListener('fetch', function (event) {
  var req = event.request;
  var url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin === self.location.origin) return;
  if (!isApiHost(url.hostname)) return;

  // 业务 API → 本地短 path（adapter / 上游）
  if (isLocalApiPath(url.pathname)) {
    var localUrl = self.location.origin + url.pathname + url.search;
    event.respondWith(relay(req, localUrl));
    return;
  }

  // 图片/OSS → 本地代理（伪造 Referer，避免 CDN 防盗链）
  var proxyUrl = self.location.origin + PROXY_PREFIX + encodeURIComponent(req.url);
  event.respondWith(relay(req, proxyUrl));
});
`;
}

function injectBootIntoHtml(html, sourceOrigin, adapterHosts) {
  if (!sourceOrigin || !html) return html;
  if (html.includes('__SD_PROXY_BOOT__') || html.includes('data-sd-boot=')) return html;
  const raw = buildBootScript(sourceOrigin, adapterHosts);
  const safe = String(raw).replace(/<\/script/gi, '<\\/script');
  const tag = `<script data-sd-boot="1">${safe}</script>`;
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
 * 本地缺失的静态资源 / 同源接口 → 回源站（保留原 path/query，含末尾单独的 ?）
 * @returns {boolean}
 */
function tryFallbackMissingAsset(req, res, sourceOrigin, pathname, search) {
  if (!sourceOrigin || !pathname) return false;

  let pathAndQuery = pathname + (search || '');
  try {
    const raw = String(req.url || '').split('#')[0];
    if (raw && raw.charAt(0) === '/') {
      pathAndQuery = raw;
    }
  } catch (_) { /* ignore */ }

  let target;
  try {
    target = new URL(pathAndQuery, sourceOrigin.endsWith('/') ? sourceOrigin : sourceOrigin + '/');
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
function tryHandleProxy(req, res, sourceOrigin, adapterHosts) {
  const host = req.headers.host || '127.0.0.1';
  const reqUrl = new URL(req.url || '/', `http://${host}`);

  if (reqUrl.pathname === BOOT_PATH) {
    const body = buildBootScript(sourceOrigin, adapterHosts);
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(body);
    return true;
  }

  if (reqUrl.pathname === SW_PATH) {
    const body = buildServiceWorkerScript();
    res.writeHead(200, {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Service-Worker-Allowed': '/',
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
  SW_PATH,
  resolveSourceOrigin,
  parseProxyTarget,
  buildBootScript,
  buildServiceWorkerScript,
  injectBootIntoHtml,
  tryHandleProxy,
  tryFallbackMissingAsset,
  isLikelySameOriginApiPath,
  isFetchLikeRequest
};
