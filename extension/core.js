(function attachTuzaiCore(root) {
  "use strict";

  const STATUS_PATTERN = /^\/(?:i\/web\/)?([^/?#]+)\/status\/(\d+)/i;
  const PROFILE_PATTERN = /^\/([A-Za-z0-9_]+)\/?$/;

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

  function profileHandle(profileHref) {
    return String(profileHref || "").match(PROFILE_PATTERN)?.[1]?.toLowerCase() || null;
  }

  function selectOwnPostUrl(hrefs, profileHref, baseUrl = "https://x.com/") {
    const normalized = [...new Set((hrefs || []).map((href) => normalizePostUrl(href, baseUrl)).filter(Boolean))];
    const handle = profileHandle(profileHref);
    if (!handle) return normalized[0] || null;
    return normalized.find((url) => new URL(url).pathname.split("/")[1]?.toLowerCase() === handle) || normalized[0] || null;
  }

  root.TuzaiCore = Object.freeze({
    normalizePostUrl,
    postIdFromUrl,
    profileHandle,
    selectOwnPostUrl
  });
})(typeof globalThis === "object" ? globalThis : self);
