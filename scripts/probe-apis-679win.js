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
  const login = await post(port, '/api/member/login', {
    account: 'qq123123',
    password: 'qq123123',
    userpass: 'qq123123'
  });
  const lj = JSON.parse(login.body);
  const token = lj.data && lj.data.session_key;
  console.log('login', lj.code, 'user', lj.data && lj.data.username, 'nick', lj.data && lj.data.nickname);

  const paths = [
    ['/api/finance/pay/payTypeSetting', {}],
    ['/api/finance/pay/payplatformlistV3', { payKind: 100 }],
    ['/api/member/user/vipInfoV2', {}],
    ['/api/member/user/info', {}],
    ['/api/agent/promote/report/agentPromotion', {}],
    ['/api/agent/promote/report/indexInfo', {}]
  ];

  for (const [p, body] of paths) {
    const r = await post(port, p, body, token);
    let j;
    try { j = JSON.parse(r.body); } catch (_) { j = null; }
    const d = j && j.data;
    let info = `code=${j && j.code} adapter=${r.adapter || '-'}`;
    if (p.includes('payplatform') && d) {
      info += ` channels=${(d.list || []).length} hot=${d.list && d.list[0] && d.list[0].channelTooltip}`;
      info += ` rec=${d.recommendList || (d.list && d.list[0] && d.list[0].recommendList)}`;
    }
    if (p.includes('payTypeSetting') && d) info += ` keys=${Object.keys(d).join(',')}`;
    if (p.includes('vipInfo') && d) info += ` keys=${Object.keys(d).slice(0, 8).join(',')}`;
    if (p.includes('agentPromotion') && d) {
      const link = d.linkList && d.linkList[0];
      info += ` invite=${link && link.url} code=${d.inviteCode || (link && link.code)}`;
    }
    if (p.includes('indexInfo') && d) info += ` direct=${d.totalDirect} comm=${d.totalCommission}`;
    console.log(p.split('/').pop() + ':', info);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
