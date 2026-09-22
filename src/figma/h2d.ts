import type { DesignDocument } from "./designModel";

export interface H2DDocument {
  documentTitle?: string;
  root: H2DElementNode;
  documentRect: { x: number; y: number; width: number; height: number };
  viewportRect: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
  version: 2;
  assets: Record<string, H2DAsset>;
  fonts: Record<string, H2DFont>;
}

interface H2DAsset {
  url: string;
  blob: { type: string; base64Blob: string } | null;
  error?: string;
}

interface H2DFont {
  familyName: string;
  faces: unknown[];
  usages: unknown[];
}

interface H2DTextNode {
  nodeType: 3;
  id: string;
  text: string;
  rect: { x: number; y: number; width: number; height: number };
  lineCount: number;
}

type H2DNode = H2DElementNode | H2DTextNode;

interface H2DElementNode {
  nodeType: 1;
  id: string;
  tag: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  computedStyles?: Record<string, string>;
  rect: { x: number; y: number; width: number; height: number };
  childNodes: H2DNode[];
  /** H2D-compatible payloads keep generated content out of normal layout children. */
  pseudoElementNodes?: {
    before?: H2DElementNode;
    after?: H2DElementNode;
  };
  content?: string;
}

export interface FigmaMetadata {
  pageId?: string;
  title?: string;
  width?: number;
  height?: number;
  viewport?: { width: number; height: number };
  viewportRect?: { x: number; y: number; width: number; height: number };
  devicePixelRatio?: number;
  /** Short alias accepted by some H2D-compatible importers. */
  dpr?: number;
  /** Resource and font manifests let importers preserve capture-time metrics. */
  assets?: Array<{ id: string; kind: string; url?: string; embedded: boolean }>;
  resources?: Array<{ id: string; kind: string; url?: string; embedded: boolean }>;
  fonts?: Record<string, H2DFont>;
  fontList?: H2DFont[];
  diagnostics?: DesignDocument["diagnostics"];
  dataType?: string;
  source?: string;
  capturedAtIso?: string;
}

const FIGMETA_OPEN = "<!--(figmeta)";
const FIGMETA_CLOSE = "(/figmeta)-->";
const FIGH2D_OPEN = "<!--(figh2d)";
const FIGH2D_CLOSE = "(/figh2d)-->";
const OPEN_CANVAS_SCENE_OPEN = "<!--(opencanvas)";
const OPEN_CANVAS_SCENE_CLOSE = "(/opencanvas)-->";
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function toH2D(document: DesignDocument): H2DDocument {
  const assetById = new Map(document.assets.map((asset) => [asset.id, asset]));
  const assets = Object.fromEntries(document.assets.map((asset) => {
    const url = asset.src ?? asset.id;
    const blob = asset.data?.startsWith("data:")
      // The official H2D serializer names this field `base64Blob`, but its
      // value is the complete data URL returned by FileReader.readAsDataURL.
      // Keeping the prefix is important because Figma uses it to recover the
      // MIME type and decode image/SVG assets from the marker payload.
      ? (() => {
        const comma = asset.data.indexOf(",");
        const typeEnd = asset.data.indexOf(";");
        const type = asset.data.slice(5, typeEnd > 0 ? typeEnd : comma);
        // FileReader.readAsDataURL(new File(..., { type:
        // "application/octet-stream" })) is what the official extension uses
        // for this field, while the original MIME remains in `type`.
        const base64Blob = asset.data.includes(";base64,") && comma > 0
          ? `data:application/octet-stream;base64,${asset.data.slice(comma + 1)}`
          : asset.data;
        return { type, base64Blob };
      })()
      : null;
    return [url, { url, blob, ...(blob ? {} : { error: "Asset was not embedded" }) } satisfies H2DAsset];
  }));
  const fontsByFamily = new Map<string, H2DFont>();
  for (const font of document.fonts) {
    const key = font.family.toLowerCase();
    const existing = fontsByFamily.get(key) ?? { familyName: font.family, faces: [], usages: [] };
    const usage = {
      fontWeight: String(font.weight),
      ...(font.style ? { fontStyle: font.style } : {}),
      ...(font.stretch ? { fontStretch: font.stretch } : {}),
      ...(font.size != null ? { fontSize: `${font.size}px` } : {}),
      ...(font.metrics ? { metrics: font.metrics } : {}),
    };
    const usageKey = JSON.stringify(usage);
    if (!existing.usages.some((candidate) => JSON.stringify(candidate) === usageKey)) {
      existing.usages.push(usage);
    }
    fontsByFamily.set(key, existing);
  }
  const fonts = Object.fromEntries(fontsByFamily);

  const h2dRoot = document.root;
  // Keep the official H2D tree close to the browser extension's serializer.
  // The importer already consumes each node's absolute `rect`; turning the
  // shared scene's geometryLock flag into CSS `position:absolute` applies the
  // same coordinates a second time and breaks normal flex/block flow.
  // geometryLock remains available in the shared scene for the Neuxmind
  // plugin bridge, but is intentionally ignored by this official channel.
  const root = toH2DElement(h2dRoot, assetById, { x: 0, y: 0 });
  return {
    documentTitle: document.title,
    root,
    // The official serializer reports the full document extent (scroll size),
    // while viewportRect remains the visible capture window. The captured
    // HTML root has already been expanded to that extent after body layout
    // settles, so use it as the single source of truth for the Figma Frame.
    documentRect: {
      x: 0,
      y: 0,
      width: Math.max(document.root.rect.width, document.viewport.width),
      height: Math.max(document.root.rect.height, document.viewport.height),
    },
    viewportRect: document.viewportRect ?? { x: 0, y: 0, width: document.viewport.width, height: document.viewport.height },
    devicePixelRatio: document.devicePixelRatio,
    version: 2,
    assets,
    fonts,
  };
}

