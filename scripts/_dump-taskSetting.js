const fs = require('fs');
const j = JSON.parse(fs.readFileSync('output/679win/har-oss-snapshot.json', 'utf8'));
const body = JSON.parse(j.endpoints['GET /api/active/isShowV2/default.json'].body);
const ts = body.data.taskSetting;
console.log(JSON.stringify(ts, null, 2));
