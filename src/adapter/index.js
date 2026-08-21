const { handleLogin, handleRegister, handleCheckRegister } = require('./auth');
const { isAdapterApiHost } = require('./hosts');
const { PROXY_PREFIX, parseProxyTarget } = require('../preview-proxy');

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function normalizeApiPath(pathname) {
  let p = String(pathname || '');
  if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
  return p;
}

function matchAuthRoute(pathname) {
  const p = normalizeApiPath(pathname);
  if (p === '/api/member/login' || p === '/api/member/agent/login') return 'login';
  if (p === '/api/member/register' || p === '/api/member/fastRegister') return 'register';
  if (p === '/api/member/check/register') return 'checkRegister';
  if (p === '/api/member/v2/fastLogin' || p === '/api/member/getFastLogin') return 'login';
  if (p === '/api/member/thirdPartyLogin') return 'login';
  return null;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'X-SD-Adapter': 'auth'
  });
  res.end(body);
}

/**
 * 解析请求真正要打的 API path：
 * - 短路径：/hall/api/member/login
 * - 长代理：/__sd_proxy__/https%3A%2F%2Faniw976...%2Fhall%2Fapi%2Fmember%2Flogin
 */
function resolveAdapterPath(reqUrl, adapterHosts) {
  const pathname = reqUrl.pathname || '';
  if (pathname === PROXY_PREFIX || pathname.startsWith(PROXY_PREFIX + '/')) {
    const target = parseProxyTarget(reqUrl);
    if (!target) return null;
    if (!isAdapterApiHost(target.hostname, adapterHosts)) return null;
    return { pathname: target.pathname, via: 'proxy', host: target.hostname };
  }
  const route = matchAuthRoute(pathname);
  if (!route) return null;
  return { pathname, via: 'local', host: null };
}

/**
 * @returns {Promise<boolean>} true if handled
 */
async function tryHandleAdapter(req, res, options = {}) {
  const adapterHosts = options.adapterHosts || [];
  const host = req.headers.host || '127.0.0.1';
  let reqUrl;
  try {
    reqUrl = new URL(req.url || '/', `http://${host}`);
  } catch (_) {
    return false;
  }

  const resolved = resolveAdapterPath(reqUrl, adapterHosts);
  if (!resolved) return false;

  const route = matchAuthRoute(resolved.pathname);
  if (!route) return false;

  if (req.method === 'OPTIONS') {
    sendJson(res, 204, {});
    return true;
  }

  if (req.method !== 'POST' && req.method !== 'GET') {
    sendJson(res, 405, { code: 405, msg: 'method not allowed', data: null });
    return true;
  }

  let body = {};
  if (req.method === 'POST') {
    try {
      const raw = await readRawBody(req);
      if (raw.length) {
        try {
          body = JSON.parse(raw.toString('utf8'));
        } catch (_) {
          body = raw;
        }
      }
    } catch (err) {
      sendJson(res, 400, { code: 400, msg: String(err && err.message || err), data: null });
      return true;
    }
  }

  let result;
  if (route === 'login') result = handleLogin(body);
  else if (route === 'register') result = handleRegister(body);
  else result = handleCheckRegister(body);

  console.log(
    '[adapter:auth]',
    req.method,
    resolved.via === 'proxy' ? `(proxy ${resolved.host})` : '',
    resolved.pathname,
    '->',
    result.code,
    result.msg
  );
  sendJson(res, 200, result);
  return true;
}

module.exports = {
  tryHandleAdapter,
  matchAuthRoute,
  normalizeApiPath,
  resolveAdapterPath
};
