const aniwLobby = require('./aniw-lobby');

const SERIES = {
  'aniw-lobby': aniwLobby
};

function getSeries(id) {
  const key = String(id || 'aniw-lobby');
  return SERIES[key] || null;
}

module.exports = {
  SERIES,
  getSeries
};
