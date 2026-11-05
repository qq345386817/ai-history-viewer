import { createServer, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { HistoryStore } from "./store.js";

type Middleware = (req: any, res: any, next: (error?: unknown) => void) => void;
export function createHistoryServer(
  store: HistoryStore,
  options: { staticDir?: string; middleware?: Middleware; dev?: boolean } = {},
) {
  const streams = new Set<ServerResponse>();
  const onChange = (revision: number) => {
    for (const stream of streams)
      stream.write(`event: change\ndata: ${JSON.stringify({ revision })}\n\n`);
  };
  store.on("change", onChange);
  const heartbeat = setInterval(() => {
    for (const stream of streams) stream.write(": heartbeat\n\n");
  }, 15000);
  heartbeat.unref();
  const server = createServer(async (req, res) => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 4317;
    const hosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
    const origin = req.headers.origin;
    if (
      !hosts.has(req.headers.host || "") ||
      (origin && ![...hosts].some((host) => origin === `http://${host}`)) ||
      req.headers["sec-fetch-site"] === "cross-site"
    ) {
      res.writeHead(403).end("Only same-origin local access is allowed");
      return;
    }
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      `default-src 'self'; script-src 'self'${options.dev ? " 'unsafe-inline'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`,
    );
    if (!["GET", "HEAD"].includes(req.method || "")) {
      res.setHeader("Allow", "GET, HEAD");
      res.writeHead(405).end("Read-only service");
      return;
    }
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    const json = (code: number, data: unknown) => {
      res.writeHead(code, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(req.method === "HEAD" ? undefined : JSON.stringify(data));
    };
    try {
      if (url.pathname === "/api/events" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        });
        res.write(
          `event: change\ndata: ${JSON.stringify({ revision: store.snapshot().revision })}\n\n`,
        );
        streams.add(res);
        req.on("close", () => streams.delete(res));
        return;
      }
      if (url.pathname === "/api/catalog") {
        const snapshot = store.snapshot();
        const query = (url.searchParams.get("q") || "")
          .trim()
          .toLocaleLowerCase();
        const includeAssistant =
          url.searchParams.get("includeAssistant") === "true";
        const catalog = query
          ? {
              ...snapshot,
              sessions: snapshot.sessions.filter(
                (s) =>
                  `${s.projectName}\n${s.projectPath || ""}\n${s.title}`
                    .toLocaleLowerCase()
                    .includes(query) ||
                  store
                    .get(s.id)
                    ?.messages.some(
                      (m) =>
                        (m.role === "user" || includeAssistant) &&
                        m.content.toLocaleLowerCase().includes(query),
                    ),
              ),
            }
          : snapshot;
        json(200, catalog);
        return;
      }
      if (url.pathname.startsWith("/api/sessions/")) {
        const id = decodeURIComponent(
          url.pathname.slice("/api/sessions/".length),
        );
        const session = store.get(id);
        if (!session) {
          json(404, { error: "会话不存在，或原始文件已被移除" });
          return;
        }
        const includeAssistant =
          url.searchParams.get("includeAssistant") === "true";
        json(200, {
          ...session,
          messages: session.messages.filter(
            (m) => includeAssistant || m.role === "user",
          ),
        });
        return;
      }
      if (url.pathname.startsWith("/api/")) {
        json(404, { error: "Not found" });
        return;
      }
      if (options.middleware) {
        options.middleware(req, res, (error) => {
          if (!res.writableEnded)
            json(error ? 500 : 404, {
              error: error ? "页面加载失败" : "Not found",
            });
        });
        return;
      }
      if (!options.staticDir) {
        json(503, { error: "请先运行 npm run build" });
        return;
      }
      const decoded = decodeURIComponent(url.pathname);
      const file = path.resolve(options.staticDir, "." + decoded);
      if (
        file !== path.resolve(options.staticDir) &&
        !file.startsWith(path.resolve(options.staticDir) + path.sep)
      ) {
        json(404, { error: "Not found" });
        return;
      }
      let target = file;
      try {
        if (!(await stat(target)).isFile())
          target = path.join(options.staticDir, "index.html");
      } catch {
        target = path.join(options.staticDir, "index.html");
      }
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      const data = await readFile(target);
      res.writeHead(200, {
        "Content-Type":
          mime[path.extname(target)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      res.end(req.method === "HEAD" ? undefined : data);
    } catch {
      json(500, { error: "读取失败，请稍后重试" });
    }
  });
  const closeStreams = () => {
    for (const stream of streams) stream.end();
    streams.clear();
  };
  server.on("close", () => {
    clearInterval(heartbeat);
    store.off("change", onChange);
  });
  return { server, closeStreams };
}
