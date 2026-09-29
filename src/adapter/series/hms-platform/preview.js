/**
 * hms-platform 预览回源规则（hms-waterfight 等）：
 * 业务 API 在独立主机 api.hmsgame3.com / api.hermes-game.com，path 原样是 /api/platform/*，
 * 上游不认 /hall 前缀（/hall/api/platform/site → 404）。
 */
const API_HOST_RE = /^api\.(?:hmsgame\d*|hermes-game)\.com$/i;

function isApiHostFor(ctx, hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return false;
  if (API_HOST_RE.test(h)) return true;
  for (const origin of ctx.apiOrigins.keys()) {
    try {
      if (new URL(origin).hostname.toLowerCase() === h) return true;
    } catch (_) { /* ignore */ }
  }
  return false;
}

function primaryApiOrigin(ctx) {
  let best = '';
  let score = 0;
  for (const [origin, n] of ctx.apiOrigins) {
    if (n > score) {
      best = origin;
      score = n;
    }
  }
  return best;
}

module.exports = {
  hallChain: false,
  apiHostPattern: API_HOST_RE,
  detect(ctx) {
    for (const h of ctx.hosts) {
      if (API_HOST_RE.test(h)) return true;
    }
    for (const p of Object.keys(ctx.pathOrigin)) {
      if (p.indexOf('/api/platform/') === 0) return true;
    }
    return false;
  },
  /**
   * @returns {{ origin: string, path: string, refererOrigin: string } | null}
   */
  resolveApiUpstream({ pathname, hintedOrigin, ctx }) {
    const p = String(pathname || '');
    if (p.indexOf('/api/') !== 0) return null;
    let origin = '';
    try {
      const u = hintedOrigin ? new URL(hintedOrigin) : null;
      if (u && (u.protocol === 'https:' || u.protocol === 'http:') && isApiHostFor(ctx, u.hostname)) {
        origin = u.origin;
      }
    } catch (_) { /* ignore */ }
    if (!origin) origin = ctx.pathOrigin[p] || primaryApiOrigin(ctx);
    if (!origin) return null;
    return {
      origin,
      path: p,
      refererOrigin: ctx.sourceOrigin ? ctx.sourceOrigin + '/' : ''
    };
  }
};
