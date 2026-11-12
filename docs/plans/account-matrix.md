# 账号矩阵（Account Matrix）设计方案

> 目标：把「实例 = 一个浏览器环境」升级为「账号 = 一个可巡检、可审计、可搬迁的运营单元」。
> 现状缺口：实例能启动、能绑节点、能固定指纹，但没人知道「这个环境里到底登没登、什么时候过期、出口和指纹说不说得通」。

## 1. 数据模型

新文件 `accounts.json`（与 `workspace.json` 同目录，独立文件，避免给现有数据结构做迁移）：

```jsonc
{
  "accounts": [
    {
      "id": "acct-xxxx",
      "instanceId": "inst-xxxx",          // 与实例 1:1；实例删除时账号转 orphan
      "platform": "claude",                // claude | gemini | chatgpt | arena | custom
      "handle": "work@qianxi.dev",         // 仅作备注，凭据永远留在 profile 里
      "region": ["JP", "SG"],              // 期望出口国家集合
      "tags": ["主力", "长文"],
      "notes": "",
      "proxy": { "sourceId": "src-1", "nodeName": "[JP]东京·IEPL-02", "sticky": true },
      "fingerprintDigest": { "timezone": "Asia/Tokyo", "locale": "ja-JP", "uaPlatform": "Win32", "webgl": "ANGLE / RTX 3060" },
      "health": 94,
      "verdict": "active",                 // active | expired | challenge | unknown | orphan
      "lastProbeAt": "2026-10-26T00:02:11+08:00",
      "probeEvidence": "DOM:[data-testid=user-menu] · url:claude.ai/chats",
      "createdAt": "2026-10-21T18:03:00+08:00"
    }
  ],
  "snapshots": [
    { "id": "snap-xxxx", "accountId": "acct-xxxx", "at": "2026-10-25T22:41:00+08:00", "kind": "baseline", "bytes": 432013312, "sha256": "…", "path": "snapshots/acct-xxxx/snap-xxxx.zip" }
  ]
}
```

写入走 `src/main/accounts.cjs`（原子写：tmp + rename，与 workspace 一致），controller 在 `snapshot()` 里并入 `accounts: accounts.snapshot()` 与 `accountBatch: …||null`。

## 2. 登录态探针（probe）

平台判定表 `src/main/account-platforms.cjs`：

```js
module.exports = {
  claude:  { home:'https://claude.ai/chats',  login:/\/login|signin/i, verify:/challenge|verify you are human/i,
             cookies:['sessionKey'], selectors:['[data-testid="user-menu"]','[aria-label*="account"]'] },
  gemini:  { home:'https://gemini.google.com/app', login:/accounts\.google\.com/, verify:/sorry\/index/,
             cookies:['SID','__Secure-1PSID'], selectors:['[aria-label*="Google 账号"]','[data-test-id="user-avatar"]'] },
  chatgpt: { home:'https://chatgpt.com/', login:/\/auth\/login/, verify:/\/cdn-cgi\/challenge/,
             cookies:['__Secure-next-auth.session-token'], selectors:['[data-testid="profile-button"]'] },
  arena:   { home:'https://lmarena.ai/', login:/login/, verify:/captcha/i, cookies:['arena_session'], selectors:['[data-testid="user-menu"]'] }
};
```

执行流程（`controller.probeAccount(id)`）：

1. 实例未运行 → 记 `verdict:'unknown'` + `reason:'未启动'`，**不主动唤醒**（唤醒交给批量任务显式选）。
2. 已运行 → 复用当前 `WebContentsView`：先 `loadURL(home)`，`did-finish-load` 后 `executeJavaScript` 一次取 `{url, title, cookies: 名字存在性, hit: selector 命中列表}`；总超时 8s。
3. 判定：命中 selectors → `active`；url 匹配 login → `expired`；匹配 verify 或命中 challenge 特征 → `challenge`；其余 `unknown`。
4. **只读证据**：cookie 仅取「名字是否存在」，不读值、不落日志、不进 snapshot 之外的任何文件。
5. 结果写回 account + `lastProbeAt`，UI 走既有 `emit()` 推送。

## 3. 指纹一致性审计（audit）

输入：`fingerprintDigest`（seed 派生后的期望值）+ 实测（实例内 `navigator`/`Intl`/`WebGL debug_renderer_info`）+ 出口证据（复用 `node-evidence.cjs` 的 country/locale）。

| 维度 | 权重 | 说明 |
| --- | --- | --- |
| 时区 = 出口时区 | 25 | `Asia/Tokyo` vs 节点国家主时区 |
| 出口国家 ∈ region | 25 | 不在集合内即扣满 |
| 语言首项 = region 主语言 | 20 | `ja-JP` |
| UA platform 与硬件 seed 一致 | 15 | 期望值来自 seed |
| WebGL 渲染器一致 | 15 | 同上 |

