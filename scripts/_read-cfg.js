const fs = require('fs');
const h = fs.readFileSync('output/713win/index.html', 'utf8');
const i = h.indexOf('siteCode');
console.log('idx', i);
console.log(h.slice(Math.max(0, i - 200), i + 600));
