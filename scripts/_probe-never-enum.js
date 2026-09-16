const fs = require('fs');
const common = fs.readFileSync('output/679win/assets/theme-0/commonChunk.C4ZsWNMG.js', 'utf8');

let i = -1;
let c = 0;
while ((i = common.indexOf('e[e.never=0]', i + 1)) !== -1 && c < 8) {
  console.log('\n', c, common.slice(i - 20, i + 250).replace(/\s+/g, ' '));
  c++;
}

// Find judge function P - search for pattern checking afterLoginPopType value
// Often: const type = isLogin ? config.afterLoginPopType : config.beforeLoginPopType
i = -1;
c = 0;
while ((i = common.indexOf('afterLoginPopType', i + 1)) !== -1 && c < 20) {
  const snip = common.slice(Math.max(0, i - 250), i + 350);
  if (/beforeLoginPopType/.test(snip) && (/getUserChecked|never|EveryDay|constantly/.test(snip))) {
    console.log('\nJUDGE', snip.replace(/\s+/g, ' ').slice(0, 700));
    c++;
  } else {
    c++; // count anyway but only print matches
  }
}
