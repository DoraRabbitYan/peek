(function initTuzaiReader() {
  "use strict";

  if (window.top !== window.self) return;

  const Core = globalThis.TuzaiCore;
  const ROOT_ID = "tuzai-x-popover-root";
  const CONTENT_SOURCE = "tuzai-content";
  const PAGE_SOURCE = "tuzai-page";
  const SORTS = Object.freeze({ relevant: "相关", latest: "最新", liked: "最多喜欢" });
  const state = {
    enabled: true,
    sourceUrl: null,
    tweetId: null,
    domFallback: null,
    focal: null,
    replies: [],
    cursor: null,
    sort: "relevant",
    sortOpen: false,
    replyTarget: null,
    replyText: "",
    loading: false,
    loadingMore: false,
    error: "",
    busy: new Set(),
    currentAvatar: "",
    pageScrollX: 0,
    pageScrollY: 0,
    toastTimer: null
  };
  const pendingRequests = new Map();
  const hlsInstances = new Set();
  let requestSequence = 0;

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function icon(name) {
    const iconName = String(name || "").replace(/^ph-/, "");
    const paths = globalThis.TuzaiPhosphorIcons?.[iconName];
    if (!paths) {
      const fallback = element("span", "tuzai-icon-fallback", "?");
      fallback.setAttribute("aria-hidden", "true");
      return fallback;
    }
    const node = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    node.setAttribute("viewBox", "0 0 256 256");
    node.setAttribute("aria-hidden", "true");
    node.classList.add("tuzai-icon");
    node.innerHTML = paths;
    return node;
  }

  function extensionUrl(path) {
    try {
      return chrome.runtime.getURL(path);
    } catch {
      return "";
    }
  }

  function requestPage(type, payload, timeoutMs = 18000) {
    const requestId = ++requestSequence;
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRequests.delete(requestId);
        reject(new Error("等待 X 响应超时，请稍后重试"));
      }, timeoutMs);
      pendingRequests.set(requestId, { resolve, reject, timer });
      window.postMessage({ source: CONTENT_SOURCE, type, requestId, ...payload }, location.origin);
    });
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== PAGE_SOURCE) return;
    const request = pendingRequests.get(event.data.requestId);
    if (!request) return;
    window.clearTimeout(request.timer);
    pendingRequests.delete(event.data.requestId);
    if (event.data.ok) request.resolve(event.data.payload);
    else request.reject(new Error(event.data.error || "X 请求失败"));
  });

  function currentThemeClass() {
    const color = getComputedStyle(document.body).backgroundColor;
    if (/rgb\(0, 0, 0\)/.test(color)) return "tuzai-theme-dark";
    if (/rgb\((?:21|22), (?:31|32), (?:42|43)\)/.test(color)) return "tuzai-theme-dim";
    return "tuzai-theme-light";
  }

  function findCurrentAvatar() {
    return document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img')?.currentSrc
      || document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"] img')?.src
      || "";
  }

  function authorProfileHref(article) {
    const userName = article.querySelector('[data-testid="User-Name"]');
    return [...(userName?.querySelectorAll("a[href]") || [])]
      .map((anchor) => anchor.getAttribute("href"))
      .find((href) => /^\/[A-Za-z0-9_]+\/?$/.test(href || "")) || null;
  }

  function findPostUrl(article) {
    const hrefs = [...article.querySelectorAll('a[href*="/status/"]')].map((anchor) => anchor.getAttribute("href"));
    return Core.selectOwnPostUrl(hrefs, authorProfileHref(article), location.href);
  }

  function normalizedStatusLinks(node) {
    return [...(node?.querySelectorAll?.('a[href*="/status/"]') || [])]
      .map((anchor) => Core.normalizePostUrl(anchor.getAttribute("href"), location.href))
      .filter(Boolean);
  }

  function clickedPostScope(article, target, url) {
    let current = target instanceof Element ? target : article;
    while (current && current !== article) {
      const hasContent = current.querySelector?.('[data-testid="User-Name"], [data-testid="tweetText"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"]');
      if (hasContent && normalizedStatusLinks(current).includes(url)) return current;
      current = current.parentElement;
    }
    return article;
  }

  function belongsToPost(node, scope, url) {
    const nestedLink = node.closest?.('[role="link"]');
    if (!nestedLink || nestedLink === scope || !scope.contains(nestedLink)) return true;
    const links = normalizedStatusLinks(nestedLink);
    const looksLikeQuotedTweet = Boolean(nestedLink.querySelector('[data-testid="User-Name"]') && nestedLink.querySelector('[data-testid="tweetText"]'));
    if (looksLikeQuotedTweet) return links.includes(url);
    return !links.length || links.includes(url);
  }

  function snapshotArticle(article, target, url) {
    const id = Core.postIdFromUrl(url);
    if (!id) return null;
    const scope = clickedPostScope(article, target, url);
    const userName = [...scope.querySelectorAll('[data-testid="User-Name"]')]
      .find((node) => belongsToPost(node, scope, url)) || null;
    const profileHref = authorProfileHref({ querySelector: () => userName });
    const handle = String(profileHref || "").match(/^\/([A-Za-z0-9_]+)/)?.[1] || new URL(url).pathname.split("/")[1] || "";
    const identityTexts = [...(userName?.querySelectorAll(`a[href="/${handle}"], a[href="/${handle}/"]`) || [])]
      .map((anchor) => anchor.innerText.trim())
      .filter(Boolean);
    const name = identityTexts.find((text) => !text.startsWith("@")) || handle || "X 用户";
    const avatarNode = [...scope.querySelectorAll('[data-testid="Tweet-User-Avatar"] img, img[src*="profile_images"]')]
      .find((node) => belongsToPost(node, scope, url));
    const textNode = [...scope.querySelectorAll('[data-testid="tweetText"]')]
      .find((node) => belongsToPost(node, scope, url));
    const timeNode = [...scope.querySelectorAll('time[datetime]')]
      .find((node) => belongsToPost(node, scope, url));
    const verified = Boolean(userName?.querySelector('svg[aria-label*="认证"], svg[aria-label*="Verified"], [data-testid="icon-verified"]'));
    const media = [];
    const seenMedia = new Set();
    for (const container of scope.querySelectorAll('[data-testid="videoPlayer"], [data-testid="tweetPhoto"]')) {
      if (!belongsToPost(container, scope, url)) continue;
      const video = container.matches('[data-testid="videoPlayer"]') ? container.querySelector("video") : null;
      const image = container.matches('[data-testid="tweetPhoto"]') ? container.querySelector("img") : null;
      const currentSrc = String(video?.currentSrc || video?.src || "");
      const poster = String(video?.poster || image?.currentSrc || image?.src || "");
      const isVideo = Boolean(video || container.matches('[data-testid="videoPlayer"]'));
      const videoUrl = /^https?:.*\.mp4(?:\?|$)/i.test(currentSrc) ? currentSrc : "";
      const hlsUrl = /^https?:.*\.m3u8(?:\?|$)/i.test(currentSrc) ? currentSrc : "";
      const key = `${isVideo ? "video" : "photo"}:${poster || currentSrc}`;
      if ((!poster && !videoUrl && !hlsUrl) || seenMedia.has(key)) continue;
      seenMedia.add(key);
      media.push({
        id: "",
        type: isVideo ? "video" : "photo",
        url: poster,
        videoUrl,
        videoVariants: videoUrl ? [{ url: videoUrl, bitrate: 0 }] : [],
        hlsUrl,
        expandedUrl: url,
        width: Number(video?.videoWidth || image?.naturalWidth) || 0,
        height: Number(video?.videoHeight || image?.naturalHeight) || 0
      });
    }
    return {
      id,
      url,
      text: textNode?.innerText || "",
      entities: [],
      author: {
        id: "",
        name,
        handle,
        avatar: String(avatarNode?.currentSrc || avatarNode?.src || "").replace("_normal.", "_200x200."),
        verified
      },
      createdAt: timeNode?.getAttribute("datetime") || "",
      conversationId: id,
      inReplyToId: "",
      counts: { replies: 0, reposts: 0, likes: 0, bookmarks: 0, quotes: 0, views: 0 },
      flags: { liked: false, reposted: false, bookmarked: false },
      media,
      quote: null
    };
  }

  function shouldSkipTarget(target) {
    if (!(target instanceof Element)) return true;
    if (target.closest('button, input, textarea, select, [contenteditable="true"], video')) return true;
    if (target.closest('[data-testid="tweetPhoto"]')) return true;
    const anchor = target.closest("a[href]");
    return Boolean(anchor && !Core.normalizePostUrl(anchor.getAttribute("href"), location.href));
  }

  function isTopLevelTweet(article) {
    return !article.parentElement?.closest('article[data-testid="tweet"]');
  }

  function closePopover() {
    const root = document.getElementById(ROOT_ID);
    const restorePagePosition = Boolean(root);
    const pageScrollX = state.pageScrollX;
    const pageScrollY = state.pageScrollY;
    destroyHlsPlayers();
    root?.remove();
    window.clearTimeout(state.toastTimer);
    Object.assign(state, {
      sourceUrl: null,
      tweetId: null,
      domFallback: null,
      focal: null,
      replies: [],
      cursor: null,
      sort: "relevant",
      sortOpen: false,
      replyTarget: null,
      replyText: "",
      loading: false,
      loadingMore: false,
      error: "",
      pageScrollX: 0,
      pageScrollY: 0
    });
    state.busy.clear();
    if (restorePagePosition) {
      window.requestAnimationFrame(() => {
        window.scrollTo(pageScrollX, pageScrollY);
        window.requestAnimationFrame(() => window.scrollTo(pageScrollX, pageScrollY));
      });
    }
  }

  function notify(message, tone = "success") {
    const dialog = document.querySelector(`#${ROOT_ID} .tuzai-dialog`);
    if (!dialog) return;
    dialog.querySelector(".tuzai-toast")?.remove();
    const toast = element("div", "tuzai-toast", message);
    toast.dataset.tone = tone;
    toast.setAttribute("role", tone === "error" ? "alert" : "status");
    dialog.append(toast);
    window.clearTimeout(state.toastTimer);
    state.toastTimer = window.setTimeout(() => toast.remove(), 2400);
  }

  function formatCount(value) {
    const count = Number(value) || 0;
    if (count >= 100000000) return `${(count / 100000000).toFixed(count >= 1000000000 ? 0 : 1)}亿`;
    if (count >= 10000) return `${(count / 10000).toFixed(count >= 100000 ? 0 : 1)}万`;
    if (count >= 1000) return new Intl.NumberFormat("zh-CN").format(count);
    return count ? String(count) : "";
  }

  function formatDate(value, compact = false) {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return "";
    if (!compact) {
      return new Intl.DateTimeFormat("zh-CN", {
        year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit"
      }).format(date);
    }
    const delta = Date.now() - date.getTime();
    if (delta >= 0 && delta < 60000) return "刚刚";
    if (delta >= 0 && delta < 3600000) return `${Math.floor(delta / 60000)}分钟`;
    if (delta >= 0 && delta < 86400000) return `${Math.floor(delta / 3600000)}小时`;
    return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(date);
  }

  function appendRichText(container, model) {
    let text = String(model.text || "");
    const ranges = [...(model.entities || [])];
    if (model.media?.length && !ranges.some((range) => range.kind === "media")) {
      text = text.replace(/\s*https:\/\/t\.co\/[A-Za-z0-9]+\s*$/, "");
    }
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor || range.start > text.length || range.end > text.length) continue;
      container.append(document.createTextNode(text.slice(cursor, range.start)));
      if (range.kind !== "media") {
        const link = element("a", "tuzai-entity-link", range.label || text.slice(range.start, range.end));
        link.href = range.url || "#";
        link.target = "_blank";
        link.rel = "noreferrer";
        container.append(link);
      }
      cursor = range.end;
    }
    container.append(document.createTextNode(text.slice(cursor)));
  }

  function authorLine(model, compact = false) {
    const wrap = element("div", "tuzai-author-line");
    const avatarLink = element("a", "tuzai-avatar-link");
    avatarLink.href = model.author.handle ? `https://x.com/${model.author.handle}` : model.url;
    avatarLink.target = "_blank";
    avatarLink.rel = "noreferrer";
    const avatar = element("span", "tuzai-avatar");
    if (model.author.avatar) {
      const image = document.createElement("img");
      image.src = model.author.avatar;
      image.alt = "";
      avatar.append(image);
    } else avatar.append(icon("ph-user"));
    avatarLink.append(avatar);

    const identity = element("div", "tuzai-author-identity");
    const nameRow = element("div", "tuzai-author-name-row");
    const name = element("a", "tuzai-author-name", model.author.name);
    name.href = avatarLink.href;
    name.target = "_blank";
    name.rel = "noreferrer";
    nameRow.append(name);
    if (model.author.verified) {
      const verified = element("span", "tuzai-verified", "✓");
      verified.setAttribute("aria-label", "认证账号");
      nameRow.append(verified);
    }
    const secondary = element("span", "tuzai-author-secondary", `@${model.author.handle || "unknown"}${compact ? ` · ${formatDate(model.createdAt, true)}` : ""}`);
    identity.append(nameRow, secondary);
    wrap.append(avatarLink, identity);
    return wrap;
  }

  function destroyHlsPlayers() {
    for (const hls of hlsInstances) {
      try { hls.destroy(); } catch { /* Already detached. */ }
    }
    hlsInstances.clear();
  }

  function videoFallback(media, model) {
    const fallback = element("a", "tuzai-video-fallback");
    fallback.href = media.expandedUrl || model.url;
    fallback.target = "_blank";
    fallback.rel = "noreferrer";
    fallback.setAttribute("aria-label", "在 X 播放视频");
    if (media.url) {
      const image = document.createElement("img");
      image.src = media.url;
      image.alt = "视频封面";
      image.loading = "lazy";
      fallback.append(image);
    }
    const badge = element("span", "tuzai-video-fallback-badge");
    badge.append(icon("ph-play-circle"), element("span", "", "在 X 播放"));
    fallback.append(badge);
    return fallback;
  }

  function playableVideo(media, model, compact, item) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const constrained = connection?.saveData || /(?:^|-)2g$/.test(connection?.effectiveType || "");
    const targetBitrate = constrained ? 256000 : connection?.effectiveType === "3g" ? 512000 : compact ? 512000 : 1200000;
    const variant = Core.selectVideoVariant(media.videoVariants, targetBitrate);
    const video = document.createElement("video");
    video.poster = media.url;
    video.controls = true;
    video.playsInline = true;
    video.preload = "none";
    video.setAttribute("fetchpriority", "low");
    video.addEventListener("play", () => {
      document.querySelectorAll(`#${ROOT_ID} video`).forEach((other) => {
        if (other !== video && !other.paused) other.pause();
      });
    });
    if (media.type === "animated_gif") {
      video.loop = true;
      video.muted = true;
    }

    const nativeHls = media.hlsUrl && video.canPlayType("application/vnd.apple.mpegurl");
    if (nativeHls) {
      video.src = media.hlsUrl;
      video.dataset.streamType = "hls-native";
      return video;
    }

    const HlsPlayer = globalThis.Hls;
    if (media.hlsUrl && HlsPlayer?.isSupported?.()) {
      const hls = new HlsPlayer({
        autoStartLoad: false,
        startLevel: -1,
        enableWorker: false,
        capLevelToPlayerSize: true,
        maxBufferLength: 15,
        maxMaxBufferLength: 30,
        backBufferLength: 10,
        abrEwmaDefaultEstimate: targetBitrate
      });
      let recoveryAttempted = false;
      hlsInstances.add(hls);
      hls.attachMedia(video);
      hls.loadSource(media.hlsUrl);
      video.dataset.streamType = "hls-adaptive";
      const startAdaptiveLoad = () => hls.startLoad(-1);
      video.addEventListener("play", startAdaptiveLoad);
      hls.on(HlsPlayer.Events.ERROR, (_event, data) => {
        if (!data?.fatal) return;
        if (!recoveryAttempted && data.type === HlsPlayer.ErrorTypes.NETWORK_ERROR) {
          recoveryAttempted = true;
          hls.startLoad(-1);
          return;
        }
        if (!recoveryAttempted && data.type === HlsPlayer.ErrorTypes.MEDIA_ERROR) {
          recoveryAttempted = true;
          hls.recoverMediaError();
          return;
        }
        hlsInstances.delete(hls);
        hls.destroy();
        video.removeEventListener("play", startAdaptiveLoad);
        if (variant?.url || media.videoUrl) {
          video.src = variant?.url || media.videoUrl;
          video.dataset.bitrate = String(variant?.bitrate || "");
          video.dataset.streamType = "mp4-progressive-fallback";
          video.load();
        } else if (item.contains(video)) item.replaceChildren(videoFallback(media, model));
      });
      return video;
    }

    if (variant?.url || media.videoUrl) {
      video.src = variant?.url || media.videoUrl;
      video.dataset.bitrate = String(variant?.bitrate || "");
      video.dataset.streamType = "mp4-progressive";
      return video;
    }
    return null;
  }

  function mediaGrid(model, compact = false) {
    if (!model.media?.length) return null;
    const firstMedia = model.media[0];
    const singleVideo = model.media.length === 1 && (firstMedia.type === "video" || firstMedia.type === "animated_gif");
    const grid = element("div", `tuzai-media-grid tuzai-media-${Math.min(model.media.length, 4)}${compact ? " tuzai-media-compact" : ""}${singleVideo ? " tuzai-media-single-video" : ""}`);
    for (const media of model.media.slice(0, 4)) {
      const item = element("div", "tuzai-media-item");
      const isVideo = media.type === "video" || media.type === "animated_gif";
      if (singleVideo) {
        const width = Number(media.width) || 16;
        const height = Number(media.height) || 9;
        item.style.aspectRatio = `${width} / ${height}`;
      }
      if (isVideo) {
        const video = playableVideo(media, model, compact, item);
        if (video) {
          const play = element("button", "tuzai-video-play");
          play.type = "button";
          play.setAttribute("aria-label", "播放视频");
          play.append(icon("ph-play"));
          play.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            video.play().catch(() => {});
          });
          video.addEventListener("play", () => { play.hidden = true; });
          video.addEventListener("playing", () => { play.hidden = true; });
          video.addEventListener("pause", () => { play.hidden = false; });
          video.addEventListener("ended", () => { play.hidden = false; });
          video.addEventListener("click", (event) => event.stopPropagation());
          video.addEventListener("loadedmetadata", () => {
            if (singleVideo && video.videoWidth > 0 && video.videoHeight > 0) item.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
          });
          item.append(video, play);
        } else item.append(videoFallback(media, model));
      } else {
        const image = document.createElement("img");
        image.src = media.url;
        image.alt = "帖子图片";
        image.loading = "lazy";
        item.append(image);
      }
      grid.append(item);
    }
    return grid;
  }

  function quoteCard(model) {
    if (!model.quote) return null;
    const quote = element("section", "tuzai-quote-card");
    const quoteLink = element("a", "tuzai-quote-link");
    quoteLink.href = model.quote.url;
    quoteLink.target = "_blank";
    quoteLink.rel = "noreferrer";
    quoteLink.setAttribute("aria-label", `在 X 打开 @${model.quote.author.handle || "unknown"} 的引用帖`);
    const heading = element("div", "tuzai-quote-heading");
    const name = element("strong", "", model.quote.author.name);
    heading.append(name);
    if (model.quote.author.verified) heading.append(element("span", "tuzai-verified", "✓"));
    heading.append(element("span", "", `@${model.quote.author.handle}`));
    const text = element("div", "tuzai-quote-text");
    appendRichText(text, model.quote);
    quoteLink.append(heading);
    quote.append(quoteLink, text);
    const media = mediaGrid(model.quote, true);
    if (media) quote.append(media);
    return quote;
  }

  function actionButton(model, action, iconName, label, count) {
    const button = element("button", `tuzai-action tuzai-action-${action}`);
    button.type = "button";
    button.setAttribute("aria-label", label);
    const active = action === "like" ? model.flags.liked : action === "repost" ? model.flags.reposted : action === "bookmark" ? model.flags.bookmarked : false;
    if (active) button.dataset.active = "true";
    const busyKey = `${model.id}:${action}`;
    if (state.busy.has(busyKey)) {
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
    }
    button.append(icon(iconName));
    const formatted = formatCount(count);
    if (formatted) button.append(element("span", "", formatted));
    button.addEventListener("click", () => handleAction(model, action));
    return button;
  }

  function actionBar(model, compact = false) {
    const bar = element("div", `tuzai-actions${compact ? " tuzai-actions-compact" : ""}`);
    bar.append(
      actionButton(model, "reply", "ph-chat-circle", "回复", model.counts.replies),
      actionButton(model, "repost", "ph-arrows-clockwise", model.flags.reposted ? "取消转发" : "转发", model.counts.reposts),
      actionButton(model, "like", "ph-heart", model.flags.liked ? "取消喜欢" : "喜欢", model.counts.likes),
      actionButton(model, "bookmark", "ph-bookmark-simple", model.flags.bookmarked ? "移除书签" : "加入书签", model.counts.bookmarks),
      actionButton(model, "share", "ph-upload-simple", "分享")
    );
    return bar;
  }

  function renderPost(model) {
    const article = element("article", "tuzai-post-card");
    const header = authorLine(model);
    const open = element("a", "tuzai-post-more");
    open.href = model.url;
    open.target = "_blank";
    open.rel = "noreferrer";
    open.setAttribute("aria-label", "在 X 打开帖子");
    open.append(icon("ph-dots-three"));
    header.append(open);
    const text = element("div", "tuzai-post-text");
    appendRichText(text, model);
    article.append(header, text);
    const media = mediaGrid(model);
    if (media) article.append(media);
    const quote = quoteCard(model);
    if (quote) article.append(quote);
    const meta = element("div", "tuzai-post-meta");
    meta.append(element("span", "", formatDate(model.createdAt)));
    if (model.counts.views) {
      meta.append(document.createTextNode(" · "), element("strong", "", formatCount(model.counts.views)), document.createTextNode(" 查看"));
    }
    article.append(meta, actionBar(model));
    return article;
  }

  function renderReply(model) {
    const article = element("article", "tuzai-reply-card");
    article.style.setProperty("--tuzai-depth", String(model.depth || 0));
    article.dataset.depth = String(model.depth || 0);
    const header = authorLine(model, true);
    const text = element("div", "tuzai-reply-text");
    appendRichText(text, model);
    const body = element("div", "tuzai-reply-body");
    body.append(header, text);
    const media = mediaGrid(model, true);
    if (media) body.append(media);
    const quote = quoteCard(model);
    if (quote) body.append(quote);
    body.append(actionBar(model, true));
    article.append(body);
    return article;
  }

  function loadingState(label) {
    const wrap = element("div", "tuzai-state");
    wrap.append(element("span", "tuzai-spinner"), element("strong", "", label), element("p", "", "正在通过当前登录的 X 会话读取帖子数据"));
    return wrap;
  }

  function errorState(message) {
    const wrap = element("div", "tuzai-state");
    wrap.append(icon("ph-warning-circle"), element("strong", "", "帖子暂时没有加载出来"), element("p", "", message));
    const retry = element("button", "", "重试");
    retry.type = "button";
    retry.addEventListener("click", () => fetchThread());
    wrap.append(retry);
    return wrap;
  }

  function sortedReplies() {
    const replies = [...state.replies];
    if (state.sort === "latest") return replies.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    if (state.sort === "liked") return replies.sort((left, right) => right.counts.likes - left.counts.likes);
    return replies;
  }

  function renderSortMenu(container) {
    if (!state.sortOpen) return;
    const menu = element("div", "tuzai-sort-menu");
    menu.setAttribute("role", "listbox");
    for (const [value, label] of Object.entries(SORTS)) {
      const option = element("button", "tuzai-sort-option");
      option.type = "button";
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(state.sort === value));
      option.append(element("span", "", label));
      if (state.sort === value) option.append(icon("ph-check"));
      option.addEventListener("click", () => {
        state.sort = value;
        state.sortOpen = false;
        renderReader();
      });
      menu.append(option);
    }
    container.append(menu);
  }

  function renderReplyTools(container) {
    container.replaceChildren();
    if (!state.focal) return;
    const context = element("div", "tuzai-context-row");
    const sort = element("div", "tuzai-sort-control");
    const trigger = element("button", "tuzai-sort-trigger");
    trigger.type = "button";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", String(state.sortOpen));
    trigger.append(element("span", "", SORTS[state.sort]), icon("ph-caret-down"));
    trigger.addEventListener("click", () => {
      state.sortOpen = !state.sortOpen;
      renderReader();
    });
    sort.append(trigger);
    renderSortMenu(sort);
    const quotes = element("a", "tuzai-quotes-link", "查看引用");
    quotes.href = `${state.focal.url}/quotes`;
    quotes.target = "_blank";
    quotes.rel = "noreferrer";
    quotes.append(icon("ph-caret-right"));
    context.append(sort, quotes);

    const composer = element("section", "tuzai-composer");
    const avatar = element("span", "tuzai-composer-avatar");
    if (state.currentAvatar) {
      const image = document.createElement("img");
      image.src = state.currentAvatar;
      image.alt = "";
      avatar.append(image);
    } else avatar.append(icon("ph-user"));
    const body = element("div", "tuzai-composer-body");
    const target = state.replyTarget || state.focal;
    const label = target.id === state.focal.id ? "原帖" : `@${target.author.handle}`;
    const targetRow = element("div", "tuzai-composer-target", `回复 ${label}`);
    if (target.id !== state.focal.id) {
      const cancel = element("button", "", "取消");
      cancel.type = "button";
      cancel.addEventListener("click", () => {
        state.replyTarget = state.focal;
        renderReader();
      });
      targetRow.append(cancel);
    }
    const textarea = document.createElement("textarea");
    textarea.rows = 2;
    textarea.maxLength = 280;
    textarea.value = state.replyText;
    textarea.placeholder = `发布你对${label}的回复`;
    textarea.setAttribute("aria-label", "发布你的回复");
    const counter = element("span", "tuzai-composer-count", `${state.replyText.length}/280`);
    const submit = element("button", "tuzai-reply-submit", "回复");
    submit.type = "button";
    submit.disabled = !state.replyText.trim() || state.busy.has("reply");
    textarea.addEventListener("input", () => {
      state.replyText = textarea.value;
      counter.textContent = `${textarea.value.length}/280`;
      submit.disabled = !textarea.value.trim() || state.busy.has("reply");
    });
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && textarea.value.trim()) publishReply();
    });
    submit.addEventListener("click", publishReply);
    body.append(targetRow, textarea, counter);
    composer.append(avatar, body, submit);
    container.append(context, composer);
  }

  function renderReader() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const postBody = root.querySelector(".tuzai-post-body");
    const replyTools = root.querySelector(".tuzai-reply-tools");
    const replyList = root.querySelector(".tuzai-reply-list");
    const count = root.querySelector(".tuzai-reply-count");
    if (!postBody || !replyTools || !replyList || !count) return;
    destroyHlsPlayers();
    postBody.replaceChildren();
    replyList.replaceChildren();
    count.textContent = state.focal ? formatCount(state.focal.counts.replies || state.replies.length) || "0" : "…";

    if (state.loading) {
      postBody.append(loadingState("正在加载原帖"));
      replyList.append(loadingState("正在加载评论"));
      replyTools.replaceChildren();
      return;
    }
    if (state.error || !state.focal) {
      postBody.append(errorState(state.error || "X 没有返回原帖数据"));
      replyList.append(errorState(state.error || "X 没有返回评论数据"));
      replyTools.replaceChildren();
      return;
    }

    postBody.append(renderPost(state.focal));
    renderReplyTools(replyTools);
    const replies = sortedReplies();
    if (!replies.length) {
      const empty = element("div", "tuzai-state");
      empty.append(icon("ph-chat-circle"), element("strong", "", "暂时还没有评论"), element("p", "", "你可以在上方发布第一条纯文字回复"));
      replyList.append(empty);
    } else {
      replies.forEach((reply) => replyList.append(renderReply(reply)));
    }
    if (state.cursor) {
      const loadMore = element("button", "tuzai-load-more", state.loadingMore ? "正在加载…" : "加载更多评论");
      loadMore.type = "button";
      loadMore.disabled = state.loadingMore;
      loadMore.addEventListener("click", () => fetchMore());
      replyList.append(loadMore);
    }
  }

  function mergeReplies(items) {
    const map = new Map(state.replies.map((reply) => [reply.id, reply]));
    for (const reply of items) map.set(reply.id, { ...map.get(reply.id), ...reply });
    state.replies = [...map.values()];
  }

  async function fetchThread() {
    if (!state.tweetId) return;
    state.loading = true;
    state.error = "";
    renderReader();
    try {
      const json = await requestPage("READ_THREAD", { tweetId: state.tweetId });
      if (!document.getElementById(ROOT_ID)) return;
      const parsed = Core.parseTweetDetail(json, state.tweetId);
      state.focal = Core.mergeModelFallback(parsed.focal, state.domFallback);
      if (!state.focal) throw new Error("X 返回了数据，但没有找到这条原帖");
      state.replies = parsed.replies;
      state.cursor = parsed.cursor;
      state.replyTarget = state.focal;
    } catch (error) {
      state.error = error instanceof Error ? error.message : "读取帖子失败";
    } finally {
      state.loading = false;
      renderReader();
    }
  }

  async function fetchMore() {
    if (!state.tweetId || !state.cursor || state.loadingMore) return;
    const previousCursor = state.cursor;
    state.loadingMore = true;
    renderReader();
    try {
      const json = await requestPage("READ_THREAD", { tweetId: state.tweetId, cursor: previousCursor });
      const parsed = Core.parseTweetDetail(json, state.tweetId);
      mergeReplies(parsed.replies);
      state.cursor = parsed.cursor && parsed.cursor !== previousCursor ? parsed.cursor : null;
    } catch (error) {
      notify(error instanceof Error ? error.message : "加载更多失败", "error");
    } finally {
      state.loadingMore = false;
      renderReader();
    }
  }

  function findModel(tweetId) {
    if (state.focal?.id === tweetId) return state.focal;
    return state.replies.find((reply) => reply.id === tweetId) || null;
  }

  async function copyPostUrl(model) {
    try {
      await navigator.clipboard.writeText(model.url);
      notify("帖子链接已复制");
    } catch {
      window.open(model.url, "_blank", "noopener");
    }
  }

  async function handleAction(model, action) {
    if (action === "reply") {
      state.replyTarget = model;
      renderReader();
      document.querySelector(`#${ROOT_ID} .tuzai-composer textarea`)?.focus();
      return;
    }
    if (action === "share") return copyPostUrl(model);
    if (!["like", "repost", "bookmark"].includes(action)) return;
    const busyKey = `${model.id}:${action}`;
    if (state.busy.has(busyKey)) return;
    const flag = action === "like" ? "liked" : action === "repost" ? "reposted" : "bookmarked";
    const count = action === "like" ? "likes" : action === "repost" ? "reposts" : "bookmarks";
    const wasActive = Boolean(model.flags[flag]);
    state.busy.add(busyKey);
    model.flags[flag] = !wasActive;
    model.counts[count] = Math.max(0, model.counts[count] + (wasActive ? -1 : 1));
    renderReader();
    try {
      await requestPage("TOGGLE_ACTION", { tweetId: model.id, action, active: wasActive });
      notify(action === "like" ? "点赞状态已同步" : action === "repost" ? "转发状态已同步" : "收藏状态已同步");
    } catch (error) {
      const current = findModel(model.id);
      if (current) {
        current.flags[flag] = wasActive;
        current.counts[count] = Math.max(0, current.counts[count] + (wasActive ? 1 : -1));
      }
      notify(error instanceof Error ? error.message : "操作失败", "error");
    } finally {
      state.busy.delete(busyKey);
      renderReader();
    }
  }

  async function publishReply() {
    const text = state.replyText.trim();
    const target = state.replyTarget || state.focal;
    if (!text || !target || state.busy.has("reply")) return;
    state.busy.add("reply");
    renderReader();
    try {
      const json = await requestPage("CREATE_REPLY", { tweetId: target.id, text });
      const created = Core.collectTweetModels(json).find((model) => model.id !== state.focal?.id);
      if (created) {
        created.depth = target.id === state.focal.id ? 0 : Math.min((target.depth || 0) + 1, 3);
        mergeReplies([created]);
      }
      if (state.focal) state.focal.counts.replies += 1;
      state.replyText = "";
      state.replyTarget = state.focal;
      notify("回复已发布到 X");
    } catch (error) {
      notify(error instanceof Error ? error.message : "回复发布失败", "error");
    } finally {
      state.busy.delete("reply");
      renderReader();
    }
  }

  function createIconButton(name, label, className = "") {
    const button = element("button", `tuzai-icon-button ${className}`.trim());
    button.type = "button";
    button.setAttribute("aria-label", label);
    button.append(icon(name));
    return button;
  }

  function openPopover(url, domFallback = null) {
    closePopover();
    state.sourceUrl = url;
    state.tweetId = Core.postIdFromUrl(url);
    state.domFallback = domFallback;
    state.currentAvatar = findCurrentAvatar();
    state.pageScrollX = window.scrollX;
    state.pageScrollY = window.scrollY;

    const root = element("div", `tuzai-overlay ${currentThemeClass()}`);
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "帖子浮层阅读器");
    root.addEventListener("wheel", (event) => {
      if (!event.target.closest?.(".tuzai-scroll-area")) event.preventDefault();
    }, { passive: false });
    const backdrop = element("button", "tuzai-backdrop");
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "关闭浮层");
    backdrop.addEventListener("click", closePopover);
    const dialog = element("section", "tuzai-dialog");
    dialog.innerHTML = `
      <header class="tuzai-toolbar">
        <div class="tuzai-brand"><span class="tuzai-brand-icon"></span><div><strong>帖子浮层</strong><span>主页位置已保留</span></div></div>
        <div class="tuzai-toolbar-actions"></div>
      </header>
      <div class="tuzai-reader-grid">
        <section class="tuzai-pane tuzai-post-pane">
          <header class="tuzai-pane-header"><div><strong>原帖</strong><span>内容与基础互动</span></div><span class="tuzai-interactive-pill">独立滚动</span></header>
          <div class="tuzai-scroll-area tuzai-post-body"></div>
        </section>
        <section class="tuzai-pane tuzai-replies-pane">
          <header class="tuzai-pane-header"><div><strong>评论</strong><span>按 X 默认顺序</span></div><span class="tuzai-reply-count">…</span></header>
          <div class="tuzai-reply-tools"></div>
          <div class="tuzai-scroll-area tuzai-reply-list"></div>
        </section>
      </div>
      <footer class="tuzai-footer"><span class="tuzai-footer-privacy">数据与操作直接使用当前登录的 X 会话，不经过第三方服务器</span><span>Esc 关闭</span></footer>`;
    dialog.querySelector(".tuzai-footer-privacy").prepend(icon("ph-lock-key"));
    const brandIcon = dialog.querySelector(".tuzai-brand-icon");
    const iconUrl = extensionUrl("icons/icon48.png");
    if (iconUrl) {
      const image = document.createElement("img");
      image.src = iconUrl;
      image.alt = "";
      brandIcon.replaceWith(image);
    } else brandIcon.append(icon("ph-chat-circle"));
    const openOriginal = createIconButton("ph-arrow-square-out", "在 X 详情页打开");
    openOriginal.addEventListener("click", () => window.open(url, "_blank", "noopener"));
    const close = createIconButton("ph-x", "关闭", "tuzai-close");
    close.addEventListener("click", closePopover);
    dialog.querySelector(".tuzai-toolbar-actions").append(openOriginal, close);
    root.append(backdrop, dialog);
    document.body.append(root);
    close.focus();
    renderReader();
    fetchThread();
  }

  function handleTimelineClick(event) {
    if (!state.enabled || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (document.getElementById(ROOT_ID)) return;
    const article = event.target.closest?.('article[data-testid="tweet"]');
    if (!article || !isTopLevelTweet(article) || shouldSkipTarget(event.target)) return;
    const targetAnchor = event.target.closest?.('a[href*="/status/"]');
    const url = Core.normalizePostUrl(targetAnchor?.getAttribute("href"), location.href) || findPostUrl(article);
    if (!url) return;
    const domFallback = snapshotArticle(article, event.target, url);
    event.preventDefault();
    event.stopImmediatePropagation();
    openPopover(url, domFallback);
  }

  document.addEventListener("click", handleTimelineClick, true);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.getElementById(ROOT_ID)) return;
    if (state.sortOpen) {
      state.sortOpen = false;
      renderReader();
    } else closePopover();
  });

  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type !== "TUZAI_SET_ENABLED") return;
      state.enabled = Boolean(message.enabled);
      if (!state.enabled) closePopover();
    });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "sync" || !changes.enabled) return;
      state.enabled = Boolean(changes.enabled.newValue);
      if (!state.enabled) closePopover();
    });
    chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => { state.enabled = Boolean(enabled); }).catch(() => {});
  } catch {
    // A stale content script after an extension reload stays inert until the X tab refreshes.
  }
})();
