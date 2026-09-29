# Open Canvas Design System 能力支持评估

评估日期：2026-09-23
评估对象：Open Canvas 1.24 开发维护仓库、`dga-design-system` Skill 示例
评估范围：Design System 的可视化、应用化、上下文承载，以及“外部设计 Skill 已自带 Design System”时的协同策略

## 1. 结论摘要

基线评估时 Open Canvas 已经具备“生成页面结果的可视化、组织、标注和 Figma 视觉导出”能力，但还不具备把 Design System 作为一等对象进行注册、选择、检索、绑定、应用和验证的能力。本执行阶段已按本报告建议落地首版能力：项目级 Design System 工作区、DGA provider、sidecar registry、CLI/WebMCP 只读上下文和静态验证；真实 Figma Desktop gate 仍保持独立的 candidate/blocked 状态。

因此当前结论是：

| 能力 | 当前状态 | 结论 |
| --- | --- | --- |
| 展示生成页面视觉结果 | 已具备 | 可直接作为页面评审工作台 |
| 展示 Design System 资产 | 已支持（首版） | `Design System` 工作区提供 Overview、Tokens、Components、Patterns、Validation |
| 将 Design System 作为上下文载体 | 已支持（首版） | provider 输出受限 context bundle，带 version/digest/theme/provenance |
| 生成页面时应用 Design System | 已支持（CLI 链路） | project/Board/Page binding 按优先级解析，页面保存 resolved binding |
| 校验页面是否遵循 Design System | 已支持（静态契约） | 检查 system/theme/digest、组件/Pattern marker、ARIA review、provenance 和未知 ID |
| 多个 Design System 协同 | 未具备 | 没有主系统、参考系统、优先级和冲突处理模型 |
| Figma/视觉导出中的 DS 语义 | 部分具备 | 保留几何、样式、语义和诊断，但没有 token/component/system provenance |

建议把下一阶段定义为 **Design System Context Layer**，而不是简单增加一个“Design System 页面”。该层应同时服务于：

1. 人看：可视化浏览 token、主题、组件、状态和页面模式。
2. AI 用：向生成 Skill 提供受限、可追溯、版本固定的上下文包。
3. 机器验：判断页面是否按指定系统、主题、组件状态和页面模式生成。

## 2. 事实依据

### 2.1 `dga-design-system` 的能力边界

该 Skill 的 bundled knowledge base 是 Markdown 设计系统事实源，入口要求依次读取执行契约、token contract、readiness gates、主题、foundation、组件和 page pattern 文档。它不是一个运行时 UI 库，也不是 Open Canvas 当前可直接消费的 JSON API。

目前可观察到的结构化信息包括：

- `00-execution/ai-style-contract.md`：规定 token、组件文档、状态矩阵、DOM/ARIA contract 的优先级。
- `00-execution/tailwind-token-contract.md`：把 Figma token 映射为语义 Tailwind alias，并明确禁止把 `rounded-lg`、`shadow-md`、`p-4` 等默认值当作设计事实。
- `00-execution/component-readiness-gates.md`：把组件分为 A/B/C/D，并将 State Coverage、Semantic DOM、Concrete Style Binding 作为执行门禁。
- `01-foundations/tokens-index.md`：245 个 foundation values、Light 366、Dark 366，并通过 Markdown 索引主题和图标规则。
- `03-components/_index/components-index.md`：51 个组件记录，包含 Figma source 和组件 README 入口。
- `99-maintenance/component-style-readiness-audit.md`：当前摘要为 51 个 A 级组件、51 个执行契约 Complete。
- `_rag/index.json`：167 个可检索文档的 RAG 索引，包含 `rag_id`、路径、主题、组件、tokens 和 keywords。

这说明 DGA Skill 已经有较好的“可检索知识库”和“AI 执行契约”，但它的运行时入口仍然是 Skill 读取文档；Open Canvas 尚未消费这些元数据。

### 2.2 Open Canvas 当前能力

Open Canvas 的核心数据模型仍是 Board/Page：

- `PageSource` 只有 `url` 和 `html` 两种类型。
- `Page` 只有 `id`、`boardId`、`title`、`source`、`canvasPosition` 和时间字段。
- `Board` 只有页面列表、布局模式和画布 Tag。
- 状态 schema 已迁移到 `STATE_SCHEMA_VERSION = 2`；历史 `layoutMode: grid` 归一为 Canvas，Page 可保存解析后的 Design System binding，完整 provider manifest 仍在项目外 sidecar registry。

当前页面生产链路是：

