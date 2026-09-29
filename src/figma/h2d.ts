import type { DesignDocument } from "./designModel";

const MIN_USED_LINE_HEIGHT = 0.01;

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
  /**
   * Compatibility marker for bridges that preserve attributes but trim
   * extension fields/styles from anonymous text records.
   */
  attributes?: {
    "data-open-canvas-line-height"?: string;
    "data-open-canvas-text-indent"?: string;
    "data-open-canvas-text-rect"?: string;
    "data-open-canvas-text-line-rects"?: string;
    "data-open-canvas-line-count"?: string;
    "data-open-canvas-text-wrapping"?: string;
    "data-open-canvas-geometry-lock"?: string;
    "data-open-canvas-position-offset"?: string;
    "data-open-canvas-flex"?: string;
    "data-open-canvas-auto-margins"?: string;
    "data-open-canvas-container-queries"?: string;
    "data-open-canvas-structural-semantics"?: string;
    "data-open-canvas-structural-semantic-owners"?: string;
  };
  /** Resolved CSS line box, including inherited line-height values. */
  lineHeight?: number;
  /**
   * Compatibility copy of the replay styles for bridges that preserve
   * computed-style fields while trimming the raw `styles` object from a
   * TEXT_NODE record. H2D consumers may ignore this extension.
   */
  computedStyles?: Record<string, string>;
  /**
   * CSS replay fallback for H2D consumers that do not read the Open Canvas
   * numeric `lineHeight` extension field on text nodes. The official Figma
   * importer normally inherits this from the element wrapper; keeping the
   * declaration on the text record as well makes the value survive importers
   * that materialize text nodes without applying inherited wrapper styles.
   */
  styles?: {
    position?: string;
    left?: string;
    top?: string;
    lineHeight?: string;
    /** CSS spelling retained for bridges that do not camel-case style keys. */
    "line-height"?: string;
    textIndent?: string;
    fontFamily?: string;
    fontSize?: string;
    fontWeight?: string;
    fontSynthesis?: string;
    fontSynthesisWeight?: string;
    fontSynthesisStyle?: string;
    fontSynthesisSmallCaps?: string;
    fontSynthesisPosition?: string;
    order?: string;
    zIndex?: string;
    fontStyle?: string;
    fontStretch?: string;
    letterSpacing?: string;
    wordSpacing?: string;
    textAlign?: string;
    textAlignLast?: string;
    textJustify?: string;
    textTransform?: string;
    color?: string;
    textShadow?: string;
    WebkitTextStrokeWidth?: string;
    WebkitTextStrokeColor?: string;
    WebkitTextFillColor?: string;
    whiteSpace?: string;
    direction?: string;
    textDecoration?: string;
    textDecorationStyle?: string;
    textDecorationColor?: string;
    textDecorationThickness?: string;
    textUnderlineOffset?: string;
    textOverflow?: string;
    lineClamp?: string;
    verticalAlign?: string;
    overflowWrap?: string;
    wordBreak?: string;
    hyphens?: string;
    fontKerning?: string;
    fontFeatureSettings?: string;
    fontVariationSettings?: string;
    fontVariant?: string;
    fontVariantAlternates?: string;
    fontVariantCaps?: string;
    fontVariantEastAsian?: string;
    fontVariantLigatures?: string;
    fontVariantNumeric?: string;
    fontVariantPosition?: string;
    fontOpticalSizing?: string;
    fontSizeAdjust?: string;
    textRendering?: string;
    writingMode?: string;
    textOrientation?: string;
    unicodeBidi?: string;
    textWrapStyle?: string;
    textWrapMode?: string;
    whiteSpaceCollapse?: string;
    textBoxTrim?: string;
    textBoxEdge?: string;
  };
}

type H2DNode = H2DElementNode | H2DTextNode;

