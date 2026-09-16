const fs = require('fs');
const t = fs.readFileSync('output/679win/assets/theme-0/index.dmZT2U45.js', 'utf8');

// Search for pop type enum near task - often Never=0, EveryTime=1 etc
const patterns = [
  /e\[e\.\w+=0\]="[^"]+",e\[e\.\w+=1\]="[^"]+",e\[e\.\w+=2\]/,
];

// Find P= definition by looking for unique combo getUserChecked + afterLogin
let i = t.indexOf('afterLoginPopType');
// The P function is imported - search usage signature P(d.taskDaily
i = t.indexOf('P(d.taskDaily');
console.log('usage', t.slice(i - 50, i + 80));

// P is likely imported. Search in commonChunk for function that takes (key, isLogin, config, _, persistKey)
const common = fs.readFileSync('output/679win/assets/theme-0/commonChunk.C4ZsWNMG.js', 'utf8');

// Look for afterLoginPopType switch/cases
i = -1;
let c = 0;
while ((i = common.indexOf('afterLoginPopType', i + 1)) !== -1 && c < 15) {
  const snip = common.slice(Math.max(0, i - 200), i + 300).replace(/\s+/g, ' ');
  if (/===|switch|case|PopType|never|every/.test(snip)) {
    console.log('\n', c, snip.slice(0, 500));
  }
  c++;
}

// Enum with never=0 every=1 for login pop
const re = /e\[e\.(never|everyTime|everyDay|once|EveryTime|Never|Once)=(\d+)\]/gi;
let m;
while ((m = re.exec(common))) console.log('enum hit', m[0]);

// Broader
const re2 = /\(e=\>\(e\[e\.(\w+)=0\]="\1",e\[e\.(\w+)=1\]="\2"/g;
c = 0;
while ((m = re2.exec(common)) && c < 30) {
  if (/pop|login|never|every|once|show/i.test(m[0])) console.log('pair', m[0]);
  c++;
}
