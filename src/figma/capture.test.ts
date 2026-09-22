import { afterEach, describe, expect, it, vi } from "vitest";
import { backgroundSvgDataUrl, inlineSvgStyles, inlineTextRect, layoutFor, lockMeasuredGeometry, radiusFor, rectWithoutAxisTransform, renderedTextContent, renderedTextNodeContent, sanitizeSource, shadowFromStyle, shadowsFromStyle } from "./capture";
import { emptyLayout, type DesignNode } from "./designModel";

afterEach(() => vi.restoreAllMocks());

describe("HTML text capture", () => {
  afterEach(() => vi.restoreAllMocks());

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
    expect(atob(radial!.split(",", 2)[1])).toContain('<radialGradient id="gradient-0" color-interpolation="sRGB"');
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
});

describe("captured transform geometry", () => {
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
});

describe("captured flex sizing intent", () => {
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
});
