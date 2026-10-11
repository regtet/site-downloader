const aniwLobby = require('./aniw-lobby');
const hmsPlatform = require('./hms-platform');
const boi = require('./boi');
const fa = require('./fa');
const zg = require('./zg');
const xmCfg = require('./xm-cfg');

const SERIES = {
    'aniw-lobby': aniwLobby,
    'hms-platform': hmsPlatform,
    boi,
    fa,
    zg,
    'xm-cfg': xmCfg
};

function getSeries(id) {
    const key = String(id || 'aniw-lobby');
    return SERIES[key] || null;
}

module.exports = {
    SERIES,
    getSeries
};
