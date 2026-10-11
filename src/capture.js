require('./playwright-env');
const { chromium } = require('playwright');
const { getPlaywrightProxy, applySystemProxy } = require('./system-proxy');
applySystemProxy({ log: false });

const TAB_SELECTORS = [
  '[role="tab"]:visible',
  '.van-tab',
  '.van-tabbar-item',
  '[class*="tab-item"]:visible',
  '[class*="TabItem"]:visible',
  '[class*="tabbar"] [class*="item"]:visible',
  '[class*="bottom-nav"] [class*="item"]:visible',
  '[class*="BottomNav"] button:visible',
  'nav button:visible',
  'nav a:visible'
];

class Capture {
  constructor(options = {}) {
    this.timeout = options.timeout || 60000;
    this.waitUntil = options.waitUntil || 'load';
    this.extraWait = options.extraWait != null ? options.extraWait : 1500;
    this.multiPageWait = options.multiPageWait || 700;
    this.maxMultiPageClicks = options.maxMultiPageClicks || 10;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.entries = [];
    this.documentHtml = '';
    this.documentUrl = '';
    this._browser = null;
    this._aborted = false;
  }

  abort() {
    this._aborted = true;
    const browser = this._browser;
    this._browser = null;
    if (browser) {
      browser.close().catch(() => {});
    }
  }

  recordResponse(response) {
    const request = response.request();
    this.entries.push({
      url: response.url(),
      method: request.method(),
      resourceType: request.resourceType(),
      status: response.status(),
      contentType: response.headers()['content-type'] || '',
      fromCache: response.fromCache ? true : false
    });
  }

  async readHtmlBody(response) {
    try {
      const ct = (response.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('text/html')) return '';
      const body = await response.text();
      return body && body.length > 100 ? body : '';
    } catch {
      return '';
    }
  }

  /**
   * 桌面 UA 下首页是 PC 外壳（<iframe src="./index.html">，如 zg 系列 uni-app 站），
   * 外壳和 iframe 页在本地都落到同一个 index.html，存外壳会让 iframe 套自己；改存 iframe 页。
   */
  async pickShellFrameDocument(mainHtml, mainUrl, frameDocs) {
    if (!mainHtml || !mainUrl || !/<iframe[\s>]/i.test(mainHtml)) return null;
    const indexKey = (u) => {
      const x = new URL(u);
      return x.origin + (x.pathname.endsWith('/') ? `${x.pathname}index.html` : x.pathname).toLowerCase();
    };
    let mainKey;
    try { mainKey = indexKey(mainUrl); } catch { return null; }
    for (const [frameUrl, bodyPromise] of frameDocs) {
      let key;
      try { key = indexKey(frameUrl); } catch { continue; }
      if (key !== mainKey) continue;
      const body = await bodyPromise;
      if (body && body !== mainHtml) return { url: frameUrl, html: body };
    }
    return null;
  }

  async collectRuntimeAssets(page) {
    try {
      return await page.evaluate(() => {
        const urls = new Set();
        try {
          for (const e of performance.getEntriesByType('resource')) {
            if (e && e.name) urls.add(e.name);
          }
        } catch {}
        try {
          for (const link of document.querySelectorAll('link[href]')) {
            if (link.href) urls.add(link.href);
          }
        } catch {}
        try {
          for (const sheet of document.styleSheets) {
            if (sheet.href) urls.add(sheet.href);
          }
        } catch {}
        try {
          for (const s of document.querySelectorAll('script[src]')) {
            if (s.src) urls.add(s.src);
          }
        } catch {}
        return [...urls];
      });
    } catch {
      return [];
    }
  }

  /** SPA 列表常放在内部滚动容器里，window 和所有可滚动元素一起滚，触发懒加载图片 */
  async scrollToBottom(page, steps = 8) {
    for (let i = 0; i < steps; i++) {
      try {
        await page.evaluate(() => {
          for (const el of document.querySelectorAll('*')) {
            const s = getComputedStyle(el);
            if (/(auto|scroll)/.test(s.overflowY) && el.scrollHeight > el.clientHeight + 10) el.scrollTop += 600;
          }
          window.scrollBy(0, 600);
        });
      } catch {
        return;
      }
      await page.waitForTimeout(600);
    }
    try { await page.waitForLoadState('networkidle', { timeout: 2500 }); } catch {}
  }

  async captureDocumentHtml(response) {
    try {
      const request = response.request();
      if (request.resourceType() !== 'document') return;
      const ct = (response.headers()['content-type'] || '').toLowerCase();
      if (!ct.includes('text/html')) return;
      const body = await response.text();
      if (body && body.length > 100) {
        this.documentHtml = body;
        this.documentUrl = response.url();
      }
    } catch {}
  }

  async explorePage(page, onLog) {
    const clicked = new Set();
    let clicks = 0;

    for (const selector of TAB_SELECTORS) {
      if (this._aborted || clicks >= this.maxMultiPageClicks) break;
      let elements = [];
      try {
        elements = await page.$$(selector);
      } catch {
        continue;
      }

      for (const el of elements) {
        if (clicks >= this.maxMultiPageClicks) break;
        try {
          const box = await el.boundingBox();
          if (!box || box.width < 8 || box.height < 8) continue;
          const label = ((await el.innerText()) || selector).trim().slice(0, 40);
          const key = `${selector}|${label}`;
          if (clicked.has(key)) continue;
          clicked.add(key);
          await el.click({ timeout: 2500 });
          clicks++;
          if (onLog) onLog(`多页面: 点击「${label || '导航'}」(${clicks}/${this.maxMultiPageClicks})`);
          await page.waitForTimeout(this.multiPageWait);
          try {
            await page.waitForLoadState('networkidle', { timeout: 2500 });
          } catch {}
        } catch {}
      }
    }

    return clicks;
  }

