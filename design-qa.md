# Design QA

- Layout source: the previously selected near-full-screen two-column mock, normalized in `docs/qa-layout-reference-normalized.png`
- Current collapsed implementation: `docs/qa-composer-collapsed.png`
- Current focused implementation: `docs/qa-composer-focused.png`
- Current multiline implementation: `docs/qa-composer-multiline.png`
- Current X native profile-card reference: `docs/reference-x-profile-card-live.jpg`
- Current profile-card implementation: `docs/qa-profile-card-x-fidelity.jpg`
- Profile-card comparison: `docs/qa-profile-card-comparison.jpg` (native X on the left, plugin on the right)
- Action-hover correction source: the normalized before-state crop on the left side of `docs/qa-action-hover-count-comparison.jpg`
- Action-hover implementation: `docs/qa-action-hover-with-count.jpg` (1245 x 608 px at a 1245 x 608 CSS viewport)
- Focused action-hover comparison: `docs/qa-action-hover-count-comparison.jpg`; the source region was normalized from the approximately 2x-density capture before comparison
- Browser viewport: 1242 x 663 CSS px, desktop light theme
- State: overlay open, default relevant sorting, pure-text reply composer, `14 条回复` beside sorting, and `查看引用` at the far right

## Current X interaction reference

The current signed-in X detail page was inspected before implementation. Its empty reply entry uses a 52 px editor row with a 28 px single-line text surface. In the collapsed state, X exposes the avatar, placeholder and disabled reply action; after focus or when a draft exists, it reveals the reply context and supporting controls and lets the text surface grow with additional lines. The plugin follows that two-state behavior but intentionally keeps only the requested pure-text controls rather than reproducing X's media/GIF/emoji toolbar.

The current signed-in X home page was also inspected with its native author hover card open. The native card measures 300 px wide with 16 px internal padding, a 64 px avatar, a 36 px pill follow control, a 16 px corner radius, X's two-layer hover-card shadow, linked identity/stats, optional relationship context, and the profile-summary entry. Moving the pointer from an author trigger into the card keeps it mounted; after leaving both surfaces, X keeps a short grace period before dismissal.

## Verified implementation

- Global toolbar: reduced from 72 px to 56 px on desktop and 54 px on narrow mobile layouts. It contains only the rabbit icon, exact title `兔崽插件`, open-in-X, and close controls.
- Collapsed composer: measured at 58 px after the transition settles. Reply-target text is hidden; the avatar, single-line placeholder, and reply button remain.
- Focused composer: measured at 92 px. Reply-target text appears without adding a character counter or media controls.
- Multiline composer: four lines increased the component to 164 px and the textarea to 100 px.
- Height cap: the textarea stops at 168 px and switches to its own vertical scrolling, preventing the composer from consuming the reply pane.
- Empty blur behavior: after clearing the text and moving focus outside, the composer returned to 58 px and hid the target row.
- Pane structure: no pane headings, explanatory subtitles, independent-scroll pills, or bottom status/footer bar are present. Both content panes remain independently scrollable.
- Article typography: full article paragraphs use the same 15 px / 20 px reading density as ordinary post content; article headings retain only a small hierarchy instead of the previous oversized presentation.
- Reply pagination: the manual `加载更多评论` action is gone. A one-pixel sentinel requests the next GraphQL page when it approaches the bottom of the reply pane, and the existing reading position is restored after rendering the appended page. If a response contributes zero new reply IDs, repeats the cursor, or omits a next cursor, pagination becomes terminal and the sentinel is removed instead of showing another loading state.
- Action hover: the interactive highlight is now a compact 40 px-high rounded surface that encloses both the icon and its visible count. It grows only to the content width, so `喜欢 84` is one complete hover pill without highlighting the full five-column grid cell. Compact reply actions use the same anatomy at 36 px high.
- Author hover: avatar, nickname, and handle open one shared 300 px account card populated from the available X GraphQL author data. Its live measurements match the current X anatomy: 16 px padding, 64 px avatar, 36 px follow control, 17 px display name, linked avatar/name/handle/stats, bio, relationship context when present, and profile summary. Follow/unfollow is wired to the current X session. The card reuses its DOM while moving between the same author's triggers, opens after 350 ms, and waits 650 ms before dismissal, which removes the previous 140 ms gap-crossing flicker.

## Fidelity and product constraints

- The reply composer is pure text only in this version. Rich media, GIF, poll, draft, and advanced mention composition remain delegated to X's full composer.
- Post and ancestor copy stays at the previously approved X list-page density of 15 px / 20 px.
- Existing X-like foreground, muted, border, surface, and overlay tokens are unchanged.
- `查看引用` remains the far-right reply-tool action and the reply count remains plain text beside sorting.

## Checks

- [x] Collapsed reply entry is one narrow row.
- [x] Focus expands the composer.
- [x] Multiple lines grow the textarea and composer.
- [x] Growth is capped and becomes internally scrollable.
- [x] Clearing and blurring collapses the composer.
- [x] The reply flow remains pure text.
- [x] Article body typography matches ordinary post density.
- [x] Replies continue loading when the reader approaches the bottom without a manual button.
- [x] Loading another reply page preserves the current reading position.
- [x] Action hover encloses the icon and number inside one compact pill without filling the full grid cell.
- [x] Avatar, nickname, and handle expose the author profile card.
- [x] The card remains visible after moving from a trigger into the card and waiting longer than the dismissal delay.
- [x] The local follow control changes state and follower count; the real X mutation path is wired but was not executed during QA to avoid changing the signed-in account.
- [x] A terminal reply page removes the cursor and loading sentinel.
- [x] Browser console contains no errors.
- [x] `npm test` passes all 22 tests and rebuilds `dist-extension`.

No actionable P0, P1, or P2 issue remains for this iteration.

## Latest comparison history

- Earlier finding: the hover background was a 34 px circle behind only the icon, leaving the count outside and making the hit state look undersized.
- Fix: introduced a content-sized action surface, increased the main action height to 40 px, placed the icon and count inside it, and retained action-specific blue, pink, and green hover colors.
- Post-fix evidence: the browser-measured like surface is 40 px high, expands with its count, and the count's full bounding box remains inside the rounded hover surface. `docs/qa-action-hover-count-comparison.jpg` shows the before state on the left and the corrected state on the right.

final result: passed
# v0.8.8 关注修复验收（2026-09-16）

- 在时间线打开浮层，聚焦作者资料卡；点击关注不得再报 GraphQL 操作未加载。
- 关注、取消关注以 X 返回的状态为准，同一作者的帖子/回复/引用同步更新；失败时保持原状态，按钮恢复可用。
- 私密账号待批准显示“已请求”，粉丝数不提前增加；在 X 个人资料页管理待批准请求。
- 自动化验证：`npm test`，包含 `tests/follow.test.mjs`。真实账号关系变更的验收结果应与模拟请求测试区分。
- 当日已在 Chrome 真实 X 浮层复现旧版提示“当前 X 页面尚未加载 CreateFriendship 操作，请刷新页面后重试”。核对页面实际加载的公开脚本 `https://abs.twimg.com/responsive-web/client-web/main.710ddeaeedc4aefda.js`，其中 `follow` / `unfollow` 分别调用 `friendships/create` / `friendships/destroy` 并传入 `user_id`。
- Windows / Node 环境构建和测试通过；Vite 本地预览已打开。修复版真实会话验收待重新加载扩展后进行：自动化浏览器禁止访问 `chrome://extensions/`，因此扩展重新加载需要用户操作。
