import type { Page } from "../domain/model";
import type { DeviceFrame } from "../components/device-presets";
import {
  emptyLayout,
  type DesignAsset,
  type DesignColor,
  type DesignDocument,
  type DesignFontUsage,
  type DesignLayout,
  type DesignNode,
  type DesignRect,
  type DesignTextStyle,
} from "./designModel";

const DEFAULT_VIEWPORT = { width: 430, height: 900 };
const CAPTURE_TIMEOUT_MS = 10_000;
const ASSET_WAIT_TIMEOUT_MS = 2_500;
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
// Match the browser extension capture boundary: document metadata and head
// contents are not rendered page layers and must never enter the scene tree.
const IGNORED_TAGS = new Set(["HEAD", "SCRIPT", "STYLE", "META", "LINK", "NOSCRIPT"]);

interface CaptureContext {
  document: Document;
  assets: DesignAsset[];
  assetBySource: Map<string, string>;
  fonts: Map<string, DesignFontUsage>;
  diagnostics: DesignDocument["diagnostics"];
  fontDiagnostics: Set<string>;
  imageData: Map<string, string>;
  sequence: number;
}

function numberValue(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function camelCaseCssProperty(property: string): string {
  return property.replace(/-([a-z])/g, (_match, character: string) => character.toUpperCase());
}

const COMPUTED_STYLE_DEFAULTS: Record<string, string> = {
  alignContent: "normal", alignItems: "normal", alignSelf: "auto", appearance: "none", aspectRatio: "auto",
  backdropFilter: "none", backgroundAttachment: "scroll", backgroundBlendMode: "normal", backgroundClip: "border-box",
  backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%",
  backgroundRepeat: "repeat", backgroundSize: "auto", borderCollapse: "separate", borderSpacing: "0px", boxSizing: "content-box",
  bottom: "auto", boxShadow: "none", clear: "none", clip: "auto", clipPath: "none", color: "rgb(0, 0, 0)",
  columnCount: "auto", columnGap: "normal", columnWidth: "auto", contain: "none", content: "normal", display: "",
  filter: "none", flexBasis: "auto", flexDirection: "row", flexGrow: "0", flexShrink: "1", flexWrap: "nowrap", float: "none",
  fontFamily: "Times", fontFeatureSettings: "normal", fontKerning: "auto", fontOpticalSizing: "auto", fontSize: "16px",
  fontSizeAdjust: "none", fontStretch: "100%", fontStyle: "normal", fontVariationSettings: "normal", fontWeight: "400",
  gridAutoColumns: "auto", gridAutoFlow: "row", gridAutoRows: "auto", gridColumnEnd: "auto", gridColumnStart: "auto",
  gridRowEnd: "auto", gridRowStart: "auto", gridTemplateAreas: "none", gridTemplateColumns: "none", gridTemplateRows: "none",
  height: "auto", isolation: "auto", justifyContent: "normal", justifyItems: "normal", justifySelf: "auto", left: "auto", letterSpacing: "normal", lineHeight: "normal",
  marginBottom: "0px", marginLeft: "0px", marginRight: "0px", marginTop: "0px", maxHeight: "none", maxWidth: "none",
  minHeight: "auto", minWidth: "auto", mixBlendMode: "normal", objectFit: "fill", objectPosition: "50% 50%", opacity: "1",
  order: "0", overflow: "visible", overflowX: "visible", overflowY: "visible", paddingBottom: "0px", paddingLeft: "0px",
  paddingRight: "0px", paddingTop: "0px", perspective: "none", position: "static", right: "auto", rowGap: "normal",
  textAlign: "start", textDecorationLine: "none", textIndent: "0px", textShadow: "none", textTransform: "none", top: "auto",
  textOrientation: "mixed", textRendering: "auto", textWrapStyle: "auto", transform: "none", transformOrigin: "50% 50%", placeItems: "normal", placeSelf: "auto",
  transformBox: "border-box", transformStyle: "flat", translate: "none", rotate: "none", scale: "none", verticalAlign: "baseline",
  backfaceVisibility: "visible", borderImageOutset: "0", borderImageRepeat: "stretch", borderImageSlice: "100%",
  borderImageSource: "none", borderImageWidth: "1", clipRule: "nonzero", fontLanguageOverride: "normal", hyphens: "manual",
  objectViewBox: "none", overflowWrap: "normal", wordBreak: "normal",
  visibility: "visible", whiteSpace: "normal", width: "auto", writingMode: "horizontal-tb", zIndex: "auto",
};

const PRESERVED_COMPUTED_STYLE_PROPERTIES = new Set([
  "backgroundPositionX", "backgroundPositionY", "objectFit", "objectPosition", "filter", "backdropFilter", "mixBlendMode", "isolation",
]);

function computedStyleMap(style: CSSStyleDeclaration): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index);
    if (!property || property.startsWith("--")) continue;
    const value = style.getPropertyValue(property).trim();
    if (!value) continue;
    const camelProperty = camelCaseCssProperty(property);
    const defaultValue = COMPUTED_STYLE_DEFAULTS[camelProperty];
    if (defaultValue !== undefined && value === defaultValue) continue;
    // Unknown browser-specific properties are omitted unless explicitly kept;
    // this prevents a 300-property default dump on every captured node while
    // retaining the visual/layout fields that H2D consumers can act on.
    if (defaultValue === undefined && !PRESERVED_COMPUTED_STYLE_PROPERTIES.has(camelProperty)) continue;
    values[camelProperty] = value;
  }
  return values;
}

export function rectWithoutAxisTransform(element: Element, rect: DOMRect): DOMRect {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const transform = style?.transform;
  if (!transform || transform === "none") return rect;
  const values = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(",").map(Number);
  const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/)?.[1].split(",").map(Number);
  let a = 1;
  let d = 1;
  let e = 0;
  let f = 0;
  if (values?.length === 6 && values.every(Number.isFinite)) {
    [a, , , d, e, f] = values;
  } else if (matrix3d?.length === 16 && matrix3d.every(Number.isFinite)) {
    a = matrix3d[0];
    d = matrix3d[5];
    e = matrix3d[12];
    f = matrix3d[13];
  } else {
    return rect;
  }
  // Rotation/skew requires a quad to be represented exactly. Leave those
  // matrices untouched; correcting axis-aligned translate/scale avoids the
  // common double-transform while preserving the rotated visual.
  if (a <= 1e-6 || d <= 1e-6 || Math.abs(values?.[1] ?? matrix3d?.[1] ?? 0) > 1e-6 || Math.abs(values?.[2] ?? matrix3d?.[4] ?? 0) > 1e-6) return rect;
  const width = rect.width / a;
  const height = rect.height / d;
  const origin = String(style?.transformOrigin || "50% 50%").trim().split(/\s+/);
  const resolveOrigin = (value: string | undefined, size: number): number => {
    if (!value || value === "center") return size / 2;
    if (value === "left" || value === "top") return 0;
    if (value === "right" || value === "bottom") return size;
    return value.endsWith("%") ? numberValue(value, 50) * size / 100 : numberValue(value, size / 2);
  };
  const originX = resolveOrigin(origin[0], width);
  const originY = resolveOrigin(origin[1], height);
  // The transformed bounding box is offset by (1 - scale) * origin. Undo
  // that contribution before preserving the authored transform for Figma.
  return new DOMRect(
    rect.left - e + (a - 1) * originX,
    rect.top - f + (d - 1) * originY,
    width,
    height,
  );
}

function rectFor(element: Element, parentRect?: DOMRect, parentScaleX = 1, parentScaleY = 1): DesignRect {
  const rect = rectWithoutAxisTransform(element, element.getBoundingClientRect());
  return {
    x: Math.round(((rect.left - (parentRect?.left ?? 0)) / Math.max(0.01, parentScaleX)) * 100) / 100,
    y: Math.round(((rect.top - (parentRect?.top ?? 0)) / Math.max(0.01, parentScaleY)) * 100) / 100,
    width: Math.round((rect.width / Math.max(0.01, parentScaleX)) * 100) / 100,
    height: Math.round((rect.height / Math.max(0.01, parentScaleY)) * 100) / 100,
  };
}

function axisTransformScale(style: CSSStyleDeclaration): { x: number; y: number } {
  const transform = style.transform;
  if (!transform || transform === "none") return { x: 1, y: 1 };
  const values = transform.match(/^matrix\(([^)]+)\)$/)?.[1].split(",").map(Number);
  const matrix3d = transform.match(/^matrix3d\(([^)]+)\)$/)?.[1].split(",").map(Number);
  const a = values?.length === 6 ? values[0] : matrix3d?.length === 16 ? matrix3d[0] : 1;
  const d = values?.length === 6 ? values[3] : matrix3d?.length === 16 ? matrix3d[5] : 1;
  const b = values?.length === 6 ? values[1] : matrix3d?.length === 16 ? matrix3d[1] : 0;
  const c = values?.length === 6 ? values[2] : matrix3d?.length === 16 ? matrix3d[4] : 0;
  if (![a, b, c, d].every(Number.isFinite) || Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return { x: 1, y: 1 };
  return { x: Math.max(0.01, Math.abs(a)), y: Math.max(0.01, Math.abs(d)) };
}

function colorFromStyle(value: string): DesignColor | undefined {
  if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return undefined;
  return { color: value };
}