interface H2DElementNode {
  nodeType: 1;
  id: string;
  tag: string;
  attributes: Record<string, string>;
  styles: Record<string, string>;
  computedStyles?: Record<string, string>;
  /** Open Canvas layout intent; ignored by generic H2D consumers. */
  layout?: DesignDocument["root"]["layout"];
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

export interface H2DSerializeOptions {
  /**
   * Put anonymous text runs behind an inline element with an explicit pixel
   * line-height. Figma Desktop builds are more consistent with CSS declared on
   * an element than with the optional lineHeight field on a raw TEXT_NODE.
   */
  forceLineHeightWrappers?: boolean;
}

export function toH2D(document: DesignDocument, options: H2DSerializeOptions = {}): H2DDocument {
  const assetById = new Map(document.assets.map((asset) => [asset.id, asset]));
  const assets = Object.fromEntries(document.assets.map((asset) => {
    const url = asset.src ?? asset.id;
    const blob = asset.data?.startsWith("data:")
      // The observed Figma-compatible serializer names this field `base64Blob`, but its
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
  // Keep the compatibility tree close to the observed browser-export shape.
  // The importer already consumes each node's absolute `rect`; turning the
  // shared scene's geometryLock flag into CSS `position:absolute` applies the
  // same coordinates a second time and breaks normal flex/block flow.
  // geometryLock remains available in the shared scene for the Neuxmind
  // plugin bridge, but is intentionally ignored by this official channel.
  const root = toH2DElement(h2dRoot, assetById, { x: 0, y: 0 }, undefined, false, options);
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

function numericPxValue(value: number | string | null | undefined): number {
  const raw = typeof value === "string" ? value.trim() : "";
  return typeof value === "number"
    ? value
    : /^[-+]?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(raw)
      ? Number.parseFloat(raw)
      : NaN;
}

function safePxNumber(value: number | string | null | undefined): number {
  const numeric = numericPxValue(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function px(value: number | string | null | undefined): string {
  const numeric = numericPxValue(value);
  return `${Number.isFinite(numeric) ? numeric : 0}px`;
}

/**
 * Resolve the line box used by the H2D CSS replay channel. Older or trimmed
 * scenes can omit the numeric text field; in that case `px(undefined)` would
 * emit `0px`, which collapses the imported leading instead of inheriting the
 * captured/computed value.
 */
function splitReplayCssArguments(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function replayLineHeightToken(
  value: string,
  fontSize: number,
  rootFontSize: number,
  lineHeightReference = fontSize * 1.2,
  rootLineHeight = rootFontSize * 1.2,
): number | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  const resolveTerm = (term: string): number | undefined => {
    const match = term.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|lh|rlh)?$/);
    if (!match) return undefined;
    const amount = Number.parseFloat(match[1]);
    if (!Number.isFinite(amount)) return undefined;
    const unit = match[2] || "unitless";
    if (unit === "px") return amount;
    if (unit === "rem") return amount * rootFontSize;
    if (unit === "%") return amount * fontSize / 100;
    if (unit === "lh") return amount * lineHeightReference;
    if (unit === "rlh") return amount * rootLineHeight;
    return amount * fontSize;
  };
  const resolveCalcExpression = (body: string): number | undefined => {
    const compact = body.replace(/\s+/g, "");
    const values: Array<{ value: number; unitless: boolean }> = [];
    const operators: string[] = [];
    let cursor = 0;
    let expectingValue = true;
    const operandPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|%|lh|rlh)?/i;
    while (cursor < compact.length) {
      if (expectingValue) {
        const match = compact.slice(cursor).match(operandPattern);
        if (!match) return undefined;
        const token = match[0];
        const unitless = !/(?:px|em|rem|%|lh|rlh)$/i.test(token);
        // A bare number inside calc is a scalar factor, not a unitless CSS
        // line-height multiplier (the latter only applies to the whole value).
        const value = unitless ? Number.parseFloat(token) : resolveTerm(token);
        if (value === undefined || !Number.isFinite(value)) return undefined;
        values.push({
          value,
          unitless,
        });
        cursor += token.length;
        expectingValue = false;
      } else {
        const operator = compact[cursor];
        if (!/[+\-*/]/.test(operator)) return undefined;
        operators.push(operator);
        cursor += 1;
        expectingValue = true;
      }
    }
    if (expectingValue || values.length !== operators.length + 1) return undefined;
    const reduced: Array<{ value: number; unitless: boolean } | string> = [values[0]];
    for (let index = 0; index < operators.length; index += 1) {
      const operator = operators[index];
      const next = values[index + 1];
      if (operator === "*" || operator === "/") {
        const previous = reduced[reduced.length - 1];
        if (typeof previous === "string") return undefined;
        if (operator === "*" && !previous.unitless && !next.unitless) return undefined;
        if (operator === "/" && (!next.unitless || Math.abs(next.value) < Number.EPSILON)) return undefined;
        previous.value = operator === "*" ? previous.value * next.value : previous.value / next.value;
        previous.unitless = operator === "*" ? previous.unitless && next.unitless : previous.unitless;
      } else {
        reduced.push(operator, next);
      }
    }
    let result = 0;
    let sign = 1;
    for (const entry of reduced) {
      if (typeof entry === "string") sign = entry === "+" ? 1 : -1;
      else result += sign * entry.value;
    }
    return Number.isFinite(result) ? result : undefined;
  };
  const direct = resolveTerm(normalized);
  if (direct !== undefined) return direct;
  if (normalized.startsWith("calc(") && normalized.endsWith(")")) {
    const body = normalized.slice(5, -1).trim();
    const resolved = resolveCalcExpression(body);
    if (resolved !== undefined) return resolved;
    return undefined;
  }
  const functionMatch = normalized.match(/^(min|max|clamp)\((.*)\)$/i);
  if (!functionMatch) return undefined;
  const values = splitReplayCssArguments(functionMatch[2]).map(entry => replayLineHeightToken(entry, fontSize, rootFontSize, lineHeightReference, rootLineHeight));
  if (!values.length || values.some(value => value === undefined || !Number.isFinite(value))) return undefined;
  const resolved = values as number[];
  const name = functionMatch[1].toLowerCase();
  if (name === "min") return Math.min(...resolved);
  if (name === "max") return Math.max(...resolved);
  return resolved.length === 3 ? Math.min(resolved[2], Math.max(resolved[0], resolved[1])) : undefined;
}

function replayLineHeight(
  node: DesignDocument["root"],
  inheritedNode?: DesignDocument["root"],
): number {
  const captured = Number(node.text?.lineHeight);
  // Clipboard bridges may preserve CSS declarations with their serialized
  // kebab-case name. Accept that alias before applying the generic fallback;
  // otherwise an inherited line box can disappear at the H2D boundary.
  const computed = String(node.computedStyles?.lineHeight ?? node.computedStyles?.["line-height"] ?? "").trim().toLowerCase();
  const pxMatch = computed.match(/^([+-]?(?:\d+\.?\d*|\.\d+))px$/);
  const computedPixels = pxMatch ? Number.parseFloat(pxMatch[1]) : NaN;
  const rawFontSize = node.text?.fontSize ?? node.computedStyles?.fontSize;
  const fontSize = typeof rawFontSize === "number"
    ? rawFontSize
    : Number.parseFloat(String(rawFontSize ?? "16"));
  const referenceFontSize = Number.isFinite(fontSize) && fontSize > 0 ? fontSize : 16;
  // A compatibility bridge may trim the anonymous text record's resolved
  // line-height while retaining the parent element's computed CSS. The
  // parent can be a frame (not a text node), so replayLineHeight(parent)
  // would otherwise return the generic 1.2em fallback and collapse inherited
  // leading when the native H2D payload is pasted directly into Figma.
  const inheritedResolved = inheritedNode
    ? (() => {
      const capturedParent = Number(inheritedNode.text?.lineHeight);
      if (Number.isFinite(capturedParent) && capturedParent > 0) return capturedParent;
      const parentStyles = inheritedNode.computedStyles ?? {};
      const parentToken = String(parentStyles.lineHeight ?? parentStyles["line-height"] ?? "").trim();
      if (!parentToken || ["normal", "initial", "inherit", "unset", "revert", "revert-layer"].includes(parentToken.toLowerCase())) {
        return replayLineHeight(inheritedNode);
      }
      const parentFontRaw = inheritedNode.text?.fontSize ?? parentStyles.fontSize;
      const parentFontSize = typeof parentFontRaw === "number"
        ? parentFontRaw
        : Number.parseFloat(String(parentFontRaw ?? "16"));
      const resolvedParentFontSize = Number.isFinite(parentFontSize) && parentFontSize > 0 ? parentFontSize : 16;
      const relativeToParent = /(?:%|em|lh|rlh)(?:$|[+*/\s)])/i.test(parentToken)
        || (parentToken.toLowerCase().startsWith("calc(") && /(?:%|em|lh|rlh)\b/i.test(parentToken));
      const resolved = replayLineHeightToken(
        parentToken,
        relativeToParent ? resolvedParentFontSize : referenceFontSize,
        16,
        resolvedParentFontSize * 1.2,
        resolvedParentFontSize * 1.2,
      );
      return Number.isFinite(resolved) && (resolved as number) > 0
        ? resolved
        : replayLineHeight(inheritedNode);
    })()
    : undefined;
  const inheritedValue = typeof inheritedResolved === "number"
    && Number.isFinite(inheritedResolved)
    && inheritedResolved > 0
    ? inheritedResolved
    : undefined;
  // Anonymous text nodes do not own a line-height declaration. A legacy
  // bridge can nevertheless leave the generic 1.2em number on the child
  // while the wrapper carries a larger inherited line box (for example
  // parent 28px, child font-size 16px -> stale 19.2px). Prefer the resolved
  // parent value in that narrow case so the native H2D clipboard path does
  // not collapse leading before the plugin can run its recovery pass.
  const genericFallback = referenceFontSize * 1.2;
  // A legacy bridge can materialize the anonymous run's generic `1.2em`
  // fallback in computedStyles as a pixel string (for example `19.2px`).
  // Treat that value the same as the numeric stale fallback below; raw text
  // nodes do not own an authored line-height declaration, so the parent box
  // remains authoritative. Element-backed text keeps an explicit pixel value
  // unless its own declaration is an inheritance keyword, handled below.
  const anonymousComputedGenericFallback = node.sourceTag === "#text"
    && Number.isFinite(computedPixels)
    && computedPixels > 0
    && Math.abs(computedPixels - genericFallback) <= 0.01;
  if (anonymousComputedGenericFallback && inheritedValue !== undefined
    && Math.abs(inheritedValue - computedPixels) > 0.01) {
    return inheritedValue;
  }
  const anonymousGenericFallback = node.sourceTag === "#text"
    && Number.isFinite(captured)
    && captured > 0
    && Math.abs(captured - genericFallback) <= 0.01;
  if (anonymousGenericFallback && inheritedValue !== undefined
    && Math.abs(inheritedValue - captured) > 0.01) {
    return inheritedValue;
  }
  // Element-backed text can retain an authored `inherit` keyword while a
  // compatibility bridge leaves the child's generic 1.2em number beside it.
  // Resolve the inherited declaration before accepting that stale numeric
  // field; otherwise the native H2D path collapses the parent's leading.
  const resolvedInheritedKeyword = ["inherit", "unset", "revert", "revert-layer"].includes(computed);
  const inheritedGenericFallback = inheritedValue !== undefined
    && (resolvedInheritedKeyword && (
      (Number.isFinite(captured) && captured > 0 && Math.abs(captured - genericFallback) <= 0.01)
      || (Number.isFinite(computedPixels) && computedPixels > 0 && Math.abs(computedPixels - genericFallback) <= 0.01)
    ));
  if (inheritedGenericFallback) return inheritedValue;
  // The captured text record is the resolved used line box that was measured
  // in the browser. A compatibility bridge can retain a stale computed pixel
  // value on the element wrapper (for example 19.2px from a child font-size)
  // while the text record already carries the inherited 28px line box. Prefer
  // the captured value when it is concrete; keep computedStyles as a fallback
  // only when the text record is missing or still contains the generic 1.2em
  // default.
  if (Number.isFinite(captured) && captured > 0) {
    const capturedIsGenericFallback = Math.abs(captured - genericFallback) <= 0.01;
    const computedIsConcrete = Number.isFinite(computedPixels) && computedPixels > 0;
    const computedIsNonGeneric = computedIsConcrete && Math.abs(computedPixels - genericFallback) > 0.01;
    if (!computedIsConcrete || !capturedIsGenericFallback || !computedIsNonGeneric) return captured;
    return computedPixels;
  }
  if (Number.isFinite(computedPixels) && computedPixels > 0) return computedPixels;
  const inheritedKeyword = ["inherit", "unset", "revert", "revert-layer"].includes(computed)
    || computed.startsWith("var(")
    || computed.startsWith("env(");
  // Anonymous text nodes do not own a CSS declaration. Legacy clipboard
  // bridges can leave their computed style empty or as the browser default
  // `normal`/`initial` while the wrapper carries an explicit line box. Treat
  // those values as inherited only for raw text nodes; an element-backed text
  // node with an authored `normal` declaration must keep its own font metrics.
  const anonymousInheritedDefault = node.sourceTag === "#text"
    && (computed === "" || computed === "normal" || computed === "initial");
  if (inheritedNode && (inheritedKeyword || anonymousInheritedDefault)) {
    if (inheritedValue !== undefined) return inheritedValue;
  }
  // Anonymous text nodes do not own a CSS declaration. A legacy payload can
  // nevertheless repeat the parent's percentage/em token on the child run;
  // those units were resolved on the declaring element before inheritance.
  // Reuse the parent's resolved pixel line box so a 20px parent with 150%
  // leading stays 30px even when the child glyph run is 16px.
  const inheritedRelative = inheritedNode && node.sourceTag === "#text"
    && /(?:%|em|lh|rlh)(?:$|[+*/\s)])/i.test(computed);
  if (inheritedRelative) {
    if (inheritedValue !== undefined) return inheritedValue;
  }
  // Legacy/trimmed scenes can retain the authored CSS token while dropping
  // the resolved numeric text field. Preserve CSS inheritance semantics for
  // those payloads instead of silently replacing 1.5/150%/1.5em with the
  // generic `normal` fallback used by older H2D bridges.
  const rootFontSize = Number.parseFloat(String(node.computedStyles?.rootFontSize ?? "16"));
  const rootSize = Number.isFinite(rootFontSize) && rootFontSize > 0 ? rootFontSize : 16;
  const rootLineHeight = Number.parseFloat(String(node.computedStyles?.rootLineHeight ?? ""));
  const resolvedRootLineHeight = Number.isFinite(rootLineHeight) && rootLineHeight > 0 ? rootLineHeight : rootSize * 1.2;
  const resolvedToken = replayLineHeightToken(
    computed,
    referenceFontSize,
    rootSize,
    inheritedValue ?? referenceFontSize * 1.2,
    resolvedRootLineHeight,
  );
  if (Number.isFinite(resolvedToken) && (resolvedToken as number) > 0) return resolvedToken as number;
  return Math.max(MIN_USED_LINE_HEIGHT, referenceFontSize * 1.2);
}

function textLineCount(content: string, captured: number | undefined, height: number, lineHeight: number): number {
  const parsed = Number(captured);
  const metadataCount = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
  return Math.max(
    metadataCount,
    String(content || "").split(/\r?\n/).length,
    Math.max(1, Math.ceil(height / Math.max(1, lineHeight))),
  );
}

function textReplayStyles(node: DesignDocument["root"]): NonNullable<H2DTextNode["styles"]> {
  const text = node.text;
  if (!text) return {};
  const lineHeight = px(replayLineHeight(node));
  return {
    lineHeight,
    // Some H2D/clipboard bridges preserve authored CSS property names rather
    // than the camelCase keys used by the official payload. Carry both forms
    // with the same resolved pixel value so inherited leading is not dropped.
    "line-height": lineHeight,
    fontFamily: node.computedStyles?.fontFamily ?? text.fontFamily,
    fontSize: px(text.fontSize),
    fontWeight: String(text.fontWeight),
    ...(node.layout.order ? { order: String(node.layout.order) } : {}),
    ...(node.zIndex != null ? { zIndex: String(node.zIndex) } : {}),
    fontStyle: text.fontStyle ?? "normal",
    fontStretch: node.computedStyles?.fontStretch ?? "100%",
    letterSpacing: px(text.letterSpacing),
    wordSpacing: px(text.wordSpacing ?? 0),
    textAlign: text.textAlign === "left" ? "start" : text.textAlign === "right" ? "end" : text.textAlign === "justified" ? "justify" : text.textAlign,
    ...((node.computedStyles?.textAlignLast ?? text.textAlignLast) ? { textAlignLast: node.computedStyles?.textAlignLast ?? text.textAlignLast } : {}),
    ...((node.computedStyles?.textJustify ?? text.textJustify) ? { textJustify: node.computedStyles?.textJustify ?? text.textJustify } : {}),
    textTransform: text.textTransform ?? "none",
    ...(node.fill?.color ? { color: color(node.fill.color) } : {}),
    ...(text.textShadow ? { textShadow: text.textShadow } : {}),
    ...((text.textStrokeWidth ?? 0) > 0 ? {
      WebkitTextStrokeWidth: px(text.textStrokeWidth as number),
      WebkitTextStrokeColor: text.textStrokeColor ?? node.fill?.color ?? "currentcolor",
    } : {}),
    ...(text.textFillColor ? { WebkitTextFillColor: text.textFillColor } : {}),
    whiteSpace: text.whiteSpace ?? "pre-wrap",
    direction: text.direction ?? "ltr",
    textDecoration: text.textDecoration ?? "none",
    textDecorationStyle: text.textDecorationStyle ?? "solid",
    ...(text.textDecorationColor ? { textDecorationColor: text.textDecorationColor } : {}),
    ...(text.textDecorationThickness ? { textDecorationThickness: text.textDecorationThickness } : {}),
    ...(text.textUnderlineOffset ? { textUnderlineOffset: text.textUnderlineOffset } : {}),
    textOverflow: text.textOverflow ?? "clip",
    ...(text.maxLines && text.maxLines > 0 ? { lineClamp: String(text.maxLines) } : {}),
    verticalAlign: text.verticalAlign ?? "baseline",
    overflowWrap: text.overflowWrap ?? "normal",
    wordBreak: text.wordBreak ?? "normal",
    hyphens: text.hyphens ?? "manual",
    fontKerning: node.computedStyles?.fontKerning ?? "auto",
    fontFeatureSettings: node.computedStyles?.fontFeatureSettings ?? "normal",
    fontVariationSettings: node.computedStyles?.fontVariationSettings ?? "normal",
    fontSynthesis: node.computedStyles?.fontSynthesis ?? text.fontSynthesis ?? "auto",
    fontSynthesisWeight: node.computedStyles?.fontSynthesisWeight ?? text.fontSynthesisWeight ?? "auto",
    fontSynthesisStyle: node.computedStyles?.fontSynthesisStyle ?? text.fontSynthesisStyle ?? "auto",
    fontSynthesisSmallCaps: node.computedStyles?.fontSynthesisSmallCaps ?? text.fontSynthesisSmallCaps ?? "auto",
    fontSynthesisPosition: node.computedStyles?.fontSynthesisPosition ?? text.fontSynthesisPosition ?? "auto",
    fontVariant: node.computedStyles?.fontVariant ?? "normal",
    fontVariantAlternates: node.computedStyles?.fontVariantAlternates ?? "normal",
    fontVariantCaps: node.computedStyles?.fontVariantCaps ?? "normal",
    fontVariantEastAsian: node.computedStyles?.fontVariantEastAsian ?? "normal",
    fontVariantLigatures: node.computedStyles?.fontVariantLigatures ?? "normal",
    fontVariantNumeric: node.computedStyles?.fontVariantNumeric ?? "normal",
    fontVariantPosition: node.computedStyles?.fontVariantPosition ?? "normal",
    fontOpticalSizing: node.computedStyles?.fontOpticalSizing ?? "auto",
    fontSizeAdjust: node.computedStyles?.fontSizeAdjust ?? "none",
    textRendering: node.computedStyles?.textRendering ?? "auto",
    writingMode: node.computedStyles?.writingMode ?? "horizontal-tb",
    textOrientation: node.computedStyles?.textOrientation ?? "mixed",
    unicodeBidi: node.computedStyles?.unicodeBidi ?? "normal",
    textWrapStyle: node.computedStyles?.textWrapStyle ?? "auto",
    ...(node.computedStyles?.textWrapMode ? { textWrapMode: node.computedStyles.textWrapMode } : {}),
    ...(node.computedStyles?.whiteSpaceCollapse ? { whiteSpaceCollapse: node.computedStyles.whiteSpaceCollapse } : {}),
    ...(node.computedStyles?.textBoxTrim ? { textBoxTrim: node.computedStyles.textBoxTrim } : {}),
    ...(node.computedStyles?.textBoxEdge ? { textBoxEdge: node.computedStyles.textBoxEdge } : {}),
    ...(Math.abs(text.textIndent ?? 0) > 0.01 ? { textIndent: px(text.textIndent as number) } : {}),
  };
}

/** Preserve non-default whitespace/wrapping controls beside replay styles. */
function h2dTextWrappingMetadata(node: DesignDocument["root"]): string | undefined {
  if (!node.text) return undefined;
  const styles = node.computedStyles ?? {};
  const values: Record<string, string> = {};
  const fields: Array<[string, string | undefined, string]> = [
    ["whiteSpace", styles.whiteSpace ?? node.text.whiteSpace, "normal"],
    ["overflowWrap", styles.overflowWrap ?? node.text.overflowWrap, "normal"],
    ["wordBreak", styles.wordBreak ?? node.text.wordBreak, "normal"],
    ["hyphens", styles.hyphens ?? node.text.hyphens, "manual"],
    ["textWrapStyle", styles.textWrapStyle, "auto"],
    ["textWrapMode", styles.textWrapMode ?? node.text.textWrapMode, "wrap"],
    ["whiteSpaceCollapse", styles.whiteSpaceCollapse ?? node.text.whiteSpaceCollapse, "collapse"],
    ["textBoxTrim", styles.textBoxTrim ?? node.text.textBoxTrim, "none"],
    ["textBoxEdge", styles.textBoxEdge ?? node.text.textBoxEdge, "auto"],
  ];
  for (const [key, value, defaultValue] of fields) {
    const normalized = String(value ?? "").trim();
    if (normalized && normalized.toLowerCase() !== defaultValue) values[key] = normalized;
  }
  return Object.keys(values).length ? JSON.stringify({ values, measuredGeometry: true }) : undefined;
}

function color(value?: string): string {
  return value && value !== "transparent" ? value : "rgba(0, 0, 0, 0)";
}

function filterOpacity(value?: string): number {
  if (!value || value === "none") return 1;
  let result = 1;
  let found = false;
  for (const match of String(value).matchAll(/opacity\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+))(%)?\s*\)/gi)) {
    const raw = Number.parseFloat(match[1]);
    if (!Number.isFinite(raw)) continue;
    const factor = match[2] ? raw / 100 : raw;
    result *= Math.max(0, Math.min(1, factor));
    found = true;
  }
  return found ? Math.max(0, Math.min(1, result)) : 1;
}

