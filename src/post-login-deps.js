/**
 * 登录后接口依赖分析（只分析，不改 Adapter）
 *
 * 基准：目标站真实登录后 Network
 * 对照：migrated dist 登录后 Network
 * 产出：按页面分类的依赖表 +「哪个接口 → 哪个页面异常」
 */
require('./playwright-env');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { getPlaywrightProxy, applySystemProxy } = require('./system-proxy');
const { MIGRATION_MAP } = require('./adapter/series/aniw-lobby/migration-map');
const { memberProfile } = require('./adapter/series/aniw-lobby/adapters');

applySystemProxy({ log: false });

const PAGE_CATS = ['home', 'profile', 'wallet', 'recharge', 'withdraw', 'activity', 'vip', 'auth', 'message', 'game', 'other'];

const STATUS = {
  REPLACED_OK: '已正确替换',
  NOT_REPLACED: '未替换',
  INCOMPATIBLE: '替换但返回结构不兼容',
  MISSING_FIELDS: '请求成功但字段缺失',
  KEEP_OSS: '不应该替换，应继续走 OSS/静态资源'
};

const CRITICAL_FIELDS = {
  nickname: ['nickname', 'username'],
  avatar: ['portrait_id', 'avatar'],
  vip: ['vip_level'],
  wallet: ['game_gold', 'totalGold', 'availableMargin'],
  rechargeInit: ['payList', 'list', 'channels', 'types', 'payType'],
  loginConfig: ['session_key', 'jwt_token', 'token', 'user_id', 'userid', 'userkey']
};

