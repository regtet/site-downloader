/**
 * wgame 网关一次性登录/注册会话
 */
const WebSocket = require('ws');
const proto = require('./protocol');

function defaultDeviceId(account) {
  return proto.md5Hex('sd-' + String(account || 'device') + '-' + Date.now()).slice(0, 32);
}

/**
 * @param {object} options
 * @param {string} options.wssUrl
 * @param {number} [options.packageId=46]
 * @param {number} [options.timeoutMs=15000]
 * @param {'login'|'register'} options.action
 * @param {string} options.account
 * @param {string} options.password plain text
 * @param {number} [options.nGmType=7]
 * @param {number} [options.inviteCode=0]
 * @param {string} [options.mobile='']
 * @param {string} [options.deviceId]
 */
function wgameAuth(options) {
  const wssUrl = options.wssUrl;
  const packageId = options.packageId != null ? options.packageId : 46;
  const timeoutMs = options.timeoutMs || 15000;
  const action = options.action || 'login';
  const account = String(options.account || '');
  const password = String(options.password || '');
  const nGmType = options.nGmType != null ? options.nGmType : 7;
  const inviteCode = Number(options.inviteCode || 0) || 0;
  const mobile = String(options.mobile || '');
  const deviceId = options.deviceId || defaultDeviceId(account);
  const passwordMd5 = proto.md5Hex(password);

  return new Promise((resolve, reject) => {
    let settled = false;
    let verified = false;
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
      // 对齐 wgame_web：注册成功后自动登录
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

    ws.on('message', (data) => {
      try {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
        const head = proto.decodeHead(buf);
        if (!head) return;

        // ping
        if (head.wMainCmdID === proto.KN.MDM_COMMAND && head.wSubCmdID === proto.KN.SUB_DETECT) {
          ws.send(proto.encodeDetectSocket());
          return;
        }

        // token → verify
        if (head.wMainCmdID === proto.KN.MDM_SOCKET && head.wSubCmdID === proto.KN.SUB_TOKEN_RES) {
          const token = proto.readToken(buf);
          ws.send(proto.encodeMd5Verify(token));
          verified = true;
          sendAuthPacket();
          return;
        }

        // other kernel
        if (head.wMainCmdID === proto.KN.MDM_COMMAND || head.wMainCmdID === proto.KN.MDM_SOCKET) {
          return;
        }

        if (!verified) return;

        if (head.wMainCmdID === proto.LOGIN.MDM_LOGON) {
          if (head.wSubCmdID === proto.LOGIN.SUB_OK) {
            const ok = proto.parseLogonOK(buf);
            done(null, {
              ok: true,
              action,
              account,
              ...ok,
              deviceId
            });
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
