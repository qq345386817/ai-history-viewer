import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { fixtures, jsonl, timestamp } from "./fixtures.js";
import {
  contentText,
  normalizeProjectPath,
  parseClaude,
  parseCodex,
  parseGemini,
  projectKey,
} from "../server/parsers.js";

test("Codex: deduplicate event/response prompts, retain repeated user turns, exclude injected context, reasoning and tools", async () => {
  const f = await fixtures();
  try {
    const before = await readFile(f.codexFile);
    const session = await parseCodex({
      filePath: f.codexFile,
      mtime: timestamp,
    });
    assert.equal(session?.userCount, 4);
    assert.equal(session?.assistantCount, 4);
    assert.equal(session?.projectPath, "/Projects/atlas-web");
    assert.equal(
      session?.messages.some((m) =>
        /private context|reasoning|secret tool/.test(m.content),
      ),
      false,
    );
    assert.deepEqual(await readFile(f.codexFile), before);
    const repeat = {
      type: "event_msg",
      timestamp: "2026-11-04T06:40:00Z",
      payload: {
        type: "user_message",
        message: "很好，再检查一下键盘操作和移动端显示。",
      },
    };
    await writeFile(
      f.codexFile,
      jsonl([...f.codexRecords, repeat]) + '{"unfinished":',
    );
    assert.equal(
      (await parseCodex({ filePath: f.codexFile, mtime: timestamp }))
        ?.userCount,
      5,
    );
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("Codex: response-only older format and missing timestamp", async () => {
  const f = await fixtures();
  try {
    await writeFile(
      f.codexFile,
      jsonl([
        { type: "session_meta", payload: { id: "old", cwd: "/work" } },
        {
          type: "response_item",
          payload: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "legacy prompt" }],
          },
        },
      ]),
    );
    const session = await parseCodex({
      filePath: f.codexFile,
      mtime: timestamp,
    });
    assert.equal(session?.userCount, 1);
    assert.equal(session?.createdAt, timestamp);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("Claude: user text and assistant text only, no tools or metadata", async () => {
  const f = await fixtures();
  try {
    const session = await parseClaude({
      filePath: f.claudeFile,
      mtime: timestamp,
    });
    assert.equal(session?.userCount, 1);
    assert.equal(session?.assistantCount, 1);
    assert.equal(session?.messages[1].content, "检查网络连接与超时设置。");
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("Gemini: legacy JSON, project registry lookup, no thoughts", async () => {
  const f = await fixtures();
  try {
    const session = await parseGemini({
      filePath: f.geminiFile,
      mtime: timestamp,
      projectPaths: new Map([["design-system", "/Projects/design-system"]]),
    });
    assert.equal(session?.projectPath, "/Projects/design-system");
    assert.equal(session?.userCount, 1);
    assert.equal(session?.assistantCount, 1);
    assert.equal(
      session?.messages.some((m) => m.content.includes("hidden thought")),
      false,
    );
    const unknown = await parseGemini({
      filePath: f.geminiFile,
      mtime: timestamp,
    });
    assert.equal(unknown?.projectPath, null);
    assert.match(unknown!.projectName, /未识别项目/);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("Gemini: JSONL streaming updates, removal, ordering, metadata checkpoint and rewind", async () => {
  const f = await fixtures();
  const file = f.geminiFile + "l";
  try {
    const records = [
      {
        sessionId: "stream",
        projectHash: "hash",
        startTime: timestamp,
        cwd: "/work",
      },
      { id: "1", type: "user", content: "question 1", timestamp },
      { id: "2", type: "gemini", content: "partial", timestamp },
      { $patch: { id: "2", content: "full answer" } },
      { id: "3", type: "user", content: "removed", timestamp },
      {
        $patch: {
          removeIds: ["3"],
          updates: [{ id: "1", content: "question updated" }],
          orderIds: ["1", "2"],
        },
      },
    ];
    await writeFile(file, jsonl(records));
    let s = await parseGemini({ filePath: file, mtime: timestamp });
    assert.deepEqual(
      s?.messages.map((m) => m.content),
      ["question updated", "full answer"],
    );
    await writeFile(file, jsonl([...records, { $rewindTo: "2" }]));
    s = await parseGemini({ filePath: file, mtime: timestamp });
    assert.equal(s?.messages.length, 1);
    await writeFile(
      file,
      jsonl([
        ...records,
        {
          $set: {
            messages: [
              { id: "4", type: "user", content: "checkpoint", timestamp },
            ],
          },
        },
      ]),
    );
    assert.equal(
      (await parseGemini({ filePath: file, mtime: timestamp }))?.messages[0]
        .content,
      "checkpoint",
    );
    await writeFile(file, jsonl([...records, { $rewindTo: "unknown" }]));
    assert.equal(await parseGemini({ filePath: file, mtime: timestamp }), null);
  } finally {
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("project paths: Windows drives/UNC and POSIX have stable identities without guessing encoded names", () => {
  assert.equal(
    normalizeProjectPath("C:\\Users\\Test\\Project\\"),
    "C:\\Users\\Test\\Project",
  );
  assert.equal(
    projectKey("C:\\Users\\TEST\\Project"),
    projectKey("c:/users/test/project/"),
  );
  assert.equal(normalizeProjectPath("/a/../project/"), "/project");
  assert.equal(normalizeProjectPath("encoded-project-name"), null);
  assert.equal(
    contentText([
      { type: "tool_result", content: "secret" },
      { type: "thinking", text: "secret" },
      { type: "text", text: "visible" },
      { type: "input_image" },
    ]),
    "visible\n[图片附件]",
  );
});