`score = Σ(权重 × 一致)`，输出 `{ score, diffs:[{key, expect, actual, weight}] }`。UI 只标黄，不拦操作；**跨地区换出口时就地把时区/语言一起改写**（见 §4），换完重算。

## 4. 换出口（rebind）

`controller.rebindAccounts(ids, { sourceId, nodeName })`：

1. 对每个 id：`stop → store.saveNodes/setNode → 若跨地区则同步改写 environment.timezone/locale → start → probe`。
2. `sticky:true` 时把该节点记成账号的「家」，启动前校验优先回连；不匹配只记 warn（复用现有 `proxyAlert` 通道）。
3. 队列串行，单项约 4s，进度写 `accountBatch`，失败项保留可单独重试。

## 5. 快照与克隆

- 保存：实例必须停止 → `ditto/robocopy` 复制 profile 目录，排除 `Cache*`、`GPUCache`、`Code Cache` → zip → 计算 sha256 → 写 manifest。413MB 量级，压缩后 ~180MB。
- 恢复：先把当前 profile 复制成 `pre-restore` 快照（自动，保留 1 份）→ 覆盖 → 启动。
- 导出/导入：`.qxacct` 包 = `account.json + profile.zip`，本机文件；只写路径，不写日志。
- 克隆：复制快照到新实例目录 → 新账号 `notes` 自动追加「克隆自 X」。平台可能因此踢掉旧会话，UI 在按钮上直说，不弹警告。

## 6. 批量与队列

`accountBatch = { id, action:'start'|'stop'|'probe'|'rebind'|'snapshot', total, done, failed, items:[{accountId,state,error}] }`，复用 `batchCreation` 的结构与取消语义（`cancelling` 后不再入队新项）。

## 7. IPC 清单（`src/main/ipc.cjs` 追加）

```
account-save            { account }
account-remove          { id }
account-probe           { id }
account-audit           { id }
account-rebind          { ids, sourceId, nodeName }
account-snapshot-save   { id, kind }
account-snapshot-restore{ snapshotId }
account-snapshot-remove { snapshotId }
account-batch           { action, ids }
```

## 8. 渲染层

- `src/renderer/account-matrix.js` + `account-matrix.css`。
- `app.js:10` `globalViews` 增加 `'accounts'`；`app.js:42` 侧栏「全局管理」增加一项（带待处理数徽标）；`app.js:43` `titles` 加 `accounts:'账号矩阵'`；`app.js:53` 增加渲染分支。
- 三块 UI：矩阵网格（图 1）、右侧详情抽屉（图 2）、换出口对话框（图 3，复用 `#modal` 容器）。
- 交互细节：整卡可点开抽屉；`Alt+点击` 直接选中不入抽屉；多选后底部出现批量条；抽屉里所有 `btn` 都要有 `data-account-action`，事件委托在容器上（与 quick-links 一致的做法）。

## 9. 测试与门禁

- `tests/account-matrix.cjs`：数据层 CRUD / 判定表四态 / 审计评分边界（全一致 100、跨地区 75-25）/ 快照 manifest 校验 / 队列失败保留。
- 渲染层沿用 `tests/ui-motion.cjs` 那套宽松 Proxy 桥（`onState/onOverlay/onWindowVisibility/onExternalFocus/onUpdate`），否则 `initialize()` 半路停住。
- 新增 npm script `test:accounts`，并挂进 `check`（`npm.cmd run check` 会跑全部 scripts 列表校验）。
- 跑完必须过：`npm.cmd run check`、`npm.cmd run test:control-api`、`git diff --check`。

## 10. 里程碑

| 阶段 | 内容 | 交付判据 |
| --- | --- | --- |
| P0 | accounts.json + matrix 视图 + 单账号探针 | 12 个账号能建档、能出灯、能手动巡检一个 |
| P1 | 审计 + 批量队列 + 换出口 | 一次给 3 个账号换出口并复检，失败项可重试 |
| P2 | 快照/恢复/克隆 + 定时保活 | 夜间按 cron 唤醒巡检，早上看队列结果 |

## 11. 明确的取舍

- 不存平台密码：只存 handle 备注，凭据永远是 profile 里的 cookie，导出时随快照走。
- 探针会占用实例 3–8 秒（要加载真实首页），跑批量时按并发 1 串行，避免代理抖动。
- selector 会因平台改版失效：三级降级（selector → cookie 名 → URL 正则），全失效记 `unknown` 而不是 `expired`，避免误报。
- 快照体积大：默认只保留最近 3 份 + 手动锁定，超限先删最旧的自动快照。
