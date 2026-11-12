'use strict';
// Electron 每次把扩展载入 session 都会 emit 一条 ExtensionLoadWarning；同一个扩展被反复加载时，
// 这些内容完全相同的警告会淹掉运行日志。这里按「种类 + 内容」去重，只保留第一次出现，
// 记录上限 500 条，避免长时间运行后集合无限增长。
const DEDUPED = new Set(['ExtensionLoadWarning']);
function warningType(warning, type) {
  const value = type !== undefined ? type : warning;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object') {
    if (typeof value.type === 'string') return value.type;
    if (typeof value.name === 'string') return value.name;
  }
  return '';
}
function warningText(warning) {
  if (typeof warning === 'string') return warning;
  const message = warning?.message;
  return typeof message === 'string' ? message : String(warning ?? '');
}
function installWarningDedup(target = process, { limit = 500 } = {}) {
  const existing = target?.qianxiWarningDedup;
  if (existing) return existing;
  const original = target.emitWarning;
  if (typeof original !== 'function') return null;
  const seen = new Set();
  let suppressed = 0;
  function emitWarning(warning, type, ...rest) {
    const kind = warningType(warning, type);
    if (DEDUPED.has(kind)) {
      const key = kind + '\u0000' + warningText(warning);
      if (seen.has(key)) { suppressed += 1; return; }
      if (seen.size < limit) seen.add(key);
    }
    return original.call(this, warning, type, ...rest);
  }
  const api = {
    suppressed: () => suppressed,
    restore() {
      if (target.emitWarning === emitWarning) target.emitWarning = original;
      seen.clear();
      suppressed = 0;
    },
  };
  target.emitWarning = emitWarning;
  try { Object.defineProperty(target, 'qianxiWarningDedup', { value: api, configurable: true, enumerable: false }); }
  catch { target.qianxiWarningDedup = api; }
  return api;
}
module.exports = { installWarningDedup, warningType };
