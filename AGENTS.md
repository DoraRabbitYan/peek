# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Product decisions

- This repository ships a Manifest V3 Chrome extension for `x.com` and `twitter.com` plus a Vite-based visual demo.
- The core interaction keeps the X timeline in place and opens a modal reader: original post on the left, replies on the right.
- The original-post action bar must preserve X's native five-item order and density: reply, repost, like, bookmark, share. Do not insert analytics into that row.
- The modal contains two same-post X iframes inside one visual container. The left iframe shows the original post through its native five-action row; the right iframe starts with X's native reply controls and continues through the reply list. Each iframe scrolls independently.
- Do not clone X posts, extract replies, proxy actions through a hidden tab, or recreate X sorting/reply controls. The extension only isolates the relevant regions of X's own page.
- Hide `发现更多 / Discover more` and all recommendation cells after that boundary from the right reply pane.
- The iframe content script must only activate for frames created by the extension (`data-tuzai-pane=source|replies`) and must never open a nested兔仔浮层.
- It uses no third-party backend, requests only `storage` and X/Twitter host access, and must not request cookie, tabs, or all-sites access.
- Native X interactions remain inside their corresponding iframe. X reply dialogs and menus may open inside that pane; `Esc` closes native overlays first, then the outer reader.
- The unpacked extension output is `dist-extension/`; the demo remains Sites-compatible and builds to `dist/client/`.
