/**
 * 目标站真实 userInfos 形状参考（来自官方站注册后 localStorage）
 * 用于 Adapter 对齐；勿把 JWT/session 写进仓库。
 *
 * username: number (会员数字 ID，不是登录账号字符串)
 * nickname: "" 注册后可为空
 * portrait_id: https://... CDN 图
 * session_key / jwt_token: 官方是两套；我们无 JWT 时用 session 别名
 * userkey: 官方 fil_ 长串；我们无加密协议时用 session
 * permissionOpt: 能力开关，应按真实绑定状态填
 */
const OK = 1;

/** 官方站默认头像（注册后真实 portrait_id） */
const DEFAULT_PORTRAIT_CDN =
  'https://g8wuzk-12025-ppp.s3.sa-east-1.amazonaws.com/siteadmin/upload/img/2003557522981953538.png';

/** VIP style=2 官方默认图标（vipDetails 真实值） */
const DEFAULT_VIP_ICON_STYLE =
  'https://a6ilcy-10588-ppp.s3.sa-east-1.amazonaws.com/siteadmin/active/style2/iconStyle/style_2_vip_style0.png';
const DEFAULT_VIP_ICON_COLOR =
  'https://g8wuzk-12025-ppp.s3.sa-east-1.amazonaws.com/siteadmin/active/style2/iconColor/style_2_vip_color1.png';
const DEFAULT_VIP_ICON_COLOR_VALUE = '24B299';

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

function toMemberUsername(userId, account) {
  if (userId != null && userId !== '') {
    const raw = String(userId).trim();
    const n = Number(raw);
    // 官方 username 是数字类型
    if (Number.isFinite(n) && String(n) === raw) return n;
    return raw;
  }
  if (account) return String(account);
  return undefined;
}

function resolvePortraitUrl(faceId) {
  if (faceId == null || faceId === '') return DEFAULT_PORTRAIT_CDN;
  const s = String(faceId).trim();
  if (!s) return DEFAULT_PORTRAIT_CDN;
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/lobby_asset/') || (s.startsWith('/') && !/^\/\d+$/.test(s))) return s;
  // face id 数字 → 官方默认 CDN 头像
  return DEFAULT_PORTRAIT_CDN;
}

function buildPermissionOpt(user) {
  // 按会话真实绑定状态；未知提现相关一律 false（新号常见态）
  return {
    hasWithdrawPasswd: false,
    hasSecurityQuestion: false,
    hasWithdrawAccount: false,
    hasPassword: true,
    hasPhone: !!(user && user.phone),
    hasAccountDeviceId: !!(user && user.device_id),
    usernamePasswdMutable: true
  };
}

/**
 * CanonicalUser → 目标登录/注册/user.info data
 * 对齐官方 web__lobby__persisted__user.userInfos
 */
