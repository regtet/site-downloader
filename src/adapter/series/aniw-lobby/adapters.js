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
    hasWithdrawPasswd: !!(user && (user.hasWithdrawPasswd || (user.permissionOpt && user.permissionOpt.hasWithdrawPasswd))),
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
    nickname: (user.nickname != null && String(user.nickname).trim())
      ? String(user.nickname)
      : (user.account ? String(user.account) : ''),
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

/**
 * 注册成功弹窗 registerPopupDlgInfo：必须是对象（content + buttons），
 * 若回 []，前端仍会打开弹窗但只剩标题（缺正文与 Baixar APP / Deposite agora）。
 */
function adaptRegisterPopup(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const { defaultRegisterPopupPayload } = require('../../providers/wgame/popup-config');
  const raw = providerResult.data;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && (raw.content || raw.buttons)) {
    return envelope(raw);
  }
  return envelope(defaultRegisterPopupPayload());
}

/** 注册弹窗 Download 按钮依赖的 APP 下载配置 */
function adaptAppDownload(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const { defaultAppDownloadPayload } = require('../../providers/wgame/popup-config');
  const raw = providerResult.data;
  if (raw && typeof raw === 'object' && Array.isArray(raw.downloadList) && raw.downloadList.length) {
    return envelope(raw);
  }
  return envelope(defaultAppDownloadPayload());
}

/**
 * /api/active/tasks/task：必须是带 rules 的任务对象。
 * emptyRecords 会变成 {list:[]}，dist 的 taskSeries 队列 beforeOpen 直接 false，Diário 弹不起来。
 */
function adaptTaskDetail(providerResult, ctx) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const { defaultTaskPayload } = require('../../providers/wgame/popup-config');
  const raw = providerResult.data;
  if (raw && typeof raw === 'object' && !Array.isArray(raw) && Array.isArray(raw.rules) && raw.rules.length) {
    return envelope(raw);
  }
  const body = (ctx && ctx.body) || {};
  return envelope(defaultTaskPayload(body));
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
    code: 1,
    game_gold: gold,
    bonus: '0',
    totalGold: String(gold),
    bonusRequireBet: '0',
    auditMode: 1
  });
}

function vipNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** wgame 等级行 → 官方 VipSettings 一项。没有的奖励、图标留 0 / 空字符串。 */
function toOfficialVipSetting(it) {
  const row = it || {};
  const vip = vipNum(row.vip);
  return {
    vip,
    name: row.name ? String(row.name) : ('VIP' + vip),
    valid_bet: vipNum(row.valid_bet != null ? row.valid_bet : row.level_up_bet),
    total_deposit: vipNum(row.total_deposit != null ? row.total_deposit : row.level_up_deposit),
    vip_gift: vipNum(row.vip_gift != null ? row.vip_gift : row.upLevelAward),
    birthday_gift: vipNum(row.birthday_gift),
    day_bet: vipNum(row.day_bet),
    day_bonus: vipNum(row.day_bonus),
    week_bet: vipNum(row.week_bet),
    week_bonus: vipNum(row.week_bonus != null ? row.week_bonus : row.weekAward),
    month_bet: vipNum(row.month_bet),
    month_bonus: vipNum(row.month_bonus != null ? row.month_bonus : row.monthAward),
    icon_color: row.icon_color ? String(row.icon_color) : '',
    icon_style: row.icon_style ? String(row.icon_style) : '',
    day_deposit: vipNum(row.day_deposit),
    week_deposit: vipNum(row.week_deposit),
    month_deposit: vipNum(row.month_deposit),
    level_up_bet: vipNum(row.level_up_bet),
    level_up_deposit: vipNum(row.level_up_deposit),
    last_month_deposit: 0,
    last_month_bet: 0,
    max_month_bonus: 0,
    max_week_bonus: 0,
    max_day_bonus: 0,
    icon_card: '',
    icon_final_image: '',
    vip_gift_status: 0,
    week_bonus_status: 0,
    month_bonus_status: 0,
    day_bonus_status: 0,
    maximumDailyWithdrawalAmount: vipNum(row.maximumDailyWithdrawalAmount != null ? row.maximumDailyWithdrawalAmount : row.dayMaxWithdrawMoney),
    maximumDailyWithdrawalFreeOfFee: 0,
    maximumDailyWithdrawalNumber: vipNum(row.maximumDailyWithdrawalNumber != null ? row.maximumDailyWithdrawalNumber : row.withdrawTimes),
    birthday_gift_status: 0,
    birthday_gift_receive_duration: 0,
    vip_gift_receive_duration: 0,
    week_bonus_receive_duration: 0,
    month_bonus_receive_duration: 0,
    day_bonus_receive_duration: 0,
    bCanReceiveTime: 0,
    vCanReceiveTime: 0,
    wCanReceiveTime: 0,
    mCanReceiveTime: 0,
    dCanReceiveTime: 0,
    vTimeType: 0,
    bTimeType: 0,
    dTimeType: 0,
    wTimeType: 0,
    wTimeDay: 0,
    mTimeType: 0,
    mTimeDay: 0,
    giftlogs: null,
    weeklogs: null,
    monthlogs: null,
    daylogs: null,
    birthdaylogs: null,
    receivedgiftlogs: null,
    vgRcedStatus: 0,
    dbRcedStatus: 0,
    wbRcedStatus: 0,
    mbRcedStatus: 0,
    bdRcedStatus: 0
  };
}

