const $ = (sel) => document.querySelector(sel);

const urlInput = $('#urlInput');
const urlHistoryList = $('#urlHistoryList');
const urlHistoryChips = $('#urlHistoryChips');
const downloadForm = $('#downloadForm');
const downloadBtn = $('#downloadBtn');
const progressSection = $('#progressSection');
const progressPhase = $('#progressPhase');
const progressPercent = $('#progressPercent');
const progressFill = $('#progressFill');
const selectedTaskTitle = $('#selectedTaskTitle');
const resultSection = $('#resultSection');
const statResources = $('#statResources');
const statFailed = $('#statFailed');
const statMissing = $('#statMissing');
const statUnresolved = $('#statUnresolved');
const statBroken = $('#statBroken');
const previewBtn = $('#previewBtn');
const migrateBtn = $('#migrateBtn');
const migrateStatus = $('#migrateStatus');
const analyzePostLoginBtn = $('#analyzePostLoginBtn');
const analyzeBox = $('#analyzeBox');
const analyzeReport = $('#analyzeReport');
const analyzeSourceUrl = $('#analyzeSourceUrl');
const analyzeManualPane = $('#analyzeManualPane');
const analyzeHarPane = $('#analyzeHarPane');
const analyzeStaticPane = $('#analyzeStaticPane');
const harSourceInput = $('#harSourceInput');
const harLocalInput = $('#harLocalInput');
const capSourceStartBtn = $('#capSourceStartBtn');
const capSourceStopBtn = $('#capSourceStopBtn');
const capLocalStartBtn = $('#capLocalStartBtn');
const capLocalStopBtn = $('#capLocalStopBtn');
const capSourceStatus = $('#capSourceStatus');
const capLocalStatus = $('#capLocalStatus');
const stopPreviewBtn = $('#stopPreviewBtn');

/** @type {{ sourceId: string|null, localId: string|null, sourcePoll: any, localPoll: any }} */
const captureState = { sourceId: null, localId: null, sourcePoll: null, localPoll: null };
const cancelJobBtn = $('#cancelJobBtn');
const outputPath = $('#outputPath');
const errorList = $('#errorList');
const logContainer = $('#logContainer');
const clearLogBtn = $('#clearLogBtn');
const taskList = $('#taskList');
const refreshListBtn = $('#refreshListBtn');
const previewStatus = $('#previewStatus');
const browserWarning = $('#browserWarning');
const downloadConcurrencyInput = $('#downloadConcurrencyInput');
const multiPageInput = $('#multiPageInput');
const skinManifestInput = $('#skinManifestInput');
const compareSummary = $('#compareSummary');
const queueStatus = $('#queueStatus');

const HISTORY_KEY = 'sd-url-history';
const HISTORY_MAX = 20;

/** @type {Map<string, object>} */
const tasks = new Map();
/** @type {Array<{name:string,path:string,port:number,url:string}>} */
let activePreviews = [];
let selectedTaskId = null;
let queueInfo = { running: 0, queued: 0 };

const phaseLabels = {
  capture: '页面抓取',
  download: '资源下载',
  rewrite: '路径改写',
  compare: '源站对比',
  done: '完成'
};

const statusLabels = {
  pending: '排队中',
  running: '进行中',
  completed: '已完成',
  failed: '失败',
  cancelled: '已终止',
  archived: '已归档'
};

function jobLabel(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return String(url || '').replace(/^.*[\\/]/, '') || url;
  }
}

function projectKey(task) {
  if (!task) return '';
  const fromUrl = jobLabel(task.url || '');
  if (fromUrl && fromUrl.includes('.')) return fromUrl.toLowerCase();
  if (task.outputDir) {
    const base = String(task.outputDir).replace(/\\/g, '/').split('/').filter(Boolean).pop();
    if (base) return base.toLowerCase();
  }
  if (task.historyMeta?.name) return String(task.historyMeta.name).toLowerCase();
  return String(task.id || '').toLowerCase();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

function formatTime(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function formatLogTime(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

function getTask(id) {
  return tasks.get(id) || null;
}

function ensureTask(id, defaults = {}) {
  if (!tasks.has(id)) {
    tasks.set(id, {
      id,
      url: '',
      status: 'archived',
      logs: [],
      progress: null,
      summary: null,
      error: null,
      outputDir: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      isLive: false,
      eventSource: null,
      pollTimer: null,
      historyMeta: null,
      ...defaults
    });
  }
  return tasks.get(id);
}

function loadUrlHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.filter((u) => typeof u === 'string') : [];
  } catch {
    return [];
  }
}

function saveUrlHistory(list) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(list.slice(0, HISTORY_MAX)));
}

function pushUrlHistory(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) return;
  const next = [trimmed, ...loadUrlHistory().filter((u) => u !== trimmed)].slice(0, HISTORY_MAX);
  saveUrlHistory(next);
  renderUrlHistory();
}

function renderUrlHistory() {
  const list = loadUrlHistory();
  urlHistoryList.innerHTML = list.map((u) => `<option value="${escapeHtml(u)}"></option>`).join('');
  if (!list.length) {
    urlHistoryChips.innerHTML = '';
    return;
  }
  urlHistoryChips.innerHTML = `
    <div class="history-row">
      <span class="history-label">最近</span>
      <div class="history-chips">
        ${list.slice(0, 8).map((u) => `
          <button type="button" class="history-chip" data-url="${escapeHtml(u)}" title="${escapeHtml(u)}">${escapeHtml(jobLabel(u))}</button>
        `).join('')}
      </div>
      <button type="button" class="btn btn-ghost btn-sm" id="clearHistoryBtn">清空</button>
    </div>
  `;
  urlHistoryChips.querySelectorAll('.history-chip').forEach((el) => {
    el.addEventListener('click', () => {
      urlInput.value = el.dataset.url;
      urlInput.focus();
    });
  });
  const clearBtn = $('#clearHistoryBtn');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      saveUrlHistory([]);
      renderUrlHistory();
    });
  }
}

function countLiveTasks() {
  let running = 0;
  let queued = 0;
  for (const task of tasks.values()) {
    if (!task.isLive) continue;
    if (task.status === 'running') running++;
    else if (task.status === 'pending') queued++;
  }
  return { running, queued };
}