function px(value: number): string {
  return `${Number.isFinite(value) ? value : 0}px`;
}

function color(value?: string): string {
  return value && value !== "transparent" ? value : "rgba(0, 0, 0, 0)";
}

function cssBoxDimension(
  node: DesignDocument["root"],
  rect: H2DDocument["documentRect"],
  axis: "width" | "height",
  computed: Record<string, string>,
): number {
  // DOMRect is always a border-box measurement. H2D styles are replayed as
  // CSS by the official importer, where a content-box width/height excludes
  // padding and borders. Keep the CSS dimension in the same coordinate model
  // so content-box pages do not grow again during paste.
  if (computed.boxSizing === "border-box") return rect[axis];
  const computedValue = Number.parseFloat(computed[axis] ?? "");
  if (Number.isFinite(computedValue) && computedValue > 0) return computedValue;
  const padding = axis === "width"
    ? node.layout.padding[1] + node.layout.padding[3]
    : node.layout.padding[0] + node.layout.padding[2];
  const borders = node.borders
    ? axis === "width"
      ? (node.borders[1]?.width ?? 0) + (node.borders[3]?.width ?? 0)
      : (node.borders[0]?.width ?? 0) + (node.borders[2]?.width ?? 0)
    : node.stroke?.width
      ? node.stroke.width * 2
      : 0;
  return Math.max(0, rect[axis] - padding - borders);
}

const UA_BOX_RESET_TAGS = new Set([
  "ADDRESS", "BODY", "BLOCKQUOTE", "BUTTON", "DD", "DIR", "DL", "DT", "FIELDSET",
  "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "INPUT", "MENU",
  "OL", "P", "PRE", "SELECT", "TEXTAREA", "UL",
]);

function isPaddedTextOnlyContainer(node: DesignDocument["root"]): boolean {
  const computed = node.computedStyles ?? {};
  const padding = node.layout.padding;
  return node.type === "frame"
    && node.layout.mode === "none"
    && node.children.length > 0
    && node.children.every((child) => child.type === "text")
    && (computed.display === "block" || computed.display === "inline-block")
    && (padding[0] > 0 || padding[2] > 0);
}

