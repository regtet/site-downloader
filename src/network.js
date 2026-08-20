require('./playwright-env');
const { chromium } = require('playwright');

class NetworkMonitor {
  constructor(options = {}) {
    this.timeout = options.timeout || 60000;
    this.waitUntil = options.waitUntil || 'load';
    this.extraWait = options.extraWait || 3000;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.entries = [];
  }

  async capture(url) {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      userAgent: this.userAgent,
      ignoreHTTPSErrors: true
    });
    const page = await context.newPage();

    page.on('response', async (response) => {
      const request = response.request();
      const entry = {
        url: response.url(),
        method: request.method(),
        resourceType: request.resourceType(),
        status: response.status(),
        contentType: response.headers()['content-type'] || '',
        fromCache: response.fromCache ? true : false
      };
      this.entries.push(entry);
    });

    let finalHtml = '';
    let pageError = null;

    try {
      await page.goto(url, {
        waitUntil: this.waitUntil,
        timeout: this.timeout
      });
      if (this.extraWait > 0) {
        await page.waitForTimeout(this.extraWait);
      }
      try {
        await page.waitForLoadState('networkidle', { timeout: 5000 });
      } catch {
      }
      finalHtml = await page.content();
    } catch (err) {
      pageError = err.message;
      try {
        finalHtml = await page.content();
      } catch {
        finalHtml = '';
      }
    }

    await browser.close();

    return {
      html: finalHtml,
      network: this.entries,
      error: pageError
    };
  }
}

module.exports = NetworkMonitor;