function normalizePath(raw) {
  let p = String(raw || '').split('?')[0].split('#')[0];
  try {
    if (/^https?:\/\//i.test(p)) p = new URL(p).pathname;
  } catch (_) { /* ignore */ }
  if (!p.startsWith('/')) p = '/' + p;
  if (p.startsWith('/hall/api/')) p = '/api/' + p.slice('/hall/api/'.length);
  // 去掉语言/货币等静态尾缀里常见的动态段，保留业务根
  p = p.replace(/\/currency\/[^/]+/gi, '');
  p = p.replace(/\/language\/[^/]+/gi, '');
  p = p.replace(/\/osType\/[^/]+/gi, '');
  p = p.replace(/\/platformType\/[^/]+/gi, '');
  p = p.replace(/\/page\/\d+/gi, '');
  p = p.replace(/\/type\/\d+/gi, '');
  p = p.replace(/\/xdevice\/[^/]+/gi, '');
  p = p.replace(/\/default\.json$/i, '');
  p = p.replace(/\.json$/i, '');
  return p.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
}

function classifyPage(pathname) {
  const p = pathname.toLowerCase();
  if (/\/api\/member\/(login|register|fastlogin|getfastlogin|thirdparty|check\/register|agent\/login|logout|temporary)/.test(p)) return 'auth';
  if (/\/api\/member\/user\/(vip|vipinfo|refreshvip)/.test(p) || /\/api\/.*vip|\/allviplevel/.test(p)) return 'vip';
  if (/\/api\/member\/user\/(info|avatars|updateuseravatars|modifyinfo|settings)/.test(p)
    || /\/api\/member\/v2\/user\/info/.test(p)
    || /\/api\/member\/listaccount|\/api\/member\/user\/(gift|restrict|security|device)/.test(p)) return 'profile';
  if (/\/api\/gamecenter\/(gold|gameapi\/refreshgold|gameapi\/getplatformbalance)|\/wallet/.test(p)
    || /\/api\/finance\/(user\/account|wallettypes|setting$)/.test(p)) return 'wallet';
  if (/\/api\/finance\/(pay|maxchargerate|paylist|paytype|payplatform|paypopup|opttypes|dealtypes)/.test(p)
    || /charge|recharge/.test(p)) return 'recharge';
  if (/\/api\/finance\/.*withdraw|\/api\/finance\/certify|\/api\/finance\/claim/.test(p)) return 'withdraw';
  if (/\/api\/active|activity|reward|task|reddot|receivedaward/.test(p)) return 'activity';
  if (/\/api\/(lobby|site|config|footer|about|publicity|optimization|getsite|getapp|backstage\/system)/.test(p)
    || /maintain-time|ssocdn|domainmatch|ipacdn|\/hall\/version/.test(p)) return 'home';
  if (/\/api\/message|notice|mail|popupcfg/.test(p)) return 'message';
  if (/\/api\/game|\/gamecenter|\/game\/hall|bonuspool|hotlist|platformcate/.test(p)) return 'game';
  return 'other';
}

function isOssStaticPath(pathname, url) {
  const p = pathname.toLowerCase();
  if (/\.json$/i.test(String(url || '')) && /\/api\/(lobby|active|game\/hall|message|backstage)\//.test(p)) return true;
  if (/\/api\/lobby\/(site\/getsiteinfo|config\/|footer|about|publicity|winnercarousel|webapi\/optimization)/.test(p)) return true;
  if (/\/api\/game\/hall\/(hotlist|listbonus|listplatform|gameversion)/.test(p)) return true;
  if (/\/api\/active\/isshow|\/api\/message\/popupcfg|\/api\/backstage\/system\/status/.test(p)) return true;
  if (/\/api\/finance\/maxchargerate/.test(p)) return true; // 充值费率常挂 OSS json
  return false;
}

function lookupMigration(pathname) {
  const p = normalizePath(pathname);
  if (MIGRATION_MAP[p]) return { path: p, ...MIGRATION_MAP[p] };
  // 原 path 带 /hall 已 normalize；再试精确 key
  for (const key of Object.keys(MIGRATION_MAP)) {
    if (p === key || p.startsWith(key + '/')) return { path: key, ...MIGRATION_MAP[key] };
  }
  return null;
}

function deepKeys(obj, prefix = '', acc = [], depth = 0) {
  if (obj == null || depth > 4) return acc;
  if (Array.isArray(obj)) {
    if (obj[0] && typeof obj[0] === 'object') deepKeys(obj[0], prefix + '[]', acc, depth + 1);
    return acc;
  }
  if (typeof obj !== 'object') return acc;
  for (const k of Object.keys(obj)) {
    const next = prefix ? `${prefix}.${k}` : k;
    acc.push(next);
    if (obj[k] && typeof obj[k] === 'object') deepKeys(obj[k], next, acc, depth + 1);
  }
  return acc;
}

function pickData(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.data != null && typeof body.data === 'object') return body.data;
  return body;
}

function missingCritical(kind, data) {
  const need = CRITICAL_FIELDS[kind] || [];
  if (!data || typeof data !== 'object') return need.slice();
  const flat = new Set(deepKeys(data).map((k) => k.split('.').pop()));
  Object.keys(data).forEach((k) => flat.add(k));
  return need.filter((f) => !flat.has(f) && data[f] == null);
}

function impactForPath(pathname) {
  const p = pathname.toLowerCase();
  const impacts = [];
  if (/\/api\/member\/(login|getfastlogin|user\/info|v2\/user\/info)/.test(p)) {
    impacts.push(
      { symptom: '个人中心昵称异常', fields: CRITICAL_FIELDS.nickname },
      { symptom: '头像异常', fields: CRITICAL_FIELDS.avatar },
      { symptom: 'VIP 展示异常', fields: CRITICAL_FIELDS.vip },
      { symptom: '登录后配置/会话异常', fields: CRITICAL_FIELDS.loginConfig }
    );
  }
  if (/\/api\/member\/user\/(avatars|updateuseravatars)/.test(p)) {
    impacts.push({ symptom: '头像异常', fields: CRITICAL_FIELDS.avatar });
  }
  if (/\/api\/member\/user\/vip|\/api\/active\/allviplevel|vipinfov2|vipdetails/.test(p)) {
    impacts.push({ symptom: 'VIP 页面/等级异常', fields: CRITICAL_FIELDS.vip });
  }
  if (/\/api\/gamecenter\/(gold|gameapi\/refreshgold|gameapi\/getplatformbalance)/.test(p)) {
    impacts.push({ symptom: '钱包余额异常', fields: CRITICAL_FIELDS.wallet });
  }
  if (/\/api\/finance\/(pay\/paylist|paylist|pay\/paytype|paytype|pay\/getpaychannel|payplatform|maxchargerate|pay\/payinfos)/.test(p)) {
    impacts.push(
      { symptom: '充值页面无法正常显示', fields: CRITICAL_FIELDS.rechargeInit },
      { symptom: '支付渠道异常', fields: CRITICAL_FIELDS.rechargeInit }
    );
  }
  if (/\/api\/finance\/pay\//.test(p)) {
    impacts.push({ symptom: '充值/支付流程异常', fields: [] });
  }
  if (/\/api\/finance\/certify\/withdraw|\/api\/finance\/.*withdraw/.test(p)) {
    impacts.push({ symptom: '提现页面异常', fields: [] });
  }
  if (/\/api\/lobby\/(site\/getsiteinfo|webapi\/optimization)|\/api\/backstage\/system\/status/.test(p)) {
    impacts.push({ symptom: '登录后配置/站点配置异常', fields: [] });
  }
  if (/\/api\/active\//.test(p)) {
    impacts.push({ symptom: '活动页面异常', fields: [] });
  }
  return impacts;
}

function summarizeBody(text, contentType) {
  const out = {
    okJson: false,
    code: null,
    msg: null,
    topKeys: [],
    dataKeys: [],
    rawSample: null
  };
  if (!text) return out;
  const ct = String(contentType || '').toLowerCase();
  if (!ct.includes('json') && !/^\s*[{[]/.test(text)) {
    out.rawSample = text.slice(0, 120);
    return out;
  }
  try {
    const body = JSON.parse(text);
    out.okJson = true;
    out.code = body.code != null ? body.code : (body.status != null ? body.status : null);
    out.msg = body.msg != null ? String(body.msg).slice(0, 120) : (body.message || null);
    out.topKeys = Object.keys(body).slice(0, 30);
    const data = pickData(body);
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      out.dataKeys = Object.keys(data).slice(0, 40);
    } else if (Array.isArray(data)) {
      out.dataKeys = ['[]'];
      if (data[0] && typeof data[0] === 'object') out.dataKeys = out.dataKeys.concat(Object.keys(data[0]).slice(0, 30));
    }
    out._data = data;
    out._body = body;
  } catch (_) {
    out.rawSample = text.slice(0, 120);
  }
  return out;
}

async function tryLogin(page, account, password) {
  if (!account || !password) return { ok: false, reason: 'missing credentials' };

  // 尝试点开登录入口
  const openSelectors = [
    'text=登录', 'text=登錄', 'text=Login', 'text=Entrar', 'text=Sign in',
    '[class*="login"]', '[class*="Login"]', 'button:has-text("登录")', 'button:has-text("Entrar")'
  ];
  for (const sel of openSelectors) {
    try {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 800 })) {
        await el.click({ timeout: 1500 });
        await page.waitForTimeout(500);
        break;
      }
    } catch (_) { /* next */ }
  }

  const userSelectors = [
    'input[type="text"]', 'input[type="tel"]', 'input[name*="user" i]', 'input[name*="account" i]',
    'input[name*="login" i]', 'input[placeholder*="账号" i]', 'input[placeholder*="用户" i]',
    'input[placeholder*="account" i]', 'input[placeholder*="usu" i]', 'input[placeholder*="cpf" i]'
  ];
  const passSelectors = [
    'input[type="password"]', 'input[name*="pass" i]', 'input[placeholder*="密码" i]',
    'input[placeholder*="senha" i]', 'input[placeholder*="password" i]'
  ];

  let filledUser = false;
  for (const sel of userSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 600 })) {
        await loc.fill(String(account), { timeout: 2000 });
        filledUser = true;
        break;
      }
    } catch (_) { /* next */ }
  }
  let filledPass = false;
  for (const sel of passSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 600 })) {
        await loc.fill(String(password), { timeout: 2000 });
        filledPass = true;
        break;
      }
    } catch (_) { /* next */ }
  }

  if (!filledUser || !filledPass) {
    return { ok: false, reason: 'login form not found', filledUser, filledPass };
  }

  const submitSelectors = [
    'button[type="submit"]', 'button:has-text("登录")', 'button:has-text("登錄")',
    'button:has-text("Login")', 'button:has-text("Entrar")', 'button:has-text("确认")',
    '[class*="login"] button', '.van-button--primary'
  ];
  for (const sel of submitSelectors) {
    try {
      const loc = page.locator(sel).first();
      if (await loc.isVisible({ timeout: 600 })) {
        await loc.click({ timeout: 2000 });
        break;
      }
    } catch (_) { /* next */ }
  }

  await page.waitForTimeout(3500);
  return { ok: true, filledUser, filledPass };
}

