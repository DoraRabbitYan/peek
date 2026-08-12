# 兔仔 · X 帖子浮层阅读器

一个本地优先的 Chrome 扩展：在 X 时间线点击帖子正文时，不离开主页，直接打开一个左右双栏浮层。

![浮层交互预览](docs/preview-double-iframe.png)

## 工作方式

浮层内部同时加载两个相同帖子详情页：

- 左侧 iframe 只显示原帖正文、媒体、时间、查看量和原生五项互动栏。
- 右侧 iframe 从 X 原生的评论排序和回复框开始，显示真实评论与子讨论。
- 两栏各自滚动，关闭浮层后仍停留在原来的时间线位置。

插件不再复制帖子 DOM、不提取评论，也不通过隐藏标签页代理账号操作。点赞、回复、转帖、收藏、分享、视频、排序和菜单都由 X 自己的页面运行。

## 现在能做什么

- 拦截时间线里的帖子正文点击并打开一个双栏浮层。
- 左侧保留原帖红线以上的 X 原生内容与互动。
- 右侧保留红线以下的排序、回复框和评论列表。
- 自动隐藏“发现更多 / Discover more”及其后的推荐帖子。
- X 的回复弹窗和菜单在对应栏内正常打开，不会再套一层兔仔浮层。
- 支持浅色、暗色和熄灯主题。
- `Esc`、遮罩或右上角按钮都可以关闭浮层。
- 插件工具栏里可以随时开启或关闭。

## 隐私与权限

扩展只申请：

- `storage`：保存开启/关闭状态。
- `x.com` / `twitter.com`：在 X 页面注入浮层，并在扩展创建的两个 X iframe 内裁出所需区域。

扩展不申请 Cookie、标签页或全站权限，不访问其他网站，也没有第三方数据服务。两个 iframe 直接复用浏览器当前登录的 X 会话。

## 本地开发

最低要求：Node.js 20+、npm 10+、Chrome 或其他 Chromium 浏览器。

Windows PowerShell：

```powershell
npm install
npm run test
npm run build
```

macOS / Linux / Git Bash：

```bash
npm install
npm run test
npm run build
```

开发预览：

```bash
npm run dev
```

## 加载到 Chrome

1. 执行 `npm run build:extension`。
2. 打开 `chrome://extensions/`。
3. 开启右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”。
5. 选择仓库里的 `dist-extension/`。
6. 首次加载或重新构建后，刷新已经打开的 X 标签页。

## 当前边界

- 两个 iframe 会各自运行一个 X 页面，因此运行内存高于单页面方案，但扩展代码和功能兼容面更小。
- 左右栏的互动数字可能不会瞬间同步；X 自身重新渲染或刷新后会恢复一致。
- X 当前允许同源的 X 页面嵌入。若 X 将来改变 iframe 策略或页面 DOM，嵌入与裁切规则需要跟随调整。
- X 原生回复弹窗被限制在触发它的半栏内，不会跨越整个兔仔浮层。

## 项目结构

```text
extension/       Chrome 扩展源码
src/             可交互的视觉演示
scripts/         构建脚本
tests/           核心逻辑与预览 Worker 测试
dist-extension/  构建后的可加载扩展（不入 Git）
```
