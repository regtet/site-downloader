const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/2_EventOthersChunk.Dl_K8n0m.js', 'utf8');

const i = t.indexOf('pages-dialogs-task');
console.log(t.slice(i - 200, i + 4000).replace(/\s+/g, ' '));
