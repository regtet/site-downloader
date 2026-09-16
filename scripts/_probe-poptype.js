const fs = require('fs');

for (const f of [
  'output/679win/assets/theme-0/index.dmZT2U45.js',
  'output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js',
  'output/713win/assets/theme-0/commonChunk.CkZ4BOve.js',
]) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  let i = t.indexOf('judgeCategoryPopOpenByConfig');
  console.log(f, 'idx', i);
  if (i >= 0) console.log(t.slice(i, i + 1000).replace(/\s+/g, ' '), '\n---');
}

// Find afterLoginPopType usage
const idx = fs.readFileSync('output/679win/assets/theme-0/index.dmZT2U45.js', 'utf8');
let i = -1;
let c = 0;
while ((i = idx.indexOf('afterLoginPopType', i + 1)) !== -1 && c < 8) {
  console.log('\nafterLoginPopType', idx.slice(Math.max(0, i - 100), i + 200).replace(/\s+/g, ' ').slice(0, 320));
  c++;
}

// Find P= pop judge function near taskDaily in index
i = idx.indexOf('P(d.taskDaily');
if (i < 0) {
  // in Entry
  const e = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');
  i = e.indexOf('taskDaily');
  console.log('\nEntry taskDaily area', e.slice(i - 200, i + 400).replace(/\s+/g, ' ').slice(0, 600));
}
