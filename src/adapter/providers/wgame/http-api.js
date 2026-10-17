/**
 * 对齐 wgame_web：HTTP + protobuf（/api/login、/api/game/forward 等）
 * 用 protobufjs 加载同级 wgame_web 的 .proto（避免 require 巨型 proto.js 在 Node 22 下 ESM 冲突）
 */
const crypto = require('crypto');
const path = require('path');
const axios = require('axios');
const protobuf = require('protobufjs');
const { applySystemProxy, getHttpsProxyAgent, getDirectHttpsAgent } = require('../../../system-proxy');
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

function signedHeaders(body, secret, token) {
  if (!secret) {
    const err = new Error('登录签名密钥为空，部署包没有读到 httpSignSecret');
    err.code = 1005;
    throw err;
  }
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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'X-Timestamp': timestamp,
    'X-Nonce': nonce,
    'X-Signature': signature
  };
  // 对齐 wgame_web：Authorization 是原始 token，不加 Bearer
  if (token) headers.Authorization = String(token).replace(/^Bearer\s+/i, '');
  return headers;
}

function httpFail(status, urlPath, data) {
  let extra = '';
  if (status === 403 || status === 401) {
    let text = '';
    try {
      text = Buffer.isBuffer(data) ? data.toString('utf8', 0, 160) : String(data || '').slice(0, 160);
    } catch (_) { /* ignore */ }
    if (!text || /<html|cloudflare|forbidden|attention required/i.test(text)) {
      extra = '。登录域名拒绝了当前服务器，请确认这台机器能访问登录地址，或设置 HTTPS_PROXY';
    }
  }
  const err = new Error('HTTP ' + status + ' ' + urlPath + extra);
  err.httpStatus = status;
  return err;
}

async function postSigned(base, urlPath, body, secret, token, timeoutMs) {
  const agent = getHttpsProxyAgent() || getDirectHttpsAgent();
  const res = await axios.post(base + urlPath, body, {
    headers: signedHeaders(body, secret, token),
    timeout: timeoutMs || 30000,
    responseType: 'arraybuffer',
    validateStatus: () => true,
    httpsAgent: agent,
    // 代理已在 agent 里；再让 axios 读 HTTPS_PROXY 会再跳一跳
    proxy: false
  });
  if (res.status >= 400) throw httpFail(res.status, urlPath, res.data);
  return res.data;
}

async function postProto(urlPath, TypeReq, payload, TypeRes, opts) {
  const base = resolveLoginHttpBase(opts && opts.cfg);
  if (!base) throw new Error('login HTTP base missing (derive from wssUrl → login.*)');
  const secret = resolveHttpSignSecret(opts && opts.cfg);
  const body = encodeProto(TypeReq, payload);
  const raw = await postSigned(
    base,
    urlPath,
    body,
    secret,
    opts && opts.token,
    opts && opts.timeoutMs
  );
  return decodeAny(decodeCommon(raw), TypeRes);
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
  const raw = await postSigned(base, '/api/user/base', body, secret, token, timeoutMs);
  return decodeAny(decodeCommon(raw), TypeRes);
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
  const raw = await postSigned(
    base,
    urlPath,
    body,
    secret,
    opts && opts.token,
    opts && opts.timeoutMs
  );
  return decodeAny(decodeCommon(raw), TypeRes);
}

function userOrGuestPath(token, leaf) {
  return (token ? '/api/user/' : '/api/guest/') + leaf;
}

function sessionHttpToken(user) {
  if (!user) return '';
  return String(user.httpToken || (user.authTransport === 'http' ? user.session : '') || '');
}

async function httpBalanceInterestConfig({ token, cfg, timeoutMs }) {
  return postProtoEmpty(
    userOrGuestPath(token, 'balanceInterestConfig'),
    protoType('TCmd_BalanceInterestList'),
    { cfg, token, timeoutMs }
  );
}

async function httpBalanceInterestList({ token, cfg, timeoutMs }) {
  return postProtoEmpty(
    '/api/user/balanceInterestList',
    protoType('TCmd_UserBalanceInterestList'),
    { cfg, token, timeoutMs }
  );
}

async function httpSetBalanceInterest({ token, balanceType, seedMoney, cfg, timeoutMs }) {
  return postProto(
    '/api/user/setBalanceInterest',
    protoType('TCmd_SetUserBalanceInterestReq'),
    {
      balanceType: Number(balanceType) || 0,
      seedMoney: Math.round(Number(seedMoney) || 0)
    },
    protoType('TCmd_SetUserBalanceInterestRes'),
    { cfg, token, timeoutMs }
  );
}

