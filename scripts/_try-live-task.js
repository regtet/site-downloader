const fs = require('fs');
const path = require('path');
const https = require('https');

// Try fetching isShowV2 already works via OSS. Try live task API from aniw domain (will likely fail without auth)
const hosts = [
  'aniw976.679win.me',
  'aniw976.679win.cc',
];

function post(host, urlPath, body, headers = {}) {
  return new Promise((resolve) => {
    const data = JSON.stringify(body || {});
    const req = https.request({
      hostname: host,
      path: urlPath,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        ...headers
      },
      timeout: 8000,
      rejectUnauthorized: false
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve({ status: res.statusCode, ct: res.headers['content-type'], body: buf.toString('utf8').slice(0, 500) });
      });
    });
    req.on('error', (e) => resolve({ error: e.message }));
    req.on('timeout', () => { req.destroy(); resolve({ error: 'timeout' }); });
    req.write(data);
    req.end();
  });
}

(async () => {
  for (const h of hosts) {
    const r = await post(h, '/hall/api/active/tasks/task', { template: 2, taskId: 2 });
    console.log(h, r);
  }
})();
