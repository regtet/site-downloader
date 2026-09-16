const fs = require('fs');
const path = require('path');

function walk(d, a = []) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, a);
    else if (n.endsWith('.js') && st.size < 12e6) a.push(p);
  }
  return a;
}

const needles = [
  'taskSeries',
  'constantTaskDataMapper',
  'constantTaskDisplayStatus',
  'newComerPopStyle',
  'open("taskSeries"',
  "open('taskSeries'",
  'openDialog("taskSeries"'
];

for (const root of ['output/713win/assets/theme-0', 'output/679win/assets/theme-0']) {
  if (!fs.existsSync(root)) continue;
  console.log('\n====', root);
  for (const f of walk(root)) {
    const t = fs.readFileSync(f, 'utf8');
    const hits = [];
    if (t.includes('open("taskSeries"') || t.includes("open('taskSeries'") || t.includes('openDialog("taskSeries"')) hits.push('OPEN');
    if (t.includes('constantTaskDataMapper')) hits.push('mapper');
    if (t.includes('constantTaskDisplayStatus')) hits.push('displayStatus');
    if (t.includes('newComerPopStyle')) hits.push('popStyle');
    if (!hits.length && !t.includes('"taskSeries"')) continue;
    if (!hits.length) continue;
    console.log(path.basename(f), hits.join(','));
  }
}
