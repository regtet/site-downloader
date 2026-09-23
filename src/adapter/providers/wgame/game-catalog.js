/**
 * 将 dist OSS 游戏 (platformId/gameName) 映射到 wgame createuser 参数。
 * 名称表来自 wgame_web GameName.js，平台默认表可配 adapter-hosts。
 */
const fs = require('fs');
const path = require('path');
const { resolveWgameWebRoot } = require('./wgame-web-config');
const { isOssCatalogGameId, resolveOssGameName, resolveOssGameRow, resolveLiveOssGameName } = require('./oss-game-catalog');

function parseGameInfoFromBody(body) {
  if (!body || typeof body !== 'object') return {};
  let info = {};
  const ctx = body.callContext;
  if (ctx && typeof ctx === 'string') {
    try {
      const j = JSON.parse(ctx);
      if (j && j.gameInfo && typeof j.gameInfo === 'object') info = j.gameInfo;
    } catch (_) { /* ignore */ }
  } else if (ctx && typeof ctx === 'object' && ctx.gameInfo) {
    info = ctx.gameInfo;
  }
  return info;
}

/** 对齐 wgame_web $cc.nApiIDEvent */
function apiMeta(nApiID) {
  const id = Number(nApiID);
  const map = {
    0: { gameKey: 'in-house', pl: 'in-house' },
    1: { gameKey: 'bgs', pl: 'bgs' },
    2: { gameKey: 'jili', pl: 'jili' },
    3: { gameKey: 'pgsoft', pl: 'pg' },
    4: { gameKey: 'evo', pl: 'evo' },
    5: { gameKey: 'pp', pl: 'pp' },
    6: { gameKey: 'cq9official', pl: 'cq9' },
    12: { gameKey: 'pgofficial', pl: 'pg' },
    17: { gameKey: 'ppofficial', pl: 'pp' },
    18: { gameKey: 'oneapi', pl: 'oneapi' },
    21: { gameKey: 'jdb', pl: 'jdb' },
    22: { gameKey: 'wg', pl: 'wg' },
    31: { gameKey: 'vintepg', pl: 'vintepg' }
  };
  return map[id] || { gameKey: '', pl: '' };
}

function normalizeName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function loadGameNameIndex() {
  const root = resolveWgameWebRoot();
  if (!root) return { byName: new Map(), byId: new Map() };
  const p = path.join(root, 'src', 'game', 'Command', 'Config', 'GameName.js');
  if (!fs.existsSync(p)) return { byName: new Map(), byId: new Map() };
  const text = fs.readFileSync(p, 'utf8');
  const byName = new Map();
  const byId = new Map();
  const re = /g(\d+)\s*:\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(text))) {
    const id = Number(m[1]);
    const raw = m[2].split('//')[0].trim();
    const name = normalizeName(raw);
    if (!name) continue;
    byId.set(id, raw);
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(id);
  }
  return { byName, byId };
}

function pickOriginalId(candidates, nApiID) {
  const list = Array.isArray(candidates) ? candidates.slice() : [];
  if (!list.length) return 0;
  if (list.length === 1) return list[0];
  const api = Number(nApiID);
  if (api === 12) {
    const pg22 = list.find((id) => /^22\d{5,}/.test(String(id)));
    if (pg22) return pg22;
    const pg23 = list.find((id) => /^23\d{5,}/.test(String(id)));
    if (pg23) return pg23;
    const pg46 = list.find((id) => /^46\d{5,}/.test(String(id)));
    if (pg46) return pg46;
  }
  if (api === 3 || api === 31) {
    const pg = list.find((id) => /^22\d+/.test(String(id)) || /^51\d+/.test(String(id)));
    if (pg) return pg;
  }
  if (api === 2 || api === 7 || api === 9) {
    const jili = list.find((id) => id < 100000);
    if (jili) return jili;
  }
  return list[0];
}

/** GameName 的原始号落在哪一档，就用哪一个 nApiID。对不上就不要拿别的平台去减。 */
const API_BANDS = [
  { api: 2, from: 30000, to: 10000000 },
  { api: 4, from: 10000000, to: 11000000 },
  { api: 11, from: 11000000, to: 12000000 },
  { api: 7, from: 12000000, to: 13000000 },
  { api: 9, from: 13000000, to: 14000000 },
  { api: 8, from: 14000000, to: 15000000 },
  { api: 3, from: 15000000, to: 17000000 },
  { api: 26, from: 17000000, to: 20000000 },
  { api: 6, from: 20000000, to: 22000000 },
  { api: 12, from: 22000000, to: 25000000 },
  { api: 13, from: 25000000, to: 26000000 },
  { api: 14, from: 26000000, to: 27000000 },
  { api: 15, from: 27000000, to: 46000000 },
  { api: 22, from: 46000000, to: 47000000 },
  { api: 23, from: 47000000, to: 49000000 },
  { api: 25, from: 49000000, to: 51000000 },
  { api: 31, from: 51000000, to: 61000000 },
  { api: 45, from: 61000000, to: 80000000 },
  { api: 70, from: 80000000, to: 80700000 },
  { api: 77, from: 80700000, to: 80900000 },
  { api: 79, from: 80900000, to: 81000000 },
  { api: 80, from: 81000000, to: 81100000 },
  { api: 81, from: 81100000, to: 85000000 },
  { api: 90, from: 85000000, to: 95600000 },
  { api: 156, from: 95600000, to: 95800000 },
  { api: 158, from: 95800000, to: 95900000 },
  { api: 159, from: 95900000, to: 96100000 },
  { api: 161, from: 96100000, to: 96200000 },
  { api: 162, from: 96200000, to: 200000000 },
  { api: 17, from: 200000000, to: 4000000000 }
];

