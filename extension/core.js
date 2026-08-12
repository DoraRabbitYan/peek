(function attachTuzaiCore(root) {
  "use strict";

  const STATUS_PATTERN = /^\/(?:i\/web\/)?([^/?#]+)\/status\/(\d+)/i;

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

  root.TuzaiCore = { normalizePostUrl, postIdFromUrl, uniqueByPostId, actionNameFromMetadata };
})(globalThis);
