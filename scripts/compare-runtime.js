#!/usr/bin/env node
/**
 * CLI: 源站 vs 本地 dist 运行时对比
 * Usage: node scripts/compare-runtime.js --source https://example.com --local dist/example.com
 */
const path = require('path');
const fs = require('fs');
const { compareRuntime } = require('../src/compare');

function parseArgs(argv) {
  const out = {
    source: '',
    local: path.join(__dirname, '..', 'dist'),
    port: 3460,
    waitMs: 12000,
    out: null,
    focus: ''
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === '--source' && next) { out.source = next; i++; }
    else if (a === '--local' && next) { out.local = path.resolve(next); i++; }
    else if (a === '--port' && next) { out.port = Number(next); i++; }
    else if (a === '--wait' && next) { out.waitMs = Number(next); i++; }
    else if (a === '--out' && next) { out.out = path.resolve(next); i++; }
    else if (a === '--focus' && next) { out.focus = next; i++; }
  }
  if (!out.out) out.out = path.join(out.local, 'diff.json');
  return out;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (!opts.source) {
    console.error('需要 --source URL');
    process.exit(1);
  }
  if (!fs.existsSync(opts.local)) {
    console.error('本地目录不存在:', opts.local);
    process.exit(1);
  }

  const result = await compareRuntime({
    sourceUrl: opts.source,
    localDir: opts.local,
    port: opts.port,
    waitMs: opts.waitMs,
    focus: opts.focus,
    outPath: opts.out
  });

  console.log('已写入', result.diffPath);
  for (const f of result.diff.summary.topFindings) console.log('-', f);
  console.log('overlay source/local:', result.source.snapshot.overlayCount, result.local.snapshot.overlayCount);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
