/**
 * 对比官方与本地抓取的 API 数据形状。
 * 只比较字段和类型，不比较账号、余额等具体值。
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const officialPath = path.resolve(process.argv[2] || path.join(root, 'logs', 'official-shapes', 'catalog.json'));
const localPath = path.resolve(process.argv[3] || path.join(root, 'logs', 'local-shapes', 'catalog.json'));
const outputPath = path.resolve(process.argv[4] || path.join(root, 'logs', 'contract-diff-719win.json'));

function readCatalog(file) {
  if (!fs.existsSync(file)) throw new Error('契约文件不存在: ' + file);
  const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
  return new Map(rows.map((row) => [row.path, row]));
}

function kind(value) {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (value && value.type === 'array') return 'array';
  if (value && typeof value === 'object') return 'object';
  return typeof value;
}

function shapeOf(value, depth) {
  const level = depth || 0;
  if (level > 5) return 'deep';
  if (value == null) return null;
  if (Array.isArray(value)) {
    return {
      type: 'array',
      len: value.length,
      item: value.length ? shapeOf(value[0], level + 1) : null
    };
  }
  if (typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value)) out[key] = shapeOf(value[key], level + 1);
    return out;
  }
  return typeof value;
}

function compareShape(expected, actual, at, out) {
  const leftKind = kind(expected);
  const rightKind = kind(actual);
  if (leftKind !== rightKind) {
    out.push({ kind: 'type', at, official: leftKind, local: rightKind });
    return;
  }
  if (leftKind === 'array') {
    if (expected.item != null && actual.item == null) {
      out.push({ kind: 'empty-array', at, official: kind(expected.item), local: 'empty' });
      return;
    }
    if (expected.item != null && actual.item != null) {
      compareShape(expected.item, actual.item, at + '[]', out);
    }
    return;
  }
  if (leftKind !== 'object') return;
  for (const key of Object.keys(expected)) {
    const child = at ? at + '.' + key : key;
    if (!Object.prototype.hasOwnProperty.call(actual, key)) {
      out.push({ kind: 'missing-field', at: child, official: kind(expected[key]), local: 'missing' });
      continue;
    }
    compareShape(expected[key], actual[key], child, out);
  }
  for (const key of Object.keys(actual)) {
    if (!Object.prototype.hasOwnProperty.call(expected, key)) {
      const child = at ? at + '.' + key : key;
      out.push({ kind: 'extra-field', at: child, official: 'missing', local: kind(actual[key]) });
    }
  }
}

function main() {
  const official = readCatalog(officialPath);
  const local = readCatalog(localPath);
  const onlyOfficial = [...official.keys()].filter((key) => !local.has(key)).sort();
  const onlyLocal = [...local.keys()].filter((key) => !official.has(key)).sort();
  const contracts = [];
  for (const [apiPath, expected] of official) {
    const actual = local.get(apiPath);
    if (!actual) continue;
    const differences = [];
    compareShape(expected.shape, actual.shape, 'data', differences);
    if (expected.code !== actual.code) {
      differences.unshift({ kind: 'code', at: 'code', official: expected.code, local: actual.code });
    }
    if (differences.length) {
      contracts.push({
        path: apiPath,
        officialPage: expected.page,
        localPage: actual.page,
        differences
      });
    }
  }
  contracts.sort((a, b) => b.differences.length - a.differences.length || a.path.localeCompare(b.path));
  // 官方样本有数据、本地测试账号为空列表时，只能说数据状态不同，不是契约破坏。
  const dataDependentContracts = contracts.filter((row) =>
    row.differences.some((diff) => diff.kind === 'empty-array')
  );
  const breakingContracts = contracts.filter((row) => row.differences.some((diff) =>
    diff.kind !== 'extra-field' && diff.kind !== 'empty-array'
  ));
  const additiveContracts = contracts.filter((row) => row.differences.every((diff) => diff.kind === 'extra-field'));
  const report = {
    generatedAt: new Date().toISOString(),
    officialPath,
    localPath,
    officialCount: official.size,
    localCount: local.size,
    matchedCount: [...official.keys()].filter((key) => local.has(key)).length,
    onlyOfficial,
    onlyLocal,
    mismatchedCount: contracts.length,
    breakingMismatchCount: breakingContracts.length,
    dataDependentMismatchCount: dataDependentContracts.length,
    additiveOnlyCount: additiveContracts.length,
    contracts
  };
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    official: report.officialCount,
    local: report.localCount,
    matched: report.matchedCount,
    onlyOfficial: onlyOfficial.length,
    onlyLocal: onlyLocal.length,
    mismatched: contracts.length,
    breakingMismatches: breakingContracts.length,
    dataDependentMismatches: dataDependentContracts.length,
    additiveOnly: additiveContracts.length,
    largest: contracts.slice(0, 15).map((row) => row.path + ' (' + row.differences.length + ')'),
    outputPath
  }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err && err.stack || err);
    process.exit(1);
  }
}

module.exports = { shapeOf, compareShape, kind };
