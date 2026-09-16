const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

const keys = [
  'newcomer_benefit_pop',
  'taskSeries',
  'taskDialog',
  'dailyTask',
  'afterLoginPop',
  'loginSuccessPop',
  'popCanReceive',
  'distributedReward',
  'open("task',
  "open('task",
  'taskSeriesDialog',
  'TaskSeries',
  'REGISTER_SUCCESS',
  'registerRecharge'
];

for (const k of keys) {
  let i = -1;
  let c = 0;
  while ((i = t.indexOf(k, i + 1)) !== -1 && c < 3) {
    console.log('\n##', k, i);
    console.log(t.slice(Math.max(0, i - 100), i + 320).replace(/\s+/g, ' ').slice(0, 400));
    c++;
  }
}
