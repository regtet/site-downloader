/**
 * 从 679win.com.har 提取真实充值渠道快照，供 pay-config 加载。
 * 用法: node scripts/extract-har-pay.js [siteId] [harPath]
 */
const fs = require('fs');
const path = require('path');

const siteId = process.argv[2] || '679win';
const harPath = process.argv[3] || path.join(process.env.USERPROFILE || '', 'Downloads', '679win.com.har');
const outDir = path.join(__dirname, '..', 'output', siteId);
const outPath = path.join(outDir, 'har-pay-snapshot.json');
const logPath = path.join(__dirname, '..', 'logs', `har-pay-snapshot-${siteId}.json`);

function normPath(url) {
  let u = String(url || '').split('?')[0];
  u = u.replace(/^https?:\/\/[^/]+/i, '');
  if (u.startsWith('/hall/api/')) u = u.slice('/hall'.length);
  return u;
}

function main() {
  if (!fs.existsSync(harPath)) {
    console.error('HAR not found:', harPath);
    process.exit(1);
  }
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  let best = null;
  for (const e of har.log.entries || []) {
    const p = normPath(e.request.url);
    if (p !== '/api/finance/pay/payplatformlistV3') continue;
    if (e.request.method !== 'POST') continue;
    let data = null;
    try {
      const j = JSON.parse(e.response.content && e.response.content.text || '');
      data = j && j.data;
    } catch (_) { /* ignore */ }
    if (!data || !Array.isArray(data.list) || !data.list.length) continue;
    if (!best || data.list.length > best.list.length) best = data;
  }
  if (!best) {
    console.error('No payplatformlistV3 JSON in HAR');
    process.exit(1);
  }

  const snapshot = {
    extractedAt: new Date().toISOString(),
    sourceHar: harPath,
    paysubmitUrl: best.url || '',
    siteCode: '12025',
    categories: [
      { type: 1, name: best.name || 'Online', iconUrl: '', paymentMode: 0 }
    ],
    types: [
      {
        id: best.paymentid || best.list[0].paymentid,
        paymentid: best.paymentid || best.list[0].paymentid,
        payplatformid: best.paymentid || best.list[0].paymentid,
        payKind: 100,
        type: 1,
        iconUrl: '',
        name: best.pay_type_name || best.payment_name || 'PIX',
        noChannelTopUp: false
      }
    ],
    channelsByPayKind: {
      '100': {
        min: String(best.min_recharge_limit != null ? best.min_recharge_limit : best.min || '10'),
        max: String(best.max_recharge_limit != null ? best.max_recharge_limit : best.max || '50000'),
        url: best.url || '',
        realInfoRule: 0,
        list: best.list.map((ch) => ({
          id: ch.id || ch.payplatformid,
          payplatformid: ch.payplatformid || ch.id,
          paymentid: ch.paymentid || best.paymentid,
          paymentMethodId: ch.payplatformid || ch.id,
          channelId: ch.id || ch.payplatformid,
          channelCode: ch.channelCode || '',
          merchCode: ch.merchCode || '',
          merch_agent_id: ch.merch_agent_id || 0,
          merch_desc: ch.merch_desc || ch.title || '',
          channlName: ch.merch_desc || ch.title || '',
          payCurrency: ch.payCurrency || 'BRL',
          currencySign: ch.currencySign || 'R$',
          min_recharge_limit: String(ch.min_recharge_limit || '10'),
          max_recharge_limit: String(ch.max_recharge_limit || '50000'),
          recommendList: (ch.recommendList || ch.money_btns || []).map((r) => String(r.amount || r)),
          channelTooltip: ch.channelTooltip || 'HOT',
          payicon: ch.payicon || ch.app_type || '',
          iconUrl: '',
          orderEffectiveTime: best.orderEffectiveTime || 1800,
          realNameSwitch: ch.realNameSwitch || 0,
          payment_type: Number(ch.payment_type) || 0,
          channel_type: 0,
          walletType: ch.walletType || '',
          openWay: ch.openWay || 4
        })),
        recommendList: (best.recommendList && best.recommendList.length)
          ? best.recommendList.map((r) => String(r))
          : ['10', '30', '50', '100', '500', '1000', '5000', '10000']
      }
    },
    payplatformlistSample: best
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  const json = JSON.stringify(snapshot, null, 2);
  fs.writeFileSync(outPath, json);
  fs.writeFileSync(logPath, json);
  console.log(JSON.stringify({
    ok: true,
    outPath,
    logPath,
    channelCount: snapshot.channelsByPayKind['100'].list.length,
    paysubmitUrl: snapshot.paysubmitUrl
  }, null, 2));
}

main();
