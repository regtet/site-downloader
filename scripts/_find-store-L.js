const fs = require('fs');
const entry = fs.readFileSync('output/679win/assets/theme-0/0_EntryLoginRegisterChunk.Dc-nf5V0.js', 'utf8');

// Find L( function that writes to O (constantTaskDataMapper)
// From earlier: return ... L(M,U) after processing rules
let i = entry.indexOf('U.rules=Y.filter');
console.log(entry.slice(i - 100, i + 200));

// Search for O.value= Object.assign or similar
i = -1;
let c = 0;
while ((i = entry.indexOf('O.value', i + 1)) !== -1 && c < 15) {
  const snip = entry.slice(i - 50, i + 150).replace(/\s+/g, ' ');
  if (/template|rules|taskName|mapper/.test(snip)) {
    console.log(c, snip.slice(0, 280));
    c++;
  }
}

// Find assignment like O.value={...O.value,[M]:U}
i = entry.indexOf('[M]=');
c = 0;
while ((i = entry.indexOf('[M]', i + 1)) !== -1 && c < 10) {
  const snip = entry.slice(i - 80, i + 120).replace(/\s+/g, ' ');
  if (/O\.|value|rules|template/.test(snip)) {
    console.log('M', snip.slice(0, 280));
    c++;
  }
}
