/**
 * Series xm-cfg：暂无 Bridge 迁移表，仅提供预览回源规则
 */
const preview = require('./preview');

module.exports = {
  id: 'xm-cfg',
  label: 'xm 跨域 /global/cfg /pg/game H5 (68wins family)',
  DEFAULT_HOST: {
    apiHostPatterns: [],
    excludeHosts: []
  },
  CATALOG: {},
  MIGRATION_MAP: {},
  preview,
  matchRoute() {
    return null;
  },
  mapResponse(_op, providerResult) {
    return providerResult;
  },
  normalizeApiPath(pathname) {
    return String(pathname || '');
  }
};
