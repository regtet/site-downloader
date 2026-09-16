const fs = require('fs');
const t = fs.readFileSync('output/713win/assets/theme-0/0_EntryLoginRegisterChunk.BJORNyK1.js', 'utf8');

// jg is imported - find which import alias maps. Look at import list for possible async APIs.
// Search whole 713 for function that returns taskSetting via request
const path = require('path');
function walk(d, a = []) {
  for (const n of fs.readdirSync(d)) {
    const p = path.join(d, n);
    if (fs.statSync(p).isDirectory()) walk(p, a);
    else if (n.endsWith('.js') && fs.statSync(p).size < 15e6) a.push(p);
  }
  return a;
}

for (const f of walk('output/713win/assets/theme-0')) {
  const s = fs.readFileSync(f, 'utf8');
  if (!s.includes('taskSetting') || !s.includes('url:')) continue;
  // Find request blocks that mention taskSetting nearby OR return data with that field from a dedicated API
  let i = -1;
  let c = 0;
  while ((i = s.indexOf('url:"/api/', i + 1)) !== -1 && c < 30) {
    const snip = s.slice(i, i + 120);
    if (/task|active\/isShow|active\/setting|taskConfig|taskInfo/i.test(snip)) {
      console.log(path.basename(f), snip);
      c++;
    }
  }
}

console.log('\n==== lF full ====');
const common = fs.readFileSync('output/713win/assets/theme-0/commonChunk.CkZ4BOve.js', 'utf8');
const li = common.indexOf('lF=e=>{var r,s,i,l;if(!Array.isArray(e))return!1');
console.log(common.slice(li, li + 500).replace(/\s+/g, ' '));

console.log('\n==== judgeCategoryPopOpenByConfig ====');
let idx = common.indexOf('judgeCategoryPopOpenByConfig');
console.log(common.slice(idx, idx + 600).replace(/\s+/g, ' '));
