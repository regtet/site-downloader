/**
 * P0 响应 Adapter：仅映射 wgame 真实有的字段 → 目标 dist 字段名
 * 禁止伪造 currency/account_type/permissionOpt/bonus 等缺失数据
 */
const OK = 1;

function envelope(data, msg) {
  return { code: OK, msg: msg || '', data };
}

function failEnvelope(providerResult) {
  const code = providerResult && providerResult.code != null ? providerResult.code : 1011;
  const failCode = code === OK ? 1011 : code;
  return {
    code: failCode,
    msg: (providerResult && providerResult.msg) || 'error',
    data: null
  };
}

/**
 * CanonicalUser → 目标登录/用户 data（只含有值的字段）
 */
function memberProfile(user) {
  if (!user) return null;
  const out = {};

  const username = user.account || user.nickname;
  if (username) out.username = String(username);

  const session = user.session;
  if (session) {
    out.session_key = String(session);
    // 目标站多处读 jwt_token / token，与 session 同源（字段别名，非伪造）
    out.jwt_token = String(session);
    out.token = String(session);
  }

  if (user.userId != null && user.userId !== '') {
    const id = String(user.userId);
    out.userkey = id;
    out.user_id = id;
    out.userid = id;
  }

  if (user.game_gold != null && user.game_gold !== '') {
    out.game_gold = Number(user.game_gold);
  }

  if (user.nickname) out.nickname = String(user.nickname);
  else if (username) out.nickname = String(username);

  if (user.phone) {
    out.phone = String(user.phone);
    out.mobile_phone = String(user.phone);
  }
  if (user.email) out.email = String(user.email);

  if (user.vip_level != null) out.vip_level = Number(user.vip_level);

  if (user.face_id != null && user.face_id !== '') {
    const face = String(user.face_id);
    out.portrait_id = face;
    out.headimg = face;
    out.avatar = face;
  }

  if (user.device_id) out.deviceFingerprint = String(user.device_id);

  // 大厅协议里的真实 accountType（有则映射，无则不写）
  if (user.account_type != null && user.account_type !== '') {
    out.account_type = Number(user.account_type);
  }

  if (user.currency) out.currency = String(user.currency);

  if (user.first_login != null) out.bFirstLogin = user.first_login;
  if (user.has_recharge != null) out.bHasRecharge = user.has_recharge;

  return out;
}

function adaptMemberProfile(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const data = memberProfile(providerResult.data);
  if (!data) return failEnvelope({ ok: false, code: 401, msg: 'not logged in' });
  return envelope(data);
}

function adaptCheckRegister(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const exists = !!(providerResult.data && providerResult.data.exists);
  return envelope({ exists });
}

/**
 * wallet.gold：只输出 wgame 会话里的金币；同值别名允许，禁止填 0 的 bonus 等
 */
function adaptWalletGold(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  if (d.game_gold == null && d.totalGold == null) {
    return failEnvelope({ ok: false, code: 401, msg: 'no gold in session' });
  }
  const gold = Number(d.game_gold != null ? d.game_gold : d.totalGold);
  const out = { game_gold: gold };
  // 目标 UI 常读 totalGold / availableMargin，与 game_gold 同源
  out.totalGold = gold;
  out.availableMargin = gold;
  return envelope(out);
}

const ADAPTERS = {
  memberProfile: adaptMemberProfile,
  checkRegister: adaptCheckRegister,
  walletGold: adaptWalletGold
};

function applyAdapter(adapterName, providerResult) {
  const fn = ADAPTERS[adapterName];
  if (!fn) {
    return failEnvelope({
      ok: false,
      code: 10060,
      msg: 'adapter pending: ' + String(adapterName || '')
    });
  }
  return fn(providerResult);
}

module.exports = {
  OK,
  ADAPTERS,
  applyAdapter,
  memberProfile,
  adaptMemberProfile,
  adaptWalletGold,
  failEnvelope,
  envelope
};
