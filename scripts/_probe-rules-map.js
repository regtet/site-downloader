const fs = require('fs');
const dlg = fs.readFileSync('output/679win/assets/theme-0/2_EventOthersChunk.rFD1HERx.js', 'utf8');

// Extract task-inside / rule row rendering by finding "rules.map" or similar
let i = dlg.indexOf('.rules');
let c = 0;
while ((i = dlg.indexOf('.rules', i + 1)) !== -1 && c < 10) {
  console.log(c, dlg.slice(i - 80, i + 200).replace(/\s+/g, ' ').slice(0, 300));
  console.log('---');
  c++;
}

// Find Be= bindType enum for tasks
const entry = fs.readFileSync('output/679win/assets/theme-0/0_EntryLoginRegisterChunk.Dc-nf5V0.js', 'utf8');
i = entry.indexOf('downloadAndLogin');
console.log('\nbindTypes', entry.slice(i - 200, i + 300).replace(/\s+/g, ' ').slice(0, 520));

// Try to find a sample in lobby_asset or locales for Diario
const ptFiles = fs.readdirSync('output/679win/assets').filter((n) => /pt/i.test(n) && n.endsWith('.js')).slice(0, 5);
console.log('pt assets', ptFiles);
