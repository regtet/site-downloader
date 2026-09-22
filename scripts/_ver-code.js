const fs = require('fs');
const text = fs.readFileSync('dist/713win.com/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');
const i = text.indexOf('VERSION_ERROR');
console.log(text.slice(Math.max(0, i - 500), i + 400).replace(/\s+/g, ' '));
const j = text.indexOf('VERSION_CHECK');
console.log('\n---\n', text.slice(Math.max(0, j - 200), j + 500).replace(/\s+/g, ' '));
