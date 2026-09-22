const axios = require('axios');
const { applySystemProxy } = require('../src/system-proxy');
applySystemProxy({ log: false });

async function main() {
  const res = await axios.get('https://713win.com/', {
    timeout: 20000,
    headers: { 'User-Agent': 'Mozilla/5.0' },
    validateStatus: () => true
  });
  const html = String(res.data || '');
  const ver = html.match(/data-version="([^"]+)"/);
  const web = html.match(/v\d+\.\d+\.\d+/);
  console.log('status', res.status, 'data-version', ver && ver[1], 'web', web && web[0], 'len', html.length);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
