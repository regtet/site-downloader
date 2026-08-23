/**
 * wgame 网关二进制协议（精简版，对齐 wgame_web CSPacket / Login CMD）
 * ASCII/MD5 账号密码与 GBK 同码，不依赖完整字符集表。
 */

const crypto = require('crypto');

const DEF_KEY = 'HgQI8vyO_Q2TkWJsW3b0@!RWCBj_5FVsY%n68#LP34W&9RbGw7ooH=nPhm0@!TG*E';

const EST = {
  LOGON: 1,
  HALL: 2,
  GATE: 4
};

const KN = {
  MDM_COMMAND: 0,
  SUB_DETECT: 1,
  SUB_XORKEY_REQ: 2,
  SUB_CLIENT_DETECT: 4,
  MDM_SOCKET: 66,
  SUB_TOKEN_RES: 2,
  SUB_VERIFY_REQ: 3
};

const LOGIN = {
  MDM_LOGON: 2,
  SUB_ERROR: 101,
  SUB_OK: 103,
  SUB_REQ: 108,
  MDM_REGISTER: 3,
  SUB_REG_OK: 105,
  SUB_REG_ERR: 106,
  SUB_REG_NO_CHECK: 108
};

const HALL = {
  MDM_LOGON: 1,
  SUB_ERROR: 101,
  SUB_REQ: 1101,
  SUB_OK: 1102
};

const PAY = {
  MDM_PAY: 9,
  SUB_QUERY_CHANNEL: 1101,
  MDM_HTTP: 104,
  SUB_CHARGE: 2
};

const ROLE = {
  MDM_ROLE: 7,
  SUB_PROXY_INVITE_INFO: 11320
};

const HTTP = {
  MDM_HTTP_REQ: 104,
  SUB_HTTP_COMMON_REQ: 5,
  SUB_HTTP_COMMON_RET: 6
};

const GATE = {
  MDM_SOCK: 1,
  SUB_CONNECT: 101,
  SUB_CONNECT_RES: 102
};

const COIN_RATE = 1000;

function md5Hex(s) {
  return crypto.createHash('md5').update(String(s), 'utf8').digest('hex');
}

function writeFixedString(buf, offset, str, size) {
  const s = String(str || '');
  for (let i = 0; i < size; i++) {
    buf[offset + i] = i < s.length ? s.charCodeAt(i) & 0xff : 0;
  }
  return offset + size;
}

function readFixedString(buf, offset, size) {
  let end = offset;
  const max = offset + size;
  while (end < max && buf[end] !== 0) end++;
  return buf.slice(offset, end).toString('latin1');
}

function encodePacket(serverType, mainCmd, subCmd, bodyBuf) {
  const bodyLen = bodyBuf ? bodyBuf.length : 0;
  const total = 9 + bodyLen;
  const out = Buffer.alloc(total);
  out.writeUInt16LE(total, 0);
  out[2] = 0;
  out[3] = 68;
  out[4] = serverType & 0xff;
  out.writeUInt16LE(mainCmd, 5);
  out.writeUInt16LE(subCmd, 7);
  if (bodyBuf && bodyLen) bodyBuf.copy(out, 9);
  return out;
}

function decodeHead(buf) {
  if (!buf || buf.length < 9) return null;
  return {
    wDataSize: buf.readUInt16LE(0),
    cbCheckCode: buf[2],
    cbMessageVer: buf[3],
    cbServerType: buf[4],
    wMainCmdID: buf.readUInt16LE(5),
    wSubCmdID: buf.readUInt16LE(7)
  };
}

function encodeXorKeyReq() {
  return encodePacket(EST.GATE, KN.MDM_COMMAND, KN.SUB_XORKEY_REQ, null);
}

function encodeMd5Verify(token) {
  const str = token + DEF_KEY + token + DEF_KEY + token;
  const dig = md5Hex(str);
  const content = Buffer.alloc(33);
  writeFixedString(content, 0, dig, 33);
  return encodePacket(EST.GATE, KN.MDM_SOCKET, KN.SUB_VERIFY_REQ, content);
}

function encodeDetectSocket() {
  return encodePacket(EST.GATE, KN.MDM_COMMAND, KN.SUB_DETECT, null);
}

