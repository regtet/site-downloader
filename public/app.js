const $ = (sel) => document.querySelector(sel);

const urlInput = $('#urlInput');
const downloadForm = $('#downloadForm');
const downloadBtn = $('#downloadBtn');
const progressSection = $('#progressSection');
const progressPhase = $('#progressPhase');
const progressPercent = $('#progressPercent');
const progressFill = $('#progressFill');
const resultSection = $('#resultSection');
const statResources = $('#statResources');
const statFailed = $('#statFailed');
const statMissing = $('#statMissing');
const previewBtn = $('#previewBtn');
const retryFailedBtn = $('#retryFailedBtn');
const outputPath = $('#outputPath');
const errorList = $('#errorList');
const logContainer = $('#logContainer');
const clearLogBtn = $('#clearLogBtn');
const historyList = $('#historyList');
const refreshListBtn = $('#refreshListBtn');
const previewStatus = $('#previewStatus');
const browserWarning = $('#browserWarning');

let currentJobId = null;
let eventSource = null;
let pollTimer = null;
let currentOutputDir = null;
let currentSourceUrl = null;

const phaseLabels = {
  capture: '页面抓取',
  download: '资源下载',
  rewrite: '路径改写',
  done: '完成'
};

function setDownloading(active) {
  downloadBtn.disabled = active;
  urlInput.disabled = active;
  retryFailedBtn.disabled = active || retryFailedBtn.classList.contains('hidden');
  downloadBtn.querySelector('.btn-text').classList.toggle('hidden', active);
  downloadBtn.querySelector('.btn-loading').classList.toggle('hidden', !active);
}

function clearLogs() {
  logContainer.innerHTML = '<p class="log-empty">等待下载...</p>';
}

function appendLog(message, isError) {
  const empty = logContainer.querySelector('.log-empty');
  if (empty) empty.remove();

  const line = document.createElement('div');
  line.className = 'log-line' + (isError ? ' error' : '');
  const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
  line.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
  logContainer.appendChild(line);
  logContainer.scrollTop = logContainer.scrollHeight;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function updateProgress(progress) {
  if (!progress) return;
  progressSection.classList.remove('hidden');
  progressPhase.textContent = progress.message || phaseLabels[progress.phase] || '处理中';

  if (progress.phase === 'done') {
    progressPercent.textContent = '100%';
    progressFill.style.width = '100%';
    if (progress.summary) showResult(progress.summary);
    return;
  }

  if (progress.total > 0 && progress.current !== undefined) {
    const ratio = progress.current / progress.total;
    let pct;
    if (progress.phase === 'capture') {
      pct = Math.round(ratio * 10);
    } else if (progress.phase === 'download') {
      const base = progress.subPhase === 'queue' ? 70 : 10;
      const span = progress.subPhase === 'queue' ? 15 : 60;
      pct = base + Math.round(ratio * span);
    } else if (progress.phase === 'rewrite') {
      pct = 85 + Math.round(ratio * 10);
    } else {
      pct = Math.round(ratio * 100);
    }
    progressPercent.textContent = `${pct}%`;
    progressFill.style.width = `${pct}%`;
  } else if (progress.phase === 'capture') {
    progressPercent.textContent = '';
    progressFill.style.width = '5%';
  } else if (progress.phase === 'rewrite') {
    progressPercent.textContent = '';
    progressFill.style.width = '90%';
  }
}

function renderErrors(errors) {
  const items = Array.isArray(errors) ? errors.filter(Boolean) : [];
  if (items.length === 0) {
    errorList.classList.add('hidden');
    errorList.innerHTML = '';
    retryFailedBtn.classList.add('hidden');
    retryFailedBtn.disabled = true;
    return;
  }

  retryFailedBtn.classList.remove('hidden');
  retryFailedBtn.disabled = !currentSourceUrl;
  errorList.classList.remove('hidden');
  errorList.innerHTML = `<div class="error-list-header">失败详情（${items.length}）</div>` +
    items.map((item) => {
      const status = item.status || 'error';
      const reason = item.reason || 'download failed';
      const type = item.resourceType ? ` · ${item.resourceType}` : '';
      return `<div class="error-item"><span class="error-item-meta">[${status}] ${escapeHtml(reason)}${escapeHtml(type)}</span>${escapeHtml(item.url || '')}</div>`;
    }).join('');
}

function showResult(summary) {
  if (!summary) return;
  resultSection.classList.remove('hidden');
  statResources.textContent = summary.resources || 0;
  statFailed.textContent = summary.failed || 0;
  statMissing.textContent = summary.missing || 0;
  outputPath.textContent = summary.outputDir || '';
  currentOutputDir = summary.outputDir;
  if (summary.source) currentSourceUrl = summary.source;
  previewBtn.disabled = !currentOutputDir;
  renderErrors(summary.errors);
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function pollJobStatus(jobId) {
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) {
      setDownloading(false);
      stopPolling();
      loadHistory();
      return;
    }
    const job = await res.json();
    if (job.logs && job.logs.length > logContainer.querySelectorAll('.log-line').length) {
      clearLogs();
      job.logs.forEach(l => appendLog(l.message));
    }
    updateProgress(job.progress);
    if (job.summary) showResult(job.summary);
    if (job.status === 'completed') {
      setDownloading(false);
      stopPolling();
      loadHistory();
    } else if (job.status === 'failed') {
      setDownloading(false);
      stopPolling();
      if (job.error) appendLog(job.error, true);
    } else if (job.status === 'running') {
      pollTimer = setTimeout(() => pollJobStatus(jobId), 2000);
    }
  } catch {
    setDownloading(false);
    stopPolling();
  }
}

