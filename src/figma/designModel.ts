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
  /** CSS border-image gradient, when the border is painted from a gradient. */
  gradient?: string;
  /** CSS border-image URL source, when the border is painted from an image. */
  imageSource?: string;
  /** Captured image asset backing `imageSource`, when available. */
  imageAssetId?: string;
  /**
   * Resolved painted thickness for a CSS border-image. CSS keeps the layout
   * border width and the border-image paint width as separate concepts; Figma
   * needs the latter for the visible stroke without changing the captured box.
   */
  paintWidth?: number;
  /** Resolved outside expansion for a CSS border-image paint. */
  paintOutset?: number;
  /** CSS border-image source slice, retained for H2D/native consumers. */
  paintSlice?: string;
  /** CSS border-image repeat mode, retained for H2D/native consumers. */
  paintRepeat?: string;
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
  /** Preserve CSS flex/grid direction, including RTL inline-axis reversal. */
  reverse?: boolean;
  /** CSS auto margins on the four physical edges (top, right, bottom, left). */
  autoMargins?: [boolean, boolean, boolean, boolean];
  gap: number;
  /** Preserve independent CSS row/column gaps when the source uses them. */
  rowGap?: number;
  columnGap?: number;
  /** Authored CSS gap token retained beside the resolved pixel value. */
  gapExpression?: string;
  /** Authored CSS row-gap token retained beside the resolved pixel value. */
  rowGapExpression?: string;
  /** Authored CSS column-gap token retained beside the resolved pixel value. */
  columnGapExpression?: string;
  padding: [number, number, number, number];
  /** CSS grid is represented as a wrapped row using measured child widths. */
  wrap?: boolean;
  /** CSS flex-wrap: wrap-reverse; Figma has no native reversed track order. */
  wrapReverse?: boolean;
  /** CSS grid metadata is retained for consumers that can represent tracks. */
  gridTemplateColumns?: string;
  gridTemplateRows?: string;
  gridTemplateAreas?: string;
  gridAutoFlow?: string;
  gridAutoColumns?: string;
  gridAutoRows?: string;
  /** CSS Grid item placement retained even when Figma uses measured wrapping. */
  gridColumnStart?: string;
  gridColumnEnd?: string;
  gridRowStart?: string;
  gridRowEnd?: string;
  gridArea?: string;
  alignItems?: "start" | "center" | "end" | "stretch" | "baseline";
  alignSelf?: "auto" | "start" | "center" | "end" | "stretch" | "baseline";
  alignContent?: "start" | "center" | "end" | "space-between" | "space-around" | "space-evenly" | "stretch";
  justifyItems?: "start" | "center" | "end" | "stretch";
  justifySelf?: "auto" | "start" | "center" | "end" | "stretch";
  /** Authored CSS place-content shorthand retained beside its resolved axes. */
  placeContent?: string;
  placeItems?: string;
  placeSelf?: string;
  order?: number;
  justifyContent?: "start" | "center" | "end" | "stretch" | "space-between" | "space-around" | "space-evenly";
  widthMode: DesignSizingMode;
  heightMode: DesignSizingMode;
  /** Authored CSS sizing token kept separate from the captured pixel box. */
  widthExpression?: string;
  /** Authored CSS sizing token kept separate from the captured pixel box. */
  heightExpression?: string;
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
  /** CSS font-synthesis contract retained for shaping-accurate replay. */
  fontSynthesis?: string;
  fontSynthesisWeight?: string;
  fontSynthesisStyle?: string;
  fontSynthesisSmallCaps?: string;
  fontSynthesisPosition?: string;
  lineHeight: number;
  letterSpacing: number;
  /** CSS word-spacing in resolved pixels; Figma has no native node-level equivalent. */
  wordSpacing?: number;
  textAlign: "left" | "center" | "right" | "justified";
  /** CSS last-line alignment retained for measured text fallbacks. */
  textAlignLast?: string;
  /** CSS justification method retained for measured text fallbacks. */
  textJustify?: string;
  textTransform?: "none" | "uppercase" | "lowercase" | "capitalize";
  fontStyle?: string;
  textDecoration?: string;
  /** CSS decoration paint/geometry retained for importers with richer text APIs. */
  textDecorationStyle?: string;
  textDecorationColor?: string;
  textDecorationThickness?: string;
  textUnderlineOffset?: string;
  textOverflow?: string;
  /** CSS line-clamp value when the source limits visible lines. */
  maxLines?: number;
  textShadow?: string;
  /** Resolved CSS -webkit-text-stroke paint retained on editable text. */
  textStrokeWidth?: number;
  textStrokeColor?: string;
  /** Effective -webkit-text-fill-color when it differs from `color`. */
  textFillColor?: string;
  verticalAlign?: string;
  overflowWrap?: string;
  wordBreak?: string;
  hyphens?: string;
  whiteSpace?: string;
  /** CSS first-line indent, including a measured offset for mixed inline runs. */
  textIndent?: number;
  direction?: string;
  /** CSS Text Level 4 wrapping/whitespace controls retained for importers. */
  textWrapMode?: string;
  whiteSpaceCollapse?: string;
  textBoxTrim?: string;
  textBoxEdge?: string;
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

