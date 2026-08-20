const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3456;
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

function resolveSiteDir(args) {
  if (args[0]) {
    return path.resolve(args[0]);
  }
  const outputRoot = path.join(__dirname, 'output');
  if (!fs.existsSync(outputRoot)) {
    return null;
  }
  const dirs = fs.readdirSync(outputRoot, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => path.join(outputRoot, d.name));
  if (dirs.length === 0) return null;
  dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0];
}

function send404(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 Not Found');
}

function createServer(siteDir) {
  return http.createServer((req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${PORT}`);
    let pathname = decodeURIComponent(reqUrl.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';

    const filePath = path.join(siteDir, pathname);

    if (!filePath.startsWith(siteDir)) {
      send404(res);
      return;
    }

    fs.stat(filePath, (err, stat) => {
      if (err || !stat.isFile()) {
        const indexPath = path.join(siteDir, 'index.html');
        fs.readFile(indexPath, (indexErr, data) => {
          if (indexErr) {
            send404(res);
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
          send404(res);
          return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      });
    });
  });
}

const siteDir = resolveSiteDir(process.argv.slice(2));

if (!siteDir || !fs.existsSync(siteDir)) {
  console.error('用法: npm run serve -- [output/example.com]');
  console.error('未找到可服务的目录');
  process.exit(1);
}

const server = createServer(siteDir);
server.listen(PORT, () => {
  console.log(`本地服务已启动`);
  console.log(`目录: ${siteDir}`);
  console.log(`地址: http://localhost:${PORT}`);
});
