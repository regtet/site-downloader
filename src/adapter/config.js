/**
 * 站点适配配置加载：
 *   series   → 目标站接口族（可复用）
 *   provider → 我们的后端实现
 *   hosts…  → 本站覆盖；未填则用系列默认
 */
const { getSeries } = require('./series');
const { getProvider } = require('./providers');

/**
 * 从抓包 network.json 推断：
 * - upstreamOrigin: aniw* 上的 POST /hall/api（真正业务 API）
 * - ossOrigin: oniw* 静态/JSON 对象存储（只允许 GET，POST 会 405 MethodNotAllowed）
 */
function inferOriginsFromNetwork(siteDir, fs, path) {
  const empty = { upstreamOrigin: '', ossOrigin: '' };
  try {
    const networkPath = path.join(siteDir, 'network.json');
    if (!fs.existsSync(networkPath)) return empty;
    const raw = JSON.parse(fs.readFileSync(networkPath, 'utf8'));
    const entries = Array.isArray(raw) ? raw : (raw.entries || raw.network || []);
    const apiPost = Object.create(null);
    const ossGet = Object.create(null);

    for (let i = 0; i < entries.length; i++) {
      const e = entries[i] || {};
      let u;
      try {
        u = new URL(String(e.url || ''));
      } catch (_) {
        continue;
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
      const host = u.hostname.toLowerCase();
      const method = String(e.method || 'GET').toUpperCase();
      const p = u.pathname || '';
      const origin = u.origin;
      const isHallApi = p.indexOf('/hall/api/') === 0 || p.indexOf('/api/') === 0;
      const isOniw = /^oniw\d*\./i.test(host);
      const isAniw = /^aniw\d*\./i.test(host);

      if (isHallApi && method !== 'GET' && method !== 'HEAD') {
        apiPost[origin] = (apiPost[origin] || 0) + 10;
      } else if (isHallApi && isAniw) {
        apiPost[origin] = (apiPost[origin] || 0) + 2;
      } else if (isAniw && (p.indexOf('/hall/') === 0 || p.indexOf('/api/') === 0)) {
        apiPost[origin] = (apiPost[origin] || 0) + 1;
      }

      if (isOniw) {
        ossGet[origin] = (ossGet[origin] || 0) + 1;
      }
    }

    const pickBest = (map) => {
      let best = '';
      let score = 0;
      for (const k of Object.keys(map)) {
        if (map[k] > score) {
          score = map[k];
          best = k;
        }
      }
      return best;
    };

    return {
      upstreamOrigin: pickBest(apiPost),
      ossOrigin: pickBest(ossGet)
    };
  } catch (_) {
    return empty;
  }
}

/**
 * 从 index.html 内联 LOBBY_SITE_CONFIG 提取官方 siteCode（如 "12025"）。
 * 这是站点自带配置，不是伪造业务数据。
 */
function inferSiteCodeFromSite(siteDir, fs, path) {
  try {
    const htmlPath = path.join(siteDir, 'index.html');
    if (!fs.existsSync(htmlPath)) return '';
    const html = fs.readFileSync(htmlPath, 'utf8');
    const m = html.match(/siteCode\s*:\s*["'](\d+)["']/);
    return m ? String(m[1]) : '';
  } catch (_) {
    return '';
  }
}

/** 若 query 缺 siteCode，则追加官方 siteCode（浏览器正式请求本就会带） */
function ensureSiteCodeQuery(search, siteCode) {
  const code = siteCode != null ? String(siteCode).trim() : '';
  if (!code) return search || '';
  const raw = search == null ? '' : String(search);
  const body = raw.charAt(0) === '?' ? raw.slice(1) : raw;
  if (/(?:^|&)siteCode=/i.test(body)) return raw.charAt(0) === '?' ? raw : (raw ? '?' + raw : '');
  const next = body ? body + '&siteCode=' + encodeURIComponent(code) : 'siteCode=' + encodeURIComponent(code);
  return '?' + next;
}

function loadAdapterConfig(siteDir, fs, path) {
  let raw = {};
  try {
    const p = path.join(siteDir, 'adapter-hosts.json');
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(parsed)) raw = { hosts: parsed };
      else if (parsed && typeof parsed === 'object') raw = parsed;
    }
  } catch (_) { /* ignore */ }

  const seriesId = String(raw.series || 'aniw-lobby');
  const providerId = String(raw.provider || (raw.wgame ? 'wgame' : 'wgame'));
  const series = getSeries(seriesId);
  const provider = getProvider(providerId);
  const seriesHost = (series && series.DEFAULT_HOST) || {};

  const hosts = Array.isArray(raw.hosts) ? raw.hosts.map(String) : [];
  const apiHostPatterns = Array.isArray(raw.apiHostPatterns)
    ? raw.apiHostPatterns.map(String)
    : (seriesHost.apiHostPatterns || []).slice();
  const excludeHosts = Array.isArray(raw.excludeHosts)
    ? raw.excludeHosts.map(String)
    : (seriesHost.excludeHosts || []).slice();

  // 兼容旧字段 wgame → providerOptions
  const providerOptions = Object.assign(
    {},
    (raw.wgame && typeof raw.wgame === 'object') ? raw.wgame : {},
    (raw.providerOptions && typeof raw.providerOptions === 'object') ? raw.providerOptions : {}
  );

  const inferred = inferOriginsFromNetwork(siteDir, fs, path);
  const siteCode = raw.siteCode
    ? String(raw.siteCode)
    : inferSiteCodeFromSite(siteDir, fs, path);

  return {
    series: seriesId,
    provider: providerId,
    seriesMod: series,
    providerMod: provider,
    hosts,
    apiHostPatterns,
    excludeHosts,
    upstreamOrigin: raw.upstreamOrigin ? String(raw.upstreamOrigin) : (inferred.upstreamOrigin || ''),
    ossOrigin: raw.ossOrigin ? String(raw.ossOrigin) : (inferred.ossOrigin || ''),
    siteCode,
    providerOptions
  };
}

function loadAdapterHosts(siteDir, fs, path) {
  return loadAdapterConfig(siteDir, fs, path).hosts;
}

/** 是否已执行第二步「替换接口」（部署包内才有 adapter-hosts.json） */
function hasAdapterPack(siteDir, fs, path) {
  try {
    return fs.existsSync(path.join(siteDir, 'adapter-hosts.json'));
  } catch (_) {
    return false;
  }
}

module.exports = {
  loadAdapterConfig,
  loadAdapterHosts,
  hasAdapterPack,
  inferOriginsFromNetwork,
  inferSiteCodeFromSite,
  ensureSiteCodeQuery,
  getSeries,
  getProvider
};
