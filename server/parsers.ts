import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Message, Provider, Session } from "../shared/types.js";
import { providerNames } from "../shared/types.js";

// Provider files are versioned independently. Read only the fields needed for display.
type RecordData = Record<string, any>;
export interface ParseContext {
  filePath: string;
  mtime: string;
  projectPaths?: Map<string, string>;
  codexProjects?: Map<string, string>;
}

export function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
export function sessionTitle(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim())
      return value.replace(/\s+/g, " ").trim();
  }
}
export function normalizeProjectPath(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\"))
    return path.win32.normalize(value).replace(/[\\/]+$/, "") || value;
  if (value.startsWith("/"))
    return path.posix.normalize(value).replace(/\/$/, "") || "/";
  return null;
}
export function projectKey(projectPath: string): string {
  const normalized = normalizeProjectPath(projectPath) || projectPath;
  return /^[A-Za-z]:[\\/]/.test(normalized) || normalized.startsWith("\\\\")
    ? normalized.toLowerCase()
    : normalized;
}
export function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const p = part as RecordData;
      if (
        typeof p.text === "string" &&
        (!p.type || ["text", "input_text", "output_text"].includes(p.type)) &&
        !p.thought
      )
        return p.text;
      if (p.type === "image" || p.type === "input_image" || p.inlineData)
        return "[图片附件]";
      if (p.fileData || p.type === "document") return "[文件附件]";
      return "";
    })
    .filter(Boolean)
    .join("\n");
}
function date(value: unknown, fallback: string): string {
  const timestamp =
    typeof value === "number" ? value * (value < 1e12 ? 1000 : 1) : value;
  const parsed =
    typeof timestamp === "string" || typeof timestamp === "number"
      ? new Date(timestamp)
      : null;
  return parsed && Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : fallback;
}
function isInjectedPrompt(text: string): boolean {
  return /^(?:# AGENTS\.md instructions|<environment_context>|<permissions instructions>|<user_instructions>|<turn_aborted>|<subagent_notification>|<system-reminder>|<local-command-(?:caveat|stdout)>|<command-name>)/.test(
    text.trim(),
  );
}
export function message(
  id: unknown,
  role: Message["role"],
  content: unknown,
  timestamp: unknown,
  fallback: string,
): Message | null {
  const text = contentText(content)
    .replace(
      /<(environment_context|system-reminder|user_instructions)>[\s\S]*?<\/\1>/g,
      "",
    )
    .trim();
  if (!text || (role === "user" && isInjectedPrompt(text))) return null;
  return {
    id: String(id || hash(role + String(timestamp) + text).slice(0, 20)),
    role,
    content: text,
    timestamp: date(timestamp, fallback),
  };
}
export function assemble(
  provider: Provider,
  meta: RecordData,
  messages: Message[],
  ctx: ParseContext,
  unknownProject = "",
): Session | null {
  const users = messages.filter((m) => m.role === "user");
  if (!users.length) return null;
  const nativeId = String(
    meta.id || meta.sessionId || path.basename(ctx.filePath),
  );
  const projectPath = normalizeProjectPath(meta.cwd);
  const projectId = projectPath
    ? hash(projectKey(projectPath)).slice(0, 24)
    : `unknown:${provider}:${unknownProject}`;
  const projectName = projectPath
    ? projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath
    : unknownProject
      ? `未识别项目 · ${providerNames[provider]} · ${unknownProject.slice(0, 8)}`
      : `未识别项目 · ${providerNames[provider]}`;
  const firstText = users[0].content.replace(/\s+/g, " ").trim();
  return {
    id: `${provider}:${hash(nativeId + ":" + projectId).slice(0, 32)}`,
    nativeId,
    provider,
    projectId,
    projectPath,
    projectName,
    title: sessionTitle(meta.name, meta.title) || firstText.slice(0, 100),
    preview: firstText.slice(0, 200),
    createdAt: date(
      meta.startTime || meta.timestamp,
      messages[0]?.timestamp || ctx.mtime,
    ),
    updatedAt: date(meta.lastUpdated, messages.at(-1)?.timestamp || ctx.mtime),
    userCount: users.length,
    assistantCount: messages.length - users.length,
    filePath: ctx.filePath,
    messages,
  };
}

export async function* jsonLines(filePath: string): AsyncGenerator<RecordData> {
  const input = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data && typeof data === "object" && !Array.isArray(data))
          yield data;
      } catch {
        /* A writer may not yet have finished its final line. Retry on next file change. */
      }
    }
  } finally {
    lines.close();
    input.destroy();
  }
}