function updateQueueStatus(extra) {
  if (extra) queueInfo = extra;
  const live = countLiveTasks();
  const running = extra ? extra.running : Math.max(live.running, queueInfo.running || 0);
  const queued = extra ? extra.queued : Math.max(live.queued, queueInfo.queued || 0);
  if (running > 0 || queued > 0) {
    queueStatus.textContent = `进行中 ${running}${queued > 0 ? ` · 排队 ${queued}` : ''}`;
    queueStatus.classList.add('active');
  } else {
    queueStatus.textContent = '';
    queueStatus.classList.remove('active');
  }
}

function statusRank(task) {
  if (task.isLive && task.status === 'running') return 5;
  if (task.isLive && task.status === 'pending') return 4;
  if (task.status === 'completed') return 3;
  if (task.status === 'failed') return 2;
  return 1;
}

function mergeProjectTasks(a, b) {
  const prefer = statusRank(b) > statusRank(a) ? b : a;
  const other = prefer === a ? b : a;
  const newer = new Date(b.finishedAt || b.createdAt) > new Date(a.finishedAt || a.createdAt) ? b : a;
  return {
    ...prefer,
    url: prefer.url || other.url,
    outputDir: prefer.outputDir || other.outputDir || newer.outputDir,
    summary: prefer.summary || other.summary || newer.summary,
    historyMeta: prefer.historyMeta || other.historyMeta,
    logs: (prefer.logs && prefer.logs.length) ? prefer.logs : (other.logs || []),
    progress: prefer.progress || other.progress,
    error: prefer.error || other.error,
    finishedAt: newer.finishedAt || prefer.finishedAt || other.finishedAt,
    createdAt: prefer.createdAt < other.createdAt ? prefer.createdAt : other.createdAt,
    runCount: (a.runCount || 1) + (b.runCount || 1)
  };
}

/** 同站点只展示一条 */
function displayProjects() {
  const byKey = new Map();
  const sorted = [...tasks.values()].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  for (const task of sorted) {
    const key = projectKey(task);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...task, runCount: 1, projectKey: key });
      continue;
    }
    byKey.set(key, { ...mergeProjectTasks(existing, task), projectKey: key });
  }
  return [...byKey.values()].sort((a, b) => {
    const liveDiff = Number(b.isLive) - Number(a.isLive);
    if (liveDiff) return liveDiff;
    return new Date(b.finishedAt || b.createdAt) - new Date(a.finishedAt || a.createdAt);
  });
}

function taskProgressPercent(progress) {
  if (!progress) return 0;
  if (progress.phase === 'done') return 100;
  if (progress.total > 0 && progress.current !== undefined) {
    const ratio = progress.current / progress.total;
    if (progress.phase === 'capture') return Math.round(ratio * 10);
    if (progress.phase === 'download') {
      let base = 10;
      let span = 55;
      if (progress.subPhase === 'skin') {
        base = 70;
        span = 15;
      } else if (progress.subPhase === 'harvest') {
        base = 40;
        span = 25;
      } else if (progress.subPhase === 'fallback' || progress.subPhase === 'scan' || progress.subPhase === 'queue') {
        base = 82;
        span = 8;
      } else if (progress.subPhase === 'network') {
        base = 10;
        span = 30;
      }
      return base + Math.round(ratio * span);
    }
    if (progress.phase === 'rewrite') return 85 + Math.round(ratio * 8);
    if (progress.phase === 'compare') return 93 + Math.round(ratio * 5);
    return Math.round(ratio * 100);
  }
  if (progress.phase === 'capture') return 5;
  if (progress.phase === 'rewrite') return 88;
  if (progress.phase === 'compare') return 94;
  return 0;
}

function previewDirForTask(task) {
  if (!task) return '';
  return task.migratedPath
    || task.historyMeta?.migratedPath
    || task.outputDir
    || task.summary?.outputDir
    || '';
}

function previewForTask(task) {
  if (!task) return null;
  const dirs = [
    task.migratedPath,
    task.historyMeta?.migratedPath,
    task.outputDir,
    task.summary?.outputDir
  ].filter(Boolean).map((d) => String(d).replace(/\\/g, '/'));
  if (!dirs.length) return null;
  return activePreviews.find((p) => dirs.includes((p.path || '').replace(/\\/g, '/'))) || null;
}

function renderTaskList() {
  const items = displayProjects();
  if (items.length === 0) {
    taskList.innerHTML = '<p class="task-empty">暂无项目，输入 URL 开始</p>';
    return;
  }

  taskList.innerHTML = items.map((task) => {
    const host = jobLabel(task.url || task.outputDir || task.id);
    const status = task.status || 'archived';
    const pct = taskProgressPercent(task.progress);
    const showBar = status === 'running' || status === 'pending';
    const resources = task.summary?.resources ?? task.historyMeta?.resources ?? 0;
    const failed = task.summary?.failed ?? task.historyMeta?.errors ?? 0;
    const time = formatTime(task.finishedAt || task.createdAt);
    const preview = previewForTask(task);
    const runs = task.runCount > 1 ? `<span class="run-count">${task.runCount} 次</span>` : '';
    const migrated = !!(task.migratedPath || task.historyMeta?.migrated);

    return `
      <button type="button" class="task-item${task.id === selectedTaskId ? ' active' : ''}" data-task-id="${encodeURIComponent(task.id)}">
        <div class="task-item-head">
          <span class="task-status-badge status-${status}">${statusLabels[status] || status}</span>
          <span class="task-host">${escapeHtml(host)}</span>
          ${migrated ? '<span class="migrate-badge">已替换</span>' : ''}
          ${preview ? `<span class="preview-badge">:${preview.port}</span>` : ''}
        </div>
        <div class="task-url" title="${escapeHtml(task.url || '')}">${escapeHtml(task.url || task.outputDir || '未知')}</div>
        <div class="task-meta">
          <span>${escapeHtml(time)}</span>
          ${runs}
          ${resources ? `<span class="success-count">${resources} 资源</span>` : ''}
          ${failed ? `<span class="fail-count">${failed} 失败</span>` : ''}
        </div>
        ${showBar ? `
          <div class="task-progress-mini">
            <div class="task-progress-mini-fill" style="width:${pct}%"></div>
          </div>` : ''}
      </button>
    `;
  }).join('');

  taskList.querySelectorAll('.task-item').forEach((el) => {
    el.addEventListener('click', () => selectTask(decodeURIComponent(el.dataset.taskId)));
  });
}

function isLogNearBottom() {
  const el = logContainer;
  if (!el) return true;
  return el.scrollHeight - el.scrollTop - el.clientHeight < 56;
}