export interface DesignSemantics {
  /** Explicit ARIA role, or the implicit HTML role resolved during capture. */
  role?: string;
  /** Capture-time accessible name used for readable Figma layer names. */
  label?: string;
  /** Accessible description kept as inspectable Figma node metadata. */
  description?: string;
  /** Relevant ARIA/native control state without presentation-only attributes. */
  states?: Record<string, string>;
}

export interface DesignNode {
  id: string;
  /** Original DOM tag used by H2D when browser semantics matter. */
  sourceTag?: string;
  /** `display: contents` contributes structure but has no own CSS box. */
  displayContents?: boolean;
  /**
   * Semantics belonging to flattened `display: contents` ancestors. These
   * entries are metadata-only and must not create an extra visual/layout box.
   */
  structuralSemantics?: DesignSemantics[];
  /** Source wrapper ids parallel to structuralSemantics for report de-duplication. */
  structuralSemanticOwners?: string[];
  /** HTML/ARIA meaning retained independently from the visual layer model. */
  semantics?: DesignSemantics;
  /** CSS generated-content role. Pseudo elements use the H2D-compatible side channel. */
  pseudo?: "before" | "after";
  type: DesignNodeType;
  rect: DesignRect;
  /** Range-measured glyph box inside a text element, relative to `rect`. */
  textRect?: DesignRect;
  /** Per-line Range fragments inside a text element, relative to `rect`. */
  textLineRects?: DesignRect[];
  opacity: number;
  fill?: DesignColor;
  gradient?: string;
  /** Complete CSS background-image value, including URL and layered images. */
  backgroundImage?: string;
  /** SVG fallback for CSS background layers that Figma cannot reproduce natively. */
  backgroundAssetId?: string;
  stroke?: DesignStroke;
  /** CSS outline, which is painted outside the border box and does not affect layout. */
  outline?: DesignStroke;
  outlineOffset?: number;
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
  /** CSS background attachment mode; Figma has no scrolling-background equivalent. */
  backgroundAttachment?: string;
  transform?: string;
  transformOrigin?: string;
  /** Capture retained a CSS transform; axis-aligned layout rects may be normalized before export. */
  geometryIncludesTransform?: boolean;
  zIndex?: number;
  /** CSS positioning context, retained separately from auto-layout flow. */
  positioning?: "static" | "relative" | "absolute" | "fixed" | "sticky";
  positionOffset?: { left: number; top: number };
  /** Authored relative-position tokens retained beside resolved offsets. */
  positionOffsetExpression?: { left?: string; right?: string; top?: string; bottom?: string };
  /** Whether a fixed layer is anchored to the viewport or a CSS containing-block ancestor. */
  fixedScope?: "viewport" | "ancestor";
  /** Measured fixed offset relative to the ancestor containing block's captured border box. */
  fixedOffset?: { x: number; y: number };
  /** Stable capture id of the transformed/contained ancestor that owns fixed positioning. */
  fixedContainingBlockId?: string;
  /** Importer successfully reparented an ancestor-scoped fixed layer to its containing Frame. */
  fixedContainingBlockHoisted?: boolean;
  objectFit?: string;
  objectPosition?: string;
  /** CSS object-view-box crop applied before object-fit. */
  objectViewBox?: string;
  overflow?: string;
  filter?: string;
  backdropFilter?: string;
  /** Full computed CSS values retained for H2D-compatible consumers. */
  computedStyles?: Record<string, string>;
  /** Raw responsive sizing declarations retained across H2D/plugin boundaries. */
  sizingConstraints?: Partial<Record<"minWidth" | "maxWidth" | "minHeight" | "maxHeight", string>>;
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
