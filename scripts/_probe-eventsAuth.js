const fs = require('fs');

// Search commonChunk for taskSetting fetch URL
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

for (const k of [
  'taskSetting',
  'newComerPopStyle',
  'eventsAuthData',
  '/api/active/task',
  'isShowTask',
  'getEventsAuth',
  'eventsAuth',
]) {
  let i = -1;
  let c = 0;
  while ((i = t.indexOf(k, i + 1)) !== -1 && c < 4) {
    console.log('\n##', k, i);
    console.log(t.slice(Math.max(0, i - 150), i + 250).replace(/\s+/g, ' ').slice(0, 420));
    c++;
  }
}
