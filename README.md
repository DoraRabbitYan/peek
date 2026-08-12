# 兔仔 · X 帖子浮层阅读器

一个本地优先的 Chrome 扩展：在 X 时间线点击帖子正文时，不离开主页，直接用双栏浮层阅读原帖和评论。

![浮层交互预览](docs/preview.png)

## 现在能做什么

- 拦截时间线里的帖子正文点击，保留主页滚动位置。
- 左侧展示点击的原帖，右侧展示当前账号可见的评论。
- 支持浅色、暗色和熄灯主题。
- `Esc`、遮罩或右上角按钮都可以关闭浮层。
- 插件工具栏里可以随时开启或关闭。
- 评论加载失败、暂无评论和加载中都有明确状态。

## 隐私与权限

扩展只申请：

- `storage`：保存开启/关闭状态。
- `tabs`：在后台临时打开帖子详情页，读取完成后自动关闭。
- `x.com` / `twitter.com`：只在 X 页面注入浮层。

扩展不申请 Cookie 权限，不访问其他网站，也没有第三方数据服务。评论读取使用当前已登录的 X 页面；帖子内容只在浏览器本地处理。

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
6. 首次加载后刷新已经打开的 X 标签页。

## 当前边界

- 评论是只读预览；点赞、回复、转发仍然需要进入 X 原页面完成。
- 为避免依赖经常变化的 X 内部接口，读取评论时会短暂创建一个不激活的后台标签页，完成后自动关闭。
- X 页面结构更新后，帖子选择器可能需要跟随调整。

## 项目结构

```text
extension/       Chrome 扩展源码
src/             可交互的视觉演示
scripts/         构建脚本
tests/           核心逻辑与预览 Worker 测试
dist-extension/  构建后的可加载扩展（不入 Git）
```
