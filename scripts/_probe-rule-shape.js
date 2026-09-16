const fs = require('fs');
const dlg = fs.readFileSync('output/679win/assets/theme-0/2_EventOthersChunk.rFD1HERx.js', 'utf8');
const entry = fs.readFileSync('output/679win/assets/theme-0/0_EntryLoginRegisterChunk.Dc-nf5V0.js', 'utf8');

// Find rule item render - look for receiveLogId or status fields on rule
for (const src of [dlg, entry]) {
  let i = src.indexOf('PendingReceive');
  if (i >= 0) console.log('PendingReceive', src.slice(i - 100, i + 200).replace(/\s+/g, ' ').slice(0, 320));
}

// Kt status enum
const common = fs.readFileSync('output/679win/assets/theme-0/commonChunk.C4ZsWNMG.js', 'utf8');
const re = /e\[e\.(Goto|PendingReceive|Finish|Received|Lock)=(\d+)\]/g;
let m;
while ((m = re.exec(common))) console.log(m[0]);
while ((m = re.exec(entry))) console.log('entry', m[0]);

// Dump rule row component - search awardAmount or rewardAmount in dlg
let i = dlg.indexOf('rewardAmount');
console.log('\nrewardAmount', dlg.slice(i - 300, i + 400).replace(/\s+/g, ' ').slice(0, 700));

i = dlg.indexOf('taskName');
console.log('\ntaskName', dlg.slice(i - 100, i + 200).replace(/\s+/g, ' ').slice(0, 320));

// Search entry for fields read from rule: .type .bindType .award
i = -1;
let c = 0;
while ((i = entry.indexOf('ue.', i + 1)) !== -1 && c < 5) {
  // too broad
  break;
}

// Look at L(M,U) store function - what fields kept
i = entry.indexOf('L=(V,U)');
if (i < 0) i = entry.indexOf('L=V=>{');
// search ",L=" near constantTaskDataMapper update
i = entry.indexOf('constantTaskDataMapper');
console.log('\nstore area', entry.slice(i - 400, i + 200).replace(/\s+/g, ' ').slice(0, 600));
