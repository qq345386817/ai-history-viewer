import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Root, RootContent } from "mdast";
import type { Message } from "../shared/types.js";
import type { StoredMessage, StoredSession } from "./types.js";

const parser = unified().use(remarkParse).use(remarkGfm);
const cache = new WeakMap<StoredMessage, Map<string, string>>();
const imageExtension = /\.(?:png|jpe?g|gif|webp|avif|svg|ico|bmp)(?:[?#].*)?$/i;
const maxBytes = 32 * 1024 * 1024;
export const mediaId = (source: string) => createHash("sha256").update(source).digest("hex").slice(0, 32);

// Parse Markdown rather than matching text inside code fences or guessing paths.
export function imageSources(message: StoredMessage): Map<string, string> {
  const cached = cache.get(message);
  if (cached) return cached;
  const sources = new Map<string, string>();
  if (!message.content.includes("[")) {
    cache.set(message, sources);
    return sources;
  }
  const tree = parser.parse(message.content);
  const definitions = new Map<string, string>();
  const visit = (node: Root | RootContent, callback: (node: Root | RootContent) => void) => {
    callback(node);
    if ("children" in node)
      for (const child of node.children) visit(child, callback);
  };
  visit(tree, (node) => {
    if (node.type === "definition") definitions.set(node.identifier.toUpperCase(), node.url);
  });
  visit(tree, (node) => {
    const reference = node.type === "imageReference" || node.type === "linkReference";
    const url = reference ? definitions.get(node.identifier.toUpperCase()) : "url" in node ? node.url : undefined;
    if (typeof url !== "string") return;
    if (node.type === "image" || node.type === "imageReference" ||
      ((node.type === "link" || node.type === "linkReference") && imageExtension.test(url)))
      sources.set(url, message.imageSources && Object.hasOwn(message.imageSources, url) ? message.imageSources[url] : url);
  });
  cache.set(message, sources);
  return sources;
}

function remoteUrl(source: string): string | null {
  try {
    const url = new URL(source.startsWith("//") ? `https:${source}` : source);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
function localPath(source: string, session: StoredSession): string | null {
  try {
    let value = source;
    if (value.startsWith("file:")) value = fileURLToPath(value);
    else {
      if (value.startsWith("sandbox:")) value = value.slice("sandbox:".length);
      value = decodeURIComponent(value.split(/[?#]/, 1)[0]);
    }
    if (!value || value.includes("\0") || /^[a-z][a-z\d+.-]*:/i.test(value) && !/^[a-z]:[\\/]/i.test(value)) return null;
    if (value.startsWith("~/")) value = path.join(homedir(), value.slice(2));
    if (!path.isAbsolute(value) && !session.projectPath) return null;
    return path.resolve(session.projectPath || path.dirname(session.filePath), value);
  } catch { return null; }
}

export function publicMessage(session: StoredSession, message: StoredMessage): Message {
  const media: NonNullable<Message["media"]> = Object.create(null);
  for (const [key, source] of imageSources(message)) {
    const remote = remoteUrl(source);
    const supported = remote || /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|bmp);base64,/i.test(source) ||
      (imageExtension.test(source) && localPath(source, session));
    media[key] = {
      url: remote || (supported ? `/api/media/${encodeURIComponent(session.id)}/${encodeURIComponent(message.id)}/${mediaId(source)}${message.role === "assistant" ? "?includeAssistant=true" : ""}` : null),
      remote: Boolean(remote),
    };
  }
  return { id: message.id, role: message.role, content: message.content, timestamp: message.timestamp,
    ...(Object.keys(media).length ? { media } : {}) };
}

function imageMime(data: Buffer): string | null {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return "image/jpeg";
  if (/^GIF8[79]a/.test(data.toString("ascii", 0, 6))) return "image/gif";
  if (data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (data.toString("ascii", 4, 8) === "ftyp" && /avif|avis/.test(data.toString("ascii", 8, 32))) return "image/avif";
  if (data[0] === 0 && data[1] === 0 && data[2] === 1 && data[3] === 0) return "image/x-icon";
  if (data.toString("ascii", 0, 2) === "BM") return "image/bmp";
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(data.toString("utf8", 0, Math.min(data.length, 4096)))) return "image/svg+xml";
  return null;
}

export async function readImage(session: StoredSession, message: StoredMessage, id: string) {
  const source = [...imageSources(message).values()].find((s) => mediaId(s) === id);
  if (!source || remoteUrl(source)) return null;
  let data: Buffer;
  if (source.startsWith("data:")) {
    const match = /^data:image\/(?:png|jpeg|gif|webp|avif|svg\+xml|x-icon|bmp);base64,([a-z\d+/=\s]+)$/i.exec(source);
    if (!match || match[1].length > maxBytes * 4 / 3 + 8) return null;
    data = Buffer.from(match[1], "base64");
  } else {
    const file = localPath(source, session);
    if (!file || !imageExtension.test(file)) return null;
    let handle;
    try {
      const resolved = await realpath(file);
      if (!imageExtension.test(resolved)) return null;
      handle = await open(resolved, "r");
      const info = await handle.stat();
      if (!info.isFile() || info.size > maxBytes) return null;
      data = await handle.readFile();
    } catch { return null; }
    finally { await handle?.close(); }
  }
  if (data.length > maxBytes) return null;
  const mime = imageMime(data);
  return mime ? { data, mime } : null;
}
