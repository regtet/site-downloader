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

    page.on('response', (response) => {
      this.recordResponse(response);
      const request = response.request();
      if (request.resourceType() === 'document' && !documentCapturePromise) {
        documentCapturePromise = this.captureDocumentHtml(response);
      }
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

    let runtimeAssets = [];
    try {
      runtimeAssets = await page.evaluate(() => {
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
      runtimeAssets = [];
    }

    await browser.close();
    this._browser = null;

    const htmlSource = this.documentHtml ? 'document-response' : (fallbackHtml ? 'page-content-fallback' : 'empty');
    const html = this.documentHtml || fallbackHtml;

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
