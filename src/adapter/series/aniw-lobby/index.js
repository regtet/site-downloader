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

function matchRoute(pathname) {
  const p = normalizeApiPath(pathname);
  const row = MIGRATION_MAP[p];
  if (!row) return null;
  return { op: row.op, adapter: row.adapter, path: p, note: row.note || '' };
}

function mapResponse(op, providerResult, meta) {
  const adapterName = (meta && meta.adapter)
    || (op === OP.AUTH_LOGIN || op === OP.AUTH_REGISTER || op === OP.USER_INFO
      ? 'memberProfile'
      : op === OP.AUTH_CHECK_REGISTER
        ? 'checkRegister'
        : op === OP.WALLET_GOLD
          ? 'walletGold'
          : op === OP.USER_VIP
            ? 'vipSummary'
            : op === OP.USER_AVATARS
              ? 'avatars'
              : op === OP.PAY_PENDING
                ? 'payPending'
                : null);
  return applyAdapter(adapterName, providerResult);
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
