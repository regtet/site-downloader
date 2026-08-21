const Pipeline = require('./pipeline');

/** @deprecated 使用 Pipeline；保留此类名以兼容旧引用 */
class Crawler extends Pipeline {}

module.exports = Crawler;
module.exports.Pipeline = Pipeline;
