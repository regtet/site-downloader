const fs = require('fs');
const files = [
  'output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js',
  'output/713win/assets/theme-0/2_EventOthersChunk.rFD1HERx.js',
  'output/713win/assets/theme-0/commonChunk.BDsWqXz0.js',
];
for (const f of files) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  // Find jg= assignment - minified async that returns taskSetting
  let i = t.indexOf('jg=async');
  if (i < 0) i = t.indexOf('jg=()');
  if (i < 0) i = t.indexOf('const jg=');
  if (i < 0) i = t.indexOf(',jg=');
  if (i >= 0) {
    console.log('FOUND jg in', f);
    console.log(t.slice(i - 50, i + 400).replace(/\s+/g, ' '));
  }
  // Look for url that accompanies taskSetting response usage with ue(jg())
  i = t.indexOf('ue(jg())');
  if (i >= 0) console.log('ue(jg) in', f, t.slice(i - 200, i + 100).replace(/\s+/g, ' '));
}

// Search all theme-0 for taskSetting API path pattern
const dir = 'output/713win/assets/theme-0';
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith('.js')) continue;
  const t = fs.readFileSync(dir + '/' + name, 'utf8');
  if (t.includes('taskSetting') && (t.includes('/api/') || t.includes('url:'))) {
    // find nearby /api/ strings around taskSetting
    let pos = 0, n = 0;
    while ((pos = t.indexOf('taskSetting', pos)) !== -1 && n < 3) {
      const snip = t.slice(Math.max(0, pos - 300), pos + 200);
      if (snip.includes('/api/')) {
        console.log('\n', name, '@', pos);
        console.log(snip.replace(/\s+/g, ' ').slice(0, 500));
        n++;
      }
      pos++;
    }
  }
}
