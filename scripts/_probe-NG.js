const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

// Find NG definition
let i = -1;
let c = 0;
while ((i = t.indexOf('NG=', i + 1)) !== -1 && c < 15) {
  const snip = t.slice(i, i + 350);
  if (/request|async|url|api/.test(snip)) {
    console.log('NG=', snip.replace(/\s+/g, ' ').slice(0, 400));
    console.log('---');
    c++;
  }
}

// Also NG=async
i = t.indexOf('NG=async');
console.log('\nNG=async', t.slice(i, i + 500).replace(/\s+/g, ' '));

// Search nearby NG( usage with getEventsAuth
i = t.indexOf('await Ne(NG())');
console.log('\ncall site', t.slice(i - 100, i + 80));

// Find lF=
c = 0;
i = -1;
while ((i = t.indexOf('lF=', i + 1)) !== -1 && c < 8) {
  const snip = t.slice(i, i + 250);
  console.log('\nlF candidate', snip.replace(/\s+/g, ' ').slice(0, 280));
  c++;
}
