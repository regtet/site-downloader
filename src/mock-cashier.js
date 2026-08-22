/**
 * 开发用自有收银台模拟：返回 PIX 风格 qrCode + orderNo。
 * 生产环境在 adapter-hosts.json 配置 pay.createOrder.httpUrl 指向真实 API。
 */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function createMockCashierOrder(body) {
  const amount = body && (body.money != null ? body.money : body.amount);
  const orderNo = String(
    (body && (body.orderNo || body.order_no || body.outTradeNo))
    || ('MC' + Date.now() + Math.floor(Math.random() * 1000))
  );
  const money = amount != null ? String(amount) : '0';
  const qrCode = [
    '00020126580014br.gov.bcb.pix0136',
    'MOCK-' + orderNo + '-AMT' + money,
    '5204000053039865802BR5925Mock Cashier6009SAO PAULO62070503***6304ABCD'
  ].join('');
  return {
    code: 1,
    msg: 'ok',
    data: {
      success: true,
      orderNo,
      outTradeNo: orderNo,
      order_no: orderNo,
      qrCode,
      url: '',
      urlOpenWay: 4,
      money
    }
  };
}

/** Express-style handler for server.js / static-server */
async function handleMockCashierRequest(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 405, msg: 'POST only' }));
    return true;
  }
  try {
    const body = await readJsonBody(req);
    const payload = createMockCashierOrder(body);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(payload));
  } catch (err) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ code: 400, msg: String(err && err.message || err) }));
  }
  return true;
}

function isMockCashierPath(pathname) {
  return pathname === '/api/dev/mock-cashier/create';
}

module.exports = {
  createMockCashierOrder,
  handleMockCashierRequest,
  isMockCashierPath,
  readJsonBody
};
