const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

// Dump around showTask:lF(le) and how L=isShowTask is derived
let i = t.indexOf('showTask:lF(le)');
console.log('==== showTask ====');
console.log(t.slice(i - 800, i + 600).replace(/\s+/g, ' '));

// Find lF definition
i = t.indexOf('lF=');
let c = 0;
while ((i = t.indexOf('lF=', i + 1)) !== -1 && c < 10) {
  const snip = t.slice(i, i + 200);
  if (/function|=>|Array|length|task/.test(snip)) {
    console.log('\nlF=', snip.replace(/\s+/g, ' ').slice(0, 280));
    c++;
  }
}

// Find const L= related to isShowTask near eventsAuthData store
i = t.indexOf('isShowTask:L');
console.log('\n==== before isShowTask:L ====');
console.log(t.slice(i - 1200, i + 50).replace(/\s+/g, ' ').slice(0, 1400));
