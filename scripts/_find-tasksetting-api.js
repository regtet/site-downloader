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

for (const f of walk('output/713win/assets/theme-0')) {
  const t = fs.readFileSync(f, 'utf8');
  if (!(t.includes('taskSetting') && t.includes('newComerPopStyle'))) continue;
  let i = -1;
  let c = 0;
  while ((i = t.indexOf('taskSetting', i + 1)) !== -1 && c < 8) {
    const snip = t.slice(Math.max(0, i - 500), i + 250);
    if (snip.includes('/api/') || snip.includes('url:')) {
      console.log('FILE', path.basename(f), '@', i);
      console.log(snip.replace(/\s+/g, ' ').slice(0, 700));
      console.log('---');
      c++;
    }
  }
}

console.log('\n==== Entry prelude ====');
const entry = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');
console.log(entry.slice(0, 2000));
