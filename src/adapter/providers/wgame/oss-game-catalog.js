/**
 * dist OSS 游戏列表 (hotListV2) → 游戏名
 * g0=gameId, g1=name, g10=platformId
 */
const fs = require('fs');
const path = require('path');

let cache = null;

function readJsonSafe(p) {
  try {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) { /* ignore */ }
  return null;
}

function loadOssGameList(siteDir) {
  if (cache) return cache;
  const candidates = [];
  if (siteDir) candidates.push(path.join(siteDir, 'oss-game-list.json'));
  const root = path.join(__dirname, '..', '..', '..', '..');
  const siteId = siteDir ? path.basename(path.resolve(siteDir)) : '679win';
  candidates.push(path.join(root, 'output', siteId, 'oss-game-list.json'));
  candidates.push(path.join(root, 'logs', `oss-game-list-${siteId}.json`));

  for (const p of candidates) {
    const j = readJsonSafe(p);
    if (j && Array.isArray(j.games) && j.games.length) {
      cache = j.games;
      return cache;
    }
  }
  cache = [];
  return cache;
}

function isOssCatalogGameId(gameId) {
  const n = Number(gameId) || 0;
  return n >= 100000;
}

function resolveOssGameName(platformId, gameId, siteDir) {
  const pid = Number(platformId);
  const gid = Number(gameId);
  if (!gid) return '';
  const list = loadOssGameList(siteDir);
  for (const row of list) {
    if (Number(row.gameId) === gid && (pid == null || !pid || Number(row.platformId) === pid)) {
      return String(row.name || '').trim();
    }
  }
  return '';
}

module.exports = {
  loadOssGameList,
  isOssCatalogGameId,
  resolveOssGameName
};
