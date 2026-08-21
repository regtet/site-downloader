/**
 * Migration Map —— 登录后基础链（仅 wgame 已有 / 可从会话推导的能力）
 *
 * 支付渠道：显式 payPending（失败码），禁止空成功壳
 * vipInfoV2 全量表、提现流水等：暂不进表
 */
const { OP } = require('../../ops');

/** @type {Record<string, { op: string, adapter: string, note?: string }>} */
const MIGRATION_MAP = {
  // —— auth.login ——
  '/api/member/login': { op: OP.AUTH_LOGIN, adapter: 'memberProfile' },
  '/api/member/agent/login': { op: OP.AUTH_LOGIN, adapter: 'memberProfile' },
  '/api/member/v2/fastLogin': { op: OP.AUTH_LOGIN, adapter: 'memberProfile' },

  // —— auth.register ——
  '/api/member/register': { op: OP.AUTH_REGISTER, adapter: 'memberProfile' },
  '/api/member/fastRegister': { op: OP.AUTH_REGISTER, adapter: 'memberProfile' },
  '/api/member/check/register': { op: OP.AUTH_CHECK_REGISTER, adapter: 'checkRegister' },

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

  // —— 充值：无 wgame 渠道，明确 pending 失败（非空壳成功）——
  '/api/finance/pay/payListV4': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/pay/payListV5': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/pay/payTypeV4': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/pay/payTypeV5': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/pay/payplatformlistV3': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/pay/payplatformlistV4': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/pay/getPayChannel': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/pay/payInfos': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/payListV4': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/payListV5': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/payTypeV4': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' },
  '/api/finance/payTypeV5': { op: OP.PAY_PENDING, adapter: 'payPending', note: 'no-wgame-pay' }
};

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
  CATALOG,
  DEFAULT_HOST,
  OP
};
