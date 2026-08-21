/**
 * 兼容旧引用：逻辑已迁到 providers/wgame + series/aniw-lobby
 */
const provider = require('./providers/wgame');
const { OP } = require('./ops');

async function handleRegister(body, ctx) {
  return provider.execute(OP.AUTH_REGISTER, { body, siteDir: ctx && ctx.siteDir });
}
async function handleLogin(body, ctx) {
  return provider.execute(OP.AUTH_LOGIN, { body, siteDir: ctx && ctx.siteDir });
}
async function handleCheckRegister(body) {
  return provider.execute(OP.AUTH_CHECK_REGISTER, { body });
}
async function handleUserInfo(body, headers) {
  return provider.execute(OP.USER_INFO, { body, headers });
}
async function handleGold(body, headers) {
  return provider.execute(OP.WALLET_GOLD, { body, headers });
}

module.exports = {
  handleRegister,
  handleLogin,
  handleCheckRegister,
  handleUserInfo,
  handleGold,
  normalizeBody: provider.normalizeBody,
  loadWgameConfig: provider.loadWgameConfig,
  users: provider.users,
  wgameSessions: provider.sessions
};
