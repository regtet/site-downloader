const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

// mm enum is assigned to variable - find usages of .taskSeries as popup type
let i = -1;
let c = 0;
while ((i = t.indexOf('.taskSeries', i + 1)) !== -1 && c < 25) {
  const snip = t.slice(Math.max(0, i - 100), i + 150).replace(/\s+/g, ' ');
  console.log(c, snip.slice(0, 280));
  console.log('---');
  c++;
}

console.log('\n==== constantTask ====');
i = -1;
c = 0;
const entry = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');
while ((i = entry.indexOf('constantTask', i + 1)) !== -1 && c < 10) {
  console.log(entry.slice(Math.max(0, i - 80), i + 250).replace(/\s+/g, ' ').slice(0, 350));
  console.log('---');
  c++;
}
