(function attachTuzaiCore(root) {
  "use strict";

  const STATUS_PATTERN = /^\/(?:i\/web\/)?([^/?#]+)\/status\/(\d+)/i;
  const REPLY_SORTS = new Set(["relevant", "recent", "liked"]);

  function normalizePostUrl(href, baseUrl = "https://x.com/") {
    if (!href || typeof href !== "string") return null;
    let url;
    try {
      url = new URL(href, baseUrl);
    } catch {
      return null;
    }

    if (!/^(?:x|twitter)\.com$/i.test(url.hostname.replace(/^www\./, ""))) return null;
    const match = url.pathname.match(STATUS_PATTERN);
    if (!match) return null;
    return `https://x.com/${match[1]}/status/${match[2]}`;
  }

  function postIdFromUrl(href) {
    const normalized = normalizePostUrl(href);
    return normalized ? normalized.match(/\/status\/(\d+)$/)?.[1] ?? null : null;
  }

  function uniqueByPostId(items) {
    const seen = new Set();
    return items.filter((item) => {
      const id = postIdFromUrl(item.url);
      if (!id || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function actionNameFromMetadata(testId = "", ariaLabel = "") {
    const id = String(testId);
    if (id === "reply") return "reply";
    if (id === "retweet" || id === "unretweet") return "retweet";
    if (id === "like" || id === "unlike") return "like";
    if (id === "bookmark" || id === "removeBookmark") return "bookmark";
    if (id === "caret") return "more";
    if (/分享帖子|share post/i.test(String(ariaLabel))) return "share";
    return null;
  }

  function normalizeReplySort(value) {
    return REPLY_SORTS.has(value) ? value : "relevant";
  }

  function parseCompactCount(value) {
    const normalized = String(value ?? "").replace(/,/g, "").trim();
    const match = normalized.match(/(\d+(?:\.\d+)?)\s*([KMB]|万)?/i);
    if (!match) return 0;
    const multipliers = { k: 1e3, m: 1e6, b: 1e9, "万": 1e4 };
    return Math.round(Number(match[1]) * (multipliers[match[2]?.toLowerCase?.() || match[2]] || 1));
  }

  function sortReplyItems(items, sort) {
    const mode = normalizeReplySort(sort);
    if (mode === "relevant") return [...items];
    return items.map((item, index) => ({ item, index })).sort((left, right) => {
      const leftValue = mode === "liked" ? Number(left.item.likeCount || 0) : Date.parse(left.item.createdAt || "") || 0;
      const rightValue = mode === "liked" ? Number(right.item.likeCount || 0) : Date.parse(right.item.createdAt || "") || 0;
      return rightValue - leftValue || left.index - right.index;
    }).map(({ item }) => item);
  }

  root.TuzaiCore = {
    normalizePostUrl,
    postIdFromUrl,
    uniqueByPostId,
    actionNameFromMetadata,
    normalizeReplySort,
    parseCompactCount,
    sortReplyItems
  };
})(globalThis);
