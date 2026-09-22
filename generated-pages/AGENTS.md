# Generated page source guidance

Files in this directory are the mobile interfaces displayed by Open Canvas.
Page-level requests about visual style, layout, content, components,
responsive behavior, and interaction belong here by default.

## Icon assets

Store each page as `generated-pages/<page-slug>/index.html` with standalone
icons in `generated-pages/<page-slug>/assets/icons/`. Every icon in the HTML
must be an inline `<svg data-icon="...">` containing real `<path d="...">`
data. The matching standalone `.svg` file must have the same `viewBox` and
path data. Do not use emoji, icon fonts, remote icon URLs, `<img>` icons, SVG
`<use>` references, or runtime icon libraries. Hugeicons may be used as the
path-data source, but the final generated page must be self-contained.

After editing a page source, publish it with `npm run board -- update-page` as
defined by the repository `$ai-page-board` Skill. Do not compensate for a page
design issue by changing the Open Canvas host under `src/`. In distributed
copies the host remains read-only even when a user explicitly requests a host
change; only the project owner may maintain it in a controlled source repo.
