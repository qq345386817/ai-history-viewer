import { DatabaseSync } from "node:sqlite";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  assemble,
  message,
  normalizeProjectPath,
  sessionTitle,
  jsonLines,
} from "./parsers.js";
import type { Message, Session } from "../shared/types.js";

type Row = Record<string, any>;
export class CodexAppReader {
  private cache = new Map<string, { stamp: string; session: Session | null }>();
  constructor(private root: string) {}
  signature(): string {
    return JSON.stringify(
      [...this.cache].map(([id, value]) => [id, value.stamp]),
    );
  }
  async read() {
    const paths = new Set<string>();
    const overrides = new Map<string, string>();
    const sessions: Session[] = [];
    const titles = new Map<string, string>();
    let errors = 0;
    let global: Row = {};
    try {
      // The CLI/App index can carry renamed threads even when no database is present.
      for await (const row of jsonLines(
        path.join(this.root, "session_index.jsonl"),
      )) {
        if (typeof row.id !== "string") continue;
        const title = sessionTitle(row.thread_name);
        if (title) titles.set(row.id, title);
        else titles.delete(row.id);
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") errors++;
    }
    const add = (value: unknown) => {
      const p = normalizeProjectPath(value);
      if (p) paths.add(p);
    };
    try {
      global = JSON.parse(
        await readFile(
          path.join(this.root, ".codex-global-state.json"),
          "utf8",
        ),
      );
      for (const p of global["electron-saved-workspace-roots"] || []) add(p);
      for (const project of Object.values(
        global["local-projects"] || {},
      ) as Row[])
        for (const p of project.rootPaths || []) add(p);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") errors++;
    }
    const assignedRoot = (
      roots: unknown[],
      cwd: unknown,
    ): string | undefined => {
      const valid = roots
        .map(normalizeProjectPath)
        .filter((p): p is string => !!p);
      if (valid.length === 1) return valid[0];
      const matching = valid.filter(
        (p) =>
          typeof cwd === "string" &&
          (cwd === p || cwd.startsWith(p + (p.includes("\\") ? "\\" : "/"))),
      );
      return matching.sort((a, b) => b.length - a.length)[0];
    };
    for (const [id, assignment] of Object.entries(
      global["thread-project-assignments"] || {},
    ) as [string, Row][]) {
      const p = assignedRoot(
        global["local-projects"]?.[assignment.projectId]?.rootPaths || [],
        undefined,
      );
      if (p) overrides.set(id, p);
    }
    let files: string[] = [];
    try {
      files = await readdir(this.root);
    } catch {
      return { paths, overrides, sessions, titles, errors };
    }
    const stateFile = files
      .filter((f) => /^state_\d+\.sqlite$/.test(f))
      .sort(
        (a, b) => Number(b.match(/\d+/)?.[0]) - Number(a.match(/\d+/)?.[0]),
      )[0];
    if (!stateFile) return { paths, overrides, sessions, titles, errors };
    let db: DatabaseSync | undefined;
    let history: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(path.join(this.root, stateFile), {
        readOnly: true,
      });
      const cols = new Set(
        (db.prepare("PRAGMA table_info(threads)").all() as Row[]).map(
          (r) => r.name,
        ),
      );
      if (!cols.has("id") || !cols.has("cwd"))
        return { paths, overrides, sessions, titles, errors: errors + 1 };
      const fields = [
        "id",
        "cwd",
        "project_id",
        "rollout_path",
        "name",
        "title",
        "created_at",
        "updated_at",
        "created_at_ms",
        "updated_at_ms",
      ].filter((c) => cols.has(c));
      const threads = db
        .prepare(`SELECT ${fields.join(",")} FROM threads`)
        .all() as Row[];
      for (const row of threads) {
        const title = sessionTitle(row.name, row.title);
        if (title) titles.set(row.id, title);
      }
      const projectRoots = new Map<string, string[]>();
      const hasRoots = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='project_roots'",
        )
        .get();
      if (hasRoots)
        for (const row of db
          .prepare(
            "SELECT project_id, path FROM project_roots ORDER BY position",
          )
          .all() as Row[]) {
          add(row.path);
          const roots = projectRoots.get(row.project_id) || [];
          roots.push(row.path);
          projectRoots.set(row.project_id, roots);
        }
      const historyFile = path.join(this.root, "thread_history_1.sqlite");
      const historyExists = files.includes("thread_history_1.sqlite");
      const projections = new Map<string, string>();
      let historyStamp = "";
      if (historyExists) {
        history = new DatabaseSync(historyFile, { readOnly: true });
        for (const f of [historyFile, historyFile + "-wal"]) {
          try {
            const s = await stat(f);
            historyStamp += `${s.mtimeMs}:${s.size}`;
          } catch {}
        }
        if (
          history
            .prepare(
              "SELECT name FROM sqlite_master WHERE name='thread_history_projection_state'",
            )
            .get()
        ) {
          for (const row of history
            .prepare("SELECT * FROM thread_history_projection_state")
            .all() as Row[])
            projections.set(row.thread_id, JSON.stringify(row));
        }
      }
      const getItems = history?.prepare(
        "SELECT item_json, created_at_ms FROM thread_items WHERE thread_id=? AND item_type IN ('userMessage','agentMessage') ORDER BY rollout_ordinal, created_at_ms, item_id",
      );
      for (const row of threads) {
        add(row.cwd);
        const legacy = global["thread-project-assignments"]?.[row.id];
        const legacyRoots =
          global["local-projects"]?.[legacy?.projectId]?.rootPaths || [];
        const projectPath =
          assignedRoot(projectRoots.get(row.project_id) || [], row.cwd) ||
          assignedRoot(legacyRoots, row.cwd) ||
          normalizeProjectPath(row.cwd);
        if (projectPath) {
          add(projectPath);
          overrides.set(row.id, projectPath);
        }
        if (!getItems) continue;
        const stamp = JSON.stringify([
          row,
          projectPath,
          projections.get(row.id) || historyStamp,
        ]);
        let cached = this.cache.get(row.id);
        if (cached?.stamp !== stamp) {
          const fallback = new Date(
            row.created_at_ms ?? (row.created_at || 0) * 1000,
          ).toISOString();
          const messages: Message[] = [];
          for (const item of getItems.all(row.id) as Row[]) {
            try {
              const data = JSON.parse(item.item_json);
              if (
                data.type === "agentMessage" &&
                data.phase &&
                !["final_answer", "commentary", "final"].includes(data.phase)
              )
                continue;
              const m = message(
                data.id,
                data.type === "userMessage" ? "user" : "assistant",
                data.type === "userMessage" ? data.content : data.text,
                item.created_at_ms,
                fallback,
              );
              if (m) messages.push(m);
            } catch {
              /* Unsupported items never become user messages. */
            }
          }
          const session = assemble(
            "codex",
            {
              id: row.id,
              name: row.name,
              title: row.title,
              cwd: projectPath,
              timestamp: row.created_at_ms ?? row.created_at,
              lastUpdated: row.updated_at_ms ?? row.updated_at,
            },
            messages,
            { filePath: historyFile, mtime: fallback },
          );
          cached = { stamp, session };
          this.cache.set(row.id, cached);
        }
        if (cached?.session) sessions.push(cached.session);
      }
      const ids = new Set(threads.map((t) => t.id));
      for (const id of this.cache.keys())
        if (!ids.has(id)) this.cache.delete(id);
    } catch {
      errors++;
    } finally {
      history?.close();
      db?.close();
    }
    return { paths, overrides, sessions, titles, errors };
  }
}