function encodeLoginBody({ account, passwordMd5, deviceId, nGmType, packageId }) {
  // CMD_PSPT_LoginByAccounts_ISP
  const body = Buffer.alloc(33 + 33 + 33 + 4 * 6 + 4);
  let o = 0;
  o = writeFixedString(body, o, account, 33);
  o = writeFixedString(body, o, passwordMd5, 33);
  o = writeFixedString(body, o, deviceId, 33);
  body.writeUInt32LE(1, o); o += 4; // dwActype
  body.writeUInt32LE(nGmType >>> 0, o); o += 4;
  body.writeUInt32LE(4, o); o += 4; // dwLgtype browser
  body.writeUInt32LE(0, o); o += 4; // dwClock
  body.writeUInt32LE(0, o); o += 4; // iISPID
  body.writeUInt32LE(packageId >>> 0, o); o += 4;
  body.writeInt32LE(0, o); o += 4; // nCheckCode
  return body;
}

function encodeRegisterBody({ account, passwordMd5, packageId, inviteCode, nGmType, mobile }) {
  // CMD_PSPT_RegisterAccount
  const body = Buffer.alloc(64 + 33 + 4 + 4 + 4 + 16);
  let o = 0;
  o = writeFixedString(body, o, account, 64);
  o = writeFixedString(body, o, passwordMd5, 33);
  body.writeUInt32LE(packageId >>> 0, o); o += 4;
  body.writeUInt32LE((inviteCode || 0) >>> 0, o); o += 4;
  body.writeUInt32LE(nGmType >>> 0, o); o += 4;
  writeFixedString(body, o, mobile || '', 16);
  return body;
}

function parseLogonOK(buf) {
  // skip 9-byte head
  let o = 9;
  const dwUserID = buf.readUInt32LE(o); o += 4;
  const sSession = readFixedString(buf, o, 33); o += 33;
  const dwServerTime = buf.readUInt32LE(o); o += 4;
  const nHallServerId = buf.readUInt16LE(o); o += 2;
  const nHallBranchId = buf.readUInt16LE(o); o += 2;
  return { dwUserID, sSession, dwServerTime, nHallServerId, nHallBranchId };
}

function parseLoginError(buf) {
  let o = 9;
  const dwErrorCode = buf.readUInt32LE(o); o += 4;
  const nPswErrorTimes = buf.readInt32LE(o); o += 4;
  const nLeftTime = buf.readInt32LE(o); o += 4;
  const szErrorDescribe = readFixedString(buf, o, 128);
  return { dwErrorCode, nPswErrorTimes, nLeftTime, szErrorDescribe };
}

function parseRegisterError(buf) {
  let o = 9;
  const lErrorCode = buf.readUInt32LE(o);
  return { lErrorCode };
}

function readToken(buf) {
  return readFixedString(buf, 9, 16);
}

function readInt64LE(buf, offset) {
  const bytes = buf.slice(offset, offset + 8);
  const sign = bytes[7] >> 7;
  let sum = 0;
  let digits = 1;
  for (let i = 0; i < 8; i++) {
    const value = bytes[i];
    sum += (sign ? value ^ 0xff : value) * digits;
    digits *= 0x100;
  }
  return sign ? -1 - sum : sum;
}

function readVarString(buf, offset) {
  if (offset + 2 > buf.length) return { value: '', offset: buf.length };
  let len = buf.readInt16LE(offset);
  offset += 2;
  if (len < 0) len = 0;
  if (offset + len > buf.length) len = Math.max(0, buf.length - offset);
  let value = buf.slice(offset, offset + len).toString('latin1');
  const z = value.indexOf('\0');
  if (z >= 0) value = value.slice(0, z);
  return { value, offset: offset + len };
}

/** CMD_GW_SockConnectServer */
function encodeHallConnect(nServerId, nBranchId) {
  const body = Buffer.alloc(1 + 2 + 2);
  body[0] = EST.HALL;
  body.writeUInt16LE(nServerId >>> 0, 1);
  body.writeUInt16LE(nBranchId >>> 0, 3);
  return encodePacket(EST.GATE, GATE.MDM_SOCK, GATE.SUB_CONNECT, body);
}

