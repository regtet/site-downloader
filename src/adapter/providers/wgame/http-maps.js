/**
 * 将 wgame HTTP protobuf 结果映射成官方大厅 UI 可用的结构（最小可用字段）。
 */
const { toLongNumber, protoList } = require('./http-api');

function mapMoney(res) {
  return toLongNumber(res && res.gameMoney, 0);
}

function mapVipDetail(res) {
  const level = Number((res && res.vipLevel) || 0);
  const items = protoList(res, 'item').map((it) => ({
    vip: Number(it.vipLevel) || 0,
    name: 'VIP ' + (Number(it.vipLevel) || 0),
    level_up_deposit: toLongNumber(it.needPoint, 0),
    level_up_bet: toLongNumber(it.needWater, 0),
    total_deposit: toLongNumber(it.needPoint, 0),
    total_bet: toLongNumber(it.needWater, 0),
    upLevelAward: Number(it.upLevelAward) || 0,
    monthAward: Number(it.monthAward) || 0,
    weekAward: Number(it.weekAward) || 0,
    withdrawFee: Number(it.withdrawFee) || 0,
    withdrawTimes: Number(it.withdrawTimes) || 0,
    minWithdrawMoney: toLongNumber(it.minWithdrawMoney, 0),
    maxWithdrawMoney: toLongNumber(it.maxWithdrawMoney, 0),
    dayMaxWithdrawMoney: toLongNumber(it.dayMaxWithdrawMoney, 0)
  }));
  return {
    vip_level: level,
    vip: level,
    curPoint: toLongNumber(res && res.curPoint, 0),
    curWater: toLongNumber(res && res.curWater, 0),
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
  const enable = toLongNumber(res && res.enableWithdraw, 0);
  return {
    enableWithdraw: enable,
    withdrawable: enable,
    available: enable,
    lockGiveMoney: toLongNumber(res && res.lockGiveMoney, 0),
    curWageRequired: toLongNumber(res && res.curWageRequired, 0),
    needWageRequired: toLongNumber(res && res.needWageRequired, 0),
    minRunning: toLongNumber(res && res.minRunning, 0),
    totalRunning: toLongNumber(res && res.totalRunning, 0),
    // 官方 withdrawSetting 常见字段
    minAmount: toLongNumber(res && res.minRunning, 0) || 10,
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
  mapMoney,
  mapVipDetail,
  mapPayways,
  mapEnableWithdraw,
  mapDrawChannels,
  mapChargeRecords,
  mapWithdrawRecords,
  mapProxyStatistics
};
