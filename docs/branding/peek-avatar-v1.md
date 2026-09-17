# Peek 头像概念 V1

日期：2026-09-16

- 工具：内置 image_gen（初稿生成后进行一次定向编辑）。
- 文件：`peek-avatar-v1.png`。
- 概念：洋红背景、奶白兔子从圆角窗口里探头，无文字。
- 状态：用户于 2026-09-16 选定此版洋红色后，进一步要求去除外围底色；当前运行时使用 `peek-avatar-v5-transparent.png`，本文件作为带背景的原始版本保留。插件名称已按此前推荐改为 Peek，真实 Chrome 工具栏验收待进行。
- 验证：预览构建通过；扩展构建和 28 项测试使用 Codex 内置 Node v24.19.0 通过。系统 Node v24.14.0 在同一扩展构建脚本异常退出，后续本机构建优先使用内置 Node；未修改构建脚本或依赖。

## 初稿提示词

Use case: logo-brand. Create one polished original square avatar / app icon concept for Peek, a lightweight X post reader that opens a floating reading window. Produce a single 1024x1024 finished illustration, not a mockup or a presentation board. No text at all. Concept: a curious warm-ivory little rabbit peeking out of a small rounded browser-window frame. Its two long rounded ears rise above and interrupt the top edge of the window; its round head and two very simple small paws rest at the lower window sill. Give the rabbit a distinctive slightly tilted head, attentive dark dot eyes and a tiny understated nose, friendly and clever rather than babyish. Use bold clean flat vector-like shapes with soft precise curves, strong silhouette and generous intentional negative space. The face must remain clear and rabbit ears immediately recognizable at tiny toolbar sizes. Solid full-bleed vivid magenta background approximately #D92D73, warm ivory rabbit #FFF4E3, very dark plum #29212C for the minimal window outline and facial details. Keep the window construction minimal: one substantial rounded rectangular outline, no browser dots, text lines, menus or complicated UI. Center the compact emblem, occupy roughly 76-82% of the canvas, leave safe margin for circular avatar cropping. Sophisticated playful independent software brand, beautifully balanced custom mascot identity. No lettering, no X/Twitter logo, no watermark, no gradients, no 3D, no fur texture, no shadows, no decorative stars, no multiple variants.

## 最终定向编辑提示词

Edit this avatar image, keeping the same rabbit identity, curious tilted head, two ears, little paws and rounded-window concept. Produce one finished square 1024x1024 avatar. Make the ENTIRE square canvas a completely opaque, uniform, solid magenta #D92D73 background right to all four edges and corners; no transparent background anywhere, no black outer background. Simplify the art into truly flat solid-color vector-like illustration: ivory #FFF4E3 rabbit, dark plum #29212C eyes and thick window frame. Remove ALL blurred halos around the ears, shadows, edge glow, lighting, gradients, soft focus, shading, paper texture and 3D effects. Every boundary must be sharp, smooth, opaque and clean. The rabbit and window should sit comfortably within the central 76 percent of the canvas with clean magenta breathing room. The ears still rise above the top of the window; keep this overlap clean without any haze. The paws rest on the bottom frame. Simplify each paw to a plain oval without finger lines and use very simple dark oval eyes. Friendly curious expressive face, a slight head tilt, sophisticated playful software mascot. No lettering, no text, no other objects, no mockup, no presentation board.
