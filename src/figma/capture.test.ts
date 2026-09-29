import { afterEach, describe, expect, it, vi } from "vitest";
import { applyMeasuredTextLineHeight, applyMeasuredTextLineRects, autoMarginEdges, backgroundSvgDataUrl, borderFor, capturedUnicodeBidi, computedStyleMap, cssStyleImageSources, effectiveTransform, establishesFixedContainingBlock, formControlChildElements, formControlTextRect, formControlTextValue, hasActiveStickyInset, hasDenseGridAutoFlow, hasDistinctInlineTextStyle, hasMultiColumnLayout, hasNonDefaultBackgroundAttachment, hasTextBoxInsets, hasUnsupportedBorderImageSlice, inheritedLineHeightFromAncestors, inlineSvgStyles, inlineTextRect, isDisplayContents, isMeasuredLineHeightKeyword, isTextBackgroundClip, isLayoutCapturable, layoutFor, listItemOrdinal, listMarkerImageSource, listMarkerText, lockMeasuredGeometry, measuredLineHeightFromLineTops, measuredSingleLineLineHeight, measuredTextIndentFromRects, normalizeRenderedText, normalizeImageSetForDevicePixelRatio, outlineFor, pseudoContentValue, radiusFor, rectWithoutAxisTransform, relativePositionContainingBlockSize, relativePositionExpressions, relativePositionOffset, renderedTextContent, renderedTextNodeContent, resolveCurrentColor, resolveLineHeightCustomProperties, resolvedGeneratedTextMetrics, resolvedGeneratedTextStyle, resolvedTextLineHeight, sanitizeSource, semanticsFor, shadowFromStyle, shadowsFromStyle, shouldUseBackgroundSvgFallback, sizingConstraintsFor, supportedMaskComposite, supportedMaskGradientLayer, supportedMaskMode, supportedMaskRepeat, tableCaptionIsBottom, tableCellNeedsGeometryLock, textAlignValue, textLineBoxRect, textLineHeight, textLineRectsForElement, textPaintFor, transformMatrixValues, transformOriginFor, unsupportedBlendModes, unsupportedBorderImageRepeat, unsupportedFilterFunctions, unsupportedTransformFunctions } from "./capture";
import { emptyLayout, type DesignNode } from "./designModel";

afterEach(() => vi.restoreAllMocks());

describe("CSS currentColor capture normalization", () => {
  it("resolves currentColor inside gradients and border-image values", () => {
    expect(resolveCurrentColor(
      "linear-gradient(90deg, currentColor, transparent), currentColor",
      "rgb(24, 48, 72)",
    )).toBe("linear-gradient(90deg, rgb(24, 48, 72), transparent), rgb(24, 48, 72)");
    expect(resolveCurrentColor("currentColor", "#123456")).toBe("#123456");
  });

  it("keeps currentColor gradient stops in the SVG fallback", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(90deg, currentColor 0%, transparent 100%)",
      "transparent",
      200,
      80,
      "rgb(24, 48, 72)",
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain("#183048");
    expect(svg).not.toContain("currentColor");
  });

  it("resolves currentColor in outline and text stroke paints", () => {
    const style = {
      color: "rgb(12, 34, 56)",
      outlineColor: "CurrentColor",
      outlineWidth: "2px",
      outlineStyle: "solid",
      getPropertyValue: (property: string) => property === "-webkit-text-stroke-color"
        ? "currentColor"
        : property === "-webkit-text-stroke-width" ? "2px" : "",
    } as unknown as CSSStyleDeclaration;
    expect(outlineFor(style)).toMatchObject({ color: "rgb(12, 34, 56)", width: 2 });
    expect(textPaintFor(style).strokeColor).toBe("rgb(12, 34, 56)");
    expect(outlineFor({
      color: "CurrentColor",
      outlineColor: "currentColor",
      outlineWidth: "1px",
      outlineStyle: "solid",
    } as unknown as CSSStyleDeclaration)).toMatchObject({ color: "rgb(0, 0, 0)", width: 1 });
  });
});

describe("CSS image-set capture normalization", () => {
  it("selects the closest density for the captured device pixel ratio", () => {
    const source = 'image-set(url("low.png") 1x, url("high.png") 2x), url("overlay.png")';

    expect(normalizeImageSetForDevicePixelRatio(source, 1)).toBe('url("low.png"), url("overlay.png")');
    expect(normalizeImageSetForDevicePixelRatio(source, 1.5)).toBe('url("high.png"), url("overlay.png")');
    expect(normalizeImageSetForDevicePixelRatio(source, 3)).toBe('url("high.png"), url("overlay.png")');
  });

  it("keeps the first candidate when no density descriptor is provided", () => {
    expect(normalizeImageSetForDevicePixelRatio(
      'image-set(url("first.png"), url("second.png"))',
      2,
    )).toBe('url("first.png")');
  });

  it("treats an omitted density descriptor as the CSS 1x candidate", () => {
    const source = 'image-set(url("default.png"), url("retina.png") 2x)';
    expect(normalizeImageSetForDevicePixelRatio(source, 1)).toBe('url("default.png")');
    expect(normalizeImageSetForDevicePixelRatio(source, 2)).toBe('url("retina.png")');
  });
});

describe("CSS generated-image asset discovery", () => {
  it("collects pseudo-element border-image and mask URLs with data URLs", () => {
    const style = {
      backgroundImage: 'url("background.png")',
      borderImageSource: 'url("frame.png")',
      maskImage: 'url("mask.png")',
      WebkitMaskImage: "",
      webkitMaskImage: "",
    } as unknown as CSSStyleDeclaration;

    expect(cssStyleImageSources(style)).toEqual([
      "background.png",
      "frame.png",
      "mask.png",
    ]);
  });

  it("deduplicates repeated generated-image sources", () => {
    const dataUrl = "data:image/png;base64,AAAA";
    const style = {
      backgroundImage: `url(${dataUrl}), url("frame.png")`,
      borderImageSource: `url("frame.png")`,
      maskImage: `url(${dataUrl})`,
    } as unknown as CSSStyleDeclaration;

    expect(cssStyleImageSources(style)).toEqual([dataUrl, "frame.png"]);
  });
});

