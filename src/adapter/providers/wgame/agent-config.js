/**
 * 代理页配置：wgame 无下级协议时，用 providerOptions.agent 驱动展示数据。
 * 默认零态可打开页面；填入真实报表字段后替换。
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_AGENT = {
  enabled: true,
  /** wgame=大厅代理邀请；config=本地零态；http=自有 HTTP */
  source: 'wgame',
  /**
   * 自有代理报表 HTTP：设置 httpBase + routes 后，对应 op 会 POST JSON 拉取并透传 data。
   * 例: httpBase: 'https://agent.example.com', routes: { indexInfo: '/api/indexInfo', ... }
   */
  httpBase: '',
  httpMethod: 'POST',
  /** 无 httpBase 时用内置 mock 报表（开发）；生产请填 httpBase + routes */
  useBuiltinMock: false,
  routes: {
    agentMode: '',
    promoteConfig: '',
    agentPromotion: '',
    indexInfo: '',
    myTotalData: '',
    myPeriodData: '',
    myCommission: '',
    commissionMarquee: '',
    getIpBindInfo: '',
    directReport: '',
    teamDataV2: '',
    myCommissionDetail: '',
    myPerformance: '',
    myPerformanceDetail: '',
    clubCommission: '',
    clubCommissionDetail: '',
    clubPerformance: '',
    clubPerformanceUser: '',
    directFin: '',
    memberInfo: '',
    bindingReport: ''
  },
  agentMode: {
    agent_id: 0,
    agentModeName: 'Infinite',
    settleDuration: 0,
    settleDurationDays: 1,
    settleDurationCustom: '',
    nextSettleTime: 0,
    isProAgent: false
  },
  promoteConfig: {
    agent_levels: [],
    sign_key: ''
  },
  agentPromotion: {
    linkList: [{ select: true, url: '', name: 'default' }]
  },
  indexInfo: {
    todayDirect: 0,
    todayTeam: 0,
    todayCommission: '0',
    totalDirect: 0,
    totalTeam: 0,
    totalCommission: '0',
    directCount: 0,
    teamCount: 0,
    totalPerformance: '0',
    agentLevel: 0,
    parentUsername: '',
    parentUserIdx: 0,
    auditRate: '0'
  },
  myTotalData: {
    totalCommission: '0',
    totalCommissionNum: 0,
    totalPerformance: '0',
    totalDirect: 0,
    totalTeam: 0,
    directCount: 0,
    teamCount: 0,
    availableCommission: '0',
    todayCommission: '0',
    yesterdayCommission: '0'
  },
  myPeriodData: {
    list: [],
    total: 0,
    records: [],
    totalCommission: '0',
    totalPerformance: '0'
  },
  myCommission: {
    list: [],
    total: 0,
    records: [],
    sum: '0',
    totalCommission: '0',
    totalCommissionNum: 0,
    clubCommission: '0',
    clubCommissionNum: 0
  },
  commissionMarquee: [],
  getIpBindInfo: {
    bind: false,
    list: []
  },
  bindingReport: {
    list: [],
    total: 0
  },
  directReport: {
    list: [],
    total: 0,
    records: []
  }
};

