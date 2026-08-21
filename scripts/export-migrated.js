/**
 * CLI：input → output（可反复）
 *   node scripts/export-migrated.js [siteId]
 */
const { exportMigrated, toSiteId } = require('../src/migrate');

function main() {
  const siteId = toSiteId(process.argv[2] || '679win');
  if (!siteId) {
    console.error('用法: node scripts/export-migrated.js <siteId>');
    process.exit(1);
  }
  try {
    const result = exportMigrated(siteId);
    console.log('Build →', result.outputDir);
    console.log('Done.');
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