export function shadowFromStyle(value: string): DesignNode["shadow"] {
  if (!value || value === "none") return undefined;
  const layer = value.split(/,(?![^()]*\))/)[0]?.trim();
  if (!layer) return undefined;
  const color = Array.from(layer.matchAll(/(?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?:transparent|currentcolor|[a-z]+)\b/gi))
    .map((match) => match[0])
    .find((candidate) => candidate.toLowerCase() !== "inset");
  const withoutColor = color ? layer.replace(color, " ") : layer;
  const lengths = withoutColor.match(/(-?(?:\d+(?:\.\d*)?|\.\d+))(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)?/gi) ?? [];
  if (lengths.length < 3) return undefined;
  const match = lengths.slice(0, 4).map((token) => numberValue(token));
  return {
    offsetX: match[0],
    offsetY: match[1],
    blur: match[2],
    spread: match[3] ?? 0,
    color: color || "rgba(0,0,0,0.18)",
    inset: /\binset\b/i.test(layer),
  };
}

export function shadowsFromStyle(value: string): NonNullable<DesignNode["shadows"]> {
  if (!value || value === "none") return [];
  return value
    .split(/,(?![^()]*\))/)
    .map((layer) => shadowFromStyle(layer.trim()))
    .filter((shadow): shadow is NonNullable<DesignNode["shadow"]> => Boolean(shadow));
}

function parsePadding(style: CSSStyleDeclaration): [number, number, number, number] {
  return [
    numberValue(style.paddingTop),
    numberValue(style.paddingRight),
    numberValue(style.paddingBottom),
    numberValue(style.paddingLeft),
  ];
}

function parseMargin(style: CSSStyleDeclaration): [number, number, number, number] {
  return [
    numberValue(style.marginTop),
    numberValue(style.marginRight),
    numberValue(style.marginBottom),
    numberValue(style.marginLeft),
  ];
}

function radiusValue(value: string, horizontalSize: number, verticalSize: number): number {
  const parts = String(value || "0").trim().split(/\s+/).filter(Boolean);
  const resolve = (part: string, size: number): number => {
    if (part.endsWith("%")) return numberValue(part) * size / 100;
    return numberValue(part);
  };
  const horizontal = resolve(parts[0] || "0", horizontalSize);
  const vertical = resolve(parts[1] || parts[0] || "0", verticalSize);
  // Figma exposes one circular radius per corner. The smaller axis preserves
  // the CSS corner without making the imported shape overflow its box.
  return Math.max(0, Math.min(horizontal, vertical));
}

export function radiusFor(style: CSSStyleDeclaration, width: number, height: number): [number, number, number, number] {
  return [
    radiusValue(style.borderTopLeftRadius, width, height),
    radiusValue(style.borderTopRightRadius, width, height),
    radiusValue(style.borderBottomRightRadius, width, height),
    radiusValue(style.borderBottomLeftRadius, width, height),
  ];
}

function alignValue(value: string): DesignLayout["alignItems"] {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end") return "end";
  if (value === "stretch") return "stretch";
  return "start";
}

function alignSelfValue(value: string): NonNullable<DesignLayout["alignSelf"]> {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end") return "end";
  if (value === "stretch") return "stretch";
  if (value === "flex-start" || value === "start") return "start";
  return "auto";
}

function justifyValue(value: string): DesignLayout["justifyContent"] {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end") return "end";
  if (value === "space-between") return "space-between";
  if (value === "space-around") return "space-around";
  if (value === "space-evenly") return "space-evenly";
  return "start";
}

function contentAlignValue(value: string): NonNullable<DesignLayout["alignContent"]> {
  if (value === "center") return "center";
  if (value === "flex-end" || value === "end") return "end";
  if (value === "space-between") return "space-between";
  if (value === "space-around") return "space-around";
  if (value === "space-evenly") return "space-evenly";
  if (value === "stretch") return "stretch";
  return "start";
}

function justifyItemsValue(value: string): NonNullable<DesignLayout["justifyItems"]> {
  if (value === "center") return "center";
  if (value === "end" || value === "flex-end") return "end";
  if (value === "stretch") return "stretch";
  return "start";
}

function justifySelfValue(value: string): NonNullable<DesignLayout["justifySelf"]> {
  if (value === "center") return "center";
  if (value === "end" || value === "flex-end") return "end";
  if (value === "stretch") return "stretch";
  if (value === "start" || value === "flex-start") return "start";
  return "auto";
}

function positioningValue(value: string): NonNullable<DesignNode["positioning"]> {
  return value === "relative" || value === "absolute" || value === "fixed" || value === "sticky" ? value : "static";
}

function recordUnsupportedStyles(context: CaptureContext, style: CSSStyleDeclaration, nodeId: string): void {
  const unsupported: Array<[string, string, string]> = [
    ["filter", style.filter, "filter effects are retained in H2D but are not recreated as native Figma effects"],
    ["backdrop-filter", style.backdropFilter, "backdrop-filter is retained in H2D but has no direct Figma layer equivalent"],
    ["background-blend-mode", style.backgroundBlendMode, "background blend modes are retained in H2D but may require manual Figma adjustment"],
    ["isolation", style.isolation, "isolation stacking contexts are retained in H2D but may require manual Figma adjustment"],
  ];
  for (const [property, value, message] of unsupported) {
    if (!value || value === "none" || value === "normal" || value === "auto") continue;
    context.diagnostics.push({ code: "style-degraded", message: `${property}: ${message}`, nodeId });
  }
}

function borderFor(style: CSSStyleDeclaration, side: "Top" | "Right" | "Bottom" | "Left"): DesignNode["stroke"] {
  const width = numberValue(style[`border${side}Width` as keyof CSSStyleDeclaration] as string);
  const borderStyle = String(style[`border${side}Style` as keyof CSSStyleDeclaration] ?? "solid");
  if (width <= 0 || borderStyle === "none" || borderStyle === "hidden") return undefined;
  return {
    color: String(style[`border${side}Color` as keyof CSSStyleDeclaration] ?? "rgba(0, 0, 0, 0)"),
    width,
    style: borderStyle,
  };
}

type SizingAxis = "width" | "height";

interface SizingContext {
  element?: Element;
  rect?: DOMRect;
  parentStyle?: CSSStyleDeclaration;
}

/**
 * Infer Figma's sizing intent from the flex relationship instead of the
 * computed pixel value. getComputedStyle() resolves percentages and `auto`
 * to pixels, so checking `style.width.endsWith('%')` loses the information
 * that distinguishes fill, hug, and fixed children.
 */
function sizingModeFor(style: CSSStyleDeclaration, context: SizingContext, axis: SizingAxis): DesignLayout["widthMode"] {
  const element = context.element;
  const parent = element?.parentElement;
  const parentStyle = context.parentStyle ?? (parent ? parent.ownerDocument.defaultView?.getComputedStyle(parent) : undefined);
  if (!parentStyle || !parent || (parentStyle.display !== "flex" && parentStyle.display !== "inline-flex" && parentStyle.display !== "grid" && parentStyle.display !== "inline-grid")) {
    return "fixed";
  }

  const parentDirection = parentStyle.flexDirection === "row" || parentStyle.flexDirection === "row-reverse" ? "horizontal" : "vertical";
  const isMainAxis = axis === "width" ? parentDirection === "horizontal" : parentDirection === "vertical";
  const childMargin = axis === "width"
    ? numberValue(style.marginLeft) + numberValue(style.marginRight)
    : numberValue(style.marginTop) + numberValue(style.marginBottom);
  const flexGrow = numberValue(style.flexGrow);
  const flexBasis = String(style.flexBasis || "auto").trim();
  // The capture document lives in a sandboxed iframe, so its elements belong
  // to a different realm and fail `instanceof HTMLElement` in the host
  // window. Use the structural `style` property instead.
  const authoredStyle = element && "style" in element ? element.style as CSSStyleDeclaration : undefined;
  const authoredValue = authoredStyle
    ? String(axis === "width" ? authoredStyle.width : authoredStyle.height).trim()
    : "";

  // Stylesheet declarations are not reflected in `element.style`. When a
  // flex item already occupies the complete content-box span of its parent,
  // the rendered geometry is stronger evidence than the missing authored
  // declaration and should map to Figma FILL. Missing this case turns common
  // `width: 100%` / `height: 100%` rules into HUG, which lets Figma reflow the
  // entire subtree around its intrinsic content size.
  if (isMainAxis) {
    const parentRect = parent.getBoundingClientRect();
    const parentSize = axis === "width" ? parentRect.width : parentRect.height;
    const parentPadding = axis === "width"
      ? numberValue(parentStyle.paddingLeft) + numberValue(parentStyle.paddingRight) + numberValue(parentStyle.borderLeftWidth) + numberValue(parentStyle.borderRightWidth)
      : numberValue(parentStyle.paddingTop) + numberValue(parentStyle.paddingBottom) + numberValue(parentStyle.borderTopWidth) + numberValue(parentStyle.borderBottomWidth);
    const childRect = context.rect ?? element.getBoundingClientRect();
    const childSize = axis === "width" ? childRect.width : childRect.height;
    const available = Math.max(0, parentSize - parentPadding - childMargin);
    if (available > 0 && Math.abs(childSize - available) <= 1.5 && authoredValue !== "auto" && authoredValue !== "max-content" && authoredValue !== "fit-content") {
      return "fill";
    }
  }

  // A growing item or an explicit basis/percentage consumes the remaining
  // main-axis space in Figma just like CSS flex-fill.
  if (flexGrow > 0 || (isMainAxis && flexBasis !== "auto" && flexBasis !== "content") || /%$/.test(authoredValue)) return "fill";

  // The browser stretches flex children on the cross axis when no child
  // override is present. Compare against the parent's content box so borders
  // and padding do not turn a genuinely filled child into a fixed one.
  if (!isMainAxis) {
    const parentRect = parent.getBoundingClientRect();
    const parentSize = axis === "width" ? parentRect.width : parentRect.height;
    const parentPadding = axis === "width"
      ? numberValue(parentStyle.paddingLeft) + numberValue(parentStyle.paddingRight) + numberValue(parentStyle.borderLeftWidth) + numberValue(parentStyle.borderRightWidth)
      : numberValue(parentStyle.paddingTop) + numberValue(parentStyle.paddingBottom) + numberValue(parentStyle.borderTopWidth) + numberValue(parentStyle.borderBottomWidth);
    const childRect = context.rect ?? element.getBoundingClientRect();
    const childSize = axis === "width" ? childRect.width : childRect.height;
    const childAlign = style.alignSelf || "auto";
    const parentAlign = parentStyle.alignItems || "normal";
    if ((childAlign === "auto" || childAlign === "stretch") && (parentAlign === "stretch" || parentAlign === "normal") && Math.abs(childSize - Math.max(0, parentSize - parentPadding - childMargin)) <= 1.5) return "fill";
  }

  // Remaining flex items size to their content on the main axis. This is the
  // useful `hug` signal for Figma; fixed is reserved for explicitly sized or
  // non-flex content where there is no layout relationship to preserve.
  if (isMainAxis && !flexGrow && (authoredValue === "" || authoredValue === "auto" || authoredValue === "max-content" || authoredValue === "fit-content")) {
    return "hug";
  }
  return "fixed";
}

