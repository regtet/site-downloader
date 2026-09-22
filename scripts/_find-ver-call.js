const fs = require('fs');
const path = require('path');
const dir = path.join('dist', '713win.com', 'assets', 'theme-0');
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.js')) continue;
  const text = fs.readFileSync(path.join(dir, name), 'utf8');
  const i = text.indexOf('createLobbyVersionUpdate');
  if (i < 0) continue;
  if (name.indexOf('CreateLobbyVersionUpdate') === 0) continue;
  console.log('\n##', name);
  console.log(text.slice(Math.max(0, i - 400), i + 200).replace(/\s+/g, ' '));
}
