# 回声 Echo

[English](README.md) | 简体中文

本地 AI 会话历史阅读器。支持 **Codex、Gemini CLI、Claude Code**，用浏览器查看，原始会话文件始终只读。

## 启动

需要 Node.js **22.13 或更高版本**，适用于 Windows、macOS、Linux。

如果使用 nvm，请先在本目录运行 `nvm use`；项目附有 `.nvmrc`。本机存在多个 Node 版本时，需要确认 `node --version` 满足要求。

```sh
npm ci
npm run build
npm start
```

浏览器打开 **http://127.0.0.1:4317**。使用 `npm start` 时保持终端运行；关闭服务用 `Ctrl+C`。也可使用下面的 macOS App 启动器；目前尚未提供包含运行环境的独立安装包。

开发时运行 `npm run dev`，同样使用 4317 端口。

## macOS App 与后台启动

先在项目目录生成一次 App：

```sh
npm run app:macos
```

双击项目目录中的 **Echo.app**，即可自动启动本地服务，等待服务就绪后在默认浏览器打开首页。重复双击会复用已有服务，不重复启动。App 可以移动到“应用程序”目录；请保留原项目目录的位置。移动项目目录后，需要重新生成 App 以更新保存的路径。

这是当前项目的启动器，需要 Node.js 22.13 或更高版本。即使 Finder 的 `PATH` 很精简，也会从用户本地目录、Homebrew、nvm、fnm、Volta、asdf 和 mise 的常见位置寻找 Node。其他安装位置可通过 `ECHO_NODE` 指定可执行文件的绝对路径。App 使用 macOS 自带的 `osacompile` 生成；如有 Swift 命令行工具，会用现有 Echo 图标生成 App 图标，并对生成的 App 进行本机临时签名。

也可双击 **start.command** 启动服务并打开首页，双击 **stop.command** 停止受管理的服务；终端里可使用：

```sh
npm run start:background
npm run status
npm stop

# 只启动后台服务，或在更新源码后重启：
./scripts/echo.sh start
./scripts/echo.sh restart --open
```

启动器会在首次启动受管理的服务前安装缺失的 npm 依赖，并构建缺失或有变化的应用文件，首次准备可能需要联网。服务已运行时，更新源码后使用 `restart`。后台服务由 `launchd` 管理，启动器、终端或浏览器关闭后仍会继续运行，异常退出会自动恢复。**不会设置登录自启**：注销或重启电脑会结束服务，之后再次双击 App 即可启动。

启动器默认自动使用存在的 `config.local.json`；也可通过 `ECHO_CONFIG` 或 `./scripts/echo.sh start --config /path/to/config.json` 指定其他配置。`ECHO_PORT` 优先覆盖配置中的端口。修改配置前先停止受管理的服务。端口冲突时会提示，不会停止其他应用；同一项目手动启动的健康服务会被复用，但需要回到原终端停止。

运行状态、服务 plist 和 `service.log` 保存在 `~/Library/Application Support/Echo/<项目标识>/`，`npm run status` 会显示完整日志路径。需要独立的运行目录时可设置 `ECHO_RUNTIME_DIR`。运行状态和生成的 `Echo.app` 不会纳入 Git。这些启动器仅适用于 macOS；Windows/Linux 仍使用常规 `npm start`。

## 使用