async function clickAroundPostLogin(page) {
  const labels = [
    '我的', '个人', '个人中心', 'Perfil', 'Profile', 'Conta',
    '充值', 'Deposit', 'Depósito', '存款', 'Wallet', 'Carteira',
    '提现', 'Withdraw', 'Saque',
    'VIP', '活动', 'Promo', 'Promoção', '福利'
  ];
  for (const label of labels) {
    try {
      const loc = page.getByText(label, { exact: false }).first();
      if (await loc.isVisible({ timeout: 500 })) {
        await loc.click({ timeout: 1500 });
        await page.waitForTimeout(1800);
      }
    } catch (_) { /* ignore */ }
  }
}

/**
 * @returns {Promise<{ side: string, pageUrl: string, login: object, entries: object[], consoleErrors: string[] }>}
 */
async function capturePostLoginNetwork(options = {}) {
  const {
    pageUrl,
    account,
    password,
    side = 'unknown',
    waitMs = 8000,
    explore = true
  } = options;

  const proxy = getPlaywrightProxy();
  const browser = await chromium.launch({
    headless: true,
    proxy: proxy || undefined,
    args: ['--disable-web-security']
  });
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 420, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  const entries = [];
  const consoleErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 300));
  });

  page.on('response', async (res) => {
    const req = res.request();
    const type = req.resourceType();
    if (!['xhr', 'fetch'].includes(type) && !(type === 'other' && /\/api\//.test(res.url()))) return;
    const url = res.url();
    if (!/\/(?:hall\/)?api\//i.test(url) && !/\/__sd_proxy__/i.test(url)) return;

    let text = '';
    try {
      text = await res.text();
      if (text.length > 200000) text = text.slice(0, 200000);
    } catch (_) { /* ignore */ }

    const headers = res.headers();
    const summary = summarizeBody(text, headers['content-type']);
    const pathname = normalizePath(url);
    entries.push({
      url,
      method: req.method(),
      status: res.status(),
      pathname,
      pageCategory: classifyPage(pathname),
      contentType: headers['content-type'] || '',
      bridge: headers['x-sd-adapter'] || headers['X-SD-Adapter'] || null,
      code: summary.code,
      msg: summary.msg,
      topKeys: summary.topKeys,
      dataKeys: summary.dataKeys,
      okJson: summary.okJson,
      data: summary._data || null,
      body: summary._body || null
    });
  });

  let gotoError = null;
  try {
    await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
  } catch (err) {
    gotoError = String(err && err.message || err);
  }
  await page.waitForTimeout(Math.min(waitMs, 4000));

  const login = await tryLogin(page, account, password);
  await page.waitForTimeout(waitMs);
  if (explore) await clickAroundPostLogin(page);
  await page.waitForTimeout(2500);

  await browser.close();
  return {
    side,
    pageUrl,
    gotoError,
    login,
    entries,
    consoleErrors: consoleErrors.slice(0, 40)
  };
}

function mergeEntries(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = `${e.method || 'GET'} ${e.pathname}`;
    const prev = map.get(key);
    if (!prev) {
      map.set(key, { ...e, hits: 1 });
      continue;
    }
    prev.hits += 1;
    // 保留最后一次有 body 的
    if (e.dataKeys && e.dataKeys.length) {
      prev.status = e.status;
      prev.code = e.code;
      prev.msg = e.msg;
      prev.topKeys = e.topKeys;
      prev.dataKeys = e.dataKeys;
      prev.data = e.data;
      prev.body = e.body;
      prev.bridge = e.bridge || prev.bridge;
    }
  }
  return [...map.values()];
}

function decideStatus(row, sourceRow, localRow) {
  const mapped = lookupMigration(row.pathname);
  const oss = isOssStaticPath(row.pathname, (sourceRow || localRow || {}).url);

  if (oss && !mapped) {
    return {
      status: STATUS.KEEP_OSS,
      note: '大厅/活动/游戏列表等配置型接口，应继续 OSS/aniw，不进 wgame Bridge'
    };
  }

  if (!mapped) {
    const localFail = localRow && (localRow.status >= 400 || (localRow.code != null && Number(localRow.code) !== 1));
    return {
      status: STATUS.NOT_REPLACED,
      note: localFail
        ? `未进 migration-map；本地 status=${localRow.status} code=${localRow.code}`
        : '未进 migration-map；登录后仍打原 aniw/OSS 路径'
    };
  }

  if (!localRow) {
    return {
      status: STATUS.NOT_REPLACED,
      note: `已映射 ${mapped.op}，但本地登录后未观察到该请求`
    };
  }

  if (!localRow.bridge) {
    return {
      status: STATUS.NOT_REPLACED,
      note: `migration-map 有 ${mapped.op}，但响应无 X-SD-Adapter（可能未命中 Bridge）`
    };
  }

  if (localRow.code != null && Number(localRow.code) !== 1) {
    return {
      status: STATUS.INCOMPATIBLE,
      note: `Bridge 已处理但业务 code=${localRow.code} msg=${localRow.msg || ''}`
    };
  }

  // 字段对比：相对源站 dataKeys，或相对 Adapter 承诺字段
  const srcKeys = new Set((sourceRow && sourceRow.dataKeys) || []);
  const locKeys = new Set((localRow.dataKeys) || []);
  const criticalKinds = [];
  if (/user\/info|login|getfastlogin/.test(row.pathname)) criticalKinds.push('nickname', 'avatar', 'vip', 'loginConfig');
  if (/gold|refreshgold|getplatformbalance/.test(row.pathname)) criticalKinds.push('wallet');
  if (/paylist|paytype|getpaychannel|payplatform/.test(row.pathname)) criticalKinds.push('rechargeInit');

  const missing = [];
  for (const kind of criticalKinds) {
    for (const f of missingCritical(kind, localRow.data)) missing.push(`${kind}:${f}`);
  }

  // 源站有、本地完全没有的关键 key
  if (srcKeys.size && locKeys.size) {
    for (const k of ['nickname', 'username', 'portrait_id', 'headimg', 'avatar', 'vip_level', 'game_gold', 'session_key']) {
      if (srcKeys.has(k) && !locKeys.has(k) && (localRow.data == null || localRow.data[k] == null)) {
        missing.push(`vs-source:${k}`);
      }
    }
  }

  if (missing.length) {
    return {
      status: STATUS.MISSING_FIELDS,
      note: `Bridge 成功(code=1)但缺字段: ${[...new Set(missing)].join(', ')}`,
      missingFields: [...new Set(missing)]
    };
  }

  return {
    status: STATUS.REPLACED_OK,
    note: `Bridge ${mapped.op}/${mapped.adapter}`
  };
}

function buildSpecialAnalysis(rows) {
  const find = (re) => rows.filter((r) => re.test(r.pathname));
  const section = (title, related, focusFields) => {
    const items = related.map((r) => ({
      path: r.pathname,
      page: r.pageCategory,
      status: r.status,
      note: r.note,
      sourceCode: r.source && r.source.code,
      localCode: r.local && r.local.code,
      localDataKeys: (r.local && r.local.dataKeys) || [],
      sourceDataKeys: (r.source && r.source.dataKeys) || [],
      impacts: r.impacts
    }));
    return { title, focusFields, apis: items };
  };

  return [
    section('用户昵称', find(/\/api\/member\/(login|getfastlogin|user\/info|v2\/user\/info)/), CRITICAL_FIELDS.nickname),
    section('头像', find(/\/api\/member\/(login|getfastlogin|user\/info|v2\/user\/info|user\/avatars|updateuseravatars)/), CRITICAL_FIELDS.avatar),
    section('VIP', find(/vip|allviplevel/i), CRITICAL_FIELDS.vip),
    section('钱包余额', find(/\/api\/gamecenter\/(gold|gameapi\/refreshgold|gameapi\/getplatformbalance)/i), CRITICAL_FIELDS.wallet),
    section('充值页面初始化', find(/\/api\/finance\/(maxchargerate|pay\/paylist|paylist|pay\/paytype|paytype|pay\/payinfos|setting)/i), CRITICAL_FIELDS.rechargeInit),
    section('支付渠道', find(/\/api\/finance\/(pay\/getpaychannel|payplatform|pay\/paylist|paylist|paytype)/i), CRITICAL_FIELDS.rechargeInit),
    section('登录后配置', find(/\/api\/(lobby\/site\/getsiteinfo|lobby\/webapi\/optimization|backstage\/system\/status|member\/getfastlogin|member\/user\/info)/i), CRITICAL_FIELDS.loginConfig)
  ];
}

function buildPageAnomalies(rows) {
  const byPage = {};
  for (const cat of ['home', 'profile', 'wallet', 'recharge', 'withdraw', 'activity', 'vip']) {
    byPage[cat] = [];
  }
  for (const r of rows) {
    if (r.status === STATUS.REPLACED_OK || r.status === STATUS.KEEP_OSS) continue;
    const page = r.pageCategory;
    if (!byPage[page]) byPage[page] = [];
    for (const imp of r.impacts || []) {
      byPage[page].push({
        api: r.pathname,
        status: r.status,
        causes: imp.symptom,
        note: r.note
      });
    }
    if (!(r.impacts || []).length) {
      byPage[page].push({
        api: r.pathname,
        status: r.status,
        causes: `${page} 功能异常（待确认）`,
        note: r.note
      });
    }
  }
  return byPage;
}

function analyzePair(sourceCapture, localCapture, options = {}) {
  const sourceMerged = mergeEntries(sourceCapture.entries || []);
  const localMerged = mergeEntries(localCapture.entries || []);
  const sourceMap = new Map(sourceMerged.map((e) => [`${e.method} ${e.pathname}`, e]));
  const localMap = new Map(localMerged.map((e) => [`${e.method} ${e.pathname}`, e]));

  const keys = new Set([...sourceMap.keys(), ...localMap.keys()]);
  // 仅分析「源站登录后出现过」或「本地 Bridge/业务」的接口；过滤纯统计噪音可选
  const rows = [];
  for (const key of keys) {
    const source = sourceMap.get(key) || null;
    const local = localMap.get(key) || null;
    const sample = source || local;
    if (!sample) continue;
    if (/\/api\/statistics\/|pointer|heartbeat|cdn-cgi|reportview/i.test(sample.pathname)) continue;

    // 若只要源站基准：跳过仅本地有的（仍保留 Bridge 命中项便于看替换结果）
    if (options.sourceOnlyBaseline && !source && !(local && local.bridge)) continue;

    const decision = decideStatus(sample, source, local);
    const mapped = lookupMigration(sample.pathname);
    rows.push({
      method: sample.method,
      pathname: sample.pathname,
      pageCategory: classifyPage(sample.pathname),
      inSource: !!source,
      inLocal: !!local,
      mapped: mapped ? { op: mapped.op, adapter: mapped.adapter } : null,
      status: decision.status,
      note: decision.note,
      missingFields: decision.missingFields || [],
      impacts: impactForPath(sample.pathname),
      source: source && {
        status: source.status,
        code: source.code,
        dataKeys: source.dataKeys,
        hits: source.hits
      },
      local: local && {
        status: local.status,
        code: local.code,
        bridge: local.bridge,
        dataKeys: local.dataKeys,
        hits: local.hits
      }
    });
  }

  rows.sort((a, b) => {
    const pa = PAGE_CATS.indexOf(a.pageCategory);
    const pb = PAGE_CATS.indexOf(b.pageCategory);
    if (pa !== pb) return pa - pb;
    return a.pathname.localeCompare(b.pathname);
  });

  const byCategory = {};
  const byStatus = {};
  for (const r of rows) {
    if (!byCategory[r.pageCategory]) byCategory[r.pageCategory] = [];
    byCategory[r.pageCategory].push(r);
    byStatus[r.status] = (byStatus[r.status] || 0) + 1;
  }

  // Adapter 静态缺口（无实网时也给结论）
  const adapterFieldGap = {
    note: '相对目标 UI 常用字段；wgame 登录包有 faceID/nickname/vip，但 Adapter 未保证目标站全部别名与头像 URL 规则',
    memberProfileEmits: Object.keys(memberProfile({
      account: 'a', session: 's', userId: 1, game_gold: 1,
      nickname: 'n', phone: 'p', email: 'e', vip_level: 1, face_id: 2, account_type: 1
    }) || {}),
    suspectedGaps: [
      { field: 'portrait_id/headimg 仅为 face id 数字', symptom: '头像异常', reason: '目标站常要 CDN 头像 URL 或 /api/member/user/avatars 列表' },
      { field: 'vip 详情接口未替换', symptom: 'VIP 异常', reason: '/api/member/user/vip* / allVipLevel 未进 map' },
      { field: '充值 payList/payType 未替换', symptom: '充值页空白/异常', reason: 'finance/pay/* 全部未进 map，登录态 token 与 aniw 不互通时必挂' }
    ]
  };

  return {
    generatedAt: new Date().toISOString(),
    source: {
      pageUrl: sourceCapture.pageUrl,
      login: sourceCapture.login,
      gotoError: sourceCapture.gotoError,
      apiCount: sourceMerged.length,
      consoleErrors: sourceCapture.consoleErrors
    },
    local: {
      pageUrl: localCapture.pageUrl,
      login: localCapture.login,
      gotoError: localCapture.gotoError,
      apiCount: localMerged.length,
      consoleErrors: localCapture.consoleErrors
    },
    summary: {
      totalCompared: rows.length,
      byStatus,
      byCategoryCount: Object.fromEntries(
        Object.keys(byCategory).map((k) => [k, byCategory[k].length])
      )
    },
    dependencyTable: rows,
    byCategory,
    specialAnalysis: buildSpecialAnalysis(rows),
    pageAnomalies: buildPageAnomalies(rows),
    adapterFieldGap,
    nextFixOrder: buildNextFixOrder(rows)
  };
}

function buildNextFixOrder(rows) {
  const priority = [
    { re: /\/api\/member\/(user\/info|v2\/user\/info|getfastlogin|login)/, label: '用户资料字段（昵称/头像/VIP）' },
    { re: /\/api\/member\/user\/avatars/, label: '头像列表' },
    { re: /\/api\/gamecenter\/(gold|gameapi\/refreshgold)/i, label: '钱包余额' },
    { re: /\/api\/finance\/(pay\/paylist|paylist|pay\/paytype|paytype|pay\/getpaychannel|maxchargerate)/i, label: '充值初始化/支付渠道' },
    { re: /\/api\/member\/user\/vip|allviplevel/i, label: 'VIP' },
    { re: /\/api\/finance\/.*withdraw|certify\/withdraw/i, label: '提现' },
    { re: /\/api\/active\//, label: '活动' }
  ];
  const out = [];
  for (const p of priority) {
    const hit = rows.filter((r) => p.re.test(r.pathname) && r.status !== STATUS.REPLACED_OK && r.status !== STATUS.KEEP_OSS);
    if (hit.length) {
      out.push({
        label: p.label,
        count: hit.length,
        apis: hit.slice(0, 12).map((r) => ({ path: r.pathname, status: r.status, note: r.note }))
      });
    }
  }
  return out;
}

/**
 * 无实网抓包时：用 dist JS 扫描 + migration-map 生成「预期登录后依赖表」
 */
function analyzeFromDistScan(siteDir) {
  const scanPath = path.join(siteDir, 'post-login-js-scan.json');
  let scan = null;
  if (fs.existsSync(scanPath)) {
    scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  } else {
    // 轻量内联扫描
    const { spawnSync } = require('child_process');
    spawnSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'scan-post-login-js.js'), siteDir], { stdio: 'ignore' });
    if (fs.existsSync(scanPath)) scan = JSON.parse(fs.readFileSync(scanPath, 'utf8'));
  }
  const apis = (scan && scan.apiHits) || [];
  const fakeSource = {
    pageUrl: 'static-scan:' + siteDir,
    login: { ok: false, reason: 'static-only' },
    entries: apis.map((a) => ({
      method: 'POST',
      pathname: normalizePath(a.path),
      url: a.path,
      status: 200,
      pageCategory: classifyPage(a.path),
      dataKeys: [],
      hits: a.count
    })),
    consoleErrors: []
  };
  const fakeLocal = {
    pageUrl: 'static-scan-local',
    login: { ok: false, reason: 'static-only' },
    entries: fakeSource.entries.map((e) => {
      const mapped = lookupMigration(e.pathname);
      let data = null;
      let dataKeys = [];
      if (mapped && mapped.adapter === 'memberProfile') {
        data = memberProfile({
          account: 'u', session: 's', userId: 1, game_gold: 10,
          nickname: 'n', vip_level: 0, face_id: 1
        });
        dataKeys = Object.keys(data || {});
      } else if (mapped && mapped.adapter === 'walletGold') {
        data = { game_gold: 10, totalGold: 10, availableMargin: 10 };
        dataKeys = Object.keys(data);
      }
      return {
        ...e,
        bridge: mapped ? 'migration-bridge' : null,
        code: mapped ? 1 : null,
        dataKeys,
        data
      };
    }),
    consoleErrors: []
  };
  const report = analyzePair(fakeSource, fakeLocal, { sourceOnlyBaseline: true });
  report.mode = 'static-dist-scan';
  report.warning = '未提供实网登录抓包：本表来自 dist JS 静态扫描 + migration-map 推断。请用账号跑实网对比以确认「字段缺失/结构不兼容」。';

  // 静态模式补充：已映射但仍会导致已知页面异常的结论
  report.knownGapsWithoutLiveCapture = [
    {
      api: '/api/member/login | getFastLogin | user/info',
      status: STATUS.MISSING_FIELDS,
      symptom: '个人中心昵称/头像异常',
      reason: 'Adapter 只映射 wgame 有的 nickname/face_id；目标站头像常依赖 avatars 列表或 CDN URL，且部分 UI 读非 username 的展示名规则'
    },
    {
      api: '/api/member/user/avatars',
      status: STATUS.NOT_REPLACED,
      symptom: '头像异常',
      reason: '未进 migration-map'
    },
    {
      api: '/api/member/user/vip* /vipInfoV2 /active/allVipLevel',
      status: STATUS.NOT_REPLACED,
      symptom: 'VIP 异常',
      reason: '未进 migration-map；仅有登录包 vip_level 不够撑 VIP 页'
    },
    {
      api: '/api/finance/pay/payList* /payType* /getPayChannel /maxChargeRate',
      status: STATUS.NOT_REPLACED,
      symptom: '充值页面无法正常显示 / 支付渠道异常',
      reason: '整组未替换；本地 session 与 aniw 不互通时上游会鉴权失败或空数据'
    },
    {
      api: '/api/finance/certify/withdraw*',
      status: STATUS.NOT_REPLACED,
      symptom: '提现/个人中心资金相关异常',
      reason: '运行时已见 bridge unmapped；未进 map'
    },
    {
      api: '/api/lobby/site/getSiteInfo 等',
      status: STATUS.KEEP_OSS,
      symptom: '登录后配置应走 OSS',
      reason: '不应替换为 wgame；若本地 403/空则是 OSS 回源问题而非 Adapter'
    }
  ];
  return report;
}

