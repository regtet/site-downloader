const fs = require('fs');
const path = require('path');
const root = path.join('dist', '713win.com');
const needles = ['foi atualizada', 'Atualize a p', 'Fazendo login'];

function walk(dir, depth) {
  if (depth > 3) return;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch (_) { continue; }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'game_pictures' || name === 'lobby_asset') continue;
      walk(p, depth + 1);
      continue;
    }
    if (!/\.(js|json)$/i.test(name) || st.size > 8e6) continue;
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch (_) { continue; }
    for (const n of needles) {
      const i = text.indexOf(n);
      if (i >= 0) console.log(p, n, text.slice(Math.max(0, i - 80), i + 120).replace(/\s+/g, ' '));
    }
  }
}
walk(root, 0);
