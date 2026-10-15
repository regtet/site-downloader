/**
 * 用官方抓取的 catalog 审计 adapter 的安全零态。
 * 重点不是值是否相同，而是根类型和页面会直接读取的字段是否存在。
 * 用法: node scripts/audit-official-contract.js [719win]
 */
const fs = require('fs');
const path = require('path');
const { matchRoute } = require('../src/adapter/series/aniw-lobby');
const { applyAdapter } = require('../src/adapter/series/aniw-lobby/adapters');

const siteId = process.argv[2] || '719win';
const root = path.join(__dirname, '..');
const catalogPath = path.join(root, 'logs', 'official-shapes', 'catalog.json');

function rootKind(value) {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function expectedRootKind(shape) {
  if (shape && shape.type === 'array') return 'array';
  if (shape === null) return 'null';
  return 'object';
}

function requiredKeys(shape) {
  if (!shape || typeof shape !== 'object' || Array.isArray(shape) || shape.type === 'array') return [];
  return Object.keys(shape);
}

function providerSeed(route, row) {
  // 这些 adapter 透传 provider 的真实结果；审计它们是否破坏官方形状，
  // provider 自身的字段生成由 verify-p0 / contract fixtures 单独覆盖。
  if (route.adapter === 'withdrawPending' || route.adapter === 'payPending') {
    return row.sample == null ? {} : row.sample;
  }
  if (route.adapter === 'walletGold') return { game_gold: 0 };
  return {};
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const checked = [];
  const issues = [];
  const skipped = [];

  for (const row of catalog) {
    const route = matchRoute(row.path);
    if (!route) {
      skipped.push({ path: row.path, reason: 'unmapped' });
      continue;
    }
    if (route.op === 'upstream.passthrough') {
      skipped.push({ path: row.path, reason: 'upstream' });
      continue;
    }
    let result;
    try {
      result = applyAdapter(route.adapter, { ok: true, data: providerSeed(route, row) }, {
        routePath: row.path,
        body: {},
        siteId
      });
    } catch (err) {
      issues.push({ path: row.path, adapter: route.adapter, kind: 'adapter-error', detail: err.message });
      continue;
    }
    const data = result && result.data;
    const expected = expectedRootKind(row.shape);
    const actual = rootKind(data);
    checked.push(row.path);
    if (expected !== actual) {
      issues.push({ path: row.path, adapter: route.adapter, kind: 'root-type', expected, actual });
      continue;
    }
    if (expected === 'object') {
      const missing = requiredKeys(row.shape).filter((key) => !Object.prototype.hasOwnProperty.call(data || {}, key));
      if (missing.length) {
        issues.push({ path: row.path, adapter: route.adapter, kind: 'missing-fields', missing });
      }
    }
  }

  const report = {
    siteId,
    generatedAt: new Date().toISOString(),
    officialCount: catalog.length,
    checkedCount: checked.length,
    skippedCount: skipped.length,
    issueCount: issues.length,
    issues,
    skipped
  };
  const outPath = path.join(root, 'logs', `official-contract-audit-${siteId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = issues.length ? 1 : 0;
}

main();
