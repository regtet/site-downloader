/**
 * API 主机匹配（与系列无关的纯工具）
 * 配置加载见 ./config.js（series + provider）
 */
const {
  loadAdapterConfig,
  loadAdapterHosts
} = require('./config');

function compilePatterns(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (let i = 0; i < list.length; i++) {
    try {
      out.push(new RegExp(String(list[i]), 'i'));
    } catch (_) { /* ignore */ }
  }
  return out;
}

/**
 * @param {string} hostname
 * @param {string[]|{hosts?:string[],apiHostPatterns?:string[],excludeHosts?:string[]}} [hostsOrCfg]
 */
function isAdapterApiHost(hostname, hostsOrCfg) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;

  let hosts = [];
  let patterns = [];
  let exclude = [];
  if (Array.isArray(hostsOrCfg)) {
    hosts = hostsOrCfg;
  } else if (hostsOrCfg && typeof hostsOrCfg === 'object') {
    hosts = Array.isArray(hostsOrCfg.hosts) ? hostsOrCfg.hosts : [];
    patterns = Array.isArray(hostsOrCfg.apiHostPatterns) ? hostsOrCfg.apiHostPatterns : [];
    exclude = Array.isArray(hostsOrCfg.excludeHosts) ? hostsOrCfg.excludeHosts : [];
  }

  for (let i = 0; i < exclude.length; i++) {
    if (String(exclude[i]).toLowerCase() === h) return false;
  }
  for (let i = 0; i < hosts.length; i++) {
    if (String(hosts[i]).toLowerCase() === h) return true;
  }
  const regs = compilePatterns(patterns);
  for (let i = 0; i < regs.length; i++) {
    if (regs[i].test(h)) return true;
  }
  return false;
}

/** boot 里注入明文用：认证类 path（系列无关的宽松匹配） */
function isAuthApiPath(pathname) {
  const p = String(pathname || '');
  return /\/(?:hall\/)?api\/member\/(?:login|agent\/login|register|fastRegister|check\/register|v2\/fastLogin|getFastLogin|thirdPartyLogin)(?:\/|$)/.test(p);
}

function isHallApiPath(pathname) {
  const p = String(pathname || '');
  return p.startsWith('/hall/api/') || p.startsWith('/api/member/') || p.startsWith('/api/');
}

function isOssAssetPath(pathname) {
  const p = String(pathname || '');
  if (
    p.startsWith('/siteadmin/')
    || p.startsWith('/lobby_asset/')
    || p.startsWith('/game_pictures/')
    || p.startsWith('/hall/api/game/')
    || p.includes('/upload/')
  ) {
    return true;
  }
  // OSS/CDN 常见静态后缀（本地已下载的镜像资源）
  return /\.(?:png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|mp3|m4a|woff2?|ttf|otf)(?:$|\?)/i.test(p);
}

module.exports = {
  loadAdapterConfig,
  loadAdapterHosts,
  isAdapterApiHost,
  isAuthApiPath,
  isHallApiPath,
  isOssAssetPath
};
