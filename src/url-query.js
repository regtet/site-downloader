const CACHE_BUST_PARAMS = new Set([
  '_t', 't', 'timestamp', 'ts', 'v', 'version', 'manualVersion', 'web_v', '_ts', 'cacheBust'
]);

const HASHED_FILENAME_RE = /\.[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/i;

function isCacheBustQuery(search) {
  if (!search) return true;
  try {
    const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
    const keys = [...params.keys()];
    if (keys.length === 0) return true;
    return keys.every((key) => CACHE_BUST_PARAMS.has(key));
  } catch {
    return false;
  }
}

function stripCacheBustFromUrl(url) {
  try {
    const parsed = new URL(url);
    if (!parsed.search || isCacheBustQuery(parsed.search)) {
      parsed.search = '';
      return parsed.href;
    }
    return parsed.href;
  } catch {
    return url;
  }
}

function pathnameHasBuildHash(pathname) {
  const base = pathname.split('/').pop() || '';
  return HASHED_FILENAME_RE.test(base);
}

function shouldIgnoreQueryForLocalPath(pathname, search) {
  if (!search) return true;
  if (pathnameHasBuildHash(pathname)) return true;
  return isCacheBustQuery(search);
}

module.exports = {
  CACHE_BUST_PARAMS,
  isCacheBustQuery,
  stripCacheBustFromUrl,
  pathnameHasBuildHash,
  shouldIgnoreQueryForLocalPath
};
