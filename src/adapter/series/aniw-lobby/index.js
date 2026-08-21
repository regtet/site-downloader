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
  const username = user.account || user.nickname || '';
  const session = user.session || '';
  const userkey = String(user.userId || '');
  return {
    username,
    userpass: '',
    session_key: session,
    jwt_token: session,
    userkey,
    currency: user.currency || 'BRL',
    account_type: 15,
    game_gold,
    platfromid: 'web_lobby',
    mode: 0,
    phone: user.phone || '',
    email: user.email || '',
    realname: '',
    nickname: user.nickname || username,
    vip_level: user.vip_level || 0,
    vip_status: 0,
    portrait_id: user.face_id || '',
    headimg: user.face_id || '',
    avatar: user.face_id || '',
    deviceFingerprint: user.device_id || '',
    loginVerify: false,
    firstLoginVerify: false
  };
}

/**
 * @param {string} op
 * @param {{ ok:boolean, code:number, msg:string, data:any }} providerResult
 */
function mapResponse(op, providerResult) {
  // aniw/679win 业务成功码是 1（ze.SUCCESS），不是 0（SUCCESSCODE 仅作常量名）
  const OK = 1;
  if (!providerResult || !providerResult.ok) {
    const code = providerResult && providerResult.code != null ? providerResult.code : 1;
    // 失败码不能是 1，否则会被当成成功
    const failCode = code === OK ? 1011 : code;
    return {
      code: failCode,
      msg: (providerResult && providerResult.msg) || 'error',
      data: null
    };
  }

  const data = providerResult.data;
  if (op === OP.AUTH_LOGIN || op === OP.AUTH_REGISTER || op === OP.USER_INFO) {
    return { code: OK, msg: '', data: toMemberProfile(data) };
  }
  if (op === OP.AUTH_CHECK_REGISTER) {
    return { code: OK, msg: '', data: data || { exists: false } };
  }
  if (op === OP.WALLET_GOLD) {
    return {
      code: OK,
      msg: '',
      data: data || { game_gold: 0, totalGold: 0, bonus: 0, bonusRequireBet: 0, auditMode: 0 }
    };
  }
  return { code: OK, msg: '', data };
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
