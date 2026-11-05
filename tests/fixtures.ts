import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Config } from "../server/config.js";

export const jsonl = (records: unknown[]) =>
  records.map((record) => JSON.stringify(record)).join("\n") + "\n";
export const timestamp = "2026-11-04T06:32:00.000Z";
export async function fixtures() {
  const dir = await mkdtemp(path.join(tmpdir(), "echo-history-test-"));
  const config: Config = {
    roots: {
      codex: path.join(dir, "codex"),
      gemini: path.join(dir, "gemini"),
      claude: path.join(dir, "claude"),
    },
    projectPaths: {},
    port: 0,
    pollInterval: 500,
  };
  const codexFile = path.join(
    config.roots.codex,
    "sessions/2026/11/04/rollout-atlas.jsonl",
  );
  const claudeFile = path.join(
    config.roots.claude,
    "projects/encoded-project/session-claude.jsonl",
  );
  const geminiFile = path.join(
    config.roots.gemini,
    "tmp/design-system/chats/session-gemini.json",
  );
  await Promise.all(
    [codexFile, claudeFile, geminiFile].map((file) =>
      mkdir(path.dirname(file), { recursive: true }),
    ),
  );
  const prompts = [
    "帮我检查一下登录页面的状态管理，看看有没有可以优化的地方。",
    '错误提示需要更清晰：区分网络问题、密码错误和账号不存在这三种情况。\n\n```tsx\nconst [status, setStatus] = useState("idle");\n```',
    "保留现有的视觉风格，把 loading 和禁用状态一起补齐。",
    "很好，再检查一下键盘操作和移动端显示。",
  ];
  const codexRecords = [
    {
      type: "session_meta",
      payload: { id: "atlas-codex", cwd: "/Projects/atlas-web", timestamp },
    },
    {
      type: "response_item",
      timestamp,
      payload: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: "<environment_context>private context</environment_context>",
          },
        ],
      },
    },
    ...prompts.flatMap((text, i) => [
      {
        type: "event_msg",
        timestamp: `2026-11-04T06:${20 + i * 4}:00Z`,
        payload: { type: "user_message", message: text },
      },
      {
        type: "response_item",
        timestamp: `2026-11-04T06:${20 + i * 4}:00Z`,
        payload: {
          id: `u${i}`,
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      },
      {
        type: "response_item",
        timestamp: `2026-11-04T06:${21 + i * 4}:00Z`,
        payload: {
          id: `a${i}`,
          type: "message",
          role: "assistant",
          channel: "final",
          content: [
            {
              type: "output_text",
              text: `AI 回复 ${i + 1}：建议使用 reducer 管理状态。`,
            },
          ],
        },
      },
    ]),
    {
      type: "response_item",
      timestamp,
      payload: {
        type: "message",
        role: "assistant",
        channel: "analysis",
        content: [
          { type: "output_text", text: "reasoning should never display" },
        ],
      },
    },
    {
      type: "response_item",
      timestamp,
      payload: { type: "function_call_output", output: "secret tool output" },
    },
  ];
  await writeFile(codexFile, jsonl(codexRecords));
  await writeFile(
    claudeFile,
    jsonl([
      {
        type: "user",
        uuid: "c1",
        sessionId: "atlas-claude",
        cwd: "/Projects/atlas-web",
        timestamp: "2026-11-04T01:45:00Z",
        message: { role: "user", content: "排查 API 请求超时" },
      },
      {
        type: "user",
        uuid: "c2",
        sessionId: "atlas-claude",
        timestamp,
        message: {
          role: "user",
          content: [
            { type: "tool_result", content: "Do not show tool results" },
          ],
        },
      },
      {
        type: "assistant",
        uuid: "c3",
        sessionId: "atlas-claude",
        timestamp: "2026-11-04T01:46:00Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "hidden" },
            { type: "text", text: "检查网络连接与超时设置。" },
          ],
        },
      },
      {
        type: "user",
        uuid: "c4",
        isMeta: true,
        timestamp,
        message: { role: "user", content: "hidden meta prompt" },
      },
    ]),
  );
  await writeFile(
    geminiFile,
    JSON.stringify({
      sessionId: "design-gemini",
      projectHash: "design-hash",
      startTime: "2026-11-04T03:08:00Z",
      lastUpdated: "2026-11-04T03:09:00Z",
      messages: [
        {
          id: "g1",
          type: "user",
          timestamp: "2026-11-04T03:08:00Z",
          content: [{ text: "梳理组件库的设计规范" }],
        },
        {
          id: "g2",
          type: "gemini",
          timestamp: "2026-11-04T03:09:00Z",
          content: "统一组件的命名、结构和使用约定。",
          thoughts: [{ text: "hidden thought" }],
        },
      ],
    }),
  );
  await writeFile(
    path.join(config.roots.gemini, "projects.json"),
    JSON.stringify({
      projects: { "/Projects/design-system": "design-system" },
    }),
  );
  return { dir, config, codexFile, claudeFile, geminiFile, codexRecords };
}