  async run(url, options = {}) {
    this.entries = [];
    this.documentHtml = '';
    this.documentUrl = '';
    this._aborted = false;

    const proxy = getPlaywrightProxy();
    const browser = await chromium.launch({
      headless: true,
      ...(proxy ? { proxy } : {})
    });
    this._browser = browser;
    const context = await browser.newContext({
      userAgent: this.userAgent,
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    let documentCapturePromise = null;
    const frameDocs = new Map();

    page.on('response', (response) => {
      this.recordResponse(response);
      const request = response.request();
      if (request.resourceType() !== 'document') return;
      if (!documentCapturePromise) {
        documentCapturePromise = this.captureDocumentHtml(response);
        return;
      }
      let isSubFrame = false;
      try { isSubFrame = request.frame() !== page.mainFrame(); } catch {}
      if (isSubFrame && !frameDocs.has(response.url())) frameDocs.set(response.url(), this.readHtmlBody(response));
    });

    let pageError = null;
    let multiPageClicks = 0;
    let fallbackHtml = '';

    try {
      if (this._aborted) throw Object.assign(new Error('已终止'), { code: 'CANCELLED' });
      await page.goto(url, {
        waitUntil: this.waitUntil,
        timeout: this.timeout
      });
      if (this._aborted) throw Object.assign(new Error('已终止'), { code: 'CANCELLED' });
      if (this.extraWait > 0) {
        await page.waitForTimeout(this.extraWait);
      }
      try {
        await page.waitForLoadState('networkidle', { timeout: 2500 });
      } catch {}

      if (options.multiPage && !this._aborted) {
        multiPageClicks = await this.explorePage(page, options.onLog);
      }
    } catch (err) {
      if (err && err.code === 'CANCELLED') throw err;
      pageError = err.message;
    }

    if (this._aborted) {
      try { await browser.close(); } catch {}
      this._browser = null;
      throw Object.assign(new Error('已终止'), { code: 'CANCELLED' });
    }

    if (documentCapturePromise) {
      await documentCapturePromise;
    }

    try {
      fallbackHtml = await page.content();
    } catch {
      fallbackHtml = '';
    }

    const runtimeAssetSet = new Set(await this.collectRuntimeAssets(page));

    const shellFrame = await this.pickShellFrameDocument(this.documentHtml, this.documentUrl || url, frameDocs);

    const extraRoutes = typeof options.extraRoutes === 'function'
      ? (options.extraRoutes(shellFrame ? shellFrame.html : (this.documentHtml || fallbackHtml)) || [])
      : [];
    for (const route of extraRoutes) {
      if (this._aborted) break;
      try {
        const target = new URL(route, url);
        new URL(url).searchParams.forEach((v, k) => {
          if (!target.searchParams.has(k)) target.searchParams.set(k, v);
        });
        if (options.onLog) options.onLog(`额外页面: ${target.pathname}${target.search}`);
        await page.goto(target.toString(), { waitUntil: this.waitUntil, timeout: this.timeout });
        if (this.extraWait > 0) await page.waitForTimeout(this.extraWait);
        try { await page.waitForLoadState('networkidle', { timeout: 2500 }); } catch {}
        await this.scrollToBottom(page);
        for (const u of await this.collectRuntimeAssets(page)) runtimeAssetSet.add(u);
      } catch (err) {
        if (options.onLog) options.onLog(`额外页面失败: ${route} ${err.message}`);
      }
    }
    const runtimeAssets = [...runtimeAssetSet];

    await browser.close();
    this._browser = null;

    let htmlSource = this.documentHtml ? 'document-response' : (fallbackHtml ? 'page-content-fallback' : 'empty');
    let html = this.documentHtml || fallbackHtml;
    if (shellFrame) {
      if (options.onLog) options.onLog(`首页是 PC 外壳（iframe → ${shellFrame.url}），改存 iframe 页为 index.html`);
      html = shellFrame.html;
      htmlSource = 'pc-shell-iframe';
    }

    // merge runtime assets into network-like entries so downstream treats them as discovered
    for (const assetUrl of runtimeAssets) {
      const already = this.entries.some((e) => e.url === assetUrl);
      if (already) continue;
      const isCss = /\.css(\?|$)/i.test(assetUrl);
      const isJs = /\.(js|mjs|cjs)(\?|$)/i.test(assetUrl);
      this.entries.push({
        url: assetUrl,
        method: 'GET',
        resourceType: isCss ? 'stylesheet' : (isJs ? 'script' : 'other'),
        status: 200,
        contentType: isCss ? 'text/css' : (isJs ? 'application/javascript' : ''),
        fromCache: false,
        fromRuntime: true
      });
    }

    return {
      html,
      htmlSource,
      documentUrl: this.documentUrl,
      network: this.entries,
      runtimeAssets,
      error: pageError,
      multiPage: !!options.multiPage,
      multiPageClicks
    };
  }
}

module.exports = Capture;
