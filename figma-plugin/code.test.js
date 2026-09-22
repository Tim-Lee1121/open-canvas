import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";

function loadPluginFunctions() {
  const code = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "code.js"), "utf8");
  let imageSequence = 0;
  const context = {
    __html__: "",
    atob: globalThis.atob,
    btoa: globalThis.btoa,
    setTimeout: globalThis.setTimeout,
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
  const node = {
    type,
    name: "",
    children: [],
    parent: null,
    fills: [],
    strokes: [],
    effects: [],
    x: 0,
    y: 0,
    width: 1,
    height: 1,
    opacity: 1,
    layoutMode: "NONE",
    primaryAxisSizingMode: "FIXED",
    counterAxisSizingMode: "FIXED",
    layoutPositioning: "IN_FLOW",
    layoutSizingHorizontal: "FIXED",
    layoutSizingVertical: "FIXED",
    layoutAlign: "INHERIT",
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
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
  };
}

describe("Figma background paint order", () => {
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

  it("preserves CSS radial-gradient center positions", () => {
    const context = loadPluginFunctions();
    expect(context.radialGradientCenter("circle at 80% 15%")).toEqual({ x: 0.8, y: 0.15 });
    expect(context.radialGradientCenter("ellipse at right bottom")).toEqual({ x: 1, y: 1 });
    expect(context.radialGradientCenter("circle at left")).toEqual({ x: 0, y: 0.5 });

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

  it("does not report comma-separated normal blend modes as degradation", () => {
    const context = loadPluginFunctions();
    const report = importReport();
    context.recordSceneDegradations({
      id: "hero",
      computedStyles: { backgroundBlendMode: "normal, normal" },
      borders: [],
    }, report);
    expect(report.styleDegradations).toBe(0);
  });

  describe("shared scene geometry overlay", () => {
  it("uses free positioning for fully captured containers only", () => {
    const context = loadPluginFunctions();
    expect(context.capturedAbsoluteContainer({
      type: "frame",
      layout: { mode: "horizontal" },
      children: [
        { layout: { position: "absolute" } },
        { positioning: "fixed", layout: { position: "flow" } },
      ],
    })).toBe(true);
    expect(context.capturedAbsoluteContainer({
      type: "frame",
      layout: { mode: "vertical" },
      children: [{ layout: { position: "absolute" } }, { layout: { position: "flow" } }],
    })).toBe(false);
    expect(context.capturedAbsoluteContainer({
      type: "frame",
      layout: { mode: "vertical" },
      children: [{ layout: { geometryLock: true, position: "flow" } }],
    })).toBe(true);
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

    expect(imported.layoutMode).toBe("NONE");
    expect(imported.children[0]).toMatchObject({ x: 20, y: 30, width: 50, height: 20 });
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

  it("keeps alpha from modern slash-separated shadow colors", () => {
    const context = loadPluginFunctions();
    expect(context.cssShadow("0 4px 12px rgb(0 0 0 / 20%)")).toMatchObject({
      offsetX: 0,
      offsetY: 4,
      blur: 12,
      opacity: 0.2,
    });
  });

  it("renders non-solid borders as absolute side layers", () => {
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

  it("clears Figma's default text fill for transparent CSS text", () => {
    const context = loadPluginFunctions();
    const node = { type: "TEXT", fills: [{ type: "SOLID", color: { r: 0, g: 0, b: 0 } }] };
    context.visuals(node, { type: "text", opacity: 1, radius: [0, 0, 0, 0] });
    expect(node.fills).toEqual([]);
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
  });

  it("maps image brightness, contrast, and saturation to ImagePaint filters", () => {
    const context = loadPluginFunctions();
    expect(context.cssImageFilters("brightness(80%) contrast(120%) saturate(0.5)")).toEqual({
      exposure: -0.2,
      contrast: 0.2,
      saturation: -0.5,
    });
    expect(context.cssFilterHasUnsupportedParts("brightness(.8) contrast(1.2) saturate(.5)", true)).toBe(false);
    expect(context.cssFilterHasUnsupportedParts("brightness(.8) hue-rotate(20deg)", true)).toBe(true);
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

  it("resolves transform-origin keywords instead of treating them as center", () => {
    const context = loadPluginFunctions();
    expect(context.transformOrigin("left bottom", 200, 100)).toEqual({ x: 0, y: 100 });
    expect(context.transformOrigin("center top", 200, 100)).toEqual({ x: 100, y: 0 });
    });
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
      layout: { padding: [10, 20, 30, 40] },
    });
    expect(node.minWidth).toBe(170);
    expect(node.maxHeight).toBe(50);
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
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          positioning: "static",
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow", geometryLock: true },
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
    expect(importedChildren[0].x).toBe(18);
    expect(importedChildren[0].y).toBe(15);
    expect(importedChildren[1].fills).toEqual([{ type: "IMAGE", imageHash: "image-1", scaleMode: "CROP" }]);
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