```text
Codex task -> $ai-page-board -> generated-pages/<slug>/index.html
           -> npm run board -- create-page/update-page
           -> adjacent .open-canvas-data/.../board-state.json
           -> Vite state bridge -> React Board -> preview/annotation
```

CLI 现支持 registry 注册、inspect、project/Board/Page binding、受限 `get-design-context` 和 `validate-page-design`；WebMCP 增加五个只读 Design System 工具。`targetIndex` 和底层 page order 仍保留兼容。

Annotation 文档只注入 `codex-page-id` 和 `codex-page-title` 元数据。Figma `DesignDocument` 能保留节点几何、computed styles、ARIA semantics、assets、fonts 和 diagnostics，但当前模型没有 token ID、component slug、pattern ID、Design System 版本或 readiness 结果。

### 2.3 当前运行状态快照

本次通过仓库 CLI 读取到：

- active Board：`board-default`，名称 `New board`，7 个页面。
- 另有 `1` 和 `ANOS` 两个 Board。

该快照只用于证明 Board CLI 可读取当前状态，不代表新增任何 Board 或页面。本阶段修改的是受请求范围内的宿主源码、CLI、Skill 文档和验证契约；没有修改 `generated-pages/`，工作区已有的 Figma 相关未提交改动保持不变。

## 3. 能力差距分析

### 3.1 “可视化”不等于“Design System 可视化”

现在可以看到页面渲染结果、比较多个页面、在元素上做 Annotation，也可以走 Figma-compatible export。这解决的是 **rendered output inspection**。

Design System 可视化需要另外展示：

- foundation values 和语义 tokens：颜色、间距、圆角、字体、阴影、图标。
- Light/Dark theme 的差异和当前选择。
- component anatomy、variants、states、DOM/ARIA contract。
- pattern 的页面组合规则和 QA checklist。
- readiness level、Figma source、缺口和诊断。
- 页面实际使用了哪些 token/component/pattern，以及哪些是未绑定或降级值。

这些信息目前不在 Board/Page 状态中，也没有可供 UI 查询的索引，因此不能仅靠现有预览能力补齐。

### 3.2 “应用化”需要绑定、解析和验证三条链

Design System 应用化至少包含三层：

1. **选择**：项目/Board/Page 明确使用哪个系统、哪个版本和哪个 theme。
2. **解析**：生成 Skill 可以获取与当前页面意图相关的 pattern、组件、token 和约束，而不是把整套 Markdown 全量塞进 prompt。
3. **验证**：生成后检查页面是否存在 token trace、组件 contract、主题一致性、状态覆盖、响应式和可访问性证据。

当前只有“生成 HTML 并展示”这一层，缺少其余三者之间的机器可读连接。

### 3.3 “作为有效上下文载体”的必要条件

上下文载体不能只保存一段自然语言说明。至少需要以下稳定信息：

- `systemId`、`name`、`version`、`source`、`digest`：确定事实源和版本。
- `entrypoint`：例如 DGA Skill 的 `SKILL.md` 和 `00-execution/README.md`。
- `theme`：Light/Dark 或项目自定义主题，且只能选定一个主主题。
- `patterns`、`components`、`tokens`：当前任务允许的最小检索集合。
- `readiness` 和 `executionGates`：哪些部分可直接用，哪些必须回到 Figma。
- `provenance`：每个规则对应的 Markdown/Figma node/截图或抽取记录。
- `constraints`：禁止项、语义选择和页面 QA 要求。

没有这些字段时，AI 可能“看过文档”，但后续任务无法复用相同事实、无法判断是否发生版本漂移，也无法区分设计系统规则和页面自身的临时样式。

## 4. 建议的目标模型

### 4.1 Design System 不是 Page 的 HTML 附件，而是可版本化资源

建议新增一个独立资源模型，Board/Page 只保存引用和覆盖项：

```ts
interface DesignSystemRef {
  id: string;
  name: string;
  version: string;
  source: {
    kind: "skill" | "path" | "git" | "url";
    entrypoint: string;
    digest: string;
  };
  theme: "light" | "dark" | string;
  status: "ready" | "needs-review" | "blocked";
  indexPath?: string;
  readinessSummary?: {
    total: number;
    levelA: number;
    levelB: number;
    levelC: number;
    levelD: number;
    executionComplete: number;
  };
}

interface DesignContextBinding {
  primary: DesignSystemRef;
  references?: DesignSystemRef[];
  patterns?: string[];
  components?: string[];
  tokens?: string[];
  pageIntent?: string;
  qaProfile?: string;
}
```

建议将完整知识库和 RAG 文档保留在本地文件或 Skill 包中，Board 状态只保存 manifest、digest 和小型索引，不把 167 个 Markdown 文档或整页 HTML 复制进 Board state。这样可以避免状态膨胀，也能保持来源可追溯。

