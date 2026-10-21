'use strict';
/* 自动点击技术自证：三种注入方式（Electron sendInputEvent / CDP Input.dispatchMouseEvent / JS click）
   在同一个按钮上跑一遍，并用「遮挡 / 缩放 / 滚动」三种真实坑验证坐标口径。
   跑法：node scripts/launch-electron.cjs tests/auto-click.cjs */
const {app, BrowserWindow} = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'qianxi-auto-click-')));
app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');
app.commandLine.appendSwitch('disable-background-networking');
if (process.platform === 'linux') app.commandLine.appendSwitch('disable-gpu');

const pause = (ms = 160) => new Promise(r => setTimeout(r, ms));
const pass = name => console.log('PASS ' + name);
const rows = Array.from({length: 40}, (_, i) => `<button class="row" data-i="${i}">行 ${i}</button>`).join('');

const HTML = `<!doctype html><meta charset="utf-8"><title>click fixture</title>
<style>
 body{margin:0;font:14px sans-serif}
 #target{position:absolute;left:120px;top:80px;width:160px;height:44px}
 #cover{position:absolute;left:120px;top:80px;width:160px;height:44px;background:#0006;display:none}
 #list{position:absolute;left:20px;top:300px;width:220px;height:180px;overflow:auto}
 #list button{display:block;width:190px;height:24px;margin:2px 0}
</style>
<button id="target">目标</button><div id="cover"></div>
<div id="list">${rows}</div>
<script>
window.log = [];
window.lastRow = null;
const t = document.getElementById('target'), cover = document.getElementById('cover');
for (const type of ['pointerdown','mousedown','pointerup','mouseup','click']) {
  t.addEventListener(type, e => log.push({on:'target',type,trusted:e.isTrusted,x:e.clientX,y:e.clientY,
    detail:e.detail||0,pointer:e.pointerType||'',buttons:e.buttons,active:t.matches(':active')}));
}
cover.addEventListener('click', e => log.push({on:'cover',type:'click',trusted:e.isTrusted,x:e.clientX,y:e.clientY}));
document.getElementById('list').addEventListener('click', e => {
  const b = e.target.closest('.row'); if (b) window.lastRow = b.dataset.i;
});
</script>`;
const url = 'data:text/html;charset=utf-8,' + encodeURIComponent(HTML);

let win;

function centerJS(selector) {
  return `(() => {
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) throw Error('Missing ' + ${JSON.stringify(selector)});
    e.scrollIntoView({block: 'center', inline: 'nearest'});
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
      dpr: devicePixelRatio, hit: hit ? (hit.id || hit.className || hit.tagName) : null};
  })()`;
}