export function layoutFor(style: CSSStyleDeclaration, context: SizingContext = {}): DesignLayout {
  const isFlex = style.display === "flex" || style.display === "inline-flex";
  const isGrid = style.display === "grid" || style.display === "inline-grid";
  const direction = style.flexDirection === "row" || style.flexDirection === "row-reverse" ? "horizontal" : "vertical";
  return {
    ...emptyLayout(),
    // H2D has reliable support for flex wrapping, while CSS grid support is
    // inconsistent across Figma importers. Grid children already carry their
    // measured widths, so a wrapped row preserves the rendered geometry and
    // remains editable as an Auto Layout frame.
    mode: isFlex ? direction : isGrid ? "horizontal" : "none",
    reverse: isFlex && (style.flexDirection === "row-reverse" || style.flexDirection === "column-reverse") ? true : undefined,
    wrap: isGrid || (isFlex && style.flexWrap === "wrap"),
    gap: numberValue(style.gap),
    rowGap: numberValue(style.rowGap, numberValue(style.gap)),
    columnGap: numberValue(style.columnGap, numberValue(style.gap)),
    padding: parsePadding(style),
    alignItems: alignValue(style.alignItems),
    alignSelf: alignSelfValue(style.alignSelf),
    alignContent: contentAlignValue(style.alignContent),
    justifyItems: justifyItemsValue(style.justifyItems),
    justifySelf: justifySelfValue(style.justifySelf),
    ...(style.placeItems && style.placeItems !== "normal" ? { placeItems: style.placeItems } : {}),
    ...(style.placeSelf && style.placeSelf !== "auto" ? { placeSelf: style.placeSelf } : {}),
    order: Number.isFinite(Number.parseInt(style.order, 10)) ? Number.parseInt(style.order, 10) : 0,
    justifyContent: justifyValue(style.justifyContent),
    widthMode: sizingModeFor(style, context, "width"),
    heightMode: sizingModeFor(style, context, "height"),
    position: style.position === "absolute" || style.position === "fixed" ? "absolute" : "flow",
    ...(isGrid ? {
      gridTemplateColumns: style.gridTemplateColumns,
      gridTemplateRows: style.gridTemplateRows,
      gridAutoFlow: style.gridAutoFlow,
    } : {}),
  };
}

function makeId(context: CaptureContext, element: Element): string {
  const authoredId = element.getAttribute("id");
  return authoredId ? `node-${authoredId}` : `node-${context.sequence++}`;
}

function addAsset(context: CaptureContext, kind: DesignAsset["kind"], src: string, data?: string): string {
  const existing = context.assetBySource.get(`${kind}:${src}`);
  if (existing) return existing;
  const id = `asset-${context.assets.length}`;
  context.assets.push({ id, kind, src, data });
  context.assetBySource.set(`${kind}:${src}`, id);
  return id;
}

function imageSource(image: HTMLImageElement): { src: string; data?: string } | null {
  const src = image.currentSrc || image.getAttribute("src") || "";
  if (!src) return null;
  if (src.startsWith("data:") || src.startsWith("blob:")) return { src, data: src };
  return { src };
}

function cssImageUrls(value: string): string[] {
  const urls: string[] = [];
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const url = match[2].trim();
    if (url && !url.startsWith("data:") && !url.startsWith("blob:") && !url.startsWith("#")) urls.push(url);
  }
  return urls;
}

interface SvgGradientStop {
  color: string;
  opacity: number;
  offset: number;
}

interface ParsedCssGradient {
  kind: "linear" | "radial";
  repeating: boolean;
  body: string;
}

function expandGradientStops(stops: SvgGradientStop[]): SvgGradientStop[] {
  if (stops.length < 2) return stops;
  const expanded: SvgGradientStop[] = [];
  const colorChannels = (value: string): [number, number, number] | undefined => {
    const match = value.match(/^#([0-9a-f]{6})$/i);
    if (!match) return undefined;
    return [
      Number.parseInt(match[1].slice(0, 2), 16),
      Number.parseInt(match[1].slice(2, 4), 16),
      Number.parseInt(match[1].slice(4, 6), 16),
    ];
  };
  const hexColor = (channels: [number, number, number]): string => `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const start = stops[index];
    const end = stops[index + 1];
    const startChannels = colorChannels(start.color);
    const endChannels = colorChannels(end.color);
    if (!startChannels || !endChannels || end.offset <= start.offset) {
      expanded.push(start);
      continue;
    }
    expanded.push(start);
    const steps = Math.max(1, Math.ceil((end.offset - start.offset) / 0.05));
    for (let step = 1; step < steps; step += 1) {
      const ratio = step / steps;
      expanded.push({
        color: hexColor([
          startChannels[0] + (endChannels[0] - startChannels[0]) * ratio,
          startChannels[1] + (endChannels[1] - startChannels[1]) * ratio,
          startChannels[2] + (endChannels[2] - startChannels[2]) * ratio,
        ]),
        opacity: start.opacity + (end.opacity - start.opacity) * ratio,
        offset: start.offset + (end.offset - start.offset) * ratio,
      });
    }
  }
  expanded.push(stops[stops.length - 1]);
  return expanded;
}

function splitCssArguments(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function cssGradientFunctions(value: string): ParsedCssGradient[] {
  const functions: ParsedCssGradient[] = [];
  // Do not match the `linear-gradient` suffix inside
  // `repeating-linear-gradient`; the negative lookbehind keeps the prefix
  // attached so repeating layers retain their pattern semantics.
  const pattern = /(?<![\w-])(repeating-)?(linear|radial)-gradient\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    let depth = 1;
    let index = pattern.lastIndex;
    for (; index < value.length && depth > 0; index += 1) {
      if (value[index] === "(") depth += 1;
      else if (value[index] === ")") depth -= 1;
    }
    if (depth === 0) {
      functions.push({ kind: match[2].toLowerCase() as ParsedCssGradient["kind"], repeating: Boolean(match[1]), body: value.slice(pattern.lastIndex, index - 1) });
      pattern.lastIndex = index;
    }
  }
  return functions;
}

function svgColor(value: string): { color: string; opacity: number } | null {
  const raw = value.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "transparent") return { color: "#000000", opacity: 0 };
  const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let valueHex = hex[1];
    if (valueHex.length === 3 || valueHex.length === 4) valueHex = valueHex.split("").map((character) => character + character).join("");
    if (valueHex.length === 6) valueHex += "ff";
    if (valueHex.length !== 8) return null;
    return { color: `#${valueHex.slice(0, 6)}`, opacity: Number.parseInt(valueHex.slice(6), 16) / 255 };
  }
  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return { color: raw, opacity: 1 };
  const tokens = rgb[1].replaceAll("/", " ").trim().split(/[ ,]+/).filter(Boolean);
  const channel = (token: string): number => token.endsWith("%") ? Number.parseFloat(token) * 2.55 : Number.parseFloat(token);
  const alpha = (token: string | undefined): number => token?.endsWith("%") ? Number.parseFloat(token) / 100 : Number.parseFloat(token ?? "1");
  const channels = tokens.slice(0, 3).map(channel);
  if (channels.length !== 3 || channels.some((channelValue) => !Number.isFinite(channelValue))) return null;
  const toHex = (channelValue: number): string => Math.max(0, Math.min(255, Math.round(channelValue))).toString(16).padStart(2, "0");
  return { color: `#${channels.map(toHex).join("")}`, opacity: Number.isFinite(alpha(tokens[3])) ? alpha(tokens[3]) : 1 };
}

function parseGradientStop(value: string, index: number, total: number, cycle?: number): SvgGradientStop[] {
  const match = value.trim().match(/^(.*?)(?:\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px)))?(?:\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px)))?$/);
  if (!match) return [];
  const parsed = svgColor(match[1]);
  if (!parsed) return [];
  const positions = [match[2], match[3]].filter((position): position is string => Boolean(position));
  const offsets = positions.length
    ? positions.map((position) => {
      const numeric = Number.parseFloat(position);
      if (position.endsWith("%")) return numeric / 100;
      return cycle && cycle > 0 ? numeric / cycle : numeric / Math.max(1, cycle ?? 100);
    })
    : [index / Math.max(1, total - 1)];
  return offsets.map((offset) => ({ color: parsed.color, opacity: parsed.opacity, offset: Math.max(0, Math.min(1, offset)) }));
}

