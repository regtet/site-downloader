const fs = require('fs');
const text = fs.readFileSync('dist/713win.com/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');
const n = 'session_key';
let from = 0;
let c = 0;
while (c < 2) {
  const i = text.indexOf(n, from);
  if (i < 0) break;
  console.log('\n##', i);
  console.log(text.slice(Math.max(0, i - 200), i + 250).replace(/\s+/g, ' '));
  from = i + n.length;
  c++;
}
