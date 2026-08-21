require('./playwright-env');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { startEphemeralServer } = require('./static-server');

function assetKey(url) {
  try {
    return new URL(url).pathname.replace(/\\/g, '/');
  } catch {
    return String(url || '');
  }
}

function basenameKey(url) {
  const p = assetKey(url);
  return p.split('/').pop() || p;
}

function countBy(arr, keyFn) {
  const map = {};
  for (const item of arr) {
    const k = keyFn(item);
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

function duplicates(countMap) {
  return Object.entries(countMap)
    .filter(([, n]) => n > 1)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

async function captureSide(browser, label, pageUrl, waitMs, focusToken) {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const network = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push({ text: msg.text(), location: msg.location() });
    }
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err && err.message ? err.message : err));
  });
  page.on('response', async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (!['script', 'stylesheet', 'document', 'xhr', 'fetch', 'manifest', 'other'].includes(type)) return;
    let contentType = '';
    try { contentType = res.headers()['content-type'] || ''; } catch {}
    network.push({
      phase: 'response',
      url: res.url(),
      status: res.status(),
      type,
      contentType,
      ok: res.ok()
    });
  });

  const started = Date.now();
  let gotoError = null;
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  } catch (err) {
    gotoError = String(err && err.message ? err.message : err);
  }

  await page.waitForTimeout(waitMs);

  const snapshot = await page.evaluate((focus) => {
    function cssPath(el) {
      if (!el || el.nodeType !== 1) return '';
      const parts = [];
      let cur = el;
      while (cur && cur.nodeType === 1 && parts.length < 6) {
        let part = cur.tagName.toLowerCase();
        if (cur.id) {
          part += '#' + cur.id;
          parts.unshift(part);
          break;
        }
        const cls = (cur.className && typeof cur.className === 'string')
          ? cur.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).join('.')
          : '';
        if (cls) part += '.' + cls;
        const parent = cur.parentElement;
        if (parent) {
          const siblings = [...parent.children].filter((c) => c.tagName === cur.tagName);
          if (siblings.length > 1) part += `:nth-of-type(${siblings.indexOf(cur) + 1})`;
        }
        parts.unshift(part);
        cur = parent;
      }
      return parts.join(' > ');
    }

    const overlays = [...document.querySelectorAll('.ui-overlay')].map((el, idx) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        index: idx,
        className: el.className,
        path: cssPath(el),
        childCount: el.children.length,
        textSample: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
        zIndex: style.zIndex,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        hasFrosted: el.classList.contains('isShowFrostedGlassEffect'),
        innerHTMLLength: (el.innerHTML || '').length
      };
    });

    const links = [...document.querySelectorAll('link[rel="stylesheet"], link[as="style"]')].map((el) => ({
      href: el.href,
      rel: el.rel,
      disabled: !!el.disabled,
      sheet: !!(el.sheet)
    }));

    const bodyOutline = [...document.body.children].map((el, idx) => ({
      index: idx,
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
      childCount: el.children.length
    }));

    const perfScripts = performance.getEntriesByType('resource')
      .filter((e) => e.initiatorType === 'script' || /\.js(\?|$)/i.test(e.name))
      .map((e) => ({ name: e.name, duration: Math.round(e.duration), transferSize: e.transferSize || 0 }));

    const perfCss = performance.getEntriesByType('resource')
      .filter((e) => e.initiatorType === 'link' || e.initiatorType === 'css' || /\.css(\?|$)/i.test(e.name))
      .map((e) => ({ name: e.name, duration: Math.round(e.duration), transferSize: e.transferSize || 0 }));

    let localStorageDump = {};
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        localStorageDump[k] = String(localStorage.getItem(k) || '').slice(0, 200);
      }
    } catch (e) {
      localStorageDump = { error: String(e) };
    }

    return {
      title: document.title,
      url: location.href,
      bodyChildCount: document.body.children.length,
      bodyOutline,
      overlayCount: overlays.length,
      overlays,
      scriptTagCount: document.querySelectorAll('script').length,
      stylesheetLinkCount: links.length,
      stylesheets: links,
      perfScripts,
      perfCss,
      localStorage: localStorageDump,
      htmlLength: document.documentElement.outerHTML.length
    };
  }, focusToken);

  const cookies = await context.cookies();
  const scriptsNet = network.filter((n) => n.type === 'script' || /\.js(\?|$)/i.test(n.url));
  const cssNet = network.filter((n) => n.type === 'stylesheet' || /\.css(\?|$)/i.test(n.url));
  const scriptLoadsByName = countBy(scriptsNet, (n) => basenameKey(n.url));
  const cssLoadsByName = countBy(cssNet, (n) => basenameKey(n.url));
  const focusScriptLoads = scriptsNet.filter((n) => basenameKey(n.url).includes(focusToken));

  await context.close();

  return {
    label,
    pageUrl,
    gotoError,
    elapsedMs: Date.now() - started,
    snapshot,
    cookies: cookies.map((c) => ({ name: c.name, domain: c.domain })),
    consoleErrors,
    pageErrors,
    networkSummary: {
      scriptResponses: scriptsNet.length,
      cssResponses: cssNet.length,
      failedScripts: scriptsNet.filter((n) => !n.ok || n.status >= 400).map((n) => ({ url: n.url, status: n.status, contentType: n.contentType })),
      failedCss: cssNet.filter((n) => !n.ok || n.status >= 400).map((n) => ({ url: n.url, status: n.status })),
      wrongTypeScripts: scriptsNet.filter((n) => n.ok && n.contentType && /text\/html/i.test(n.contentType)).map((n) => ({ url: n.url, status: n.status })),
      duplicateScriptByName: duplicates(scriptLoadsByName),
      duplicateCssByName: duplicates(cssLoadsByName),
      focusScriptLoads: focusScriptLoads.map((n) => ({ url: n.url, status: n.status, ok: n.ok })),
      focusLoadCount: focusScriptLoads.length
    }
  };
}

