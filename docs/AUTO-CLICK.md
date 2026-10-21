# 自动点击技术（实测口径）

本文件记录千禧accounts 里「怎么把鼠标真的点到网页上某个元素」的完整做法。所有结论都由
`tests/auto-click.cjs` 在真实 Electron 窗口里跑出来（`npm run test:auto-click`），不是文档推测。

## 一、三层能力

| 层 | API | isTrusted | 有坐标 | 能穿透遮挡 | 能触发 `:active` / 拖拽 | 适用 |
| --- | --- | --- | --- | --- | --- | --- |
| A 可信输入 | CDP `Input.dispatchMouseEvent` | ✅ | ✅ | ❌ | ✅ | 抓取/自动化首选，最接近真人 |
| B 可信输入 | `webContents.sendInputEvent` | ✅ | ✅ | ❌ | ✅ | 主进程/测试里最省事，无需 attach |
| C 合成点击 | `element.click()` / `dispatchEvent` | ❌ | ❌ (`clientX=0`) | ✅（危险） | ❌ | 只做兜底，或在确实要"无视遮挡"时 |

C 层穿透遮挡是**坑不是特性**：页面上有浮层/骨架屏/广告遮罩时，`element.click()` 照样点中底下的按钮，
而真人点不到。用它做验证会得出"功能没问题"的假结论。

## 二、坐标口径：只有一套真理

**所有坐标都是 CSS 像素，基准是视口左上角（`getBoundingClientRect()` 的坐标系）。**

