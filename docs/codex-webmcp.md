# Codex WebMCP integration

The board can register WebMCP tools on the **top-level board document** as an
opt-in browser-scoped compatibility path. The primary Codex desktop workflow
uses the repository Skill and local CLI documented in
[`codex-client-workflow.md`](codex-client-workflow.md); the shared project file
remains the source of truth while Vite is running.

WebMCP is optional and is not required for client-side generation. Registration
is disabled by default so an open preview cannot become the generation runtime.
To enable the legacy compatibility path, set
`VITE_ENABLE_BROWSER_TOOLS=true`, restart Vite, and use a host that exposes the
top-level `document.modelContext` entry point. The board UI never exposes manual
page creation; use the project Skill by default.

## Registration

The board page creates a runtime adapter around its store and registers it when
the page mounts. If the host injects `document.modelContext` after the first
render, the shell retries briefly and probes again when the page regains focus:

```ts
import { registerWebMcpTools } from "../src/integrations/webmcp";

const registration = registerWebMcpTools({
  getState: () => store.getState(),
  dispatch: (action) => store.dispatch(action),
});

// Call this from the board page cleanup (for example, a React effect).
registration.unregister();
```

Hosts that settle registration asynchronously are tracked as `pending` until
each promise resolves or rejects. Pass `onStatus` when the UI needs live
integration state; a rejection removes that tool from `registered` and adds a
diagnostic to `errors` rather than leaving a stale connected indicator:

```ts
registerWebMcpTools(runtime, {
  onStatus: ({ supported, registered, pending, errors }) => {
    // Treat `pending` as "checking" and `registered === false` as unavailable.
    console.debug({ supported, registered, pending, errors });
  },
});
```

`registerWebMcpTools` does not access preview frames and must only be called by
the top-level board page. A preview iframe cannot expose tools to the host's
WebMCP discovery surface.

The adapter uses the app's existing reducer actions (`CREATE_BOARD`,
`RENAME_BOARD`, `DELETE_BOARD`, `CREATE_PAGE`, `UPDATE_PAGE`, `MOVE_PAGE`, and
`DELETE_PAGE`). Input is validated with the domain validators before dispatch.
Each execution returns either:

```json
{"ok":true,"action":"create_page","data":{"pageId":"page-…","boardId":"board-…","boardName":"Explorations"}}
```

or:

```json
{"ok":false,"error":{"code":"invalid_input","message":"…","field":"source"}}
```

Read tools advertise `annotations.readOnlyHint`; page/board deletion tools
also advertise `destructiveHint`. These hints improve the browser's review
prompt but are not an authorization mechanism: normal Codex confirmation and
the board's own validation still apply.

## Available tools

All selectors accept a stable ID (`boardId`) or a zero-based index
(`boardIndex`). For `list_pages`, `rename_board`, `delete_board`, and
`create_page`, omitting the selector means the active board.

| Tool | Input | Result |
| --- | --- | --- |
| `list_boards` | `{}` | All board IDs, names, page counts, layout modes, and the active board ID. |
| `list_pages` | `{boardId? , boardIndex?}` | Pages in the selected board, including title, source type, source (HTML is capped at 12,000 characters), and canvas position. |
| `create_board` | `{name, layoutMode?: "grid"\|"canvas", activate?: boolean}` | New `boardId` and board metadata. |
| `rename_board` | `{name, boardId? , boardIndex?}` | Renamed `boardId`. |
| `delete_board` | `{boardId? , boardIndex? , targetBoardId? , targetBoardIndex?}` | Deleted ID; for a non-empty board, the target is required and pages are migrated atomically by the reducer. The last board is protected. |
| `create_page` | `{title, sourceType: "url"\|"html", source, boardId? , boardIndex? , x?, y?, index?, select?: boolean}` | New `pageId`, `boardId`, and `boardName`. `index` inserts into grid order; omitted index appends. |
| `update_page` | `{pageId, title?, sourceType?, source?, x?, y?}` | Updated `pageId` and field names. `sourceType` and `source` must be supplied together. |
| `move_page` | `{pageId, targetBoardId\|targetBoardIndex, targetIndex?}` | Source and target board IDs. Omit `targetIndex` to append. The same tool also reorders within a board. |
| `delete_page` | `{pageId}` | Deleted `pageId` and its board ID. |

URLs must use `http` or `https`. HTML and titles are bounded by the domain
limits (`1,000,000` characters for HTML and `240` for a title). Coordinates
must be finite numbers. Unknown or malformed arguments return `ok: false`
without dispatching an action.

## Browser compatibility workflow

Use this only when a browser-scoped Site tools workflow is specifically
required. For normal generation, invoke `$ai-page-board` in the Codex project
task. When using WebMCP, keep stable IDs instead of indexes after lookup:

1. Call `list_boards` and choose a destination board.
2. Call `list_pages` for that board when updating an existing concept.
3. Call `create_page` for a new generated screen, or `update_page` for an
   iteration. Pass a complete HTML document for `sourceType: "html"`.
4. Call `move_page` when a screen belongs in a different board.
5. Call `delete_page` only after confirming the page ID.

Example prompt:

> List my boards, then create an HTML page titled “Onboarding v2” in the first
> board returned. Use the generated mobile document as `source`, select the new
> page, and report the returned page ID.

## Annotation flow in Codex's browser

The board does not expose a separate annotation action. In Codex's built-in
browser, enable Annotation mode directly and select elements inside a generated
HTML page on the board.

- URL pages keep their validated `http(s)` source link available.
- Generated HTML cards are rendered as sanitized, same-document DOM with
  boxless preview wrappers, so Annotation mode can hit headings, controls, and
  links inside the card. The
  card remains the visual frame. URL cards still use a sandboxed iframe and
  cannot be traversed across the frame boundary; use the external-link control
  to open the URL as a top-level page when needed.
- After annotation, return to the Codex project task and invoke
  `$ai-page-board` to apply the comments through the local CLI.

Annotations are managed by Codex's browser and are not persisted in the board
state. The exact Annotation UI and WebMCP availability depend on the Codex
desktop/browser rollout; the app remains usable without either capability.

## Security and lifecycle notes

- URL previews are rendered with `sandbox="allow-scripts"` and without
  `allow-same-origin`; this also protects against a URL that points back to the
  workbench origin. Use the external-link control when a URL needs its normal
  top-level behavior.
- The integration never grants iframe access to `document.modelContext`. The
  in-board HTML surface strips scripts, event attributes, active embeds, and
  unsafe URLs before it is inserted into the board document.
- Registration is idempotent at the caller level: call `unregister` in effect
  cleanup before registering a new runtime after a store replacement. The
  adapter calls the documented one-argument `registerTool(tool)` form. Local
  lifecycle guards prevent stale callbacks from mutating the board after
  cleanup; hosts that return an unregister callback or expose `unregisterTool`
  are used for host-side cleanup when available. Registration failures are
  exposed through the returned `errors` array and optional `onError` callback.