async function httpGetBalanceInterest({ token, balanceType, returnSeedMoney, cfg, timeoutMs }) {
  return postProto(
    '/api/user/getBalanceInterest',
    protoType('TCmd_GetUserBalanceInterestReq'),
    {
      balanceType: Number(balanceType) || 0,
      returnSeedMoney: Number(returnSeedMoney) ? 1 : 0
    },
    protoType('TCmd_GetUserBalanceInterestRes'),
    { cfg, token, timeoutMs }
  );
}

async function httpBalanceInterestHistory({ token, body, cfg, timeoutMs }) {
  const q = lobbyTimeToBetQuery(body || {});
  const sentType = body && (body.timeEnum != null || body.queryType != null || body.query_type != null);
  return postProto(
    '/api/user/balanceInterestHistory',
    protoType('TCmd_UserBalanceHistoryReq'),
    {
      beginTime: q.beginTime,
      endTime: q.endTime,
      queryType: sentType ? q.queryType : 99,
      bussnessType: 0,
      pageNum: q.pageNum,
      pageSize: q.pageSize
    },
    protoType('TCmd_UserBalanceHistoryList'),
    { cfg, token, timeoutMs }
  );
}

async function httpMoney({ token, cfg, timeoutMs }) {
  return postProtoEmpty('/api/user/money', protoType('TCmd_Money'), { cfg, token, timeoutMs });
}

async function httpGetDaySignAward({ token, awardType, vipLevel, cfg, timeoutMs }) {
  return postProto(
    '/api/user/getDaySignAward',
    protoType('TCmd_DaySignAwardReq'),
    {
      awardType: Number(awardType) || 0,
      vipLevel: Number(vipLevel) || 0
    },
    protoType('TCmd_DaySignAwardRes'),
    { cfg, token, timeoutMs }
  );
}

async function httpValidAwardInfo({ token, cfg, timeoutMs }) {
  return postProtoEmpty(
    '/api/user/validAwardInfo',
    protoType('TCmd_ValidAwardInfo'),
    { cfg, token, timeoutMs }
  );
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

function lobbyPayWayType(p) {
  const sub = String(p.subType || p.withdrawTypeName || p.wayCode || p.channelName || '').trim().toUpperCase();
  const byName = {
    CPF: 3,
    PIX: 3,
    PHONE: 8,
    MOBILE: 8,
    TELEFONE: 8,
    EMAIL: 9,
    EVP: 10,
    RANDOM: 10,
    CNPJ: 11,
    BANK: 7,
    ALIPAY: 1,
    SLRY: 3,
    SVGS: 3,
    CACC: 3,
    TRAN: 3
  };
  if (byName[sub]) return byName[sub];
  const raw = p.payWayType != null ? p.payWayType
    : (p.pay_way_type != null ? p.pay_way_type
      : (p.withdrawType != null ? p.withdrawType : p.type));
  const n = Number(raw);
  // 大厅 accountType/typeId 5 是 PIX 总类，不是 wgame 的支付方式编号
  if (Number.isFinite(n) && n > 0 && n !== 5) return n;
  return 3;
}

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}

