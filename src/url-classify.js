const path = require('path');
const crypto = require('crypto');

const TEMPLATE_RE = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;
const STATIC_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif',
  '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.mp4', '.webm', '.wasm', '.map'
]);

function decodeSafe(url) {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
}

function hasUnresolvedTemplate(url) {
  return TEMPLATE_RE.test(decodeSafe(url || ''));
}

function isOriginOnly(url) {
  try {
    const parsed = new URL(url);
    return (parsed.pathname === '/' || parsed.pathname === '') && !parsed.search;
  } catch {
    return false;
  }
}

function pathnameExt(url) {
  try {
    return path.extname(new URL(url).pathname).toLowerCase();
  } catch {
    return '';
  }
}

function isApiLike(resourceType, url) {
  if (resourceType === 'xhr' || resourceType === 'fetch') {
    const ext = pathnameExt(url);
    if (STATIC_EXTS.has(ext)) return false;
    return true;
  }
  try {
    const parsed = new URL(url);
    if (parsed.pathname.includes('/api/')) return true;
  } catch {
    return false;
  }
  return false;
}

function extractTemplateContext(html) {
  const ctx = {};
  if (!html) return ctx;
  const pairs = [
    ['layout', /data-skin-layout=["']([^"']+)/i],
    ['bg', /data-skin-bg=["']([^"']+)/i],
    ['skin', /data-skin-id=["']([^"']+)/i]
  ];
  for (const [key, regex] of pairs) {
    const match = html.match(regex);
    if (match) ctx[key] = match[1];
  }
  return ctx;
}

function extractTemplateContextFromNetwork(network) {
  const ctx = {};
  for (const entry of network || []) {
    const url = entry && entry.url;
    if (!url || !url.includes('/lobby_asset/')) continue;
    const skinMatch = url.match(/\/lobby_asset\/(\d+)-(\d+)-(\d+)\//);
    if (skinMatch) {
      ctx.layout = skinMatch[1];
      ctx.bg = skinMatch[2];
      ctx.skin = skinMatch[3];
      return ctx;
    }
    const commonMatch = url.match(/\/lobby_asset\/(\d+)-(\d+)-common\//);
    if (commonMatch && !ctx.layout) {
      ctx.layout = commonMatch[1];
      ctx.bg = commonMatch[2];
      ctx.skin = 'common';
    }
  }
  return ctx;
}

function mergeTemplateContext(html, network) {
  return { ...extractTemplateContextFromNetwork(network), ...extractTemplateContext(html) };
}

function expandTemplates(url, ctx) {
  if (!ctx || !Object.keys(ctx).length) return url;
  return decodeSafe(url).replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (full, key) => (
    ctx[key] != null ? String(ctx[key]) : full
  ));
}

function isLikelyAssetFile(url) {
  try {
    const parsed = new URL(url);
    const pathname = decodeSafe(parsed.pathname);
    if (!pathname || pathname === '/') return false;
    if (pathname.endsWith('/')) return false;

    const base = path.basename(pathname.split('?')[0]);
    if (!base || base === '.' || base === '..') return false;

    const ext = path.extname(base).toLowerCase();
    if (STATIC_EXTS.has(ext)) return true;

    if (pathname.includes('/lobby_asset/') && ext) return true;

    return false;
  } catch {
    return false;
  }
}

function isOptionalMissing(url) {
  try {
    const pathname = decodeSafe(new URL(url).pathname);
    if (pathname.includes('/pwa/manifest')) return true;
    if (pathname.includes('/node_modules/')) return true;
    if (pathname.endsWith('ssocdn.txt')) return true;
    if (pathname.includes('/maintain-time')) return true;
    if (pathname.endsWith('/webPush') || pathname.includes('/webPush/')) return true;
    if (pathname.endsWith('/video.js')) return true;
    return false;
  } catch {
    return /node_modules|\/pwa\/manifest|maintain-time|ssocdn\.txt|webPush/.test(url || '');
  }
}

const DEFAULT_LOBBY_CDN_BASES = [
  'https://gfdgxc.couragepgpay.com/siteadmin/skin'
];

function collectAssetCdnBases(network, extraText) {
  const bases = new Set(DEFAULT_LOBBY_CDN_BASES);
  for (const entry of network || []) {
    const url = entry && entry.url;
    if (!url) continue;
    const idx = url.indexOf('/lobby_asset/');
    if (idx > 8) bases.add(url.slice(0, idx));
  }
  if (extraText) {
    const re = /https?:\/\/[^\s"'<>]+(?=\/(?:siteadmin\/skin\/)?lobby_asset\/)/gi;
    let match;
    while ((match = re.exec(extraText)) !== null) {
      let base = match[0].replace(/\/$/, '');
      const lobbyIdx = base.indexOf('/lobby_asset/');
      if (lobbyIdx > 0) base = base.slice(0, lobbyIdx);
      bases.add(base);
    }
  }
  return [...bases];
}

function lobbyAssetLocalPath(url) {
  try {
    const pathname = decodeSafe(new URL(url).pathname);
    const idx = pathname.indexOf('/lobby_asset/');
    if (idx >= 0) return pathname.slice(idx + 1);
  } catch {}
  return null;
}

function lobbyAssetStemKey(localPath) {
  if (!localPath) return '';
  let p = String(localPath).replace(/^siteadmin\/skin\//, '').replace(/\\/g, '/');
  const ext = path.extname(p).toLowerCase();
  let base = ext ? p.slice(0, -ext.length) : p;
  base = base.replace(/\.[a-f0-9]{6,}$/i, '');
  base = base.replace(/\d+$/i, '');
  return base;
}

function buildLobbyAssetHints(network) {
  const hints = new Map();
  for (const entry of network || []) {
    const url = entry && entry.url;
    if (!url || !url.includes('/lobby_asset/')) continue;
    const local = lobbyAssetLocalPath(url);
    if (!local) continue;
    hints.set(local, url);
    hints.set(lobbyAssetStemKey(local), url);
  }
  return hints;
}

function lobbyAssetSavePath(url, contentType, dedupe) {
  const local = lobbyAssetLocalPath(url);
  if (!local) return dedupe.urlToLocalPath(url, contentType);
  try {
    const parsed = new URL(url);
    let filename = path.basename(decodeSafe(parsed.pathname));
    if (parsed.search && !/\.[a-f0-9]{6,}\.[a-z0-9]+$/i.test(filename)) {
      const ext = path.extname(filename);
      const base = ext ? filename.slice(0, -ext.length) : filename;
      const queryHash = crypto.createHash('md5').update(parsed.search).digest('hex').slice(0, 8);
      filename = ext ? `${base}.${queryHash}${ext}` : `${base}.${queryHash}`;
    }
    return path.posix.join(path.posix.dirname(local), filename);
  } catch {
    return local;
  }
}

module.exports = {
  TEMPLATE_RE,
  STATIC_EXTS,
  DEFAULT_LOBBY_CDN_BASES,
  hasUnresolvedTemplate,
  isOriginOnly,
  isApiLike,
  isLikelyAssetFile,
  isOptionalMissing,
  extractTemplateContext,
  extractTemplateContextFromNetwork,
  mergeTemplateContext,
  expandTemplates,
  collectAssetCdnBases,
  lobbyAssetLocalPath,
  lobbyAssetStemKey,
  buildLobbyAssetHints,
  lobbyAssetSavePath,
  pathnameExt
};
