/**
 * wgame 网关：护照登录/注册 + 大厅登录（取金币/资料）
 */
const WebSocket = require('ws');
const proto = require('./protocol');
const { applySystemProxy, getHttpsProxyAgent, resolveProxyUrl } = require('../../../system-proxy');
applySystemProxy({ log: false });

function defaultDeviceId(account) {
  return proto.md5Hex('sd-' + String(account || 'device')).slice(0, 32);
}

/**
 * @param {object} options
 */
function wgameAuth(options) {
  const wssUrl = options.wssUrl;
  const packageId = options.packageId != null ? options.packageId : 46;
  const timeoutMs = options.timeoutMs || 20000;
  const action = options.action || 'login';
  const account = String(options.account || '');
  const password = String(options.password || '');
  const nGmType = options.nGmType != null ? options.nGmType : 7;
  const inviteCode = Number(options.inviteCode || 0) || 0;
  const mobile = String(options.mobile || '');
  const deviceId = options.deviceId || defaultDeviceId(account);
  const passwordMd5 = proto.md5Hex(password);
  const skipHall = !!options.skipHall;
  const hallAction = options.hallAction || ''; // '' | payChannels | payCharge | proxyInvite | httpProxy
  const chargeOpts = options.charge || {};
  const httpProxyPack = options.httpProxyPack || null;
  const resumeSession = options.resumeSession || null;
  let resumeTried = false;

  return new Promise((resolve, reject) => {
    let settled = false;
    let verified = false;
    let passport = null;
    let hallState = null;
    let waitingPay = '';
    let ws;

    const done = (err, data) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (ws) ws.close(); } catch (_) { /* ignore */ }
      if (err) reject(err);
      else resolve(data);
    };

    const timer = setTimeout(() => {
      done(new Error('wgame gateway timeout'));
    }, timeoutMs);

    try {
      const agent = getHttpsProxyAgent();
      const wsOpts = {
        handshakeTimeout: Math.min(10000, timeoutMs),
        rejectUnauthorized: false
      };
      if (agent) wsOpts.agent = agent;
      ws = new WebSocket(wssUrl, wsOpts);
      if (agent && resolveProxyUrl()) {
        try { console.info('[wgame] connect via proxy', wssUrl); } catch (_) { /* ignore */ }
      }
    } catch (e) {
      done(e);
      return;
    }

    ws.binaryType = 'nodebuffer';

    ws.on('open', () => {
      try {
        ws.send(proto.encodeXorKeyReq());
      } catch (e) {
        done(e);
      }
    });

    ws.on('error', (err) => {
      done(err || new Error('wgame websocket error'));
    });

    ws.on('unexpected-response', (_req, res) => {
      done(new Error('Unexpected server response: ' + (res && res.statusCode)));
    });

    ws.on('close', () => {
      if (!settled) done(new Error('wgame websocket closed'));
    });

    const sendAuthPacket = () => {
      if (action === 'register') {
        const body = proto.encodeRegisterBody({
          account,
          passwordMd5,
          packageId,
          inviteCode,
          nGmType,
          mobile
        });
        ws.send(proto.encodePacket(
          proto.EST.LOGON,
          proto.LOGIN.MDM_REGISTER,
          proto.LOGIN.SUB_REG_NO_CHECK,
          body
        ));
      } else {
        const body = proto.encodeLoginBody({
          account,
          passwordMd5,
          deviceId,
          nGmType,
          packageId
        });
        ws.send(proto.encodePacket(
          proto.EST.LOGON,
          proto.LOGIN.MDM_LOGON,
          proto.LOGIN.SUB_REQ,
          body
        ));
      }
    };

    const afterRegisterOk = () => {
      const body = proto.encodeLoginBody({
        account,
        passwordMd5,
        deviceId,
        nGmType,
        packageId
      });
      ws.send(proto.encodePacket(
        proto.EST.LOGON,
        proto.LOGIN.MDM_LOGON,
        proto.LOGIN.SUB_REQ,
        body
      ));
    };

    const sendHallLogin = (hallCreds) => {
      const body = proto.encodeHallLoginBody({
        loginID: hallCreds.loginID,
        session: hallCreds.session,
        deviceId: hallCreds.deviceId || deviceId,
        nServerId: hallCreds.nServerId,
        nBranchId: hallCreds.nBranchId
      });
      ws.send(proto.encodePacket(
        proto.EST.HALL,
        proto.HALL.MDM_LOGON,
        proto.HALL.SUB_REQ,
        body
      ));
    };

    const beginHallResume = (rs) => {
      passport = {
        dwUserID: rs.loginID,
        sSession: rs.session,
        nHallServerId: rs.nServerId,
        nHallBranchId: rs.nBranchId
      };
      sendHallLogin(rs);
    };

    const canResume = !!(resumeSession && resumeSession.session
      && Number.isFinite(Number(resumeSession.loginID)) && Number(resumeSession.loginID) > 0);

    const afterTokenVerified = () => {
      if (canResume) {
        resumeTried = true;
        beginHallResume(resumeSession);
        return;
      }
      if (hallAction === 'httpProxy') {
        done(Object.assign(new Error('session expired for game launch, please logout and login again'), {
          code: 10061
        }));
        return;
      }
      sendAuthPacket();
    };

    const enterHall = (ok) => {
      passport = ok;
      if (skipHall) {
        done(null, {
          ok: true,
          action,
          account,
          deviceId,
          ...ok,
          hall: null,
          game_gold: 0
        });
        return;
      }
      sendHallLogin({
        loginID: ok.dwUserID,
        session: ok.sSession,
        deviceId,
        nServerId: ok.nHallServerId,
        nBranchId: ok.nHallBranchId
      });
    };

    const finishWithHall = (hall) => {
      hallState = hall;
      const base = {
        ok: true,
        action,
        account,
        deviceId,
        ...passport,
        hall,
        game_gold: hall && hall.game_gold != null ? hall.game_gold : 0,
        nickname: (hall && (hall.nickname || hall.szAccountName)) || account,
        phone: (hall && hall.secPhone) || '',
        email: (hall && hall.szMail) || '',
        nVipLevel: hall ? hall.nVipLevel : 0,
        faceID: hall ? hall.faceID : 0,
        happyMoney: hall ? hall.happyMoney : 0,
        lGameScore: hall ? hall.lGameScore : 0,
        bFirstLogin: hall ? hall.bFirstLogin : 0,
        bHasRecharge: hall ? hall.bHasRecharge : 0,
        accountType: hall && hall.accountType != null ? hall.accountType : undefined
      };

      if (!hallAction) {
        done(null, base);
        return;
      }

      const roleId = (passport && passport.dwUserID)
        || (hall && hall.userID)
        || 0;
      if (!roleId) {
        done(Object.assign(new Error('wgame hall userId missing for pay'), { code: 10063 }));
        return;
      }

      try {
        if (hallAction === 'payChannels') {
          waitingPay = 'payChannels';
          ws.send(proto.encodeQueryPayChannel(roleId));
          return;
        }
        if (hallAction === 'payCharge') {
          waitingPay = 'payCharge';
          ws.send(proto.encodeCharge({
            orderType: chargeOpts.orderType != null ? chargeOpts.orderType : 3,
            channelId: chargeOpts.channelId,
            money: chargeOpts.money
          }));
          return;
        }
        if (hallAction === 'proxyInvite') {
          waitingPay = 'proxyInvite';
          ws.send(proto.encodeProxyInviteInfoReq());
          return;
        }
        if (hallAction === 'httpProxy' && httpProxyPack) {
          waitingPay = 'httpProxy';
          ws.send(proto.encodeHttpCommonReq(httpProxyPack));
          return;
        }
      } catch (e) {
        done(e);
        return;
      }
      done(null, base);
    };

    ws.on('message', (data) => {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const head = proto.decodeHead(buf);
        if (!head) return;

        if (head.wMainCmdID === proto.KN.MDM_COMMAND && head.wSubCmdID === proto.KN.SUB_DETECT) {
          ws.send(proto.encodeDetectSocket());
          return;
        }

        if (head.wMainCmdID === proto.KN.MDM_SOCKET && head.wSubCmdID === proto.KN.SUB_TOKEN_RES) {
          const token = proto.readToken(buf);
          ws.send(proto.encodeMd5Verify(token));
          verified = true;
          afterTokenVerified();
          return;
        }

        if (head.wMainCmdID === proto.KN.MDM_COMMAND || head.wMainCmdID === proto.KN.MDM_SOCKET) {
          return;
        }

        if (!verified) return;

        if (head.cbServerType === proto.EST.GATE
          && head.wMainCmdID === proto.GATE.MDM_SOCK) {
          return;
        }

        if (head.cbServerType === proto.EST.LOGON || head.wMainCmdID === proto.LOGIN.MDM_LOGON
          || head.wMainCmdID === proto.LOGIN.MDM_REGISTER) {
          if (head.wMainCmdID === proto.LOGIN.MDM_LOGON) {
            if (head.wSubCmdID === proto.LOGIN.SUB_OK) {
              enterHall(proto.parseLogonOK(buf));
              return;
            }
            if (head.wSubCmdID === proto.LOGIN.SUB_ERROR) {
              const err = proto.parseLoginError(buf);
              done(Object.assign(new Error(err.szErrorDescribe || ('login error ' + err.dwErrorCode)), {
                code: err.dwErrorCode,
                detail: err
              }));
              return;
            }
          }
          if (head.wMainCmdID === proto.LOGIN.MDM_REGISTER) {
            if (head.wSubCmdID === proto.LOGIN.SUB_REG_OK) {
              afterRegisterOk();
              return;
            }
            if (head.wSubCmdID === proto.LOGIN.SUB_REG_ERR) {
              const err = proto.parseRegisterError(buf);
              done(Object.assign(new Error('register error ' + err.lErrorCode), {
                code: err.lErrorCode,
                detail: err
              }));
              return;
            }
          }
        }

        if (head.cbServerType === proto.EST.HALL || head.wMainCmdID === proto.HALL.MDM_LOGON) {
          if (head.wMainCmdID === proto.HALL.MDM_LOGON && head.wSubCmdID === proto.HALL.SUB_OK) {
            finishWithHall(proto.parseHallLogonRes(buf));
            return;
          }
          if (head.wMainCmdID === proto.HALL.MDM_LOGON && head.wSubCmdID === proto.HALL.SUB_ERROR) {
            const err = proto.parseHallLoginError(buf);
            console.warn('[wgame] hall login failed', err.errorCode, err.errorDescribe);
            if (resumeTried && hallAction !== 'httpProxy' && account && password) {
              resumeTried = false;
              sendAuthPacket();
              return;
            }
            if (resumeTried && hallAction === 'httpProxy') {
              done(Object.assign(new Error('hall session expired (' + err.errorCode + '), please re-login'), {
                code: err.errorCode || 10062
              }));
              return;
            }
            finishWithHall(null);
            return;
          }
        }

        if (waitingPay === 'payChannels'
          && head.wMainCmdID === proto.PAY.MDM_PAY
          && head.wSubCmdID === proto.PAY.SUB_QUERY_CHANNEL) {
          const channels = proto.parsePayChannels(buf);
          done(null, {
            ok: true,
            action: 'payChannels',
            account,
            deviceId,
            ...passport,
            hall: hallState,
            payChannels: channels.list || []
          });
          return;
        }

        if (waitingPay === 'payCharge'
          && head.wMainCmdID === proto.PAY.MDM_HTTP
          && head.wSubCmdID === proto.PAY.SUB_CHARGE) {
          const charge = proto.parseChargeRet(buf);
          done(null, {
            ok: true,
            action: 'payCharge',
            account,
            deviceId,
            ...passport,
            hall: hallState,
            charge
          });
          return;
        }

        if (waitingPay === 'proxyInvite'
          && head.wMainCmdID === proto.ROLE.MDM_ROLE
          && head.wSubCmdID === proto.ROLE.SUB_PROXY_INVITE_INFO) {
          const proxyInvite = proto.parseProxyInviteInfo(buf);
          done(null, {
            ok: true,
            action: 'proxyInvite',
            account,
            deviceId,
            ...passport,
            hall: hallState,
            proxyInvite
          });
          return;
        }

        if (waitingPay === 'httpProxy'
          && head.wMainCmdID === proto.HTTP.MDM_HTTP_REQ
          && head.wSubCmdID === proto.HTTP.SUB_HTTP_COMMON_RET) {
          const httpProxy = proto.parseHttpCommonRet(buf);
          done(null, {
            ok: true,
            action: 'httpProxy',
            account,
            deviceId,
            ...passport,
            hall: hallState,
            httpProxy
          });
          return;
        }
      } catch (e) {
        done(e);
      }
    });
  });
}

module.exports = {
  wgameAuth,
  defaultDeviceId
};
