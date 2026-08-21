const fs = require('fs');
const path = require('path');
const { StaticServer } = require('./src/static-server');

const PORT = process.env.PORT || 3456;

function resolveSiteDir(args) {
  if (args[0]) return path.resolve(args[0]);
  const distRoot = path.join(__dirname, 'dist');
  if (!fs.existsSync(distRoot)) return null;
  const dirs = fs.readdirSync(distRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(distRoot, d.name));
  if (!dirs.length) return null;
  dirs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0];
}

const siteDir = resolveSiteDir(process.argv.slice(2));
if (!siteDir) {
  console.error('用法: npm run serve -- dist/example.com');
  process.exit(1);
}

const server = new StaticServer({ spaFallback: true });
server.start(siteDir, PORT).then((info) => {
  console.log(`预览: ${info.url}`);
  console.log(`目录: ${siteDir}`);
}).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
