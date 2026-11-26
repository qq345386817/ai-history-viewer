import { DatabaseSync } from "node:sqlite";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import {
  assemble,
  jsonLines,
  message,
  normalizeProjectPath,
  sessionTitle,
  type ParseContext,
} from "./parsers.js";
import type { StoredMessage as Message, StoredSession as Session } from "./types.js";

type Row = Record<string, any>;

export interface AntigravitySummary {
  conversationId: string;
  title?: string;
  projectPath: string | null;
  isSubagent: boolean;
  lastModifiedTime?: string;
}

export interface AntigravityData {
  summaries: Map<string, AntigravitySummary>;
  paths: Set<string>;
  errors: number;
  signature: string;
}

export function workspaceUriToPath(uri: unknown): string | null {
  if (typeof uri !== "string" || !uri.trim()) return null;
  if (!uri.startsWith("file:")) return normalizeProjectPath(uri);
  try {
    const url = new URL(uri);
    if (url.protocol !== "file:") return null;
    let pathname = decodeURIComponent(url.pathname);
    if (url.hostname && url.hostname.toLowerCase() !== "localhost")
      return normalizeProjectPath(
        `\\\\${url.hostname}${pathname.replaceAll("/", "\\")}`,
      );
    if (/^\/[A-Za-z]:[\\/]/.test(pathname)) pathname = pathname.slice(1);
    return normalizeProjectPath(pathname);
  } catch {
    return null;
  }
}

function parseAntigravityDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.trim().replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T");
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime()) || parsed.getUTCFullYear() < 1971)
    return undefined;
  return parsed.toISOString();
}

function parseAnnotationTitle(text: string): string | undefined {
  const match = /\btitle\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (!match) return undefined;
  try {
    return sessionTitle(JSON.parse(`"${match[1]}"`));
  } catch {
    return sessionTitle(match[1]);
  }
}

function isGeminiModelName(name: string): boolean {
  return /gemini/i.test(name);
}

