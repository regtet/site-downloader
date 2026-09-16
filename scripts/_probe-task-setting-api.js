const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');

// Find jg / task setting API URL near newComerPopStyle load
let i = t.indexOf('newComerPopStyle');
console.log('==== load categories ====');
console.log(t.slice(i - 500, i + 200).replace(/\s+/g, ' '));

// Search for request url near taskSetting
i = t.indexOf('taskSetting');
let c = 0;
while ((i = t.indexOf('taskSetting', i + 1)) !== -1 && c < 5) {
  console.log('\ntaskSetting', t.slice(i - 200, i + 150).replace(/\s+/g, ' ').slice(0, 360));
  c++;
}

// Find jg= or similar async that returns taskSetting
for (const k of ['/api/active/tasks/', 'task/category', 'taskCategory', 'task/list', 'getTaskSetting', 'taskSetting']) {
  const idx = t.indexOf(k);
  if (idx >= 0) console.log('\nfound', k, t.slice(idx - 80, idx + 120).replace(/\s+/g, ' '));
}

// BT data shape - /api/active/tasks/task
i = t.indexOf('Al="/api/active/tasks/task"');
console.log('\n==== task API usage ====');
console.log(t.slice(i, i + 800).replace(/\s+/g, ' '));
