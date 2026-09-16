const fs = require('fs');
const t = fs.readFileSync('output/679win/assets/theme-0/index.dmZT2U45.js', 'utf8');

// Dump taskSeries popup queue config
const i = t.indexOf('isShowTask');
console.log('==== isShowTask area ====');
console.log(t.slice(Math.max(0, i - 400), i + 1200).replace(/\s+/g, ' '));

console.log('\n==== taskSeries key in queue ====');
let idx = t.indexOf('key:"taskSeries"');
if (idx < 0) idx = t.indexOf("key:'taskSeries'");
if (idx < 0) idx = t.indexOf('taskSeries:{');
console.log(t.slice(Math.max(0, idx - 100), idx + 800).replace(/\s+/g, ' '));

console.log('\n==== judgePopOpenByData ====');
idx = t.indexOf('judgePopOpenByData');
console.log(t.slice(idx, idx + 800).replace(/\s+/g, ' '));