### 4.2 绑定层级

推荐的默认继承关系：

```text
Project default
  -> Board default Design System
    -> Page binding
      -> task-level explicit override
```

页面绑定应记录实际使用的版本和 theme；生成任务完成后应把 resolved binding 写回页面记录或页面 metadata，避免之后只看“当前 Board 默认值”而误判历史页面。

### 4.3 页面层的可追溯标记

页面源文件可以增加轻量、非视觉的标记，例如：

```html
<meta name="open-canvas-design-system" content="dga@1.0.0">
<meta name="open-canvas-design-theme" content="light">
<section data-ds-pattern="data-workspace-page">
  <button data-ds-component="button" data-ds-variant="Primary" data-ds-state="Default">
    Query
  </button>
</section>
```

这些标记只能作为 provenance hint，不能替代真实验证。验证器仍应检查 token class/variable、DOM/ARIA contract、主题混用、交互状态和页面截图。

## 5. 外部设计 Skill 与 Open Canvas Design System 的协同

### 5.1 不要把两个系统静默合并

如果某个设计 Skill 自带 Design System，最危险的方案是把两个系统的颜色、间距、组件名和规则直接合并。这样会造成 token 冲突、语义漂移和“看起来像遵循，实际上无法追溯”的结果。

建议使用 **一个主系统 + 零个或多个参考系统**：

1. 用户或任务明确指定的系统优先。
2. Page 已绑定的系统优先于 Board 默认系统。
3. Board 默认系统优先于 Project 默认系统。
4. Skill 内置系统只能作为该 Skill 的默认或 fallback，不能无提示覆盖已绑定主系统。
5. 参考系统必须命名空间隔离，例如 `dga.button.primary` 和 `brand.button.primary`，冲突时要求显式 mapping。

### 5.2 DGA 示例的推荐协同方式

对 `dga-design-system`，Open Canvas 可以把它注册为一个 `skill` 类型的 Design System provider：

- `entrypoint` 指向 `SKILL.md`。
- `knowledgeRoot` 指向 `references/design-system`。
- 从 `_rag/index.json` 建立可检索目录。
- 从 `component-style-readiness-audit.md` 读取 readiness 摘要。
- 根据页面意图只返回目标 pattern、目标组件 README、对应 theme 和 token contract。
- 生成时要求页面输出带有 resolved system/version/theme 和组件/模式标记。
- 生成后运行 DGA-aware validator，报告通过、警告、阻塞和需要 Figma 复核的条目。

这样 DGA Skill 继续负责“如何读取和执行设计规则”，Open Canvas 负责“当前项目选了什么、页面用的是什么、结果如何被看见和验证”。两者职责互补，不互相复制事实源。

### 5.3 当前 Open Canvas 自身 Design System 的边界

需要明确区分：

- **Open Canvas host/workbench system**：侧栏、Board、Canvas、Tag、Preview、Annotation 等宿主 UI 的视觉和交互规则。
- **Generated page system**：页面生成任务选用的 DGA、品牌系统或用户提供的其他系统。

仓库当前没有一个正式发布的、可供页面生成复用的 Open Canvas Design System manifest。不能把宿主 CSS 或组件样式自动宣称为生成页面 Design System，也不能因为页面显示在 Canvas 中就把宿主规则注入页面。

## 6. 推荐的能力分层与接口

### P0：Design System Contract

先定义 manifest、binding、resolver 和诊断格式，包含：

- `systemId/version/digest/source/entrypoint`。
- primary/reference 关系和覆盖优先级。
- theme、pattern、component、token 的选择集合。
- readiness、Figma provenance 和 blocked/needs-review 状态。
- 上下文包大小上限、敏感路径和 URL 脱敏规则。

P0 完成后，即使 UI 还没做出来，CLI 和 Skill 也可以共享同一份契约。

### P1：只读可视化

在 Board 增加 Design System 面板或独立 Catalog 视图：

- 当前 Board/Page 的 active system、version、theme。
- token swatches、typography、radius、spacing 和 icon preview。
- component catalog：variants、states、semantic DOM、readiness。
- pattern catalog：页面骨架和 QA checklist。
- 来源链接、digest、最后读取时间和警告。

该阶段不改变生成页，先解决“人能看懂当前系统是什么”。

### P2：应用绑定与上下文输出

CLI 建议增加下列只读/写入能力（命名可调整）：

```text
npm run board -- list-design-systems
npm run board -- inspect-design-system --id <systemId>
npm run board -- get-design-context --board-id <id> --page-id <id> --intent <text>
npm run board -- bind-design-system --board-id <id> --system-id <id> --theme <theme>
npm run board -- validate-page-design --page-id <id>
```

