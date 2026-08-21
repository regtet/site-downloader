require('./src/playwright-env');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const JobManager = require('./src/job-manager');
const PreviewServer = require('./src/preview-server');
const { checkBrowser, getBrowserInfo } = require('./src/browser-check');

const BASE_PORT = Number(process.env.PORT) || 3000;
const MAX_PORT_ATTEMPTS = 20;
let currentPort = BASE_PORT;
const OUTPUT_ROOT = path.join(__dirname, 'dist');
const PUBLIC_DIR = path.join(__dirname, 'public');

const previewServer = new PreviewServer({ spaFallback: true });
const DOWNLOAD_CONCURRENCY_DEFAULT = Number(process.env.DOWNLOAD_CONCURRENCY) || 20;

const jobManager = new JobManager({
  outputRoot: OUTPUT_ROOT,
  maxSiteConcurrency: Number(process.env.SITE_CONCURRENCY) || 2,
  downloadConcurrency: DOWNLOAD_CONCURRENCY_DEFAULT
});

function readBody(req) {
    return new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => { data += chunk; });
        req.on('end', () => {
            try {
                resolve(data ? JSON.parse(data) : {});
            } catch {
                reject(new Error('无效的 JSON'));
            }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, data) {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(data));
}

function sendFile(res, filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const types = {
        '.html': 'text/html; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.js': 'application/javascript; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon'
    };
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
        res.end(data);
    });
}

function listDownloads() {
    if (!fs.existsSync(OUTPUT_ROOT)) return [];
    return fs.readdirSync(OUTPUT_ROOT, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
            const dir = path.join(OUTPUT_ROOT, d.name);
            const stat = fs.statSync(dir);      
            const manifestPath = path.join(dir, 'manifest.json');
            const reportPath = path.join(dir, 'report.json');
            let manifest = null;
            let report = null;
            try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')); } catch { }
            try { report = JSON.parse(fs.readFileSync(reportPath, 'utf-8')); } catch { }
            const errorItems = (manifest && manifest.errors || []).filter((item) => item.category !== 'api-skipped' && item.category !== 'optional-missing');
            return {
                name: d.name,
                path: dir,
                modifiedAt: stat.mtime.toISOString(),
                source: manifest ? manifest.source : null,
                resources: manifest ? manifest.resources.length : 0,
                errors: errorItems.length,
                errorItems,
                unresolvedItems: manifest ? (manifest.unresolved || []) : [],
                brokenItems: manifest ? (manifest.brokenReferences || []) : [],
                missingItems: manifest ? (manifest.missing || []) : [],
                report
            };
        })
        .sort((a, b) => new Date(b.modifiedAt) - new Date(a.modifiedAt));
}

