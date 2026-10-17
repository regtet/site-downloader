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

function annualRatePercent(item) {
  const days = Number(item && item.days) || 0;
  const interest = Number(item && item.interest) || 0;
  if (days <= 0 || interest <= 0) return 0;
  return Math.round((interest / 10000) * (365 / days) * 10000) / 100;
}

function mapYuebao(config, holdings, gameGold) {
  const products = protoList(config, 'item').filter((it) => it && Number(it.days) > 0);
  const held = protoList(holdings, 'item');
  if (!products.length && !held.length) {
    return { switchStatus: 0, game_gold: Number(gameGold) || 0, list: [] };
  }
  const pick = products.slice().sort((a, b) => annualRatePercent(b) - annualRatePercent(a))[0] || {};
  const yearRate = annualRatePercent(pick);
  const days = Number(pick.days) || 0;
  const principal = held.reduce((sum, it) => sum + happyToDisplay(it.seedMoney), 0);
  const curIncome = held.reduce((sum, it) => sum + happyToDisplay(it.curInterest), 0);
  const totalIncome = held.reduce((sum, it) => sum + happyToDisplay(it.sumInterest), 0);
  return {
    switchStatus: products.length ? 1 : 0,
    game_gold: Number(gameGold) || 0,
    yearRate,
    dayRate: days > 0 ? Math.round((Number(pick.interest) / 10000) * (100 / days) * 100) / 100 : 0,
    cycleTime: days,
    minSave: happyToDisplay(pick.minSeedMoney),
    principal,
    yuebaoGold: principal,
    curIncome,
    totalIncome,
    todayUnclaimed: curIncome,
    cycleIncome: curIncome,
    isPop: 0,
    ruleText: '',
    list: products.map((it) => ({
      balanceType: Number(it.balanceType) || 0,
      days: Number(it.days) || 0,
      yearRate: annualRatePercent(it),
      minSave: happyToDisplay(it.minSeedMoney)
    }))
  };
}

