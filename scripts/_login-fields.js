const fs = require('fs');
const s = fs.readFileSync('dist/679win.com/assets/theme-0/commonChunk.C4ZsWNMG.js', 'utf8');
const i = s.indexOf('jwt_token:O,userkey:T');
console.log(s.slice(i - 1200, i + 400));

// fields read from userInfos after login
for (const n of ['game_gold', 'gameGold', 'username', 'session_key', 'account_type', 'currency', 'platfromid', 'vip', 'nickname', 'headimg', 'avatar']) {
  let c = 0, p = 0;
  while ((p = s.indexOf(n, p)) >= 0 && c < 2) {
    if (p > 430000 && p < 450000) {
      console.log('\n', n, '@', p, s.slice(p - 40, p + 80).replace(/\n/g, ' '));
    }
    p += n.length; c++;
  }
}
