/**
 * 适配层「规范操作」——我们侧与目标系列之间的公共契约。
 * 系列只负责：目标 HTTP path → OP；provider 只负责：执行 OP。
 */
const OP = {
  AUTH_LOGIN: 'auth.login',
  AUTH_REGISTER: 'auth.register',
  AUTH_CHECK_REGISTER: 'auth.checkRegister',
  USER_INFO: 'user.info',
  WALLET_GOLD: 'wallet.gold'
};

module.exports = { OP };
