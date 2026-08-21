/**
 * 679win 等站点：API 子域 → 本地适配层
 * 主站 679win.com 仍走静态/回源，不整站改写。
 */

const DEFAULT_ADAPTER_HOSTS = [
  'oniw976.679win.cc',
  'aniw976.679win.cc',
  'aniw976.679win.me',
  'aniw976.679win.co'
];

const DEFAULT_UPSTREAM_ORIGIN = 'https://aniw976.679win.cc';
const DEFAULT_OSS_ORIGIN = 'https://oniw976.679win.cc';

/** 子域后缀：命中则视为 API 主机（排除裸主域） */
const API_HOST_SUFFIX_RE = /\.679win\.(cc|me|co|net)$/i;

function isBareSiteHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  return h === '679win.com' || h === 'www.679win.com';
}

/**
 * @param {string} hostname
 * @param {string[]} [extraHosts]
 */
function isAdapterApiHost(hostname, extraHosts) {
  const h = String(hostname || '').toLowerCase();
  if (!h || isBareSiteHost(h)) return false;
  if (Array.isArray(extraHosts)) {
    for (let i = 0; i < extraHosts.length; i++) {
      if (String(extraHosts[i]).toLowerCase() === h) return true;
    }
  }
  if (API_HOST_SUFFIX_RE.test(h)) return true;
  if (/^(oniw|aniw)\d*\./i.test(h)) return true;
  return false;
}

function loadAdapterConfig(siteDir, fs, path) {
  let fromFile = [];
  let upstreamOrigin = '';
  let ossOrigin = '';
  try {
    const p = path.join(siteDir, 'adapter-hosts.json');
    if (fs.existsSync(p)) {
      const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(raw)) fromFile = raw.map(String);
      else if (raw && typeof raw === 'object') {
        if (Array.isArray(raw.hosts)) fromFile = raw.hosts.map(String);
        if (raw.upstreamOrigin) upstreamOrigin = String(raw.upstreamOrigin);
        if (raw.ossOrigin) ossOrigin = String(raw.ossOrigin);
      }
    }
  } catch (_) { /* ignore */ }

  let hosts = fromFile;
  try {
    const name = path.basename(siteDir).toLowerCase();
    if (name.includes('679win')) {
      hosts = [...new Set(DEFAULT_ADAPTER_HOSTS.concat(fromFile))];
      if (!upstreamOrigin) upstreamOrigin = DEFAULT_UPSTREAM_ORIGIN;
      if (!ossOrigin) ossOrigin = DEFAULT_OSS_ORIGIN;
    }
  } catch (_) { /* ignore */ }

  return { hosts, upstreamOrigin, ossOrigin };
}

function loadAdapterHosts(siteDir, fs, path) {
  return loadAdapterConfig(siteDir, fs, path).hosts;
}

/**
 * 登录/注册等需本地适配的 path（含 /hall 前缀）
 */
function isAuthApiPath(pathname) {
  const p = String(pathname || '');
  return /\/(?:hall\/)?api\/member\/(?:login|agent\/login|register|fastRegister|check\/register|v2\/fastLogin|getFastLogin|thirdPartyLogin)(?:\/|$)/.test(p);
}

/** 本地短路径是否属于应回 API 上游的 hall/api */
function isHallApiPath(pathname) {
  const p = String(pathname || '');
  return p.startsWith('/hall/api/') || p.startsWith('/api/member/') || p.startsWith('/api/');
}

/** OSS / 设计资源（曾被误改到本地短 path） */
function isOssAssetPath(pathname) {
  const p = String(pathname || '');
  return (
    p.startsWith('/siteadmin/')
    || p.startsWith('/lobby_asset/')
    || p.startsWith('/hall/api/game/')
    || p.includes('/upload/')
  );
}

module.exports = {
  DEFAULT_ADAPTER_HOSTS,
  DEFAULT_UPSTREAM_ORIGIN,
  DEFAULT_OSS_ORIGIN,
  loadAdapterConfig,
  loadAdapterHosts,
  isAdapterApiHost,
  isAuthApiPath,
  isHallApiPath,
  isOssAssetPath,
  isBareSiteHost
};
