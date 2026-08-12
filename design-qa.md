# Design QA

- Source visual truth: `C:/Users/yi/AppData/Local/Temp/codex-clipboard-b7a3db9e-6771-4ec8-b378-1968a2eb9e23.png`
- Implementation screenshot: `D:/GitHub/tuzai-x-popover/docs/preview.png`
- State: light theme, popover open, replies loaded, native-equivalent action row and reply composer visible
- Source pixels: 1256 × 842 at unknown CSS density
- Implementation pixels / observed CSS viewport: 1265 × 712 at the in-app browser's default desktop density
- Density normalization: both captures were inspected together at their native near-equal widths. The supplied source is already a focused crop of the X action/composer area, so an additional crop was not needed.

## Findings

No actionable P0/P1/P2 visual or interaction mismatch remains for the requested feature set.

The source establishes the required interaction anatomy: reply, repost, like, view/analytics, bookmark, share, related ordering, quote activity, reply composer, and per-reply action rows. The implementation visibly preserves those surfaces while adapting them to the intentional two-column reader.

## Full-view comparison evidence

- The left pane keeps the original post and X-like action hierarchy, then shows `相关`, `查看动态`, and the reply composer in the same order as the source.
- The right pane keeps per-reply reply, like, view/analytics, and share controls instead of reducing replies to plain text.
- The two-column split is an intentional product change required by the original brief, not a fidelity regression. Independent scrolling preserves the source's dense conversation-reading behavior.

## Focused comparison evidence

The source image itself is a focused 1256 px-wide crop of the interaction region. At the implementation's comparable 1265 px width, all corresponding controls and labels remain legible. The action row, `相关` / `查看动态` row, disabled-empty reply button, and reply cards were directly readable in the combined image inspection, so no additional crop was necessary.

## Required fidelity surfaces

- Fonts and typography: system UI fonts, X-like muted metadata, strong author names, and compact action counts preserve the source hierarchy. No wrapping or truncation failure was observed.
- Spacing and layout rhythm: the action row, context row, composer, and comment separators align consistently. The left pane uses slightly denser spacing than the source so the controls fit beside the comment pane; this is acceptable for the split-reader layout.
- Colors and visual tokens: white surface, near-black copy, muted gray metadata, neutral borders, and blue interactive state remain consistent with X light mode.
- Image quality and assets: the extension keeps real X avatars/media in live cloned articles and uses the generated rabbit icon only for plugin branding. Standard controls use the bundled Phosphor icon library.
- Copy and content: `可直接互动` replaces the misleading former `只读预览`; the footer now states that content is processed locally while interactions sync to the current X account.

## Interaction and browser checks

- Original-post like, repost, and bookmark controls toggled counts from `128/16/31` to `129/17/32` in the demo.
- Clicking a reply's reply button changed the composer target to `回复若水`.
- Publishing a reply increased the visible reply count from 3 to 4 and inserted the new reply at the top.
- Reply likes, share feedback, the more-actions feedback, and analytics feedback were verified.
- `Escape` changed the dialog count from 1 to 0; reopening changed it back to 1.
- Loading, empty, error, and ready states remain available through the demo state selector.
- Fresh-tab browser console warnings/errors: none.
- Local preview URL tested: `http://127.0.0.1:55090/`.

## Comparison history

1. P1 from the previous version: cloned X controls were disabled and the header explicitly said `只读预览`. Fixed by keeping the inactive X detail tab alive as an interaction proxy, enabling action buttons, adding a real reply composer, and changing the header to `可直接互动`.
2. P2 in the first interactive demo pass: reply like counts rendered as `NaN`. Fixed by normalizing the optional liked state to a boolean before calculating the count.
3. P2 in the second pass: overlapping toast timers could clear newer feedback. Fixed by storing and cancelling the previous timer before showing a new toast.
4. Post-fix evidence: all requested controls are visible, the browser interaction sequence passes, and a fresh-tab console check is clean.

## Residual test gap

The unpacked extension has not been installed into the user's Chrome, so no real X account write was executed during QA. Current X DOM selectors for reply, repost, like, bookmark, share, analytics, quote activity, and the inline reply editor were inspected against the user's signed-in X page, and the proxy code is covered by syntax/build/unit checks. Installing the extension remains a separate confirmation-gated step.

final result: passed
