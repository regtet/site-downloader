const fs = require('fs');
const text = fs.readFileSync('dist/713win.com/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');
const needles = ['byServer', 'getHtmlTemplateVersion', 'htmlTemplateVersion', 'versionTips'];
for (const n of needles) {
  let from = 0;
  let c = 0;
  while (c < 3) {
    const i = text.indexOf(n, from);
    if (i < 0) break;
    console.log('\n##', n, i);
    console.log(text.slice(Math.max(0, i - 180), i + 220).replace(/\s+/g, ' '));
    from = i + n.length;
    c++;
  }
}
