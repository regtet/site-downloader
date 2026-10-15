/**
 * 登录后接口依赖分析
 *
 * 导入 HAR:
 *   node scripts/analyze-post-login.js --source-har source.har --local-har local.har --out output/679win/post-login-deps.json
 *
 * 仅静态扫描:
 *   node scripts/analyze-post-login.js --site dist/679win.com
 *
 * 手动抓包请用界面：打开源站/本地抓包 → 登录操作 → 完成 → 生成报告
 */
const fs = require('fs');
const path = require('path');
const { runPostLoginAnalysis, loadNetworkDump, analyzePair } = require('../src/post-login-deps');
const { assessCaptureQuality } = require('../src/post-login-capture');
const { toSiteId } = require('./site-paths');

function parseArgs(argv) {
  const out = {
    siteId: '',
    site: '',
    sourceHar: '',
    localHar: '',
    out: '',
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const n = argv[i + 1];
    if (a === '--site' && n) { out.site = path.resolve(n); i++; }
    else if (a === '--site-id' && n) { out.siteId = toSiteId(n); i++; }
    else if (a === '--source-har' && n) { out.sourceHar = path.resolve(n); i++; }
    else if (a === '--local-har' && n) { out.localHar = path.resolve(n); i++; }
    else if (a === '--out' && n) { out.out = path.resolve(n); i++; }
    else if (!a.startsWith('-') && !out.siteId) { out.siteId = toSiteId(a); }
  }
  return out;
}

function printSummary(report) {
  console.log('\n=== 登录后接口依赖分析 ===');
  console.log('mode:', report.mode);
  if (report.warning) console.log('warning:', report.warning);
  if (report.quality) console.log('quality:', JSON.stringify(report.quality));
  console.log('total:', report.summary.totalCompared);
  console.log('byStatus:', report.summary.byStatus);
  console.log('\n-- 建议修复顺序 --');
  for (const step of report.nextFixOrder || []) {
    console.log(`\n[${step.label}] (${step.count})`);
    for (const a of step.apis.slice(0, 6)) {
      console.log(`  - ${a.status}  ${a.path}`);
      if (a.note) console.log(`    ${a.note}`);
    }
  }
  console.log('\nWrote', report.outPath);
}

async function main() {
  const opts = parseArgs(process.argv);
  const outPath = opts.out || path.join(__dirname, '..', 'output', 'post-login-deps.json');

  if (opts.sourceHar && opts.localHar) {
    const report = await runPostLoginAnalysis({
      mode: 'har',
      sourceDump: JSON.parse(fs.readFileSync(opts.sourceHar, 'utf8')),
      localDump: JSON.parse(fs.readFileSync(opts.localHar, 'utf8')),
      outPath,
      allowStaticFallback: false
    });
    printSummary(report);
    return;
  }

  const selectedId = opts.siteId || '679win';
  const siteDir = opts.site || path.join(__dirname, '..', 'dist', selectedId + '.com');
  const report = await runPostLoginAnalysis({
    mode: 'static',
    siteDir,
    outPath: opts.out || path.join(__dirname, '..', 'output', selectedId, 'post-login-deps.json'),
    allowStaticFallback: true
  });
  printSummary(report);
}

main().catch((err) => {
  console.error(err.message || err);
  if (err.quality) console.error(JSON.stringify(err.quality, null, 2));
  process.exit(1);
});
