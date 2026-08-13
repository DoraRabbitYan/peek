# Design QA

- Source visual truth: `C:/Users/yi/AppData/Local/Temp/codex-clipboard-54688d7c-1711-455b-a161-7480b3c01348.png`
- Implementation screenshot: unavailable until the unpacked extension is reloaded in Chrome
- Viewport: source 2048 x 1152 px; implementation target is the same desktop X overlay state
- State: X Article opened from a timeline plus its right-side reply list

## Full-view comparison evidence

The source clearly shows the current defect: the left pane stops at an Article preview card rather than continuing into the Article body, and the right pane has no locally-created reply pinned at the beginning of the list. The implementation now changes both data and rendering paths, but the live extension cannot reflect those files until Chrome reloads the unpacked extension and refreshes X.

## Focused region comparison evidence

- Left pane: the source has cover, title and preview inside one bordered card. The new renderer uses the same cover asset, then renders the hydrated Article title and complete rich-text blocks as normal reading content.
- Right pane: the new-reply path records the created tweet ID, sorts those local replies before the server order, and resets the reply pane to scroll position 0 after successful publication.

## Required fidelity surfaces

- Fonts and typography: article hierarchy uses the existing extension/system typography and explicit heading/body sizes; live browser verification is pending.
- Spacing and layout rhythm: article content remains inside the existing independently scrollable left pane; live long-article rhythm and overflow need verification.
- Colors and visual tokens: only existing extension color tokens are used.
- Image quality and asset fidelity: the X-provided Article cover and inline images are reused directly; no placeholder or generated asset is introduced.
- Copy and content: the implementation requests `article.content_state` and renders every returned text block rather than repeating the preview description.

## Findings

- [P1] Live visual comparison is blocked until the unpacked extension is reloaded.
  - Location: Chrome X timeline overlay.
  - Evidence: Chrome is still running the previously loaded extension code; extension content scripts do not hot-reload from disk.
  - Impact: the complete Article body and pinned reply cannot yet be captured in their final browser state.
  - Fix: reload the unpacked extension, refresh X, open the same Article post, and capture the overlay at the same viewport.

## Comparison history

- Initial source finding: Article content appeared only as a preview card; a newly-published reply was appended below the loaded list.
- Fixes made: added dynamic `TweetResultByRestId` hydration, complete rich-text Article rendering, local reply pinning, and automatic top scroll.
- Post-fix visual evidence: pending extension reload.

## Implementation checklist

- Reload `dist-extension/` in Chrome.
- Refresh the X tab and open the same Article post from a list page.
- Confirm the full body is present and independently scrollable.
- Publish one pure-text reply and confirm it appears at the top without manual scrolling.
- Capture the implementation and rerun visual comparison.

final result: blocked
