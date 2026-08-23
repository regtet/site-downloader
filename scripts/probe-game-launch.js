/**
 * 探测游戏启动 API：登录后 POST gameApi/login
 * 用法: node scripts/probe-game-launch.js [port] [platformId] [gameId]
 */
const http = require('http');

function post(port, path, body, token) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body || {}));
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': payload.length
    };
    if (token) headers.token = token;
    const req = http.request(
      { hostname: '127.0.0.1', port, path, method: 'POST', headers },
      (res) => {
        let data = '';
        res.on('data', (c) => { data += c; });
        res.on('end', () => {
          resolve({
            status: res.statusCode,
            adapter: res.headers['x-sd-adapter'],
            body: data
          });
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

(async () => {
  const port = Number(process.argv[2] || 3477);
  const platformId = process.argv[3] || '0999';
  const gameId = Number(process.argv[4] || 0);

  const login = await post(port, '/api/member/login', {
    account: 'qq123123',
    password: 'qq123123',
    userpass: 'qq123123'
  });
  const lj = JSON.parse(login.body);
  const token = lj.data && lj.data.session_key;
  console.log('login', lj.code, 'user', lj.data && lj.data.username);

  const launch = await post(port, '/api/gameCenter/gameApi/login', {
    gameid: gameId,
    platfromid: platformId,
    user_type: 1
  }, token);
  let j;
  try { j = JSON.parse(launch.body); } catch (_) { j = null; }
  const d = j && j.data;
  console.log('gameApi/login:', {
    code: j && j.code,
    adapter: launch.adapter,
    game_url: d && d.game_url,
    gameName: d && d.gameName,
    direction: d && d.direction,
    gameid: d && d.gameid,
    platfromid: d && d.platfromid
  });
  if (!j || j.code !== 1) process.exit(1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
