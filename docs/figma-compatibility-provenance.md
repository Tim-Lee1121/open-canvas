# Figma compatibility provenance and release gate

Open Canvas independently serializes its captured scene into an HTML clipboard
payload with `figmeta` and `figh2d` markers. This is a best-effort compatibility
experiment, not an official Figma SDK, published standard, or endorsed plugin.
Apache-2.0 covers project-owned code, not Figma marks or third-party page assets.

## What the repository currently establishes

- `src/figma/capture.ts` builds the scene from rendered DOM; `src/figma/h2d.ts`
  serializes it; `figma-plugin/` imports the shared scene using Figma Plugin API.
- Captures retain implicit/explicit HTML roles, accessible names, descriptions,
  and control states. Live values for text inputs, textareas, selects, and
  selected options are retained as `states.value`; empty editable controls keep
  their placeholder state, and multi-select controls retain `multiple`. Password
  contents are never serialized into the semantic or compatibility channels.
  The native importer uses these values for readable layer names/descriptions
  and keeps the structured semantics in Figma plugin data when the API exposes
  it.
- CSS Grid track definitions, named areas, auto tracks, and item placement are
  retained in the scene/H2D model and plugin metadata; because Figma has no
  native Grid layout mode, measured cells still use the visual-lock fallback.
  Non-default `grid-auto-flow` values additionally carry a compact
  `data-open-canvas-grid-flow` H2D marker and `open-canvas-grid-flow` plugin
  data with the authored value, dense flag, and measured-geometry strategy.
  `grid-auto-flow: dense` remains an explicit constraint degradation because
  Figma Auto Layout cannot reproduce the browser's hole-filling placement
  algorithm; the marker prevents a trimmed bridge from silently dropping it.
- Block containers whose direct children are all in-flow block-like boxes are
  promoted to vertical Auto Layout when their margins are non-collapsing (for
  example, a padding/border/flow-root boundary or a single-sided margin).
  Blocks with negative or adjacent collapsing margins, inline mixing, floats,
  columns, or positioned children remain on the measured path because Figma
  has no equivalent for those CSS formatting-context rules.
  Multi-column nodes are explicitly marked with measured geometry in both the
  shared scene and H2D-only importer path, preventing Figma from reflowing the
  captured content as a single editable column without a diagnostic. Their
  authored `column-count`, `column-width`, `column-gap`, and `column-fill` are
  also serialized in a `data-open-canvas-multicolumn` marker and retained as
  `open-canvas-multicolumn` plugin data, so the unsupported column-flow
  contract remains inspectable after import.
- `display: contents` wrappers are treated as structural-only nodes during
  capture; their visual children are merged into the surrounding flow instead
  of creating a zero-size Figma frame that can consume or collapse a layout
  slot. If the wrapper carries an ARIA role, accessible name/description, or
  control state, that structural semantic context is carried as metadata on
  the flattened visual descendant and stored in `open-canvas-structural-semantics`;
  no extra visual layer is created and the semantic coverage report still
  counts the source wrapper. Flattened descendants also carry parallel source
  owner ids; the importer uses those ids only to de-duplicate one wrapper's
  semantic entry when it was copied to multiple visual descendants. Distinct
  wrappers with identical roles or labels remain separate coverage entries.
- Flex/Grid `gap`, `row-gap`, and `column-gap` preserve percentage spacing by
  resolving it against the captured container content box. The winning authored
  declaration, including safe shorthand splitting, is also carried as
  `gapExpression`, `rowGapExpression`, or `columnGapExpression` in the shared
  layout marker and plugin metadata. Figma still receives the captured pixel
  value for native `itemSpacing`, because its API has no percentage/function gap
  primitive; the original expression remains inspectable instead of being
  silently discarded. Explicit zero gaps
  remain zero instead of falling back to the shorthand value, so responsive
  spacing does not become an unintended fixed pixel offset in Figma. Functional
  values such as `calc()`, `min()`, `max()`, and `clamp()` are resolved without
  truncating the expression to its first numeric token. Font-relative gap units
  use the captured container/root typography instead of a hard-coded 16px base.
  Percentage references follow CSS block/inline axes, so vertical and sideways
  writing modes resolve `row-gap` against the physical block width and
  `column-gap` against the physical inline height before handing pixels to
  Figma.
  Viewport-relative gaps (`vw`/`vh`/`vmin`/`vmax` and the small, large, and
  dynamic viewport variants) resolve against the captured `viewportRect`, not
  the local container, while the authored expression remains in layout metadata.
  For flex containers, native `itemSpacing` follows the CSS flex main-axis
  rule (`column-gap` for `flex-direction: row`, `row-gap` for `column`), while
  wrapped-track spacing uses the opposite gap. This selection is based on the
  authored flex direction rather than the physical Figma axis, so vertical and
  sideways writing modes keep the same CSS semantics after their axes swap.
- CSS `margin: auto` and logical `margin-inline`/`margin-block` auto edges are
  captured as physical top/right/bottom/left constraint metadata after applying
  direction and writing mode. Figma Auto Layout has no native per-child auto
  margin primitive, so affected children retain their measured rectangle and a
  flow placeholder while `open-canvas-auto-margins` keeps the authored intent
  inspectable. Main-axis auto margins in a flex container additionally receive
  an invisible `layoutGrow=1` spacer, so common push-to-end and split-free-space
  patterns continue to respond when the imported parent is resized; cross-axis
  and non-flex cases remain on the measured fallback. The H2D compatibility
  channel emits `margin: auto` when the node remains in flow; when measured
  positioning is required, it zeroes the replay margin to avoid applying the
  offset twice and carries the same constraint in
  `data-open-canvas-auto-margins`. The import report still records the feature
  as a constraint degradation because Figma has no direct per-child auto-margin
  primitive.
- Auto Layout container properties (`layoutMode`, `itemSpacing`, primary and
  counter-axis alignment, wrapped-track mode, counter-axis spacing, and
  counter-axis content distribution) are written with an immediate read-back
  check. If a Figma runtime silently normalizes a value or does not expose the
  property, the import report records the exact property, expected value, and
  observed value while measured geometry remains authoritative. This avoids
  claiming that CSS flex wrapping or alignment was natively preserved when
  only the visual snapshot survived.
- The same read-back discipline now covers the visual boundary flags
  `clipsContent` and `strokesIncludedInLayout`. A host that silently rejects or
  normalizes clipping or stroke participation is reported with the exact
  expected/observed value; the existing SVG mask/geometry fallbacks remain the
  visual safety net where available. The importer also writes `false` when a
  reused node no longer has CSS borders, preventing a previous border's layout
  participation from shifting the content origin after a responsive update.
- After the final frame-sizing settle, the importer performs one last visual
  constraint replay for corner radii, clipping, stroke participation, blend
  mode, visibility, aspect ratio, and related metadata. This closes the final
  host-turn window in which an Auto Layout normalization could otherwise leave
  the report correct while the exposed Figma node had stale boundary state.
- Mask and clip fallback synchronization also recreates an active fallback when
  a reused node has no previous sibling because the source was removed in an
  earlier responsive state. Same-size source reappearance therefore cannot
  leave the editable node un-clipped merely because there is no stale vector
  available to trigger replacement.
- The same no-previous-sibling recovery now applies to clipped background
  overlays and background image/gradient fallback stacks. Newly recreated
  layers are moved ahead of semantic content to preserve CSS paint order.
- Unsupported text-decoration SVGs use the same recovery rule: if a prior
  responsive state removed the fallback and a wavy/double/mixed decoration
  returns at the same geometry, the decoration is recreated before the final
  visual tree is exposed.
- Child cross-axis participation (`layoutAlign`) and compositing (`blendMode`)
  use the same checked write path during both initial creation and final
  constraint reapplication. This catches a node that visually falls back to
  `INHERIT`/`PASS_THROUGH` even though the API call did not throw. Reused nodes
  explicitly return to `PASS_THROUGH` when `mix-blend-mode` goes back to its
  CSS initial value; `isolation: isolate` continues to map to `NORMAL`.
  Child `layoutAlign` is also written back to `INHERIT` when neither the
  parent nor the child still requests cross-axis stretch, preventing a reused
  `STRETCH` value from changing the next responsive layout.
- Border paint widths (`strokeWeight` and per-side weights) and stroke alignment
  are also read back after writing. A Figma runtime that rounds, clamps, or
  silently changes a captured border width now produces a diagnostic with the
  expected/actual value instead of being treated as an exact border match.
- Flex growth (`layoutGrow`) is checked after mapping CSS `flex-grow`. If the
  host drops the value, the sizing report records the mismatch so a later
  measured-geometry correction cannot be mistaken for preserved responsive
  growth behavior. Compatibility payloads may omit CSS defaults such as
  `flex-grow: 0`; those omitted defaults now explicitly reset a reused node's
  `layoutGrow` to `0` and clear stale `open-canvas-flex` metadata, so a prior
  responsive state cannot leak into the next import.
  A `flex-shrink: 0` item may also receive a synthetic captured-axis
  `minWidth`/`minHeight` guard. That guard is tagged separately and removed
  when the next payload drops the shrink-zero constraint; current authored
  `min-*` constraints are then reapplied by the normal sizing pass. While the
  shrink-zero constraint remains active, creation and final constraint
  verification use the larger of the authored minimum and the captured
  main-axis border box. A smaller authored `min-width`/`min-height` can no
  longer overwrite the synthetic guard after Auto Layout settles and make the
  imported item compress on a later parent resize.
- Aspect-ratio constraints also have an explicit reset path. When a later
  payload returns to `auto` or omits the declaration, the importer clears
  `constrainProportions` and the stored aspect-ratio measurement/delta instead
  of allowing a prior ratio lock to survive a responsive update.
- Constraint metadata for containment, Grid auto-flow, multi-column layout,
  scroll behavior, CSS Anchor Positioning, and Container Queries follows the
  same lifecycle. Returning to the CSS defaults now clears the managed plugin
  datum, so a prior unsupported constraint cannot appear to belong to the next
  imported page or affect later diagnostics.
- `content-visibility: hidden` metadata is also cleared when a subsequent
  capture returns to `visible`; the node becomes visible again without
  retaining a stale hidden-state marker.
- Managed semantic and layout metadata now follows the same replacement
  lifecycle: descriptions, semantic roles, structural semantics, layout and
  position expressions, sizing markers, border-image declarations, and
  non-scroll background attachment are explicitly cleared when the current
  scene returns to defaults. This prevents a previous page's semantics or
  responsive contract from being mistaken for the current imported layer.
- When a measured geometry correction freezes an Auto Layout axis, both the
  parent-facing and intrinsic sizing modes are now checked after the `FIXED`
  write. A host that keeps `FILL`, `HUG`, or rejects the lock is reported before
  the importer positions the node, preventing a later reflow from silently
  undoing the captured size. The final geometry convergence replays frame-level
  HUG/FILL after late corrections without touching text auto-resize, then
  re-reads min/max bounds and position anchors so the last host layout turn
  cannot leave responsive metadata stale.
- The final constraint/geometry turn also re-applies captured text attributes
  and pixel line-height after Figma has settled Auto Layout. If restoring a
  native line box changes a HUG-height parent, one bounded measured correction
  runs before the final line-height read-back. This keeps the imported text
  leading and its containing frame geometry converged together instead of
  trading one for the other on Desktop builds that lazily normalize text
  sizing.
- Text line-height inheritance is preserved across both export channels. The
  browser capture resolves explicit, unitless, percentage, `em`/`rem`,
  `calc()`/`min()`/`max()`/`clamp()`, `lh`/`rlh`, and custom-property values to
  the used line box; direct `#text` runs can walk their containing element's
  ancestor chain when a compatibility bridge leaves `inherit`/`unset` or a
  stale `1.2em` value in the payload. H2D repeats the resolved pixel value in
  the numeric field, camelCase and kebab-case style fields, and an explicit
  `data-open-canvas-line-height` marker. The native clipboard path wraps text
  runs in an inline element with that pixel declaration, while the plugin path
  writes both `TextNode.lineHeight` and range-level line-height after the node
  is attached and after the final Auto Layout settle. The import report exposes
  `lineHeightExpected`, `lineHeightApplied`, read-back entries, failures, and
  visual fallback counts. The plugin also rejects a legacy marker that is only
  the child font's generic `1.2em` value when the captured text record already
  contains a different concrete inherited line box. A green local test suite
  still does not substitute for a real Figma Desktop import/read-back check.
  The same stale-default guard is applied while parsing the native H2D path,
  including payloads that serialize the captured line box as a CSS string
  rather than a number. Marker comparison uses the actual wrapper or text-run
  font size, so a 24px marker is correctly recognized as the generic `1.2em`
  fallback for a 20px run instead of being treated as a measured value.
- Corner radii are reapplied and read back during both visual creation and the
  final visual-constraint pass. This catches host-side clamping or normalization
  of asymmetric/large radii instead of leaving a rounded container visibly
  different from the captured page.
- Absolute measured snapshots now verify `layoutPositioning = ABSOLUTE` after
  the write. If a host leaves the layer in normal flow, the importer reports the
  mismatch instead of allowing Auto Layout to move the layer while presenting a
  successful geometry correction.
- Captured opacity and visibility are reapplied during the final visual
  constraint pass and read back from the node. Silent normalization to full
  opacity or visible state is therefore surfaced instead of changing the final
  page appearance without a diagnostic.
- Affine CSS transforms now verify the Figma `relativeTransform` matrix after
  assignment. Rotation, scale, skew, and transform-origin translations that are
  silently rounded or rejected are reported while the measured geometry audit
  remains the visual authority.
- Background-layer blend modes are reapplied during the final visual pass and
  each non-solid paint is checked after assignment. This keeps multi-gradient
  and image/gradient stacks from silently reverting to `NORMAL` in Figma.
  Reused import nodes also receive an explicit `NORMAL` write when the source
  returns to the CSS initial value or when a compatibility bridge trims the
  declaration, so a prior `multiply`/`screen` state cannot leak into the next
  responsive capture.
- Native gradient fills and strokes are now structurally read back after
  assignment. The importer compares paint type, gradient stop count, stop
  positions, RGBA channels, and the gradient transform matrix; a Figma
  runtime that silently converts a gradient to `SOLID`, drops a stop, or
  rewrites its geometry produces an `expected`/`actual` diagnostic under
  `fills.gradientPaint` or `strokes.gradientPaint` instead of being reported
  as a successful visual match. When a gradient stroke fails that read-back,
  the importer now promotes the captured border to an editable SVG ring and
  clears the rejected native stroke only after the replacement is created.
  SVG border/background fallbacks remain the visual recovery path for
  gradients that cannot be represented natively.
- The importer report now exposes `sourceNodes`, `semanticNodes`,
  `semanticNamedLayers`, `layoutMetadataNodes`, and `gridMetadataNodes` so a
  real page import can be scored from observed data instead of a system-wide
  heuristic percentage.
- Native imports store a stable `open-canvas-id` plugin datum separately from
  the human-readable layer name. Geometry correction and sibling ordering use
  that datum, preventing semantic renaming from associating text with the
  wrong visual layer. Nested Auto Layout frames can restore internal HUG/FILL
  sizing after measured-position correction; intrinsic frame sizing is
  restored for the complete tree before child-facing HUG/FILL writes, so a
  temporary construction-time FIXED parent cannot cause a false fallback.
  Only a real size drift or a host rejection triggers a Fixed fallback. A
  managed `open-canvas-source-index` is also retained as a legacy matching
  key: if a bridge or older import has no stable id, CSS `order`/reverse
  insertion cannot make later geometry or typography correction target the
  wrong sibling.
- All reserved `__css-text-*` visual siblings—including shaping, image-text,
  filter, mask, clip, overflow, and decoration variants—are excluded from
  semantic scene-child indexing. This keeps legacy imports without stable
  plugin ids from applying a later text, size, or geometry correction to a
  fallback layer instead of the real sibling. The importer also checks the
  fallback owner plugin-data keys, including gradient-fill and shadow
  fallbacks, so a user-renamed or legacy fallback layer remains excluded even
  after its reserved name prefix has been changed.
- H2D-only clipboard payloads normalize replay `styles` into the importer’s
  effective computed-style channel, so aspect-ratio, clipping, blend modes,
  overflow, and other native mappings behave consistently with the shared
  scene payload.
  A `data-open-canvas-visual-constraints` marker duplicates non-default
  `clip-path`, overflow, mask, non-default `border-image`, filter,
  backdrop-filter, blend-mode, isolation, image object-fit/object-position,
  object-view-box, and background-attachment declarations.
  The plugin restores these values when a clipboard bridge preserves
  attributes but trims the replay style object, keeping clipping, mask, and
  gradient-border and compositing fallbacks aligned with the captured geometry.
  The same restoration is applied when the bridge leaves a CSS default such
  as `none`, `visible`, or `fill` in the computed-style map: a retained
  non-default visual marker wins over that default, while a real non-default
  CSS declaration remains authoritative.
  `opacity()` filter components are intentionally omitted from the marker
  filter string because their resolved alpha is already materialized into the
  marker's final `opacity` value; this prevents a trimmed bridge from applying
  the alpha twice.
  Background SVG/bitmap references also carry a
  `data-open-canvas-background-asset-id` marker so the plugin can resolve the
  merged H2D asset even when the replay `background-image` declaration is
  absent.
  Captured CSS transforms and non-default transform origins also carry a
  `data-open-canvas-transform` marker. The plugin restores those values when a
  clipboard bridge trims replay styles, while preserving an explicit
  non-default declaration when both channels are present. The marker remains
  measured geometry metadata; it does not claim that Figma has a CSS transform
  constraint that will recompute from future layout changes.
- Image SVG fallbacks now have a reversible lifecycle. When a responsive
  update removes the unsupported `filter`, `clip-path`, `mask-image`,
  `object-fit: none/scale-down`, or `object-view-box` condition that required
  a vector fallback, the plugin restores a native editable IMAGE rectangle in
  the original sibling slot, preserving dimensions, position, opacity,
  constraints, semantic plugin data, native object positioning, and supported
  image filters. When one visual condition is removed but another remains, the
  fallback is rebuilt with the remaining kind rather than dropping the other
  crop/mask/filter semantics.