function officialVipLadder(user) {
  const raw = user && Array.isArray(user.VipSettings) ? user.VipSettings : [];
  const settings = raw.map(toOfficialVipSetting);
  const level = vipNum(user && (user.vip_level != null ? user.vip_level : user.vip));
  const cur = settings.find((row) => row.vip === level) || null;
  const next = settings.find((row) => row.vip === level + 1) || null;
  const deposit = vipNum(user && user.curPoint);
  const bet = vipNum(user && user.curWater);
  const nextDep = next ? next.level_up_deposit : 0;
  const nextBet = next ? next.level_up_bet : 0;
  return {
    settings,
    level,
    cur,
    next,
    deposit,
    bet,
    nextDep,
    nextBet,
    needDeposit: Math.max(0, nextDep - deposit),
    needBet: Math.max(0, nextBet - bet)
  };
}

/**
 * /api/member/user/vip —— 个人中心进度卡
 * 官方字段：vip / next_vip / need_deposit / need_validbet / user_deposit / user_validbet
 */
function adaptVipSummary(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const user = providerResult.data || {};
  const p = officialVipLadder(user);
  const nickname = (user.nickname != null && String(user.nickname).trim())
    ? String(user.nickname)
    : '';
  return envelope({
    vip: p.level,
    vip_status: 1,
    user_validbet: p.bet,
    user_deposit: p.deposit,
    next_vip: p.next ? p.next.vip : p.level,
    next_vip_validbet: p.nextBet,
    need_validbet: p.needBet,
    next_vip_deposit: p.nextDep,
    need_deposit: p.needDeposit,
    username: user.userId != null ? String(user.userId) : '',
    nickname,
    useridx: vipNum(user.userId),
    realname: '',
    birthday: '',
    weichat: '',
    wechat: '',
    whatsapp: '',
    facebook: '',
    telegram: '',
    zalo: '',
    line: '',
    twitter: '',
    threads: '',
    instagram: '',
    facebook_disable_edit: 0,
    phone: user.phone ? String(user.phone) : '',
    email: user.email ? String(user.email) : '',
    show_deposit: true,
    show_valid_bet: true,
    icon_style: '',
    icon_color: '',
    icon_color_value: '',
    next_icon_style: '',
    next_icon_color: '',
    next_icon_color_value: '',
    registerTime: vipNum(user.register_time),
    background_index: '',
    current_style: '2',
    vip_icon_show_type: '0',
    icon_card: '',
    icon_final_image: '',
    nex_vip_gift: p.next ? p.next.vip_gift : 0
  });
}