function mapBalanceHistory(res) {
  const list = protoList(res, 'item').map((it) => ({
    time: Number(it.getTime || it.buyTime) || 0,
    type: Number(it.bussnessType) || 0,
    principal: happyToDisplay(it.seedMoney),
    income: happyToDisplay(it.interestMoney),
    amount: happyToDisplay(it.bussnessType === 3 ? it.seedMoney : it.interestMoney)
  }));
  return {
    list,
    total: list.length,
    count: list.length,
    totalRecords: list.length,
    totalIncome: happyToDisplay(res && res.totalIncome)
  };
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

function applyVipClaimFlags(mapped, awardRes) {
  if (!mapped || !Array.isArray(mapped.VipSettings)) return mapped;
  const claimed = new Map();
  protoList(awardRes, 'item').forEach((it) => {
    const lv = Number(it && it.vipLevel) || 0;
    if (!claimed.has(lv)) claimed.set(lv, new Set());
    claimed.get(lv).add(Number(it && it.awardType));
  });
  mapped.VipSettings = mapped.VipSettings.map((row) => {
    const types = claimed.get(Number(row.vip)) || new Set();
    return Object.assign({}, row, {
      vip_gift_status: types.has(0) ? 1 : 0,
      day_bonus_status: types.has(1) ? 1 : 0,
      week_bonus_status: types.has(2) ? 1 : 0,
      month_bonus_status: types.has(3) ? 1 : 0
    });
  });
  mapped.vipList = mapped.VipSettings;
  mapped.vipAwardCount = Number(awardRes && awardRes.vipAwardCount) || 0;
  return mapped;
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
function mapWithdrawInfo({ enableRes, chRes, paywayRes, vipRes, defaultAccountId } = {}) {
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
      addWithdrawTypeName: 'Adicionar ' + code,
      cryptoCurrency: false,
      currencyCode: 'BRL',
      protocol: '',
      bindEnabled: true,
      accountLimit: 1,
      accountLimitList: null,
      withdrawMax: maxAmount,
      withdrawMin: minAmount,
      normalWithdrawEnabled: true,
      walletWithdrawEnabled: false,
      deleteEnabled: true,
      withdrawalFeeRule: '',
      requiredSelectBank: 0,
      requiredIFSC: 0,
      subTypes: [code],
      logo: '',
      kindTips: '',
      addAccountKindTips: '',
      withdrawMoneyRule: { formatAmounts: [], moneyType: 0 }
    };
  });

  const withdrawType = {
    typeId: LOBBY_TYPE_PIX,
    typeName: 'PIX',
    addTypeName: 'Adicionar PIX',
    withdrawMax: maxAmount,
    withdrawMin: minAmount,
    cryptoCurrency: false,
    logo: '',
    subTypes: methods.map((m) => m.withdrawTypeName),
    currencyCodes: ['BRL'],
    withdrawMethod: methods,
    guideBadgeColor: 0,
    guideBadge: ''
  };

  const channelById = new Map(channels.map((c) => [Number(c.wayId || c.id) || 0, c]));
  const preferredId = defaultAccountId != null && defaultAccountId !== ''
    ? String(defaultAccountId)
    : '';
  let matchedPreferred = false;
  const accounts = payways.map((pw) => {
    const ch = channelById.get(Number(pw.payWayType) || 0) || {};
    const code = String(ch.wayCode || ch.code || pw.bankName || 'PIX');
    const isDefault = preferredId && String(pw.id) === preferredId ? 1 : 0;
    if (isDefault) matchedPreferred = true;
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
      default: isDefault,
      stop: 0,
      bankStop: 0
    };
  });
  // 未指定默认时：单账户直接标默认；多账户标第一项，避免 UI 无选中
  if (accounts.length && !matchedPreferred) {
    accounts[0].default = 1;
  }

  return {
    accounts,
    accountsV2: null,
    cryptoList: [],
    withdrawTypes: [withdrawType],
    withdrawTypesV2: null,
    tabSort: [{
      tabName: 'Saque normal',
      tabCode: 'normal',
      tabIndex: 2,
      awardConfig: null,
      withdrawTaskInfo: { iconType: 1, status: false },
      withdrawTypeIds: [1],
      disableShowTab: null,
      multilingualText: null
    }],
    tabSortV2: null,
    withdrawTaskInfo: {
      switch: false,
      pendingCount: 0,
      stats: {
        needWithdrawAmount: 0,
        withdrawTypeIdName: [],
        withdrawTypeName: [],
        withdrawTaskId: 0
      }
    },
    auditCancelStatus: 0,
    auditCancelMode: 1,
    cancelAmount: '0.01',
    checkCpfRule: 0,
    pendingCount: 0,
    isEnableChannel: true,
    withdrawMin: minAmount,
    withdrawMax: maxAmount,
    withdrawTimes: 0,
    withdrawCount: accounts.length,
    requireBet: Number(setting.needWageRequired) || 0,
    cpf: '',
    auditModeInfo: {
      auditMode: 1,
      withdrawResetBonus: 2,
      bonusTransferInRule: 2,
      bonus: '',
      bonusAvailable: '',
      bonusRequireBet: '',
      bonusTransferIn: false,
      withdrawNeedBet: false,
      undoneResetBonus: false
    },
    withdrawClose: {
      channelSwitch: true,
      closeType: 0,
      dailyCycle: 0,
      startTime: 0,
      endTime: 0,
      remark: '',
      closingTimes: 0,
      isEnableChannel: true
    },
    pinNumber: '',
    pinNumberType: 0,
    activeParticipation: 0,
    withdrawToRechargePaySettingId: 0,
    activeChargeRateMode: 0,
    withdrawalPagePopup: {
      popType: 0,
      intervalDays: 7,
      popMode: 1,
      popScene: [1],
      lang: 'pt',
      title: '',
      content: ''
    },
    maxChargeRate: '0',
    withdrawTabDisplayType: 0,
    discourageInfo: { amount: '0', status: false, currency: '' },
    withdrawToRechargeAmountLimit: null,
    withdrawToRechargeKindTip: ''
  };
}

function mapDayRechargeBonus(res) {
  const list = protoList(res, 'item').map((it) => ({
    rechargeAmount: happyToDisplay(it.dayRecharge),
    reward: happyToDisplay(it.bonus),
    dayRecharge: happyToDisplay(it.dayRecharge),
    bonus: happyToDisplay(it.bonus)
  }));
  return {
    list,
    records: list,
    count: list.length,
    total: list.length,
    totalRecords: list.length,
    bonus: happyToDisplay(res && res.bonus),
    dayRecharge: happyToDisplay(res && res.dayRecharge),
    nextDayReturn: happyToDisplay(res && res.nextDayReturn),
    yesterdayRecharge: happyToDisplay(res && res.yesterdayRecharge)
  };
}

