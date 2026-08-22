/**
 * 静态扫描 site 包中的 /api 路径 vs migration-map
 * 用法: node scripts/scan-dist-api-gaps.js [679win]
 */
const fs = require('fs');
const path = require('path');
const { MIGRATION_MAP } = require('../src/adapter/series/aniw-lobby/migration-map');

const siteId = process.argv[2] || '679win';
const root = path.join(__dirname, '..');
const mapped = new Set(Object.keys(MIGRATION_MAP));

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

const roots = [
  path.join(root, 'input', siteId),
  path.join(root, 'output', siteId),
  path.join(root, 'dist', '679win.com')
].filter((d) => fs.existsSync(d));

const re = /["'`](\/(?:hall\/)?api\/[A-Za-z0-9_./-]+)["'`]/g;
const found = new Set();

for (const base of roots) {
  for (const f of walk(base)) {
    const text = fs.readFileSync(f, 'utf8');
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(text))) {
      let p = m[1].split('?')[0];
      if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
      if (p.startsWith('/api/')) found.add(p);
    }
  }
}

const gaps = [...found].filter((p) => !mapped.has(p)).sort();
const actionable = gaps.filter(
  (p) =>
    !/\.json$/i.test(p)
    && !/\/lobby\//i.test(p)
    && !/\/agent\//i.test(p)
);

const buckets = {
  member: [],
  finance: [],
  gameCenter: [],
  active: [],
  gohal: [],
  message: [],
  other: []
};

for (const p of actionable) {
  if (p.includes('/member/')) buckets.member.push(p);
  else if (p.includes('/finance/')) buckets.finance.push(p);
  else if (p.includes('/gameCenter/')) buckets.gameCenter.push(p);
  else if (p.includes('/active/')) buckets.active.push(p);
  else if (p.includes('/gohal/')) buckets.gohal.push(p);
  else if (p.includes('/message') || p.includes('/notice') || p.includes('/mail')) {
    buckets.message.push(p);
  } else buckets.other.push(p);
}

const out = {
  at: new Date().toISOString(),
  siteId,
  found: found.size,
  mapped: mapped.size,
  gaps: gaps.length,
  actionableCount: actionable.length,
  actionable,
  buckets
};

const logsDir = path.join(root, 'logs');
fs.mkdirSync(logsDir, { recursive: true });
const outPath = path.join(logsDir, `dist-api-gaps-${siteId}.json`);
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));

for (const [k, v] of Object.entries(buckets)) {
  console.log('\n##', k, v.length);
  v.slice(0, 15).forEach((x) => console.log(' ', x));
  if (v.length > 15) console.log(' ... +' + (v.length - 15));
}
console.log('\nwrote', outPath);
console.log('found', found.size, 'gaps', gaps.length, 'actionable', actionable.length);