function summarizeWhyTwoOverlays(source, local, staticHtmlInfo) {
  const reasons = [];
  const sCount = source.snapshot.overlayCount;
  const lCount = local.snapshot.overlayCount;

  if (staticHtmlInfo && staticHtmlInfo.uiOverlayClassAttrCount > 0) {
    reasons.push(`静态 index.html 已含 ${staticHtmlInfo.uiOverlayClassAttrCount} 处 ui-overlay class（水合后 DOM 写入 dist 会导致 JS 再挂载一份）。`);
  }

  if (lCount <= 1 && sCount <= 1 && reasons.length === 0) {
    reasons.push('本地与源站 overlay 数量均 ≤1，本次未复现双弹框。');
    return reasons;
  }

  if (lCount > sCount) {
    reasons.push(`本地 overlay=${lCount}，源站 overlay=${sCount}：本地多出 ${lCount - sCount} 个。`);
  }

  if (local.networkSummary.failedCss.length) {
    reasons.push(`本地有 ${local.networkSummary.failedCss.length} 个 CSS 加载失败，可能导致弹框样式异常。`);
  }
  if (local.networkSummary.failedScripts.length) {
    reasons.push(`本地有 ${local.networkSummary.failedScripts.length} 个 JS/chunk 404，运行时可能反复重试。`);
  }
  if (local.networkSummary.wrongTypeScripts.length) {
    reasons.push('存在 JS 请求返回 text/html（404 fallback），会导致脚本执行异常。');
  }
  if (local.networkSummary.focusLoadCount > 1) {
    reasons.push(`关注脚本被加载 ${local.networkSummary.focusLoadCount} 次，可能重复执行。`);
  }

  const visible = (local.snapshot.overlays || []).filter((o) => o.width >= 50 && o.height >= 50 && o.display !== 'none');
  if (visible.length >= 2) {
    reasons.push('本地同时存在 ≥2 个可见 overlay：静态壳 + JS 挂载 或 chunk 重复加载。');
  }

  return reasons;
}

