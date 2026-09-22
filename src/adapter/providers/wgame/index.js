/**
 * Provider wgame：执行规范 OP，返回统一 envelope { ok, code, msg, data }
 * data 为「规范用户态」，不含目标站字段名；由 series 再映射。
 */
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { wgameAuth, defaultDeviceId } = require('./client');
const { loadWgameConfig } = require('./config');
const { OP } = require('../../ops');
const https = require('https');
const http = require('http');

const users = new Map();
const sessions = new Map();
const SESSION_STORE = path.join(os.tmpdir(), 'site-downloader-wgame-sessions.json');
/** 当前生效的登录域（loginHttpBase|packageId|wssUrl）；切换后清空本地缓存，避免「空服仍能登录」 */
let activeAuthRealm = '';

function authRealmOf(cfg) {
  const c = cfg || {};
  return [
    String(c.loginHttpBase || '').replace(/\/$/, ''),
    String(c.packageId != null ? c.packageId : ''),
    String(c.wssUrl || '')
  ].join('|');
}

function clearAllLocalAuth(reason) {
  users.clear();
  sessions.clear();
  try {
    if (fs.existsSync(SESSION_STORE)) fs.unlinkSync(SESSION_STORE);
  } catch (_) { /* ignore */ }
  try {
    console.info('[provider:wgame] cleared local auth cache:', reason || 'manual');
  } catch (_) { /* ignore */ }
}

function ensureAuthRealm(cfg) {
  const realm = authRealmOf(cfg);
  if (activeAuthRealm && realm && activeAuthRealm !== realm) {
    clearAllLocalAuth(activeAuthRealm + ' → ' + realm);
  }
  activeAuthRealm = realm;
  // 丢掉与当前域不一致的旧持久化会话（含无 realm 的历史条目）
  let dropped = 0;
  for (const [k, row] of [...sessions.entries()]) {
    const r = row && row.user && row.user.authRealm;
    if (!r || r !== realm) {
      sessions.delete(k);
      dropped += 1;
    }
  }
  if (dropped) {
    persistSessions();
    try {
      console.info('[provider:wgame] dropped stale sessions:', dropped, 'realm=', realm);
    } catch (_) { /* ignore */ }
  }
  return realm;
}

function httpJson(urlStr, method, body) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      reject(e);
      return;
    }
    const lib = u.protocol === 'https:' ? https : http;
    const payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    const req = lib.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: u.pathname + (u.search || ''),
        method: String(method || 'POST').toUpperCase(),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          ...(payload ? { 'Content-Length': payload.length } : {})
        },
        timeout: 20000
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          try {
            resolve(JSON.parse(raw));
          } catch (_) {
            resolve({ raw });
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('pay http timeout'));
    });
    if (payload) req.write(payload);
    req.end();
  });
}
function validHallUserId(userId) {
  const n = Number(userId);
  return Number.isFinite(n) && n > 0;
}

function canReuseLocalSession(user) {
  if (!user || !validHallUserId(user.userId)) return false;
  // 配置域变了：旧 token 一律作废
  if (activeAuthRealm && user.authRealm && user.authRealm !== activeAuthRealm) return false;
  // HTTP 登录：有 httpToken 即可开游戏（不再依赖大厅 WS resume）
  if (user.httpToken) return true;
  return !!(user.session && user.hall_server_id != null && user.hall_branch_id != null);
}

function canLaunchGame(user) {
  return canReuseLocalSession(user);
}

function extractSessionKey(body, headers) {
  const h = headers || {};
  return String(
    h['x-session-key']
    || h['session-key']
    || h['session_key']
    || h.token
    || h.Token
    || h.userkey
    || h.Userkey
    || h.authorization
    || h.Authorization
    || (body && (body.session_key || body.sessionKey || body.jwt_token || body.token || body.userkey))
    || ''
  ).replace(/^Bearer\s+/i, '').trim();
}

function mergePassportIntoUser(user, res) {
  if (!user || !res) return user;
  if (res.sSession) user.session = String(res.sSession);
  if (res.dwUserID != null) user.userId = String(res.dwUserID);
  if (res.nHallServerId != null) user.hall_server_id = res.nHallServerId;
  if (res.nHallBranchId != null) user.hall_branch_id = res.nHallBranchId;
  if (res.deviceId) user.device_id = String(res.deviceId);
  return user;
}

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
  // 官方注册后 nickname 常为空；不要用账号名硬填
  const nickname = res.nickname != null ? String(res.nickname) : '';
  const out = {
    account,
    password: password || '',
    session,
    userId: uid,
    game_gold,
    nickname,
    phone: res.phone || '',
    email: res.email || '',
    vip_level: res.nVipLevel || 0,
    face_id: res.faceID != null ? String(res.faceID) : '',
    device_id: res.deviceId || res.device_id || '',
    hall_server_id: res.nHallServerId,
    hall_branch_id: res.nHallBranchId,
    server_time: res.dwServerTime,
    happy_money: res.happyMoney,
    game_score: res.lGameScore,
    first_login: res.bFirstLogin,
    has_recharge: res.bHasRecharge,
    raw_hall: res.hall || null
  };
  // 大厅真实 accountType（有才带；不硬编码）
  if (res.accountType != null) out.account_type = Number(res.accountType);
  else if (res.hall && res.hall.accountType != null) out.account_type = Number(res.hall.accountType);
  return out;
}

function rememberSession(user, cfg) {
  if (user && cfg) user.authRealm = authRealmOf(cfg);
  else if (user && activeAuthRealm && !user.authRealm) user.authRealm = activeAuthRealm;
  const row = { user, at: Date.now() };
  if (user.account) sessions.set(user.account, row);
  if (user.userId) sessions.set('uid:' + user.userId, row);
  if (user.session) sessions.set('sk:' + user.session, row);
  persistSessions();
  return row;
}

function findSession(body, headers, opts) {
  const key = extractSessionKey(body, headers);

  const tryRow = (row) => {
    if (!row || !row.user) return null;
    if (activeAuthRealm && row.user.authRealm && row.user.authRealm !== activeAuthRealm) return null;
    if (opts && opts.requireHallResume && !canReuseLocalSession(row.user)) return null;
    return row;
  };

  if (key) {
    const bySk = sessions.get('sk:' + key);
    if (bySk) {
      const hit = tryRow(bySk);
      if (hit) return hit;
    }
    const byUid = sessions.get('uid:' + key);
    if (byUid) {
      const hit = tryRow(byUid);
      if (hit) return hit;
    }
    for (const row of sessions.values()) {
      const u = row && row.user;
      if (!u) continue;
      if (u.session === key || String(u.userId) === key || u.userkey === key) {
        const hit = tryRow(row);
        if (hit) return hit;
      }
    }
  }
  // 无 session key 时不再回落到「最近一次登录」——否则换服/未登录也会被当成已登录
  return null;
}

