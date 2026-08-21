/**
 * Provider wgame：执行规范 OP，返回统一 envelope { ok, code, msg, data }
 * data 为「规范用户态」，不含目标站字段名；由 series 再映射。
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wgameAuth } = require('./client');
const { loadWgameConfig } = require('./config');
const { OP } = require('../../ops');

const users = new Map();
const sessions = new Map();
const SESSION_STORE = path.join(os.tmpdir(), 'site-downloader-wgame-sessions.json');

function loadPersistedSessions() {
  try {
    if (!fs.existsSync(SESSION_STORE)) return;
    const obj = JSON.parse(fs.readFileSync(SESSION_STORE, 'utf8'));
    if (!obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      if (v && v.user) sessions.set(k, v);
    }
  } catch (_) { /* ignore */ }
}

function persistSessions() {
  try {
    const obj = {};
    for (const [k, v] of sessions.entries()) obj[k] = v;
    fs.writeFileSync(SESSION_STORE, JSON.stringify(obj));
  } catch (_) { /* ignore */ }
}

loadPersistedSessions();

function ok(data, msg) {
  return { ok: true, code: 0, msg: msg || 'ok', data };
}

function fail(code, msg) {
  return { ok: false, code: code || 1, msg: msg || 'error', data: null };
}

function randomToken(prefix) {
  return prefix + crypto.randomBytes(16).toString('hex');
}

function pickAccount(body) {
  if (!body || typeof body !== 'object') return '';
  return (
    body.username
    || body.account
    || body.userAccount
    || body.phone
    || body.email
    || body.loginName
    || ''
  );
}

function pickPassword(body) {
  if (!body || typeof body !== 'object') return '';
  return body.userpass || body.password || body.passwd || body.pwd || '';
}

function pickInvite(body) {
  if (!body || typeof body !== 'object') return 0;
  const v = body.inviteCode || body.invite || body.nCheckCode || body.checkCode || 0;
  return Number(v) || 0;
}

function normalizeBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) {
    if (raw._sdPlain || pickAccount(raw)) {
      const out = Object.assign({}, raw);
      delete out._encrypted;
      return out;
    }
    if (raw.encryptString && !pickAccount(raw)) {
      return { _encrypted: true, encryptString: raw.encryptString };
    }
    return raw;
  }
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  try {
    return normalizeBody(JSON.parse(text));
  } catch (_) {
    return { _raw: text.slice(0, 200), _encrypted: true };
  }
}

/** 规范用户态（系列无关） */
function toCanonicalUser(account, password, res) {
  const session = String(res.sSession || '');
  const uid = String(res.dwUserID != null ? res.dwUserID : '');
  const game_gold = res.game_gold != null ? Number(res.game_gold) : 0;
  const nickname = res.nickname || account;
  return {
    account,
    password: password || '',
    session,
    userId: uid,
    game_gold,
    currency: 'BRL',
    nickname,
    phone: res.phone || '',
    email: res.email || '',
    vip_level: res.nVipLevel || 0,
    face_id: res.faceID != null ? String(res.faceID) : '',
    device_id: res.deviceId || '',
    hall_server_id: res.nHallServerId,
    hall_branch_id: res.nHallBranchId,
    server_time: res.dwServerTime,
    happy_money: res.happyMoney,
    game_score: res.lGameScore,
    first_login: res.bFirstLogin,
    has_recharge: res.bHasRecharge,
    raw_hall: res.hall || null
  };
}

function rememberSession(user) {
  const row = { user, at: Date.now() };
  if (user.account) sessions.set(user.account, row);
  if (user.userId) sessions.set('uid:' + user.userId, row);
  if (user.session) sessions.set('sk:' + user.session, row);
  persistSessions();
  return row;
}

function findSession(body, headers) {
  const h = headers || {};
  const key = String(
    h['x-session-key']
    || h['session-key']
    || h['session_key']
    || h.token
    || h.Token
    || (body && (body.session_key || body.sessionKey || body.jwt_token || body.userkey))
    || ''
  );
  if (key) {
    const bySk = sessions.get('sk:' + key);
    if (bySk) return bySk;
    const byUid = sessions.get('uid:' + key);
    if (byUid) return byUid;
    for (const row of sessions.values()) {
      const u = row && row.user;
      if (!u) continue;
      if (u.session === key || u.userId === key) return row;
    }
  }
  let latest = null;
  for (const [k, row] of sessions.entries()) {
    if (String(k).startsWith('uid:') || String(k).startsWith('sk:')) continue;
    if (!latest || (row.at || 0) > (latest.at || 0)) latest = row;
  }
  return latest;
}

