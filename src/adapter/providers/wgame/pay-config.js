/**
 * 充值：优先 wgame 大厅真实渠道/下单；也可 providerOptions.pay 占位或 HTTP 收银台。
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_PAY = {
  enabled: true,
  /** wgame=大厅真实渠道/下单；config=本地占位；http=自有 HTTP 收银台 */
  source: 'wgame',
  /** source=wgame 时 wss 下单失败是否回退占位 QR；开发/IP 限注册时可 true */
  allowPlaceholderFallback: false,
  currency: 'BRL',
  currencySign: 'R$',
  categories: [
    {
      type: 1,
      name: 'Online',
      iconUrl: '',
      paymentMode: 0
    }
  ],
  types: [
    {
      id: 900001,
      paymentid: 900001,
      payplatformid: 900001,
      payKind: 100,
      type: 1,
      iconUrl: '',
      name: 'PIX',
      noChannelTopUp: false
    }
  ],
  channelsByPayKind: {
    '100': {
      min: '10',
      max: '50000',
      url: '',
      realInfoRule: 0,
      list: [
        {
          id: 900101,
          payplatformid: 900101,
          paymentid: 900101,
          paymentMethodId: 900101,
          channelId: 900101,
          channelCode: 'pix',
          merchCode: '',
          merch_agent_id: 0,
          merch_desc: 'PIX',
          channlName: 'PIX',
          payCurrency: 'BRL',
          currencySign: 'R$',
          min_recharge_limit: '10',
          max_recharge_limit: '50000',
          recommendList: ['20', '50', '100', '200', '500'],
          iconUrl: '',
          orderEffectiveTime: 900,
          realNameSwitch: 0,
          payment_type: 0,
          channel_type: 0,
          walletType: ''
        }
      ]
    }
  },
  createOrder: {
    mode: 'staticQr',
    /** 占位二维码内容；换成你们收银台 URL 或真实 PIX payload */
    qrPayload: '00020126580014br.gov.bcb.pix0136PLACEHOLDER-REPLACE-ME5204000053039865802BR5925SiteDownloader Pay6009SAO PAULO62070503***6304ABCD',
    qrCodeUrl: '',
    payUrl: '',
    urlOpenWay: 4,
    orderEffectiveTime: 900,
    /** mode=http 时 POST JSON 到 httpUrl，响应可含 qrCode/url/urlOpenWay */
    httpUrl: '',
    httpMethod: 'POST',
    /** 无 httpUrl 时用内置 mock 收银台（开发）；生产请填真实 httpUrl */
    useBuiltinMock: false
  }
};

function loadPayConfig(siteDir, providerOptions) {
  let raw = {};
  try {
    if (providerOptions && providerOptions.pay && typeof providerOptions.pay === 'object') {
      raw = providerOptions.pay;
    } else if (siteDir) {
      const p = path.join(siteDir, 'adapter-hosts.json');
      if (fs.existsSync(p)) {
        const hosts = JSON.parse(fs.readFileSync(p, 'utf8'));
        const po = (hosts && hosts.providerOptions) || (hosts && hosts.wgame) || {};
        if (po.pay && typeof po.pay === 'object') raw = po.pay;
      }
    }
  } catch (_) { /* ignore */ }

  const cfg = Object.assign({}, DEFAULT_PAY, raw || {});
  cfg.categories = Array.isArray(raw.categories) ? raw.categories : DEFAULT_PAY.categories;
  cfg.types = Array.isArray(raw.types) ? raw.types : DEFAULT_PAY.types;
  cfg.channelsByPayKind = Object.assign(
    {},
    DEFAULT_PAY.channelsByPayKind,
    (raw.channelsByPayKind && typeof raw.channelsByPayKind === 'object') ? raw.channelsByPayKind : {}
  );
  cfg.createOrder = Object.assign({}, DEFAULT_PAY.createOrder, raw.createOrder || {});
  if (raw.enabled === false) cfg.enabled = false;
  if (raw.source) cfg.source = String(raw.source);
  if (raw.allowPlaceholderFallback != null) {
    cfg.allowPlaceholderFallback = !!raw.allowPlaceholderFallback;
  } else if (String(cfg.source).toLowerCase() === 'config') {
    cfg.allowPlaceholderFallback = true;
  }
  if (process.env.PAY_HTTP_URL) {
    cfg.createOrder.httpUrl = String(process.env.PAY_HTTP_URL);
    cfg.createOrder.mode = 'http';
    cfg.createOrder.useBuiltinMock = false;
  }
  if (process.env.PAY_USE_BUILTIN_MOCK === '1') {
    cfg.createOrder.useBuiltinMock = true;
  }
  const har = loadHarPaySnapshot(siteDir);
  applyHarPaySnapshot(cfg, har);
  return cfg;
}

function buildQrDataUrl(payload) {
  // 不依赖外网：返回可被 <img> 识别的占位说明（前端优先用 qrCode 字符串画码时可直接用 payload）
  return String(payload || '');
}