`get-design-context` 返回受限 JSON，至少包含 resolved system, theme, patterns, components, tokens, hard stops, provenance 和 QA checks；它不应返回未经筛选的整套知识库。

`$ai-page-board` 应在生成前读取这个 context，在创建/更新页面时传入 binding，并在结果中报告 system/version/theme、Board ID、page ID 和 source path。

### P3：应用验证

验证器应分层输出：

- **Pass**：页面 metadata/binding 与 active system 一致，使用的 token/component 可追溯。
- **Warning**：存在视觉对齐来源、截图 QA 未完成、字体或 Figma 复核缺失。
- **Block**：使用了混合 theme、未允许的 token、组件 readiness 为 C/D、缺少 required state/ARIA contract 或 provenance 不一致。

验证结果必须区分“结构/静态通过”和“浏览器/Figma 原生渲染通过”，不能把截图存在误报为设计系统合规。

### P4：多系统映射与 Figma provenance

后续再支持：

- DGA 与品牌系统的 token mapping table。
- component alias/adapter，例如品牌 Button 映射到 DGA Button 的语义状态。
- Figma node、截图、抽取记录和页面实例之间的 provenance graph。
- 设计系统变更后的页面影响分析和重新验证。

## 7. 关键风险与处理建议

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 把 HTML 的视觉相似当成 DS 合规 | 无法追责，迭代易漂移 | 要求 system/version/theme/provenance 和静态验证 |
| 两个系统的同名 token 静默覆盖 | 生成结果不可预测 | primary/reference + namespace + 显式 mapping |
| 把完整 Markdown 塞进每次 prompt | token 浪费、上下文不稳定 | manifest + RAG 索引 + 任务级最小 context bundle |
| 只保存当前默认系统 | 历史页面无法复现 | Page 记录 resolved version/digest |
| 把 DS 资料写进 Board state | 状态膨胀和迁移困难 | Board state 只存引用，资料留在本地 provider |
| 只依赖 Annotation 反馈 | 标注不在 Board state 中持久化 | 将验证结果和 binding 作为页面元数据/报告保存 |
| 使用外部 URL 作为知识源 | 网络漂移和敏感信息泄漏 | 默认 local path/skill，URL 必须 digest、脱敏并明确不可用状态 |
| 把宿主 UI 规则注入生成页 | 违反页面/宿主边界 | 维护 host DS 与 generated-page DS 两个明确命名空间 |

## 8. 验收门槛

建议下一阶段至少通过以下验收，才认为“Design System 能力已支持”：

1. 能注册并列出 DGA Skill，显示版本、入口、digest、token/theme/component/pattern 数量和 readiness 摘要。
2. 能在 Board 级选择 active system/theme，并在 Page 级查看实际 resolved binding。
3. 同一任务可以输出一个受限、可复用、带 provenance 的 JSON context bundle；第二次同任务读取到相同版本和 digest。
4. `$ai-page-board` 生成页面时能使用该 bundle，并返回 system/version/theme 与页面信息。
5. `validate-page-design` 能发现至少三类错误：theme 混用、组件/状态/ARIA contract 缺失、token 或 system provenance 不可追溯。
6. UI 能看到 token、组件状态和 page pattern，而不需要打开 Skill 源文件手工搜索。
7. Figma 导出继续保留现有视觉/语义信息，同时明确哪些内容只是 capture-time computed style，哪些内容有 Design System provenance。
8. 静态测试、浏览器 smoke、截图 QA 和 Figma 原生导入分别报告，不把一个结果冒充另一个结果。
9. 现有 Board/Page、生成页和宿主/页面边界保持向后兼容；旧 schema 能读取，未绑定页面显示 `Unbound` 而不是伪造合规。
10. 任何发布或生成页任务都能证明没有误改 `src/`、`scripts/`、根配置或非目标生成页。

## 9. 最终建议

建议批准下一阶段，但以 **P0 Contract -> P1 Catalog -> P2 Binding/Context -> P3 Validation -> P4 Mapping/Provenance** 的顺序推进。

第一阶段不应直接做“把 DGA Skill 全量导入 Canvas”。最小可行闭环是：

```text
注册 DGA provider
  -> Board 选择 system/theme
  -> 生成任务获取最小 context bundle
  -> 页面写回 resolved binding
  -> CLI/浏览器做 DS-aware validation
  -> Board 展示页面结果与合规/警告状态
```

这个闭环能同时满足 Design System 的可视化、应用化和上下文承载，并为未来接入其他设计 Skill 留出明确的主系统、参考系统和映射边界。
