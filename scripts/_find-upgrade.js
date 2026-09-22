const fs = require('fs');
const path = require('path');
const dir = path.join('dist', '713win.com', 'assets', 'theme-0');
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.js')) continue;
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  const i = text.indexOf('checkVersionUpgradeRes');
  if (i < 0) continue;
  console.log('\n##', name, i);
  console.log(text.slice(Math.max(0, i - 250), i + 180).replace(/\s+/g, ' '));
}
