import test from "node:test";
import assert from "node:assert/strict";
import { appendFile, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { once } from "node:events";
import { request } from "node:http";
import { HistoryStore } from "../server/store.js";
import { createHistoryServer } from "../server/http.js";
import { fixtures, jsonl, timestamp } from "./fixtures.js";

test("store groups the same absolute project across providers; no rewrite of source files", async () => {
  const f = await fixtures();
  const store = new HistoryStore(f.config);
  try {
    const before = await Promise.all(
      [f.codexFile, f.claudeFile, f.geminiFile].map((file) => readFile(file)),
    );
    await store.refresh();
    assert.equal(store.snapshot().sessions.length, 3);
    assert.equal(store.snapshot().projects.length, 2);
    assert.equal(
      store.snapshot().projects.find((p) => p.path === "/Projects/atlas-web")
        ?.count,
      2,
    );
    const revision = store.snapshot().revision;
    await store.refresh();
    // Project mapping can settle once after the first full discovery.
    await store.refresh();
    const stable = store.snapshot().revision;
    await store.refresh();
    assert.equal(store.snapshot().revision, stable);
    assert.ok(stable >= revision);
    assert.deepEqual(
      await Promise.all(
        [f.codexFile, f.claudeFile, f.geminiFile].map((file) => readFile(file)),
      ),
      before,
    );
  } finally {
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("store discovers new files, appended messages, removals and recovers after partial Gemini JSON", async () => {
  const f = await fixtures();
  const store = new HistoryStore(f.config);
  try {
    await store.refresh();
    await appendFile(
      f.codexFile,
      jsonl([
        {
          type: "event_msg",
          timestamp: "2026-11-04T07:00:00Z",
          payload: { type: "user_message", message: "new appended prompt" },
        },
      ]),
    );
    await store.refresh();
    assert.equal(
      store.snapshot().sessions.find((s) => s.provider === "codex")?.userCount,
      5,
    );
    const newFile = path.join(path.dirname(f.codexFile), "rollout-new.jsonl");
    await writeFile(
      newFile,
      jsonl([
        { type: "session_meta", payload: { id: "new", cwd: "/new-project" } },
        {
          type: "event_msg",
          timestamp,
          payload: { type: "user_message", message: "new session" },
        },
      ]),
    );
    await store.refresh();
    assert.equal(store.snapshot().sessions.length, 4);
    const validGemini = await readFile(f.geminiFile, "utf8");
    await writeFile(f.geminiFile, '{"partial":');
    await store.refresh();
    assert.equal(store.snapshot().sessions.length, 4);
    assert.equal(
      store.snapshot().sources.find((s) => s.provider === "gemini")?.errors,
      1,
    );
    await writeFile(f.geminiFile, validGemini);
    await store.refresh();
    assert.equal(
      store.snapshot().sources.find((s) => s.provider === "gemini")?.errors,
      0,
    );
    await rm(newFile);
    await store.refresh();
    assert.equal(store.snapshot().sessions.length, 3);
  } finally {
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});
test("missing provider directories are valid empty sources", async () => {
  const f = await fixtures();
  await rm(f.dir, { recursive: true, force: true });
  const store = new HistoryStore(f.config);
  await store.refresh();
  assert.equal(store.snapshot().sessions.length, 0);
  assert.ok(store.snapshot().sources.every((s) => !s.available));
});
test("HTTP API is read-only, user-only by default, full-text search respects the reply toggle, and SSE pushes updates", async () => {
  const f = await fixtures();
  const store = new HistoryStore(f.config);
  const { server, closeStreams } = createHistoryServer(store);
  await store.refresh();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}`;
  const abort = new AbortController();
  try {
    const catalog = await (await fetch(`${base}/api/catalog`)).json();
    const id = catalog.sessions.find((s: any) => s.provider === "codex").id;
    const session = await (await fetch(`${base}/api/sessions/${id}`)).json();
    assert.ok(session.messages.every((m: any) => m.role === "user"));
    assert.equal(
      (
        await (
          await fetch(`${base}/api/sessions/${id}?includeAssistant=true`)
        ).json()
      ).messages.length,
      8,
    );
    const search = encodeURIComponent("reducer");
    assert.equal(
      (await (await fetch(`${base}/api/catalog?q=${search}`)).json()).sessions
        .length,
      0,
    );
    assert.equal(
      (
        await (
          await fetch(`${base}/api/catalog?q=${search}&includeAssistant=true`)
        ).json()
      ).sessions.length,
      1,
    );
    assert.equal(
      (
        await (
          await fetch(`${base}/api/catalog?q=${encodeURIComponent("键盘操作")}`)
        ).json()
      ).sessions.length,
      1,
    );
    for (const method of ["POST", "PUT", "PATCH", "DELETE"])
      assert.equal(
        (await fetch(`${base}/api/catalog`, { method })).status,
        405,
      );
    assert.equal(
      (
        await fetch(`${base}/api/catalog`, {
          headers: { Origin: "https://evil.example" },
        })
      ).status,
      403,
    );
    const rebindingStatus = await new Promise<number>((resolve) => {
      request(
        `${base}/api/catalog`,
        { headers: { Host: "evil.example" } },
        (response) => {
          response.resume();
          resolve(response.statusCode!);
        },
      ).end();
    });
    assert.equal(rebindingStatus, 403);
    assert.equal((await fetch(`${base}/api/sessions/unknown`)).status, 404);
    const stream = await fetch(`${base}/api/events`, { signal: abort.signal });
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    assert.match(decoder.decode((await reader.read()).value), /event: change/);
    await appendFile(
      f.codexFile,
      jsonl([
        {
          type: "event_msg",
          timestamp,
          payload: { type: "user_message", message: "SSE new prompt" },
        },
      ]),
    );
    await store.refresh();
    assert.match(decoder.decode((await reader.read()).value), /event: change/);
    await reader.cancel();
  } finally {
    abort.abort();
    closeStreams();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.stop();
    await rm(f.dir, { recursive: true, force: true });
  }
});
