/**
 * 夜间自动推进：读进度 → 跑 verify → 扫 HAR 路径缺口 → 追加进度
 * 用法: node scripts/night-continue.js [679win]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const siteId = process.argv[2] || '679win';
const root = path.join(__dirname, '..');
const logsDir = path.join(root, 'logs');
const progressPath = path.join(logsDir, `night-progress-${siteId}.json`);
const { MIGRATION_MAP } = require('../src/adapter/series/aniw-lobby/migration-map');

function loadProgress() {
  try {
    return JSON.parse(fs.readFileSync(progressPath, 'utf8'));
  } catch (_) {
    // 兼容旧路径
    try {
      return JSON.parse(
        fs.readFileSync(path.join(root, 'output', siteId, 'night-progress.json'), 'utf8')
      );
    } catch (_) {
      return { ticks: [] };
    }
  }
}

function saveProgress(p) {
  fs.mkdirSync(logsDir, { recursive: true });
  fs.writeFileSync(progressPath, JSON.stringify(p, null, 2));
}

function harApiPaths() {
  const harFile = path.join(
    process.env.USERPROFILE || '',
    'Downloads',
    '679win.com.har'
  );
  if (!fs.existsSync(harFile)) return [];
  const har = JSON.parse(fs.readFileSync(harFile, 'utf8'));
  const set = new Set();
  for (const e of har.log.entries || []) {
    if (e.request.method === 'OPTIONS') continue;
    let u = String(e.request.url || '').split('?')[0];
    u = u.replace(/^https?:\/\/[^/]+/i, '');
    if (u.startsWith('/hall/api/')) u = u.slice('/hall'.length);
    if (u.startsWith('/api/')) set.add(u);
  }
  return [...set].sort();
}

function main() {
  const mapped = new Set(Object.keys(MIGRATION_MAP));
  const harPaths = harApiPaths();
  const gaps = harPaths.filter((p) => !mapped.has(p));

  // 只关心登录后常见业务前缀；OSS *.json / 代理下级不作为本轮动作缺口
  const interesting = gaps.filter((p) =>
    /\/(member|finance|gameCenter|gohal|agent|active|club)\//i.test(p)
    && !/\/lobby\//i.test(p)
  );
  const actionable = interesting.filter((p) => !/\.json$/i.test(p));

  // 运行时 unmapped（需重启 yarn start 后才有）
  let runtimeTop = [];
  try {
    const rt = JSON.parse(
      fs.readFileSync(path.join(logsDir, 'runtime-unmapped.json'), 'utf8')
    );
    runtimeTop = (rt.top || []).slice(0, 20).filter((row) => {
      const m = String(row.key || '').match(/^(?:GET|POST|PUT|DELETE|PATCH)\s+(\S+)/i);
      return !m || !mapped.has(m[1]);
    });
  } catch (_) { /* ignore */ }

  // HAR 渠道快照（若 Downloads 有 679win.com.har）
  const harFile = path.join(process.env.USERPROFILE || '', 'Downloads', '679win.com.har');
  if (fs.existsSync(harFile)) {
    spawnSync(process.execPath, ['scripts/extract-har-pay.js', siteId, harFile], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000
    });
    spawnSync(process.execPath, ['scripts/extract-har-agent.js', siteId, harFile], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000
    });
    spawnSync(process.execPath, ['scripts/extract-har-popup.js', siteId, harFile], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000
    });
  }

  const verify = spawnSync(process.execPath, ['scripts/verify-p0.js', siteId], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000
  });
  const verifyOk = /passed=\d+ failed=0/.test(verify.stdout || '');

  if (verifyOk) {
    spawnSync(process.execPath, ['scripts/export-migrated.js', siteId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000
    });
    if (fs.existsSync(harFile)) {
      spawnSync(process.execPath, ['scripts/extract-har-pay.js', siteId, harFile], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000
      });
      spawnSync(process.execPath, ['scripts/extract-har-agent.js', siteId, harFile], {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000
      });
    }
    spawnSync(process.execPath, ['scripts/import-capture-agent.js', siteId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000
    });
    spawnSync(process.execPath, ['scripts/smoke-e2e-679win.js', siteId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 120000
    });
    spawnSync(process.execPath, ['scripts/wgame-live-probe.js', siteId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 180000
    });
    spawnSync(process.execPath, ['scripts/probe-production-hooks.js', siteId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 60000
    });
    spawnSync(process.execPath, ['scripts/export-api-contract.js', siteId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 30000
    });
    spawnSync(process.execPath, ['scripts/wire-status.js', siteId], {
      cwd: root,
      encoding: 'utf8',
      timeout: 15000
    });
  }

  // 顺带扫 dist + 扩展 bulk（不伪造，仅分类）
  spawnSync(process.execPath, ['scripts/scan-dist-api-gaps.js', siteId], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000
  });
  spawnSync(process.execPath, ['scripts/expand-safe-bulk.js', siteId], {
    cwd: root,
    encoding: 'utf8',
    timeout: 60000
  });

  const { MIGRATION_MAP: MAP2 } = require('../src/adapter/series/aniw-lobby/migration-map');
  let distActionable = [];
  try {
    distActionable = require(path.join(logsDir, `dist-api-gaps-${siteId}.json`)).actionable || [];
  } catch (_) { /* ignore */ }

  let e2eOk = false;
  let e2eSteps = null;
  try {
    const e2e = JSON.parse(fs.readFileSync(path.join(logsDir, `smoke-e2e-${siteId}.json`), 'utf8'));
    e2eOk = !!e2e.ok;
    e2eSteps = e2e.steps || null;
  } catch (_) { /* ignore */ }

  let wgameLive = null;
  try {
    wgameLive = JSON.parse(fs.readFileSync(path.join(logsDir, `wgame-live-probe-${siteId}.json`), 'utf8'));
  } catch (_) { /* ignore */ }

  let productionProbe = null;
  try {
    productionProbe = JSON.parse(fs.readFileSync(path.join(logsDir, `production-probe-${siteId}.json`), 'utf8'));
  } catch (_) { /* ignore */ }

  const verifyPass = String(verify.stdout || '').match(/passed=(\d+) failed=0/);
  const verifyPassed = verifyPass ? Number(verifyPass[1]) : null;

  let wireStatus = null;
  try {
    wireStatus = JSON.parse(fs.readFileSync(path.join(logsDir, `wire-status-${siteId}.json`), 'utf8'));
  } catch (_) { /* ignore */ }

  const progress = loadProgress();
  const tick = {
    at: new Date().toISOString(),
    phase: 'dev-complete-await-production',
    mapSize: Object.keys(MAP2).length,
    verifyOk,
    verifyPassed,
    e2eOk,
    e2eSteps,
    wgameLive,
    productionProbe,
    wireStatus,
    apiContract: path.join('output', siteId, 'api-contract.json'),
    verifyTail: String(verify.stdout || '').trim().split(/\r?\n/).slice(-3),
    harApiCount: harPaths.length,
    interestingUnmappedSample: interesting.slice(0, 25),
    interestingUnmappedCount: interesting.length,
    actionableUnmapped: actionable,
    runtimeTop,
    distActionableLeft: distActionable,
    deferred: {
      ossJson: interesting.filter((p) => /\.json$/i.test(p)).length
    },
    note: 'dev chain green; production blocked until PAY_HTTP_URL/AGENT_HTTP_BASE or WGAME_TEST_ACCOUNT'
  };
  progress.ticks = progress.ticks || [];
  progress.ticks.push(tick);
  progress.latest = tick;
  saveProgress(progress);

  console.log(JSON.stringify({
    ok: verifyOk,
    e2eOk,
    mapSize: tick.mapSize,
    interestingUnmappedCount: interesting.length,
    actionableUnmapped: actionable,
    distActionableLeft: distActionable,
    runtimeTop: runtimeTop.slice(0, 5),
    progressPath
  }, null, 2));

  process.exit(verifyOk ? 0 : 1);
}

main();
