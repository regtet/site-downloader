/**
 * Series hms-platform：暂无 Bridge 迁移表，仅提供预览回源规则
 */
const preview = require('./preview');

module.exports = {
  id: 'hms-platform',
  label: 'hms /api/platform H5 (hms-waterfight family)',
  DEFAULT_HOST: {
    apiHostPatterns: [preview.apiHostPattern.source],
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
