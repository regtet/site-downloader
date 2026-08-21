/**
 * 两步流程的第二步：归档原始包 + 生成接口适配部署包
 *   input/<siteId>/  ← 原始（UI 点「替换接口」时从 dist 同步）
 *   output/<siteId>/ ← 可反复覆盖生成
 */
const fs = require('fs');
const path = require('path');
const {
  toSiteId,
  inputDir,
  outputDir,
  copyRecursive,
  emptyDir,
  INPUT_ROOT,
  OUTPUT_ROOT,
  ROOT
} = require('../scripts/site-paths');

const SKIP_META = [
  'api-analysis.json',
  'migration-map.basic-chain.json',
  'adapter-hosts.json',
  'migration-manifest.json',
  '.source-meta.json'
];

function promoteInput(srcDir, siteId, { force = false } = {}) {
  const id = toSiteId(siteId || srcDir);
  const dest = inputDir(id);
  if (!fs.existsSync(srcDir)) {
    const err = new Error(`源目录不存在: ${srcDir}`);
    err.code = 'ENOENT';
    throw err;
  }
  if (fs.existsSync(dest) && !force) {
    const err = new Error(`input 已存在，未覆盖: ${dest}`);
    err.code = 'EEXIST';
    throw err;
  }
  emptyDir(dest);
  copyRecursive(srcDir, dest, { skip: SKIP_META });
  fs.writeFileSync(
    path.join(dest, '.source-meta.json'),
    JSON.stringify({
      archivedAt: new Date().toISOString(),
      from: srcDir,
      siteId: id,
      immutable: true
    }, null, 2),
    'utf8'
  );
  return { siteId: id, inputDir: dest };
}

function exportMigrated(siteId) {
  const id = toSiteId(siteId);
  const src = inputDir(id);
  const out = outputDir(id);
  if (!fs.existsSync(src)) {
    const err = new Error(`找不到原始包: ${src}`);
    err.code = 'ENOENT';
    throw err;
  }

  emptyDir(out);
  copyRecursive(src, out, { skip: SKIP_META });

  let inferred = { upstreamOrigin: '', ossOrigin: '' };
  try {
    const { inferOriginsFromNetwork } = require('./adapter/config');
    inferred = inferOriginsFromNetwork(src, fs, path) || inferred;
  } catch (_) {}

  const { MIGRATION_MAP } = require('./adapter/series/aniw-lobby/migration-map');
  const adapterHosts = {
    series: 'aniw-lobby',
    provider: 'wgame',
    providerOptions: { mode: 'wgame' },
    upstreamOrigin: inferred.upstreamOrigin || '',
    ossOrigin: inferred.ossOrigin || '',
    _p0: Object.keys(MIGRATION_MAP)
  };
  fs.writeFileSync(path.join(out, 'adapter-hosts.json'), JSON.stringify(adapterHosts, null, 2), 'utf8');

  const manifest = {
    generatedAt: new Date().toISOString(),
    siteId: id,
    sourceInput: src,
    output: out,
    phase: 'P0',
    ops: [
      'auth.login',
      'auth.register',
      'user.info',
      'user.vip',
      'user.avatars',
      'wallet.gold',
      'pay.pending'
    ],
    migrationMap: MIGRATION_MAP
  };
  fs.writeFileSync(path.join(out, 'migration-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  return {
    siteId: id,
    inputDir: src,
    outputDir: out,
    adapterHosts,
    phase: 'P0',
    ops: manifest.ops
  };
}

/**
 * 从 dist 一键：同步到 input（覆盖）并生成 output
 * @param {string} distDir
 * @param {{ siteId?: string }} [opts]
 */
function migrateFromDist(distDir, opts = {}) {
  const src = path.resolve(distDir);
  const id = toSiteId(opts.siteId || src);
  const promoted = promoteInput(src, id, { force: true });
  const exported = exportMigrated(promoted.siteId);
  return {
    ...exported,
    sourceDist: src
  };
}

function findMigrated(siteIdOrHost) {
  const id = toSiteId(siteIdOrHost);
  if (!id) return null;
  const out = outputDir(id);
  if (!fs.existsSync(out)) return null;
  const manifestPath = path.join(out, 'migration-manifest.json');
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (_) {}
  return { siteId: id, path: out, manifest };
}

function isAllowedSiteDir(dir) {
  const resolved = path.resolve(dir);
  const roots = [
    path.join(ROOT, 'dist'),
    INPUT_ROOT,
    OUTPUT_ROOT
  ];
  return roots.some((root) => {
    const r = path.resolve(root);
    return resolved === r || resolved.startsWith(r + path.sep);
  });
}

module.exports = {
  promoteInput,
  exportMigrated,
  migrateFromDist,
  findMigrated,
  isAllowedSiteDir,
  toSiteId,
  inputDir,
  outputDir,
  INPUT_ROOT,
  OUTPUT_ROOT,
  ROOT
};
