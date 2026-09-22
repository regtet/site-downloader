const fs = require('fs');
const s = fs.readFileSync('dist/719win.com/assets/theme-0/commonChunk.CrHxNUxG.js', 'utf8');
const needle = '="/api/active/get"';
const i = s.indexOf(needle);
console.log('idx', i);
console.log(s.slice(i - 200, i + 2200));
