/**
 * 将 dist OSS 游戏 (platformId/gameName) 映射到 wgame createuser 参数。
 * 名称表来自 wgame_web GameName.js，平台默认表可配 adapter-hosts。
 */
const fs = require('fs');
const path = require('path');
const { resolveWgameWebRoot } = require('./wgame-web-config');
const { isOssCatalogGameId, resolveOssGameName, resolveOssGameRow } = require('./oss-game-catalog');

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

function resolveByGameName(name, nApiID) {
  const norm = normalizeName(name);
  if (!norm) return 0;
  const { byName } = loadGameNameIndex();
  let ids = byName.get(norm) || [];
  if (!ids.length) {
    for (const [k, v] of byName.entries()) {
      if (k === norm || k.includes(norm) || norm.includes(k)) {
        ids = ids.concat(v);
      }
    }
  }
  ids = [...new Set(ids)];
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

function resolveCreateUserTarget(body, cfg, siteDir) {
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
      if (ossRow.nOriginalID && !nOriginalID) nOriginalID = Number(ossRow.nOriginalID);
    }
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

  if (!nOriginalID && gameName) nOriginalID = resolveByGameName(gameName, nApiID);
  if (!nOriginalID && ossGameId && !isOssCatalogGameId(ossGameId)) {
    nOriginalID = resolveOriginalIdFromOssGameId(ossGameId, nApiID);
  }

  const meta = apiMeta(nApiID);
  const game_key = plat.game_key || (ossRow && ossRow.game_key) || meta.gameKey;
  const gameid = nOriginalID ? computeCreateGameId(nApiID, nOriginalID) : 0;

  return {
    nApiID,
    nGameID: gameid,
    nOriginalID,
    gameid,
    game_key,
    pg_new_way_login: plat.pg_new_way_login ? 1 : 0,
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
