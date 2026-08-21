/**
 * Migration Map —— P0 基础链（仅 wgame 已有能力）
 *
 * auth.login / auth.register / user.info / wallet.gold
 * getFastLogin → 复用登录态（user.info），不二次打网关
 *
 * home / 充值 / 活动 / 代理等：不进本表，保持原接口（OSS/aniw）或 pending
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

  // —— 复用当前登录态（不走 auth.login，避免 encryptString → 1003）——
  '/api/member/getFastLogin': {
    op: OP.USER_INFO,
    adapter: 'memberProfile',
    note: 'session-reuse'
  },

  // —— user.info ——
  '/api/member/user/info': { op: OP.USER_INFO, adapter: 'memberProfile' },
  '/api/member/v2/user/info': { op: OP.USER_INFO, adapter: 'memberProfile' },

  // —— wallet.gold ——
  '/api/gameCenter/gold': { op: OP.WALLET_GOLD, adapter: 'walletGold' },
  '/api/gameCenter/gameApi/RefreshGold': { op: OP.WALLET_GOLD, adapter: 'walletGold' },
  '/api/gameCenter/gameApi/getPlatformBalance': { op: OP.WALLET_GOLD, adapter: 'walletGold' }
};

/** 系列默认主机（aniw-lobby 族，非写死某一站点） */
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
