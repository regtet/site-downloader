/**
 * 游戏启动：dist UI 展示 OSS 列表，点击后映射到 wgame 自有游戏。
 * 配置：adapter-hosts.json → providerOptions.game
 */
const path = require('path');
const fs = require('fs');

const { loadWgameConfig } = require('./config');
const { loadWgameWebConfig } = require('./wgame-web-config');

const DEFAULT_GAME = {
  enabled: true,
  /** dist 自营平台路径；前端会替换 gogamesac/ 为 lobbyGameUrl */
  clientPath: 'gogamesac/clientv3/index.html',
  /** 注入 window.lobby_game_url，指向 wgame H5 客户端根 URL（可留空，从 wssUrl 推导） */
  lobbyGameUrl: '',
  /** createuser=走 wgame_web /index/createuser；clientv3=旧 gogamesac 壳 */
  launchMode: 'createuser',
  /** dist platformId → wgame nApiID */
  platformMap: {},
  /** 未命中 mappings 时是否全部落到 defaultTarget（clientv3 模式） */
  fallbackToDefault: true,
  /** createuser 失败时是否回退 gogamesac 壳 */
  fallbackToClient: false,
  selfPlatformIds: ['0999'],
  defaultTarget: {
    kindId: 1,
    roomId: 0,
    gameName: 'WGame',
    direction: 1
  },
  /**
   * 精确映射：OSS platformId + gameId → wgame 目标
   * gameId 可用 "*" 匹配该平台全部游戏
   */
  mappings: []
};

/** wss://server.example.com → https://www.example.com/gogameccc/ */
function deriveLobbyGameUrlFromWss(wssUrl) {
  if (!wssUrl) return '';
  try {
    const u = new URL(String(wssUrl).replace(/^ws/i, 'http'));
    let host = u.hostname;
    if (/^server\./i.test(host)) {
      host = host.replace(/^server\./i, 'www.');
    } else if (!/^www\./i.test(host)) {
      host = 'www.' + host;
    }
    return `https://${host}/gogameccc/`;
  } catch (_) {
    return '';
  }
}

function resolveLobbyGameUrl(cfg, siteDir) {
  if (cfg.lobbyGameUrl) return String(cfg.lobbyGameUrl).replace(/\/?$/, '/');
  if (process.env.GAME_LOBBY_URL) return String(process.env.GAME_LOBBY_URL).replace(/\/?$/, '/');
  const web = loadWgameWebConfig();
  if (web && web.lobbyGameUrl) return String(web.lobbyGameUrl).replace(/\/?$/, '/');
  const wg = loadWgameConfig(siteDir);
  if (wg && wg.wgameWeb && wg.wgameWeb.lobbyGameUrl) {
    return String(wg.wgameWeb.lobbyGameUrl).replace(/\/?$/, '/');
  }
  return deriveLobbyGameUrlFromWss(wg && wg.wssUrl);
}

