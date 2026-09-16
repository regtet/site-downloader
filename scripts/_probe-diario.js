const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/2_EventOthersChunk.Dl_K8n0m.js', 'utf8');

console.log('size', t.length);
for (const k of [
  'pages-dialogs-task',
  'dialogBox',
  'taskSeries',
  'taskDaily',
  'newcomer',
  'openDialog',
  'register',
  'single-tab',
  'persistBox',
  'Não mostrar',
  'Centro de Miss',
  'active-receive',
  'task-inside'
]) {
  const c = t.split(k).length - 1;
  if (c) console.log(k, c);
}

// Find dialog name registration
const re = /ie\("pages-dialogs[^"]+"\)|be\("pages-dialogs[^"]+"\)/g;
let m;
while ((m = re.exec(t))) console.log('name', m[0]);

// Find open("xxx related to task
let i = -1;
let n = 0;
while ((i = t.indexOf('open("', i + 1)) !== -1 && n < 20) {
  const snip = t.slice(i, i + 60);
  if (/task|Task|daily|Daily|series|Series|newcomer|benefit|active/i.test(snip)) {
    console.log('open', snip);
  }
  n++;
}
