/**
 * 已冻结的公开 JSON。兼容层优先回这些文件，不再每次打官方。
 * 文件按 /hall 之后的路径存放，例如 api/game/hall/hotListV2/currency/BRL/language/pt.json。
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');

function siteIdOf(siteDir) {
  let id = siteDir ? path.basename(path.resolve(siteDir)) : '';
  id = id.replace(/^www\./i, '').replace(/\.(com|net|me|cc|bet|win|vip|org|co)$/i, '');
  return id;
}

function storeRoots(siteDir) {
  const id = siteIdOf(siteDir);
  const list = [];
  if (siteDir) list.push(path.join(siteDir, 'local-api'));
  if (id) list.push(path.join(ROOT, 'logs', 'local-public-api', id));
  return list;
}

function walk(dir, acc) {
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return acc; }
  for (const name of names) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) walk(p, acc);
    else if (/\.json$/i.test(name) && st.size > 0 && st.size < 12e6) acc.push(p);
  }
  return acc;
}

function score(rel) {
  let s = 0;
  if (rel.includes('/currency/BRL/')) s += 4;
  if (rel.includes('/language/pt')) s += 2;
  if (rel.endsWith('/default.json')) s += 1;
  return s;
}

function relKey(root, file) {
  return '/' + path.relative(root, file).replace(/\\/g, '/');
}

function baseRoutePath(pathname) {
  let p = String(pathname || '').split('?')[0];
  if (p.startsWith('/hall/')) p = p.slice('/hall'.length);
  p = p.replace(/\.json$/i, '').replace(/\/default$/, '');
  const cut = p.search(/\/(currency|language|osType|platformType|siteCode|agentId|page|type|xdevice|queryRateType)\//);
  if (cut > 0) p = p.slice(0, cut);
  return p;
}

/** 会员、资金、代理统计仍走我们的适配器，不用冻结的官方 JSON 盖掉。 */
const OWN_DATA_OP = new Set([
  'auth.login', 'auth.register', 'auth.checkRegister', 'auth.logout',
  'user.info', 'user.vip', 'user.avatars', 'wallet.gold',
  'pay.list', 'pay.type', 'pay.channels', 'pay.infos', 'pay.create', 'pay.orderInfo', 'pay.pending',
  'withdraw.pending', 'game.launch',
  'agent.index', 'agent.total', 'agent.commission', 'agent.period', 'agent.direct',
  'agent.promotion', 'agent.bind', 'agent.mode'
]);

const CREDIT_PUBLIC_ALIAS = {
  '/api/agent/credit/agentCenter/getPublicityV3': '/api/agent/promote/getPublicityV3',
  '/api/agent/credit/agentCenter/getPromoteStrangerSetting': '/api/agent/promote/getPromoteStrangerSetting',
  '/api/agent/credit/config/publicConfig': '/api/agent/promote/config/publicConfig',
  '/api/agent/credit/agentCenter/getAgentConfig': '/api/agent/promote/config/getAgentConfig'
};

function shouldServeFrozen(pathname) {
  const base = baseRoutePath(pathname);
  if (!base.startsWith('/api/')) return false;
  const { matchRoute } = require('../../series/aniw-lobby');
  const route = matchRoute(base);
  if (!route) return true;
  return !OWN_DATA_OP.has(route.op);
}

function activeIdFromBody(body) {
  if (body == null) return '';
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
  if (!text) return '';
  try {
    const json = JSON.parse(text);
    const id = json && (json.activeId != null ? json.activeId : json.id);
    if (id != null && String(id) !== '') return String(id);
  } catch (_) { /* plain form */ }
  const m = text.match(/(?:^|&)activeId=(\d+)/);
  return m ? m[1] : '';
}

/**
 * @returns {{ body: string, contentType: string, source: string } | null}
 */
function findLocalPublicBody(siteDir, pathname, body) {
  let requestPath = String(pathname || '').split('?')[0];
  if (requestPath.startsWith('/hall/')) requestPath = requestPath.slice('/hall'.length);
  requestPath = requestPath.replace(/\.json$/i, '');
  if (!requestPath.startsWith('/api/')) return null;
  if (CREDIT_PUBLIC_ALIAS[requestPath]) requestPath = CREDIT_PUBLIC_ALIAS[requestPath];

  if (requestPath === '/api/active/get' || requestPath === '/api/active/cutADeal/list' || requestPath === '/api/active/turntable/luckyIntegralList') {
    const id = activeIdFromBody(body);
    if (!id && requestPath !== '/api/active/get') {
      for (const root of storeRoots(siteDir)) {
        const flat = path.join(root, requestPath.replace(/^\//, '') + '.json');
        if (fs.existsSync(flat)) {
          return {
            body: fs.readFileSync(flat, 'utf8'),
            contentType: 'application/json; charset=utf-8',
            source: 'local-public-api'
          };
        }
      }
    }
    if (!id) return null;
    const idRel = requestPath.replace(/^\//, '') + '/' + id + '.json';
    for (const root of storeRoots(siteDir)) {
      const file = path.join(root, idRel);
      if (fs.existsSync(file)) {
        return {
          body: fs.readFileSync(file, 'utf8'),
          contentType: 'application/json; charset=utf-8',
          source: 'local-public-api'
        };
      }
    }
    return null;
  }

  let best = null;
  let bestScore = -1;
  for (const root of storeRoots(siteDir)) {
    if (!fs.existsSync(root)) continue;
    for (const file of walk(root, [])) {
      const rel = relKey(root, file);
      if (rel.includes('/api/active/get/')) continue;
      const noExt = rel.replace(/\.json$/i, '');
      if (noExt !== requestPath && !noExt.startsWith(requestPath + '/')) continue;
      const sc = score(rel);
      if (sc > bestScore) {
        bestScore = sc;
        best = file;
      }
    }
  }
  if (!best) return null;
  return {
    body: fs.readFileSync(best, 'utf8'),
    contentType: 'application/json; charset=utf-8',
    source: 'local-public-api'
  };
}

module.exports = {
  findLocalPublicBody,
  shouldServeFrozen,
  baseRoutePath,
  siteIdOf,
  storeRoots,
  activeIdFromBody
};
