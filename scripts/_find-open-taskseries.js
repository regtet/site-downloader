const fs = require('fs');
const path = require('path');

function walk(d, a = []) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, a);
    else if (n.endsWith('.js') && st.size < 12e6) a.push(p);
  }
  return a;
}

for (const root of ['output/713win/assets/theme-0', 'output/679win/assets/theme-0']) {
  console.log('\n====', root);
  for (const f of walk(root)) {
    const t = fs.readFileSync(f, 'utf8');
    // patterns that open taskSeries dialog
    const patterns = [
      /open\(\s*["']taskSeries["']/,
      /open\(\s*[A-Za-z_$][\w$]*\.taskSeries/,
      /openDialog\(\s*["']taskSeries["']/,
      /openDialog\(\s*[A-Za-z_$][\w$]*\.taskSeries/,
      /\.open\(\s*[A-Za-z_$][\w$]*\.taskSeries/,
      /["']taskSeries["']\s*,\s*\{\s*openType/
    ];
    let found = false;
    for (const re of patterns) {
      const m = t.match(re);
      if (m) {
        found = true;
        const i = t.indexOf(m[0]);
        console.log(path.basename(f), m[0]);
        console.log(' ', t.slice(Math.max(0, i - 100), i + 200).replace(/\s+/g, ' ').slice(0, 350));
        break;
      }
    }
    // also Q("taskSeries") already known - search for open with re.taskSeries from enum mm
    if (!found && /taskSeries/.test(t) && /open\(/.test(t)) {
      let i = -1;
      let c = 0;
      while ((i = t.indexOf('taskSeries', i + 1)) !== -1 && c < 8) {
        const snip = t.slice(Math.max(0, i - 80), i + 120);
        if (/open\(|openDialog|queue|pushPop|addPop|showPop/.test(snip)) {
          console.log(path.basename(f), 'near-open', snip.replace(/\s+/g, ' ').slice(0, 280));
          c++;
        }
      }
    }
  }
}
