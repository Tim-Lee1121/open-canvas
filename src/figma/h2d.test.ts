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

  it("round-trips official metadata and H2D data", () => {
    const fixture = documentFixture();
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.metadata).toMatchObject({ dataType: "h2d", source: "open-canvas" });
    expect(parsed.metadata.capturedAtIso).toEqual(expect.any(String));
    expect(parsed.h2d.version).toBe(2);
    expect(parsed.h2d.root.styles.gap).toBe("12px");
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

  it("keeps capture viewport, DPR, resources, and fonts in figh2d", () => {
    const fixture = documentFixture();
    fixture.viewportRect = { x: 0, y: 0, width: 430, height: 680 };
    fixture.fonts = [{ family: "Noto Sans SC", weight: 500, size: 16 }];
    fixture.assets = [{ id: "asset-1", kind: "image", src: "https://example.test/image.png" }];
    const parsed = parseFigmaHtml(buildFigmaHtml(fixture));
    expect(parsed.metadata).toEqual({
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
    expect(content.rect.height).toBe(512.5);
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
    }
  });

  it("serializes direct mixed-content text runs as official H2D text nodes", () => {
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
    expect(text.text).toBe("可编辑标题");
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
      expect(cta.styles.position).toBeUndefined();
      expect(cta.styles.left).toBeUndefined();
      expect(cta.styles.top).toBeUndefined();
    }
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
      backgroundSize: "cover",
      backgroundPosition: "center top",
      backgroundRepeat: "no-repeat",
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
      expect(hero.styles.transform).toBe("translate(2px, 3px)");
      expect(hero.styles.zIndex).toBe("2");
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
      expect(media.styles.borderTopWidth).toBe("1px");
      expect(media.styles.borderRightWidth).toBeUndefined();
      expect(media.styles.borderBottomWidth).toBe("3px");
    }
  });

  it("rejects HTML without both markers", () => {
    expect(() => parseFigmaHtml("<p>plain html</p>")).toThrow(/markers are missing/);
  });
});
