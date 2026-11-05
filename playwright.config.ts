import { defineConfig } from "@playwright/test";
import { tmpdir } from "node:os";
import path from "node:path";

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  workers: 1,
  timeout: 45000,
  outputDir: path.join(tmpdir(), "echo-history-playwright"),
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:14317",
    viewport: { width: 1536, height: 1024 },
    locale: "zh-CN",
    timezoneId: "Asia/Shanghai",
  },
});