```js
const point = await frame.executeJavaScript(`(() => {
  const e = document.querySelector(${JSON.stringify(selector)});
  if (!e || !e.getClientRects().length || e.disabled) throw Error('元素不可点击');
  e.scrollIntoView({block: 'center', inline: 'nearest'});   // ① 先滚进视口
  const r = e.getBoundingClientRect();                       // ② 再量 rect
  const hit = document.elementFromPoint(r.x + r.width/2, r.y + r.height/2); // ③ 校验没被挡
  if (!hit || !(e === hit || e.contains(hit))) throw Error('目标被遮挡');
  return {x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
})()`);
```

不参与换算的量（实测确认）：

- `devicePixelRatio` — 不用乘。DPR=1.25 时按 DPR 缩放会点偏。
- `webContents.setZoomFactor()` — 不用乘。缩放改了视觉大小，但 `getBoundingClientRect()` 与输入事件仍是同一套 CSS 像素。
- 截图里的像素 — **不能直接用**。截图是设备像素，必须先除 DPR/缩放，或者干脆改用 rect 取坐标。
- CDP `Page.getLayoutMetrics` 里字段叫 `clientWidth` / `clientHeight`（不是 `width`），`css*` 前缀那组才是 CSS 像素。

## 三、标准点击（A：CDP）

```js
if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');   // 生产里 controller.cjs 已 attach
const cdp = (method, params) => wc.debugger.sendCommand(method, params);

await cdp('Input.dispatchMouseEvent', {type: 'mouseMoved',    x, y, button: 'none', buttons: 0});
await cdp('Input.dispatchMouseEvent', {type: 'mousePressed',  x, y, button: 'left', buttons: 1, clickCount: 1});
await cdp('Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1});
```

- `mouseMoved` 不能省：没有它，`:hover` 与依赖 hover 展开的菜单不会出现。
- `buttons` 是"当前按住的键位掩码"：按下 1、抬起 0。写反了 Chromium 不会给 `click`。
- `clickCount` 决定 `MouseEvent.detail`（1=单击、2=双击）。
- `Input.dispatchMouseEvent` 的坐标**不带滚动偏移**，就是视口坐标；页面滚动后必须重新量 rect。

## 四、标准点击（B：sendInputEvent）

```js
wc.sendInputEvent({type: 'mouseDown', x, y, button: 'left', clickCount: 1});
wc.sendInputEvent({type: 'mouseUp',   x, y, button: 'left', clickCount: 1});
// 键盘
wc.sendInputEvent({type: 'keyDown', keyCode: 'Enter'});
wc.sendInputEvent({type: 'keyUp',   keyCode: 'Enter'});
```

它同样是可信事件，Chromium 会自动补 `pointerdown/pointerup`。缺点：只能打主框架（`mainFrame`），
拿不到 iframe 内文档的坐标基准；要打 iframe 用 A 层 + `frame.executeJavaScript` 取 rect（再按 iframe 的
`getBoundingClientRect` 偏移到顶层视口）。

## 五、拖动 / 横向滚动

```
mouseMoved(x, y) → mousePressed(x, y, buttons:1)
→ 多步 mouseMoved(x + i*dx, y, buttons:1)   // 每步 8–16px，太大会被当成瞬时跳跃
→ mouseReleased(x + n*dx, y, buttons:0)
```

实测：**浏览器不会因为拖动就自动滚动页面**。要"抓着标签栏左右拖"必须自己在渲染层写
`pointerdown/pointermove/pointerup`（本项目 `src/renderer/quick-links.js` 的 `quickBindDrag` 就是这么做的），
并且拖动结束后要吞掉紧随其后的那次 `click`（阈值 4px + 抑制窗口），否则松手瞬间会误触发被拖过的按钮。
参考实现：`src/renderer/quick-links.js:32-36` 的 document 级 `pointerdown/pointermove/pointerup`，
`quickEndDrag()` 收尾并写 `quickSuppressUntil = Date.now()+320`，捕获阶段据此吞掉 click。

## 六、坑清单

1. `elementFromPoint` 校验不能省：浮层、骨架屏、cookie 横幅都会让坐标点击打在别人身上。
2. `scrollIntoView` 之后再量 rect，顺序反了就是点旧位置。
3. 页面在"量 rect"和"点击"之间跳转/重渲染 → 必须重新校验 `frame.url` 或元素仍连接（`isConnected`）。
4. iframe：`sendInputEvent` 打不到，且 iframe 内 rect 要叠加 iframe 自身的偏移。
5. 滚动容器：`scrollIntoView({block:'center'})` 会同时滚容器和外层，量到的是最终位置，不用手动算。
6. 动画期间的坐标是"途中值"：等 `requestAnimationFrame` 两帧或等 transitionend 再取。
7. 高 DPI + 系统缩放：仍用 CSS 像素，不要乘 screen scaleFactor。
8. 弹出原生菜单/`<dialog>` 模态：原生页面会被隐藏或失焦，先关掉浮层再点页面。
9. 隐藏标签 / 后台窗口：`backgroundThrottling` 会让 rAF 停摆、绘制停滞，测试里要显式关掉。
10. 点击成功 ≠ 业务成功：注入只返回"已发出"，结果必须回读页面/状态（本项目所有动作的返回都带
    `note: '需读取页面验证…'`）。

## 七、本项目里的四个入口

| 入口 | 位置 | 说明 |
| --- | --- | --- |
| AI 页面动作 | `src/main/ai-page-actions.cjs` | `hover` 用 `sendInputEvent(mouseMove)`；`key` 用 `sendInputEvent(keyDown/keyUp)`；`select` 走属性赋值 + `input/change` 事件 |
| AI CDP 直通 | `src/main/ai-project-tools.cjs:4` | 白名单 `Page.getLayoutMetrics / Page.getFrameTree / Input.dispatchMouseEvent / Input.dispatchKeyEvent / Input.insertText`，`Input.*` 需确认 |
| AI 合成点击兜底 | `src/main/ai-agent.cjs:63` | `e.click()`，只用于 `click` 动作，返回"需读取页面确认" |
| 测试点击助手 | `tests/quick-links.cjs`、`tests/quick-links-groups.cjs`、`tests/auto-click.cjs` | rect + `elementFromPoint` 校验 + `sendInputEvent`，拖动另走 pointer 事件 |

## 八、自证

```bash
npm run test:auto-click
```

会在真实窗口里跑完 A/B/C 三层、遮挡、缩放（1.25）、滚动容器、拖动六组断言，并输出
`tests/auto-click-<platform>.png`。改动任何注入相关代码后跑它，比看代码可靠。
