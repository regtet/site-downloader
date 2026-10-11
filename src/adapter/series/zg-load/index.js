/**
 * Series zg-load：暂无 Bridge 迁移表，仅提供预览回源规则
 */
const preview = require('./preview');

module.exports = {
  id: 'zg-load',
  label: 'zg 同源 /api/load Vant PWA (brninja family)',
  DEFAULT_HOST: {
    apiHostPatterns: [],
    excludeHosts: []
  },
  CATALOG: {},
  MIGRATION_MAP: {},
  preview,
  /** 活动列表图（/api/activityGroupList）只在 Promoções 页出现 */
  captureRoutes(html) {
    return preview.hasBootstrapLoad(html) ? ['/promotions'] : [];
  },
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
