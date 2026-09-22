/**
 * 719win 页面验收：路由、代理金额、活动列表与活动详情形状。
 * 只断言类型和换算，不打印官方文案。
 * 用法: node scripts/accept-719win-pages.js
 */
const https = require('https');
const { matchRoute } = require('../src/adapter/series/aniw-lobby');
const { mapProxyStatistics, mapWithdrawInfo } = require('../src/adapter/providers/wgame/http-maps');
const { applyAdapter } = require('../src/adapter/series/aniw-lobby/adapters');

require('../src/preview-proxy');

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed += 1;
    console.log('  OK ', msg);
  } else {
    failed += 1;
    console.error('  FAIL', msg);
  }
}

function get(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
      });
    }).on('error', reject);
  });
}

function post(url, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname,
      method: 'POST',
      headers
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function routes() {
  const getRow = matchRoute('/api/active/get');
  assert(getRow && getRow.op === 'upstream.passthrough', 'active/get upstream');
  const credit = matchRoute('/api/agent/credit/agentCenter/indexInfoV2');
  assert(credit && credit.path === '/api/agent/promote/index/indexInfoV2', 'credit index alias');
  const comm = matchRoute('/api/agent/credit/agentCenter/agentCommission');
  assert(comm && comm.path === '/api/agent/promote/index/agentCommission', 'credit commission alias');
}

function agentScale() {
  const st = mapProxyStatistics({
    lv1PersonCount: 2,
    lv2PersonCount: 1,
    lv1Bonus: 1500,
    lv2Bonus: 500,
    lv3Bonus: 0,
    lv1Running: 3000
  });
  assert(st.directMembers === 2, 'directMembers');
  assert(st.otherMembers === 1, 'otherMembers');
  assert(st.totalDirectCommission === 1.5, 'bonus/1000');
  assert(st.directPerformanceYet === 3, 'running/1000');
  assert(st.totalCommission === 2, 'commission sum');
  const home = applyAdapter('agentBlob', { ok: true, data: st }, {
    routePath: '/api/agent/promote/index/indexInfoV2'
  });
  assert(home && home.code === 1 && home.data && home.data.directMembers === 2, 'indexInfoV2 members');
  assert(home.data.otherMembers === 1, 'indexInfoV2 other');
  assert(home.data.directPerformanceYet === 3, 'indexInfoV2 performance');
  assert(home.data.activeJson === '[]', 'indexInfoV2 activeJson');
  assert(home.data.isAgent === false, 'indexInfoV2 isAgent default');
  const pay = applyAdapter('agentBlob', { ok: true, data: st }, {
    routePath: '/api/agent/promote/index/agentCommission'
  });
  assert(pay && pay.data && pay.data.totalDirectCommission === 1.5, 'commission direct');
  assert(pay.data.totalOtherCommission === 0.5, 'commission other');
  assert(pay.data.canTakeCommission === 2, 'canTakeCommission');
  const fin = applyAdapter('agentFinance', { ok: true, data: st }, {
    routePath: '/api/agent/promote/report/directFinV4'
  });
  assert(fin && fin.code === 1 && fin.data.list.length === 0, 'finance list empty');
  assert(fin.data.totalRecords === 0, 'finance totalRecords');
  assert(fin.data.directDeposit === 0, 'finance direct deposit default');
  assert(fin.data.directRegisterPerson === 2, 'finance direct persons');
  assert(fin.data.otherRegisterPerson === 1, 'finance other persons');
  assert(fin.data.directValidBet === 3, 'finance direct bet');
  const empty = applyAdapter('agentReportEmpty', { ok: true, data: {} }, {});
  assert(empty && empty.code === 1 && empty.data.totalRecords === 0 && empty.data.list.length === 0, 'order coupon empty page');
  const finRoute = matchRoute('/api/agent/promote/report/directFinV4');
  assert(finRoute && finRoute.adapter === 'agentFinance' && finRoute.op === 'agent.total', 'directFin route');
  const order = matchRoute('/api/agent/promote/report/directOrderV3');
  const coupon = matchRoute('/api/agent/promote/report/directCouponV3');
  const intro = matchRoute('/api/agent/promote/config/introduce');
  assert(order && order.adapter === 'agentReportEmpty' && order.op !== 'feature.pending', 'directOrder not pending');
  assert(coupon && coupon.adapter === 'agentReportEmpty', 'directCoupon empty');
  assert(intro && intro.op === 'upstream.passthrough', 'introduce upstream');
}

function withdrawShape() {
  const info = mapWithdrawInfo({
    enableRes: { enableWithdraw: 5000, needWageRequired: 1000, minRunning: 10000 }
  });
  assert(Array.isArray(info.accounts) && info.accounts.length === 0, 'withdraw accounts');
  assert(info.enableWithdraw === 5, 'withdraw amount /1000');
  assert(info.withdrawMin === 10, 'withdraw min');
  assert(info.withdrawMax === 5, 'withdraw max from balance');
  assert(Array.isArray(info.withdrawTypes) && info.withdrawTypes[0].typeName === 'PIX', 'withdraw pix');
  const setPwd = matchRoute('/api/member/user/security/modifyWithdrawPass');
  const verifyPwd = matchRoute('/api/member/user/security/verifyWithdrawPass');
  const loginPwd = matchRoute('/api/member/user/changePass');
  assert(setPwd && setPwd.op === 'withdraw.pending', 'set withdraw password routed');
  assert(verifyPwd && verifyPwd.op === 'withdraw.pending', 'verify withdraw password routed');
  assert(loginPwd && loginPwd.op === 'feature.pending', 'login password stays pending');
}

async function activity() {
  const cat = await get('https://oniw917.719win.bet/hall/api/active/category/currency/BRL/language/pt.json');
  assert(cat.status === 200, 'category status');
  const cj = JSON.parse(cat.text);
  const list = (cj.data && (cj.data.activeList || cj.data.categoryList)) || cj.activeList || [];
  assert(Array.isArray(list) && list.length > 0, 'category list');
  const activeId = Number(list[0] && list[0].activeId);
  assert(activeId > 0, 'activeId');
  const body = JSON.stringify({ activeId });
  const detail = await post('https://aniw917.719win.vip/hall/api/active/get', {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-data-mode': 'plain',
    currency: 'BRL',
    language: 'pt',
    sitecode: '12580',
    'Content-Length': Buffer.byteLength(body)
  }, body);
  assert(detail.status === 200, 'detail status');
  const dj = JSON.parse(detail.text);
  assert(Number(dj.code) === 1, 'detail code');
  assert(dj.data && Number(dj.data.id) === activeId, 'detail id');
  assert(typeof dj.data.name === 'string' && dj.data.name.length > 0, 'detail name');
  assert(typeof dj.data.content === 'string', 'detail content');
  assert(typeof dj.data.template === 'number', 'detail template');
  assert(dj.data.activeData && typeof dj.data.activeData === 'object', 'detail activeData');
  console.log('  detail nameLen', dj.data.name.length, 'contentLen', dj.data.content.length);
}

(async () => {
  routes();
  agentScale();
  withdrawShape();
  try {
    await activity();
  } catch (err) {
    assert(false, 'activity fetch ' + (err && err.message));
  }
  console.log('passed=' + passed + ' failed=' + failed);
  process.exit(failed ? 1 : 0);
})();
