/**
 * 规范 OP —— 系列 path 映射到此；provider 只认 OP。
 * lobby.* = 无上游、仅用本地会话拼目标形状（数据适配层产出）
 */
const OP = {
  AUTH_LOGIN: 'auth.login',
  AUTH_REGISTER: 'auth.register',
  AUTH_CHECK_REGISTER: 'auth.checkRegister',
  USER_INFO: 'user.info',
  USER_VIP: 'user.vip',
  USER_AVATARS: 'user.avatars',
  WALLET_GOLD: 'wallet.gold',
  /** wgame 尚无对应能力：Bridge 返回明确失败，禁止空成功 */
  PAY_PENDING: 'pay.pending',
  /** 本地会话上下文 → 由 response adapter 填目标结构 */
  LOBBY_LOCAL: 'lobby.local'
};

module.exports = { OP };
