/**
 * 注册/下载弹窗：结构化 JSON（优先）或 HAR 加密体 / OSS 快照
 *
 * 官方 registerPopupDlgInfo.data 形状（register-recharge 弹窗）：
 * {
 *   content: html,
 *   activeList: jsonString | object,
 *   buttons: [{ jumpType, title, tip, jumpUrl?, jumpId? }]
 * }
 * jumpType: Event=0 Task=1 URL=2 Download=3 Recharge=10
 */
const path = require('path');
const fs = require('fs');

/**
 * WGame 没有对应活动时返回关闭态，而不是伪造营销文案。
 * 保留字段形状，避免旧版 dist 解构时报错；空 content/buttons 不会生成可操作弹窗。
 */
function defaultRegisterPopupPayload() {
  return {
    content: '',
    activeList: '{}',
    buttons: []
  };
}

/** /api/lobby/config/getAppDownloadInfo —— 无真实安装包配置时不输出伪链接。 */
function defaultAppDownloadPayload() {
  return {
    downloadList: [],
    androidBackupLink: '',
    androidList: [],
    appIcon: '',
    appNameLanguage: [],
    installTutorial: [],
    iosBackupLink: '',
    onlineService: '',
    pwaPromoImage: '',
    pwaStyle: 0,
    seoSwitch: 0,
    tutorialEnterprise: '',
    tutorialEnterpriseSys: '',
    tutorialIos: '',
    tutorialIosSys: '',
    tutorialSuperSys: '',
    tutorialTfSys: '',
    tutorialTfUrl: '',
    tutorialUrl: ''
  };
}

/** 下载按钮只指向 wgame_web 配置里的安装包，不带官方站名和客服。 */
function appDownloadPayload() {
  const base = defaultAppDownloadPayload();
  let apk = '';
  let label = '';
  try {
    const { loadWgameWebConfig } = require('./wgame-web-config');
    const { ownSiteLabel } = require('./public-brand');
    const live = loadWgameWebConfig();
    apk = String(live && live.appDownPath || '').trim();
    label = ownSiteLabel();
  } catch (_) { /* 没有实时配置就保持空下载 */ }
  if (!/^https?:\/\//i.test(apk)) return base;
  return Object.assign(base, {
    appNameLanguage: label ? [{ key: 'pt', value: label }] : [],
    androidList: [{ downloadPath: apk, size: 0, type: 1, version: '' }],
    downloadList: [
      { language: 'pt', name: '', signType: 1, type: 1, value: apk },
      { language: 'pt', name: '', signType: 1, type: 2, value: apk }
    ]
  });
}

/**
 * /api/active/tasks/task —— 没有 WGame 活动源时返回结构化关闭态。
 * template: newBenefits=1 taskDaily=2 taskWeekly=3 taskMystery=4
 * afterLoginPopType: never=0 onceDay=1 constantly=2
 * 完整零态字段用于兼容不同版本 dist 的解构逻辑。
 */
function defaultTaskPayload(body) {
  const template = Number((body && (body.template != null ? body.template : body.taskType)) || 2);
  const taskId = Number((body && body.taskId) || template || 2);
  const userLevel =
    '1,2,3,4,5,6,7,8,9,10,11,10006,10008,10009,10010,10011,10005,10013,10001';

  return {
    startTime: 0,
    endTime: 0,
    content: '',
    cycleType: 1,
    oneClick: 0,
    multiple: 0,
    isDefaultRule: 1,
    translateRuleText: '',
    taskTime: '',
    taskCondition: '',
    template,
    taskId,
    taskName: '',
    afterLoginPopType: 0,
    beforeLoginPopType: 0,
    userLevel,
    seconds: 0,
    rules: [],
    withdrawTip: '',
    receiveDeviceType: '',
    receiveDeviceLoginType: '',
    receiveCondition: '{}',
    ruleTextData: {
      audit: '0',
      auditIsExcludeMode: false,
      auditNum: 0,
      auditPlat: '',
      giveType: 0,
      moreLimitStr: '',
      receiveDeviceType: '',
      withdrawRate: '0',
      withdrawRateNum: 0,
      withdrawTaskSettings: '[]',
      withdrawType: ''
    }
  };
}

function readJsonSafe(p) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { /* ignore */ }
  return null;
}

function snapshotCandidates(siteDir) {
  const root = path.join(__dirname, '..', '..', '..', '..');
  const siteId = siteDir ? path.basename(path.resolve(siteDir)) : '679win';
  const candidates = [];
  if (siteDir) candidates.push(path.join(siteDir, 'har-popup-snapshot.json'));
  candidates.push(path.join(root, 'logs', `har-popup-snapshot-${siteId}.json`));
  return candidates;
}

function loadPopupSnapshot(siteDir) {
  for (const p of snapshotCandidates(siteDir)) {
    const j = readJsonSafe(p);
    if (j && j.endpoints) return j;
  }
  return null;
}

function normPath(pathname) {
  let p = String(pathname || '');
  if (p.startsWith('/hall/api/')) p = p.slice('/hall'.length);
  return p.split('?')[0];
}

function getPopupBody(siteDir, pathname, method) {
  const snap = loadPopupSnapshot(siteDir);
  if (!snap || !snap.endpoints) return null;
  const p = normPath(pathname);
  const m = String(method || 'POST').toUpperCase();
  const keys = [m + ' ' + p];
  if (p === '/api/member/registerPopupDlgInfo') {
    keys.push(m + ' /api/member/user/registerPopupDlgInfo');
  }
  for (const key of keys) {
    const row = snap.endpoints[key];
    if (row && row.body != null) {
      return {
        body: String(row.body),
        contentType: row.contentType || 'text/plain; charset=utf-8'
      };
    }
  }
  return null;
}

module.exports = {
  loadPopupSnapshot,
  getPopupBody,
  snapshotCandidates,
  defaultRegisterPopupPayload,
  defaultAppDownloadPayload,
  appDownloadPayload,
  defaultTaskPayload
};