async function runPostLoginAnalysis(options = {}) {
  const {
    sourceUrl,
    localUrl,
    account,
    password,
    siteDir,
    outPath,
    waitMs = 8000,
    allowStaticFallback = true,
    mode = '',
    sourceDump = null,
    localDump = null,
    sourceCapture = null,
    localCapture = null
  } = options;

  const { parseNetworkDump, assessCaptureQuality } = require('./post-login-capture');

  let report;

  if (mode === 'har' || sourceDump || localDump) {
    const source = parseNetworkDump(sourceDump, 'source-har');
    const local = parseNetworkDump(localDump, 'local-har');
    const qs = assessCaptureQuality(source, '源站');
    const ql = assessCaptureQuality(local, '本地');
    if (!qs.useful || !ql.useful) {
      const err = new Error([qs.message, ql.message].filter(Boolean).join('；') || '双端抓包质量不足');
      err.code = 'CAPTURE_QUALITY';
      err.quality = { source: qs, local: ql };
      throw err;
    }
    report = analyzePair(source, local);
    report.mode = 'imported-har';
    report.quality = { source: qs, local: ql };
    report.raw = {
      sourceEntries: mergeEntries(source.entries),
      localEntries: mergeEntries(local.entries)
    };
  } else if (mode === 'manual' || (sourceCapture && localCapture)) {
    const source = typeof sourceCapture === 'object' && sourceCapture.entries
      ? sourceCapture
      : parseNetworkDump(sourceCapture, 'source-manual');
    const local = typeof localCapture === 'object' && localCapture.entries
      ? localCapture
      : parseNetworkDump(localCapture, 'local-manual');
    const qs = assessCaptureQuality(source, '源站');
    const ql = assessCaptureQuality(local, '本地');
    if (!qs.useful || !ql.useful) {
      const err = new Error([qs.message, ql.message].filter(Boolean).join('；') || '双端抓包质量不足');
      err.code = 'CAPTURE_QUALITY';
      err.quality = { source: qs, local: ql };
      throw err;
    }
    report = analyzePair(source, local);
    report.mode = 'manual-capture-compare';
    report.quality = { source: qs, local: ql };
    report.raw = {
      sourceEntries: mergeEntries(source.entries),
      localEntries: mergeEntries(local.entries)
    };
  } else if (sourceUrl && localUrl && account && password) {
    const sourceCap = await capturePostLoginNetwork({
      pageUrl: sourceUrl,
      account,
      password,
      side: 'source',
      waitMs
    });
    const localCap = await capturePostLoginNetwork({
      pageUrl: localUrl,
      account,
      password,
      side: 'local',
      waitMs
    });
    const qs = assessCaptureQuality(sourceCap, '源站');
    const ql = assessCaptureQuality(localCap, '本地');
    if (!qs.useful || !ql.useful) {
      const err = new Error(
        '自动登录抓包质量不足（已禁用空跑报告）。请改用「导入 HAR」或「手动登录抓包」。'
        + [qs.message, ql.message].filter(Boolean).join('；')
      );
      err.code = 'CAPTURE_QUALITY';
      err.quality = { source: qs, local: ql };
      throw err;
    }
    report = analyzePair(sourceCap, localCap);
    report.mode = 'live-network-compare';
    report.quality = { source: qs, local: ql };
    report.raw = {
      sourceEntries: mergeEntries(sourceCap.entries),
      localEntries: mergeEntries(localCap.entries)
    };
  } else if (allowStaticFallback && siteDir) {
    report = analyzeFromDistScan(siteDir);
  } else {
    throw new Error('请提供双端 HAR、或完成双端手动抓包、或 siteDir 静态扫描');
  }

  const dest = outPath || (siteDir
    ? path.join(siteDir, 'post-login-deps.json')
    : path.join(process.cwd(), 'post-login-deps.json'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const toWrite = { ...report };
  if (toWrite.raw) {
    toWrite.raw = {
      sourceEntries: (toWrite.raw.sourceEntries || []).map(stripHeavy),
      localEntries: (toWrite.raw.localEntries || []).map(stripHeavy)
    };
  }
  fs.writeFileSync(dest, JSON.stringify(toWrite, null, 2), 'utf8');
  report.outPath = dest;
  return report;
}

function stripHeavy(e) {
  const { data, body, ...rest } = e;
  return rest;
}

function loadNetworkDump(filePath) {
  const { parseNetworkDump } = require('./post-login-capture');
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return parseNetworkDump(raw, filePath);
}

module.exports = {
  STATUS,
  PAGE_CATS,
  normalizePath,
  classifyPage,
  capturePostLoginNetwork,
  analyzePair,
  analyzeFromDistScan,
  runPostLoginAnalysis,
  loadNetworkDump,
  impactForPath,
  lookupMigration,
  mergeEntries,
  summarizeBody
};
