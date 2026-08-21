const axios = require('axios');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16, maxFreeSockets: 8 });
const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 16,
  maxFreeSockets: 8,
  // Node 14: 降低并发握手失败概率
  timeout: 30000
});

function isTransientNetworkError(err) {
  if (!err) return false;
  const code = err.code || '';
  const msg = String(err.message || '');
  if ([
    'ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EPIPE', 'ENOTFOUND',
    'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ECONNREFUSED'
  ].includes(code)) return true;
  if (/socket disconnected|TLS|SSL|network|timeout|ECONNRESET|Client network socket/i.test(msg)) return true;
  return false;
}

const STATIC_TYPES = new Set([
  'document',
  'stylesheet',
  'script',
  'image',
  'font',
  'media',
  'manifest',
  'other',
  'texttrack'
]);

function assetPriority(url) {
  const u = String(url || '').toLowerCase();
  if (/\.(js|mjs|cjs)(\?|$)/.test(u)) return 0;
  if (/\.css(\?|$)/.test(u)) return 1;
  if (/\.(woff2?|ttf|otf)(\?|$)/.test(u)) return 2;
  if (/assets\.hash\.json/.test(u)) return 3;
  if (/\.(png|jpe?g|gif|webp|avif|svg|ico)(\?|$)/.test(u)) return 4;
  return 5;
}

function sortByAssetPriority(items) {
  return [...items].sort((a, b) => {
    const ua = typeof a === 'string' ? a : a.url;
    const ub = typeof b === 'string' ? b : b.url;
    return assetPriority(ua) - assetPriority(ub);
  });
}

class Downloader {
  constructor(options = {}) {
    this.timeout = options.timeout || 20000;
    this.maxRetries = options.maxRetries != null ? options.maxRetries : 3;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
    this.client = axios.create({
      timeout: this.timeout,
      maxRedirects: 5,
      responseType: 'arraybuffer',
      httpAgent,
      httpsAgent,
      validateStatus: () => true,
      headers: { 'User-Agent': this.userAgent, Accept: '*/*' }
    });
  }

  shouldDownload(resourceType, url) {
    if (!STATIC_TYPES.has(resourceType)) {
      const ext = path.extname(new URL(url).pathname).toLowerCase();
      const staticExts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.wasm', '.json', '.map'];
      if (resourceType === 'fetch' || resourceType === 'xhr') {
        return staticExts.includes(ext);
      }
      return false;
    }
    return true;
  }

  isStaticResource(resourceType, url, contentType) {
    if (STATIC_TYPES.has(resourceType)) return true;
    if (!url) return false;
    try {
      const ext = path.extname(new URL(url).pathname).toLowerCase();
      const staticExts = ['.js', '.css', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.wasm', '.json', '.map'];
      if (staticExts.includes(ext)) return true;
      if (contentType) {
        const ct = contentType.split(';')[0].trim().toLowerCase();
        if (['text/css', 'application/javascript', 'text/javascript', 'application/json', 'image/', 'font/', 'video/', 'audio/'].some((t) => ct.startsWith(t) || ct.includes(t))) {
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  async download(url, referer, options = {}) {
    const maxRetries = options.maxRetries != null ? options.maxRetries : this.maxRetries;
    const retryStatuses = options.retryStatuses || [429, 502, 503, 504];
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const response = await this.client.get(url, {
          headers: {
            Referer: referer || url,
            'Accept': '*/*',
            'Accept-Encoding': 'gzip, deflate, br'
          },
          timeout: options.timeout || this.timeout
        });
        if (retryStatuses.includes(response.status) && attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 500 * (attempt + 1)));
          continue;
        }
        return {
          url,
          status: response.status,
          headers: response.headers,
          data: Buffer.from(response.data),
          contentType: response.headers['content-type'] || ''
        };
      } catch (err) {
        lastError = err;
        if (attempt < maxRetries && isTransientNetworkError(err)) {
          await new Promise((r) => setTimeout(r, 600 * Math.pow(1.6, attempt)));
          continue;
        }
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
          continue;
        }
      }
    }
    return {
      url,
      status: 0,
      headers: {},
      data: null,
      contentType: '',
      error: lastError ? lastError.message : 'unknown error'
    };
  }

  saveFile(filePath, buffer) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, buffer);
  }
}

module.exports = Downloader;
module.exports.assetPriority = assetPriority;
module.exports.sortByAssetPriority = sortByAssetPriority;
