# Design QA — 双 iframe 帖子浮层

- Source visual truth: `C:/Users/yi/AppData/Local/Temp/codex-clipboard-5954910a-33f3-4b63-bdc5-10798a640cd6.png`
- Implementation screenshot: `D:/GitHub/tuzai-x-popover/docs/preview-double-iframe.png`
- Combined comparison: `C:/Users/yi/AppData/Local/Temp/tuzai-double-iframe-comparison.png`
- Browser viewport: 1265 × 712 CSS px
- Source pixels: 1234 × 1168, density 1
- Implementation pixels: 1265 × 712, density 1
- Normalization: the source was cropped to the red-line boundary region and both images were scaled into a 1280 × 390 side-by-side comparison canvas. The source is a single-column boundary reference; the implementation intentionally renders the two resulting regions side by side.
- State: light theme, reader open, default relevant reply order.

## Findings

No actionable P0, P1, or P2 visual differences remain for the agreed split behavior.

- The left pane ends with the original post's five-item action row, matching the content above the red line.
- The right pane starts with `相关 / 查看引用`, followed by the reply composer and replies, matching the content below the red line.
- The modal remains one visual surface with a single toolbar, central divider, consistent borders, and two independent scroll regions.
- The `查看引用` wording now follows the current X page instead of the previous incorrect `查看动态` mock label.

## Required fidelity surfaces

- Fonts and typography: system/X-like sans-serif stack, weights, muted metadata, and reply hierarchy remain consistent with the supplied X reference. No text clipping was observed.
- Spacing and layout rhythm: the red-line boundary maps directly to the center-column split; pane headers, action density, separators, and composer spacing are aligned.
- Colors and visual tokens: white surface, X foreground/muted colors, blue interaction token, subtle borders, and disabled reply state match the reference family.
- Image quality and asset fidelity: the supplied兔仔 icon and avatar assets remain raster assets; the implementation does not introduce placeholder imagery or custom-drawn icons.
- Copy and content: `原帖`, `评论`, `相关`, `查看引用`, reply composer text, and the native-page status copy reflect the agreed behavior.

## Interaction evidence

- Reply sort menu opened and closed with `Escape`.
- Closing the reader removed the dialog; reopening restored it.
- Left- and right-pane scroll areas accepted independent scrolling without moving the outer page.
- Browser console warnings/errors checked: none.
- Build and automated tests: 9/9 passed.

## Comparison history

### Iteration 1

- Earlier P1: the previous architecture cloned X DOM and proxied interactions through a hidden tab.
- Fix: replaced extraction and action proxy code with two same-post X iframes inside one modal.
- Earlier P1: the preview displayed `查看动态`, while the current X page uses `查看引用` for this context.
- Fix: changed the visible preview label and delegated production wording/functionality to X's native DOM.
- Post-fix evidence: `docs/preview-double-iframe.png` and the combined comparison above.

## Residual runtime validation

The visual implementation passes. Loading the unpacked extension into the user's Chrome and exercising the live X iframe DOM still requires the browser's extension-install confirmation; this is a runtime integration check rather than an unresolved visual mismatch.

## Follow-up polish

- P3: after live installation, tune X DOM isolation selectors if the user's current account receives a different experiment layout.

final result: passed
