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
  // 退出游戏平台，不是会员登出；不能清 wgame 大厅会话（否则紧接着 gameApi/login 会 10061）
  '/api/gameCenter/gameApi/logout': { op: OP.WALLET_GOLD, adapter: 'walletGold', note: 'leave game and refresh wallet balance' },

  // —— 会话复用 ——
  '/api/member/getFastLogin': {
    op: OP.USER_INFO,
    adapter: 'memberProfile',
    note: 'session-reuse'
  },

  // —— user.info ——
  '/api/member/user/info': { op: OP.USER_INFO, adapter: 'memberProfile' },
  '/api/member/v2/user/info': { op: OP.USER_INFO, adapter: 'userInfoV2' },

  // —— 头像 ——
  '/api/member/user/avatars': { op: OP.USER_AVATARS, adapter: 'avatars' },

  // —— VIP（会话 vip_level + 等级表）——
  '/api/member/user/vip': { op: OP.USER_VIP, adapter: 'vipSummary' },
  '/api/member/user/security/status': { op: OP.LOBBY_OK, adapter: 'securityStatus' },
  '/api/member/user/security/claimLogin': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'claim authentication is not implemented by wgame' },
  '/api/member/wsBrowser/challenge': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'WS Browser attestation unavailable' },
  '/api/member/wsBrowser/verify': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'WS Browser attestation unavailable' },
  '/api/active/withdraw/getAllActive': { op: OP.LOBBY_OK, adapter: 'withdrawActiveList' },
  '/api/member/user/vipDetails': { op: OP.USER_VIP, adapter: 'vipDetails' },
  '/api/member/user/vipInfoV2': { op: OP.USER_VIP, adapter: 'vipInfoV2', note: 'session vip progress card' },
  '/api/member/vipInfoUnLogin': { op: OP.LOBBY_OK, adapter: 'vipLevelList', note: 'vip ladder before login' },
  '/api/active/allVipLevel': { op: OP.USER_VIP, adapter: 'vipLevelList', note: 'vip ladder after login' },

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
  '/api/finance/pay/paysubmit': { op: OP.PAY_CREATE, adapter: 'paySubmit', note: 'recharge button GET' },
  '/api/finance/pay/offlineOrderV3': { op: OP.PAY_CREATE, adapter: 'payCreate', note: 'staticQr or http' },
  '/api/finance/pay/offlineOrderV4': { op: OP.PAY_CREATE, adapter: 'payCreate', note: 'staticQr or http' },
  '/api/finance/pay/orderInfo': { op: OP.PAY_ORDER_INFO, adapter: 'payOrderInfo', note: 'local order poll' },
  '/api/finance/pay/orderInfoV2': { op: OP.PAY_ORDER_INFO, adapter: 'payOrderInfo', note: 'local order poll' },
  '/api/finance/pay/calculateGift': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'gift empty-ok' },
  '/api/finance/pay/getPayOrderFee': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'fee zero-ok' },
  '/api/finance/pay/getPayOrderFeeV2': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'fee zero-ok' },
  '/api/finance/pay/delPayInfo': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'delete saved pay info' },
  '/api/finance/pay/refreshStatus': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'poll local order' },
  '/api/finance/pay/transferConfirm': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'transfer confirm soft-ok' },
  '/api/finance/pay/transferConfirmV2': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'transfer confirm soft-ok' },
  '/api/finance/pay/transferCancel': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'transfer cancel soft-ok' },
  '/api/finance/pay/transferCancelV2': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'transfer cancel soft-ok' },
  '/api/finance/pay/wallet/no/buy': { op: OP.PAY_CREATE, adapter: 'payCreate', note: 'no-wallet buy → same create' },
  '/api/finance/payplatformlistV3': { op: OP.PAY_CHANNELS, adapter: 'payChannels' },
  '/api/finance/payplatformlistV4': { op: OP.PAY_CHANNELS, adapter: 'payChannels' },

  // —— 提现：HTTP enableWithdraw / drawBackMoney / paywayList / withdrawRecord ——
  '/api/finance/certify/withdrawSetting': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'http enableWithdraw' },
  '/api/finance/certify/withdrawSettingV2': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'http enableWithdraw' },
  '/api/finance/certify/withdrawSettingV3': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'http enableWithdraw' },
  '/api/finance/certify/withdrawInfoV2': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'http enableWithdraw+paywayList+channels' },
  '/api/finance/certify/withdrawInfoV3': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'http enableWithdraw+paywayList+channels' },
  '/api/finance/certify/withdraw': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'http drawBackMoney' },
  '/api/finance/certify/withdrawV2': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'http drawBackMoney' },
  '/api/finance/certify/withdrawRecord': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'http withdrawRecord' },
  '/api/finance/certify/withdrawRecords': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'http withdrawRecord' },
  '/api/finance/certify/getWithdrawAccount': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'http paywayList' },
  '/api/finance/certify/withdrawAccountList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'http paywayList' },

  // —— 充值订单流水 / 辅配置 ——
  '/api/finance/pay/orderListV3': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'http chargeRecord' },
  '/api/finance/pay/orderListV4': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'http chargeRecord' },
  '/api/finance/pay/NOPayList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no-pay list empty' },
  '/api/finance/certify/uploadpay': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'upload voucher soft-ok' },
  '/api/lobby/finance/getPayChooseBank': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'bank choose empty-ok' },
  '/api/lobby/finance/getPayFieldOss': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'pay field OSS' },
  '/api/active/recharge/queryOrderRewardDetail': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/club/recharge/payBankInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/club/recharge/selfOrderInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/club/recharge/payCancel': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'club cancel soft-ok' },
  '/api/club/recharge/payConfirm': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'club confirm soft-ok' },
  '/api/finance/claim/userInfo': { op: OP.EMPTY_RECORDS, adapter: 'claimUserInfo', note: 'claim zero-state contract' },
  '/api/finance/maxChargeRate': { op: OP.LOBBY_OK, adapter: 'maxChargeRate' },
  '/api/finance/pay/payTypeSetting': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'shop channel names' },
  '/api/finance/payPopup/content': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'pay popup content OSS' },
  '/api/finance/payPopup/settingAndSlogans': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'pay popup slogans OSS' },

  // —— 活动红点/弹窗（无活动引擎：空列表，不伪造奖励）——
  '/api/active/category': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'oniw public category json' },
  '/api/active/browser/downloads': { op: OP.LOBBY_OK, adapter: 'emptyList', note: 'no managed browser downloads' },
  '/api/active/blindBox': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'blind-box API family disabled without activity engine' },
  '/api/active/blindBox/get': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'hide unsupported blind-box engine' },
  '/api/active/blindBox/notice': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no blind-box notices' },
  '/api/active/blindBox/getFreeRecords': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no blind-box records' },
  '/api/active/blindBox/orderList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'no blind-box orders' },
  '/api/active/blindBox/orderDetail': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no blind-box order details' },
  '/api/active/blindBox/openBlindBox': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'blind-box mutation unsupported' },
  '/api/active/blindBox/orderBatchEdit': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'blind-box mutation unsupported' },
  '/api/active/blindBox/signIn': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'blind-box mutation unsupported' },
  '/api/active/checkReceiveCondition': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'reward claim requires an activity engine' },
  '/api/active/getBigApplyPopupConfig': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'optional popup config' },
  '/api/active/get': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official activity detail name/content' },
  '/api/active/getByTemplate': { op: OP.LOBBY_OK, adapter: 'emptyList', note: 'oniw public template list' },
  '/api/active/getRedDotV2': { op: OP.EMPTY_RECORDS, adapter: 'redDotEmpty', note: 'zero red dots' },
  '/api/active/pop_canReceiveReward': { op: OP.LOBBY_OK, adapter: 'canReceivePop', note: 'no rewards' },
  '/api/active/returnGold/summary/v3': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official rebate summary' },
  '/api/active/returnGold/ratiotable': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official rebate categories' },
  '/api/yuebao/index': { op: OP.LOBBY_OK, adapter: 'yuebaoIndex' },
  '/api/finance/claim/unreadMsgCnt': { op: OP.LOBBY_OK, adapter: 'unreadCount' },
  '/api/active/popRegressActive': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no regress popup' },
  '/api/active/recharge/financeGiveReward': { op: OP.EMPTY_RECORDS, adapter: 'officialZero', note: 'official activity shape; never map recharge history' },
  '/api/active/redPackIndex': { op: OP.EMPTY_RECORDS, adapter: 'redPackIndex', note: 'no redpack' },
  '/api/active/tasks/task': { op: OP.LOBBY_OK, adapter: 'taskDetail', note: 'official mission rules with local fallback' },
  '/api/active/tasks/vitality/boxs': { op: OP.LOBBY_OK, adapter: 'vitalityBoxes', note: 'official vitality chests with zero-state fallback' },
  '/api/active/cutADeal/list': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official spins list' },
  '/api/active/turntable/luckyIntegralList': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official spins points' },
  '/api/active/tasks/newcomer_benefit_pop': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no newcomer popup engine' },
  '/api/active/tasks/newcomer_benefit_reward': { op: OP.EMPTY_RECORDS, adapter: 'officialZero', note: 'disabled newcomer rewards with official shape' },

  // —— 游戏启动：OSS 列表仅展示，点击走 wgame 映射 ——
  '/api/gameCenter/gameApi/login': { op: OP.GAME_LAUNCH, adapter: 'gameLaunch', note: 'wgame game mapping' },
  '/api/gameCenter/gameApi/apiLogin': { op: OP.GAME_LAUNCH, adapter: 'gameLaunch', note: 'wgame game mapping bypass' },
  '/api/gameCenter/gameApi/localLogin': { op: OP.GAME_LAUNCH, adapter: 'gameLaunch', note: 'wgame local account game' },
  '/api/gameCenter/gameApi/tgLogin': { op: OP.GAME_LAUNCH, adapter: 'gameLaunch', note: 'wgame tg game' },

  // —— 游戏收藏 ——
  '/api/gameCenter/gameApi/favoriteGameList': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no favorites' },
  // 官方 OSS 游戏目录只负责 UI 展示；点击登录仍由上面的 WGame gameLaunch 接管。
  '/api/game/hall/gameVersion': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS catalog version' },
  '/api/game/hall/hotListV2': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS hot games' },
  '/api/game/hall/listBonusPoolV2': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS bonus pools' },
  '/api/game/hall/listPlatformCateExtLink': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS category links' },
  '/api/game/hall/listPlatformGameV2': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS platform games' },
  '/api/game/hall/listSearchGameV2': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS game search' },
  '/api/game/hall/listSpecialGameV2': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS special games' },
  '/api/game/hall/listSubGameSummary': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS subgame summary' },
  '/api/game/hall/listTryGameV2': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS demo games' },
  '/api/game/hall/listValidBetExcludeGame': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS valid-bet exclusions' },
  '/api/game/hall/liveGame': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS live catalog' },
  '/api/game/hall/liveVideo': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official OSS live video catalog' },

  // —— 设备指纹（会话 device_id）——
  '/api/member/getFingerprint': { op: OP.USER_INFO, adapter: 'fingerprint', note: 'session device_id' },
  '/api/member/listAccount': { op: OP.USER_INFO, adapter: 'listAccount', note: 'current session only' },
  '/api/member/fastLogin': { op: OP.AUTH_LOGIN, adapter: 'memberProfile' },

  // —— 游戏列表态（无收藏/最近记录）——
  '/api/gameCenter/gameApi/favorite-list-all/v3': { op: OP.EMPTY_RECORDS, adapter: 'emptyList' },
  '/api/gameCenter/gameApi/recent-list/v3': { op: OP.EMPTY_RECORDS, adapter: 'emptyList' },
  '/api/gameCenter/gameApi/recentPlatformList': { op: OP.EMPTY_RECORDS, adapter: 'emptyList' },
  '/api/gameCenter/gameApi/lastGameInfo': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/gameCenter/gameApi/logoutGame': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'game platform logout noop' },
  '/api/gameCenter/addFavorite': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'favorite cannot be persisted by WGame' },
  '/api/active/rechargeFund/reward/changeIsOverFlag': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no recharge-fund state store' },

  // —— 消息 ——
  '/api/message/list/all': { op: OP.EMPTY_RECORDS, adapter: 'messageList' },
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
  '/api/finance/certify/getWithdrawFeeSetting': { op: OP.LOBBY_OK, adapter: 'officialZero' },
  '/api/finance/certify/getUserWithdrawAccountRules': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/bindWithdrawAccount': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/bindcard': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/bindCrypto': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/cashV3': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/deleteAccount': { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending' },
  '/api/finance/certify/withdrawAccountInfo': {
    op: OP.WITHDRAW_PENDING,
    adapter: 'withdrawPending',
    note: 'decryptAccount list from paywayList'
  },

  // —— 支付/提现密码（大厅 security → wgame setWithdrawPwd / verifyWithdrawPwd）——
  '/api/member/user/security/verifyWithdrawPass': {
    op: OP.WITHDRAW_PENDING,
    adapter: 'withdrawPending',
    note: 'http verifyWithdrawPwd'
  },
  '/api/member/user/security/modifyWithdrawPass': {
    op: OP.WITHDRAW_PENDING,
    adapter: 'withdrawPending',
    note: 'http setWithdrawPwd'
  },
  '/api/finance/certify/verifyWithdrawalPasswordV2': {
    op: OP.WITHDRAW_PENDING,
    adapter: 'withdrawPending',
    note: 'http verifyWithdrawPwd'
  },
  '/api/finance/certify/setdefault': {
    op: OP.WITHDRAW_PENDING,
    adapter: 'withdrawPending',
    note: 'local default withdraw account'
  },

  // —— 活动：列表/公告空；领取类明确 pending ——
  '/api/active/announcement': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/active/categoryV2': { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'oniw public category json' },
  '/api/active/receivedAwardList': { op: OP.EMPTY_RECORDS, adapter: 'awardList' },
  '/api/active/unreceiveAwardList': { op: OP.EMPTY_RECORDS, adapter: 'awardList' },
  '/api/active/expireAwardList': { op: OP.EMPTY_RECORDS, adapter: 'awardList' },
  '/api/active/coupon/list': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/coupon/popList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/active/afterRechargePop': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/active/confirmMsgPop': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/active/isShowV2': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'oniw public taskSetting with safe full fallback' },
  '/api/active/reportWarnLog': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/active/active_popRecharge': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/active/receiveOne': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/active/receiveManualSend': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/active/tasks/receiveOne': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/active/coupon/check': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },

  // —— 平台元数据（新版启动链；从 index.html 站点配置合成）——
  '/api/platform/lang': { op: OP.LOBBY_OK, adapter: 'platformPayload', note: 'language list from site meta' },
  '/api/platform/config': { op: OP.LOBBY_OK, adapter: 'platformPayload', note: 'platform config from site meta' },
  '/api/platform/site': { op: OP.LOBBY_OK, adapter: 'platformPayload', note: 'site info from site meta' },

  // —— 站点公开配置：不含会员数据，保留官方静态配置/公告回源 ——
  '/api/domain/lobby/club/parentDomain': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/domain/lobby/domainMatch': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/aboutUs/index/getInfo': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/channel/go/getChannelInfoById': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/currencyInfo/getAllCurrency': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/finance/getBankCurrencyAutoMappingCardNoRule': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/finance/getSiteCurrencyExchangeRateForOss': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/finance/getSiteGuaranteeRule': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/footerConfigV2/getInfo': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/h5/config/getAccessRestrictedInfo': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/publicityInfo/list': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/site/getChildSite': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/site/getSiteInfo': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/userAgreement/index/getInfo': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/versionUpdate/getVersionList': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/webapi/forceUpdate/getForceUpdate': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/webapi/h5/config/getInfo': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/webapi/optimizationV2/site/config': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/webapi/selfRestraint/getInfo': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/lobby/winnerCarousel/result': { op: OP.UPSTREAM, adapter: 'lobbyOk' },

  // —— gohal / 投注报表 ——
  '/api/gohal/getSysInfo': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/gohal/staffAllV3': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'nav/menu staff config OSS' },
  '/api/gohal/behaviorValidateList': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/bet-manager/recentreport/betrecords/_query': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/bet-manager/recentreport/bet_report/personal/_query': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },

  // —— 充值优惠比例（OSS 快照）——
  '/api/finance/maxChargeRate': { op: OP.LOBBY_OK, adapter: 'maxChargeRate' },

  // —— 代理：配置驱动（providerOptions.agent）；默认零态可打开页面 ——
  '/api/agent/promote/config/agentMode': { op: OP.AGENT_MODE, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/userAgentMode': { op: OP.AGENT_MODE, adapter: 'agentBlob', note: 'http/local agent mode' },
  '/api/agent/promote/agentBasic': { op: OP.AGENT_INDEX, adapter: 'agentBlob', note: 'http proxyStatistics' },
  '/api/agent/promote/index/settleTime': { op: OP.LOBBY_OK, adapter: 'agentSettleTime' },
  '/api/agent/promote/index/indexInfoV2': { op: OP.AGENT_INDEX, adapter: 'agentBlob' },
  '/api/agent/promote/index/agentCommission': { op: OP.AGENT_COMMISSION, adapter: 'agentBlob' },
  '/api/agent/promote/config/tutorial': { op: OP.UPSTREAM, adapter: 'lobbyOk', note: 'official tutorial html' },
  '/api/agent/promote/config/index': { op: OP.UPSTREAM, adapter: 'agentBlob', note: 'upstream promote config' },
  '/api/agent/promote/config/getAgentConfig': { op: OP.UPSTREAM, adapter: 'agentBlob', note: 'upstream agent config' },
  '/api/agent/promote/report/agentPromotion': { op: OP.AGENT_PROMOTION, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/indexInfo': { op: OP.AGENT_INDEX, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/indexDirect': { op: OP.AGENT_INDEX, adapter: 'agentBlob', note: 'same blob as indexInfo' },
  '/api/agent/promote/reportPc/agentInfo': { op: OP.AGENT_INDEX, adapter: 'agentBlob', note: 'agentInfo blob from indexInfo fields' },
  '/api/agent/promote/report/myTotalData': { op: OP.AGENT_TOTAL, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/teamDataV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'team data empty until agent API' },
  '/api/agent/promote/report/myPeriodDataV2': { op: OP.AGENT_PERIOD, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/myCommissionV2': { op: OP.AGENT_COMMISSION, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/reward/myCommission': { op: OP.AGENT_COMMISSION, adapter: 'agentBlob', note: 'reward commission pagination backed by proxyStatistics' },
  '/api/agent/promote/report/reward/myCommissionDetail': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'reward commission detail empty until agent API' },
  '/api/agent/promote/report/reward/myPerformance': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'reward performance empty until agent API' },
  '/api/agent/promote/report/reward/myPerformanceDetail': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'reward performance detail empty until agent API' },
  '/api/agent/promote/report/psReward': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'reward history empty until agent API' },
  '/api/agent/promote/report/clubCommission': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'club commission empty' },
  '/api/agent/promote/report/clubCommissionDetail': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'club commission detail empty' },
  '/api/agent/promote/report/clubPerformance': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'club performance empty' },
  '/api/agent/promote/report/clubPerformanceUserV1': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'club performance user empty' },
  '/api/agent/promote/commissionMarquee': { op: OP.AGENT_MARQUEE, adapter: 'agentBlob', note: 'agent marquee list' },
  '/api/agent/promote/getIpBindInfo': { op: OP.AGENT_BIND, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/binding/reportViewV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'bind report soft empty' },
  '/api/agent/promote/report/directReportV5': { op: OP.AGENT_DIRECT, adapter: 'agentBlob', note: 'providerOptions.agent' },
  '/api/agent/promote/report/myCommissionDetailV3': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'detail empty until agent API' },
  '/api/agent/promote/report/myPerformanceV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'perf empty until agent API' },
  '/api/agent/promote/report/myPerformanceDetailV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'perf empty until agent API' },
  '/api/agent/promote/report/directFinV4': { op: OP.AGENT_TOTAL, adapter: 'agentFinance', note: 'footer from proxyStatistics' },
  '/api/agent/promote/report/directOrderV3': { op: OP.LOBBY_OK, adapter: 'agentReportEmpty', note: 'no per-order rows' },
  '/api/agent/promote/report/directCouponV3': { op: OP.LOBBY_OK, adapter: 'agentReportEmpty', note: 'no coupon rows' },
  '/api/agent/promote/config/introduce': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'safe local display config; avoids hanging on unavailable official OSS' },
  '/api/agent/promote/config/sensitiveData': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'safe disabled visibility config' },
  '/api/agent/promote/config/share': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'safe empty share config' },
  '/api/agent/promote/getPromoteStrangerSetting': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'stranger assignment disabled' },
  '/api/agent/promote/getPublicityV3': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'no fabricated publicity images' },
  '/api/agent/promote/report/memberInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'member info empty' },

  // —— 信用代理别名：读取类复用 promote 数据，资金/账号写操作不伪造成功 ——
  '/api/agent/credit/agentCenter/agentBasic': { op: OP.AGENT_INDEX, adapter: 'agentBlob' },
  '/api/agent/credit/agentCenter/agentCommission': { op: OP.AGENT_COMMISSION, adapter: 'agentBlob' },
  '/api/agent/credit/agentCenter/agentPromotion': { op: OP.AGENT_PROMOTION, adapter: 'agentBlob' },
  '/api/agent/credit/agentCenter/commissionMarquee': { op: OP.AGENT_MARQUEE, adapter: 'agentBlob' },
  '/api/agent/credit/agentCenter/directReport': { op: OP.AGENT_DIRECT, adapter: 'agentBlob' },
  '/api/agent/credit/agentCenter/indexInfoV2': { op: OP.AGENT_INDEX, adapter: 'agentBlob' },
  '/api/agent/credit/agentCenter/settleTime': { op: OP.LOBBY_OK, adapter: 'agentSettleTime' },
  '/api/agent/credit/agentCenter/userAgentMode': { op: OP.AGENT_MODE, adapter: 'agentBlob' },
  '/api/agent/credit/agentCenter/memberInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/agentCenter/agentPermission': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },
  '/api/agent/credit/agentCenter/getAgentConfig': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/agent/credit/agentCenter/getCompleteImg': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/agentCenter/getAssignStranger': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/agentCenter/getStrangerV2': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/agentCenter/getPromoteStrangerSetting': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/agent/credit/agentCenter/getPublicityV3': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/agent/credit/config/publicConfig': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/agent/promote/config/advertise': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/agent/promote/config/defaultAgentMode': { op: OP.UPSTREAM, adapter: 'lobbyOk' },
  '/api/agent/promote/config/publicConfig': { op: OP.UPSTREAM, adapter: 'lobbyOk' },

  '/api/agent/credit/agentCenter/batchCreateAccount': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/agentCenter/checkBatchCreateAccount': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/agentCenter/createAccount': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/agentCenter/direct/bacthRemark': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/agentCenter/direct/batchChangeStatus': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/agentCenter/direct/changeStatus': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/agentCenter/direct/resetPwd': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/agentCenter/importStranger': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/agentCenter/unassignStranger': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },

  '/api/agent/credit/childLoan/list': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/childLoan/quota/list': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/childLoan/repay/list': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/childLoan/userInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/childLoan/funding': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/childLoan/quota/adjust': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/agent/credit/childLoan/repay': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },

  '/api/agent/credit/equity/childProfit': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/equity/childProfitDetail': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/equity/equityProfitDetail': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/equity/equityProfitUser': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/equity/equityRate': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/equity/settleDetail': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/agent/credit/equity/equitySettle': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },

  // —— 尾差：客服/消息 ——
  '/api/finance/claim/withdrawRecord': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/backstage/customer/getUserFeedback': { op: OP.EMPTY_RECORDS, adapter: 'feedbackInfo', note: 'feedback zero-state contract' },
  '/api/backstage/customer/getactivetrans': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'empty translation list' },
  '/api/club/manager/isApplyOpen': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'club application disabled' },
  '/api/member/user/security/thirdUser/bindList': { op: OP.EMPTY_RECORDS, adapter: 'emptyList', note: 'no third-party bindings' },
  '/api/message/smsCountry': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'Brazil phone selector contract' },
  '/api/third/game/platformExchange/findListAll': { op: OP.LOBBY_OK, adapter: 'officialZero', note: 'no fabricated exchange rates' },
  '/api/finance/claim/cancelOrder': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no claim engine' },
  '/api/finance/claim/applyClaim': { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'no claim engine' },
  '/api/finance/message/send': { op: OP.FEATURE_PENDING, adapter: 'featurePending' },
  '/api/finance/pay/wallet/no/getUserInfo': { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords' },
  '/api/game/hall/getTgPreparedInlineMessage': { op: OP.LOBBY_OK, adapter: 'lobbyOk' },

  // —— 注册弹窗 / 心跳 / 埋点 ——
  '/api/member/user/registerPopupDlgInfo': { op: OP.LOBBY_OK, adapter: 'registerPopup', note: 'register success content+buttons' },
  '/api/member/registerPopupDlgInfo': { op: OP.LOBBY_OK, adapter: 'registerPopup', note: 'alias without /user/' },
  '/api/lobby/config/getAppDownloadInfo': { op: OP.LOBBY_OK, adapter: 'appDownload', note: 'feed register Download button list' },
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
