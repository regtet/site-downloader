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

module.exports = {
  EST,
  KN,
  LOGIN,
  DEF_KEY,
  md5Hex,
  encodePacket,
  decodeHead,
  encodeXorKeyReq,
  encodeMd5Verify,
  encodeDetectSocket,
  encodeLoginBody,
  encodeRegisterBody,
  parseLogonOK,
  parseLoginError,
  parseRegisterError,
  readToken
};