function gradientAngle(value: string): number {
  const raw = value.trim().toLowerCase();
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)deg$/.test(raw)) return Number.parseFloat(raw);
  if (!raw.startsWith("to ")) return 180;
  const directions = raw.slice(3).split(/\s+/);
  const has = (direction: string) => directions.includes(direction);
  if (has("top") && has("right")) return 45;
  if (has("bottom") && has("right")) return 135;
  if (has("bottom") && has("left")) return 225;
  if (has("top") && has("left")) return 315;
  if (has("top")) return 0;
  if (has("bottom")) return 180;
  if (has("left")) return 270;
  return 180;
}

function linearGradientCoordinates(angle: number, width: number, height: number): [number, number, number, number] {
  const radians = angle * Math.PI / 180;
  const directionX = Math.sin(radians);
  const directionY = -Math.cos(radians);
  const extent = Math.min(
    Math.abs(directionX) > 0.0001 ? width / (2 * Math.abs(directionX)) : Number.POSITIVE_INFINITY,
    Math.abs(directionY) > 0.0001 ? height / (2 * Math.abs(directionY)) : Number.POSITIVE_INFINITY,
  );
  const dx = directionX * extent;
  const dy = directionY * extent;
  return [0.5 - dx / width, 0.5 - dy / height, 0.5 + dx / width, 0.5 + dy / height];
}

function gradientStops(body: string, kind: ParsedCssGradient["kind"], repeating: boolean): { stops: SvgGradientStop[]; direction: string; cycle?: number } {
  const args = splitCssArguments(body);
  let direction = "180deg";
  let stopArgs = args;
  if (kind === "linear" && args.length > 1 && (/^(?:to\s+|[-+]?\d)/i.test(args[0]))) {
    direction = args[0];
    stopArgs = args.slice(1);
  } else if (kind === "radial" && args.length > 1 && /^(?:circle|ellipse|closest|farthest|at\s+)/i.test(args[0])) {
    direction = args[0];
    stopArgs = args.slice(1);
  }
  const hasPx = stopArgs.some((stop) => /\b-?(?:\d+(?:\.\d*)?|\.\d+)px\b/.test(stop));
  const maxPx = stopArgs.reduce((maximum, stop) => {
    // `Number("38px")` is `NaN`; parse the numeric part before calculating
    // the repeating gradient's cycle length.
    const values = stop.match(/-?(?:\d+(?:\.\d*)?|\.\d+)px/g)?.map(Number.parseFloat) ?? [];
    return Math.max(maximum, ...values);
  }, 0);
  const cycle = repeating && hasPx ? Math.max(1, maxPx) : undefined;
  return {
    stops: stopArgs.flatMap((stop, index) => parseGradientStop(stop, index, stopArgs.length, cycle)),
    direction,
    cycle,
  };
}

export function backgroundSvgDataUrl(backgroundImage: string, backgroundColor: string, width: number, height: number): string | undefined {
  const functions = cssGradientFunctions(backgroundImage);
  // The official H2D importer reinterprets CSS gradients with its own color
  // interpolation and alpha compositing. That produces visible differences
  // even for a single opaque linear gradient. Capture gradient-only layers as
  // SVG so the browser-resolved stops and geometry become the visual source
  // of truth. Backgrounds containing external image URLs stay on the native
  // URL path because a partial SVG would otherwise drop those resources.
  if (!functions.length || /\burl\s*\(/i.test(backgroundImage)) return undefined;
  const defs: string[] = [];
  const layers: string[] = [];
  const base = svgColor(backgroundColor);
  if (base) layers.push(`<rect width="${width}" height="${height}" fill="${base.color}" fill-opacity="${base.opacity}"/>`);
  // CSS paints the first background image on top. SVG paints later elements on
  // top, so walk the CSS layers in reverse order.
  for (let index = functions.length - 1; index >= 0; index -= 1) {
    const gradient = functions[index];
    const parsed = gradientStops(gradient.body, gradient.kind, gradient.repeating);
    if (parsed.stops.length < 2) continue;
    const stops = expandGradientStops(parsed.stops);
    const id = `gradient-${index}`;
    if (gradient.repeating && gradient.kind === "linear" && parsed.cycle) {
      const angle = gradientAngle(parsed.direction);
      const horizontal = Math.abs(Math.sin(angle * Math.PI / 180)) > 0.9;
      const vertical = Math.abs(Math.cos(angle * Math.PI / 180)) > 0.9;
      if (horizontal || vertical) {
        const patternWidth = horizontal ? parsed.cycle : width;
        const patternHeight = vertical ? parsed.cycle : height;
        const x2 = horizontal ? parsed.cycle : 0;
        const y1 = vertical ? parsed.cycle : 0;
        const y2 = vertical ? 0 : 0;
        const stopMarkup = stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join("");
        defs.push(`<linearGradient id="${id}-linear" color-interpolation="sRGB" gradientUnits="userSpaceOnUse" x1="0" y1="${y1}" x2="${x2}" y2="${y2}">${stopMarkup}</linearGradient>`);
        defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${patternWidth}" height="${patternHeight}"><rect width="${patternWidth}" height="${patternHeight}" fill="url(#${id}-linear)"/></pattern>`);
        layers.push(`<rect width="${width}" height="${height}" fill="url(#${id})"/>`);
        continue;
      }
    }
    if (gradient.kind === "linear") {
      const [x1, y1, x2, y2] = linearGradientCoordinates(gradientAngle(parsed.direction), width, height);
      const stopMarkup = stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join("");
      defs.push(`<linearGradient id="${id}" color-interpolation="sRGB" gradientUnits="objectBoundingBox" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${stopMarkup}</linearGradient>`);
      layers.push(`<rect width="${width}" height="${height}" fill="url(#${id})"/>`);
    } else {
      const center = parsed.direction.match(/at\s+([\d.]+)%\s+([\d.]+)%/i);
      const cx = center ? Number.parseFloat(center[1]) : 50;
      const cy = center ? Number.parseFloat(center[2]) : 50;
      const stopMarkup = stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join("");
      defs.push(`<radialGradient id="${id}" color-interpolation="sRGB" cx="${cx}%" cy="${cy}%" r="70%">${stopMarkup}</radialGradient>`);
      layers.push(`<rect width="${width}" height="${height}" fill="url(#${id})"/>`);
    }
  }
  if (!layers.length) return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join("")}</defs>${layers.join("")}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function resolveResourceUrl(source: string, doc: Document): string {
  try {
    return new URL(source, doc.baseURI || window.location.href).href;
  } catch {
    return source;
  }
}

function resolveCssImageUrls(value: string, doc: Document): string {
  return value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, quote: string, source: string) => {
    if (!source || source.startsWith("data:") || source.startsWith("blob:") || source.startsWith("#")) return full;
    const resolved = resolveResourceUrl(source, doc);
    return `url(${quote}${resolved}${quote})`;
  });
}

