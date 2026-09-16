const fs = require('fs');
const t = fs.readFileSync('output/679win/assets/theme-0/index.dmZT2U45.js', 'utf8');

// Find Ze= and Xe= near judgeCategory
let i = t.indexOf('judgeCategoryPopOpenByConfig');
console.log(t.slice(i - 1500, i + 200).replace(/\s+/g, ' '));

console.log('\n==== P function ====');
i = t.indexOf('function P(');
if (i < 0) i = t.indexOf(',P=');
// search P= that takes pop keys
let c = 0;
i = -1;
while ((i = t.indexOf('P=', i + 1)) !== -1 && c < 20) {
  const snip = t.slice(i, i + 300);
  if (/afterLoginPopType|getUserChecked|never|today/.test(snip)) {
    console.log(snip.replace(/\s+/g, ' ').slice(0, 400));
    console.log('---');
    c++;
  }
}
