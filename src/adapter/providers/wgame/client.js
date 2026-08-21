/**
 * wgame 网关：护照登录/注册 + 大厅登录（取金币/资料）
 */
const WebSocket = require('ws');
const proto = require('./protocol');

function defaultDeviceId(account) {
  return proto.md5Hex('sd-' + String(account || 'device') + '-' + Date.now()).slice(0, 32);
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

  return new Promise((resolve, reject) => {
    let settled = false;
    let verified = false;
    let passport = null;
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
      ws = new WebSocket(wssUrl, {
        handshakeTimeout: Math.min(10000, timeoutMs),
        rejectUnauthorized: false
      });
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
      // 对齐 HallKernel.sendHallLoginPacket：首登直接 EST_HALL 登录
      //（网关 isLogonCMD 放行 1101，无需先 SockConnect）
      const body = proto.encodeHallLoginBody({
        loginID: ok.dwUserID,
        session: ok.sSession,
        deviceId,
        nServerId: ok.nHallServerId,
        nBranchId: ok.nHallBranchId
      });
      ws.send(proto.encodePacket(
        proto.EST.HALL,
        proto.HALL.MDM_LOGON,
        proto.HALL.SUB_REQ,
        body
      ));
    };

    const finishWithHall = (hall) => {
      done(null, {
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
        bHasRecharge: hall ? hall.bHasRecharge : 0
      });
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
          sendAuthPacket();
          return;
        }

        if (head.wMainCmdID === proto.KN.MDM_COMMAND || head.wMainCmdID === proto.KN.MDM_SOCKET) {
          return;
        }

        if (!verified) return;

        // 网关 SockConnect 回包：可忽略，大厅登录包已发出
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

        // 大厅登录结果
        if (head.cbServerType === proto.EST.HALL || head.wMainCmdID === proto.HALL.MDM_LOGON) {
          if (head.wMainCmdID === proto.HALL.MDM_LOGON && head.wSubCmdID === proto.HALL.SUB_OK) {
            finishWithHall(proto.parseHallLogonRes(buf));
            return;
          }
          if (head.wMainCmdID === proto.HALL.MDM_LOGON && head.wSubCmdID === proto.HALL.SUB_ERROR) {
            const err = proto.parseHallLoginError(buf);
            // 大厅失败仍返回护照会话，金币为 0，避免整次登录失败
            console.warn('[wgame] hall login failed', err.errorCode, err.errorDescribe);
            finishWithHall(null);
            return;
          }
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