async function handleApi(req, res, pathname) {
  if (req.method === 'GET' && pathname === '/api/status') {
    const browser = await checkBrowser();
    sendJson(res, 200, { browser, ...getBrowserInfo(), queue: jobManager.getQueueInfo() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/jobs') {
    sendJson(res, 200, { jobs: jobManager.listJobs(), queue: jobManager.getQueueInfo() });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/downloads') {
    sendJson(res, 200, { downloads: listDownloads(), preview: previewServer.getInfo(), browser: getBrowserInfo() });
    return;
  }

  if (req.method === 'POST' && pathname === '/api/download') {
    const browser = await checkBrowser();
    if (!browser.ok) {
      sendJson(res, 503, { error: browser.error, needInstall: true });
      return;
    }
        const body = await readBody(req);
        const url = (body.url || '').trim();
        if (!url) {
            sendJson(res, 400, { error: '请输入 URL' });
            return;
        }
        try {
            new URL(url);
        } catch {
            sendJson(res, 400, { error: '无效的 URL' });
            return;
        }
        const job = jobManager.startJob(url, {
            retryFailedOnly: !!body.retryFailed,
            multiPage: !!body.multiPage,
            downloadSkinManifest: body.downloadSkinManifest === true,
            downloadConcurrency: body.downloadConcurrency ? Number(body.downloadConcurrency) : undefined
        });
        sendJson(res, 200, { jobId: job.id, url: job.url, queue: jobManager.getQueueInfo() });
        return;
    }

    const jobMatch = pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (req.method === 'GET' && jobMatch) {
        const job = jobManager.getJob(jobMatch[1]);
        if (!job) {
            sendJson(res, 404, { error: '任务不存在' });
            return;
        }
        sendJson(res, 200, {
            id: job.id,
            url: job.url,
            status: job.status,
            createdAt: job.createdAt,
            finishedAt: job.finishedAt,
            logs: job.logs,
            progress: job.progress,
            summary: job.summary,
            error: job.error
        });
        return;
    }

    const cancelMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/cancel$/);
    if (req.method === 'POST' && cancelMatch) {
        const result = jobManager.cancelJob(cancelMatch[1]);
        if (!result.ok) {
            sendJson(res, result.error === '任务不存在' ? 404 : 400, result);
            return;
        }
        sendJson(res, 200, { ...result, queue: jobManager.getQueueInfo() });
        return;
    }

    const sseMatch = pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (req.method === 'GET' && sseMatch) {
        const jobId = sseMatch[1];
        const job = jobManager.getJob(jobId);
        if (!job) {
            sendJson(res, 404, { error: '任务不存在' });
            return;
        }

        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
        });

        const send = (event) => {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };

        send({
            type: 'snapshot', data: {
                status: job.status,
                logs: job.logs,
                progress: job.progress,
                summary: job.summary,
                error: job.error
            }
        });

        const unsubscribe = jobManager.subscribe(jobId, send);
        const heartbeat = setInterval(() => {
            res.write(': heartbeat\n\n');
        }, 15000);

        if (job.status === 'completed' || job.status === 'failed') {
            setTimeout(() => {
                clearInterval(heartbeat);
                unsubscribe();
                res.end();
            }, 500);
        }

        req.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
        });
        return;
    }

    if (req.method === 'POST' && pathname === '/api/preview/start') {
        const body = await readBody(req);
        const siteDir = body.path ? path.resolve(body.path) : null;
        if (!siteDir || !siteDir.startsWith(OUTPUT_ROOT)) {
            sendJson(res, 400, { error: '无效的预览目录' });
            return;
        }
        try {
            const info = await previewServer.start(siteDir);
            sendJson(res, 200, { ...info, previews: previewServer.list() });
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
        return;
    }

    if (req.method === 'POST' && pathname === '/api/preview/stop') {
        const body = await readBody(req).catch(() => ({}));
        const siteDir = body.path ? path.resolve(body.path) : null;
        if (siteDir && !siteDir.startsWith(OUTPUT_ROOT)) {
            sendJson(res, 400, { error: '无效的预览目录' });
            return;
        }
        const result = siteDir
            ? await previewServer.stop(siteDir)
            : await previewServer.stopAll();
        sendJson(res, 200, result);
        return;
    }

    if (req.method === 'GET' && pathname === '/api/preview') {
        sendJson(res, 200, previewServer.getInfo());
        return;
    }

    sendJson(res, 404, { error: 'Not Found' });
}

const server = http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, `http://localhost:${currentPort}`);
    const pathname = reqUrl.pathname;

    if (pathname.startsWith('/api/')) {
        try {
            await handleApi(req, res, pathname);
        } catch (err) {
            sendJson(res, 500, { error: err.message });
        }
        return;
    }

    let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
    if (!filePath.startsWith(PUBLIC_DIR)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        sendFile(res, filePath);
        return;
    }

    sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
});

fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

function tryListen(port) {
  return new Promise((resolve, reject) => {
    function onError(err) {
      server.removeListener('listening', onListening);
      reject(err);
    }
    function onListening() {
      server.removeListener('error', onError);
      resolve(port);
    }
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function startServer() {
  for (let port = BASE_PORT; port <= BASE_PORT + MAX_PORT_ATTEMPTS; port++) {
    try {
      await tryListen(port);
      currentPort = port;
      console.log('');
      console.log('Site Downloader 已启动');
      console.log('');
      if (currentPort !== BASE_PORT) {
        console.log(`（端口 ${BASE_PORT} 已被占用，已自动切换到 ${currentPort}）`);
      }
      console.log(`界面地址: http://localhost:${currentPort}`);

      checkBrowser().then((browser) => {
        if (!browser.ok) {
          console.log('');
          console.log('⚠ Playwright Chromium 未安装');
          console.log('  请运行: npm run install-browsers');
          console.log(`  浏览器目录: ${browser.path}`);
          console.log('');
        }
      }).catch(() => {});
      return;
    } catch (err) {
      if (err.code === 'EADDRINUSE') {
        console.log(`端口 ${port} 已被占用，尝试 ${port + 1}...`);
        continue;
      }
      console.error('服务启动失败:', err.message);
      process.exit(1);
    }
  }
  console.error(`端口 ${BASE_PORT}–${BASE_PORT + MAX_PORT_ATTEMPTS} 均已被占用，请关闭占用进程后重试`);
  process.exit(1);
}

startServer();
