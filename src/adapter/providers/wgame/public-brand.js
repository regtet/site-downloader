/**
 * 公开 JSON 里的官方站名、页脚文案和代理等级表换成我们自己的。
 * 皮肤色值、币种和图标仍用 dist 结构。站名取 wgame_web 的分享域名。
 */
const { loadWgameWebConfig } = require('./wgame-web-config');

const BRAND = /719win|777clube/i;

function ownSiteLabel() {
  try {
    const live = loadWgameWebConfig();
    const list = live && live.proxyShareUrlList;
    if (!Array.isArray(list)) return '';
    for (const item of list) {
      const text = String(item || '').trim();
      if (!text) continue;
      try {
        const host = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text).host;
        if (host) return host;
      } catch (_) { /* 跳过无法解析的地址 */ }
    }
  } catch (_) { /* 没有实时配置就清掉官方站名 */ }
  return '';
}

function routeBase(pathname) {
  let p = String(pathname || '').split('?')[0];
  if (p.startsWith('/hall/')) p = p.slice('/hall'.length);
  p = p.replace(/\.json$/i, '');
  const cut = p.search(/\/(currency|language|osType|platformType|siteCode|agentId|page|type|xdevice|queryRateType)\//);
  return cut > 0 ? p.slice(0, cut) : p;
}

function ownShareHosts() {
  try {
    const live = loadWgameWebConfig();
    const list = live && live.proxyShareUrlList;
    if (!Array.isArray(list)) return [];
    const hosts = [];
    for (const item of list) {
      const text = String(item || '').trim();
      if (!text) continue;
      try {
        const host = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text).host;
        if (host && hosts.indexOf(host) < 0) hosts.push(host);
      } catch (_) { /* 跳过无法解析的地址 */ }
    }
    return hosts;
  } catch (_) {
    return [];
  }
}

function ownApk() {
  try {
    const live = loadWgameWebConfig();
    const apk = String(live && live.appDownPath || '').trim();
    return /^https?:\/\//i.test(apk) ? apk : '';
  } catch (_) {
    return '';
  }
}

function applyOptimization(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const label = ownSiteLabel();
  const apk = ownApk();
  const logo = data.brandLogoUse;
  if (logo && typeof logo === 'object') {
    logo.brandName = label;
    logo.appBrandName = label;
    logo.loginSlogan = '';
    logo.bootInstallationSwitch = 0;
    logo.hallOfficialCommunitys = [];
    if (logo.topDownloadText && typeof logo.topDownloadText === 'object') {
      logo.topDownloadText.installationHintLanguage = [];
    }
    if (logo.androidBootInstallation && typeof logo.androidBootInstallation === 'object') {
      logo.androidBootInstallation.installationHintLanguage = [];
    }
    if (logo.findUs && typeof logo.findUs === 'object') {
      logo.findUs.backDomain = '';
      logo.findUs.backEmail = '';
      logo.findUs.downDomain = '';
      logo.findUs.topText = '';
    }
  }
  const channel = data.channelGlobalConfig;
  if (channel && typeof channel === 'object') {
    channel.appNameLanguage = label ? [{ key: 'pt', value: label }] : [];
    channel.customer_service_url = [''];
    channel.android_download_url = apk ? [apk, ''] : ['', ''];
    channel.androidList = apk ? [{ downloadPath: apk, size: 0, type: 1, version: '' }] : [];
    channel.downloadList = apk ? [
      { language: 'pt', name: '', signType: 1, type: 1, value: apk },
      { language: 'pt', name: '', signType: 1, type: 2, value: apk }
    ] : [];
  }
}

function applySystemStatus(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  data.messageBannerIndex = [];
  const yuebao = data.yuebaoGetSetting;
  if (yuebao && typeof yuebao === 'object') {
    yuebao.ruleText = '';
    yuebao.isPop = 0;
  }
  const home = data.homeGetSysInfo;
  if (!home || typeof home !== 'object') return;
  const kyc = home.kyc;
  if (kyc && typeof kyc === 'object') {
    kyc.legalUserEkycTips = '';
    kyc.legalUserFreezeTips = '';
    kyc.legalUserWithdrawTips = '';
  }
  if (home.facebook && typeof home.facebook === 'object') home.facebook.status = 0;
  if (home.google && typeof home.google === 'object') home.google.status = 0;
  if (home.telegram && typeof home.telegram === 'object') home.telegram.status = 0;
}