/** CMD_GP_Login_Req */
function encodeHallLoginBody({ loginID, session, deviceId, nServerId, nBranchId }) {
  const body = Buffer.alloc(4 + 4 + 4 + 33 + 33 + 2 + 2);
  let o = 0;
  body.writeUInt32LE(loginID >>> 0, o); o += 4;
  body.writeUInt32LE(1, o); o += 4; // actType
  body.writeUInt32LE(4, o); o += 4; // dwLgtype browser
  o = writeFixedString(body, o, session, 33);
  o = writeFixedString(body, o, deviceId, 33);
  body.writeUInt16LE(nServerId >>> 0, o); o += 2;
  body.writeUInt16LE(nBranchId >>> 0, o); o += 2;
  return body;
}

/**
 * 解析 CMD_GP_Logon_Res（对齐 wgame_web）
 * 固定字段够用即可；VARCHAR 尽量解析昵称/手机/邮箱
 */
function parseHallLogonRes(buf) {
  let o = 9;
  const res = buf[o]; o += 1;
  const userID = buf.readUInt32LE(o); o += 4;
  const faceID = buf.readUInt16LE(o); o += 2;
  const gender = buf[o]; o += 1;
  const experience = readInt64LE(buf, o); o += 8;
  const availExpr = readInt64LE(buf, o); o += 8;
  const happyMoney = readInt64LE(buf, o); o += 8;
  const lGameScore = readInt64LE(buf, o); o += 8;
  o += 4; // userRight
  o += 4; // masterRight
  const lastLogonTime = buf.readUInt32LE(o); o += 4;
  o += 4; // iOSPaySwitch
  const accountType = buf[o]; o += 1;
  o += 2; // nGamekindId
  o += 2; // nRoomId
  o += 2; // nRoomBranchId
  const nChacLevel = buf.readUInt16LE(o); o += 2;
  const nVipLevel = buf.readUInt16LE(o); o += 2;
  o += 4; // nLoginDaysDiff
  o += 4; // nNewerGuideStep
  o += 4; // nCouponCount
  const nRoleType = buf.readInt32LE(o); o += 4;
  o += 4; // nProxySwitch
  const bFirstLogin = buf[o]; o += 1;
  const bHasRecharge = buf[o]; o += 1;
  o += 1; // nHasDailySign
  o += 1; // bBindGoogle
  o += 1; // bBindFacebook

  let lastLogonIP = '';
  let nickname = '';
  let secPhone = '';
  let szMail = '';
  let szAccountName = '';
  try {
    let v;
    v = readVarString(buf, o); lastLogonIP = v.value; o = v.offset;
    v = readVarString(buf, o); nickname = v.value; o = v.offset;
    v = readVarString(buf, o); secPhone = v.value; o = v.offset;
    v = readVarString(buf, o); o = v.offset; // sSvrConn
    v = readVarString(buf, o); o = v.offset; // szCountryCode
    v = readVarString(buf, o); szMail = v.value; o = v.offset;
    o += 1; // bIfInnerProxy
    o += 1; // bAllowEvo
    v = readVarString(buf, o); szAccountName = v.value;
  } catch (_) { /* ignore trailing */ }

  return {
    res,
    userID,
    faceID,
    gender,
    experience,
    availExpr,
    happyMoney,
    lGameScore,
    accountType,
    nChacLevel,
    nVipLevel,
    nRoleType,
    bFirstLogin,
    bHasRecharge,
    lastLogonTime,
    lastLogonIP,
    nickname,
    secPhone,
    szMail,
    szAccountName,
    game_gold: happyMoney / COIN_RATE
  };
}

function parseHallLoginError(buf) {
  let o = 9;
  const errorCode = buf.readUInt32LE(o); o += 4;
  const errorDescribe = readFixedString(buf, o, Math.min(128, buf.length - o));
  return { errorCode, errorDescribe };
}

function readUtf8Fixed(buf, offset, size) {
  const end = Math.min(offset + size, buf.length);
  const slice = buf.slice(offset, end);
  let z = slice.indexOf(0);
  if (z < 0) z = slice.length;
  return {
    value: slice.slice(0, z).toString('utf8'),
    next: offset + size
  };
}

