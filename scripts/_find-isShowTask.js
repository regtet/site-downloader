const fs = require('fs');
const path = require('path');

function walk(d, a = []) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, a);
    else if (n.endsWith('.js') && st.size < 15e6) a.push(p);
  }
  return a;
}

const needles = [
  '/api/active/task',
  'taskSetting',
  'isShowTask',
  'eventsAuth',
  'eventAuth',
  'auth/events',
];

for (const f of walk('output/713win/assets/theme-0')) {
  const t = fs.readFileSync(f, 'utf8');
  if (!t.includes('isShowTask') && !t.includes('/api/active/task')) continue;
  const hits = needles.filter((n) => t.includes(n));
  if (!hits.length) continue;
  console.log(path.basename(f), hits.join(','));
}

// Extract isShowTask assignment source
for (const f of walk('output/713win/assets/theme-0')) {
  const t = fs.readFileSync(f, 'utf8');
  let i = -1;
  let c = 0;
  while ((i = t.indexOf('isShowTask', i + 1)) !== -1 && c < 5) {
    const snip = t.slice(Math.max(0, i - 120), i + 160).replace(/\s+/g, ' ');
    if (/isShowTask\s*[:=]/.test(snip) || /isShowTask,/.test(snip)) {
      console.log('\nisShowTask', path.basename(f));
      console.log(snip.slice(0, 320));
      c++;
    }
  }
}
