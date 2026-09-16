const fs = require('fs');
const path = require('path');
const entry = fs.readFileSync('output/679win/assets/theme-0/0_EntryLoginRegisterChunk.Dc-nf5V0.js', 'utf8');

// Find BT and surrounding E function by searching unique string
let i = entry.indexOf('"/api/active/tasks/task"');
console.log('task api', entry.slice(i - 50, i + 400).replace(/\s+/g, ' '));

// Search for template: in request to BT
i = -1;
let c = 0;
while ((i = entry.indexOf('BT(', i + 1)) !== -1 && c < 8) {
  console.log('\n', c, entry.slice(Math.max(0, i - 300), i + 250).replace(/\s+/g, ' ').slice(0, 560));
  c++;
}

// Find where response rules assigned
i = -1;
c = 0;
while ((i = entry.indexOf('.rules', i + 1)) !== -1 && c < 12) {
  const snip = entry.slice(Math.max(0, i - 100), i + 120).replace(/\s+/g, ' ');
  if (/O\.|mapper|template|constant|w\.value|p\.value/.test(snip)) {
    console.log('\nrules', snip.slice(0, 280));
    c++;
  }
}