function h2dLayoutMetadata(node: DesignDocument["root"]): H2DElementNode["layout"] {
  const layout = node.layout;
  // Keep the official H2D tree free of internal visual-lock flags and default
  // fixed sizing, but retain a contract whenever the node has actual layout
  // semantics. A fixed-size Auto Layout frame can still have authored
  // direction, gap, padding, wrapping, or alignment that must survive a
  // clipboard bridge which trims CSS/custom object fields.
  const hasLayoutSemantics = layout.mode !== "none"
    || layout.widthMode !== "fixed"
    || layout.heightMode !== "fixed"
    || Boolean(layout.widthExpression)
    || Boolean(layout.heightExpression)
    || Boolean(layout.placeContent)
    || Boolean(layout.autoMargins?.some(Boolean))
    || Boolean(layout.gapExpression || layout.rowGapExpression || layout.columnGapExpression);
  if (!hasLayoutSemantics) return undefined;
  const portable = Object.fromEntries(
    Object.entries(layout).filter(([key]) => key !== "geometryLock" && key !== "visualSnapshot"),
  );
  return { ...portable, padding: [...layout.padding] } as H2DElementNode["layout"];
}

/** Preserve responsive min/max bounds when a bridge trims replay styles. */
function h2dSizingConstraintMetadata(
  node: DesignDocument["root"],
  computed?: Record<string, string>,
): string | undefined {
  const defaults = { minWidth: "auto", maxWidth: "none", minHeight: "auto", maxHeight: "none" };
  const markerValues = parsedH2DConstraintMarker(node.attributes?.["data-open-canvas-sizing-constraints"]);
  const values = Object.fromEntries(Object.entries(defaults)
    .map(([key, fallback]) => {
      const candidates = [
        node.sizingConstraints?.[key as keyof typeof defaults],
        computed?.[key],
        markerValues?.[key],
      ].map((value) => String(value ?? "").trim()).filter(Boolean);
      // Browser computed styles commonly expose the default (`auto`/`none`)
      // even when the authored responsive bound survived only in the marker.
      // Prefer the first non-default candidate so that a compatibility bridge
      // cannot hide a real min/max expression behind that resolved default.
      const resetTokens = new Set(["initial", "unset", "revert", "revert-layer"]);
      const value = candidates.find((candidate) => {
        const normalized = candidate.toLowerCase();
        return normalized !== fallback && !resetTokens.has(normalized);
      }) || candidates[0] || "";
      return [key, value];
    })
    .filter(([key, value]) => {
      const normalized = String(value).toLowerCase();
      return Boolean(value)
        && normalized !== defaults[key as keyof typeof defaults]
        && !["initial", "unset", "revert", "revert-layer"].includes(normalized);
    }));
  return Object.keys(values).length ? JSON.stringify({ values, measuredGeometry: true }) : undefined;
}

/** Preserve the authored aspect-ratio beside the replay styles. */
function h2dAspectRatioMetadata(
  node: DesignDocument["root"],
  computed?: Record<string, string>,
): string | undefined {
  const markerValues = parsedH2DConstraintMarker(node.attributes?.["data-open-canvas-aspect-ratio"]);
  const candidates = [
    computed?.aspectRatio,
    markerValues?.value,
    markerValues?.aspectRatio,
  ].map((value) => String(value ?? "").trim()).filter(Boolean);
  const value = candidates.find((candidate) => ![
    "auto", "initial", "unset", "revert", "revert-layer",
  ].includes(candidate.toLowerCase())) || "";
  return value ? JSON.stringify({ value, measuredGeometry: true }) : undefined;
}

/**
 * Preserve CSS containment as a compact, inspectable marker beside the H2D
 * replay styles.  Figma has no equivalent subtree constraint for layout,
 * size, or style containment, but the plugin can retain the authored contract
 * on the imported node instead of losing it when a clipboard bridge trims
 * computed styles.
 */
function containmentMarkerValue(marker: string | undefined): string | undefined {
  const raw = String(marker ?? "").trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as { value?: unknown };
    const value = String(parsed?.value ?? "").trim().toLowerCase();
    return value && value !== "none" ? value : undefined;
  } catch {
    return undefined;
  }
}

function h2dContainmentMetadata(value: string | undefined, marker?: string): string | undefined {
  const computed = String(value ?? "").trim().toLowerCase();
  const markerValue = containmentMarkerValue(marker);
  // A compatibility bridge may preserve a real authored containment marker
  // while exposing the browser default `none` in the computed-style map.
  // Treat that default as missing so the authored constraint survives the
  // H2D boundary instead of being silently downgraded.
  const normalized = markerValue && (!computed || computed === "none") ? markerValue : (computed || markerValue || "none");
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length || (tokens.length === 1 && tokens[0] === "none")) return undefined;
  return JSON.stringify({
    value: normalized,
    tokens,
    layout: tokens.includes("layout") || tokens.includes("strict") || tokens.includes("content"),
    paint: tokens.includes("paint") || tokens.includes("strict") || tokens.includes("content"),
    size: tokens.includes("size") || tokens.includes("strict"),
    style: tokens.includes("style") || tokens.includes("strict"),
    content: tokens.includes("content"),
  });
}

function parsedH2DConstraintMarker(marker: string | undefined): Record<string, unknown> | undefined {
  const raw = String(marker ?? "").trim();
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return undefined;
    const values = parsed.values;
    if (values && typeof values === "object" && !Array.isArray(values)) return values as Record<string, unknown>;
    return parsed;
  } catch {
    return undefined;
  }
}

function h2dDefaultedConstraintStyles(
  computed: Record<string, string> | undefined,
  marker: string | undefined,
  defaults: Record<string, string>,
): Record<string, string> {
  const markerValues = parsedH2DConstraintMarker(marker);
  if (!markerValues) return {};
  const resetTokens = new Set(["initial", "unset", "revert", "revert-layer"]);
  return Object.fromEntries(Object.entries(markerValues).filter(([key, value]) => {
    if (!Object.prototype.hasOwnProperty.call(defaults, key)) return false;
    const current = String(computed?.[key] ?? "").trim().toLowerCase();
    const defaultValue = defaults[key].toLowerCase();
    return Boolean(String(value ?? "").trim()) && (!current || current === defaultValue || resetTokens.has(current));
  }).map(([key, value]) => [key, String(value)]));
}

/** Preserve Grid auto-placement semantics when a bridge trims layout fields. */
function h2dGridFlowMetadata(node: DesignDocument["root"]): string | undefined {
  const computedValue = String(node.layout.gridAutoFlow ?? node.computedStyles?.gridAutoFlow ?? "").trim().toLowerCase();
  const markerValue = String(parsedH2DConstraintMarker(node.attributes?.["data-open-canvas-grid-flow"])?.value ?? "").trim().toLowerCase();
  const value = markerValue && (!computedValue || computedValue === "row") ? markerValue : computedValue;
  if (!value || value === "row") return undefined;
  return JSON.stringify({
    value,
    dense: /\bdense\b/.test(value),
    measuredGeometry: true,
    nativeAutoLayoutEquivalent: !/\bdense\b/.test(value),
  });
}

/** Preserve CSS multi-column declarations beside the measured geometry. */
function h2dMultiColumnMetadata(computed: Record<string, string> | undefined, marker?: string): string | undefined {
  const styles = {
    ...(computed ?? {}),
    ...h2dDefaultedConstraintStyles(computed, marker, { columnCount: "auto", columnWidth: "auto", columnGap: "normal", columnFill: "balance" }),
  };
  const count = String(styles.columnCount ?? "auto").trim();
  const width = String(styles.columnWidth ?? "auto").trim();
  if ((!count || count.toLowerCase() === "auto") && (!width || width.toLowerCase() === "auto")) return undefined;
  return JSON.stringify({
    columnCount: count || "auto",
    columnWidth: width || "auto",
    columnGap: String(styles.columnGap ?? "normal").trim() || "normal",
    columnFill: String(styles.columnFill ?? "balance").trim() || "balance",
    measuredGeometry: true,
    nativeAutoLayoutEquivalent: false,
  });
}

/** Preserve non-default scroll constraints when a clipboard bridge trims CSS. */
function h2dScrollConstraintMetadata(computed: Record<string, string> | undefined, marker?: string): string | undefined {
  const defaults: Record<string, string> = {
    scrollSnapType: "none",
    scrollSnapAlign: "none",
    scrollSnapStop: "normal",
    scrollBehavior: "auto",
    overscrollBehavior: "auto",
    overscrollBehaviorX: "auto",
    overscrollBehaviorY: "auto",
  };
  const styles = { ...(computed ?? {}), ...h2dDefaultedConstraintStyles(computed, marker, defaults) };
  const nonDefault = Object.fromEntries(Object.entries(defaults)
    .map(([key, fallback]) => [key, String(styles[key] ?? fallback).trim() || fallback])
    .filter(([key, value]) => value !== defaults[key]));
  if (!Object.keys(nonDefault).length) return undefined;
  return JSON.stringify({ values: nonDefault, measuredGeometry: true, nativeScrollEquivalent: false });
}

/** Preserve the flex item contract when a clipboard bridge trims CSS styles. */
function h2dFlexMetadata(computed: Record<string, string> | undefined, marker?: string): string | undefined {
  const styles = {
    ...(computed ?? {}),
    ...h2dDefaultedConstraintStyles(computed, marker, { flexGrow: "0", flexShrink: "1", flexBasis: "auto" }),
  };
  const flexGrow = String(styles.flexGrow ?? "0").trim() || "0";
  const flexShrink = String(styles.flexShrink ?? "1").trim() || "1";
  const flexBasis = String(styles.flexBasis ?? "auto").trim() || "auto";
  if (flexGrow === "0" && flexShrink === "1" && flexBasis.toLowerCase() === "auto") return undefined;
  return JSON.stringify({
    values: { flexGrow, flexShrink, flexBasis },
    measuredGeometry: true,
    nativeGrowEquivalent: true,
    nativeShrinkEquivalent: flexShrink === "0",
    nativeBasisEquivalent: false,
  });
}

/**
 * Preserve CSS Anchor Positioning as measured geometry plus an inspectable
 * authored contract. Figma has no native equivalent for anchor() resolution,
 * position-area, or anchor scoping, so the plugin must not pretend that an
 * Auto Layout constraint was created.
 */
function h2dAnchorPositioningMetadata(computed: Record<string, string> | undefined, marker?: string): string | undefined {
  const defaults: Record<string, string> = {
    anchorName: "none",
    anchorScope: "none",
    insetArea: "none",
    positionAnchor: "none",
    positionArea: "none",
    positionTry: "none",
    positionTryFallbacks: "none",
    positionTryOrder: "normal",
    positionVisibility: "always",
  };
  const styles = { ...(computed ?? {}), ...h2dDefaultedConstraintStyles(computed, marker, defaults) };
  const values = Object.fromEntries(Object.entries(defaults)
    .map(([key, fallback]) => [key, String(styles[key] ?? fallback).trim() || fallback])
    .filter(([key, value]) => value !== defaults[key]));
  if (!Object.keys(values).length) return undefined;
  return JSON.stringify({
    values,
    measuredGeometry: true,
    nativeEquivalent: false,
  });
}

/** Preserve container-query conditions beside the measured H2D geometry. */
function h2dContainerQueryMetadata(computed: Record<string, string> | undefined, marker?: string): string | undefined {
  const defaults: Record<string, string> = {
    container: "normal",
    containerName: "none",
    containerType: "normal",
  };
  const styles = { ...(computed ?? {}), ...h2dDefaultedConstraintStyles(computed, marker, defaults) };
  const values = Object.fromEntries(Object.entries(defaults)
    .map(([key, fallback]) => [key, String(styles[key] ?? fallback).trim() || fallback])
    .filter(([key, value]) => value !== defaults[key]));
  if (!Object.keys(values).length) return undefined;
  return JSON.stringify({
    values,
    measuredGeometry: true,
    nativeEquivalent: false,
  });
}