/** 请求 Token 是否为我们适配层登录产生的会话（不能直接打真实上游） */
function isOurSession(headersOrToken) {
  let token = '';
  if (typeof headersOrToken === 'string') {
    token = headersOrToken;
  } else if (headersOrToken && typeof headersOrToken === 'object') {
    token = String(
      headersOrToken.token
      || headersOrToken.Token
      || headersOrToken['x-session-key']
      || headersOrToken['session-key']
      || ''
    );
  }
  if (!token) return false;
  if (sessions.has('sk:' + token)) return true;
  for (const row of sessions.values()) {
    if (row && row.user && row.user.session === token) return true;
  }
  return false;
}

function mapError(err) {
  const code = err && err.code != null ? Number(err.code) : 1005;
  const known = {
    167: 'Mobile phone number already exists',
    170: 'Account registration with the same IP exceeds the limit',
    46: 'Login failed',
    139: 'Password error'
  };
  return fail(code, known[code] || (err && err.message) || ('error ' + code));
}

function mockUser(account, password) {
  return {
    account,
    password: password || '',
    session: randomToken('sk_'),
    userId: randomToken('uk_'),
    game_gold: 0,
    currency: 'BRL',
    nickname: account,
    phone: '',
    email: '',
    vip_level: 0,
    face_id: '',
    device_id: randomToken('fp_'),
    mock: true
  };
}

async function callGateway(action, data, cfg) {
  const account = pickAccount(data);
  const password = pickPassword(data);
  if (data._encrypted) {
    return fail(1003, 'request body encrypted; cannot map to wgame');
  }
  if (!account || !password) {
    return fail(1004, 'account/password required');
  }
  try {
    const res = await wgameAuth({
      action,
      wssUrl: cfg.wssUrl,
      packageId: cfg.packageId,
      timeoutMs: cfg.timeoutMs,
      nGmType: cfg.nGmType,
      account,
      password,
      inviteCode: pickInvite(data),
      mobile: data.phone || data.mobile || ''
    });
    const user = toCanonicalUser(account, password, res);
    rememberSession(user);
    return ok(user, 'ok');
  } catch (err) {
    console.warn('[provider:wgame]', action, 'failed:', (err && err.message) || err);
    if (cfg.fallbackMock) {
      const user = mockUser(account, password);
      rememberSession(user);
      users.set(account, { password, user });
      return ok(user, 'ok');
    }
    return mapError(err);
  }
}

/**
 * @param {string} op
 * @param {{ body?: object, headers?: object, siteDir?: string, providerOptions?: object }} ctx
 */
async function execute(op, ctx) {
  const body = normalizeBody(ctx && ctx.body);
  const headers = (ctx && ctx.headers) || {};
  const cfg = Object.assign(
    {},
    loadWgameConfig(ctx && ctx.siteDir),
    (ctx && ctx.providerOptions) || {}
  );

  if (op === OP.AUTH_REGISTER) {
    if (cfg.mode === 'mock') {
      const account = pickAccount(body) || ('u' + Date.now());
      const password = pickPassword(body) || '123456';
      if (users.has(account) && !body._encrypted) return fail(1001, 'account already exists');
      const user = mockUser(account, password);
      users.set(account, { password, user });
      rememberSession(user);
      return ok(user, 'ok');
    }
    return callGateway('register', body, cfg);
  }

  if (op === OP.AUTH_LOGIN) {
    if (cfg.mode === 'mock') {
      const account = pickAccount(body) || 'mock_user';
      const password = pickPassword(body);
      const user = mockUser(account, password);
      rememberSession(user);
      return ok(user, 'ok');
    }
    return callGateway('login', body, cfg);
  }

  if (op === OP.AUTH_CHECK_REGISTER) {
    const account = pickAccount(body);
    if (!account || body._encrypted) return ok({ exists: false }, 'ok');
    return ok({ exists: users.has(account) || sessions.has(account) }, 'ok');
  }

  if (op === OP.USER_INFO) {
    const row = findSession(body, headers);
    if (!row || !row.user) return fail(401, 'not logged in');
    return ok(row.user, 'ok');
  }

  if (op === OP.WALLET_GOLD) {
    const row = findSession(body, headers);
    const gold = row && row.user ? Number(row.user.game_gold || 0) : 0;
    return ok({ game_gold: gold, totalGold: gold, bonus: 0, bonusRequireBet: 0, auditMode: 0 }, 'ok');
  }

  return fail(404, 'unknown op: ' + op);
}

module.exports = {
  id: 'wgame',
  execute,
  sessions,
  users,
  normalizeBody,
  loadWgameConfig,
  isOurSession,
  CATALOG: require('./catalog').CATALOG
};
