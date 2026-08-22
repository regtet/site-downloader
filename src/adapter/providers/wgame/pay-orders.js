/**
 * 本地充值订单表：支持 orderInfo 轮询（staticQr / http 下单后）
 */
const orders = new Map();

function putOrder(order) {
  if (!order || !order.orderNo) return order;
  const row = Object.assign({
    status: 'wait',
    createdAt: Date.now()
  }, order);
  orders.set(String(order.orderNo), row);
  return row;
}

function getOrder(orderNo) {
  if (!orderNo) return null;
  return orders.get(String(orderNo)) || null;
}

function listOrders() {
  return [...orders.values()];
}

module.exports = {
  putOrder,
  getOrder,
  listOrders,
  orders
};
