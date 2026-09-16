const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');

for (const k of [
  'getTaskModuleConstants',
  'getNewTaskCategories',
  'freshNewTaskCategories',
  'constantTaskDataMapper',
  'constantTaskDisplayStatus',
  'newComerPopStyle',
  '/api/active/tasks',
  'taskCategories',
  'Kg='
]) {
  let i = -1;
  let c = 0;
  console.log('\n####', k);
  while ((i = t.indexOf(k, i + 1)) !== -1 && c < 3) {
    console.log(t.slice(Math.max(0, i - 60), i + 350).replace(/\s+/g, ' ').slice(0, 420));
    console.log('---');
    c++;
  }
}