function memberProfile(user) {
  if (!user) return null;

  const uid = user.userId;
  const session = user.session ? String(user.session) : '';
  const gold = user.game_gold != null && user.game_gold !== '' ? Number(user.game_gold) : 0;
  const vipLevel = user.vip_level != null && user.vip_level !== '' ? Number(user.vip_level) : 0;
  const portrait = resolvePortraitUrl(user.face_id);
  const username = toMemberUsername(uid, user.account);

  const out = {
    // —— 会话（无独立 JWT 时与 session 同源别名）——
    session_key: session,
    jwt_token: session,
    token: session,

    // —— 身份：username=数字会员ID；nickname 官方注册后可为空 ——
    username,
    nickname: user.nickname != null ? String(user.nickname) : '',
    userkey: session || (uid != null ? String(uid) : ''),
    user_id: uid != null ? String(uid) : undefined,
    userid: uid != null ? String(uid) : undefined,

    game_gold: gold,
    totalGold: String(gold),
    bonus: '0',
    bonusRequireBet: '0',

    vip_level: vipLevel,
    vip_status: 1,
    vip_style: 2,
    vip_icon_back_color_value: DEFAULT_VIP_ICON_COLOR_VALUE,
    icon_style: DEFAULT_VIP_ICON_STYLE,
    icon_color: DEFAULT_VIP_ICON_COLOR,

    portrait_id: portrait,
    headimg: portrait,
    avatar: portrait,

    account_type: user.account_type != null && user.account_type !== ''
      ? Number(user.account_type)
      : 2,
    member_level: 1,
    user_status: 1,
    mode: 0,
    strongbox_status: 0,
    bank_status: 0,
    age: 2,

    permissionOpt: buildPermissionOpt(user),
    userOptResult: [0, 0, 0, 0, 1],

    currency: user.currency ? String(user.currency) : 'BRL',
    deposit_count: user.has_recharge ? 1 : 0,
    withdrawCount: 0,
    amount_due: 0,

    mobile_phone: user.phone ? String(user.phone) : '',
    phone: user.phone ? String(user.phone) : '',
    email: user.email ? String(user.email) : '',
    emailVerified: 0,
    is_verified: 0,
    realname: '',
    cpf: '',

    deviceFingerprint: user.device_id ? String(user.device_id) : '',
    register_time: user.register_time != null
      ? Number(user.register_time)
      : Math.floor(Date.now() / 1000),

    change_password: 0,
    changeWithdrawPassword: 0,
    must_bind_phone: 0,
    must_bind_email: 0,
    must_bind_google_auth: 0,
    mustBindWithdrawPass: 0,
    mustBindWithdrawAccount: 0,
    mustBindSecurityQuestion: 0,
    must_bind_item: 0,
    is_open_google_auth: 0,
    gesture: '',
    thirdType: 0,
    thirdEmail: '',
    thirdAccount: '',
    promoter_status: 0,
    parentId: 0,
    parentUsername: '',
    lastgameinfo: null,
    clubMemberInfo: null,
    gameSession: null,
    auditMode: 1,
    loginpwaType: 0,
    loginOsType: 0,
    pinNumberType: 0,
    pinNumberTypeName: '',
    ekycResult: 0,
    eHoldIdPhoto: -99,
    userKycCfg: { cfg: [], isAllow: 4 },
    isTrustedDevice: true,
    isDeviceFirstLogin: !!(user.first_login === 1 || user.first_login === true),
    loanStatus: 0,
    regPkgId: 0,
    member_tag_ids: '',
    platfromid: ''
  };

  // 去掉 undefined
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

function adaptMemberProfile(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const data = memberProfile(providerResult.data);
  if (!data) return failEnvelope({ ok: false, code: 401, msg: 'not logged in' });
  // 登录/user.info：data 即为 userInfos 平面对象（见 commonChunk login 解包）
  // 禁止带上会触发二次校验弹窗的字段
  delete data.loginVerify;
  delete data.firstLoginVerify;
  data.change_password = 0;
  return envelope(data);
}

/**
 * 注册接口官方形状：data.userInfos = 资料；缺嵌套则前端不走 onRegisterSuccess（表现为“无反应”）
 */
function adaptRegisterProfile(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const profile = memberProfile(providerResult.data);
  if (!profile) return failEnvelope({ ok: false, code: 401, msg: 'register profile missing' });
  delete profile.loginVerify;
  delete profile.firstLoginVerify;
  profile.change_password = 0;
  return envelope({
    userInfos: profile,
    needApprove: false
  });
}

/** 前端对 data 做 forEach（如 newcomer_benefit_pop）；必须是数组，不能是 lobbyOk 的 {} */
function adaptEmptyList(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope([]);
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
    totalGold: String(gold),
    availableMargin: gold,
    bonus: '0'
  });
}

/**
 * /api/member/user/vip —— 官方 vipInfos 常为 null；有数据时含等级进度
 * 无进度字段时只回 vip 等级
 */
function adaptVipSummary(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const level = Number((providerResult.data && providerResult.data.vip_level) || 0);
  // 官方新号 vipInfos 可为 null；回最小可用对象避免前端整页崩
  return envelope({
    vip: level,
    vip_level: level,
    vip_status: 1
  });
}

/**
 * 对齐官方 vipDetails：
 * { vip, icon_color_value, vip_status, icon_color, icon_style, current_style }
 */
