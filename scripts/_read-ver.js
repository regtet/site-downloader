const fs = require('fs');
const p = 'dist/713win.com/assets/theme-0/CreateLobbyVersionUpdate.impl.Bz2c9mhZ.js';
const text = fs.readFileSync(p, 'utf8');
console.log(text.slice(0, 1800));