function loadAgentConfig(siteDir, providerOptions) {
  let raw = {};
  try {
    if (providerOptions && providerOptions.agent && typeof providerOptions.agent === 'object') {
      raw = providerOptions.agent;
    } else if (siteDir) {
      const p = path.join(siteDir, 'adapter-hosts.json');
      if (fs.existsSync(p)) {
        const hosts = JSON.parse(fs.readFileSync(p, 'utf8'));
        const po = (hosts && hosts.providerOptions) || {};
        if (po.agent && typeof po.agent === 'object') raw = po.agent;
      }
    }
  } catch (_) { /* ignore */ }

  const cfg = Object.assign({}, DEFAULT_AGENT, raw || {});
  cfg.agentMode = Object.assign({}, DEFAULT_AGENT.agentMode, raw.agentMode || {});
  cfg.promoteConfig = Object.assign({}, DEFAULT_AGENT.promoteConfig, raw.promoteConfig || {});
  cfg.agentPromotion = Object.assign({}, DEFAULT_AGENT.agentPromotion, raw.agentPromotion || {});
  cfg.indexInfo = Object.assign({}, DEFAULT_AGENT.indexInfo, raw.indexInfo || {});
  cfg.myTotalData = Object.assign({}, DEFAULT_AGENT.myTotalData, raw.myTotalData || {});
  cfg.myPeriodData = Object.assign({}, DEFAULT_AGENT.myPeriodData, raw.myPeriodData || {});
  cfg.myCommission = Object.assign({}, DEFAULT_AGENT.myCommission, raw.myCommission || {});
  cfg.getIpBindInfo = Object.assign({}, DEFAULT_AGENT.getIpBindInfo, raw.getIpBindInfo || {});
  cfg.bindingReport = Object.assign({}, DEFAULT_AGENT.bindingReport, raw.bindingReport || {});
  cfg.directReport = Object.assign({}, DEFAULT_AGENT.directReport, raw.directReport || {});
  if (Array.isArray(raw.commissionMarquee)) cfg.commissionMarquee = raw.commissionMarquee;
  if (raw.enabled === false) cfg.enabled = false;
  if (raw.httpBase) cfg.httpBase = String(raw.httpBase);
  if (raw.httpMethod) cfg.httpMethod = String(raw.httpMethod);
  if (raw.source) cfg.source = String(raw.source);
  if (raw.useBuiltinMock != null) cfg.useBuiltinMock = !!raw.useBuiltinMock;
  cfg.routes = Object.assign({}, DEFAULT_AGENT.routes, raw.routes || {});
  if (process.env.AGENT_HTTP_BASE) {
    cfg.httpBase = String(process.env.AGENT_HTTP_BASE);
    cfg.useBuiltinMock = false;
  }
  if (process.env.AGENT_USE_BUILTIN_MOCK === '1') {
    cfg.useBuiltinMock = true;
  }
  const har = loadHarAgentSnapshot(siteDir);
  if (har && har.agent) {
    const keys = [
      'indexInfo', 'myTotalData', 'myCommission', 'agentPromotion',
      'agentMode', 'promoteConfig', 'getIpBindInfo'
    ];
    for (const key of keys) {
      if (har.agent[key] && typeof har.agent[key] === 'object') {
        cfg[key] = Object.assign({}, cfg[key] || {}, har.agent[key]);
      }
    }
  }
  return cfg;
}

function loadHarAgentSnapshot(siteDir) {
  const candidates = [];
  if (siteDir) candidates.push(path.join(siteDir, 'har-agent-snapshot.json'));
  try {
    const root = path.join(__dirname, '..', '..', '..', '..');
    const siteId = siteDir ? path.basename(siteDir) : '679win';
    candidates.push(path.join(root, 'logs', `har-agent-snapshot-${siteId}.json`));
  } catch (_) { /* ignore */ }
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) { /* ignore */ }
  }
  return null;
}

/** 把 wgame 代理邀请结构映到 aniw 报表零态字段 */
function mapProxyInviteToAgent(invite, base) {
  const out = Object.assign({}, base || {});
  if (!invite || typeof invite !== 'object') return out;
  const coin = 1000;
  const todayBonus = invite.llTodayInviteBonus != null
    ? String(Number(invite.llTodayInviteBonus) / coin)
    : out.indexInfo && out.indexInfo.todayCommission;
  const yesBonus = invite.llYesInviteBonus != null
    ? String(Number(invite.llYesInviteBonus) / coin)
    : '0';
  const direct = invite.nDirectCount != null ? Number(invite.nDirectCount) : 0;
  const todayDirect = invite.nTodayValidInviteCount != null
    ? Number(invite.nTodayValidInviteCount)
    : 0;
  const code = invite.szInviteCode || '';

  out.indexInfo = Object.assign({}, (base && base.indexInfo) || {}, {
    todayDirect,
    todayTeam: todayDirect,
    todayCommission: todayBonus != null ? String(todayBonus) : '0',
    totalDirect: direct,
    totalTeam: direct,
    totalCommission: yesBonus,
    directCount: direct,
    teamCount: direct,
    totalPerformance: yesBonus
  });
  out.myTotalData = Object.assign({}, (base && base.myTotalData) || {}, {
    totalCommission: yesBonus,
    totalCommissionNum: invite.nValidInviteCount != null ? Number(invite.nValidInviteCount) : 0,
    totalPerformance: yesBonus,
    totalDirect: direct,
    totalTeam: direct,
    directCount: direct,
    teamCount: direct,
    availableCommission: todayBonus != null ? String(todayBonus) : '0',
    todayCommission: todayBonus != null ? String(todayBonus) : '0',
    yesterdayCommission: yesBonus
  });
  out.agentPromotion = Object.assign({}, (base && base.agentPromotion) || {}, {
    inviteCode: code,
    linkList: [
      {
        select: true,
        url: '',
        name: 'invite',
        code
      }
    ]
  });
  out._proxyInvite = invite;
  return out;
}

