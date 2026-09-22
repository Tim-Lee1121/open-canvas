# Figma 浏览器插件安装与导出

Open Canvas 的 HTML 页面可生成一种独立实现的、best-effort 的 Figma-compatible 富文本载荷；部分 Figma Desktop 版本可能识别它并创建可编辑图层，但当前版本尚无真实 Desktop 双通道复验记录。该载荷不是 Figma 官方 SDK、公开标准或官方插件实现，Figma 不维护、审核或背书 Open Canvas。URL 页面仍使用 Figma 官方扩展的 `Capture page`。

## 安装方式

1. 打开官方 Chrome Web Store 安装页：[Figma 浏览器插件](https://chromewebstore.google.com/detail/figma/fkmaohpngenfoccdgceedjkfhkdcohmg)。
2. 在 Codex 内建浏览器中打开该安装页。可以在 Codex 项目对话中直接发送：

   ```text
   打开 https://chromewebstore.google.com/detail/figma/fkmaohpngenfoccdgceedjkfhkdcohmg，检查插件名称和发布者；如果浏览器支持安装，请进入安装确认页面，等待我确认权限。
   ```

3. 在浏览器的扩展安装确认界面检查权限后，由用户确认安装。Codex 可以调度浏览器导航和打开页面，但不能绕过浏览器的扩展权限确认。
4. 安装完成后刷新 Open Canvas，并在 Figma 中登录目标账号。

> 安装前请核对地址、插件名称和发布者信息。不要从其他来源安装声称可以访问 Figma 文件或读取网页内容的扩展。

## 从 Canvas 复制到 Figma

1. 在 Canvas 中打开目标 Board，确认页面预览和页面尺寸参考正确。
2. 在 HTML 页面卡片上方点击 `Export for Figma`。Canvas 会按当前设备尺寸（例如 375 × 980）渲染隐藏捕获文档，等待字体、图片和布局稳定后生成 Figma-compatible 富文本载荷；不会打开额外全屏预览。这样可以保持页面的响应式断点和实际画板尺寸一致。
3. 在 Figma 设计文件的空白画布上直接按 `Cmd/Ctrl+V`。支持的 Figma Desktop 版本可将 H2D 导入为可编辑图层；实际效果取决于版本、字体及页面样式。需要详细降级报告时，在 Figma 的 `Plugins > Development > Import plugin from manifest…` 选择 `figma-plugin/manifest.json`，运行 `Open Canvas Importer`。如果插件无法读取系统 HTML 剪贴板，在 Open Canvas 复制后，将界面显示的一次性配对码输入插件并点击 `Read paired export`，然后点击 `Import editable layers`。
4. URL 页面不会写入伪造的 URL 剪贴板。请在官方扩展中使用 `Capture page` 或 `Capture element`，它需要一个可访问的顶层页面作为捕获源。

Canvas 的复制入口不会自动打开页面预览。普通浏览器优先通过同一个 `ClipboardItem` 写入 H2D `text/html` 和空的 `text/plain` 伴随类型。macOS 本地开发服务器可写入系统 HTML 剪贴板，并为增强 scene 数据生成五分钟有效、仅可读取一次的配对码；插件无法匿名读取上次导出。`text/plain` 不是独立成功路径。系统桥接不可用时才尝试浏览器富文本写入及 HTML 选择区 fallback。交互脚本、跨域 iframe、不可获取的图片和缺失字体会产生降级诊断。

Figma-compatible 粘贴是像素忠实度优先的 best-effort 通道。仓库中的 `figma-plugin/` 是共享 scene model 的增强导入通道：它仅通过 Figma Plugin API 创建可编辑节点，并尽量保留 Fill、Hug、Fixed、gap 和 padding。如果 Figma 的字体或 Auto Layout 回流会让节点明显偏离捕获几何，插件会将该约束保留为 Fixed 并在导入报告中明确列出，不会静默伪装为精确转换。两条通道都不改变 Canvas 的 Board 数据，也不会替代 Codex 的页面生成和迭代流程。

## 推荐协作提示词

```text
打开当前 Open Canvas 页面，点击 HTML 页面工具栏的 `Export for Figma`，尝试将 Figma-compatible 富文本粘贴到指定 Figma 文件和画板；如果是 URL 页面，则改用 Figma 官方扩展的 `Capture page` 或 `Capture element` 流程。完成后告诉我目标文件、画板名称以及复制结果。
```

如果插件需要用户选择文件、画板或授权，Codex 应停在对应确认界面，由用户完成选择后再继续。