async function inlineImageUrl(source: string, context: CaptureContext): Promise<void> {
  const resolvedSource = resolveResourceUrl(source, context.document);
  if (!resolvedSource || context.imageData.has(resolvedSource)) return;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeout = window.setTimeout(() => controller?.abort(), ASSET_WAIT_TIMEOUT_MS);
  try {
    const response = await fetch(resolvedSource, { credentials: "same-origin", signal: controller?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size > MAX_INLINE_IMAGE_BYTES) {
      context.diagnostics.push({ code: "image-too-large", message: `Image exceeds the ${MAX_INLINE_IMAGE_BYTES / (1024 * 1024)} MB inline limit` });
      return;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    context.imageData.set(resolvedSource, `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`);
  } catch {
    // Keep the source URL so H2D can report an unresolved remote resource.
  } finally {
    window.clearTimeout(timeout);
  }
}

async function inlineAccessibleImages(doc: Document, context: CaptureContext): Promise<void> {
  const imageSources = new Set<string>();
  for (const image of Array.from(doc.images)) {
    const source = imageSource(image);
    if (source && !source.data?.startsWith("data:")) imageSources.add(source.src);
  }
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    const style = doc.defaultView?.getComputedStyle(element);
    for (const source of cssImageUrls(style?.backgroundImage ?? "")) {
      if (source.startsWith("data:")) {
        // Data URLs are already readable in the capture document; register
        // them directly so CSS backgrounds use the same deduplicated asset
        // path as <img> elements and remote background URLs.
        addAsset(context, "image", source, source);
      } else {
        imageSources.add(source);
      }
    }
  }
  await Promise.all(Array.from(imageSources, async (source) => {
    await inlineImageUrl(source, context);
    const resolvedSource = resolveResourceUrl(source, context.document);
    addAsset(context, "image", resolvedSource, context.imageData.get(resolvedSource));
  }));
}

const SVG_PRESENTATION_PROPERTIES = [
  ["fill", "fill"],
  ["fill-opacity", "fill-opacity"],
  ["fill-rule", "fill-rule"],
  ["stroke", "stroke"],
  ["stroke-opacity", "stroke-opacity"],
  ["stroke-width", "stroke-width"],
  ["stroke-linecap", "stroke-linecap"],
  ["stroke-linejoin", "stroke-linejoin"],
  ["stroke-miterlimit", "stroke-miterlimit"],
  ["stroke-dasharray", "stroke-dasharray"],
  ["stroke-dashoffset", "stroke-dashoffset"],
] as const;

export function inlineSvgStyles(element: Element, doc: Document): string {
  const clone = element.cloneNode(true) as Element;
  const sourceNodes = [element, ...Array.from(element.querySelectorAll("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const defaultView = doc.defaultView;
  const resolvedBySource = new Map<Element, Map<string, string>>();
  for (let index = 0; index < sourceNodes.length; index += 1) {
    const source = sourceNodes[index];
    const target = cloneNodes[index];
    const computed = defaultView?.getComputedStyle(source);
    if (!computed) continue;
    const inherited = source.parentElement ? resolvedBySource.get(source.parentElement) : undefined;
    const color = computed.color?.trim() || inherited?.get("color") || "rgb(0, 0, 0)";
    const resolved = new Map<string, string>([["color", color]]);
    // Figma receives the SVG without the source document stylesheet. Inline
    // every final presentation value, including values inherited by child
    // paths from a class on the root SVG. Explicit authored attributes still
    // win; only currentColor needs resolving before the stylesheet is gone.
    for (const [attribute, property] of SVG_PRESENTATION_PROPERTIES) {
      const authored = target.getAttribute(attribute);
      const computedValue = computed.getPropertyValue(property).trim();
      const finalValue = (authored || computedValue || inherited?.get(property) || "").replaceAll("currentColor", color);
      if (!finalValue) continue;
      resolved.set(property, finalValue);
      if (!authored || authored.includes("currentColor")) target.setAttribute(attribute, finalValue);
    }
    const authoredColor = target.getAttribute("color");
    if (!authoredColor || authoredColor.includes("currentColor")) target.setAttribute("color", color);
    resolvedBySource.set(source, resolved);
  }
  return (clone as Element).outerHTML;
}

const INLINE_TEXT_TAGS = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "CITE", "CODE", "DEL", "DFN", "EM", "I", "INS",
  "KBD", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR",
]);

function textContent(element: Element): string {
  const collect = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const child = node as Element;
    if (child.tagName.toUpperCase() === "BR") return "\n";
    return Array.from(child.childNodes, collect).join("");
  };
  return collect(element)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

function normalizeRenderedText(value: string): string {
  // Collapse browser whitespace without trimming the boundaries. Boundary
  // spaces are meaningful when a text run sits next to an inline element,
  // e.g. `Hello <strong>world</strong>`.
  return value
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n");
}

function containsOnlyInlineText(element: Element): boolean {
  for (const child of Array.from(element.children)) {
    const tag = child.tagName.toUpperCase();
    if (tag === "BR" || INLINE_TEXT_TAGS.has(tag)) {
      if (!containsOnlyInlineText(child)) return false;
      continue;
    }
    return false;
  }
  return true;
}

const INLINE_TEXT_STYLE_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "lineHeight",
  "letterSpacing",
  "color",
  "textTransform",
  "fontStyle",
  "textDecorationLine",
  "verticalAlign",
  "whiteSpace",
] as const;

function hasDistinctInlineTextStyle(element: Element, parentStyle: CSSStyleDeclaration, doc: Document): boolean {
  for (const child of Array.from(element.children)) {
    if (child.tagName.toUpperCase() === "BR") continue;
    const childStyle = doc.defaultView?.getComputedStyle(child);
    if (!childStyle) continue;
    if (INLINE_TEXT_STYLE_PROPERTIES.some((property) => childStyle[property] !== parentStyle[property])) return true;
    if (hasDistinctInlineTextStyle(child, parentStyle, doc)) return true;
  }
  return false;
}

export function renderedTextContent(element: Element, doc: Document): string {
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  let previousTop: number | undefined;
  let value = "";
  while (current) {
    const text = current.nodeValue ?? "";
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const range = doc.createRange();
      range.setStart(current, index);
      range.setEnd(current, index + 1);
      const rect = range.getBoundingClientRect();
      const top = rect.top;
      if (character !== "\n" && previousTop !== undefined && Number.isFinite(top) && Math.abs(top - previousTop) > 0.5 && value && !value.endsWith("\n")) {
        value += "\n";
      }
      value += character;
      if (character !== "\n" && Number.isFinite(top)) previousTop = top;
    }
    current = walker.nextNode();
  }
  return normalizeRenderedText(value);
}

export function renderedTextNodeContent(textNode: Text, doc: Document): string {
  const text = textNode.nodeValue ?? "";
  let previousTop: number | undefined;
  let value = "";
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const range = doc.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + 1);
    const top = range.getBoundingClientRect().top;
    if (character !== "\n" && previousTop !== undefined && Number.isFinite(top) && Math.abs(top - previousTop) > 0.5 && value && !value.endsWith("\n")) {
      value += "\n";
    }
    value += character;
    if (character !== "\n" && Number.isFinite(top)) previousTop = top;
  }
  return normalizeRenderedText(value);
}

function textNodeRect(textNode: Text, parentRect: DOMRect, doc: Document): DesignRect | null {
  const range = doc.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    x: Math.round((rect.left - parentRect.left) * 100) / 100,
    y: Math.round((rect.top - parentRect.top) * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  };
}

function textElementRect(element: Element, doc: Document): DesignRect | null {
  const range = doc.createRange();
  range.selectNodeContents(element);
  const rangeRect = range.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (rangeRect.width <= 0 && rangeRect.height <= 0) return null;
  return {
    x: Math.round((rangeRect.left - elementRect.left) * 100) / 100,
    y: Math.round((rangeRect.top - elementRect.top) * 100) / 100,
    width: Math.round(rangeRect.width * 100) / 100,
    height: Math.round(rangeRect.height * 100) / 100,
  };
}

/**
 * Inline elements such as <b> and <span> report their containing line box
 * from getBoundingClientRect(). Using that box for separate Figma text layers
 * makes adjacent runs share the same x/y and overlap. Range geometry is the
 * browser's actual glyph placement and keeps mixed-style inline runs apart.
 */
export function inlineTextRect(
  element: Element,
  parentRect: DOMRect | undefined,
  doc: Document,
  parentScaleX = 1,
  parentScaleY = 1,
): DesignRect | null {
  if (!parentRect) return null;
  const style = doc.defaultView?.getComputedStyle(element);
  const parentStyle = element.parentElement ? doc.defaultView?.getComputedStyle(element.parentElement) : undefined;
  const inlineDisplay = style?.display === "inline" || style?.display === "inline-block";
  const parentIsLayout = parentStyle && ["flex", "inline-flex", "grid", "inline-grid"].includes(parentStyle.display);
  if (!inlineDisplay || parentIsLayout) return null;
  const range = doc.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    x: Math.round(((rect.left - parentRect.left) / Math.max(0.01, parentScaleX)) * 100) / 100,
    y: Math.round(((rect.top - parentRect.top) / Math.max(0.01, parentScaleY)) * 100) / 100,
    width: Math.round((rect.width / Math.max(0.01, parentScaleX)) * 100) / 100,
    height: Math.round((rect.height / Math.max(0.01, parentScaleY)) * 100) / 100,
  };
}

function pseudoContentSize(content: string, style: CSSStyleDeclaration, doc?: Document): { width: number; height: number } {
  const fontSize = Math.max(1, numberValue(style.fontSize, 16));
  const lineHeight = style.lineHeight === "normal" ? fontSize * 1.2 : Math.max(1, numberValue(style.lineHeight, fontSize * 1.2));
  const lines = content.split(/\r?\n/);
  let width = 0;
  const canvas = doc?.createElement("canvas");
  const canvasContext = canvas?.getContext("2d");
  if (canvasContext) {
    canvasContext.font = `${style.fontStyle || "normal"} ${style.fontWeight || "400"} ${fontSize}px ${style.fontFamily || "Inter"}`;
    width = Math.max(...lines.map((line) => canvasContext.measureText(line).width), 0);
  } else {
    width = Math.max(...lines.map((line) => Array.from(line).length * fontSize * 0.6), 0);
  }
  const padding = numberValue(style.paddingLeft) + numberValue(style.paddingRight);
  const verticalPadding = numberValue(style.paddingTop) + numberValue(style.paddingBottom);
  const border = numberValue(style.borderLeftWidth) + numberValue(style.borderRightWidth);
  const verticalBorder = numberValue(style.borderTopWidth) + numberValue(style.borderBottomWidth);
  return {
    width: width + padding + border,
    height: lines.length * lineHeight + verticalPadding + verticalBorder,
  };
}

