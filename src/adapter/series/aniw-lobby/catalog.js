/**
 * @deprecated 请用 migration-map.js；此处仅 re-export 保持旧 require 可用
 */
const { CATALOG, DEFAULT_HOST, OP, MIGRATION_MAP } = require('./migration-map');

const PATH_TO_OP = Object.create(null);
for (const row of CATALOG) PATH_TO_OP[row.path] = row.op;

module.exports = { CATALOG, PATH_TO_OP, DEFAULT_HOST, OP, MIGRATION_MAP };