- Text overflow, text shaping, vertical-writing, and vector `clip-path`
  fallbacks follow the same capability-shift cleanup rule: restoring the
  source style to its native/default form removes an older SVG sibling even
  when the current runtime cannot create a replacement SVG. The editable
  source layer is made visible again only after all owned visual fallback
  siblings are gone. If the host removes an owned sibling before the plugin's
  cleanup pass runs, the managed original-opacity marker still restores the
  editable source layer instead of leaving it permanently hidden.
- Text-decoration SVG siblings follow the same lifecycle. Returning a wavy,
  double, custom-color, or multi-line decoration to a native single
  `underline`/`line-through` or to `none` removes the old vector and restores
  the native `TextNode.textDecoration`; cleanup also works when a later
  runtime no longer exposes `createNodeFromSvg`.
- Background SVG and clipped-color overlays now keep a source signature in
  plugin data. Same-size background source/style changes trigger an atomic
  overlay rebuild, while removing the background source removes the stale
  overlay and restores the captured native fill. Partial regeneration still
  rolls back to the previous complete stack when an asset or host operation
  fails. The source-removal cleanup does not depend on the current runtime
  still exposing `createNodeFromSvg`, so a capability change cannot leave an
  old SVG background painting over the next native fill.
  Complete gradient SVG backgrounds are inserted before authored children,
  marked absolute when their owner uses Auto Layout, and clipped to the
  captured corner path. Positioned pseudo-elements and positive-z content are
  reordered only within the authored child slots, so the background cannot
  move above either family during stacking correction.
- H2D-only payloads also reconstruct flex, inline-flex, grid, table-row, and
  representable block-flow containers into the same Auto Layout axes used by
  the shared scene. Reverse direction, wrapping, row/column gaps, item/content
  alignment, `align-self`, CSS `order`, grid track metadata, and fixed/sticky positioning
  metadata are recovered from replay styles instead of defaulting to
  `start`/`NONE`; viewport-fixed layers use the viewport-root coordinate space
  while fixed layers whose containing block is created by a transformed,
  filtered, contained, or `will-change` ancestor retain both their static
  parent-relative geometry and the CSS containing-block offset. They remain
  nested instead of being incorrectly hoisted to the document root, and the
  importer reports the missing native Figma containing-block constraint.
  Sticky layers remain static captures.
  This keeps older or marker-trimmed clipboard exports from losing their
  layout constraints when the shared scene marker is unavailable.
  Layout wrappers that contain only an anonymous text run remain editable
  frames; they are not flattened into TextNodes, so their grid/flex axis,
  wrapping, line-height inheritance, and measured child lock survive the H2D
  boundary.
  Anonymous text runs also carry CSS `order` in their replay style and are
  sorted with element children before plugin node creation, so mixed text and
  control/icon rows keep their authored visual sequence.
  Their numeric CSS `z-index` is carried through the same text style channel
  and participates in free-positioning stacking order, preserving overlays
  such as labels and badges that have no element wrapper.
  - H2D-only payloads also apply the shared scene's selective measured-position
  lock to direct children of distribution-sensitive frames (`center`,
  `space-between`, `space-around`, `space-evenly`, reversed/wrapped tracks,
  and equivalent grid cases). Small decorative leaves are kept flowable only
  for ordinary start-aligned rows; in a distributed row they are locked with
  their sibling content so Figma's `MIN` fallback cannot move a status dot or
  icon away from the captured browser position. The native H2D channel
  materializes those locked children as measured `position:absolute` layers
  with parent-relative `left/top` values and a
  `data-open-canvas-geometry-lock` marker. The Open Canvas plugin consumes the
  marker and restores a measured flow placeholder plus the original Auto
  Layout metadata; ordinary flow parents are not absoluteized.
  Explicit `align-self: start` overrides are also measured-locked when the
  parent uses center/end cross-axis alignment, because Figma has no equivalent
  per-child start override; start-aligned parents remain ordinary flow so the
  editable Auto Layout path is not unnecessarily frozen.
- Flex rows and columns with multiple growing children now detect a second
  source of Figma drift: equal `flex-grow` values with different
  `flex-basis` tokens, and intrinsic `auto`/`content` bases whose captured
  content sizes differ. Figma's `FILL` is only a boolean grow flag and cannot
  express that per-child basis, so the participating growing children retain
  their measured rectangles while the authored `flexGrow`, `flexShrink`, and
  `flexBasis` remain in the scene/H2D metadata. The plugin reports a
  `flex-width-basis` or `flex-height-basis` sizing degradation once per node;
  equal fixed or equal percentage bases remain ordinary editable FILL items.
- H2D elements with authored HUG/FILL intent carry a compact `layout` extension
  alongside the official styles. The plugin merges that extension over its CSS
  reconstruction, so a marker-trimmed export retains responsive sizing without
  serializing internal `geometryLock`/visual-snapshot flags into the generic
  H2D channel. Redundant `data-open-canvas-layout-mode`,
  `data-open-canvas-width-mode`, and `data-open-canvas-height-mode` attributes,
  plus a compact `data-open-canvas-layout` contract, are also emitted for
  clipboard bridges that preserve HTML attributes but trim unknown object
  fields; the importer accepts either source and still restores the Auto Layout
  axis, gaps, padding, alignment, wrapping, and HUG/FILL after the complete
  tree is assembled.
  For older or trimmed payloads that retain only a parent
  `data-figma-auto-layout` hint, the importer additionally infers child-facing
  `FILL`/`HUG` from the parent axis, captured content-box span,
  `flex-grow`, full-percentage sizing, and cross-axis stretch. Explicit
  intrinsic `flex-basis` keywords (`content`, `min-content`, `max-content`, and
  bare `fit-content`) take precedence over a width fallback and remain `HUG`.
  A main-axis `auto`/intrinsic size also remains `HUG` when a single captured
  item happens to span the available track; a snapshot alone is not enough to
  turn content-sized flex items into FILL containers. Explicit `flex-grow`,
  full-percentage sizing, and cross-axis stretch remain valid FILL signals;
  parameterized `fit-content(<length>)` remains a finite measured constraint.
  `data-open-canvas-*mode` attributes or serialized `layout.widthMode` /
  `layout.heightMode` remain authoritative; geometry-locked and out-of-flow
  children are excluded from this inference. The same recovery is enabled
  when only the compact `data-open-canvas-layout` JSON marker survives.
- The same compatibility marker explicitly carries `mode: none` for mixed
  inline/block and other measured free-positioning containers. This prevents a
  marker-trimmed clipboard export from re-inferring an ordinary `display:block`
  wrapper as a vertical Auto Layout stack and moving adjacent text runs.
- Flex/grid `align-items: baseline` is preserved as a first-class layout value
  and maps to Figma's `BASELINE` counter-axis mode when the host exposes it;
  this prevents mixed-size text/icon rows from silently becoming top-aligned.
- `self-start` and `self-end` alignment keywords are normalized to the
  corresponding measured Auto Layout edge in both the shared-scene and H2D
  replay paths, instead of silently falling back to `start`. The authored
  direction/writing-mode context remains in computed styles for inspection;
  this applies to both cross-axis flex alignment and Grid inline-axis
  `justify-items`/`justify-self` constraints.
- Horizontal Flex rows also account for the captured bidi direction: `row` in
  an RTL context receives the same measured child-order reversal as
  `row-reverse` in LTR, while `row-reverse` in RTL cancels that reversal.
  Column flow remains unaffected by the horizontal direction flag, and the
  source `direction` remains available in computed styles for inspection.
  Reversed axes also swap the Figma primary-axis `MIN/MAX` edge for logical
  `justify-content: start/end`, so sparse rows continue growing from the CSS
  main-start edge after import.
- CSS block/Flex/Grid `align-items: normal` is resolved to its stretch behavior
  during capture and H2D replay rather than being treated as `start`, preserving
  the default cross-axis fill for block, flex, and grid children. CSS Grid's `normal` values for
  `justify-items` and `justify-self` receive the same treatment for grid
  tracks. This keeps the captured text container size stable so its resolved
  line-height remains visually effective after Figma Auto Layout is applied.
  Explicit `align-self: stretch` follows the same margin guard as parent-level
  stretch: when a child has cross-axis margins, the importer keeps
  `layoutAlign: INHERIT` and preserves the captured inset instead of letting
  Figma stretch the child through its margins.
  SVG text fallbacks also resolve the final line of `text-align: justify` from
  the CSS inline-start edge when `text-align-last: auto`; in RTL text this is
  the right edge rather than the left, so Arabic/Hebrew paragraphs do not
  shift during a shaping or line-height fallback.
- CSS Grid `justify-content: normal` and explicit `stretch` are retained as a
  first-class layout semantic. Figma has no native primary-axis stretch mode;
  the plugin therefore keeps measured grid children authoritative and uses a
  physical start fallback for the parent while preserving the original value
  in layout metadata and plugin inspection data.
- Authored CSS `place-content` shorthand is now retained alongside its resolved
  `align-content`/`justify-content` axes. This survives a clipboard bridge that
  trims the shorthand or compact layout object, while visual placement continues
  to use the measured axis values and the plugin's existing geometry locks.
- CSS Flex/Grid `align-content: normal` is resolved to `stretch` instead of
  `start`, preserving the default cross-axis distribution for wrapped tracks.
- H2D replay prefers preserved `min/max-width/height` sizing constraints over
  default `computedStyles` values, so trimmed compatibility payloads do not
  lose authored percentage or functional responsive bounds before paste.
  Root-level percentage and viewport-unit bounds resolve against the captured
  visible viewport rather than the full document scroll extent, so a long page
  does not turn a `50%` root minimum into a bound based on its 3000px canvas.
- Relative-positioned layers resolve both `left/top` and the CSS-only
  `right/bottom` form against the captured containing block. Both capture and
  legacy/trimmed H2D replay use the parent content box after padding and
  border. Authored `%` and `calc()` tokens are carried as
  `positionOffsetExpression` and `data-open-canvas-position-offset`; native
  Figma positioning uses the resolved pixel offset while the original
  constraint remains inspectable in plugin data. Font-relative and negative
  values are preserved instead of being truncated with `parseFloat()`. Viewport
  units, including small/large/dynamic variants, use the original capture
  viewport through nested H2D containers rather than being reinterpreted as a
  parent-relative percentage. The
  H2D root and shared-scene capture use the captured viewport as their
  containing block, so root-level percentage offsets do not fall back to a
  zero-sized reference.
- Absolute/fixed layers with both horizontal insets now follow CSS's
  over-constrained rule when an explicit width is also captured: LTR keeps the
  left edge (`MIN`), RTL keeps the right edge (`MAX`), while `width: auto`
  continues to map both insets to `STRETCH`. The ignored inset and authored
  size expression remain in `open-canvas-position-constraints` metadata so the
  distinction is inspectable after import. The same rule applies vertically
  for an explicit height.
- H2D border-radius values resolve percentage and two-axis elliptical CSS
  syntax against the captured node bounds before mapping to Figma's circular
  corner-radius API, avoiding fixed-pixel interpretation of percentage radii.
  Absolute, font-relative, and viewport units plus `calc()`, `min()`, `max()`,
  and `clamp()` share the boundary length resolver as well. Top-level `/`
  still separates horizontal and vertical radii, while division inside a CSS
  math function remains part of that function. All native radii and SVG
  background, border, shadow, mask, and outline fallbacks use the same captured
  font/root/viewport context and CSS adjacent-corner scaling. Compatibility
  reports retain each authored expression beside its resolved two-axis pixels.
  The H2D clipboard replay retains the original two-axis radius string, and
  native frame nodes with elliptical radii now receive an editable SVG mask
  (plus a clipped solid or single-gradient background vector when needed).
  Uniform elliptical `border-image` gradients now use the same editable
  even-odd SVG ring path as solid borders, so gradient strokes follow both
  horizontal and vertical corner radii instead of falling back to Figma's
  circular stroke geometry. Asymmetric or mixed-gradient borders use the same
  measured gradient-vector fallback, which now carries the captured horizontal
  and vertical radii through its per-side inner and outer paths as well.
  Solid CSS outlines on the same two-axis radii now use an outside-only
  elliptical ring as well, preserving the outline offset without consuming
  the container's Auto Layout border box.
  Double outlines use fractional one-third paint bands for thin widths too,
  so a 1px/2px focus ring keeps its authored gap instead of becoming two
  solid 1px strokes.
  Uniform-width, uniform-color `border-style: double` borders use two editable
  even-odd SVG rings, including two-axis elliptical radii. The two strokes and
  intervening gap divide the authored width exactly, including fractional
  geometry for 1-2px borders, instead of relying on Figma's single circular
  stroke. The fallback keeps the captured border box and is named
  `__css-border-double` for inspection. Mixed-color or asymmetric double
  borders use separate outer/inner side bands with fractional one-third
  thicknesses and preserve the top/bottom corner spans during resize; their
  rounded corner joins remain an explicit per-side approximation.
  Uniform-width `inset` and `outset` borders also preserve two-axis elliptical
  radii in their editable shaded SVG ring. Each side is clipped to a distinct
  miter region so adjacent light/dark paints do not overlap at the corners.
  Uniform-width, uniform-color `ridge` and `groove` borders now use two such
  inverse shaded rings, preserving both halves of the relief effect through
  circular and elliptical corners instead of joining eight rectangular strips.
  Mixed gradient/image backgrounds on elliptical frames are flattened into one
  ordered editable SVG overlay so native fills cannot leak outside the
  two-axis path or paint twice beneath the mask. Image/text nodes and other
  unsupported radius combinations still use the conservative native-radius
  fallback.
  CSS `border-style: hidden` and `none` keep their captured border-box widths
  for layout geometry but never create visible native strokes or fallback
  decorations. Mixed hidden/visible sides therefore preserve both the source
  box size and the source paint semantics.
  Mixed `solid`/`dashed`/`dotted` rounded borders use per-side SVG centerlines
  inset by half of each side's width, so the stroke no longer bleeds outside
  the captured border box when neighboring sides have different widths. The
  same path preserves separate horizontal and vertical corner radii (for
  example `18px 10px`) instead of collapsing an elliptical corner to a
  circular arc.
  Gradient `border-image` paint width is kept separate from the layout
  `border-width`: unitless `border-image-width` multipliers and absolute pixel
  widths, plus percentage widths resolved against the captured border-image
  area (height for top/bottom and width for left/right), are resolved per side
  and applied to the native gradient stroke or
  editable border vector without changing the captured Auto Layout border box.
  Pixel and unitless `border-image-outset` values are also carried through the
  H2D channel; the editable gradient-vector fallback paints outside the frame
  bounds while leaving the frame's layout size unchanged. Conic-gradient
  sectors use that same expanded coordinate space, so an outset does not
  shift the angular center or clip the outer paint.
  Non-default `border-image-slice` and `border-image-repeat` values are also
  carried through H2D and stored in `open-canvas-border-image` plugin data;
  this keeps native-importer constraints inspectable even when a Figma runtime
  cannot reproduce `round`/`space` repeat semantics as an editable stroke.
  If a compatibility bridge preserves only the computed default
  `border-image-source: none`, the importer ignores that default and recovers
  the actual gradient or URL from the captured per-side border record, so a
  trimmed style map cannot hide an otherwise valid border-image paint.
  During final Auto Layout geometry correction, both gradient and image-backed
  border vectors are resized from the per-side outset values; asymmetric
  `border-image-outset` therefore remains asymmetric after the owning frame
  changes size.
  Solid/dashed/dotted side fallbacks compare their effective painted span and
  thickness independently. Vertical sides intentionally exclude the top and
  bottom border spans, so a normal convergence pass no longer rebuilds them
  merely because their height is shorter than the frame; a responsive
  `border-width` change still triggers a fresh side paint.
  The same synchronization pass removes an individual `none` or `hidden`
  side fallback even when the other three sides remain visible. A responsive
  state therefore cannot leave a stale SVG edge beside the updated native
  border paint; clearing all four sides still removes the complete fallback
  stack and native strokes together.
  The capture preloads image sources from ordinary elements and from
  `::before`/`::after` pseudo-elements, including their border-image and mask
  declarations. Pseudo-element border-image records therefore receive the
  same inlined asset id as ordinary elements instead of falling back to an
  unresolved remote URL.
  When no valid nine-slice geometry is available, non-`stretch` repeat modes
  are surfaced as an explicit import degradation and the vector fallback is
  used instead of a silent native stroke that would suggest the wrong border
  pattern. Valid one-to-four-value
  numeric, percentage, and number/percentage math expressions (`calc()`,
  `min()`, `max()`, and `clamp()`) in `border-image-slice` now map the source
  gradient into nine editable SVG regions under the captured rounded or
  elliptical border clip. `fill` includes the mapped center region; without
  it the center is omitted. Slice pairs that exceed the source dimensions use
  CSS proportional normalization. Invalid slice syntax remains an explicit
  degradation. For valid sliced sources, edge regions also honor `repeat`,
  `round`, and `space` modes with independently clipped editable tiles;
  `space` follows CSS's short-edge rule and stretches the edge when fewer than
  two complete tiles fit, avoiding transparent gaps at the ends;
  unsliced sources still retain those repeat values as metadata because there
  is no nine-slice geometry to tile.
- Capture diagnostics only report filter and background-blend functions that
  are genuinely unsupported by the native importer; supported blur,
  drop-shadow, opacity, brightness, contrast, saturate, and mapped blend modes
  no longer produce false degradation warnings. CSS `filter: opacity(...)` is
  composed with the captured CSS `opacity` and applied to the imported Figma
  node as one clamped layer opacity. `backdrop-filter: blur(...)` maps to
  Figma's `BACKGROUND_BLUR`; other backdrop functions remain explicit
  degradations because they change the sampled backdrop rather than the layer
  itself. Image-only `grayscale`, `sepia`, `invert`, and `hue-rotate` filters
  now use an editable SVG image fallback with the captured object-fit,
  position, and corner clipping; if the bitmap cannot be embedded, the native
  image path remains and the import report keeps the filter degradation visible.
  `filter: opacity(...)` is removed from the SVG filter primitives when the
  fallback is used because the resolved opacity is already composed once on
  the imported Figma node; this avoids double-dimming filtered/masked images.
  Text layers that use color-changing filters such as `brightness`, `contrast`,
  `saturate`, `grayscale`, `sepia`, `invert`, or `hue-rotate` use the same
  ordered SVG filter primitives in their absolute visual fallback while the
  original TextNode remains editable. Native blur and drop-shadow effects are
  retained in the SVG sequence when combined with those filters; unsupported
  filter functions remain explicit degradations and are never silently omitted.
  Justified text in the same fallback uses the captured line box width for
  non-final lines, retaining browser-like inter-word distribution instead of
  collapsing the paragraph to left alignment.
