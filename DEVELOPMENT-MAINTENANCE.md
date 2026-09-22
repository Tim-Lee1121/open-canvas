# Open Canvas 开发维护版本说明

本目录是 Open Canvas 的开发/维护主版本，用于维护宿主画板本身以及生成页面工作流。

## 版本角色

- 本目录：开发/维护版本。维护者和贡献者可以维护 `src/`、`scripts/`、根配置、测试和宿主状态逻辑。
- 分发包：可复用的只读版本。分发包中的 Codex 任务只能修改 `generated-pages/` 及其图标资产，不能修改宿主画板。

## 打包边界

分发包中的页面生成自动化仍需遵守 [`DISTRIBUTION-READONLY.md`](DISTRIBUTION-READONLY.md)；这一工作流边界不限制 Apache-2.0 许可证授予的源码修改与分发权利。

宿主画板功能（例如缩放、画布定位、背景网格、自动吸附、参考线、侧栏和 Canvas 工具栏）应在本开发/维护版本中实现和验证；生成页面的样式和交互则继续写入 `generated-pages/` 并通过 Board CLI 发布。

## 当前维护规则

1. 判断任务前，先确认当前 Codex 项目是否为本目录的开发/维护版本。
2. 明确针对 Open Canvas 宿主的维护请求可以修改宿主源码。
3. 在打包后的分发目录中，必须遵守 `DISTRIBUTION-READONLY.md`，宿主源码保持只读。
