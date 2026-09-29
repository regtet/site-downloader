/**
 * aniw-lobby 预览回源规则：业务 API 在 aniw*（上游只认 /hall/api），OSS 在 oniw*。
 * 具体回源链（补 /hall、siteCode、OSS json）在 static-server 的 hallChain 分支。
 */
const HINT_HOST_RE = /^(aniw|oniw)\d*\./i;

module.exports = {
  hallChain: true,
  hintHostPattern: HINT_HOST_RE,
  detect(ctx) {
    for (const h of ctx.hosts) {
      if (HINT_HOST_RE.test(h)) return true;
    }
    return /LOBBY_SITE_CONFIG/.test(ctx.html || '');
  }
};