- Import reports classify `background-svg-fallback` separately from actual
  capture warnings. A complex CSS background preserved as an editable SVG is
  now reported as a successful visual fallback, while font, unsupported-style,
  and unresolved-asset diagnostics remain warnings with node details.
- Gradient-only backgrounds are flattened to an SVG fallback for stable color
  interpolation. Backgrounds with non-`normal` `background-blend-mode` stay on
  a layer-aware path: native gradient/image paints receive one Figma blend mode
  per source layer, while clipped or measured SVG image/gradient overlays are
  split from the base-color overlay and receive the mode on the corresponding
  layer itself.
  This avoids applying the mode to an already-composited SVG group and keeps
  `padding-box`/`content-box` clipping and `space`/`round` image placement
  inspectable. Unsupported values remain explicit degradations.
  Repeated blend overlays resolve their pattern period against the
  `background-origin` box rather than the outer border box, so asymmetric
  borders and padding do not create an extra tile outside the CSS paint area.
  Multi-image URL stacks now match each layer's `background-origin` and
  `background-clip` independently inside the ordered SVG fallback; shorter
  comma-separated background property lists repeat from the beginning, as CSS
  requires, instead of reusing only their last value. The background color
  continues to use the clip associated with the bottom-most image layer.
  The same per-layer geometry is applied to measured `space`/`round` stacks
  and mixed gradient/image overlays, so a gradient in the content box cannot
  force a neighboring image layer into that same origin or clip box.
  Background blend modes and mask modes use the same cyclic layer-list
  matching, keeping a shorter authored list aligned with later layers.
  CSS Color 4 `oklab()`, `oklch()`, and `color-mix(in srgb, ...)` stops are
  converted to sRGB before SVG serialization; named colors in `color-mix()`
  use the same parser table as the plugin so capture and import do not diverge.
  Conic gradient layers are classified alongside linear/radial layers when
  interleaved with URL backgrounds, preserving the captured CSS paint order
  and per-layer blend-mode mapping.
  Supported `mix-blend-mode` values, including CSS linear blend aliases, map
  to the imported node's native blend mode; unsupported values such as
  `vivid-light` remain inspectable in the captured styles and are reported
  instead of silently becoming `NORMAL`.
  CSS `isolation: isolate` now maps to a Figma `NORMAL` frame compositing
  context, preventing descendant blend modes from passing through to siblings
  outside the isolated group. Unknown isolation values remain explicit
  degradations.
- `background-clip: text` with a single URL image layer now has a second
  visual path for runtimes that reject the native IMAGE paint on a TextNode.
  The editable TextNode remains in the imported scene, while an absolute SVG
  sibling repeats/positions/sizes the captured image and clips it to the
  captured glyphs. The fallback is created only after native background paints
  are attempted, so successful IMAGE paints do not produce duplicate visual
  layers; its owner marker is retained for later geometry synchronization.
- Text capture retains explicit, percentage, unitless, and browser-default
  line-height semantics. The importer writes the resolved pixel line box after
  Figma text sizing and after the TextNode has been attached to its parent, so
  Desktop cannot normalize a detached write back to `AUTO` and default leading
  is not collapsed to the glyph bounds,
  then re-verifies it after the final Auto Layout/geometry pass. The native
  `TextNode.lineHeight` write is read back; when a Desktop runtime normalizes
  that whole-node assignment to `AUTO`, the importer retries with
  `setRangeLineHeight` over the editable character range and verifies
  `getRangeLineHeight` when the node-level getter remains `AUTO`. When a
  runtime exposes the range getter, that character-range value is authoritative
  even if the node-level getter optimistically reports `PIXELS`; a layer is
  counted as applied only when the editable range itself reports the requested
  value. This prevents a false success report while the visible text remains
  on Figma's `AUTO` leading. Repeated convergence passes deduplicate failures
  by text-layer id and requested value, so the import report counts affected
  layers rather than retry attempts.
  Imported text layers also retain the resolved value in `open-canvas-line-height` plugin
  data for post-import inspection. Direct H2D text nodes carry the resolved
  numeric line-height as well; they also carry a `styles.lineHeight` CSS fallback
  for importers that materialize a text record without inheriting wrapper styles.
  Anonymous text records duplicate the resolved replay styles in an optional
  `computedStyles` compatibility channel. This covers clipboard bridges that
  preserve computed-style fields while trimming the raw `styles` object, so
  the Open Canvas parser can still recover inherited line-height and text
  metrics instead of reverting to Figma's `AUTO` leading.
  Element-backed text children now carry the same duplicated computed-style
  channel, including the resolved `lineHeight`/`line-height`, so a bridge that
  trims only the raw child styles cannot drop inherited leading from paragraph,
  heading, or label containers.
  Anonymous text records additionally carry a
  `data-open-canvas-line-height` compatibility attribute. The Open Canvas
  importer resolves these sources without silently restoring Figma's `AUTO`
  leading when a clipboard bridge trims one extension channel. Generic/native
  H2D consumers may ignore the Open Canvas attribute. For the H2D compatibility
  path, the measured marker outranks both stale authored strings and the
  generic numeric `1.2em` fallback that older bridges can leave on anonymous
  TEXT_NODE records; the shared scene's resolved numeric value remains
  authoritative when that lossless channel is available.
  The H2D/plugin readers accept both camelCase `lineHeight` and serialized CSS
  `line-height` keys, covering bridges that preserve stylesheet property names
  instead of the H2D camelCase convention. The serializer emits both keys with
  the same resolved pixel value, so a bridge that keeps only one naming form
  cannot silently drop inherited leading.
  The capture boundary also reads `line-height` explicitly through
  `getPropertyValue()` when a compatibility bridge omits it from the
  enumerable `CSSStyleDeclaration` property list. This preserves inherited
  leading on intermediate wrappers even when a trimmed payload has no numeric
  text declaration; the same explicit channel retains non-default outline
  width/style/color/offset declarations.
  Compatibility captures also resolve the arithmetic forms permitted by CSS
  `calc()`, including unitless multiplication/division such as
  `calc(1.5 * 1em)` and `calc(28px / 2)`, before emitting the pixel line box;
  invalid dimensional arithmetic remains on the normal fallback path instead
  of being interpreted as an arbitrary pixel value.
  A fully dimensionless result such as `calc(1 + 0.5)` remains a CSS
  line-height multiplier and is resolved against the text font size rather
  than being misread as `1.5px`.
  Responsive line-height expressions can also nest those arithmetic values
  inside `min()`, `max()`, and `clamp()` (for example,
  `clamp(20px, calc(1.5em + 2px), 32px)`). Capture and legacy H2D parsing use
  the same recursive evaluation rule, so a trimmed clipboard payload does not
  replace the browser's selected line box with the generic `1.2em` fallback.
  `border-image-width` also accepts the compatible `calc()`, `min()`, `max()`,
  and `clamp()` length/percentage forms; horizontal and vertical percentage
  references continue to use the CSS border-image-area axes.
  `border-image-outset` accepts the corresponding length arithmetic forms and
  keeps the outset as an external decoration, so it does not change the
  captured layout border box.
  The native clipboard-only serializer also wraps element-backed text (`P`,
  `H1`, `DIV`, and similar text containers) in a layout-neutral inline `SPAN`
  carrying the same resolved pixel value. This closes the Figma Desktop
  compatibility gap where the importer honors the outer element's style but
  materializes its direct TEXT_NODE child with `AUTO` leading. The lossless
  Open Canvas plugin payload does not add this compatibility wrapper, so its
  editable scene shape remains unchanged.
  If a compatibility bridge trims the child's numeric line-height while
  retaining only the parent frame's computed `line-height`, the native H2D
  serializer now resolves that parent declaration before creating the inline
  wrapper. A child with a different font size therefore keeps the inherited
  absolute line box instead of falling back to its own generic `1.2em` value.
  Text shaping, overflow, clip/mask, filter, and image-glyph SVG fallbacks
  retain their captured geometry in plugin data. If a later Auto Layout or
  measured correction changes the text box width or height, the fallback is
  rebuilt from the original font metrics instead of resizing the old vector;
  this prevents final convergence from stretching glyphs while the editable
  TextNode remains the semantic source.
  At the plugin boundary, the same compatibility normalization now applies to
  the full style map: ordinary CSS keys such as `font-size`, `padding-top`,
  and `background-color` are also exposed through their canonical camelCase
  aliases, while the original keys and `--custom-properties` remain intact.
  Explicit camelCase keys win when a bridge sends both forms. This prevents a
  bridge serialization detail from dropping typography, box geometry, paint,
  or constraint declarations before scene reconstruction.
  The same aliasing is applied when a bridge compresses flex, scroll, anchor,
  or container-query declarations into `data-open-canvas-*` marker maps, so
  those recovered constraints follow the same canonical property names.
  The H2D-only parser also materializes `inline-size`/`block-size` and their
  `min`/`max` variants onto the captured physical width/height axes when the
  physical channel is missing or defaulted. Explicit physical sizes and bounds
  remain authoritative, so this recovery cannot overwrite a measured border
  box or an authored physical constraint.
  The H2D-only parser also materializes `border-inline-start/end` and
  `border-block-start/end` (including width/style/color and the
  `border-inline`/`border-block` shorthands) onto the four physical border
  sides. RTL, vertical, and sideways writing modes are mapped before
  `cssBorder()` consumes the styles; explicit non-default physical borders and
  physical shorthands remain authoritative. This preserves solid and
  `border-image` gradient strokes when a clipboard bridge trims logical CSS
  fields.
  Logical corner radii (`border-start-start-radius`, `border-start-end-radius`,
  `border-end-start-radius`, and `border-end-end-radius`) are materialized to
  physical corners using the same direction and writing-mode mapping. The
  physical `border-radius` shorthand, including elliptical slash values, is
  expanded first and remains authoritative over logical fallbacks.
  The H2D-only parser also expands an `outline` shorthand into
  `outlineWidth`/`outlineStyle`/`outlineColor` before native and vector outline
  rendering. Explicit outline fields remain authoritative, so a trimmed
  shorthand cannot replace a captured physical outline.
  `outline-style: auto` is retained as a platform-defined focus-ring contract
  and in `open-canvas-outline-style` plugin data. Because Figma has no
  theme-aware browser focus-ring equivalent, the importer renders an editable
  solid ring approximation, preserving ordinary or elliptical corner radii and
  signed `outline-offset`; `open-canvas-outline-rendered-style` records the
  `solid` mapping. The import report identifies this approximation explicitly
  instead of silently presenting it as pixel-exact. If SVG creation is not
  available, an editable rounded rectangle remains the bounded fallback.
  H2D-only border and outline shorthands may retain the CSS width keywords
  `thin`, `medium`, or `thick` after the browser-computed pixel channel has been
  trimmed. The importer now resolves those values consistently as `1px`,
  `3px`, and `5px` across paint creation, content-box geometry, gap references,
  and frame-vs-text classification. The source keyword remains in computed
  style metadata, and the import report marks the compatibility mapping because
  CSS permits user-agent-specific keyword widths.
  The same compatibility boundary now resolves absolute (`pt`, `pc`, `in`,
  `cm`, `mm`, `q`), font-relative (`em`, `rem`, `ex`, `ch`), and viewport
  (`vw`, `vh`, `vmin`, `vmax`) border/outline widths instead of treating their
  numeric prefix as pixels. Font-relative values use the captured element/root
  font sizes; viewport values use the captured viewport. Because exact `ex/ch`
  font metrics are unavailable after that channel is trimmed, they use a
  reported half-em fallback. Paint geometry, content-box references, and child
  containing blocks share the same resolved widths.
  Border and outline widths retained as `calc()`, `min()`, `max()`, or
  `clamp()` are resolved through the same length engine, including arithmetic
  with absolute, font-relative, and viewport units. Small, large, and dynamic
  viewport variants (`sv*`, `lv*`, and `dv*`) use the captured viewport. H2D
  border/outline shorthands recognize these expressions as width tokens, while
  the import report keeps the original expression beside its resolved pixel
  value so the static compatibility mapping remains explicit.
  `outline-offset` uses the same absolute, font-relative, viewport, and CSS
  math resolution, but keeps signed results so negative offsets continue to
  inset the focus ring instead of being clamped to zero. Percentage offsets
  remain invalid per CSS and are ignored. The import report records the
  authored expression and resolved pixel offset separately from outline width.
  If a compatibility bridge leaves a generic `normal`/`initial` value beside
  a measured line-height marker, the marker wins; otherwise the browser's
  captured line box would be replaced by the generic default during replay.
  Conversely, if the bridge corrupts the marker itself to an unresolved
  keyword (`normal`, `initial`, `inherit`, `unset`, `revert`, `var(...)`, or
  `env(...)`), the importer discards that marker and falls back to the next
  concrete wrapper/ancestor value. This prevents a malformed compatibility
  attribute from erasing an otherwise valid inherited line box.
  The same precedence is enforced again in the final `sceneLineHeight()` read
  used for `TextNode.lineHeight`, so a legacy numeric fallback such as
  `19.2px` cannot overwrite a measured inherited marker such as `28px` after
  the scene has already been reconstructed.
  If a bridge trims the marker as well, anonymous multi-line runs compare the
  remaining numeric value with their captured rectangle and line count; a
  generic `1.2em` fallback is replaced by the measured line box when those
  values disagree. Element-backed text does not use this heuristic because
  its rectangle may include padding or a fixed control height.
  When element-backed text retains per-line `textLineRects`, the importer uses
  the median vertical distance between line tops as the stronger geometry
  signal, so padded text containers can recover inherited leading without
  treating their outer height as a line box. Without per-line geometry, the
  element's captured numeric value remains authoritative.
  Before native TextNodes are created, a second inheritance pass restores a
  missing child numeric value from the nearest captured wrapper. Pixel lengths
  remain absolute, while unitless parent values are resolved against the
  receiving text size; explicit child declarations remain authoritative.
  Anonymous text runs emitted by a trimmed bridge may carry the browser
  default `normal` even when that value was not authored on the run. When a
  resolved parent line box is available, the importer treats that anonymous
  `normal` as missing and inherits the parent value; an explicit element-level
  `normal` declaration remains authoritative.
  Anonymous direct text runs use that CSS style fallback when a marker-trimmed
  clipboard drops the numeric extension, so a child-specific line box is not
  replaced by its wrapper's default leading.
  If a legacy clipboard bridge trims the numeric field, wrapper styles, and
  compatibility marker together but preserves the measured multi-line text
  rectangle and line count, both the H2D and shared-scene importers derive a
  conservative pixel line-height from that geometry. Single-line boxes are
  excluded because their measured height may include glyph or padding geometry;
  this recovery is only used when no valid CSS line-height source remains.
  Legacy payloads that emitted `0px` as a placeholder for a missing numeric
  line-height are treated as absent; the importer then uses the computed or
  inherited wrapper value instead of collapsing the text to a one-pixel line
  box.
  Text Auto Resize is restored conservatively when the captured box remains
  stable: authored single-line HUG/HUG maps to `WIDTH_AND_HEIGHT`, fixed-width
  or fill-width/HUG-height maps to `HEIGHT`, including wrapped or explicitly
  broken text whose width track is stable. Width-HUG multiline text,
  truncated text, and geometry-drifting text remain `NONE` at the captured
  box; a rejected HUG write is recorded as a sizing fallback and does not
  trade visual fidelity for an unverifiable constraint.
  Because the final Text Auto Resize write can itself schedule a parent Auto
  Layout update, the importer performs one additional bounded settle/audit
  after final typography restoration. If that pass must resize or promote a
  text layer to an absolute measured snapshot, its retained Auto Resize mode
  is changed to `NONE` before the last line-height verification, preventing a
  late HUG reflow from reopening an already-corrected geometry mismatch.
  The final line-height verifier also compares the TextNode border box with
  the captured rectangle immediately after the pixel value is accepted. Some
  Desktop builds keep the requested leading but collapse a multiline HUG
  layer to a one-line height on that same host turn. When this happens, only
  the drifting axis is frozen, the captured text box is restored, and the
  import report records a `text-line-height-geometry` sizing fallback. This
  preserves compatible FILL/HUG intent on the unaffected axis while ensuring
  that correct line-height metadata cannot coexist with visibly truncated
  text geometry.
  The HUG attempt marker is keyed by the source node, captured dimensions,
  line count, and a content fingerprint. Repeated convergence passes therefore
  do not toggle a rejected mode, while a responsive re-import with changed
  text or geometry can retry it. When the source sizing intent becomes fixed,
  stale `HEIGHT`/`WIDTH_AND_HEIGHT` plugin metadata is cleared before text
  attributes are restored.
  If a Desktop runtime still rejects both the node-level and character-range
  line-height writes, the plugin keeps the original editable TextNode as a
  semantic layer and adds an absolute SVG text fallback whose tspans use the
  captured line box and, when per-line rectangles are available, their measured
  vertical origins. This keeps mixed-font leading and text-box trimming from
  being re-expanded into a uniform `fontSize + index * lineHeight` stack. The
  fallback never consumes an Auto Layout slot, is
  repositioned during geometry convergence, and is removed automatically when
  a later native line-height write succeeds. The import report exposes
  `lineHeightFallbacks` so this visual recovery is explicit rather than being
  mistaken for native Figma line-height support; when a later convergence pass
  recovers native leading, the report also removes the transient failure and
  fallback counts so its final values describe the layer state left in Figma.
  The fallback stores a source signature for its lines, font, color, leading,
  spacing, alignment, and measured line rectangles, so same-size typography
  updates rebuild the SVG instead of leaving stale text pixels behind.
  Fallback discovery and removal do not depend on the current runtime still
  exposing `createNodeFromSvg`: an older imported SVG fallback can therefore
  be discarded when native line-height support returns, even on a trimmed or
  capability-shifted bridge. If the host removes that SVG sibling before a
  later geometry pass, the retained fallback marker causes the plugin to
  rebuild it when the native range is still `AUTO`, or to clear the marker and
  restore the editable TextNode when the native pixel value has converged.
  The same anonymous text style channel carries the resolved font family,
  size, weight, stretch, letter/word spacing, alignment, color, whitespace,
  direction, transform, text shadow, text stroke, and text fill values. When
  an intermediate wrapper is trimmed,
  the importer restores these run-level values before applying inherited
  wrapper defaults, preventing a text layer from falling back to different
  font metrics, alignment, or text paint while its line-height remains correct.
  It also carries text decoration, truncation/line-clamp, baseline alignment,
  wrapping, hyphenation, and shaping-feature values so painted controls keep
  their editable label semantics when only the anonymous text record survives.
  Direct anonymous runs also retain writing-mode, text-orientation, unicode-bidi,
  text-wrap-style, text-rendering, font-optical-sizing, and font-size-adjust
  metadata. Figma still reports unsupported values explicitly instead of
  silently treating the run as an ordinary horizontal text layer.
  Element-backed text also carries `data-open-canvas-text-rect` and
  `data-open-canvas-line-count` compatibility markers. If a clipboard bridge
  keeps element attributes but trims TEXT_NODE geometry extensions, the
  importer can still recover the browser-measured glyph inset, text bounds,
  and visual line count instead of expanding the editable text layer to the
  whole element or reverting it to one line. Anonymous text runs inside
  painted controls/containers carry the same markers on their TEXT_NODE record,
  preventing a trimmed label from expanding to the whole button or card.
  Their text wrapper promotes a shared value
  to CSS `line-height`. When a compatibility payload trims more than one
  intermediate wrapper, the same uniform descendant value is promoted through
  each missing ancestor; mixed-size/mixed-line-height content is left
  unflattened so child values remain authoritative. This keeps inherited
  spacing alive when a Desktop build ignores the custom text node field. The
  native clipboard H2D channel additionally emits a minimal inline `SPAN`
  wrapper for every anonymous run with a resolved line box, including
  single-line runs whose parent declaration was trimmed. This makes CSS
  inheritance explicit for
  Figma Desktop builds that ignore a raw `TEXT_NODE`'s custom line-height field.
  It is only a serialization compatibility layer:
  the Open Canvas plugin unwraps it back to one editable text layer,
  preserving the original content, measured rectangle, line count, indentation,
  and text styling.
  When a bridge trims an intermediate wrapper's computed style map but keeps a
  resolved child line box, the same inline wrapper is emitted from the child
  value. The raw `toH2D()` inspection API keeps its historical shape by
  default; only the native clipboard serializer enables the broader wrapper
  mode, so this compatibility change does not alter scene-model consumers.
  Because changing a text line box can reflow an Auto Layout parent, the plugin
  runs a bounded measured-geometry convergence loop (up to three rounds) around
  line-height verification. This also rechecks CSS margin wrappers whose final
  height can otherwise retain a one-pixel rounding residual after typography
  is applied.
  Text attributes and `textAutoResize` are applied before the authoritative
  line-height write. The importer then repeats the write after each typography
  convergence pass and once more as the final text operation, covering Figma
  Desktop builds that reset a previously assigned pixel line-height to `AUTO`
  when text sizing changes.
  Anonymous multi-line text uses at least `lineCount * lineHeight` for its
  captured editable box when the browser Range only reports painted glyph
  bounds. Element-backed text keeps its border/padding box, so this correction
  does not enlarge controls or padded text containers.
  Intermediate wrappers that retain the browser default `line-height: normal`
  are treated as missing declarations when a uniform resolved descendant line
  box is available, so the default leading cannot overwrite the captured
  inherited spacing.
  The same rule applies to anonymous `#text` runs that retain `normal` or
  `initial` together with the generic `1.2em` numeric fallback: because a raw
  text run has no authored declaration boundary, its parent’s resolved line
  box is restored before Figma node creation.
  That recovery carries the nearest valid inherited line box through multiple
  trimmed `normal`/`initial` wrappers, so an intermediate compatibility node
  cannot reset a descendant back to the generic leading.
  For multi-line text whose declaration is `normal` (or an inheritance
  keyword), capture also measures the median distance between visual Range
  line tops; the `1.2em` value remains only the fallback when the browser does
  not expose usable multi-line geometry. This measurement covers both
  element-backed text and anonymous direct text runs inside a container. Range
  tops are grouped with a bounded font-relative tolerance so mixed glyph
  ascenders/descenders on one line do not become false extra lines.
  For single-line `normal`/`initial` (and equivalent inheritance-keyword)
  text, capture also measures the content
  box of an auto-height text element (including block, flex, grid, and table
  text containers) after subtracting padding and borders.
  The auto-height decision uses the winning authored `height`, `min-height`,
  and `max-height` declaration rather than the computed pixel `height` that
  browsers expose for an `auto` element; this keeps ordinary headings and
  labels on the measured path while excluding genuinely constrained controls.
  CSS reset/intrinsic tokens such as `unset`, `initial`, `revert`,
  `revert-layer`, `min-content`, `max-content`, and `fit-content` are treated
  as unconstrained only where their CSS semantics allow it; numeric and
  parameterized functional bounds remain excluded.
  Fixed-height, min-height, and max-height controls are excluded so their
  container geometry cannot be mistaken for inherited line-height. When the
  browser exposes neither multi-line Range geometry nor a trustworthy
  auto-height box, the importer retains the CSS-compatible `1.2em` fallback.
  When an anonymous run is first sized with the provisional `normal` fallback
  and then receives a measured line box, capture rebuilds its line count and
  editable box height from the original glyph rectangle. The provisional
  fallback height is not carried into H2D, preventing an over-tall Figma text
  container after the real inherited line-height is discovered.
  Generated text from `::before`, `::after`, and `::marker` uses the owning
  element's font size and line-height as an inheritance fallback when a
  compatibility capture retains `inherit`, `unset`, or `revert` keywords.
  The same resolved metrics drive the pseudo-element measurement box, keeping
  generated labels and list markers from collapsing to the generic 16px/1.2em
  default before they reach Figma.
  Font family, weight, style, letter-spacing, and word-spacing use the same
  inheritance fallback, so generated content does not keep the literal
  `inherit` token or silently switch to the default font while its line-height
  is preserved.
  The same font-relative tolerance is used when converting rendered text to
  explicit line breaks. Small top-metric differences between adjacent inline
  runs (such as regular/bold or mixed CJK/Latin glyphs) therefore remain one
  editable Figma line instead of becoming an accidental newline that changes
  the imported line-height and vertical positions.
  Explicit `<br>` elements are also serialized as editable newline characters,
  including consecutive breaks for intentional empty lines; they are not lost
  merely because the DOM range walker only exposes text nodes.
  Multi-line direct or mixed inline text runs retain a measured first-line
  offset when the union glyph rectangle starts on a later line. The capture
  stores that offset as `textIndent` plus a compatibility marker, and the
  native plugin restores it as Figma `paragraphIndent`; this prevents a
  preceding inline sibling or CSS first-line indent from being flattened when
  one editable TextNode represents the whole run. Centered and RTL runs are
  left on their native alignment path rather than being mistaken for a
  paragraph indent. The write is read back and retained in
  `open-canvas-text-indent` plugin data; a Desktop runtime without
  `paragraphIndent` reports an explicit style degradation instead of silently
  dropping the offset. When a later capture returns to `text-indent: 0`, the
  managed paragraph indent and its metadata are explicitly cleared.
  Legacy payloads that serialize `lineHeight` as a CSS string
  (`px`, `%`, `em/rem`, `lh/rlh`, `calc(...)`, `min(...)`, `max(...)`, `clamp(...)`, or unitless) are normalized to the same pixel value before the
  Figma write, with `em` resolved from the text size and `rem` from the
  captured root size. `lh` uses the current or inherited line-box reference
  and `rlh` uses the measured root line-box value, including a custom root
  `line-height`, so modern tokenized typography does not silently fall back to
  Auto/default leading.
  Authored `var(...)` and `env(...)` line-height tokens are retained for
  inspection, but when a compatibility bridge also carries the browser's
  resolved computed value, the importer uses that resolved pixel value rather
  than treating the token as an unknown expression and falling back to
  `1.2em`.
  Nested H2D replay computes percentage, `em`, `rem`, and other absolute
  line-height forms against the declaring wrapper's font size before passing
  them to descendants; only unitless values remain multipliers. This matches
  CSS inheritance when a child changes font size and prevents a trimmed
  compatibility payload from expanding its line spacing a second time.
  payloads that retain `inherit`, `unset`, `revert`, or `revert-layer` use the
  parent/computed style as their fallback instead of treating the keyword as
  an unrelated 1.2em value; `initial` correctly resets to the browser's
  `normal` line-height. The DOM capture boundary
  also walks ancestor computed styles when a compatibility capture still
  exposes one of those keywords, so the direct clipboard path receives the
  same resolved pixel line box as the plugin path.
  When that ancestor fallback still contains an authored percentage or `em`
  token, capture resolves it against the declaring ancestor's font size before
  inheritance; unitless values remain multipliers and resolve against the
  receiving text size. This prevents a child with a different font size from
  recomputing an inherited `150%`/`1.5em` line-height incorrectly.
  `content-visibility: hidden` keeps its measured layout slot in capture and
  is replayed as `visibility: hidden` in both the native plugin and H2D
  clipboard paths. Other `content-visibility` modes remain explicit
  degradations because Figma has no equivalent subtree rendering constraint.
  The plugin parser also carries inherited line-height and font size through
  nested H2D elements when a legacy or trimmed payload omits those child
  declarations, preserving CSS inheritance instead of reverting to 16px/1.2em.
  H2D font-size declarations are resolved before they become the numeric
  Figma text size: `em`/`rem`, percentages, captured viewport units, and
  `calc()`/`min()`/`max()`/`clamp()` use the inherited/root font and viewport
  context. The authored token is retained as `fontSizeExpression` in the
  compatibility style channel, while the resolved pixel size is reused by
  line-height, `em` borders/shadows/padding, and responsive min/max
  constraints. This prevents a trimmed payload from turning `1.25rem` into
  `1.25px` and then propagating that error through the entire layout.
  The same H2D boundary resolves `letter-spacing`, `word-spacing`, and
  `text-indent` before creating editable TextNodes. Font-relative and
  arithmetic length forms use the effective run font size; text-indent
  percentages use the containing block's inline content width, and negative
  spacing/indent values remain signed. The normalized pixel values are used by
  native range writes and SVG text fallbacks, so a trimmed payload cannot turn
  `0.05em` or `calc(0.25rem + 2px)` into a fractional-pixel or first-token
  approximation.
  If an intermediate wrapper retains `inherit`, `unset`, `revert`, or
  `revert-layer`, the keyword is resolved against the already-carried ancestor
  value before recursion continues, so nested text cannot lose the inherited
  pixel line box.
  Modern `safe`/`unsafe` Box Alignment prefixes are normalized to their
  underlying `center`/`end`/`start` value instead of being misread as `start`.
  Figma does not expose the overflow-safety policy itself, so that policy is
  not claimed as a native editable constraint.
  Flex `wrap-reverse` is also retained as an explicit layout flag and emitted
  through the H2D compatibility channel. Figma Auto Layout exposes wrapping
  but not reversed track direction, so the native plugin keeps measured child
  geometry for the current visual result and reports this limitation instead
  of silently converting it to ordinary `wrap`.
  The initial browser line breaks are retained, but Figma's TextNode API has no
  equivalent dynamic `balance`/`pretty` reflow algorithm. Editing the content or
  changing the text width in Figma can therefore diverge from later browser
  line breaks; these strategies remain explicit import diagnostics rather than
  being silently claimed as native support.
