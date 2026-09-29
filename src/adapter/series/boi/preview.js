/**
 * boi 预览回源规则（sweboi 等，Vite 打包 + window.CONFIG{brandId,currentModel}）：
 * 业务 API 与页面同源 /api/*（如 /api/banner/list?client-type=h5），原样回源站，不补 /hall。
 * 回 SPA 的 index.html 会让前端 data.filter/reduce 报错。
 */
const MARKER_PATHS = ['/api/config/system', '/api/banner/list', '/api/config/getTenantLogo'];

module.exports = {
  hallChain: false,
  detect(ctx) {
    const cfg = ctx.configJs || '';
    if (/window\.CONFIG\s*=/.test(cfg) && /["']?brandId["']?\s*:/.test(cfg)) return true;
    let hits = 0;
    for (const p of MARKER_PATHS) {
      if (ctx.sourceApiPaths && ctx.sourceApiPaths.has(p)) hits++;
    }
    return hits >= 2;
  },
  resolveApiUpstream({ pathname, ctx }) {
    const p = String(pathname || '');
    if (p.indexOf('/api/') !== 0 || !ctx.sourceOrigin) return null;
    return { origin: ctx.sourceOrigin, path: p, refererOrigin: ctx.sourceOrigin + '/' };
  }
};
