import { describe, expect, it } from "vitest";
import { buildFigmaHtml, parseFigmaHtml, toH2D, wrapFigmaClipboardHtml } from "./h2d";
import { emptyLayout, type DesignDocument } from "./designModel";

const documentFixture = (): DesignDocument => ({
  version: 1,
  pageId: "page-1",
  title: "测试页面",
  viewport: { width: 430, height: 700 },
  devicePixelRatio: 2,
  root: {
    id: "root",
    type: "frame",
    rect: { x: 0, y: 0, width: 430, height: 700 },
    opacity: 1,
    radius: [0, 0, 0, 0],
    margin: [0, 0, 0, 0],
    layout: { mode: "vertical", gap: 12, padding: [16, 16, 16, 16], widthMode: "fixed", heightMode: "fixed", position: "flow" },
    children: [],
  },
  assets: [],
  fonts: [],
  diagnostics: [],
});

function elementText(node: ReturnType<typeof toH2D>["root"]["childNodes"][number]) {
  expect(node.nodeType).toBe(1);
  if (node.nodeType !== 1) throw new Error("Expected an H2D element wrapper");
  const text = node.childNodes.find((child) => child.nodeType === 3);
  expect(text?.nodeType).toBe(3);
  if (!text || text.nodeType !== 3) throw new Error("Expected an H2D text child");
  return { element: node, text };
}

