const fs = require('fs');
const path = require('path');
const ResourceParser = require('./resource-parser');
const { hasUnresolvedTemplate, expandTemplates, lobbyAssetLocalPath, lobbyAssetStemKey, isLikelyAssetFile } = require('./url-classify');

const ROOTISH_PREFIXES = ['assets/', 'lobby_asset/', 'libs/', 'cocos/', 'siteadmin/', 'pages/'];

class IntegrityChecker {
  constructor(options = {}) {
    this.outputDir = options.outputDir;
    this.sourceUrl = options.sourceUrl;
    this.urlMap = options.urlMap || new Map();
    this.templateContext = options.templateContext || {};
  }

  toLocalFromUrl(url) {
    if (this.urlMap.has(url)) return this.urlMap.get(url);
    const local = lobbyAssetLocalPath(url);
    if (local) return local;
    try {
      const parsed = new URL(url);
      let pathname = decodeURIComponent(parsed.pathname);
      const skinIdx = pathname.indexOf('/siteadmin/skin/lobby_asset/');
      if (skinIdx >= 0) return pathname.slice(skinIdx + '/siteadmin/skin/'.length);
      const source = new URL(this.sourceUrl);
      if (parsed.hostname === source.hostname) {
        if (pathname.startsWith('/')) pathname = pathname.slice(1);
        return pathname;
      }
    } catch {}
    return null;
  }

  existsLocal(localPath) {
    if (!localPath) return false;
    const tryPath = (rel) => fs.existsSync(path.join(this.outputDir, rel));
    if (tryPath(localPath)) return true;
    const noQuery = localPath.split('?')[0];
    if (noQuery !== localPath && tryPath(noQuery)) return true;

    const aliases = [localPath];
    if (localPath.startsWith('lobby_asset/')) {
      aliases.push('siteadmin/skin/' + localPath);
    }
    if (localPath.startsWith('siteadmin/skin/lobby_asset/')) {
      aliases.push(localPath.slice('siteadmin/skin/'.length));
    }

    for (const rel of aliases) {
      const ext = path.extname(rel).toLowerCase();
      if (['.png', '.jpg', '.jpeg', '.svg'].includes(ext)) {
        const base = rel.slice(0, -ext.length);
        if (['.avif', '.webp', '.png'].some((alt) => tryPath(base + alt))) return true;
        const stem = base.replace(/\d+$/, '');
        if (stem !== base && ['.avif', '.webp', '.png'].some((alt) => tryPath(stem + alt))) return true;
      }
      const stripped = rel.replace(/\.[a-f0-9]{6,}(\.[a-z0-9]+)$/i, '$1');
      if (stripped !== rel && tryPath(stripped)) return true;
      const stemKey = lobbyAssetStemKey(rel);
      if (stemKey && stemKey !== rel) {
        for (const altExt of ['.avif', '.webp', '.png', '.svg', ext]) {
          if (!altExt) continue;
          const candidate = stemKey + (altExt.startsWith('.') ? altExt : '');
          if (tryPath(candidate)) return true;
          if (tryPath('siteadmin/skin/' + candidate)) return true;
        }
      }
    }
    return false;
  }

