'use strict';
// 实例网页的页内查找栏（Ctrl+F）。查找栏渲染在地址栏下方、浏览页面之上；
// 主进程负责真正的 findInPage 与计数回报，这里只维护显示状态、输入与按钮事件。
let pageFindState = null;
let pageFindTimer = null;
let pageFindEnterAt = 0;
let pageFindShowAt = 0;
let pageFindCloseTimer = null;
let pageFindShakeTimer = null;
let pageFindLastLabel = '';
let pageFindComposing = false;
// 入场类名按「打开时刻」算，不靠定时器改 DOM：状态推送重建 #content 时，
// 只要还在入场窗口内就带上剩余进度（负 animation-delay），动画接上而不是重播。
const pageFindEntering = () => pageFindEnterAt > 0 && Date.now() - pageFindEnterAt < 158;
const pageFindEnterDelay = () => pageFindEntering() ? ` style="animation-delay:-${Math.max(0, Math.round(Date.now() - pageFindEnterAt))}ms"` : '';
const pageFindReduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

function pageFindActive() {
  return !!pageFindState && pageFindState.id === activeId;
}

function pageFindLabel() {
  if (!pageFindState) return '';
  if (pageFindState.pending) return '查找中…';
  if (pageFindState.searched && !pageFindState.matches) return '无结果';
  if (pageFindState.matches) return `${pageFindState.active}/${pageFindState.matches}`;
  return '';
}

function pageFindHTML() {
  if (!pageFindActive()) return '';
  return `<div class="page-find${pageFindEntering() ? ' is-entering' : ''}"${pageFindEnterDelay()} id="pageFind" role="search">${icon('search')}<input id="pageFindInput" type="text" maxlength="200" autocomplete="off" spellcheck="false" aria-label="在页面中查找" placeholder="在页面中查找" value="${esc(pageFindState.query || '')}"><span class="page-find-count" id="pageFindCount">${esc(pageFindLabel())}</span><button type="button" class="icon-btn" data-page-find="prev" aria-label="上一个匹配" title="上一个匹配（Shift+Enter）">${icon('up')}</button><button type="button" class="icon-btn" data-page-find="next" aria-label="下一个匹配" title="下一个匹配（Enter）"><span class="page-find-down">${icon('chevron')}</span></button><button type="button" class="icon-btn" data-page-find="close" aria-label="关闭查找" title="关闭（Esc）">${icon('close')}</button></div>`;
}

// 计数只在真正变化时做一次脉冲；「无结果」额外让输入框抖一下，避免每次回显都闪。
function pageFindPulse(label) {
  const bar = $('#pageFind'), count = $('#pageFindCount'), input = $('#pageFindInput');
  if (!bar || !count) return;
  const empty = label === '无结果';
  bar.classList.toggle('is-empty', empty);
  if (empty) {
    if (!input || pageFindReduced()) return;
    input.classList.remove('is-shaking');
    void input.offsetWidth;
    input.classList.add('is-shaking');
    clearTimeout(pageFindShakeTimer);
    pageFindShakeTimer = setTimeout(() => input.classList.remove('is-shaking'), 260);
    return;
  }
  count.classList.remove('is-tick');
  if (!/^\d+\/\d+$/.test(label) || pageFindReduced()) return;
  void count.offsetWidth;
  count.classList.add('is-tick');
}

function pageFindSync() {
  const node = $('#pageFindCount');
  if (!node) return;
  const label = pageFindLabel();
  const changed = label !== pageFindLastLabel;
  pageFindLastLabel = label;
  node.textContent = label;
  if (changed) pageFindPulse(label);
}

function pageFindFocus(select) {
  const input = $('#pageFindInput');
  if (!input) return;
  input.focus();
  if (select) input.select();
}

function pageFindShow(id, query) {
  pageFindState = { id, query: query || '', matches: 0, active: 0, pending: false, searched: false };
  pageFindLastLabel = '';
  pageFindComposing = false;
  clearTimeout(pageFindCloseTimer);
  pageFindEnterAt = Date.now();
  pageFindShowAt = pageFindEnterAt;
  render(true);
  pageFindFocus(true);
}

async function pageFindOpen() {
  const x = current();
  if (!x || x.status !== 'running') {
    toast('当前实例未运行，启动后才能查找网页内容');
    return;
  }
  if (view !== 'browser') await route('browser');
  try { await request('page-find-open', { id: activeId }); }
  catch (error) { toast(error.message); }
}

