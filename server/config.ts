import { homedir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

export interface Config {
  roots: { codex: string; gemini: string; claude: string };
  projectPaths: Record<string, string>;
  pollInterval: number;
  port: number;
}
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));
export const appRoot = existsSync(path.join(sourceRoot, "package.json"))
  ? sourceRoot
  : fileURLToPath(new URL("../../", import.meta.url));

export function expandHome(value: string): string {
  return value === "~"
    ? homedir()
    : value.startsWith("~/") || value.startsWith("~\\")
      ? path.join(homedir(), value.slice(2))
      : path.resolve(value);
}

export async function loadConfig(configFile?: string): Promise<Config> {
  let custom: Partial<Config> = {};
  if (configFile)
    custom = JSON.parse(await readFile(expandHome(configFile), "utf8"));
  const roots = custom.roots || ({} as Config["roots"]);
  const port = Number(process.env.ECHO_PORT || custom.port || 4317);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error("端口必须是 0–65535 的整数");
  return {
    roots: {
      codex: expandHome(
        roots.codex || process.env.CODEX_HOME || path.join(homedir(), ".codex"),
      ),
      gemini: expandHome(
        roots.gemini ||
          path.join(process.env.GEMINI_CLI_HOME || homedir(), ".gemini"),
      ),
      claude: expandHome(
        roots.claude ||
          process.env.CLAUDE_CONFIG_DIR ||
          path.join(homedir(), ".claude"),
      ),
    },
    projectPaths: custom.projectPaths || {},
    pollInterval: Math.max(500, Number(custom.pollInterval) || 2000),
    port,
  };
}
