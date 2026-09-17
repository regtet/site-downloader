/**
 * 将 wgame HTTP protobuf 结果映射成官方大厅 UI 可用的结构（最小可用字段）。
 * 货币约定：wgame 内部金额（happyMoney / gameMoney）÷ 1000 = 大厅展示 game_gold。
 */
const { toLongNumber, protoList } = require('./http-api');
const { COIN_RATE } = require('./protocol');

function happyToDisplay(v) {
  const n = toLongNumber(v, 0);
  return n / (COIN_RATE || 1000);
}

function mapMoney(res) {
  return happyToDisplay(res && res.gameMoney);
}

function mapVipDetail(res) {
  const level = Number((res && res.vipLevel) || 0);
  const items = protoList(res, 'item').map((it) => ({
    vip: Number(it.vipLevel) || 0,
    name: 'VIP ' + (Number(it.vipLevel) || 0),
    level_up_deposit: happyToDisplay(it.needPoint),
    level_up_bet: happyToDisplay(it.needWater),
    total_deposit: happyToDisplay(it.needPoint),
    total_bet: happyToDisplay(it.needWater),
    upLevelAward: happyToDisplay(it.upLevelAward),
    monthAward: happyToDisplay(it.monthAward),
    weekAward: happyToDisplay(it.weekAward),
    withdrawFee: Number(it.withdrawFee) || 0,
    withdrawTimes: Number(it.withdrawTimes) || 0,
    minWithdrawMoney: happyToDisplay(it.minWithdrawMoney),
    maxWithdrawMoney: happyToDisplay(it.maxWithdrawMoney),
    dayMaxWithdrawMoney: happyToDisplay(it.dayMaxWithdrawMoney)
  }));
  return {
    vip_level: level,
    vip: level,
    curPoint: happyToDisplay(res && res.curPoint),
    curWater: happyToDisplay(res && res.curWater),
    VipSettings: items,
    vipList: items,
    raw: res
  };
}

function mapPayways(res) {
  return protoList(res, 'item').map((it) => ({
    id: Number(it.id) || 0,
    userName: String(it.userName || ''),
    bankCardNo: String(it.bankCardNo || ''),
    bankName: String(it.bankName || ''),
    ifscCode: String(it.ifscCode || ''),
    mail: String(it.mail || ''),
    payWayType: Number(it.payWayType) || 0,
    idcard: String(it.idcard || ''),
    // 官方字段兼容
    account: String(it.bankCardNo || ''),
    realName: String(it.userName || ''),
    type: Number(it.payWayType) || 0
  }));
}

function mapEnableWithdraw(res) {
  const enable = happyToDisplay(res && res.enableWithdraw);
  return {
    enableWithdraw: enable,
    withdrawable: enable,
    available: enable,
    lockGiveMoney: happyToDisplay(res && res.lockGiveMoney),
    curWageRequired: happyToDisplay(res && res.curWageRequired),
    needWageRequired: happyToDisplay(res && res.needWageRequired),
    minRunning: happyToDisplay(res && res.minRunning),
    totalRunning: happyToDisplay(res && res.totalRunning),
    // 官方 withdrawSetting 常见字段（展示币）
    minAmount: happyToDisplay(res && res.minRunning) || 10,
    maxAmount: enable || 0,
    fee: 0,
    feeRate: 0
  };
}

function mapDrawChannels(res) {
  return protoList(res, 'item').map((it) => ({
    wayId: Number(it.wayId) || 0,
    wayCode: String(it.wayCode || ''),
    id: Number(it.wayId) || 0,
    code: String(it.wayCode || '')
  }));
}

/** 大厅 typeId：PIX=5；无通道时默认 CPF(wayId=3) 以便 Conta 页可绑 */
const LOBBY_TYPE_PIX = 5;
const DEFAULT_PIX_CHANNELS = [{ wayId: 3, wayCode: 'CPF', id: 3, code: 'CPF' }];

/**
 * withdrawInfoV2/V3：enableWithdraw + drawChannelCode + paywayList → 大厅 Conta/提现结构
 */
