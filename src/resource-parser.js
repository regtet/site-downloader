const cheerio = require('cheerio');
const postcss = require('postcss');
const valueParser = require('postcss-value-parser');
const DedupeManager = require('./dedupe');

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
    const base = jsBaseUrl || this.baseUrl;

    const patterns = [
      /import\s*(?:[^'"]*['"]([^'"]+)['"]|(?:\(\s*['"]([^'"]+)['"]\s*\)))/g,
      /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
      /new\s+URL\s*\(\s*['"]([^'"]+)['"]/g
    ];

    for (const regex of patterns) {
      let match;
      while ((match = regex.exec(js)) !== null) {
        const val = match[1] || match[2];
        if (!val || !STATIC_EXT_PATTERN.test(val)) continue;
        const normalized = this.dedupe.normalizeUrl(val, base);
        if (normalized) urls.add(normalized);
      }
    }

    return [...urls];
  }
}

module.exports = ResourceParser;
