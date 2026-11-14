import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { DatabaseSync } from "node:sqlite";
import { readFile, writeFile, appendFile, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { fixtures, jsonl, timestamp } from "./fixtures.js";
import { message, assemble, generatedImageMessage, parseClaude, parseGemini, parseCodex } from "../server/parsers.js";
import { imageSources, publicMessage, mediaId, readImage } from "../server/media.js";
import { HistoryStore } from "../server/store.js";
import { createHistoryServer } from "../server/http.js";

const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=";
test("Claude and Gemini image-only replies, Gemini display text, and completed Codex generation records reach the reader", async () => {
  const f = await fixtures();
  try {
    await appendFile(f.claudeFile, jsonl([{ type: "assistant", uuid: "image-only", timestamp, message: { role: "assistant", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: png } }] } }]));
    const gemini = JSON.parse(await readFile(f.geminiFile, "utf8"));
    gemini.messages.push({ id: "gemini-image", type: "gemini", timestamp, displayContent: "图片说明", content: [{ inlineData: { mimeType: "image/png", data: png } }] });
    await writeFile(f.geminiFile, JSON.stringify(gemini));
    await appendFile(f.codexFile, jsonl([
      { type: "response_item", timestamp, payload: { type: "image_generation_call", id: "completed", status: "completed", result: png } },
      { type: "response_item", timestamp, payload: { type: "image_generation_call", id: "pending", status: "in_progress", result: png } },
    ]));
    const claude = await parseClaude({ filePath: f.claudeFile, mtime: timestamp });
    const g = await parseGemini({ filePath: f.geminiFile, mtime: timestamp });
    const codex = await parseCodex({ filePath: f.codexFile, mtime: timestamp });
    assert.ok(claude?.messages.find((m) => m.id === "image-only")?.imageSources);
    const image = g?.messages.find((m) => m.id === "gemini-image")!;
    assert.match(image.content, /^图片说明/);
    assert.equal(imageSources(image).size, 1);
    assert.equal(codex?.messages.filter((m) => m.generatedImage).length, 1);
  } finally { await rm(f.dir, { recursive: true, force: true }); }
});
test("provider image parts retain inline order, hide thoughts/tools, and keep binary payloads out of public metadata", async () => {
  const parts = [
    { type: "text", text: "before" },
    { type: "input_image", image_url: `data:image/png;base64,${png}` },
    { type: "image", source: { type: "base64", media_type: "image/png", data: png } },
    { inlineData: { mimeType: "image/png", data: png } },
    { type: "localImage", path: "/tmp/generated.png" },
    { type: "image", source: { type: "url", url: "https://example.com/image.png" } },
    { type: "tool_result", content: "hidden tool" },
    { inlineData: { mimeType: "image/png", data: png }, thought: true },
    { type: "text", text: "after" },
  ];
  const m = message("images", "assistant", parts, timestamp, timestamp)!;
  assert.match(m.content, /^before\n!\[图片附件\]/);
  assert.ok(m.content.endsWith("after"));
  assert.ok(!m.content.includes(png) && !m.content.includes("hidden tool"));
  assert.equal((m.content.match(/!\[图片附件\]/g) || []).length, 5);
  const user = message("user", "user", "show images", timestamp, timestamp)!;
  const session = assemble("codex", { id: "test", cwd: "/tmp" }, [user, m], { filePath: "/tmp/source.jsonl", mtime: timestamp })!;
  const output = publicMessage(session, m);
  assert.equal(Object.keys(output.media!).length, 3);
  assert.ok(!JSON.stringify(output).includes(png));
  assert.ok(!("imageSources" in output));
  const source = Object.values(m.imageSources!)[0];
  assert.deepEqual((await readImage(session, m, mediaId(source)))?.data, Buffer.from(png, "base64"));
  assert.equal(generatedImageMessage({ id: "bad", status: "failed", result: png }, timestamp, timestamp), null);
  assert.ok(generatedImageMessage({ id: "good", status: "completed", result: png }, timestamp, timestamp)?.generatedImage);
});