function logLineHtml(entry) {
  const isError = entry.isError;
  const prefix = entry.prefix ? `<span class="log-tag">[${escapeHtml(entry.prefix)}]</span>` : '';
  return `<div class="log-line${isError ? ' error' : ''}"><span class="log-time">${formatLogTime(entry.time)}</span>${prefix}${escapeHtml(entry.message)}</div>`;
}

function renderLogs(task) {
  if (!task || !task.logs.length) {
    logContainer.innerHTML = '<p class="log-empty">暂无日志</p>';
    logContainer.dataset.logCount = '0';
    return;
  }
  const pin = isLogNearBottom();
  logContainer.innerHTML = task.logs.map(logLineHtml).join('');
  logContainer.dataset.logCount = String(task.logs.length);
  if (pin) logContainer.scrollTop = logContainer.scrollHeight;
}

/** 增量追加一行，避免整表重绘导致选中/复制被打断 */
function appendLogLine(entry) {
  if (!entry) return;
  const empty = logContainer.querySelector('.log-empty');
  if (empty) {
    logContainer.innerHTML = '';
    logContainer.dataset.logCount = '0';
  }
  const pin = isLogNearBottom();
  logContainer.insertAdjacentHTML('beforeend', logLineHtml(entry));
  const count = Number(logContainer.dataset.logCount || 0) + 1;
  logContainer.dataset.logCount = String(count);
  if (pin) logContainer.scrollTop = logContainer.scrollHeight;
}

function appendTaskLog(taskId, message, isError = false, prefix = '') {
  const task = ensureTask(taskId);
  const entry = { time: new Date().toISOString(), message, isError, prefix };
  task.logs.push(entry);
  if (taskId === selectedTaskId) appendLogLine(entry);
}

function updateProgressUI(progress, task) {
  if (!progress) {
    progressSection.classList.add('hidden');
    return;
  }
  progressSection.classList.remove('hidden');
  progressPhase.textContent = progress.message || phaseLabels[progress.phase] || '处理中';
  const pct = taskProgressPercent(progress);
  progressPercent.textContent = progress.phase === 'done' ? '100%' : (pct ? `${pct}%` : '');
  progressFill.style.width = `${pct}%`;
  const live = task && (task.status === 'running' || task.status === 'pending');
  if (cancelJobBtn) {
    cancelJobBtn.classList.toggle('hidden', !live);
    cancelJobBtn.disabled = !live || task?.cancelling;
    cancelJobBtn.textContent = task?.cancelling ? '终止中…' : '终止';
  }
}

function renderErrors(errors, extra = {}) {
  const failed = Array.isArray(errors) ? errors.filter(Boolean) : [];
  const unresolved = Array.isArray(extra.unresolvedUrls) ? extra.unresolvedUrls : [];
  const broken = Array.isArray(extra.brokenReferenceItems) ? extra.brokenReferenceItems : [];

  if (failed.length === 0 && unresolved.length === 0 && broken.length === 0) {
    errorList.classList.add('hidden');
    errorList.innerHTML = '';
    return;
  }

  const parts = [];
  if (failed.length) {
    parts.push(`<div class="error-list-header">下载失败（${failed.length}）</div>`);
    parts.push(...failed.slice(0, 40).map((item) => {
      const status = item.status || 'error';
      const reason = item.reason || 'download failed';
      return `<div class="error-item"><span class="error-item-meta">[${status}] ${escapeHtml(reason)}</span> ${escapeHtml(item.url || '')}</div>`;
    }));
  }
  if (unresolved.length) {
    parts.push(`<div class="error-list-header">未解析模板（${unresolved.length}）</div>`);
    parts.push(...unresolved.slice(0, 20).map((item) => (
      `<div class="error-item"><span class="error-item-meta">[template]</span>${escapeHtml(item.url || item.ref || '')}</div>`
    )));
  }
  if (broken.length) {
    parts.push(`<div class="error-list-header">引用缺失（${broken.length}）</div>`);
    parts.push(...broken.slice(0, 30).map((item) => (
      `<div class="error-item"><span class="error-item-meta">[${escapeHtml(item.kind || 'ref')}]</span> ${escapeHtml(item.ref || '')}</div>`
    )));
  }

  errorList.classList.remove('hidden');
  errorList.innerHTML = parts.join('');
}

