const fs = require('fs');

// Search all 713win theme for opening taskSeries via various patterns
const path = require('path');
function walk(d, a = []) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p, a);
    else if (n.endsWith('.js')) a.push(p);
  }
  return a;
}

for (const f of walk('output/713win/assets/theme-0')) {
  const t = fs.readFileSync(f, 'utf8');
  if (!t.includes('taskSeries')) continue;
  let i = -1;
  let shown = 0;
  while ((i = t.indexOf('taskSeries', i + 1)) !== -1 && shown < 6) {
    const snip = t.slice(Math.max(0, i - 150), i + 180).replace(/\s+/g, ' ');
    // skip pure enum definitions
    if (/e\.taskSeries="taskSeries"/.test(snip) && snip.length < 200) {
      shown++;
      continue;
    }
    if (/open|dialog|Dialog|queue|Queue|push|emit|visible|Q\(|gn\(|Ze\(/.test(snip)) {
      console.log('\nFILE', path.basename(f));
      console.log(snip.slice(0, 400));
      shown++;
    }
  }
}

console.log('\n\n==== store fill constantTask ====');
const entry = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');
const idx = entry.indexOf('constantTaskDataMapper');
console.log(entry.slice(idx - 500, idx + 1500).replace(/\s+/g, ' ').slice(0, 2000));
