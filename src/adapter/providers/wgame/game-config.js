/**
 * 游戏启动：dist UI 展示 OSS 列表，点击后映射到 wgame 自有游戏。
 * 配置：adapter-hosts.json → providerOptions.game
 */
const path = require('path');
const fs = require('fs');

const DEFAULT_GAME = {
  enabled: true,
  /** dist 自营平台路径；前端会替换 gogamesac/ 为 lobbyGameUrl */
  clientPath: 'gogamesac/clientv3/index.html',
  /** 注入 window.lobby_game_url，指向 wgame H5 客户端根 URL */
  lobbyGameUrl: '',
  /** 未命中 mappings 时是否全部落到 defaultTarget */
  fallbackToDefault: true,
  /** 视为自营平台（走 apiGetGameUrl + clientv3 重写） */
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
  if (raw.enabled === false) cfg.enabled = false;
  if (raw.clientPath) cfg.clientPath = String(raw.clientPath);
  if (raw.lobbyGameUrl) cfg.lobbyGameUrl = String(raw.lobbyGameUrl);
  if (raw.fallbackToDefault != null) cfg.fallbackToDefault = !!raw.fallbackToDefault;
  if (process.env.GAME_LOBBY_URL) cfg.lobbyGameUrl = String(process.env.GAME_LOBBY_URL);
  if (process.env.GAME_CLIENT_PATH) cfg.clientPath = String(process.env.GAME_CLIENT_PATH);
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

function buildGameLaunchData(body, sessionUser, cfg) {
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
  return {
    game_url: cfg.clientPath || DEFAULT_GAME.clientPath,
    gameName,
    direction: mapping.direction != null ? mapping.direction : 1,
    gameid: Number(gameId) || 0,
    platfromid: platformId,
    platformId,
    kindId: mapping.kindId,
    roomId: mapping.roomId
  };
}

function isSelfPlatform(cfg, platformId) {
  const pid = String(platformId || '');
  const ids = Array.isArray(cfg.selfPlatformIds) ? cfg.selfPlatformIds : [];
  return ids.some((id) => String(id) === pid);
}

module.exports = {
  DEFAULT_GAME,
  loadGameConfig,
  resolveGameMapping,
  buildGameLaunchData,
  isSelfPlatform,
  parseGameInfoFromBody
};
