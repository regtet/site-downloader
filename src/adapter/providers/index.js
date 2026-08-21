const wgame = require('./wgame');

const PROVIDERS = {
  wgame
};

function getProvider(id) {
  const key = String(id || 'wgame');
  return PROVIDERS[key] || null;
}

module.exports = {
  PROVIDERS,
  getProvider
};