async function main() {
  await app.whenReady();
  win = new BrowserWindow({
    width: 900, height: 640, show: true,
    webPreferences: {nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false}
  });
  const wc = win.webContents;
  await win.loadURL(url);
  await pause(300);
  const ui = code => wc.executeJavaScript(code);
  const clear = () => ui('window.log = []; window.lastRow = null; true');
  const cdp = (method, params) => wc.debugger.sendCommand(method, params);

  // ── 0. CDP 必须先 attach（生产里 controller.cjs 在每个实例创建时已 attach）
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  const metrics = await cdp('Page.getLayoutMetrics', {});
  assert.ok(metrics.cssLayoutViewport.clientWidth >= 600, 'CSS 视口应可用');
  pass('CDP attach + Page.getLayoutMetrics（cssLayoutViewport = 坐标基座）');

  // ── 1. Electron sendInputEvent：坐标是 CSS 像素 / DIP
  const p1 = await ui(centerJS('#target'));
  await clear();
  wc.sendInputEvent({type: 'mouseDown', x: p1.x, y: p1.y, button: 'left', clickCount: 1});
  wc.sendInputEvent({type: 'mouseUp', x: p1.x, y: p1.y, button: 'left', clickCount: 1});
  await pause();
  let log = await ui('window.log');
  const bClick = log.find(e => e.on === 'target' && e.type === 'click');
  assert.ok(bClick, 'sendInputEvent 应产生 click');
  assert.equal(bClick.trusted, true, 'sendInputEvent 是可信事件（isTrusted=true）');
  assert.ok(Math.abs(bClick.x - p1.x) <= 1 && Math.abs(bClick.y - p1.y) <= 1, '坐标口径 = CSS 像素');
  assert.equal(log.find(e => e.type === 'pointerdown').pointer, 'mouse', 'Chromium 会合成 pointer 事件');
  assert.equal(log.find(e => e.type === 'mousedown').buttons, 1, '按下时 buttons=1');
  assert.equal(log.find(e => e.type === 'mouseup').buttons, 0, '抬起时 buttons=0');
  pass('sendInputEvent mouseDown/mouseUp → isTrusted=true, clientX/Y=CSS 像素, pointer 事件随之合成');

  // ── 2. CDP Input.dispatchMouseEvent：同样 CSS 像素，但多一层 mouseMoved 才有 hover/:active 链
  await clear();
  await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p1.x, y: p1.y, button: 'none', buttons: 0});
  await cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p1.x, y: p1.y, button: 'left', buttons: 1, clickCount: 1});
  await cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p1.x, y: p1.y, button: 'left', buttons: 0, clickCount: 1});
  await pause();
  log = await ui('window.log');
  const aClick = log.find(e => e.on === 'target' && e.type === 'click');
  assert.ok(aClick, 'CDP 应产生 click');
  assert.equal(aClick.trusted, true, 'CDP 也是可信事件');
  assert.equal(aClick.detail, 1, 'clickCount=1 会写进 detail');
  assert.ok(log.some(e => e.type === 'mousedown' && e.active === true), '按下期间 :active 生效（能驱动按下态样式/拖拽）');
  pass('CDP Input.dispatchMouseEvent(moved/pressed/released) → isTrusted=true, detail=clickCount, 按下态 :active 生效');

  // ── 3. JS click()：untrusted，无坐标，且无视遮挡
  await clear();
  await ui('document.getElementById("cover").style.display = "block"');
  await pause(60);
  const covered = await ui(centerJS('#target'));
  assert.equal(covered.hit, 'cover', '遮挡后中心的命中目标应变成本地遮罩');
  await clear();
  await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: covered.x, y: covered.y, button: 'none', buttons: 0});
  await cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: covered.x, y: covered.y, button: 'left', buttons: 1, clickCount: 1});
  await cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: covered.x, y: covered.y, button: 'left', buttons: 0, clickCount: 1});
  await pause();
  log = await ui('window.log');
  assert.ok(log.some(e => e.on === 'cover'), '坐标点击会打在遮罩上（elementFromPoint 校验能提前发现）');
  assert.ok(!log.some(e => e.on === 'target'), '坐标点击不会穿透遮罩');
  await clear();
  await ui('document.getElementById("target").click()');
  await pause();
  log = await ui('window.log');
  const jsClick = log.find(e => e.on === 'target' && e.type === 'click');
  assert.equal(jsClick.trusted, false, 'JS click 是 untrusted');
  assert.equal(jsClick.x, 0, 'JS click 没有真实坐标');
  pass('JS element.click() → isTrusted=false、无坐标、可穿透遮挡（只适合兜底，不能测坐标/命中）');

  // ── 4. 缩放坑：zoomFactor 变化后仍按 CSS 像素取 rect，坐标点击不能改用截图像素
  await ui('document.getElementById("cover").style.display = "none"');
  wc.setZoomFactor(1.25);
  await pause(220);
  const p2 = await ui(centerJS('#target'));
  await clear();
  await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: p2.x, y: p2.y, button: 'none', buttons: 0});
  await cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: p2.x, y: p2.y, button: 'left', buttons: 1, clickCount: 1});
  await cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: p2.x, y: p2.y, button: 'left', buttons: 0, clickCount: 1});
  await pause();
  log = await ui('window.log');
  assert.ok(log.some(e => e.on === 'target' && e.type === 'click' && e.trusted), 'zoom=1.25 下 CSS 像素坐标仍命中');
  wc.setZoomFactor(1);
  pass('zoomFactor=1.25 → 仍用 getBoundingClientRect 的 CSS 像素，命中不偏（DPR/缩放不参与换算）');

  // ── 5. 滚动坑：先 scrollIntoView 再取 rect，滚动容器的行才点得准
  const row = await ui(`(() => {
    const b = document.querySelector('.row[data-i="31"]');
    b.scrollIntoView({block: 'center'});
    const r = b.getBoundingClientRect();
    return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2),
      hit: (document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) || {}).dataset?.i || null};
  })()`);
  assert.equal(row.hit, '31', 'scrollIntoView 后该行才是中心命中目标');
  await clear();
  await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: row.x, y: row.y, button: 'none', buttons: 0});
  await cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: row.x, y: row.y, button: 'left', buttons: 1, clickCount: 1});
  await cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: row.x, y: row.y, button: 'left', buttons: 0, clickCount: 1});
  await pause();
  assert.equal(await ui('window.lastRow'), '31', '滚动后的行被正确点中');
  pass('滚动容器：scrollIntoView 后再取 rect → 命中的是目标行，不是旧位置');

  // ── 6. 拖动/滚动的正解：press → 多步 move → release，click 由 Chromium 自己判定是否吞掉
  await clear();
  const bar = await ui(`(() => {
    const s = document.getElementById('list');
    s.scrollTop = 0;
    const r = s.getBoundingClientRect();
    return {x: Math.round(r.x + r.width / 2), y: Math.round(r.y + 40), before: s.scrollTop};
  })()`);
  await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: bar.x, y: bar.y, button: 'none', buttons: 0});
  await cdp('Input.dispatchMouseEvent', {type: 'mousePressed', x: bar.x, y: bar.y, button: 'left', buttons: 1, clickCount: 1});
  for (let i = 1; i <= 8; i++) {
    await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved', x: bar.x, y: bar.y - i * 12, button: 'left', buttons: 1});
  }
  await cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x: bar.x, y: bar.y - 96, button: 'left', buttons: 0, clickCount: 1});
  await pause();
  const after = await ui('document.getElementById("list").scrollTop');
  assert.ok(after === 0, '页面上没有原生拖拽目标时，拖动只移动指针（滚动要自己写 pointer 逻辑）');
  pass('拖动 = pressed + 多步 mouseMoved(buttons=1) + released；原生页面不会自动滚，需自己实现 pointer 拖动');

  // 证据截图
  const shot = await wc.capturePage();
  const out = path.join(__dirname, `auto-click-${process.platform}.png`);
  fs.writeFileSync(out, shot.toPNG());
  console.log('SHOT ' + out);
  console.log('DONE 全部自动点击口径验证通过');
  app.exit(0);
}

setTimeout(() => { console.error('FAIL 超时'); app.exit(2); }, 90000).unref();
main().catch(error => { console.error('FAIL ' + (error && error.message)); console.error(error && error.stack); app.exit(1); });


