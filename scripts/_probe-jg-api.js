const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');

// Find jg definition - API for task categories/settings
let i = t.indexOf('jg=');
let c = 0;
while ((i = t.indexOf('jg=', i + 1)) !== -1 && c < 8) {
  const s = t.slice(i, i + 250);
  if (/request|async|api/.test(s)) console.log('jg=', s.replace(/\s+/g, ' ').slice(0, 280));
  c++;
}

// Also search jg=async
i = t.indexOf('jg=async');
console.log('\njg=async', t.slice(i, i + 400).replace(/\s+/g, ' '));

// getNewTaskCategories Y= implementation
i = t.indexOf('getNewTaskCategories:Y');
// find Y= nearby in store setup - search for const Y= or Y=async
i = t.indexOf('Y=async');
c = 0;
while ((i = t.indexOf('Y=async', i + 1)) !== -1 && c < 5) {
  const s = t.slice(i, i + 300);
  if (/task|categor|jg|BT/.test(s)) console.log('\nY=', s.replace(/\s+/g, ' ').slice(0, 320));
  c++;
}

// Find E= getActiveTabTasks - uses BT /api/active/tasks/task
i = t.indexOf('getActiveTabTasks:E');
console.log('\nnear getActiveTabTasks return area - search E=');
// Search for function that calls BT(
i = -1;
c = 0;
while ((i = t.indexOf('BT(', i + 1)) !== -1 && c < 5) {
  console.log('BT(', t.slice(i - 100, i + 200).replace(/\s+/g, ' ').slice(0, 320));
  c++;
}