function mapChargeRecords(res) {
  const list = protoList(res, 'item').map((it) => ({
    orderNo: String(it.order || ''),
    order: String(it.order || ''),
    amount: Number(it.chargeMoney) || 0,
    chargeMoney: Number(it.chargeMoney) || 0,
    gameMoney: happyToDisplay(it.gameMoney),
    giveMoney: happyToDisplay(it.giveMoney),
    extraMoney: happyToDisplay(it.extraMoney),
    times: Number(it.times) || 0,
    createTime: Number(it.times) || 0,
    status: 1
  }));
  return {
    list,
    records: list,
    rows: list,
    total: list.length,
    totalCount: list.length,
    count: list.length,
    totalRecords: list.length,
    totalDeposit: toLongNumber(res && res.totalDeposit, 0),
    beginTime: toLongNumber(res && res.beginTime, 0),
    endTime: toLongNumber(res && res.endTime, 0),
    queryType: Number(res && res.queryType) || 0
  };
}

function mapWithdrawRecords(res) {
  const list = protoList(res, 'item').map((it) => {
    const money = happyToDisplay(it.transMoney);
    const created = toLongNumber(it.addTime, 0);
    return {
    orderNo: String(it.transNo || ''),
    transNo: String(it.transNo || ''),
    amount: money,
    money: String(money),
    transMoney: money,
    createTime: created,
    status: Number(it.orderState) || 0,
    orderState: Number(it.orderState) || 0,
    addTime: created,
    tax: toLongNumber(it.tax, 0),
    payWay: Number(it.payWay) || 0,
    cardNo: String(it.cardNo || ''),
    ifscCode: String(it.ifscCode || ''),
    mail: String(it.mail || '')
    };
  });
  return {
    list,
    records: list,
    rows: list,
    total: list.length,
    totalCount: list.length,
    count: list.length,
    totalRecords: list.length,
    totalWithdraw: toLongNumber(res && res.totalWithdraw, 0),
    beginTime: toLongNumber(res && res.beginTime, 0),
    endTime: toLongNumber(res && res.endTime, 0),
    queryType: Number(res && res.queryType) || 0
  };
}

function mapChargeWithdrawRecords(res) {
  const list = protoList(res, 'item').map((it) => {
    const type = Number(it.type) || 0;
    const money = happyToDisplay(it.transMoney);
    const signed = type === 1 ? -Math.abs(money) : Math.abs(money);
    const created = toLongNumber(it.addTime, 0);
    const orderNo = String(it.transNo || '');
    const optName = type === 1 ? 'Saque' : 'Depósito';
    const finishMs = created > 0 && created < 1e12 ? created * 1000 : created;
    return {
      id: orderNo,
      orderNo,
      uuid: orderNo,
      opt_type_name: optName,
      optTypeName: optName,
      deal_type_name: 'PIX',
      dealTypeName: 'PIX',
      deal_type: type === 1 ? 2 : 1,
      walletTypeName: 'Saldo',
      item_count: signed,
      changeGold: signed,
      money: String(signed),
      beforeGold: 0,
      afterGold: 0,
      createTime: finishMs,
      finish_game_time: finishMs,
      status: Number(it.orderState) || 0,
      remark: orderNo,
      type
    };
  });
  const charge = list.reduce((sum, row) => sum + (Number(row.changeGold) > 0 ? Number(row.changeGold) : 0), 0);
  const withdraw = list.reduce((sum, row) => sum + (Number(row.changeGold) < 0 ? -Number(row.changeGold) : 0), 0);
  return {
    data: list,
    list,
    records: list,
    rows: list,
    total: list.length,
    totalCount: list.length,
    count: list.length,
    totalRecords: list.length,
    total_amount: String(charge - withdraw),
    totalChargeAmount: String(charge || happyToDisplay(res && res.totalDeposit)),
    totalWithdrawAmount: String(withdraw || happyToDisplay(res && res.totalWithdraw))
  };
}

