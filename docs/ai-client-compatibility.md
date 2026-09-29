# AI 客户端兼容性

Open Canvas 是一个本地优先的 React 工作台。它把页面生成、Board 状态、Design System 上下文和 Figma 导出拆成可复用的本地 CLI 与浏览器能力，因此可以被不同的 AI 客户端协同使用。

## 当前支持范围

| 客户端 | 当前支持方式 | 状态 |
| --- | --- | --- |
| Codex | 仓库 Skill `$ai-page-board` + `pnpm board` + 可选 WebMCP | 主工作流，已实现 |
| WorkBuddy | 将仓库作为本地项目打开，通过终端/Agent 执行 `pnpm board`、`pnpm dev`、校验命令 | 可用；没有厂商专用插件 |
| Trea Work | 将仓库作为本地工作区打开，通过终端/Agent 执行同一套 CLI 和校验命令 | 可用；没有厂商专用插件 |

这里的“支持 WorkBuddy / Trea Work”指：客户端能够访问本地项目、运行 Node/pnpm 命令，并保留项目目录作为当前工作区。它不表示 Open Canvas 已经获得 WorkBuddy 或 Trea Work 的官方集成、审核或背书。

## WorkBuddy / Trea Work 使用方式

在客户端中打开仓库根目录后：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

另开一个终端执行 Board 操作：

```bash
pnpm board list-boards
pnpm board list-pages --board-id BOARD_ID
pnpm board create-page --title "Onboarding" --html-file generated-pages/demo/index.html --board-id BOARD_ID
pnpm board get-design-context --intent "mobile dashboard"
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

状态文件和 Design System registry 默认保存到项目目录外的 `.open-canvas-data/`，因此客户端必须从同一个仓库根目录启动 CLI；不要把本地状态文件复制进公开仓库，也不要把 Vite 服务暴露到局域网或公网。

## MCP 边界

仓库内的 `src/integrations/webmcp.ts` 是浏览器页面所属的 WebMCP 兼容层，默认关闭；它不是 WorkBuddy 或 Trea Work 的 stdio MCP server。

当前版本**没有内置厂商专用 MCP 配置或服务器进程**。如果客户端支持自定义 MCP，可以在后续增加一个独立的 stdio 适配器，复用 `createWebMcpTools()`，但不能把当前 WebMCP 代码直接当作外部 MCP server 启动。

## 能力边界

- 两类客户端可以运行页面创建、更新、移动、删除、Design System 查询/校验和本地构建测试。
- 生成页面仍应写入 `generated-pages/`，并通过 `pnpm board` 发布到本地 Board；不要直接编辑 `data/board-state.json`。
- Annotation mode、Figma Desktop 剪贴板和 Open Canvas Importer 是否可用，取决于本机浏览器/Figma 权限，不会因使用 WorkBuddy 或 Trea Work 自动获得。
- Board 是单用户本地状态，没有云同步、账户、多人协作或跨设备实时共享。
- URL 页面仍需要 Figma 官方 Capture page 流程；Open Canvas 的 Figma 兼容导出是独立的 best-effort 实现。

## 版本声明

本文件描述的是客户端工作流兼容性，不是对 WorkBuddy、Trea Work、Codex 或 Figma 的商标、SDK、官方插件、协议授权或产品背书声明。
