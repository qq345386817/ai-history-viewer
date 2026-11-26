import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fixtures, jsonl, timestamp } from "./fixtures.js";
import { hash } from "../server/parsers.js";
import { workspaceUriToPath } from "../server/antigravity.js";
import { imageSources, mediaId, publicMessage, readImage } from "../server/media.js";
import { HistoryStore } from "../server/store.js";

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";

test("Antigravity workspaceUriToPath handles POSIX, encoded, Windows drive and UNC file URIs", () => {
  assert.equal(
    workspaceUriToPath("file:///Users/mac/My%20Project/%E4%B8%AD%E6%96%87/"),
    "/Users/mac/My Project/中文",
  );
  assert.equal(
    workspaceUriToPath("file:///C:/Users/Test/Project/"),
    "C:\\Users\\Test\\Project",
  );
  assert.equal(
    workspaceUriToPath("file://fileserver/share/repo/"),
    "\\\\fileserver\\share\\repo",
  );
  assert.equal(workspaceUriToPath("https://example.com/repo"), null);
});

test("Antigravity Gemini sessions parse cleanly, exclude subagents and non-Gemini models, preview uploaded images, and stay read-only", async () => {
  const f = await fixtures();
  const agRoot = path.join(f.config.roots.gemini, "antigravity");
  const dbFile = path.join(agRoot, "conversation_summaries.db");
  const geminiConvId = "conv-gemini-main";
  const claudeConvId = "conv-claude-only";
  const subagentConvId = "conv-subagent-1";
  const pendingClaudeId = "conv-pending-claude";
  const pendingGeminiId = "conv-pending-gemini";

  const makeLogs = async (id: string, fileName: string, records: unknown[]) => {
    const dir = path.join(agRoot, "brain", id, ".system_generated", "logs");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, fileName);
    await writeFile(file, jsonl(records));
    return file;
  };

  const uploadPath = path.join(
    agRoot,
    "brain",
    geminiConvId,
    ".user_uploaded",
    "shot.png",
  );
  await mkdir(path.dirname(uploadPath), { recursive: true });
  await writeFile(uploadPath, Buffer.from(png, "base64"));

  // Prefer transcript_full.jsonl over truncated transcript.jsonl
  await makeLogs(geminiConvId, "transcript.jsonl", [
    {
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-11-26T10:00:00Z",
      content: "<USER_REQUEST>\ntruncated\n</USER_REQUEST>",
    },
  ]);
  const fullTranscript = await makeLogs(geminiConvId, "transcript_full.jsonl", [
    // Duplicate step_index 0: later entry should supersede earlier one.
    {
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-11-26T09:59:00Z",
      content: "<USER_REQUEST>\n早期重试内容\n</USER_REQUEST>",
    },
    {
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-11-26T10:00:00Z",
      content: [
        "<USER_REQUEST>",
        "请检查 <USER_REQUEST> 渲染逻辑",
        "</USER_REQUEST>",
        "<ADDITIONAL_METADATA>",
        "The current local time is: 2026-11-26T18:00:00+08:00.",
        "</ADDITIONAL_METADATA>",
        "<USER_SETTINGS_CHANGE>",
        "The user changed setting `Model Selection` from None to Gemini 4 Neon (High).",
        "</USER_SETTINGS_CHANGE>",
      ].join("\n"),
    },
    {
      step_index: 1,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-26T10:00:05Z",
      model: "gemini-4-neon-high",
      thinking: "hidden internal reasoning",
      tool_calls: [{ name: "read_file", args: { Path: "/secret" } }],
    },
    {
      step_index: 2,
      source: "MODEL",
      type: "GENERIC",
      status: "DONE",
      created_at: "2026-11-26T10:00:06Z",
      content: "hidden tool output",
    },
    {
      step_index: 3,
      source: "SYSTEM",
      type: "SYSTEM_MESSAGE",
      status: "DONE",
      created_at: "2026-11-26T10:00:07Z",
      content: "hidden system reminder",
    },
    {
      step_index: 4,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-26T10:01:00Z",
      model: "gemini-4-neon-high",
      thinking: "more hidden thinking",
      content: "完整回复内容，未截断。",
    },
    {
      step_index: 5,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-11-26T10:02:00Z",
      content:
        "<USER_REQUEST>\n附图说明如下：\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nThe user has uploaded 1 image(s)\n</ADDITIONAL_METADATA>",
      media: [{ mime_type: "image/png", uri: uploadPath }],
    },
  ]);

  // Non-Gemini model session in Antigravity -> must be excluded from Gemini provider
  await makeLogs(claudeConvId, "transcript_full.jsonl", [
    {
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-11-26T10:05:00Z",
      content: "<USER_REQUEST>\nClaude session in Antigravity\n</USER_REQUEST>",
    },
    {
      step_index: 1,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-26T10:05:10Z",
      model: "claude-sonnet-4-5",
      content: "Claude reply",
    },
  ]);

  // Subagent conversation -> must be excluded
  await makeLogs(subagentConvId, "transcript_full.jsonl", [
    {
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-11-26T10:06:00Z",
      content: "<USER_REQUEST>\nsubagent prompt\n</USER_REQUEST>",
    },
    {
      step_index: 1,
      source: "MODEL",
      type: "PLANNER_RESPONSE",
      status: "DONE",
      created_at: "2026-11-26T10:06:10Z",
      model: "gemini-4-neon-high",
      content: "subagent reply",
    },
  ]);

  // Pending sessions before first PLANNER_RESPONSE: filter using Model Selection
  await makeLogs(pendingClaudeId, "transcript.jsonl", [
    {
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-11-26T10:07:00Z",
      content:
        "<USER_REQUEST>\nPending Claude\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Claude Opus 4.5.\n</USER_SETTINGS_CHANGE>",
    },
  ]);
  await makeLogs(pendingGeminiId, "transcript.jsonl", [
    {
      step_index: 0,
      source: "USER_EXPLICIT",
      type: "USER_INPUT",
      status: "DONE",
      created_at: "2026-11-26T10:08:00Z",
      content:
        "<USER_REQUEST>\nPending Gemini via fallback transcript\n</USER_REQUEST>\n<USER_SETTINGS_CHANGE>\nThe user changed setting `Model Selection` from None to Gemini 3 Pro.\n</USER_SETTINGS_CHANGE>",
    },
  ]);

  const db = new DatabaseSync(dbFile);
  db.exec(`
    CREATE TABLE conversation_summaries (
      conversation_id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT "",
      workspace_uris TEXT NOT NULL DEFAULT "[]",
      project_id TEXT NOT NULL DEFAULT "",
      parent_conversation_id TEXT NOT NULL DEFAULT "",
      nesting_depth INTEGER NOT NULL DEFAULT 0,
      last_modified_time DATETIME NOT NULL
    );
    CREATE TABLE conversation_parents (
      conversation_id TEXT PRIMARY KEY,
      parent_id TEXT NOT NULL
    );
  `);
  const insert = db.prepare(
    "INSERT INTO conversation_summaries VALUES (?,?,?,?,?,?,?)",
  );
  insert.run(
    geminiConvId,
    "Antigravity 标题",
    JSON.stringify(["file:///Projects/atlas-web"]),
    "",
    "",
    0,
    "2026-11-26 10:03:00.500000+00:00",
  );
  insert.run(
    claudeConvId,
    "Non-Gemini Session",
    JSON.stringify(["file:///Projects/atlas-web"]),
    "",
    "",
    0,
    "2026-11-26 10:05:10+00:00",
  );
  insert.run(
    subagentConvId,
    "Browser Subagent",
    JSON.stringify(["file:///Projects/atlas-web"]),
    "",
    geminiConvId,
    1,
    "2026-11-26 10:06:10+00:00",
  );
  insert.run(
    pendingGeminiId,
    "Fallback Transcript Session",
    JSON.stringify(["file:///Projects/antigravity-only"]),
    "",
    "",
    0,
    "0001-01-01 00:00:00+00:00",
  );

  // Also test that Antigravity workspace paths help resolve legacy hashed Gemini CLI sessions.
  const cliData = JSON.parse(await readFile(f.geminiFile, "utf8"));
  cliData.projectHash = hash("/Projects/antigravity-only");
  await writeFile(f.geminiFile, JSON.stringify(cliData));
  await rm(path.join(f.config.roots.gemini, "projects.json"));

  const store = new HistoryStore(f.config);
  try {
    const beforeDb = await readFile(dbFile);
    const beforeTranscript = await readFile(fullTranscript);
    await store.refresh();

    const catalog = store.snapshot();
    const geminiSessions = catalog.sessions.filter(
      (s) => s.provider === "gemini",
    );
    // 1 Gemini CLI + 2 Antigravity Gemini sessions (main + pendingGemini)
    assert.equal(geminiSessions.length, 3);
    assert.ok(!geminiSessions.some((s) => s.nativeId === claudeConvId));
    assert.ok(!geminiSessions.some((s) => s.nativeId === subagentConvId));
    assert.ok(!geminiSessions.some((s) => s.nativeId === pendingClaudeId));

    const mainSummary = geminiSessions.find((s) => s.nativeId === geminiConvId)!;
    assert.equal(mainSummary.title, "Antigravity 标题");
    assert.equal(mainSummary.projectPath, "/Projects/atlas-web");
    assert.equal(mainSummary.userCount, 2);
    assert.equal(mainSummary.assistantCount, 1);
    assert.equal(mainSummary.updatedAt, "2026-11-26T10:03:00.500Z");

    // Merged with Codex and Claude sessions in /Projects/atlas-web
    const atlas = catalog.projects.find((p) => p.path === "/Projects/atlas-web")!;
    assert.equal(atlas.count, 3);
    assert.equal(atlas.providerCounts.gemini, 1);

    const mainSession = store.get(mainSummary.id)!;
    assert.equal(mainSession.messages[0].content, "请检查 <USER_REQUEST> 渲染逻辑");
    assert.equal(mainSession.messages[1].content, "完整回复内容，未截断。");
    assert.ok(
      !mainSession.messages.some((m) =>
        /hidden|早期重试|ADDITIONAL_METADATA|USER_SETTINGS_CHANGE/.test(m.content),
      ),
    );

    // Uploaded image attachment is wired into media preview & readImage
    const imageMsg = mainSession.messages[2];
    assert.match(imageMsg.content, /附图说明如下：/);
    assert.equal(imageSources(imageMsg).size, 1);
    const mediaMap = publicMessage(mainSession, imageMsg).media!;
    const mediaKey = Object.keys(mediaMap)[0];
    assert.ok(mediaMap[mediaKey].url?.startsWith("/api/media/"));
    const loaded = await readImage(
      mainSession,
      imageMsg,
      mediaId(uploadPath),
    );
    assert.deepEqual(loaded?.data, Buffer.from(png, "base64"));

    // Fallback transcript.jsonl and zero-time last_modified_time fallback to message timestamp
    const fallbackSummary = geminiSessions.find(
      (s) => s.nativeId === pendingGeminiId,
    )!;
    assert.equal(fallbackSummary.title, "Fallback Transcript Session");
    assert.equal(fallbackSummary.updatedAt, "2026-11-26T10:08:00.000Z");

    // Legacy Gemini CLI session resolved its hashed path via Antigravity workspace URI
    const cliSummary = geminiSessions.find(
      (s) => s.nativeId === "design-gemini",
    )!;
    assert.equal(cliSummary.projectPath, "/Projects/antigravity-only");

    // Source files & DB remain untouched (read-only)
    assert.deepEqual(await readFile(dbFile), beforeDb);
    assert.deepEqual(await readFile(fullTranscript), beforeTranscript);

    // Metadata-only rename in conversation_summaries.db bumps revision without rewriting transcripts
    await store.refresh();
    const stableRev = store.snapshot().revision;
    await store.refresh();
    assert.equal(store.snapshot().revision, stableRev);

    db.prepare(
      "UPDATE conversation_summaries SET title=? WHERE conversation_id=?",
    ).run("Antigravity 改名后", geminiConvId);
    await store.refresh();
    assert.ok(store.snapshot().revision > stableRev);
    assert.equal(store.get(mainSummary.id)?.title, "Antigravity 改名后");
    assert.equal(
      store.snapshot().sources.find((s) => s.provider === "gemini")?.errors,
      0,
    );
  } finally {
    db.close();
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("Antigravity falls back to annotations pbtxt and config/projects JSON when summaries DB is absent", async () => {
  const f = await fixtures();
  const agRoot = path.join(f.config.roots.gemini, "antigravity");
  const convId = "conv-no-db";
  const logsDir = path.join(
    agRoot,
    "brain",
    convId,
    ".system_generated",
    "logs",
  );
  await mkdir(logsDir, { recursive: true });
  await mkdir(path.join(agRoot, "annotations"), { recursive: true });
  await writeFile(
    path.join(agRoot, "annotations", `${convId}.pbtxt`),
    'title:"Annotation \\"Title\\""  last_user_view_time:{seconds:1795690295}',
  );
  await writeFile(
    path.join(logsDir, "transcript_full.jsonl"),
    jsonl([
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: timestamp,
        content: "<USER_REQUEST>\n无数据库回退测试\n</USER_REQUEST>",
      },
      {
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: timestamp,
        model: "gemini-2.5-pro",
        content: "已收到。",
      },
    ]),
  );
  const store = new HistoryStore({
    ...f.config,
    projectPaths: { [convId]: "/Projects/manual-map" },
  });
  try {
    await store.refresh();
    const session = store
      .snapshot()
      .sessions.find((s) => s.nativeId === convId)!;
    assert.equal(session.provider, "gemini");
    assert.equal(session.title, 'Annotation "Title"');
    assert.equal(session.projectPath, "/Projects/manual-map");
    assert.equal(
      store.snapshot().sources.find((s) => s.provider === "gemini")?.errors,
      0,
    );
  } finally {
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});
