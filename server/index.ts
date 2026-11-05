import path from "node:path";
import { loadConfig, appRoot } from "./config.js";
import { HistoryStore } from "./store.js";
import { createHistoryServer } from "./http.js";

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(
    "回声 Echo — 本地 AI 会话历史（只读）\n\nnpm start -- [--config /path/config.json]\nECHO_PORT=4317 可设置端口；只监听 127.0.0.1。",
  );
  process.exit(0);
}
const configIndex = args.indexOf("--config");
if (configIndex >= 0 && !args[configIndex + 1])
  throw new Error("--config 需要一个 JSON 文件路径");
const config = await loadConfig(
  configIndex >= 0 ? args[configIndex + 1] : undefined,
);
const store = new HistoryStore(config);
const dev = args.includes("--dev");
const vite = dev
  ? await (
      await import("vite")
    ).createServer({
      root: appRoot,
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    })
  : undefined;
const { server, closeStreams } = createHistoryServer(store, {
  staticDir: path.join(appRoot, "dist"),
  middleware: vite?.middlewares,
  dev,
});
server.on("error", (error: NodeJS.ErrnoException) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `端口 ${config.port} 已被占用，请设置 ECHO_PORT 后重试。`
      : error.message,
  );
  process.exitCode = 1;
  store.stop();
  void vite?.close();
});
server.listen(config.port, "127.0.0.1", () => {
  const addr = server.address();
  console.log(
    `\n  回声 Echo · 只读 AI 会话历史\n  http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : config.port}\n  正在读取本地会话；每 ${config.pollInterval / 1000} 秒检查更新。\n`,
  );
  void store.start();
});
function shutdown() {
  store.stop();
  closeStreams();
  server.close();
  void vite?.close();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
