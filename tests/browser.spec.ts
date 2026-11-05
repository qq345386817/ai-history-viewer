import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fixtures, jsonl } from "./fixtures";

let f: Awaited<ReturnType<typeof fixtures>>;
let child: ChildProcess;
test.beforeAll(async () => {
  f = await fixtures();
  const configFile = path.join(f.dir, "config.json");
  await writeFile(configFile, JSON.stringify({ ...f.config, port: 14317 }));
  child = spawn(
    process.execPath,
    ["dist-server/server/index.js", "--config", configFile],
    {
      cwd: process.cwd(),
      env: { ...process.env, ECHO_PORT: "14317" },
      stdio: "pipe",
    },
  );
  let logs = "";
  child.stderr?.on("data", (b) => {
    logs += b;
  });
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`Server failed: ${logs}`);
    try {
      const response = await fetch("http://127.0.0.1:14317/api/catalog");
      if (response.ok && (await response.json()).sessions.length === 3) return;
    } catch {
      /* starting */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("Fixture server did not become ready");
});
test.afterAll(async () => {
  child?.kill("SIGTERM");
  if (f) await rm(f.dir, { recursive: true, force: true });
});

test("desktop: project grouping, tool filter, search, reply switch, source dialog and read-only rendering", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type()))
      errors.push(message.text());
  });
  const sourcesBefore = await Promise.all(
    [f.codexFile, f.geminiFile, f.claudeFile].map((file) => readFile(file)),
  );
  await page.goto("/");
  await expect(page).toHaveTitle("回声 Echo · AI 会话历史");
  await expect(
    page.getByRole("heading", { name: "会话历史", exact: true }),
  ).toBeVisible();
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await expect(page.locator(".message.user")).toHaveCount(4);
  await expect(page.locator(".message.assistant")).toHaveCount(0);
  await expect(
    page.getByRole("switch", { name: "显示 AI 回复" }),
  ).toHaveAttribute("aria-checked", "false");
  await page.screenshot({
    path: path.join(tmpdir(), "echo-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("switch", { name: "显示 AI 回复" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(4);
  await page.getByRole("switch", { name: "显示 AI 回复" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(0);
  await page.getByRole("button", { name: /atlas-web/ }).click();
  await expect(page.locator(".session-row")).toHaveCount(2);
  await page.getByLabel("筛选 AI 工具").selectOption("claude");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".reader-header h2")).toHaveText(
    "排查 API 请求超时",
  );
  await page.getByLabel("筛选 AI 工具").selectOption("all");
  await page.getByRole("button", { name: /全部项目/ }).click();
  await page.getByRole("textbox", { name: "搜索会话" }).fill("键盘操作");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "搜索会话" })
    .fill("does-not-exist-827");
  await expect(
    page.getByRole("heading", { name: "没有匹配的会话" }),
  ).toBeVisible();
  await page.getByRole("textbox", { name: "搜索会话" }).fill("reducer");
  await expect(page.locator(".session-row")).toHaveCount(0);
  await page.getByRole("switch", { name: "显示 AI 回复" }).click();
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".message.assistant")).toHaveCount(4);
  await page.getByRole("switch", { name: "显示 AI 回复" }).click();
  await expect(page.locator(".session-row")).toHaveCount(0);
  await page.getByRole("button", { name: "清空搜索" }).click();
  await expect(page.locator(".session-row")).toHaveCount(3);
  await page.getByRole("button", { name: "数据源", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Gemini CLI", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await page.getByLabel("会话排序").selectOption("oldest");
  await expect(page.locator(".session-row").first()).toContainText(
    "排查 API 请求超时",
  );
  await page.getByLabel("会话排序").selectOption("updated");
  await page.locator(".session-row").first().click();
  await expect(page.locator(".reader-header h2")).toContainText(
    "帮我检查一下登录页面",
  );
  await page.getByRole("button", { name: "刷新会话" }).click();
  await expect(page.locator(".message.user")).toHaveCount(4);
  expect(errors).toEqual([]);
  expect(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth),
  ).toBe(true);
  expect(await page.locator('[contenteditable="true"], textarea').count()).toBe(
    0,
  );
  expect(
    await Promise.all(
      [f.codexFile, f.geminiFile, f.claudeFile].map((file) => readFile(file)),
    ),
  ).toEqual(sourcesBefore);
});

