const fs = require('fs');
const t = fs.readFileSync('output/679win/assets/theme-0/commonChunk.C4ZsWNMG.js', 'utf8');

// Find P= that uses getUserChecked and afterLoginPopType
let i = -1;
let c = 0;
while ((i = t.indexOf('afterLoginPopType', i + 1)) !== -1 && c < 10) {
  console.log(c, t.slice(Math.max(0, i - 150), i + 200).replace(/\s+/g, ' ').slice(0, 380));
  console.log('---');
  c++;
}

// Search pop type constants
for (const k of ['e[e.EveryTime', 'e[e.LoginEvery', 'LoginPop', 'PopEvery', 'NeverShow', 'OnceADay', 'everyLogin']) {
  i = t.indexOf(k);
  if (i >= 0) console.log('\nHIT', k, t.slice(i - 40, i + 200).replace(/\s+/g, ' '));
}

// Find function judging pop by type number - often switch(type)
i = t.indexOf('getUserChecked');
console.log('\n==== around first getUserChecked def ====');
// find definition
i = t.indexOf('getUserChecked:');
if (i < 0) i = t.indexOf('getUserChecked=');
console.log(t.slice(Math.max(0, i - 200), i + 500).replace(/\s+/g, ' ').slice(0, 700));
