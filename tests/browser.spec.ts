import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { appendFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fixtures, jsonl } from "./fixtures";

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "设置", exact: true })).toBeVisible();
}

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

test("Codex question replies render together, remain searchable, and fit mobile dark mode", async ({ page, context }) => {
  const file = path.join(path.dirname(f.codexFile), "rollout-question-replies.jsonl");
  const question = "请选择备份方式";
  const answer = "仅保存到本机";
  const payload = JSON.stringify([
    { question, answer, questionItemId: "internal-question-id" },
    { question: "补充说明", answer: "第一行\n第二行 <保留原文>" },
  ]);
  const source = jsonl([
    { type: "session_meta", payload: { id: "qa-session", cwd: "/Projects/qa-reader" } },
    {
      type: "response_item",
      timestamp: "2026-11-08T01:00:00Z",
      payload: {
        id: "qa-reply",
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: `<send_user_message_question_reply>${payload}</send_user_message_question_reply>` }],
      },
    },
  ]);
  await writeFile(file, source);
  try {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/");
    await expect(page).toHaveTitle("回声 Echo · AI 会话历史");
    const search = page.getByRole("textbox", { name: "搜索会话" });
    await search.fill(answer);
    const row = page.locator(".session-row").filter({ hasText: question });
    await expect(row).toHaveCount(1);
    await row.click();
    const record = page.locator('[data-message-id="qa-reply"]');
    const cards = record.locator(".question-reply");
    await expect(cards).toHaveCount(2);
    await expect(cards.first().locator("dt")).toHaveText(["AI 提问", "你的回答"]);
    await expect(cards.first().locator(".question-reply-question")).toHaveText(question);
    await expect(cards.first().locator("mark[data-search-match]")).toHaveText(answer);
    await expect(cards.last()).toContainText("第二行 <保留原文>");
    await expect(record.locator("time")).toHaveText("2026-11-08 09:00");
    await expect(record).not.toContainText("internal-question-id");
    await expect(record).not.toContainText("send_user_message_question_reply");
    await record.getByRole("button", { name: "复制消息内容", exact: true }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
      `问题：${question}\n你的回答：${answer}\n\n问题：补充说明\n你的回答：第一行\n第二行 <保留原文>`,
    );
    await page.screenshot({ path: path.join(tmpdir(), "echo-question-replies-desktop.png") });

    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(cards.first()).toBeInViewport();
    expect(await record.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator("vite-error-overlay")).toHaveCount(0);
    await page.screenshot({ path: path.join(tmpdir(), "echo-question-replies-mobile-dark.png") });
    expect(errors).toEqual([]);
    expect(await readFile(file, "utf8")).toBe(source);
  } finally {
    await rm(file, { force: true });
    // The shared fixture catalog must settle before the next test starts.
    await expect.poll(async () => {
      const response = await fetch("http://127.0.0.1:14317/api/catalog");
      return (await response.json()).sessions.length;
    }).toBe(3);
  }
});