function stylesFor(
  node: DesignDocument["root"],
  rect: H2DDocument["documentRect"],
  assetById: Map<string, DesignDocument["assets"][number]>,
  containingBorder: { left: number; top: number } = { left: 0, top: 0 },
  options: { visualSnapshot?: boolean; root?: boolean; parentOrigin?: { x: number; y: number } } = {},
): Record<string, string> {
  const visualSnapshot = options.visualSnapshot === true;
  // Preserve authored relative positioning contexts. A relative container can
  // still host snapshot-locked descendants; converting the container itself to
  // absolute would lose the containing block and shift those descendants.
  // The visual H2D channel pins every non-fixed node to its captured
  // parent-relative rectangle. Keeping a `position: relative` source node in
  // normal flow is incorrect here: its preceding snapshot-absolute siblings
  // no longer occupy a flow slot, so the relative container starts at the
  // parent's origin and then receives its captured offset a second time.
  // `position: absolute` still establishes a containing block for descendants,
  // so nested pseudo-elements and absolute decorations retain their context.
  // The visual H2D channel pins every descendant when `visualSnapshot` is
  // enabled. This prevents Figma's importer-specific font, border-box, and
  // flex rounding from cascading through later siblings. The shared scene
  // payload still retains the authored Auto Layout declarations for the
  // Neuxmind plugin; `geometryLock` remains the fallback for callers that
  // serialize a partial/native scene without the visual snapshot flag.
  // The document root is already the importer canvas. Keep it in the normal
  // document flow, while pinning its descendants to the measured capture
  // rectangles. Making the root itself absolute changes the native H2D frame
  // origin in some Figma builds.
  const snapshotAbsolute = (visualSnapshot && !options.root)
    && node.positioning !== "fixed"
    // In the visual snapshot channel, relative containers must also be
    // pinned. Their preceding siblings may already be absolute snapshot
    // layers, so leaving the relative container in normal flow makes the
    // browser recompute its position and compounds the captured offset.
    // Preserve authored relative positioning only for non-snapshot callers.
    && (visualSnapshot || node.positioning !== "relative");
  const padding = node.layout.padding;
  const computed = node.computedStyles ?? {};
  const computedDisplay = computed.display;
  const isGridLayout = computedDisplay === "grid" || computedDisplay === "inline-grid";
  const isFlexLayout = !isGridLayout && (node.layout.mode === "horizontal" || node.layout.mode === "vertical");
  // A block button/badge with only an anonymous text run is visually centered
  // by the browser's inline formatting context. Figma's H2D importer treats
  // the same block as a fixed frame and can place the text at the bottom when
  // it honors the captured vertical padding. Express that already-measured
  // relationship as a flex row while keeping the element's fixed dimensions;
  // this affects only text-only painted containers and leaves ordinary block
  // flow untouched.
  const textOnlyContainer = isPaddedTextOnlyContainer(node);
  const isFlexContainer = textOnlyContainer || isFlexLayout;
  const isLayoutContainer = isFlexContainer || isGridLayout;
  const textOnlyAlign = computed.textAlign === "center" ? "center" : "flex-start";
  const flexDisplay = computedDisplay === "inline-flex" ? "inline-flex" : "flex";
  const backgroundAsset = node.backgroundAssetId ? assetById.get(node.backgroundAssetId) : undefined;
  const backgroundImage = backgroundAsset?.src
    ? `url(${backgroundAsset.src})`
    : node.backgroundImage ?? node.gradient ?? "none";
  const borderAt = (index: 0 | 1 | 2 | 3) => node.borders ? node.borders[index] : node.stroke;
  const topBorder = borderAt(0);
  const rightBorder = borderAt(1);
  const bottomBorder = borderAt(2);
  const leftBorder = borderAt(3);
  const shadow = node.shadow;
  // A locked node already carries its measured parent-relative coordinates.
  // Keeping the source margin as well makes HTML/H2D importers apply that
  // spacing a second time when they honor the absolute left/top pair.
  const isMeasuredPosition = snapshotAbsolute
    || node.positioning === "absolute"
    || node.positioning === "fixed"
    || node.positioning === "sticky"
    || node.layout.position === "absolute";
  // A measured child is serialized as an absolutely positioned layer. CSS
  // resolves that layer against the nearest positioned ancestor; leaving a
  // static grid/flex wrapper unchanged makes the child escape to the page
  // root and is the main source of whole-section jumps in H2D replays.
  // Keep the document BODY static (the initial containing block is already
  // the correct coordinate space), but establish a local context for every
  // nested wrapper that owns a measured child.
  const hasMeasuredChild = !options.root && node.children.some((child) =>
    child.positioning === "absolute"
      || child.positioning === "fixed"
      || child.positioning === "sticky"
      || child.layout.position === "absolute",
  );
  const sourcePosition = node.positioning && node.positioning !== "static"
    ? node.positioning
    : node.layout.position === "absolute" ? "absolute" : "static";
  const containingPosition = sourcePosition === "static" && hasMeasuredChild ? "relative" : sourcePosition;
  const margin = isMeasuredPosition ? [0, 0, 0, 0] : (node.margin ?? [0, 0, 0, 0]);
  const radius = node.radius ?? [0, 0, 0, 0];
  // `computedStyles` is the capture-time measurement channel.  The official
  // H2D serializer keeps it separate from the CSS replay map; spreading it
  // into `styles` makes Figma apply both the measured values and the authored
  // layout a second time.  In particular, resolved transform origins and
  // inset pairs are not safe CSS declarations when the node has no transform
  // or is still in normal flow.
  const replayComputed = Object.fromEntries(
    Object.entries(computed).filter(([property]) => {
      if (["left", "right", "top", "bottom"].includes(property)) return false;
      if (["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight"].includes(property)) return false;
      if (["transformBox", "transformStyle"].includes(property)) return false;
      if (property === "transformOrigin" && !node.transform) return false;
      return true;
    }),
  );
  const styles: Record<string, string> = {
    ...replayComputed,
    // Keep authored Grid declarations in the official H2D document. The
    // shared scene metadata also carries the resolved tracks for the native
    // Neuxmind plugin, so each consumer can preserve the source layout model.
    display: textOnlyContainer ? "flex" : isGridLayout ? computedDisplay : isFlexLayout ? flexDisplay : computedDisplay ?? "block",
    ...(containingPosition !== "static" ? { position: snapshotAbsolute ? "absolute" : containingPosition } : {}),
    width: px(cssBoxDimension(node, rect, "width", computed)),
    height: px(cssBoxDimension(node, rect, "height", computed)),
    ...(computed.boxSizing ? { boxSizing: computed.boxSizing } : {}),
    ...(node.opacity !== 1 ? { opacity: String(node.opacity) } : {}),
    ...(computed.visibility && computed.visibility !== "visible" ? { visibility: computed.visibility } : {}),
    ...(node.overflow && node.overflow !== "visible" ? { overflow: node.overflow } : {}),
    ...(computed.overflowX && computed.overflowX !== "visible" ? { overflowX: computed.overflowX } : {}),
    ...(computed.overflowY && computed.overflowY !== "visible" ? { overflowY: computed.overflowY } : {}),
    ...(node.filter && node.filter !== "none" ? { filter: node.filter } : {}),
    ...(node.backdropFilter && node.backdropFilter !== "none" ? { backdropFilter: node.backdropFilter } : {}),
    ...(computed.clipPath && computed.clipPath !== "none" ? { clipPath: computed.clipPath } : {}),
    ...(computed.isolation && computed.isolation !== "auto" ? { isolation: computed.isolation } : {}),
    ...(computed.mixBlendMode && computed.mixBlendMode !== "normal" ? { mixBlendMode: computed.mixBlendMode } : {}),
    // Text nodes use `fill` for their foreground color. Leaving that value in
    // backgroundColor makes Figma import each glyph run as a solid rectangle.
    // Repeating/stacked CSS backgrounds are captured into one SVG asset. The
    // asset already contains the base background layer, so do not emit the
    // same color underneath it or H2D consumers will composite that paint
    // twice (most visibly around transparent gradient stops).
    ...(node.type !== "text" && !node.backgroundAssetId && node.fill?.color ? { backgroundColor: color(node.fill.color) } : {}),
    ...(backgroundImage !== "none" ? { backgroundImage } : {}),
    ...(node.backgroundSize ? { backgroundSize: node.backgroundSize } : {}),
    ...(node.backgroundPosition ? { backgroundPosition: node.backgroundPosition } : {}),
    ...(node.backgroundRepeat ? { backgroundRepeat: node.backgroundRepeat } : {}),
    ...(computed.backgroundClip && computed.backgroundClip !== "border-box" ? { backgroundClip: computed.backgroundClip } : {}),
    ...(computed.backgroundOrigin && computed.backgroundOrigin !== "padding-box" ? { backgroundOrigin: computed.backgroundOrigin } : {}),
    ...(computed.backgroundBlendMode && computed.backgroundBlendMode !== "normal" ? { backgroundBlendMode: computed.backgroundBlendMode } : {}),
    // Capture rects are normalized back to the pre-transform layout box for
    // axis-aligned matrices. Keep the authored transform so H2D consumers can
    // reproduce the visual result instead of silently dropping it.
    ...(node.transform ? { transform: node.transform } : {}),
    // A resolved pixel transform-origin is present on every DOM element in
    // Chromium even when `transform` is `none`. Replaying it without an
    // actual transform changes the importer coordinate space for the whole
    // subtree, so only carry it with a real transform matrix/function.
    ...(node.transform && computed.transformOrigin && computed.transformOrigin !== "50% 50%"
      ? { transformOrigin: computed.transformOrigin }
      : {}),
    ...(node.zIndex != null ? { zIndex: String(node.zIndex) } : {}),
    ...(radius[0] ? { borderTopLeftRadius: px(radius[0]) } : {}),
    ...(radius[1] ? { borderTopRightRadius: px(radius[1]) } : {}),
    ...(radius[2] ? { borderBottomRightRadius: px(radius[2]) } : {}),
    ...(radius[3] ? { borderBottomLeftRadius: px(radius[3]) } : {}),
    ...(padding[0] ? { paddingTop: px(padding[0]) } : {}),
    ...(padding[1] ? { paddingRight: px(padding[1]) } : {}),
    ...(padding[2] ? { paddingBottom: px(padding[2]) } : {}),
    ...(padding[3] ? { paddingLeft: px(padding[3]) } : {}),
    ...(margin[0] ? { marginTop: px(margin[0]) } : {}),
    ...(margin[1] ? { marginRight: px(margin[1]) } : {}),
    ...(margin[2] ? { marginBottom: px(margin[2]) } : {}),
    ...(margin[3] ? { marginLeft: px(margin[3]) } : {}),
    // Keep container-only flex properties at their browser defaults on block
    // and text nodes. Emitting `flexDirection: column`/`justifyContent:
    // flex-start` on every element makes H2D consumers infer a synthetic
    // layout container and is a common source of cumulative offsets.
    ...(isLayoutContainer && node.layout.gap ? { gap: px(node.layout.gap) } : {}),
    ...(isLayoutContainer && (node.layout.rowGap ?? node.layout.gap) ? { rowGap: px(node.layout.rowGap ?? node.layout.gap) } : {}),
    ...(isLayoutContainer && (node.layout.columnGap ?? node.layout.gap) ? { columnGap: px(node.layout.columnGap ?? node.layout.gap) } : {}),
    ...(computed.flexGrow && computed.flexGrow !== "0" ? { flexGrow: computed.flexGrow } : {}),
    // Grid tracks are already measured in the browser. Preserve the authored
    // grid surface and prevent flex-only wrapping rules from changing it.
    ...(isFlexContainer && node.layout.wrap ? { flexShrink: "0" } : computed.flexShrink && computed.flexShrink !== "1" ? { flexShrink: computed.flexShrink } : {}),
    ...(computed.flexBasis && computed.flexBasis !== "auto" ? { flexBasis: computed.flexBasis } : {}),
    ...(isFlexContainer && node.layout.wrap ? { flexWrap: "wrap" } : computed.flexWrap && computed.flexWrap !== "nowrap" ? { flexWrap: computed.flexWrap } : {}),
    ...(computed.minWidth && computed.minWidth !== "auto" ? { minWidth: computed.minWidth } : {}),
    ...(isFlexContainer ? {
      flexDirection: textOnlyContainer
        ? "row"
        : node.layout.mode === "horizontal"
          ? (node.layout.reverse ? "row-reverse" : "row")
          : (node.layout.reverse ? "column-reverse" : "column"),
    } : computed.flexDirection && computed.flexDirection !== "row" ? { flexDirection: computed.flexDirection } : {}),
    ...(isFlexContainer && (textOnlyContainer || node.layout.alignItems) ? { alignItems: textOnlyContainer ? "center" : node.layout.alignItems === "center" ? "center" : node.layout.alignItems === "end" ? "flex-end" : "stretch" } : computed.alignItems && computed.alignItems !== "normal" ? { alignItems: computed.alignItems } : {}),
    ...(node.layout.alignSelf && node.layout.alignSelf !== "auto" ? { alignSelf: node.layout.alignSelf === "center" ? "center" : node.layout.alignSelf === "end" ? "flex-end" : node.layout.alignSelf === "start" ? "flex-start" : "stretch" } : computed.alignSelf && computed.alignSelf !== "auto" ? { alignSelf: computed.alignSelf } : {}),
    ...(isFlexContainer && node.layout.alignContent && node.layout.alignContent !== "start" ? { alignContent: node.layout.alignContent === "end" ? "flex-end" : node.layout.alignContent } : computed.alignContent && computed.alignContent !== "normal" ? { alignContent: computed.alignContent } : {}),
    // Keep grid alignment metadata in the shared scene model for the native
    // plugin, but do not re-emit it as CSS here. Official H2D importers use
    // the captured `alignItems`/`justifyContent` pair and may otherwise apply
    // these extra shorthands a second time, shifting grid/flex children.
    ...(node.layout.order ? { order: String(node.layout.order) } : computed.order && computed.order !== "0" ? { order: computed.order } : {}),
    ...(isFlexContainer && (textOnlyContainer || (node.layout.justifyContent && node.layout.justifyContent !== "start")) ? { justifyContent: textOnlyContainer ? textOnlyAlign : node.layout.justifyContent === "end" ? "flex-end" : node.layout.justifyContent } : computed.justifyContent && computed.justifyContent !== "normal" ? { justifyContent: computed.justifyContent } : {}),
    ...(node.layout.gridTemplateColumns ? { gridTemplateColumns: node.layout.gridTemplateColumns } : {}),
    ...(node.layout.gridTemplateRows ? { gridTemplateRows: node.layout.gridTemplateRows } : {}),
    ...(node.layout.gridAutoFlow ? { gridAutoFlow: node.layout.gridAutoFlow } : {}),
    ...(node.shadowCss || shadow ? { boxShadow: node.shadowCss ?? `${px(shadow!.offsetX)} ${px(shadow!.offsetY)} ${px(shadow!.blur)} ${px(shadow!.spread)} ${shadow!.color}` } : {}),
    ...(topBorder ? { borderTopStyle: topBorder.style ?? "solid", borderTopWidth: px(topBorder.width), borderTopColor: topBorder.color } : {}),
    ...(rightBorder ? { borderRightStyle: rightBorder.style ?? "solid", borderRightWidth: px(rightBorder.width), borderRightColor: rightBorder.color } : {}),
    ...(bottomBorder ? { borderBottomStyle: bottomBorder.style ?? "solid", borderBottomWidth: px(bottomBorder.width), borderBottomColor: bottomBorder.color } : {}),
    ...(leftBorder ? { borderLeftStyle: leftBorder.style ?? "solid", borderLeftWidth: px(leftBorder.width), borderLeftColor: leftBorder.color } : {}),
  };
  if (node.type === "image") {
    styles.objectFit = node.objectFit ?? "fill";
    styles.objectPosition = node.objectPosition ?? "50% 50%";
  }
  if (isMeasuredPosition) {
    // Computed styles are spread above so the replay document preserves the
    // source typography and visual defaults. A measured absolute layer must
    // not also carry the source flow margin: that would apply the captured
    // offset twice when the H2D document is laid out again.
    Object.assign(styles, {
      marginTop: "0px",
      marginRight: "0px",
      marginBottom: "0px",
      marginLeft: "0px",
      // The captured source may have used the opposite inset pair (for
      // example `right`/`bottom`). Once the layer is pinned with measured
      // `left`/`top`, retaining both pairs makes CSS resolve an over-constrained
      // absolute position against the replay parent's padding box.
      right: "auto",
      bottom: "auto",
    });
  }
  if (isMeasuredPosition) {
    // H2D is consumed as an HTML-like document. Explicit coordinates keep
    // pseudo-elements and floating controls anchored to their captured parent
    // instead of letting the importer recompute them from normal flow. The
    // shared scene model stores child rects relative to their parent; using
    // the accumulated H2D rect here would apply every ancestor offset twice
    // when nested locked nodes are imported.
    // Captured DOM rects are measured from the parent's border-box. CSS
    // absolute positioning, however, resolves inset coordinates from the
    // containing block's padding-box. Remove only the parent's border here;
    // padding remains part of the captured child offset and must be preserved.
    const isFixed = node.positioning === "fixed";
    // `rect` is accumulated into document coordinates by `toH2DElement`,
    // while an absolute child is positioned against its nearest relative
    // wrapper. Subtract that wrapper's accumulated origin here; otherwise a
    // nested snapshot repeats every ancestor offset (the error grows with
    // depth and is especially visible in cards inside a page frame).
    const parentOrigin = options.parentOrigin ?? { x: 0, y: 0 };
    styles.left = px(rect.x - (isFixed ? 0 : parentOrigin.x) - (isFixed ? 0 : containingBorder.left));
    styles.top = px(rect.y - (isFixed ? 0 : parentOrigin.y) - (isFixed ? 0 : containingBorder.top));
  } else if (node.positioning === "relative" && node.positionOffset
    && (Math.abs(node.positionOffset.left) > 0.01 || Math.abs(node.positionOffset.top) > 0.01)) {
    styles.left = px(node.positionOffset.left);
    styles.top = px(node.positionOffset.top);
  }
  if (node.type === "text" && node.text) {
    // Keep the full computed fallback stack when it is available. The first
    // family in the shared scene model is useful for diagnostics, but
    // discarding the remaining fallbacks makes browser/Figma font resolution
    // diverge unnecessarily for system and CJK fonts.
    styles.fontFamily = node.computedStyles?.fontFamily ?? node.text.fontFamily;
    styles.fontSize = px(node.text.fontSize);
    styles.fontWeight = String(node.text.fontWeight);
    styles.fontStretch = node.computedStyles?.fontStretch ?? "100%";
    styles.fontKerning = node.computedStyles?.fontKerning ?? "auto";
    styles.fontFeatureSettings = node.computedStyles?.fontFeatureSettings ?? "normal";
    styles.fontVariationSettings = node.computedStyles?.fontVariationSettings ?? "normal";
    styles.lineHeight = px(node.text.lineHeight);
    styles.letterSpacing = px(node.text.letterSpacing);
    styles.textAlign = node.text.textAlign === "left" ? "start" : node.text.textAlign;
    styles.textTransform = node.text.textTransform ?? "none";
    styles.fontStyle = node.text.fontStyle ?? "normal";
    styles.textDecoration = node.text.textDecoration ?? "none";
    styles.textDecorationLine = node.text.textDecoration ?? "none";
    styles.textShadow = node.text.textShadow ?? "none";
    styles.textOverflow = node.computedStyles?.textOverflow ?? "clip";
    styles.verticalAlign = node.text.verticalAlign ?? "baseline";
    // renderedTextContent() has already converted browser line transitions
    // into explicit newlines. Preserve those measured breaks in H2D instead
    // of allowing Figma's font metrics to wrap the same run a second time.
    styles.whiteSpace = node.text.whiteSpace === "nowrap" ? "nowrap" : "pre";
    styles.textIndent = px(node.text.textIndent ?? 0);
    styles.direction = node.text.direction ?? "ltr";
    styles.overflowWrap = node.text.overflowWrap ?? "normal";
    styles.wordBreak = node.text.wordBreak ?? "normal";
    styles.hyphens = node.text.hyphens ?? "manual";
    styles.color = color(node.fill?.color);
  }
  // The official serializer omits values equal to the browser defaults. In
  // particular, leaving `flexDirection: row`, `gap: normal`, or transparent
  // fills on ordinary block/text nodes makes downstream importers treat those
  // nodes as synthetic layout containers. Keep the portable H2D payload
  // sparse even when a test fixture or a browser exposes those defaults.
  const defaultStyles: Record<string, string> = {
    backgroundColor: "rgba(0, 0, 0, 0)",
    backgroundImage: "none",
    backgroundSize: "auto",
    backgroundPosition: "0% 0%",
    backgroundRepeat: "repeat",
    backgroundClip: "border-box",
    backgroundOrigin: "padding-box",
    backgroundBlendMode: "normal",
    opacity: "1",
    visibility: "visible",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    filter: "none",
    backdropFilter: "none",
    clipPath: "none",
    isolation: "auto",
    mixBlendMode: "normal",
    transform: "none",
    transformOrigin: "50% 50%",
    zIndex: "auto",
    flexGrow: "0",
    flexShrink: "1",
    flexBasis: "auto",
    flexWrap: "nowrap",
    minWidth: "auto",
    flexDirection: "row",
    alignItems: "normal",
    alignSelf: "auto",
    alignContent: "normal",
    justifyContent: "normal",
    justifyItems: "normal",
    justifySelf: "auto",
    gap: "normal",
    rowGap: "normal",
    columnGap: "normal",
    order: "0",
    fontStretch: "100%",
    fontKerning: "auto",
    fontFeatureSettings: "normal",
    fontVariationSettings: "normal",
    fontStyle: "normal",
    textTransform: "none",
    textOverflow: "clip",
    verticalAlign: "baseline",
    textIndent: "0px",
    direction: "ltr",
    overflowWrap: "normal",
    wordBreak: "normal",
    hyphens: "manual",
    textAlign: "start",
    textDecoration: "none",
    textDecorationLine: "none",
    textShadow: "none",
    borderTopStyle: "none",
    borderRightStyle: "none",
    borderBottomStyle: "none",
    borderLeftStyle: "none",
    borderTopWidth: "0px",
    borderRightWidth: "0px",
    borderBottomWidth: "0px",
    borderLeftWidth: "0px",
    marginTop: "0px",
    marginRight: "0px",
    marginBottom: "0px",
    marginLeft: "0px",
    paddingTop: "0px",
    paddingRight: "0px",
    paddingBottom: "0px",
    paddingLeft: "0px",
  };
  for (const [property, defaultValue] of Object.entries(defaultStyles)) {
    if (styles[property] === defaultValue) delete styles[property];
  }
  // H2D is replayed with the source tag name, so browser user-agent rules
  // would otherwise reintroduce margins/padding that were explicitly reset
  // in the captured page (for example H2/P/H3 defaults). Keep ordinary DIV
  // payloads sparse, but make semantic/form roots deterministic.
  if (UA_BOX_RESET_TAGS.has(String(node.sourceTag ?? "").toUpperCase())) {
    Object.assign(styles, {
      marginTop: px(margin[0]),
      marginRight: px(margin[1]),
      marginBottom: px(margin[2]),
      marginLeft: px(margin[3]),
      paddingTop: px(padding[0]),
      paddingRight: px(padding[1]),
      paddingBottom: px(padding[2]),
      paddingLeft: px(padding[3]),
    });
  }
  // The capture page normally has an authored `button { border: 0 }` reset,
  // but the official H2D consumer replays the source tag in a fresh document.
  // Serialize the reset explicitly so native button chrome cannot add a
  // border, extra content-box width, or a wrapped line to otherwise exact
  // measured controls. Painted buttons keep their captured background.
  if (String(node.sourceTag ?? "").toUpperCase() === "BUTTON") {
    const hasCapturedBorder = Boolean(node.stroke || node.borders?.some(Boolean));
    Object.assign(styles, {
      appearance: "none",
      ...(hasCapturedBorder ? {} : {
        borderTopStyle: "none",
        borderRightStyle: "none",
        borderBottomStyle: "none",
        borderLeftStyle: "none",
        borderTopWidth: "0px",
        borderRightWidth: "0px",
        borderBottomWidth: "0px",
        borderLeftWidth: "0px",
      }),
      ...(!node.fill && !node.gradient && !node.backgroundImage && !node.backgroundAssetId
        ? { backgroundColor: "transparent" }
        : {}),
    });
  }
  for (const side of ["Top", "Right", "Bottom", "Left"]) {
    if (!styles[`border${side}Width`]) {
      delete styles[`border${side}Style`];
      delete styles[`border${side}Color`];
    }
  }
  return styles;
}

