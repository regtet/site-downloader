const crypto = require('crypto');
const { wgameAuth } = require('./wgame/client');
const { loadWgameConfig } = require('./wgame/config');

/** 内存账号表（mock 模式） */
const users = new Map();

/** 最近一次成功的 wgame 会话（供后续接口扩展） */
const wgameSessions = new Map();

function ok(data, msg) {
  return { code: 0, msg: msg || 'ok', data };
}

function fail(code, msg) {
  return { code: code || 1, msg: msg || 'error', data: null };
}

function randomToken(prefix) {
  return prefix + crypto.randomBytes(16).toString('hex');
}

function buildUserProfile(account, extras) {
  const username = String(account || extras.username || 'user_' + Date.now());
  const session_key = extras.session_key || randomToken('sk_');
  const jwt_token = extras.jwt_token || randomToken('jwt_');
  const userkey = extras.userkey || randomToken('uk_');
  return {
    username,
    userpass: extras.userpass || '',
    session_key,
    jwt_token,
    userkey,
    currency: extras.currency || 'BRL',
    account_type: 15,
    game_gold: extras.game_gold != null ? extras.game_gold : 0,
    platfromid: 'web_lobby',
    mode: 0,
    phone: extras.phone || '',
    email: extras.email || '',
    realname: extras.realname || '',
    deviceFingerprint: extras.deviceFingerprint || randomToken('fp_'),
    ...extras.more
  };
}

function mapWgameToProfile(account, password, res) {
  const session = String(res.sSession || '');
  const uid = String(res.dwUserID != null ? res.dwUserID : '');
  const profile = buildUserProfile(account, {
    userpass: password || '',
    session_key: session,
    jwt_token: session || randomToken('jwt_'),
    userkey: uid || randomToken('uk_'),
    more: {
      wgame: true,
      dwUserID: res.dwUserID,
      nHallServerId: res.nHallServerId,
      nHallBranchId: res.nHallBranchId,
      dwServerTime: res.dwServerTime,
      deviceId: res.deviceId
    }
  });
  wgameSessions.set(account, {
    profile,
    session,
    dwUserID: res.dwUserID,
    nHallServerId: res.nHallServerId,
    nHallBranchId: res.nHallBranchId,
    at: Date.now()
  });
  return profile;
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
    // 已带 _sdPlain 明文（boot 从表单注入）
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
    const parsed = JSON.parse(text);
    return normalizeBody(parsed);
  } catch (_) {
    return { _raw: text.slice(0, 200), _encrypted: true };
  }
}

function mockRegister(data) {
  const account = pickAccount(data) || ('u' + Date.now());
  const password = pickPassword(data) || '123456';
  if (users.has(account) && !data._encrypted) {
    return fail(1001, 'account already exists');
  }
  const profile = buildUserProfile(account, { userpass: password, more: { mock: true } });
  users.set(account, { password, profile });
  return ok(profile, 'register ok (mock)');
}

function mockLogin(data) {
  const account = pickAccount(data);
  const password = pickPassword(data);
  if (data._encrypted || !account) {
    const profile = buildUserProfile('mock_user', {
      userpass: '',
      more: { mock: true, note: 'encrypted-or-empty-body' }
    });
    return ok(profile, 'login ok (mock)');
  }
  const row = users.get(account);
  if (!row) {
    const profile = buildUserProfile(account, { userpass: password, more: { mock: true } });
    users.set(account, { password, profile });
    return ok(profile, 'login ok (mock auto-register)');
  }
  if (row.password && password && row.password !== password) {
    return fail(1002, 'password error');
  }
  row.profile = buildUserProfile(account, {
    userpass: row.password,
    session_key: randomToken('sk_'),
    jwt_token: randomToken('jwt_'),
    userkey: row.profile.userkey,
    more: { mock: true }
  });
  users.set(account, row);
  return ok(row.profile, 'login ok (mock)');
}

async function callWgame(action, data, cfg) {
  const account = pickAccount(data);
  const password = pickPassword(data);
  if (data._encrypted) {
    return fail(1003, 'request body encrypted; cannot map to wgame (need plaintext account/password)');
  }
  if (!account || !password) {
    return fail(1004, 'account/password required for wgame');
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
    const profile = mapWgameToProfile(account, password, res);
    return ok(profile, action === 'register' ? 'register+login ok (wgame)' : 'login ok (wgame)');
  } catch (err) {
    const code = err && err.code != null ? err.code : 1005;
    const msg = (err && err.message) || String(err);
    console.warn('[adapter:wgame]', action, 'failed:', msg);
    if (cfg.fallbackMock) {
      return action === 'register' ? mockRegister(data) : mockLogin(data);
    }
    return fail(code, msg);
  }
}

/**
 * @param {object} body
 * @param {{ siteDir?: string }} [ctx]
 */
async function handleRegister(body, ctx) {
  const data = normalizeBody(body);
  const cfg = loadWgameConfig(ctx && ctx.siteDir);
  if (cfg.mode === 'mock') return mockRegister(data);
  return callWgame('register', data, cfg);
}

async function handleLogin(body, ctx) {
  const data = normalizeBody(body);
  const cfg = loadWgameConfig(ctx && ctx.siteDir);
  if (cfg.mode === 'mock') return mockLogin(data);
  return callWgame('login', data, cfg);
}

async function handleCheckRegister(body) {
  const data = normalizeBody(body);
  const account = pickAccount(data);
  if (!account || data._encrypted) {
    return ok({ exists: false }, 'ok');
  }
  return ok({ exists: users.has(account) || wgameSessions.has(account) }, 'ok');
}

module.exports = {
  users,
  wgameSessions,
  ok,
  fail,
  handleRegister,
  handleLogin,
  handleCheckRegister,
  normalizeBody,
  loadWgameConfig
};