- The same compatibility fallback carries inherited text font family, weight,
  letter spacing, color, alignment, transform, style, decoration, and writing
  direction through trimmed nested H2D elements; explicit child declarations
  still take precedence so mixed-style inline content remains separate.
  The plugin boundary treats `inherit`, `unset`, `revert`, and `revert-layer`
  as inheritance keywords for these properties instead of passing them to the
  Figma scene as literal CSS values. This keeps trimmed text runs aligned with
  their wrapper's font metrics and paint.
  Nested compatibility wrappers also skip an inherited keyword when the
  immediate parent is itself trimmed, continuing to the nearest concrete
  family, color, spacing, or alignment value. Literal `inherit` tokens therefore
  cannot reach the final Figma TextNode and trigger a font or paint fallback.
  The same rule now covers WebKit text stroke width/color, transparent text
  fill, and text shadow on nested wrappers and anonymous runs. A trimmed paint
  declaration therefore cannot collapse an outline or silently remove the
  shadow while the surrounding line-height and font metrics remain inherited.
  The same normalization is applied when rebuilding anonymous text children
  inside painted H2D frames, including text fill/stroke and shadow values;
  compatibility payloads therefore cannot reintroduce a literal `inherit`
  color on the final editable layer.
  Explicit `inherit` values for text overflow and vertical alignment are also
  resolved through the same wrapper chain, preserving ellipsis and baseline
  offsets in trimmed nested runs.
  Numeric `vertical-align` lengths are resolved with the captured font/root/
  viewport context instead of `parseFloat()` truncation, so `em`, `rem`, and
  `calc()` baseline shifts remain editable and signed. Text-decoration SVG
  fallbacks use the same context for `text-decoration-thickness` and
  `text-underline-offset`, including percentage and negative offsets. WebKit
  text-stroke widths are normalized to non-negative pixels before native
  `TextNode` stroke writes; percentage stroke widths remain rejected as CSS
  invalid rather than being misread as pixels.
  List marker text is reconstructed as an editable absolute text layer, and
  its font metrics and resolved line-height follow the owning `LI` wrapper;
  this keeps bullets and ordered-list prefixes aligned with multi-line list
  content instead of falling back to Figma's default leading.
  The `font-variant-*` metadata follows the same parent/child resolution path,
  so a trimmed nested run keeps the source numeric, caps, and ligature intent
  even though Figma cannot apply those shaping controls natively.
- The `figmeta` marker now carries the captured document width/height, the
  requested viewport, the visible `viewportRect`, page identity/title, and
  device-pixel ratio. This keeps 1440/1920 PC captures distinguishable from
  long-document height when a downstream H2D consumer reads metadata instead
  of the full payload; `viewportRect` remains the source for `vw`/`vh` sizing.
- Text elements with CSS padding are kept as a frame plus an editable text
  child instead of flattening the padding into a Figma TextNode's width. This
  preserves the captured border box and glyph inset separately and avoids
  padded labels becoming visibly over-wide after paste.
- CSS `text-overflow: ellipsis` and `line-clamp` are written after the text
  node is attached to its parent and rechecked after final geometry correction;
  this avoids Figma Desktop normalizing `textTruncation`/`maxLines` while a
  detached text node or its Auto Layout parent is being measured. Unsupported
  or read-only truncation APIs remain explicit in the import report while the
  authored values stay in `open-canvas-text-overflow` plugin data. A later
  capture that returns to `clip`/no line limit also disables the prior native
  truncation and removes any old SVG ellipsis fallback, so reused nodes do not
  retain stale overflow behavior. The SVG ellipsis fallback also stores a
  source signature for the truncated lines, ellipsis state, font, color,
  spacing, alignment, and line rectangles; same-size text or style changes
  therefore rebuild the vector instead of reusing stale pixels.
- CSS `letter-spacing` and `word-spacing` follow the same attached-node and
  final-convergence path. The base tracking is read back as a native Figma
  `PIXELS` value, while word spacing is applied to space-character ranges so
  it does not overwrite ordinary glyph tracking. When word spacing returns to
  its default, those ranges are restored to the base letter spacing and the
  old plugin markers are cleared. The resolved values remain in
  `open-canvas-letter-spacing` and `open-canvas-word-spacing` plugin data.
- Text baseline shifts, native text strokes, and the supported portion of text
  decoration are also re-applied after attachment and after final Auto Layout
  correction. This keeps range-level styling from being lost during font or
  geometry measurement; existing vector decoration fallbacks remain separate
  and are not duplicated by the verification pass. Returning a captured
  `-webkit-text-stroke` width to zero clears the previously managed Figma
  strokes and their metadata. Returning `vertical-align: super/sub` to
  `baseline` likewise zeroes the managed character-range baseline shift and
  clears its markers. Decoration SVG siblings retain a source signature for
  the line set, paint, style, thickness, offset, and measured line geometry,
  so a same-size theme or typography change regenerates the path rather than
  leaving an old color or dash pattern behind.
- Native text alignment, case transformation, writing direction, vertical
  alignment, and fixed `textAutoResize` are re-applied at the same boundaries.
  This prevents a host measurement pass from silently returning a right/RTL or
  uppercase layer to its default left/LTR/original state while retaining the
  captured text box geometry.
- Native visual constraints are also rechecked after geometry convergence:
  authored `aspect-ratio` keeps `constrainProportions`, and CSS visibility or
  `content-visibility: hidden` is restored from the captured state. This
  prevents a later resize pass from leaving a visible source layer hidden (or
  dropping its proportion constraint) in the editable result.
  Because Figma exposes no writable authored ratio separate from
  `constrainProportions`, the importer stores the authored ratio together with
  the measured box ratio and reports a degradation when they differ. This
  makes min/max, rounding, and host-normalization conflicts explicit instead
  of implying that the native proportion toggle alone restored CSS sizing.
  During measured geometry correction, a constrained node is temporarily
  unlocked while the captured width and height are written, then the native
  proportion lock is restored. This keeps the browser box authoritative even
  when the captured CSS ratio conflicts with min/max or fractional rounding;
  hosts that refuse the temporary unlock are reported as an explicit
  aspect-ratio degradation rather than silently changing one axis.
  The same captured-box resize path is used by the legacy transform fallback
  when a Desktop runtime rejects `relativeTransform`, so CSS scale and
  transform-origin handling cannot reintroduce a constrained-axis mismatch.
