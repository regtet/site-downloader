const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const { stripCacheBustFromUrl } = require('./url-query');

class PathRewriter {
  constructor(outputDir, urlMap) {
    this.outputDir = outputDir;
    this.urlMap = urlMap;
    this.localToUrl = new Map();
    for (const [url, localPath] of urlMap.entries()) {
      const key = String(localPath).replace(/\\/g, '/');
      if (!this.localToUrl.has(key)) this.localToUrl.set(key, url);
    }
    this.replacementList = this.buildReplacementList();
  }

  buildReplacementList() {
    const entries = [];
    for (const [url, localPath] of this.urlMap.entries()) {
      entries.push({ url, localPath, relative: localPath.replace(/\\/g, '/') });
    }
    entries.sort((a, b) => b.url.length - a.url.length);
    return entries;
  }

  toRelative(fromFile, targetLocal) {
    const fromDir = path.dirname(fromFile);
    let rel = path.relative(fromDir, targetLocal).replace(/\\/g, '/');
    if (!rel.startsWith('.')) rel = './' + rel;
    return rel;
  }

  /** JS 运行时资源 URL 需保持站点根路径，避免 SPA 子路由下相对路径解析错误 */
  toRootPath(targetLocal) {
    const norm = String(targetLocal).replace(/\\/g, '/').replace(/^\/+/, '');
    return '/' + norm;
  }

  resolveLocal(url, fromFile, mode = 'relative') {
    const localPath = this.urlMap.get(url);
    if (!localPath) return null;
    const absLocal = path.join(this.outputDir, localPath);
    return mode === 'root' ? this.toRootPath(localPath) : this.toRelative(fromFile, absLocal);
  }

