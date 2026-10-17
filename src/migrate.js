/**
 * 两步流程的第二步：归档原始包 + 生成接口适配部署包
 *   input/<siteId>/  ← 从当前 dist 强制同步（官方 UI 壳）
 *   output/<siteId>/ ← 每次整目录重写，但默认保留该站点已绑定的 WGame 系列快照
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

function deriveRealmFromLobby(lobbyGameUrl) {
  try {
    const host = new URL(String(lobbyGameUrl || '')).hostname.replace(/^www\./i, '');
    if (!host) return null;
    return {
      wssUrl: 'wss://server.' + host,
      loginHttpBase: 'https://login.' + host
    };
  } catch (_) {
    return null;
  }
}

function deriveLoginFromWss(wssUrl) {
  try {
    const u = new URL(String(wssUrl || '').replace(/^ws/i, 'http'));
    const host = /^server\./i.test(u.hostname)
      ? u.hostname.replace(/^server\./i, 'login.')
      : 'login.' + u.hostname;
    return 'https://' + host;
  } catch (_) {
    return '';
  }
}

/** 输出包默认固定生产连接；测试连接仅用于 wgame_web 本身的开发调试。 */
function normalizeWgameSnapshot(raw, source) {
  const input = raw || {};
  const lobbyRealm = deriveRealmFromLobby(input.lobbyGameUrl);
  let wssUrl = input.wssUrl || '';
  if (input.debug) {
    wssUrl = input.baseWssUrl || (lobbyRealm && lobbyRealm.wssUrl) || wssUrl;
  }
  const loginHttpBase = input.debug
    ? (deriveLoginFromWss(wssUrl) || (lobbyRealm && lobbyRealm.loginHttpBase) || input.loginHttpBase)
    : (input.loginHttpBase || deriveLoginFromWss(wssUrl));
  return {
    root: input.webRoot || input.root || '',
    branch: input.branch || '',
    debug: false,
    serverMode: 'production',
    wssUrl,
    loginHttpBase,
    packageId: input.packageId,
    lobbyGameUrl: input.lobbyGameUrl || '',
    configMtime: input.mtime || input.configMtime || '',
    connectionSource: source || 'current-wgame-web',
    snapshottedAt: new Date().toISOString()
  };
}

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

