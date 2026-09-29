/**
 * fa 预览回源规则（fiel777 等，Vite 打包，axios baseURL 写死跨域 API 如 https://games.cornalnasrv.com/）：
 * 接口是 /member/*、/Config/*、/pay/*，响应 {status,data}。
 * 后端只按 Origin 选站点：不带或带错 Origin 会回默认站（system_platform_id 0）的轮播/公告/活动，
 * 所以代理到 API 主机时 Origin/Referer 必须是源站。
 */
const API_PATH_RE = /^\/(?:member|Config|pay|sms)\//;
const MARKER_PATHS = ['/member/banner', '/Config/Announcement', '/member/platform/list', '/Config/active/switch/list'];

function faApiOrigins(ctx) {
  if (ctx._faApiOrigins) return ctx._faApiOrigins;
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
    if (API_PATH_RE.test(u.pathname)) out.add(u.origin);
  }
  ctx._faApiOrigins = out;
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
  /** 代理到 fa API 主机时用源站作 Origin/Referer；其他主机返回空，沿用默认 */
  proxyRefererOrigin({ target, ctx }) {
    if (!target || !ctx.sourceOrigin) return '';
    return faApiOrigins(ctx).has(target.origin) ? ctx.sourceOrigin + '/' : '';
  }
};
