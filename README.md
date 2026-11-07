# Echo

English | [简体中文](README.zh-CN.md)

A local AI conversation history reader for **Codex, Gemini CLI, and Claude Code**. Browse your conversations in a web browser while keeping the original session files read-only.

## Getting started

Requires Node.js **22.13 or later**. Supports Windows, macOS, and Linux.

If you use nvm, run `nvm use` in this directory first; the project includes an `.nvmrc` file. If multiple Node versions are installed, check that `node --version` meets the requirement.

```sh
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:4317** in your browser. With `npm start`, keep the terminal running and press `Ctrl+C` to stop the server. A macOS app launcher is also available below; a standalone installer with a bundled runtime is not available yet.

For development, run `npm run dev`, which also uses port 4317.

## macOS app and background launcher

Generate the app once from the project directory:

```sh
npm run app:macos
```

Double-click **Echo.app** in the project directory. It starts the local server, waits until it responds, and opens the home page in your default browser. Repeated launches reuse the existing service. You can move the app to your Applications folder; keep the project directory in place. If you move the project, regenerate the app so its saved path is updated.

The app is a launcher for this checkout and requires Node.js 22.13 or later. It finds Node in common user-local, Homebrew, nvm, fnm, Volta, asdf, and mise locations even when Finder has a minimal `PATH`. Set `ECHO_NODE` to an absolute executable path when using another installation. App generation uses macOS `osacompile`; Swift command-line tools, when available, render the existing Echo icon. A local ad-hoc signature is applied to the generated app.

You can also double-click **start.command** to start and open Echo, or **stop.command** to stop its managed service. Terminal commands are available too:

```sh
npm run start:background
npm run status
npm stop

# Start without opening a browser, or restart after updating the source:
./scripts/echo.sh start
./scripts/echo.sh restart --open
```

The launcher installs missing npm dependencies and builds missing or changed application files before the first managed start. This initial setup may need internet access. When already running, use `restart` after source changes. `launchd` keeps the service running after the launcher, terminal, or browser closes, and restarts it after unexpected exits. **It does not enable login startup**: the service stops at logout/reboot, and you can launch the app again afterward.

The launcher automatically uses `config.local.json` when present. You can select another file with `ECHO_CONFIG` or `./scripts/echo.sh start --config /path/to/config.json`; `ECHO_PORT` overrides its port. Stop the managed service before changing its configuration. Port conflicts are reported without stopping other applications; a healthy server from the same checkout started manually is reused, but must be stopped from its original terminal.

State, the service plist, and `service.log` are stored under `~/Library/Application Support/Echo/<checkout-id>/`; `npm run status` prints the exact log path. `ECHO_RUNTIME_DIR` selects a separate runtime directory when needed. Runtime state and generated `Echo.app` are excluded from Git. These launchers are macOS-specific; the regular `npm start` workflow remains available on Windows and Linux.

## Usage

- Open **Settings** at the bottom of the sidebar to choose **System / Light / Dark** under **Appearance**. Appearance follows your system by default. Your preference is saved in this browser and synced across tabs; system mode also responds to appearance changes while the page is open. On mobile, open project navigation to access Settings.
- The left sidebar groups sessions by **full project path**. Projects with the same name but different paths remain separate; sessions from different tools that share a path appear under the same project. Each entry shows the project name and path; hover to see the full path.
- Select one or more tools in **Settings → Local data sources** to filter the project list, per-project session counts, and session list together. Changes take effect immediately. The tool selector in the middle column stays in sync with these selections, so you can quickly switch to one tool or all tools.
- The middle column lists sessions by date, with adjustable sorting. Both the session list and the conversation reader have a **Scroll to bottom** button. The reader jumps to the latest visible message; the history list keeps its selected sort order. New messages can be reached with another click without interrupting your current reading position.
- Codex session names use the database `name` field first, then `title`, then `thread_name` from `session_index.jsonl`, and finally the first user prompt. The list preview still shows the first prompt. Renaming a session in Codex automatically updates its name here without rewriting the original records.
- Only user prompts are shown by default. Enable **Show AI replies** to display visible assistant replies. Internal reasoning, tool calls, and tool output are not shown.
- Each message shows its full date and time in your browser's local time zone, including conversations that span multiple days.
- Search covers all projects within the selected data sources, switching to a global search even if a project was previously selected. It matches project names, full paths, and message text. By default, only user prompts are searched; enabling replies also includes assistant replies. Opening a matching session scrolls to and highlights the first match, including matches inside code blocks. Clicking the current session again returns to the match, while background refreshes preserve your reading position. Shortcut: `⌘K` / `Ctrl+K`.
- Each user message and assistant reply has a **Copy** button that copies the original text, preserving Markdown, code blocks, and line breaks. A confirmation appears on success. If clipboard access fails, an error is shown and you can select and copy the text manually.
- File changes are checked every **2 seconds** by default, and the browser receives updates through SSE. New sessions, appended messages, streaming replies, and file deletions are reflected automatically while preserving the current session and scroll position.
- **Settings → Local data sources** also shows source directories, detected session counts, and read errors. A tool that is not installed does not prevent other sources from loading.
- On narrow mobile screens, navigation follows **session list → reader → back**. Open the project list with the top-left button.

## Supported history sources

| Source | Default locations and formats | Project identification |
| --- | --- | --- |
| Codex | JSONL files and the app's `state_*.sqlite` and `thread_history_1.sqlite` databases | App project assignments, project roots, and session `cwd` |
| Gemini CLI | `~/.gemini/tmp/*/chats/session-*.json` and `.jsonl` | Project registry, actual paths recorded in sessions, and SHA-256 mappings of known paths |
| Claude Code | `~/.claude/projects/*/*.jsonl` | The `cwd` recorded in each session |

Echo respects `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and Gemini's `GEMINI_CLI_HOME` (using the `.gemini` directory inside it). You can also set source directories explicitly using the configuration below.

