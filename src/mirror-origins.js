/**
 * 抓取时，跨域图片按原 path 镜像到本地（如 https://zhbrc.7kdaxiong.com/upload/a.png → upload/a.png）。
 * 预览里遇到没抓到的同目录资源（活动页才加载的图），回源主站会 404，应回它原本的主机。
 * 这里按 manifest.json 统计「目录前缀 → 来源主机」，本地缺文件时给出应回源的 origin。
 */

function dirKeys(relPath) {
  const segs = relPath.split('/').filter(Boolean);
  const keys = [];
  if (segs.length >= 3) keys.push(segs.slice(0, 2).join('/'));
  if (segs.length >= 2) keys.push(segs[0]);
  return keys;
}

function normalizeLocal(p) {
  return String(p || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

/**
 * @returns {(pathname: string) => string} 返回应回源的 origin，无则空串
 */
function createMirrorOriginResolver(root, sourceOrigin, fs, path) {
  const none = () => '';
  let sourceHost = '';
  try {
    sourceHost = new URL(sourceOrigin).host;
  } catch (_) {
    return none;
  }
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  } catch (_) {
    return none;
  }

  const sourceKeys = new Set();
  const counts = new Map();
  for (const r of (manifest && manifest.resources) || []) {
    if (!r || !r.local || !r.url) continue;
    let u;
    try {
      u = new URL(r.url);
    } catch (_) {
      continue;
    }
    let rel;
    try {
      rel = decodeURIComponent(u.pathname).replace(/^\/+/, '');
    } catch (_) {
      continue;
    }
    if (normalizeLocal(r.local) !== rel) continue;
    const keys = dirKeys(rel);
    if (u.host === sourceHost) {
      keys.forEach((k) => sourceKeys.add(k));
      continue;
    }
    for (const k of keys) {
      if (!counts.has(k)) counts.set(k, new Map());
      const m = counts.get(k);
      m.set(u.origin, (m.get(u.origin) || 0) + 1);
    }
  }

  const best = new Map();
  for (const [k, m] of counts) {
    if (sourceKeys.has(k)) continue;
    let top = '';
    let n = 0;
    for (const [origin, c] of m) {
      if (c > n) {
        top = origin;
        n = c;
      }
    }
    if (top) best.set(k, top);
  }
  if (!best.size) return none;

  return (pathname) => {
    let rel;
    try {
      rel = decodeURIComponent(String(pathname || '')).replace(/^\/+/, '');
    } catch (_) {
      return '';
    }
    for (const k of dirKeys(rel)) {
      if (best.has(k)) return best.get(k);
    }
    return '';
  };
}

module.exports = { createMirrorOriginResolver };
