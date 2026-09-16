const fs = require('fs');
const path = require('path');

function loadSnap(p) {
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

const snaps = [
  'output/679win/har-oss-snapshot.json',
  'logs/har-oss-snapshot-679win.json',
].filter(fs.existsSync);

for (const p of snaps) {
  const j = loadSnap(p);
  const keys = Object.keys(j.endpoints || {}).filter((k) =>
    /isShowV2|tasks\/task|taskSetting|tasks\//i.test(k)
  );
  console.log('\n====', p, 'matching keys', keys.length);
  for (const k of keys) {
    const body = String(j.endpoints[k].body || '');
    console.log(k, 'len', body.length, 'start', body.slice(0, 200));
    if (body.includes('taskSetting') || k.includes('isShowV2')) {
      try {
        const parsed = JSON.parse(body);
        const ts = parsed?.data?.taskSetting;
        console.log('  taskSetting type', Array.isArray(ts) ? 'array' : typeof ts, 'len', ts?.length);
        if (Array.isArray(ts)) console.log('  sample', JSON.stringify(ts.slice(0, 3)).slice(0, 400));
        console.log('  keys', Object.keys(parsed?.data || {}).slice(0, 30));
      } catch (e) {
        console.log('  parse err', e.message);
      }
    }
  }
}

// Also scan HAR if present
const harPath = 'C:/Users/Administrator/Downloads/679win.com.har';
if (fs.existsSync(harPath)) {
  console.log('\n==== scanning HAR for tasks ====');
  const har = JSON.parse(fs.readFileSync(harPath, 'utf8'));
  const entries = har.log?.entries || [];
  for (const e of entries) {
    const url = e.request?.url || '';
    if (!/tasks\/task|isShowV2|taskSetting/i.test(url)) continue;
    const u = url.split('?')[0];
    const short = u.replace(/^https?:\/\/[^/]+/, '');
    const text = e.response?.content?.text || '';
    console.log(e.request.method, short, 'status', e.response?.status, 'len', text.length, 'ct', e.response?.content?.mimeType);
    if (text && text[0] === '{') console.log('  preview', text.slice(0, 180));
  }
}
