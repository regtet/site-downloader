const fs = require('fs');

// Find how getActiveTabTasks / E maps BT response into constantTaskDataMapper
const t = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');

let i = t.indexOf('constantTaskDataMapper');
console.log('==== mapper store ====');
console.log(t.slice(i - 100, i + 400).replace(/\s+/g, ' '));

// Find E= that calls BT
i = -1;
let c = 0;
while ((i = t.indexOf('await BT(', i + 1)) !== -1 && c < 5) {
  console.log('\nBT call', t.slice(Math.max(0, i - 200), i + 350).replace(/\s+/g, ' ').slice(0, 560));
  c++;
}

// Find rules usage in task series dialog chunk
const dlg = fs.readFileSync('output/713win/assets/theme-0/2_EventOthersChunk.rFD1HERx.js', 'utf8');
for (const k of ['rules', 'taskDaily', 'constantTaskDataMapper', 'pages-dialogs-task', 'single-tab', 'persistBox']) {
  console.log(k, (dlg.split(k).length - 1));
}

i = dlg.indexOf('pages-dialogs-task');
console.log('\n==== dialog start ====');
console.log(dlg.slice(i, i + 1500).replace(/\s+/g, ' ').slice(0, 1200));
