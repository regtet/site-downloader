/**
 * 对齐 wgame_web：HTTP + protobuf（/api/login、/api/game/forward 等）
 * 用 protobufjs 加载同级 wgame_web 的 .proto（避免 require 巨型 proto.js 在 Node 22 下 ESM 冲突）
 */
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const protobuf = require('protobufjs');
const { applySystemProxy } = require('../../../system-proxy');
const { resolveWgameWebRoot, loadWgameWebConfig } = require('./wgame-web-config');

applySystemProxy({ log: false });

let protoRootCache = null;
let protoRootWebKey = '';

function clearProtoCache() {
  protoRootCache = null;
  protoRootWebKey = '';
}

function loadProtoRoot() {
  const webRoot = resolveWgameWebRoot();
  if (!webRoot) {
    throw new Error('wgame_web not found (expected sibling ../wgame_web)');
  }
  const webKey = path.resolve(webRoot);
  if (protoRootCache && protoRootWebKey === webKey) return protoRootCache;
  protoRootCache = null;
  protoRootWebKey = webKey;
  const protoDir = path.join(webRoot, 'src', 'proto');
  const root = new protobuf.Root();
  root.resolvePath = (origin, target) => {
    const t = String(target || '').replace(/\\/g, '/');
    if (t.indexOf('google/') === 0 || t.indexOf('/google/') >= 0) {
      const rel = t.includes('google/') ? t.slice(t.indexOf('google/')) : t;
      return path.join(protoDir, rel);
    }
    return path.join(protoDir, path.basename(t));
  };
  root.loadSync([path.join(protoDir, 'cmd_http.proto')]);

  const pick = (name) => root.lookupType(name);
  protoRootCache = {
    cmd_http: {
      CommonResponse: pick('cmd_http.CommonResponse'),
      TCmd_LoginRequest: pick('cmd_http.TCmd_LoginRequest'),
      TCmd_LoginResponse: pick('cmd_http.TCmd_LoginResponse'),
      TCmd_RegisterRequest: pick('cmd_http.TCmd_RegisterRequest'),
      TCmd_RegisterResponse: pick('cmd_http.TCmd_RegisterResponse'),
      TCmd_GameRequest: pick('cmd_http.TCmd_GameRequest'),
      TCmd_GameResponse: pick('cmd_http.TCmd_GameResponse'),
      TCmd_UserBaseRes: pick('cmd_http.TCmd_UserBaseRes'),
      TCmd_ShopItemReq: pick('cmd_http.TCmd_ShopItemReq'),
      TCmd_ShopItemList: pick('cmd_http.TCmd_ShopItemList')
    },
    _root: root
  };
  return protoRootCache;
}

function md5Hex(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}

function passwordMd5(plain) {
  return md5Hex(String(plain || ''));
}

function randomNonce(bytes = 16) {
  return crypto.randomBytes(bytes).toString('hex');
}

function deriveLoginHttpBase(wssUrl) {
  if (!wssUrl) return '';
  try {
    const u = new URL(String(wssUrl).replace(/^ws/i, 'http'));
    let host = u.hostname;
    if (/^server\./i.test(host)) host = host.replace(/^server\./i, 'login.');
    else if (!/^login\./i.test(host)) host = 'login.' + host;
    return `https://${host}`;
  } catch (_) {
    return '';
  }
}

function resolveLoginHttpBase(cfg) {
  if (cfg && cfg.loginHttpBase) return String(cfg.loginHttpBase).replace(/\/$/, '');
  if (process.env.WGAME_LOGIN_HTTP_BASE) {
    return String(process.env.WGAME_LOGIN_HTTP_BASE).replace(/\/$/, '');
  }
  const web = loadWgameWebConfig();
  if (web && web.loginHttpBase) return String(web.loginHttpBase).replace(/\/$/, '');
  return deriveLoginHttpBase((cfg && cfg.wssUrl) || (web && web.wssUrl) || '');
}

function resolveHttpSignSecret(cfg) {
  if (cfg && cfg.httpSignSecret) return String(cfg.httpSignSecret);
  if (process.env.WGAME_HTTP_SIGN_SECRET) return String(process.env.WGAME_HTTP_SIGN_SECRET);
  const web = loadWgameWebConfig();
  return (web && web.httpSignSecret) || '';
}