/** Preserve clipping, masking, and overflow declarations beside H2D geometry. */
function h2dVisualConstraintMetadata(
  node: DesignDocument["root"],
  computed: Record<string, string> | undefined,
  marker?: string,
): string | undefined {
  const markerStyles = h2dDefaultedConstraintStyles(computed, marker, {
    clipPath: "none",
    clip: "auto",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    overflowClipMargin: "0px",
    overflowClipMarginBlock: "0px",
    overflowClipMarginBlockStart: "0px",
    overflowClipMarginBlockEnd: "0px",
    overflowClipMarginInline: "0px",
    overflowClipMarginInlineStart: "0px",
    overflowClipMarginInlineEnd: "0px",
    maskImage: "none",
    maskPosition: "0% 0%",
    maskSize: "auto",
    maskRepeat: "repeat",
    maskClip: "border-box",
    maskOrigin: "border-box",
    maskMode: "match-source",
    maskComposite: "add",
    maskType: "luminance",
    borderImageSource: "none",
    borderImageSlice: "100%",
    borderImageRepeat: "stretch",
    borderImageWidth: "1",
    borderImageOutset: "0",
    opacity: "1",
    backgroundAttachment: "scroll",
    objectFit: "fill",
    objectPosition: "50% 50%",
    objectViewBox: "none",
    filter: "none",
    backdropFilter: "none",
    mixBlendMode: "normal",
    backgroundBlendMode: "normal",
    isolation: "auto",
  });
  const styles = { ...(computed ?? {}), ...markerStyles };
  const nonDefaultNodeValue = (value: string | number | undefined, defaultValue: string): string | undefined => {
    const normalized = String(value ?? "").trim();
    return normalized && normalized.toLowerCase() !== defaultValue.toLowerCase() ? normalized : undefined;
  };
  // `opacity()` is materialized into the element opacity below. Keep it out of
  // the compatibility marker as well, otherwise a trimmed bridge would apply
  // the same opacity once through the node and once through the filter string.
  const filterValue = nonDefaultNodeValue(node.filter, "none") ?? (String(styles.filter ?? "none").trim() || "none");
  const filter = removeFilterOpacity(filterValue);
  const backdropFilter = nonDefaultNodeValue(node.backdropFilter, "none") ?? (String(styles.backdropFilter ?? "none").trim() || "none");
  const backgroundAttachment = nonDefaultNodeValue(node.backgroundAttachment, "scroll") ?? (String(styles.backgroundAttachment ?? "scroll").trim() || "scroll");
  const objectFit = nonDefaultNodeValue(node.objectFit, "fill") ?? (String(styles.objectFit ?? "fill").trim() || "fill");
  const objectPosition = nonDefaultNodeValue(node.objectPosition, "50% 50%") ?? (String(styles.objectPosition ?? "50% 50%").trim() || "50% 50%");
  const objectViewBox = nonDefaultNodeValue(node.objectViewBox, "none") ?? (String(styles.objectViewBox ?? "none").trim() || "none");
  const overflowClipMargin = String(styles.overflowClipMargin ?? "0px").trim() || "0px";
  const overflowClipMarginBlock = String(styles.overflowClipMarginBlock ?? "0px").trim() || "0px";
  const overflowClipMarginBlockStart = String(styles.overflowClipMarginBlockStart ?? "0px").trim() || "0px";
  const overflowClipMarginBlockEnd = String(styles.overflowClipMarginBlockEnd ?? "0px").trim() || "0px";
  const overflowClipMarginInline = String(styles.overflowClipMarginInline ?? "0px").trim() || "0px";
  const overflowClipMarginInlineStart = String(styles.overflowClipMarginInlineStart ?? "0px").trim() || "0px";
  const overflowClipMarginInlineEnd = String(styles.overflowClipMarginInlineEnd ?? "0px").trim() || "0px";
  const sourceOpacity = Number(Number(node.opacity ?? 1) !== 1 ? node.opacity : (styles.opacity ?? 1));
  const effectiveOpacity = Math.max(0, Math.min(1,
    (Number.isFinite(sourceOpacity) ? sourceOpacity : 1) * filterOpacity(filterValue),
  ));
  const defaults: Record<string, string> = {
    clipPath: "none",
    clip: "auto",
    overflow: "visible",
    overflowX: "visible",
    overflowY: "visible",
    overflowClipMargin: "0px",
    overflowClipMarginBlock: "0px",
    overflowClipMarginBlockStart: "0px",
    overflowClipMarginBlockEnd: "0px",
    overflowClipMarginInline: "0px",
    overflowClipMarginInlineStart: "0px",
    overflowClipMarginInlineEnd: "0px",
    maskImage: "none",
    maskPosition: "0% 0%",
    maskSize: "auto",
    maskRepeat: "repeat",
    maskClip: "border-box",
    maskOrigin: "border-box",
    maskMode: "match-source",
    maskComposite: "add",
    maskType: "luminance",
    borderImageSource: "none",
    borderImageSlice: "100%",
    borderImageRepeat: "stretch",
    borderImageWidth: "1",
    borderImageOutset: "0",
    opacity: "1",
    backgroundAttachment: "scroll",
    objectFit: "fill",
    objectPosition: "50% 50%",
    objectViewBox: "none",
    filter: "none",
    backdropFilter: "none",
    mixBlendMode: "normal",
    backgroundBlendMode: "normal",
    isolation: "auto",
  };
  const values = Object.fromEntries(Object.entries(defaults)
    .map(([key, fallback]) => {
      let aliases: Array<string | undefined>;
      if (key === "maskImage") aliases = [styles.maskImage, styles.webkitMaskImage, styles.WebkitMaskImage];
      else if (key === "opacity") aliases = [String(effectiveOpacity)];
      else if (key === "backgroundAttachment") aliases = [backgroundAttachment];
      else if (key === "objectFit") aliases = [objectFit];
      else if (key === "objectPosition") aliases = [objectPosition];
      else if (key === "objectViewBox") aliases = [objectViewBox];
      else if (key === "overflowClipMargin") aliases = [overflowClipMargin];
      else if (key === "overflowClipMarginBlock") aliases = [overflowClipMarginBlock];
      else if (key === "overflowClipMarginBlockStart") aliases = [overflowClipMarginBlockStart];
      else if (key === "overflowClipMarginBlockEnd") aliases = [overflowClipMarginBlockEnd];
      else if (key === "overflowClipMarginInline") aliases = [overflowClipMarginInline];
      else if (key === "overflowClipMarginInlineStart") aliases = [overflowClipMarginInlineStart];
      else if (key === "overflowClipMarginInlineEnd") aliases = [overflowClipMarginInlineEnd];
      else if (key === "filter") aliases = [filter];
      else if (key === "backdropFilter") aliases = [backdropFilter, styles.webkitBackdropFilter, styles.WebkitBackdropFilter];
      else aliases = [styles[key]];
      const meaningful = aliases.find((value) => {
        const normalized = String(value ?? "").trim().toLowerCase();
        return normalized && normalized !== fallback.toLowerCase();
      });
      return [key, String(meaningful ?? aliases.find(value => value != null) ?? fallback).trim() || fallback];
    })
    .filter(([key, value]) => value !== defaults[key]));
  if (!Object.keys(values).length) return undefined;
  return JSON.stringify({ values, measuredGeometry: true });
}

/** Preserve a captured transform when a bridge trims replay styles. */
function h2dTransformMetadata(
  node: DesignDocument["root"],
  computed: Record<string, string> | undefined,
  marker?: string,
): string | undefined {
  const markerValues = parsedH2DConstraintMarker(marker);
  const nodeTransform = String(node.transform ?? "").trim();
  const computedTransform = String(computed?.transform ?? "").trim();
  const markerTransform = String(markerValues?.transform ?? "").trim();
  const transform = [nodeTransform, computedTransform, markerTransform]
    .find(value => value && value.toLowerCase() !== "none") || "none";
  if (!transform || transform.toLowerCase() === "none") return undefined;
  const nodeTransformOrigin = String(node.transformOrigin ?? "").trim();
  const computedTransformOrigin = String(computed?.transformOrigin ?? "").trim();
  const markerTransformOrigin = String(markerValues?.transformOrigin ?? "").trim();
  const transformOrigin = [nodeTransformOrigin, computedTransformOrigin, markerTransformOrigin]
    .find(value => value && value !== "50% 50%") || "50% 50%";
  return JSON.stringify({ transform, transformOrigin, measuredGeometry: true });
}

