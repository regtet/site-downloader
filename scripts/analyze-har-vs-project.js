/**
 * 用源站 HAR 作基准，对照本地 migration-map / Adapter 推断依赖与缺口
 * （无需本地 HAR：本地侧按项目当前实现推演）
 *
 *   node scripts/analyze-har-vs-project.js <source.har> [siteId]
 */
const fs = require('fs');
const path = require('path');
const {
  analyzePair,
  lookupMigration,
  normalizePath,
  classifyPage,
  mergeEntries,
  STATUS
} = require('../src/post-login-deps');
const { parseNetworkDump, assessCaptureQuality } = require('../src/post-login-capture');
const { memberProfile } = require('../src/adapter/series/aniw-lobby/adapters');
const { toSiteId, outputDir } = require('./site-paths');

function synthesizeLocalFromProject(sourceCapture) {
  const entries = [];
  for (const e of mergeEntries(sourceCapture.entries || [])) {
    if (String(e.method || '').toUpperCase() === 'OPTIONS') continue;

    const mapped = lookupMigration(e.pathname);
    const srcEncrypted = isEncryptedPayload(e);

    if (!mapped) {
      entries.push({
        url: e.url,
        method: e.method,
        status: e.status,
        pathname: e.pathname,
        pageCategory: classifyPage(e.pathname),
        contentType: e.contentType || '',
        bridge: null,
        code: null,
        msg: 'project:unmapped-passthrough',
        dataKeys: [],
        data: null,
        synthetic: true,
        syntheticKind: 'unmapped',
        sourceEncrypted: srcEncrypted
      });
      continue;
    }

    let data = null;
    if (mapped.adapter === 'memberProfile') {
      const src = (!srcEncrypted && e.data && typeof e.data === 'object') ? e.data : {};
      data = memberProfile({
        account: src.username || src.account || src.nickname || 'u',
        session: src.session_key || src.jwt_token || src.token || 's',
        userId: src.user_id || src.userid || src.userkey || 1,
        game_gold: src.game_gold != null ? src.game_gold : 0,
        nickname: src.nickname || src.username || null,
        phone: src.phone || src.mobile_phone || null,
        email: src.email || null,
        vip_level: src.vip_level != null ? src.vip_level : null,
        face_id: src.portrait_id || src.headimg || src.avatar || src.face_id || null,
        account_type: src.account_type != null ? src.account_type : null,
        currency: src.currency || null,
        first_login: src.bFirstLogin,
        has_recharge: src.bHasRecharge,
        device_id: src.deviceFingerprint || null
      });
    } else if (mapped.adapter === 'walletGold') {
      const src = (!srcEncrypted && e.data && typeof e.data === 'object') ? e.data : {};
      const gold = Number(src.game_gold != null ? src.game_gold : (src.totalGold != null ? src.totalGold : 0));
      data = { game_gold: gold, totalGold: gold, availableMargin: gold };
    } else if (mapped.adapter === 'checkRegister') {
      data = { exists: false };
    }

    entries.push({
      url: e.url,
      method: e.method,
      status: 200,
      pathname: e.pathname,
      pageCategory: classifyPage(e.pathname),
      contentType: 'application/json',
      bridge: 'migration-bridge',
      code: 1,
      msg: srcEncrypted ? 'source-encrypted:field-unverified' : '',
      topKeys: ['code', 'msg', 'data'],
      dataKeys: data ? Object.keys(data) : [],
      data,
      body: { code: 1, msg: '', data },
      synthetic: true,
      syntheticKind: 'adapter',
      sourceEncrypted: srcEncrypted,
      mapped
    });
  }
  return {
    pageUrl: 'project://aniw-lobby+wgame',
    login: { ok: true, reason: 'inferred-from-migration-map' },
    entries,
    consoleErrors: []
  };
}

function isEncryptedPayload(e) {
  if (!e) return false;
  if (e.topKeys && e.topKeys.length === 1 && e.topKeys[0] === 'encryptString') return true;
  if (e.dataKeys && e.dataKeys.length === 1 && e.dataKeys[0] === 'encryptString') return true;
  if (!e.okJson && e.status === 200 && !(e.dataKeys || []).length && !(e.topKeys || []).length) return true;
  const ct = String(e.contentType || '').toLowerCase();
  if (ct.includes('text/plain') && !(e.dataKeys || []).length) return true;
  return false;
}

