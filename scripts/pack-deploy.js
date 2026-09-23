/**
 * 把 output/<siteId> 打成可独立部署的包：静态 www + Node 桥 + 精简 wgame_web。
 * 用法: node scripts/pack-deploy.js [siteId]
 */
const fs = require('fs');
const path = require('path');
const {
    toSiteId,
    outputDir,
    copyRecursive,
    emptyDir,
    ROOT
} = require('./site-paths');

const DEPLOY_ROOT = path.join(ROOT, 'deploy');

/** 运行时需要的源码（相对 ROOT） */
const RUNTIME_FILES = [
    'src/static-server.js',
    'src/preview-proxy.js',
    'src/url-query.js',
    'src/mock-cashier.js',
    'src/mock-agent-api.js',
    'src/game-launcher.js',
    'src/production-hooks.js',
    'src/system-proxy.js'
];

const RUNTIME_DIRS = [
    'src/adapter'
];

function ensureDir(p) {
    fs.mkdirSync(p, { recursive: true });
}

function copyFileRel(rel, destRoot) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
        console.warn('[pack-deploy] skip missing', rel);
        return;
    }
    const dest = path.join(destRoot, rel);
    ensureDir(path.dirname(dest));
    fs.copyFileSync(src, dest);
}

function copyDirRel(rel, destRoot) {
    const src = path.join(ROOT, rel);
    if (!fs.existsSync(src)) {
        console.warn('[pack-deploy] skip missing dir', rel);
        return;
    }
    copyRecursive(src, path.join(destRoot, rel));
}

function bundleWgameWeb(destRoot) {
    const { resolveWgameWebRoot } = require('../src/adapter/providers/wgame/wgame-web-config');
    const webRoot = resolveWgameWebRoot();
    if (!webRoot) {
        throw new Error('找不到 wgame_web，无法打进部署包（设置 WGAME_WEB_PATH 或放在 ../wgame_web）');
    }
    const dest = path.join(destRoot, 'wgame_web');
    emptyDir(dest);
    // 仅 config + proto，够 HTTP protobuf / 登录配置
    const cfgSrc = path.join(webRoot, 'src', 'config', 'config.js');
    if (!fs.existsSync(cfgSrc)) throw new Error('wgame_web 缺少 src/config/config.js');
    ensureDir(path.join(dest, 'src', 'config'));
    fs.copyFileSync(cfgSrc, path.join(dest, 'src', 'config', 'config.js'));
    const protoSrc = path.join(webRoot, 'src', 'proto');
    if (fs.existsSync(protoSrc)) {
        copyRecursive(protoSrc, path.join(dest, 'src', 'proto'));
    }
    fs.writeFileSync(
        path.join(dest, 'PACK_META.json'),
        JSON.stringify({
            bundledAt: new Date().toISOString(),
            from: webRoot,
            includes: ['src/config/config.js', 'src/proto']
        }, null, 2),
        'utf8'
    );
    return webRoot;
}

