/**
 * 预览回源按系列区分：先看 adapter-hosts.json 的 series，再按 network.json 特征识别，默认 aniw-lobby。
 * 各系列的回源规则见 series/<id>/preview.js
 */
const fs = require('fs');
const path = require('path');
const { SERIES } = require('./index');

const DEFAULT_SERIES_ID = 'aniw-lobby';
const DETECT_ORDER = ['hms-platform', 'boi', 'aniw-lobby'];

function readJson(file) {
  try {
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function readText(file) {
  try {
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  } catch (_) {
    return '';
  }
}

/** 系列无关的抓包索引：主机集合、各 API origin 出现次数、API path → origin、同源 API path */
function buildSeriesContext(siteDir, sourceOrigin) {
  const raw = readJson(path.join(siteDir, 'network.json'));
  const entries = Array.isArray(raw) ? raw : ((raw && (raw.entries || raw.network)) || []);
  const hosts = new Set();
  const apiOrigins = new Map();
  const pathOrigin = Object.create(null);
  const sourceApiPaths = new Set();
  let source = '';
  try { source = sourceOrigin ? new URL(sourceOrigin).origin : ''; } catch (_) { /* ignore */ }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i] || {};
    let u;
    try {
      u = new URL(String(e.url || ''));
    } catch (_) {
      continue;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
    hosts.add(u.hostname.toLowerCase());
    const p = u.pathname || '';
    if (p.indexOf('/api/') !== 0 && p.indexOf('/hall/api/') !== 0) continue;
    if (u.origin === source) {
      sourceApiPaths.add(p);
      continue;
    }
    apiOrigins.set(u.origin, (apiOrigins.get(u.origin) || 0) + 1);
    if (!pathOrigin[p]) pathOrigin[p] = u.origin;
  }

  return {
    siteDir,
    sourceOrigin: source,
    entries,
    hosts,
    apiOrigins,
    pathOrigin,
    sourceApiPaths,
    html: readText(path.join(siteDir, 'index.html')),
    configJs: readText(path.join(siteDir, 'config.js'))
  };
}

function explicitSeriesId(siteDir) {
  const raw = readJson(path.join(siteDir, 'adapter-hosts.json'));
  if (raw && !Array.isArray(raw) && typeof raw === 'object' && raw.series) {
    return String(raw.series);
  }
  return '';
}

/**
 * @returns {{ id: string, series: object, preview: object, ctx: object, reason: string }}
 */
function detectSeries(siteDir, options = {}) {
  const ctx = buildSeriesContext(siteDir, options.sourceOrigin || '');
  const pack = (id, reason) => {
    const series = SERIES[id];
    return { id, series, preview: (series && series.preview) || {}, ctx, reason };
  };

  const explicit = explicitSeriesId(siteDir);
  if (explicit && SERIES[explicit]) return pack(explicit, 'adapter-hosts');

  for (let i = 0; i < DETECT_ORDER.length; i++) {
    const id = DETECT_ORDER[i];
    const preview = SERIES[id] && SERIES[id].preview;
    try {
      if (preview && typeof preview.detect === 'function' && preview.detect(ctx)) {
        return pack(id, 'network');
      }
    } catch (_) { /* ignore */ }
  }
  return pack(DEFAULT_SERIES_ID, 'default');
}

module.exports = {
  buildSeriesContext,
  detectSeries
};