function connectEvents(jobId) {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  stopPolling();

  eventSource = new EventSource(`/api/jobs/${jobId}/events`);

  eventSource.onmessage = (e) => {
    const event = JSON.parse(e.data);

    if (event.type === 'snapshot') {
      if (event.data.logs) {
        clearLogs();
        event.data.logs.forEach(l => appendLog(l.message));
      }
      updateProgress(event.data.progress);
      if (event.data.summary) showResult(event.data.summary);
      if (event.data.error) appendLog(event.data.error, true);
    }

    if (event.type === 'log') {
      appendLog(event.data.message);
    }

    if (event.type === 'progress') {
      updateProgress(event.data);
    }

    if (event.type === 'complete') {
      updateProgress({ phase: 'done', message: '下载完成', summary: event.data.summary });
      setDownloading(false);
      stopPolling();
      loadHistory();
      eventSource.close();
      eventSource = null;
    }

    if (event.type === 'error') {
      appendLog(event.data.error, true);
      setDownloading(false);
      stopPolling();
      eventSource.close();
      eventSource = null;
    }

    if (event.type === 'status' && (event.data.status === 'completed' || event.data.status === 'failed')) {
      setDownloading(false);
      stopPolling();
    }
  };

  eventSource.onerror = () => {
    eventSource.close();
    eventSource = null;
    if (currentJobId) pollJobStatus(currentJobId);
  };
}

async function startDownload(url, options = {}) {
  setDownloading(true);
  progressSection.classList.remove('hidden');
  if (!options.retryFailed) {
    resultSection.classList.add('hidden');
    renderErrors([]);
  }
  progressFill.style.width = '0%';
  progressPercent.textContent = '';
  clearLogs();
  currentSourceUrl = url;

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, retryFailed: !!options.retryFailed })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.needInstall) {
        browserWarning.classList.remove('hidden');
      }
      appendLog(data.error || '请求失败', true);
      setDownloading(false);
      return;
    }
    currentJobId = data.jobId;
    connectEvents(data.jobId);
  } catch (err) {
    appendLog(err.message, true);
    setDownloading(false);
  }
}

async function startPreview(dir) {
  try {
    previewBtn.disabled = true;
    const res = await fetch('/api/preview/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: dir })
    });
    const data = await res.json();
    if (!res.ok) {
      appendLog(data.error || '预览启动失败', true);
      previewBtn.disabled = false;
      return;
    }
    updatePreviewStatus(data);
    window.open(data.url, '_blank');
    previewBtn.disabled = false;
  } catch (err) {
    appendLog(err.message, true);
    previewBtn.disabled = false;
  }
}

function updatePreviewStatus(info) {
  if (!info || !info.url) {
    previewStatus.className = 'preview-status';
    previewStatus.textContent = '';
    return;
  }
  previewStatus.className = 'preview-status active';
  previewStatus.innerHTML = `预览服务运行中: <a href="${info.url}" target="_blank">${info.url}</a>`;
}

async function checkBrowserStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    browserWarning.classList.toggle('hidden', data.browser && data.browser.ok);
    if (!data.browser || !data.browser.ok) {
      downloadBtn.disabled = true;
    }
  } catch {}
}

async function loadHistory() {
  try {
    const res = await fetch('/api/downloads');
    const data = await res.json();
    updatePreviewStatus(data.preview);

    if (!data.downloads || data.downloads.length === 0) {
      historyList.innerHTML = '<p class="history-empty">暂无下载记录</p>';
      return;
    }

    historyList.innerHTML = '';
    for (const item of data.downloads) {
      const el = document.createElement('div');
      el.className = 'history-item';
      el.dataset.path = item.path;

      const date = new Date(item.modifiedAt).toLocaleString('zh-CN');
      const errors = item.errors || 0;

      el.innerHTML = `
        <div class="history-url">${escapeHtml(item.source || item.name)}</div>
        <div class="history-meta">
          <span>${date}</span>
          <span class="success-count">${item.resources} 资源</span>
          ${errors > 0 ? `<span class="fail-count">${errors} 失败</span>` : ''}
        </div>
      `;

      el.addEventListener('click', () => {
        document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
        el.classList.add('active');
        currentOutputDir = item.path;
        currentSourceUrl = item.source || item.name;
        if (!urlInput.value.trim() && item.source) urlInput.value = item.source;
        outputPath.textContent = item.path;
        resultSection.classList.remove('hidden');
        statResources.textContent = item.resources;
        statFailed.textContent = errors;
        statMissing.textContent = item.report ? (item.report.missing || 0) : 0;
        previewBtn.disabled = false;
        renderErrors(item.errorItems);
      });

      historyList.appendChild(el);
    }
  } catch {
    historyList.innerHTML = '<p class="history-empty">加载失败</p>';
  }
}

downloadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (url) startDownload(url);
});

previewBtn.addEventListener('click', () => {
  if (currentOutputDir) startPreview(currentOutputDir);
});

retryFailedBtn.addEventListener('click', () => {
  const url = (urlInput.value || currentSourceUrl || '').trim();
  if (!url) {
    appendLog('无法重试：缺少网站 URL', true);
    return;
  }
  startDownload(url, { retryFailed: true });
});

clearLogBtn.addEventListener('click', clearLogs);
refreshListBtn.addEventListener('click', loadHistory);

loadHistory();
checkBrowserStatus();