  lookupUrl(rawUrl, baseUrl, fromFile, mode = 'relative') {
    try {
      const parsed = new URL(rawUrl, baseUrl);
      parsed.hash = '';
      const candidates = new Set([parsed.href, stripCacheBustFromUrl(parsed.href)]);
      if (parsed.search) {
        const noSearch = new URL(parsed.href);
        noSearch.search = '';
        candidates.add(noSearch.href);
      }
      for (const href of candidates) {
        if (this.urlMap.has(href)) {
          return this.resolveLocal(href, fromFile, mode);
        }
      }
      // 根路径 /static/... 按 pathname 匹配（忽略 query）
      if (parsed.pathname && parsed.pathname.startsWith('/')) {
        const pathnameKey = decodeURIComponent(parsed.pathname);
        for (const [mappedUrl, localPath] of this.urlMap.entries()) {
          try {
            const mappedPath = decodeURIComponent(new URL(mappedUrl).pathname);
            if (mappedPath === pathnameKey) {
              return mode === 'root' ? this.toRootPath(localPath) : this.resolveLocal(mappedUrl, fromFile, mode);
            }
          } catch {
            continue;
          }
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  rewriteHtml(html, filePath, originalUrl) {
    const baseUrl = originalUrl || ('file:///' + filePath.replace(/\\/g, '/'));
    const $ = cheerio.load(html, { decodeEntities: false });

    const rewriteAttr = (el, attr) => {
      const val = $(el).attr(attr);
      if (!val) return;
      const newVal = this.rewriteValue(val, baseUrl, filePath);
      if (newVal !== val) $(el).attr(attr, newVal);
    };

    $('link[href], script[src], img[src], source[src], video[src], video[poster], audio[src], iframe[src], embed[src], object[data], input[src], image[href]').each((_, el) => {
      const tag = el.tagName.toLowerCase();
      if (tag === 'link') rewriteAttr(el, 'href');
      else if (tag === 'image') rewriteAttr(el, 'href');
      else rewriteAttr(el, tag === 'object' ? 'data' : 'src');
    });

    $('img[srcset], source[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset');
      if (!srcset) return;
      const rewritten = srcset.split(',').map(part => {
        const pieces = part.trim().split(/\s+/);
        const newUrl = this.rewriteValue(pieces[0], baseUrl, filePath);
        pieces[0] = newUrl;
        return pieces.join(' ');
      }).join(', ');
      $(el).attr('srcset', rewritten);
    });

    $('style').each((_, el) => {
      const css = $(el).html() || '';
      $(el).html(this.rewriteCss(css, baseUrl, filePath));
    });

    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      $(el).attr('style', this.rewriteCss(style, baseUrl, filePath));
    });

    // SPA 深路由（如 /home/event）下，相对路径 ./assets 会解析成 /home/assets → 404。
    // 固定 document base 为站点根，入口/modulepreload 才能稳定加载。
    if ($('base').length) $('base').remove();
    if ($('head').length) {
      $('head').prepend('<base href="/" />');
    } else {
      $.root().prepend('<base href="/" />');
    }

    $('script:not([src])').each((_, el) => {
      const code = $(el).html() || '';
      if (/import\s*(?:\(|\/)/.test(code) || code.includes('__vite') || code.includes('/assets/')) {
        $(el).html(this.rewriteInlineModuleScript(code, baseUrl, filePath));
      }
    });

    // HTML 内 assets 链接也改为根路径，避免深路由 + 无 base 时 modulepreload 打错
    $('link[href], script[src]').each((_, el) => {
      const attr = el.tagName.toLowerCase() === 'link' ? 'href' : 'src';
      const val = $(el).attr(attr);
      if (val && /^\.\/(?:assets|libs|cocos|vendors)\//.test(val)) {
        $(el).attr(attr, val.replace(/^\./, ''));
      }
    });

    return $.html();
  }

  /**
   * 内联 module：强制站点根绝对路径 /assets/...（配合 <base href="/">）。
   * 不要用 ./assets —— 在 /home/event 这类深路由下会请求 /home/assets，模块失败后类名挂不上。
   */
  rewriteInlineModuleScript(code, baseUrl, fromFile) {
    let result = this.rewriteJs(code, baseUrl, fromFile);
    result = result.replace(
      /import\s*\(\s*(["'])\.\/((?:assets|libs|cocos|vendors|lobby_asset)\/[^"']+)\1\s*\)/g,
      'import($1/$2$1)'
    );
    result = result.replace(
      /from\s*(["'])\.\/((?:assets|libs|cocos|vendors|lobby_asset)\/[^"']+)\1/g,
      'from $1/$2$1'
    );
    return result;
  }

  rewriteValue(value, baseUrl, fromFile) {
    if (!value || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('javascript:')) {
      return value;
    }
    const local = this.lookupUrl(value, baseUrl, fromFile);
    return local || value;
  }

  rewriteCss(css, cssBaseUrl, fromFile) {
    try {
      const root = postcss.parse(css, { from: undefined });
      root.walkDecls(decl => {
        if (decl.value.includes('url(')) {
          decl.value = this.rewriteCssValue(decl.value, cssBaseUrl, fromFile);
        }
      });
      root.walkAtRules('import', rule => {
        const params = rule.params.trim();
        const unquoted = params.replace(/^['"]|['"]$/g, '').replace(/^url\(['"]?|['"]?\)$/g, '');
        const local = this.lookupUrl(unquoted, cssBaseUrl, fromFile);
        if (local) {
          rule.params = `'${local}'`;
        }
      });
      root.walkAtRules('font-face', rule => {
        rule.walkDecls(decl => {
          if (decl.prop === 'src') {
            decl.value = this.rewriteCssValue(decl.value, cssBaseUrl, fromFile);
          }
        });
      });
      return root.toString();
    } catch {
      return css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/gi, (full, urlPart) => {
        const local = this.lookupUrl(urlPart.trim(), cssBaseUrl, fromFile);
        return local ? `url('${local}')` : full;
      });
    }
  }

  rewriteCssValue(value, cssBaseUrl, fromFile) {
    const parsed = valueParser(value);
    parsed.walk(node => {
      if (node.type === 'function' && node.value === 'url' && node.nodes.length) {
        const raw = valueParser.stringify(node.nodes).replace(/^['"]|['"]$/g, '');
        const local = this.lookupUrl(raw, cssBaseUrl, fromFile);
        if (local) {
          node.nodes = [{ type: 'word', value: local }];
        }
      }
    });
    return parsed.toString();
  }

  jsRewriteMode(localPath) {
    const p = String(localPath || '').replace(/\\/g, '/');
    // 图片/静态资源运行时挂到 img.src，需保持站点根路径
    if (p.startsWith('static/')) return 'root';
    // Vite chunk / libs 用相对路径，避免子目录预览时 /assets 打到错误根
    return 'relative';
  }

  rewriteJs(js, jsBaseUrl, fromFile) {
    let result = js;
    for (const { url, localPath } of this.replacementList) {
      const mode = this.jsRewriteMode(localPath);
      const local = this.lookupUrl(url, jsBaseUrl, fromFile, mode);
      if (!local) continue;
      const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), local.replace(/\\/g, '/'));
    }
    // "/static/..." → 本地根路径（适配 SPA 路由下的图片赋值）
    result = result.replace(/(["'])(\/static\/[^"'?#]+)(\?[^"'#]*)?\1/g, (full, quote, staticPath, query) => {
      const local = this.lookupUrl(staticPath, jsBaseUrl, fromFile, 'root');
      if (!local || local === staticPath) return full;
      return quote + local + (query || '') + quote;
    });
    // 模块绝对路径 /assets|/libs|... → 相对当前 JS 文件
    result = result.replace(
      /(import\s*\(\s*|from\s*|import\s*)(["'])\/((?:assets|libs|cocos|vendors)\/[^"']+)\2/g,
      (full, prefix, quote, assetPath) => {
        const absLocal = path.join(this.outputDir, assetPath);
        if (!fs.existsSync(absLocal)) return full;
        const rel = this.toRelative(fromFile, absLocal);
        return `${prefix}${quote}${rel}${quote}`;
      }
    );
    return result;
  }

  rewriteFile(relativePath) {
    const absPath = path.join(this.outputDir, relativePath);
    if (!fs.existsSync(absPath)) return;
    const ext = path.extname(relativePath).toLowerCase();
    const content = fs.readFileSync(absPath, 'utf-8');
    const normalizedRel = String(relativePath).replace(/\\/g, '/');
    const originalUrl = this.localToUrl.get(normalizedRel);
    const fileUrl = originalUrl || new URL(normalizedRel, 'https://local.invalid/').href;
    let rewritten = content;

    if (ext === '.html' || ext === '.htm') {
      rewritten = this.rewriteHtml(content, absPath, originalUrl);
    } else if (ext === '.css') {
      rewritten = this.rewriteCss(content, fileUrl, absPath);
    } else if (ext === '.js' || ext === '.mjs' || ext === '.cjs') {
      rewritten = this.rewriteJs(content, fileUrl, absPath);
    }

    if (rewritten !== content) {
      fs.writeFileSync(absPath, rewritten);
    }
  }

  rewriteAll(files) {
    for (const file of files) {
      this.rewriteFile(file);
    }
  }
}

module.exports = PathRewriter;
