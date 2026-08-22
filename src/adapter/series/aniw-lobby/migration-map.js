/**
 * Migration Map —— 登录后基础链 + 显式 pending + 批量安全空态
 *
 * 精确条目优先；SAFE_BULK_MAP 仅补未声明路径
 * 支付/提现渠道：*Pending；流水：emptyRecords；领取动作：featurePending
 * vipInfoV2 全量表、代理下级：暂不进表
 */
const { OP } = require('../../ops');
const { SAFE_BULK_MAP } = require('./safe-bulk-map');

/** @type {Record<string, { op: string, adapter: string, note?: string }>} */
const CORE_MAP = {
  // —— auth.login ——
  '/api/member/login': { op: OP.AUTH_LOGIN, adapter: 'memberProfile' },
  '/api/member/agent/login': { op: OP.AUTH_LOGIN, adapter: 'memberProfile' },
  '/api/member/v2/fastLogin': { op: OP.AUTH_LOGIN, adapter: 'memberProfile' },

  // —— auth.register ——
  '/api/member/register': { op: OP.AUTH_REGISTER, adapter: 'registerProfile' },
  '/api/member/fastRegister': { op: OP.AUTH_REGISTER, adapter: 'registerProfile' },
  '/api/member/check/register': { op: OP.AUTH_CHECK_REGISTER, adapter: 'checkRegister' },

  // —— logout ——
  '/api/member/logout': { op: OP.AUTH_LOGOUT, adapter: 'logout' },
  '/api/gameCenter/gameApi/logout': { op: OP.AUTH_LOGOUT, adapter: 'logout' },

  // —— 会话复用 ——
  '/api/member/getFastLogin': {
    op: OP.USER_INFO,
    adapter: 'memberProfile',
    note: 'session-reuse'
  },

  // —— user.info ——
  '/api/member/user/info': { op: OP.USER_INFO, adapter: 'memberProfile' },
  '/api/member/v2/user/info': { op: OP.USER_INFO, adapter: 'memberProfile' },

  // —— 头像 ——
  '/api/member/user/avatars': { op: OP.USER_AVATARS, adapter: 'avatars' },

  // —— VIP（仅会话 vip_level；vipInfoV2 全量表暂不映射）——
  '/api/member/user/vip': { op: OP.USER_VIP, adapter: 'vipSummary' },
  '/api/member/user/vipDetails': { op: OP.USER_VIP, adapter: 'vipDetails' },

  // —— wallet.gold ——
  '/api/gameCenter/gold': { op: OP.WALLET_GOLD, adapter: 'walletGold' },
  '/api/gameCenter/gameApi/RefreshGold': { op: OP.WALLET_GOLD, adapter: 'walletGold' },
  '/api/gameCenter/gameApi/getPlatformBalance': { op: OP.WALLET_GOLD, adapter: 'walletGold' },

  // —— 充值：配置驱动（providerOptions.pay）；无配置时用内置 PIX 占位 ——
  '/api/finance/pay/payListV4': { op: OP.PAY_LIST, adapter: 'payList', note: 'providerOptions.pay' },
  '/api/finance/pay/payListV5': { op: OP.PAY_LIST, adapter: 'payList', note: 'providerOptions.pay' },
  '/api/finance/pay/payTypeV4': { op: OP.PAY_TYPE, adapter: 'payType', note: 'providerOptions.pay' },
  '/api/finance/pay/payTypeV5': { op: OP.PAY_TYPE, adapter: 'payType', note: 'providerOptions.pay' },
  '/api/finance/pay/payplatformlistV3': { op: OP.PAY_CHANNELS, adapter: 'payChannels', note: 'providerOptions.pay' },
  '/api/finance/pay/payplatformlistV4': { op: OP.PAY_CHANNELS, adapter: 'payChannels', note: 'providerOptions.pay' },
  '/api/finance/pay/getPayChannel': { op: OP.PAY_CHANNELS, adapter: 'payChannels', note: 'providerOptions.pay' },
  '/api/finance/pay/payInfos': { op: OP.PAY_INFOS, adapter: 'payInfos', note: 'saved cards; default []' },
  '/api/finance/payListV4': { op: OP.PAY_LIST, adapter: 'payList', note: 'providerOptions.pay' },
  '/api/finance/payListV5': { op: OP.PAY_LIST, adapter: 'payList', note: 'providerOptions.pay' },
  '/api/finance/payTypeV4': { op: OP.PAY_TYPE, adapter: 'payType', note: 'providerOptions.pay' },
  '/api/finance/payTypeV5': { op: OP.PAY_TYPE, adapter: 'payType', note: 'providerOptions.pay' },
  '/api/finance/pay/offlineOrderV3': { op: OP.PAY_CREATE, adapter: 'payCreate', note: 'staticQr or http' },
  '/api/finance/pay/offlineOrderV4': { op: OP.PAY_CREATE, adapter: 'payCreate', note: 'staticQr or http' },
  '/api/finance/pay/orderInfo': { op: OP.PAY_ORDER_INFO, adapter: 'payOrderInfo', note: 'local order poll' },
  '/api/finance/pay/orderInfoV2': { op: OP.PAY_ORDER_INFO, adapter: 'payOrderInfo', note: 'local order poll' },
  '/api/finance/pay/calculateGift': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'no gift calc yet' },
  '/api/finance/pay/getPayOrderFee': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'no fee yet' },
  '/api/finance/pay/getPayOrderFeeV2': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'no fee yet' },
  '/api/finance/payplatformlistV3': { op: OP.PAY_CHANNELS, adapter: 'payChannels' },
  '/api/finance/payplatformlistV4': { op: OP.PAY_CHANNELS, adapter: 'payChannels' },

  // —— 提现能力：无渠道 → pending；流水 → 空列表 ——
  '/api/finance/certify/withdrawSetting': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'no-wgame-withdraw' },
  '/api/finance/certify/withdrawSettingV2': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'no-wgame-withdraw' },
  '/api/finance/certify/withdrawSettingV3': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'no-wgame-withdraw' },
  '/api/finance/certify/withdraw': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'no-wgame-withdraw' },
  '/api/finance/certify/withdrawV2': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'no-wgame-withdraw' },
  '/api/finance/certify/withdrawRecord': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no records' },
  '/api/finance/certify/withdrawRecords': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no records' },
  '/api/finance/certify/getWithdrawAccount': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no accounts' },
  '/api/finance/certify/withdrawAccountList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no accounts' },

  // —— 充值订单流水 ——
  '/api/finance/pay/orderListV3': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no pay orders' },
  '/api/finance/claim/userInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no claim engine' },
  '/api/finance/maxChargeRate': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'rate from OSS json preferred; API ok empty' },

  // —— 活动红点/弹窗（无活动引擎：空列表，不伪造奖励）——
  '/api/active/category': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no activity categories engine' },
  '/api/active/getRedDotV2': { op: OP.EMPTY_RECORDS, adapter: 'redDotEmpty', note: 'zero red dots' },
  '/api/active/pop_canReceiveReward': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no rewards' },
  '/api/active/popRegressActive': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no regress popup' },
  '/api/active/recharge/financeGiveReward': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no give reward' },
  '/api/active/redPackIndex': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no redpack' },
  '/api/active/tasks/task': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no tasks' },
  '/api/active/tasks/newcomer_benefit_pop': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'frontend forEach; [] = no newcomer pop' },

  // —— 游戏收藏 ——
  '/api/gameCenter/gameApi/favoriteGameList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no favorites' },

  // —— 设备指纹（会话 device_id）——
  '/api/member/getFingerprint': { op: OP.USER_INFO, adapter: 'fingerprint', note: 'session device_id' },
  '/api/member/listAccount': { op: OP.USER_INFO, adapter: 'listAccount', note: 'current session only' },
  '/api/member/fastLogin': { op: OP.AUTH_LOGIN, adapter: 'memberProfile' },

  // —— 游戏列表态（无收藏/最近记录）——
  '/api/gameCenter/gameApi/favorite-list-all/v3': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/gameCenter/gameApi/recent-list/v3': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/gameCenter/gameApi/recentPlatformList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/gameCenter/gameApi/lastGameInfo': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/gameCenter/gameApi/logoutGame': { op: OP.AUTH_LOGOUT, adapter: 'logout' },
  '/api/gameCenter/addFavorite': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'favorite not persisted' },

  // —— 消息 ——
  '/api/message/list/all': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/message/details': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/message/delete': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no message store' },
  '/api/message/delall': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no message store' },
  '/api/message/customDel': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no message store' },
  '/api/message/popupcfg': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/message/news/search': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/message/read': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/message/readall': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },

  // —— 提现绑卡/手续费（无渠道）——
  '/api/finance/certify/getUserBankCardList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/finance/certify/auditTaskPageListV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/finance/certify/checkAddWithdrawAccountStatus': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/finance/certify/getWithdrawFee': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/getWithdrawFeeSetting': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/getUserWithdrawAccountRules': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/bindWithdrawAccount': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/bindcard': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/bindCrypto': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/cashV3': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/deleteAccount': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },

  // —— 活动：列表/公告空；领取类明确 pending ——
  '/api/active/announcement': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/categoryV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/receivedAwardList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/unreceiveAwardList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/expireAwardList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/coupon/list': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/coupon/popList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/afterRechargePop': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/active/confirmMsgPop': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/active/isShowV2': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/active/reportWarnLog': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/active/active_popRecharge': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/active/receiveOne': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/active/receiveManualSend': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/active/tasks/receiveOne': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/active/coupon/check': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },

  // —— gohal / 投注报表 ——
  '/api/gohal/getSysInfo': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/gohal/behaviorValidateList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/bet-manager/recentreport/betrecords/_query': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/bet-manager/recentreport/bet_report/personal/_query': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },

  // —— VIP 全量表：无进度数据，明确 pending（禁止伪造充值/打码表）——
  '/api/member/user/vipInfoV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no vip ladder; empty avoids 10060 toast on login' },
  '/api/member/vipInfoUnLogin': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no vip ladder unlogin' },

  // —— 代理：配置驱动（providerOptions.agent）；默认零态可打开页面 ——
  '/api/agent/promote/config/agentMode': { op: OP.AGENT_MODE, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/config/index': { op: OP.AGENT_CONFIG, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/config/getAgentConfig': { op: OP.AGENT_CONFIG, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/agentPromotion': { op: OP.AGENT_PROMOTION, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/indexInfo': { op: OP.AGENT_INDEX, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/myTotalData': { op: OP.AGENT_TOTAL, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/myPeriodDataV2': { op: OP.AGENT_PERIOD, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/myCommissionV2': { op: OP.AGENT_COMMISSION, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/commissionMarquee': { op: OP.AGENT_MARQUEE, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/getIpBindInfo': { op: OP.AGENT_BIND, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/binding/reportViewV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'bind report soft empty' },
  '/api/agent/promote/report/directReportV5': { op: OP.AGENT_DIRECT, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/myCommissionDetailV3': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'detail empty until agent API' },
  '/api/agent/promote/report/myPerformanceV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'perf empty until agent API' },
  '/api/agent/promote/report/myPerformanceDetailV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'perf empty until agent API' },
  '/api/agent/promote/report/directFinV4': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'direct fin empty' },
  '/api/agent/promote/report/memberInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'member info empty' },

  // —— 尾差：客服/消息 ——
  '/api/finance/claim/withdrawRecord': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/finance/claim/cancelOrder': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no claim engine' },
  '/api/finance/claim/applyClaim': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no claim engine' },
  '/api/finance/message/send': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/finance/pay/wallet/no/getUserInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/game/hall/getTgPreparedInlineMessage': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },

  // —— 注册弹窗 / 心跳 / 埋点 ——
  '/api/member/user/registerPopupDlgInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no register popup payload yet' },
  '/api/member/user/registerRetentionDlgInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no retention dlg' },
  '/api/member/user/rechargePopupDlgInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no recharge popup payload' },
  '/api/gohal/heartbeat': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/statistics/domain/pointer': { op: OP.LOBBY_OK, adapter: 'lobbyOk' }
};

/** 精确 CORE 覆盖 bulk */
const MIGRATION_MAP = Object.assign({}, SAFE_BULK_MAP, CORE_MAP);

const DEFAULT_HOST = {
  apiHostPatterns: [
    '\\.679win\\.(cc|me|co|net)$',
    '^(oniw|aniw)\\d*\\.'
  ],
  excludeHosts: ['679win.com', 'www.679win.com']
};

const CATALOG = Object.keys(MIGRATION_MAP).map((path) => ({
  path,
  op: MIGRATION_MAP[path].op,
  adapter: MIGRATION_MAP[path].adapter
}));

module.exports = {
  MIGRATION_MAP,
  CORE_MAP,
  SAFE_BULK_MAP,
  CATALOG,
  DEFAULT_HOST,
  OP
};
