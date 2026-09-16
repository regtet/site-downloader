const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

// Find getEventsAuthInfos implementation and its request URL
let i = t.indexOf('getEventsAuthInfos:h');
console.log('near return', t.slice(i - 200, i + 100).replace(/\s+/g, ' '));

// Search for function h= that fetches auth
i = t.indexOf('getEventsAuthInfos');
let c = 0;
while ((i = t.indexOf('getEventsAuthInfos', i + 1)) !== -1 && c < 6) {
  console.log('\n@', i, t.slice(i - 60, i + 200).replace(/\s+/g, ' ').slice(0, 280));
  c++;
}

// Search URL patterns related to events auth / discount auth
for (const k of [
  '/api/active/getEventsAuth',
  '/api/active/eventsAuth',
  '/api/active/discount',
  'eventsAuth',
  'getactivetrans',
  'activeAuth',
  'discountAuth',
  '/api/active/index',
  'showTask',
  'lF(',
]) {
  i = t.indexOf(k);
  if (i < 0) {
    console.log('\nMISS', k);
    continue;
  }
  console.log('\nHIT', k);
  console.log(t.slice(Math.max(0, i - 120), i + 280).replace(/\s+/g, ' ').slice(0, 420));
}