function showResultForTask(task) {
  if (!task) return;
  const summary = task.summary;
  const meta = task.historyMeta;

  if (!summary && !meta) {
    resultSection.classList.add('hidden');
    return;
  }

  resultSection.classList.remove('hidden');
  const nRes = summary?.resources ?? meta?.resources ?? 0;
  const nFail = summary?.failed ?? meta?.errors ?? 0;
  const nMiss = summary?.missing ?? meta?.report?.missing ?? 0;
  const nUnres = summary?.unresolved ?? (meta?.unresolvedItems || []).length;
  const nBroken = summary?.brokenReferences ?? (meta?.brokenItems || []).length;
  statResources.textContent = nRes;
  statFailed.textContent = nFail;
  statMissing.textContent = nMiss;
  statUnresolved.textContent = nUnres;
  statBroken.textContent = nBroken;
  statFailed.closest('.stat')?.classList.toggle('is-zero', !nFail);
  statBroken.closest('.stat')?.classList.toggle('is-zero', !nBroken);

  let pathText = summary?.outputDir ?? task.outputDir ?? '';
  if (task.migratedPath || task.historyMeta?.migratedPath) {
    pathText += `\n部署包: ${task.migratedPath || task.historyMeta.migratedPath}`;
  }
  if (summary?.manifestStats?.listed) {
    pathText += `\n皮肤清单: ${summary.manifestStats.success}/${summary.manifestStats.listed} 成功`;
  }
  if (summary?.compare) {
    const c = summary.compare;
    pathText += `\n对比: overlay 源站 ${c.overlayCount?.source ?? '?'} / 本地 ${c.overlayCount?.local ?? '?'}`;
  }
  outputPath.textContent = pathText;

  if (summary?.compare) {
    const c = summary.compare;
    const findings = (c.topFindings || []).slice(0, 4);
    const why = (c.whyTwoDialogs || []).slice(0, 2);
    compareSummary.classList.remove('hidden');
    compareSummary.innerHTML = `
      <strong>源站对比 ${c.consistent ? '✓ 基本一致' : '⚠ 存在差异'}</strong>
      ${findings.length ? `<ul>${findings.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>` : ''}
      ${why.length ? `<p class="compare-why">${why.map((f) => escapeHtml(f)).join(' ')}</p>` : ''}
    `;
  } else {
    compareSummary.classList.add('hidden');
    compareSummary.innerHTML = '';
  }

  const dir = summary?.outputDir || task.outputDir;
  const migratedPath = task.migratedPath || task.historyMeta?.migratedPath || '';
  if (migrateBtn) {
    migrateBtn.disabled = !dir || !!task.migrating;
    migrateBtn.textContent = task.migrating ? '替换中…' : (migratedPath ? '重新替换接口' : '替换接口');
  }
  if (analyzePostLoginBtn) {
    analyzePostLoginBtn.disabled = !dir || !!task.analyzing;
    analyzePostLoginBtn.textContent = task.analyzing ? '分析中…' : '登录后依赖分析';
  }
  if (analyzeBox) {
    analyzeBox.classList.toggle('hidden', !dir);
    if (dir && analyzeSourceUrl && !analyzeSourceUrl.value && task.url) {
      analyzeSourceUrl.value = task.url;
    }
  }
  if (analyzeReport) {
    if (task.analyzeHtml) {
      analyzeReport.classList.remove('hidden');
      analyzeReport.innerHTML = task.analyzeHtml;
    } else {
      analyzeReport.classList.add('hidden');
      analyzeReport.innerHTML = '';
    }
  }
  if (migrateStatus) {
    if (task.migrateError) {
      migrateStatus.className = 'migrate-status is-err';
      migrateStatus.textContent = task.migrateError;
      migrateStatus.classList.remove('hidden');
    } else if (migratedPath) {
      migrateStatus.className = 'migrate-status is-ok';
      migrateStatus.textContent = `接口已替换 → ${migratedPath}`;
      migrateStatus.classList.remove('hidden');
    } else {
      migrateStatus.className = 'migrate-status hidden';
      migrateStatus.textContent = '';
    }
  }

  previewBtn.disabled = !dir;
  const preview = previewForTask(task);
  stopPreviewBtn.classList.toggle('hidden', !preview);
  if (preview) {
    previewBtn.textContent = `打开预览 :${preview.port}`;
  } else {
    previewBtn.textContent = migratedPath ? '预览部署包' : '本地预览';
  }

  if (summary) renderErrors(summary.errors, summary);
  else if (meta) {
    renderErrors(meta.errorItems, {
      unresolvedUrls: meta.unresolvedItems,
      brokenReferenceItems: meta.brokenItems
    });
  }
}

function refreshTaskPanel() {
  const task = getTask(selectedTaskId);
  if (!task) {
    selectedTaskTitle.textContent = '';
    progressSection.classList.add('hidden');
    resultSection.classList.add('hidden');
    logContainer.innerHTML = '<p class="log-empty">从右侧选择一个项目</p>';
    return;
  }

  selectedTaskTitle.textContent = jobLabel(task.url || task.outputDir || task.id);
  renderLogs(task);

  if (task.status === 'running' || task.status === 'pending') {
    updateProgressUI(task.progress || { phase: 'capture', message: task.status === 'pending' ? '排队等待中...' : '准备中' }, task);
    if (task.status === 'pending') resultSection.classList.add('hidden');
  } else if (task.status === 'completed' || task.status === 'archived') {
    updateProgressUI(task.status === 'completed' ? { phase: 'done', message: '完成' } : null, task);
    if (cancelJobBtn) cancelJobBtn.classList.add('hidden');
    showResultForTask(task);
  } else if (task.status === 'failed' || task.status === 'cancelled') {
    updateProgressUI({ phase: 'done', message: task.error || (task.status === 'cancelled' ? '已终止' : '失败') }, task);
    if (cancelJobBtn) cancelJobBtn.classList.add('hidden');
    resultSection.classList.add('hidden');
  } else {
    progressSection.classList.add('hidden');
    if (cancelJobBtn) cancelJobBtn.classList.add('hidden');
    showResultForTask(task);
  }

  renderTaskList();
}

function selectTask(taskId) {
  if (!tasks.has(taskId)) return;
  selectedTaskId = taskId;
  const task = getTask(taskId);
  if (task?.url) urlInput.value = task.url;
  refreshTaskPanel();
}

function syncTaskFromJob(job) {
  const task = ensureTask(job.id, {
    url: job.url,
    createdAt: job.createdAt,
    isLive: job.status === 'pending' || job.status === 'running'
  });
  task.url = job.url;
  task.status = job.status;
  task.createdAt = job.createdAt;
  task.finishedAt = job.finishedAt;
  task.progress = job.progress;
  task.summary = job.summary;
  task.error = job.error;
  if (job.summary?.outputDir) task.outputDir = job.summary.outputDir;
  if (job.logs && job.logs.length) {
    task.logs = job.logs.map((l) => ({
      time: l.time,
      message: l.message,
      isError: false,
      prefix: jobLabel(job.url)
    }));
  }
  return task;
}

function stopPolling(taskId) {
  const task = getTask(taskId);
  if (task?.pollTimer) {
    clearTimeout(task.pollTimer);
    task.pollTimer = null;
  }
}

async function pollJobStatus(taskId) {
  const task = getTask(taskId);
  if (!task || !task.isLive) return;
  try {
    const res = await fetch(`/api/jobs/${taskId}`);
    if (!res.ok) {
      finishLiveTask(taskId);
      return;
    }
    const job = await res.json();
    syncTaskFromJob(job);
    renderTaskList();
    if (taskId === selectedTaskId) refreshTaskPanel();
    if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
      finishLiveTask(taskId);
      await loadTaskList();
    } else if (job.status === 'running' || job.status === 'pending') {
      task.pollTimer = setTimeout(() => pollJobStatus(taskId), 2000);
    }
  } catch {
    finishLiveTask(taskId);
  }
}

function finishLiveTask(taskId) {
  const task = getTask(taskId);
  if (!task) return;
  stopPolling(taskId);
  if (task.eventSource) {
    task.eventSource.close();
    task.eventSource = null;
  }
  task.isLive = false;
  updateQueueStatus();
  renderTaskList();
  if (taskId === selectedTaskId) refreshTaskPanel();
}

