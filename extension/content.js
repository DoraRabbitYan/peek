(function initTuzaiPopover() {
  "use strict";

  const Core = globalThis.TuzaiCore;
  const ROOT_ID = "tuzai-x-popover-root";
  const MAX_REPLIES = 36;
  const REPLY_SORTS = {
    relevant: { label: "相关", orderLabel: "最相关" },
    recent: { label: "最新", orderLabel: "最新" },
    liked: { label: "最多喜欢", orderLabel: "最多喜欢" }
  };
  const X_SORT_LABELS = {
    relevant: ["相关", "最相关", "relevant", "most relevant"],
    recent: ["最新", "最近", "recent", "most recent"],
    liked: ["喜欢", "最多喜欢", "最多点赞", "最受喜欢", "likes", "most liked"]
  };
  const state = {
    enabled: true,
    requestId: null,
    sourceUrl: null,
    sourceArticle: null,
    previousBodyOverflow: "",
    activeReplyUrl: null,
    toastTimer: null,
    replySort: "relevant"
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

  function scrubClone(root, postUrl = null) {
    root.querySelectorAll("script, iframe, object, embed, form").forEach((node) => node.remove());
    root.querySelectorAll("*").forEach((node) => {
      for (const attribute of [...node.attributes]) {
        if (attribute.name.startsWith("on") || attribute.name === "srcdoc") node.removeAttribute(attribute.name);
      }
    });
    root.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    root.querySelectorAll("[tabindex]").forEach((node) => node.setAttribute("tabindex", "-1"));
    root.querySelectorAll("button").forEach((button) => {
      const action = Core.actionNameFromMetadata(button.dataset.testid, button.getAttribute("aria-label"));
      if (action) {
        button.removeAttribute("aria-disabled");
        button.removeAttribute("disabled");
        button.setAttribute("tabindex", "0");
        button.dataset.tuzaiAction = action;
      } else {
        button.setAttribute("tabindex", "-1");
      }
    });
    root.querySelectorAll("video").forEach((video) => {
      video.controls = true;
      video.muted = true;
    });
    root.classList.add("tuzai-cloned-article");
    const normalizedUrl = Core.normalizePostUrl(postUrl || findPostUrl(root), location.href);
    if (normalizedUrl) root.dataset.tuzaiPostUrl = normalizedUrl;
    return root;
  }

  function showToast(message, tone = "default") {
    const root = document.getElementById(ROOT_ID);
    const toast = root?.querySelector(".tuzai-toast");
    if (!toast) return;
    window.clearTimeout(state.toastTimer);
    toast.textContent = message;
    toast.dataset.tone = tone;
    toast.hidden = false;
    state.toastTimer = window.setTimeout(() => { toast.hidden = true; }, 2400);
  }

  function actionFromTarget(target) {
    const button = target.closest?.("button");
    if (!button) return null;
    return Core.actionNameFromMetadata(button.dataset.testid, button.getAttribute("aria-label"));
  }

  function clonePostUrl(target) {
    return target.closest?.(".tuzai-cloned-article")?.dataset.tuzaiPostUrl || state.sourceUrl;
  }

  function replaceArticleClone(article) {
    if (!article?.url || !article.html) return;
    const template = document.createElement("template");
    template.innerHTML = article.html;
    const nextArticle = template.content.querySelector('article[data-testid="tweet"]') ?? template.content.firstElementChild;
    if (!nextArticle) return;
    const selector = `.tuzai-cloned-article[data-tuzai-post-url="${CSS.escape(article.url)}"]`;
    document.querySelectorAll(selector).forEach((current) => {
      current.replaceWith(scrubClone(nextArticle.cloneNode(true), article.url));
    });
  }

  async function copyPostLink(url) {
    try {
      await navigator.clipboard.writeText(url);
      showToast("帖子链接已复制");
    } catch {
      window.open(url, "_blank", "noopener");
      showToast("已在新标签页打开帖子");
    }
  }

  async function sharePost(url) {
    if (navigator.share) {
      try {
        await navigator.share({ title: "X 帖子", url });
        return;
      } catch (error) {
        if (error?.name === "AbortError") return;
      }
    }
    await copyPostLink(url);
  }

  function openMoreMenu(button, url) {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    root.querySelector(".tuzai-action-menu")?.remove();
    const menu = document.createElement("div");
    menu.className = "tuzai-action-menu";
    menu.setAttribute("role", "menu");
    const rect = button.getBoundingClientRect();
    menu.style.left = `${Math.min(rect.left, window.innerWidth - 210)}px`;
    menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - 112)}px`;

    const copy = document.createElement("button");
    copy.type = "button";
    copy.setAttribute("role", "menuitem");
    copy.append(icon("ph-link"), document.createTextNode("复制帖子链接"));
    copy.addEventListener("click", () => { menu.remove(); copyPostLink(url); });

    const open = document.createElement("button");
    open.type = "button";
    open.setAttribute("role", "menuitem");
    open.append(icon("ph-arrow-square-out"), document.createTextNode("在 X 打开更多操作"));
    open.addEventListener("click", () => { menu.remove(); window.open(url, "_blank", "noopener"); });
    menu.append(copy, open);
    root.append(menu);
  }

  function setComposerTarget(url, label = "原帖") {
    const root = document.getElementById(ROOT_ID);
    const composer = root?.querySelector(".tuzai-composer");
    if (!composer || !url) return;
    state.activeReplyUrl = url;
    composer.dataset.targetUrl = url;
    composer.querySelector(".tuzai-composer-target").textContent = `回复 ${label}`;
    const input = composer.querySelector("textarea");
    input.placeholder = `发布你对${label}的回复`;
    input.focus();
  }

  async function performPostAction(action, url, button = null, text = "") {
    if (!state.requestId) {
      showToast("评论仍在连接，请稍候再试", "error");
      return null;
    }
    if (button) button.setAttribute("aria-busy", "true");
    try {
      const response = await chrome.runtime.sendMessage({
        type: "TUZAI_ACTION",
        requestId: state.requestId,
        url,
        action,
        text
      });
      if (!response?.ok) throw new Error(response?.error || "X 没有完成这项操作");
      if (response.article) replaceArticleClone(response.article);
      showToast(response.message || "已同步到 X");
      return response;
    } catch (error) {
      showToast(error.message || "操作失败，请重试", "error");
      return null;
    } finally {
      button?.removeAttribute("aria-busy");
    }
  }

  async function submitReply(composer) {
    const input = composer.querySelector("textarea");
    const submit = composer.querySelector("button[data-tuzai-submit-reply]");
    const text = input.value.trim();
    const url = composer.dataset.targetUrl || state.sourceUrl;
    if (!text || !url) return;
    submit.disabled = true;
    input.disabled = true;
    const response = await performPostAction("reply", url, submit, text);
    input.disabled = false;
    submit.disabled = false;
    if (response) {
      input.value = "";
      await requestReplies();
    }
  }

  function createReplyComposer() {
    const composer = document.createElement("section");
    composer.className = "tuzai-composer";
    composer.dataset.targetUrl = state.sourceUrl || "";

    const profileImage = document.querySelector('a[data-testid="AppTabBar_Profile_Link"] img')?.src;
    const avatar = profileImage ? document.createElement("img") : icon("ph-user");
    if (profileImage) {
      avatar.src = profileImage;
      avatar.alt = "";
    }
    avatar.classList.add("tuzai-composer-avatar");

    const body = document.createElement("div");
    body.className = "tuzai-composer-body";
    const target = document.createElement("span");
    target.className = "tuzai-composer-target";
    target.textContent = "回复原帖";
    const input = document.createElement("textarea");
    input.rows = 2;
    input.maxLength = 280;
    input.placeholder = "发布你对原帖的回复";
    input.setAttribute("aria-label", "发布你的回复");
    const submit = document.createElement("button");
    submit.type = "button";
    submit.dataset.tuzaiSubmitReply = "true";
    submit.textContent = "回复";
    submit.disabled = true;
    input.addEventListener("input", () => { submit.disabled = !input.value.trim(); });
    input.addEventListener("keydown", (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") submit.click();
    });
    submit.addEventListener("click", () => submitReply(composer));
    body.append(target, input);
    composer.append(avatar, body, submit);
    return composer;
  }

  function updateReplySortUi() {
    const root = document.getElementById(ROOT_ID);
    if (!root) return;
    const option = REPLY_SORTS[state.replySort] || REPLY_SORTS.relevant;
    const label = root.querySelector(".tuzai-sort-label");
    const order = root.querySelector(".tuzai-reply-order");
    if (label) label.textContent = option.label;
    if (order) order.textContent = `按${option.orderLabel}顺序`;
    root.querySelectorAll(".tuzai-sort-option").forEach((button) => {
      const selected = button.dataset.sort === state.replySort;
      button.setAttribute("aria-selected", String(selected));
      button.querySelector(".tuzai-sort-check")?.toggleAttribute("hidden", !selected);
    });
  }

  function closeReplySortMenu() {
    const root = document.getElementById(ROOT_ID);
    const trigger = root?.querySelector(".tuzai-sort-trigger");
    const menu = root?.querySelector(".tuzai-sort-menu");
    if (!trigger || !menu) return;
    menu.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  }

  function selectReplySort(sort) {
    const next = Core.normalizeReplySort(sort);
    closeReplySortMenu();
    if (next === state.replySort) return;
    state.replySort = next;
    chrome.storage.sync.set({ replySort: next }).catch(() => {});
    updateReplySortUi();
    requestReplies();
  }

  function createReplySortControl() {
    const control = document.createElement("div");
    control.className = "tuzai-sort-control";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "tuzai-sort-trigger";
    trigger.setAttribute("aria-haspopup", "listbox");
    trigger.setAttribute("aria-expanded", "false");
    trigger.setAttribute("aria-label", "评论排序");
    const label = document.createElement("span");
    label.className = "tuzai-sort-label";
    trigger.append(label, icon("ph-caret-down"));

    const menu = document.createElement("div");
    menu.className = "tuzai-sort-menu";
    menu.setAttribute("role", "listbox");
    menu.setAttribute("aria-label", "选择评论排序方式");
    menu.hidden = true;
    Object.entries(REPLY_SORTS).forEach(([value, option]) => {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "tuzai-sort-option";
      item.dataset.sort = value;
      item.setAttribute("role", "option");
      const text = document.createElement("span");
      text.textContent = option.orderLabel;
      const check = icon("ph-check");
      check.classList.add("tuzai-sort-check");
      item.append(text, check);
      item.addEventListener("click", () => selectReplySort(value));
      menu.append(item);
    });
    trigger.addEventListener("click", (event) => {
      event.stopPropagation();
      const willOpen = menu.hidden;
      menu.hidden = !willOpen;
      trigger.setAttribute("aria-expanded", String(willOpen));
    });
    control.append(trigger, menu);
    return control;
  }

  async function handleClonedContentClick(event) {
    const clonedArticle = event.target.closest?.(".tuzai-cloned-article");
    if (!clonedArticle) return;
    const action = actionFromTarget(event.target);
    const anchor = event.target.closest?.("a[href]");
    const url = clonedArticle.dataset.tuzaiPostUrl || clonePostUrl(event.target);
    event.preventDefault();
    event.stopPropagation();
    if (action && url) {
      const button = event.target.closest("button");
      if (action === "reply") {
        const article = event.target.closest(".tuzai-cloned-article");
        const label = article?.querySelector('[data-testid="User-Name"]')?.innerText?.split("\n")[0] || "这条帖子";
        setComposerTarget(url, label);
      } else if (action === "share") {
        await sharePost(url);
      } else if (action === "more") {
        openMoreMenu(button, url);
      } else {
        await performPostAction(action, url, button);
      }
      return;
    }
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
    const sortTrigger = root.querySelector(".tuzai-sort-trigger");
    if (sortTrigger) sortTrigger.disabled = kind === "loading";
    updateReplySortUi();

    if (details.source?.html) {
      const sourceTemplate = document.createElement("template");
      sourceTemplate.innerHTML = details.source.html;
      const sourceArticle = sourceTemplate.content.querySelector('article[data-testid="tweet"]') ?? sourceTemplate.content.firstElementChild;
      const currentSource = root.querySelector(".tuzai-post-body > .tuzai-cloned-article");
      if (sourceArticle && currentSource) currentSource.replaceWith(scrubClone(sourceArticle, details.source.url || state.sourceUrl));
    }

    if (kind === "ready") {
      const template = document.createElement("template");
      details.replies.forEach((reply) => {
        template.innerHTML = reply.html;
        const article = template.content.querySelector('article[data-testid="tweet"]') ?? template.content.firstElementChild;
        if (article) list.append(scrubClone(article, reply.url));
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
    state.activeReplyUrl = null;
    window.clearTimeout(state.toastTimer);
  }

  async function requestReplies() {
    if (!state.sourceUrl) return;
    const previousRequestId = state.requestId;
    if (previousRequestId) {
      await chrome.runtime.sendMessage({ type: "TUZAI_CANCEL", requestId: previousRequestId }).catch(() => {});
    }
    state.requestId = crypto.randomUUID();
    setReplyState("loading");
    return chrome.runtime.sendMessage({
      type: "TUZAI_OPEN_POST",
      requestId: state.requestId,
      url: state.sourceUrl,
      sort: state.replySort
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
          <header class="tuzai-pane-header"><div><strong>原帖</strong><span>内容、数据与互动</span></div><span class="tuzai-interactive-pill">可直接互动</span></header>
          <div class="tuzai-scroll-area tuzai-post-body"></div>
        </section>
        <section class="tuzai-pane tuzai-replies-pane">
          <header class="tuzai-pane-header"><div><strong>评论</strong><span class="tuzai-reply-order">按最相关顺序</span></div><span class="tuzai-reply-count">—</span></header>
          <div class="tuzai-reply-tools"></div>
          <div class="tuzai-scroll-area tuzai-reply-list"></div>
        </section>
      </div>
      <footer class="tuzai-footer"><span><i class="ph ph-lock-key" aria-hidden="true"></i> 内容本地处理 · 互动同步到当前 X 账号</span><span>Esc 关闭</span></footer>
      <div class="tuzai-toast" role="status" aria-live="polite" hidden></div>`;

    const openOriginal = createIconButton("ph-arrow-square-out", "在 X 详情页打开");
    openOriginal.addEventListener("click", () => window.open(url, "_blank", "noopener"));
    const close = createIconButton("ph-x", "关闭", "tuzai-close");
    close.addEventListener("click", closePopover);
    dialog.querySelector(".tuzai-toolbar-actions").append(openOriginal, close);

    const clone = scrubClone(article.cloneNode(true), url);
    const postBody = dialog.querySelector(".tuzai-post-body");
    const contextRow = document.createElement("div");
    contextRow.className = "tuzai-context-row";
    const related = createReplySortControl();
    const activity = document.createElement("a");
    activity.href = `${url}/quotes`;
    activity.target = "_blank";
    activity.rel = "noopener";
    activity.append(document.createTextNode("查看动态"), icon("ph-caret-right"));
    contextRow.append(related, activity);
    postBody.append(clone);
    dialog.querySelector(".tuzai-reply-tools").append(contextRow, createReplyComposer());
    postBody.addEventListener("click", handleClonedContentClick, true);
    dialog.querySelector(".tuzai-reply-list").addEventListener("click", handleClonedContentClick, true);
    root.addEventListener("click", (event) => {
      if (!event.target.closest?.(".tuzai-sort-control")) closeReplySortMenu();
    });

    root.append(backdrop, dialog);
    document.body.append(root);
    updateReplySortUi();
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

  function normalizedControlText(node) {
    return String(node?.innerText || node?.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function sortFromControl(node) {
    const text = normalizedControlText(node);
    return Object.entries(X_SORT_LABELS).find(([, labels]) => labels.some((label) => text === label || text.startsWith(`${label} `)))?.[0] || null;
  }

  function isVisibleControl(node) {
    const rect = node?.getBoundingClientRect?.();
    return Boolean(rect && rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== "hidden");
  }

  function findNativeSortTrigger(column) {
    return [...column.querySelectorAll('button, [role="button"]')].find((node) => (
      isVisibleControl(node) && sortFromControl(node)
    )) || null;
  }

  async function applyNativeReplySort(sort, column) {
    const requested = Core.normalizeReplySort(sort);
    const trigger = findNativeSortTrigger(column);
    if (!trigger) return false;
    if (sortFromControl(trigger) === requested) return false;
    trigger.click();

    const deadline = Date.now() + 5000;
    let option = null;
    while (Date.now() < deadline && !option) {
      option = [...document.querySelectorAll('[role="menuitemradio"], [role="menuitem"], [role="option"], button, [role="button"]')].find((node) => (
        node !== trigger && isVisibleControl(node) && sortFromControl(node) === requested
      ));
      if (!option) await delay(120);
    }
    if (!option) return false;
    option.click();
    await delay(950);
    window.scrollTo({ top: 0, behavior: "instant" });
    return true;
  }

  function replyMetadata(article) {
    const like = article.querySelector('[data-testid="like"], [data-testid="unlike"]');
    const likeText = `${like?.innerText || ""} ${like?.getAttribute("aria-label") || ""}`;
    return {
      createdAt: article.querySelector("time")?.dateTime || "",
      likeCount: Core.parseCompactCount(likeText)
    };
  }

  async function extractConversation(requestId, requestedSort = "relevant") {
    try {
      let { column, articles } = await waitForConversation();
      const sort = Core.normalizeReplySort(requestedSort);
      const changed = await applyNativeReplySort(sort, column);
      if (changed) ({ column, articles } = await waitForConversation());
      const initialArticle = articles[0];
      const source = initialArticle ? { url: findPostUrl(initialArticle), html: initialArticle.outerHTML } : null;
      const sourceId = Core.postIdFromUrl(source?.url);
      let stableRounds = 0;
      let lastCount = articles.length;
      for (let round = 0; round < 7 && articles.length < MAX_REPLIES + 1 && stableRounds < 2; round += 1) {
        window.scrollBy({ top: Math.max(700, window.innerHeight * 0.85), behavior: "instant" });
        await delay(700);
        articles = [...column.querySelectorAll('article[data-testid="tweet"]')].filter(isTopLevelTweet);
        stableRounds = articles.length === lastCount ? stableRounds + 1 : 0;
        lastCount = articles.length;
      }

      const items = Core.sortReplyItems(Core.uniqueByPostId(articles.map((article) => ({
        url: findPostUrl(article),
        html: article.outerHTML,
        ...replyMetadata(article)
      }))).filter((item) => Core.postIdFromUrl(item.url) !== sourceId), sort).slice(0, MAX_REPLIES);

      await chrome.runtime.sendMessage({
        type: "TUZAI_EXTRACTION_RESULT",
        requestId,
        source,
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

  async function waitForElement(selector, scope = document, timeout = 6000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const element = scope.querySelector(selector);
      if (element) return element;
      await delay(120);
    }
    throw new Error("等待 X 操作界面超时");
  }

  function conversationArticles() {
    const column = document.querySelector('main [data-testid="primaryColumn"]');
    return column ? [...column.querySelectorAll('article[data-testid="tweet"]')].filter(isTopLevelTweet) : [];
  }

  async function findArticleForAction(url) {
    const targetId = Core.postIdFromUrl(url);
    if (!targetId) throw new Error("无法识别帖子地址");

    window.scrollTo({ top: 0, behavior: "instant" });
    for (let round = 0; round < 18; round += 1) {
      await delay(round === 0 ? 250 : 360);
      const article = conversationArticles().find((candidate) => Core.postIdFromUrl(findPostUrl(candidate)) === targetId);
      if (article) return article;
      window.scrollBy({ top: Math.max(520, window.innerHeight * 0.72), behavior: "instant" });
    }
    throw new Error("这条帖子已不在当前评论列表，请重新读取后再试");
  }

  function articlePayload(article) {
    return { url: findPostUrl(article), html: article.outerHTML };
  }

  async function performConversationAction(message) {
    const article = await findArticleForAction(message.url);
    const selectors = {
      like: '[data-testid="like"], [data-testid="unlike"]',
      bookmark: '[data-testid="bookmark"], [data-testid="removeBookmark"]',
      retweet: '[data-testid="retweet"], [data-testid="unretweet"]'
    };

    if (message.action === "reply") {
      const reply = article.querySelector('[data-testid="reply"]');
      if (!reply) throw new Error("X 没有提供回复入口");
      reply.click();
      const dialog = await waitForElement('[role="dialog"]');
      const editor = await waitForElement('[data-testid="tweetTextarea_0"]', dialog);
      editor.focus();
      const inserted = document.execCommand?.("insertText", false, String(message.text || "").slice(0, 280));
      if (!inserted) {
        editor.textContent = String(message.text || "").slice(0, 280);
        editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: message.text }));
      }
      await delay(240);
      const submit = await waitForElement('[data-testid="tweetButton"]', dialog);
      if (submit.getAttribute("aria-disabled") === "true" || submit.disabled) throw new Error("回复内容未被 X 接受");
      submit.click();
      await delay(900);
      return { ok: true, message: "回复已发布到 X" };
    }

    const selector = selectors[message.action];
    if (!selector) throw new Error("暂不支持这项操作");
    const button = article.querySelector(selector);
    if (!button) throw new Error("X 没有提供这项操作");
    button.click();

    if (message.action === "retweet") {
      const confirm = await waitForElement('[data-testid="retweetConfirm"], [data-testid="unretweetConfirm"]');
      confirm.click();
    }

    await delay(720);
    const refreshed = await findArticleForAction(message.url);
    const labels = { like: "点赞状态已同步", bookmark: "收藏状态已同步", retweet: "转发状态已同步" };
    return { ok: true, message: labels[message.action], article: articlePayload(refreshed) };
  }

  window.addEventListener("click", handleTimelineClick, true);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !document.getElementById(ROOT_ID)) return;
    const menu = document.querySelector(`#${ROOT_ID} .tuzai-sort-menu`);
    if (menu && !menu.hidden) {
      closeReplySortMenu();
      document.querySelector(`#${ROOT_ID} .tuzai-sort-trigger`)?.focus();
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    closePopover();
  }, true);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "TUZAI_SET_ENABLED") {
      state.enabled = Boolean(message.enabled);
      if (!state.enabled) closePopover();
    } else if (message?.type === "TUZAI_BEGIN_EXTRACTION") {
      extractConversation(message.requestId, message.sort);
    } else if (message?.type === "TUZAI_EXTRACTION_RESULT" && message.requestId === state.requestId) {
      setReplyState(message.replies?.length ? "ready" : "empty", { source: message.source, replies: message.replies ?? [] });
    } else if (message?.type === "TUZAI_EXTRACTION_ERROR" && message.requestId === state.requestId) {
      setReplyState("error", { error: message.error });
    } else if (message?.type === "TUZAI_PERFORM_ACTION") {
      performConversationAction(message)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }
    return false;
  });

  chrome.storage.sync.get({ enabled: true, replySort: "relevant" }).then(({ enabled, replySort }) => {
    state.enabled = enabled;
    state.replySort = Core.normalizeReplySort(replySort);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.enabled) {
      state.enabled = changes.enabled.newValue;
      if (!state.enabled) closePopover();
    }
    if (area === "sync" && changes.replySort) {
      state.replySort = Core.normalizeReplySort(changes.replySort.newValue);
      updateReplySortUi();
    }
  });
  chrome.runtime.sendMessage({ type: "TUZAI_CONTENT_READY" }).catch(() => {});
})();