- Container compositing flags are rechecked at the same boundary: overflow,
  mask/clip paths and `contain: paint` restore `clipsContent`; `isolation:
  isolate` restores the native `NORMAL` stacking context; and captured borders
  keep `strokesIncludedInLayout` enabled where the host exposes it. This keeps
  clipping and border participation from drifting after fallback replacement
  or Auto Layout resizing.
  The import report exposes `lineHeightExpected`, `lineHeightApplied`, and
  `lineHeightFailures` so a Desktop run can distinguish a capture that carried
  no resolved text line boxes from a Figma write that was rejected or later
  normalized. `lineHeightFailureNodes` retains the affected layer ids and
  read-back error details. Repeated convergence passes also deduplicate
  successful writes by text-layer id and resolved value, so
  `lineHeightApplied` counts distinct verified text layers rather than retry
  attempts.
  `lineHeightReadBackNodes` records the final node-level and, when exposed,
  character-range-level descriptors (`unit` and numeric value) after the last
  Auto Layout settle. The plugin UI reports any mismatch between that final
  read-back and the captured pixel value instead of treating a stale
  node-level `PIXELS` result as proof that the editable range retained the
  requested leading.
  Pure CSS gradient fills also have a bounded SVG recovery path when Figma
  silently normalizes the native gradient paint. The fallback accepts the
  complete `background-image` layer list (including radial, conic, repeating,
  and multiple pure-gradient layers), rebuilds itself after a measured box
  resize or CSS paint change, and is explicitly disabled for mixed URL/image
  backgrounds so it cannot cover the image compositor with a duplicate
  gradient. If a compatibility bridge trims the normalized `gradient` field
  but keeps `backgroundImage`, the importer now reconstructs pure gradient
  paints from that complete list before deciding whether a visual fallback is
  needed.
  If a later capture removes the gradient or changes it to a mixed/solid
  background, geometry-only convergence removes the old complete-paint SVG
  sibling and restores the captured base fill instead of leaving stale paint
  over the new background. The semantic node retains a bounded recovery hint,
  so if a later responsive/state update returns to the same gradient while
  only the geometry synchronizer runs, the SVG sibling is recreated rather
  than silently leaving the restored solid paint as the only visible layer.
  Gradient fallback SVGs resolve `currentColor` with the same computed text
  color used by native gradient paints. The fallback metadata retains that
  resolved color, so a same-size theme/color change rebuilds the SVG instead
  of reusing a vector with stale stop colors.
  The same resolved value is used by SVG typography fallbacks when a Figma
  runtime rejects the native line-height write. Values smaller than the font
  size are preserved (for example `font-size: 20px; line-height: 12px`), so
  fallback baselines and vertical-writing advances do not silently expand
  compact CSS leading.
  Explicit sub-pixel line boxes are also retained through capture and H2D
  serialization down to a small positive `0.01px` floor, so values such as
  `line-height: 0.5px` are not rounded up to `1px` before import.
- CSS Anchor Positioning declarations (`anchor-name`, `anchor-scope`,
  `position-anchor`, `position-area`, `position-try`,
  `position-try-fallbacks`, `position-try-order`, `position-visibility`, and
  `inset-area`) are captured from computed styles and serialized into the H2D
  `data-open-canvas-anchor-positioning` marker. The plugin restores the values
  to `open-canvas-anchor-positioning` metadata on the corresponding Figma
  layer and preserves the browser's measured geometry. Figma has no native
  anchor-constraint equivalent, so the import report explicitly records this
  as a measured-geometry degradation; the metadata is an inspectable source
  contract, not a claim that the imported layer will reposition itself when
  its anchor changes.
- CSS Container Queries are likewise captured through `container`,
  `container-name`, and `container-type` computed styles. The H2D channel emits
  `data-open-canvas-container-queries`, and the plugin stores the resolved
  condition in `open-canvas-container-queries` while keeping the captured box
  authoritative. Figma has no native container-query evaluation, so responsive
  changes driven by an imported container's future size are not recomputed;
  the import report records this as a measured-geometry degradation rather
  than silently dropping the query condition.
- Absolute and viewport-root `fixed` layers with CSS `left`/`right`/`top`/`bottom`
  insets map to Figma `MIN`/`MAX`/`STRETCH` resize constraints. The standard
  CSS centering form (`left: 50%` plus a half-width negative translation, or
  the equivalent vertical form) maps to Figma `CENTER`; the importer verifies
  the transform is translation-only and matches half the captured box before
  enabling that responsive anchor. Rotated, skewed, or scaled variants remain
  on measured geometry. The decision is retained as `centeredByTransform` in
  the position-constraint metadata. The importer
  writes the constraints after the measured border box is created, reads them
  back, and repeats the check after Auto Layout and geometry convergence so a
  host normalization cannot silently remove the anchor. A rejected or
  read-only constraints API is reported as a style degradation and the raw
  inset relation remains in `open-canvas-position-constraints` plugin data.
  `sticky` layers with an active physical or logical inset remain metadata-only
  because Figma has no equivalent scroll constraint. A `sticky` declaration
  with every inset at `auto` is normalized to ordinary flow during capture and
  does not create a false degradation. If a reused layer later returns to normal flow
  or loses all active insets, importer-managed native constraints are reset to
  `MIN/MIN`; sticky layers keep their metadata while their native resize
  anchors are cleared.
  The plugin also checks logical `inset-inline-*` and `inset-block-*` markers
  when a compatibility bridge trims the physical `top/right/bottom/left`
  aliases, so a real sticky threshold cannot be mistaken for ordinary flow.
  Ancestor-scoped fixed layers carry the stable capture id of their
  transformed/contained ancestor. When that ancestor is present in the
  imported scene, the plugin reparents the fixed layer to the corresponding
  Figma Frame, applies its measured local offset, and enables native resize
  constraints relative to that Frame. A successful reparent is reported as
  native support rather than a degradation. If a trimmed or legacy payload
  lacks the containing-block id, the previous metadata-only behavior remains
  the safe fallback.
- Resolved `min-width`, `max-width`, `min-height`, and `max-height` bounds are
  also written with native read-back verification and rechecked after the
  final HUG/FILL and measured-geometry passes. Percentage, viewport,
  font-relative, `vw`/`vh` plus small/large/dynamic viewport units
  (`svw`/`svh`, `lvw`/`lvh`, `dvw`/`dvh`), `vmin`/`vmax`, `calc()`, `min()`, `max()`, `clamp()`, and numeric
  `fit-content()` expressions retain their captured resolution basis. If a
  Desktop runtime rejects or silently normalizes the native bound, the import
  report records a sizing fallback while the authored expression remains in
  `open-canvas-sizing-constraints` plugin data. Bounds that contradict the
  captured border box remain intentionally metadata-only so adding a native
  constraint cannot resize the imported page during creation. After both
  sizing APIs are absent, the importer records an explicit
  `native-*-min/max-unavailable` sizing fallback instead of silently dropping
  an authored CSS bound.
  sizing and position constraints are written, the importer waits for one
  host layout turn and runs a bounded final geometry audit/correction. This
  closes the late-reflow window in which a Desktop build could otherwise move
  a text block or border after the earlier convergence report had already
  passed. CSS `content-box` bounds are converted to Figma's border-box
  min/max fields by
  adding the captured padding and per-side border widths exactly once;
  explicit `border-box` bounds remain unchanged. This keeps responsive
  constraints aligned with the browser's used size instead of shrinking them
  by the container's inset.
- Auto Layout HUG/FILL/FIXED restoration now verifies the sizing mode itself,
  not only the resulting width and height. Figma runtimes that silently
  normalize a requested `HUG`/`FILL`/`FIXED` write are reported as sizing
  fallbacks and the captured dimensions are retained; this avoids claiming
  editable responsive intent when the node actually remained fixed.
  If a runtime does not expose the parent-facing or intrinsic sizing property
  needed for a non-fixed mode, the importer now reports an explicit
  `*-unavailable` sizing fallback and keeps the captured mode/expression in
  plugin data instead of silently presenting a fixed layer as responsive.
  The same read-back guard covers the native fixed-axis lock used for
  non-growing weighted shrink items. `flex-shrink: 0` instead uses its
  captured `min-width`/`min-height` guard and remains eligible for native
  HUG/FILL restoration; a rejected or silently ignored minimum is reported
  rather than allowing a later parent reflow to compress the item without an
  explicit diagnostic.
- Editable border and outline fallbacks are synchronized after every measured
  geometry correction. Per-side solid/3D layers, complete gradient,
  elliptical and double-border vectors, `border-image-outset`, and outside
  outline rings therefore follow the container's final corrected width and
  height, including the bounded correction that runs after the final native
  sizing/position constraints are written. This prevents a late Auto Layout
  resize from leaving a visually stale gradient ring, side border, or outline
  around an otherwise corrected frame. Complete SVG border/outline rings are
  regenerated from the source scene when the owning
  box changes size, rather than proportionally scaling an old vector and
  accidentally changing the authored stroke thickness or corner radii. These paint
  layers remain absolute and fixed-sized inside the owning frame, so the
  synchronization does not add an Auto Layout slot or change the captured
  border box. Border and outline fallback source signatures also include their
  resolved paints, styles, offsets, gradients, and radius axes. When a border
  gradient uses `currentColor`, the signature retains the resolved computed
  color and the SVG generator substitutes that same color before parsing the
  gradient stops. Same-size theme/state changes therefore rebuild the editable
  decoration instead of leaving a stale color or dash/ring geometry behind.
  Solid native strokes and per-side rectangle/SVG border fallbacks use the
  same resolved-color boundary, so a legacy `border-color: currentColor`
  record cannot be dropped by `parseColor` before it reaches Figma.
  The same resolved-color and source-signature path applies to legacy outline
  records that still contain a literal `currentColor`, so an editable outline
  ring is created and refreshed instead of disappearing or remaining stale.
  Replacement is transactional and matches the complete generated
  decoration-name set before removing old layers; partial SVG/rectangle
  creation restores the previous decorations and native strokes instead of
  leaving a missing side or a duplicate border.
- Visual fallback siblings for text overflow and legacy clipping are excluded
  from semantic child indexing. This keeps later line-height, sizing, and
  geometry verification attached to the intended layer even when a clipboard
  bridge omits the stable Open Canvas id metadata.
- SVG masks generated for CSS `clip-path`, elliptical radii, and supported
  `mask-image` layers receive the same final-size correction. When a host
  changes the owning frame's dimensions, a fresh mask is generated from the
  source geometry and replaces the old viewBox rather than stretching a stale
  mask; this keeps rounded corners, inset clips, and mask positioning aligned
  without entering the parent's Auto Layout flow. Mask replacement is atomic
  and restores every mask/background layer to its original sibling index, so
  a regenerated solid mask background remains behind editable content. If the
  host creates only part of the new mask stack, the partial layers and fill
  mutations are rolled back while the complete previous stack stays active.
  Complex frame `clip-path` masks also move a solid CSS background into a
  matching absolute SVG overlay and clear the native frame fill. A Figma mask
  clips sibling layers, not the frame's own native paint; without this extra
  overlay a polygon/path/circle clip would leave a rectangular background halo
  Legacy mask and clip siblings that lack the current source-signature marker
  are treated as stale once their source family is still active, so a same-size
  re-import upgrades them to the current source-aware lifecycle instead of
  preserving an unverifiable old shape.
  outside the CSS shape. The overlay is included in the same final-size
  regeneration and transactional rollback set. Gradient, image, and mixed
  background paints deliberately remain on their existing ordered fallback
  paths rather than being flattened into the solid-only overlay.
- SVG-backed background color, image, gradient, and mixed-layer fallbacks are
  also regenerated against the owning frame's final corrected dimensions and
  restored at their original stacking position. Replacement is transactional:
  the old complete background stack remains in place, and native fills are
  rolled back, when a resource failure produces only part of the expected new
  layer set. This prevents stale-size overlays, missing background layers, and
  double painting after Auto Layout or measured-geometry correction.
- Native `input`, `textarea`, and `select` controls export their currently
  painted value (or placeholder) as one editable text child inside the captured
  control frame. Password values are replaced with bullets, and `<option>`
  implementation descendants are not emitted as duplicate Figma layers.
- Common outside list markers (`disc`, `circle`, `square`, decimal, alphabetic,
  and Roman numbering) are emitted as independent editable text layers for
  `li` nodes. Outside `list-style-image` URLs are emitted as independent image
  layers when the asset can be resolved. Inside text markers are kept as
  independent layers at the measured content origin so they do not alter the
  editable body text.
  Ordered markers also honor `<ol start>`, `reversed`, and per-item `<li value>`
  numbering so the exported labels match the source sequence.
- Basic tables map `table`/section groups to vertical Auto Layout and `tr` rows
  to horizontal Auto Layout. CSS `border-spacing` becomes row/column gaps and
  table edge padding; complex spanning cells still retain measured geometry so
  editability does not introduce a second, incorrect grid reflow.
  `border-collapse: collapse` correctly disables synthesized spacing, and
  `rowspan`/`colspan` cells alone receive geometry locks while ordinary cells
  remain in the editable row flow.
  `caption-side: bottom` is also reordered to match the browser's rendered
  position rather than the DOM insertion order.
- Logical `text-align: start/end` values are resolved against the captured
  `direction` before crossing into Figma, so RTL text does not silently become
  left-aligned. The same physical alignment is promoted to H2D wrappers when
  direct text runs share one value.
- Non-horizontal `writing-mode`, non-default `text-orientation`, and
  non-normal `unicode-bidi` values remain in the captured computed-style
  metadata and are reported as explicit import degradations. For
  `vertical-rl` and `vertical-lr`, the plugin additionally creates an absolute
  SVG visual fallback with upright CJK/mixed-character handling while keeping
  the original TextNode as an editable semantic layer. The fallback does not
  enter Auto Layout flow and is synchronized during geometry convergence.
  Its source signature includes writing mode, text orientation, lines, font,
  color, leading, and opacity, so same-size vertical text updates rebuild the
  glyph columns rather than reusing stale SVG content.
  Figma's current TextNode API has no equivalent native vertical-writing or
  bidi-layout contract, so these cases are not claimed as native support.
  The plugin also carries declared `unicode-bidi` values and the inherited
  shaping values `text-wrap-style`,
  `font-optical-sizing`, `font-size-adjust`, `text-rendering`,
  `font-kerning`, `font-feature-settings`, and `font-variation-settings`
  through every H2D wrapper and anonymous TEXT_NODE where the CSS property is
  inherited. A bridge that trims the child style object therefore still
  produces the same explicit diagnostic on the final editable layer instead
  of silently resetting the run to horizontal/default shaping. `unicode-bidi`
  remains attached only to the node where it was declared because it is not a
  CSS inherited property. This is metadata/diagnostic coverage;
  it does not claim that Figma can natively reproduce those shaping modes.
  Chromium's user-agent `unicode-bidi: isolate` on ordinary block containers
  is normalized back to the default unless the page explicitly declares it
  (or uses the semantic `bdi` element). This prevents ordinary headings and
  paragraphs from activating unnecessary SVG shaping fallbacks.
- Text replay also preserves `white-space: pre-line` separately from `pre`:
  explicit line breaks remain editable while repeated spaces keep the source
  collapsing behavior, preventing text widths and wraps from drifting in Figma.
- CSS `word-spacing` is now captured as a resolved pixel value and retained in
  the H2D text style. The native plugin applies it to space-character ranges
  when the Figma runtime exposes range letter-spacing; otherwise the requested
  value remains in `open-canvas-word-spacing` plugin data and is reported as an
  explicit degradation instead of being silently dropped.
- Trimmed H2D text children also inherit `white-space`, `overflow-wrap`,
  `word-break`, `hyphens`, and `text-indent`; direct text runs map the latter
  to Figma paragraph indentation when that API is available, keeping wrapping
  and first-line offsets aligned with the captured browser layout.
- Inline text runs are split whenever font stretch/kerning/features/variation,
  text shadow, decoration paint/geometry, direction, writing mode, or wrapping
  properties differ;
  these distinctions otherwise change glyph width or line breaking while
  looking like the same surrounding text node.
- Non-default `font-optical-sizing`, `font-size-adjust`, `font-kerning`, and
  `text-rendering` values remain in computed-style metadata and are reported
  as explicit text degradations because the Figma TextNode API does not expose
  equivalent shaping controls.
- CSS `font-synthesis` and its `weight`, `style`, `small-caps`, and `position`
  longhands are captured on inline runs and inherited through trimmed H2D
  wrappers. Figma TextNode has no native synthesis policy, so non-default
  values are retained in the editable layer metadata and activate the same
  measured SVG text-shaping fallback that preserves the browser's glyph width,
  synthetic bold/italic policy, and line wrapping. The fallback remains an
  absolute visual sibling; the original TextNode stays editable and semantic.
- CSS `text-align-last` and `text-justify` are retained through capture,
  inherited H2D wrappers, and plugin scene reconstruction. Because Figma has
  no native last-line alignment or justification-method control, non-default
  values activate the measured SVG text fallback; each line uses its captured
  browser origin, so a centered/right-aligned final line or CJK
  inter-character justification does not drift while the editable TextNode is
  preserved underneath.
- CSS `font-stretch` now participates in native font resolution when the
  imported family exposes a matching Figma style (for example `Condensed`,
  `Semi Condensed`, `Expanded`, or `Wide`, including weight/style aliases).
  The selected width variant is recorded as `open-canvas-font-stretch-native`
  and is not reported as a degradation. If no matching installed style exists,
  the original stretch remains in the H2D/computed-style metadata and the
  existing explicit degradation is retained; the importer never substitutes a
  misleading font family or silently changes the captured text box.
