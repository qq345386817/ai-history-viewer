# 回声 Echo

本地 AI 会话历史阅读器。支持 **Codex、Gemini CLI、Claude Code**，用浏览器查看，原始会话文件始终只读。

## 启动

需要 Node.js **22.13 或更高版本**，适用于 Windows、macOS、Linux。

如果使用 nvm，请先在本目录运行 `nvm use`；项目附有 `.nvmrc`。本机存在多个 Node 版本时，需要确认 `node --version` 满足要求。

```sh
npm ci
npm run build
npm start
```

浏览器打开 **http://127.0.0.1:4317**。保持终端运行；关闭服务用 `Ctrl+C`。此版本提供源码和浏览器界面，尚未制作独立安装包。

开发时运行 `npm run dev`，同样使用 4317 端口。

## 使用

- 左侧按**完整项目路径**分组，同名但不同路径的项目保持独立；同一路径的不同工具会话合并到同一项目。列表同时展示项目名与路径，悬停可看完整路径。
- 左下角可勾选一个或多个数据源，项目列表、项目会话计数和会话列表同步筛选。中栏工具下拉与数据源选择同步，可快速切换到单个工具或全部工具。
- 中栏按日期列出会话，可调整时间排序。
- Codex 会话优先显示数据库中的 `name`，其次 `title`；缺失时读取 `session_index.jsonl` 中的 `thread_name`，仍缺失才使用第一条用户提问。列表摘要继续保留首条提问。在 Codex 中改名后会自动同步，不改写原始记录。
- 默认只显示用户提问。打开“显示 AI 回复”后展示助手的可见回复，不显示内部推理、工具调用和工具输出。
- 搜索覆盖当前选中数据源下的全部项目，即使此前选中了某个项目，也会切换到全局搜索。匹配项目名、完整路径及消息全文；默认只搜索用户提问，打开回复开关后也搜索 AI 回复。点击搜索命中的会话后，自动定位并高亮第一处匹配；代码块内也可定位。再次点击当前会话会重新定位，背景刷新不会打断阅读。快捷键 `⌘K` / `Ctrl+K`。
- 每条用户消息和 AI 回复旁均有“复制”按钮，复制原始文本，保留 Markdown、代码块和换行。成功后提示“已复制”，剪贴板不可访问时显示失败提示，可手动选择文本复制。
- 默认每 **2 秒**检测文件变化，通过 SSE 通知浏览器。新增会话、追加消息、流式回复、文件删除都会更新；有更新时保留当前阅读的会话和滚动位置。
- “数据源”展示来源目录、识别出的会话数和读取异常。未安装的工具不会阻止其他来源读取。
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
```

Node 测试覆盖格式解析、重复消息、Windows/POSIX 路径、跨工具项目合并、损坏文件恢复、文件新增/删除、默认隐藏 AI、全文搜索、只读 HTTP 和 SSE，以及 Codex App 数据库、项目归属和 Gemini 路径匹配。6 项 Chromium 浏览器测试覆盖桌面交互、实时更新、390px 手机布局、真实剪贴板复制及失败提示、数据源多选、跨项目搜索与长会话精确定位，以及会话名称展示和改名同步。测试只在系统临时目录生成独立模拟记录；测试前后校验原始模拟记录未被应用改写。

已在 macOS + Node.js 22 + Chromium 验证。Windows/Linux 使用跨平台 Node API，路径规则有自动测试，但尚未在这两个系统上实机验证。索引保存在内存，极大规模历史的资源占用尚未做压力测试。

## 结构

```text
server/             本机 HTTP 服务、增量文件缓存、三种来源适配器
shared/             统一会话与项目类型
src/components/     项目导航、会话列表、消息阅读、来源弹窗
src/hooks/          SSE、查询、请求取消与刷新
tests/              隔离模拟数据、读取/API 测试、浏览器流程测试
```

实现选择 Node.js + React + Vite：普通网页无法持续无提示地读取这些本机目录，因此增加只读的本地服务。浏览器负责展示与交互；目前无需 Electron 或 Tauri。后续如需应用图标、托盘、系统启动项，可在同一读取层之上增加桌面壳。

格式参考：[OpenAI 本地状态配置](https://learn.chatgpt.com/docs/config-file/config-advanced)、[Gemini CLI 会话管理](https://geminicli.com/docs/cli/session-management/)、[Gemini 记录类型定义](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts)、[Claude Code 本地目录](https://code.claude.com/docs/en/claude-directory)。内部文件格式不属于本工具可控制的稳定接口。