  resolveLocalRef(raw, fromFile) {
    if (!raw || raw.startsWith('data:') || raw.startsWith('blob:') || raw.startsWith('javascript:') || raw.startsWith('#')) {
      return { skip: true };
    }

    let value = raw.trim();
    try { value = decodeURIComponent(value); } catch {}

    if (hasUnresolvedTemplate(value)) {
      const expanded = expandTemplates(value, this.templateContext);
      if (!hasUnresolvedTemplate(expanded)) {
        return this.resolveLocalRef(expanded, fromFile);
      }
      return { unresolved: true, url: value };
    }

    if (/^https?:\/\//i.test(value)) {
      if (!isLikelyAssetFile(value)) return { skip: true, external: true, url: value };
      const mapped = this.toLocalFromUrl(value);
      if (!mapped) return { skip: true, external: true, url: value };
      return { local: mapped.replace(/\\/g, '/'), url: value };
    }

    const cleaned = value.split('#')[0].split('?')[0].replace(/^\.\//, '');
    if (!path.extname(cleaned) && !cleaned.includes('lobby_asset/')) {
      return { skip: true };
    }

    if (cleaned.startsWith('/')) {
      const local = cleaned.slice(1);
      if (!isLikelyAssetFile(new URL('/' + local, this.sourceUrl).href)) return { skip: true };
      return { local, url: raw };
    }

    if (ROOTISH_PREFIXES.some((prefix) => cleaned.startsWith(prefix))) {
      if (!isLikelyAssetFile(new URL('/' + cleaned, this.sourceUrl).href)) return { skip: true };
      return { local: cleaned, url: raw };
    }

    if (cleaned.startsWith('./') || cleaned.startsWith('../')) {
      const fromDir = path.dirname(fromFile);
      const resolved = path.normalize(path.join(fromDir, cleaned)).replace(/\\/g, '/');
      if (resolved.startsWith('..')) return { skip: true, url: raw };
      return { local: resolved, url: raw };
    }

    return { skip: true, url: raw };
  }

  collectFromHtml(relativePath, html) {
    const refs = [];
    const parser = new ResourceParser(this.sourceUrl);
    const found = [];
    try {
      const cheerio = require('cheerio');
      const $ = cheerio.load(html, { decodeEntities: false });
      $('link[href], script[src], img[src], source[src], video[src], video[poster], audio[src], image[href]').each((_, el) => {
        const $el = $(el);
        const rel = ($el.attr('rel') || '').toLowerCase();
        if (rel.includes('preconnect') || rel.includes('dns-prefetch') || rel === 'manifest') return;
        ['href', 'src', 'poster'].forEach((attr) => {
          const val = $el.attr(attr);
          if (val) found.push(val);
        });
      });
      $('img[srcset], source[srcset]').each((_, el) => {
        parser.parseSrcset($(el).attr('srcset')).forEach((u) => found.push(u));
      });
      $('style').each((_, el) => {
        parser.extractFromCss($(el).html() || '', this.sourceUrl).forEach((u) => found.push(u));
      });
      $('[style]').each((_, el) => {
        parser.extractFromCss($(el).attr('style') || '', this.sourceUrl).forEach((u) => found.push(u));
      });
    } catch {
      return refs;
    }
    for (const raw of found) refs.push({ raw, from: relativePath, kind: 'html' });
    return refs;
  }

  collectFromCss(relativePath, css) {
    const parser = new ResourceParser(this.sourceUrl);
    const fileUrl = new URL(relativePath.replace(/\\/g, '/'), this.sourceUrl).href;
    return parser.extractFromCss(css, fileUrl).map((raw) => ({ raw, from: relativePath, kind: 'css' }));
  }

  collectFromJs(relativePath, js) {
    const parser = new ResourceParser(this.sourceUrl);
    const fileUrl = new URL(relativePath.replace(/\\/g, '/'), this.sourceUrl).href;
    return parser.extractFromJs(js, fileUrl).map((raw) => ({ raw, from: relativePath, kind: 'js' }));
  }

  check(files) {
    const brokenReferences = [];
    const unresolvedUrls = [];
    const seen = new Set();

    const add = (item) => {
      const key = `${item.from}|${item.ref}|${item.reason}`;
      if (seen.has(key)) return;
      seen.add(key);
      if (item.reason === 'unresolved-template-url') unresolvedUrls.push(item);
      else brokenReferences.push(item);
    };

    for (const relativePath of files) {
      const absPath = path.join(this.outputDir, relativePath);
      if (!fs.existsSync(absPath)) continue;
      const ext = path.extname(relativePath).toLowerCase();
      let refs = [];
      try {
        const content = fs.readFileSync(absPath, 'utf-8');
        if (ext === '.html' || ext === '.htm') refs = this.collectFromHtml(relativePath, content);
        else if (ext === '.css') refs = this.collectFromCss(relativePath, content);
        else if (['.js', '.mjs', '.cjs'].includes(ext)) refs = this.collectFromJs(relativePath, content);
      } catch {
        continue;
      }

      for (const ref of refs) {
        const resolved = this.resolveLocalRef(ref.raw, relativePath);
        if (resolved.skip) continue;
        if (resolved.unresolved) {
          add({
            from: relativePath,
            ref: resolved.url,
            reason: 'unresolved-template-url',
            kind: ref.kind
          });
          continue;
        }
        if (!this.existsLocal(resolved.local)) {
          add({
            from: relativePath,
            ref: ref.raw,
            local: resolved.local,
            reason: 'missing-local-file',
            kind: ref.kind
          });
        }
      }
    }

    const missingAssets = [...new Set(brokenReferences.map((item) => item.local).filter(Boolean))];
    return {
      brokenReferences,
      unresolvedUrls,
      missingAssets,
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = IntegrityChecker;