- 点击侧栏底部“设置”，在“外观”中选择“跟随系统 / 浅色 / 深色”，默认跟随系统。选择会保存在当前浏览器并同步到其他标签页；跟随系统时也会实时响应系统外观变化。手机端打开项目导航后即可进入设置。
- 左侧按**完整项目路径**分组，同名但不同路径的项目保持独立；同一路径的不同工具会话合并到同一项目。列表同时展示项目名与路径，悬停可看完整路径。
- 在“设置 → 本地数据源”中勾选一个或多个工具，项目列表、项目会话计数和会话列表同步筛选，修改立即生效。中栏工具下拉与数据源选择同步，可快速切换到单个工具或全部工具。
- 中栏按日期列出会话，可调整时间排序。会话列表和详情阅读区均有“滚动到底部”按钮：详情可直达最新可见消息，会话列表保持当前排序跳到末尾。追加新消息后可再次点击跳到底部，平时仍保留当前阅读位置。
- Codex 会话优先显示数据库中的 `name`，其次 `title`；缺失时读取 `session_index.jsonl` 中的 `thread_name`，仍缺失才使用第一条用户提问。列表摘要继续保留首条提问。在 Codex 中改名后会自动同步，不改写原始记录。
- 默认只显示用户提问。打开“显示 AI 回复”后展示助手的可见回复，不显示内部推理、工具调用和工具输出。
- 每条提问和 AI 回复均直接显示完整日期与时间，按浏览器本地时区展示，跨天会话可逐条区分日期。
- 搜索覆盖当前选中数据源下的全部项目，即使此前选中了某个项目，也会切换到全局搜索。匹配项目名、完整路径及消息全文；默认只搜索用户提问，打开回复开关后也搜索 AI 回复。点击搜索命中的会话后，自动定位并高亮第一处匹配；代码块内也可定位。再次点击当前会话会重新定位，背景刷新不会打断阅读。快捷键 `⌘K` / `Ctrl+K`。
- 每条用户消息和 AI 回复旁均有“复制”按钮，复制原始文本，保留 Markdown、代码块和换行。成功后提示“已复制”，剪贴板不可访问时显示失败提示，可手动选择文本复制。
- 默认每 **2 秒**检测文件变化，通过 SSE 通知浏览器。新增会话、追加消息、流式回复、文件删除都会更新；有更新时保留当前阅读的会话和滚动位置。
- “设置 → 本地数据源”同时展示来源目录、识别出的会话数和读取异常。未安装的工具不会阻止其他来源读取。
- 手机窄屏采用“会话列表 → 阅读 → 返回”，项目列表通过左上角按钮打开。

## 读取范围

| 来源        | 默认目录与格式                                                   | 项目识别                                              |
| ----------- | ---------------------------------------------------------------- | ----------------------------------------------------- |
| Codex       | JSONL 与 App 的 `state_*.sqlite`、`thread_history_1.sqlite` | App 项目归属、项目根目录、会话 `cwd` |
| Gemini CLI  | `~/.gemini/tmp/*/chats/session-*.json`、`.jsonl`                 | 项目注册表、会话中的真实路径、已知路径的 SHA-256 映射 |
| Claude Code | `~/.claude/projects/*/*.jsonl`                                   | 记录中的 `cwd`                                        |

尊重 `CODEX_HOME`、`CLAUDE_CONFIG_DIR`，以及 Gemini 的 `GEMINI_CLI_HOME`（其下的 `.gemini` 目录）。也可通过下述配置直接指定来源目录。

Codex 的重复 event/response 用户消息会合并，用户真正重复发送的消息仍会保留。Gemini JSONL 支持 `$patch`、`$set`、`$rewindTo`，迁移后并存的 JSON/JSONL 会话会去重。子智能体的独立文件不纳入主会话列表。

Codex App 数据库以 SQLite `readOnly` 模式打开；优先尊重 App 的项目归属，回退到会话工作目录，并对数据库/JSONL 重复会话去重。App 保存的项目目录、旧版项目配置也用于还原 Gemini 项目哈希；还会只读枚举已知项目父目录的一层目录名（30 秒缓存），仅通过完整 SHA-256 完全匹配建立映射，不递归搜索主目录或读取项目文件内容。

**旧版 Gemini 的项目限制：**部分记录只有项目路径的 SHA-256 哈希，哈希本身无法反推原路径。如果注册表、App 项目信息与已知项目相邻目录中都没有该路径，会显示“未识别项目 · 哈希前缀”，每个未知项目保持独立。可通过配置补充准确映射，不会猜测或改写原始记录。

本工具不会恢复已被原工具清理的历史，也不读取网页版 ChatGPT / Gemini 的云端会话。工具升级后内部格式可能变化，适配器集中在 `server/parsers.ts`。

## 自定义目录或项目映射

将 `config.example.json` 复制成 `config.local.json`，再运行：

```sh
npm start -- --config config.local.json
```

