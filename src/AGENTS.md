# Open Canvas host source boundary

This `src/` directory belongs to the development/maintenance source
repository. Host maintenance is allowed here when explicitly requested. The
read-only restriction applies to packaged distribution copies, as recorded in
`DEVELOPMENT-MAINTENANCE.md` and `DISTRIBUTION-READONLY.md`.

Files in this directory implement the Open Canvas host workbench, not the
mobile pages displayed inside it.

- Do not modify anything under `src/` for requests about the style, layout,
  content, responsiveness, components, or interactions of a generated page.
- Browser annotations made inside a generated preview must be implemented in
  that page's source under `generated-pages/`, even when the browser reports a
  React wrapper selector from this application.
- Changes in this directory are prohibited in distributed copies, including
  when a user explicitly names the Open Canvas application or a host
  control such as the sidebar, Boards list, canvas toolbar, zoom controls, or
  canvas container. In this development/maintenance checkout, those host
  requests may be implemented in `src/`.
- "画板中的页面" refers to the generated artifact and is not authorization to
  change this directory.