/** /api/member/user/vipDetails —— 当前等级的门槛和奖金 */
function adaptVipDetails(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const p = officialVipLadder(providerResult.data || {});
  const cur = p.cur || toOfficialVipSetting({ vip: p.level });
  return envelope({
    vip: p.level,
    name: cur.name,
    vip_status: 1,
    valid_bet: cur.valid_bet,
    total_deposit: cur.total_deposit,
    vip_gift: cur.vip_gift,
    vip_bonus: 0,
    vip_bonus_details: [],
    month_bet: cur.month_bet,
    month_deposit: cur.month_deposit,
    month_bonus: cur.month_bonus,
    week_bet: cur.week_bet,
    week_deposit: cur.week_deposit,
    week_bonus: cur.week_bonus,
    day_bet: cur.day_bet,
    day_deposit: cur.day_deposit,
    day_bonus: cur.day_bonus,
    keep_level_bet: 0,
    keep_level_deposit: 0,
    vip_gift_status: 0,
    week_bonus_status: 0,
    month_bonus_status: 0,
    day_bonus_status: 0,
    icon_style: '',
    icon_color: '',
    icon_color_value: '',
    icon_card: '',
    icon_final_image: '',
    show_deposit: true,
    show_valid_bet: true,
    birthday_gift_status: 0,
    birthday_gift_receive_duration: 0,
    vip_gift_receive_duration: 0,
    week_bonus_receive_duration: 0,
    month_bonus_receive_duration: 0,
    day_bonus_receive_duration: 0,
    saveTime: 0
  });
}

/** /api/member/user/vipInfoV2 —— 整张等级表，进度数字在 /vip */
function adaptVipInfoV2(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const p = officialVipLadder(providerResult.data || {});
  return envelope({
    VipSettings: p.settings,
    VipRule: '',
    ruleTextData: {},
    ruleType: 0,
    translateRuleText: '',
    totalAmount: 0,
    totalVipReward: 0,
    weekReceiveDate: 0,
    monthReceiveDate: 0,
    keepLevelStatus: 0,
    current_style: '2',
    vip_icon_show_type: '0',
    vipShowQuestionStatus: 0
  });
}

