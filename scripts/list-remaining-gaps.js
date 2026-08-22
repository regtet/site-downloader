/** 列出仍未进 migration-map 的 /api 路径 */
const fs = require('fs');
const path = require('path');
const { MIGRATION_MAP } = require('../src/adapter/series/aniw-lobby/migration-map');

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

const root = path.join(__dirname, '..');
const re = /["'`](\/(?:hall\/)?api\/[A-Za-z0-9_./-]+)["'`]/g;
const found = new Set();
for (const base of [
  path.join(root, 'input', '679win'),
  path.join(root, 'output', '679win'),
  path.join(root, 'dist', '679win.com')
].filter((d) => fs.existsSync(d))) {
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

const gaps = [...found].filter((p) => !MIGRATION_MAP[p]).sort();
const ossJson = gaps.filter((p) => /\.json$/i.test(p) || /\/lobby\//i.test(p));
const other = gaps.filter((p) => !ossJson.includes(p));

const out = {
  at: new Date().toISOString(),
  found: found.size,
  mapped: Object.keys(MIGRATION_MAP).length,
  gaps: gaps.length,
  ossOrLobby: ossJson,
  other
};
fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
fs.writeFileSync(
  path.join(root, 'logs', 'remaining-gaps-679win.json'),
  JSON.stringify(out, null, 2)
);
console.log(JSON.stringify({
  found: out.found,
  mapped: out.mapped,
  gaps: out.gaps,
  ossOrLobby: ossJson.length,
  other: other.length,
  otherSample: other.slice(0, 40)
}, null, 2));
