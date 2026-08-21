/**
 * 手动登录抓包：打开有头浏览器，由用户登录并点个人中心/充值，再点「完成抓包」
 */
require('./playwright-env');
const { chromium } = require('playwright');
const { getPlaywrightProxy, applySystemProxy } = require('./system-proxy');
const {
  normalizePath,
  classifyPage
} = require('./post-login-deps');

applySystemProxy({ log: false });

/** @type {Map<string, ManualCaptureSession>} */
const sessions = new Map();

function summarizeBody(text, contentType) {
  const out = {
    okJson: false,
    code: null,
    msg: null,
    topKeys: [],
    dataKeys: [],
    data: null,
    body: null
  };
  if (!text) return out;
  const ct = String(contentType || '').toLowerCase();
  if (!ct.includes('json') && !/^\s*[{[]/.test(text)) return out;
  try {
    const body = JSON.parse(text);
    out.okJson = true;
    out.code = body.code != null ? body.code : (body.status != null ? body.status : null);
    out.msg = body.msg != null ? String(body.msg).slice(0, 120) : (body.message || null);
    out.topKeys = Object.keys(body).slice(0, 30);
    const data = body.data != null && typeof body.data === 'object' ? body.data : body;
    out.data = data;
    out.body = body;
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      out.dataKeys = Object.keys(data).slice(0, 40);
    } else if (Array.isArray(data) && data[0] && typeof data[0] === 'object') {
      out.dataKeys = ['[]'].concat(Object.keys(data[0]).slice(0, 30));
    }
  } catch (_) { /* ignore */ }
  return out;
}

function headerGet(headers, name) {
  if (!headers) return null;
  const want = String(name).toLowerCase();
  if (typeof headers === 'object' && !Array.isArray(headers)) {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === want) return headers[k];
    }
    return null;
  }
  if (Array.isArray(headers)) {
    const hit = headers.find((h) => String(h.name || '').toLowerCase() === want);
    return hit ? hit.value : null;
  }
  return null;
}

class ManualCaptureSession {
  constructor(id, options) {
    this.id = id;
    this.side = options.side || 'unknown';
    this.pageUrl = options.pageUrl;
    this.status = 'starting';
    this.startedAt = new Date().toISOString();
    this.finishedAt = null;
    this.error = null;
    this.entries = [];
    this.consoleErrors = [];
    this._browser = null;
    this._page = null;
    this._closed = false;
  }

  info() {
    const paths = new Set(this.entries.map((e) => e.pathname));
    const hasLoginApi = [...paths].some((p) => /\/api\/member\/(login|getfastlogin|user\/info|v2\/user\/info)/i.test(p));
    const hasPostLogin = [...paths].some((p) =>
      /\/api\/(gamecenter\/gold|member\/user\/avatars|member\/user\/vip|finance\/pay|finance\/certify)/i.test(p)
    );
    return {
      id: this.id,
      side: this.side,
      pageUrl: this.pageUrl,
      status: this.status,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      error: this.error,
      apiCount: this.entries.length,
      uniqueApis: paths.size,
      hasLoginApi,
      hasPostLogin,
      hint: this.status === 'recording'
        ? (hasLoginApi
          ? (hasPostLogin
            ? '已看到登录后接口，可点「完成抓包」'
            : '已登录迹象：请再点个人中心 / 充值 / VIP')
          : '请在弹出的浏览器里手动登录，再打开个人中心、充值等页面')
        : null
    };
  }