function mapProxyUsers(res) {
  const list = protoList(res, 'item').map((it) => {
    const userId = Number(it.roleId) || 0;
    const name = String(it.loginName || it.account || userId || '');
    const validBet = happyToDisplay(it.totalBet);
    const deposit = happyToDisplay(it.totalDeposit);
    const created = toLongNumber(it.addTime, 0);
    return {
      userIdx: userId,
      userId,
      account: name,
      userName: name,
      vipLevel: Number(it.vipLv) || 0,
      validBet,
      deposit,
      firstDeposit: happyToDisplay(it.firstRecharge),
      directChildCount: Number(it.lv1PersonCount) || 0,
      registerTime: created,
      loginTime: created,
      status: Number(it.validInvite) ? 1 : 0,
      onLine: 0,
      userStatus: Number(it.validInvite) ? 1 : 0
    };
  });
  return {
    data: list,
    list,
    records: list,
    rows: list,
    total: list.length,
    totalCount: list.length,
    count: list.length,
    totalRecords: list.length
  };
}

function emptyPersonalReport() {
  return {
    totalChargeAmount: '0',
    totalWithdrawAmount: '0',
    totalTaskAmount: '0',
    totalYuebaoAmount: '0',
    totalDiscountAmount: '0',
    totalReturnGoldAmount: '0',
    totalEventAmount: '0',
    totalValidBet: '0',
    totalItemCount: '0',
    totalSettle: '0',
    balance: '0',
    betitemNum: 0,
    totalTax: '0',
    totalValidAmount: '0',
    data: [],
    list: [],
    total: 0,
    totalRecords: 0
  };
}

function mapProxyBetList(res) {
  const src = res && typeof res === 'object' ? res : {};
  const list = protoList(src, 'item').map((it) => {
    const userId = Number(it.roleId) || 0;
    return {
      userIdx: userId,
      account: String(userId || ''),
      encryption: '',
      vipLevel: Number(it.vipLv) || 0,
      performance: happyToDisplay(it.totalBet),
      profitLose: 0,
      discount: 0
    };
  });
  const direct = happyToDisplay(src.lv1Running);
  const other = happyToDisplay(src.lv2Running);
  const people = Number(src.lv1PersonCount) || 0;
  const total = people > 0 ? people : list.length;
  return {
    list,
    records: list,
    data: list,
    total,
    totalRecords: total,
    count: total,
    totalPerformance: direct + other,
    totalDirectPerformance: direct,
    totalOtherPerformance: other
  };
}

function betCategoryName(row) {
  const gameType = Number(row && row.gameType);
  const byGame = { 1: 'Slots', 2: 'Pesca', 3: 'Multijogador', 4: 'Esporte', 5: 'Vídeo' };
  if (byGame[gameType]) return byGame[gameType];
  const byBet = { 7: 'Slots', 8: 'Pesca', 9: 'Ao vivo', 10: 'Esporte', 11: 'Cartas' };
  return byBet[Number(row && row.betType)] || '';
}

function mapCommissionDetail(res) {
  const src = res && typeof res === 'object' ? res : {};
  const list = protoList(src, 'item').map((it) => {
    const performance = happyToDisplay(it.betMoney);
    const commission = happyToDisplay(it.bonusMoney);
    const rate = performance > 0 ? Math.round((commission / performance) * 10000) / 100 : 0;
    return {
      userIdx: 0,
      account: '',
      encryption: '',
      vipLevel: 0,
      gameCategory: betCategoryName(it),
      performance,
      commission,
      commissionRate: rate,
      profitAmount: 0,
      receiveReward: 0,
      thirdCost: 0,
      totalFee: 0,
      winLose: 0
    };
  });
  const direct = happyToDisplay(src.lv1Bonus);
  const other = happyToDisplay(src.lv2Bonus);
  return {
    list,
    records: list,
    data: list,
    total: list.length,
    totalRecords: list.length,
    count: list.length,
    totalDirectCommission: direct,
    totalOtherCommission: other,
    totalCommission: direct + other,
    startTime: toLongNumber(src.beginTime, 0),
    endTime: toLongNumber(src.endTime, 0)
  };
}