describe("Figma H2D markers", () => {
  it("serializes reverse flex direction", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "horizontal", reverse: true };

    expect(toH2D(fixture).root.styles.flexDirection).toBe("row-reverse");
  });

  it("keeps inferred cross-axis FILL responsive in the native H2D path", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "vertical" };
    fixture.root.children = [{
      id: "stretching-panel",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 16, y: 16, width: 398, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), widthMode: "fill" },
      computedStyles: { display: "block", boxSizing: "border-box" },
      children: [],
    }];

    const panel = toH2D(fixture).root.childNodes[0];
    expect(panel.nodeType).toBe(1);
    if (panel.nodeType !== 1) return;
    expect(panel.styles.width).toBe("100%");
  });

  it("subtracts a filled child's own box extras without changing its measured height", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "vertical" };
    fixture.root.children = [{
      id: "padded-panel",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 16, y: 16, width: 398, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 4, 0, 4],
      layout: { ...emptyLayout(), widthMode: "fill", padding: [8, 12, 8, 12] },
      borders: [
        { color: "#000", width: 1 },
        { color: "#000", width: 1 },
        { color: "#000", width: 1 },
        { color: "#000", width: 1 },
      ],
      computedStyles: { display: "block", boxSizing: "content-box" },
      children: [],
    }];

    const panel = toH2D(fixture).root.childNodes[0];
    expect(panel.nodeType).toBe(1);
    if (panel.nodeType !== 1) return;
    expect(panel.styles.width).toBe("calc(100% - 34px)");
    expect(panel.styles.height).toBe("62px");
  });

  it("subtracts only borders for a padding-box filled child", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "vertical" };
    fixture.root.children = [{
      id: "padding-box-panel",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 16, y: 16, width: 398, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 4, 0, 4],
      layout: { ...emptyLayout(), widthMode: "fill", padding: [8, 12, 8, 12] },
      borders: [
        { color: "#000", width: 1 },
        { color: "#000", width: 2 },
        { color: "#000", width: 3 },
        { color: "#000", width: 4 },
      ],
      computedStyles: { display: "block", boxSizing: "padding-box" },
      children: [],
    }];

    const panel = toH2D(fixture).root.childNodes[0];
    expect(panel.nodeType).toBe(1);
    if (panel.nodeType !== 1) return;
    // Parent width 430 - padding 32 - margins 8 = 390; the child is
    // padding-box, so subtract only its 2px + 4px horizontal borders.
    expect(panel.styles.width).toBe("calc(100% - 14px)");
  });

  it("round-trips official metadata and H2D data", () => {
    const fixture = documentFixture();
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.metadata).toMatchObject({ dataType: "h2d", source: "open-canvas" });
    expect(parsed.metadata.capturedAtIso).toEqual(expect.any(String));
    expect(parsed.h2d.version).toBe(2);
    expect(parsed.h2d.root.styles.gap).toBe("12px");
  });

  it("publishes PC document and visible viewport dimensions separately", () => {
    const fixture = documentFixture();
    fixture.viewport = { width: 1920, height: 3000 };
    fixture.viewportRect = { x: 0, y: 0, width: 1920, height: 1080 };
    fixture.root.rect = { x: 0, y: 0, width: 1920, height: 3000 };

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.metadata).toMatchObject({
      pageId: "page-1",
      title: "测试页面",
      width: 1920,
      height: 3000,
      viewport: { width: 1920, height: 3000 },
      viewportRect: { x: 0, y: 0, width: 1920, height: 1080 },
      devicePixelRatio: 2,
    });
    expect(parsed.h2d.documentRect).toMatchObject({ width: 1920, height: 3000 });
    expect(parsed.h2d.viewportRect).toMatchObject({ width: 1920, height: 1080 });
  });

  it("maps content-visibility hidden to a hidden H2D replay layer", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "hidden-panel",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 16, y: 24, width: 240, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      computedStyles: { display: "block", contentVisibility: "hidden" },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles).toMatchObject({ visibility: "hidden" });
    expect(node.styles.contentVisibility).toBeUndefined();
  });

  it("keeps a border-image gradient when it is resolved on a non-top side", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "gradient-border",
      type: "frame",
      rect: { x: 0, y: 0, width: 180, height: 60 },
      opacity: 1,
      radius: [8, 8, 8, 8],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      borders: [
        { color: "rgba(0, 0, 0, 0)", width: 1, style: "solid", paintWidth: 3 },
        { color: "rgba(0, 0, 0, 0)", width: 1, style: "solid", gradient: "linear-gradient(90deg, #ff0000, #0000ff)", paintWidth: 4, paintOutset: 2 },
        undefined,
        undefined,
      ],
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles.borderImageSource).toBe("linear-gradient(90deg, #ff0000, #0000ff)");
      expect(node.styles.borderImageSlice).toBe("1");
      expect(node.styles.borderImageWidth).toBe("3px 4px 0px 0px");
      expect(node.styles.borderImageOutset).toBe("0px 2px 0px 0px");
    }
  });

  it("embeds a captured border-image URL asset in the H2D source", () => {
    const fixture = documentFixture();
    fixture.assets = [{
      id: "asset-border-image",
      kind: "image",
      src: "https://example.com/frame.png",
      data: "data:image/png;base64,ZmFrZQ==",
    }];
    fixture.root.children = [{
      id: "image-border",
      type: "frame",
      rect: { x: 0, y: 0, width: 180, height: 60 },
      opacity: 1,
      radius: [8, 8, 8, 8],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      borders: [{
        color: "rgba(0, 0, 0, 0)",
        width: 2,
        style: "solid",
        imageSource: "https://example.com/frame.png",
        imageAssetId: "asset-border-image",
        paintSlice: "24",
        paintRepeat: "round",
      }, undefined, undefined, undefined],
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles.borderImageSource).toBe('url("data:image/png;base64,ZmFrZQ==")');
      expect(node.styles.borderImageSlice).toBe("24");
      expect(node.styles.borderImageRepeat).toBe("round");
      expect(node.attributes["data-open-canvas-border-image-asset-id"]).toBe("asset-border-image");
    }
  });

  it("keeps runtime CSS border strings in the native H2D styles", () => {
    const fixture = documentFixture();
    const stringBorder = {
      color: "rgba(0, 0, 0, 0)",
      width: "2px",
      style: "solid",
      gradient: "linear-gradient(90deg, #ff0000, #0000ff)",
      paintWidth: "3px",
      paintOutset: "2px",
    } as unknown as NonNullable<DesignDocument["root"]["borders"]>[number];
    fixture.root.children = [{
      id: "string-gradient-border",
      type: "frame",
      rect: { x: 0, y: 0, width: 180, height: 60 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      borders: [stringBorder, stringBorder, stringBorder, stringBorder],
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles.borderTopWidth).toBe("2px");
      expect(node.styles.borderImageWidth).toBe("3px 3px 3px 3px");
      expect(node.styles.borderImageOutset).toBe("2px 2px 2px 2px");
      expect(node.styles.width).toBe("176px");
    }
  });

  it("normalizes runtime padding and margin strings in H2D geometry", () => {
    const fixture = documentFixture();
    const legacyLayout = {
      ...emptyLayout(),
      padding: ["4px", "8px", "4px", "8px"],
    } as unknown as DesignDocument["root"]["layout"];
    fixture.root.children = [{
      id: "string-box-spacing",
      type: "frame",
      rect: { x: 0, y: 0, width: 180, height: 60 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: ["0px", "3px", "0px", "3px"] as unknown as [number, number, number, number],
      layout: legacyLayout,
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles.width).toBe("164px");
      expect(node.styles.paddingTop).toBe("4px");
      expect(node.styles.paddingRight).toBe("8px");
      expect(node.styles.marginLeft).toBe("3px");
      expect(node.styles.marginRight).toBe("3px");
    }
  });

  it("preserves authored border-image slice and repeat values", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "gradient-border-contract",
      type: "frame",
      rect: { x: 0, y: 0, width: 180, height: 60 },
      opacity: 1,
      radius: [8, 8, 8, 8],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      borders: [
        {
          color: "rgba(0, 0, 0, 0)",
          width: 2,
          style: "solid",
          gradient: "linear-gradient(90deg, #ff0000, #0000ff)",
          paintSlice: "30%",
          paintRepeat: "round",
        },
        undefined,
        undefined,
        undefined,
      ],
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles.borderImageSlice).toBe("30%");
      expect(node.styles.borderImageRepeat).toBe("round");
    }
  });

  it("carries accessible semantics through the H2D compatibility channel", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "save",
      sourceTag: "BUTTON",
      type: "frame",
      semantics: {
        role: "button",
        label: "Save changes",
        description: "Writes the current draft",
        states: { disabled: "true" },
      },
      attributes: { "aria-label": "Save changes" },
      rect: { x: 0, y: 0, width: 120, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.attributes).toMatchObject({
      "aria-label": "Save changes",
      "data-open-canvas-role": "button",
      "data-open-canvas-label": "Save changes",
      "data-open-canvas-description": "Writes the current draft",
      "data-open-canvas-states": JSON.stringify({ disabled: "true" }),
    });
  });

  it("keeps the root stable without pinning ordinary H2D descendants", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "horizontal", justifyContent: "space-between" };
    fixture.root.children = [
      {
        id: "left",
        type: "frame",
        rect: { x: 0, y: 0, width: 80, height: 40 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: emptyLayout(),
        children: [],
      },
    ];

    const before = JSON.stringify(fixture.root);
    const h2d = toH2D(fixture);

    expect(JSON.stringify(fixture.root)).toBe(before);
    expect(h2d.root.childNodes[0]).toMatchObject({ nodeType: 1 });
    expect(h2d.root.childNodes[0]).not.toHaveProperty("styles.left");
    expect(h2d.root.childNodes[0]).not.toHaveProperty("styles.top");
    const lockedChild = h2d.root.childNodes[0];
    expect(lockedChild.nodeType).toBe(1);
    if (lockedChild.nodeType === 1) expect(lockedChild).not.toHaveProperty("layout");
  });

  it("keeps the two official markers and a separate shared scene marker", () => {
    const fixture = documentFixture();
    fixture.root.children.push({
      id: "headline",
      sourceTag: "H2",
      type: "text",
      rect: { x: 16, y: 20, width: 180, height: 32 },
      textRect: { x: 1, y: 2, width: 120, height: 28 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow", geometryLock: true },
      text: { content: "你好", fontFamily: "Noto Sans SC", fontSize: 24, fontWeight: 700, lineHeight: 32, letterSpacing: 0, textAlign: "left" },
      children: [],
    });
    const html = buildFigmaHtml(fixture);
    expect(html.startsWith('<span data-metadata="<!--(figmeta)')).toBe(true);
    expect(html).toContain('<span data-h2d="<!--(figh2d)');
    expect(html).not.toContain("data-buffer");
    expect(html).toContain('data-open-canvas-scene="<!--(opencanvas)');
    expect(html).toContain("data-metadata");
    expect(parseFigmaHtml(html).h2d.root.childNodes).toHaveLength(1);
    expect(parseFigmaHtml(html).scene?.root.children[0].text?.content).toBe("你好");
    const legacy = html.replace("data-open-canvas-scene", "data-neuxmind-scene")
      .replace("(opencanvas)", "(neuxscene)")
      .replace("(/opencanvas)", "(/neuxscene)");
    expect(parseFigmaHtml(legacy).scene?.root.children[0].text?.content).toBe("你好");
  });

  it("preserves the measured glyph inset for element-backed text", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "headline",
      sourceTag: "H1",
      type: "text",
      rect: { x: 16, y: 20, width: 300, height: 64 },
      textRect: { x: 0, y: -2, width: 296, height: 68 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      text: { content: "你好世界\nArena House", fontFamily: "Inter", fontSize: 30, fontWeight: 700, lineHeight: 32, letterSpacing: 0, textAlign: "left" },
      children: [],
    }];

    const { element: headline, text } = elementText(toH2D(fixture).root.childNodes[0]);
    expect(headline).toMatchObject({ tag: "H1", rect: { x: 16, y: 20, width: 300, height: 64 } });
    expect(text).toMatchObject({ text: "你好世界\nArena House", rect: { x: 16, y: 18, width: 296, height: 68 } });
  });

  it("does not add an element inset twice for glyph-box inline text", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "inline-run",
      sourceTag: "SPAN",
      type: "text",
      // Inline capture stores the glyph box directly in parent coordinates.
      rect: { x: 48, y: 22, width: 96, height: 18 },
      textRect: { x: 0, y: 0, width: 96, height: 18 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      text: { content: "available", fontFamily: "Inter", fontSize: 12, fontWeight: 700, lineHeight: 18, letterSpacing: 0, textAlign: "left" },
      children: [],
    }];

    const { element: run, text } = elementText(toH2D(fixture).root.childNodes[0]);
    expect(run).toMatchObject({ tag: "SPAN", rect: { x: 48, y: 22, width: 96, height: 18 } });
    expect(text).toMatchObject({ text: "available", rect: { x: 48, y: 22, width: 96, height: 18 } });
  });

  it("keeps generated content in the official pseudo-element channel", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "card",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 16, y: 20, width: 200, height: 80 },
      opacity: 1,
      radius: [12, 12, 12, 12],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [{
        id: "card-before",
        sourceTag: "SPAN",
        pseudo: "before",
        type: "frame",
        rect: { x: 4, y: 4, width: 24, height: 24 },
        opacity: 1,
        radius: [12, 12, 12, 12],
        margin: [0, 0, 0, 0],
        layout: emptyLayout(),
        children: [],
      }],
    }];

    const root = toH2D(fixture).root;
    const card = root.childNodes[0];
    expect(card.nodeType).toBe(1);
    if (card.nodeType === 1) {
      expect(card.childNodes).toHaveLength(0);
      expect(card.pseudoElementNodes?.before).toMatchObject({ id: "card-before", tag: "SPAN" });
    }
  });

  it("carries pseudo-element border-image assets through the native H2D channel", () => {
    const fixture = documentFixture();
    fixture.assets = [{
      id: "asset-pseudo-border",
      kind: "image",
      src: "https://example.com/pseudo-frame.png",
      data: "data:image/png;base64,cHNldWRv",
    }];
    fixture.root.children = [{
      id: "badge",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [{
        id: "badge-before",
        sourceTag: "SPAN",
        pseudo: "before",
        type: "frame",
        rect: { x: 0, y: 0, width: 120, height: 40 },
        opacity: 1,
        radius: [4, 4, 4, 4],
        margin: [0, 0, 0, 0],
        layout: emptyLayout(),
        borders: [{
          color: "rgba(0, 0, 0, 0)",
          width: 2,
          style: "solid",
          imageSource: "https://example.com/pseudo-frame.png",
          imageAssetId: "asset-pseudo-border",
          paintSlice: "24",
          paintRepeat: "round",
        }, undefined, undefined, undefined],
        children: [],
      }],
    }];

    const badge = toH2D(fixture).root.childNodes[0];
    expect(badge.nodeType).toBe(1);
    if (badge.nodeType === 1) {
      expect(badge.pseudoElementNodes?.before).toMatchObject({
        attributes: { "data-open-canvas-border-image-asset-id": "asset-pseudo-border" },
        styles: {
          borderImageSource: 'url("data:image/png;base64,cHNldWRv")',
          borderImageSlice: "24",
          borderImageRepeat: "round",
        },
      });
    }
  });

  it("deduplicates font families without dropping weight usages", () => {
    const fixture = documentFixture();
    fixture.fonts = [
      { family: "Inter", weight: 400 },
      { family: "Inter", weight: 700 },
      { family: "Inter", weight: 700 },
    ];
    const h2d = toH2D(fixture);
    expect(h2d.fonts.inter.usages).toEqual([{ fontWeight: "400" }, { fontWeight: "700" }]);
  });

  it("serializes font usage metadata needed for line metrics", () => {
    const fixture = documentFixture();
    fixture.fonts = [{
      family: "Noto Sans SC",
      weight: 500,
      style: "italic",
      stretch: "100%",
      size: 16,
      sample: "你好世界",
      metrics: { fontBoundingBoxAscent: 15, fontBoundingBoxDescent: 4 },
    }];
    const h2d = toH2D(fixture);
    expect(h2d.fonts["noto sans sc"].usages[0]).toMatchObject({
      fontWeight: "500",
      fontStyle: "italic",
      fontStretch: "100%",
      fontSize: "16px",
      metrics: { fontBoundingBoxAscent: 15, fontBoundingBoxDescent: 4 },
    });
  });

  it("keeps document and capture viewport rectangles distinct", () => {
    const fixture = documentFixture();
    fixture.viewport = { width: 430, height: 1600 };
    fixture.viewportRect = { x: 0, y: 0, width: 430, height: 900 };
    const h2d = toH2D(fixture);
    expect(h2d.documentRect.height).toBe(1600);
    expect(h2d.viewportRect.height).toBe(900);
  });

  it("derives wrapped text line count from explicit captured breaks", () => {
    const document = documentFixture();
    document.root.children = [{
      id: "wrapped",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
      text: {
        content: "first\nsecond",
        lineCount: 1,
        fontFamily: "Inter",
        fontSize: 12,
        fontWeight: 400,
        lineHeight: 12,
        letterSpacing: 0,
        textAlign: "left",
        textTransform: "none",
        fontStyle: "normal",
        textDecoration: "none",
        verticalAlign: "baseline",
        overflowWrap: "normal",
        wordBreak: "normal",
        hyphens: "manual",
        whiteSpace: "pre",
        textIndent: 0,
        direction: "ltr",
      },
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(document));
    const wrapped = parsed.h2d.root.childNodes[0];
    expect(wrapped.nodeType).toBe(1);
    expect((wrapped as { childNodes: Array<{ lineCount?: number }> }).childNodes[0].lineCount).toBe(2);
  });

  it("preserves sub-pixel explicit line-height in the H2D compatibility channel", () => {
    const document = documentFixture();
    document.root.children = [{
      id: "subpixel-leading",
      sourceTag: "#text",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 1 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
      text: {
        content: "first\nsecond",
        lineCount: 1,
        fontFamily: "Inter",
        fontSize: 12,
        fontWeight: 400,
        lineHeight: 0.5,
        letterSpacing: 0,
        textAlign: "left",
        textTransform: "none",
        fontStyle: "normal",
        textDecoration: "none",
        verticalAlign: "baseline",
        overflowWrap: "normal",
        wordBreak: "normal",
        hyphens: "manual",
        whiteSpace: "pre",
        textIndent: 0,
        direction: "ltr",
      },
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(document));
    const wrapper = parsed.h2d.root.childNodes[0];
    expect(wrapper.nodeType).toBe(1);
    if (wrapper.nodeType !== 1) return;
    expect(wrapper.styles.lineHeight).toBe("0.5px");
    expect(wrapper.childNodes[0]).toMatchObject({ lineCount: 2, lineHeight: 0.5 });
  });

  it("never lets a stale line count collapse a direct anonymous text run", () => {
    const document = documentFixture();
    document.root.children = [{
      id: "anonymous-wrapped",
      sourceTag: "#text",
      type: "text",
      rect: { x: 0, y: 0, width: 120, height: 24 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
      text: {
        content: "first\nsecond",
        lineCount: 1,
        fontFamily: "Inter",
        fontSize: 12,
        fontWeight: 400,
        lineHeight: 12,
        letterSpacing: 0,
        textAlign: "left",
        textTransform: "none",
        fontStyle: "normal",
        textDecoration: "none",
        verticalAlign: "baseline",
        overflowWrap: "normal",
        wordBreak: "normal",
        hyphens: "manual",
        whiteSpace: "pre",
        textIndent: 0,
        direction: "ltr",
      },
    }];

    const h2d = toH2D(document);
    const wrapper = h2d.root.childNodes[0];
    expect(wrapper).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: {
        "data-open-canvas-text-run": "true",
        "data-open-canvas-line-height": "12px",
      },
      styles: { lineHeight: "12px", "line-height": "12px" },
    });
    if (wrapper.nodeType !== 1) return;
    expect(wrapper.childNodes[0]).toMatchObject({ nodeType: 3, lineCount: 2, lineHeight: 12 });
  });

  it("keeps capture viewport, DPR, resources, and fonts in figh2d", () => {
    const fixture = documentFixture();
    fixture.viewportRect = { x: 0, y: 0, width: 430, height: 680 };
    fixture.fonts = [{ family: "Noto Sans SC", weight: 500, size: 16 }];
    fixture.assets = [{ id: "asset-1", kind: "image", src: "https://example.test/image.png" }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.metadata).toMatchObject({
      pageId: "page-1",
      title: "测试页面",
      width: 430,
      height: 700,
      viewport: { width: 430, height: 700 },
      viewportRect: { x: 0, y: 0, width: 430, height: 680 },
      devicePixelRatio: 2,
      dataType: "h2d",
      source: "open-canvas",
      capturedAtIso: expect.any(String),
    });
    expect(parsed.h2d.viewportRect).toMatchObject({ width: 430, height: 680 });
    expect(parsed.h2d.devicePixelRatio).toBe(2);
    expect(parsed.h2d.assets["https://example.test/image.png"]).toMatchObject({ url: "https://example.test/image.png" });
    expect(parsed.h2d.fonts).toMatchObject({ "noto sans sc": { familyName: "Noto Sans SC" } });
  });

  it("matches the official marker clipboard shape", () => {
    const html = wrapFigmaClipboardHtml(documentFixture());
    expect(html.startsWith('<span data-metadata="<!--(figmeta)')).toBe(true);
    expect(html).toContain('<span data-h2d="<!--(figh2d)');
    expect(html).not.toContain("data-buffer");
    expect(html).not.toContain("data-neuxmind-scene");
    expect(html).not.toContain("data-open-canvas-scene");
    const marker = html.match(/<!--\(figh2d\)([A-Za-z0-9+/=]+)/)?.[1];
    // The official browser extension serializes copy-all captures as an
    // array, even when there is only one document (`[{...}]` -> `W3si`).
    expect(marker?.startsWith("W3si")).toBe(true);
    expect(html).not.toContain("<!doctype html>");
    expect(parseFigmaHtml(html).h2d.version).toBe(2);
  });

  it("parses the entity-escaped HTML returned by Chromium clipboard reads", () => {
    const html = wrapFigmaClipboardHtml(documentFixture())
      .replaceAll("<!--", "&lt;!--")
      .replaceAll("-->", "--&gt;");
    const parsed = parseFigmaHtml(html);
    expect(parsed.h2d.root.rect.width).toBe(430);
    expect(parsed.metadata).toMatchObject({ dataType: "h2d", source: "open-canvas" });
  });

  it("still reads clips produced by the legacy data-buffer bridge", () => {
    const legacy = wrapFigmaClipboardHtml(documentFixture()).replace("<!--(figh2d)", '<span data-buffer="<!--(figh2d)').replace("(/figh2d)-->", '(/figh2d)-->"></span>');
    const parsed = parseFigmaHtml(legacy);
    expect(parsed.h2d.root.rect.width).toBe(430);
  });

  it("keeps text foreground colors out of the background fill", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "headline",
      type: "text",
      rect: { x: 16, y: 20, width: 180, height: 24 },
      opacity: 1,
      fill: { color: "rgb(24, 40, 50)" },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      text: {
        content: "Choose your way in.",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 700,
        lineHeight: 20,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const { element: styles, text } = elementText(parsed.h2d.root.childNodes[0]);
    expect(text.text).toBe("Choose your way in.");
    expect(styles.styles.color).toBe("rgb(24, 40, 50)");
    expect(styles.styles.backgroundColor).toBeUndefined();
  });

  it("does not paint a captured SVG background fallback twice", () => {
    const fixture = documentFixture();
    fixture.assets = [{
      id: "background-svg",
      kind: "svg",
      src: "data:image/svg+xml;base64,ZmFrZQ==",
      data: "data:image/svg+xml;base64,ZmFrZQ==",
    }];
    fixture.root.backgroundAssetId = "background-svg";
    fixture.root.fill = { color: "rgb(232, 241, 240)" };
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.h2d.root.styles.backgroundImage).toContain("data:image/svg+xml");
    expect(parsed.h2d.root.attributes["data-open-canvas-background-asset-id"]).toBe("background-svg");
    expect(parsed.h2d.root.styles.backgroundColor).toBeUndefined();
  });

  it("preserves inline display and intrinsic flex sizing from captured CSS", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "inline-run",
      type: "text",
      rect: { x: 16, y: 20, width: 84, height: 20 },
      opacity: 1,
      fill: { color: "rgb(24, 40, 50)" },
      computedStyles: { display: "inline", flexShrink: "1", minWidth: "auto" },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Hello ",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 20,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const { element: run, text } = elementText(parsed.h2d.root.childNodes[0]);
    expect(text.text).toBe("Hello ");
    expect(run.styles.display).toBe("inline");
  });

  it("preserves explicit Auto Layout compatibility hints", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "content",
      sourceTag: "MAIN",
      type: "frame",
      rect: { x: 0, y: 72, width: 430, height: 512.5 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex", boxSizing: "border-box" },
      attributes: { "data-figma-auto-layout": "vertical" },
      layout: {
        ...emptyLayout(),
        mode: "vertical",
        widthMode: "fill",
        heightMode: "hug",
      },
      children: [],
    }];

    const content = toH2D(fixture).root.childNodes[0];
    expect(content.nodeType).toBe(1);
    if (content.nodeType !== 1) return;
    expect(content.styles.height).toBe("512.5px");
    expect(content.styles.minHeight).toBeUndefined();
    expect(content.attributes["data-figma-auto-layout"]).toBe("vertical");
    expect(content.attributes["data-open-canvas-layout-mode"]).toBe("vertical");
    expect(content.attributes["data-open-canvas-width-mode"]).toBe("fill");
    expect(content.attributes["data-open-canvas-height-mode"]).toBe("hug");
    expect(JSON.parse(content.attributes["data-open-canvas-layout"])).toMatchObject({ mode: "vertical", widthMode: "fill", heightMode: "hug" });
    expect(content.rect.height).toBe(512.5);
    expect(content.layout).toMatchObject({ mode: "vertical", widthMode: "fill", heightMode: "hug" });
  });

  it("preserves auto-margin layout metadata and CSS replay edges", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "horizontal", justifyContent: "start" };
    fixture.root.computedStyles = { display: "flex", flexDirection: "row" };
    fixture.root.children = [{
      id: "auto-margin-card",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 180, y: 16, width: 220, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex" },
      layout: {
        ...emptyLayout(),
        mode: "horizontal",
        autoMargins: [false, false, false, true],
        geometryLock: true,
      },
      children: [],
    }];

    const html = buildFigmaHtml(fixture);
    const parsed = parseFigmaHtml(html).h2d.root.childNodes[0];
    expect(parsed.nodeType).toBe(1);
    if (parsed.nodeType !== 1) return;
    expect(parsed.attributes["data-open-canvas-auto-margins"]).toBe("[false,false,false,true]");
    expect(parsed.attributes["data-open-canvas-geometry-lock"]).toBe("true");
    // The native H2D channel pins measured auto-margin children with zero
    // margins to avoid applying the captured offset twice. The authored
    // constraint remains available through the marker/layout metadata and is
    // restored by the Open Canvas plugin scene path.
    expect(parsed.styles.marginLeft).toBeUndefined();
    expect(parsed.styles.position).toBe("absolute");
    expect(parsed.layout).toMatchObject({ mode: "horizontal", autoMargins: [false, false, false, true] });

    const pluginScene = parseFigmaHtml(html).scene;
    expect(pluginScene).toBeDefined();
    expect(pluginScene?.root.children[0].layout.autoMargins).toEqual([false, false, false, true]);
  });

  it("emits auto margin CSS when a compatibility scene is not geometry locked", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "auto-margin-unlocked",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 16, y: 16, width: 120, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), autoMargins: [true, false, false, true] },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles).toMatchObject({ marginTop: "auto", marginLeft: "auto" });
    expect(node.layout).toMatchObject({ autoMargins: [true, false, false, true] });
  });

  it("keeps baseline alignment in the H2D replay styles", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "horizontal", alignItems: "baseline" };
    fixture.root.computedStyles = { display: "flex" };

    expect(toH2D(fixture).root.styles.alignItems).toBe("baseline");
  });

  it("keeps per-child baseline alignment in H2D replay styles", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "baseline-child",
      type: "frame",
      rect: { x: 0, y: 0, width: 80, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), alignSelf: "baseline" },
      children: [],
    }];

    const child = toH2D(fixture).root.childNodes[0];
    expect(child.nodeType).toBe(1);
    if (child.nodeType === 1) expect(child.styles.alignSelf).toBe("baseline");
  });

  it("keeps flex wrap-reverse in the H2D replay styles", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "horizontal", wrap: true, wrapReverse: true, widthMode: "fill" };
    fixture.root.computedStyles = { display: "flex" };

    expect(toH2D(fixture).root.styles.flexWrap).toBe("wrap-reverse");
    expect(toH2D(fixture).root.layout).toMatchObject({ wrap: true, wrapReverse: true });
  });

  it("carries all authored min/max sizing constraints through H2D", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "responsive",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: {
        display: "block",
        minWidth: "50%",
        maxWidth: "430px",
        minHeight: "25%",
        maxHeight: "720px",
      },
      layout: emptyLayout(),
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles).toMatchObject({
        minWidth: "50%",
        maxWidth: "430px",
        minHeight: "25%",
        maxHeight: "720px",
      });
    }
  });

  it("carries authored aspect-ratio through the H2D-only replay channel", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "responsive-media",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: {
        display: "block",
        aspectRatio: "16 / 9",
      },
      layout: emptyLayout(),
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) expect(node.styles.aspectRatio).toBe("16 / 9");
  });

  it("duplicates computed aspect-ratio into a compatibility marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "computed-only-aspect-ratio",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block", aspectRatio: "16 / 9" },
      layout: emptyLayout(),
      children: [],
    }];
    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-aspect-ratio"])).toMatchObject({
      value: "16 / 9",
      measuredGeometry: true,
    });
  });

  it("does not serialize CSS reset keywords as authored aspect-ratio", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "reset-aspect-ratio",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block", aspectRatio: "initial" },
      layout: emptyLayout(),
      children: [],
    }];
    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.attributes["data-open-canvas-aspect-ratio"]).toBeUndefined();
  });

  it("duplicates non-default text wrapping controls into a compatibility marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "wrapped-copy",
      sourceTag: "SPAN",
      type: "text",
      rect: { x: 0, y: 0, width: 180, height: 48 },
      textRect: { x: 0, y: 0, width: 180, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: {
        display: "block",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-all",
      },
      text: {
        content: "A long wrapped label",
        lineCount: 2,
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
        whiteSpace: "pre-wrap",
        overflowWrap: "anywhere",
        wordBreak: "break-all",
      },
      layout: emptyLayout(),
      children: [],
    }];
    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-text-wrapping"])).toMatchObject({
      values: { whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-all" },
      measuredGeometry: true,
    });
  });

  it("carries partial responsive sizing expressions beside the captured box", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "half-width",
      type: "frame",
      rect: { x: 0, y: 0, width: 215, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex", width: "215px" },
      layout: { ...emptyLayout(), mode: "horizontal", widthMode: "fixed", widthExpression: "50%" },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles.width).toBe("50%");
      expect(node.attributes["data-open-canvas-width-expression"]).toBe("50%");
      expect(JSON.parse(node.attributes["data-open-canvas-layout"])).toMatchObject({ widthExpression: "50%" });
    }
  });

  it("carries authored gap expressions beside resolved Auto Layout spacing", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "responsive-gap",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "flex", gap: "24px" },
      layout: {
        ...emptyLayout(),
        mode: "vertical",
        gap: 24,
        rowGap: 24,
        columnGap: 16,
        gapExpression: "calc(10% + 4px)",
        rowGapExpression: "calc(10% + 4px)",
        columnGapExpression: "5%",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.gap).toBe("calc(10% + 4px)");
    expect(node.styles.rowGap).toBe("calc(10% + 4px)");
    expect(node.styles.columnGap).toBe("5%");
    expect(JSON.parse(node.attributes["data-open-canvas-layout"])).toMatchObject({
      gapExpression: "calc(10% + 4px)",
      rowGapExpression: "calc(10% + 4px)",
      columnGapExpression: "5%",
    });
  });

  it("keeps measured dimensions for absolute layers with responsive metadata", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "absolute-half-width",
      type: "frame",
      rect: { x: 24, y: 16, width: 215, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      positioning: "absolute",
      computedStyles: { display: "block", position: "absolute", width: "215px", height: "80px" },
      layout: { ...emptyLayout(), widthExpression: "50%", position: "absolute" },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) expect(node.styles.width).toBe("215px");
  });

  it("prefers preserved responsive constraints over default computed values", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-responsive",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: {
        display: "block",
        minWidth: "auto",
        maxWidth: "none",
        minHeight: "auto",
        maxHeight: "none",
      },
      sizingConstraints: { minWidth: "50%", maxHeight: "25%" },
      layout: emptyLayout(),
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles).toMatchObject({ minWidth: "50%", maxHeight: "25%" });
  });

  it("duplicates computed responsive bounds into a compatibility marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "computed-only-responsive",
      type: "frame",
      rect: { x: 0, y: 0, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: {
        display: "block",
        minWidth: "50%",
        maxHeight: "25%",
      },
      layout: emptyLayout(),
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-sizing-constraints"])).toMatchObject({
      values: { minWidth: "50%", maxHeight: "25%" },
      measuredGeometry: true,
    });
  });

  it("preserves inline-flex baseline behavior for captured labels", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "label",
      type: "frame",
      rect: { x: 8, y: 12, width: 120, height: 16 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal" },
      computedStyles: { display: "inline-flex" },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const label = parsed.h2d.root.childNodes[0];
    expect(label.nodeType).toBe(1);
    if (label.nodeType === 1) expect(label.styles.display).toBe("inline-flex");
  });

  it("retains source tags and the separate computed style map", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "headline",
      sourceTag: "H1",
      type: "text",
      rect: { x: 16, y: 20, width: 180, height: 24 },
      opacity: 1,
      computedStyles: { color: "rgb(24, 40, 50)", display: "block" },
      fill: { color: "rgb(24, 40, 50)" },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Headline",
        fontFamily: "Inter",
        fontSize: 18,
        fontWeight: 700,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const { element: headline, text } = elementText(parsed.h2d.root.childNodes[0]);
    expect(headline).toMatchObject({ tag: "H1", computedStyles: { color: "rgb(24, 40, 50)", display: "block" } });
    expect(text.text).toBe("Headline");
  });

  it("keeps content-box dimensions separate from padding and borders", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "content-box",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      stroke: { color: "rgb(0, 0, 0)", width: 2 },
      borders: [
        { color: "rgb(0, 0, 0)", width: 2 },
        { color: "rgb(0, 0, 0)", width: 2 },
        { color: "rgb(0, 0, 0)", width: 2 },
        { color: "rgb(0, 0, 0)", width: 2 },
      ],
      computedStyles: { display: "block", boxSizing: "content-box", width: "96px", height: "56px" },
      layout: { ...emptyLayout(), padding: [10, 10, 10, 10] },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const child = parsed.h2d.root.childNodes[0];
    expect(child.nodeType).toBe(1);
    if (child.nodeType === 1) {
      expect(child.styles.width).toBe("96px");
      expect(child.styles.height).toBe("56px");
      expect(child.styles.boxSizing).toBe("content-box");
    }
  });

  it("uses padding-box dimensions when a trimmed payload omits computed width", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-padding-box",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      borders: [
        { color: "#000", width: 2 },
        { color: "#000", width: 3 },
        { color: "#000", width: 4 },
        { color: "#000", width: 5 },
      ],
      computedStyles: { display: "block", boxSizing: "padding-box" },
      layout: { ...emptyLayout(), padding: [10, 10, 10, 10] },
      children: [],
    }];

    const child = parseFigmaHtml(buildFigmaHtml(fixture)).h2d.root.childNodes[0];
    expect(child.nodeType).toBe(1);
    if (child.nodeType !== 1) return;
    // Width includes the 20px padding but excludes the 8px horizontal
    // border; the payload rect remains the full 120px border box.
    expect(child.styles.width).toBe("112px");
    expect(child.styles.height).toBe("74px");
  });

  it("keeps ordinary block nodes at browser flex defaults", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "block-copy",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 16, y: 20, width: 180, height: 48 },
      opacity: 1,
      computedStyles: {
        display: "block",
        flexDirection: "row",
        alignItems: "normal",
        justifyContent: "normal",
        flexWrap: "nowrap",
        gap: "normal",
      },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const block = parsed.h2d.root.childNodes[0];
    expect(block.nodeType).toBe(1);
    if (block.nodeType === 1) {
      expect(block.styles.flexDirection).toBeUndefined();
      expect(block.styles.alignItems).toBeUndefined();
      expect(block.styles.justifyContent).toBeUndefined();
      expect(block.styles.flexWrap).toBeUndefined();
      expect(block.styles.gap).toBeUndefined();
    }
  });

  it("resets user-agent margins on semantic HTML nodes", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "heading",
      sourceTag: "H2",
      type: "text",
      rect: { x: 0, y: 0, width: 200, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Heading",
        fontFamily: "Inter",
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 34,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const { element: heading, text } = elementText(parsed.h2d.root.childNodes[0]);
    expect(heading).toMatchObject({ tag: "H2", rect: { x: 0, y: 0, width: 200, height: 40 } });
    expect(text).toMatchObject({ text: "Heading", rect: { x: 0, y: 0, width: 200, height: 40 } });
  });

  it("resets native button chrome without dropping captured padding", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "link-button",
      sourceTag: "BUTTON",
      type: "frame",
      rect: { x: 24, y: 40, width: 72, height: 18 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), padding: [1, 6, 1, 6] },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const button = parsed.h2d.root.childNodes[0];
    expect(button.nodeType).toBe(1);
    if (button.nodeType === 1) {
      expect(button.styles).toMatchObject({
        appearance: "none",
        borderTopStyle: "none",
        borderTopWidth: "0px",
        backgroundColor: "transparent",
        paddingTop: "1px",
        paddingLeft: "6px",
      });
    }
  });

  it("keeps a real captured button border instead of applying the UA reset", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "outlined-button",
      sourceTag: "BUTTON",
      type: "frame",
      rect: { x: 24, y: 40, width: 80, height: 24 },
      opacity: 1,
      radius: [12, 12, 12, 12],
      margin: [0, 0, 0, 0],
      borders: [
        { color: "rgb(227, 237, 242)", width: 1 },
        { color: "rgb(227, 237, 242)", width: 1 },
        { color: "rgb(227, 237, 242)", width: 1 },
        { color: "rgb(227, 237, 242)", width: 1 },
      ],
      layout: emptyLayout(),
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const button = parsed.h2d.root.childNodes[0];
    expect(button.nodeType).toBe(1);
    if (button.nodeType === 1) {
      expect(button.styles.borderTopStyle).toBe("solid");
      expect(button.styles.borderTopWidth).toBe("1px");
    }
  });

  it("serializes measured grid tracks as a wrapped flex surface", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "grid",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 0, y: 0, width: 300, height: 120 },
      opacity: 1,
      computedStyles: {
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gridTemplateAreas: '"left right"',
        gridAutoRows: "minmax(40px, auto)",
        flexDirection: "row",
        flexWrap: "wrap",
      },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: {
        ...emptyLayout(),
        mode: "horizontal",
        wrap: true,
        gap: 12,
        gridTemplateColumns: "repeat(2, 1fr)",
        gridTemplateAreas: '"left right"',
        gridAutoRows: "minmax(40px, auto)",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const grid = parsed.h2d.root.childNodes[0];
    expect(grid.nodeType).toBe(1);
    if (grid.nodeType === 1) {
      expect(grid.styles.display).toBe("grid");
      expect(grid.styles.flexWrap).toBe("wrap");
      expect(grid.styles.gridTemplateColumns).toBe("repeat(2, 1fr)");
      expect(grid.styles.gridTemplateAreas).toBe('"left right"');
      expect(grid.styles.gridAutoRows).toBe("minmax(40px, auto)");
    }
  });

  it("serializes direct mixed-content text runs as H2D-compatible text nodes", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "button",
      sourceTag: "BUTTON",
      type: "frame",
      rect: { x: 20, y: 30, width: 140, height: 36 },
      opacity: 1,
      radius: [18, 18, 18, 18],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", gap: 4 },
      children: [{
        id: "button-text",
        sourceTag: "#text",
        type: "text",
        rect: { x: 12, y: 8, width: 72, height: 20 },
        opacity: 1,
        fill: { color: "rgb(255, 255, 255)" },
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "View event ",
          fontFamily: "Inter",
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 20,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const button = parsed.h2d.root.childNodes[0];
    expect(button.nodeType).toBe(1);
    if (button.nodeType === 1) {
      expect(button.childNodes[0]).toMatchObject({ nodeType: 3, text: "View event " });
    }
  });

  it("keeps editable text elements in the official child-node shape", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "heading",
      sourceTag: "H1",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 34 },
      opacity: 1,
      fill: { color: "#182832" },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "可编辑标题",
        fontFamily: "Noto Sans SC",
        fontSize: 28,
        fontWeight: 700,
        lineHeight: 34,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const { element: heading, text } = elementText(parsed.h2d.root.childNodes[0]);
    expect(heading.styles).toMatchObject({ fontSize: "28px", fontWeight: "700", lineHeight: "34px" });
    expect(text.styles).toMatchObject({
      lineHeight: "34px",
      textDecoration: "none",
      textOverflow: "clip",
      verticalAlign: "baseline",
      overflowWrap: "normal",
      wordBreak: "normal",
      hyphens: "manual",
    });
    expect(text.text).toBe("可编辑标题");
  });

  it("promotes inherited line-height to wrappers around direct text runs", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "copy-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      children: [{
        id: "copy-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 48 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 24,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("24px");
    expect(node.attributes["data-open-canvas-line-height"]).toBe("24px");
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: {
        "data-open-canvas-text-run": "true",
        "data-open-canvas-line-height": "24px",
      },
      styles: { lineHeight: "24px" },
      childNodes: [{
        nodeType: 3,
        lineHeight: 24,
        attributes: { "data-open-canvas-line-height": "24px" },
        styles: { lineHeight: "24px" },
      }],
    });
  });

  it("keeps the captured used line-height when a wrapper has a stale computed pixel value", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "stale-computed-line-height",
      sourceTag: "P",
      type: "text",
      rect: { x: 0, y: 0, width: 220, height: 56 },
      textRect: { x: 0, y: 0, width: 220, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      // A legacy bridge may leave the child's generic 1.2em computed value
      // here even though capture resolved the inherited parent line box.
      computedStyles: { display: "block", fontSize: "16px", lineHeight: "19.2px" },
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
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("28px");
    expect(node.computedStyles).toMatchObject({ lineHeight: "28px", "line-height": "28px" });
    expect(node.childNodes[0]).toMatchObject({ nodeType: 3, lineHeight: 28 });
  });

  it("keeps inherited line-height in the actual system-clipboard payload", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "clipboard-leading-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 64 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block", lineHeight: "28px", fontSize: "18px" },
      layout: { ...emptyLayout() },
      children: [{
        id: "clipboard-leading-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          // This is the resolved value after CSS inheritance. The source
          // wrapper has a different font size, so recomputing 1.5em from the
          // child would be incorrect and would collapse the imported leading.
          lineHeight: 28,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(wrapFigmaClipboardHtml(fixture));
    const wrapper = parsed.h2d.root.childNodes[0];
    expect(wrapper.nodeType).toBe(1);
    if (wrapper.nodeType !== 1) return;
    expect(wrapper.styles).toMatchObject({ lineHeight: "28px", "line-height": "28px" });
    expect(wrapper.attributes["data-open-canvas-line-height"]).toBe("28px");
    expect(wrapper.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      styles: { lineHeight: "28px", "line-height": "28px" },
      attributes: { "data-open-canvas-line-height": "28px" },
    });
    const text = wrapper.childNodes[0];
    if (text.nodeType === 1) {
      expect(text.childNodes[0]).toMatchObject({ lineHeight: 28, lineCount: 2 });
    }
  });

  it("keeps structural semantics from flattened display-contents descendants", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "contents-label",
      sourceTag: "#text",
      type: "text",
      displayContents: true,
      structuralSemantics: [{ role: "navigation", label: "Primary navigation", states: { expanded: "true" } }],
      rect: { x: 20, y: 24, width: 180, height: 24 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Dashboard",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(3);
    if (node.nodeType === 3) {
      expect(JSON.parse(node.attributes?.["data-open-canvas-structural-semantics"] || "[]")).toEqual([
        { role: "navigation", label: "Primary navigation", states: { expanded: "true" } },
      ]);
    }
  });

  it("carries structural semantic owners for flattened descendants", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "contents-owner-child",
      sourceTag: "SPAN",
      type: "frame",
      structuralSemantics: [{ role: "navigation", label: "Primary navigation" }],
      structuralSemanticOwners: ["contents-owner"],
      rect: { x: 20, y: 24, width: 180, height: 24 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      children: [],
    }];

    const node = parseFigmaHtml(buildFigmaHtml(fixture)).h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(JSON.parse(node.attributes["data-open-canvas-structural-semantic-owners"] || "[]"))
        .toEqual(["contents-owner"]);
    }
  });

  it("keeps a computed line-height when a trimmed text record has no numeric value", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-computed-leading",
      sourceTag: "P",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", lineHeight: "28px", fontSize: "16px" },
      text: {
        content: "First line\nSecond line",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: undefined as unknown as number,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("28px");
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 3,
      styles: { lineHeight: "28px" },
    });
  });

  it("uses the resolved inherited line-height when calculating trimmed line counts", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-line-count-leading",
      sourceTag: "P",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", lineHeight: "28px", fontSize: "16px" },
      text: {
        content: "First line\nSecond line",
        lineCount: 1,
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: undefined as unknown as number,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.attributes["data-open-canvas-line-count"]).toBe("2");
    expect(node.childNodes[0]).toMatchObject({ lineCount: 2, lineHeight: 28 });
  });

  it("accepts kebab-case line-height from a trimmed compatibility payload", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "kebab-computed-leading",
      sourceTag: "P",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", ["line-height"]: "30px", fontSize: "16px" },
      text: {
        content: "First line\nSecond line",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: undefined as unknown as number,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles).toMatchObject({ lineHeight: "30px", "line-height": "30px" });
    expect(node.childNodes[0]).toMatchObject({ styles: { lineHeight: "30px", "line-height": "30px" } });
  });

  it("resolves relative computed line-height tokens in trimmed text records", () => {
    const fixture = documentFixture();
    fixture.root.children = [
      {
        id: "trimmed-unitless-leading",
        sourceTag: "P",
        type: "text",
        rect: { x: 20, y: 24, width: 240, height: 48 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { display: "block", lineHeight: "1.5", fontSize: "16px" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      },
      {
        id: "trimmed-percent-leading",
        sourceTag: "P",
        type: "text",
        rect: { x: 20, y: 84, width: 240, height: 60 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { display: "block", lineHeight: "150%", fontSize: "20px" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 20,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      },
      {
        id: "trimmed-calc-leading",
        sourceTag: "P",
        type: "text",
        rect: { x: 20, y: 156, width: 240, height: 40 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { display: "block", lineHeight: "calc(1em + 4px)", fontSize: "16px" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      },
    ];

    const parsed = parseFigmaHtml(wrapFigmaClipboardHtml(fixture));
    const first = parsed.h2d.root.childNodes[0];
    const second = parsed.h2d.root.childNodes[1];
    const third = parsed.h2d.root.childNodes[2];
    expect(first.nodeType).toBe(1);
    expect(second.nodeType).toBe(1);
    expect(third.nodeType).toBe(1);
    if (first.nodeType !== 1 || second.nodeType !== 1 || third.nodeType !== 1) return;
    expect(first.styles.lineHeight).toBe("24px");
    expect(first.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      styles: { lineHeight: "24px" },
      childNodes: [{ nodeType: 3, styles: { lineHeight: "24px" } }],
    });
    expect(second.styles.lineHeight).toBe("30px");
    expect(second.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      styles: { lineHeight: "30px" },
      childNodes: [{ nodeType: 3, styles: { lineHeight: "30px" } }],
    });
    expect(third.styles.lineHeight).toBe("20px");
    expect(third.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      styles: { lineHeight: "20px" },
      childNodes: [{ nodeType: 3, styles: { lineHeight: "20px" } }],
    });
  });

  it("preserves multiplicative and divisive calc leading in native H2D", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "calc-arithmetic-leading",
      sourceTag: "P",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 52 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", lineHeight: "calc(1.5 * 1em + 2px)", fontSize: "16px" },
      text: {
        content: "First line\nSecond line",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: undefined as unknown as number,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(wrapFigmaClipboardHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("26px");
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      styles: { lineHeight: "26px" },
      childNodes: [{ nodeType: 3, styles: { lineHeight: "26px" } }],
    });
  });

  it("resolves inherited percentage leading against the declaring wrapper", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "percentage-inherited-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 60 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", fontSize: "20px", lineHeight: "150%" },
      children: [{
        id: "percentage-inherited-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 60 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { fontSize: "16px", lineHeight: "150%" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      styles: { lineHeight: "30px" },
      childNodes: [{ nodeType: 3, styles: { lineHeight: "30px" } }],
    });
  });

  it("carries inherited line-height keywords through the native H2D wrapper", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "keyword-inherited-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", fontSize: "18px", lineHeight: "28px" },
      children: [{
        id: "keyword-inherited-run",
        sourceTag: "P",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { display: "block", fontSize: "18px", lineHeight: "inherit" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 18,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({ styles: { lineHeight: "28px" } });
  });

  it("inherits the parent line-height when an anonymous run loses its style", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "empty-inherited-line-height-root",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", fontSize: "18px", lineHeight: "28px" },
      children: [{
        id: "empty-inherited-line-height-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      styles: { lineHeight: "28px" },
      childNodes: [{ styles: { lineHeight: "28px" } }],
    });
  });

  it("inherits the parent line-height when an anonymous run retains normal", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "normal-inherited-line-height-root",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", fontSize: "18px", lineHeight: "28px" },
      children: [{
        id: "normal-inherited-line-height-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { lineHeight: "normal", fontSize: "16px" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({ styles: { lineHeight: "28px" } });
  });

  it("replaces a stale generic anonymous line-height with the inherited parent box", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "generic-inherited-line-height-root",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", fontSize: "18px", lineHeight: "28px" },
      children: [{
        id: "generic-inherited-line-height-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: {},
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          // Simulate a legacy bridge's stale 1.2em child value.
          lineHeight: 19.2,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      styles: { lineHeight: "28px", "line-height": "28px" },
      childNodes: [{ nodeType: 3, lineHeight: 28 }],
    });
  });

  it("replaces a stale generic computed pixel line-height with the inherited parent box", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "computed-generic-inherited-line-height-root",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", fontSize: "18px", lineHeight: "28px" },
      children: [{
        id: "computed-generic-inherited-line-height-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        // Some compatibility bridges materialize the child's generic 1.2em
        // fallback in both channels, leaving `19.2px` in computedStyles.
        computedStyles: { lineHeight: "19.2px", fontSize: "16px" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 19.2,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      styles: { lineHeight: "28px", "line-height": "28px" },
      childNodes: [{ nodeType: 3, lineHeight: 28 }],
    });
  });

  it("resolves an anonymous lh token from the inherited parent line box", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "lh-inherited-line-height-root",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", fontSize: "18px", lineHeight: "28px" },
      children: [{
        id: "lh-inherited-line-height-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { lineHeight: "1lh", fontSize: "16px" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({ styles: { lineHeight: "28px" } });
  });

  it("resolves an anonymous rlh token from the inherited parent line box", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "rlh-inherited-line-height-root",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", fontSize: "18px", lineHeight: "28px" },
      children: [{
        id: "rlh-inherited-line-height-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { lineHeight: "1rlh", fontSize: "16px" },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({ styles: { lineHeight: "28px" } });
  });

  it("promotes a uniform descendant line-height through trimmed intermediate wrappers", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-line-height-root",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      // Model a compatibility payload whose intermediate wrappers omitted
      // computed styles even though the captured text still has its resolved
      // pixel line box.
      children: [{
        id: "trimmed-line-height-inner",
        sourceTag: "P",
        type: "frame",
        rect: { x: 0, y: 0, width: 220, height: 48 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        children: [{
          id: "trimmed-line-height-run",
          sourceTag: "#text",
          type: "text",
          rect: { x: 0, y: 0, width: 220, height: 48 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { ...emptyLayout() },
          text: {
            content: "First line\nSecond line",
            fontFamily: "Inter",
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 24,
            letterSpacing: 0,
            textAlign: "left",
          },
          children: [],
        }],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("24px");
    expect(node.childNodes[0].nodeType).toBe(1);
    if (node.childNodes[0].nodeType !== 1) return;
    expect(node.childNodes[0].styles.lineHeight).toBe("24px");
    expect(node.childNodes[0].childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: { "data-open-canvas-text-run": "true" },
      styles: { lineHeight: "24px" },
      childNodes: [{ nodeType: 3, styles: { lineHeight: "24px" } }],
    });
    expect(node.childNodes[0].attributes["data-open-canvas-line-height"]).toBe("24px");
  });

  it("promotes descendant line-height through wrappers that retain normal CSS leading", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "normal-line-height-root",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", lineHeight: "normal" },
      children: [{
        id: "normal-line-height-inner",
        sourceTag: "SPAN",
        type: "frame",
        rect: { x: 0, y: 0, width: 220, height: 48 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        computedStyles: { display: "inline", lineHeight: "normal" },
        children: [{
          id: "normal-line-height-run",
          sourceTag: "#text",
          type: "text",
          rect: { x: 0, y: 0, width: 220, height: 48 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { ...emptyLayout() },
          text: {
            content: "First line\nSecond line",
            fontFamily: "Inter",
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 24,
            letterSpacing: 0,
            textAlign: "left",
          },
          children: [],
        }],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("24px");
    expect(node.childNodes[0].nodeType).toBe(1);
    if (node.childNodes[0].nodeType !== 1) return;
    expect(node.childNodes[0].styles.lineHeight).toBe("24px");
  });

  it("keeps non-default word spacing on text wrappers", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "spaced-copy",
      sourceTag: "P",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 28 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Wide words",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        wordSpacing: 3,
        textAlign: "left",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.wordSpacing).toBe("3px");
  });

  it("keeps editable webkit text stroke and fill styles in H2D", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "outlined-copy",
      sourceTag: "P",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 28 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        WebkitTextStrokeWidth: "2px",
        WebkitTextStrokeColor: "rgb(255, 80, 40)",
        WebkitTextFillColor: "transparent",
      },
      fill: { color: "transparent" },
      text: {
        content: "Outlined",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 700,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
        textStrokeWidth: 2,
        textStrokeColor: "rgb(255, 80, 40)",
        textFillColor: "transparent",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles).toMatchObject({
      WebkitTextStrokeWidth: "2px",
      WebkitTextStrokeColor: "rgb(255, 80, 40)",
      WebkitTextFillColor: "transparent",
    });
  });

  it("keeps paint styles on anonymous text nodes in the H2D replay map", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "anonymous-painted-copy",
      sourceTag: "#text",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 28 },
      opacity: 1,
      fill: { color: "transparent" },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Outlined shadow",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 700,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
        textShadow: "1px 2px 3px rgba(0,0,0,.35)",
        textStrokeWidth: 2,
        textStrokeColor: "rgb(255, 80, 40)",
        textFillColor: "transparent",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(3);
    if (node.nodeType !== 3) return;
    expect(node.styles).toMatchObject({
      textShadow: "1px 2px 3px rgba(0,0,0,.35)",
      WebkitTextStrokeWidth: "2px",
      WebkitTextStrokeColor: "rgb(255, 80, 40)",
      WebkitTextFillColor: "transparent",
    });
  });

  it("keeps anonymous text shaping and writing metadata in H2D", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "anonymous-shaping-copy",
      sourceTag: "#text",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 28 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        fontOpticalSizing: "none",
        fontSizeAdjust: "0.5",
        fontVariantCaps: "small-caps",
        fontVariantNumeric: "tabular-nums",
        fontVariantLigatures: "none",
        fontSynthesis: "none",
        fontSynthesisWeight: "none",
        fontSynthesisStyle: "none",
        textAlignLast: "center",
        textJustify: "inter-character",
        textRendering: "geometricPrecision",
        writingMode: "vertical-rl",
        textOrientation: "upright",
        unicodeBidi: "isolate",
        textWrapStyle: "pretty",
        textWrapMode: "nowrap",
        whiteSpaceCollapse: "preserve-breaks",
        textBoxTrim: "trim-both",
        textBoxEdge: "cap alphabetic",
      },
      text: {
        content: "縦書き",
        fontFamily: "Noto Sans SC",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(3);
    if (node.nodeType !== 3) return;
    expect(node.styles).toMatchObject({
      fontOpticalSizing: "none",
      fontSizeAdjust: "0.5",
      fontVariantCaps: "small-caps",
      fontVariantNumeric: "tabular-nums",
      fontVariantLigatures: "none",
      fontSynthesis: "none",
      fontSynthesisWeight: "none",
      fontSynthesisStyle: "none",
      textAlignLast: "center",
      textJustify: "inter-character",
      textRendering: "geometricPrecision",
      writingMode: "vertical-rl",
      textOrientation: "upright",
      unicodeBidi: "isolate",
      textWrapStyle: "pretty",
      textWrapMode: "nowrap",
      whiteSpaceCollapse: "preserve-breaks",
      textBoxTrim: "trim-both",
      textBoxEdge: "cap alphabetic",
    });
  });

  it("keeps inherited line-height in the official clipboard-only marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "clipboard-copy-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      children: [{
        id: "clipboard-copy-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 48 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 24,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(wrapFigmaClipboardHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("24px");
    const textWrapper = node.childNodes[0];
    expect(textWrapper).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: { "data-open-canvas-line-height": "24px", "data-open-canvas-text-run": "true" },
      styles: { lineHeight: "24px" },
    });
    if (textWrapper.nodeType !== 1) return;
    const textNode = textWrapper.childNodes[0];
    expect(textNode).toMatchObject({ nodeType: 3, lineHeight: 24 });
    if (textNode.nodeType !== 3) return;
    expect(textNode.computedStyles).toMatchObject({ lineHeight: "24px" });
    expect(JSON.parse(textNode.attributes?.["data-open-canvas-text-rect"] ?? "{}"))
      .toEqual({ x: 0, y: 0, width: 220, height: 48 });
    expect(textNode.attributes?.["data-open-canvas-line-count"]).toBe("2");
    expect(parsed.scene).toBeUndefined();
  });

  it("recovers a parent frame line-height when a trimmed text run loses its numeric value", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-parent-leading-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block", fontSize: "20px", lineHeight: "28px" },
      layout: { ...emptyLayout() },
      children: [{
        id: "trimmed-parent-leading-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 56 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: undefined as unknown as number,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(wrapFigmaClipboardHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    const textWrapper = node.childNodes[0];
    expect(textWrapper).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: { "data-open-canvas-line-height": "28px" },
      styles: { lineHeight: "28px" },
    });
    if (textWrapper.nodeType !== 1) return;
    expect(textWrapper.childNodes[0]).toMatchObject({ nodeType: 3, lineHeight: 28 });
  });

  it("wraps a single-line anonymous run with its inherited line-height", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "single-line-inherited-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 32 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block", lineHeight: "28px" },
      layout: { ...emptyLayout() },
      children: [{
        id: "single-line-inherited-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 120, height: 28 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "Inherited leading",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 28,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(wrapFigmaClipboardHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: {
        "data-open-canvas-text-run": "true",
        "data-open-canvas-line-height": "28px",
      },
      styles: { lineHeight: "28px" },
    });
    if (node.childNodes[0].nodeType !== 1) return;
    expect(node.childNodes[0].childNodes[0]).toMatchObject({ nodeType: 3, lineHeight: 28 });
  });

  it("keeps measured first-line text indent in the clipboard marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "indented-copy",
      sourceTag: "#text",
      type: "text",
      rect: { x: 20, y: 24, width: 220, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Indented first line\nSecond line",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
        textIndent: 32,
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(wrapFigmaClipboardHtml(fixture));
    const wrapper = parsed.h2d.root.childNodes[0];
    expect(wrapper).toMatchObject({ nodeType: 1, tag: "SPAN", styles: { lineHeight: "24px", textIndent: "32px" } });
    if (wrapper.nodeType !== 1) return;
    const node = wrapper.childNodes[0];
    expect(node.nodeType).toBe(3);
    if (node.nodeType !== 3) return;
    expect(node.styles?.textIndent).toBe("32px");
    expect(node.attributes?.["data-open-canvas-text-indent"]).toBe("32px");
  });

  it("keeps measured text geometry in compatibility attributes", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "measured-heading",
      sourceTag: "H1",
      type: "text",
      rect: { x: 20, y: 30, width: 260, height: 72 },
      textRect: { x: 6, y: 8, width: 180, height: 52 },
      textLineRects: [
        { x: 6, y: 8, width: 180, height: 24 },
        { x: 6, y: 36, width: 112, height: 24 },
      ],
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      text: {
        content: "Measured\nheading",
        lineCount: 2,
        fontFamily: "Inter",
        fontSize: 24,
        fontWeight: 700,
        lineHeight: 28,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-text-rect"])).toEqual({ x: 6, y: 8, width: 180, height: 52 });
    expect(JSON.parse(node.attributes["data-open-canvas-text-line-rects"])).toEqual([
      { x: 6, y: 8, width: 180, height: 24 },
      { x: 6, y: 36, width: 112, height: 24 },
    ]);
    expect(node.attributes["data-open-canvas-line-count"]).toBe("2");
    expect(node.childNodes[0].attributes?.["data-open-canvas-text-line-rects"]).toBe(node.attributes["data-open-canvas-text-line-rects"]);
  });

  it("keeps non-native text decoration details in the H2D style channel", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "decorated-copy",
      sourceTag: "SPAN",
      type: "text",
      rect: { x: 20, y: 24, width: 160, height: 24 },
      opacity: 1,
      fill: { color: "rgb(20, 20, 20)" },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Decorated",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
        textDecoration: "underline",
        textDecorationStyle: "wavy",
        textDecorationColor: "rgb(180, 40, 30)",
        textDecorationThickness: "2px",
        textUnderlineOffset: "3px",
      },
      children: [],
    }];
    const { element } = elementText(toH2D(fixture).root.childNodes[0]);
    expect(element.styles).toMatchObject({
      textDecorationStyle: "wavy",
      textDecorationColor: "rgb(180, 40, 30)",
      textDecorationThickness: "2px",
      textUnderlineOffset: "3px",
    });
  });

  it("retains non-default unicode-bidi metadata for manual review", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "bidi-copy",
      sourceTag: "P",
      type: "text",
      rect: { x: 16, y: 20, width: 180, height: 24 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { unicodeBidi: "isolate" },
      layout: { ...emptyLayout() },
      text: {
        content: "مرحبا",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];
    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.unicodeBidi).toBe("isolate");
  });

  it("carries CSS containment as an inspectable H2D marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "contained-copy-wrapper",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", contain: "content" },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-containment"])).toEqual({
      value: "content",
      tokens: ["content"],
      layout: true,
      paint: true,
      size: false,
      style: false,
      content: true,
    });
  });

  it("does not let computed none mask an authored containment marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-contained-copy-wrapper",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { display: "block", contain: "none" },
      attributes: {
        "data-open-canvas-containment": JSON.stringify({
          value: "layout paint",
          tokens: ["layout", "paint"],
          layout: true,
          paint: true,
          size: false,
          style: false,
          content: false,
        }),
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-containment"])).toMatchObject({
      value: "layout paint",
      tokens: ["layout", "paint"],
    });
  });

  it("preserves retained constraint markers when H2D computed styles are defaulted", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "defaulted-constraint-marker-wrapper",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 20, y: 24, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        display: "block",
        gridAutoFlow: "row",
        columnCount: "auto",
        columnWidth: "auto",
        columnGap: "normal",
        columnFill: "balance",
        scrollSnapType: "none",
        overscrollBehavior: "auto",
        flexGrow: "0",
        flexShrink: "1",
        flexBasis: "auto",
        anchorName: "none",
        positionAnchor: "none",
        containerName: "none",
        containerType: "normal",
      },
      attributes: {
        "data-open-canvas-grid-flow": JSON.stringify({ value: "row dense", dense: true }),
        "data-open-canvas-multicolumn": JSON.stringify({ columnCount: "2", columnWidth: "180px", columnGap: "24px", columnFill: "balance" }),
        "data-open-canvas-scroll-constraints": JSON.stringify({ values: { scrollSnapType: "x mandatory", overscrollBehavior: "contain" } }),
        "data-open-canvas-flex": JSON.stringify({ values: { flexGrow: "1", flexBasis: "40%" } }),
        "data-open-canvas-anchor-positioning": JSON.stringify({ values: { anchorName: "--trigger", positionAnchor: "--trigger" } }),
        "data-open-canvas-container-queries": JSON.stringify({ values: { containerName: "card", containerType: "inline-size" } }),
        "data-open-canvas-sizing-constraints": JSON.stringify({ values: { minWidth: "50%", maxHeight: "25%" }, measuredGeometry: true }),
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-grid-flow"])).toMatchObject({ value: "row dense" });
    expect(JSON.parse(node.attributes["data-open-canvas-multicolumn"])).toMatchObject({ columnCount: "2", columnGap: "24px" });
    expect(JSON.parse(node.attributes["data-open-canvas-scroll-constraints"])).toMatchObject({ values: { scrollSnapType: "x mandatory", overscrollBehavior: "contain" } });
    expect(JSON.parse(node.attributes["data-open-canvas-flex"])).toMatchObject({ values: { flexGrow: "1", flexBasis: "40%" } });
    expect(JSON.parse(node.attributes["data-open-canvas-anchor-positioning"])).toMatchObject({ values: { anchorName: "--trigger" } });
    expect(JSON.parse(node.attributes["data-open-canvas-container-queries"])).toMatchObject({ values: { containerName: "card" } });
    expect(JSON.parse(node.attributes["data-open-canvas-sizing-constraints"])).toMatchObject({ values: { minWidth: "50%", maxHeight: "25%" } });
  });

  it("preserves visual constraint markers when computed styles are defaulted", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "defaulted-visual-marker-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        clipPath: "none",
        overflow: "visible",
        maskImage: "none",
        borderImageSource: "none",
        objectFit: "fill",
        filter: "none",
      },
      attributes: {
        "data-open-canvas-visual-constraints": JSON.stringify({
          values: {
            clipPath: "inset(4px round 8px)",
            overflow: "hidden",
            maskImage: "linear-gradient(90deg, transparent, #000)",
            borderImageSource: "linear-gradient(90deg, #f00, #00f)",
            objectFit: "cover",
            filter: "blur(4px)",
          },
          measuredGeometry: true,
        }),
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-visual-constraints"])).toMatchObject({
      values: {
        clipPath: "inset(4px round 8px)",
        overflow: "hidden",
        maskImage: "linear-gradient(90deg, transparent, #000)",
        borderImageSource: "linear-gradient(90deg, #f00, #00f)",
        objectFit: "cover",
        filter: "blur(4px)",
      },
    });
  });

  it("preserves a retained transform marker when computed transform is none", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "defaulted-transform-marker-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 120, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: { transform: "none", transformOrigin: "50% 50%" },
      attributes: {
        "data-open-canvas-transform": JSON.stringify({
          transform: "rotate(12deg) translateX(8px)",
          transformOrigin: "20% 30%",
          measuredGeometry: true,
        }),
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-transform"])).toMatchObject({
      transform: "rotate(12deg) translateX(8px)",
      transformOrigin: "20% 30%",
    });
  });

  it("carries dense Grid auto-flow as a measured-layout H2D marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "dense-grid-wrapper",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "horizontal", gridAutoFlow: "row dense" },
      computedStyles: { display: "grid", gridAutoFlow: "row dense" },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-grid-flow"])).toEqual({
      value: "row dense",
      dense: true,
      measuredGeometry: true,
      nativeAutoLayoutEquivalent: false,
    });
  });

  it("carries multi-column declarations as a measured-layout H2D marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "multicolumn-wrapper",
      sourceTag: "ARTICLE",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        display: "block",
        columnCount: "2",
        columnWidth: "180px",
        columnGap: "24px",
        columnFill: "balance",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-multicolumn"])).toEqual({
      columnCount: "2",
      columnWidth: "180px",
      columnGap: "24px",
      columnFill: "balance",
      measuredGeometry: true,
      nativeAutoLayoutEquivalent: false,
    });
  });

  it("carries non-default scroll constraints as an H2D marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "scroll-copy-wrapper",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        display: "block",
        scrollSnapType: "x mandatory",
        scrollSnapAlign: "center",
        overscrollBehavior: "contain",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-scroll-constraints"])).toEqual({
      values: {
        scrollSnapType: "x mandatory",
        scrollSnapAlign: "center",
        overscrollBehavior: "contain",
      },
      measuredGeometry: true,
      nativeScrollEquivalent: false,
    });
  });

  it("carries CSS Anchor Positioning as measured, inspectable metadata", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "anchor-positioned-popover",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        display: "block",
        position: "absolute",
        anchorName: "--trigger",
        positionAnchor: "--trigger",
        positionArea: "bottom span-inline-end",
        anchorScope: "--scope",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-anchor-positioning"])).toEqual({
      values: {
        anchorName: "--trigger",
        anchorScope: "--scope",
        positionAnchor: "--trigger",
        positionArea: "bottom span-inline-end",
      },
      measuredGeometry: true,
      nativeEquivalent: false,
    });
  });

  it("carries container-query conditions as measured, inspectable metadata", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "container-query-card",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 320, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        display: "block",
        container: "card / inline-size",
        containerName: "card",
        containerType: "inline-size",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-container-queries"])).toEqual({
      values: {
        container: "card / inline-size",
        containerName: "card",
        containerType: "inline-size",
      },
      measuredGeometry: true,
      nativeEquivalent: false,
    });
  });

  it("carries clipping, masking, and overflow as a trimmed-style H2D marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "visual-constraint-panel",
      sourceTag: "SECTION",
      type: "frame",
      rect: { x: 20, y: 24, width: 320, height: 180 },
      opacity: 1,
      filter: "blur(4px) opacity(50%)",
      backdropFilter: "blur(8px)",
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      computedStyles: {
        display: "block",
        clipPath: "inset(4px round 8px)",
        filter: "blur(4px) opacity(50%)",
        backdropFilter: "blur(8px)",
        overflowX: "hidden",
        maskImage: "linear-gradient(90deg, transparent, #000)",
        maskPosition: "20% 0%",
        maskMode: "luminance",
        maskComposite: "intersect",
        borderImageSource: "linear-gradient(90deg, #f00, #00f)",
        borderImageSlice: "30%",
        borderImageRepeat: "round",
        mixBlendMode: "multiply",
        backgroundBlendMode: "screen",
        isolation: "isolate",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-visual-constraints"])).toEqual({
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
    });
  });

  it("keeps inherited line-height through the actual clipboard marker round-trip", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "inherited-round-trip",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block", lineHeight: "1.5" },
      layout: { ...emptyLayout() },
      children: [{
        id: "inherited-round-trip-text",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 220, height: 48 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "First line\nSecond line",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 24,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("24px");
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      styles: { lineHeight: "24px" },
      childNodes: [{ nodeType: 3, lineHeight: 24 }],
    });
    expect(parsed.scene?.root.children[0].children[0].text?.lineHeight).toBe(24);
  });

  it("carries multi-layer mask styles through the H2D clipboard payload", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "masked-card",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 240, height: 120 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: {
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
      layout: { ...emptyLayout() },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles).toMatchObject({
      maskImage: "linear-gradient(to right, transparent, #000), radial-gradient(circle, #000, transparent)",
      maskPosition: "0% 0%, 20px 10px",
      maskSize: "auto, 80px 40px",
      maskRepeat: "no-repeat, repeat-x",
      maskClip: "border-box, border-box",
      maskOrigin: "border-box, border-box",
      maskMode: "match-source, alpha",
    });
  });

  it("keeps a parent unitless line-height when child font sizes resolve to different pixels", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "mixed-size-copy",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 24, width: 280, height: 72 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      // CSS unitless line-height is inherited as a multiplier. The two
      // children therefore resolve to different pixel line boxes, but the
      // H2D wrapper must retain the parent's authored multiplier.
      computedStyles: { display: "block", lineHeight: "1.5" },
      children: [
        {
          id: "small-copy",
          sourceTag: "#text",
          type: "text",
          rect: { x: 0, y: 0, width: 120, height: 24 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { ...emptyLayout() },
          text: {
            content: "Small",
            fontFamily: "Inter",
            fontSize: 16,
            fontWeight: 400,
            lineHeight: 24,
            letterSpacing: 0,
            textAlign: "left",
          },
          children: [],
        },
        {
          id: "large-copy",
          sourceTag: "#text",
          type: "text",
          rect: { x: 0, y: 24, width: 160, height: 36 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { ...emptyLayout() },
          text: {
            content: "Large",
            fontFamily: "Inter",
            fontSize: 24,
            fontWeight: 400,
            lineHeight: 36,
            letterSpacing: 0,
            textAlign: "left",
          },
          children: [],
        },
      ],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.lineHeight).toBe("1.5");
    expect(node.childNodes.map((child) => child.nodeType)).toEqual([1, 1]);
    expect(node.childNodes.map((child) => child.nodeType === 1 && child.styles.lineHeight)).toEqual(["24px", "36px"]);
  });

  it("wraps mixed anonymous line-heights in element styles for native H2D import", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "mixed-anonymous-line-height",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      children: [
        {
          id: "small-run",
          sourceTag: "#text",
          type: "text",
          rect: { x: 0, y: 0, width: 120, height: 20 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { ...emptyLayout() },
          text: {
            content: "Small",
            fontFamily: "Inter",
            fontSize: 14,
            fontWeight: 400,
            lineHeight: 20,
            letterSpacing: 0,
            textAlign: "left",
          },
          children: [],
        },
        {
          id: "large-run",
          sourceTag: "#text",
          type: "text",
          rect: { x: 120, y: 0, width: 160, height: 28 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { ...emptyLayout() },
          text: {
            content: "Large",
            fontFamily: "Inter",
            fontSize: 20,
            fontWeight: 400,
            lineHeight: 28,
            letterSpacing: 0,
            textAlign: "left",
          },
          children: [],
        },
      ],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes.map((child) => child.nodeType)).toEqual([1, 1]);
    expect(node.childNodes.map((child) => child.nodeType === 1 && child.styles.lineHeight)).toEqual(["20px", "28px"]);
    expect(node.childNodes[0]).toMatchObject({
      tag: "SPAN",
      attributes: { "data-open-canvas-text-run": "true" },
      childNodes: [{ nodeType: 3, lineHeight: 20 }],
    });
  });

  it("wraps a single-line inherited anonymous run so native H2D keeps line-height", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "inherited-single-line-height",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 28 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block", lineHeight: "28px" },
      layout: { ...emptyLayout() },
      children: [{
        id: "inherited-single-line-height-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 120, height: 28 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "Inherited leading",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 28,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes).toHaveLength(1);
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      styles: { lineHeight: "28px", "line-height": "28px" },
      attributes: {
        "data-open-canvas-text-run": "true",
        "data-open-canvas-line-height": "28px",
      },
      childNodes: [{ nodeType: 3, lineHeight: 28 }],
    });
  });

  it("forces an explicit inline line-height wrapper in the native clipboard payload", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-inherited-line-height",
      sourceTag: "#text",
      type: "text",
      rect: { x: 20, y: 24, width: 160, height: 28 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Trimmed inherited leading",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 28,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(wrapFigmaClipboardHtml(fixture));
    const wrapper = parsed.h2d.root.childNodes[0];
    expect(wrapper).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: {
        "data-open-canvas-text-run": "true",
        "data-open-canvas-line-height": "28px",
      },
      styles: { lineHeight: "28px" },
    });
    if (wrapper.nodeType !== 1) return;
    expect(wrapper.childNodes[0]).toMatchObject({ nodeType: 3, lineHeight: 28 });
  });

  it("wraps element-backed text in the native clipboard payload without changing plugin scene shape", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "element-backed-inherited-leading",
      sourceTag: "P",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 56 },
      textRect: { x: 0, y: 0, width: 220, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
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
    }];

    const native = parseFigmaHtml(wrapFigmaClipboardHtml(fixture)).h2d.root.childNodes[0];
    expect(native.nodeType).toBe(1);
    if (native.nodeType !== 1) return;
    expect(native.styles.lineHeight).toBe("28px");
    expect(native.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: {
        "data-open-canvas-text-run": "true",
        "data-open-canvas-line-height": "28px",
      },
      styles: { lineHeight: "28px" },
      childNodes: [{ nodeType: 3, lineHeight: 28 }],
    });
    const nativeTextWrapper = native.childNodes[0];
    expect(nativeTextWrapper.nodeType).toBe(1);
    if (nativeTextWrapper.nodeType !== 1) return;
    expect(nativeTextWrapper.childNodes[0]).toMatchObject({
      nodeType: 3,
      styles: { lineHeight: "28px", "line-height": "28px" },
      computedStyles: { lineHeight: "28px", "line-height": "28px" },
    });

    const plugin = parseFigmaHtml(buildFigmaHtml(fixture)).h2d.root.childNodes[0];
    expect(plugin.nodeType).toBe(1);
    if (plugin.nodeType !== 1) return;
    // The lossless plugin payload remains a single element-backed editable
    // text layer; only the native clipboard path gets the compatibility span.
    expect(plugin.childNodes[0]).toMatchObject({ nodeType: 3, lineHeight: 28 });
  });

  it("keeps both line-height spellings resolved on element text children", () => {
    const fixture = documentFixture();
    fixture.root.computedStyles = { display: "block", fontSize: "18px", lineHeight: "28px" };
    fixture.root.children = [{
      id: "stale-child-leading",
      sourceTag: "P",
      type: "text",
      rect: { x: 0, y: 0, width: 240, height: 56 },
      textRect: { x: 0, y: 0, width: 220, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      // Simulate a bridge that left the old child fallback in both raw
      // computed channels even though the parent carries 28px leading.
      computedStyles: { display: "block", fontSize: "16px", lineHeight: "inherit", "line-height": "inherit" },
      text: {
        content: "First line\nSecond line",
        lineCount: 2,
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 19.2,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const native = parseFigmaHtml(wrapFigmaClipboardHtml(fixture)).h2d.root.childNodes[0];
    expect(native.nodeType).toBe(1);
    if (native.nodeType !== 1) return;
    const wrapper = native.childNodes[0];
    expect(wrapper.nodeType).toBe(1);
    if (wrapper.nodeType !== 1) return;
    expect(wrapper.styles).toMatchObject({ lineHeight: "28px", "line-height": "28px" });
    expect(wrapper.childNodes[0]).toMatchObject({
      styles: { lineHeight: "28px", "line-height": "28px" },
      computedStyles: { lineHeight: "28px", "line-height": "28px" },
    });
  });

  it("wraps a nested anonymous run when a bridge trims the parent line-height", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "trimmed-nested-wrapper",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 0, y: 0, width: 320, height: 28 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      // Simulate a compatibility bridge that retained the child value but
      // dropped the wrapper's computed style map.
      children: [{
        id: "trimmed-nested-run",
        sourceTag: "#text",
        type: "text",
        rect: { x: 0, y: 0, width: 140, height: 28 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "Trimmed leading",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 28,
          letterSpacing: 0,
          textAlign: "left",
        },
        computedStyles: { lineHeight: "28px" },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.childNodes[0]).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      styles: { lineHeight: "28px", "line-height": "28px" },
      attributes: { "data-open-canvas-text-run": "true" },
      childNodes: [{ nodeType: 3, lineHeight: 28 }],
    });
  });

  it("preserves pre-line whitespace semantics for editable text", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "pre-line-copy",
      sourceTag: "P",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block" },
      layout: { ...emptyLayout() },
      text: {
        content: "First line\nSecond line",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
        whiteSpace: "pre-line",
      },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) expect(node.styles.whiteSpace).toBe("pre-line");
  });

  it("keeps text truncation constraints in the H2D replay channel", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "clamped-heading",
      type: "text",
      rect: { x: 20, y: 24, width: 240, height: 48 },
      opacity: 1,
      fill: { color: "#182832" },
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "A long heading",
        fontFamily: "Inter",
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
        textOverflow: "ellipsis",
        maxLines: 2,
      },
      children: [],
    }];
    const node = parseFigmaHtml(buildFigmaHtml(fixture)).h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles.textOverflow).toBe("ellipsis");
      expect(node.styles.lineClamp).toBe("2");
    }
  });

  it("keeps a padded text box as a frame while collapsing its glyph run", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "badge",
      sourceTag: "SPAN",
      type: "text",
      rect: { x: 24, y: 40, width: 104, height: 28 },
      textRect: { x: 8, y: 5, width: 88, height: 18 },
      opacity: 1,
      fill: { color: "#ffffff" },
      radius: [8, 8, 8, 8],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), padding: [5, 8, 5, 8] },
      text: {
        content: "VIP",
        fontFamily: "Inter",
        fontSize: 12,
        fontWeight: 700,
        lineHeight: 18,
        letterSpacing: 0,
        textAlign: "center",
      },
      children: [],
    }];

    const badge = toH2D(fixture).root.childNodes[0];
    expect(badge.nodeType).toBe(1);
    if (badge.nodeType === 1) {
      expect(badge.childNodes).toHaveLength(1);
      expect(badge.childNodes[0]).toMatchObject({ nodeType: 3, rect: { x: 32, y: 45, width: 88, height: 18 } });
    }
  });

  it("normalizes padded block text containers to centered H2D flex flow", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "cta",
      sourceTag: "BUTTON",
      type: "frame",
      rect: { x: 24, y: 80, width: 120, height: 36 },
      opacity: 1,
      radius: [18, 18, 18, 18],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block", textAlign: "center" },
      layout: { ...emptyLayout(), padding: [10, 14, 10, 14] },
      children: [{
        id: "cta-text",
        sourceTag: "#text",
        type: "text",
        rect: { x: 38, y: 91, width: 92, height: 14 },
        opacity: 1,
        fill: { color: "#3A001A" },
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: {
          content: "Get tickets",
          fontFamily: "Inter",
          fontSize: 11,
          fontWeight: 800,
          lineHeight: 14,
          letterSpacing: 0,
          textAlign: "center",
        },
        children: [],
      }],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const cta = parsed.h2d.root.childNodes[0];
    expect(cta.nodeType).toBe(1);
    if (cta.nodeType === 1) {
      expect(cta.styles).toMatchObject({ display: "flex", alignItems: "center", justifyContent: "center" });
      expect(cta.styles.flexDirection).toBeUndefined();
      expect(cta).not.toHaveProperty("layout");
    }
  });

  it("uses the element content box for wrapped text while retaining the measured offset", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "title",
      sourceTag: "H2",
      type: "text",
      rect: { x: 20, y: 30, width: 240, height: 48 },
      textRect: { x: 12, y: 4, width: 120, height: 24 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout() },
      text: {
        content: "Measured title",
        fontFamily: "Inter",
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const { element: title, text } = elementText(parsed.h2d.root.childNodes[0]);
    expect(title.rect).toEqual({ x: 20, y: 30, width: 240, height: 48 });
    expect(text.rect).toEqual({ x: 32, y: 34, width: 120, height: 24 });
  });

  it("keeps anonymous inline text at its intrinsic measured width", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "button",
      sourceTag: "BUTTON",
      type: "frame",
      rect: { x: 20, y: 30, width: 140, height: 36 },
      opacity: 1,
      radius: [18, 18, 18, 18],
      margin: [0, 0, 0, 0],
      layout: { mode: "horizontal", gap: 4, padding: [8, 12, 8, 12], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [{
        id: "button-text",
        sourceTag: "#text",
        type: "text",
        rect: { x: 12, y: 8, width: 72, height: 20 },
        textRect: { x: 0, y: 0, width: 72, height: 20 },
        opacity: 1,
        fill: { color: "rgb(255, 255, 255)" },
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout() },
        text: { content: "Select", fontFamily: "Inter", fontSize: 12, fontWeight: 700, lineHeight: 20, letterSpacing: 0, textAlign: "left" },
        children: [],
      }],
    }];
    const button = toH2D(fixture).root.childNodes[0];
    expect(button.nodeType).toBe(1);
    if (button.nodeType === 1) expect(button.childNodes[0]).toMatchObject({ nodeType: 3, rect: { width: 72, height: 20 } });
  });

  it("marks measured free-positioning wrappers explicitly for trimmed H2D", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "mixed-copy",
      sourceTag: "P",
      type: "frame",
      rect: { x: 20, y: 30, width: 260, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { display: "block" },
      layout: { ...emptyLayout(), mode: "none" },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.attributes["data-open-canvas-layout-mode"]).toBe("none");
    expect(node.layout).toBeUndefined();
  });

  it("keeps padded text as a box with an inset editable text child", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "padded-copy",
      sourceTag: "DIV",
      type: "frame",
      rect: { x: 20, y: 30, width: 180, height: 52 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), padding: [12, 16, 12, 16] },
      children: [{
        id: "padded-copy-text",
        sourceTag: "#text",
        type: "text",
        rect: { x: 16, y: 12, width: 148, height: 28 },
        textRect: { x: 0, y: 2, width: 148, height: 24 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: emptyLayout(),
        text: { content: "Padded copy", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 24, letterSpacing: 0, textAlign: "left" },
        children: [],
      }],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles).toMatchObject({ paddingTop: "12px", paddingRight: "16px", paddingBottom: "12px", paddingLeft: "16px" });
      expect(node.childNodes[0]).toMatchObject({ nodeType: 3, rect: { x: 36, y: 42, width: 148, height: 24 } });
    }
  });

  it("keeps captured flow children in normal document flow", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "banner",
      type: "frame",
      rect: { x: 5, y: 28, width: 420, height: 96 },
      opacity: 1,
      radius: [16, 16, 16, 16],
      margin: [8, 5, 20, 5],
      layout: { mode: "vertical", gap: 4, padding: [12, 12, 12, 12], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const banner = parsed.h2d.root.childNodes[0];
    expect(banner.nodeType).toBe(1);
    if (banner.nodeType === 1) {
      expect(banner.styles.position).toBeUndefined();
      expect(banner.styles.left).toBeUndefined();
      expect(banner.styles.top).toBeUndefined();
      expect(banner.styles.marginTop).toBe("8px");
      expect(banner.styles.marginRight).toBe("5px");
      expect(banner.styles.marginBottom).toBe("20px");
      expect(banner.styles.marginLeft).toBe("5px");
    }
  });

  it("preserves nested flow containers without duplicating coordinates", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "outer",
      type: "frame",
      rect: { x: 12, y: 24, width: 300, height: 140 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "vertical" },
      children: [{
        id: "inner",
        type: "frame",
        rect: { x: 20, y: 32, width: 220, height: 72 },
        opacity: 1,
        radius: [8, 8, 8, 8],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout(), mode: "horizontal" },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const outer = parsed.h2d.root.childNodes[0];
    expect(outer.nodeType).toBe(1);
    if (outer.nodeType !== 1) return;
    expect(outer.styles.position).toBeUndefined();
    expect(outer.styles.left).toBeUndefined();
    expect(outer.styles.top).toBeUndefined();
    const inner = outer.childNodes[0];
    expect(inner.nodeType).toBe(1);
    if (inner.nodeType !== 1) return;
    expect(inner.styles.position).toBeUndefined();
    expect(inner.styles.left).toBeUndefined();
    expect(inner.styles.top).toBeUndefined();
  });

  it("keeps wrapped grid compatibility and child alignment styles", () => {
    const fixture = documentFixture();
    fixture.root.layout = {
      ...fixture.root.layout,
      mode: "horizontal",
      wrap: true,
      rowGap: 17,
      columnGap: 11,
      alignContent: "center",
    };
    fixture.root.computedStyles = { display: "grid" };
    fixture.root.children = [{
      id: "cta",
      type: "frame",
      rect: { x: 200, y: 32, width: 100, height: 40 },
      opacity: 1,
      radius: [8, 8, 8, 8],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), alignSelf: "end", order: 2, geometryLock: true },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.h2d.root.styles.display).toBe("grid");
    expect(parsed.h2d.root.styles.flexWrap).toBeUndefined();
    expect(parsed.h2d.root.styles.flexShrink).toBeUndefined();
    expect(parsed.h2d.root.styles.rowGap).toBe("17px");
    expect(parsed.h2d.root.styles.columnGap).toBe("11px");
    expect(parsed.h2d.root.styles.alignContent).toBeUndefined();
    const cta = parsed.h2d.root.childNodes[0];
    expect(cta.nodeType).toBe(1);
    if (cta.nodeType === 1) {
      expect(cta.styles.alignSelf).toBe("flex-end");
      expect(cta.styles.order).toBe("2");
      // Native H2D has no access to the shared scene's geometryLock flag.
      // For wrapped/distributed tracks we materialize the measured child as
      // an absolute layer so Figma cannot reflow it with different font
      // metrics. The Open Canvas plugin recognizes the marker and restores
      // its editable flow placeholder.
      expect(cta.styles.position).toBe("absolute");
      expect(cta.styles.left).toBe("200px");
      expect(cta.styles.top).toBe("32px");
      expect(cta.attributes?.["data-open-canvas-geometry-lock"]).toBe("true");
    }
  });

  it("keeps authored place-content in the portable H2D layout channel", () => {
    const fixture = documentFixture();
    fixture.root.layout = {
      ...fixture.root.layout,
      mode: "horizontal",
      wrap: true,
      placeContent: "center space-between",
    };
    fixture.root.computedStyles = { display: "grid" };

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.h2d.root.styles.placeContent).toBe("center space-between");
  });

  it("carries the flex grow/shrink/basis contract in a trimmed-style marker", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "flex-contract",
      type: "frame",
      rect: { x: 0, y: 0, width: 220, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: {
        display: "flex",
        flexGrow: "2",
        flexShrink: "0",
        flexBasis: "40%",
      },
      layout: { ...emptyLayout(), mode: "horizontal" },
      children: [],
    }];

    const node = parseFigmaHtml(wrapFigmaClipboardHtml(fixture)).h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(JSON.parse(node.attributes["data-open-canvas-flex"])).toMatchObject({
      values: { flexGrow: "2", flexShrink: "0", flexBasis: "40%" },
      measuredGeometry: true,
    });
  });

  it("materializes geometry-locked anonymous text runs for native H2D", () => {
    const fixture = documentFixture();
    fixture.root.layout = {
      ...fixture.root.layout,
      mode: "horizontal",
      wrap: true,
      alignContent: "center",
    };
    fixture.root.computedStyles = { display: "grid" };
    fixture.root.children = [{
      id: "wrapped-label",
      type: "text",
      sourceTag: "#text",
      rect: { x: 48, y: 36, width: 96, height: 24 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), geometryLock: true },
      text: {
        content: "Wrapped label",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 24,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const text = parsed.h2d.root.childNodes[0];
    expect(text.nodeType).toBe(3);
    if (text.nodeType !== 3) return;
    expect(text.styles).toMatchObject({ position: "absolute", left: "48px", top: "36px", lineHeight: "24px" });
    expect(text.attributes?.["data-open-canvas-geometry-lock"]).toBe("true");
  });

  it("wraps geometry-locked multi-line text so native H2D preserves line-height", () => {
    const fixture = documentFixture();
    fixture.root.layout = {
      ...fixture.root.layout,
      mode: "horizontal",
      wrap: true,
      alignContent: "center",
    };
    fixture.root.computedStyles = { display: "grid" };
    fixture.root.children = [{
      id: "wrapped-multiline-label",
      type: "text",
      sourceTag: "#text",
      rect: { x: 48, y: 28, width: 120, height: 52 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), geometryLock: true },
      text: {
        content: "First line\nSecond line",
        lineCount: 2,
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 26,
        letterSpacing: 0,
        textAlign: "left",
      },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const wrapper = parsed.h2d.root.childNodes[0];
    expect(wrapper).toMatchObject({
      nodeType: 1,
      tag: "SPAN",
      attributes: {
        "data-open-canvas-text-run": "true",
        "data-open-canvas-line-height": "26px",
      },
      styles: {
        position: "absolute",
        left: "48px",
        top: "28px",
        lineHeight: "26px",
      },
    });
    if (wrapper.nodeType !== 1) return;
    expect(wrapper.childNodes[0]).toMatchObject({
      nodeType: 3,
      lineHeight: 26,
      attributes: { "data-open-canvas-geometry-lock": "true" },
    });
  });

  it("carries CSS order on anonymous H2D text runs", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "horizontal" };
    fixture.root.children = [{
      id: "ordered-copy",
      type: "text",
      sourceTag: "#text",
      rect: { x: 0, y: 0, width: 80, height: 20 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), order: 2 },
      text: { content: "Ordered", fontFamily: "Inter", fontSize: 14, fontWeight: 400, lineHeight: 20, letterSpacing: 0, textAlign: "left" },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const text = parsed.h2d.root.childNodes[0];
    expect(text.nodeType).toBe(3);
    if (text.nodeType !== 3) return;
    expect(text.styles?.order).toBe("2");
  });

  it("carries z-index on anonymous H2D text runs", () => {
    const fixture = documentFixture();
    fixture.root.layout = { ...fixture.root.layout, mode: "none" };
    fixture.root.children = [{
      id: "stacked-copy",
      type: "text",
      sourceTag: "#text",
      rect: { x: 12, y: 12, width: 80, height: 20 },
      opacity: 1,
      zIndex: 7,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      text: { content: "Badge", fontFamily: "Inter", fontSize: 14, fontWeight: 700, lineHeight: 20, letterSpacing: 0, textAlign: "left" },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const text = parsed.h2d.root.childNodes[0];
    expect(text.nodeType).toBe(3);
    if (text.nodeType !== 3) return;
    expect(text.styles?.zIndex).toBe("7");
  });

  it("retains computed CSS fields outside the normalized scene model", () => {
    const fixture = documentFixture();
    fixture.root.computedStyles = {
      clipPath: "inset(2px round 8px)",
      mixBlendMode: "multiply",
      transformOrigin: "40px 20px",
      justifyItems: "center",
      justifySelf: "center",
    };

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.h2d.root.styles.clipPath).toBe("inset(2px round 8px)");
    expect(parsed.h2d.root.styles.mixBlendMode).toBe("multiply");
    // Resolved transform origins are capture-time measurement metadata. They
    // must not be replayed as CSS when the node has no authored transform,
    // otherwise the official importer changes the node's coordinate space.
    expect(parsed.h2d.root.styles.transformOrigin).toBeUndefined();
    expect(parsed.h2d.root.computedStyles?.transformOrigin).toBe("40px 20px");
    expect(parsed.h2d.root.styles.justifyItems).toBe("center");
    expect(parsed.h2d.root.styles.justifySelf).toBe("center");
  });

  it("keeps a captured CSS transform on its normalized layout box", () => {
    const fixture = documentFixture();
    fixture.root.transform = "rotate(12deg)";
    fixture.root.geometryIncludesTransform = true;
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.h2d.root.styles.transform).toBe("rotate(12deg)");
  });

  it("uses the shared transform-origin field when computed styles were trimmed", () => {
    const fixture = documentFixture();
    fixture.root.transform = "rotate(12deg)";
    fixture.root.transformOrigin = "left bottom";
    fixture.root.geometryIncludesTransform = true;
    fixture.root.computedStyles = {};
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.h2d.root.styles.transform).toBe("rotate(12deg)");
    expect(parsed.h2d.root.styles.transformOrigin).toBe("left bottom");
    expect(parsed.h2d.root.attributes["data-open-canvas-transform"]).toBe(JSON.stringify({
      transform: "rotate(12deg)",
      transformOrigin: "left bottom",
      measuredGeometry: true,
    }));
  });

  it("does not replay normalized individual transforms twice", () => {
    const fixture = documentFixture();
    fixture.root.transform = "translate(10px 20px) rotate(15deg) scale(1.25)";
    fixture.root.geometryIncludesTransform = true;
    fixture.root.computedStyles = {
      translate: "10px 20px",
      rotate: "15deg",
      scale: "1.25",
    };
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.h2d.root.styles.transform).toBe("translate(10px 20px) rotate(15deg) scale(1.25)");
    expect(parsed.h2d.root.styles.translate).toBeUndefined();
    expect(parsed.h2d.root.styles.rotate).toBeUndefined();
    expect(parsed.h2d.root.styles.scale).toBeUndefined();
  });

  it("preserves dashed and dotted border styles for editable imports", () => {
    const fixture = documentFixture();
    fixture.root.stroke = { color: "rgb(255, 0, 0)", width: 2, style: "dashed" };
    fixture.root.borders = [
      { color: "rgb(255, 0, 0)", width: 2, style: "dashed" },
      { color: "rgb(0, 255, 0)", width: 1, style: "dotted" },
      undefined,
      undefined,
    ];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.h2d.root.styles.borderTopStyle).toBe("dashed");
    expect(parsed.h2d.root.styles.borderRightStyle).toBe("dotted");
    expect(parsed.h2d.root.styles.borderBottomStyle).toBeUndefined();
  });

  it("does not turn geometry-locked plugin hints into official absolute layers", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "card",
      type: "frame",
      rect: { x: 24, y: 48, width: 180, height: 72 },
      opacity: 1,
      radius: [12, 12, 12, 12],
      margin: [8, 6, 4, 2],
      layout: { ...emptyLayout(), geometryLock: true },
      children: [],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const card = parsed.h2d.root.childNodes[0];
    expect(card.nodeType).toBe(1);
    if (card.nodeType === 1) {
      expect(card.styles.position).toBeUndefined();
      expect(card.styles.left).toBeUndefined();
      expect(card.styles.top).toBeUndefined();
      expect(card.styles.marginTop).toBe("8px");
      expect(card.styles.marginLeft).toBe("2px");
      expect(card).not.toHaveProperty("layout");
    }
    expect(parsed.h2d.root.styles.position).toBeUndefined();
  });

  it("preserves computed flow margins for ordinary layers", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "section",
      type: "frame",
      rect: { x: 24, y: 413, width: 300, height: 80 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [28, 0, 0, 0],
      computedStyles: {
        display: "block",
        marginTop: "28px",
        marginRight: "0px",
        marginBottom: "0px",
        marginLeft: "0px",
      },
      layout: { ...emptyLayout(), geometryLock: true },
      children: [],
    }];

    const section = parseFigmaHtml(buildFigmaHtml(fixture)).h2d.root.childNodes[0];
    expect(section.nodeType).toBe(1);
    if (section.nodeType === 1) {
      expect(section.styles.top).toBeUndefined();
      expect(section.styles.marginTop).toBe("28px");
      expect(section.styles.marginRight).toBeUndefined();
      expect(section.styles.marginBottom).toBeUndefined();
      expect(section.styles.marginLeft).toBeUndefined();
    }
  });

  it("serializes CSS outline outside the border-box channel", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "focus-ring",
      type: "frame",
      rect: { x: 20, y: 30, width: 180, height: 48 },
      opacity: 1,
      radius: [8, 8, 8, 8],
      margin: [0, 0, 0, 0],
      outline: { color: "rgb(20, 40, 60)", width: 3, style: "dashed" },
      outlineOffset: 4,
      layout: { ...emptyLayout() },
      children: [],
    }];

    const node = parseFigmaHtml(buildFigmaHtml(fixture)).h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles).toMatchObject({
        outlineStyle: "dashed",
        outlineWidth: "3px",
        outlineColor: "rgb(20, 40, 60)",
        outlineOffset: "4px",
      });
      expect(node.styles.borderTopWidth).toBeUndefined();
    }
  });

  it("uses measured left/top as the only absolute inset pair", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "floating",
      type: "frame",
      rect: { x: 24, y: 48, width: 120, height: 40 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      computedStyles: { position: "absolute", right: "18px", bottom: "18px" },
      positioning: "absolute",
      layout: { ...emptyLayout(), geometryLock: true, position: "absolute" },
      children: [],
    }];

    const floating = parseFigmaHtml(buildFigmaHtml(fixture)).h2d.root.childNodes[0];
    expect(floating.nodeType).toBe(1);
    if (floating.nodeType === 1) {
      expect(floating.styles.left).toBe("24px");
      expect(floating.styles.top).toBe("48px");
      expect(floating.styles.right).toBe("auto");
      expect(floating.styles.bottom).toBe("auto");
    }
  });

  it("keeps geometry-locked descendants relative to their immediate parent", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "section",
      type: "frame",
      rect: { x: 24, y: 48, width: 300, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "vertical" },
      children: [{
        id: "headline",
        type: "text",
        rect: { x: 16, y: 20, width: 180, height: 24 },
        opacity: 1,
        fill: { color: "rgb(24, 40, 50)" },
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout(), geometryLock: true },
        text: {
          content: "Arrive with ease.",
          fontFamily: "Inter",
          fontSize: 18,
          fontWeight: 700,
          lineHeight: 24,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const section = parsed.h2d.root.childNodes[0];
    expect(section.nodeType).toBe(1);
    if (section.nodeType === 1) {
      expect(section.styles.position).toBeUndefined();
      expect(section.styles.left).toBeUndefined();
      expect(section.styles.top).toBeUndefined();
      const { element: headline } = elementText(section.childNodes[0]);
      expect(headline.rect).toMatchObject({ x: 40, y: 68 });
    }
  });

  it("resolves measured absolute insets from the parent padding box", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "card",
      type: "frame",
      rect: { x: 24, y: 48, width: 300, height: 180 },
      opacity: 1,
      radius: [12, 12, 12, 12],
      borders: [
        { color: "rgb(0, 0, 0)", width: 1 },
        { color: "rgb(0, 0, 0)", width: 2 },
        { color: "rgb(0, 0, 0)", width: 3 },
        { color: "rgb(0, 0, 0)", width: 4 },
      ],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), geometryLock: true },
      children: [{
        id: "label",
        type: "text",
        rect: { x: 16, y: 20, width: 160, height: 24 },
        opacity: 1,
        fill: { color: "rgb(24, 40, 50)" },
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { ...emptyLayout(), geometryLock: true },
        text: {
          content: "Label",
          fontFamily: "Inter",
          fontSize: 16,
          fontWeight: 400,
          lineHeight: 20,
          letterSpacing: 0,
          textAlign: "left",
        },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const card = parsed.h2d.root.childNodes[0];
    expect(card.nodeType).toBe(1);
    if (card.nodeType === 1) {
      const { element: label } = elementText(card.childNodes[0]);
      expect(label.rect).toMatchObject({ x: 40, y: 68 });
    }
  });

  it("does not add a DOM ancestor offset to fixed-position descendants", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "shell",
      type: "frame",
      rect: { x: 32, y: 64, width: 300, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "vertical" },
      children: [{
        id: "toast",
        type: "frame",
        rect: { x: 18, y: 22, width: 140, height: 40 },
        opacity: 1,
        radius: [8, 8, 8, 8],
        margin: [0, 0, 0, 0],
        positioning: "fixed",
        layout: { ...emptyLayout(), geometryLock: true },
        children: [],
      }],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const shell = parsed.h2d.root.childNodes[0];
    expect(shell.nodeType).toBe(1);
    if (shell.nodeType === 1) {
      const toast = shell.childNodes[0];
      expect(toast.nodeType).toBe(1);
      if (toast.nodeType === 1) {
        expect(toast.rect).toMatchObject({ x: 18, y: 22 });
        expect(toast.styles.left).toBe("18px");
        expect(toast.styles.top).toBe("22px");
      }
    }
  });

  it("keeps ancestor-scoped fixed descendants relative to their containing block", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "transformed-shell",
      type: "frame",
      rect: { x: 32, y: 64, width: 300, height: 180 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { ...emptyLayout(), mode: "vertical" },
      children: [{
        id: "content-wrapper",
        type: "frame",
        rect: { x: 10, y: 12, width: 260, height: 120 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: emptyLayout(),
        children: [{
          id: "contained-toast",
          type: "frame",
          rect: { x: 8, y: 10, width: 140, height: 40 },
          opacity: 1,
          radius: [8, 8, 8, 8],
          margin: [0, 0, 0, 0],
          positioning: "fixed",
          fixedScope: "ancestor",
          fixedContainingBlockId: "transformed-shell",
          fixedOffset: { x: 18, y: 22 },
          layout: { ...emptyLayout(), geometryLock: true },
          children: [],
        }],
      }],
    }];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const shell = parsed.h2d.root.childNodes[0];
    expect(shell.nodeType).toBe(1);
    if (shell.nodeType !== 1) return;
    const wrapper = shell.childNodes[0];
    expect(wrapper.nodeType).toBe(1);
    if (wrapper.nodeType !== 1) return;
    const toast = wrapper.childNodes[0];
    expect(toast.nodeType).toBe(1);
    if (toast.nodeType !== 1) return;
    expect(toast.rect).toMatchObject({ x: 50, y: 86 });
    expect(toast.styles).toMatchObject({ left: "18px", top: "22px" });
    expect(toast.attributes).toMatchObject({
      "data-open-canvas-fixed-scope": "ancestor",
      "data-open-canvas-fixed-offset": JSON.stringify({ x: 18, y: 22 }),
      "data-open-canvas-fixed-containing-block": "transformed-shell",
    });
  });

  it("preserves relative containers and true absolute descendants", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "hero",
      type: "frame",
      rect: { x: 12, y: 20, width: 300, height: 180 },
      opacity: 1,
      radius: [20, 20, 20, 20],
      margin: [0, 0, 0, 0],
      positioning: "relative",
      positionOffset: { left: 3, top: 4 },
      layout: emptyLayout(),
      children: [{
        id: "ring",
        type: "frame",
        rect: { x: 164, y: 116, width: 210, height: 210 },
        opacity: 1,
        radius: [105, 105, 105, 105],
        margin: [0, 0, 0, 0],
        positioning: "absolute",
        layout: { ...emptyLayout(), position: "absolute" },
        children: [],
      }],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const hero = parsed.h2d.root.childNodes[0];
    expect(hero.nodeType).toBe(1);
    if (hero.nodeType === 1) {
      expect(hero.styles.position).toBe("relative");
      expect(hero.styles.left).toBe("3px");
      expect(hero.styles.top).toBe("4px");
      const ring = hero.childNodes[0];
      expect(ring.nodeType).toBe(1);
      if (ring.nodeType === 1) {
        expect(ring.styles.position).toBe("absolute");
        expect(ring.styles.left).toBe("164px");
        expect(ring.styles.top).toBe("116px");
      }
    }
  });

  it("carries authored relative-position tokens beside the resolved offset", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "relative-expression",
      type: "frame",
      rect: { x: 20, y: 30, width: 120, height: 48 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      positioning: "relative",
      positionOffset: { left: -12, top: -8 },
      positionOffsetExpression: { right: "12px", bottom: "8px" },
      layout: emptyLayout(),
      children: [],
    }];
    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.left).toBe("-12px");
    expect(node.styles.top).toBe("-8px");
    expect(node.attributes["data-open-canvas-position-offset"]).toBe(JSON.stringify({ right: "12px", bottom: "8px" }));
  });

  it("retains the source sticky positioning beside a measured H2D snapshot", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "sticky-header",
      sourceTag: "HEADER",
      type: "frame",
      rect: { x: 0, y: 0, width: 430, height: 56 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      positioning: "sticky",
      computedStyles: { position: "sticky", top: "0px" },
      layout: { ...emptyLayout(), geometryLock: true },
      children: [],
    }];

    const node = toH2D(fixture).root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.attributes["data-open-canvas-positioning"]).toBe("sticky");
    expect(node.styles.position).toBe("sticky");
  });

  it("keeps later relative containers at captured flow coordinates after absolute siblings", () => {
    const fixture = documentFixture();
    fixture.root.children = [
      {
        id: "header",
        type: "frame",
        rect: { x: 0, y: 0, width: 375, height: 78 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        positioning: "absolute",
        layout: { ...emptyLayout(), mode: "horizontal" },
        children: [],
      },
      {
        id: "main",
        type: "frame",
        rect: { x: 0, y: 78, width: 375, height: 500 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        positioning: "relative",
        layout: { ...emptyLayout(), mode: "vertical" },
        children: [{
          id: "hero",
          type: "frame",
          rect: { x: 16, y: 85, width: 343, height: 222 },
          opacity: 1,
          radius: [16, 16, 16, 16],
          margin: [0, 0, 0, 0],
          layout: { ...emptyLayout(), geometryLock: true },
          children: [],
        }],
      },
    ];

    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const main = parsed.h2d.root.childNodes[1];
    expect(main.nodeType).toBe(1);
    if (main.nodeType === 1) {
      expect(main.styles.position).toBe("relative");
      expect(main.styles.left).toBeUndefined();
      expect(main.styles.top).toBeUndefined();
      const hero = main.childNodes[0];
      expect(hero.nodeType).toBe(1);
      if (hero.nodeType === 1) {
        expect(hero.styles.position).toBeUndefined();
        expect(hero.styles.left).toBeUndefined();
        expect(hero.styles.top).toBeUndefined();
      }
    }
  });

  it("uses the official URL-keyed asset table and inline SVG content", () => {
    const fixture = documentFixture();
    fixture.assets = [{ id: "asset-svg", kind: "svg", src: "inline:icon", data: "<svg />" }];
    fixture.root.children = [{
      id: "icon",
      type: "vector",
      assetId: "asset-svg",
      svg: "<svg viewBox=\"0 0 10 10\"></svg>",
      rect: { x: 4, y: 8, width: 10, height: 10 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
      children: [],
    }];
    const h2d = toH2D(fixture);
    expect(h2d.assets["inline:icon"].url).toBe("inline:icon");
    expect(h2d.root.childNodes[0]).toMatchObject({ content: '<svg viewBox="0 0 10 10"></svg>' });
    expect(h2d.root.childNodes[0]).not.toHaveProperty("assetId");
  });

  it("uses the official complete data URL form for embedded asset blobs", () => {
    const fixture = documentFixture();
    fixture.assets = [{
      id: "asset-image",
      kind: "image",
      src: "data:image/png;base64,AAAA",
      data: "data:image/png;base64,AAAA",
    }];

    const h2d = toH2D(fixture);
    expect(h2d.assets["data:image/png;base64,AAAA"].blob).toEqual({
      type: "image/png",
      base64Blob: "data:application/octet-stream;base64,AAAA",
    });
  });

  it("preserves layered shadows and background positioning", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "hero",
      type: "frame",
      rect: { x: 0, y: 0, width: 430, height: 180 },
      opacity: 1,
      fill: { color: "rgb(58, 0, 26)" },
      gradient: "linear-gradient(135deg, #3a001a, #6e2647)",
      shadow: { offsetX: 0, offsetY: 18, blur: 35, spread: 0, color: "rgba(58,0,26,.18)" },
      shadowCss: "0 18px 35px rgba(58,0,26,.18), 0 0 0 24px rgba(255,255,255,.04)",
      computedStyles: {
        clip: "rect(4px, 420px, 176px, 10px)",
        overflowClipMargin: "12px",
        overflowClipMarginBlockStart: "8px",
        overflowClipMarginInlineEnd: "16px",
      },
      backgroundSize: "cover",
      backgroundPosition: "center top",
      backgroundRepeat: "no-repeat",
      backgroundAttachment: "fixed",
      transform: "translate(2px, 3px)",
      zIndex: 2,
      radius: [20, 20, 20, 20],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const hero = parsed.h2d.root.childNodes[0];
    expect(hero.nodeType).toBe(1);
    if (hero.nodeType === 1) {
      expect(hero.styles.boxShadow).toContain(", 0 0 0 24px");
      expect(hero.styles.backgroundSize).toBe("cover");
      expect(hero.styles.backgroundPosition).toBe("center top");
      expect(hero.styles.backgroundAttachment).toBe("fixed");
      expect(hero.styles.clip).toBe("rect(4px, 420px, 176px, 10px)");
      expect(JSON.parse(hero.attributes["data-open-canvas-visual-constraints"])).toMatchObject({
        values: {
          clip: "rect(4px, 420px, 176px, 10px)",
          overflowClipMargin: "12px",
          overflowClipMarginBlockStart: "8px",
          overflowClipMarginInlineEnd: "16px",
        },
      });
      expect(hero.styles.transform).toBe("translate(2px, 3px)");
      expect(hero.styles.zIndex).toBe("2");
      expect(JSON.parse(hero.attributes["data-open-canvas-visual-constraints"])).toMatchObject({
        values: { backgroundAttachment: "fixed" },
        measuredGeometry: true,
      });
    }
  });

  it("preserves two-axis elliptical corner radii in the H2D replay styles", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "elliptical-card",
      type: "frame",
      rect: { x: 0, y: 0, width: 200, height: 100 },
      opacity: 1,
      radius: [25, 10, 0, 0],
      computedStyles: {
        display: "block",
        borderTopLeftRadius: "25px 40px",
        borderTopRightRadius: "10px 20px",
      },
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    }];

    const node = parseFigmaHtml(buildFigmaHtml(fixture)).h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType !== 1) return;
    expect(node.styles.borderTopLeftRadius).toBe("25px 40px");
    expect(node.styles.borderTopRightRadius).toBe("10px 20px");
  });

  it("bakes CSS filter opacity into H2D opacity without double-applying it", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "filtered-card",
      type: "frame",
      rect: { x: 0, y: 0, width: 120, height: 40 },
      opacity: 0.8,
      filter: "opacity(50%) blur(4px)",
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const node = parsed.h2d.root.childNodes[0];
    expect(node.nodeType).toBe(1);
    if (node.nodeType === 1) {
      expect(node.styles.opacity).toBe("0.4");
      expect(node.styles.filter).toBe("blur(4px)");
    }
  });

  it("keeps layered background images and asymmetric borders", () => {
    const fixture = documentFixture();
    fixture.root.children = [{
      id: "media",
      type: "image",
      rect: { x: 8, y: 8, width: 120, height: 80 },
      opacity: 1,
      backgroundImage: "url(https://example.com/cover.jpg)",
      objectFit: "cover",
      objectPosition: "25% 50%",
      objectViewBox: "inset(10% 20% 10% 20%)",
      borders: [
        { color: "rgb(255, 0, 0)", width: 1 },
        undefined,
        { color: "rgb(0, 0, 255)", width: 3 },
        undefined,
      ],
      radius: [4, 4, 4, 4],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    const media = parsed.h2d.root.childNodes[0];
    expect(media.nodeType).toBe(1);
    if (media.nodeType === 1) {
      expect(media.styles.backgroundImage).toBe("url(https://example.com/cover.jpg)");
      expect(media.styles.objectFit).toBe("cover");
      expect(media.styles.objectPosition).toBe("25% 50%");
      expect(media.styles.objectViewBox).toBe("inset(10% 20% 10% 20%)");
      expect(JSON.parse(media.attributes["data-open-canvas-visual-constraints"])).toMatchObject({
        values: {
          objectFit: "cover",
          objectPosition: "25% 50%",
          objectViewBox: "inset(10% 20% 10% 20%)",
        },
        measuredGeometry: true,
      });
      expect(media.styles.borderTopWidth).toBe("1px");
      expect(media.styles.borderRightWidth).toBeUndefined();
      expect(media.styles.borderBottomWidth).toBe("3px");
    }
  });

  it("rejects HTML without both markers", () => {
    expect(() => parseFigmaHtml("<p>plain html</p>")).toThrow(/markers are missing/);
  });
});
