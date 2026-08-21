/**
 * 站点目录约定（多站点、可反复生成）
 *
 *   input/<siteId>/    ← 原始 dist，永远不改
 *   output/<siteId>/   ← 接口适配后的部署包，可随时删掉重生成
 *
 * siteId 例: 679win、675win、example
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INPUT_ROOT = path.join(ROOT, 'input');
const OUTPUT_ROOT = path.join(ROOT, 'output');

/** hostname / 路径 / 已有 id → 稳定 siteId */
function toSiteId(raw) {
  let s = String(raw || '').trim().replace(/\\/g, '/');
  if (!s) return '';
  // 取最后一段目录名
  s = s.replace(/\/+$/, '');
  const base = s.includes('/') ? s.split('/').pop() : s;
  // 679win.com / www.679win.com → 679win
  let id = base.toLowerCase();
  id = id.replace(/^www\./, '');
  id = id.replace(/\.com$|\.net$|\.me$|\.cc$|\.bet$|\.win$/i, '');
  id = id.replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return id;
}

function inputDir(siteId) {
  return path.join(INPUT_ROOT, toSiteId(siteId));
}

function outputDir(siteId) {
  return path.join(OUTPUT_ROOT, toSiteId(siteId));
}

function copyRecursive(src, dest, options = {}) {
  const skip = new Set(options.skip || []);
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const name of fs.readdirSync(src)) {
      if (skip.has(name)) continue;
      copyRecursive(path.join(src, name), path.join(dest, name), options);
    }
    return;
  }
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

function emptyDir(dir) {
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  ROOT,
  INPUT_ROOT,
  OUTPUT_ROOT,
  toSiteId,
  inputDir,
  outputDir,
  copyRecursive,
  emptyDir
};
