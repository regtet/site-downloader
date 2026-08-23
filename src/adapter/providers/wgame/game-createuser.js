/**
 * 对齐 wgame_web：经大厅 WebSocket HTTP 代理 POST /index/createuser。
 * wgame_web 走 HallKernel.httpProxy，由服务端补 sign/time/language 并转发。
 */
const crypto = require('crypto');
const axios = require('axios');
const { wgameAuth } = require('./client');
const { loadWgameWebConfig } = require('./wgame-web-config');
const { applySystemProxy } = require('../../../system-proxy');

applySystemProxy({ log: false });

function md5Hex(s) {
  return crypto.createHash('md5').update(String(s)).digest('hex');
}

function signCreateUser({ roleid, gameid, language, time }, otherGameApiKey) {
  const paramStr = String(roleid) + String(gameid) + String(language) + String(time) + String(otherGameApiKey || '');
  return md5Hex(paramStr).toLowerCase();
}

function buildCreateUserPostData(sessionUser, target) {
  const roleid = sessionUser && (sessionUser.userId || sessionUser.userid);
  const postData = {
    roleid: String(roleid || ''),
    gameid: Number(target.gameid),
    game_key: target.game_key || '',
    originalid: Number(target.nOriginalID || target.nGameID || 0),
    trial: target.trial != null ? Number(target.trial) : 0
  };
  if (target.pg_new_way_login) postData.pg_new_way_login = 1;
  return postData;
}

function buildHttpProxyPack(postData) {
  return {
    url: 3,
    uri: '/index/createuser',
    data: JSON.stringify(postData),
    type: 'POST',
    uuid: Date.now().toString()
  };
}

function parseCreateUserResult(j) {
  if (!j || typeof j !== 'object') {
    return { ok: false, msg: 'createuser invalid json' };
  }
  if (j.success === true && j.data) {
    return { ok: true, game_url: String(j.data), html: j.html || null, code: 0 };
  }
  if (Number(j.code) === 0) {
    if (j.html) return { ok: true, game_url: String(j.html), html: String(j.html), code: 0, isHtml: true };
    if (j.data) return { ok: true, game_url: String(j.data), html: null, code: 0 };
  }
  return {
    ok: false,
    code: j.code != null ? j.code : -1,
    msg: j.message || j.msg || ('createuser code=' + j.code)
  };
}

function parseCreateUserResponse(res) {
  return parseCreateUserResult(res && res.json);
}

async function httpPostJson(urlStr, body, timeoutMs) {
  applySystemProxy({ log: false });
  const res = await axios.post(urlStr, body || {}, {
    timeout: timeoutMs || 30000,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json'
    },
    validateStatus: () => true
  });
  const json = res.data && typeof res.data === 'object' ? res.data : null;
  const raw = json ? JSON.stringify(json) : String(res.data || '');
  return { status: res.status, json, raw };
}

function resolveHttpBase(web) {
  if (!web) return '';
  if (process.env.WGAME_HTTP_BASE) return String(process.env.WGAME_HTTP_BASE).replace(/\/$/, '');
  const base = web.debug ? (web.mockUrl || web.baseUrl) : (web.baseUrl || web.mockUrl);
  return String(base || '').replace(/\/$/, '');
}

function canResumeHallSession(sessionUser) {
  const loginID = Number(sessionUser && sessionUser.userId);
  return !!(sessionUser
    && sessionUser.session
    && Number.isFinite(loginID) && loginID > 0
    && sessionUser.hall_server_id != null
    && sessionUser.hall_branch_id != null);
}

function buildResumeSession(sessionUser) {
  if (!canResumeHallSession(sessionUser)) return null;
  const loginID = Number(sessionUser.userId);
  return {
    loginID,
    session: String(sessionUser.session),
    deviceId: sessionUser.device_id || undefined,
    nServerId: Number(sessionUser.hall_server_id),
    nBranchId: Number(sessionUser.hall_branch_id)
  };
}