async function httpSetPayWay({ token, payload, cfg, timeoutMs }) {
  const p = payload || {};
  const payWayType = lobbyPayWayType(p);
  const name = String(p.userName || p.user_name || p.realName || p.name || '').trim();
  const accountRaw = String(
    p.account || p.bankCardNo || p.bank_card_no || p.cardNo || p.alipayAccount || p.aliAccount || p.address || p.addr || ''
  ).trim();
  const cpfRaw = String(p.cpf || p.extendInfo || p.idCard || p.id_card || p.idcard || '').trim();
  const cpf = onlyDigits(cpfRaw);
  const email = String(p.email || p.mail || (accountRaw.indexOf('@') !== -1 ? accountRaw : '')).trim();
  const phone = onlyDigits(p.phone || p.mobile || (payWayType === 8 ? accountRaw : ''));

  // 对齐 wgame ManageAccount：CPF 进 bankCardNo；PHONE/EMAIL/EVP 的 PIX 密钥进 ifsc/mail，CPF 仍进 bankCardNo
  let bankCardNo = '';
  let ifscCode = '';
  let mail = '';
  let idCard = '';
  if (payWayType === 9) {
    bankCardNo = cpf || onlyDigits(accountRaw);
    mail = email || accountRaw;
    idCard = bankCardNo;
  } else if (payWayType === 8) {
    bankCardNo = cpf || onlyDigits(p.extendInfo || '');
    ifscCode = phone || onlyDigits(accountRaw);
    idCard = bankCardNo;
  } else if (payWayType === 10) {
    bankCardNo = cpf || onlyDigits(p.extendInfo || '');
    ifscCode = accountRaw;
    idCard = bankCardNo;
  } else if (payWayType === 11) {
    bankCardNo = onlyDigits(accountRaw) || accountRaw;
    idCard = bankCardNo;
  } else {
    bankCardNo = onlyDigits(accountRaw) || onlyDigits(cpf) || accountRaw || cpf;
    idCard = String(p.idCard || p.id_card || p.idcard || bankCardNo);
  }

  if (!bankCardNo) {
    console.warn('[wgame] setPayWay empty bankCardNo keys=', Object.keys(p || {}));
  }

  return postProto(
    '/api/user/setPayWay',
    protoType('TCmd_SetPayWayReq'),
    {
      userName: name,
      bankCardNo: String(bankCardNo || ''),
      bankName: String(p.bankName || p.bank_name || ''),
      ifscCode: String(ifscCode || p.ifscCode || p.ifsc_code || ''),
      mail: String(mail || p.mail || ''),
      payWayType,
      checkCode: Number(p.checkCode || p.check_code) || 0,
      id: Number(p.id) || 0,
      idCard: String(idCard || '')
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

async function httpDayRechargeBonus({ token, cfg, timeoutMs }) {
  return postProtoEmpty(
    '/api/user/dayRechargeBonus',
    protoType('TCmd_DayRechargeBonusConfig'),
    { cfg, token, timeoutMs }
  );
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

const UINT32_MAX = 0xffffffff;
const proxyStatCache = new Map();
const accountGates = new Map();

function unixSeconds(value) {
  let n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (n > 1e12) n = Math.floor(n / 1000);
  n = Math.floor(n);
  if (n <= 0 || n > UINT32_MAX) return 0;
  return n;
}

/**
 * 大厅日期单选换成 proxyStatistics 的 queryType。
 * 0全部 1今天 2本周 3上周 4上月 5区间 6昨天 7本月。
 */
function proxyStatBodyFromLobby(body) {
  const b = body || {};
  const timeEnum = Number(b.timeEnum != null ? b.timeEnum : b.time_enum);
  const lobbyToStat = { 1: 6, 2: 1, 3: 2, 4: 3, 5: 7, 6: 4, 7: 0, 8: 5 };
  if (!Number.isFinite(timeEnum) || lobbyToStat[timeEnum] == null) return b;
  return {
    queryType: lobbyToStat[timeEnum],
    beginTime: b.beginTime != null ? b.beginTime : b.begin_time,
    endTime: b.endTime != null ? b.endTime : b.end_time
  };
}

/** 对齐 HallKernel.queryProxyStatistics_Req：缺省是全量且不展开三级。三级查询会让内部服务等到超时。 */
function normalizeProxyStatisticsQuery(body) {
  const b = body || {};
  let queryType = Number(b.queryType != null ? b.queryType : b.query_type);
  if (!Number.isFinite(queryType) || queryType < 0 || queryType > 7) queryType = 0;
  let beginTime = unixSeconds(b.beginTime != null ? b.beginTime : b.begin_time);
  let endTime = unixSeconds(b.endTime != null ? b.endTime : b.end_time);
  if (queryType !== 5) {
    beginTime = 0;
    endTime = 0;
  }
  // 大厅有时会带 showThree=1。wgame 的 HallKernel 默认是 0；展开三级会让内部服务等到超时。
  return { queryType, beginTime, endTime, showThree: 0 };
}

function proxyAccountKey(token) {
  return 'proxy:' + String(token || '').slice(-24);
}

function withAccountGate(key, fn) {
  const gateKey = String(key || '');
  const prev = accountGates.get(gateKey) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.then(() => {}, () => {});
  accountGates.set(gateKey, tail);
  return run;
}

function isInnerWaitTimeout(err) {
  return /wait response timeout|inner server/i.test(String(err && err.message || err || ''));
}

async function httpProxyStatistics({ token, body, cfg, timeoutMs }) {
  const payload = normalizeProxyStatisticsQuery(body);
  const cacheKey = String(token || '').slice(-24) + ':' + JSON.stringify(payload);
  const cached = proxyStatCache.get(cacheKey);
  if (cached && cached.expires > Date.now() && cached.value) return cached.value;
  if (cached && cached.pending) return cached.pending;
  const pending = withAccountGate(proxyAccountKey(token), async () => {
    const runOnce = () => postProto(
      '/api/user/proxyStatistics',
      protoType('TCmd_ProxyStatisticsReq'),
      payload,
      protoType('TCmd_ProxyStatisticsRes'),
      { cfg, token, timeoutMs }
    );
    try {
      return await runOnce();
    } catch (err) {
      if (!isInnerWaitTimeout(err)) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return runOnce();
    }
  }).then((res) => {
    proxyStatCache.set(cacheKey, { expires: Date.now() + 8000, value: res });
    return res;
  }).catch((err) => {
    const cur = proxyStatCache.get(cacheKey);
    if (cur && cur.pending === pending) proxyStatCache.delete(cacheKey);
    throw err;
  });
  proxyStatCache.set(cacheKey, { pending, expires: 0 });
  return pending;
}

/** 大厅日期单选（commonChunk）：1昨天 2今天 3本周 4上周 5本月 6上月 7全部 8自定义。 */
function lobbyTimeToBetQuery(body) {
  const b = body || {};
  const beginTime = unixSeconds(b.beginTime != null ? b.beginTime : b.begin_time);
  const endTime = unixSeconds(b.endTime != null ? b.endTime : b.end_time);
  let pageNum = Number(b.pageNum != null ? b.pageNum : (b.page != null ? b.page : 1));
  if (!Number.isFinite(pageNum) || pageNum < 1) pageNum = 1;
  let pageSize = Number(b.pageSize != null ? b.pageSize : b.page_size);
  if (!Number.isFinite(pageSize) || pageSize < 1) pageSize = 20;
  if (pageSize > 50) pageSize = 50;
  const targetRoleId = Number(b.targetRoleId != null ? b.targetRoleId : (b.userIdx != null ? b.userIdx : 0)) || 0;
  const timeEnum = Number(b.timeEnum != null ? b.timeEnum : b.time_enum);
  const lobbyToWgame = {
    1: 2,
    2: 1,
    3: 10,
    4: 11,
    5: 7,
    6: 8,
    7: 99,
    8: 4
  };
  let queryType = lobbyToWgame[timeEnum];
  if (queryType == null) {
    queryType = Number(b.queryType != null ? b.queryType : b.query_type);
    if (!Number.isFinite(queryType) || queryType <= 0) queryType = 1;
  }
  if (queryType !== 4) {
    return { beginTime: 0, endTime: 0, queryType, targetRoleId, pageNum, pageSize };
  }
  return { beginTime, endTime, queryType, targetRoleId, pageNum, pageSize };
}

async function httpProxyBetList({ token, body, cfg, timeoutMs }) {
  return withAccountGate(proxyAccountKey(token), () => postProto(
    '/api/user/proxyBetList',
    protoType('TCmd_ProxySubUserBetItemReq'),
    lobbyTimeToBetQuery(body),
    protoType('TCmd_ProxySubUserBetItemList'),
    { cfg, token, timeoutMs }
  ));
}

async function httpProxyWinList({ token, body, cfg, timeoutMs }) {
  return withAccountGate(proxyAccountKey(token), () => postProto(
    '/api/user/proxyWinList',
    protoType('TCmd_ProxySubUserWinItemReq'),
    lobbyTimeToBetQuery(body),
    protoType('TCmd_ProxySubUserWinItemList'),
    { cfg, token, timeoutMs }
  ));
}

function chargeRunningQuery(body) {
  const base = lobbyTimeToBetQuery(body);
  const sort = String((body && (body.sortField || body.sort || body.orderBy)) || '');
  const sortMap = { depositAmount: 3, rechargeAmount: 3, validBet: 4 };
  return Object.assign(base, {
    proxyLevel: 0,
    roleId: 0,
    sortType: sortMap[sort] || 0
  });
}

function betBonusQuery(body) {
  const base = lobbyTimeToBetQuery(body);
  const day = Number(body && (body.settleDay != null ? body.settleDay : body.settleDayUnix));
  if (!Number.isFinite(day) || day <= 0) return base;
  const start = day > 1e12 ? Math.floor(day / 1000) : Math.floor(day);
  return {
    beginTime: start,
    endTime: start + 86400 - 1,
    queryType: 4,
    pageNum: base.pageNum,
    pageSize: base.pageSize
  };
}

async function httpProxyBetBonus({ token, body, cfg, timeoutMs }) {
  return withAccountGate(proxyAccountKey(token), () => postProto(
    '/api/user/proxyBetBonus',
    protoType('TCmd_ProxySubBetBonusReq'),
    betBonusQuery(body),
    protoType('TCmd_ProxySubBetBonusItemList'),
    { cfg, token, timeoutMs }
  ));
}

async function httpProxyReceivePaymentList({ token, body, cfg, timeoutMs }) {
  return withAccountGate(proxyAccountKey(token), () => postProto(
    '/api/user/proxyReceivePaymentList',
    protoType('TCmd_ProxySubUserReceivePaymentReq'),
    lobbyTimeToBetQuery(body),
    protoType('TCmd_ProxySubUserReceivePaymentList'),
    { cfg, token, timeoutMs }
  ));
}

async function httpProxyChargeRunningList({ token, body, cfg, timeoutMs }) {
  return withAccountGate(proxyAccountKey(token), () => postProto(
    '/api/user/proxyChargeRunningList',
    protoType('TCmd_ProxyChargeRunningReq'),
    chargeRunningQuery(body),
    protoType('TCmd_ProxyChargeRunningItemList'),
    { cfg, token, timeoutMs }
  ));
}

async function httpProxyUserDetail({ token, roleId, cfg, timeoutMs }) {
  return withAccountGate(proxyAccountKey(token), () => postProto(
    '/api/user/proxyUserDetail',
    protoType('TCmd_ProxySubUserDetailItemReq'),
    { roleId: Number(roleId) || 0 },
    protoType('TCmd_ProxySubUserDetailItemList'),
    { cfg, token, timeoutMs }
  ));
}

async function httpProxyUserList({ token, cfg, timeoutMs }) {
  return withAccountGate(proxyAccountKey(token), () => postProtoEmpty(
    '/api/user/proxyUserList',
    protoType('TCmd_ProxySubUserItemList'),
    { cfg, token, timeoutMs }
  ));
}

async function httpProxySubBetConfig({ token, cfg, timeoutMs }) {
  return withAccountGate(proxyAccountKey(token), () => postProtoEmpty(
    userOrGuestPath(token, 'proxySubBetConfig'),
    protoType('TCmd_ProxySubBetConfig'),
    { cfg, token, timeoutMs }
  ));
}

async function httpCustomService({ token, packageId, cfg, timeoutMs }) {
  return postProto(
    userOrGuestPath(token, 'customService'),
    protoType('TCmd_CustomServiceReq'),
    { packageId: Number(packageId) || 0 },
    protoType('TCmd_CustomServiceList'),
    { cfg, token, timeoutMs }
  );
}

async function httpNotice({ token, cfg, timeoutMs }) {
  return postProtoEmpty(
    '/api/user/notice',
    protoType('TCmd_NoticeInfo'),
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
  httpBalanceInterestConfig,
  httpBalanceInterestList,
  httpSetBalanceInterest,
  httpGetBalanceInterest,
  httpBalanceInterestHistory,
  httpVipList,
  httpValidAwardInfo,
  httpGetDaySignAward,
  httpPaywayList,
  httpEnableWithdraw,
  httpDrawChannelCode,
  httpDrawBackMoney,
  httpSetPayWay,
  httpSetWithdrawPwd,
  httpVerifyWithdrawPwd,
  httpDayRechargeBonus,
  httpChargeRecord,
  httpWithdrawRecord,
  httpChargeWithdrawList,
  httpProxyStatistics,
  normalizeProxyStatisticsQuery,
  proxyStatBodyFromLobby,
  withAccountGate,
  proxyAccountKey,
  httpProxyBetList,
  httpProxyWinList,
  httpProxyUserDetail,
  httpProxyChargeRunningList,
  httpProxyReceivePaymentList,
  httpProxyBetBonus,
  lobbyTimeToBetQuery,
  httpProxyUserList,
  httpProxySubBetConfig,
  httpProxyAchieveConfig,
  httpCustomService,
  httpNotice,
  toLongNumber,
  protoList
};