- When Figma has no native TextNode shaping API for a non-default
  `font-feature-settings`, `font-variation-settings`, `font-variant-*`,
  `font-kerning`, `font-optical-sizing`, `font-size-adjust`, or
  `text-rendering`, or non-default `unicode-bidi` value, the importer creates an absolute SVG text-shaping
  visual fallback from the captured lines and style values. The original
  TextNode remains editable and semantic, the fallback does not consume an
  Auto Layout slot, and its geometry/visibility follows the same convergence
  passes as line-height and writing-mode fallbacks. The import report exposes
  `textShapingFallbacks`; the captured `direction` is carried into the SVG
  when a bidi fallback is required, and native font-stretch matches are
  excluded from this fallback path. When Auto Layout or a final geometry audit
  changes the captured text box, the shaping SVG is regenerated from the source
  glyph data instead of resizing the old vector; resizing would scale absolute
  glyph coordinates, font sizes, and stroke widths. Replacement is transactional:
  if Figma rejects the new SVG, the previous fallback remains visible and its
  geometry is retained for the next convergence pass. The same merged scene
  asset list is passed through line-height fallback creation and every later
  shaping rebuild, so text clipped to a captured image background does not lose
  its `<image>` paint when a native line-height write fails or a measured box
  changes. Shaping fallbacks also persist a source signature covering text,
  font features, clipping, masks, filters, background paints, and overflow;
  same-size content or style changes therefore trigger the same transactional
  rebuild path. Geometry synchronization also recreates the fallback when an
  earlier native-capability pass removed the old SVG sibling but a later
  update returns to an unsupported shaping state; a missing sibling is never
  treated as proof that the native text layer is sufficient.
- Non-default `font-variant`, `font-variant-caps`, `font-variant-numeric`,
  `font-variant-ligatures`, `font-variant-alternates`,
  `font-variant-east-asian`, and `font-variant-position` values now survive
  capture, inline-run splitting, H2D serialization, and plugin diagnostics.
  They remain metadata-only because Figma does not expose equivalent
  TextNode shaping controls, but they are no longer silently dropped.
- Text decoration now carries CSS `text-decoration-style`, color, thickness,
  and underline offset through the scene/H2D payload. Figma's current
  `TextNode` API can only apply one solid underline/strikethrough enum, so
  unsupported decoration geometry remains in `open-canvas-text-decoration`
  plugin data and is reported as an explicit degradation instead of being
  silently discarded. Captures also retain per-line Range rectangles for
  element-backed text; when those measurements survive the clipboard bridge,
  the plugin draws one editable SVG segment per visual line for custom-color,
  custom-thickness, offset, wavy/dashed/dotted, overline, and combined
  decorations.
- Non-default text wrapping controls (`white-space`, `overflow-wrap`,
  `word-break`, `hyphens`, and Text Level 4 wrapping/whitespace fields) are
  duplicated in `data-open-canvas-text-wrapping`. The plugin uses this marker
  only when the replay/computed style channels are missing or still at their
  browser defaults, so a trimmed bridge cannot silently change line breaks or
  text container height.
- Authored CSS `aspect-ratio` is retained in plugin data and applied as a
  Figma proportional-resize constraint after the captured border box is set.
  H2D also duplicates the value in `data-open-canvas-aspect-ratio`, allowing
  the plugin to recover the ratio when a clipboard bridge trims replay styles
  (the same default-aware precedence used by min/max sizing markers).
  The native `constrainProportions` write is read back; runtimes that expose
  the property but normalize it back to `false` now produce an explicit
  import-report degradation instead of silently claiming the constraint was
  preserved.
- Absolute and fixed layers now map their captured CSS
  `left/right/top/bottom` inset relationship to Figma `MIN`, `MAX`, or
  `STRETCH` constraints without changing the initial measured coordinates.
  Absolute layers use their containing block. Viewport-fixed layers are
  promoted to the imported root and use the viewport-root coordinate space.
  Fixed layers owned by a transformed, filtered, contained, or `will-change`
  ancestor keep their measured nested geometry and containing-block offset;
  Figma has no native equivalent for that reference space, so the importer
  retains it as metadata and reports a constraint degradation instead of
  assigning misleading root-relative constraints. The raw inset values and
  reference space remain in `open-canvas-position-constraints` plugin data
  when a Figma runtime cannot accept native constraints. Sticky layers retain
  their scroll-container reference as metadata but do not receive resize
  constraints, because Figma constraints cannot reproduce a scroll threshold.
  Final constraint verification uses the same captured width/height expression
  as creation: a fixed-size layer with both axis insets remains anchored to
  `MIN`/`MAX` instead of being rewritten to `STRETCH` after Auto Layout
  settles. Compatibility inset reset keywords (`initial`, `unset`, `revert`,
  and `revert-layer`) are treated as inactive/`auto`, so they also clear stale
  managed resize constraints on reused nodes. If a compatibility bridge trims
  both the shared layout object and the width/height expression attributes, the
  H2D-only parser can recover an explicit positioned size from the replay CSS.
  Pixel values are accepted only when they differ from every plausible
  dual-inset auto-stretch size (including content-box padding and borders), so
  a measured `width/height: auto` box is not mislabeled as fixed. Values found
  only in the computed-style channel remain measurements and never become
  authored size expressions.
- `position: sticky` keeps its measured position in the initial viewport so the
  exported result remains visually aligned. The H2D payload now carries the
  original positioning value beside the measured absolute snapshot, while the
  importer reports an explicit constraint degradation because Figma has no
  scroll-linked sticky behavior to inherit after paste.
  A sticky declaration with no active physical or logical inset is normalized
  to ordinary relative flow before serialization. CSS does not establish a
  sticky threshold in that case, so keeping the layer inside Figma Auto Layout
  is more faithful than creating an unnecessary absolute measured snapshot;
  only sticky layers with an actual inset remain on the explicit degradation
  path.
- `scroll-snap-type`, `scroll-snap-align`, `scroll-snap-stop`,
  `scroll-behavior`, and `overscroll-behavior` values are retained in computed-style metadata and
  `open-canvas-scroll-constraints` plugin data. The H2D payload also carries a
  `data-open-canvas-scroll-constraints` marker so trimmed clipboard styles can
  be recovered before the plugin writes the metadata. They are reported as
  explicit constraint degradations because Figma has no equivalent scroll
  container model; the captured initial geometry remains unchanged.
- CSS `background-position` and `object-position` edge-offset syntax is
  normalized before creating Figma image paints, including forms such as
  `right 10px bottom 5px` and `left 12px top 4px`; offsets are resolved
  against the captured container dimensions instead of being dropped as
  unknown keywords. Negative and over-100% length-percentage positions, plus
  parenthesized `calc()`/`min()`/`max()`/`clamp()` offsets, are retained rather
  than clamped to the container edges. The shared SVG positioning path also
  preserves CSS's one-value grammar: a lone length, percentage, or function is
  the horizontal coordinate with the vertical axis centered, while `top` and
  `bottom` select the vertical axis. This applies consistently to background,
  object-fit fallback, and mask image positioning.
- Background image and mask dimensions now resolve CSS length-percentage
  functions (`calc()`, `min()`, `max()`, and `clamp()`) with parentheses-aware
  tokenization. Position offsets preserve negative free space and resolve
  percentages against the CSS positioning area, so oversized images and
  expressions such as `calc(50% - 10px)` keep their captured focal point.
  Authored `em`/`rem`, absolute CSS units, and viewport-relative lengths are
  resolved with the captured element/root font and viewport context across
  `background-size`, `background-position`, `object-position`, and their SVG
  fallback paths; they are no longer silently discarded when a compatibility
  bridge retains authored values instead of computed pixels.
- Oversized images now retain negative overflow during `object-position` and
  background positioning. Center/right/bottom crops therefore use the same
  focal point as CSS instead of being clamped to the container's top-left.
- CSS `background-attachment: fixed/local` is retained on the scene/H2D node
  and in `open-canvas-background-attachment` plugin data. Because Figma has no
  equivalent scroll-linked background coordinate system, the importer reports
  an explicit degradation instead of silently treating it as an ordinary
  scrolling background. Multi-layer default values such as `scroll, scroll`
  are normalized away and do not produce metadata or a false degradation.
- Bitmap backgrounds using CSS `background-repeat: space` or `round` are
  measured against the captured container and emitted as clipped SVG image
  overlays, preserving the computed tile count and spacing instead of
  approximating them with Figma's native `TILE` paint. URL-only multi-layer
  backgrounds are composed into one ordered SVG overlay so each layer keeps
  its own size, position, repeat axes, CSS front-to-back order, and
  `padding-box`/`content-box` clip. When those image layers use supported
  non-normal blend modes, they are emitted as back-to-front image overlays so
  each mode remains attached to the correct layer. Mixed gradient/URL cases
  with a clip, and mixed gradient/URL stacks that use measured `space` or
  `round` image repetition, are also composed into a clipped ordered vector
  fallback when their layers can be serialized; unsupported blend modes or
  unresolved assets remain explicitly diagnostic instead of leaking native
  border-box paints.
- CSS `image-set()` layers keep one source layer in the H2D/resource mapping.
  The plugin selects the closest available density at the capture's
  `devicePixelRatio` (preferring the smallest candidate at or above the
  capture density, then the highest available candidate), while retaining the
  original declaration in scene/plugin metadata. Legacy payloads without DPR
  metadata use DPR 1 and preserve the previous first-candidate behavior when
  no density descriptor is present. The same selection is applied to captured
  `border-image` sources, so high-density borders do not silently fall back to
  the first low-resolution candidate. Mask-image compatibility styles and
  complex SVG background fallbacks use the same selected source as well.
- Image SVG fallbacks used for unsupported CSS filters, `clip-path`,
  `mask-image`, and `object-fit: none`/`scale-down` are tagged with their
  asset, fallback kind, and source geometry. CSS polygon, circle, ellipse,
  inset, rect, xywh, and supported `path()` clips are baked into the image
  vector so the imported bitmap does not silently lose its crop. Gradient and
  URL masks with supported position/size/repeat/origin/clip settings are
  embedded as SVG alpha/luminance masks; supported image filters are composed
  into the same fallback instead of replacing the mask. If a later Auto Layout
  or measured-geometry pass changes the final image box, the plugin rebuilds
  the SVG with the new `viewBox`, clip/mask geometry, object-position, and
  intrinsic image placement, then restores the original sibling slot and
  editable-layer metadata. It does not stretch the old fallback across a new
  aspect ratio; failed regeneration keeps the prior vector intact. A
  fallback replacement also preserves `constrainProportions` and authored
  aspect-ratio plugin metadata, applying the proportion lock only after the
  exact source dimensions are written so replacement creation cannot change
  one axis of the captured box. It also restores the source `relativeTransform`
  and rotation after sizing, so a fallback rebuild cannot silently lose CSS
  scale, rotation, or transform-origin placement. A
  successful image fallback is excluded from the clip-path/mask degradation
  report; unsupported shapes, composite modes, or missing assets remain
  explicit diagnostics.
- Overflow values that establish a CSS scrolling/clipping viewport (`hidden`,
  `clip`, `auto`, `scroll`, and `overlay`) map to Figma `clipsContent`, so
  descendants do not visually bleed beyond the captured container bounds.
- Legacy CSS `clip: rect(top, right, bottom, left)` is retained in the H2D
  replay styles and, on the plugin path, converted to an absolute editable
  SVG vector mask. This preserves the inset clipping rectangle without
  changing the captured frame size or Auto Layout slot; `auto` edges and
  percentage/px coordinates are resolved against the imported frame bounds.
- CSS `overflow-clip-margin` and its logical longhands (`block`, `inline`, and
  the four start/end directions) are retained through the computed-style and
  visual constraint channels. The shorthand remains available as
  `open-canvas-overflow-clip-margin`; logical values are additionally written
  as `open-canvas-overflow-clip-margin-logical`. For an otherwise uncomplicated
  `overflow: clip` frame, the plugin creates an absolute editable SVG mask
  expanded by the resolved physical top/right/bottom/left margins and disables
  the frame's native `clipsContent`, preserving content that paints past the
  frame edge without changing its Auto Layout slot. The fallback supports
  absolute, font-relative, percentage, and captured viewport units plus
  `calc()`/`min()`/`max()`/`clamp()` expressions, and maps RTL and vertical
  writing modes to physical sides. Frames that already use `clip-path`, legacy `clip`,
  CSS masks, or elliptical/two-axis corner radii keep their existing clipping
  stack and retain the exact values as an explicit degradation. Simple
  circular corner radii, including `em`/`rem` and functional values recovered
  from a trimmed H2D payload, are composed into the same expanded mask, so the
  overflow edge and rounded corners remain one clipping primitive.
  When a later capture returns to the default `0px` margin, both clip-margin
  plugin-data channels are cleared during visual-constraint convergence along
  with the expanded mask, preventing stale clip evidence on reused nodes.
- CSS `contain: paint`, `contain: strict`, and `contain: content` map to Figma
  `clipsContent`, preserving the visual subtree clipping boundary even when
  the source keeps `overflow: visible` (the latter two shorthands include the
  CSS paint-containment component).
  Every non-`none` containment value is also serialized as a compact
  `data-open-canvas-containment` H2D marker and retained on imported nodes as
  `open-canvas-containment`, including the authored tokens and measured border
  box. Other containment modes (`layout`, `size`, and `style`) are reported as
  explicit constraint degradations because Figma has no equivalent subtree-
  containment contract; retaining the marker makes that loss inspectable and
  prevents a trimmed clipboard bridge from silently dropping the source
  constraint. If such a bridge leaves `contain: none` in its computed-style
  map while preserving the authored marker, the marker now wins over that
  default so the constraint is not downgraded during plugin reconstruction.
  In the Open Canvas Importer path,
  `content-visibility: hidden` is the supported exception: it keeps the
  measured layout box while importing the layer as hidden (and retains an
  inspectable plugin-data marker). `auto` and other deferred-paint values
  remain explicit degradations rather than being treated as ordinary
  responsive frames; native H2D handling still requires Figma Desktop
  verification.
- CSS `visibility: hidden/collapse` keeps its measured layout slot during
  capture (including collapsed table/flex/grid items), while compatibility
  payloads map both values to Figma `visible=false`; only `display:none` is
  removed from the captured layout tree.
- Authored CSS `min/max-width/height` values are retained in
  `open-canvas-sizing-constraints` plugin data, including percentage values.
  The H2D payload now also carries these bounds in a dedicated
  `data-open-canvas-sizing-constraints` marker. If a bridge trims the replay
  style map or leaves `auto`/`none` defaults behind, the plugin restores the
  non-default marker values before inferring FILL/HUG and applying native
  pixel bounds.
  The capture now reads the winning inline, stylesheet, media-query, and
  `!important` declaration (rather than only the computed pixel value), so
  `calc()`, `clamp()`, and percentage bounds survive the browser-to-Figma
  boundary;
  the native numeric min/max fields still receive the current captured pixel
  equivalent because Figma's native constraint API is pixel-based. For the
  imported root, percentages resolve against the captured viewport when no
  parent scene is available. Common `calc()`, `min()`, `max()`, `clamp()`, and
  viewport/absolute CSS length expressions are resolved against the captured
  parent geometry; `vw/vh/vmin/vmax` always use the captured visible viewport
  (`viewportRect`), not a long page's full scroll height, even for deeply
  nested children. `em` uses the captured node font size and `rem` uses the
  captured root font size, while the original expression remains inspectable.
  When a resolved CSS pair is over-constrained (`min-* > max-*`), the plugin
  applies the CSS used-value rule that lets the minimum win, preventing Figma
  from receiving contradictory numeric bounds.
  Parameterized `fit-content(<length-percentage>)` caps are resolved to native
  numeric max bounds; the bare intrinsic keyword remains metadata-only because
  Figma has no equivalent content-measurement function.
  Final sizing verification uses the same extracted absolute endpoints as the
  creation pass. If Figma normalizes a `clamp()` minimum/maximum or a
  `fit-content()` cap while Auto Layout settles, the importer now restores it
  instead of accepting an unconstrained node. Explicit bounds still win, so
  `min-width: 0` is not replaced by the minimum branch of a width expression.
  Compatibility reset keywords (`initial`, `unset`, `revert`, and
  `revert-layer`) are treated consistently with omitted/default min/max
  declarations, so they cannot mask those retained expression endpoints.
  Reused/imported nodes also synchronize this contract on every final sizing
  verification pass: when a later capture removes a `min-*`/`max-*` bound, the
  importer resets the corresponding native Figma field to its unconstrained
  default (`0`/`Infinity`) and clears stale plugin metadata. When only one side
  remains, the other side is cleared without disturbing the current bound;
  changed responsive expressions clear obsolete endpoints before applying any
  newly resolvable absolute bounds.
  The final bounded typography settle is followed by one last sizing and
  position-constraint verification, so a host-side reflow triggered by the
  last text write cannot silently discard the responsive bounds or absolute
  inset relation immediately before the imported page is exposed.
  After that verification, the importer performs a bounded frame-only HUG/FILL
  replay and settled geometry audit. This closes the opposite ordering gap:
  a late measured correction can temporarily freeze a flexible frame axis to
  FIXED even when its captured geometry is still compatible with Auto Layout.
  The replay never changes text auto-resize or line-height, and only retains a
  fixed fallback when restoring the authored mode would genuinely change the
  captured box.
  Text nodes now reapply their captured pixel line-height immediately before
  each HUG/FILL size measurement and immediately after `textAutoResize` writes,
  because Figma Desktop can normalize the range back to AUTO at either point.
  This prevents a temporary AUTO leading value from making a multiline layer
  appear shorter and causing an otherwise compatible height axis to be frozen
  as FIXED. Sizing fallback diagnostics are also keyed by source node, axis,
  property, requested mode, and captured box, so repeated bounded convergence
  passes report one underlying fallback rather than inflating the count with
  duplicate observations.
  Synthetic measured layers created for a geometry-locked child are also
  eligible for a final per-axis HUG/FILL replay when the source child was
  ordinary flow content. Native CSS absolute/fixed/sticky layers remain fixed
  by design. The replay is accepted only when the measured width/height stays
  within the flexible-layout tolerance; otherwise that axis is immediately
  restored to FIXED and the fallback is recorded. If the rejected write also
  remeasures the opposite axis, the fallback resizes the complete captured
  border box so a cross-axis text-wrap change cannot leak into the final
  visual geometry.
- Nested Auto Layout restoration keeps child `FILL`/`HUG` intent when the
  measured box remains stable, while content-box min/max bounds include the
  child padding and border exactly once. A reflow or host rejection falls back
  to the captured fixed box and records a sizing fallback instead of silently
  dropping the authored responsive metadata.