function extractSelectedModels(content: string): string[] {
  const models: string[] = [];
  for (const block of content.matchAll(
    /<USER_SETTINGS_CHANGE>([\s\S]*?)<\/USER_SETTINGS_CHANGE>/g,
  )) {
    for (const match of block[1].matchAll(
      /Model Selection[`"']?\s+from\s+.+?\s+to\s+([^\n.]+)/gi,
    )) {
      const target = match[1].trim();
      if (target) models.push(target);
    }
  }
  return models;
}

function extractUserText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const stripped = raw
    .replace(
      /<(ADDITIONAL_METADATA|USER_SETTINGS_CHANGE|SYSTEM_MESSAGE)>[\s\S]*?<\/\1>/g,
      "",
    )
    .trim();
  const wrapped = /^<USER_REQUEST>\r?\n?([\s\S]*?)\r?\n?<\/USER_REQUEST>$/.exec(
    stripped,
  );
  return (wrapped ? wrapped[1] : stripped).trim();
}

const imageExtension =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)(?:[?#].*)?$/i;

function buildParts(text: string, media: unknown): unknown {
  const parts: Record<string, unknown>[] = [];
  if (text) parts.push({ type: "text", text });
  if (Array.isArray(media)) {
    for (const item of media) {
      if (!item || typeof item !== "object") continue;
      const m = item as Row;
      const uri = m.uri || m.fileUri || m.file_uri || m.path;
      const mime = m.mime_type || m.mimeType;
      if (typeof mime === "string" && mime.startsWith("image/")) {
        parts.push({ fileData: { mimeType: mime, fileUri: uri } });
      } else if (typeof uri === "string" && imageExtension.test(uri)) {
        parts.push({ type: "localImage", path: uri });
      } else if (uri || mime) {
        parts.push({ type: "document" });
      }
    }
  }
  return parts.length ? parts : text;
}

export async function discoverAntigravityFiles(
  geminiRoot: string,
): Promise<string[]> {
  const brainDir = path.join(geminiRoot, "antigravity", "brain");
  let entries;
  try {
    entries = await readdir(brainDir, { withFileTypes: true });
  } catch (error) {
    if (
      ["ENOENT", "ENOTDIR"].includes(
        (error as NodeJS.ErrnoException).code || "",
      )
    )
      return [];
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isDirectory()) continue;
    const logsDir = path.join(
      brainDir,
      entry.name,
      ".system_generated",
      "logs",
    );
    for (const name of ["transcript_full.jsonl", "transcript.jsonl"]) {
      const candidate = path.join(logsDir, name);
      try {
        if ((await stat(candidate)).isFile()) {
          files.push(candidate);
          break;
        }
      } catch {
        /* Try fallback transcript file or skip non-conversation directories. */
      }
    }
  }
  return files;
}

export class AntigravityReader {
  private lastSignature = "";
  constructor(private geminiRoot: string) {}
  signature(): string {
    return this.lastSignature;
  }
  async read(): Promise<AntigravityData> {
    const summaries = new Map<string, AntigravitySummary>();
    const paths = new Set<string>();
    const projectFolders = new Map<string, string>();
    let errors = 0;

    const addPath = (value: unknown): string | null => {
      const p = workspaceUriToPath(value);
      if (p) paths.add(p);
      return p;
    };

    const projectsDir = path.join(this.geminiRoot, "config", "projects");
    try {
      const entries = await readdir(projectsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isSymbolicLink() ||
          !entry.isFile() ||
          !entry.name.endsWith(".json")
        )
          continue;
        try {
          const data = JSON.parse(
            await readFile(path.join(projectsDir, entry.name), "utf8"),
          ) as Row;
          const resources = data.projectResources?.resources;
          if (Array.isArray(resources)) {
            for (const resource of resources) {
              const p = addPath(resource?.folderUri);
              if (p && typeof data.id === "string" && !projectFolders.has(data.id))
                projectFolders.set(data.id, p);
            }
          }
        } catch {
          errors++;
        }
      }
    } catch (error) {
      if (
        !["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        errors++;
    }

    const antigravityDir = path.join(this.geminiRoot, "antigravity");
    const dbFile = path.join(antigravityDir, "conversation_summaries.db");
    let dbExists = false;
    try {
      dbExists = (await stat(dbFile)).isFile();
    } catch {
      dbExists = false;
    }

    if (dbExists) {
      let db: DatabaseSync | undefined;
      try {
        db = new DatabaseSync(dbFile, { readOnly: true });
        const hasSummaries = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_summaries'",
          )
          .get();
        const parentIds = new Set<string>();
        const hasParents = db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_parents'",
          )
          .get();
        if (hasParents) {
          for (const row of db
            .prepare("SELECT conversation_id FROM conversation_parents")
            .all() as Row[]) {
            if (typeof row.conversation_id === "string")
              parentIds.add(row.conversation_id);
          }
        }
        if (hasSummaries) {
          const cols = new Set(
            (
              db
                .prepare("PRAGMA table_info(conversation_summaries)")
                .all() as Row[]
            ).map((r) => r.name),
          );
          if (cols.has("conversation_id")) {
            const fields = [
              "conversation_id",
              "title",
              "workspace_uris",
              "project_id",
              "parent_conversation_id",
              "nesting_depth",
              "last_modified_time",
            ].filter((c) => cols.has(c));
            const rows = db
              .prepare(`SELECT ${fields.join(",")} FROM conversation_summaries`)
              .all() as Row[];
            for (const row of rows) {
              if (typeof row.conversation_id !== "string" || !row.conversation_id)
                continue;
              let projectPath: string | null = null;
              if (typeof row.workspace_uris === "string" && row.workspace_uris) {
                try {
                  const uris = JSON.parse(row.workspace_uris);
                  if (Array.isArray(uris)) {
                    for (const uri of uris) {
                      const p = addPath(uri);
                      if (p && !projectPath) projectPath = p;
                    }
                  }
                } catch {
                  /* Ignore malformed workspace URI lists. */
                }
              }
              if (!projectPath && typeof row.project_id === "string")
                projectPath = projectFolders.get(row.project_id) || null;
              const isSubagent =
                Boolean(
                  typeof row.parent_conversation_id === "string" &&
                    row.parent_conversation_id.trim(),
                ) ||
                Number(row.nesting_depth || 0) > 0 ||
                parentIds.has(row.conversation_id);
              summaries.set(row.conversation_id, {
                conversationId: row.conversation_id,
                title: sessionTitle(row.title),
                projectPath,
                isSubagent,
                lastModifiedTime: parseAntigravityDate(row.last_modified_time),
              });
            }
          }
        }
      } catch {
        errors++;
      } finally {
        db?.close();
      }
    }

    const annotationsDir = path.join(antigravityDir, "annotations");
    try {
      const entries = await readdir(annotationsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (
          entry.isSymbolicLink() ||
          !entry.isFile() ||
          !entry.name.endsWith(".pbtxt")
        )
          continue;
        const id = entry.name.slice(0, -".pbtxt".length);
        if (!id) continue;
        const existing = summaries.get(id);
        if (existing?.title) continue;
        try {
          const title = parseAnnotationTitle(
            await readFile(path.join(annotationsDir, entry.name), "utf8"),
          );
          if (title) {
            if (existing) existing.title = title;
            else
              summaries.set(id, {
                conversationId: id,
                title,
                projectPath: null,
                isSubagent: false,
              });
          }
        } catch {
          errors++;
        }
      }
    } catch (error) {
      if (
        !["ENOENT", "ENOTDIR"].includes(
          (error as NodeJS.ErrnoException).code || "",
        )
      )
        errors++;
    }

    this.lastSignature = JSON.stringify(
      [...summaries.values()]
        .sort((a, b) => a.conversationId.localeCompare(b.conversationId))
        .map((s) => [
          s.conversationId,
          s.title || "",
          s.projectPath || "",
          s.isSubagent ? 1 : 0,
          s.lastModifiedTime || "",
        ]),
    );
    return { summaries, paths, errors, signature: this.lastSignature };
  }
}

export function antigravityConversationId(filePath: string): string {
  // <geminiRoot>/antigravity/brain/<conversationId>/.system_generated/logs/transcript[_full].jsonl
  return path.basename(path.dirname(path.dirname(path.dirname(filePath))));
}

export async function parseAntigravity(
  ctx: ParseContext & { antigravitySummary?: AntigravitySummary },
): Promise<Session | null> {
  const conversationId = antigravityConversationId(ctx.filePath);
  const summary = ctx.antigravitySummary;
  if (summary?.isSubagent) return null;

  const steps = new Map<number, Row>();
  let syntheticIndex = 1_000_000;
  for await (const row of jsonLines(ctx.filePath)) {
    const idx =
      typeof row.step_index === "number" && Number.isFinite(row.step_index)
        ? row.step_index
        : syntheticIndex++;
    steps.set(idx, row);
  }
  const ordered = [...steps.entries()]
    .sort(([a], [b]) => a - b)
    .map(([idx, row]) => ({ idx, row }));

  const models: string[] = [];
  const selectedModels: string[] = [];
  const messages: Message[] = [];

  for (const { idx, row } of ordered) {
    if (typeof row.model === "string" && row.model.trim())
      models.push(row.model.trim());

    if (row.type === "USER_INPUT") {
      if (typeof row.content === "string")
        selectedModels.push(...extractSelectedModels(row.content));
      const text = extractUserText(row.content);
      const m = message(
        `step-${idx}`,
        "user",
        buildParts(text, row.media),
        row.created_at,
        ctx.mtime,
      );
      if (m) messages.push(m);
    } else if (
      row.type === "PLANNER_RESPONSE" ||
      row.type === "NOTIFY_USER"
    ) {
      const text = typeof row.content === "string" ? row.content.trim() : "";
      if (!text && !Array.isArray(row.media)) continue;
      const m = message(
        `step-${idx}`,
        "assistant",
        buildParts(text, row.media),
        row.created_at,
        ctx.mtime,
      );
      if (m) messages.push(m);
    }
  }

  if (models.length > 0) {
    if (!models.some(isGeminiModelName)) return null;
  } else if (selectedModels.length > 0) {
    if (!selectedModels.some(isGeminiModelName)) return null;
  }

  const projectPath =
    summary?.projectPath || ctx.projectPaths?.get(conversationId) || null;
  const lastMessageTime = messages.at(-1)?.timestamp;
  const lastUpdated =
    summary?.lastModifiedTime &&
    (!lastMessageTime || summary.lastModifiedTime > lastMessageTime)
      ? summary.lastModifiedTime
      : lastMessageTime;

  return assemble(
    "gemini",
    {
      id: conversationId,
      title: summary?.title,
      cwd: projectPath,
      startTime: messages[0]?.timestamp,
      lastUpdated,
    },
    messages,
    ctx,
  );
}
