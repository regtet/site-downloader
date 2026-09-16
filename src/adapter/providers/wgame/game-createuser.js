/**
 * 对齐 wgame_web：优先 POST /api/game/forward（createuser）；
 * 无 httpToken 时回退旧大厅 WS httpProxy。
 */
const crypto = require('crypto');
const { wgameAuth } = require('./client');
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

function canResumeHallSession(sessionUser) {
  if (!sessionUser) return false;
  if (!sessionUser.session) return false;
  const loginID = Number(sessionUser.userId);
  if (!Number.isFinite(loginID) || loginID <= 0) return false;
  if (sessionUser.hall_server_id == null || sessionUser.hall_branch_id == null) return false;
  return true;
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

async function createUserViaHttpForward(sessionUser, target, wgameCfg, opts) {
  const { httpGameForward } = require('./http-api');
  const postData = buildCreateUserPostData(sessionUser, target);
  if (!postData.roleid) return { ok: false, msg: 'wgame userId missing for createuser' };
  const token = sessionUser.httpToken || sessionUser.session;
  if (!token) return { ok: false, msg: 'httpToken missing for game/forward' };

  try {
    console.info('[wgame] createuser via http /api/game/forward userId=' + postData.roleid);
  } catch (_) { /* ignore */ }

  const fwd = await httpGameForward({
    token,
    url: 3,
    uri: '/index/createuser',
    data: postData,
    cfg: wgameCfg,
    timeoutMs: (opts && opts.timeoutMs) || 35000
  });
  const parsed = parseCreateUserResult(fwd.res);
  if (!parsed.ok) {
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
    via: 'http-forward'
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

/**
 * @param {{ userId: string, account?: string, password?: string, httpToken?: string }} sessionUser
 * @param {object} target from resolveCreateUserTarget
 * @param {{ wgameConfig?: object }} opts
 */
async function createUserGameLaunch(sessionUser, target, opts) {
  const wgameCfg = (opts && opts.wgameConfig) || {};
  try {
    if (sessionUser && (sessionUser.httpToken || sessionUser.authTransport === 'http')) {
      return await createUserViaHttpForward(sessionUser, target, wgameCfg, opts);
    }
    if (!wgameCfg.wssUrl) {
      return { ok: false, msg: 'wgame wssUrl missing' };
    }
    return await createUserViaHallProxy(sessionUser, target, wgameCfg, opts);
  } catch (err) {
    return { ok: false, msg: (err && err.message) || 'createuser failed' };
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
  createUserViaHttpForward,
  parseCreateUserResponse
};