function encodeProto(Type, payload) {
  const msg = Type.create(payload || {});
  return Buffer.from(Type.encode(msg).finish());
}

function decodeCommon(bytes) {
  const root = loadProtoRoot();
  const CommonResponse = root.cmd_http.CommonResponse;
  return CommonResponse.decode(Buffer.from(bytes));
}

function decodeAny(common, Type) {
  if (!common || Number(common.code) !== 200) {
    const err = new Error((common && common.message) || 'request failed');
    err.code = common && common.code;
    err.response = common;
    throw err;
  }
  if (!common.data || !common.data.value || !common.data.value.length) return null;
  return Type.decode(Buffer.from(common.data.value));
}

async function postProto(urlPath, TypeReq, payload, TypeRes, opts) {
  const base = resolveLoginHttpBase(opts && opts.cfg);
  if (!base) throw new Error('login HTTP base missing (derive from wssUrl → login.*)');
  const secret = resolveHttpSignSecret(opts && opts.cfg);
  const body = encodeProto(TypeReq, payload);
  const timestamp = Date.now().toString();
  const nonce = randomNonce(16);
  const signature = md5Hex(Buffer.concat([
    Buffer.from(timestamp),
    Buffer.from(nonce),
    body,
    Buffer.from(secret)
  ]));
  const headers = {
    'Content-Type': 'application/x-protobuf',
    Accept: 'application/x-protobuf',
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature
  };
  const token = opts && opts.token;
  if (token) {
    headers.Authorization = /^Bearer\s+/i.test(token) ? token : ('Bearer ' + token);
  }
  const res = await axios.post(base + urlPath, body, {
    headers,
    timeout: (opts && opts.timeoutMs) || 30000,
    responseType: 'arraybuffer',
    validateStatus: () => true,
    httpsAgent: undefined
  });
  if (res.status >= 400) {
    const err = new Error('HTTP ' + res.status + ' ' + urlPath);
    err.httpStatus = res.status;
    throw err;
  }
  const common = decodeCommon(res.data);
  return decodeAny(common, TypeRes);
}

function defaultDeviceId(account) {
  return md5Hex('sd-' + String(account || 'device')).slice(0, 32);
}

async function httpLogin({ account, password, packageId, deviceId, inviteCode, cfg, timeoutMs }) {
  const root = loadProtoRoot();
  const TypeReq = root.cmd_http.TCmd_LoginRequest;
  const TypeRes = root.cmd_http.TCmd_LoginResponse;
  return postProto('/api/login', TypeReq, {
    account: String(account || ''),
    password: passwordMd5(password),
    deviceId: deviceId || defaultDeviceId(account),
    gmType: 7,
    lgType: 4,
    packageId: Number(packageId) || 0,
    loginUrl: '',
    inviteCode: inviteCode != null ? String(inviteCode) : '',
    codeType: 1
  }, TypeRes, { cfg, timeoutMs });
}

async function httpRegister({
  account, password, packageId, deviceId, inviteCode, mobile, checkCode, cfg, timeoutMs
}) {
  const root = loadProtoRoot();
  const TypeReq = root.cmd_http.TCmd_RegisterRequest;
  const TypeRes = root.cmd_http.TCmd_RegisterResponse;
  return postProto('/api/register', TypeReq, {
    account: String(account || ''),
    password: passwordMd5(password),
    deviceId: deviceId || defaultDeviceId(account),
    gmType: 7,
    lgType: 4,
    packageId: Number(packageId) || 0,
    checkCode: Number(checkCode) || 0,
    mobile: mobile || '',
    loginUrl: '',
    inviteCode: inviteCode != null ? String(inviteCode) : '',
    codeType: 1
  }, TypeRes, { cfg, timeoutMs });
}

