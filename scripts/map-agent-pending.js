/**
 * 扫描 dist 中 /api/agent/* 并写入 safe-bulk（全部 featurePending）
 * 用法: node scripts/map-agent-pending.js [679win]
 */
const fs = require('fs');
const path = require('path');
const { OP } = require('../src/adapter/ops');
const { MIGRATION_MAP } = require('../src/adapter/series/aniw-lobby/migration-map');
const { SAFE_BULK_MAP } = require('../src/adapter/series/aniw-lobby/safe-bulk-map');

const siteId = process.argv[2] || '679win';
const root = path.join(__dirname, '..');

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.git') continue;
      walk(p, acc);
    } else if (/\.(js|mjs|cjs)$/i.test(name) && st.size < 12e6) {
      acc.push(p);
    }
  }
  return acc;
}

const re = /["'`](\/(?:hall\/)?api\/agent\/[A-Za-z0-9_./-]+)["'`]/g;
const found = new Set();
for (const base of [
  path.join(root, 'input', siteId),
  path.join(root, 'output', siteId),
  path.join(root, 'dist', '679win.com')
].filter((d) => fs.existsSync(d))) {
  for (const f of walk(base)) {
    const text = fs.readFileSync(f, 'utf8');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      let p = m[1].split('?')[0];
      if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
      if (!/\.json$/i.test(p)) found.add(p);
    }
  }
}

const merged = Object.assign({}, SAFE_BULK_MAP);
let added = 0;
for (const p of [...found].sort()) {
  if (MIGRATION_MAP[p] || merged[p]) continue;
  merged[p] = {
    op: OP.FEATURE_PENDING,
    adapter: 'featurePending',
    note: 'auto-agent-pending'
  };
  added += 1;
}

const outPath = path.join(root, 'src', 'adapter', 'series', 'aniw-lobby', 'safe-bulk-map.js');
const lines = [
  '/**',
  ' * 自动扩展的安全批量映射（expand-safe-bulk / map-agent-pending 生成）',
  ' * CORE_MAP 精确条目优先覆盖本表。',
  ' */',
  "const { OP } = require('../../ops');",
  '',
  'function entry(op, adapter, note) {',
  "  return { op, adapter, note: note || '' };",
  '}',
  '',
  "const EMPTY = entry(OP.EMPTY_RECORDS, 'emptyRecords', 'bulk-empty');",
  "const OK = entry(OP.LOBBY_OK, 'lobbyOk', 'bulk-ok');",
  "const FEAT = entry(OP.FEATURE_PENDING, 'featurePending', 'bulk-pending');",
  "const WD = entry(OP.WITHDRAW_PENDING, 'withdrawPending', 'bulk-withdraw');",
  "const PAY = entry(OP.PAY_PENDING, 'payPending', 'bulk-pay');",
  '',
  '/** @type {Record<string, { op: string, adapter: string, note?: string }>} */',
  'const SAFE_BULK_MAP = {'
];

for (const p of Object.keys(merged).sort()) {
  const e = merged[p];
  let tok = 'FEAT';
  if (e.adapter === 'emptyRecords') tok = 'EMPTY';
  else if (e.adapter === 'lobbyOk') tok = 'OK';
  else if (e.adapter === 'withdrawPending') tok = 'WD';
  else if (e.adapter === 'payPending') tok = 'PAY';
  lines.push(`  '${p}': ${tok},`);
}
lines.push('};', '', 'module.exports = { SAFE_BULK_MAP };', '');
fs.writeFileSync(outPath, lines.join('\n'));

const log = {
  at: new Date().toISOString(),
  agentFound: found.size,
  added,
  totalBulk: Object.keys(merged).length
};
fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'logs', `map-agent-pending-${siteId}.json`),
  JSON.stringify(log, null, 2)
);
console.log(JSON.stringify(log, null, 2));