/** /api/active/allVipLevel、/api/member/vipInfoUnLogin */
function adaptVipLevelList(providerResult) {
  const data = (providerResult && providerResult.ok && providerResult.data) || {};
  const p = officialVipLadder(data);
  return envelope({
    VipSettings: p.settings,
    vip_icon_show_type: '0',
    icon_color_value: '',
    icon_style: '',
    icon_color: '',
    current_vip: p.level,
    current_style: '2',
    serverTime: Math.floor(Date.now() / 1000)
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
  if (providerResult && providerResult.ok) {
    const d = providerResult.data;
    if (Array.isArray(d)) return envelope(d);
    return envelope(d && typeof d === 'object' ? d : {});
  }
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
  return envelope(Object.assign({
    cardIDTypeMap: {},
    checkCpfRule: 0,
    emailVerify: '',
    mobileVerify: '',
    list: [],
    pageChannelMode: 0,
    pageReduceMode: 0,
    pageRenderMode: 0,
    payTabConfig: '',
    sign_key: ''
  }, d, {
    list: Array.isArray(d.list) ? d.list : []
  }));
}

/** payTypeV4：data.payKind.list */
function enrichPayTypeRow(row) {
  const out = Object.assign({}, row || {});
  const name = out.pay_type_name || out.name || out.payment_name || 'PIX';
  out.pay_type_name = name;
  out.payment_name = out.payment_name || name;
  out.name = out.name || name;
  if (!out.payplatformid && out.paymentid != null) out.payplatformid = out.paymentid;
  if (!out.paymentid && out.payplatformid != null) out.paymentid = out.payplatformid;
  if (!out.id && out.paymentid != null) out.id = out.paymentid;
  return out;
}

function adaptPayType(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  const raw = (d.payKind && Array.isArray(d.payKind.list))
    ? d.payKind.list
    : (Array.isArray(d.list) ? d.list : []);
  const list = raw.map(enrichPayTypeRow);
  return envelope({ payKind: { list } });
}

/** payplatformlist：渠道包 */
function normalizeRecommendListForUi(list) {
  if (!Array.isArray(list)) return [];
  return list.map((row) => {
    if (row != null && typeof row === 'object' && !Array.isArray(row)) {
      return row.amount != null ? row : row;
    }
    const amount = String(row != null ? row : '').trim();
    return amount ? { amount } : null;
  }).filter(Boolean);
}

function adaptPayChannels(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  const list = Array.isArray(d.list) ? d.list.map((ch) => {
    const row = Object.assign({}, ch);
    if (Array.isArray(row.recommendList)) {
      row.recommendList = normalizeRecommendListForUi(row.recommendList);
    }
    return row;
  }) : [];
  return envelope({
    list,
    min: d.min != null ? String(d.min) : '0',
    max: d.max != null ? String(d.max) : '0',
    url: d.url || '',
    realInfoRule: d.realInfoRule != null ? d.realInfoRule : 0,
    recommendList: normalizeRecommendListForUi(d.recommendList),
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

/** gameApi/login → { game_url, gameName, direction, gameid, platfromid } */
function adaptGameLaunch(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  return envelope({
    game_url: d.game_url || d.gameUrl || '',
    gameName: d.gameName || d.name || '',
    direction: d.direction != null ? Number(d.direction) : 1,
    gameid: d.gameid != null ? d.gameid : (d.gameId != null ? d.gameId : 0),
    platfromid: d.platfromid != null ? d.platfromid : (d.platformId != null ? d.platformId : ''),
    platformId: d.platformId != null ? d.platformId : (d.platfromid != null ? d.platfromid : '')
  });
}

/** 代理配置/报表：透传 provider 数据，首页和佣金子页补成官方字段 */
function adaptAgentBlob(providerResult, meta) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data;
  const route = String((meta && meta.routePath) || '');
  if (/indexInfoV2|agentBasic$/.test(route)) {
    const src = d && typeof d === 'object' ? d : {};
    const lv1 = Number(src.lv1PersonCount) || 0;
    const other = (Number(src.lv2PersonCount) || 0) + (Number(src.lv3PersonCount) || 0);
    return envelope({
      directMembers: src.directMembers != null ? src.directMembers : (src.directCount != null ? src.directCount : lv1),
      otherMembers: src.otherMembers != null ? src.otherMembers : other,
      activeJson: typeof src.activeJson === 'string' ? src.activeJson : '[]',
      directPerformanceYet: src.directPerformanceYet != null ? src.directPerformanceYet : (Number(src.lv1Running) || 0),
      isAgent: !!src.isAgent,
      parentUserIdx: Number(src.parentUserIdx) || 0,
      parentUsername: src.parentUsername || '',
      promoteLevelId: Number(src.promoteLevelId) || 0,
      promoteLevelName: src.promoteLevelName || '',
      isProAgent: !!src.isProAgent,
      proAgentStatus: src.proAgentStatus != null ? src.proAgentStatus : 0
    });
  }
  if (/agentCommission|myCommission/i.test(route)) {
    const src = d && typeof d === 'object' ? d : {};
    const direct = Number(src.totalDirectCommission != null ? src.totalDirectCommission : src.lv1Bonus) || 0;
    const other = Number(src.totalOtherCommission != null ? src.totalOtherCommission : ((Number(src.lv2Bonus) || 0) + (Number(src.lv3Bonus) || 0))) || 0;
    const total = Number(src.totalCommission != null ? src.totalCommission : (direct + other)) || 0;
    return envelope({
      canTakeCommission: Number(src.canTakeCommission != null ? src.canTakeCommission : total) || 0,
      takenCommission: Number(src.takenCommission) || 0,
      totalCommission: total,
      totalDirectCommission: direct,
      totalOtherCommission: other,
      directPerformance: Number(src.directPerformanceYet != null ? src.directPerformanceYet : src.lv1Running) || 0,
      parentUserIdx: Number(src.parentUserIdx) || 0,
      parentUsername: src.parentUsername || '',
      agentLevel: Number(src.agentLevel) || 0,
      agentLevelName: src.agentLevelName || '',
      currency: src.currency || 'BRL',
      maxCommissionRateList: Array.isArray(src.maxCommissionRateList) ? src.maxCommissionRateList : []
    });
  }
  if (Array.isArray(d)) return envelope(d);
  return envelope(d && typeof d === 'object' ? d : {});
}

function agentReportShell(extra) {
  return {
    list: [],
    totalRecords: 0,
    total: 0,
    totalDeposit: 0,
    directDeposit: 0,
    otherDeposit: 0,
    totalDepositPerson: 0,
    directDepositPerson: 0,
    otherDepositPerson: 0,
    totalWithdraw: 0,
    directWithdraw: 0,
    otherWithdraw: 0,
    totalWithdrawCount: 0,
    directWithdrawCount: 0,
    otherWithdrawCount: 0,
    totalFirstDeposit: 0,
    directFirstDeposit: 0,
    otherFirstDeposit: 0,
    totalFirstDepositPerson: 0,
    directFirstDepositPerson: 0,
    otherFirstDepositPerson: 0,
    totalRegisterPerson: 0,
    directRegisterPerson: 0,
    otherRegisterPerson: 0,
    totalValidBet: 0,
    directValidBet: 0,
    otherValidBet: 0,
    totalProfitLose: 0,
    directProfitLose: 0,
    otherProfitLose: 0,
    directCoupon: 0,
    ...(extra || {})
  };
}

/** 直属财务页：页脚用代理统计，没有逐人明细时 list 为空且 totalRecords 为 0，分页会停 */
function adaptAgentFinance(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const src = providerResult.data && typeof providerResult.data === 'object' ? providerResult.data : {};
  const n = (v) => Number(v) || 0;
  const directDeposit = n(src.lv1Deposit);
  const otherDeposit = n(src.lv2Deposit) + n(src.lv3Deposit);
  const directWithdraw = n(src.lv1Withdraw);
  const otherWithdraw = n(src.lv2Withdraw) + n(src.lv3Withdraw);
  const directFirst = n(src.lv1FirstDeposit);
  const otherFirst = n(src.lv2FirstDeposit) + n(src.lv3FirstDeposit);
  const directFirstPerson = n(src.lv1FirstDepositPerson);
  const otherFirstPerson = n(src.lv2FirstDepositPerson) + n(src.lv3FirstDepositPerson);
  const directReg = n(src.directMembers != null ? src.directMembers : src.lv1PersonCount);
  const otherReg = n(src.otherMembers != null ? src.otherMembers : (n(src.lv2PersonCount) + n(src.lv3PersonCount)));
  const directBet = n(src.directPerformanceYet != null ? src.directPerformanceYet : src.lv1Running);
  const otherBet = n(src.lv2Running) + n(src.lv3Running);
  return envelope(agentReportShell({
    totalDeposit: n(src.totalDeposit) || (directDeposit + otherDeposit),
    directDeposit,
    otherDeposit,
    totalWithdraw: n(src.totalWithdraw) || (directWithdraw + otherWithdraw),
    directWithdraw,
    otherWithdraw,
    totalFirstDeposit: directFirst + otherFirst,
    directFirstDeposit: directFirst,
    otherFirstDeposit: otherFirst,
    totalFirstDepositPerson: directFirstPerson + otherFirstPerson,
    directFirstDepositPerson: directFirstPerson,
    otherFirstDepositPerson: otherFirstPerson,
    totalRegisterPerson: directReg + otherReg,
    directRegisterPerson: directReg,
    otherRegisterPerson: otherReg,
    totalValidBet: n(src.totalRunning) || (directBet + otherBet),
    directValidBet: directBet,
    otherValidBet: otherBet
  }));
}

/** 直属订单/优惠券没有逐笔数据：空页，成功码，避免 10060 */
function adaptAgentReportEmpty(providerResult) {
  if (providerResult && providerResult.ok === false) return failEnvelope(providerResult);
  return envelope(agentReportShell());
}

function adaptAgentSettleTime(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  return envelope({
    nextSettleTime: Number(d.nextSettleTime) || 0,
    settleDeadLine: Number(d.settleDeadLine) || 0,
    nextInterval: Number(d.nextInterval) || 0
  });
}

function adaptMaxChargeRate(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope({
    charge_rate: 0,
    chargeRate: '0',
    chargeGiftColor: '',
    maxGiftScore: '',
    chargeConfig: { chargeRate: '', giftColor: '', targetAmount: '0' },
    customerRate: '0',
    customerMode: 0,
    customerColor: '',
    agentRate: '0',
    agentMode: 0,
    paymentMode: 0
  });
}

function adaptWithdrawPending(providerResult) {
  if (providerResult && providerResult.ok) {
    const d = providerResult.data;
    return envelope(d && typeof d === 'object' ? d : {});
  }
  const msg = (providerResult && providerResult.msg)
    || 'withdraw adapter pending';
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

/** 平台元数据：透传 provider 从 index.html 合成的配置 */
function adaptPlatformPayload(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope(providerResult.data && typeof providerResult.data === 'object' ? providerResult.data : {});
}

/** 心跳/埋点/充值辅接口：有 data 则透传（calculateGift / fee 等） */
function adaptLobbyOk(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data;
  if (d == null) return envelope({});
  if (Array.isArray(d)) return envelope(d);
  return envelope(typeof d === 'object' ? d : {});
}

/**
 * 流水类空列表（新号真实无记录）
 * 同时带 list/total/records/rows，兼容不同前端读取
 */
function adaptEmptyRecords(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  const list = Array.isArray(d.list) ? d.list : [];
  const out = Object.assign({}, d, {
    list,
    total: d.total != null ? Number(d.total) : list.length,
    count: d.count != null ? Number(d.count) : list.length,
    records: Array.isArray(d.records) ? d.records : list,
    rows: Array.isArray(d.rows) ? d.rows : list,
    page: d.page != null ? d.page : 1,
    pageSize: d.pageSize != null ? d.pageSize : 20,
    totalRecords: d.totalRecords != null
      ? Number(d.totalRecords)
      : (d.total != null ? Number(d.total) : list.length)
  });
  return envelope(out);
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

/**
 * 官方待领取/已领取/已过期列表。
 * 分页用 data.count 判断是否结束；缺 count 时客户端会一直翻下一页。
 */
function adaptAwardList(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const d = providerResult.data || {};
  const list = Array.isArray(d.list) ? d.list : [];
  return envelope({
    totalReward: Number(d.totalReward) || 0,
    totalActivity: Number(d.totalActivity) || 0,
    count: d.count != null ? Number(d.count) : list.length,
    list,
    redDotCount: d.redDotCount != null ? Number(d.redDotCount) : 0,
    redDotAmount: d.redDotAmount != null ? Number(d.redDotAmount) : 0
  });
}

/** 官方可领取弹窗零态。没有奖励时列表为空，不写活动文案。 */
function adaptCanReceivePop(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope({
    list: null,
    surpriseReward: {
      type: '',
      rewardList: [],
      setting: { switch: 'close', taskCondition: '{}' },
      receiveDeviceType: ''
    },
    agentInviterReward: {},
    disableReceiveLogPop: 0,
    guessIntegralPop: { list: null }
  });
}

/** 官方返水汇总零态。没有返水活动时金额为 0，不填官方分类。 */
function adaptReturnGoldSummary(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  return envelope({
    headerType: 1,
    todayForecast: { mainAmount: 0, rewardExpireTime: 0 },
    nextDayForecast: null,
    autoSendForecast: null,
    todayReceivedAmount: 0,
    todayCanReceiveAmount: 0,
    todayValidBet: 0,
    curReturnGold: 0,
    nextReturnGold: 0,
    autoSendReturnGold: 0,
    initAmount: 0,
    needRequestAmount: 0,
    needApplyAmount: 0,
    clientCalculateDelta: false,
    activeId: 0,
    returnGoldType: 0,
    receiveDeviceType: '',
    receiveDeviceLoginType: '',
    list: []
  });
}

/** 官方余额宝首页零态。开关关闭，不写规则文案。 */
function adaptYuebaoIndex(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const gold = Number(providerResult.data && providerResult.data.game_gold) || 0;
  return envelope({
    switchStatus: 0,
    yuebaoGold: 0,
    curIncome: 0,
    yearRate: 0,
    settleType: 0,
    totalIncome: 0,
    dayRate: 0,
    cycleIncome: 0,
    cycleTime: 0,
    minSave: 0,
    gameGold: gold,
    validBetTimes: 0,
    nextCalculateIncomeTime: 0,
    nextCycleTime: 0,
    principal: 0,
    isPop: 0,
    receiveType: 0,
    todayUnclaimed: 0,
    claimed: 0,
    interestTop: 0,
    ruleText: '',
    list: [],
    ruleTextData: {}
  });
}

function adaptUnreadCount(providerResult) {
  if (!providerResult || !providerResult.ok) return failEnvelope(providerResult);
  const n = Number(providerResult.data && providerResult.data.unreadCnt) || 0;
  return envelope({ unreadCnt: n });
}

/** 官方 /api/member/user/security/status：每项 verifyMethods，没有绑定记录时 withdrawPass 为空对象 */
function adaptSecurityStatus() {
  const block = { verifyMethods: { loginPass: 1 } };
  return envelope({
    loginPass: block,
    question: block,
    googleAuth: block,
    phone: block,
    email: block,
    withdrawPass: {},
    gesture: block,
    thirdParty: block,
    webAuthn: block
  });
}

/** 官方 /api/active/withdraw/getAllActive：无提现活动时 activeList 为空 */
function adaptWithdrawActiveList() {
  return envelope({ activeList: [], SmallTypeMap: null });
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
  vipInfoV2: adaptVipInfoV2,
  vipLevelList: adaptVipLevelList,
  securityStatus: adaptSecurityStatus,
  withdrawActiveList: adaptWithdrawActiveList,
  awardList: adaptAwardList,
  canReceivePop: adaptCanReceivePop,
  returnGoldSummary: adaptReturnGoldSummary,
  yuebaoIndex: adaptYuebaoIndex,
  unreadCount: adaptUnreadCount,
  avatars: adaptAvatars,
  payPending: adaptPayPending,
  payList: adaptPayList,
  payType: adaptPayType,
  payChannels: adaptPayChannels,
  payInfos: adaptPayInfos,
  payCreate: adaptPayCreate,
  payOrderInfo: adaptPayOrderInfo,
  gameLaunch: adaptGameLaunch,
  agentBlob: adaptAgentBlob,
  agentFinance: adaptAgentFinance,
  agentReportEmpty: adaptAgentReportEmpty,
  agentSettleTime: adaptAgentSettleTime,
  maxChargeRate: adaptMaxChargeRate,
  withdrawPending: adaptWithdrawPending,
  logout: adaptLogout,
  lobbyOk: adaptLobbyOk,
  platformPayload: adaptPlatformPayload,
  emptyRecords: adaptEmptyRecords,
  emptyList: adaptEmptyList,
  registerPopup: adaptRegisterPopup,
  appDownload: adaptAppDownload,
  taskDetail: adaptTaskDetail,
  redDotEmpty: adaptRedDotEmpty,
  fingerprint: adaptFingerprint,
  listAccount: adaptListAccount,
  featurePending: adaptFeaturePending
};

function applyAdapter(adapterName, providerResult, meta) {
  const fn = ADAPTERS[adapterName];
  if (!fn) {
    return failEnvelope({
      ok: false,
      code: 10060,
      msg: 'adapter pending: ' + String(adapterName || '')
    });
  }
  return fn(providerResult, meta);
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
  adaptRegisterPopup,
  adaptAppDownload,
  adaptTaskDetail,
  adaptWalletGold,
  adaptVipSummary,
  adaptVipDetails,
  adaptVipInfoV2,
  adaptVipLevelList,
  adaptAvatars,
  adaptPayPending,
  adaptPayList,
  adaptPayType,
  adaptPayChannels,
  adaptPayInfos,
  adaptPayCreate,
  adaptPayOrderInfo,
  adaptGameLaunch,
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
