const fs = require('fs');
const path = require('path');
function walk(dir, depth) {
  if (depth > 2) return;
  let names;
  try { names = fs.readdirSync(dir); } catch (_) { return; }
  for (const name of names) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) walk(p, depth + 1);
    else if (/oss|har|snapshot/i.test(name)) console.log(p, st.size);
  }
}
walk('output/713win', 0);
