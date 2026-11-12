# 上游 facet 可参考代码移植记录

上游：<https://github.com/HEYD66/facet>（千面 Facet，MIT）
本地：千禧accounts，fork 自同一仓库并做过 UI / quick-links 改造。
比对方式：`git clone --depth 1` 到 `tmp/facet-upstream` 后逐文件 diff。

## 已移植（第一批，2026-11-05）

### 1. 页内查找 + 网页右键菜单（src/main/page-tools.cjs、src/renderer/page-find.js）

来源提交：`c617259 feat: add find-in-page (Ctrl+F) and context menu for instance web pages`。

- `src/main/page-tools.cjs`：`attach / open / search / close / template / build`。
  每个实例只有一个网页视图，因此查找状态挂在 `r.find` 上，不区分标签页；
  宫格视图拒绝查找与「检查」。
- `src/main/controller.cjs`：视图创建后 `r.pageTools = require('./page-tools.cjs').attach(this, id, r, wc)`；
  `before-input-event` 同时拦 F12 与 Ctrl/Cmd+F；`destroyView` 里调用解绑函数。
- `src/main/extension-host.cjs`：拆出 `menuItems(params, wc)` 供 page-tools 追加到内置菜单之后，
  并移除自带的 `context-menu` 弹出，避免一次右键弹两个菜单。
- `src/main/ipc.cjs`：`page-find-open` / `page-find` / `page-find-close`。
  三者同样走 `controller.externalRequest`，所以本地控制 API 也能调用。
- `src/main/preload.cjs`：`onPageFind(callback)` 订阅 `core:page-find`（结果刷新）与
  `core:page-find-open`（打开查找栏），回调带 `type: 'result' | 'open'`。
- `src/renderer/page-find.js`：地址栏下方的查找栏，输入 120ms 防抖，
  Enter / Shift+Enter 循环，Esc 关闭并保留选中，计数显示 `当前/总数`、`查找中…`、`无结果`。
- `tests/page-find-electron.cjs` + `npm run test:page-find`：8 项真实 Electron 断言全绿。

**踩到的坑（写在这里，避免下次重犯）**：
本机 Electron 44.4.5 上，`webContents.findInPage(text, { findNext: false })` 会返回 requestId，
但 `found-in-page` 事件永远不触发，界面卡在「查找中…」。首次查找必须**不传** `findNext`，
只有 Enter / Shift+Enter 继续同一会话时才传 `findNext: true`。
另外 `view.webContents` 的引用在 attach 时缓存到 `r.pageWebContents` 再复用，
避免包装对象不一致导致监听器收不到事件。

### 2. 运行时警告去重（src/main/process-warnings.cjs）

来源提交：`fd56c06 fix 扩展加载警告去重`。

Electron 每次把扩展载入 session 都会 `process.emitWarning` 一条 `ExtensionLoadWarning`，
实测重复项占 5000 行运行时输出的 23%。`installWarningDedup()` 幂等包装 `process.emitWarning`，
按「类型 + 消息」去重（上限 500 条），`main.cjs` 启动时安装一次。

## 尚未移植（按价值排序，供挑选）

| 上游文件 | 行数 | 价值 | 风险 |
| --- | --- | --- | --- |
| `tile-input.cjs` + `tile-input-preload.cjs` | 165 + 55 | 宫格里跨站 iframe 的点击/滚轮投递（Turnstile 这类控件点得动） | 中：要接进 grid 缩略图管线 |
| `fingerprint-inject.js` 新方案 | 176→466 | 显示器 DPR 跨站一致、宿主触摸点、WebGPU adapter 跟随模拟 GPU | 高：指纹注入是全站生效的底层 |
| `safe-http.cjs` | 108 | 统一的超时/重定向/大小上限请求封装 | 低 |
| `proxy-mode.cjs` + `shared-proxy-pool.cjs` | 50 + 89 | 代理模式与共享代理池 | 中：涉及网络配置 |
| `gpu-identity.cjs` | 111 | GPU 档位与线程数配对、补 `window.chrome` | 中 |
| `renderer/browser-tabs.js` + `browser-tabs.cjs` | 21 + 124 | 多标签页 | 高：本地是单 View 模型 |
| `ai-dsh*.cjs` 系列 | 447+239+208+… | 每会话一个持久 DSH 会话、Markdown 渲染、工具步骤分组 | 高：整块重写 AI 面板 |
| `process-metrics.cjs`、`node-port-registry.cjs`、`environment-*.cjs` | 47 / 13 / 60+ | 进程指标、端口登记、environment 分区 | 低 |

**不要直接覆盖的文件**：

- `src/renderer/quick-links.js`：本地已重写（行内 tab、拖拽排序、U-Time 动效），上游版本只有 12 行。
- `src/renderer/ui.css`、`ai-agent.css`、`ai-agent.js`：本地做了外观改造，合并时要按功能点挑，不要整文件覆盖。
- `src/main/controller.cjs`：本地启动/停止流程与上游差异较大，改动按方法逐段移植。

## 验证命令

```powershell
npm.cmd run check
npm.cmd run test:control-api
npm.cmd run test:page-find
git diff --check
```
