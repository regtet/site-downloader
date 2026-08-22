/** 将危险的 lobbyOk 动作改为 featurePending */
const fs = require('fs');
const path = require('path');

const bulkPath = path.join(__dirname, '..', 'src', 'adapter', 'series', 'aniw-lobby', 'safe-bulk-map.js');
let text = fs.readFileSync(bulkPath, 'utf8');
const flip = [
  '/api/finance/claim/cancelOrder',
  '/api/finance/certify/setdefault',
  '/api/active/rejectManualSend',
  '/api/message/publicityPlaza/user/cancelFavorites',
  '/api/message/publicityPlaza/user/cancelFollow',
  '/api/message/publicityPlaza/user/cancelLike'
];
let n = 0;
for (const p of flip) {
  const needle = `'${p}': OK,`;
  if (text.includes(needle)) {
    text = text.split(needle).join(`'${p}': FEAT,`);
    n += 1;
  }
}
fs.writeFileSync(bulkPath, text);
console.log(JSON.stringify({ flipped: n }, null, 2));
