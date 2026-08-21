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
    op: OP.WALLET_GOLD,
    transport: 'local',
    steps: ['session.gold'],
    out: ['game_gold', 'totalGold']
  }
];

module.exports = { CATALOG };
