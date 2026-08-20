# 参与贡献

感谢你帮助完善兔崽 X 帖子浮层阅读器。Bug 修复、兼容性改进、测试、文档和交互建议都欢迎提交。

## 开始之前

- 搜索现有 Issue，确认问题还没有被报告。
- 较大的功能或架构调整请先创建 Issue 讨论，避免重复开发。
- 不要在 Issue、日志、截图或测试数据中提交 X Cookie、授权请求头、CSRF 值或其他账号凭据。
- 测试截图尽量使用自己的帖子或模拟数据，并遮挡无关的个人信息。

## 本地开发

最低要求：Node.js 20+、npm 10+、Chrome 或其他 Chromium 浏览器。

```bash
npm install
npm run test
npm run build:extension
```

构建后的扩展位于 `dist-extension/`。在 `chrome://extensions/` 开启开发者模式后，选择“加载已解压的扩展程序”并加载该目录。

## 提交 Pull Request

1. Fork 仓库并从最新的 `main` 创建分支。
2. 只提交与当前问题相关的修改，不要提交 `node_modules/`、`dist/` 或 `dist-extension/`。
3. 新增或修改核心行为时，请同步补充测试。
4. 提交前运行 `npm test`。
5. 在 PR 中说明修改内容、测试方式，以及是否涉及 X 权限、会话、GraphQL、媒体播放或页面滚动。

X 的页面结构和内部请求可能随时变化。修复兼容性问题时，请优先使用动态发现和渐进降级，不要提交硬编码的 GraphQL `queryId`，也不要增加远程脚本、第三方后端或不必要的网站权限。
