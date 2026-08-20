require('./playwright-env');

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const { browsersPath } = require('./playwright-env');

async function checkBrowser() {
  try {
    const browser = await chromium.launch({ headless: true });
    await browser.close();
    return { ok: true, path: browsersPath };
  } catch (err) {
    const msg = err.message || '';
    const missing = msg.includes("Executable doesn't exist") || msg.includes('npx playwright install');
    return {
      ok: false,
      missing,
      path: browsersPath,
      error: missing
        ? 'Playwright Chromium 未安装，请运行: npx playwright install chromium'
        : msg.split('\n')[0]
    };
  }
}

function findChromeExe(dir) {
  if (!fs.existsSync(dir)) return null;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findChromeExe(full);
      if (found) return found;
    } else if (entry.name === 'chrome.exe') {
      return full;
    }
  }
  return null;
}

function getBrowserInfo() {
  const chrome = findChromeExe(browsersPath);
  return {
    browsersPath,
    installed: !!chrome,
    chromePath: chrome
  };
}

module.exports = { checkBrowser, getBrowserInfo };
