const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');

// Find where taskSeries / taskDaily popup is opened
for (const k of ['mm.taskSeries', 'mm.taskDaily', '"taskSeries"', "'taskSeries'", 'taskSeries"', 'open(mm', 'popType']) {
  // skip
}

let i = t.indexOf('e.taskSeries="taskSeries"');
console.log('enum area', t.slice(i - 100, i + 400));

// Find open dialog with taskSeries string
i = -1;
let c = 0;
while ((i = t.indexOf('taskSeries', i + 1)) !== -1 && c < 15) {
  const snip = t.slice(Math.max(0, i - 120), i + 200).replace(/\s+/g, ' ');
  if (/open\(|openDialog|emit\(|popType|queue|push/.test(snip)) {
    console.log('\n@', i, snip.slice(0, 350));
  }
  c++;
}

// HG = newcomer_benefit_pop consumers
i = t.indexOf('HG=async');
console.log('\n==== HG def ====');
console.log(t.slice(i, i + 400));

// find HG( calls - exported name?
const exp = t.indexOf('HG as ');
console.log('\nHG as', t.slice(exp, exp + 30));

// Search afterLoginPopType usage for opening task
i = t.indexOf('afterLoginPopType');
console.log('\nafterLoginPopType', t.slice(i, i + 600).replace(/\s+/g, ' '));