function attachJobEvents(taskId, url, options = {}) {
  const task = ensureTask(taskId, {
    url,
    status: 'pending',
    isLive: true,
    createdAt: new Date().toISOString()
  });
  task.url = url;
  task.isLive = true;
  if (options.select !== false) selectTask(taskId);
  updateQueueStatus();
  if (task.eventSource) return;

  const eventSource = new EventSource(`/api/jobs/${taskId}/events`);
  task.eventSource = eventSource;
  const prefix = jobLabel(url);

  eventSource.onmessage = (e) => {
    const event = JSON.parse(e.data);
    const t = getTask(taskId);
    if (!t) return;

    let needPanel = false;
    let needList = false;

    if (event.type === 'snapshot') {
      if (event.data.logs) {
        t.logs = event.data.logs.map((l) => ({ time: l.time, message: l.message, prefix }));
      }
      t.progress = event.data.progress;
      t.status = event.data.status || t.status;
      t.summary = event.data.summary || t.summary;
      t.error = event.data.error || t.error;
      if (event.data.summary?.outputDir) t.outputDir = event.data.summary.outputDir;
      needPanel = true;
      needList = true;
    }

    if (event.type === 'log') {
      const entry = { time: event.data.time, message: event.data.message, prefix };
      t.logs.push(entry);
      if (taskId === selectedTaskId) appendLogLine(entry);
    }

    if (event.type === 'progress') {
      t.progress = event.data;
      t.status = 'running';
      needList = true;
      if (taskId === selectedTaskId) {
        selectedTaskTitle.textContent = jobLabel(t.url || t.outputDir || t.id);
        updateProgressUI(t.progress, t);
      }
    }

    if (event.type === 'status') {
      t.status = event.data.status;
      needList = true;
      needPanel = true;
      if (event.data.status === 'cancelled') t.cancelling = false;
      if (event.data.status === 'cancelled' || event.data.status === 'failed' || event.data.status === 'completed') {
        finishLiveTask(taskId);
      }
    }

    if (event.type === 'complete') {
      t.status = 'completed';
      t.summary = event.data.summary;
      t.progress = { phase: 'done', message: '完成' };
      if (event.data.summary?.outputDir) t.outputDir = event.data.summary.outputDir;
      finishLiveTask(taskId);
      needPanel = true;
      needList = true;
      loadTaskList();
    }

    if (event.type === 'error') {
      t.status = 'failed';
      t.error = event.data.error;
      const errEntry = { time: new Date().toISOString(), message: event.data.error, isError: true, prefix };
      t.logs.push(errEntry);
      if (taskId === selectedTaskId) appendLogLine(errEntry);
      finishLiveTask(taskId);
      needPanel = true;
      needList = true;
    }

    if (event.type === 'cancelled') {
      t.status = 'cancelled';
      t.cancelling = false;
      t.error = '已终止';
      t.progress = { phase: 'done', message: '已终止' };
      finishLiveTask(taskId);
      needPanel = true;
      needList = true;
    }

    if (needList) renderTaskList();
    if (needPanel && taskId === selectedTaskId) refreshTaskPanel();
  };

  eventSource.onerror = () => {
    eventSource.close();
    const t = getTask(taskId);
    if (t) t.eventSource = null;
    pollJobStatus(taskId);
  };
}

function connectEvents(taskId, url) {
  attachJobEvents(taskId, url, { select: true });
}

async function startDownload(url, options = {}) {
  const concurrency = Number(downloadConcurrencyInput.value) || 20;
  pushUrlHistory(url);
  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        downloadConcurrency: concurrency,
        multiPage: !!options.multiPage || !!multiPageInput.checked,
        downloadSkinManifest: !!skinManifestInput.checked
      })
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.needInstall) browserWarning.classList.remove('hidden');
      const tempId = `err-${Date.now()}`;
      ensureTask(tempId, { url, status: 'failed' });
      appendTaskLog(tempId, data.error || '请求失败', true, jobLabel(url));
      selectTask(tempId);
      return;
    }
    if (data.queue) updateQueueStatus(data.queue);
    ensureTask(data.jobId, { url, status: 'pending', isLive: true, logs: [] });
    appendTaskLog(data.jobId, '任务已加入队列', false, jobLabel(url));
    connectEvents(data.jobId, url);
    renderTaskList();
  } catch (err) {
    appendTaskLog(selectedTaskId || 'temp', err.message, true, jobLabel(url));
  }
}

function updatePreviewStatus(info) {
  if (info && Array.isArray(info.previews)) {
    activePreviews = info.previews;
  } else if (info && info.url && info.path) {
    activePreviews = [{ name: info.name, path: info.path || info.siteDir, port: info.port, url: info.url }];
  } else if (info && info.running === false) {
    activePreviews = [];
  }

  if (!activePreviews.length) {
    previewStatus.className = 'preview-status';
    previewStatus.innerHTML = '';
    if (selectedTaskId) {
      const t = getTask(selectedTaskId);
      if (t) showResultForTask(t);
    }
    renderTaskList();
    return;
  }

  previewStatus.className = 'preview-status active';
  previewStatus.innerHTML = `
    <span class="preview-label">预览中</span>
    ${activePreviews.map((p) => `
      <span class="preview-pill">
        <a href="${escapeHtml(p.url)}" target="_blank">${escapeHtml(p.name)}:${p.port}</a>
        <button type="button" class="preview-close" data-path="${escapeHtml(p.path)}" title="关闭并释放端口">×</button>
      </span>
    `).join('')}
    <button type="button" class="btn btn-ghost btn-sm" id="stopAllPreviewBtn">全部关闭</button>
  `;

  previewStatus.querySelectorAll('.preview-close').forEach((btn) => {
    btn.addEventListener('click', () => stopPreview(btn.dataset.path));
  });
  const stopAll = $('#stopAllPreviewBtn');
  if (stopAll) stopAll.addEventListener('click', () => stopPreview(null));

  renderTaskList();
  if (selectedTaskId) {
    const t = getTask(selectedTaskId);
    if (t && (t.status === 'completed' || t.status === 'archived')) showResultForTask(t);
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
      if (selectedTaskId) appendTaskLog(selectedTaskId, data.error || '预览启动失败', true);
      previewBtn.disabled = false;
      return;
    }
    updatePreviewStatus({ previews: data.previews || [data], running: true });
    window.open(data.url, '_blank');
    previewBtn.disabled = false;
  } catch (err) {
    if (selectedTaskId) appendTaskLog(selectedTaskId, err.message, true);
    previewBtn.disabled = false;
  }
}

async function stopPreview(dir) {
  try {
    const res = await fetch('/api/preview/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(dir ? { path: dir } : {})
    });
    const data = await res.json();
    updatePreviewStatus({ previews: data.previews || [], running: (data.previews || []).length > 0 });
  } catch (err) {
    if (selectedTaskId) appendTaskLog(selectedTaskId, err.message, true);
  }
}

async function checkBrowserStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    browserWarning.classList.toggle('hidden', data.browser && data.browser.ok);
    if (!data.browser || !data.browser.ok) downloadBtn.disabled = true;
    if (data.queue) updateQueueStatus(data.queue);
  } catch {}
}

