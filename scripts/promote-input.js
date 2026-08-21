/**
 * CLI：归档到 input/<siteId>/
 *   node scripts/promote-input.js dist/679win.com [siteId] [--force]
 */
const path = require('path');
const { promoteInput, toSiteId } = require('../src/migrate');

function parseArgs(argv) {
  const args = argv.slice(2);
  const force = args.includes('--force');
  const positional = args.filter((a) => a !== '--force');
  const src = positional[0];
  const siteId = positional[1] ? toSiteId(positional[1]) : toSiteId(src);
  return { src, siteId, force };
}

function main() {
  const { src, siteId, force } = parseArgs(process.argv);
  if (!src || !siteId) {
    console.error('用法: node scripts/promote-input.js <原始dist目录> [siteId] [--force]');
    process.exit(1);
  }
  try {
    const result = promoteInput(path.resolve(src), siteId, { force });
    console.log('Archive →', result.inputDir);
    console.log('Done. 界面点「替换接口」或: yarn export-migrated', result.siteId);
  } catch (err) {
    console.error(err.message);
    if (err.code === 'EEXIST') console.error('若确认覆盖，请加 --force');
    process.exit(1);
  }
}

main();