function removeFilterOpacity(value?: string): string {
  const stripped = String(value || "")
    .replace(/opacity\(\s*-?(?:\d+(?:\.\d*)?|\.\d+)%?\s*\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || "none";
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
  const boxSizing = String(computed.boxSizing ?? "content-box").trim().toLowerCase();
  if (boxSizing === "border-box") return rect[axis];
  const computedValue = Number.parseFloat(computed[axis] ?? "");
  if (Number.isFinite(computedValue) && computedValue > 0) return computedValue;
  const padding = axis === "width"
    ? safePxNumber(node.layout.padding[1]) + safePxNumber(node.layout.padding[3])
    : safePxNumber(node.layout.padding[0]) + safePxNumber(node.layout.padding[2]);
  const borders = node.borders
    ? axis === "width"
      ? safePxNumber(node.borders[1]?.width) + safePxNumber(node.borders[3]?.width)
      : safePxNumber(node.borders[0]?.width) + safePxNumber(node.borders[2]?.width)
    : safePxNumber(node.stroke?.width) > 0
      ? safePxNumber(node.stroke?.width) * 2
      : 0;
  // `padding-box` includes padding in the authored CSS dimension, so only
  // the border separates it from the captured DOM border-box rectangle.
  const boxExtra = boxSizing === "padding-box" ? borders : padding + borders;
  return Math.max(0, rect[axis] - boxExtra);
}

function h2dBoxDimension(
  node: DesignDocument["root"],
  rect: H2DDocument["documentRect"],
  axis: "width" | "height",
  computed: Record<string, string>,
  measuredPosition: boolean,
  parentMode?: DesignDocument["root"]["layout"]["mode"],
): string {
  // The native H2D path can preserve CSS sizing expressions for ordinary
  // flow containers. Absolute/viewport-fixed layers and visual snapshots
  // must remain pinned to their measured border box; replaying a percentage
  // there would resolve against a different containing block and move the
  // layer. Intrinsic keywords are also left measured because Figma's HTML
  // importer does not expose a portable content-measurement contract.
  const rawExpression = axis === "width"
    ? node.layout.widthExpression
    : node.layout.heightExpression;
  const expression = String(rawExpression ?? "").trim();
  const normalized = expression.toLowerCase();
  const intrinsic = ["auto", "none", "max-content", "min-content", "fit-content"].includes(normalized)
    || normalized.startsWith("fit-content(");
  if (!measuredPosition && expression && !intrinsic) return expression;

  // A child can be inferred as FILL from a stretch relationship even when the
  // source stylesheet never authored width/height: 100%. Serializing only the
  // captured pixel box loses that relationship in the native H2D importer.
  // Re-introduce the percentage only on the cross axis, where it is equivalent
  // to CSS stretch. Main-axis FILL is often flex-grow and must remain measured
  // so it does not consume every sibling's space after paste.
  const crossAxisFill = (axis === "width" && parentMode === "vertical" && node.layout.widthMode === "fill")
    || (axis === "height" && parentMode === "horizontal" && node.layout.heightMode === "fill");
  if (!measuredPosition && !expression && crossAxisFill) {
    const padding = axis === "width"
      ? safePxNumber(node.layout.padding[1]) + safePxNumber(node.layout.padding[3])
      : safePxNumber(node.layout.padding[0]) + safePxNumber(node.layout.padding[2]);
    const borders = node.borders
      ? axis === "width"
        ? safePxNumber(node.borders[1]?.width) + safePxNumber(node.borders[3]?.width)
        : safePxNumber(node.borders[0]?.width) + safePxNumber(node.borders[2]?.width)
      : safePxNumber(node.stroke?.width) > 0
        ? safePxNumber(node.stroke?.width) * 2
        : 0;
    const boxSizing = String(node.computedStyles?.boxSizing ?? "content-box").trim().toLowerCase();
    // A padding-box declaration already includes padding in the authored
    // width/height. The native H2D expression therefore only needs to reserve
    // the border (plus margin); content-box reserves both padding and border,
    // while border-box reserves neither.
    const boxExtra = boxSizing === "border-box"
      ? 0
      : boxSizing === "padding-box"
        ? borders
        : padding + borders;
    const margin = axis === "width"
      ? safePxNumber(node.margin[1]) + safePxNumber(node.margin[3])
      : safePxNumber(node.margin[0]) + safePxNumber(node.margin[2]);
    const extra = Math.max(0, boxExtra + margin);
    return extra > 0.01 ? `calc(100% - ${extra}px)` : "100%";
  }
  return px(cssBoxDimension(node, rect, axis, computed));
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
    && (safePxNumber(padding[0]) > 0 || safePxNumber(padding[2]) > 0);
}

/**
 * Return one resolved line box when every editable text descendant shares the
 * same value.  H2D replays CSS inheritance, but trimmed/legacy payloads can
 * omit `line-height` from an intermediate wrapper.  Promoting a uniform value
 * to that wrapper keeps the native Figma importer from falling back to its
 * default leading.  Mixed typography deliberately returns undefined so a
 * parent multiplier or each child wrapper remains authoritative.
 */
function sharedTextDescendantLineHeight(node: DesignDocument["root"]): number | undefined {
  const values: number[] = [];
  const visit = (candidate: DesignDocument["root"]): void => {
    if (candidate.type === "text" && candidate.text && Number.isFinite(candidate.text.lineHeight) && candidate.text.lineHeight > 0) {
      values.push(candidate.text.lineHeight);
    }
    for (const child of candidate.children) visit(child);
  };
  visit(node);
  if (!values.length) return undefined;
  const first = values[0];
  return values.every((value) => Math.abs(value - first) < 0.01) ? first : undefined;
}

function canPromoteDescendantLineHeight(value?: string): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  // `normal` is the browser default, not an authored pixel line box. Treat
  // inheritance keywords the same way: if every editable descendant has one
  // resolved value, promoting that value prevents H2D importers from falling
  // back to their own font metrics at an intermediate wrapper.
  return !normalized || ["normal", "inherit", "unset", "revert", "revert-layer"].includes(normalized);
}

function distributionSensitiveLayout(layout: DesignDocument["root"]["layout"]): boolean {
  return layout.mode !== "none" && (
    layout.wrap === true
      || layout.reverse === true
      || ["center", "end", "space-between", "space-around", "space-evenly"].includes(String(layout.justifyContent ?? ""))
      || ["center", "end", "space-between", "space-around", "space-evenly"].includes(String(layout.alignContent ?? ""))
  );
}

function shouldMaterializeGeometryLock(
  node: DesignDocument["root"],
  parentNode?: DesignDocument["root"],
): boolean {
  if (!node.layout.geometryLock || !parentNode) return false;
  // CSS auto margins consume otherwise free space on a per-child basis.
  // Figma Auto Layout has no equivalent, so the portable H2D channel must
  // pin this child to its captured rectangle even when the parent otherwise
  // uses an ordinary start-aligned flow.
  if (node.layout.autoMargins?.some(Boolean)) return true;
  // Capture assigns locks to direct children of distribution-sensitive
  // containers, and to children of a measured visual group. Do not promote a
  // standalone/plugin hint to absolute CSS: that would remove it from an
  // otherwise ordinary flow and change the native H2D document semantics.
  return distributionSensitiveLayout(parentNode.layout)
    || (parentNode.layout.geometryLock === true && parentNode.layout.mode === "none");
}

function stylesFor(
  node: DesignDocument["root"],
  rect: H2DDocument["documentRect"],
  assetById: Map<string, DesignDocument["assets"][number]>,
  containingBorder: { left: number; top: number } = { left: 0, top: 0 },
  options: {
    visualSnapshot?: boolean;
    root?: boolean;
    parentOrigin?: { x: number; y: number };
    measuredLock?: boolean;
    parentMode?: DesignDocument["root"]["layout"]["mode"];
  } = {},
): Record<string, string> {
  const visualSnapshot = options.visualSnapshot === true;
  const measuredLock = options.measuredLock === true;
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
  const effectiveOpacity = Math.max(0, Math.min(1, Number(node.opacity ?? 1) * filterOpacity(node.filter)));
  const hiddenByContentVisibility = String(computed.contentVisibility || "visible").trim().toLowerCase() === "hidden";
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
  const maskImage = String(computed.maskImage || computed.webkitMaskImage || computed.WebkitMaskImage || "none").trim();
  const maskPosition = String(computed.maskPosition || computed.webkitMaskPosition || computed.WebkitMaskPosition || "0% 0%").trim();
  const maskSize = String(computed.maskSize || computed.webkitMaskSize || computed.WebkitMaskSize || "auto").trim();
  const maskRepeat = String(computed.maskRepeat || computed.webkitMaskRepeat || computed.WebkitMaskRepeat || "repeat").trim();
  const maskClip = String(computed.maskClip || computed.webkitMaskClip || computed.WebkitMaskClip || "border-box").trim();
  const maskOrigin = String(computed.maskOrigin || computed.webkitMaskOrigin || computed.WebkitMaskOrigin || "border-box").trim();
  const maskMode = String(computed.maskMode || computed.webkitMaskMode || computed.WebkitMaskMode || "match-source").trim();
  const maskComposite = String(computed.maskComposite || computed.webkitMaskComposite || computed.WebkitMaskComposite || "add").trim();
  const borderAt = (index: 0 | 1 | 2 | 3) => node.borders ? node.borders[index] : node.stroke;
  const topBorder = borderAt(0);
  const rightBorder = borderAt(1);
  const bottomBorder = borderAt(2);
  const leftBorder = borderAt(3);
  // CSS border-image is a single paint source even when the browser exposes
  // the resolved source on only one side. Prefer the first available gradient
  // across all sides so a right/bottom/left-only capture is not silently
  // downgraded to a solid stroke in the H2D compatibility channel.
  const borderGradient = [topBorder, rightBorder, bottomBorder, leftBorder]
    .find((border) => Boolean(border?.gradient))?.gradient;
  const borderImage = [topBorder, rightBorder, bottomBorder, leftBorder]
    .find((border) => Boolean(border?.imageSource));
  const borderImageAsset = borderImage?.imageAssetId ? assetById.get(borderImage.imageAssetId) : undefined;
  const borderImageSource = borderImage
    ? (borderImageAsset?.data || borderImage.imageSource)
    : undefined;
  const borderImagePaintWidth = [topBorder, rightBorder, bottomBorder, leftBorder]
    .map((border) => border?.paintWidth != null ? px(border.paintWidth) : border ? px(border.width) : "0px");
  const hasBorderImagePaintWidth = [topBorder, rightBorder, bottomBorder, leftBorder]
    .some((border) => border?.paintWidth != null);
  const borderImagePaintOutset = [topBorder, rightBorder, bottomBorder, leftBorder]
    .map((border) => px(border?.paintOutset ?? 0));
  const hasBorderImagePaintOutset = [topBorder, rightBorder, bottomBorder, leftBorder]
    .some((border) => numericPxValue(border?.paintOutset) > 0.01);
  const gradientBorderDetails = [topBorder, rightBorder, bottomBorder, leftBorder]
    .find((border) => Boolean(border?.gradient));
  const outline = node.outline;
  const shadow = node.shadow;
  // Figma's native H2D importer reliably reads line-height from the element
  // style, while the custom `lineHeight` field on a TEXT_NODE is not honored
  // by every Desktop version. Direct text runs inherit their typography from
  // this wrapper, so promote the already-resolved pixel value to the wrapper
  // whenever all direct text content shares the same line-height.
  const directTextChildren = node.children.filter((child) => child.type === "text" && child.text);
  const directTextLineHeight = directTextChildren.length > 0
    ? directTextChildren.every((child) => Math.abs((child.text?.lineHeight ?? 0) - (directTextChildren[0].text?.lineHeight ?? 0)) < 0.01)
      ? directTextChildren[0].text?.lineHeight
      : undefined
    : undefined;
  const descendantTextLineHeight = sharedTextDescendantLineHeight(node);
  const directTextAlign = directTextChildren.length > 0
    ? directTextChildren.every((child) => child.text?.textAlign === directTextChildren[0].text?.textAlign)
      ? directTextChildren[0].text?.textAlign
      : undefined
    : undefined;
  const directTextWordSpacing = directTextChildren.length > 0
    ? directTextChildren.every((child) => Math.abs((child.text?.wordSpacing ?? 0) - (directTextChildren[0].text?.wordSpacing ?? 0)) < 0.01)
      ? directTextChildren[0].text?.wordSpacing
      : undefined
    : undefined;
  // A locked node already carries its measured parent-relative coordinates.
  // Keeping the source margin as well makes HTML/H2D importers apply that
  // spacing a second time when they honor the absolute left/top pair.
  // The native Figma H2D importer cannot see the private shared-scene
  // `geometryLock` flag. Materialize only those selectively locked children as
  // measured absolute layers in the official channel so distributed/wrapped
  // tracks do not get reflowed by Figma's different font metrics. The Open
  // Canvas plugin recognizes the marker below and restores its editable
  // measured-flow placeholder instead of treating the layer as source CSS
  // absolute positioning.
  const isMeasuredPosition = snapshotAbsolute
    || measuredLock
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
  const parentCanMaterializeLocks = distributionSensitiveLayout(node.layout)
    || (node.layout.geometryLock === true && node.layout.mode === "none");
  const hasMeasuredChild = !options.root && node.children.some((child) =>
    (parentCanMaterializeLocks && child.layout.geometryLock === true)
      || child.positioning === "absolute"
      || child.positioning === "fixed"
      || child.positioning === "sticky"
      || child.layout.position === "absolute",
  );
  const sourcePosition = node.positioning && node.positioning !== "static"
    ? node.positioning
    : node.layout.position === "absolute" ? "absolute" : "static";
  const containingPosition = sourcePosition === "static" && hasMeasuredChild ? "relative" : sourcePosition;
  const margin = isMeasuredPosition ? [0, 0, 0, 0] : (node.margin ?? [0, 0, 0, 0]);
  const marginToken = (index: 0 | 1 | 2 | 3): string => node.layout.autoMargins?.[index] ? "auto" : px(margin[index]);
  const radius = node.radius ?? [0, 0, 0, 0];
  // H2D consumers can replay CSS's two-axis elliptical radii, while the
  // native plugin scene intentionally reduces them to Figma's one-value
  // corner radius. Prefer the captured computed CSS when available so the
  // clipboard path does not discard the vertical radius component.
  const radiusStyle = (property: string, fallback: number): string | undefined => {
    const captured = String(computed[property] ?? "").trim();
    if (captured && captured !== "0px" && captured !== "0px 0px") return captured;
    return fallback > 0 ? px(fallback) : undefined;
  };
  // `computedStyles` is the capture-time measurement channel.  The official
  // H2D serializer keeps it separate from the CSS replay map; spreading it
  // into `styles` makes Figma apply both the measured values and the authored
  // layout a second time.  In particular, resolved transform origins and
  // inset pairs are not safe CSS declarations when the node has no transform
  // or is still in normal flow.
  const replayComputed = {
    ...Object.fromEntries(
      Object.entries(computed).filter(([property]) => {
      if (["left", "right", "top", "bottom"].includes(property)) return false;
      if (["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight"].includes(property)) return false;
      // `content-visibility` has no portable H2D/Figma equivalent. Hidden
      // content is explicitly mapped to `visibility: hidden` below; leaving
      // the original declaration in the replay styles makes compatible
      // importers apply an unsupported subtree constraint a second time.
      if (property === "contentVisibility") return false;
      if (["transformBox", "transformStyle"].includes(property)) return false;
      // Individual CSS transforms are normalized into node.transform during
      // capture. Re-emitting the original longhand properties would apply
      // the same translate/rotate/scale a second time in H2D replay.
      if (node.transform && ["translate", "rotate", "scale"].includes(property)) return false;
      if (property === "transformOrigin" && !node.transform) return false;
        return true;
      }),
    ),
    ...(computed.lineHeight == null && computed["line-height"] != null
      ? { lineHeight: computed["line-height"], "line-height": computed["line-height"] }
      : {}),
  };
  const sizingConstraintStyle = (property: "minWidth" | "maxWidth" | "minHeight" | "maxHeight", defaultValue: string): Record<string, string> => {
    const value = String(node.sizingConstraints?.[property] ?? computed[property] ?? "").trim();
    return value && value !== defaultValue ? { [property]: value } : {};
  };
  const aspectRatioStyle: Record<string, string> = {};
  const authoredAspectRatio = String(computed.aspectRatio ?? "").trim();
  const normalizedAspectRatio = authoredAspectRatio.toLowerCase();
  if (authoredAspectRatio && !["auto", "initial", "unset", "revert", "revert-layer"].includes(normalizedAspectRatio)) {
    aspectRatioStyle.aspectRatio = authoredAspectRatio;
  }
  const styles: Record<string, string> = {
    ...replayComputed,
    // Keep authored Grid declarations in the compatibility document. The
    // shared scene metadata also carries the resolved tracks for the native
    // Neuxmind plugin, so each consumer can preserve the source layout model.
    display: textOnlyContainer ? "flex" : isGridLayout ? computedDisplay : isFlexLayout ? flexDisplay : computedDisplay ?? "block",
    ...(measuredLock
      ? { position: "absolute" }
      : containingPosition !== "static"
        ? { position: snapshotAbsolute ? "absolute" : containingPosition }
        : {}),
    width: h2dBoxDimension(node, rect, "width", computed, isMeasuredPosition, options.parentMode),
    height: h2dBoxDimension(node, rect, "height", computed, isMeasuredPosition, options.parentMode),
    ...(computed.boxSizing ? { boxSizing: computed.boxSizing } : {}),
    // Keep the authored aspect-ratio in the portable H2D style channel as
    // well as the shared-scene metadata. The plugin can then restore the
    // native proportion constraint even when the scene marker is unavailable
    // and the import is rebuilt from H2D alone.
    ...aspectRatioStyle,
    ...(effectiveOpacity !== 1 ? { opacity: String(effectiveOpacity) } : {}),
    ...(hiddenByContentVisibility
      ? { visibility: "hidden" }
      : computed.visibility && computed.visibility !== "visible" ? { visibility: computed.visibility } : {}),
    ...(node.overflow && node.overflow !== "visible" ? { overflow: node.overflow } : {}),
    ...(computed.overflowX && computed.overflowX !== "visible" ? { overflowX: computed.overflowX } : {}),
    ...(computed.overflowY && computed.overflowY !== "visible" ? { overflowY: computed.overflowY } : {}),
    ...(node.filter && node.filter !== "none" ? { filter: removeFilterOpacity(node.filter) } : {}),
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
    ...(maskImage !== "none" ? { maskImage } : {}),
    ...(maskPosition !== "0% 0%" ? { maskPosition } : {}),
    ...(maskSize !== "auto" ? { maskSize } : {}),
    ...(maskRepeat !== "repeat" ? { maskRepeat } : {}),
    ...(maskClip !== "border-box" ? { maskClip } : {}),
    ...(maskOrigin !== "border-box" ? { maskOrigin } : {}),
    ...(maskMode !== "match-source" ? { maskMode } : {}),
    ...(maskComposite !== "add" ? { maskComposite } : {}),
    ...(node.backgroundSize ? { backgroundSize: node.backgroundSize } : {}),
    ...(node.backgroundPosition ? { backgroundPosition: node.backgroundPosition } : {}),
    ...(node.backgroundRepeat ? { backgroundRepeat: node.backgroundRepeat } : {}),
    ...(node.backgroundAttachment ? { backgroundAttachment: node.backgroundAttachment } : {}),
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
    ...(node.transform && (node.transformOrigin || computed.transformOrigin)
      && (node.transformOrigin || computed.transformOrigin) !== "50% 50%"
      ? { transformOrigin: node.transformOrigin || computed.transformOrigin }
      : {}),
    ...(node.zIndex != null ? { zIndex: String(node.zIndex) } : {}),
    ...(radiusStyle("borderTopLeftRadius", radius[0]) ? { borderTopLeftRadius: radiusStyle("borderTopLeftRadius", radius[0]) } : {}),
    ...(radiusStyle("borderTopRightRadius", radius[1]) ? { borderTopRightRadius: radiusStyle("borderTopRightRadius", radius[1]) } : {}),
    ...(radiusStyle("borderBottomRightRadius", radius[2]) ? { borderBottomRightRadius: radiusStyle("borderBottomRightRadius", radius[2]) } : {}),
    ...(radiusStyle("borderBottomLeftRadius", radius[3]) ? { borderBottomLeftRadius: radiusStyle("borderBottomLeftRadius", radius[3]) } : {}),
    ...(safePxNumber(padding[0]) > 0 ? { paddingTop: px(padding[0]) } : {}),
    ...(safePxNumber(padding[1]) > 0 ? { paddingRight: px(padding[1]) } : {}),
    ...(safePxNumber(padding[2]) > 0 ? { paddingBottom: px(padding[2]) } : {}),
    ...(safePxNumber(padding[3]) > 0 ? { paddingLeft: px(padding[3]) } : {}),
    ...(node.layout.autoMargins?.[0] || safePxNumber(margin[0]) !== 0 ? { marginTop: marginToken(0) } : {}),
    ...(node.layout.autoMargins?.[1] || safePxNumber(margin[1]) !== 0 ? { marginRight: marginToken(1) } : {}),
    ...(node.layout.autoMargins?.[2] || safePxNumber(margin[2]) !== 0 ? { marginBottom: marginToken(2) } : {}),
    ...(node.layout.autoMargins?.[3] || safePxNumber(margin[3]) !== 0 ? { marginLeft: marginToken(3) } : {}),
    // Keep container-only flex properties at their browser defaults on block
    // and text nodes. Emitting `flexDirection: column`/`justifyContent:
    // flex-start` on every element makes H2D consumers infer a synthetic
    // layout container and is a common source of cumulative offsets.
    ...(isLayoutContainer && (node.layout.gapExpression || node.layout.gap) ? { gap: node.layout.gapExpression ?? px(node.layout.gap) } : {}),
    ...(isLayoutContainer && (node.layout.rowGapExpression || (node.layout.rowGap ?? node.layout.gap)) ? { rowGap: node.layout.rowGapExpression ?? px(node.layout.rowGap ?? node.layout.gap) } : {}),
    ...(isLayoutContainer && (node.layout.columnGapExpression || (node.layout.columnGap ?? node.layout.gap)) ? { columnGap: node.layout.columnGapExpression ?? px(node.layout.columnGap ?? node.layout.gap) } : {}),
    ...(computed.flexGrow && computed.flexGrow !== "0" ? { flexGrow: computed.flexGrow } : {}),
    // Grid tracks are already measured in the browser. Preserve the authored
    // grid surface and prevent flex-only wrapping rules from changing it.
    ...(isFlexContainer && node.layout.wrap ? { flexShrink: "0" } : computed.flexShrink && computed.flexShrink !== "1" ? { flexShrink: computed.flexShrink } : {}),
    ...(computed.flexBasis && computed.flexBasis !== "auto" ? { flexBasis: computed.flexBasis } : {}),
    ...(isFlexContainer && node.layout.wrap ? { flexWrap: node.layout.wrapReverse ? "wrap-reverse" : "wrap" } : computed.flexWrap && computed.flexWrap !== "nowrap" ? { flexWrap: computed.flexWrap } : {}),
    ...sizingConstraintStyle("minWidth", "auto"),
    ...sizingConstraintStyle("maxWidth", "none"),
    ...sizingConstraintStyle("minHeight", "auto"),
    ...sizingConstraintStyle("maxHeight", "none"),
    ...(isFlexContainer ? {
      flexDirection: textOnlyContainer
        ? "row"
        : node.layout.mode === "horizontal"
          ? (node.layout.reverse ? "row-reverse" : "row")
          : (node.layout.reverse ? "column-reverse" : "column"),
    } : computed.flexDirection && computed.flexDirection !== "row" ? { flexDirection: computed.flexDirection } : {}),
    ...(isFlexContainer && (textOnlyContainer || node.layout.alignItems) ? { alignItems: textOnlyContainer ? "center" : node.layout.alignItems === "center" ? "center" : node.layout.alignItems === "end" ? "flex-end" : node.layout.alignItems === "baseline" ? "baseline" : "stretch" } : computed.alignItems && computed.alignItems !== "normal" ? { alignItems: computed.alignItems } : {}),
    ...(node.layout.alignSelf && node.layout.alignSelf !== "auto" ? { alignSelf: node.layout.alignSelf === "center" ? "center" : node.layout.alignSelf === "end" ? "flex-end" : node.layout.alignSelf === "start" ? "flex-start" : node.layout.alignSelf === "baseline" ? "baseline" : "stretch" } : computed.alignSelf && computed.alignSelf !== "auto" ? { alignSelf: computed.alignSelf } : {}),
    ...(isFlexContainer && node.layout.alignContent && node.layout.alignContent !== "start" ? { alignContent: node.layout.alignContent === "end" ? "flex-end" : node.layout.alignContent } : computed.alignContent && computed.alignContent !== "normal" ? { alignContent: computed.alignContent } : {}),
    ...(node.layout.placeContent && node.layout.placeContent !== "normal" ? { placeContent: node.layout.placeContent } : {}),
    // Keep grid alignment metadata in the shared scene model for the native
    // plugin, but do not re-emit it as CSS here. Compatible importers use
    // the captured `alignItems`/`justifyContent` pair and may otherwise apply
    // these extra shorthands a second time, shifting grid/flex children.
    ...(node.layout.order ? { order: String(node.layout.order) } : computed.order && computed.order !== "0" ? { order: computed.order } : {}),
    ...(isFlexContainer && (textOnlyContainer || (node.layout.justifyContent && node.layout.justifyContent !== "start")) ? { justifyContent: textOnlyContainer ? textOnlyAlign : node.layout.justifyContent === "end" ? "flex-end" : node.layout.justifyContent } : computed.justifyContent && computed.justifyContent !== "normal" ? { justifyContent: computed.justifyContent } : {}),
    ...(node.layout.gridTemplateColumns ? { gridTemplateColumns: node.layout.gridTemplateColumns } : {}),
    ...(node.layout.gridTemplateRows ? { gridTemplateRows: node.layout.gridTemplateRows } : {}),
    ...(node.layout.gridTemplateAreas && node.layout.gridTemplateAreas !== "none" ? { gridTemplateAreas: node.layout.gridTemplateAreas } : {}),
    ...(node.layout.gridAutoFlow ? { gridAutoFlow: node.layout.gridAutoFlow } : {}),
    ...(node.layout.gridAutoColumns && node.layout.gridAutoColumns !== "auto" ? { gridAutoColumns: node.layout.gridAutoColumns } : {}),
    ...(node.layout.gridAutoRows && node.layout.gridAutoRows !== "auto" ? { gridAutoRows: node.layout.gridAutoRows } : {}),
    ...(node.layout.gridColumnStart ? { gridColumnStart: node.layout.gridColumnStart } : {}),
    ...(node.layout.gridColumnEnd ? { gridColumnEnd: node.layout.gridColumnEnd } : {}),
    ...(node.layout.gridRowStart ? { gridRowStart: node.layout.gridRowStart } : {}),
    ...(node.layout.gridRowEnd ? { gridRowEnd: node.layout.gridRowEnd } : {}),
    ...(node.layout.gridArea ? { gridArea: node.layout.gridArea } : {}),
    ...(node.shadowCss || shadow ? { boxShadow: node.shadowCss ?? `${px(shadow!.offsetX)} ${px(shadow!.offsetY)} ${px(shadow!.blur)} ${px(shadow!.spread)} ${shadow!.color}` } : {}),
    ...(topBorder ? { borderTopStyle: topBorder.style ?? "solid", borderTopWidth: px(topBorder.width), borderTopColor: topBorder.color } : {}),
    ...(rightBorder ? { borderRightStyle: rightBorder.style ?? "solid", borderRightWidth: px(rightBorder.width), borderRightColor: rightBorder.color } : {}),
    ...(bottomBorder ? { borderBottomStyle: bottomBorder.style ?? "solid", borderBottomWidth: px(bottomBorder.width), borderBottomColor: bottomBorder.color } : {}),
    ...(leftBorder ? { borderLeftStyle: leftBorder.style ?? "solid", borderLeftWidth: px(leftBorder.width), borderLeftColor: leftBorder.color } : {}),
    ...(outline ? {
      outlineStyle: outline.style ?? "solid",
      outlineWidth: px(outline.width),
      outlineColor: outline.color,
      outlineOffset: px(node.outlineOffset ?? 0),
    } : {}),
    // Preserve CSS border-image gradients for the H2D compatibility channel;
    // the native plugin consumes the same value as a Figma gradient stroke.
    ...((borderGradient || borderImageSource) ? {
      borderImageSource: borderGradient || `url("${borderImageSource}")`,
      // Keep the authored slice/repeat contract when it was non-default.
      // Figma's native gradient paint may still need the vector fallback for
      // unsupported repeat modes, but dropping these values makes H2D/native
      // consumers reconstruct a different border geometry.
      borderImageSlice: gradientBorderDetails?.paintSlice || borderImage?.paintSlice || "1",
      ...((gradientBorderDetails?.paintRepeat || borderImage?.paintRepeat) ? { borderImageRepeat: gradientBorderDetails?.paintRepeat || borderImage?.paintRepeat } : {}),
      ...(hasBorderImagePaintWidth ? { borderImageWidth: borderImagePaintWidth.join(" ") } : {}),
      ...(hasBorderImagePaintOutset ? { borderImageOutset: borderImagePaintOutset.join(" ") } : {}),
    } : {}),
  };
  if (node.type === "image") {
    styles.objectFit = node.objectFit ?? "fill";
    styles.objectPosition = node.objectPosition ?? "50% 50%";
    if (node.objectViewBox) styles.objectViewBox = node.objectViewBox;
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
    const isViewportFixed = isFixed && node.fixedScope !== "ancestor";
    // `rect` is accumulated into document coordinates by `toH2DElement`,
    // while an absolute child is positioned against its nearest relative
    // wrapper. Subtract that wrapper's accumulated origin here; otherwise a
    // nested snapshot repeats every ancestor offset (the error grows with
    // depth and is especially visible in cards inside a page frame).
    const parentOrigin = options.parentOrigin ?? { x: 0, y: 0 };
    if (isViewportFixed) {
      styles.left = px(rect.x);
      styles.top = px(rect.y);
    } else if (isFixed && node.fixedScope === "ancestor" && node.fixedOffset) {
      styles.left = px(node.fixedOffset.x);
      styles.top = px(node.fixedOffset.y);
    } else {
      styles.left = px(rect.x - parentOrigin.x - containingBorder.left);
      styles.top = px(rect.y - parentOrigin.y - containingBorder.top);
    }
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
    styles.fontVariant = node.computedStyles?.fontVariant ?? "normal";
    styles.fontVariantAlternates = node.computedStyles?.fontVariantAlternates ?? "normal";
    styles.fontVariantCaps = node.computedStyles?.fontVariantCaps ?? "normal";
    styles.fontVariantEastAsian = node.computedStyles?.fontVariantEastAsian ?? "normal";
    styles.fontVariantLigatures = node.computedStyles?.fontVariantLigatures ?? "normal";
    styles.fontVariantNumeric = node.computedStyles?.fontVariantNumeric ?? "normal";
    styles.fontVariantPosition = node.computedStyles?.fontVariantPosition ?? "normal";
    const lineHeight = px(replayLineHeight(node));
    styles.lineHeight = lineHeight;
    styles["line-height"] = lineHeight;
    styles.letterSpacing = px(node.text.letterSpacing);
    styles.wordSpacing = px(node.text.wordSpacing ?? 0);
    styles.textAlign = node.text.textAlign === "left" ? "start" : node.text.textAlign;
    const textAlignLast = node.computedStyles?.textAlignLast ?? node.text.textAlignLast;
    const textJustify = node.computedStyles?.textJustify ?? node.text.textJustify;
    if (textAlignLast) styles.textAlignLast = textAlignLast;
    if (textJustify) styles.textJustify = textJustify;
    styles.textTransform = node.text.textTransform ?? "none";
    styles.fontStyle = node.text.fontStyle ?? "normal";
    styles.textDecoration = node.text.textDecoration ?? "none";
    styles.textDecorationLine = node.text.textDecoration ?? "none";
    const decorationLines = String(node.text.textDecoration ?? "none").trim().toLowerCase();
    if (decorationLines !== "none") {
      if (node.text.textDecorationStyle && node.text.textDecorationStyle !== "solid") styles.textDecorationStyle = node.text.textDecorationStyle;
      if (node.text.textDecorationColor && node.text.textDecorationColor !== "currentcolor") styles.textDecorationColor = node.text.textDecorationColor;
      if (node.text.textDecorationThickness && node.text.textDecorationThickness !== "auto") styles.textDecorationThickness = node.text.textDecorationThickness;
      if (node.text.textUnderlineOffset && node.text.textUnderlineOffset !== "auto") styles.textUnderlineOffset = node.text.textUnderlineOffset;
    }
    styles.textShadow = node.text.textShadow ?? "none";
    if ((node.text.textStrokeWidth ?? 0) > 0) {
      styles.WebkitTextStrokeWidth = px(node.text.textStrokeWidth as number);
      styles.WebkitTextStrokeColor = node.text.textStrokeColor ?? node.fill?.color ?? "currentcolor";
    }
    if (node.text.textFillColor) styles.WebkitTextFillColor = node.text.textFillColor;
    styles.textOverflow = node.text.textOverflow ?? node.computedStyles?.textOverflow ?? "clip";
    if (node.text.maxLines && node.text.maxLines > 0) styles.lineClamp = String(node.text.maxLines);
    styles.verticalAlign = node.text.verticalAlign ?? "baseline";
    // renderedTextContent() has already converted browser line transitions
    // into explicit newlines. Preserve those measured breaks in H2D instead
    // of allowing Figma's font metrics to wrap the same run a second time.
    styles.whiteSpace = ["nowrap", "pre", "pre-line", "pre-wrap", "break-spaces"].includes(String(node.text.whiteSpace || "").toLowerCase())
      ? String(node.text.whiteSpace).toLowerCase()
      : "pre";
    styles.textIndent = px(node.text.textIndent ?? 0);
    styles.direction = node.text.direction ?? "ltr";
    styles.overflowWrap = node.text.overflowWrap ?? "normal";
    styles.wordBreak = node.text.wordBreak ?? "normal";
    styles.hyphens = node.text.hyphens ?? "manual";
    if (node.text.textWrapMode) styles.textWrapMode = node.text.textWrapMode;
    if (node.text.whiteSpaceCollapse) styles.whiteSpaceCollapse = node.text.whiteSpaceCollapse;
    if (node.text.textBoxTrim) styles.textBoxTrim = node.text.textBoxTrim;
    if (node.text.textBoxEdge) styles.textBoxEdge = node.text.textBoxEdge;
    styles.color = color(node.fill?.color);
  }
  if (node.type !== "text" && Number.isFinite(directTextLineHeight) && (directTextLineHeight ?? 0) > 0) {
    const lineHeight = px(directTextLineHeight as number);
    styles.lineHeight = lineHeight;
    styles["line-height"] = lineHeight;
  } else if (node.type !== "text" && canPromoteDescendantLineHeight(styles.lineHeight)
    && Number.isFinite(descendantTextLineHeight) && (descendantTextLineHeight ?? 0) > 0) {
    // Compatibility/legacy H2D payloads may trim computed styles from an
    // intermediate wrapper. Carry a uniform descendant line box upward so
    // native Figma replay still has an explicit CSS inheritance source.
    const lineHeight = px(descendantTextLineHeight as number);
    styles.lineHeight = lineHeight;
    styles["line-height"] = lineHeight;
  }
  if (node.type !== "text" && directTextAlign) {
    styles.textAlign = directTextAlign === "left" ? "start" : directTextAlign === "right" ? "end" : directTextAlign === "justified" ? "justify" : "center";
  }
  if (node.type !== "text" && Number.isFinite(directTextWordSpacing) && (directTextWordSpacing ?? 0) !== 0) {
    styles.wordSpacing = px(directTextWordSpacing as number);
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
    fontVariant: "normal",
    fontVariantAlternates: "normal",
    fontVariantCaps: "normal",
    fontVariantEastAsian: "normal",
    fontVariantLigatures: "normal",
    fontVariantNumeric: "normal",
    fontVariantPosition: "normal",
    fontStyle: "normal",
    textTransform: "none",
    textOverflow: "clip",
    lineClamp: "none",
    webkitLineClamp: "none",
    verticalAlign: "baseline",
    unicodeBidi: "normal",
    textIndent: "0px",
    direction: "ltr",
    overflowWrap: "normal",
    wordBreak: "normal",
    hyphens: "manual",
    textAlign: "start",
    textAlignLast: "auto",
    textJustify: "auto",
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
    wordSpacing: "0px",
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
  // but compatible consumers replay the source tag in a fresh document.
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
  options: H2DSerializeOptions = {},
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
    const measuredLock = shouldMaterializeGeometryLock(node, parentNode);
    const containingBorder = {
      left: parentNode?.borders
        ? safePxNumber(parentNode.borders[3]?.width)
        : safePxNumber(parentNode?.stroke?.width),
      top: parentNode?.borders
        ? safePxNumber(parentNode.borders[0]?.width)
        : safePxNumber(parentNode?.stroke?.width),
    };
    const textStyles = textReplayStyles(node);
    const textWrappingMetadata = h2dTextWrappingMetadata(node);
    const lineHeight = replayLineHeight(node, parentNode);
    textStyles.lineHeight = px(lineHeight);
    textStyles["line-height"] = textStyles.lineHeight;
    if (measuredLock) {
      textStyles.position = "absolute";
      textStyles.left = px(rect.x - parent.x - containingBorder.left);
      textStyles.top = px(rect.y - parent.y - containingBorder.top);
    }
    return {
      nodeType: 3,
      id: node.id,
      text: node.text.content,
      rect,
      // An older capture/clipboard bridge can retain a stale lineCount while
      // the editable text already contains explicit newline characters. The
      // breaks are authoritative: never let a smaller metadata value turn a
      // wrapped text node back into a single-line Figma box.
      lineCount: textLineCount(node.text.content, node.text.lineCount, textRect.height, lineHeight),
      lineHeight,
      attributes: {
        ...(measuredLock ? { "data-open-canvas-geometry-lock": "true" } : {}),
        "data-open-canvas-line-height": px(lineHeight),
        ...(textWrappingMetadata ? { "data-open-canvas-text-wrapping": textWrappingMetadata } : {}),
        ...(node.structuralSemantics?.length
          ? { "data-open-canvas-structural-semantics": JSON.stringify(node.structuralSemantics) }
          : {}),
        ...(node.structuralSemanticOwners?.length
          ? { "data-open-canvas-structural-semantic-owners": JSON.stringify(node.structuralSemanticOwners) }
          : {}),
        ...(node.computedStyles && h2dFlexMetadata(node.computedStyles)
          ? { "data-open-canvas-flex": h2dFlexMetadata(node.computedStyles) as string }
          : {}),
        ...(Math.abs(node.text.textIndent ?? 0) > 0.01 ? { "data-open-canvas-text-indent": px(node.text.textIndent as number) } : {}),
        "data-open-canvas-text-rect": JSON.stringify(node.rect),
        ...(node.textLineRects?.length ? { "data-open-canvas-text-line-rects": JSON.stringify(node.textLineRects) } : {}),
        "data-open-canvas-line-count": String(textLineCount(node.text.content, node.text.lineCount, textRect.height, lineHeight)),
      },
      styles: textStyles,
      // Keep a second style channel on anonymous text records. Some
      // clipboard bridges retain computed-style data but trim the raw
      // `styles` object; duplicating the resolved line-height here lets the
      // Open Canvas parser recover the same value instead of using AUTO.
      computedStyles: { ...textStyles },
    };
  }
  return toH2DElement(node, assetById, parent, parentNode, visualSnapshot, options);
}

function toH2DElement(
  node: DesignDocument["root"],
  assetById: Map<string, DesignDocument["assets"][number]>,
  parent: { x: number; y: number },
  parentNode?: DesignDocument["root"],
  visualSnapshot = false,
  options: H2DSerializeOptions = {},
): H2DElementNode {
  const rect = { x: parent.x + node.rect.x, y: parent.y + node.rect.y, width: node.rect.width, height: node.rect.height };
  const asset = node.assetId ? assetById.get(node.assetId) : undefined;
  const tag = node.sourceTag ?? (node.type === "image" ? "IMG" : node.type === "vector" ? "SVG" : node.type === "text" ? "SPAN" : "DIV");
  const computedStyles = node.computedStyles && Object.keys(node.computedStyles).length > 0
    ? { ...node.computedStyles }
    : undefined;
  const layoutMetadata = h2dLayoutMetadata(node);
  const sizingConstraintMetadata = h2dSizingConstraintMetadata(node, computedStyles);
  const aspectRatioMetadata = h2dAspectRatioMetadata(node, computedStyles);
  const containmentMetadata = h2dContainmentMetadata(
    computedStyles?.contain,
    node.attributes?.["data-open-canvas-containment"],
  );
  const gridFlowMetadata = h2dGridFlowMetadata(node);
  const multiColumnMetadata = h2dMultiColumnMetadata(computedStyles, node.attributes?.["data-open-canvas-multicolumn"]);
  const scrollConstraintMetadata = h2dScrollConstraintMetadata(computedStyles, node.attributes?.["data-open-canvas-scroll-constraints"]);
  const flexMetadata = h2dFlexMetadata(computedStyles, node.attributes?.["data-open-canvas-flex"]);
  const anchorMetadata = h2dAnchorPositioningMetadata(computedStyles, node.attributes?.["data-open-canvas-anchor-positioning"]);
  const containerQueryMetadata = h2dContainerQueryMetadata(computedStyles, node.attributes?.["data-open-canvas-container-queries"]);
  const visualConstraintMetadata = h2dVisualConstraintMetadata(
    node,
    computedStyles,
    node.attributes?.["data-open-canvas-visual-constraints"],
  );
  const transformMetadata = h2dTransformMetadata(
    node,
    computedStyles,
    node.attributes?.["data-open-canvas-transform"],
  );
  const sourcePositioning = node.positioning && node.positioning !== "static"
    ? node.positioning
    : node.layout.position === "absolute" ? "absolute" : undefined;
  const measuredLock = shouldMaterializeGeometryLock(node, parentNode);
  const replayStyles = stylesFor(node, rect, assetById, {
    left: node.positioning === "fixed" ? 0 : parentNode?.borders
      ? safePxNumber(parentNode.borders[3]?.width)
      : safePxNumber(parentNode?.stroke?.width),
    top: node.positioning === "fixed" ? 0 : parentNode?.borders
      ? safePxNumber(parentNode.borders[0]?.width)
      : safePxNumber(parentNode?.stroke?.width),
  }, {
    visualSnapshot,
    root: !parentNode,
    parentOrigin: parent,
    measuredLock,
    parentMode: parentNode?.layout.mode,
  });
  // `stylesFor` has no parent context by design, but an element carrying an
  // inherited line-height keyword does. Resolve it once at this boundary and
  // reuse the same pixel value for the element, its text child, and the
  // compatibility marker.
  const resolvedTextLineHeight = node.type === "text" && node.text
    ? px(replayLineHeight(node, parentNode))
    : undefined;
  // Keep the resolved used line box in every style channel. Some Figma H2D
  // consumers inspect `computedStyles` rather than the authored `styles`
  // map, and older bridges can trim one of those maps while preserving the
  // other. Supplying both spellings here prevents inherited leading from
  // falling back to Figma's AUTO value during native paste.
  const resolvedComputedStyles = resolvedTextLineHeight
    ? {
      ...(computedStyles || {}),
      lineHeight: resolvedTextLineHeight,
      "line-height": resolvedTextLineHeight,
    }
    : computedStyles;
  const textWrappingMetadata = h2dTextWrappingMetadata(node);
  if (resolvedTextLineHeight) {
    replayStyles.lineHeight = resolvedTextLineHeight;
    replayStyles["line-height"] = resolvedTextLineHeight;
  }
  const element: H2DElementNode = {
    nodeType: 1,
    id: node.id,
    tag,
    attributes: {
      ...(node.attributes ?? {}),
      ...(node.semantics?.role ? { "data-open-canvas-role": node.semantics.role } : {}),
      ...(node.semantics?.label ? { "data-open-canvas-label": node.semantics.label } : {}),
      ...(node.semantics?.description ? { "data-open-canvas-description": node.semantics.description } : {}),
      ...(node.semantics?.states ? { "data-open-canvas-states": JSON.stringify(node.semantics.states) } : {}),
      ...(node.structuralSemantics?.length
        ? { "data-open-canvas-structural-semantics": JSON.stringify(node.structuralSemantics) }
        : {}),
      ...(node.structuralSemanticOwners?.length
        ? { "data-open-canvas-structural-semantic-owners": JSON.stringify(node.structuralSemanticOwners) }
        : {}),
      ...(node.fixedScope ? { "data-open-canvas-fixed-scope": node.fixedScope } : {}),
      ...(node.fixedOffset ? { "data-open-canvas-fixed-offset": JSON.stringify(node.fixedOffset) } : {}),
      ...(node.fixedContainingBlockId ? { "data-open-canvas-fixed-containing-block": node.fixedContainingBlockId } : {}),
      ...(node.positionOffsetExpression ? { "data-open-canvas-position-offset": JSON.stringify(node.positionOffsetExpression) } : {}),
      ...(measuredLock ? { "data-open-canvas-geometry-lock": "true" } : {}),
      // `none` is meaningful too: mixed inline/block content deliberately
      // stays on the measured free-positioning path. If a clipboard bridge
      // trims the custom layout object, inferring from `display: block` would
      // incorrectly turn adjacent inline runs into a vertical Auto Layout stack.
      "data-open-canvas-layout-mode": node.layout.mode,
      // Keep authored HUG/FILL sizing beside the optional layout extension.
      // Some clipboard bridges preserve DOM attributes but trim unknown
      // object fields, so the importer can still restore responsive intent.
      ...(node.layout.widthMode !== "fixed" ? { "data-open-canvas-width-mode": node.layout.widthMode } : {}),
      ...(node.layout.heightMode !== "fixed" ? { "data-open-canvas-height-mode": node.layout.heightMode } : {}),
      ...(node.layout.widthExpression ? { "data-open-canvas-width-expression": node.layout.widthExpression } : {}),
      ...(node.layout.heightExpression ? { "data-open-canvas-height-expression": node.layout.heightExpression } : {}),
      ...(layoutMetadata ? { "data-open-canvas-layout": JSON.stringify(layoutMetadata) } : {}),
      ...(node.layout.autoMargins?.some(Boolean)
        ? { "data-open-canvas-auto-margins": JSON.stringify(node.layout.autoMargins) }
        : {}),
      ...(sizingConstraintMetadata ? { "data-open-canvas-sizing-constraints": sizingConstraintMetadata } : {}),
      ...(aspectRatioMetadata ? { "data-open-canvas-aspect-ratio": aspectRatioMetadata } : {}),
      ...(containmentMetadata ? { "data-open-canvas-containment": containmentMetadata } : {}),
      ...(gridFlowMetadata ? { "data-open-canvas-grid-flow": gridFlowMetadata } : {}),
      ...(multiColumnMetadata ? { "data-open-canvas-multicolumn": multiColumnMetadata } : {}),
      ...(scrollConstraintMetadata ? { "data-open-canvas-scroll-constraints": scrollConstraintMetadata } : {}),
      ...(flexMetadata ? { "data-open-canvas-flex": flexMetadata } : {}),
      ...(anchorMetadata ? { "data-open-canvas-anchor-positioning": anchorMetadata } : {}),
      ...(containerQueryMetadata ? { "data-open-canvas-container-queries": containerQueryMetadata } : {}),
      ...(visualConstraintMetadata ? { "data-open-canvas-visual-constraints": visualConstraintMetadata } : {}),
      ...(transformMetadata ? { "data-open-canvas-transform": transformMetadata } : {}),
      ...(node.backgroundAssetId ? { "data-open-canvas-background-asset-id": node.backgroundAssetId } : {}),
      ...((node.borders || []).find((border) => border?.imageAssetId)?.imageAssetId
        ? { "data-open-canvas-border-image-asset-id": (node.borders || []).find((border) => border?.imageAssetId)?.imageAssetId }
        : {}),
      ...(sourcePositioning ? { "data-open-canvas-positioning": sourcePositioning } : {}),
      ...(node.type === "text" && node.textRect ? { "data-open-canvas-text-rect": JSON.stringify(node.textRect) } : {}),
      ...(node.type === "text" && node.textLineRects?.length
        ? { "data-open-canvas-text-line-rects": JSON.stringify(node.textLineRects) }
        : {}),
      ...(node.type === "text" && node.text?.lineCount
        ? { "data-open-canvas-line-count": String(textLineCount(node.text.content, node.text.lineCount, node.textRect?.height ?? node.rect.height, Number.parseFloat(resolvedTextLineHeight || "0"))) }
        : {}),
      // Keep a small, inspectable typography marker beside the CSS replay
      // styles. Older clipboard bridges sometimes trim `styles` while
      // retaining attributes; the plugin can recover this resolved pixel
      // line box without falling back to Figma's AUTO leading.
      ...(replayStyles.lineHeight ? { "data-open-canvas-line-height": replayStyles.lineHeight } : {}),
      ...(textWrappingMetadata ? { "data-open-canvas-text-wrapping": textWrappingMetadata } : {}),
    },
    styles: replayStyles,
    ...(resolvedComputedStyles ? { computedStyles: resolvedComputedStyles } : {}),
    // Generic H2D importers ignore unknown fields, while the Open Canvas
    // plugin can recover HUG/FILL and the authored Auto Layout contract when
    // the lossless shared-scene marker has been stripped by the clipboard.
    ...(layoutMetadata ? { layout: layoutMetadata } : {}),
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
    const textChild: H2DTextNode = {
      nodeType: 3,
      id: `${node.id}-text`,
      text: node.text.content,
      rect: childRect,
      // The capture browser may report one Range box for a text node even
      // when renderedTextContent() has inserted explicit newline characters.
      // Never let that stale count downgrade a wrapped layer to single-line
      // Figma sizing; the explicit breaks are the authoritative line count.
      lineCount: textLineCount(node.text.content, node.text.lineCount, childRect.height, Number.parseFloat(resolvedTextLineHeight || "0")),
      lineHeight: resolvedTextLineHeight ? Number.parseFloat(resolvedTextLineHeight) : node.text.lineHeight,
      attributes: {
        "data-open-canvas-line-height": resolvedTextLineHeight || px(node.text.lineHeight),
        ...(textWrappingMetadata ? { "data-open-canvas-text-wrapping": textWrappingMetadata } : {}),
        ...(node.structuralSemantics?.length
          ? { "data-open-canvas-structural-semantics": JSON.stringify(node.structuralSemantics) }
          : {}),
        ...(node.structuralSemanticOwners?.length
          ? { "data-open-canvas-structural-semantic-owners": JSON.stringify(node.structuralSemanticOwners) }
          : {}),
        ...(computedStyles && h2dFlexMetadata(computedStyles)
          ? { "data-open-canvas-flex": h2dFlexMetadata(computedStyles) as string }
          : {}),
        ...(shouldMaterializeGeometryLock(node, parentNode) ? { "data-open-canvas-geometry-lock": "true" } : {}),
        ...(Math.abs(node.text.textIndent ?? 0) > 0.01 ? { "data-open-canvas-text-indent": px(node.text.textIndent as number) } : {}),
        ...(node.textLineRects?.length ? { "data-open-canvas-text-line-rects": JSON.stringify(node.textLineRects) } : {}),
      },
      styles: {
        ...textReplayStyles(node),
        ...(resolvedTextLineHeight ? {
          lineHeight: resolvedTextLineHeight,
          "line-height": resolvedTextLineHeight,
        } : {}),
      },
      // Some clipboard bridges keep only the computed-style channel for a
      // TEXT_NODE child. Mirror the resolved replay styles here so an
      // element-backed text run cannot lose its inherited line-height when
      // the raw `styles` object is trimmed during paste normalization.
      computedStyles: {
        ...textReplayStyles(node),
        ...(resolvedTextLineHeight ? {
          lineHeight: resolvedTextLineHeight,
          "line-height": resolvedTextLineHeight,
        } : {}),
      },
    };
    // A few native H2D consumers apply `line-height` on the element wrapper
    // but still materialize its direct TEXT_NODE child with AUTO leading.
    // The anonymous-run path already uses an explicit inline wrapper for
    // this reason. Mirror that contract for element-backed text only in the
    // native clipboard payload; the lossless plugin scene keeps its original
    // element/text shape and does not gain an extra editable layer.
    if (options.forceLineHeightWrappers && resolvedTextLineHeight) {
      const wrapperStyles = {
        ...textChild.styles,
        display: "inline",
        lineHeight: resolvedTextLineHeight,
        "line-height": resolvedTextLineHeight,
      };
      element.childNodes.push({
        nodeType: 1,
        id: `${node.id}-text-line-height-wrapper`,
        tag: "SPAN",
        attributes: {
          "data-open-canvas-text-run": "true",
          "data-open-canvas-line-height": resolvedTextLineHeight,
        },
        styles: wrapperStyles,
        computedStyles: wrapperStyles,
        rect: childRect,
        childNodes: [textChild],
      });
    } else {
      element.childNodes.push(textChild);
    }
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
      const childParent = child.positioning === "fixed" && child.fixedScope !== "ancestor" ? { x: 0, y: 0 } : { x: rect.x, y: rect.y };
      pseudoElementNodes[role] = toH2DElement(child, assetById, childParent, node, visualSnapshot, options);
    }
    if (pseudoElementNodes.before || pseudoElementNodes.after) element.pseudoElementNodes = pseudoElementNodes;
  }
  for (const child of node.children.filter((candidate) => !candidate.pseudo)) {
    // Fixed-position descendants are measured in viewport coordinates rather
    // than the DOM parent's coordinate space. Do not add the ancestor offset
    // a second time when flattening the scene into H2D's absolute rects.
    const childParent = child.positioning === "fixed" && child.fixedScope !== "ancestor"
      ? { x: 0, y: 0 }
      : { x: rect.x, y: rect.y };
    // The official importer uses different font and flex metrics from the
    // capture browser. Pin every visible element to its measured rectangle so
    // one text-width difference cannot cascade through the whole page. The
    // authored scene remains separate for the native editable Auto Layout
    // importer.
    const serializedChild = toH2DNode(child, assetById, childParent, node, visualSnapshot, options);
    // Some Figma Desktop H2D builds read line-height only from an element's
    // CSS style, not from the custom style/lineHeight fields on a raw
    // TEXT_NODE. A container with mixed anonymous runs can therefore lose a
    // child-specific inherited line box, while a multiline run can lose its
    // leading entirely. Wrap these cases in a semantic inline element so the
    // native importer has an authoritative CSS declaration; the Open Canvas
    // plugin still resolves the wrapper back to one editable text layer.
    const anonymousTextChildren = node.children.filter((candidate) => (
      candidate.type === "text" && candidate.sourceTag === "#text" && candidate.text
    ));
    const anonymousLineHeights = anonymousTextChildren
      .map((candidate) => Number(candidate.text?.lineHeight))
      .filter((value) => Number.isFinite(value) && value > 0);
    const hasMixedAnonymousLineHeights = anonymousLineHeights.length > 1
      && anonymousLineHeights.some((value) => Math.abs(value - anonymousLineHeights[0]) > 0.01);
    const hasMultipleTextLines = Boolean(child.text)
      && (Math.max(1, child.text?.lineCount ?? 1) > 1 || String(child.text?.content ?? "").includes("\n"));
    // Native Figma H2D builds are more reliable when line-height is declared
    // on an element style than on a raw TEXT_NODE. This also applies to
    // measured/geometry-locked runs: the wrapper retains the serialized
    // absolute position and lets the child inherit the captured line box
    // without changing the visual snapshot coordinates.
    // Figma Desktop can ignore line-height declarations attached directly to
    // a raw TEXT_NODE, including a single-line run that inherits its leading
    // from a parent. Give those runs a semantic inline wrapper when the
    // parent carries an explicit/inherited declaration; multiline/mixed runs
    // remain covered by the same path for older payloads without a numeric
    // field. Keep ordinary root-level text nodes raw for compatibility with
    // the official H2D shape.
    const hasCapturedLineHeight = Number.isFinite(Number(child.text?.lineHeight))
      && Number(child.text?.lineHeight) > 0;
    const parentLineHeight = String(
      node.computedStyles?.lineHeight
        ?? node.computedStyles?.["line-height"]
        ?? "",
    ).trim().toLowerCase();
    const parentCarriesExplicitLineHeight = Boolean(parentLineHeight)
      && !["normal", "initial", "inherit", "unset", "revert", "revert-layer"].includes(parentLineHeight);
    const canWrapAnonymousText = (
      // A trimmed/legacy bridge can remove the wrapper's computed
      // `line-height` while retaining the already-resolved value on the
      // anonymous run. For nested elements, prefer the explicit inline
      // wrapper even when the parent declaration is no longer inspectable;
      // otherwise some Figma Desktop H2D builds ignore the raw TEXT_NODE
      // field and restore AUTO leading. The wrapper is layout-neutral and is
      // unwrapped by the Open Canvas plugin back into one editable TextNode.
      (hasCapturedLineHeight && (
        options.forceLineHeightWrappers
        || parentCarriesExplicitLineHeight
        // A trimmed bridge may retain the resolved computed style on the
        // anonymous run while dropping it from the intermediate wrapper.
        // That child-level value is sufficient to make the native H2D
        // importer honor the leading without wrapping ordinary unstyled
        // inline runs that merely happen to have a numeric fallback.
        || (() => {
          const childLineHeight = String(
            child.computedStyles?.lineHeight
              ?? child.computedStyles?.["line-height"]
              ?? "",
          ).trim().toLowerCase();
          return Boolean(childLineHeight)
            && !["normal", "initial", "inherit", "unset", "revert", "revert-layer"].includes(childLineHeight);
        })()
      ))
      || hasMixedAnonymousLineHeights
      || hasMultipleTextLines
    )
      && child.type === "text"
      && child.sourceTag === "#text"
      && serializedChild.nodeType === 3;
    if (canWrapAnonymousText && serializedChild.nodeType === 3) {
      const wrapperStyles = {
        ...(serializedChild.styles || {}),
        display: "inline",
        lineHeight: px(replayLineHeight(child, node)),
      };
      wrapperStyles["line-height"] = wrapperStyles.lineHeight;
      element.childNodes.push({
        nodeType: 1,
        id: `${child.id}-line-height-wrapper`,
        tag: "SPAN",
        attributes: {
          "data-open-canvas-text-run": "true",
          "data-open-canvas-line-height": wrapperStyles.lineHeight,
        },
        styles: wrapperStyles,
        computedStyles: wrapperStyles,
        rect: serializedChild.rect,
        childNodes: [serializedChild],
      });
    } else {
      element.childNodes.push(serializedChild);
    }
  }
  return element;
}

export function buildFigmaHtml(document: DesignDocument, options: { includeScene?: boolean; forceLineHeightWrappers?: boolean } = { includeScene: true }): string {
  const h2d = toH2D(document, { forceLineHeightWrappers: options.forceLineHeightWrappers === true });
  // Identify our own export. The importer may not accept every metadata
  // source; never impersonate a browser extension to gain compatibility.
  const metadata: FigmaMetadata & { dataType: "h2d"; source: "open-canvas"; capturedAtIso: string } = {
    pageId: document.pageId,
    title: document.title,
    width: h2d.documentRect.width,
    height: h2d.documentRect.height,
    viewport: { ...document.viewport },
    viewportRect: { ...h2d.viewportRect },
    devicePixelRatio: document.devicePixelRatio,
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
  // The native paste path is intentionally stricter than the plugin scene
  // path: several Desktop versions ignore line-height fields on raw TEXT_NODEs
  // but honor the same resolved value on an inline element style.
  return buildFigmaHtml(document, { includeScene: false, forceLineHeightWrappers: true });
}
