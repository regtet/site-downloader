/**
 * 无人值守 UI 修复循环：HAR 提取 → 重启预览 → verify → smoke → ui-probe → night-continue
 * 用法: node scripts/night-ui-loop.js [679win] [intervalMinutes]
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const siteId = process.argv[2] || '679win';
const intervalMin = Number(process.argv[3] || 15);
const root = path.join(__dirname, '..');
const logPath = path.join(root, 'logs', `night-ui-loop-${siteId}.json`);
const harFile = path.join(process.env.USERPROFILE || '', 'Downloads', '679win.com.har');

function run(cmd, args, timeout = 120000) {
  const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout });
  return {
    ok: r.status === 0,
    status: r.status,
    stdout: (r.stdout || '').slice(-800),
    stderr: (r.stderr || '').slice(-400)
  };
}

function tick() {
  const steps = {};
  if (fs.existsSync(harFile)) {
    steps.extractPay = run(process.execPath, ['scripts/extract-har-pay.js', siteId, harFile], 60000);
    steps.extractAgent = run(process.execPath, ['scripts/extract-har-agent.js', siteId, harFile], 60000);
    steps.extractPopup = run(process.execPath, ['scripts/extract-har-popup.js', siteId, harFile], 60000);
    steps.extractOss = run(process.execPath, ['scripts/extract-har-oss.js', siteId, harFile], 60000);
  }
  steps.verify = run(process.execPath, ['scripts/verify-p0.js', siteId], 180000);
  const env = Object.assign({}, process.env, {
    WGAME_TEST_ACCOUNT: process.env.WGAME_TEST_ACCOUNT || 'qq123123',
    WGAME_TEST_PASSWORD: process.env.WGAME_TEST_PASSWORD || 'qq123123'
  });
  steps.smoke = spawnSync(process.execPath, ['scripts/smoke-e2e-679win.js', siteId], {
    cwd: root, encoding: 'utf8', timeout: 180000, env
  });
  steps.smoke = { ok: steps.smoke.status === 0, status: steps.smoke.status };
  steps.uiProbe = run(process.execPath, ['scripts/ui-probe-679win.js', siteId], 300000);
  steps.night = run(process.execPath, ['scripts/night-continue.js', siteId], 180000);
  steps.export = run(process.execPath, ['scripts/export-api-contract.js', siteId], 60000);
  return {
    at: new Date().toISOString(),
    steps,
    ok: steps.verify.ok && steps.smoke.ok
  };
}

function loadLog() {
  try { return JSON.parse(fs.readFileSync(logPath, 'utf8')); } catch (_) { return { ticks: [] }; }
}

function main() {
  const once = process.argv.includes('--once');
  const log = loadLog();
  const result = tick();
  log.ticks = (log.ticks || []).slice(-50);
  log.ticks.push(result);
  log.last = result;
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.writeFileSync(logPath, JSON.stringify(log, null, 2));
  console.log(JSON.stringify({ ok: result.ok, logPath, at: result.at }, null, 2));
  if (!once && intervalMin > 0) {
    setInterval(() => {
      const r = tick();
      const lg = loadLog();
      lg.ticks = (lg.ticks || []).slice(-50);
      lg.ticks.push(r);
      lg.last = r;
      fs.writeFileSync(logPath, JSON.stringify(lg, null, 2));
      console.log('[night-ui-loop]', r.at, 'ok=', r.ok);
    }, intervalMin * 60 * 1000);
  }
}

main();