test("image endpoint serves referenced images only, checks bytes and origin, supports HEAD, and keeps assistant media opt-in", async () => {
  const f = await fixtures();
  const project = path.join(f.dir, "project");
  await mkdir(project);
  const image = path.join(project, "with spaces 中文.png");
  await writeFile(image, Buffer.from(png, "base64"));
  await writeFile(path.join(project, "secret.env"), "TOKEN=private");
  await writeFile(path.join(project, "fake.png"), "TOKEN=private");
  await symlink(path.join(project, "secret.env"), path.join(project, "alias.png"));
  const content = `![relative](<with%20spaces%20中文.png>)\n\n![absolute](<${image}>)\n\n![file](<${new URL(`file://${image}`).href}>)\n\n[reference][pic]\n\n[pic]: <with%20spaces%20中文.png>\n\n![missing](missing.png)\n![secret](secret.env)\n![fake](fake.png)\n![alias](alias.png)\n![bad](javascript:alert%281%29)\n![remote](https://example.com/image.png)\n\n\`\`\`md\n![code](not-referenced.png)\n\`\`\``;
  await writeFile(f.codexFile, jsonl([
    { type: "session_meta", payload: { id: "media", cwd: project } },
    { type: "response_item", timestamp, payload: { type: "message", id: "q", role: "user", content: [{ type: "text", text: "images" }] } },
    { type: "response_item", timestamp, payload: { type: "message", id: "a", role: "assistant", content: [{ type: "text", text: content }] } },
  ]));
  const before = await readFile(f.codexFile);
  const store = new HistoryStore(f.config);
  const { server } = createHistoryServer(store);
  try {
    await store.refresh();
    const s = store.get(store.snapshot().sessions.find((s) => s.provider === "codex")!.id)!;
    const m = s.messages[1];
    assert.ok(!imageSources(m).has("not-referenced.png"));
    const media = publicMessage(s, m).media!;
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    for (const key of ["with%20spaces%20中文.png", image, new URL(`file://${image}`).href]) {
      const url = base + media[key].url;
      const response = await fetch(url);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.match(response.headers.get("content-security-policy")!, /sandbox/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.from(png, "base64"));
      const head = await fetch(url, { method: "HEAD" });
      assert.equal(head.status, 200);
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      assert.equal((await fetch(url.split("?")[0])).status, 404);
      assert.equal((await fetch(url, { method: "POST" })).status, 405);
      assert.equal((await fetch(url, { headers: { Origin: "https://evil.example" } })).status, 403);
    }
    for (const key of ["missing.png", "fake.png", "alias.png"]) assert.equal((await fetch(base + media[key].url)).status, 404);
    assert.equal(media["secret.env"].url, null);
    assert.equal(media["javascript:alert%281%29"].url, null);
    assert.equal(media["https://example.com/image.png"].remote, true);
    const prefix = `/api/media/${encodeURIComponent(s.id)}/${m.id}/`;
    assert.equal((await fetch(base + prefix + mediaId("not-referenced.png") + "?includeAssistant=true")).status, 404);
    const detail = await (await fetch(`${base}/api/sessions/${s.id}`)).json();
    assert.equal(detail.messages.length, 1);
    await rm(image);
    assert.equal((await fetch(base + media["with%20spaces%20中文.png"].url)).status, 404);
    assert.deepEqual(await readFile(f.codexFile), before);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});

test("Codex generated App images survive newer JSONL text without duplicate images or exposing generation prompts", async () => {
  const f = await fixtures();
  const state = new DatabaseSync(path.join(f.config.roots.codex, "state_5.sqlite"));
  state.exec("CREATE TABLE threads(id TEXT,cwd TEXT,created_at INTEGER,updated_at INTEGER)");
  state.prepare("INSERT INTO threads VALUES(?,?,?,?)").run("atlas-codex", "/Projects/atlas-web", 1, 1);
  state.close();
  const historyFile = path.join(f.config.roots.codex, "thread_history_1.sqlite");
  const db = new DatabaseSync(historyFile);
  db.exec("CREATE TABLE thread_items(thread_id TEXT,item_id TEXT,rollout_ordinal INTEGER,created_at_ms INTEGER,item_type TEXT,item_json TEXT)");
  const insert = db.prepare("INSERT INTO thread_items VALUES(?,?,?,?,?,?)");
  insert.run("atlas-codex", "q", 1, 1, "userMessage", JSON.stringify({ type: "userMessage", id: "q", content: [{ type: "text", text: "old question" }] }));
  insert.run("atlas-codex", "gen", 2, Date.parse(timestamp), "imageGeneration", JSON.stringify({ type: "imageGeneration", id: "gen", status: "completed", result: png, revisedPrompt: "private generation prompt" }));
  db.close();
  const before = await readFile(historyFile);
  const store = new HistoryStore(f.config);
  try {
    await store.refresh();
    const id = store.snapshot().sessions.find((s) => s.provider === "codex")!.id;
    const session = store.get(id)!;
    assert.equal(session.userCount, 4);
    assert.equal(session.assistantCount, 5);
    assert.equal(session.messages.filter((m) => m.generatedImage).length, 1);
    const generated = session.messages.find((m) => m.generatedImage)!;
    assert.ok(!generated.content.includes("private generation prompt"));
    assert.ok(await readImage(session, generated, mediaId(Object.values(generated.imageSources!)[0])));
    await store.refresh();
    assert.equal(store.get(id)!.messages.filter((m) => m.generatedImage).length, 1);
    assert.deepEqual(await readFile(historyFile), before);
  } finally { store.stop(); await rm(f.dir, { recursive: true, force: true }); }
});
