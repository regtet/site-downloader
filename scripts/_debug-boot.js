const fs = require('fs');
const vm = require('vm');
const { buildBootScript } = require('../src/preview-proxy');

const raw = buildBootScript('https://679win.com', [
  'oniw976.679win.cc',
  'aniw976.679win.cc',
  'aniw976.679win.me',
  'aniw976.679win.co'
]);
fs.writeFileSync('scripts/_boot-raw.js', raw);

try {
  new vm.Script(raw);
  console.log('ok');
} catch (e) {
  console.log(e.message);
  // Node often gives position
  const m = String(e.stack || e.message);
  console.log(m);
}

// Use acorn or Function
try {
  Function(raw);
  console.log('Function ok');
} catch (e) {
  console.log('Function fail', e.message);
}

// Scan for common breakers
const patterns = [
  /`/,
  /\u2028|\u2029/,
  /<\/script/i,
  /\${/,
];
for (const p of patterns) {
  const i = raw.search(p);
  console.log(String(p), i, i >= 0 ? JSON.stringify(raw.slice(i, i + 40)) : '');
}

// Binary search syntax error
function check(s) {
  try {
    new vm.Script(s);
    return true;
  } catch (_) {
    return false;
  }
}
let lo = 0;
let hi = raw.length;
while (lo + 1 < hi) {
  const mid = (lo + hi) >> 1;
  // take prefix - may fail due to incomplete, so grow from known good
  // better: find first bad char by expanding
  break;
}

// line by line accumulate
const lines = raw.split('\n');
let acc = '';
for (let i = 0; i < lines.length; i++) {
  const next = acc + lines[i] + '\n';
  if (!check(next + '\n})();')) {
    // might be incomplete paren - try full wrap
  }
  acc = next;
  if (!check(acc)) {
    // keep going until we can't - actually incomplete scripts fail
  }
}

// Use node's parse with source map - try prettier approach:
// wrap and use espree if available; else character walk
for (let i = 100; i < raw.length; i += 100) {
  // skip
}

// Find by evaluating slices with closing braces - crude
const err = (() => {
  try {
    new vm.Script(raw);
    return null;
  } catch (e) {
    return e;
  }
})();

if (err) {
  // V8: "Unexpected token" without position on older node
  // Write file and run node --check
  const { spawnSync } = require('child_process');
  const r = spawnSync(process.execPath, ['--check', 'scripts/_boot-raw.js'], { encoding: 'utf8' });
  console.log('stderr', r.stderr);
  console.log('stdout', r.stdout);
}
