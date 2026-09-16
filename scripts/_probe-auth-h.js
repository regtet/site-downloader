const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

// Find h=async near getEventsAuthInfos assignment area - look backwards from getEventsAuthInfos:h
const anchor = t.indexOf('getEventsAuthInfos:h,getDiscountRedDot:m');
const region = t.slice(anchor - 8000, anchor);
console.log('region length', region.length);

// Find request urls in this region
const urls = [...region.matchAll(/url:"(\/api\/[^"]+)"/g)].map((m) => m[1]);
console.log('URLs in getEventsAuthInfos region:', [...new Set(urls)]);

// Also find h=async or const h=
let i = region.lastIndexOf('h=async');
console.log('\nh=async idx', i);
if (i >= 0) console.log(region.slice(i, i + 800).replace(/\s+/g, ' '));

i = region.lastIndexOf(',h=');
console.log('\n,h= idx from end search');
// find all ,h= in last 3000 chars
const tail = region.slice(-3500);
let pos = 0;
let c = 0;
while ((pos = tail.indexOf(',h=', pos + 1)) !== -1 && c < 8) {
  console.log(c, tail.slice(pos, pos + 400).replace(/\s+/g, ' ').slice(0, 380));
  c++;
}