test("live updates: existing reader gets appended prompts and newly created sessions appear automatically", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.locator(".message.user")).toHaveCount(4);
  await appendFile(
    f.codexFile,
    jsonl([
      {
        type: "event_msg",
        timestamp: "2026-11-04T07:00:00Z",
        payload: {
          type: "user_message",
          message: "自动刷新验证：新追加的提问",
        },
      },
    ]),
  );
  await expect(
    page.getByText("自动刷新验证：新追加的提问", { exact: true }),
  ).toBeVisible({ timeout: 10000 });
  await expect(page.locator(".message.user")).toHaveCount(5);
  const newFile = path.join(
    path.dirname(f.codexFile),
    "rollout-brand-new.jsonl",
  );
  await writeFile(
    newFile,
    jsonl([
      {
        type: "session_meta",
        payload: { id: "brand-new", cwd: "/Projects/new-project" },
      },
      {
        type: "event_msg",
        timestamp: "2026-11-04T08:00:00Z",
        payload: { type: "user_message", message: "自动发现全新会话" },
      },
    ]),
  );
  await expect(page.locator(".session-row")).toHaveCount(4, { timeout: 10000 });
  await expect(page.locator(".messages")).toContainText(
    "自动刷新验证：新追加的提问",
  );
  await page
    .locator(".session-row")
    .filter({ hasText: "自动发现全新会话" })
    .click();
  await expect(page.locator(".messages")).toContainText("自动发现全新会话");
  await rm(newFile);
  await expect(page.locator(".session-row")).toHaveCount(3, { timeout: 10000 });
});

test("mobile: list → reader → back, project drawer and no horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "会话历史", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "打开项目导航" }).click();
  await expect(
    page.getByRole("button", { name: /design-system/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /design-system/ }).click();
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").click();
  await expect(page.locator(".reader-header h2")).toHaveText(
    "梳理组件库的设计规范",
  );
  await page.getByRole("switch", { name: "显示 AI 回复" }).click();
  await expect(page.locator(".message.assistant")).toHaveCount(1);
  await expect(page.locator(".reader .toggle-track")).toHaveCSS(
    "background-color",
    "rgb(19, 133, 98)",
  );
  await page.screenshot({
    path: path.join(tmpdir(), "echo-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await page
      .locator("body")
      .evaluate((el) => el.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "返回会话列表" }).click();
  await expect(
    page.getByRole("heading", { name: "会话历史", exact: true }),
  ).toBeVisible();
});

test("copy user and AI messages preserves the original Markdown and reports clipboard errors", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await page
    .locator(".session-row")
    .filter({ hasText: "帮我检查一下登录页面" })
    .click();
  const catalog = await (await page.request.get("/api/catalog")).json();
  const id = catalog.sessions.find((s: any) => s.nativeId === "atlas-codex").id;
  const detail = await (
    await page.request.get(`/api/sessions/${id}?includeAssistant=true`)
  ).json();
  const expected = detail.messages.filter((m: any) => m.role === "user")[1]
    .content;
  const copy = page
    .locator(".message.user")
    .nth(1)
    .getByRole("button", { name: "复制消息内容" });
  await copy.click();
  await expect(copy).toHaveText("已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    expected,
  );
  expect(expected).toContain("```tsx");
  await page.getByRole("switch", { name: "显示 AI 回复" }).click();
  const aiCopy = page
    .locator(".message.assistant")
    .first()
    .getByRole("button", { name: "复制消息内容" });
  await aiCopy.click();
  await expect(aiCopy).toHaveText("已复制");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    detail.messages.find((m: any) => m.role === "assistant").content,
  );
  await page.evaluate(() =>
    Object.defineProperty(navigator.clipboard, "writeText", {
      configurable: true,
      value: () => Promise.reject(new Error("denied")),
    }),
  );
  await copy.click();
  await expect(copy).toHaveText("复制失败");
});

