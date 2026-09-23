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
  isLikelySameOriginApiPath
} = require('./preview-proxy');
const { tryHandleAdapter } = require('./adapter');
const { noteUnmapped, isApiPath } = require('./adapter/unmapped-log');
const { loadAdapterConfig, isHallApiPath, isOssAssetPath } = require('./adapter/hosts');
const { hasAdapterPack, inferOriginsFromNetwork, inferOssOriginFromHtml, inferSiteCodeFromSite } = require('./adapter/config');
const { getProvider } = require('./adapter/providers');
const { isMockCashierPath, handleMockCashierRequest } = require('./mock-cashier');
const { isMockAgentPath, handleMockAgentRequest } = require('./mock-agent-api');
const { isGameLauncherRequest, serveGameLauncher } = require('./game-launcher');

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

/** 浏览器改写到本地前的官方 API 源（aniw/oniw），避免 upstreamOrigin 为空时活动接口落空 */
function upstreamHint(req) {
  const hinted = String((req && req.headers && req.headers['x-sd-upstream']) || '');
  try {
    const u = new URL(hinted);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    if (!/^(aniw|oniw)\d*\./i.test(u.hostname)) return '';
    return u.origin;
  } catch (_) {
    return '';
  }
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
  const adapterPack = hasAdapterPack(root, fs, path);
  const adapterEnabled = options.enableAdapter !== undefined
    ? !!options.enableAdapter
    : adapterPack;
  const adapterCfg = adapterEnabled
    ? (options.adapterConfig || loadAdapterConfig(root, fs, path) || { hosts: [], upstreamOrigin: '' })
    : (() => {
      const inferred = inferOriginsFromNetwork(root, fs, path) || {};
      return {
        hosts: [],
        apiHostPatterns: [],
        excludeHosts: [],
        upstreamOrigin: inferred.upstreamOrigin || '',
        ossOrigin: inferred.ossOrigin || inferOssOriginFromHtml(root, fs, path) || '',
        siteCode: inferSiteCodeFromSite(root, fs, path) || '',
        provider: null,
        providerOptions: {}
      };
    })();
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
    ossHosts: [],
    lobbyGameUrl: '',
    authEpoch: '',
    adapterEnabled,
    siteDir: root
  };
  try {
    const hostsPath = path.join(root, 'adapter-hosts.json');
    if (fs.existsSync(hostsPath)) {
      const hosts = JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
      const ww = hosts && hosts.wgameWeb;
      if (ww && (ww.snapshottedAt || ww.configMtime)) {
        bootCfg.authEpoch = String(ww.snapshottedAt || ww.configMtime);
      }
    }
    const manPath = path.join(root, 'migration-manifest.json');
    if (!bootCfg.authEpoch && fs.existsSync(manPath)) {
      const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
      if (man && man.generatedAt) bootCfg.authEpoch = String(man.generatedAt);
    }
  } catch (_) { /* ignore */ }
  try {
    const { loadGameConfig } = require('./adapter/providers/wgame/game-config');
    const po = (adapterCfg && adapterCfg.providerOptions) || {};
    const gameCfg = loadGameConfig(root, po);
    if (gameCfg && gameCfg.lobbyGameUrl) bootCfg.lobbyGameUrl = gameCfg.lobbyGameUrl;
  } catch (_) { /* ignore */ }
  try {
    if (ossOrigin) bootCfg.ossHosts.push(new URL(ossOrigin).hostname);
  } catch (_) { /* ignore */ }

  return http.createServer((req, res) => {
    const handle = async () => {
      try {
        const u = new URL(req.url || '/', `http://${host}`);
        if (isMockCashierPath(u.pathname)) {
          await handleMockCashierRequest(req, res);
          return;
        }
        if (isMockAgentPath(u.pathname)) {
          await handleMockAgentRequest(req, res, u.pathname);
          return;
        }
      } catch (_) { /* ignore */ }

      if (adapterEnabled && await tryHandleAdapter(req, res, {
        adapterHosts: bootCfg,
        adapterConfig: adapterCfg,
        siteDir: root
      })) return;

      try {
        const u = new URL(req.url || '/', `http://${host}`);
        if (adapterEnabled && isApiPath(u.pathname)) noteUnmapped(u.pathname, req.method);
      } catch (_) { /* ignore */ }

      if (headerProxy && tryHandleProxy(req, res, sourceOrigin, bootCfg)) {
        return;
      }

      const reqUrl = new URL(req.url || '/', `http://${host}:${options.port || 0}`);
      const method = String(req.method || 'GET').toUpperCase();
      const isMutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
      if (!isMutating && isGameLauncherRequest(reqUrl)) {
        serveGameLauncher(res);
        return;
      }
      const filePath = resolveFilePath(root, req.url || '/');

      if (!filePath) {
        // 大厅测速文件：每种候选域名都会打一次，慢的会被浏览器取消。
        // 本地预览域名已经固定，直接回 ok，不再打到真实 CDN。
        const speedProbe = {
          '/ipacdn.txt': 1,
          '/agespeed.txt': 1,
          '/fzcdn.txt': 1,
          '/ssocdn.json': 1,
          '/ssocdn.txt': 1,
          '/cocos/bewcdn.json': 1,
          '/normal/dscdn.json': 1
        };
        if (!isMutating && speedProbe[reqUrl.pathname]) {
          const probeBody = 'ok';
          res.writeHead(200, {
            'Content-Type': 'text/plain; charset=utf-8',
            'Content-Length': String(Buffer.byteLength(probeBody)),
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': '*'
          });
          res.end(probeBody);
          return;
        }
        // 短 path 回源：浏览器请求 /ipacdn.txt?t= ，原始主机在 x-sd-upstream
        const hinted = upstreamHint(req);
        let hintHost = '';
        try { hintHost = hinted ? new URL(hinted).hostname : ''; } catch (_) { /* ignore */ }
        const hintIsOss = /^oniw\d*\./i.test(hintHost);
        if (
          hinted
          && !(isMutating && hintIsOss)
          && tryFallbackMissingAsset(req, res, hinted, reqUrl.pathname, reqUrl.search, {
            refererOrigin: hinted,
            stripAuth: shouldStripAuth(req, adapterCfg),
            sanitizeAuthKick: shouldStripAuth(req, adapterCfg)
          })
        ) {
          return;
        }
        // OSS/图片误落到本地短 path → 回 oniw OSS，不要回主站（且禁止 POST 打 OSS）
        if (
          !isMutating
          && ossOrigin
          && isOssAssetPath(reqUrl.pathname)
          && tryFallbackMissingAsset(req, res, ossOrigin, reqUrl.pathname, reqUrl.search)
        ) {
          return;
        }
        // home：lobby 静态 *.json 走 oniw（key 带 /hall）；getSiteInfo 等无后缀业务走 aniw
        if (
          !isMutating
          && ossOrigin
          && /^\/api\/lobby\//i.test(reqUrl.pathname)
          && /\.json$/i.test(reqUrl.pathname)
        ) {
          const lobbyJsonPath = '/hall' + reqUrl.pathname;
          if (
            tryFallbackMissingAsset(req, res, ossOrigin, lobbyJsonPath, reqUrl.search, {
              forcePath: lobbyJsonPath
            })
          ) {
            return;
          }
        }
        // lobby 业务 API（含 getSiteInfo）：回 aniw，并补 /hall 前缀（上游只认 /hall/api/lobby）
        // 缺 siteCode 时补官方 LOBBY_SITE_CONFIG.siteCode（与浏览器正式请求一致，不伪造）
        const hintedOrigin = upstreamHint(req);
        const hallOrigin = (/^https?:\/\/aniw\d*\./i.test(hintedOrigin) ? hintedOrigin : '')
          || apiUpstreamOrigin;
        if (
          hallOrigin
          && /^\/(?:hall\/)?api\/lobby\//i.test(reqUrl.pathname)
        ) {
          let lobbyPath = reqUrl.pathname;
          if (lobbyPath.startsWith('/api/lobby/')) {
            lobbyPath = '/hall' + lobbyPath;
          }
          const { ensureSiteCodeQuery } = require('./adapter/config');
          const lobbySearch = ensureSiteCodeQuery(reqUrl.search, adapterCfg.siteCode);
          if (
            tryFallbackMissingAsset(req, res, hallOrigin, lobbyPath, lobbySearch, {
              stripAuth: shouldStripAuth(req, adapterCfg),
              sanitizeAuthKick: shouldStripAuth(req, adapterCfg),
              refererOrigin: hallOrigin,
              forcePath: lobbyPath
            })
          ) {
            return;
          }
        }
        // GET 的 /api/**/*.json 与 /hall/api/**/*.json：官方 OSS key 带 /hall 前缀；
        // 短 path（/api/...json）直打 oniw 常 AccessDenied，需补 /hall 后再回源（仍禁止 POST）
        if (
          !isMutating
          && ossOrigin
          && isHallApiPath(reqUrl.pathname)
          && /\.json$/i.test(reqUrl.pathname)
        ) {
          let ossJsonPath = reqUrl.pathname;
          if (ossJsonPath.startsWith('/api/') && !ossJsonPath.startsWith('/api/lobby/')) {
            ossJsonPath = '/hall' + ossJsonPath;
          } else if (ossJsonPath.startsWith('/api/lobby/')) {
            // lobby 静态 json 也尝试 /hall 前缀（与业务 path 一致）
            ossJsonPath = '/hall' + ossJsonPath;
          }
          if (
            tryFallbackMissingAsset(req, res, ossOrigin, ossJsonPath, reqUrl.search, {
              forcePath: ossJsonPath
            })
          ) {
            return;
          }
          const { getOssSnapshotBody } = require('./adapter/providers/wgame/oss-config');
          const snap = getOssSnapshotBody(root, reqUrl.pathname, 'GET');
          if (snap && snap.body) {
            let body = snap.body;
            if (body.indexOf('{$WG_BUCKET_SITE$}') !== -1) {
              body = body.replace(/\{\$WG_BUCKET_SITE\$\}/g, `http://${host}`);
            }
            res.writeHead(200, {
              'Content-Type': snap.contentType || 'application/json; charset=utf-8',
              'Cache-Control': 'no-store',
              'X-SD-Adapter': 'oss-har'
            });
            res.end(body);
            return;
          }
        }
        // home/lobby 等未映射接口：保持原站回源（OSS/aniw），不空数据覆盖
        // 本地 wgame 会话 Token 不能带给真实上游 → 剥 Token，但不再伪造 code:1
        // 短 path /api/* 上游只认 /hall/api/*（如 domainMatch）
        if (
          hallOrigin
          && isHallApiPath(reqUrl.pathname)
        ) {
          let hallPath = reqUrl.pathname;
          if (hallPath.startsWith('/api/') && !hallPath.startsWith('/hall/')) {
            hallPath = '/hall' + hallPath;
          }
          const { ensureSiteCodeQuery } = require('./adapter/config');
          const hallSearch = ensureSiteCodeQuery(reqUrl.search, adapterCfg.siteCode);
          const strip = shouldStripAuth(req, adapterCfg);
          const emptyListOnKick = /registerPopupDlgInfo|newcomer_benefit_pop/i.test(reqUrl.pathname);
          if (
            tryFallbackMissingAsset(req, res, hallOrigin, hallPath, hallSearch, {
              stripAuth: strip,
              sanitizeAuthKick: strip,
              emptyListOnKick,
              refererOrigin: hallOrigin,
              forcePath: hallPath,
              ossOrigin
            })
          ) {
            return;
          }
        }
        if (
          sourceOrigin
          && isStaticAssetPath(reqUrl.pathname)
          && tryFallbackMissingAsset(req, res, sourceOrigin, reqUrl.pathname, reqUrl.search)
        ) {
          return;
        }
        // 只回源真正的同源 API。/home/event 这类路由的 fetch 必须落本地 index，
        // 否则会拿到线上更新的 data-version，弹出「页面已更新」。
        if (
          sourceOrigin
          && !isHallApiPath(reqUrl.pathname)
          && isLikelySameOriginApiPath(reqUrl.pathname, reqUrl.search)
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
              'Cache-Control': 'no-store, no-cache, must-revalidate',
              'Pragma': 'no-cache',
              'X-SD-Preview-Adapter': adapterEnabled ? '1' : '0'
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
              'Cache-Control': 'no-store, no-cache, must-revalidate',
              'Pragma': 'no-cache',
              'X-Content-Type-Options': 'nosniff',
              'X-SD-Preview-Adapter': adapterEnabled ? '1' : '0'
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
            headerProxy: !!(this.headerProxy && this.sourceOrigin),
            adapterEnabled: this.adapterEnabled !== false
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

    start(siteDir, preferredPort, startOptions = {}) {
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
                    headerProxy: this.headerProxy,
                    enableAdapter: startOptions.enableAdapter
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
                    this.adapterEnabled = startOptions.enableAdapter !== undefined
                      ? !!startOptions.enableAdapter
                      : hasAdapterPack(resolvedDir, fs, path);
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
