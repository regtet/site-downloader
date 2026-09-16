const fs = require('fs');
const promo = fs.readFileSync('output/679win/assets/theme-0/1_PromotionChunk.CdSsli5j.js', 'utf8');

// Find task rule list item fields
for (const k of ['ruleName', 'taskDesc', 'awardAmount', 'bonusAmount', 'rewards', 'bindType', 'conditionType', 'jumpType', 'iconUrl', 'imgUrl', 'status', 'receiveLogId']) {
  const n = promo.split(k).length - 1;
  if (n) console.log(k, n);
}

let i = promo.indexOf('receiveLogId');
if (i >= 0) console.log('\nreceiveLogId', promo.slice(i - 200, i + 400).replace(/\s+/g, ' ').slice(0, 600));

i = promo.indexOf('listItem');
let c = 0;
while ((i = promo.indexOf('listItem', i + 1)) !== -1 && c < 5) {
  const snip = promo.slice(i - 80, i + 200).replace(/\s+/g, ' ');
  if (/props|defineProps|rule|task/.test(snip)) {
    console.log('\nlistItem', snip.slice(0, 300));
    c++;
  }
}

// Search for props of task item
i = promo.indexOf('PendingReceive');
console.log('\nPendingReceive area', promo.slice(Math.max(0, i - 300), i + 400).replace(/\s+/g, ' ').slice(0, 700));
