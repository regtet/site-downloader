const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { shouldIgnoreQueryForLocalPath } = require('./url-query');
const {
  resolveSourceOrigin,
  injectBootIntoHtml,
  tryHandleProxy,
  tryFallbackMissingAsset,
  isLikelySameOriginApiPath,
  isFetchLikeRequest
} = require('./preview-proxy');
const { tryHandleAdapter } = require('./adapter');
const { loadAdapterConfig, isHallApiPath, isOssAssetPath } = require('./adapter/hosts');
const { getProvider } = require('./adapter/providers');

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

/** 本地 wgame 登录会话不能原样带给真实 HTTP 上游，否则会 TOKEN_EXPIRED(-1) */
function shouldStripAuth(req, adapterCfg) {
  try {
    if (adapterCfg && adapterCfg.provider && adapterCfg.provider !== 'wgame') return false;
    const h = req.headers || {};
    const hasToken = !!(h.token || h.Token || h['x-session-key'] || h['session-key']);
    if (!hasToken) return false;
    const provider = getProvider('wgame');
    if (provider && typeof provider.isOurSession === 'function' && provider.isOurSession(h)) return true;
    // 进程重启后 sessions 会丢，但浏览器仍带着登录 Token；wgame 预览下回源一律剥掉
    return !!(adapterCfg && adapterCfg.provider === 'wgame');
  } catch (_) {
    return false;
  }
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
  const sourceOrigin = options.sourceOrigin
    || resolveSourceOrigin(root, fs, path)
    || '';
  const headerProxy = options.headerProxy !== false && !!sourceOrigin;
  const adapterCfg = options.adapterConfig
    || loadAdapterConfig(root, fs, path)
    || { hosts: [], upstreamOrigin: '' };
  const adapterHosts = options.adapterHosts || adapterCfg.hosts || [];
  // aniw 业务 API（可 POST）；绝不能回退成 OSS，否则 MethodNotAllowed ResourceType=OBJECT
  const apiUpstreamOrigin = options.apiUpstreamOrigin || adapterCfg.upstreamOrigin || '';
  // oniw 对象存储（仅 GET）；不要用 apiUpstream 顶替
  const ossOrigin = options.ossOrigin || adapterCfg.ossOrigin || '';
  const bootCfg = {
    hosts: adapterHosts,
    apiHostPatterns: adapterCfg.apiHostPatterns || [],
    excludeHosts: adapterCfg.excludeHosts || [],
    ossOrigin: ossOrigin || '',
    upstreamOrigin: apiUpstreamOrigin || '',
    ossHosts: []
  };
  try {
    if (ossOrigin) bootCfg.ossHosts.push(new URL(ossOrigin).hostname);
  } catch (_) { /* ignore */ }

  return http.createServer((req, res) => {
    const handle = async () => {
      if (await tryHandleAdapter(req, res, {
        adapterHosts: bootCfg,
        adapterConfig: adapterCfg,
        siteDir: root
      })) return;

      if (headerProxy && tryHandleProxy(req, res, sourceOrigin, bootCfg)) {
        return;
      }

      const reqUrl = new URL(req.url || '/', `http://${host}:${options.port || 0}`);
      const filePath = resolveFilePath(root, req.url || '/');
      const method = String(req.method || 'GET').toUpperCase();
      const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';

      if (!filePath) {
        // OSS/图片误落到本地短 path → 回 oniw OSS，不要回主站（且禁止 POST 打 OSS）
        if (
          !isMutating
          && ossOrigin
          && isOssAssetPath(reqUrl.pathname)
          && tryFallbackMissingAsset(req, res, ossOrigin, reqUrl.pathname, reqUrl.search)
        ) {
          return;
        }
        // home：/api/lobby/* 配置走 OSS（不接 wgame）
        if (
          !isMutating
          && ossOrigin
          && /^\/api\/lobby\//i.test(reqUrl.pathname)
          && tryFallbackMissingAsset(req, res, ossOrigin, reqUrl.pathname, reqUrl.search)
        ) {
          return;
        }
        // GET 的 /hall/api/**/*.json 实际在 OSS；本地没有时回 oniw（仍禁止 POST）
        if (
          !isMutating
          && ossOrigin
          && isHallApiPath(reqUrl.pathname)
          && /\.json$/i.test(reqUrl.pathname)
          && tryFallbackMissingAsset(req, res, ossOrigin, reqUrl.pathname, reqUrl.search)
        ) {
          return;
        }
        // home/lobby 等未映射接口：保持原站回源（OSS/aniw），不空数据覆盖
        // 本地 wgame 会话 Token 不能带给真实上游 → 剥 Token，但不再伪造 code:1
        if (
          apiUpstreamOrigin
          && isHallApiPath(reqUrl.pathname)
          && tryFallbackMissingAsset(req, res, apiUpstreamOrigin, reqUrl.pathname, reqUrl.search, {
            stripAuth: shouldStripAuth(req, adapterCfg),
            sanitizeAuthKick: false,
            refererOrigin: apiUpstreamOrigin
          })
        ) {
          return;
        }
        if (
          sourceOrigin
          && isStaticAssetPath(reqUrl.pathname)
          && tryFallbackMissingAsset(req, res, sourceOrigin, reqUrl.pathname, reqUrl.search)
        ) {
          return;
        }
        // 主站常挂在 OSS/CDN：业务 API POST 过去会 405，有 hall API path 时禁止回主站
        if (
          sourceOrigin
          && !isHallApiPath(reqUrl.pathname)
          && (
            isLikelySameOriginApiPath(reqUrl.pathname, reqUrl.search)
            || isFetchLikeRequest(req)
          )
          && tryFallbackMissingAsset(req, res, sourceOrigin, reqUrl.pathname, reqUrl.search, {
            stripAuth: shouldStripAuth(req, adapterCfg)
          })
        ) {
          return;
        }
        if (spaFallback && !isStaticAssetPath(reqUrl.pathname)) {
          const indexPath = path.join(root, 'index.html');
          if (fs.existsSync(indexPath)) {
            let html = fs.readFileSync(indexPath, 'utf8');
            if (headerProxy) html = injectBootIntoHtml(html, sourceOrigin, bootCfg);
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache'
            });
            res.end(html);
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
      await new Promise((resolve) => {
        fs.readFile(filePath, (err, data) => {
          if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('404');
            resolve();
            return;
          }
          if (headerProxy && (ext === '.html' || ext === '.htm')) {
            const html = injectBootIntoHtml(data.toString('utf8'), sourceOrigin, bootCfg);
            res.writeHead(200, {
              'Content-Type': 'text/html; charset=utf-8',
              'Cache-Control': 'no-cache',
              'X-Content-Type-Options': 'nosniff'
            });
            res.end(html);
            resolve();
            return;
          }
          res.writeHead(200, {
            'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff'
          });
          res.end(data);
          resolve();
        });
      });
    };

    handle().catch((err) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('500 ' + String(err && err.message || err));
      }
    });
  });
}

class StaticServer {
    constructor(options = {}) {
        this.server = null;
        this.port = null;
        this.siteDir = null;
        this.sourceOrigin = options.sourceOrigin || '';
        this.spaFallback = options.spaFallback === true;
        this.host = options.host || '127.0.0.1';
        this.headerProxy = options.headerProxy !== false;
    }

    isRunning() {
        return this.server !== null;
    }

    getInfo() {
        if (!this.isRunning()) return null;
        return {
            port: this.port,
            siteDir: this.siteDir,
            url: `http://${this.host}:${this.port}`,
            sourceOrigin: this.sourceOrigin || null,
            headerProxy: !!(this.headerProxy && this.sourceOrigin)
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
                const resolvedDir = path.resolve(siteDir);
                const sourceOrigin = this.sourceOrigin || resolveSourceOrigin(resolvedDir, fs, path);
                this.sourceOrigin = sourceOrigin;
                const server = createStaticServer(resolvedDir, {
                    port,
                    host: this.host,
                    spaFallback: this.spaFallback,
                    sourceOrigin,
                    headerProxy: this.headerProxy
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
                    this.siteDir = resolvedDir;
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
