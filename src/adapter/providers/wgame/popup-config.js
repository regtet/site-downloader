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

/** 与官方注册成功弹窗对齐的默认载荷（空数组会让前端只剩标题） */
function defaultRegisterPopupPayload() {
  // jumpType: Event=0 Task=1 URL=2 Download=3 Recharge=10
  // Download(3) → install-button 描边样式（Baixar APP）；需 getAppDownloadInfo 有 Normal 列表
  // URL(2)+ghost 会变成「主色字+主色底」导致「Baixar APP」文字看不见
  return {
    content:
      '<p style="text-align:center;"><span style="font-family: \'Segoe UI\';">'
      + '🎉Parabéns por se cadastrar!✅<br>'
      + '💲Ganhe até 777 de bônus no seu primeiro depósito.<br>'
      + '💥Jogue agora!💥'
      + '</span></p>',
    activeList: '{}',
    buttons: [
      {
        jumpType: 3,
        title: 'Baixar APP',
        tip: 'Ganhe R$777',
        downloadTypeIos: 2,
        downloadTypeAndroid: 2
      },
      {
        jumpType: 10,
        title: 'Deposite agora',
        tip: 'Bônus de depósito'
      }
    ]
  };
}

/** /api/lobby/config/getAppDownloadInfo —— 给注册弹窗 Download 按钮提供可渲染列表 */
function defaultAppDownloadPayload() {
  const languages = 'pt,en,es,zh,zh_hk,hi,id,vi,th,ja,ko,ru,tr,ar,de,fr,it';
  return {
    downloadList: [
      {
        type: 2,
        language: languages,
        url: '/?download=android',
        size: 1,
        sizeFormat: ''
      },
      {
        type: 1,
        language: languages,
        url: '/?download=ios',
        size: 1,
        sizeFormat: ''
      }
    ]
  };
}

/**
 * /api/active/tasks/task —— 喂给 dist 已有 taskSeries（Diário）弹窗。
 * template: newBenefits=1 taskDaily=2 taskWeekly=3 taskMystery=4
 * afterLoginPopType: never=0 onceDay=1 constantly=2
 * status: Goto=0（列表过滤只保留 Goto/Pending*）
 * 日任务 icon → task_czdm_${icon}；10 = inviteWithfirstCharge
 */
function defaultTaskPayload(body) {
  const template = Number((body && (body.template != null ? body.template : body.taskType)) || 2);
  const taskId = Number((body && body.taskId) || template || 2);
  const userLevel =
    '1,2,3,4,5,6,7,8,9,10,11,10006,10008,10009,10010,10011,10005,10013,10001';

  if (template !== 2) {
    return {
      template,
      taskId,
      taskName: '',
      afterLoginPopType: 0,
      beforeLoginPopType: 0,
      userLevel,
      rules: []
    };
  }

  const levels = [
    { max: 5, brisk: 50 },
    { max: 4, brisk: 40 },
    { max: 3, brisk: 30 },
    { max: 2, brisk: 20 }
  ];

  return {
    template: 2,
    taskId,
    taskName: 'Diário',
    afterLoginPopType: 0,
    beforeLoginPopType: 0,
    userLevel,
    seconds: 9 * 3600 + 19 * 60 + 9,
    rules: levels.map((lv, idx) => ({
      ruleid: idx + 1,
      // 日任务 icon→task_czdm_10 = inviteWithfirstCharge → 文案「Convidar amigos」
      icon: 10,
      // desc 槽位读 rule.name 作为主标题
      name: 'Convidar amigos',
      nameExt: 'Concluir primeiro depósito',
      progress: 0,
      max: lv.max,
      // 绿色闪电图标：award-info 用 bonusEnum=Activity(1) + brisk 数值
      brisk: lv.brisk,
      bonusEnum: 1,
      bonusBigEnum: 0,
      status: 0,
      btnStatus: 0,
      logCategory: 0,
      receiveLogId: 0,
      extraReceiveLogId: 0,
      extraStatus: 0,
      receiveDuration: 0,
      periodTime: 0,
      canReceiveTime: 0,
      receiveTimeType: 0
    }))
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
  defaultTaskPayload
};
