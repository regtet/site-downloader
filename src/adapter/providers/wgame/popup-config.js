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
  defaultAppDownloadPayload
};
