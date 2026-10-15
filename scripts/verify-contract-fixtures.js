/**
 * 用已抓取的官方 catalog 校验关键 adapter 的字段/类型。
 * 允许本地附加字段与零数据空数组，不允许缺字段、错误类型或错误成功码。
 */
const fs = require('fs');
const path = require('path');
const { shapeOf, compareShape } = require('./compare-contract-shapes');
const { mapWithdrawInfo } = require('../src/adapter/providers/wgame/http-maps');
const { defaultTaskPayload } = require('../src/adapter/providers/wgame/popup-config');
const { getSeries } = require('../src/adapter/series');

const root = path.join(__dirname, '..');
const catalogPath = process.env.OFFICIAL_CONTRACT_CATALOG
  ? path.resolve(process.env.OFFICIAL_CONTRACT_CATALOG)
  : path.join(root, 'logs', 'official-shapes', 'catalog.json');

function main() {
  if (!fs.existsSync(catalogPath)) throw new Error('官方契约不存在: ' + catalogPath);
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const series = getSeries('aniw-lobby');
  const fixtures = {
    '/api/finance/certify/withdrawInfoV2': mapWithdrawInfo({}),
    '/api/active/tasks/task': defaultTaskPayload({ template: 2 }),
    '/api/finance/pay/payTypeV4': series.applyAdapter('payType', {
      ok: true,
      data: { payKind: { list: [{ paymentid: 7, payplatformid: 7, pay_type_name: 'PIX' }] } }
    }).data,
    '/api/finance/pay/payplatformlistV3': series.applyAdapter('payChannels', {
      ok: true,
      data: {
        min: '10',
        max: '500',
        recommendList: [{ amount: '10', give: '0', firstChargeAward: '0' }],
        list: [{
          id: 7,
          paymentid: 7,
          payplatformid: 7,
          merch_desc: 'PIX',
          recommendList: [{ amount: '10', give: '0', firstChargeAward: '0' }]
        }]
      }
    }).data,
    '/api/finance/pay/payListV4': series.applyAdapter('payList', {
      ok: true,
      data: { list: [{ type: 1, name: 'Depósito online', payCurrency: 'BRL' }] }
    }).data,
    '/api/finance/pay/payInfos': series.applyAdapter('payInfos', {
      ok: true,
      data: []
    }).data,
    '/api/active/recharge/financeGiveReward': series.applyAdapter('lobbyOk', {
      ok: true,
      data: { activeList: [], autoActiveList: [] }
    }).data,
    '/api/active/receivedAwardList': series.applyAdapter('awardList', {
      ok: true,
      data: {}
    }).data,
    '/api/agent/promote/report/agentPromotion': series.applyAdapter('agentBlob', {
      ok: true,
      data: { inviteCode: '1', linkList: [{ url: 'https://example.test/?id=1', select: true }] }
    }, { routePath: '/api/agent/promote/report/agentPromotion' }).data,
    '/api/agent/promote/index/agentCommission': series.applyAdapter('agentBlob', {
      ok: true,
      data: {}
    }, { routePath: '/api/agent/promote/index/agentCommission' }).data
  };

  let failed = 0;
  for (const [apiPath, data] of Object.entries(fixtures)) {
    const official = catalog.find((row) => row.path === apiPath);
    if (!official) throw new Error('官方契约缺少: ' + apiPath);
    const differences = [];
    compareShape(official.shape, shapeOf(data, 0), 'data', differences);
    const breaking = differences.filter((row) => row.kind !== 'extra-field' && row.kind !== 'empty-array');
    if (breaking.length) {
      failed++;
      console.error('FAIL', apiPath, JSON.stringify(breaking, null, 2));
    } else {
      console.log('OK  ', apiPath, '(additive/empty differences=' + differences.length + ')');
    }
  }
  if (failed) process.exitCode = 1;
}

try {
  main();
} catch (err) {
  console.error(err && err.stack || err);
  process.exit(1);
}
