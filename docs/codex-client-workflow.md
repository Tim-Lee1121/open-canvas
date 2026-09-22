# Codex client generation workflow

The primary generation path runs inside the Codex desktop project's local
runtime. The browser is deliberately limited to rendering, board interaction,
and Annotation mode.

## Generated page versus host application

This checkout is the development/maintenance source repository, so explicit
host maintenance requests may update `src/`, `scripts/`, root configuration,
or host state/schema. Packaged distribution copies remain host-immutable; see
[`DISTRIBUTION-READONLY.md`](../DISTRIBUTION-READONLY.md).

Open Canvas is the host used to display generated pages; it is not the
default implementation target for page-design requests. In a Codex project,
requests to change a page's visual style, layout, content, component, or
interaction must update the matching source in `generated-pages/` and publish
that source through the Board CLI.

Do not edit the React workbench under `src/`, its CSS, scripts, or project
configuration merely because the page is rendered inside the Canvas. Browser
comments can contain selectors for the preview wrapper, but those selectors
do not change the target: comments made on generated content are implemented
in the generated page. In a packaged distribution copy, the host workbench
must remain unchanged even when Open Canvas or one of its controls is
explicitly named.

```text
Codex project task
  -> repository skill (.agents/skills/ai-page-board)
  -> generated-pages/<page-slug>/index.html + assets/icons/*.svg
  -> npm run board -- create-page/update-page
  -> adjacent .open-canvas-data/<project>-<hash>/board-state.json
  -> local Vite state bridge
  -> React board
```

## Why this replaces browser-first generation

WebMCP tools belong to the webpage that registers them and are discovered when
Codex visits that page in the built-in browser. They are useful for working
with the current live page, but they do not turn browser `localStorage` into a
Codex project filesystem. The project Skill instead runs commands in the
client's selected local repository, so generated HTML remains a normal project
artifact and the board only observes the result.

This follows the official Codex skill discovery location for repositories:
`$REPO_ROOT/.agents/skills`. See [Build skills](https://learn.chatgpt.com/docs/build-skills)
and [Site tools](https://learn.chatgpt.com/docs/webmcp).

## Use

1. Open this folder as a project in the Codex desktop client.
2. Start the board with `npm run dev` and open the reported local URL.
3. Create Boards manually with the `+` control in the left sidebar when needed.
4. In the project conversation, invoke `$ai-page-board`, describe the mobile
   screen, and optionally name the destination Board. The Skill resolves its
   stable ID; when omitted, it uses the active Board.
5. Keep the board tab open. A new page is inserted directly into the chosen
   Board, whose page count and canvas update automatically.
6. Require the completion message to include the Board name, `boardId`,
   `pageId`, and generated source path.
7. Before publishing, verify that each `data-icon` in the HTML has matching
   inline and standalone SVG path data under `assets/icons/`.
8. Use Annotation mode in the built-in browser for element-level comments,
   then return to the project conversation and invoke the Skill for the next
   revision.
9. When an HTML page is ready for design handoff, click `Export for Figma` in its
   Canvas toolbar, then paste directly on a blank Figma design canvas. The
   Open Canvas's independently implemented Figma-compatible clipboard payload
   may create editable layers in some Figma Desktop versions without opening
   a full-screen preview and is the pixel-fidelity path. Open `Plugins >
   Development > Open Canvas Importer` when the shared scene-model
   path, richer Auto Layout constraints, or the degradation report is needed.
   The importer keeps a constraint Fixed when Figma reflow would exceed the
   captured fidelity limit and reports that fallback. URL pages must use the
   official extension's `Capture page` or
   `Capture element` action instead.
   See [`figma-browser-plugin.md`](figma-browser-plugin.md) for details.
10. For a revision, confirm that only the generated page source, its icon
   assets, and its Board record changed. The distributed workbench source must
   remain untouched; explicit host-product requests must be declined.

The Skill uses `npm run board -- list-boards` before writing, stores each page
under `generated-pages/<page-slug>/`, and publishes through the CLI. HTML lives
in `index.html`; matching standalone SVG path icons live in `assets/icons/`.
The CLI validates and synchronizes those icons, imports the same reducer and
validation adapter as the React/WebMCP application, and writes Board state
atomically outside the project in the adjacent `.open-canvas-data/` directory.
Existing `data/board-state.json` is read when the new state file is absent;
the old file is not deleted or overwritten by migration.

## Fallbacks

- When the Vite state endpoint is unavailable, the React application falls
  back to browser `localStorage`.
- Browser WebMCP registration is disabled by default. Set
  `VITE_ENABLE_BROWSER_TOOLS=true` only when a browser-scoped compatibility
  workflow is explicitly required.
- Static hosting cannot write the repository state file. Use `npm run dev` or
  `npm run preview` for the local Codex project workflow.
