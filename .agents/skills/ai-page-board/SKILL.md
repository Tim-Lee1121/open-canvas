---
name: ai-page-board
description: Generate or revise mobile HTML interfaces for Open Canvas, add them directly to a user-selected Board, and report the destination. Use when a user asks Codex to create, iterate, organize, or update screens shown on this project; do not use browser Site tools as the primary generation path.
---

# Open Canvas page workflow

Run this workflow from the repository root so generation happens in the Codex
client's local project environment. The browser is a preview and annotation
surface, not the primary execution environment.

## Non-negotiable distribution boundary

This Skill is shipped inside a distributed Open Canvas
host. Treat the host as immutable. Never modify `src/`, `scripts/`, root
configuration, or host state/schema, even if the user explicitly requests a
change to Open Canvas, its sidebar, Boards list, canvas toolbar, zoom
controls, or Canvas container. Do not reinterpret explicit wording as
authorization. Explain that host maintenance is a separate source task and stop that part
of the request.

The only supported write target in this distributed workflow is a generated
page under `generated-pages/`, published through the Board CLI. Preserve
`DISTRIBUTION-READONLY.md` in every copy and package.

## Non-negotiable page scope boundary

Open Canvas is only the host workbench. A screen displayed on a Board is a
separate generated artifact. All requests about page styling, typography,
colors, spacing, layout, components, content, responsiveness, or interactions
must change only the generated page source under `generated-pages/` and the
corresponding page record through the Board CLI.

Do not edit `src/`, `scripts/`, the workbench CSS or React components, package
configuration, or `data/board-state.json` for a generated-page request. This
rule also applies when browser comments expose a selector belonging to a React
card or preview wrapper: use the comment's generated element/page metadata to
locate the generated page, not the wrapper as an edit target. "画板中的页面",
"当前页面", "这个页面", and "生成页面" refer to the generated artifact.

This task-scoping rule does not restrict Apache-2.0 rights or separate source
maintenance tasks. Never modify the host application from this Skill. If no generated page can be
resolved, ask which page to update; do not fall back to modifying the host.

## Generated page icon assets

Every icon in a generated HTML page must be a real inline SVG with path data.
Do not use emoji, icon fonts, CSS-drawn icon substitutes, remote icon URLs,
`<img>` icons, SVG `<use>` references, or runtime icon-library components.
Use this markup shape for each icon:

```html
<svg data-icon="arrow-right" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path d="..." />
</svg>
```

Keep a standalone source copy for every inline icon next to the page source:

```text
generated-pages/<page-slug>/index.html
generated-pages/<page-slug>/assets/icons/arrow-right.svg
```

The standalone file must be a complete `<svg>` document with the same `viewBox`
and path data as the inline version. Names must be stable, lowercase kebab-case
filenames. When using Hugeicons, copy the selected icon's path data into both
locations and preserve the original viewBox; do not load Hugeicons or another
icon package at page runtime. Before publishing, inspect the HTML and verify
that every `data-icon` has a matching `assets/icons/<name>.svg` file and that
the inline and standalone path data match. The Board CLI validates these rules
and synchronizes the standalone SVG files for `create-page`, `update-page`, and
`export-page`; successful JSON results include the written `iconAssets` paths.

1. Run `npm run board -- list-boards`. If the user named a Board, resolve that
   exact Board by name or stable ID. If they did not, use the active Board.
   Never create a new Board unless the user requested one.
2. Confirm the chosen destination in the working update. Users may also create
   a Board manually with the `+` control in the board's left sidebar before
   asking Codex to generate a page.
3. For a new screen, create a complete self-contained HTML document at
   `generated-pages/<page-slug>/index.html`. Put all standalone icon assets in
   that page's `assets/icons/` directory. Include responsive mobile layout,
   real interaction states needed by the request, and no dependency on the
   board's DOM.
4. Publish it directly into the chosen Board from the project terminal:

   ```bash
   npm run board -- create-page --title "..." --html-file generated-pages/<page-slug>/index.html --board-id <id>
   ```

5. For an iteration, run `npm run board -- list-pages --board-id <id>`. Export
   the current HTML into `generated-pages/<page-slug>/index.html` when there is
   no suitable source file, restore or create its `assets/icons/` files, edit
   it, and publish the update:

   ```bash
   npm run board -- export-page --page-id <id> --output generated-pages/<page-slug>/index.html
   npm run board -- update-page --page-id <id> --html-file generated-pages/<page-slug>/index.html
   ```

6. After a successful create, explicitly report: the destination Board name,
   `boardId`, `pageId`, and generated source path. Never finish with only a
   generic success message.
7. Before completing a page generation or revision, inspect the files changed
   during the task. Verify each `data-icon` has a matching standalone SVG and
   matching path data. There must be no task-created changes under `src/`,
   `scripts/`, or root application configuration. Remove only accidental
   changes from the current task and preserve pre-existing user changes.

Never edit `data/board-state.json` by hand. The CLI reuses the application's
validators and writes the file atomically. Do not create pages through WebMCP
or browser controls when this Skill is available. WebMCP remains only as a
compatibility path for browser-scoped workflows.

For board management, URL pages, coordinates, and all CLI flags, read
[references/commands.md](references/commands.md).
