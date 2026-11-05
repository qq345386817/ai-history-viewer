import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import { fixtures } from "./fixtures.js";
import { hash } from "../server/parsers.js";
import { HistoryStore } from "../server/store.js";

test("App database history, explicit project assignments, JSONL deduplication, Gemini hash resolution and refresh remain read-only", async () => {
  const f = await fixtures();
  const stateFile = path.join(f.config.roots.codex, "state_5.sqlite");
  const historyFile = path.join(
    f.config.roots.codex,
    "thread_history_1.sqlite",
  );
  const state = new DatabaseSync(stateFile);
  state.exec(`CREATE TABLE threads(id TEXT, cwd TEXT, project_id TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE project_roots(project_id TEXT, position INTEGER, path TEXT);
    INSERT INTO threads VALUES('atlas-codex','/worktrees/temporary','project-atlas',1793760000,1793800000);
    INSERT INTO threads VALUES('metadata-only','/known/gemini-project',NULL,1793760000,1793800000);
    INSERT INTO project_roots VALUES('project-atlas',0,'/Projects/atlas-web');`);
  state.close();
  const history = new DatabaseSync(historyFile);
  history.exec(`CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_type TEXT,item_json TEXT);
    CREATE TABLE thread_history_projection_state(thread_id TEXT,next_rollout_ordinal INTEGER);
    INSERT INTO thread_history_projection_state VALUES('atlas-codex',2);`);
  const insert = history.prepare(
    "INSERT INTO thread_items VALUES(?,?,?,?,?,?)",
  );
  insert.run(
    "atlas-codex",
    "u1",
    1,
    1793760000000,
    "userMessage",
    JSON.stringify({
      type: "userMessage",
      id: "u1",
      content: [{ type: "text", text: "App 中的用户提问" }],
    }),
  );
  insert.run(
    "atlas-codex",
    "a1",
    2,
    1793760001000,
    "agentMessage",
    JSON.stringify({
      type: "agentMessage",
      id: "a1",
      text: "原始回复",
      phase: "final_answer",
    }),
  );
  insert.run(
    "atlas-codex",
    "r1",
    3,
    1793760002000,
    "reasoning",
    JSON.stringify({ text: "hidden" }),
  );
  const data = JSON.parse(await readFile(f.geminiFile, "utf8"));
  data.projectHash = hash("/known/gemini-project");
  await writeFile(f.geminiFile, JSON.stringify(data));
  await rm(path.join(f.config.roots.gemini, "projects.json"));
  const store = new HistoryStore(f.config);
  try {
    const before = await Promise.all(
      [stateFile, historyFile].map((p) => readFile(p)),
    );
    await store.refresh();
    const catalog = store.snapshot();
    assert.equal(
      catalog.sessions.filter((s) => s.provider === "codex").length,
      1,
    );
    const codex = catalog.sessions.find((s) => s.provider === "codex")!;
    assert.equal(codex.projectPath, "/Projects/atlas-web");
    assert.equal(codex.userCount, 1);
    assert.equal(codex.assistantCount, 1);
    assert.equal(
      catalog.sessions.find((s) => s.provider === "gemini")?.projectPath,
      "/known/gemini-project",
    );
    assert.deepEqual(
      await Promise.all([stateFile, historyFile].map((p) => readFile(p))),
      before,
    );
    const revision = catalog.revision;
    history.prepare("UPDATE thread_items SET item_json=? WHERE item_id=?").run(
      JSON.stringify({
        type: "agentMessage",
        id: "a1",
        text: "更新后的回复",
        phase: "final_answer",
      }),
      "a1",
    );
    history.exec(
      "UPDATE thread_history_projection_state SET next_rollout_ordinal=4",
    );
    await store.refresh();
    assert.ok(store.snapshot().revision > revision);
    assert.equal(store.get(codex.id)?.messages.at(-1)?.content, "更新后的回复");
  } finally {
    history.close();
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("legacy App project roots also identify Gemini paths when no SQLite database exists", async () => {
  const f = await fixtures();
  const target = "/legacy/gemini";
  const data = JSON.parse(await readFile(f.geminiFile, "utf8"));
  data.projectHash = hash(target);
  await writeFile(f.geminiFile, JSON.stringify(data));
  await rm(path.join(f.config.roots.gemini, "projects.json"));
  await writeFile(
    path.join(f.config.roots.codex, ".codex-global-state.json"),
    JSON.stringify({ "local-projects": { legacy: { rootPaths: [target] } } }),
  );
  const store = new HistoryStore(f.config);
  try {
    await store.refresh();
    assert.equal(
      store.snapshot().sessions.find((s) => s.provider === "gemini")
        ?.projectPath,
      target,
    );
  } finally {
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("Gemini project hashes match adjacent directory names exactly without reading project contents", async () => {
  const f = await fixtures();
  const known = path.join(f.dir, "workspace", "known");
  const target = path.join(f.dir, "workspace", "gemini-project");
  await mkdir(known, { recursive: true });
  await mkdir(target);
  const data = JSON.parse(await readFile(f.geminiFile, "utf8"));
  data.projectHash = hash(target);
  await writeFile(f.geminiFile, JSON.stringify(data));
  await rm(path.join(f.config.roots.gemini, "projects.json"));
  await writeFile(
    path.join(f.config.roots.codex, ".codex-global-state.json"),
    JSON.stringify({ "electron-saved-workspace-roots": [known] }),
  );
  const store = new HistoryStore(f.config);
  try {
    await store.refresh();
    assert.equal(
      store.snapshot().sessions.find((s) => s.provider === "gemini")
        ?.projectPath,
      target,
    );
  } finally {
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("Codex name/title override JSONL prompt titles and metadata-only renames refresh without changing messages", async () => {
  const f = await fixtures();
  const state = new DatabaseSync(
    path.join(f.config.roots.codex, "state_5.sqlite"),
  );
  state.exec(
    "CREATE TABLE threads(id TEXT,cwd TEXT,name TEXT,title TEXT); INSERT INTO threads VALUES('atlas-codex','/Projects/atlas-web','简短会话名称','自动生成标题');",
  );
  const store = new HistoryStore(f.config);
  const original = await readFile(f.codexFile);
  try {
    await store.refresh();
    const first = store
      .snapshot()
      .sessions.find((s) => s.nativeId === "atlas-codex")!;
    assert.equal(first.title, "简短会话名称");
    assert.match(first.preview, /帮我检查一下登录页面/);
    const messages = store.get(first.id)!.messages;
    const revision = store.snapshot().revision;
    state.prepare("UPDATE threads SET name=?").run("改名后");
    await store.refresh();
    assert.equal(store.get(first.id)!.title, "改名后");
    assert.ok(store.snapshot().revision > revision);
    assert.deepEqual(store.get(first.id)!.messages, messages);
    state.prepare("UPDATE threads SET name=?").run("  ");
    await store.refresh();
    assert.equal(store.get(first.id)!.title, "自动生成标题");
    state.prepare("UPDATE threads SET title=?").run("");
    await writeFile(
      path.join(f.config.roots.codex, "session_index.jsonl"),
      JSON.stringify({ id: "atlas-codex", thread_name: "索引中的名称" }) + "\n",
    );
    await store.refresh();
    assert.equal(store.get(first.id)!.title, "索引中的名称");
    assert.deepEqual(await readFile(f.codexFile), original);
  } finally {
    state.close();
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("Codex index-only names refresh independently of JSONL and missing names fall back to user prompt", async () => {
  const f = await fixtures();
  const store = new HistoryStore(f.config);
  const index = path.join(f.config.roots.codex, "session_index.jsonl");
  try {
    await writeFile(
      index,
      JSON.stringify({ id: "atlas-codex", thread_name: "原名称" }) + "\n",
    );
    await store.refresh();
    let s = store
      .snapshot()
      .sessions.find((s) => s.nativeId === "atlas-codex")!;
    assert.equal(s.title, "原名称");
    const revision = store.snapshot().revision;
    await writeFile(
      index,
      JSON.stringify({ id: "atlas-codex", thread_name: "索引改名" }) + "\n",
    );
    await store.refresh();
    s = store.snapshot().sessions.find((s) => s.nativeId === "atlas-codex")!;
    assert.equal(s.title, "索引改名");
    assert.ok(store.snapshot().revision > revision);
    await rm(index);
    await store.refresh();
    assert.match(store.get(s.id)!.title, /帮我检查一下登录页面/);
  } finally {
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});