function pseudoPosition(elementRect: DOMRect, style: CSSStyleDeclaration, content = "", doc?: Document): DesignRect {
  const widthValue = numberValue(style.width, 0);
  const heightValue = numberValue(style.height, 0);
  const measuredContent = content ? pseudoContentSize(content, style, doc) : { width: 0, height: 0 };
  const horizontalInset = numberValue(style.left) + numberValue(style.right);
  const verticalInset = numberValue(style.top) + numberValue(style.bottom);
  const width = widthValue > 0
    ? widthValue
    : style.left !== "auto" && style.right !== "auto"
      ? Math.max(0, elementRect.width - horizontalInset)
      : measuredContent.width > 0 ? measuredContent.width : Math.max(0, elementRect.width);
  const height = heightValue > 0
    ? heightValue
    : style.top !== "auto" && style.bottom !== "auto"
      ? Math.max(1, elementRect.height - verticalInset)
      : measuredContent.height > 0 ? measuredContent.height : Math.max(1, numberValue(style.fontSize, 16) * 1.2);
  const left = style.left !== "auto" ? numberValue(style.left) : style.right !== "auto" ? elementRect.width - width - numberValue(style.right) : 0;
  const top = style.top !== "auto" ? numberValue(style.top) : style.bottom !== "auto" ? elementRect.height - height - numberValue(style.bottom) : 0;
  // Inline pseudo content without an explicit box uses its parent's content
  // width. The measured parent rect keeps wrapping deterministic in Figma.
  return {
    x: Math.round(left * 100) / 100,
    y: Math.round(top * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
  };
}

function pseudoContentValue(value: string): string {
  if (!value || value === "none" || value === "normal") return "";
  if (value.startsWith("url(")) return "";
  return value
    .replace(/^['"]|['"]$/g, "")
    .replace(/\\A/g, "\n");
}

function textNodeFor(
  context: CaptureContext,
  id: string,
  rect: DesignRect,
  style: CSSStyleDeclaration,
  content: string,
  sourceElement?: Element,
  margin: [number, number, number, number] = [0, 0, 0, 0],
  layout: DesignLayout = emptyLayout(),
  rectOrigin: "element" | "glyph" = "element",
): DesignNode {
  const fontWeight = numberValue(style.fontWeight, 400);
  const fontFamily = style.fontFamily.split(",")[0].trim().replace(/["']/g, "") || "Inter";
  const fontSize = numberValue(style.fontSize, 16);
  const fontStyle = style.fontStyle || "normal";
  const fontStretch = style.fontStretch || "100%";
  const sample = content.slice(0, 32);
  const measuredTextRect = sourceElement ? textElementRect(sourceElement, context.document) : undefined;
  // Inline text callers pass the already-measured glyph box as `rect` rather
  // than the containing element's border box. `textElementRect()` is relative
  // to the outer element, so preserve its size but normalize the origin to
  // the glyph node. Block text leaves keep the true glyph inset.
  const textRect = rectOrigin === "glyph" && measuredTextRect
    ? { ...measuredTextRect, x: 0, y: 0 }
    : measuredTextRect;
  const measuredLineCount = Math.max(1, content.split(/\r?\n/).length);
  const measuredLineHeight = (measuredTextRect?.height ?? rect.height) / measuredLineCount;
  const fontKey = `${fontFamily}|${fontWeight}|${fontStyle}|${fontStretch}|${fontSize}`;
  if (!context.fonts.has(fontKey)) {
    let metrics: DesignFontUsage["metrics"];
    const canvas = context.document.createElement("canvas");
    const canvasContext = canvas.getContext("2d");
    if (canvasContext) {
      canvasContext.font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}"`;
      const measured = canvasContext.measureText(sample || "Hg");
      metrics = {
        fontBoundingBoxAscent: Number.isFinite(measured.fontBoundingBoxAscent) ? measured.fontBoundingBoxAscent : undefined,
        fontBoundingBoxDescent: Number.isFinite(measured.fontBoundingBoxDescent) ? measured.fontBoundingBoxDescent : undefined,
      };
    }
    context.fonts.set(fontKey, { family: fontFamily, weight: fontWeight, style: fontStyle, stretch: fontStretch, size: fontSize, sample, metrics });
    const fontSet = context.document.fonts;
    if (fontSet && typeof fontSet.check === "function" && !fontSet.check(`${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}"`, sample || "Hg") && !context.fontDiagnostics.has(fontKey)) {
      context.fontDiagnostics.add(fontKey);
      context.diagnostics.push({ code: "font-unavailable", message: `Font may be unavailable in the capture or Figma: ${fontFamily} ${fontWeight}`, nodeId: id });
    }
  }
  const lineHeight = style.lineHeight === "normal"
    ? (Number.isFinite(measuredLineHeight) && measuredLineHeight > 0 ? measuredLineHeight : fontSize * 1.2)
    : numberValue(style.lineHeight, fontSize * 1.2);
  const lineCount = Math.max(
    measuredLineCount,
    Math.round((measuredTextRect?.height ?? rect.height) / Math.max(1, lineHeight)),
  );
  return {
    id,
    ...(sourceElement ? {} : { sourceTag: "#text" }),
    type: "text",
    rect,
    ...(sourceElement ? { textRect: textRect ?? undefined } : {}),
    opacity: numberValue(style.opacity, 1),
    radius: [0, 0, 0, 0],
    margin,
    layout,
    fill: colorFromStyle(style.color),
    computedStyles: computedStyleMap(style),
      text: {
      content: sourceElement ? renderedTextContent(sourceElement, context.document) || content : content,
      lineCount,
      fontFamily,
      fontSize,
      fontWeight,
        lineHeight,
      letterSpacing: numberValue(style.letterSpacing),
      textAlign: style.textAlign === "center" || style.textAlign === "right" ? style.textAlign : style.textAlign === "justify" ? "justified" : "left",
        textTransform: style.textTransform === "uppercase" || style.textTransform === "lowercase" || style.textTransform === "capitalize" ? style.textTransform : "none",
        fontStyle: style.fontStyle,
        textDecoration: style.textDecorationLine || style.textDecoration,
        textShadow: style.textShadow !== "none" ? style.textShadow : undefined,
        verticalAlign: style.verticalAlign,
        overflowWrap: style.overflowWrap,
        wordBreak: style.wordBreak,
        hyphens: style.hyphens,
        whiteSpace: style.whiteSpace,
        textIndent: numberValue(style.textIndent),
        direction: style.direction,
      },
    children: [],
  };
}

function createNode(element: Element, context: CaptureContext, parentRect?: DOMRect, parentScaleX = 1, parentScaleY = 1): DesignNode | null {
  const tag = element.tagName.toUpperCase();
  if (IGNORED_TAGS.has(tag)) return null;
  const style = context.document.defaultView?.getComputedStyle(element);
  if (!style || style.display === "none" || style.visibility === "hidden") return null;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0 && !textContent(element)) return null;
  const id = makeId(context, element);
  const positioning = positioningValue(style.position);
  const backgroundFallback = backgroundSvgDataUrl(style.backgroundImage, style.backgroundColor, rect.width, rect.height);
  const backgroundAssetId = backgroundFallback
    ? addAsset(context, "svg", backgroundFallback, backgroundFallback)
    : undefined;
  if (backgroundAssetId) {
    context.diagnostics.push({ code: "background-svg-fallback", message: "Complex CSS background layers were preserved as an inline SVG asset for Figma", nodeId: id });
  }
  recordUnsupportedStyles(context, style, id);
  const autoLayoutHint = element.getAttribute("data-figma-auto-layout");
  const attributes = autoLayoutHint === "horizontal" || autoLayoutHint === "vertical"
    ? { "data-figma-auto-layout": autoLayoutHint }
    : undefined;
  const common = {
    id,
    sourceTag: tag,
    rect: rectFor(element, positioning === "fixed" ? undefined : parentRect, positioning === "fixed" ? 1 : parentScaleX, positioning === "fixed" ? 1 : parentScaleY),
    opacity: numberValue(style.opacity, 1),
    fill: colorFromStyle(style.backgroundColor),
    gradient: style.backgroundImage !== "none" && style.backgroundImage.includes("gradient") ? style.backgroundImage : undefined,
    backgroundImage: style.backgroundImage !== "none" ? resolveCssImageUrls(style.backgroundImage, context.document) : undefined,
    backgroundAssetId,
    stroke: borderFor(style, "Top"),
    borders: [borderFor(style, "Top"), borderFor(style, "Right"), borderFor(style, "Bottom"), borderFor(style, "Left")] as DesignNode["borders"],
    shadow: shadowFromStyle(style.boxShadow),
    shadows: shadowsFromStyle(style.boxShadow),
    shadowCss: style.boxShadow !== "none" ? style.boxShadow : undefined,
    backgroundSize: style.backgroundSize !== "auto" ? style.backgroundSize : undefined,
    backgroundPosition: style.backgroundPosition !== "0% 0%" ? style.backgroundPosition : undefined,
    backgroundRepeat: style.backgroundRepeat !== "repeat" ? style.backgroundRepeat : undefined,
    transform: style.transform !== "none" ? style.transform : undefined,
    zIndex: Number.isFinite(Number.parseInt(style.zIndex, 10)) ? Number.parseInt(style.zIndex, 10) : undefined,
    geometryIncludesTransform: style.transform !== "none",
    positioning,
    positionOffset: positioning === "relative"
      && (style.left !== "auto" || style.top !== "auto")
      ? { left: numberValue(style.left), top: numberValue(style.top) }
      : undefined,
    objectFit: style.objectFit !== "fill" ? style.objectFit : undefined,
    objectPosition: style.objectPosition !== "50% 50%" ? style.objectPosition : undefined,
    overflow: style.overflow !== "visible" ? style.overflow : undefined,
    filter: style.filter !== "none" ? style.filter : undefined,
    backdropFilter: style.backdropFilter !== "none" ? style.backdropFilter : undefined,
    computedStyles: computedStyleMap(style),
    attributes,
    radius: radiusFor(style, rect.width, rect.height),
    margin: parseMargin(style),
    layout: layoutFor(style, {
      element,
      rect,
      parentStyle: element.parentElement ? context.document.defaultView?.getComputedStyle(element.parentElement) : undefined,
    }),
    children: [] as DesignNode[],
  };

  if (element instanceof HTMLImageElement || tag === "IMG") {
    const source = imageSource(element as HTMLImageElement);
    const resolvedSource = source ? resolveResourceUrl(source.src, context.document) : "";
    const assetId = source ? addAsset(context, "image", resolvedSource, source.data ?? context.imageData.get(resolvedSource)) : undefined;
    if (!assetId) context.diagnostics.push({ code: "image-missing-src", message: "Image has no readable source", nodeId: id });
    else if (source && !source.data && !source.src.startsWith("data:")) {
      context.diagnostics.push({ code: "image-external", message: "Image is referenced by URL and may require network access in Figma", nodeId: id });
    }
    return { ...common, type: "image", assetId };
  }

  if (tag === "SVG") {
    const svg = inlineSvgStyles(element, context.document);
    const assetId = addAsset(context, "svg", `inline:${id}`, svg);
    return { ...common, type: "vector", assetId, svg };
  }

  const childElements = Array.from(element.children).filter((child) => !IGNORED_TAGS.has(child.tagName.toUpperCase()));
  const content = textContent(element);
  const hasVisualTextContainer = tag === "BUTTON"
    || Boolean(common.fill || common.gradient || common.stroke || common.shadow || common.radius.some((value) => value > 0));
  const isTextLeaf = Boolean(content)
    && !hasVisualTextContainer
    && (childElements.length === 0
      || (style.display !== "flex"
        && style.display !== "inline-flex"
        && style.display !== "grid"
        && containsOnlyInlineText(element)
        && !hasDistinctInlineTextStyle(element, style, context.document)));
  if (isTextLeaf) {
    const inlineRect = inlineTextRect(element, parentRect, context.document, parentScaleX, parentScaleY);
    return { ...common, ...textNodeFor(context, id, inlineRect || common.rect, style, content, element, common.margin, common.layout, inlineRect ? "glyph" : "element"), type: "text" };
  }

  let directTextSequence = 0;
  const childScale = axisTransformScale(style);
  const hasInlineChildren = childElements.some((child) => INLINE_TEXT_TAGS.has(child.tagName.toUpperCase()));
  const preservesInlineWhitespace = hasInlineChildren
    && !["flex", "inline-flex", "grid", "inline-grid"].includes(style.display);
  for (const child of Array.from(element.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const textNode = child as Text;
      const text = renderedTextNodeContent(textNode, context.document);
      const textRect = text ? textNodeRect(textNode, rect, context.document) : null;
      const normalizedTextRect = textRect
        ? {
          x: textRect.x / childScale.x,
          y: textRect.y / childScale.y,
          width: textRect.width / childScale.x,
          height: textRect.height / childScale.y,
        }
        : null;
      const isWhitespaceRun = Boolean(text) && !/\S/.test(text) && !text.includes("\n");
      if (normalizedTextRect && (/\S/.test(text) || (preservesInlineWhitespace && isWhitespaceRun && normalizedTextRect.width > 0.01))) {
        const textLayer = textNodeFor(context, `${id}-text-${directTextSequence++}`, normalizedTextRect, style, text);
        // The container owns CSS opacity. A raw text run is inherited content,
        // so carrying the same value on both layers would make H2D/Figma
        // multiply it and render the text too faint.
        textLayer.opacity = 1;
        common.children.push(textLayer);
      }
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const node = createNode(child as Element, context, rect, childScale.x, childScale.y);
    if (node) common.children.push(node);
  }
  for (const pseudo of ["::before", "::after"] as const) {
    const pseudoStyle = context.document.defaultView?.getComputedStyle(element, pseudo);
    if (!pseudoStyle) continue;
    const pseudoContent = pseudoContentValue(pseudoStyle.content);
    const pseudoRect = pseudoPosition(rect, pseudoStyle, pseudoContent, context.document);
    const pseudoHasVisualBox = pseudoStyle.width !== "auto"
      || pseudoStyle.height !== "auto"
      || pseudoStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
      || pseudoStyle.backgroundImage !== "none"
      || pseudoStyle.borderTopWidth !== "0px"
      || pseudoStyle.boxShadow !== "none";
    if (!pseudoContent && !pseudoHasVisualBox) continue;
    const pseudoId = `${id}-${pseudo.slice(2)}`;
    recordUnsupportedStyles(context, pseudoStyle, pseudoId);
    const pseudoCommon = {
      id: pseudoId,
      pseudo: pseudo.slice(2) as "before" | "after",
      rect: pseudoRect,
      opacity: numberValue(pseudoStyle.opacity, 1),
      fill: colorFromStyle(pseudoStyle.backgroundColor),
      gradient: pseudoStyle.backgroundImage !== "none" && pseudoStyle.backgroundImage.includes("gradient") ? pseudoStyle.backgroundImage : undefined,
      backgroundImage: pseudoStyle.backgroundImage !== "none" ? resolveCssImageUrls(pseudoStyle.backgroundImage, context.document) : undefined,
      stroke: borderFor(pseudoStyle, "Top"),
      borders: [borderFor(pseudoStyle, "Top"), borderFor(pseudoStyle, "Right"), borderFor(pseudoStyle, "Bottom"), borderFor(pseudoStyle, "Left")] as DesignNode["borders"],
      shadow: shadowFromStyle(pseudoStyle.boxShadow),
      shadows: shadowsFromStyle(pseudoStyle.boxShadow),
      shadowCss: pseudoStyle.boxShadow !== "none" ? pseudoStyle.boxShadow : undefined,
      backgroundSize: pseudoStyle.backgroundSize !== "auto" ? pseudoStyle.backgroundSize : undefined,
      backgroundPosition: pseudoStyle.backgroundPosition !== "0% 0%" ? pseudoStyle.backgroundPosition : undefined,
      backgroundRepeat: pseudoStyle.backgroundRepeat !== "repeat" ? pseudoStyle.backgroundRepeat : undefined,
      transform: pseudoStyle.transform !== "none" ? pseudoStyle.transform : undefined,
      zIndex: Number.isFinite(Number.parseInt(pseudoStyle.zIndex, 10)) ? Number.parseInt(pseudoStyle.zIndex, 10) : undefined,
      geometryIncludesTransform: pseudoStyle.transform !== "none",
      positioning: positioningValue(pseudoStyle.position),
      positionOffset: positioningValue(pseudoStyle.position) === "relative"
        && (pseudoStyle.left !== "auto" || pseudoStyle.top !== "auto")
        ? { left: numberValue(pseudoStyle.left), top: numberValue(pseudoStyle.top) }
        : undefined,
      computedStyles: computedStyleMap(pseudoStyle),
      radius: radiusFor(pseudoStyle, pseudoRect.width, pseudoRect.height),
      margin: [0, 0, 0, 0] as [number, number, number, number],
      layout: layoutFor(pseudoStyle),
      children: [] as DesignNode[],
    };
    if (pseudoContent) {
      const pseudoText = {
        ...pseudoCommon,
        id: `${pseudoId}-text`,
        // The generated-content role belongs to the pseudo wrapper. When a
        // painted pseudo has an editable text child, that child must remain a
        // normal child of the pseudo node rather than becoming a nested
        // pseudoElementNodes entry.
        pseudo: pseudoHasVisualBox ? undefined : pseudoCommon.pseudo,
        rect: {
          x: 0,
          y: 0,
          width: pseudoRect.width,
          height: pseudoRect.height,
        },
        type: "text" as const,
        // The pseudo Frame owns CSS opacity; applying it again to the text
        // child would multiply the value in Figma.
        opacity: 1,
        fill: colorFromStyle(pseudoStyle.color),
        text: {
          content: pseudoContent,
          lineCount: Math.max(1, pseudoContent.split(/\r?\n/).length),
          fontFamily: pseudoStyle.fontFamily.split(",")[0].trim().replace(/["']/g, "") || "Inter",
          fontSize: numberValue(pseudoStyle.fontSize, 16),
          fontWeight: numberValue(pseudoStyle.fontWeight, 400),
          lineHeight: pseudoStyle.lineHeight === "normal" ? numberValue(pseudoStyle.fontSize, 16) * 1.2 : numberValue(pseudoStyle.lineHeight, numberValue(pseudoStyle.fontSize, 16) * 1.2),
          letterSpacing: numberValue(pseudoStyle.letterSpacing),
          textAlign: pseudoStyle.textAlign === "center" || pseudoStyle.textAlign === "right" ? pseudoStyle.textAlign : "left",
          fontStyle: pseudoStyle.fontStyle,
          textDecoration: pseudoStyle.textDecorationLine || pseudoStyle.textDecoration,
          textShadow: pseudoStyle.textShadow !== "none" ? pseudoStyle.textShadow : undefined,
          verticalAlign: pseudoStyle.verticalAlign,
          overflowWrap: pseudoStyle.overflowWrap,
          wordBreak: pseudoStyle.wordBreak,
          hyphens: pseudoStyle.hyphens,
          whiteSpace: pseudoStyle.whiteSpace,
          textIndent: numberValue(pseudoStyle.textIndent),
          direction: pseudoStyle.direction,
        } satisfies DesignTextStyle,
      };
      // A pseudo-element with a painted box is a real layer plus a text run.
      // Keeping the text as a child preserves the box fill/stroke/radius while
      // still allowing the generated glyph to remain editable in Figma.
      common.children.push(pseudoHasVisualBox
        ? { ...pseudoCommon, type: "frame" as const, children: [pseudoText] }
        : pseudoText);
    } else {
      common.children.push({ ...pseudoCommon, type: "frame" });
    }
  }
  // Pseudo-elements participate in the source stacking order. They are
  // collected after real children above so their computed styles are easy to
  // read, then placed back into the browser order before returning the node.
  const beforeChildren = common.children.filter((child) => child.id === `${id}-before`);
  const afterChildren = common.children.filter((child) => child.id === `${id}-after`);
  if (beforeChildren.length || afterChildren.length) {
    const pseudoIds = new Set([...beforeChildren, ...afterChildren].map((child) => child.id));
    const regularChildren = common.children.filter((child) => !pseudoIds.has(child.id));
    common.children = [...beforeChildren, ...regularChildren, ...afterChildren];
  }
  return { ...common, type: "frame" };
}

/**
 * Figma's importer can legitimately rebuild Auto Layout, but its font metrics
 * and fractional flex rounding are not guaranteed to match the capture
 * browser. Preserve the measured relative placement as a second channel so
 * the importer can keep the parent layout semantics without moving children.
 */
export function lockMeasuredGeometry(node: DesignNode): void {
  // Keep the shared scene model editable by default. A geometry lock turns a
  // child into an absolute visual snapshot in both the H2D document and the
  // native Figma bridge; applying it to every flex child destroys the very
  // Auto Layout structure we are trying to preserve and causes placeholder,
  // gap, and padding offsets to accumulate. Only layouts that cannot be
  // represented reliably by a single Auto Layout pass need this second
  // channel: wrapped/grid tracks, distribution-sensitive tracks, and
  // explicitly out-of-flow positioned layers.
  // Figma and the browser can resolve main-axis distributions such as
  // `space-between`/centered tracks differently once font metrics, borders,
  // or fractional widths are applied. Cross-axis `align-items: center` is
  // already represented by Figma's counter-axis alignment and stays flowable.
  // Preserve the parent Auto Layout metadata, but pin the visible children to
  // the browser's measured coordinates for distribution-sensitive containers.
  // Ordinary start-aligned stacks remain real flow children so they stay
  // editable and responsive in the native plugin.
  // A distribution lock belongs to the direct children of the sensitive
  // container. Once that child is locked, its own Auto Layout subtree must
  // remain a real flow tree; recursively locking icon/text grandchildren
  // turns a vertical nav item into several unrelated absolute layers.
  const measuredParentLayout = !node.layout.geometryLock && node.layout.mode !== "none" && (
    node.layout.wrap === true
      || node.layout.reverse === true
      || node.layout.justifyContent === "center"
      || node.layout.justifyContent === "end"
      || node.layout.justifyContent === "space-between"
      || node.layout.justifyContent === "space-around"
      || node.layout.justifyContent === "space-evenly"
      || node.layout.alignContent === "center"
      || node.layout.alignContent === "end"
      || node.layout.alignContent === "space-between"
      || node.layout.alignContent === "space-around"
      || node.layout.alignContent === "space-evenly"
  );
  const measuredVisualGroup = node.layout.geometryLock && node.layout.mode === "none";
  for (const child of node.children) {
    // A geometry-locked non-layout parent is a measured visual group rather
    // than a reliable browser flow container. If one child is removed from
    // normal flow (for example a measured heading), leaving its siblings in
    // flow changes every following y-position during H2D replay. Pin all
    // direct children to their captured coordinates while keeping the group
    // itself editable as a frame.
    const isOutOfFlow = child.positioning === "absolute"
      || child.positioning === "fixed"
      || child.positioning === "sticky";
    // Figma only exposes STRETCH as a per-child cross-axis override. CSS
    // align-self center/end therefore needs the measured snapshot path even
    // when the parent itself is start-aligned; otherwise the layer snaps to
    // the parent's cross-axis origin during import.
    const isCrossAxisAlignmentSensitive = child.layout.alignSelf === "center"
      || child.layout.alignSelf === "end";
    // Small static decorations (status dots, badges, and similar inline
    // marks) are already stable in a non-wrapped flex row. Removing one from
    // that flow changes the anonymous text run's starting position and makes
    // the H2D importer render the following label too far left. Keep these
    // leaves in flow; explicit CSS positioning and wrapped/grid tracks still
    // use the measured snapshot path.
    const isTinyInlineDecoration = child.positioning === "static"
      && child.layout.position !== "absolute"
      && child.type !== "text"
      && child.rect.width <= 12
      && child.rect.height <= 12
      && node.layout.wrap !== true;
    const shouldLockForParent = measuredParentLayout && !isTinyInlineDecoration;
    if (isOutOfFlow || shouldLockForParent || measuredVisualGroup || isCrossAxisAlignmentSensitive) {
      child.layout = { ...child.layout, geometryLock: true };
    }
    lockMeasuredGeometry(child);
  }
}

export function sanitizeSource(source: string): string {
  if (typeof DOMParser === "undefined") return source;
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());
  // Keep the authored stylesheet intact, including the generated page's
  // marked Figma Auto Layout compatibility rules. Those rules are part of the
  // rendered page the user sees in the Board (for example, they intentionally
  // turn map controls into a vertical flex layout), so removing them here
  // would measure a different document and produce visibly shifted H2D data.
  parsed.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith("on") || attribute.name.startsWith("data-codex-")) element.removeAttribute(attribute.name);
    });
  });
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

function waitForAssets(doc: Document): Promise<void> {
  const images = Array.from(doc.images);
  const imageWait = Promise.all(images.map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    })));
  const fonts = doc.fonts?.ready ?? Promise.resolve();
  const settled = Promise.all([imageWait, fonts]).then(() => undefined);
  // A cross-origin image or a browser font can leave its promise pending
  // forever. Continue with the captured layout after a bounded wait; the
  // resulting node keeps its source URL so the importer can report the asset
  // limitation instead of leaving the copy action stuck.
  return Promise.race([
    settled,
    new Promise<void>((resolve) => window.setTimeout(resolve, ASSET_WAIT_TIMEOUT_MS)),
  ]);
}