Duplicate Codex user messages recorded in both event and response entries are merged, while prompts genuinely sent more than once are preserved. Gemini JSONL supports `$patch`, `$set`, and `$rewindTo`; duplicate JSON and JSONL sessions left after migration are deduplicated. Separate subagent files are excluded from the main session list.

Codex App databases are opened in SQLite `readOnly` mode. App project assignments take precedence, with the session working directory used as a fallback. Duplicate sessions found in both databases and JSONL files are deduplicated. Project directories saved by the app and legacy project configurations also help resolve Gemini project hashes. Echo additionally lists directory names one level below known project parent directories, with a 30-second cache. Mappings require an exact match of the complete SHA-256 hash; Echo does not recursively scan your home directory or read project file contents.

**Legacy Gemini project limitation:** Some records contain only a SHA-256 hash of the project path, which cannot be reversed to recover the original path. If the path is absent from the registry, app project information, and directories adjacent to known projects, the project is shown as unidentified with a hash prefix. Each unknown project remains separate. You can add an exact mapping through configuration; Echo does not guess paths or rewrite the original records.

Echo cannot recover history already removed by the original tool, and it does not read cloud conversations from the ChatGPT or Gemini websites. Internal formats may change when the tools are upgraded; adapters are maintained in `server/parsers.ts`.

## Custom directories and project mappings

Copy `config.example.json` to `config.local.json`, then run:

```sh
npm start -- --config config.local.json
```

All fields are optional. Each `roots` entry points to the tool's configuration root, rather than its `sessions`, `tmp`, or `projects` subdirectory. On Windows, use paths such as `C:/Users/your-name/.codex`, or escape backslashes in JSON.

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
    "gemini-project-hash-or-tmp-subdirectory-name": "/absolute/path/to/project"
  }
}
```

To change only the port, set an environment variable: `ECHO_PORT=4320 npm start` on macOS/Linux, or `$env:ECHO_PORT=4320; npm start` in PowerShell. Source information and project paths in the interface are read-only; configuration is managed through local files.

## Local access and read-only behavior

- The server listens only on `127.0.0.1`, without exposing it to the LAN or the public internet. Requests are checked for their Host, Origin, and cross-site source.
- Application endpoints accept only `GET` / `HEAD`. There are no endpoints for creating, editing, deleting, or continuing conversations, or for calling models.
- Records are opened only for reading. The index stays in process memory; no session copies or on-disk databases are created.
- Authentication key files are not read. At runtime, Echo does not call external APIs, analytics services, or remote fonts. External Markdown images are not loaded automatically, and raw HTML is not executed.
- Assistant replies are also filtered out of the default session detail API response. They are returned only when replies are explicitly enabled. Markdown task-list checkboxes cannot be edited.
- Installing dependencies or a test browser for the first time requires internet access. Once installed, everyday use works offline.

## Verification

```sh
npm test
npm exec playwright -- install chromium
npm run test:e2e

# macOS background-service integration tests (isolated ports and data roots):
npm run test:launcher
```

Node tests cover format parsing, duplicate messages, Windows/POSIX paths, project merging across tools, recovery from damaged files, file additions and deletions, hidden assistant replies by default, full-text search, read-only HTTP and SSE, Codex App databases, project assignments, and Gemini path matching. Chromium browser tests cover desktop interactions, live updates, a 390px mobile layout, real clipboard copying and failure feedback, multiple data-source selections, cross-project search and precise navigation within long sessions, and session name display and rename synchronization. Appearance tests also cover system changes, saved preferences, tab synchronization, dark Markdown contrast, mobile controls and dialogs, applying the theme before React loads, and unavailable browser storage. Tests create isolated sample records only in the system temporary directory and verify that the application has not modified them.

macOS launcher tests use separate temporary state and source directories. They cover concurrent starts without duplicate servers, operation after the launching process exits, crash recovery, stopping with an SSE connection open, and occupied-port handling. The read-only `/api/health` endpoint identifies the running checkout so the launcher can check readiness without reading conversation contents.

The project has been verified on macOS with Node.js 22 and Chromium. Windows and Linux use cross-platform Node APIs, and path handling has automated test coverage, but the application has not yet been verified on those operating systems. The index is held in memory; resource usage with very large histories has not been stress-tested.

## Project structure

```text
server/             Local HTTP server, incremental file cache, and adapters for three sources
shared/             Shared session and project types
src/components/     Project navigation, session list, message reader, and settings dialog
src/hooks/          SSE, queries, request cancellation, and refresh
tests/              Isolated fixtures, read/API tests, and browser workflows
scripts/            macOS service launcher and app-generation sources
```

Echo uses Node.js, React, and Vite. An ordinary web page cannot continuously read these local directories without permission prompts, so a read-only local server provides access while the browser handles display and interaction. Electron or Tauri is not needed for the current version. The macOS launcher opens this browser interface; a desktop shell could later add system tray integration or startup registration on top of the same reading layer.

Format references: [OpenAI local state configuration](https://learn.chatgpt.com/docs/config-file/config-advanced), [Gemini CLI session management](https://geminicli.com/docs/cli/session-management/), [Gemini recording type definitions](https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/services/chatRecordingTypes.ts), and [Claude Code local directory](https://code.claude.com/docs/en/claude-directory). These internal file formats are not stable interfaces controlled by this project.
