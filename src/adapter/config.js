/**
 * 站点适配配置加载：
 *   series   → 目标站接口族（可复用）
 *   provider → 我们的后端实现
 *   hosts…  → 本站覆盖；未填则用系列默认
 */
const { getSeries } = require('./series');
const { getProvider } = require('./providers');

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

  return {
    series: seriesId,
    provider: providerId,
    seriesMod: series,
    providerMod: provider,
    hosts,
    apiHostPatterns,
    excludeHosts,
    upstreamOrigin: raw.upstreamOrigin ? String(raw.upstreamOrigin) : '',
    ossOrigin: raw.ossOrigin ? String(raw.ossOrigin) : '',
    providerOptions
  };
}

function loadAdapterHosts(siteDir, fs, path) {
  return loadAdapterConfig(siteDir, fs, path).hosts;
}

module.exports = {
  loadAdapterConfig,
  loadAdapterHosts,
  getSeries,
  getProvider
};
