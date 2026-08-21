const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', '679win.com'));

function walk(d, a = []) {
  if (!fs.existsSync(d)) return a;
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (n === 'node_modules' || n === '.git') continue;
      walk(p, a);
    } else if (/\.(js|mjs)$/i.test(n) && st.size < 8e6) a.push(p);
  }
  return a;
}

function norm(p) {
  let x = String(p || '').split('?')[0];
  if (x.startsWith('/hall/api/')) x = x.slice('/hall'.length);
  return x;
}

const hits = new Map();
const fields = {};
const fieldNames = [
  'nickname', 'headimg', 'portrait_id', 'portrait', 'avatar', 'vip_level',
  'game_gold', 'username', 'session_key', 'jwt_token', 'paylist', 'payList',
  'maxCharge', 'withdrawRecord', 'user/info', 'getFastLogin'
];
for (const k of fieldNames) fields[k] = 0;

for (const f of walk(root)) {
  let t;
  try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
  for (const k of fieldNames) {
    const re = new RegExp(k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
    const m = t.match(re);
    if (m) fields[k] += m.length;
  }
  const re = /["'`](\/(?:hall\/)?api\/[a-zA-Z0-9_./{}-]+)["'`]/g;
  let m;
  while ((m = re.exec(t))) {
    const p = norm(m[1]);
    hits.set(p, (hits.get(p) || 0) + 1);
  }
}

const interesting = [...hits.entries()]
  .filter(([p]) => /\/api\/(member|finance|vip|active|lobby|gameCenter|game\/|message|agent)/i.test(p))
  .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

const out = {
  siteDir: root,
  fieldMentions: fields,
  apiHits: interesting.map(([path, count]) => ({ path, count }))
};
const outPath = path.join(root, 'post-login-js-scan.json');
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log('Wrote', outPath);
console.log('fields', fields);
console.log('apis', interesting.length);
console.log(interesting.slice(0, 60).map(([p, c]) => `${c}\t${p}`).join('\n'));