async function loadTaskList() {
  try {
    const [jobsRes, downloadsRes, previewRes] = await Promise.all([
      fetch('/api/jobs'),
      fetch('/api/downloads'),
      fetch('/api/preview')
    ]);
    const jobsData = jobsRes.ok ? await jobsRes.json() : { jobs: [], queue: null };
    const downloadsData = downloadsRes.ok ? await downloadsRes.json() : { downloads: [] };
    const previewData = previewRes.ok ? await previewRes.json() : { previews: [] };

    if (jobsData.queue) updateQueueStatus(jobsData.queue);
    updatePreviewStatus(previewData.previews ? previewData : { previews: previewData.running ? [previewData] : [] });

    const claimedHosts = new Set();

    for (const job of jobsData.jobs || []) {
      const task = syncTaskFromJob(job);
      task.isLive = job.status === 'pending' || job.status === 'running';
      claimedHosts.add(projectKey(task));
      if (task.isLive) attachJobEvents(job.id, job.url, { select: false });
    }

    for (const item of downloadsData.downloads || []) {
      const host = (item.name || '').toLowerCase();
      if (claimedHosts.has(host)) {
        // 把磁盘信息合并进已有同站任务
        for (const task of tasks.values()) {
          if (projectKey(task) === host) {
            task.outputDir = task.outputDir || item.path;
            task.historyMeta = item;
            if (item.migratedPath) task.migratedPath = item.migratedPath;
            if (!task.summary && item.report) {
              task.summary = {
                resources: item.resources,
                failed: item.errors,
                outputDir: item.path,
                errors: item.errorItems,
                unresolvedUrls: item.unresolvedItems,
                brokenReferenceItems: item.brokenItems
              };
            }
          }
        }
        continue;
      }
      const id = `disk:${item.path}`;
      ensureTask(id, {
        url: item.source || `https://${item.name}/`,
        status: 'archived',
        outputDir: item.path,
        migratedPath: item.migratedPath || null,
        createdAt: item.modifiedAt,
        finishedAt: item.modifiedAt,
        historyMeta: item
      });
      claimedHosts.add(host);
    }

    // 清理：同站多个已完成 job 仍留在 map 中没关系，displayProjects 会合并

    if (!selectedTaskId && displayProjects().length > 0) {
      selectedTaskId = displayProjects()[0].id;
    }

    renderTaskList();
    if (selectedTaskId) refreshTaskPanel();
  } catch {
    taskList.innerHTML = '<p class="task-empty">加载失败</p>';
  }
}

downloadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (url) startDownload(url);
});

previewBtn.addEventListener('click', async () => {
  const task = getTask(selectedTaskId);
  const dir = previewDirForTask(task);
  if (!dir) return;
  const existing = previewForTask(task);
  if (existing) {
    window.open(existing.url, '_blank');
    return;
  }
  await startPreview(dir);
});

stopPreviewBtn.addEventListener('click', () => {
  const task = getTask(selectedTaskId);
  const dir = previewDirForTask(task) || task?.outputDir || task?.summary?.outputDir;
  if (dir) stopPreview(dir);
});

async function runMigrate() {
  const task = getTask(selectedTaskId);
  const distDir = task?.outputDir || task?.summary?.outputDir;
  if (!task || !distDir) return;
  task.migrating = true;
  task.migrateError = '';
  refreshTaskPanel();
  appendTaskLog(task.id, '开始替换接口…', false);
  try {
    const res = await fetch('/api/migrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: distDir })
    });
    const data = await res.json().catch(() => ({}));
    task.migrating = false;
    if (!res.ok) {
      task.migrateError = data.error || '替换失败';
      appendTaskLog(task.id, task.migrateError, true);
      refreshTaskPanel();
      return;
    }
    task.migratedPath = data.outputDir;
    task.historyMeta = {
      ...(task.historyMeta || {}),
      migrated: true,
      migratedPath: data.outputDir,
      siteId: data.siteId,
      migratedAt: new Date().toISOString()
    };
    appendTaskLog(task.id, `接口已替换 → ${data.outputDir}`, false);
    refreshTaskPanel();
    renderTaskList();
  } catch (err) {
    task.migrating = false;
    task.migrateError = err.message || '替换失败';
    appendTaskLog(task.id, task.migrateError, true);
    refreshTaskPanel();
  }
}

if (migrateBtn) {
  migrateBtn.addEventListener('click', () => {
    runMigrate();
  });
}

function renderAnalyzeHtml(job) {
  if (!job) return '';
  if (job.status === 'failed') {
    let html = `<h3>分析失败</h3><p>${escapeHtml(job.error || '')}</p>`;
    if (job.quality) {
      html += `<p>源站: api=${job.quality.source?.apiCount ?? '?'} login=${job.quality.source?.hasLoginApi ? 'Y' : 'N'} · 本地: api=${job.quality.local?.apiCount ?? '?'} login=${job.quality.local?.hasLoginApi ? 'Y' : 'N'}</p>`;
    }
    return html;
  }
  const lines = [];
  lines.push(`<h3>登录后依赖分析 <small>(${escapeHtml(job.mode || '')})</small></h3>`);
  if (job.warning) lines.push(`<p>${escapeHtml(job.warning)}</p>`);
  if (job.outPath) lines.push(`<p>报告: <code>${escapeHtml(job.outPath)}</code></p>`);
  if (job.quality) {
    const qs = job.quality.source || {};
    const ql = job.quality.local || {};
    lines.push(`<p>质量: 源站 api=${qs.apiCount || 0} login=${qs.hasLoginApi ? 'Y' : 'N'} post=${qs.hasPostLogin ? 'Y' : 'N'} · 本地 api=${ql.apiCount || 0} login=${ql.hasLoginApi ? 'Y' : 'N'} post=${ql.hasPostLogin ? 'Y' : 'N'}</p>`);
  }
  if (job.summary) {
    lines.push(`<p>接口 ${job.summary.totalCompared || 0} · 状态分布 ${escapeHtml(JSON.stringify(job.summary.byStatus || {}))}</p>`);
  }

  const gaps = job.knownGapsWithoutLiveCapture || [];
  if (gaps.length) {
    lines.push('<div class="ar-section"><strong>已知缺口（未改 Adapter）</strong><ul>');
    for (const g of gaps) {
      lines.push(`<li><strong>${escapeHtml(g.symptom)}</strong><br/><code>${escapeHtml(g.api)}</code><br/>${escapeHtml(g.status)} — ${escapeHtml(g.reason)}</li>`);
    }
    lines.push('</ul></div>');
  }

  const order = job.nextFixOrder || [];
  if (order.length) {
    lines.push('<div class="ar-section"><strong>建议修复顺序</strong><ul>');
    for (const step of order.slice(0, 8)) {
      const sample = (step.apis || []).slice(0, 3).map((a) => a.path).join(', ');
      lines.push(`<li>${escapeHtml(step.label)} (${step.count})<br/><code>${escapeHtml(sample)}</code></li>`);
    }
    lines.push('</ul></div>');
  }

  const anomalies = job.pageAnomalies || {};
  const pageLabels = { home: '首页', profile: '个人中心', wallet: '钱包', recharge: '充值', withdraw: '提现', activity: '活动', vip: 'VIP' };
  lines.push('<div class="ar-section"><strong>哪个接口 → 哪个页面异常</strong>');
  for (const page of Object.keys(pageLabels)) {
    const list = anomalies[page] || [];
    if (!list.length) continue;
    lines.push(`<p><em>${pageLabels[page]}</em></p><ul>`);
    const seen = new Set();
    for (const row of list.slice(0, 8)) {
      const k = `${row.api}|${row.causes}`;
      if (seen.has(k)) continue;
      seen.add(k);
      lines.push(`<li>${escapeHtml(row.causes)} ← <code>${escapeHtml(row.api)}</code> (${escapeHtml(row.status)})</li>`);
    }
    lines.push('</ul>');
  }
  lines.push('</div>');
  return lines.join('');
}

