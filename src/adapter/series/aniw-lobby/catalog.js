/**
 * Series: aniw-lobby —— 目标站「同族」HTTP 接口目录
 *
 * 适用：aniw/oniw 子域 + /hall/api|/api 的 H5 大厅（如 679win 及同厂商皮肤站）
 * 原则：只替换认证等适配 OP；弹窗/跳转仍由 dist 处理
 *
 * | 目标 path（归一化去 /hall）              | OP |
 * |------------------------------------------|----|
 * | /api/member/login                        | auth.login |
 * | /api/member/agent/login                  | auth.login |
 * | /api/member/v2/fastLogin                 | auth.login |
 * | /api/member/getFastLogin                 | auth.login |
 * | /api/member/thirdPartyLogin              | auth.login |
 * | /api/member/register                     | auth.register |
 * | /api/member/fastRegister                 | auth.register |
 * | /api/member/check/register               | auth.checkRegister |
 * | /api/member/user/info                    | user.info |
 * | /api/gameCenter/gold                     | wallet.gold |
 * | /api/gameCenter/gameApi/RefreshGold      | wallet.gold |
 * | /api/gameCenter/gameApi/getPlatformBalance| wallet.gold |
 */

const { OP } = require('../../ops');

const CATALOG = [
  { path: '/api/member/login', op: OP.AUTH_LOGIN },
  { path: '/api/member/agent/login', op: OP.AUTH_LOGIN },
  { path: '/api/member/v2/fastLogin', op: OP.AUTH_LOGIN },
  { path: '/api/member/getFastLogin', op: OP.AUTH_LOGIN },
  { path: '/api/member/thirdPartyLogin', op: OP.AUTH_LOGIN },
  { path: '/api/member/register', op: OP.AUTH_REGISTER },
  { path: '/api/member/fastRegister', op: OP.AUTH_REGISTER },
  { path: '/api/member/check/register', op: OP.AUTH_CHECK_REGISTER },
  { path: '/api/member/user/info', op: OP.USER_INFO },
  { path: '/api/gameCenter/gold', op: OP.WALLET_GOLD },
  { path: '/api/gameCenter/gameApi/RefreshGold', op: OP.WALLET_GOLD },
  { path: '/api/gameCenter/gameApi/getPlatformBalance', op: OP.WALLET_GOLD }
];

const PATH_TO_OP = Object.create(null);
for (const row of CATALOG) PATH_TO_OP[row.path] = row.op;

/** 系列默认主机匹配（站点 adapter-hosts.json 可覆盖） */
const DEFAULT_HOST = {
  apiHostPatterns: [
    '\\.679win\\.(cc|me|co|net)$',
    '^(oniw|aniw)\\d*\\.'
  ],
  excludeHosts: ['679win.com', 'www.679win.com']
};

module.exports = { CATALOG, PATH_TO_OP, DEFAULT_HOST, OP };
