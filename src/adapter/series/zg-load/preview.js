/**
 * zg-load 预览回源规则（brninja.com 等，Vite + Vant PWA）。
 * 接口和页面同源 /api/*：首页内联脚本预取 POST /api/load（邀请参数放请求头 InviteCode/InviteType），
 * 后台上传图片也在 /api/uploads/*（已下载到本地的照常走本地文件）。
 * 本地没有的 /api/* 一律回源站；同源 GET 浏览器不带 Origin，回源保持一致。
 */
function hasBootstrapLoad(html) {
  const text = String(html || '');
  return /__BOOTSTRAP_PROMISE__/.test(text) && /fetch\(\s*base\s*\+\s*["']\/load["']/.test(text);
}

module.exports = {
  hasBootstrapLoad,
  hallChain: false,
  detect(ctx) {
    if (hasBootstrapLoad(ctx.html)) return true;
    return !!(ctx.sourceApiPaths && ctx.sourceApiPaths.has('/api/load') && ctx.sourceApiPaths.has('/api/manifest'));
  },
  resolveApiUpstream({ pathname, ctx }) {
    const p = String(pathname || '');
    if (p.indexOf('/api/') !== 0 || !ctx.sourceOrigin) return null;
    return { origin: ctx.sourceOrigin, path: p, refererOrigin: ctx.sourceOrigin + '/', originPolicy: 'browser' };
  }
};
