# Design QA

- Source visual truth: `C:/Users/yi/AppData/Local/Temp/codex-clipboard-9a137c79-9022-49b4-bf9a-c05d8b3fece9.png`
- Implementation screenshot: `D:/GitHub/tuzai-x-popover/docs/preview.png`
- Focused source crop: `D:/GitHub/tuzai-x-popover/docs/qa-reference-focus.png`
- Focused implementation crop: `D:/GitHub/tuzai-x-popover/docs/qa-implementation-focus.png`
- State: light theme, popover open, replies loaded
- Source pixels: 2520 × 1584; source CSS viewport and device scale are unknown because the supplied image includes Chrome chrome.
- Implementation pixels / CSS viewport: 1265 × 712 at the in-app browser's default desktop density; screenshot pixels equal the observed viewport pixels.
- Density normalization: full views were judged structurally; focused source and implementation crops were both normalized to 1000 px width before typography and spacing review.

## Full-view comparison evidence

The supplied screenshot establishes the visual anatomy to preserve: X's white center surface, neutral borders, strong post hierarchy, readable author metadata, media/content space, and conversation context. The implementation keeps that anatomy but intentionally reorganizes it into the user-requested two-column modal: original post on the left and replies on the right. The background timeline remains visible but subdued, so closing the modal clearly returns to the original context.

No actionable P0/P1/P2 visual mismatch remains. The larger 20 px modal radius, compact toolbar, and two-column split are intentional product changes required by the brief rather than accidental drift from X's single-column detail page.

## Focused comparison evidence

The focused crops confirm that the implementation preserves the source's information hierarchy: author first, then post copy, followed by related content and engagement controls. The implementation uses a denser type scale so both post and replies remain readable in one desktop viewport. This is acceptable for the split-reader use case; live extension content retains X's own article markup and typography.

## Required fidelity surfaces

- Fonts and typography: system UI stack with `Segoe UI` and `Microsoft YaHei` fallbacks matches the source's sans-serif character. Weight and hierarchy are clear; no truncation or wrapping failure was observed.
- Spacing and layout rhythm: modal fills 92% of the desktop viewport, keeps consistent 20 px edge padding, aligns both pane headers, and gives each pane independent scrolling. Borders and radii are internally consistent.
- Colors and visual tokens: white surface, near-black text, muted gray metadata, light neutral borders, and X-like blue accent maintain the source balance. Dim and lights-out token sets are included in the extension stylesheet.
- Image quality and asset fidelity: the project uses a generated 1024 px rabbit/reader source icon and exports crisp 16/32/48/128 px icons. Live post media and avatars are cloned from the visible X content instead of being approximated with placeholder artwork.
- Copy and content: all plugin-owned copy is concise Chinese and distinguishes read-only preview, loading, empty, error, privacy, and keyboard-dismiss states.

## Interaction and browser checks

- Loaded, loading, empty, and error reply states render correctly.
- Close button, backdrop close, reopen, and `Escape` close work.
- Final verification values: `dialogAfterEsc=0`, `dialogAfterReopen=1`.
- Console warnings/errors after final interaction pass: none.
- Local preview URL tested: `http://127.0.0.1:55090/`.

## Comparison history

1. Initial pass found one P2 interaction mismatch: the visual demo showed “Esc 关闭” but did not yet dismiss on Escape.
2. Added a document-level Escape handler in `src/App.jsx`.
3. Reloaded the browser, verified the dialog count changed from 1 to 0 after Escape, reopened it, and captured `docs/preview.png` as post-fix evidence.

## Follow-up polish

- P3: after the unpacked extension is installed, capture one additional screenshot over a live X post to document how X's current article typography looks inside the left pane.

final result: passed
