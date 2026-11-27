import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SEARCH_HISTORY,
  addSearchHistoryItem,
  filterSearchHistory,
  parseSearchHistory,
  removeSearchHistoryItem,
} from "../src/hooks/useSearchHistory.js";

test("parseSearchHistory ignores invalid values, trims, deduplicates case-insensitively, and enforces max limit", () => {
  assert.deepEqual(parseSearchHistory(null), []);
  assert.deepEqual(parseSearchHistory("not-json"), []);
  assert.deepEqual(parseSearchHistory('{"a":1}'), []);

  const input = [
    "  React  ",
    "",
    123,
    "react",
    "TypeScript",
    ...Array.from({ length: 15 }, (_, i) => `item-${i}`),
  ];
  const parsed = parseSearchHistory(JSON.stringify(input));
  assert.equal(parsed.length, MAX_SEARCH_HISTORY);
  assert.equal(parsed[0], "React");
  assert.equal(parsed[1], "TypeScript");
  assert.equal(parsed[2], "item-0");
  assert.equal(parsed.at(-1), "item-7");
});

test("addSearchHistoryItem promotes duplicates to the top and evicts oldest beyond limit", () => {
  let list: string[] = [];
  assert.deepEqual(addSearchHistoryItem(list, "   "), []);
  for (let i = 1; i <= 12; i++) {
    list = addSearchHistoryItem(list, `keyword-${i}`);
  }
  assert.equal(list.length, MAX_SEARCH_HISTORY);
  assert.equal(list[0], "keyword-12");
  assert.equal(list.at(-1), "keyword-3");

  // Re-searching an existing term with different casing moves it to the front.
  list = addSearchHistoryItem(list, "KEYWORD-5");
  assert.equal(list.length, MAX_SEARCH_HISTORY);
  assert.equal(list[0], "KEYWORD-5");
  assert.equal(list.filter((item) => item.toLowerCase() === "keyword-5").length, 1);
});

test("removeSearchHistoryItem and filterSearchHistory behave predictably", () => {
  const history = ["登录页面", "页面登录超时", "API 超时", "reducer"];
  assert.deepEqual(filterSearchHistory(history, ""), history);
  assert.deepEqual(filterSearchHistory(history, "登录"), [
    "登录页面",
    "页面登录超时",
  ]);
  // Exact match is omitted from suggestions while other matches stay visible.
  assert.deepEqual(filterSearchHistory(history, "登录页面"), []);
  assert.deepEqual(filterSearchHistory(["React", "React Hooks"], "react"), [
    "React Hooks",
  ]);
  assert.deepEqual(removeSearchHistoryItem(history, "API 超时"), [
    "登录页面",
    "页面登录超时",
    "reducer",
  ]);
});
