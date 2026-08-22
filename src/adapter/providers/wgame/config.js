const path = require('path');
const fs = require('fs');

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

function applyBlock(out, w) {
  if (!w || typeof w !== 'object') return;
  if (w.mode) out.mode = String(w.mode);
  if (w.wssUrl) out.wssUrl = String(w.wssUrl);
  if (w.packageId != null) out.packageId = Number(w.packageId) || out.packageId;
  if (w.timeoutMs != null) out.timeoutMs = Number(w.timeoutMs) || out.timeoutMs;
  if (w.nGmType != null) out.nGmType = Number(w.nGmType) || out.nGmType;
  if (w.fallbackMock != null) out.fallbackMock = !!w.fallbackMock;
  if (w.fallbackMockOnIpLimit != null) out.fallbackMockOnIpLimit = !!w.fallbackMockOnIpLimit;
}

function loadWgameConfig(siteDir) {
  const out = Object.assign({}, DEFAULTS);
  if (process.env.ADAPTER_AUTH_MODE) out.mode = String(process.env.ADAPTER_AUTH_MODE);
  if (process.env.WGAME_WSS_URL) out.wssUrl = String(process.env.WGAME_WSS_URL);
  if (process.env.WGAME_PACKAGE_ID) out.packageId = Number(process.env.WGAME_PACKAGE_ID) || out.packageId;
  if (process.env.ADAPTER_FALLBACK_MOCK === '1') out.fallbackMock = true;

  try {
    if (siteDir) {
      const p = path.join(siteDir, 'adapter-hosts.json');
      if (fs.existsSync(p)) {
        const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
        applyBlock(out, raw && raw.wgame);
        applyBlock(out, raw && raw.providerOptions);
      }
    }
  } catch (_) { /* ignore */ }

  return out;
}

module.exports = {
  DEFAULTS,
  loadWgameConfig
};