test("source multi-select filters project counts; global search crosses the selected project and scrolls to the first match", async ({
  page,
}) => {
  const needle = "唯一定位词[ABC].*";
  const files = ["one", "two"].map((id) =>
    path.join(path.dirname(f.codexFile), `search-${id}.jsonl`),
  );
  const filler = Array.from(
    { length: 25 },
    (_, i) => `段落 ${i}：这是一段用于验证长会话精确滚动位置的文字。`,
  ).join("\n\n");
  await Promise.all(
    files.map((file, i) =>
      writeFile(
        file,
        jsonl([
          {
            type: "session_meta",
            payload: { id: `search-${i}`, cwd: "/Projects/search-target" },
          },
          {
            type: "event_msg",
            timestamp: `2026-11-05T01:0${i}:00Z`,
            payload: {
              type: "user_message",
              message: `搜索测试会话 ${i}\n\n${filler}`,
            },
          },
          {
            type: "event_msg",
            timestamp: `2026-11-05T02:0${i}:00Z`,
            payload: {
              type: "user_message",
              message: `${filler}\n\n\`\`\`text\n${needle}\n\`\`\`\n\n后面再次出现：${needle}`,
            },
          },
        ]),
      ),
    ),
  );
  try {
    await page.goto("/");
    await expect(page.locator(".session-row")).toHaveCount(5, {
      timeout: 10000,
    });
    await page
      .getByRole("button", { name: "筛选 Gemini", exact: true })
      .click();
    await page
      .getByRole("button", { name: "筛选 Claude", exact: true })
      .click();
    await expect(page.getByLabel("筛选 AI 工具")).toHaveValue("codex");
    await expect(page.locator(".projects .project-copy")).toHaveCount(2);
    await expect(page.locator(".projects")).not.toContainText("design-system");
    await expect(page.getByRole("button", { name: /全部项目/ })).toContainText(
      "3",
    );
    await page.getByRole("button", { name: "筛选 Codex", exact: true }).click();
    await expect(page.locator(".session-row")).toHaveCount(0);
    await expect(page.locator(".projects .project-copy")).toHaveCount(0);
    await page
      .getByRole("button", { name: "筛选 Gemini", exact: true })
      .click();
    await expect(page.locator(".projects .project-copy")).toHaveCount(1);
    await expect(page.locator(".projects")).toContainText("design-system");
    await page.getByRole("button", { name: "筛选 Codex", exact: true }).click();
    await expect(page.locator(".projects .project-copy")).toHaveCount(3);
    await page.getByRole("button", { name: /design-system/ }).click();
    await expect(page.locator(".session-row")).toHaveCount(1);
    await page.route("**/api/sessions/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 250));
      await route.continue();
    });
    await page.getByRole("textbox", { name: "搜索会话" }).fill(needle);
    await expect(page.locator(".session-row")).toHaveCount(2);
    for (const row of [
      page.locator(".session-row").last(),
      page.locator(".session-row").first(),
    ]) {
      await row.click();
      await expect(page.locator(".messages mark").first()).toBeInViewport();
      await expect(page.locator(".messages mark")).toHaveCount(2);
      await expect
        .poll(() => page.locator(".messages").evaluate((el) => el.scrollTop))
        .toBeGreaterThan(500);
    }
    await page.locator(".messages").evaluate((el) => el.scrollTo({ top: 0 }));
    await page.locator(".session-row").first().click();
    await expect(page.locator(".messages mark").first()).toBeInViewport();
    await page.screenshot({
      path: path.join(tmpdir(), "echo-search-match.png"),
      animations: "disabled",
    });
    await page.getByRole("textbox", { name: "搜索会话" }).fill("search-target");
    await expect(page.locator(".messages mark")).toHaveCount(0);
    await expect
      .poll(() => page.locator(".messages").evaluate((el) => el.scrollTop))
      .toBe(0);
  } finally {
    await Promise.all(files.map((file) => rm(file, { force: true })));
  }
});

test('Codex display names appear in list/header and refresh after metadata-only renames', async ({ page }) => {
  const index = path.join(f.config.roots.codex, 'session_index.jsonl');
  try {
    await writeFile(index, JSON.stringify({ id: 'atlas-codex', thread_name: '登录流程梳理' }) + '\n');
    await page.goto('/');
    const row = page.locator('.session-row').filter({hasText: '登录流程梳理'});
    await expect(row).toBeVisible({timeout:10000}); await row.click();
    await expect(page.locator('.reader-header h2')).toHaveText('登录流程梳理');
    await expect(page.locator('.message.user').first()).toContainText('帮我检查一下登录页面');
    await writeFile(index, JSON.stringify({ id: 'atlas-codex', thread_name: '登录体验检查' }) + '\n');
    await expect(page.locator('.reader-header h2')).toHaveText('登录体验检查', {timeout:10000});
    await page.getByRole('textbox', {name:'搜索会话'}).fill('登录体验检查');
    await expect(page.locator('.session-row')).toHaveCount(1);
    await expect(page.locator('.session-row strong')).toHaveText('登录体验检查');
  } finally { await rm(index, {force:true}); }
});