function mapWithdrawInfo({ enableRes, chRes, paywayRes, vipRes } = {}) {
  const setting = mapEnableWithdraw(enableRes);
  let channels = mapDrawChannels(chRes);
  if (!channels.length) channels = DEFAULT_PIX_CHANNELS.slice();
  const payways = mapPayways(paywayRes);

  let minAmount = setting.minAmount || 10;
  let maxAmount = setting.maxAmount || setting.enableWithdraw || 0;
  if (vipRes) {
    const vip = mapVipDetail(vipRes);
    if (vip && vip.VipSettings && vip.VipSettings.length) {
      const cur = vip.VipSettings.find((x) => x.vip === vip.vip_level) || vip.VipSettings[0];
      if (cur) {
        if (cur.minWithdrawMoney) minAmount = cur.minWithdrawMoney;
        if (cur.maxWithdrawMoney) maxAmount = cur.maxWithdrawMoney;
      }
    }
  }

  const methods = channels.map((ch) => {
    const code = String(ch.wayCode || ch.code || 'PIX');
    const wayId = Number(ch.wayId || ch.id) || 0;
    return {
      typeId: LOBBY_TYPE_PIX,
      withdrawType: wayId,
      withdrawTypeName: code,
      bindEnabled: true,
      accountLimit: 1,
      withdrawMax: maxAmount,
      withdrawMin: minAmount,
      normalWithdrawEnabled: true,
      walletWithdrawEnabled: false,
      deleteEnabled: true,
      requiredSelectBank: false,
      requiredIFSC: false,
      subTypes: [code],
      logo: '',
      kindTips: '',
      addAccountKindTips: '',
      options: [],
      withdrawMoneyRule: { formatAmounts: [], moneyType: 0 }
    };
  });

  const withdrawType = {
    typeId: LOBBY_TYPE_PIX,
    typeName: 'PIX',
    typeShowName: 'PIX',
    addTypeName: 'PIX',
    withdrawMax: maxAmount,
    withdrawMin: minAmount,
    logo: '',
    subTypes: methods.map((m) => m.withdrawTypeName),
    currencyCodes: [],
    showKeyList: [],
    withdrawMethod: methods,
    withdrawMethods: methods
  };

  const channelById = new Map(channels.map((c) => [Number(c.wayId || c.id) || 0, c]));
  const accounts = payways.map((pw) => {
    const ch = channelById.get(Number(pw.payWayType) || 0) || {};
    const code = String(ch.wayCode || ch.code || pw.bankName || 'PIX');
    return {
      id: pw.id,
      typeId: LOBBY_TYPE_PIX,
      accountType: Number(pw.payWayType) || 0,
      withdrawTypeName: code,
      channelName: code,
      bankName: String(pw.bankName || code),
      account: String(pw.account || pw.bankCardNo || ''),
      decryptAccount: String(pw.account || pw.bankCardNo || ''),
      realName: String(pw.realName || pw.userName || ''),
      userName: String(pw.userName || ''),
      mail: String(pw.mail || ''),
      ifscCode: String(pw.ifscCode || ''),
      logo: '',
      default: 0,
      stop: 0,
      bankStop: 0
    };
  });

  return {
    accounts,
    accountsV2: accounts,
    cryptoList: [],
    withdrawTypes: [withdrawType],
    withdrawTypesV2: [withdrawType],
    withdrawTaskInfo: { pendingCount: 0 },
    auditCancelStatus: 0,
    auditCancelMode: 0,
    cancelAmount: '0',
    checkCpfRule: 0,
    pendingCount: 0,
    isEnableChannel: true,
    enableWithdraw: setting.enableWithdraw,
    withdrawable: setting.withdrawable,
    available: setting.available,
    lockGiveMoney: setting.lockGiveMoney,
    curWageRequired: setting.curWageRequired,
    needWageRequired: setting.needWageRequired,
    minAmount,
    maxAmount,
    fee: setting.fee || 0,
    feeRate: setting.feeRate || 0,
    channels,
    list: channels
  };
}

