/**
 * 从已下载 JS 中强制提取 Vite/构建产物里的 CSS、chunk 路径
 * （对应浏览器 Sources 里能看到、但 Network 首屏未必请求的资源）
 */
const fs = require('fs');
const path = require('path');

const CSS_IN_STRING_RE = /["']((?:\.?\.?\/)?(?:assets|static|vendors|lobby_asset|libs|cocos|siteadmin)?\/?[A-Za-z0-9_./-]*\.[A-Za-z0-9_-]{4,}\.css)["']/g;
const ASSET_PATH_RE = /["']((?:assets|static|vendors|lobby_asset|libs|cocos|siteadmin)\/[^"']+\.(?:css|js|mjs|cjs|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|wasm|json|mp3))["']/g;
const STATIC_ROOT_PATH_RE = /["'](\/static\/[^"']+\.(?:css|js|mjs|cjs|woff2?|ttf|otf|png|jpe?g|gif|webp|avif|svg|ico|wasm|json|map|mp3))["']/gi;
const REL_HASHED_RE = /["'](\.\/[A-Za-z0-9_.-]+\.(?:css|js|mjs|cjs))["']/g;
const BARE_HASHED_CSS_RE = /["']([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{4,}\.css)["']/g;

function extractViteFileDepsBlock(js) {
  const urls = new Set();
  const marker = '__vite__fileDeps';
  let idx = js.indexOf(marker);
  while (idx >= 0) {
    const slice = js.slice(idx, idx + 200000);
    const arrStart = slice.indexOf('[');
    if (arrStart < 0) break;
    let depth = 0;
    let end = -1;
    for (let i = arrStart; i < slice.length; i++) {
      const ch = slice[i];
      if (ch === '[') depth++;
      else if (ch === ']') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end > arrStart) {
      const block = slice.slice(arrStart, end + 1);
      for (const m of block.matchAll(/["']([^"']+)["']/g)) {
        urls.add(m[1]);
      }
    }
    idx = js.indexOf(marker, idx + marker.length);
  }
  return [...urls];
}

function extractAssetStringsFromJs(js) {
  const urls = new Set();
  extractViteFileDepsBlock(js).forEach((u) => urls.add(u));

  for (const re of [CSS_IN_STRING_RE, ASSET_PATH_RE, STATIC_ROOT_PATH_RE, REL_HASHED_RE, BARE_HASHED_CSS_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(js)) !== null) {
      urls.add(m[1]);
    }
  }
  return [...urls];
}

function resolveAssetString(raw, pageOrigin, fromLocalFile) {
  if (!raw || typeof raw !== 'string') return null;
  const val = raw.trim();
  if (!val || val.startsWith('data:') || val.startsWith('blob:')) return null;

  try {
    if (/^https?:\/\//i.test(val)) return val.split('#')[0];
    if (val.startsWith('/')) return new URL(val, pageOrigin).href;
    if (val.startsWith('assets/') || val.startsWith('static/') || val.startsWith('vendors/') || val.startsWith('lobby_asset/') || val.startsWith('libs/') || val.startsWith('cocos/') || val.startsWith('siteadmin/')) {
      return new URL('/' + val, pageOrigin).href;
    }
    if (val.startsWith('./') || val.startsWith('../')) {
      const base = pageOrigin.replace(/\/?$/, '/') + String(fromLocalFile || '').replace(/\\/g, '/');
      return new URL(val, base).href;
    }
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{4,}\.(?:css|js|mjs|cjs)$/i.test(val)) {
      const dir = path.posix.dirname(String(fromLocalFile || 'assets/theme-0/x.js').replace(/\\/g, '/'));
      return new URL('/' + dir + '/' + val, pageOrigin).href;
    }
  } catch {
    return null;
  }
  return null;
}

function harvestFromLocalJsTree(outputDir, sourceUrl, options = {}) {
  const found = new Set();
  const pageOrigin = new URL(sourceUrl).origin;
  // 只扫前端构建目录，跳过 lobby_asset 海量图片目录
  const roots = options.roots || ['assets', 'static', 'libs', 'cocos', 'vendors'];

  function walk(dir, relBase) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      const abs = path.join(dir, name);
      const rel = path.join(relBase, name).replace(/\\/g, '/');
      let st;
      try {
        st = fs.statSync(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(abs, rel);
        continue;
      }
      if (!/\.(js|mjs|cjs)$/i.test(name)) continue;
      // 超大 vendor 仍扫（含 fileDeps），但跳过 source map
      let content;
      try {
        content = fs.readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      for (const raw of extractAssetStringsFromJs(content)) {
        const href = resolveAssetString(raw, pageOrigin, rel);
        if (href) found.add(href);
      }
    }
  }

  for (const root of roots) {
    walk(path.join(outputDir, root), root);
  }
  // 根目录偶发入口
  const indexJs = path.join(outputDir, 'index.js');
  if (fs.existsSync(indexJs)) {
    try {
      for (const raw of extractAssetStringsFromJs(fs.readFileSync(indexJs, 'utf8'))) {
        const href = resolveAssetString(raw, pageOrigin, 'index.js');
        if (href) found.add(href);
      }
    } catch {}
  }

  return [...found];
}

module.exports = {
  extractViteFileDepsBlock,
  extractAssetStringsFromJs,
  resolveAssetString,
  harvestFromLocalJsTree
};
