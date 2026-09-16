const fs = require('fs');
const path = require('path');

function findChunk(root, prefix) {
  const dir = path.join(root, 'assets/theme-0');
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).find((n) => n.startsWith(prefix) && n.endsWith('.js'));
}

const root = fs.existsSync('output/679win/assets/theme-0') ? 'output/679win' : 'output/713win';
const entryName = findChunk(root, '0_EntryLoginRegisterChunk') || findChunk(root, '0_Entry');
const othersName = findChunk(root, '2_EventOthersChunk');
console.log({ root, entryName, othersName });

const entry = fs.readFileSync(path.join(root, 'assets/theme-0', entryName), 'utf8');

let i = -1;
let c = 0;
while ((i = entry.indexOf('await BT(', i + 1)) !== -1 && c < 5) {
  console.log('\nBT', entry.slice(Math.max(0, i - 250), i + 400).replace(/\s+/g, ' ').slice(0, 650));
  c++;
}

// Find E=async that fills O/constantTaskDataMapper
i = entry.indexOf('getActiveTabTasks:E');
console.log('\nnear export', entry.slice(i - 50, i + 80));

// Search for O.value= or constantTaskDataMapper assignment patterns near BT result
i = -1;
c = 0;
while ((i = entry.indexOf('O.value', i + 1)) !== -1 && c < 8) {
  console.log('\nO.value', entry.slice(i - 80, i + 200).replace(/\s+/g, ' ').slice(0, 300));
  c++;
}

if (othersName) {
  const dlg = fs.readFileSync(path.join(root, 'assets/theme-0', othersName), 'utf8');
  i = dlg.indexOf('pages-dialogs-task');
  console.log('\n==== dialog ====');
  console.log(dlg.slice(i, i + 1200).replace(/\s+/g, ' ').slice(0, 900));
}
