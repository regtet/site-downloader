const cheerio = require('cheerio');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const DedupeManager = require('./dedupe');
const { isLikelyAssetFile } = require('./url-classify');

const URL_ATTRS = [
  ['link', 'href'],
  ['script', 'src'],
  ['img', 'src'],
  ['source', 'src'],
  ['video', 'src'],
  ['video', 'poster'],
  ['audio', 'src'],
  ['iframe', 'src'],
  ['embed', 'src'],
  ['object', 'data'],
  ['input', 'src'],
  ['image', 'href', 'xlink:href']
];

const PRELOAD_ATTRS = ['href'];

const STATIC_EXT_PATTERN = /\.(js|mjs|cjs|css|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|eot|mp4|webm|wasm|json|map)(\?[^'"`\s)]*)?$/i;

class ResourceParser {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.dedupe = new DedupeManager();
  }

  normalize(rawUrl) {
    return this.dedupe.normalizeUrl(rawUrl, this.baseUrl);
  }

  extractFromHtml(html) {
    const urls = new Set();
    const $ = cheerio.load(html, { decodeEntities: false });

    for (const [tag, ...attrs] of URL_ATTRS) {
      $(tag).each((_, el) => {
        if (tag === 'link') {
          const rel = ($(el).attr('rel') || '').toLowerCase();
          if (rel.includes('preconnect') || rel.includes('dns-prefetch') || rel.includes('prerender')) {
            return;
          }
        }
        for (const attr of attrs) {
          const val = $(el).attr(attr);
          const normalized = this.normalize(val);
          if (normalized) urls.add(normalized);
        }
      });
    }

    $('link[rel="stylesheet"], link[rel="preload"], link[rel="prefetch"], link[rel="modulepreload"], link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').each((_, el) => {
      const href = $(el).attr('href');
      const normalized = this.normalize(href);
      if (normalized) urls.add(normalized);
    });

    $('img[srcset], source[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset');
      this.parseSrcset(srcset).forEach(u => urls.add(u));
    });

    $('style').each((_, el) => {
      const css = $(el).html() || '';
      this.extractFromCss(css).forEach(u => urls.add(u));
    });

    $('[style]').each((_, el) => {
      const style = $(el).attr('style') || '';
      this.extractFromCss(style).forEach(u => urls.add(u));
    });

    return [...urls];
  }

  parseSrcset(srcset) {
    if (!srcset) return [];
    const result = [];
    const parts = srcset.split(',');
    for (const part of parts) {
      const trimmed = part.trim().split(/\s+/)[0];
      const normalized = this.normalize(trimmed);
      if (normalized) result.push(normalized);
    }
    return result;
  }

  extractFromCss(css, cssBaseUrl) {
    const urls = new Set();
    const base = cssBaseUrl || this.baseUrl;

    try {
      const root = postcss.parse(css, { from: undefined });
      root.walkDecls(decl => {
        if (decl.value.includes('url(')) {
          this.extractUrlsFromValue(decl.value, base).forEach(u => urls.add(u));
        }
      });
      root.walkAtRules('import', rule => {
        const params = rule.params.replace(/['"]/g, '').trim();
        const normalized = this.dedupe.normalizeUrl(params, base);
        if (normalized) urls.add(normalized);
      });
      root.walkAtRules('font-face', rule => {
        rule.walkDecls(decl => {
          if (decl.prop === 'src' && decl.value.includes('url(')) {
            this.extractUrlsFromValue(decl.value, base).forEach(u => urls.add(u));
          }
        });
      });
    } catch {
      const regex = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
      let match;
      while ((match = regex.exec(css)) !== null) {
        const normalized = this.dedupe.normalizeUrl(match[1], base);
        if (normalized) urls.add(normalized);
      }
      const importRegex = /@import\s+(?:url\()?['"]?([^'")\s;]+)['"]?\)?/gi;
      while ((match = importRegex.exec(css)) !== null) {
        const normalized = this.dedupe.normalizeUrl(match[1], base);
        if (normalized) urls.add(normalized);
      }
    }

    return [...urls];
  }

  extractUrlsFromValue(value, base) {
    const urls = [];
    const parsed = valueParser(value);
    parsed.walk(node => {
      if (node.type === 'function' && node.value === 'url' && node.nodes.length) {
        let urlValue = valueParser.stringify(node.nodes);
        urlValue = urlValue.replace(/^['"]|['"]$/g, '');
        const normalized = this.dedupe.normalizeUrl(urlValue, base);
        if (normalized) urls.push(normalized);
      }
    });
    return urls;
  }

  extractFromJs(js, jsBaseUrl) {
    const urls = new Set();
    const fileBase = jsBaseUrl || this.baseUrl;
    let pageBase = this.baseUrl;
    try {
      pageBase = new URL(fileBase).origin + '/';
    } catch {}

    const addVal = (val) => {
      if (!val) return;
      const isRelative = val.startsWith('./') || val.startsWith('../');
      const isRootish = val.startsWith('/') || val.startsWith('assets/') || val.startsWith('static/') || val.startsWith('lobby_asset/') || val.startsWith('libs/') || val.startsWith('cocos/') || val.startsWith('siteadmin/') || val.startsWith('vendors/');
      const isBareHashed = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{4,}\.(?:js|mjs|cjs|css)$/i.test(val);
      if (!isRelative && !isRootish && !isBareHashed && !/^https?:/i.test(val)) return;
      const base = (isRelative || isBareHashed) ? fileBase : pageBase;
      const resolved = isBareHashed ? './' + val : (isRootish && !val.startsWith('/') && !/^https?:/i.test(val) ? '/' + val : val);
      const normalized = this.dedupe.normalizeUrl(resolved, base);
      if (normalized && isLikelyAssetFile(normalized)) urls.add(normalized);
    };

    const patterns = [
      /import\s*(?:[^'"]*['"]([^'"]+)['"]|(?:\(\s*['"]([^'"]+)['"]\s*\)))/g,
      /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /new\s+URL\s*\(\s*['"]([^'"]+)['"]/g,
      /src\s*:\s*['"]([^'"]+)['"]/g,
      /['"](\.\/[^'"]+\.(?:js|mjs|cjs|css|wasm|json|map))['"]/g,
      /['"](\.\.\/[^'"]+\.(?:js|mjs|cjs|css|wasm|json|map))['"]/g,
      // Vite __vite__fileDeps: "assets/theme-0/NightModeIndex.xxx.css" (no leading slash)
      /['"]((?:assets|static|lobby_asset|libs|cocos|siteadmin|vendors)\/[^'"]+\.(?:js|mjs|cjs|css|wasm|json|map|png|jpe?g|gif|webp|avif|svg|woff2?|ttf|otf|mp3|webp|gif))['"]/g,
      /['"](\/(?:assets|static|lobby_asset|libs|cocos|siteadmin|vendors)\/[^'"]+)['"]/g,
      // bare hashed chunk filenames in same directory: "NightModeIndex.BYmnWdTY.css"
      /['"]([A-Za-z0-9_-]+\.[A-Za-z0-9_-]{4,}\.(?:js|mjs|cjs|css))['"]/g,
      /['"]([^'"]*\/(?:[Ii]ndex|[Dd]ialog|[Cc]hunk|[Vv]endor|[Cc]ommon)[^'"]*\.[A-Za-z0-9_-]{4,}\.(?:js|css))['"]/g
    ];

    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(js)) !== null) {
        addVal(match[1] || match[2]);
      }
    }

    return [...urls];
  }
}

module.exports = ResourceParser;
