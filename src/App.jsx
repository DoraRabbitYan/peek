import { useEffect, useRef, useState } from "react";

const initialReplies = [
  {
    name: "若水",
    handle: "@ruoshui",
    time: "12分钟",
    minutesAgo: 12,
    text: "这个交互很适合看长讨论，时间线不用来回跳了。",
    likes: 18,
    views: 92,
  },
  {
    name: "阿林",
    handle: "@alin_builds",
    time: "8分钟",
    minutesAgo: 8,
    text: "左边保留原帖、右边只滚评论，比直接放大详情页更清楚。",
    likes: 9,
    views: 51,
  },
  {
    name: "松塔",
    handle: "@pinecone",
    time: "3分钟",
    minutesAgo: 3,
    text: "希望支持 Esc 关闭，以及从评论继续打开子讨论。",
    likes: 4,
    views: 27,
  },
];

const replySorts = {
  relevant: { label: "相关", orderLabel: "最相关" },
  recent: { label: "最新", orderLabel: "最新" },
  liked: { label: "最多喜欢", orderLabel: "最多喜欢" },
};

function Action({ icon, children, active = false, label, onClick }) {
  return (
    <button className="demo-action" data-active={active || undefined} aria-label={label} onClick={onClick}>
      <i className={`ph ${icon}`} aria-hidden="true" />
      {children}
    </button>
  );
}

function Avatar() {
  return (
    <span className="demo-avatar" aria-hidden="true">
      <i className="ph ph-user" />
    </span>
  );
}

function MockPost({ metrics, onAction }) {
  return (
    <article className="demo-post-card">
      <div className="demo-post-author">
        <Avatar />
        <div>
          <strong>兔仔研究所</strong>
          <span>@tuzai_lab · 1小时</span>
        </div>
        <button className="demo-more" aria-label="更多" onClick={() => onAction("more")}>
          <i className="ph ph-dots-three" aria-hidden="true" />
        </button>
      </div>
      <div className="demo-post-copy">
        <p>做了一个更顺手的 X 帖子阅读方式。</p>
        <p>在时间线点击帖子，直接打开双栏浮层：左边看原帖，右边读评论，关闭后继续从原位置往下刷。</p>
      </div>
      <div className="demo-quote-card">
        <div className="demo-quote-title"><Avatar /><strong>产品观察站</strong><span>@product_watch</span></div>
        <p>好的阅读工具，应该尽量减少用户在上下文之间来回搬家。</p>
      </div>
      <div className="demo-metrics">
        <Action icon="ph-chat-circle" label="回复" onClick={() => onAction("reply")}>2</Action>
        <Action icon="ph-arrows-clockwise" label="转发" active={metrics.reposted} onClick={() => onAction("retweet")}>{metrics.reposted ? 1 : null}</Action>
        <Action icon="ph-heart" label="喜欢" active={metrics.liked} onClick={() => onAction("like")}>{1 + Number(metrics.liked)}</Action>
        <Action icon="ph-bookmark-simple" label="加入书签" active={metrics.bookmarked} onClick={() => onAction("bookmark")} />
        <Action icon="ph-upload-simple" label="分享帖子" onClick={() => onAction("share")} />
      </div>
    </article>
  );
}

function Reply({ reply, onAction }) {
  return (
    <article className="demo-reply-card">
      <Avatar />
      <div className="demo-reply-main">
        <div className="demo-reply-meta">
          <strong>{reply.name}</strong>
          <span>{reply.handle} · {reply.time}</span>
          <i className="ph ph-dots-three" aria-hidden="true" />
        </div>
        <p>{reply.text}</p>
        <div className="demo-reply-actions">
          <Action icon="ph-chat-circle" label={`回复 ${reply.name}`} onClick={() => onAction("reply", reply)}>回复</Action>
          <Action icon="ph-heart" label={`喜欢 ${reply.name} 的回复`} active={reply.liked} onClick={() => onAction("like", reply)}>{reply.likes + Number(Boolean(reply.liked))}</Action>
          <Action icon="ph-chart-bar" label={`查看 ${reply.name} 的帖子分析`} onClick={() => onAction("analytics", reply)}>{reply.views ?? 0}</Action>
          <Action icon="ph-share-fat" label={`分享 ${reply.name} 的回复`} onClick={() => onAction("share", reply)} />
        </div>
      </div>
    </article>
  );
}

