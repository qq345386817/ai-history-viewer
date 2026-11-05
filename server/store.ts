import { EventEmitter } from "node:events";
import { readdir, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import type {
  Catalog,
  Project,
  Provider,
  Session,
  SourceStatus,
} from "../shared/types.js";
import type { Config } from "./config.js";
import { CodexAppReader } from "./codex-app.js";
import {
  hash,
  normalizeProjectPath,
  parseClaude,
  parseCodex,
  parseGemini,
} from "./parsers.js";

const providers: Provider[] = ["codex", "claude", "gemini"];
interface FileEntry {
  filePath: string;
  provider: Provider;
  stamp: string;
  mtime: string;
}
interface CacheEntry {
  stamp: string;
  session: Session | null;
  error: boolean;
}

async function walk(
  root: string,
  matches: (file: string) => boolean,
  maxDepth: number,
): Promise<string[]> {
  const files: string[] = [];
  async function visit(dir: string, depth: number) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (
        ["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        return;
      throw error;
    }
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(dir, entry.name);
      if (
        entry.isDirectory() &&
        depth < maxDepth &&
        !["subagents", "node_modules", ".git"].includes(entry.name)
      )
        await visit(file, depth + 1);
      else if (entry.isFile() && matches(file)) files.push(file);
    }
  }
  await visit(root, 0);
  return files;
}