/** mock/零态时补邀请码与分享链接，避免代理页空白 */
function enrichAgentFromSession(agent, sessionUser, siteDir) {
  if (!agent || !sessionUser) return agent;
  const out = Object.assign({}, agent);
  const promo = Object.assign({}, out.agentPromotion || {});
  const links = Array.isArray(promo.linkList) ? promo.linkList.slice() : [];
  const hasUrl = links.some((row) => row && row.url);
  if (hasUrl && promo.inviteCode) return out;

  let baseUrl = '';
  try {
    if (siteDir) {
      const hosts = JSON.parse(fs.readFileSync(path.join(siteDir, 'adapter-hosts.json'), 'utf8'));
      baseUrl = String((hosts && hosts.upstreamOrigin) || '').replace(/\/$/, '');
    }
  } catch (_) { /* ignore */ }
  const code = String(promo.inviteCode || sessionUser.userId || sessionUser.account || '');
  const inviteUrl = baseUrl && code ? `${baseUrl}/?id=${encodeURIComponent(code)}` : (baseUrl || '');
  promo.inviteCode = code;
  promo.linkList = [
    {
      select: true,
      url: inviteUrl,
      name: 'invite',
      code
    }
  ];
  out.agentPromotion = promo;
  return out;
}

/** migration-map 中 EMPTY_RECORDS 的代理列表接口 → routes 键 */
const AGENT_EXTRA_BY_PATH = {
  '/api/agent/promote/report/teamDataV2': 'teamDataV2',
  '/api/agent/promote/report/clubCommission': 'clubCommission',
  '/api/agent/promote/report/clubCommissionDetail': 'clubCommissionDetail',
  '/api/agent/promote/report/clubPerformance': 'clubPerformance',
  '/api/agent/promote/report/clubPerformanceUserV1': 'clubPerformanceUser',
  '/api/agent/promote/report/myCommissionDetailV3': 'myCommissionDetail',
  '/api/agent/promote/report/myPerformanceV2': 'myPerformance',
  '/api/agent/promote/report/myPerformanceDetailV2': 'myPerformanceDetail',
  '/api/agent/promote/report/directFinV4': 'directFin',
  '/api/agent/promote/report/memberInfo': 'memberInfo',
  '/api/agent/promote/binding/reportViewV2': 'bindingReport'
};

function resolveAgentExtraRoute(routePath, agent) {
  const key = AGENT_EXTRA_BY_PATH[routePath];
  if (!key) return null;
  const route = agent && agent.routes && agent.routes[key];
  if (!route) return null;
  return { key, route: String(route) };
}

function emptyAgentListData(key) {
  const base = { list: [], total: 0, records: [], rows: [] };
  if (key === 'bindingReport') {
    return { code: 0, reason: '', promoterUserIdx: 0 };
  }
  if (key === 'memberInfo') return {};
  return base;
}

module.exports = {
  DEFAULT_AGENT,
  loadAgentConfig,
  loadHarAgentSnapshot,
  mapProxyInviteToAgent,
  enrichAgentFromSession,
  AGENT_EXTRA_BY_PATH,
  resolveAgentExtraRoute,
  emptyAgentListData
};
