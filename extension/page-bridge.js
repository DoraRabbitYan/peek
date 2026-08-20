(function installTuzaiPageBridge() {
  "use strict";

  if (window.__tuzaiPageBridgeInstalled) return;
  window.__tuzaiPageBridgeInstalled = true;

  const CONTENT_SOURCE = "tuzai-content";
  const PAGE_SOURCE = "tuzai-page";
  const GRAPHQL_PATH = /\/graphql\/([^/]+)\/([^/?#]+)/;
  const TRANSLATION_PATH = /\/translation\/service\/translateTweet(?:\.json)?(?:[?#]|$)/;
  const AUTH_HEADER_NAMES = new Set([
    "authorization",
    "x-twitter-auth-type",
    "x-twitter-active-user",
    "x-twitter-client-language",
    "x-client-uuid"
  ]);
  const ACTIONS = Object.freeze({
    like: { active: "UnfavoriteTweet", inactive: "FavoriteTweet" },
    repost: { active: "DeleteRetweet", inactive: "CreateRetweet" },
    bookmark: { active: "DeleteBookmark", inactive: "CreateBookmark" }
  });
  const captured = {
    auth: Object.create(null),
    templates: new Map(),
    translationTemplate: null
  };
  const operationCache = new Map();
  let webpackRuntime = null;
  let transactionIdFunction = null;

  function objectValue(value) {
    return value && (typeof value === "object" || typeof value === "function") ? value : null;
  }

  function normalizeHeaders(value) {
    const normalized = Object.create(null);
    try {
      new Headers(value || {}).forEach((headerValue, name) => {
        normalized[name.toLowerCase()] = headerValue;
      });
    } catch {
      if (!value || typeof value !== "object") return normalized;
      for (const [name, headerValue] of Object.entries(value)) {
        if (headerValue !== undefined) normalized[name.toLowerCase()] = String(headerValue);
      }
    }
    return normalized;
  }

  function rememberRequest(urlValue, methodValue, headersValue, body) {
    const url = String(urlValue || "");
    const headers = normalizeHeaders(headersValue);
    for (const [name, value] of Object.entries(headers)) {
      if (AUTH_HEADER_NAMES.has(name) && value) captured.auth[name] = value;
    }
    if (TRANSLATION_PATH.test(url)) {
      captured.translationTemplate = {
        url,
        method: String(methodValue || "GET").toUpperCase(),
        headers
      };
    }
    const match = url.match(GRAPHQL_PATH);
    if (!match) return;
    captured.templates.set(match[2], {
      url,
      method: String(methodValue || "GET").toUpperCase(),
      headers,
      body: typeof body === "string" ? body : null
    });
  }

  function patchXhr() {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
    const requests = new WeakMap();

    XMLHttpRequest.prototype.open = function tuzaiOpen(method, url, ...rest) {
      requests.set(this, { method, url: String(url), headers: Object.create(null) });
      return Reflect.apply(originalOpen, this, [method, url, ...rest]);
    };
    XMLHttpRequest.prototype.setRequestHeader = function tuzaiSetRequestHeader(name, value) {
      const request = requests.get(this);
      if (request) request.headers[String(name).toLowerCase()] = String(value);
      return Reflect.apply(originalSetRequestHeader, this, [name, value]);
    };
    XMLHttpRequest.prototype.send = function tuzaiSend(body) {
      const request = requests.get(this);
      if (request) rememberRequest(request.url, request.method, request.headers, body);
      return Reflect.apply(originalSend, this, [body ?? null]);
    };
  }

  function patchFetch() {
    const originalFetch = window.fetch;
    window.fetch = function tuzaiFetch(input, init) {
      try {
        const request = input instanceof Request ? input : null;
        const headers = normalizeHeaders(request?.headers);
        Object.assign(headers, normalizeHeaders(init?.headers));
        rememberRequest(request?.url || input, init?.method || request?.method || "GET", headers, init?.body);
      } catch {
        // A failed observation must never affect X's own request.
      }
      return Reflect.apply(originalFetch, this, [input, init]);
    };
  }

  function getWebpackRuntime() {
    if (webpackRuntime?.c && webpackRuntime?.m) return webpackRuntime;
    try {
      const chunkName = Object.keys(window).find((name) => name.startsWith("webpackChunk") && Array.isArray(window[name]));
      const chunk = chunkName ? window[chunkName] : null;
      if (!chunk) return null;
      let runtime = null;
      chunk.push([[`tuzai-${Date.now()}`], {}, (candidate) => { runtime = candidate; }]);
      if (runtime?.c && runtime?.m) webpackRuntime = runtime;
    } catch {
      webpackRuntime = null;
    }
    return webpackRuntime;
  }

  function deepFind(value, predicate, maxDepth = 5, seen = new Set()) {
    const current = objectValue(value);
    if (!current || maxDepth < 0 || seen.has(current)) return null;
    seen.add(current);
    try {
      if (predicate(current)) return current;
      for (const key of Object.keys(current)) {
        let child;
        try {
          child = current[key];
        } catch {
          continue;
        }
        const found = deepFind(child, predicate, maxDepth - 1, seen);
        if (found) return found;
      }
    } catch {
      return null;
    }
    return null;
  }

  function findOperation(operationName) {
    const cached = operationCache.get(operationName);
    if (cached) return cached;
    const runtime = getWebpackRuntime();
    if (!runtime) return null;
    const predicate = (value) => value?.operationName === operationName && typeof value?.queryId === "string";

    for (const module of Object.values(runtime.c)) {
      const found = deepFind(module?.exports, predicate);
      if (found) {
        operationCache.set(operationName, found);
        return found;
      }
    }

    for (const [moduleId, factory] of Object.entries(runtime.m)) {
      let source = "";
      try {
        source = Function.prototype.toString.call(factory);
      } catch {
        continue;
      }
      if (!source.includes(operationName)) continue;
      try {
        const exports = runtime(moduleId);
        const found = deepFind(exports, predicate);
        if (found) {
          operationCache.set(operationName, found);
          return found;
        }
      } catch {
        // Some modules are environment-specific; continue to the next candidate.
      }
    }
    return null;
  }

  function findTransactionIdFunction() {
    if (transactionIdFunction) return transactionIdFunction;
    const runtime = getWebpackRuntime();
    if (!runtime) return null;
    for (const [moduleId, module] of Object.entries(runtime.c)) {
      const factory = runtime.m[moduleId];
      let source = "";
      try {
        source = Function.prototype.toString.call(factory);
      } catch {
        continue;
      }
      const candidate = module?.exports?.kc;
      if (typeof candidate === "function" && candidate.length === 3 && source.includes("x-client-transaction-id")) {
        transactionIdFunction = candidate;
        return candidate;
      }
    }
    for (const [moduleId, factory] of Object.entries(runtime.m)) {
      let source = "";
      try {
        source = Function.prototype.toString.call(factory);
      } catch {
        continue;
      }
      if (!source.includes("x-client-transaction-id")) continue;
      try {
        const exports = runtime(moduleId);
        if (typeof exports?.kc === "function" && exports.kc.length === 3) {
          transactionIdFunction = exports.kc;
          return exports.kc;
        }
      } catch {
        // Continue scanning loaded X modules.
      }
    }
    return null;
  }

  function csrfToken() {
    return decodeURIComponent((document.cookie.match(/(?:^|;\s*)ct0=([^;]+)/) || [])[1] || "");
  }

  function toggleMap(items) {
    const result = Object.create(null);
    for (const item of items || []) {
      if (typeof item === "string") result[item] = true;
      else if (typeof item?.name === "string") result[item.name] = item.value ?? true;
    }
    return result;
  }

  async function requestHeaders(path, method, requiresCsrf) {
    const headers = {
      "content-type": "application/json",
      "x-twitter-active-user": captured.auth["x-twitter-active-user"] || "yes",
      "x-twitter-auth-type": captured.auth["x-twitter-auth-type"] || "OAuth2Session"
    };
    if (!captured.auth.authorization) throw new Error("还没有捕获到 X 登录请求，请刷新 X 页面后重试");
    headers.authorization = captured.auth.authorization;
    for (const name of ["x-twitter-client-language", "x-client-uuid"]) {
      if (captured.auth[name]) headers[name] = captured.auth[name];
    }
    const csrf = csrfToken();
    if (csrf) headers["x-csrf-token"] = csrf;
    if (requiresCsrf && !csrf) throw new Error("当前 X 登录会话缺少 CSRF 信息，请刷新后重试");
    const makeTransactionId = findTransactionIdFunction();
    if (makeTransactionId) {
      try {
        const transactionId = await makeTransactionId(location.host, path, method);
        if (transactionId && !String(transactionId).startsWith("e:")) headers["x-client-transaction-id"] = transactionId;
      } catch {
        // X currently accepts some operations without this header; keep the request usable.
      }
    }
    return headers;
  }

  async function graphql(operationName, variables, method = "POST") {
    const operation = findOperation(operationName);
    if (!operation) throw new Error(`当前 X 页面尚未加载 ${operationName} 操作，请刷新页面后重试`);
    const path = `/i/api/graphql/${operation.queryId}/${operationName}`;
    const features = toggleMap(operation.metadata?.featureSwitches);
    const fieldToggles = toggleMap(operation.metadata?.fieldToggles);
    const headers = await requestHeaders(path, method, method === "POST");
    let response;
    if (method === "GET") {
      const url = new URL(path, location.origin);
      url.searchParams.set("variables", JSON.stringify(variables));
      url.searchParams.set("features", JSON.stringify(features));
      url.searchParams.set("fieldToggles", JSON.stringify(fieldToggles));
      response = await fetch(url.toString(), { method, headers, credentials: "include", cache: "no-store" });
    } else {
      response = await fetch(path, {
        method,
        headers,
        credentials: "include",
        cache: "no-store",
        body: JSON.stringify({ variables, features, queryId: operation.queryId })
      });
    }
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.errors?.length) {
      const message = json?.errors?.[0]?.message || `X 请求失败（${response.status}）`;
      throw new Error(message);
    }
    return json;
  }

  async function replayTweetDetail(tweetId, cursor) {
    const template = captured.templates.get("TweetDetail");
    if (!template) throw new Error("X 详情接口尚未就绪，请刷新页面后重试");
    const url = new URL(template.url, location.origin);
    const variables = JSON.parse(url.searchParams.get("variables") || "{}");
    variables.focalTweetId = tweetId;
    if (cursor) variables.cursor = cursor;
    else delete variables.cursor;
    url.searchParams.set("variables", JSON.stringify(variables));
    const headers = { ...template.headers, ...await requestHeaders(url.pathname, template.method, false) };
    const response = await fetch(url.toString(), {
      method: template.method,
      headers,
      credentials: "include",
      cache: "no-store"
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.errors?.length) throw new Error(json?.errors?.[0]?.message || `X 请求失败（${response.status}）`);
    return json;
  }

  async function readThread(tweetId, cursor) {
    const variables = {
      focalTweetId: tweetId,
      referrer: "home",
      with_rux_injections: false,
      rankingMode: "Relevance",
      includePromotedContent: true,
      withCommunity: true,
      withQuickPromoteEligibilityTweetFields: true,
      withBirdwatchNotes: true,
      withVoice: true
    };
    if (cursor) variables.cursor = cursor;
    try {
      return await graphql("TweetDetail", variables, "GET");
    } catch (primaryError) {
      try {
        return await replayTweetDetail(tweetId, cursor);
      } catch {
        throw primaryError;
      }
    }
  }

  function readArticle(tweetId) {
    return graphql("TweetResultByRestId", {
      tweetId,
      withCommunity: false,
      includePromotedContent: false,
      withVoice: false
    }, "GET");
  }

  async function translateTweet(tweetId, targetLanguage) {
    const language = String(targetLanguage || "zh-cn").toLowerCase();
    const fallbackPath = `/i/api/1.1/strato/column/None/tweetId=${tweetId},destinationLanguage=None,translationSource=Some(Google),feature=None,timeout=None,onlyCached=None/translation/service/translateTweet`;
    const template = captured.translationTemplate;
    const url = new URL(template?.url || fallbackPath, location.origin);
    if (/tweetId=\d+/.test(url.pathname)) {
      url.pathname = url.pathname.replace(/tweetId=\d+/, `tweetId=${tweetId}`);
    } else {
      url.pathname = fallbackPath;
    }
    const headers = {
      ...(template?.headers || {}),
      ...await requestHeaders(url.pathname, "GET", false),
      accept: "*/*",
      "x-twitter-client-language": language
    };
    const response = await fetch(url.toString(), {
      method: "GET",
      headers,
      credentials: "include",
      cache: "no-store"
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.errors?.length || json?.translationState === "Failed") {
      throw new Error(json?.errors?.[0]?.message || `X 翻译请求失败（${response.status}）`);
    }
    const text = String(json?.translation || "").trim();
    if (!text) throw new Error("X 暂时没有返回这条帖子的翻译");
    return {
      text,
      sourceLanguage: String(json?.sourceLanguage || json?.source_language || ""),
      localizedSourceLanguage: String(json?.localizedSourceLanguage || json?.localized_source_language || ""),
      destinationLanguage: String(json?.destinationLanguage || json?.destination_language || language)
    };
  }

  async function toggleAction(action, tweetId, active) {
    const mapping = ACTIONS[action];
    if (!mapping) throw new Error("不支持的互动操作");
    const operationName = active ? mapping.active : mapping.inactive;
    const variables = action === "repost" && active
      ? { source_tweet_id: tweetId, dark_request: false }
      : action === "repost"
        ? { tweet_id: tweetId, dark_request: false }
        : { tweet_id: tweetId };
    return graphql(operationName, variables);
  }

  async function createReply(tweetId, text) {
    const replyText = String(text || "").trim();
    if (!replyText || replyText.length > 280) throw new Error("回复内容需要在 1 到 280 个字符之间");
    return graphql("CreateTweet", {
      tweet_text: replyText,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
      disallowed_reply_options: null,
      reply: { in_reply_to_tweet_id: tweetId, exclude_reply_user_ids: [] }
    });
  }

  function toggleFollow(userId, active) {
    return graphql(active ? "CreateFriendship" : "DestroyFriendship", { user_id: userId });
  }

  function respond(requestId, ok, payload) {
    window.postMessage({ source: PAGE_SOURCE, requestId, ok, ...(ok ? { payload } : { error: payload }) }, location.origin);
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const message = event.data;
    if (message?.source !== CONTENT_SOURCE || !Number.isInteger(message.requestId)) return;
    if (message.type === "TOGGLE_FOLLOW") {
      const userId = String(message.userId || "");
      if (!/^\d+$/.test(userId)) return respond(message.requestId, false, "用户 ID 无效");
      try {
        return respond(message.requestId, true, await toggleFollow(userId, Boolean(message.active)));
      } catch (error) {
        return respond(message.requestId, false, error instanceof Error ? error.message : "X 请求失败");
      }
    }
    const tweetId = String(message.tweetId || "");
    if (!/^\d+$/.test(tweetId)) return respond(message.requestId, false, "帖子 ID 无效");
    try {
      let payload;
      if (message.type === "READ_THREAD") payload = await readThread(tweetId, message.cursor);
      else if (message.type === "READ_ARTICLE") payload = await readArticle(tweetId);
      else if (message.type === "TRANSLATE_TWEET") payload = await translateTweet(tweetId, message.targetLanguage);
      else if (message.type === "TOGGLE_ACTION") payload = await toggleAction(message.action, tweetId, Boolean(message.active));
      else if (message.type === "CREATE_REPLY") payload = await createReply(tweetId, message.text);
      else throw new Error("未知请求");
      respond(message.requestId, true, payload);
    } catch (error) {
      respond(message.requestId, false, error instanceof Error ? error.message : "X 请求失败");
    }
  });

  patchXhr();
  patchFetch();
  getWebpackRuntime();
  window.postMessage({ source: PAGE_SOURCE, type: "READY" }, location.origin);
})();
