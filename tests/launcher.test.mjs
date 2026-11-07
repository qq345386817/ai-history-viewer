import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

const exec = promisify(execFile);
const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const launcher = path.join(root, "scripts/echo.sh");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), "echo launcher 测试 "));
  const config = path.join(directory, "test config.json");
  await writeFile(config, JSON.stringify({
    roots: { codex: path.join(directory, "codex"), gemini: path.join(directory, "gemini"), claude: path.join(directory, "claude") },
  }));
  // Match Finder's minimal PATH, using an explicit supported Node installation.
  const env = { HOME: process.env.HOME, PATH: "/usr/bin:/bin:/usr/sbin:/sbin", ECHO_NODE: process.execPath, ECHO_RUNTIME_DIR: path.join(directory, "runtime"), ECHO_CONFIG: config };
  const run = async (...args) => {
    try {
      return (await exec("/bin/bash", [launcher, ...args], { env, cwd: root, timeout: 90000 })).stdout;
    } catch (error) {
      const log = await readFile(path.join(env.ECHO_RUNTIME_DIR, "service.log"), "utf8").catch(() => "No service log was created.");
      error.message += `\nLauncher output:\n${error.stdout}\nService log:\n${log}`;
      throw error;
    }
  };
  return { directory, env, run };
}
async function listen(server) {
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}
async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitHealth(port, predicate) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const health = await (await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })).json();
      if (predicate(health)) return health;
    } catch { /* launchd may still be restarting the service */ }
    await sleep(250);
  }
  throw new Error("Managed service did not recover");
}

test("macOS launcher starts once, survives launcher exit, recovers crashes, and stops with SSE connected", { skip: process.platform !== "darwin", timeout: 120000 }, async () => {
  const f = await setup();
  const port = await freePort();
  f.env.ECHO_PORT = String(port);
  let stream;
  try {
    const starts = await Promise.all([f.run("start"), f.run("start")]);
    assert.ok(starts.every(output => output.includes("running in the background")));
    const first = await waitHealth(port, health => health.app === "echo-ai-history");
    assert.equal(first.projectRoot, root);
    assert.ok(first.launcherId);
    assert.match(await f.run("status"), /managed, PID/);
    await f.run("start");
    assert.equal((await waitHealth(port, () => true)).pid, first.pid);
    const catalog = await (await fetch(`http://127.0.0.1:${port}/api/catalog`)).json();
    assert.equal(catalog.sessions.length, 0, "only isolated source directories are read");

    process.kill(first.pid, "SIGKILL");
    const restarted = await waitHealth(port, health => health.pid !== first.pid);
    assert.equal(restarted.launcherId, first.launcherId);
    const response = await fetch(`http://127.0.0.1:${port}/api/events`);
    stream = response.body.getReader();
    assert.match(new TextDecoder().decode((await stream.read()).value), /event: change/);
    assert.match(await f.run("stop"), /Echo stopped/);
    assert.equal((await stream.read()).done, true);
    stream.releaseLock();
    stream = null;
    assert.match(await f.run("status"), /not running/);
    assert.match(await f.run("stop"), /No launcher-managed/);
    assert.match(await readFile(path.join(f.env.ECHO_RUNTIME_DIR, "service.log"), "utf8"), /只读 AI 会话历史/);
    const plist = await readFile(path.join(f.env.ECHO_RUNTIME_DIR, "service.plist"), "utf8");
    assert.match(plist, /KeepAlive/);
    assert.ok(!f.env.ECHO_RUNTIME_DIR.includes("LaunchAgents"), "the launcher does not install login startup");
  } finally {
    await stream?.cancel().catch(() => {});
    await f.run("stop");
    await rm(f.directory, { recursive: true, force: true });
  }
});

test("launcher rejects occupied ports without stopping unrelated services", { skip: process.platform !== "darwin", timeout: 15000 }, async () => {
  const f = await setup();
  const server = createServer((request, response) => response.end("another app"));
  const port = await listen(server);
  f.env.ECHO_PORT = String(port);
  try {
    await assert.rejects(f.run("start"), error => error.stderr.includes("occupied by another service"));
    assert.equal(await (await fetch(`http://127.0.0.1:${port}`)).text(), "another app");
    assert.match(await f.run("stop"), /No launcher-managed/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(f.directory, { recursive: true, force: true });
  }
});
