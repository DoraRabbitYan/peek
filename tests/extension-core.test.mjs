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

test("selects the source author's status link instead of a quoted status", () => {
  const hrefs = [
    "/quoted/status/100/photo/1",
    "/author/status/200",
    "/author/status/200/analytics"
  ];
  assert.equal(Core.selectOwnPostUrl(hrefs, "/author"), "https://x.com/author/status/200");
  assert.equal(Core.postIdFromUrl("https://x.com/author/status/200/photo/1"), "200");
});

test("manifest keeps permissions limited to local state and X hosts", async () => {
  const manifest = JSON.parse(await readFile(path.resolve("extension/manifest.json"), "utf8"));
  assert.deepEqual([...manifest.permissions].sort(), ["storage"]);
  assert.deepEqual(manifest.host_permissions, ["https://x.com/*", "https://twitter.com/*"]);
  assert.equal(JSON.stringify(manifest).includes("<all_urls>"), false);
  assert.equal(JSON.stringify(manifest).includes("cookies"), false);
  assert.equal(manifest.content_scripts[0].all_frames, true);
  assert.equal(manifest.background, undefined);
  assert.equal(manifest.version, "0.5.0");
});

test("reader uses two native X frames without clone or proxy code", async () => {
  const content = await readFile(path.resolve("extension/content.js"), "utf8");
  assert.match(content, /createNativeFrame\(url, "source"/);
  assert.match(content, /createNativeFrame\(url, "replies"/);
  assert.match(content, /tuzaiPane/);
  assert.match(content, /DISCOVER_LABELS/);
  assert.match(content, /window\.top !== window\.self/);
  assert.doesNotMatch(content, /cloneNode/);
  assert.doesNotMatch(content, /TUZAI_OPEN_POST/);
  assert.doesNotMatch(content, /TUZAI_PERFORM_ACTION/);
  assert.doesNotMatch(content, /fetch\(/);
});