async function pageFindSearch(next = false, forward = true) {
  if (!pageFindActive()) return;
  try { await request('page-find', { id: pageFindState.id, query: pageFindState.query, next, forward }); }
  catch (error) { toast(error.message); }
}

async function pageFindClose({ focusPage = true } = {}) {
  if (!pageFindState) return;
  const id = pageFindState.id;
  pageFindState = null;
  pageFindComposing = false;
  pageFindEnterAt = 0;
  clearTimeout(pageFindTimer);
  // 先让查找栏原路收回（100ms），再真正重建；焦点与页面高亮立刻交还给网页，不等动画。
  const bar = $('#pageFind');
  const redraw = () => { if (typeof render === 'function') render(true); };
  if (bar && !pageFindReduced()) {
    bar.classList.remove('is-entering');
    bar.classList.add('is-closing');
    clearTimeout(pageFindCloseTimer);
    pageFindCloseTimer = setTimeout(redraw, 110);
  } else redraw();
  try { await request('page-find-close', { id, focusPage }); } catch {}
}

if (window.qianxi?.onPageFind) window.qianxi.onPageFind(event => {
  if (!event) return;
  if (event.type === 'open') { pageFindShow(event.id, event.query); return; }
  if (event.type !== 'result') return;
  if (event.open === false) {
    // 请求式关闭的回报可能乱序到达（关掉又立刻打开）：带 at 且早于本次打开的一律丢掉。
    // 视图销毁（detach）是主进程主动清场，任何时候都必须照做。
    if (event.reason !== 'detach' && event.at && event.at < pageFindShowAt) return;
    if (pageFindState?.id === event.id) { pageFindState = null; pageFindComposing = false; pageFindEnterAt = 0; render(true); }
    return;
  }
  if (!pageFindState || pageFindState.id !== event.id) return;
  // 输入框已经改成新关键字时，旧关键字的结果到达就丢掉。
  const input = $('#pageFindInput');
  if (input && event.query !== input.value) return;
  pageFindState.matches = event.matches || 0;
  pageFindState.active = event.active || 0;
  pageFindState.pending = !!event.pending;
  pageFindState.searched = !!event.searched;
  pageFindSync();
});

// 输入框内容变了：旧结果立即作废（含 pending），等防抖后重新发请求。
// 不重置 pending 的话，清空/改词后会先挂着一句「查找中…」直到下一次回报。
function pageFindSetQuery(value) {
  pageFindState.query = value;
  pageFindState.searched = false;
  pageFindState.pending = false;
  pageFindState.matches = 0;
  pageFindState.active = 0;
  pageFindSync();
}

document.addEventListener('input', event => {
  if (!pageFindState || event.target.id !== 'pageFindInput') return;
  // 中文/日文输入法：拼音串本身不是查找词。组合期间不发请求，等上屏后再搜一次。
  if (pageFindComposing || event.isComposing) return;
  pageFindSetQuery(event.target.value);
  clearTimeout(pageFindTimer);
  pageFindTimer = setTimeout(() => pageFindSearch(false, true), 120);
});

document.addEventListener('compositionstart', event => {
  if (event.target.id === 'pageFindInput') pageFindComposing = true;
});

document.addEventListener('compositionend', event => {
  if (event.target.id !== 'pageFindInput') return;
  pageFindComposing = false;
  if (!pageFindState) return;
  pageFindSetQuery(event.target.value);
  clearTimeout(pageFindTimer);
  pageFindTimer = setTimeout(() => pageFindSearch(false, true), 60);
});

document.addEventListener('keydown', event => {
  if (event.target.id === 'pageFindInput') {
    if (event.key === 'Enter') {
      // 输入法用 Enter 上屏：这一下不能当成「下一个匹配」。
      if (pageFindComposing || event.isComposing) return;
      event.preventDefault();
      pageFindSearch(true, !event.shiftKey);
    } else if (event.key === 'Escape') { event.preventDefault(); pageFindClose(); }
    return;
  }
  if ((event.ctrlKey || event.metaKey) && !event.altKey && String(event.key).toLowerCase() === 'f') {
    event.preventDefault();
    pageFindOpen();
  }
});

document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-page-find]');
  if (!button) return;
  const action = button.dataset.pageFind;
  if (action === 'close') pageFindClose();
  else if (action === 'next') pageFindSearch(true, true);
  else if (action === 'prev') pageFindSearch(true, false);
});
