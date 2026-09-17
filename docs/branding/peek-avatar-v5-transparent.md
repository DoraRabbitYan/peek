# Peek 头像 V5 · 外围透明

日期：2026-09-16

- 用户要求去掉兔子外面一圈洋红色，同时修改插件名称。
- 工具：内置 image_gen；以已选定洋红 V1 为输入，只将兔子和窗口组合轮廓之外的底色改为透明，保留窗口内洋红。
- 原图：`peek-avatar-v5-transparent.png`，1254×1254 PNG，含真实 alpha 通道；四角 alpha=0，兔子和内部洋红保留。
- 运行时源图：`../../public/assets/tuzai-icon-source.png`；旧版本保留。

## 最终编辑提示词

Perform a precise background-extraction edit on this rabbit app icon. Remove ONLY the magenta background that is OUTSIDE the dark rounded-rectangle window frame and outside the rabbit silhouette, replacing this exterior area with actual transparent alpha. The result must be a genuinely transparent PNG cutout, not a white/black background and not a painted checkerboard. Preserve the magenta fill INSIDE the dark window exactly: all the areas behind the rabbit enclosed by the dark window must stay opaque magenta. Preserve the complete dark frame, the two ears protruding above it, the ivory rabbit head and paws, eye highlights, tiny nose, head tilt, all original proportions and positions, and the existing gentle texture. Keep the original square canvas framing and scale. Think of cutting out the combined silhouette of rabbit ears + framed window: everything around that combined silhouette is alpha 0, while everything belonging to the rabbit, frame and enclosed magenta window remains opaque. Keep edges smooth and clean with antialiasing; absolutely no magenta fringe outside the silhouette, no halo, no glow, no drop shadow. Do not redraw the character, recolor the inner magenta, crop the ears or add text. One finished transparent PNG icon.
