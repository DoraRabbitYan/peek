(function initTuzaiReader() {
  "use strict";

  if (window.top !== window.self) return;

  const Core = globalThis.TuzaiCore;
  const ROOT_ID = "tuzai-x-popover-root";
  const CONTENT_SOURCE = "tuzai-content";
  const PAGE_SOURCE = "tuzai-page";
  const SORTS = Object.freeze({ relevant: "相关", latest: "最新", liked: "最多喜欢" });
  const TARGET_LANGUAGE = "zh-cn";
  const MAX_TRANSLATION_CONCURRENCY = 2;
  const state = {
    enabled: true,
    autoTranslate: true,
    sourceUrl: null,
    tweetId: null,
    domFallback: null,
    focal: null,
    ancestors: [],
    focusFocalOnRender: false,
    resetPostScrollOnRender: false,
    replies: [],
    pinnedReplyIds: [],
    scrollRepliesToTop: false,
    cursor: null,
    sort: "relevant",
    sortOpen: false,
    replyTarget: null,
    replyText: "",
    composerExpanded: false,
    loading: false,
    loadingMore: false,
    error: "",
    translationSettingsOpenFor: "",
    busy: new Set(),
    currentAvatar: "",
    pageScrollX: 0,
    pageScrollY: 0,
    toastTimer: null
  };
  const pendingRequests = new Map();
  const hlsInstances = new Set();
  const videoWarmupTasks = new WeakMap();
  let requestSequence = 0;
  let replyLoadObserver = null;
  let translationObserver = null;
  let videoWarmupObserver = null;
  let sharedVideoBandwidthEstimate = 0;
  let activeTranslationCount = 0;
  const translationCache = new Map();
  const translationDisplay = new Map();
  const translationQueue = [];
  const queuedTranslations = new Set();
  const renderedTranslationModels = new Map();
  const quoteResolutionRequests = new Map();
  let profileCardShowTimer = null;
  let profileCardHideTimer = null;
  let activeProfileCard = null;
  let activeProfileCardKey = "";
  let activeProfileAnchor = null;
  const PROFILE_CARD_SHOW_DELAY = 350;
  const PROFILE_CARD_HIDE_DELAY = 650;

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

  function isQuotedPostLink(node) {
    const hasIdentity = node?.querySelector?.('[data-testid="Tweet-User-Avatar"], [data-testid="User-Name"]');
    const hasQuotedContent = node?.querySelector?.(
      '[data-testid="tweetText"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"], [data-testid="article-cover-image"]'
    );
    return Boolean(node?.matches?.('[role="link"][tabindex="0"]') && hasIdentity && hasQuotedContent);
  }

  function findClickedQuoteScope(article, target) {
    if (!(target instanceof Element)) return null;
    let current = target;
    while (current && current !== article) {
      if (isQuotedPostLink(current)) return current;
      current = current.parentElement;
    }
    return null;
  }

  function findClickedQuotedPostUrl(article, target) {
    const quoteScope = findClickedQuoteScope(article, target);
    if (!quoteScope) return null;
    const ownUrl = findPostUrl(article);
    const directUrl = quoteScope.matches('a[href*="/status/"]')
      ? Core.normalizePostUrl(quoteScope.getAttribute("href"), location.href)
      : null;
    return [directUrl, ...normalizedStatusLinks(quoteScope)]
      .find((url) => url && url !== ownUrl) || null;
  }

  function clickedPostScope(article, target, url) {
    const quoteScope = findClickedQuoteScope(article, target);
    if (quoteScope && url !== findPostUrl(article)) return quoteScope;
    let current = target instanceof Element ? target : article;
    while (current && current !== article) {
      const hasContent = current.querySelector?.('[data-testid="User-Name"], [data-testid="tweetText"], [data-testid="tweetPhoto"], [data-testid="videoPlayer"]');
      if (hasContent && normalizedStatusLinks(current).includes(url)) return current;
      current = current.parentElement;
    }
    return article;
  }

  function belongsToPost(node, scope, url) {
    let current = node instanceof Element ? node : node?.parentElement;
    while (current && current !== scope) {
      if (current.matches?.('[role="link"]')) {
        const links = normalizedStatusLinks(current);
        const looksLikeQuotedTweet = isQuotedPostLink(current)
          || Boolean(current.querySelector('[data-testid="User-Name"]') && current.querySelector('[data-testid="tweetText"]'));
        if (looksLikeQuotedTweet) return links.includes(url);
        if (links.length && !links.includes(url)) return false;
      }
      current = current.parentElement;
    }
    return true;
  }

  function snapshotAttachment(scope, url) {
    const articleCover = [...scope.querySelectorAll('[data-testid="article-cover-image"]')]
      .find((node) => belongsToPost(node, scope, url));
    if (articleCover) {
      const card = articleCover.parentElement;
      const lines = String(card?.innerText || "")
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line && line !== "文章");
      const image = articleCover.querySelector('img[alt="文章封面图片"], img');
      const articleLink = [...scope.querySelectorAll('[data-testid="tweetText"] a[href], a[href*="/i/article/"]')]
        .map((anchor) => anchor.href)
        .find((href) => /(?:x|twitter)\.com\/i\/article\//i.test(href)) || "";
      return {
        type: "article",
        url: articleLink,
        sourceUrl: "",
        domain: "x.com",
        title: lines[0] || "",
        description: lines.slice(1).join("\n"),
        image: String(image?.currentSrc || image?.src || ""),
        imageWidth: Number(image?.naturalWidth) || 0,
        imageHeight: Number(image?.naturalHeight) || 0
      };
    }

    const card = [...scope.querySelectorAll('[data-testid="card.wrapper"]')]
      .find((node) => belongsToPost(node, scope, url));
    if (!card) return null;
    const anchor = card.querySelector('a[href]');
    const ariaLabel = String(anchor?.getAttribute("aria-label") || "").trim();
    const domain = ariaLabel.split(/\s+/)[0] || "";
    const title = String(card.innerText || "").trim() || ariaLabel.slice(domain.length).trim();
    const image = card.querySelector("img");
    return {
      type: "website",
      url: String(anchor?.href || ""),
      sourceUrl: String(anchor?.getAttribute("href") || ""),
      domain,
      title,
      description: "",
      image: String(image?.currentSrc || image?.src || ""),
      imageWidth: Number(image?.naturalWidth) || 0,
      imageHeight: Number(image?.naturalHeight) || 0
    };
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
    const translationSource = [...scope.querySelectorAll("span, button")]
      .map((node) => String(node.innerText || "").trim())
      .find((text) => /^翻译自\s+/.test(text));
    const showsTranslatedText = Boolean(translationSource && [...scope.querySelectorAll("button, a, span")]
      .some((node) => String(node.innerText || "").trim() === "显示原文"));
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
        height: Number(video?.videoHeight || image?.naturalHeight) || 0,
        playbackWidth: Number(video?.videoWidth) || 0,
        playbackHeight: Number(video?.videoHeight) || 0
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
      attachment: snapshotAttachment(scope, url),
      quote: null,
      translation: showsTranslatedText ? {
        text: textNode?.innerText || "",
        localizedSourceLanguage: translationSource.replace(/^翻译自\s+/, ""),
        sourceLanguage: "",
        destinationLanguage: TARGET_LANGUAGE
      } : null
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
    disconnectReplyLoadObserver();
    disconnectTranslationObserver();
    clearQueuedTranslations();
    removeProfileCard();
    root?.remove();
    window.clearTimeout(state.toastTimer);
    Object.assign(state, {
      sourceUrl: null,
      tweetId: null,
      domFallback: null,
      focal: null,
      ancestors: [],
      focusFocalOnRender: false,
      resetPostScrollOnRender: false,
      replies: [],
      pinnedReplyIds: [],
      scrollRepliesToTop: false,
      cursor: null,
      sort: "relevant",
      sortOpen: false,
      replyTarget: null,
      replyText: "",
      composerExpanded: false,
      loading: false,
      loadingMore: false,
      error: "",
      translationSettingsOpenFor: "",
      pageScrollX: 0,
      pageScrollY: 0
    });
    state.busy.clear();
    translationDisplay.clear();
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

  function notifyPage(message) {
    document.querySelector(".tuzai-page-notice")?.remove();
    const notice = element("div", "tuzai-page-notice", message);
    notice.setAttribute("role", "alert");
    document.body.append(notice);
    window.setTimeout(() => notice.remove(), 3600);
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
    const attachmentUrls = new Set([model.attachment?.url, model.attachment?.sourceUrl].filter(Boolean));
    const ranges = [...(model.entities || [])].map((range) => {
      if (range.kind === "url" && attachmentUrls.has(range.url)) return { ...range, kind: "attachment" };
      return range;
    });
    if ((model.media?.length || model.attachment) && !ranges.some((range) => range.kind === "media" || range.kind === "attachment")) {
      text = text.replace(/\s*https:\/\/t\.co\/[A-Za-z0-9]+\s*$/, "");
    }
    let cursor = 0;
    for (const range of ranges) {
      if (range.start < cursor || range.start > text.length || range.end > text.length) continue;
      container.append(document.createTextNode(text.slice(cursor, range.start)));
      if (range.kind !== "media" && range.kind !== "attachment") {
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

  function translationKey(model) {
    return `${model?.id || ""}:${TARGET_LANGUAGE}`;
  }

  function shouldOfferTranslation(model) {
    const text = String(model?.text || "")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/@[A-Za-z0-9_]+/g, " ")
      .trim();
    if (!text) return false;
    const hanCount = (text.match(/[\u3400-\u9fff]/g) || []).length;
    const latinCount = (text.match(/[A-Za-z\u00c0-\u024f]/g) || []).length;
    const japaneseKoreanCount = (text.match(/[\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
    const cyrillicCount = (text.match(/[\u0400-\u04ff]/g) || []).length;
    if (japaneseKoreanCount >= 2 || cyrillicCount >= 4) return true;
    return latinCount >= 6 && hanCount < Math.max(4, latinCount * 0.35);
  }

  function sourceLanguageLabel(entry) {
    if (entry?.localizedSourceLanguage) return entry.localizedSourceLanguage;
    const language = String(entry?.sourceLanguage || "").toLowerCase();
    return ({ en: "英语", ja: "日语", ko: "韩语", es: "西班牙语", fr: "法语", de: "德语", ru: "俄语" })[language] || "外语";
  }

  function showingTranslation(model, entry) {
    const preference = translationDisplay.get(model.id);
    return entry?.status === "ready" && (preference === "translation" || (state.autoTranslate && preference !== "original"));
  }

  function disconnectTranslationObserver() {
    translationObserver?.disconnect();
    translationObserver = null;
  }

  function clearQueuedTranslations() {
    while (translationQueue.length) {
      const task = translationQueue.shift();
      const key = translationKey(task.model);
      queuedTranslations.delete(key);
      if (translationCache.get(key)?.status === "queued") translationCache.delete(key);
    }
  }

  function updateTranslationNodes(tweetId) {
    const root = document.getElementById(ROOT_ID);
    const model = findModel(tweetId) || renderedTranslationModels.get(tweetId);
    if (!root || !model) return;
    for (const block of root.querySelectorAll(".tuzai-translatable")) {
      if (block.dataset.translationId === tweetId) renderTranslationBlockContent(block, model);
    }
  }

  function pumpTranslations() {
    while (activeTranslationCount < MAX_TRANSLATION_CONCURRENCY && translationQueue.length) {
      const task = translationQueue.shift();
      const key = translationKey(task.model);
      queuedTranslations.delete(key);
      activeTranslationCount += 1;
      translationCache.set(key, { status: "loading" });
      updateTranslationNodes(task.model.id);
      requestPage("TRANSLATE_TWEET", { tweetId: task.model.id, targetLanguage: TARGET_LANGUAGE }, 20000)
        .then((result) => {
          const translatedText = String(result?.text || "").trim();
          if (!translatedText || translatedText === String(task.model.text || "").trim()) {
            translationCache.set(key, { status: "unavailable" });
            return;
          }
          translationCache.set(key, {
            status: "ready",
            text: translatedText,
            sourceLanguage: String(result.sourceLanguage || ""),
            localizedSourceLanguage: String(result.localizedSourceLanguage || ""),
            destinationLanguage: String(result.destinationLanguage || TARGET_LANGUAGE)
          });
        })
        .catch((error) => {
          translationCache.set(key, { status: "error", message: error instanceof Error ? error.message : "翻译失败" });
        })
        .finally(() => {
          activeTranslationCount -= 1;
          updateTranslationNodes(task.model.id);
          pumpTranslations();
        });
    }
  }

  function enqueueTranslation(model, priority = false, force = false) {
    if (!shouldOfferTranslation(model)) return;
    const key = translationKey(model);
    const cached = translationCache.get(key);
    if (!force && (cached?.status === "ready" || cached?.status === "queued" || cached?.status === "loading" || cached?.status === "unavailable")) return;
    if (force) translationCache.delete(key);
    if (queuedTranslations.has(key)) return;
    queuedTranslations.add(key);
    translationCache.set(key, { status: "queued" });
    const task = { model };
    if (priority) translationQueue.unshift(task);
    else translationQueue.push(task);
    updateTranslationNodes(model.id);
    pumpTranslations();
  }

  function seedDomTranslation(model, translation) {
    const text = String(translation?.text || "").trim();
    if (!model?.id || !text || text === String(model.text || "").trim()) return;
    translationCache.set(translationKey(model), {
      status: "ready",
      text,
      sourceLanguage: String(translation.sourceLanguage || ""),
      localizedSourceLanguage: String(translation.localizedSourceLanguage || ""),
      destinationLanguage: String(translation.destinationLanguage || TARGET_LANGUAGE)
    });
  }

  function translationSettings(model) {
    const menu = element("div", "tuzai-translation-settings");
    const option = element("button", "tuzai-translation-setting");
    option.type = "button";
    option.setAttribute("role", "switch");
    option.setAttribute("aria-checked", String(state.autoTranslate));
    option.append(
      element("span", "", "自动翻译外语帖子"),
      element("span", "tuzai-translation-switch", state.autoTranslate ? "已开启" : "已关闭")
    );
    option.addEventListener("click", async (event) => {
      event.stopPropagation();
      const enabled = !state.autoTranslate;
      state.autoTranslate = enabled;
      state.translationSettingsOpenFor = "";
      if (enabled) translationDisplay.delete(model.id);
      refreshTranslationBlocks();
      scheduleTranslationWork();
      try {
        await chrome.storage.sync.set({ autoTranslate: enabled });
        notify(enabled ? "已开启自动翻译外语帖子" : "已关闭自动翻译");
      } catch {
        notify("翻译设置保存失败，请重新加载插件后再试", "error");
      }
    });
    menu.append(option, element("p", "", "译文由当前登录的 X 会话提供"));
    return menu;
  }

  function closeTranslationSettingsFromOutside(event) {
    if (!state.translationSettingsOpenFor) return;
    const target = event.target;
    if (target instanceof Element && target.closest(".tuzai-translation-settings, .tuzai-translation-gear")) return;
    state.translationSettingsOpenFor = "";
    const root = document.getElementById(ROOT_ID);
    root?.querySelectorAll(".tuzai-translation-settings").forEach((menu) => menu.remove());
    root?.querySelectorAll('.tuzai-translation-gear[aria-expanded="true"]')
      .forEach((gear) => gear.setAttribute("aria-expanded", "false"));
  }

  function renderTranslationBlockContent(block, model) {
    const textClass = block.dataset.textClass || "";
    const text = element("div", textClass);
    if (!shouldOfferTranslation(model)) {
      appendRichText(text, model);
      block.replaceChildren(text);
      return;
    }
    const entry = translationCache.get(translationKey(model));
    const row = element("div", "tuzai-translation-row");
    row.append(icon("ph-translate"));
    if (entry?.status === "queued" || entry?.status === "loading") {
      row.append(element("span", "", "正在翻译…"));
    } else if (showingTranslation(model, entry)) {
      row.append(element("span", "", `翻译自 ${sourceLanguageLabel(entry)}`));
      const original = element("button", "tuzai-translation-link", "显示原文");
      original.type = "button";
      original.addEventListener("click", () => {
        translationDisplay.set(model.id, "original");
        updateTranslationNodes(model.id);
      });
      row.append(original);
    } else {
      const label = entry?.status === "error" || entry?.status === "unavailable" ? "重试翻译" : "显示翻译";
      const translate = element("button", "tuzai-translation-link", label);
      translate.type = "button";
      translate.addEventListener("click", () => {
        translationDisplay.set(model.id, "translation");
        if (entry?.status !== "ready") enqueueTranslation(model, true, true);
        else updateTranslationNodes(model.id);
      });
      row.append(translate);
    }
    const gear = element("button", "tuzai-translation-gear");
    gear.type = "button";
    gear.setAttribute("aria-label", "翻译设置");
    gear.setAttribute("aria-expanded", String(state.translationSettingsOpenFor === model.id));
    gear.append(icon("ph-gear"));
    gear.addEventListener("click", () => {
      state.translationSettingsOpenFor = state.translationSettingsOpenFor === model.id ? "" : model.id;
      refreshTranslationBlocks();
    });
    row.append(gear);
    if (showingTranslation(model, entry)) appendRichText(text, { ...model, text: entry.text, entities: [] });
    else appendRichText(text, model);
    block.replaceChildren(row);
    if (state.translationSettingsOpenFor === model.id) block.append(translationSettings(model));
    block.append(text);
  }

  function translatedTextBlock(model, textClass, scope) {
    const block = element("div", `tuzai-translatable tuzai-translation-${scope}`);
    renderedTranslationModels.set(model.id, model);
    block.dataset.translationId = model.id;
    block.dataset.translationScope = scope;
    block.dataset.textClass = textClass;
    renderTranslationBlockContent(block, model);
    return block;
  }

  function refreshTranslationBlocks() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    for (const block of root.querySelectorAll(".tuzai-translatable")) {
      const model = findModel(block.dataset.translationId) || renderedTranslationModels.get(block.dataset.translationId);
      if (model) renderTranslationBlockContent(block, model);
    }
  }

  function scheduleTranslationWork() {
    disconnectTranslationObserver();
    if (!state.autoTranslate) return;
    const root = document.getElementById(ROOT_ID);
    if (!root || !state.focal) return;
    const replyList = root.querySelector(".tuzai-reply-list");
    const blocks = [...root.querySelectorAll(".tuzai-translatable")];
    const replyBlocks = blocks.filter((block) => String(block.dataset.translationScope || "").startsWith("reply"));
    for (const block of blocks.filter((candidate) => !replyBlocks.includes(candidate))) {
      const model = findModel(block.dataset.translationId) || renderedTranslationModels.get(block.dataset.translationId);
      if (model) enqueueTranslation(model, true);
    }
    if (!replyBlocks.length) return;
    if (typeof IntersectionObserver !== "function") {
      replyBlocks.forEach((block) => {
        const model = findModel(block.dataset.translationId) || renderedTranslationModels.get(block.dataset.translationId);
        if (model) enqueueTranslation(model);
      });
      return;
    }
    translationObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        translationObserver?.unobserve(entry.target);
        const model = findModel(entry.target.dataset.translationId) || renderedTranslationModels.get(entry.target.dataset.translationId);
        if (model) enqueueTranslation(model);
      }
    }, { root: replyList, rootMargin: "180px 0px", threshold: 0.01 });
    replyBlocks.forEach((block) => translationObserver.observe(block));
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
    const secondary = element("span", "tuzai-author-secondary");
    const handle = element("a", "tuzai-author-handle", `@${model.author.handle || "unknown"}`);
    handle.href = avatarLink.href;
    handle.target = "_blank";
    handle.rel = "noreferrer";
    secondary.append(handle);
    if (compact) secondary.append(element("span", "tuzai-author-date", ` · ${formatDate(model.createdAt, true)}`));
    identity.append(nameRow, secondary);
    wrap.append(avatarLink, identity);
    bindProfileHover(avatarLink, model.author, avatarLink.href);
    bindProfileHover(name, model.author, avatarLink.href);
    bindProfileHover(handle, model.author, avatarLink.href);
    return wrap;
  }

  function removeProfileCard() {
    window.clearTimeout(profileCardShowTimer);
    window.clearTimeout(profileCardHideTimer);
    profileCardShowTimer = null;
    profileCardHideTimer = null;
    activeProfileCard?.remove();
    activeProfileCard = null;
    activeProfileCardKey = "";
    activeProfileAnchor = null;
  }

  function scheduleProfileCardHide() {
    window.clearTimeout(profileCardShowTimer);
    window.clearTimeout(profileCardHideTimer);
    profileCardHideTimer = window.setTimeout(removeProfileCard, PROFILE_CARD_HIDE_DELAY);
  }

  function profileKey(author, href) {
    return String(author.id || author.handle || href || "");
  }

  function updateAuthorFollowState(author, result) {
    if (result.confirmed === false) {
      const mark = (model) => {
        if (!model) return;
        if (String(model.author?.id || "") === String(author.id)) model.author.followStateUnconfirmed = true;
        mark(model.quote);
      };
      [...state.ancestors, state.focal, ...state.replies].forEach(mark);
      author.followStateUnconfirmed = true;
      return;
    }
    const active = result.following;
    const nextFollowers = Number.isFinite(result.followers) ? result.followers
      : Math.max(0, Number(author.followers || 0) + Number(active) - Number(Boolean(author.viewerFollowing)));
    const update = (model) => {
      if (!model) return;
      if (String(model.author?.id || "") === String(author.id || "")) {
        model.author.viewerFollowing = active;
        model.author.followStateUnconfirmed = false;
        model.author.followRequestSent = result.followRequestSent;
        model.author.followers = nextFollowers;
      }
      update(model.quote);
    };
    [...state.ancestors, state.focal, ...state.replies].forEach(update);
    author.viewerFollowing = active;
    author.followStateUnconfirmed = false;
    author.followRequestSent = result.followRequestSent;
    author.followers = nextFollowers;
  }

  function profileFollowButton(author, card) {
    if (!author.id) return null;
    const button = element("button", "tuzai-profile-card-follow");
    button.type = "button";
    button.append(
      element("span", "tuzai-profile-follow-default"),
      element("span", "tuzai-profile-follow-hover", "取消关注")
    );
    const refresh = () => {
      const following = Boolean(author.viewerFollowing);
      const pending = !following && Boolean(author.followRequestSent);
      const uncertain = Boolean(author.followStateUnconfirmed);
      const label = uncertain ? "查看状态" : following ? "正在关注" : pending ? "已请求" : "关注";
      button.dataset.following = String(following && !uncertain);
      button.disabled = pending && !uncertain;
      button.title = uncertain ? "请求已提交，点击在 X 个人资料页核对状态"
        : pending ? "关注请求待批准，可在 X 个人资料页管理" : "";
      button.querySelector(".tuzai-profile-follow-default").textContent = label;
      button.setAttribute("aria-label", `${label} @${author.handle || author.name || "X 用户"}`);
      const followers = card.querySelector(".tuzai-profile-followers-count");
      if (followers) followers.textContent = formatCount(author.followers) || "0";
    };
    refresh();
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      if (author.followStateUnconfirmed) {
        const profilePath = author.handle ? encodeURIComponent(author.handle) : `i/user/${author.id}`;
        window.open(`https://x.com/${profilePath}`, "_blank", "noopener");
        return;
      }
      const nextActive = !Boolean(author.viewerFollowing);
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const result = await requestPage("TOGGLE_FOLLOW", { userId: author.id, active: nextActive }, 30000);
        updateAuthorFollowState(author, result);
        refresh();
        if (result.confirmed === false) {
          notify("请求已提交，状态暂未同步，可点击“查看状态”核对", "info");
        } else {
          notify(result.following ? `已关注 @${author.handle}`
            : result.followRequestSent ? `已发送关注请求 @${author.handle}`
              : nextActive ? `X 当前显示尚未关注 @${author.handle}` : `已取消关注 @${author.handle}`,
          nextActive && !result.following && !result.followRequestSent ? "info" : "success");
        }
      } catch (error) {
        notify(error instanceof Error ? error.message : "关注操作失败", "error");
      } finally {
        button.disabled = false;
        button.removeAttribute("aria-busy");
        refresh();
      }
    });
    return button;
  }

  function profileCard(author, href) {
    const card = element("section", "tuzai-profile-card");
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-label", `${author.name || author.handle || "X 用户"} 的账号资料`);
    const top = element("div", "tuzai-profile-card-top");
    const avatarLink = element("a", "tuzai-profile-card-avatar");
    avatarLink.href = href;
    avatarLink.target = "_blank";
    avatarLink.rel = "noreferrer";
    if (author.avatar) {
      const image = document.createElement("img");
      image.src = author.avatar;
      image.alt = author.name || author.handle || "X 用户";
      avatarLink.append(image);
    } else avatarLink.append(icon("ph-user"));
    top.append(avatarLink);
    const follow = profileFollowButton(author, card);
    if (follow) top.append(follow);

    const nameRow = element("a", "tuzai-profile-card-name");
    nameRow.href = href;
    nameRow.target = "_blank";
    nameRow.rel = "noreferrer";
    nameRow.append(element("strong", "", author.name || author.handle || "X 用户"));
    if (author.verified) {
      const verified = element("span", "tuzai-verified", "✓");
      verified.setAttribute("aria-label", "认证账号");
      nameRow.append(verified);
    }
    const handle = element("a", "tuzai-profile-card-handle", `@${author.handle || "unknown"}`);
    handle.href = href;
    handle.target = "_blank";
    handle.rel = "noreferrer";
    card.append(top, nameRow, handle);
    if (author.followsViewer) card.append(element("div", "tuzai-profile-card-follows-you", "关注了你"));
    if (author.description) card.append(element("p", "tuzai-profile-card-bio", author.description));

    const stats = element("div", "tuzai-profile-card-stats");
    const following = element("a", "");
    following.href = `${href.replace(/\/$/, "")}/following`;
    following.target = "_blank";
    following.rel = "noreferrer";
    following.append(element("strong", "", formatCount(author.followingCount) || "0"), document.createTextNode(" 正在关注"));
    const followers = element("a", "");
    followers.href = `${href.replace(/\/$/, "")}/verified_followers`;
    followers.target = "_blank";
    followers.rel = "noreferrer";
    followers.append(element("strong", "tuzai-profile-followers-count", formatCount(author.followers) || "0"), document.createTextNode(" 关注者"));
    stats.append(following, followers);
    card.append(stats);

    const summary = element("a", "tuzai-profile-card-summary");
    summary.href = `https://x.com/i/grok?text=${encodeURIComponent(`请总结 @${author.handle || ""} 的个人资料`)}`;
    summary.target = "_blank";
    summary.rel = "noreferrer";
    summary.append(icon("ph-sparkle"), element("span", "", "个人资料概要"));
    card.append(summary);

    card.addEventListener("pointerenter", () => {
      window.clearTimeout(profileCardShowTimer);
      window.clearTimeout(profileCardHideTimer);
    });
    card.addEventListener("pointerleave", scheduleProfileCardHide);
    card.addEventListener("focusin", () => window.clearTimeout(profileCardHideTimer));
    card.addEventListener("focusout", scheduleProfileCardHide);
    return card;
  }

  function positionProfileCard(card, anchor) {
    if (!card?.isConnected || !anchor?.isConnected) return;
    const anchorRect = anchor.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const gap = 4;
    const left = Math.min(Math.max(12, anchorRect.left), window.innerWidth - cardRect.width - 12);
    const below = anchorRect.bottom + gap;
    const top = below + cardRect.height <= window.innerHeight - 12
      ? below
      : Math.max(12, anchorRect.top - cardRect.height - gap);
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function showProfileCard(author, href, anchor) {
    const root = document.getElementById(ROOT_ID);
    if (!root || !anchor.isConnected) return;
    const key = profileKey(author, href);
    if (activeProfileCard?.isConnected && activeProfileCardKey === key) {
      activeProfileAnchor = anchor;
      positionProfileCard(activeProfileCard, anchor);
      return;
    }
    removeProfileCard();
    const card = profileCard(author, href);
    activeProfileCard = card;
    activeProfileCardKey = key;
    activeProfileAnchor = anchor;
    root.append(card);
    positionProfileCard(card, anchor);
  }

  function bindProfileHover(node, author, href) {
    node.classList.add("tuzai-profile-trigger");
    node.setAttribute("aria-haspopup", "dialog");
    node.addEventListener("pointerenter", () => {
      window.clearTimeout(profileCardHideTimer);
      window.clearTimeout(profileCardShowTimer);
      if (activeProfileCard?.isConnected && activeProfileCardKey === profileKey(author, href)) {
        activeProfileAnchor = node;
        positionProfileCard(activeProfileCard, node);
        return;
      }
      profileCardShowTimer = window.setTimeout(() => showProfileCard(author, href, node), PROFILE_CARD_SHOW_DELAY);
    });
    node.addEventListener("pointerleave", scheduleProfileCardHide);
    node.addEventListener("focus", () => showProfileCard(author, href, node));
    node.addEventListener("blur", scheduleProfileCardHide);
  }

  function disconnectReplyLoadObserver() {
    replyLoadObserver?.disconnect();
    replyLoadObserver = null;
  }

  function observeReplyLoadSentinel(replyList, sentinel) {
    disconnectReplyLoadObserver();
    if (!state.cursor || state.loadingMore || typeof IntersectionObserver !== "function") return;
    window.requestAnimationFrame(() => {
      if (!sentinel.isConnected || !state.cursor || state.loadingMore) return;
      replyLoadObserver = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting) || state.loadingMore) return;
        disconnectReplyLoadObserver();
        fetchMore();
      }, { root: replyList, rootMargin: "0px 0px 240px", threshold: 0.01 });
      replyLoadObserver.observe(sentinel);
    });
  }

  function destroyHlsPlayers() {
    videoWarmupObserver?.disconnect();
    videoWarmupObserver = null;
    for (const hls of hlsInstances) {
      try { hls.destroy(); } catch { /* Already detached. */ }
    }
    hlsInstances.clear();
  }

  function videoQualityHeight(width, height, url = "", bitrate = 0, name = "") {
    return Core.inferVideoQuality(width, height, url, bitrate, name);
  }

  function hlsLevelOptions(levels) {
    return (levels || []).map((level, index) => {
      const bitrate = Number(level?.maxBitrate || level?.bitrate) || 0;
      const value = videoQualityHeight(level?.width, level?.height, level?.url, bitrate, level?.name);
      return value ? { value, label: `${value}p`, level: index, bitrate: Number(level?.maxBitrate || level?.bitrate) || 0 } : null;
    }).filter(Boolean).sort((left, right) => left.value - right.value || left.bitrate - right.bitrate);
  }

  function desiredAutoVideoHeight(video, media, priority) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const effectiveType = String(connection?.effectiveType || "");
    if (connection?.saveData || /(?:^|-)2g$/.test(effectiveType)) return 360;
    if (effectiveType === "3g") return 480;
    const xPlayerHint = videoQualityHeight(media.playbackWidth, media.playbackHeight);
    if (xPlayerHint) {
      const desktopFocalFloor = priority === "focal" && window.innerWidth >= 900 ? 720 : 0;
      return Math.max(desktopFocalFloor, xPlayerHint);
    }
    if (sharedVideoBandwidthEstimate > 0) {
      if (sharedVideoBandwidthEstimate >= 7000000) return 1080;
      if (sharedVideoBandwidthEstimate >= 2500000) return 720;
      if (sharedVideoBandwidthEstimate >= 1200000) return 480;
      return 360;
    }
    const pixelRatio = Math.min(2, Math.max(1, Number(window.devicePixelRatio) || 1));
    const displayedHeight = Math.round(Math.min(video.clientWidth || 0, video.clientHeight || 0) * pixelRatio);
    if (displayedHeight >= 1080) return 1080;
    if (displayedHeight >= 540) return 720;
    return priority === "focal" && window.innerWidth >= 900 ? 720 : 480;
  }

  function installProgressiveVideoSource(video, media, targetBitrate, streamType) {
    const variants = Array.isArray(media.videoVariants) ? media.videoVariants : [];
    const variant = Core.selectVideoVariant(variants, targetBitrate)
      || (media.videoUrl ? { url: media.videoUrl, bitrate: 0 } : null);
    if (!variant?.url) return false;
    video.src = variant.url;
    video.dataset.bitrate = String(variant.bitrate || "");
    video.dataset.streamType = streamType;
    const quality = videoQualityHeight(variant.width, variant.height, variant.url, variant.bitrate, variant.name);
    if (quality) video.dataset.quality = `${quality}p`;
    return true;
  }

  function rememberVideoBandwidth(value) {
    const estimate = Number(value) || 0;
    if (estimate < 128000) return;
    sharedVideoBandwidthEstimate = sharedVideoBandwidthEstimate > 0
      ? (sharedVideoBandwidthEstimate * 0.7) + (estimate * 0.3)
      : estimate;
  }

  function targetVideoBitrate(compact, media, priority) {
    const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    const effectiveType = String(connection?.effectiveType || "");
    if (connection?.saveData) return 384000;
    if (/(?:^|-)2g$/.test(effectiveType)) return 512000;
    if (effectiveType === "3g") return 1500000;
    const xPlayerHint = videoQualityHeight(media?.playbackWidth, media?.playbackHeight);
    if (xPlayerHint >= 1080) return 8000000;
    if (xPlayerHint >= 720) return 5000000;
    if (xPlayerHint >= 480) return 2500000;
    if (sharedVideoBandwidthEstimate > 0) {
      return Math.max(1000000, Math.min(12000000, sharedVideoBandwidthEstimate * 0.88));
    }
    const downlinkEstimate = Number(connection?.downlink) > 0 ? Number(connection.downlink) * 850000 : 0;
    const desktopDefault = priority === "focal" ? 6000000 : compact ? 4500000 : 5500000;
    return Math.max(1000000, Math.min(12000000, downlinkEstimate || desktopDefault));
  }

  function observeVideoWarmup(video, warmup, priority) {
    videoWarmupTasks.set(video, warmup);
    if (priority === "focal" || typeof IntersectionObserver !== "function") {
      warmup();
      return;
    }
    if (!videoWarmupObserver) {
      videoWarmupObserver = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          videoWarmupObserver?.unobserve(entry.target);
          videoWarmupTasks.get(entry.target)?.();
        }
      }, { root: null, rootMargin: "360px 0px", threshold: 0.01 });
    }
    videoWarmupObserver.observe(video);
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

  function playableVideo(media, model, compact, item, priority = "nearby") {
    const targetBitrate = targetVideoBitrate(compact, media, priority);
    const variant = Core.selectVideoVariant(media.videoVariants, targetBitrate);
    const video = document.createElement("video");
    video.poster = media.url;
    video.controls = true;
    video.playsInline = true;
    video.preload = priority === "focal" ? "auto" : "metadata";
    video.setAttribute("fetchpriority", priority === "focal" ? "high" : "auto");
    video.addEventListener("play", () => {
      document.querySelectorAll(`#${ROOT_ID} video`).forEach((other) => {
        if (other !== video && !other.paused) other.pause();
      });
    });
    if (media.type === "animated_gif") {
      video.loop = true;
      video.muted = true;
    }

    const HlsPlayer = globalThis.Hls;
    const hlsJsSupported = Boolean(media.hlsUrl && HlsPlayer?.isSupported?.());
    const nativeHls = Boolean(
      media.hlsUrl
      && !hlsJsSupported
      && video.canPlayType("application/vnd.apple.mpegurl")
    );
    if (nativeHls) {
      video.src = media.hlsUrl;
      video.dataset.streamType = "hls-native";
      const warmup = () => {
        video.preload = "auto";
        video.load();
      };
      observeVideoWarmup(video, warmup, priority);
      return video;
    }

    if (hlsJsSupported) {
      const hls = new HlsPlayer({
        autoStartLoad: false,
        startLevel: -1,
        testBandwidth: true,
        enableWorker: true,
        workerPath: chrome.runtime.getURL("vendor/hls/hls.worker.js"),
        capLevelToPlayerSize: true,
        capLevelOnFPSDrop: true,
        maxBufferLength: priority === "focal" ? 30 : 15,
        maxMaxBufferLength: priority === "focal" ? 45 : 30,
        backBufferLength: 10,
        maxBufferSize: priority === "focal" ? 40 * 1000 * 1000 : 24 * 1000 * 1000,
        lowLatencyMode: false,
        abrEwmaDefaultEstimate: targetBitrate,
        abrEwmaDefaultEstimateMax: 12000000
      });
      let recoveryAttempted = false;
      let manifestParsed = false;
      let warmupRequested = false;
      hlsInstances.add(hls);
      hls.attachMedia(video);
      hls.loadSource(media.hlsUrl);
      video.dataset.streamType = "hls-adaptive";
      video.dataset.initialBitrate = String(Math.round(targetBitrate));
      const startAdaptiveLoad = () => {
        warmupRequested = true;
        if (manifestParsed) hls.startLoad(-1);
      };
      observeVideoWarmup(video, startAdaptiveLoad, priority);
      video.addEventListener("play", startAdaptiveLoad);
      hls.on(HlsPlayer.Events.MANIFEST_PARSED, () => {
        manifestParsed = true;
        const levels = hlsLevelOptions(hls.levels);
        const desiredHeight = desiredAutoVideoHeight(video, media, priority);
        const startOption = levels.find((level) => level.value >= desiredHeight) || levels.at(-1);
        if (startOption) {
          hls.startLevel = startOption.level;
          hls.nextAutoLevel = startOption.level;
        }
        if (warmupRequested) hls.startLoad(-1);
      });
      hls.on(HlsPlayer.Events.FRAG_LOADED, () => {
        rememberVideoBandwidth(hls.bandwidthEstimate);
        if (Number.isFinite(hls.bandwidthEstimate)) video.dataset.bandwidthEstimate = String(Math.round(hls.bandwidthEstimate));
      });
      hls.on(HlsPlayer.Events.LEVEL_SWITCHED, (_event, data) => {
        const level = hls.levels?.[data?.level];
        const value = videoQualityHeight(level?.width, level?.height, level?.url, level?.maxBitrate || level?.bitrate, level?.name);
        if (value) {
          video.dataset.quality = `${value}p`;
        }
      });
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
          installProgressiveVideoSource(video, media, targetBitrate, "mp4-progressive-fallback");
          video.preload = warmupRequested ? "auto" : "metadata";
        } else if (item.contains(video)) item.replaceChildren(videoFallback(media, model));
      });
      return video;
    }

    if (variant?.url || media.videoUrl) {
      installProgressiveVideoSource(video, media, targetBitrate, "mp4-progressive");
      const warmup = () => {
        video.preload = "auto";
        video.load();
      };
      observeVideoWarmup(video, warmup, priority);
      return video;
    }
    return null;
  }

  function mediaGrid(model, compact = false, priority = "nearby") {
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
        const video = playableVideo(media, model, compact, item, priority);
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

  function attachmentCard(model, compact = false) {
    const attachment = model.attachment;
    if (!attachment || (!attachment.image && !attachment.title && !attachment.description)) return null;
    if (attachment.type === "article" && attachment.content?.blocks?.length && !compact) return articleReader(model);
    const card = element("a", `tuzai-attachment-card tuzai-attachment-${attachment.type || "website"}${compact ? " tuzai-attachment-compact" : ""}`);
    card.href = attachment.url || model.url;
    card.target = "_blank";
    card.rel = "noreferrer";
    card.setAttribute("aria-label", `${attachment.type === "article" ? "阅读文章" : "打开链接"}：${attachment.title || attachment.domain || "外部内容"}`);

    if (attachment.image) {
      const media = element("div", "tuzai-attachment-media");
      const image = document.createElement("img");
      image.src = attachment.image;
      image.alt = attachment.type === "article" ? "文章封面图片" : "链接预览图片";
      image.loading = "lazy";
      if (attachment.imageWidth > 0 && attachment.imageHeight > 0) media.style.aspectRatio = `${attachment.imageWidth} / ${attachment.imageHeight}`;
      media.append(image);
      if (attachment.type === "article") media.append(element("span", "tuzai-article-badge", "文章"));
      card.append(media);
    }

    if (attachment.type === "article") {
      const body = element("div", "tuzai-attachment-body");
      if (attachment.title) body.append(element("strong", "tuzai-attachment-title", attachment.title));
      if (attachment.description) body.append(element("p", "tuzai-attachment-description", attachment.description));
      card.append(body);
    } else {
      const meta = element("div", "tuzai-attachment-source");
      meta.append(icon("ph-link-simple"), element("span", "", attachment.domain ? `来自 ${attachment.domain}` : attachment.title || "打开链接"));
      card.append(meta);
    }
    return card;
  }

  function appendArticleInline(parent, block, entities) {
    const text = block.text || "";
    if (!text) return;
    const styles = block.inlineStyles || [];
    const ranges = block.entityRanges || [];
    let start = 0;
    while (start < text.length) {
      const activeStyles = styles.filter((range) => start >= range.offset && start < range.offset + range.length).map((range) => range.style).sort();
      const activeEntity = ranges.find((range) => start >= range.offset && start < range.offset + range.length);
      let end = start + 1;
      while (end < text.length) {
        const nextStyles = styles.filter((range) => end >= range.offset && end < range.offset + range.length).map((range) => range.style).sort();
        const nextEntity = ranges.find((range) => end >= range.offset && end < range.offset + range.length);
        if (activeStyles.join("|") !== nextStyles.join("|") || activeEntity?.key !== nextEntity?.key) break;
        end += 1;
      }
      let node = document.createTextNode(text.slice(start, end));
      if (activeStyles.some((style) => /BOLD/i.test(style))) {
        const strong = document.createElement("strong");
        strong.append(node);
        node = strong;
      }
      if (activeStyles.some((style) => /ITALIC/i.test(style))) {
        const em = document.createElement("em");
        em.append(node);
        node = em;
      }
      if (activeStyles.some((style) => /UNDERLINE/i.test(style))) {
        const underline = document.createElement("u");
        underline.append(node);
        node = underline;
      }
      const entity = activeEntity ? entities?.[activeEntity.key] : null;
      if (entity?.url) {
        const link = document.createElement("a");
        link.href = entity.url;
        link.target = "_blank";
        link.rel = "noreferrer";
        link.append(node);
        node = link;
      }
      parent.append(node);
      start = end;
    }
  }

  function articleReader(model) {
    const attachment = model.attachment;
    const reader = element("section", "tuzai-article-reader");
    if (attachment.image) {
      const cover = element("div", "tuzai-article-cover");
      const image = document.createElement("img");
      image.src = attachment.image;
      image.alt = "文章封面图片";
      image.loading = "lazy";
      if (attachment.imageWidth > 0 && attachment.imageHeight > 0) cover.style.aspectRatio = `${attachment.imageWidth} / ${attachment.imageHeight}`;
      cover.append(image, element("span", "tuzai-article-badge", "文章"));
      reader.append(cover);
    }
    const heading = element("header", "tuzai-article-heading");
    if (attachment.title) heading.append(element("h1", "", attachment.title));
    const open = element("a", "tuzai-article-open");
    open.href = attachment.url || model.url;
    open.target = "_blank";
    open.rel = "noreferrer";
    open.append(icon("ph-arrow-square-out"), document.createTextNode("在 X 打开文章"));
    heading.append(open);
    reader.append(heading);

    const body = element("div", "tuzai-article-content");
    let activeList = null;
    for (const block of attachment.content.blocks) {
      const type = block.type.toLowerCase();
      if (type === "atomic") {
        activeList = null;
        const entity = attachment.content.entities?.[block.entityRanges?.[0]?.key];
        if (entity?.image) {
          const figure = document.createElement("figure");
          const image = document.createElement("img");
          image.src = entity.image;
          image.alt = entity.alt || "文章图片";
          image.loading = "lazy";
          figure.append(image);
          body.append(figure);
        }
        continue;
      }
      const listType = type.includes("unordered-list") ? "ul" : type.includes("ordered-list") ? "ol" : "";
      if (listType) {
        if (!activeList || activeList.tagName.toLowerCase() !== listType) {
          activeList = document.createElement(listType);
          body.append(activeList);
        }
        const item = document.createElement("li");
        appendArticleInline(item, block, attachment.content.entities);
        activeList.append(item);
        continue;
      }
      activeList = null;
      const tag = type.includes("header-one") ? "h2"
        : type.includes("header-two") ? "h3"
          : type.includes("header-three") ? "h4"
            : type.includes("blockquote") ? "blockquote"
              : "p";
      const node = document.createElement(tag);
      appendArticleInline(node, block, attachment.content.entities);
      if (node.textContent || tag === "p") body.append(node);
    }
    reader.append(body);
    return reader;
  }

  function quoteCard(model, scope = "quote") {
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
    const text = translatedTextBlock(model.quote, "tuzai-quote-text", scope === "reply" ? "reply-quote" : "quote");
    quoteLink.append(heading);
    quote.append(quoteLink, text);
    const media = mediaGrid(model.quote, true, scope === "reply" ? "lazy" : "nearby");
    if (media) quote.append(media);
    const attachment = attachmentCard(model.quote, true);
    if (attachment) quote.append(attachment);
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
    const surface = element("span", "tuzai-action-surface");
    const iconWrap = element("span", "tuzai-action-icon");
    iconWrap.append(icon(iconName));
    surface.append(iconWrap);
    const formatted = formatCount(count);
    if (formatted) surface.append(element("span", "tuzai-action-count", formatted));
    button.append(surface);
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
    const text = translatedTextBlock(model, "tuzai-post-text", "post");
    article.append(header, text);
    const media = mediaGrid(model, false, "focal");
    if (media) article.append(media);
    const attachment = attachmentCard(model);
    if (attachment) article.append(attachment);
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

  function renderThreadAncestor(model) {
    const article = element("article", "tuzai-thread-ancestor");
    const header = authorLine(model, true);
    const open = element("a", "tuzai-post-more");
    open.href = model.url;
    open.target = "_blank";
    open.rel = "noreferrer";
    open.setAttribute("aria-label", "在 X 打开上文帖子");
    open.append(icon("ph-dots-three"));
    header.append(open);
    const text = translatedTextBlock(model, "tuzai-thread-text", "thread");
    article.append(header, text);
    const media = mediaGrid(model, true, "nearby");
    if (media) article.append(media);
    const attachment = attachmentCard(model, true);
    if (attachment) article.append(attachment);
    const quote = quoteCard(model);
    if (quote) article.append(quote);
    article.append(actionBar(model, true));
    return article;
  }

  function renderPostThread() {
    if (!state.ancestors.length) return renderPost(state.focal);
    const thread = element("div", "tuzai-thread-context");
    state.ancestors.forEach((ancestor) => thread.append(renderThreadAncestor(ancestor)));
    const focal = renderPost(state.focal);
    focal.classList.add("tuzai-thread-focal");
    thread.append(focal);
    return thread;
  }

  function focusFocalPostOnce(postBody) {
    if (!state.focusFocalOnRender) return;
    state.focusFocalOnRender = false;
    window.requestAnimationFrame(() => {
      if (!document.getElementById(ROOT_ID) || !postBody.isConnected) return;
      const focal = postBody.querySelector(".tuzai-thread-focal");
      if (!focal) return;
      const offset = focal.getBoundingClientRect().top - postBody.getBoundingClientRect().top;
      postBody.scrollTop = Math.max(0, postBody.scrollTop + offset - 8);
    });
  }

  function resetPostScrollOnce(postBody) {
    if (!state.resetPostScrollOnRender) return;
    state.resetPostScrollOnRender = false;
    postBody.scrollTop = 0;
    window.requestAnimationFrame(() => {
      if (!document.getElementById(ROOT_ID) || !postBody.isConnected) return;
      postBody.scrollTop = 0;
      window.requestAnimationFrame(() => {
        if (postBody.isConnected) postBody.scrollTop = 0;
      });
    });
  }

  function renderReply(model) {
    const article = element("article", "tuzai-reply-card");
    article.dataset.tweetId = model.id;
    article.style.setProperty("--tuzai-depth", String(model.depth || 0));
    article.dataset.depth = String(model.depth || 0);
    const header = authorLine(model, true);
    const text = translatedTextBlock(model, "tuzai-reply-text", "reply");
    const body = element("div", "tuzai-reply-body");
    body.append(header, text);
    const media = mediaGrid(model, true, "lazy");
    if (media) body.append(media);
    const attachment = attachmentCard(model, true);
    if (attachment) body.append(attachment);
    const quote = quoteCard(model, "reply");
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
    const pinned = state.pinnedReplyIds.map((id) => state.replies.find((reply) => reply.id === id)).filter(Boolean);
    const pinnedIds = new Set(pinned.map((reply) => reply.id));
    const replies = state.replies.filter((reply) => !pinnedIds.has(reply.id));
    if (state.sort === "latest") replies.sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
    if (state.sort === "liked") replies.sort((left, right) => right.counts.likes - left.counts.likes);
    return [...pinned, ...replies];
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
    const sortGroup = element("div", "tuzai-sort-group");
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
    const replyCount = formatCount(state.focal.counts.replies || state.replies.length) || "0";
    const count = element("span", "tuzai-reply-count", `${replyCount} 条回复`);
    sortGroup.append(sort, count);
    const quotes = element("a", "tuzai-quotes-link", "查看引用");
    quotes.href = `${state.focal.url}/quotes`;
    quotes.target = "_blank";
    quotes.rel = "noreferrer";
    quotes.append(icon("ph-caret-right"));
    context.append(sortGroup, quotes);

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
    const expanded = state.composerExpanded || Boolean(state.replyText.trim()) || target.id !== state.focal.id;
    composer.dataset.expanded = String(expanded);
    const targetRow = element("div", "tuzai-composer-target", `回复 ${label}`);
    if (target.id !== state.focal.id) {
      const cancel = element("button", "", "取消");
      cancel.type = "button";
      cancel.addEventListener("click", () => {
        state.replyTarget = state.focal;
        state.composerExpanded = Boolean(state.replyText.trim());
        renderReader();
      });
      targetRow.append(cancel);
    }
    const textarea = document.createElement("textarea");
    textarea.rows = 1;
    textarea.value = state.replyText;
    textarea.placeholder = `发布你对${label}的回复`;
    textarea.setAttribute("aria-label", "发布你的回复");
    const submit = element("button", "tuzai-reply-submit", "回复");
    submit.type = "button";
    submit.disabled = !state.replyText.trim() || state.busy.has("reply");
    const resizeTextarea = () => {
      textarea.style.height = "auto";
      const maxHeight = 168;
      const height = Math.min(Math.max(textarea.scrollHeight, 28), maxHeight);
      textarea.style.height = `${height}px`;
      textarea.style.overflowY = textarea.scrollHeight > maxHeight ? "auto" : "hidden";
    };
    textarea.addEventListener("focus", () => {
      state.composerExpanded = true;
      composer.dataset.expanded = "true";
      window.requestAnimationFrame(resizeTextarea);
    });
    textarea.addEventListener("input", () => {
      state.replyText = textarea.value;
      state.composerExpanded = true;
      composer.dataset.expanded = "true";
      submit.disabled = !textarea.value.trim() || state.busy.has("reply");
      resizeTextarea();
    });
    textarea.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter" && textarea.value.trim()) publishReply();
    });
    submit.addEventListener("click", publishReply);
    composer.addEventListener("focusout", () => {
      window.setTimeout(() => {
        if (composer.contains(document.activeElement)) return;
        const stillTargetsReply = (state.replyTarget || state.focal)?.id !== state.focal?.id;
        if (textarea.value.trim() || stillTargetsReply) return;
        state.composerExpanded = false;
        composer.dataset.expanded = "false";
        textarea.style.height = "28px";
        textarea.style.overflowY = "hidden";
      }, 0);
    });
    body.append(targetRow, textarea);
    composer.append(avatar, body, submit);
    container.append(context, composer);
    if (expanded) window.requestAnimationFrame(resizeTextarea);
  }

  function renderReader() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const postBody = root.querySelector(".tuzai-post-body");
    const replyTools = root.querySelector(".tuzai-reply-tools");
    const replyList = root.querySelector(".tuzai-reply-list");
    if (!postBody || !replyTools || !replyList) return;
    destroyHlsPlayers();
    disconnectReplyLoadObserver();
    removeProfileCard();
    renderedTranslationModels.clear();
    postBody.replaceChildren();
    postBody.dataset.hasContext = String(Boolean(state.ancestors.length));
    replyList.replaceChildren();

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

    postBody.append(renderPostThread());
    focusFocalPostOnce(postBody);
    resetPostScrollOnce(postBody);
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
      const sentinel = element("div", "tuzai-reply-load-sentinel");
      sentinel.setAttribute("aria-label", state.loadingMore ? "正在加载更多评论" : "向下滚动加载更多评论");
      if (state.loadingMore) sentinel.append(element("span", "tuzai-spinner"));
      replyList.append(sentinel);
      observeReplyLoadSentinel(replyList, sentinel);
    }
    if (state.scrollRepliesToTop) {
      state.scrollRepliesToTop = false;
      window.requestAnimationFrame(() => {
        if (replyList.isConnected) replyList.scrollTop = 0;
      });
    }
    scheduleTranslationWork();
  }

  function mergeReplies(items) {
    const map = new Map(state.replies.map((reply) => [reply.id, reply]));
    let added = 0;
    for (const reply of items) {
      if (!map.has(reply.id)) added += 1;
      map.set(reply.id, { ...map.get(reply.id), ...reply });
    }
    state.replies = [...map.values()];
    return added;
  }

  async function hydrateArticle(model) {
    if (model?.attachment?.type !== "article" || model.attachment.content?.blocks?.length) return model;
    const json = await requestPage("READ_ARTICLE", { tweetId: model.id });
    const hydrated = Core.collectTweetModels(json).find((item) => item.id === model.id);
    if (hydrated) return Core.mergeModelFallback(hydrated, model);
    const attachment = Core.articleAttachmentFromPayload(json);
    return attachment ? { ...model, attachment: { ...model.attachment, ...attachment, url: attachment.url || model.attachment.url } } : model;
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
      seedDomTranslation(state.focal, state.domFallback?.translation);
      state.ancestors = parsed.ancestors;
      const leftModels = await Promise.all([...state.ancestors, state.focal].map(async (model) => {
        try {
          return await hydrateArticle(model);
        } catch {
          return model;
        }
      }));
      state.focal = leftModels.pop();
      state.ancestors = leftModels;
      state.focusFocalOnRender = state.ancestors.length > 0;
      state.resetPostScrollOnRender = state.ancestors.length === 0;
      state.replies = parsed.replies;
      state.pinnedReplyIds = [];
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
    const currentReplyList = document.getElementById(ROOT_ID)?.querySelector(".tuzai-reply-list");
    const previousScrollTop = currentReplyList?.scrollTop || 0;
    state.loadingMore = true;
    disconnectReplyLoadObserver();
    const sentinel = currentReplyList?.querySelector(".tuzai-reply-load-sentinel");
    if (sentinel) {
      sentinel.replaceChildren(element("span", "tuzai-spinner"));
      sentinel.setAttribute("aria-label", "正在加载更多评论");
    }
    try {
      const json = await requestPage("READ_THREAD", { tweetId: state.tweetId, cursor: previousCursor });
      const parsed = Core.parseTweetDetail(json, state.tweetId);
      const added = mergeReplies(parsed.replies);
      state.cursor = Core.replyCursorAfterPage(previousCursor, parsed.cursor, added);
    } catch (error) {
      notify(error instanceof Error ? error.message : "加载更多失败", "error");
    } finally {
      state.loadingMore = false;
      renderReader();
      window.requestAnimationFrame(() => {
        const nextReplyList = document.getElementById(ROOT_ID)?.querySelector(".tuzai-reply-list");
        if (nextReplyList && !state.scrollRepliesToTop) nextReplyList.scrollTop = previousScrollTop;
      });
    }
  }

  function findModel(tweetId) {
    if (state.focal?.id === tweetId) return state.focal;
    const ancestor = state.ancestors.find((model) => model.id === tweetId);
    if (ancestor) return ancestor;
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
      state.composerExpanded = true;
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
      if (created && (target.id === state.focal.id || state.replies.some((reply) => reply.id === target.id))) {
        created.depth = target.id === state.focal.id ? 0 : Math.min((target.depth || 0) + 1, 3);
        mergeReplies([created]);
        state.pinnedReplyIds = [created.id, ...state.pinnedReplyIds.filter((id) => id !== created.id)];
        state.scrollRepliesToTop = true;
      }
      target.counts.replies += 1;
      state.replyText = "";
      state.replyTarget = state.focal;
      state.composerExpanded = false;
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
    state.resetPostScrollOnRender = true;

    const root = element("div", `tuzai-overlay ${currentThemeClass()}`);
    root.id = ROOT_ID;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Peek 帖子阅读器");
    root.addEventListener("wheel", (event) => {
      if (!event.target.closest?.(".tuzai-scroll-area")) event.preventDefault();
    }, { passive: false });
    root.addEventListener("scroll", () => removeProfileCard(), true);
    root.addEventListener("click", closeTranslationSettingsFromOutside);
    const backdrop = element("button", "tuzai-backdrop");
    backdrop.type = "button";
    backdrop.setAttribute("aria-label", "关闭浮层");
    backdrop.addEventListener("click", closePopover);
    const dialog = element("section", "tuzai-dialog");
    dialog.innerHTML = `
      <header class="tuzai-toolbar">
        <div class="tuzai-brand"><span class="tuzai-brand-icon"></span><strong>Peek</strong></div>
        <div class="tuzai-toolbar-actions"></div>
      </header>
      <div class="tuzai-reader-grid">
        <section class="tuzai-pane tuzai-post-pane">
          <div class="tuzai-scroll-area tuzai-post-body"></div>
        </section>
        <section class="tuzai-pane tuzai-replies-pane">
          <div class="tuzai-reply-tools"></div>
          <div class="tuzai-scroll-area tuzai-reply-list"></div>
        </section>
      </div>`;
    const brandIcon = dialog.querySelector(".tuzai-brand-icon");
    const iconUrl = globalThis.TuzaiBrandIconDataUrl || extensionUrl("icons/icon48.png");
    if (iconUrl) {
      const image = document.createElement("img");
      image.src = iconUrl;
      image.alt = "";
      image.addEventListener("error", () => {
        const fallback = element("span", "tuzai-brand-icon");
        fallback.append(icon("ph-chat-circle"));
        image.replaceWith(fallback);
      }, { once: true });
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

  async function resolveQuotedModel(outerUrl) {
    const outerId = Core.postIdFromUrl(outerUrl);
    if (!outerId) throw new Error("没有识别到外层帖子地址");
    if (!quoteResolutionRequests.has(outerId)) {
      const request = (async () => {
        let outer = null;
        try {
          const json = await requestPage("READ_ARTICLE", { tweetId: outerId });
          outer = Core.collectTweetModels(json).find((model) => model.id === outerId) || null;
        } catch {
          // TweetResultByRestId is not always ready on a freshly opened X tab.
        }
        if (!outer?.quote) {
          const json = await requestPage("READ_THREAD", { tweetId: outerId });
          outer = Core.parseTweetDetail(json, outerId).focal
            || Core.collectTweetModels(json).find((model) => model.id === outerId)
            || null;
        }
        if (!outer?.quote?.id || !outer.quote.url) throw new Error("X 暂时没有返回这条引用帖");
        return outer.quote;
      })().finally(() => quoteResolutionRequests.delete(outerId));
      quoteResolutionRequests.set(outerId, request);
    }
    return quoteResolutionRequests.get(outerId);
  }

  async function openResolvedQuote(outerUrl) {
    try {
      const quote = await resolveQuotedModel(outerUrl);
      if (document.getElementById(ROOT_ID)) return;
      openPopover(quote.url, quote);
    } catch (error) {
      notifyPage(error instanceof Error ? error.message : "读取引用帖失败，请稍后重试");
    }
  }

  function handleTimelineClick(event) {
    if (!state.enabled || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (document.getElementById(ROOT_ID)) return;
    const article = event.target.closest?.('article[data-testid="tweet"]');
    if (!article || !isTopLevelTweet(article) || shouldSkipTarget(event.target)) return;
    const quoteScope = findClickedQuoteScope(article, event.target);
    const quotedUrl = findClickedQuotedPostUrl(article, event.target);
    if (Core.isPostDetailUrl(location.href) && !quoteScope) return;
    const targetAnchor = event.target.closest?.('a[href*="/status/"]');
    const outerUrl = findPostUrl(article);
    const url = quotedUrl || Core.normalizePostUrl(targetAnchor?.getAttribute("href"), location.href) || outerUrl;
    if (!url || (quoteScope && !outerUrl)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (quoteScope && !quotedUrl) {
      void openResolvedQuote(outerUrl);
      return;
    }
    const domFallback = snapshotArticle(article, event.target, url);
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
      if (area !== "sync") return;
      if (changes.enabled) {
        state.enabled = Boolean(changes.enabled.newValue);
        if (!state.enabled) closePopover();
      }
      if (changes.autoTranslate) {
        state.autoTranslate = Boolean(changes.autoTranslate.newValue);
        state.translationSettingsOpenFor = "";
        refreshTranslationBlocks();
        scheduleTranslationWork();
      }
    });
    chrome.storage.sync.get({ enabled: true, autoTranslate: true }).then(({ enabled, autoTranslate }) => {
      state.enabled = Boolean(enabled);
      state.autoTranslate = Boolean(autoTranslate);
    }).catch(() => {});
  } catch {
    // A stale content script after an extension reload stays inert until the X tab refreshes.
  }
})();
