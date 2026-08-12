# Design QA

- Source visual truth 1: `C:/Users/yi/AppData/Local/Temp/codex-clipboard-e9d5980e-e913-4636-a2c6-bbf40760d530.png`
- Source visual truth 2: `C:/Users/yi/AppData/Local/Temp/codex-clipboard-7d869374-3ae4-4c08-bbe7-ebef608974b8.png`
- Full implementation screenshot: `D:/GitHub/tuzai-x-popover/docs/preview.png`
- Focused action comparison: `D:/GitHub/tuzai-x-popover/docs/qa-action-bar-normalized-verified.png`
- Focused right-tools comparison: `D:/GitHub/tuzai-x-popover/docs/qa-right-reply-tools-normalized-verified.png`
- State: light theme, desktop two-column popover open, replies loaded
- Source pixels: 1182 × 94 and 1196 × 266
- Implementation viewport: 1265 × 712

## Findings

No actionable P0/P1/P2 mismatch remains for the two requested regions.

The original-post action bar now has exactly five controls in the source order: reply, repost, like, bookmark, share. The proportional icon positions match the reference, only reply and like show their initial counts, and the share control uses the same upward-arrow anatomy.

`相关`, `查看动态`, and the reply composer now live at the top of the right comment pane. The source avatar crop is used, the helper target label is visually hidden, and the disabled reply button, left/right insets, row heights, separators, and muted colors follow the supplied crop.

## Focused comparison evidence

- Both source crops and both implementation crops were inspected together in the same comparison input.
- The action bar preserves the five-item spacing ratios across a responsive pane rather than inserting an analytics control.
- The right-tools block preserves the source hierarchy: context row, divider, avatar/placeholder/button composer, divider.
- DOM placement audit: left context/composer count `0`; right context/composer count `1` each.

## Interaction and browser checks

- Original action count text changed from `2 / 1` to `2 / 1 / 2` after activating repost and like; repost, like, and bookmark active states all became true.
- Clicking the original reply action focused the composer in the right pane.
- Clicking `回复 若水` changed the placeholder to `发布你对若水的回复`.
- Publishing a reply increased the visible reply count from `3` to `4` and inserted the new reply at the top.
- Share produced `帖子链接已复制`.
- `Escape` reduced the dialog count from `1` to `0`; `重新打开浮层` restored it to `1`.
- Fresh-tab browser console warnings/errors: none.
- Local preview tested: `http://127.0.0.1:55090/`.
- Automated checks: 10/10 tests passed; extension content script syntax check and `git diff --check` passed.

## Comparison history

1. P1: the previous preview placed `相关`, `查看动态`, and the composer under the left original post. Fixed by moving the complete block to `.tuzai-reply-tools` above the right reply list.
2. P1: the previous original-post bar used the wrong item set and spacing. Fixed with the exact five controls and source-measured proportional insets.
3. P2: the first focused QA crop used incorrect screenshot coordinates. Fixed by reading the live component bounds and cropping the verified full screenshot.
4. Post-fix evidence: combined source/implementation comparison passes, all requested interactions pass, and a fresh-tab console check is clean.

## Residual test gap

The unpacked extension has not been installed into the user's Chrome, so no real X account write was executed during QA. Installing the extension remains a separate confirmation-gated step.

final result: passed