function mapChargeRecords(res) {
  const list = protoList(res, 'item').map((it) => ({
    orderNo: String(it.order || ''),
    order: String(it.order || ''),
    amount: Number(it.chargeMoney) || 0,
    chargeMoney: Number(it.chargeMoney) || 0,
    gameMoney: Number(it.gameMoney) || 0,
    giveMoney: Number(it.giveMoney) || 0,
    extraMoney: Number(it.extraMoney) || 0,
    times: Number(it.times) || 0,
    createTime: Number(it.times) || 0,
    status: 1
  }));
  return {
    list,
    records: list,
    rows: list,
    total: list.length,
    totalDeposit: toLongNumber(res && res.totalDeposit, 0),
    beginTime: toLongNumber(res && res.beginTime, 0),
    endTime: toLongNumber(res && res.endTime, 0),
    queryType: Number(res && res.queryType) || 0
  };
}

function mapWithdrawRecords(res) {
  const list = protoList(res, 'item').map((it) => ({
    orderNo: String(it.transNo || ''),
    transNo: String(it.transNo || ''),
    amount: toLongNumber(it.transMoney, 0),
    transMoney: toLongNumber(it.transMoney, 0),
    status: Number(it.orderState) || 0,
    orderState: Number(it.orderState) || 0,
    addTime: toLongNumber(it.addTime, 0),
    createTime: toLongNumber(it.addTime, 0),
    tax: toLongNumber(it.tax, 0),
    payWay: Number(it.payWay) || 0,
    cardNo: String(it.cardNo || ''),
    ifscCode: String(it.ifscCode || ''),
    mail: String(it.mail || '')
  }));
  return {
    list,
    records: list,
    rows: list,
    total: list.length,
    totalWithdraw: toLongNumber(res && res.totalWithdraw, 0),
    beginTime: toLongNumber(res && res.beginTime, 0),
    endTime: toLongNumber(res && res.endTime, 0),
    queryType: Number(res && res.queryType) || 0
  };
}

function mapProxyStatistics(res) {
  if (!res) return {};
  const n = (k) => toLongNumber(res[k], 0);
  return {
    totalDeposit: n('totalDeposit'),
    totalWithdraw: n('totalWithdraw'),
    totalTax: n('totalTax'),
    totalRunning: n('totalRunning'),
    lv1PersonCount: Number(res.lv1PersonCount) || 0,
    lv1Deposit: n('lv1Deposit'),
    lv1Tax: n('lv1Tax'),
    lv1Running: n('lv1Running'),
    lv1FirstDepositPerson: Number(res.lv1FirstDepositPerson) || 0,
    lv1FirstDeposit: n('lv1FirstDeposit'),
    lv1Withdraw: n('lv1Withdraw'),
    lv2PersonCount: Number(res.lv2PersonCount) || 0,
    lv2Deposit: n('lv2Deposit'),
    lv2Tax: n('lv2Tax'),
    lv2Running: n('lv2Running'),
    lv2FirstDepositPerson: Number(res.lv2FirstDepositPerson) || 0,
    lv2FirstDeposit: n('lv2FirstDeposit'),
    lv2Withdraw: n('lv2Withdraw'),
    lv3PersonCount: Number(res.lv3PersonCount) || 0,
    lv3Deposit: n('lv3Deposit'),
    lv3Tax: n('lv3Tax'),
    lv3Running: n('lv3Running'),
    lv3FirstDepositPerson: Number(res.lv3FirstDepositPerson) || 0,
    lv3FirstDeposit: n('lv3FirstDeposit'),
    lv3Withdraw: n('lv3Withdraw'),
    // 兼容官方 index/total 常见字段名
    inviteCount: Number(res.lv1PersonCount) || 0,
    teamCount: (Number(res.lv1PersonCount) || 0)
      + (Number(res.lv2PersonCount) || 0)
      + (Number(res.lv3PersonCount) || 0),
    commission: n('lv1Tax') + n('lv2Tax') + n('lv3Tax')
  };
}

module.exports = {
  happyToDisplay,
  mapMoney,
  mapVipDetail,
  mapPayways,
  mapEnableWithdraw,
  mapDrawChannels,
  mapWithdrawInfo,
  mapChargeRecords,
  mapWithdrawRecords,
  mapProxyStatistics
};
