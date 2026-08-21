/*! site-downloader preview proxy boot */
(function () {
  var SOURCE_ORIGIN = "https://679win.com";
  var PROXY_PREFIX = "/__sd_proxy__/";
  var ADAPTER_HOSTS = ["oniw976.679win.cc","aniw976.679win.cc","aniw976.679win.me","aniw976.679win.co"];
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

  /** API 子域（aniw*/oniw*.679win.*），不含主站 679win.com */
  function isAdapterApiHost(hostname) {
    if (!hostname) return false;
    var h = String(hostname).toLowerCase();
    if (h === '679win.com' || h === 'www.679win.com') return false;
    if (ADAPTER_HOST_SET[h]) return true;
    if (/\.679win\.(cc|me|co|net)$/i.test(h)) return true;
    if (/^(oniw|aniw)\d*\./i.test(h)) return true;
    return false;
  }

  /**
   * API 子域（aniw*/oniw*.679win.*）全部改本地短 path
   * 登录注册由 adapter 吃掉；其它 /hall/api 由服务端回上游
   * 主站 679win.com 静态资源不改
   */
  function planUrl(href) {
    try {
      var u = new URL(href);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      if (u.origin === LOCAL_ORIGIN) return null;
      if (isAdapterApiHost(u.hostname)) {
        return LOCAL_ORIGIN + u.pathname + u.search + u.hash;
      }
      return toProxy(href);
    } catch (e) {
      return null;
    }
  }

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
      // 不能改 arguments[1]：严格模式下对 axios 的 XHR 无效，会导致仍直连 aniw*/oniw*
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
      var href = this.__sdRewrote || this.__sdHref || '';
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

  /** 配置里下发的 apiDomain 改成本地，避免业务层继续拼 https://aniw976... */
  function rewriteApiDomainText(text) {
    if (!text || typeof text !== 'string') return text;
    return text.replace(/https?:\/\/(?:aniw|oniw)\d*\.679win\.[a-z.]+/gi, LOCAL_ORIGIN);
  }

  if (XO) {
    var xoDesc = Object.getOwnPropertyDescriptor(XO.prototype, 'responseText');
    if (xoDesc && xoDesc.get) {
      Object.defineProperty(XO.prototype, 'responseText', {
        configurable: true,
        enumerable: xoDesc.enumerable,
        get: function () {
          var t = xoDesc.get.call(this);
          try {
            if (this.responseType && this.responseType !== '' && this.responseType !== 'text') return t;
          } catch (e) {}
          return rewriteApiDomainText(t);
        }
      });
    }
  }

  if (typeof rawFetch === 'function') {
    var patchedFetch = window.fetch;
    window.fetch = function (input, init) {
      return Promise.resolve(patchedFetch.apply(this, arguments)).then(function (res) {
        try {
          if (!res || !res.ok) return res;
          var ct = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
          if (ct.indexOf('json') === -1 && ct.indexOf('text') === -1 && ct.indexOf('javascript') === -1) return res;
          return res.text().then(function (text) {
            var next = rewriteApiDomainText(text);
            if (next === text) return res;
            return new Response(next, {
              status: res.status,
              statusText: res.statusText,
              headers: res.headers
            });
          });
        } catch (e) {
          return res;
        }
      });
    };
  }

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
    navigator.serviceWorker.register("/__sd_sw.js", { scope: '/' }).then(function () {
      try { console.info('[sd-adapter] service worker registered'); } catch (e) {}
    }).catch(function (err) {
      try { console.warn('[sd-adapter] sw register failed', err); } catch (e) {}
    });
  }

  try { console.info('[sd-adapter] boot ready', LOCAL_ORIGIN); } catch (e) {}
})();