function enrichWithSourceFieldDiff(report, sourceCapture) {
  const srcMap = new Map();
  for (const e of mergeEntries(sourceCapture.entries || [])) {
    if (String(e.method || '').toUpperCase() === 'OPTIONS') continue;
    srcMap.set(`${e.method} ${e.pathname}`, e);
  }

  for (const row of report.dependencyTable || []) {
    const src = srcMap.get(`${row.method} ${row.pathname}`);
    if (!src) continue;
    const enc = isEncryptedPayload(src);
    row.sourceEncrypted = enc;

    if (row.mapped && enc) {
      row.status = '已映射（源站响应加密，字段未验证）';
      row.note = `migration-map: ${row.mapped.op}/${row.mapped.adapter}；HAR 中响应为密文，无法核对 nickname/avatar 等字段`;
      continue;
    }

    if (!src.dataKeys || !src.dataKeys.length) continue;
    if (!row.mapped) continue;

    const locKeys = new Set((row.local && row.local.dataKeys) || []);
    const missingVsSource = src.dataKeys.filter((k) => !locKeys.has(k));
    const important = missingVsSource.filter((k) =>
      /nick|user|avatar|portrait|head|vip|gold|session|token|phone|email|currency|account_type|permission|bonus|face/i.test(k)
    );
    if (important.length) {
      row.sourceOnlyImportantFields = important.slice(0, 40);
      if (row.status === STATUS.REPLACED_OK || row.status === '已正确替换') {
        row.status = STATUS.MISSING_FIELDS;
        row.note = `Adapter 已映射，但相对源站 data 仍缺: ${important.slice(0, 12).join(', ')}`;
        row.missingFields = important.slice(0, 40);
      } else if (row.status === STATUS.MISSING_FIELDS || row.status === '请求成功但字段缺失') {
        row.note = `${row.note || ''}；相对源站还缺: ${important.slice(0, 12).join(', ')}`;
      }
    }
  }

  // 重算 summary.byStatus
  const byStatus = {};
  for (const r of report.dependencyTable || []) {
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }
  report.summary.byStatus = byStatus;
  report.harVsProjectFindings = buildFindings(report, sourceCapture);
  report.symptomMap = buildSymptomMap(report);
  return report;
}

function buildSymptomMap(report) {
  const rows = report.dependencyTable || [];
  const rules = [
    {
      symptom: '个人中心昵称异常',
      match: (r) => /\/api\/member\/(login|getfastlogin|user\/info|v2\/user\/info)/i.test(r.pathname)
    },
    {
      symptom: '头像异常',
      match: (r) => /\/api\/member\/(login|getfastlogin|user\/info|avatars)/i.test(r.pathname)
    },
    {
      symptom: 'VIP 异常',
      match: (r) => /vip|allviplevel/i.test(r.pathname)
    },
    {
      symptom: '钱包余额异常',
      match: (r) => /\/api\/gamecenter\/(gold|gameapi\/refreshgold)/i.test(r.pathname)
    },
    {
      symptom: '充值页面无法正常显示 / 支付渠道异常',
      match: (r) => /\/api\/finance\/(pay\/|maxchargerate|paylist|paytype)/i.test(r.pathname)
        && r.status !== STATUS.KEEP_OSS
        && r.status !== '不应该替换，应继续走 OSS/静态资源'
    },
    {
      symptom: '提现相关异常',
      match: (r) => /withdraw|\/api\/finance\/certify/i.test(r.pathname)
    },
    {
      symptom: '登录后配置（应走 OSS）',
      match: (r) => /\/api\/lobby\/(site\/getsiteinfo|webapi\/optimization)|\/api\/backstage\/system\/status/i.test(r.pathname)
    }
  ];

  return rules.map((rule) => {
    const hit = rows.filter(rule.match);
    return {
      symptom: rule.symptom,
      apis: hit.map((r) => ({
        path: r.pathname,
        status: r.status,
        mapped: r.mapped,
        sourceEncrypted: !!r.sourceEncrypted,
        note: r.note
      }))
    };
  });
}

