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
const https = require('https');
const http = require('http');

const users = new Map();
const sessions = new Map();
const SESSION_STORE = path.join(os.tmpdir(), 'site-downloader-wgame-sessions.json');

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
  // 大厅真实 accountType（有才带；不硬编码）
  if (res.accountType != null) out.account_type = Number(res.accountType);
  else if (res.hall && res.hall.accountType != null) out.account_type = Number(res.hall.accountType);
  return out;
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
  const code = err && err.code != null ? Number(err.code) : 1005;
  const known = {
    145: 'Account already exists',
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
    const code = err && err.code != null ? Number(err.code) : 0;
    const allowIpFallback =
      action === 'register'
      && code === 170
      && !!cfg.fallbackMockOnIpLimit;
    if (cfg.fallbackMock || allowIpFallback) {
      const user = mockUser(account, password);
      rememberSession(user);
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
    const account = pickAccount(body);
    const password = pickPassword(body);
    const local = account && users.get(account);
    if (local && local.user && String(local.password || '') === String(password || '')) {
      rememberSession(local.user);
      return ok(local.user, 'ok (local session)');
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

  if (op === OP.USER_VIP || op === OP.USER_AVATARS) {
    const row = findSession(body, headers);
    if (!row || !row.user) return fail(401, 'not logged in');
    return ok(row.user, 'ok');
  }

  if (op === OP.WALLET_GOLD) {
    const row = findSession(body, headers);
    if (!row || !row.user) return fail(401, 'not logged in');
    const gold = Number(row.user.game_gold || 0);
    return ok({ game_gold: gold }, 'ok');
  }

  if (op === OP.PAY_PENDING) {
    return fail(10060, 'payment adapter pending: wgame has no pay channel');
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
        loadHarPaySnapshot(ctx && ctx.siteDir),
        ctx && ctx.siteDir
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
            return ok({ payKind: { list: buildPayTypeList(payMeta) } }, 'ok');
          }
        } catch (err) {
          console.warn('[provider:wgame] payType via channels failed:', (err && err.message) || err);
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
      const harPack = finalizePayChannelPack(
        Object.assign({ list: [] }, configPack),
        ctx && ctx.siteDir
      );
      if (source === 'wgame') {
        try {
          const pack = await wgamePayChannels();
          if (pack && pack.list && pack.list.length) {
            return ok(finalizePayChannelPack(pack, ctx && ctx.siteDir), 'ok');
          }
        } catch (err) {
          console.warn('[provider:wgame] payChannels failed:', (err && err.message) || err);
        }
      }
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
          if (co.useBuiltinMock) {
            const { createMockCashierOrder } = require('../../../mock-cashier');
            const mock = createMockCashierOrder(Object.assign({}, body || {}, { amount, money: amount, orderNo }));
            rd = mock && mock.data;
          }
          if (!rd && co.httpUrl) {
            const remote = await httpJson(
              co.httpUrl,
              co.httpMethod || 'POST',
              Object.assign(buildHttpPayload(body, headers), { amount, money: amount, orderNo })
            );
            rd = remote && typeof remote === 'object'
              ? (remote.data && typeof remote.data === 'object' ? remote.data : remote)
              : null;
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
    return fail(10060, 'withdraw adapter pending: wgame has no withdraw channel');
  }

  if (op === OP.GAME_LAUNCH) {
    const { loadGameConfig, buildGameLaunchData } = require('./game-config');
    const game = loadGameConfig(ctx && ctx.siteDir, cfg);
    if (!game.enabled) {
      return fail(10060, 'game launch disabled in providerOptions.game');
    }
    const sessionRow = findSession(body, headers);
    const sessionUser = sessionRow && sessionRow.user;
    if (!sessionUser) return fail(401, 'not logged in');
    const data = buildGameLaunchData(body || {}, sessionUser, game, ctx && ctx.siteDir);
    if (!data || !data.game_url) {
      return fail(10061, 'no game mapping for platformId=' + (body.platfromid || body.platformId));
    }
    return ok(data, 'ok');
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
    return ok({}, 'ok');
  }

  if (op === OP.EMPTY_RECORDS) {
    const routePath = ctx && ctx.routePath;
    if (routePath && /\/agent\/promote\//i.test(routePath)) {
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
  isOurSession,
  isMockSession,
  CATALOG: require('./catalog').CATALOG
};
