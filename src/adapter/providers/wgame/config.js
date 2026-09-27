const path = require('path');
const fs = require('fs');
const { loadWgameWebConfig } = require('./wgame-web-config');

const DEFAULTS = {
  mode: 'wgame', // wgame | mock
  /** auth: http（对齐 wgame_web）| ws（旧网关，仅回退） */
  authTransport: 'http',
  wssUrl: 'wss://server.679win2.com',
  loginHttpBase: '',
  httpSignSecret: '',
  packageId: 46,
  timeoutMs: 20000,
  nGmType: 7,
  fallbackMock: false,
  /** 注册同 IP 超限(170)时本地落会话，便于打通注册成功弹框；生产请关 */
  fallbackMockOnIpLimit: false
};

function applyBlock(out, w, opts) {
  if (!w || typeof w !== 'object') return;
  const skipConn = opts && opts.skipConnection;
  if (w.mode) out.mode = String(w.mode);
  if (!skipConn && w.wssUrl) out.wssUrl = String(w.wssUrl);
  if (!skipConn && w.packageId != null) {
    const pid = Number(w.packageId);
    if (Number.isFinite(pid)) out.packageId = pid;
  }
  if (w.timeoutMs != null) out.timeoutMs = Number(w.timeoutMs) || out.timeoutMs;
  if (w.nGmType != null) out.nGmType = Number(w.nGmType) || out.nGmType;
  if (w.fallbackMock != null) out.fallbackMock = !!w.fallbackMock;
  if (w.fallbackMockOnIpLimit != null) out.fallbackMockOnIpLimit = !!w.fallbackMockOnIpLimit;
  if (w.authTransport) out.authTransport = String(w.authTransport);
  if (!skipConn && w.loginHttpBase) out.loginHttpBase = String(w.loginHttpBase);
  if (w.httpSignSecret) out.httpSignSecret = String(w.httpSignSecret);
}

function loadWgameConfig(siteDir) {
  const out = Object.assign({}, DEFAULTS);
  let siteHosts = null;
  try {
    if (siteDir) {
      const p = path.join(siteDir, 'adapter-hosts.json');
      if (fs.existsSync(p)) siteHosts = JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (_) { /* ignore */ }

  // 已生成站点必须固定到构建时连接配置，不能被工作区外 wgame_web 后续切分支污染。
  const snapshot = siteHosts && siteHosts.wgameWeb
    && (siteHosts.wgameWeb.snapshottedAt || siteHosts.wgameWeb.configMtime)
    ? siteHosts.wgameWeb
    : null;

  // ① 构建快照优先；当前 wgame_web 仍提供 proto 路径及未落盘的签名密钥。
  const web = loadWgameWebConfig();
  if (snapshot) {
    applyBlock(out, {
      wssUrl: snapshot.wssUrl,
      packageId: snapshot.packageId,
      loginHttpBase: snapshot.loginHttpBase
    });
    if (web) applyBlock(out, { httpSignSecret: web.httpSignSecret }, { skipConnection: true });
    out.wgameWeb = Object.assign({}, snapshot, {
      root: web ? web.webRoot : snapshot.root,
      configPath: web ? web.configPath : undefined,
      source: 'site-snapshot'
    });
  } else if (web) {
    applyBlock(out, {
      wssUrl: web.wssUrl,
      packageId: web.packageId,
      loginHttpBase: web.loginHttpBase,
      httpSignSecret: web.httpSignSecret
    });
    out.wgameWeb = {
      root: web.webRoot,
      configPath: web.configPath,
      branch: web.branch,
      debug: web.debug,
      serverMode: web.serverMode,
      baseWssUrl: web.baseWssUrl,
      mockWssUrl: web.mockWssUrl,
      loginHttpBase: web.loginHttpBase,
      lobbyGameUrl: web.lobbyGameUrl,
      mtime: web.mtime,
      source: 'live-wgame-web'
    };
  }

  // ② 站点 provider 选项；连接信息已由快照/当前 wgame_web 决定。
  const hostOpts = (snapshot || web) ? { skipConnection: true } : undefined;
  applyBlock(out, siteHosts && siteHosts.wgame, hostOpts);
  applyBlock(out, siteHosts && siteHosts.providerOptions, hostOpts);

  // ③ 环境变量（CI/临时覆盖，优先级最高）
  if (process.env.ADAPTER_AUTH_MODE) out.mode = String(process.env.ADAPTER_AUTH_MODE);
  if (process.env.WGAME_AUTH_TRANSPORT) out.authTransport = String(process.env.WGAME_AUTH_TRANSPORT);
  if (process.env.WGAME_WSS_URL) out.wssUrl = String(process.env.WGAME_WSS_URL);
  if (process.env.WGAME_LOGIN_HTTP_BASE) out.loginHttpBase = String(process.env.WGAME_LOGIN_HTTP_BASE);
  if (process.env.WGAME_HTTP_SIGN_SECRET) out.httpSignSecret = String(process.env.WGAME_HTTP_SIGN_SECRET);
  if (process.env.WGAME_PACKAGE_ID != null && process.env.WGAME_PACKAGE_ID !== '') {
    const pid = Number(process.env.WGAME_PACKAGE_ID);
    if (Number.isFinite(pid)) out.packageId = pid;
  }
  if (process.env.ADAPTER_FALLBACK_MOCK === '1') out.fallbackMock = true;

  return out;
}

module.exports = {
  DEFAULTS,
  loadWgameConfig
};
