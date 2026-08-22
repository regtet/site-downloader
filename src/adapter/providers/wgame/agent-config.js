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
    directReport: ''
  },
  agentMode: {
    agent_id: 0,
    agentModeName: 'Infinite',
    settleDuration: 0,
    settleDurationDays: 1,
    isProAgent: false
  },
  promoteConfig: {
    agent_levels: []
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
    totalPerformance: '0'
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
    totalCommissionNum: 0
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
  cfg.routes = Object.assign({}, DEFAULT_AGENT.routes, raw.routes || {});
  return cfg;
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

module.exports = {
  DEFAULT_AGENT,
  loadAgentConfig,
  mapProxyInviteToAgent
};
