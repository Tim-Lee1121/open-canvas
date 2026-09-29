import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { toH2D } from "../src/figma/h2d";

function loadPluginFunctions(options = {}) {
  const code = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "code.js"), "utf8");
  let imageSequence = 0;
  const context = {
    __html__: "",
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    setTimeout: options.setTimeout || globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    figma: {
      showUI() {},
      ui: { onmessage: null },
      createImage() {
        imageSequence += 1;
        return { hash: `image-${imageSequence}` };
      },
      currentPage: { selection: [], children: [] },
    },
  };
  vm.runInNewContext(code, context, { filename: "figma-plugin/code.js" });
  return context;
}

function mockFigmaNode(type, sequence) {
  const pluginData = new Map();
  const node = {
    type,
    name: "",
    children: [],
    parent: null,
    fills: [],
    strokes: [],
    effects: [],
    strokeWeight: 0,
    strokeAlign: "INSIDE",
    strokeTopWeight: 0,
    strokeRightWeight: 0,
    strokeBottomWeight: 0,
    strokeLeftWeight: 0,
    dashPattern: [],
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    opacity: 1,
    visible: true,
    blendMode: "NORMAL",
    layoutMode: "NONE",
    itemSpacing: 0,
    primaryAxisAlignItems: "MIN",
    counterAxisAlignItems: "MIN",
    layoutWrap: "NO_WRAP",
    counterAxisSpacing: 0,
    counterAxisAlignContent: "AUTO",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
    layoutPositioning: "IN_FLOW",
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "FIXED",
    layoutGrow: 0,
    layoutAlign: "INHERIT",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    clipsContent: false,
    strokesIncludedInLayout: false,
    isMask: false,
    maskType: "VECTOR",
    constraints: { horizontal: "MIN", vertical: "MIN" },
    topLeftRadius: 0,
    topRightRadius: 0,
    bottomRightRadius: 0,
    bottomLeftRadius: 0,
    lineHeight: { unit: "PIXELS", value: 16 },
    textDecoration: "NONE",
    textTruncation: "DISABLED",
    maxLines: 0,
    constrainProportions: false,
    setPluginData(key, value) {
      pluginData.set(key, value);
    },
    getPluginData(key) {
      return pluginData.get(key) || "";
    },
    resize(width, height) {
      this.width = width;
      this.height = height;
    },
    appendChild(child) {
      child.parent = this;
      this.children.push(child);
    },
    insertChild(index, child) {
      if (child.parent) {
        const previousIndex = child.parent.children.indexOf(child);
        if (previousIndex >= 0) child.parent.children.splice(previousIndex, 1);
      }
      child.parent = this;
      this.children.splice(index, 0, child);
    },
    clone() {
      const copy = mockFigmaNode(this.type, sequence);
      Object.assign(copy, this, { children: [], parent: null });
      return copy;
    },
  };
  return node;
}

function importReport() {
  return {
    geometryLocks: 0,
    geometryLockNodes: [],
    flowNudges: 0,
    maxFlowNudge: 0,
    flowNudgeNodes: [],
    geometryResizes: 0,
    geometryResizeNodes: [],
    styleDegradations: 0,
    styleDegradationNodes: [],
    fontFallbacks: 0,
    fontFallbackNodes: [],
    lineHeightApplied: 0,
    lineHeightNodes: [],
    lineHeightReadBackNodes: [],
    lineHeightFailures: 0,
    lineHeightFailureNodes: [],
    lineHeightFallbacks: 0,
    clipPathFallbacks: 0,
    maskImageFallbacks: 0,
    textFilterFallbacks: 0,
    textOverflowFallbacks: 0,
    textShapingFallbacks: 0,
    writingModeFallbacks: 0,
    lineHeightExpected: 0,
  };
}

describe("capture diagnostic classification", () => {
  it("separates preserved vector fallbacks from actual warnings", () => {
    const context = loadPluginFunctions();
    const backgroundFallback = {
      code: "background-svg-fallback",
      nodeId: "gradient-card",
      message: "Complex CSS background layers were preserved as an inline SVG asset for Figma",
    };
    const warning = {
      code: "style-degraded",
      nodeId: "sticky-nav",
      message: "position sticky is captured at the current viewport position",
    };

    expect(context.classifyCapturedDiagnostics([backgroundFallback, warning])).toEqual({
      total: 2,
      warnings: 1,
      warningNodes: [warning],
      visualFallbacks: 1,
      visualFallbackNodes: [backgroundFallback],
    });
  });

  it("treats an empty or malformed diagnostic payload as clean", () => {
    const context = loadPluginFunctions();
    expect(context.classifyCapturedDiagnostics(undefined)).toEqual({
      total: 0,
      warnings: 0,
      warningNodes: [],
      visualFallbacks: 0,
      visualFallbackNodes: [],
    });
  });
});

describe("Figma background paint order", () => {
  it("keeps one resource per image-set background layer", () => {
    const context = loadPluginFunctions();

    expect(context.cssImageUrls(
      'image-set(url("low.png") 1x, url("high.png") 2x), url("overlay.png")',
    )).toEqual(["low.png", "overlay.png"]);
  });

  it("selects the first density at DPR 1 and the next density at DPR 1.5", () => {
    const context = loadPluginFunctions();
    const imageSet = 'image-set(url("low.png") 1x, url("high.png") 2x)';

    expect(context.cssImageUrls(imageSet, 1)).toEqual(["low.png"]);
    expect(context.cssImageUrls(imageSet, 1.5)).toEqual(["high.png"]);
    expect(context.normalizeImageSetCandidates(imageSet, 1.5)).toBe('url("high.png")');
  });

  it("uses the highest available density when capture DPR exceeds all candidates", () => {
    const context = loadPluginFunctions();
    expect(context.cssImageUrls(
      'image-set(url("low.png") 1x, url("high.png") 2x)',
      3,
    )).toEqual(["high.png"]);
  });

  it("keeps the first candidate when image-set has no density descriptors", () => {
    const context = loadPluginFunctions();
    expect(context.cssImageUrls(
      'image-set(url("first.png"), url("second.png"))',
      2,
    )).toEqual(["first.png"]);
  });

  it("treats an omitted density descriptor as the CSS 1x candidate", () => {
    const context = loadPluginFunctions();
    const imageSet = 'image-set(url("default.png"), url("retina.png") 2x)';

    expect(context.cssImageUrls(imageSet, 1)).toEqual(["default.png"]);
    expect(context.cssImageUrls(imageSet, 2)).toEqual(["retina.png"]);
  });

  it("decodes URL-encoded SVG data assets without treating them as base64", () => {
    const context = loadPluginFunctions();
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="8"><rect width="12" height="8" fill="red"/></svg>';
    const bytes = context.assetBytes({
      kind: "svg",
      data: `data:image/svg+xml,${encodeURIComponent(svg)}`,
    });

    expect(bytes).toBeTruthy();
    expect(new globalThis.TextDecoder().decode(Uint8Array.from(bytes))).toBe(svg);
  });

  it("keeps base64 data asset decoding unchanged", () => {
    const context = loadPluginFunctions();
    const bytes = context.assetBytes({
      kind: "svg",
      data: `data:image/svg+xml;base64,${globalThis.btoa("<svg/>")}`,
    });

    expect(new globalThis.TextDecoder().decode(bytes)).toBe("<svg/>");
  });

  it("imports captured SVG background assets as vector overlays", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.layoutMode = "VERTICAL";
    frame.resize(120, 80);
    const vector = mockFigmaNode("VECTOR");
    context.figma.createNodeFromSvg = svg => {
      expect(svg).toContain("<linearGradient");
      return vector;
    };
    const report = importReport();
    context.backgroundImage(frame, {
      id: "gradient-card",
      rect: { width: 120, height: 80 },
      backgroundAssetId: "asset-gradient",
      backgroundImage: "url(data:image/svg+xml;base64,ZmFrZQ==)",
      computedStyles: {},
    }, [{
      id: "asset-gradient",
      kind: "svg",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg><linearGradient id="g"/></svg>')}`,
    }], { images: new Map(), vectors: new Map() }, report);

    expect(frame.fills).toEqual([]);
    expect(frame.children).toContain(vector);
    expect(vector.name).toBe("__css-background-svg-gradient-card");
    expect(vector.layoutPositioning).toBe("ABSOLUTE");
    expect(vector.width).toBe(120);
    expect(vector.height).toBe(80);
    expect(report.styleDegradations).toBe(0);
  });

  it("keeps legacy pure-gradient SVG assets on native editable fills", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    frame.fills = context.gradientPaints("linear-gradient(90deg, #f00, #00f)", 120, 80);
    context.figma.createNodeFromSvg = () => {
      throw new Error("pure gradients must not be replaced by an SVG asset");
    };
    context.backgroundImage(frame, {
      id: "legacy-pure-gradient",
      rect: { width: 120, height: 80 },
      backgroundAssetId: "asset-gradient",
      backgroundImage: "linear-gradient(90deg, #f00, #00f)",
      gradient: "linear-gradient(90deg, #f00, #00f)",
      computedStyles: {},
    }, [{
      id: "asset-gradient",
      kind: "svg",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg><linearGradient id="g"/></svg>')}`,
    }], { images: new Map(), vectors: new Map() }, importReport());

    expect(frame.children).toHaveLength(0);
    expect(frame.fills.some(paint => String(paint.type || "").startsWith("GRADIENT"))).toBe(true);
  });

  it("clips vector background overlays to the captured corner radii", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.layoutMode = "VERTICAL";
    frame.resize(120, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    context.backgroundImage(frame, {
      id: "rounded-gradient-card",
      rect: { width: 120, height: 80 },
      radius: [16, 12, 8, 4],
      backgroundAssetId: "asset-gradient-rounded",
      backgroundImage: "url(data:image/svg+xml;base64,ZmFrZQ==)",
      computedStyles: {},
    }, [{
      id: "asset-gradient-rounded",
      kind: "svg",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg><linearGradient id="g"/></svg>')}`,
    }], { images: new Map(), vectors: new Map() }, importReport());
    expect(capturedSvg).toContain('<clipPath id="clip"><path d="M 16 0');
    expect(capturedSvg).toContain('clip-path="url(#clip)"');
  });

  it("keeps a legacy pure-gradient card on native editable fills", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const page = mockFigmaNode("PAGE");
    const asset = {
      id: "arena-gradient",
      kind: "svg",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg xmlns="http://www.w3.org/2000/svg" width="343" height="222"><defs><linearGradient id="g"/></defs><rect width="343" height="222" fill="url(#g)"/></svg>')}`,
    };
    const card = await context.createNode({
      id: "arena-card",
      type: "frame",
      rect: { x: 16, y: 85, width: 343, height: 222 },
      opacity: 1,
      fill: { color: "rgb(58, 0, 26)" },
      radius: [22, 22, 22, 22],
      margin: [0, 0, 0, 0],
      backgroundAssetId: "arena-gradient",
      backgroundImage: "linear-gradient(135deg, rgba(58,0,26,.96), rgba(91,23,53,.82)), radial-gradient(circle at 80% 15%, rgb(215,170,102), transparent 30%)",
      computedStyles: { display: "flex", flexDirection: "column", overflowX: "hidden", overflowY: "hidden" },
      layout: { mode: "vertical", gap: 0, padding: [22, 22, 22, 22], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [{
        id: "arena-content",
        type: "frame",
        rect: { x: 22, y: 22, width: 261, height: 129 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        zIndex: 1,
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
        children: [],
      }, {
        id: "arena-card-after",
        type: "frame",
        pseudo: "after",
        positioning: "absolute",
        rect: { x: 166, y: 75, width: 210, height: 210 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "absolute" },
        children: [],
      }],
    }, page, [asset], importReport(), undefined, { images: new Map(), vectors: new Map() });

    expect(card.children.map(child => child.name)).toEqual([
      "arena-card-after",
      "arena-content",
    ]);
    expect(card.fills.some(paint => String(paint.type || "").startsWith("GRADIENT"))).toBe(true);
    expect(capturedSvg).toBe("");
  });

  it("recreates a single gradient mask as an editable vector mask", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };

    const applied = context.applyMaskImage(frame, {
      id: "fade-panel",
      type: "frame",
      rect: { width: 160, height: 80 },
      fill: { color: "#ffffff", opacity: 1 },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000000)",
        maskPosition: "0% 0%",
        maskSize: "auto",
        maskRepeat: "repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "match-source",
      },
    });

    expect(applied).toBe(true);
    expect(frame.children[0].isMask).toBe(true);
    expect(frame.children[0].maskType).toBe("ALPHA");
    expect(frame.children[0].name).toBe("__css-mask-image");
    expect(frame.children[1].name).toBe("__css-mask-background-fade-panel");
    expect(frame.fills).toEqual([]);
    expect(svgs[0]).toContain("cssMaskGradient");
    expect(svgs[0]).toContain('stop-opacity="0"');
    expect(frame.getPluginData("open-canvas-mask-image")).toContain("linear-gradient");
  });

  it("preserves positioned, sized, and axis-repeating gradient masks", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    expect(context.applyMaskImage(frame, {
      id: "positioned-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(to bottom, transparent, #000)",
        maskPosition: "right 10px bottom 5px",
        maskSize: "80px 40px",
        maskRepeat: "repeat-x",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    })).toBe(true);
    expect(capturedSvg).toContain("cssMaskPattern");
    expect(capturedSvg).toContain('width="80" height="40"');
  });

  it("resolves font and viewport relative mask size and position values", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(200, 100);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };

    expect(context.applyMaskImage(frame, {
      id: "relative-gradient-mask",
      type: "frame",
      rect: { width: 200, height: 100 },
      rootFontSize: 16,
      viewportWidth: 1000,
      viewportHeight: 800,
      text: { fontSize: 20 },
      computedStyles: {
        fontSize: "20px",
        maskImage: "linear-gradient(90deg, transparent, #fff)",
        maskSize: "1em 10vw",
        maskPosition: "right 1em bottom 10%",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    })).toBe(true);
    expect(capturedSvg).toContain('<rect x="160" y="0" width="20" height="100"');
  });

  it("keeps calc expressions intact while resolving gradient mask size", () => {
    const context = loadPluginFunctions();

    expect(context.maskGradientSize("calc(50% - 1rem) 2em", 200, 100, {
      fontSize: 20,
      rootFontSize: 16,
      viewportWidth: 1000,
      viewportHeight: 800,
    })).toEqual({ width: 84, height: 40 });
  });

  it("supports CSS mask round and space repeat geometry", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };

    expect(context.applyMaskImage(frame, {
      id: "round-space-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #000)",
        maskPosition: "left top",
        maskSize: "50px 30px",
        maskRepeat: "round space",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    })).toBe(true);
    // `round` adjusts 50px tiles to divide 160px into three columns;
    // `space` keeps two 30px rows and distributes the remaining 20px.
    expect(capturedSvg).toContain("cssMaskPattern-0");
    expect(capturedSvg).toMatch(/width="53\.333/);
    expect(capturedSvg).toContain('height="50"');
  });

  it("recreates conic gradient masks as editable vector sectors", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };

    expect(context.applyMaskImage(frame, {
      id: "conic-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "conic-gradient(from 45deg at 25% 60%, transparent 0deg, #000 180deg, transparent 360deg)",
        maskPosition: "0% 0%",
        maskSize: "auto",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    })).toBe(true);
    expect(frame.children[0].name).toBe("__css-mask-image");
    expect(capturedSvg).toContain("<path");
    expect(capturedSvg).toContain("M 40 48");
    expect(capturedSvg).not.toContain("cssMaskGradient-0");
  });

  it("preserves repeating conic masks with round and space tile geometry", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };

    expect(context.applyMaskImage(frame, {
      id: "repeating-conic-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "repeating-conic-gradient(from 20deg, transparent 0deg, #000 45deg, transparent 90deg)",
        maskPosition: "left top",
        maskSize: "50px 30px",
        maskRepeat: "round space",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    })).toBe(true);
    expect(capturedSvg).toContain("cssMaskPattern-0");
    expect(capturedSvg).toMatch(/<g transform="translate\(0 0\)"><path d="M 26\.666/);
    expect(capturedSvg).toMatch(/width="53\.333/);
    expect(capturedSvg).toContain('height="50"');
  });

  it("maps CSS luminance masks to the Figma luminance mask type", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");

    expect(context.applyMaskImage(frame, {
      id: "luminance-mask",
      type: "frame",
      rect: { width: 120, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(90deg, #000, #fff)",
        maskMode: "luminance",
        maskRepeat: "no-repeat",
      },
    })).toBe(true);
    expect(frame.children[0].isMask).toBe(true);
    expect(frame.children[0].maskType).toBe("LUMINANCE");
  });

  it("normalizes mixed alpha and luminance mask layers into an editable alpha fallback", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "mixed-mode-mask",
      type: "frame",
      rect: { width: 120, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #000), radial-gradient(circle, #fff, #000)",
        maskMode: "alpha, luminance",
      },
    };
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    expect(context.applyMaskImage(frame, scene)).toBe(true);
    expect(frame.children[0].isMask).toBe(true);
    expect(frame.children[0].maskType).toBe("ALPHA");
    expect(capturedSvg).toContain("cssMaskLuminance-1");
    expect(capturedSvg).toContain('mask-type="luminance"');

    const report = importReport();
    context.recordSceneDegradations(scene, report, []);
    expect(report.styleDegradations).toBe(0);
  });

  it("supports space repeat for URL mask layers", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const asset = {
      id: "space-mask-asset",
      src: "https://example.test/space-mask.png",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    };
    expect(context.applyMaskImage(frame, {
      id: "space-url-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "url(https://example.test/space-mask.png)",
        maskSize: "40px 20px",
        maskRepeat: "space",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    }, [asset])).toBe(true);
    expect(capturedSvg).toContain("cssMaskImagePattern");
    expect(capturedSvg).toContain('width="40" height="20"');
  });

  it("keeps mask-position when space repeat fits only one tile", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(100, 60);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    expect(context.applyMaskImage(frame, {
      id: "single-space-mask",
      type: "frame",
      rect: { width: 100, height: 60 },
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #000)",
        maskPosition: "right 10px bottom 5px",
        maskSize: "80px 50px",
        maskRepeat: "space",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    })).toBe(true);
    expect(capturedSvg).not.toContain("cssMaskPattern-0");
    expect(capturedSvg).toContain('<rect x="10" y="5" width="80" height="50"');
  });

  it("recreates multiple gradient mask layers with per-layer geometry", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };

    expect(context.applyMaskImage(frame, {
      id: "multi-gradient-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000), radial-gradient(circle, #000, transparent)",
        maskPosition: "0% 0%, 20px 10px",
        maskSize: "auto, 80px 40px",
        maskRepeat: "no-repeat, repeat-x",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "match-source",
      },
    })).toBe(true);
    expect(frame.children[0].name).toBe("__css-mask-image");
    expect(capturedSvg).toContain("cssMaskGradient-0");
    expect(capturedSvg).toContain("cssMaskGradient-1");
    expect(capturedSvg).toContain("cssMaskPattern-1");
    expect(capturedSvg).toContain('width="80" height="40"');
  });

  it("recreates an additive mixed gradient and URL mask with per-layer geometry", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const asset = {
      id: "mixed-mask-alpha",
      src: "https://example.test/mask.png",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    };
    const scene = {
      id: "mixed-mask-panel",
      type: "frame",
      rect: { width: 160, height: 80 },
      borders: [{ width: 2 }, { width: 4 }, { width: 6 }, { width: 8 }],
      layout: { padding: [4, 6, 8, 10] },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000), url(https://example.test/mask.png)",
        maskPosition: "0% 0%, 20px 10px",
        maskSize: "auto, 80px 40px",
        maskRepeat: "no-repeat, repeat-x",
        maskComposite: "add",
        maskClip: "border-box, content-box",
        maskOrigin: "border-box, padding-box",
        maskMode: "match-source",
      },
    };
    expect(context.applyMaskImage(frame, scene, [asset])).toBe(true);
    expect(frame.children[0].name).toBe("__css-mask-image");
    expect(capturedSvg).toContain("cssMaskGradient-0");
    expect(capturedSvg).toContain("cssMaskPattern-1");
    expect(capturedSvg).toContain("cssMaskClip-1");
    expect(capturedSvg).toContain("M 18 6 H 150");
    expect(capturedSvg).toContain("<image");
  });

  it("preserves intrinsic ratio for URL mask auto dimensions", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const asset = {
      id: "intrinsic-mask",
      src: "https://example.test/mask.svg",
      data: "data:image/svg+xml;base64," + globalThis.btoa('<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="100"/></svg>'),
    };
    expect(context.applyMaskImage(frame, {
      id: "intrinsic-mask-panel",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "url(https://example.test/mask.svg)",
        maskSize: "80px auto",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    }, [asset])).toBe(true);
    expect(capturedSvg).toContain('width="80" height="40"');
  });

  it("resolves calc and font-relative size values for URL masks", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(200, 100);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const asset = {
      id: "relative-url-mask",
      src: "https://example.test/relative-mask.svg",
      data: "data:image/svg+xml;base64," + globalThis.btoa('<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="100"/></svg>'),
    };

    expect(context.applyMaskImage(frame, {
      id: "relative-url-mask-panel",
      type: "frame",
      rect: { width: 200, height: 100 },
      rootFontSize: 16,
      viewportWidth: 1000,
      viewportHeight: 800,
      text: { fontSize: 20 },
      computedStyles: {
        fontSize: "20px",
        maskImage: "url(https://example.test/relative-mask.svg)",
        maskSize: "calc(50% - 1rem) 2em",
        maskPosition: "left top",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    }, [asset])).toBe(true);
    expect(capturedSvg).toContain('<image href="data:image/svg+xml;base64,');
    expect(capturedSvg).toContain('x="0" y="0" width="84" height="40"');
  });

  it("maps URL mask cover and contain to intrinsic-ratio dimensions", () => {
    const context = loadPluginFunctions();
    const asset = {
      id: "ratio-mask",
      src: "https://example.test/ratio-mask.svg",
      data: "data:image/svg+xml;base64," + globalThis.btoa('<svg width="200" height="100" xmlns="http://www.w3.org/2000/svg"><rect width="200" height="100"/></svg>'),
    };
    for (const [maskSize, expected] of [["cover", 'width="240" height="120"'], ["contain", 'width="160" height="80"']]) {
      const frame = mockFigmaNode("FRAME");
      frame.resize(160, 120);
      let capturedSvg = "";
      context.figma.createNodeFromSvg = svg => {
        capturedSvg = svg;
        return mockFigmaNode("VECTOR");
      };
      expect(context.applyMaskImage(frame, {
        id: `ratio-${maskSize}`,
        type: "frame",
        rect: { width: 160, height: 120 },
        computedStyles: {
          maskImage: "url(https://example.test/ratio-mask.svg)",
          maskSize,
          maskRepeat: "no-repeat",
          maskClip: "border-box",
          maskOrigin: "border-box",
          maskMode: "alpha",
        },
      }, [asset])).toBe(true);
      expect(capturedSvg).toContain(expected);
    }
  });

  it("aligns URL masks to padding/content boxes and clips the mask bounds", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 120);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const asset = {
      id: "box-mask",
      src: "https://example.test/box-mask.svg",
      data: "data:image/svg+xml;base64," + globalThis.btoa('<svg width="100" height="60" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="60"/></svg>'),
    };
    expect(context.applyMaskImage(frame, {
      id: "box-mask-panel",
      type: "frame",
      rect: { width: 160, height: 120 },
      borders: [{ width: 4 }, { width: 6 }, { width: 8 }, { width: 10 }],
      layout: { padding: [12, 14, 16, 18] },
      computedStyles: {
        maskImage: "url(https://example.test/box-mask.svg)",
        maskPosition: "0% 0%",
        maskSize: "100% 100%",
        maskRepeat: "no-repeat",
        maskClip: "content-box",
        maskOrigin: "padding-box",
        maskMode: "alpha",
      },
    }, [asset])).toBe(true);
    expect(capturedSvg).toContain('x="10" y="4"');
    expect(capturedSvg).toContain('width="144" height="108"');
    expect(capturedSvg).toContain('M 28 16 H 140');
    expect(capturedSvg).toContain('V 96');
  });

  it("does not report an inlined additive mixed gradient and URL mask as a degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "mixed-mask-diagnostic",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000), url(https://example.test/mask.png)",
        maskPosition: "0% 0%, 20px 10px",
        maskSize: "auto, 80px 40px",
        maskRepeat: "no-repeat, repeat-x",
        maskComposite: "add",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "match-source",
      },
    }, report, [{
      id: "mixed-mask-alpha",
      src: "https://example.test/mask.png",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    }]);
    expect(report.styleDegradationNodes.some(node => node.message.includes("mask-image"))).toBe(false);
  });

  it("recreates a readable URL mask as an editable vector mask", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const asset = {
      id: "mask-alpha",
      src: "https://example.test/mask.png",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    };
    const scene = {
      id: "url-mask-panel",
      type: "frame",
      rect: { width: 160, height: 80 },
      fill: { color: "#ffffff" },
      computedStyles: {
        maskImage: "url(https://example.test/mask.png)",
        maskPosition: "right 10px bottom 5px",
        maskSize: "80px 40px",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    };
    expect(context.applyMaskImage(frame, scene, [asset])).toBe(true);
    expect(frame.children[0].isMask).toBe(true);
    expect(frame.children[0].name).toBe("__css-mask-image");
    expect(frame.children[1].name).toBe("__css-mask-background-url-mask-panel");
    expect(svgs[0]).toContain("<image");
    expect(svgs[0]).toContain('width="80" height="40"');
    expect(frame.getPluginData("open-canvas-mask-image")).toContain("mask.png");
  });

  it("does not report a readable URL mask as a degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "url-mask-diagnostic",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "url(https://example.test/mask.png)",
        maskPosition: "0% 0%",
        maskSize: "auto",
        maskRepeat: "repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    }, report, [{
      id: "mask-alpha",
      src: "https://example.test/mask.png",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    }]);
    expect(report.styleDegradationNodes.some(node => node.message.includes("mask-image"))).toBe(false);
  });

  it("does not report multiple supported gradient masks as a degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "multi-gradient-mask-diagnostic",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000), radial-gradient(circle, #000, transparent)",
        maskPosition: "0% 0%, 20px 10px",
        maskSize: "auto, 80px 40px",
        maskRepeat: "no-repeat, repeat-x",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "match-source",
      },
    }, report, []);
    expect(report.styleDegradations).toBe(0);
  });

  it("composes a pure intersect mask stack with nested editable SVG masks", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "intersecting-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000), radial-gradient(circle, #000, transparent)",
        maskComposite: "intersect",
      },
    }, report, []);
    expect(report.styleDegradations).toBe(0);

    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    expect(context.applyMaskImage(frame, {
      id: "intersecting-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000), radial-gradient(circle, #000, transparent)",
        maskComposite: "intersect",
      },
    })).toBe(true);
    expect(frame.children[0].isMask).toBe(true);
    expect(capturedSvg).toContain('id="cssMaskComposite-0"');
    expect(capturedSvg).toContain('mask="url(#cssMaskComposite-0)"');
    expect(capturedSvg).toContain('id="cssMaskComposite-1"');
  });

  it("composes mixed, subtractive, and exclusive mask operators as editable SVG", () => {
    const context = loadPluginFunctions();
    expect(context.maskCompositeSupported("source-in", 2)).toBe(true);
    expect(context.maskCompositeSupported("intersect, add", 3)).toBe(true);
    expect(context.maskCompositeSupported("subtract", 2)).toBe(true);
    expect(context.maskCompositeSupported("source-out", 2)).toBe(true);
    expect(context.maskCompositeSupported("xor", 2)).toBe(true);

    const report = importReport();
    context.recordSceneDegradations({
      id: "mixed-composite-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(#000, transparent), radial-gradient(circle, #000, transparent), linear-gradient(to right, #000, transparent)",
        maskComposite: "intersect, add",
      },
    }, report, []);
    expect(report.styleDegradations).toBe(0);

    const frame = mockFigmaNode("FRAME");
    frame.resize(160, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    expect(context.applyMaskImage(frame, {
      id: "mixed-composite-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(#000, transparent), radial-gradient(circle, #000, transparent), linear-gradient(to right, #000, transparent)",
        maskComposite: "intersect, add",
      },
    })).toBe(true);
    expect(capturedSvg).toContain("feComposite");
    expect(capturedSvg).toContain('operator="in"');
    expect(capturedSvg).toContain('operator="over"');

    capturedSvg = "";
    const subtractFrame = mockFigmaNode("FRAME");
    subtractFrame.resize(160, 80);
    expect(context.applyMaskImage(subtractFrame, {
      id: "subtract-mask",
      type: "frame",
      rect: { width: 160, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(#000, transparent), radial-gradient(circle, #000, transparent)",
        maskComposite: "subtract",
      },
    })).toBe(true);
    expect(capturedSvg).toContain('operator="out"');
  });

  it("keeps complex mask layers on the explicit degradation path", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    expect(context.applyMaskImage(frame, {
      id: "complex-mask",
      type: "frame",
      rect: { width: 120, height: 60 },
      computedStyles: {
        maskImage: "linear-gradient(to right, #000, transparent), url(mask.svg)",
        maskPosition: "20% 0%",
      },
    })).toBe(false);
    expect(frame.children).toHaveLength(0);
  });

  it("clips SVG backgrounds to the CSS padding box when requested", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    context.backgroundImage(frame, {
      id: "padding-clip-card",
      rect: { width: 120, height: 80 },
      radius: [16, 16, 16, 16],
      borders: [
        { color: "#111", width: 4 },
        { color: "#111", width: 6 },
        { color: "#111", width: 4 },
        { color: "#111", width: 6 },
      ],
      computedStyles: { backgroundClip: "padding-box" },
      backgroundAssetId: "asset-padding-clip",
      backgroundImage: "url(data:image/svg+xml;base64,ZmFrZQ==)",
    }, [{
      id: "asset-padding-clip",
      kind: "svg",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg><rect width="120" height="80"/></svg>')}`,
    }], { images: new Map(), vectors: new Map() }, importReport());
    expect(capturedSvg).toContain('<path d="M 16 4');
  });

  it("clips a solid background color to the CSS padding box without a duplicate fill", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    frame.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    expect(context.createClippedBackgroundColorOverlay(frame, {
      id: "solid-padding-clip",
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [16, 16, 16, 16],
      borders: [
        { color: "#111", width: 4 },
        { color: "#111", width: 6 },
        { color: "#111", width: 4 },
        { color: "#111", width: 6 },
      ],
      layout: { padding: [8, 10, 8, 10] },
      fill: { color: "rgb(255, 0, 0)" },
      computedStyles: { backgroundClip: "padding-box" },
    })).toBe(true);
    expect(capturedSvg).toContain('<path d="M 16 4');
    expect(capturedSvg).toContain('fill="rgb(255, 0, 0)"');
    expect(frame.fills).toEqual([]);
    expect(frame.children[0].name).toBe("__css-background-color-solid-padding-clip");
  });

  it("uses border plus padding inset for a solid content-box background", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    expect(context.createClippedBackgroundColorOverlay(frame, {
      id: "solid-content-clip",
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [12, 12, 12, 12],
      borders: [
        { color: "#111", width: 2 },
        { color: "#111", width: 3 },
        { color: "#111", width: 2 },
        { color: "#111", width: 3 },
      ],
      layout: { padding: [4, 5, 4, 5] },
      fill: { color: "#00ff00" },
      computedStyles: { backgroundClip: "content-box" },
    })).toBe(true);
    expect(capturedSvg).toContain('<path d="M 12 6');
    expect(frame.fills).toEqual([]);
  });

  it("combines a clipped URL image and background color into one SVG layer", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    context.backgroundImage(frame, {
      id: "url-padding-clip",
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
      ],
      layout: { padding: [4, 4, 4, 4] },
      fill: { color: "#ffffff" },
      backgroundImage: "url(https://example.test/pattern.png)",
      computedStyles: { backgroundClip: "content-box" },
      backgroundRepeat: "no-repeat",
      backgroundPosition: "0% 0%",
    }, [{ id: "pattern", url: "https://example.test/pattern.png", kind: "image", src: "https://example.test/pattern.png", data: pixelPng }], { images: new Map(), vectors: new Map() }, importReport());
    expect(capturedSvg).toContain('<path d="M 8 6');
    expect(capturedSvg).toContain('fill="#ffffff"');
    expect(capturedSvg).toContain("<image ");
    expect(frame.fills).toEqual([]);
    expect(frame.children[0].name).toBe("__css-background-image-clip-url-padding-clip");
  });

  it("resolves background-origin independently from the final clip inset", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    context.backgroundImage(frame, {
      id: "origin-content-clip-padding",
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
      ],
      layout: { padding: [4, 4, 4, 4] },
      backgroundImage: "url(https://example.test/pattern.png)",
      backgroundSize: "100% 100%",
      backgroundPosition: "0% 0%",
      backgroundRepeat: "no-repeat",
      computedStyles: { backgroundOrigin: "content-box", backgroundClip: "padding-box" },
    }, [{ id: "pattern", url: "https://example.test/pattern.png", kind: "image", src: "https://example.test/pattern.png", data: pixelPng }], { images: new Map(), vectors: new Map() }, importReport());
    expect(capturedSvg).toContain('x="6" y="6" width="108" height="68"');
    expect(capturedSvg).toContain('<path d="M 8 2');
  });

  it("keeps repeated blend overlays inside the background-origin box", () => {
    const context = loadPluginFunctions();
    const frame = mockFigmaNode("FRAME");
    frame.resize(120, 80);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    context.backgroundImage(frame, {
      id: "origin-content-repeat-y-blend",
      type: "frame",
      rect: { width: 120, height: 80 },
      borders: [
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
      ],
      layout: { padding: [4, 6, 8, 10] },
      fill: { color: "#ffffff" },
      backgroundImage: "url(https://example.test/pattern.png)",
      backgroundSize: "20px 12px",
      backgroundPosition: "0% 0%",
      backgroundRepeat: "repeat-y",
      computedStyles: {
        backgroundOrigin: "content-box",
        backgroundClip: "content-box",
        backgroundBlendMode: "multiply",
      },
    }, [{ id: "pattern", url: "https://example.test/pattern.png", kind: "image", src: "https://example.test/pattern.png", data: pixelPng }], { images: new Map(), vectors: new Map() }, importReport());
    // Border-box is 120x80; content-box is 100x64 after asymmetric border and
    // padding. repeat-y must use that origin width/height as its non-repeated
    // period rather than the outer node dimensions.
    expect(capturedSvg).toContain('width="100"');
    expect(capturedSvg).toContain('height="12"');
    expect(capturedSvg).toContain('x="12" y="6"');
  });

  it("matches measured children by stable plugin id after semantic renaming", () => {
    const context = loadPluginFunctions();
    const first = mockFigmaNode("FRAME");
    const second = mockFigmaNode("FRAME");
    const data = new Map([["open-canvas-id", "second"]]);
    second.name = "Button: Save changes";
    second.setPluginData = (key, value) => data.set(key, value);
    second.getPluginData = key => data.get(key) || "";
    const parent = mockFigmaNode("FRAME");
    parent.appendChild(first);
    parent.appendChild(second);
    expect(context.sceneChildNode(parent, { id: "second" }, 0)).toBe(second);
  });

  it("keeps text-decoration vectors out of scene child geometry matching", () => {
    const context = loadPluginFunctions();
    const text = mockFigmaNode("TEXT");
    text.name = "Heading";
    const decoration = mockFigmaNode("VECTOR");
    decoration.name = "__css-text-decoration-heading";
    const mask = mockFigmaNode("VECTOR");
    mask.name = "__css-mask-image";
    const background = mockFigmaNode("VECTOR");
    background.name = "__css-background-color-heading";
    const clip = mockFigmaNode("VECTOR");
    clip.name = "__css-clip-path-mask";
    const second = mockFigmaNode("FRAME");
    second.name = "Card";
    const parent = mockFigmaNode("FRAME");
    parent.appendChild(text);
    parent.appendChild(decoration);
    parent.appendChild(mask);
    parent.appendChild(background);
    parent.appendChild(clip);
    parent.appendChild(second);

    expect(context.sceneChildren(parent)).toEqual([text, second]);
    expect(context.sceneChildNode(parent, { id: "second" }, 1)).toBe(second);
  });

  it("keeps renamed gradient and shadow fallbacks out of scene child matching", () => {
    const context = loadPluginFunctions();
    const first = mockFigmaNode("FRAME");
    first.setPluginData("open-canvas-id", "first");
    const gradient = mockFigmaNode("VECTOR");
    gradient.name = "User renamed gradient visual";
    gradient.setPluginData("open-canvas-gradient-fill-fallback-owner", "first");
    const shadow = mockFigmaNode("VECTOR");
    shadow.name = "User renamed shadow visual";
    shadow.setPluginData("open-canvas-shadow-fallback-owner", "first");
    const second = mockFigmaNode("FRAME");
    second.setPluginData("open-canvas-id", "second");
    const parent = mockFigmaNode("FRAME");
    parent.appendChild(first);
    parent.appendChild(gradient);
    parent.appendChild(shadow);
    parent.appendChild(second);

    expect(context.sceneChildren(parent)).toEqual([first, second]);
    expect(context.sceneChildNode(parent, { id: "second" }, 1)).toBe(second);
  });

  it("keeps legacy text overflow and clip fallbacks out of scene child indexing", () => {
    const context = loadPluginFunctions();
    const text = mockFigmaNode("TEXT");
    text.name = "Label: First line";
    text.setPluginData("open-canvas-id", "label");
    const overflow = mockFigmaNode("VECTOR");
    overflow.name = "__css-text-overflow-label";
    const imageText = mockFigmaNode("VECTOR");
    imageText.name = "__css-text-background-image-label";
    const filterText = mockFigmaNode("VECTOR");
    filterText.name = "__css-text-filter-label";
    const maskText = mockFigmaNode("VECTOR");
    maskText.name = "__css-text-mask-image-label";
    const shapingText = mockFigmaNode("VECTOR");
    shapingText.name = "__css-text-shaping-label";
    const renamedFallback = mockFigmaNode("VECTOR");
    renamedFallback.name = "User renamed visual layer";
    renamedFallback.setPluginData("open-canvas-text-shaping-owner", "label");
    const legacyClip = mockFigmaNode("VECTOR");
    legacyClip.name = "__css-legacy-clip-mask";
    const clipBackground = mockFigmaNode("VECTOR");
    clipBackground.name = "__css-clip-path-background";
    const second = mockFigmaNode("FRAME");
    second.name = "Card";
    second.setPluginData("open-canvas-id", "card");
    const parent = mockFigmaNode("FRAME");
    parent.appendChild(text);
    parent.appendChild(overflow);
    parent.appendChild(imageText);
    parent.appendChild(filterText);
    parent.appendChild(maskText);
    parent.appendChild(shapingText);
    parent.appendChild(renamedFallback);
    parent.appendChild(legacyClip);
    parent.appendChild(clipBackground);
    parent.appendChild(second);

    expect(context.sceneChildren(parent)).toEqual([text, second]);
    // The fallback layers sit between the semantic siblings in the actual
    // Figma tree, but index-based recovery must still resolve the second
    // scene child to the real Card frame.
    expect(context.sceneChildNode(parent, { id: "card" }, 1)).toBe(second);
  });

  it("uses accessible semantics for readable layer names and descriptions", async () => {
    const context = loadPluginFunctions();
    expect(context.semanticLayerName({
      id: "node-save",
      sourceTag: "BUTTON",
      semantics: { role: "button", label: "Save changes" },
    })).toBe("Button: Save changes");
    expect(context.semanticDescription({
      semantics: { role: "checkbox", description: "Include archived", states: { checked: "true" } },
    })).toBe("role=checkbox · Include archived · checked=true");
    expect(context.semanticLayerName({
      id: "node-main",
      sourceTag: "MAIN",
      semantics: { role: "main" },
    })).toBe("Main");
    expect(context.authoredLayoutMetadata({
      computedStyles: { display: "grid" },
      layout: {
        mode: "horizontal",
        wrap: true,
        gap: 12,
        gapExpression: "10% 5%",
        rowGapExpression: "10%",
        columnGapExpression: "5%",
        padding: [0, 0, 0, 0],
        position: "flow",
        widthMode: "fixed",
        heightMode: "fixed",
        gridTemplateColumns: "repeat(2, 1fr)",
        gridTemplateAreas: '"left right"',
        gridArea: "left",
      },
    })).toMatchObject({
      display: "grid",
      gapExpression: "10% 5%",
      rowGapExpression: "10%",
      columnGapExpression: "5%",
      gridTemplateColumns: "repeat(2, 1fr)",
      gridTemplateAreas: '"left right"',
      gridArea: "left",
    });
    expect(context.authoredSizingConstraints({
      computedStyles: {
        minWidth: "50%",
        maxWidth: "430px",
        minHeight: "initial",
        maxHeight: "revert",
      },
    })).toEqual({ minWidth: "50%", maxWidth: "430px" });
  });

  it("uses a selected frame only when it is the sole explicit destination", () => {
    const context = loadPluginFunctions();
    const page = { type: "PAGE", selection: [] };
    const frame = { type: "FRAME" };
    page.selection = [frame];
    expect(context.importParentForPage(page)).toBe(frame);
    page.selection = [frame, { type: "FRAME" }];
    expect(context.importParentForPage(page)).toBe(page);
    page.selection = [{ type: "TEXT" }];
    expect(context.importParentForPage(page)).toBe(page);
  });

  it("places a colliding page import to the right of existing top-level content", () => {
    const context = loadPluginFunctions();
    const page = { type: "PAGE", children: [] };
    const existing = mockFigmaNode("FRAME");
    existing.x = 40;
    existing.y = 24;
    existing.resize(375, 980);
    const root = mockFigmaNode("FRAME");
    root.resize(375, 980);
    page.children.push(existing, root);
    existing.parent = page;
    root.parent = page;

    context.placeRootWithoutOverlap(root, page);

    expect(root.x).toBe(495);
    expect(root.y).toBe(24);
  });

  it("keeps a non-overlapping page import at its captured position", () => {
    const context = loadPluginFunctions();
    const page = { type: "PAGE", children: [] };
    const existing = mockFigmaNode("FRAME");
    existing.resize(375, 980);
    const root = mockFigmaNode("FRAME");
    root.x = 600;
    root.y = 20;
    root.resize(375, 980);
    page.children.push(existing, root);
    existing.parent = page;
    root.parent = page;

    context.placeRootWithoutOverlap(root, page);

    expect(root.x).toBe(600);
    expect(root.y).toBe(20);
  });

  it("does not relocate an import inside an explicitly selected Frame", () => {
    const context = loadPluginFunctions();
    const host = mockFigmaNode("FRAME");
    const root = mockFigmaNode("FRAME");
    root.x = 12;
    root.y = 18;
    host.appendChild(root);

    context.placeRootWithoutOverlap(root, host);

    expect(root.x).toBe(12);
    expect(root.y).toBe(18);
  });

  it("only writes wrapped-track spacing when Figma layout wrapping is enabled", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let crossAxisSpacingWrites = 0;
    Object.defineProperty(node, "layoutWrap", { value: "NO_WRAP", writable: true, configurable: true });
    Object.defineProperty(node, "counterAxisSpacing", {
      configurable: true,
      get: () => 0,
      set: () => { crossAxisSpacingWrites += 1; },
    });
    Object.defineProperty(node, "counterAxisAlignContent", { value: "AUTO", writable: true, configurable: true });

    context.applyLayout(node, { layout: {
      mode: "horizontal",
      gap: 8,
      rowGap: 12,
      columnGap: 16,
      wrap: false,
      alignContent: "space-between",
    } });

    expect(crossAxisSpacingWrites).toBe(0);
    expect(node.layoutWrap).toBe("NO_WRAP");

    context.applyLayout(node, { layout: {
      mode: "horizontal",
      gap: 8,
      rowGap: 12,
      columnGap: 16,
      wrap: true,
      alignContent: "space-between",
    } });

    expect(crossAxisSpacingWrites).toBe(1);
    expect(node.layoutWrap).toBe("WRAP");
    expect(node.counterAxisAlignContent).toBe("SPACE_BETWEEN");
  });

  it("reports layout properties that Figma silently normalizes on read-back", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let primaryAxisAlignItems = "MIN";
    Object.defineProperty(node, "primaryAxisAlignItems", {
      configurable: true,
      get: () => primaryAxisAlignItems,
      set: () => { primaryAxisAlignItems = "MIN"; },
    });
    const report = importReport();

    context.applyLayout(node, { id: "normalized-layout", layout: {
      mode: "horizontal",
      gap: 12,
      justifyContent: "center",
      alignItems: "center",
    } }, report);

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "normalized-layout",
        property: "primaryAxisAlignItems",
        expected: "CENTER",
        actual: "MIN",
      }),
    ]));
  });

  it("reports an absolute positioning lock that Figma silently normalizes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let positioning = "IN_FLOW";
    Object.defineProperty(node, "layoutPositioning", {
      configurable: true,
      get: () => positioning,
      set: () => { positioning = "IN_FLOW"; },
    });
    const report = importReport();

    context.writeLayoutProperty(node, { id: "silent-absolute" }, report, "layoutPositioning", "ABSOLUTE");

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "silent-absolute",
        property: "layoutPositioning",
        expected: "ABSOLUTE",
        actual: "IN_FLOW",
      }),
    ]));
  });

  it("maps flex gaps by CSS flex axis in vertical writing mode", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let crossAxisSpacing = 0;
    Object.defineProperty(node, "layoutWrap", { value: "NO_WRAP", writable: true, configurable: true });
    Object.defineProperty(node, "counterAxisSpacing", {
      configurable: true,
      get: () => crossAxisSpacing,
      set: value => { crossAxisSpacing = value; },
    });

    context.applyLayout(node, {
      computedStyles: {
        display: "flex",
        flexDirection: "row",
        writingMode: "vertical-rl",
      },
      layout: {
        mode: "vertical",
        gap: 8,
        rowGap: 8,
        columnGap: 20,
        wrap: true,
      },
    });

    // The physical main axis is vertical, but flex row still uses
    // column-gap between items and row-gap between wrapped lines.
    expect(node.itemSpacing).toBe(20);
    expect(crossAxisSpacing).toBe(8);

    context.applyLayout(node, {
      computedStyles: {
        display: "flex",
        flexDirection: "column",
        writingMode: "vertical-rl",
      },
      layout: {
        mode: "horizontal",
        gap: 8,
        rowGap: 8,
        columnGap: 20,
        wrap: true,
      },
    });

    expect(node.itemSpacing).toBe(8);
    expect(crossAxisSpacing).toBe(20);
  });

  it("retains wrap-reverse when rebuilding an H2D-only flex scene", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-wrap-reverse",
      tag: "DIV",
      styles: {
        width: "320px",
        height: "120px",
        display: "flex",
        flexDirection: "row",
        flexWrap: "wrap-reverse",
      },
      rect: { x: 0, y: 0, width: 320, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout).toMatchObject({ wrap: true, wrapReverse: true });
  });

  it("honors the explicit Auto Layout hint when H2D styles describe block flow", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "hinted-block-layout",
      tag: "SECTION",
      attributes: { "data-figma-auto-layout": "horizontal" },
      styles: {
        width: "320px",
        height: "80px",
        display: "block",
      },
      rect: { x: 0, y: 0, width: 320, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout.mode).toBe("horizontal");
  });

  it("recovers FILL and HUG child sizing under a trimmed vertical Auto Layout hint", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-hinted-column",
      tag: "SECTION",
      attributes: { "data-figma-auto-layout": "vertical" },
      styles: {
        width: "320px",
        height: "120px",
        display: "block",
        paddingTop: "10px",
        paddingRight: "10px",
        paddingBottom: "10px",
        paddingLeft: "10px",
      },
      rect: { x: 0, y: 0, width: 320, height: 120 },
      childNodes: [{
        nodeType: 1,
        id: "legacy-column-card",
        tag: "ARTICLE",
        styles: { display: "block", width: "300px", height: "auto" },
        rect: { x: 10, y: 10, width: 300, height: 42 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout).toMatchObject({ widthMode: "fill", heightMode: "hug" });
  });

  it("recovers flex-grow and stretch sizing when legacy child markers are missing", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-flex-row",
      tag: "DIV",
      styles: {
        width: "300px",
        height: "80px",
        display: "flex",
        flexDirection: "row",
        alignItems: "stretch",
      },
      rect: { x: 0, y: 0, width: 300, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "legacy-growing-panel",
        tag: "DIV",
        styles: {
          display: "block",
          width: "220px",
          height: "80px",
          flexGrow: "1",
          flexBasis: "0px",
          alignSelf: "auto",
        },
        rect: { x: 0, y: 0, width: 220, height: 80 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout).toMatchObject({ widthMode: "fill", heightMode: "fill" });
  });

  it("recovers intrinsic flex-basis keywords as HUG in legacy H2D", () => {
    const context = loadPluginFunctions();
    for (const basis of ["min-content", "max-content", "fit-content"]) {
      const scene = context.sceneFromH2D({
        nodeType: 1,
        id: `legacy-${basis}`,
        tag: "DIV",
        styles: { display: "flex", flexDirection: "row", width: "300px", height: "80px" },
        rect: { x: 0, y: 0, width: 300, height: 80 },
        childNodes: [{
          nodeType: 1,
          id: `${basis}-child`,
          tag: "DIV",
          styles: { display: "block", width: "auto", height: "40px", flexBasis: basis },
          rect: { x: 0, y: 0, width: 96, height: 40 },
          childNodes: [],
        }],
      }, { x: 0, y: 0 });

      expect(scene.children[0].layout.widthMode, basis).toBe("hug");
    }
  });

  it("keeps a main-axis auto-sized item HUG when its captured box spans the parent", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-auto-spanning-row",
      tag: "DIV",
      styles: { display: "flex", flexDirection: "row", width: "300px", height: "80px" },
      rect: { x: 0, y: 0, width: 300, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "auto-spanning-child",
        tag: "DIV",
        styles: {
          display: "block",
          width: "auto",
          height: "40px",
          flexBasis: "auto",
          alignSelf: "start",
        },
        rect: { x: 0, y: 0, width: 300, height: 40 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout.widthMode).toBe("hug");
  });

  it("keeps explicit intrinsic flex-basis as HUG when legacy H2D also has width", () => {
    const context = loadPluginFunctions();
    for (const basis of ["content", "min-content", "max-content", "fit-content"]) {
      const scene = context.sceneFromH2D({
        nodeType: 1,
        id: `legacy-explicit-${basis}`,
        tag: "DIV",
        styles: { display: "flex", flexDirection: "row", width: "300px", height: "80px" },
        rect: { x: 0, y: 0, width: 300, height: 80 },
        childNodes: [{
          nodeType: 1,
          id: `${basis}-child-with-width`,
          tag: "DIV",
          styles: { display: "block", width: "200px", height: "40px", flexBasis: basis },
          rect: { x: 0, y: 0, width: 200, height: 40 },
          childNodes: [],
        }],
      }, { x: 0, y: 0 });

      expect(scene.children[0].layout.widthMode, basis).toBe("hug");
    }
  });

  it("does not treat parameterized fit-content as intrinsic HUG in legacy H2D", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-parameterized-fit-content",
      tag: "DIV",
      styles: { display: "flex", flexDirection: "row", width: "300px", height: "80px" },
      rect: { x: 0, y: 0, width: 300, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "fit-content-length-child",
        tag: "DIV",
        styles: { display: "block", width: "200px", height: "40px", flexBasis: "fit-content(240px)" },
        rect: { x: 0, y: 0, width: 200, height: 40 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout.widthMode).toBe("fixed");
  });

  it("recovers flex grow/shrink/basis when a trimmed H2D payload keeps only the flex marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "marked-flex-parent",
      tag: "DIV",
      styles: { display: "flex", flexDirection: "row", width: "300px", height: "80px" },
      rect: { x: 0, y: 0, width: 300, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "marked-flex-child",
        tag: "DIV",
        attributes: {
          "data-open-canvas-flex": JSON.stringify({
            values: { flexGrow: "2", flexShrink: "0", flexBasis: "40%" },
            measuredGeometry: true,
          }),
        },
        styles: { display: "block", width: "220px", height: "80px" },
        rect: { x: 0, y: 0, width: 220, height: 80 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0].computedStyles).toMatchObject({
      flexGrow: "2",
      flexShrink: "0",
      flexBasis: "40%",
    });
    const node = mockFigmaNode("FRAME");
    context.applyFlexSizing(node, scene.children[0], true, { layout: { mode: "horizontal" } });
    expect(node.layoutGrow).toBe(1);
    expect(JSON.parse(node.getPluginData("open-canvas-flex"))).toEqual({ grow: 2, shrink: 0, basis: "40%" });
  });

  it("infers child sizing when only the compact layout marker survives", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "compact-layout-parent",
      tag: "SECTION",
      attributes: {
        "data-open-canvas-layout": JSON.stringify({ mode: "vertical", alignItems: "stretch" }),
      },
      styles: { display: "block", width: "320px", height: "100px" },
      rect: { x: 0, y: 0, width: 320, height: 100 },
      childNodes: [{
        nodeType: 1,
        id: "compact-layout-child",
        tag: "ARTICLE",
        styles: { display: "block", width: "320px", height: "auto" },
        rect: { x: 0, y: 0, width: 320, height: 40 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.layout).toMatchObject({ mode: "vertical", alignItems: "stretch" });
    expect(scene.children[0].layout).toMatchObject({ widthMode: "fill", heightMode: "hug" });
  });

  it("keeps explicit compatibility sizing markers authoritative over legacy inference", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-marker-parent",
      tag: "DIV",
      styles: { width: "300px", height: "80px", display: "flex", flexDirection: "row", alignItems: "stretch" },
      rect: { x: 0, y: 0, width: 300, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "legacy-marker-child",
        tag: "DIV",
        attributes: {
          "data-open-canvas-width-mode": "fixed",
          "data-open-canvas-height-mode": "fixed",
        },
        styles: { display: "block", width: "300px", height: "80px", flexGrow: "1" },
        rect: { x: 0, y: 0, width: 300, height: 80 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout).toMatchObject({ widthMode: "fixed", heightMode: "fixed" });
  });

  it("maps CSS baseline alignment to Figma's baseline counter-axis mode", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");

    context.applyLayout(node, { layout: { mode: "horizontal", alignItems: "baseline" } });

    expect(node.counterAxisAlignItems).toBe("BASELINE");
  });

  it("does not approximate CSS edge distributions as SPACE_BETWEEN", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyLayout(node, { layout: { mode: "horizontal", justifyContent: "space-around" } });
    expect(node.primaryAxisAlignItems).toBe("MIN");
    context.applyLayout(node, { layout: { mode: "horizontal", justifyContent: "space-evenly" } });
    expect(node.primaryAxisAlignItems).toBe("MIN");
    context.applyLayout(node, { layout: { mode: "horizontal", justifyContent: "space-between" } });
    expect(node.primaryAxisAlignItems).toBe("SPACE_BETWEEN");
  });

  it("swaps the Figma primary-axis edge for reversed flex layouts", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");

    context.applyLayout(node, { layout: { mode: "horizontal", reverse: true, justifyContent: "start" } });
    expect(node.primaryAxisAlignItems).toBe("MAX");
    context.applyLayout(node, { layout: { mode: "horizontal", reverse: true, justifyContent: "end" } });
    expect(node.primaryAxisAlignItems).toBe("MIN");
    context.applyLayout(node, { layout: { mode: "horizontal", reverse: true, justifyContent: "space-between" } });
    expect(node.primaryAxisAlignItems).toBe("SPACE_BETWEEN");
  });

  it("preserves CSS radial-gradient center positions", () => {
    const context = loadPluginFunctions();
    expect(context.radialGradientCenter("circle at 80% 15%")).toEqual({ x: 0.8, y: 0.15 });
    expect(context.radialGradientCenter("ellipse at right bottom")).toEqual({ x: 1, y: 1 });
    expect(context.radialGradientCenter("circle at left")).toEqual({ x: 0, y: 0.5 });
    expect(context.radialGradientCenter("circle at 20px 30px", 200, 100)).toEqual({ x: 0.1, y: 0.3 });
    expect(context.radialGradientCenter("circle at right 20px bottom 10px", 200, 100)).toEqual({ x: 0.9, y: 0.9 });
    expect(context.radialGradientCenter("circle at top 10px left 20px", 200, 100)).toEqual({ x: 0.1, y: 0.1 });
    expect(context.radialGradientCenter("circle at center 20px", 200, 100)).toEqual({ x: 0.5, y: 0.2 });
    expect(context.radialGradientCenter("circle at 20px center", 200, 100)).toEqual({ x: 0.1, y: 0.5 });
    expect(context.radialGradientCenter("circle at calc(50% - 10px) calc(50% + 5px)", 200, 100)).toEqual({ x: 0.45, y: 0.55 });
    expect(context.radialGradientCenter("circle at -10% 120%", 200, 100)).toEqual({ x: -0.1, y: 1.2 });
    expect(context.radialGradientCenter("circle at right -20px bottom -10px", 200, 100)).toEqual({ x: 1.1, y: 1.1 });
    expect(context.radialGradientHandles("circle closest-side at -10% 120%", 200, 100)).toEqual([
      { x: -0.1, y: 1.2 },
      { x: expect.closeTo(0, 8), y: 1.2 },
      { x: -0.1, y: 1.4 },
    ]);

    const paints = context.gradientPaints("radial-gradient(circle at 80% 15%, #ff0000, transparent)");
    expect(paints[0]).toMatchObject({
      type: "GRADIENT_RADIAL",
      gradientTransform: [
        [expect.any(Number), 0, 0.8],
        [0, expect.any(Number), 0.15],
      ],
    });
    expect(context.radialGradientHandles("circle at 50% 50%", 200, 100)).toEqual([
      { x: 0.5, y: 0.5 },
      { x: expect.closeTo(1.059016, 5), y: 0.5 },
      { x: 0.5, y: expect.closeTo(1.618033, 5) },
    ]);

    const pixelPaint = context.gradientPaints(
      "radial-gradient(circle at 20px 30px, #ff0000, transparent)",
      200,
      100,
    );
    expect(pixelPaint[0].gradientTransform[0][2]).toBeCloseTo(0.1, 8);
    expect(pixelPaint[0].gradientTransform[1][2]).toBeCloseTo(0.3, 8);
  });

  it("maps conic-gradient border paints to an angular Figma stroke", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints(
      "conic-gradient(from 45deg at 25% 60%, #ff0000 0deg, #00ff00 120deg, #0000ff 240deg, #ff0000 360deg)",
      200,
      100,
    );
    expect(paints).toHaveLength(1);
    expect(paints[0].type).toBe("GRADIENT_ANGULAR");
    expect(paints[0].gradientTransform[0][2]).toBeCloseTo(0.25, 8);
    expect(paints[0].gradientTransform[1][2]).toBeCloseTo(0.6, 8);
    expect(paints[0].gradientStops.map(stop => stop.position)).toEqual([
      0,
      expect.closeTo(1 / 3, 8),
      expect.closeTo(2 / 3, 8),
      1,
    ]);
  });

  it("uses pixel conic-gradient centers for angular paints and SVG sectors", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints(
      "conic-gradient(from 45deg at 20px 30px, #ff0000 0deg, #0000ff 360deg)",
      200,
      100,
    );
    expect(paints[0].gradientTransform[0][2]).toBeCloseTo(0.1, 8);
    expect(paints[0].gradientTransform[1][2]).toBeCloseTo(0.3, 8);
    const sectors = context.conicGradientSectors(
      "conic-gradient(from 45deg at 20px 30px, #ff0000 0deg, #0000ff 360deg)",
      200,
      100,
    );
    expect(sectors).toHaveLength(180);
    expect(sectors[0]).toContain("M 20 30");
  });

  it("normalizes CSS angle units before creating linear and conic gradient paints", () => {
    const context = loadPluginFunctions();
    const equivalentLinearAngles = [
      "linear-gradient(90deg, #f00, #00f)",
      "linear-gradient(.25turn, #f00, #00f)",
      "linear-gradient(100grad, #f00, #00f)",
      "linear-gradient(1.5707963267948966rad, #f00, #00f)",
    ].map(value => context.gradientPaints(value, 200, 100));
    expect(equivalentLinearAngles[1]).toEqual(equivalentLinearAngles[0]);
    expect(equivalentLinearAngles[2]).toEqual(equivalentLinearAngles[0]);
    expect(equivalentLinearAngles[3]).toEqual(equivalentLinearAngles[0]);
    const degreeSvg = context.svgGradientDefinition(
      "repeating-linear-gradient(90deg, #f00 0px, #00f 20px)",
      200,
      100,
      "angle-unit-gradient",
    );
    for (const angle of [".25turn", "100grad", "1.5707963267948966rad"]) {
      expect(context.svgGradientDefinition(
        `repeating-linear-gradient(${angle}, #f00 0px, #00f 20px)`,
        200,
        100,
        "angle-unit-gradient",
      )).toBe(degreeSvg);
    }

    const equivalentConicAngles = [
      "conic-gradient(from 90deg, #f00, #00f)",
      "conic-gradient(from .25turn, #f00, #00f)",
      "conic-gradient(from 100grad, #f00, #00f)",
      "conic-gradient(from 1.5707963267948966rad, #f00, #00f)",
    ].map(value => context.gradientPaints(value, 200, 100));
    expect(equivalentConicAngles[1]).toEqual(equivalentConicAngles[0]);
    expect(equivalentConicAngles[2]).toEqual(equivalentConicAngles[0]);
    expect(equivalentConicAngles[3]).toEqual(equivalentConicAngles[0]);
    const degreeSectors = context.conicGradientSectors(
      "conic-gradient(from 90deg, #f00 0deg, #00f 360deg)",
      200,
      100,
    );
    expect(context.conicGradientSectors(
      "conic-gradient(from .25turn, #f00 0deg, #00f 360deg)",
      200,
      100,
    )).toEqual(degreeSectors);
  });

  it("parses HSL, HSLA, and common named CSS gradient colors", () => {
    const context = loadPluginFunctions();
    expect(context.parseColor("hsl(0 100% 50%)")).toMatchObject({ color: { r: 1, g: 0, b: 0 }, opacity: 1 });
    expect(context.parseColor("hsla(240, 100%, 50%, 25%)")).toMatchObject({ color: { r: 0, g: 0, b: 1 }, opacity: 0.25 });
    expect(context.parseColor("hsl(.5turn 100% 50%)")).toMatchObject({ color: { r: 0, g: expect.closeTo(1, 6), b: 1 }, opacity: 1 });
    expect(context.parseColor("rgba(300, -20, 0, 150%)")).toEqual({
      color: { r: 1, g: 0, b: 0 },
      opacity: 1,
    });
    expect(context.parseColor("red")).toMatchObject({ color: { r: 1, g: 0, b: 0 }, opacity: 1 });
    const paints = context.gradientPaints("linear-gradient(90deg, hsl(0 100% 50%), hsla(240 100% 50% / 50%))");
    expect(paints[0].gradientStops).toMatchObject([
      { color: { r: 1, g: 0, b: 0, a: 1 } },
      { color: { r: 0, g: 0, b: 1, a: 0.5 } },
    ]);
  });

  it("resolves currentColor before creating native gradient paints", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints("linear-gradient(90deg, currentColor, transparent)", 200, 80, "rgb(24, 48, 72)");
    expect(paints[0].gradientStops[0].color).toMatchObject({
      r: expect.closeTo(24 / 255, 6),
      g: expect.closeTo(48 / 255, 6),
      b: expect.closeTo(72 / 255, 6),
    });
  });

  it("resolves currentColor in gradient SVG fallbacks", () => {
    const context = loadPluginFunctions();
    const svg = context.gradientFillFallbackSvg({
      id: "current-color-gradient-fallback",
      type: "frame",
      rect: { width: 200, height: 80 },
      backgroundImage: "linear-gradient(90deg, currentColor, transparent)",
      computedStyles: { color: "rgb(24, 48, 72)" },
    }, 200, 80);

    expect(svg).toContain("rgb(24,48,72)");
    expect(svg).not.toContain("currentColor");
  });

  it("verifies gradient fill structure after the Figma paint write", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const report = importReport();
    const scene = { id: "gradient-fill-read-back" };
    const expected = context.gradientPaints("linear-gradient(90deg, #f00, #00f)", 200, 100);
    node.fills = expected.map(paint => ({ ...paint, gradientStops: paint.gradientStops.map(stop => ({ ...stop, color: { ...stop.color } })) }));

    expect(context.verifyGradientPaints(node, "fills", expected, scene, report)).toBe(true);
    expect(report.styleDegradations).toBe(0);
  });

  it("reports a gradient paint that Figma silently normalizes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    let storedFills = [];
    Object.defineProperty(node, "fills", {
      configurable: true,
      get: () => storedFills,
      set: value => {
        // Simulate a host that accepts a gradient assignment but stores a
        // solid paint and drops the stop structure without throwing.
        storedFills = value.map(paint => String(paint?.type || "").startsWith("GRADIENT_")
          ? { type: "SOLID", color: { r: 0, g: 0, b: 0 } }
          : paint);
      },
    });
    const report = importReport();
    const scene = { id: "normalized-gradient-fill", gradient: "linear-gradient(90deg, #f00, #00f)" };
    const paints = context.gradientPaints("linear-gradient(90deg, #f00, #00f)", 200, 100);

    expect(context.gradient(node, "linear-gradient(90deg, #f00, #00f)", undefined, "rgb(0, 0, 0)", scene, report)).toBe(true);
    expect(report.styleDegradations).toBe(2);
    expect(report.styleDegradationNodes[0]).toMatchObject({
      id: "normalized-gradient-fill",
      property: "fills.gradientPaint",
      expected: paints.map(context.gradientPaintDescriptor),
      actual: [],
    });
    expect(report.styleDegradationNodes[0].message).toContain("gradient paint read-back mismatch");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-gradient-fill-normalized-gradient-fill");
    expect(node.fills).toEqual([]);
  });

  it("serializes radial and conic gradient fills into an editable SVG fallback", () => {
    const context = loadPluginFunctions();
    const radial = {
      id: "radial-gradient-fill",
      type: "frame",
      rect: { width: 160, height: 90 },
      backgroundImage: "radial-gradient(circle at 30% 40%, #fff, transparent), linear-gradient(90deg, #f00, #00f)",
      fill: { color: "#101010", opacity: 1 },
      radius: [12, 12, 12, 12],
    };
    const radialSvg = context.gradientFillFallbackSvg(radial, 160, 90);
    expect(radialSvg).toContain("radialGradient");
    expect(radialSvg).toContain("linearGradient");
    expect(radialSvg).toContain("openCanvasGradientFillClip");

    const conic = {
      id: "conic-gradient-fill",
      type: "frame",
      rect: { width: 120, height: 80 },
      backgroundImage: "repeating-conic-gradient(from 20deg at 40% 60%, #f00 0deg, #00f 90deg)",
      radius: [0, 0, 0, 0],
    };
    const conicSvg = context.gradientFillFallbackSvg(conic, 120, 80);
    expect(conicSvg).toContain("<path");
    expect(conicSvg).toContain("M 48 48");
  });

  it("does not create a pure-gradient fill fallback over a mixed URL background", () => {
    const context = loadPluginFunctions();
    expect(context.gradientFillFallbackSupported({
      gradient: "linear-gradient(90deg, #f00, #00f)",
      backgroundImage: "linear-gradient(90deg, #f00, #00f), url(hero.png)",
    })).toBe(false);
    expect(context.gradientFillFallbackSvg({
      gradient: "linear-gradient(90deg, #f00, #00f)",
      backgroundImage: "linear-gradient(90deg, #f00, #00f), url(hero.png)",
    }, 120, 80)).toBeNull();
  });

  it("recovers a pure gradient paint when a bridge trims the normalized gradient field", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(180, 72);
    const scene = {
      id: "trimmed-gradient-field",
      type: "frame",
      backgroundImage: "linear-gradient(90deg, #f00, #00f), radial-gradient(circle, #fff, transparent)",
      fill: { color: "#111111", opacity: 1 },
    };
    context.visuals(node, scene, [], { report: importReport() });
    expect(node.fills.filter(paint => String(paint.type || "").startsWith("GRADIENT"))).toHaveLength(2);
  });

  it("rebuilds a gradient fill fallback when its geometry changes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(100, 50);
    let created = 0;
    context.figma.createNodeFromSvg = () => {
      created += 1;
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "gradient-fill-resize",
      type: "frame",
      rect: { width: 100, height: 50 },
      backgroundImage: "linear-gradient(90deg, #f00, #00f)",
    };
    const report = importReport();
    expect(context.createGradientFillFallback(node, scene, report)).toBe(true);
    expect(created).toBe(1);
    expect(node.children).toHaveLength(1);
    node.resize(180, 72);
    context.syncGradientFillFallback(node, scene, report);
    expect(created).toBe(2);
    expect(node.children).toHaveLength(1);
    expect(JSON.parse(node.children[0].getPluginData("open-canvas-gradient-fill-fallback-geometry"))).toEqual({
      width: 180,
      height: 72,
    });
  });

  it("rebuilds a gradient fill fallback when the captured CSS paint changes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(100, 50);
    let created = 0;
    context.figma.createNodeFromSvg = () => {
      created += 1;
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "gradient-fill-css-change",
      type: "frame",
      rect: { width: 100, height: 50 },
      backgroundImage: "linear-gradient(90deg, #f00, #00f)",
    };
    const report = importReport();
    expect(context.createGradientFillFallback(node, scene, report)).toBe(true);
    scene.backgroundImage = "radial-gradient(circle, #0f0, #000)";
    context.syncGradientFillFallback(node, scene, report);
    expect(created).toBe(2);
    expect(node.children[0].getPluginData("open-canvas-gradient-fill-fallback-css")).toBe(scene.backgroundImage);
  });

  it("rebuilds a gradient fill fallback when currentColor changes at the same size", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(100, 50);
    let created = 0;
    context.figma.createNodeFromSvg = () => {
      created += 1;
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "gradient-fill-current-color-change",
      type: "frame",
      rect: { width: 100, height: 50 },
      backgroundImage: "linear-gradient(90deg, currentColor, transparent)",
      computedStyles: { color: "rgb(24, 48, 72)" },
    };
    const report = importReport();
    expect(context.createGradientFillFallback(node, scene, report)).toBe(true);
    expect(created).toBe(1);
    expect(node.children[0].getPluginData("open-canvas-gradient-fill-fallback-current-color")).toBe("rgb(24, 48, 72)");

    scene.computedStyles.color = "rgb(180, 36, 48)";
    context.syncGradientFillFallback(node, scene, report);

    expect(created).toBe(2);
    expect(node.children).toHaveLength(1);
    expect(node.children[0].getPluginData("open-canvas-gradient-fill-fallback-current-color")).toBe("rgb(180, 36, 48)");
  });

  it("rebuilds a same-size gradient fill fallback when its clipping radius changes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(100, 50);
    let created = 0;
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      created += 1;
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "gradient-fill-radius-change",
      type: "frame",
      rect: { width: 100, height: 50 },
      radius: [8, 8, 8, 8],
      backgroundImage: "linear-gradient(90deg, #f00, #00f)",
      computedStyles: {
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        borderBottomRightRadius: "8px",
        borderBottomLeftRadius: "8px",
      },
    };
    const report = importReport();
    expect(context.createGradientFillFallback(node, scene, report)).toBe(true);
    expect(created).toBe(1);

    scene.radius = [20, 20, 20, 20];
    for (const key of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]) {
      scene.computedStyles[key] = "20px";
    }
    context.syncGradientFillFallback(node, scene, report);

    expect(created).toBe(2);
    expect(node.children).toHaveLength(1);
    expect(svgs[1]).toContain("A 20 20");
    expect(node.children[0].getPluginData("open-canvas-gradient-fill-fallback-source-signature")).toContain("20");
  });

  it("rebuilds a same-size gradient fill fallback when its base fill changes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(100, 50);
    let created = 0;
    context.figma.createNodeFromSvg = () => {
      created += 1;
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "gradient-fill-base-change",
      type: "frame",
      rect: { width: 100, height: 50 },
      fill: { color: "#ffffff", opacity: 0.8 },
      backgroundImage: "linear-gradient(90deg, rgba(255,0,0,.2), transparent)",
    };
    const report = importReport();
    expect(context.createGradientFillFallback(node, scene, report)).toBe(true);
    expect(created).toBe(1);

    scene.fill = { color: "#000000", opacity: 0.4 };
    context.syncGradientFillFallback(node, scene, report);

    expect(created).toBe(2);
    expect(node.children).toHaveLength(1);
    expect(JSON.parse(node.children[0].getPluginData("open-canvas-gradient-fill-fallback-source-signature"))).toMatchObject({
      fill: { color: "#000000", opacity: 0.4 },
    });
  });

  it("removes a stale gradient fill fallback when the source becomes a solid paint", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(100, 50);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const scene = {
      id: "gradient-fill-removed",
      type: "frame",
      rect: { width: 100, height: 50 },
      fill: { color: "#ffffff", opacity: 1 },
      backgroundImage: "linear-gradient(90deg, #f00, #00f)",
    };
    const report = importReport();
    expect(context.createGradientFillFallback(node, scene, report)).toBe(true);
    expect(node.children).toHaveLength(1);

    scene.backgroundImage = "none";
    context.syncGradientFillFallback(node, scene, report);

    expect(node.children).toHaveLength(0);
    expect(node.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }]);

    // A geometry-only convergence pass can see the source return to a
    // gradient without rerunning the full visuals() paint path. The recovery
    // hint must recreate the SVG sibling instead of leaving the solid fill
    // as the only visible paint.
    scene.backgroundImage = "linear-gradient(90deg, #f00, #00f)";
    context.syncGradientFillFallback(node, scene, report);
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-gradient-fill-gradient-fill-removed");
  });

  it("verifies gradient stroke stops and transform, not only paint type", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const report = importReport();
    const scene = { id: "gradient-stroke-read-back" };
    const expected = context.gradientPaints("radial-gradient(circle at 80% 15%, #f00, #00f)", 200, 100);
    node.strokes = expected.map(paint => ({
      ...paint,
      gradientStops: paint.gradientStops.slice(0, 1),
    }));

    expect(context.verifyGradientPaints(node, "strokes", expected, scene, report)).toBe(false);
    expect(report.styleDegradationNodes[0]).toMatchObject({
      id: "gradient-stroke-read-back",
      property: "strokes.gradientPaint",
    });
    expect(report.styleDegradationNodes[0].expected[0].stops).toHaveLength(2);
    expect(report.styleDegradationNodes[0].actual[0].stops).toHaveLength(1);
  });

  it("creates an editable gradient border fallback when native stroke read-back fails", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 60);
    let storedStrokes = [];
    Object.defineProperty(node, "strokes", {
      configurable: true,
      get: () => storedStrokes,
      set: value => {
        // Simulate a Figma runtime that accepts the assignment but drops the
        // gradient paint structure during normalization.
        storedStrokes = value.map(paint => String(paint?.type || "").startsWith("GRADIENT_")
          ? { type: "SOLID", color: { r: 0, g: 0, b: 0 } }
          : paint);
      },
    });
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const report = importReport();
    const scene = {
      id: "normalized-gradient-stroke",
      type: "frame",
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [0, 1, 2, 3].map(() => ({
        color: "transparent",
        width: 2,
        style: "solid",
        gradient: "linear-gradient(90deg, #f00, #00f)",
      })),
    };

    context.visuals(node, scene, [], { report });
    expect(node.getPluginData("open-canvas-gradient-stroke-readback-failed")).toBe("1");
    context.createBorderDecorations(node, scene);

    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-border-gradient");
    expect(node.strokes).toEqual([]);
  });

  it("resolves currentColor in outline and filter drop-shadow fallbacks", () => {
    const context = loadPluginFunctions();
    expect(context.cssOutline({
      outlineWidth: "2px",
      outlineStyle: "solid",
      outlineColor: "CurrentColor",
      color: "rgb(12, 34, 56)",
    })).toMatchObject({ color: "rgb(12, 34, 56)", width: 2 });

    const filter = context.cssFilterSvgDefinition(
      "drop-shadow(0 2px 4px currentColor)",
      "current-color-filter",
      "rgb(12, 34, 56)",
    );
    expect(filter).toContain("flood-color=\"rgb(12,34,56)\"");
    expect(filter).not.toContain("currentColor");
  });

  it("resolves currentColor on native border strokes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 40);
    context.visuals(node, {
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      stroke: { color: "currentColor", width: 2, style: "solid" },
      computedStyles: { color: "rgb(12, 34, 56)" },
      radius: [0, 0, 0, 0],
    });

    expect(node.strokes).toEqual([expect.objectContaining({
      type: "SOLID",
      color: { r: 12 / 255, g: 34 / 255, b: 56 / 255 },
    })]);
  });

  it("resolves currentColor on legacy H2D text stroke data", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-current-color-text",
      tag: "P",
      styles: {
        display: "block",
        color: "rgb(12, 34, 56)",
        WebkitTextStrokeWidth: "2px",
        WebkitTextStrokeColor: "currentColor",
      },
      rect: { x: 0, y: 0, width: 160, height: 32 },
      childNodes: [{
        nodeType: 3,
        id: "legacy-current-color-run",
        text: "Outlined",
        rect: { x: 0, y: 0, width: 120, height: 24 },
        styles: {
          fontSize: "16px",
          lineHeight: "24px",
          color: "currentColor",
          WebkitTextStrokeWidth: "2px",
          WebkitTextStrokeColor: "currentColor",
        },
      }],
    }, { x: 0, y: 0 });

    expect(scene.text).toMatchObject({
      textStrokeWidth: 2,
      textStrokeColor: "rgb(12, 34, 56)",
    });
  });

  it("resolves inherited currentColor for outlines on trimmed H2D children", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "inherited-current-color-outline-root",
      tag: "DIV",
      styles: {
        display: "block",
        color: "rgb(12, 34, 56)",
      },
      rect: { x: 0, y: 0, width: 180, height: 40 },
      childNodes: [{
        nodeType: 1,
        id: "inherited-current-color-outline-child",
        tag: "P",
        styles: {
          display: "block",
          color: "currentColor",
          outlineWidth: "2px",
          outlineStyle: "solid",
          outlineColor: "currentColor",
        },
        rect: { x: 0, y: 0, width: 160, height: 32 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0].outline).toMatchObject({
      color: "rgb(12, 34, 56)",
      width: 2,
    });
  });

  it("converts CSS Color 4 functions for gradients and borders", () => {
    const context = loadPluginFunctions();
    expect(context.parseColor("oklab(62% 0.1 0.08)")).toMatchObject({
      color: { r: expect.any(Number), g: expect.any(Number), b: expect.any(Number) },
      opacity: 1,
    });
    expect(context.parseColor("oklch(62% 0.18 30deg / 50%)")).toMatchObject({ opacity: 0.5 });
    expect(context.parseColor("color-mix(in srgb, red 25%, blue)")).toMatchObject({
      color: { r: expect.closeTo(0.25, 6), g: 0, b: expect.closeTo(0.75, 6) },
      opacity: 1,
    });
    const paints = context.gradientPaints("linear-gradient(90deg, color-mix(in srgb, red 25%, blue), oklch(60% 0.2 40))");
    expect(paints[0].gradientStops).toHaveLength(2);
    expect(context.parseColor("color(srgb 1 0 0 / 50%)")).toMatchObject({
      color: { r: 1, g: 0, b: 0 },
      opacity: 0.5,
    });
    expect(context.parseColor("color(srgb-linear 0.214041 0 0)")).toMatchObject({
      color: { r: expect.closeTo(0.5, 4), g: 0, b: 0 },
      opacity: 1,
    });
    expect(context.parseColor("color(display-p3 1 0 0)")).toMatchObject({
      color: { r: expect.any(Number), g: expect.any(Number), b: expect.any(Number) },
      opacity: 1,
    });
    expect(context.parseColor("hwb(0 20% 10% / 75%)")).toMatchObject({
      color: { r: expect.closeTo(0.9, 6), g: expect.closeTo(0.2, 6), b: expect.closeTo(0.2, 6) },
      opacity: 0.75,
    });
    expect(context.parseColor("lab(54.2917% 80.8125 69.8851)")).toMatchObject({
      color: { r: expect.any(Number), g: expect.any(Number), b: expect.any(Number) },
      opacity: 1,
    });
    expect(context.parseColor("lch(54.2917% 104.55 40.85 / 60%)")).toMatchObject({ opacity: 0.6 });
  });

  it("uses CSS's top-to-bottom default for directionless linear gradients", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints("linear-gradient(#f00, #00f)", 200, 100);
    expect(paints[0].gradientTransform[0][0]).toBeCloseTo(0, 8);
    expect(paints[0].gradientTransform[0][1]).toBeCloseTo(-1, 8);
    expect(paints[0].gradientTransform[0][2]).toBeCloseTo(0.5, 8);
    expect(paints[0].gradientTransform[1][0]).toBeCloseTo(1, 8);
    expect(paints[0].gradientTransform[1][1]).toBeCloseTo(0, 8);
    expect(paints[0].gradientTransform[1][2]).toBeCloseTo(0, 8);
  });

  it("maps diagonal CSS linear gradients to aspect-ratio-aware handles", () => {
    const context = loadPluginFunctions();
    const expectedMatchers = [
      { x: expect.closeTo(0.25, 6), y: 0 },
      { x: 0.75, y: 1 },
    ];
    expect(context.linearGradientHandles(135, 200, 100)).toEqual(expectedMatchers);
    const paints = context.gradientPaints("linear-gradient(to bottom right, #ff0000, #0000ff)", 200, 100);
    expect(paints[0].gradientTransform).toEqual([
      [0.5, -1, expect.closeTo(0.25, 6)],
      [1, 0.5, 0],
    ]);
    expect(paints[0]).not.toHaveProperty("gradientHandlePositions");
  });

  it("converts linear gradient pixel stops against the actual gradient line", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints("linear-gradient(90deg, #ff0000 20px, #0000ff 80px)", 200, 100);
    expect(paints[0].gradientStops).toMatchObject([
      { position: 0.1 },
      { position: 0.4 },
    ]);
  });

  it("accepts CSS's unitless zero as a gradient stop position", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints("linear-gradient(90deg, transparent 0, #fff 20px)", 200, 100);
    expect(paints[0].gradientStops).toMatchObject([
      { position: 0 },
      { position: 0.1 },
    ]);
  });

  it("uses the distance between pixel stops as a repeating gradient cycle", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints("repeating-linear-gradient(90deg, #000 10px, #fff 30px)", 200, 100);
    expect(paints[0].gradientStops).toMatchObject([
      { position: 0.5 },
      { position: 1 },
    ]);
  });

  it("keeps repeating gradients with omitted stop positions importable", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints("repeating-linear-gradient(90deg, #f00 10px, #0f0, #00f 30px)", 200, 100);
    expect(paints[0].gradientStops).toHaveLength(3);
    expect(paints[0].gradientStops.every(stop => Number.isFinite(stop.position))).toBe(true);
    const definition = context.svgGradientDefinition(
      "repeating-linear-gradient(90deg, #f00 10px, #0f0, #00f 30px)",
      200,
      100,
      "repeating-test",
    );
    expect(definition).toContain('spreadMethod="repeat"');
    expect(definition).toContain('offset="50%"');
  });

  it("keeps mixed percent and pixel gradient stops and interpolates omitted stops", () => {
    const context = loadPluginFunctions();
    const paints = context.gradientPaints("linear-gradient(90deg, #f00 10%, #0f0, #00f 40px)", 200, 100);
    expect(paints[0].gradientStops.map(stop => stop.position)).toEqual([
      0.1,
      expect.closeTo(0.15, 6),
      0.2,
    ]);
  });

  it("applies supported CSS background blend modes to gradient paints", () => {
    const context = loadPluginFunctions();
    const node = { width: 200, height: 100, fills: [] };
    node.fills = context.gradientPaints(
      "linear-gradient(90deg, #000, #fff), radial-gradient(circle, #f00, transparent)",
      node.width,
      node.height,
    );
    context.applyBackgroundBlendModes(node, {
      computedStyles: { backgroundBlendMode: "multiply, screen" },
    });
    expect(node.fills.map(paint => paint.blendMode)).toEqual(["MULTIPLY", "SCREEN"]);
  });

  it("reports a background paint blend mode that is silently normalized", () => {
    const context = loadPluginFunctions();
    const paint = { type: "GRADIENT_LINEAR" };
    Object.defineProperty(paint, "blendMode", {
      configurable: true,
      get: () => "NORMAL",
      set: () => {},
    });
    const report = importReport();
    context.applyBackgroundBlendModes({ fills: [paint] }, {
      id: "normalized-paint-blend",
      computedStyles: { backgroundBlendMode: "multiply" },
    }, report);

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "normalized-paint-blend",
        property: "paint.blendMode",
        expected: "MULTIPLY",
        actual: "NORMAL",
      }),
    ]));
  });

  it("repeats background blend and mask mode lists by layer", () => {
    const context = loadPluginFunctions();
    const node = { width: 200, height: 100, fills: [
      { type: "GRADIENT_LINEAR" },
      { type: "GRADIENT_RADIAL" },
      { type: "GRADIENT_LINEAR" },
    ] };
    context.applyBackgroundBlendModes(node, {
      computedStyles: { backgroundBlendMode: "multiply, screen" },
    });
    expect(node.fills.map(paint => paint.blendMode)).toEqual(["MULTIPLY", "SCREEN", "MULTIPLY"]);
    expect(context.repeatedListValue(["luminance", "alpha"], 2, "match-source")).toBe("luminance");
  });

  it("clears a stale background blend mode when the source returns to normal", () => {
    const context = loadPluginFunctions();
    const node = {
      fills: [{ type: "GRADIENT_LINEAR", blendMode: "MULTIPLY" }],
    };

    context.applyBackgroundBlendModes(node, {
      computedStyles: { backgroundBlendMode: "normal" },
    });

    expect(node.fills[0].blendMode).toBe("NORMAL");
  });

  it("resets stale background compositing when a compatibility style is trimmed", () => {
    const context = loadPluginFunctions();
    const node = {
      fills: [{ type: "GRADIENT_LINEAR", blendMode: "SCREEN" }],
    };

    context.applyBackgroundBlendModes(node, {});

    expect(node.fills[0].blendMode).toBe("NORMAL");
  });

  it("clears background layer indexes when a reused node loses its image background", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const pixel = "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=";
    const assets = [
      { id: "stale-background-a", url: "https://example.test/a.gif", data: pixel },
      { id: "stale-background-b", url: "https://example.test/b.gif", data: pixel },
    ];

    // Seed the private layer-index map with a two-layer URL background.
    context.backgroundImage(node, {
      id: "stale-background-source",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/a.gif), url(https://example.test/b.gif)",
      backgroundSize: "cover, cover",
      backgroundRepeat: "no-repeat, no-repeat",
    }, assets, { images: new Map(), vectors: new Map() });

    // The next capture removes the image declaration and writes a new
    // multi-layer gradient. Without cleanup, the old layer indexes reverse
    // the blend-mode list on the new gradient paints.
    context.backgroundImage(node, { id: "background-removed" }, assets, { images: new Map(), vectors: new Map() });
    expect(context.gradient(node, "linear-gradient(90deg, #f00, #00f), radial-gradient(circle, #fff, #000)")).toBe(true);
    context.applyBackgroundBlendModes(node, {
      computedStyles: { backgroundBlendMode: "screen, multiply" },
    });

    expect(node.fills.filter(paint => String(paint.type || "").startsWith("GRADIENT_")).map(paint => paint.blendMode))
      .toEqual(["SCREEN", "MULTIPLY"]);
  });

  it("maps a CSS border-image gradient to a native Figma stroke paint", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);

    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      stroke: {
        color: "rgba(0, 0, 0, 0)",
        gradient: "linear-gradient(90deg, #ff0000, #0000ff)",
        width: 2,
      },
    });

    expect(node.strokes).toHaveLength(1);
    expect(node.strokes[0].type).toBe("GRADIENT_LINEAR");
    expect(node.strokeWeight).toBe(2);
  });

  it("creates an image-backed border ring from a captured border-image URL", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    context.createBorderDecorations(node, {
      id: "image-border",
      type: "frame",
      rect: { width: 200, height: 100 },
      radius: [8, 8, 8, 8],
      borders: [{
        color: "rgba(0, 0, 0, 0)",
        width: 2,
        style: "solid",
        imageSource: "https://example.com/frame.png",
        imageAssetId: "asset-border-image",
        paintSlice: "24",
        paintRepeat: "round",
      }, undefined, undefined, undefined],
      computedStyles: {},
    }, [{
      id: "asset-border-image",
      kind: "image",
      src: "https://example.com/frame.png",
      data: "data:image/png;base64,ZmFrZQ==",
    }]);

    expect(capturedSvg).toContain("cssBorderImageSliceClip");
    expect(capturedSvg).toContain("data:image/png;base64,ZmFrZQ==");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-border-image");
    expect(node.children[0].getPluginData("open-canvas-border-image-fallback")).toBe("image-ring");
  });

  it("normalizes CSS border width strings across native and fallback paints", () => {
    const context = loadPluginFunctions();
    expect(context.borderPaintWidth({ width: "2px" })).toBe(2);
    expect(context.borderPaintWidth({ width: "2px", paintWidth: "3px" })).toBe(3);
    expect(context.borderPaintOutset({ paintOutset: "4px" })).toBe(4);

    const node = mockFigmaNode("FRAME");
    node.strokeTopWeight = 0;
    node.strokeRightWeight = 0;
    node.strokeBottomWeight = 0;
    node.strokeLeftWeight = 0;
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      borders: [0, 1, 2, 3].map(() => ({ width: "2px", color: "#336699", style: "solid" })),
    });
    expect([
      node.strokeTopWeight,
      node.strokeRightWeight,
      node.strokeBottomWeight,
      node.strokeLeftWeight,
    ]).toEqual([2, 2, 2, 2]);
  });

  it("keeps border-image paint width separate from the layout border width", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);

    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      computedStyles: { borderImageWidth: "3" },
      stroke: {
        color: "rgba(0, 0, 0, 0)",
        gradient: "linear-gradient(90deg, #ff0000, #0000ff)",
        width: 2,
        paintWidth: 6,
      },
    });

    expect(node.strokes[0].type).toBe("GRADIENT_LINEAR");
    expect(node.strokeWeight).toBe(6);
  });

  it("uses border-image paint width for solid native strokes and dash rhythm", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      stroke: {
        color: "#336699",
        style: "dashed",
        width: 2,
        paintWidth: 6,
      },
    });

    expect(node.strokeWeight).toBe(6);
    expect(node.dashPattern).toEqual([36, 24]);
  });

  it("uses painted widths for asymmetric per-side native strokes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      borders: [
        { color: "#336699", style: "solid", width: 2, paintWidth: 5 },
        { color: "#336699", style: "solid", width: 2, paintWidth: 7 },
        { color: "#336699", style: "solid", width: 2, paintWidth: 9 },
        { color: "#336699", style: "solid", width: 2, paintWidth: 11 },
      ],
    });

    expect([
      node.strokeTopWeight,
      node.strokeRightWeight,
      node.strokeBottomWeight,
      node.strokeLeftWeight,
    ]).toEqual([5, 7, 9, 11]);
  });

  it("accepts subpixel-normalized native dash patterns on read-back", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    Object.defineProperty(node, "dashPattern", {
      configurable: true,
      get: () => [36.004, 23.996],
      set: () => {},
    });
    const report = importReport();

    context.applyStrokePattern(node, {
      id: "subpixel-dash-pattern",
      borders: [{ style: "dashed", width: 6 }],
    }, report);

    expect(report.styleDegradations).toBe(0);
  });

  it("resolves H2D percentage border-image widths against the captured border-image area", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "percentage-border-image-width",
      tag: "DIV",
      styles: {
        borderTopWidth: "2px",
        borderRightWidth: "2px",
        borderBottomWidth: "2px",
        borderLeftWidth: "2px",
        borderTopStyle: "solid",
        borderRightStyle: "solid",
        borderBottomStyle: "solid",
        borderLeftStyle: "solid",
        borderTopColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: "transparent",
        borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
        borderImageWidth: "10% 20%",
      },
      rect: { x: 0, y: 0, width: 200, height: 100 },
      childNodes: [],
    }, { x: 0, y: 0, width: 200, height: 100 });

    expect(scene.borders.map(border => border.paintWidth)).toEqual([10, 40, 10, 40]);
  });

  it("resolves function border-image widths against each area axis", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "function-border-image-width",
      tag: "DIV",
      styles: {
        borderTopWidth: "2px",
        borderRightWidth: "2px",
        borderBottomWidth: "2px",
        borderLeftWidth: "2px",
        borderTopStyle: "solid",
        borderRightStyle: "solid",
        borderBottomStyle: "solid",
        borderLeftStyle: "solid",
        borderTopColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: "transparent",
        borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
        borderImageWidth: "calc(10% + 2px) min(20%, 30px)",
      },
      rect: { x: 0, y: 0, width: 200, height: 100 },
      childNodes: [],
    }, { x: 0, y: 0, width: 200, height: 100 });

    expect(scene.borders.map(border => border.paintWidth)).toEqual([12, 30, 12, 30]);
  });

  it("resolves function border-image outsets without changing layout width", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "function-border-image-outset",
      tag: "DIV",
      styles: {
        borderTopWidth: "2px",
        borderRightWidth: "2px",
        borderBottomWidth: "2px",
        borderLeftWidth: "2px",
        borderTopStyle: "solid",
        borderRightStyle: "solid",
        borderBottomStyle: "solid",
        borderLeftStyle: "solid",
        borderTopColor: "transparent",
        borderRightColor: "transparent",
        borderBottomColor: "transparent",
        borderLeftColor: "transparent",
        borderImageSource: "linear-gradient(90deg, #ff0000, #0000ff)",
        borderImageOutset: "calc(2px + 1px) min(3px, 5px)",
      },
      rect: { x: 0, y: 0, width: 200, height: 100 },
      childNodes: [],
    }, { x: 0, y: 0, width: 200, height: 100 });

    expect(scene.borders.map(border => border.paintOutset)).toEqual([3, 3, 3, 3]);
    expect(scene.borders.map(border => border.width)).toEqual([2, 2, 2, 2]);
  });

  it("resolves function border-image slices on their respective axes", () => {
    const context = loadPluginFunctions();

    expect(context.borderImageSliceGeometry(
      "calc(10% + 2%) min(20%, 30%) fill",
      200,
      100,
    )).toEqual({ top: 12, right: 40, bottom: 12, left: 40, fill: true });

    expect(context.borderImageSliceGeometry(
      "max(8, 12) clamp(10, 20, 30)",
      200,
      100,
    )).toEqual({ top: 12, right: 20, bottom: 12, left: 20, fill: false });
  });

  it("builds a nine-slice fallback for function border-image slices", () => {
    const context = loadPluginFunctions();
    let capturedSvg = "";
    context.figma.createNodeFromSvg = value => {
      capturedSvg = value;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);

    context.createBorderDecorations(node, {
      id: "function-border-image-slice",
      type: "frame",
      rect: { width: 200, height: 100 },
      radius: [0, 0, 0, 0],
      borders: [
        {
          color: "transparent",
          gradient: "linear-gradient(90deg, #ff0000, #0000ff)",
          width: 2,
          paintWidth: 12,
          paintSlice: "calc(10% + 2%) min(20%, 30%) fill",
          paintRepeat: "stretch",
        },
        undefined,
        undefined,
        undefined,
      ],
    });

    expect(capturedSvg).toContain("cssBorderSliceClip");
    expect(node.children[0]?.name).toBe("__css-border-gradient");
  });

  it("keeps border-image outset outside the captured frame bounds", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    let svg = "";
    context.figma.createNodeFromSvg = value => { svg = value; return mockFigmaNode("VECTOR"); };
    context.createBorderDecorations(node, {
      id: "outset-gradient-border",
      type: "frame",
      rect: { width: 200, height: 100 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "transparent", gradient: "linear-gradient(90deg, #ff0000, #0000ff)", width: 2, paintWidth: 2, paintOutset: 3 },
        { color: "transparent", gradient: "linear-gradient(90deg, #ff0000, #0000ff)", width: 2, paintWidth: 2, paintOutset: 3 },
        { color: "transparent", gradient: "linear-gradient(90deg, #ff0000, #0000ff)", width: 2, paintWidth: 2, paintOutset: 3 },
        { color: "transparent", gradient: "linear-gradient(90deg, #ff0000, #0000ff)", width: 2, paintWidth: 2, paintOutset: 3 },
      ],
    });
    expect(svg).toContain('width="206" height="106"');
    expect(node.children[0].x).toBe(-3);
    expect(node.children[0].y).toBe(-3);
  });

  it("maps a CSS conic border-image gradient to an angular stroke paint", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);

    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      stroke: {
        color: "rgba(0, 0, 0, 0)",
        gradient: "conic-gradient(from 90deg, #ff0000 0deg, #0000ff 180deg, #ff0000 360deg)",
        width: 2,
      },
    });

    expect(node.strokes).toHaveLength(1);
    expect(node.strokes[0].type).toBe("GRADIENT_ANGULAR");
    expect(node.strokeWeight).toBe(2);
  });

  it("reports a border width that Figma silently normalizes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let strokeWeight = 1;
    Object.defineProperty(node, "strokeWeight", {
      configurable: true,
      get: () => strokeWeight,
      set: () => { strokeWeight = 1; },
    });
    const report = importReport();
    context.visuals(node, {
      id: "normalized-border",
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      stroke: { color: "#336699", width: 3 },
    }, [], { report });

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "normalized-border",
        property: "strokeWeight",
        expected: 3,
        actual: 1,
      }),
    ]));
  });

  it("reports a corner radius that Figma silently normalizes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let topLeftRadius = 0;
    Object.defineProperty(node, "topLeftRadius", {
      configurable: true,
      get: () => topLeftRadius,
      set: () => { topLeftRadius = 0; },
    });
    const report = importReport();
    context.visuals(node, {
      id: "normalized-radius",
      type: "frame",
      opacity: 1,
      radius: [12, 8, 4, 2],
    }, [], { report });

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "normalized-radius",
        property: "topLeftRadius",
        expected: 12,
        actual: 0,
      }),
    ]));
  });

  it("keeps per-side weights on a gradient border-image stroke", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    node.strokeTopWeight = 0;
    node.strokeRightWeight = 0;
    node.strokeBottomWeight = 0;
    node.strokeLeftWeight = 0;
    const gradient = "linear-gradient(90deg, #ff0000, #0000ff)";

    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      borders: [
        { color: "transparent", gradient, width: 1 },
        { color: "transparent", gradient, width: 2 },
        { color: "transparent", gradient, width: 3 },
        { color: "transparent", gradient, width: 4 },
      ],
    });

    expect(node.strokes[0].type).toBe("GRADIENT_LINEAR");
    expect(node).toMatchObject({
      strokeTopWeight: 1,
      strokeRightWeight: 2,
      strokeBottomWeight: 3,
      strokeLeftWeight: 4,
    });
  });

  it("retains border-image slice and repeat metadata from H2D styles", () => {
    const context = loadPluginFunctions();
    const border = context.cssBorder({
      borderTopWidth: "2px",
      borderTopStyle: "solid",
      borderTopColor: "transparent",
      borderImageSource: "linear-gradient(90deg, #f00, #00f)",
      borderImageSlice: "30%",
      borderImageRepeat: "round",
    }, "Top");

    expect(border).toMatchObject({
      width: 2,
      paintSlice: "30%",
      paintRepeat: "round",
    });
  });

  it("serializes border-image constraints for post-import inspection", () => {
    const context = loadPluginFunctions();
    expect(context.authoredBorderImageMetadata({
      computedStyles: { borderImageSource: "linear-gradient(90deg, red, blue)", borderImageSlice: "30%", borderImageRepeat: "round" },
      borders: [{ gradient: "linear-gradient(90deg, red, blue)", paintOutset: 3 }, undefined, undefined, undefined],
    })).toEqual({
      source: "linear-gradient(90deg, red, blue)",
      slice: "30%",
      repeat: "round",
      outset: [3, 0, 0, 0],
    });
  });

  it("does not let a trimmed computed none hide the captured border-image source", () => {
    const context = loadPluginFunctions();
    expect(context.authoredBorderImageMetadata({
      computedStyles: { borderImageSource: "none", borderImageSlice: "20%" },
      borders: [{ gradient: "linear-gradient(90deg, red, blue)", paintSlice: "20%" }, undefined, undefined, undefined],
    })).toMatchObject({
      source: "linear-gradient(90deg, red, blue)",
      slice: "20%",
    });
  });

  it("reports non-stretch border-image repeat as an explicit visual degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "round-border-image",
      computedStyles: {},
      borders: [{ gradient: "linear-gradient(90deg, red, blue)", paintRepeat: "round", style: "solid" }],
    }, report);

    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes).toEqual([
      expect.objectContaining({ id: "round-border-image", message: expect.stringContaining("border-image-repeat round") }),
    ]);
  });

  it("uses the editable vector path for non-stretch border-image repeats", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    context.figma.createRectangle = () => {
      throw new Error("non-stretch gradient repeat must not use a solid rectangle");
    };
    const gradient = "linear-gradient(90deg, #f00, #00f)";
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "transparent", width: 2, style: "solid", gradient, paintSlice: "30%", paintRepeat: "round" },
        { color: "transparent", width: 2, style: "solid", gradient, paintSlice: "30%", paintRepeat: "round" },
        { color: "transparent", width: 2, style: "solid", gradient, paintSlice: "30%", paintRepeat: "round" },
        { color: "transparent", width: 2, style: "solid", gradient, paintSlice: "30%", paintRepeat: "round" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
    expect(svg).toContain('id="cssBorderSliceClip"');
    expect((svg.match(/viewBox="36 0 48 18"/g) || []).length).toBeGreaterThan(1);
  });

  it("does not report supported non-stretch nine-slice repeats as degradations", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "round-nine-slice",
      computedStyles: {},
      borders: [{ gradient: "linear-gradient(90deg, red, blue)", paintSlice: "30%", paintRepeat: "round", style: "solid" }],
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("does not report supported stretch border-image slices as a degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "sliced-border-image",
      computedStyles: {},
      borders: [{ gradient: "linear-gradient(90deg, red, blue)", paintSlice: "30% fill", style: "solid" }],
    }, report);

    expect(report.styleDegradations).toBe(0);
  });

  it("reports invalid border-image slice geometry as an explicit degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "invalid-sliced-border-image",
      computedStyles: {},
      borders: [{ gradient: "linear-gradient(90deg, red, blue)", paintSlice: "invalid fill", style: "solid" }],
    }, report);

    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("cannot be mapped to editable nine-slice");
  });

  it("uses the editable vector path for non-default border-image slices", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    context.figma.createRectangle = () => {
      throw new Error("sliced gradient border must not use a solid rectangle");
    };
    const gradient = "linear-gradient(90deg, #f00, #00f)";
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "transparent", width: 2, style: "solid", gradient, paintSlice: "30%" },
        { color: "transparent", width: 2, style: "solid", gradient, paintSlice: "30%" },
        { color: "transparent", width: 2, style: "solid", gradient, paintSlice: "30%" },
        { color: "transparent", width: 2, style: "solid", gradient, paintSlice: "30%" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
    expect(svg).toContain('id="cssBorderSliceClip"');
    expect(svg).toContain('viewBox="0 0 36 18"');
    expect(svg).toContain('viewBox="36 0 48 18"');
    expect(svg).not.toContain('viewBox="36 18 48 24"');
  });

  it("paints the border-image fill center when the slice requests fill", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const gradient = "linear-gradient(90deg, #f00, #00f)";
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [0, 1, 2, 3].map(() => ({
        color: "transparent",
        width: 4,
        style: "solid",
        gradient,
        paintSlice: "30% fill",
      })),
    });
    expect(parent.children[0].name).toBe("__css-border-gradient");
    expect(svg).toContain('id="cssBorderSliceClip"');
    expect(svg).toContain('viewBox="36 18 48 24"');
    expect(svg).not.toContain('fill-rule="evenodd"');
  });

  it("keeps fill-center semantics on elliptical gradient border vectors", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const gradient = "linear-gradient(90deg, #f00, #00f)";
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      borders: [0, 1, 2, 3].map(() => ({
        color: "transparent",
        width: 4,
        style: "solid",
        gradient,
        paintSlice: "20% fill",
      })),
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
      },
    });
    expect(parent.children[0].name).toBe("__css-border-elliptical");
    expect(svg).toContain('id="cssBorderEllipticalSliceClip"');
    expect(svg).toContain('fill="url(#cssBorderEllipticalGradient)"');
    expect(svg).not.toContain('fill-rule="evenodd"');
  });

  it("does not cut the center out of conic border-image fill vectors", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const gradient = "conic-gradient(from 45deg, #f00 0deg, #00f 180deg, #f00 360deg)";
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [0, 1, 2, 3].map(() => ({
        color: "transparent",
        width: 4,
        style: "solid",
        gradient,
        paintSlice: "25% fill",
      })),
    });
    expect(svg).toContain('id="cssBorderSliceClip"');
    expect(svg).toContain('viewBox="30 15 60 30"');
    expect(svg).not.toContain('fill-rule="evenodd"');
  });

  it("keeps captured text boxes fixed instead of reflowing with Figma metrics", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.type = "TEXT";
    node.textAutoResize = "NONE";
    context.applyTextSizing(node, {
      type: "text",
      text: { content: "Label", lineCount: 1 },
      layout: { widthMode: "hug" },
    });
    expect(node.textAutoResize).toBe("NONE");
  });

  it("keeps wrapped fill text at the captured box instead of rewrapping", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.type = "TEXT";
    node.textAutoResize = "HEIGHT";
    context.applyTextSizing(node, {
      type: "text",
      text: { content: "Wrapped label", lineCount: 2 },
      layout: { widthMode: "fill" },
    });
    expect(node.textAutoResize).toBe("NONE");
  });

  it("restores safe single-line HUG text sizing when the captured box is stable", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAutoResize = "NONE";
    node.resize(72, 20);
    const report = importReport();
    const scene = {
      id: "hug-label",
      type: "text",
      rect: { width: 72, height: 20 },
      layout: { widthMode: "hug", heightMode: "hug" },
      text: { content: "Label", lineCount: 1, textOverflow: "clip" },
    };

    expect(context.restoreStableTextAutoResize(scene, node, report)).toBe(true);
    expect(node.textAutoResize).toBe("WIDTH_AND_HEIGHT");
    expect(node.getPluginData("open-canvas-text-auto-resize")).toBe("WIDTH_AND_HEIGHT");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("does not repeat the same HUG write but retries after the captured intent changes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAutoResize = "NONE";
    node.resize(72, 20);
    const report = importReport();
    const scene = {
      id: "reused-hug-label",
      type: "text",
      rect: { width: 72, height: 20 },
      layout: { widthMode: "hug", heightMode: "hug" },
      text: { content: "Label", lineCount: 1, textOverflow: "clip" },
    };

    expect(context.restoreStableTextAutoResize(scene, node, report)).toBe(true);
    expect(context.restoreStableTextAutoResize(scene, node, report)).toBe(false);

    scene.rect.width = 84;
    node.resize(84, 20);
    expect(context.restoreStableTextAutoResize(scene, node, report)).toBe(true);
    expect(node.textAutoResize).toBe("WIDTH_AND_HEIGHT");
  });

  it("clears stale HUG metadata when the source sizing intent becomes fixed", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAutoResize = "WIDTH_AND_HEIGHT";
    node.setPluginData("open-canvas-text-auto-resize", "WIDTH_AND_HEIGHT");
    node.setPluginData("open-canvas-text-auto-resize-attempted", "legacy");

    expect(context.restoreStableTextAutoResize({
      id: "reused-fixed-label",
      type: "text",
      rect: { width: 84, height: 20 },
      layout: { widthMode: "fixed", heightMode: "fixed" },
      text: { content: "Label", lineCount: 1, textOverflow: "clip" },
    }, node, importReport())).toBe(false);

    expect(node.textAutoResize).toBe("NONE");
    expect(node.getPluginData("open-canvas-text-auto-resize")).toBe("NONE");
    expect(node.getPluginData("open-canvas-text-auto-resize-attempted")).toBe("");
  });

  it("restores safe multiline HEIGHT HUG when width is stable", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAutoResize = "NONE";
    node.resize(72, 40);
    const report = importReport();

    expect(context.restoreStableTextAutoResize({
      id: "wrapped-label-height-hug",
      type: "text",
      rect: { width: 72, height: 40 },
      layout: { widthMode: "fixed", heightMode: "hug" },
      text: { content: "First\nSecond", lineCount: 2 },
    }, node, report)).toBe(true);
    expect(node.textAutoResize).toBe("HEIGHT");
    expect(node.getPluginData("open-canvas-text-auto-resize")).toBe("HEIGHT");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("restores HEIGHT HUG for a single-line fill-width text track", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAutoResize = "NONE";
    node.resize(160, 20);
    const report = importReport();

    expect(context.restoreStableTextAutoResize({
      id: "fill-width-single-line-label",
      type: "text",
      rect: { width: 160, height: 20 },
      layout: { widthMode: "fill", heightMode: "hug" },
      text: { content: "Label", lineCount: 1 },
    }, node, report)).toBe(true);
    expect(node.textAutoResize).toBe("HEIGHT");
    expect(node.getPluginData("open-canvas-text-auto-resize")).toBe("HEIGHT");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("restores fill-width HEIGHT sizing without losing captured line-height", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "Label";
    node.resize(160, 28);
    let storedLineHeight = { unit: "PIXELS", value: 28 };
    let autoResize = "NONE";
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => storedLineHeight,
      set: value => { storedLineHeight = value; },
    });
    Object.defineProperty(node, "textAutoResize", {
      configurable: true,
      get: () => autoResize,
      set: value => {
        autoResize = value;
        if (value === "HEIGHT") storedLineHeight = { unit: "AUTO", value: 0 };
      },
    });
    const report = importReport();
    const scene = {
      id: "fill-width-line-height-label",
      type: "text",
      rect: { width: 160, height: 28 },
      layout: { widthMode: "fill", heightMode: "hug" },
      text: { content: "Label", lineCount: 1, lineHeight: 28 },
      children: [],
    };

    expect(context.restoreStableTextAutoResize(scene, node, report)).toBe(true);
    expect(node.textAutoResize).toBe("HEIGHT");
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });

    context.verifySceneLineHeights(scene, node, report);

    expect(node).toMatchObject({ width: 160, height: 28, textAutoResize: "HEIGHT" });
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("restores the captured multiline box when the final line-height write collapses HUG height", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "City Lions vs. Harbour FC";
    node.textAutoResize = "HEIGHT";
    node.layoutSizingHorizontal = "FILL";
    node.layoutSizingVertical = "HUG";
    node.resize(228.2, 44);
    let storedLineHeight = { unit: "AUTO", value: 0 };
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => storedLineHeight,
      set: value => {
        storedLineHeight = value;
        if (value?.unit === "PIXELS") node.height = 22;
      },
    });
    const report = importReport();
    const scene = {
      id: "node-15",
      type: "text",
      rect: { x: 0, y: 0, width: 228.2, height: 44 },
      layout: { mode: "none", widthMode: "fill", heightMode: "hug" },
      text: { content: node.characters, lineCount: 2, lineHeight: 22 },
      children: [],
    };

    context.verifySceneLineHeights(scene, node, report);

    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 22 });
    expect(node).toMatchObject({ width: 228.2, height: 44, textAutoResize: "NONE" });
    expect(node.layoutSizingHorizontal).toBe("FILL");
    expect(node.layoutSizingVertical).toBe("FIXED");
    expect(node.getPluginData("open-canvas-text-auto-resize")).toBe("NONE");
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightFailures).toBe(0);
    expect(report.sizingFallbackNodes[0]).toMatchObject({
      id: "node-15",
      kind: "text-line-height-geometry",
      expectedWidth: 228.2,
      expectedHeight: 44,
      actualWidth: 228.2,
      actualHeight: 22,
      widthDelta: 0,
      heightDelta: 22,
    });

    // Later parent-sizing convergence must respect the line-height geometry
    // lock instead of restoring HUG and collapsing the text back to one line.
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.appendChild(node);
    context.restoreParentSizingAxis(scene, node, {
      id: "node-15-parent",
      rect: { width: 240, height: 80 },
      layout: { mode: "vertical" },
      children: [scene],
    }, parent, "height", report);
    expect(node).toMatchObject({ height: 44, textAutoResize: "NONE" });
    expect(node.layoutSizingVertical).toBe("FIXED");
  });

  it("keeps a HUG parent from collapsing when multiline line-height is restored", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.layoutSizingVertical = "HUG";
    parent.resize(240, 22);
    const text = mockFigmaNode("TEXT");
    text.characters = "City Lions vs. Harbour FC";
    text.parent = parent;
    parent.children = [text];
    const report = importReport();
    const scene = {
      id: "hug-parent-line-height",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 44 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug" },
      children: [{
        id: "hug-parent-line-height-text",
        type: "text",
        rect: { x: 0, y: 0, width: 240, height: 44 },
        layout: { mode: "none", widthMode: "fixed", heightMode: "hug" },
        text: { content: text.characters, lineCount: 2, lineHeight: 22 },
        children: [],
      }],
    };

    context.verifySceneLineHeights(scene, parent, report);

    expect(parent.height).toBe(44);
    expect(parent.layoutSizingVertical).toBe("FIXED");
    expect(report.sizingFallbackNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "hug-parent-line-height",
        kind: "line-height-parent-geometry",
        axis: "height",
        expectedHeight: 44,
        actualHeight: 22,
      }),
    ]));
  });

  it("keeps multiline width-HUG text fixed to protect wrapping geometry", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAutoResize = "NONE";
    const report = importReport();

    expect(context.restoreStableTextAutoResize({
      id: "wrapped-label-width-hug",
      type: "text",
      rect: { width: 72, height: 40 },
      layout: { widthMode: "hug", heightMode: "hug" },
      text: { content: "First\nSecond", lineCount: 2 },
    }, node, report)).toBe(false);
    expect(node.textAutoResize).toBe("NONE");
  });

  it("falls back to fixed multiline text when HEIGHT HUG changes the captured box", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAutoResize = "NONE";
    Object.defineProperty(node, "textAutoResize", {
      configurable: true,
      get: () => node.__autoResize || "NONE",
      set: value => {
        node.__autoResize = value;
        if (value === "HEIGHT") node.height = 52;
      },
    });
    node.resize(72, 40);
    const report = importReport();

    expect(context.restoreStableTextAutoResize({
      id: "wrapped-label-height-fallback",
      type: "text",
      rect: { width: 72, height: 40 },
      layout: { widthMode: "fixed", heightMode: "hug" },
      text: { content: "First\nSecond", lineCount: 2 },
    }, node, report)).toBe(false);
    expect(node.textAutoResize).toBe("NONE");
    expect(node.width).toBe(72);
    expect(node.height).toBe(40);
    expect(report.sizingFallbackNodes[0]).toMatchObject({
      id: "wrapped-label-height-fallback",
      kind: "text-auto-resize",
    });
  });

  it("applies and reports captured pixel line-height", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "multiline-copy",
      type: "text",
      text: { content: "First line\nSecond line", lineHeight: 24 },
    }, report)).toBe(true);

    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 24 });
    expect(node.getPluginData("open-canvas-line-height")).toBe("24");
    expect(node.getPluginData("open-canvas-line-height-unit")).toBe("PIXELS");
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightNodes).toEqual([{ id: "multiline-copy", value: 24 }]);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("counts captured text line-heights before import", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      children: [
        {
          id: "heading",
          type: "text",
          text: { content: "Heading", fontSize: 24, lineHeight: 32 },
          children: [],
        },
        {
          id: "copy",
          type: "frame",
          children: [{
            id: "copy-run",
            type: "text",
            text: { content: "Copy", fontSize: 16, lineHeight: 24 },
            children: [],
          }],
        },
      ],
    };

    expect(context.countSceneLineHeights(scene)).toBe(2);
  });

  it("restores a trimmed child line-height from its wrapper before import", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "trimmed-line-height-root",
      type: "frame",
      computedStyles: { lineHeight: "28px", fontSize: "18px" },
      children: [{
        id: "trimmed-line-height-copy",
        type: "text",
        text: { content: "First\nSecond", fontSize: 18 },
        children: [],
      }],
    };

    context.inheritMissingSceneLineHeights(scene);

    expect(scene.children[0].text.lineHeight).toBe(28);
  });

  it("restores a child line-height when the compatibility payload retains inherit", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "keyword-inherited-line-height-root",
      type: "frame",
      computedStyles: { lineHeight: "28px", fontSize: "18px" },
      children: [{
        id: "keyword-inherited-line-height-copy",
        type: "text",
        computedStyles: { lineHeight: "inherit", fontSize: "18px" },
        text: { content: "First\nSecond", fontSize: 18 },
        children: [],
      }],
    };

    context.inheritMissingSceneLineHeights(scene);

    expect(scene.children[0].text.lineHeight).toBe(28);
  });

  it("writes inherited line-height onto the attached Figma text node", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    context.figma.createText = () => {
      const node = mockFigmaNode("TEXT");
      node.textAutoResize = "NONE";
      node.fontName = { family: "Inter", style: "Regular" };
      node.fontSize = 16;
      node.characters = "";
      return node;
    };
    context.figma.loadFontAsync = async () => {};
    const scene = {
      id: "inherited-line-height-import-root",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      computedStyles: { lineHeight: "28px", fontSize: "18px" },
      layout: { mode: "vertical", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
      children: [{
        id: "inherited-line-height-import-copy",
        type: "text",
        rect: { x: 0, y: 0, width: 200, height: 56 },
        text: { content: "First\nSecond", fontSize: 18 },
        children: [],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
      }],
    };
    context.inheritMissingSceneLineHeights(scene);
    const report = importReport();
    const imported = await context.createNode(scene, mockFigmaNode("PAGE"), [], report, undefined, {
      images: new Map(),
      vectors: new Map(),
    });
    const text = context.sceneChildren(imported)[0];

    expect(scene.children[0].text.lineHeight).toBe(28);
    expect(text.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(text.getPluginData("open-canvas-line-height")).toBe("28");
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("replaces a generic fallback left beside an inherited child line-height", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "generic-inherited-line-height-root",
      type: "frame",
      computedStyles: { lineHeight: "28px", fontSize: "18px" },
      children: [{
        id: "generic-inherited-line-height-copy",
        type: "text",
        computedStyles: { lineHeight: "inherit", fontSize: "16px" },
        // Legacy bridges sometimes leave the normal 1.2em fallback here even
        // though the authored child declaration is `inherit`.
        text: { content: "First\nSecond", fontSize: 16, lineHeight: 19.2 },
        children: [],
      }],
    };

    context.inheritMissingSceneLineHeights(scene);

    expect(scene.children[0].text.lineHeight).toBe(28);
  });

  it("recovers a generic anonymous-run fallback when the bridge trims inheritance metadata", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "trimmed-anonymous-line-height-root",
      type: "frame",
      computedStyles: { lineHeight: "28px", fontSize: "18px" },
      children: [{
        id: "trimmed-anonymous-line-height-run",
        sourceTag: "#text",
        type: "text",
        // The bridge retained only the default 1.2em number (16px * 1.2)
        // and dropped both the authored `inherit` token and computed style.
        text: { content: "First\nSecond", fontSize: 16, lineHeight: 19.2 },
        children: [],
      }],
    };

    context.inheritMissingSceneLineHeights(scene);

    expect(scene.children[0].text.lineHeight).toBe(28);
  });

  it("marks H2D anonymous text runs so measured inherited leading can be recovered", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "anonymous-line-height-wrapper",
      tag: "DIV",
      styles: { display: "flex", flexDirection: "column", fontSize: "18px", lineHeight: "28px" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 3,
        id: "anonymous-line-height-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        lineCount: 2,
        // The marker and style channels were trimmed; this is only the
        // generic 1.2em value left by an older bridge.
        lineHeight: 19.2,
        styles: { fontSize: "16px" },
      }],
    }, { x: 0, y: 0 });

    context.inheritMissingSceneLineHeights(scene);
    const importedText = scene.children?.[0];
    expect(importedText).toMatchObject({
      sourceTag: "#text",
      type: "text",
      text: { lineHeight: 28 },
    });
  });

  it("recovers an anonymous normal line-height from its explicit parent", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "normal-anonymous-line-height-root",
      type: "frame",
      computedStyles: { lineHeight: "28px", fontSize: "18px" },
      children: [{
        id: "normal-anonymous-line-height-run",
        sourceTag: "#text",
        type: "text",
        computedStyles: { lineHeight: "normal", fontSize: "16px" },
        // Compatibility bridges can retain `normal` while the numeric field
        // is only the generic 1.2em fallback. A raw text node has no authored
        // declaration of its own, so it must inherit the wrapper's 28px box.
        text: { content: "First\nSecond", fontSize: 16, lineHeight: 19.2 },
        children: [],
      }],
    };

    context.inheritMissingSceneLineHeights(scene);

    expect(scene.children[0].text.lineHeight).toBe(28);
  });

  it("carries inherited line-height through trimmed normal wrappers", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "nested-normal-line-height-root",
      type: "frame",
      computedStyles: { lineHeight: "28px", fontSize: "18px" },
      children: [{
        id: "nested-normal-line-height-wrapper",
        type: "frame",
        computedStyles: { lineHeight: "normal", fontSize: "18px" },
        children: [{
          id: "nested-normal-line-height-run",
          sourceTag: "#text",
          type: "text",
          computedStyles: { lineHeight: "normal", fontSize: "16px" },
          text: { content: "First\nSecond", fontSize: 16, lineHeight: 19.2 },
          children: [],
        }],
      }],
    };

    context.inheritMissingSceneLineHeights(scene);

    expect(scene.children[0].children[0].text.lineHeight).toBe(28);
  });

  it("uses the resolved line-height compatibility marker when text fields are trimmed", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "marker-only-line-height",
      type: "text",
      attributes: { "data-open-canvas-line-height": "28px" },
      computedStyles: {},
      text: { content: "First\nSecond", fontSize: 18 },
    };

    expect(context.sceneLineHeight(scene)).toBe(28);
  });

  it("lets a measured marker override a stale numeric line-height on the final write path", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "stale-scene-line-height-marker",
      type: "text",
      attributes: { "data-open-canvas-line-height": "28px" },
      computedStyles: { lineHeight: "inherit", fontSize: "16px" },
      text: { content: "First\nSecond", fontSize: 16, lineHeight: 19.2 },
    };

    // Older clipboard bridges can retain the generic 1.2em numeric field
    // even after the browser measured the inherited 28px line box. The
    // marker must remain authoritative all the way through TextNode writes.
    expect(context.sceneLineHeight(scene)).toBe(28);
  });

  it("recovers measured inherited leading when a legacy bridge trims the marker", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "trimmed-measured-line-height",
      sourceTag: "#text",
      type: "text",
      rect: { x: 0, y: 0, width: 220, height: 56 },
      text: { content: "First\nSecond", fontSize: 16, lineCount: 2, lineHeight: 19.2 },
    };

    // The only remaining numeric value is the generic 1.2em fallback. The
    // measured two-line rectangle still proves a 28px line box.
    expect(context.sceneLineHeight(scene)).toBe(28);
  });

  it("uses the measured textRect instead of padded element geometry for trimmed leading", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "trimmed-padded-element-line-height",
      type: "text",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      textRect: { x: 8, y: 10, width: 220, height: 56 },
      textLineRects: [
        { x: 8, y: 10, width: 180, height: 18 },
        { x: 8, y: 38, width: 160, height: 18 },
      ],
      text: { content: "First\nSecond", fontSize: 16, lineCount: 2, lineHeight: 19.2 },
    };

    // The outer element includes 12px/12px padding. A trimmed payload must
    // infer the 28px line box from the painted text inset, not 40px from the
    // padded border box.
    expect(context.sceneLineHeight(scene)).toBe(28);
    const withoutLineRects = { ...scene, textLineRects: undefined };
    expect(context.sceneLineHeight(withoutLineRects)).toBe(19.2);
  });

  it("lets a measured line-height marker replace a stale anonymous numeric fallback", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "stale-anonymous-line-height-marker",
      tag: "DIV",
      styles: { display: "block", fontSize: "18px", lineHeight: "28px" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 1,
        id: "stale-anonymous-line-height-wrapper",
        tag: "SPAN",
        styles: { display: "inline" },
        rect: { x: 0, y: 0, width: 220, height: 56 },
        childNodes: [{
          nodeType: 3,
        id: "stale-anonymous-line-height-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        lineCount: 2,
        // Legacy bridges can leave the generic 1.2em numeric fallback beside
        // the resolved marker captured from the owning wrapper.
        lineHeight: 19.2,
        attributes: { "data-open-canvas-line-height": "28px" },
        }],
      }],
    }, { x: 0, y: 0 });

    const importedText = scene.children?.[0] || scene;
    expect(importedText).toMatchObject({
      type: "text",
      text: { lineHeight: 28 },
    });
  });

  it("does not let a generic marker overwrite a captured inherited line box", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "generic-line-height-marker",
      sourceTag: "#text",
      type: "text",
      attributes: { "data-open-canvas-line-height": "19.2px" },
      // The child is 16px, so 19.2px is only the legacy 1.2em default. The
      // capture already resolved the parent's inherited 28px line box.
      text: { content: "First\nSecond", fontSize: 16, lineCount: 2, lineHeight: 28 },
    };

    expect(context.sceneLineHeight(scene)).toBe(28);
  });

  it("protects a string-serialized captured line box from a generic marker", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "string-generic-line-height-marker",
      sourceTag: "#text",
      type: "text",
      attributes: { "data-open-canvas-line-height": "19.2px" },
      text: { content: "First\nSecond", fontSize: 16, lineCount: 2, lineHeight: "28px" },
    };

    expect(context.sceneLineHeight(scene)).toBe(28);
  });

  it("resolves relative line-height markers against a CSS font-size string", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "relative-line-height-font-size-string",
      type: "text",
      attributes: { "data-open-canvas-line-height": "150%" },
      computedStyles: { fontSize: "20px" },
      text: { content: "First\nSecond" },
    };

    expect(context.sceneLineHeight(scene)).toBe(30);
  });

  it("resolves relative and functional font sizes before line-height inheritance", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "relative-font-size-root",
      tag: "DIV",
      styles: { display: "block", fontSize: "1.25rem", lineHeight: "1.5" },
      rect: { x: 0, y: 0, width: 320, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "relative-font-size-child",
        tag: "SPAN",
        styles: { display: "inline", fontSize: "150%", lineHeight: "1.2" },
        rect: { x: 0, y: 0, width: 200, height: 36 },
        childNodes: [{
          nodeType: 3,
          id: "relative-font-size-run",
          text: "Relative type",
          rect: { x: 0, y: 0, width: 200, height: 36 },
          lineCount: 1,
        }],
      }],
    }, { x: 0, y: 0, width: 1200, height: 800 }, 16, "", 16, {}, {
      width: 1200,
      height: 800,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    const text = scene.children[0];
    expect(scene.computedStyles).toMatchObject({ fontSize: "20px", fontSizeExpression: "1.25rem" });
    expect(text.computedStyles).toMatchObject({ fontSize: "30px", fontSizeExpression: "150%" });
    expect(text.text).toMatchObject({ fontSize: 30, lineHeight: 36 });
  });

  it("uses resolved functional font size for em visual boundaries", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "functional-font-size-card",
      tag: "DIV",
      styles: {
        display: "block",
        fontSize: "clamp(1rem, 2dvw, 32px)",
        padding: "1em",
        borderTopWidth: "0.1em",
        borderTopStyle: "solid",
        borderTopColor: "#000000",
        boxShadow: "0 0.5em 1em currentColor",
      },
      rect: { x: 0, y: 0, width: 320, height: 160 },
      childNodes: [],
    }, { x: 0, y: 0, width: 1200, height: 800 }, 16, "", 16, {}, {
      width: 1200,
      height: 800,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(scene.computedStyles).toMatchObject({
      fontSize: "24px",
      fontSizeExpression: "clamp(1rem, 2dvw, 32px)",
    });
    expect(scene.layout.padding).toEqual([24, 24, 24, 24]);
    expect(scene.borders[0].width).toBeCloseTo(2.4, 8);
    expect(scene.shadow).toMatchObject({ offsetY: 12, blur: 24 });
  });

  it("uses relative shared-scene font sizes for em sizing constraints", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    const scene = {
      rootFontSize: 16,
      viewportWidth: 1200,
      viewportHeight: 800,
      computedStyles: { fontSize: "1.25rem", minWidth: "10em" },
    };

    expect(context.sceneFontSize(scene)).toBe(20);
    context.applySizingConstraints(node, scene, undefined, { width: 1200, height: 800, rootFontSize: 16 });
    expect(node.minWidth).toBe(200);
  });

  it("resolves H2D text spacing and indent units before Figma text writes", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "relative-text-spacing",
      tag: "P",
      styles: {
        display: "block",
        width: "320px",
        fontSize: "20px",
        letterSpacing: "0.05em",
        wordSpacing: "calc(0.25rem + 2px)",
        textIndent: "10%",
      },
      rect: { x: 0, y: 0, width: 320, height: 48 },
      childNodes: [{
        nodeType: 3,
        id: "relative-text-spacing-run",
        text: "Indented text",
        rect: { x: 0, y: 0, width: 280, height: 48 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0, width: 1200, height: 800 }, 16, "", 16, {}, {
      width: 1200,
      height: 800,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    const text = scene;
    expect(text.computedStyles).toMatchObject({
      letterSpacing: "1px",
      wordSpacing: "6px",
    });
    expect(text.text).toMatchObject({
      fontSize: 20,
      letterSpacing: 1,
      wordSpacing: 6,
      textIndent: 32,
    });
  });

  it("keeps negative relative letter spacing and resolves child text spacing against its own font", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "nested-relative-text-spacing",
      tag: "DIV",
      styles: { display: "block", fontSize: "20px", letterSpacing: "-0.1em" },
      rect: { x: 0, y: 0, width: 320, height: 40 },
      childNodes: [{
        nodeType: 1,
        id: "nested-relative-text-spacing-wrapper",
        tag: "SPAN",
        styles: { display: "inline", fontSize: "150%", wordSpacing: "0.5em" },
        rect: { x: 0, y: 0, width: 240, height: 40 },
        childNodes: [{
          nodeType: 3,
          id: "nested-relative-text-spacing-run",
          text: "Nested",
          rect: { x: 0, y: 0, width: 160, height: 40 },
          lineCount: 1,
        }],
      }],
    }, { x: 0, y: 0, width: 1200, height: 800 }, 16, "", 16, {}, {
      width: 1200,
      height: 800,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    const text = scene.children[0];
    expect(text.text).toMatchObject({ fontSize: 30, letterSpacing: -2, wordSpacing: 15 });
  });

  it("resolves multiplicative and divisive calc line-height expressions", () => {
    const context = loadPluginFunctions();
    expect(context.textLineHeightValue("calc(1.5 * 1em)", 16)).toBe(24);
    expect(context.textLineHeightValue("calc(28px / 2)", 16)).toBe(14);
    expect(context.textLineHeightValue("calc(1.5 * 1em + 2px)", 16)).toBe(26);
    expect(context.textLineHeightValue("calc(1em * 2px)", 16)).toBeCloseTo(19.2, 8);
  });

  it("resolves a trimmed child against a unitless inherited multiplier", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "unitless-inherited-line-height-root",
      type: "frame",
      computedStyles: { lineHeight: "1.5", fontSize: "20px" },
      children: [{
        id: "unitless-inherited-line-height-copy",
        type: "text",
        text: { content: "First\nSecond", fontSize: 24 },
        children: [],
      }],
    };

    context.inheritMissingSceneLineHeights(scene);

    expect(scene.children[0].text.lineHeight).toBe(36);
  });

  it("applies and verifies captured first-line paragraph indent", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.paragraphIndent = 0;
    const report = importReport();

    expect(context.applySceneTextIndent(node, {
      id: "indented-copy",
      type: "text",
      text: { content: "First line\nSecond line", textIndent: 32 },
    }, report)).toBe(true);

    expect(node.paragraphIndent).toBe(32);
    expect(node.getPluginData("open-canvas-text-indent")).toBe("32");
    expect(node.getPluginData("open-canvas-text-indent-unit")).toBe("PIXELS");
    expect(report.styleDegradations).toBe(0);
  });

  it("clears stale first-line paragraph indent when text-indent returns to zero", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.paragraphIndent = 32;
    node.setPluginData("open-canvas-text-indent", "32");
    node.setPluginData("open-canvas-text-indent-unit", "PIXELS");

    expect(context.applySceneTextIndent(node, {
      id: "reused-indented-copy",
      type: "text",
      text: { content: "Plain copy", textIndent: 0 },
    }, importReport())).toBe(true);

    expect(node.paragraphIndent).toBe(0);
    expect(node.getPluginData("open-canvas-text-indent")).toBe("");
    expect(node.getPluginData("open-canvas-text-indent-unit")).toBe("");
  });

  it("reports a missing paragraph-indent API instead of silently dropping it", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();

    expect(context.applySceneTextIndent(node, {
      id: "unsupported-indent-copy",
      type: "text",
      text: { content: "First line\nSecond line", textIndent: 24 },
    }, report)).toBe(false);

    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0]).toMatchObject({ id: "unsupported-indent-copy" });
    expect(report.styleDegradationNodes[0].message).toContain("paragraphIndent");
  });

  it("falls back to the range line-height API when the node setter is normalized", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    let stored = { unit: "AUTO", value: 0 };
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => stored,
      set: () => { stored = { unit: "AUTO", value: 0 }; },
    });
    node.setRangeLineHeight = (_start, _end, value) => { stored = value; };
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "range-line-height-copy",
      type: "text",
      text: { content: node.characters, lineHeight: 30 },
    }, report)).toBe(true);

    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 30 });
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("accepts a range-only line-height write when the node remains AUTO", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    let rangeValue = { unit: "AUTO", value: 0 };
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = (_start, _end, value) => { rangeValue = value; };
    node.getRangeLineHeight = () => rangeValue;
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "range-only-line-height-copy",
      type: "text",
      text: { content: node.characters, lineHeight: 32 },
    }, report)).toBe(true);

    expect(node.lineHeight).toEqual({ unit: "AUTO", value: 0 });
    expect(node.getRangeLineHeight(0, node.characters.length)).toEqual({ unit: "PIXELS", value: 32 });
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightFailures).toBe(0);
    expect(report.lineHeightReadBackNodes).toEqual([expect.objectContaining({
      id: "range-only-line-height-copy",
      expected: 32,
      actual: 32,
      unit: "PIXELS",
      range: { unit: "PIXELS", value: 32 },
    })]);
  });

  it("supports runtimes that expose only range line-height APIs", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    delete node.lineHeight;
    node.characters = "First line\nSecond line";
    let rangeValue = { unit: "AUTO", value: 0 };
    node.setRangeLineHeight = (_start, _end, value) => { rangeValue = value; };
    node.getRangeLineHeight = () => rangeValue;
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "range-only-api-copy",
      type: "text",
      text: { content: node.characters, lineHeight: 30 },
    }, report)).toBe(true);

    expect(node.getRangeLineHeight(0, node.characters.length)).toEqual({ unit: "PIXELS", value: 30 });
    expect(node.getPluginData("open-canvas-line-height")).toBe("30");
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("does not treat a node-level PIXELS read-back as success when the range remains AUTO", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    let rangeValue = { unit: "AUTO", value: 0 };
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "PIXELS", value: 32 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => { rangeValue = { unit: "AUTO", value: 0 }; };
    node.getRangeLineHeight = () => rangeValue;
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "false-positive-line-height-copy",
      type: "text",
      text: { content: node.characters, lineHeight: 32 },
    }, report)).toBe(false);

    expect(report.lineHeightApplied).toBe(0);
    expect(report.lineHeightFailures).toBe(1);
    expect(report.lineHeightFailureNodes[0]).toMatchObject({
      id: "false-positive-line-height-copy",
      value: 32,
    });
  });

  it("does not fall back to node-level line-height when only the range getter exists", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "PIXELS", value: 28 }),
      set: () => {},
    });
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "read-only-range-line-height-copy",
      type: "text",
      text: { content: node.characters, lineHeight: 28 },
    }, report)).toBe(false);

    expect(report.lineHeightApplied).toBe(0);
    expect(report.lineHeightFailures).toBe(1);
  });

  it("deduplicates repeated line-height failures during convergence", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "PIXELS", value: 28 }),
      set: () => {},
    });
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    const scene = {
      id: "deduplicated-line-height-copy",
      type: "text",
      text: { content: node.characters, lineHeight: 28 },
    };
    const report = importReport();

    expect(context.applySceneLineHeight(node, scene, report)).toBe(false);
    expect(context.applySceneLineHeight(node, scene, report)).toBe(false);
    expect(report.lineHeightFailures).toBe(1);
    expect(report.lineHeightFailureNodes).toHaveLength(1);
  });

  it("keeps captured leading visible with an absolute SVG fallback when Figma normalizes AUTO", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    parent.appendChild(node);
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "fallback-line-height-copy",
      type: "text",
      rect: { x: 8, y: 12, width: 160, height: 56 },
      textRect: { x: 0, y: 0, width: 160, height: 56 },
      computedStyles: { direction: "rtl" },
      text: {
        content: "First line\nSecond line",
        lineCount: 2,
        lineHeight: 28,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "left",
        letterSpacing: 0,
      },
    }, report)).toBe(false);

    const fallback = parent.children.find(child => child.name === "__css-line-height-fallback-line-height-copy");
    expect(fallback).toBeTruthy();
    expect(fallback?.layoutPositioning).toBe("ABSOLUTE");
    expect(fallback?.getPluginData("open-canvas-line-height-owner")).toBe("fallback-line-height-copy");
    expect(context.sceneChildren(parent)).not.toContain(fallback);
    expect(node.opacity).toBe(0);
    expect(capturedSvg).toContain('font-size="16px"');
    expect(capturedSvg).toContain('direction="rtl"');
    expect(capturedSvg).toContain('y="44"');
    expect(report.lineHeightFailures).toBe(1);
    expect(report.lineHeightFallbacks).toBe(1);
    // The generic node paint pass may assign the captured opacity after the
    // first fallback creation; the owner synchronizer must hide the semantic
    // source again before the final tree is exposed.
    node.opacity = 1;
    expect(context.createLineHeightVisualFallback(node, {
      id: "fallback-line-height-copy",
      type: "text",
      rect: { x: 8, y: 12, width: 160, height: 56 },
      textRect: { x: 0, y: 0, width: 160, height: 56 },
      text: {
        content: "First line\nSecond line",
        lineCount: 2,
        lineHeight: 28,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "left",
        letterSpacing: 0,
      },
    }, report)).toBe(true);
    expect(node.opacity).toBe(0);
  });

  it("removes the visual fallback after a later native line-height write succeeds", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    parent.appendChild(node);
    let current = { unit: "AUTO", value: 0 };
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => current,
      set: value => { current = value; },
    });
    node.setRangeLineHeight = (_start, _end, value) => { current = value; };
    node.getRangeLineHeight = () => current;
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const scene = {
      id: "recovering-line-height-copy",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 56 },
      textRect: { x: 0, y: 0, width: 160, height: 56 },
      text: { content: "First line\nSecond line", lineCount: 2, lineHeight: 28, fontSize: 16 },
    };
    const report = importReport();
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    context.applySceneLineHeight(node, scene, report);
    expect(parent.children.some(child => child.name === "__css-line-height-recovering-line-height-copy")).toBe(true);

    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => current,
      set: value => { current = value; },
    });
    node.setRangeLineHeight = (_start, _end, value) => { current = value; };
    node.getRangeLineHeight = () => current;
    expect(context.applySceneLineHeight(node, scene, report)).toBe(true);
    expect(parent.children.some(child => child.name === "__css-line-height-recovering-line-height-copy")).toBe(false);
    expect(node.opacity).toBe(1);
    // The report describes the final imported state, not a transient host
    // normalization that was recovered during convergence.
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightFailures).toBe(0);
    expect(report.lineHeightFailureNodes).toEqual([]);
    expect(report.lineHeightFallbacks).toBe(0);
  });

  it("removes a legacy line-height fallback even when the current runtime cannot create SVG", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    parent.appendChild(node);
    let current = { unit: "AUTO", value: 0 };
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    const scene = {
      id: "legacy-runtime-fallback",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 56 },
      textRect: { x: 0, y: 0, width: 160, height: 56 },
      text: { content: "First line\nSecond line", lineCount: 2, lineHeight: 28, fontSize: 16 },
    };
    const report = importReport();
    const fallback = mockFigmaNode("VECTOR");
    context.figma.createNodeFromSvg = () => fallback;
    expect(context.applySceneLineHeight(node, scene, report)).toBe(false);
    expect(parent.children).toEqual([node, fallback]);
    expect(report.lineHeightFallbacks).toBe(1);

    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => current,
      set: value => { current = value; },
    });
    node.setRangeLineHeight = (_start, _end, value) => { current = value; };
    node.getRangeLineHeight = () => current;
    context.figma.createNodeFromSvg = undefined;

    expect(context.applySceneLineHeight(node, scene, report)).toBe(true);
    expect(parent.children).toEqual([node]);
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(node.opacity).toBe(1);
    expect(report.lineHeightFallbacks).toBe(0);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("keeps tight captured leading in the SVG line-height fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    parent.appendChild(node);
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };

    expect(context.applySceneLineHeight(node, {
      id: "tight-leading-fallback",
      type: "text",
      rect: { x: 0, y: 0, width: 140, height: 32 },
      textRect: { x: 0, y: 0, width: 140, height: 32 },
      text: {
        content: "First\nSecond",
        lineCount: 2,
        lineHeight: 12,
        fontSize: 20,
        fontFamily: "Inter",
        fontWeight: 400,
      },
    }, importReport())).toBe(false);

    expect(capturedSvg).toContain('font-size="20px"');
    expect(capturedSvg).toContain('y="20"');
    expect(capturedSvg).toContain('y="32"');
    expect(capturedSvg).not.toContain('y="40"');
  });

  it("rebuilds a line-height fallback after final geometry changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    parent.appendChild(node);
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    const firstVector = mockFigmaNode("VECTOR");
    const replacement = mockFigmaNode("VECTOR");
    let svg = "";
    let createCount = 0;
    context.figma.createNodeFromSvg = value => {
      svg = value;
      createCount += 1;
      return createCount === 1 ? firstVector : replacement;
    };
    const scene = {
      id: "line-height-resize",
      type: "text",
      rect: { x: 0, y: 0, width: 140, height: 32 },
      textRect: { x: 0, y: 0, width: 140, height: 32 },
      text: { content: "First\nSecond", lineCount: 2, lineHeight: 16, fontSize: 16, fontFamily: "Inter" },
    };
    const report = importReport();
    expect(context.createLineHeightVisualFallback(node, scene, report)).toBe(true);
    expect(report.lineHeightFallbacks).toBe(1);
    expect(parent.children).toHaveLength(2);

    node.resize(180, 48);
    scene.rect.width = 180;
    scene.rect.height = 48;
    scene.textRect.width = 180;
    scene.textRect.height = 48;
    context.syncLineHeightVisualFallback(node, scene, report);

    expect(parent.children).toHaveLength(2);
    expect(parent.children[1]).toBe(replacement);
    expect(svg).toContain('width="180"');
    expect(JSON.parse(replacement.getPluginData("open-canvas-line-height-geometry"))).toMatchObject({ width: 180, height: 48 });
    expect(report.lineHeightFallbacks).toBe(1);
  });

  it("rebuilds a line-height fallback when same-size text source changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    parent.appendChild(node);
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    const vectors = [];
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      const vector = mockFigmaNode("VECTOR");
      vectors.push(vector);
      return vector;
    };
    const scene = {
      id: "line-height-source-change",
      type: "text",
      rect: { x: 0, y: 0, width: 140, height: 32 },
      textRect: { x: 0, y: 0, width: 140, height: 32 },
      text: {
        content: "First\nSecond",
        lineCount: 2,
        lineHeight: 16,
        fontSize: 16,
        fontFamily: "Inter",
        textFillColor: "rgb(20, 40, 60)",
      },
    };
    const report = importReport();

    expect(context.createLineHeightVisualFallback(node, scene, report)).toBe(true);
    const firstSignature = vectors[0].getPluginData("open-canvas-line-height-source-signature");
    expect(firstSignature).toBeTruthy();
    expect(svg).toContain("rgb(20,40,60)");

    scene.text.content = "Changed\nLeading";
    scene.text.textFillColor = "rgb(180, 20, 40)";
    context.syncLineHeightVisualFallback(node, scene, report);

    expect(vectors).toHaveLength(2);
    expect(parent.children).toEqual([node, vectors[1]]);
    expect(vectors[1].getPluginData("open-canvas-line-height-source-signature")).not.toBe(firstSignature);
    expect(svg).toContain("rgb(180,20,40)");
    expect(svg).toContain("Changed");
    expect(report.lineHeightFallbacks).toBe(1);
  });

  it("recreates a line-height fallback when the host removed the old sibling", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    parent.appendChild(node);
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    node.setPluginData("open-canvas-line-height-fallback", "svg-text-lines");
    node.setPluginData("open-canvas-line-height-original-opacity", "1");
    const replacement = mockFigmaNode("VECTOR");
    context.figma.createNodeFromSvg = () => replacement;
    const scene = {
      id: "line-height-recover-without-sibling",
      type: "text",
      rect: { x: 0, y: 0, width: 140, height: 48 },
      textRect: { x: 0, y: 0, width: 140, height: 48 },
      text: { content: "First\nSecond", lineCount: 2, lineHeight: 24, fontSize: 16, fontFamily: "Inter" },
    };

    context.syncLineHeightVisualFallback(node, scene, importReport());

    expect(parent.children).toEqual([node, replacement]);
    expect(replacement.getPluginData("open-canvas-line-height-owner")).toBe("line-height-recover-without-sibling");
    expect(node.opacity).toBe(0);
  });

  it("keeps the existing line-height fallback when replacement creation fails", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    parent.appendChild(node);
    const existing = mockFigmaNode("VECTOR");
    existing.name = "__css-line-height-fallback-create-failure";
    existing.setPluginData("open-canvas-line-height-owner", "fallback-create-failure");
    existing.setPluginData("open-canvas-line-height-geometry", JSON.stringify({ x: 0, y: 0, width: 100, height: 32 }));
    parent.appendChild(existing);
    context.figma.createNodeFromSvg = () => null;
    const scene = {
      id: "fallback-create-failure",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 48 },
      textRect: { x: 0, y: 0, width: 160, height: 48 },
      text: { content: "First\nSecond", lineCount: 2, lineHeight: 24, fontSize: 16 },
    };
    const report = importReport();
    report.lineHeightFallbacks = 1;

    context.syncLineHeightVisualFallback(node, scene, report);

    expect(parent.children).toEqual([node, existing]);
    expect(existing.getPluginData("open-canvas-line-height-geometry")).toBe(JSON.stringify({ x: 0, y: 0, width: 100, height: 32 }));
    expect(report.lineHeightFallbacks).toBe(1);
  });

  it("renders vertical writing as an absolute SVG fallback without changing Auto Layout flow", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "你好A";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    const scene = {
      id: "vertical-copy",
      type: "text",
      rect: { x: 24, y: 16, width: 32, height: 96 },
      textRect: { x: 0, y: 0, width: 32, height: 96 },
      computedStyles: { writingMode: "vertical-rl", textOrientation: "mixed", color: "#111111" },
      text: {
        content: "你好A",
        lineCount: 1,
        lineHeight: 28,
        fontSize: 20,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "left",
      },
    };

    expect(context.createWritingModeVisualFallback(node, scene, report)).toBe(true);
    const fallback = parent.children.find(child => child.name === "__css-writing-mode-vertical-copy");
    expect(fallback).toBeTruthy();
    expect(fallback?.layoutPositioning).toBe("ABSOLUTE");
    expect(context.sceneChildren(parent)).not.toContain(fallback);
    expect(node.opacity).toBe(0);
    expect(fallback?.getPluginData("open-canvas-writing-mode-fallback")).toBe("vertical-rl");
    expect(capturedSvg).toContain("rotate(90)");
    expect(capturedSvg).toContain('text-anchor="middle"');
    expect(report.writingModeFallbacks).toBe(1);
  });

  it("rebuilds a vertical-writing fallback after final geometry changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.resize(32, 96);
    parent.appendChild(node);
    const oldVector = mockFigmaNode("VECTOR");
    oldVector.name = "__css-writing-mode-writing-resize";
    oldVector.setPluginData("open-canvas-writing-mode-owner", "writing-resize");
    oldVector.setPluginData("open-canvas-writing-mode-geometry", JSON.stringify({ x: 0, y: 0, width: 24, height: 72 }));
    oldVector.remove = () => {
      const index = parent.children.indexOf(oldVector);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldVector);
    const replacement = mockFigmaNode("VECTOR");
    replacement.remove = () => {
      const index = parent.children.indexOf(replacement);
      if (index >= 0) parent.children.splice(index, 1);
    };
    let svg = "";
    context.figma.createNodeFromSvg = value => { svg = value; return replacement; };
    const scene = {
      id: "writing-resize",
      type: "text",
      rect: { x: 0, y: 0, width: 32, height: 96 },
      textRect: { x: 0, y: 0, width: 32, height: 96 },
      computedStyles: { writingMode: "vertical-rl", textOrientation: "mixed", color: "#111111" },
      text: { content: "你好A", lineCount: 1, lineHeight: 28, fontSize: 20, fontFamily: "Inter", fontWeight: 400 },
    };
    const report = importReport();

    expect(context.createWritingModeVisualFallback(node, scene, report)).toBe(true);
    expect(parent.children).toEqual([node, replacement]);
    expect(svg).toContain('width="32"');
    expect(JSON.parse(replacement.getPluginData("open-canvas-writing-mode-geometry"))).toMatchObject({ width: 32, height: 96 });
    expect(report.writingModeFallbacks).toBe(1);

    const replacementAgain = mockFigmaNode("VECTOR");
    replacementAgain.remove = () => {
      const index = parent.children.indexOf(replacementAgain);
      if (index >= 0) parent.children.splice(index, 1);
    };
    context.figma.createNodeFromSvg = value => { svg = value; return replacementAgain; };
    node.resize(40, 112);
    scene.rect.width = 40;
    scene.rect.height = 112;
    scene.textRect.width = 40;
    scene.textRect.height = 112;
    expect(context.createWritingModeVisualFallback(node, scene, report)).toBe(true);
    expect(parent.children).toEqual([node, replacementAgain]);
    expect(JSON.parse(replacementAgain.getPluginData("open-canvas-writing-mode-geometry"))).toMatchObject({ width: 40, height: 112 });
    expect(report.writingModeFallbacks).toBe(1);
  });

  it("rebuilds a vertical-writing fallback when same-size source styling changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(32, 96);
    parent.appendChild(node);
    const vectors = [];
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      const vector = mockFigmaNode("VECTOR");
      vectors.push(vector);
      return vector;
    };
    const scene = {
      id: "writing-source-change",
      type: "text",
      rect: { x: 0, y: 0, width: 32, height: 96 },
      textRect: { x: 0, y: 0, width: 32, height: 96 },
      computedStyles: { writingMode: "vertical-rl", textOrientation: "mixed", color: "rgb(20, 40, 60)" },
      text: {
        content: "你好A",
        lineCount: 1,
        lineHeight: 28,
        fontSize: 20,
        fontFamily: "Inter",
        fontWeight: 400,
      },
    };

    expect(context.createWritingModeVisualFallback(node, scene, importReport())).toBe(true);
    const firstSignature = vectors[0].getPluginData("open-canvas-writing-mode-source-signature");
    expect(firstSignature).toBeTruthy();
    expect(svg).toContain("rgb(20,40,60)");

    scene.text.content = "好你B";
    scene.computedStyles.color = "rgb(180, 20, 40)";
    scene.computedStyles.textOrientation = "upright";
    context.createWritingModeVisualFallback(node, scene, importReport());

    expect(vectors).toHaveLength(2);
    expect(parent.children).toEqual([node, vectors[1]]);
    expect(vectors[1].getPluginData("open-canvas-writing-mode-source-signature")).not.toBe(firstSignature);
    expect(svg).toContain("rgb(180,20,40)");
    expect(svg).toContain(">好</text>");
    expect(svg).toContain(">你</text>");
    expect(svg).toContain(">B</text>");
  });

  it("keeps an existing vertical-writing fallback when replacement creation fails", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    const existing = mockFigmaNode("VECTOR");
    existing.name = "__css-writing-mode-writing-create-failure";
    existing.setPluginData("open-canvas-writing-mode-owner", "writing-create-failure");
    existing.setPluginData("open-canvas-writing-mode-geometry", JSON.stringify({ x: 0, y: 0, width: 24, height: 72 }));
    parent.appendChild(existing);
    context.figma.createNodeFromSvg = () => null;
    const scene = {
      id: "writing-create-failure",
      type: "text",
      rect: { x: 0, y: 0, width: 40, height: 112 },
      textRect: { x: 0, y: 0, width: 40, height: 112 },
      computedStyles: { writingMode: "vertical-rl" },
      text: { content: "你好A", lineCount: 1, lineHeight: 28, fontSize: 20 },
    };
    const report = importReport();
    report.writingModeFallbacks = 1;

    expect(context.createWritingModeVisualFallback(node, scene, report)).toBe(false);
    expect(parent.children).toEqual([node, existing]);
    expect(report.writingModeFallbacks).toBe(1);
  });

  it("removes a legacy vertical-writing fallback when SVG creation is unavailable", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "你好A";
    parent.appendChild(node);
    const fallback = mockFigmaNode("VECTOR");
    fallback.name = "__css-writing-mode-capability-shift";
    fallback.setPluginData("open-canvas-writing-mode-owner", "capability-shift-writing");
    parent.appendChild(fallback);
    node.opacity = 0;
    node.setPluginData("open-canvas-writing-mode-original-opacity", "1");
    context.figma.createNodeFromSvg = undefined;

    context.createWritingModeVisualFallback(node, {
      id: "capability-shift-writing",
      type: "text",
      text: { content: node.characters, lineCount: 1, lineHeight: 24, fontSize: 16 },
      computedStyles: { writingMode: "horizontal-tb" },
    }, importReport());

    expect(parent.children).toEqual([node]);
    expect(node.opacity).toBe(1);
  });

  it("retains unsupported text decoration geometry and paint for inspection", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();
    context.applyTextDecoration(node, {
      id: "wavy-copy",
      type: "text",
      text: {
        content: "Decorated",
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(180, 40, 30)",
        textDecorationThickness: "2px",
        textUnderlineOffset: "3px",
      },
    }, report);
    expect(JSON.parse(node.getPluginData("open-canvas-text-decoration"))).toMatchObject({
      style: "wavy",
      color: "rgb(180, 40, 30)",
      thickness: "2px",
      underlineOffset: "3px",
    });
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("text-decoration-style wavy");
  });

  it("adds an editable vector fallback for single-line CSS decoration geometry", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.width = 96;
    node.height = 20;
    parent.appendChild(node);
    const vector = mockFigmaNode("VECTOR");
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return vector;
    };

    expect(context.createTextDecorationFallback(node, {
      id: "wavy-single-line",
      rect: { x: 12, y: 8, width: 96, height: 20 },
      textRect: { x: 0, y: 0, width: 96, height: 20 },
      text: {
        content: "Decorated",
        lineCount: 1,
        fontSize: 16,
        textDecoration: "overline underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(180, 40, 30)",
        textDecorationThickness: "2px",
        textUnderlineOffset: "3px",
      },
    }, parent)).toBe(true);

    expect(svg).toContain("stroke=\"rgb(180,40,30)\"");
    expect(svg).toContain("stroke-width=\"2\"");
    expect(svg.match(/<path /g)?.length).toBe(2);
    expect(vector.getPluginData("open-canvas-text-decoration-owner")).toBe("wavy-single-line");
    expect(vector.getPluginData("open-canvas-text-decoration-fallback")).toBe("single-line-vector");
    expect(JSON.parse(vector.getPluginData("open-canvas-text-decoration-geometry"))).toEqual({
      width: 96,
      height: 20,
      svgHeight: 29,
    });
    expect(node.textDecoration).toBe("NONE");
    expect(vector.layoutPositioning).toBe("ABSOLUTE");
  });

  it("resolves relative and functional decoration geometry against the text font", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(120, 24);
    parent.appendChild(node);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };

    expect(context.createTextDecorationFallback(node, {
      id: "relative-decoration-geometry",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      textRect: { x: 0, y: 0, width: 120, height: 24 },
      rootFontSize: 16,
      text: {
        content: "Decorated",
        lineCount: 1,
        fontSize: 20,
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(180, 40, 30)",
        textDecorationThickness: "max(1px, 8%)",
        textUnderlineOffset: "calc(0.2em + 1px)",
      },
    }, parent)).toBe(true);

    expect(svg).toContain('stroke-width="1.6"');
    expect(svg).toContain('height="33.8"');
    expect(svg).not.toContain('stroke-width="1"');
  });

  it("keeps a negative relative underline offset signed", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(120, 24);
    parent.appendChild(node);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };

    expect(context.createTextDecorationFallback(node, {
      id: "negative-decoration-offset",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      textRect: { x: 0, y: 0, width: 120, height: 24 },
      text: {
        content: "Decorated",
        lineCount: 1,
        fontSize: 20,
        textDecoration: "underline",
        textDecorationStyle: "dashed",
        textDecorationColor: "rgb(180, 40, 30)",
        textDecorationThickness: "0.1em",
        textUnderlineOffset: "-0.15em",
      },
    }, parent)).toBe(true);

    expect(svg).toContain('stroke-width="2"');
    expect(svg).toContain('d="M 0 21 H 120"');
  });

  it("does not re-enable native decoration over a complete vector fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    node.textDecoration = "NONE";
    const fallback = mockFigmaNode("VECTOR");
    fallback.setPluginData("open-canvas-text-decoration-owner", "wavy-verify");
    parent.appendChild(fallback);
    const report = importReport();
    context.verifySceneTextStyling({
      id: "wavy-verify",
      type: "text",
      text: {
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(180, 40, 30)",
      },
      children: [],
    }, node, report);

    expect(node.textDecoration).toBe("NONE");
    expect(report.styleDegradations).toBe(0);
  });

  it("regenerates text-decoration geometry instead of stretching its SVG", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(140, 24);
    parent.appendChild(node);
    const oldVector = mockFigmaNode("VECTOR");
    oldVector.name = "__css-text-decoration-wavy-resize";
    oldVector.resize(96, 29);
    oldVector.setPluginData("open-canvas-text-decoration-owner", "wavy-resize");
    oldVector.setPluginData("open-canvas-text-decoration-geometry", JSON.stringify({ width: 96, height: 20, svgHeight: 29 }));
    oldVector.remove = () => {
      const index = parent.children.indexOf(oldVector);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldVector);
    const content = mockFigmaNode("RECTANGLE");
    content.name = "following-content";
    parent.appendChild(content);
    let svg = "";
    const replacement = mockFigmaNode("VECTOR");
    replacement.remove = () => {
      const index = parent.children.indexOf(replacement);
      if (index >= 0) parent.children.splice(index, 1);
    };
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return replacement;
    };
    const scene = {
      id: "wavy-resize",
      rect: { x: 0, y: 0, width: 140, height: 24 },
      textRect: { x: 0, y: 0, width: 140, height: 24 },
      text: {
        content: "Decorated",
        lineCount: 1,
        fontSize: 16,
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(180, 40, 30)",
        textDecorationThickness: "2px",
        textUnderlineOffset: "3px",
      },
    };

    context.syncTextDecorationFallback(node, scene);

    expect(svg).toContain('width="140"');
    expect(parent.children).toEqual([node, replacement, content]);
    expect(JSON.parse(replacement.getPluginData("open-canvas-text-decoration-geometry"))).toEqual({
      width: 140,
      height: 24,
      svgHeight: 33,
    });
  });

  it("regenerates text-decoration paint when same-size source styling changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(120, 24);
    parent.appendChild(node);
    const vectors = [];
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      const vector = mockFigmaNode("VECTOR");
      vectors.push(vector);
      return vector;
    };
    const scene = {
      id: "decoration-source-change",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      textRect: { x: 0, y: 0, width: 120, height: 24 },
      text: {
        content: "Decorated",
        lineCount: 1,
        fontSize: 16,
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(180, 40, 30)",
        textDecorationThickness: "2px",
        textUnderlineOffset: "3px",
      },
    };

    expect(context.createTextDecorationFallback(node, scene, parent)).toBe(true);
    const firstSignature = vectors[0].getPluginData("open-canvas-text-decoration-source-signature");
    expect(firstSignature).toBeTruthy();
    expect(svg).toContain("stroke=\"rgb(180,40,30)\"");

    scene.text.textDecorationColor = "rgb(20, 80, 200)";
    context.syncTextDecorationFallback(node, scene);

    expect(vectors).toHaveLength(2);
    expect(parent.children).toEqual([node, vectors[1]]);
    expect(vectors[1].getPluginData("open-canvas-text-decoration-source-signature")).not.toBe(firstSignature);
    expect(svg).toContain("stroke=\"rgb(20,80,200)\"");
  });

  it("recreates an unsupported decoration when the removed fallback has no sibling", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(120, 24);
    parent.appendChild(node);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const vector = mockFigmaNode("VECTOR");
      created.push(vector);
      return vector;
    };

    context.syncTextDecorationFallback(node, {
      id: "restored-decoration-source",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      textRect: { x: 0, y: 0, width: 120, height: 24 },
      text: {
        content: "Decorated",
        lineCount: 1,
        fontSize: 16,
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(180, 40, 30)",
        textDecorationThickness: "2px",
        textUnderlineOffset: "3px",
      },
    });

    expect(created).toHaveLength(1);
    expect(parent.children[1]).toBe(created[0]);
  });

  it("removes a decoration fallback when the source returns to native underline", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.textDecoration = "NONE";
    parent.appendChild(node);
    const fallback = mockFigmaNode("VECTOR");
    fallback.name = "__css-text-decoration-wavy-native-reset";
    fallback.setPluginData("open-canvas-text-decoration-owner", "native-decoration-reset");
    fallback.remove = () => {
      const index = parent.children.indexOf(fallback);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(fallback);

    context.syncTextDecorationFallback(node, {
      id: "native-decoration-reset",
      type: "text",
      text: {
        content: "Decorated",
        textDecoration: "underline",
        textDecorationStyle: "solid",
        textDecorationColor: undefined,
        textDecorationThickness: "auto",
        textUnderlineOffset: "auto",
      },
    });

    expect(parent.children).toEqual([node]);
    expect(node.textDecoration).toBe("UNDERLINE");
  });

  it("removes a stale decoration fallback without SVG creation capability", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    const fallback = mockFigmaNode("VECTOR");
    fallback.name = "__css-text-decoration-capability-shift";
    fallback.setPluginData("open-canvas-text-decoration-owner", "decoration-capability-shift");
    fallback.remove = () => {
      const index = parent.children.indexOf(fallback);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(fallback);
    context.figma.createNodeFromSvg = undefined;

    context.syncTextDecorationFallback(node, {
      id: "decoration-capability-shift",
      type: "text",
      text: { content: "Decorated", textDecoration: "none" },
    });

    expect(parent.children).toEqual([node]);
    expect(node.textDecoration).toBe("NONE");
  });

  it("keeps wavy decoration geometry off the baseline", () => {
    const context = loadPluginFunctions();
    const path = context.textDecorationPath(10, 120, 2, "wavy");
    const yValues = [...path.d.matchAll(/L [^ ]+ ([^ ]+)/g)].map(match => Number(match[1]));
    expect(yValues.some(value => Math.abs(value - 10) > 0.01)).toBe(true);
    expect(yValues.some(value => Math.abs(value - 10) < 0.01)).toBe(true);
  });

  it("draws measured decoration segments for wrapped text", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    let svg = "";
    const vector = mockFigmaNode("VECTOR");
    context.figma.createNodeFromSvg = value => { svg = value; return vector; };

    expect(context.createTextDecorationFallback(node, {
      id: "wrapped-decoration",
      rect: { x: 0, y: 0, width: 96, height: 40 },
      textRect: { x: 0, y: 0, width: 96, height: 40 },
      textLineRects: [
        { x: 0, y: 0, width: 52, height: 18 },
        { x: 4, y: 22, width: 40, height: 18 },
      ],
      text: {
        content: "First\nSecond",
        lineCount: 2,
        fontSize: 16,
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(20, 40, 60)",
      },
    }, parent)).toBe(true);
    expect(parent.children).toHaveLength(2);
    expect(svg.match(/<path /g)?.length).toBe(2);
    expect(svg).toContain('M 0 18');
    expect(svg).toContain('transform="translate(4 0)"');
  });

  it("preserves ellipsis and CSS line-clamp on editable text nodes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();
    context.applyTextOverflow(node, {
      id: "clamped-copy",
      type: "text",
      text: { textOverflow: "ellipsis", maxLines: 2 },
    }, report);
    expect(node.textTruncation).toBe("ENDING");
    expect(node.maxLines).toBe(2);
    expect(JSON.parse(node.getPluginData("open-canvas-text-overflow"))).toMatchObject({ textOverflow: "ellipsis", maxLines: 2 });
    expect(report.styleDegradations).toBe(0);
  });

  it("clears stale text truncation when overflow returns to clip", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    node.textTruncation = "ENDING";
    node.maxLines = 2;
    node.setPluginData("open-canvas-text-overflow", JSON.stringify({ textOverflow: "ellipsis", maxLines: 2 }));
    node.setPluginData("open-canvas-text-overflow-native", "1");
    const fallback = mockFigmaNode("VECTOR");
    fallback.name = "__css-text-overflow-reused-clamped-copy";
    fallback.setPluginData("open-canvas-text-overflow-owner", "reused-clamped-copy");
    parent.appendChild(fallback);
    const report = importReport();

    context.verifySceneTextOverflow({
      id: "reused-clamped-copy",
      type: "text",
      text: { content: "A clean line", textOverflow: "clip", maxLines: 0 },
      children: [],
    }, node, report);

    expect(node.textTruncation).toBe("DISABLED");
    expect(node.maxLines).toBe(0);
    expect(node.getPluginData("open-canvas-text-overflow")).toBe("");
    expect(node.getPluginData("open-canvas-text-overflow-native")).toBe("");
    expect(parent.children).not.toContain(fallback);
  });

  it("removes a legacy overflow fallback when SVG creation is unavailable", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "A very long line";
    parent.appendChild(node);
    const fallback = mockFigmaNode("VECTOR");
    fallback.name = "__css-text-overflow-capability-shift";
    fallback.setPluginData("open-canvas-text-overflow-owner", "capability-shift-overflow");
    parent.appendChild(fallback);
    context.figma.createNodeFromSvg = undefined;

    context.verifySceneTextOverflow({
      id: "capability-shift-overflow",
      type: "text",
      text: { content: node.characters, textOverflow: "clip", maxLines: 0 },
      children: [],
    }, node, importReport());

    expect(parent.children).toEqual([node]);
    expect(node.opacity).toBe(1);
  });

  it("reapplies text truncation after a detached write was normalized", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    let truncation = "DISABLED";
    let maxLines = 0;
    Object.defineProperty(node, "textTruncation", {
      configurable: true,
      get: () => truncation,
      set: value => { truncation = node.parent ? value : "DISABLED"; },
    });
    Object.defineProperty(node, "maxLines", {
      configurable: true,
      get: () => maxLines,
      set: value => { maxLines = node.parent ? value : 0; },
    });
    const scene = {
      id: "attached-clamped-copy",
      type: "text",
      text: { textOverflow: "ellipsis", maxLines: 2 },
      children: [],
    };
    context.applyTextOverflow(node, scene, importReport());
    expect(node.textTruncation).toBe("DISABLED");
    parent.appendChild(node);
    const report = importReport();
    context.verifySceneTextOverflow(scene, node, report);
    expect(node.textTruncation).toBe("ENDING");
    expect(node.maxLines).toBe(2);
    expect(report.styleDegradations).toBe(0);
  });

  it("keeps ellipsis visible when the host lacks native truncation APIs", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    delete node.textTruncation;
    delete node.maxLines;
    node.characters = "A very long line";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    context.applyTextOverflow(node, {
      id: "unsupported-clamped-copy",
      type: "text",
      rect: { x: 8, y: 12, width: 72, height: 20 },
      textRect: { x: 0, y: 0, width: 72, height: 20 },
      text: {
        content: node.characters,
        lineCount: 1,
        lineHeight: 20,
        fontSize: 16,
        fontFamily: "Inter",
        textOverflow: "ellipsis",
      },
    }, report);

    const fallback = parent.children.find(child => child.name === "__css-text-overflow-unsupported-clamped-copy");
    expect(fallback).toBeTruthy();
    expect(fallback?.layoutPositioning).toBe("ABSOLUTE");
    expect(node.opacity).toBe(0);
    expect(capturedSvg).toContain("&#8230;");
    expect(node.getPluginData("open-canvas-text-overflow-fallback")).toBe("svg-ellipsis");
    expect(report.textOverflowFallbacks).toBe(1);
  });

  it("rebuilds an overflow fallback after final geometry changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.resize(160, 32);
    parent.appendChild(node);
    const oldVector = mockFigmaNode("VECTOR");
    oldVector.name = "__css-text-overflow-overflow-resize";
    oldVector.setPluginData("open-canvas-text-overflow-owner", "overflow-resize");
    oldVector.setPluginData("open-canvas-text-overflow-geometry", JSON.stringify({ x: 0, y: 0, width: 120, height: 20 }));
    oldVector.remove = () => {
      const index = parent.children.indexOf(oldVector);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldVector);
    const replacement = mockFigmaNode("VECTOR");
    replacement.remove = () => {
      const index = parent.children.indexOf(replacement);
      if (index >= 0) parent.children.splice(index, 1);
    };
    let svg = "";
    context.figma.createNodeFromSvg = value => { svg = value; return replacement; };
    const scene = {
      id: "overflow-resize",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      textRect: { x: 0, y: 0, width: 160, height: 32 },
      text: { content: "A very long line", lineCount: 1, lineHeight: 20, fontSize: 16, fontFamily: "Inter", textOverflow: "ellipsis" },
    };
    const report = importReport();

    expect(context.createTextOverflowVisualFallback(node, scene, report)).toBe(true);
    expect(parent.children).toEqual([node, replacement]);
    expect(svg).toContain('width="160"');
    expect(svg).toContain('height="32"');
    expect(JSON.parse(replacement.getPluginData("open-canvas-text-overflow-geometry"))).toMatchObject({ width: 160, height: 32 });
    expect(report.textOverflowFallbacks).toBe(1);
  });

  it("rebuilds an overflow fallback when same-size text styling changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(160, 32);
    parent.appendChild(node);
    const vectors = [];
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      const vector = mockFigmaNode("VECTOR");
      vectors.push(vector);
      return vector;
    };
    const scene = {
      id: "overflow-source-change",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      textRect: { x: 0, y: 0, width: 160, height: 32 },
      text: {
        content: "A very long line",
        lineCount: 1,
        lineHeight: 20,
        fontSize: 16,
        fontFamily: "Inter",
        textFillColor: "#111111",
        textOverflow: "ellipsis",
      },
    };
    const report = importReport();

    expect(context.createTextOverflowVisualFallback(node, scene, report)).toBe(true);
    const firstSignature = vectors[0].getPluginData("open-canvas-text-overflow-source-signature");
    expect(firstSignature).toBeTruthy();
    expect(svg).toContain("rgb(17,17,17)");

    scene.text.content = "A different long line";
    scene.text.textFillColor = "#cc0000";
    expect(context.createTextOverflowVisualFallback(node, scene, report)).toBe(true);

    expect(vectors).toHaveLength(2);
    expect(parent.children).toEqual([node, vectors[1]]);
    expect(vectors[1].getPluginData("open-canvas-text-overflow-source-signature")).not.toBe(firstSignature);
    expect(svg).toContain("rgb(204,0,0)");
    expect(svg).toContain("A different long line");
    expect(report.textOverflowFallbacks).toBe(1);
  });

  it("keeps an existing overflow fallback when replacement creation fails", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    const existing = mockFigmaNode("VECTOR");
    existing.name = "__css-text-overflow-overflow-create-failure";
    existing.setPluginData("open-canvas-text-overflow-owner", "overflow-create-failure");
    existing.setPluginData("open-canvas-text-overflow-geometry", JSON.stringify({ x: 0, y: 0, width: 72, height: 20 }));
    parent.appendChild(existing);
    context.figma.createNodeFromSvg = () => null;
    const scene = {
      id: "overflow-create-failure",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      textRect: { x: 0, y: 0, width: 160, height: 32 },
      text: { content: "A very long line", lineCount: 1, lineHeight: 20, fontSize: 16, textOverflow: "ellipsis" },
    };
    const report = importReport();
    report.textOverflowFallbacks = 1;

    expect(context.createTextOverflowVisualFallback(node, scene, report)).toBe(false);
    expect(parent.children).toEqual([node, existing]);
    expect(report.textOverflowFallbacks).toBe(1);
  });

  it("places RTL ellipsis fallbacks on the start side", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "rtl-ellipsis-fallback",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 20 },
      textRect: { x: 0, y: 0, width: 120, height: 20 },
      computedStyles: { direction: "rtl" },
      text: {
        content: "שלום עולם",
        lineCount: 1,
        lineHeight: 20,
        fontSize: 16,
        fontFamily: "Inter",
        textOverflow: "ellipsis",
      },
    };

    expect(context.createTextOverflowVisualFallback(node, scene, importReport())).toBe(true);
    expect(capturedSvg).toContain('<rect x="12" y="0" width="108"');
    expect(capturedSvg).toContain('x="0" y="16" text-anchor="start"');
  });

  it("removes the truncation fallback after native APIs become available", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    delete node.textTruncation;
    delete node.maxLines;
    node.characters = "A very long line";
    parent.appendChild(node);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const scene = {
      id: "recoverable-clamped-copy",
      type: "text",
      rect: { x: 0, y: 0, width: 72, height: 20 },
      textRect: { x: 0, y: 0, width: 72, height: 20 },
      text: { content: node.characters, lineCount: 1, lineHeight: 20, fontSize: 16, textOverflow: "ellipsis" },
    };
    const report = importReport();
    context.applyTextOverflow(node, scene, report);
    expect(report.textOverflowFallbacks).toBe(1);
    expect(node.opacity).toBe(0);

    let truncation = "DISABLED";
    let maxLines = 0;
    Object.defineProperty(node, "textTruncation", {
      configurable: true,
      get: () => truncation,
      set: value => { truncation = value; },
    });
    Object.defineProperty(node, "maxLines", {
      configurable: true,
      get: () => maxLines,
      set: value => { maxLines = value; },
    });
    context.verifySceneTextOverflow(scene, node, report);

    expect(parent.children.filter(child => child.name === "__css-text-overflow-recoverable-clamped-copy")).toHaveLength(0);
    expect(node.opacity).toBe(1);
    expect(node.textTruncation).toBe("ENDING");
    expect(report.textOverflowFallbacks).toBe(0);
  });

  it("keeps the editable text hidden while another visual fallback remains", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    node.opacity = 0;
    const shaping = mockFigmaNode("VECTOR");
    shaping.setPluginData("open-canvas-text-shaping-owner", "combined-fallback-copy");
    parent.appendChild(shaping);
    const overflow = mockFigmaNode("VECTOR");
    overflow.setPluginData("open-canvas-text-overflow-owner", "combined-fallback-copy");
    parent.appendChild(overflow);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const report = importReport();
    report.textOverflowFallbacks = 1;

    context.removeTextOverflowVisualFallback(node, { id: "combined-fallback-copy" }, report);

    expect(parent.children).toContain(shaping);
    expect(parent.children).not.toContain(overflow);
    expect(node.opacity).toBe(0);
    expect(report.textOverflowFallbacks).toBe(0);
  });

  it("maps flex-grow to native layoutGrow and retains shrink/basis metadata", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyFlexSizing(node, {
      id: "growing-column",
      computedStyles: { flexGrow: "2", flexShrink: "0", flexBasis: "40%" },
    }, true);
    expect(node.layoutGrow).toBe(1);
    expect(JSON.parse(node.getPluginData("open-canvas-flex"))).toEqual({ grow: 2, shrink: 0, basis: "40%" });
  });

  it("resets stale flex growth when a compatibility payload trims CSS defaults", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutGrow = 1;
    node.setPluginData("open-canvas-flex", JSON.stringify({ grow: 1, shrink: 1, basis: "auto" }));

    context.applyFlexSizing(node, {
      id: "trimmed-flex-defaults",
      computedStyles: {},
      layout: {},
      rect: { width: 120, height: 40 },
    }, true, { layout: { mode: "horizontal" } }, importReport());

    expect(node.layoutGrow).toBe(0);
    expect(node.getPluginData("open-canvas-flex")).toBe("");
  });

  it("removes a synthetic flex-shrink minimum when the next payload drops the constraint", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    const parent = { layout: { mode: "horizontal" } };

    context.applyFlexSizing(node, {
      id: "shrink-zero-state",
      computedStyles: { flexShrink: "0" },
      rect: { width: 120, height: 40 },
    }, true, parent, importReport());
    expect(node.minWidth).toBe(120);
    expect(node.getPluginData("open-canvas-flex-min")).toBe("width");

    context.applyFlexSizing(node, {
      id: "default-shrink-state",
      computedStyles: {},
      rect: { width: 80, height: 40 },
    }, true, parent, importReport());
    expect(node.minWidth).toBe(0);
    expect(node.getPluginData("open-canvas-flex-min")).toBe("");
  });

  it("reports a flex-grow value that Figma silently normalizes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let layoutGrow = 0;
    Object.defineProperty(node, "layoutGrow", {
      configurable: true,
      get: () => layoutGrow,
      set: () => { layoutGrow = 0; },
    });
    const report = importReport();

    context.applyFlexSizing(node, {
      id: "silent-flex-grow",
      computedStyles: { flexGrow: "1" },
    }, true, { layout: { mode: "horizontal" } }, report);

    expect(report.sizingFallbackNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "silent-flex-grow",
        kind: "layout-grow-readback",
        desired: 1,
        actual: 0,
      }),
    ]));
  });

  it("reports the flex-basis degradation for equal-grow children", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const first = {
      id: "basis-report-one",
      rect: { x: 0, y: 0, width: 140, height: 40 },
      computedStyles: { flexGrow: "1", flexShrink: "1", flexBasis: "0px" },
      layout: {},
    };
    const second = {
      id: "basis-report-two",
      rect: { x: 140, y: 0, width: 220, height: 40 },
      computedStyles: { flexGrow: "1", flexShrink: "1", flexBasis: "40px" },
      layout: {},
    };
    const parent = {
      layout: { mode: "horizontal" },
      computedStyles: { display: "flex" },
      children: [first, second],
    };
    const report = importReport();

    context.applyFlexSizing(node, first, true, parent, report);

    expect(report.sizingFallbackNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "basis-report-one",
        kind: "flex-width-basis",
        axis: "width",
        basis: "0px",
      }),
    ]));
  });

  it("preserves the captured main-axis size for flex-shrink zero items", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.width = 120;
    node.minWidth = 0;
    node.layoutSizingHorizontal = "FILL";
    context.applyFlexSizing(node, {
      rect: { width: 120, height: 40 },
      computedStyles: { flexShrink: "0" },
    }, true, { layout: { mode: "horizontal" } });
    expect(node.minWidth).toBe(120);
    expect(node.layoutSizingHorizontal).toBe("FILL");
  });

  it("keeps the flex-shrink zero minimum through authored sizing constraint verification", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    const parent = {
      rect: { width: 400, height: 200 },
      layout: { mode: "horizontal", padding: [0, 0, 0, 0] },
    };
    const scene = {
      id: "shrink-zero-authored-min",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      computedStyles: {
        boxSizing: "border-box",
        flexShrink: "0",
        minWidth: "80px",
      },
      layout: { widthMode: "fixed", heightMode: "fixed" },
      children: [],
    };
    const report = importReport();

    context.applySizingConstraints(node, scene, parent, undefined, report);
    expect(node.minWidth).toBe(120);

    // Model a later host/layout write replacing the synthetic minimum with
    // the smaller authored value. The final verifier must restore the
    // effective flex-shrink minimum rather than accepting 80px as complete.
    node.minWidth = 80;
    context.verifySceneSizingConstraints(scene, node, parent, undefined, report);
    expect(node.minWidth).toBe(120);
    expect(node.getPluginData("open-canvas-sizing-constraints")).toBe(JSON.stringify({ minWidth: "80px" }));
  });

  it("combines authored and flex-shrink zero minimums on both main axes", () => {
    const context = loadPluginFunctions();
    const horizontal = mockFigmaNode("FRAME");
    horizontal.minWidth = 0;
    const vertical = mockFigmaNode("FRAME");
    vertical.minHeight = 0;

    context.applySizingConstraints(horizontal, {
      id: "strict-horizontal-flex-min",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      computedStyles: { boxSizing: "border-box", flexShrink: "0", minWidth: "160px" },
    }, { rect: { width: 400, height: 200 }, layout: { mode: "horizontal", padding: [0, 0, 0, 0] } });
    context.applySizingConstraints(vertical, {
      id: "strict-vertical-flex-min",
      rect: { x: 0, y: 0, width: 80, height: 96 },
      // Trimmed compatibility payloads can retain only the kebab-case form.
      computedStyles: { boxSizing: "border-box", "flex-shrink": "0", minHeight: "64px" },
    }, { rect: { width: 200, height: 400 }, layout: { mode: "vertical", padding: [0, 0, 0, 0] } });

    expect(horizontal.minWidth).toBe(160);
    expect(vertical.minHeight).toBe(96);
  });

  it("reports a silently rejected flex-shrink minimum", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let minimum = 0;
    Object.defineProperty(node, "minWidth", {
      configurable: true,
      get: () => minimum,
      set: () => { /* model a host that silently drops min-size writes */ },
    });
    const report = importReport();

    context.applyFlexSizing(node, {
      id: "silent-flex-min",
      rect: { width: 120, height: 40 },
      computedStyles: { flexGrow: "1", flexShrink: "0" },
    }, true, { layout: { mode: "horizontal" } }, report);

    expect(node.minWidth).toBe(0);
    expect(report.sizingFallbackNodes[0]).toMatchObject({
      id: "silent-flex-min",
      kind: "flex-width-min-readback",
      axis: "width",
      desired: 120,
      actual: 0,
    });
  });

  it("reports a sizing lock that Figma silently normalizes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let sizing = "FILL";
    Object.defineProperty(node, "layoutSizingHorizontal", {
      configurable: true,
      get: () => sizing,
      set: () => { sizing = "FILL"; },
    });
    const report = importReport();

    context.freezeSizingAxis({ id: "silent-size-lock", layout: { mode: "horizontal" } }, node, "width", report);

    expect(report.sizingFallbackNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "silent-size-lock",
        kind: "freeze-width-readback",
        property: "layoutSizingHorizontal",
        actual: "FILL",
      }),
    ]));
  });

  it("restores flow sizing for flex-shrink zero when a native minimum protects the captured width", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.width = 120;
    node.minWidth = 120;
    node.layoutSizingHorizontal = "FIXED";
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "HORIZONTAL";
    parent.appendChild(node);
    const report = importReport();

    context.restoreParentSizingAxis({
      id: "fixed-shrink-child",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      computedStyles: { flexGrow: "0", flexShrink: "0" },
      layout: { mode: "none", widthMode: "fill", heightMode: "fixed" },
    }, node, {
      layout: { mode: "horizontal" },
      children: [{ id: "fixed-shrink-child" }],
    }, parent, "width", report);

    expect(node.layoutSizingHorizontal).toBe("FILL");
    expect(node.minWidth).toBe(120);
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("keeps non-default non-growing flex-shrink weights fixed during sizing restoration", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.width = 120;
    node.layoutSizingHorizontal = "FIXED";
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "HORIZONTAL";
    parent.appendChild(node);
    const report = importReport();

    context.restoreParentSizingAxis({
      id: "weighted-shrink-child",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      computedStyles: { flexGrow: "0", flexShrink: "0.5" },
      layout: { mode: "none", widthMode: "fill", heightMode: "fixed" },
    }, node, {
      layout: { mode: "horizontal" },
      children: [{ id: "weighted-shrink-child" }],
    }, parent, "width", report);

    expect(node.layoutSizingHorizontal).toBe("FIXED");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("does not add a sizing fallback for flex-shrink zero when restoring flow sizing", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.width = 120;
    let sizing = "FILL";
    Object.defineProperty(node, "layoutSizingHorizontal", {
      configurable: true,
      get: () => sizing,
      set: () => { /* model a host that silently normalizes the lock */ },
    });
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "HORIZONTAL";
    parent.appendChild(node);
    const report = importReport();

    context.restoreParentSizingAxis({
      id: "silent-shrink-lock",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      computedStyles: { flexGrow: "0", flexShrink: "0" },
      layout: { mode: "none", widthMode: "fill", heightMode: "fixed" },
    }, node, {
      layout: { mode: "horizontal" },
      children: [{ id: "silent-shrink-lock" }],
    }, parent, "width", report);

    expect(node.layoutSizingHorizontal).toBe("FILL");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("reports missing parent-facing sizing APIs for responsive children", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    delete node.layoutSizingHorizontal;
    const report = importReport();
    context.restoreParentSizingAxis({
      id: "missing-parent-sizing-api",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      layout: { mode: "none", widthMode: "fill", heightMode: "fixed" },
    }, node, { layout: { mode: "horizontal" }, children: [] }, mockFigmaNode("FRAME"), "width", report);

    expect(report.sizingFallbackNodes).toEqual([
      expect.objectContaining({
        id: "missing-parent-sizing-api",
        kind: "parent-facing-width-unavailable",
        axis: "width",
        desired: "FILL",
        message: expect.stringContaining("layoutSizingHorizontal"),
      }),
    ]);
  });

  it("reports missing intrinsic sizing APIs for responsive Auto Layout frames", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "HORIZONTAL";
    delete node.primaryAxisSizingMode;
    const report = importReport();
    context.restoreIntrinsicSizingAxis({
      id: "missing-intrinsic-sizing-api",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      layout: { mode: "horizontal", widthMode: "hug", heightMode: "fixed" },
    }, node, "width", report);

    expect(report.sizingFallbackNodes).toEqual([
      expect.objectContaining({
        id: "missing-intrinsic-sizing-api",
        kind: "intrinsic-width-unavailable",
        axis: "width",
        desired: "AUTO",
        message: expect.stringContaining("primaryAxisSizingMode"),
      }),
    ]);
  });

  it("recovers inherited line-height from computed styles for legacy scenes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "inherited-copy",
      type: "text",
      computedStyles: { lineHeight: "1.5" },
      text: { content: "First line\nSecond line", fontSize: 16 },
    }, report)).toBe(true);

    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 24 });
    expect(node.getPluginData("open-canvas-line-height")).toBe("24");
    expect(report.lineHeightNodes).toEqual([{ id: "inherited-copy", value: 24 }]);
  });

  it("recovers a missing shared-scene line-height from multi-line geometry", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "measured-shared-line-height",
      type: "text",
      rect: { x: 0, y: 0, width: 220, height: 56 },
      text: { content: "First line\nSecond line", fontSize: 16, lineCount: 2 },
    }, report)).toBe(true);

    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(report.lineHeightFailures).toBe(0);
  });

  it("prefers a resolved computed line-height when a legacy scene keeps a custom-property token", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "custom-property-line-height",
      type: "text",
      computedStyles: { lineHeight: "28px" },
      text: { content: "First line\nSecond line", fontSize: 16, lineHeight: "var(--body-leading)" },
    }, report)).toBe(true);

    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(node.getPluginData("open-canvas-line-height")).toBe("28");
    expect(report.lineHeightFailures).toBe(0);
  });

  it("uses the computed fallback when an H2D wrapper retains env line-height", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "env-line-height-wrapper",
      tag: "DIV",
      computedStyles: { display: "block", lineHeight: "26px" },
      styles: { display: "block", fontSize: "16px", lineHeight: "env(--leading)" },
      rect: { x: 0, y: 0, width: 240, height: 52 },
      childNodes: [{
        nodeType: 3,
        id: "env-line-height-text",
        text: "First line\nSecond line",
        rect: { x: 0, y: 0, width: 240, height: 52 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene.text.lineHeight).toBe(26);
  });

  it("recovers a trimmed multi-line line-height from measured text geometry", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-measured-line-height",
      tag: "DIV",
      styles: { display: "block", fontSize: "16px" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 3,
        id: "trimmed-measured-line-height-text",
        text: "First line\nSecond line",
        rect: { x: 0, y: 0, width: 240, height: 56 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene.text).toMatchObject({ lineCount: 2, lineHeight: 28 });
  });

  it("resolves inherited percentage/em line-height on the declaring wrapper", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "percentage-line-height-wrapper",
      tag: "DIV",
      styles: { display: "block", fontSize: "20px", lineHeight: "150%" },
      rect: { x: 0, y: 0, width: 240, height: 60 },
      childNodes: [{
        nodeType: 3,
        id: "percentage-line-height-text",
        text: "First line\nSecond line",
        rect: { x: 0, y: 0, width: 240, height: 60 },
        lineCount: 2,
        styles: { fontSize: "16px", lineHeight: "150%" },
      }],
    }, { x: 0, y: 0 });

    // The legacy child token is interpreted as an inherited percentage, so
    // the parent's 20px font size determines 30px leading rather than the
    // child's 16px font size determining 24px.
    expect(scene.text.lineHeight).toBe(30);
  });

  it("recovers measured text geometry when a trimmed text child loses rect extensions", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-heading",
      tag: "H1",
      attributes: {
        "data-open-canvas-text-rect": JSON.stringify({ x: 6, y: 8, width: 180, height: 52 }),
        "data-open-canvas-line-count": "2",
      },
      styles: { display: "block", width: "260px", height: "72px", fontSize: "24px", lineHeight: "28px" },
      rect: { x: 20, y: 30, width: 260, height: 72 },
      childNodes: [{ nodeType: 3, id: "trimmed-heading-text", text: "Measured\nheading" }],
    }, { x: 0, y: 0 });

    expect(scene.rect).toMatchObject({ x: 20, y: 30, width: 260, height: 72 });
    expect(scene.textRect).toEqual({ x: 6, y: 8, width: 180, height: 52 });
    expect(scene.text).toMatchObject({ content: "Measured\nheading", lineCount: 2, lineHeight: 28 });
    expect(context.measuredTextPosition(scene)).toEqual({ x: 26, y: 38 });
  });

  it("recovers anonymous text-run geometry from compatibility attributes", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "button",
      tag: "BUTTON",
      styles: { display: "flex", width: "180px", height: "48px", fontSize: "16px", lineHeight: "20px" },
      rect: { x: 20, y: 30, width: 180, height: 48 },
      childNodes: [{
        nodeType: 3,
        id: "button-label",
        text: "Continue",
        attributes: {
          "data-open-canvas-text-rect": JSON.stringify({ x: 24, y: 14, width: 72, height: 20 }),
          "data-open-canvas-line-count": "1",
          "data-open-canvas-line-height": "20px",
        },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      id: "button-label",
      rect: { x: 24, y: 14, width: 72, height: 20 },
      text: { content: "Continue", lineCount: 1, lineHeight: 20 },
    });
  });

  it("recovers a line-height marker when a trimmed H2D payload drops styles", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "marked-line-height",
      tag: "DIV",
      attributes: { "data-open-canvas-line-height": "28px" },
      styles: { fontSize: "16px" },
      rect: { x: 0, y: 0, width: 220, height: 56 },
      childNodes: [{
        nodeType: 3,
        id: "marked-line-height-text",
        text: "First line\nSecond line",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });
    expect(scene.text.lineHeight).toBe(28);
  });

  it("recovers kebab-case line-height from a trimmed H2D payload", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "kebab-line-height",
      tag: "DIV",
      styles: { display: "block", fontSize: "16px", ["line-height"]: "30px" },
      rect: { x: 0, y: 0, width: 220, height: 60 },
      childNodes: [{
        nodeType: 3,
        id: "kebab-line-height-text",
        text: "First line\nSecond line",
        rect: { x: 0, y: 0, width: 220, height: 60 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene).toMatchObject({
      type: "text",
      text: { lineHeight: 30 },
    });
  });

  it("prefers a measured line-height marker over a retained normal wrapper value", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "normal-wrapper-with-marker",
      tag: "DIV",
      attributes: { "data-open-canvas-line-height": "28px" },
      computedStyles: { display: "block", fontSize: "16px", lineHeight: "normal" },
      styles: { display: "block", fontSize: "16px", lineHeight: "normal" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 3,
        id: "normal-wrapper-with-marker-text",
        text: "First line\nSecond line",
        attributes: { "data-open-canvas-line-height": "28px" },
        styles: { fontSize: "16px", lineHeight: "normal" },
        rect: { x: 0, y: 0, width: 240, height: 56 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene.text).toMatchObject({ lineHeight: 28 });
    expect(scene.computedStyles?.lineHeight).toBe("28px");
  });

  it("prefers a measured line-height marker over an authored relative token", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "relative-wrapper-with-marker",
      tag: "DIV",
      attributes: { "data-open-canvas-line-height": "30px" },
      styles: { display: "block", fontSize: "20px", lineHeight: "150%" },
      rect: { x: 0, y: 0, width: 240, height: 60 },
      childNodes: [{
        nodeType: 3,
        id: "relative-wrapper-with-marker-text",
        text: "First line\nSecond line",
        attributes: { "data-open-canvas-line-height": "30px" },
        styles: { fontSize: "16px", lineHeight: "150%" },
        rect: { x: 0, y: 0, width: 240, height: 60 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene.text).toMatchObject({ lineHeight: 30 });
    expect(scene.computedStyles?.lineHeight).toBe("30px");
  });

  it("keeps a child-specific measured marker when its wrapper says normal", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "normal-child-with-marker",
      tag: "DIV",
      styles: { display: "block", fontSize: "16px", lineHeight: "24px" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 3,
        id: "normal-child-with-marker-text",
        text: "First line\nSecond line",
        attributes: { "data-open-canvas-line-height": "32px" },
        styles: { fontSize: "16px", lineHeight: "normal" },
        rect: { x: 0, y: 0, width: 240, height: 64 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene.text).toMatchObject({ lineHeight: 32 });
  });

  it("does not let a later normal style mask an explicit computed line-height", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "computed-line-height-before-normal-style",
      tag: "DIV",
      computedStyles: { display: "block", fontSize: "16px", lineHeight: "28px" },
      styles: { display: "block", fontSize: "16px", lineHeight: "normal" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 3,
        id: "computed-line-height-before-normal-style-text",
        text: "First line\nSecond line",
        styles: { fontSize: "16px", lineHeight: "normal" },
        rect: { x: 0, y: 0, width: 240, height: 56 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene.text).toMatchObject({ lineHeight: 28 });
    expect(scene.computedStyles?.lineHeight).toBe("28px");
  });

  it("recovers a first-line text-indent marker for anonymous H2D text", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "indented-wrapper",
      tag: "DIV",
      styles: { fontSize: "16px", lineHeight: "24px" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 3,
        id: "indented-run",
        text: "Indented first line\nSecond line",
        attributes: { "data-open-canvas-text-indent": "32px" },
        rect: { x: 0, y: 0, width: 240, height: 56 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene.text?.textIndent).toBe(32);
  });

  it("inherits a parent H2D line-height through nested text wrappers", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "inherited-parent-wrapper",
      tag: "DIV",
      styles: { fontSize: "16px", lineHeight: "28px" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 1,
        id: "inherited-child-wrapper",
        tag: "DIV",
        styles: { lineHeight: "inherit" },
        rect: { x: 0, y: 0, width: 240, height: 56 },
        childNodes: [{
          nodeType: 3,
          id: "inherited-nested-copy",
          text: "First line\nSecond line",
          rect: { x: 0, y: 0, width: 240, height: 56 },
          lineCount: 2,
        }],
      }],
    }, { x: 0, y: 0 });
    const nestedText = scene.children[0];
    expect(nestedText.text.lineHeight).toBe(28);

    const node = mockFigmaNode("TEXT");
    const report = importReport();
    expect(context.applySceneLineHeight(node, nestedText, report)).toBe(true);
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(report.lineHeightFailures).toBe(0);
  });

  it("does not let a legacy 0px line-height mask the inherited value", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "zero-line-height-wrapper",
      tag: "DIV",
      styles: { lineHeight: "0px", fontSize: "16px" },
      computedStyles: { display: "block", lineHeight: "28px", fontSize: "16px" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 3,
        id: "zero-line-height-text",
        text: "First line\nSecond line",
        rect: { x: 0, y: 0, width: 240, height: 56 },
        lineCount: 2,
        styles: { lineHeight: "0px", fontSize: "16px" },
      }],
    }, { x: 0, y: 0 });

    const text = scene;
    expect(text.text.lineHeight).toBe(28);
    const node = mockFigmaNode("TEXT");
    const report = importReport();
    expect(context.applySceneLineHeight(node, text, report)).toBe(true);
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(report.lineHeightFailures).toBe(0);
  });

  it("resolves inherited H2D text properties instead of treating CSS keywords as values", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "inherited-text-style-wrapper",
      tag: "DIV",
      styles: {
        fontFamily: "Inter, sans-serif",
        fontSize: "18px",
        fontWeight: "600",
        fontStyle: "italic",
        letterSpacing: "1px",
        wordSpacing: "2px",
        color: "rgb(20, 40, 60)",
        backgroundColor: "rgb(240, 240, 240)",
        fontVariantCaps: "small-caps",
        fontVariantNumeric: "tabular-nums",
        textAlign: "center",
        lineHeight: "28px",
      },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [{
        nodeType: 3,
        id: "inherited-text-style-run",
        text: "Inherited",
        styles: {
          fontFamily: "inherit",
          fontSize: "inherit",
          fontWeight: "inherit",
          fontStyle: "inherit",
          letterSpacing: "inherit",
          wordSpacing: "inherit",
          color: "inherit",
          fontVariantCaps: "inherit",
          fontVariantNumeric: "inherit",
          textAlign: "inherit",
          lineHeight: "inherit",
        },
        rect: { x: 0, y: 0, width: 100, height: 28 },
        lineCount: 1,
      }],
    }, { x: 0, y: 0 });
    const text = scene.children[0];
    expect(text.text).toMatchObject({
      fontFamily: "Inter, sans-serif",
      fontSize: 18,
      fontWeight: 600,
      fontStyle: "italic",
      fontVariantCaps: "small-caps",
      fontVariantNumeric: "tabular-nums",
      letterSpacing: 1,
      wordSpacing: 2,
      lineHeight: 28,
      textAlign: "center",
    });
    expect(text.fill).toEqual({ color: "rgb(20, 40, 60)" });
  });

  it("reports a Figma line-height write failure without aborting import", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "PIXELS", value: 16 }),
      set: () => { throw new Error("read only"); },
    });

    expect(context.applySceneLineHeight(node, {
      id: "readonly-copy",
      type: "text",
      text: { content: "Copy", lineHeight: 22 },
    }, report)).toBe(false);

    expect(report.lineHeightApplied).toBe(0);
    expect(report.lineHeightFailures).toBe(1);
    expect(report.lineHeightFailureNodes[0]).toMatchObject({ id: "readonly-copy", value: 22, message: "read only" });
  });

  it("reports a host that does not expose TextNode line-height", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    const node = { type: "TEXT" };

    expect(context.applySceneLineHeight(node, {
      id: "missing-line-height-api",
      text: { fontSize: 16, lineHeight: 24 },
    }, report)).toBe(false);
    expect(report.lineHeightApplied).toBe(0);
    expect(report.lineHeightFailures).toBe(1);
    expect(report.lineHeightFailureNodes[0]).toMatchObject({
      id: "missing-line-height-api",
      value: 24,
      message: "Figma runtime does not expose TextNode.lineHeight or range line-height APIs",
    });
  });

  it("reapplies captured line-height after the final layout pass", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.lineHeight = { unit: "AUTO", value: 0 };
    const scene = {
      id: "final-copy",
      type: "text",
      text: { lineHeight: 26 },
      children: [],
    };
    const report = importReport();

    context.verifySceneLineHeights(scene, node, report);

    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 26 });
    expect(node.getPluginData("open-canvas-line-height")).toBe("26");
    expect(report.lineHeightFailures).toBe(0);
  });

  it("deduplicates repeated successful line-height writes during convergence", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "First line\nSecond line";
    const scene = {
      id: "deduplicated-successful-line-height",
      type: "text",
      text: { content: node.characters, lineHeight: 26 },
    };
    const report = importReport();

    expect(context.applySceneLineHeight(node, scene, report)).toBe(true);
    expect(context.applySceneLineHeight(node, scene, report)).toBe(true);

    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightNodes).toEqual([{ id: scene.id, value: 26 }]);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("deduplicates successful line-height writes beyond the diagnostic detail cap", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    const nodes = Array.from({ length: 101 }, (_, index) => {
      const node = mockFigmaNode("TEXT");
      node.characters = `Copy ${index}`;
      return node;
    });

    nodes.forEach((node, index) => {
      const scene = { id: `large-copy-${index}`, type: "text", text: { content: node.characters, lineHeight: 24 } };
      expect(context.applySceneLineHeight(node, scene, report)).toBe(true);
    });
    const lastScene = { id: "large-copy-100", type: "text", text: { content: nodes[100].characters, lineHeight: 24 } };
    expect(context.applySceneLineHeight(nodes[100], lastScene, report)).toBe(true);

    expect(report.lineHeightApplied).toBe(101);
    expect(report.lineHeightNodes).toHaveLength(100);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("does not report comma-separated normal blend modes as degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "hero",
      computedStyles: { backgroundBlendMode: "normal, normal" },
      borders: [undefined, undefined, undefined, undefined],
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("reports balance and pretty text wrapping strategies", () => {
    const context = loadPluginFunctions();
    for (const textWrapStyle of ["balance", "pretty", "stable"]) {
      const report = importReport();
      context.recordSceneDegradations({
        id: `wrap-${textWrapStyle}`,
        computedStyles: { textWrapStyle },
      }, report);
      expect(report.styleDegradations).toBe(1);
      expect(report.styleDegradationNodes[0].message)
        .toContain(`text-wrap-style ${textWrapStyle}`);
    }
  });

  it("reports CSS Text Level 4 wrapping and text-box controls", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "text-level-4",
      computedStyles: {
        textWrapMode: "nowrap",
        whiteSpaceCollapse: "preserve-breaks",
        textBoxTrim: "trim-both",
        textBoxEdge: "cap alphabetic",
      },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("text-wrap-mode nowrap");
    expect(report.styleDegradationNodes[0].message).toContain("text-box-trim trim-both");
  });

  it("reports wrap-reverse while retaining its layout metadata", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    const scene = {
      id: "reverse-wrap",
      layout: { mode: "horizontal", wrap: true, wrapReverse: true },
      computedStyles: { display: "flex", flexWrap: "wrap-reverse" },
    };
    context.recordSceneDegradations(scene, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("wrap-reverse");
    expect(context.authoredLayoutMetadata({
      ...scene,
      layout: {
        ...scene.layout,
        gap: 0,
        padding: [0, 0, 0, 0],
        position: "flow",
        widthMode: "fixed",
        heightMode: "fixed",
      },
    })).toMatchObject({ wrap: true, wrapReverse: true });
  });

  it("reports per-child baseline alignment as a measured constraint", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "baseline-child",
      layout: { alignSelf: "baseline" },
      computedStyles: { display: "block", alignSelf: "baseline" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("per-child baseline override");
  });

  it("normalizes safe and unsafe H2D alignment prefixes", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "safe-align",
      tag: "DIV",
      styles: {
        width: "200px",
        height: "80px",
        display: "flex",
        alignItems: "safe center",
        justifyContent: "unsafe center",
      },
      rect: { x: 0, y: 0, width: 200, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout).toMatchObject({ alignItems: "center", justifyContent: "center" });

    const report = importReport();
    context.recordSceneDegradations({
      id: "safe-align",
      computedStyles: { alignItems: "safe center", justifyContent: "unsafe center" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("overflow-safety policy");
  });

  it("keeps normal flex and grid alignment on the H2D replay path", () => {
    const context = loadPluginFunctions();
    const flexScene = context.sceneFromH2D({
      nodeType: 1,
      id: "normal-flex-align",
      tag: "DIV",
      styles: {
        width: "240px",
        height: "80px",
        display: "flex",
        alignItems: "normal",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(flexScene.layout.alignItems).toBe("stretch");

    const gridScene = context.sceneFromH2D({
      nodeType: 1,
      id: "normal-grid-align",
      tag: "SECTION",
      styles: {
        width: "240px",
        height: "80px",
        display: "grid",
        alignItems: "normal",
        justifyItems: "normal",
        justifySelf: "normal",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(gridScene.layout).toMatchObject({
      alignItems: "stretch",
      justifyItems: "stretch",
      justifySelf: "stretch",
    });

    const blockScene = context.sceneFromH2D({
      nodeType: 1,
      id: "normal-block-align",
      tag: "ARTICLE",
      styles: {
        width: "240px",
        height: "120px",
        display: "block",
        alignItems: "normal",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [{
        nodeType: 1,
        id: "normal-block-child",
        tag: "DIV",
        styles: { width: "120px", height: "40px", display: "block" },
        rect: { x: 0, y: 0, width: 120, height: 40 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });
    expect(blockScene.layout.alignItems).toBe("stretch");
  });

  it("preserves Grid justify-content stretch in H2D replay", () => {
    const context = loadPluginFunctions();
    for (const value of ["normal", "stretch"]) {
      const scene = context.sceneFromH2D({
        nodeType: 1,
        id: `grid-justify-${value}`,
        tag: "SECTION",
        styles: { width: "240px", height: "80px", display: "grid", justifyContent: value },
        rect: { x: 0, y: 0, width: 240, height: 80 },
        childNodes: [],
      }, { x: 0, y: 0 });
      expect(scene.layout.justifyContent).toBe("stretch");
    }
  });

  it("recovers authored place-content from a trimmed H2D style map", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "place-content-grid",
      tag: "SECTION",
      styles: {
        width: "240px",
        height: "120px",
        display: "grid",
        placeContent: "center space-between",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout.placeContent).toBe("center space-between");
  });

  it("reverses H2D flex rows according to the captured bidi direction", () => {
    const context = loadPluginFunctions();
    const rtlRow = context.sceneFromH2D({
      nodeType: 1,
      id: "rtl-row",
      tag: "NAV",
      styles: { width: "240px", height: "40px", display: "flex", flexDirection: "row", direction: "rtl" },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });
    const rtlRowReverse = context.sceneFromH2D({
      nodeType: 1,
      id: "rtl-row-reverse",
      tag: "NAV",
      styles: { width: "240px", height: "40px", display: "flex", flexDirection: "row-reverse", direction: "rtl" },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(rtlRow.layout.reverse).toBe(true);
    expect(rtlRowReverse.layout.reverse).toBeUndefined();
  });


  it("locks H2D-only multi-column scenes to captured geometry", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "multi-column-copy",
      tag: "ARTICLE",
      styles: {
        width: "320px",
        height: "180px",
        display: "block",
        columnCount: "2",
        columnGap: "24px",
      },
      rect: { x: 0, y: 0, width: 320, height: 180 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout.geometryLock).toBe(true);
    const report = importReport();
    context.recordSceneDegradations(scene, report);
    expect(report.styleDegradationNodes[0].message).toContain("multi-column");
  });

  it("restores a native H2D geometry marker on anonymous text runs", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "wrapped-grid",
      tag: "DIV",
      styles: {
        width: "240px",
        height: "80px",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 3,
        id: "wrapped-grid-label",
        text: "Label",
        rect: { x: 48, y: 28, width: 80, height: 24 },
        lineHeight: 24,
        attributes: { "data-open-canvas-geometry-lock": "true" },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      id: "wrapped-grid-label",
      layout: { position: "flow", geometryLock: true },
      text: { lineHeight: 24 },
    });
  });

  it("restores auto-margin metadata and measured locking from H2D", async () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "auto-margin-row",
      tag: "DIV",
      styles: { width: "240px", height: "40px", display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [{
        nodeType: 1,
        id: "auto-margin-item",
        tag: "DIV",
        attributes: {
          "data-open-canvas-auto-margins": "[false,false,false,true]",
          "data-open-canvas-geometry-lock": "true",
        },
        styles: {
          width: "60px",
          height: "40px",
          display: "block",
          marginLeft: "auto",
          position: "absolute",
        },
        rect: { x: 180, y: 0, width: 60, height: 40 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      id: "auto-margin-item",
      layout: { autoMargins: [false, false, false, true], position: "flow", geometryLock: true },
    });

    const degradationReport = importReport();
    context.recordSceneDegradations(scene.children[0], degradationReport);
    expect(degradationReport.styleDegradationNodes[0].message).toContain("auto margins left");

    context.figma.createFrame = () => mockFigmaNode("FRAME");
    const page = mockFigmaNode("PAGE");
    const report = importReport();
    const imported = await context.createNode(scene, page, [], report, undefined, {
      images: new Map(),
      vectors: new Map(),
    });
    const item = imported.children.find(child => child.getPluginData?.("open-canvas-id") === "auto-margin-item");
    expect(item.getPluginData("open-canvas-auto-margins")).toBe("[false,false,false,true]");
    expect(item.layoutPositioning).toBe("ABSOLUTE");
  });

  it("applies CSS order to anonymous H2D text runs before scene creation", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "ordered-row",
      tag: "DIV",
      styles: { width: "240px", height: "40px", display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [
        {
          nodeType: 3,
          id: "late-label",
          text: "Late",
          rect: { x: 120, y: 8, width: 40, height: 24 },
          styles: { order: "2", lineHeight: "24px" },
        },
        {
          nodeType: 1,
          id: "early-card",
          tag: "DIV",
          styles: { width: "80px", height: "24px", display: "block", order: "1" },
          rect: { x: 8, y: 8, width: 80, height: 24 },
          childNodes: [],
        },
      ],
    }, { x: 0, y: 0 });

    expect(scene.children.map(child => child.id)).toEqual(["early-card", "late-label"]);
    expect(scene.children[1].layout.order).toBe(2);
  });

  it("keeps z-index on anonymous H2D text layers in a free-positioning wrapper", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "stacked-wrapper",
      tag: "DIV",
      styles: { width: "240px", height: "80px", display: "block", paddingTop: "1px" },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 3,
        id: "stacked-label",
        text: "Badge",
        rect: { x: 12, y: 12, width: 80, height: 20 },
        styles: { zIndex: "7", lineHeight: "20px" },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({ id: "stacked-label", zIndex: 7, text: { lineHeight: 20 } });
  });

  it("reports sticky positioning as a static viewport capture", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "sticky-header",
      positioning: "sticky",
      computedStyles: { position: "sticky", top: "8px" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("scroll-linked sticky constraint");
  });

  it("does not report sticky degradation when no inset threshold is active", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "sticky-without-threshold",
      positioning: "sticky",
      computedStyles: { position: "sticky", top: "auto", right: "auto", bottom: "auto", left: "auto" },
    }, report);
    expect(report.styleDegradations).toBe(0);
    expect(report.styleDegradationNodes).toEqual([]);
  });

  it("reports logical sticky insets even when physical aliases are trimmed", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "logical-sticky-header",
      positioning: "sticky",
      computedStyles: {
        position: "sticky",
        top: "auto",
        right: "auto",
        bottom: "auto",
        left: "auto",
        insetInlineStart: "12px",
        insetInlineEnd: "auto",
        insetBlockStart: "auto",
        insetBlockEnd: "auto",
      },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("scroll-linked sticky constraint");
  });

  it("retains scroll constraints as metadata and reports their Figma limitation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    const scene = {
      id: "snap-carousel",
      computedStyles: {
        scrollSnapType: "x mandatory",
        scrollSnapAlign: "center",
        overscrollBehavior: "contain",
      },
    };
    context.recordSceneDegradations(scene, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("scroll-snap-type x mandatory");
    expect(context.scrollConstraintMetadata(scene)).toEqual({
      scrollSnapType: "x mandatory",
      scrollSnapAlign: "center",
      overscrollBehavior: "contain",
    });
  });

  it("recovers scroll constraints from a trimmed H2D marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-scroll-container",
      tag: "DIV",
      attributes: {
        "data-open-canvas-scroll-constraints": JSON.stringify({
          values: {
            scrollSnapType: "x mandatory",
            scrollSnapAlign: "center",
            overscrollBehavior: "contain",
          },
          measuredGeometry: true,
          nativeScrollEquivalent: false,
        }),
      },
      styles: {},
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles).toMatchObject({
      scrollSnapType: "x mandatory",
      scrollSnapAlign: "center",
      overscrollBehavior: "contain",
    });
    const node = mockFigmaNode("FRAME");
    context.applySceneCompositingConstraints(node, scene);
    expect(node.getPluginData("open-canvas-scroll-constraints")).toBe(JSON.stringify({
      scrollSnapType: "x mandatory",
      scrollSnapAlign: "center",
      overscrollBehavior: "contain",
    }));
  });

  it("reports unsupported font shaping settings without dropping their metadata", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "optical-copy",
      computedStyles: {
        fontOpticalSizing: "none",
        fontSizeAdjust: "0.5",
        fontKerning: "none",
        fontSynthesis: "none",
        fontVariantCaps: "small-caps",
        fontVariantNumeric: "tabular-nums",
      },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("font-optical-sizing none");
    expect(report.styleDegradationNodes[0].message).toContain("font-size-adjust 0.5");
    expect(report.styleDegradationNodes[0].message).toContain("font-kerning none");
    expect(report.styleDegradationNodes[0].message).toContain("font-synthesis none");
    expect(report.styleDegradationNodes[0].message).toContain("font-variant-caps small-caps");
    expect(report.styleDegradationNodes[0].message).toContain("font-variant-numeric tabular-nums");
  });

  it("does not classify the expanded default font-synthesis shorthand as shaping", () => {
    const context = loadPluginFunctions();
    expect(context.textShapingFallbackProperties({
      computedStyles: { fontSynthesis: "weight style small-caps" },
      text: {},
    })).toEqual([]);

    const report = importReport();
    context.recordSceneDegradations({
      id: "default-synthesis-copy",
      computedStyles: { fontSynthesis: "weight style small-caps position" },
    }, report);
    expect(report.styleDegradations).toBe(0);

    expect(context.textShapingFallbackProperties({
      computedStyles: { fontSynthesis: "none" },
      text: {},
    })).toEqual([{ property: "font-synthesis", value: "none", defaults: ["auto"] }]);
  });

  describe("shared scene geometry overlay", () => {
  it("keeps Auto Layout on fully captured containers", () => {
    const context = loadPluginFunctions();
    expect(context.capturedAbsoluteContainer({
      type: "frame",
      layout: { mode: "horizontal" },
      children: [
        { layout: { position: "absolute" } },
        { positioning: "fixed", layout: { position: "flow" } },
      ],
    })).toBe(false);
    expect(context.capturedAbsoluteContainer({
      type: "frame",
      layout: { mode: "vertical" },
      children: [{ layout: { position: "absolute" } }, { layout: { position: "flow" } }],
    })).toBe(false);
    expect(context.capturedAbsoluteContainer({
      type: "frame",
      layout: { mode: "vertical" },
      children: [{ layout: { geometryLock: true, position: "flow" } }],
    })).toBe(false);
    expect(context.capturedAbsoluteContainer({
      type: "frame",
      layout: { mode: "vertical", visualSnapshot: true },
      children: [{ layout: { geometryLock: true, position: "flow" } }],
    })).toBe(false);
    expect(context.capturedAbsoluteContainer({
      type: "frame",
      children: [{ layout: { geometryLock: true, position: "flow" } }],
    })).toBe(false);
  });

  it("keeps captured absolute coordinates unchanged at the native import boundary", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    context.figma.createRectangle = () => mockFigmaNode("RECTANGLE");
    context.figma.createText = () => mockFigmaNode("TEXT");
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    context.figma.loadFontAsync = async () => undefined;

    const page = mockFigmaNode("PAGE");
    const scene = {
      id: "capture-root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      layout: { mode: "vertical", gap: 8, padding: [10, 10, 10, 10], position: "flow" },
      children: [{
        id: "absolute-card",
        type: "frame",
        rect: { x: 20, y: 30, width: 50, height: 20 },
        positioning: "absolute",
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "absolute" },
        children: [],
      }],
    };

    const imported = await context.createNode(scene, page, [], importReport(), undefined, {
      images: new Map(),
      vectors: new Map(),
    });

    expect(imported.layoutMode).toBe("VERTICAL");
    expect(imported.children[0]).toMatchObject({ x: 20, y: 30, width: 50, height: 20 });
  });

  it("clears managed metadata when a replacement scene returns to defaults", async () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.description = "old description";
    for (const [key, value] of [
      ["open-canvas-semantic", JSON.stringify({ role: "button" })],
      ["open-canvas-structural-semantics", JSON.stringify([{ role: "group" }])],
      ["open-canvas-layout", JSON.stringify({ mode: "vertical" })],
      ["open-canvas-position-offset", JSON.stringify({ left: "10px" })],
      ["open-canvas-sizing-constraints", JSON.stringify({ minWidth: "120px" })],
      ["open-canvas-responsive-sizing", JSON.stringify({ width: "50%" })],
      ["open-canvas-border-image", JSON.stringify({ source: "url(old.png)" })],
      ["open-canvas-background-attachment", "fixed"],
    ]) node.setPluginData(key, value);
    context.figma.createFrame = () => node;

    await context.createNode({
      id: "default-metadata-frame",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      computedStyles: {},
      layout: { mode: "none", position: "flow", padding: [0, 0, 0, 0] },
      children: [],
    }, mockFigmaNode("PAGE"), [], importReport(), undefined, {
      images: new Map(),
      vectors: new Map(),
    });

    for (const key of [
      "open-canvas-semantic",
      "open-canvas-structural-semantics",
      "open-canvas-layout",
      "open-canvas-position-offset",
      "open-canvas-sizing-constraints",
      "open-canvas-responsive-sizing",
      "open-canvas-border-image",
      "open-canvas-background-attachment",
    ]) {
      expect(node.getPluginData(key)).toBe("");
    }
    expect(node.description).toBe("");
  });

  it("sets absolute positioning only after the node is attached to an Auto Layout parent", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => {
      const node = mockFigmaNode("FRAME");
      let positioning = "IN_FLOW";
      Object.defineProperty(node, "layoutPositioning", {
        configurable: true,
        get: () => positioning,
        set: (value) => {
          if (value === "ABSOLUTE" && !node.parent) throw new Error("detached absolute node");
          positioning = value;
        },
      });
      let horizontalSizing = "FIXED";
      let verticalSizing = "FIXED";
      let alignment = "INHERIT";
      Object.defineProperty(node, "layoutSizingHorizontal", {
        configurable: true,
        get: () => horizontalSizing,
        set: (value) => {
          if (!node.parent) throw new Error("detached horizontal sizing");
          horizontalSizing = value;
        },
      });
      Object.defineProperty(node, "layoutSizingVertical", {
        configurable: true,
        get: () => verticalSizing,
        set: (value) => {
          if (!node.parent) throw new Error("detached vertical sizing");
          verticalSizing = value;
        },
      });
      Object.defineProperty(node, "layoutAlign", {
        configurable: true,
        get: () => alignment,
        set: (value) => {
          if (!node.parent) throw new Error("detached layout align");
          alignment = value;
        },
      });
      return node;
    };
    context.figma.loadFontAsync = async () => undefined;
    const page = mockFigmaNode("PAGE");
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow" },
      children: [
        {
          id: "absolute-card",
          type: "frame",
          rect: { x: 20, y: 30, width: 50, height: 20 },
          positioning: "absolute",
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "absolute" },
          children: [],
        },
        {
          id: "flow-card",
          type: "frame",
          rect: { x: 0, y: 0, width: 100, height: 20 },
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
          children: [],
        },
      ],
    };

    const imported = await context.createNode(scene, page, [], importReport(), undefined, {
      images: new Map(),
      vectors: new Map(),
    });

    expect(imported.layoutMode).toBe("VERTICAL");
    const absoluteCard = imported.children.find((child) => child.name === "absolute-card");
    expect(absoluteCard.layoutPositioning).toBe("ABSOLUTE");
    expect(absoluteCard.parent).toBe(imported);
  });

  it("does not broaden selective capture locks to ordinary descendants", () => {
      const context = loadPluginFunctions();
      const scene = {
        id: "root",
        type: "frame",
        rect: { x: 0, y: 0, width: 200, height: 100 },
        layout: { mode: "vertical", gap: 8, padding: [12, 16, 12, 16], position: "flow" },
        children: [{
          id: "card",
          type: "frame",
          rect: { x: 16, y: 12, width: 168, height: 40 },
          layout: { mode: "horizontal", gap: 4, padding: [0, 0, 0, 0], position: "flow" },
          children: [{
            id: "label",
            type: "text",
            rect: { x: 8, y: 10, width: 60, height: 20 },
            layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
            text: { content: "Label", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20, letterSpacing: 0, textAlign: "left" },
            children: [],
          }],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, undefined, { forceVisualLock: true });

    expect(merged.layout.geometryLock).toBeUndefined();
    expect(merged.children[0].layout.geometryLock).toBeUndefined();
    expect(merged.children[0].children[0].layout.geometryLock).toBeUndefined();
  });

  it("promotes a full-viewport app container above HTML and BODY wrappers", () => {
    const context = loadPluginFunctions();
    const app = {
      id: "app",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 0, y: 0, width: 375, height: 980 },
      layout: { mode: "vertical" },
      children: [{ id: "header", type: "frame", rect: { x: 0, y: 0, width: 375, height: 72 }, children: [] }],
    };
    const body = {
      id: "body",
      sourceTag: "BODY",
      type: "frame",
      rect: { x: 0, y: 0, width: 375, height: 980 },
      children: [app],
    };
    const html = {
      id: "html",
      sourceTag: "HTML",
      type: "frame",
      rect: { x: 0, y: 0, width: 375, height: 980 },
      children: [body],
    };

    expect(context.promoteImportRoot(html)).toBe(app);
    expect(context.promoteImportRoot({ ...html, children: [body, { id: "overlay" }] })).not.toBe(app);
  });

  it("keeps a measured lock on direct children of distribution-sensitive frames", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      layout: { mode: "horizontal", gap: 8, justifyContent: "center", padding: [0, 0, 0, 0], position: "flow" },
      children: [{
        id: "card",
        type: "frame",
        rect: { x: 40, y: 0, width: 120, height: 40 },
        layout: { mode: "vertical", gap: 4, padding: [0, 0, 0, 0], position: "flow" },
        children: [{
          id: "label",
          type: "text",
          rect: { x: 8, y: 8, width: 80, height: 20 },
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
          children: [],
        }],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, undefined, { forceVisualLock: true });

    expect(merged.children[0].layout.geometryLock).toBe(true);
    expect(merged.children[0].children[0].layout.geometryLock).toBeUndefined();
  });

  it("locks direct sections inside a full-bleed measured viewport shell", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 120 },
      layout: { mode: "horizontal", gap: 0, padding: [0, 0, 0, 0], justifyContent: "center", position: "flow" },
      children: [{
        id: "viewport-shell",
        type: "frame",
        rect: { x: 0, y: 0, width: 200, height: 120 },
        layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow", geometryLock: true },
        children: [{
          id: "hero",
          type: "frame",
          rect: { x: 0, y: 0, width: 200, height: 72 },
          layout: { mode: "vertical", gap: 4, padding: [8, 8, 8, 8], position: "flow" },
          children: [{
            id: "hero-title",
            type: "text",
            rect: { x: 8, y: 8, width: 120, height: 20 },
            layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
            children: [],
          }],
        }],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, undefined, { forceVisualLock: true });

    expect(merged.children[0].layout.geometryLock).toBe(true);
    expect(merged.children[0].children[0].layout.geometryLock).toBe(true);
    expect(merged.children[0].children[0].children[0].layout.geometryLock).toBeUndefined();
  });

  it("does not lock unrelated shell children while preserving the main stack lock", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 120 },
      layout: { mode: "horizontal", gap: 0, padding: [0, 0, 0, 0], justifyContent: "center", position: "flow" },
      children: [{
        id: "viewport-shell",
        type: "frame",
        rect: { x: 0, y: 0, width: 200, height: 120 },
        layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow", geometryLock: true },
        children: [
          {
            id: "header",
            type: "frame",
            rect: { x: 0, y: 0, width: 200, height: 24 },
            layout: { mode: "horizontal", gap: 4, padding: [0, 0, 0, 0], position: "flow" },
            children: [],
          },
          {
            id: "main-stack",
            type: "frame",
            rect: { x: 0, y: 32, width: 200, height: 88 },
            layout: { mode: "vertical", gap: 4, padding: [8, 8, 8, 8], position: "flow" },
            children: [{
              id: "title",
              type: "text",
              rect: { x: 8, y: 8, width: 120, height: 20 },
              layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
              children: [],
            }],
          },
        ],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, undefined, { forceVisualLock: true });
    const shell = merged.children[0];
    expect(shell.layout.geometryLock).toBe(true);
    expect(shell.children[0].layout.geometryLock).toBeUndefined();
    expect(shell.children[1].layout.geometryLock).toBe(true);
    expect(shell.children[1].children[0].layout.geometryLock).toBeUndefined();
  });

  it("keeps ordinary descendants flow-based in selective compatibility mode", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow" },
      children: [{
        id: "card",
        type: "frame",
        rect: { x: 0, y: 0, width: 240, height: 56 },
        layout: { mode: "vertical", gap: 4, padding: [8, 8, 8, 8], position: "flow" },
        children: [{
          id: "label",
          type: "text",
          rect: { x: 8, y: 8, width: 120, height: 20 },
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
          children: [],
        }],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, undefined, { forceVisualLock: false });

    expect(merged.children[0].layout.geometryLock).toBeUndefined();
    expect(merged.children[0].children[0].layout.geometryLock).toBeUndefined();
  });

  it("keeps visual-snapshot metadata without locking ordinary descendants", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      layout: { mode: "vertical", gap: 8, padding: [8, 8, 8, 8], position: "flow" },
      children: [{
        id: "card",
        type: "frame",
        rect: { x: 8, y: 8, width: 224, height: 56 },
        layout: { mode: "horizontal", gap: 4, padding: [4, 4, 4, 4], position: "flow" },
        children: [{
          id: "label",
          type: "text",
          rect: { x: 4, y: 4, width: 100, height: 20 },
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
          children: [],
        }],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, undefined, { forceVisualLock: true });

    expect(merged.layout.mode).toBe("vertical");
    expect(merged.layout.visualSnapshot).toBe(true);
    expect(merged.children[0].layout.mode).toBe("horizontal");
    expect(merged.children[0].layout.visualSnapshot).toBeUndefined();
    expect(merged.children[0].layout.geometryLock).toBeUndefined();
    expect(merged.children[0].children[0].layout.geometryLock).toBeUndefined();
  });

  it("preserves captured letter spacing for explicit multi-line text", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAutoResize = "WIDTH_AND_HEIGHT";
    node.characters = "Make your next moment\nworth remembering.";
    node.letterSpacing = { unit: "PIXELS", value: -1.395 };

    context.fitTextToCapturedLines(node, {
      rect: { x: 0, y: 0, width: 330, height: 65.09 },
      text: { lineCount: 2, letterSpacing: -1.395 },
    });

    expect(node.textAutoResize).toBe("NONE");
    expect(node.letterSpacing).toEqual({ unit: "PIXELS", value: -1.395 });
    expect(node.width).toBe(330);
    expect(node.height).toBeCloseTo(65.09, 5);
  });

  it("applies captured word spacing to space character ranges when supported", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "Wide words again";
    const ranges = [];
    node.setRangeLetterSpacing = (start, end, value) => ranges.push({ start, end, value });
    const report = importReport();

    context.applyTextWordSpacing(node, {
      id: "word-spaced-copy",
      type: "text",
      text: { content: node.characters, letterSpacing: "1px", wordSpacing: "3px" },
    }, report);

    expect(ranges).toEqual([
      { start: 4, end: 5, value: { unit: "PIXELS", value: 4 } },
      { start: 10, end: 11, value: { unit: "PIXELS", value: 4 } },
    ]);
    expect(node.getPluginData("open-canvas-word-spacing")).toBe("3");
    expect(report.styleDegradations).toBe(0);
  });

  it("restores space ranges when word spacing returns to its default", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "Wide words again";
    const ranges = [];
    node.setRangeLetterSpacing = (start, end, value) => ranges.push({ start, end, value });
    const report = importReport();
    const scene = {
      id: "reused-word-spaced-copy",
      type: "text",
      text: { content: node.characters, letterSpacing: "1px", wordSpacing: "3px" },
    };

    context.applyTextWordSpacing(node, scene, report);
    expect(ranges.slice(-2)).toEqual([
      { start: 4, end: 5, value: { unit: "PIXELS", value: 4 } },
      { start: 10, end: 11, value: { unit: "PIXELS", value: 4 } },
    ]);

    scene.text.wordSpacing = "0px";
    context.applyTextWordSpacing(node, scene, report);

    expect(ranges.slice(-2)).toEqual([
      { start: 4, end: 5, value: { unit: "PIXELS", value: 1 } },
      { start: 10, end: 11, value: { unit: "PIXELS", value: 1 } },
    ]);
    expect(node.getPluginData("open-canvas-word-spacing")).toBe("");
    expect(node.getPluginData("open-canvas-word-spacing-native")).toBe("");
    expect(report.styleDegradations).toBe(0);
  });

  it("reapplies letter spacing after a detached text write was normalized", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    let stored = { unit: "PIXELS", value: 0 };
    Object.defineProperty(node, "letterSpacing", {
      configurable: true,
      get: () => stored,
      set: value => { stored = node.parent ? value : { unit: "PIXELS", value: 0 }; },
    });
    const scene = {
      id: "attached-letter-spacing",
      type: "text",
      text: { content: "Wide", letterSpacing: "1.5px", wordSpacing: "0px" },
      children: [],
    };
    context.applySceneLetterSpacing(node, scene, importReport());
    expect(node.letterSpacing.value).toBe(0);
    parent.appendChild(node);
    const report = importReport();
    context.verifySceneTextSpacing(scene, node, report);
    expect(node.letterSpacing).toEqual({ unit: "PIXELS", value: 1.5 });
    expect(report.styleDegradations).toBe(0);
  });

  it("reapplies native text alignment, case, direction, and fixed sizing", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.textAlignHorizontal = "LEFT";
    node.textCase = "ORIGINAL";
    node.textDirection = "LTR";
    node.textAlignVertical = "CENTER";
    node.textAutoResize = "WIDTH_AND_HEIGHT";
    context.applySceneTextAttributes(node, {
      type: "text",
      text: { textAlign: "right", textTransform: "uppercase", direction: "rtl" },
    });
    expect(node.textAlignHorizontal).toBe("RIGHT");
    expect(node.textCase).toBe("UPPER");
    expect(node.textDirection).toBe("RTL");
    expect(node.textAlignVertical).toBe("TOP");
    expect(node.textAutoResize).toBe("NONE");
  });

  it("retains non-default CSS Text Level 4 controls on the editable text node", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    context.applySceneTextAttributes(node, {
      type: "text",
      text: { textAlign: "left" },
      computedStyles: {
        textWrapMode: "nowrap",
        whiteSpaceCollapse: "preserve-breaks",
        textBoxTrim: "trim-both",
        textBoxEdge: "cap alphabetic",
      },
    });
    expect(JSON.parse(node.getPluginData("open-canvas-text-level-4"))).toEqual({
      "text-wrap-mode": "nowrap",
      "white-space-collapse": "preserve-breaks",
      "text-box-trim": "trim-both",
      "text-box-edge": "cap alphabetic",
    });
  });

  it("clears stale CSS Text Level 4 metadata when controls return to defaults", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    context.applySceneTextAttributes(node, {
      type: "text",
      text: { textAlign: "left" },
      computedStyles: {
        textWrapMode: "nowrap",
        whiteSpaceCollapse: "preserve-breaks",
        textBoxTrim: "trim-both",
        textBoxEdge: "cap alphabetic",
      },
    });
    expect(node.getPluginData("open-canvas-text-level-4")).not.toBe("");

    context.applySceneTextAttributes(node, {
      type: "text",
      text: { textAlign: "left" },
      computedStyles: {
        textWrapMode: "wrap",
        whiteSpaceCollapse: "collapse",
        textBoxTrim: "none",
        textBoxEdge: "auto",
      },
    });

    expect(node.getPluginData("open-canvas-text-level-4")).toBe("");
  });

  it("does not treat a selected host Frame placement as a root page mismatch", () => {
    const context = loadPluginFunctions();
    const report = {
      remainingGeometryAudited: 0,
      remainingMismatches: 0,
      maxRemainingMeasuredDelta: 0,
      maxRemainingMeasuredSizeDelta: 0,
      remainingMismatchNodes: [],
    };
    const host = mockFigmaNode("FRAME");
    const root = mockFigmaNode("FRAME");
    root.x = 96;
    root.y = 128;
    root.resize(240, 120);
    host.appendChild(root);

    context.auditRemainingGeometry(report, {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
      children: [],
    }, root);

    expect(report.remainingMismatches).toBe(0);
    expect(report.maxRemainingMeasuredDelta).toBe(0);
  });

  it("rejects flexible sizing when it reflows a measured sibling", () => {
      const context = loadPluginFunctions();
      const parent = mockFigmaNode("FRAME");
      parent.layoutMode = "VERTICAL";
      const first = mockFigmaNode("FRAME");
      first.name = "first";
      first.resize(100, 20);
      const second = mockFigmaNode("FRAME");
      second.name = "second";
      second.resize(100, 20);
      parent.appendChild(first);
      parent.appendChild(second);
      let horizontalSizing = "FIXED";
      Object.defineProperty(first, "layoutSizingHorizontal", {
        configurable: true,
        get: () => horizontalSizing,
        set: (value) => {
          horizontalSizing = value;
          if (value === "HUG") second.y = 8;
        },
      });
      const scene = {
        id: "root",
        type: "frame",
        rect: { x: 0, y: 0, width: 100, height: 40 },
        layout: { mode: "vertical", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
        children: [
          {
            id: "first",
            type: "frame",
            rect: { x: 0, y: 0, width: 100, height: 20 },
            layout: { mode: "none", widthMode: "hug", heightMode: "fixed", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
            children: [],
          },
          {
            id: "second",
            type: "frame",
            rect: { x: 0, y: 20, width: 100, height: 20 },
            layout: { mode: "none", widthMode: "fixed", heightMode: "fixed", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
            children: [],
          },
        ],
      };

      context.restoreStableSizing(scene, parent);

      expect(first.layoutSizingHorizontal).toBe("FIXED");
      expect(first.width).toBe(100);
    });

    it("keeps synthetic H2D snapshot locks out of ordinary Auto Layout flow", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow" },
      fill: { color: "#123456" },
      children: [{
        id: "card",
        type: "frame",
        rect: { x: 12, y: 20, width: 176, height: 60 },
        margin: [4, 0, 6, 0],
        layout: { mode: "none", gap: 0, padding: [8, 8, 8, 8], position: "flow" },
        fill: { color: "#ffffff" },
        children: [],
      }],
    };
    const merged = context.mergeMeasuredGeometry(scene, {
      nodeType: 1,
      id: "root",
      childNodes: [{
        nodeType: 1,
        id: "card",
        layout: { geometryLock: true },
        childNodes: [],
      }],
    });
    expect(merged).not.toBe(scene);
    expect(merged.fill).toEqual({ color: "#123456" });
    expect(merged.children[0].fill).toEqual({ color: "#ffffff" });
    expect(merged.children[0].layout.geometryLock).toBeUndefined();
    expect(merged.children[0].layout.position).toBe("flow");
    expect(merged.children[0].margin).toEqual([4, 0, 6, 0]);
    expect(scene.children[0].layout.geometryLock).toBeUndefined();
  });

  it("locks children only when the authored parent distribution needs measured positions", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "button",
      type: "frame",
      rect: { x: 20, y: 30, width: 80, height: 32 },
      margin: [0, 0, 0, 0],
      layout: { mode: "horizontal", gap: 0, padding: [8, 12, 8, 12], position: "flow", alignItems: "center", justifyContent: "center" },
      computedStyles: { display: "grid" },
      children: [{
        id: "button-text-0",
        type: "text",
        rect: { x: 12, y: 9, width: 56, height: 14 },
        margin: [0, 0, 0, 0],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
        text: { content: "Select", fontFamily: "Inter", fontSize: 12, fontWeight: 700, lineHeight: 14, letterSpacing: 0, textAlign: "left" },
        children: [],
      }],
    };
    const merged = context.mergeMeasuredGeometry(scene, {
      nodeType: 1,
      id: "button",
      layout: { geometryLock: true },
      childNodes: [{ nodeType: 3, id: "button-text-0", text: "Select", rect: { x: 32, y: 39, width: 56, height: 14 }, lineCount: 1 }],
    });
    expect(merged.children[0].layout.geometryLock).toBe(true);
    expect(merged.children[0].margin).toEqual([0, 0, 0, 0]);
  });

  it("keeps cross-axis centering in native Auto Layout when the main axis starts", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "centered-row",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 48 },
      margin: [0, 0, 0, 0],
      layout: { mode: "horizontal", gap: 8, padding: [8, 12, 8, 12], position: "flow", alignItems: "center", justifyContent: "start" },
      children: [{
        id: "label",
        type: "text",
        rect: { x: 12, y: 17, width: 80, height: 14 },
        margin: [0, 0, 0, 0],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
        text: { content: "Label", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 14, letterSpacing: 0, textAlign: "left" },
        children: [],
      }],
    };
    const merged = context.mergeMeasuredGeometry(scene, undefined, { forceVisualLock: true });
    expect(merged.layout.mode).toBe("horizontal");
    expect(merged.children[0].layout.geometryLock).toBeUndefined();
  });

  it("locks distribution-sensitive center and space-between tracks without removing the parent Auto Layout", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "toolbar",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 56 },
      margin: [0, 0, 0, 0],
      layout: { mode: "horizontal", gap: 0, padding: [8, 12, 8, 12], position: "flow", alignItems: "center", justifyContent: "space-between" },
      computedStyles: { display: "flex" },
      children: [{
        id: "toolbar-title",
        type: "text",
        rect: { x: 12, y: 18, width: 100, height: 20 },
        margin: [0, 0, 0, 0],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
        text: { content: "Toolbar", fontFamily: "Inter", fontSize: 16, fontWeight: 600, lineHeight: 20, letterSpacing: 0, textAlign: "left" },
        children: [],
      }],
    };
    const merged = context.mergeMeasuredGeometry(scene, {
      nodeType: 1,
      id: "toolbar",
      childNodes: [{ nodeType: 1, id: "toolbar-title", layout: { geometryLock: true }, childNodes: [] }],
    });
    expect(merged.layout.mode).toBe("horizontal");
    expect(merged.children[0].layout.geometryLock).toBe(true);
  });

  it("keeps margins on synthetic geometry locks for their flow placeholders", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "stack",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 160 },
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow", justifyContent: "center" },
      children: [{
        id: "card",
        type: "frame",
        rect: { x: 12, y: 30, width: 216, height: 48 },
        margin: [12, 0, 16, 0],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
        children: [],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, {
      nodeType: 1,
      id: "stack",
      childNodes: [{ nodeType: 1, id: "card", layout: { geometryLock: true }, childNodes: [] }],
    });

    expect(merged.children[0].layout.geometryLock).toBe(true);
    expect(merged.children[0].margin).toEqual([12, 0, 16, 0]);
  });

  it("locks shared-scene auto-margin children even without a precomputed geometry flag", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "auto-margin-shared-root",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow" },
      children: [{
        id: "auto-margin-shared-child",
        type: "frame",
        rect: { x: 0, y: 40, width: 120, height: 40 },
        margin: [0, 0, 0, 0],
        layout: { mode: "none", autoMargins: [true, false, false, false], position: "flow" },
        children: [],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, undefined, { forceVisualLock: false });
    expect(merged.children[0].layout.geometryLock).toBe(true);
    expect(merged.children[0].layout.autoMargins).toEqual([true, false, false, false]);
  });

  it("does not preserve margin twice for authored absolute layers", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "stack",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 160 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow" },
      children: [{
        id: "badge",
        type: "frame",
        rect: { x: 12, y: 30, width: 24, height: 24 },
        margin: [4, 5, 6, 7],
        positioning: "absolute",
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "absolute" },
        children: [],
      }],
    };

    const merged = context.mergeMeasuredGeometry(scene, {
      nodeType: 1,
      id: "stack",
      childNodes: [{ nodeType: 1, id: "badge", styles: { position: "absolute" }, layout: { position: "absolute" }, childNodes: [] }],
    });

    expect(merged.children[0].layout.geometryLock).toBe(true);
    expect(merged.children[0].margin).toEqual([0, 0, 0, 0]);
  });

  it("keeps icon and label grandchildren in a locked navigation item flow", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "nav",
      type: "frame",
      rect: { x: 0, y: 0, width: 375, height: 66 },
      layout: { mode: "horizontal", gap: 0, padding: [12, 15, 18, 15], position: "flow", justifyContent: "space-around" },
      children: [{
        id: "nav-item",
        type: "frame",
        rect: { x: 34, y: 13, width: 40, height: 35 },
        layout: { mode: "vertical", gap: 5, padding: [1, 6, 1, 6], position: "flow", alignItems: "center" },
        children: [
          { id: "nav-icon", type: "vector", rect: { x: 11, y: 1, width: 17, height: 17 }, layout: { mode: "none", position: "flow" }, children: [] },
          { id: "nav-label", type: "text", rect: { x: 6, y: 23, width: 28, height: 11 }, layout: { mode: "none", position: "flow" }, children: [] },
        ],
      }],
    };
    const merged = context.mergeMeasuredGeometry(scene, {
      nodeType: 1,
      id: "nav",
      layout: { mode: "horizontal", justifyContent: "space-around" },
      childNodes: [{
        nodeType: 1,
        id: "nav-item",
        layout: { mode: "vertical", alignItems: "center" },
        childNodes: [
          { nodeType: 1, id: "nav-icon", layout: { mode: "none" }, childNodes: [] },
          { nodeType: 3, id: "nav-label", rect: { x: 40, y: 36, width: 28, height: 11 } },
        ],
      }],
    });
    expect(merged.children[0].layout.geometryLock).toBe(true);
    expect(merged.children[0].children[0].layout.geometryLock).toBeUndefined();
    expect(merged.children[0].children[1].layout.geometryLock).toBeUndefined();
  });

  it("does not treat H2D visual snapshot positioning as source absolute layout", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow" },
      children: [{
        id: "card",
        type: "frame",
        rect: { x: 12, y: 20, width: 176, height: 60 },
        margin: [4, 0, 6, 0],
        layout: { mode: "none", gap: 0, padding: [8, 8, 8, 8], position: "flow" },
        children: [],
      }],
    };
    const merged = context.mergeMeasuredGeometry(scene, {
      nodeType: 1,
      id: "root",
      childNodes: [{
        nodeType: 1,
        id: "card",
        styles: { position: "absolute" },
        layout: { mode: "none", gap: 0, padding: [8, 8, 8, 8], position: "flow" },
        childNodes: [],
      }],
    });
    expect(merged.children[0].layout.geometryLock).toBeUndefined();
    expect(merged.children[0].margin).toEqual([4, 0, 6, 0]);
  });

  it("rehydrates official pseudo-element nodes without putting them in normal H2D flow", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "card",
      tag: "DIV",
      styles: { width: "200px", height: "80px", display: "block" },
      rect: { x: 0, y: 0, width: 200, height: 80 },
      childNodes: [],
      pseudoElementNodes: {
        before: {
          nodeType: 1,
          id: "card::before",
          tag: "SPAN",
          styles: { width: "24px", height: "24px", backgroundColor: "rgb(255, 0, 0)" },
          rect: { x: 4, y: 4, width: 24, height: 24 },
          childNodes: [],
        },
      },
    }, { x: 0, y: 0 });

    expect(scene.children).toHaveLength(1);
    expect(scene.children[0]).toMatchObject({ id: "card::before", pseudo: "before", type: "frame" });
  });

  it("inherits line-height and typography for generated pseudo text", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "pseudo-text-parent",
      tag: "DIV",
      styles: {
        width: "240px", height: "80px", display: "block", fontSize: "18px",
        fontFamily: "Noto Sans SC", fontWeight: "700", color: "rgb(20, 40, 60)",
        lineHeight: "30px",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [],
      pseudoElementNodes: {
        before: {
          nodeType: 1,
          id: "pseudo-text-parent::before",
          tag: "SPAN",
          styles: {
            width: "80px", height: "30px", display: "block", fontSize: "inherit",
            fontFamily: "inherit", fontWeight: "inherit", color: "inherit", lineHeight: "inherit",
          },
          rect: { x: 0, y: 0, width: 80, height: 30 },
          childNodes: [{
            nodeType: 3,
            id: "pseudo-text-run",
            text: "前缀",
            rect: { x: 0, y: 0, width: 36, height: 30 },
            lineCount: 1,
            styles: {
              fontSize: "inherit", fontFamily: "inherit", fontWeight: "inherit",
              color: "inherit", lineHeight: "inherit",
            },
          }],
        },
      },
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      id: "pseudo-text-parent::before",
      pseudo: "before",
      type: "text",
      fill: { color: "rgb(20, 40, 60)" },
      text: {
        fontFamily: "Noto Sans SC",
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 30,
      },
    });
  });

  it("inherits line-height for an editable list marker run", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "list-item",
      tag: "LI",
      styles: {
        width: "240px", height: "40px", display: "list-item", fontSize: "18px",
        fontFamily: "Noto Sans SC", fontWeight: "700", color: "rgb(20, 40, 60)",
        lineHeight: "30px",
      },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [{
        nodeType: 1,
        id: "list-item-marker",
        tag: "SPAN",
        attributes: { "data-open-canvas-marker": "true" },
        styles: {
          width: "12px", height: "30px", display: "block", fontSize: "inherit",
          fontFamily: "inherit", fontWeight: "inherit", color: "inherit", lineHeight: "inherit",
        },
        rect: { x: -16, y: 0, width: 12, height: 30 },
        childNodes: [{
          nodeType: 3,
          id: "list-item-marker-text",
          text: "•",
          rect: { x: -16, y: 0, width: 12, height: 30 },
          lineCount: 1,
          styles: {
            fontSize: "inherit", fontFamily: "inherit", fontWeight: "inherit",
            color: "inherit", lineHeight: "inherit",
          },
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      id: "list-item-marker",
      type: "text",
      fill: { color: "rgb(20, 40, 60)" },
      text: {
        fontFamily: "Noto Sans SC",
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 30,
      },
    });
  });

  it("rehydrates multi-layer mask styles from an H2D-only payload", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "masked-card",
      tag: "DIV",
      styles: {
        width: "160px",
        height: "80px",
        display: "block",
        maskImage: "linear-gradient(to right, transparent, #000), radial-gradient(circle, #000, transparent)",
        maskPosition: "0% 0%, 20px 10px",
        maskSize: "auto, 80px 40px",
        maskRepeat: "no-repeat, repeat-x",
        maskClip: "border-box, border-box",
        maskOrigin: "border-box, border-box",
        maskMode: "match-source, alpha",
        maskComposite: "add",
      },
      rect: { x: 0, y: 0, width: 160, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.type).toBe("frame");
    expect(scene.computedStyles).toMatchObject({
      maskImage: "linear-gradient(to right, transparent, #000), radial-gradient(circle, #000, transparent)",
      maskPosition: "0% 0%, 20px 10px",
      maskSize: "auto, 80px 40px",
      maskRepeat: "no-repeat, repeat-x",
      maskMode: "match-source, alpha",
      maskComposite: "add",
    });
    expect(context.maskGeometrySupported(scene)).toBe(true);
  });

  it("uses a resolved line-height carried by a direct text node", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "copy",
      tag: "DIV",
      // Deliberately omit line-height from the parent styles to model a
      // compatibility payload that trimmed inherited declarations.
      styles: { width: "200px", height: "80px", display: "block" },
      rect: { x: 0, y: 0, width: 200, height: 80 },
      childNodes: [{
        nodeType: 3,
        id: "copy-text",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 120, height: 48 },
        // Model a legacy bridge that retained a stale single-line count even
        // though the editable text already contains an explicit break.
        lineCount: 1,
        lineHeight: 24,
      }],
    }, { x: 0, y: 0 });

    expect(scene).toMatchObject({
      type: "text",
      text: { content: "First\nSecond", lineHeight: 24 },
    });
    expect(scene.text.lineCount).toBe(2);
  });

  it("keeps explicit breaks when a painted wrapper contains a stale child line count", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "button-copy",
      tag: "BUTTON",
      styles: {
        width: "160px",
        height: "64px",
        display: "flex",
        padding: "8px",
        backgroundColor: "rgb(20, 40, 60)",
        lineHeight: "28px",
        fontSize: "16px",
      },
      rect: { x: 0, y: 0, width: 160, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "button-copy-text",
        text: "First\nSecond",
        rect: { x: 12, y: 8, width: 120, height: 56 },
        lineCount: 1,
        lineHeight: 28,
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { content: "First\nSecond", lineCount: 2, lineHeight: 28 },
    });
  });

  it("normalizes malformed line-count metadata without losing explicit breaks", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "malformed-line-count",
      tag: "DIV",
      styles: { width: "160px", height: "64px", display: "block", lineHeight: "28px" },
      rect: { x: 0, y: 0, width: 160, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "malformed-line-count-text",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 120, height: 56 },
        lineCount: "not-a-number",
        lineHeight: 28,
      }],
    }, { x: 0, y: 0 });

    expect(scene.text.lineCount).toBe(2);
  });

  it("recovers text typography from an anonymous H2D run when its wrapper styles are trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-typography-wrapper",
      tag: "DIV",
      styles: { width: "220px", height: "48px", display: "block" },
      rect: { x: 0, y: 0, width: 220, height: 48 },
      childNodes: [{
        nodeType: 3,
        id: "trimmed-typography-run",
        text: "CJK copy",
        rect: { x: 0, y: 0, width: 120, height: 28 },
        lineCount: 1,
        styles: {
          fontFamily: "Noto Sans SC",
          fontSize: "20px",
          fontWeight: "700",
          letterSpacing: "1px",
          wordSpacing: "2px",
          textAlign: "start",
          color: "rgb(20, 40, 60)",
          direction: "rtl",
        },
      }],
    }, { x: 0, y: 0 });

    expect(scene).toMatchObject({
      type: "text",
      fill: { color: "rgb(20, 40, 60)" },
      text: {
        fontFamily: "Noto Sans SC",
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: 1,
        wordSpacing: 2,
        textAlign: "right",
        direction: "rtl",
      },
    });
  });

  it("keeps anonymous run typography inside a painted wrapper", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "painted-typography-wrapper",
      tag: "BUTTON",
      styles: { width: "180px", height: "48px", display: "block", backgroundColor: "#ffffff" },
      rect: { x: 0, y: 0, width: 180, height: 48 },
      childNodes: [{
        nodeType: 3,
        id: "painted-typography-run",
        text: "Primary",
        rect: { x: 12, y: 14, width: 80, height: 20 },
        lineCount: 1,
        styles: {
          fontFamily: "Noto Sans SC",
          fontSize: "20px",
          fontWeight: "700",
          lineHeight: "28px",
          textDecoration: "underline",
          textDecorationStyle: "wavy",
          textOverflow: "ellipsis",
          lineClamp: "1",
          verticalAlign: "super",
          overflowWrap: "anywhere",
          wordBreak: "break-all",
          hyphens: "auto",
        },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: {
        fontFamily: "Noto Sans SC",
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 28,
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textOverflow: "ellipsis",
        maxLines: 1,
        verticalAlign: "super",
        overflowWrap: "anywhere",
        wordBreak: "break-all",
        hyphens: "auto",
      },
    });
  });

  it("recovers anonymous text line-height from a trimmed CSS style field", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "styled-copy-wrapper",
      tag: "DIV",
      styles: { width: "200px", height: "64px", display: "block", lineHeight: "18px", paddingTop: "1px" },
      rect: { x: 0, y: 0, width: 200, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "styled-copy-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 120, height: 48 },
        lineCount: 2,
        // Model a bridge that dropped the numeric extension but retained the
        // direct text node's CSS replay style.
        styles: { lineHeight: "32px" },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { lineHeight: 32 },
    });
  });

  it("recovers anonymous text line-height from the computed-style compatibility channel", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "computed-style-copy-wrapper",
      tag: "DIV",
      styles: { width: "200px", height: "64px", display: "block", paddingTop: "1px" },
      rect: { x: 0, y: 0, width: 200, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "computed-style-copy-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 120, height: 48 },
        lineCount: 2,
        // Model a bridge that trims the raw style object but retains the
        // duplicated computed-style compatibility channel.
        computedStyles: { lineHeight: "32px" },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { lineHeight: 32 },
    });
  });

  it("recovers line-height from a kebab-case computed-style bridge field", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "kebab-computed-style-copy-wrapper",
      tag: "DIV",
      styles: { width: "200px", height: "64px", display: "block", paddingTop: "1px" },
      rect: { x: 0, y: 0, width: 200, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "kebab-computed-style-copy-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 120, height: 48 },
        lineCount: 2,
        computedStyles: { "line-height": "34px" },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { lineHeight: 34 },
    });
  });

  it("preserves element-backed line-height through a computed-styles-only bridge", () => {
    const context = loadPluginFunctions();
    const document = {
      version: 1,
      pageId: "line-height-bridge-page",
      title: "Line-height bridge",
      viewport: { width: 320, height: 180 },
      devicePixelRatio: 2,
      root: {
        id: "line-height-bridge-root",
        sourceTag: "DIV",
        type: "frame",
        rect: { x: 0, y: 0, width: 320, height: 180 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: {
          mode: "vertical",
          gap: 0,
          padding: [0, 0, 0, 0],
          widthMode: "fixed",
          heightMode: "fixed",
          position: "flow",
        },
        children: [{
          id: "line-height-bridge-paragraph",
          sourceTag: "P",
          type: "text",
          rect: { x: 12, y: 16, width: 200, height: 56 },
          textRect: { x: 0, y: 0, width: 200, height: 56 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: {
            mode: "none",
            gap: 0,
            padding: [0, 0, 0, 0],
            widthMode: "fixed",
            heightMode: "fixed",
            position: "flow",
          },
          computedStyles: { display: "block", fontSize: "16px", lineHeight: "28px" },
          text: {
            content: "First line\nSecond line",
            lineCount: 2,
            fontFamily: "Inter",
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 28,
            letterSpacing: 0,
            textAlign: "left",
          },
          children: [],
        }],
      },
      assets: [],
      fonts: [],
      diagnostics: [],
    };

    const h2dRoot = toH2D(document).root;
    const paragraph = h2dRoot.childNodes[0];
    expect(paragraph.nodeType).toBe(1);
    const textRun = paragraph.childNodes[0];
    expect(textRun.nodeType).toBe(3);
    expect(textRun.computedStyles).toMatchObject({ lineHeight: "28px", "line-height": "28px" });
    delete textRun.styles;

    const scene = context.sceneFromH2D(h2dRoot, { x: 0, y: 0 });
    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { lineHeight: 28 },
    });
  });

  it("prefers the measured line-height marker over a stale CSS string", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "stale-line-height-wrapper",
      tag: "DIV",
      styles: { width: "200px", height: "64px", display: "block", lineHeight: "18px", paddingTop: "1px" },
      rect: { x: 0, y: 0, width: 200, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "stale-line-height-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 120, height: 48 },
        lineCount: 2,
        styles: { lineHeight: "18px" },
        attributes: { "data-open-canvas-line-height": "32px" },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { lineHeight: 32 },
    });
  });

  it("keeps a concrete H2D text value when its marker is only the generic default", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "generic-marker-wrapper",
      tag: "DIV",
      styles: { width: "240px", height: "64px", display: "block", fontSize: "16px" },
      rect: { x: 0, y: 0, width: 240, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "generic-marker-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 200, height: 56 },
        lineCount: 2,
        lineHeight: 28,
        attributes: { "data-open-canvas-line-height": "19.2px" },
      }],
    }, { x: 0, y: 0 });

    expect(scene).toMatchObject({
      type: "text",
      text: { lineHeight: 28 },
    });
  });

  it("uses the wrapper font size when rejecting a generic wrapper marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "font-sized-generic-marker-wrapper",
      tag: "DIV",
      styles: { width: "240px", height: "64px", display: "block", fontSize: "20px", lineHeight: "30px" },
      attributes: { "data-open-canvas-line-height": "24px" },
      rect: { x: 0, y: 0, width: 240, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "font-sized-generic-marker-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 200, height: 60 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene).toMatchObject({
      type: "text",
      text: { lineHeight: 30 },
    });
  });

  it("does not let an unresolved normal marker erase a concrete wrapper line-height", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "unresolved-marker-wrapper",
      tag: "DIV",
      styles: { width: "240px", height: "80px", display: "block", lineHeight: "28px" },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "unresolved-marker-child",
        tag: "P",
        styles: { width: "200px", height: "56px", display: "block" },
        rect: { x: 0, y: 0, width: 200, height: 56 },
        childNodes: [{
          nodeType: 3,
          id: "unresolved-marker-run",
          text: "First\nSecond",
          rect: { x: 0, y: 0, width: 160, height: 56 },
          lineCount: 2,
          lineHeight: 19.2,
          attributes: { "data-open-canvas-line-height": "normal" },
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { lineHeight: 28 },
    });
  });

  it("recovers anonymous text line-height from the compatibility attribute marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "marked-copy-wrapper",
      tag: "DIV",
      styles: { width: "200px", height: "64px", display: "block", paddingTop: "1px" },
      rect: { x: 0, y: 0, width: 200, height: 64 },
      childNodes: [{
        nodeType: 3,
        id: "marked-copy-run",
        text: "First\nSecond",
        rect: { x: 0, y: 0, width: 120, height: 48 },
        lineCount: 2,
        attributes: { "data-open-canvas-line-height": "32px" },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { lineHeight: 32 },
    });
  });

  it("inherits a parent line-height when a nested H2D element omits it", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "inherited-wrapper",
      tag: "DIV",
      styles: { width: "240px", height: "80px", display: "block", fontSize: "16px", lineHeight: "28px" },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "inherited-child",
        tag: "P",
        // Trimmed H2D payloads can omit inherited font and line-height styles.
        styles: { width: "200px", height: "56px", display: "block" },
        rect: { x: 0, y: 0, width: 200, height: 56 },
        childNodes: [{
          nodeType: 3,
          id: "inherited-run",
          text: "First\nSecond",
          rect: { x: 0, y: 0, width: 160, height: 56 },
          lineCount: 2,
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { fontSize: 16, lineHeight: 28 },
    });
  });

  it("keeps mixed anonymous line-heights when H2D runs are wrapped for native import", () => {
    const context = loadPluginFunctions();
    const makeRun = (id, lineHeight, text) => ({
      nodeType: 1,
      id: `${id}-wrapper`,
      tag: "SPAN",
      attributes: {
        "data-open-canvas-text-run": "true",
        "data-open-canvas-line-height": `${lineHeight}px`,
      },
      styles: { display: "inline", fontSize: "16px", lineHeight: `${lineHeight}px` },
      rect: { x: lineHeight === 20 ? 0 : 80, y: 0, width: 80, height: lineHeight },
      childNodes: [{
        nodeType: 3,
        id,
        text,
        rect: { x: lineHeight === 20 ? 0 : 80, y: 0, width: 80, height: lineHeight },
        lineCount: 1,
        lineHeight,
        styles: { fontSize: "16px", lineHeight: `${lineHeight}px` },
      }],
    });
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "mixed-wrapper-root",
      tag: "DIV",
      styles: { display: "block", width: "160px", height: "28px" },
      rect: { x: 0, y: 0, width: 160, height: 28 },
      childNodes: [makeRun("small-run", 20, "Small"), makeRun("large-run", 28, "Large")],
    }, { x: 0, y: 0 });

    expect(scene.children.map((child) => child.text?.lineHeight)).toEqual([20, 28]);
    expect(scene.children.map((child) => child.text?.content)).toEqual(["Small", "Large"]);
  });

  it("inherits percentage and em line-heights as the parent absolute line box", () => {
    const context = loadPluginFunctions();
    const makePayload = lineHeight => ({
      nodeType: 1,
      id: `inherited-${lineHeight}`,
      tag: "DIV",
      styles: { width: "280px", height: "100px", display: "block", fontSize: "16px", lineHeight },
      rect: { x: 0, y: 0, width: 280, height: 100 },
      childNodes: [{
        nodeType: 1,
        id: `child-${lineHeight}`,
        tag: "SPAN",
        // The child has a different font size. Percentage/em line-height
        // values inherited from the parent must not be recalculated here.
        styles: { width: "220px", height: "72px", display: "block", fontSize: "24px" },
        rect: { x: 0, y: 0, width: 220, height: 72 },
        childNodes: [{
          nodeType: 3,
          id: `run-${lineHeight}`,
          text: "First\nSecond",
          rect: { x: 0, y: 0, width: 200, height: 48 },
          lineCount: 2,
        }],
      }],
    });

    const percentage = context.sceneFromH2D(makePayload("150%"), { x: 0, y: 0 });
    const em = context.sceneFromH2D(makePayload("2em"), { x: 0, y: 0 });
    const unitless = context.sceneFromH2D(makePayload("1.5"), { x: 0, y: 0 });
    expect(percentage.children[0]).toMatchObject({ type: "text", text: { fontSize: 24, lineHeight: 24 } });
    expect(em.children[0]).toMatchObject({ type: "text", text: { fontSize: 24, lineHeight: 32 } });
    expect(unitless.children[0]).toMatchObject({ type: "text", text: { fontSize: 24, lineHeight: 36 } });
  });

  it("resolves inheritance keywords on nested H2D wrappers against the ancestor line-height", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "keyword-inherited-wrapper",
      tag: "DIV",
      styles: { width: "240px", height: "96px", display: "block", fontSize: "16px", lineHeight: "28px" },
      rect: { x: 0, y: 0, width: 240, height: 96 },
      childNodes: [{
        nodeType: 1,
        id: "keyword-inherited-child",
        tag: "P",
        styles: { width: "200px", height: "56px", display: "block", lineHeight: "inherit" },
        rect: { x: 0, y: 0, width: 200, height: 56 },
        childNodes: [{
          nodeType: 3,
          id: "keyword-inherited-run",
          text: "First\nSecond",
          rect: { x: 0, y: 0, width: 160, height: 56 },
          lineCount: 2,
          lineHeight: "inherit",
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { fontSize: 16, lineHeight: 28 },
    });
  });

  it("inherits the parent line-height when a trimmed anonymous run is serialized as normal", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "normal-anonymous-parent",
      tag: "DIV",
      styles: { display: "block", fontSize: "16px", lineHeight: "28px" },
      rect: { x: 0, y: 0, width: 240, height: 56 },
      childNodes: [{
        nodeType: 1,
        id: "normal-anonymous-wrapper",
        tag: "P",
        styles: { display: "block" },
        rect: { x: 0, y: 0, width: 240, height: 56 },
        childNodes: [{
          nodeType: 3,
          id: "normal-anonymous-run",
          text: "First\nSecond",
          rect: { x: 0, y: 0, width: 220, height: 56 },
          lineCount: 2,
          styles: { lineHeight: "normal", fontSize: "16px" },
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { lineHeight: 28 },
    });
  });

  it("inherits parent typography for a trimmed nested H2D text element", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "inherited-typography-wrapper",
      tag: "DIV",
      styles: {
        width: "240px", height: "80px", display: "block", fontSize: "18px",
        fontFamily: "Noto Sans SC", fontWeight: "700", letterSpacing: "1px", wordSpacing: "3px", color: "rgb(20, 40, 60)",
        textAlign: "center", lineHeight: "30px", textIndent: "12px", whiteSpace: "pre-line",
        overflowWrap: "anywhere", wordBreak: "break-all", hyphens: "auto",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "trimmed-typography-child",
        tag: "SPAN",
        styles: { width: "200px", height: "30px", display: "block" },
        rect: { x: 0, y: 0, width: 200, height: 30 },
        childNodes: [{
          nodeType: 3,
          id: "trimmed-typography-run",
          text: "标题",
          rect: { x: 0, y: 0, width: 72, height: 30 },
          lineCount: 1,
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: {
        fontFamily: "Noto Sans SC",
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: 1,
        wordSpacing: 3,
        lineHeight: 30,
        textAlign: "center",
        textIndent: 12,
        whiteSpace: "pre-line",
        overflowWrap: "anywhere",
        wordBreak: "break-all",
        hyphens: "auto",
      },
    });
  });

  it("does not leak literal inheritance keywords through nested text wrappers", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "keyword-typography-wrapper",
      tag: "DIV",
      styles: {
        width: "240px", height: "80px", display: "block", fontSize: "18px",
        fontFamily: "Noto Sans SC", fontWeight: "700", letterSpacing: "1px", color: "rgb(20, 40, 60)",
        lineHeight: "30px", textOverflow: "ellipsis", verticalAlign: "super",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "keyword-typography-child",
        tag: "SPAN",
        styles: {
          width: "200px", height: "30px", display: "block", fontSize: "18px",
          fontFamily: "inherit", fontWeight: "inherit", letterSpacing: "inherit", color: "inherit",
          lineHeight: "inherit", textOverflow: "inherit", verticalAlign: "inherit",
        },
        rect: { x: 0, y: 0, width: 200, height: 30 },
        childNodes: [{
          nodeType: 3,
          id: "keyword-typography-run",
          text: "标题",
          rect: { x: 0, y: 0, width: 72, height: 30 },
          lineCount: 1,
          styles: {
            fontFamily: "inherit", fontWeight: "inherit", letterSpacing: "inherit", color: "inherit",
            lineHeight: "inherit", textOverflow: "inherit", verticalAlign: "inherit",
          },
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: {
        fontFamily: "Noto Sans SC",
        fontSize: 18,
        fontWeight: 700,
        letterSpacing: 1,
        lineHeight: 30,
        textOverflow: "ellipsis",
        verticalAlign: "super",
      },
      fill: { color: "rgb(20, 40, 60)" },
    });
  });

  it("inherits webkit text stroke and transparent fill through trimmed H2D wrappers", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "outlined-wrapper",
      tag: "DIV",
      styles: {
        width: "240px", height: "80px", display: "block", fontSize: "18px",
        color: "rgb(20, 40, 60)", lineHeight: "30px",
        WebkitTextStrokeWidth: "2px",
        WebkitTextStrokeColor: "rgb(255, 80, 40)",
        WebkitTextFillColor: "transparent",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "outlined-child",
        tag: "SPAN",
        styles: { width: "200px", height: "30px", display: "block" },
        rect: { x: 0, y: 0, width: 200, height: 30 },
        childNodes: [{ nodeType: 3, id: "outlined-run", text: "Outlined", rect: { x: 0, y: 0, width: 100, height: 30 }, lineCount: 1 }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: {
        textStrokeWidth: 2,
        textStrokeColor: "rgb(255, 80, 40)",
        textFillColor: "transparent",
      },
    });
  });

  it("resolves inherited relative text stroke before a child changes font size", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "relative-stroke-wrapper",
      tag: "DIV",
      styles: {
        width: "240px", height: "80px", display: "block", fontSize: "20px",
        lineHeight: "30px", WebkitTextStrokeWidth: "0.1em", WebkitTextStrokeColor: "#111",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "relative-stroke-child",
        tag: "SPAN",
        styles: { width: "200px", height: "40px", display: "block", fontSize: "32px" },
        rect: { x: 0, y: 0, width: 200, height: 40 },
        childNodes: [{ nodeType: 3, id: "relative-stroke-run", text: "Outlined", rect: { x: 0, y: 0, width: 140, height: 40 }, lineCount: 1 }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { fontSize: 32, textStrokeWidth: 2, textStrokeColor: "#111" },
    });
  });

  it("resolves functional text stroke on an anonymous H2D run and rejects percentages", () => {
    const context = loadPluginFunctions();
    const makeScene = stroke => context.sceneFromH2D({
      nodeType: 1,
      id: `anonymous-${stroke}`,
      tag: "DIV",
      styles: { width: "240px", height: "40px", display: "block", fontSize: "20px", lineHeight: "24px", paddingTop: "1px" },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [{
        nodeType: 3,
        id: `anonymous-run-${stroke}`,
        text: "Outlined",
        rect: { x: 0, y: 0, width: 120, height: 24 },
        lineCount: 1,
        styles: { WebkitTextStrokeWidth: stroke, WebkitTextStrokeColor: "#111" },
      }],
    }, { x: 0, y: 0 });

    expect(makeScene("calc(0.1em + 1px)").children[0].text.textStrokeWidth).toBe(3);
    expect(makeScene("10%").children[0].text.textStrokeWidth).toBe(0);
  });

  it("does not leak inheritance keywords through nested text paint styles", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "paint-keyword-wrapper",
      tag: "DIV",
      styles: {
        width: "240px", height: "80px", display: "block", fontSize: "18px",
        color: "rgb(20, 40, 60)", lineHeight: "30px",
        WebkitTextStrokeWidth: "2px",
        WebkitTextStrokeColor: "rgb(255, 80, 40)",
        WebkitTextFillColor: "transparent",
        textShadow: "1px 2px 3px rgba(0,0,0,.35)",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "paint-keyword-child",
        tag: "SPAN",
        styles: {
          width: "200px", height: "30px", display: "block",
          WebkitTextStrokeWidth: "inherit",
          WebkitTextStrokeColor: "inherit",
          WebkitTextFillColor: "inherit",
          textShadow: "inherit",
        },
        rect: { x: 0, y: 0, width: 200, height: 30 },
        childNodes: [{
          nodeType: 3,
          id: "paint-keyword-run",
          text: "Outlined shadow",
          rect: { x: 0, y: 0, width: 160, height: 30 },
          lineCount: 1,
          styles: {
            WebkitTextStrokeWidth: "inherit",
            WebkitTextStrokeColor: "inherit",
            WebkitTextFillColor: "inherit",
            textShadow: "inherit",
          },
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: {
        textStrokeWidth: 2,
        textStrokeColor: "rgb(255, 80, 40)",
        textFillColor: "transparent",
        textShadow: "1px 2px 3px rgba(0,0,0,.35)",
      },
    });
  });

  it("keeps anonymous text-run paint styles when the wrapper is trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "anonymous-painted-wrapper",
      tag: "DIV",
      styles: { width: "240px", height: "40px", display: "block", fontSize: "16px", lineHeight: "24px", paddingTop: "1px" },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [{
        nodeType: 3,
        id: "anonymous-painted-run",
        text: "Outlined shadow",
        rect: { x: 0, y: 0, width: 160, height: 24 },
        lineCount: 1,
        styles: {
          textShadow: "1px 2px 3px rgba(0,0,0,.35)",
          WebkitTextStrokeWidth: "2px",
          WebkitTextStrokeColor: "rgb(255, 80, 40)",
          WebkitTextFillColor: "transparent",
        },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: {
        textShadow: "1px 2px 3px rgba(0,0,0,.35)",
        textStrokeWidth: 2,
        textStrokeColor: "rgb(255, 80, 40)",
        textFillColor: "transparent",
      },
    });
  });

  it("inherits wrapper text shadow when an anonymous run omits its own paint", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "inherited-shadow-wrapper",
      tag: "DIV",
      styles: {
        width: "240px", height: "40px", display: "block", fontSize: "16px",
        lineHeight: "24px", paddingTop: "1px", textShadow: "0 2px 4px rgba(0,0,0,.25)",
      },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [{
        nodeType: 3,
        id: "inherited-shadow-run",
        text: "Shadowed",
        rect: { x: 0, y: 0, width: 90, height: 24 },
        lineCount: 1,
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      text: { textShadow: "0 2px 4px rgba(0,0,0,.25)" },
    });
  });

  it("keeps anonymous text shaping metadata and reports unsupported writing modes", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "anonymous-shaping-wrapper",
      tag: "DIV",
      styles: { width: "240px", height: "40px", display: "block", fontSize: "16px", lineHeight: "24px", paddingTop: "1px", fontSynthesis: "none" },
      rect: { x: 0, y: 0, width: 240, height: 40 },
      childNodes: [{
        nodeType: 3,
        id: "anonymous-shaping-run",
        text: "縦書き",
        rect: { x: 0, y: 0, width: 80, height: 24 },
        lineCount: 1,
        styles: {
          fontOpticalSizing: "none",
          fontSizeAdjust: "0.5",
          textRendering: "geometricPrecision",
          writingMode: "vertical-rl",
          textOrientation: "upright",
          unicodeBidi: "isolate",
          textWrapStyle: "pretty",
        },
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      computedStyles: {
        fontOpticalSizing: "none",
        fontSizeAdjust: "0.5",
        fontSynthesis: "none",
        textRendering: "geometricPrecision",
        writingMode: "vertical-rl",
        textOrientation: "upright",
        unicodeBidi: "isolate",
        textWrapStyle: "pretty",
      },
    });
    const report = importReport();
    context.recordSceneDegradations(scene.children[0], report);
    expect(report.styleDegradationNodes.map(entry => entry.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("writing-mode vertical-rl uses an absolute SVG visual fallback"),
      expect.stringContaining("text-orientation upright is represented by the vertical-writing SVG visual fallback"),
      "unicode-bidi isolate is not supported by Figma TextNode",
      "text-wrap-style pretty is not supported by Figma TextNode",
      expect.stringContaining("font-optical-sizing none"),
      expect.stringContaining("font-size-adjust 0.5"),
      expect.stringContaining("font-synthesis none"),
      expect.stringContaining("text-rendering geometricPrecision"),
    ]));
  });

  it("carries inherited shaping metadata through trimmed nested H2D text wrappers", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "shaping-parent",
      tag: "DIV",
      styles: {
        width: "240px",
        height: "48px",
        display: "block",
        fontSize: "16px",
        lineHeight: "24px",
        writingMode: "vertical-rl",
        textOrientation: "upright",
        unicodeBidi: "isolate",
        textWrapStyle: "pretty",
        fontOpticalSizing: "none",
        fontSizeAdjust: "0.5",
        textRendering: "geometricPrecision",
      },
      rect: { x: 0, y: 0, width: 240, height: 48 },
      childNodes: [{
        nodeType: 1,
        id: "trimmed-text-wrapper",
        tag: "SPAN",
        styles: { display: "block", width: "120px", height: "24px", fontSize: "16px", lineHeight: "24px" },
        rect: { x: 0, y: 0, width: 120, height: 24 },
        childNodes: [{
          nodeType: 3,
          id: "trimmed-text-run",
          text: "縦書き",
          rect: { x: 0, y: 0, width: 80, height: 24 },
          lineCount: 1,
          styles: { lineHeight: "24px" },
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.children[0]).toMatchObject({
      type: "text",
      computedStyles: {
        writingMode: "vertical-rl",
        textOrientation: "upright",
        textWrapStyle: "pretty",
        fontOpticalSizing: "none",
        fontSizeAdjust: "0.5",
        textRendering: "geometricPrecision",
      },
    });
    expect(scene.computedStyles?.unicodeBidi).toBe("isolate");
    const report = importReport();
    context.recordSceneDegradations(scene, report);
    context.recordSceneDegradations(scene.children[0], report);
    expect(report.styleDegradationNodes.map(entry => entry.message)).toEqual(expect.arrayContaining([
      expect.stringContaining("writing-mode vertical-rl uses an absolute SVG visual fallback"),
      expect.stringContaining("text-orientation upright is represented by the vertical-writing SVG visual fallback"),
      "unicode-bidi isolate is not supported by Figma TextNode",
      "text-wrap-style pretty is not supported by Figma TextNode",
      expect.stringContaining("font-optical-sizing none"),
    ]));
  });

  it("resolves legacy rem line-height against the H2D root font size", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "root-rem-copy",
      tag: "DIV",
      styles: { width: "200px", height: "80px", display: "block", fontSize: "20px" },
      rect: { x: 0, y: 0, width: 200, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "root-rem-text",
        tag: "SPAN",
        styles: { width: "120px", height: "40px", display: "block", fontSize: "12px", lineHeight: "2rem" },
        rect: { x: 0, y: 0, width: 120, height: 40 },
        childNodes: [{ nodeType: 3, id: "root-rem-run", text: "Copy", rect: { x: 0, y: 0, width: 40, height: 40 }, lineCount: 1, lineHeight: "2rem" }],
      }],
    }, { x: 0, y: 0 }, 20);
    expect(scene.children[0].text?.lineHeight).toBe(40);
  });

  it("maps logical H2D text alignment using the captured direction", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "rtl-copy",
      tag: "P",
      styles: {
        width: "200px",
        height: "24px",
        display: "block",
        direction: "rtl",
        textAlign: "start",
        fontSize: "16px",
        lineHeight: "24px",
      },
      rect: { x: 0, y: 0, width: 200, height: 24 },
      childNodes: [{ nodeType: 3, id: "rtl-copy-text", text: "שלום", rect: { x: 0, y: 0, width: 80, height: 24 }, lineCount: 1, lineHeight: 24 }],
    }, { x: 0, y: 0 });

    expect(scene.text?.textAlign).toBe("right");
  });

  it("restores flex and grid constraints when importing an H2D-only payload", () => {
    const context = loadPluginFunctions();
    const flexScene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-flex",
      tag: "DIV",
      styles: {
        width: "320px",
        height: "120px",
        display: "flex",
        flexDirection: "row-reverse",
        flexWrap: "wrap",
        gap: "12px",
        rowGap: "16px",
        columnGap: "12px",
        alignItems: "flex-end",
        alignContent: "space-between",
        justifyContent: "space-around",
      },
      rect: { x: 0, y: 0, width: 320, height: 120 },
      childNodes: [{
        nodeType: 1,
        id: "legacy-flex-child",
        tag: "DIV",
        styles: { width: "80px", height: "32px", display: "block", alignSelf: "center" },
        rect: { x: 0, y: 0, width: 80, height: 32 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    expect(flexScene.layout).toMatchObject({
      mode: "horizontal",
      reverse: true,
      wrap: true,
      rowGap: 16,
      columnGap: 12,
      alignItems: "end",
      alignContent: "space-between",
      justifyContent: "space-around",
    });
    expect(flexScene.children[0].layout?.alignSelf).toBe("center");

    const gridScene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-grid",
      tag: "SECTION",
      styles: {
        width: "320px",
        height: "160px",
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        justifyItems: "center",
        alignItems: "stretch",
        alignContent: "normal",
        justifyContent: "center",
      },
      rect: { x: 0, y: 0, width: 320, height: 160 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(gridScene.layout).toMatchObject({
      mode: "horizontal",
      wrap: true,
      justifyItems: "center",
      alignItems: "stretch",
      alignContent: "stretch",
      justifyContent: "center",
    });
  });

  it("locks unequal flex-grow ratios in trimmed H2D payloads", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-grow-ratio",
      tag: "DIV",
      styles: { width: "360px", height: "40px", display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 360, height: 40 },
      childNodes: [
        { nodeType: 1, id: "legacy-grow-one", tag: "DIV", styles: { width: "100px", height: "40px", display: "block", flexGrow: "1" }, rect: { x: 0, y: 0, width: 100, height: 40 }, childNodes: [] },
        { nodeType: 1, id: "legacy-grow-two", tag: "DIV", styles: { width: "200px", height: "40px", display: "block", flexGrow: "2" }, rect: { x: 100, y: 0, width: 200, height: 40 }, childNodes: [] },
        { nodeType: 1, id: "legacy-grow-fixed", tag: "DIV", styles: { width: "60px", height: "40px", display: "block", flexGrow: "0" }, rect: { x: 300, y: 0, width: 60, height: 40 }, childNodes: [] },
      ],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout?.geometryLock).toBe(true);
    expect(scene.children[1].layout?.geometryLock).toBe(true);
    expect(scene.children[2].layout?.geometryLock).toBeUndefined();
  });

  it("locks equal flex-grow children when trimmed H2D flex-basis tokens differ", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-basis-ratio",
      tag: "DIV",
      styles: { width: "360px", height: "40px", display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 360, height: 40 },
      childNodes: [
        { nodeType: 1, id: "legacy-basis-zero", tag: "DIV", styles: { width: "140px", height: "40px", display: "block", flexGrow: "1", flexBasis: "0px" }, rect: { x: 0, y: 0, width: 140, height: 40 }, childNodes: [] },
        { nodeType: 1, id: "legacy-basis-fixed", tag: "DIV", styles: { width: "220px", height: "40px", display: "block", flexGrow: "1", flexBasis: "40px" }, rect: { x: 140, y: 0, width: 220, height: 40 }, childNodes: [] },
      ],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout?.geometryLock).toBe(true);
    expect(scene.children[1].layout?.geometryLock).toBe(true);
  });

  it("keeps equal fixed or percentage flex-basis children flowable in trimmed H2D", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-equal-basis",
      tag: "DIV",
      styles: { width: "320px", height: "40px", display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 320, height: 40 },
      childNodes: [
        { nodeType: 1, id: "legacy-equal-one", tag: "DIV", styles: { width: "160px", height: "40px", display: "block", flexGrow: "1", flexBasis: "50%" }, rect: { x: 0, y: 0, width: 160, height: 40 }, childNodes: [] },
        { nodeType: 1, id: "legacy-equal-two", tag: "DIV", styles: { width: "160px", height: "40px", display: "block", flexGrow: "1", flexBasis: "50%" }, rect: { x: 160, y: 0, width: 160, height: 40 }, childNodes: [] },
      ],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout?.geometryLock).toBeUndefined();
    expect(scene.children[1].layout?.geometryLock).toBeUndefined();
  });

  it("locks auto-basis children with different captured sizes in trimmed H2D", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-intrinsic-basis",
      tag: "DIV",
      styles: { width: "320px", height: "40px", display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 320, height: 40 },
      childNodes: [
        { nodeType: 1, id: "legacy-auto-small", tag: "DIV", styles: { width: "96px", height: "40px", display: "block", flexGrow: "1", flexBasis: "auto" }, rect: { x: 0, y: 0, width: 96, height: 40 }, childNodes: [] },
        { nodeType: 1, id: "legacy-auto-large", tag: "DIV", styles: { width: "224px", height: "40px", display: "block", flexGrow: "1", flexBasis: "auto" }, rect: { x: 96, y: 0, width: 224, height: 40 }, childNodes: [] },
      ],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout?.geometryLock).toBe(true);
    expect(scene.children[1].layout?.geometryLock).toBe(true);
  });

  it("locks positive flex-shrink children with unequal weights in trimmed H2D", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-shrink-ratio",
      tag: "DIV",
      styles: { width: "360px", height: "40px", display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 360, height: 40 },
      childNodes: [
        { nodeType: 1, id: "legacy-shrink-half", tag: "DIV", styles: { width: "140px", height: "40px", display: "block", flexShrink: "0.5" }, rect: { x: 0, y: 0, width: 140, height: 40 }, childNodes: [] },
        { nodeType: 1, id: "legacy-shrink-one", tag: "DIV", styles: { width: "160px", height: "40px", display: "block", flexShrink: "1" }, rect: { x: 140, y: 0, width: 160, height: 40 }, childNodes: [] },
        { nodeType: 1, id: "legacy-shrink-zero", tag: "DIV", styles: { width: "60px", height: "40px", display: "block", flexShrink: "0" }, rect: { x: 300, y: 0, width: 60, height: 40 }, childNodes: [] },
      ],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout?.geometryLock).toBe(true);
    expect(scene.children[1].layout?.geometryLock).toBe(true);
    expect(scene.children[2].layout?.geometryLock).toBeUndefined();
  });

  it("keeps equal non-default flex-shrink weights flowable in trimmed H2D", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "legacy-equal-shrink",
      tag: "DIV",
      styles: { width: "320px", height: "40px", display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 320, height: 40 },
      childNodes: [
        { nodeType: 1, id: "legacy-equal-shrink-one", tag: "DIV", styles: { width: "160px", height: "40px", display: "block", flexShrink: "0.5" }, rect: { x: 0, y: 0, width: 160, height: 40 }, childNodes: [] },
        { nodeType: 1, id: "legacy-equal-shrink-two", tag: "DIV", styles: { width: "160px", height: "40px", display: "block", flexShrink: "0.5" }, rect: { x: 160, y: 0, width: 160, height: 40 }, childNodes: [] },
      ],
    }, { x: 0, y: 0 });

    expect(scene.children[0].layout?.geometryLock).toBeUndefined();
    expect(scene.children[1].layout?.geometryLock).toBeUndefined();
  });

  it("locks H2D-only children in distributed tracks without a shared scene marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "h2d-distributed-row",
      tag: "NAV",
      styles: {
        width: "240px",
        height: "24px",
        display: "flex",
        flexDirection: "row",
        justifyContent: "space-evenly",
        alignItems: "center",
      },
      rect: { x: 0, y: 0, width: 240, height: 24 },
      childNodes: [
        {
          nodeType: 1,
          id: "h2d-status-dot",
          tag: "SPAN",
          styles: { width: "6px", height: "6px", display: "block" },
          rect: { x: 18, y: 9, width: 6, height: 6 },
          childNodes: [],
        },
        {
          nodeType: 1,
          id: "h2d-status-label",
          tag: "SPAN",
          styles: { width: "72px", height: "14px", display: "block" },
          rect: { x: 120, y: 5, width: 72, height: 14 },
          childNodes: [],
        },
        {
          nodeType: 3,
          id: "h2d-direct-copy",
          text: "Now",
          rect: { x: 204, y: 5, width: 28, height: 14 },
          lineCount: 1,
          lineHeight: 14,
        },
      ],
    }, { x: 0, y: 0 });

    expect(scene.layout.justifyContent).toBe("space-evenly");
    expect(scene.children.map(child => child.layout.geometryLock)).toEqual([true, true, true]);
  });

  it("prefers serialized H2D sizing intent over fixed CSS replay dimensions", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "serialized-sizing",
      tag: "MAIN",
      styles: {
        width: "430px",
        height: "512.5px",
        display: "flex",
        flexDirection: "column",
      },
      layout: {
        mode: "vertical",
        gap: 12,
        padding: [0, 0, 0, 0],
        widthMode: "fill",
        heightMode: "hug",
        position: "flow",
      },
      rect: { x: 0, y: 0, width: 430, height: 512.5 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout).toMatchObject({ mode: "vertical", widthMode: "fill", heightMode: "hug", gap: 12 });
  });

  it("keeps gradient text as an editable TEXT scene instead of a painted frame", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "gradient-copy",
      tag: "H1",
      styles: {
        width: "240px",
        height: "32px",
        display: "block",
        color: "transparent",
        backgroundColor: "#ffffff",
        backgroundImage: "linear-gradient(90deg, #f00, #00f)",
        backgroundClip: "text",
        lineHeight: "32px",
      },
      rect: { x: 0, y: 0, width: 240, height: 32 },
      childNodes: [{ nodeType: 3, id: "gradient-copy-text", text: "Gradient", rect: { x: 0, y: 0, width: 120, height: 32 }, lineCount: 1, lineHeight: 32 }],
    }, { x: 0, y: 0 });

    expect(scene.type).toBe("text");
    expect(scene.gradient).toContain("linear-gradient");
    const node = mockFigmaNode("TEXT");
    node.resize(240, 32);
    context.visuals(node, scene);
    expect(node.fills[0].type).toBe("GRADIENT_LINEAR");
  });

  it("uses a clipped solid background as the editable text fill", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "solid-clipped-copy",
      tag: "SPAN",
      styles: {
        width: "120px",
        height: "24px",
        display: "block",
        color: "transparent",
        backgroundColor: "#e11d48",
        backgroundClip: "text",
        lineHeight: "24px",
      },
      rect: { x: 0, y: 0, width: 120, height: 24 },
      childNodes: [{ nodeType: 3, id: "solid-clipped-copy-text", text: "Solid", rect: { x: 0, y: 0, width: 52, height: 24 }, lineCount: 1, lineHeight: 24 }],
    }, { x: 0, y: 0 });

    expect(scene.type).toBe("text");
    expect(scene.fill).toEqual({ color: "#e11d48" });
    const node = mockFigmaNode("TEXT");
    node.resize(120, 24);
    context.visuals(node, scene);
    expect(node.fills[0]).toMatchObject({ type: "SOLID" });
  });

  it("uses an editable image paint for background-clip text", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.resize(120, 24);
    const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const scene = {
      id: "image-clipped-copy",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      backgroundImage: "url(https://example.test/texture.png)",
      backgroundSize: "cover",
      backgroundPosition: "50% 50%",
      backgroundRepeat: "no-repeat",
      computedStyles: {
        backgroundClip: "text",
        backgroundImage: "url(https://example.test/texture.png)",
        backgroundSize: "cover",
        backgroundPosition: "50% 50%",
        backgroundRepeat: "no-repeat",
      },
      text: { content: "Image", lineHeight: 24 },
    };

    context.backgroundImage(node, scene, [{
      id: "texture",
      kind: "image",
      url: "https://example.test/texture.png",
      data: pixelPng,
    }], { images: new Map(), vectors: new Map() }, importReport());

    expect(node.fills).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "IMAGE", imageHash: "image-1", scaleMode: "CROP" }),
    ]));
  });

  it("keeps background-clip text visible when the native image paint is unavailable", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(120, 24);
    parent.appendChild(node);
    node.setPluginData("open-canvas-background-image-ready", "1");
    const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    let svg = "";
    const vector = mockFigmaNode("VECTOR");
    context.figma.createNodeFromSvg = value => { svg = value; return vector; };

    expect(context.createTextShapingVisualFallback(node, {
      id: "image-clipped-fallback",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      backgroundImage: "url(https://example.test/texture.png)",
      computedStyles: {
        backgroundClip: "text",
        backgroundImage: "url(https://example.test/texture.png)",
        backgroundSize: "cover",
        backgroundPosition: "50% 50%",
        backgroundRepeat: "no-repeat",
        color: "transparent",
      },
      text: {
        content: "Image",
        lineCount: 1,
        lineHeight: 24,
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
      },
    }, importReport(), [{
      id: "texture",
      url: "https://example.test/texture.png",
      data: pixelPng,
    }])).toBe(true);

    expect(svg).toContain("cssTextBackgroundImage-pattern");
    expect(svg).toContain("<image");
    expect(svg).toContain('fill="url(#cssTextBackgroundImage-pattern)"');
    expect(vector.name).toBe("__css-text-background-image-image-clipped-fallback");
    expect(vector.getPluginData("open-canvas-text-background-image-fallback")).toBe("1");
    expect(node.opacity).toBe(0);
  });

  it("rebuilds the image-glyph fallback after the captured text box changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(160, 32);
    parent.appendChild(node);
    node.setPluginData("open-canvas-background-image-ready", "1");
    const oldVector = mockFigmaNode("VECTOR");
    oldVector.name = "__css-text-background-image-image-clipped-resize";
    oldVector.setPluginData("open-canvas-text-shaping-owner", "image-clipped-resize");
    oldVector.setPluginData("open-canvas-text-background-image-fallback", "1");
    oldVector.setPluginData("open-canvas-text-shaping-geometry", JSON.stringify({ x: 0, y: 0, width: 120, height: 24 }));
    oldVector.remove = () => {
      const index = parent.children.indexOf(oldVector);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldVector);
    const replacement = mockFigmaNode("VECTOR");
    replacement.remove = () => {
      const index = parent.children.indexOf(replacement);
      if (index >= 0) parent.children.splice(index, 1);
    };
    let svg = "";
    context.figma.createNodeFromSvg = value => { svg = value; return replacement; };
    const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const scene = {
      id: "image-clipped-resize",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      backgroundImage: "url(https://example.test/texture.png)",
      computedStyles: { backgroundClip: "text", backgroundImage: "url(https://example.test/texture.png)" },
      text: { content: "Image", lineCount: 1, lineHeight: 32, fontSize: 16, fontWeight: 400 },
    };

    expect(context.createTextShapingVisualFallback(node, scene, importReport(), [{
      id: "texture", url: "https://example.test/texture.png", data: pixelPng,
    }])).toBe(true);
    expect(parent.children).toEqual([node, replacement]);
    expect(svg).toContain('width="160"');
    expect(JSON.parse(replacement.getPluginData("open-canvas-text-shaping-geometry"))).toMatchObject({ width: 160, height: 32 });
  });

  it("keeps text background assets when line-height fallback rebuilds shaping", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "Image\nText";
    node.resize(160, 32);
    node.setPluginData("open-canvas-background-image-ready", "1");
    parent.appendChild(node);
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    const oldVector = mockFigmaNode("VECTOR");
    oldVector.name = "__css-text-background-image-line-height-asset";
    oldVector.setPluginData("open-canvas-text-shaping-owner", "line-height-asset");
    oldVector.setPluginData("open-canvas-text-background-image-fallback", "1");
    oldVector.setPluginData("open-canvas-text-shaping-geometry", JSON.stringify({ x: 0, y: 0, width: 120, height: 24 }));
    oldVector.remove = () => {
      const index = parent.children.indexOf(oldVector);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldVector);
    const replacement = mockFigmaNode("VECTOR");
    replacement.remove = () => {
      const index = parent.children.indexOf(replacement);
      if (index >= 0) parent.children.splice(index, 1);
    };
    let svg = "";
    context.figma.createNodeFromSvg = value => { svg = value; return replacement; };
    const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const scene = {
      id: "line-height-asset",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      backgroundImage: "url(https://example.test/texture.png)",
      computedStyles: {
        backgroundClip: "text",
        backgroundImage: "url(https://example.test/texture.png)",
        backgroundSize: "cover",
        color: "transparent",
      },
      text: { content: "Image\nText", lineCount: 2, lineHeight: 32, fontSize: 16, fontWeight: 400 },
    };
    const report = importReport();

    expect(context.applySceneLineHeight(node, scene, report, [{
      id: "texture",
      url: "https://example.test/texture.png",
      data: pixelPng,
    }])).toBe(false);
    expect(parent.children).toEqual([node, replacement]);
    expect(svg).toContain("<image");
    expect(svg).toContain("cssTextBackgroundImage-pattern");
    expect(JSON.parse(replacement.getPluginData("open-canvas-text-shaping-geometry")))
      .toMatchObject({ width: 160, height: 64 });
  });

  it("rebuilds a shaping fallback after the captured text box changes instead of scaling glyphs", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(160, 32);
    parent.appendChild(node);
    const oldVector = mockFigmaNode("VECTOR");
    oldVector.name = "__css-text-shaping-shaping-resize";
    oldVector.setPluginData("open-canvas-text-shaping-owner", "shaping-resize");
    oldVector.setPluginData("open-canvas-text-shaping-geometry", JSON.stringify({ x: 0, y: 0, width: 120, height: 24 }));
    oldVector.remove = () => {
      const index = parent.children.indexOf(oldVector);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldVector);
    const replacement = mockFigmaNode("VECTOR");
    replacement.remove = () => {
      const index = parent.children.indexOf(replacement);
      if (index >= 0) parent.children.splice(index, 1);
    };
    let svg = "";
    context.figma.createNodeFromSvg = value => { svg = value; return replacement; };
    const scene = {
      id: "shaping-resize",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      text: {
        content: "Shaped",
        lineCount: 1,
        lineHeight: 32,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
      },
      computedStyles: { fontFeatureSettings: '"tnum" 1' },
    };

    expect(context.createTextShapingVisualFallback(node, scene, importReport())).toBe(true);
    expect(parent.children).toEqual([node, replacement]);
    expect(svg).toContain('width="160"');
    expect(svg).toContain('height="32"');
    expect(JSON.parse(replacement.getPluginData("open-canvas-text-shaping-geometry")))
      .toMatchObject({ width: 160, height: 32 });
  });

  it("rebuilds a stale shaping fallback during geometry synchronization", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(160, 32);
    parent.appendChild(node);
    const oldVector = mockFigmaNode("VECTOR");
    oldVector.name = "__css-text-shaping-sync-resize";
    oldVector.setPluginData("open-canvas-text-shaping-owner", "sync-resize");
    oldVector.setPluginData("open-canvas-text-shaping-geometry", JSON.stringify({ x: 0, y: 0, width: 120, height: 24 }));
    oldVector.remove = () => {
      const index = parent.children.indexOf(oldVector);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldVector);
    const replacement = mockFigmaNode("VECTOR");
    replacement.remove = () => {
      const index = parent.children.indexOf(replacement);
      if (index >= 0) parent.children.splice(index, 1);
    };
    let svg = "";
    context.figma.createNodeFromSvg = value => { svg = value; return replacement; };
    const scene = {
      id: "sync-resize",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      text: { content: "Shaped", lineCount: 1, lineHeight: 32, fontSize: 16, fontFamily: "Inter", fontWeight: 400 },
      computedStyles: { fontFeatureSettings: '"tnum" 1' },
    };
    const report = importReport();

    context.syncTextShapingVisualFallback(node, scene, report);

    expect(parent.children).toEqual([node, replacement]);
    expect(svg).toContain('width="160"');
    expect(svg).toContain('height="32"');
    expect(JSON.parse(replacement.getPluginData("open-canvas-text-shaping-geometry")))
      .toMatchObject({ width: 160, height: 32 });
  });

  it("recreates a shaping fallback when synchronization finds no old sibling", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(160, 32);
    parent.appendChild(node);
    const replacement = mockFigmaNode("VECTOR");
    replacement.remove = () => {
      const index = parent.children.indexOf(replacement);
      if (index >= 0) parent.children.splice(index, 1);
    };
    let svg = "";
    context.figma.createNodeFromSvg = value => { svg = value; return replacement; };
    const scene = {
      id: "shaping-recover-without-sibling",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      text: {
        content: "Shaped again",
        lineCount: 1,
        lineHeight: 32,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
      },
      computedStyles: { fontFeatureSettings: '"tnum" 1' },
    };

    context.syncTextShapingVisualFallback(node, scene, importReport());

    expect(parent.children).toEqual([node, replacement]);
    expect(svg).toContain("font-feature-settings");
    expect(replacement.getPluginData("open-canvas-text-shaping-owner")).toBe("shaping-recover-without-sibling");
  });

  it("restores editable text opacity when a managed shaping fallback has no sibling", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    node.opacity = 0;
    node.setPluginData("open-canvas-text-shaping-fallback", "font-feature-settings");
    node.setPluginData("open-canvas-text-shaping-original-opacity", "0.75");

    context.removeTextShapingVisualFallback(node, { id: "shaping-hidden-source" }, importReport());

    expect(node.opacity).toBe(0.75);
    expect(node.getPluginData("open-canvas-text-shaping-fallback")).toBe("");
    expect(node.getPluginData("open-canvas-text-shaping-original-opacity")).toBe("");
  });

  it("restores editable opacity for managed fallback markers after host sibling cleanup", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    parent.appendChild(node);
    const report = importReport();
    const cases = [
      ["open-canvas-line-height-fallback", "open-canvas-line-height-original-opacity", "line-height"],
      ["open-canvas-writing-mode-fallback", "open-canvas-writing-mode-original-opacity", "vertical-rl"],
      ["open-canvas-text-overflow-fallback", "open-canvas-text-overflow-original-opacity", "svg-ellipsis"],
    ];

    for (const [fallbackKey, opacityKey, fallbackValue] of cases) {
      node.opacity = 0;
      node.setPluginData(fallbackKey, fallbackValue);
      node.setPluginData(opacityKey, "0.6");
      if (fallbackKey.includes("line-height")) {
        context.removeLineHeightVisualFallback(node, { id: `managed-${fallbackValue}`, text: { lineHeight: 24 } }, report);
      } else if (fallbackKey.includes("writing-mode")) {
        context.removeWritingModeVisualFallback(node, { id: `managed-${fallbackValue}` }, report);
      } else {
        context.removeTextOverflowVisualFallback(node, { id: `managed-${fallbackValue}` }, report);
      }
      expect(node.opacity, fallbackValue).toBe(0.6);
      expect(node.getPluginData(fallbackKey)).toBe("");
      expect(node.getPluginData(opacityKey)).toBe("");
    }
  });

  it("rebuilds a same-size shaping fallback when source text styling changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.resize(160, 32);
    parent.appendChild(node);
    const vectors = [];
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      const vector = mockFigmaNode("VECTOR");
      vectors.push(vector);
      return vector;
    };
    const scene = {
      id: "shaping-source-change",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 32 },
      textRect: { x: 0, y: 0, width: 160, height: 32 },
      computedStyles: { fontFeatureSettings: '"tnum" 1' },
      text: {
        content: "Original shaped text",
        lineCount: 1,
        lineHeight: 32,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
        textFillColor: "rgb(20, 40, 60)",
      },
    };

    expect(context.createTextShapingVisualFallback(node, scene, importReport())).toBe(true);
    const firstSignature = vectors[0].getPluginData("open-canvas-text-shaping-source-signature");
    expect(firstSignature).toBeTruthy();
    expect(svg).toContain("font-feature-settings=\"&quot;tnum&quot; 1\"");
    expect(svg).toContain("rgb(20,40,60)");

    scene.text.content = "Updated shaped text";
    scene.text.textFillColor = "rgb(180, 20, 40)";
    scene.computedStyles.fontFeatureSettings = '"liga" 0';
    context.syncTextShapingVisualFallback(node, scene, importReport());

    expect(vectors).toHaveLength(2);
    expect(parent.children).toEqual([node, vectors[1]]);
    expect(vectors[1].getPluginData("open-canvas-text-shaping-source-signature")).not.toBe(firstSignature);
    expect(svg).toContain("font-feature-settings=\"&quot;liga&quot; 0\"");
    expect(svg).toContain("rgb(180,20,40)");
    expect(svg).toContain("Updated shaped text");
  });

  it("does not report text clipping when an editable fill was captured", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "solid-clipped-copy",
      type: "text",
      fill: { color: "#e11d48" },
      computedStyles: { backgroundClip: "text", color: "transparent" },
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("does not report an image text clip when the native image fill was applied", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "image-clipped-copy",
      type: "text",
      backgroundImage: "url(https://example.test/texture.png)",
      computedStyles: { backgroundClip: "text", backgroundImage: "url(https://example.test/texture.png)" },
    }, report, [], { fills: [{ type: "IMAGE", imageHash: "image-1" }] });
    expect(report.styleDegradations).toBe(0);
  });

  it("does not report an image text clip when the SVG glyph fallback was applied", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    const node = mockFigmaNode("TEXT");
    node.setPluginData("open-canvas-text-background-image-fallback", "1");
    context.recordSceneDegradations({
      id: "image-clipped-fallback",
      type: "text",
      backgroundImage: "url(https://example.test/texture.png)",
      computedStyles: { backgroundClip: "text", backgroundImage: "url(https://example.test/texture.png)" },
    }, report, [], node);
    expect(report.styleDegradations).toBe(0);
  });

  it("does not report supported padding/content background clips as degradations", () => {
    const context = loadPluginFunctions();
    for (const backgroundClip of ["padding-box", "content-box"]) {
      const report = importReport();
      context.recordSceneDegradations({
        id: `clip-${backgroundClip}`,
        computedStyles: { backgroundClip },
      }, report);
      expect(report.styleDegradations).toBe(0);
    }
  });

  it("normalizes H2D replay styles for native constraints and clipping", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "media",
      tag: "DIV",
      styles: {
        width: "320px",
        height: "180px",
        display: "block",
        aspectRatio: "16 / 9",
        overflowX: "hidden",
        overflowY: "visible",
        mixBlendMode: "multiply",
        backgroundBlendMode: "screen",
      },
      rect: { x: 0, y: 0, width: 320, height: 180 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      aspectRatio: "16 / 9",
      overflowX: "hidden",
      mixBlendMode: "multiply",
      backgroundBlendMode: "screen",
    });
    const node = mockFigmaNode("FRAME");
    node.clipsContent = false;
    node.blendMode = "NORMAL";
    context.applyAspectRatioConstraint(node, scene);
    context.visuals(node, scene);
    expect(node.constrainProportions).toBe(true);
    expect(node.clipsContent).toBe(true);
    expect(node.blendMode).toBe("MULTIPLY");
  });

  it("creates a rounded SVG shadow fallback when native effects are unavailable", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    delete node.effects;
    node.resize(120, 64);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = value => {
      capturedSvg = value;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    context.visuals(node, {
      id: "shadow-fallback-card",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 64 },
      radius: [12, 12, 12, 12],
      shadowCss: "0 8px 20px rgba(0, 0, 0, .18)",
      computedStyles: {
        boxShadow: "0 8px 20px rgba(0, 0, 0, .18)",
        borderTopLeftRadius: "12px",
        borderTopRightRadius: "12px",
        borderBottomRightRadius: "12px",
        borderBottomLeftRadius: "12px",
        color: "rgb(0, 0, 0)",
      },
    }, [], { report });

    const fallback = parent.children.find(child => child.name === "__css-shadow-shadow-fallback-card");
    expect(fallback).toBeTruthy();
    expect(context.sceneChildren(parent)).not.toContain(fallback);
    expect(capturedSvg).toContain("feGaussianBlur");
    expect(capturedSvg).toContain("<path");
    expect(capturedSvg).toContain("12 12");
    expect(fallback?.getPluginData("open-canvas-shadow-fallback-owner")).toBe("shadow-fallback-card");
    expect(report.styleDegradationNodes.some(entry => String(entry.message).includes("shadow fallback"))).toBe(true);
  });

  it("applies effective element opacity to an SVG shadow fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    delete node.effects;
    node.resize(120, 64);
    const vectors = [];
    context.figma.createNodeFromSvg = () => {
      const vector = mockFigmaNode("VECTOR");
      vectors.push(vector);
      return vector;
    };
    const scene = {
      id: "shadow-fallback-opacity",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 64 },
      opacity: 0.8,
      filter: "opacity(50%)",
      shadowCss: "0 4px 12px rgba(0, 0, 0, .2)",
      computedStyles: {
        opacity: "0.8",
        filter: "opacity(50%)",
        boxShadow: "0 4px 12px rgba(0, 0, 0, .2)",
      },
    };
    const report = importReport();
    context.visuals(node, scene, [], { report });

    expect(vectors).toHaveLength(1);
    expect(vectors[0].opacity).toBeCloseTo(0.4, 8);
    expect(vectors[0].getPluginData("open-canvas-shadow-fallback-opacity")).toBe("0.4");

    // A later geometry/typography convergence pass must update the sibling's
    // alpha without creating a second visual shadow layer.
    scene.opacity = 0.5;
    scene.filter = "none";
    scene.computedStyles.filter = "none";
    context.syncShadowVisualFallback(node, scene, report);
    expect(vectors[0].opacity).toBeCloseTo(0.5, 8);
    expect(parent.children.filter(child => child.name === "__css-shadow-shadow-fallback-opacity")).toHaveLength(1);
  });

  it("rebuilds a shadow fallback after the captured box changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    delete node.effects;
    node.resize(120, 64);
    let createCount = 0;
    const vectors = [];
    context.figma.createNodeFromSvg = () => {
      createCount += 1;
      const vector = mockFigmaNode("VECTOR");
      vectors.push(vector);
      return vector;
    };
    const scene = {
      id: "shadow-resize",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 64 },
      radius: [8, 8, 8, 8],
      shadowCss: "0 4px 12px rgba(0, 0, 0, .2)",
      computedStyles: { boxShadow: "0 4px 12px rgba(0, 0, 0, .2)" },
    };
    const report = importReport();
    context.visuals(node, scene, [], { report });
    expect(createCount).toBe(1);
    node.resize(180, 96);
    scene.rect.width = 180;
    scene.rect.height = 96;
    context.syncShadowVisualFallback(node, scene, report);
    expect(createCount).toBe(2);
    expect(parent.children.filter(child => child.name === "__css-shadow-shadow-resize")).toHaveLength(1);
    expect(JSON.parse(vectors[1].getPluginData("open-canvas-shadow-fallback-geometry"))).toEqual({ width: 180, height: 96 });
  });

  it("rebuilds a currentColor shadow fallback when the resolved color changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    delete node.effects;
    node.resize(120, 64);
    let createCount = 0;
    const vectors = [];
    context.figma.createNodeFromSvg = svg => {
      createCount += 1;
      vectors.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "shadow-current-color-change",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 64 },
      shadowCss: "0 4px 12px currentColor",
      computedStyles: {
        boxShadow: "0 4px 12px currentColor",
        color: "rgb(20, 40, 60)",
      },
    };
    const report = importReport();
    context.visuals(node, scene, [], { report });
    expect(createCount).toBe(1);
    expect(vectors[0]).toContain("rgb(20,40,60)");

    scene.computedStyles.color = "rgb(180, 40, 60)";
    context.syncShadowVisualFallback(node, scene, report);

    expect(createCount).toBe(2);
    expect(vectors[1]).toContain("rgb(180,40,60)");
  });

  it("rebuilds a same-size shadow fallback when its paint or radius changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    delete node.effects;
    node.resize(120, 64);
    let createCount = 0;
    const vectors = [];
    context.figma.createNodeFromSvg = svg => {
      createCount += 1;
      vectors.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "shadow-same-size-source-change",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 64 },
      radius: [8, 8, 8, 8],
      shadowCss: "0 4px 12px rgba(0, 0, 0, .2)",
      computedStyles: {
        boxShadow: "0 4px 12px rgba(0, 0, 0, .2)",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        borderBottomRightRadius: "8px",
        borderBottomLeftRadius: "8px",
      },
    };
    const report = importReport();
    context.visuals(node, scene, [], { report });
    expect(createCount).toBe(1);

    // Keep the box size unchanged. Both the shadow parameters and the rounded
    // shape changed, so reusing the old SVG would preserve stale visual paint.
    scene.shadowCss = "8px 12px 24px rgba(0, 0, 0, .32)";
    scene.computedStyles.boxShadow = scene.shadowCss;
    scene.radius = [20, 20, 20, 20];
    for (const key of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]) {
      scene.computedStyles[key] = "20px";
    }
    context.syncShadowVisualFallback(node, scene, report);

    expect(createCount).toBe(2);
    expect(parent.children.filter(child => child.name === "__css-shadow-shadow-same-size-source-change")).toHaveLength(1);
    expect(vectors[1]).toContain('dx="8"');
    expect(vectors[1]).toContain('dy="12"');
    expect(vectors[1]).toContain('stdDeviation="12"');
  });

  it("removes a stale shadow fallback when a later convergence pass removes the source shadow", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    delete node.effects;
    node.resize(120, 64);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const scene = {
      id: "shadow-fallback-removed",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 64 },
      shadowCss: "0 4px 12px rgba(0, 0, 0, .2)",
      computedStyles: { boxShadow: "0 4px 12px rgba(0, 0, 0, .2)" },
    };
    const report = importReport();
    context.visuals(node, scene, [], { report });
    expect(parent.children.some(child => child.name === "__css-shadow-shadow-fallback-removed")).toBe(true);

    scene.shadowCss = "";
    scene.computedStyles.boxShadow = "none";
    context.syncShadowVisualFallback(node, scene, report);

    expect(parent.children.some(child => child.name === "__css-shadow-shadow-fallback-removed")).toBe(false);

    // The same node may later receive the shadow source through a measured
    // state update. The synchronizer must restore the previously required
    // fallback even though the old sibling was already removed.
    scene.shadowCss = "0 4px 12px rgba(0, 0, 0, .2)";
    scene.computedStyles.boxShadow = "0 4px 12px rgba(0, 0, 0, .2)";
    context.syncShadowVisualFallback(node, scene, report);
    expect(parent.children.some(child => child.name === "__css-shadow-shadow-fallback-removed")).toBe(true);
  });

  it("renders inset shadows inside the captured shape in the SVG fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    delete node.effects;
    node.resize(100, 60);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = value => {
      capturedSvg = value;
      return mockFigmaNode("VECTOR");
    };
    context.visuals(node, {
      id: "inset-shadow",
      type: "frame",
      rect: { x: 0, y: 0, width: 100, height: 60 },
      radius: [10, 10, 10, 10],
      shadowCss: "inset 0 2px 8px rgba(0, 0, 0, .22)",
      computedStyles: { boxShadow: "inset 0 2px 8px rgba(0, 0, 0, .22)" },
    }, [], { report: importReport() });

    expect(capturedSvg).toContain('operator="in"');
    expect(capturedSvg).toContain("feGaussianBlur");
    expect(parent.children.some(child => child.name === "__css-shadow-inset-shadow")).toBe(true);
  });

  it("keeps parsed filter drop-shadows visible when native effects are unavailable", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    delete node.effects;
    node.resize(100, 60);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = value => {
      capturedSvg = value;
      return mockFigmaNode("VECTOR");
    };
    context.visuals(node, {
      id: "filter-shadow",
      type: "frame",
      rect: { x: 0, y: 0, width: 100, height: 60 },
      filter: "drop-shadow(0 3px 10px rgba(0, 0, 0, .2))",
      computedStyles: { filter: "drop-shadow(0 3px 10px rgba(0, 0, 0, .2))" },
    }, [], { report: importReport() });

    expect(capturedSvg).toContain("feGaussianBlur");
    expect(parent.children.some(child => child.name === "__css-shadow-filter-shadow")).toBe(true);
  });

  it("uses the SVG shadow fallback when Figma rejects the native effect write", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    Object.defineProperty(node, "effects", {
      configurable: true,
      get: () => [],
      set: () => { throw new Error("effects rejected"); },
    });
    node.resize(96, 48);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = value => {
      capturedSvg = value;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    context.visuals(node, {
      id: "rejected-shadow",
      type: "frame",
      rect: { x: 0, y: 0, width: 96, height: 48 },
      shadowCss: "0 2px 8px rgba(0, 0, 0, .24)",
      computedStyles: { boxShadow: "0 2px 8px rgba(0, 0, 0, .24)" },
    }, [], { report });

    expect(capturedSvg).toContain("feGaussianBlur");
    expect(parent.children.some(child => child.name === "__css-shadow-rejected-shadow")).toBe(true);
    expect(report.styleDegradationNodes.some(entry => String(entry.message).includes("shadow fallback"))).toBe(true);
  });

  it("does not double-paint partially accepted native shadows beside the SVG fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("FRAME");
    parent.appendChild(node);
    node.resize(96, 48);
    let nativeEffects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 2 }, radius: 8, visible: true }];
    Object.defineProperty(node, "effects", {
      configurable: true,
      get: () => nativeEffects,
      set: value => {
        // Simulate a host that accepts only the first native effect even when
        // the full CSS list contains an additional unsupported layer.
        nativeEffects = Array.isArray(value) ? value.slice(0, 1) : [];
      },
    });
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const report = importReport();
    context.visuals(node, {
      id: "partial-native-shadow",
      type: "frame",
      rect: { x: 0, y: 0, width: 96, height: 48 },
      shadowCss: "0 2px 8px rgba(0, 0, 0, .2), inset 0 1px 3px rgba(0, 0, 0, .1)",
      computedStyles: {
        boxShadow: "0 2px 8px rgba(0, 0, 0, .2), inset 0 1px 3px rgba(0, 0, 0, .1)",
      },
    }, [], { report });

    expect(parent.children.some(child => child.name === "__css-shadow-partial-native-shadow")).toBe(true);
    expect(nativeEffects.filter(effect => ["DROP_SHADOW", "INNER_SHADOW"].includes(effect.type))).toHaveLength(0);
  });

  it("keeps a native text-shadow when only the box-shadow needs a visual fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "Label";
    parent.appendChild(node);
    node.resize(96, 24);
    node.effects = [
      { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 2 }, radius: 8, visible: true },
      { type: "DROP_SHADOW", color: { r: 1, g: 0, b: 0, a: 0.6 }, offset: { x: 0, y: 0 }, radius: 2, visible: true },
    ];
    const removed = context.suppressNativeShadowEffectsForFallback(node, {
      id: "text-box-shadow-fallback",
      type: "text",
      computedStyles: { color: "rgb(0, 0, 0)", boxShadow: "0 2px 8px rgba(0, 0, 0, .2)" },
      text: { textShadow: "0 0 2px rgba(255, 0, 0, .6)" },
    });

    expect(removed).toBe(true);
    expect(node.effects).toHaveLength(1);
    expect(node.effects[0].color.r).toBe(1);
  });

  it("clears a previously managed native effect when the source shadow is removed", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let nativeEffects = [];
    Object.defineProperty(node, "effects", {
      configurable: true,
      get: () => nativeEffects,
      set: value => { nativeEffects = Array.isArray(value) ? value : []; },
    });
    const report = importReport();
    context.visuals(node, {
      id: "managed-shadow",
      type: "frame",
      rect: { x: 0, y: 0, width: 80, height: 40 },
      shadowCss: "0 2px 8px rgba(0, 0, 0, .2)",
      computedStyles: { boxShadow: "0 2px 8px rgba(0, 0, 0, .2)" },
    }, [], { report });
    expect(node.getPluginData("open-canvas-effects-managed")).toBe("1");

    context.visuals(node, {
      id: "managed-shadow",
      type: "frame",
      rect: { x: 0, y: 0, width: 80, height: 40 },
      computedStyles: { boxShadow: "none" },
    }, [], { report });

    expect(nativeEffects).toEqual([]);
    expect(node.getPluginData("open-canvas-effects-managed")).toBe("");
  });

  it("resolves H2D percentage and elliptical corner radii against node bounds", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "rounded",
      tag: "DIV",
      styles: {
        width: "200px",
        height: "100px",
        display: "block",
        borderTopLeftRadius: "25%",
        borderTopRightRadius: "10px 20px",
      },
      rect: { x: 0, y: 0, width: 200, height: 100 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.radius).toEqual([25, 10, 0, 0]);
  });

  it("recovers HUG/FILL sizing from compatibility attributes when layout metadata is trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-sizing",
      tag: "SECTION",
      attributes: {
        "data-open-canvas-layout-mode": "vertical",
        "data-open-canvas-width-mode": "fill",
        "data-open-canvas-height-mode": "hug",
      },
      styles: { display: "block", width: "240px", height: "120px" },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.layout).toMatchObject({ mode: "vertical", widthMode: "fill", heightMode: "hug" });
  });

  it("recovers authored responsive sizing expressions from compatibility attributes", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-responsive-sizing",
      tag: "SECTION",
      attributes: {
        "data-open-canvas-layout-mode": "horizontal",
        "data-open-canvas-width-expression": "50%",
        "data-open-canvas-height-expression": "calc(100vh - 24px)",
      },
      styles: { display: "flex", width: "200px", height: "776px" },
      rect: { x: 0, y: 0, width: 200, height: 776 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout).toMatchObject({
      mode: "horizontal",
      widthMode: "fixed",
      heightMode: "fixed",
      widthExpression: "50%",
      heightExpression: "calc(100vh - 24px)",
    });
  });

  it("recovers explicit positioned sizes from trimmed H2D replay styles", () => {
    const context = loadPluginFunctions();
    const parentRect = { x: 0, y: 0, width: 400, height: 300 };
    const base = {
      nodeType: 1,
      tag: "DIV",
      rect: { x: 12, y: 8, width: 120, height: 48 },
      childNodes: [],
    };
    const ltr = context.sceneFromH2D({
      ...base,
      id: "trimmed-explicit-size-ltr",
      styles: {
        position: "absolute",
        width: "120px",
        height: "48px",
        left: "12px",
        right: "24px",
        top: "8px",
        bottom: "16px",
        direction: "ltr",
      },
    }, parentRect);
    const rtl = context.sceneFromH2D({
      ...base,
      id: "trimmed-explicit-size-rtl",
      styles: {
        position: "absolute",
        width: "120px",
        left: "12px",
        right: "24px",
        direction: "rtl",
      },
    }, parentRect);

    expect(ltr.layout).toMatchObject({ widthExpression: "120px", heightExpression: "48px" });
    expect(rtl.layout).toMatchObject({ widthExpression: "120px" });

    const ltrNode = mockFigmaNode("FRAME");
    const rtlNode = mockFigmaNode("FRAME");
    context.applyPositionConstraints(ltrNode, ltr, importReport());
    context.applyPositionConstraints(rtlNode, rtl, importReport());
    expect(ltrNode.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(rtlNode.constraints).toEqual({ horizontal: "MAX", vertical: "MIN" });

    ltrNode.constraints = { horizontal: "STRETCH", vertical: "STRETCH" };
    context.verifyScenePositionConstraints(ltr, ltrNode, importReport());
    expect(ltrNode.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
  });

  it("does not mistake measured H2D dimensions for authored positioned sizes", () => {
    const context = loadPluginFunctions();
    const parentRect = { x: 0, y: 0, width: 400, height: 300 };
    const stretched = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-auto-stretch",
      tag: "DIV",
      styles: {
        position: "absolute",
        width: "364px",
        height: "276px",
        left: "12px",
        right: "24px",
        top: "8px",
        bottom: "16px",
      },
      rect: { x: 12, y: 8, width: 364, height: 276 },
      childNodes: [],
    }, parentRect);
    const computedOnly = context.sceneFromH2D({
      nodeType: 1,
      id: "computed-only-size",
      tag: "DIV",
      styles: { position: "absolute", left: "12px", right: "24px" },
      computedStyles: { width: "120px" },
      rect: { x: 12, y: 8, width: 120, height: 48 },
      childNodes: [],
    }, parentRect);
    const contentBoxStretch = context.sceneFromH2D({
      nodeType: 1,
      id: "content-box-auto-stretch",
      tag: "DIV",
      styles: {
        position: "absolute",
        boxSizing: "content-box",
        width: "340px",
        left: "12px",
        right: "24px",
        paddingLeft: "10px",
        paddingRight: "10px",
        borderLeftWidth: "2px",
        borderRightWidth: "2px",
      },
      rect: { x: 12, y: 8, width: 364, height: 48 },
      childNodes: [],
    }, parentRect);
    const resetSize = context.sceneFromH2D({
      nodeType: 1,
      id: "reset-positioned-size",
      tag: "DIV",
      styles: { position: "absolute", width: "revert-layer", left: "12px", right: "24px" },
      rect: { x: 12, y: 8, width: 364, height: 48 },
      childNodes: [],
    }, parentRect);

    expect(stretched.layout.widthExpression).toBeUndefined();
    expect(stretched.layout.heightExpression).toBeUndefined();
    expect(computedOnly.layout.widthExpression).toBeUndefined();
    expect(contentBoxStretch.layout.widthExpression).toBeUndefined();
    expect(resetSize.layout.widthExpression).toBeUndefined();

    const node = mockFigmaNode("FRAME");
    context.applyPositionConstraints(node, stretched, importReport());
    expect(node.constraints).toEqual({ horizontal: "STRETCH", vertical: "STRETCH" });
  });

  it("keeps an explicit free-positioning mode when layout metadata is trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "mixed-copy",
      tag: "P",
      attributes: { "data-open-canvas-layout-mode": "none" },
      styles: { display: "block", width: "260px", height: "48px" },
      rect: { x: 20, y: 30, width: 260, height: 48 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.layout.mode).toBe("none");
  });

  it("keeps adjacent mixed inline runs in their captured horizontal positions", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "mixed-inline",
      tag: "P",
      attributes: { "data-open-canvas-layout-mode": "none" },
      styles: { display: "block", width: "260px", height: "24px" },
      rect: { x: 20, y: 30, width: 260, height: 24 },
      childNodes: [{
        nodeType: 3,
        id: "prefix",
        text: "Save ",
        rect: { x: 20, y: 32, width: 44, height: 20 },
        lineCount: 1,
      }, {
        nodeType: 1,
        id: "strong",
        tag: "STRONG",
        styles: { display: "inline", fontWeight: "700" },
        rect: { x: 64, y: 32, width: 72, height: 20 },
        childNodes: [{
          nodeType: 3,
          id: "strong-text",
          text: "changes",
          rect: { x: 64, y: 32, width: 72, height: 20 },
          lineCount: 1,
        }],
      }],
    }, { x: 0, y: 0 });

    expect(scene.layout.mode).toBe("none");
    expect(scene.children.map(child => ({ id: child.id, x: child.rect.x, y: child.rect.y }))).toEqual([
      { id: "prefix", x: 0, y: 2 },
      { id: "strong", x: 44, y: 2 },
    ]);
  });

  it("recovers the complete layout contract from the compatibility marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-layout",
      tag: "DIV",
        attributes: {
          "data-open-canvas-layout": JSON.stringify({
            mode: "horizontal",
            gap: 12,
            rowGap: 8,
            columnGap: 12,
            rowGapExpression: "10%",
            columnGapExpression: "5%",
            padding: [4, 6, 8, 10],
          wrap: true,
          justifyContent: "space-between",
          alignItems: "center",
          widthMode: "fill",
          heightMode: "hug",
          position: "flow",
        }),
      },
      styles: { display: "block", width: "400px", height: "120px" },
      rect: { x: 0, y: 0, width: 400, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.layout).toMatchObject({
      mode: "horizontal",
      gap: 12,
      rowGap: 8,
      columnGap: 12,
      rowGapExpression: "10%",
      columnGapExpression: "5%",
      padding: [4, 6, 8, 10],
      wrap: true,
      justifyContent: "space-between",
      alignItems: "center",
      widthMode: "fill",
      heightMode: "hug",
    });
  });

  it("accepts CSS length strings in the compatibility layout marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "string-layout-marker",
      tag: "DIV",
      attributes: {
        "data-open-canvas-layout": JSON.stringify({
          mode: "horizontal",
          gap: "12px",
          rowGap: "8px",
          columnGap: "12px",
          padding: ["4px", "6px", "8px", "10px"],
        }),
      },
      styles: { display: "block", width: "400px", height: "120px" },
      rect: { x: 0, y: 0, width: 400, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout).toMatchObject({
      mode: "horizontal",
      gap: 12,
      rowGap: 8,
      columnGap: 12,
      padding: [4, 6, 8, 10],
    });
  });

  it("ignores invalid compatibility layout marker fields", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "invalid-layout-marker",
      tag: "DIV",
      attributes: {
        "data-open-canvas-layout": JSON.stringify({
          mode: "diagonal",
          gap: { value: 12 },
          padding: "12px",
          wrap: "yes",
          widthMode: "fluid",
        }),
      },
      styles: { display: "flex", flexDirection: "column", gap: "8px", paddingTop: "4px", width: "200px", height: "100px" },
      rect: { x: 0, y: 0, width: 200, height: 100 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.layout).toMatchObject({
      mode: "vertical",
      gap: 8,
      padding: [4, 0, 0, 0],
      wrap: false,
      widthMode: "fixed",
    });
  });

  it("resolves H2D gap percentages against vertical-writing block and inline axes", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "vertical-writing-gap",
      tag: "DIV",
      styles: {
        display: "grid",
        writingMode: "vertical-rl",
        gap: "10% 5%",
        width: "320px",
        height: "200px",
      },
      rect: { x: 0, y: 0, width: 320, height: 200 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout).toMatchObject({ rowGap: 32, columnGap: 10 });
  });

  it("resolves authored gap expressions when the compact layout marker is absent", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-responsive-gap",
      tag: "DIV",
      styles: {
        display: "flex",
        flexDirection: "column",
        gap: "calc(10% + 4px) 5%",
        rowGap: "calc(10% + 4px)",
        columnGap: "5%",
        width: "320px",
        height: "200px",
      },
      rect: { x: 0, y: 0, width: 320, height: 200 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.layout).toMatchObject({ mode: "vertical", gap: 24, rowGap: 24, columnGap: 16 });
  });

  it("recovers relative right/bottom offsets from trimmed H2D styles", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "relative-right-bottom",
      tag: "DIV",
      styles: { position: "relative", right: "12px", bottom: "8px", width: "80px", height: "40px" },
      rect: { x: 0, y: 0, width: 80, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.positionOffset).toEqual({ left: -12, top: -8 });
  });

  it("resolves trimmed percentage and calc relative offsets against the parent content box", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "relative-content-box",
      tag: "DIV",
      styles: {
        display: "block",
        width: "320px",
        height: "220px",
        paddingLeft: "10px",
        paddingRight: "10px",
        paddingTop: "10px",
        paddingBottom: "10px",
        borderLeftWidth: "2px",
        borderRightWidth: "2px",
        borderTopWidth: "2px",
        borderBottomWidth: "2px",
      },
      rect: { x: 0, y: 0, width: 320, height: 220 },
      childNodes: [{
        nodeType: 1,
        id: "relative-content-box-child",
        tag: "DIV",
        styles: {
          position: "relative",
          right: "10%",
          bottom: "calc(5% + 2px)",
          width: "80px",
          height: "40px",
        },
        rect: { x: 40, y: 60, width: 80, height: 40 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });
    expect(scene.children[0].positionOffset).toEqual({ left: -29.6, top: -11.8 });
  });

  it("preserves negative functional relative offsets", () => {
    const context = loadPluginFunctions();
    expect(context.relativePositionOffsetValue({
      left: "calc(-5% + 2px)",
      top: "-1em",
      right: "auto",
      bottom: "auto",
    }, { width: 200, height: 120, fontSize: 16, rootFontSize: 16 })).toEqual({ left: -8, top: -16 });
  });

  it("resolves viewport-relative offsets against the captured viewport", () => {
    const context = loadPluginFunctions();
    expect(context.relativePositionOffsetValue({
      left: "2vw",
      top: "calc(1vmin + 4px)",
      right: "auto",
      bottom: "auto",
    }, {
      width: 320,
      height: 200,
      viewportWidth: 1440,
      viewportHeight: 900,
      fontSize: 16,
      rootFontSize: 16,
    })).toEqual({ left: 28.8, top: 13 });
  });

  it("resolves viewport-relative H2D gaps against the root viewport", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "viewport-gap-root",
      tag: "DIV",
      styles: {
        display: "flex",
        flexDirection: "column",
        gap: "2vh 1vw",
        width: "320px",
        height: "200px",
      },
      rect: { x: 0, y: 0, width: 320, height: 200 },
      childNodes: [{
        nodeType: 1,
        id: "nested-viewport-offset",
        tag: "DIV",
        styles: { position: "relative", left: "2vw", top: "1dvh", width: "40px", height: "20px" },
        rect: { x: 0, y: 0, width: 40, height: 20 },
        childNodes: [],
      }],
    }, { x: 0, y: 0, width: 1440, height: 900 });
    expect(scene.layout).toMatchObject({ rowGap: 18, columnGap: 14.4 });
    expect(scene.children[0].positionOffset).toEqual({ left: 28.8, top: 9 });
  });

  it("resolves root relative offsets against the captured viewport reference", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "relative-root",
      tag: "MAIN",
      styles: {
        position: "relative",
        right: "10%",
        bottom: "calc(5% + 2px)",
        width: "800px",
        height: "600px",
      },
      rect: { x: 0, y: 0, width: 800, height: 600 },
      childNodes: [],
    }, { x: 0, y: 0, width: 1440, height: 900 });
    expect(scene.positionOffset).toEqual({ left: -144, top: -47 });
  });

  it("keeps relative-position expressions from the compatibility marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "relative-expression-marker",
      tag: "DIV",
      attributes: { "data-open-canvas-position-offset": JSON.stringify({ right: "10%", bottom: "calc(5% + 2px)" }) },
      styles: { position: "relative", left: "-30px", top: "-12px", width: "80px", height: "40px" },
      rect: { x: 0, y: 0, width: 80, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.positionOffsetExpression).toEqual({ right: "10%", bottom: "calc(5% + 2px)" });
  });

  it("restores trimmed H2D sizing markers onto native Auto Layout nodes", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    const page = mockFigmaNode("PAGE");
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "sizing-root",
      tag: "MAIN",
      styles: { display: "flex", flexDirection: "column", width: "300px", height: "300px" },
      rect: { x: 0, y: 0, width: 300, height: 300 },
      childNodes: [{
        nodeType: 1,
        id: "responsive-card",
        tag: "SECTION",
        attributes: {
          "data-open-canvas-layout-mode": "vertical",
          "data-open-canvas-width-mode": "fill",
          "data-open-canvas-height-mode": "hug",
        },
        styles: { display: "block", width: "300px", height: "100px" },
        rect: { x: 0, y: 0, width: 300, height: 100 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    const report = importReport();
    const imported = await context.createNode(scene, page, [], report, undefined, {
      images: new Map(), vectors: new Map(),
    });
    context.restoreStableSizing(scene, imported, report);
    const card = imported.children.find(child => child.name === "responsive-card");

    expect(card.layoutMode).toBe("VERTICAL");
    expect(card.layoutSizingHorizontal).toBe("FILL");
    expect(card.layoutSizingVertical).toBe("HUG");
    expect(card.primaryAxisSizingMode).toBe("AUTO");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("preserves a real source absolute child as a native geometry lock", () => {
    const context = loadPluginFunctions();
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      layout: { mode: "vertical", gap: 8, padding: [0, 0, 0, 0], position: "flow" },
      children: [{
        id: "badge",
        type: "frame",
        rect: { x: 12, y: 20, width: 40, height: 20 },
        margin: [0, 0, 0, 0],
        positioning: "absolute",
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "absolute" },
        children: [],
      }],
    };
    const merged = context.mergeMeasuredGeometry(scene, {
      nodeType: 1,
      id: "root",
      childNodes: [{
        nodeType: 1,
        id: "badge",
        styles: { position: "absolute" },
        layout: { mode: "none", position: "absolute" },
        childNodes: [],
      }],
    });
    expect(merged.children[0].layout.geometryLock).toBe(true);
  });
});

  it("keeps multiple CSS image layers above the base paint", () => {
    const context = loadPluginFunctions();
    const node = { fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] };
    const assets = [
      { id: "asset-a", url: "https://example.test/a.png", data: "data:image/png;base64,AAAA" },
      { id: "asset-b", url: "https://example.test/b.png", data: "data:image/png;base64,BBBB" },
    ];

    context.backgroundImage(node, {
      backgroundImage: "url(https://example.test/a.png), url(https://example.test/b.png)",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "center center",
    }, assets, { images: new Map() });

    expect(node.fills.map((paint) => paint.imageHash || paint.type)).toEqual([
      "image-1",
      "image-2",
      "SOLID",
    ]);
  });

  it("applies CSS order before reversing shared flex children", () => {
    const context = loadPluginFunctions();
    const children = context.orderedSceneChildren({
      layout: { reverse: true },
      children: [
        { id: "dom-first", layout: { order: 2 } },
        { id: "dom-second", layout: { order: 1 } },
        { id: "dom-third", layout: { order: 1 } },
      ],
    });
    expect(children.map((child) => child.id)).toEqual(["dom-first", "dom-third", "dom-second"]);
  });

  it("rehydrates CSS order from an H2D style payload", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "ordered-stack",
      tag: "DIV",
      styles: { display: "flex", flexDirection: "column", width: "240px", height: "120px" },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [
        {
          nodeType: 1,
          id: "dom-first",
          tag: "DIV",
          styles: { display: "block", width: "100px", height: "24px", order: "2" },
          rect: { x: 0, y: 48, width: 100, height: 24 },
          childNodes: [],
        },
        {
          nodeType: 1,
          id: "dom-second",
          tag: "DIV",
          styles: { display: "block", width: "100px", height: "24px", order: "1" },
          rect: { x: 0, y: 0, width: 100, height: 24 },
          childNodes: [],
        },
      ],
    }, { x: 0, y: 0 });

    // H2D child creation is already sorted by the captured visual order; the
    // scene metadata must retain the same order values for later geometry and
    // verification passes.
    expect(scene.children.map(child => child.layout.order)).toEqual([1, 2]);
    expect(context.orderedSceneChildren(scene).map(child => child.id)).toEqual(["dom-second", "dom-first"]);
  });

  it("applies per-layer background size, repeat, and position", () => {
    const context = loadPluginFunctions();
    const node = { fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] };
    const assets = [
      { id: "asset-a", url: "https://example.test/a.png", data: "data:image/png;base64,AAAA" },
      { id: "asset-b", url: "https://example.test/b.png", data: "data:image/png;base64,BBBB" },
    ];

    context.backgroundImage(node, {
      backgroundImage: "url(https://example.test/a.png), url(https://example.test/b.png)",
      backgroundSize: "cover, contain",
      backgroundRepeat: "no-repeat, repeat",
      backgroundPosition: "25% 75%, right top",
    }, assets, { images: new Map() });

    expect(node.fills[0]).toMatchObject({ type: "IMAGE", scaleMode: "CROP" });
    expect(node.fills[0].imageTransform).toEqual([[1, 0, 0.25], [0, 1, -0.25]]);
    expect(node.fills[1]).toMatchObject({ type: "IMAGE", scaleMode: "TILE" });
    expect(node.fills[1].imageTransform).toEqual([[1, 0, -0.5], [0, 1, 0.5]]);
  });

  it("resolves reversed and single-keyword image positions by axis", () => {
    const context = loadPluginFunctions();
    const node = { fills: [] };
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 4, 0, 2, 0]);
    const assets = [{ id: "asset-a", url: "https://example.test/a.png", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }];
    context.backgroundImage(node, {
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/a.png)",
      backgroundPosition: "bottom right",
    }, assets, { images: new Map() });
    expect(node.fills[0].imageTransform).toEqual([[1, 0, -0.5], [0, 1, -0.5]]);

    const single = { fills: [] };
    context.backgroundImage(single, {
      backgroundImage: "url(https://example.test/a.png)",
      backgroundPosition: "bottom",
    }, assets, { images: new Map() });
    expect(single.fills[0].imageTransform).toEqual([[1, 0, 0], [0, 1, -0.5]]);
  });

  it("resolves CSS edge offsets for background and object positions", () => {
    const context = loadPluginFunctions();
    expect(context.parseImagePosition("right 10px bottom 5px", { width: 200, height: 100 })).toEqual({ x: 0.95, y: 0.95 });
    expect(context.parseImagePosition("left 12px top 4px", { width: 200, height: 100 })).toEqual({ x: 0.06, y: 0.04 });
    expect(context.parseImagePosition("right 10px", { width: 200, height: 100 })).toEqual({ x: 0.95, y: 0.5 });
    expect(context.parseImagePosition("left -10px top calc(100% + 5px)", { width: 200, height: 100 })).toEqual({ x: -0.05, y: 1.05 });
    expect(context.parseImagePosition("right calc(10px + 5px) bottom 4px", { width: 200, height: 100 })).toEqual({ x: 0.925, y: 0.96 });
    const paint = {};
    context.applyImagePosition(paint, "left -10px top calc(100% + 5px)", { width: 200, height: 100 });
    expect(paint.imageTransform).toEqual([[1, 0, 0.55], [0, 1, -0.55]]);

    const node = { fills: [] };
    const assets = [{ id: "asset-a", url: "https://example.test/a.png", data: "data:image/png;base64,AAAA" }];
    context.backgroundImage(node, {
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/a.png)",
      backgroundPosition: "right 10px bottom 5px",
    }, assets, { images: new Map() });
    expect(node.fills[0].imageTransform).toEqual([[1, 0, -0.45], [0, 1, -0.45]]);
  });


  it("preserves explicit custom background image dimensions with an SVG layer", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = { fills: [], width: 200, height: 100, children: [], appendChild(child) { this.children.push(child); } };
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 4, 0, 2, 0]);
    const assets = [{ id: "asset-a", url: "https://example.test/a.png", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }];
    context.backgroundImage(node, {
      id: "custom-background",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/a.png)",
      backgroundSize: "80px 40px",
      backgroundPosition: "right 10px bottom 5px",
      backgroundRepeat: "no-repeat",
    }, assets, { images: new Map() });
    expect(capturedSvg).toContain('width="80" height="40"');
    expect(capturedSvg).toContain('x="110" y="55"');
    expect(node.children).toHaveLength(1);
    expect(node.fills).toEqual([]);
  });

  it("splits clipped background color and image layers for supported blend modes", () => {
    const context = loadPluginFunctions();
    const overlays = [];
    context.figma.createNodeFromSvg = svg => {
      const overlay = mockFigmaNode("VECTOR");
      overlays.push({ overlay, svg });
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const asset = {
      id: "clipped-blend-image",
      url: "https://example.test/blend.gif",
      data: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
    };
    context.backgroundImage(node, {
      id: "clipped-blend-background",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/blend.gif)",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      backgroundClip: "padding-box",
      fill: { color: "#ffffff" },
      computedStyles: { backgroundClip: "padding-box", backgroundBlendMode: "multiply" },
    }, [asset], { images: new Map(), vectors: new Map() });

    expect(overlays).toHaveLength(2);
    expect(overlays[0].overlay.name).toBe("__css-background-color-clipped-blend-background");
    expect(overlays[1].overlay.name).toBe("__css-background-image-clip-clipped-blend-background");
    expect(overlays[1].overlay.blendMode).toBe("MULTIPLY");
    expect(overlays[0].svg).toContain("#ffffff");
    expect(overlays[1].svg).toContain("<image");
    expect(node.children).toEqual([overlays[0].overlay, overlays[1].overlay]);
    expect(node.fills).toEqual([]);
  });

  it("rolls back a clipped base overlay when the image SVG cannot be created", () => {
    const context = loadPluginFunctions();
    let calls = 0;
    context.figma.createNodeFromSvg = () => {
      calls += 1;
      return calls === 1 ? mockFigmaNode("VECTOR") : null;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const scene = {
      id: "clipped-blend-rollback",
      type: "frame",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/blend.gif)",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
      fill: { color: "#ffffff" },
      computedStyles: { backgroundClip: "padding-box", backgroundBlendMode: "multiply" },
    };
    const asset = { id: "rollback-image", url: "https://example.test/blend.gif", data: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" };
    expect(context.createClippedBackgroundImageOverlay(node, scene, asset)).toBe(false);
    expect(node.children).toEqual([]);
  });

  it("applies a supported blend mode to a custom repeated image overlay", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    context.figma.createNodeFromSvg = () => overlay;
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const asset = {
      id: "custom-blend-image",
      url: "https://example.test/custom-blend.gif",
      data: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
    };
    context.backgroundImage(node, {
      id: "custom-blend-background",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/custom-blend.gif)",
      backgroundSize: "80px 40px",
      backgroundRepeat: "no-repeat",
      backgroundPosition: "left top",
      computedStyles: { backgroundBlendMode: "screen" },
    }, [asset], { images: new Map(), vectors: new Map() });

    expect(node.children).toHaveLength(1);
    expect(node.children[0].blendMode).toBe("SCREEN");
  });

  it("appends blended measured image layers from CSS back to front", () => {
    const context = loadPluginFunctions();
    const overlays = [];
    context.figma.createNodeFromSvg = () => {
      const overlay = mockFigmaNode("VECTOR");
      overlays.push(overlay);
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(190, 100);
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 40, 0, 20, 0]);
    const assets = [
      { id: "blend-space", url: "https://example.test/space.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
      { id: "blend-round", url: "https://example.test/round.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
    ];
    context.backgroundImage(node, {
      id: "blended-measured-stack",
      rect: { width: 190, height: 100 },
      backgroundImage: "url(https://example.test/space.gif), url(https://example.test/round.gif)",
      backgroundSize: "40px 20px, 30px 15px",
      backgroundPosition: "left top, right bottom",
      backgroundRepeat: "space, round",
      computedStyles: { backgroundBlendMode: "screen, multiply" },
    }, assets, { images: new Map(), vectors: new Map() });

    expect(node.children).toHaveLength(2);
    // The second CSS image is the back layer and must be appended first.
    expect(node.children.map(child => child.blendMode)).toEqual(["MULTIPLY", "SCREEN"]);
    expect(node.children.map(child => child.name)).toEqual([
      "__css-background-image-blended-measured-stack-1",
      "__css-background-image-blended-measured-stack",
    ]);
  });

  it("clips ordinary multi-image backgrounds to padding-box without native paint leakage", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(240, 120);
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 40, 0, 20, 0]);
    const assets = [
      { id: "clip-a", url: "https://example.test/a.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
      { id: "clip-b", url: "https://example.test/b.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
    ];
    context.backgroundImage(node, {
      id: "multi-clipped-background",
      rect: { width: 240, height: 120 },
      backgroundImage: "url(https://example.test/a.gif), url(https://example.test/b.gif)",
      backgroundSize: "cover, 80px 40px",
      backgroundPosition: "center center, right bottom",
      backgroundRepeat: "no-repeat, no-repeat",
      fill: { color: "#f5f5f5" },
      layout: { padding: [8, 10, 8, 10] },
      borders: [
        { width: 2 }, { width: 2 }, { width: 2 }, { width: 2 },
      ],
      computedStyles: { backgroundClip: "padding-box", backgroundBlendMode: "normal, normal" },
    }, assets, { images: new Map(), vectors: new Map() });

    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-background-image-clipped-layers-multi-clipped-background");
    expect(capturedSvg).toContain("<image");
    expect(capturedSvg).toContain("clipPath");
    expect(node.fills).toEqual([]);
  });

  it("repeats shorter CSS layer lists from the beginning", () => {
    const context = loadPluginFunctions();
    expect(context.cssLayerValue("content-box, border-box", 0, "padding-box")).toBe("content-box");
    expect(context.cssLayerValue("content-box, border-box", 1, "padding-box")).toBe("border-box");
    expect(context.cssLayerValue("content-box, border-box", 2, "padding-box")).toBe("content-box");
    expect(context.cssLayerValue("content-box, border-box", 3, "padding-box")).toBe("border-box");
  });

  it("uses independent origin and clip boxes for each image background layer", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(240, 120);
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 8, 0, 4, 0]);
    const assets = [
      { id: "layer-box-a", url: "https://example.test/a.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
      { id: "layer-box-b", url: "https://example.test/b.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
    ];
    context.backgroundImage(node, {
      id: "per-layer-background-boxes",
      rect: { width: 240, height: 120 },
      backgroundImage: "url(https://example.test/a.gif), url(https://example.test/b.gif)",
      backgroundSize: "20px 10px, 30px 15px",
      backgroundPosition: "left top, left top",
      backgroundRepeat: "no-repeat",
      fill: { color: "#ffffff" },
      layout: { padding: [8, 10, 8, 10] },
      borders: [
        { width: 2 }, { width: 2 }, { width: 2 }, { width: 2 },
      ],
      computedStyles: {
        backgroundOrigin: "content-box, border-box",
        backgroundClip: "content-box, padding-box",
        backgroundBlendMode: "normal",
      },
    }, assets, { images: new Map(), vectors: new Map() });

    expect(node.children).toHaveLength(1);
    expect(overlay.name).toBe("__css-background-image-clipped-layers-per-layer-background-boxes");
    expect(capturedSvg).toContain('<clipPath id="clip-layer-0"><path d="M 12 10');
    expect(capturedSvg).toContain('<clipPath id="clip-layer-1"><path d="M 2 2');
    expect(capturedSvg).toContain('<clipPath id="clip-color"><path d="M 2 2');
    expect(capturedSvg).toContain('x="12" y="10" width="20" height="10"');
    expect(capturedSvg).toContain('x="0" y="0" width="30" height="15"');
    expect(node.fills).toEqual([]);
  });

  it("keeps per-layer blend modes on clipped multi-image backgrounds", () => {
    const context = loadPluginFunctions();
    const overlays = [];
    context.figma.createNodeFromSvg = () => {
      const overlay = mockFigmaNode("VECTOR");
      overlays.push(overlay);
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 8, 0, 4, 0]);
    const assets = [
      { id: "clip-blend-a", url: "https://example.test/a.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
      { id: "clip-blend-b", url: "https://example.test/b.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
    ];
    context.backgroundImage(node, {
      id: "multi-clipped-blend",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/a.gif), url(https://example.test/b.gif)",
      backgroundSize: "80px 40px, 60px 30px",
      backgroundPosition: "left top, right bottom",
      backgroundRepeat: "no-repeat, no-repeat",
      fill: { color: "#ffffff" },
      computedStyles: { backgroundClip: "content-box", backgroundBlendMode: "screen, multiply" },
    }, assets, { images: new Map(), vectors: new Map() });

    expect(overlays).toHaveLength(3);
    expect(overlays[0].name).toBe("__css-background-color-multi-clipped-blend");
    expect(overlays.slice(1).map(overlay => overlay.blendMode)).toEqual(["MULTIPLY", "SCREEN"]);
    expect(node.fills).toEqual([]);
  });

  it("clips mixed gradient and image backgrounds instead of leaking native gradient paint", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(220, 110);
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 8, 0, 4, 0]);
    context.backgroundImage(node, {
      id: "mixed-clipped-background",
      rect: { width: 220, height: 110 },
      backgroundImage: "linear-gradient(90deg, #ff0000, #0000ff), url(https://example.test/mixed.gif)",
      backgroundSize: "auto, 90px 45px",
      backgroundPosition: "0% 0%, right bottom",
      backgroundRepeat: "no-repeat, no-repeat",
      fill: { color: "#ffffff" },
      computedStyles: { backgroundClip: "content-box", backgroundBlendMode: "normal, normal" },
    }, [{ id: "mixed-image", url: "https://example.test/mixed.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }], { images: new Map(), vectors: new Map() });

    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-background-mixed-clipped-mixed-clipped-background");
    expect(capturedSvg).toContain("linearGradient");
    expect(capturedSvg).toContain("<image");
    expect(capturedSvg).toContain("clipPath");
    expect(node.fills).toEqual([]);
  });

  it("keeps per-layer origin and clip boxes in mixed gradient/image fallbacks", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(220, 110);
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 8, 0, 4, 0]);
    context.backgroundImage(node, {
      id: "mixed-per-layer-boxes",
      rect: { width: 220, height: 110 },
      backgroundImage: "linear-gradient(90deg, #ff0000, #0000ff), url(https://example.test/mixed-boxes.gif)",
      backgroundSize: "auto, 60px 30px",
      backgroundPosition: "left top, left top",
      backgroundRepeat: "no-repeat",
      fill: { color: "#ffffff" },
      layout: { padding: [6, 8, 6, 8] },
      borders: [
        { width: 2 }, { width: 2 }, { width: 2 }, { width: 2 },
      ],
      computedStyles: {
        backgroundOrigin: "content-box, border-box",
        backgroundClip: "content-box, padding-box",
        backgroundBlendMode: "normal, normal",
      },
    }, [{ id: "mixed-boxes-image", url: "https://example.test/mixed-boxes.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }], { images: new Map(), vectors: new Map() });

    expect(node.children).toHaveLength(1);
    expect(overlay.name).toBe("__css-background-mixed-clipped-mixed-per-layer-boxes");
    expect(capturedSvg).toContain('<clipPath id="mixed-clip-layer-0"><path d="M 10 8');
    expect(capturedSvg).toContain('<clipPath id="mixed-clip-layer-1"><path d="M 2 2');
    expect(capturedSvg).toContain('x="10" y="8"');
    expect(capturedSvg).toContain('x="0" y="0" width="60" height="30"');
  });

  it("keeps blend modes on clipped mixed gradient and image layers", () => {
    const context = loadPluginFunctions();
    const overlays = [];
    context.figma.createNodeFromSvg = svg => {
      const overlay = mockFigmaNode("VECTOR");
      overlays.push({ overlay, svg });
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(220, 110);
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 8, 0, 4, 0]);
    context.backgroundImage(node, {
      id: "mixed-clipped-blend-background",
      rect: { width: 220, height: 110 },
      backgroundImage: "linear-gradient(90deg, #ff0000, #0000ff), url(https://example.test/mixed-blend.gif)",
      backgroundSize: "auto, 90px 45px",
      backgroundPosition: "0% 0%, right bottom",
      backgroundRepeat: "no-repeat, no-repeat",
      fill: { color: "#ffffff" },
      computedStyles: { backgroundClip: "padding-box", backgroundBlendMode: "screen, multiply" },
    }, [{ id: "mixed-blend-image", src: "https://example.test/mixed-blend.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }], { images: new Map(), vectors: new Map() });

    expect(overlays).toHaveLength(3);
    expect(overlays[0].overlay.name).toBe("__css-background-color-mixed-clipped-blend-background");
    expect(overlays.slice(1).map(entry => entry.overlay.blendMode)).toEqual(["MULTIPLY", "SCREEN"]);
    expect(overlays.slice(1).every(entry => entry.svg.includes("clipPath"))).toBe(true);
    expect(overlays.some(entry => entry.svg.includes("linearGradient"))).toBe(true);
    expect(overlays.some(entry => entry.svg.includes("<image"))).toBe(true);
    expect(node.fills).toEqual([]);
  });

  it("uses CSS top-left positioning for an explicit background size without position", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = { fills: [], width: 200, height: 100, children: [], appendChild(child) { this.children.push(child); } };
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 4, 0, 2, 0]);
    const assets = [{ id: "asset-a", url: "https://example.test/a.png", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }];
    context.backgroundImage(node, {
      id: "default-position-background",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/a.png)",
      backgroundSize: "80px 40px",
      backgroundRepeat: "no-repeat",
    }, assets, { images: new Map() });
    expect(capturedSvg).toContain('x="0" y="0" width="80" height="40"');
  });

  it("keeps object-fit none and scale-down at intrinsic image dimensions", () => {
    const context = loadPluginFunctions();
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const asset = { id: "intrinsic", kind: "image", data: png };
    const none = context.objectFitImageSvg(asset, {
      rect: { width: 100, height: 50 },
      objectFit: "none",
      objectPosition: "center center",
      radius: [12, 12, 12, 12],
    });
    expect(none).toContain('x="49.5" y="24.5" width="1" height="1"');
    expect(none).toContain('<clipPath id="clip"><path d="M 12 0');

    const scaleDown = context.objectFitImageSvg(asset, {
      rect: { width: 100, height: 50 },
      objectFit: "scale-down",
      objectPosition: "left top",
    });
    expect(scaleDown).toContain('x="0" y="0" width="1" height="1"');
  });

  it("applies object-view-box source cropping before object-fit geometry", () => {
    const context = loadPluginFunctions();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="red"/></svg>';
    const asset = { id: "view-box-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    const svg = context.objectFitImageSvg(asset, {
      rect: { width: 100, height: 100 },
      objectFit: "cover",
      objectPosition: "center center",
      objectViewBox: "inset(10% 20% 10% 20%)",
    });

    // The source crop is 120x80 (x=40,y=10). `cover` then scales that crop
    // to 150x100 while the full source image is translated by the crop inset.
    expect(svg).toContain('x="-75" y="-12.5" width="250" height="125"');
  });

  it("keeps object-view-box parsing failures explicit", () => {
    const context = loadPluginFunctions();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100"/></svg>';
    const asset = { id: "invalid-view-box-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    expect(context.objectFitImageSvg(asset, {
      rect: { width: 100, height: 100 },
      objectFit: "fill",
      objectViewBox: "inset(10% round 8px)",
    })).toBeNull();

    const report = importReport();
    context.recordSceneDegradations({
      id: "invalid-view-box-node",
      type: "image",
      rect: { width: 100, height: 100 },
      assetId: "invalid-view-box-asset",
      objectViewBox: "inset(10% round 8px)",
      computedStyles: {},
    }, report, [asset], mockFigmaNode("RECTANGLE"));
    expect(report.styleDegradationNodes.at(-1).message).toContain("object-view-box");
  });

  it("bakes an image clip-path into the SVG fallback", () => {
    const context = loadPluginFunctions();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>';
    const asset = { id: "clipped-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    const svg = context.clippedImageSvg(asset, {
      rect: { width: 120, height: 80 },
      objectFit: "cover",
      objectPosition: "center",
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 75% 100%, 0 100%)" },
    });

    expect(svg).toContain('<clipPath id="clip"><path d="M 0 0 L 120 0 L 90 80 L 0 80 Z"');
    expect(svg).toContain('<image href="data:image/svg+xml;base64,');
    expect(svg).toContain('clip-path="url(#clip)"');
  });

  it("uses the clip-path SVG fallback during image import", async () => {
    const context = loadPluginFunctions();
    context.figma.createImage = () => ({ hash: "clipped-image" });
    const generated = [];
    context.figma.createNodeFromSvg = value => {
      generated.push(value);
      return mockFigmaNode("VECTOR");
    };
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>';
    const asset = { id: "clipped-poster", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    const report = importReport();
    const parent = mockFigmaNode("PAGE");
    const imported = await context.createNode({
      id: "clipped-poster-node",
      type: "image",
      rect: { x: 0, y: 0, width: 160, height: 100 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      assetId: "clipped-poster",
      objectFit: "cover",
      objectPosition: "center",
      computedStyles: { clipPath: "circle(45% at 50% 50%)" },
      children: [],
    }, parent, [asset], report, undefined, { images: new Map(), vectors: new Map() });

    expect(imported.type).toBe("VECTOR");
    expect(imported.getPluginData("open-canvas-image-fallback-kind")).toBe("clip-path");
    expect(imported.getPluginData("open-canvas-image-fallback-asset-id")).toBe("clipped-poster");
    expect(generated).toHaveLength(1);
    expect(generated[0]).toContain('<clipPath id="clip"><circle cx="80" cy="50" r="45"');
    expect(report.styleDegradations).toBe(0);
  });

  it("bakes a CSS mask-image and image filter into the image fallback", () => {
    const context = loadPluginFunctions();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>';
    const asset = { id: "masked-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    const svg = context.maskedImageSvg(asset, {
      rect: { width: 120, height: 80 },
      objectFit: "cover",
      objectPosition: "center",
      filter: "grayscale(100%)",
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #fff)",
        maskSize: "100% 100%",
        maskPosition: "0% 0%",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "luminance",
      },
    }, [asset]);

    expect(svg).toContain('<mask id="cssImageMask"');
    expect(svg).toContain('mask-type="luminance"');
    expect(svg).toContain("linearGradient");
    expect(svg).toContain('mask="url(#cssImageMask)"');
    expect(svg).toContain('filter="url(#cssImageFilter)"');
  });

  it("uses alpha semantics for match-source image masks", () => {
    const context = loadPluginFunctions();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>';
    const asset = { id: "match-source-mask", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    const svg = context.maskedImageSvg(asset, {
      rect: { width: 120, height: 80 },
      objectFit: "cover",
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #000)",
        maskMode: "match-source",
        maskRepeat: "no-repeat",
      },
    }, [asset]);

    expect(svg).toContain('mask-type="alpha"');
  });

  it("uses the mask-image SVG fallback during image import", async () => {
    const context = loadPluginFunctions();
    context.figma.createImage = () => ({ hash: "masked-image" });
    const generated = [];
    context.figma.createNodeFromSvg = value => {
      generated.push(value);
      return mockFigmaNode("VECTOR");
    };
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80" fill="red"/></svg>';
    const asset = { id: "masked-poster", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    const report = importReport();
    const parent = mockFigmaNode("PAGE");
    const imported = await context.createNode({
      id: "masked-poster-node",
      type: "image",
      rect: { x: 0, y: 0, width: 160, height: 100 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      assetId: "masked-poster",
      objectFit: "cover",
      objectPosition: "center",
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #fff)",
        maskSize: "100% 100%",
        maskPosition: "0% 0%",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "luminance",
      },
      children: [],
    }, parent, [asset], report, undefined, { images: new Map(), vectors: new Map() });

    expect(imported.type).toBe("VECTOR");
    expect(imported.getPluginData("open-canvas-image-fallback-kind")).toBe("mask-image");
    expect(generated).toHaveLength(1);
    expect(generated[0]).toContain('<mask id="cssImageMask"');
    expect(report.styleDegradations).toBe(0);
  });

  it("keeps negative overflow for centered and edge-positioned oversized images", () => {
    const context = loadPluginFunctions();
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"100\"><rect width=\"200\" height=\"100\"/></svg>";
    const asset = { id: "oversized", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(svg)}` };
    const centered = context.objectFitImageSvg(asset, {
      rect: { width: 100, height: 50 }, objectFit: "none", objectPosition: "center center",
    });
    expect(centered).toContain('x="-50" y="-25" width="200" height="100"');
    const edge = context.objectFitImageSvg(asset, {
      rect: { width: 100, height: 50 }, objectFit: "none", objectPosition: "right bottom",
    });
    expect(edge).toContain('x="-100" y="-50" width="200" height="100"');
  });

  it("rebuilds an object-fit SVG fallback when final geometry changes", () => {
    const context = loadPluginFunctions();
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"100\"><rect width=\"200\" height=\"100\"/></svg>";
    const asset = { id: "object-fit-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(svg)}` };
    const parent = mockFigmaNode("FRAME");
    const old = mockFigmaNode("VECTOR");
    old.name = "Poster";
    old.description = "Product poster";
    old.minWidth = 120;
    old.maxWidth = 480;
    old.minHeight = 80;
    old.maxHeight = 320;
    old.resize(220, 120);
    old.relativeTransform = [[0.8, -0.2, 18], [0.2, 0.8, 24]];
    old.constrainProportions = true;
    old.setPluginData("open-canvas-id", "poster");
    old.setPluginData("open-canvas-image-fallback-kind", "object-fit");
    old.setPluginData("open-canvas-image-fallback-asset-id", "object-fit-asset");
    old.setPluginData("open-canvas-image-fallback-geometry", JSON.stringify({ width: 160, height: 100 }));
    old.setPluginData("open-canvas-aspect-ratio", "16 / 9");
    old.setPluginData("open-canvas-semantic", JSON.stringify({ role: "img", label: "Product poster" }));
    old.setPluginData("open-canvas-responsive-sizing", JSON.stringify({ width: "50%" }));
    parent.appendChild(old);
    const generated = [];
    context.figma.createNodeFromSvg = value => {
      generated.push(value);
      const replacement = mockFigmaNode("VECTOR");
      replacement.description = "";
      replacement.minWidth = 0;
      replacement.maxWidth = Infinity;
      replacement.minHeight = 0;
      replacement.maxHeight = Infinity;
      replacement.relativeTransform = [[1, 0, 0], [0, 1, 0]];
      return replacement;
    };
    expect(context.objectFitImageSvg(asset, {
      rect: { width: 220, height: 120 }, objectFit: "none", objectPosition: "center center",
    })).toContain('width="220" height="120"');

    const replacement = context.syncImageFallback(old, {
      id: "poster",
      type: "image",
      assetId: "object-fit-asset",
      objectFit: "none",
      objectPosition: "center center",
      rect: { width: 220, height: 120 },
      computedStyles: {},
    }, [asset]);

    expect(replacement).not.toBe(old);
    expect(parent.children).toEqual([replacement]);
    expect(generated[0]).toContain('width="220" height="120" viewBox="0 0 220 120"');
    expect(generated[0]).toContain('width="200" height="100"');
    expect(replacement.getPluginData("open-canvas-image-fallback-geometry")).toBe(JSON.stringify({ width: 220, height: 120 }));
    expect(replacement.constrainProportions).toBe(true);
    expect(replacement.getPluginData("open-canvas-aspect-ratio")).toBe("16 / 9");
    expect(replacement.relativeTransform).toEqual([[0.8, -0.2, 18], [0.2, 0.8, 24]]);
    expect(replacement.description).toBe("Product poster");
    expect(replacement).toMatchObject({ minWidth: 120, maxWidth: 480, minHeight: 80, maxHeight: 320 });
    expect(replacement.getPluginData("open-canvas-semantic")).toContain('"role":"img"');
    expect(replacement.getPluginData("open-canvas-responsive-sizing")).toBe(JSON.stringify({ width: "50%" }));
  });

  it("rebuilds an object-view-box fallback when the crop changes at the same size", () => {
    const context = loadPluginFunctions();
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"100\"><rect width=\"200\" height=\"100\"/></svg>";
    const asset = { id: "same-size-view-box-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(svg)}` };
    const parent = mockFigmaNode("FRAME");
    const old = mockFigmaNode("VECTOR");
    old.resize(120, 80);
    old.setPluginData("open-canvas-image-fallback-kind", "object-view-box");
    old.setPluginData("open-canvas-image-fallback-asset-id", "same-size-view-box-asset");
    old.setPluginData("open-canvas-image-fallback-geometry", JSON.stringify({ width: 120, height: 80 }));
    const oldScene = {
      id: "same-size-view-box",
      type: "image",
      assetId: "same-size-view-box-asset",
      rect: { width: 120, height: 80 },
      objectFit: "fill",
      objectPosition: "center center",
      objectViewBox: "inset(0)",
      computedStyles: {},
    };
    old.setPluginData("open-canvas-image-fallback-source", context.imageFallbackSourceSignature(oldScene, "object-view-box"));
    parent.appendChild(old);
    const generated = [];
    context.figma.createNodeFromSvg = value => {
      generated.push(value);
      return mockFigmaNode("VECTOR");
    };

    const nextScene = {
      ...oldScene,
      objectViewBox: "inset(10% 20% 10% 20%)",
    };
    const replacement = context.syncImageFallback(old, nextScene, [asset]);

    expect(replacement).not.toBe(old);
    expect(parent.children).toEqual([replacement]);
    expect(generated).toHaveLength(1);
    expect(generated[0]).toContain('width="120" height="80" viewBox="0 0 120 80"');
    expect(generated[0]).not.toContain('x="0" y="0" width="200" height="100"');
    expect(replacement.getPluginData("open-canvas-image-fallback-source")).toBe(
      context.imageFallbackSourceSignature(nextScene, "object-view-box"),
    );
    expect(context.syncImageFallback(replacement, nextScene, [asset])).toBe(replacement);
    expect(generated).toHaveLength(1);
  });

  it("restores an editable native image when an object-fit fallback is no longer needed", () => {
    const context = loadPluginFunctions();
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"100\"><rect width=\"200\" height=\"100\"/></svg>";
    const asset = { id: "restore-image-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(svg)}` };
    const parent = mockFigmaNode("FRAME");
    const old = mockFigmaNode("VECTOR");
    old.name = "Product poster";
    old.description = "Poster description";
    old.resize(180, 100);
    old.setPluginData("open-canvas-id", "restore-poster");
    old.setPluginData("open-canvas-image-fallback-kind", "object-fit");
    old.setPluginData("open-canvas-image-fallback-asset-id", "restore-image-asset");
    old.setPluginData("open-canvas-image-fallback-geometry", JSON.stringify({ width: 180, height: 100 }));
    old.setPluginData("open-canvas-image-fallback-source", "stale");
    parent.appendChild(old);
    context.figma.createRectangle = () => mockFigmaNode("RECTANGLE");

    const replacement = context.syncImageFallback(old, {
      id: "restore-poster",
      type: "image",
      assetId: "restore-image-asset",
      objectFit: "cover",
      objectPosition: "right center",
      rect: { width: 180, height: 100 },
      computedStyles: {},
    }, [asset]);

    expect(replacement).not.toBe(old);
    expect(replacement.type).toBe("RECTANGLE");
    expect(parent.children).toEqual([replacement]);
    expect(replacement.fills).toEqual([{
      type: "IMAGE",
      imageHash: "image-1",
      scaleMode: "CROP",
      imageTransform: [[1, 0, -0.5], [0, 1, 0]],
    }]);
    expect(replacement).toMatchObject({ name: "Product poster", width: 180, height: 100 });
    expect(replacement.getPluginData("open-canvas-id")).toBe("restore-poster");
    expect(replacement.getPluginData("open-canvas-image-fallback-kind")).toBe("");
    expect(replacement.getPluginData("open-canvas-image-fallback-asset-id")).toBe("");
    expect(replacement.getPluginData("open-canvas-image-fallback-source")).toBe("");
  });

  it("switches a multi-feature image fallback when one visual cause is removed", () => {
    const context = loadPluginFunctions();
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"200\" height=\"100\"><rect width=\"200\" height=\"100\"/></svg>";
    const asset = { id: "switch-image-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(svg)}` };
    const parent = mockFigmaNode("FRAME");
    const old = mockFigmaNode("VECTOR");
    old.resize(180, 100);
    old.setPluginData("open-canvas-image-fallback-kind", "filter");
    old.setPluginData("open-canvas-image-fallback-asset-id", "switch-image-asset");
    old.setPluginData("open-canvas-image-fallback-geometry", JSON.stringify({ width: 180, height: 100 }));
    old.setPluginData("open-canvas-image-fallback-source", "old-filter-signature");
    parent.appendChild(old);
    let generated = "";
    context.figma.createNodeFromSvg = value => {
      generated = value;
      return mockFigmaNode("VECTOR");
    };

    const replacement = context.syncImageFallback(old, {
      id: "switch-image",
      type: "image",
      assetId: "switch-image-asset",
      filter: "none",
      objectFit: "none",
      objectPosition: "center",
      rect: { width: 180, height: 100 },
      computedStyles: {},
    }, [asset]);

    expect(replacement).not.toBe(old);
    expect(replacement.type).toBe("VECTOR");
    expect(replacement.getPluginData("open-canvas-image-fallback-kind")).toBe("object-fit");
    expect(generated).toContain('viewBox="0 0 180 100"');
    expect(generated).not.toContain("cssImageFilter");
  });

  it("rebuilds a clip-path image fallback from the final geometry", () => {
    const context = loadPluginFunctions();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80"/></svg>';
    const asset = { id: "responsive-clip-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    const parent = mockFigmaNode("FRAME");
    const old = mockFigmaNode("VECTOR");
    old.resize(180, 100);
    old.setPluginData("open-canvas-id", "responsive-clip");
    old.setPluginData("open-canvas-image-fallback-kind", "clip-path");
    old.setPluginData("open-canvas-image-fallback-asset-id", "responsive-clip-asset");
    old.setPluginData("open-canvas-image-fallback-geometry", JSON.stringify({ width: 120, height: 80 }));
    parent.appendChild(old);
    let generated = "";
    context.figma.createNodeFromSvg = value => {
      generated = value;
      return mockFigmaNode("VECTOR");
    };

    const replacement = context.syncImageFallback(old, {
      id: "responsive-clip",
      type: "image",
      assetId: "responsive-clip-asset",
      objectFit: "cover",
      objectPosition: "center",
      rect: { width: 180, height: 100 },
      computedStyles: { clipPath: "circle(40% at 25% 50%)" },
    }, [asset]);

    expect(replacement).not.toBe(old);
    expect(parent.children).toEqual([replacement]);
    expect(generated).toContain('width="180" height="100" viewBox="0 0 180 100"');
    expect(generated).toContain('<clipPath id="clip"><circle cx="45" cy="50" r="40"');
    expect(replacement.getPluginData("open-canvas-image-fallback-geometry")).toBe(JSON.stringify({ width: 180, height: 100 }));
  });

  it("rebuilds a mask-image fallback from the final geometry", () => {
    const context = loadPluginFunctions();
    const source = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><rect width="120" height="80"/></svg>';
    const asset = { id: "responsive-mask-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(source)}` };
    const parent = mockFigmaNode("FRAME");
    const old = mockFigmaNode("VECTOR");
    old.resize(180, 100);
    old.setPluginData("open-canvas-id", "responsive-mask");
    old.setPluginData("open-canvas-image-fallback-kind", "mask-image");
    old.setPluginData("open-canvas-image-fallback-asset-id", "responsive-mask-asset");
    old.setPluginData("open-canvas-image-fallback-geometry", JSON.stringify({ width: 120, height: 80 }));
    parent.appendChild(old);
    let generated = "";
    context.figma.createNodeFromSvg = value => {
      generated = value;
      return mockFigmaNode("VECTOR");
    };

    const replacement = context.syncImageFallback(old, {
      id: "responsive-mask",
      type: "image",
      assetId: "responsive-mask-asset",
      objectFit: "cover",
      objectPosition: "center",
      rect: { width: 180, height: 100 },
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #fff)",
        maskSize: "100% 100%",
        maskPosition: "0% 0%",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "luminance",
      },
    }, [asset]);

    expect(replacement).not.toBe(old);
    expect(parent.children).toEqual([replacement]);
    expect(generated).toContain('width="180" height="100" viewBox="0 0 180 100"');
    expect(generated).toContain('<mask id="cssImageMask"');
    expect(replacement.getPluginData("open-canvas-image-fallback-geometry")).toBe(JSON.stringify({ width: 180, height: 100 }));
  });

  it("rebuilds a filtered image fallback with the final clip geometry", () => {
    const context = loadPluginFunctions();
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"120\" height=\"80\"><rect width=\"120\" height=\"80\"/></svg>";
    const asset = { id: "filtered-asset", kind: "svg", data: `data:image/svg+xml;base64,${globalThis.btoa(svg)}` };
    const parent = mockFigmaNode("FRAME");
    const old = mockFigmaNode("VECTOR");
    old.resize(200, 110);
    old.setPluginData("open-canvas-id", "filtered");
    old.setPluginData("open-canvas-image-fallback-kind", "filter");
    old.setPluginData("open-canvas-image-fallback-asset-id", "filtered-asset");
    old.setPluginData("open-canvas-image-fallback-geometry", JSON.stringify({ width: 140, height: 90 }));
    parent.appendChild(old);
    let generated = "";
    context.figma.createNodeFromSvg = value => {
      generated = value;
      return mockFigmaNode("VECTOR");
    };
    expect(context.filteredImageSvg(asset, {
      rect: { width: 200, height: 110 }, filter: "grayscale(100%) hue-rotate(20deg)",
      objectFit: "cover", objectPosition: "center", computedStyles: {},
    })).toContain('width="200" height="110"');

    const replacement = context.syncImageFallback(old, {
      id: "filtered",
      type: "image",
      assetId: "filtered-asset",
      filter: "grayscale(100%) hue-rotate(20deg) opacity(50%)",
      objectFit: "cover",
      objectPosition: "center",
      rect: { width: 200, height: 110 },
      radius: [16, 16, 16, 16],
      computedStyles: {},
    }, [asset]);

    expect(replacement).not.toBe(old);
    expect(parent.children).toEqual([replacement]);
    expect(generated).toContain('width="200" height="110" viewBox="0 0 200 110"');
    expect(generated).toContain('filter="url(#cssImageFilter)"');
    expect(generated).toContain('<clipPath id="clip">');
  });

  it("derives single-value and auto background sizes from intrinsic dimensions", () => {
    const context = loadPluginFunctions();
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 4, 0, 2, 0]);
    const asset = { kind: "image", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` };
    expect(context.customBackgroundSize("40px", 200, 100, asset)).toEqual({ width: 40, height: 20 });
    expect(context.customBackgroundSize("50%", 200, 100, asset)).toEqual({ width: 100, height: 50 });
    expect(context.customBackgroundSize("auto 25px", 200, 100, asset)).toEqual({ width: 50, height: 25 });
  });

  it("resolves functional background sizes without splitting calc tokens", () => {
    const context = loadPluginFunctions();
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 4, 0, 2, 0]);
    const asset = { kind: "image", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` };
    expect(context.customBackgroundSize("calc(50% - 10px)", 200, 100, asset)).toEqual({ width: 90, height: 45 });
    expect(context.customBackgroundSize("min(80%, 120px) auto", 200, 100, asset)).toEqual({ width: 120, height: 60 });
    expect(context.customBackgroundSize("clamp(40px, 60%, 140px) 20px", 200, 100, asset)).toEqual({ width: 120, height: 20 });
  });

  it("resolves font-relative and viewport background sizes and positions", () => {
    const context = loadPluginFunctions();
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 4, 0, 2, 0]);
    const asset = { kind: "image", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` };
    const lengthContext = {
      fontSize: 20,
      rootFontSize: 16,
      viewportWidth: 1000,
      viewportHeight: 800,
    };

    expect(context.customBackgroundSize("1em 10vw", 200, 100, asset, lengthContext))
      .toEqual({ width: 20, height: 100 });
    expect(context.imagePositionTopLeft("right 1em bottom 10%", 200, 100, 100, 40, lengthContext))
      .toEqual({ x: 80, y: 54 });
    expect(context.imagePositionTopLeft("calc(50% - 1rem) 1em", 200, 100, 100, 40, lengthContext))
      .toEqual({ x: 34, y: 20 });
    expect(context.imagePositionTopLeft("20px", 200, 100, 100, 40, lengthContext))
      .toEqual({ x: 20, y: 30 });
    expect(context.imagePositionTopLeft("top", 200, 100, 100, 40, lengthContext))
      .toEqual({ x: 50, y: 0 });
  });

  it("preserves functional and negative background-position offsets", () => {
    const context = loadPluginFunctions();
    expect(context.imagePositionTopLeft("calc(50% - 10px) calc(100% + 5px)", 200, 100, 100, 40)).toEqual({ x: 40, y: 65 });
    expect(context.imagePositionTopLeft("-10px -5px", 200, 100, 100, 40)).toEqual({ x: -10, y: -5 });
    expect(context.imagePositionTopLeft("right calc(10px + 5px) bottom 4px", 200, 100, 100, 40)).toEqual({ x: 85, y: 56 });
  });

  it("keeps one-value CSS positions horizontal across background, image, and mask fallbacks", () => {
    const context = loadPluginFunctions();
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 20, 0, 20, 0]);
    const asset = {
      id: "single-position-asset",
      url: "https://example.test/single-position.gif",
      data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}`,
    };
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };

    const backgroundNode = mockFigmaNode("FRAME");
    backgroundNode.resize(100, 80);
    context.backgroundImage(backgroundNode, {
      id: "single-position-background",
      rect: { width: 100, height: 80 },
      backgroundImage: "url(https://example.test/single-position.gif)",
      backgroundSize: "20px 20px",
      backgroundPosition: "10px",
      backgroundRepeat: "no-repeat",
      computedStyles: {},
    }, [asset], { images: new Map(), vectors: new Map() }, importReport());
    expect(svgs[0]).toContain('x="10" y="30" width="20" height="20"');

    expect(context.fittedImageGeometry(asset, {
      rect: { width: 100, height: 80 },
      objectFit: "none",
      objectPosition: "10px",
      computedStyles: {},
    }, 100, 80)).toMatchObject({ x: 10, y: 30, width: 20, height: 20 });

    const maskNode = mockFigmaNode("FRAME");
    maskNode.resize(100, 80);
    expect(context.applyMaskImage(maskNode, {
      id: "single-position-mask",
      type: "frame",
      rect: { width: 100, height: 80 },
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #fff)",
        maskSize: "20px 20px",
        maskPosition: "10px",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "alpha",
      },
    })).toBe(true);
    expect(svgs[1]).toContain('<rect x="10" y="30" width="20" height="20"');
  });

  it("measures CSS space and round background repeats instead of using Figma TILE", () => {
    const context = loadPluginFunctions();
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 40, 0, 20, 0]);
    const asset = { kind: "image", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` };
    expect(context.backgroundRepeatAxes("space round")).toEqual({ x: "space", y: "round" });
    expect(context.customBackgroundRepeat("space round", "40px 20px", 200, 100, asset)).toMatchObject({
      width: 40,
      height: 20,
      countX: 5,
      countY: 1,
      axes: { x: "space", y: "round" },
    });
    expect(context.customBackgroundRepeat("round", "60px 40px", 200, 100, asset)).toMatchObject({
      width: 66.66666666666667,
      height: 33.333333333333336,
      countX: 1,
      countY: 1,
      axes: { x: "round", y: "round" },
    });
  });

  it("renders a measured space-repeat background as a clipped SVG overlay", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = { fills: [], width: 190, height: 100, children: [], appendChild(child) { this.children.push(child); } };
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 40, 0, 20, 0]);
    const assets = [{ id: "asset-space", url: "https://example.test/space.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }];
    context.backgroundImage(node, {
      id: "space-background",
      rect: { width: 190, height: 100 },
      backgroundImage: "url(https://example.test/space.gif)",
      backgroundSize: "40px 20px",
      backgroundPosition: "left top",
      backgroundRepeat: "space",
    }, assets, { images: new Map() });
    expect(capturedSvg).toContain('<pattern id="image-pattern"');
    expect(capturedSvg).toContain('width="50"');
    expect(capturedSvg).toContain('height="100"');
    expect(node.children).toHaveLength(1);
    expect(node.fills).toEqual([]);
  });

  it("does not repeat a space tile when only one tile fits on an axis", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = { fills: [], width: 30, height: 10, children: [], appendChild(child) { this.children.push(child); } };
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 40, 0, 20, 0]);
    const assets = [{ id: "single-space", url: "https://example.test/single-space.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }];
    context.backgroundImage(node, {
      id: "single-space-background",
      rect: { width: 30, height: 10 },
      backgroundImage: "url(https://example.test/single-space.gif)",
      backgroundSize: "40px 20px",
      backgroundPosition: "center center",
      backgroundRepeat: "space",
    }, assets, { images: new Map() });
    // With a 30px origin and a 40px tile, CSS paints one centered tile. The
    // SVG pattern must therefore span the whole origin box rather than using
    // a 40px period that would paint a second partial tile.
    expect(capturedSvg).toContain('<pattern id="image-pattern"');
    expect(capturedSvg).toContain('width="30" height="10"');
    expect(capturedSvg).toContain('x="-5" y="-5" width="40" height="20"');
    expect(node.children).toHaveLength(1);
  });

  it("composes multi-layer bitmap space/round repeats into one ordered SVG overlay", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 40, 0, 20, 0]);
    const assets = [
      { id: "asset-space-a", url: "https://example.test/a.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
      { id: "asset-round-b", url: "https://example.test/b.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` },
    ];
    const report = importReport();
    context.backgroundImage(node, {
      id: "multi-repeat-background",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/a.gif), url(https://example.test/b.gif)",
      backgroundSize: "40px 20px, 60px 40px",
      backgroundPosition: "left top, right bottom",
      backgroundRepeat: "space, round",
      computedStyles: { backgroundBlendMode: "normal, normal" },
    }, assets, { images: new Map(), vectors: new Map() }, report);
    expect(capturedSvg).toContain("background-layer-0");
    expect(capturedSvg).toContain("background-layer-1");
    expect(node.children[0].name).toBe("__css-background-image-layers-multi-repeat-background");
    expect(node.fills).toEqual([]);
    expect(report.styleDegradations).toBe(0);
  });

  it("composes mixed gradient and space-repeat layers in captured order", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    context.backgroundImage(node, {
      id: "mixed-repeat-background",
      rect: { width: 200, height: 100 },
      backgroundImage: "linear-gradient(red, blue), url(https://example.test/a.gif)",
      backgroundSize: "auto, 40px 20px",
      backgroundRepeat: "no-repeat, space",
      computedStyles: { backgroundBlendMode: "normal, normal" },
    }, [{ id: "asset-space", url: "https://example.test/a.gif", kind: "image", data: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" }], { images: new Map(), vectors: new Map() }, report);
    expect(node.children[0].name).toBe("__css-background-mixed-clipped-mixed-repeat-background");
    expect(capturedSvg).toContain("linearGradient");
    expect(capturedSvg).toContain("<image");
    expect(capturedSvg).toContain("background-layer-1");
    expect(report.styleDegradations).toBe(0);
  });

  it("stretches a border-image space repeat when two tiles cannot fit", () => {
    const context = loadPluginFunctions();

    expect(context.borderImageRepeatPositions("space", 15, 10)).toEqual([
      { start: 0, size: 15 },
    ]);
    expect(context.borderImageRepeatPositions("space", 25, 10)).toEqual([
      { start: 0, size: 10 },
      { start: 15, size: 10 },
    ]);
  });

  it("preserves blend modes on mixed gradient and measured repeat layers", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const overlays = [];
    context.figma.createNodeFromSvg = svg => {
      const overlay = mockFigmaNode("VECTOR");
      overlays.push({ overlay, svg });
      return overlay;
    };
    const report = importReport();
    context.backgroundImage(node, {
      id: "mixed-repeat-blend-background",
      rect: { width: 200, height: 100 },
      backgroundImage: "linear-gradient(red, blue), url(https://example.test/a.gif)",
      backgroundSize: "auto, 40px 20px",
      backgroundRepeat: "no-repeat, round space",
      fill: { color: "#ffffff" },
      computedStyles: { backgroundBlendMode: "screen, multiply" },
    }, [{ id: "asset-space-blend", url: "https://example.test/a.gif", kind: "image", data: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" }], { images: new Map(), vectors: new Map() }, report);

    expect(overlays).toHaveLength(3);
    expect(overlays[0].overlay.name).toBe("__css-background-color-mixed-repeat-blend-background");
    expect(overlays.slice(1).map(entry => entry.overlay.blendMode)).toEqual(["MULTIPLY", "SCREEN"]);
    expect(overlays.some(entry => entry.svg.includes("background-layer-1"))).toBe(true);
    expect(overlays.some(entry => entry.svg.includes("linearGradient"))).toBe(true);
    expect(report.styleDegradations).toBe(0);
  });

  it("keeps conic gradients interleaved with URL background layers", () => {
    const context = loadPluginFunctions();
    const node = { fills: [], width: 200, height: 100 };
    const background = "conic-gradient(from 45deg, red, blue), url(https://example.test/texture.png)";
    const assets = [{ id: "texture", url: "https://example.test/texture.png", data: "data:image/png;base64,AAAA" }];

    // The regular gradient pass runs before the URL compositor in the plugin.
    // The layer classifier must therefore recognize the conic layer so the
    // later compositor can restore the original CSS order instead of treating
    // it as an untyped layer and appending the image above it.
    expect(context.gradient(node, background)).toBe(true);
    context.backgroundImage(node, {
      id: "mixed-conic-background",
      rect: { width: 200, height: 100 },
      backgroundImage: background,
      backgroundSize: "auto, cover",
      backgroundRepeat: "no-repeat, no-repeat",
      backgroundPosition: "0% 0%, center center",
    }, assets, { images: new Map(), vectors: new Map() });

    expect(node.fills.map((paint) => paint.type || paint.imageHash)).toEqual([
      "GRADIENT_ANGULAR",
      "IMAGE",
    ]);
  });

  it("composes repeating conic and URL backgrounds in an editable SVG overlay", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);
    const background = "repeating-conic-gradient(from 20deg, red 0deg, blue 90deg), url(https://example.test/texture.gif)";
    context.backgroundImage(node, {
      id: "mixed-repeating-conic-background",
      rect: { width: 200, height: 100 },
      backgroundImage: background,
      backgroundSize: "auto, cover",
      backgroundRepeat: "no-repeat, no-repeat",
      backgroundPosition: "0% 0%, center center",
    }, [{ id: "texture", url: "https://example.test/texture.gif", kind: "image", data: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=" }], { images: new Map(), vectors: new Map() });

    expect(overlay.name).toBe("__css-background-mixed-conic-mixed-repeating-conic-background");
    expect(capturedSvg).toContain("<path");
    expect(capturedSvg).toContain("<image");
    expect(node.children).toHaveLength(1);
    expect(node.fills).toEqual([]);
  });

  it("keeps content-visibility hidden geometry while suppressing its paint", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.visible = true;
    context.applyVisibility(node, { computedStyles: { contentVisibility: "hidden", visibility: "visible" } });
    expect(node.visible).toBe(false);
    expect(node.getPluginData("open-canvas-content-visibility")).toBe("hidden");
  });

  it("clears stale content-visibility metadata when visibility returns to normal", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.visible = false;
    node.setPluginData("open-canvas-content-visibility", "hidden");

    context.applyVisibility(node, {
      id: "visible-again-panel",
      computedStyles: { contentVisibility: "visible", visibility: "visible" },
    });

    expect(node.visible).toBe(true);
    expect(node.getPluginData("open-canvas-content-visibility")).toBe("");
  });

  it("keeps the measured space/round repeat path ahead of clipped URL composition", () => {
    const context = loadPluginFunctions();
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 40, 0, 20, 0]);
    const asset = { id: "asset-space-clip", url: "https://example.test/space.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` };
    const scene = {
      id: "space-clip",
      type: "frame",
      rect: { width: 190, height: 100 },
      backgroundImage: "url(https://example.test/space.gif)",
      backgroundRepeat: "space",
      backgroundSize: "40px 20px",
      fill: { color: "#ffffff" },
      computedStyles: { backgroundClip: "padding-box" },
    };
    const node = mockFigmaNode("FRAME");
    node.resize(190, 100);
    let called = false;
    context.figma.createNodeFromSvg = () => { called = true; return mockFigmaNode("VECTOR"); };
    expect(context.createClippedBackgroundImageOverlay(node, scene, asset)).toBe(false);
    expect(called).toBe(false);
  });

  it("measures space-repeat tiles inside the background-origin box", () => {
    const context = loadPluginFunctions();
    const overlay = mockFigmaNode("VECTOR");
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return overlay;
    };
    const node = { fills: [], width: 220, height: 100, children: [], appendChild(child) { this.children.push(child); } };
    const gifBytes = Uint8Array.from([71, 73, 70, 56, 57, 97, 40, 0, 20, 0]);
    const assets = [{ id: "asset-origin-space", url: "https://example.test/space.gif", data: `data:image/gif;base64,${globalThis.btoa(String.fromCharCode(...gifBytes))}` }];
    context.backgroundImage(node, {
      id: "origin-space-background",
      rect: { width: 220, height: 100 },
      borders: [
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
        { color: "#111", width: 2 },
      ],
      layout: { padding: [4, 4, 4, 4] },
      backgroundImage: "url(https://example.test/space.gif)",
      backgroundSize: "40px 20px",
      backgroundPosition: "left top",
      backgroundRepeat: "space",
      computedStyles: { backgroundOrigin: "content-box", backgroundClip: "content-box" },
    }, assets, { images: new Map() });
    expect(capturedSvg).toContain('<pattern id="image-pattern"');
    expect(capturedSvg).toContain('x="6" y="6"');
    expect(capturedSvg).toContain('width="42"');
  });

  it("preserves native paints when an embedded background fallback is not a supported bitmap", () => {
    const context = loadPluginFunctions();
    const node = { fills: [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }] };
    const assets = [{ id: "asset-svg", url: "inline:fallback", data: "data:image/svg+xml;base64,PHN2Zy8+" }];
    const report = importReport();
    context.figma.createImage = () => { throw new Error("Image type is unsupported"); };

    context.backgroundImage(node, {
      id: "banner",
      backgroundAssetId: "asset-svg",
      backgroundImage: "linear-gradient(90deg, red, blue)",
      backgroundSize: "auto",
      backgroundRepeat: "repeat",
    }, assets, { images: new Map() }, report);

    expect(node.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }]);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0]).toMatchObject({ id: "banner" });
  });

  it("interleaves gradient and URL layers in CSS order", () => {
    const context = loadPluginFunctions();
    const node = {
      fills: [
        { type: "GRADIENT_LINEAR", gradientStops: [] },
        { type: "SOLID", color: { r: 1, g: 1, b: 1 } },
      ],
    };
    const assets = [{ id: "asset-a", url: "https://example.test/a.png", data: "data:image/png;base64,AAAA" }];

    context.backgroundImage(node, {
      backgroundImage: "linear-gradient(90deg, red, blue), url(https://example.test/a.png)",
      backgroundSize: "cover",
      backgroundRepeat: "no-repeat",
    }, assets, { images: new Map() });

    expect(node.fills.map((paint) => paint.imageHash || paint.type)).toEqual([
      "GRADIENT_LINEAR",
      "image-1",
      "SOLID",
    ]);
  });

  it("keeps the CSS layer index when an earlier background asset is missing", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 100);

    context.backgroundImage(node, {
      id: "missing-first-background",
      rect: { width: 200, height: 100 },
      backgroundImage: "url(https://example.test/missing.png), url(https://example.test/available.png)",
      backgroundSize: "20px 10px, 80px 40px",
      backgroundPosition: "left top, right bottom",
      backgroundRepeat: "no-repeat, no-repeat",
      computedStyles: { backgroundBlendMode: "screen, multiply" },
    }, [{
      id: "available",
      url: "https://example.test/available.png",
      data: "data:image/png;base64,AAAA",
    }], { images: new Map() });

    expect(node.fills).toHaveLength(1);
    expect(node.fills[0].imageHash).toBe("image-1");
    // The surviving paint is still layer 1: its right/bottom focal point must
    // not be replaced by the missing layer's left/top position.
    expect(node.fills[0].imageTransform).toEqual([[1, 0, -0.5], [0, 1, -0.5]]);
    context.applyBackgroundBlendModes(node, {
      computedStyles: { backgroundBlendMode: "screen, multiply" },
    });
    expect(node.fills[0].blendMode).toBe("MULTIPLY");
  });

  it("keeps a surviving gradient's layer index when every URL asset is missing", () => {
    const context = loadPluginFunctions();
    const gradientPaint = { type: "GRADIENT_LINEAR", gradientStops: [] };
    const node = {
      fills: [gradientPaint, { type: "SOLID", color: { r: 1, g: 1, b: 1 } }],
      width: 200,
      height: 100,
    };
    const scene = {
      backgroundImage: "url(https://example.test/missing.png), linear-gradient(red, blue)",
      computedStyles: { backgroundBlendMode: "screen, multiply" },
    };

    context.backgroundImage(node, scene, [], { images: new Map() });
    context.applyBackgroundBlendModes(node, scene);

    expect(gradientPaint.blendMode).toBe("MULTIPLY");
  });

  it("keeps alpha from modern slash-separated shadow colors", () => {
    const context = loadPluginFunctions();
    expect(context.cssShadow("0 4px 12px rgb(0 0 0 / 20%)")).toMatchObject({
      offsetX: 0,
      offsetY: 4,
      blur: 12,
      opacity: 0.2,
    });
  });

  it("parses nested CSS Color 4 functions in shadow colors", () => {
    const context = loadPluginFunctions();
    expect(context.cssShadow("color(display-p3 1 0 0 / 50%) 0 2px 4px")).toMatchObject({
      color: "color(display-p3 1 0 0 / 50%)",
      offsetY: 2,
      blur: 4,
      opacity: 0.5,
    });
    expect(context.cssShadow("0 1px 3px color-mix(in srgb, red 25%, blue)")).toMatchObject({
      color: "color-mix(in srgb, red 25%, blue)",
    });
  });

  it("resolves CSS math and relative units in shadow lengths", () => {
    const context = loadPluginFunctions();
    const lengthContext = {
      fontSize: 20,
      rootFontSize: 16,
      viewportWidth: 1440,
      viewportHeight: 900,
    };
    const shadow = context.cssShadow(
      "calc(-0.5em + 2px) min(1rem, 18px) clamp(0px, 1dvw, 16px) max(-4px, -0.25rem) rgba(0,0,0,.2)",
      undefined,
      { lengthContext },
    );

    expect(shadow).toMatchObject({ offsetX: -8, offsetY: 16, blur: 14.4, spread: -4, opacity: 0.2 });
  });

  it("accepts two-length shadows and enforces text/filter shadow grammar", () => {
    const context = loadPluginFunctions();
    const lengthContext = { fontSize: 16, rootFontSize: 16, viewportWidth: 1200, viewportHeight: 800 };

    expect(context.cssShadow("0 0 currentColor", "rgb(12, 34, 56)", { kind: "text", lengthContext })).toMatchObject({
      offsetX: 0,
      offsetY: 0,
      blur: 0,
      spread: 0,
      color: "rgb(12, 34, 56)",
    });
    expect(context.cssFilterShadows("drop-shadow(0.5em 1rem currentColor)", "rgb(12, 34, 56)", lengthContext)).toEqual([
      expect.objectContaining({ offsetX: 8, offsetY: 16, blur: 0, spread: 0 }),
    ]);
    expect(context.cssFilterShadows("drop-shadow(0 2px 4px 6px red)", undefined, lengthContext)).toEqual([]);
    expect(context.cssFilterUnparsedShadowCount("drop-shadow(0 2px 4px 6px red)", undefined, lengthContext)).toBe(1);
    expect(context.cssShadow("inset 0 2px 4px red", undefined, { kind: "text", lengthContext })).toBeUndefined();
    expect(context.cssShadow("0 2px -1px red", undefined, { kind: "text", lengthContext })).toBeUndefined();
    expect(context.cssShadow("1 2px red", undefined, { kind: "text", lengthContext })).toBeUndefined();
    expect(context.cssShadow("10% 2px red", undefined, { kind: "text", lengthContext })).toBeUndefined();
  });

  it("uses the same resolved lengths for native and SVG filter effects", () => {
    const context = loadPluginFunctions();
    const lengthContext = { fontSize: 20, rootFontSize: 16, viewportWidth: 1200, viewportHeight: 800 };
    expect(context.cssFilterBlurs("blur(min(0.5rem, 12px))", lengthContext)).toEqual([8]);
    const definition = context.cssFilterSvgDefinition(
      "blur(min(0.5rem, 12px)) drop-shadow(0.5em 1rem currentColor)",
      "resolved-filter",
      "rgb(12, 34, 56)",
      lengthContext,
    );
    expect(definition).toContain('<feGaussianBlur stdDeviation="8"/>');
    expect(definition).toContain('dx="10" dy="16" stdDeviation="0"');

    const node = { type: "FRAME", width: 240, height: 120, fills: [], effects: [] };
    context.visuals(node, {
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      rootFontSize: 16,
      viewportWidth: 1200,
      viewportHeight: 800,
      computedStyles: { fontSize: "20px", color: "rgb(12, 34, 56)" },
      filter: "blur(min(0.5rem, 12px)) drop-shadow(0.5em 1rem currentColor)",
    });
    expect(node.effects).toEqual([
      expect.objectContaining({ type: "DROP_SHADOW", offset: { x: 10, y: 16 }, radius: 0 }),
      { type: "LAYER_BLUR", radius: 8, visible: true },
    ]);
  });

  it("scales native dashed and dotted stroke rhythms with the painted width", () => {
    const context = loadPluginFunctions();
    const dashed = { dashPattern: [] };
    context.applyStrokePattern(dashed, {
      stroke: { style: "dashed", width: 3 },
      borders: [undefined, undefined, undefined, undefined],
    });
    expect(dashed.dashPattern).toEqual([18, 12]);

    const dotted = { dashPattern: [] };
    context.applyStrokePattern(dotted, {
      borders: [{ width: 2, style: "dotted" }],
    });
    expect(dotted.dashPattern).toEqual([2, 6]);
    expect(context.strokeDashPattern("solid", 4)).toEqual([]);
  });

  it("renders non-solid borders as absolute side layers", () => {
    const context = loadPluginFunctions();
    context.figma.createRectangle = () => ({
      fills: [],
      strokes: [],
      dashPattern: [],
      x: 0,
      y: 0,
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
    });
    const parent = {
      width: 100,
      height: 30,
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    };
    context.createBorderDecorations(parent, {
      rect: { width: 100, height: 30 },
      borders: [
        { color: "rgb(0, 0, 0)", width: 2, style: "outset" },
        { color: "rgb(0, 0, 0)", width: 2, style: "outset" },
        { color: "rgb(0, 0, 0)", width: 2, style: "outset" },
        { color: "rgb(0, 0, 0)", width: 2, style: "outset" },
      ],
    });
    expect(parent.children).toHaveLength(4);
    expect(parent.children.map((child) => child.name)).toEqual([
      "__css-border-top",
      "__css-border-right",
      "__css-border-bottom",
      "__css-border-left",
    ]);
    expect(parent.children[0].height).toBe(2);
    expect(parent.children[2].y).toBe(28);
  });

  it("keeps border and outline fallback decorations aligned after a container resize", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const top = mockFigmaNode("RECTANGLE");
    top.name = "__css-border-top";
    top.resize(100, 2);
    const right = mockFigmaNode("RECTANGLE");
    right.name = "__css-border-right";
    right.resize(2, 30);
    right.x = 98;
    const outline = mockFigmaNode("VECTOR");
    outline.name = "__css-outline";
    outline.resize(110, 40);
    outline.x = -5;
    outline.y = -5;
    parent.appendChild(top);
    parent.appendChild(right);
    parent.appendChild(outline);

    parent.resize(140, 48);
    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      borders: [],
      outline: { width: 2 },
      outlineOffset: 3,
    });

    expect(top).toMatchObject({ width: 140, height: 2, x: 0, y: 0 });
    expect(right).toMatchObject({ width: 2, height: 48, x: 138, y: 0 });
    expect(outline).toMatchObject({ width: 150, height: 58, x: -5, y: -5 });
  });

  it("rebuilds an outline fallback when its source paint changes at the same size", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      const vector = mockFigmaNode("VECTOR");
      vector.remove = () => {
        const index = parent.children.indexOf(vector);
        if (index >= 0) parent.children.splice(index, 1);
      };
      svgs.push(svg);
      return vector;
    };
    const scene = {
      id: "same-size-outline-change",
      rect: { width: 100, height: 40 },
      outline: { color: "rgb(20, 40, 60)", width: 2, style: "solid" },
      outlineOffset: 3,
      radius: [8, 8, 8, 8],
    };

    context.createOutlineDecoration(parent, scene);
    expect(parent.children).toHaveLength(1);
    expect(svgs[0]).toContain("rgb(20,40,60)");

    scene.outline.color = "rgb(180, 40, 60)";
    context.syncBorderDecorationFallbacks(parent, scene);

    expect(svgs).toHaveLength(2);
    expect(svgs[1]).toContain("rgb(180,40,60)");
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].getPluginData("open-canvas-outline-source-signature")).toContain("180, 40, 60");
  });

  it("resolves and rebuilds an outline fallback when inherited currentColor changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      const vector = mockFigmaNode("VECTOR");
      vector.remove = () => {
        const index = parent.children.indexOf(vector);
        if (index >= 0) parent.children.splice(index, 1);
      };
      svgs.push(svg);
      return vector;
    };
    const scene = {
      id: "same-size-current-color-outline",
      rect: { width: 100, height: 40 },
      outline: { color: "currentColor", width: 2, style: "solid" },
      outlineOffset: 3,
      computedStyles: { color: "rgb(20, 40, 60)" },
      radius: [8, 8, 8, 8],
    };

    context.createOutlineDecoration(parent, scene);
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).not.toContain("currentColor");
    expect(svgs[0]).toContain("rgb(20,40,60)");

    scene.computedStyles.color = "rgb(200, 80, 40)";
    context.syncBorderDecorationFallbacks(parent, scene);

    expect(svgs).toHaveLength(2);
    expect(svgs[1]).not.toContain("currentColor");
    expect(svgs[1]).toContain("rgb(200,80,40)");
    expect(parent.children).toHaveLength(1);
  });

  it("rebuilds per-side border fallbacks when a same-size paint changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    const created = [];
    context.figma.createRectangle = () => {
      const rectangle = mockFigmaNode("RECTANGLE");
      rectangle.remove = () => {
        const index = parent.children.indexOf(rectangle);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(rectangle);
      return rectangle;
    };
    const scene = {
      rect: { width: 100, height: 40 },
      radius: [0, 0, 0, 0],
      borders: ["#111", "#222", "#333", "#444"].map(color => ({
        color,
        width: 2,
        style: "solid",
      })),
    };

    context.createBorderDecorations(parent, scene);
    expect(created).toHaveLength(4);

    scene.borders[0].color = "#f00";
    context.syncBorderDecorationFallbacks(parent, scene);

    expect(created).toHaveLength(8);
    expect(parent.children).toHaveLength(4);
    expect(parent.getPluginData("open-canvas-border-source-signature")).toContain("#f00");
  });

  it("resolves and refreshes solid border fallbacks when inherited currentColor changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    const created = [];
    context.figma.createRectangle = () => {
      const rectangle = mockFigmaNode("RECTANGLE");
      rectangle.remove = () => {
        const index = parent.children.indexOf(rectangle);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(rectangle);
      return rectangle;
    };
    const scene = {
      id: "same-size-current-color-solid-border",
      rect: { width: 100, height: 40 },
      radius: [0, 0, 0, 0],
      computedStyles: { color: "rgb(12, 34, 56)" },
      borders: [
        { color: "currentColor", width: 2, style: "solid" },
        { color: "#222", width: 2, style: "solid" },
        { color: "#333", width: 2, style: "solid" },
        { color: "#444", width: 2, style: "solid" },
      ],
    };

    context.createBorderDecorations(parent, scene);
    expect(created).toHaveLength(4);
    expect(created[0].fills[0].color).toEqual({ r: 12 / 255, g: 34 / 255, b: 56 / 255 });

    scene.computedStyles.color = "rgb(180, 40, 60)";
    context.syncBorderDecorationFallbacks(parent, scene);

    expect(created).toHaveLength(8);
    const refreshedTop = parent.children.find(child => child.name === "__css-border-top");
    expect(refreshedTop.fills[0].color).toEqual({ r: 180 / 255, g: 40 / 255, b: 60 / 255 });
    expect(parent.children).toHaveLength(4);
  });

  it("does not rebuild side borders for their intentional corner span, but rebuilds changed thickness", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    let createdCount = 0;
    context.figma.createRectangle = () => {
      createdCount += 1;
      const rectangle = mockFigmaNode("RECTANGLE");
      rectangle.remove = () => {
        const index = parent.children.indexOf(rectangle);
        if (index >= 0) parent.children.splice(index, 1);
      };
      return rectangle;
    };
    const scene = {
      id: "asymmetric-side-border-sync",
      type: "frame",
      rect: { width: 100, height: 40 },
      radius: [0, 0, 0, 0],
      borders: [2, 3, 4, 5].map((width, index) => ({
        width,
        style: "solid",
        color: ["#111", "#222", "#333", "#444"][index],
      })),
    };

    context.createBorderDecorations(parent, scene);
    expect(parent.children).toHaveLength(4);
    expect(createdCount).toBe(4);

    // Right/left fallback heights intentionally omit the top/bottom spans;
    // an unchanged convergence pass must not rebuild all four decorations.
    context.syncBorderDecorationFallbacks(parent, scene);
    expect(createdCount).toBe(4);
    expect(parent.children).toHaveLength(4);

    scene.borders[1].width = 6;
    context.syncBorderDecorationFallbacks(parent, scene);
    expect(createdCount).toBe(8);
    expect(parent.children).toHaveLength(4);
    expect(parent.children.find(child => child.name === "__css-border-right").width).toBe(6);
  });

  it("removes stale border and outline fallbacks when the captured paints are removed", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.strokes = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    const border = mockFigmaNode("VECTOR");
    border.name = "__css-border-gradient";
    border.remove = () => {
      const index = parent.children.indexOf(border);
      if (index >= 0) parent.children.splice(index, 1);
    };
    const outline = mockFigmaNode("VECTOR");
    outline.name = "__css-outline";
    outline.remove = () => {
      const index = parent.children.indexOf(outline);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(border);
    parent.appendChild(outline);
    parent.setPluginData("open-canvas-outline-style", "auto");
    parent.setPluginData("open-canvas-outline-rendered-style", "solid");

    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      borders: [undefined, undefined, undefined, undefined],
      outline: undefined,
    });

    expect(parent.children).toEqual([]);
    expect(parent.strokes).toEqual([]);
    expect(parent.getPluginData("open-canvas-outline-style")).toBe("");
    expect(parent.getPluginData("open-canvas-outline-rendered-style")).toBe("");
  });

  it("removes a stale border fallback when a stroke-only source is removed", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.strokes = [{ type: "GRADIENT_LINEAR" }];
    const border = mockFigmaNode("VECTOR");
    border.name = "__css-border-gradient";
    border.remove = () => {
      const index = parent.children.indexOf(border);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(border);

    // A trimmed H2D scene may have used only `stroke` for the previous
    // uniform border. The next capture has neither `stroke` nor `borders`.
    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      stroke: undefined,
    });

    expect(parent.children).toEqual([]);
    expect(parent.strokes).toEqual([]);
  });

  it("recreates border and outline fallbacks when a cleared source returns", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    context.figma.createRectangle = () => {
      const rectangle = mockFigmaNode("RECTANGLE");
      rectangle.remove = () => {
        const index = parent.children.indexOf(rectangle);
        if (index >= 0) parent.children.splice(index, 1);
      };
      return rectangle;
    };
    context.figma.createNodeFromSvg = () => {
      const vector = mockFigmaNode("VECTOR");
      vector.remove = () => {
        const index = parent.children.indexOf(vector);
        if (index >= 0) parent.children.splice(index, 1);
      };
      return vector;
    };
    const borders = ["#111", "#222", "#333", "#444"].map(color => ({
      color,
      width: 2,
      style: "solid",
    }));
    const scene = {
      id: "border-outline-return",
      rect: { width: 100, height: 30 },
      radius: [0, 0, 0, 0],
      borders,
      outline: { color: "#556677", width: 2, style: "solid" },
      outlineOffset: 2,
    };

    context.createBorderDecorations(parent, scene);
    context.createOutlineDecoration(parent, scene);
    expect(parent.children.some(child => String(child.name).startsWith("__css-border-"))).toBe(true);
    expect(parent.children.some(child => child.name === "__css-outline")).toBe(true);

    scene.borders = [undefined, undefined, undefined, undefined];
    scene.outline = undefined;
    context.syncBorderDecorationFallbacks(parent, scene);
    expect(parent.children).toHaveLength(0);

    scene.borders = borders;
    scene.outline = { color: "#556677", width: 2, style: "solid" };
    context.syncBorderDecorationFallbacks(parent, scene);
    expect(parent.children.some(child => String(child.name).startsWith("__css-border-"))).toBe(true);
    expect(parent.children.some(child => child.name === "__css-outline")).toBe(true);
  });

  it("keeps a unified stroke fallback when hidden per-side records coexist", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const border = mockFigmaNode("VECTOR");
    border.name = "__css-border-double";
    border.remove = () => {
      const index = parent.children.indexOf(border);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(border);

    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      stroke: { width: 6, style: "double", color: "#112233" },
      borders: [0, 1, 2, 3].map(() => ({ width: 0, style: "hidden", color: "transparent" })),
    });

    expect(parent.children).toEqual([border]);
  });

  it("removes only the fallback for a border side that becomes hidden", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const children = ["top", "right", "bottom", "left"].map(side => {
      const child = mockFigmaNode("RECTANGLE");
      child.name = `__css-border-${side}`;
      child.remove = () => {
        const index = parent.children.indexOf(child);
        if (index >= 0) parent.children.splice(index, 1);
      };
      parent.appendChild(child);
      return child;
    });

    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      borders: [
        { width: 2, style: "solid", color: "#111" },
        { width: 2, style: "none", color: "transparent" },
        { width: 2, style: "solid", color: "#333" },
        { width: 2, style: "solid", color: "#444" },
      ],
    });

    expect(parent.children).toEqual([children[0], children[2], children[3]]);
  });

  it("preserves asymmetric border-image outsets while syncing a gradient vector", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(140, 48);
    const vector = mockFigmaNode("VECTOR");
    vector.name = "__css-border-gradient";
    vector.resize(108, 36);
    vector.x = -3;
    vector.y = -2;
    parent.appendChild(vector);
    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      borders: [
        { paintOutset: 2 },
        { paintOutset: 5 },
        { paintOutset: 4 },
        { paintOutset: 3 },
      ],
    });
    expect(vector).toMatchObject({ width: 148, height: 54, x: -3, y: -2 });
  });

  it("preserves asymmetric border-image outsets while syncing an image vector", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(140, 48);
    const vector = mockFigmaNode("VECTOR");
    vector.name = "__css-border-image";
    vector.resize(108, 36);
    vector.x = -3;
    vector.y = -2;
    parent.appendChild(vector);
    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      borders: [
        { paintOutset: 2 },
        { paintOutset: 5 },
        { paintOutset: 4 },
        { paintOutset: 3 },
      ],
    });
    expect(vector).toMatchObject({ width: 148, height: 54, x: -3, y: -2 });
  });

  it("rebuilds a complete gradient border instead of scaling its stroke thickness", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldVector = mockFigmaNode("VECTOR");
    oldVector.name = "__css-border-gradient";
    oldVector.resize(144, 52);
    oldVector.remove = () => {
      const index = parent.children.indexOf(oldVector);
      if (index >= 0) parent.children.splice(index, 1);
    };
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    parent.appendChild(oldVector);
    parent.appendChild(content);
    const gradient = "linear-gradient(90deg, #f00, #00f)";
    const created = [];
    context.figma.createNodeFromSvg = svg => {
      const vector = mockFigmaNode("VECTOR");
      vector.remove = () => {
        const index = parent.children.indexOf(vector);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push({ vector, svg });
      return vector;
    };
    const borders = [0, 1, 2, 3].map(() => ({
      width: 2,
      paintWidth: 2,
      paintOutset: 2,
      gradient,
      style: "solid",
      color: "transparent",
    }));
    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      borders,
    });
    expect(created).toHaveLength(1);
    expect(parent.children).toHaveLength(2);
    expect(parent.children[0]).toBe(created[0].vector);
    expect(parent.children[1]).toBe(content);
    expect(created[0].vector).toMatchObject({ width: 104, height: 34, x: -2, y: -2 });
  });

  it("rebuilds a gradient border fallback when currentColor changes at the same size", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      const vector = mockFigmaNode("VECTOR");
      vector.remove = () => {
        const index = parent.children.indexOf(vector);
        if (index >= 0) parent.children.splice(index, 1);
      };
      svgs.push(svg);
      return vector;
    };
    const scene = {
      id: "same-size-current-color-border",
      rect: { width: 100, height: 40 },
      computedStyles: { color: "rgb(12, 34, 56)" },
      borders: [0, 1, 2, 3].map(() => ({
        color: "transparent",
        width: 2,
        paintOutset: 2,
        style: "solid",
        gradient: "linear-gradient(90deg, currentColor, transparent)",
      })),
    };

    context.createBorderDecorations(parent, scene);
    expect(svgs).toHaveLength(1);
    expect(svgs[0]).not.toContain("currentColor");
    expect(svgs[0]).toContain("rgb(12,34,56)");

    scene.computedStyles.color = "rgb(180, 40, 60)";
    context.syncBorderDecorationFallbacks(parent, scene);

    expect(svgs).toHaveLength(2);
    expect(svgs[1]).not.toContain("currentColor");
    expect(svgs[1]).toContain("rgb(180,40,60)");
    expect(parent.children).toHaveLength(1);
  });

  it("rebuilds a gradient border fallback when elliptical corner axes change at the same size", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      const vector = mockFigmaNode("VECTOR");
      vector.remove = () => {
        const index = parent.children.indexOf(vector);
        if (index >= 0) parent.children.splice(index, 1);
      };
      svgs.push(svg);
      return vector;
    };
    const scene = {
      id: "same-size-elliptical-radius-border",
      type: "frame",
      rect: { width: 120, height: 60 },
      radius: [8, 12, 6, 10],
      computedStyles: {
        borderTopLeftRadius: "8px 4px",
        borderTopRightRadius: "12px 6px",
        borderBottomRightRadius: "6px 3px",
        borderBottomLeftRadius: "10px 5px",
      },
      borders: [2, 3, 2, 3].map(width => ({
        color: "transparent",
        width,
        style: "solid",
        gradient: "linear-gradient(90deg, #f00, #00f)",
      })),
    };

    context.createBorderDecorations(parent, scene);
    expect(parent.children[0].name).toBe("__css-border-gradient");
    expect(svgs).toHaveLength(1);
    const firstSvg = svgs[0];

    // Keep the owning frame dimensions unchanged while changing only the
    // CSS horizontal/vertical corner axes. The fallback must be regenerated,
    // otherwise a responsive/state update leaves the old ring geometry in
    // place even though the source radius has changed.
    scene.computedStyles.borderTopLeftRadius = "16px 8px";
    scene.computedStyles.borderTopRightRadius = "4px 12px";
    scene.computedStyles.borderBottomRightRadius = "14px 7px";
    scene.computedStyles.borderBottomLeftRadius = "6px 11px";
    context.syncBorderDecorationFallbacks(parent, scene);

    expect(svgs).toHaveLength(2);
    expect(svgs[1]).not.toBe(firstSvg);
    expect(svgs[1]).toContain("16");
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
  });

  it("rebuilds an elliptical currentColor border fallback when the inherited color changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      const vector = mockFigmaNode("VECTOR");
      vector.remove = () => {
        const index = parent.children.indexOf(vector);
        if (index >= 0) parent.children.splice(index, 1);
      };
      svgs.push(svg);
      return vector;
    };
    const scene = {
      id: "same-size-current-color-elliptical-border",
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      computedStyles: {
        color: "rgb(20, 40, 60)",
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
      },
      borders: [0, 1, 2, 3].map(() => ({
        color: "transparent",
        width: 2,
        style: "solid",
        gradient: "linear-gradient(90deg, currentColor, transparent)",
      })),
    };

    context.createBorderDecorations(parent, scene);
    expect(parent.children[0].name).toBe("__css-border-elliptical");
    expect(svgs[0]).not.toContain("currentColor");
    expect(svgs[0]).toContain("rgb(20,40,60)");

    scene.computedStyles.color = "rgb(200, 80, 40)";
    context.syncBorderDecorationFallbacks(parent, scene);

    expect(svgs).toHaveLength(2);
    expect(svgs[1]).not.toContain("currentColor");
    expect(svgs[1]).toContain("rgb(200,80,40)");
    expect(parent.children).toHaveLength(1);
  });

  it("keeps the old border stack when a replacement is incomplete", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.strokes = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    const originalStrokes = parent.strokes;
    const oldBorder = mockFigmaNode("VECTOR");
    oldBorder.name = "__css-border-gradient";
    oldBorder.resize(140, 48);
    oldBorder.remove = () => {
      const index = parent.children.indexOf(oldBorder);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldBorder);
    const oldExtra = mockFigmaNode("VECTOR");
    oldExtra.name = "__css-border-extra";
    oldExtra.resize(140, 48);
    oldExtra.remove = () => {
      const index = parent.children.indexOf(oldExtra);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldExtra);
    context.figma.createNodeFromSvg = () => {
      const partial = mockFigmaNode("VECTOR");
      partial.remove = () => {
        const index = parent.children.indexOf(partial);
        if (index >= 0) parent.children.splice(index, 1);
      };
      return partial;
    };

    context.syncBorderDecorationFallbacks(parent, {
      rect: { width: 100, height: 30 },
      borders: [0, 1, 2, 3].map(() => ({
        width: 2,
        paintWidth: 2,
        gradient: "linear-gradient(90deg, #f00, #00f)",
        style: "solid",
        color: "transparent",
      })),
    });

    expect(parent.children).toEqual([oldBorder, oldExtra]);
    expect(parent.strokes).toBe(originalStrokes);
  });

  it("rebuilds clip-path masks for the final container size", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-clip-path-mask";
    oldMask.resize(140, 48);
    oldMask.remove = () => {
      const index = parent.children.indexOf(oldMask);
      if (index >= 0) parent.children.splice(index, 1);
    };
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    parent.appendChild(oldMask);
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = parent.children.indexOf(mask);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(mask);
      return mask;
    };
    context.syncMaskAndClipFallbacks(parent, {
      type: "frame",
      rect: { width: 100, height: 30 },
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)" },
    });
    expect(created).toHaveLength(1);
    expect(parent.children).toHaveLength(2);
    expect(parent.children[0]).toBe(created[0]);
    expect(parent.children[1]).toBe(content);
    expect(created[0]).toMatchObject({ width: 100, height: 30, x: 0, y: 0 });
  });

  it("recreates a clip fallback when a removed source returns without an old sibling", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = parent.children.indexOf(mask);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(mask);
      return mask;
    };

    context.syncMaskAndClipFallbacks(parent, {
      id: "restored-clip-source",
      type: "frame",
      rect: { width: 100, height: 30 },
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)" },
    }, []);

    expect(created).toHaveLength(1);
    expect(parent.children[0]).toBe(created[0]);
    expect(parent.children[1]).toBe(content);
  });

  it("rebuilds a same-size clip mask when the captured shape changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const scene = {
      id: "same-size-clip-change",
      type: "frame",
      rect: { width: 100, height: 30 },
      computedStyles: { clipPath: "circle(40% at 50% 50%)" },
    };
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-clip-path-mask";
    oldMask.resize(100, 30);
    oldMask.setPluginData("open-canvas-mask-source-signature", JSON.stringify({
      kind: "clip-path",
      clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
      clip: "auto",
    }));
    oldMask.remove = () => {
      const index = parent.children.indexOf(oldMask);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldMask);
    const content = mockFigmaNode("TEXT");
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = parent.children.indexOf(mask);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(mask);
      return mask;
    };

    context.syncMaskAndClipFallbacks(parent, scene, []);

    expect(created).toHaveLength(1);
    expect(parent.children).toEqual([created[0], content]);
    expect(created[0].getPluginData("open-canvas-mask-source-signature")).toBe(
      context.clipFallbackSourceSignature(scene),
    );
  });

  it("rebuilds a legacy same-size clip mask that has no source signature", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-clip-path-mask";
    oldMask.resize(100, 30);
    oldMask.remove = () => {
      const index = parent.children.indexOf(oldMask);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldMask);
    const content = mockFigmaNode("TEXT");
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = parent.children.indexOf(mask);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(mask);
      return mask;
    };
    const scene = {
      id: "legacy-same-size-clip",
      type: "frame",
      rect: { width: 100, height: 30 },
      computedStyles: { clipPath: "circle(40% at 50% 50%)" },
    };

    context.syncMaskAndClipFallbacks(parent, scene, []);

    expect(created).toHaveLength(1);
    expect(parent.children).toEqual([created[0], content]);
    expect(created[0].getPluginData("open-canvas-mask-source-signature")).toBe(
      context.clipFallbackSourceSignature(scene),
    );
  });

  it("rebuilds a same-size mask when its source geometry changes", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const scene = {
      id: "same-size-mask-change",
      type: "frame",
      rect: { width: 100, height: 30 },
      computedStyles: {
        maskImage: "linear-gradient(90deg, transparent, #000)",
        maskPosition: "20% 0%",
        maskSize: "80% 100%",
        maskRepeat: "no-repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "match-source",
      },
    };
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-mask-image";
    oldMask.resize(100, 30);
    oldMask.setPluginData("open-canvas-mask-source-signature", JSON.stringify({
      maskImage: "linear-gradient(90deg, #000, transparent)",
      maskMode: "match-source",
      maskComposite: "add",
      maskPosition: "0% 0%",
      maskSize: "100% 100%",
      maskRepeat: "no-repeat",
      maskClip: "border-box",
      maskOrigin: "border-box",
    }));
    oldMask.remove = () => {
      const index = parent.children.indexOf(oldMask);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldMask);
    const content = mockFigmaNode("TEXT");
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = parent.children.indexOf(mask);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(mask);
      return mask;
    };

    context.syncMaskAndClipFallbacks(parent, scene, []);

    expect(created).toHaveLength(1);
    expect(parent.children).toEqual([created[0], content]);
    expect(created[0].getPluginData("open-canvas-mask-source-signature")).toBe(
      context.maskFallbackSourceSignature(scene),
    );
  });

  it("switches fallback families when clip-path changes to legacy clip at the same size", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-clip-path-mask";
    oldMask.resize(100, 30);
    oldMask.setPluginData("open-canvas-mask-source-signature", JSON.stringify({
      kind: "clip-path",
      clipPath: "polygon(0 0, 100% 0, 100% 100%, 0 100%)",
      clip: "auto",
    }));
    oldMask.remove = () => {
      const index = parent.children.indexOf(oldMask);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldMask);
    const content = mockFigmaNode("TEXT");
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = parent.children.indexOf(mask);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(mask);
      return mask;
    };

    context.syncMaskAndClipFallbacks(parent, {
      id: "clip-family-switch",
      type: "frame",
      rect: { width: 100, height: 30 },
      computedStyles: { clipPath: "none", clip: "rect(2px, 96px, 28px, 4px)" },
    }, []);

    expect(created).toHaveLength(1);
    expect(parent.children).toEqual([created[0], content]);
    expect(created[0].name).toBe("__css-legacy-clip-mask");
  });

  it("keeps a surviving mask sibling while switching the clip family", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldClip = mockFigmaNode("VECTOR");
    oldClip.name = "__css-clip-path-mask";
    oldClip.resize(100, 30);
    oldClip.remove = () => {
      const index = parent.children.indexOf(oldClip);
      if (index >= 0) parent.children.splice(index, 1);
    };
    const mask = mockFigmaNode("VECTOR");
    mask.name = "__css-mask-image";
    mask.resize(100, 30);
    mask.setPluginData("open-canvas-mask-source-signature", JSON.stringify({
      maskImage: "linear-gradient(90deg, transparent, #000)",
      maskMode: "match-source",
      maskComposite: "add",
      maskPosition: "0% 0%",
      maskSize: "auto",
      maskRepeat: "repeat",
      maskClip: "border-box",
      maskOrigin: "border-box",
    }));
    mask.remove = () => {
      const index = parent.children.indexOf(mask);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldClip);
    parent.appendChild(mask);
    const content = mockFigmaNode("TEXT");
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const replacement = mockFigmaNode("VECTOR");
      replacement.remove = () => {
        const index = parent.children.indexOf(replacement);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(replacement);
      return replacement;
    };

    context.syncMaskAndClipFallbacks(parent, {
      id: "composed-clip-family-switch",
      type: "frame",
      rect: { width: 100, height: 30 },
      computedStyles: {
        clipPath: "none",
        clip: "rect(2px, 96px, 28px, 4px)",
        maskImage: "linear-gradient(90deg, transparent, #000)",
      },
    }, []);

    expect(created).toHaveLength(1);
    expect(parent.children.map(child => child.name)).toEqual([
      "__css-legacy-clip-mask",
      "__css-mask-image",
      content.name,
    ]);
  });

  it("rebuilds clip-path background overlays together with the mask", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-clip-path-mask";
    oldMask.resize(140, 48);
    const oldBackground = mockFigmaNode("VECTOR");
    oldBackground.name = "__css-clip-path-background-panel";
    oldBackground.resize(140, 48);
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    for (const decoration of [oldMask, oldBackground]) {
      decoration.remove = () => {
        const index = parent.children.indexOf(decoration);
        if (index >= 0) parent.children.splice(index, 1);
      };
      parent.appendChild(decoration);
    }
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const decoration = mockFigmaNode("VECTOR");
      decoration.remove = () => {
        const index = parent.children.indexOf(decoration);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(decoration);
      return decoration;
    };
    context.syncMaskAndClipFallbacks(parent, {
      id: "panel",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "#ffffff" },
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 50% 100%)" },
    }, []);
    expect(created).toHaveLength(2);
    expect(parent.children).toEqual([created[0], created[1], content]);
    expect(created[0].name).toBe("__css-clip-path-mask");
    expect(created[1].name).toBe("__css-clip-path-background-panel");
    expect(created[1]).toMatchObject({ width: 100, height: 30, x: 0, y: 0 });
  });

  it("rebuilds legacy rect clip masks for the final container size", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-legacy-clip-mask";
    oldMask.resize(140, 48);
    oldMask.remove = () => {
      const index = parent.children.indexOf(oldMask);
      if (index >= 0) parent.children.splice(index, 1);
    };
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    parent.appendChild(oldMask);
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = parent.children.indexOf(mask);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(mask);
      return mask;
    };
    context.syncMaskAndClipFallbacks(parent, {
      type: "frame",
      rect: { width: 100, height: 30 },
      computedStyles: { clip: "rect(2px, 96px, 28px, 4px)" },
    });
    expect(created).toHaveLength(1);
    expect(parent.children).toEqual([created[0], content]);
    expect(created[0]).toMatchObject({
      name: "__css-legacy-clip-mask",
      width: 100,
      height: 30,
      x: 0,
      y: 0,
    });
  });

  it("removes stale clip and mask siblings when their sources disappear at the same size", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    const originalFills = parent.fills;
    const decorations = [
      "__css-clip-path-mask",
      "__css-mask-image",
      "__css-mask-background-panel",
      "__css-legacy-clip-mask",
      "__css-elliptical-radius-mask",
      "__css-elliptical-background",
    ].map(name => {
      const decoration = mockFigmaNode("VECTOR");
      decoration.name = name;
      decoration.resize(100, 30);
      decoration.remove = () => {
        const index = parent.children.indexOf(decoration);
        if (index >= 0) parent.children.splice(index, 1);
      };
      parent.appendChild(decoration);
      return decoration;
    });
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    parent.appendChild(content);

    context.syncMaskAndClipFallbacks(parent, {
      id: "same-size-source-removed",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "#ffffff" },
      computedStyles: { clipPath: "none", clip: "auto", maskImage: "none" },
    }, []);

    expect(parent.children).toEqual([content]);
    expect(parent.fills).toMatchObject(originalFills);
    expect(decorations.every(decoration => !parent.children.includes(decoration))).toBe(true);
  });

  it("restores mask background stacking after final-size regeneration", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-mask-image";
    oldMask.resize(140, 48);
    const oldBackground = mockFigmaNode("VECTOR");
    oldBackground.name = "__css-mask-background-panel";
    oldBackground.resize(140, 48);
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    for (const decoration of [oldMask, oldBackground]) {
      decoration.remove = () => {
        const index = parent.children.indexOf(decoration);
        if (index >= 0) parent.children.splice(index, 1);
      };
      parent.appendChild(decoration);
    }
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const decoration = mockFigmaNode("VECTOR");
      decoration.remove = () => {
        const index = parent.children.indexOf(decoration);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(decoration);
      return decoration;
    };

    context.syncMaskAndClipFallbacks(parent, {
      id: "panel",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "#ffffff" },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000000)",
        maskPosition: "0% 0%",
        maskSize: "auto",
        maskRepeat: "repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "match-source",
      },
    }, []);

    expect(created).toHaveLength(2);
    expect(parent.children).toEqual([created[0], created[1], content]);
    expect(created[0].name).toBe("__css-mask-image");
    expect(created[1].name).toBe("__css-mask-background-panel");
  });

  it("keeps the old mask stack when regeneration is incomplete", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    const originalFills = parent.fills;
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-mask-image";
    oldMask.resize(140, 48);
    const oldBackground = mockFigmaNode("VECTOR");
    oldBackground.name = "__css-mask-background-panel";
    oldBackground.resize(140, 48);
    for (const decoration of [oldMask, oldBackground]) {
      decoration.remove = () => {
        const index = parent.children.indexOf(decoration);
        if (index >= 0) parent.children.splice(index, 1);
      };
      parent.appendChild(decoration);
    }
    let calls = 0;
    context.figma.createNodeFromSvg = () => {
      calls += 1;
      if (calls > 1) return null;
      const decoration = mockFigmaNode("VECTOR");
      decoration.remove = () => {
        const index = parent.children.indexOf(decoration);
        if (index >= 0) parent.children.splice(index, 1);
      };
      return decoration;
    };

    context.syncMaskAndClipFallbacks(parent, {
      id: "panel",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "#ffffff" },
      computedStyles: {
        maskImage: "linear-gradient(to right, transparent, #000000)",
        maskPosition: "0% 0%",
        maskSize: "auto",
        maskRepeat: "repeat",
        maskClip: "border-box",
        maskOrigin: "border-box",
        maskMode: "match-source",
      },
    }, []);

    expect(parent.children).toEqual([oldMask, oldBackground]);
    expect(parent.fills).toBe(originalFills);
  });

  it("rebuilds a clipped background at its original stacking position", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const oldBackground = mockFigmaNode("VECTOR");
    oldBackground.name = "__css-background-color-panel";
    oldBackground.resize(140, 48);
    oldBackground.remove = () => {
      const index = parent.children.indexOf(oldBackground);
      if (index >= 0) parent.children.splice(index, 1);
    };
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    parent.appendChild(oldBackground);
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const overlay = mockFigmaNode("VECTOR");
      created.push(overlay);
      return overlay;
    };
    context.syncBackgroundFallbacks(parent, {
      id: "panel",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "rgb(255, 255, 255)" },
      computedStyles: { backgroundClip: "padding-box" },
      borders: [{ width: 1 }, { width: 1 }, { width: 1 }, { width: 1 }],
      layout: { padding: [4, 4, 4, 4] },
    }, [], { images: new Map(), vectors: new Map() }, importReport());
    expect(created).toHaveLength(1);
    expect(parent.children).toEqual([created[0], content]);
    expect(created[0]).toMatchObject({
      name: "__css-background-color-panel",
      width: 100,
      height: 30,
      x: 0,
      y: 0,
    });
  });

  it("recreates a clipped background when the removed source returns without an old sibling", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const overlay = mockFigmaNode("VECTOR");
      created.push(overlay);
      return overlay;
    };

    context.syncBackgroundFallbacks(parent, {
      id: "restored-background-source",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "rgb(255, 255, 255)" },
      computedStyles: { backgroundClip: "padding-box" },
      borders: [{ width: 1 }, { width: 1 }, { width: 1 }, { width: 1 }],
      layout: { padding: [4, 4, 4, 4] },
    }, [], { images: new Map(), vectors: new Map() }, importReport());

    expect(created).toHaveLength(1);
    expect(parent.children[0]).toBe(created[0]);
    expect(parent.children[1]).toBe(content);
  });

  it("removes a stale same-size background fallback when the source is removed", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.fills = [];
    const oldBackground = mockFigmaNode("VECTOR");
    oldBackground.name = "__css-background-svg-panel";
    oldBackground.resize(100, 30);
    oldBackground.remove = () => {
      const index = parent.children.indexOf(oldBackground);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldBackground);
    context.figma.createNodeFromSvg = () => null;

    context.syncBackgroundFallbacks(parent, {
      id: "panel",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "rgb(255, 255, 255)" },
      computedStyles: { backgroundClip: "border-box" },
      backgroundImage: "none",
      backgroundAssetId: "",
    }, [], { images: new Map(), vectors: new Map() }, importReport());

    expect(parent.children).toEqual([]);
    expect(parent.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }]);
  });

  it("removes a stale background fallback when SVG creation is unavailable", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.fills = [];
    const oldBackground = mockFigmaNode("VECTOR");
    oldBackground.name = "__css-background-svg-capability-shift";
    oldBackground.resize(100, 30);
    oldBackground.remove = () => {
      const index = parent.children.indexOf(oldBackground);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldBackground);
    context.figma.createNodeFromSvg = undefined;

    context.syncBackgroundFallbacks(parent, {
      id: "capability-shift",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "rgb(255, 255, 255)" },
      computedStyles: { backgroundClip: "border-box" },
      backgroundImage: "none",
      backgroundAssetId: "",
    }, [], { images: new Map(), vectors: new Map() }, importReport());

    expect(parent.children).toEqual([]);
    expect(parent.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }]);
  });

  it("keeps the complete background stack when regeneration produces only part of it", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    const originalFills = parent.fills;
    const oldBack = mockFigmaNode("VECTOR");
    oldBack.name = "__css-background-svg-panel";
    oldBack.resize(140, 48);
    const oldFront = mockFigmaNode("VECTOR");
    oldFront.name = "__css-background-image-panel";
    oldFront.resize(140, 48);
    for (const overlay of [oldBack, oldFront]) {
      overlay.remove = () => {
        const index = parent.children.indexOf(overlay);
        if (index >= 0) parent.children.splice(index, 1);
      };
      parent.appendChild(overlay);
    }
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const overlay = mockFigmaNode("VECTOR");
      overlay.remove = () => {
        const index = parent.children.indexOf(overlay);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(overlay);
      return overlay;
    };

    context.syncBackgroundFallbacks(parent, {
      id: "panel",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "rgb(255, 255, 255)" },
      backgroundAssetId: "first",
      backgroundImage: "url(first.svg)",
      computedStyles: { backgroundClip: "padding-box", backgroundBlendMode: "normal" },
      borders: [{ width: 1 }, { width: 1 }, { width: 1 }, { width: 1 }],
      layout: { padding: [4, 4, 4, 4] },
    }, [{
      id: "first",
      kind: "image",
      url: "first.png",
      data: "data:image/png;base64,ZmFrZQ==",
      width: 10,
      height: 10,
    }, {
      id: "first",
      kind: "svg",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#fff"/></svg>')}`,
    }], { images: new Map(), vectors: new Map() }, importReport());

    expect(created).toHaveLength(1);
    expect(parent.children).toEqual([oldBack, oldFront]);
    expect(parent.fills).toBe(originalFills);
  });

  it("rolls back appended background layers when final regeneration throws", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 30);
    parent.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    const originalFills = parent.fills;
    const oldBackground = mockFigmaNode("VECTOR");
    oldBackground.name = "__css-background-color-panel";
    oldBackground.resize(140, 48);
    oldBackground.remove = () => {
      const index = parent.children.indexOf(oldBackground);
      if (index >= 0) parent.children.splice(index, 1);
    };
    parent.appendChild(oldBackground);
    let calls = 0;
    context.figma.createNodeFromSvg = () => {
      calls += 1;
      if (calls > 1) throw new Error("host rejected the next background layer");
      const overlay = mockFigmaNode("VECTOR");
      overlay.remove = () => {
        const index = parent.children.indexOf(overlay);
        if (index >= 0) parent.children.splice(index, 1);
      };
      return overlay;
    };

    context.syncBackgroundFallbacks(parent, {
      id: "panel",
      type: "frame",
      rect: { width: 100, height: 30 },
      fill: { color: "rgb(255, 255, 255)" },
      computedStyles: { backgroundClip: "padding-box" },
      borders: [{ width: 1 }, { width: 1 }, { width: 1 }, { width: 1 }],
      layout: { padding: [4, 4, 4, 4] },
      backgroundImage: "url(first.svg)",
      backgroundAssetId: "first",
    }, [{
      id: "first",
      kind: "svg",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>')}`,
    }], { images: new Map(), vectors: new Map() }, importReport());

    expect(parent.children).toEqual([oldBackground]);
    expect(parent.fills).toBe(originalFills);
  });

  it("renders ridge and groove borders as two-tone editable side layers", () => {
    const context = loadPluginFunctions();
    context.figma.createNodeFromSvg = undefined;
    context.figma.createRectangle = () => ({
      fills: [],
      strokes: [],
      x: 0,
      y: 0,
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
    });
    const parent = {
      width: 100,
      height: 30,
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    };
    const scene = {
      id: "legacy-ridge-border",
      rect: { width: 100, height: 30 },
      borders: [
        { color: "rgb(100, 100, 100)", width: 4, style: "ridge" },
        { color: "rgb(100, 100, 100)", width: 4, style: "ridge" },
        { color: "rgb(100, 100, 100)", width: 4, style: "ridge" },
        { color: "rgb(100, 100, 100)", width: 4, style: "ridge" },
      ],
    };
    context.createBorderDecorations(parent, scene);
    expect(parent.children).toHaveLength(8);
    expect(parent.children.map((child) => child.name)).toEqual([
      "__css-border-top-outer",
      "__css-border-top-inner",
      "__css-border-right-inner",
      "__css-border-right-outer",
      "__css-border-bottom-inner",
      "__css-border-bottom-outer",
      "__css-border-left-outer",
      "__css-border-left-inner",
    ]);
    expect(parent.children[0].fills[0].color).not.toEqual(parent.children[1].fills[0].color);
    expect(parent.children[0].height).toBe(2);
    expect(parent.children[1].height).toBe(2);
    const report = importReport();
    context.recordSceneDegradations(scene, report, [], parent);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("border-style ridge");
  });

  it("renders CSS outlines as non-flow decorations outside the captured box", () => {
    const context = loadPluginFunctions();
    context.figma.createRectangle = () => ({
      fills: [],
      strokes: [],
      dashPattern: [],
      x: 0,
      y: 0,
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
    });
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    context.createOutlineDecoration(parent, {
      id: "focus-ring",
      rect: { width: 100, height: 40 },
      outline: { color: "rgb(20, 40, 60)", width: 2, style: "dashed" },
      outlineOffset: 3,
      radius: [8, 8, 8, 8],
    });

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-outline");
    expect(parent.children[0].width).toBe(110);
    expect(parent.children[0].height).toBe(50);
    expect(parent.children[0].x).toBe(-5);
    expect(parent.children[0].y).toBe(-5);
    expect(parent.children[0].dashPattern).toEqual([12, 8]);
  });

  it("normalizes string outline width and offset during fallback creation", () => {
    const context = loadPluginFunctions();
    context.figma.createRectangle = () => ({
      fills: [],
      strokes: [],
      dashPattern: [],
      x: 0,
      y: 0,
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
    });
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    context.createOutlineDecoration(parent, {
      id: "string-focus-ring",
      rect: { width: 100, height: 40 },
      outline: { color: "rgb(20, 40, 60)", width: "2px", style: "solid" },
      outlineOffset: "3px",
      radius: [0, 0, 0, 0],
    });

    expect(parent.children[0]).toMatchObject({ width: 110, height: 50, x: -5, y: -5 });
  });

  it("renders double outlines as two separated vector rings", () => {
    const context = loadPluginFunctions();
    context.figma.createNodeFromSvg = svg => {
      expect((svg.match(/fill-rule="evenodd"/g) || []).length).toBe(2);
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    context.createOutlineDecoration(parent, {
      id: "double-focus-ring",
      rect: { width: 100, height: 40 },
      outline: { color: "rgb(20, 40, 60)", width: 6, style: "double" },
      outlineOffset: 2,
      radius: [8, 8, 8, 8],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-outline");
    expect(parent.children[0].x).toBe(-8);
    expect(parent.children[0].y).toBe(-8);
  });

  it("preserves fractional thirds for thin double outlines", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    context.createOutlineDecoration(parent, {
      rect: { width: 100, height: 40 },
      outline: { color: "rgb(20, 40, 60)", width: 2, style: "double" },
      outlineOffset: 1,
      radius: [0, 0, 0, 0],
    });

    expect(parent.children).toHaveLength(1);
    // The first ring's inner edge is inset by 2/3px and the second ring starts
    // after two such bands. A whole-pixel clamp would produce 1px/2px here.
    expect(svg).toContain("0.6666666666666666");
    expect(svg).toContain("1.3333333333333333");
    expect(svg).not.toContain("M 3 1 H");
  });

  it("preserves elliptical radii on both double-outline rings", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    context.createOutlineDecoration(parent, {
      rect: { width: 120, height: 80 },
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      outline: { color: "rgb(20, 40, 60)", width: 6, style: "double" },
      outlineOffset: 2,
      radius: [18, 18, 18, 18],
    });

    expect(parent.children).toHaveLength(1);
    expect((svg.match(/A 26 18/g) || []).length).toBeGreaterThan(0);
    expect((svg.match(/fill-rule="evenodd"/g) || []).length).toBe(2);
  });

  it("keeps solid outlines elliptical when the source has two-axis radii", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    context.createOutlineDecoration(parent, {
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
      },
      outline: { color: "rgb(20, 40, 60)", width: 2, style: "solid" },
      outlineOffset: 3,
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-outline");
    expect(svgs[0]).toContain("A 25 15");
    expect(svgs[0]).toContain("fill-rule=\"evenodd\"");
    expect(parent.children[0].x).toBe(-5);
    expect(parent.children[0].y).toBe(-5);
  });

  it("maps platform auto outlines to editable solid elliptical focus rings", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    const scene = {
      id: "auto-focus-ring",
      rect: { width: 120, height: 80 },
      radius: [18, 18, 18, 18],
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      outline: { color: "rgb(20, 40, 60)", width: 3, style: "auto" },
      outlineOffset: -1,
    };

    context.createOutlineDecoration(parent, scene);

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-outline");
    expect(parent.children[0].x).toBe(-2);
    expect(parent.children[0].y).toBe(-2);
    expect(svg).toContain("fill-rule=\"evenodd\"");
    expect(svg).toContain("A 20 12");
    expect(parent.getPluginData("open-canvas-outline-style")).toBe("auto");
    expect(parent.getPluginData("open-canvas-outline-rendered-style")).toBe("solid");

    const report = importReport();
    context.recordSceneDegradations(scene, report, [], parent);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("platform-defined");
    expect(report.styleDegradationNodes[0].message).toContain("editable solid focus-ring approximation");
  });

  it("keeps an editable rounded auto-outline fallback when SVG creation is unavailable", () => {
    const context = loadPluginFunctions();
    context.figma.createRectangle = () => ({
      fills: [],
      strokes: [],
      dashPattern: [99],
      topLeftRadius: 0,
      topRightRadius: 0,
      bottomRightRadius: 0,
      bottomLeftRadius: 0,
      x: 0,
      y: 0,
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
    });
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    context.createOutlineDecoration(parent, {
      id: "legacy-auto-focus-ring",
      rect: { width: 100, height: 40 },
      radius: [8, 6, 4, 2],
      outline: { color: "rgb(20, 40, 60)", width: 2, style: "auto" },
      outlineOffset: 3,
    });

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]).toMatchObject({
      name: "__css-outline",
      width: 110,
      height: 50,
      x: -5,
      y: -5,
      dashPattern: [],
      topLeftRadius: 13,
      topRightRadius: 11,
      bottomRightRadius: 9,
      bottomLeftRadius: 7,
    });
    expect(parent.getPluginData("open-canvas-outline-style")).toBe("auto");
    expect(parent.getPluginData("open-canvas-outline-rendered-style")).toBe("solid");
  });

  it("retains auto-outline metadata and reports when no decoration API is available", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    const scene = {
      id: "unsupported-auto-focus-ring",
      rect: { width: 100, height: 40 },
      radius: [8, 8, 8, 8],
      outline: { color: "rgb(20, 40, 60)", width: 2, style: "auto" },
      outlineOffset: 2,
    };

    context.createOutlineDecoration(parent, scene);

    expect(parent.children).toEqual([]);
    expect(parent.getPluginData("open-canvas-outline-style")).toBe("auto");
    expect(parent.getPluginData("open-canvas-outline-rendered-style")).toBe("solid");
    const report = importReport();
    context.recordSceneDegradations(scene, report, [], parent);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("could not create");
  });

  it("renders shaded inset and outset outlines as editable vector layers", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    context.createOutlineDecoration(parent, {
      rect: { width: 100, height: 40 },
      outline: { color: "rgb(40, 40, 40)", width: 6, style: "ridge" },
      outlineOffset: 2,
      radius: [8, 8, 8, 8],
    });

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-outline");
    expect(parent.children[0].x).toBe(-8);
    expect(parent.children[0].y).toBe(-8);
    expect(svgs[0]).toContain("outlineTop");
    expect((svgs[0].match(/fill-rule="evenodd"/g) || []).length).toBe(8);
  });

  it("preserves elliptical radii for shaded outline vectors", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    context.createOutlineDecoration(parent, {
      rect: { width: 120, height: 80 },
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      outline: { color: "rgb(40, 40, 40)", width: 4, style: "outset" },
      outlineOffset: 2,
      radius: [18, 18, 18, 18],
    });

    expect(parent.children).toHaveLength(1);
    expect(svg).toContain("A 24 16");
  });

  it("renders dashed elliptical outlines with an SVG elliptical path", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    context.createOutlineDecoration(parent, {
      rect: { width: 120, height: 80 },
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      outline: { color: "rgb(40, 40, 40)", width: 4, style: "dashed" },
      outlineOffset: 2,
      radius: [18, 18, 18, 18],
    });

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-outline");
    expect(svg).toContain('stroke-dasharray="24 16"');
    expect(svg).toContain("A 22 14");
  });

  it("uses round caps for dotted elliptical outlines", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    context.createOutlineDecoration(parent, {
      rect: { width: 120, height: 80 },
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      outline: { color: "rgb(40, 40, 40)", width: 4, style: "dotted" },
      outlineOffset: 2,
      radius: [18, 18, 18, 18],
    });

    expect(parent.children).toHaveLength(1);
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-dasharray="4 12"');
  });

  it("uses a round-cap SVG path for dotted circular outlines", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    context.createOutlineDecoration(parent, {
      rect: { width: 120, height: 80 },
      outline: { color: "rgb(40, 40, 40)", width: 2, style: "dotted" },
      outlineOffset: 1,
      radius: [12, 12, 12, 12],
    });

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-outline");
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-dasharray="2 6"');
    expect(svg).toContain("A 14 14");
  });

  it("maps zero-inset rounded clip-path to native clipping and corner radii", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 60);
    context.visuals(node, {
      type: "frame",
      rect: { width: 120, height: 60 },
      radius: [0, 0, 0, 0],
      computedStyles: { clipPath: "inset(0 round 8px 12px)" },
    });
    expect(node.clipsContent).toBe(true);
    expect(node.topLeftRadius).toBe(8);
    expect(node.topRightRadius).toBe(12);
    expect(node.bottomRightRadius).toBe(8);
    expect(node.bottomLeftRadius).toBe(12);
  });

  it("preserves elliptical border radii with an editable mask and clipped solid fill", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(120, 80);
    const scene = {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      fill: { color: "rgb(20, 40, 60)" },
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
        clipPath: "none",
      },
    };
    context.visuals(node, scene);
    context.backgroundImage(node, scene, [], { images: new Map(), vectors: new Map() }, importReport());
    expect(svgs[0]).toContain("A 20 10");
    expect(node.children.map(child => child.name)).toEqual(["__css-elliptical-radius-mask", "__css-elliptical-background"]);
    expect(node.fills).toEqual([]);
    expect(node.children[0].isMask).toBe(true);
  });

  it("keeps uniform elliptical solid borders as an editable vector ring", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    context.createBorderDecorations(node, {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      borders: [
        { color: "rgb(20, 40, 60)", width: 2, style: "solid" },
        { color: "rgb(20, 40, 60)", width: 2, style: "solid" },
        { color: "rgb(20, 40, 60)", width: 2, style: "solid" },
        { color: "rgb(20, 40, 60)", width: 2, style: "solid" },
      ],
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
      },
    });
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-border-elliptical");
    expect(svgs[0]).toContain("A 20 10");
    expect(svgs[0]).toContain("M 20 2");
    expect(node.strokes).toEqual([]);
  });

  it("renders uniform elliptical double borders as two editable vector rings", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    context.createBorderDecorations(node, {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [18, 18, 18, 18],
      borders: [0, 1, 2, 3].map(() => ({
        color: "rgb(20, 40, 60)",
        width: 6,
        style: "double",
      })),
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
    });

    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-border-double");
    expect((svg.match(/fill-rule="evenodd"/g) || []).length).toBe(2);
    expect(svg).toContain("A 18 10");
    expect(node.strokes).toEqual([]);
  });

  it("keeps a thin double border inside its authored border width", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    context.createBorderDecorations(node, {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [12, 12, 12, 12],
      borders: [0, 1, 2, 3].map(() => ({ color: "#14283c", width: 2, style: "double" })),
    });

    expect(node.children[0].name).toBe("__css-border-double");
    expect(svg).toContain("0.6666666666666666");
    expect(svg).toContain("1.3333333333333333");
    expect(svg).toContain("M 12 2");
  });

  it("does not flatten differently colored double-border sides into one paint", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    context.figma.createNodeFromSvg = () => {
      throw new Error("a multi-color double border must stay on the per-side fallback");
    };
    context.figma.createRectangle = () => mockFigmaNode("RECTANGLE");
    context.createBorderDecorations(node, {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [12, 12, 12, 12],
      borders: ["#ff0000", "#00ff00", "#0000ff", "#000000"].map(color => ({ color, width: 6, style: "double" })),
    });

    expect(node.children.length).toBe(8);
    expect(node.children.map(child => child.name)).toContain("__css-border-top-outer");
    expect(node.children.map(child => child.name)).toContain("__css-border-left-inner");
  });

  it("keeps fractional double-border bands and vertical corner spans during sync", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    context.figma.createRectangle = () => mockFigmaNode("RECTANGLE");
    const scene = {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [12, 12, 12, 12],
      borders: [2, 5, 4, 7].map((width, index) => ({
        color: ["#ff0000", "#00ff00", "#0000ff", "#000000"][index],
        width,
        style: "double",
      })),
    };

    context.createBorderDecorations(node, scene);
    const topOuter = node.children.find(child => child.name === "__css-border-top-outer");
    const topInner = node.children.find(child => child.name === "__css-border-top-inner");
    const rightOuter = node.children.find(child => child.name === "__css-border-right-outer");
    expect(topOuter.height).toBeCloseTo(2 / 3, 8);
    expect(topInner).toMatchObject({ y: 4 / 3 });
    expect(rightOuter.width).toBeCloseTo(5 / 3, 8);
    expect(rightOuter).toMatchObject({ y: 2, height: 74 });

    context.syncBorderDecorationFallbacks(node, scene);

    expect(node.children).toHaveLength(8);
    expect(topOuter.height).toBeCloseTo(2 / 3, 8);
    expect(rightOuter.width).toBeCloseTo(5 / 3, 8);
    expect(rightOuter).toMatchObject({ y: 2, height: 74 });
  });

  it("keeps uniform elliptical gradient borders as one editable vector ring", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    const gradient = "linear-gradient(90deg, #ff0000, #0000ff)";
    context.createBorderDecorations(node, {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      borders: [0, 1, 2, 3].map(() => ({
        color: "transparent",
        gradient,
        width: 2,
        style: "solid",
      })),
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
      },
    });
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-border-elliptical");
    expect(svgs[0]).toContain("cssBorderEllipticalGradient");
    expect(svgs[0]).toContain("linearGradient");
    expect(svgs[0]).toContain("fill=\"url(#cssBorderEllipticalGradient)\"");
    expect(svgs[0]).toContain("A 20 10");
    expect(node.strokes).toEqual([]);
  });

  it("keeps conic gradients on the elliptical border ring instead of Figma's circular stroke", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    const gradient = "conic-gradient(from 45deg at 25% 60%, #f00 0deg, #00f 180deg, #f00 360deg)";
    context.createBorderDecorations(node, {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      borders: [0, 1, 2, 3].map(() => ({ color: "transparent", gradient, width: 2, style: "solid" })),
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
      },
    });
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-border-elliptical");
    expect(svgs[0]).toContain("cssBorderEllipticalConicClip");
    expect(svgs[0]).toContain("<path");
    expect(node.strokes).toEqual([]);
  });

  it("does not add an elliptical mask for ordinary circular radii", () => {
    const context = loadPluginFunctions();
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    context.visuals(node, {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [12, 12, 12, 12],
      fill: { color: "#fff" },
      computedStyles: {
        borderTopLeftRadius: "12px",
        borderTopRightRadius: "12px",
        borderBottomRightRadius: "12px",
        borderBottomLeftRadius: "12px",
        clipPath: "none",
      },
    });
    expect(node.children).toHaveLength(0);
    expect(node.fills).toHaveLength(1);
  });

  it("clips a single gradient background to the elliptical radius path", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    const scene = {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      gradient: "linear-gradient(90deg, #ff0000, #0000ff)",
      backgroundImage: "linear-gradient(90deg, #ff0000, #0000ff)",
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
        clipPath: "none",
      },
    };
    context.visuals(node, scene);
    context.backgroundImage(node, scene, [], { images: new Map(), vectors: new Map() }, importReport());
    expect(svgs[1]).toContain("linearGradient");
    expect(svgs[1]).toContain("elliptical-background-gradient-0");
    expect(svgs[1]).toContain("A 20 10");
    expect(node.fills).toEqual([]);
  });

  it("flattens mixed gradient and image layers into one elliptical background vector", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(160, 96);
    const gradient = "linear-gradient(135deg, #ff0000, #0000ff)";
    const pixelPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const scene = {
      id: "mixed-elliptical-background",
      type: "frame",
      rect: { width: 160, height: 96 },
      radius: [10, 10, 10, 10],
      fill: { color: "#101010" },
      gradient,
      backgroundImage: `${gradient}, url(https://example.test/texture.png)`,
      backgroundSize: "cover, 24px 24px",
      backgroundPosition: "center, left top",
      backgroundRepeat: "no-repeat, repeat",
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
        clipPath: "none",
      },
    };

    context.visuals(node, scene);
    context.backgroundImage(node, scene, [{ id: "texture", url: "https://example.test/texture.png", data: pixelPng }], { images: new Map(), vectors: new Map() }, importReport());

    expect(node.fills).toEqual([]);
    expect(node.children.map(child => child.name)).toEqual([
      "__css-elliptical-radius-mask",
      "__css-background-elliptical-mixed-elliptical-background",
    ]);
    expect(svgs.at(-1)).toContain("linearGradient");
    expect(svgs.at(-1)).toContain("<image");
    expect(svgs.at(-1)).toContain("A 20 10");
  });

  it("clips conic-only backgrounds to the elliptical radius path", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(120, 80);
    const gradient = "conic-gradient(from 30deg at 35% 55%, #f00 0deg, #00f 180deg, #f00 360deg)";
    const scene = {
      id: "elliptical-conic-background",
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [10, 10, 10, 10],
      gradient,
      backgroundImage: gradient,
      computedStyles: {
        borderTopLeftRadius: "20px 10px",
        borderTopRightRadius: "20px 10px",
        borderBottomRightRadius: "20px 10px",
        borderBottomLeftRadius: "20px 10px",
        clipPath: "none",
      },
    };

    context.visuals(node, scene);
    context.backgroundImage(node, scene, [], { images: new Map(), vectors: new Map() }, importReport());

    expect(node.fills).toEqual([]);
    expect(node.children.map(child => child.name)).toEqual([
      "__css-elliptical-radius-mask",
      "__css-background-elliptical-elliptical-conic-background",
    ]);
    expect(svgs.at(-1)).toContain("<path");
    expect(svgs.at(-1)).toContain("A 20 10");
  });

  it("imports CSS path clip-paths as editable vector masks", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "masked-card",
      type: "frame",
      rect: { width: 120, height: 60 },
      computedStyles: { clipPath: "path('M 0 0 L 120 0 L 60 60 Z')" },
    }, report);
    expect(report.styleDegradations).toBe(0);

    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(120, 60);
    expect(context.applyClipPath(node, {
      rect: { width: 120, height: 60 },
      computedStyles: { clipPath: "path('M 0 0 L 120 0 L 60 60 Z')" },
    })).toBe(true);
    expect(capturedSvg).toContain('d="M 0 0 L 120 0 L 60 60 Z"');
    expect(node.children[0].name).toBe("__css-clip-path-mask");
    expect(node.children[0].isMask).toBe(true);
    expect(node.clipsContent).toBe(true);
  });

  it("imports legacy CSS rect clips as editable vector masks", () => {
    const context = loadPluginFunctions();
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(200, 100);
    expect(context.applyClipPath(node, {
      rect: { width: 200, height: 100 },
      computedStyles: { clip: "rect(10px, 180px, 90px, 20px)" },
    })).toBe(true);
    expect(capturedSvg).toContain('M 20 10 H 180');
    expect(capturedSvg).toContain('V 90');
    expect(capturedSvg).toContain('H 20');
    expect(node.children[0].name).toBe("__css-legacy-clip-mask");
    expect(node.children[0].isMask).toBe(true);
    expect(node.clipsContent).toBe(true);
  });

  it("rejects unsafe or malformed CSS path clip-path data", () => {
    const context = loadPluginFunctions();
    expect(context.clipPathMaskSvg("path('M 0 0; <script>alert(1)</script>')", 120, 60)).toBeNull();
    expect(context.clipPathMaskSvg("path(M 0 0 L 10 10)", 120, 60)).toBeNull();
  });

  it("imports polygon clip-paths as an editable absolute vector mask", () => {
    const context = loadPluginFunctions();
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(120, 60);
    const applied = context.applyClipPath(node, {
      rect: { width: 120, height: 60 },
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 50% 100%)" },
    });
    expect(applied).toBe(true);
    expect(capturedSvg).toContain("M 0 0 L 120 0 L 60 60 Z");
    expect(node.children[0].name).toBe("__css-clip-path-mask");
    expect(node.children[0].isMask).toBe(true);
    expect(node.children[0].layoutPositioning).toBe("ABSOLUTE");
    expect(node.clipsContent).toBe(true);
  });

  it("creates an absolute visual fallback for a clipped SVG vector while keeping the source editable", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const vector = mockFigmaNode("VECTOR");
    vector.resize(120, 60);
    parent.appendChild(vector);
    const created = [];
    context.figma.createNodeFromSvg = svg => {
      const fallback = mockFigmaNode("VECTOR");
      fallback.svg = svg;
      created.push(fallback);
      return fallback;
    };
    const scene = {
      id: "clipped-svg-vector",
      type: "vector",
      svg: '<svg width="120" height="60"><path d="M0 0H120V60H0Z"/></svg>',
      rect: { width: 120, height: 60 },
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 50% 100%)" },
    };
    const report = importReport();

    expect(context.createVectorClipPathFallback(vector, scene, report)).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].svg).toContain('clip-path="url(#cssVectorClipPath)"');
    expect(created[0].svg).not.toContain('<svg width="120" height="60"><path');
    expect(created[0].name).toBe("__css-vector-clip-path-clipped-svg-vector");
    expect(created[0].layoutPositioning).toBe("ABSOLUTE");
    expect(created[0].layoutSizingHorizontal).toBe("FIXED");
    expect(created[0].layoutSizingVertical).toBe("FIXED");
    expect(parent.children).toEqual([vector, created[0]]);
    expect(vector.opacity).toBe(0);
    expect(created[0].getPluginData("open-canvas-vector-clip-path-owner")).toBe("clipped-svg-vector");
    expect(report.vectorClipPathFallbacks).toBe(1);
  });

  it("keeps the source SVG visible when a vector clip fallback cannot be parsed", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const vector = mockFigmaNode("VECTOR");
    parent.appendChild(vector);
    context.figma.createNodeFromSvg = () => { throw new Error("invalid SVG"); };
    const scene = {
      id: "failed-clipped-svg-vector",
      type: "vector",
      svg: "<svg><path/></svg>",
      rect: { width: 120, height: 60 },
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 50% 100%)" },
    };
    const report = importReport();

    expect(context.createVectorClipPathFallback(vector, scene, report)).toBe(false);
    expect(vector.opacity).toBe(1);
    expect(parent.children).toEqual([vector]);
    context.recordSceneDegradations(scene, report, [], vector);
    expect(report.styleDegradationNodes).toContainEqual(expect.objectContaining({
      id: "failed-clipped-svg-vector",
      message: expect.stringContaining("vector clip-path"),
    }));
  });

  it("rebuilds a vector clip fallback when the captured box changes and restores opacity when removed", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const vector = mockFigmaNode("VECTOR");
    vector.resize(120, 60);
    parent.appendChild(vector);
    const created = [];
    context.figma.createNodeFromSvg = svg => {
      const fallback = mockFigmaNode("VECTOR");
      fallback.svg = svg;
      created.push(fallback);
      return fallback;
    };
    const scene = {
      id: "resizing-clipped-svg-vector",
      type: "vector",
      svg: '<svg><path d="M0 0H120V60H0Z"/></svg>',
      rect: { width: 120, height: 60 },
      computedStyles: { clipPath: "inset(4px 8px)" },
    };
    const report = importReport();

    expect(context.createVectorClipPathFallback(vector, scene, report)).toBe(true);
    vector.resize(180, 80);
    scene.rect = { width: 180, height: 80 };
    expect(context.createVectorClipPathFallback(vector, scene, report)).toBe(true);
    expect(created).toHaveLength(2);
    expect(parent.children.filter(child => child.name.startsWith("__css-vector-clip-path"))).toHaveLength(1);
    expect(created[0].getPluginData("open-canvas-vector-clip-path-signature")).not.toBe(
      created[1].getPluginData("open-canvas-vector-clip-path-signature"),
    );

    scene.computedStyles.clipPath = "none";
    context.figma.createNodeFromSvg = undefined;
    context.createVectorClipPathFallback(vector, scene, report);
    expect(parent.children).toEqual([vector]);
    expect(vector.opacity).toBe(1);
  });

  it("does not report a complex vector clip-path when its visual fallback exists", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const vector = mockFigmaNode("VECTOR");
    vector.resize(120, 60);
    parent.appendChild(vector);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const scene = {
      id: "diagnosed-clipped-svg-vector",
      type: "vector",
      svg: "<svg><path/></svg>",
      rect: { width: 120, height: 60 },
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 50% 100%)" },
    };
    const report = importReport();
    expect(context.createVectorClipPathFallback(vector, scene, report)).toBe(true);
    context.recordSceneDegradations(scene, report, [], vector);
    expect(report.styleDegradationNodes.some(entry => String(entry.message).includes("clip-path polygon"))).toBe(false);
  });

  it("clips a solid frame background with the same complex clip-path geometry", () => {
    const context = loadPluginFunctions();
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      svgs.push(svg);
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(120, 60);
    node.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    const scene = {
      id: "polygon-background",
      type: "frame",
      rect: { width: 120, height: 60 },
      fill: { color: "#ff0000" },
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 50% 100%)" },
    };
    expect(context.applyClipPath(node, scene)).toBe(true);
    expect(node.children.map(child => child.name)).toEqual([
      "__css-clip-path-mask",
      "__css-clip-path-background-polygon-background",
    ]);
    expect(node.fills).toEqual([]);
    expect(svgs).toHaveLength(2);
    expect(svgs[1]).toContain("clip-path=\"url(#cssClipPathBackground)\"");
    expect(svgs[1]).toContain("fill=\"#ff0000\"");
  });

  it("keeps native fills for clip-path backgrounds that are not solid-only", () => {
    const context = loadPluginFunctions();
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const node = mockFigmaNode("FRAME");
    node.resize(120, 60);
    node.fills = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }];
    const scene = {
      id: "gradient-background",
      type: "frame",
      rect: { width: 120, height: 60 },
      fill: { color: "#ff0000" },
      gradient: "linear-gradient(90deg, #f00, #00f)",
      computedStyles: { clipPath: "polygon(0 0, 100% 0, 50% 100%)" },
    };
    expect(context.applyClipPath(node, scene)).toBe(true);
    expect(node.children.map(child => child.name)).toEqual(["__css-clip-path-mask"]);
    expect(node.fills).toEqual([{ type: "SOLID", color: { r: 1, g: 0, b: 0 } }]);
  });

  it("preserves polygon clip-path fill rules for self-intersecting shapes", () => {
    const context = loadPluginFunctions();
    const svg = context.clipPathMaskSvg(
      "polygon(evenodd, 0 0, 100% 100%, 0 100%, 100% 0)",
      120,
      80,
    );
    expect(svg).toContain('fill-rule="evenodd"');
    expect(svg).toContain('d="M 0 0 L 120 80 L 0 80 L 120 0 Z"');
    const report = importReport();
    context.recordSceneDegradations({
      id: "evenodd-polygon",
      type: "frame",
      rect: { width: 120, height: 80 },
      computedStyles: { clipPath: "polygon(evenodd, 0 0, 100% 100%, 0 100%, 100% 0)" },
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("imports CSS shape clip-paths with polygonal line commands", () => {
    const context = loadPluginFunctions();
    const svg = context.clipPathMaskSvg(
      "shape(from 0 0, line to 100% 0, line to 75% 100%, line to 0 100%, close)",
      120,
      80,
    );
    expect(svg).toContain('<path d="M 0 0 L 120 0 L 90 80 L 0 80 Z"');
    const report = importReport();
    context.recordSceneDegradations({
      id: "shape-card",
      type: "frame",
      rect: { width: 120, height: 80 },
      computedStyles: { clipPath: "shape(from 0 0, line to 100% 0, line to 75% 100%, line to 0 100%, close)" },
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("keeps unsupported CSS shape commands on the degradation path", () => {
    const context = loadPluginFunctions();
    expect(context.clipPathMaskSvg("shape(from 0 0, curve to 100% 0)", 120, 80)).toBeNull();
  });

  it("supports circular and inset clip-path masks without a degradation report", () => {
    const context = loadPluginFunctions();
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const node = mockFigmaNode("FRAME");
    node.resize(100, 80);
    expect(context.applyClipPath(node, {
      rect: { width: 100, height: 80 },
      computedStyles: { clipPath: "circle(30px at 25% 50%)" },
    })).toBe(true);
    const report = importReport();
    context.recordSceneDegradations({
      id: "circle-card",
      type: "frame",
      rect: { width: 100, height: 80 },
      computedStyles: { clipPath: "ellipse(40px 20px at 50% 50%)" },
    }, report);
    expect(report.styleDegradations).toBe(0);
    expect(context.clipPathMaskSvg("inset(4px 8px round 12px)", 100, 80)).toContain("M 20 4");
  });

  it("resolves font-relative and functional clip-path lengths with the captured context", () => {
    const context = loadPluginFunctions();
    const scene = {
      rect: { width: 200, height: 100 },
      rootFontSize: 16,
      viewportWidth: 1000,
      viewportHeight: 800,
      text: { fontSize: 20 },
      computedStyles: { fontSize: "20px" },
    };

    const inset = context.clipPathMaskSvg("inset(1em 2px round 0.5em)", 200, 100, scene);
    expect(inset).toContain('d="M 12 20 H 188 A 10 10');
    expect(inset).toContain("V 70");

    const circle = context.clipPathMaskSvg("circle(calc(10px + 0.5em) at 50% 50%)", 200, 100, scene);
    expect(circle).toContain('<circle cx="100" cy="50" r="20"');

    const polygon = context.clipPathMaskSvg("polygon(10% 1rem, 90% 2em, 50% 100%)", 200, 100, scene);
    expect(polygon).toContain('d="M 20 16 L 180 40 L 100 100 Z"');
    expect(context.clipPathMaskSvg("circle(10px-invalid at 50% 50%)", 200, 100, scene)).toBeNull();
  });

  it("resolves legacy clip rect relative units and calc expressions", () => {
    const context = loadPluginFunctions();
    const scene = {
      rect: { width: 200, height: 100 },
      rootFontSize: 16,
      text: { fontSize: 20 },
      computedStyles: {
        fontSize: "20px",
        clip: "rect(1em, 100%, calc(100% - 0.5em), 0)",
      },
    };

    expect(context.legacyClipInsetValue(scene, 200, 100)).toBe("inset(20px 0px 10px 0px)");
  });

  it("imports rect and xywh clip paths as editable vector masks", () => {
    const context = loadPluginFunctions();
    const rect = context.clipPathMaskSvg("rect(10% 90% 75% 5% round 8px)", 200, 100);
    const xywh = context.clipPathMaskSvg("xywh(10px 20% 50% 40px round 10% 20%)", 200, 100);

    expect(rect).toContain('d="M 18 10 H 172 A 8 8');
    expect(rect).toContain("V 67");
    expect(context.clipPathMaskSvg("rect(10px, 90px, 75px, 5px)", 200, 100)).toContain('d="M 5 10 H 90');
    expect(xywh).toContain('d="M 14 20 H 102 A 8 8');
    expect(xywh).toContain("V 56");

    const report = importReport();
    context.recordSceneDegradations({
      id: "xywh-clipped-card",
      type: "frame",
      rect: { width: 200, height: 100 },
      computedStyles: { clipPath: "xywh(10px 20% 50% 40px round 10% 20%)" },
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("rejects inverted rect and non-positive xywh clip paths", () => {
    const context = loadPluginFunctions();
    expect(context.clipPathMaskSvg("rect(10px 20px 40px 30px)", 100, 80)).toBeNull();
    expect(context.clipPathMaskSvg("xywh(10px 10px 0 40px)", 100, 80)).toBeNull();
  });

  it("resolves clip-path reference boxes before creating the mask geometry", () => {
    const context = loadPluginFunctions();
    const scene = {
      borders: [
        { width: 4 }, { width: 6 }, { width: 4 }, { width: 6 },
      ],
      layout: { padding: [8, 10, 8, 10] },
    };
    const svg = context.clipPathMaskSvg("xywh(0 0 100% 100% round 12px) padding-box", 200, 100, scene);
    expect(svg).toContain('transform="translate(6 4)"');
    expect(svg).toContain('d="M 12 0 H 176');
    expect(svg).toContain('width="200" height="100"');

    const content = context.clipPathMaskSvg("inset(0 round 4px) content-box", 200, 100, scene);
    expect(content).toContain('transform="translate(16 12)"');
    expect(content).toContain('d="M 4 0 H 164');

    const report = importReport();
    context.recordSceneDegradations({
      id: "content-box-clipped-card",
      type: "frame",
      rect: { width: 200, height: 100 },
      computedStyles: { clipPath: "inset(0 round 4px) content-box" },
      ...scene,
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("supports geometry-box clip paths without reporting a false degradation", () => {
    const context = loadPluginFunctions();
    let capturedSvg = "";
    context.figma.createNodeFromSvg = value => {
      capturedSvg = value;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(200, 100);
    const scene = {
      type: "frame",
      rect: { width: 200, height: 100 },
      borders: [{ width: 4 }, { width: 6 }, { width: 4 }, { width: 6 }],
      layout: { padding: [8, 10, 8, 10] },
      computedStyles: { clipPath: "content-box" },
    };
    expect(context.applyClipPath(node, scene)).toBe(true);
    expect(node.clipsContent).toBe(true);
    expect(node.children[0].name).toBe("__css-clip-path-mask");
    expect(node.children[0].layoutPositioning).toBe("ABSOLUTE");
    expect(capturedSvg).toContain('d="M 16 12 H 184');

    const report = importReport();
    context.recordSceneDegradations(scene, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("keeps clipped text visible with an editable TextNode and an SVG clip fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "Clipped\ncopy";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    const scene = {
      id: "clipped-text",
      type: "text",
      rect: { x: 4, y: 8, width: 120, height: 48 },
      textRect: { x: 0, y: 0, width: 120, height: 48 },
      computedStyles: { clipPath: "inset(0 12px round 8px)" },
      text: {
        content: "Clipped\ncopy",
        lineCount: 2,
        lineHeight: 24,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "left",
      },
    };

    const degradationReport = importReport();
    context.recordSceneDegradations(scene, degradationReport);
    expect(degradationReport.styleDegradations).toBe(0);

    context.verifySceneTextStyling(scene, node, report);

    const fallback = parent.children.find(child => child.name === "__css-text-clip-path-clipped-text");
    expect(fallback).toBeTruthy();
    expect(fallback?.layoutPositioning).toBe("ABSOLUTE");
    expect(fallback?.getPluginData("open-canvas-text-shaping-owner")).toBe("clipped-text");
    expect(node.opacity).toBe(0);
    expect(capturedSvg).toContain("<clipPath id=\"cssTextClip\">");
    expect(capturedSvg).toContain("clip-path=\"url(#cssTextClip)\"");
    expect(report.clipPathFallbacks).toBe(1);

    const cleanScene = { ...scene, computedStyles: { clipPath: "none" } };
    context.verifySceneTextStyling(cleanScene, node, report);
    expect(parent.children.some(child => child.name === "__css-text-clip-path-clipped-text")).toBe(false);
    expect(node.opacity).toBe(1);
  });

  it("keeps gradient-masked text visible with an editable TextNode and an SVG mask fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "Masked\ncopy";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    const scene = {
      id: "masked-text",
      type: "text",
      rect: { x: 0, y: 0, width: 140, height: 48 },
      textRect: { x: 0, y: 0, width: 140, height: 48 },
      computedStyles: {
        maskImage: "linear-gradient(90deg, #000 0%, transparent 100%)",
        maskMode: "alpha",
      },
      text: {
        content: "Masked\ncopy",
        lineCount: 2,
        lineHeight: 24,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "left",
      },
    };

    const degradationReport = importReport();
    context.recordSceneDegradations(scene, degradationReport);
    expect(degradationReport.styleDegradations).toBe(0);

    context.verifySceneTextStyling(scene, node, report);

    const fallback = parent.children.find(child => child.name === "__css-text-mask-image-masked-text");
    expect(fallback).toBeTruthy();
    expect(node.opacity).toBe(0);
    expect(capturedSvg).toContain("<mask id=\"cssTextMask\"");
    expect(capturedSvg).toContain("mask=\"url(#cssTextMask)\"");
    expect(report.maskImageFallbacks).toBe(1);

    const cleanScene = { ...scene, computedStyles: { maskImage: "none" } };
    context.verifySceneTextStyling(cleanScene, node, report);
    expect(parent.children.some(child => child.name === "__css-text-mask-image-masked-text")).toBe(false);
    expect(node.opacity).toBe(1);
    expect(node.getPluginData("open-canvas-text-mask-image-fallback")).toBe("");
    expect(report.maskImageFallbacks).toBe(0);
  });

  it("keeps an inlined URL-masked text layer visible with an SVG mask fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "URL\nmasked copy";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "url-masked-text",
      type: "text",
      rect: { x: 0, y: 0, width: 140, height: 48 },
      textRect: { x: 0, y: 0, width: 140, height: 48 },
      computedStyles: {
        maskImage: "url(https://example.test/text-mask.png)",
        maskMode: "alpha",
        maskSize: "80px 40px",
        maskPosition: "right 10px bottom 5px",
        maskRepeat: "no-repeat",
      },
      text: {
        content: "URL\nmasked copy",
        lineCount: 2,
        lineHeight: 24,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "left",
      },
    };
    const asset = {
      id: "text-mask-asset",
      src: "https://example.test/text-mask.png",
      data: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    };
    const degradationReport = importReport();
    context.recordSceneDegradations(scene, degradationReport, [asset]);
    expect(degradationReport.styleDegradations).toBe(0);

    const report = importReport();
    context.verifySceneTextStyling(scene, node, report, [asset]);

    const fallback = parent.children.find(child => child.name === "__css-text-mask-image-url-masked-text");
    expect(fallback).toBeTruthy();
    expect(node.opacity).toBe(0);
    expect(capturedSvg).toContain("<image");
    expect(capturedSvg).toContain("cssMaskClip");
    expect(report.maskImageFallbacks).toBe(1);
  });

  it("keeps filtered text visible with an editable TextNode and an SVG filter fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "Filtered";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    const scene = {
      id: "filtered-text",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      textRect: { x: 0, y: 0, width: 120, height: 24 },
      filter: "grayscale(100%) contrast(120%) hue-rotate(20deg)",
      text: {
        content: "Filtered",
        lineCount: 1,
        lineHeight: 24,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "left",
      },
    };

    context.verifySceneTextStyling(scene, node, report);

    const fallback = parent.children.find(child => child.name === "__css-text-filter-filtered-text");
    expect(fallback).toBeTruthy();
    expect(node.opacity).toBe(0);
    expect(capturedSvg).toContain("<filter id=\"cssTextFilter\"");
    expect(capturedSvg).toContain("filter=\"url(#cssTextFilter)\"");
    expect(report.textFilterFallbacks).toBe(1);

    const cleanScene = { ...scene, filter: "none" };
    context.verifySceneTextStyling(cleanScene, node, report);
    expect(parent.children.some(child => child.name === "__css-text-filter-filtered-text")).toBe(false);
    expect(node.opacity).toBe(1);
    expect(node.getPluginData("open-canvas-text-filter-fallback")).toBe("");
    expect(report.textFilterFallbacks).toBe(0);
  });

  it("preserves justified spacing on non-final SVG text fallback lines", () => {
    const context = loadPluginFunctions();
    const scene = {
      text: { textAlign: "justified" },
      textRect: { x: 4 },
    };
    const firstLine = context.textFallbackLineAttributes(scene, "A longer line", 0, 2, { width: 160 }, 12, 0);
    const lastLine = context.textFallbackLineAttributes(scene, "Last line", 1, 2, { width: 160 }, 12, 0);
    expect(firstLine).toContain('x="8"');
    expect(firstLine).toContain('textLength="160"');
    expect(firstLine).toContain('lengthAdjust="spacingAndGlyphs"');
    expect(lastLine).toBe('x="8"');
  });

  it("anchors the final justified RTL line to the inline-start edge", () => {
    const context = loadPluginFunctions();
    const line = context.textFallbackLineAttributes({
      computedStyles: { direction: "rtl" },
      text: { textAlign: "justified", textAlignLast: "auto" },
      textRect: { x: 4 },
    }, "آخر سطر", 1, 2, { width: 160 }, 12, 0, 160);

    expect(line).toBe('x="168"');
  });

  it("anchors measured center and right fallback lines by their measured width", () => {
    const context = loadPluginFunctions();
    const center = context.textFallbackLineAttributes(
      { text: { textAlign: "center" }, textRect: { x: 4 } },
      "Short",
      0,
      1,
      { width: 160 },
      12,
      80,
      40,
    );
    const right = context.textFallbackLineAttributes(
      { text: { textAlign: "right" }, textRect: { x: 4 } },
      "Short",
      0,
      1,
      { width: 160 },
      12,
      160,
      40,
    );
    expect(center).toBe('x="28"');
    expect(right).toBe('x="48"');
  });

  it("uses measured line origins for SVG fallback baselines", () => {
    const context = loadPluginFunctions();

    // The line rectangles are relative to the source element, while the SVG
    // fallback starts at the captured glyph/textRect origin.
    expect(context.textFallbackBaseline(
      { textRect: { y: 6 } },
      1,
      16,
      24,
      30,
    )).toBe(40);
    expect(context.textFallbackBaseline(
      { textRect: { y: 6 } },
      1,
      16,
      24,
      undefined,
    )).toBe(40);
  });

  it("passes measured line origins through the line-height SVG fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const scene = {
      id: "measured-fallback-baseline",
      type: "text",
      rect: { x: 0, y: 0, width: 140, height: 58 },
      textRect: { x: 0, y: 6, width: 140, height: 52 },
      textLineRects: [
        { x: 0, y: 6, width: 80, height: 16 },
        { x: 0, y: 38, width: 82, height: 16 },
      ],
      text: { content: "First\nSecond", lineCount: 2, lineHeight: 24, fontSize: 16 },
    };
    const report = importReport();
    context.createLineHeightVisualFallback(node, scene, report);

    // The second line uses 38 - textRect.y(6) + fontSize(16), rather than
    // the old uniform second-line baseline of 40px.
    expect(capturedSvg).toContain('y="48"');
  });

  it("parses CSS font and line-height strings in the visual fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };

    const scene = {
      id: "css-string-line-height-fallback",
      type: "text",
      rect: { x: 0, y: 0, width: 140, height: 56 },
      textRect: { x: 0, y: 0, width: 140, height: 56 },
      computedStyles: { fontSize: "16px", lineHeight: "28px" },
      text: { content: "First\nSecond", lineCount: 2, fontSize: "16px", lineHeight: "28px" },
    };

    expect(context.createLineHeightVisualFallback(node, scene, importReport())).toBe(true);
    expect(capturedSvg).toContain('font-size="16px"');
    expect(capturedSvg).toContain('y="44"');
    expect(capturedSvg).not.toContain("NaN");
  });

  it("does not claim a clip-path is applied to a non-container node", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "clipped-image",
      type: "image",
      rect: { width: 100, height: 80 },
      computedStyles: { clipPath: "circle(30px at 50% 50%)" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("clip-path");
  });


  it("uses a gradient resolved on a non-top border side", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 40);
    node.strokeTopWeight = 0;
    node.strokeRightWeight = 0;
    node.strokeBottomWeight = 0;
    node.strokeLeftWeight = 0;
    context.visuals(node, {
      type: "frame",
      radius: [0, 0, 0, 0],
      borders: [
        { color: "rgba(0, 0, 0, 0)", width: 1, style: "solid" },
        { color: "rgba(0, 0, 0, 0)", width: 1, style: "solid", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
        undefined,
        undefined,
      ],
    });
    expect(node.strokes).toHaveLength(1);
    expect(node.strokes[0].type).toBe("GRADIENT_LINEAR");
    expect(node.strokes[0].gradientStops).toHaveLength(2);
  });

  it("uses one rounded editable vector for uniform outset borders when SVG is available", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    context.figma.createNodeFromSvg = svg => {
      expect(svg).toContain('fill-rule="evenodd"');
      expect(svg).toContain('clip-path="url(#top)"');
      return mockFigmaNode("VECTOR");
    };
    context.figma.createRectangle = () => {
      throw new Error("rounded vector should be preferred");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [16, 16, 16, 16],
      borders: [
        { color: "rgb(58, 0, 26)", width: 2, style: "outset" },
        { color: "rgb(58, 0, 26)", width: 2, style: "outset" },
        { color: "rgb(58, 0, 26)", width: 2, style: "outset" },
        { color: "rgb(58, 0, 26)", width: 2, style: "outset" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-rounded");
  });

  it("preserves elliptical radii and non-overlapping joins on shaded borders", () => {
    const context = loadPluginFunctions();
    let svg = "";
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 80);
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 80 },
      radius: [18, 18, 18, 18],
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      borders: [0, 1, 2, 3].map(() => ({ color: "rgb(58, 60, 64)", width: 4, style: "inset" })),
    });

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-rounded");
    expect(svg).toContain("A 18 10");
    expect(svg).toContain("A 14 6");
    expect(svg).toContain('<clipPath id="top"><polygon points="0,0 120,0 116,4 4,4"');
    expect(svg).toContain('clip-path="url(#right)"');
  });

  it("uses two shaded vector rings for uniform ridge and groove borders", () => {
    const context = loadPluginFunctions();
    for (const style of ["ridge", "groove"]) {
      let svg = "";
      const parent = mockFigmaNode("FRAME");
      parent.resize(120, 80);
      context.figma.createNodeFromSvg = value => {
        svg = value;
        return mockFigmaNode("VECTOR");
      };
      const scene = {
        id: `uniform-${style}-border`,
        rect: { width: 120, height: 80 },
        radius: [18, 18, 18, 18],
        computedStyles: {
          borderTopLeftRadius: "18px 10px",
          borderTopRightRadius: "18px 10px",
          borderBottomRightRadius: "18px 10px",
          borderBottomLeftRadius: "18px 10px",
        },
        borders: [0, 1, 2, 3].map(() => ({
          color: "rgb(100, 100, 100)",
          width: 6,
          style,
        })),
      };
      context.createBorderDecorations(parent, scene);

      expect(parent.children).toHaveLength(1);
      expect(parent.children[0].name).toBe("__css-border-relief");
      expect(svg.match(/fill-rule="evenodd"/g)).toHaveLength(8);
      expect(svg).toContain("A 18 10");
      expect(svg).toContain("A 15 7");
      expect(svg).toContain('clip-path="url(#outlineTop)"');
      expect(svg).toContain('clip-path="url(#outlineBottom)"');

      const report = importReport();
      context.recordSceneDegradations(scene, report, [], parent);
      expect(report.styleDegradations).toBe(0);
    }
  });

  it("uses one vector to preserve asymmetric gradient border widths", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    context.figma.createNodeFromSvg = svg => {
      expect(svg).toContain("linearGradient");
      expect(svg).toContain('fill-rule="evenodd"');
      // The inner path starts at the captured left/top widths, so unequal
      // sides are represented by the vector geometry rather than a unified
      // Figma stroke weight.
      expect(svg).toContain("M 12 2");
      return mockFigmaNode("VECTOR");
    };
    context.figma.createRectangle = () => {
      throw new Error("gradient border should use one vector");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [12, 12, 12, 12],
      borders: [
        { color: "transparent", width: 2, style: "solid", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
        { color: "transparent", width: 3, style: "solid", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
        { color: "transparent", width: 4, style: "solid", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
        { color: "transparent", width: 5, style: "solid", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
  });

  it("preserves elliptical radii on asymmetric gradient border vectors", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const gradient = "linear-gradient(90deg, #ff0000, #0000ff)";
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [18, 18, 18, 18],
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      borders: [
        { color: "transparent", width: 2, style: "solid", gradient, paintOutset: 3 },
        { color: "transparent", width: 3, style: "solid", gradient, paintOutset: 5 },
        { color: "transparent", width: 4, style: "solid", gradient, paintOutset: 7 },
        { color: "transparent", width: 5, style: "solid", gradient, paintOutset: 11 },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
    expect(svg).toContain("A 29 13");
    expect(svg).toContain("A 13 6");
  });

  it("uses clipped angular sectors for asymmetric conic border widths", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const gradient = "conic-gradient(from 45deg, #f00 0deg, #00f 180deg, #f00 360deg)";
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "transparent", width: 2, style: "solid", gradient },
        { color: "transparent", width: 3, style: "solid", gradient },
        { color: "transparent", width: 4, style: "solid", gradient },
        { color: "transparent", width: 5, style: "solid", gradient },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
    expect(capturedSvg).toContain("cssBorderConicClip");
    expect(capturedSvg).toContain("<path");
  });

  it("keeps conic gradient sectors in the expanded border-image outset space", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const gradient = "conic-gradient(from 45deg, #f00 0deg, #00f 180deg, #f00 360deg)";
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "transparent", width: 2, paintOutset: 6, style: "solid", gradient },
        { color: "transparent", width: 2, paintOutset: 6, style: "solid", gradient },
        { color: "transparent", width: 2, paintOutset: 6, style: "solid", gradient },
        { color: "transparent", width: 2, paintOutset: 6, style: "solid", gradient },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
    expect(parent.children[0].x).toBe(-6);
    expect(parent.children[0].y).toBe(-6);
    expect(capturedSvg).toContain('width="132" height="72" viewBox="0 0 132 72"');
    // The conic center must be derived from the expanded vector, not the
    // original 120x60 box (which would produce 60,30 and visibly shift the
    // paint relative to the outer ring).
    expect(capturedSvg).toContain("M 66 36");
  });

  it("uses a vector fallback for uniform repeating gradient borders", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    context.figma.createNodeFromSvg = svg => {
      expect(svg).toContain('spreadMethod="repeat"');
      return mockFigmaNode("VECTOR");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "transparent", width: 2, style: "solid", gradient: "repeating-linear-gradient(35deg, #f00 0px, #00f 12px)" },
        { color: "transparent", width: 2, style: "solid", gradient: "repeating-linear-gradient(35deg, #f00 0px, #00f 12px)" },
        { color: "transparent", width: 2, style: "solid", gradient: "repeating-linear-gradient(35deg, #f00 0px, #00f 12px)" },
        { color: "transparent", width: 2, style: "solid", gradient: "repeating-linear-gradient(35deg, #f00 0px, #00f 12px)" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
  });

  it("renders repeating conic borders as clipped editable sectors", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 60);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const gradient = "repeating-conic-gradient(from 20deg, #f00 0deg, #00f 90deg)";
    const scene = {
      type: "frame",
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "#111111", width: 2, style: "solid", gradient },
        { color: "#111111", width: 2, style: "solid", gradient },
        { color: "#111111", width: 2, style: "solid", gradient },
        { color: "#111111", width: 2, style: "solid", gradient },
      ],
    };

    context.visuals(node, scene);
    expect(node.strokes).toHaveLength(1);
    expect(node.strokes[0].type).toBe("SOLID");
    context.createBorderDecorations(node, scene);
    expect(node.strokes).toEqual([]);
    expect(node.children).toHaveLength(1);
    expect(node.children[0].name).toBe("__css-border-gradient");
    expect(capturedSvg).toContain("cssBorderConicClip");
    expect((capturedSvg.match(/<path/g) || []).length).toBeGreaterThan(100);
  });

  it("does not cover a complex gradient border with solid decorations", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    context.figma.createNodeFromSvg = svg => {
      expect(svg).toContain("linearGradient");
      return mockFigmaNode("VECTOR");
    };
    context.figma.createRectangle = () => {
      throw new Error("gradient fallback should not create solid side layers");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [8, 8, 8, 8],
      borders: [
        { color: "transparent", width: 2, style: "double", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
        { color: "transparent", width: 2, style: "double", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
        { color: "transparent", width: 2, style: "double", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
        { color: "transparent", width: 2, style: "double", gradient: "linear-gradient(90deg, #ff0000, #0000ff)" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-gradient");
  });

  it("keeps the native gradient stroke when the complex SVG border fallback fails", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 60);
    const nativeGradient = [{
      type: "GRADIENT_LINEAR",
      gradientStops: [
        { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
        { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
      ],
    }];
    parent.strokes = nativeGradient;
    context.figma.createNodeFromSvg = () => {
      throw new Error("complex border SVG rejected");
    };
    context.figma.createRectangle = () => {
      throw new Error("gradient border must not degrade to solid rectangles");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 60 },
      radius: [12, 12, 12, 12],
      borders: [0, 1, 2, 3].map(() => ({
        color: "transparent",
        width: 2,
        style: "double",
        gradient: "linear-gradient(90deg, #ff0000, #0000ff)",
      })),
    });
    expect(parent.children).toHaveLength(0);
    expect(parent.strokes).toBe(nativeGradient);
  });

  it("normalizes CSS font-weight keywords before font resolution", () => {
    const context = loadPluginFunctions();
    expect(context.fontWeightValue("bold")).toBe(700);
    expect(context.fontWeightValue("normal")).toBe(400);
    expect(context.fontWeightValue("600")).toBe(600);
  });

  it("keeps asymmetric solid border widths and colors on separate sides", () => {
    const context = loadPluginFunctions();
    context.figma.createRectangle = () => ({
      fills: [],
      strokes: [],
      x: 0,
      y: 0,
      resize(width, height) {
        this.width = width;
        this.height = height;
      },
    });
    const parent = {
      width: 120,
      height: 40,
      children: [],
      appendChild(child) {
        this.children.push(child);
      },
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 40 },
      borders: [
        { color: "rgb(255, 0, 0)", width: 1, style: "solid" },
        { color: "rgb(0, 255, 0)", width: 3, style: "solid" },
        { color: "rgb(0, 0, 255)", width: 2, style: "solid" },
        { color: "rgb(0, 0, 0)", width: 4, style: "solid" },
      ],
    });
    expect(parent.children).toHaveLength(4);
    expect(parent.children.map((child) => child.width)).toEqual([120, 3, 120, 4]);
    expect(parent.children.map((child) => child.fills[0].color)).toEqual([
      { r: 1, g: 0, b: 0 },
      { r: 0, g: 1, b: 0 },
      { r: 0, g: 0, b: 1 },
      { r: 0, g: 0, b: 0 },
    ]);
  });

  it("does not paint CSS hidden borders while preserving visible side widths", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 40);
    node.strokeTopWeight = 0;
    node.strokeRightWeight = 0;
    node.strokeBottomWeight = 0;
    node.strokeLeftWeight = 0;
    context.visuals(node, {
      type: "frame",
      radius: [0, 0, 0, 0],
      borders: [
        { color: "#111111", width: 2, style: "hidden" },
        { color: "#222222", width: 3, style: "solid" },
        { color: "#333333", width: 4, style: "none" },
        { color: "#444444", width: 5, style: "solid" },
      ],
      rect: { width: 120, height: 40 },
    });
    expect(node.strokeTopWeight).toBe(0);
    expect(node.strokeRightWeight).toBe(3);
    expect(node.strokeBottomWeight).toBe(0);
    expect(node.strokeLeftWeight).toBe(5);
    expect(node.strokes).toHaveLength(1);
  });

  it("does not create border decorations when every CSS border side is hidden", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 40);
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 40 },
      borders: [
        { color: "#111111", width: 2, style: "hidden" },
        { color: "#111111", width: 2, style: "none" },
        { color: "#111111", width: 2, style: "hidden" },
        { color: "#111111", width: 2, style: "none" },
      ],
    });
    expect(parent.children).toHaveLength(0);
  });

  it("uses one editable vector when border dash styles differ by side", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 40);
    context.figma.createNodeFromSvg = svg => {
      expect(svg).toContain('stroke-dasharray="6 4"');
      expect(svg).toContain('stroke-dasharray="2 6"');
      return mockFigmaNode("VECTOR");
    };
    context.figma.createRectangle = () => { throw new Error("mixed styles should use the vector fallback"); };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 40 },
      radius: [0, 0, 0, 0],
      borders: [
        { color: "#111111", width: 1, style: "solid" },
        { color: "#111111", width: 1, style: "dashed" },
        { color: "#111111", width: 2, style: "dotted" },
        { color: "#111111", width: 1, style: "solid" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-per-side");
  });

  it("keeps mixed border dash styles around rounded corners", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 40);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 40 },
      radius: [12, 12, 12, 12],
      borders: [
        { color: "#111111", width: 1, style: "solid" },
        { color: "#111111", width: 1, style: "dashed" },
        { color: "#111111", width: 2, style: "dotted" },
        { color: "#111111", width: 1, style: "solid" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-per-side");
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain('stroke-dasharray="2 6"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain("M 0.5 12 A 11.5 11.5");
    expect(svg).not.toContain("M 0 12");
  });

  it("keeps elliptical radii on mixed per-side border SVG paths", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 40);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 40 },
      radius: [18, 18, 18, 18],
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      borders: [
        { color: "#111111", width: 1, style: "solid" },
        { color: "#111111", width: 1, style: "dashed" },
        { color: "#111111", width: 2, style: "dotted" },
        { color: "#111111", width: 1, style: "solid" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-per-side");
    expect(svg).toContain("A 17.5 9.5");
    expect(svg).not.toContain("A 17.5 17.5");
  });

  it("uses the elliptical per-side path for uniform dotted borders", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 40);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 40 },
      radius: [18, 18, 18, 18],
      computedStyles: {
        borderTopLeftRadius: "18px 10px",
        borderTopRightRadius: "18px 10px",
        borderBottomRightRadius: "18px 10px",
        borderBottomLeftRadius: "18px 10px",
      },
      borders: [
        { color: "#111111", width: 2, style: "dotted" },
        { color: "#111111", width: 2, style: "dotted" },
        { color: "#111111", width: 2, style: "dotted" },
        { color: "#111111", width: 2, style: "dotted" },
      ],
    });

    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-per-side");
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain("A 17 9");
  });

  it("uses per-side SVG rhythms when dashed widths differ", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 40);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 40 },
      radius: [0, 0, 0, 0],
      borders: [
        { color: "#111111", width: 1, style: "dashed" },
        { color: "#111111", width: 1, style: "dashed" },
        { color: "#111111", width: 2, style: "dashed" },
        { color: "#111111", width: 1, style: "dashed" },
      ],
    });
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0].name).toBe("__css-border-per-side");
    expect(svg).toContain('stroke-dasharray="6 4"');
    expect(svg).toContain('stroke-dasharray="12 8"');
  });

  it("uses painted widths in per-side SVG border geometry", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 40);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    context.createBorderDecorations(parent, {
      rect: { width: 120, height: 40 },
      radius: [0, 0, 0, 0],
      borders: [
        { color: "#111111", width: 1, paintWidth: 2, style: "solid" },
        { color: "#111111", width: 1, paintWidth: 4, style: "dashed" },
        { color: "#111111", width: 1, paintWidth: 6, style: "dotted" },
        { color: "#111111", width: 1, paintWidth: 8, style: "solid" },
      ],
    });

    expect(parent.children[0].name).toBe("__css-border-per-side");
    expect(svg).toContain('stroke-width="4"');
    expect(svg).toContain('stroke-dasharray="24 16"');
    expect(svg).toContain('stroke-width="6"');
    expect(svg).toContain('stroke-dasharray="6 18"');
    expect(svg).toContain("M 4 40 V 0");
  });

  it("clears Figma's default text fill for transparent CSS text", () => {
    const context = loadPluginFunctions();
    const node = { type: "TEXT", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] };
    context.visuals(node, { type: "text", opacity: 1, radius: [0, 0, 0, 0] });
    expect(node.fills).toEqual([]);
  });

  it("preserves captured pixel line-height on imported text nodes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    context.applySceneLineHeight(node, {
      type: "text",
      text: { lineHeight: 28 },
    });
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
  });

  it("writes line-height after attaching the text node to its parent", async () => {
    const context = loadPluginFunctions();
    const page = mockFigmaNode("PAGE");
    const text = mockFigmaNode("TEXT");
    let stored = { unit: "AUTO", value: 0 };
    Object.defineProperty(text, "lineHeight", {
      configurable: true,
      get: () => stored,
      set: value => {
        // Model Desktop builds that normalize detached writes back to AUTO.
        stored = text.parent ? value : { unit: "AUTO", value: 0 };
      },
    });
    text.characters = "First\nSecond";
    context.figma.createText = () => text;
    context.figma.loadFontAsync = async () => undefined;
    const report = importReport();

    const imported = await context.createNode({
      id: "attached-line-height",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 48 },
      text: { content: "First\nSecond", fontSize: 16, lineHeight: 28, letterSpacing: 0 },
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
    }, page, [], report, undefined, { images: new Map(), vectors: new Map() });

    expect(imported.parent).toBe(page);
    expect(imported.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(report.lineHeightApplied).toBeGreaterThanOrEqual(1);
    expect(report.lineHeightFailures).toBe(0);
  });

  it("restores line-height after text attributes normalize it to AUTO", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    let storedLineHeight = { unit: "AUTO", value: 0 };
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => storedLineHeight,
      set: value => { storedLineHeight = value; },
    });
    let autoResize = "NONE";
    Object.defineProperty(node, "textAutoResize", {
      configurable: true,
      get: () => autoResize,
      set: value => {
        autoResize = value;
        // Model a Desktop build that resets leading when text sizing changes.
        storedLineHeight = { unit: "AUTO", value: 0 };
      },
    });
    node.characters = "First\nSecond";
    const scene = {
      id: "post-attribute-line-height",
      type: "text",
      text: { content: node.characters, fontSize: 16, lineHeight: 28 },
    };
    context.applySceneLineHeight(node, scene, importReport());
    context.applySceneTextAttributes(node, scene);
    expect(node.lineHeight).toEqual({ unit: "AUTO", value: 0 });
    context.verifySceneLineHeights(scene, node, importReport());
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
  });

  it("repairs a character range that reverted to AUTO after the node value stayed pixel-based", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    let rangeValue = { unit: "AUTO", value: 0 };
    node.getRangeLineHeight = () => rangeValue;
    node.setRangeLineHeight = (_start, _end, value) => { rangeValue = value; };
    const report = importReport();

    context.verifySceneLineHeights({
      id: "range-normalized-copy",
      type: "text",
      text: { content: node.characters, lineHeight: 28 },
      children: [],
    }, node, report);

    expect(rangeValue).toEqual({ unit: "PIXELS", value: 28 });
    expect(report.lineHeightFailures).toBe(0);
  });

  it("reports the final line-height state when a later layout pass reverts AUTO", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    let current = { unit: "PIXELS", value: 28 };
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => current,
      set: value => { current = value; },
    });
    node.setRangeLineHeight = (_start, _end, value) => { current = value; };
    node.getRangeLineHeight = () => current;
    const scene = { id: "late-auto-line-height", type: "text", text: { content: node.characters, lineHeight: 28 } };
    const report = importReport();

    context.verifySceneLineHeights(scene, node, report);
    expect(report.lineHeightApplied).toBe(1);
    expect(report.lineHeightFailures).toBe(0);

    current = { unit: "AUTO", value: 0 };
    node.setRangeLineHeight = () => { current = { unit: "AUTO", value: 0 }; };
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    context.verifySceneLineHeights(scene, node, report);
    expect(report.lineHeightApplied).toBe(0);
    expect(report.lineHeightFailures).toBe(1);
    expect(report.lineHeightFailureNodes).toHaveLength(1);
  });

  it("keeps unsupported text shaping visible with an editable SVG fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "123\n456";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    const scene = {
      id: "shaping-fallback-copy",
      type: "text",
      rect: { x: 4, y: 8, width: 120, height: 48 },
      textRect: { x: 0, y: 0, width: 120, height: 48 },
      computedStyles: {
        fontFeatureSettings: '"tnum" 1',
        direction: "rtl",
        fontVariantNumeric: "tabular-nums",
        fontStretch: "75%",
        fontSynthesis: "none",
        textAlignLast: "center",
        textJustify: "inter-character",
        textWrapStyle: "balance",
        textWrapMode: "nowrap",
        whiteSpaceCollapse: "preserve",
        textBoxTrim: "trim-both",
        textBoxEdge: "cap alphabetic",
      },
      text: {
        content: "123\n456",
        lineCount: 2,
        lineHeight: 24,
        fontSize: 16,
        fontFamily: "Inter",
        fontWeight: 400,
        textAlign: "left",
      },
    };

    expect(context.createTextShapingVisualFallback(node, scene, report)).toBe(true);
    const fallback = parent.children.find(child => child.name === "__css-text-shaping-shaping-fallback-copy");
    expect(fallback).toBeTruthy();
    expect(fallback?.layoutPositioning).toBe("ABSOLUTE");
    expect(fallback?.getPluginData("open-canvas-text-shaping-owner")).toBe("shaping-fallback-copy");
    expect(context.sceneChildren(parent)).not.toContain(fallback);
    expect(node.opacity).toBe(0);
    expect(capturedSvg).toContain('font-feature-settings=');
    expect(capturedSvg).toContain('font-synthesis=');
    expect(capturedSvg).toContain('text-align-last=');
    expect(capturedSvg).toContain('text-justify=');
    expect(capturedSvg).toContain('font-variant-numeric=');
    expect(capturedSvg).toContain('text-wrap-style=');
    expect(capturedSvg).toContain('text-wrap-mode=');
    expect(capturedSvg).toContain('white-space-collapse=');
    expect(capturedSvg).toContain('text-box-trim=');
    expect(capturedSvg).toContain('text-box-edge=');
    expect(capturedSvg).toContain('xml:space="preserve"');
    expect(capturedSvg).toContain('direction="rtl"');
    expect(report.textShapingFallbacks).toBe(1);
  });

  it("combines truncation with shaping in one SVG fallback and rebuilds after native recovery", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const node = mockFigmaNode("TEXT");
    node.characters = "1234567890";
    parent.appendChild(node);
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    const scene = {
      id: "combined-truncation-shaping",
      type: "text",
      rect: { x: 0, y: 0, width: 80, height: 20 },
      textRect: { x: 0, y: 0, width: 80, height: 20 },
      computedStyles: { fontFeatureSettings: '"tnum" 1' },
      text: {
        content: node.characters,
        lineCount: 1,
        lineHeight: 20,
        fontSize: 16,
        fontFamily: "Inter",
        textOverflow: "ellipsis",
      },
    };

    expect(context.createTextShapingVisualFallback(node, scene, report)).toBe(true);
    expect(parent.children.filter(child => String(child.name).startsWith("__css-text-overflow-")).length).toBe(0);
    expect(parent.children.filter(child => String(child.name).startsWith("__css-text-shaping-")).length).toBe(1);
    expect(capturedSvg).toContain("&#8230;");
    expect(report.textOverflowFallbacks).toBe(1);

    node.setPluginData("open-canvas-text-overflow-native", "1");
    expect(context.createTextShapingVisualFallback(node, scene, report)).toBe(true);
    expect(capturedSvg).not.toContain("&#8230;");
    expect(report.textOverflowFallbacks).toBe(0);
    expect(parent.children.filter(child => String(child.name).startsWith("__css-text-shaping-")).length).toBe(1);
  });

  it("uses one shaping SVG when line-height and shaping both need a fallback", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "First\nSecond";
    parent.appendChild(node);
    Object.defineProperty(node, "lineHeight", {
      configurable: true,
      get: () => ({ unit: "AUTO", value: 0 }),
      set: () => {},
    });
    node.setRangeLineHeight = () => {};
    node.getRangeLineHeight = () => ({ unit: "AUTO", value: 0 });
    let capturedSvg = "";
    context.figma.createNodeFromSvg = svg => {
      capturedSvg = svg;
      return mockFigmaNode("VECTOR");
    };
    const report = importReport();
    const scene = {
      id: "combined-text-fallback",
      type: "text",
      rect: { x: 0, y: 0, width: 160, height: 56 },
      textRect: { x: 0, y: 0, width: 160, height: 56 },
      computedStyles: { fontFeatureSettings: '"tnum" 1', unicodeBidi: "isolate", direction: "rtl" },
      text: { content: "First\nSecond", lineCount: 2, lineHeight: 28, fontSize: 16, fontFamily: "Inter", fontWeight: 400 },
    };

    expect(context.applySceneLineHeight(node, scene, report)).toBe(false);
    expect(parent.children.filter(child => String(child.name).startsWith("__css-line-height-")).length).toBe(1);
    expect(context.verifySceneTextStyling(scene, node, report)).toBeUndefined();
    expect(parent.children.filter(child => String(child.name).startsWith("__css-line-height-")).length).toBe(0);
    expect(parent.children.filter(child => String(child.name).startsWith("__css-text-shaping-")).length).toBe(1);
    expect(report.lineHeightFallbacks).toBe(0);
    expect(report.textShapingFallbacks).toBe(1);
    expect(node.opacity).toBe(0);
    expect(capturedSvg).toContain('unicode-bidi="isolate"');
    expect(capturedSvg).toContain('direction="rtl"');
  });

  it("does not create a shaping fallback for a natively matched font-stretch", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const node = mockFigmaNode("TEXT");
    node.characters = "Condensed";
    node.setPluginData("open-canvas-font-stretch-native", "75%");
    parent.appendChild(node);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const report = importReport();
    const scene = {
      id: "native-stretch-copy",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 20 },
      computedStyles: { fontStretch: "75%" },
      text: { content: "Condensed", lineCount: 1, lineHeight: 20, fontSize: 16, fontFamily: "Inter", fontWeight: 400 },
    };

    expect(context.createTextShapingVisualFallback(node, scene, report)).toBe(false);
    expect(parent.children).toHaveLength(1);
    expect(report.textShapingFallbacks).toBe(0);
  });

  it("maps subscript and superscript vertical alignment to baseline shift", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.setRangeBaselineShift = (start, end, value) => { node.baselineRange = { start, end, value }; };
    context.applyTextBaselineShift(node, {
      text: { content: "2", fontSize: 16, lineHeight: 20, verticalAlign: "super" },
    });
    expect(node.baselineRange).toEqual({ start: 0, end: 1, value: 5.6 });
    expect(node.getPluginData("open-canvas-baseline-shift-source")).toBe("super");

    const subscript = mockFigmaNode("TEXT");
    context.applyTextBaselineShift(subscript, {
      text: { content: "2", fontSize: 16, lineHeight: 20, verticalAlign: "sub" },
    });
    expect(subscript.getPluginData("open-canvas-baseline-shift")).toBe("-3.2");
  });

  it("clears stale baseline shift when vertical alignment returns to baseline", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.setRangeBaselineShift = (start, end, value) => { node.baselineRange = { start, end, value }; };
    const scene = {
      id: "reused-baseline-copy",
      type: "text",
      text: { content: "2", fontSize: 16, lineHeight: 20, verticalAlign: "super" },
    };

    context.applyTextBaselineShift(node, scene, importReport());
    scene.text.verticalAlign = "baseline";
    context.applyTextBaselineShift(node, scene, importReport());

    expect(node.baselineRange).toEqual({ start: 0, end: 1, value: 0 });
    expect(node.getPluginData("open-canvas-baseline-shift")).toBe("");
    expect(node.getPluginData("open-canvas-baseline-shift-source")).toBe("");
  });

  it("uses the captured line-height for percentage vertical-align even when leading is tighter than the font", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.setRangeBaselineShift = (start, end, value) => {
      node.baselineRange = { start, end, value };
    };

    expect(context.applyTextBaselineShift(node, {
      id: "tight-leading-baseline",
      type: "text",
      text: { content: "x", fontSize: 20, lineHeight: 12, verticalAlign: "50%" },
    }, importReport())).toBe(6);

    expect(node.baselineRange).toEqual({ start: 0, end: 1, value: 6 });
    expect(node.getPluginData("open-canvas-baseline-shift")).toBe("6");
  });

  it("resolves vertical-align length expressions in the captured font context", () => {
    const context = loadPluginFunctions();
    const makeNode = () => {
      const node = mockFigmaNode("TEXT");
      node.setRangeBaselineShift = (start, end, value) => {
        node.baselineRange = { start, end, value };
      };
      return node;
    };

    const em = makeNode();
    expect(context.applyTextBaselineShift(em, {
      id: "em-baseline",
      type: "text",
      text: { content: "x", fontSize: 20, lineHeight: 24, verticalAlign: "0.5em" },
    }, importReport())).toBe(10);
    expect(em.baselineRange.value).toBe(10);

    const rem = makeNode();
    expect(context.applyTextBaselineShift(rem, {
      id: "rem-baseline",
      type: "text",
      rootFontSize: 18,
      text: { content: "x", fontSize: 20, lineHeight: 24, verticalAlign: "1rem" },
    }, importReport())).toBe(18);

    const calc = makeNode();
    expect(context.applyTextBaselineShift(calc, {
      id: "calc-baseline",
      type: "text",
      text: { content: "x", fontSize: 20, lineHeight: 24, verticalAlign: "calc(0.5em - 2px)" },
    }, importReport())).toBe(8);

    const percentageCalc = makeNode();
    expect(context.applyTextBaselineShift(percentageCalc, {
      id: "percentage-calc-baseline",
      type: "text",
      text: { content: "x", fontSize: 20, lineHeight: 24, verticalAlign: "calc(50% - 2px)" },
    }, importReport())).toBe(10);
  });

  it("expands legacy unitless and percentage H2D line-heights", () => {
    const context = loadPluginFunctions();
    expect(context.textLineHeightValue("1.5", 16)).toBe(24);
    expect(context.textLineHeightValue("150%", 16)).toBe(24);
    expect(context.textLineHeightValue("28px", 16)).toBe(28);
    expect(context.textLineHeightValue("1.5em", 16)).toBe(24);
    expect(context.textLineHeightValue("2rem", 12, 20)).toBe(40);
    expect(context.textLineHeightValue("calc(1em + 4px)", 16)).toBe(20);
    expect(context.textLineHeightValue("calc(100% + 4px)", 16)).toBe(20);
    expect(context.textLineHeightValue("calc(150%)", 16)).toBe(24);
    expect(context.textLineHeightValue("calc(1 + 0.5)", 16)).toBe(24);
    expect(context.textLineHeightValue("calc(1.5 / 2)", 16)).toBe(12);
    expect(context.textLineHeightValue("min(28px, 2em)", 16)).toBe(28);
    expect(context.textLineHeightValue("max(20px, 1.5em)", 16)).toBe(24);
    expect(context.textLineHeightValue("clamp(20px, 2em, 40px)", 16)).toBe(32);
    expect(context.textLineHeightValue("min(calc(1em + 8px), 30px)", 16)).toBe(24);
    expect(context.textLineHeightValue("max(20px, calc(1.5em + 2px))", 16)).toBe(26);
    expect(context.textLineHeightValue("clamp(20px, calc(1.5em + 2px), 32px)", 16)).toBe(26);
    expect(context.textLineHeightValue("clamp(calc(1em + 2px), max(1.25em, 24px), calc(2em + 4px))", 16)).toBe(24);
    expect(context.textLineHeightValue("0.5px", 16)).toBe(0.5);
    expect(context.textLineHeightValue("0px", 16)).toBe(0.01);
    expect(context.textLineHeightValue("calc(0.25px + 0.25px)", 16)).toBe(0.5);
    expect(context.textLineHeightValue("min(var(--line-height), 24px)", 16)).toBeCloseTo(19.2, 8);
  });

  it("resolves CSS lh and rlh line-height units in legacy H2D payloads", () => {
    const context = loadPluginFunctions();
    expect(context.textLineHeightValue("2lh", 16)).toBeCloseTo(38.4, 8);
    expect(context.textLineHeightValue("1.5rlh", 16, 20)).toBeCloseTo(36, 8);
    expect(context.textLineHeightValue("calc(1lh + 4px)", 16)).toBeCloseTo(23.2, 8);
    const root = context.sceneFromH2D({
      nodeType: 1,
      id: "rlh-root",
      tag: "DIV",
      styles: { width: "240px", height: "80px", display: "block", fontSize: "20px", lineHeight: "32px" },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [{
        nodeType: 1,
        id: "rlh-child",
        tag: "P",
        styles: { width: "200px", height: "32px", display: "block", fontSize: "16px", lineHeight: "1rlh" },
        rect: { x: 0, y: 0, width: 200, height: 32 },
        childNodes: [{ nodeType: 3, id: "rlh-text", text: "Root leading", rect: { x: 0, y: 0, width: 120, height: 32 }, lineCount: 1 }],
      }],
    }, { x: 0, y: 0 }, 20, "", 16, {}, undefined, 32);
    expect(root.children[0]).toMatchObject({ type: "text", text: { lineHeight: 32 } });
  });

  it("keeps CSS string line-height values from legacy shared scenes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();

    expect(context.applySceneLineHeight(node, {
      id: "legacy-string-copy",
      type: "text",
      text: { fontSize: 16, lineHeight: "24px" },
    }, report)).toBe(true);
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 24 });

    const percentage = mockFigmaNode("TEXT");
    expect(context.applySceneLineHeight(percentage, {
      id: "legacy-percentage-copy",
      type: "text",
      text: { fontSize: 16, lineHeight: "150%" },
    }, importReport())).toBe(true);
    expect(percentage.lineHeight).toEqual({ unit: "PIXELS", value: 24 });
  });

  it("reconstructs kebab-case line-height from a trimmed H2D scene", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "kebab-case-scene-leading",
      tag: "P",
      styles: { display: "block", fontSize: "16px" },
      computedStyles: { display: "block", fontSize: "16px", ["line-height"]: "30px" },
      rect: { x: 0, y: 0, width: 240, height: 60 },
      childNodes: [{
        nodeType: 3,
        id: "kebab-case-scene-leading-text",
        text: "First line\nSecond line",
        rect: { x: 0, y: 0, width: 180, height: 60 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });

    expect(scene).toMatchObject({ type: "text", text: { lineHeight: 30 } });
  });

  it("normalizes kebab-case typography and box styles at the H2D boundary", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "kebab-style-boundary",
      tag: "DIV",
      styles: {
        display: "block",
        ["font-size"]: "18px",
        fontSize: "20px",
        ["padding-top"]: "12px",
        ["padding-right"]: "8px",
        ["padding-bottom"]: "10px",
        ["padding-left"]: "8px",
        ["background-color"]: "rgb(10, 20, 30)",
        ["--brand-color"]: "#102030",
      },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene).toMatchObject({
      computedStyles: {
        fontSize: "20px",
        paddingTop: "12px",
        backgroundColor: "rgb(10, 20, 30)",
        ["--brand-color"]: "#102030",
      },
      layout: { padding: [12, 8, 10, 8] },
    });
  });

  it("normalizes kebab-case values inside compatibility marker maps", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "kebab-marker-boundary",
      tag: "DIV",
      attributes: {
        display: "flex",
        ["data-open-canvas-flex"]: JSON.stringify({
          values: { ["flex-grow"]: "1", ["flex-shrink"]: "0", ["flex-basis"]: "0px" },
        }),
      },
      styles: { display: "flex", flexDirection: "row" },
      rect: { x: 0, y: 0, width: 240, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({ flexGrow: "1", flexShrink: "0", flexBasis: "0px" });
  });

  it("maps logical H2D insets into physical position constraints", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-inset-boundary",
      tag: "DIV",
      styles: {
        display: "block",
        position: "absolute",
        writingMode: "vertical-rl",
        direction: "rtl",
        insetInlineStart: "12px",
        insetBlockEnd: "20px",
      },
      rect: { x: 20, y: 40, width: 80, height: 60 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({ left: "20px", bottom: "12px" });
    const node = mockFigmaNode("FRAME");
    const report = importReport();
    expect(context.applyPositionConstraints(node, scene, report)).toBe(true);
    expect(node.constraints).toEqual({ horizontal: "MIN", vertical: "MAX" });
    expect(report.styleDegradations || 0).toBe(0);
  });

  it("maps logical shared-scene insets when physical aliases are absent", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const report = importReport();
    const scene = {
      id: "logical-shared-inset-boundary",
      positioning: "absolute",
      computedStyles: {
        position: "absolute",
        writingMode: "horizontal-tb",
        direction: "ltr",
        insetInlineStart: "12px",
        insetBlockStart: "8px",
      },
    };
    expect(context.applyPositionConstraints(node, scene, report)).toBe(true);
    expect(node.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(report.styleDegradations || 0).toBe(0);
  });

  it("expands logical and physical inset shorthands before constraint mapping", () => {
    const context = loadPluginFunctions();
    const logicalScene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-inset-shorthand",
      tag: "DIV",
      styles: {
        display: "block",
        position: "absolute",
        writingMode: "vertical-lr",
        insetInline: "8px 16px",
        insetBlock: "20px",
      },
      rect: { x: 0, y: 0, width: 60, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(logicalScene.computedStyles).toMatchObject({ top: "8px", bottom: "16px", left: "20px", right: "20px" });

    const physicalScene = context.sceneFromH2D({
      nodeType: 1,
      id: "physical-inset-shorthand",
      tag: "DIV",
      styles: { display: "block", position: "absolute", inset: "1px 2px 3px 4px" },
      rect: { x: 0, y: 0, width: 60, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(physicalScene.computedStyles).toMatchObject({ top: "1px", right: "2px", bottom: "3px", left: "4px" });
  });

  it("materializes logical padding and margin for vertical RTL writing", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-box-edges",
      tag: "DIV",
      styles: {
        display: "block",
        writingMode: "vertical-rl",
        direction: "rtl",
        paddingInlineStart: "4px",
        paddingInlineEnd: "6px",
        paddingBlockStart: "8px",
        paddingBlockEnd: "10px",
        marginInlineStart: "1px",
        marginInlineEnd: "2px",
        marginBlockStart: "3px",
        marginBlockEnd: "4px",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      paddingTop: "6px",
      paddingRight: "8px",
      paddingBottom: "4px",
      paddingLeft: "10px",
      marginTop: "2px",
      marginRight: "3px",
      marginBottom: "1px",
      marginLeft: "4px",
    });
    expect(scene.layout.padding).toEqual([6, 8, 4, 10]);
    expect(scene.margin).toEqual([2, 3, 1, 4]);
  });

  it("inherits writing direction before expanding nested logical constraints", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-inherited-axis-root",
      tag: "DIV",
      styles: {
        display: "block",
        writingMode: "vertical-rl",
        direction: "rtl",
        width: "180px",
        height: "240px",
      },
      rect: { x: 0, y: 0, width: 180, height: 240 },
      childNodes: [{
        nodeType: 1,
        id: "logical-inherited-axis-child",
        tag: "DIV",
        styles: {
          display: "block",
          inlineSize: "40px",
          paddingInlineStart: "8px",
          borderInlineStart: "2px solid #ff0000",
        },
        rect: { x: 0, y: 0, width: 80, height: 120 },
        childNodes: [],
      }],
    }, { x: 0, y: 0 });

    const child = scene.children[0];
    expect(child.computedStyles).toMatchObject({
      writingMode: "vertical-rl",
      direction: "rtl",
      height: "40px",
      paddingBottom: "8px",
      borderBottomWidth: "2px",
      borderBottomStyle: "solid",
      borderBottomColor: "#ff0000",
    });
    expect(child.layout.padding).toEqual([0, 0, 8, 0]);
  });

  it("expands logical padding and margin shorthands and keeps physical edges authoritative", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-box-shorthand",
      tag: "DIV",
      styles: {
        display: "block",
        direction: "rtl",
        paddingInline: "4px 8px",
        paddingBlock: "6px 10px",
        marginInline: "1px 3px",
        marginBlock: "2px 4px",
        paddingLeft: "20px",
        marginRight: "30px",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.layout.padding).toEqual([6, 4, 10, 20]);
    expect(scene.margin).toEqual([2, 30, 4, 3]);

    const physical = context.sceneFromH2D({
      nodeType: 1,
      id: "physical-box-shorthand",
      tag: "DIV",
      styles: { display: "block", padding: "1px 2px 3px 4px", margin: "5px 6px 7px 8px" },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(physical.layout.padding).toEqual([1, 2, 3, 4]);
    expect(physical.margin).toEqual([5, 6, 7, 8]);

    const computedDefaults = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-box-over-defaults",
      tag: "DIV",
      styles: {
        display: "block",
        paddingLeft: "0px",
        marginTop: "0px",
        paddingInlineStart: "12px",
        marginBlockStart: "14px",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(computedDefaults.layout.padding).toEqual([0, 0, 0, 12]);
    expect(computedDefaults.margin).toEqual([14, 0, 0, 0]);
  });

  it("resolves authored padding and margin units in pure H2D payloads", () => {
    const context = loadPluginFunctions();
    const containingBlock = {
      width: 1200,
      height: 800,
      viewportWidth: 1200,
      viewportHeight: 800,
    };
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "functional-box-spacing",
      tag: "DIV",
      styles: {
        display: "flex",
        fontSize: "20px",
        padding: "calc(1rem + 2px) 2vw min(10%, 48px) 1em",
        margin: "max(-0.5rem, -12px) 5% calc(1vh + 2px) -1em",
      },
      rect: { x: 0, y: 0, width: 400, height: 240 },
      childNodes: [],
    }, { x: 0, y: 0, width: 1200, height: 800 }, 16, "", 16, {}, containingBlock);

    expect(scene.layout.padding[0]).toBeCloseTo(18, 8);
    expect(scene.layout.padding[1]).toBeCloseTo(24, 8);
    expect(scene.layout.padding[2]).toBeCloseTo(48, 8);
    expect(scene.layout.padding[3]).toBeCloseTo(20, 8);
    expect(scene.margin[0]).toBeCloseTo(-8, 8);
    expect(scene.margin[1]).toBeCloseTo(60, 8);
    expect(scene.margin[2]).toBeCloseTo(10, 8);
    expect(scene.margin[3]).toBeCloseTo(-20, 8);
  });

  it("uses the containing inline size for vertical-writing box percentages", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "vertical-box-percentage",
      tag: "DIV",
      styles: {
        display: "block",
        writingMode: "vertical-rl",
        padding: "10%",
        margin: "5%",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0, width: 1200, height: 800 }, 16, "", 16, {}, {
      width: 1200,
      height: 800,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(scene.layout.padding).toEqual([80, 80, 80, 80]);
    expect(scene.margin).toEqual([40, 40, 40, 40]);
  });

  it("materializes logical border edges for horizontal RTL H2D payloads", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-border-horizontal-rtl",
      tag: "DIV",
      styles: {
        display: "block",
        direction: "rtl",
        borderInlineStartWidth: "2px",
        borderInlineStartStyle: "solid",
        borderInlineStartColor: "#ff0000",
        borderInlineEnd: "3px dashed #00ff00",
        borderBlock: "4px double #0000ff",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.borders).toMatchObject([
      { width: 4, style: "double", color: "#0000ff" },
      { width: 2, style: "solid", color: "#ff0000" },
      { width: 4, style: "double", color: "#0000ff" },
      { width: 3, style: "dashed", color: "#00ff00" },
    ]);
  });

  it("maps logical border shorthands across vertical RTL writing and keeps gradients", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-border-vertical-rtl",
      tag: "DIV",
      styles: {
        display: "block",
        writingMode: "vertical-rl",
        direction: "rtl",
        borderInline: "2px solid #ff0000",
        borderBlock: "3px dashed #0000ff",
        borderImageSource: "linear-gradient(90deg, #f00, #00f)",
      },
      rect: { x: 0, y: 0, width: 120, height: 240 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      borderTopWidth: "2px",
      borderRightWidth: "3px",
      borderBottomWidth: "2px",
      borderLeftWidth: "3px",
    });
    expect(scene.borders).toMatchObject([
      { width: 2, gradient: "linear-gradient(90deg, #f00, #00f)" },
      { width: 3, gradient: "linear-gradient(90deg, #f00, #00f)" },
      { width: 2, gradient: "linear-gradient(90deg, #f00, #00f)" },
      { width: 3, gradient: "linear-gradient(90deg, #f00, #00f)" },
    ]);
  });

  it("keeps explicit physical border shorthand ahead of logical H2D edges", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-border-physical-priority",
      tag: "DIV",
      styles: {
        display: "block",
        borderTop: "5px solid #111111",
        borderBlockStart: "2px dashed #ff0000",
        borderInline: "3px solid #00ff00",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.borders).toMatchObject([
      { width: 5, style: "solid", color: "#111111" },
      { width: 3, style: "solid", color: "#00ff00" },
      undefined,
      { width: 3, style: "solid", color: "#00ff00" },
    ]);
  });

  it("materializes logical corner radii for horizontal RTL H2D payloads", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-radius-horizontal-rtl",
      tag: "DIV",
      styles: {
        display: "block",
        direction: "rtl",
        borderStartStartRadius: "10px 6px",
        borderStartEndRadius: "8px",
        borderEndStartRadius: "7px 5px",
        borderEndEndRadius: "4px",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      borderTopLeftRadius: "8px",
      borderTopRightRadius: "10px 6px",
      borderBottomRightRadius: "7px 5px",
      borderBottomLeftRadius: "4px",
    });
    expect(scene.radius).toEqual([8, 6, 5, 4]);
  });

  it("maps logical corner radii across vertical RTL writing and keeps physical radius priority", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-radius-vertical-rtl",
      tag: "DIV",
      styles: {
        display: "block",
        writingMode: "vertical-rl",
        direction: "rtl",
        borderStartStartRadius: "10px",
        borderStartEndRadius: "8px",
        borderEndStartRadius: "6px",
        borderEndEndRadius: "4px",
        borderTopLeftRadius: "20px",
      },
      rect: { x: 0, y: 0, width: 120, height: 240 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      borderTopLeftRadius: "20px",
      borderTopRightRadius: "8px",
      borderBottomRightRadius: "10px",
      borderBottomLeftRadius: "6px",
    });
    expect(scene.radius).toEqual([20, 8, 10, 6]);
  });

  it("expands physical border-radius shorthand before logical corner fallback", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "physical-radius-shorthand",
      tag: "DIV",
      styles: {
        display: "block",
        borderRadius: "4px 8px / 6px 10px",
        borderStartStartRadius: "20px",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      borderTopLeftRadius: "4px 6px",
      borderTopRightRadius: "8px 10px",
      borderBottomRightRadius: "4px 6px",
      borderBottomLeftRadius: "8px 10px",
    });
    expect(scene.radius).toEqual([4, 8, 4, 8]);
  });

  it("resolves font, viewport, and CSS math border radii across both axes", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "functional-radius",
      tag: "DIV",
      styles: {
        display: "block",
        fontSize: "20px",
        borderRadius: "calc(1em / 2) 1rem / min(20%, 18px) max(1dvh, 8px)",
      },
      rect: { x: 0, y: 0, width: 200, height: 80 },
      childNodes: [{
        nodeType: 3,
        id: "functional-radius-text",
        text: "Rounded",
        rect: { x: 8, y: 8, width: 80, height: 24 },
        lineHeight: 24,
        styles: { fontSize: "20px", lineHeight: "24px" },
      }],
    }, { x: 0, y: 0, width: 200, height: 80 }, 20, "", 20, {}, {
      width: 200,
      height: 80,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(scene.type).toBe("frame");
    expect(scene.radius).toEqual([10, 8, 10, 8]);
    const axes = context.cssRadiusAxes(
      scene.computedStyles,
      200,
      80,
      context.sceneBoundaryLengthContext(scene, 200, 80),
    );
    expect(axes.horizontal).toEqual([10, 20, 10, 20]);
    expect(axes.vertical).toEqual([16, 8, 16, 8]);
    expect(axes.elliptical).toBe(true);

    const scaled = context.cssRadiusAxes({
      borderTopLeftRadius: "80px 60px",
      borderTopRightRadius: "80px 60px",
      borderBottomRightRadius: "80px 60px",
      borderBottomLeftRadius: "80px 60px",
    }, 100, 80);
    expect(scaled.horizontal).toEqual([50, 50, 50, 50]);
    scaled.vertical.forEach(value => expect(value).toBeCloseTo(37.5, 8));

    const report = importReport();
    context.recordSceneDegradations(scene, report, [], mockFigmaNode("FRAME"));
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("border-top-left-radius calc(1em / 2) min(20%, 18px) -> 10px 16px");
    expect(report.styleDegradationNodes[0].message).toContain("border-top-right-radius 1rem max(1dvh, 8px) -> 20px 8px");
  });

  it("materializes outline shorthand in the H2D-only path", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "outline-shorthand-boundary",
      tag: "DIV",
      styles: {
        display: "block",
        outline: "3px dashed rgb(20, 40, 60)",
        outlineOffset: "5px",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      outlineWidth: "3px",
      outlineStyle: "dashed",
      outlineColor: "rgb(20, 40, 60)",
    });
    expect(scene.outline).toEqual({ color: "rgb(20, 40, 60)", width: 3, style: "dashed" });
    expect(scene.outlineOffset).toBe(5);
  });

  it("preserves auto outline shorthand as a platform focus-ring contract", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "auto-outline-shorthand-boundary",
      tag: "BUTTON",
      styles: {
        display: "block",
        color: "rgb(10, 20, 30)",
        outline: "3px auto currentColor",
        outlineOffset: "-1px",
      },
      rect: { x: 0, y: 0, width: 120, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      outlineWidth: "3px",
      outlineStyle: "auto",
      outlineColor: "rgb(10, 20, 30)",
    });
    expect(scene.outline).toEqual({ color: "rgb(10, 20, 30)", width: 3, style: "auto" });
    expect(scene.outlineOffset).toBe(-1);
  });

  it("recovers border and outline width keywords from H2D shorthands", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "keyword-boundary-widths",
      tag: "BUTTON",
      styles: {
        display: "block",
        color: "rgb(10, 20, 30)",
        border: "thick solid rgb(40, 50, 60)",
        outline: "medium solid currentColor",
        outlineOffset: "2px",
      },
      rect: { x: 0, y: 0, width: 120, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.borders).toEqual([0, 1, 2, 3].map(() => ({
      color: "rgb(40, 50, 60)",
      width: 5,
      style: "solid",
    })));
    expect(scene.outline).toEqual({ color: "rgb(10, 20, 30)", width: 3, style: "solid" });

    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const parent = mockFigmaNode("FRAME");
    parent.resize(120, 40);
    context.createOutlineDecoration(parent, scene);
    expect(parent.children[0]).toMatchObject({ name: "__css-outline", width: 130, height: 50, x: -5, y: -5 });
    expect(svg).toContain("fill-rule=\"evenodd\"");

    const report = importReport();
    context.recordSceneDegradations(scene, report, [], parent);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("outline-width medium -> 3px");
    expect(report.styleDegradationNodes[0].message).toContain("border-top-width thick -> 5px");
    expect(report.styleDegradationNodes[0].message).toContain("did not retain computed pixel widths");
  });

  it("resolves mixed absolute, font-relative, and viewport boundary widths in H2D", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "mixed-unit-boundary-widths",
      tag: "DIV",
      styles: {
        display: "block",
        color: "rgb(10, 20, 30)",
        fontSize: "20px",
        borderTopWidth: "0.1in",
        borderRightWidth: "0.25em",
        borderBottomWidth: "0.5rem",
        borderLeftWidth: "1vw",
        borderTopStyle: "solid",
        borderRightStyle: "solid",
        borderBottomStyle: "solid",
        borderLeftStyle: "solid",
        borderTopColor: "rgb(40, 50, 60)",
        borderRightColor: "rgb(40, 50, 60)",
        borderBottomColor: "rgb(40, 50, 60)",
        borderLeftColor: "rgb(40, 50, 60)",
        outlineWidth: "1vh",
        outlineStyle: "solid",
        outlineColor: "currentColor",
      },
      rect: { x: 0, y: 0, width: 600, height: 400 },
      childNodes: [],
    }, { x: 0, y: 0, width: 600, height: 400 }, 20, "", 20, {}, {
      width: 600,
      height: 400,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(scene.borders[0].width).toBeCloseTo(9.6, 8);
    expect(scene.borders.slice(1).map(border => border.width)).toEqual([5, 10, 12]);
    expect(scene.outline).toEqual({ color: "rgb(10, 20, 30)", width: 8, style: "solid" });

    const report = importReport();
    context.recordSceneDegradations(scene, report, [], mockFigmaNode("FRAME"));
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("border-top-width 0.1in -> 9.6px");
    expect(report.styleDegradationNodes[0].message).toContain("border-left-width 1vw -> 12px");
    expect(report.styleDegradationNodes[0].message).toContain("outline-width 1vh -> 8px");
  });

  it("resolves CSS math functions in H2D border and outline shorthands", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "math-boundary-widths",
      tag: "DIV",
      styles: {
        display: "block",
        color: "rgb(10, 20, 30)",
        fontSize: "20px",
        borderTop: "calc(0.05in + 1.2px) solid rgb(40, 50, 60)",
        borderRight: "min(0.5em, 12px) solid rgb(40, 50, 60)",
        borderBottom: "max(0.25rem, 6px) solid rgb(40, 50, 60)",
        borderLeft: "clamp(2px, 1vw, 16px) solid rgb(40, 50, 60)",
        outline: "calc(1vh / 2) solid currentColor",
        outlineOffset: "clamp(-8px, -0.5em, -2px)",
      },
      rect: { x: 0, y: 0, width: 600, height: 400 },
      childNodes: [],
    }, { x: 0, y: 0, width: 600, height: 400 }, 20, "", 20, {}, {
      width: 600,
      height: 400,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    scene.borders.map(border => border.width).forEach((width, index) => {
      expect(width).toBeCloseTo([6, 10, 6, 12][index], 8);
    });
    expect(scene.outline).toEqual({ color: "rgb(10, 20, 30)", width: 4, style: "solid" });
    expect(scene.outlineOffset).toBe(-8);
    expect(context.resolveSizingConstraint("calc(1ex + 1ch)", "width", undefined, undefined, 20, 20)).toBe(20);
    expect(context.resolveSizingConstraint("calc(1svh / 2)", "height", undefined, { width: 1200, height: 800 }, 20, 20)).toBe(4);
    expect(context.cssOutlineOffsetValue("calc(-1dvw + 4px)", 0, {
      fontSize: 20,
      rootFontSize: 20,
      viewportWidth: 1200,
      viewportHeight: 800,
    })).toBe(-8);

    const report = importReport();
    context.recordSceneDegradations(scene, report, [], mockFigmaNode("FRAME"));
    expect(report.styleDegradations).toBe(2);
    expect(report.styleDegradationNodes[0].message).toContain("border-top-width calc(0.05in + 1.2px) -> 6px");
    expect(report.styleDegradationNodes[0].message).toContain("border-right-width min(0.5em, 12px) -> 10px");
    expect(report.styleDegradationNodes[0].message).toContain("border-bottom-width max(0.25rem, 6px) -> 6px");
    expect(report.styleDegradationNodes[0].message).toContain("border-left-width clamp(2px, 1vw, 16px) -> 12px");
    expect(report.styleDegradationNodes[0].message).toContain("outline-width calc(1vh / 2) -> 4px");
    expect(report.styleDegradationNodes[1].message).toContain("outline-offset clamp(-8px, -0.5em, -2px) -> -8px");
  });

  it("keeps explicit outline fields ahead of the H2D shorthand", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "outline-physical-priority",
      tag: "DIV",
      styles: {
        display: "block",
        outline: "3px dashed #ff0000",
        outlineWidth: "1px",
        outlineStyle: "solid",
        outlineColor: "#0000ff",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.outline).toEqual({ color: "#0000ff", width: 1, style: "solid" });
  });

  it("maps logical sizing axes and min/max bounds in the H2D-only path", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-sizing-boundary",
      tag: "DIV",
      styles: {
        display: "block",
        writingMode: "vertical-rl",
        inlineSize: "80px",
        blockSize: "120px",
        minInlineSize: "40px",
        maxInlineSize: "100px",
        minBlockSize: "60px",
        maxBlockSize: "240px",
      },
      rect: { x: 0, y: 0, width: 120, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      width: "120px",
      height: "80px",
      minWidth: "60px",
      maxWidth: "240px",
      minHeight: "40px",
      maxHeight: "100px",
    });
    expect(scene.sizingConstraints).toEqual({
      minWidth: "60px",
      maxWidth: "240px",
      minHeight: "40px",
      maxHeight: "100px",
    });

    const physical = context.sceneFromH2D({
      nodeType: 1,
      id: "logical-sizing-physical-priority",
      tag: "DIV",
      styles: {
        display: "block",
        writingMode: "vertical-rl",
        width: "200px",
        inlineSize: "80px",
        minWidth: "100px",
        minBlockSize: "60px",
      },
      rect: { x: 0, y: 0, width: 200, height: 80 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(physical.computedStyles).toMatchObject({ width: "200px", minWidth: "100px" });
  });

  it("maps flex row and column axes through vertical writing modes in H2D", () => {
    const context = loadPluginFunctions();
    const row = context.sceneFromH2D({
      nodeType: 1,
      id: "vertical-flex-row",
      tag: "DIV",
      styles: { display: "flex", flexDirection: "row", writingMode: "vertical-rl", width: "120px", height: "240px" },
      rect: { x: 0, y: 0, width: 120, height: 240 },
      childNodes: [],
    }, { x: 0, y: 0 });
    const column = context.sceneFromH2D({
      nodeType: 1,
      id: "vertical-flex-column",
      tag: "DIV",
      styles: { display: "flex", flexDirection: "column", writingMode: "vertical-lr", width: "120px", height: "240px" },
      rect: { x: 0, y: 0, width: 120, height: 240 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(row.layout.mode).toBe("vertical");
    expect(column.layout.mode).toBe("horizontal");
  });

  it("uses the parent line-height when a legacy payload keeps an inheritance keyword", () => {
    const context = loadPluginFunctions();
    expect(context.payloadLineHeightValue("inherit", "28px", 16)).toBe(28);
    expect(context.payloadLineHeightValue("unset", "1.75", 16)).toBe(28);
    expect(context.payloadLineHeightValue("revert-layer", "175%", 16)).toBe(28);
    expect(context.payloadLineHeightValue("2rem", "normal", 12, 20)).toBe(40);
    // Percentage/em values are resolved on the declaring parent before they
    // inherit. A child with a different font size must keep that pixel line
    // box; unitless values remain receiving-font-size multipliers.
    expect(context.payloadLineHeightValue("150%", "30px", 16)).toBe(30);
    expect(context.payloadLineHeightValue("1.5em", "30px", 16)).toBe(30);
    expect(context.payloadLineHeightValue("1.5", "1.5", 20)).toBe(30);

    const node = mockFigmaNode("TEXT");
    expect(context.applySceneLineHeight(node, {
      id: "inherited-keyword-copy",
      computedStyles: { lineHeight: "28px" },
      text: { fontSize: 16, lineHeight: "inherit" },
    }, importReport())).toBe(true);
    expect(node.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
  });

  it("treats a legacy initial line-height as the CSS normal value", () => {
    const context = loadPluginFunctions();
    expect(context.payloadLineHeightValue("initial", "28px", 16)).toBeCloseTo(19.2, 8);
  });

  it("preserves authored aspect-ratio as an editable constraint", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyAspectRatioConstraint(node, {
      computedStyles: { aspectRatio: "16 / 9" },
    });
    expect(node.constrainProportions).toBe(true);
    expect(node.getPluginData("open-canvas-aspect-ratio")).toBe("16 / 9");
  });

  it("clears a stale aspect-ratio lock when the compatibility payload drops it", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.constrainProportions = true;
    node.setPluginData("open-canvas-aspect-ratio", "16 / 9");
    node.setPluginData("open-canvas-aspect-ratio-measured", "1.777");
    node.setPluginData("open-canvas-aspect-ratio-delta", "0");

    context.applyAspectRatioConstraint(node, {
      id: "trimmed-aspect-ratio-default",
      computedStyles: {},
    }, importReport());

    expect(node.constrainProportions).toBe(false);
    expect(node.getPluginData("open-canvas-aspect-ratio")).toBe("");
    expect(node.getPluginData("open-canvas-aspect-ratio-measured")).toBe("");
    expect(node.getPluginData("open-canvas-aspect-ratio-delta")).toBe("");
  });

  it("recovers aspect-ratio from the H2D marker when styles are trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-aspect-ratio",
      tag: "DIV",
      attributes: {
        "data-open-canvas-aspect-ratio": JSON.stringify({ value: "16 / 9", measuredGeometry: true }),
      },
      styles: {},
      rect: { x: 0, y: 0, width: 320, height: 180 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles).toMatchObject({ aspectRatio: "16 / 9" });
  });

  it("treats CSS reset keywords as missing when restoring H2D markers", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "reset-keyword-markers",
      tag: "DIV",
      attributes: {
        "data-open-canvas-sizing-constraints": JSON.stringify({ values: { minWidth: "50%" } }),
        "data-open-canvas-aspect-ratio": JSON.stringify({ value: "4 / 3" }),
      },
      styles: { minWidth: "initial", aspectRatio: "revert-layer" },
      computedStyles: { minWidth: "initial", aspectRatio: "revert-layer" },
      rect: { x: 0, y: 0, width: 320, height: 240 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles).toMatchObject({ minWidth: "50%", aspectRatio: "4 / 3" });
  });

  it("does not treat an unmarked aspect-ratio reset keyword as a proportion lock", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "unmarked-reset-aspect-ratio",
      tag: "DIV",
      styles: { aspectRatio: "initial" },
      computedStyles: { aspectRatio: "initial" },
      rect: { x: 0, y: 0, width: 320, height: 240 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles.aspectRatio).toBeUndefined();
  });

  it("recovers non-default text wrapping controls from the H2D marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-text-wrapping",
      tag: "SPAN",
      attributes: {
        "data-open-canvas-text-wrapping": JSON.stringify({
          values: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-all" },
          measuredGeometry: true,
        }),
      },
      styles: {},
      computedStyles: {},
      rect: { x: 0, y: 0, width: 180, height: 48 },
      childNodes: [{
        nodeType: 3,
        id: "trimmed-text-wrapping-run",
        text: "A long wrapped label",
        rect: { x: 0, y: 0, width: 180, height: 48 },
        lineCount: 2,
      }],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles).toMatchObject({
      whiteSpace: "pre-wrap",
      overflowWrap: "anywhere",
      wordBreak: "break-all",
    });
  });

  it("recovers text wrapping from an anonymous child marker when the wrapper marker is trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "child-only-text-wrapping",
      tag: "SPAN",
      attributes: {},
      styles: {},
      computedStyles: {},
      rect: { x: 0, y: 0, width: 180, height: 48 },
      childNodes: [{
        nodeType: 3,
        id: "child-only-text-wrapping-run",
        text: "A long wrapped label",
        rect: { x: 0, y: 0, width: 180, height: 48 },
        lineCount: 2,
        attributes: {
          "data-open-canvas-text-wrapping": JSON.stringify({
            values: { whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
            measuredGeometry: true,
          }),
        },
      }],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles).toMatchObject({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
  });

  it("reports when the captured box ratio differs from the authored ratio", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(160, 100);
    const report = importReport();
    const scene = {
      id: "ratio-conflict",
      rect: { width: 160, height: 100 },
      computedStyles: { aspectRatio: "16 / 9" },
    };

    context.applyAspectRatioConstraint(node, scene, report);

    expect(node.constrainProportions).toBe(true);
    expect(Number(node.getPluginData("open-canvas-aspect-ratio-measured"))).toBeCloseTo(1.6, 6);
    expect(Number(node.getPluginData("open-canvas-aspect-ratio-delta"))).toBeCloseTo(1.6 - 16 / 9, 6);
    expect(report.styleDegradationNodes[0]).toMatchObject({ id: "ratio-conflict" });
    expect(report.styleDegradationNodes[0].message).toContain("captured ratio");
  });

  it("keeps the captured box exact while restoring an aspect-ratio lock", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.constrainProportions = true;
    node.resize = function resize(width, height) {
      // Model a Figma host that changes the second axis while the proportion
      // lock is enabled. The importer must temporarily release that lock.
      this.width = width;
      this.height = this.constrainProportions ? width / (16 / 9) : height;
    };
    const scene = {
      id: "ratio-captured-box",
      rect: { width: 160, height: 100 },
      computedStyles: { aspectRatio: "16 / 9" },
    };
    const report = importReport();

    context.resizeCapturedBox(node, scene, 160, 100, report);

    expect(node.width).toBe(160);
    expect(node.height).toBe(100);
    expect(node.constrainProportions).toBe(true);
    expect(report.styleDegradations || 0).toBe(0);
  });

  it("corrects measured geometry without letting aspect-ratio change one axis", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.width = 200;
    node.height = 112.5;
    node.constrainProportions = true;
    node.resize = function resize(width, height) {
      this.width = width;
      this.height = this.constrainProportions ? width / (16 / 9) : height;
    };
    const scene = {
      id: "ratio-final-geometry",
      type: "frame",
      rect: { width: 160, height: 100 },
      layout: { mode: "none", widthMode: "fixed", heightMode: "fixed" },
      computedStyles: { aspectRatio: "16 / 9" },
    };
    const report = importReport();

    context.correctMeasuredSize(scene, node, report);

    expect(node.width).toBe(160);
    expect(node.height).toBe(100);
    expect(node.constrainProportions).toBe(true);
    expect(report.geometryResizes).toBe(1);
  });

  it("reports when an aspect-ratio lock cannot be released for measured resize", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    Object.defineProperty(node, "constrainProportions", {
      configurable: true,
      get: () => true,
      set: () => {},
    });
    const scene = {
      id: "ratio-locked-host",
      rect: { width: 160, height: 100 },
      computedStyles: { aspectRatio: "16 / 9" },
    };
    const report = importReport();

    context.resizeCapturedBox(node, scene, 160, 100, report);

    expect(report.styleDegradationNodes).toContainEqual(expect.objectContaining({
      id: "ratio-locked-host",
      message: expect.stringContaining("kept constrainProportions"),
    }));
  });

  it("reports aspect-ratio when the native proportion constraint cannot be read back", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    Object.defineProperty(node, "constrainProportions", {
      configurable: true,
      get: () => false,
      set: () => {},
    });
    const report = importReport();
    const scene = {
      id: "unsupported-aspect-ratio",
      computedStyles: { aspectRatio: "16 / 9" },
    };

    context.applyAspectRatioConstraint(node, scene, report);
    context.applyAspectRatioConstraint(node, scene, report);

    expect(node.getPluginData("open-canvas-aspect-ratio")).toBe("16 / 9");
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes).toContainEqual(expect.objectContaining({
      id: "unsupported-aspect-ratio",
      message: expect.stringContaining("constrainProportions read-back was false"),
    }));
  });

  it("maps absolute CSS insets to native Figma resize constraints", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyPositionConstraints(node, {
      positioning: "absolute",
      computedStyles: { left: "12px", right: "24px", top: "8px", bottom: "16px" },
    });
    expect(node.constraints).toEqual({ horizontal: "STRETCH", vertical: "STRETCH" });
    expect(JSON.parse(node.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      position: "absolute",
      horizontal: { start: "12px", end: "24px" },
      vertical: { start: "8px", end: "16px" },
    });
  });

  it("keeps fixed-width over-constrained absolute layers anchored instead of stretching", () => {
    const context = loadPluginFunctions();
    const ltr = mockFigmaNode("FRAME");
    context.applyPositionConstraints(ltr, {
      id: "fixed-absolute-ltr",
      positioning: "absolute",
      layout: { widthExpression: "120px" },
      computedStyles: { left: "12px", right: "24px", direction: "ltr" },
    });
    expect(ltr.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(JSON.parse(ltr.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      horizontal: { constraint: "MIN", ignored: "end", sizeExpression: "120px" },
    });

    const rtl = mockFigmaNode("FRAME");
    context.applyPositionConstraints(rtl, {
      id: "fixed-absolute-rtl",
      positioning: "absolute",
      layout: { widthExpression: "120px" },
      computedStyles: { left: "12px", right: "24px", direction: "rtl" },
    });
    expect(rtl.constraints).toEqual({ horizontal: "MAX", vertical: "MIN" });
    expect(JSON.parse(rtl.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      horizontal: { constraint: "MAX", ignored: "start", sizeExpression: "120px" },
    });
  });

  it("keeps explicit-size inset constraints through final verification", () => {
    const context = loadPluginFunctions();
    const ltr = mockFigmaNode("FRAME");
    const rtl = mockFigmaNode("FRAME");
    const vertical = mockFigmaNode("FRAME");
    const ltrScene = {
      id: "verified-fixed-absolute-ltr",
      positioning: "absolute",
      layout: { widthExpression: "120px" },
      computedStyles: { left: "12px", right: "24px", direction: "ltr" },
      children: [],
    };
    const rtlScene = {
      id: "verified-fixed-absolute-rtl",
      positioning: "absolute",
      layout: { widthExpression: "120px" },
      computedStyles: { left: "12px", right: "24px", direction: "rtl" },
      children: [],
    };
    const verticalScene = {
      id: "verified-fixed-absolute-vertical",
      positioning: "absolute",
      layout: { heightExpression: "48px" },
      computedStyles: { top: "8px", bottom: "16px" },
      children: [],
    };

    context.applyPositionConstraints(ltr, ltrScene, importReport());
    context.applyPositionConstraints(rtl, rtlScene, importReport());
    context.applyPositionConstraints(vertical, verticalScene, importReport());
    expect(ltr.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(rtl.constraints).toEqual({ horizontal: "MAX", vertical: "MIN" });
    expect(vertical.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });

    ltr.constraints = { horizontal: "STRETCH", vertical: "MIN" };
    rtl.constraints = { horizontal: "STRETCH", vertical: "MIN" };
    vertical.constraints = { horizontal: "MIN", vertical: "STRETCH" };
    context.verifyScenePositionConstraints(ltrScene, ltr, importReport());
    context.verifyScenePositionConstraints(rtlScene, rtl, importReport());
    context.verifyScenePositionConstraints(verticalScene, vertical, importReport());

    expect(ltr.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(rtl.constraints).toEqual({ horizontal: "MAX", vertical: "MIN" });
    expect(vertical.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
  });

  it("treats compatibility inset reset keywords as inactive constraints", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.constraints = { horizontal: "STRETCH", vertical: "MAX" };
    node.setPluginData("open-canvas-position-constraints", JSON.stringify({
      position: "absolute",
      horizontal: { constraint: "STRETCH" },
      vertical: { constraint: "MAX" },
    }));
    const scene = {
      id: "reset-inset-constraints",
      positioning: "absolute",
      computedStyles: {
        left: "initial",
        right: "unset",
        top: "revert",
        bottom: "revert-layer",
      },
      children: [],
    };

    context.verifyScenePositionConstraints(scene, node, importReport());

    expect(node.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(node.getPluginData("open-canvas-position-constraints")).toBe("");
  });

  it("keeps one-sided absolute insets anchored to their CSS edge", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyPositionConstraints(node, {
      positioning: "fixed",
      computedStyles: { left: "auto", right: "20px", top: "10px", bottom: "auto" },
    });
    expect(node.constraints).toEqual({ horizontal: "MAX", vertical: "MIN" });
  });

  it("maps percentage plus half-size translation centering to a native CENTER constraint", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const scene = {
      id: "centered-toast",
      positioning: "fixed",
      fixedScope: "viewport",
      rect: { x: 960, y: 850, width: 130, height: 40 },
      transform: "translate(-50%, 20px)",
      computedStyles: {
        position: "fixed",
        left: "50%",
        right: "auto",
        top: "auto",
        bottom: "90px",
      },
      layout: { widthExpression: "auto", heightExpression: "auto" },
      children: [],
    };

    context.applyPositionConstraints(node, scene, importReport());
    expect(node.constraints).toEqual({ horizontal: "CENTER", vertical: "MAX" });
    expect(JSON.parse(node.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      horizontal: { constraint: "CENTER", start: "50%", centeredByTransform: true },
      vertical: { constraint: "MAX", end: "90px" },
    });

    node.constraints = { horizontal: "MIN", vertical: "MIN" };
    context.verifyScenePositionConstraints(scene, node, importReport());
    expect(node.constraints).toEqual({ horizontal: "CENTER", vertical: "MAX" });

    const computedMatrixNode = mockFigmaNode("FRAME");
    context.applyPositionConstraints(computedMatrixNode, {
      ...scene,
      transform: "matrix(1, 0, 0, 1, -65, 20)",
    }, importReport());
    expect(computedMatrixNode.constraints).toEqual({ horizontal: "CENTER", vertical: "MAX" });

    const scaledNode = mockFigmaNode("FRAME");
    context.applyPositionConstraints(scaledNode, {
      ...scene,
      transform: "translateX(-50%) scale(1.1)",
    }, importReport());
    expect(scaledNode.constraints).toEqual({ horizontal: "MIN", vertical: "MAX" });
  });

  it("clears managed native constraints when a reused layer returns to normal flow", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.constraints = { horizontal: "STRETCH", vertical: "MAX" };
    node.setPluginData("open-canvas-position-constraints", JSON.stringify({
      position: "absolute",
      horizontal: { constraint: "STRETCH" },
      vertical: { constraint: "MAX" },
    }));
    const report = importReport();

    context.verifyScenePositionConstraints({
      id: "returned-to-flow",
      positioning: "static",
      computedStyles: { position: "static" },
      children: [],
    }, node, report);

    expect(node.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(node.getPluginData("open-canvas-position-constraints")).toBe("");
    expect(report.styleDegradations).toBe(0);
  });

  it("resets stale native constraints while retaining sticky metadata", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.constraints = { horizontal: "MAX", vertical: "STRETCH" };
    node.setPluginData("open-canvas-position-constraints", JSON.stringify({
      position: "sticky",
      reference: "scroll-container",
    }));

    context.verifyScenePositionConstraints({
      id: "sticky-recovery",
      positioning: "sticky",
      computedStyles: { position: "sticky", top: "8px" },
      children: [],
    }, node, importReport());

    expect(node.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(JSON.parse(node.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      position: "sticky",
    });
  });

  it("reapplies absolute constraints after a later layout pass resets them", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const scene = {
      id: "reflowed-absolute",
      positioning: "absolute",
      computedStyles: { left: "12px", right: "24px", top: "8px", bottom: "16px" },
      children: [],
    };
    const report = importReport();
    context.applyPositionConstraints(node, scene, report);
    expect(node.constraints).toEqual({ horizontal: "STRETCH", vertical: "STRETCH" });
    node.constraints = { horizontal: "MIN", vertical: "MIN" };
    context.verifyScenePositionConstraints(scene, node, report);
    expect(node.constraints).toEqual({ horizontal: "STRETCH", vertical: "STRETCH" });
    expect(report.styleDegradations).toBe(0);
  });

  it("reports a read-only constraint runtime once instead of silently degrading", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let current = { horizontal: "MIN", vertical: "MIN" };
    Object.defineProperty(node, "constraints", {
      configurable: true,
      get: () => current,
      set: () => { throw new Error("constraints are read only"); },
    });
    const report = importReport();
    const scene = {
      id: "readonly-absolute",
      positioning: "absolute",
      computedStyles: { left: "12px", right: "24px", top: "8px", bottom: "16px" },
      children: [],
    };
    context.applyPositionConstraints(node, scene, report);
    context.verifyScenePositionConstraints(scene, node, report);
    expect(current).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes).toHaveLength(1);
    expect(report.styleDegradationNodes[0].message).toContain("position constraints");
  });

  it("reports when native resize constraints are unavailable", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    delete node.constraints;
    const report = importReport();
    context.applyPositionConstraints(node, {
      id: "missing-constraint-api",
      positioning: "absolute",
      computedStyles: { right: "20px", bottom: "16px" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("does not expose resize constraints");
  });

  it("keeps sticky insets as metadata without applying resize constraints", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyPositionConstraints(node, {
      positioning: "sticky",
      computedStyles: { left: "12px", right: "auto", top: "8px", bottom: "auto" },
    });
    expect(node.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(JSON.parse(node.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      position: "sticky",
      reference: "scroll-container",
    });
  });

  it("recovers source sticky positioning from a trimmed H2D marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-sticky-header",
      tag: "HEADER",
      attributes: { "data-open-canvas-positioning": "sticky" },
      styles: { position: "absolute", top: "0px" },
      rect: { x: 0, y: 0, width: 320, height: 56 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.positioning).toBe("absolute");
    expect(scene.sourcePositioning).toBe("sticky");
    const node = mockFigmaNode("FRAME");
    const report = importReport();
    context.applyPositionConstraints(node, scene, report);
    expect(JSON.parse(node.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      position: "sticky",
      reference: "scroll-container",
    });
  });

  it("does not apply final native constraints to sticky or ancestor-scoped fixed layers", () => {
    const context = loadPluginFunctions();
    const stickyNode = mockFigmaNode("FRAME");
    const fixedNode = mockFigmaNode("FRAME");
    const rootNode = mockFigmaNode("FRAME");
    rootNode.appendChild(stickyNode);
    rootNode.appendChild(fixedNode);
    const rootScene = {
      id: "root",
      children: [{
        id: "sticky-child",
        positioning: "sticky",
        computedStyles: { left: "12px", top: "8px" },
        children: [],
      }, {
        id: "scoped-fixed-child",
        positioning: "fixed",
        fixedScope: "ancestor",
        computedStyles: { right: "12px", bottom: "8px" },
        children: [],
      }],
    };
    stickyNode.setPluginData("open-canvas-id", "sticky-child");
    fixedNode.setPluginData("open-canvas-id", "scoped-fixed-child");
    context.verifyScenePositionConstraints(rootScene, rootNode, importReport());
    expect(stickyNode.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(fixedNode.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
  });

  it("hoists shared-scene viewport-fixed layers without adding the ancestor offset", () => {
    const context = loadPluginFunctions();
    const root = {
      id: "root",
      children: [{
        id: "shell",
        rect: { x: 32, y: 64, width: 300, height: 180 },
        children: [{
          id: "toast",
          positioning: "fixed",
          rect: { x: 18, y: 22, width: 140, height: 40 },
          children: [],
        }],
      }],
    };

    expect(context.hoistViewportFixedLayers(root, true)).toBe(1);
    expect(root.children.map(child => child.id)).toEqual(["shell", "toast"]);
    expect(root.children[1].rect).toMatchObject({ x: 18, y: 22 });
    expect(root.children[1]._openCanvasFixedSourceParentId).toBe("shell");
  });

  it("restores H2D-only fixed layers from parent-local to viewport coordinates", () => {
    const context = loadPluginFunctions();
    const root = {
      id: "root",
      children: [{
        id: "shell",
        rect: { x: 32, y: 64, width: 300, height: 180 },
        children: [{
          id: "toast",
          positioning: "fixed",
          rect: { x: -14, y: -42, width: 140, height: 40 },
          children: [],
        }],
      }],
    };

    expect(context.hoistViewportFixedLayers(root, false)).toBe(1);
    expect(root.children[1].rect).toMatchObject({ x: 18, y: 22 });
  });

  it("keeps ancestor-scoped fixed layers nested and preserves their constraint metadata", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyPositionConstraints(node, {
      positioning: "fixed",
      fixedScope: "ancestor",
      computedStyles: { left: "12px", right: "auto", top: "8px", bottom: "auto" },
    });
    expect(node.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
    expect(JSON.parse(node.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      position: "fixed",
      reference: "fixed-containing-block",
    });

    const root = {
      id: "root",
      children: [{
        id: "shell",
        rect: { x: 32, y: 64, width: 300, height: 180 },
        children: [{
          id: "wrapper",
          rect: { x: 10, y: 12, width: 260, height: 120 },
          children: [{
            id: "toast",
            positioning: "fixed",
            fixedScope: "ancestor",
            fixedOffset: { x: 18, y: 22 },
            rect: { x: 8, y: 10, width: 140, height: 40 },
            children: [],
          }],
        }],
      }],
    };
    expect(context.hoistViewportFixedLayers(root, true)).toBe(0);
    expect(root.children.map(child => child.id)).toEqual(["shell"]);
    expect(root.children[0].children.map(child => child.id)).toEqual(["wrapper"]);
    expect(root.children[0].children[0].children.map(child => child.id)).toEqual(["toast"]);

    const report = importReport();
    context.recordSceneDegradations({
      id: "toast",
      positioning: "fixed",
      fixedScope: "ancestor",
      computedStyles: { position: "fixed" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("fixed-containing-block");
  });

  it("hoists ancestor-scoped fixed layers to their captured containing block", () => {
    const context = loadPluginFunctions();
    const root = {
      id: "root",
      children: [{
        id: "shell",
        rect: { x: 32, y: 64, width: 300, height: 180 },
        children: [{
          id: "wrapper",
          rect: { x: 10, y: 12, width: 260, height: 120 },
          children: [{
            id: "toast",
            positioning: "fixed",
            fixedScope: "ancestor",
            fixedContainingBlockId: "shell",
            fixedOffset: { x: 18, y: 22 },
            rect: { x: 8, y: 10, width: 140, height: 40 },
            children: [],
          }],
        }],
      }],
    };

    expect(context.hoistAncestorFixedLayers(root)).toBe(1);
    expect(root.children[0].children.map(child => child.id)).toEqual(["wrapper", "toast"]);
    expect(root.children[0].children[1]).toMatchObject({
      fixedContainingBlockHoisted: true,
      rect: { x: 18, y: 22 },
    });
  });

  it("uses native constraints after ancestor fixed reparenting", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const scene = {
      positioning: "fixed",
      fixedScope: "ancestor",
      fixedContainingBlockHoisted: true,
      computedStyles: { left: "12px", right: "auto", top: "8px", bottom: "auto" },
    };

    expect(context.applyPositionConstraints(node, scene, importReport())).toBe(true);
    expect(node.constraints).toEqual({ horizontal: "MIN", vertical: "MIN" });
  });

  it("does not report a degradation after ancestor fixed reparenting succeeds", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "toast",
      positioning: "fixed",
      fixedScope: "ancestor",
      fixedContainingBlockHoisted: true,
      computedStyles: { position: "fixed" },
    }, report);
    expect(report.styleDegradations).toBe(0);
    expect(report.styleDegradationNodes).toEqual([]);
  });

  it("imports a hoisted fixed layer with root-relative geometry and constraints", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    const page = mockFigmaNode("PAGE");
    const root = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 430, height: 900 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block" },
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [{
        id: "shell",
        type: "frame",
        rect: { x: 32, y: 64, width: 300, height: 180 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
        children: [{
          id: "toast",
          type: "frame",
          rect: { x: 18, y: 22, width: 140, height: 40 },
          opacity: 1,
          radius: [8, 8, 8, 8],
          margin: [0, 0, 0, 0],
          positioning: "fixed",
          computedStyles: { position: "fixed", right: "24px", bottom: "16px" },
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "absolute" },
          children: [],
        }],
      }],
    };
    context.hoistViewportFixedLayers(root, true);

    const imported = await context.createNode(root, page, [], importReport(), undefined, {
      images: new Map(), vectors: new Map(),
    });
    const toast = imported.children.find(child => child.name === "toast");

    expect(toast.parent).toBe(imported);
    expect(toast).toMatchObject({ x: 18, y: 22, constraints: { horizontal: "MAX", vertical: "MAX" } });
    expect(toast.getPluginData("open-canvas-fixed-source-parent")).toBe("shell");
  });

  it("keeps a responsive centered fixed toolbar out of Auto Layout with its backdrop blur", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => {
      const node = mockFigmaNode("FRAME");
      node.minWidth = 0;
      node.maxWidth = Infinity;
      return node;
    };
    const page = mockFigmaNode("PAGE");
    const root = {
      id: "desktop-root",
      type: "frame",
      rect: { x: 0, y: 0, width: 1920, height: 1080 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [{
        id: "desktop-content",
        type: "frame",
        rect: { x: 0, y: 0, width: 1920, height: 1080 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { mode: "vertical", gap: 0, padding: [0, 0, 0, 0], widthMode: "fill", heightMode: "fixed", position: "flow" },
        children: [{
          id: "floating-toolbar",
          type: "frame",
          rect: { x: 960, y: 1008, width: 430, height: 72 },
          opacity: 1,
          fill: { color: "rgba(246, 252, 255, 0.92)" },
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          positioning: "fixed",
          fixedScope: "viewport",
          transform: "translateX(-50%)",
          backdropFilter: "blur(13px)",
          computedStyles: {
            position: "fixed",
            left: "50%",
            right: "auto",
            top: "auto",
            bottom: "0px",
            backdropFilter: "blur(13px)",
            boxSizing: "border-box",
          },
          layout: {
            mode: "horizontal",
            gap: 12,
            padding: [12, 15, 18, 15],
            widthMode: "fill",
            heightMode: "fixed",
            widthExpression: "min(100%, 430px)",
            position: "absolute",
          },
          children: [],
        }],
      }],
    };
    expect(context.hoistViewportFixedLayers(root, true)).toBe(1);

    const imported = await context.createNode(root, page, [], importReport(), undefined, {
      images: new Map(), vectors: new Map(),
    }, undefined, { width: 1920, height: 1080 });
    const toolbar = imported.children.find(child => child.name === "floating-toolbar");

    expect(toolbar.parent).toBe(imported);
    expect(toolbar.layoutPositioning).toBe("ABSOLUTE");
    expect(toolbar.constraints).toEqual({ horizontal: "CENTER", vertical: "MAX" });
    expect(toolbar.maxWidth).toBe(430);
    expect(toolbar.x).toBe(745);
    expect(toolbar.effects).toContainEqual({ type: "BACKGROUND_BLUR", radius: 13, visible: true });
    expect(toolbar.getPluginData("open-canvas-responsive-sizing")).toBe(JSON.stringify({
      width: "min(100%, 430px)",
    }));
    expect(JSON.parse(toolbar.getPluginData("open-canvas-position-constraints"))).toMatchObject({
      reference: "viewport-root",
      horizontal: { constraint: "CENTER", centeredByTransform: true },
      vertical: { constraint: "MAX", end: "0px" },
    });
    expect(imported.children.some(child => child.name.startsWith("__css-geometry-flow-floating-toolbar"))).toBe(false);
  });

  it("renders all shared scene shadow layers as editable effects", () => {
    const context = loadPluginFunctions();
    const node = { type: "FRAME", fills: [], effects: [] };
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      shadows: [
        { color: "rgba(0,0,0,.2)", offsetX: 0, offsetY: 4, blur: 12, spread: 0 },
        { color: "rgba(255,255,255,.4)", offsetX: 0, offsetY: 0, blur: 0, spread: 1, inset: true },
      ],
    });
    expect(node.effects).toHaveLength(2);
    expect(node.effects[0].type).toBe("DROP_SHADOW");
    expect(node.effects[1].type).toBe("INNER_SHADOW");
  });

  it("resolves currentColor when importing text and box shadows", () => {
    const context = loadPluginFunctions();
    const shadow = context.cssShadow("2px 3px 4px currentColor", "rgb(12, 34, 56)");
    expect(shadow.color).toBe("rgb(12, 34, 56)");
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "shadow-copy",
      tag: "DIV",
      styles: { color: "rgb(12, 34, 56)", boxShadow: "2px 3px 4px currentColor", width: "120px", height: "40px" },
      rect: { x: 0, y: 0, width: 120, height: 40 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.shadow.color).toBe("rgb(12, 34, 56)");
  });

  it("resolves functional shadow lengths in a pure H2D scene", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "functional-shadow-copy",
      tag: "DIV",
      styles: {
        color: "rgb(12, 34, 56)",
        fontSize: "20px",
        boxShadow: "calc(-0.5em + 2px) 1rem min(0.5rem, 12px) max(-4px, -0.25rem) currentColor",
        width: "240px",
        height: "120px",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0, width: 1200, height: 800 }, 16, "", 16, {}, {
      width: 1200,
      height: 800,
      viewportWidth: 1200,
      viewportHeight: 800,
    });

    expect(scene.shadow).toMatchObject({
      offsetX: -8,
      offsetY: 16,
      blur: 8,
      spread: -4,
      color: "rgb(12, 34, 56)",
    });
    expect(scene.shadows).toHaveLength(1);
  });

  it("loads the captured CSS font fallback stack for shared text scenes", async () => {
    const context = loadPluginFunctions();
    const requested = [];
    context.figma.createText = () => {
      const node = mockFigmaNode("TEXT");
      node.textAutoResize = "NONE";
      node.fontName = { family: "Inter", style: "Regular" };
      node.fontSize = 16;
      node.characters = "";
      return node;
    };
    context.figma.loadFontAsync = async (font) => {
      requested.push(font);
      if (font.family === "Missing Font") throw new Error("missing");
    };
    const parent = { type: "PAGE", children: [], appendChild: mockFigmaNode("PAGE").appendChild };
    await context.createNode({
      id: "font-text",
      type: "text",
      rect: { x: 0, y: 0, width: 100, height: 20 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { fontFamily: "Missing Font, Inter, sans-serif" },
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      text: { content: "Hello", fontFamily: "Missing Font", fontSize: 16, fontWeight: 400, lineHeight: 20, letterSpacing: 0, textAlign: "left" },
      children: [],
    }, parent, [], importReport(), undefined, { images: new Map(), vectors: new Map() });
    expect(requested[0].family).toBe("Missing Font");
    expect(requested.some((font) => font.family === "Inter")).toBe(true);
  });

  it("uses installed font metadata to resolve style aliases without reporting a fallback", async () => {
    const context = loadPluginFunctions();
    context.figma.listAvailableFontsAsync = async () => [
      { fontName: { family: "Inter", style: "ExtraBold" } },
    ];
    context.figma.loadFontAsync = async () => undefined;
    const resolved = await context.loadSceneFont({ fontFamily: "Inter, system-ui", fontWeight: 800 });
    expect(resolved).toEqual({ family: "Inter", style: "ExtraBold", fallback: false });
  });

  it("uses a later same-family style alias when the exact heavy style is unavailable", async () => {
    const context = loadPluginFunctions();
    context.figma.listAvailableFontsAsync = async () => [
      { fontName: { family: "Arial", style: "Bold" } },
    ];
    context.figma.loadFontAsync = async () => undefined;
    const resolved = await context.loadSceneFont({ fontFamily: "Arial", fontWeight: 800 });
    expect(resolved).toEqual({ family: "Arial", style: "Bold", fallback: false });
  });

  it("prefers an installed width variant for CSS font-stretch", async () => {
    const context = loadPluginFunctions();
    context.figma.listAvailableFontsAsync = async () => [
      { fontName: { family: "Inter", style: "Condensed Bold" } },
      { fontName: { family: "Inter", style: "Bold" } },
    ];
    context.figma.loadFontAsync = async () => undefined;

    const resolved = await context.loadSceneFont({
      fontFamily: "Inter",
      fontWeight: 700,
      fontStretch: "75%",
    });

    expect(resolved).toEqual({
      family: "Inter",
      style: "Condensed Bold",
      fallback: false,
      stretchMatched: true,
    });
    expect(context.fontStyleCandidates(700, true)).not.toContain("Bold");
    expect(context.fontStyleCandidates(700, true)).toContain("Bold Italic");
  });

  it("accepts keyword font-stretch aliases when resolving installed styles", async () => {
    const context = loadPluginFunctions();
    context.figma.listAvailableFontsAsync = async () => [
      { fontName: { family: "Inter", style: "Expanded Regular" } },
    ];
    context.figma.loadFontAsync = async () => undefined;

    const resolved = await context.loadSceneFont({
      fontFamily: "Inter",
      fontWeight: 400,
      fontStretch: "expanded",
    });

    expect(resolved.stretchMatched).toBe(true);
    expect(resolved.style).toBe("Expanded Regular");
  });

  it("audits flow text against its captured glyph box", () => {
    const context = loadPluginFunctions();
    expect(context.measuredTextPosition({
      type: "text",
      rect: { x: 0, y: 9, width: 331, height: 61.2 },
      textRect: { x: 0, y: -2.5, width: 331, height: 61.2 },
      text: { textAlign: "left" },
      layout: { position: "flow" },
    })).toEqual({ x: 0, y: 6.5 });
  });

  it("maps CSS layer and backdrop blur to native Figma effects", () => {
    const context = loadPluginFunctions();
    const node = { type: "FRAME", fills: [], effects: [] };
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      filter: "blur(13px) drop-shadow(0 2px 4px rgba(0,0,0,.2))",
      backdropFilter: "blur(8px)",
    });
    expect(node.effects).toEqual([
      { type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.2 }, offset: { x: 0, y: 2 }, radius: 4, spread: 0, visible: true, blendMode: "NORMAL" },
      { type: "LAYER_BLUR", radius: 13, visible: true },
      { type: "BACKGROUND_BLUR", radius: 8, visible: true },
    ]);
    expect(context.cssFilterHasUnsupportedParts("blur(13px) drop-shadow(0 2px 4px rgba(0,0,0,.2))")).toBe(false);
    expect(context.cssFilterHasUnsupportedParts("blur(13px) brightness(0.8)")).toBe(true);
    expect(context.cssFilterHasUnsupportedParts("opacity(.5) blur(4px)")).toBe(false);
    expect(context.cssFilterHasUnsupportedParts("opacity(.5) blur(4px)", false, false)).toBe(true);
  });

  it("preserves box-shadow and text-shadow together on editable text nodes", () => {
    const context = loadPluginFunctions();
    const node = { type: "TEXT", fills: [], effects: [] };
    context.visuals(node, {
      type: "text",
      opacity: 1,
      radius: [0, 0, 0, 0],
      computedStyles: { color: "rgb(20, 40, 60)" },
      shadows: [{ color: "rgba(0,0,0,.2)", offsetX: 0, offsetY: 2, blur: 4, spread: 0 }],
      text: { textShadow: "1px 1px 0 rgba(255,0,0,.5)" },
    });
    expect(node.effects).toHaveLength(2);
    expect(node.effects[0]).toMatchObject({ type: "DROP_SHADOW", offset: { x: 0, y: 2 }, radius: 4 });
    expect(node.effects[1]).toMatchObject({ type: "DROP_SHADOW", offset: { x: 1, y: 1 }, radius: 0 });
  });

  it("keeps importing when a runtime rejects effect spread", () => {
    const context = loadPluginFunctions();
    const stored = [];
    const node = { type: "FRAME", fills: [], setPluginData() {} };
    Object.defineProperty(node, "effects", {
      configurable: true,
      get: () => stored,
      set: (value) => {
        if (value.some(effect => Object.prototype.hasOwnProperty.call(effect, "spread"))) {
          throw new Error("spread unsupported");
        }
        stored.splice(0, stored.length, ...value);
      },
    });
    const report = importReport();
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      shadows: [{ color: "rgba(0,0,0,.2)", offsetX: 0, offsetY: 4, blur: 12, spread: 2 }],
    }, [], { report });
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toHaveProperty("spread");
    expect(report.styleDegradationNodes).toEqual([
      expect.objectContaining({ message: expect.stringContaining("spread") }),
    ]);
  });

  it("accepts a runtime that omits the default zero spread on read-back", () => {
    const context = loadPluginFunctions();
    let stored = [];
    const node = { type: "FRAME", fills: [], setPluginData() {} };
    Object.defineProperty(node, "effects", {
      configurable: true,
      get: () => stored,
      set: (value) => {
        stored = value.map(effect => {
          const copy = { ...effect };
          if (copy.spread === 0) delete copy.spread;
          return copy;
        });
      },
    });
    const report = importReport();
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      shadows: [{ color: "rgba(0,0,0,.2)", offsetX: 0, offsetY: 4, blur: 12, spread: 0 }],
    }, [], { report });
    expect(stored).toHaveLength(1);
    expect(report.styleDegradations).toBe(0);
  });

  it("clears stale CSS effect metadata after native effects recover", () => {
    const context = loadPluginFunctions();
    const pluginData = new Map([["open-canvas-effects-css", "box-shadow:0 4px 12px red"]]);
    let stored = [];
    const node = {
      type: "FRAME",
      effects: stored,
      setPluginData(key, value) { pluginData.set(key, value); },
      getPluginData(key) { return pluginData.get(key) || ""; },
    };
    const report = importReport();

    context.visuals(node, {
      id: "recovered-effects",
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      shadows: [{ color: "rgba(255,0,0,1)", offsetX: 0, offsetY: 4, blur: 12, spread: 0 }],
      shadowCss: "0 4px 12px rgba(255,0,0,1)",
    }, [], { report });

    expect(pluginData.get("open-canvas-effects-css")).toBe("");
    expect(pluginData.get("open-canvas-effects-managed")).toBe("1");
  });

  it("reports silently normalized effect geometry instead of claiming native fidelity", () => {
    const context = loadPluginFunctions();
    let stored = [];
    const node = { type: "FRAME", setPluginData() {} };
    Object.defineProperty(node, "effects", {
      configurable: true,
      get: () => stored,
      set: (value) => {
        // Simulate a Desktop runtime that accepts the write but normalizes
        // the blur radius and offset without throwing.
        stored = value.map(effect => ({
          ...effect,
          ...(effect.radius != null ? { radius: 0 } : {}),
          ...(effect.offset ? { offset: { x: 0, y: 0 } } : {}),
        }));
      },
    });
    const report = importReport();
    const result = context.applyNativeEffects(node, [{
      type: "DROP_SHADOW",
      color: { r: 0, g: 0, b: 0, a: 0.2 },
      offset: { x: 2, y: 4 },
      radius: 12,
      spread: 0,
      visible: true,
      blendMode: "NORMAL",
    }], { id: "normalized-effect" }, report);

    expect(result.applied).toBe(false);
    expect(result.degraded).toContain("DROP_SHADOW");
    expect(report.styleDegradationNodes).toEqual([
      expect.objectContaining({
        id: "normalized-effect",
        message: expect.stringContaining("normalized"),
      }),
    ]);
  });

  it("reports missing native effects instead of silently dropping shadows", () => {
    const context = loadPluginFunctions();
    const pluginData = new Map();
    const node = {
      type: "FRAME",
      fills: [],
      setPluginData(key, value) { pluginData.set(key, value); },
      getPluginData(key) { return pluginData.get(key) || ""; },
    };
    const report = importReport();
    context.visuals(node, {
      id: "effects-missing",
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      shadow: { color: "rgba(0,0,0,.2)", offsetX: 0, offsetY: 4, blur: 12, spread: 0 },
      shadowCss: "0 4px 12px rgba(0,0,0,.2)",
    }, [], { report });
    expect(pluginData.get("open-canvas-effects-css")).toContain("box-shadow:");
    expect(report.styleDegradationNodes).toEqual([
      expect.objectContaining({ id: "effects-missing", message: expect.stringContaining("native effects") }),
    ]);
  });

  it("reports an unparsed text-shadow layer while preserving its source", () => {
    const context = loadPluginFunctions();
    const pluginData = new Map();
    const node = {
      type: "TEXT",
      fills: [],
      effects: [],
      setPluginData(key, value) { pluginData.set(key, value); },
      getPluginData(key) { return pluginData.get(key) || ""; },
    };
    const report = importReport();
    context.visuals(node, {
      id: "text-shadow-unparsed",
      type: "text",
      opacity: 1,
      radius: [0, 0, 0, 0],
      text: { textShadow: "0 2px 4px var(--shadow-color)" },
    }, [], { report });
    expect(pluginData.get("open-canvas-effects-css")).toContain("var(--shadow-color)");
    expect(report.styleDegradationNodes).toEqual([
      expect.objectContaining({ id: "text-shadow-unparsed", message: expect.stringContaining("unparsed") }),
    ]);
  });

  it("reports an unparsed filter drop-shadow layer instead of claiming support", () => {
    const context = loadPluginFunctions();
    const pluginData = new Map();
    const node = {
      type: "FRAME",
      fills: [],
      effects: [],
      setPluginData(key, value) { pluginData.set(key, value); },
      getPluginData(key) { return pluginData.get(key) || ""; },
    };
    const report = importReport();
    context.visuals(node, {
      id: "filter-shadow-unparsed",
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      filter: "drop-shadow(0 2px 4px var(--shadow-color))",
    }, [], { report });
    expect(pluginData.get("open-canvas-effects-css")).toContain("filter:");
    expect(report.styleDegradationNodes).toEqual([
      expect.objectContaining({ id: "filter-shadow-unparsed", message: expect.stringContaining("filter") }),
    ]);
  });

  it("maps webkit text stroke to editable TextNode strokes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.strokeWeight = 0;
    node.strokeAlign = "CENTER";
    const report = importReport();
    context.applyTextStroke(node, {
      id: "outlined-copy",
      type: "text",
      fill: { color: "#101820" },
      computedStyles: { WebkitTextStrokeColor: "rgb(255, 80, 40)" },
      text: { content: "Outlined", textStrokeWidth: "2px", textStrokeColor: "rgb(255, 80, 40)" },
    }, report);
    expect(node.strokes).toEqual([{ type: "SOLID", color: { r: 1, g: 0.3137254901960784, b: 0.1568627450980392 }, opacity: 1 }]);
    expect(node.strokeWeight).toBe(2);
    expect(node.strokeAlign).toBe("CENTER");
    expect(JSON.parse(node.getPluginData("open-canvas-text-stroke"))).toEqual({ width: 2, color: "rgb(255, 80, 40)" });
    expect(report.styleDegradations).toBe(0);
  });

  it("resolves webkit text stroke lengths before writing the TextNode", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.strokeWeight = 0;
    const report = importReport();
    context.applyTextStroke(node, {
      id: "relative-outlined-copy",
      type: "text",
      fill: { color: "#101820" },
      text: {
        content: "Outlined",
        fontSize: 20,
        textStrokeWidth: "min(0.1em, 2px)",
        textStrokeColor: "rgb(255, 80, 40)",
      },
    }, report);
    expect(node.strokeWeight).toBe(2);
    expect(JSON.parse(node.getPluginData("open-canvas-text-stroke"))).toMatchObject({ width: 2 });
    expect(report.styleDegradations).toBe(0);
  });

  it("clears stale webkit text stroke when stroke width returns to zero", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    node.strokes = [{ type: "SOLID", color: { r: 1, g: 0, b: 0 }, opacity: 1 }];
    node.strokeWeight = 2;
    node.setPluginData("open-canvas-text-stroke", JSON.stringify({ width: 2, color: "red" }));

    context.applyTextStroke(node, {
      id: "reused-outlined-copy",
      type: "text",
      text: { content: "Plain", textStrokeWidth: "0px" },
    }, importReport());

    expect(node.strokes).toEqual([]);
    expect(node.strokeWeight).toBe(0);
    expect(node.getPluginData("open-canvas-text-stroke")).toBe("");
  });

  it("reports text stroke when a host does not expose TextNode strokes", () => {
    const context = loadPluginFunctions();
    const node = { type: "TEXT", setPluginData() {} };
    const report = importReport();
    context.applyTextStroke(node, {
      id: "unsupported-outlined-copy",
      type: "text",
      text: { content: "Outlined", textStrokeWidth: 1, textStrokeColor: "#000" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("does not expose TextNode stroke properties");
  });

  it("maps image brightness, contrast, and saturation to ImagePaint filters", () => {
    const context = loadPluginFunctions();
    expect(context.cssImageFilters("brightness(80%) contrast(120%) saturate(0.5)")).toEqual({
      exposure: -0.2,
      contrast: 0.2,
      saturation: -0.5,
    });
    expect(context.cssFilterHasUnsupportedParts("brightness(.8) contrast(1.2) saturate(.5)", true)).toBe(false);
    expect(context.cssFilterHasUnsupportedParts("brightness(.8) hue-rotate(20deg)", true)).toBe(false);
  });

  it("creates an SVG filter fallback for image-only CSS color filters", () => {
    const context = loadPluginFunctions();
    const definition = context.cssFilterSvgDefinition("grayscale(80%) sepia(.2) invert(10%) hue-rotate(20deg)");
    expect(definition).toContain("feColorMatrix");
    expect(definition).toContain("feComponentTransfer");
    expect(definition).toContain("hueRotate");

    const asset = {
      kind: "image",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg width="120" height="80"><rect width="120" height="80" fill="red"/></svg>')}`,
    };
    const svg = context.filteredImageSvg(asset, {
      rect: { width: 160, height: 100 },
      filter: "grayscale(100%) hue-rotate(20deg) opacity(50%)",
      objectFit: "cover",
      objectPosition: "center",
      radius: [12, 12, 12, 12],
      computedStyles: {},
    });
    expect(svg).toContain('filter="url(#cssImageFilter)"');
    expect(svg).toContain('<clipPath id="clip">');
    expect(svg).not.toContain('slope="0.5"');
  });

  it("uses the filtered SVG path during image import and avoids a false degradation", async () => {
    const context = loadPluginFunctions();
    context.figma.createImage = () => ({ hash: "image-filter" });
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const asset = {
      id: "filtered-poster",
      kind: "image",
      data: `data:image/svg+xml;base64,${globalThis.btoa('<svg width="120" height="80"><rect width="120" height="80" fill="red"/></svg>')}`,
    };
    const report = importReport();
    const parent = { type: "PAGE", children: [], appendChild: mockFigmaNode("PAGE").appendChild };
    const imported = await context.createNode({
      id: "filtered-poster-node",
      type: "image",
      rect: { x: 0, y: 0, width: 160, height: 100 },
      opacity: 1,
      radius: [12, 12, 12, 12],
      margin: [0, 0, 0, 0],
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      assetId: "filtered-poster",
      objectFit: "cover",
      objectPosition: "center",
      filter: "grayscale(100%) hue-rotate(20deg)",
      computedStyles: {},
      children: [],
    }, parent, [asset], report, undefined, { images: new Map(), vectors: new Map() });

    expect(imported.type).toBe("VECTOR");
    expect(imported.getPluginData("open-canvas-filter-svg")).toBe("1");
    expect(imported.getPluginData("open-canvas-image-fallback-kind")).toBe("filter");
    expect(imported.getPluginData("open-canvas-image-fallback-asset-id")).toBe("filtered-poster");
    expect(imported.getPluginData("open-canvas-image-fallback-geometry")).toBe(JSON.stringify({ width: 160, height: 100 }));
    expect(report.styleDegradations).toBe(0);
  });

  it("maps CSS filter opacity into the imported node opacity", () => {
    const context = loadPluginFunctions();
    expect(context.cssFilterOpacity("opacity(50%)")).toBe(0.5);
    expect(context.cssFilterOpacity("opacity(.5)")).toBe(0.5);
    expect(context.cssFilterOpacity("opacity(200%)")).toBe(1);
    expect(context.cssFilterOpacity("opacity(-1)")).toBe(0);
    expect(context.cssFilterOpacity("opacity(invalid)")).toBe(1);
    expect(context.cssFilterWithoutOpacity("grayscale(100%) opacity(50%)")).toBe("grayscale(100%)");
    expect(context.cssFilterHasUnsupportedParts("opacity(.5) blur(4px)")).toBe(false);
  });

  it("reports vertical writing and bidi styles instead of silently flattening them", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "vertical-copy",
      computedStyles: {
        writingMode: "vertical-rl",
        textOrientation: "upright",
        unicodeBidi: "isolate",
      },
    }, report);
    expect(report.styleDegradations).toBe(3);
    expect(report.styleDegradationNodes.map(entry => entry.message)).toEqual([
      "writing-mode vertical-rl is not supported by Figma TextNode",
      "text-orientation upright is not supported by Figma TextNode",
      "unicode-bidi isolate is not supported by Figma TextNode",
    ]);
  });

  it("does not report flex-shrink zero because the importer maps it to a native min-size guard", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "shrinking-card",
      computedStyles: { flexShrink: "0" },
    }, report);
    expect(report.styleDegradations).toBe(0);
    expect(report.styleDegradationNodes).toEqual([]);
  });

  it("reports weighted flex-shrink values while keeping them inspectable", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "weighted-shrinking-card",
      computedStyles: { flexShrink: "0.5" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("flex-shrink 0.5");
  });

  it("does not report font-stretch when a matching native Figma style was loaded", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    const node = mockFigmaNode("TEXT");
    node.setPluginData("open-canvas-font-stretch-native", "75%");
    context.recordSceneDegradations({
      id: "condensed-copy",
      type: "text",
      computedStyles: { fontStretch: "75%" },
    }, report, [], node);
    expect(report.styleDegradations).toBe(0);
    expect(report.styleDegradationNodes).toEqual([]);
  });

  it("reports dense grid packing instead of claiming native Auto Layout support", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "dense-grid",
      layout: { gridAutoFlow: "row dense" },
      computedStyles: {},
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("grid-auto-flow: dense");
  });

  it("reports non-scroll background attachment instead of silently flattening it", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "fixed-background",
      backgroundAttachment: "fixed",
      computedStyles: {},
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("background-attachment fixed");
  });

  it("does not report repeated default scroll attachments from layered backgrounds", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "layered-scroll-background",
      backgroundAttachment: "scroll, scroll",
      computedStyles: {},
    }, report);
    expect(report.styleDegradations).toBe(0);
    expect(report.styleDegradationNodes).toEqual([]);
  });

  it("reports unsupported mix-blend-mode values instead of mapping them silently to normal", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "blended-card",
      computedStyles: { mixBlendMode: "vivid-light" },
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("mix-blend-mode vivid-light");
  });

  it("maps CSS isolation to an isolated Figma compositing context", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      computedStyles: { isolation: "isolate", mixBlendMode: "normal" },
    });
    expect(node.blendMode).toBe("NORMAL");
  });

  it("clears a stale node blend mode when the source returns to normal flow", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.blendMode = "MULTIPLY";

    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      computedStyles: { mixBlendMode: "normal", isolation: "auto" },
    });

    expect(node.blendMode).toBe("PASS_THROUGH");
  });

  it("clears a stale node blend mode during final visual constraint verification", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.blendMode = "SCREEN";
    const report = importReport();

    context.verifySceneVisualConstraints({
      id: "normal-compositing-state",
      type: "frame",
      opacity: 1,
      computedStyles: { mixBlendMode: "normal", isolation: "auto" },
      children: [],
    }, node, report);

    expect(node.blendMode).toBe("PASS_THROUGH");
  });

  it("does not report supported isolation as a degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "isolated-card",
      computedStyles: { isolation: "isolate" },
    }, report);
    expect(report.styleDegradations).toBe(0);
    expect(report.styleDegradationNodes).toEqual([]);
  });

  it("does not report an exact uniform double-border vector as degraded", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "uniform-double-border",
      borders: [0, 1, 2, 3].map(() => ({ color: "rgb(20, 40, 60)", width: 6, style: "double" })),
      computedStyles: {},
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("reports visual fallbacks only after the complete border decoration pass", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const report = importReport();
    const scene = {
      id: "uniform-inset-border",
      type: "frame",
      rect: { x: 0, y: 0, width: 160, height: 80 },
      opacity: 1,
      radius: [12, 12, 12, 12],
      margin: [0, 0, 0, 0],
      stroke: { color: "rgb(40, 50, 60)", width: 6, style: "inset" },
      borders: [0, 1, 2, 3].map(() => ({ color: "rgb(40, 50, 60)", width: 6, style: "inset" })),
      computedStyles: {},
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [],
    };

    const imported = await context.createNode(
      scene,
      mockFigmaNode("PAGE"),
      [],
      report,
      undefined,
      { images: new Map(), vectors: new Map() },
    );

    expect(imported.children.some(child => child.name === "__css-border-rounded")).toBe(true);
    expect(report.styleDegradations).toBe(0);
  });

  it("continues to report multi-color double borders that use side fallbacks", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "multi-color-double-border",
      borders: ["#ff0000", "#00ff00", "#0000ff", "#000000"].map(color => ({ color, width: 6, style: "double" })),
      computedStyles: {},
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("border-style double");
  });

  it("maps CSS linear blend aliases to Figma linear blend modes", () => {
    const context = loadPluginFunctions();
    expect(context.blendModeValue("linear-burn")).toBe("LINEAR_BURN");
    expect(context.blendModeValue("plus-darker")).toBe("LINEAR_BURN");
    expect(context.blendModeValue("linear-dodge")).toBe("LINEAR_DODGE");
    expect(context.blendModeValue("plus-lighter")).toBe("LINEAR_DODGE");
  });

  it("reports subtree containment constraints that Figma cannot recreate", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "contained-panel",
      computedStyles: { contain: "layout paint", contentVisibility: "auto" },
    }, report);
    expect(report.styleDegradations).toBe(2);
    expect(report.styleDegradationNodes.map(entry => entry.message)).toEqual([
      "contain layout paint is partially mapped: size containment uses fixed captured axes; Figma has no equivalent subtree constraint for layout",
      "content-visibility auto is not supported by Figma",
    ]);
  });

  it("maps paint containment to clipping without reporting a false degradation", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.visuals(node, {
      type: "frame",
      rect: { width: 120, height: 80 },
      radius: [0, 0, 0, 0],
      computedStyles: { contain: "paint" },
    });
    expect(node.clipsContent).toBe(true);

    const report = importReport();
    context.recordSceneDegradations({ id: "paint-contained-panel", computedStyles: { contain: "paint" } }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("retains overflow clip margin as metadata and reports the native gap", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const report = importReport();
    context.applySceneCompositingConstraints(node, {
      id: "clip-margin-panel",
      type: "frame",
      computedStyles: { overflowClipMargin: "12px" },
      children: [],
    });
    context.recordSceneDegradations({
      id: "clip-margin-panel",
      computedStyles: { overflowClipMargin: "12px" },
    }, report);
    expect(node.getPluginData("open-canvas-overflow-clip-margin")).toBe("12px");
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("overflow-clip-margin 12px");
  });

  it("retains logical overflow clip margins as metadata and reports their native gap", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const report = importReport();
    const scene = {
      id: "logical-clip-margin-panel",
      type: "frame",
      computedStyles: {
        overflowClipMarginBlockStart: "8px",
        overflowClipMarginInlineEnd: "16px",
      },
    };
    context.applySceneCompositingConstraints(node, scene);
    context.recordSceneDegradations(scene, report);
    expect(JSON.parse(node.getPluginData("open-canvas-overflow-clip-margin-logical"))).toEqual({
      values: {
        overflowClipMarginBlockStart: "8px",
        overflowClipMarginInlineEnd: "16px",
      },
      measuredGeometry: true,
      nativeEquivalent: false,
    });
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("logical values");
    expect(report.styleDegradationNodes[0].message).toContain("overflowClipMarginBlockStart");
  });

  it("clears stale overflow clip-margin metadata when the source returns to defaults", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applySceneCompositingConstraints(node, {
      id: "reused-clip-margin-panel",
      type: "frame",
      computedStyles: {
        overflow: "clip",
        overflowClipMargin: "12px",
        overflowClipMarginBlockStart: "8px",
      },
      children: [],
    });
    expect(node.getPluginData("open-canvas-overflow-clip-margin")).toBe("12px");
    expect(node.getPluginData("open-canvas-overflow-clip-margin-logical")).not.toBe("");

    context.applySceneCompositingConstraints(node, {
      id: "reused-clip-margin-panel",
      type: "frame",
      computedStyles: {
        overflow: "visible",
        overflowClipMargin: "0px",
        overflowClipMarginBlockStart: "0px",
      },
      children: [],
    });

    expect(node.getPluginData("open-canvas-overflow-clip-margin")).toBe("");
    expect(node.getPluginData("open-canvas-overflow-clip-margin-logical")).toBe("");
  });

  it("uses an expanded vector mask for uniform overflow-clip-margin", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(100, 40);
    context.visuals(node, {
      type: "frame",
      rect: { width: 100, height: 40 },
      computedStyles: { overflow: "clip", overflowClipMargin: "12px" },
    });
    expect(node.children).toHaveLength(1);
    expect(node.children[0]).toMatchObject({
      name: "__css-overflow-clip-margin-mask",
      width: 124,
      height: 64,
      x: -12,
      y: -12,
      isMask: true,
    });
    expect(node.clipsContent).toBe(false);
    expect(svg).toContain('width="124" height="64"');
  });

  it("composes circular corner radii into the expanded overflow mask", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(100, 40);
    context.visuals(node, {
      type: "frame",
      rect: { width: 100, height: 40 },
      radius: [8, 8, 8, 8],
      computedStyles: { overflow: "clip", overflowClipMargin: "12px" },
    });
    expect(node.children.map(child => child.name)).toEqual(["__css-overflow-clip-margin-mask"]);
    expect(node.clipsContent).toBe(false);
    expect(svg).toContain('width="124" height="64"');
    expect(svg).toContain("A 20 20");
  });

  it("recovers simple radii from a trimmed computed-style payload", () => {
    const context = loadPluginFunctions();
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };
    const node = mockFigmaNode("FRAME");
    node.resize(100, 40);
    context.visuals(node, {
      type: "frame",
      rect: { width: 100, height: 40 },
      computedStyles: {
        overflow: "clip",
        overflowClipMargin: "12px",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        borderBottomRightRadius: "8px",
        borderBottomLeftRadius: "8px",
      },
    });
    expect(svg).toContain("A 20 20");
    expect(node.clipsContent).toBe(false);
  });

  it("keeps two-axis elliptical radii on the existing clipping path", () => {
    const context = loadPluginFunctions();
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const node = mockFigmaNode("FRAME");
    node.resize(100, 40);
    context.visuals(node, {
      type: "frame",
      rect: { width: 100, height: 40 },
      radius: [8, 8, 8, 8],
      computedStyles: {
        overflow: "clip",
        overflowClipMargin: "12px",
        borderTopLeftRadius: "8px 4px",
        borderTopRightRadius: "8px 4px",
        borderBottomRightRadius: "8px 4px",
        borderBottomLeftRadius: "8px 4px",
      },
    });
    expect(node.children.map(child => child.name)).toContain("__css-elliptical-radius-mask");
    expect(node.children.map(child => child.name)).not.toContain("__css-overflow-clip-margin-mask");
    expect(node.clipsContent).toBe(true);
  });

  it("maps logical overflow clip margins through horizontal RTL", () => {
    const context = loadPluginFunctions();
    const insets = context.overflowClipMarginInsets({
      type: "frame",
      overflow: "clip",
      computedStyles: {
        direction: "rtl",
        overflowClipMarginBlockStart: "8px",
        overflowClipMarginBlockEnd: "4px",
        overflowClipMarginInlineStart: "3px",
        overflowClipMarginInlineEnd: "5px",
      },
    }, 100, 40);
    expect(insets).toEqual({ top: 8, right: 3, bottom: 4, left: 5 });
  });

  it("maps logical overflow clip margins through vertical-rl writing mode", () => {
    const context = loadPluginFunctions();
    const insets = context.overflowClipMarginInsets({
      type: "frame",
      overflow: "clip",
      computedStyles: {
        writingMode: "vertical-rl",
        direction: "ltr",
        overflowClipMarginBlockStart: "8px",
        overflowClipMarginBlockEnd: "4px",
        overflowClipMarginInlineStart: "3px",
        overflowClipMarginInlineEnd: "5px",
      },
    }, 100, 40);
    expect(insets).toEqual({ top: 3, right: 8, bottom: 5, left: 4 });
  });

  it("resolves percentage and calc overflow clip margins on their logical axes", () => {
    const context = loadPluginFunctions();
    expect(context.overflowClipMarginInsets({
      type: "frame",
      overflow: "clip",
      computedStyles: { overflowClipMargin: "10%" },
    }, 100, 40)).toEqual({ top: 4, right: 10, bottom: 4, left: 10 });
    expect(context.overflowClipMarginInsets({
      type: "frame",
      overflow: "clip",
      computedStyles: { overflowClipMargin: "calc(4px + 6px)" },
    }, 100, 40)).toEqual({ top: 10, right: 10, bottom: 10, left: 10 });
  });

  it("resolves font-relative and functional overflow clip margins", () => {
    const context = loadPluginFunctions();
    expect(context.overflowClipMarginInsets({
      type: "frame",
      rect: { width: 100, height: 40 },
      rootFontSize: 16,
      computedStyles: {
        overflow: "clip",
        fontSize: "20px",
        overflowClipMargin: "1em",
      },
    }, 100, 40)).toEqual({ top: 20, right: 20, bottom: 20, left: 20 });

    expect(context.overflowClipMarginInsets({
      type: "frame",
      rect: { width: 100, height: 40 },
      computedStyles: {
        overflow: "clip",
        fontSize: "20px",
        overflowClipMargin: "calc(0.5em + 2px)",
      },
    }, 100, 40)).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });

    expect(context.overflowClipMarginInsets({
      type: "frame",
      rect: { width: 100, height: 40 },
      computedStyles: {
        overflow: "clip",
        fontSize: "20px",
        overflowClipMargin: "min(20px, 0.75em)",
      },
    }, 100, 40)).toEqual({ top: 15, right: 15, bottom: 15, left: 15 });
  });

  it("composes font-relative rounded radii in the overflow clip mask", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    let svg = "";
    context.figma.createNodeFromSvg = value => {
      svg = value;
      return mockFigmaNode("VECTOR");
    };

    expect(context.applyOverflowClipMarginMask(parent, {
      id: "relative-clip-radius",
      type: "frame",
      rect: { width: 100, height: 40 },
      computedStyles: {
        overflow: "clip",
        fontSize: "20px",
        overflowClipMargin: "4px",
        borderTopLeftRadius: "0.5em",
        borderTopRightRadius: "0.5em",
        borderBottomRightRadius: "0.5em",
        borderBottomLeftRadius: "0.5em",
      },
    })).toBe(true);
    expect(svg).toContain("A 14 14");
  });

  it("does not let compatibility default logical fields erase a shorthand margin", () => {
    const context = loadPluginFunctions();
    expect(context.overflowClipMarginInsets({
      type: "frame",
      overflow: "clip",
      computedStyles: {
        overflowClipMargin: "12px",
        overflowClipMarginBlock: "0px",
        overflowClipMarginBlockStart: "0px",
        overflowClipMarginBlockEnd: "0px",
        overflowClipMarginInline: "0px",
        overflowClipMarginInlineStart: "0px",
        overflowClipMarginInlineEnd: "0px",
      },
    }, 100, 40)).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
  });

  it("rebuilds an overflow clip-margin mask after final-size convergence", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.resize(100, 40);
    const oldMask = mockFigmaNode("VECTOR");
    oldMask.name = "__css-overflow-clip-margin-mask";
    oldMask.resize(124, 64);
    oldMask.x = -12;
    oldMask.y = -12;
    oldMask.remove = () => {
      const index = parent.children.indexOf(oldMask);
      if (index >= 0) parent.children.splice(index, 1);
    };
    const content = mockFigmaNode("TEXT");
    content.name = "content";
    parent.appendChild(oldMask);
    parent.appendChild(content);
    const created = [];
    context.figma.createNodeFromSvg = () => {
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = parent.children.indexOf(mask);
        if (index >= 0) parent.children.splice(index, 1);
      };
      created.push(mask);
      return mask;
    };
    parent.resize(120, 50);
    context.syncMaskAndClipFallbacks(parent, {
      type: "frame",
      rect: { width: 120, height: 50 },
      overflow: "clip",
      computedStyles: { overflow: "clip", overflowClipMargin: "12px" },
    });
    expect(created).toHaveLength(1);
    expect(parent.children[0]).toBe(created[0]);
    expect(created[0]).toMatchObject({ name: "__css-overflow-clip-margin-mask", width: 144, height: 74, x: -12, y: -12 });
    expect(parent.children[1]).toBe(content);
  });

  it("rebuilds an overflow clip-margin mask when only the same-size radius changes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(100, 40);
    let created = 0;
    const svgs = [];
    context.figma.createNodeFromSvg = svg => {
      created += 1;
      svgs.push(svg);
      const mask = mockFigmaNode("VECTOR");
      mask.remove = () => {
        const index = node.children.indexOf(mask);
        if (index >= 0) node.children.splice(index, 1);
      };
      return mask;
    };
    const scene = {
      id: "overflow-radius-change",
      type: "frame",
      rect: { width: 100, height: 40 },
      overflow: "clip",
      radius: [8, 8, 8, 8],
      computedStyles: {
        overflow: "clip",
        overflowClipMargin: "12px",
        borderTopLeftRadius: "8px",
        borderTopRightRadius: "8px",
        borderBottomRightRadius: "8px",
        borderBottomLeftRadius: "8px",
      },
    };
    expect(context.applyOverflowClipMarginMask(node, scene)).toBe(true);
    expect(created).toBe(1);

    scene.radius = [20, 20, 20, 20];
    for (const key of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomRightRadius", "borderBottomLeftRadius"]) {
      scene.computedStyles[key] = "20px";
    }
    context.syncMaskAndClipFallbacks(node, scene, []);

    expect(created).toBe(2);
    expect(node.children).toHaveLength(1);
    expect(svgs[1]).toContain("A 32 32");
    expect(node.children[0].getPluginData("open-canvas-overflow-clip-margin-mask-source-signature")).toContain("20");
  });

  it("does not stack an overflow clip-margin mask with another clip primitive", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(100, 40);
    const stale = mockFigmaNode("VECTOR");
    stale.name = "__css-overflow-clip-margin-mask";
    stale.remove = () => {
      const index = node.children.indexOf(stale);
      if (index >= 0) node.children.splice(index, 1);
    };
    node.appendChild(stale);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    context.visuals(node, {
      type: "frame",
      rect: { width: 100, height: 40 },
      computedStyles: { overflow: "clip", overflowClipMargin: "12px", clipPath: "inset(0)" },
    });
    expect(node.children.some(child => child.name === "__css-overflow-clip-margin-mask")).toBe(false);
    expect(node.clipsContent).toBe(true);
  });

  it("does not report size containment as wholly unsupported", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "size-contained-panel",
      computedStyles: { contain: "size" },
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("keeps containment semantics inspectable on imported nodes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyContainmentMetadata(node, {
      id: "contained-metadata-panel",
      rect: { x: 12, y: 24, width: 320, height: 180 },
      computedStyles: { contain: "layout paint" },
    });
    expect(JSON.parse(node.getPluginData("open-canvas-containment"))).toEqual({
      value: "layout paint",
      tokens: ["layout", "paint"],
      layout: true,
      paint: true,
      size: false,
      style: false,
      content: false,
      measuredRect: { x: 12, y: 24, width: 320, height: 180 },
      mappedToClipsContent: true,
    });
  });

  it("recovers containment from the H2D marker when styles are trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-containment-panel",
      tag: "DIV",
      attributes: {
        "data-open-canvas-containment": JSON.stringify({
          value: "content",
          tokens: ["content"],
          layout: true,
          paint: true,
          size: false,
          style: false,
          content: true,
        }),
      },
      styles: {},
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles.contain).toBe("content");
  });

  it("does not let computed none mask a retained containment marker", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyContainmentMetadata(node, {
      id: "defaulted-containment-panel",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      computedStyles: { contain: "none" },
      attributes: {
        "data-open-canvas-containment": JSON.stringify({
          value: "layout paint",
          tokens: ["layout", "paint"],
          layout: true,
          paint: true,
        }),
      },
    });
    expect(JSON.parse(node.getPluginData("open-canvas-containment"))).toMatchObject({
      value: "layout paint",
      tokens: ["layout", "paint"],
      layout: true,
      paint: true,
    });
  });

  it("clears stale constraint metadata when a later payload returns to defaults", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.setPluginData("open-canvas-containment", JSON.stringify({ value: "paint" }));
    node.setPluginData("open-canvas-grid-flow", JSON.stringify({ value: "row dense" }));
    node.setPluginData("open-canvas-multicolumn", JSON.stringify({ columnCount: "2" }));
    node.setPluginData("open-canvas-scroll-constraints", JSON.stringify({ scrollSnapType: "x mandatory" }));
    node.setPluginData("open-canvas-anchor-positioning", JSON.stringify({ values: { anchorName: "--trigger" } }));
    node.setPluginData("open-canvas-container-queries", JSON.stringify({ values: { containerName: "card" } }));

    const scene = {
      id: "default-constraint-state",
      computedStyles: {
        contain: "none",
        gridAutoFlow: "row",
        columnCount: "auto",
        columnWidth: "auto",
        scrollSnapType: "none",
        anchorName: "none",
        containerName: "none",
        containerType: "normal",
      },
      layout: { gridAutoFlow: "row" },
    };
    context.applyContainmentMetadata(node, scene);
    context.applyGridFlowMetadata(node, scene);
    context.applyMultiColumnMetadata(node, scene);
    context.applyScrollConstraintMetadata(node, scene);
    context.applyAnchorPositioningMetadata(node, scene);
    context.applyContainerQueryMetadata(node, scene);

    for (const key of [
      "open-canvas-containment",
      "open-canvas-grid-flow",
      "open-canvas-multicolumn",
      "open-canvas-scroll-constraints",
      "open-canvas-anchor-positioning",
      "open-canvas-container-queries",
    ]) {
      expect(node.getPluginData(key)).toBe("");
    }
  });

  it("restores containment behavior when a trimmed H2D wrapper reports none", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "defaulted-trimmed-containment-panel",
      tag: "DIV",
      attributes: {
        "data-open-canvas-containment": JSON.stringify({
          value: "paint",
          tokens: ["paint"],
          layout: false,
          paint: true,
          size: false,
          style: false,
          content: false,
        }),
      },
      styles: { contain: "none" },
      computedStyles: { contain: "none" },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles.contain).toBe("paint");
  });

  it("recovers clipping, masking, and overflow from a trimmed H2D marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-visual-constraints",
      tag: "DIV",
      attributes: {
        "data-open-canvas-visual-constraints": JSON.stringify({
          values: {
            clipPath: "inset(4px round 8px)",
            overflowX: "hidden",
            maskImage: "linear-gradient(90deg, transparent, #000)",
            maskPosition: "20% 0%",
            maskMode: "luminance",
            maskComposite: "intersect",
            borderImageSource: "linear-gradient(90deg, #f00, #00f)",
            borderImageSlice: "30%",
            borderImageRepeat: "round",
            opacity: "0.5",
            filter: "blur(4px)",
            backdropFilter: "blur(8px)",
            mixBlendMode: "multiply",
            backgroundBlendMode: "screen",
            isolation: "isolate",
          },
          measuredGeometry: true,
        }),
      },
      styles: {
        maskImage: "none",
        overflowX: "visible",
        opacity: "1",
        filter: "none",
        backdropFilter: "none",
        mixBlendMode: "normal",
        backgroundBlendMode: "normal",
        isolation: "auto",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      clipPath: "inset(4px round 8px)",
      overflowX: "hidden",
      maskImage: "linear-gradient(90deg, transparent, #000)",
      maskPosition: "20% 0%",
      maskMode: "luminance",
      maskComposite: "intersect",
      borderImageSource: "linear-gradient(90deg, #f00, #00f)",
      borderImageSlice: "30%",
      borderImageRepeat: "round",
      opacity: "0.5",
      filter: "blur(4px)",
      backdropFilter: "blur(8px)",
      mixBlendMode: "multiply",
      backgroundBlendMode: "screen",
      isolation: "isolate",
    });
    expect(scene.opacity).toBe(0.5);
  });

  it("recovers a trimmed background asset reference from the H2D marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-background-asset",
      tag: "DIV",
      attributes: { "data-open-canvas-background-asset-id": "background-svg" },
      styles: {},
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.backgroundAssetId).toBe("background-svg");
  });

  it("recovers a trimmed transform and transform-origin from the H2D marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-transform",
      tag: "DIV",
      attributes: {
        "data-open-canvas-transform": JSON.stringify({
          transform: "rotate(12deg)",
          transformOrigin: "left bottom",
          measuredGeometry: true,
        }),
      },
      styles: { transform: "none", transformOrigin: "50% 50%" },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      transform: "rotate(12deg)",
      transformOrigin: "left bottom",
    });
    expect(scene.transform).toBe("rotate(12deg)");
    expect(scene.transformOrigin).toBe("left bottom");
  });

  it("does not let a transform marker override an authored non-default style", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "authored-transform-wins",
      tag: "DIV",
      attributes: {
        "data-open-canvas-transform": JSON.stringify({
          transform: "rotate(12deg)",
          transformOrigin: "left bottom",
          measuredGeometry: true,
        }),
      },
      styles: { transform: "scale(1.25)", transformOrigin: "20px 10px" },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      transform: "scale(1.25)",
      transformOrigin: "20px 10px",
    });
    expect(scene.transform).toBe("scale(1.25)");
    expect(scene.transformOrigin).toBe("20px 10px");
  });

  it("recovers image rendering and background attachment constraints from a trimmed marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-image-rendering",
      tag: "IMG",
      attributes: {
        "data-open-canvas-visual-constraints": JSON.stringify({
          values: {
            backgroundAttachment: "fixed",
            objectFit: "cover",
            objectPosition: "25% 50%",
            objectViewBox: "inset(10% 20% 10% 20%)",
          },
          measuredGeometry: true,
        }),
      },
      styles: {
        backgroundAttachment: "scroll",
        objectFit: "fill",
        objectPosition: "50% 50%",
        objectViewBox: "none",
      },
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene).toMatchObject({
      backgroundAttachment: "fixed",
      objectFit: "cover",
      objectPosition: "25% 50%",
      objectViewBox: "inset(10% 20% 10% 20%)",
    });
  });

  it("recovers structural semantics from a trimmed H2D marker", () => {
    const context = loadPluginFunctions();
    const structuralSemantics = [{ role: "navigation", label: "Primary navigation", states: { expanded: "true" } }];
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "contents-wrapper-child",
      tag: "SPAN",
      attributes: {
        "data-open-canvas-structural-semantics": JSON.stringify(structuralSemantics),
      },
      styles: {},
      rect: { x: 0, y: 0, width: 120, height: 24 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.structuralSemantics).toEqual(structuralSemantics);
  });

  it("de-duplicates structural semantic coverage copied to flattened descendants", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    const semantics = [{ role: "navigation", label: "Primary navigation" }];
    context.recordSemanticCoverage({
      id: "flattened-child-a",
      structuralSemantics: semantics,
      structuralSemanticOwners: ["contents-owner"],
    }, report);
    context.recordSemanticCoverage({
      id: "flattened-child-b",
      structuralSemantics: semantics,
      structuralSemanticOwners: ["contents-owner"],
    }, report);
    context.recordSemanticCoverage({
      id: "second-contents-owner-child",
      structuralSemantics: semantics,
      structuralSemanticOwners: ["second-owner"],
    }, report);
    expect(report.semanticNodes).toBe(2);
    expect(report.semanticNamedLayers).toBe(2);
  });

  it("keeps dense Grid auto-flow inspectable on imported nodes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyGridFlowMetadata(node, {
      id: "dense-grid-panel",
      rect: { x: 4, y: 8, width: 320, height: 180 },
      layout: { gridAutoFlow: "row dense" },
      computedStyles: {},
    });
    expect(JSON.parse(node.getPluginData("open-canvas-grid-flow"))).toEqual({
      value: "row dense",
      dense: true,
      measuredGeometry: true,
      nativeAutoLayoutEquivalent: false,
    });
  });

  it("recovers dense Grid auto-flow from the H2D marker when styles are trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-dense-grid",
      tag: "DIV",
      attributes: {
        "data-open-canvas-grid-flow": JSON.stringify({
          value: "row dense",
          dense: true,
          measuredGeometry: true,
          nativeAutoLayoutEquivalent: false,
        }),
      },
      styles: {},
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles.gridAutoFlow).toBe("row dense");
  });

  it("keeps CSS Anchor Positioning inspectable and reports its measured fallback", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const report = importReport();
    context.applyAnchorPositioningMetadata(node, {
      id: "anchor-popover",
      rect: { x: 12, y: 48, width: 240, height: 120 },
      computedStyles: {
        anchorName: "--trigger",
        anchorScope: "--scope",
        positionAnchor: "--trigger",
        positionArea: "bottom span-inline-end",
      },
    }, report);

    expect(JSON.parse(node.getPluginData("open-canvas-anchor-positioning"))).toEqual({
      values: {
        anchorName: "--trigger",
        anchorScope: "--scope",
        positionAnchor: "--trigger",
        positionArea: "bottom span-inline-end",
      },
      measuredGeometry: true,
      nativeEquivalent: false,
    });
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0]).toMatchObject({ id: "anchor-popover" });
    expect(report.styleDegradationNodes[0].message).toContain("CSS Anchor Positioning");
  });

  it("recovers CSS Anchor Positioning values from a trimmed H2D marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-anchor-popover",
      tag: "DIV",
      attributes: {
        "data-open-canvas-anchor-positioning": JSON.stringify({
          values: {
            anchorName: "--trigger",
            positionAnchor: "--trigger",
            positionTryFallbacks: "--fallback",
          },
          measuredGeometry: true,
          nativeEquivalent: false,
        }),
      },
      styles: {},
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      anchorName: "--trigger",
      positionAnchor: "--trigger",
      positionTryFallbacks: "--fallback",
    });
  });

  it("keeps container-query conditions inspectable and reports the measured fallback", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    const report = importReport();
    context.applyContainerQueryMetadata(node, {
      id: "container-query-card",
      rect: { x: 12, y: 48, width: 320, height: 180 },
      computedStyles: {
        container: "card / inline-size",
        containerName: "card",
        containerType: "inline-size",
      },
    }, report);

    expect(JSON.parse(node.getPluginData("open-canvas-container-queries"))).toEqual({
      values: {
        container: "card / inline-size",
        containerName: "card",
        containerType: "inline-size",
      },
      measuredGeometry: true,
      nativeEquivalent: false,
    });
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("CSS Container Queries");
  });

  it("recovers container-query values from a trimmed H2D marker", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-container-query-card",
      tag: "DIV",
      attributes: {
        "data-open-canvas-container-queries": JSON.stringify({
          values: { containerName: "card", containerType: "inline-size" },
          measuredGeometry: true,
          nativeEquivalent: false,
        }),
      },
      styles: {},
      rect: { x: 0, y: 0, width: 320, height: 180 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      containerName: "card",
      containerType: "inline-size",
    });
  });

  it("keeps multi-column declarations inspectable on imported nodes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    context.applyMultiColumnMetadata(node, {
      id: "multicolumn-panel",
      rect: { x: 4, y: 8, width: 320, height: 180 },
      computedStyles: {
        columnCount: "2",
        columnWidth: "180px",
        columnGap: "24px",
        columnFill: "balance",
      },
    });
    expect(JSON.parse(node.getPluginData("open-canvas-multicolumn"))).toEqual({
      columnCount: "2",
      columnWidth: "180px",
      columnGap: "24px",
      columnFill: "balance",
      measuredGeometry: true,
      nativeAutoLayoutEquivalent: false,
    });
  });

  it("recovers multi-column declarations from the H2D marker when styles are trimmed", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "trimmed-multicolumn",
      tag: "ARTICLE",
      attributes: {
        "data-open-canvas-multicolumn": JSON.stringify({
          columnCount: "2",
          columnWidth: "180px",
          columnGap: "24px",
          columnFill: "balance",
          measuredGeometry: true,
          nativeAutoLayoutEquivalent: false,
        }),
      },
      styles: {},
      rect: { x: 0, y: 0, width: 240, height: 120 },
      childNodes: [],
    }, { x: 0, y: 0 });
    expect(scene.computedStyles).toMatchObject({
      columnCount: "2",
      columnWidth: "180px",
    });
  });

  it("lets retained constraint markers override computed defaults", () => {
    const context = loadPluginFunctions();
    const scene = context.sceneFromH2D({
      nodeType: 1,
      id: "defaulted-constraint-markers",
      tag: "DIV",
      attributes: {
        "data-open-canvas-grid-flow": JSON.stringify({ value: "row dense", dense: true }),
        "data-open-canvas-multicolumn": JSON.stringify({
          columnCount: "2", columnWidth: "180px", columnGap: "24px", columnFill: "balance",
        }),
        "data-open-canvas-scroll-constraints": JSON.stringify({
          values: { scrollSnapType: "x mandatory", overscrollBehavior: "contain" },
        }),
        "data-open-canvas-anchor-positioning": JSON.stringify({
          values: { anchorName: "--trigger", positionAnchor: "--trigger" },
        }),
        "data-open-canvas-container-queries": JSON.stringify({
          values: { containerName: "card", containerType: "inline-size" },
        }),
        "data-open-canvas-sizing-constraints": JSON.stringify({
          values: { minWidth: "50%", maxHeight: "25%" },
        }),
      },
      styles: {
        gridAutoFlow: "row",
        columnCount: "auto",
        columnWidth: "auto",
        columnGap: "normal",
        columnFill: "balance",
        scrollSnapType: "none",
        overscrollBehavior: "auto",
        anchorName: "none",
        positionAnchor: "none",
        containerName: "none",
        containerType: "normal",
      },
      computedStyles: {
        gridAutoFlow: "row",
        columnCount: "auto",
        columnWidth: "auto",
        columnGap: "normal",
        columnFill: "balance",
        scrollSnapType: "none",
        overscrollBehavior: "auto",
        anchorName: "none",
        positionAnchor: "none",
        containerName: "none",
        containerType: "normal",
      },
      rect: { x: 0, y: 0, width: 320, height: 180 },
      childNodes: [],
    }, { x: 0, y: 0 });

    expect(scene.computedStyles).toMatchObject({
      gridAutoFlow: "row dense",
      columnCount: "2",
      columnWidth: "180px",
      columnGap: "24px",
      scrollSnapType: "x mandatory",
      overscrollBehavior: "contain",
      anchorName: "--trigger",
      positionAnchor: "--trigger",
      containerName: "card",
      containerType: "inline-size",
    });
    expect(scene.sizingConstraints).toMatchObject({ minWidth: "50%", maxHeight: "25%" });
  });

  it("does not report content-visibility hidden after mapping it to a hidden node", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "hidden-panel",
      computedStyles: { contentVisibility: "hidden" },
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  it("multiplies captured opacity by CSS filter opacity", () => {
    const context = loadPluginFunctions();
    expect(context.effectiveSceneOpacity({ opacity: 0.8, filter: "opacity(50%)" })).toBe(0.4);
    expect(context.effectiveSceneOpacity({ opacity: 0.8, filter: "opacity(50%) opacity(25%)" })).toBe(0.1);
  });

  it("preserves supported text decoration and reports CSS combinations Figma cannot express", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("TEXT");
    const report = importReport();
    context.applyTextDecoration(node, {
      id: "decorated-copy",
      type: "text",
      text: { textDecoration: "underline line-through overline" },
    }, report);
    expect(node.textDecoration).toBe("UNDERLINE");
    expect(JSON.parse(node.getPluginData("open-canvas-text-decoration"))).toMatchObject({
      raw: "underline line-through overline",
      mapped: "UNDERLINE",
    });
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("overline");
    expect(report.styleDegradationNodes[0].message).toContain("multiple CSS decoration lines");
  });

  it("clips a frame when either computed overflow axis is hidden", () => {
    const context = loadPluginFunctions();
    const node = { type: "FRAME", fills: [], effects: [], clipsContent: false };
    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      computedStyles: { overflowX: "hidden", overflowY: "visible" },
    });
    expect(node.clipsContent).toBe(true);
  });

  it("keeps hidden and collapsed H2D layers invisible in Figma", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.visible = true;
    context.applyVisibility(node, { computedStyles: { visibility: "hidden" } });
    expect(node.visible).toBe(false);

    const collapsed = mockFigmaNode("FRAME");
    collapsed.visible = true;
    context.applyVisibility(collapsed, { computedStyles: { visibility: "collapse" } });
    expect(collapsed.visible).toBe(false);
  });

  it("restores visibility and aspect constraints after a later layout pass", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.visible = false;
    node.constrainProportions = false;
    context.verifySceneVisualConstraints({
      id: "visual-constraint-copy",
      type: "frame",
      computedStyles: { visibility: "visible", aspectRatio: "16 / 9" },
      children: [],
    }, node);
    expect(node.visible).toBe(true);
    expect(node.constrainProportions).toBe(true);
    expect(node.getPluginData("open-canvas-aspect-ratio")).toBe("16 / 9");
  });

  it("restores clipping, isolation, and stroke layout participation", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.clipsContent = false;
    node.blendMode = "PASS_THROUGH";
    node.strokesIncludedInLayout = false;
    context.verifySceneVisualConstraints({
      id: "compositing-copy",
      type: "frame",
      borders: [{ width: 1 }, undefined, undefined, undefined],
      overflow: "hidden",
      computedStyles: { isolation: "isolate", mixBlendMode: "normal" },
      children: [],
    }, node);
    expect(node.clipsContent).toBe(true);
    expect(node.blendMode).toBe("NORMAL");
    expect(node.strokesIncludedInLayout).toBe(true);
  });

  it("includes a retained unified stroke in the Auto Layout border box", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.strokesIncludedInLayout = false;

    context.verifySceneVisualConstraints({
      id: "unified-stroke-only",
      type: "frame",
      stroke: { width: 2, style: "solid", color: "#111111" },
      borders: [],
      computedStyles: {},
      children: [],
    }, node, importReport());

    expect(node.strokesIncludedInLayout).toBe(true);
  });

  it("keeps a retained unified stroke visible when per-side borders are empty", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.strokes = [];

    context.visuals(node, {
      id: "unified-stroke-visual",
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      stroke: { width: 2, style: "solid", color: "#112233" },
      borders: [],
      computedStyles: {},
    }, [], { report: importReport() });

    expect(node.strokes).toEqual([expect.objectContaining({ type: "SOLID" })]);
    expect(node.strokeWeight).toBe(2);
    expect(node.strokesIncludedInLayout).toBe(true);
  });

  it("falls back to a visible unified stroke when per-side records are hidden", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 48);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const scene = {
      id: "hidden-per-side-unified-stroke",
      type: "frame",
      rect: { width: 120, height: 48 },
      radius: [8, 8, 8, 8],
      stroke: { width: 6, style: "double", color: "#112233" },
      borders: [0, 1, 2, 3].map(() => ({ width: 0, style: "hidden", color: "transparent" })),
      computedStyles: {},
    };
    context.createBorderDecorations(node, scene);

    expect(node.children.some(child => child.name === "__css-border-double")).toBe(true);
    const report = importReport();
    context.recordSceneDegradations(scene, report, [], node);
    expect(report.styleDegradations).toBe(0);
  });

  it("creates the complex border fallback from a stroke-only compatibility scene", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(120, 48);
    context.figma.createNodeFromSvg = () => mockFigmaNode("VECTOR");
    const scene = {
      id: "stroke-only-double-border",
      type: "frame",
      rect: { width: 120, height: 48 },
      radius: [8, 8, 8, 8],
      stroke: { width: 6, style: "double", color: "#112233" },
      borders: [],
      computedStyles: {},
    };

    context.createBorderDecorations(node, scene);

    expect(node.children.some(child => child.name === "__css-border-double")).toBe(true);
    expect(node.strokes).toEqual([]);

    const report = importReport();
    context.recordSceneDegradations(scene, report, [], node);
    expect(report.styleDegradations).toBe(0);
  });

  it("does not include zero-width or hidden border records in layout", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.strokesIncludedInLayout = true;

    context.verifySceneVisualConstraints({
      id: "invisible-border-records",
      type: "frame",
      borders: [
        { width: 0, style: "solid", color: "#111111" },
        { width: 2, style: "hidden", color: "#111111" },
      ],
      computedStyles: {},
      children: [],
    }, node, importReport());

    expect(node.strokesIncludedInLayout).toBe(false);
  });

  it("clears stale stroke layout participation when a reused node loses its border", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.strokesIncludedInLayout = true;

    context.visuals(node, {
      type: "frame",
      opacity: 1,
      radius: [0, 0, 0, 0],
      borders: [],
      computedStyles: {},
    });

    expect(node.strokesIncludedInLayout).toBe(false);
  });

  it("clears stale stroke layout participation during final visual verification", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.strokesIncludedInLayout = true;
    const report = importReport();

    context.verifySceneVisualConstraints({
      id: "border-removed",
      type: "frame",
      opacity: 1,
      borders: [],
      computedStyles: {},
      children: [],
    }, node, report);

    expect(node.strokesIncludedInLayout).toBe(false);
  });

  it("reports compositing flags that are silently normalized", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let clipsContent = false;
    Object.defineProperty(node, "clipsContent", {
      configurable: true,
      get: () => clipsContent,
      set: () => { clipsContent = false; },
    });
    const report = importReport();
    context.verifySceneVisualConstraints({
      id: "normalized-compositing",
      type: "frame",
      overflow: "hidden",
      computedStyles: { overflow: "hidden" },
      children: [],
    }, node, report);

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "normalized-compositing",
        property: "clipsContent",
        expected: true,
        actual: false,
      }),
    ]));
  });

  it("reports opacity and visibility values that are silently normalized", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let opacity = 1;
    let visible = true;
    Object.defineProperty(node, "opacity", {
      configurable: true,
      get: () => opacity,
      set: () => { opacity = 1; },
    });
    Object.defineProperty(node, "visible", {
      configurable: true,
      get: () => visible,
      set: () => { visible = true; },
    });
    const report = importReport();
    context.verifySceneVisualConstraints({
      id: "normalized-visibility",
      type: "frame",
      opacity: 0.4,
      computedStyles: { visibility: "hidden" },
      children: [],
    }, node, report);

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "normalized-visibility", property: "opacity", expected: 0.4, actual: 1 }),
      expect.objectContaining({ id: "normalized-visibility", property: "visible", expected: false, actual: true }),
    ]));
  });

  it("reports blend modes that are silently normalized", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let blendMode = "PASS_THROUGH";
    Object.defineProperty(node, "blendMode", {
      configurable: true,
      get: () => blendMode,
      set: () => { blendMode = "PASS_THROUGH"; },
    });
    const report = importReport();
    context.verifySceneVisualConstraints({
      id: "normalized-blend-mode",
      type: "frame",
      computedStyles: { mixBlendMode: "multiply" },
      children: [],
    }, node, report);

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "normalized-blend-mode",
        property: "blendMode",
        expected: "MULTIPLY",
        actual: "PASS_THROUGH",
      }),
    ]));
  });

  it("keeps scrollable and auto overflow inside the captured frame", () => {
    const context = loadPluginFunctions();
    for (const overflow of ["auto", "scroll", "overlay"]) {
      const node = { type: "FRAME", fills: [], effects: [], clipsContent: false };
      context.visuals(node, {
        type: "frame",
        opacity: 1,
        radius: [0, 0, 0, 0],
        computedStyles: { overflow },
      });
      expect(node.clipsContent).toBe(true);
    }
  });

  it("maps paint-containing CSS containment shorthands to Figma clipping", () => {
    const context = loadPluginFunctions();
    for (const contain of ["strict", "content", "size layout style paint"]) {
      const node = { type: "FRAME", fills: [], effects: [], clipsContent: false };
      context.visuals(node, {
        type: "frame",
        opacity: 1,
        radius: [0, 0, 0, 0],
        computedStyles: { contain },
      });
      expect(node.clipsContent).toBe(true);
    }

    const node = mockFigmaNode("FRAME");
    node.clipsContent = false;
    context.applySceneCompositingConstraints(node, {
      id: "strict-containment",
      type: "frame",
      computedStyles: { contain: "strict" },
      children: [],
    });
    expect(node.clipsContent).toBe(true);
  });

  it("merges lossless scene assets with H2D binary payloads", () => {
    const context = loadPluginFunctions();
    expect(context.mergeSceneAssets(
      [{ id: "asset-1", kind: "image", src: "https://example.test/a.png" }],
      [{ id: "asset-1", url: "https://example.test/a.png", data: "data:image/png;base64,AAAA" }],
    )).toEqual([{
      id: "asset-1",
      url: "https://example.test/a.png",
      data: "data:image/png;base64,AAAA",
      kind: "image",
      src: "https://example.test/a.png",
    }]);
  });

  it("composes common CSS transform functions in source order", () => {
    const context = loadPluginFunctions();
    expect(context.transformMatrix("translateX(10px) translateY(5px) scaleX(2) rotateZ(90deg)")).toEqual([
      expect.closeTo(0, 10), 1, -2, expect.closeTo(0, 10), 10, 5,
    ]);
    expect(context.transformMatrix("translate(10px 20px) skewX(45deg)")).toEqual([
      1, 0, expect.closeTo(1, 10), 1, 10, 20,
    ]);
  });

  it("resolves relative, percentage, viewport, and functional transform lengths", () => {
    const context = loadPluginFunctions();
    const lengthContext = {
      width: 200,
      height: 100,
      fontSize: 20,
      rootFontSize: 16,
      viewportWidth: 1000,
      viewportHeight: 800,
    };

    expect(context.transformMatrix("translate(1em, 10%)", lengthContext))
      .toEqual([1, 0, 0, 1, 20, 10]);
    expect(context.transformMatrix("translate(calc(10px + 0.5em) calc(50% - 1rem))", lengthContext))
      .toEqual([1, 0, 0, 1, 20, 34]);
    expect(context.transformMatrix("translateX(10vw)", lengthContext))
      .toEqual([1, 0, 0, 1, 100, 0]);
    expect(context.transformMatrix("translateX(10px-invalid)", lengthContext)).toBeNull();
  });

  it("keeps only affine 2D matrix3d transforms and rejects 3D terms", () => {
    const context = loadPluginFunctions();
    expect(context.transformMatrix("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 12, 18, 0, 1)"))
      .toEqual([1, 0, 0, 1, 12, 18]);
    expect(context.transformMatrix("translate3d(12px, 18px, 0px) scale3d(2, 3, 1)"))
      .toEqual([2, 0, 0, 3, 12, 18]);
    expect(context.transformMatrix("translate3d(12px, 18px, 4px)"))
      .toBeNull();
    expect(context.transformMatrix("rotateX(20deg)"))
      .toBeNull();
    expect(context.transformMatrix("matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0.25, 1)"))
      .toBeNull();
  });

  it("reports non-affine CSS transforms instead of silently flattening them", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "three-dimensional-card",
      transform: "rotateY(20deg)",
      computedStyles: {},
      borders: [],
    }, report);
    expect(report.styleDegradations).toBe(1);
    expect(report.styleDegradationNodes[0].message).toContain("2D transform API");
  });

  it("resolves transform-origin keywords instead of treating them as center", () => {
    const context = loadPluginFunctions();
    expect(context.transformOrigin("left bottom", 200, 100)).toEqual({ x: 0, y: 100 });
    expect(context.transformOrigin("center top", 200, 100)).toEqual({ x: 100, y: 0 });
    expect(context.transformOrigin("top center", 200, 100)).toEqual({ x: 100, y: 0 });
    expect(context.transformOrigin("top", 200, 100)).toEqual({ x: 100, y: 0 });
    expect(context.transformOrigin("bottom", 200, 100)).toEqual({ x: 100, y: 100 });
    expect(context.transformOrigin("center left", 200, 100)).toEqual({ x: 0, y: 50 });
  });

  it("resolves relative and functional transform-origin lengths", () => {
    const context = loadPluginFunctions();
    const lengthContext = {
      fontSize: 20,
      rootFontSize: 16,
      viewportWidth: 1000,
      viewportHeight: 800,
    };

    expect(context.transformOrigin("calc(50% - 1em) 1rem", 200, 100, lengthContext))
      .toEqual({ x: 80, y: 16 });
    expect(context.transformOrigin("10vw 25%", 200, 100, lengthContext))
      .toEqual({ x: 100, y: 25 });
  });

  it("applies a single vertical transform-origin around the horizontal center", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.x = 40;
    node.y = 30;
    node.relativeTransform = [[1, 0, 40], [0, 1, 30]];

    context.applyTransform(node, {
      rect: { width: 100, height: 60 },
      transform: "scale(2)",
      transformOrigin: "top",
    });

    expect(node.relativeTransform).toEqual([[2, 0, -10], [0, 2, 30]]);
  });

  it("preserves measured placement when applying a CSS transform matrix", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.x = 40;
    node.y = 30;
    node.relativeTransform = [[1, 0, 40], [0, 1, 30]];

    context.applyTransform(node, {
      rect: { width: 100, height: 60 },
      transform: "translate(10px, 5px)",
      transformOrigin: "0 0",
    });

    expect(node.relativeTransform).toEqual([[1, 0, 50], [0, 1, 35]]);
  });

  it("applies captured font-relative and percentage translations", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.x = 40;
    node.y = 30;
    node.relativeTransform = [[1, 0, 40], [0, 1, 30]];

    context.applyTransform(node, {
      rect: { width: 100, height: 60 },
      text: { fontSize: 20 },
      transform: "translate(1em, 10%)",
      transformOrigin: "0 0",
    });

    expect(node.relativeTransform).toEqual([[1, 0, 60], [0, 1, 36]]);
  });

  it("reports a transform matrix that Figma silently normalizes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let matrix = [[1, 0, 0], [0, 1, 0]];
    Object.defineProperty(node, "relativeTransform", {
      configurable: true,
      get: () => matrix,
      set: () => { matrix = [[1, 0, 0], [0, 1, 0]]; },
    });
    const report = importReport();

    context.applyTransform(node, {
      id: "normalized-transform",
      rect: { width: 100, height: 60 },
      transform: "translate(10px, 5px)",
      transformOrigin: "0 0",
    }, report);

    expect(report.styleDegradationNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "normalized-transform",
        message: expect.stringContaining("transform matrix read-back mismatch"),
      }),
    ]));
  });

  it("falls back to computed transform-origin for legacy shared scenes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.x = 40;
    node.y = 30;
    node.relativeTransform = [[1, 0, 40], [0, 1, 30]];

    context.applyTransform(node, {
      rect: { width: 100, height: 60 },
      transform: "scale(2)",
      computedStyles: { transformOrigin: "0 0" },
    });

    expect(node.relativeTransform).toEqual([[2, 0, 40], [0, 2, 30]]);
  });

  it("does not report transform-origin translation as layout drift", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.relativeTransform = [[2, 0, -10], [0, 2, 0]];

    expect(context.geometryDelta({
      rect: { x: 40, y: 30, width: 100, height: 60 },
      transform: "scale(2)",
      transformOrigin: "50% 50%",
    }, node)).toEqual({ x: 0, y: 0 });
  });

  it("does not double measured placement in the transform fallback", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.x = 40;
    node.y = 30;
    Object.defineProperty(node, "relativeTransform", {
      configurable: true,
      get: () => [[1, 0, 40], [0, 1, 30]],
      set: () => { throw new Error("matrix unavailable"); },
    });

    context.applyTransform(node, {
      rect: { width: 100, height: 60 },
      transform: "translate(10px, 5px)",
      transformOrigin: "0 0",
    });

    expect(node.x).toBe(50);
    expect(node.y).toBe(35);
  });

  it("keeps axis-aligned scale when matrix writes are unavailable", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.x = 20;
    node.y = 10;
    node.width = 100;
    node.height = 60;
    Object.defineProperty(node, "relativeTransform", {
      configurable: true,
      get: () => [[1, 0, 20], [0, 1, 10]],
      set: () => { throw new Error("matrix unavailable"); },
    });

    context.applyTransform(node, {
      rect: { width: 100, height: 60 },
      transform: "scale(1.5)",
      transformOrigin: "0 0",
    });

    expect(node.width).toBe(150);
    expect(node.height).toBe(90);
    expect(node.x).toBe(20);
    expect(node.y).toBe(10);
  });

  it("keeps transformed dimensions exact when a proportion lock is active", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.x = 20;
    node.y = 10;
    node.width = 100;
    node.height = 60;
    node.constrainProportions = true;
    node.resize = function resize(width, height) {
      this.width = width;
      this.height = this.constrainProportions ? width / (16 / 9) : height;
    };
    Object.defineProperty(node, "relativeTransform", {
      configurable: true,
      get: () => [[1, 0, 20], [0, 1, 10]],
      set: () => { throw new Error("matrix unavailable"); },
    });
    const report = importReport();

    context.applyTransform(node, {
      rect: { width: 100, height: 60 },
      transform: "scale(1.5)",
      transformOrigin: "0 0",
      computedStyles: { aspectRatio: "16 / 9" },
    }, report);

    expect(node.width).toBe(150);
    expect(node.height).toBe(90);
    expect(node.constrainProportions).toBe(true);
  });

  it("freezes measured Auto Layout frame bounds before child insertion", async () => {
    const context = loadPluginFunctions();
    const sequence = { value: 0 };
    context.figma.createFrame = () => mockFigmaNode("FRAME", sequence);
    context.figma.loadFontAsync = async () => {};
    const parent = mockFigmaNode("PAGE", sequence);
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 320 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", gap: 12, padding: [16, 16, 16, 16], position: "flow" },
      children: [],
    };
    const imported = await context.createNode(scene, parent, [], importReport(), undefined);
    expect(imported.primaryAxisSizingMode).toBe("FIXED");
    expect(imported.counterAxisSizingMode).toBe("FIXED");
    expect(imported.width).toBe(240);
    expect(imported.height).toBe(320);
  });

  it("keeps display-contents ancestor semantics as metadata without adding a layer", async () => {
    const context = loadPluginFunctions();
    context.figma.createText = () => mockFigmaNode("TEXT");
    context.figma.loadFontAsync = async () => {};
    const parent = mockFigmaNode("PAGE");
    const structuralSemantics = [{ role: "navigation", label: "Primary navigation", states: { expanded: "true" } }];
    const imported = await context.createNode({
      id: "contents-child",
      type: "text",
      rect: { x: 16, y: 20, width: 120, height: 24 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
      structuralSemantics,
      text: { content: "Dashboard", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 24, letterSpacing: 0, textAlign: "left" },
      children: [],
    }, parent, [], importReport(), undefined, { images: new Map(), vectors: new Map() });

    expect(imported.name).toBe("contents-child");
    expect(JSON.parse(imported.getPluginData("open-canvas-structural-semantics"))).toEqual(structuralSemantics);
    expect(parent.children).toEqual([imported]);
  });

  it("keeps restored flexible sizing when final measured geometry already matches", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(200, 80);
    node.primaryAxisSizingMode = "HUG";
    node.counterAxisSizingMode = "FILL";
    node.layoutSizingHorizontal = "HUG";
    node.layoutSizingVertical = "FILL";
    const report = importReport();
    context.correctMeasuredSize({
      id: "child",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 80 },
    }, node, report);

    expect(node.primaryAxisSizingMode).toBe("HUG");
    expect(node.counterAxisSizingMode).toBe("FILL");
    expect(node.layoutSizingHorizontal).toBe("HUG");
    expect(node.layoutSizingVertical).toBe("FILL");
    expect(report.geometryResizes).toBe(0);
  });

  it("replays frame sizing after late correction without resetting text auto-resize", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(240, 80);
    parent.primaryAxisSizingMode = "FIXED";
    const text = mockFigmaNode("TEXT");
    text.textAutoResize = "NONE";
    text.layoutSizingHorizontal = "FIXED";
    text.layoutSizingVertical = "FIXED";
    text.resize(200, 24);
    parent.appendChild(text);

    context.restoreStableFrameSizing({
      id: "late-frame-sizing",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", position: "flow" },
      children: [{
        id: "late-frame-text",
        type: "text",
        rect: { x: 0, y: 0, width: 200, height: 24 },
        layout: { mode: "none", widthMode: "fixed", heightMode: "hug", position: "flow" },
        text: { content: "Label", lineCount: 1 },
        children: [],
      }],
    }, parent, importReport());

    expect(parent.primaryAxisSizingMode).toBe("AUTO");
    expect(text.layoutSizingVertical).toBe("HUG");
    expect(text.textAutoResize).toBe("NONE");
  });

  it("restores captured line-height after late frame sizing resets a text node", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(240, 80);
    const text = mockFigmaNode("TEXT");
    text.setPluginData("open-canvas-id", "late-frame-leading-text");
    text.characters = "First\nSecond";
    let lineHeight = { unit: "PIXELS", value: 28 };
    Object.defineProperty(text, "lineHeight", {
      configurable: true,
      get: () => lineHeight,
      set: value => { lineHeight = value; },
    });
    Object.defineProperty(text, "layoutSizingVertical", {
      configurable: true,
      get: () => "FIXED",
      set: () => { lineHeight = { unit: "AUTO", value: 0 }; },
    });
    parent.appendChild(text);
    const scene = {
      id: "late-frame-leading",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", position: "flow" },
      children: [{
        id: "late-frame-leading-text",
        type: "text",
        rect: { x: 0, y: 0, width: 200, height: 56 },
        layout: { mode: "none", widthMode: "fixed", heightMode: "hug", position: "flow" },
        text: { content: text.characters, lineCount: 2, lineHeight: 28 },
        children: [],
      }],
    };
    const report = importReport();

    context.restoreStableFrameSizing(scene, parent, report);
    expect(text.lineHeight).toEqual({ unit: "AUTO", value: 0 });

    context.verifySceneLineHeights(scene, parent, report);
    expect(text.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(report.lineHeightFailures).toBe(0);
  });

  it("freezes only the mismatched axis during measured size correction", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(200, 96);
    node.layoutSizingHorizontal = "FILL";
    node.layoutSizingVertical = "FIXED";
    const report = importReport();

    context.correctMeasuredSize({
      id: "height-mismatch",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "fill", heightMode: "fixed" },
    }, node, report);

    expect(node.width).toBe(200);
    expect(node.height).toBe(80);
    expect(node.layoutSizingHorizontal).toBe("FILL");
    expect(node.layoutSizingVertical).toBe("FIXED");
    expect(report.geometryResizes).toBe(1);
  });

  it("restores a nested frame's own HUG axis after the tree is complete", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(200, 80);
    node.primaryAxisSizingMode = "FIXED";
    node.counterAxisSizingMode = "FIXED";

    context.restoreStableSizing({
      id: "stack",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", position: "flow" },
      children: [],
    }, node);

    expect(node.primaryAxisSizingMode).toBe("AUTO");
    expect(node.counterAxisSizingMode).toBe("FIXED");
  });

  it("restores nested intrinsic layout before applying parent-facing HUG sizing", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(200, 80);
    const child = mockFigmaNode("FRAME");
    child.layoutMode = "VERTICAL";
    child.resize(200, 80);

    let primarySizing = "FIXED";
    let verticalSizing = "FIXED";
    Object.defineProperty(child, "primaryAxisSizingMode", {
      configurable: true,
      get: () => primarySizing,
      set: (value) => {
        primarySizing = value;
        if (value === "AUTO") child.height = 80;
      },
    });
    Object.defineProperty(child, "layoutSizingVertical", {
      configurable: true,
      get: () => verticalSizing,
      set: (value) => {
        verticalSizing = value;
        if (value === "HUG") child.height = primarySizing === "AUTO" ? 80 : 40;
      },
    });
    parent.appendChild(child);

    context.restoreStableSizing({
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [{
        id: "stack",
        type: "frame",
        rect: { x: 0, y: 0, width: 200, height: 80 },
        layout: { mode: "vertical", widthMode: "fill", heightMode: "hug", position: "flow" },
        children: [],
      }],
    }, parent);

    expect(child.primaryAxisSizingMode).toBe("AUTO");
    expect(child.layoutSizingVertical).toBe("HUG");
    expect(child.height).toBe(80);
  });

  it("restores parent intrinsic sizing before a child-facing HUG write", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(200, 80);
    let parentPrimarySizing = "FIXED";
    Object.defineProperty(parent, "primaryAxisSizingMode", {
      configurable: true,
      get: () => parentPrimarySizing,
      set: value => {
        parentPrimarySizing = value;
        if (value === "AUTO") parent.height = 80;
      },
    });
    const child = mockFigmaNode("FRAME");
    child.layoutMode = "VERTICAL";
    child.resize(200, 80);
    let childVerticalSizing = "FIXED";
    Object.defineProperty(child, "layoutSizingVertical", {
      configurable: true,
      get: () => childVerticalSizing,
      set: value => {
        if (value === "HUG" && parentPrimarySizing !== "AUTO") {
          throw new Error("parent is still fixed");
        }
        childVerticalSizing = value;
      },
    });
    parent.appendChild(child);
    const report = importReport();

    context.restoreStableSizing({
      id: "hug-parent",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", position: "flow" },
      children: [{
        id: "hug-child",
        type: "frame",
        rect: { x: 0, y: 0, width: 200, height: 80 },
        layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", position: "flow" },
        children: [],
      }],
    }, parent, report);

    expect(parent.primaryAxisSizingMode).toBe("AUTO");
    expect(child.layoutSizingVertical).toBe("HUG");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("keeps HUG sizing through Figma subpixel layout rounding", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(200, 80);
    let primarySizing = "FIXED";
    Object.defineProperty(node, "primaryAxisSizingMode", {
      configurable: true,
      get: () => primarySizing,
      set: (value) => {
        primarySizing = value;
        if (value === "AUTO") node.height = 80.6;
      },
    });
    const scene = {
      id: "rounded-stack",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", position: "flow" },
      children: [],
    };
    const report = importReport();

    context.restoreStableSizing(scene, node, report);
    context.correctMeasuredSize(scene, node, report);

    expect(node.primaryAxisSizingMode).toBe("AUTO");
    expect(node.height).toBe(80.6);
    expect(report.sizingFallbacks || 0).toBe(0);
    expect(report.geometryResizes).toBe(0);
  });

  it("keeps a flexible child when only that child rounds within one pixel", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(200, 160);
    const child = mockFigmaNode("FRAME");
    child.layoutMode = "VERTICAL";
    child.resize(200, 80);
    const sibling = mockFigmaNode("FRAME");
    sibling.resize(200, 80);
    let verticalSizing = "FIXED";
    Object.defineProperty(child, "layoutSizingVertical", {
      configurable: true,
      get: () => verticalSizing,
      set: (value) => {
        verticalSizing = value;
        if (value === "HUG") child.height = 80.6;
      },
    });
    parent.appendChild(child);
    parent.appendChild(sibling);
    const report = importReport();

    context.restoreStableSizing({
      id: "parent",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 160 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [{
        id: "rounded-child",
        type: "frame",
        rect: { x: 0, y: 0, width: 200, height: 80 },
        layout: { mode: "vertical", widthMode: "fill", heightMode: "hug", position: "flow" },
        children: [],
      }, {
        id: "sibling",
        type: "frame",
        rect: { x: 0, y: 80, width: 200, height: 80 },
        layout: { mode: "none", widthMode: "fixed", heightMode: "fixed", position: "flow" },
        children: [],
      }],
    }, parent, report);

    expect(child.layoutSizingVertical).toBe("HUG");
    expect(child.height).toBe(80.6);
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("keeps nested FILL/HUG intent alongside content-box responsive bounds", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(400, 240);
    const child = mockFigmaNode("FRAME");
    child.layoutMode = "HORIZONTAL";
    child.resize(360, 96);
    child.minWidth = 0;
    child.maxWidth = Infinity;
    child.minHeight = 0;
    child.maxHeight = Infinity;
    parent.appendChild(child);
    const report = importReport();
    const scene = {
      id: "responsive-child",
      type: "frame",
      rect: { x: 20, y: 12, width: 360, height: 96 },
      computedStyles: {
        boxSizing: "content-box",
        minWidth: "240px",
        maxWidth: "420px",
      },
      layout: { mode: "horizontal", widthMode: "fill", heightMode: "hug", padding: [8, 12, 8, 12], position: "flow" },
      borders: [{ width: 1 }, { width: 1 }, { width: 1 }, { width: 1 }],
      children: [],
    };
    context.applySizingConstraints(child, scene, {
      rect: { width: 400, height: 240 },
      layout: { padding: [0, 0, 0, 0] },
    }, undefined, report);
    context.restoreParentSizingAxis(scene, child, {
      layout: { mode: "vertical" },
      children: [{ id: scene.id }],
    }, parent, "width", report);
    context.restoreIntrinsicSizingAxis(scene, child, "height", report);

    expect(child.layoutSizingHorizontal).toBe("FILL");
    expect(child.counterAxisSizingMode).toBe("AUTO");
    expect(child.minWidth).toBe(266);
    expect(child.maxWidth).toBe(446);
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("keeps parent-facing HUG when the other axis reflows", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(320, 160);
    const child = mockFigmaNode("FRAME");
    child.resize(180, 48);
    let horizontalSizing = "FIXED";
    Object.defineProperty(child, "layoutSizingHorizontal", {
      configurable: true,
      get: () => horizontalSizing,
      set: value => {
        horizontalSizing = value;
        // Figma may remeasure multiline content on a width sizing write.
        // The requested width remains stable while the height grows.
        if (value === "HUG") child.height = 72;
      },
    });
    parent.appendChild(child);
    const scene = {
      id: "cross-axis-reflow-parent-facing",
      type: "frame",
      rect: { x: 0, y: 0, width: 180, height: 48 },
      layout: { mode: "vertical", widthMode: "hug", heightMode: "fixed", position: "flow" },
      children: [],
    };
    const report = importReport();

    context.restoreParentSizingAxis(scene, child, {
      layout: { mode: "vertical" },
      children: [scene],
    }, parent, "width", report);

    expect(child.layoutSizingHorizontal).toBe("HUG");
    expect(child.width).toBe(180);
    expect(child.height).toBe(72);
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("keeps intrinsic HUG when the other axis reflows", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(180, 48);
    let intrinsicWidth = "FIXED";
    Object.defineProperty(node, "counterAxisSizingMode", {
      configurable: true,
      get: () => intrinsicWidth,
      set: value => {
        intrinsicWidth = value;
        if (value === "AUTO") node.height = 72;
      },
    });
    const report = importReport();

    context.restoreIntrinsicSizingAxis({
      id: "cross-axis-reflow-intrinsic",
      type: "frame",
      rect: { x: 0, y: 0, width: 180, height: 48 },
      layout: { mode: "vertical", widthMode: "hug", heightMode: "fixed", position: "flow" },
      children: [],
    }, node, "width", report);

    expect(node.counterAxisSizingMode).toBe("AUTO");
    expect(node.width).toBe(180);
    expect(node.height).toBe(72);
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("strictly corrects one-pixel CSS margin wrapper rounding", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "HORIZONTAL";
    node.resize(200, 88);
    node.layoutSizingVertical = "HUG";
    const report = importReport();

    context.correctMeasuredSize({
      id: "__css-cross-margin-card",
      sourceTag: "CSS_MARGIN_WRAPPER",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 87 },
      layout: { mode: "horizontal", widthMode: "fill", heightMode: "hug" },
    }, node, report);

    expect(node.height).toBe(87);
    expect(node.layoutSizingVertical).toBe("FIXED");
    expect(report.geometryResizes).toBe(1);
  });

  it("has no residual geometry mismatch after the strict wrapper correction", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "HORIZONTAL";
    node.resize(200, 88);
    node.layoutSizingVertical = "HUG";
    const scene = {
      id: "__css-cross-margin-card-final",
      sourceTag: "CSS_MARGIN_WRAPPER",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 87 },
      layout: { mode: "horizontal", widthMode: "fill", heightMode: "hug" },
      children: [],
    };
    const report = importReport();

    context.correctMeasuredSize(scene, node, report);
    context.resetRemainingGeometryAudit(report);
    context.auditRemainingGeometry(report, scene, node);

    expect(node.height).toBe(87);
    expect(report.remainingMismatches).toBe(0);
  });

  it("re-audits and corrects geometry after the final constraint pass", async () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(260, 88);
    const scene = {
      id: "late-constraint-drift",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 88 },
      layout: { mode: "horizontal", widthMode: "fill", heightMode: "fixed" },
      children: [],
    };
    const report = {
      ...importReport(),
      remainingGeometryAudited: 0,
      remainingMismatches: 0,
      maxRemainingMeasuredDelta: 0,
      maxRemainingMeasuredSizeDelta: 0,
      remainingMismatchNodes: [],
    };

    await context.settleAndCorrectFinalGeometry(scene, node, report, [], { images: new Map(), vectors: new Map() });

    expect(node.width).toBe(240);
    expect(report.remainingMismatches).toBe(0);
    expect(report.geometryMismatches).toBe(0);
    expect(report.geometryMismatchNodes).toEqual([]);
  });

  it("replays frame HUG/FILL sizing after the final settled geometry pass", async () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(240, 80);
    const child = mockFigmaNode("FRAME");
    child.layoutMode = "VERTICAL";
    child.resize(240, 48);
    const text = mockFigmaNode("TEXT");
    text.characters = "First\nSecond";
    text.resize(220, 56);
    let textVerticalSizing = "FIXED";
    let textLineHeight = { unit: "PIXELS", value: 28 };
    Object.defineProperty(text, "lineHeight", {
      configurable: true,
      get: () => textLineHeight,
      set: value => { textLineHeight = value; },
    });
    Object.defineProperty(text, "layoutSizingVertical", {
      configurable: true,
      get: () => textVerticalSizing,
      set: value => {
        textVerticalSizing = value;
        if (value === "HUG") textLineHeight = { unit: "AUTO", value: 0 };
      },
    });
    child.appendChild(text);
    parent.appendChild(child);
    const report = {
      ...importReport(),
      remainingGeometryAudited: 0,
      remainingMismatches: 0,
      maxRemainingMeasuredDelta: 0,
      maxRemainingMeasuredSizeDelta: 0,
      remainingMismatchNodes: [],
    };

    await context.settleAndRestoreFinalFrameSizing({
      id: "final-frame-sizing-root",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [{
        id: "final-frame-sizing-child",
        type: "frame",
        rect: { x: 0, y: 0, width: 240, height: 48 },
        layout: { mode: "vertical", widthMode: "fill", heightMode: "hug", position: "flow" },
        children: [{
          id: "final-frame-sizing-text",
          type: "text",
          rect: { x: 0, y: 0, width: 220, height: 56 },
          layout: { mode: "none", widthMode: "fixed", heightMode: "hug", position: "flow" },
          text: { content: text.characters, lineCount: 2, lineHeight: 28 },
          children: [],
        }],
      }],
    }, parent, report, [], { images: new Map(), vectors: new Map() });

    expect(child.layoutSizingHorizontal).toBe("FILL");
    expect(child.layoutSizingVertical).toBe("HUG");
    expect(text.lineHeight).toEqual({ unit: "PIXELS", value: 28 });
    expect(report.remainingMismatches).toBe(0);
  });

  it("keeps the final import write order line-height-after-frame-settle", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "code.js"),
      "utf8",
    );
    const settleCall = source.lastIndexOf("await settleAndRestoreFinalFrameSizing(");
    expect(settleCall).toBeGreaterThan(-1);
    const nextImportStep = source.indexOf("placeRootWithoutOverlap", settleCall);
    expect(nextImportStep).toBeGreaterThan(settleCall);
    const finalTypographyWrite = source.indexOf("verifySceneLineHeights(rootScene, root, report, sceneAssets);", settleCall);
    expect(finalTypographyWrite).toBeGreaterThan(settleCall);
    expect(finalTypographyWrite).toBeLessThan(nextImportStep);
  });

  it("reapplies visual constraints after the final frame-sizing settle", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "code.js"),
      "utf8",
    );
    const finalSettle = source.lastIndexOf("await settleAndRestoreFinalFrameSizing(");
    const finalVisualWrite = source.indexOf("verifySceneVisualConstraints(rootScene, root, report);", finalSettle);
    const finalTypographyWrite = source.indexOf("verifySceneTextAttributes(rootScene, root);", finalSettle);
    const importComplete = source.indexOf("figma.ui.postMessage({ type: \"import-complete\", report });", finalSettle);

    expect(finalSettle).toBeGreaterThan(-1);
    expect(finalVisualWrite).toBeGreaterThan(finalSettle);
    expect(finalVisualWrite).toBeLessThan(finalTypographyWrite);
    expect(finalVisualWrite).toBeLessThan(importComplete);
  });

  it("disables text HUG when final measured geometry has to resize the layer", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(240, 80);
    const text = mockFigmaNode("TEXT");
    text.name = "drifting-hug-label";
    text.textAutoResize = "WIDTH_AND_HEIGHT";
    text.setPluginData("open-canvas-id", "drifting-hug-label");
    text.setPluginData("open-canvas-text-auto-resize", "WIDTH_AND_HEIGHT");
    text.resize(140, 28);
    parent.appendChild(text);
    const scene = {
      id: "parent",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "fixed" },
      children: [{
        id: "drifting-hug-label",
        type: "text",
        rect: { x: 0, y: 0, width: 120, height: 24 },
        layout: { mode: "none", widthMode: "hug", heightMode: "hug", position: "flow" },
        text: { content: "Label", lineCount: 1 },
        children: [],
      }],
    };

    const report = {
      ...importReport(),
      preCorrectionAudited: 0,
      preCorrectionMismatches: 0,
      preCorrectionMaxMeasuredDelta: 0,
      preCorrectionMaxMeasuredSizeDelta: 0,
      preCorrectionMismatchNodes: [],
      remainingGeometryAudited: 0,
      remainingMismatches: 0,
      maxRemainingMeasuredDelta: 0,
      maxRemainingMeasuredSizeDelta: 0,
      remainingMismatchNodes: [],
    };
    context.correctMeasuredGeometry(scene, parent, report, [], { images: new Map(), vectors: new Map() });

    expect(text).toMatchObject({ width: 120, height: 24, textAutoResize: "NONE" });
    expect(text.getPluginData("open-canvas-text-auto-resize")).toBe("NONE");
  });

  it("keeps border fallback geometry aligned during the final constraint correction", async () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.resize(260, 88);
    const top = mockFigmaNode("RECTANGLE");
    top.name = "__css-border-top";
    top.resize(260, 2);
    const right = mockFigmaNode("RECTANGLE");
    right.name = "__css-border-right";
    right.resize(2, 88);
    right.x = 258;
    node.appendChild(top);
    node.appendChild(right);
    const scene = {
      id: "late-constraint-border-drift",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 88 },
      borders: [
        { width: 2, color: "#111", style: "solid" },
        { width: 2, color: "#111", style: "solid" },
        undefined,
        undefined,
      ],
      layout: { mode: "horizontal", widthMode: "fill", heightMode: "fixed" },
      children: [],
    };
    const report = {
      ...importReport(),
      remainingGeometryAudited: 0,
      remainingMismatches: 0,
      maxRemainingMeasuredDelta: 0,
      maxRemainingMeasuredSizeDelta: 0,
      remainingMismatchNodes: [],
    };

    await context.settleAndCorrectFinalGeometry(scene, node, report, [], { images: new Map(), vectors: new Map() });

    expect(node.width).toBe(240);
    expect(top).toMatchObject({ width: 240, x: 0, y: 0 });
    expect(right).toMatchObject({ width: 2, height: 88, x: 238, y: 0 });
    expect(report.geometryMismatches).toBe(0);
  });

  it("keeps a compatible parent-facing axis when the other axis must fall back", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(200, 160);
    const child = mockFigmaNode("FRAME");
    child.layoutMode = "VERTICAL";
    child.resize(200, 80);
    let horizontalSizing = "FIXED";
    let verticalSizing = "FIXED";
    Object.defineProperty(child, "layoutSizingHorizontal", {
      configurable: true,
      get: () => horizontalSizing,
      set: (value) => { horizontalSizing = value; },
    });
    Object.defineProperty(child, "layoutSizingVertical", {
      configurable: true,
      get: () => verticalSizing,
      set: (value) => {
        verticalSizing = value;
        if (value === "HUG") child.height = 120;
      },
    });
    parent.appendChild(child);
    const report = importReport();

    context.restoreStableSizing({
      id: "parent",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 160 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "fixed" },
      children: [{
        id: "mixed-child",
        type: "frame",
        rect: { x: 0, y: 0, width: 200, height: 80 },
        layout: { mode: "vertical", widthMode: "fill", heightMode: "hug", position: "flow" },
        children: [],
      }],
    }, parent, report);

    expect(child.layoutSizingHorizontal).toBe("FILL");
    expect(child.layoutSizingVertical).toBe("FIXED");
    expect(child.width).toBe(200);
    expect(child.height).toBe(80);
    expect(report.sizingFallbacks).toBe(1);
    expect(report.sizingFallbackNodes[0]).toMatchObject({ id: "mixed-child", kind: "parent-facing-height", axis: "height" });
  });

  it("deduplicates repeated sizing fallbacks across convergence passes", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    const scene = { id: "revisited-node" };

    context.recordSizingFallback(report, scene, "parent-facing-height", {
      axis: "height",
      desired: "HUG",
      expectedWidth: 240,
      expectedHeight: 80,
      actualWidth: 240,
      actualHeight: 96,
    });
    context.recordSizingFallback(report, scene, "parent-facing-height", {
      axis: "height",
      desired: "HUG",
      expectedWidth: 240,
      expectedHeight: 80,
      actualWidth: 240,
      actualHeight: 96,
      message: "same fallback observed after another settle",
    });
    context.recordSizingFallback(report, scene, "parent-facing-width", {
      axis: "width",
      desired: "FILL",
      expectedWidth: 240,
      expectedHeight: 80,
    });

    expect(report.sizingFallbacks).toBe(2);
    expect(report.sizingFallbackNodes).toHaveLength(2);
    expect(report.sizingFallbackNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "revisited-node", kind: "parent-facing-height", axis: "height" }),
      expect.objectContaining({ id: "revisited-node", kind: "parent-facing-width", axis: "width" }),
    ]));
  });

  it("reapplies captured text leading before restoring parent-facing HUG", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(240, 80);
    const text = mockFigmaNode("TEXT");
    text.characters = "First\nSecond";
    let leading = { unit: "AUTO", value: 0 };
    Object.defineProperty(text, "lineHeight", {
      configurable: true,
      get: () => leading,
      set: value => { leading = value; },
    });
    text.getRangeLineHeight = () => leading;
    text.setRangeLineHeight = (_start, _end, value) => {
      leading = value;
      text.height = value.value * 2;
    };
    Object.defineProperty(text, "layoutSizingVertical", {
      configurable: true,
      get: () => text.__layoutSizingVertical || "FIXED",
      set: value => {
        text.__layoutSizingVertical = value;
        if (value === "HUG") text.height = leading.unit === "PIXELS" ? leading.value * 2 : 22;
      },
    });
    parent.appendChild(text);
    const report = importReport();
    const scene = {
      id: "leading-hug-text",
      type: "text",
      rect: { x: 0, y: 0, width: 200, height: 44 },
      layout: { mode: "none", widthMode: "fixed", heightMode: "hug", position: "flow" },
      text: { content: text.characters, lineCount: 2, lineHeight: 22 },
      children: [],
    };

    context.restoreParentSizingAxis(scene, text, {
      id: "leading-hug-parent",
      rect: { width: 240, height: 80 },
      layout: { mode: "vertical" },
      children: [scene],
    }, parent, "height", report);

    expect(text.layoutSizingVertical).toBe("HUG");
    expect(text.height).toBe(44);
    expect(text.lineHeight).toEqual({ unit: "PIXELS", value: 22 });
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("keeps a compatible intrinsic Hug axis when the other axis must fall back", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(200, 80);
    let primarySizing = "FIXED";
    let counterSizing = "FIXED";
    Object.defineProperty(node, "primaryAxisSizingMode", {
      configurable: true,
      get: () => primarySizing,
      set: (value) => {
        primarySizing = value;
        if (value === "AUTO") node.height = 120;
      },
    });
    Object.defineProperty(node, "counterAxisSizingMode", {
      configurable: true,
      get: () => counterSizing,
      set: (value) => { counterSizing = value; },
    });
    const report = importReport();

    context.restoreStableSizing({
      id: "mixed-stack",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "hug", heightMode: "hug", position: "flow" },
      children: [],
    }, node, report);

    expect(node.counterAxisSizingMode).toBe("AUTO");
    expect(node.primaryAxisSizingMode).toBe("FIXED");
    expect(node.width).toBe(200);
    expect(node.height).toBe(80);
    expect(report.sizingFallbacks).toBe(1);
    expect(report.sizingFallbackNodes[0]).toMatchObject({ id: "mixed-stack", kind: "intrinsic-height", axis: "height" });
  });

  it("reports a silently rejected parent-facing sizing mode", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    parent.resize(200, 160);
    const child = mockFigmaNode("FRAME");
    child.layoutMode = "VERTICAL";
    child.resize(200, 80);
    let sizing = "FIXED";
    Object.defineProperty(child, "layoutSizingVertical", {
      configurable: true,
      get: () => sizing,
      set: () => { /* model a host that silently normalizes the request */ },
    });
    parent.appendChild(child);
    const report = importReport();

    context.restoreParentSizingAxis({
      id: "silent-parent-sizing",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug" },
    }, child, {
      rect: { width: 200, height: 160 },
      layout: { mode: "vertical" },
      children: [{ id: "silent-parent-sizing" }],
    }, parent, "height", report);

    expect(child.layoutSizingVertical).toBe("FIXED");
    expect(report.sizingFallbackNodes[0]).toMatchObject({
      id: "silent-parent-sizing",
      kind: "parent-facing-height",
      axis: "height",
      desired: "HUG",
      actual: "FIXED",
    });
  });

  it("reports a silently rejected intrinsic sizing mode", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(200, 80);
    let sizing = "FIXED";
    Object.defineProperty(node, "primaryAxisSizingMode", {
      configurable: true,
      get: () => sizing,
      set: () => { /* model a host that silently normalizes the request */ },
    });
    const report = importReport();

    context.restoreIntrinsicSizingAxis({
      id: "silent-intrinsic-sizing",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug" },
    }, node, "height", report);

    expect(node.primaryAxisSizingMode).toBe("FIXED");
    expect(report.sizingFallbackNodes[0]).toMatchObject({
      id: "silent-intrinsic-sizing",
      kind: "intrinsic-height",
      axis: "height",
      desired: "AUTO",
      actual: "FIXED",
    });
  });

  it("restores internal Hug sizing for a measured-position Auto Layout frame", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutMode = "VERTICAL";
    node.resize(200, 80);
    let primarySizing = "FIXED";
    Object.defineProperty(node, "primaryAxisSizingMode", {
      configurable: true,
      get: () => primarySizing,
      set: value => { primarySizing = value; },
    });
    const report = importReport();

    context.restoreStableSizing({
      id: "locked-stack",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 80 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", geometryLock: true, position: "flow" },
      children: [],
    }, node, report);

    expect(node.primaryAxisSizingMode).toBe("AUTO");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("restores safe HUG/FILL axes on synthetic measured absolute layers", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const child = mockFigmaNode("FRAME");
    child.layoutPositioning = "ABSOLUTE";
    child.layoutSizingHorizontal = "FIXED";
    child.layoutSizingVertical = "FIXED";
    child.resize(120, 40);
    parent.appendChild(child);
    const report = importReport();
    const scene = {
      id: "synthetic-absolute-card",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      layout: {
        mode: "horizontal",
        widthMode: "hug",
        heightMode: "fill",
        position: "flow",
        geometryLock: true,
      },
      children: [],
    };

    context.restoreMeasuredAbsoluteSizingAxis(scene, child, "width", report);
    context.restoreMeasuredAbsoluteSizingAxis(scene, child, "height", report);

    expect(child.layoutSizingHorizontal).toBe("HUG");
    expect(child.layoutSizingVertical).toBe("FILL");
    expect(child.width).toBe(120);
    expect(child.height).toBe(40);
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("keeps a synthetic measured axis fixed when HUG changes its captured size", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutPositioning = "ABSOLUTE";
    Object.defineProperty(node, "layoutSizingVertical", {
      configurable: true,
      get: () => node.__verticalSizing || "FIXED",
      set: value => {
        node.__verticalSizing = value;
        if (value === "HUG") node.height = 56;
      },
    });
    node.resize(120, 40);
    const report = importReport();
    const scene = {
      id: "synthetic-absolute-drift",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", position: "flow", geometryLock: true },
      children: [],
    };

    context.restoreMeasuredAbsoluteSizingAxis(scene, node, "height", report);

    expect(node.layoutSizingVertical).toBe("FIXED");
    expect(node.height).toBe(40);
    expect(report.sizingFallbackNodes[0]).toMatchObject({
      id: "synthetic-absolute-drift",
      kind: "absolute-height",
      axis: "height",
      desired: "HUG",
    });
  });

  it("restores both captured axes when a synthetic sizing write reflows the other axis", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.layoutPositioning = "ABSOLUTE";
    Object.defineProperty(node, "layoutSizingVertical", {
      configurable: true,
      get: () => node.__verticalSizing || "FIXED",
      set: value => {
        node.__verticalSizing = value;
        if (value === "HUG") {
          node.width = 156;
          node.height = 56;
        }
      },
    });
    node.resize(120, 40);
    const report = importReport();
    const scene = {
      id: "synthetic-cross-axis-drift",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      layout: { mode: "vertical", widthMode: "fixed", heightMode: "hug", position: "flow", geometryLock: true },
      children: [],
    };

    context.restoreMeasuredAbsoluteSizingAxis(scene, node, "height", report);

    expect(node.layoutSizingVertical).toBe("FIXED");
    expect(node).toMatchObject({ width: 120, height: 40 });
    expect(report.sizingFallbackNodes[0]).toMatchObject({
      id: "synthetic-cross-axis-drift",
      kind: "absolute-height",
      axis: "height",
    });
  });

  it("preserves captured min and max sizing constraints", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.minHeight = 0;
    node.maxHeight = Infinity;
    context.applySizingConstraints(node, {
      computedStyles: {
        minWidth: "280px",
        maxWidth: "430px",
        minHeight: "96px",
        maxHeight: "none",
      },
    });
    expect(node.minWidth).toBe(280);
    expect(node.maxWidth).toBe(430);
    expect(node.minHeight).toBe(96);
    expect(node.maxHeight).toBe(Infinity);

    context.applySizingConstraints(node, {
      computedStyles: { minWidth: "50%", maxHeight: "25%" },
    }, {
      rect: { width: 400, height: 240 },
      layout: { padding: ["10px", "20px", "30px", "40px"] },
    });
    expect(node.minWidth).toBe(170);
    expect(node.maxHeight).toBe(50);
  });

  it("converts content-box min/max constraints to Figma border-box bounds", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.minHeight = 0;
    node.maxHeight = Infinity;

    context.applySizingConstraints(node, {
      computedStyles: {
        boxSizing: "content-box",
        minWidth: "100px",
        maxWidth: "240px",
        minHeight: "40px",
        maxHeight: "120px",
      },
      layout: { padding: [10, 12, 14, 16] },
      borders: [
        { width: 1 },
        { width: 2 },
        { width: 3 },
        { width: 4 },
      ],
    });

    // Figma bounds include the full border box: horizontal extra =
    // 12 + 16 + 2 + 4, vertical extra = 10 + 14 + 1 + 3.
    expect(node.minWidth).toBe(134);
    expect(node.maxWidth).toBe(274);
    expect(node.minHeight).toBe(68);
    expect(node.maxHeight).toBe(148);
  });

  it("does not add padding or borders twice for border-box constraints", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    context.applySizingConstraints(node, {
      computedStyles: { boxSizing: "border-box", minWidth: "100px", maxWidth: "240px" },
      layout: { padding: [10, 12, 14, 16] },
      borders: [{ width: 1 }, { width: 2 }, { width: 3 }, { width: 4 }],
    });

    expect(node.minWidth).toBe(100);
    expect(node.maxWidth).toBe(240);
  });

  it("converts padding-box constraints by adding only the border", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.minHeight = 0;
    node.maxHeight = Infinity;

    context.applySizingConstraints(node, {
      computedStyles: {
        boxSizing: "padding-box",
        minWidth: "100px",
        maxWidth: "240px",
        minHeight: "40px",
        maxHeight: "120px",
      },
      layout: { padding: [10, 12, 14, 16] },
      borders: [
        { width: 1 },
        { width: 2 },
        { width: 3 },
        { width: 4 },
      ],
    });

    expect(node.minWidth).toBe(106);
    expect(node.maxWidth).toBe(246);
    expect(node.minHeight).toBe(44);
    expect(node.maxHeight).toBe(124);
  });

  it("resolves standalone sizing constraints without a parent scene", () => {
    const context = loadPluginFunctions();

    expect(context.resolveSizingConstraint("120px", "width", undefined, undefined, 16, 16)).toBe(120);
    expect(context.resolveSizingConstraint("50%", "height", undefined, { width: 320, height: 240 }, 16, 16)).toBeNull();
  });

  it("resolves percentage sizing against a bordered parent content box", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxHeight = Infinity;
    context.applySizingConstraints(node, {
      computedStyles: { minWidth: "50%", maxHeight: "50%" },
    }, {
      rect: { width: 400, height: 240 },
      layout: { padding: ["10px", "20px", "30px", "40px"] },
      borders: [
        { width: 2 },
        { width: 4 },
        { width: 6 },
        { width: 8 },
      ],
    });

    // CSS percentages use the content box: width 400 - 20/40 padding -
    // 8/4 borders = 328, height 240 - 10/30 padding - 2/6 borders = 192.
    expect(node.minWidth).toBe(164);
    expect(node.maxHeight).toBe(96);
  });

  it("does not invent missing sides for an asymmetric parent border", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    context.applySizingConstraints(node, {
      computedStyles: { minWidth: "50%" },
    }, {
      rect: { width: 400, height: 240 },
      layout: { padding: [0, 0, 0, 0] },
      stroke: { width: 6 },
      borders: [{ width: 2 }, undefined, undefined, undefined],
    });

    // Only the top border exists; horizontal content width remains 400px.
    expect(node.minWidth).toBe(200);
  });

  it("resolves root percentage constraints against the captured viewport", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxHeight = Infinity;
    context.applySizingConstraints(node, {
      rect: { width: 800, height: 600 },
      computedStyles: { minWidth: "50%", maxHeight: "25%" },
    });
    expect(node.minWidth).toBe(400);
    expect(node.maxHeight).toBe(150);
  });

  it("resolves root bounds against the visible viewport instead of document extent", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxHeight = Infinity;

    context.applySizingConstraints(node, {
      rect: { width: 1440, height: 3000 },
      computedStyles: { minWidth: "50%", maxHeight: "25%" },
    }, undefined, { width: 1440, height: 900 });

    expect(node.minWidth).toBe(720);
    expect(node.maxHeight).toBe(225);
  });

  it("resolves calc, min, max, and clamp sizing constraints", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.minHeight = 0;
    node.maxHeight = Infinity;
    const parent = { rect: { width: 800, height: 600 }, layout: { padding: [0, 0, 0, 0] } };
    context.applySizingConstraints(node, {
      computedStyles: {
        minWidth: "calc(50% - 20px)",
        maxWidth: "min(500px, 80%)",
        minHeight: "max(100px, 25%)",
        maxHeight: "10vh",
      },
    }, parent);
    expect(node.minWidth).toBe(380);
    expect(node.maxWidth).toBe(500);
    expect(node.minHeight).toBe(150);
    // CSS keeps the minimum when the resolved max is smaller than it.
    expect(node.maxHeight).toBe(150);

    context.applySizingConstraints(node, {
      computedStyles: { minWidth: "clamp(240px, 60%, 420px)" },
    }, parent);
    expect(node.minWidth).toBe(420);
  });

  it("recovers stable absolute endpoints from responsive size expressions", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.minHeight = 0;
    node.maxHeight = Infinity;
    const parent = { rect: { width: 800, height: 600 }, layout: { padding: [0, 0, 0, 0] } };

    context.applySizingConstraints(node, {
      id: "responsive-expression-bounds",
      rect: { x: 0, y: 0, width: 480, height: 240 },
      layout: {
        widthExpression: "clamp(240px, 60%, 420px)",
        heightExpression: "fit-content(480px)",
      },
    }, parent);

    // The percentage branch remains metadata-only, while the stable absolute
    // endpoints are useful native editing bounds in Figma.
    expect(node.minWidth).toBe(240);
    expect(node.maxWidth).toBe(420);
    expect(node.maxHeight).toBe(480);
  });

  it("reapplies responsive expression endpoints after Auto Layout normalizes them", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.maxHeight = Infinity;
    const parent = { rect: { width: 800, height: 600 }, layout: { mode: "vertical", padding: [0, 0, 0, 0] } };
    const scene = {
      id: "responsive-expression-reverify",
      rect: { x: 0, y: 0, width: 360, height: 240 },
      layout: {
        widthExpression: "clamp(240px, 60%, 420px)",
        heightExpression: "fit-content(480px)",
      },
      children: [],
    };
    const report = importReport();

    context.applySizingConstraints(node, scene, parent, undefined, report);
    expect(node.minWidth).toBe(240);
    expect(node.maxWidth).toBe(420);
    expect(node.maxHeight).toBe(480);

    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.maxHeight = Infinity;
    context.verifySceneSizingConstraints(scene, node, parent, undefined, report);

    expect(node.minWidth).toBe(240);
    expect(node.maxWidth).toBe(420);
    expect(node.maxHeight).toBe(480);
    expect(node.getPluginData("open-canvas-responsive-sizing")).toBe(JSON.stringify({
      width: "clamp(240px, 60%, 420px)",
      height: "fit-content(480px)",
    }));
  });

  it("does not reintroduce an expression minimum over explicit min-width zero during verification", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    const parent = { rect: { width: 800, height: 600 }, layout: { mode: "vertical", padding: [0, 0, 0, 0] } };
    const scene = {
      id: "explicit-zero-expression-reverify",
      rect: { x: 0, y: 0, width: 320, height: 120 },
      computedStyles: { minWidth: "0px" },
      layout: { widthExpression: "clamp(240px, 60%, 420px)" },
      children: [],
    };

    context.verifySceneSizingConstraints(scene, node, parent, undefined, importReport());

    expect(node.minWidth).toBe(0);
    expect(node.maxWidth).toBe(420);
  });

  it("lets compatibility reset keywords fall through to responsive expression endpoints", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.maxHeight = Infinity;
    const parent = { rect: { width: 800, height: 600 }, layout: { mode: "vertical", padding: [0, 0, 0, 0] } };
    const scene = {
      id: "reset-keyword-expression-bounds",
      rect: { x: 0, y: 0, width: 360, height: 240 },
      computedStyles: {
        minWidth: "initial",
        maxWidth: "unset",
        maxHeight: "revert-layer",
      },
      layout: {
        widthExpression: "clamp(240px, 60%, 420px)",
        heightExpression: "fit-content(480px)",
      },
      children: [],
    };
    const report = importReport();

    context.applySizingConstraints(node, scene, parent, undefined, report);
    expect(node.minWidth).toBe(240);
    expect(node.maxWidth).toBe(420);
    expect(node.maxHeight).toBe(480);

    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.maxHeight = Infinity;
    context.verifySceneSizingConstraints(scene, node, parent, undefined, report);

    expect(node.minWidth).toBe(240);
    expect(node.maxWidth).toBe(420);
    expect(node.maxHeight).toBe(480);
    expect(node.getPluginData("open-canvas-sizing-constraints")).toBe("");
  });

  it("recovers a stable max from min() without inventing a percentage bound", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.maxWidth = Infinity;

    context.applySizingConstraints(node, {
      id: "responsive-min-expression",
      rect: { x: 0, y: 0, width: 320, height: 120 },
      layout: { widthExpression: "min(500px, 80%)" },
    }, {
      rect: { width: 800, height: 600 },
      layout: { padding: [0, 0, 0, 0] },
    });

    expect(node.maxWidth).toBe(500);
  });

  it("does not override an explicit zero sizing bound", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;

    context.applySizingConstraints(node, {
      id: "explicit-zero-bound",
      rect: { x: 0, y: 0, width: 320, height: 120 },
      computedStyles: { minWidth: "0px" },
      layout: { widthExpression: "clamp(240px, 60%, 420px)" },
    }, {
      rect: { width: 800, height: 600 },
      layout: { padding: [0, 0, 0, 0] },
    });

    expect(node.minWidth).toBe(0);
    expect(node.maxWidth).toBe(420);
  });

  it("keeps parameterized fit-content bounds as editable numeric caps", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.maxHeight = Infinity;
    const parent = { rect: { width: 800, height: 600 }, layout: { padding: [0, 0, 0, 0] } };

    context.applySizingConstraints(node, {
      computedStyles: {
        maxWidth: "fit-content(480px)",
        maxHeight: "fit-content(50%)",
      },
    }, parent);

    expect(node.maxWidth).toBe(480);
    expect(node.maxHeight).toBe(300);
  });

  it("does not let a conflicting native bound resize the captured box", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.maxWidth = Infinity;
    node.maxHeight = Infinity;
    const report = { sizingFallbacks: 0, sizingFallbackNodes: [] };

    context.applySizingConstraints(node, {
      id: "captured-fit-root",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      computedStyles: { maxWidth: "fit-content(240px)", maxHeight: "fit-content(50%)" },
    }, {
      rect: { width: 320, height: 180 },
      layout: { padding: [0, 0, 0, 0] },
    }, undefined, report);

    expect(node.maxWidth).toBe(Infinity);
    expect(node.maxHeight).toBe(Infinity);
    expect(report.sizingFallbacks).toBe(2);
    expect(report.sizingFallbackNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "captured-fit-root", axis: "width", maxSkipped: true }),
      expect.objectContaining({ id: "captured-fit-root", axis: "height", maxSkipped: true }),
    ]));
  });

  it("reapplies responsive min/max bounds after sizing restoration resets them", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    const scene = {
      id: "responsive-card",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      computedStyles: { minWidth: "160px", maxWidth: "320px" },
      children: [],
    };
    const report = { sizingFallbacks: 0, sizingFallbackNodes: [] };
    context.applySizingConstraints(node, scene, { rect: { width: 800, height: 600 }, layout: { padding: [0, 0, 0, 0] } }, undefined, report);
    expect(node.minWidth).toBe(160);
    expect(node.maxWidth).toBe(320);
    node.minWidth = 0;
    node.maxWidth = Infinity;
    context.verifySceneSizingConstraints(scene, node, { rect: { width: 800, height: 600 }, layout: { padding: [0, 0, 0, 0] } }, undefined, report);
    expect(node.minWidth).toBe(160);
    expect(node.maxWidth).toBe(320);
    expect(report.sizingFallbacks).toBe(0);
  });

  it("clears stale native bounds and sizing metadata when the source constraints are removed", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 120;
    node.maxWidth = 480;
    node.minHeight = 80;
    node.maxHeight = 320;
    node.setPluginData("open-canvas-sizing-constraints", JSON.stringify({
      minWidth: "120px",
      maxWidth: "480px",
      minHeight: "80px",
      maxHeight: "320px",
    }));
    node.setPluginData("open-canvas-responsive-sizing", JSON.stringify({ width: "clamp(120px, 50%, 480px)" }));
    const report = importReport();
    const scene = {
      id: "removed-sizing-constraints",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      computedStyles: {},
      layout: { widthExpression: "", heightExpression: "" },
      children: [],
    };

    context.verifySceneSizingConstraints(scene, node, undefined, { width: 800, height: 600 }, report);

    expect(node.minWidth).toBe(0);
    expect(node.maxWidth).toBe(Infinity);
    expect(node.minHeight).toBe(0);
    expect(node.maxHeight).toBe(Infinity);
    expect(node.getPluginData("open-canvas-sizing-constraints")).toBe("");
    expect(node.getPluginData("open-canvas-responsive-sizing")).toBe("");
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("keeps current bounds while clearing only a removed axis bound on reused nodes", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 120;
    node.maxWidth = 480;
    node.setPluginData("open-canvas-sizing-constraints", JSON.stringify({
      minWidth: "120px",
      maxWidth: "480px",
    }));
    node.setPluginData("open-canvas-responsive-sizing", JSON.stringify({ width: "50%" }));
    const report = importReport();
    const scene = {
      id: "partial-sizing-constraints",
      rect: { x: 0, y: 0, width: 320, height: 120 },
      computedStyles: { maxWidth: "360px" },
      layout: { widthExpression: "50%" },
      children: [],
    };

    context.verifySceneSizingConstraints(scene, node, undefined, { width: 800, height: 600 }, report);

    expect(node.minWidth).toBe(0);
    expect(node.maxWidth).toBe(360);
    expect(node.getPluginData("open-canvas-sizing-constraints")).toBe(JSON.stringify({ maxWidth: "360px" }));
    expect(node.getPluginData("open-canvas-responsive-sizing")).toBe(JSON.stringify({ width: "50%" }));
    expect(report.sizingFallbacks || 0).toBe(0);
  });

  it("reports a native min/max sizing write that cannot be read back", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    let minWidth = 0;
    Object.defineProperty(node, "minWidth", {
      configurable: true,
      get: () => minWidth,
      set: () => { /* silently normalized by the host */ },
    });
    const report = { sizingFallbacks: 0, sizingFallbackNodes: [] };
    context.applySizingConstraints(node, {
      id: "readonly-min-width",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      computedStyles: { minWidth: "160px" },
    }, { rect: { width: 800, height: 600 }, layout: { padding: [0, 0, 0, 0] } }, undefined, report);
    expect(minWidth).toBe(0);
    expect(report.sizingFallbacks).toBe(1);
    expect(report.sizingFallbackNodes[0]).toMatchObject({ kind: "native-width-min-readback", axis: "width" });
  });

  it("reports missing native min/max sizing properties instead of silently dropping CSS bounds", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    delete node.minWidth;
    delete node.maxWidth;
    const report = { sizingFallbacks: 0, sizingFallbackNodes: [] };
    context.applySizingConstraints(node, {
      id: "missing-min-max-api",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      computedStyles: { minWidth: "160px", maxWidth: "320px" },
    }, { rect: { width: 800, height: 600 }, layout: { padding: [0, 0, 0, 0] } }, undefined, report);

    expect(report.sizingFallbackNodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "missing-min-max-api",
        kind: "native-width-min-unavailable",
        axis: "width",
        expected: 160,
      }),
      expect.objectContaining({
        id: "missing-min-max-api",
        kind: "native-width-max-unavailable",
        axis: "width",
        expected: 320,
      }),
    ]));
    expect(report.sizingFallbacks).toBe(2);
  });

  it("lets an over-constrained CSS minimum win over the maximum", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    node.minHeight = 0;
    node.maxHeight = Infinity;
    const parent = { rect: { width: 800, height: 600 }, layout: { padding: [0, 0, 0, 0] } };

    context.applySizingConstraints(node, {
      computedStyles: {
        minWidth: "500px",
        maxWidth: "40%",
        minHeight: "300px",
        maxHeight: "20%",
      },
    }, parent);

    // The browser's used-value algorithm keeps the minimum when min > max.
    expect(node.minWidth).toBe(500);
    expect(node.maxWidth).toBe(500);
    expect(node.minHeight).toBe(300);
    expect(node.maxHeight).toBe(300);
  });

  it("resolves viewport sizing units against the captured document viewport", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxHeight = Infinity;

    context.applySizingConstraints(node, {
      rect: { width: 320, height: 180 },
      computedStyles: { minWidth: "10vw", maxHeight: "10vh" },
    }, {
      rect: { width: 320, height: 600 },
      layout: { padding: [0, 0, 0, 0] },
    }, { width: 1440, height: 900 });

    expect(node.minWidth).toBe(144);
    expect(node.maxHeight).toBe(90);
  });

  it("resolves small, large, and dynamic viewport sizing units against the captured viewport", () => {
    const context = loadPluginFunctions();
    const viewport = { width: 1440, height: 900 };
    const parent = { rect: { width: 320, height: 180 }, layout: { padding: [0, 0, 0, 0] } };
    const cases = [
      ["10svw", "width", 144],
      ["10lvw", "width", 144],
      ["10dvw", "width", 144],
      ["10svh", "height", 90],
      ["10lvh", "height", 90],
      ["10dvh", "height", 90],
      ["10svmin", "width", 90],
      ["10lvmax", "width", 144],
      ["10dvmin", "height", 90],
      ["10dvmax", "height", 144],
    ];
    for (const [expression, axis, expected] of cases) {
      expect(context.resolveSizingConstraint(expression, axis, parent, viewport)).toBe(expected);
    }
    expect(context.resolveSizingConstraint("calc(5svw + 2dvw)", "width", parent, viewport)).toBe(100.8);
    expect(context.resolveSizingConstraint("calc(100% * 0.5)", "width", parent, viewport)).toBe(160);
    expect(context.resolveSizingConstraint("calc(320px / 2)", "width", parent, viewport)).toBe(160);
    expect(context.resolveSizingConstraint("calc(50% + 20px * 2)", "width", parent, viewport)).toBe(200);
    expect(context.resolveSizingConstraint("calc((100% - 20px) / 2)", "width", parent, viewport)).toBe(150);
    expect(context.resolveSizingConstraint("calc(min(320px, 100%) - 20px)", "width", parent, viewport)).toBe(300);
    expect(context.resolveSizingConstraint("calc(100% + 2)", "width", parent, viewport)).toBeNull();
    expect(context.resolveSizingConstraint("clamp(40px, 10svmin, 120px)", "width", parent, viewport)).toBe(90);
  });

  it("prefers the visible viewport over the full document height for viewport units", () => {
    const context = loadPluginFunctions();
    const viewport = context.importViewportForPayload({
      viewport: { width: 1440, height: 3000 },
      viewportRect: { x: 0, y: 0, width: 1440, height: 900 },
      root: { computedStyles: { fontSize: "18px" } },
    }, {}, { rect: { width: 320, height: 180 } });

    expect(viewport).toMatchObject({ width: 1440, height: 900, rootFontSize: 18 });
  });

  it("uses metadata viewport dimensions when compatibility payload fields are trimmed", () => {
    const context = loadPluginFunctions();
    const viewport = context.importViewportForPayload(
      null,
      { root: { styles: { fontSize: "16px" } }, documentRect: { x: 0, y: 0, width: 1920, height: 3000 } },
      { rect: { x: 0, y: 0, width: 1920, height: 3000 } },
      { viewport: { width: 1920, height: 3000 }, viewportRect: { x: 0, y: 0, width: 1920, height: 1080 } },
    );
    expect(viewport).toMatchObject({ width: 1920, height: 1080, rootFontSize: 16 });
  });

  it("resolves em and rem sizing constraints from captured typography", () => {
    const context = loadPluginFunctions();
    const node = mockFigmaNode("FRAME");
    node.minWidth = 0;
    node.maxWidth = Infinity;
    context.applySizingConstraints(node, {
      rect: { width: 50, height: 40 },
      computedStyles: {
        fontSize: "20px",
        minWidth: "2em",
        maxWidth: "3rem",
      },
    }, {
      rect: { width: 320, height: 180 },
      layout: { padding: [0, 0, 0, 0] },
    }, { width: 1440, height: 900, rootFontSize: 18 });

    expect(node.minWidth).toBe(40);
    expect(node.maxWidth).toBe(54);
  });

  it("imports the shared scene directly, preserving measured text and image assets", async () => {
    const context = loadPluginFunctions();
    let createdImages = 0;
    const sequence = { value: 0 };
    context.figma.createFrame = () => mockFigmaNode("FRAME", sequence);
    context.figma.createText = () => {
      const node = mockFigmaNode("TEXT", sequence);
      node.textAutoResize = "NONE";
      node.fontName = { family: "Inter", style: "Regular" };
      node.fontSize = 16;
      node.characters = "";
      return node;
    };
    context.figma.createRectangle = () => mockFigmaNode("RECTANGLE", sequence);
    context.figma.createImage = () => ({ hash: `image-${++createdImages}` });
    context.figma.loadFontAsync = async () => {};

    const root = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", gap: 8, padding: [12, 16, 12, 16], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [
        {
          id: "heading",
          sourceTag: "H2",
          type: "text",
          rect: { x: 16, y: 12, width: 180, height: 32 },
          textRect: { x: 2, y: 3, width: 120, height: 27 },
          opacity: 1,
          computedStyles: { minWidth: "50%", maxWidth: "430px" },
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          positioning: "static",
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", widthExpression: "50%", position: "flow", geometryLock: true },
          text: { content: "Arena House", fontFamily: "Inter", fontSize: 24, fontWeight: 700, lineHeight: 32, letterSpacing: 0, textAlign: "left" },
          children: [],
        },
        {
          id: "poster",
          type: "image",
          rect: { x: 16, y: 52, width: 120, height: 80 },
          opacity: 1,
          radius: [8, 8, 8, 8],
          margin: [0, 0, 0, 0],
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
          assetId: "poster-1",
          objectFit: "cover",
          objectPosition: "right 10px bottom 5px",
          children: [],
        },
      ],
    };
    const parent = { type: "PAGE", children: [], appendChild: mockFigmaNode("PAGE").appendChild };
    const report = importReport();
    const assets = context.mergeSceneAssets(
      [{ id: "poster-1", kind: "image", src: "https://example.test/poster.png" }],
      [{ id: "poster-1", url: "https://example.test/poster.png", data: "data:image/png;base64,AAAA" }],
    );

    const imported = await context.createNode(root, parent, assets, report, undefined, { images: new Map(), vectors: new Map() });

    const importedChildren = context.sceneChildren(imported);
    expect(importedChildren).toHaveLength(2);
    expect(importedChildren[0].type).toBe("TEXT");
    expect(importedChildren[0].characters).toBe("Arena House");
    expect(importedChildren[0].getPluginData("open-canvas-sizing-constraints")).toBe(JSON.stringify({ minWidth: "50%", maxWidth: "430px" }));
    expect(importedChildren[0].getPluginData("open-canvas-responsive-sizing")).toBe(JSON.stringify({ width: "50%" }));
    expect(report.styleDegradationNodes).toContainEqual(expect.objectContaining({
      id: "heading",
      message: expect.stringContaining("width 50%"),
    }));
    expect(importedChildren[0].x).toBe(18);
    expect(importedChildren[0].y).toBe(15);
    expect(importedChildren[1].fills).toEqual([{
      type: "IMAGE",
      imageHash: "image-1",
      blendMode: "NORMAL",
      scaleMode: "CROP",
      imageTransform: [[1, 0, -0.416667], [0, 1, -0.4375]],
    }]);
    expect(createdImages).toBe(1);
    expect(importedChildren[1].width).toBe(120);
    expect(importedChildren[1].height).toBe(80);
  });

  it("keeps measured flow placeholders in source order without adding a second gap", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    const page = mockFigmaNode("PAGE");
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 220, height: 140 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", gap: 8, padding: [16, 16, 16, 16], position: "flow", visualSnapshot: true },
      children: [
        {
          id: "first",
          type: "frame",
          rect: { x: 16, y: 16, width: 188, height: 40 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow", geometryLock: true },
          children: [],
        },
        {
          id: "second",
          type: "frame",
          rect: { x: 16, y: 64, width: 188, height: 24 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow", geometryLock: true },
          children: [],
        },
      ],
    };

    const imported = await context.createNode(scene, page, [], importReport(), undefined, {
      images: new Map(),
      vectors: new Map(),
    });

    expect(imported.children.map(child => child.name)).toEqual([
      "__css-margin-flow-first",
      "first",
      "__css-margin-flow-second",
      "second",
    ]);
    expect(imported.children[0]).toMatchObject({ width: 188, height: 40 });
    expect(imported.children[2]).toMatchObject({ width: 188, height: 24 });
    expect(imported.children[1]).toMatchObject({ x: 16, y: 16, width: 188, height: 40 });
    expect(imported.children[3]).toMatchObject({ x: 16, y: 64, width: 188, height: 24 });
  });

  it("imports a geometry-locked anonymous text run with one stable flow slot", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    context.figma.createText = () => mockFigmaNode("TEXT");
    context.figma.loadFontAsync = async () => undefined;
    const page = mockFigmaNode("PAGE");
    const scene = {
      id: "wrapped-grid",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "horizontal", wrap: true, gap: 8, padding: [8, 8, 8, 8], position: "flow" },
      children: [{
        id: "wrapped-grid-label",
        type: "text",
        rect: { x: 48, y: 28, width: 80, height: 24 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], position: "flow", geometryLock: true },
        text: { content: "Label", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 24, letterSpacing: 0, textAlign: "left" },
        children: [],
      }],
    };
    const report = importReport();

    const imported = await context.createNode(scene, page, [], report, undefined, {
      images: new Map(),
      vectors: new Map(),
    });

    expect(imported.children.map(child => child.name)).toEqual([
      "__css-margin-flow-wrapped-grid-label",
      "wrapped-grid-label",
    ]);
    const placeholder = imported.children[0];
    const label = imported.children[1];
    expect(placeholder).toMatchObject({ width: 80, height: 24, opacity: 0 });
    expect(label).toMatchObject({
      type: "TEXT",
      characters: "Label",
      x: 48,
      y: 28,
      width: 80,
      height: 24,
      layoutPositioning: "ABSOLUTE",
      layoutSizingHorizontal: "FIXED",
      layoutSizingVertical: "FIXED",
      lineHeight: { unit: "PIXELS", value: 24 },
    });
    expect(report.lineHeightFailures).toBe(0);
  });

  it("does not reorder measured flow children as if they were CSS absolute layers", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "VERTICAL";
    const measured = mockFigmaNode("RECTANGLE");
    const flow = mockFigmaNode("RECTANGLE");
    parent.appendChild(measured);
    parent.appendChild(flow);

    context.reorderPositionedChildren(parent, {
      children: [
        { id: "measured", layout: { geometryLock: true, position: "flow" } },
        { id: "flow", layout: { position: "flow" } },
      ],
    });

    expect(parent.children).toEqual([measured, flow]);
  });

  it("keeps captured parent-local coordinates for native Figma absolute layers", () => {
    const context = loadPluginFunctions();
    const parent = {
      borders: [
        { width: 3 },
        { width: 5 },
        { width: 7 },
        { width: 4 },
      ],
    };
    expect(context.measuredTextPosition({
      rect: { x: 22, y: 31, width: 20, height: 10 },
      positioning: "absolute",
      layout: { position: "absolute" },
    }, parent)).toEqual({ x: 22, y: 31 });
    expect(context.measuredTextPosition({
      rect: { x: 22, y: 31, width: 20, height: 10 },
      positioning: "static",
      layout: { position: "flow" },
    }, parent)).toEqual({ x: 22, y: 31 });
    expect(context.measuredTextPosition({
      rect: { x: 22, y: 31, width: 20, height: 10 },
      positioning: "static",
      layout: { position: "flow", geometryLock: true },
    }, parent)).toEqual({ x: 22, y: 31 });
    expect(context.measuredTextPosition({
      rect: { x: 22, y: 31, width: 20, height: 10 },
      positioning: "fixed",
      layout: { position: "absolute" },
    }, parent)).toEqual({ x: 22, y: 31 });
  });

  it("preserves captured glyph metrics for ordinary Auto Layout text without moving its flow slot", () => {
    const context = loadPluginFunctions();
    const node = {
      type: "TEXT",
      relativeTransform: [[1, 0, 0], [0, 1, 0]],
    };
    context.applyFlowTextGlyphOffset(node, {
      type: "text",
      textRect: { x: 0, y: -3, width: 120, height: 30 },
      text: { textAlign: "left" },
      layout: { geometryLock: false },
    }, true);
    expect(node.relativeTransform).toEqual([[1, 0, 0], [0, 1, -3]]);
  });

  it("nudges a flow child without converting it to absolute positioning", () => {
    const context = loadPluginFunctions();
    const node = {
      layoutPositioning: "AUTO",
      layoutSizingHorizontal: "FILL",
      layoutSizingVertical: "HUG",
      relativeTransform: [[1, 0, 10], [0, 1, 20]],
    };

    expect(context.translateRelative(node, -4, 3)).toBe(true);
    expect(node.relativeTransform).toEqual([[1, 0, 6], [0, 1, 23]]);
    expect(node.layoutPositioning).toBe("AUTO");
    expect(node.layoutSizingHorizontal).toBe("FILL");
    expect(node.layoutSizingVertical).toBe("HUG");
    // Figma's matrix contains the complete rendered parent-local position.
    // It must replace, rather than be added to, the Auto Layout slot x/y.
    expect(context.visualNodePosition({ x: 10, y: 20, relativeTransform: node.relativeTransform })).toEqual({ x: 6, y: 23 });
  });

  it("keeps cross-axis CSS margins in Auto Layout flow", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    const page = mockFigmaNode("PAGE");
    const scene = {
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 220, height: 100 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", alignItems: "stretch", gap: 0, padding: [0, 16, 0, 16], position: "flow" },
      children: [{
        id: "inset",
        type: "frame",
        rect: { x: 21, y: 0, width: 178, height: 40 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 5, 0, 5],
        layout: { mode: "none", widthMode: "fill", heightMode: "fixed", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
        children: [],
      }],
    };

    const imported = await context.createNode(scene, page, [], importReport(), undefined, {
      images: new Map(),
      vectors: new Map(),
    });
    const inset = imported.children.find(child => child.name === "inset");

    expect(inset.layoutPositioning).not.toBe("ABSOLUTE");
    expect(inset.layoutAlign).toBe("INHERIT");
    expect(imported.children.some(child => child.name === "__css-margin-flow-inset")).toBe(false);
  });

  it("does not let explicit align-self stretch swallow cross-axis margins", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    const page = mockFigmaNode("PAGE");
    const scene = {
      id: "root-explicit-stretch",
      type: "frame",
      rect: { x: 0, y: 0, width: 220, height: 100 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", alignItems: "center", gap: 0, padding: [0, 16, 0, 16], position: "flow" },
      children: [{
        id: "explicit-stretch-inset",
        type: "frame",
        rect: { x: 21, y: 0, width: 178, height: 40 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 5, 0, 5],
        layout: { mode: "none", widthMode: "fill", heightMode: "fixed", alignSelf: "stretch", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
        children: [],
      }],
    };

    const imported = await context.createNode(scene, page, [], importReport(), undefined, {
      images: new Map(),
      vectors: new Map(),
    });
    const inset = imported.children.find(child => child.name === "explicit-stretch-inset");

    expect(inset.layoutAlign).toBe("INHERIT");
    expect(inset.layoutPositioning).not.toBe("ABSOLUTE");
  });

  it("clears stale child stretch alignment when the source returns to inherited alignment", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => {
      const node = mockFigmaNode("FRAME");
      node.layoutAlign = "STRETCH";
      return node;
    };
    const page = mockFigmaNode("PAGE");
    const scene = {
      id: "root-alignment-reset",
      type: "frame",
      rect: { x: 0, y: 0, width: 220, height: 100 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", alignItems: "center", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
      children: [{
        id: "child-alignment-reset",
        type: "frame",
        rect: { x: 0, y: 0, width: 120, height: 40 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { mode: "none", alignSelf: "auto", widthMode: "fixed", heightMode: "fixed", gap: 0, padding: [0, 0, 0, 0], position: "flow" },
        children: [],
      }],
    };

    const imported = await context.createNode(scene, page, [], importReport(), undefined, {
      images: new Map(),
      vectors: new Map(),
    });

    expect(imported.children[0].layoutAlign).toBe("INHERIT");
  });

  it("compiles cross-axis margins into an editable Auto Layout wrapper", () => {
    const context = loadPluginFunctions();
    const wrapped = context.wrapCrossAxisMargins({
      id: "root",
      type: "frame",
      rect: { x: 0, y: 0, width: 220, height: 100 },
      margin: [0, 0, 0, 0],
      layout: { mode: "vertical", padding: [0, 16, 0, 16] },
      children: [{
        id: "inset",
        type: "frame",
        rect: { x: 21, y: 10, width: 178, height: 40 },
        margin: [4, 5, 6, 5],
        layout: { mode: "none", position: "flow", widthMode: "fill", heightMode: "fixed" },
        children: [],
      }],
    });
    const wrapper = wrapped.children[0];
    expect(wrapper).toMatchObject({
      id: "__css-cross-margin-inset",
      rect: { x: 16, y: 10, width: 188, height: 40 },
      margin: [4, 0, 6, 0],
      layout: { mode: "horizontal", padding: [0, 5, 0, 5], widthMode: "fill" },
    });
    expect(wrapper.children[0]).toMatchObject({
      id: "inset",
      rect: { x: 5, y: 0, width: 178, height: 40 },
      margin: [0, 0, 0, 0],
      layout: { position: "flow", widthMode: "fill", alignSelf: "stretch" },
    });
  });

  it("does not apply the glyph inset twice to measured text layers", () => {
    const context = loadPluginFunctions();
    const node = {
      type: "TEXT",
      relativeTransform: [[1, 0, 0], [0, 1, 0]],
    };
    context.applyFlowTextGlyphOffset(node, {
      type: "text",
      textRect: { x: 0, y: -3, width: 120, height: 30 },
      text: { textAlign: "left" },
      layout: { geometryLock: true },
    }, true);
    expect(node.relativeTransform).toEqual([[1, 0, 0], [0, 1, 0]]);
  });

  it("surfaces the largest remaining geometry mismatch first", () => {
    const context = loadPluginFunctions();
    const report = {
      remainingMismatchNodes: [
        { id: "small", positionDelta: { x: 1, y: 0 }, sizeDelta: { width: 0, height: 0 } },
        { id: "large", positionDelta: { x: 0, y: -7 }, sizeDelta: { width: 2, height: 0 } },
      ],
    };
    context.sortGeometryMismatchNodes(report);
    expect(report.remainingMismatchNodes.map(node => node.id)).toEqual(["large", "small"]);
    expect(report.worstGeometryMismatch.id).toBe("large");
  });

  it("does not over-count CSS margins when an Auto Layout parent has a gap", () => {
    const context = loadPluginFunctions();
    expect(context.marginSpacerSize(28, { layout: { mode: "vertical", gap: 20, rowGap: 20 } })).toBe(8);
    expect(context.marginSpacerSize(60, { layout: { mode: "vertical", gap: 20, rowGap: 20 } })).toBe(40);
    expect(context.marginSpacerSize(12, { layout: { mode: "horizontal", gap: 4, columnGap: 4 } })).toBe(8);
    expect(context.marginSpacerSize(12, { layout: { mode: "none", gap: 8 } })).toBe(12);
    expect(context.marginForAutoLayout({ margin: ["8px", "4px", "6px", "2px"] }, { layoutMode: "VERTICAL" })).toEqual({
      mode: "vertical",
      before: 8,
      after: 6,
      crossStart: 2,
      crossEnd: 4,
    });
    expect(context.crossMarginExtent({ margin: ["8px", "4px", "6px", "2px"] }, "horizontal")).toBe(14);
    expect(context.marginSpacerSize("28px", { layout: { mode: "vertical", gap: "20px", rowGap: "20px" } })).toBe(8);
  });

  it("uses a growing spacer for main-axis auto margins", () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    const parent = mockFigmaNode("FRAME");
    parent.layoutMode = "HORIZONTAL";
    parent.resize(240, 40);

    const spacer = context.createMarginSpacer(parent, 0, "horizontal", true, "auto-margin-item", true);

    expect(spacer).toBeTruthy();
    expect(spacer.layoutGrow).toBe(1);
    expect(spacer.layoutSizingHorizontal).toBe("FIXED");
    expect(spacer.getPluginData("open-canvas-auto-margin-spacer")).toBe("1");
    expect(context.autoMarginMainAxis({ layout: { autoMargins: [false, false, false, true] } }, { computedStyles: { display: "flex" }, layout: { mode: "horizontal" } })).toEqual({ before: true, after: false });
    expect(context.autoMarginMainAxis({ layout: { autoMargins: [true, false, false, false] } }, { computedStyles: { display: "flex" }, layout: { mode: "horizontal" } })).toEqual({ before: false, after: false });
    expect(context.autoMarginMainAxis({ layout: { autoMargins: [false, false, false, true] } }, { computedStyles: { display: "grid" }, layout: { mode: "horizontal" } })).toEqual({ before: false, after: false });
  });

  it("inserts a growing auto-margin spacer before a measured flex child", async () => {
    const context = loadPluginFunctions();
    context.figma.createFrame = () => mockFigmaNode("FRAME");
    const page = mockFigmaNode("PAGE");
    const report = importReport();
    const rootScene = {
      id: "auto-margin-flex-root",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 40 },
      computedStyles: { display: "flex", flexDirection: "row" },
      layout: { mode: "horizontal", gap: 0, padding: [0, 0, 0, 0], position: "flow", widthMode: "fixed", heightMode: "fixed" },
      children: [{
        id: "auto-margin-flex-item",
        type: "frame",
        rect: { x: 180, y: 0, width: 60, height: 40 },
        layout: { mode: "none", autoMargins: [false, false, false, true], position: "flow", geometryLock: true, widthMode: "fixed", heightMode: "fixed" },
        children: [],
      }],
    };

    const imported = await context.createNode(rootScene, page, [], report, undefined, {
      images: new Map(),
      vectors: new Map(),
    });
    const spacer = imported.children.find(child => String(child.name || "").startsWith("__css-margin-spacer-before-auto-margin-flex-item"));
    const item = imported.children.find(child => child.getPluginData?.("open-canvas-id") === "auto-margin-flex-item");

    expect(spacer?.layoutGrow).toBe(1);
    expect(spacer?.getPluginData("open-canvas-auto-margin-spacer")).toBe("1");
    expect(item?.layoutPositioning).toBe("ABSOLUTE");
  });

  it("resolves legacy CSS gap strings against the container content box", () => {
    const context = loadPluginFunctions();
    const scene = {
      rect: { width: 300, height: 200 },
      computedStyles: { display: "flex", flexDirection: "column", fontSize: "16px" },
      layout: {
        mode: "vertical",
        padding: [10, 0, 10, 0],
        rowGap: "10%",
        columnGap: "12px",
      },
    };

    expect(context.flowAxisGap(scene)).toBe(18);
    expect(context.counterAxisGap(scene)).toBe(12);
  });

  it("matches post-stack children by scene id after absolute-layer reordering", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const flow = mockFigmaNode("RECTANGLE");
    flow.name = "flow";
    const overlay = mockFigmaNode("RECTANGLE");
    overlay.name = "overlay";
    parent.appendChild(flow);
    parent.appendChild(overlay);

    expect(context.sceneChildNode(parent, { id: "overlay" }, 0)).toBe(overlay);
    expect(context.sceneChildNode(parent, { id: "flow" }, 1)).toBe(flow);
  });

  it("matches legacy children by CSS order when stable ids are unavailable", () => {
    const context = loadPluginFunctions();
    const parent = mockFigmaNode("FRAME");
    const firstCreated = mockFigmaNode("RECTANGLE");
    firstCreated.name = "visual-b";
    firstCreated.setPluginData("open-canvas-source-index", "1");
    const secondCreated = mockFigmaNode("RECTANGLE");
    secondCreated.name = "visual-a";
    secondCreated.setPluginData("open-canvas-source-index", "0");
    // createNode() appends the CSS-order projection: B (order -1), then A
    // (order 1). The stable id is intentionally absent; the managed source
    // index is the fallback used by geometry/typography convergence.
    parent.appendChild(firstCreated);
    parent.appendChild(secondCreated);
    const a = { id: "a", layout: { order: 1 } };
    const b = { id: "b", layout: { order: -1 } };
    const scene = { children: [a, b] };
    expect(context.sceneChildNode(parent, a, 0)).toBe(secondCreated);
    expect(context.sceneChildNode(parent, b, 1)).toBe(firstCreated);
    expect(context.orderedSceneChildren(scene)).toEqual([b, a]);
  });
});
