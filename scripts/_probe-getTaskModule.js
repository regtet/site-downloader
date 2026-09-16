const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');

// Find getTaskModuleConstants / constantTaskDataMapper load path
let i = t.indexOf('getTaskModuleConstants');
console.log('==== getTaskModuleConstants def area ====');
// search for function that assigns this
const idxs = [];
let pos = 0;
while ((pos = t.indexOf('getTaskModuleConstants', pos)) !== -1 && idxs.length < 8) {
  idxs.push(pos);
  pos++;
}
for (const x of idxs) {
  console.log('\n@', x, t.slice(x - 80, x + 400).replace(/\s+/g, ' ').slice(0, 480));
}

// Find Al= task API and how response is used
i = t.indexOf('"/api/active/tasks/task"');
console.log('\n==== /api/active/tasks/task ====');
console.log(t.slice(i - 100, i + 500).replace(/\s+/g, ' '));

// Find taskDaily enum and category request
for (const k of ['taskDaily', 'shouldRequestCategory', 'constantTaskDataMapper', 'requestTaskCategory', 'fetchTask']) {
  i = t.indexOf(k);
  console.log('\n', k, 'first:', t.slice(Math.max(0,i-60), i+200).replace(/\s+/g, ' ').slice(0, 280));
}