function toH2DNode(
  node: DesignDocument["root"],
  assetById: Map<string, DesignDocument["assets"][number]>,
  parent: { x: number; y: number },
  parentNode?: DesignDocument["root"],
  visualSnapshot = false,
): H2DNode {
  if (node.type === "text" && node.text && node.sourceTag === "#text") {
    // Match the official serializer's DOM boundary: only actual DOM text
    // nodes become H2D TEXT_NODE records. H1/H2/P/SPAN and other element-
    // backed text must retain an ELEMENT_NODE wrapper so its font, color,
    // line-height, width, margins, and layout participation reach Figma.
    // Flattening a styled element to TEXT_NODE silently inherits its parent's
    // defaults and is the main cause of merged copy and incorrect typography.
    const textRect = node.textRect ?? node.rect;
    const rect = {
      x: parent.x + node.rect.x,
      y: parent.y + node.rect.y,
      width: textRect.width,
      height: textRect.height,
    };
    return {
      nodeType: 3,
      id: node.id,
      text: node.text.content,
      rect,
      lineCount: node.text.lineCount ?? Math.max(1, Math.ceil(textRect.height / Math.max(1, node.text.lineHeight))),
    };
  }
  return toH2DElement(node, assetById, parent, parentNode, visualSnapshot);
}

