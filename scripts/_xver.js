const fs = require('fs');
const text = fs.readFileSync('dist/713win.com/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');
const i = text.indexOf('getHtmlTemplateVersion:i');
console.log(text.slice(i, i + 1600));
