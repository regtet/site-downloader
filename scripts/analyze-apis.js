/**
 * 只读：扫描 dist 业务接口 → 生成 api-analysis.json
 * 用法: node scripts/analyze-apis.js [dist/679win.com]
 */
const fs = require('fs');
const path = require('path');

const siteDir = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', '679win.com'));
const outPath = path.join(siteDir, 'api-analysis.json');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, acc);
    } else if (/\.(js|mjs|cjs|ts|vue|json)$/i.test(name)) {
      acc.push(p);
    }
  }
  return acc;
}

function normalizePath(raw) {
  let p = String(raw || '').split('?')[0].split('#')[0];
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch (_) { /* ignore */ }
  if (!p.startsWith('/')) p = '/' + p;
  if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
  // 去掉明显的动态文件后缀 json 静态配置仍保留完整 path
  return p.replace(/\/{2,}/g, '/');
}

function classify(pathname) {
  const p = pathname.toLowerCase();
  if (/\/api\/member\/(login|register|fastlogin|getfastlogin|thirdparty|check\/register|agent\/login)/.test(p)
    || /\/api\/.*\/(login|register)/.test(p)) return 'auth';
  if (/\/api\/member\/(user\/info|info|profile|detail)/.test(p)) return 'user';
  if (/\/api\/member\//.test(p)) return 'user';
  // 代理配置类归 agent，不要进 home
  if (/\/api\/agent\//.test(p)) return 'agent';
  if (/\/api\/(lobby|site|config|footer|about|publicity|optimization|getsite|getapp)/.test(p)
    || /\/api\/.*\/(config|getsiteinfo|footer|about)/.test(p)
    || /\/hall\/(version|ipcheck)/.test(p)
    || /maintain-time|ssocdn|domainmatch|ipacdn/.test(p)) return 'home';
  if (/\/api\/gamecenter\/(gold|gameapi\/refreshgold|gameapi\/getplatformbalance)|\/wallet/.test(p)) return 'wallet';
  if (/\/api\/game|\/gamecenter|\/game\/hall|bonuspool|hotlist|platformcate/.test(p)) return 'game';
  if (/\/api\/finance\/pay|charge|recharge|maxchargerate|paylist/.test(p)) return 'recharge';
  if (/\/api\/finance\/.*withdraw|withdraw|saque|certify\/withdraw/.test(p)) return 'withdraw';
  if (/\/api\/.*vip|\/vip\//.test(p)) return 'vip';
  if (/\/api\/agent|promote|referral|invite/.test(p)) return 'agent';
  if (/\/api\/active|activity|event|reward|task|reddot|receivedaward/.test(p)) return 'activity';
  if (/\/api\/message|notice|mail|popupcfg/.test(p)) return 'message';
  if (/\/api\/statistics|pointer|reportview|heartbeat|rum|cdn-cgi|domain\/pointer|promote\/binding/.test(p)) return 'analytics';
  if (/\/api\/|\/hall\/api\//.test(p)) return 'unknown';
  return 'unknown';
}

function guessNeedsLogin(pathname, callHints) {
  const p = pathname.toLowerCase();
  if (classify(p) === 'auth') return false;
  if (classify(p) === 'analytics' && /pointer|heartbeat|domainmatch|reportview/.test(p)) return false;
  if (classify(p) === 'home' && /\.json$/.test(p)) return false;
  if (callHints.some((h) => /loginonly|token|authorization|session/i.test(h))) return true;
  if (/\/finance\/|\/agent\/|\/message\/|withdraw|gold|user\/info|receivedaward|paylist/.test(p)) return true;
  return null; // unknown
}

function loadMigrationMap() {
  try {
    const mapPath = path.join(__dirname, '..', 'src', 'adapter', 'series', 'aniw-lobby', 'migration-map.js');
    delete require.cache[require.resolve(mapPath)];
    return require(mapPath).MIGRATION_MAP || {};
  } catch (_) {
    return {};
  }
}

function loadWgameOps() {
  try {
    const cat = require(path.join(__dirname, '..', 'src', 'adapter', 'providers', 'wgame', 'catalog.js'));
    return (cat.CATALOG || []).map((r) => ({
      op: r.op,
      transport: r.transport,
      steps: r.steps || []
    }));
  } catch (_) {
    return [];
  }
}

function extractFromJs(filePath, rel) {
  const text = fs.readFileSync(filePath, 'utf8');
  const hits = [];

  // url:"/api/..." 或 url:'/hall/api/...'
  const reUrl = /(?:url|path|api|endpoint)\s*[:=]\s*["'`](\/(?:hall\/)?api\/[^"'`?\s]+)/gi;
  let m;
  while ((m = reUrl.exec(text))) {
    hits.push({ path: normalizePath(m[1]), methodHint: null, hint: 'url-prop', index: m.index });
  }

  // "/api/xxx" 字符串字面量
  const reLit = /["'`](\/(?:hall\/)?api\/[a-zA-Z0-9_./{}-]+)["'`]/g;
  while ((m = reLit.exec(text))) {
    const p = normalizePath(m[1]);
    if (p.includes('{') && p.includes('}')) continue; // 模板太碎的跳过，后面另收
    hits.push({ path: p, methodHint: null, hint: 'string-literal', index: m.index });
  }

  // 模板 `/api/.../${`
  const reTpl = /[`'"](\/(?:hall\/)?api\/[^`'"]*?)\$\{/g;
  while ((m = reTpl.exec(text))) {
    let base = normalizePath(m[1].replace(/\/$/, ''));
    if (base.length > 8) hits.push({ path: base + '/*', methodHint: null, hint: 'template', index: m.index });
  }

  // method 邻近推断
  const enriched = [];
  for (const h of hits) {
    const window = text.slice(Math.max(0, h.index - 120), h.index + 180);
    let method = null;
    const mm = window.match(/method\s*:\s*["'](GET|POST|PUT|DELETE|PATCH)["']/i);
    if (mm) method = mm[1].toUpperCase();
    else if (/request\(\s*\{[^}]{0,80}url:[^}]{0,40}method:\s*["']POST/i.test(window)
      || /\.post\s*\(/i.test(window)) method = 'POST';
    else if (/\.get\s*\(/i.test(window)) method = 'GET';

    const tokenHints = [];
    if (/loginOnly|token\s*:\s*\{|Authorization|session_key|jwt/i.test(window)) {
      tokenHints.push(window.match(/loginOnly|token\s*:\s*\{[^}]{0,40}|session_key|jwt/i)[0]);
    }
    enriched.push({
      path: h.path,
      methodHint: method,
      callSite: rel,
      hint: h.hint,
      tokenHints
    });
  }
  return enriched;
}

function mergeNetwork(byPath) {
  const networkPath = path.join(siteDir, 'network.json');
  if (!fs.existsSync(networkPath)) return;
  let entries = [];
  try {
    const raw = JSON.parse(fs.readFileSync(networkPath, 'utf8'));
    entries = Array.isArray(raw) ? raw : (raw.entries || raw.network || []);
  } catch (_) {
    return;
  }
  for (const e of entries) {
    const url = String(e.url || '');
    if (!/\/(?:hall\/)?api\//i.test(url) && !/\/hall\/(?:version|ipCheck)/i.test(url)) continue;
    let pathname;
    try {
      pathname = normalizePath(new URL(url).pathname);
    } catch (_) {
      continue;
    }
    // 静态 json API
    if (!pathname.includes('/api/') && !/^\/hall\//.test(pathname)) continue;

    const key = pathname;
    if (!byPath[key]) {
      byPath[key] = {
        path: key,
        methods: new Set(),
        callSites: new Set(),
        hosts: new Set(),
        statuses: [],
        tokenHints: new Set(),
        sources: new Set()
      };
    }
    const row = byPath[key];
    if (e.method) row.methods.add(String(e.method).toUpperCase());
    try { row.hosts.add(new URL(url).hostname); } catch (_) { /* ignore */ }
    if (e.status != null) row.statuses.push(e.status);
    row.sources.add('network.json');
  }
}

function main() {
  const files = walk(siteDir).filter((f) => {
    const rel = f.slice(siteDir.length + 1).replace(/\\/g, '/');
    // 跳过体积巨大的非业务或纯资源
    if (/^lobby_asset\/|^game_pictures\/|^siteadmin\/|^cocos\//i.test(rel)) return false;
    if (/\.(png|jpe?g|gif|webp|avif|svg|woff2?|map)$/i.test(rel)) return false;
    return /\.(js|mjs|cjs)$/i.test(rel) || /network\.json$/i.test(rel);
  });

  const byPath = Object.create(null);

  for (const file of files) {
    if (file.endsWith('network.json')) continue;
    const rel = file.slice(siteDir.length + 1).replace(/\\/g, '/');
    let hits = [];
    try {
      hits = extractFromJs(file, rel);
    } catch (_) {
      continue;
    }
    for (const h of hits) {
      const key = h.path;
      if (!byPath[key]) {
        byPath[key] = {
          path: key,
          methods: new Set(),
          callSites: new Set(),
          hosts: new Set(),
          statuses: [],
          tokenHints: new Set(),
          sources: new Set()
        };
      }
      const row = byPath[key];
      if (h.methodHint) row.methods.add(h.methodHint);
      row.callSites.add(h.callSite);
      row.sources.add('dist-js');
      for (const t of h.tokenHints || []) row.tokenHints.add(t);
    }
  }

  mergeNetwork(byPath);

  const migration = loadMigrationMap();
  const wgameOps = loadWgameOps();
  const wgameOpSet = new Set(wgameOps.map((o) => o.op));

  const apis = Object.keys(byPath).sort().map((key) => {
    const row = byPath[key];
    const category = classify(key);
    const methods = [...row.methods];
    if (!methods.length) {
      // 业务默认 POST 居多
      if (/\.json$/i.test(key) || /\/hall\/version|ipcheck|domainmatch/i.test(key)) methods.push('GET');
      else methods.push('POST?');
    }
    const mapped = migration[key] || null;
    // 前缀映射粗判
    let mappedViaPrefix = null;
    if (!mapped) {
      for (const mk of Object.keys(migration)) {
        if (key.startsWith(mk.replace(/\/\*$/, ''))) {
          mappedViaPrefix = migration[mk];
          break;
        }
      }
    }
    const mapEntry = mapped || mappedViaPrefix;
    const ourOp = mapEntry ? mapEntry.op : null;
    const ourAdapter = mapEntry ? mapEntry.adapter : null;
    const ourHasImpl = !!(ourOp && (ourOp === 'lobby.local' || wgameOpSet.has(ourOp)));

    let status = 'pending';
    if (mapEntry && ourHasImpl) status = ourOp === 'lobby.local' ? 'local-shaped' : 'adapted';
    else if (mapEntry) status = 'mapped-no-provider';
    else status = 'pending';

    const needsLogin = guessNeedsLogin(key, [...row.tokenHints]);

    return {
      path: key,
      category,
      methods,
      needsLogin,
      callSites: [...row.callSites].slice(0, 12),
      hostsSeen: [...row.hosts],
      networkStatuses: row.statuses.slice(0, 10),
      sources: [...row.sources],
      tokenHints: [...row.tokenHints].slice(0, 5),
      // 对照我们侧
      our: {
        op: ourOp,
        adapter: ourAdapter,
        status,
        note: ourOp === 'lobby.local'
          ? '仅返回目标形状空/本地数据，未接 wgame 真实业务'
          : ourOp && wgameOpSet.has(ourOp)
            ? '已接 wgame provider'
            : '未映射或无 provider'
      },
      // 待填：真实响应结构需抓包或文档
      responseShape: null,
      requestParams: null,
      headers: null
    };
  });

  // 过滤明显非业务噪声
  const filtered = apis.filter((a) => {
    if (a.path.length < 6) return false;
    if (/\/api\/assets\//i.test(a.path)) return false;
    return true;
  });

  const byCategory = {};
  for (const a of filtered) {
    if (!byCategory[a.category]) byCategory[a.category] = [];
    byCategory[a.category].push(a.path);
  }

  const statusCount = {};
  for (const a of filtered) {
    const s = a.our.status;
    statusCount[s] = (statusCount[s] || 0) + 1;
  }

  const priorityOrder = [
    'auth', 'user', 'home', 'wallet', 'game', 'recharge', 'withdraw',
    'vip', 'agent', 'activity', 'message', 'analytics', 'unknown'
  ];

  const comparisonTable = filtered
    .slice()
    .sort((a, b) => {
      const ca = priorityOrder.indexOf(a.category);
      const cb = priorityOrder.indexOf(b.category);
      if (ca !== cb) return ca - cb;
      return a.path.localeCompare(b.path);
    })
    .map((a) => ({
      targetPath: a.path,
      category: a.category,
      methods: a.methods.join('|'),
      needsLogin: a.needsLogin,
      ourOp: a.our.op || '',
      ourAdapter: a.our.adapter || '',
      status: a.our.status,
      note: a.our.note
    }));

  const basicChain = {
    description: '建议适配顺序：注册→登录→Token→用户信息→首页配置→钱包→其它',
    steps: [
      { step: 1, category: 'auth', paths: (byCategory.auth || []).filter((p) => /register/i.test(p)) },
      { step: 2, category: 'auth', paths: (byCategory.auth || []).filter((p) => /login/i.test(p)) },
      { step: 3, category: 'user', paths: byCategory.user || [] },
      { step: 4, category: 'home', paths: byCategory.home || [] },
      { step: 5, category: 'wallet', paths: byCategory.wallet || [] },
      { step: 6, category: 'game', paths: byCategory.game || [] },
      { step: 7, category: 'recharge', paths: byCategory.recharge || [] },
      { step: 8, category: 'withdraw', paths: byCategory.withdraw || [] },
      { step: 9, category: 'vip', paths: byCategory.vip || [] },
      { step: 10, category: 'agent', paths: byCategory.agent || [], defer: true, note: '代理/下级后置' },
      { step: 11, category: 'activity', paths: byCategory.activity || [] },
      { step: 12, category: 'message', paths: byCategory.message || [] },
      { step: 13, category: 'analytics', paths: byCategory.analytics || [] }
    ]
  };

  const terminalUnmapped = [
    '/hall/api/finance/certify/withdrawRecord'
  ];

  const report = {
    generatedAt: new Date().toISOString(),
    siteDir,
    summary: {
      totalApis: filtered.length,
      byCategory: Object.fromEntries(
        priorityOrder.map((c) => [c, (byCategory[c] || []).length])
      ),
      byAdapterStatus: statusCount,
      wgameProviderOps: wgameOps,
      migrationMapSize: Object.keys(migration).length,
      scannedJsFiles: files.filter((f) => f.endsWith('.js')).length
    },
    basicChain,
    terminalObservedUnmapped: terminalUnmapped.map((p) => ({
      path: normalizePath(p),
      category: classify(normalizePath(p)),
      status: 'pending',
      note: '运行时 [bridge] unmapped，当前高频'
    })),
    comparisonTable,
    apis: filtered
  };

  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  console.log('Wrote', outPath);
  console.log('Total APIs:', filtered.length);
  console.log('By category:', report.summary.byCategory);
  console.log('By status:', statusCount);
}

main();