function mapWgameChannelsToPack(list, pay) {
  const open = (Array.isArray(list) ? list : []).filter((c) => {
    if (!c) return false;
    if (c.nStatus != null && Number(c.nStatus) === 0) return false;
    return true;
  });
  const mapped = open.map((c) => {
    const id = Number(c.nChannelId) || 0;
    const min = c.llMinMoney != null ? String(c.llMinMoney) : '10';
    const max = c.llMaxMoney != null ? String(c.llMaxMoney) : '50000';
    const name = c.szChannelName || ('CH' + id);
    return {
      id,
      payplatformid: id,
      paymentid: id,
      paymentMethodId: id,
      channelId: id,
      channelCode: String(id),
      merchCode: '',
      merch_agent_id: 0,
      merch_desc: name,
      channlName: name,
      payCurrency: (pay && pay.currency) || 'BRL',
      currencySign: (pay && pay.currencySign) || 'R$',
      min_recharge_limit: min,
      max_recharge_limit: max,
      recommendList: ['20', '50', '100', '200', '500'].filter((x) => {
        const n = Number(x);
        return n >= Number(min) && n <= Number(max);
      }),
      iconUrl: '',
      orderEffectiveTime: 900,
      realNameSwitch: c.kycFlag ? 1 : 0,
      payment_type: 0,
      channel_type: Number(c.nChannelType) || 0,
      walletType: '',
      _wgameUrl: c.szUrl || '',
      _awardRate: c.nAwardRate
    };
  });
  let min = '10';
  let max = '50000';
  if (mapped.length) {
    min = String(Math.min(...mapped.map((m) => Number(m.min_recharge_limit) || 0)));
    max = String(Math.max(...mapped.map((m) => Number(m.max_recharge_limit) || 0)));
  }
  return { list: mapped, min, max, url: '', realInfoRule: 0 };
}

function finalizePayChannelPack(pack, siteDir) {
  return enrichPayChannelPack(pack, loadHarPaySnapshot(siteDir));
}

function loadHarPaySnapshot(siteDir) {
  const candidates = [];
  if (siteDir) candidates.push(path.join(siteDir, 'har-pay-snapshot.json'));
  try {
    const root = path.join(__dirname, '..', '..', '..', '..');
    const siteId = siteDir ? path.basename(siteDir) : '679win';
    candidates.push(path.join(root, 'logs', `har-pay-snapshot-${siteId}.json`));
  } catch (_) { /* ignore */ }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) { /* ignore */ }
  }
  return null;
}

function applyHarPaySnapshot(cfg, har) {
  if (!har || typeof har !== 'object') return cfg;
  if (Array.isArray(har.categories) && har.categories.length) cfg.categories = har.categories;
  if (Array.isArray(har.types) && har.types.length) cfg.types = har.types;
  if (har.channelsByPayKind && typeof har.channelsByPayKind === 'object') {
    cfg.channelsByPayKind = Object.assign({}, cfg.channelsByPayKind, har.channelsByPayKind);
  }
  const pack = cfg.channelsByPayKind && cfg.channelsByPayKind['100'];
  if (pack && Array.isArray(pack.list)) {
    pack.list = pack.list.map((ch) => enrichPayChannelItem(ch, null));
    if (!Array.isArray(pack.recommendList) || !pack.recommendList.length) {
      const first = pack.list[0];
      pack.recommendList = (first && Array.isArray(first.recommendList) && first.recommendList.length)
        ? first.recommendList.slice()
        : ['10', '30', '50', '100', '500', '1000', '5000', '10000'];
    }
  }
  // paysubmitUrl 是收银台页面基址（channelData.url），不是 createOrder.httpUrl JSON API
  return cfg;
}

function enrichPayChannelItem(ch, harRow) {
  const out = Object.assign({}, harRow || {}, ch || {});
  const id = out.id || out.channelId || out.payplatformid;
  if (!out.merch_desc && out.channlName) out.merch_desc = out.channlName;
  if (!out.channlName && out.merch_desc) out.channlName = out.merch_desc;
  if (!out.paymentid && out.payplatformid) out.paymentid = out.payplatformid;
  if (!out.channelTooltip) out.channelTooltip = (harRow && harRow.channelTooltip) || 'HOT';
  if (!out.payicon && harRow && harRow.payicon) out.payicon = harRow.payicon;
  if (!out.openWay && out.openWay !== 0) out.openWay = 4;
  if (!out.id && id) out.id = id;
  return out;
}

function enrichPayChannelPack(pack, har) {
  if (!pack || !Array.isArray(pack.list)) return pack;
  const harList = har && har.channelsByPayKind && har.channelsByPayKind['100']
    && har.channelsByPayKind['100'].list;
  const byId = Object.create(null);
  if (Array.isArray(harList)) {
    for (const row of harList) {
      const id = row.id || row.channelId || row.payplatformid;
      if (id != null) byId[id] = row;
    }
  }
  const sample = har && har.payplatformlistSample && har.payplatformlistSample.list;
  if (Array.isArray(sample)) {
    for (const row of sample) {
      const id = row.id || row.payplatformid;
      if (id != null) byId[id] = Object.assign({}, byId[id] || {}, row);
    }
  }
  pack.list = pack.list.map((ch) => {
    const id = ch.id || ch.channelId || ch.payplatformid;
    return enrichPayChannelItem(ch, byId[id]);
  });
  if (!Array.isArray(pack.recommendList) || !pack.recommendList.length) {
    const first = pack.list[0];
    if (first && Array.isArray(first.recommendList) && first.recommendList.length) {
      pack.recommendList = first.recommendList.slice();
    } else if (har && har.channelsByPayKind && har.channelsByPayKind['100']) {
      const hr = har.channelsByPayKind['100'];
      pack.recommendList = Array.isArray(hr.recommendList) && hr.recommendList.length
        ? hr.recommendList.slice()
        : ['10', '30', '50', '100', '500', '1000', '5000', '10000'];
    }
  }
  return pack;
}

module.exports = {
  DEFAULT_PAY,
  loadPayConfig,
  buildQrDataUrl,
  mapWgameChannelsToPack,
  loadHarPaySnapshot,
  applyHarPaySnapshot,
  enrichPayChannelPack,
  finalizePayChannelPack
};
