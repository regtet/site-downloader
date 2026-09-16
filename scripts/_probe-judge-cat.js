const fs = require('fs');

for (const f of [
  'output/679win/assets/theme-0/index.dmZT2U45.js',
  'output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js',
  'output/713win/assets/theme-0/commonChunk.CkZ4BOve.js',
]) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  let i = t.indexOf('judgeCategoryPopOpenByConfig');
  if (i < 0) {
    console.log(f, 'NO judgeCategory');
    continue;
  }
  console.log('\n====', f);
  console.log(t.slice(i, i + 900).replace(/\s+/g, ' '));
}

// Find jg by looking at exports from common that return taskSetting
const common = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');
// Search for newComerPopStyle near url
let i = -1;
let c = 0;
while ((i = common.indexOf('newComerPopStyle', i + 1)) !== -1 && c < 8) {
  const snip = common.slice(Math.max(0, i - 400), i + 100);
  if (snip.includes('/api/') || snip.includes('url:')) {
    console.log('\nnewComerPopStyle+api', snip.replace(/\s+/g, ' ').slice(0, 520));
    c++;
  }
}
