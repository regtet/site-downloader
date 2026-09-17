const fs = require('fs');
const path = require('path');
const dir = 'output/679win/assets/theme-0';
for (const n of fs.readdirSync(dir)) {
  if (!n.endsWith('.js')) continue;
  const t = fs.readFileSync(path.join(dir, n), 'utf8');
  if (!t.includes('withdrawInfoV2') && !t.includes('withdrawInfo')) continue;
  console.log('====', n);
  let i = -1, c = 0;
  while ((i = t.indexOf('withdrawInfo', i + 1)) !== -1 && c < 6) {
    console.log(t.slice(Math.max(0, i - 100), i + 250).replace(/\s+/g, ' ').slice(0, 380));
    c++;
  }
}
