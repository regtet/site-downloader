const fs = require('fs');
const dlg = fs.readFileSync('output/679win/assets/theme-0/2_EventOthersChunk.rFD1HERx.js', 'utf8');

// Find rule field usage in task series UI
for (const k of [
  'btnStatus', 'receiveLogId', 'taskName', 'rewardAmount', 'awardAmount',
  'ruleName', 'title', 'icon', 'jumpType', 'condition', 'finishCount',
  'target', 'progress', 'amount', 'reward', 'ruleDesc', 'taskDesc'
]) {
  const c = dlg.split(k).length - 1;
  if (c) console.log(k, c);
}

// Dump a section that renders a rule row
let i = dlg.indexOf('btnStatus');
console.log('\n==== btnStatus usage ====');
console.log(dlg.slice(Math.max(0, i - 200), i + 500).replace(/\s+/g, ' ').slice(0, 700));

i = dlg.indexOf('pages-dialogs-task-series-new');
console.log('\n==== more dialog ====');
console.log(dlg.slice(i, i + 2500).replace(/\s+/g, ' ').slice(0, 1800));
