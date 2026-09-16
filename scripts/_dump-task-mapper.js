const fs = require('fs');
const entry = fs.readFileSync('output/679win/assets/theme-0/0_EntryLoginRegisterChunk.Dc-nf5V0.js', 'utf8');

// Dump the function that maps category + task API response (around rules sort)
let i = entry.indexOf('M===Qt.taskDaily||M===Qt.taskWeekly');
console.log('==== map task ====');
console.log(entry.slice(i - 800, i + 900).replace(/\s+/g, ' '));

// Find Qt enum
const re = /Qt=\w+\|\|\{\}|e\[e\.(taskDaily|newBenefits)/g;
i = entry.indexOf('Qt.taskDaily');
// search assignment of Qt
i = entry.indexOf('taskDaily=');
let c = 0;
while ((i = entry.indexOf('taskDaily=', i + 1)) !== -1 && c < 10) {
  console.log('\ntaskDaily=', entry.slice(i - 60, i + 100).replace(/\s+/g, ' '));
  c++;
}

// Find getActiveTabTasks E= implementation - search unique "freshActiveTabTasks"
i = entry.indexOf('freshActiveTabTasks:Q');
// The E function is defined earlier in the store - search for E=async near WN/BT
i = entry.indexOf('WN(');
c = 0;
while ((i = entry.indexOf('WN(', i + 1)) !== -1 && c < 6) {
  console.log('\nWN(', entry.slice(Math.max(0, i - 200), i + 300).replace(/\s+/g, ' ').slice(0, 520));
  c++;
}