describe("HTML text capture", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses a line-box fallback for normal line-height instead of glyph bounds", () => {
    expect(textLineHeight("normal", 16)).toBe(19.2);
    expect(textLineHeight("28px", 16)).toBe(28);
    expect(textLineHeight("1.5", 16)).toBe(24);
    expect(textLineHeight("150%", 16)).toBe(24);
    expect(textLineHeight("1.5em", 16)).toBe(24);
    expect(textLineHeight("2rem", 12, 20)).toBe(40);
    expect(textLineHeight("calc(1em + 4px)", 16)).toBe(20);
    expect(textLineHeight("calc(100% + 4px)", 16)).toBe(20);
    expect(textLineHeight("calc(150%)", 16)).toBe(24);
    expect(textLineHeight("calc(1 + 0.5)", 16)).toBe(24);
    expect(textLineHeight("calc(1.5 / 2)", 16)).toBe(12);
    expect(textLineHeight("min(28px, 2em)", 16)).toBe(28);
    expect(textLineHeight("max(20px, 1.5em)", 16)).toBe(24);
    expect(textLineHeight("clamp(20px, 2em, 40px)", 16)).toBe(32);
    expect(textLineHeight("min(calc(1em + 8px), 30px)", 16)).toBe(24);
    expect(textLineHeight("max(20px, calc(1.5em + 2px))", 16)).toBe(26);
    expect(textLineHeight("clamp(20px, calc(1.5em + 2px), 32px)", 16)).toBe(26);
    expect(textLineHeight("clamp(calc(1em + 2px), max(1.25em, 24px), calc(2em + 4px))", 16)).toBe(24);
    expect(textLineHeight("0.5px", 16)).toBe(0.5);
    expect(textLineHeight("0px", 16)).toBe(0.01);
    expect(textLineHeight("calc(0.25px + 0.25px)", 16)).toBe(0.5);
    expect(textLineHeight("2lh", 16)).toBeCloseTo(38.4, 8);
    expect(textLineHeight("1.5rlh", 16, 20)).toBeCloseTo(36, 8);
    expect(textLineHeight("1rlh", 16, 20, 19, 32)).toBe(32);
    expect(textLineHeight("calc(1lh + 4px)", 16)).toBeCloseTo(23.2, 8);
    expect(textLineHeight("min(var(--line-height), 24px)", 16)).toBeCloseTo(19.2, 8);
  });

  it("treats CSS initial line-height as a browser-measured keyword", () => {
    expect(isMeasuredLineHeightKeyword("initial")).toBe(true);
    expect(isMeasuredLineHeightKeyword("normal")).toBe(true);
    // Inheritance keywords must resolve through the parent used line box;
    // measuring a one-line glyph box here would discard the inherited leading.
    expect(isMeasuredLineHeightKeyword("inherit")).toBe(false);
    expect(isMeasuredLineHeightKeyword("unset")).toBe(false);
    expect(isMeasuredLineHeightKeyword("24px")).toBe(false);
  });

  it("expands anonymous multi-line text to the captured CSS line-box height", () => {
    expect(textLineBoxRect({ x: 4, y: 2, width: 120, height: 42 }, 2, 28)).toEqual({
      x: 4, y: 2, width: 120, height: 56,
    });
    expect(textLineBoxRect({ x: 4, y: 2, width: 120, height: 60 }, 2, 28)).toEqual({
      x: 4, y: 2, width: 120, height: 60,
    });
    expect(textLineBoxRect({ x: 4, y: 2, width: 120, height: 42 }, 2, 28, false).height).toBe(42);
  });

  it("rebuilds an anonymous text box after measured normal line-height replaces the provisional fallback", () => {
    const textLayer = {
      type: "text",
      rect: { x: 4, y: 2, width: 120, height: 48 },
      text: {
        content: "First wrapped line\nSecond wrapped line",
        lineCount: 2,
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 19.2,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    } as unknown as DesignNode;

    applyMeasuredTextLineHeight(textLayer, { x: 4, y: 2, width: 120, height: 40 }, 28);

    expect(textLayer.text?.lineHeight).toBe(28);
    expect(textLayer.text?.lineCount).toBe(2);
    expect(textLayer.rect.height).toBe(56);
  });

  it("groups Range fragments into measured visual line rectangles", () => {
    const element = {
      getBoundingClientRect: () => ({ left: 20, top: 30 }),
    } as unknown as Element;
    const range = {
      selectNodeContents: vi.fn(),
      getClientRects: () => [
        { left: 24, top: 34, width: 48, height: 16 },
        { left: 74, top: 35, width: 32, height: 15 },
        { left: 24, top: 58, width: 62, height: 16 },
      ],
    };
    const doc = {
      createRange: () => range,
      defaultView: { getComputedStyle: () => ({ fontSize: "16px" }) },
    } as unknown as Document;

    expect(textLineRectsForElement(element, doc)).toEqual([
      { x: 4, y: 4, width: 82, height: 16 },
      { x: 4, y: 28, width: 62, height: 16 },
    ]);
  });

  it("treats inherited and keyword line-height values as resolved line boxes", () => {
    // Computed styles normally resolve inherited declarations before capture;
    // this regression guard covers compatibility payloads that still expose
    // the inheritance keyword and ensures they do not become an arbitrary
    // 1.2em fallback when normalized at the boundary.
    expect(textLineHeight("inherit", 16)).toBe(19.2);
    expect(textLineHeight("unset", 20)).toBe(24);
    expect(textLineHeight("revert-layer", 24)).toBeCloseTo(28.8, 8);
  });

  it("walks an ancestor line-height when a compatibility capture keeps the keyword", () => {
    expect(resolvedTextLineHeight("inherit", 16, 16, "28px")).toBe(28);
    expect(resolvedTextLineHeight("unset", 16, 16, "1.5")).toBe(24);
    expect(resolvedTextLineHeight("normal", 16, 16, "28px")).toBeCloseTo(19.2, 8);
  });

  it("uses a resolved ancestor value when a compatibility capture keeps a custom-property token", () => {
    expect(resolvedTextLineHeight("var(--body-leading)", 16, 16, "28px")).toBe(28);
    expect(resolvedTextLineHeight("env(safe-area-inset-top)", 16, 16, "24px")).toBe(24);
  });

  it("resolves line-height custom properties before applying the fallback", () => {
    const style = {
      getPropertyValue: (name: string) => ({
        "--body-leading": "1.75",
        "--body-leading-px": "28px",
      }[name] ?? ""),
    } as unknown as CSSStyleDeclaration;
    expect(resolveLineHeightCustomProperties("var(--body-leading)", style)).toBe("1.75");
    expect(resolveLineHeightCustomProperties("var(--missing, 26px)", style)).toBe("26px");
    expect(resolveLineHeightCustomProperties("var(--body-leading-px)", style)).toBe("28px");
    expect(textLineHeight(resolveLineHeightCustomProperties("var(--body-leading)", style), 16)).toBe(28);
    expect(textLineHeight(resolveLineHeightCustomProperties("calc(var(--body-leading-px) + 2px)", style), 16)).toBe(30);
  });

  it("resolves multiplicative and divisive calc line-heights", () => {
    expect(textLineHeight("calc(1.5 * 1em)", 16)).toBe(24);
    expect(textLineHeight("calc(28px / 2)", 16)).toBe(14);
    expect(textLineHeight("calc(1.5 * 1em + 2px)", 16)).toBe(26);
    // Invalid dimensional multiplication must keep the normal fallback
    // instead of producing a misleading pixel value.
    expect(textLineHeight("calc(1em * 2px)", 16)).toBeCloseTo(19.2, 8);
  });

  it("resolves inherited percentage and em line-height against the declaring font size", () => {
    // CSS percentage/em line-height values become an absolute line box on the
    // declaring element before they are inherited. A child with a different
    // font size must not recompute 150%/1.5em from its own size.
    expect(resolvedTextLineHeight("inherit", 16, 16, "150%", 20)).toBe(30);
    expect(resolvedTextLineHeight("inherit", 16, 16, "1.5em", 20)).toBe(30);
    // Unitless values remain multipliers and intentionally use the child size.
    expect(resolvedTextLineHeight("inherit", 16, 16, "1.5", 20)).toBe(24);
  });

  it("finds inherited leading for direct text through its containing element", () => {
    const root = { parentElement: null } as unknown as Element;
    const wrapper = { parentElement: root } as unknown as Element;
    const styles = new Map<Element, CSSStyleDeclaration>([
      [root, { lineHeight: "28px", fontSize: "18px", getPropertyValue: () => "" } as unknown as CSSStyleDeclaration],
    ]);
    const inherited = inheritedLineHeightFromAncestors(wrapper, element => styles.get(element)!);
    expect(inherited).toEqual({
      value: "28px",
      fontSize: 18,
    });
    expect(resolvedTextLineHeight("inherit", 16, 16, inherited.value, inherited.fontSize)).toBe(28);
  });

  it("inherits generated-content font metrics when pseudo styles retain keywords", () => {
    expect(resolvedGeneratedTextMetrics(
      { fontSize: "inherit", lineHeight: "inherit" },
      { fontSize: "20px", lineHeight: "1.6" },
    )).toEqual({ fontSize: 20, lineHeight: 32 });
    expect(resolvedGeneratedTextMetrics(
      { fontSize: "unset", lineHeight: "28px" },
      { fontSize: "18px", lineHeight: "24px" },
    )).toEqual({ fontSize: 18, lineHeight: 28 });
  });

  it("keeps tokenized line-height on generated content", () => {
    const style = {
      fontSize: "16px",
      lineHeight: "var(--badge-leading)",
      getPropertyValue: (name: string) => name === "--badge-leading" ? "22px" : "",
    } as unknown as CSSStyleDeclaration;
    expect(resolvedGeneratedTextMetrics(style)).toMatchObject({ fontSize: 16, lineHeight: 22 });
  });

  it("uses the inherited and root line boxes for generated lh and rlh content", () => {
    expect(resolvedGeneratedTextMetrics(
      { fontSize: "16px", lineHeight: "1lh" },
      { fontSize: "20px", lineHeight: "28px" },
      16,
      32,
    )).toMatchObject({ fontSize: 16, lineHeight: 28 });
    expect(resolvedGeneratedTextMetrics(
      { fontSize: "16px", lineHeight: "1rlh" },
      { fontSize: "20px", lineHeight: "28px" },
      16,
      32,
    )).toMatchObject({ fontSize: 16, lineHeight: 32 });
  });

  it("inherits generated-content font family and spacing as a group", () => {
    expect(resolvedGeneratedTextStyle(
      {
        fontFamily: "inherit", fontSize: "inherit", fontWeight: "inherit", fontStyle: "inherit",
        letterSpacing: "inherit", wordSpacing: "inherit", lineHeight: "inherit",
      },
      {
        fontFamily: "Inter, sans-serif", fontSize: "18px", fontWeight: "600", fontStyle: "italic",
        letterSpacing: "0.5px", wordSpacing: "2px", lineHeight: "28px",
      },
    )).toMatchObject({
      fontFamily: "Inter, sans-serif",
      fontSize: 18,
      fontWeight: "600",
      fontStyle: "italic",
      letterSpacing: 0.5,
      wordSpacing: 2,
      lineHeight: 28,
    });
  });

  it("uses the median measured distance between visual lines", () => {
    expect(measuredLineHeightFromLineTops([10, 10.2, 29.2, 29.4, 48.5], 16)).toBe(19.2);
    expect(measuredLineHeightFromLineTops([10, 13, 29, 32], 16)).toBe(19);
    expect(measuredLineHeightFromLineTops([10], 16)).toBeUndefined();
  });

  it("measures a single-line normal line box only from an auto-height text element", () => {
    const element = {
      getBoundingClientRect: () => ({ height: 24 }),
    } as unknown as Element;
    const style = {
      display: "block",
      height: "auto",
      minHeight: "auto",
      maxHeight: "none",
      paddingTop: "2px",
      paddingBottom: "2px",
      borderTopWidth: "1px",
      borderBottomWidth: "1px",
    } as CSSStyleDeclaration;
    expect(measuredSingleLineLineHeight(element, style, 16)).toBe(18);
    expect(measuredSingleLineLineHeight(element, { ...style, height: "40px" }, 16)).toBeUndefined();
    expect(measuredSingleLineLineHeight(element, style, 16, 2)).toBeUndefined();
    expect(measuredSingleLineLineHeight(element, { ...style, height: "24px" }, 16, 1, {
      height: "",
      minHeight: "",
      maxHeight: "",
    })).toBe(18);
    expect(measuredSingleLineLineHeight(element, style, 16, 1, {
      height: "40px",
      minHeight: "",
      maxHeight: "",
    })).toBeUndefined();
    expect(measuredSingleLineLineHeight(element, { ...style, display: "grid" }, 16, 1, {
      height: "",
      minHeight: "",
      maxHeight: "",
    })).toBe(18);
    expect(measuredSingleLineLineHeight(element, style, 16, 1, {
      height: "unset",
      minHeight: "initial",
      maxHeight: "revert",
    })).toBe(18);
    expect(measuredSingleLineLineHeight(element, style, 16, 1, {
      height: "",
      minHeight: "min-content",
      maxHeight: "fit-content",
    })).toBe(18);
    expect(measuredSingleLineLineHeight(element, style, 16, 1, {
      height: "120px",
      minHeight: "",
      maxHeight: "",
    })).toBeUndefined();
    expect(measuredSingleLineLineHeight(element, { ...style, display: "inline-table" }, 16, 1, {
      height: "",
      minHeight: "",
      maxHeight: "",
    })).toBe(18);
  });

  it("recovers a first-line indent from multi-line glyph positions", () => {
    expect(measuredTextIndentFromRects([
      { top: 10, left: 84 },
      { top: 10.4, left: 96 },
      { top: 34, left: 20 },
      { top: 34.3, left: 31 },
    ], 3.2)).toBe(64);
    expect(measuredTextIndentFromRects([
      { top: 10, left: 20 },
      { top: 34, left: 20.3 },
    ], 3.2)).toBeUndefined();
  });

  it("keeps inherited pixel line-height on the captured text box", () => {
    const style = document.createElement("div").style;
    style.fontSize = "16px";
    style.lineHeight = "28px";
    expect(resolvedTextLineHeight(style.lineHeight, 16, 16)).toBe(28);
  });

  it("resolves line-height from a non-enumerable CSS property channel", () => {
    const style = {
      fontSize: "16px",
      lineHeight: "",
      getPropertyValue: (property: string) => property === "line-height" ? "28px" : "",
    } as Pick<CSSStyleDeclaration, "fontSize" | "lineHeight" | "getPropertyValue">;
    expect(resolvedGeneratedTextMetrics(style)).toMatchObject({ fontSize: 16, lineHeight: 28 });
  });

  it("resolves inherited relative line-height using a non-enumerable parent font size", () => {
    const style = {
      fontSize: "16px",
      lineHeight: "inherit",
      getPropertyValue: (property: string) => property === "line-height" ? "inherit" : "",
    } as Pick<CSSStyleDeclaration, "fontSize" | "lineHeight" | "getPropertyValue">;
    const inheritedStyle = {
      fontSize: "",
      lineHeight: "",
      getPropertyValue: (property: string) => property === "font-size"
        ? "20px"
        : property === "line-height" ? "1.5em" : "",
    } as Pick<CSSStyleDeclaration, "fontSize" | "lineHeight" | "getPropertyValue">;
    expect(resolvedGeneratedTextMetrics(style, inheritedStyle)).toMatchObject({ fontSize: 16, lineHeight: 30 });
  });

  it("promotes wrapped anonymous text line fragments to the captured line count", () => {
    const textLayer: DesignNode = {
      id: "wrapped-anonymous-text",
      type: "text",
      rect: { x: 0, y: 0, width: 180, height: 34 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "A long run that wraps",
        lineCount: 1,
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    };
    applyMeasuredTextLineRects(textLayer, [
      { x: 0, y: 0, width: 150, height: 18 },
      { x: 0, y: 24, width: 60, height: 18 },
    ]);
    expect(textLayer.text?.lineCount).toBe(2);
    expect(textLayer.rect.height).toBe(48);
    expect(textLayer.textLineRects).toHaveLength(2);
  });

  it("retains non-default text-wrap-style from the computed CSS channel", () => {
    const style = document.createElement("div").style;
    style.setProperty("text-wrap-style", "pretty");
    expect(computedStyleMap(style)).toMatchObject({ textWrapStyle: "pretty" });
  });

  it("ignores Chrome's block-container bidi isolate unless the page authors it", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const uaStyle = { unicodeBidi: "isolate" } as CSSStyleDeclaration;

    expect(capturedUnicodeBidi(uaStyle, element)).toBe("normal");

    element.style.unicodeBidi = "isolate";
    expect(capturedUnicodeBidi(getComputedStyle(element), element)).toBe("isolate");

    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".explicit-bidi { unicode-bidi: isolate; }";
    document.head.append(stylesheet);
    element.style.unicodeBidi = "";
    element.className = "explicit-bidi";
    expect(capturedUnicodeBidi(getComputedStyle(element), element)).toBe("isolate");

    const bdi = document.createElement("bdi");
    expect(capturedUnicodeBidi(uaStyle, bdi)).toBe("isolate");
  });

  it("treats repeated scroll attachments as the default for layered backgrounds", () => {
    expect(hasNonDefaultBackgroundAttachment("scroll")).toBe(false);
    expect(hasNonDefaultBackgroundAttachment("scroll, scroll")).toBe(false);
    expect(hasNonDefaultBackgroundAttachment("scroll, fixed")).toBe(true);
    expect(hasNonDefaultBackgroundAttachment("local, scroll")).toBe(true);

    const style = document.createElement("div").style;
    style.setProperty("background-attachment", "scroll, scroll");
    expect(computedStyleMap(style)).not.toHaveProperty("backgroundAttachment");
  });

  it("keeps inherited line-height from a non-enumerable compatibility style", () => {
    const style = document.createElement("div").style;
    style.setProperty("line-height", "28px");
    style.setProperty("outline-width", "2px");
    style.setProperty("outline-style", "solid");
    style.setProperty("outline-color", "rgb(12, 34, 56)");
    style.setProperty("outline-offset", "3px");
    // Simulate a trimmed bridge that exposes getPropertyValue() but no
    // enumerable CSS declarations. The explicit compatibility reads must
    // still preserve the wrapper's inherited leading and outline paint.
    Object.defineProperty(style, "length", { configurable: true, value: 0 });
    expect(computedStyleMap(style)).toMatchObject({
      lineHeight: "28px",
      outlineWidth: "2px",
      outlineStyle: "solid",
      outlineColor: "rgb(12, 34, 56)",
      outlineOffset: "3px",
    });
  });

  it("retains non-enumerable logical position insets from a compatibility style", () => {
    const style = document.createElement("div").style;
    style.setProperty("inset-inline-start", "12px");
    style.setProperty("inset-block-end", "8px");
    Object.defineProperty(style, "length", { configurable: true, value: 0 });
    expect(computedStyleMap(style)).toMatchObject({
      insetInlineStart: "12px",
      insetBlockEnd: "8px",
    });
  });

  it("retains non-enumerable physical positioning values from a compatibility style", () => {
    const style = document.createElement("div").style;
    style.setProperty("position", "absolute");
    style.setProperty("left", "24px");
    style.setProperty("top", "16px");
    style.setProperty("direction", "rtl");
    Object.defineProperty(style, "length", { configurable: true, value: 0 });
    expect(computedStyleMap(style)).toMatchObject({
      position: "absolute",
      left: "24px",
      top: "16px",
      direction: "rtl",
    });
  });

  it("retains non-enumerable Auto Layout fields from a compatibility style", () => {
    const style = document.createElement("div").style;
    style.setProperty("display", "flex");
    style.setProperty("gap", "12px");
    style.setProperty("flex-direction", "column");
    style.setProperty("align-items", "center");
    style.setProperty("justify-content", "space-between");
    Object.defineProperty(style, "length", { configurable: true, value: 0 });
    expect(computedStyleMap(style)).toMatchObject({
      display: "flex",
      gap: "12px",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "space-between",
    });
  });

  it("retains font-synthesis policy and keeps differing inline runs separate", () => {
    const style = document.createElement("div").style;
    style.setProperty("font-synthesis", "none");
    style.setProperty("font-synthesis-weight", "none");
    expect(computedStyleMap(style)).toMatchObject({
      fontSynthesis: "none",
      fontSynthesisWeight: "none",
    });

    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.textContent = "base";
    child.textContent = "synthetic";
    parent.append(child);
    parent.style.fontSynthesis = "auto";
    child.style.fontSynthesis = "none";
    document.body.append(parent);
    expect(hasDistinctInlineTextStyle(parent, getComputedStyle(parent), document)).toBe(true);
  });

  it("ignores Chromium's expanded default font-synthesis shorthand", () => {
    const style = document.createElement("div").style;
    style.setProperty("font-synthesis", "weight style small-caps");
    expect(computedStyleMap(style)).not.toHaveProperty("fontSynthesis");

    style.setProperty("font-synthesis", "none");
    expect(computedStyleMap(style)).toMatchObject({ fontSynthesis: "none" });
  });

  it("retains last-line alignment and justification method", () => {
    const style = document.createElement("div").style;
    style.setProperty("text-align-last", "center");
    style.setProperty("text-justify", "inter-character");
    expect(computedStyleMap(style)).toMatchObject({
      textAlignLast: "center",
      textJustify: "inter-character",
    });

    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.textContent = "first";
    child.textContent = "last";
    parent.append(child);
    parent.style.setProperty("text-align-last", "auto");
    child.style.setProperty("text-align-last", "center");
    document.body.append(parent);
    expect(hasDistinctInlineTextStyle(parent, getComputedStyle(parent), document)).toBe(true);
  });

  it("retains logical overflow clip margins from the computed CSS channel", () => {
    const style = document.createElement("div").style;
    style.setProperty("overflow-clip-margin-block-start", "8px");
    style.setProperty("overflow-clip-margin-inline-end", "12px");
    expect(computedStyleMap(style)).toMatchObject({
      overflowClipMarginBlockStart: "8px",
      overflowClipMarginInlineEnd: "12px",
    });
  });

  it("retains non-default logical position insets from the computed CSS channel", () => {
    const style = document.createElement("div").style;
    style.setProperty("inset-inline-start", "12px");
    style.setProperty("inset-block-end", "8px");
    expect(computedStyleMap(style)).toMatchObject({
      insetInlineStart: "12px",
      insetBlockEnd: "8px",
    });
  });

  it("resolves editable text fill and stroke paint from webkit text styles", () => {
    const values = new Map([
      ["-webkit-text-fill-color", "transparent"],
      ["-webkit-text-stroke-width", "2px"],
      ["-webkit-text-stroke-color", "rgb(255, 80, 40)"],
    ]);
    const style = {
      color: "rgb(20, 40, 60)",
      backgroundColor: "rgb(10, 120, 220)",
      getPropertyValue: (property: string) => values.get(property) || "",
    } as Pick<CSSStyleDeclaration, "color" | "backgroundColor" | "getPropertyValue">;
    expect(textPaintFor(style, false)).toEqual({
      fillColor: "transparent",
      textFillColor: "transparent",
      strokeWidth: 2,
      strokeColor: "rgb(255, 80, 40)",
    });
    expect(textPaintFor(style, true).fillColor).toBe("rgb(10, 120, 220)");
  });

  it("normalizes CSS individual transform properties into the shared transform channel", () => {
    expect(effectiveTransform({ transform: "none", translate: "10px 20px", rotate: "15deg", scale: "1.25" })).toBe("translate(10px 20px) rotate(15deg) scale(1.25)");
    expect(effectiveTransform({ transform: "translate(2px, 3px)", translate: "10px", rotate: "none", scale: "none" })).toBe("translate(2px, 3px)");
    expect(effectiveTransform({ transform: "none", translate: "none", rotate: "none", scale: "none" })).toBe("none");
  });

  it("keeps CSS padding as a text container inset instead of a TextNode width", () => {
    expect(hasTextBoxInsets({ paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px" })).toBe(false);
    expect(hasTextBoxInsets({ paddingTop: "8px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px" })).toBe(true);
  });

  it("recognizes display contents as a structural wrapper without a CSS box", () => {
    expect(isDisplayContents({ display: "contents" })).toBe(true);
    expect(isDisplayContents({ display: "block" })).toBe(false);
  });

  it("captures visible form-control values without exporting password plaintext", () => {
    const input = document.createElement("input");
    input.value = "Search term";
    expect(formControlTextValue(input)).toEqual({ text: "Search term", placeholder: false });
    input.type = "password";
    input.value = "secret";
    expect(formControlTextValue(input)).toEqual({ text: "••••••", placeholder: false });
    input.type = "text";
    input.value = "";
    input.placeholder = "Search";
    expect(formControlTextValue(input)).toEqual({ text: "Search", placeholder: true });
  });

  it("does not recurse into native select options as duplicate layers", () => {
    const select = document.createElement("select");
    select.innerHTML = '<option value="a">Alpha</option><option value="b" selected>Beta</option>';
    expect(formControlTextValue(select)).toEqual({ text: "Beta", placeholder: false });
    expect(formControlChildElements(select)).toEqual([]);
  });

  it("uses a textarea's live value instead of its default text node", () => {
    const textarea = document.createElement("textarea");
    textarea.defaultValue = "Initial value";
    textarea.value = "Edited value";
    expect(formControlTextValue(textarea)).toEqual({ text: "Edited value", placeholder: false });
    textarea.value = "";
    textarea.placeholder = "Write a note";
    expect(formControlTextValue(textarea)).toEqual({ text: "Write a note", placeholder: true });
  });

  it("resolves common editable list markers without custom images", () => {
    expect(listMarkerText({ listStyleType: "disc", listStylePosition: "outside", listStyleImage: "none" }, 1)).toBe("•");
    expect(listMarkerText({ listStyleType: "decimal", listStylePosition: "outside", listStyleImage: "none" }, 12)).toBe("12.");
    expect(listMarkerText({ listStyleType: "upper-alpha", listStylePosition: "outside", listStyleImage: "none" }, 27)).toBe("AA.");
    expect(listMarkerText({ listStyleType: "lower-roman", listStylePosition: "outside", listStyleImage: "none" }, 9)).toBe("ix.");
    expect(listMarkerText({ listStyleType: "disc", listStylePosition: "inside", listStyleImage: "none" }, 1)).toBe("•");
    expect(listMarkerText({ listStyleType: "none", listStylePosition: "outside", listStyleImage: "none" }, 1)).toBeNull();
    expect(listMarkerImageSource({ listStyleImage: 'url("marker.png")' })).toBe("marker.png");
    expect(listMarkerImageSource({ listStyleImage: "none" })).toBeNull();
  });

  it("preserves ordered-list start, reversed, and li value semantics", () => {
    const ordered = document.createElement("ol");
    ordered.start = 4;
    const first = document.createElement("li");
    const second = document.createElement("li");
    ordered.append(first, second);
    expect(listItemOrdinal(first, [first, second])).toBe(4);
    expect(listItemOrdinal(second, [first, second])).toBe(5);

    ordered.reversed = true;
    expect(listItemOrdinal(first, [first, second])).toBe(4);
    expect(listItemOrdinal(second, [first, second])).toBe(3);
    second.value = 9;
    expect(listItemOrdinal(second, [first, second])).toBe(9);
  });

  it("maps table rows and border spacing to editable Auto Layout axes", () => {
    const table = document.createElement("table");
    table.style.borderSpacing = "6px 10px";
    const body = document.createElement("tbody");
    const row = document.createElement("tr");
    table.append(body);
    body.append(row);
    document.body.append(table);
    const tableLayout = layoutFor(getComputedStyle(table), { element: table, rect: { width: 320, height: 120 } as DOMRect });
    const bodyLayout = layoutFor(getComputedStyle(body), { element: body, rect: { width: 308, height: 100 } as DOMRect });
    const rowLayout = layoutFor(getComputedStyle(row), { element: row, rect: { width: 308, height: 32 } as DOMRect });
    expect(tableLayout.mode).toBe("vertical");
    expect(tableLayout.padding).toEqual([10, 6, 10, 6]);
    expect(bodyLayout.mode).toBe("vertical");
    expect(bodyLayout.rowGap).toBe(0);
    expect(rowLayout.mode).toBe("horizontal");
    expect(rowLayout.columnGap).toBe(6);
  });

  it("does not invent table spacing when borders collapse", () => {
    const table = document.createElement("table");
    table.style.borderCollapse = "collapse";
    table.style.borderSpacing = "12px 14px";
    const body = document.createElement("tbody");
    const row = document.createElement("tr");
    table.append(body);
    body.append(row);
    document.body.append(table);
    const tableLayout = layoutFor(getComputedStyle(table), { element: table, rect: { width: 320, height: 120 } as DOMRect });
    const rowLayout = layoutFor(getComputedStyle(row), { element: row, rect: { width: 320, height: 32 } as DOMRect });
    expect(tableLayout.padding).toEqual([0, 0, 0, 0]);
    expect(rowLayout.columnGap).toBe(0);
  });

  it("locks only table cells that span multiple tracks", () => {
    const cell = document.createElement("td");
    expect(tableCellNeedsGeometryLock(cell)).toBe(false);
    cell.colSpan = 2;
    expect(tableCellNeedsGeometryLock(cell)).toBe(true);
    cell.colSpan = 1;
    cell.rowSpan = 2;
    expect(tableCellNeedsGeometryLock(cell)).toBe(true);
    expect(tableCellNeedsGeometryLock(document.createElement("div"))).toBe(false);
  });

  it("recognizes bottom table captions for source-order correction", () => {
    expect(tableCaptionIsBottom({ captionSide: "bottom" })).toBe(true);
    expect(tableCaptionIsBottom({ captionSide: "top" })).toBe(false);
  });

  it("resolves attr() in generated pseudo content", () => {
    const badge = document.createElement("span");
    badge.setAttribute("data-label", "New");
    expect(pseudoContentValue('attr(data-label)', badge)).toBe("New");
    expect(pseudoContentValue('"Status: " attr(data-label)', badge)).toBe("Status:  New");
    expect(pseudoContentValue('attr(missing, "Fallback")', badge)).toBe("Fallback");
  });

  it("places single-line control text inside border and padding", () => {
    expect(formControlTextRect({ width: 240, height: 44 }, {
      borderTopWidth: "1px", borderRightWidth: "1px", borderBottomWidth: "1px", borderLeftWidth: "1px",
      paddingTop: "8px", paddingRight: "12px", paddingBottom: "8px", paddingLeft: "12px",
      lineHeight: "20px", fontSize: "14px",
    })).toEqual({ x: 13, y: 12, width: 214, height: 20 });
  });

  it("resolves logical text alignment against direction", () => {
    expect(textAlignValue({ textAlign: "start", direction: "ltr" })).toBe("left");
    expect(textAlignValue({ textAlign: "start", direction: "rtl" })).toBe("right");
    expect(textAlignValue({ textAlign: "end", direction: "ltr" })).toBe("right");
    expect(textAlignValue({ textAlign: "end", direction: "rtl" })).toBe("left");
    expect(textAlignValue({ textAlign: "justify", direction: "rtl" })).toBe("justified");
  });

  it("keeps hidden and collapsed nodes for their CSS layout slot", () => {
    expect(isLayoutCapturable({ display: "block", visibility: "visible" })).toBe(true);
    expect(isLayoutCapturable({ display: "none", visibility: "visible" })).toBe(false);
    expect(isLayoutCapturable({ display: "block", visibility: "hidden" })).toBe(true);
    expect(isLayoutCapturable({ display: "table-row", visibility: "collapse" })).toBe(true);
  });

  it("flags non-affine transforms while accepting the 2D matrix3d subset", () => {
    expect(unsupportedTransformFunctions("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 18, 0, 1)")).toEqual([]);
    expect(unsupportedTransformFunctions("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0.25, 1)")).toEqual(["matrix3d"]);
    expect(unsupportedTransformFunctions("rotateX(20deg)")).toEqual(["rotatex"]);
    expect(unsupportedTransformFunctions("rotate3d(1, 0, 0, 20deg)")).toEqual(["rotate3d"]);
    expect(unsupportedTransformFunctions("translateZ(8px)")).toEqual(["translatez"]);
    expect(unsupportedTransformFunctions("translate3d(4px, 0, 8px)")).toEqual(["translate3d"]);
    expect(unsupportedTransformFunctions("scale3d(1, 1, 0.8)")).toEqual(["scale3d"]);
  });

  it("recognizes both standard and WebKit text background clipping", () => {
    const style = document.createElement("div").style;
    style.backgroundClip = "text";
    expect(isTextBackgroundClip(style)).toBe(true);
    style.backgroundClip = "border-box";
    Object.defineProperty(style, "webkitBackgroundClip", { configurable: true, value: "text" });
    expect(isTextBackgroundClip(style)).toBe(true);
  });

  it("resolves currentColor in captured shadows", () => {
    expect(shadowFromStyle("2px 3px 4px currentColor", "rgb(12, 34, 56)")).toMatchObject({
      color: "rgb(12, 34, 56)",
      offsetX: 2,
      offsetY: 3,
    });
  });

  it("preserves measured line breaks for multilingual text", () => {
    const element = document.createElement("h1");
    element.textContent = "你好世界";
    document.body.append(element);

    let startOffset = 0;
    const range = {
      setStart: (_node: Node, offset: number) => { startOffset = offset; },
      setEnd: () => undefined,
      getBoundingClientRect: () => ({ top: startOffset >= 2 ? 20 : 0 }),
    } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);

    expect(renderedTextContent(element, document)).toBe("你好\n世界");
  });

  it("preserves explicit and consecutive br elements as editable line breaks", () => {
    const element = document.createElement("div");
    element.style.fontSize = "16px";
    element.append(document.createTextNode("First"));
    element.append(document.createElement("br"));
    element.append(document.createTextNode("Second"));
    element.append(document.createElement("br"));
    element.append(document.createElement("br"));
    element.append(document.createTextNode("Fourth"));
    document.body.append(element);

    const range = {
      setStart: () => undefined,
      setEnd: () => undefined,
      getBoundingClientRect: () => ({ top: 0, width: 8, height: 16 }),
    } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);

    expect(renderedTextContent(element, document)).toBe("First\nSecond\n\nFourth");
  });

  it("preserves measured line breaks for direct text runs in mixed content", () => {
    const element = document.createElement("div");
    const textNode = document.createTextNode("Good to know");
    element.append(textNode);
    document.body.append(element);

    let startOffset = 0;
    const range = {
      setStart: (_node: Node, offset: number) => { startOffset = offset; },
      setEnd: () => undefined,
      getBoundingClientRect: () => ({ top: startOffset >= 7 ? 20 : 0 }),
    } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);

    expect(renderedTextNodeContent(textNode, document)).toBe("Good to\nknow");
  });

  it("does not turn small inline glyph-top differences into extra lines", () => {
    const element = document.createElement("div");
    element.style.fontSize = "16px";
    const textNode = document.createTextNode("ABCD");
    element.append(textNode);
    document.body.append(element);

    let startOffset = 0;
    const range = {
      setStart: (_node: Node, offset: number) => { startOffset = offset; },
      setEnd: () => undefined,
      getBoundingClientRect: () => ({ top: startOffset % 2 === 0 ? 0 : 1.2 }),
    } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);

    // Regular/bold or mixed-script runs can differ by roughly a pixel while
    // still belonging to one CSS line box. That metric noise must not become
    // an authored newline in the Figma payload.
    expect(renderedTextNodeContent(textNode, document)).toBe("ABCD");
  });

  it("keeps genuine wrapped lines when the line-top delta exceeds glyph tolerance", () => {
    const element = document.createElement("div");
    element.style.fontSize = "16px";
    const textNode = document.createTextNode("ABCD");
    element.append(textNode);
    document.body.append(element);

    let startOffset = 0;
    const range = {
      setStart: (_node: Node, offset: number) => { startOffset = offset; },
      setEnd: () => undefined,
      getBoundingClientRect: () => ({ top: startOffset < 2 ? 0 : 20 }),
    } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);

    expect(renderedTextNodeContent(textNode, document)).toBe("AB\nCD");
  });

  it("preserves boundary spaces in inline text runs", () => {
    const element = document.createElement("div");
    const textNode = document.createTextNode("Hello ");
    element.append(textNode);
    document.body.append(element);

    const range = {
      setStart: () => undefined,
      setEnd: () => undefined,
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);

    expect(renderedTextNodeContent(textNode, document)).toBe("Hello ");
  });

  it("preserves authored whitespace for pre and pre-wrap text", () => {
    const pre = document.createElement("pre");
    pre.style.whiteSpace = "pre-wrap";
    const textNode = document.createTextNode("  A\t B\n  C  ");
    pre.append(textNode);
    document.body.append(pre);
    const range = {
      setStart: () => undefined,
      setEnd: () => undefined,
      getBoundingClientRect: () => ({ top: 0 }),
    } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);

    expect(renderedTextNodeContent(textNode, document)).toBe("  A\t B\n  C  ");
  });

  it("honors CSS Text Level 4 whitespace-collapse modes before Figma export", () => {
    expect(normalizeRenderedText("  A\t  B\n  C  ", "normal", "preserve")).toBe("  A\t  B\n  C  ");
    expect(normalizeRenderedText("  A\t  B\n  C  ", "normal", "preserve-breaks")).toBe(" A B\n C ");
    expect(normalizeRenderedText("  A\t  B\n  C  ", "normal", "collapse")).toBe(" A B\nC ");
  });

  it("uses Range geometry for adjacent inline style runs", () => {
    const parent = document.createElement("div");
    const bold = document.createElement("b");
    bold.textContent = "Parking is available";
    parent.append(bold);
    document.body.append(parent);
    bold.style.display = "inline";
    const range = {
      selectNodeContents: () => undefined,
      getBoundingClientRect: () => ({ left: 24, top: 18, width: 128, height: 16 }),
    } as unknown as Range;
    vi.spyOn(document, "createRange").mockReturnValue(range);

    expect(inlineTextRect(bold, { left: 10, top: 10 } as DOMRect, document)).toEqual({
      x: 14,
      y: 8,
      width: 128,
      height: 16,
    });
  });

  it("does not merge inline runs when a wrapping or direction property differs", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.textContent = "base";
    child.textContent = "wrapped";
    parent.append(child);
    parent.style.wordBreak = "normal";
    parent.style.direction = "ltr";
    child.style.wordBreak = "break-all";
    child.style.direction = "rtl";
    document.body.append(parent);

    expect(hasDistinctInlineTextStyle(parent, getComputedStyle(parent), document)).toBe(true);
  });

  it("does not merge inline runs when text paint or shaping differs", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.textContent = "base";
    child.textContent = "shadowed";
    parent.append(child);
    parent.style.textShadow = "none";
    parent.style.fontOpticalSizing = "auto";
    child.style.textShadow = "0 2px 4px rgba(0,0,0,.25)";
    child.style.fontOpticalSizing = "none";
    document.body.append(parent);

    expect(hasDistinctInlineTextStyle(parent, getComputedStyle(parent), document)).toBe(true);
  });

  it("does not merge inline runs when decoration geometry differs", () => {
    const parent = document.createElement("div");
    const child = document.createElement("span");
    parent.textContent = "base";
    child.textContent = "offset";
    parent.append(child);
    parent.style.textDecorationLine = "underline";
    parent.style.textDecorationThickness = "1px";
    parent.style.textUnderlineOffset = "2px";
    child.style.textDecorationLine = "underline";
    child.style.textDecorationThickness = "3px";
    child.style.textUnderlineOffset = "6px";
    document.body.append(parent);

    expect(hasDistinctInlineTextStyle(parent, getComputedStyle(parent), document)).toBe(true);
  });

  it("preserves authored layout CSS while removing active capture content", () => {
    const source = `<!doctype html><html><head>
      <style>.page { color: red; }</style>
      <style>/* Figma Auto Layout compatibility */ body { display: flex; }</style>
    </head><body><main class="page">Hello</main><script>window.bad = true</script></body></html>`;

    const sanitized = sanitizeSource(source);
    expect(sanitized).toContain(".page { color: red; }");
    expect(sanitized).toContain("Figma Auto Layout compatibility");
    expect(sanitized).toContain("body { display: flex; }");
    expect(sanitized).not.toContain("window.bad");
  });

  it("serializes repeating CSS gradients as a finite SVG pattern", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(35deg, transparent 45%, rgba(86,140,138,.22) 46%, rgba(86,140,138,.22) 48%, transparent 49%), repeating-linear-gradient(90deg, transparent 0px, transparent 38px, rgba(255,255,255,.65) 39px, rgba(255,255,255,.65) 40px)",
      "rgb(232, 241, 240)",
      341,
      180,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain("<pattern");
    expect(svg).not.toContain("NaN");
  });

  it("serializes a single repeating gradient instead of dropping its cycle", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "repeating-linear-gradient(90deg, transparent 0px, transparent 38px, rgba(255,255,255,.65) 39px, rgba(255,255,255,.65) 40px)",
      "rgb(232, 241, 240)",
      341,
      180,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain("<pattern");
    expect(svg).not.toContain("NaN");
  });

  it("uses the distance between pixel stops as a repeating gradient cycle", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "repeating-linear-gradient(90deg, #000 10px, #fff 30px)",
      "transparent",
      200,
      100,
    );
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain('<pattern id="gradient-0" patternUnits="userSpaceOnUse" width="20" height="100">');
  });

  it("serializes ordinary linear and radial gradients with explicit sRGB interpolation", () => {
    const linear = backgroundSvgDataUrl(
      "linear-gradient(135deg, #3a001a, #6e2647)",
      "rgba(0, 0, 0, 0)",
      341,
      173,
    );
    const radial = backgroundSvgDataUrl(
      "radial-gradient(circle at 25% 40%, rgba(255, 255, 255, .4), transparent 70%)",
      "#182832",
      200,
      100,
    );
    expect(atob(linear!.split(",", 2)[1])).toContain('color-interpolation="sRGB"');
    expect(atob(linear!.split(",", 2)[1]).match(/<stop /g)?.length).toBeGreaterThan(2);
    expect(atob(radial!.split(",", 2)[1])).toContain('<radialGradient id="gradient-0" color-interpolation="sRGB" gradientUnits="userSpaceOnUse"');
    expect(atob(radial!.split(",", 2)[1])).toContain('cx="50" cy="40"');
  });

  it("resolves pixel centers for radial and conic gradient SVG fallbacks", () => {
    const radial = backgroundSvgDataUrl(
      "radial-gradient(circle at 20px 30px, #fff, transparent)",
      "#182832",
      200,
      100,
    );
    const radialSvg = atob(radial!.split(",", 2)[1]);
    expect(radialSvg).toContain('cx="20" cy="30"');

    const edgeOffset = backgroundSvgDataUrl(
      "radial-gradient(circle at right 20px bottom 10px, #fff, transparent)",
      "#182832",
      200,
      100,
    );
    expect(atob(edgeOffset!.split(",", 2)[1])).toContain('cx="180" cy="90"');

    const centeredAxis = backgroundSvgDataUrl(
      "radial-gradient(circle at 20px center, #fff, transparent)",
      "#182832",
      200,
      100,
    );
    expect(atob(centeredAxis!.split(",", 2)[1])).toContain('cx="20" cy="50"');

    const calculated = backgroundSvgDataUrl(
      "radial-gradient(circle at calc(50% - 10px) calc(50% + 5px), #fff, transparent)",
      "#182832",
      200,
      100,
    );
    expect(atob(calculated!.split(",", 2)[1])).toContain('cx="90" cy="55.00000000000001"');

    const outside = backgroundSvgDataUrl(
      "radial-gradient(circle closest-side at -10% 120%, #fff, transparent)",
      "#182832",
      200,
      100,
    );
    const outsideSvg = atob(outside!.split(",", 2)[1]);
    expect(outsideSvg).toContain('cx="-20" cy="120"');
    expect(Number(outsideSvg.match(/\sr="([^"]+)"/)?.[1])).toBeCloseTo(20, 8);

    const conic = backgroundSvgDataUrl(
      "conic-gradient(from 45deg at 20px 30px, #f00 0deg, #00f 360deg)",
      "transparent",
      200,
      100,
    );
    const conicSvg = atob(conic!.split(",", 2)[1]);
    expect(conicSvg).toContain("M 20 30");
  });

  it("normalizes CSS angle units in captured SVG gradient fallbacks", () => {
    const svg = (angle: string) => atob(backgroundSvgDataUrl(
      `linear-gradient(${angle}, #ff0000, #0000ff)`,
      "transparent",
      200,
      100,
    )!.split(",", 2)[1]);
    const degrees = svg("90deg");

    expect(svg(".25turn")).toBe(degrees);
    expect(svg("100grad")).toBe(degrees);
    expect(svg("1.5707963267948966rad")).toBe(degrees);
  });

  it("serializes conic gradients as centered vector sectors", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "conic-gradient(from 45deg at 25% 60%, #ff0000 0deg, #00ff00 120deg, #0000ff 240deg, #ff0000 360deg)",
      "transparent",
      160,
      100,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).not.toContain("conic-gradient");
    expect(svg.match(/<path /g)?.length).toBe(180);
    expect(svg).toContain("40 60");
  });

  it("serializes repeating conic gradients with a wrapped stop cycle", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "repeating-conic-gradient(from 30deg at 50% 50%, #ff0000 0deg, #00ff00 90deg, #0000ff 180deg)",
      "transparent",
      160,
      100,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).not.toContain("repeating-conic-gradient");
    expect(svg.match(/<path /g)?.length).toBe(180);
    expect(svg).toContain("80 50");
  });

  it("serializes CSS Color 4 gradient stops into SVG colors", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(90deg, color-mix(in srgb, red 25%, blue), oklch(60% 0.2 40))",
      "transparent",
      200,
      100,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain("<stop ");
    expect(svg).not.toContain("NaN");
  });

  it("serializes color() sRGB and display-p3 stops into SVG colors", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(90deg, color(srgb 1 0 0 / 50%), color(display-p3 0 1 0))",
      "transparent",
      200,
      100,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain('stop-color="#ff0000"');
    expect(svg).toContain('stop-opacity="0.5"');
    expect(svg).not.toContain("color(display-p3");
    expect(svg).not.toContain("NaN");
  });

  it("serializes hwb gradient stops into SVG colors", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(90deg, hwb(0 20% 10% / 75%), hwb(120 10% 20%))",
      "transparent",
      200,
      100,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain('stop-color="#e63333"');
    expect(svg).toContain('stop-opacity="0.75"');
    expect(svg).not.toContain("hwb(");
    expect(svg).not.toContain("NaN");
  });

  it("serializes lab and lch gradient stops into SVG colors", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(90deg, lab(54.2917% 80.8125 69.8851), lch(54.2917% 104.55 40.85 / 60%))",
      "transparent",
      200,
      100,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain("<stop ");
    expect(svg).toContain('stop-opacity="0.6"');
    expect(svg).not.toContain("lab(");
    expect(svg).not.toContain("lch(");
    expect(svg).not.toContain("NaN");
  });

  it("resolves the full plugin named-color set inside color-mix stops", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(90deg, color-mix(in srgb, lime 30%, navy), color-mix(in srgb, aqua, maroon 20%))",
      "transparent",
      200,
      100,
    );
    expect(svgDataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain("<stop ");
    expect(svg).not.toContain("color-mix");
    expect(svg).not.toContain("NaN");
  });

  it("resolves non-repeating linear gradient pixel stops against the gradient line", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(90deg, #ff0000 20px, #0000ff 80px)",
      "transparent",
      200,
      100,
    );
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain('offset="10%"');
    expect(svg).toContain('offset="40%"');
  });

  it("accepts CSS's unitless zero as a gradient stop position", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "linear-gradient(90deg, transparent 0, #ffffff 20px)",
      "transparent",
      200,
      100,
    );
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain('offset="0%"');
    expect(svg).toContain('offset="10%"');
  });

  it("uses CSS radial-gradient size keywords instead of a fixed radius", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "radial-gradient(circle closest-side at 25% 40%, #fff, transparent)",
      "#182832",
      200,
      100,
    );
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain('cx="50" cy="40"');
    expect(svg).toContain('r="40"');
  });

  it("retains repeat spread for diagonal repeating gradients", () => {
    const svgDataUrl = backgroundSvgDataUrl(
      "repeating-linear-gradient(35deg, #000 0%, #fff 20%)",
      "transparent",
      200,
      100,
    );
    const svg = atob(svgDataUrl!.split(",", 2)[1]);
    expect(svg).toContain('spreadMethod="repeat"');
  });

  it("retains border-image gradients in the shared stroke model", () => {
    const style = {
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: "rgba(0, 0, 0, 0)",
      borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
    } as unknown as CSSStyleDeclaration;
    expect(borderFor(style, "Top")).toMatchObject({
      width: 2,
      gradient: "linear-gradient(90deg, #ff0000, #0000ff)",
    });
  });

  it("retains conic border-image gradients in the shared stroke model", () => {
    const style = {
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: "rgba(0, 0, 0, 0)",
      borderImageSource: "conic-gradient(from 45deg, #ff0000, #0000ff)",
    } as unknown as CSSStyleDeclaration;
    expect(borderFor(style, "Top")).toMatchObject({
      width: 2,
      gradient: "conic-gradient(from 45deg, #ff0000, #0000ff)",
    });
  });

  it("retains border-image URL sources and their paint geometry", () => {
    const style = {
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: "transparent",
      borderImageSource: 'url("https://example.com/frame.png")',
      borderImageSlice: "24",
      borderImageRepeat: "round",
      borderImageWidth: "3",
      borderImageOutset: "1px",
    } as unknown as CSSStyleDeclaration;
    expect(borderFor(style, "Top", { width: 200, height: 100 })).toMatchObject({
      width: 2,
      imageSource: "https://example.com/frame.png",
      paintWidth: 6,
      paintOutset: 1,
      paintSlice: "24",
      paintRepeat: "round",
    });
  });

  it("selects the border-image density candidate for the capture DPR", () => {
    const style = {
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: "transparent",
      borderImageSource: 'image-set(url("1x.png") 1x, url("2x.png") 2x)',
      borderImageSlice: "24",
    } as unknown as CSSStyleDeclaration;

    expect(borderFor(style, "Top", { width: 200, height: 100 }, 2)).toMatchObject({
      imageSource: "2x.png",
      paintSlice: "24",
    });
  });

  it("resolves border-image-width independently from the layout border width", () => {
    const style = {
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: "rgba(0, 0, 0, 0)",
      borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
      borderImageWidth: "3 4px 5 6px",
    } as unknown as CSSStyleDeclaration;
    expect(borderFor(style, "Top")).toMatchObject({ width: 2, paintWidth: 6 });
  });

  it("resolves percentage border-image widths against the border-image area", () => {
    const style = {
      borderTopWidth: "2px",
      borderRightWidth: "2px",
      borderTopStyle: "solid",
      borderRightStyle: "solid",
      borderTopColor: "transparent",
      borderRightColor: "transparent",
      borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
      borderImageWidth: "10% 20%",
    } as unknown as CSSStyleDeclaration;
    expect(borderFor(style, "Top", { width: 200, height: 100 })).toMatchObject({ width: 2, paintWidth: 10 });
    expect(borderFor(style, "Right", { width: 200, height: 100 })).toMatchObject({ width: 2, paintWidth: 40 });
  });

  it("resolves function border-image widths against the correct area axis", () => {
    const style = {
      borderTopWidth: "2px",
      borderRightWidth: "2px",
      borderTopStyle: "solid",
      borderRightStyle: "solid",
      borderTopColor: "transparent",
      borderRightColor: "transparent",
      borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
      borderImageWidth: "calc(10% + 2px) min(20%, 30px)",
    } as unknown as CSSStyleDeclaration;
    expect(borderFor(style, "Top", { width: 200, height: 100 })).toMatchObject({ paintWidth: 12 });
    expect(borderFor(style, "Right", { width: 200, height: 100 })).toMatchObject({ paintWidth: 30 });
  });

  it("captures border-image-outset without changing the layout border width", () => {
    const style = {
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: "transparent",
      borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
      borderImageOutset: "2 4px",
    } as unknown as CSSStyleDeclaration;
    expect(borderFor(style, "Top")).toMatchObject({ width: 2, paintOutset: 4 });
  });

  it("resolves function border-image outsets without changing layout width", () => {
    const style = {
      borderTopWidth: "2px",
      borderRightWidth: "2px",
      borderTopStyle: "solid",
      borderRightStyle: "solid",
      borderTopColor: "transparent",
      borderRightColor: "transparent",
      borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
      borderImageOutset: "calc(2px + 1px) min(3px, 5px)",
    } as unknown as CSSStyleDeclaration;
    expect(borderFor(style, "Top")).toMatchObject({ width: 2, paintOutset: 3 });
    expect(borderFor(style, "Right")).toMatchObject({ width: 2, paintOutset: 3 });
  });

  it("retains non-default border-image slice and repeat contracts", () => {
    const style = document.createElement("div").style;
    style.borderTop = "2px solid transparent";
    style.borderImageSource = "linear-gradient(90deg, red, blue)";
    style.borderImageSlice = "30%";
    style.borderImageRepeat = "round";
    expect(borderFor(style, "Top")).toMatchObject({
      width: 2,
      paintSlice: "30%",
      paintRepeat: "round",
    });
  });

  it("leaves mixed external image layers on the native URL path", () => {
    expect(backgroundSvgDataUrl(
      "linear-gradient(90deg, #000, #fff), url(https://example.com/texture.png)",
      "#fff",
      100,
      100,
    )).toBeUndefined();
  });

  it("resolves percentage corner radii against the captured box", () => {
    const element = document.createElement("div");
    element.style.borderTopLeftRadius = "50% 20%";
    element.style.borderTopRightRadius = "10%";
    expect(radiusFor(getComputedStyle(element), 200, 100)).toEqual([20, 10, 0, 0]);
  });

  it("normalizes adjacent corner radii to the captured box", () => {
    const style = {
      borderTopLeftRadius: "80px",
      borderTopRightRadius: "80px",
      borderBottomRightRadius: "0px",
      borderBottomLeftRadius: "0px",
    } as CSSStyleDeclaration;
    expect(radiusFor(style, 100, 100)).toEqual([50, 50, 0, 0]);
  });

  it("parses browser-computed shadows with a leading color and unitless zero", () => {
    expect(shadowFromStyle("rgba(0, 0, 0, 0.18) 0px 16px 35px 0px")).toMatchObject({
      offsetX: 0,
      offsetY: 16,
      blur: 35,
      spread: 0,
      color: "rgba(0, 0, 0, 0.18)",
    });
    expect(shadowFromStyle("0 0 0 24px rgba(255,255,255,.04)")).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      blur: 0,
      spread: 24,
    });
  });

  it("keeps nested CSS Color 4 functions in shadow paints", () => {
    expect(shadowFromStyle("color(display-p3 1 0 0 / 50%) 0 2px 4px")).toMatchObject({
      color: "color(display-p3 1 0 0 / 50%)",
      offsetY: 2,
      blur: 4,
    });
    expect(shadowFromStyle("0 1px 3px color-mix(in srgb, red 25%, blue)"))
      .toMatchObject({ color: "color-mix(in srgb, red 25%, blue)" });
  });

  it("keeps every CSS box-shadow layer in the shared scene model", () => {
    const shadows = shadowsFromStyle("0 4px 12px rgba(0,0,0,.18), inset 0 0 0 1px #fff");
    expect(shadows).toHaveLength(2);
    expect(shadows[0]).toMatchObject({ offsetY: 4, blur: 12 });
    expect(shadows[1]).toMatchObject({ offsetX: 0, offsetY: 0, blur: 0, spread: 1, inset: true });
  });

  it("locks direct children of wrapped layouts to their captured cells", () => {
    const child: DesignNode = {
      id: "grid-child",
      type: "frame",
      rect: { x: 48, y: 72, width: 120, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const root: DesignNode = {
      id: "grid",
      type: "frame",
      rect: { x: 0, y: 0, width: 300, height: 220 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", wrap: true },
      children: [child],
    };

    lockMeasuredGeometry(root);

    expect(child.layout.geometryLock).toBe(true);
  });

  it("locks direct children of reverse layouts to preserve browser order", () => {
    const child: DesignNode = {
      id: "reverse-child",
      type: "frame",
      rect: { x: 160, y: 0, width: 80, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const root: DesignNode = {
      id: "reverse",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", reverse: true },
      children: [child],
    };

    lockMeasuredGeometry(root);

    expect(child.layout.geometryLock).toBe(true);
  });

  it("keeps direct children of ordinary layout containers in Auto Layout flow", () => {
    const child: DesignNode = {
      id: "flex-child",
      type: "frame",
      rect: { x: 24, y: 18, width: 140, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const root: DesignNode = {
      id: "flex",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "vertical", gap: 12 },
      children: [child],
    };

    lockMeasuredGeometry(root);

    expect(child.layout.geometryLock).toBeUndefined();
  });

  it("locks an auto-margin child even in an ordinary start-aligned layout", () => {
    const child: DesignNode = {
      id: "auto-margin-child",
      type: "frame",
      rect: { x: 180, y: 0, width: 60, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), autoMargins: [false, false, false, true] },
      children: [],
    };
    const root: DesignNode = {
      id: "ordinary-row",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", justifyContent: "start" },
      children: [child],
    };

    lockMeasuredGeometry(root);

    expect(child.layout.geometryLock).toBe(true);
    expect(child.layout.autoMargins).toEqual([false, false, false, true]);
  });

  it("locks only unequal flex-grow ratios while retaining the editable flex frame", () => {
    const first: DesignNode = {
      id: "grow-one",
      type: "frame",
      rect: { x: 0, y: 0, width: 100, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { flexGrow: "1" },
      layout: emptyLayout(),
      children: [],
    };
    const second: DesignNode = {
      ...first,
      id: "grow-two",
      rect: { x: 100, y: 0, width: 200, height: 40 },
      computedStyles: { flexGrow: "2" },
    };
    const fixed: DesignNode = {
      ...first,
      id: "grow-fixed",
      rect: { x: 300, y: 0, width: 60, height: 40 },
      computedStyles: { flexGrow: "0" },
    };
    const root: DesignNode = {
      id: "unequal-grow",
      type: "frame",
      rect: { x: 0, y: 0, width: 360, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex" },
      layout: { ...emptyLayout(), mode: "horizontal" },
      children: [first, second, fixed],
    };

    lockMeasuredGeometry(root);

    expect(first.layout.geometryLock).toBe(true);
    expect(second.layout.geometryLock).toBe(true);
    expect(fixed.layout.geometryLock).toBeUndefined();
    expect(root.layout.mode).toBe("horizontal");
  });

  it("locks equal flex-grow children when their flex-basis tokens differ", () => {
    const first: DesignNode = {
      id: "basis-zero",
      type: "frame",
      rect: { x: 0, y: 0, width: 140, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { flexGrow: "1", flexBasis: "0px" },
      layout: emptyLayout(),
      children: [],
    };
    const second: DesignNode = {
      ...first,
      id: "basis-fixed",
      rect: { x: 140, y: 0, width: 220, height: 40 },
      computedStyles: { flexGrow: "1", flexBasis: "40px" },
    };
    const root: DesignNode = {
      id: "unequal-basis",
      type: "frame",
      rect: { x: 0, y: 0, width: 360, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex" },
      layout: { ...emptyLayout(), mode: "horizontal" },
      children: [first, second],
    };

    lockMeasuredGeometry(root);

    expect(first.layout.geometryLock).toBe(true);
    expect(second.layout.geometryLock).toBe(true);
  });

  it("keeps equal fixed or percentage flex-basis children flowable", () => {
    const first: DesignNode = {
      id: "same-basis-one",
      type: "frame",
      rect: { x: 0, y: 0, width: 160, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { flexGrow: "1", flexBasis: "50%" },
      layout: emptyLayout(),
      children: [],
    };
    const second: DesignNode = {
      ...first,
      id: "same-basis-two",
      rect: { x: 160, y: 0, width: 160, height: 40 },
    };
    const root: DesignNode = {
      id: "equal-basis",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex" },
      layout: { ...emptyLayout(), mode: "horizontal" },
      children: [first, second],
    };

    lockMeasuredGeometry(root);

    expect(first.layout.geometryLock).toBeUndefined();
    expect(second.layout.geometryLock).toBeUndefined();
  });

  it("locks auto-basis children whose captured intrinsic sizes differ", () => {
    const first: DesignNode = {
      id: "auto-basis-small",
      type: "frame",
      rect: { x: 0, y: 0, width: 96, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { flexGrow: "1", flexBasis: "auto" },
      layout: emptyLayout(),
      children: [],
    };
    const second: DesignNode = {
      ...first,
      id: "auto-basis-large",
      rect: { x: 96, y: 0, width: 224, height: 40 },
    };
    const root: DesignNode = {
      id: "intrinsic-basis",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex" },
      layout: { ...emptyLayout(), mode: "horizontal" },
      children: [first, second],
    };

    lockMeasuredGeometry(root);

    expect(first.layout.geometryLock).toBe(true);
    expect(second.layout.geometryLock).toBe(true);
  });

  it("locks positive flex-shrink children with unequal weights", () => {
    const first: DesignNode = {
      id: "shrink-half",
      type: "frame",
      rect: { x: 0, y: 0, width: 140, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { flexShrink: "0.5" },
      layout: emptyLayout(),
      children: [],
    };
    const second: DesignNode = {
      ...first,
      id: "shrink-one",
      rect: { x: 140, y: 0, width: 160, height: 40 },
      computedStyles: { flexShrink: "1" },
    };
    const fixed: DesignNode = {
      ...first,
      id: "shrink-zero",
      rect: { x: 300, y: 0, width: 60, height: 40 },
      computedStyles: { flexShrink: "0" },
    };
    const root: DesignNode = {
      id: "unequal-shrink",
      type: "frame",
      rect: { x: 0, y: 0, width: 360, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex" },
      layout: { ...emptyLayout(), mode: "horizontal" },
      children: [first, second, fixed],
    };

    lockMeasuredGeometry(root);

    expect(first.layout.geometryLock).toBe(true);
    expect(second.layout.geometryLock).toBe(true);
    expect(fixed.layout.geometryLock).toBeUndefined();
  });

  it("keeps equal non-default flex-shrink weights flowable", () => {
    const first: DesignNode = {
      id: "same-shrink-one",
      type: "frame",
      rect: { x: 0, y: 0, width: 160, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { flexShrink: "0.5" },
      layout: emptyLayout(),
      children: [],
    };
    const second: DesignNode = {
      ...first,
      id: "same-shrink-two",
      rect: { x: 160, y: 0, width: 160, height: 40 },
    };
    const root: DesignNode = {
      id: "equal-shrink",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex" },
      layout: { ...emptyLayout(), mode: "horizontal" },
      children: [first, second],
    };

    lockMeasuredGeometry(root);

    expect(first.layout.geometryLock).toBeUndefined();
    expect(second.layout.geometryLock).toBeUndefined();
  });

  it("keeps measured text in ordinary Auto Layout flow", () => {
    const text: DesignNode = {
      id: "measured-text",
      type: "text",
      rect: { x: 16, y: 20, width: 160, height: 24 },
      textRect: { x: 0, y: 3, width: 96, height: 18 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const frame: DesignNode = {
      id: "flow-frame",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "vertical", gap: 8 },
      children: [text],
    };

    lockMeasuredGeometry(frame);

    expect(text.layout.geometryLock).toBeUndefined();
  });

  it("locks all direct children of measured visual groups", () => {
    const measuredHeading: DesignNode = {
      id: "measured-heading",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 18 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), geometryLock: true },
      children: [],
    };
    const button: DesignNode = {
      id: "measured-button",
      type: "frame",
      rect: { x: 2, y: 24, width: 56, height: 29 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [6, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal" },
      children: [],
    };
    const group: DesignNode = {
      id: "measured-group",
      type: "frame",
      rect: { x: 280, y: 390, width: 60, height: 53 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), geometryLock: true },
      children: [measuredHeading, button],
    };

    lockMeasuredGeometry(group);

    expect(measuredHeading.layout.geometryLock).toBe(true);
    expect(button.layout.geometryLock).toBe(true);
  });

  it("locks measured children when browser distribution depends on font metrics", () => {
    const left: DesignNode = {
      id: "left",
      type: "frame",
      rect: { x: 14, y: 10, width: 120, height: 30 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const right: DesignNode = {
      ...left,
      id: "right",
      rect: { x: 186, y: 10, width: 100, height: 30 },
    };
    const root: DesignNode = {
      id: "distributed",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 50 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", justifyContent: "space-between", alignItems: "center" },
      children: [left, right],
    };

    lockMeasuredGeometry(root);

    expect(left.layout.geometryLock).toBe(true);
    expect(right.layout.geometryLock).toBe(true);
  });

  it("does not recursively lock descendants inside a measured distribution child", () => {
    const icon: DesignNode = {
      id: "nav-icon",
      type: "vector",
      rect: { x: 10, y: 1, width: 17, height: 17 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const label: DesignNode = {
      id: "nav-label",
      type: "text",
      rect: { x: 6, y: 23, width: 32, height: 11 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const item: DesignNode = {
      id: "nav-item",
      type: "frame",
      rect: { x: 112, y: 13, width: 44, height: 35 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "vertical", gap: 5, alignItems: "center" },
      children: [icon, label],
    };
    const nav: DesignNode = {
      id: "nav",
      type: "frame",
      rect: { x: 0, y: 0, width: 375, height: 66 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", justifyContent: "space-around" },
      children: [item],
    };

    lockMeasuredGeometry(nav);

    expect(item.layout.geometryLock).toBe(true);
    expect(icon.layout.geometryLock).toBeUndefined();
    expect(label.layout.geometryLock).toBeUndefined();
  });

  it("keeps tiny inline decorations in a non-wrapped flex row", () => {
    const dot: DesignNode = {
      id: "status-dot",
      type: "frame",
      rect: { x: 0, y: 3, width: 6, height: 6 },
      opacity: 1,
      fill: { color: "#f4d69f" },
      radius: [3, 3, 3, 3],
      margin: [0, 0, 0, 0],
      positioning: "static",
      layout: emptyLayout(),
      children: [],
    };
    const label: DesignNode = {
      id: "status-label",
      type: "text",
      rect: { x: 12, y: 0, width: 107, height: 12 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const row: DesignNode = {
      id: "status-row",
      type: "frame",
      rect: { x: 0, y: 0, width: 119, height: 12 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", gap: 6, alignItems: "center" },
      children: [dot, label],
    };

    lockMeasuredGeometry(row);

    expect(dot.layout.geometryLock).toBeUndefined();
  });

  it("locks tiny inline decorations in distributed flex rows", () => {
    const dot: DesignNode = {
      id: "distributed-dot",
      type: "frame",
      rect: { x: 8, y: 3, width: 6, height: 6 },
      opacity: 1,
      radius: [3, 3, 3, 3],
      margin: [0, 0, 0, 0],
      positioning: "static",
      layout: emptyLayout(),
      children: [],
    };
    const label: DesignNode = {
      id: "distributed-label",
      type: "text",
      rect: { x: 44, y: 0, width: 80, height: 12 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const row: DesignNode = {
      id: "distributed-row",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 12 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", justifyContent: "space-evenly" },
      children: [dot, label],
    };

    lockMeasuredGeometry(row);

    expect(dot.layout.geometryLock).toBe(true);
    expect(label.layout.geometryLock).toBe(true);
  });

  it("keeps ordinary cross-axis centering flowable", () => {
    const label: DesignNode = {
      id: "centered-label",
      type: "text",
      rect: { x: 12, y: 17, width: 80, height: 14 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const row: DesignNode = {
      id: "centered-row",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", gap: 8, alignItems: "center", justifyContent: "start" },
      children: [label],
    };

    lockMeasuredGeometry(row);

    expect(label.layout.geometryLock).toBeUndefined();
  });

  it("locks explicitly out-of-flow children without locking ordinary siblings", () => {
    const absoluteChild: DesignNode = {
      id: "absolute-child",
      type: "frame",
      rect: { x: 24, y: 18, width: 140, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      positioning: "absolute",
      layout: { ...emptyLayout(), position: "absolute" },
      children: [],
    };
    const root: DesignNode = {
      id: "flow-with-overlay",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "vertical", gap: 12 },
      children: [absoluteChild],
    };

    lockMeasuredGeometry(root);

    expect(absoluteChild.layout.geometryLock).toBe(true);
  });

  it("locks flex children whose align-self cannot be represented by Figma", () => {
    const centered: DesignNode = {
      id: "centered-child",
      type: "frame",
      rect: { x: 120, y: 0, width: 80, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), alignSelf: "center" },
      children: [],
    };
    const root: DesignNode = {
      id: "start-aligned-row",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", alignItems: "start" },
      children: [centered],
    };

    lockMeasuredGeometry(root);

    expect(centered.layout.geometryLock).toBe(true);
  });

  it("locks align-self start when the parent uses a different cross-axis alignment", () => {
    const startAligned: DesignNode = {
      id: "start-child",
      type: "frame",
      rect: { x: 0, y: 0, width: 80, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), alignSelf: "start" },
      children: [],
    };
    const root: DesignNode = {
      id: "center-aligned-row-with-start-child",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", alignItems: "center" },
      children: [startAligned],
    };

    lockMeasuredGeometry(root);

    expect(startAligned.layout.geometryLock).toBe(true);
  });

  it("keeps align-self start flowable when the parent is already start-aligned", () => {
    const startAligned: DesignNode = {
      id: "matching-start-child",
      type: "frame",
      rect: { x: 0, y: 0, width: 80, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), alignSelf: "start" },
      children: [],
    };
    const root: DesignNode = {
      id: "start-aligned-row-with-start-child",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", alignItems: "start" },
      children: [startAligned],
    };

    lockMeasuredGeometry(root);

    expect(startAligned.layout.geometryLock).toBeUndefined();
  });

  it("preserves and locks per-child baseline alignment", () => {
    const baseline: DesignNode = {
      id: "baseline-child",
      type: "frame",
      rect: { x: 0, y: 2, width: 80, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), alignSelf: "baseline" },
      children: [],
    };
    const root: DesignNode = {
      id: "baseline-row",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", alignItems: "start" },
      children: [baseline],
    };

    lockMeasuredGeometry(root);

    expect(baseline.layout.alignSelf).toBe("baseline");
    expect(baseline.layout.geometryLock).toBe(true);
  });

  it("inlines inherited SVG paints while preserving explicit path attributes", () => {
    const style = document.createElement("style");
    style.textContent = `.ui-icon { color: rgb(58, 0, 26); fill: none; stroke: currentColor; stroke-width: 1.5px; stroke-linecap: round; stroke-linejoin: round; }`;
    const host = document.createElement("div");
    host.innerHTML = `<svg class="ui-icon" viewBox="0 0 24 24"><path id="inherited" d="M2 12h20"/><path id="explicit" d="M12 2v20" stroke="#fff" fill="none"/></svg>`;
    document.head.append(style);
    document.body.append(host);

    const serialized = inlineSvgStyles(host.querySelector("svg")!, document);
    const parsed = new DOMParser().parseFromString(serialized, "image/svg+xml");
    const inherited = parsed.querySelector("#inherited")!;
    const explicit = parsed.querySelector("#explicit")!;

    expect(inherited.getAttribute("fill")).toBe("none");
    expect(inherited.getAttribute("stroke")).toBe("rgb(58, 0, 26)");
    expect(inherited.getAttribute("stroke-width")).toBe("1.5px");
    expect(inherited.getAttribute("stroke-linecap")).toBe("round");
    expect(inherited.getAttribute("stroke-linejoin")).toBe("round");
    expect(explicit.getAttribute("stroke")).toBe("#fff");
    expect(explicit.getAttribute("fill")).toBe("none");
  });

  it("inlines SVG gradient stops and vector paint presentation properties", () => {
    const style = document.createElement("style");
    style.textContent = `
      .gradient-stop { stop-color: rgb(12, 34, 56); stop-opacity: .65; }
      .gradient-path { fill: url(#paint); paint-order: stroke fill; vector-effect: non-scaling-stroke; }
    `;
    const host = document.createElement("div");
    host.innerHTML = `<svg viewBox="0 0 24 24" opacity=".9"><defs><linearGradient id="paint"><stop class="gradient-stop" offset="0"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><path class="gradient-path" d="M2 2h20" stroke="#000"/></svg>`;
    document.head.append(style);
    document.body.append(host);

    const serialized = inlineSvgStyles(host.querySelector("svg")!, document);
    const parsed = new DOMParser().parseFromString(serialized, "image/svg+xml");
    const inheritedStop = parsed.querySelector("stop.gradient-stop")!;
    const path = parsed.querySelector("path.gradient-path")!;

    expect(inheritedStop.getAttribute("stop-color")).toBe("rgb(12, 34, 56)");
    expect(inheritedStop.getAttribute("stop-opacity")).toBe(".65");
    expect(path.getAttribute("paint-order")).toBe("stroke fill");
    expect(path.getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });
});

describe("CSS relative positioning", () => {
  it("resolves right/bottom offsets when left/top are auto", () => {
    expect(relativePositionOffset({ left: "auto", right: "12px", top: "auto", bottom: "8px" })).toEqual({ left: -12, top: -8 });
    expect(relativePositionOffset({ left: "4px", right: "12px", top: "6px", bottom: "8px" })).toEqual({ left: 4, top: 6 });
    expect(relativePositionOffset({ left: "10%", right: "auto", top: "auto", bottom: "calc(5% + 2px)" }, { width: 300, height: 200 })).toEqual({ left: 30, top: -12 });
    expect(relativePositionExpressions({ left: "10%", right: "auto", top: "auto", bottom: "calc(5% + 2px)" })).toEqual({ left: "10%", bottom: "calc(5% + 2px)" });
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".relative-expression { position: relative; right: 10%; bottom: calc(5% + 2px); }";
    const element = document.createElement("div");
    element.className = "relative-expression";
    document.head.append(stylesheet);
    document.body.append(element);
    expect(relativePositionExpressions(getComputedStyle(element), element)).toEqual({ right: "10%", bottom: "calc(5% + 2px)" });
    stylesheet.remove();
    element.remove();
    expect(relativePositionOffset({ left: "auto", right: "auto", top: "auto", bottom: "auto" })).toBeUndefined();
  });

  it("maps logical inset offsets through writing mode and direction", () => {
    expect(relativePositionOffset({
      left: "auto", right: "auto", top: "auto", bottom: "auto",
      insetInlineStart: "12px", insetInlineEnd: "auto", insetBlockStart: "8px", insetBlockEnd: "auto",
      writingMode: "horizontal-tb", direction: "rtl",
    }, { width: 300, height: 200 })).toEqual({ left: -12, top: 8 });
    expect(relativePositionOffset({
      left: "auto", right: "auto", top: "auto", bottom: "auto",
      insetInlineStart: "10px", insetInlineEnd: "auto", insetBlockStart: "14px", insetBlockEnd: "auto",
      writingMode: "vertical-rl", direction: "ltr",
    }, { width: 300, height: 200 })).toEqual({ left: -14, top: 10 });
    expect(relativePositionExpressions({
      left: "auto", right: "auto", top: "auto", bottom: "auto",
      insetInlineStart: "10%", insetInlineEnd: "auto", insetBlockStart: "calc(5% + 2px)", insetBlockEnd: "auto",
      writingMode: "horizontal-tb", direction: "ltr",
    })).toEqual({ left: "10%", top: "calc(5% + 2px)" });
  });

  it("retains logical and physical inset shorthand expressions", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".inset-shorthand { position: relative; inset-inline: 10% calc(5% + 2px); inset-block: 4px 8px; }";
    const element = document.createElement("div");
    element.className = "inset-shorthand";
    document.head.append(stylesheet);
    document.body.append(element);
    expect(relativePositionExpressions(getComputedStyle(element), element)).toEqual({
      left: "10%", right: "calc(5% + 2px)", top: "4px", bottom: "8px",
    });
    stylesheet.remove();
    element.remove();
  });

  it("uses the parent content box for percentage relative offsets", () => {
    const parentStyle = document.createElement("div").style;
    parentStyle.paddingLeft = "10px";
    parentStyle.paddingRight = "10px";
    parentStyle.paddingTop = "8px";
    parentStyle.paddingBottom = "8px";
    parentStyle.borderLeftWidth = "2px";
    parentStyle.borderRightWidth = "2px";
    parentStyle.borderTopWidth = "1px";
    parentStyle.borderBottomWidth = "1px";
    const containingBlock = relativePositionContainingBlockSize({ width: 320, height: 220 }, parentStyle);
    expect(containingBlock).toEqual({ width: 296, height: 202 });
    expect(relativePositionOffset({ left: "10%", right: "auto", top: "auto", bottom: "5%" }, containingBlock)).toEqual({ left: 29.6, top: -10.1 });
  });

  it("resolves viewport-relative offsets against the captured viewport", () => {
    const viewport = { viewportWidth: 1440, viewportHeight: 900 };
    expect(relativePositionOffset({ left: "2vw", right: "auto", top: "auto", bottom: "1vh" }, viewport)).toEqual({ left: 28.8, top: -9 });
    expect(relativePositionOffset({ left: "calc(1vmin + 4px)", right: "auto", top: "2vmax", bottom: "auto" }, viewport)).toEqual({ left: 13, top: 28.8 });
    expect(relativePositionOffset({ left: "1svw", right: "auto", top: "1dvh", bottom: "auto" }, viewport)).toEqual({ left: 14.4, top: 9 });
    expect(relativePositionOffset({ left: "calc(-5vw + 2px)", right: "auto", top: "auto", bottom: "auto" }, viewport)).toEqual({ left: -70, top: 0 });
  });

  it("resolves viewport-relative flex/grid gaps without treating vw/vh as pixels", () => {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "2vh 1vw";
    document.body.append(container);

    const layout = layoutFor(getComputedStyle(container), {
      element: container,
      rect: { width: 320, height: 200 } as DOMRect,
      viewportWidth: 1440,
      viewportHeight: 900,
    });

    expect(layout.rowGap).toBe(18);
    expect(layout.columnGap).toBe(14.4);
    container.remove();
  });
});

describe("CSS fixed containing blocks", () => {
  it("recognizes ancestors that establish a non-viewport fixed containing block", () => {
    expect(establishesFixedContainingBlock({ transform: "translateX(1px)" } as CSSStyleDeclaration)).toBe(true);
    expect(establishesFixedContainingBlock({ filter: "blur(1px)" } as CSSStyleDeclaration)).toBe(true);
    expect(establishesFixedContainingBlock({ perspective: "500px" } as CSSStyleDeclaration)).toBe(true);
    expect(establishesFixedContainingBlock({ contain: "layout" } as CSSStyleDeclaration)).toBe(true);
    expect(establishesFixedContainingBlock({ willChange: "transform" } as CSSStyleDeclaration)).toBe(true);
    expect(establishesFixedContainingBlock({ transform: "none", filter: "none", perspective: "none", contain: "none", willChange: "auto" } as CSSStyleDeclaration)).toBe(false);
  });
});

describe("CSS sticky positioning", () => {
  it("keeps sticky flow when all inset thresholds are auto", () => {
    const style = {
      position: "sticky",
      top: "auto",
      right: "auto",
      bottom: "auto",
      left: "auto",
      getPropertyValue: (property: string) => property === "position" ? "sticky" : "auto",
    } as unknown as CSSStyleDeclaration;

    expect(hasActiveStickyInset(style)).toBe(false);
  });

  it("detects physical and logical sticky thresholds", () => {
    const physical = {
      position: "sticky",
      top: "12px",
      right: "auto",
      bottom: "auto",
      left: "auto",
      getPropertyValue: (property: string) => property === "top" ? "12px" : property === "position" ? "sticky" : "auto",
    } as unknown as CSSStyleDeclaration;
    const logical = {
      position: "sticky",
      top: "auto",
      right: "auto",
      bottom: "auto",
      left: "auto",
      getPropertyValue: (property: string) => property === "inset-inline-start" ? "8px" : property === "position" ? "sticky" : "auto",
    } as unknown as CSSStyleDeclaration;

    expect(hasActiveStickyInset(physical)).toBe(true);
    expect(hasActiveStickyInset(logical)).toBe(true);
  });
});

describe("HTML outline capture", () => {
  it("captures outline without treating it as a border-box dimension", () => {
    const style = {
      outlineWidth: "3px",
      outlineStyle: "dashed",
      outlineColor: "rgb(20, 40, 60)",
      outlineOffset: "4px",
    } as unknown as CSSStyleDeclaration;
    expect(outlineFor(style)).toEqual({
      color: "rgb(20, 40, 60)",
      width: 3,
      style: "dashed",
    });
  });

  it("preserves platform-defined auto outline semantics for the importer", () => {
    const style = {
      color: "rgb(12, 34, 56)",
      outlineWidth: "3px",
      outlineStyle: "auto",
      outlineColor: "auto",
    } as unknown as CSSStyleDeclaration;
    expect(outlineFor(style)).toEqual({
      color: "rgb(12, 34, 56)",
      width: 3,
      style: "auto",
    });
  });

  it("resolves border-width keywords retained by compatibility style objects", () => {
    const style = {
      color: "rgb(12, 34, 56)",
      borderTopWidth: "thin",
      borderTopStyle: "solid",
      borderTopColor: "currentColor",
      borderImageSource: "none",
      borderImageWidth: "1",
      borderImageOutset: "0",
      borderImageSlice: "100%",
      borderImageRepeat: "stretch",
      outlineWidth: "medium",
      outlineStyle: "solid",
      outlineColor: "currentColor",
    } as unknown as CSSStyleDeclaration;

    expect(borderFor(style, "Top")).toMatchObject({ width: 1, color: "rgb(12, 34, 56)" });
    expect(outlineFor(style)).toEqual({ color: "rgb(12, 34, 56)", width: 3, style: "solid" });
  });

  it("resolves absolute and font-relative boundary widths before serialization", () => {
    const style = {
      color: "rgb(12, 34, 56)",
      fontSize: "20px",
      borderTopWidth: "0.1in",
      borderTopStyle: "solid",
      borderTopColor: "currentColor",
      borderImageSource: "none",
      borderImageWidth: "1",
      borderImageOutset: "0",
      borderImageSlice: "100%",
      borderImageRepeat: "stretch",
      outlineWidth: "0.25em",
      outlineStyle: "solid",
      outlineColor: "currentColor",
    } as unknown as CSSStyleDeclaration;

    expect(borderFor(style, "Top")?.width).toBeCloseTo(9.6, 8);
    expect(outlineFor(style)?.width).toBe(5);
  });
});

describe("capture degradation diagnostics", () => {
  it("does not warn for filter and blend functions recreated by the plugin", () => {
    expect(unsupportedFilterFunctions("blur(8px) drop-shadow(0 2px 4px rgba(0,0,0,.2))")).toEqual([]);
    expect(unsupportedFilterFunctions("blur(8px) hue-rotate(20deg)")).toEqual(["hue-rotate"]);
    expect(unsupportedFilterFunctions("blur(8px) drop-shadow(0 2px 4px #000)", true)).toEqual([]);
    expect(unsupportedFilterFunctions("grayscale(80%) sepia(.2) invert(10%) hue-rotate(20deg)", true)).toEqual([]);
    expect(unsupportedFilterFunctions("opacity(50%) blur(8px)")).toEqual([]);
    expect(unsupportedFilterFunctions("opacity(50%) blur(8px)", false, false)).toEqual(["opacity"]);
    expect(unsupportedBlendModes("multiply, screen, normal")).toEqual([]);
    expect(unsupportedBlendModes("linear-dodge, plus-lighter, plus-darker")).toEqual([]);
    expect(unsupportedBlendModes("multiply, vivid-light")).toEqual(["vivid-light"]);
    expect(unsupportedBorderImageRepeat("stretch")).toEqual([]);
    expect(unsupportedBorderImageRepeat("round stretch")).toEqual(["round"]);
    expect(unsupportedBorderImageRepeat("space space")).toEqual(["space"]);
    expect(unsupportedBorderImageRepeat("round space", "30% fill")).toEqual([]);
    expect(unsupportedBorderImageRepeat("invalid", "30%")).toEqual(["invalid"]);
    expect(supportedMaskRepeat("round space")).toBe(true);
    expect(supportedMaskRepeat("repeat-x")).toBe(true);
    expect(supportedMaskRepeat("round invalid")).toBe(false);
    expect(supportedMaskGradientLayer("conic-gradient(from 45deg, transparent, #000)")).toBe(true);
    expect(supportedMaskGradientLayer("repeating-conic-gradient(from 20deg, transparent 0deg, #000 90deg)")).toBe(true);
    expect(supportedMaskGradientLayer("conic-gradient(red, blue), url(mask.svg)")).toBe(false);
    expect(supportedMaskMode("match-source", 2)).toBe(true);
    expect(supportedMaskMode("alpha, match-source", 2)).toBe(true);
    expect(supportedMaskMode("luminance", 2)).toBe(true);
    expect(supportedMaskMode("alpha, luminance", 2)).toBe(false);
    expect(supportedMaskMode("invalid", 1)).toBe(false);
    expect(supportedMaskComposite("intersect", 2)).toBe(true);
    expect(supportedMaskComposite("source-in", 3)).toBe(true);
    expect(supportedMaskComposite("intersect, add", 3)).toBe(true);
    expect(supportedMaskComposite("subtract", 2)).toBe(true);
    expect(supportedMaskComposite("source-out", 2)).toBe(true);
    expect(supportedMaskComposite("xor", 2)).toBe(true);
    expect(hasUnsupportedBorderImageSlice("100%")).toBe(false);
    expect(hasUnsupportedBorderImageSlice("1")).toBe(false);
    expect(hasUnsupportedBorderImageSlice("30% fill")).toBe(false);
    expect(hasUnsupportedBorderImageSlice("30% 20% 10% 5% fill")).toBe(false);
    expect(hasUnsupportedBorderImageSlice("calc(10% + 2%) min(20%, 30%) fill")).toBe(false);
    expect(hasUnsupportedBorderImageSlice("max(8, 12) clamp(10, 20, 30)")).toBe(false);
    expect(hasUnsupportedBorderImageSlice("min(20%) fill")).toBe(true);
    expect(hasUnsupportedBorderImageSlice("foo fill")).toBe(true);
    expect(hasUnsupportedBorderImageSlice("calc(10px + 2px) fill")).toBe(true);
  });
});

describe("background fallback selection", () => {
  it("keeps blended background layers on the native paint path and leaves pure gradients editable", () => {
    expect(shouldUseBackgroundSvgFallback({
      backgroundImage: "linear-gradient(90deg, #000, #fff)",
      backgroundColor: "transparent",
      backgroundBlendMode: "multiply",
      backgroundClip: "border-box",
    })).toBe(false);
    expect(shouldUseBackgroundSvgFallback({
      backgroundImage: "linear-gradient(90deg, #000, #fff)",
      backgroundColor: "transparent",
      backgroundBlendMode: "normal",
      backgroundClip: "border-box",
    })).toBe(false);
  });
});

describe("responsive sizing capture", () => {
  it("keeps resolved min/max bounds for the Figma constraint pass", () => {
    expect(sizingConstraintsFor({
      minWidth: "120px",
      maxWidth: "80vw",
      minHeight: "auto",
      maxHeight: "none",
    })).toEqual({ minWidth: "120px", maxWidth: "80vw" });
  });

  it("preserves authored responsive min/max expressions when an element is available", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".responsive-bound { min-width: calc(50% - 12px); max-width: clamp(240px, 80vw, 960px); }";
    document.head.append(stylesheet);
    const element = document.createElement("div");
    element.className = "responsive-bound";
    document.body.append(element);

    expect(sizingConstraintsFor({
      minWidth: "388px",
      maxWidth: "1024px",
      minHeight: "auto",
      maxHeight: "none",
    }, element)).toEqual({
      minWidth: "calc(50% - 12px)",
      maxWidth: "clamp(240px, 80vw, 960px)",
    });
    element.remove();
    stylesheet.remove();
  });

  it("maps horizontal logical sizes to Figma physical axes and constraints", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".logical-size { inline-size: 100%; block-size: 50%; min-inline-size: 240px; max-block-size: 320px; }";
    document.head.append(stylesheet);
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.className = "logical-size";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 480, height: 400 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 480, height: 200 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fill");
    expect(layout.widthExpression).toBe("100%");
    expect(layout.heightExpression).toBe("50%");
    expect(sizingConstraintsFor({
      minWidth: "auto",
      maxWidth: "none",
      minHeight: "auto",
      maxHeight: "none",
    }, child)).toEqual({ minWidth: "240px", maxHeight: "320px" });
    child.remove();
    parent.remove();
    stylesheet.remove();
  });

  it("swaps logical sizing axes for vertical writing modes", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".vertical-logical-size { writing-mode: vertical-rl; inline-size: 120%; block-size: 80%; min-inline-size: 64px; max-block-size: 480px; }";
    document.head.append(stylesheet);
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.className = "vertical-logical-size";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 480, height: 400 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 384, height: 480 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthExpression).toBe("80%");
    expect(layout.heightExpression).toBe("120%");
    expect(sizingConstraintsFor({
      minWidth: "auto",
      maxWidth: "none",
      minHeight: "auto",
      maxHeight: "none",
    }, child)).toEqual({ minHeight: "64px", maxWidth: "480px" });
    child.remove();
    parent.remove();
    stylesheet.remove();
  });

  it("does not let physical default tokens hide authored logical sizing", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".logical-default-overrides { width: auto; inline-size: 75%; min-width: initial; min-inline-size: 180px; }";
    document.head.append(stylesheet);
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.className = "logical-default-overrides";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 400, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 300, height: 48 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthExpression).toBe("75%");
    expect(sizingConstraintsFor({
      minWidth: "auto",
      maxWidth: "none",
      minHeight: "auto",
      maxHeight: "none",
    }, child)).toEqual({ minWidth: "180px" });
    child.remove();
    parent.remove();
    stylesheet.remove();
  });

  it("maps logical padding to physical Auto Layout edges", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const horizontalRtl = {
      ...getComputedStyle(element),
      display: "flex",
      writingMode: "horizontal-tb",
      direction: "rtl",
      paddingTop: "1px",
      paddingRight: "2px",
      paddingBottom: "3px",
      paddingLeft: "4px",
      paddingInlineStart: "8px",
      paddingInlineEnd: "12px",
      paddingBlockStart: "16px",
      paddingBlockEnd: "20px",
    } as CSSStyleDeclaration;
    expect(layoutFor(horizontalRtl, { element }).padding).toEqual([16, 8, 20, 12]);

    const vertical = {
      ...horizontalRtl,
      writingMode: "vertical-rl",
      direction: "ltr",
      paddingInlineStart: "8px",
      paddingInlineEnd: "12px",
      paddingBlockStart: "16px",
      paddingBlockEnd: "20px",
    } as CSSStyleDeclaration;
    expect(layoutFor(vertical, { element }).padding).toEqual([8, 16, 12, 20]);
    element.remove();
  });

  it("keeps physical edges when logical longhands are only default zeros", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const style = {
      ...getComputedStyle(element),
      display: "flex",
      writingMode: "vertical-rl",
      direction: "ltr",
      paddingTop: "5px",
      paddingRight: "7px",
      paddingBottom: "9px",
      paddingLeft: "11px",
      paddingInlineStart: "0px",
      paddingInlineEnd: "0px",
      paddingBlockStart: "0px",
      paddingBlockEnd: "0px",
    } as CSSStyleDeclaration;

    expect(layoutFor(style, { element }).padding).toEqual([5, 7, 9, 11]);
    element.remove();
  });

  it("expands authored padding shorthand into physical Auto Layout edges", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".padding-shorthand { padding: 4px 8px 12px 16px; }";
    document.head.append(stylesheet);
    const element = document.createElement("div");
    element.className = "padding-shorthand";
    document.body.append(element);

    expect(layoutFor(getComputedStyle(element), { element }).padding).toEqual([4, 8, 12, 16]);

    element.remove();
    stylesheet.remove();
  });

  it("expands authored logical padding shorthand through direction and writing mode", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".logical-padding-shorthand { padding-inline: 8px 12px; padding-block: 16px 20px; }";
    document.head.append(stylesheet);
    const element = document.createElement("div");
    element.className = "logical-padding-shorthand";
    document.body.append(element);

    const horizontalRtl = getComputedStyle(element);
    Object.defineProperties(horizontalRtl, {
      writingMode: { value: "horizontal-tb" },
      direction: { value: "rtl" },
    });
    expect(layoutFor(horizontalRtl, { element }).padding).toEqual([16, 8, 20, 12]);

    const vertical = getComputedStyle(element);
    Object.defineProperties(vertical, {
      writingMode: { value: "vertical-rl" },
      direction: { value: "ltr" },
    });
    expect(layoutFor(vertical, { element }).padding).toEqual([8, 16, 12, 20]);

    element.remove();
    stylesheet.remove();
  });

  it("captures physical and shorthand auto margins as layout constraints", () => {
    const element = document.createElement("div");
    element.style.display = "flex";
    element.style.margin = "4px auto 8px 12px";
    document.body.append(element);
    const style = getComputedStyle(element);

    expect(autoMarginEdges(style, element)).toEqual([false, true, false, false]);
    expect(layoutFor(style, { element }).autoMargins)
      .toEqual([false, true, false, false]);

    element.remove();
  });

  it("maps logical auto margins through direction and writing mode", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const base = getComputedStyle(element);
    const logical = {
      ...base,
      marginTop: "0px",
      marginRight: "0px",
      marginBottom: "0px",
      marginLeft: "0px",
      marginInlineStart: "auto",
      marginInlineEnd: "0px",
      marginBlockStart: "auto",
      marginBlockEnd: "0px",
      writingMode: "horizontal-tb",
      direction: "ltr",
    } as CSSStyleDeclaration;

    expect(autoMarginEdges(logical)).toEqual([true, false, false, true]);
    expect(autoMarginEdges({ ...logical, direction: "rtl" } as CSSStyleDeclaration))
      .toEqual([true, true, false, false]);
    expect(autoMarginEdges({ ...logical, writingMode: "vertical-rl", direction: "ltr" } as CSSStyleDeclaration))
      .toEqual([true, true, false, false]);

    element.remove();
  });

});


describe("HTML semantic capture", () => {
  it("resolves accessible names, implicit roles, descriptions, and control state", () => {
    const label = document.createElement("span");
    label.id = "save-label";
    label.textContent = "Save changes";
    const button = document.createElement("button");
    button.setAttribute("aria-labelledby", "save-label");
    button.setAttribute("aria-describedby", "save-help");
    const help = document.createElement("span");
    help.id = "save-help";
    help.textContent = "Writes the current draft";
    document.body.append(label, button, help);

    expect(semanticsFor(button, document)).toEqual({
      role: "button",
      label: "Save changes",
      description: "Writes the current draft",
    });
  });

  it("keeps native input states and labels for editable Figma metadata", () => {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = true;
    input.disabled = true;
    input.setAttribute("aria-label", "Include archived");
    document.body.append(input);

    expect(semanticsFor(input, document)).toMatchObject({
      role: "checkbox",
      label: "Include archived",
      states: { checked: "true", disabled: "true" },
    });
  });

  it("keeps safe live control values without exporting password contents", () => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = "Ada Lovelace";
    input.setAttribute("aria-label", "Assignee");
    const password = document.createElement("input");
    password.type = "password";
    password.value = "secret-value";
    password.setAttribute("aria-label", "Password");
    const select = document.createElement("select");
    select.multiple = true;
    const option = document.createElement("option");
    option.value = "ops";
    option.textContent = "Operations";
    option.selected = true;
    select.append(option);
    const textarea = document.createElement("textarea");
    textarea.value = "Notes";
    document.body.append(input, password, select, textarea);

    expect(semanticsFor(input, document)).toMatchObject({ states: { value: "Ada Lovelace" } });
    expect(semanticsFor(password, document)).not.toMatchObject({ states: { value: expect.anything() } });
    expect(semanticsFor(select, document)).toMatchObject({ states: { value: "ops", multiple: "true" } });
    expect(semanticsFor(textarea, document)).toMatchObject({ states: { value: "Notes" } });
  });

  it("keeps placeholder state when an editable control has no value", () => {
    const input = document.createElement("input");
    input.placeholder = "Search pages";
    document.body.append(input);
    expect(semanticsFor(input, document)).toMatchObject({ states: { placeholder: "Search pages" } });
  });

  it("retains composite widget values and relationships", () => {
    const slider = document.createElement("div");
    slider.setAttribute("role", "slider");
    slider.setAttribute("aria-label", "Opacity");
    slider.setAttribute("aria-valuemin", "0");
    slider.setAttribute("aria-valuemax", "100");
    slider.setAttribute("aria-valuenow", "75");
    slider.setAttribute("aria-orientation", "horizontal");
    slider.setAttribute("aria-controls", "preview");
    document.body.append(slider);

    expect(semanticsFor(slider, document)).toMatchObject({
      role: "slider",
      label: "Opacity",
      states: {
        valuemin: "0",
        valuemax: "100",
        valuenow: "75",
        orientation: "horizontal",
        controls: "preview",
      },
    });
  });
});

describe("captured transform geometry", () => {
  it("resolves percentage and functional translate values against the untransformed box", () => {
    expect(transformMatrixValues("translate(50% 25%)", {
      width: 200,
      height: 80,
    })).toEqual([1, 0, 0, 1, 100, 20]);
    expect(transformMatrixValues("translate(calc(50% - 10px), calc(25% + 1rem))", {
      width: 200,
      height: 80,
      fontSize: 20,
      rootFontSize: 16,
    })).toEqual([1, 0, 0, 1, 90, 36]);
    expect(transformMatrixValues("translate(calc(min(50%, 120px) - 10px) calc(max(10px, 25%) + 1rem))", {
      width: 200,
      height: 80,
      rootFontSize: 16,
    })).toEqual([1, 0, 0, 1, 90, 36]);
  });

  it("rejects invalid translate lengths instead of silently treating them as zero", () => {
    expect(transformMatrixValues("translate(unknown(10px), 4px)", { width: 200, height: 80 })).toBeUndefined();
    expect(transformMatrixValues("translate3d(10px, 4px, 10%)", { width: 200, height: 80 })).toBeUndefined();
  });

  it("removes individual percentage and calc translate exactly once from captured geometry", () => {
    const element = document.createElement("div");
    document.body.append(element);
    Object.defineProperties(element, {
      offsetWidth: { configurable: true, value: 200 },
      offsetHeight: { configurable: true, value: 80 },
    });
    vi.spyOn(window, "getComputedStyle").mockImplementation((target: Element) => ({
      transform: "none",
      translate: target === element ? "calc(50% - 10px) calc(25% + 1rem)" : "none",
      rotate: "none",
      scale: "none",
      transformOrigin: "50% 50%",
      fontSize: target === element ? "20px" : "16px",
    } as CSSStyleDeclaration));
    const transformedRect = new DOMRect(100, 56, 200, 80);

    const normalized = rectWithoutAxisTransform(element, transformedRect);

    expect(normalized.left).toBeCloseTo(10);
    expect(normalized.top).toBeCloseTo(20);
    expect(normalized.width).toBeCloseTo(200);
    expect(normalized.height).toBeCloseTo(80);
  });

  it("retains non-default transform origins for the shared scene path", () => {
    expect(transformOriginFor({
      transform: "rotate(18deg)",
      transformOrigin: "left bottom",
    })).toBe("left bottom");
    expect(transformOriginFor({
      transform: "scale(1.2)",
      transformOrigin: "50% 50%",
    })).toBeUndefined();
    expect(transformOriginFor({
      transform: "none",
      transformOrigin: "left bottom",
    })).toBeUndefined();
  });

  it("normalizes a centered scale around transform-origin", () => {
    const element = document.createElement("div");
    element.style.transform = "scale(0.5)";
    element.style.transformOrigin = "50% 50%";
    document.body.append(element);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      transform: "matrix(0.5, 0, 0, 0.5, 0, 0)",
      transformOrigin: "50% 50%",
    } as CSSStyleDeclaration);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 50,
      top: 25,
      width: 100,
      height: 50,
      right: 150,
      bottom: 75,
      x: 50,
      y: 25,
      toJSON: () => ({}),
    } as DOMRect);

    const normalized = rectWithoutAxisTransform(element, element.getBoundingClientRect());

    expect(normalized.left).toBeCloseTo(0);
    expect(normalized.top).toBeCloseTo(0);
    expect(normalized.width).toBeCloseTo(200);
    expect(normalized.height).toBeCloseTo(100);
  });

  it("unwraps a rotated box before replaying its affine transform", () => {
    const element = document.createElement("div");
    document.body.append(element);
    const angle = Math.PI / 4;
    const a = Math.cos(angle);
    const b = Math.sin(angle);
    const c = -Math.sin(angle);
    const d = Math.cos(angle);
    const width = 100;
    const height = 60;
    const originX = 0;
    const originY = height;
    const translateX = 10;
    const translateY = 5;
    Object.defineProperties(element, {
      offsetWidth: { configurable: true, value: width },
      offsetHeight: { configurable: true, value: height },
    });
    const corners = [[0, 0], [width, 0], [0, height], [width, height]].map(([x, y]) => ({
      x: a * (x - originX) + c * (y - originY) + originX + translateX,
      y: b * (x - originX) + d * (y - originY) + originY + translateY,
    }));
    const left = Math.min(...corners.map((corner) => corner.x));
    const top = Math.min(...corners.map((corner) => corner.y));
    const right = Math.max(...corners.map((corner) => corner.x));
    const bottom = Math.max(...corners.map((corner) => corner.y));
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      transform: `matrix(${a}, ${b}, ${c}, ${d}, ${translateX}, ${translateY})`,
      transformOrigin: "0 60px",
    } as CSSStyleDeclaration);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left, top, width: right - left, height: bottom - top,
      right, bottom, x: left, y: top, toJSON: () => ({}),
    } as DOMRect);

    const normalized = rectWithoutAxisTransform(element, element.getBoundingClientRect());

    expect(normalized.left).toBeCloseTo(0);
    expect(normalized.top).toBeCloseTo(0);
    expect(normalized.width).toBeCloseTo(width);
    expect(normalized.height).toBeCloseTo(height);
  });

  it("resolves transform-origin keywords and functional relative lengths while unwrapping", () => {
    const element = document.createElement("div");
    element.style.transform = "rotate(20deg)";
    element.style.transformOrigin = "calc(50% - 1em) 1rem";
    element.style.fontSize = "20px";
    document.body.append(element);
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      transform: "matrix(0.9396926, 0.3420201, -0.3420201, 0.9396926, 0, 0)",
      transformOrigin: "calc(50% - 1em) 1rem",
      fontSize: "20px",
    } as CSSStyleDeclaration);
    vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 100,
      height: 100,
      right: 100,
      bottom: 100,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperties(element, {
      offsetWidth: { configurable: true, value: 100 },
      offsetHeight: { configurable: true, value: 100 },
    });

    const normalized = rectWithoutAxisTransform(element, element.getBoundingClientRect());
    expect(normalized.width).toBeGreaterThan(0);
    expect(normalized.height).toBeGreaterThan(0);
    // The functional origin resolves to x=30px and y=16px, so the recovered
    // box must differ from the default centered-origin envelope.
    expect(normalized.left).not.toBeCloseTo(0);
  });
});