async function httpUserBase({ token, cfg, timeoutMs }) {
  const root = loadProtoRoot();
  const TypeRes = root.cmd_http.TCmd_UserBaseRes;
  const base = resolveLoginHttpBase(cfg);
  if (!base) throw new Error('login HTTP base missing');
  const secret = resolveHttpSignSecret(cfg);
  const body = Buffer.alloc(0);
  const timestamp = Date.now().toString();
  const nonce = randomNonce(16);
  const signature = md5Hex(Buffer.concat([
    Buffer.from(timestamp),
    Buffer.from(nonce),
    body,
    Buffer.from(secret)
  ]));
  const res = await axios.post(base + '/api/user/base', body, {
    headers: {
      'Content-Type': 'application/x-protobuf',
      Accept: 'application/x-protobuf',
      Authorization: /^Bearer\s+/i.test(token) ? token : ('Bearer ' + token),
      'X-Timestamp': timestamp,
      'X-Nonce': nonce,
      'X-Signature': signature
    },
    timeout: timeoutMs || 30000,
    responseType: 'arraybuffer',
    validateStatus: () => true
  });
  if (res.status >= 400) {
    const err = new Error('HTTP ' + res.status + ' /api/user/base');
    err.httpStatus = res.status;
    throw err;
  }
  return decodeAny(decodeCommon(res.data), TypeRes);
}

/**
 * 对齐 HttpBizService.gameForward → POST /api/game/forward
 * createuser 的 url 类型：wgame_web Index.vue 默认 server=3
 */
async function httpGameForward({ token, url = 3, uri, data, cfg, timeoutMs }) {
  const root = loadProtoRoot();
  const TypeReq = root.cmd_http.TCmd_GameRequest;
  const TypeRes = root.cmd_http.TCmd_GameResponse;
  const payload = {
    uuid: Date.now().toString(),
    type: 'POST',
    url: Number(url),
    uri: String(uri || ''),
    data: typeof data === 'string' ? data : JSON.stringify(data || {})
  };
  const res = await postProto('/api/game/forward', TypeReq, payload, TypeRes, {
    cfg,
    token,
    timeoutMs
  });
  let parsed = null;
  try {
    parsed = res && res.content ? JSON.parse(res.content) : null;
  } catch (_) {
    parsed = res && res.content;
  }
  return {
    uuid: res && res.uuid,
    uri: res && res.uri,
    content: res && res.content,
    res: parsed
  };
}

/**
 * 对齐 HttpBizService.loadShopAndChannels → POST /api/user/shopItemList
 * 返回渠道 + 金额档（item / channelItem）
 */
async function httpShopItemList({ token, packageId, cfg, timeoutMs }) {
  const root = loadProtoRoot();
  const TypeReq = root.cmd_http.TCmd_ShopItemReq;
  const TypeRes = root.cmd_http.TCmd_ShopItemList;
  return postProto('/api/user/shopItemList', TypeReq, {
    packageId: Number(packageId) || 0
  }, TypeRes, { cfg, token, timeoutMs });
}

/** 未登录也可拉通道（对齐 guestShopItemList） */
async function httpGuestShopItemList({ packageId, cfg, timeoutMs }) {
  const root = loadProtoRoot();
  const TypeReq = root.cmd_http.TCmd_ShopItemReq;
  const TypeRes = root.cmd_http.TCmd_ShopItemList;
  return postProto('/api/guest/shopItemList', TypeReq, {
    packageId: Number(packageId) || 0
  }, TypeRes, { cfg, timeoutMs });
}

function protoType(name) {
  const cache = loadProtoRoot();
  const key = String(name || '').replace(/^cmd_http\./, '');
  if (!cache.cmd_http[key]) {
    cache.cmd_http[key] = cache._root.lookupType('cmd_http.' + key);
  }
  return cache.cmd_http[key];
}

async function postProtoEmpty(urlPath, TypeRes, opts) {
  const base = resolveLoginHttpBase(opts && opts.cfg);
  if (!base) throw new Error('login HTTP base missing (derive from wssUrl → login.*)');
  const secret = resolveHttpSignSecret(opts && opts.cfg);
  const body = Buffer.alloc(0);
  const timestamp = Date.now().toString();
  const nonce = randomNonce(16);
  const signature = md5Hex(Buffer.concat([
    Buffer.from(timestamp),
    Buffer.from(nonce),
    body,
    Buffer.from(secret)
  ]));
  const headers = {
    'Content-Type': 'application/x-protobuf',
    Accept: 'application/x-protobuf',
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature
  };
  const token = opts && opts.token;
  if (token) {
    headers.Authorization = /^Bearer\s+/i.test(token) ? token : ('Bearer ' + token);
  }
  const res = await axios.post(base + urlPath, body, {
    headers,
    timeout: (opts && opts.timeoutMs) || 30000,
    responseType: 'arraybuffer',
    validateStatus: () => true
  });
  if (res.status >= 400) {
    const err = new Error('HTTP ' + res.status + ' ' + urlPath);
    err.httpStatus = res.status;
    throw err;
  }
  return decodeAny(decodeCommon(res.data), TypeRes);
}

