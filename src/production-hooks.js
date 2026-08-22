/**
 * 将 PAY_HTTP_URL / AGENT_HTTP_BASE 等环境变量写入 adapter-hosts，
 * 并在 export 时保留非 localhost 的生产配置。
 */
function isLocalDevUrl(url) {
  if (!url) return true;
  return /^(https?:\/\/)?(127\.0\.0\.1|localhost)(:|\/|$)/i.test(String(url));
}

function applyProductionHooks(adapterHosts) {
  if (!adapterHosts || typeof adapterHosts !== 'object') return adapterHosts;
  const po = adapterHosts.providerOptions || (adapterHosts.providerOptions = {});
  const pay = po.pay || (po.pay = {});
  const co = pay.createOrder || (pay.createOrder = {});
  const agent = po.agent || (po.agent = {});

  if (process.env.PAY_HTTP_URL) {
    co.httpUrl = String(process.env.PAY_HTTP_URL);
    co.mode = 'http';
    co.useBuiltinMock = false;
  }
  if (process.env.PAY_USE_BUILTIN_MOCK === '1') {
    co.useBuiltinMock = true;
  }
  if (process.env.AGENT_HTTP_BASE) {
    agent.httpBase = String(process.env.AGENT_HTTP_BASE);
    agent.useBuiltinMock = false;
  }
  if (process.env.AGENT_USE_BUILTIN_MOCK === '1') {
    agent.useBuiltinMock = true;
  }
  return adapterHosts;
}

function mergePreservedProductionHooks(next, preserved) {
  if (!preserved || !preserved.providerOptions) return applyProductionHooks(next);
  const pPay = preserved.providerOptions.pay || {};
  const pAgent = preserved.providerOptions.agent || {};
  const nPay = next.providerOptions.pay || {};
  const nAgent = next.providerOptions.agent || {};
  const pUrl = pPay.createOrder && pPay.createOrder.httpUrl;
  const pBase = pAgent.httpBase;

  if (pUrl && !isLocalDevUrl(pUrl) && !process.env.PAY_HTTP_URL) {
    nPay.createOrder = Object.assign({}, nPay.createOrder, {
      httpUrl: pUrl,
      mode: 'http',
      useBuiltinMock: false
    });
  }
  if (pBase && !isLocalDevUrl(pBase) && !process.env.AGENT_HTTP_BASE) {
    nAgent.httpBase = pBase;
    nAgent.useBuiltinMock = false;
  }
  return applyProductionHooks(next);
}

module.exports = {
  isLocalDevUrl,
  applyProductionHooks,
  mergePreservedProductionHooks
};