function toH2DElement(
  node: DesignDocument["root"],
  assetById: Map<string, DesignDocument["assets"][number]>,
  parent: { x: number; y: number },
  parentNode?: DesignDocument["root"],
  visualSnapshot = false,
): H2DElementNode {
  const rect = { x: parent.x + node.rect.x, y: parent.y + node.rect.y, width: node.rect.width, height: node.rect.height };
  const asset = node.assetId ? assetById.get(node.assetId) : undefined;
  const tag = node.sourceTag ?? (node.type === "image" ? "IMG" : node.type === "vector" ? "SVG" : node.type === "text" ? "SPAN" : "DIV");
  const computedStyles = node.computedStyles && Object.keys(node.computedStyles).length > 0
    ? { ...node.computedStyles }
    : undefined;
  const element: H2DElementNode = {
    nodeType: 1,
    id: node.id,
    tag,
    attributes: { ...(node.attributes ?? {}) },
    styles: stylesFor(node, rect, assetById, {
      left: node.positioning === "fixed" ? 0 : parentNode?.borders
        ? parentNode.borders[3]?.width ?? 0
        : parentNode?.stroke?.width ?? 0,
      top: node.positioning === "fixed" ? 0 : parentNode?.borders
        ? parentNode.borders[0]?.width ?? 0
        : parentNode?.stroke?.width ?? 0,
    }, { visualSnapshot, root: !parentNode, parentOrigin: parent }),
    ...(computedStyles ? { computedStyles } : {}),
    rect,
    childNodes: [],
  };
  if (node.type === "image" && asset?.src) {
    element.attributes = { ...element.attributes, src: asset.src, currentSrc: asset.src };
  }
  if (node.type === "vector" && node.svg) {
    element.content = node.svg;
  }
  if (node.type === "text" && node.text) {
    const textRect = node.textRect
      ? { x: rect.x + node.textRect.x, y: rect.y + node.textRect.y, width: node.textRect.width, height: node.textRect.height }
      : rect;
    // Keep the browser's Range rectangle for painted text containers. The
    // wrapper already carries its measured content width and padding; growing
    // this child to the wrapper's full content box changes its baseline and
    // makes line wrapping drift during import.
    const childRect = textRect;
    element.childNodes.push({
      nodeType: 3,
      id: `${node.id}-text`,
      text: node.text.content,
      rect: childRect,
      lineCount: node.text.lineCount ?? Math.max(1, Math.ceil(childRect.height / Math.max(1, node.text.lineHeight))),
    });
  }
  // Generated content is a separate H2D channel in the official extension.
  // Keeping pseudo-elements out of childNodes prevents them from becoming
  // ordinary flex/grid items and changing the layout of the real children.
  const pseudoChildren = node.children.filter((child) => child.pseudo);
  if (pseudoChildren.length) {
    const pseudoElementNodes: NonNullable<H2DElementNode["pseudoElementNodes"]> = {};
    for (const child of pseudoChildren) {
      const role = child.pseudo;
      if (!role) continue;
      const childParent = child.positioning === "fixed" ? { x: 0, y: 0 } : { x: rect.x, y: rect.y };
      pseudoElementNodes[role] = toH2DElement(child, assetById, childParent, node, visualSnapshot);
    }
    if (pseudoElementNodes.before || pseudoElementNodes.after) element.pseudoElementNodes = pseudoElementNodes;
  }
  for (const child of node.children.filter((candidate) => !candidate.pseudo)) {
    // Fixed-position descendants are measured in viewport coordinates rather
    // than the DOM parent's coordinate space. Do not add the ancestor offset
    // a second time when flattening the scene into H2D's absolute rects.
    const childParent = child.positioning === "fixed"
      ? { x: 0, y: 0 }
      : { x: rect.x, y: rect.y };
    // The official importer uses different font and flex metrics from the
    // capture browser. Pin every visible element to its measured rectangle so
    // one text-width difference cannot cascade through the whole page. The
    // authored scene remains separate for the native editable Auto Layout
    // importer.
    element.childNodes.push(toH2DNode(child, assetById, childParent, node, visualSnapshot));
  }
  return element;
}

