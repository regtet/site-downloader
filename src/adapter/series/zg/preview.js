/**
 * zg 预览回源规则（k8f3wd 等，tRPC 前端，API 默认 https://api4.a-b-c-8.com/api/frontend/trpc/*）：
 * - 站点身份靠请求头 tenantId（来自 index.html 内嵌的 __APP_CONFIG__.domainInfo），不看 Origin
 * - API 前有 Cloudflare 地区/机房 IP 拦截：非巴西、AWS 等机房出口一律 403 HTML（"<!DOCTYPE"），
 *   Node 代理必被拦，所以 API 主机交给浏览器直连（走用户自己的线路），不改写成本地短 path
 */
const TRPC_PATH_RE = /^\/api\/frontend\/trpc\//;

function zgApiHosts(ctx) {
  const out = new Set();
  const entries = ctx.entries || [];
  for (let i = 0; i < entries.length; i++) {
    let u;
    try {
      u = new URL(String((entries[i] || {}).url || ''));
    } catch (_) {
      continue;
    }
    if (u.origin !== ctx.sourceOrigin && TRPC_PATH_RE.test(u.pathname)) out.add(u.hostname.toLowerCase());
  }
  return out;
}

module.exports = {
  hallChain: false,
  detect(ctx) {
    return zgApiHosts(ctx).size > 0;
  },
  directHosts(ctx) {
    return [...zgApiHosts(ctx)];
  }
};
