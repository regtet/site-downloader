const fs = require('fs');
const path = require('path');
const dir = path.join('dist', '713win.com', 'assets');
function walk(d) {
  for (const name of fs.readdirSync(d)) {
    const p = path.join(d, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { walk(p); continue; }
    if (!name.endsWith('.js') || st.size > 6e6) continue;
    const text = fs.readFileSync(p, 'utf8');
    let from = 0;
    while (true) {
      const i = text.indexOf('VERSION_CHECK', from);
      if (i < 0) break;
      console.log(p, text.slice(Math.max(0, i - 160), i + 80).replace(/\s+/g, ' '));
      from = i + 12;
    }
  }
}
walk(dir);