function writePackageJson(destRoot, siteId) {
    const pkg = {
        name: `sd-deploy-${siteId}`,
        version: '1.0.0',
        private: true,
        description: `Deployable lobby+adapter pack for ${siteId}`,
        main: 'server.js',
        scripts: {
            start: 'node server.js'
        },
        engines: { node: '>=14.0.0' },
        dependencies: {
            axios: '^0.27.2',
            'crypto-js': '4.2.0',
            'https-proxy-agent': '7',
            protobufjs: '7',
            ws: '8.18.0'
        }
    };
    fs.writeFileSync(path.join(destRoot, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
}

function writeServerJs(destRoot) {
    const body = `/**
 * 部署入口：静态 www + adapter 桥（对齐「预览已转换」）
 *   cd 本目录 && npm i && npm start
 * 环境变量: PORT=8080  HOST=0.0.0.0  PAY_HTTP_URL=...  AGENT_HTTP_BASE=...
 */
const path = require('path');
const fs = require('fs');

// 优先用包内精简 wgame_web
process.env.WGAME_WEB_PATH = process.env.WGAME_WEB_PATH
  || path.join(__dirname, 'wgame_web');

const { StaticServer } = require('./src/static-server');
const { applyProductionHooks } = require('./src/production-hooks');

const www = path.join(__dirname, 'www');
const hostsPath = path.join(www, 'adapter-hosts.json');
if (fs.existsSync(hostsPath)) {
  try {
    const hosts = JSON.parse(fs.readFileSync(hostsPath, 'utf8'));
    applyProductionHooks(hosts);
    fs.writeFileSync(hostsPath, JSON.stringify(hosts, null, 2), 'utf8');
  } catch (err) {
    console.warn('[deploy] applyProductionHooks failed:', err && err.message);
  }
}

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '0.0.0.0';

const server = new StaticServer({
  spaFallback: true,
  host: HOST,
  headerProxy: true
});

server.start(www, PORT, { enableAdapter: true }).then((info) => {
  console.log('Deploy pack running');
  console.log('  url:  ' + info.url);
  console.log('  www:  ' + www);
  console.log('  wgame_web: ' + process.env.WGAME_WEB_PATH);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
`;
    fs.writeFileSync(path.join(destRoot, 'server.js'), body, 'utf8');
}

function writeReadme(destRoot, siteId) {
    const text = `# ${siteId} 部署包（静态前端 + Node 兼容桥）

本目录可直接拷到服务器。**只需执行一次启动脚本**，缺 Node 会自动下载便携版，再安装依赖并启动。

## 启动（只输这一次）

**Windows**

\`\`\`bat
start.cmd
\`\`\`

**Linux / macOS**

\`\`\`bash
chmod +x start.sh && ./start.sh
\`\`\`

默认 \`http://0.0.0.0:8080\`。改端口：先设环境变量 \`PORT=3000\` 再执行上面脚本。

## 目录

- \`www/\` — 大厅前端 + \`adapter-hosts.json\`
- \`src/\` — 兼容层（adapter）
- \`wgame_web/\` — 精简配置与 protobuf
- \`._runtime/\` — 自动下载的便携 Node（若本机没有）
- \`server.js\` — 服务入口

## 生产收银台 / 代理 API

Windows:

\`\`\`bat
set PAY_HTTP_URL=https://your-pay/create
set AGENT_HTTP_BASE=https://your-agent
start.cmd
\`\`\`

Linux:

\`\`\`bash
export PAY_HTTP_URL=https://your-pay/create
export AGENT_HTTP_BASE=https://your-agent
./start.sh
\`\`\`

## 说明

- 后端 wgame 不改；本进程只做大厅 API ↔ wgame 翻译。
- 不要只挂 \`www/\` 到 nginx 而不跑本启动脚本。
`;
    fs.writeFileSync(path.join(destRoot, 'README.md'), text, 'utf8');
}

function writeStartScripts(destRoot) {
    // Windows：一条命令 — 检测/下载便携 Node → npm i → 启动
    const cmd = `@echo off
setlocal EnableExtensions
cd /d "%~dp0"
set "NODE_VER=v20.18.1"
set "NODE_DIR=%~dp0._runtime\\node"
set "PATH=%NODE_DIR%;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto INSTALL_NODE
node -v >nul 2>nul
if errorlevel 1 goto INSTALL_NODE
goto HAVE_NODE

:INSTALL_NODE
echo [start] Node not found, downloading portable %NODE_VER% ...
if not exist "%~dp0._runtime" mkdir "%~dp0._runtime"
set "ZIP=%~dp0._runtime\\node.zip"
set "URL=https://nodejs.org/dist/%NODE_VER%/node-%NODE_VER%-win-x64.zip"
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { Invoke-WebRequest -Uri '%URL%' -OutFile '%ZIP%' -UseBasicParsing } catch { exit 1 }"
if errorlevel 1 (
  echo [start] Download failed. Install Node 18+ LTS manually, then re-run start.cmd
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "Expand-Archive -Path '%ZIP%' -DestinationPath '%~dp0._runtime' -Force"
if errorlevel 1 (
  echo [start] Unzip failed
  exit /b 1
)
if exist "%NODE_DIR%" rmdir /s /q "%NODE_DIR%"
move "%~dp0._runtime\\node-%NODE_VER%-win-x64" "%NODE_DIR%" >nul
del "%ZIP%" >nul 2>nul
set "PATH=%NODE_DIR%;%PATH%"
where node >nul 2>nul
if errorlevel 1 (
  echo [start] Portable Node still not on PATH
  exit /b 1
)
echo [start] Portable Node ready:
node -v

:HAVE_NODE
if not exist "node_modules\\" goto DO_NPM
if not exist "node_modules\\ws\\" goto DO_NPM
goto RUN

:DO_NPM
echo [start] npm install ...
call npm install --omit=dev
if errorlevel 1 (
  echo [start] npm install failed
  exit /b 1
)

:RUN
echo [start] launching server ...
node server.js
exit /b %ERRORLEVEL%
`;
    fs.writeFileSync(path.join(destRoot, 'start.cmd'), cmd.replace(/\n/g, '\r\n'), 'utf8');

    // Linux/macOS：一条命令
    const sh = `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
NODE_VER="v20.18.1"
RUNTIME_DIR="$(pwd)/._runtime"
NODE_DIR="$RUNTIME_DIR/node"

have_node() {
  command -v node >/dev/null 2>&1 && node -v >/dev/null 2>&1
}

install_node() {
  echo "[start] Node not found, downloading portable $NODE_VER ..."
  mkdir -p "$RUNTIME_DIR"
  local os arch tarball url
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) arch="x64" ;;
    aarch64|arm64) arch="arm64" ;;
    *) echo "[start] unsupported arch: $arch"; exit 1 ;;
  esac
  case "$os" in
    linux) tarball="node-\${NODE_VER}-linux-\${arch}.tar.gz" ;;
    darwin) tarball="node-\${NODE_VER}-darwin-\${arch}.tar.gz" ;;
    *) echo "[start] unsupported OS: $os"; exit 1 ;;
  esac
  url="https://nodejs.org/dist/\${NODE_VER}/\${tarball}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$RUNTIME_DIR/node.tgz"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$RUNTIME_DIR/node.tgz" "$url"
  else
    echo "[start] need curl or wget to download Node"
    exit 1
  fi
  rm -rf "$NODE_DIR" "$RUNTIME_DIR/node-extract"
  mkdir -p "$RUNTIME_DIR/node-extract"
  tar -xzf "$RUNTIME_DIR/node.tgz" -C "$RUNTIME_DIR/node-extract"
  local extracted
  extracted="$(find "$RUNTIME_DIR/node-extract" -maxdepth 1 -type d -name 'node-v*' | head -1)"
  mv "$extracted" "$NODE_DIR"
  rm -f "$RUNTIME_DIR/node.tgz"
  rm -rf "$RUNTIME_DIR/node-extract"
  export PATH="$NODE_DIR/bin:$PATH"
  echo "[start] Portable Node ready: $(node -v)"
}

if ! have_node; then
  if [ -x "$NODE_DIR/bin/node" ]; then
    export PATH="$NODE_DIR/bin:$PATH"
  else
    install_node
  fi
fi

if [ ! -d node_modules ] || [ ! -d node_modules/ws ]; then
  echo "[start] npm install ..."
  npm install --omit=dev
fi

echo "[start] launching server ..."
exec node server.js
`;
    fs.writeFileSync(path.join(destRoot, 'start.sh'), sh, 'utf8');
    try {
        fs.chmodSync(path.join(destRoot, 'start.sh'), 0o755);
    } catch (_) { /* windows may ignore */ }
}

function packDeploy(siteId) {
    const id = toSiteId(siteId || '679win');
    const siteSrc = outputDir(id);
    if (!fs.existsSync(siteSrc)) {
        throw new Error(`找不到 output/${id}，请先 yarn export-migrated ${id}`);
    }
    if (!fs.existsSync(path.join(siteSrc, 'adapter-hosts.json'))) {
        throw new Error(`output/${id} 缺少 adapter-hosts.json，请先完成「替换接口」`);
    }

    const dest = path.join(DEPLOY_ROOT, id);
    emptyDir(dest);

    // 1) 静态站
    copyRecursive(siteSrc, path.join(dest, 'www'));

    // 2) 运行时源码
    for (const f of RUNTIME_FILES) copyFileRel(f, dest);
    for (const d of RUNTIME_DIRS) copyDirRel(d, dest);

    // 3) wgame_web 精简
    const webFrom = bundleWgameWeb(dest);

    // 4) 入口与说明
    writePackageJson(dest, id);
    writeServerJs(dest);
    writeReadme(dest, id);
    writeStartScripts(dest);

    return {
        siteId: id,
        deployDir: dest,
        www: path.join(dest, 'www'),
        wgameWebFrom: webFrom
    };
}

function main() {
    const id = process.argv[2] || '679win';
    try {
        const result = packDeploy(id);
        console.log(JSON.stringify({
            ok: true,
            siteId: result.siteId,
            deployDir: result.deployDir,
            hint: 'cd deploy/' + result.siteId + ' && npm i && npm start'
        }, null, 2));
    } catch (err) {
        console.error(err.message || err);
        process.exit(1);
    }
}

if (require.main === module) main();

module.exports = { packDeploy, DEPLOY_ROOT };
