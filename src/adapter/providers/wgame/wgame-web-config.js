/**
 * 从 wgame_web 项目实时读取 src/config/config.js（不缓存，随分支/文件夹切换）。
 * 路径：WGAME_WEB_PATH → ../wgame_web → ./wgame_web
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..', '..');
const CONFIG_REL = path.join('src', 'config', 'config.js');

function parseBoolish(val) {
  if (val === true || val === 1) return true;
  if (typeof val === 'string') {
    const s = val.trim().toLowerCase();
    return s === '1' || s === 'true' || s === 'yes' || s === 'on';
  }
  return false;
}

function stripJsComments(text) {
  return String(text || '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith('//')) return '';
      return line.replace(/\s\/\/.*$/, '');
    })
    .join('\n');
}

function extractScalar(text, key) {
  const body = stripJsComments(text);
  const re = new RegExp('\\b' + key + '\\s*:\\s*([^,\\n]+)', 'gm');
  let m;
  let last;
  while ((m = re.exec(body))) last = m;
  if (!last) return undefined;
  let v = last[1].trim();
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^\d+$/.test(v)) return Number(v);
  const q = v.match(/^(['"])(.*)\1$/);
  if (q) return q[2];
  return v;
}

function extractStringArray(text, key) {
  const body = stripJsComments(text);
  const re = new RegExp('\\b' + key + '\\s*:\\s*\\[([^\\]]*)\\]', 'ms');
  const m = body.match(re);
  if (!m) return [];
  const items = [];
  const strRe = /'([^']*)'|"([^"]*)"/g;
  let sm;
  while ((sm = strRe.exec(m[1]))) {
    items.push(sm[1] != null ? sm[1] : sm[2]);
  }
  return items;
}

function readGitBranch(webRoot) {
  try {
    const head = fs.readFileSync(path.join(webRoot, '.git', 'HEAD'), 'utf8').trim();
    if (head.startsWith('ref:')) return head.split('/').pop();
    return head.slice(0, 8);
  } catch (_) {
    return '';
  }
}

function deriveLobbyGameUrlFromProxyList(list) {
  if (!Array.isArray(list) || !list.length) return '';
  const pick = list.find((u) => /www\./i.test(String(u))) || list[0];
  try {
    return new URL(String(pick)).origin.replace(/\/?$/, '/') + 'gogameccc/';
  } catch (_) {
    return '';
  }
}

function resolveWgameWebRoot() {
  const candidates = [];
  if (process.env.WGAME_WEB_PATH) candidates.push(process.env.WGAME_WEB_PATH);
  candidates.push(path.join(ROOT, '..', 'wgame_web'));
  candidates.push(path.join(ROOT, 'wgame_web'));
  for (const c of candidates) {
    const resolved = path.resolve(c);
    const cfgPath = path.join(resolved, CONFIG_REL);
    if (fs.existsSync(cfgPath)) return resolved;
  }
  return null;
}

function parseWgameWebConfigText(text) {
  const debug = parseBoolish(extractScalar(text, 'debug'));
  const baseWssUrl = String(extractScalar(text, 'baseWssUrl') || '');
  const mockWssUrl = String(extractScalar(text, 'mockWssUrl') || '');
  const packageId = extractScalar(text, 'packageId');
  const baseUrl = String(extractScalar(text, 'baseUrl') || '');
  const proxyShareUrlList = extractStringArray(text, 'proxyShareUrlList');
  const wssUrl = debug && mockWssUrl ? mockWssUrl : (baseWssUrl || mockWssUrl || '');
  const lobbyGameUrl = deriveLobbyGameUrlFromProxyList(proxyShareUrlList);
  return {
    debug,
    baseWssUrl,
    mockWssUrl,
    wssUrl,
    packageId: packageId != null ? Number(packageId) : undefined,
    baseUrl,
    proxyShareUrlList,
    lobbyGameUrl
  };
}

/**
 * 每次调用都重新读盘，保证切换 wgame_web 目录/分支后立即生效。
 * @returns {null | object}
 */
function loadWgameWebConfig() {
  const webRoot = resolveWgameWebRoot();
  if (!webRoot) return null;
  const configPath = path.join(webRoot, CONFIG_REL);
  try {
    const text = fs.readFileSync(configPath, 'utf8');
    const stat = fs.statSync(configPath);
    const parsed = parseWgameWebConfigText(text);
    return Object.assign({}, parsed, {
      webRoot,
      configPath,
      branch: readGitBranch(webRoot),
      mtime: stat.mtime.toISOString(),
      serverMode: parsed.debug ? 'test' : 'production'
    });
  } catch (_) {
    return null;
  }
}

module.exports = {
  ROOT,
  CONFIG_REL,
  parseBoolish,
  stripJsComments,
  parseWgameWebConfigText,
  deriveLobbyGameUrlFromProxyList,
  resolveWgameWebRoot,
  loadWgameWebConfig
};
