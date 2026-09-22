export type DesignNodeType = "frame" | "text" | "image" | "vector";
export type DesignLayoutMode = "none" | "horizontal" | "vertical";
export type DesignSizingMode = "fixed" | "hug" | "fill";

export interface DesignRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DesignColor {
  color: string;
  opacity?: number;
}

export interface DesignStroke {
  color: string;
  width: number;
  opacity?: number;
  /** CSS border style retained for consumers that can represent dashes. */
  style?: "solid" | "dashed" | "dotted" | "double" | string;
}

export interface DesignShadow {
  color: string;
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  opacity?: number;
  inset?: boolean;
}

export interface DesignLayout {
  mode: DesignLayoutMode;
  /** Preserve CSS row-reverse/column-reverse without conflating it with axis. */
  reverse?: boolean;
  gap: number;
  /** Preserve independent CSS row/column gaps when the source uses them. */
  rowGap?: number;
  columnGap?: number;
  padding: [number, number, number, number];
  /** CSS grid is represented as a wrapped row using measured child widths. */
  wrap?: boolean;
  /** CSS grid metadata is retained for consumers that can represent tracks. */
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridAutoFlow?: string;
  alignItems?: "start" | "center" | "end" | "stretch";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch";
  alignContent?: "start" | "center" | "end" | "space-between" | "space-around" | "space-evenly" | "stretch";
  justifyItems?: "start" | "center" | "end" | "stretch";
  justifySelf?: "auto" | "start" | "center" | "end" | "stretch";
  placeItems?: string;
  placeSelf?: string;
  order?: number;
  justifyContent?: "start" | "center" | "end" | "space-between" | "space-around" | "space-evenly";
  widthMode: DesignSizingMode;
  heightMode: DesignSizingMode;
  position: "flow" | "absolute";
  /**
   * Keep the measured browser geometry when a downstream importer has
   * different font metrics or flex/grid rounding. The parent still carries
   * its Auto Layout metadata; this flag only locks this node's placement.
  */
  geometryLock?: boolean;
  /** Native importer hint for preserving Auto Layout frames around captured bounds. */
  visualSnapshot?: boolean;
}

export interface DesignTextStyle {
  content: string;
  /** Number of visual lines measured in the capture browser. */
  lineCount?: number;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign: "left" | "center" | "right" | "justified";
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  fontStyle?: string;
  textDecoration?: string;
  textShadow?: string;
  verticalAlign?: string;
  overflowWrap?: string;
  wordBreak?: string;
  hyphens?: string;
  whiteSpace?: string;
  textIndent?: number;
  direction?: string;
}

export interface DesignAsset {
  id: string;
  kind: "image" | "svg" | "font";
  src?: string;
  data?: string;
  family?: string;
  weight?: number;
}

export interface DesignFontUsage {
  family: string;
  weight: number;
  style?: string;
  stretch?: string;
  size?: number;
  sample?: string;
  metrics?: {
    fontBoundingBoxAscent?: number;
    fontBoundingBoxDescent?: number;
  };
}

export interface DesignDiagnostic {
  code: string;
  message: string;
  nodeId?: string;
}

export interface DesignNode {
  id: string;
  /** Original DOM tag used by H2D when browser semantics matter. */
  sourceTag?: string;
  /** CSS generated-content role. Pseudo elements use the H2D-compatible side channel. */
  pseudo?: "before" | "after";
  type: DesignNodeType;
  rect: DesignRect;
  /** Range-measured glyph box inside a text element, relative to `rect`. */
  textRect?: DesignRect;
  opacity: number;
  fill?: DesignColor;
  gradient?: string;
  /** Complete CSS background-image value, including URL and layered images. */
  backgroundImage?: string;
  /** SVG fallback for CSS background layers that Figma cannot reproduce natively. */
  backgroundAssetId?: string;
  stroke?: DesignStroke;
  borders?: [DesignStroke | undefined, DesignStroke | undefined, DesignStroke | undefined, DesignStroke | undefined];
  radius: [number, number, number, number];
  margin: [number, number, number, number];
  shadow?: DesignShadow;
  /** Original CSS shadow list, retained when the source uses multiple layers. */
  shadowCss?: string;
  shadows?: DesignShadow[];
  backgroundSize?: string;
  backgroundPosition?: string;
  backgroundRepeat?: string;
  transform?: string;
  transformOrigin?: string;
  /** Capture retained a CSS transform; axis-aligned layout rects may be normalized before export. */
  geometryIncludesTransform?: boolean;
  zIndex?: number;
  /** CSS positioning context, retained separately from auto-layout flow. */
  positioning?: "static" | "relative" | "absolute" | "fixed" | "sticky";
  positionOffset?: { left: number; top: number };
  objectFit?: string;
  objectPosition?: string;
  overflow?: string;
  filter?: string;
  backdropFilter?: string;
  /** Full computed CSS values retained for H2D-compatible consumers. */
  computedStyles?: Record<string, string>;
  /** Attributes retained for image/resource resolution in downstream importers. */
  attributes?: Record<string, string>;
  layout: DesignLayout;
  text?: DesignTextStyle;
  assetId?: string;
  svg?: string;
  children: DesignNode[];
}

export interface DesignDocument {
  version: 1;
  pageId: string;
  title: string;
  viewport: { width: number; height: number };
  /** The actual viewport used for capture; `viewport` is the full document size. */
  viewportRect?: { x: number; y: number; width: number; height: number };
  devicePixelRatio: number;
  root: DesignNode;
  assets: DesignAsset[];
  fonts: DesignFontUsage[];
  diagnostics: DesignDiagnostic[];
}

export function emptyLayout(): DesignLayout {
  return {
    mode: "none",
    gap: 0,
    padding: [0, 0, 0, 0],
    widthMode: "fixed",
    heightMode: "fixed",
    position: "flow",
  };
}