describe("captured flex sizing intent", () => {
  it("retains Grid tracks, areas, auto tracks, and child placement", () => {
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.gridTemplateColumns = "120px 1fr";
    grid.style.gridTemplateRows = "auto 1fr";
    grid.style.gridTemplateAreas = '"nav main" "nav footer"';
    grid.style.gridAutoFlow = "row dense";
    grid.style.gridAutoRows = "minmax(40px, auto)";
    const child = document.createElement("div");
    child.style.gridArea = "main";

    expect(layoutFor(getComputedStyle(grid))).toMatchObject({
      gridTemplateColumns: "120px 1fr",
      gridTemplateRows: "auto 1fr",
      gridTemplateAreas: '"nav main" "nav footer"',
      gridAutoFlow: "row dense",
      gridAutoRows: "minmax(40px, auto)",
    });
    expect(layoutFor(getComputedStyle(child))).toMatchObject({ gridArea: "main" });
  });

  it("preserves reverse flex direction in the shared layout model", () => {
    const element = document.createElement("div");
    element.style.display = "flex";
    element.style.flexDirection = "row-reverse";
    expect(layoutFor(getComputedStyle(element)).mode).toBe("horizontal");
    expect(layoutFor(getComputedStyle(element)).reverse).toBe(true);

    const columnElement = document.createElement("div");
    columnElement.style.display = "flex";
    columnElement.style.flexDirection = "column-reverse";
    expect(layoutFor(getComputedStyle(columnElement)).mode).toBe("vertical");
    expect(layoutFor(getComputedStyle(columnElement)).reverse).toBe(true);
  });

  it("reverses horizontal flex order for RTL rows but not RTL columns", () => {
    const rtlRow = document.createElement("div");
    rtlRow.style.display = "flex";
    rtlRow.style.flexDirection = "row";
    rtlRow.style.direction = "rtl";
    document.body.append(rtlRow);

    const rtlRowReverse = document.createElement("div");
    rtlRowReverse.style.display = "flex";
    rtlRowReverse.style.flexDirection = "row-reverse";
    rtlRowReverse.style.direction = "rtl";
    document.body.append(rtlRowReverse);

    const rtlColumn = document.createElement("div");
    rtlColumn.style.display = "flex";
    rtlColumn.style.flexDirection = "column";
    rtlColumn.style.direction = "rtl";
    document.body.append(rtlColumn);

    expect(layoutFor(getComputedStyle(rtlRow), { element: rtlRow }).reverse).toBe(true);
    expect(layoutFor(getComputedStyle(rtlRowReverse), { element: rtlRowReverse }).reverse).toBeUndefined();
    expect(layoutFor(getComputedStyle(rtlColumn), { element: rtlColumn }).reverse).toBeUndefined();
  });


  it("maps flex axes through vertical writing modes", () => {
    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.flexDirection = "row";
    row.style.writingMode = "vertical-rl";
    document.body.append(row);
    expect(layoutFor(getComputedStyle(row), { element: row }).mode).toBe("vertical");

    const column = document.createElement("div");
    column.style.display = "flex";
    column.style.flexDirection = "column";
    column.style.writingMode = "vertical-lr";
    document.body.append(column);
    expect(layoutFor(getComputedStyle(column), { element: column }).mode).toBe("horizontal");

    row.remove();
    column.remove();
  });

  it("maps a margin-free block stack to vertical Auto Layout", () => {
    const container = document.createElement("section");
    const heading = document.createElement("h2");
    const body = document.createElement("p");
    heading.textContent = "Heading";
    body.textContent = "Body";
    heading.style.margin = "0";
    body.style.margin = "0";
    container.append(heading, body);
    document.body.append(container);

    expect(layoutFor(getComputedStyle(container), { element: container })).toMatchObject({
      mode: "vertical",
      widthMode: "fixed",
      heightMode: "fixed",
    });

    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ width: 320, height: 160 } as DOMRect);
    vi.spyOn(heading, "getBoundingClientRect").mockReturnValue({ width: 320, height: 32 } as DOMRect);
    const headingLayout = layoutFor(getComputedStyle(heading), { element: heading, rect: heading.getBoundingClientRect() });
    expect(headingLayout.widthMode).toBe("fill");
    expect(headingLayout.heightMode).toBe("hug");
  });

  it("keeps CSS size containment from becoming a content-driven HUG frame", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = [
      ".size-contained { contain: size; }",
      ".inline-size-contained { contain: inline-size; }",
      ".vertical-inline-size-contained { contain: inline-size; writing-mode: vertical-rl; }",
    ].join(" ");
    document.head.append(stylesheet);
    const sizeContained = document.createElement("section");
    sizeContained.className = "size-contained";
    const inlineSizeContained = document.createElement("section");
    inlineSizeContained.className = "inline-size-contained";
    const verticalInlineSizeContained = document.createElement("section");
    verticalInlineSizeContained.className = "vertical-inline-size-contained";
    document.body.append(sizeContained, inlineSizeContained, verticalInlineSizeContained);

    expect(layoutFor(getComputedStyle(sizeContained), { element: sizeContained })).toMatchObject({
      widthMode: "fixed",
      heightMode: "fixed",
    });
    expect(layoutFor(getComputedStyle(inlineSizeContained), { element: inlineSizeContained }).widthMode).toBe("fixed");
    expect(layoutFor(getComputedStyle(verticalInlineSizeContained), { element: verticalInlineSizeContained }).heightMode).toBe("fixed");

    sizeContained.remove();
    inlineSizeContained.remove();
    verticalInlineSizeContained.remove();
    stylesheet.remove();
  });

  it("honors an explicit Figma Auto Layout hint on a block-flow wrapper", () => {
    const container = document.createElement("section");
    container.setAttribute("data-figma-auto-layout", "horizontal");
    const first = document.createElement("div");
    const second = document.createElement("div");
    first.textContent = "First";
    second.textContent = "Second";
    container.append(first, second);
    document.body.append(container);

    // The browser may still render this wrapper as ordinary block flow. The
    // explicit export hint is nevertheless authoritative for the editable
    // Figma frame's Auto Layout direction.
    expect(layoutFor(getComputedStyle(container), { element: container }).mode).toBe("horizontal");
  });

  it("inherits HUG/FILL sizing inference from an explicit Auto Layout hint", () => {
    const container = document.createElement("section");
    container.setAttribute("data-figma-auto-layout", "horizontal");
    const child = document.createElement("div");
    container.append(child);
    document.body.append(container);
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({ width: 320, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 320, height: 48 } as DOMRect);

    expect(layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() })).toMatchObject({
      widthMode: "fill",
    });
  });

  it("keeps margin-bearing or inline-mixed blocks off the Auto Layout fast path", () => {
    const container = document.createElement("div");
    const first = document.createElement("div");
    const second = document.createElement("span");
    first.style.marginBottom = "8px";
    first.textContent = "First";
    second.textContent = "inline";
    container.append(first, second);
    document.body.append(container);

    expect(layoutFor(getComputedStyle(container), { element: container }).mode).toBe("none");
  });

  it("allows block margins when the parent establishes a vertical boundary", () => {
    const container = document.createElement("div");
    const first = document.createElement("div");
    const second = document.createElement("div");
    container.style.paddingTop = "12px";
    container.style.paddingBottom = "12px";
    first.style.marginBottom = "8px";
    first.textContent = "First";
    second.textContent = "Second";
    container.append(first, second);
    document.body.append(container);

    expect(layoutFor(getComputedStyle(container), { element: container }).mode).toBe("vertical");
  });

  it("keeps adjacent vertical margins with collapse semantics on the measured path", () => {
    const container = document.createElement("div");
    const first = document.createElement("div");
    const second = document.createElement("div");
    first.style.marginBottom = "8px";
    second.style.marginTop = "4px";
    first.textContent = "First";
    second.textContent = "Second";
    container.append(first, second);
    document.body.append(container);

    expect(layoutFor(getComputedStyle(container), { element: container }).mode).toBe("none");
  });

  it("infers fill on the main axis when a stylesheet-sized item spans the parent", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 320, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 320, height: 48 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fill");
  });

  it("keeps CSS initial sizing keywords HUG on the main axis", () => {
    for (const keyword of ["initial", "unset", "revert", "revert-layer"]) {
      const parent = document.createElement("div");
      parent.style.display = "flex";
      parent.style.flexDirection = "row";
      const child = document.createElement("div");
      child.style.width = keyword;
      parent.append(child);
      document.body.append(parent);
      vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 320, height: 80 } as DOMRect);
      vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 320, height: 48 } as DOMRect);

      const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

      expect(layout.widthMode, keyword).toBe("hug");
      parent.remove();
    }
  });

  it("preserves baseline alignment as an Auto Layout constraint", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.alignItems = "baseline";
    document.body.append(parent);

    expect(layoutFor(getComputedStyle(parent), { element: parent }).alignItems).toBe("baseline");
  });

  it("resolves Grid normal alignment to stretch", () => {
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.alignItems = "normal";
    grid.style.alignContent = "normal";
    grid.style.justifyItems = "normal";
    grid.style.justifySelf = "normal";
    document.body.append(grid);

    expect(layoutFor(getComputedStyle(grid), { element: grid }).alignItems).toBe("stretch");
    expect(layoutFor(getComputedStyle(grid), { element: grid }).justifyItems).toBe("stretch");
    expect(layoutFor(getComputedStyle(grid), { element: grid }).justifySelf).toBe("stretch");
    expect(layoutFor(getComputedStyle(grid), { element: grid }).alignContent).toBe("stretch");
  });

  it("preserves Grid justify-content stretch semantics", () => {
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.justifyContent = "normal";
    document.body.append(grid);
    expect(layoutFor(getComputedStyle(grid), { element: grid }).justifyContent).toBe("stretch");

    grid.style.justifyContent = "stretch";
    expect(layoutFor(getComputedStyle(grid), { element: grid }).justifyContent).toBe("stretch");
  });

  it("retains the authored place-content shorthand beside its resolved axes", () => {
    const layout = layoutFor({
      display: "grid",
      placeContent: "center space-between",
      getPropertyValue: (property: string) => property === "place-content" ? "center space-between" : "",
    } as unknown as CSSStyleDeclaration);

    expect(layout.placeContent).toBe("center space-between");
  });

  it("resolves Flex normal alignment to stretch", () => {
    const flex = document.createElement("div");
    flex.style.display = "flex";
    flex.style.alignItems = "normal";
    document.body.append(flex);

    expect(layoutFor(getComputedStyle(flex), { element: flex }).alignItems).toBe("stretch");
  });

  it("keeps flex wrap-reverse as a distinct layout constraint", () => {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexWrap = "wrap-reverse";
    document.body.append(container);

    expect(layoutFor(getComputedStyle(container), { element: container })).toMatchObject({
      wrap: true,
      wrapReverse: true,
    });
  });

  it("normalizes safe and unsafe alignment prefixes without falling back to start", () => {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.alignItems = "safe center";
    container.style.justifyContent = "unsafe center";
    document.body.append(container);

    expect(layoutFor(getComputedStyle(container), { element: container })).toMatchObject({
      alignItems: "center",
      justifyContent: "center",
    });
  });

  it("preserves self-start and self-end alignment constraints", () => {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.alignItems = "self-end";
    const child = document.createElement("div");
    child.style.alignSelf = "self-start";
    container.append(child);
    document.body.append(container);

    expect(layoutFor(getComputedStyle(container), { element: container }).alignItems).toBe("end");
    expect(layoutFor(getComputedStyle(child), { element: child }).alignSelf).toBe("start");
  });

  it("preserves Grid self-start and self-end inline alignment", () => {
    const grid = document.createElement("div");
    grid.style.display = "grid";
    grid.style.justifyItems = "self-end";
    const child = document.createElement("div");
    child.style.justifySelf = "self-start";
    grid.append(child);
    document.body.append(grid);

    expect(layoutFor(getComputedStyle(grid), { element: grid }).justifyItems).toBe("end");
    expect(layoutFor(getComputedStyle(child), { element: child }).justifySelf).toBe("start");
  });

  it("recognizes CSS multi-column constraints for measured replay", () => {
    expect(hasMultiColumnLayout({ columnCount: "auto", columnWidth: "auto" })).toBe(false);
    expect(hasMultiColumnLayout({ columnCount: "2", columnWidth: "auto" })).toBe(true);
    expect(hasMultiColumnLayout({ columnCount: "auto", columnWidth: "240px" })).toBe(true);
  });

  it("recognizes dense grid auto-flow as a non-native packing constraint", () => {
    expect(hasDenseGridAutoFlow({ gridAutoFlow: "row dense" } as CSSStyleDeclaration)).toBe(true);
    expect(hasDenseGridAutoFlow({ gridAutoFlow: "column" } as CSSStyleDeclaration)).toBe(false);
  });

  it("infers fill on the stretched cross axis and hug on an auto main axis", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "column";
    parent.style.alignItems = "stretch";
    const child = document.createElement("div");
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 320, height: 500 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 320, height: 48 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fill");
    expect(layout.heightMode).toBe("hug");
  });

  it("subtracts flex-item margins when inferring fill sizing", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.style.marginLeft = "10px";
    child.style.marginRight = "10px";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 320, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 300, height: 48 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fill");
  });

  it("keeps partial stylesheet percentage sizing fixed while retaining the authored expression", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 400, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 200, height: 48 } as DOMRect);
    Object.defineProperty(child, "computedStyleMap", {
      configurable: true,
      value: () => ({
        get: (property: string) => property === "width"
          ? { unit: "percent", value: 50, toString: () => "50%" }
          : { toString: () => "auto" },
      }),
    });

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(child.style.width).toBe("");
    expect(layout.widthMode).toBe("fixed");
    expect(layout.widthExpression).toBe("50%");
    expect(layout.heightMode).toBe("fixed");
  });

  it("maps a full stylesheet percentage to Fill through CSS Typed OM", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 400, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 400, height: 48 } as DOMRect);
    Object.defineProperty(child, "computedStyleMap", {
      configurable: true,
      value: () => ({
        get: (property: string) => property === "width"
          ? { unit: "percent", value: 100, toString: () => "100%" }
          : { toString: () => "auto" },
      }),
    });

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fill");
    expect(layout.widthExpression).toBe("100%");
  });

  it("recovers viewport sizing from a matching stylesheet rule when Typed OM collapses it to px", () => {
    const style = document.createElement("style");
    style.textContent = ".viewport-sized { width: 100vw; }";
    document.head.append(style);
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.className = "viewport-sized";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 400, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 400, height: 48 } as DOMRect);
    Object.defineProperty(child, "computedStyleMap", {
      configurable: true,
      value: () => ({
        get: (property: string) => property === "width"
          ? { unit: "px", value: 1024, toString: () => "1024px" }
          : { toString: () => "auto" },
      }),
    });

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fixed");
    expect(layout.widthExpression).toBe("100vw");
  });

  it("keeps small/large/dynamic min/max viewport sizing fixed", () => {
    const style = document.createElement("style");
    style.textContent = ".viewport-min-sized { width: 50svmin; }";
    document.head.append(style);
    const parent = document.createElement("div");
    parent.style.display = "flex";
    const child = document.createElement("div");
    child.className = "viewport-min-sized";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 400, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 400, height: 48 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fixed");
    expect(layout.widthExpression).toBe("50svmin");
    style.remove();
    parent.remove();
  });

  it("keeps stylesheet fixed sizing Fixed through CSS Typed OM", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 400, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 160, height: 48 } as DOMRect);
    Object.defineProperty(child, "computedStyleMap", {
      configurable: true,
      value: () => ({
        get: (property: string) => property === "width"
          ? { unit: "px", value: 160, toString: () => "160px" }
          : { toString: () => "auto" },
      }),
    });

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fixed");
    expect(layout.heightMode).toBe("fixed");
  });

  it("keeps explicitly sized flex items fixed", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.style.width = "40px";
    child.style.height = "12px";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 320, height: 500 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 40, height: 12 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fixed");
    expect(layout.heightMode).toBe("fixed");
  });

  it("keeps a fixed flex-basis fixed when the item does not grow", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.style.flexBasis = "40px";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 320, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 40, height: 48 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fixed");
  });

  it("maps intrinsic flex-basis keywords to Figma HUG", () => {
    for (const basis of ["min-content", "max-content", "fit-content"]) {
      const parent = document.createElement("div");
      parent.style.display = "flex";
      parent.style.flexDirection = "row";
      const child = document.createElement("div");
      child.style.flexBasis = basis;
      parent.append(child);
      document.body.append(parent);
      vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 320, height: 80 } as DOMRect);
      vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 96, height: 48 } as DOMRect);

      const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

      expect(layout.widthMode, basis).toBe("hug");
      parent.remove();
    }
  });

  it("prioritizes an explicit intrinsic flex-basis over a width fallback", () => {
    for (const basis of ["content", "min-content", "max-content"]) {
      const parent = document.createElement("div");
      parent.style.display = "flex";
      parent.style.flexDirection = "row";
      const child = document.createElement("div");
      child.style.width = "200px";
      child.style.flexBasis = basis;
      parent.append(child);
      document.body.append(parent);
      vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
      vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 200, height: 48 } as DOMRect);

      const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

      expect(layout.widthMode, basis).toBe("hug");
      parent.remove();
    }
  });

  it("keeps parameterized fit-content flex-basis on the fixed path", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.style.width = "200px";
    child.style.flexBasis = "fit-content(240px)";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 640, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 200, height: 48 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fixed");
    parent.remove();
  });

  it("keeps percentage flex-basis fixed while retaining its authored metadata", () => {
    const parent = document.createElement("div");
    parent.style.display = "flex";
    parent.style.flexDirection = "row";
    const child = document.createElement("div");
    child.style.flexBasis = "50%";
    parent.append(child);
    document.body.append(parent);
    vi.spyOn(parent, "getBoundingClientRect").mockReturnValue({ width: 320, height: 80 } as DOMRect);
    vi.spyOn(child, "getBoundingClientRect").mockReturnValue({ width: 160, height: 48 } as DOMRect);

    const layout = layoutFor(getComputedStyle(child), { element: child, rect: child.getBoundingClientRect() });

    expect(layout.widthMode).toBe("fixed");
  });

  it("resolves percentage row and column gaps against the container content box", () => {
    const container = document.createElement("div");
    container.style.display = "grid";
    container.style.gap = "10% 5%";
    container.style.padding = "10px 20px";
    container.style.border = "2px solid transparent";

    const layout = layoutFor(getComputedStyle(container), {
      element: container,
      rect: { width: 420, height: 220 } as DOMRect,
    });

    // Content box: 420 - 40 padding - 4 border = 376 wide;
    // 220 - 20 padding - 4 border = 196 high.
    expect(layout.gap).toBeCloseTo(19.6);
    expect(layout.rowGap).toBeCloseTo(19.6);
    expect(layout.columnGap).toBeCloseTo(18.8);
    expect(layout.gapExpression).toBe("10% 5%");
    expect(layout.rowGapExpression).toBe("10%");
    expect(layout.columnGapExpression).toBe("5%");
  });

  it("keeps flex row and column gap semantics in vertical writing mode", () => {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.writingMode = "vertical-rl";
    container.style.flexDirection = "row";
    container.style.gap = "8px 20px";

    const layout = layoutFor(getComputedStyle(container), {
      element: container,
      rect: { width: 320, height: 200 } as DOMRect,
    });

    // Flex row follows the inline axis (vertical here), but CSS still uses
    // column-gap for spacing between items and row-gap between flex lines.
    expect(layout.mode).toBe("vertical");
    expect(layout.rowGap).toBe(8);
    expect(layout.columnGap).toBe(20);
  });

  it("resolves vertical-writing gap percentages against block and inline axes", () => {
    const container = document.createElement("div");
    container.style.display = "grid";
    container.style.writingMode = "vertical-rl";
    container.style.gap = "10% 5%";

    const layout = layoutFor(getComputedStyle(container), {
      element: container,
      rect: { width: 320, height: 200 } as DOMRect,
    });

    // In vertical writing, the block axis is physical width and the inline
    // axis is physical height. Grid row/column percentages follow those axes.
    expect(layout.rowGap).toBeCloseTo(32);
    expect(layout.columnGap).toBeCloseTo(10);
  });

  it("keeps an explicit zero row-gap instead of falling back to shorthand gap", () => {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.gap = "12px";
    container.style.rowGap = "0px";
    container.style.columnGap = "12px";

    const layout = layoutFor(getComputedStyle(container), {
      element: container,
      rect: { width: 320, height: 120 } as DOMRect,
    });

    expect(layout.rowGap).toBe(0);
    expect(layout.columnGap).toBe(12);
    expect(layout.rowGapExpression).toBe("0px");
    expect(layout.columnGapExpression).toBe("12px");
  });

  it("resolves functional gap expressions without truncating calc values", () => {
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.flexDirection = "column";
    container.style.gap = "calc(10% + 4px)";

    const layout = layoutFor(getComputedStyle(container), {
      element: container,
      rect: { width: 320, height: 200 } as DOMRect,
    });

    expect(layout.gap).toBeCloseTo(24);
    expect(layout.rowGap).toBeCloseTo(24);
    expect(layout.columnGap).toBeCloseTo(36);
    expect(layout.gapExpression).toBe("calc(10% + 4px)");
    expect(layout.rowGapExpression).toBe("calc(10% + 4px)");
    expect(layout.columnGapExpression).toBe("calc(10% + 4px)");
  });

  it("resolves font-relative gap units from the container and root font sizes", () => {
    const root = document.documentElement;
    root.style.fontSize = "18px";
    const container = document.createElement("div");
    container.style.display = "flex";
    container.style.gap = "1.5em 2rem";
    container.style.fontSize = "20px";

    const layout = layoutFor(getComputedStyle(container), {
      element: container,
      rect: { width: 320, height: 200 } as DOMRect,
      rootFontSize: 18,
    });

    expect(layout.rowGap).toBeCloseTo(30);
    expect(layout.columnGap).toBeCloseTo(36);
    root.style.fontSize = "";
  });

  it("retains authored stylesheet gap expressions instead of only computed pixels", () => {
    const stylesheet = document.createElement("style");
    stylesheet.textContent = ".responsive-gap { display: flex; gap: calc(10% + 4px) 5%; }";
    document.head.append(stylesheet);
    const container = document.createElement("div");
    container.className = "responsive-gap";
    document.body.append(container);

    const layout = layoutFor(getComputedStyle(container), {
      element: container,
      rect: { width: 320, height: 200 } as DOMRect,
    });

    expect(layout.gapExpression).toBe("calc(10% + 4px) 5%");
    expect(layout.rowGapExpression).toBe("calc(10% + 4px)");
    expect(layout.columnGapExpression).toBe("5%");
    stylesheet.remove();
    container.remove();
  });
});