function mapDirectData(res) {
  const src = res && typeof res === 'object' ? res : {};
  const list = protoList(src, 'item').map((it) => {
    const userId = Number(it.roleId) || 0;
    const online = Number(it.roleStatus) === 1 ? 1 : 0;
    return {
      userIdx: userId,
      account: String(it.loginName || userId || ''),
      encryption: '',
      vipLevel: Number(it.vipLv) || 0,
      directChildCount: Number(it.lv1PersonCount) || 0,
      lastLoginTime: toLongNumber(it.lastLogonTime, 0),
      deposit: Number(it.totalDeposit) || 0,
      validBet: happyToDisplay(it.totalBet),
      status: Number(it.accountStatus) === 1 ? 2 : 1,
      online
    };
  });
  const people = Number(src.lv1InvitePerson) || 0;
  const total = people > 0 ? people : list.length;
  return {
    list,
    records: list,
    data: list,
    total,
    totalRecords: total,
    count: total
  };
}

function mapReceivePayments(res) {
  const src = res && typeof res === 'object' ? res : {};
  const money = (v) => Number(v) || 0;
  const list = protoList(src, 'item').map((it) => {
    const userId = Number(it.roleId) || 0;
    return {
      userIdx: userId,
      account: String(userId || ''),
      encryption: '',
      vipLevel: Number(it.vipLv) || 0,
      directChildCount: Number(it.lv1PersonCount) || 0,
      activityReward: money(it.inviteBonus),
      returnGold: money(it.proxyBetBonus),
      taskReward: money(it.missionBonus),
      agentCommission: money(it.proxyBonus),
      totalOther: money(it.indirectBonus),
      totalReward: money(it.totalBonus)
    };
  });
  const activity = money(src.inviteBonus);
  const cashback = money(src.proxyBetBonus);
  const task = money(src.missionBonus);
  const commission = money(src.proxyBonus);
  return {
    list,
    records: list,
    data: list,
    total: list.length,
    totalRecords: list.length,
    count: list.length,
    totalActivityReward: activity,
    totalReturnGold: cashback,
    totalTaskReward: task,
    totalAgentCommission: commission,
    totalOther: 0,
    totalValue: activity + cashback + task + commission
  };
}

function mapChargeRunningList(res) {
  const src = res && typeof res === 'object' ? res : {};
  const list = protoList(src, 'item').map((it) => {
    const userId = Number(it.roleId) || 0;
    const deposit = Number(it.totalDeposit) || 0;
    const withdraw = Number(it.withdraw) || 0;
    return {
      userIdx: userId,
      account: String(userId || ''),
      encryption: '',
      vipLevel: Number(it.vipLv) || 0,
      directChildCount: Number(it.lv1PersonCount) || 0,
      depositAmount: deposit,
      depositCount: Number(it.depositCount) || 0,
      withdrawAmount: withdraw,
      withdrawCount: Number(it.withdrawCount) || 0,
      balance: happyToDisplay(it.leftMoney),
      diffBalance: deposit - withdraw
    };
  });
  const people = Number(src.lv1InvitePerson) || 0;
  const total = people > 0 ? people : list.length;
  const directDeposit = Number(src.lv1Deposit) || 0;
  const otherDeposit = Number(src.lv2Deposit) || 0;
  return {
    list,
    records: list,
    data: list,
    total,
    totalRecords: total,
    count: total,
    totalDeposit: Number(src.totalDeposit) || (directDeposit + otherDeposit),
    directDeposit,
    otherDeposit,
    totalDepositPerson: Number(src.totalDepositPerson) || 0,
    directDepositPerson: Number(src.lv1DepositPerson) || 0,
    otherDepositPerson: Number(src.lv2DepositPerson) || 0,
    totalWithdraw: 0,
    directWithdraw: 0,
    otherWithdraw: 0,
    totalWithdrawCount: 0,
    directWithdrawCount: 0,
    otherWithdrawCount: 0,
    totalFirstDeposit: Number(src.totalFirstDeposit) || 0,
    directFirstDeposit: Number(src.lv1FirstDeposit) || 0,
    otherFirstDeposit: Number(src.lv2FirstDeposit) || 0,
    totalFirstDepositPerson: Number(src.totalChargeCount) || 0,
    directFirstDepositPerson: Number(src.lv1PersonCount) || 0,
    otherFirstDepositPerson: Number(src.lv2PersonCount) || 0,
    totalRegisterPerson: Number(src.lv1InvitePerson) || 0,
    directRegisterPerson: Number(src.lv1InvitePerson) || 0,
    otherRegisterPerson: 0,
    totalValidBet: happyToDisplay(src.totalRunning),
    directValidBet: happyToDisplay(src.lv1Running),
    otherValidBet: happyToDisplay(src.lv2Running)
  };
}

