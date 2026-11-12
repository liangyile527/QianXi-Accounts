'use strict';
const fs = require('node:fs'), path = require('node:path');
// 每个实例都要注入同一份源码：读一次就缓存字符串，避免反复读盘。
let cached = null;
function source() {
  if (cached === null) cached = fs.readFileSync(path.join(__dirname, 'chrome-shim.js'), 'utf8');
  return cached;
}
module.exports = { source };