/** 转发自有 HTTP 收银台/代理 API 时附带会话字段 */
function buildHttpPayload(body, headers) {
  const payload = Object.assign({}, body || {});
  const sessionRow = findSession(body, headers);
  const user = sessionRow && sessionRow.user;
  if (!user) return payload;
  if (!payload.token && user.session) payload.token = user.session;
  if (payload.userId == null && user.userId != null) payload.userId = user.userId;
  if (!payload.account && user.account) payload.account = user.account;
  return payload;
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

/** mock / IP170 回退会话（非 wgame 网关实网登录） */
function isMockSession(headersOrToken) {
  if (!isOurSession(headersOrToken)) return false;
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
  if (token) {
    const row = sessions.get('sk:' + token);
    if (row && row.user) return !!row.user.mock;
  }
  for (const row of sessions.values()) {
    const u = row && row.user;
    if (!u) continue;
    if (token && u.session === token) return !!u.mock;
    if (!token && u.mock) return true;
  }
  return false;
}

function mapError(err) {
  let code = err && err.code != null ? Number(err.code) : 1005;
  const msgFromHttp = err && err.response && err.response.message;
  const message = msgFromHttp || (err && err.message) || ('error ' + code);
  // HTTP 业务码 → dist 常见码
  if (code === 1000 || /password|incorrect|密码/i.test(String(message))) code = 139;
  if (/already exists|已注册|exist/i.test(String(message))) code = 145;
  const known = {
    145: 'Account already exists',
    167: 'Mobile phone number already exists',
    170: 'Account registration with the same IP exceeds the limit',
    46: 'Login failed',
    139: 'Password error',
    1000: 'Password error'
  };
  return fail(code, known[code] || message);
}

function mockUser(account, password) {
  return {
    account,
    password: password || '',
    session: randomToken('sk_'),
    // 官方 username 为数字会员 ID；mock 不用账号名当 nickname
    userId: String(20000000 + Math.floor(Math.random() * 9000000)),
    game_gold: 0,
    currency: 'BRL',
    nickname: '',
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
  const transport = String(cfg.authTransport || 'http').toLowerCase();
  try {
    const existing = users.get(account);
    const stableDevice = (existing && existing.user && existing.user.device_id)
      || defaultDeviceId(account);

    if (transport !== 'ws') {
      const {
        httpLogin,
        httpRegister,
        httpUserBase,
        toLongNumber
      } = require('./http-api');
      const authFn = action === 'register' ? httpRegister : httpLogin;
      const tAuth = Date.now();
      const authRes = await authFn({
        account,
        password,
        packageId: cfg.packageId,
        deviceId: stableDevice,
        inviteCode: pickInvite(data),
        mobile: data.phone || data.mobile || '',
        cfg,
        timeoutMs: cfg.timeoutMs
      });
      const authMs = Date.now() - tAuth;
      const token = String(authRes.token || '');
      const userId = String(authRes.userId != null ? authRes.userId : '');
      if (!token || !userId) {
        return fail(1005, 'http auth missing token/userId');
      }
      let base = null;
      const tBase = Date.now();
      try {
        base = await httpUserBase({ token, cfg, timeoutMs: cfg.timeoutMs });
      } catch (e) {
        console.warn('[provider:wgame] /api/user/base failed:', (e && e.message) || e);
      }
      const baseMs = Date.now() - tBase;
      const user = {
        account,
        password: password || '',
        session: token,
        httpToken: token,
        authTransport: 'http',
        userId,
        game_gold: base ? require('./http-maps').happyToDisplay(base.money) : 0,
        nickname: (base && base.userName) || '',
        phone: (base && base.secPhone) || '',
        email: (base && base.mail) || '',
        vip_level: base && base.vipLevel != null ? Number(base.vipLevel) : 0,
        face_id: base && base.faceId != null ? String(base.faceId) : '',
        device_id: stableDevice,
        account_type: base && base.accountType != null ? Number(base.accountType) : undefined,
        game_score: base ? toLongNumber(base.gameScore, 0) : undefined,
        first_login: base && base.firstLogin,
        has_recharge: base && base.hasRecharge,
        profileAt: Date.now()
      };
      rememberSession(user, cfg);
      users.set(account, { password, user });
      try {
        console.info(
          '[provider:wgame]',
          action,
          'via http',
          'base=' + (cfg.loginHttpBase || ''),
          'packageId=' + (cfg.packageId != null ? cfg.packageId : ''),
          'userId=' + userId,
          'auth=' + authMs + 'ms',
          'profile=' + baseMs + 'ms'
        );
      } catch (_) { /* ignore */ }
      return ok(user, 'ok');
    }

    const res = await wgameAuth({
      action,
      wssUrl: cfg.wssUrl,
      packageId: cfg.packageId,
      timeoutMs: cfg.timeoutMs,
      nGmType: cfg.nGmType,
      account,
      password,
      deviceId: stableDevice,
      inviteCode: pickInvite(data),
      mobile: data.phone || data.mobile || ''
    });
    const user = toCanonicalUser(account, password, res);
    mergePassportIntoUser(user, res);
    user.authTransport = 'ws';
    rememberSession(user, cfg);
    return ok(user, 'ok');
  } catch (err) {
    console.warn('[provider:wgame]', action, 'failed:', (err && err.message) || err);
    const code = err && err.code != null ? Number(err.code) : 0;
    const allowIpFallback =
      action === 'register'
      && code === 170
      && !!cfg.fallbackMockOnIpLimit;
    if (cfg.fallbackMock || allowIpFallback) {
      const user = mockUser(account, password);
      rememberSession(user, cfg);
      users.set(account, { password, user });
      return ok(user, allowIpFallback ? 'ok (ip-limit fallback)' : 'ok');
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
  ensureAuthRealm(cfg);

  if (op === OP.AUTH_REGISTER) {
    if (cfg.mode === 'mock') {
      const account = pickAccount(body) || ('u' + Date.now());
      const password = pickPassword(body) || '123456';
      if (users.has(account) && !body._encrypted) return fail(1001, 'account already exists');
      const user = mockUser(account, password);
      users.set(account, { password, user });
      rememberSession(user, cfg);
      return ok(user, 'ok');
    }
    return callGateway('register', body, cfg);
  }

  if (op === OP.AUTH_LOGIN) {
    if (cfg.mode === 'mock') {
      const account = pickAccount(body) || 'mock_user';
      const password = pickPassword(body);
      const user = mockUser(account, password);
      rememberSession(user, cfg);
      return ok(user, 'ok');
    }
    // 必须打远端登录服：禁止用本地 users/SESSION_STORE 冒充成功
    return callGateway('login', body, cfg);
  }

  if (op === OP.AUTH_CHECK_REGISTER) {
    // 远端是否已注册只有登录服知道；本地 Map 不能当真
    return ok({ exists: false }, 'ok');
  }

  if (op === OP.USER_INFO) {
    const row = findSession(body, headers);
    if (!row || !row.user) return fail(401, 'not logged in');
    const token = require('./http-api').sessionHttpToken(row.user);
    const profileFresh = row.user.profileAt && (Date.now() - Number(row.user.profileAt) < 8000);
    if (token && !profileFresh) {
      try {
        const { httpUserBase, httpMoney, toLongNumber } = require('./http-api');
        const [base, moneyRes] = await Promise.all([
          httpUserBase({ token, cfg, timeoutMs: cfg.timeoutMs }).catch((err) => {
            console.warn('[provider:wgame] user.info base failed:', (err && err.message) || err);
            return null;
          }),
          httpMoney({ token, cfg, timeoutMs: cfg.timeoutMs }).catch(() => null)
        ]);
        if (base) {
          if (base.userName) row.user.nickname = String(base.userName);
          if (base.secPhone) row.user.phone = String(base.secPhone);
          if (base.mail) row.user.email = String(base.mail);
          if (base.vipLevel != null) row.user.vip_level = Number(base.vipLevel) || 0;
          if (base.faceId != null) row.user.face_id = String(base.faceId);
          if (base.money != null) row.user.game_gold = require('./http-maps').happyToDisplay(base.money);
          if (base.gameScore != null) row.user.game_score = toLongNumber(base.gameScore, 0);
        }
        if (moneyRes) {
          row.user.game_gold = require('./http-maps').mapMoney(moneyRes);
        }
        row.user.profileAt = Date.now();
        rememberSession(row.user, cfg);
      } catch (err) {
        console.warn('[provider:wgame] user.info refresh failed:', (err && err.message) || err);
      }
    }
    return ok(row.user, 'ok');
  }

  if (op === OP.USER_VIP || op === OP.USER_AVATARS) {
    const row = findSession(body, headers);
    const routePath = String((ctx && ctx.routePath) || '');
    // vip 等级表可未登录
    const needList = /allVipLevel|vipInfoUnLogin/i.test(routePath);
    if (needList) {
      try {
        const { httpVipList, sessionHttpToken } = require('./http-api');
        const token = (row && row.user) ? sessionHttpToken(row.user) : '';
        const vipRes = await httpVipList({ token, cfg, timeoutMs: cfg.timeoutMs });
        const mapped = require('./http-maps').mapVipDetail(vipRes);
        if (row && row.user) {
          row.user.vip_level = mapped.vip_level;
          rememberSession(row.user, cfg);
          return ok(Object.assign({}, row.user, mapped), 'ok');
        }
        return ok(mapped, 'ok');
      } catch (err) {
        console.warn('[provider:wgame] vipList failed:', (err && err.message) || err);
      }
    }
    if (!row || !row.user) return fail(401, 'not logged in');
    try {
      const { httpVipList, sessionHttpToken } = require('./http-api');
      const token = sessionHttpToken(row.user);
      const vipRes = await httpVipList({ token, cfg, timeoutMs: cfg.timeoutMs });
      const mapped = require('./http-maps').mapVipDetail(vipRes);
      row.user.vip_level = mapped.vip_level;
      rememberSession(row.user, cfg);
      return ok(Object.assign({}, row.user, mapped), 'ok');
    } catch (err) {
      console.warn('[provider:wgame] vipList (authed) failed:', (err && err.message) || err);
      return ok(row.user, 'ok');
    }
  }

  if (op === OP.WALLET_GOLD) {
    const row = findSession(body, headers);
    if (!row || !row.user) return fail(401, 'not logged in');
    const { sessionHttpToken, httpMoney } = require('./http-api');
    const token = sessionHttpToken(row.user);
    if (token) {
      try {
        const moneyRes = await httpMoney({ token, cfg, timeoutMs: cfg.timeoutMs });
        const gold = require('./http-maps').mapMoney(moneyRes);
        row.user.game_gold = gold;
        rememberSession(row.user, cfg);
        return ok({ game_gold: gold }, 'ok');
      } catch (err) {
        console.warn('[provider:wgame] money failed:', (err && err.message) || err);
      }
    }
    const gold = Number(row.user.game_gold || 0);
    return ok({ game_gold: gold }, 'ok');
  }

  if (op === OP.PAY_PENDING) {
    const routePath = String((ctx && ctx.routePath) || '');
    const { getOrder, putOrder, listOrders } = require('./pay-orders');

    // 充值赠送估算：无活动引擎时返回可解析空结构
    if (/calculateGift/i.test(routePath)) {
      return ok({
        payCurrencyAmount: '0',
        memberCurrencyAmount: '0',
        payCurrencyActiveGiftAmount: '0',
        memberCurrencyActiveGiftAmount: '0',
        payCurrencyActiveCouponGiftAmount: '0',
        memberCurrencyActiveCouponGiftAmount: '0',
        matchGiftRes: {
          payCurrency: '',
          moneyList: null,
          chargeRateList: null,
          deduceLimit: '0'
        },
        realAmount: '0',
        recommendMoneyGift: [],
        feeAmount: '0',
        replaceAmount: '0',
        activeRes: {}
      }, 'ok');
    }

    // 充值手续费：零费率
    if (/getPayOrderFee/i.test(routePath)) {
      const amount = body && (body.money != null ? body.money : body.amount);
      return ok({
        fee: 0,
        feeAmount: 0,
        amount: amount != null ? Number(amount) || 0 : 0,
        rate: 0,
        feeRate: 0,
        payFee: 0,
        handlingFee: 0
      }, 'ok');
    }

    // 删除已存支付信息
    if (/delPayInfo/i.test(routePath)) {
      return ok({ success: true, deleted: true }, 'ok');
    }

    // 刷新订单状态（读本地 pay-orders）
    if (/refreshStatus/i.test(routePath)) {
      const orderNo = body && (body.orderNo || body.order_no || body.outTradeNo);
      const row = getOrder(orderNo);
      if (!row) {
        return ok({
          orderNo: orderNo || '',
          status: false,
          success: false,
          paid: false
        }, 'ok');
      }
      const paid = row.status === 'paid' || row.status === true || row.status === 1;
      return ok(Object.assign({}, row, {
        status: paid,
        success: paid,
        paid
      }), 'ok');
    }

    // 转账确认 / 取消 / 俱乐部确认 / 上传凭证：软成功（无独立清算引擎）
    if (/transferConfirm|payConfirm/i.test(routePath)) {
      const orderNo = body && (body.orderNo || body.order_no || body.outTradeNo || body.id);
      const row = orderNo ? getOrder(orderNo) : null;
      if (row) {
        putOrder(Object.assign({}, row, {
          status: 'paid',
          success: true,
          confirmedAt: Math.floor(Date.now() / 1000)
        }));
      }
      return ok({ success: true, orderNo: orderNo || '', status: 'paid' }, 'ok');
    }
    if (/transferCancel|payCancel/i.test(routePath)) {
      const orderNo = body && (body.orderNo || body.order_no || body.outTradeNo || body.id);
      const row = orderNo ? getOrder(orderNo) : null;
      if (row) {
        putOrder(Object.assign({}, row, {
          status: 'cancelled',
          success: false,
          cancelledAt: Math.floor(Date.now() / 1000)
        }));
      }
      return ok({ success: true, orderNo: orderNo || '', status: 'cancelled' }, 'ok');
    }
    if (/uploadpay/i.test(routePath)) {
      return ok({ success: true, uploaded: true }, 'ok');
    }

    // 其它未识别 pay 辅路径：空成功，避免 10060 打断充值页
    if (/\/finance\/pay\//i.test(routePath) || /\/club\/recharge\//i.test(routePath)) {
      return ok({ success: true, list: listOrders().slice(-5) }, 'ok');
    }

    return fail(10060, 'payment adapter pending: ' + routePath);
  }

  if (
    op === OP.PAY_LIST
    || op === OP.PAY_TYPE
    || op === OP.PAY_CHANNELS
    || op === OP.PAY_INFOS
    || op === OP.PAY_CREATE
    || op === OP.PAY_ORDER_INFO
  ) {
    const {
      loadPayConfig,
      buildQrDataUrl,
      mapWgameChannelsToPack,
      mapHttpShopToPack,
      finalizePayChannelPack,
      loadHarPaySnapshot,
      resolvePayTypeMeta,
      buildPayTypeList
    } = require('./pay-config');
    const { putOrder, getOrder, listOrders } = require('./pay-orders');
    const pay = loadPayConfig(ctx && ctx.siteDir, cfg);
    if (!pay.enabled) {
      return fail(10060, 'payment disabled in providerOptions.pay');
    }

    const source = String(pay.source || 'wgame').toLowerCase();
    const sessionRow = findSession(body, headers);
    const sessionUser = sessionRow && sessionRow.user;

    async function wgamePayChannels() {
      const siteDir = ctx && ctx.siteDir;
      const har = loadHarPaySnapshot(siteDir);
      const token = sessionUser && (sessionUser.httpToken || (
        sessionUser.authTransport === 'http' ? sessionUser.session : ''
      ));
      // 优先 HTTP shopItemList（对齐 wgame_web）；无 token 时走 guest
      try {
        const {
          httpShopItemList,
          httpGuestShopItemList
        } = require('./http-api');
        const shop = token
          ? await httpShopItemList({
            token,
            packageId: cfg.packageId,
            cfg,
            timeoutMs: Math.max(Number(cfg.timeoutMs) || 20000, 25000)
          })
          : await httpGuestShopItemList({
            packageId: cfg.packageId,
            cfg,
            timeoutMs: Math.max(Number(cfg.timeoutMs) || 20000, 25000)
          });
        const pack = mapHttpShopToPack(shop, pay, har, siteDir);
        if (pack && pack.list && pack.list.length) {
          try {
            console.info(
              '[provider:wgame] payChannels via http',
              'channels=' + pack.list.length,
              'shopItems=' + (pack._shopItemCount || 0),
              token ? 'authed' : 'guest'
            );
          } catch (_) { /* ignore */ }
          return pack;
        }
      } catch (err) {
        console.warn('[provider:wgame] payChannels http failed:', (err && err.message) || err);
      }
      // 仅在无 HTTP 能力时回退旧 WS（大厅）
      if (!sessionUser || !sessionUser.account || !sessionUser.password) return null;
      const res = await wgameAuth({
        action: 'login',
        account: sessionUser.account,
        password: sessionUser.password,
        wssUrl: cfg.wssUrl,
        packageId: cfg.packageId,
        timeoutMs: Math.max(Number(cfg.timeoutMs) || 20000, 25000),
        nGmType: cfg.nGmType,
        hallAction: 'payChannels',
        deviceId: sessionUser.device_id
      });
      return mapWgameChannelsToPack(
        res && res.payChannels,
        pay,
        har,
        siteDir
      );
    }

    async function wgamePayCharge(amount, channelId) {
      if (!sessionUser || !sessionUser.account || !sessionUser.password) return null;
      return wgameAuth({
        action: 'login',
        account: sessionUser.account,
        password: sessionUser.password,
        wssUrl: cfg.wssUrl,
        packageId: cfg.packageId,
        timeoutMs: Math.max(Number(cfg.timeoutMs) || 20000, 30000),
        nGmType: cfg.nGmType,
        hallAction: 'payCharge',
        deviceId: sessionUser.device_id,
        charge: {
          orderType: 3,
          channelId: channelId != null ? Number(channelId) : 0,
          money: Math.floor(Number(amount) || 0)
        }
      });
    }

    if (op === OP.PAY_LIST) {
      return ok({
        list: pay.categories.slice(),
        cardIDTypeMap: pay.cardIDTypeMap || {}
      }, 'ok');
    }
    if (op === OP.PAY_TYPE) {
      const harSnap = loadHarPaySnapshot(ctx && ctx.siteDir);
      const payMeta = resolvePayTypeMeta(pay, harSnap, ctx && ctx.siteDir);
      if (source === 'wgame') {
        try {
          const pack = await wgamePayChannels();
          if (pack && pack.list && pack.list.length) {
            // 有真实渠道时，用渠道名补 pay_type 展示名
            const firstName = pack.list[0] && (pack.list[0].channlName || pack.list[0].merch_desc);
            const meta = firstName
              ? Object.assign({}, payMeta, { payTypeName: firstName })
              : payMeta;
            return ok({ payKind: { list: buildPayTypeList(meta) } }, 'ok');
          }
        } catch (err) {
          console.warn('[provider:wgame] payType via channels failed:', (err && err.message) || err);
        }
        if (!pay.allowPlaceholderFallback) {
          return fail(10061, 'wgame pay type unavailable (shopItemList failed)');
        }
      }
      const fallback = (harSnap && Array.isArray(harSnap.types) && harSnap.types.length)
        ? harSnap.types.slice()
        : pay.types.slice();
      const list = buildPayTypeList(payMeta).length
        ? buildPayTypeList(payMeta)
        : fallback.map((row) => Object.assign({}, row, {
          pay_type_name: row.pay_type_name || row.name,
          payment_name: row.payment_name || row.name
        }));
      return ok({
        payKind: { list }
      }, 'ok');
    }
    if (op === OP.PAY_CHANNELS) {
      const kind = body && (body.payKind != null ? body.payKind : body.type);
      const key = String(kind != null ? kind : 100);
      const configPack = pay.channelsByPayKind[key]
        || pay.channelsByPayKind['100']
        || { list: [], min: '0', max: '0' };
      if (source === 'wgame') {
        try {
          const pack = await wgamePayChannels();
          if (pack && pack.list && pack.list.length) {
            return ok(finalizePayChannelPack(pack, ctx && ctx.siteDir), 'ok');
          }
        } catch (err) {
          console.warn('[provider:wgame] payChannels failed:', (err && err.message) || err);
        }
        if (!pay.allowPlaceholderFallback) {
          return fail(10061, 'wgame pay channels unavailable (shopItemList failed)');
        }
      }
      const harPack = finalizePayChannelPack(
        Object.assign({ list: [] }, configPack),
        ctx && ctx.siteDir
      );
      return ok(harPack, 'ok');
    }
    if (op === OP.PAY_INFOS) {
      return ok(Array.isArray(pay.payInfos) ? pay.payInfos : [], 'ok');
    }
    if (op === OP.PAY_ORDER_INFO) {
      const orderNo = body && (body.orderNo || body.order_no || body.outTradeNo);
      const row = getOrder(orderNo);
      if (!row) {
        return ok({
          list: listOrders().slice(-20),
          total: listOrders().length,
          orderNo: orderNo || '',
          status: 'unknown',
          success: false
        }, 'ok');
      }
      return ok(Object.assign({}, row, { success: row.status === 'paid' }), 'ok');
    }
    if (op === OP.PAY_CREATE) {
      const co = pay.createOrder || {};
      const amount = body && (body.money != null ? body.money : body.amount);
      const channelId = body && (
        body.channelId != null ? body.channelId
          : (body.paymentid != null ? body.paymentid
            : (body.payplatformid != null ? body.payplatformid : body.paymentMethodId))
      );
      const orderNo = 'WG' + Date.now() + Math.floor(Math.random() * 1000);
      let qrCode = co.qrCodeUrl || '';
      let url = co.payUrl || '';
      let urlOpenWay = co.urlOpenWay != null ? Number(co.urlOpenWay) : 4;
      let remoteOrderNo = '';
      let usedWgame = false;

      if (source === 'wgame') {
        try {
          const res = await wgamePayCharge(amount, channelId);
          const charge = res && res.charge;
          if (charge) {
            usedWgame = true;
            if (Number(charge.nRet) !== 0 && charge.nRet != null) {
              return fail(10064, 'wgame charge ret=' + charge.nRet);
            }
            url = charge.szChargeUrl || url;
            const info = charge.orderInfo || {};
            if (info.qrcode || info.qrCode) qrCode = String(info.qrcode || info.qrCode);
            if (info.orderid || info.orderNo || info.order_no) {
              remoteOrderNo = String(info.orderid || info.orderNo || info.order_no);
            }
            if (qrCode && !url) urlOpenWay = 4;
            else if (url && !qrCode) urlOpenWay = 1;
          }
        } catch (err) {
          console.warn('[provider:wgame] payCharge failed:', (err && err.message) || err);
          if (
            source === 'wgame'
            && !pay.allowPlaceholderFallback
            && String(co.mode || '') !== 'http'
          ) {
            return fail(10061, 'wgame pay create failed: ' + ((err && err.message) || err));
          }
        }
      }

      if (
        source === 'wgame'
        && !usedWgame
        && !pay.allowPlaceholderFallback
        && String(co.mode || '') !== 'http'
        && !co.httpUrl
        && !co.useBuiltinMock
      ) {
        return fail(10061, 'wgame pay create: no charge from hall (need real account or allowPlaceholderFallback)');
      }

      const tryHttpCashier = !usedWgame && (co.httpUrl || co.useBuiltinMock);
      if (tryHttpCashier) {
        try {
          let rd = null;
          const preferBuiltin = co.useBuiltinMock
            || (co.httpUrl && /mock-cashier/i.test(String(co.httpUrl)));
          if (preferBuiltin && co.useBuiltinMock) {
            const { createMockCashierOrder } = require('../../../mock-cashier');
            const mock = createMockCashierOrder(Object.assign({}, body || {}, { amount, money: amount, orderNo }));
            rd = mock && mock.data;
          }
          if (!rd && co.httpUrl) {
            try {
              const remote = await httpJson(
                co.httpUrl,
                co.httpMethod || 'POST',
                Object.assign(buildHttpPayload(body, headers), { amount, money: amount, orderNo })
              );
              rd = remote && typeof remote === 'object'
                ? (remote.data && typeof remote.data === 'object' ? remote.data : remote)
                : null;
            } catch (httpErr) {
              // 本地 mock-cashier URL 失败时内联生成，避免端口漂移导致 ECONNREFUSED
              if (/mock-cashier/i.test(String(co.httpUrl)) || co.useBuiltinMock) {
                console.warn('[provider:wgame] pay httpUrl failed, use builtin mock:', (httpErr && httpErr.message) || httpErr);
                const { createMockCashierOrder } = require('../../../mock-cashier');
                const mock = createMockCashierOrder(Object.assign({}, body || {}, { amount, money: amount, orderNo }));
                rd = mock && mock.data;
              } else {
                throw httpErr;
              }
            }
          }
          if (!rd && co.useBuiltinMock) {
            const { createMockCashierOrder } = require('../../../mock-cashier');
            const mock = createMockCashierOrder(Object.assign({}, body || {}, { amount, money: amount, orderNo }));
            rd = mock && mock.data;
          }
          if (rd && typeof rd === 'object') {
            if (rd.qrCode || rd.qrcode || rd.qrcode_url) {
              qrCode = String(rd.qrCode || rd.qrcode || rd.qrcode_url);
            }
            if (rd.url || rd.payUrl || rd.pay_url) {
              url = String(rd.url || rd.payUrl || rd.pay_url);
            }
            if (rd.urlOpenWay != null) urlOpenWay = Number(rd.urlOpenWay);
            if (rd.orderNo || rd.order_no || rd.outTradeNo) {
              remoteOrderNo = String(rd.orderNo || rd.order_no || rd.outTradeNo);
            }
            usedWgame = false;
          }
        } catch (err) {
          return fail(10061, 'pay http create failed: ' + ((err && err.message) || err));
        }
      }

      if (
        source === 'wgame'
        && !usedWgame
        && !qrCode
        && !url
        && !pay.allowPlaceholderFallback
        && !co.useBuiltinMock
        && !co.httpUrl
      ) {
        return fail(10061, 'wgame pay create: no qr/url from hall or cashier');
      }

      if (!qrCode && !url && pay.allowPlaceholderFallback && co.qrPayload) {
        qrCode = buildQrDataUrl(co.qrPayload) || '';
      }

      const finalOrderNo = remoteOrderNo || orderNo;
      const payload = {
        success: true,
        orderNo: finalOrderNo,
        outTradeNo: finalOrderNo,
        order_no: finalOrderNo,
        qrCode,
        url,
        createTime: Math.floor(Date.now() / 1000),
        orderEffectiveTime: Number(co.orderEffectiveTime) || 900,
        payCurrency: pay.currency || 'BRL',
        currencySign: pay.currencySign || 'R$',
        channlName: (body && (body.channlName || body.merch_desc)) || 'PIX',
        money: amount != null ? String(amount) : '0',
        urlOpenWay,
        status: 'wait'
      };
      putOrder(payload);
      return ok(payload, 'ok');
    }
  }

  if (
    op === OP.AGENT_MODE
    || op === OP.AGENT_PROMOTION
    || op === OP.AGENT_INDEX
    || op === OP.AGENT_TOTAL
    || op === OP.AGENT_PERIOD
    || op === OP.AGENT_COMMISSION
    || op === OP.AGENT_MARQUEE
    || op === OP.AGENT_BIND
    || op === OP.AGENT_DIRECT
    || op === OP.AGENT_CONFIG
  ) {
    const { loadAgentConfig, mapProxyInviteToAgent, enrichAgentFromSession } = require('./agent-config');
    let agent = loadAgentConfig(ctx && ctx.siteDir, cfg);
    if (!agent.enabled) {
      return fail(10060, 'agent disabled in providerOptions.agent');
    }

    // 优先 wgame HTTP 代理统计（对齐 proxyStatistics）
    if (op === OP.AGENT_INDEX || op === OP.AGENT_TOTAL || op === OP.AGENT_PERIOD || op === OP.AGENT_COMMISSION) {
      const row = findSession(body, headers);
      const { sessionHttpToken, httpProxyStatistics } = require('./http-api');
      const token = row && row.user ? sessionHttpToken(row.user) : '';
      if (token) {
        try {
          const res = await httpProxyStatistics({ token, body, cfg, timeoutMs: cfg.timeoutMs });
          const mapped = require('./http-maps').mapProxyStatistics(res);
          console.info('[provider:wgame] agent via http proxyStatistics');
          return ok(mapped, 'ok');
        } catch (err) {
          console.warn('[provider:wgame] proxyStatistics failed:', (err && err.message) || err);
        }
      }
    }

    const keyByOp = {
      [OP.AGENT_MODE]: 'agentMode',
      [OP.AGENT_CONFIG]: 'promoteConfig',
      [OP.AGENT_PROMOTION]: 'agentPromotion',
      [OP.AGENT_INDEX]: 'indexInfo',
      [OP.AGENT_TOTAL]: 'myTotalData',
      [OP.AGENT_PERIOD]: 'myPeriodData',
      [OP.AGENT_COMMISSION]: 'myCommission',
      [OP.AGENT_MARQUEE]: 'commissionMarquee',
      [OP.AGENT_BIND]: 'getIpBindInfo',
      [OP.AGENT_DIRECT]: 'directReport'
    };
    const key = keyByOp[op];
    const route = agent.routes && agent.routes[key];
    const sessionRowEarly = findSession(body, headers);
    const sessionUserEarly = sessionRowEarly && sessionRowEarly.user;
    const agentSource = String(agent.source || 'wgame').toLowerCase();
    const isDevMockHttp = !!(agent.httpBase && /\/api\/dev\/mock-agent/i.test(String(agent.httpBase)));

    async function resolveWgameAgentViaInvite() {
      if (agentSource !== 'wgame') return null;
      if (!(op === OP.AGENT_INDEX || op === OP.AGENT_TOTAL || op === OP.AGENT_PROMOTION)) return null;
      if (!sessionUserEarly || !sessionUserEarly.account || !sessionUserEarly.password) return null;
      try {
        const res = await wgameAuth({
          action: 'login',
          account: sessionUserEarly.account,
          password: sessionUserEarly.password,
          wssUrl: cfg.wssUrl,
          packageId: cfg.packageId,
          timeoutMs: Math.max(Number(cfg.timeoutMs) || 20000, 25000),
          nGmType: cfg.nGmType,
          hallAction: 'proxyInvite',
          deviceId: sessionUserEarly.device_id
        });
        if (res && res.proxyInvite) {
          let mapped = mapProxyInviteToAgent(res.proxyInvite, agent);
          mapped = enrichAgentFromSession(mapped, sessionUserEarly, ctx && ctx.siteDir);
          if (op === OP.AGENT_PROMOTION) return ok(mapped.agentPromotion, 'ok');
          if (op === OP.AGENT_INDEX) return ok(mapped.indexInfo, 'ok');
          if (op === OP.AGENT_TOTAL) return ok(mapped.myTotalData, 'ok');
        }
      } catch (err) {
        console.warn('[provider:wgame] proxyInvite failed:', (err && err.message) || err);
      }
      return null;
    }

    if (isDevMockHttp) {
      const wgameRsp = await resolveWgameAgentViaInvite();
      if (wgameRsp) return wgameRsp;
    }

    if (route && (agent.useBuiltinMock || agent.httpBase)) {
      if (agent.useBuiltinMock && !agent.httpBase) {
        const { createMockAgentResponse } = require('../../../mock-agent-api');
        const mock = createMockAgentResponse(route, body || {});
        let data = mock && mock.data;
        if (data != null) {
          const sessionRow = findSession(body, headers);
          const sessionUser = sessionRow && sessionRow.user;
          if (
            sessionUser
            && (op === OP.AGENT_PROMOTION || op === OP.AGENT_INDEX || op === OP.AGENT_TOTAL)
          ) {
            const enriched = enrichAgentFromSession(agent, sessionUser, ctx && ctx.siteDir);
            if (op === OP.AGENT_PROMOTION) data = enriched.agentPromotion;
            else if (op === OP.AGENT_INDEX) data = enriched.indexInfo;
            else if (op === OP.AGENT_TOTAL) data = enriched.myTotalData;
          }
          return ok(data, 'ok');
        }
      } else if (agent.httpBase) {
        try {
          const url = String(agent.httpBase).replace(/\/$/, '') + String(route);
          const remote = await httpJson(url, agent.httpMethod || 'POST', buildHttpPayload(body, headers));
          let rd = remote && typeof remote === 'object'
            ? (remote.data != null ? remote.data : remote)
            : null;
          if (rd != null) {
            const sessionRow = findSession(body, headers);
            const sessionUser = sessionRow && sessionRow.user;
            if (
              sessionUser
              && (op === OP.AGENT_PROMOTION || op === OP.AGENT_INDEX || op === OP.AGENT_TOTAL)
            ) {
              const enriched = enrichAgentFromSession(
                Object.assign({}, agent, {
                  agentPromotion: op === OP.AGENT_PROMOTION ? rd : agent.agentPromotion,
                  indexInfo: op === OP.AGENT_INDEX ? rd : agent.indexInfo,
                  myTotalData: op === OP.AGENT_TOTAL ? rd : agent.myTotalData
                }),
                sessionUser,
                ctx && ctx.siteDir
              );
              if (op === OP.AGENT_PROMOTION) rd = enriched.agentPromotion;
              else if (op === OP.AGENT_INDEX) rd = enriched.indexInfo;
              else if (op === OP.AGENT_TOTAL) rd = enriched.myTotalData;
            }
            return ok(rd, 'ok');
          }
        } catch (err) {
          return fail(10062, 'agent http failed: ' + ((err && err.message) || err));
        }
      }
    }

    if (
      !isDevMockHttp
      && agentSource === 'wgame'
      && (op === OP.AGENT_INDEX || op === OP.AGENT_TOTAL || op === OP.AGENT_PROMOTION)
    ) {
      const wgameRsp = await resolveWgameAgentViaInvite();
      if (wgameRsp) return wgameRsp;
    }

    const sessionRow = sessionRowEarly;
    const sessionUser = sessionUserEarly;
    if (
      sessionUser
      && (op === OP.AGENT_PROMOTION || op === OP.AGENT_INDEX || op === OP.AGENT_TOTAL)
    ) {
      agent = enrichAgentFromSession(agent, sessionUser, ctx && ctx.siteDir);
    }

    if (op === OP.AGENT_MODE) return ok(agent.agentMode, 'ok');
    if (op === OP.AGENT_CONFIG) return ok(agent.promoteConfig, 'ok');
    if (op === OP.AGENT_PROMOTION) return ok(agent.agentPromotion, 'ok');
    if (op === OP.AGENT_INDEX) return ok(agent.indexInfo, 'ok');
    if (op === OP.AGENT_TOTAL) return ok(agent.myTotalData, 'ok');
    if (op === OP.AGENT_PERIOD) return ok(agent.myPeriodData, 'ok');
    if (op === OP.AGENT_COMMISSION) return ok(agent.myCommission, 'ok');
    if (op === OP.AGENT_MARQUEE) {
      return ok(
        Array.isArray(agent.commissionMarquee) ? agent.commissionMarquee : [],
        'ok'
      );
    }
    if (op === OP.AGENT_BIND) return ok(agent.getIpBindInfo, 'ok');
    if (op === OP.AGENT_DIRECT) return ok(agent.directReport, 'ok');
  }

  if (op === OP.WITHDRAW_PENDING) {
    const routePath = String((ctx && ctx.routePath) || '');
    const row = findSession(body, headers);
    const { sessionHttpToken } = require('./http-api');
    const token = row && row.user ? sessionHttpToken(row.user) : '';
    const maps = require('./http-maps');

    // Conta / 提现信息：withdrawInfoV2|V3 → enableWithdraw + 通道 + 已绑收款账户
    if (/withdrawInfoV?\d*/i.test(routePath)) {
      if (!token) return fail(401, 'not logged in');
      try {
        const {
          httpEnableWithdraw,
          httpDrawChannelCode,
          httpPaywayList,
          httpVipList
        } = require('./http-api');
        const [enableRes, chRes, paywayRes, vipRes] = await Promise.all([
          httpEnableWithdraw({ token, cfg, timeoutMs: cfg.timeoutMs }),
          httpDrawChannelCode({ token, cfg, timeoutMs: cfg.timeoutMs }).catch(() => null),
          httpPaywayList({ token, cfg, timeoutMs: cfg.timeoutMs }).catch(() => null),
          httpVipList({ token, cfg, timeoutMs: cfg.timeoutMs }).catch(() => null)
        ]);
        return ok(maps.mapWithdrawInfo({ enableRes, chRes, paywayRes, vipRes }), 'ok');
      } catch (err) {
        console.warn('[provider:wgame] withdrawInfo http failed:', (err && err.message) || err);
        return fail(10061, 'withdraw info failed: ' + ((err && err.message) || err));
      }
    }

    // 提现设置 / 可提金额
    if (/withdrawSetting/i.test(routePath) || /getWithdrawFee|WithdrawAccountRules/i.test(routePath)) {
      // 这个 GET 用 staticOnly，登录后也不带会员 token。没会话时回可渲染空设置，避免 401 重试打满
      if (!token) {
        return ok({
          minAmount: 0,
          maxAmount: 0,
          fee: 0,
          feeRate: 0,
          enableWithdraw: 0,
          channels: [],
          list: [],
          bankInfo: [],
          bankInfoV2: { BRL: [] },
          betTaskDisplayToggle: 0,
          showWithdrawAccountSwitch: 1,
          withdrawAccountValidationRule: []
        }, 'ok');
      }
      try {
        const {
          httpEnableWithdraw,
          httpDrawChannelCode,
          httpVipList
        } = require('./http-api');
        const [enableRes, chRes, vipRes] = await Promise.all([
          httpEnableWithdraw({ token, cfg, timeoutMs: cfg.timeoutMs }),
          httpDrawChannelCode({ token, cfg, timeoutMs: cfg.timeoutMs }).catch(() => null),
          httpVipList({ token, cfg, timeoutMs: cfg.timeoutMs }).catch(() => null)
        ]);
        const setting = maps.mapEnableWithdraw(enableRes);
        const channels = maps.mapDrawChannels(chRes);
        const vip = vipRes ? maps.mapVipDetail(vipRes) : null;
        if (vip && vip.VipSettings && vip.VipSettings.length) {
          const cur = vip.VipSettings.find((x) => x.vip === vip.vip_level) || vip.VipSettings[0];
          if (cur) {
            if (cur.minWithdrawMoney) setting.minAmount = cur.minWithdrawMoney;
            if (cur.maxWithdrawMoney) setting.maxAmount = cur.maxWithdrawMoney;
            if (cur.withdrawFee != null) setting.feeRate = cur.withdrawFee;
            setting.withdrawTimes = cur.withdrawTimes;
          }
        }
        setting.channels = channels;
        setting.list = channels;
        if (/getWithdrawFeeSetting$/i.test(routePath)) {
          return ok({
            exemptWithdrawFeeTime: 0,
            todayExemptWithdrawFeeTime: 0,
            fee: setting.fee || 0,
            feeRate: setting.feeRate || 0
          }, 'ok');
        }
        if (/withdrawSetting/i.test(routePath)) {
          setting.bankInfo = Array.isArray(setting.bankInfo) ? setting.bankInfo : [];
          setting.bankInfoV2 = setting.bankInfoV2 && typeof setting.bankInfoV2 === 'object'
            ? setting.bankInfoV2
            : { BRL: [] };
          if (setting.betTaskDisplayToggle == null) setting.betTaskDisplayToggle = 0;
          if (setting.showWithdrawAccountSwitch == null) setting.showWithdrawAccountSwitch = 1;
          if (!Array.isArray(setting.withdrawAccountValidationRule)) setting.withdrawAccountValidationRule = [];
        }
        return ok(setting, 'ok');
      } catch (err) {
        console.warn('[provider:wgame] withdrawSetting http failed:', (err && err.message) || err);
        return fail(10061, 'withdraw setting failed: ' + ((err && err.message) || err));
      }
    }

    // 发起提现
    if (/\/withdrawV?\d*$/i.test(routePath) || /\/cashV3$/i.test(routePath)) {
      if (!token) return fail(401, 'not logged in');
      try {
        const { httpDrawBackMoney } = require('./http-api');
        const money = body && (body.money != null ? body.money : (body.amount != null ? body.amount : body.gold));
        const payWay = body && (body.payWay != null ? body.payWay : (body.pay_way != null ? body.pay_way : body.type));
        const id = body && (body.id != null ? body.id : (body.payWayId != null ? body.payWayId : body.accountId));
        const res = await httpDrawBackMoney({
          token,
          money,
          payWay,
          id,
          cfg,
          timeoutMs: cfg.timeoutMs
        });
        if (res && Number(res.ret) !== 0) {
          return fail(10064, 'withdraw ret=' + res.ret);
        }
        return ok({ success: true, ret: 0 }, 'ok');
      } catch (err) {
        console.warn('[provider:wgame] drawBackMoney failed:', (err && err.message) || err);
        return fail(10061, 'withdraw failed: ' + ((err && err.message) || err));
      }
    }

    // 绑定收款方式
    if (/bindWithdrawAccount|bindcard|bindCrypto|setPayWay|bindalipay|bindAli/i.test(routePath)) {
      if (!token) return fail(401, 'not logged in');
      try {
        const { httpSetPayWay } = require('./http-api');
        const res = await httpSetPayWay({ token, payload: body, cfg, timeoutMs: cfg.timeoutMs });
        if (res && Number(res.res) !== 0) {
          return fail(10064, 'setPayWay res=' + res.res);
        }
        return ok({ success: true, payWay: res && res.payWay }, 'ok');
      } catch (err) {
        console.warn('[provider:wgame] setPayWay failed:', (err && err.message) || err);
        return fail(10061, 'bind withdraw account failed: ' + ((err && err.message) || err));
      }
    }

    // 提现/支付密码：大厅 verifyWithdrawPass / modifyWithdrawPass → wgame HTTP
    if (/setWithdrawPwd|verifyWithdrawPwd|withdrawPwd|verifyWithdrawPass|modifyWithdrawPass|verifyWithdrawalPassword/i.test(routePath)) {
      if (!token) return fail(401, 'not logged in');
      try {
        const { httpSetWithdrawPwd, httpVerifyWithdrawPwd } = require('./http-api');
        const pwd = body && (
          body.withdraw_pass
          || body.withdrawPass
          || body.password
          || body.pwd
          || body.withdrawPwd
          || body.passwd
        );
        const second = (body && body.secondVerify) || {};
        const checkCode = body && (
          body.checkCode
          || body.loginPassword
          || body.login_pass
          || second.login_pass
          || second.loginPass
          || second.password
          || second.passwd
        );
        if (/verifyWithdrawPass|verifyWithdrawPwd|verifyWithdrawalPassword/i.test(routePath) && !/modify/i.test(routePath)) {
          // 首次设置支付密码：大厅会先打 verify，再 modify；账号尚无密码时 wgame 会回 res=1
          const alreadySet = !!(row && row.user && (
            row.user.hasWithdrawPasswd
            || (row.user.permissionOpt && row.user.permissionOpt.hasWithdrawPasswd)
          ));
          if (!alreadySet) {
            return ok({ success: true, skipped: true }, 'ok');
          }
          const res = await httpVerifyWithdrawPwd({ token, password: pwd, cfg, timeoutMs: cfg.timeoutMs });
          // wgame: res===0 成功；res===1 密码错误
          if (res && Number(res.res) !== 0) {
            return fail(10064, 'verifyWithdrawPwd res=' + res.res);
          }
          return ok({ success: true }, 'ok');
        }
        const res = await httpSetWithdrawPwd({
          token,
          password: pwd,
          checkType: body && (body.checkType != null ? body.checkType : second.checkType),
          checkCode,
          cfg,
          timeoutMs: cfg.timeoutMs
        });
        if (res && Number(res.res) !== 0) return fail(10064, 'setWithdrawPwd res=' + res.res);
        // 会话标记已设支付密码，供后续 user.info / permissionOpt 使用
        if (row && row.user) {
          row.user.hasWithdrawPasswd = true;
          if (!row.user.permissionOpt) row.user.permissionOpt = {};
          row.user.permissionOpt.hasWithdrawPasswd = true;
        }
        return ok({ success: true }, 'ok');
      } catch (err) {
        return fail(10061, 'withdraw pwd failed: ' + ((err && err.message) || err));
      }
    }

    return fail(10060, 'withdraw route not mapped: ' + routePath);
  }

  if (op === OP.GAME_LAUNCH) {
    const { loadGameConfig, resolveGameLaunch } = require('./game-config');
    const game = loadGameConfig(ctx && ctx.siteDir, cfg);
    if (!game.enabled) {
      return fail(10060, 'game launch disabled in providerOptions.game');
    }
    const sessionRow = findSession(body, headers, { requireHallResume: true });
    const sessionUser = sessionRow && sessionRow.user;
    if (!sessionUser || !canLaunchGame(sessionUser)) {
      return fail(10061, 'session expired for game launch, please logout and login again');
    }
    try {
      const data = await resolveGameLaunch(body || {}, sessionUser, game, ctx && ctx.siteDir);
      if (!data || !data.game_url) {
        return fail(10061, 'no game mapping for platformId=' + (body.platfromid || body.platformId));
      }
      return ok(data, 'ok');
    } catch (err) {
      let msg = (err && err.message) || 'game launch failed';
      if (/login error 46/i.test(msg)) {
        msg = 'account already online, please logout and login again before launching game';
      }
      console.warn('[provider:wgame] game launch failed:', msg);
      return fail(10061, msg);
    }
  }

  if (op === OP.AUTH_LOGOUT) {
    clearSession(body, headers);
    return ok({ loggedOut: true }, 'ok');
  }

  if (op === OP.LOBBY_OK) {
    const routePath = ctx && ctx.routePath;
    if (routePath && /^\/api\/platform\//i.test(routePath)) {
      const { buildPlatformResponse } = require('./platform-config');
      const { loadAdapterConfig } = require('../../config');
      const adapterCfg = loadAdapterConfig(ctx && ctx.siteDir, fs, path);
      return ok(buildPlatformResponse(routePath, ctx && ctx.siteDir, adapterCfg), 'ok');
    }
    // 充值选银行：空列表即可
    if (routePath && /getPayChooseBank/i.test(String(routePath))) {
      return ok({ list: [], banks: [], records: [] }, 'ok');
    }
    // 注册成功弹窗等已由专用 adapter 处理；默认空对象
    if (routePath && /registerPopupDlgInfo/i.test(String(routePath))) {
      // fall through — adapter registerPopup 读 provider data；若到此说明未走专用分支
    }
    return ok({}, 'ok');
  }

  if (op === OP.EMPTY_RECORDS) {
    const routePath = String((ctx && ctx.routePath) || '');
    const row = findSession(body, headers);
    const { sessionHttpToken } = require('./http-api');
    const token = row && row.user ? sessionHttpToken(row.user) : '';
    const maps = require('./http-maps');

    // 充值/提现流水 → HTTP
    if (token && /pay\/orderList|chargeRecord|finance\/pay\/order/i.test(routePath)) {
      try {
        const { httpChargeRecord } = require('./http-api');
        const res = await httpChargeRecord({ token, body, cfg, timeoutMs: cfg.timeoutMs });
        return ok(maps.mapChargeRecords(res), 'ok');
      } catch (err) {
        console.warn('[provider:wgame] chargeRecord failed:', (err && err.message) || err);
      }
    }
    if (token && /withdrawRecord|withdrawRecords|claim\/withdrawRecord/i.test(routePath)) {
      try {
        const { httpWithdrawRecord } = require('./http-api');
        const res = await httpWithdrawRecord({ token, body, cfg, timeoutMs: cfg.timeoutMs });
        return ok(maps.mapWithdrawRecords(res), 'ok');
      } catch (err) {
        console.warn('[provider:wgame] withdrawRecord failed:', (err && err.message) || err);
      }
    }
    if (token && /getWithdrawAccount|withdrawAccountList|getUserBankCardList/i.test(routePath)) {
      try {
        const { httpPaywayList } = require('./http-api');
        const res = await httpPaywayList({ token, cfg, timeoutMs: cfg.timeoutMs });
        const list = maps.mapPayways(res);
        return ok({ list, records: list, rows: list, total: list.length }, 'ok');
      } catch (err) {
        console.warn('[provider:wgame] paywayList failed:', (err && err.message) || err);
      }
    }

    // 代理统计/下级列表 → HTTP
    if (token && /\/agent\/promote\//i.test(routePath)) {
      try {
        if (/indexInfo|myTotalData|myPeriodData|agentBasic|agentInfo|indexDirect/i.test(routePath)) {
          const { httpProxyStatistics } = require('./http-api');
          const res = await httpProxyStatistics({ token, body, cfg, timeoutMs: cfg.timeoutMs });
          return ok(maps.mapProxyStatistics(res), 'ok');
        }
        if (/memberInfo|directReport|teamData|userAgentMode/i.test(routePath)) {
          const { httpProxyUserList } = require('./http-api');
          const res = await httpProxyUserList({ token, cfg, timeoutMs: cfg.timeoutMs });
          const list = (res && (res.item || res.items)) || [];
          const rows = Array.isArray(list) ? list : [];
          return ok({ list: rows, records: rows, rows, total: rows.length }, 'ok');
        }
        if (/settleTime|proxySubBetConfig|myCommission/i.test(routePath)) {
          const { httpProxySubBetConfig } = require('./http-api');
          const res = await httpProxySubBetConfig({ token, cfg, timeoutMs: cfg.timeoutMs });
          const list = (res && (res.item || res.items)) || [];
          return ok({ list: Array.isArray(list) ? list : [], total: 0, settleTime: Date.now() }, 'ok');
        }
      } catch (err) {
        console.warn('[provider:wgame] agent http failed:', (err && err.message) || err);
      }

      const {
        loadAgentConfig,
        resolveAgentExtraRoute,
        emptyAgentListData
      } = require('./agent-config');
      const agent = loadAgentConfig(ctx && ctx.siteDir, cfg);
      const extra = resolveAgentExtraRoute(routePath, agent);
      if (extra && (agent.httpBase || agent.useBuiltinMock)) {
        if (agent.httpBase) {
          try {
            const url = String(agent.httpBase).replace(/\/$/, '') + extra.route;
            const remote = await httpJson(url, agent.httpMethod || 'POST', buildHttpPayload(body, headers));
            const rd = remote && typeof remote === 'object'
              ? (remote.data != null ? remote.data : remote)
              : emptyAgentListData(extra.key);
            return ok(rd, 'ok');
          } catch (err) {
            console.warn('[provider:wgame] agent extra http failed:', (err && err.message) || err);
          }
        } else if (agent.useBuiltinMock) {
          const { createMockAgentResponse } = require('../../../mock-agent-api');
          const mock = createMockAgentResponse(extra.route, body || {});
          if (mock && mock.data != null) return ok(mock.data, 'ok');
        }
      }
    }
    return ok({ list: [], total: 0, records: [], rows: [] }, 'ok');
  }

  if (op === OP.FEATURE_PENDING) {
    return fail(10060, 'feature adapter pending: wgame has no this capability');
  }

  return fail(404, 'unknown op: ' + op);
}

function clearSession(body, headers) {
  const row = findSession(body, headers);
  if (!row || !row.user) return;
  const u = row.user;
  if (u.account) users.delete(u.account);
  const keys = [];
  if (u.account) keys.push(u.account);
  if (u.userId) keys.push('uid:' + u.userId);
  if (u.session) keys.push('sk:' + u.session);
  for (const k of keys) sessions.delete(k);
  persistSessions();
}

module.exports = {
  id: 'wgame',
  execute,
  sessions,
  users,
  normalizeBody,
  loadWgameConfig,
  clearLocalAuth: clearAllLocalAuth,
  isOurSession,
  isMockSession,
  CATALOG: require('./catalog').CATALOG
};