async function exists(dir: string): Promise<boolean> {
  try {
    return (await stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

export class HistoryStore extends EventEmitter {
  private cache = new Map<string, CacheEntry>();
  private sessions = new Map<string, Session>();
  private timer?: ReturnType<typeof setInterval>;
  private pending?: Promise<void>;
  private appReader: CodexAppReader;
  private neighbors = new Set<string>();
  private neighborKey = "";
  private neighborChecked = 0;
  private async projectNeighbors(
    known: Iterable<string>,
  ): Promise<Set<string>> {
    const parents = [...new Set([...known].map((p) => path.dirname(p)))]
      .filter(
        (p) =>
          ![path.parse(p).root, homedir(), path.dirname(homedir())].includes(p),
      )
      .sort()
      .slice(0, 128);
    const key = JSON.stringify(parents);
    if (key === this.neighborKey && Date.now() - this.neighborChecked < 30000)
      return this.neighbors;
    const next = new Set<string>();
    // Directory names only, one level beside known projects; no recursive home scan or file-content search.
    for (const parent of parents) {
      try {
        for (const entry of (
          await readdir(parent, { withFileTypes: true })
        ).slice(0, 5000)) {
          if (
            entry.isDirectory() &&
            !entry.name.startsWith(".") &&
            !["node_modules", "vendor"].includes(entry.name)
          )
            next.add(path.join(parent, entry.name));
        }
      } catch {
        /* Missing/moved projects still retain their exact recorded paths. */
      }
    }
    this.neighborKey = key;
    this.neighborChecked = Date.now();
    this.neighbors = next;
    return next;
  }
  private catalog: Catalog = {
    revision: 0,
    scanning: true,
    scannedAt: null,
    sessions: [],
    projects: [],
    sources: [],
  };
  constructor(readonly config: Config) {
    super();
    this.appReader = new CodexAppReader(config.roots.codex);
  }
  snapshot(): Catalog {
    return this.catalog;
  }
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }
  async start(): Promise<void> {
    await this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.config.pollInterval);
    this.timer.unref();
  }
  stop(): void {
    clearInterval(this.timer);
  }
  refresh(): Promise<void> {
    if (this.pending) return this.pending;
    this.pending = this.scan().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
  private async projectPaths(
    extraPaths: Iterable<string> = [],
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const add = (raw: string, identifier?: string) => {
      const normalized = normalizeProjectPath(raw);
      if (!normalized) return;
      if (identifier) result.set(identifier, normalized);
      for (const value of new Set([raw, normalized, raw.replaceAll("\\", "/")]))
        result.set(hash(value), normalized);
    };
    for (const session of this.sessions.values())
      if (session.projectPath) add(session.projectPath);
    for (const p of extraPaths) add(p);
    try {
      const registry = JSON.parse(
        await readFile(
          path.join(this.config.roots.gemini, "projects.json"),
          "utf8",
        ),
      );
      for (const [projectPath, identifier] of Object.entries(
        registry.projects || {},
      ))
        if (typeof identifier === "string") add(projectPath, identifier);
    } catch {
      /* Older Gemini versions do not have a registry. */
    }
    try {
      const trusted = JSON.parse(
        await readFile(
          path.join(this.config.roots.gemini, "trustedFolders.json"),
          "utf8",
        ),
      );
      for (const projectPath of Object.keys(trusted)) add(projectPath);
    } catch {
      /* Optional path lookup; never read credentials or auth settings. */
    }
    for (const [identifier, projectPath] of Object.entries(
      this.config.projectPaths,
    ))
      add(projectPath, identifier);
    return result;
  }
  private async discover(
    provider: Provider,
  ): Promise<{ files: FileEntry[]; status: SourceStatus }> {
    const root = this.config.roots[provider];
    const status: SourceStatus = {
      provider,
      root,
      available: await exists(root),
      files: 0,
      sessions: 0,
      errors: 0,
    };
    let files: string[] = [];
    try {
      if (provider === "codex") {
        const sets = await Promise.all(
          ["sessions", "archived_sessions"].map((dir) =>
            walk(path.join(root, dir), (f) => f.endsWith(".jsonl"), 6),
          ),
        );
        files = sets.flat();
      } else if (provider === "claude") {
        files = await walk(
          path.join(root, "projects"),
          (f) => f.endsWith(".jsonl") && !path.basename(f).startsWith("agent-"),
          1,
        );
      } else {
        files = await walk(
          path.join(root, "tmp"),
          (f) =>
            path.basename(path.dirname(f)) === "chats" &&
            /^session-.*\.jsonl?$/.test(path.basename(f)),
          2,
        );
      }
    } catch {
      status.errors++;
    }
    status.files = files.length;
    const entries = await Promise.all(
      files.map(async (filePath) => {
        try {
          const info = await stat(filePath);
          return {
            filePath,
            provider,
            stamp: `${info.mtimeMs}:${info.ctimeMs}:${info.size}`,
            mtime: info.mtime.toISOString(),
          };
        } catch {
          status.errors++;
          return null;
        }
      }),
    );
    return { files: entries.filter((f): f is FileEntry => f !== null), status };
  }
  private async scan(): Promise<void> {
    try {
      const app = await this.appReader.read();
      const known = new Set([
        ...app.paths,
        ...[...this.sessions.values()].flatMap((s) =>
          s.projectPath ? [s.projectPath] : [],
        ),
      ]);
      const neighbors = await this.projectNeighbors(known);
      const discoveries = await Promise.all(
        providers.map((p) => this.discover(p)),
      );
      const seen = new Set<string>();
      const sources = discoveries.map((d) => d.status);
      const codexSource = sources.find((s) => s.provider === "codex")!;
      codexSource.errors += app.errors;
      if (app.sessions.length) codexSource.files++;
      // Codex/Claude cwd values also help resolve older hashed Gemini directories.
      for (const discovery of discoveries) {
        const paths = await this.projectPaths([...app.paths, ...neighbors]);
        const pathStamp = hash(
          JSON.stringify([...paths].sort(([a], [b]) => a.localeCompare(b))),
        );
        // Bound I/O concurrency for installations with thousands of transcript files.
        for (let offset = 0; offset < discovery.files.length; offset += 8) {
          await Promise.all(
            discovery.files.slice(offset, offset + 8).map(async (file) => {
              seen.add(file.filePath);
              const stamp =
                file.stamp +
                (file.provider === "gemini"
                  ? pathStamp
                  : file.provider === "codex"
                    ? JSON.stringify([...app.overrides])
                    : "");
              const cached = this.cache.get(file.filePath);
              if (cached?.stamp === stamp) return;
              try {
                const parser =
                  file.provider === "codex"
                    ? parseCodex
                    : file.provider === "claude"
                      ? parseClaude
                      : parseGemini;
                const session = await parser({
                  ...file,
                  projectPaths: paths,
                  codexProjects: app.overrides,
                });
                this.cache.set(file.filePath, { stamp, session, error: false });
              } catch {
                // Atomic rewrites and partial JSON may be transient. Keep the last valid view and retry.
                this.cache.set(file.filePath, {
                  stamp: "",
                  session: cached?.session || null,
                  error: true,
                });
              }
            }),
          );
        }
        if (discovery.status.provider !== "gemini") {
          for (const file of discovery.files) {
            const s = this.cache.get(file.filePath)?.session;
            if (s) this.sessions.set(s.id, s);
          }
        }
      }
      for (const file of this.cache.keys())
        if (!seen.has(file)) this.cache.delete(file);
      const sessions = new Map<string, Session>(
        app.sessions.map((s) => [s.id, s]),
      );
      for (const [file, entry] of this.cache) {
        const source = sources.find(
          (s) => file === s.root || file.startsWith(s.root + path.sep),
        );
        if (entry.error && source) source.errors++;
        if (!entry.session) continue;
        const previous = sessions.get(entry.session.id);
        // Gemini may retain a legacy JSON beside its migrated JSONL file.
        if (
          !previous ||
          entry.session.updatedAt > previous.updatedAt ||
          (entry.session.updatedAt === previous.updatedAt &&
            file.endsWith(".jsonl"))
        )
          sessions.set(entry.session.id, entry.session);
      }
      // Keep authoritative names after choosing the freshest message body (DB or JSONL).
      for (const [id, session] of sessions) {
        const title =
          session.provider === "codex"
            ? app.titles.get(session.nativeId)
            : undefined;
        if (title) sessions.set(id, { ...session, title });
      }
      this.sessions = sessions;
      const summaries = [...sessions.values()]
        .map(({ messages: _messages, filePath: _file, ...summary }) => summary)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const projects = new Map<string, Project>();
      for (const s of summaries) {
        const project = projects.get(s.projectId);
        if (project) {
          project.count++;
          project.providerCounts[s.provider] =
            (project.providerCounts[s.provider] || 0) + 1;
          if (s.updatedAt > project.updatedAt) project.updatedAt = s.updatedAt;
        } else
          projects.set(s.projectId, {
            id: s.projectId,
            name: s.projectName,
            path: s.projectPath,
            count: 1,
            providerCounts: { [s.provider]: 1 },
            updatedAt: s.updatedAt,
          });
      }
      for (const source of sources)
        source.sessions = summaries.filter(
          (s) => s.provider === source.provider,
        ).length;
      const next = {
        ...this.catalog,
        scanning: false,
        sessions: summaries,
        projects: [...projects.values()].sort((a, b) =>
          b.updatedAt.localeCompare(a.updatedAt),
        ),
        sources,
      };
      // Changes in message text (including streaming replies) must invalidate the reader.
      const fingerprint = hash(
        JSON.stringify([...this.cache].map(([f, c]) => [f, c.stamp, c.error])) +
          JSON.stringify(sources) +
          this.appReader.signature() +
          JSON.stringify([...app.titles]),
      );
      if (fingerprint !== this.fingerprint || this.catalog.scanning) {
        this.fingerprint = fingerprint;
        this.catalog = {
          ...next,
          revision: this.catalog.revision + 1,
          scannedAt: new Date().toISOString(),
        };
        this.emit("change", this.catalog.revision);
      }
    } catch {
      // Keep polling after an unexpected filesystem error instead of crashing the service.
      this.catalog = { ...this.catalog, scanning: false };
      this.emit("scan-error");
    }
  }
  private fingerprint = "";
}
