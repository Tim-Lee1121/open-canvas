# Figma compatibility provenance and release gate

Open Canvas independently serializes its captured scene into an HTML clipboard
payload with `figmeta` and `figh2d` markers. This is a best-effort compatibility
experiment, not an official Figma SDK, published standard, or endorsed plugin.
Apache-2.0 covers project-owned code, not Figma marks or third-party page assets.

## What the repository currently establishes

- `src/figma/capture.ts` builds the scene from rendered DOM; `src/figma/h2d.ts`
  serializes it; `figma-plugin/` imports the shared scene using Figma Plugin API.
- The metadata `source` now identifies this project as `open-canvas`, not
  `chrome-extension`. The parser still accepts older payload shapes.
- Automated tests cover serialization, parsing, clipboard paths and plugin
  behavior. They do **not** prove that Figma Desktop accepts a paste or that
  its rendered layers retain the intended layout in a particular release.

## Evidence still required before public release

1. Maintainer records the origin of each compatibility-specific marker and
   field, including any public observation, independently authored test, or
   specification used. Confirm that no proprietary extension source, private
   SDK, unpublished documentation, keys, or protected behavior was copied.
   Source comments describing an "official" serializer are implementation
   hypotheses, not evidence of authorization or an official protocol.
2. In a dedicated blank test file, record the Figma Desktop version and OS,
   paste the public `generated-pages/demo/` page natively, and separately
   import it through Open Canvas Importer. Save screenshots of selected root,
   text, image/vector and Auto Layout layers, plus the plugin degradation
   report. Check that neither route produces only text, a screenshot, or one
   flattened SVG. Do not test in a user's existing design file.
3. Repeat after changes to marker shape, metadata `source`, clipboard flavors,
   capture geometry, or plugin import logic. Record failure as unsupported for
   that tested version; do not infer support from unit tests.
4. Review asset rights, Figma brand usage, developer terms and the relevant
   distribution channel separately. Figma Community submission needs its own
   privacy and consent review.

No completed Desktop version, screenshots, or provenance review are recorded
here yet. Until those checks pass, keep the repository private and describe
the native paste and plugin import as experimental, not guaranteed exports.