async function pollAnalyzeJob(taskId, jobId) {
  const task = getTask(taskId);
  if (!task) return;
  for (let i = 0; i < 180; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    try {
      const res = await fetch(`/api/analyze/post-login/${encodeURIComponent(jobId)}`);
      const job = await res.json();
      if (!res.ok) {
        task.analyzing = false;
        task.analyzeHtml = `<h3>分析失败</h3><p>${escapeHtml(job.error || '任务不存在')}</p>`;
        refreshTaskPanel();
        return;
      }
      if (job.status === 'running') continue;
      task.analyzing = false;
      task.analyzeJob = job;
      task.analyzeHtml = renderAnalyzeHtml(job);
      appendTaskLog(task.id, job.status === 'completed' ? `依赖分析完成 → ${job.outPath || ''}` : `依赖分析失败: ${job.error || ''}`, job.status !== 'completed');
      refreshTaskPanel();
      return;
    } catch (err) {
      task.analyzing = false;
      task.analyzeHtml = `<h3>分析失败</h3><p>${escapeHtml(err.message || '')}</p>`;
      refreshTaskPanel();
      return;
    }
  }
  task.analyzing = false;
  task.analyzeHtml = '<h3>分析超时</h3><p>请稍后在 output/&lt;site&gt;/post-login-deps.json 查看</p>';
  refreshTaskPanel();
}

function getAnalyzeMode() {
  const el = document.querySelector('input[name="analyzeMode"]:checked');
  return el ? el.value : 'manual';
}

function syncAnalyzePanes() {
  const mode = getAnalyzeMode();
  if (analyzeManualPane) analyzeManualPane.classList.toggle('hidden', mode !== 'manual');
  if (analyzeHarPane) analyzeHarPane.classList.toggle('hidden', mode !== 'har');
  if (analyzeStaticPane) analyzeStaticPane.classList.toggle('hidden', mode !== 'static');
}

document.querySelectorAll('input[name="analyzeMode"]').forEach((el) => {
  el.addEventListener('change', syncAnalyzePanes);
});

function setCapStatus(el, info) {
  if (!el) return;
  if (!info) {
    el.textContent = '未开始';
    el.className = 'cap-status';
    return;
  }
  el.textContent = `${info.status} · api ${info.apiCount || 0}`
    + (info.hasLoginApi ? ' · 已见登录' : '')
    + (info.hasPostLogin ? ' · 已见登录后业务' : '')
    + (info.hint ? ` · ${info.hint}` : '');
  el.className = 'cap-status'
    + (info.hasPostLogin ? ' is-ok' : (info.hasLoginApi ? ' is-warn' : ''));
}

function clearCapPoll(side) {
  const key = side === 'local' ? 'localPoll' : 'sourcePoll';
  if (captureState[key]) {
    clearInterval(captureState[key]);
    captureState[key] = null;
  }
}

function pollCap(side, id) {
  clearCapPoll(side);
  const tick = async () => {
    try {
      const res = await fetch(`/api/analyze/capture/${encodeURIComponent(id)}`);
      const info = await res.json();
      if (!res.ok) return;
      setCapStatus(side === 'local' ? capLocalStatus : capSourceStatus, info);
      if (info.status === 'stopped' || info.status === 'failed') clearCapPoll(side);
    } catch (_) { /* ignore */ }
  };
  tick();
  captureState[side === 'local' ? 'localPoll' : 'sourcePoll'] = setInterval(tick, 2000);
}

async function startCap(side) {
  const task = getTask(selectedTaskId);
  if (!task) return;
  const body = { side };
  if (side === 'source') {
    body.url = analyzeSourceUrl?.value?.trim() || task.url || '';
    if (!body.url) {
      appendTaskLog(task.id, '请填写源站 URL', true);
      return;
    }
  } else {
    body.path = task.migratedPath || task.historyMeta?.migratedPath || task.outputDir || task.summary?.outputDir;
    if (!body.path) {
      appendTaskLog(task.id, '没有可预览的本地目录（请先替换接口或使用 dist）', true);
      return;
    }
  }
  appendTaskLog(task.id, `启动${side === 'source' ? '源站' : '本地'}手动抓包…`, false);
  try {
    const res = await fetch('/api/analyze/capture/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (!res.ok) {
      appendTaskLog(task.id, data.error || '启动抓包失败', true);
      return;
    }
    if (side === 'source') {
      captureState.sourceId = data.id;
      if (capSourceStopBtn) capSourceStopBtn.disabled = false;
      if (capSourceStartBtn) capSourceStartBtn.disabled = true;
    } else {
      captureState.localId = data.id;
      if (capLocalStopBtn) capLocalStopBtn.disabled = false;
      if (capLocalStartBtn) capLocalStartBtn.disabled = true;
    }
    setCapStatus(side === 'local' ? capLocalStatus : capSourceStatus, data);
    pollCap(side, data.id);
    appendTaskLog(task.id, `${side} 抓包中 ${data.id}，请在弹出窗口手动登录并操作`, false);
  } catch (err) {
    appendTaskLog(task.id, err.message || '启动抓包失败', true);
  }
}

