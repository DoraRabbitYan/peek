import { useEffect, useState } from "react";

const replies = [
  {
    name: "若水",
    handle: "@ruoshui",
    time: "12分钟",
    text: "这个交互很适合看长讨论，时间线不用来回跳了。",
    likes: 18,
  },
  {
    name: "阿林",
    handle: "@alin_builds",
    time: "8分钟",
    text: "左边保留原帖、右边只滚评论，比直接放大详情页更清楚。",
    likes: 9,
  },
  {
    name: "松塔",
    handle: "@pinecone",
    time: "3分钟",
    text: "希望支持 Esc 关闭，以及从评论继续打开子讨论。",
    likes: 4,
  },
];

function Action({ icon, children }) {
  return (
    <span className="demo-action">
      <i className={`ph ${icon}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function Avatar() {
  return (
    <span className="demo-avatar" aria-hidden="true">
      <i className="ph ph-user" />
    </span>
  );
}

function MockPost() {
  return (
    <article className="demo-post-card">
      <div className="demo-post-author">
        <Avatar />
        <div>
          <strong>兔仔研究所</strong>
          <span>@tuzai_lab · 1小时</span>
        </div>
        <button className="demo-more" aria-label="更多">
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
        <Action icon="ph-chat-circle">23</Action>
        <Action icon="ph-arrows-clockwise">16</Action>
        <Action icon="ph-heart">128</Action>
        <Action icon="ph-bookmark-simple">31</Action>
        <Action icon="ph-share-fat" />
      </div>
    </article>
  );
}

function Reply({ reply }) {
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
          <Action icon="ph-chat-circle">回复</Action>
          <Action icon="ph-heart">{reply.likes}</Action>
          <Action icon="ph-share-fat" />
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
  const [state, setState] = useState("ready");

  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

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
                <label className="demo-state-picker">
                  <span>评论状态</span>
                  <select value={state} onChange={(event) => setState(event.target.value)}>
                    <option value="ready">已加载</option>
                    <option value="loading">加载中</option>
                    <option value="empty">暂无评论</option>
                    <option value="error">加载失败</option>
                  </select>
                </label>
                <button className="tuzai-icon-button" aria-label="在 X 打开"><i className="ph ph-arrow-square-out" /></button>
                <button className="tuzai-icon-button tuzai-close" aria-label="关闭" onClick={() => setOpen(false)}><i className="ph ph-x" /></button>
              </div>
            </header>
            <div className="tuzai-reader-grid">
              <section className="tuzai-pane tuzai-post-pane">
                <header className="tuzai-pane-header"><div><strong>原帖</strong><span>内容与媒体</span></div><span className="tuzai-readonly-pill">只读预览</span></header>
                <div className="tuzai-scroll-area tuzai-post-body"><MockPost /></div>
              </section>
              <section className="tuzai-pane tuzai-replies-pane">
                <header className="tuzai-pane-header"><div><strong>评论</strong><span>{state === 'ready' ? '按 X 默认顺序' : '读取当前会话可见内容'}</span></div><span className="tuzai-reply-count">{state === 'ready' ? replies.length : '—'}</span></header>
                <div className="tuzai-scroll-area tuzai-reply-list">
                  {state === "ready" && replies.map((reply) => <Reply reply={reply} key={reply.handle} />)}
                  {state === "loading" && <div className="tuzai-state"><span className="tuzai-spinner" /><strong>正在读取评论</strong><p>原帖已经可以阅读，评论加载完成后会自动出现。</p></div>}
                  {state === "empty" && <div className="tuzai-state"><i className="ph ph-chat-circle-dots" /><strong>暂时没有可见评论</strong><p>可能还没有回复，或者当前账号无权查看。</p></div>}
                  {state === "error" && <div className="tuzai-state"><i className="ph ph-warning-circle" /><strong>评论没有加载出来</strong><p>检查网络后可以重新读取，不会影响主页位置。</p><button onClick={() => setState('loading')}>重新读取</button></div>}
                </div>
              </section>
            </div>
            <footer className="tuzai-footer"><span><i className="ph ph-lock-key" /> 内容仅在浏览器本地处理</span><span>Esc 关闭</span></footer>
          </section>
        </div>
      )}
    </main>
  );
}