function adaptVipDetails(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const level = Number((providerResult.data && providerResult.data.vip_level) || 0);
  return envelope({
    vip: level,
    vip_status: 1,
    icon_color_value: DEFAULT_VIP_ICON_COLOR_VALUE,
    icon_color: DEFAULT_VIP_ICON_COLOR,
    icon_style: DEFAULT_VIP_ICON_STYLE,
    current_style: 2
  });
}

function adaptAvatars(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const current = resolvePortraitUrl(providerResult.data && providerResult.data.face_id);
  const list = [
    {
      id: 'default_cdn',
      url: DEFAULT_PORTRAIT_CDN,
      portrait_id: DEFAULT_PORTRAIT_CDN
    }
  ];
  return envelope({
    list,
    current,
    portrait_id: current
  });
}

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

/** payListV4：data.list = 分类 tab */
function adaptPayList(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  return envelope({
    list: Array.isArray(d.list) ? d.list : [],
    cardIDTypeMap: d.cardIDTypeMap && typeof d.cardIDTypeMap === 'object' ? d.cardIDTypeMap : {}
  });
}

/** payTypeV4：data.payKind.list */
function adaptPayType(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  const list = (d.payKind && Array.isArray(d.payKind.list))
    ? d.payKind.list
    : (Array.isArray(d.list) ? d.list : []);
  return envelope({ payKind: { list } });
}

/** payplatformlist：渠道包 */
function adaptPayChannels(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  return envelope({
    list: Array.isArray(d.list) ? d.list : [],
    min: d.min != null ? String(d.min) : '0',
    max: d.max != null ? String(d.max) : '0',
    url: d.url || '',
    realInfoRule: d.realInfoRule != null ? d.realInfoRule : 0,
    recommendList: Array.isArray(d.recommendList) ? d.recommendList : [],
    sign_key: d.sign_key || ''
  });
}

/** payInfos：证件/卡列表（可空数组） */
function adaptPayInfos(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data;
  return envelope(Array.isArray(d) ? d : []);
}

/** offlineOrder：二维码/跳转下单结果 */
function adaptPayCreate(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  return envelope({
    success: true,
    orderNo: d.orderNo || d.order_no || '',
    outTradeNo: d.outTradeNo || d.orderNo || '',
    order_no: d.order_no || d.orderNo || '',
    qrCode: d.qrCode || d.qrcode_url || '',
    url: d.url || '',
    createTime: d.createTime || Math.floor(Date.now() / 1000),
    orderEffectiveTime: d.orderEffectiveTime != null ? Number(d.orderEffectiveTime) : 900,
    payCurrency: d.payCurrency || 'BRL',
    currencySign: d.currencySign || 'R$',
    channlName: d.channlName || '',
    money: d.money != null ? String(d.money) : '0',
    urlOpenWay: d.urlOpenWay != null ? Number(d.urlOpenWay) : 4
  });
}

function adaptPayOrderInfo(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope(providerResult.data != null ? providerResult.data : {});
}

/** 代理配置/报表：透传 providerOptions.agent 形状 */
function adaptAgentBlob(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data;
  if (Array.isArray(d)) return envelope(d);
  return envelope(d && typeof d === 'object' ? d : {});
}

function adaptWithdrawPending(providerResult) {
  const msg = (providerResult && providerResult.msg)
    || 'withdraw adapter pending: wgame has no withdraw channel';
  const code = (providerResult && providerResult.code != null) ? providerResult.code : 10060;
  return {
    code: code === OK ? 10060 : code,
    msg,
    data: null
  };
}

/** 登出：目标站通常只认 code===1 */
function adaptLogout(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope(true);
}

/** 心跳/埋点：无业务载荷 */
function adaptLobbyOk(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope({});
}

/**
 * 流水类空列表（新号真实无记录）
 * 同时带 list/total/records/rows，兼容不同前端读取
 */
function adaptEmptyRecords(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  return envelope({
    list: Array.isArray(d.list) ? d.list : [],
    total: d.total != null ? Number(d.total) : 0,
    records: Array.isArray(d.records) ? d.records : [],
    rows: Array.isArray(d.rows) ? d.rows : [],
    page: 1,
    pageSize: 20
  });
}