function nextFrames(win: Window): Promise<void> {
  // A fixed, transparent capture iframe can be throttled by Chromium when
  // the host window is backgrounded. Keep the two-frame stability requirement
  // when rAF is scheduled, but never let a throttled iframe block clipboard
  // export indefinitely. The capture still waits for fonts/images separately.
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = window.setTimeout(finish, 160);
    const frame = () => {
      if (settled) return;
      win.requestAnimationFrame(() => {
        if (settled) return;
        win.requestAnimationFrame(() => {
          window.clearTimeout(timeout);
          finish();
        });
      });
    };
    try {
      frame();
    } catch {
      window.clearTimeout(timeout);
      finish();
    }
  });
}

export async function captureHtmlPage(page: Page, deviceFrame?: Pick<DeviceFrame, "width" | "height">): Promise<DesignDocument> {
  if (page.source.type !== "html") throw new Error("URL pages require official Figma Capture page");
  if (typeof document === "undefined") throw new Error("HTML capture requires a browser document");
  const viewport = {
    width: deviceFrame?.width ?? DEFAULT_VIEWPORT.width,
    height: deviceFrame?.height ?? DEFAULT_VIEWPORT.height,
  };
  const iframe = document.createElement("iframe");
  iframe.title = `Figma export for ${page.title}`;
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("sandbox", "allow-same-origin");
  // Keep the iframe at the viewport origin so fixed-position descendants are
  // measured in the same coordinate space as the captured document. It is
  // still invisible and non-interactive, so it cannot affect the workbench.
  iframe.style.cssText = `position:fixed;left:0;top:0;width:${viewport.width}px;height:${viewport.height}px;border:0;opacity:0;pointer-events:none;`;
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Timed out waiting for HTML capture")), CAPTURE_TIMEOUT_MS);
      const cleanup = () => window.clearTimeout(timeout);
      iframe.addEventListener("load", () => { cleanup(); resolve(); }, { once: true });
      iframe.addEventListener("error", () => { cleanup(); reject(new Error("HTML capture failed")); }, { once: true });
      // Register listeners before assigning srcdoc. Some Chromium builds can
      // deliver the initial about:srcdoc load before the next task boundary.
      iframe.srcdoc = sanitizeSource(page.source.value);
    });
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;
    if (!frameDocument || !frameWindow) throw new Error("Capture document is unavailable");
    await waitForAssets(frameDocument);
    await nextFrames(frameWindow);
    const context: CaptureContext = {
      document: frameDocument,
      assets: [],
      assetBySource: new Map(),
      fonts: new Map(),
      diagnostics: [],
      fontDiagnostics: new Set(),
      imageData: new Map(),
      sequence: 0,
    };
    await inlineAccessibleImages(frameDocument, context);
    // Inlining an accessible image can change its intrinsic dimensions even
    // after the source document's initial load has settled. Wait for the
    // replacement resources and another two animation frames before reading
    // any rectangles, otherwise one image can shift every later flex sibling
    // and the transient layout is what gets exported to Figma.
    await waitForAssets(frameDocument);
    await nextFrames(frameWindow);
    // Match the official H2D serializer's document capture boundary. The
    // browser extension starts at `document.documentElement` and skips HEAD
    // during node serialization, leaving the rendered BODY as its child. A
    // BODY-only root is visually equivalent in replay but is not accepted by
    // some Figma Desktop importers because the document shape no longer
    // matches the extension's H2D contract.
    const documentRoot = frameDocument.documentElement;
    const documentRootRect = documentRoot.getBoundingClientRect();
    const root = createNode(documentRoot, context, undefined) ?? {
      id: "node-root",
      type: "frame",
      rect: { x: 0, y: 0, width: viewport.width, height: 0 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const hasViewportAnchoredNode = Array.from(frameDocument.querySelectorAll("*"))
      .some((candidate) => {
        const candidateStyle = frameWindow.getComputedStyle(candidate);
        return candidateStyle.position === "fixed" || candidateStyle.position === "sticky";
      });
    if (hasViewportAnchoredNode) {
      context.diagnostics.push({ code: "fixed-position", message: "Fixed-position content is captured at the selected viewport coordinates" });
    }
    const viewportHeight = Math.max(frameDocument.body.scrollHeight, documentRootRect.height, viewport.height, root.rect.height);
    if (root.rect.height < viewportHeight) root.rect.height = viewportHeight;
    // Keep the shared scene model's browser-measured placement for consumers
    // that build native Figma nodes. The H2D serializer omits the private flag
    // from its marker metadata, but uses it to pin only distribution-sensitive
    // layers to their measured parent-relative coordinates.
    lockMeasuredGeometry(root);
    return {
      version: 1,
      pageId: page.id,
      title: page.title,
      viewport: { width: viewport.width, height: viewportHeight },
      viewportRect: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      devicePixelRatio: frameWindow.devicePixelRatio || 1,
      root,
      assets: context.assets,
      fonts: Array.from(context.fonts.values()),
      diagnostics: context.diagnostics,
    };
  } finally {
    iframe.remove();
  }
}
