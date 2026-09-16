const fs = require('fs');
const t = fs.readFileSync('output/679win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

// Find enum like (e=>(e[e.taskDaily=1]="taskDaily"...
const re = /e\[e\.(taskDaily|taskWeekly|taskMystery|newBenefits)=(\d+)\]="[^"]+"/g;
let m;
const found = [];
while ((m = re.exec(t))) found.push(m[0]);
console.log('common enum', found.slice(0, 20));

const t2 = fs.readFileSync('output/679win/assets/theme-0/index.dmZT2U45.js', 'utf8');
const found2 = [];
re.lastIndex = 0;
while ((m = re.exec(t2))) found2.push(m[0]);
console.log('index enum', found2.slice(0, 20));

const entry = fs.readFileSync('output/679win/assets/theme-0/0_EntryLoginRegisterChunk.Dc-nf5V0.js', 'utf8');
const found3 = [];
re.lastIndex = 0;
while ((m = re.exec(entry))) found3.push(m[0]);
console.log('entry enum', found3.slice(0, 20));

// Also try simpler pattern
for (const file of [t, t2, entry]) {
  const i = file.indexOf('taskDaily=');
  if (i >= 0) console.log('taskDaily=', file.slice(i - 40, i + 120).replace(/\s+/g, ' '));
}