function mapMemberDetail(res, roleId) {
  const src = res && typeof res === 'object' ? res : {};
  const userId = Number(src.roleId) || Number(roleId) || 0;
  const banned = Number(src.accountStatus) === 1;
  return {
    userIdx: userId,
    userName: String(userId || ''),
    account: String(userId || ''),
    encryption: '',
    vipLevel: Number(src.vipLv) || 0,
    realName: '',
    realNameSwitch: 0,
    onLine: Number(src.roleStatus) === 1 ? 1 : 0,
    userStatus: banned ? 2 : 1,
    onLineCount: Number(src.loginCount) || 0,
    loginTime: toLongNumber(src.lastLogonTime, 0),
    registerTime: toLongNumber(src.registerTime, 0),
    deposit: Number(src.totalDeposit) || 0,
    withdraw: Number(src.withdraw) || 0,
    validBet: happyToDisplay(src.totalBet),
    profitLose: happyToDisplay(src.winNum),
    discount: happyToDisplay(src.receiveBonus)
  };
}

function mapBetDetail(res, body) {
  const src = res && typeof res === 'object' ? res : {};
  const b = body || {};
  const userId = Number(src.roleId) || Number(b.account || b.userIdx || b.roleId) || 0;
  const vip = Number(src.vipLv) || 0;
  const items = protoList(src, 'item');
  const list = items.map((it) => ({
    userIdx: userId,
    account: String(userId || ''),
    encryption: '',
    vipLevel: vip,
    gamePlatformName: '',
    gameCategoryName: '',
    gameName: '',
    validBet: happyToDisplay(it.totalBet),
    profit: happyToDisplay(it.winNum)
  }));
  const amount = list.reduce((sum, row) => sum + (Number(row.validBet) || 0), 0);
  const first = items[0] || {};
  const last = items[items.length - 1] || {};
  return {
    list,
    records: list,
    data: list,
    total: list.length,
    totalRecords: list.length,
    count: list.length,
    startTime: toLongNumber(b.startTime, 0) || toLongNumber(first.addTime, 0),
    endTime: toLongNumber(b.endTime, 0) || toLongNumber(last.addTime, 0),
    totoalValidOrderAmount: amount,
    totoalValidOrder: list.length
  };
}

function mapProxyWinList(res) {
  const src = res && typeof res === 'object' ? res : {};
  const list = protoList(src, 'item').map((it) => {
    const userId = Number(it.roleId) || 0;
    return {
      userIdx: userId,
      account: String(userId || ''),
      encryption: '',
      vipLevel: Number(it.vipLv) || 0,
      orders: Number(it.playCount) || 0,
      validBet: happyToDisplay(it.totalBet),
      profit: happyToDisplay(it.totalWin),
      directChildCount: 0
    };
  });
  const total = list.length;
  return {
    list,
    records: list,
    data: list,
    total,
    totalRecords: total,
    count: total,
    directValidBet: happyToDisplay(src.lv1Running),
    directProfit: happyToDisplay(src.lv1Win),
    otherValidBet: happyToDisplay(src.otherRunning),
    otherProfit: happyToDisplay(src.otherWin),
    totalValidBet: happyToDisplay(src.totalRunning),
    totalProfit: happyToDisplay(src.totalWin)
  };
}