所有字段可选。`roots` 指向工具配置根目录，不是其下的 `sessions` / `tmp` / `projects`。Windows 使用 `C:/Users/your-name/.codex`，或在 JSON 中转义反斜杠。

```json
{
  "port": 4317,
  "pollInterval": 2000,
  "roots": {
    "codex": "~/.codex",
    "gemini": "~/.gemini",
    "claude": "~/.claude"
  },
  "projectPaths": {
    "这里填Gemini项目哈希或tmp子目录名": "/absolute/path/to/project"
  }
}
```

只更换端口也可设置环境变量：macOS/Linux 使用 `ECHO_PORT=4320 npm start`；PowerShell 使用 `$env:ECHO_PORT=4320; npm start`。界面中的来源信息和项目路径都只读，配置通过本地文件管理。

## 本地与只读边界

- 仅监听 `127.0.0.1`，不对局域网或公网开放；请求校验 Host、Origin 和跨站来源。
- 业务接口只接受 `GET` / `HEAD`，没有创建、修改、删除、继续会话或调用模型的接口。
- 记录只用读取方式打开；索引保存在进程内存中，不生成会话副本或磁盘数据库。
- 不读取认证密钥文件。运行期间不调用外部 API、分析服务或远程字体；Markdown 外部图片不自动加载，原始 HTML 不执行。
- AI 回复在默认详情接口中也被过滤；仅在显式打开回复开关时返回。Markdown 的任务列表复选框不可修改。
- 首次安装依赖、安装测试浏览器需要联网；安装完成后日常使用不需要联网。

## 验证

```sh
npm test
npm exec playwright -- install chromium
npm run test:e2e

# macOS 后台服务集成测试（隔离端口和数据源）：
npm run test:launcher
```

Node 测试覆盖格式解析、重复消息、Windows/POSIX 路径、跨工具项目合并、损坏文件恢复、文件新增/删除、默认隐藏 AI、全文搜索、只读 HTTP 和 SSE，以及 Codex App 数据库、项目归属和 Gemini 路径匹配。Chromium 浏览器测试覆盖桌面交互、实时更新、390px 手机布局、真实剪贴板复制及失败提示、数据源多选、跨项目搜索与长会话精确定位，以及会话名称展示和改名同步。外观测试还覆盖系统主题变化、偏好保存、标签页同步、深色 Markdown 对比度、手机端控件与弹窗、React 加载前应用主题，以及浏览器存储不可用时的回退。测试只在系统临时目录生成独立模拟记录；测试前后校验原始模拟记录未被应用改写。

macOS 启动器测试使用独立的临时状态和数据源目录，覆盖并发启动不重复创建服务、启动进程退出后持续运行、异常退出后恢复、保持 SSE 连接时停止服务，以及端口冲突处理。只读 `/api/health` 接口用于识别当前运行的项目，启动器无需读取会话内容即可检查服务就绪状态。

已在 macOS + Node.js 22 + Chromium 验证。Windows/Linux 使用跨平台 Node API，路径规则有自动测试，但尚未在这两个系统上实机验证。索引保存在内存，极大规模历史的资源占用尚未做压力测试。

## 结构

```text
server/             本机 HTTP 服务、增量文件缓存、三种来源适配器
shared/             统一会话与项目类型
src/components/     项目导航、会话列表、消息阅读、设置面板
src/hooks/          SSE、查询、请求取消与刷新
tests/              隔离模拟数据、读取/API 测试、浏览器流程测试
scripts/            macOS 后台服务启动器与 App 生成源码
```

实现选择 Node.js + React + Vite：普通网页无法持续无提示地读取这些本机目录，因此增加只读的本地服务。浏览器负责展示与交互；目前无需 Electron 或 Tauri。macOS 启动器负责打开这个浏览器界面；后续如需托盘、系统启动项，可在同一读取层之上增加桌面壳。

格式参考：[OpenAI 本地状态配置](https://learn.chatgpt.com/docs/config-file/config-advanced)、[Gemini CLI 会话管理](https://geminicli.com/docs/cli/session-management/)、[Gemini 记录类型定义](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts)、[Claude Code 本地目录](https://code.claude.com/docs/en/claude-directory)。内部文件格式不属于本工具可控制的稳定接口。
