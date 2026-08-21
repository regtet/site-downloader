const os = require('os');

/**
 * 解析 Windows「Internet 设置」里的 ProxyServer 字符串。
 * 例: "127.0.0.1:7890" 或 "http=127.0.0.1:7890;https=127.0.0.1:7890"
 */
function parseWindowsProxyServer(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';

  let httpHost = '';
  let httpsHost = '';
  if (s.includes('=')) {
    for (const part of s.split(';')) {
      const [k, v] = part.split('=').map((x) => String(x || '').trim());
      if (!k || !v) continue;
      const key = k.toLowerCase();
      if (key === 'https') httpsHost = v;
      else if (key === 'http') httpHost = v;
      else if (key === 'socks' || key === 'socks5') {
        // axios 对 socks 支持弱，仅记作 http 代理候选
        if (!httpHost) httpHost = v;
      }
    }
  } else {
    httpHost = s;
    httpsHost = s;
  }

  const pick = httpsHost || httpHost;
  if (!pick) return '';
  if (/^https?:\/\//i.test(pick)) return pick;
  return `http://${pick}`;
}

function readWindowsSystemProxy() {
  if (os.platform() !== 'win32') return '';
  try {
    // 延迟加载，避免非 Windows 环境报错
    const { execSync } = require('child_process');
    const out = execSync(
      'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable & reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
      { encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }
    );
    const enableMatch = out.match(/ProxyEnable\s+REG_DWORD\s+0x([0-9a-f]+)/i);
    const enabled = enableMatch ? parseInt(enableMatch[1], 16) === 1 : false;
    if (!enabled) return '';
    const serverMatch = out.match(/ProxyServer\s+REG_SZ\s+(.+)/i);
    if (!serverMatch) return '';
    return parseWindowsProxyServer(serverMatch[1].trim());
  } catch (_) {
    return '';
  }
}

function normalizeProxyUrl(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `http://${s}`;
}

/**
 * 解析当前应使用的 HTTP(S) 代理。
 * 优先环境变量，其次 Windows 系统代理（浏览器能开、Node 默认不走的那种）。
 */
function resolveProxyUrl() {
  const fromEnv = process.env.HTTPS_PROXY
    || process.env.https_proxy
    || process.env.HTTP_PROXY
    || process.env.http_proxy
    || process.env.ALL_PROXY
    || process.env.all_proxy
    || '';
  if (fromEnv) return normalizeProxyUrl(fromEnv);
  return readWindowsSystemProxy();
}

/**
 * 写入 process.env，让 axios 等库自动走代理；返回实际使用的代理 URL（无则空串）。
 */
function applySystemProxy(options = {}) {
  const existing = resolveProxyUrl();
  // resolveProxyUrl 已含 env；若仅有 Windows 代理则写入 env
  let proxyUrl = existing;
  if (!process.env.HTTPS_PROXY && !process.env.https_proxy
    && !process.env.HTTP_PROXY && !process.env.http_proxy) {
    const win = readWindowsSystemProxy();
    if (win) {
      process.env.HTTP_PROXY = win;
      process.env.HTTPS_PROXY = win;
      // 避免对本机预览端口误走代理
      const noProxy = process.env.NO_PROXY || process.env.no_proxy || '';
      const extras = 'localhost,127.0.0.1,::1';
      process.env.NO_PROXY = noProxy ? `${noProxy},${extras}` : extras;
      process.env.no_proxy = process.env.NO_PROXY;
      proxyUrl = win;
    }
  }

  if (proxyUrl && options.log !== false) {
    try {
      console.log(`[proxy] 使用代理: ${proxyUrl}`);
    } catch (_) { /* ignore */ }
  }
  return proxyUrl || '';
}

function getPlaywrightProxy() {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) return undefined;
  try {
    const u = new URL(proxyUrl);
    return {
      server: `${u.protocol}//${u.host}`
    };
  } catch (_) {
    return { server: proxyUrl };
  }
}

/**
 * 供 ws / https 使用的代理 Agent。ws 不会读 HTTPS_PROXY 环境变量。
 * @returns {import('https').Agent|undefined}
 */
function getHttpsProxyAgent() {
  const proxyUrl = resolveProxyUrl();
  if (!proxyUrl) return undefined;
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent');
    return new HttpsProxyAgent(proxyUrl);
  } catch (err) {
    try {
      console.warn('[proxy] https-proxy-agent unavailable:', err && err.message);
    } catch (_) { /* ignore */ }
    return undefined;
  }
}

module.exports = {
  parseWindowsProxyServer,
  readWindowsSystemProxy,
  resolveProxyUrl,
  applySystemProxy,
  getPlaywrightProxy,
  getHttpsProxyAgent
};