- Flex/Grid sizing intent also consults CSS Typed OM when the browser exposes
  it. Stylesheet and media-query sizing declarations retain their authored
  width/height expression beside the measured pixel box. A full `100%` size or
  real `flex-grow` maps to Figma Fill; partial percentages such as `50%`, and
  functional or viewport-relative expressions such as `calc(...)`/`vw`, stay
  at the captured size in the native plugin because Figma Fill would
  incorrectly stretch them to the parent's entire remaining axis. The H2D
  clipboard channel now replays non-intrinsic authored expressions on ordinary
  flow containers, while absolute/fixed/sticky and visual-snapshot layers stay
  pinned to their measured pixel box. The original expression is also carried
  in H2D attributes, layout metadata, and `open-canvas-responsive-sizing`
  plugin data, and the importer reports this native-constraint limitation
  explicitly. For functional size expressions, the importer additionally
  extracts only stable absolute endpoints into native `minWidth`/`maxWidth`
  or `minHeight`/`maxHeight` when the corresponding CSS bound is otherwise
  unset (for example `clamp(240px, 60%, 420px)` contributes 240/420px, while
  its percentage branch remains metadata-driven). This improves edit-time
  protection without pretending that Figma can evaluate the percentage or
  viewport branch responsively.
  Fixed lengths and intrinsic `auto`/content sizing keep their existing modes.
  Logical sizing declarations are covered as well: `inline-size`/`block-size`
  and their `min-`/`max-` variants are mapped to the physical Figma width and
  height axes according to the captured `writing-mode`. Horizontal writing
  maps inline to width and block to height; vertical/sideways writing swaps
  those axes. The authored logical token is retained for the same HUG/FILL and
  responsive-constraint decisions, so vertical layouts do not silently become
  fixed pixel boxes after the H2D boundary.
  Flex container direction follows the same writing-mode mapping: in vertical
  or sideways writing, CSS `row` uses the physical vertical inline axis and
  `column` uses the horizontal block axis; the H2D-only parser and capture
  path preserve that orientation in Figma Auto Layout.
  Physical `auto`/`none`/`normal` defaults do not mask a non-default logical
  declaration discovered from the stylesheet or Typed OM, so a reset rule
  cannot accidentally erase the active logical responsive contract.
  Logical `padding-*` and `margin-*` edges are likewise mapped to physical
  Auto Layout top/right/bottom/left edges using `writing-mode` and `direction`,
  including RTL and `vertical-rl`/`vertical-lr` flows. Absolute logical
  lengths use the captured computed value. When a pure/trimmed H2D payload
  retains authored values instead, absolute and font-relative units, captured
  viewport units, percentages, and `calc()`/`min()`/`max()`/`clamp()` are
  resolved before Figma Auto Layout is created. Percentage padding and margin
  use the containing block's inline size, including the physical height for
  vertical/sideways writing modes; negative margin remains valid while padding
  is kept non-negative. The resulting pixel edges are also used for content-box
  gap references and nested containing blocks, so relative padding cannot
  shift children or distort later size constraints. Engines that expose unused logical
  longhands as default `0px` do not activate the remap unless a logical rule
  is authored or a non-default logical used value is present, preserving
  legacy physical padding and margin declarations.
  Physical `padding`/`margin` shorthands and logical `padding-inline`/
  `padding-block` (and corresponding margin shorthands) are expanded to their
  four edge values before this remap. This keeps authored asymmetric spacing
  intact even when a browser or compatibility bridge exposes one shorthand
  token through every computed longhand.
- Logical positioning insets (`inset-inline-*` and `inset-block-*`) use the
  same writing-mode/direction mapping for measured offsets and the serialized
  `positionOffsetExpression` constraint. RTL and vertical positioned layers
  therefore retain their authored edge anchor instead of silently falling
  back to physical `left/top` defaults. The `inset-inline`, `inset-block`, and
  physical `inset` shorthands are expanded for metadata as well, so authored
  percentages and `calc()` expressions remain inspectable after paste.
  The plugin also rematerializes missing physical edges from logical longhands
  when a compatibility bridge trims the browser-resolved `left/top/right/bottom`
  values, so the native Figma MIN/MAX/STRETCH constraint pass still receives the
  correct edge relation for RTL and vertical writing modes. Physical `inset`
  and logical `inset-inline`/`inset-block` shorthands are expanded at the same
  boundary before that mapping, while explicit longhands and physical edges
  retain precedence. The capture computed-style channel now preserves
  non-default logical inset longhands instead of dropping them as unknown CSS
  properties, so this recovery remains available on the native H2D path too.
  The same values are read explicitly through `getPropertyValue()` when a
  compatibility bridge exposes no enumerable style declarations. Physical
  inset aliases, `position`, `direction`, and `writing-mode` use the same
  explicit read path, preventing a trimmed style map from losing the anchor
  reference itself. Core Auto Layout declarations (`display`, `box-sizing`,
  `width`/`height`, `gap`, flex direction/wrap, alignment, and `order`) use
  the same explicit reads, so a non-enumerable compatibility payload retains
  editable layout intent as well as its measured geometry.
- CSS `border-image` gradients are retained even when the browser reports the
  gradient on a non-top border side; the H2D and native plugin paths use the
  first gradient-bearing side as the shared border paint source.
- Native solid and dashed/dotted strokes now use the captured painted width
  (`paintWidth`) when `border-image-width` changes the visual thickness without
  changing the layout border width. Per-side stroke weights and dash rhythms
  therefore match the rendered border instead of reverting to the thinner CSS
  layout width.
- Non-repeating CSS `conic-gradient()` border-image paints map to Figma's
  angular gradient stroke with the captured center, start-angle rotation, and
  stop positions. Because Figma has no native angular spread mode, repeating
  conic border-image paints use an editable clipped SVG sector ring that
  preserves the captured repeat cycle instead of falling back to a solid color.
- Conic border-image paints on elliptical radii now use the editable SVG ring
  path and clipped angular sectors, preserving the two-axis corner geometry
  instead of falling back to Figma's circular stroke radius.
- Gradient borders with asymmetric side widths use an editable SVG vector
  fallback so Figma runtimes that only expose one uniform stroke weight do not
  collapse the captured border geometry.
- Legacy or trimmed compatibility scenes that retain only one uniform `stroke`
  now use that stroke as the source for all four visual sides when the explicit
  `borders` array is empty or contains only zero-width/`none`/`hidden`
  placeholders. Solid strokes remain native; complex styles such as `double`
  use the same editable SVG boundary as a full four-side scene. The fallback
  also participates in the capability report, so a successfully reconstructed
  stroke-only border is no longer misreported as unsupported.
- Import diagnostics run after border and outline decoration creation. A
  successfully reconstructed `double`, `inset`, `outset`, `ridge`, or `groove`
  boundary is therefore evaluated from the final editable Figma tree rather
  than from the incomplete pre-decoration node.
- Uniform solid borders with two-axis elliptical radii now use an editable SVG
  border ring with an inset inner ellipse. This keeps the border geometry
  aligned with the elliptical background clip and avoids Figma's circular
  corner-radius API flattening the vertical radius; the native stroke is
  cleared so the ring is not painted twice.
- `background-clip: text` no longer triggers a full-box SVG background fallback;
  gradient text remains an editable text scene so the native gradient paint can
  be applied to the glyph layer, including when a background color is also
  present in the source CSS. A transparent text color with a solid clipped
  background is promoted to that background color as the editable glyph fill,
  instead of becoming invisible after paste.
- Complex gradient borders (`double`, `inset`, or `outset`) do not receive
  solid decoration layers on top of the gradient paint; they use the vector
  fallback when available and otherwise keep the native gradient stroke intact.
  The native stroke is cleared only after the SVG replacement is successfully
  created; if a Figma runtime exposes SVG creation but rejects the complex path,
  the original gradient remains visible instead of being cleared into a blank
  border.
- Gradient-only CSS backgrounds use an SVG fallback with capture-size-aware
  radial geometry, including explicit centers and `closest/farthest` side or
  corner sizing, instead of a fixed-radius approximation; rounded captured
  containers now clip that vector background to the same corner path. Explicit
  centers accept percentages, pixel coordinates, and CSS edge-offset forms
  such as `at right 20px bottom 10px`; the native Figma paint and SVG fallback
  resolve them against the same captured paint-box dimensions. Parenthesized
  `calc()`/`min()`/`max()`/`clamp()` coordinates are tokenized without splitting
  their inner whitespace and resolve mixed percentage/length centers before
  the paint is created. Negative and over-100% centers remain outside the paint
  box instead of being clamped to its edge; `closest-side` and ellipse radii use
  absolute edge distances so an external center never produces a negative
  radius.
- CSS `conic-gradient()` backgrounds are captured as a centered,
  start-angle-aware set of editable SVG sectors, preserving the color sweep for
  dashboards, progress rings, and other angular fills. Repeating conic layers
  use cyclic stop sampling so the final sector wraps back to the first without
  dropping the repeated paint. When a repeating conic layer is mixed with
  embedded URL backgrounds, the plugin composes both into one clipped editable
  SVG overlay so the URL layers are not painted above or instead of the angular
  sectors. Conic-only backgrounds on elliptical-radius frames use the same
  clipped sector overlay, preventing the native angular fill from leaking
  outside the two-axis corner path.
  Linear and conic gradient angles are normalized across the CSS `deg`, `turn`,
  `grad`, and `rad` units in both the capture-side SVG fallback and the native
  Figma paint path. Equivalent angles therefore produce the same gradient
  transform instead of falling back to the default vertical direction.
- SVG-backed background layers honor `background-clip: padding-box` and
  `content-box` by shrinking their clip path by the captured border and
  padding widths; `background-clip: text` remains on the editable text path.
  The plugin degradation report does not count the supported padding/content
  variants as losses; unsupported text clipping without a recreated gradient
  remains explicit.
- Solid `background-color` paints use the same rounded inset overlay for
  `padding-box` and `content-box`, and the full border-box SOLID paint is
  removed so the clipped color is not drawn twice or into the border area.
- Single embedded URL backgrounds with a clipped solid color are composed into
  one SVG layer (color first, image second, shared rounded clip), preserving
  both CSS paint order and the inset without introducing an overpainting layer.
- That composed URL path uses CSS's `0% 0%` default background position instead
  of the centered default used by Figma image paints.
- Measured `background-repeat: space/round` layers remain on their dedicated
  tile-count and gap-preserving SVG path instead of using the generic URL
  compositor; URL-only multi-layer variants use a single ordered vector
  overlay to avoid child-overlay z-order inversion. Multi-image stacks with
  `padding-box`/`content-box` use the same clipped ordered path, and mixed
  gradient/URL stacks use it when their gradients and assets can be serialized.
- Single URL layers resolve `background-origin` independently from
  `background-clip`, so content-box/padding-box positioning areas do not get
  mistaken for the final visible clip region.
- The measured `space/round` image-repeat fallback resolves tile counts,
  spacing, and pattern origin against the same background-origin box. When a
  `space` axis can fit only one tile, the fallback keeps a full-origin pattern
  period and positions that one tile instead of accidentally repeating it.
- Explicit-size background images without an authored position now preserve
  CSS's top-left `0% 0%` default instead of Figma's centered image default.
- Native gradient and border fallback parsing accepts hex, RGB/RGBA, HSL/HSLA,
  alpha percentages, common named colors, and hue units used by CSS gradients.
- Uniform rounded `outset`/`inset` borders use one editable SVG vector overlay
  with a rounded inner cutout when the Figma runtime exposes SVG node creation;
  older runtimes fall back to the existing editable side rectangles.
- CSS `outline` and `outline-offset` are captured separately from borders and
  imported as an absolute editable decoration, so focus rings preserve their
  outside-only geometry without changing the Auto Layout border box. Solid
  rounded outlines use an SVG ring; dashed and dotted outlines use Figma's
  native dash pattern when available. `inset`, `outset`, `ridge`, and `groove`
  outlines use non-overlapping, per-side shaded vector rings; ridge/groove
  split the thickness into inverse light/dark halves while remaining outside
  the captured layout box. The same fallback now preserves elliptical
  horizontal/vertical corner radii instead of collapsing them to circular
  Figma radii. Dashed and dotted elliptical outlines use an SVG elliptical
  path with the requested dash pattern, rather than a circular native stroke;
  dotted outline paths use round caps to retain circular dots for both circular
  and elliptical corners, and double outlines use the same two-axis geometry
  for both separated rings.
- Mixed `solid`/`dashed`/`dotted` border styles are kept per side with one
  editable SVG vector fallback instead of applying one global Figma dash
  pattern to all four sides. The same per-side path now follows rounded
  corners, so a mixed-style rounded card does not fall back to the first
  side's pattern or lose its corner geometry. Dotted paths use round caps so
  each dot keeps the browser's circular appearance; dashed and solid paths
  retain square caps. Its path insets, stroke widths, and dash intervals use
  each side's painted width, so `border-image-width` cannot leave the vector
  centered on the thinner layout-border geometry.
  Uniform dotted borders with elliptical corner radii use this same path even
  when their four sides are otherwise identical; the native circular-radius
  stroke is not allowed to flatten the captured horizontal/vertical radii.
- Dashed and dotted border/outline rhythms scale with the captured painted
  thickness (`[6,4]` and `[1,3]` at a 1px base), including native Figma
  `dashPattern`, per-side SVG paths, and elliptical outline fallbacks. This
  prevents 2px/3px borders from becoming visually over-dense or over-sparse
  after import while preserving the authored stroke width.
  When dashed/dotted sides have different widths or colors, the importer now
  selects the per-side SVG path even if all four sides share the same style;
  a single native Figma dash pattern can no longer flatten those differences.
- Uniform `ridge` and `groove` borders use one editable two-ring SVG boundary,
  preserving their raised/recessed light direction and rounded joins. Mixed
  colors, asymmetric widths, and runtimes without SVG creation retain the
  eight editable shaded-strip fallback instead of flattening to a solid color.
  A successful two-ring vector is no longer reported as a border degradation;
  strip fallback remains explicit in the import diagnostics.
- `currentColor` in box-shadow and text-shadow declarations resolves against
  the captured element color before the Figma paint/effect is created, avoiding
  an unintended black-shadow fallback.
- Box-shadow and text-shadow color extraction also preserves balanced CSS Color
  4 functions such as `color(display-p3 ...)`, `oklch(...)`, and nested
  `color-mix(...)` stops. The capture boundary no longer mistakes commas or
  nested parentheses inside those paints for separate shadow layers; the
  plugin then converts the supported color into the sRGB paint space used by
  Figma while retaining the original CSS string in the H2D channel.
- Shadow offsets, blur radii, spread values, and `filter`/`backdrop-filter`
  blur radii use the same CSS length resolver as other visual boundaries.
  Absolute units, font-relative units, captured viewport units (including
  `sv*`, `lv*`, and `dv*`), and `calc()`/`min()`/`max()`/`clamp()` resolve to
  pixels before a native Figma effect or SVG fallback is created. Negative
  offsets and box-shadow spread remain valid, while negative blur, percentages,
  non-zero unitless lengths, `inset` text/drop shadows, and drop-shadow spread
  are rejected instead of being misread by `parseFloat`. Legal two-length
  box/text/drop shadows now import with a zero blur radius. The pure H2D path,
  shared-scene path, native effects, image/text filter SVGs, and shadow SVG
  fallback all receive the same font/root/viewport context, so a value such as
  `1em` cannot become `1px` only on one import path.
- Native shadow, filter, and blur effects are applied through a guarded
  read-back path. The verifier compares effect type, blur radius, shadow
  offset, color/alpha, blend mode, visibility, and `spread`, so a Desktop runtime that accepts a write
  but silently normalizes its geometry is treated as a fidelity failure rather
  than a successful native effect. If a runtime rejects one optional effect
  field (for example `spread`), the importer retries the remaining effects individually,
  keeps the accepted native effects, and records the rejected CSS source and
  field in `open-canvas-effects-css` plus the import degradation report. A
  single unsupported effect therefore cannot abort the complete page import or
  disappear without an explanation. If a later convergence pass accepts the
  complete effect array natively, the stale CSS degradation marker is cleared;
  newly detected unparsed layers remain retained instead of being erased by
  that cleanup.
- When a runtime has no native `effects` API, rejects the parsed shadow, or
  only exposes an unparseable/partial `box-shadow`, the importer now creates
  an editable SVG shadow sibling. The fallback uses alpha/composite filters
  for outer, `inset`, and parsed `filter: drop-shadow(...)` layers, preserves
  the captured box dimensions, follows the element's rectangular or
  elliptical corner radii, applies the element's effective `opacity` including
  `filter: opacity(...)`, is rebuilt after a final Auto Layout resize or CSS
  opacity change, and is excluded from semantic child indexing so it cannot
  disturb later geometry or constraint passes.
- Geometry-only convergence passes now remove an old SVG shadow sibling when
  the current capture no longer contains a box-shadow or filter drop-shadow;
  the same lifecycle cleanup removes stale border and outline siblings when
  all four captured border sides or the outline are explicitly cleared. This
  prevents a reused/imported node from retaining visual paint from an earlier
  style state after responsive sizing or a second export. The shadow node also
  retains a recovery hint while native shadow effects remain suppressed, so a
  later source-state re-addition observed by geometry-only synchronization
  rebuilds the editable SVG sibling instead of dropping the shadow entirely.
  Complex border and outline decorations retain the same recovery contract:
  after a cleared responsive state, a returning gradient/asymmetric border or
  outline is rebuilt by the geometry synchronizer, while a newly native-simple
  border clears the hint and stays on Figma's native stroke path.
- The same effect boundary reports runtimes that expose no `effects` property
  and shadow layers whose color grammar cannot be parsed. Unknown CSS variables
  or color functions are no longer converted into an invented black shadow;
  the original declaration remains inspectable in plugin data and the import
  report identifies the unparsed layer.
- H2D-only or trimmed payloads that retain `box-shadow` CSS but lose the
  resolved `shadow` scene field now reconstruct native effects from that raw
  declaration. If reconstruction is incomplete, the missing layer count and
  original source are reported rather than treating the layer as successfully
  imported.