function readInt64LE(buf, offset) {
  if (typeof buf.readBigInt64LE === 'function') {
    try {
      return Number(buf.readBigInt64LE(offset));
    } catch (_) { /* fallthrough */ }
  }
  const lo = buf.readUInt32LE(offset);
  const hi = buf.readInt32LE(offset + 4);
  return hi * 0x100000000 + lo;
}

/** HT_QueryPayChannel_Req: dwRoleID */
function encodeQueryPayChannel(roleId) {
  const body = Buffer.alloc(4);
  body.writeUInt32LE(Number(roleId) >>> 0, 0);
  return encodePacket(EST.HALL, PAY.MDM_PAY, PAY.SUB_QUERY_CHANNEL, body);
}

/**
 * HT_PayChannelItem fixed layout (395 bytes)
 */
function parsePayChannelItem(buf, offset) {
  let o = offset;
  if (o + 395 > buf.length) return null;
  const nChannelId = buf.readInt32LE(o); o += 4;
  let v = readUtf8Fixed(buf, o, 50); const szChannelName = v.value; o = v.next;
  v = readUtf8Fixed(buf, o, 300); const szUrl = v.value; o = v.next;
  const llMinMoney = readInt64LE(buf, o); o += 8;
  const llMaxMoney = readInt64LE(buf, o); o += 8;
  const nStatus = buf.readInt32LE(o); o += 4;
  const bBindPhone = buf[o]; o += 1;
  const nAwardRate = buf.readInt32LE(o); o += 4;
  const nChannelType = buf.readInt32LE(o); o += 4;
  const kycFlag = buf[o]; o += 1;
  v = readUtf8Fixed(buf, o, 11); const szExtra = v.value; o = v.next;
  return {
    item: {
      nChannelId,
      szChannelName,
      szUrl,
      llMinMoney,
      llMaxMoney,
      nStatus,
      bBindPhone,
      nAwardRate,
      nChannelType,
      kycFlag,
      szExtra
    },
    next: o
  };
}

function parsePayChannels(buf) {
  let o = 9;
  if (o + 4 > buf.length) return { nCount: 0, list: [] };
  const nCount = buf.readInt32LE(o); o += 4;
  const list = [];
  for (let i = 0; i < nCount; i++) {
    const row = parsePayChannelItem(buf, o);
    if (!row) break;
    list.push(row.item);
    o = row.next;
  }
  return { nCount, list };
}

/** CMD_Charge: nOrderType + nChannelId + nChargeMoney + nsize + cpf[256] */
function encodeCharge({ orderType, channelId, money }) {
  const body = Buffer.alloc(4 + 4 + 4 + 2 + 256);
  let o = 0;
  body.writeInt32LE(Number(orderType) || 3, o); o += 4;
  body.writeInt32LE(Number(channelId) || 0, o); o += 4;
  body.writeInt32LE(Number(money) || 0, o); o += 4;
  body.writeUInt16LE(0, o); o += 2;
  return encodePacket(EST.HALL, PAY.MDM_HTTP, PAY.SUB_CHARGE, body);
}

function parseChargeRet(buf) {
  let o = 9;
  const nRet = buf.readInt32LE(o); o += 4;
  const szChargeUrl = readFixedString(buf, o, Math.min(1024, Math.max(0, buf.length - o)));
  o += 1024;
  const szOrderInfo = o < buf.length
    ? readFixedString(buf, o, Math.min(1024, buf.length - o))
    : '';
  let orderInfo = null;
  try {
    if (szOrderInfo && szOrderInfo.trim().startsWith('{')) {
      orderInfo = JSON.parse(szOrderInfo.trim());
    }
  } catch (_) { /* ignore */ }
  return { nRet, szChargeUrl, szOrderInfo, orderInfo };
}

