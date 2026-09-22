# Open Canvas project guidance

## Repository role and distribution read-only policy

This checkout is the development/maintenance source repository. Host changes
are allowed here when the user requests maintenance of Open Canvas itself.
Only copies packaged for distribution are read-only: Codex tasks running
against a distributed copy must never modify the host, even when a user
explicitly names Open Canvas or one of its controls. In a distributed copy,
do not edit `src/`, `scripts/`, root project configuration, or host
state/schema. The only supported task-created edits there are generated page
files and matching `assets/icons/*.svg` files under `generated-pages/`, plus
their Board CLI records.

The repository role and packaging boundary are recorded in
[`DEVELOPMENT-MAINTENANCE.md`](DEVELOPMENT-MAINTENANCE.md). Do not infer the
distributed-copy restriction merely from the presence of this source tree.

The distributed Codex workflow policy is documented in
[`DISTRIBUTION-READONLY.md`](DISTRIBUTION-READONLY.md), which must remain in
every distributed package. It does not restrict Apache-2.0 rights to modify,
fork, or redistribute the host source.

## Strict scope boundary

- Open Canvas is the host workbench. Pages displayed inside it are
  separate generated artifacts. Treat them as different products and never
  transfer a generated-page request to the workbench source.
- By default, every request about a page's style, color, typography, spacing,
  layout, content, component, responsive behavior, or interaction applies to
  the generated page shown on the Board. This includes phrases such as
  "current page", "this page", "the generated page", "the page on the
  canvas", and comments or screenshots pointing inside a generated page.
- For those requests, edit or create files under `generated-pages/` and publish
  them with `npm run board -- update-page/create-page`. Do not modify `src/`,
  `scripts/`, application CSS, project configuration, or the Board data file.
- A browser annotation's outer React selector is only host-page evidence. Use
  the selected generated element and its page metadata to find the generated
  source; never interpret the wrapper selector as permission to restyle the
  Open Canvas shell.
- Never modify the Open Canvas application in a distributed copy, even
  when the user explicitly names the host product or one of its own controls.
  Host maintenance belongs in this controlled source repository.
- The phrase "画板中的页面" means the generated page, not the host workbench.
  If the target still cannot be identified after listing Boards and pages,
  ask which generated page to update instead of editing the host application.
- Before finishing a generated-page task, verify that no files under `src/`,
  `scripts/`, or root application configuration were changed by that task.
  Undo only accidental changes made during the current task; preserve all
  pre-existing user work.

## Generated page workflow

- When a user asks to generate or revise a page shown on the board, use the
  repository's `$ai-page-board` Skill and run its CLI from this project root.
- Generate source files under `generated-pages/` and publish changes with
  `npm run board -- ...`. Never edit `data/board-state.json` directly.
- Resolve the target Board before creation and pass its stable `boardId` to the
  CLI. Use the active Board only when the user did not name a destination.
- After creation, report the destination Board name and ID together with the
  new page ID and source path.
- Do not use browser WebMCP/Site tools as the primary page generation path.
  The built-in browser is the preview and Annotation mode surface.
- Preserve the Open Canvas UI and behavior. A request to change the host
  application is outside the distributed workflow and must be declined rather
  than implemented.
