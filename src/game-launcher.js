/**
 * dist 点击游戏会在新窗口打开 /pages/game/index.html?keyType=url&storageKey=...
 * 抓包常漏此页，本地预览需补一份启动器从 localStorage 读出 game_url 再跳转。
 */
const GAME_LAUNCHER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="X-UA-Compatible" content="IE=edge" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>game loading...</title>
  <style>
    html, body { margin: 0; height: 100%; background: #000; }
    .loading {
      color: #fff;
      font: 14px/1.5 sans-serif;
      text-align: center;
      padding: 48px 16px;
    }
    iframe {
      position: fixed;
      inset: 0;
      width: 100%;
      height: 100%;
      border: 0;
    }
  </style>
</head>
<body>
  <div class="loading" id="loading">Loading game...</div>
  <script>
(function () {
  var sp = new URLSearchParams(location.search);
  var keyType = sp.get('keyType') || 'url';
  var storageKey = sp.get('storageKey');
  var loading = document.getElementById('loading');
  function fail(msg) {
    if (loading) loading.textContent = msg;
    else document.body.textContent = msg;
  }
  if (!storageKey) {
    fail('Missing storageKey');
    return;
  }
  var payload = '';
  try { payload = localStorage.getItem(storageKey) || ''; } catch (e) {}
  if (!payload) {
    fail('Game data missing (storageKey=' + storageKey + ')');
    return;
  }
  try { localStorage.removeItem(storageKey); } catch (e) {}
  if (keyType === 'html') {
    document.open();
    document.write(payload);
    document.close();
    if (loading) loading.style.display = 'none';
    return;
  }
  var url = String(payload).trim();
  if (!url) {
    fail('Empty game URL');
    return;
  }
  if (!/^https?:\\/\\//i.test(url)) {
    try { url = new URL(url, location.origin).href; } catch (e) {
      fail('Invalid game URL');
      return;
    }
  }
  try {
    location.replace(url);
  } catch (e) {
    var iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.allow = 'fullscreen *; autoplay; payment';
    iframe.referrerPolicy = 'no-referrer-when-downgrade';
    document.body.appendChild(iframe);
    if (loading) loading.style.display = 'none';
  }
})();
  </script>
</body>
</html>`;

function isGameLauncherRequest(reqUrl) {
  if (!reqUrl) return false;
  const pathname = String(reqUrl.pathname || '');
  if (/^\/pages\/game\/index\.html$/i.test(pathname)) return true;
  const sp = reqUrl.searchParams;
  return sp.has('keyType') && sp.has('storageKey');
}

function serveGameLauncher(res) {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Pragma': 'no-cache',
    'X-SD-Game-Launcher': '1'
  });
  res.end(GAME_LAUNCHER_HTML);
}

function ensureGameLauncherOnDisk(siteDir, fs, path) {
  if (!siteDir || !fs || !path) return false;
  const target = path.join(siteDir, 'pages', 'game', 'index.html');
  try {
    if (fs.existsSync(target)) return true;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, GAME_LAUNCHER_HTML, 'utf8');
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = {
  GAME_LAUNCHER_HTML,
  isGameLauncherRequest,
  serveGameLauncher,
  ensureGameLauncherOnDisk
};
