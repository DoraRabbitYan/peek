import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bridgeSource = await readFile(new URL("../extension/page-bridge.js", import.meta.url), "utf8");
const contentSource = await readFile(new URL("../extension/content.js", import.meta.url), "utf8");

async function bridgeHarness({ status = 200, body, csrf = "test-csrf", authorization = true, lookup } = {}) {
  const listeners = new Map();
  const replies = [];
  const requests = [];
  class XHR { open() {} send() {} setRequestHeader() {} }
  const window = {
    addEventListener: (type, listener) => listeners.set(type, listener),
    postMessage: (message) => replies.push(message),
    fetch: async (url, init) => {
      requests.push({ url, ...init });
      if (String(url).includes("/UserByRestId")) {
        return { ok: !lookup.error, status: lookup.error ? 503 : 200, json: async () => lookup.body };
      }
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    }
  };
  if (lookup) {
    const runtime = Object.assign(() => {}, {
      c: { profile: { exports: { operationName: "UserByRestId", queryId: "fixture-query", metadata: {} } } },
      m: {}
    });
    window.webpackChunkFixture = [];
    window.webpackChunkFixture.push = (chunk) => chunk[2](runtime);
  }
  const location = { origin: "https://x.com", host: "x.com" };
  const context = vm.createContext({ window, location, document: { cookie: csrf ? `ct0=${csrf}` : "" },
    Headers, Request, URL, URLSearchParams, AbortSignal, XMLHttpRequest: XHR,
    fetch: (...args) => window.fetch(...args) });
  vm.runInContext(bridgeSource, context);
  // Observe a normal page request, exactly as the installed bridge does. No Webpack runtime.
  if (authorization) await window.fetch("/i/api/test", { headers: { authorization: "test-bearer" } });
  requests.length = 0;
  return {
    requests,
    async follow(active = true, userId = "123") {
      await listeners.get("message")({ source: window, origin: location.origin,
        data: { source: "tuzai-content", requestId: 1, type: "TOGGLE_FOLLOW", userId, active } });
      return replies.at(-1);
    }
  };
}

for (const active of [true, false]) {
  test(`bridge ${active ? "follows" : "unfollows"} without GraphQL definitions`, async () => {
    const h = await bridgeHarness({ body: { id_str: "123", following: active, followers_count: 42 } });
    const reply = await h.follow(active);
    assert.equal(reply.ok, true);
    assert.equal(reply.payload.following, active);
    assert.equal(reply.payload.followers, 42);
    assert.equal(h.requests.length, 1);
    const request = h.requests[0];
    assert.equal(request.url, `/i/api/1.1/friendships/${active ? "create" : "destroy"}.json`);
    assert.equal(request.method, "POST");
    assert.equal(request.credentials, "include");
    assert.match(request.headers["content-type"], /^application\/x-www-form-urlencoded/);
    assert.equal(request.headers["x-csrf-token"], "test-csrf");
    assert.equal(new URLSearchParams(request.body).get("user_id"), "123");
  });
}

test("private account returns pending instead of a completed follow", async () => {
  const h = await bridgeHarness({ body: { id_str: "123", following: false, follow_request_sent: true } });
  const reply = await h.follow();
  assert.equal(reply.ok, true);
  assert.equal(reply.payload.following, false);
  assert.equal(reply.payload.followRequestSent, true);
});

for (const active of [true, false]) {
  test(`accepts current X string id on ${active ? "follow" : "unfollow"} without losing precision`, async () => {
    const userId = "2029352230424649728";
    const h = await bridgeHarness({ body: { id: userId, following: active, followers_count: 42 } });
    const reply = await h.follow(active, userId);
    assert.equal(reply.ok, true);
    assert.equal(reply.payload.following, active);
    assert.equal(h.requests.length, 1);
    assert.equal(new URLSearchParams(h.requests[0].body).get("user_id"), userId);
  });
}

test("a rounded numeric id must not be mistaken for the requested account", async () => {
  const userId = "2029352230424649728";
  const h = await bridgeHarness({ body: { id: Number(userId), following: true } });
  const reply = await h.follow(true, userId);
  assert.equal(reply.ok, true);
  assert.equal(reply.payload.confirmed, false);
});

for (const [name, options] of [
  ["HTTP failure", { status: 403, body: { errors: [{ message: "Account restricted" }] } }],
  ["API error in HTTP 200", { body: { errors: [{ message: "Rate limited" }] } }]
]) {
  test(`bridge rejects ${name} without retrying a mutation`, async () => {
    const h = await bridgeHarness(options);
    const reply = await h.follow();
    assert.equal(reply.ok, false);
    assert.equal(h.requests.length, 1);
    assert.ok(reply.error);
    if (options.body?.errors) assert.equal(reply.error, options.body.errors[0].message);
  });
}

for (const body of [null, {}, { id_str: "123" }, { id_str: "999", following: true }, { id_str: "123", following: false }]) {
  test(`accepted write with incomplete or stale response is reconciled by a read: ${JSON.stringify(body)}`, async () => {
    const h = await bridgeHarness({ body, lookup: { body: { data: { user: { result: {
      rest_id: "123", relationship_perspectives: { following: true }, relationship_counts: { followers_count: 15 }
    } } } } } });
    const reply = await h.follow();
    assert.equal(reply.ok, true);
    assert.equal(reply.payload.following, true);
    assert.equal(reply.payload.followers, 15);
    assert.equal(h.requests.filter((r) => r.method === "POST").length, 1);
    assert.equal(h.requests[1].method, "GET");
    const url = new URL(h.requests[1].url);
    assert.equal(JSON.parse(url.searchParams.get("variables")).userId, "123");
  });
}

