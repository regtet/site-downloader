/**
 * Provider: wgame —— 我们自己的后端能力目录（与目标站 HTTP 无关）
 *
 * 传输：WSS 网关二进制包（护照 EST_LOGON + 大厅 EST_HALL）
 * 配置：站点 adapter-hosts.json → providerOptions / wgame
 *
 * | OP                    | 网关动作                         | 关键结果字段 |
 * |-----------------------|----------------------------------|------------|
 * | auth.register         | 注册 + 自动登录 + 大厅登录       | session, userId, game_gold |
 * | auth.login            | 护照登录 + 大厅登录              | 同上 |
 * | auth.checkRegister    | 本地会话探测（暂无远端查重）     | exists |
 * | user.info             | 读登录会话缓存                   | profile |
 * | wallet.gold           | 读会话金币（大厅 happyMoney/1000）| game_gold |
 *
 * 大厅金币：happyMoney 为整数分母 1000 → 展示 game_gold
 */

const { OP } = require('../../ops');

const CATALOG = [
  {
    op: OP.AUTH_REGISTER,
    transport: 'wss',
    steps: ['passport.register', 'passport.login', 'hall.login'],
    out: ['sSession', 'dwUserID', 'game_gold', 'nickname', 'nVipLevel']
  },
  {
    op: OP.AUTH_LOGIN,
    transport: 'wss',
    steps: ['passport.login', 'hall.login'],
    out: ['sSession', 'dwUserID', 'game_gold', 'nickname', 'nVipLevel']
  },
  {
    op: OP.AUTH_CHECK_REGISTER,
    transport: 'local',
    steps: ['session.lookup'],
    out: ['exists']
  },
  {
    op: OP.USER_INFO,
    transport: 'local',
    steps: ['session.profile'],
    out: ['profile']
  },
  {
    op: OP.USER_VIP,
    transport: 'local',
    steps: ['session.vip_level'],
    out: ['vip_level']
  },
  {
    op: OP.USER_AVATARS,
    transport: 'local',
    steps: ['session.face_id', 'default_portraits'],
    out: ['portrait_id']
  },
  {
    op: OP.WALLET_GOLD,
    transport: 'local',
    steps: ['session.gold'],
    out: ['game_gold', 'totalGold']
  },
  {
    op: OP.PAY_PENDING,
    transport: 'local',
    steps: [],
    out: [],
    note: 'legacy pending when pay.enabled=false'
  },
  {
    op: OP.PAY_LIST,
    transport: 'local',
    steps: ['providerOptions.pay.categories'],
    out: ['list']
  },
  {
    op: OP.PAY_TYPE,
    transport: 'local',
    steps: ['providerOptions.pay.types'],
    out: ['payKind.list']
  },
  {
    op: OP.PAY_CHANNELS,
    transport: 'local',
    steps: ['providerOptions.pay.channelsByPayKind'],
    out: ['list', 'min', 'max']
  },
  {
    op: OP.PAY_INFOS,
    transport: 'local',
    steps: ['providerOptions.pay.payInfos'],
    out: ['cards']
  },
  {
    op: OP.PAY_CREATE,
    transport: 'local',
    steps: ['providerOptions.pay.createOrder'],
    out: ['orderNo', 'qrCode', 'url']
  },
  {
    op: OP.PAY_ORDER_INFO,
    transport: 'local',
    steps: ['pay-orders'],
    out: ['orderNo', 'status']
  },
  {
    op: OP.GAME_LAUNCH,
    transport: 'local',
    steps: ['providerOptions.game.mappings'],
    out: ['game_url', 'gameName', 'direction']
  },
  {
    op: OP.AGENT_MODE,
    transport: 'local',
    steps: ['providerOptions.agent.agentMode'],
    out: ['agent_id']
  },
  {
    op: OP.AGENT_INDEX,
    transport: 'local',
    steps: ['providerOptions.agent.indexInfo'],
    out: []
  },
  {
    op: OP.WITHDRAW_PENDING,
    transport: 'local',
    steps: [],
    out: [],
    note: 'no wgame withdraw; bridge returns explicit failure'
  },
  {
    op: OP.AUTH_LOGOUT,
    transport: 'local',
    steps: ['session.clear'],
    out: ['loggedOut']
  },
  {
    op: OP.LOBBY_OK,
    transport: 'local',
    steps: [],
    out: []
  },
  {
    op: OP.EMPTY_RECORDS,
    transport: 'local',
    steps: [],
    out: ['list', 'total']
  },
  {
    op: OP.FEATURE_PENDING,
    transport: 'local',
    steps: [],
    out: [],
    note: 'feature not available; explicit failure'
  }
];

module.exports = { CATALOG };
