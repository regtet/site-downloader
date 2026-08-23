/**
 * /api/platform/* —— 从 index.html 内联站点元数据合成，避免回源官方
 */
const fs = require('fs');
const path = require('path');
const { inferSiteCodeFromSite } = require('../../config');

function readJsonSafe(p) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { /* ignore */ }
  return null;
}

function readSiteMeta(siteDir, adapterCfg) {
  const cfg = adapterCfg && typeof adapterCfg === 'object' ? adapterCfg : {};
  const meta = {
    siteCode: cfg.siteCode ? String(cfg.siteCode) : '',
    siteName: '',
    currency: 'BRL',
    language: 'pt',
    timeZone: 'UTC -03:00'
  };
  if (siteDir) {
    const fromHtml = inferSiteCodeFromSite(siteDir, fs, path);
    if (fromHtml) meta.siteCode = fromHtml;
    try {
      const html = fs.readFileSync(path.join(siteDir, 'index.html'), 'utf8');
      const pick = (key, fallback) => {
        const m = html.match(new RegExp(key + '\\s*:\\s*["\']([^"\']*)["\']'));
        return m && m[1] ? m[1] : fallback;
      };
      meta.siteName = pick('siteName', meta.siteName);
      meta.currency = pick('currency', meta.currency) || meta.currency;
      meta.language = pick('language', meta.language) || meta.language;
      meta.timeZone = pick('timeZone', meta.timeZone) || meta.timeZone;
      const siteinfos = html.match(/name="siteinfos"\s+content="([^"]+)"/);
      if (siteinfos) {
        try {
          const j = JSON.parse(
            siteinfos[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&')
          );
          if (j && j.ossBaseUrl) meta.ossBaseUrl = j.ossBaseUrl;
        } catch (_) { /* ignore */ }
      }
    } catch (_) { /* ignore */ }
  }
  if (!meta.siteCode) meta.siteCode = '12025';
  if (!meta.siteName) meta.siteName = '679win';
  return meta;
}

function buildPlatformLang(siteDir, adapterCfg) {
  const meta = readSiteMeta(siteDir, adapterCfg);
  const code = meta.language || 'pt';
  return {
    defaultLanguage: code,
    language: code,
    list: [
      {
        languageCode: code,
        language: code,
        languageName: code === 'pt' ? 'Português' : code,
        languageFlag: code,
        status: 1
      }
    ]
  };
}

function buildPlatformSite(siteDir, adapterCfg) {
  const meta = readSiteMeta(siteDir, adapterCfg);
  return {
    siteCode: meta.siteCode,
    siteName: meta.siteName,
    currency: meta.currency,
    language: meta.language,
    timeZone: meta.timeZone,
    status: 0
  };
}

function buildPlatformConfig(siteDir, adapterCfg) {
  const meta = readSiteMeta(siteDir, adapterCfg);
  return {
    siteCode: meta.siteCode,
    siteName: meta.siteName,
    currency: meta.currency,
    language: meta.language,
    timeZone: meta.timeZone,
    maintenance: 0,
    registerEnabled: 1,
    loginEnabled: 1,
    ossBaseUrl: meta.ossBaseUrl || ''
  };
}

function buildPlatformResponse(routePath, siteDir, adapterCfg) {
  const p = String(routePath || '');
  if (p === '/api/platform/lang') return buildPlatformLang(siteDir, adapterCfg);
  if (p === '/api/platform/site') return buildPlatformSite(siteDir, adapterCfg);
  if (p === '/api/platform/config') return buildPlatformConfig(siteDir, adapterCfg);
  return {};
}

module.exports = {
  readSiteMeta,
  buildPlatformLang,
  buildPlatformSite,
  buildPlatformConfig,
  buildPlatformResponse
};
