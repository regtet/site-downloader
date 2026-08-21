const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { shouldIgnoreQueryForLocalPath } = require('./url-query');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.cjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4'
};

/** 这些扩展名缺失时绝不能回退 HTML，否则 type=module 会报 MIME text/html */
const STATIC_ASSET_EXTS = new Set([
  '.js', '.mjs', '.cjs', '.css', '.map', '.json', '.wasm',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg', '.ico',
  '.woff', '.woff2', '.ttf', '.otf', '.mp4', '.webm', '.mp3', '.m4a',
  '.txt', '.xml', '.lottie'
]);

function isStaticAssetPath(pathname) {
  const ext = path.extname(String(pathname || '').split('?')[0]).toLowerCase();
  return STATIC_ASSET_EXTS.has(ext);
}

function isPathInside(rootDir, targetPath) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  if (target === root) return true;
  const prefix = root.endsWith(path.sep) ? root : root + path.sep;
  return target.startsWith(prefix);
}

function resolveFilePath(siteDir, reqUrl) {
  const parsed = new URL(reqUrl, 'http://local.invalid/');
  let pathname = decodeURIComponent(parsed.pathname);
  if (pathname.endsWith('/')) pathname += 'index.html';

  // Windows: 去掉前导 /，避免个别环境下 join 行为异常
  const relative = pathname.replace(/^\/+/, '');
  const candidates = [relative];
  if (parsed.search && shouldIgnoreQueryForLocalPath(pathname, parsed.search)) {
    candidates.unshift(relative);
  }

  const root = path.resolve(siteDir);
  for (const candidate of candidates) {
    const filePath = path.resolve(root, candidate);
    if (!isPathInside(root, filePath)) continue;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return filePath;
    }
  }
  return null;
}

function createStaticServer(siteDir, options = {}) {
  const spaFallback = options.spaFallback === true;
  const host = options.host || '127.0.0.1';
  const root = path.resolve(siteDir);

  return http.createServer((req, res) => {
    const reqUrl = new URL(req.url || '/', `http://${host}:${options.port || 0}`);
    const filePath = resolveFilePath(root, req.url || '/');

    if (!filePath) {
      // 静态资源缺失 → 必须 404，禁止回退 index.html（否则 module 脚本 MIME 变成 text/html）
      if (spaFallback && !isStaticAssetPath(reqUrl.pathname)) {
        const indexPath = path.join(root, 'index.html');
        if (fs.existsSync(indexPath)) {
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-cache'
          });
          res.end(fs.readFileSync(indexPath));
          return;
        }
      }
      res.writeHead(404, {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-Missing-Asset': isStaticAssetPath(reqUrl.pathname) ? '1' : '0'
      });
      res.end('404 ' + reqUrl.pathname);
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404');
        return;
      }
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff'
      });
      res.end(data);
    });
  });
}

class StaticServer {
  constructor(options = {}) {
    this.server = null;
    this.port = null;
    this.siteDir = null;
    this.spaFallback = options.spaFallback === true;
    this.host = options.host || '127.0.0.1';
  }

  isRunning() {
    return this.server !== null;
  }

  getInfo() {
    if (!this.isRunning()) return null;
    return {
      port: this.port,
      siteDir: this.siteDir,
      url: `http://${this.host}:${this.port}`
    };
  }

  stop() {
    return new Promise((resolve) => {
      if (!this.server) {
        resolve(false);
        return;
      }
      this.server.close(() => {
        this.server = null;
        this.port = null;
        this.siteDir = null;
        resolve(true);
      });
    });
  }

  start(siteDir, preferredPort) {
    return new Promise((resolve, reject) => {
      if (!fs.existsSync(siteDir)) {
        reject(new Error('目录不存在'));
        return;
      }

      const tryPort = preferredPort || 3456;

      const createAndListen = (port) => {
        const server = createStaticServer(siteDir, {
          port,
          host: this.host,
          spaFallback: this.spaFallback
        });

        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE' && port < 3556) {
            createAndListen(port + 1);
          } else {
            reject(err);
          }
        });

        server.listen(port, this.host, () => {
          this.server = server;
          this.port = port;
          this.siteDir = path.resolve(siteDir);
          resolve(this.getInfo());
        });
      };

      if (this.server) {
        this.stop().then(() => createAndListen(tryPort)).catch(reject);
      } else {
        createAndListen(tryPort);
      }
    });
  }
}

function startEphemeralServer(siteDir, port = 3460) {
  return new Promise((resolve, reject) => {
    const server = createStaticServer(siteDir, { port, host: '127.0.0.1', spaFallback: false });
    server.on('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, port }));
  });
}

module.exports = {
  StaticServer,
  createStaticServer,
  startEphemeralServer,
  MIME_TYPES,
  isStaticAssetPath,
  resolveFilePath
};
