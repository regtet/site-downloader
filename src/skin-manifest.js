const path = require('path');
const { collectAssetCdnBases, expandTemplates } = require('./url-classify');

const MANIFEST_NAME = 'assets.hash.json';
const SKIN_PREFIX_RE = /^\d+-\d+(?:-\d+|(?:-common))?\//;

function extractVersionQuery(network) {
  for (const entry of network || []) {
    const url = entry && entry.url;
    if (!url || !url.includes('/lobby_asset/')) continue;
    try {
      const parsed = new URL(url);
      if (parsed.search && (parsed.search.includes('version=') || parsed.search.includes('manualVersion='))) {
        return parsed.search;
      }
    } catch {}
  }
  return '';
}

function skinFolderFromManifestUrl(manifestUrl) {
  try {
    const pathname = new URL(manifestUrl).pathname;
    const marker = '/lobby_asset/';
    const idx = pathname.indexOf(marker);
    if (idx < 0) return '';
    const rest = pathname.slice(idx + marker.length);
    const parts = rest.split('/');
    return parts[0] || '';
  } catch {
    return '';
  }
}

function discoverManifestUrls(network, templateContext, assetCdnBases, html) {
  const urls = new Set();
  for (const entry of network || []) {
    const url = entry && entry.url;
    if (url && url.includes(MANIFEST_NAME)) urls.add(url.split('?')[0]);
  }

  const bases = [...new Set([...(assetCdnBases || []), ...collectAssetCdnBases(network, html || '')])];
  const ctx = templateContext || {};
  const skinVariants = new Set();
  if (ctx.layout && ctx.bg && ctx.skin) skinVariants.add(`${ctx.layout}-${ctx.bg}-${ctx.skin}`);
  if (ctx.layout && ctx.bg) skinVariants.add(`${ctx.layout}-${ctx.bg}-common`);
  skinVariants.add('common');

  for (const base of bases) {
    const root = base.replace(/\/$/, '');
    for (const variant of skinVariants) {
      urls.add(`${root}/lobby_asset/${variant}/${MANIFEST_NAME}`);
    }
  }

  return [...urls];
}

function resolveLobbyRelativePath(manifestSkinFolder, relPath) {
  const normalized = String(relPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (SKIN_PREFIX_RE.test(normalized)) return normalized;
  if (!manifestSkinFolder) return normalized;
  return `${manifestSkinFolder}/${normalized}`;
}

function manifestDownloadCandidates(siteadminSkinBase, relPath, hash, versionQuery) {
  const ext = path.extname(relPath).toLowerCase();
  const stemPath = relPath.slice(0, -ext.length);
  const qs = versionQuery || '';
  const root = siteadminSkinBase.replace(/\/$/, '');
  const lobbyPath = `/lobby_asset/${relPath.replace(/\\/g, '/')}`;
  const baseHttp = root + lobbyPath.slice(0, -ext.length);

  const urls = [];
  if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    urls.push(baseHttp + '.avif' + qs);
    urls.push(baseHttp + '.webp' + qs);
    urls.push(baseHttp + ext + qs);
  } else {
    urls.push(baseHttp + ext + qs);
  }

  return urls;
}

function manifestLocalPath(relPath, hash, usedExt) {
  const normalized = relPath.replace(/\\/g, '/');
  const ext = usedExt || path.extname(normalized);
  const stem = normalized.slice(0, -path.extname(normalized).length);
  const localExt = usedExt || path.extname(normalized);
  return `lobby_asset/${stem}.${hash}${localExt}`.replace(/\\/g, '/');
}

function parseManifestEntries(manifestUrl, data, versionQuery) {
  if (!data || typeof data !== 'object') return [];
  const siteadminSkinBase = manifestUrl.split('/lobby_asset/')[0];
  const manifestSkinFolder = skinFolderFromManifestUrl(manifestUrl);
  const entries = [];

  for (const [rawPath, hash] of Object.entries(data)) {
    if (!rawPath || !hash) continue;
    const relPath = resolveLobbyRelativePath(manifestSkinFolder, rawPath);
    const candidates = manifestDownloadCandidates(siteadminSkinBase, relPath, hash, versionQuery);
    entries.push({
      relPath,
      hash: String(hash),
      candidates,
      manifestUrl
    });
  }

  return entries;
}

module.exports = {
  MANIFEST_NAME,
  discoverManifestUrls,
  parseManifestEntries,
  manifestLocalPath,
  manifestDownloadCandidates,
  resolveLobbyRelativePath,
  skinFolderFromManifestUrl,
  extractVersionQuery
};
