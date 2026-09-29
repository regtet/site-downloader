/**
 * Series fa：暂无 Bridge 迁移表，仅提供预览回源规则
 */
const preview = require('./preview');

module.exports = {
  id: 'fa',
  label: 'fa 跨域 /member /Config H5 (fiel777 family)',
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
