const fs = require('fs');
const path = require('path');

function walk(d, a = []) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p, a);
    else if (n.endsWith('.js')) a.push(p);
  }
  return a;
}

// LoginPrompter and popup queue
for (const f of [
  'output/679win/assets/theme-0/LoginPrompterIndex.BeZ3T2SF.js',
  'output/679win/assets/theme-0/HomeIndex.CkLqNaXp.js',
  'output/679win/assets/theme-0/index.dmZT2U45.js',
  'output/713win/assets/theme-0/commonChunk.CkZ4BOve.js'
]) {
  if (!fs.existsSync(f)) continue;
  const t = fs.readFileSync(f, 'utf8');
  console.log('\n####', path.basename(f));
  for (const k of ['taskSeries', 'getTaskModuleConstants', 'taskDaily', 'newComer', 'popupQueue', 'openPopup', 'afterLogin']) {
    let i = -1;
    let c = 0;
    while ((i = t.indexOf(k, i + 1)) !== -1 && c < 2) {
      const snip = t.slice(Math.max(0, i - 100), i + 250).replace(/\s+/g, ' ');
      if (/open|queue|dialog|Dialog|taskSeries|Constants/.test(snip)) {
        console.log(k, snip.slice(0, 360));
        console.log('---');
        c++;
      }
    }
  }
}
