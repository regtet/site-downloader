const aniwLobby = require('./aniw-lobby');
const hmsPlatform = require('./hms-platform');

const SERIES = {
  'aniw-lobby': aniwLobby,
  'hms-platform': hmsPlatform
};

function getSeries(id) {
  const key = String(id || 'aniw-lobby');
  return SERIES[key] || null;
}

module.exports = {
  SERIES,
  getSeries
};