function buildClientGameUrl(cfg, siteDir) {
  const rel = String(cfg.clientPath || DEFAULT_GAME.clientPath);
  const root = resolveLobbyGameUrl(cfg, siteDir);
  if (!root) return rel;
  return root + rel.replace(/^gogamesac\//, '');
}

function loadGameConfig(siteDir, providerOptions) {
  let raw = {};
  try {
    if (providerOptions && providerOptions.game && typeof providerOptions.game === 'object') {
      raw = providerOptions.game;
    } else if (siteDir) {
      const p = path.join(siteDir, 'adapter-hosts.json');
      if (fs.existsSync(p)) {
        const hosts = JSON.parse(fs.readFileSync(p, 'utf8'));
        const po = (hosts && hosts.providerOptions) || {};
        if (po.game && typeof po.game === 'object') raw = po.game;
      }
    }
  } catch (_) { /* ignore */ }

  const cfg = Object.assign({}, DEFAULT_GAME, raw || {});
  cfg.defaultTarget = Object.assign({}, DEFAULT_GAME.defaultTarget, raw.defaultTarget || {});
  if (Array.isArray(raw.selfPlatformIds)) cfg.selfPlatformIds = raw.selfPlatformIds.slice();
  if (Array.isArray(raw.mappings)) cfg.mappings = raw.mappings.slice();
  if (raw.platformMap && typeof raw.platformMap === 'object') {
    cfg.platformMap = Object.assign({}, raw.platformMap);
  }
  if (raw.launchMode) cfg.launchMode = String(raw.launchMode);
  if (raw.fallbackToDefault != null) cfg.fallbackToDefault = !!raw.fallbackToDefault;
  if (raw.fallbackToClient != null) cfg.fallbackToClient = !!raw.fallbackToClient;
  if (process.env.GAME_LAUNCH_MODE) cfg.launchMode = String(process.env.GAME_LAUNCH_MODE);
  if (raw.enabled === false) cfg.enabled = false;
  if (raw.clientPath) cfg.clientPath = String(raw.clientPath);
  if (raw.lobbyGameUrl) cfg.lobbyGameUrl = String(raw.lobbyGameUrl);
  if (process.env.GAME_LOBBY_URL) cfg.lobbyGameUrl = String(process.env.GAME_LOBBY_URL);
  if (process.env.GAME_CLIENT_PATH) cfg.clientPath = String(process.env.GAME_CLIENT_PATH);
  const resolvedLobby = resolveLobbyGameUrl(cfg, siteDir);
  if (resolvedLobby) cfg.lobbyGameUrl = resolvedLobby;
  return cfg;
}

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

function resolveGameMapping(cfg, platformId, gameId, body) {
  const pid = String(platformId || '');
  const gid = gameId != null && gameId !== '' ? String(gameId) : '0';
  const info = parseGameInfoFromBody(body);
  const list = Array.isArray(cfg.mappings) ? cfg.mappings : [];
  let hit = null;
  for (const row of list) {
    if (!row) continue;
    const rp = String(row.platformId != null ? row.platformId : row.platfromid || '');
    const rg = String(row.gameId != null ? row.gameId : row.gameid || '*');
    if (rp !== pid) continue;
    if (rg !== '*' && rg !== gid) continue;
    hit = row;
    break;
  }
  if (!hit && cfg.fallbackToDefault) hit = cfg.defaultTarget;
  if (!hit) return null;
  const base = cfg.defaultTarget || {};
  return {
    kindId: hit.kindId != null ? Number(hit.kindId) : (base.kindId != null ? base.kindId : 1),
    roomId: hit.roomId != null ? Number(hit.roomId) : (base.roomId != null ? base.roomId : 0),
    gameName: hit.gameName || info.gameName || info.name || base.gameName || 'Game',
    direction: hit.direction != null ? Number(hit.direction) : (base.direction != null ? base.direction : 1)
  };
}

function buildClientGameLaunchData(body, sessionUser, cfg, siteDir) {
  const platformId = String(
    body.platfromid != null ? body.platfromid
      : (body.platformId != null ? body.platformId : '')
  );
  const gameId = body.gameid != null ? body.gameid : (body.gameId != null ? body.gameId : 0);
  const mapping = resolveGameMapping(cfg, platformId, gameId, body);
  if (!mapping) return null;
  const info = parseGameInfoFromBody(body);
  const gameName = mapping.gameName
    || info.gameName
    || info.name
    || (sessionUser && sessionUser.nickname)
    || 'Game';
  const wgameId = mapping.kindId != null ? Number(mapping.kindId) : (Number(gameId) || 0);
  return {
    game_url: buildClientGameUrl(cfg, siteDir),
    gameName,
    direction: mapping.direction != null ? mapping.direction : 1,
    gameid: wgameId,
    platfromid: platformId,
    platformId,
    kindId: mapping.kindId,
    roomId: mapping.roomId
  };
}

/** 与 wgame_web OtherGameHall 一致：createuser 拿真实游戏 URL */
async function resolveGameLaunch(body, sessionUser, cfg, siteDir) {
  const platformId = String(
    body.platfromid != null ? body.platfromid
      : (body.platformId != null ? body.platformId : '')
  );
  const mode = String(cfg.launchMode || 'createuser').toLowerCase();

  if (mode === 'createuser') {
    const { resolveCreateUserTarget } = require('./game-catalog');
    const { createUserGameLaunch } = require('./game-createuser');
    const { loadWgameConfig } = require('./config');
    const wgameCfg = loadWgameConfig(siteDir);
    const target = resolveCreateUserTarget(body, cfg, siteDir);
    if (!target.nOriginalID || !target.gameid) {
      const pid = platformId || '?';
      const gid = body.gameid != null ? body.gameid : (body.gameId != null ? body.gameId : 0);
      const err = new Error(
        'game mapping missing for platformId=' + pid + ' gameid=' + gid
        + (gid === 0 ? ' (click a specific game, not platform header)' : '')
      );
      throw err;
    }
    if (target.nApiID !== 0 && target.game_key) {
      const launch = await createUserGameLaunch(sessionUser, target, { wgameConfig: wgameCfg });
      if (launch.ok && launch.game_url) {
        return {
          game_url: launch.game_url,
          gameName: target.gameName,
          direction: 1,
          gameid: target.gameid,
          platfromid: platformId,
          platformId,
          kindId: target.nOriginalID,
          roomId: 0,
          launchMode: 'createuser',
          wgameTarget: target
        };
      }
      if (!cfg.fallbackToClient) {
        const err = new Error(launch.msg || 'createuser failed');
        err.launch = launch;
        throw err;
      }
    }
  }

  return buildClientGameLaunchData(body, sessionUser, cfg, siteDir);
}

function isSelfPlatform(cfg, platformId) {
  const pid = String(platformId || '');
  const ids = Array.isArray(cfg.selfPlatformIds) ? cfg.selfPlatformIds : [];
  return ids.some((id) => String(id) === pid);
}

module.exports = {
  DEFAULT_GAME,
  deriveLobbyGameUrlFromWss,
  resolveLobbyGameUrl,
  buildClientGameUrl,
  loadGameConfig,
  resolveGameMapping,
  buildClientGameLaunchData,
  resolveGameLaunch,
  buildGameLaunchData: buildClientGameLaunchData,
  isSelfPlatform,
  parseGameInfoFromBody
};
