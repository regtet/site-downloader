/**
 * 还没有接到 wgame 的接口：本地立刻回一份可解析数据，避免再去官方站超时。
 * 已有映射的接口不走这里。
 */

function unixNow() {
  return Math.floor(Date.now() / 1000);
}

function normPath(pathname) {
  let p = String(pathname || '').split('?')[0];
  if (p.startsWith('/hall/')) p = p.slice('/hall'.length);
  return p;
}

function isGetServerTime(pathname) {
  return /\/getServerTime$/i.test(normPath(pathname));
}

/** 活动列表：大厅读 categoryList + activeList */
function activityCategoryMock() {
  return {
    categoryList: [
      { categoryId: 1, name: 'Promoção', activeCount: 1, sort: 1 }
    ],
    activeList: [
      {
        activeId: 900001,
        activeName: 'Promoção',
        template: 1,
        categories: '1',
        categoryId: 1,
        remark: '{}',
        imgId: '',
        status: 1,
        startShowTime: 0,
        endShowTime: 4102444800,
        startTime: 0,
        endTime: 4102444800
      }
    ]
  };
}

/**
 * @returns {null | { raw?: boolean, body: object }}
 * raw=true 时按原文返回（getServerTime），否则由调用方包成 {code,data}
 */
function mockHoldBody(pathname) {
  const p = normPath(pathname);
  if (isGetServerTime(p)) {
    return { raw: true, body: { getServerTime: unixNow() } };
  }
  if (p === '/api/active/category' || p === '/api/active/categoryV2') {
    return { raw: false, body: activityCategoryMock() };
  }
  if (p === '/api/active/getByTemplate') {
    return {
      raw: false,
      body: {
        template: 1,
        activeId: 900001,
        activeName: 'Promoção',
        content: '',
        html: '',
        list: [],
        rules: []
      }
    };
  }
  if (p === '/api/active/isShowV2' || p === '/api/active/announcement') {
    return { raw: false, body: { list: [], show: 0 } };
  }
  return null;
}

function isApiPath(pathname) {
  const p = normPath(pathname);
  return p.indexOf('/api/') === 0;
}

module.exports = {
  unixNow,
  normPath,
  isGetServerTime,
  isApiPath,
  mockHoldBody,
  activityCategoryMock
};
