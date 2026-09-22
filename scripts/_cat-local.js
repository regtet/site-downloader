const axios = require('axios');
const fs = require('fs');
const login = fs.readFileSync('logs/diff-login/ours-login.txt', 'utf8');
const jwt = (login.match(/"session_key":"([^"]+)"/) || [])[1] || '';

async function hit(label, headers) {
  const res = await axios.get('http://127.0.0.1:3482/hall/api/active/category?siteCode=12578&currency=BRL&language=pt', {
    headers,
    timeout: 25000,
    validateStatus: () => true,
    responseType: 'text'
  });
  const text = String(res.data || '');
  console.log(label, res.status, res.headers['x-sd-auth-sanitized'] || '', res.headers['x-sd-proxy'] || '', text.slice(0, 140).replace(/\s+/g, ' '));
}

async function main() {
  await hit('bare', { 'x-sd-upstream': 'https://aniw317.713win.cc' });
  await hit('jwt', {
    'x-sd-upstream': 'https://aniw317.713win.cc',
    token: jwt,
    newJwt: jwt
  });
  await hit('object', {
    'x-sd-upstream': 'https://aniw317.713win.cc',
    'x-object-id': JSON.stringify({ uid: '612538585', init: { version: 1 } })
  });
}
main().catch((e) => { console.error(e.message); process.exit(1); });