export function buildFigmaHtml(document: DesignDocument, options: { includeScene?: boolean } = { includeScene: true }): string {
  const h2d = toH2D(document);
  // Identify our own export. The importer may not accept every metadata
  // source; never impersonate a browser extension to gain compatibility.
  const metadata: FigmaMetadata & { dataType: "h2d"; source: "open-canvas"; capturedAtIso: string } = {
    dataType: "h2d",
    source: "open-canvas",
    capturedAtIso: new Date().toISOString(),
  };
  const meta = encodeBase64(JSON.stringify(metadata));
  // Match the official browser extension: its copy-all path serializes the
  // captured documents as an array, even when there is only one document.
  // Figma Desktop uses that array shape to distinguish H2D from ordinary HTML
  // selections. The parser remains permissive for legacy object payloads.
  const h2dPayload = encodeBase64(JSON.stringify([h2d]));
  // The official browser extension stores the marker comments inside
  // data-* attributes on empty spans. Figma's desktop importer recognizes
  // this exact clipboard shape; keep parser support for top-level comments
  // below so older captures remain readable.
  const h2dMarker = `<span data-h2d="${FIGH2D_OPEN}${h2dPayload}${FIGH2D_CLOSE}"></span>`;
  // Keep the authored scene alongside the official markers. Figma's native
  // importer ignores the product-specific comment, while the Open Canvas plugin
  // can consume the exact capture-time layout model instead of reverse-
  // engineering it from CSS strings and losing sizing/alignment metadata.
  const sceneMarker = options.includeScene === false
    ? ""
    : `<span data-open-canvas-scene="${OPEN_CANVAS_SCENE_OPEN}${encodeBase64(JSON.stringify(document))}${OPEN_CANVAS_SCENE_CLOSE}"></span>`;
  const metadataMarker = `<span data-metadata="${FIGMETA_OPEN}${meta}${FIGMETA_CLOSE}"></span>`;
  return `${metadataMarker}${h2dMarker}${sceneMarker}`;
}