  async start() {
    const proxy = getPlaywrightProxy();
    this._browser = await chromium.launch({
      headless: false,
      proxy: proxy || undefined,
      args: ['--disable-web-security']
    });
    const context = await this._browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: 420, height: 900 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });
    this._page = await context.newPage();

    this._page.on('console', (msg) => {
      if (msg.type() === 'error') this.consoleErrors.push(msg.text().slice(0, 300));
    });

    this._page.on('response', async (res) => {
      if (this._closed) return;
      const req = res.request();
      const type = req.resourceType();
      if (!['xhr', 'fetch'].includes(type) && !(type === 'other' && /\/api\//.test(res.url()))) return;
      const url = res.url();
      if (!/\/(?:hall\/)?api\//i.test(url) && !/\/__sd_proxy__/i.test(url)) return;

      let text = '';
      try {
        text = await res.text();
        if (text.length > 200000) text = text.slice(0, 200000);
      } catch (_) { /* ignore */ }

      const headers = res.headers();
      const summary = summarizeBody(text, headers['content-type']);
      const pathname = normalizePath(url);
      this.entries.push({
        url,
        method: req.method(),
        status: res.status(),
        pathname,
        pageCategory: classifyPage(pathname),
        contentType: headers['content-type'] || '',
        bridge: headers['x-sd-adapter'] || null,
        code: summary.code,
        msg: summary.msg,
        topKeys: summary.topKeys,
        dataKeys: summary.dataKeys,
        okJson: summary.okJson,
        data: summary.data,
        body: summary.body,
        at: new Date().toISOString()
      });
    });

    try {
      await this._page.goto(this.pageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    } catch (err) {
      this.error = String(err && err.message || err);
    }
    this.status = 'recording';

    // 浏览器被用户关掉时自动收尾
    this._browser.on('disconnected', () => {
      if (!this._closed) {
        this._closed = true;
        this.status = 'stopped';
        this.finishedAt = new Date().toISOString();
      }
    });

    return this.info();
  }

  async stop() {
    this._closed = true;
    this.status = 'stopped';
    this.finishedAt = new Date().toISOString();
    try {
      if (this._browser) await this._browser.close();
    } catch (_) { /* ignore */ }
    this._browser = null;
    this._page = null;
    return this.toCapture();
  }

  toCapture() {
    return {
      side: this.side,
      pageUrl: this.pageUrl,
      login: {
        ok: this.info().hasLoginApi,
        reason: this.info().hasLoginApi ? 'manual-login-detected' : 'manual-no-login-api'
      },
      gotoError: this.error,
      entries: this.entries.slice(),
      consoleErrors: this.consoleErrors.slice(0, 40),
      meta: this.info()
    };
  }
}

async function startManualCapture({ side, pageUrl }) {
  const id = `cap-${side}-${Date.now()}`;
  const session = new ManualCaptureSession(id, { side, pageUrl });
  sessions.set(id, session);
  try {
    await session.start();
  } catch (err) {
    session.status = 'failed';
    session.error = err.message;
    session.finishedAt = new Date().toISOString();
  }
  return session.info();
}

function getManualCapture(id) {
  const s = sessions.get(id);
  return s ? s.info() : null;
}

async function stopManualCapture(id) {
  const s = sessions.get(id);
  if (!s) throw new Error('抓包会话不存在');
  const capture = await s.stop();
  // 保留结果一段时间供对比
  sessions.set(id, Object.assign(s, { _result: capture, status: 'stopped' }));
  return capture;
}

function getManualCaptureResult(id) {
  const s = sessions.get(id);
  if (!s) return null;
  if (s._result) return s._result;
  if (s.status === 'recording' || s.status === 'starting') return s.toCapture();
  return s.toCapture();
}

/**
 * 解析 HAR / 自研 dump / 抓包结果
 */
function parseNetworkDump(raw, label = 'dump') {
  if (!raw) throw new Error('空 Network 数据');
  if (typeof raw === 'string') raw = JSON.parse(raw);

  // 已是 capture 结构
  if (Array.isArray(raw.entries) && (raw.pageUrl || raw.side || raw.login)) {
    return {
      pageUrl: raw.pageUrl || label,
      login: raw.login || { ok: true, reason: 'capture' },
      gotoError: raw.gotoError || null,
      entries: raw.entries.filter((e) => /\/api\//i.test(e.pathname || e.url || '')),
      consoleErrors: raw.consoleErrors || []
    };
  }

  // HAR
  if (raw.log && Array.isArray(raw.log.entries)) {
    return {
      pageUrl: label,
      login: { ok: true, reason: 'imported-har' },
      entries: raw.log.entries.map((ent) => {
        const url = ent.request.url;
        const pathname = normalizePath(url);
        let text = '';
        try {
          const c = ent.response && ent.response.content;
          if (c && c.text) {
            text = c.encoding === 'base64'
              ? Buffer.from(c.text, 'base64').toString('utf8')
              : c.text;
          }
        } catch (_) { /* ignore */ }
        const summary = summarizeBody(text, ent.response?.content?.mimeType);
        const bridge = headerGet(ent.response?.headers, 'x-sd-adapter');
        return {
          url,
          method: ent.request.method,
          status: ent.response && ent.response.status,
          pathname,
          pageCategory: classifyPage(pathname),
          contentType: ent.response?.content?.mimeType || '',
          bridge,
          code: summary.code,
          msg: summary.msg,
          topKeys: summary.topKeys,
          dataKeys: summary.dataKeys,
          data: summary.data,
          body: summary.body
        };
      }).filter((e) => /\/api\//i.test(e.pathname)),
      consoleErrors: []
    };
  }

  // 纯数组
  if (Array.isArray(raw)) {
    return parseNetworkDump({ entries: raw, pageUrl: label }, label);
  }

  const list = raw.network || raw.entries || [];
  return {
    pageUrl: label,
    login: { ok: true, reason: 'imported-json' },
    entries: list.map((e) => {
      const url = e.url || '';
      const pathname = normalizePath(e.pathname || url);
      return {
        url,
        method: e.method || 'GET',
        status: e.status,
        pathname,
        pageCategory: classifyPage(pathname),
        contentType: e.contentType || '',
        bridge: e.bridge || headerGet(e.headers, 'x-sd-adapter'),
        code: e.code != null ? e.code : null,
        msg: e.msg || null,
        topKeys: e.topKeys || [],
        dataKeys: e.dataKeys || [],
        data: e.data || null,
        body: e.body || null
      };
    }).filter((e) => /\/api\//i.test(e.pathname)),
    consoleErrors: []
  };
}

function assessCaptureQuality(capture, sideLabel) {
  const entries = (capture && capture.entries) || [];
  const paths = [...new Set(entries.map((e) => e.pathname))];
  const hasLoginApi = paths.some((p) => /\/api\/member\/(login|getfastlogin|user\/info|v2\/user\/info)/i.test(p));
  const hasPostLogin = paths.some((p) =>
    /\/api\/(gamecenter\/gold|member\/user\/(avatars|vip)|finance\/(pay|certify)|active\/allvip)/i.test(p)
  );
  const useful = entries.length > 0 && (hasLoginApi || hasPostLogin);
  return {
    side: sideLabel,
    apiCount: entries.length,
    uniqueApis: paths.length,
    hasLoginApi,
    hasPostLogin,
    useful,
    message: !entries.length
      ? `${sideLabel}：没有任何 /api 请求`
      : (!hasLoginApi && !hasPostLogin
        ? `${sideLabel}：只有大厅配置类接口，未见登录后业务（user/info、钱包、充值等）。请确认已登录并点过个人中心/充值`
        : null)
  };
}

module.exports = {
  startManualCapture,
  getManualCapture,
  stopManualCapture,
  getManualCaptureResult,
  parseNetworkDump,
  assessCaptureQuality,
  sessions
};
