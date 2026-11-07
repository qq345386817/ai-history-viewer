import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)).replace(/\/$/, "");
const hash = value => createHash("sha256").update(value).digest("hex");
const runtime = process.env.ECHO_RUNTIME_DIR
  ? path.resolve(process.env.ECHO_RUNTIME_DIR)
  : path.join(homedir(), "Library/Application Support/Echo", hash(root).slice(0, 12));
const instance = hash(root + "\n" + runtime).slice(0, 16);
const label = "local.echo-ai-history." + instance;
const target = `gui/${process.getuid()}/${label}`;
const plist = path.join(runtime, "service.plist");
const statePath = path.join(runtime, "service.json");
const logPath = path.join(runtime, "service.log");
const lock = path.join(runtime, "launcher.lock");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const url = port => `http://127.0.0.1:${port}`;

function launchctl(...args) {
  return spawnSync("/bin/launchctl", args, { encoding: "utf8" });
}
function loaded() {
  return launchctl("print", target).status === 0;
}
function readJSON(file, fallback = null) {
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : fallback;
}
function writeJSON(file, value) {
  writeFileSync(file + ".tmp", JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  renameSync(file + ".tmp", file);
}
async function run(executable, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd: root, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", code => code === 0 ? resolve() : reject(new Error(`${path.basename(executable)} failed (${code}).`)));
  });
}
async function health(port) {
  try {
    const response = await fetch(url(port) + "/api/health", { signal: AbortSignal.timeout(1500), redirect: "error" });
    if (!response.ok) return null;
    const value = await response.json();
    return value.app === "echo-ai-history" && value.projectRoot === root ? value : null;
  } catch {
    return null;
  }
}
async function occupied(port) {
  return new Promise(resolve => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const finish = value => { socket.destroy(); resolve(value); };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(1500, () => finish(true));
  });
}
async function waitReady(port) {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const value = await health(port);
    if (value?.launcherId === instance) return value;
    await sleep(250);
  }
  const details = existsSync(logPath)
    ? readFileSync(logPath, "utf8").split("\n").slice(-16).join("\n")
    : "The service did not create a log. Check the current user's launchd GUI session.";
  throw new Error(`Echo did not become ready. See ${logPath}\n${details}`);
}
async function withLock(action) {
  mkdirSync(runtime, { recursive: true, mode: 0o700 });
  const deadline = Date.now() + 300000;
  while (true) {
    try {
      mkdirSync(lock, { mode: 0o700 });
      writeJSON(path.join(lock, "owner.json"), { pid: process.pid });
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try {
        const owner = readJSON(path.join(lock, "owner.json"));
        let alive = false;
        if (owner?.pid) {
          try { process.kill(owner.pid, 0); alive = true; } catch { /* previous launcher exited */ }
        }
        if (!alive && Date.now() - statSync(lock).mtimeMs > 5000) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch (error) {
        if (error.code === "ENOENT") continue;
        throw error;
      }
      if (Date.now() > deadline) throw new Error(`Another launcher is still busy. See ${runtime}`);
      await sleep(250);
    }
  }
  try { return await action(); }
  finally { rmSync(lock, { recursive: true, force: true }); }
}
function sourceFingerprint() {
  const digest = createHash("sha256");
  const visit = relative => {
    const absolute = path.join(root, relative);
    if (statSync(absolute).isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(path.join(relative, name));
    } else {
      digest.update(relative + "\0").update(readFileSync(absolute));
    }
  };
  for (const file of ["src", "server", "shared", "public", "index.html", "package.json", "package-lock.json", "vite.config.ts", "tsconfig.json", "tsconfig.server.json"]) visit(file);
  return digest.digest("hex");
}
async function ensureBuild() {
  const dependencyLock = path.join(root, "node_modules/.package-lock.json");
  const npm = path.join(path.dirname(process.execPath), "npm");
  if (!existsSync(npm)) throw new Error(`npm was not found beside ${process.execPath}. Install Node with npm included.`);
  const install = !existsSync(path.join(root, "node_modules/.bin/vite"))
    || !existsSync(path.join(root, "node_modules/.bin/tsc"))
    || !existsSync(dependencyLock)
    || statSync(path.join(root, "package-lock.json")).mtimeMs > statSync(dependencyLock).mtimeMs;
  if (install) await run(npm, ["ci", "--no-audit", "--no-fund"]);
  const fingerprint = sourceFingerprint();
  const stamp = path.join(runtime, "build.json");
  if (install || !existsSync(path.join(root, "dist/index.html"))
    || !existsSync(path.join(root, "dist-server/server/index.js"))
    || readJSON(stamp)?.fingerprint !== fingerprint) {
    await run(npm, ["run", "build"]);
    writeJSON(stamp, { fingerprint });
  }
}
function configuration(args) {
  const index = args.indexOf("--config");
  if (index !== -1 && (!args[index + 1] || args[index + 1].startsWith("--"))) throw new Error("--config requires a JSON file path.");
  const input = index !== -1 ? args[index + 1] : (process.env.ECHO_CONFIG || "");
  const file = input ? path.resolve(input.replace(/^~(?=\/)/, homedir()))
    : existsSync(path.join(root, "config.local.json")) ? path.join(root, "config.local.json") : null;
  const custom = file ? readJSON(file) : {};
  if (file && !custom) throw new Error(`Configuration not found: ${file}`);
  const port = Number(process.env.ECHO_PORT || custom.port || 4317);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("The background launcher requires a port from 1 to 65535.");
  return { port, file };
}
async function openBrowser(port) {
  await run("/usr/bin/open", [url(port)]);
}
async function start(args) {
  const { port, file } = configuration(args);
  if (loaded()) {
    const previous = readJSON(statePath);
    if (previous?.port !== port || previous?.config !== file) throw new Error("Echo is running with another configuration. Stop it before changing ports or configuration files.");
    await waitReady(port);
  } else {
    if (await occupied(port)) {
      if (!await health(port)) throw new Error(`Port ${port} is occupied by another service. Set ECHO_PORT or stop that service first.`);
      console.log(`Echo is already running outside this launcher: ${url(port)}`);
      if (args.includes("--open")) await openBrowser(port);
      return;
    }
    await ensureBuild();
    const environment = {
      HOME: homedir(), PATH: process.env.PATH, ECHO_PORT: String(port), ECHO_LAUNCHER_ID: instance,
    };
    for (const key of ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "GEMINI_CLI_HOME"]) {
      if (process.env[key]) environment[key] = process.env[key];
    }
    const definition = {
      Label: label,
      ProgramArguments: [process.execPath, path.join(root, "dist-server/server/index.js"), ...(file ? ["--config", file] : [])],
      WorkingDirectory: root, EnvironmentVariables: environment,
      RunAtLoad: true, KeepAlive: true, ThrottleInterval: 5,
      StandardOutPath: logPath, StandardErrorPath: logPath,
    };
    const converted = spawnSync("/usr/bin/plutil", ["-convert", "xml1", "-o", plist, "-"], { input: JSON.stringify(definition), encoding: "utf8" });
    if (converted.status !== 0) throw new Error(converted.stderr || converted.stdout || "Could not generate the service plist.");
    writeJSON(statePath, { port, config: file });
    const result = launchctl("bootstrap", `gui/${process.getuid()}`, plist);
    if (result.status !== 0) throw new Error(`Could not start the background service: ${result.stderr}`);
    try { await waitReady(port); }
    catch (error) { launchctl("bootout", target); throw error; }
  }
  console.log(`Echo is running in the background: ${url(port)}\nLog: ${logPath}`);
  if (args.includes("--open")) await openBrowser(port);
}
async function stop() {
  if (!loaded()) {
    console.log("No launcher-managed Echo service is running. A manually started server must be stopped in its original terminal.");
    return;
  }
  const result = launchctl("bootout", target);
  if (result.status !== 0) throw new Error(`Could not stop Echo: ${result.stderr}`);
  const previous = readJSON(statePath);
  const deadline = Date.now() + 15000;
  while (previous && (await health(previous.port))?.launcherId === instance) {
    if (Date.now() > deadline) throw new Error(`Echo is still shutting down. See ${logPath}`);
    await sleep(250);
  }
  console.log("Echo stopped.");
}
async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || "start";
  if (command === "--help" || command === "help") {
    console.log("Echo macOS launcher\n\n  scripts/echo.sh start [--open] [--config path]\n  scripts/echo.sh status\n  scripts/echo.sh stop\n  scripts/echo.sh restart [--open] [--config path]\n\nECHO_PORT changes the port; ECHO_NODE selects Node; ECHO_RUNTIME_DIR isolates service state.\nThe service runs until stopped or logged out; it does not enable login startup.");
    return;
  }
  if (process.platform !== "darwin") throw new Error("This background launcher requires macOS. Use npm start on other platforms.");
  if (!["start", "status", "stop", "restart"].includes(command)) throw new Error(`Unknown command: ${command}. Use --help.`);
  const allowed = new Set(["--open", "--config"]);
  for (let i = 1; i < args.length; i++) {
    if (!allowed.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
    if (args[i] === "--config") i++;
  }
  if (command === "status") {
    const state = readJSON(statePath);
    const port = state?.port || configuration(args).port;
    const value = await health(port);
    console.log(value ? `Echo is running (${loaded() ? "managed" : "external"}, PID ${value.pid}): ${url(port)}` : `Echo is not ready${loaded() ? "; launchd is restarting it" : " / not running"}.`);
    console.log(`Log: ${logPath}`);
    return;
  }
  await withLock(async () => {
    if (command === "stop" || command === "restart") await stop();
    if (command === "start" || command === "restart") await start(args);
  });
}
main().catch(error => { console.error(`Echo: ${error.message}`); process.exitCode = 1; });
