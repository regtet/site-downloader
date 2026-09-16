const fs = require('fs');
const idx = fs.readFileSync('output/679win/assets/theme-0/index.dmZT2U45.js', 'utf8');

// Get import line start
const head = idx.slice(0, 2500);
console.log(head.slice(0, 1500));

// Find where P is bound - look for ",P," or " P=" in imports: `xx as P`
const m = head.match(/(\w+) as P[,}]/);
console.log('\nP import', m && m[0]);

// Also search judgePopOpen helpers exported from common
const common = fs.readFileSync('output/679win/assets/theme-0/commonChunk.C4ZsWNMG.js', 'utf8');

// Search for onceDay usage with getUserChecked
let i = -1;
let c = 0;
while ((i = common.indexOf('onceDay', i + 1)) !== -1 && c < 12) {
  console.log('\nonceDay', common.slice(Math.max(0, i - 150), i + 250).replace(/\s+/g, ' ').slice(0, 420));
  c++;
}
