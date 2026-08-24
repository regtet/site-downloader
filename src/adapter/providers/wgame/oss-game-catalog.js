/**
 * dist OSS 游戏列表 (hotListV2) → 游戏名
 * g0=gameId, g1=name, g10=platformId
 */
const fs = require('fs');
const path = require('path');

let cache = null;
let cacheKey = '';

function readJsonSafe(p) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { /* ignore */ }
  return null;
}

function loadOssGameList(siteDir) {
  const key = siteDir ? path.resolve(siteDir) : '';
  if (cache && cacheKey === key && cache.length) return cache;

  const tryParse = (p) => {
    const j = readJsonSafe(p);
    return j && Array.isArray(j.games) && j.games.length ? j.games : null;
  };

  const candidates = [];
  if (siteDir) candidates.push(path.join(siteDir, 'oss-game-list.json'));
  const root = path.join(__dirname, '..', '..', '..', '..');
  const siteId = siteDir ? path.basename(path.resolve(siteDir)) : '679win';
  candidates.push(path.join(root, 'output', siteId, 'oss-game-list.json'));
  candidates.push(path.join(root, 'logs', `oss-game-list-${siteId}.json`));

  for (const p of candidates) {
    const games = tryParse(p);
    if (games) {
      cache = games;
      cacheKey = key;
      return cache;
    }
  }

  const harIds = [siteId];
  if (siteId !== '679win') harIds.push('679win');
  for (const id of harIds) {
    const fromHar = extractOssGameListFromHar(id);
    if (fromHar.length) {
      cache = fromHar;
      cacheKey = key;
      if (siteDir) {
        try {
          const outPath = path.join(siteDir, 'oss-game-list.json');
          if (!fs.existsSync(outPath)) {
            fs.writeFileSync(
              outPath,
              JSON.stringify({ source: `har:${id}`, games: fromHar }, null, 2),
              'utf8'
            );
          }
        } catch (_) { /* ignore */ }
      }
      return cache;
    }
  }

  const fromSnap = extractOssGameListFromOssSnapshot(siteDir);
  if (fromSnap.length) {
    cache = fromSnap;
    cacheKey = key;
    return cache;
  }

  const bundled = tryParse(path.join(__dirname, 'data', 'oss-game-list-default.json'));
  if (bundled) {
    cache = bundled;
    cacheKey = key;
    return cache;
  }

  return [];
}

function extractOssGameListFromHar(siteId) {
  const id = String(siteId || '679win');
  const root = path.join(__dirname, '..', '..', '..', '..');
  const candidates = [
    path.join(root, 'logs', `${id}.com.har`),
    path.join(process.env.USERPROFILE || '', 'Downloads', `${id}.com.har`),
    path.join(process.env.HOME || '', 'Downloads', `${id}.com.har`)
  ];
  const games = [];
  const seen = new Set();
  for (const harPath of candidates) {
    const j = readJsonSafe(harPath);
    const entries = j && j.log && Array.isArray(j.log.entries) ? j.log.entries : [];
    for (const e of entries) {
      if (!e.request || !String(e.request.url || '').includes('hotListV2')) continue;
      const t = e.response && e.response.content && e.response.content.text;
      if (!t) continue;
      try {
        const body = JSON.parse(t);
        const list = Array.isArray(body.data) ? body.data : [];
        for (const row of list) {
          if (row.g0 == null) continue;
          const rowKey = row.g10 + ':' + row.g0;
          if (seen.has(rowKey)) continue;
          seen.add(rowKey);
          games.push({
            platformId: Number(row.g10),
            gameId: Number(row.g0),
            name: String(row.g1 || '').trim()
          });
        }
      } catch (_) { /* ignore */ }
    }
    if (games.length) break;
  }
  return games.sort((a, b) => a.platformId - b.platformId || a.gameId - b.gameId);
}

