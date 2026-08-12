(function initTuzaiDoubleFrameReader() {
  "use strict";

  const Core = globalThis.TuzaiCore;
  const ROOT_ID = "tuzai-x-popover-root";
  const FRAME_READY_MESSAGE = "TUZAI_FRAME_READY";
  const CLOSE_MESSAGE = "TUZAI_CLOSE_READER";
  const FRAME_MODES = new Set(["source", "replies"]);
  const DISCOVER_LABELS = ["发现更多", "discover more"];
  const SORT_LABELS = ["相关", "最近", "最新", "喜欢", "relevant", "recent", "likes"];
  const state = {
    enabled: true,
    sourceUrl: null,
    previousBodyOverflow: "",
    previousHtmlOverflow: ""
  };

  function frameMode() {
    if (window.top === window.self) return null;
    try {
      const mode = window.frameElement?.dataset?.tuzaiPane;
      return FRAME_MODES.has(mode) ? mode : null;
    } catch {
      return null;
    }
  }

  function normalizedText(node) {
    return String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function directBranch(root, descendant) {
    let branch = descendant;
    while (branch?.parentElement && branch.parentElement !== root) branch = branch.parentElement;
    return branch?.parentElement === root ? branch : null;
  }

  function hideSiblingsOnPath(start, stopAt) {
    let current = start;
    while (current?.parentElement && current !== stopAt) {
      const parent = current.parentElement;
      for (const sibling of parent.children) {
        if (sibling !== current) sibling.classList.add("tuzai-frame-hidden");
      }
      current.classList.add("tuzai-frame-path");
      current = parent;
    }
  }

  function topLevelTweets(root) {
    return [...root.querySelectorAll('article[data-testid="tweet"]')].filter(
      (article) => !article.parentElement?.closest('article[data-testid="tweet"]')
    );
  }

  function findConversationRegion(primary, sourceArticle) {
    return sourceArticle.closest('[role="region"]') || sourceArticle.closest("section") || primary;
  }

  function findCell(node) {
    return node?.closest('[data-testid="cellInnerDiv"]') || null;
  }

  function findSortRow(sourceArticle) {
    const control = [...sourceArticle.querySelectorAll('button, [role="button"]')].find((node) => {
      const text = normalizedText(node);
      return SORT_LABELS.some((label) => text === label || text.startsWith(`${label} `));
    });
    if (!control) return null;

    const sourceRect = sourceArticle.getBoundingClientRect();
    let current = control;
    let best = control.parentElement;
    while (current?.parentElement && current.parentElement !== sourceArticle) {
      current = current.parentElement;
      const rect = current.getBoundingClientRect();
      if (rect.width >= sourceRect.width * 0.72 && rect.height > 24 && rect.height < 180) best = current;
    }
    return best;
  }

  function hideDiscoverMore(region) {
    const heading = [...region.querySelectorAll("h1, h2, [role=heading]")].find((node) =>
      DISCOVER_LABELS.includes(normalizedText(node))
    );
    if (!heading) return;

    const boundary = findCell(heading) || directBranch(region, heading);
    if (!boundary) return;
    boundary.classList.add("tuzai-frame-hidden");
    let sibling = boundary.nextElementSibling;
    while (sibling) {
      sibling.classList.add("tuzai-frame-hidden");
      sibling = sibling.nextElementSibling;
    }
  }

  function isolatePrimaryColumn(primary, sourceArticle) {
    const main = primary.closest("main");
    const region = findConversationRegion(primary, sourceArticle);
    if (!main || !region) return null;

    main.classList.add("tuzai-frame-main");
    primary.classList.add("tuzai-frame-primary");
    region.classList.add("tuzai-frame-conversation");
    hideSiblingsOnPath(region, main);
    return region;
  }

  function applySourcePane(region, sourceArticle) {
    sourceArticle.classList.add("tuzai-frame-source-article");
    const sourceCell = findCell(sourceArticle);
    const sortRow = findSortRow(sourceArticle);
    sortRow?.classList.add("tuzai-frame-hidden");
    hideDiscoverMore(region);

    const composer = region.querySelector('[data-testid^="tweetTextarea"], [contenteditable="true"][role="textbox"]');
    const composerContainer = findCell(composer) || (composer ? directBranch(region, composer) : null);
    composerContainer?.classList.add("tuzai-frame-hidden");

    for (const article of topLevelTweets(region)) {
      if (article !== sourceArticle) (findCell(article) || article).classList.add("tuzai-frame-hidden");
    }

    if (sourceCell) {
      let sibling = sourceCell.nextElementSibling;
      while (sibling) {
        sibling.classList.add("tuzai-frame-hidden");
        sibling = sibling.nextElementSibling;
      }
    }
  }

  function applyRepliesPane(region, sourceArticle) {
    const sortRow = findSortRow(sourceArticle);
    if (!sortRow) return false;

    sourceArticle.classList.add("tuzai-frame-reply-tools-source");
    sortRow.classList.add("tuzai-frame-reply-tools");
    hideSiblingsOnPath(sortRow, sourceArticle);
    hideDiscoverMore(region);
    return true;
  }

  function visibleOverlayOpen() {
    return [...document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"]')].some((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden";
    });
  }

  function initEmbeddedPane(mode) {
    document.documentElement.dataset.tuzaiFrame = mode;
    let readySent = false;
    let scheduled = false;

    const applyLayout = () => {
      scheduled = false;
      document.querySelectorAll(".tuzai-frame-hidden").forEach((node) => node.classList.remove("tuzai-frame-hidden"));
      const primary = document.querySelector('main [data-testid="primaryColumn"]');
      const articles = primary ? topLevelTweets(primary) : [];
      const currentPostId = Core.postIdFromUrl(location.href);
      const sourceArticle = articles.find((article) => Core.postIdFromUrl(findPostUrl(article)) === currentPostId) || articles[0] || null;
      if (!primary || !sourceArticle) return;

      const region = isolatePrimaryColumn(primary, sourceArticle);
      if (!region) return;
      const applied = mode === "source"
        ? (applySourcePane(region, sourceArticle), true)
        : applyRepliesPane(region, sourceArticle);
      if (!applied) return;

      if (!readySent) {
        readySent = true;
        const parentOrigin = /^https:\/\/(?:x|twitter)\.com$/i.test(new URL(document.referrer || location.origin).origin)
          ? new URL(document.referrer || location.origin).origin
          : location.origin;
        window.parent.postMessage({ type: FRAME_READY_MESSAGE, mode }, parentOrigin);
      }
    };

    const scheduleLayout = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(applyLayout);
    };

    const observer = new MutationObserver(scheduleLayout);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", scheduleLayout);
    window.addEventListener("hashchange", scheduleLayout);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || visibleOverlayOpen()) return;
      const parentOrigin = /^https:\/\/(?:x|twitter)\.com$/i.test(new URL(document.referrer || location.origin).origin)
        ? new URL(document.referrer || location.origin).origin
        : location.origin;
      window.parent.postMessage({ type: CLOSE_MESSAGE }, parentOrigin);
    });
    scheduleLayout();
  }

  const embeddedMode = frameMode();
  if (embeddedMode) {
    initEmbeddedPane(embeddedMode);
    return;
  }
  if (window.top !== window.self) return;

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

  function icon(name) {
    const node = document.createElement("i");
    node.className = `ph ${name}`;
    node.setAttribute("aria-hidden", "true");
    return node;
  }

  function createIconButton(name, label, className = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `tuzai-icon-button ${className}`.trim();
    button.setAttribute("aria-label", label);
    button.append(icon(name));
    return button;
  }

  function currentThemeClass() {
    const color = getComputedStyle(document.body).backgroundColor;
    if (/rgb\(0, 0, 0\)/.test(color)) return "tuzai-theme-dark";
    if (/rgb\((?:21|22), (?:31|32), (?:42|43)\)/.test(color)) return "tuzai-theme-dim";
    return "tuzai-theme-light";
  }

  function closePopover() {
    document.getElementById(ROOT_ID)?.remove();
    document.body.style.overflow = state.previousBodyOverflow;
    document.documentElement.style.overflow = state.previousHtmlOverflow;
    state.sourceUrl = null;
  }

  function createNativeFrame(url, mode, label) {
    const wrap = document.createElement("div");
    wrap.className = "tuzai-frame-wrap";
    wrap.dataset.mode = mode;

    const status = document.createElement("div");
    status.className = "tuzai-frame-status";
    status.append(icon("ph-circle-notch"), document.createTextNode(`正在加载${label}`));

    const frame = document.createElement("iframe");
    frame.className = "tuzai-native-frame";
    frame.dataset.tuzaiPane = mode;
    frame.name = `tuzai-${mode}-${Core.postIdFromUrl(url) || Date.now()}`;
    frame.title = label;
    frame.src = url;
    frame.allow = "clipboard-read; clipboard-write; fullscreen; picture-in-picture";
    frame.referrerPolicy = "strict-origin-when-cross-origin";
    wrap.append(frame, status);
    return wrap;
  }

  function openPopover(url) {
    closePopover();
    state.sourceUrl = url;
    state.previousBodyOverflow = document.body.style.overflow;
    state.previousHtmlOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const root = document.createElement("div");
    root.id = ROOT_ID;
    root.className = `tuzai-overlay ${currentThemeClass()}`;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "帖子浮层阅读器");

    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "tuzai-backdrop";
    backdrop.setAttribute("aria-label", "关闭浮层");
    backdrop.addEventListener("click", closePopover);

    const dialog = document.createElement("section");
    dialog.className = "tuzai-dialog";
    dialog.innerHTML = `
      <header class="tuzai-toolbar">
        <div class="tuzai-brand">
          <img src="${chrome.runtime.getURL("icons/icon48.png")}" alt="">
          <div><strong>帖子浮层</strong><span>主页位置已保留</span></div>
        </div>
        <div class="tuzai-toolbar-actions"></div>
      </header>
      <div class="tuzai-reader-grid">
        <section class="tuzai-pane tuzai-post-pane tuzai-native-pane">
          <header class="tuzai-pane-header"><div><strong>原帖</strong><span>X 原生内容与互动</span></div><span class="tuzai-interactive-pill">原生页面</span></header>
        </section>
        <section class="tuzai-pane tuzai-replies-pane tuzai-native-pane">
          <header class="tuzai-pane-header"><div><strong>评论</strong><span>X 原生排序、回复与讨论</span></div><span class="tuzai-interactive-pill">独立滚动</span></header>
        </section>
      </div>
      <footer class="tuzai-footer"><span><i class="ph ph-lock-key" aria-hidden="true"></i> 两栏均由当前登录的 X 原生页面提供</span><span>Esc 关闭</span></footer>`;

    const openOriginal = createIconButton("ph-arrow-square-out", "在 X 详情页打开");
    openOriginal.addEventListener("click", () => window.open(url, "_blank", "noopener"));
    const close = createIconButton("ph-x", "关闭", "tuzai-close");
    close.addEventListener("click", closePopover);
    dialog.querySelector(".tuzai-toolbar-actions").append(openOriginal, close);
    dialog.querySelector(".tuzai-post-pane").append(createNativeFrame(url, "source", "原帖"));
    dialog.querySelector(".tuzai-replies-pane").append(createNativeFrame(url, "replies", "评论"));

    root.append(backdrop, dialog);
    document.body.append(root);
    close.focus();
  }

  function handleTimelineClick(event) {
    if (!state.enabled || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if (document.getElementById(ROOT_ID)) return;
    const article = event.target.closest?.('article[data-testid="tweet"]');
    if (!article || !isTopLevelTweet(article) || shouldSkipTarget(event.target)) return;
    const url = findPostUrl(article);
    if (!url) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    openPopover(url);
  }

  window.addEventListener("message", (event) => {
    if (!/^https:\/\/(?:x|twitter)\.com$/i.test(event.origin)) return;
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const frames = [...root.querySelectorAll("iframe[data-tuzai-pane]")];
    if (!frames.some((frame) => frame.contentWindow === event.source)) return;

    if (event.data?.type === CLOSE_MESSAGE) closePopover();
    if (event.data?.type === FRAME_READY_MESSAGE) {
      const wrap = root.querySelector(`.tuzai-frame-wrap[data-mode="${CSS.escape(event.data.mode)}"]`);
      wrap?.classList.add("tuzai-frame-ready");
    }
  });

  document.addEventListener("click", handleTimelineClick, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.getElementById(ROOT_ID)) closePopover();
  });
  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TUZAI_SET_ENABLED") {
      state.enabled = Boolean(message.enabled);
      if (!state.enabled) closePopover();
    }
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.enabled) return;
    state.enabled = Boolean(changes.enabled.newValue);
    if (!state.enabled) closePopover();
  });
  chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => { state.enabled = enabled; });
})();