function mapProxyStatistics(res) {
  const src = res && typeof res === 'object' ? res : {};
  const money = (k) => happyToDisplay(src[k]);
  const shown = (k) => toLongNumber(src[k], 0);
  const count = (k) => Number(src[k]) || 0;
  const lv1Bonus = money('lv1Bonus');
  const lv2Bonus = money('lv2Bonus');
  const lv3Bonus = money('lv3Bonus');
  const inviteBonus = money('inviteBonusLv1') + money('inviteBonusLv2') + money('inviteBonusLv3');
  const directMembers = count('lv1PersonCount');
  const otherMembers = count('lv2PersonCount') + count('lv3PersonCount');
  return {
    // aniw 佣金列表是分页接口；即使 WGame 仅提供聚合统计，也必须明确结束分页。
    list: [],
    records: [],
    total: 0,
    totalRecords: 0,
    settleDuration: 1,
    settleDurationDays: 1,
    nextSettleTime: null,
    totalDeposit: shown('totalDeposit'),
    totalWithdraw: shown('totalWithdraw'),
    totalTax: money('totalTax'),
    totalRunning: money('totalRunning'),
    lv1PersonCount: directMembers,
    lv1Deposit: shown('lv1Deposit'),
    lv1Tax: money('lv1Tax'),
    lv1Running: money('lv1Running'),
    lv1FirstDepositPerson: count('lv1FirstDepositPerson'),
    lv1FirstDeposit: shown('lv1FirstDeposit'),
    lv1Withdraw: shown('lv1Withdraw'),
    lv1Bonus,
    lv2PersonCount: count('lv2PersonCount'),
    lv2Deposit: shown('lv2Deposit'),
    lv2Tax: money('lv2Tax'),
    lv2Running: money('lv2Running'),
    lv2FirstDepositPerson: count('lv2FirstDepositPerson'),
    lv2FirstDeposit: shown('lv2FirstDeposit'),
    lv2Withdraw: shown('lv2Withdraw'),
    lv2Bonus,
    lv3PersonCount: count('lv3PersonCount'),
    lv3Deposit: shown('lv3Deposit'),
    lv3Tax: money('lv3Tax'),
    lv3Running: money('lv3Running'),
    lv3FirstDepositPerson: count('lv3FirstDepositPerson'),
    lv3FirstDeposit: shown('lv3FirstDeposit'),
    lv3Withdraw: shown('lv3Withdraw'),
    lv3Bonus,
    inviteCount: directMembers,
    teamCount: directMembers + otherMembers,
    directMembers,
    otherMembers,
    directPerformanceYet: money('lv1Running'),
    totalDirectCommission: lv1Bonus,
    totalOtherCommission: lv2Bonus + lv3Bonus,
    totalCommission: lv1Bonus + lv2Bonus + lv3Bonus + inviteBonus,
    canTakeCommission: lv1Bonus + lv2Bonus + lv3Bonus + inviteBonus,
    commission: lv1Bonus + lv2Bonus + lv3Bonus + inviteBonus
  };
}

function wanToPercent(value) {
  const n = Number(value) || 0;
  return Math.round(n) / 100;
}

function mapBetRates(res) {
  const rows = protoList(res, 'item').slice().sort((a, b) => (Number(a && a.totalBet) || 0) - (Number(b && b.totalBet) || 0));
  const tier = rows[0] || {};
  const rateList = [
    { gameCategoryId: 3, commissionRate: wanToPercent(tier.slotRate) },
    { gameCategoryId: 2, commissionRate: wanToPercent(tier.fishRate) },
    { gameCategoryId: 4, commissionRate: wanToPercent(tier.liveRate) },
    { gameCategoryId: 5, commissionRate: wanToPercent(tier.sportRate) }
  ];
  return {
    rateList,
    netProfitRate: 0,
    list: rateList,
    records: rateList,
    total: rateList.length,
    count: rateList.length,
    totalRecords: rateList.length
  };
}

function mapTeamData(res) {
  const src = res && typeof res === 'object' ? res : {};
  const gold = (k) => happyToDisplay(src[k]);
  const shown = (k) => toLongNumber(src[k], 0);
  const count = (k) => Number(src[k]) || 0;
  const directMember = count('lv1PersonCount');
  const otherMember = count('lv2PersonCount') + count('lv3PersonCount');
  const directPerformance = gold('lv1Running');
  const otherPerformance = gold('lv2Running') + gold('lv3Running');
  const directCommission = gold('lv1Bonus') + gold('inviteBonusLv1');
  const otherCommission = gold('lv2Bonus') + gold('lv3Bonus') + gold('inviteBonusLv2') + gold('inviteBonusLv3');
  return {
    totalMember: directMember + otherMember,
    directMember,
    otherMember,
    totalPerformance: directPerformance + otherPerformance,
    directPerformance,
    otherPerformance,
    totalDeposit: shown('lv1Deposit') + shown('lv2Deposit') + shown('lv3Deposit'),
    totalWithdraw: shown('lv1Withdraw') + shown('lv2Withdraw') + shown('lv3Withdraw'),
    totalDiscount: 0,
    totalValidBet: directPerformance + otherPerformance,
    totalProfitLose: gold('lv1TotalWin') + gold('lv2TotalWin') + gold('lv3TotalWin'),
    totalCommission: directCommission + otherCommission,
    directCommission,
    otherCommission,
    promoteActiveAmount: 0,
    agentActiveAmount: 0,
    takenCommission: 0,
    canTakeCommission: 0,
    sumCommission: 0,
    list: [],
    records: [],
    total: 0,
    count: 0,
    totalRecords: 0
  };
}

