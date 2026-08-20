require('../src/playwright-env');
const { execSync } = require('child_process');
const { browsersPath } = require('../src/playwright-env');

console.log(`安装 Playwright Chromium 到: ${browsersPath}`);
execSync('npx playwright install chromium', {
  stdio: 'inherit',
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsersPath }
});
console.log('安装完成');
