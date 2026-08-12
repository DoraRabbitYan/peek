(function initTuzaiPopover() {
  "use strict";

  const Core = globalThis.TuzaiCore;
  const ROOT_ID = "tuzai-x-popover-root";
  const MAX_REPLIES = 36;
  const state = {
    enabled: true,
    requestId: null,
    sourceUrl: null,
    sourceArticle: null,
    previousBodyOverflow: ""
  };

  const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function findPostUrl(article) {
    for (const anchor of article.querySelectorAll('a[href*="/status/"]')) {
      const url = Core.normalizePostUrl(anchor.getAttribute("href"), location.href);
      if (url) return url;
    }
    return null;
  }

  function shouldSkipTarget(target) {
    if (!(target instanceof Element)) return true;
    if (target.closest('button, input, textarea, select, [contenteditable="true"], video')) return true;
    if (target.closest('[data-testid="like"], [data-testid="unlike"], [data-testid="retweet"], [data-testid="unretweet"], [data-testid="reply"], [data-testid="bookmark"], [data-testid="removeBookmark"], [data-testid="caret"], [data-testid="tweetPhoto"]')) return true;
    const anchor = target.closest("a[href]");
    return Boolean(anchor && !Core.normalizePostUrl(anchor.getAttribute("href"), location.href));
  }

  function isTopLevelTweet(article) {
    return !article.parentElement?.closest('article[data-testid="tweet"]');
  }

  function scrubClone(root) {
    root.querySelectorAll("script, iframe, object, embed, form").forEach((node) => node.remove());
    root.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        if (attribute.name.startsWith("on") || attribute.name === "srcdoc") node.removeAttribute(attribute.name);
      }
    });
    root.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    root.querySelectorAll("[tabindex]").forEach((node) => node.setAttribute("tabindex", "-1"));
    root.querySelectorAll("button").forEach((button) => {
      button.setAttribute("aria-disabled", "true");
      button.setAttribute("tabindex", "-1");
    });
    root.querySelectorAll("video").forEach((video) => {
      video.controls = true;
      video.muted = true;
    });
    root.classList.add("tuzai-cloned-article");
    return root;
  }

  function handleClonedContentClick(event) {
    const anchor = event.target.closest?.("a[href]");
    event.preventDefault();
    event.stopPropagation();
    if (anchor) window.open(anchor.href, "_blank", "noopener");
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

  function setReplyState(kind, details = {}) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const list = root.querySelector(".tuzai-reply-list");
    const count = root.querySelector(".tuzai-reply-count");
    if (!list || !count) return;
    list.replaceChildren();

    if (kind === "ready") {
      const template = document.createElement("template");
      details.replies.forEach((reply) => {
        template.innerHTML = reply.html;
        const article = template.content.querySelector('article[data-testid="tweet"]') ?? template.content.firstElementChild;
        if (article) list.append(scrubClone(article));
      });
      count.textContent = String(details.replies.length);
      return;
    }

    count.textContent = "—";
    const box = document.createElement("div");
    box.className = "tuzai-state";

    if (kind === "loading") {
      const spinner = document.createElement("span");
      spinner.className = "tuzai-spinner";
      box.append(spinner);
      box.insertAdjacentHTML("beforeend", "<strong>正在读取评论</strong><p>原帖已经可以阅读，评论加载完成后会自动出现。</p>");
    } else if (kind === "empty") {
      box.append(icon("ph-chat-circle-dots"));
      box.insertAdjacentHTML("beforeend", "<strong>暂时没有可见评论</strong><p>可能还没有回复，或者当前账号无权查看。</p>");
    } else {
      box.append(icon("ph-warning-circle"));
      const title = document.createElement("strong");
      title.textContent = "评论没有加载出来";
      const copy = document.createElement("p");
      copy.textContent = details.error || "检查网络后重新读取，不会影响主页位置。";
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "重新读取";
      retry.addEventListener("click", () => requestReplies());
      box.append(title, copy, retry);
    }
    list.append(box);
  }

  function closePopover() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    if (state.requestId) chrome.runtime.sendMessage({ type: "TUZAI_CANCEL", requestId: state.requestId });
    root.remove();
    document.body.style.overflow = state.previousBodyOverflow;
    state.requestId = null;
    state.sourceUrl = null;
    state.sourceArticle = null;
  }

  function requestReplies() {
    if (!state.sourceUrl) return;
    state.requestId = crypto.randomUUID();
    setReplyState("loading");
    chrome.runtime.sendMessage({
      type: "TUZAI_OPEN_POST",
      requestId: state.requestId,
      url: state.sourceUrl
    }).then((response) => {
      if (!response?.ok) setReplyState("error", { error: response?.error || "无法启动评论读取" });
    }).catch((error) => setReplyState("error", { error: error.message }));
  }

  function openPopover(article, url) {
    closePopover();
    state.sourceUrl = url;
    state.sourceArticle = article;
    state.previousBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

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
        <section class="tuzai-pane tuzai-post-pane">
          <header class="tuzai-pane-header"><div><strong>原帖</strong><span>内容与媒体</span></div><span class="tuzai-readonly-pill">只读预览</span></header>
          <div class="tuzai-scroll-area tuzai-post-body"></div>
        </section>
        <section class="tuzai-pane tuzai-replies-pane">
          <header class="tuzai-pane-header"><div><strong>评论</strong><span>按 X 当前默认顺序</span></div><span class="tuzai-reply-count">—</span></header>
          <div class="tuzai-scroll-area tuzai-reply-list"></div>
        </section>
      </div>
      <footer class="tuzai-footer"><span><i class="ph ph-lock-key" aria-hidden="true"></i> 内容仅在浏览器本地处理</span><span>Esc 关闭</span></footer>`;

    const openOriginal = createIconButton("ph-arrow-square-out", "在 X 详情页打开");
    openOriginal.addEventListener("click", () => window.open(url, "_blank", "noopener"));
    const close = createIconButton("ph-x", "关闭", "tuzai-close");
    close.addEventListener("click", closePopover);
    dialog.querySelector(".tuzai-toolbar-actions").append(openOriginal, close);

    const clone = scrubClone(article.cloneNode(true));
    const postBody = dialog.querySelector(".tuzai-post-body");
    postBody.append(clone);
    postBody.addEventListener("click", handleClonedContentClick, true);
    dialog.querySelector(".tuzai-reply-list").addEventListener("click", handleClonedContentClick, true);

    root.append(backdrop, dialog);
    document.body.append(root);
    close.focus();
    requestReplies();
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
    openPopover(article, url);
  }

  async function waitForConversation() {
    const deadline = Date.now() + 18000;
    while (Date.now() < deadline) {
      const column = document.querySelector('main [data-testid="primaryColumn"]');
      const articles = column ? [...column.querySelectorAll('article[data-testid="tweet"]')].filter(isTopLevelTweet) : [];
      if (articles.length) return { column, articles };
      await delay(250);
    }
    throw new Error("等待帖子详情超时");
  }

  async function extractConversation(requestId) {
    try {
      let { column, articles } = await waitForConversation();
      let stableRounds = 0;
      let lastCount = articles.length;
      for (let round = 0; round < 7 && articles.length < MAX_REPLIES + 1 && stableRounds < 2; round += 1) {
        window.scrollBy({ top: Math.max(700, window.innerHeight * 0.85), behavior: "instant" });
        await delay(700);
        articles = [...column.querySelectorAll('article[data-testid="tweet"]')].filter(isTopLevelTweet);
        stableRounds = articles.length === lastCount ? stableRounds + 1 : 0;
        lastCount = articles.length;
      }

      const items = Core.uniqueByPostId(articles.map((article) => ({
        url: findPostUrl(article),
        html: article.outerHTML
      }))).slice(1, MAX_REPLIES + 1);

      await chrome.runtime.sendMessage({
        type: "TUZAI_EXTRACTION_RESULT",
        requestId,
        replies: items
      });
    } catch (error) {
      await chrome.runtime.sendMessage({
        type: "TUZAI_EXTRACTION_ERROR",
        requestId,
        error: error.message
      });
    }
  }

  window.addEventListener("click", handleTimelineClick, true);
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.getElementById(ROOT_ID)) closePopover();
  }, true);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === "TUZAI_SET_ENABLED") {
      state.enabled = Boolean(message.enabled);
      if (!state.enabled) closePopover();
    } else if (message?.type === "TUZAI_BEGIN_EXTRACTION") {
      extractConversation(message.requestId);
    } else if (message?.type === "TUZAI_EXTRACTION_RESULT" && message.requestId === state.requestId) {
      setReplyState(message.replies?.length ? "ready" : "empty", { replies: message.replies ?? [] });
    } else if (message?.type === "TUZAI_EXTRACTION_ERROR" && message.requestId === state.requestId) {
      setReplyState("error", { error: message.error });
    }
  });

  chrome.storage.sync.get({ enabled: true }).then(({ enabled }) => { state.enabled = enabled; });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) {
      state.enabled = changes.enabled.newValue;
      if (!state.enabled) closePopover();
    }
  });
  chrome.runtime.sendMessage({ type: "TUZAI_CONTENT_READY" }).catch(() => {});
})();