- `filter: drop-shadow(...)` now has the same parse-completeness check as
  `box-shadow` and `text-shadow`. A supported function name is not counted as
  success when its color grammar cannot be resolved; native-effect and SVG
  fallback paths retain the original filter and report the exact unparsed
  layer instead of silently omitting it.
- `currentColor` in outline colors is resolved from the effective inherited
  text color at the H2D boundary as well, including trimmed child payloads;
  editable outline rings therefore retain the authored color instead of
  falling back to black.
- Text nodes that use both CSS `box-shadow` and `text-shadow` retain both
  effect families in the imported Figma `effects` array; the text-shadow path
  no longer replaces a valid box shadow. If a box/filter shadow requires the
  SVG fallback after a partial native write, only those shadow slots are
  removed so a valid text-shadow is not double-painted or discarded. Repeated
  visual passes also clear effect arrays previously managed by Open Canvas when
  the source CSS removes the effect, while leaving unrelated user effects alone.
- WebKit text stroke (`-webkit-text-stroke-width`/`-webkit-text-stroke-color`)
  is carried through the scene and H2D payload and mapped to editable Figma
  TextNode strokes when the host exposes those properties. Transparent
  `-webkit-text-fill-color` is preserved separately, which keeps outlined text
  visible without flattening it into an SVG image.
- Image and background position keywords now resolve by their CSS axis,
  including single keywords such as `bottom` and reversed pairs such as
  `bottom right`, instead of treating the first token as horizontal in every
  case.
- `<img>` object-position pixel offsets are normalized against the captured
  image box before the Figma rectangle is resized, avoiding default-node-size
  normalization errors during import.
- Single-layer URL backgrounds with explicit two-value `background-size`
  (`px`/`%`) now use an embedded SVG image layer to preserve the captured
  dimensions, edge position, repeat mode, and captured corner-radius clipping.
  `cover`, `contain`, and ordinary complex multi-layer backgrounds remain on
  the native paint path unless clipping requires the ordered vector fallback;
  URL-only multi-layer `space/round` cases use the ordered measured overlay
  described above. Single-value and `auto`-paired
  sizes derive the missing axis from the embedded asset's intrinsic ratio when
  that metadata is readable.
- `<img object-fit="none">` and `scale-down` now use the asset's intrinsic
  dimensions (PNG/GIF/WebP/JPEG/SVG where readable) in an SVG clipping layer;
  captured corner radii are applied to that vector clip as well;
  they no longer incorrectly map to Figma `CROP` and enlarge/crop the source.
- CSS `object-view-box: inset(...)` is captured through the shared scene and
  H2D styles, then applied before `object-fit` and `object-position`. The
  editable SVG fallback draws the complete source image with the cropped
  source region translated into the target box, so the crop remains stable
  across `fill`, `cover`, `contain`, `none`, and `scale-down`. Unsupported
  `round` syntax, invalid expressions, missing intrinsic dimensions, or a
  runtime without an SVG fallback are retained in `open-canvas-object-view-box`
  and reported as explicit degradations. Fallback layers also retain a source
  signature for the crop, position, fit, filter, clip, and mask inputs, so a
  same-sized responsive update rebuilds the SVG instead of leaving stale source
  pixels in Figma.
- Zero-inset rounded CSS `clip-path: inset(0 ... round ...)` maps to native
  Figma clipping and corner radii. Polygon, circle, ellipse, non-zero inset,
  `rect(...)`, `xywh(...)`, and quoted CSS `path()` shapes now become editable
  absolute vector masks at the start of frame children, preserving clipping
  without consuming Auto Layout flow. Percentage geometry and optional
  `round` radii on `rect(...)`/`xywh(...)` resolve against the captured border
  box; an explicit `padding-box` or `content-box` reference suffix resolves
  the geometry in that box and translates the mask back into the frame's
  border-box coordinates. Font-relative (`em`/`rem`), absolute
  (`pt`/`pc`/`in`/`cm`/`mm`/`q`), viewport, and functional
  `calc()`/`min()`/`max()`/`clamp()` coordinates use the captured
  font/root-font/viewport context instead of being truncated to their first
  numeric token. Malformed, inverted, or non-positive geometry,
  unsafe path data, and other complex coordinate syntax remain in
  computed-style metadata and are reported as explicit import degradations.
  Geometry-box-only values `border-box`, `padding-box`, and `content-box` are
  also recognized; the first maps to native `clipsContent`, while the latter
  two create an absolute inset mask using the captured border and padding.
  During final geometry convergence, if a reused node no longer has a
  `clip-path`, legacy `clip`, or `mask-image` source, the corresponding
  generated mask siblings are removed even when the box size is unchanged;
  masked solid/gradient fills are restored to the native paint channel.
  New mask and clip fallbacks also retain a source signature covering the
  shape, layer geometry, position, sizing, repeat, origin, and composite
  inputs, so same-sized source edits rebuild the editable SVG rather than
  preserving stale pixels. If a source changes fallback family, such as
  `clip-path` to legacy `clip: rect(...)`, the importer creates only the
  missing family and preserves unrelated mask siblings and their stacking.
- Text nodes cannot receive a child mask in Figma, so supported text
  `clip-path` shapes use the existing absolute SVG text fallback instead. The
  original TextNode remains editable and is hidden only while the fallback is
  active; the fallback is sized with the captured line box and is reported as
  `clipPathFallbacks`. Unsupported clip geometry remains an explicit
  degradation rather than being silently rendered without clipping.
- CSS `mask-image` layers made entirely of `linear-gradient()`,
  `radial-gradient()`, `conic-gradient()`, or their repeating variants become
  one editable SVG vector mask. Conic layers use sampled angular sectors so
  their center, start angle, alpha stops, and repeating cycle remain visible,
  including independent per-layer `mask-position`, explicit `mask-size`, and
  `repeat`/`no-repeat`/`space`/`round` axis behavior. Mask size and position
  lengths accept pixels, percentages, font/root-relative units, physical
  units, viewport units, and `calc()`/`min()`/`max()`/`clamp()` expressions.
  They resolve against the captured element font size, root font size, and
  viewport dimensions; functional size values are tokenized without splitting
  the whitespace inside their expressions. The same captured context is used
  for gradient and URL mask layers, including each entry in a multi-layer
  mask stack. Default
  additive/source-over stacks remain direct SVG layers; pure
  `mask-composite: intersect` stacks (including the WebKit `source-in` alias)
  become nested SVG masks so every layer multiplies the preceding alpha or
  luminance result without flattening the page content. `round` recomputes the
  tile size so an integer number fits the selected mask-origin box. `space`
  keeps the authored tile size and distributes the remaining distance between
  tiles; when fewer than two tiles fit, it draws one tile at the captured
  `mask-position` as required by CSS. Readable single-layer URL image masks on
  frame and image layers remain supported with intrinsic image sizing; image
  layers use the SVG fallback path so their source bitmap and mask stay in the
  same editable vector layer.
  The same mask properties are carried through H2D clipboard styles, so the
  compatibility path does not lose masks when the shared scene marker is
  unavailable.
  Text layers with fully parseable gradient/conic mask stacks use the same
  mask SVG as an absolute visual fallback while retaining an editable
  TextNode. Readable URL mask assets captured into the shared asset list now
  use that same fallback path, including their intrinsic/explicit sizing,
  position, repeat, and clip geometry; only unresolved URL assets remain an
  explicit degradation. The report exposes `maskImageFallbacks`.
  The mask is inserted before later children so it does not alter Auto Layout
  order, and a solid frame fill is moved into a masked absolute overlay so the
  element background follows the same alpha boundary. Additive/source-over
  mixed gradient plus successfully inlined URL layers are supported with
  independent per-layer geometry; URL layers with `auto` or one-axis sizes use
  readable intrinsic dimensions/ratios instead of expanding to the frame box.
  URL mask `cover`/`contain` sizing uses that same intrinsic ratio.
  `mask-origin` and `mask-clip` values of `border-box`, `padding-box`, and
  `content-box` resolve against captured border/padding geometry and clip the
  editable vector mask to the same box. `mask-mode: alpha` and ordinary
  `match-source` gradient/image masks map to Figma's Alpha mask type, while
  explicit `luminance` maps to its Luminance mask type. Mixed alpha and
  luminance stacks are normalized layer-by-layer: luminance layers are first
  converted into alpha silhouettes inside the editable SVG, then the common
  outer Alpha mask applies the authored `add`, `intersect`, `subtract`, or
  `exclude` composition. This keeps mixed mask visuals instead of treating
  them as an unsupported mode conflict. Source-over/source-in/source-out/xor
  aliases are normalized to the same operators. Unresolved URL masks and text
  masks are likewise retained in computed-style metadata and reported.
- Text `text-overflow: ellipsis` and numeric CSS line-clamp values are carried
  through H2D and mapped to Figma `textTruncation`/`maxLines` when the host
  exposes those TextNode properties; the requested truncation is also retained
  in `open-canvas-text-overflow` plugin data. If a host rejects either native
  property, the importer keeps the editable TextNode as the semantic source
  and adds an absolute SVG ellipsis layer sized to the captured text box; the
  layer does not consume an Auto Layout slot and is counted as
  `textOverflowFallbacks` in the import report. This visual fallback relies on
  captured line breaks, so legacy payloads without measured line transitions
  remain an explicit truncation degradation rather than silently claiming
  pixel parity. When text shaping also needs a visual fallback, the importer
  composes truncation into that same SVG owner and rebuilds it when native
  truncation recovers, preventing duplicate text paint.
- CSS text-decoration lines are retained in
  `open-canvas-text-decoration` plugin data. `underline` and `line-through`
  map to the corresponding Figma enum. For single-line text, overline,
  multiple lines, non-solid styles, custom paint, thickness, and underline
  offset are additionally drawn as an absolute editable SVG path sibling;
  the TextNode remains editable and its native decoration is disabled when
  the vector owns the complete visual fallback. Legacy or bridge-trimmed
  payloads without per-line rectangles keep the metadata/degradation path
  because one full-width vector would not match per-line glyph geometry.
  Single-line and measured multi-line fallback vectors retain their
  source text geometry and generated SVG height; after a final text/layout
  correction they are regenerated from the source style when the line box or
  width changes, rather than stretching the old wave/dash geometry. Failed
  regeneration keeps the previous editable decoration and only applies a
  safe position/size correction.
- CSS `vertical-align: super/sub` and numeric or percentage baseline offsets
  are mapped to Figma range baseline shifts when the host exposes
  `setRangeBaselineShift`; the source value and resolved shift remain in
  `open-canvas-baseline-shift` plugin data, and the affected run uses measured
  geometry so Auto Layout does not erase the inline baseline position.
- `white-space: pre`, `pre-wrap`, and `break-spaces` preserve authored spaces,
  tabs, and line breaks during capture and H2D replay; ordinary text still
  receives measured browser line transitions without collapsing code-block
  whitespace.
- CSS Text Level 4 `text-wrap-style`, `text-wrap-mode`, `white-space-collapse`,
  `text-box-trim`, and `text-box-edge` are explicitly retained in computed
  styles and the H2D
  text style channel when the capture browser exposes them. Figma has no
  equivalent TextNode controls, so non-default values keep the measured text
  geometry and are reported as one concrete style degradation rather than
  being silently dropped or treated as native support. `preserve` and
  `preserve-breaks` are also applied during text-content normalization before
  line rectangles are measured, so authored spaces are not lost before the
  editable Figma text is created.
  For non-default `text-wrap-mode` or `white-space-collapse`, the plugin also
  uses the existing absolute SVG text fallback when the native TextNode path
  cannot reproduce the captured run; the original TextNode remains as the
  editable semantic layer and the fallback carries `xml:space="preserve"`.
  Non-default `text-wrap-style` values, including `stable`, plus
  `text-box-trim` and `text-box-edge` values now activate that same fallback,
  so browser line runs and text-box edges are preserved even though Figma has
  no native Text Level 4 controls.
- Flex items now distinguish a fixed `flex-basis` from true fill behavior:
  fixed pixel and percentage bases keep their captured initial size unless
  `flex-grow` or an authored percentage width/height requires expansion. Native Figma
  `layoutGrow` receives the grow intent. Figma has no percentage
  `flex-basis` field, so percentage-basis items keep their captured initial
  size for visual fidelity while the original grow/shrink/basis triple is
  retained in `open-canvas-flex` for inspection and later editing.
  Weighted non-default `flex-shrink` values are surfaced as an explicit import
  degradation because Figma has no equivalent child shrink factor. When the
  item has no grow intent, shrink weights keep the captured main-axis sizing
  mode `FIXED` so Figma cannot apply a different compression policy after
  import. `flex-shrink: 0` is represented by a native min-width/min-height
  guard and can retain the captured HUG/FILL parent-facing sizing when the
  runtime exposes it; it is therefore not reported as a degradation merely
  because the source item is non-shrinking. The original grow/shrink/basis
  triple remains in plugin data, and measured geometry stays authoritative
  until the user edits the imported layout.
  The H2D clipboard path also emits a compact `data-open-canvas-flex` marker
  for non-default grow/shrink/basis values. If a bridge trims the replay style
  object, the plugin restores that triple before inferring FILL/HUG and writing
  `layoutGrow`; unsupported shrink weights and percentage/function bases remain
  explicit metadata instead of disappearing from the imported layer.
  When sibling items use different positive `flex-grow` factors (for example
  `1:2`), Figma's boolean `layoutGrow` cannot preserve that ratio. The
  growing children therefore retain their authored grow metadata but receive
  a measured geometry lock, while the parent remains an editable Auto Layout
  frame; this prevents a later Figma resize from silently changing the
  browser-captured proportions.
  The same measured-lock strategy now applies to multiple positive
  `flex-shrink` children with unequal shrink weights. Equal non-default
  weights remain flowable because they preserve the same relative
  distribution; unequal weights are locked and reported through the existing
  shrink degradation because Figma has no child-level shrink factor.
- CSS individual `translate`, `rotate`, and `scale` properties are normalized
  into the same affine transform channel as the shorthand declaration. The
  capture geometry pass removes only the axis-aligned transform contribution,
  while H2D omits the original longhand fields so the transform is not applied
  twice by a browser-facing importer. Capture-side transform parsing uses
  balanced parentheses and resolves X/Y percentages against the element's
  untransformed width/height, including nested `calc(min()/max()/clamp())`
  plus font-relative and viewport-relative units. Invalid translate lengths are rejected instead of
  becoming a zero offset, which prevents a browser-transformed rectangle from
  being captured and then translated a second time in Figma.
- Transform-origin resolution is shared across capture and plugin paths for
  keyword positions, percentages, `px`/`em`/`rem`, viewport units, and balanced
  `calc()`/`min()`/`max()`/`clamp()` values. The capture-side untransformed-box
  recovery now uses the same axis ordering as CSS, so `top center` and
  `center 20px` do not swap or lose the transform pivot before Figma receives
  the affine matrix.
- CSS transforms now preserve the affine 2D subset of `matrix3d`,
  `translate3d`, `scale3d`, angle units, and `skew`; perspective and real 3D
  rotation/depth terms are rejected instead of being silently flattened, and
  are surfaced as explicit style-degradation diagnostics. Native plugin matrix
  writes retain the measured parent-local placement before applying the CSS
  transform, so transformed absolute layers do not jump to the origin. The
  legacy x/y fallback applies only the transform delta and avoids adding the
  measured placement twice when a host rejects matrix writes. Pure positive
  axis-aligned scale also falls back to measured `resize()` dimensions when
  the host cannot accept an affine matrix. Authored transform lengths in
  compatibility payloads also resolve `em`/`rem`, percentages, viewport units,
  and `calc()`/`min()`/`max()`/`clamp()` against the captured element, font, root,
  and viewport dimensions; nested function syntax is balanced before parsing
  so `translate(calc(...))` is not truncated at the inner parenthesis.
- Non-default `transform-origin` is carried on the shared scene and is also
  recovered from `computedStyles` for legacy/truncated payloads. Rotated and
  skewed captures reverse the axis-aligned browser envelope to the original
  layout box before the Figma matrix is applied; when the envelope equations
  are degenerate (for example a 45-degree rotation), the browser's untransformed
  `offsetWidth`/`offsetHeight` are used as the layout-size fallback. This keeps
  the transform from being applied to an already-transformed bounding box.
- Final geometry audits compare transformed nodes in visual-matrix space while
  coordinate writes continue to use the pre-transform layout box. The
  transform-origin translation is therefore not misclassified as Auto Layout
  drift and does not trigger a second corrective nudge during convergence.
- Border-radius normalization and complex background SVG fallback geometry use
  the same pre-transform border-box dimensions as the node itself. Percentage
  corners and gradient coordinates therefore remain stable when a source layer
  is scaled or rotated before it reaches Figma.
- The metadata `source` now identifies this project as `open-canvas`, not
  `chrome-extension`. The parser still accepts older payload shapes for
  backward compatibility; this does not imply an official protocol.
- Automated tests cover serialization, parsing, clipboard paths and plugin
  behavior. They do **not** prove that Figma Desktop accepts a paste or that
  its rendered layers retain the intended layout in a particular release.

## Local Desktop smoke evidence (2026-09-29)

A read-only accessibility inspection was performed against the already-open
Figma Desktop document on macOS 26.6.2 (arm64), Figma 126.8.18. The imported
page was not edited during this check. The observed state provides concrete
evidence for the current export path:

- A selected imported text layer exposed Typography `16/24`, confirming that
  the resolved pixel line-height reached the editable Figma text layer.
- The selected imported root exposed vertical Auto Layout, width `1440`,
  height `3083` with `Hug`, centered alignment, and `Clip content` enabled.

This is a single local smoke result, not a release compatibility matrix. It
does not establish native-paste behavior for other Figma Desktop versions,
operating systems, fonts, or pages with unsupported CSS effects.

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

The local smoke result above should be retained alongside future screenshots
and plugin reports. Until the version matrix, dedicated blank-file checks, and
provenance review pass, keep the repository private and describe native paste
and plugin import as experimental, not guaranteed exports.
