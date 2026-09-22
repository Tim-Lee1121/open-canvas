# Open Canvas 分发版只读策略

此规则仅约束随分发包提供的 Codex 页面生成自动化任务。自动化执行页面请求时，不修改以下宿主文件：

- `src/` 下的 React、CSS、标注和画板逻辑
- `scripts/` 下的 CLI、状态同步和校验逻辑
- 根目录的 `package.json`、Vite、TypeScript、测试和其他项目配置
- `data/board-state.json` 的结构、schema 和宿主行为

页面生成任务即使提及 Open Canvas 控件，也不能把页面样式请求解释为修改宿主的授权。宿主维护应在明确的源码维护任务中进行。

页面生成和页面设计迭代仍然允许执行，但只能修改 `generated-pages/` 中的页面源文件与其 `assets/icons/*.svg` 资产，并通过 `$ai-page-board` 和 Board CLI 发布。页面的 Board 归属、标题、内容和布局可以按用户请求管理，但不能借此修改宿主工作台。

本文件不是法律上的修改限制，也不是操作系统级权限。任何人都可按照仓库的 Apache-2.0 许可证使用、修改、fork 和再分发宿主源码；贡献者可在源码维护任务中修改宿主。