function exportMigrated(siteId, opts = {}) {
  const id = toSiteId(siteId);
  const src = inputDir(id);
  const out = outputDir(id);
  if (!fs.existsSync(src)) {
    const err = new Error(`找不到原始包: ${src}`);
    err.code = 'ENOENT';
    throw err;
  }

  const { loadWgameWebConfig } = require('./adapter/providers/wgame/wgame-web-config');
  const currentWgameWeb = loadWgameWebConfig();
  if (!currentWgameWeb) {
    const err = new Error(
      '找不到 wgame_web（期望 ../wgame_web 或 WGAME_WEB_PATH）。替换接口必须按当前 wgame_web 配置生成。'
    );
    err.code = 'ENOENT';
    throw err;
  }

  // 保留生产钩子和站点自己的 WGame 系列快照，避免重建时被当前开发分支串线。
  let preservedHosts = null;
  let preservedGameList = null;
  const prevHostsPath = path.join(out, 'adapter-hosts.json');
  const prevGameListPath = path.join(out, 'oss-game-list.json');
  if (fs.existsSync(prevHostsPath)) {
    try {
      preservedHosts = JSON.parse(fs.readFileSync(prevHostsPath, 'utf8'));
    } catch (_) { /* ignore */ }
  }
  if (fs.existsSync(prevGameListPath)) {
    try {
      preservedGameList = JSON.parse(fs.readFileSync(prevGameListPath, 'utf8'));
    } catch (_) { /* ignore */ }
  }

  const shouldRebind = opts.rebindWgame === true || process.env.WGAME_REBIND_ON_MIGRATE === '1';
  const pinnedWgameWeb = !shouldRebind && preservedHosts && preservedHosts.wgameWeb;
  const wgameWeb = pinnedWgameWeb || currentWgameWeb;
  const wgameSnapshot = normalizeWgameSnapshot(
    wgameWeb,
    pinnedWgameWeb ? 'pinned-output' : 'current-wgame-web'
  );

  emptyDir(out);
  copyRecursive(src, out, { skip: SKIP_META });
  try {
    const { ensureGameLauncherOnDisk } = require('./game-launcher');
    ensureGameLauncherOnDisk(out, fs, path);
  } catch (_) { /* ignore */ }

  const logRoot = path.join(ROOT, 'logs');
  const localSrc = path.join(logRoot, 'local-public-api', id);
  if (fs.existsSync(localSrc)) {
    copyRecursive(localSrc, path.join(out, 'local-api'));
  }
  for (const name of [
    `har-oss-snapshot-${id}.json`,
    `har-pay-snapshot-${id}.json`
  ]) {
    const snapSrc = path.join(logRoot, name);
    if (fs.existsSync(snapSrc)) {
      fs.copyFileSync(snapSrc, path.join(out, name.replace(`-${id}`, '')));
    }
  }

  let inferred = { upstreamOrigin: '', ossOrigin: '' };
  let siteCode = '';
  try {
    const { inferOriginsFromNetwork, inferSiteCodeFromSite } = require('./adapter/config');
    inferred = inferOriginsFromNetwork(src, fs, path) || inferred;
    siteCode = inferSiteCodeFromSite(src, fs, path) || '';
  } catch (_) {}

  const { MIGRATION_MAP } = require('./adapter/series/aniw-lobby/migration-map');
  const adapterHosts = {
    series: 'aniw-lobby',
    provider: 'wgame',
    providerOptions: {
      mode: 'wgame',
      // 生产转换包绝不能在 WGame 注册失败时伪造本地成功，否则前端会弹出假成功提示，
      // 后续登录、余额和代理接口又因远端没有该账号而全部异常。
      fallbackMockOnIpLimit: false,
      pay: {
        enabled: true,
        source: 'wgame',
        allowPlaceholderFallback: false,
        createOrder: {
          mode: 'wgame',
          useBuiltinMock: false,
          httpUrl: '',
          httpMethod: 'POST'
        },
        note: 'Use WGame shopItemList/payCharge. Set PAY_HTTP_URL only for an explicit external cashier.'
      },
      agent: {
        enabled: true,
        source: 'wgame',
        useBuiltinMock: false,
        httpBase: '',
        httpMethod: 'POST',
        routes: {
          agentMode: '/agentMode',
          promoteConfig: '/promoteConfig',
          agentPromotion: '/agentPromotion',
          indexInfo: '/indexInfo',
          myTotalData: '/myTotalData',
          myPeriodData: '/myPeriodData',
          myCommission: '/myCommission',
          commissionMarquee: '/commissionMarquee',
          getIpBindInfo: '/getIpBindInfo',
          directReport: '/directReport',
          teamDataV2: '/teamDataV2',
          myCommissionDetail: '/myCommissionDetail',
          myPerformance: '/myPerformance',
          myPerformanceDetail: '/myPerformanceDetail',
          clubCommission: '/clubCommission',
          clubCommissionDetail: '/clubCommissionDetail',
          clubPerformance: '/clubPerformance',
          clubPerformanceUser: '/clubPerformanceUser',
          directFin: '/directFin',
          memberInfo: '/memberInfo',
          bindingReport: '/bindingReport'
        },
        note: 'Use WGame proxyStatistics/proxyUserList/proxySubBetConfig. Set AGENT_HTTP_BASE only for an explicit external agent API.'
      },
      game: {
        enabled: true,
        launchMode: 'createuser',
        clientPath: 'gogamesac/clientv3/index.html',
        // 运行时以当前 wgame_web.proxyShareUrlList 为准；此处只留空占位
        lobbyGameUrl: '',
        fallbackToDefault: true,
        fallbackToClient: false,
        selfPlatformIds: ['0999'],
        platformMap: {
          '200': { nApiID: 12, pg_new_way_login: 1 },
          '201': { nApiID: 12, pg_new_way_login: 1 },
          '13': { nApiID: 2 },
          '310': { nApiID: 5 },
          '0999': { nApiID: 12, pg_new_way_login: 1 }
        },
        defaultTarget: {
          kindId: 1,
          roomId: 0,
          gameName: 'WGame',
          direction: 1
        },
        mappings: [],
        note: 'OSS lists are UI-only; gameApi/login calls wgame /index/createuser like wgame_web OtherGameHall.'
      }
    },
    upstreamOrigin: inferred.upstreamOrigin || '',
    ossOrigin: inferred.ossOrigin || '',
    siteCode: siteCode || '',
    mapSize: Object.keys(MIGRATION_MAP).length,
    wgameWeb: wgameSnapshot
  };
  const { mergePreservedProductionHooks } = require('./production-hooks');
  mergePreservedProductionHooks(adapterHosts, preservedHosts);
  fs.writeFileSync(path.join(out, 'adapter-hosts.json'), JSON.stringify(adapterHosts, null, 2), 'utf8');

  // 固定站点系列时同步保留其游戏映射；只有新站点或显式 rebind 才从当前 wgame_web 重建。
  if (pinnedWgameWeb && preservedGameList && Array.isArray(preservedGameList.games)) {
    preservedGameList.preservedAt = new Date().toISOString();
    preservedGameList.connectionSource = 'pinned-output';
    fs.writeFileSync(
      path.join(out, 'oss-game-list.json'),
      JSON.stringify(preservedGameList, null, 2),
      'utf8'
    );
  } else try {
    const {
      buildOssGameListForSite,
      clearOssGameListCache
    } = require('./adapter/providers/wgame/oss-game-catalog');
    clearOssGameListCache();
    const games = buildOssGameListForSite(out);
    if (games && games.length) {
      fs.writeFileSync(
        path.join(out, 'oss-game-list.json'),
        JSON.stringify({
          source: 'hotListV2',
          rebuiltAt: new Date().toISOString(),
          wgameWebBranch: wgameWeb.branch,
          games
        }, null, 2),
        'utf8'
      );
    }
  } catch (_) { /* ignore */ }

  const manifest = {
    generatedAt: new Date().toISOString(),
    siteId: id,
    sourceInput: src,
    output: out,
    phase: 'P0',
    wgameWeb: adapterHosts.wgameWeb,
    ops: [
      'auth.login',
      'auth.register',
      'user.info',
      'user.vip',
      'user.avatars',
      'wallet.gold',
      'pay.list',
      'pay.create',
      'agent.mode',
      'agent.index',
      'game.launch'
    ],
    migrationMap: MIGRATION_MAP
  };
  fs.writeFileSync(path.join(out, 'migration-manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');

  let deployPack = null;
  // 默认打出 deploy/<siteId>（静态 www + Node 桥）；设 SKIP_PACK_DEPLOY=1 可跳过
  if (process.env.SKIP_PACK_DEPLOY !== '1') {
    try {
      const { packDeploy } = require('../scripts/pack-deploy');
      deployPack = packDeploy(id);
    } catch (err) {
      console.warn('[exportMigrated] pack-deploy skipped:', (err && err.message) || err);
    }
  }

  return {
    siteId: id,
    inputDir: src,
    outputDir: out,
    adapterHosts,
    wgameWeb: adapterHosts.wgameWeb,
    phase: 'P0',
    ops: manifest.ops,
    deployDir: deployPack && deployPack.deployDir
  };
}

/**
 * 从 dist 一键：同步到 input（覆盖）并生成 output
 * @param {string} distDir
 * @param {{ siteId?: string, rebindWgame?: boolean }} [opts]
 */
function migrateFromDist(distDir, opts = {}) {
  const src = path.resolve(distDir);
  const id = toSiteId(opts.siteId || src);
  const promoted = promoteInput(src, id, { force: true });
  const exported = exportMigrated(promoted.siteId, opts);
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
  ROOT,
  deriveRealmFromLobby,
  normalizeWgameSnapshot
};