function parseHotListRows(list, games, seen) {
  for (const row of list) {
    if (row.g0 == null) continue;
    const rowKey = row.g10 + ':' + row.g0;
    if (seen.has(rowKey)) continue;
    seen.add(rowKey);
    games.push({
      platformId: Number(row.g10),
      gameId: Number(row.g0),
      name: String(row.g1 || '').trim()
    });
  }
}

function extractOssGameListFromOssSnapshot(siteDir) {
  const siteId = siteDir ? path.basename(path.resolve(siteDir)) : '679win';
  const root = path.join(__dirname, '..', '..', '..', '..');
  const paths = [];
  if (siteDir) paths.push(path.join(siteDir, 'har-oss-snapshot.json'));
  paths.push(path.join(root, 'logs', `har-oss-snapshot-${siteId}.json`));
  const games = [];
  const seen = new Set();
  for (const p of paths) {
    const snap = readJsonSafe(p);
    const endpoints = snap && snap.endpoints;
    if (!endpoints || typeof endpoints !== 'object') continue;
    for (const [epPath, body] of Object.entries(endpoints)) {
      if (!String(epPath).includes('hotListV2')) continue;
      let data = body;
      if (typeof body === 'string') {
        try { data = JSON.parse(body); } catch (_) { continue; }
      }
      const list = data && Array.isArray(data.data) ? data.data : [];
      parseHotListRows(list, games, seen);
    }
    if (games.length) break;
  }
  return games.sort((a, b) => a.platformId - b.platformId || a.gameId - b.gameId);
}

function buildOssGameListForSite(siteDir) {
  const siteId = siteDir ? path.basename(path.resolve(siteDir)) : '679win';
  let games = extractOssGameListFromHar(siteId);
  if (!games.length && siteId !== '679win') games = extractOssGameListFromHar('679win');
  if (!games.length) games = extractOssGameListFromOssSnapshot(siteDir);
  if (!games.length) {
    const bundled = readJsonSafe(path.join(__dirname, 'data', 'oss-game-list-default.json'));
    if (bundled && Array.isArray(bundled.games)) games = bundled.games;
  }
  return games;
}

function loadBundledOssGames() {
  const j = readJsonSafe(path.join(__dirname, 'data', 'oss-game-list-default.json'));
  return j && Array.isArray(j.games) ? j.games : [];
}

function mergeOssRow(primary, fallback) {
  if (!primary) return fallback || null;
  if (!fallback) return primary;
  return Object.assign({}, fallback, primary, {
    name: primary.name || fallback.name,
    nOriginalID: primary.nOriginalID || fallback.nOriginalID,
    nApiID: primary.nApiID || fallback.nApiID,
    game_key: primary.game_key || fallback.game_key
  });
}

function findOssGameInList(list, platformId, gameId) {
  const pid = Number(platformId);
  const gid = Number(gameId);
  if (!gid || !Array.isArray(list)) return null;
  for (const row of list) {
    if (Number(row.gameId) !== gid) continue;
    if (pid && Number(row.platformId) !== pid) continue;
    return row;
  }
  return null;
}

function isOssCatalogGameId(gameId) {
  const n = Number(gameId) || 0;
  return n >= 100000;
}

function resolveOssGameName(platformId, gameId, siteDir) {
  const row = resolveOssGameRow(platformId, gameId, siteDir);
  return row ? String(row.name || '').trim() : '';
}

/** 完整 OSS 行（含预置 nOriginalID，不依赖 wgame_web） */
function resolveOssGameRow(platformId, gameId, siteDir) {
  const gid = Number(gameId);
  if (!gid) return null;
  const fromList = findOssGameInList(loadOssGameList(siteDir), platformId, gameId);
  const fromBundled = findOssGameInList(loadBundledOssGames(), platformId, gameId);
  return mergeOssRow(fromList, fromBundled);
}

module.exports = {
  loadOssGameList,
  isOssCatalogGameId,
  resolveOssGameName,
  resolveOssGameRow,
  extractOssGameListFromHar,
  extractOssGameListFromOssSnapshot,
  buildOssGameListForSite
};
