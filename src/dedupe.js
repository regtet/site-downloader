const crypto = require('crypto');
const path = require('path');

class DedupeManager {
  constructor() {
    this.urlToLocal = new Map();
    this.hashToLocal = new Map();
    this.localToUrls = new Map();
  }

  normalizeUrl(rawUrl, baseUrl) {
    if (!rawUrl || typeof rawUrl !== 'string') return null;
    const trimmed = rawUrl.trim();
    if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) {
      return null;
    }
    try {
      const parsed = new URL(trimmed, baseUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) return null;
      parsed.hash = '';
      return parsed.href;
    } catch {
      return null;
    }
  }

  getLocalPath(url) {
    return this.urlToLocal.get(url) || null;
  }

  getLocalByHash(hash) {
    return this.hashToLocal.get(hash) || null;
  }

  register(url, localPath, hash) {
    this.urlToLocal.set(url, localPath);
    if (hash) {
      if (!this.hashToLocal.has(hash)) {
        this.hashToLocal.set(hash, localPath);
      }
      const urls = this.localToUrls.get(localPath) || [];
      urls.push(url);
      this.localToUrls.set(localPath, urls);
    }
  }

  linkUrlToExisting(url, localPath) {
    this.urlToLocal.set(url, localPath);
    const urls = this.localToUrls.get(localPath) || [];
    urls.push(url);
    this.localToUrls.set(localPath, urls);
  }

  computeHash(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  urlToLocalPath(url, contentType) {
    const parsed = new URL(url);
    let pathname = decodeURIComponent(parsed.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    if (pathname === '/' || pathname === '') pathname = '/index.html';
    if (pathname.startsWith('/')) pathname = pathname.slice(1);

    if (!path.extname(pathname)) {
      const ct = (contentType || '').split(';')[0].trim().toLowerCase();
      const extMap = {
        'text/html': '.html',
        'application/javascript': '.js',
        'text/javascript': '.js',
        'text/css': '.css',
        'application/json': '.json',
        'image/png': '.png',
        'image/jpeg': '.jpg',
        'image/svg+xml': '.svg',
        'font/woff2': '.woff2',
        'font/woff': '.woff'
      };
      const ext = extMap[ct] || '.html';
      pathname = pathname + '/index' + ext;
    }

    if (parsed.search) {
      const queryHash = crypto.createHash('md5').update(parsed.search).digest('hex').slice(0, 8);
      const ext = path.extname(pathname);
      const base = ext ? pathname.slice(0, -ext.length) : pathname;
      pathname = ext ? `${base}.${queryHash}${ext}` : `${base}.${queryHash}`;
    }

    return pathname.replace(/[<>:"|?*]/g, '_');
  }
}

module.exports = DedupeManager;
