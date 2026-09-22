const fs = require('fs');
const files = [
  'dist/713win.com/assets/theme-0/commonChunk.CkZ4BOve.js',
  'dist/713win.com/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js'
];
for (const f of files) {
  const text = fs.readFileSync(f, 'utf8');
  for (const n of ['decryptData(', 'isEncryptEnabled']) {
    let from = 0;
    let c = 0;
    while (c < 3) {
      const i = text.indexOf(n, from);
      if (i < 0) break;
      console.log('\n##', f.split('/').pop(), n, i);
      console.log(text.slice(Math.max(0, i - 160), i + 200).replace(/\s+/g, ' '));
      from = i + n.length;
      c++;
    }
  }
}