function userOrGuestPath(token, leaf) {
  return (token ? '/api/user/' : '/api/guest/') + leaf;
}

function sessionHttpToken(user) {
  if (!user) return '';
  return String(user.httpToken || (user.authTransport === 'http' ? user.session : '') || '');
}

async function httpMoney({ token, cfg, timeoutMs }) {
  return postProtoEmpty('/api/user/money', protoType('TCmd_Money'), { cfg, token, timeoutMs });
}

async function httpVipList({ token, cfg, timeoutMs }) {
  return postProtoEmpty(
    userOrGuestPath(token, 'vipList'),
    protoType('TCmd_VipWelfareDetail'),
    { cfg, token, timeoutMs }
  );
}

async function httpPaywayList({ token, cfg, timeoutMs }) {
  return postProtoEmpty('/api/user/paywayList', protoType('TCmd_PaywayItemList'), {
    cfg, token, timeoutMs
  });
}

async function httpEnableWithdraw({ token, cfg, timeoutMs }) {
  return postProtoEmpty('/api/user/enableWithdraw', protoType('TCmd_EnableWithdraw'), {
    cfg, token, timeoutMs
  });
}

async function httpDrawChannelCode({ token, cfg, timeoutMs }) {
  return postProtoEmpty(
    userOrGuestPath(token, 'drawChannelCode'),
    protoType('TCmd_DrawChannelCodeList'),
    { cfg, token, timeoutMs }
  );
}

async function httpDrawBackMoney({ token, money, payWay, id, cfg, timeoutMs }) {
  const { COIN_RATE } = require('./protocol');
  // 大厅展示币 → wgame 内部金额（×1000）
  const display = Number(money) || 0;
  const internal = Math.round(display * (COIN_RATE || 1000));
  return postProto(
    '/api/user/drawBackMoney',
    protoType('TCmd_DrawBackMoneyReq'),
    {
      money: internal,
      payWay: Number(payWay) || 0,
      id: Number(id) || 0
    },
    protoType('TCmd_DrawBackMoneyRes'),
    { cfg, token, timeoutMs }
  );
}

async function httpSetPayWay({ token, payload, cfg, timeoutMs }) {
  const p = payload || {};
  return postProto(
    '/api/user/setPayWay',
    protoType('TCmd_SetPayWayReq'),
    {
      userName: String(p.userName || p.user_name || p.realName || ''),
      bankCardNo: String(p.bankCardNo || p.bank_card_no || p.cardNo || p.account || ''),
      bankName: String(p.bankName || p.bank_name || ''),
      ifscCode: String(p.ifscCode || p.ifsc_code || p.phone || p.mobile || ''),
      mail: String(p.mail || p.email || ''),
      payWayType: Number(p.payWayType != null ? p.payWayType : (p.pay_way_type != null ? p.pay_way_type : p.type)) || 0,
      checkCode: Number(p.checkCode || p.check_code) || 0,
      id: Number(p.id) || 0,
      idCard: String(p.idCard || p.id_card || p.idcard || '')
    },
    protoType('TCmd_SetPayWayRes'),
    { cfg, token, timeoutMs }
  );
}

async function httpSetWithdrawPwd({ token, password, checkType, checkCode, cfg, timeoutMs }) {
  return postProto(
    '/api/user/setWithdrawPwd',
    protoType('TCmd_SetWithdrawPasswordReq'),
    {
      password: passwordMd5(password),
      checkType: Number(checkType) || 0,
      checkCode: checkCode ? passwordMd5(checkCode) : ''
    },
    protoType('TCmd_SetWithdrawPasswordRes'),
    { cfg, token, timeoutMs }
  );
}

async function httpVerifyWithdrawPwd({ token, password, cfg, timeoutMs }) {
  return postProto(
    '/api/user/verifyWithdrawPwd',
    protoType('TCmd_VerifyWithdrawPasswordReq'),
    { password: passwordMd5(password) },
    protoType('TCmd_VerifyWithdrawPasswordRes'),
    { cfg, token, timeoutMs }
  );
}