async function stopCap(side) {
  const task = getTask(selectedTaskId);
  const id = side === 'local' ? captureState.localId : captureState.sourceId;
  if (!id) return;
  clearCapPoll(side);
  try {
    const res = await fetch(`/api/analyze/capture/${encodeURIComponent(id)}/stop`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      appendTaskLog(task?.id || selectedTaskId, data.error || '完成抓包失败', true);
      return;
    }
    setCapStatus(side === 'local' ? capLocalStatus : capSourceStatus, {
      status: 'stopped',
      apiCount: data.apiCount,
      hasLoginApi: data.hasLoginApi,
      hasPostLogin: data.hasPostLogin,
      hint: data.hasPostLogin ? '可生成对比' : (data.hasLoginApi ? '建议再抓一次并点充值/个人中心' : '未见登录接口，报告可能被拒绝')
    });
    if (side === 'source' && capSourceStartBtn) capSourceStartBtn.disabled = false;
    if (side === 'local' && capLocalStartBtn) capLocalStartBtn.disabled = false;
    if (side === 'source' && capSourceStopBtn) capSourceStopBtn.disabled = true;
    if (side === 'local' && capLocalStopBtn) capLocalStopBtn.disabled = true;
    appendTaskLog(task?.id || selectedTaskId, `${side} 抓包完成 · api ${data.apiCount}`, false);
  } catch (err) {
    appendTaskLog(task?.id || selectedTaskId, err.message || '完成抓包失败', true);
  }
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

async function runPostLoginAnalyze() {
  const task = getTask(selectedTaskId);
  const distDir = task?.outputDir || task?.summary?.outputDir;
  if (!task || !distDir) return;
  const mode = getAnalyzeMode();

  task.analyzing = true;
  task.analyzeHtml = '<p>分析进行中…</p>';
  refreshTaskPanel();
  appendTaskLog(task.id, `开始登录后依赖分析（${mode}）…`, false);

  try {
    const payload = {
      mode,
      path: distDir,
      migratedPath: task.migratedPath || task.historyMeta?.migratedPath || null
    };

    if (mode === 'manual') {
      if (!captureState.sourceId || !captureState.localId) {
        throw new Error('请先完成①源站 与 ②本地 手动抓包');
      }
      // 若仍在录制，先自动 stop
      for (const side of ['source', 'local']) {
        const id = side === 'local' ? captureState.localId : captureState.sourceId;
        const st = await fetch(`/api/analyze/capture/${encodeURIComponent(id)}`).then((r) => r.json()).catch(() => null);
        if (st && st.status === 'recording') {
          await stopCap(side);
        }
      }
      payload.sourceCaptureId = captureState.sourceId;
      payload.localCaptureId = captureState.localId;
    } else if (mode === 'har') {
      const sf = harSourceInput?.files?.[0];
      const lf = harLocalInput?.files?.[0];
      if (!sf || !lf) throw new Error('请选择源站 HAR 与本地 HAR');
      payload.sourceHar = JSON.parse(await readFileAsText(sf));
      payload.localHar = JSON.parse(await readFileAsText(lf));
    }

    const res = await fetch('/api/analyze/post-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      task.analyzing = false;
      task.analyzeHtml = `<h3>分析失败</h3><p>${escapeHtml(data.error || '请求失败')}</p>`;
      appendTaskLog(task.id, data.error || '分析失败', true);
      refreshTaskPanel();
      return;
    }
    appendTaskLog(task.id, `分析任务 ${data.jobId} (${data.mode})`, false);
    pollAnalyzeJob(task.id, data.jobId);
  } catch (err) {
    task.analyzing = false;
    task.analyzeHtml = `<h3>分析失败</h3><p>${escapeHtml(err.message || '')}</p>`;
    appendTaskLog(task.id, err.message || '分析失败', true);
    refreshTaskPanel();
  }
}

if (capSourceStartBtn) capSourceStartBtn.addEventListener('click', () => startCap('source'));
if (capSourceStopBtn) capSourceStopBtn.addEventListener('click', () => stopCap('source'));
if (capLocalStartBtn) capLocalStartBtn.addEventListener('click', () => startCap('local'));
if (capLocalStopBtn) capLocalStopBtn.addEventListener('click', () => stopCap('local'));

if (analyzePostLoginBtn) {
  analyzePostLoginBtn.addEventListener('click', () => runPostLoginAnalyze());
}

syncAnalyzePanes();

cancelJobBtn.addEventListener('click', async () => {
  const task = getTask(selectedTaskId);
  if (!task || !task.isLive) return;
  if (task.status !== 'running' && task.status !== 'pending') return;
  task.cancelling = true;
  if (selectedTaskId === task.id) refreshTaskPanel();
  try {
    const res = await fetch(`/api/jobs/${encodeURIComponent(task.id)}/cancel`, { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      task.cancelling = false;
      appendTaskLog(task.id, data.error || '终止失败', true);
      refreshTaskPanel();
      return;
    }
    if (data.queue) updateQueueStatus(data.queue);
    if (data.status === 'cancelled') {
      task.status = 'cancelled';
      task.cancelling = false;
      task.error = '已终止';
      finishLiveTask(task.id);
      refreshTaskPanel();
      renderTaskList();
    }
  } catch (err) {
    task.cancelling = false;
    appendTaskLog(task.id, err.message || '终止失败', true);
    refreshTaskPanel();
  }
});

clearLogBtn.addEventListener('click', () => {
  const task = getTask(selectedTaskId);
  if (!task) return;
  task.logs = [];
  renderLogs(task);
});

refreshListBtn.addEventListener('click', loadTaskList);

renderUrlHistory();
loadTaskList();
checkBrowserStatus();

setInterval(async () => {
  const live = countLiveTasks();
  if (live.running === 0 && live.queued === 0) return;
  try {
    const res = await fetch('/api/jobs');
    if (!res.ok) return;
    const data = await res.json();
    if (data.queue) updateQueueStatus(data.queue);
    for (const job of data.jobs || []) {
      if (job.status !== 'pending' && job.status !== 'running') continue;
      syncTaskFromJob(job);
      const task = getTask(job.id);
      if (task) {
        task.isLive = true;
        if (!task.eventSource) attachJobEvents(job.id, job.url, { select: false });
      }
    }
    renderTaskList();
    if (selectedTaskId) refreshTaskPanel();
  } catch {}
}, 4000);
