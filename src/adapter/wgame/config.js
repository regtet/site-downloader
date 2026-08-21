const path = require('path');
const fs = require('fs');

const DEFAULTS = {
  mode: 'wgame', // wgame | mock
  wssUrl: 'wss://server.679win2.com',
  packageId: 46,
  timeoutMs: 15000,
  nGmType: 7,
  fallbackMock: false
};

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
        const w = raw && raw.wgame;
        if (w && typeof w === 'object') {
          if (w.mode) out.mode = String(w.mode);
          if (w.wssUrl) out.wssUrl = String(w.wssUrl);
          if (w.packageId != null) out.packageId = Number(w.packageId) || out.packageId;
          if (w.timeoutMs != null) out.timeoutMs = Number(w.timeoutMs) || out.timeoutMs;
          if (w.nGmType != null) out.nGmType = Number(w.nGmType) || out.nGmType;
          if (w.fallbackMock != null) out.fallbackMock = !!w.fallbackMock;
        }
      }
    }
  } catch (_) { /* ignore */ }

  return out;
}

module.exports = {
  DEFAULTS,
  loadWgameConfig
};