async function createUserViaHallProxy(sessionUser, target, wgameCfg, opts) {
  const account = sessionUser && sessionUser.account;
  const password = sessionUser && sessionUser.password;
  const postData = buildCreateUserPostData(sessionUser, target);
  if (!postData.roleid) return { ok: false, msg: 'wgame userId missing for createuser' };

  const pack = buildHttpProxyPack(postData);
  const authOpts = {
    wssUrl: wgameCfg.wssUrl,
    packageId: wgameCfg.packageId,
    timeoutMs: (opts && opts.timeoutMs) || 35000,
    nGmType: wgameCfg.nGmType,
    deviceId: sessionUser.device_id || undefined,
    hallAction: 'httpProxy',
    httpProxyPack: pack
  };

  const resume = buildResumeSession(sessionUser);
  if (!resume) {
    try {
      console.warn('[wgame] createuser blocked: user', sessionUser && sessionUser.userId, 'missing hall fields', {
        session: !!(sessionUser && sessionUser.session),
        hall_server_id: sessionUser && sessionUser.hall_server_id,
        hall_branch_id: sessionUser && sessionUser.hall_branch_id
      });
    } catch (_) { /* ignore */ }
    return {
      ok: false,
      msg: 'session expired for game launch, please logout and login again'
    };
  }

  authOpts.resumeSession = resume;
  authOpts.account = account || '';
  authOpts.password = password || '';
  try { console.info('[wgame] createuser via hall resume userId=' + sessionUser.userId); } catch (_) { /* ignore */ }

  const res = await wgameAuth(authOpts);

  const hp = res && res.httpProxy;
  if (!hp || !hp.result) {
    return {
      ok: false,
      msg: 'createuser hall proxy empty response',
      raw: hp && hp.raw
    };
  }
  const parsed = parseCreateUserResult(hp.result);
  if (!parsed.ok) {
    parsed.raw = hp.raw;
    try {
      console.warn('[wgame] createuser failed', {
        code: parsed.code,
        msg: parsed.msg,
        target: {
          nApiID: target.nApiID,
          gameid: target.gameid,
          nOriginalID: target.nOriginalID,
          game_key: target.game_key
        },
        postData
      });
    } catch (_) { /* ignore */ }
    return parsed;
  }
  const gameUrl = parsed.isHtml ? parsed.html : parsed.game_url;
  return {
    ok: true,
    game_url: gameUrl,
    html: parsed.html,
    isHtml: !!parsed.isHtml,
    code: 0,
    target,
    via: 'hall'
  };
}

async function createUserViaDirectHttp(sessionUser, target, opts) {
  const web = loadWgameWebConfig();
  const httpBase = resolveHttpBase(web);
  if (!httpBase) {
    return { ok: false, msg: 'wgame_web http base missing (baseUrl/mockUrl)' };
  }
  const roleid = sessionUser && (sessionUser.userId || sessionUser.userid);
  if (!roleid) return { ok: false, msg: 'wgame userId missing for createuser' };

  const otherGameApiKey = (web && web.otherGameApiKey)
    || process.env.WGAME_OTHER_GAME_API_KEY
    || '';
  const time = Math.floor(Date.now() / 1000).toString();
  const language = (opts && opts.language) || process.env.WGAME_GAME_LANGUAGE || 'EN';

  const payload = buildCreateUserPostData(sessionUser, target);
  payload.time = time;
  payload.language = language;
  payload.sign = signCreateUser(payload, otherGameApiKey);

  const url = httpBase + '/index/createuser';
  const res = await httpPostJson(url, payload, (opts && opts.timeoutMs) || 30000);
  const parsed = parseCreateUserResponse(res);
  if (!parsed.ok) {
    parsed.raw = res.raw;
    parsed.status = res.status;
    return parsed;
  }
  const gameUrl = parsed.isHtml ? parsed.html : parsed.game_url;
  return {
    ok: true,
    game_url: gameUrl,
    html: parsed.html,
    isHtml: !!parsed.isHtml,
    code: 0,
    target,
    via: 'http'
  };
}

/**
 * @param {{ userId: string, account?: string, password?: string }} sessionUser
 * @param {object} target from resolveCreateUserTarget
 * @param {{ wgameConfig?: object }} opts
 */
async function createUserGameLaunch(sessionUser, target, opts) {
  const wgameCfg = (opts && opts.wgameConfig) || {};
  if (!wgameCfg.wssUrl) {
    return { ok: false, msg: 'wgame wssUrl missing' };
  }
  try {
    return await createUserViaHallProxy(sessionUser, target, wgameCfg, opts);
  } catch (err) {
    return { ok: false, msg: (err && err.message) || 'createuser hall proxy failed' };
  }
}

module.exports = {
  signCreateUser,
  buildCreateUserPostData,
  buildHttpProxyPack,
  canResumeHallSession,
  buildResumeSession,
  parseCreateUserResult,
  createUserGameLaunch,
  createUserViaHallProxy,
  createUserViaDirectHttp,
  resolveHttpBase,
  parseCreateUserResponse
};
