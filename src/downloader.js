const axios = require('axios');
const fs = require('fs');
const path = require('path');

const DOWNLOADABLE_TYPES = new Set([
  'document',
  'stylesheet',
  'script',
  'image',
  'font',
  'media',
  'manifest',
  'other',
  'texttrack',
  'xhr',
  'fetch'
]);

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

class Downloader {
  constructor(options = {}) {
    this.timeout = options.timeout || 30000;
    this.maxRetries = options.maxRetries || 2;
    this.userAgent = options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
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
        if (['text/css', 'application/javascript', 'text/javascript', 'application/json', 'image/', 'font/', 'video/', 'audio/'].some(t => ct.startsWith(t) || ct.includes(t))) {
          return true;
        }
      }
    } catch {
      return false;
    }
    return false;
  }

  async download(url, referer) {
    let lastError = null;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: this.timeout,
          maxRedirects: 5,
          headers: {
            'User-Agent': this.userAgent,
            Accept: '*/*',
            Referer: referer || url
          },
          validateStatus: () => true
        });
        return {
          url,
          status: response.status,
          headers: response.headers,
          data: Buffer.from(response.data),
          contentType: response.headers['content-type'] || ''
        };
      } catch (err) {
        lastError = err;
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
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

Downloader.DOWNLOADABLE_TYPES = DOWNLOADABLE_TYPES;
Downloader.STATIC_TYPES = STATIC_TYPES;

module.exports = Downloader;
