# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product decisions

- This repository ships a Manifest V3 Chrome extension for `x.com` and `twitter.com` plus a Vite-based visual demo.
- The core interaction keeps the X timeline in place and opens a modal reader: original post on the left, replies on the right.
- The original-post action bar must preserve X's native five-item order and density: reply, repost, like, bookmark, share. Do not insert analytics into that row.
- The conversation controls shown below an X detail post (`相关`, `查看动态`, and the reply composer) belong at the top of the right replies pane, above the reply list.
- The `相关` control is a functional reply-sort dropdown, not decorative UI. It must support relevant, recent, and most-liked ordering, prefer X's native sorter, and locally normalize the extracted recent/liked order.
- The extension preserves native post interactions inside the popover. Reply, repost, like, bookmark, share, analytics, and quote-activity entry points must not be reduced to decorative or permanently disabled controls.
- It uses no third-party backend, requests only `storage`, `tabs`, and X/Twitter host access, and must not request cookie or all-sites access.
- Reply extraction and account actions use a temporary inactive X tab so the extension can reuse the user's normal signed-in page without depending on private GraphQL operation IDs. Keep that proxy tab only while the popover is open, and close it on cancel/close.
- The unpacked extension output is `dist-extension/`; the demo remains Sites-compatible and builds to `dist/client/`.
