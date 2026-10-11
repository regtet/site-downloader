/**
 * xm-cfg 预览回源规则（cnsolbr.com 等，Vite + Vue，index.html 内联 window.API_BASE_URL 指向跨域 API 如 https://api.68wins.vip）：
 * 接口是 /global/*、/pg/game/*、/activity/*、/user/*，POST JSON，响应 {code,msg,data}，code=0 成功。
 * 后端只按 Origin/Referer 选站点：带 API 自己的域名时 /global/cfg 回 data:null、/pg/game/index/hot 回 code 1000，
 * 前端读 data.cfgAdSiteVos 直接崩，所以代理到 API 主机时 Origin/Referer 必须是源站。
 */
const MARKER_PATHS = [
  '/global/cfg',
  '/global/splash',
  '/global/cfg/listCustomerService',
  '/pg/game/index/hot',
  '/pg/game/index/type',
  '/pg/game/index/v3'
];

function xmCfgApiOrigins(ctx) {
  if (ctx._xmCfgApiOrigins) return ctx._xmCfgApiOrigins;
  const out = new Set();
  const entries = ctx.entries || [];
  for (let i = 0; i < entries.length; i++) {
    let u;
    try {
      u = new URL(String((entries[i] || {}).url || ''));
    } catch (_) {
      continue;
    }
    if (u.origin === ctx.sourceOrigin) continue;
    if (MARKER_PATHS.indexOf(u.pathname) !== -1) out.add(u.origin);
  }
  ctx._xmCfgApiOrigins = out;
  return out;
}

module.exports = {
  hallChain: false,
  detect(ctx) {
    const hits = new Set();
    const entries = ctx.entries || [];
    for (let i = 0; i < entries.length; i++) {
      let u;
      try {
        u = new URL(String((entries[i] || {}).url || ''));
      } catch (_) {
        continue;
      }
      if (u.origin !== ctx.sourceOrigin && MARKER_PATHS.indexOf(u.pathname) !== -1) hits.add(u.pathname);
    }
    return hits.size >= 2;
  },
  /** 代理到 xm-cfg API 主机时用源站作 Origin/Referer；其他主机返回空，沿用默认 */
  proxyRefererOrigin({ target, ctx }) {
    if (!target || !ctx.sourceOrigin) return '';
    return xmCfgApiOrigins(ctx).has(target.origin) ? ctx.sourceOrigin + '/' : '';
  }
};
