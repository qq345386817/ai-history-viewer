import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { appendFile, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fixtures, jsonl, timestamp } from "./fixtures";

test.use({ baseURL: "http://127.0.0.1:14318" });
let f: Awaited<ReturnType<typeof fixtures>>;
let child: ChildProcess;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420" viewBox="0 0 800 420"><defs><linearGradient id="sky" x2="1" y2="1"><stop stop-color="#21364f"/><stop offset="1" stop-color="#456c86"/></linearGradient></defs><rect width="800" height="420" fill="url(#sky)"/><circle cx="625" cy="112" r="50" fill="#f4d89b"/><path d="M0 355L210 125L400 330L540 210L800 420H0" fill="#28443e"/><path d="M0 420L315 238L515 420" fill="#799f8b"/><text x="40" y="60" fill="#fff" font-size="24" font-family="sans-serif">Echo · Image preview</text></svg>`;
test.beforeAll(async () => {
  f = await fixtures();
  await writeFile(path.join(f.dir, "preview.svg"), svg);
  const content = `图片现在可以直接预览。\n\n![本地预览](preview.svg)\n\n[图片文件](preview.svg)\n\n![引用图片][landscape]\n\n[landscape]: preview.svg\n\n[![带链接的图片](preview.svg)](https://example.test/)\n\n![远程图片](https://media.example.test/preview.svg)\n\n![失效图片](missing.png)\n\n![不支持的图片](javascript:alert%281%29)\n\n<img src="https://unexpected.example.test/test.png" onerror="alert(1)">`;
  await writeFile(f.codexFile, jsonl([
    { type: "session_meta", payload: { id: "image-session", cwd: f.dir } },
    { type: "response_item", timestamp, payload: { id: "image-question", type: "message", role: "user", content: [{ type: "input_text", text: "展示图片回归验证" }] } },
    { type: "response_item", timestamp, payload: { id: "markdown-images", type: "message", role: "assistant", content: [{ type: "output_text", text: content }] } },
    { type: "response_item", timestamp, payload: { id: "embedded-image", type: "message", role: "assistant", content: [{ type: "image", source: { type: "base64", media_type: "image/svg+xml", data: Buffer.from(svg).toString("base64") } }] } },
  ]));
  const config = path.join(f.dir, "config.json");
  await writeFile(config, JSON.stringify({ ...f.config, port: 14318 }));
  child = spawn(process.execPath, ["dist-server/server/index.js", "--config", config], { cwd: process.cwd(), env: { ...process.env, ECHO_PORT: "14318" }, stdio: "pipe" });
  let logs = "";
  child.stderr?.on("data", (b) => { logs += b; });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Image fixture server failed: ${logs}`);
    try {
      const response = await fetch("http://127.0.0.1:14318/api/catalog");
      if (response.ok && (await response.json()).sessions.length === 3) return;
    } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Image fixture server did not become ready");
});
test.afterAll(async () => {
  if (child?.exitCode === null) {
    child.kill("SIGTERM");
    await once(child, "exit");
  }
  if (f) await rm(f.dir, { recursive: true, force: true });
});

test("images: local and embedded previews, original image, missing fallback, opt-in remote loading, live updates and mobile dark mode", async ({ page, context }) => {
  const before = await readFile(f.codexFile);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()) && !message.text().includes("404")) errors.push(message.text());
  });
  const externalRequests: string[] = [];
  await context.route("https://**/*", async (route) => {
    externalRequests.push(route.request().url());
    await route.fulfill({ contentType: "image/svg+xml", body: svg });
  });
  await page.goto("/");
  await expect(page).toHaveTitle("回声 Echo · AI 会话历史");
  await expect(page.getByText("展示图片回归验证", { exact: true }).last()).toBeVisible();
  await expect(page.locator(".message-image")).toHaveCount(0);
  await page.getByRole("switch", { name: "显示 AI 回复" }).click();
  await expect(page.locator(".message-image img")).toHaveCount(5);
  for (const img of await page.locator(".message-image img").all()) {
    await img.scrollIntoViewIfNeeded();
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(800);
  }
  await expect(page.locator(".image-unavailable")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "加载远程图片" })).toBeVisible();
  expect(externalRequests).toEqual([]);
  expect(await page.locator(".markdown a a").count()).toBe(0);
  const image = page.getByRole("img", { name: "本地预览", exact: true });
  await image.scrollIntoViewIfNeeded();
  const popupPromise = page.waitForEvent("popup");
  await image.click();
  const popup = await popupPromise;
  await popup.waitForLoadState();
  expect(popup.url()).toContain("/api/media/");
  await expect(popup.locator("svg")).toBeVisible();
  await popup.close();
  await page.screenshot({ path: path.join(tmpdir(), "echo-images-desktop.png"), fullPage: false });
  await page.getByRole("button", { name: "加载远程图片" }).click();
  const remote = page.getByRole("img", { name: "远程图片", exact: true });
  await remote.scrollIntoViewIfNeeded();
  await expect.poll(() => remote.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBe(800);
  expect(externalRequests).toEqual(["https://media.example.test/preview.svg"]);
  // An unrelated SSE update must not remount image renderers or ask again.
  await appendFile(f.codexFile, jsonl([{ type: "event_msg", timestamp: "2026-11-05T08:00:00Z", payload: { type: "user_message", message: "图片展示后的新消息" } }]));
  await expect(page.locator(".messages")).toContainText("图片展示后的新消息", { timeout: 10000 });
  await expect(page.getByRole("button", { name: "加载远程图片" })).toHaveCount(0);
  await expect(remote).toBeVisible();
  expect(externalRequests).toHaveLength(1);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".session-row").filter({ hasText: "展示图片回归验证" }).click();
  await image.scrollIntoViewIfNeeded();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(image).toBeVisible();
  expect(await page.locator("body").evaluate((el) => el.scrollWidth <= innerWidth)).toBe(true);
  for (const img of await page.locator(".message-image img").all()) {
    const box = await img.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: path.join(tmpdir(), "echo-images-mobile-dark.png"), fullPage: false });
  expect(errors).toEqual([]);
  // Only this test's explicit append changes the fixture, never the app.
  expect((await readFile(f.codexFile)).subarray(0, before.length)).toEqual(before);
  expect(await readFile(path.join(f.dir, "preview.svg"), "utf8")).toBe(svg);
});
