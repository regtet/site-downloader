const fs = require('fs');
const path = require('path');

const dir = 'output/679win/assets/theme-0';
const files = fs.readdirSync(dir).filter((n) => n.endsWith('.js'));

const re = /e\[e\.(taskDaily|taskWeekly|taskMystery|newBenefits)=(\d+)\]/g;
for (const n of files) {
  const t = fs.readFileSync(path.join(dir, n), 'utf8');
  let m;
  const hits = [];
  while ((m = re.exec(t))) hits.push(m[0]);
  if (hits.length) console.log(n, hits.slice(0, 8));
}

// Find P function in index - search for afterLoginPopType handling
const idx = fs.readFileSync(path.join(dir, 'index.dmZT2U45.js'), 'utf8');
// Look for pop type enum EveryTime / Daily / etc
for (const k of ['afterLoginPopType', 'EveryTime', 'everyDay', 'popType', 'PopType', 'OnlyOnce']) {
  let i = -1;
  let c = 0;
  while ((i = idx.indexOf(k, i + 1)) !== -1 && c < 3) {
    console.log('\n', k, idx.slice(Math.max(0, i - 60), i + 180).replace(/\s+/g, ' ').slice(0, 260));
    c++;
  }
}

// Find function that checks pop type value === 0/1/2
let i = idx.indexOf('getUserChecked');
// go backwards to find P=
const region = idx.slice(Math.max(0, i - 2500), i);
const pi = region.lastIndexOf('P=');
console.log('\n==== P candidate ====');
console.log(region.slice(pi, pi + 800).replace(/\s+/g, ' '));
