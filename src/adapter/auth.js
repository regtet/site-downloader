const crypto = require('crypto');

/** 内存账号表（进程内，重启清空）— 后续可换成接 wgame 网关 */
const users = new Map();

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
    account_type: 15, // NormalMember
    game_gold: extras.game_gold != null ? extras.game_gold : 10000,
    platfromid: 'web_lobby',
    mode: 0,
    phone: extras.phone || '',
    email: extras.email || '',
    realname: extras.realname || '',
    deviceFingerprint: extras.deviceFingerprint || randomToken('fp_'),
    ...extras.more
  };
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

/**
 * 尝试从可能被加密/包装的 body 里取出可用字段。
 * 解不出也不阻塞：mock 模式仍可按随机/固定账号发成功包，用于先跑通 UI。
 */
function normalizeBody(raw) {
  if (!raw) return {};
  if (typeof raw === 'object' && !Buffer.isBuffer(raw)) return raw;
  const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
  try {
    return JSON.parse(text);
  } catch (_) {
    // 可能是加密密文：保留占位，登录仍返回 mock 成功
    return { _raw: text.slice(0, 200), _encrypted: true };
  }
}

function handleRegister(body) {
  const data = normalizeBody(body);
  const account = pickAccount(data) || ('u' + Date.now());
  const password = pickPassword(data) || '123456';
  if (users.has(account) && !data._encrypted) {
    return fail(1001, 'account already exists');
  }
  const profile = buildUserProfile(account, { userpass: password });
  users.set(account, { password, profile });
  return ok(profile, 'register ok');
}

function handleLogin(body) {
  const data = normalizeBody(body);
  const account = pickAccount(data);
  const password = pickPassword(data);

  // 密文请求：无法解析字段时，发一个稳定 mock 用户，保证 UI 能进登录后状态
  if (data._encrypted || !account) {
    const profile = buildUserProfile('mock_user', {
      userpass: '',
      more: { mock: true, note: 'encrypted-or-empty-body' }
    });
    users.set(profile.username, { password: '', profile });
    return ok(profile, 'login ok (mock)');
  }

  const row = users.get(account);
  if (!row) {
    // 试点：未注册也允许登录并自动建号，方便联调
    const profile = buildUserProfile(account, { userpass: password });
    users.set(account, { password, profile });
    return ok(profile, 'login ok (auto-register)');
  }
  if (row.password && password && row.password !== password) {
    return fail(1002, 'password error');
  }
  // 刷新 token
  row.profile = buildUserProfile(account, {
    userpass: row.password,
    session_key: randomToken('sk_'),
    jwt_token: randomToken('jwt_'),
    userkey: row.profile.userkey
  });
  users.set(account, row);
  return ok(row.profile, 'login ok');
}

function handleCheckRegister(body) {
  const data = normalizeBody(body);
  const account = pickAccount(data);
  if (!account || data._encrypted) {
    return ok({ exists: false }, 'ok');
  }
  return ok({ exists: users.has(account) }, 'ok');
}

module.exports = {
  users,
  ok,
  fail,
  handleRegister,
  handleLogin,
  handleCheckRegister,
  normalizeBody
};
