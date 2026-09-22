const fs = require('fs');
const path = require('path');
const dir = path.join('dist', '713win.com', 'assets', 'theme-0');
const needles = ['upgradedMsg', 'upgraded'];
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.js')) continue;
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  let from = 0;
  let n = 0;
  while (n < 4) {
    const i = text.indexOf('upgraded', from);
    if (i < 0) break;
    console.log('\n##', name, i);
    console.log(text.slice(Math.max(0, i - 220), i + 260).replace(/\s+/g, ' '));
    from = i + 8;
    n++;
  }
}
