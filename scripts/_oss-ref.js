const https = require('https');
const fs = require('fs');

const report = JSON.parse(fs.readFileSync('dist/679win.com/report.json', 'utf8'));
const samples = [];
for (const row of report.assets || report || []) {
  const ref = row.ref || row.url || '';
  if (/oniw976|siteadmin|lobby_asset.*\.(png|jpg|webp|svg)/i.test(ref) && samples.length < 8) {
    samples.push(ref);
  }
}
// also from network
try {
  const net = JSON.parse(fs.readFileSync('dist/679win.com/network.json', 'utf8'));
  const arr = Array.isArray(net) ? net : net.entries || [];
  for (const e of arr) {
    const u = e.url || e.request?.url || '';
    if (/oniw976.*\.(png|jpg|webp|svg)/i.test(u) && samples.length < 12) samples.push(u);
  }
} catch (_) {}

console.log('samples', samples);

function get(url, headers) {
  return new Promise((resolve) => {
    https
      .get(url, { headers }, (res) => {
        resolve({ url: url.slice(0, 80), status: res.statusCode, ct: res.headers['content-type'] });
        res.resume();
      })
      .on('error', (e) => resolve({ url: url.slice(0, 80), err: String(e) }));
  });
}

(async () => {
  for (const u of samples.slice(0, 5)) {
    console.log(
      await get(u, {
        Referer: 'https://679win.com/',
        'User-Agent': 'Mozilla/5.0'
      })
    );
    console.log(
      await get(u, {
        Referer: 'https://oniw976.679win.cc/',
        'User-Agent': 'Mozilla/5.0'
      })
    );
  }
})();