function applyForceUpdate(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  data.androidPkgForceUpdate = 0;
  data.androidWebSpeedPkgForceUpdate = 0;
  data.iosPkgForceUpdate = 0;
  data.iosWebSpeedPkgForceUpdate = 0;
  data.androidPkgVersion = '';
  data.androidWebSpeedPkgVersion = '';
  data.iosPkgVersion = '';
  data.iosWebSpeedPkgVersion = '';
}

function ownShareOrigin() {
  try {
    const live = loadWgameWebConfig();
    const list = live && live.proxyShareUrlList;
    if (!Array.isArray(list)) return '';
    for (const item of list) {
      const text = String(item || '').trim();
      if (!text) continue;
      try {
        const url = new URL(/^https?:\/\//i.test(text) ? text : 'https://' + text);
        if (url.origin && url.origin !== 'null') return url.origin;
      } catch (_) { /* 跳过无法解析的地址 */ }
    }
  } catch (_) { /* 没有实时配置就去掉官方链接 */ }
  return '';
}

function swapBrand(value) {
  if (typeof value === 'string') {
    const label = ownSiteLabel();
    const origin = ownShareOrigin();
    return value
      .replace(/https?:\/\/[^\s"'<>]*?(?:719win|777clube)[^\s"'<>]*/gi, origin)
      .replace(/719win|777clube/gi, label);
  }
  if (Array.isArray(value)) return value.map(swapBrand);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = swapBrand(value[key]);
    return out;
  }
  return value;
}

function blankBrand(value) {
  if (typeof value === 'string') return BRAND.test(value) ? '' : value;
  if (Array.isArray(value)) return value.map(blankBrand);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = blankBrand(value[key]);
    return out;
  }
  return value;
}

function dropOfficialCampaigns(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return data;
  if (!Array.isArray(data.activeList)) return data;
  // 卡片点击只会打开活动详情，没有去代理页或 VIP 页的字段。这两张会单独承诺奖金，所以去掉。
  data.activeList = [];
  return data;
}

function rewriteHtmlShell(html) {
  const label = ownSiteLabel();
  if (!label) return String(html || '');
  let out = String(html || '');
  out = out.split('719win – Top Online Slot Games').join(label);
  out = out.split('719win - Top Online Slot Games').join(label);
  out = out.replace(/siteName:"719win"/g, 'siteName:"' + label + '"');
  out = out.replace(/loginSlogan:'[^']*'/g, "loginSlogan:''");
  out = out.replace(/(<meta name="description" content=")[^"]*(")/g, '$1$2');
  out = out.replace(/(<meta name="twitter:description" content=")[^"]*(")/g, '$1$2');
  out = out.replace(/(<meta property="og:description" content=")[^"]*(")/g, '$1$2');
  out = out.replace(/(<meta name="keywords" content=")[^"]*(")/g, '$1$2');
  return out;
}

function rewritePublicPayload(pathname, raw) {
  const base = routeBase(pathname);
  if (/^\/api\/active\/(categoryV2|category|get|getByTemplate)(\/|$)/.test(base)) {
    try {
      const json = JSON.parse(String(raw || ''));
      if (!json || json.data == null) return String(raw || '');
      json.data = swapBrand(json.data);
      if (/^\/api\/active\/(categoryV2|category)$/.test(base)) dropOfficialCampaigns(json.data);
      if (/^\/api\/active\/get(\/|$)/.test(base) && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
        const content = json.data.content;
        if (typeof content === 'string' && content.charAt(0) !== '/' && /R\$|dep[oó]sito/i.test(content)) {
          json.data.content = json.data.name || '';
        }
      }
      return JSON.stringify(json);
    } catch (_) {
      return String(raw || '');
    }
  }
  const siteInfo = base === '/api/lobby/site/getSiteInfo';
  const footer = base === '/api/lobby/footerConfigV2/getInfo';
  const promote = base === '/api/agent/promote/config/index';
  const publicity = base === '/api/lobby/publicityInfo/list';
  const guarantee = base === '/api/lobby/finance/getSiteGuaranteeRule';
  const h5 = base === '/api/lobby/webapi/h5/config/getInfo';
  const optimization = base === '/api/lobby/webapi/optimizationV2/site/config';
  const forceUpdate = base === '/api/lobby/webapi/forceUpdate/getForceUpdate';
  const systemStatus = base === '/api/backstage/system/status';
  const share = base === '/api/agent/promote/config/share';
  const childSite = base === '/api/lobby/site/getChildSite';
  const parentDomain = base === '/api/domain/lobby/club/parentDomain';
  const scrub = siteInfo || footer || promote || publicity || guarantee || h5 || optimization || forceUpdate || systemStatus || share || childSite || parentDomain
    || base === '/api/agent/promote/config/tutorial'
    || base === '/api/agent/promote/config/advertise'
    || base === '/api/agent/promote/config/publicConfig'
    || base === '/api/lobby/aboutUs/index/getInfo'
    || base === '/api/lobby/userAgreement/index/getInfo';
  if (!scrub) return String(raw == null ? '' : raw);
  try {
    const json = JSON.parse(String(raw || ''));
    if (!json || json.data == null) return String(raw || '');
    json.data = blankBrand(json.data);
    if (siteInfo && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      const label = ownSiteLabel();
      json.data.siteName = label;
      json.data.title = label;
      json.data.description = '';
      json.data.keyword = '';
    }
    if (h5 && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      const label = ownSiteLabel();
      json.data.siteName = label;
      json.data.title = label;
      json.data.description = '';
      json.data.keyword = '';
      let langs = {};
      try { langs = JSON.parse(json.data.languages || '{}'); } catch (_) { langs = {}; }
      if (!langs.pt || typeof langs.pt !== 'object') langs.pt = {};
      for (const key of Object.keys(langs)) {
        if (!langs[key] || typeof langs[key] !== 'object') continue;
        langs[key].title = label;
        langs[key].description = '';
        langs[key].keyword = '';
      }
      json.data.languages = JSON.stringify(langs);
    }
    if (promote && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      json.data.agent_levels = [];
      json.data.save_img_url = '';
      json.data.share_img_url = '';
    }
    if (base === '/api/agent/promote/config/advertise' && json.data && typeof json.data === 'object') {
      json.data.advertise = '';
    }
    if (base === '/api/lobby/userAgreement/index/getInfo' && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      json.data.content = '';
    }
    if (publicity) json.data = [];
    if (optimization) applyOptimization(json.data);
    if (forceUpdate) applyForceUpdate(json.data);
    if (systemStatus) applySystemStatus(json.data);
    if (childSite && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      const label = ownSiteLabel();
      for (const key of Object.keys(json.data)) {
        if (typeof json.data[key] === 'string') json.data[key] = label;
      }
    }
    if (parentDomain && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      json.data.parentDomain = ownShareHosts();
    }
    if (share && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      json.data.slogan = '';
      json.data.title = '';
      json.data.promoteIndexBarrageSwitch = '0';
      json.data.promoteShareAdvertiseSwitch = '0';
    }
    if (guarantee && json.data && typeof json.data === 'object' && !Array.isArray(json.data)) {
      json.data.content = '';
      json.data.claimSwitch = 0;
      json.data.guaranteeAmount = '0';
      json.data.showTextSwitch = 0;
    }
    return JSON.stringify(json);
  } catch (_) {
    return String(raw || '');
  }
}

module.exports = {
  rewritePublicPayload,
  rewriteHtmlShell,
  dropOfficialCampaigns,
  ownSiteLabel
};
