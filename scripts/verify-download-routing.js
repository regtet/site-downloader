const assert = require('assert');
const Pipeline = require('../src/pipeline');
const { collectResourceOriginHints } = require('../src/url-classify');
const { isCompatibleAssetResponse } = require('../src/downloader');

const network = [
  { url: 'https://719win.com/assets/app.abc123.js', status: 200 },
  { url: 'https://oniw917.719win.bet/siteadmin/skin/lobby_asset/2-1-8/web/home/a.png', status: 200 },
  { url: 'https://oniw917.719win.bet/cocos/maintain-time.json', status: 200 }
];
const hints = collectResourceOriginHints(network, 'var LOBBY_GAME_URL="https:\/\/www.wgfamilia.com/gogameccc/"', 'https://719win.com/');
assert(hints.byPrefix['/assets/'].includes('https://719win.com'));
assert(hints.byPrefix['/siteadmin/skin/'].includes('https://oniw917.719win.bet'));
assert(hints.byPrefix['/cocos/'].includes('https://oniw917.719win.bet'));
assert(hints.origins.includes('https://www.wgfamilia.com'));

const pipeline = new Pipeline({ runCompare: false });
pipeline.resourceOriginHints = hints;
pipeline.assetCdnBases = ['https://oniw917.719win.bet/siteadmin/skin'];
pipeline.lobbyAssetHints = new Map();
const siteadmin = pipeline.buildFallbackUrls('https://719win.com/siteadmin/skin/x.png');
assert(siteadmin.includes('https://oniw917.719win.bet/siteadmin/skin/x.png'));
const cocos = pipeline.buildFallbackUrls('https://719win.com/cocos/maintain-time.json');
assert(cocos.includes('https://oniw917.719win.bet/cocos/maintain-time.json'));

assert.strictEqual(isCompatibleAssetResponse('https://x/app.js', 'text/html', Buffer.from('<!doctype html>')), false);
assert.strictEqual(isCompatibleAssetResponse('https://x/app.css', 'text/css', Buffer.from('body{}')), true);
assert.strictEqual(isCompatibleAssetResponse('https://x/a.png', 'text/html', Buffer.from('<html>fallback')), false);
console.log('download routing checks passed');