function TimelineBackground({ onOpen }) {
  return (
    <div className="demo-x-shell" aria-hidden="true">
      <aside className="demo-x-nav">
        <span className="demo-x-mark">X</span>
        {['ph-house','ph-magnifying-glass','ph-bell','ph-envelope-simple','ph-user'].map((icon) => (
          <i className={`ph ${icon}`} key={icon} />
        ))}
      </aside>
      <main className="demo-timeline">
        <header><strong>主页</strong><span>为你推荐</span><span>正在关注</span></header>
        <button className="demo-timeline-post" onClick={onOpen}>
          <Avatar />
          <span><strong>兔仔研究所</strong><small>@tuzai_lab</small>点击这条帖子，在当前页面打开浮层阅读器。</span>
        </button>
        {[1,2,3].map((item) => <div className="demo-skeleton-post" key={item} />)}
      </main>
      <aside className="demo-x-aside"><div className="demo-search">搜索</div><div className="demo-trends">有什么新鲜事</div></aside>
    </div>
  );
}

export function App() {
  const [open, setOpen] = useState(true);
  const [metrics, setMetrics] = useState({ liked: false, reposted: false, bookmarked: false });
  const [replyItems, setReplyItems] = useState(initialReplies);
  const [replyTarget, setReplyTarget] = useState("原帖");
  const [replyText, setReplyText] = useState("");
  const [replySort, setReplySort] = useState("relevant");
  const [sortOpen, setSortOpen] = useState(false);
  const [toast, setToast] = useState("");
  const toastTimer = useRef(null);

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      if (sortOpen) setSortOpen(false);
      else setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sortOpen]);

  const sortedReplies = [...replyItems].sort((left, right) => {
    if (replySort === "recent") return (left.minutesAgo ?? Number.MAX_SAFE_INTEGER) - (right.minutesAgo ?? Number.MAX_SAFE_INTEGER);
    if (replySort === "liked") return (right.likes + Number(Boolean(right.liked))) - (left.likes + Number(Boolean(left.liked)));
    return 0;
  });

  const notify = (message) => {
    window.clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = window.setTimeout(() => setToast(""), 1800);
  };

  const handlePostAction = (action) => {
    if (action === "reply") {
      setReplyTarget("原帖");
      document.querySelector(".tuzai-composer textarea")?.focus();
      return;
    }
    if (action === "share") {
      navigator.clipboard?.writeText("https://x.com/tuzai_lab/status/2087155564904370681").catch(() => {});
      notify("帖子链接已复制");
      return;
    }
    if (action === "more") {
      notify("更多菜单保留：可复制链接或在 X 打开完整操作");
      return;
    }
    if (action === "analytics") {
      notify("查看量与帖子分析入口已保留");
      return;
    }
    const key = action === "retweet" ? "reposted" : action === "bookmark" ? "bookmarked" : "liked";
    setMetrics((current) => ({ ...current, [key]: !current[key] }));
    notify(action === "retweet" ? "转发状态已同步" : action === "bookmark" ? "收藏状态已同步" : "点赞状态已同步");
  };

  const handleReplyAction = (action, reply) => {
    if (action === "reply") {
      setReplyTarget(reply.name);
      document.querySelector(".tuzai-composer textarea")?.focus();
    } else if (action === "share") {
      navigator.clipboard?.writeText(`https://x.com/${reply.handle.slice(1)}/status/demo`).catch(() => {});
      notify("回复链接已复制");
    } else if (action === "analytics") {
      notify("查看量与帖子分析入口已保留");
    } else {
      setReplyItems((current) => current.map((item) => item.handle === reply.handle ? { ...item, liked: !item.liked } : item));
      notify("点赞状态已同步");
    }
  };

  const publishReply = () => {
    const text = replyText.trim();
    if (!text) return;
    setReplyItems((current) => [{ name: "Tino Xu", handle: "@Tino_Xu_", time: "刚刚", minutesAgo: 0, text, likes: 0, liked: false }, ...current]);
    setReplyText("");
    setReplyTarget("原帖");
    notify("回复已发布到 X");
  };

  return (
    <main className="demo-stage">
      <TimelineBackground onOpen={() => setOpen(true)} />
      {!open && <button className="demo-reopen" onClick={() => setOpen(true)}>重新打开浮层</button>}
      {open && (
        <div className="tuzai-overlay tuzai-theme-light" role="dialog" aria-modal="true" aria-label="帖子浮层阅读器">
          <button className="tuzai-backdrop" aria-label="关闭浮层" onClick={() => setOpen(false)} />
          <section className="tuzai-dialog">
            <header className="tuzai-toolbar">
              <div className="tuzai-brand">
                <img src="/assets/tuzai-icon-source.png" alt="" />
                <div><strong>帖子浮层</strong><span>主页位置已保留</span></div>
              </div>
              <div className="tuzai-toolbar-actions">
                <button className="tuzai-icon-button" aria-label="在 X 打开"><i className="ph ph-arrow-square-out" /></button>
                <button className="tuzai-icon-button tuzai-close" aria-label="关闭" onClick={() => setOpen(false)}><i className="ph ph-x" /></button>
              </div>
            </header>
            <div className="tuzai-reader-grid">
              <section className="tuzai-pane tuzai-post-pane">
                <header className="tuzai-pane-header"><div><strong>原帖</strong><span>X 原生内容与互动</span></div><span className="tuzai-interactive-pill">原生页面</span></header>
                <div className="tuzai-scroll-area tuzai-post-body">
                  <MockPost metrics={metrics} onAction={handlePostAction} />
                </div>
              </section>
              <section className="tuzai-pane tuzai-replies-pane">
                <header className="tuzai-pane-header"><div><strong>评论</strong><span>X 原生排序、回复与讨论</span></div><span className="tuzai-interactive-pill">独立滚动</span></header>
                <div className="tuzai-reply-tools">
                  <div className="tuzai-context-row">
                    <div className="tuzai-sort-control">
                      <button className="tuzai-sort-trigger" type="button" aria-haspopup="listbox" aria-expanded={sortOpen} aria-label="评论排序" onClick={() => setSortOpen((current) => !current)}><span>{replySorts[replySort].label}</span><i className="ph ph-caret-down" /></button>
                      <div className="tuzai-sort-menu" role="listbox" aria-label="选择评论排序方式" hidden={!sortOpen}>
                        {Object.entries(replySorts).map(([value, option]) => <button className="tuzai-sort-option" type="button" role="option" aria-selected={replySort === value} key={value} onClick={() => { setReplySort(value); setSortOpen(false); notify(`已按${option.orderLabel}排序`); }}><span>{option.orderLabel}</span>{replySort === value && <i className="ph ph-check tuzai-sort-check" />}</button>)}
                      </div>
                    </div>
                    <a href="https://x.com/tuzai_lab/status/2087155564904370681/quotes" target="_blank" rel="noreferrer">查看引用 <i className="ph ph-caret-right" /></a>
                  </div>
                  <section className="tuzai-composer" data-target-url="https://x.com/tuzai_lab/status/2087155564904370681">
                    <img className="tuzai-composer-avatar" src="/assets/tino-avatar.png" alt="" />
                    <div className="tuzai-composer-body"><span className="tuzai-composer-target">回复{replyTarget}</span><textarea rows="2" maxLength="280" value={replyText} onChange={(event) => setReplyText(event.target.value)} placeholder={`发布你对${replyTarget}的回复`} aria-label="发布你的回复" /></div>
                    <button type="button" disabled={!replyText.trim()} onClick={publishReply}>回复</button>
                  </section>
                </div>
                <div className="tuzai-scroll-area tuzai-reply-list">
                  {sortedReplies.map((reply) => <Reply reply={reply} onAction={handleReplyAction} key={`${reply.handle}-${reply.time}`} />)}
                </div>
              </section>
            </div>
            <footer className="tuzai-footer"><span><i className="ph ph-lock-key" /> 两栏均由当前登录的 X 原生页面提供</span><span>Esc 关闭</span></footer>
            {toast && <div className="tuzai-toast" role="status">{toast}</div>}
          </section>
        </div>
      )}
    </main>
  );
}
