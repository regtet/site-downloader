/**
 * Series aniw-lobby：目标 path 匹配 + 规范用户态 → dist 期望的 JSON
 */
const { OP } = require('../../ops');
const { PATH_TO_OP, CATALOG, DEFAULT_HOST } = require('./catalog');

function normalizeApiPath(pathname) {
  let p = String(pathname || '');
  if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
  return p;
}

function matchRoute(pathname) {
  const p = normalizeApiPath(pathname);
  const op = PATH_TO_OP[p];
  return op ? { op, path: p } : null;
}

/**
 * 规范用户 → aniw/679win 登录注册 data
 * 字段对齐 dist 读取习惯；不改 UI，只喂数据。
 */
function toMemberProfile(user) {
  if (!user) return null;
  const game_gold = Number(user.game_gold || 0);
  const username = user.nickname || user.account || '';
  return {
    username,
    userpass: user.password || '',
    session_key: user.session || '',
    jwt_token: user.session || '',
    userkey: String(user.userId || ''),
    currency: user.currency || 'BRL',
    account_type: 15,
    game_gold,
    platfromid: 'web_lobby',
    mode: 0,
    phone: user.phone || '',
    email: user.email || '',
    realname: '',
    nickname: username,
    vip_level: user.vip_level || 0,
    headimg: user.face_id || '',
    avatar: user.face_id || '',
    deviceFingerprint: user.device_id || ''
  };
}

/**
 * @param {string} op
 * @param {{ ok:boolean, code:number, msg:string, data:any }} providerResult
 */
function mapResponse(op, providerResult) {
  const code = providerResult && providerResult.code != null ? providerResult.code : 1;
  const msg = (providerResult && providerResult.msg) || (code === 0 ? 'ok' : 'error');
  if (!providerResult || !providerResult.ok) {
    return { code, msg, data: null };
  }

  const data = providerResult.data;
  if (op === OP.AUTH_LOGIN || op === OP.AUTH_REGISTER || op === OP.USER_INFO) {
    return { code: 0, msg: 'ok', data: toMemberProfile(data) };
  }
  if (op === OP.AUTH_CHECK_REGISTER) {
    return { code: 0, msg: 'ok', data: data || { exists: false } };
  }
  if (op === OP.WALLET_GOLD) {
    return {
      code: 0,
      msg: 'ok',
      data: data || { game_gold: 0, totalGold: 0, bonus: 0, bonusRequireBet: 0, auditMode: 0 }
    };
  }
  return { code: 0, msg: 'ok', data };
}

module.exports = {
  id: 'aniw-lobby',
  label: 'aniw/oniw H5 lobby (679win family)',
  DEFAULT_HOST,
  CATALOG,
  matchRoute,
  mapResponse,
  normalizeApiPath,
  toMemberProfile
};
