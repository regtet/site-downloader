const fs = require('fs');
const path = require('path');
const cheerio = require('cheerio');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');

class PathRewriter {
  constructor(outputDir, urlMap) {
    this.outputDir = outputDir;
    this.urlMap = urlMap;
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

  resolveLocal(url, fromFile) {
    const localPath = this.urlMap.get(url);
    if (!localPath) return null;
    const absLocal = path.join(this.outputDir, localPath);
    return this.toRelative(fromFile, absLocal);
  }

  lookupUrl(rawUrl, baseUrl, fromFile) {
    try {
      const parsed = new URL(rawUrl, baseUrl);
      parsed.hash = '';
      const href = parsed.href;
      if (this.urlMap.has(href)) {
        return this.resolveLocal(href, fromFile);
      }
      for (const [url, localPath] of this.urlMap.entries()) {
        if (url === href) {
          return this.toRelative(fromFile, path.join(this.outputDir, localPath));
        }
      }
    } catch {
      return null;
    }
    return null;
  }

  rewriteHtml(html, filePath) {
    const baseUrl = 'file:///' + filePath.replace(/\\/g, '/');
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

    if ($('base').length) {
      $('base').remove();
    }

    return $.html();
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

  rewriteJs(js, jsBaseUrl, fromFile) {
    let result = js;
    for (const { url } of this.replacementList) {
      const local = this.lookupUrl(url, jsBaseUrl, fromFile);
      if (!local) continue;
      const escaped = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      result = result.replace(new RegExp(escaped, 'g'), local.replace(/\\/g, '/'));
    }
    return result;
  }

  rewriteFile(relativePath) {
    const absPath = path.join(this.outputDir, relativePath);
    if (!fs.existsSync(absPath)) return;
    const ext = path.extname(relativePath).toLowerCase();
    const content = fs.readFileSync(absPath, 'utf-8');
    const fileUrl = new URL(relativePath, 'file:///').href;
    let rewritten = content;

    if (ext === '.html' || ext === '.htm') {
      rewritten = this.rewriteHtml(content, absPath);
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
