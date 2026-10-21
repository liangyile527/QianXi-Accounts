# QianXi 项目接手规则

这是千禧accounts 的源码仓库。任何接手本项目的 AI 或自动化代理，在修改代码、控制运行实例或调用本地 API 前，必须先阅读：

1. [AI 与自动化接手说明](docs/AI-CONTROL-HANDOFF.md)
2. [本地控制 API 与 CDP](docs/CONTROL-API.md)
3. [README](README.md)

## 关键约束

- 实际项目根目录由当前工作目录和 Electron 的 `--app-path` 确认，不要猜测旧副本。
- 修改 `src/main/` 后必须重启 Electron 主进程；刷新页面不会重新加载主进程代码。
- API 和 CDP 默认只允许本机回环访问。令牌、Cookie、订阅链接、代理密码和其他凭据不得写入代码、文档、日志、截图或 Git。
- 调用 API 后必须查询实例状态、网页 target 和需要持久化的数据，不能只根据 HTTP 状态码或界面提示判断成功。
- 删除实例、修改网络/DNS、覆盖配置或批量操作前，先做只读盘点并保留可回滚点。
- 代码修改后至少运行 `npm.cmd run check`、`npm.cmd run test:control-api` 和 `git diff --check`；未通过时不得声称完成。
- 文件选择和原生确认框的自动化边界，以接手说明中的限制为准。

## 生成 exe 后的收尾（强制）

每次产出新 exe（安装包或免安装版本）后，必须**当场把新版本装上并开机打开**，不能只把 `release/` 里的文件丢在那里等人手动点。做法固定为一条命令：

```powershell
npm.cmd run build:installer   # 产出 release/QianXi-Accounts-Setup-<版本>-x64.exe
npm.cmd run install:latest    # 关闭旧进程 → 静默安装 → 校验 → 启动新版本
# 或者一步到位：npm.cmd run release:local
```

`scripts/install-latest.cjs` 按顺序做这些事，不要绕过它手写临时步骤：

1. 从 `release/build-manifest.json`（缺省回退到最新的 `release/QianXi-Accounts-Setup-*.exe`）定位安装包，并用同目录 `.sha256` 校验，不一致直接失败。
2. **前台/后台只要还有应用进程，先关闭它们**：`QianXiAccounts.exe`（含 `千禧accounts` 同名进程）逐个 `taskkill /F`，并轮询确认已退出。安装器自带 `customCheckAppRunning` 拒绝覆盖运行中的实例（退出码 2），所以这一步必须先做，不能靠安装器自己处理。
3. 用安装器 `/S` 静默安装到现有安装目录（从 `HKCU\Software\2541b14a-9d68-53e3-866a-2bb1b96bd5e6` 的 `InstallLocation` 解析，回退卸载项目录 / `D:\QianXiAccounts` / `C:\QianXiAccounts`），保留原有实例与登录数据。
4. 校验已安装的 `QianXiAccounts.exe` 存在、大小与构建产物一致，然后以 detached 方式启动，并确认进程真的起来了（起不来算失败）。
5. 安装完必须回报：安装包路径与 SHA256、被关闭的进程、最终安装路径、是否成功启动。任何一步失败都如实报告，不要用「界面提示成功」代替进程与文件状态验证。

只改界面代码不需要重装时，允许 `npm.cmd run install:latest -- --dry-run` 先看流程；真正交付给用户的新版本必须走完整流程。


## 项目入口

- 主进程：`src/main/main.cjs`
- IPC 分发：`src/main/ipc.cjs`
- 本地控制 API：`src/main/control-api.cjs`
- 控制界面：`src/renderer/`
- 测试：`tests/`
- 专项文档：`docs/`

除非用户明确要求，不要擅自更换技术路线、删除现有数据或把运行凭据写进仓库。

## 图片交付规则（强制）

本项目任何一轮里生成、渲染或修改的图片（图标、对比图、界面截图、渲染图、图表、预览 PNG），必须**内嵌进回复正文**，不能只给路径、也不能只靠工具卡片：

1. 图片先落到工作区内、**纯 ASCII 文件名**、无空格的路径，例如 `tmp/previews/icon-a.png`；父目录可以是中文，但文件名必须 ASCII。
2. 正文用**工作区相对路径**引用：`![一句话说明](tmp/previews/icon-a.png)`。不加尖括号、不带盘符、不加 `file://`。
3. 禁止引用视觉工具临时产物路径（`.dsh-vision-router/artifacts/.runs/...`）：界面取不到这类路径，只会显示「图片无法预览」。
4. 一张图一行，图后紧跟一句它代表什么；一次最多 10 张。
5. 先把图放出来，再解释、再让用户选。
