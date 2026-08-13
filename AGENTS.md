# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product decisions

- This repository ships a Manifest V3 Chrome extension for `x.com` and `twitter.com` plus a Vite-based visual demo.
- The core interaction keeps the X timeline in place and opens a modal reader: original post on the left, replies on the right.
- Do not intercept tweet clicks while the current X route is already a `/status/...` detail page; the native detail experience remains authoritative there.
- When a list or notification click targets a reply, the left pane must render its available ancestor chain from the conversation root to the immediate parent, followed by the clicked reply as the focal post. Preserve X-like vertical thread connectors and keep descendants in the right replies pane.
- When that reply thread first opens, scroll the left pane to the clicked focal reply while keeping its ancestors above and reachable by upward scrolling. This initial focus runs once only; subsequent interactions and rerenders must preserve the user's pane position.
- The original-post action bar must preserve X's native five-item order and density: reply, repost, like, bookmark, share. Do not insert analytics into that row.
- The reader uses X's currently loaded internal GraphQL operation definitions and the current signed-in browser session. A small MAIN-world bridge captures only the request metadata required to call X; credentials and CSRF values must never be persisted, logged, or sent outside X.
- The left pane renders the focal post; the right pane renders reply sorting, a pure-text reply composer, nested replies, and cursor-based loading. Each pane scrolls independently.
- Version 0.8 supports like/unlike, repost/unrepost, bookmark/unbookmark, share/copy link, pure-text replies, locally bundled HLS playback, and clicked-post DOM field fallback. Rich replies with media, GIFs, polls, drafts, or advanced mention completion remain in X's full composer.
- Extension UI icons are generated at build time from official Phosphor regular SVG assets and injected inline. Do not reintroduce a page-loaded icon font, remote icon CDN, mixed icon families, or hand-drawn replacement paths.
- Prefer X's HLS playlist through a locally bundled `hls.js` player with short adaptive buffers; fall back to a connection-aware progressive MP4 below the bitrate target. Keep `preload="none"` behavior for MP4 and coordinate a single playing video. Do not load a remote player script, default to X's highest MP4 bitrate, or preload every reply video.
- The delegated Content Script click listener may snapshot strings and media URLs from the clicked tweet to fill missing GraphQL author, avatar, timestamp, or media fields. GraphQL remains authoritative; never move, clone, retain, or mutate X's live React DOM nodes.
- Preserve X website-preview cards as rich attachments. For X Articles, use the dynamically discovered `TweetResultByRestId` operation to hydrate `article.content_state` and render the complete article inline in the focal left pane; preview-card rendering is only a fallback or compact nested treatment. Use the clicked tweet DOM only to fill missing title, preview image, description, or source domain, and suppress the redundant short URL from rendered post text.
- After a pure-text reply succeeds, pin that locally created reply above the currently loaded comment order and scroll the right pane to the top so the result is immediately visible.
- Video inside a quoted post must not be nested in the quote navigation anchor. Keep quote navigation on its own link and give every playable video an explicit central play control in addition to native controls.
- Opening the reader must not mutate `body` or `html` overflow because X's virtual timeline can reset its scroll position. Keep scroll containment inside the fixed overlay, record the page coordinates before opening, and restore them after closing.
- A single video, including video inside a quote, must use its real media aspect ratio and may grow vertically inside the independently scrollable pane. Do not clip it with the compact quote-media height cap.
- Do not use iframes, hidden tabs, copied live DOM, DNR response-header rewriting, a third-party backend, hard-coded GraphQL query IDs, or persisted X credentials.
- Discover X GraphQL `queryId`, feature switches, field toggles, and transaction-ID helpers from the currently loaded X Webpack runtime, with captured TweetDetail replay only as a read fallback.
- It requests only `storage` and X/Twitter host access. It must not request cookie, tabs, DNR, webRequest, or all-sites access.
- `Esc` closes the reader while X navigation, external links, and the full composer remain explicit user actions.
- The unpacked extension output is `dist-extension/`; the demo remains Sites-compatible and builds to `dist/client/`.