/**
 * 对齐官方 discountRedDot 零态（来自 localStorage web__lobby__persisted__discount）
 * 不伪造可领取奖励，只给前端可解析的红点结构
 */
function adaptRedDotEmpty(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope({
    activeCount: 0,
    taskCount: 0,
    returnGoldCount: 0,
    yueBaoCount: 0,
    vipCount: 0,
    svipCount: 0,
    rechargeFundCount: 0,
    activeRedDot: { activeList: [], categoryList: [] },
    taskRedDot: [],
    receiveLogCount: 0,
    turntableRedDot: 0,
    agentPromoteReward: 0
  });
}

/** 设备指纹：用会话 device_id，无则稳定空串（不随机伪造新指纹） */
function adaptFingerprint(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const fp = String(
    (providerResult.data && (providerResult.data.device_id || providerResult.data.deviceFingerprint))
    || ''
  );
  return envelope({
    fingerprint: fp,
    deviceFingerprint: fp,
    fingerId: fp
  });
}

/** 本地账号列表：仅当前会话账号（不伪造多端历史） */
function adaptListAccount(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const u = providerResult.data || {};
  const username = u.userId != null && u.userId !== ''
    ? (Number.isFinite(Number(u.userId)) ? Number(u.userId) : String(u.userId))
    : (u.account || '');
  const item = {
    username,
    account: u.account || String(username),
    nickname: u.nickname != null ? String(u.nickname) : '',
    portrait_id: resolvePortraitUrl(u.face_id),
    currency: u.currency || 'BRL',
    game_gold: Number(u.game_gold || 0)
  };
  return envelope({
    list: [item],
    accounts: [item],
    localAccounts: [item]
  });
}

function adaptFeaturePending(providerResult) {
  const msg = (providerResult && providerResult.msg)
    || 'feature adapter pending: wgame has no this capability';
  const code = (providerResult && providerResult.code != null) ? providerResult.code : 10060;
  return {
    code: code === OK ? 10060 : code,
    msg,
    data: null
  };
}

const ADAPTERS = {
  memberProfile: adaptMemberProfile,
  registerProfile: adaptRegisterProfile,
  checkRegister: adaptCheckRegister,
  walletGold: adaptWalletGold,
  vipSummary: adaptVipSummary,
  vipDetails: adaptVipDetails,
  avatars: adaptAvatars,
  payPending: adaptPayPending,
  payList: adaptPayList,
  payType: adaptPayType,
  payChannels: adaptPayChannels,
  payInfos: adaptPayInfos,
  payCreate: adaptPayCreate,
  payOrderInfo: adaptPayOrderInfo,
  agentBlob: adaptAgentBlob,
  withdrawPending: adaptWithdrawPending,
  logout: adaptLogout,
  lobbyOk: adaptLobbyOk,
  emptyRecords: adaptEmptyRecords,
  emptyList: adaptEmptyList,
  redDotEmpty: adaptRedDotEmpty,
  fingerprint: adaptFingerprint,
  listAccount: adaptListAccount,
  featurePending: adaptFeaturePending
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
  DEFAULT_PORTRAIT: DEFAULT_PORTRAIT_CDN,
  DEFAULT_PORTRAIT_CDN,
  ADAPTERS,
  applyAdapter,
  memberProfile,
  adaptMemberProfile,
  adaptRegisterProfile,
  adaptEmptyList,
  adaptWalletGold,
  adaptVipSummary,
  adaptVipDetails,
  adaptAvatars,
  adaptPayPending,
  adaptPayList,
  adaptPayType,
  adaptPayChannels,
  adaptPayInfos,
  adaptPayCreate,
  adaptPayOrderInfo,
  adaptAgentBlob,
  adaptWithdrawPending,
  adaptLogout,
  adaptLobbyOk,
  adaptEmptyRecords,
  adaptRedDotEmpty,
  adaptFingerprint,
  adaptListAccount,
  adaptFeaturePending,
  resolvePortraitUrl,
  failEnvelope,
  envelope
};
