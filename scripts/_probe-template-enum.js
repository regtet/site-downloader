const fs = require('fs');
const t = fs.readFileSync('output/679win/assets/theme-0/index.dmZT2U45.js', 'utf8');

// Find v= enum for task templates
let i = t.indexOf('v.taskDaily');
// search for e.taskDaily= or taskDaily:number assignment
i = -1;
let c = 0;
while ((i = t.indexOf('taskDaily', i + 1)) !== -1 && c < 15) {
  const snip = t.slice(Math.max(0, i - 80), i + 80).replace(/\s+/g, ' ');
  if (/\[\w\.taskDaily\]=\d|taskDaily=\d|taskDaily:\d|e\.taskDaily/.test(snip) || /e\[e\.taskDaily/.test(snip)) {
    console.log(c, snip);
    c++;
  }
}

// Broader: find enum init with newBenefits and taskDaily together
i = t.indexOf('newBenefits');
c = 0;
while ((i = t.indexOf('newBenefits', i + 1)) !== -1 && c < 10) {
  const snip = t.slice(Math.max(0, i - 100), i + 200).replace(/\s+/g, ' ');
  if (/taskDaily|taskWeekly|=\d/.test(snip) && snip.length < 350) {
    console.log('\nenum?', snip);
    c++;
  }
}

// Find P= definition used with getUserChecked - in same file
const commonish = t;
i = commonish.indexOf('getUserChecked');
console.log('\n==== getUserChecked area ====');
console.log(commonish.slice(Math.max(0, i - 500), i + 400).replace(/\s+/g, ' ').slice(0, 900));
