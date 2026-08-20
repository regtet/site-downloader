const path = require('path');
const os = require('os');

const browsersPath = process.env.SITE_DOWNLOADER_BROWSERS_PATH
  || path.join(os.homedir(), '.cache', 'site-downloader-playwright');

process.env.PLAYWRIGHT_BROWSERS_PATH = browsersPath;

module.exports = { browsersPath };