for (const lookup of [undefined, { error: true }, { body: {} }, { body: { data: { user: { result: {
  rest_id: "999", legacy: { following: true }
} } } } }]) {
  test(`unavailable verification does not turn a successful write into a red error: ${JSON.stringify(lookup)}`, async () => {
    const h = await bridgeHarness({ body: {}, lookup });
    const reply = await h.follow();
    assert.equal(reply.ok, true);
    assert.equal(reply.payload.confirmed, false);
    assert.equal(reply.payload.following, undefined);
    assert.equal(h.requests.filter((r) => r.method === "POST").length, 1);
  });
}

test("read-back confirms unfollow and private-account pending without inventing a success state", async () => {
  for (const [active, pending] of [[false, false], [true, true], [true, false]]) {
    const h = await bridgeHarness({ body: {}, lookup: { body: { data: { user: { result: {
      rest_id: "123", legacy: { following: false, follow_request_sent: pending }
    } } } } } });
    const reply = await h.follow(active);
    assert.equal(reply.ok, true);
    assert.equal(reply.payload.confirmed, true);
    assert.equal(reply.payload.following, false);
    assert.equal(reply.payload.followRequestSent, pending);
    assert.equal(h.requests.length, 2);
  }
});

test("invalid user IDs and missing credentials never send a mutation", async () => {
  for (const options of [{ csrf: "" }, { authorization: false }, {}]) {
    const h = await bridgeHarness(options);
    const reply = await h.follow(true, Object.keys(options).length ? "123" : "invalid");
    assert.equal(reply.ok, false);
    assert.equal(h.requests.length, 0);
  }
});

class Node {
  constructor(className = "", text = "") {
    this.className = className; this.textContent = text; this.children = [];
    this.dataset = {}; this.attributes = {}; this.listeners = {}; this.disabled = false;
  }
  append(...children) { this.children.push(...children); }
  querySelector(selector) {
    return this.children.find((node) => node.className === selector.slice(1))
      || this.children.map((node) => node.querySelector(selector)).find(Boolean);
  }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
}

function uiHarness(requestPage) {
  const author = { id: "123", handle: "example", followers: 10, viewerFollowing: false };
  const otherAuthor = { ...author };
  const card = new Node();
  card.append(new Node("tuzai-profile-followers-count"));
  const messages = [];
  const opened = [];
  const context = vm.createContext({
    state: { ancestors: [], focal: { author }, replies: [{ author: otherAuthor }] },
    element: (tag, cls, text) => new Node(cls, text), formatCount: String,
    notify: (...args) => messages.push(args), requestPage,
    window: { open: (...args) => opened.push(args) }
  });
  vm.runInContext(contentSource.slice(contentSource.indexOf("  function updateAuthorFollowState("),
    contentSource.indexOf("  function profileCard(")), context);
  const button = context.profileFollowButton(author, card);
  const click = () => button.listeners.click({ preventDefault() {}, stopPropagation() {} });
  return { author, otherAuthor, card, button, click, messages, opened };
}

test("accepted but unverified request shows neutral status and opens profile instead of resending", async () => {
  let writes = 0;
  const h = uiHarness(async () => { writes++; return { confirmed: false }; });
  await h.click();
  assert.equal(h.author.viewerFollowing, false);
  assert.equal(h.author.followers, 10);
  assert.equal(h.otherAuthor.followStateUnconfirmed, true);
  assert.match(h.button.attributes["aria-label"], /^查看状态/);
  assert.equal(h.messages[0][1], "info");
  await h.click();
  assert.equal(writes, 1);
  assert.equal(h.opened[0][0], "https://x.com/example");
});

test("profile button prevents duplicate clicks and updates repeated authors from the response", async () => {
  let resolve;
  let calls = 0;
  const h = uiHarness(() => { calls++; return new Promise((done) => { resolve = done; }); });
  const pending = h.click();
  assert.equal(h.button.disabled, true);
  await h.click();
  assert.equal(calls, 1);
  resolve({ following: true, followRequestSent: false, followers: 21 });
  await pending;
  assert.equal(h.author.viewerFollowing, true);
  assert.equal(h.otherAuthor.viewerFollowing, true);
  assert.equal(h.author.followers, 21);
  assert.equal(h.button.dataset.following, "true");
  assert.equal(h.button.disabled, false);
});

test("failed follow keeps the old state and makes the button usable again", async () => {
  const h = uiHarness(async () => { throw new Error("rejected"); });
  await h.click();
  assert.equal(h.author.viewerFollowing, false);
  assert.equal(h.author.followers, 10);
  assert.equal(h.button.disabled, false);
  assert.equal(h.button.attributes["aria-busy"], undefined);
  assert.equal(h.messages[0][1], "error");
});

test("follow then unfollow restores the label and count using server state", async () => {
  const actions = [];
  const h = uiHarness(async (type, { active }) => {
    actions.push(active);
    return { following: active, followRequestSent: false, followers: active ? 11 : 10 };
  });
  await h.click();
  await h.click();
  assert.deepEqual(actions, [true, false]);
  assert.equal(h.author.viewerFollowing, false);
  assert.equal(h.otherAuthor.followers, 10);
  assert.equal(h.button.attributes["aria-label"], "关注 @example");
  assert.equal(h.button.disabled, false);
});

test("pending request does not increment followers or claim to be following", async () => {
  const h = uiHarness(async () => ({ following: false, followRequestSent: true, followers: null }));
  await h.click();
  assert.equal(h.author.followers, 10);
  assert.equal(h.otherAuthor.followRequestSent, true);
  assert.equal(h.button.disabled, true);
  assert.match(h.button.attributes["aria-label"], /^已请求/);
  assert.match(h.messages[0][0], /已发送关注请求/);
});
