/**
 * Series boi：暂无 Bridge 迁移表，仅提供预览回源规则
 */
const preview = require('./preview');

module.exports = {
  id: 'boi',
  label: 'boi 同源 /api H5 (sweboi family)',
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
