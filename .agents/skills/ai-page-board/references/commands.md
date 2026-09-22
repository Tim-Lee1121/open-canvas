# Board CLI commands

Run commands from the repository root. Every command returns structured JSON.
A failed validation returns a non-zero exit code and does not modify the state
file.

## Read

```bash
npm run board -- list-boards
npm run board -- list-pages --board-id <board-id>
```

`--board-index <number>` may replace `--board-id`, but keep using stable IDs
after the first lookup.

The user can choose the destination Board by name or ID in their prompt. Resolve
the name with `list-boards`, then always pass the resulting `--board-id` to
`create-page`. If no destination was provided, use the `activeBoardId` returned
by `list-boards`.

## Pages

```bash
npm run board -- create-page --title "Screen title" --html-file generated-pages/screen/index.html --board-id <board-id>
npm run board -- create-page --title "Reference" --url https://example.com --board-id <board-id>
npm run board -- update-page --page-id <page-id> --title "New title"
npm run board -- update-page --page-id <page-id> --html-file generated-pages/screen/index.html
npm run board -- move-page --page-id <page-id> --target-board-id <board-id> --target-index 0
npm run board -- delete-page --page-id <page-id>
npm run board -- export-page --page-id <page-id> --output generated-pages/screen/index.html
```

Creation also accepts `--index`, `--x`, `--y`, and `--no-select`. Position
updates require both `--x` and `--y`. `--url` accepts only HTTP(S) URLs.
Successful creation returns both `boardName` and `boardId`; include both with
the returned `pageId` in the completion message.

For HTML sources, the CLI validates that every SVG icon has a lowercase
kebab-case `data-icon`, `viewBox`, and path-only geometry. It rejects SVG
`<use>`, SVG `<img>` references, icon fonts, and runtime icon libraries, then
writes deduplicated standalone copies to the HTML file's sibling
`assets/icons/` directory. Successful create/update/export results include an
`iconAssets` array.

## Boards

```bash
npm run board -- create-board --name "Explorations" --layout-mode canvas
npm run board -- rename-board --board-id <board-id> --name "Review"
npm run board -- delete-board --board-id <board-id>
```

The last board cannot be deleted. Deleting a non-empty board requires
`--target-board-id <board-id>` (or `--target-board-index <number>`) so pages are
migrated atomically. Creation accepts `--no-activate` and either `canvas` or
`grid` for `--layout-mode`.

Boards can also be created manually with the `+` control beside **Boards** in
the left sidebar. Refresh `list-boards` after a manual creation before choosing
the destination for a generated page.

## State contract

- Shared state: adjacent `.open-canvas-data/<project>-<hash>/board-state.json`
- Legacy read-only fallback: `data/board-state.json` when the new file is absent
- Generated source files: `generated-pages/<page-slug>/index.html`
- Standalone icon assets: `generated-pages/<page-slug>/assets/icons/*.svg`
- HTML limit: 1,000,000 characters
- Title limit: 240 characters
- Board name limit: 120 characters

The running Vite board polls the shared state file. A successful CLI mutation
appears in the open board without invoking tools from the browser conversation.
