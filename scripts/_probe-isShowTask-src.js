const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

// Find where isShowTask is computed/assigned
let i = -1;
let c = 0;
while ((i = t.indexOf('isShowTask', i + 1)) !== -1 && c < 20) {
  const snip = t.slice(Math.max(0, i - 200), i + 200).replace(/\s+/g, ' ');
  if (/isShowTask\s*[:=]\s*|isShowTask\s*,|get isShowTask|computed.*isShowTask/.test(snip) || snip.includes('isShowTask:') || snip.includes('isShowTask=')) {
    console.log(c, snip.slice(0, 450));
    console.log('---');
    c++;
  }
}

console.log('\n==== search discountStore / activeData ====');
for (const k of ['isShowTask:', 'isShowTask=', 'activeData', 'discountStore', 'siteConfig', 'homeCustom']) {
  i = t.indexOf(k);
  if (i < 0) continue;
  // find first assignment-like
  let n = 0;
  let pos = 0;
  while ((pos = t.indexOf(k, pos)) !== -1 && n < 2) {
    console.log('\n', k, pos);
    console.log(t.slice(Math.max(0, pos - 100), pos + 220).replace(/\s+/g, ' ').slice(0, 340));
    n++;
    pos++;
  }
}