function parseProxyInviteInfo(buf) {
  let o = 9;
  const nValidInviteCount = buf.readInt32LE(o); o += 4;
  const nDirectCount = buf.readInt32LE(o); o += 4;
  const nGetAwardCount = buf.readInt32LE(o); o += 4;
  const nPerInviteAwardMoney = buf.readInt32LE(o); o += 4;
  const llYesInviteBonus = readInt64LE(buf, o); o += 8;
  const llTodayInviteBonus = readInt64LE(buf, o); o += 8;
  const nAchieveInviteCount = buf.readInt32LE(o); o += 4;
  const nAchieveAwardStatus = readInt64LE(buf, o); o += 8;
  const szInviteCode = readFixedString(buf, o, 33); o += 33;
  const nProxyRunningReturnRate1 = o + 4 <= buf.length ? buf.readInt32LE(o) : 0; o += 4;
  const nProxyRunningReturnRate2 = o + 4 <= buf.length ? buf.readInt32LE(o) : 0; o += 4;
  const nProxyRunningReturnRate3 = o + 4 <= buf.length ? buf.readInt32LE(o) : 0; o += 4;
  const nTodayValidInviteCount = o + 4 <= buf.length ? buf.readInt32LE(o) : 0; o += 4;
  const nYesValidInviteCount = o + 4 <= buf.length ? buf.readInt32LE(o) : 0; o += 4;
  const nChestValidInviteCount = o + 4 <= buf.length ? buf.readInt32LE(o) : 0;
  return {
    nValidInviteCount,
    nDirectCount,
    nGetAwardCount,
    nPerInviteAwardMoney,
    llYesInviteBonus,
    llTodayInviteBonus,
    nAchieveInviteCount,
    nAchieveAwardStatus,
    szInviteCode,
    nProxyRunningReturnRate1,
    nProxyRunningReturnRate2,
    nProxyRunningReturnRate3,
    nTodayValidInviteCount,
    nYesValidInviteCount,
    nChestValidInviteCount
  };
}

/** SUB_GP_GET_PROXY_VALID_INVITE_INFO：无 body */
function encodeProxyInviteInfoReq() {
  return encodePacket(EST.HALL, ROLE.MDM_ROLE, ROLE.SUB_PROXY_INVITE_INFO, null);
}

/**
 * 对齐 wgame_web HallKernel.httpProxy → CMD_GP_Http_Common_Req
 * pack: { url, uri, data, type, uuid }
 */
function encodeHttpCommonReq(pack) {
  const content = typeof pack === 'string' ? pack : JSON.stringify(pack || {});
  const utf8 = Buffer.from(content, 'utf8');
  const nSize = content.length;
  const body = Buffer.alloc(2 + nSize);
  body.writeUInt16LE(nSize, 0);
  utf8.copy(body, 2, 0, Math.min(utf8.length, nSize));
  return encodePacket(EST.HALL, HTTP.MDM_HTTP_REQ, HTTP.SUB_HTTP_COMMON_REQ, body);
}

/** CMD_GP_Http_Common_Ret → { uri, uuid, result_data } */
function parseHttpCommonRet(buf) {
  let o = 9;
  if (o + 2 > buf.length) return { raw: '', outer: null, result: null };
  const len = buf.readInt16LE(o); o += 2;
  if (len <= 0 || o + len > buf.length) return { raw: '', outer: null, result: null };
  const slice = buf.slice(o, o + len);
  let raw = slice.toString('utf8');
  if (!raw.trim().startsWith('{')) raw = slice.toString('latin1');
  try {
    const outer = JSON.parse(raw);
    const result = outer && (outer.result_data != null ? outer.result_data : outer);
    return { raw, outer, result };
  } catch (_) {
    return { raw, outer: null, result: null };
  }
}

module.exports = {
  EST,
  KN,
  LOGIN,
  HALL,
  PAY,
  ROLE,
  HTTP,
  GATE,
  COIN_RATE,
  DEF_KEY,
  md5Hex,
  encodePacket,
  decodeHead,
  encodeXorKeyReq,
  encodeMd5Verify,
  encodeDetectSocket,
  encodeLoginBody,
  encodeRegisterBody,
  encodeHallConnect,
  encodeHallLoginBody,
  encodeQueryPayChannel,
  encodeCharge,
  encodeProxyInviteInfoReq,
  encodeHttpCommonReq,
  parseHttpCommonRet,
  parseLogonOK,
  parseLoginError,
  parseRegisterError,
  parseHallLogonRes,
  parseHallLoginError,
  parsePayChannels,
  parseChargeRet,
  parseProxyInviteInfo,
  readToken
};
