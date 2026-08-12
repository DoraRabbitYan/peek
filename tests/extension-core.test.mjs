import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(path.resolve("extension/core.js"), "utf8");
const context = vm.createContext({ URL, globalThis: {} });
vm.runInContext(source, context);
const Core = context.globalThis.TuzaiCore;

test("normalizes X and legacy Twitter status links", () => {
  assert.equal(Core.normalizePostUrl("/maker/status/2087155564904370681/photo/1"), "https://x.com/maker/status/2087155564904370681");
  assert.equal(Core.normalizePostUrl("https://twitter.com/example/status/123?ref=home"), "https://x.com/example/status/123");
});

test("rejects non-status and non-X links", () => {
  assert.equal(Core.normalizePostUrl("https://example.com/person/status/123"), null);
  assert.equal(Core.normalizePostUrl("https://x.com/explore"), null);
});

test("deduplicates reply entries by post id", () => {
  const values = Core.uniqueByPostId([
    { url: "https://x.com/a/status/1", html: "one" },
    { url: "https://x.com/a/status/1/photo/1", html: "duplicate" },
    { url: "https://x.com/b/status/2", html: "two" },
    { url: null, html: "invalid" }
  ]);
  assert.equal(values.length, 2);
  assert.equal(values[1].html, "two");
});

test("maps the native X action controls preserved in cloned posts", () => {
  assert.equal(Core.actionNameFromMetadata("reply"), "reply");
  assert.equal(Core.actionNameFromMetadata("unretweet"), "retweet");
  assert.equal(Core.actionNameFromMetadata("unlike"), "like");
  assert.equal(Core.actionNameFromMetadata("removeBookmark"), "bookmark");
  assert.equal(Core.actionNameFromMetadata("", "分享帖子"), "share");
  assert.equal(Core.actionNameFromMetadata("caret"), "more");
  assert.equal(Core.actionNameFromMetadata("tweetPhoto"), null);
});

test("normalizes and applies reply sorting without mutating the source list", () => {
  const replies = [
    { id: "older-popular", createdAt: "2026-08-10T08:00:00Z", likeCount: 80 },
    { id: "newer", createdAt: "2026-08-12T08:00:00Z", likeCount: 3 },
    { id: "middle", createdAt: "2026-08-11T08:00:00Z", likeCount: 12 }
  ];
  assert.equal(Core.normalizeReplySort("unknown"), "relevant");
  assert.deepEqual(Array.from(Core.sortReplyItems(replies, "recent"), (item) => item.id), ["newer", "middle", "older-popular"]);
  assert.deepEqual(Array.from(Core.sortReplyItems(replies, "liked"), (item) => item.id), ["older-popular", "middle", "newer"]);
  assert.deepEqual(replies.map((item) => item.id), ["older-popular", "newer", "middle"]);
  assert.equal(Core.parseCompactCount("1.2万 喜欢"), 12000);
  assert.equal(Core.parseCompactCount("3.4K Likes"), 3400);
});

test("manifest keeps permissions limited to local state, tabs, and X hosts", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("extension/manifest.json"), "utf8"));
  assert.deepEqual([...manifest.permissions].sort(), ["storage", "tabs"]);
  assert.deepEqual(manifest.host_permissions, ["https://x.com/*", "https://twitter.com/*"]);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.equal(JSON.stringify(manifest).includes("cookies"), false);
  assert.equal(manifest.version, "0.4.0");
});

test("interactive proxy keeps account actions local to X", async () => {
  const [content, background] = await Promise.all([
    readFile(path.resolve("extension/content.js"), "utf8"),
    readFile(path.resolve("extension/background.js"), "utf8")
  ]);
  assert.match(content, /TUZAI_PERFORM_ACTION/);
  assert.match(content, /tweetButton/);
  assert.match(content, /可直接互动/);
  assert.match(content, /querySelector\("\.tuzai-reply-tools"\)\.append\(contextRow, createReplyComposer\(\)\)/);
  assert.doesNotMatch(content, /postBody\.append\(contextRow/);
  assert.match(content, /createReplySortControl/);
  assert.match(content, /sort: state\.replySort/);
  assert.match(content, /applyNativeReplySort/);
  assert.match(background, /sort: message\.sort \|\| "relevant"/);
  assert.match(background, /TUZAI_ACTION/);
  assert.doesNotMatch(content, /fetch\(/);
  assert.doesNotMatch(background, /fetch\(/);
});
