const path = require('path');
const fs = require('fs');
const { loadWgameWebConfig } = require('./wgame-web-config');

const DEFAULTS = {
  mode: 'wgame', // wgame | mock
  wssUrl: 'wss://server.679win2.com',
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
}

function loadWgameConfig(siteDir) {
  const out = Object.assign({}, DEFAULTS);

  // ① wgame_web/src/config/config.js（实时，debug→mockWssUrl，否则 baseWssUrl）
  const web = loadWgameWebConfig();
  if (web) {
    applyBlock(out, {
      wssUrl: web.wssUrl,
      packageId: web.packageId
    });
    out.wgameWeb = {
      root: web.webRoot,
      configPath: web.configPath,
      branch: web.branch,
      debug: web.debug,
      serverMode: web.serverMode,
      baseWssUrl: web.baseWssUrl,
      mockWssUrl: web.mockWssUrl,
      lobbyGameUrl: web.lobbyGameUrl,
      mtime: web.mtime
    };
  }

  // ② 站点 adapter-hosts（不覆盖 wgame_web 已提供的 wss/packageId）
  const hostOpts = web ? { skipConnection: true } : undefined;
  try {
    if (siteDir) {
      const p = path.join(siteDir, 'adapter-hosts.json');
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        applyBlock(out, raw && raw.wgame, hostOpts);
        applyBlock(out, raw && raw.providerOptions, hostOpts);
      }
    }
  } catch (_) { /* ignore */ }

  // ③ 环境变量（CI/临时覆盖，优先级最高）
  if (process.env.ADAPTER_AUTH_MODE) out.mode = String(process.env.ADAPTER_AUTH_MODE);
  if (process.env.WGAME_WSS_URL) out.wssUrl = String(process.env.WGAME_WSS_URL);
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