function buildDiff(source, local, opts, staticHtmlInfo) {
  const domInconsistencies = [];
  if (source.snapshot.overlayCount !== local.snapshot.overlayCount) {
    domInconsistencies.push({ type: 'overlay-count', source: source.snapshot.overlayCount, local: local.snapshot.overlayCount });
  }
  if (source.snapshot.bodyChildCount !== local.snapshot.bodyChildCount) {
    domInconsistencies.push({
      type: 'body-child-count',
      source: source.snapshot.bodyChildCount,
      local: local.snapshot.bodyChildCount,
      sourceOutline: source.snapshot.bodyOutline,
      localOutline: local.snapshot.bodyOutline
    });
  }

  const topFindings = [];
  if (local.snapshot.overlayCount >= 2) topFindings.push('本地最终 DOM 存在 ≥2 个 .ui-overlay');
  if (local.networkSummary.failedScripts.length) topFindings.push(`本地失败 JS ${local.networkSummary.failedScripts.length} 个`);
  if (local.networkSummary.failedCss.length) topFindings.push(`本地失败 CSS ${local.networkSummary.failedCss.length} 个`);

  const whyTwoDialogs = summarizeWhyTwoOverlays(source, local, staticHtmlInfo);

  return {
    generatedAt: new Date().toISOString(),
    options: opts,
    summary: {
      domInconsistencies,
      jsRepeatedExecution: {
        sourceDuplicates: source.networkSummary.duplicateScriptByName.slice(0, 20),
        localDuplicates: local.networkSummary.duplicateScriptByName.slice(0, 20),
        focusScriptLoadCount: {
          source: source.networkSummary.focusLoadCount,
          local: local.networkSummary.focusLoadCount
        }
      },
      cssMissingOrFailed: {
        localFailedCss: local.networkSummary.failedCss.slice(0, 50),
        localStylesheetLinks: local.snapshot.stylesheets.slice(0, 30)
      },
      whyTwoDialogs,
      topFindings,
      consistent: domInconsistencies.length === 0
        && !local.networkSummary.failedScripts.length
        && local.snapshot.overlayCount <= 1
    },
    overlayDiff: { source: source.snapshot.overlays, local: local.snapshot.overlays },
    console: {
      sourceErrors: source.consoleErrors.slice(0, 30),
      localErrors: local.consoleErrors.slice(0, 30)
    },
    sides: {
      source: { overlayCount: source.snapshot.overlayCount, networkSummary: source.networkSummary },
      local: { overlayCount: local.snapshot.overlayCount, networkSummary: local.networkSummary }
    }
  };
}

function readStaticOverlayCount(localDir) {
  const indexPath = path.join(localDir, 'index.html');
  if (!fs.existsSync(indexPath)) return null;
  const html = fs.readFileSync(indexPath, 'utf8');
  return {
    file: indexPath,
    uiOverlayClassAttrCount: (html.match(/class="[^"]*ui-overlay[^"]*"/g) || []).length,
    htmlSourceNote: html.includes('data-site-downloader-shim') ? 'has-shim' : 'clean'
  };
}

async function compareRuntime(options = {}) {
  const {
    sourceUrl,
    localDir,
    port = 3460,
    waitMs = 12000,
    focus = '',
    outPath = null
  } = options;

  if (!fs.existsSync(localDir)) {
    throw new Error('本地 dist 目录不存在: ' + localDir);
  }

  const staticHtmlInfo = readStaticOverlayCount(localDir);
  const { server, port: boundPort } = await startEphemeralServer(localDir, port);
  const browser = await chromium.launch({ headless: true });

  try {
    const source = await captureSide(browser, 'source', sourceUrl, waitMs, focus);
    const local = await captureSide(browser, 'local', `http://127.0.0.1:${boundPort}/`, waitMs, focus);
    const diff = buildDiff(source, local, {
      source: sourceUrl,
      localDir,
      localUrl: `http://127.0.0.1:${boundPort}/`,
      waitMs,
      focus
    }, staticHtmlInfo);
    diff.staticHtmlBeforeRuntime = staticHtmlInfo;

    const target = outPath || path.join(localDir, 'diff.json');
    fs.writeFileSync(target, JSON.stringify(diff, null, 2), 'utf8');
    return { diff, diffPath: target, source, local };
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

module.exports = {
  compareRuntime,
  buildDiff,
  captureSide,
  readStaticOverlayCount
};