function markerPayload(
  html: string,
  attribute: "data-metadata" | "data-buffer" | "data-h2d" | "data-open-canvas-scene" | "data-neuxmind-scene",
  marker: "figmeta" | "figh2d" | "opencanvas" | "neuxscene",
): string | null {
  const section = `\\(${marker}\\)`;
  const end = `\\(/${marker}\\)`;
  // Prefer raw comments for backwards compatibility, then read the official
  // data-* span form used by the browser extension.
  const comment = html.match(new RegExp(`<!--${section}([A-Za-z0-9+/=]+)${end}-->`));
  if (comment?.[1]) return comment[1];
  const escapedComment = html.match(new RegExp(`&lt;!--${section}([A-Za-z0-9+/=]+)${end}--&gt;`));
  if (escapedComment?.[1]) return escapedComment[1];
  const direct = html.match(new RegExp(`${attribute}="[^"]*?${section}([A-Za-z0-9+/=]+)${end}`));
  if (direct?.[1]) return direct[1];

  // Chromium serializes HTML clipboard attributes and escapes the comment
  // delimiters (`&lt;!--...--&gt;`). Parse the attribute through DOMParser so
  // both the original Blob and the normalized clipboard representation work.
  if (typeof DOMParser !== "undefined") {
    try {
      const parsed = new DOMParser().parseFromString(html, "text/html");
      const value = parsed.querySelector(`[${attribute}]`)?.getAttribute(attribute) ?? "";
      const decoded = value.match(new RegExp(`${section}([A-Za-z0-9+/=]+)${end}`));
      if (decoded?.[1]) return decoded[1];
    } catch {
      // Fall through to the escaped-string form below.
    }
  }

  const escaped = html.match(new RegExp(`${attribute}="[^"]*?&lt;!--\\(${marker}\\)([A-Za-z0-9+/=]+)\\(/${marker}\\)--&gt;`));
  return escaped?.[1] ?? null;
}

