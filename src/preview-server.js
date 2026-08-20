const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
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
  '.map': 'application/json'
};

class PreviewServer {
  constructor() {
    this.server = null;
    this.port = null;
    this.siteDir = null;
  }

  isRunning() {
    return this.server !== null;
  }

  getInfo() {
    if (!this.isRunning()) return null;
    return {
      port: this.port,
      siteDir: this.siteDir,
      url: `http://localhost:${this.port}`
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
        const server = http.createServer((req, res) => {
          const reqUrl = new URL(req.url, `http://localhost:${port}`);
          let pathname = decodeURIComponent(reqUrl.pathname);
          if (pathname.endsWith('/')) pathname += 'index.html';

          const filePath = path.join(siteDir, pathname);
          if (!filePath.startsWith(siteDir)) {
            res.writeHead(404);
            res.end('404');
            return;
          }

          fs.stat(filePath, (err, stat) => {
            if (err || !stat.isFile()) {
              const indexPath = path.join(siteDir, 'index.html');
              fs.readFile(indexPath, (indexErr, data) => {
                if (indexErr) {
                  res.writeHead(404);
                  res.end('404');
                  return;
                }
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(data);
              });
              return;
            }

            const ext = path.extname(filePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || 'application/octet-stream';
            fs.readFile(filePath, (readErr, data) => {
              if (readErr) {
                res.writeHead(404);
                res.end('404');
                return;
              }
              res.writeHead(200, { 'Content-Type': contentType });
              res.end(data);
            });
          });
        });

        server.on('error', (err) => {
          if (err.code === 'EADDRINUSE' && port < 3556) {
            createAndListen(port + 1);
          } else {
            reject(err);
          }
        });

        server.listen(port, () => {
          this.server = server;
          this.port = port;
          this.siteDir = siteDir;
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

module.exports = PreviewServer;