test("desktop: project grouping, tool filter, search, reply switch, settings dialog and read-only rendering", async ({
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
  await expect(page.locator(".message.user .message-meta time").first()).toHaveText("2026-11-04 14:20");
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
  await expect(page.locator(".sidebar").getByRole("group", { name: "外观主题" })).toHaveCount(0);
  await expect(page.locator(".sidebar").getByRole("button", { name: /^筛选 / })).toHaveCount(0);
  await openSettings(page);
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("heading", { name: "外观", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "本地数据源", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Gemini", { exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByText("Gemini CLI", { exact: true })).toHaveCount(0);
  await expect(page.locator(".source-toggle[aria-pressed='true']")).toHaveCount(3);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "设置", exact: true })).toBeFocused();
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
        timestamp: "2026-11-05T00:00:00Z",
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
  await expect(page.locator(".message.user .message-meta time").first()).toHaveText("2026-11-04 14:20");
  await expect(page.locator(".message.user .message-meta time").last()).toHaveText("2026-11-05 08:00");
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
  await expect(page.locator(".message.user .message-meta time")).toHaveText("2026-11-04 11:08");
  await expect(page.locator(".message.assistant .message-meta time")).toHaveText("2026-11-04 11:09");
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

test("user messages display single line breaks alongside Markdown paragraphs and code", async ({ page }) => {
  await page.goto("/");
  await page.locator(".session-row").filter({ hasText: "帮我检查一下登录页面" }).click();
  const message = page.locator('.message.user[data-message-id="u1"] .markdown');
  const paragraphs = message.locator(":scope > p");
  await expect(paragraphs).toHaveCount(2);
  await expect(paragraphs.first().locator("br")).toHaveCount(2);
  expect(await paragraphs.first().innerText()).toBe(
    "错误提示需要更清晰：\n区分网络问题、密码错误和账号不存在这三种情况。\n保留 重试 操作。",
  );
  await expect(paragraphs.first().locator("strong")).toHaveText("重试");
  await expect(paragraphs.last()).toHaveText("请参考以下代码。");
  await expect(message.locator("pre code")).toContainText('setStatus("loading");');
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

test("source multi-select filters project counts; global search navigates matches within a session", async ({
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
    await openSettings(page);
    await page
      .getByRole("button", { name: "筛选 Gemini", exact: true })
      .click();
    await page
      .getByRole("button", { name: "筛选 Claude", exact: true })
      .click();
    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.getByLabel("筛选 AI 工具")).toHaveValue("codex");
    await expect(page.locator(".projects .project-copy")).toHaveCount(2);
    await expect(page.locator(".projects")).not.toContainText("design-system");
    await expect(page.getByRole("button", { name: /全部项目/ })).toContainText(
      "3",
    );
    await openSettings(page);
    await page.getByRole("button", { name: "筛选 Codex", exact: true }).click();
    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.locator(".session-row")).toHaveCount(0);
    await expect(page.locator(".projects .project-copy")).toHaveCount(0);
    await openSettings(page);
    await page
      .getByRole("button", { name: "筛选 Gemini", exact: true })
      .click();
    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(page.locator(".projects .project-copy")).toHaveCount(1);
    await expect(page.locator(".projects")).toContainText("design-system");
    await openSettings(page);
    await page.getByRole("button", { name: "筛选 Codex", exact: true }).click();
    await page.getByRole("button", { name: "关闭设置" }).click();
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
    const navigation = page.getByRole("group", { name: "会话内搜索导航" });
    const position = navigation.getByRole("status");
    const previous = navigation.getByRole("button", { name: "上一个匹配" });
    const next = navigation.getByRole("button", { name: "下一个匹配" });
    const current = page.locator(".messages [data-search-current]");
    await expect(position).toHaveText("1 / 2");
    await expect(page.locator("pre mark[data-search-current]")).toBeInViewport();
    await previous.click();
    await expect(position).toHaveText("2 / 2");
    await expect(page.locator("p mark[data-search-current]")).toBeInViewport();
    await next.click();
    await expect(position).toHaveText("1 / 2");
    await next.click();
    await expect(position).toHaveText("2 / 2");

    await appendFile(files[1], jsonl([{
      type: "event_msg",
      timestamp: "2026-11-05T03:00:00Z",
      payload: { type: "user_message", message: `新消息：${needle}` },
    }]));
    await expect(position).toHaveText("2 / 3");
    await expect(page.locator("p mark[data-search-current]")).toBeInViewport();
    await next.click();
    await expect(position).toHaveText("3 / 3");
    await expect(page.locator(".message").filter({ hasText: "新消息：" }).locator("[data-search-current]")).toBeInViewport();
    await expect(current).toHaveCount(1);

    await page.locator(".messages").evaluate((el) => el.scrollTo({ top: 0 }));
    await page.locator(".session-row").first().click();
    await expect(page.locator(".messages mark").first()).toBeInViewport();
    await expect(position).toHaveText("1 / 3");
    await page.screenshot({
      path: path.join(tmpdir(), "echo-search-match.png"),
      animations: "disabled",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(navigation).toBeInViewport();
    await next.click();
    await expect(position).toHaveText("2 / 3");
    await expect(current).toBeInViewport();
    await page.screenshot({ path: path.join(tmpdir(), "echo-search-navigation-mobile.png") });
    await page.setViewportSize({ width: 1536, height: 1024 });
    const search = page.getByRole("textbox", { name: "搜索会话" });
    await search.fill("```text");
    await expect(position).toHaveText("1 / 1");
    await expect(page.locator("article[data-search-current]")).toBeInViewport();
    await expect(next).toBeDisabled();
    await search.fill("search-target");
    await expect(page.locator(".messages mark")).toHaveCount(0);
    await expect(position).toHaveText("会话内无匹配");
    await expect(previous).toBeDisabled();
    await expect(next).toBeDisabled();
    await expect
      .poll(() => page.locator(".messages").evaluate((el) => el.scrollTop))
      .toBe(0);
    await search.clear();
    await expect(navigation).toHaveCount(0);
    await expect(current).toHaveCount(0);
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

test("Antigravity Gemini sessions appear under Gemini and exclude non-Gemini sessions", async ({ page }) => {
  const agRoot = path.join(f.config.roots.gemini, "antigravity");
  const geminiLogs = path.join(agRoot, "brain", "ag-gemini-e2e", ".system_generated", "logs");
  const claudeLogs = path.join(agRoot, "brain", "ag-claude-e2e", ".system_generated", "logs");
  const annotationsDir = path.join(agRoot, "annotations");
  await Promise.all([
    mkdir(geminiLogs, { recursive: true }),
    mkdir(claudeLogs, { recursive: true }),
    mkdir(annotationsDir, { recursive: true }),
  ]);
  await writeFile(
    path.join(annotationsDir, "ag-gemini-e2e.pbtxt"),
    'title:"Antigravity Gemini 验证"',
  );
  await writeFile(
    path.join(geminiLogs, "transcript_full.jsonl"),
    jsonl([
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-08T02:00:00Z",
        content: "<USER_REQUEST>\n在 Antigravity 里用 Gemini 检查样式\n</USER_REQUEST>\n<ADDITIONAL_METADATA>\nlocal time\n</ADDITIONAL_METADATA>",
      },
      {
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-08T02:01:00Z",
        model: "gemini-4-neon-high",
        thinking: "hidden antigravity thinking",
        content: "已完成 Antigravity Gemini 样式检查。",
      },
    ]),
  );
  await writeFile(
    path.join(claudeLogs, "transcript_full.jsonl"),
    jsonl([
      {
        step_index: 0,
        source: "USER_EXPLICIT",
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-08T02:02:00Z",
        content: "<USER_REQUEST>\nAntigravity Claude 非 Gemini 会话\n</USER_REQUEST>",
      },
      {
        step_index: 1,
        source: "MODEL",
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-08T02:03:00Z",
        model: "claude-sonnet-4-5",
        content: "Claude 回复",
      },
    ]),
  );
  try {
    await page.goto("/");
    await page.getByLabel("筛选 AI 工具").selectOption("gemini");
    const row = page.locator(".session-row").filter({ hasText: "Antigravity Gemini 验证" });
    await expect(row).toBeVisible({ timeout: 10000 });
    await expect(page.locator(".session-row")).toHaveCount(2);
    await expect(page.locator(".session-list")).not.toContainText("Antigravity Claude 非 Gemini 会话");
    await row.click();
    await expect(page.locator(".reader-header h2")).toHaveText("Antigravity Gemini 验证");
    await expect(page.locator(".message.user")).toHaveText(/在 Antigravity 里用 Gemini 检查样式/);
    await expect(page.locator(".messages")).not.toContainText("USER_REQUEST");
    await expect(page.locator(".messages")).not.toContainText("ADDITIONAL_METADATA");
    await page.getByRole("switch", { name: "显示 AI 回复" }).click();
    await expect(page.locator(".message.assistant")).toContainText("已完成 Antigravity Gemini 样式检查。");
    await expect(page.locator(".messages")).not.toContainText("hidden antigravity thinking");
  } finally {
    await rm(agRoot, { recursive: true, force: true });
    await expect.poll(async () => {
      const response = await fetch("http://127.0.0.1:14317/api/catalog");
      return (await response.json()).sessions.length;
    }).toBe(3);
  }
});

test("appearance follows the system, persists manual choices, and syncs across tabs", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const root = page.locator("html");
  const appearance = page.getByRole("group", { name: "外观主题" });
  await expect(page).toHaveTitle("回声 Echo · AI 会话历史");
  const catalog = await (await page.request.get("/api/catalog")).json();
  await expect(page.locator(".message.user")).toHaveCount(catalog.sessions[0].userCount);
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(root).toHaveCSS("color-scheme", "dark");
  await openSettings(page);
  await expect(appearance.getByRole("button", { name: "跟随系统" })).toHaveAttribute("aria-pressed", "true");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "dark");

  await appearance.getByRole("button", { name: "浅色", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "light" });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "light");
  await openSettings(page);
  await expect(appearance.getByRole("button", { name: "浅色", exact: true })).toHaveAttribute("aria-pressed", "true");

  const other = await context.newPage();
  await other.goto("/");
  await expect(other.locator("html")).toHaveAttribute("data-theme", "light");
  await openSettings(other);
  await other.getByRole("group", { name: "外观主题" }).getByRole("button", { name: "深色", exact: true }).click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(appearance.getByRole("button", { name: "深色", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", "#171c22");
  await expect(page.locator("vite-error-overlay")).toHaveCount(0);
  await openSettings(page);
  await appearance.getByRole("button", { name: "跟随系统" }).click();
  await page.emulateMedia({ colorScheme: "light" });
  await expect(root).toHaveAttribute("data-theme", "light");
  await expect(other.getByRole("group", { name: "外观主题" }).getByRole("button", { name: "跟随系统" })).toHaveAttribute("aria-pressed", "true");
  await other.close();
  expect(errors).toEqual([]);
});

test("dark Markdown, search highlights, settings dialog, and mobile appearance remain readable", async ({ page }) => {
  const file = path.join(path.dirname(f.codexFile), "theme-rendering.jsonl");
  const content = [
    "深色模式阅读验证",
    "普通段落与 **强调文字**，包含 `inline code` 和 [文档链接](https://example.com)。",
    "> 引用内容应保留清晰的文字对比度。",
    "```tsx\nconst theme = 'contrast-example';\n```",
    "| 类型 | 状态 |\n| --- | --- |\n| 深色主题 | contrast-example |",
    "- [x] contrast-example\n- [ ] 浅色模式回归",
    "---",
    "代码、表格、引用和搜索结果使用同一套主题。",
  ].join("\n\n");
  await writeFile(file, jsonl([
    { type: "session_meta", payload: { id: "theme-rendering", cwd: "/Projects/atlas-web" } },
    { type: "event_msg", timestamp: "2026-11-05T08:00:00Z", payload: { type: "user_message", message: content } },
  ]));
  try {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");
    await page.getByRole("textbox", { name: "搜索会话" }).fill("contrast-example");
    await expect(page.locator(".session-row")).toHaveCount(1, { timeout: 10000 });
    await page.locator(".session-row").click();
    await expect(page.locator(".markdown mark")).toHaveCount(3);
    await expect(page.locator(".markdown pre")).toBeVisible();
    const contrasts = await page.evaluate(() => {
      const luminance = (color: string) => {
        const rgb = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(v => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      return [
        [".markdown", ".reader"],
        [".markdown pre", ".markdown pre"],
        [".markdown p code", ".markdown p code"],
        [".markdown th", ".markdown th"],
        [".markdown blockquote", ".reader"],
        [".markdown mark", ".markdown mark"],
        [".reader-footer", ".reader"],
        [".session-row.selected p", ".session-row.selected"],
      ].map(([foreground, background]) => {
        const text = luminance(getComputedStyle(document.querySelector(foreground)!).color);
        const surface = luminance(getComputedStyle(document.querySelector(background)!).backgroundColor);
        return { selector: foreground, ratio: (Math.max(text, surface) + 0.05) / (Math.min(text, surface) + 0.05) };
      });
    });
    for (const { selector, ratio } of contrasts) expect(ratio, selector).toBeGreaterThanOrEqual(4.5);
    await page.screenshot({ path: path.join(tmpdir(), "echo-dark-desktop.png"), animations: "disabled" });
    await openSettings(page);
    await page.getByRole("group", { name: "外观主题" }).getByRole("button", { name: "浅色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "关闭设置" }).click();
    await page.screenshot({ path: path.join(tmpdir(), "echo-light-desktop.png"), animations: "disabled" });
    await openSettings(page);
    await page.getByRole("group", { name: "外观主题" }).getByRole("button", { name: "深色", exact: true }).click();

    await page.getByRole("button", { name: "关闭设置" }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".reader")).toBeVisible();
    await expect(page.locator(".markdown pre")).toBeInViewport();
    await page.screenshot({ path: path.join(tmpdir(), "echo-dark-mobile.png"), animations: "disabled" });
    expect(await page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "返回会话列表" }).click();
    await page.getByRole("button", { name: "打开项目导航" }).click();
    await openSettings(page);
    const appearance = page.getByRole("group", { name: "外观主题" });
    await expect(appearance).toBeInViewport();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("heading", { name: "本地数据源", exact: true })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCSS("color-scheme", "dark");
    await page.screenshot({ path: path.join(tmpdir(), "echo-dark-sources.png"), animations: "disabled" });
    await appearance.getByRole("button", { name: "浅色", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await expect(page.locator(".sidebar")).toBeVisible();
    await page.locator(".close-sidebar").click();
    await expect(page.getByRole("heading", { name: "会话历史", exact: true })).toBeVisible();
  } finally {
    await rm(file, { force: true });
  }
});

test("appearance is applied before React loads and tolerates unavailable or invalid storage", async ({ page, context }) => {
  // Keep React from running to verify that the independent CSP-safe bootstrap sets the first frame.
  await page.route("**/assets/*.js", route => route.fulfill({ contentType: "application/javascript", body: "" }));
  await page.addInitScript(() => localStorage.setItem("echo-theme", "dark"));
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveCSS("color-scheme", "dark");
  await expect(page.locator("#root")).toBeEmpty();

  const blocked = await context.newPage();
  const errors: string[] = [];
  blocked.on("pageerror", error => errors.push(error.message));
  blocked.on("console", message => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  await blocked.addInitScript(() => {
    for (const method of ["getItem", "setItem"]) Object.defineProperty(Storage.prototype, method, {
      configurable: true,
      value: () => { throw new DOMException("Storage disabled", "SecurityError"); },
    });
  });
  await blocked.emulateMedia({ colorScheme: "dark" });
  await blocked.goto("/");
  await expect(blocked.getByRole("heading", { name: "会话历史", exact: true })).toBeVisible();
  await expect(blocked.locator("html")).toHaveAttribute("data-theme", "dark");
  await openSettings(blocked);
  await blocked.getByRole("group", { name: "外观主题" }).getByRole("button", { name: "浅色", exact: true }).click();
  await expect(blocked.locator("html")).toHaveAttribute("data-theme", "light");
  await blocked.reload();
  await expect(blocked.locator("html")).toHaveAttribute("data-theme-preference", "system");
  await expect(blocked.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(errors).toEqual([]);
  await blocked.close();

  const invalid = await context.newPage();
  await invalid.addInitScript(() => localStorage.setItem("echo-theme", "invalid"));
  await invalid.emulateMedia({ colorScheme: "light" });
  await invalid.goto("/");
  await expect(invalid.locator("html")).toHaveAttribute("data-theme-preference", "system");
  await expect(invalid.locator("html")).toHaveAttribute("data-theme", "light");
  await invalid.close();
});

test("scroll-to-bottom controls scroll independently and reach newly appended messages on desktop and mobile", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const files = Array.from({ length: 20 }, (_, index) =>
    path.join(path.dirname(f.codexFile), `scroll-control-${index}.jsonl`),
  );
  const longPrompt = [
    "滚动验证主会话",
    ...Array.from({ length: 60 }, (_, index) => `历史段落 ${index + 1}：检查长会话中跳到底部的行为，以及会话列表和阅读区各自独立的滚动位置。`),
    "主会话末尾",
  ].join("\n\n");
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });
  const gap = (selector: string) => page.locator(selector).evaluate(
    el => Math.max(0, el.scrollHeight - el.clientHeight - el.scrollTop),
  );
  try {
    await Promise.all(files.map((file, index) => writeFile(file, jsonl([
      { type: "session_meta", payload: { id: `scroll-control-${index}`, cwd: "/Projects/scroll-controls" } },
      {
        type: "event_msg",
        timestamp: index === 0 ? "2026-11-07T00:00:00Z" : "2026-11-06T00:00:00Z",
        payload: { type: "user_message", message: index === 0 ? longPrompt : `滚动列表验证 ${index}` },
      },
    ]))));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");
    await expect(page.locator(".session-row")).toHaveCount(23, { timeout: 10000 });
    await page.locator(".session-row").filter({ hasText: "滚动验证主会话" }).click();
    const readerButton = page.locator(".reader").getByRole("button", { name: "滚动到底部", exact: true });
    const listButton = page.locator(".session-list").getByRole("button", { name: "滚动到底部", exact: true });
    await expect(readerButton).toBeVisible();
    await expect.poll(() => gap(".messages")).toBeGreaterThan(200);
    await expect.poll(() => gap(".session-scroll")).toBeGreaterThan(200);
    const initialListTop = await page.locator(".session-scroll").evaluate(el => el.scrollTop);
    await readerButton.click();
    await expect.poll(() => gap(".messages")).toBeLessThan(2);
    await expect(page.getByText("主会话末尾", { exact: true })).toBeInViewport();
    expect(await page.locator(".session-scroll").evaluate(el => el.scrollTop)).toBe(initialListTop);
    const readerTop = await page.locator(".messages").evaluate(el => el.scrollTop);
    await listButton.click();
    await expect.poll(() => gap(".session-scroll")).toBeLessThan(2);
    await expect(page.locator(".session-row").last()).toBeInViewport();
    expect(await page.locator(".messages").evaluate(el => el.scrollTop)).toBe(readerTop);

    await appendFile(files[0], jsonl([{
      type: "event_msg",
      timestamp: "2026-11-07T08:00:00Z",
      payload: { type: "user_message", message: "滚动按钮验证：最新追加的消息" },
    }]));
    const appended = page.getByText("滚动按钮验证：最新追加的消息", { exact: true });
    await expect(appended).toBeVisible({ timeout: 10000 });
    expect(await page.locator(".messages").evaluate(el => el.scrollTop)).toBe(readerTop);
    await readerButton.click();
    await expect.poll(() => gap(".messages")).toBeLessThan(2);
    await expect(appended).toBeInViewport();
    const messageBox = await appended.boundingBox();
    const buttonBox = await readerButton.boundingBox();
    expect(messageBox!.y + messageBox!.height).toBeLessThanOrEqual(buttonBox!.y);
    await page.screenshot({ path: path.join(tmpdir(), "echo-scroll-bottom-desktop.png"), animations: "disabled" });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(readerButton).toBeInViewport();
    await readerButton.click();
    await expect.poll(() => gap(".messages")).toBeLessThan(2);
    await expect(appended).toBeInViewport();
    await page.screenshot({ path: path.join(tmpdir(), "echo-scroll-bottom-mobile.png"), animations: "disabled" });
    await page.getByRole("button", { name: "返回会话列表" }).click();
    await expect(listButton).toBeInViewport();
    await listButton.click();
    await expect.poll(() => gap(".session-scroll")).toBeLessThan(2);
    await expect(page.locator(".session-row").last()).toBeInViewport();
    expect(await page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(files.map(file => rm(file, { force: true })));
  }
});

test("search history persists recent terms, shows suggestions below input on focus, supports keyboard/click reuse, deletion and clear", async ({ page, context }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => {
    if (["error", "warning"].includes(message.type())) errors.push(message.text());
  });

  await page.goto("/");
  const search = page.getByRole("textbox", { name: "搜索会话" });
  const list = page.getByRole("listbox", { name: "搜索历史" });

  // No dropdown when history is empty.
  await search.click();
  await expect(list).toHaveCount(0);

  // Record via Enter and via clicking a matching session row.
  await search.fill("键盘操作");
  await search.press("Enter");
  await expect(list).toHaveCount(0);

  await search.fill("登录页面");
  await expect(page.locator(".session-row")).toHaveCount(1);
  await page.locator(".session-row").first().click();

  await search.fill("API 请求超时");
  await search.press("Enter");

  // Reload to verify persistence in localStorage.
  await page.reload();
  await search.click();
  await expect(list).toBeVisible();
  const options = list.getByRole("option");
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("API 请求超时");
  await expect(options.nth(1)).toContainText("登录页面");
  await expect(options.nth(2)).toContainText("键盘操作");

  // Dropdown sits directly below the search input.
  const inputBox = await page.locator(".search").boundingBox();
  const dropdownBox = await page.locator(".search-suggestions").boundingBox();
  expect(dropdownBox!.y).toBeGreaterThanOrEqual(inputBox!.y + inputBox!.height);
  expect(Math.abs(dropdownBox!.x - inputBox!.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(dropdownBox!.width - inputBox!.width)).toBeLessThanOrEqual(2);

  // Filtering highlights matched substring.
  await search.fill("登录");
  await expect(options).toHaveCount(1);
  await expect(options.first().locator(".search-suggestion-match")).toHaveText("登录");

  // Keyboard selection with ArrowDown + Enter fills query, closes dropdown, and promotes item to top.
  await search.press("ArrowDown");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await search.press("Enter");
  await expect(search).toHaveValue("登录页面");
  await expect(list).toHaveCount(0);
  await expect(page.locator(".session-row")).toHaveCount(1);

  // Clearing search and focusing shows "登录页面" promoted to #1.
  await page.getByRole("button", { name: "清空搜索" }).click();
  await search.click();
  await expect(options).toHaveCount(3);
  await expect(options.nth(0)).toContainText("登录页面");

  // Clicking a suggestion populates input and filters sessions.
  await options.nth(2).locator(".search-suggestion-item").click();
  await expect(search).toHaveValue("键盘操作");
  await expect(list).toHaveCount(0);
  await expect(page.locator(".session-row")).toHaveCount(1);

  // Deleting a single item keeps dropdown open for remaining items.
  await page.getByRole("button", { name: "清空搜索" }).click();
  await search.click();
  await expect(options).toHaveCount(3);
  await page.getByRole("button", { name: "删除搜索记录：登录页面" }).click();
  await expect(options).toHaveCount(2);
  await expect(list).not.toContainText("登录页面");

  // Mobile dark mode: Escape closes suggestions without closing sidebar drawer.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.getByRole("button", { name: "打开项目导航" }).click();
  await expect(page.locator(".sidebar")).toHaveClass(/is-open/);
  await search.click();
  await expect(list).toBeVisible();
  expect(await page.locator("body").evaluate(el => el.scrollWidth <= innerWidth)).toBe(true);
  await search.press("Escape");
  await expect(list).toHaveCount(0);
  await expect(page.locator(".sidebar")).toHaveClass(/is-open/);

  // Re-open and clear all history.
  await search.click();
  await expect(list).toBeVisible();
  await page.getByRole("button", { name: "清空搜索历史" }).click();
  await expect(list).toHaveCount(0);

  // Verify cap at 10 items and cross-tab sync.
  await page.setViewportSize({ width: 1280, height: 800 });
  const other = await context.newPage();
  await other.goto("/");
  for (let i = 1; i <= 11; i++) {
    await search.fill(`历史记录${i}`);
    await search.press("Enter");
  }
  await page.getByRole("button", { name: "清空搜索" }).click();
  await search.click();
  await expect(options).toHaveCount(10);
  await expect(options.first()).toContainText("历史记录11");
  await expect(options.last()).toContainText("历史记录2");

  const otherSearch = other.getByRole("textbox", { name: "搜索会话" });
  await otherSearch.click();
  await expect(other.getByRole("listbox", { name: "搜索历史" }).getByRole("option")).toHaveCount(10);
  await other.close();

  expect(errors).toEqual([]);
});
