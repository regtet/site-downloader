/**
 * 根据 dist-api-gaps 自动扩展 safe-bulk-map.js（不覆盖已有 key）
 * 用法: node scripts/expand-safe-bulk.js [679win]
 */
const fs = require('fs');
const path = require('path');
const { OP } = require('../src/adapter/ops');
const { MIGRATION_MAP } = require('../src/adapter/series/aniw-lobby/migration-map');
const { SAFE_BULK_MAP } = require('../src/adapter/series/aniw-lobby/safe-bulk-map');

const siteId = process.argv[2] || '679win';
const gapsPath = path.join(__dirname, '..', 'logs', `dist-api-gaps-${siteId}.json`);
const outPath = path.join(__dirname, '..', 'src', 'adapter', 'series', 'aniw-lobby', 'safe-bulk-map.js');

const gaps = JSON.parse(fs.readFileSync(gapsPath, 'utf8'));
const actionable = gaps.actionable || [];

function classify(p) {
  if (/\.json$/i.test(p) || /\/lobby\//i.test(p)) return null;
  // 代理：无下级数据 → 明确 pending（禁止空壳团队）
  if (/\/agent\//i.test(p)) {
    return { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'auto-agent-pending' };
  }
  // VIP 全量表由 CORE 精确声明；此处跳过避免 bulk 覆盖策略漂移
  if (/vipInfoV2|vipInfoUnLogin/i.test(p)) return null;

  if (
    /\/(receive|redeem|bind|login|Register|tgLogin|localLogin|apiLogin|createQrcode|upload|lottery|turn|betToGame|doMatchBet|tip$|like$|follow$|geetest|biometric|nowallet|telegram|WebAuthn|changePass|forceChange|temporaryAccount|thirdParty|shortMsg\/create|applyClaim|cancelOrder|changeEmail|evaluate|postArticle|verifyDiscount|delUserDevice|editQuint|creatEmail|check\/cpf|checkBMM|kyc|giftRecv|apply$|uploadFile|payBank|blindBox|resetPass|verifyPhone|verifyEmail|verifyGoogle|verifyLogin|verifyModify|verifyWithdraw|actionVerify|createSms|modifyPhone|modifyWithdraw|switchGoogle|unBind|passQuint|upgrade|updateUser|update$|setIdleDays|payCancel|payConfirm|transferCancel|transferConfirm|offlineOrder|delPayInfo|wallet\/no\/buy|settle$|attribution\/submit|restrict$)/i.test(
      p
    )
  ) {
    if (/\/finance\/certify\//i.test(p) && /bind|cash|withdraw|Wallet|alipay|card|Fee|Password|upload/i.test(p)) {
      return { op: OP.WITHDRAW_PENDING, adapter: 'withdrawPending', note: 'auto-withdraw' };
    }
    if (/\/finance\/pay|payplatform|NOPayList|getPayOrderFee|offlineOrder|transfer|payPopup|uploadpay|payBank|wallet\/no\/buy/i.test(p)) {
      return { op: OP.PAY_PENDING, adapter: 'payPending', note: 'auto-pay' };
    }
    return { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'auto-pending' };
  }
  if (
    /\/(list|logs|Record|History|announcement|search|favorites|homePage|summary|detail|Info|query|report|betsummary|country|setting|product|winningRecords|TaskList|AwardList|ratiotable|boxs|activityRecords|inviteMembers|publisher|listShare|all$|get$|getByTemplate|getRanking|getred|getReceive|getDiscount|getDefault|pinAudit|orderInfo|optTypes|svip|turntable|tgPage|tgDetails|shop|rechargeFund|coupon|unreceive|received|expire|matchBet|lucky|my_logs|promote_details|request_details|activeTask|allVip|cut_a_deal|chop_one_knife|category|withdrawInfo|withdrawTask|claimDetail|claimRecord|manualDeduction|unreadMsgCnt|withdrawAccount|smsCountry|wordSettle|getAllActive|pkg\/list|contact\/list|gameRate|logo|queryUnique|dealTypeList|margin|isApplyOpen|applyInfo|selfOrderInfo|waitingCount|match\/|hotList|liveGame|liveVideo|gameVersion|platform-category|findListAll|accountPageList|accountTotal|accountDetail|walletTypes|dealTypes|getUserNoWallet|getOptionList|getAccountVerify|userDeviceList|yuebao|adInfo|point\/get|PreparedInline|payTypeSetting|content$|NOPayList|orderList)/i.test(
      p
    )
  ) {
    return { op: OP.EMPTY_RECORDS, adapter: 'emptyRecords', note: 'auto-empty' };
  }
  if (
    /\/(pop|click|status|reportWarn|read|refresh|hasPop|noTipping|checkUserBet|staffAll|getSysInfo|behaviorValidate|postingRestrictions|changeIsOverFlag|readall|event\/collect|attribution\/match|rechargePopup|confirmMsgPop)/i.test(
      p
    )
    && !/\/(cancelOrder|setdefault|rejectManual|cancelFavorites|cancelFollow|cancelLike|delete|delall|customDel)\b/i.test(p)
  ) {
    return { op: OP.LOBBY_OK, adapter: 'lobbyOk', note: 'auto-ok' };
  }
  // 写操作误进 ok 的兜底
  if (/\/(cancel|delete|delall|setdefault|rejectManual|customDel)\b/i.test(p)) {
    return { op: OP.FEATURE_PENDING, adapter: 'featurePending', note: 'auto-pending-write' };
  }
  return null;
}

const merged = Object.assign({}, SAFE_BULK_MAP);
let added = 0;
const skipped = [];
for (const p of actionable) {
  if (MIGRATION_MAP[p] || merged[p]) continue;
  const c = classify(p);
  if (!c) {
    skipped.push(p);
    continue;
  }
  merged[p] = c;
  added += 1;
}

const lines = [
  '/**',
  ' * 自动扩展的安全批量映射（expand-safe-bulk.js 生成/合并）',
  ' * CORE_MAP 精确条目优先覆盖本表。',
  ' */',
  "const { OP } = require('../../ops');",
  '',
  'function entry(op, adapter, note) {',
  "  return { op, adapter, note: note || '' };",
  '}',
  '',
  "const EMPTY = entry(OP.EMPTY_RECORDS, 'emptyRecords', 'bulk-empty');",
  "const OK = entry(OP.LOBBY_OK, 'lobbyOk', 'bulk-ok');",
  "const FEAT = entry(OP.FEATURE_PENDING, 'featurePending', 'bulk-pending');",
  "const WD = entry(OP.WITHDRAW_PENDING, 'withdrawPending', 'bulk-withdraw');",
  "const PAY = entry(OP.PAY_PENDING, 'payPending', 'bulk-pay');",
  '',
  '/** @type {Record<string, { op: string, adapter: string, note?: string }>} */',
  'const SAFE_BULK_MAP = {'
];

const sorted = Object.keys(merged).sort();
for (const p of sorted) {
  const e = merged[p];
  let tok = 'FEAT';
  if (e.adapter === 'emptyRecords') tok = 'EMPTY';
  else if (e.adapter === 'lobbyOk') tok = 'OK';
  else if (e.adapter === 'withdrawPending') tok = 'WD';
  else if (e.adapter === 'payPending') tok = 'PAY';
  lines.push(`  '${p}': ${tok},`);
}
lines.push('};');
lines.push('');
lines.push('module.exports = { SAFE_BULK_MAP };');
lines.push('');

fs.writeFileSync(outPath, lines.join('\n'));
fs.writeFileSync(
  path.join(__dirname, '..', 'logs', `expand-safe-bulk-${siteId}.json`),
  JSON.stringify({ at: new Date().toISOString(), added, totalBulk: sorted.length, skipped: skipped.slice(0, 80), skippedCount: skipped.length }, null, 2)
);
console.log(JSON.stringify({ added, totalBulk: sorted.length, skippedCount: skipped.length }, null, 2));