function inferApiFromOriginalId(id) {
  const n = Number(id) || 0;
  if (n < 30000) return 0;
  for (let i = API_BANDS.length - 1; i >= 0; i--) {
    const band = API_BANDS[i];
    if (n >= band.from && n < band.to) return band.api;
  }
  return 0;
}

function lobbyLocalId(platformId, gameId) {
  const pid = Number(platformId) || 0;
  const gid = Number(gameId) || 0;
  if (pid >= 100 && gid >= pid * 10000 && gid < (pid + 1) * 10000) return gid - pid * 10000;
  return gid;
}

function listOriginalIdsByName(name) {
  const norm = normalizeName(name);
  if (!norm) return [];
  const { byName } = loadGameNameIndex();
  let ids = (byName.get(norm) || []).slice();
  if (!ids.length && norm.length >= 8) {
    for (const [k, v] of byName.entries()) {
      if (k.length >= 8 && (k === norm || k.includes(norm) || norm.includes(k))) ids = ids.concat(v);
    }
  }
  return [...new Set(ids)];
}

function pickBestOriginalId(ids, platformId, lobbyGameId) {
  const list = Array.isArray(ids) ? ids : [];
  if (!list.length) return 0;
  if (list.length === 1) return list[0];
  const local = lobbyLocalId(platformId, lobbyGameId);
  let best = list[0];
  let bestScore = -1;
  for (const id of list) {
    const api = inferApiFromOriginalId(id);
    const fixed = api ? fixGameId(api, id) : id;
    let score = api ? 1 : 0;
    if (fixed === local || fixed === Number(lobbyGameId) || id === Number(lobbyGameId) || id === local) {
      score += 100;
    }
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

function resolveByGameName(name, nApiID) {
  const ids = listOriginalIdsByName(name);
  const best = pickBestOriginalId(ids, '', 0);
  if (best && inferApiFromOriginalId(best)) return best;
  return pickOriginalId(ids, nApiID);
}

/** 对齐 wgame_web HallKernel._fixGameID：createuser 的 gameid 用修正后 ID */
function fixGameId(nApiID, rawGameId) {
  const id = Number(rawGameId) || 0;
  switch (Number(nApiID)) {
    case 0:
    case 1:
      return Math.floor(id / 10) * 10;
    case 2:
      return id - 30000;
    case 3:
      return id - 15000000;
    case 4:
      return id - 10000000;
    case 5:
    case 10:
    case 21:
      return id;
    case 6:
      return id - 20000000;
    case 7:
      return id - 12000000;
    case 8:
      return id - 14000000;
    case 9:
      return id - 13000000;
    case 11:
      return id - 11000000;
    case 12:
      return id - 22000000;
    case 13:
      return id - 25000000;
    case 14:
      return id - 26000000;
    case 15:
      return id - 27000000;
    case 17:
      return id - 200000000;
    case 22:
      return id - 46000000;
    case 31:
      return id - 51000000;
    case 79:
      return id - 80900000;
    case 80:
      return id - 81000000;
    case 162:
      return id - 96200000;
    default:
      return id;
  }
}

/** createuser 专用：oneapi 等在 enterOtherGame 里对 gameid 另有 +29000000 规则 */
function computeCreateGameId(nApiID, rawOriginalId) {
  const api = Number(nApiID);
  const raw = Number(rawOriginalId) || 0;
  if (api === 18) return raw + 29000000;
  return fixGameId(api, raw);
}

const DEFAULT_PLATFORM_MAP = {
  '200': { nApiID: 12, pg_new_way_login: 1 },
  '201': { nApiID: 12, pg_new_way_login: 1 },
  '13': { nApiID: 2 },
  '310': { nApiID: 5 },
  '0999': { nApiID: 12, pg_new_way_login: 1 }
};

const OSS_RAW_OFFSET = {
  2: 30000,
  3: 15000000,
  12: 22000000,
  31: 51000000
};

function resolveOriginalIdFromOssGameId(ossGameId, nApiID) {
  const gid = Number(ossGameId) || 0;
  if (!gid) return 0;
  const api = Number(nApiID);
  const { byId } = loadGameNameIndex();
  if (byId.has(gid)) return gid;
  const offset = OSS_RAW_OFFSET[api];
  if (offset != null) {
    const raw = offset + gid;
    if (byId.has(raw)) return raw;
    return raw;
  }
  if (api === 2 || api === 7 || api === 9) {
    if (gid < 100000 && byId.has(gid)) return gid;
    const jili = 30000 + gid;
    if (byId.has(jili)) return jili;
  }
  return gid;
}

async function resolveCreateUserTarget(body, cfg, siteDir) {
  const platformId = String(
    body.platfromid != null ? body.platfromid : (body.platformId != null ? body.platformId : '')
  );
  const ossGameId = Number(body.gameid != null ? body.gameid : (body.gameId != null ? body.gameId : 0)) || 0;
  const info = parseGameInfoFromBody(body);
  let gameName = info.gameName || info.name || info.g1 || info.title || info.enName || info.englishName || '';

  if (!gameName && ossGameId) {
    const ossName = resolveOssGameName(platformId, ossGameId, siteDir);
    if (ossName) gameName = ossName;
  }

  const platformMap = Object.assign({}, DEFAULT_PLATFORM_MAP, cfg.platformMap || {});
  const plat = platformMap[platformId] || platformMap['*'] || { nApiID: 12, pg_new_way_login: 1 };

  let nApiID = plat.nApiID != null ? Number(plat.nApiID) : 12;
  let nOriginalID = plat.nOriginalID != null ? Number(plat.nOriginalID) : 0;
  let ossRow = null;

  if (ossGameId) {
    ossRow = resolveOssGameRow(platformId, ossGameId, siteDir);
    if (ossRow) {
      if (!gameName && ossRow.name) gameName = String(ossRow.name);
      if (ossRow.nOriginalID && !nOriginalID) {
        const rowId = Number(ossRow.nOriginalID);
        const rowApi = ossRow.nApiID != null ? Number(ossRow.nApiID) : 0;
        const band = inferApiFromOriginalId(rowId);
        if (!rowApi || !band || rowApi === band) nOriginalID = rowId;
      }
    }
  }

  if (!gameName && ossGameId) {
    const liveName = await resolveLiveOssGameName(platformId, ossGameId, siteDir);
    if (liveName) gameName = liveName;
  }

  const mappings = Array.isArray(cfg.mappings) ? cfg.mappings : [];
  for (const row of mappings) {
    if (!row) continue;
    const rp = String(row.platformId != null ? row.platformId : row.platfromid || '');
    const rg = String(row.gameId != null ? row.gameId : row.gameid || '*');
    if (rp !== platformId && rp !== '*') continue;
    if (rg !== '*' && rg !== String(ossGameId)) continue;
    if (row.nApiID != null) nApiID = Number(row.nApiID);
    if (row.nOriginalID != null) nOriginalID = Number(row.nOriginalID);
    if (row.kindId != null && !nOriginalID) nOriginalID = Number(row.kindId);
    if (row.gameName && !gameName) gameName = String(row.gameName);
    break;
  }

  if (!nOriginalID && gameName) {
    const ids = listOriginalIdsByName(gameName);
    nOriginalID = pickBestOriginalId(ids, platformId, ossGameId);
  }
  if (!nOriginalID && ossGameId && !isOssCatalogGameId(ossGameId)) {
    nOriginalID = resolveOriginalIdFromOssGameId(ossGameId, nApiID);
  }

  const bandApi = inferApiFromOriginalId(nOriginalID);
  if (bandApi && bandApi !== nApiID) nApiID = bandApi;

  const meta = apiMeta(nApiID);
  const rowKeyOk = ossRow && ossRow.game_key && (
    ossRow.nApiID == null || Number(ossRow.nApiID) === nApiID
  );
  const game_key = (rowKeyOk && ossRow.game_key) || plat.game_key || meta.gameKey;
  const gameid = nOriginalID ? computeCreateGameId(nApiID, nOriginalID) : 0;
  const pgWay = meta.pl === 'pg' || meta.pl === 'vintepg';

  return {
    nApiID,
    nGameID: gameid,
    nOriginalID,
    gameid,
    game_key,
    pg_new_way_login: pgWay ? 1 : 0,
    gameName: gameName || ('Game-' + nOriginalID),
    trial: 0
  };
}

module.exports = {
  apiMeta,
  normalizeName,
  loadGameNameIndex,
  resolveByGameName,
  resolveOriginalIdFromOssGameId,
  resolveCreateUserTarget,
  fixGameId,
  computeCreateGameId,
  DEFAULT_PLATFORM_MAP
};