function buildFindings(report, sourceCapture) {
  const rows = report.dependencyTable || [];
  const byCat = {};
  for (const r of rows) {
    byCat[r.pageCategory] = byCat[r.pageCategory] || [];
    byCat[r.pageCategory].push(r);
  }

  const pick = (re) => rows.filter((r) => re.test(r.pathname));

  const loginRows = pick(/\/api\/member\/(login|getfastlogin|user\/info|v2\/user\/info)/i);
  const avatarRows = pick(/avatars|updateuseravatars/i);
  const vipRows = pick(/vip|allviplevel/i);
  const walletRows = pick(/\/api\/gamecenter\/(gold|gameapi\/refreshgold)/i);
  const payRows = pick(/\/api\/finance\/(pay|maxchargerate|paylist|paytype)/i);
  const withdrawRows = pick(/withdraw|certify/i);

  function summarize(title, list, symptom) {
    return {
      title,
      symptom,
      count: list.length,
      items: list.slice(0, 15).map((r) => ({
        path: r.pathname,
        status: r.status,
        note: r.note,
        sourceDataKeys: (r.source && r.source.dataKeys) || [],
        localDataKeys: (r.local && r.local.dataKeys) || [],
        sourceOnlyImportantFields: r.sourceOnlyImportantFields || []
      }))
    };
  }

  return [
    summarize('用户昵称/资料', loginRows, '个人中心昵称异常'),
    summarize('头像', [...loginRows, ...avatarRows], '头像异常'),
    summarize('VIP', vipRows, 'VIP 异常'),
    summarize('钱包余额', walletRows, '钱包余额异常'),
    summarize('充值/支付渠道', payRows, '充值页面无法正常显示'),
    summarize('提现', withdrawRows, '提现相关异常'),
    {
      title: '源站 HAR 质量',
      quality: assessCaptureQuality(sourceCapture, '源站'),
      samplePostLogin: mergeEntries(sourceCapture.entries)
        .filter((e) => /user\/info|gold|paylist|avatars|vip|login/i.test(e.pathname))
        .slice(0, 20)
        .map((e) => ({ path: e.pathname, code: e.code, keys: (e.dataKeys || []).slice(0, 15) }))
    }
  ];
}

function main() {
  const harPath = path.resolve(process.argv[2] || path.join(process.env.USERPROFILE || '', 'Downloads', '679win.com.har'));
  const siteId = toSiteId(process.argv[3] || '679win');
  if (!fs.existsSync(harPath)) {
    console.error('HAR 不存在:', harPath);
    process.exit(1);
  }

  const raw = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const source = parseNetworkDump(raw, harPath);
  source.entries = (source.entries || []).filter((e) => String(e.method || '').toUpperCase() !== 'OPTIONS');
  const q = assessCaptureQuality(source, '源站');
  console.log('源站 HAR:', harPath);
  console.log('质量:', JSON.stringify(q));

  if (!q.useful) {
    console.error('源站 HAR 质量不足（未见登录后业务接口），请确认导出前已登录并操作过个人中心/充值');
    process.exit(1);
  }

  const local = synthesizeLocalFromProject(source);
  let report = analyzePair(source, local);
  report.mode = 'source-har-vs-project';
  report.warning = '本地侧为项目当前 migration-map/Adapter 推演。源站 HAR 中登录后业务响应多为密文(text/plain)，字段级兼容无法从该 HAR 直接验证；结论以「接口是否替换」为主。';
  report.quality = { source: q, local: assessCaptureQuality(local, '本地(推演)') };
  report = enrichWithSourceFieldDiff(report, source);

  const outDir = outputDir(siteId);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'post-login-deps.json');

  const digest = {
    generatedAt: report.generatedAt,
    mode: report.mode,
    warning: report.warning,
    quality: report.quality,
    summary: report.summary,
    symptomMap: report.symptomMap,
    nextFixOrder: report.nextFixOrder,
    harVsProjectFindings: report.harVsProjectFindings
  };
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), 'utf8');
  fs.writeFileSync(path.join(outDir, 'post-login-digest.json'), JSON.stringify(digest, null, 2), 'utf8');

  // 复制 HAR 到 output 便于回溯
  try {
    fs.copyFileSync(harPath, path.join(outDir, 'source.post-login.har'));
  } catch (_) { /* ignore */ }

  console.log('\n=== 源站 HAR × 本地项目 ===');
  console.log('total', report.summary.totalCompared);
  console.log('byStatus', report.summary.byStatus);
  console.log('\n-- 现象 → 接口 --');
  for (const s of report.symptomMap || []) {
    console.log(`\n# ${s.symptom}`);
    for (const a of s.apis.slice(0, 8)) {
      console.log(`  ${a.status}`);
      console.log(`    ${a.path}${a.sourceEncrypted ? '  [HAR密文]' : ''}`);
    }
  }
  console.log('\nWrote', outPath);
  console.log('Digest', path.join(outDir, 'post-login-digest.json'));
}

main();
