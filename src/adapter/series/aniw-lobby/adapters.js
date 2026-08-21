/**
 * Response Adapters：仅映射 wgame 真实有的字段 → 目标 dist 字段名
 * 禁止伪造 currency / permissionOpt / bonus / 支付渠道列表 等缺失数据
 */
const OK = 1;

/** 目标站 portrait_id 必须是可加载的图片 path/URL，不能是 face id 数字 */
const DEFAULT_PORTRAIT = '/lobby_asset/common/common/common/default_man.png';

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

function resolvePortraitUrl(faceId) {
  if (faceId == null || faceId === '') return DEFAULT_PORTRAIT;
  const s = String(faceId).trim();
  if (!s) return DEFAULT_PORTRAIT;
  if (/^https?:\/\//i.test(s) || s.startsWith('/lobby_asset/') || s.startsWith('/')) {
    // 纯数字 path 非法
    if (/^\/?\d+$/.test(s)) return DEFAULT_PORTRAIT;
    return s.startsWith('/') || /^https?:\/\//i.test(s) ? s : DEFAULT_PORTRAIT;
  }
  // wgame faceID 是整数，不能直接当 img src
  if (/^\d+$/.test(s)) return DEFAULT_PORTRAIT;
  return DEFAULT_PORTRAIT;
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

  // 个人中心展示名：UI 主读 username；nickname 同步避免空白
  if (user.nickname) out.nickname = String(user.nickname);
  else if (username) out.nickname = String(username);

  if (user.phone) {
    out.phone = String(user.phone);
    out.mobile_phone = String(user.phone);
  }
  if (user.email) out.email = String(user.email);

  if (user.vip_level != null && user.vip_level !== '') {
    out.vip_level = Number(user.vip_level);
  }

  // 登录后必给可用头像 path（默认图来自目标站静态约定，非伪造用户资产）
  const portrait = resolvePortraitUrl(user.face_id);
  out.portrait_id = portrait;
  out.headimg = portrait;
  out.avatar = portrait;
  if (user.face_id != null && user.face_id !== '') {
    out.face_id = String(user.face_id);
  }

  if (user.device_id) out.deviceFingerprint = String(user.device_id);

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

function adaptWalletGold(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  if (d.game_gold == null && d.totalGold == null) {
    return failEnvelope({ ok: false, code: 401, msg: 'no gold in session' });
  }
  const gold = Number(d.game_gold != null ? d.game_gold : d.totalGold);
  return envelope({
    game_gold: gold,
    totalGold: gold,
    availableMargin: gold
  });
}

/**
 * VIP 摘要：仅用会话 vip_level（wgame 大厅真实字段）
 * 不填 need_deposit / 打码等未知进度
 */
function adaptVipSummary(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const level = Number((providerResult.data && providerResult.data.vip_level) || 0);
  return envelope({
    vip: level,
    vip_level: level
  });
}

function adaptVipDetails(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const level = Number((providerResult.data && providerResult.data.vip_level) || 0);
  return envelope({
    vip: level,
    vip_level: level
  });
}

/**
 * 头像列表：返回目标站默认头像 path（静态资源约定）
 * 供个人中心选头像；不含伪造的用户自定义 CDN
 */
function adaptAvatars(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const current = resolvePortraitUrl(providerResult.data && providerResult.data.face_id);
  const list = [
    { id: 'default_man', url: DEFAULT_PORTRAIT, portrait_id: DEFAULT_PORTRAIT },
    {
      id: 'default_profile',
      url: '/lobby_asset/common/common/profile/icon_wd_mrtx.png',
      portrait_id: '/lobby_asset/common/common/profile/icon_wd_mrtx.png'
    }
  ];
  return envelope({
    list,
    current,
    portrait_id: current
  });
}

/** wgame 尚无支付能力：明确失败，禁止空成功壳 */
function adaptPayPending(providerResult) {
  const msg = (providerResult && providerResult.msg)
    || 'payment adapter pending: wgame has no pay channel';
  const code = (providerResult && providerResult.code != null) ? providerResult.code : 10060;
  return {
    code: code === OK ? 10060 : code,
    msg,
    data: null
  };
}

const ADAPTERS = {
  memberProfile: adaptMemberProfile,
  checkRegister: adaptCheckRegister,
  walletGold: adaptWalletGold,
  vipSummary: adaptVipSummary,
  vipDetails: adaptVipDetails,
  avatars: adaptAvatars,
  payPending: adaptPayPending
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
  DEFAULT_PORTRAIT,
  ADAPTERS,
  applyAdapter,
  memberProfile,
  adaptMemberProfile,
  adaptWalletGold,
  adaptVipSummary,
  adaptVipDetails,
  adaptAvatars,
  adaptPayPending,
  resolvePortraitUrl,
  failEnvelope,
  envelope
};
