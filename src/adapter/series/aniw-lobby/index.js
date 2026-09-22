/**
 * Series aniw-lobby：P0 Bridge 目标侧
 * 仅精确匹配 migration-map，不做前缀空壳覆盖
 */
const { OP } = require('../../ops');
const { MIGRATION_MAP, CATALOG, DEFAULT_HOST } = require('./migration-map');
const { applyAdapter, memberProfile } = require('./adapters');

function normalizeApiPath(pathname) {
  let p = String(pathname || '');
  if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
  return p;
}

const CREDIT_AGENT_ALIAS = {
  '/api/agent/credit/agentCenter/agentBasic': '/api/agent/promote/agentBasic',
  '/api/agent/credit/agentCenter/indexInfoV2': '/api/agent/promote/index/indexInfoV2',
  '/api/agent/credit/agentCenter/agentCommission': '/api/agent/promote/index/agentCommission',
  '/api/agent/credit/agentCenter/settleTime': '/api/agent/promote/index/settleTime',
  '/api/agent/credit/agentCenter/agentPromotion': '/api/agent/promote/report/agentPromotion'
};

function matchRoute(pathname) {
  const p = normalizeApiPath(pathname);
  let row = MIGRATION_MAP[p];
  let path = p;
  // 教程地址带 /agentId/数字，和列表地址共用同一条官方回源
  if (!row && /\/api\/agent\/promote\/config\/tutorial(\/|$)/.test(p)) {
    row = MIGRATION_MAP['/api/agent/promote/config/tutorial'];
    path = '/api/agent/promote/config/tutorial';
  }
  if (!row && CREDIT_AGENT_ALIAS[p]) {
    path = CREDIT_AGENT_ALIAS[p];
    row = MIGRATION_MAP[path];
  }
  if (!row) return null;
  return { op: row.op, adapter: row.adapter, path, note: row.note || '' };
}

function mapResponse(op, providerResult, meta) {
  const adapterName = (meta && meta.adapter)
    || (op === OP.AUTH_LOGIN || op === OP.USER_INFO
      ? 'memberProfile'
      : op === OP.AUTH_REGISTER
        ? 'registerProfile'
        : op === OP.AUTH_CHECK_REGISTER
        ? 'checkRegister'
        : op === OP.AUTH_LOGOUT
          ? 'logout'
          : op === OP.WALLET_GOLD
            ? 'walletGold'
            : op === OP.USER_VIP
              ? 'vipSummary'
              : op === OP.USER_AVATARS
                ? 'avatars'
                : op === OP.PAY_PENDING
                  ? 'payPending'
                  : op === OP.PAY_LIST
                    ? 'payList'
                    : op === OP.PAY_TYPE
                      ? 'payType'
                      : op === OP.PAY_CHANNELS
                        ? 'payChannels'
                        : op === OP.PAY_INFOS
                          ? 'payInfos'
                          : op === OP.PAY_CREATE
                            ? 'payCreate'
                            : op === OP.PAY_ORDER_INFO
                              ? 'payOrderInfo'
                              : op === OP.GAME_LAUNCH
                                ? 'gameLaunch'
                              : (op === OP.AGENT_MODE
                                || op === OP.AGENT_PROMOTION
                                || op === OP.AGENT_INDEX
                                || op === OP.AGENT_TOTAL
                                || op === OP.AGENT_PERIOD
                                || op === OP.AGENT_COMMISSION
                                || op === OP.AGENT_MARQUEE
                                || op === OP.AGENT_BIND
                                || op === OP.AGENT_DIRECT
                                || op === OP.AGENT_CONFIG)
                                ? 'agentBlob'
                  : op === OP.WITHDRAW_PENDING
                    ? 'withdrawPending'
                    : op === OP.LOBBY_OK
                      ? 'lobbyOk'
                      : op === OP.EMPTY_RECORDS
                        ? 'emptyRecords'
                        : op === OP.FEATURE_PENDING
                          ? 'featurePending'
                          : null);
  return applyAdapter(adapterName, providerResult, meta);
}

module.exports = {
  id: 'aniw-lobby',
  label: 'aniw/oniw H5 lobby (679win family)',
  DEFAULT_HOST,
  CATALOG,
  MIGRATION_MAP,
  matchRoute,
  mapResponse,
  normalizeApiPath,
  toMemberProfile: memberProfile,
  applyAdapter
};