function recordQueryPayload(body) {
  const b = body || {};
  return {
    beginTime: Number(b.beginTime || b.begin_time || 0) || 0,
    endTime: Number(b.endTime || b.end_time || 0) || 0,
    pageNum: Number(b.pageNum || b.page_num || b.page || 1) || 1,
    pageSize: Number(b.pageSize || b.page_size || b.pageSize || 15) || 15,
    queryType: Number(b.queryType != null ? b.queryType : (b.query_type != null ? b.query_type : 0)) || 0
  };
}

async function httpChargeRecord({ token, body, cfg, timeoutMs }) {
  return postProto(
    '/api/user/chargeRecord',
    protoType('TCmd_ChargeRecordReq'),
    recordQueryPayload(body),
    protoType('TCmd_ChargeRecordList'),
    { cfg, token, timeoutMs }
  );
}

async function httpWithdrawRecord({ token, body, cfg, timeoutMs }) {
  return postProto(
    '/api/user/withdrawRecord',
    protoType('TCmd_WithdrawRecordReq'),
    recordQueryPayload(body),
    protoType('TCmd_WithdrawRecordItemList'),
    { cfg, token, timeoutMs }
  );
}

async function httpChargeWithdrawList({ token, body, cfg, timeoutMs }) {
  return postProto(
    '/api/user/chargeWithdrawList',
    protoType('TCmd_ChargeWithdrawRecordReq'),
    recordQueryPayload(body),
    protoType('TCmd_ChargeWithdrawRecordItemList'),
    { cfg, token, timeoutMs }
  );
}

async function httpProxyStatistics({ token, body, cfg, timeoutMs }) {
  const b = body || {};
  return postProto(
    '/api/user/proxyStatistics',
    protoType('TCmd_ProxyStatisticsReq'),
    {
      queryType: Number(b.queryType != null ? b.queryType : b.query_type) || 0,
      beginTime: Number(b.beginTime || b.begin_time) || 0,
      endTime: Number(b.endTime || b.end_time) || 0,
      showThree: Number(b.showThree != null ? b.showThree : 1) || 0
    },
    protoType('TCmd_ProxyStatisticsRes'),
    { cfg, token, timeoutMs }
  );
}

async function httpProxyUserList({ token, cfg, timeoutMs }) {
  return postProtoEmpty('/api/user/proxyUserList', protoType('TCmd_ProxySubUserItemList'), {
    cfg, token, timeoutMs
  });
}

async function httpProxySubBetConfig({ token, cfg, timeoutMs }) {
  return postProtoEmpty(
    userOrGuestPath(token, 'proxySubBetConfig'),
    protoType('TCmd_ProxySubBetConfig'),
    { cfg, token, timeoutMs }
  );
}

async function httpProxyAchieveConfig({ token, packageId, cfg, timeoutMs }) {
  return postProto(
    userOrGuestPath(token, 'proxyAchieveConfig'),
    protoType('TCmd_InviteTreasureChestInfoReq'),
    { packageId: Number(packageId) || 0 },
    protoType('TCmd_InviteTreasureChestInfo'),
    { cfg, token, timeoutMs }
  );
}

function toLongNumber(v, fallback = 0) {
  if (v == null || v === '') return fallback;
  if (typeof v === 'object' && typeof v.toNumber === 'function') {
    try { return v.toNumber(); } catch (_) { return fallback; }
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function protoList(res, key) {
  if (!res) return [];
  const list = res[key] || res.item || res.items;
  return Array.isArray(list) ? list : [];
}

module.exports = {
  loadProtoRoot,
  clearProtoCache,
  passwordMd5,
  deriveLoginHttpBase,
  resolveLoginHttpBase,
  resolveHttpSignSecret,
  defaultDeviceId,
  sessionHttpToken,
  httpLogin,
  httpRegister,
  httpUserBase,
  httpGameForward,
  httpShopItemList,
  httpGuestShopItemList,
  httpMoney,
  httpVipList,
  httpPaywayList,
  httpEnableWithdraw,
  httpDrawChannelCode,
  httpDrawBackMoney,
  httpSetPayWay,
  httpSetWithdrawPwd,
  httpVerifyWithdrawPwd,
  httpChargeRecord,
  httpWithdrawRecord,
  httpChargeWithdrawList,
  httpProxyStatistics,
  httpProxyUserList,
  httpProxySubBetConfig,
  httpProxyAchieveConfig,
  toLongNumber,
  protoList
};