export function parseFigmaHtml(html: string): { metadata: FigmaMetadata; h2d: H2DDocument; scene?: DesignDocument } {
  const metadataPayload = markerPayload(html, "data-metadata", "figmeta");
  const h2dPayload = markerPayload(html, "data-h2d", "figh2d")
    ?? markerPayload(html, "data-buffer", "figh2d");
  if (!metadataPayload || !h2dPayload) throw new Error("Figma H2D markers are missing");
  const metadata = JSON.parse(decodeBase64(metadataPayload)) as FigmaMetadata;
  const decoded = JSON.parse(decodeBase64(h2dPayload)) as H2DDocument | H2DDocument[];
  const h2d = Array.isArray(decoded) ? decoded[0] : decoded;
  if (h2d?.version !== 2 || !h2d.root) throw new Error("Unsupported Figma H2D document");
  const scenePayload = markerPayload(html, "data-open-canvas-scene", "opencanvas")
    ?? markerPayload(html, "data-neuxmind-scene", "neuxscene");
  if (!scenePayload) return { metadata, h2d };
  const scene = JSON.parse(decodeBase64(scenePayload)) as DesignDocument;
  if (scene?.version !== 1 || !scene.root || !Array.isArray(scene.root.children)) {
    throw new Error("Unsupported Open Canvas scene document");
  }
  return { metadata, h2d, scene };
}

export function wrapFigmaClipboardHtml(document: DesignDocument): string {
  // Match the official Figma H2D extension payload exactly: marker comments
  // live in data-* attributes on empty spans, without a surrounding document.
  return buildFigmaHtml(document, { includeScene: false });
}
