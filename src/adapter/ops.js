/**
 * 规范 OP —— 系列 path 映射到此；provider 只认 OP。
 * lobby.* = 无上游、仅用本地会话拼目标形状（数据适配层产出）
 */
const OP = {
  AUTH_LOGIN: 'auth.login',
  AUTH_REGISTER: 'auth.register',
  AUTH_CHECK_REGISTER: 'auth.checkRegister',
  AUTH_LOGOUT: 'auth.logout',
  USER_INFO: 'user.info',
  USER_VIP: 'user.vip',
  USER_AVATARS: 'user.avatars',
  WALLET_GOLD: 'wallet.gold',
  /** wgame 尚无对应能力：Bridge 返回明确失败，禁止空成功 */
  PAY_PENDING: 'pay.pending',
  /** 配置驱动充值（providerOptions.pay） */
  PAY_LIST: 'pay.list',
  PAY_TYPE: 'pay.type',
  PAY_CHANNELS: 'pay.channels',
  PAY_INFOS: 'pay.infos',
  PAY_CREATE: 'pay.create',
  PAY_ORDER_INFO: 'pay.orderInfo',
  /** 代理页：配置驱动零态 / 真实报表 */
  AGENT_MODE: 'agent.mode',
  AGENT_PROMOTION: 'agent.promotion',
  AGENT_INDEX: 'agent.index',
  AGENT_TOTAL: 'agent.total',
  AGENT_PERIOD: 'agent.period',
  AGENT_COMMISSION: 'agent.commission',
  AGENT_MARQUEE: 'agent.marquee',
  AGENT_BIND: 'agent.bind',
  AGENT_DIRECT: 'agent.direct',
  AGENT_CONFIG: 'agent.config',
  WITHDRAW_PENDING: 'withdraw.pending',
  /** 心跳/埋点等无业务数据：显式成功空壳（非伪造余额/渠道） */
  LOBBY_OK: 'lobby.ok',
  /** 流水类：真实无记录时返回空列表 */
  EMPTY_RECORDS: 'lobby.emptyRecords',
  /** 功能未接：明确失败，禁止空成功领奖/绑卡 */
  FEATURE_PENDING: 'feature.pending',
  /** 本地会话上下文 → 由 response adapter 填目标结构 */
  LOBBY_LOCAL: 'lobby.local'
};

module.exports = { OP };