function serviceLabel(item) {
  const name = String((item && (item.customName || item.customTitle)) || '').trim();
  if (name) return name;
  const phone = String((item && item.phone) || '').trim();
  try { return new URL(phone).host; } catch (_) { return phone; }
}

function mapStaff(res) {
  const rows = protoList(res, 'item').filter((it) => it && String(it.phone || '').trim());
  return {
    customer: {
      customerContentConfig: [],
      liveChatCustomer: null,
      onlineCustomers: rows.map((it, index) => ({
        id: index + 1,
        customerName: serviceLabel(it),
        customerUrl: String(it.phone).trim(),
        customerCode: '',
        icon: '',
        openType: 2,
        onlineTime: '00:00,23:59',
        vipLevels: '',
        displayPage: 0,
        appDisplayPage: 0,
        h5DisplayPage: 0
      })),
      otherCustomers: []
    },
    question: [],
    ipInfo: { city: '', country: '', countryCode: '', ip: '', regionCode: '', regionName: '' },
    siteCode: '',
    time: Math.floor(Date.now() / 1000)
  };
}

function mapNotices(res, type) {
  const rows = protoList(res, 'announceItem').map((it, index) => ({
    id: index + 1,
    title: String((it && it.noticeTitle) || ''),
    content: String((it && it.noticeContent) || (it && it.noticeTitle) || ''),
    create_time: Number(it && it.publishTime) || 0,
    read_status: 1
  })).filter((it) => it.title || it.content);
  const marquees = rows.map((it) => ({
    id: it.id,
    content: it.content || it.title,
    create_time: it.create_time,
    interval: 5
  }));
  const kind = Number(type);
  const out = {
    marqueeList: [],
    noticeMsgList: [],
    announcementMsgList: [],
    unreadNoticeCount: 0,
    unreadAnnouncementCount: 0
  };
  if (kind === 1) out.noticeMsgList = rows;
  else if (kind === 2) out.announcementMsgList = rows;
  else if (kind === 3) out.marqueeList = marquees;
  else {
    out.noticeMsgList = rows;
    out.announcementMsgList = rows;
    out.marqueeList = marquees;
  }
  return out;
}

function mapNoticeDetail(res, id) {
  const rows = mapNotices(res, 99).noticeMsgList;
  const want = Number(id) || 0;
  const hit = rows.find((it) => Number(it.id) === want) || null;
  if (!hit) {
    return {
      id: want,
      title: '',
      content: '',
      create_time: 0,
      read_status: 1,
      triggerId: 0,
      activityId: 0,
      activityLogId: 0
    };
  }
  return {
    id: hit.id,
    title: hit.title,
    content: hit.content,
    create_time: hit.create_time,
    read_status: 1,
    triggerId: 0,
    activityId: 0,
    activityLogId: 0,
    paramData: '',
    intelliParam: ''
  };
}

module.exports = {
  happyToDisplay,
  mapMoney,
  mapYuebao,
  mapBalanceHistory,
  mapStaff,
  mapNotices,
  mapNoticeDetail,
  mapVipDetail,
  applyVipClaimFlags,
  mapPayways,
  mapEnableWithdraw,
  mapDrawChannels,
  mapWithdrawInfo,
  mapDayRechargeBonus,
  mapChargeRecords,
  mapWithdrawRecords,
  mapChargeWithdrawRecords,
  mapProxyUsers,
  mapProxyBetList,
  mapProxyWinList,
  mapMemberDetail,
  mapChargeRunningList,
  mapDirectData,
  mapCommissionDetail,
  mapReceivePayments,
  mapBetDetail,
  emptyPersonalReport,
  mapProxyStatistics,
  mapTeamData,
  mapBetRates
};