export async function parseCodex(ctx: ParseContext): Promise<Session | null> {
  let meta: RecordData = {};
  const responses: Message[] = [];
  const events: Message[] = [];
  for await (const row of jsonLines(ctx.filePath)) {
    const p = row.payload || {};
    if (row.type === "session_meta") meta = { ...p, id: p.id || p.session_id };
    if (row.type === "turn_context" && !meta.cwd && p.cwd) meta.cwd = p.cwd;
    if (row.type === "event_msg" && p.type === "user_message") {
      const m = message(p.id, "user", p.message, row.timestamp, ctx.mtime);
      if (m) events.push(m);
    }
    if (
      row.type === "response_item" &&
      p.type === "message" &&
      ["user", "assistant"].includes(p.role)
    ) {
      if (
        p.role === "assistant" &&
        p.channel &&
        !["final", "commentary"].includes(p.channel)
      )
        continue;
      const m = message(p.id, p.role, p.content, row.timestamp, ctx.mtime);
      if (m) responses.push(m);
    }
  }
  // Most Codex versions record each user prompt twice (event + response item).
  // Match occurrences, so legitimately repeated prompts remain separate turns.
  const available = new Map<string, number>();
  for (const m of responses)
    if (m.role === "user")
      available.set(m.content, (available.get(m.content) || 0) + 1);
  for (const m of events) {
    const count = available.get(m.content) || 0;
    if (count) available.set(m.content, count - 1);
    else responses.push(m);
  }
  responses.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const assignedPath = ctx.codexProjects?.get(String(meta.id));
  return assemble(
    "codex",
    assignedPath ? { ...meta, cwd: assignedPath } : meta,
    responses,
    ctx,
  );
}

export async function parseClaude(ctx: ParseContext): Promise<Session | null> {
  let meta: RecordData = {};
  const messages = new Map<string, Message>();
  for await (const row of jsonLines(ctx.filePath)) {
    if (row.cwd && !meta.cwd) meta.cwd = row.cwd;
    if (row.sessionId) meta.id = row.sessionId;
    if (
      row.isSidechain ||
      row.isMeta ||
      row.isCompactSummary ||
      !["user", "assistant"].includes(row.type)
    )
      continue;
    const role = row.message?.role || row.type;
    if (!["user", "assistant"].includes(role)) continue;
    const m = message(
      row.uuid,
      role,
      row.message?.content,
      row.timestamp,
      ctx.mtime,
    );
    if (m) messages.set(m.id, m);
  }
  return assemble("claude", meta, [...messages.values()], ctx);
}

export async function parseGemini(ctx: ParseContext): Promise<Session | null> {
  let meta: RecordData = {};
  let entries = new Map<string, RecordData>();
  const put = (m: RecordData) => {
    if (m && m.id) entries.set(m.id, m);
  };
  if (ctx.filePath.endsWith(".json")) {
    meta = JSON.parse(await readFile(ctx.filePath, "utf8"));
    if (!Array.isArray(meta.messages)) return null;
    meta.messages.forEach(put);
  } else {
    for await (const row of jsonLines(ctx.filePath)) {
      if (row.$rewindTo !== undefined) {
        const keys = [...entries.keys()];
        const index = keys.indexOf(row.$rewindTo);
        if (index < 0) entries.clear();
        else keys.slice(index).forEach((id) => entries.delete(id));
      } else if (row.$patch) {
        const patch = row.$patch;
        for (const update of [patch, ...(patch.updates || [])]) {
          const old = entries.get(update.id);
          if (old && update.content !== undefined)
            entries.set(update.id, { ...old, content: update.content });
        }
        for (const id of patch.removeIds || []) entries.delete(id);
        if (Array.isArray(patch.orderIds)) {
          const order = new Set<string>(patch.orderIds);
          entries = new Map(
            [...entries]
              .filter(([id]) => !order.has(id))
              .concat(
                patch.orderIds.flatMap((id: string) =>
                  entries.has(id)
                    ? [[id, entries.get(id)!] as [string, RecordData]]
                    : [],
                ),
              ),
          );
        }
      } else if (row.$set) {
        if (Array.isArray(row.$set.messages)) {
          entries.clear();
          row.$set.messages.forEach(put);
        }
        meta = { ...meta, ...row.$set };
      } else if (row.sessionId) {
        meta = { ...meta, ...row };
        if (Array.isArray(row.messages)) row.messages.forEach(put);
      } else if (row.id && row.type) put(row);
    }
  }
  if (meta.kind === "subagent") return null;
  const folder = path.basename(path.dirname(path.dirname(ctx.filePath)));
  const projectPath =
    meta.cwd ||
    meta.projectRoot ||
    meta.projectPath ||
    ctx.projectPaths?.get(folder) ||
    ctx.projectPaths?.get(meta.projectHash);
  const fallback = date(meta.startTime, ctx.mtime);
  const messages = [...entries.values()].flatMap((row) => {
    if (!["user", "gemini", "model", "assistant"].includes(row.type)) return [];
    const m = message(
      row.id,
      row.type === "user" ? "user" : "assistant",
      row.displayContent ?? row.content,
      row.timestamp,
      fallback,
    );
    return m ? [m] : [];
  });
  return assemble(
    "gemini",
    { ...meta, cwd: projectPath },
    messages,
    ctx,
    String(meta.projectHash || folder),
  );
}
