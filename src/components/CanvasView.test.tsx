import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "../test/fixtures";
import { CanvasView } from "./CanvasView";

afterEach(cleanup);

afterEach(() => {
  vi.restoreAllMocks();
});

interface ViewportMetrics {
  width: number;
  height: number;
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function mockViewportMetrics(metrics: ViewportMetrics) {
  const originalGetComputedStyle = window.getComputedStyle.bind(window);
  vi.spyOn(window, "getComputedStyle").mockImplementation((element, pseudoElement) => {
    const computed = originalGetComputedStyle(element, pseudoElement);
    if (!(element instanceof HTMLElement) || !element.classList.contains("canvas-viewport")) return computed;
    const values: Partial<Record<keyof CSSStyleDeclaration, string>> = {
      scrollPaddingTop: `${metrics.top}px`,
      scrollPaddingRight: `${metrics.right}px`,
      scrollPaddingBottom: `${metrics.bottom}px`,
      scrollPaddingLeft: `${metrics.left}px`,
    };
    return new Proxy(computed, {
      get(target, property) {
        if (typeof property === "string" && property in values) return values[property as keyof CSSStyleDeclaration];
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  });

  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function getBoundingClientRect(this: HTMLElement) {
    if (!this.classList.contains("canvas-viewport")) return originalGetBoundingClientRect.call(this);
    return {
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: metrics.width,
      bottom: metrics.height,
      width: metrics.width,
      height: metrics.height,
      toJSON: () => undefined,
    };
  });
}

function mockCanvasToolbarWidth(width: number) {
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth")?.get;
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function offsetWidth(this: HTMLElement) {
    if (this.classList.contains("page-card__canvas-toolbar")) return width;
    return originalOffsetWidth?.call(this) ?? 0;
  });
}

function readCanvasTransform() {
  const transform = document.querySelector<HTMLElement>(".canvas-space")?.style.transform ?? "";
  const match = /^translate\(([-\d.]+)px, ([-\d.]+)px\) scale\(([-\d.]+)\)$/.exec(transform);
  if (!match) throw new Error(`Unexpected canvas transform: ${transform}`);
  return { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
}

function firePointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  init: { pointerId: number; clientX: number; clientY: number; button?: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: init.button ?? 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(element, event);
}

describe("CanvasView", () => {
  it("resets the session viewport when the active board changes", () => {
    const seed = createSeedState();
    const firstPage = seed.pagesById["page-demo-welcome"];
    const secondPage = seed.pagesById["page-demo-checkout"];

    const { rerender } = render(
      <CanvasView pages={[firstPage]} boards={seed.boards} activeBoardId={firstPage.boardId} />,
    );

    expect(screen.getByText("80%")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("90%")).toBeInTheDocument();

    rerender(
      <CanvasView pages={[secondPage]} boards={seed.boards} activeBoardId={secondPage.boardId} />,
    );

    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("routes page-zoom gestures to the canvas even when they start outside it", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    render(<CanvasView pages={[page]} activeBoardId={page.boardId} />);

    const pinch = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -120,
    });
    fireEvent(document.body, pinch);
    expect(pinch.defaultPrevented).toBe(true);
    expect(screen.getByText("86%")).toBeInTheDocument();

    fireEvent.keyDown(document.body, { key: "+", metaKey: true });
    expect(screen.getByText("96%")).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: "0", metaKey: true });
    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("dampens high-frequency Magic Mouse wheel deltas", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    render(<CanvasView pages={[page]} activeBoardId={page.boardId} />);
    const viewport = document.querySelector<HTMLElement>(".canvas-viewport")!;

    // A smooth two-finger swipe is reported as many small pixel deltas. The
    // accumulated movement should produce a measured change, not one full
    // zoom step for every browser event.
    for (let count = 0; count < 20; count += 1) {
      fireEvent.wheel(viewport, { deltaY: -4, deltaMode: 0 });
    }
    expect(screen.getByText("84%")).toBeInTheDocument();

    // Accelerated hardware events are capped as well.
    fireEvent.wheel(viewport, { deltaY: -1_200, deltaMode: 0 });
    expect(screen.getByText("108%")).toBeInTheDocument();
  });

  it("exposes selected-page canvas actions without starting a canvas drag", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    const onEditPage = vi.fn();
    const onDeletePage = vi.fn();
    const onMovePage = vi.fn();

    render(
      <CanvasView
        pages={[page]}
        boards={seed.boards}
        activeBoardId={page.boardId}
        selectedPageId={page.id}
        onEditPage={onEditPage}
        onDeletePage={onDeletePage}
        onMovePage={onMovePage}
      />,
    );

    expect(screen.getByRole("toolbar", { name: "Canvas controls for Welcome concept" })).toBeInTheDocument();
    const pageTitle = screen.getByRole("button", { name: page.title });
    expect(pageTitle).toHaveClass("page-name");
    expect(pageTitle.closest("header")).toBeNull();
    expect(pageTitle.closest(".page-card")).toBeNull();
    expect(pageTitle.parentElement).toHaveClass("canvas-page");
    expect(document.querySelector(".page-card--canvas .page-card__header")).toBeNull();
    const canvasPage = document.querySelector(".canvas-page") as HTMLElement;
    fireEvent.click(screen.getByTitle("Device size"));
    expect(screen.getByRole("menuitem", { name: "1440 × 900" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "1920 × 1080" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "1440 × 900" }));
    expect(within(screen.getByRole("toolbar", { name: "Canvas controls for Welcome concept" })).getByText("1440 × 900", { selector: "span" })).toBeInTheDocument();
    expect(canvasPage?.style.width ?? "").toBe("1440px");
    expect(canvasPage?.style.height ?? "").toBe("900px");
    fireEvent.click(screen.getByTitle("Device size"));
    expect(screen.getByRole("menuitem", { name: "390 × 844" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("menuitem", { name: "390 × 844" }));
    expect(within(screen.getByRole("toolbar", { name: "Canvas controls for Welcome concept" })).getByText("390 × 844", { selector: "span" })).toBeInTheDocument();
    // The HTML card has no semantic role, so browser Annotation mode can keep
    // walking to the generated descendants.
    const pageCardElement = document.querySelector<HTMLElement>('[data-page-id="page-demo-welcome"]');
    expect(pageCardElement).not.toBeNull();
    const pageCard = pageCardElement as HTMLElement;
    expect(canvasPage.style.width).toBe("390px");
    expect(canvasPage.style.height).toBe("844px");
    expect(pageCard.style.getPropertyValue("--device-width")).toBe("390px");
    expect(pageCard.style.getPropertyValue("--device-height")).toBe("844px");

    fireEvent.click(screen.getByTitle("Device size"));
    const widthInput = screen.getByRole("textbox", { name: "Canvas width" });
    const heightInput = screen.getByRole("textbox", { name: "Canvas height" });
    expect(widthInput).not.toHaveAttribute("max");
    expect(heightInput).not.toHaveAttribute("max");
    fireEvent.change(widthInput, { target: { value: "1440" } });
    fireEvent.change(heightInput, { target: { value: "3200" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply custom canvas size" }));
    expect(within(screen.getByRole("toolbar", { name: "Canvas controls for Welcome concept" })).getByText("1440 × 3200", { selector: "span" })).toBeInTheDocument();
    expect(canvasPage.style.width).toBe("1440px");
    expect(canvasPage.style.height).toBe("3200px");
    expect(pageCard.style.getPropertyValue("--device-width")).toBe("1440px");
    expect(pageCard.style.getPropertyValue("--device-height")).toBe("3200px");

    fireEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onEditPage).toHaveBeenCalledWith(page);
    expect(onDeletePage).toHaveBeenCalledWith(page.id);

    fireEvent.click(screen.getByText("Move to", { selector: "summary" }));
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Canvas controls for Welcome concept" })).getByRole("menuitem", { name: "Review queue" }));
    expect(onMovePage).toHaveBeenCalledWith(page.id, "board-demo-review");
  });

  it("selects a canvas page when a header drag starts", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    const onSelectPage = vi.fn();
    render(
      <CanvasView
        pages={[page]}
        activeBoardId={page.boardId}
        onSelectPage={onSelectPage}
      />,
    );

    const title = screen.getByRole("button", { name: page.title });
    firePointer(title, "pointerdown", { pointerId: 8, clientX: 80, clientY: 40 });
    expect(onSelectPage).toHaveBeenCalledWith(page.id);

    document.documentElement.setAttribute("data-codex-annotation-mode", "true");
    firePointer(title, "pointerdown", { pointerId: 9, clientX: 80, clientY: 40 });
    document.documentElement.removeAttribute("data-codex-annotation-mode");
    expect(onSelectPage).toHaveBeenCalledTimes(1);
  });

  it("allows a page to be dragged left and above the canvas origin", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    const onUpdateCanvasPosition = vi.fn();
    render(
      <CanvasView
        pages={[page]}
        activeBoardId={page.boardId}
        onUpdateCanvasPosition={onUpdateCanvasPosition}
      />,
    );

    const title = screen.getByRole("button", { name: page.title });
    const viewport = document.querySelector<HTMLElement>(".canvas-viewport")!;
    firePointer(title, "pointerdown", { pointerId: 12, clientX: 200, clientY: 200 });
    firePointer(viewport, "pointermove", { pointerId: 12, clientX: 120, clientY: 120 });
    firePointer(viewport, "pointerup", { pointerId: 12, clientX: 120, clientY: 120 });

    expect(onUpdateCanvasPosition).toHaveBeenCalledWith(page.id, { x: -68, y: -68 });
  });

  it("frames the first pages inside the floating shell safe area", () => {
    mockViewportMetrics({ width: 1200, height: 800, top: 0, right: 0, bottom: 80, left: 320 });
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];

    render(<CanvasView pages={[page]} boards={seed.boards} activeBoardId={page.boardId} />);

    const { panX, panY, zoom } = readCanvasTransform();
    expect(zoom).toBe(0.8);
    // Page x=32 aligns at safe-left + 40; its fixed-size toolbar/title chrome
    // starts at safe-top + 40.
    expect(panX + page.canvasPosition.x * zoom).toBeCloseTo(360);
    expect(panY + page.canvasPosition.y * zoom - 102).toBeCloseTo(40);
  });

  it("frames the first Codex page when an empty canvas becomes non-empty", () => {
    mockViewportMetrics({ width: 430, height: 800, top: 64, right: 0, bottom: 80, left: 0 });
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    const { rerender } = render(
      <CanvasView pages={[]} boards={seed.boards} activeBoardId={page.boardId} />,
    );
    expect(screen.getByText("Canvas is ready")).toBeInTheDocument();

    rerender(<CanvasView pages={[page]} boards={seed.boards} activeBoardId={page.boardId} />);

    const { panX, panY, zoom } = readCanvasTransform();
    expect(panX + page.canvasPosition.x * zoom).toBeCloseTo(40);
    expect(panY + page.canvasPosition.y * zoom - 102).toBeCloseTo(104);
  });

  it("fits all pages within the computed safe area using the rendered zoom", () => {
    const metrics = { width: 1200, height: 800, top: 0, right: 0, bottom: 80, left: 320 };
    mockViewportMetrics(metrics);
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    render(<CanvasView pages={[page]} boards={seed.boards} activeBoardId={page.boardId} />);

    fireEvent.click(screen.getByRole("button", { name: "Fit all pages" }));

    const { panX, panY, zoom } = readCanvasTransform();
    const contentLeft = panX + page.canvasPosition.x * zoom;
    const contentTop = panY + page.canvasPosition.y * zoom - 102;
    const contentRight = panX + (page.canvasPosition.x + 375) * zoom;
    const contentBottom = panY + (page.canvasPosition.y + 980) * zoom;
    expect(zoom).toBe(0.54);
    expect(contentLeft).toBeGreaterThanOrEqual(metrics.left + 40);
    expect(contentTop).toBeGreaterThanOrEqual(metrics.top + 40);
    expect(contentRight).toBeLessThanOrEqual(metrics.width - metrics.right - 40);
    expect(contentBottom).toBeLessThanOrEqual(metrics.height - metrics.bottom - 40);
  });

  it("shifts a wide page toolbar clear of the floating sidebar", () => {
    const metrics = { width: 1131, height: 800, top: 0, right: 0, bottom: 80, left: 384 };
    const toolbarWidth = 653;
    mockViewportMetrics(metrics);
    mockCanvasToolbarWidth(toolbarWidth);
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    render(
      <CanvasView
        pages={[page]}
        boards={seed.boards}
        activeBoardId={page.boardId}
        selectedPageId={page.id}
      />,
    );

    const pageElement = document.querySelector<HTMLElement>("[data-canvas-page-id]");
    expect(pageElement).not.toBeNull();
    const { panX, zoom } = readCanvasTransform();
    const shift = Number.parseFloat(pageElement?.style.getPropertyValue("--canvas-toolbar-shift-x") ?? "");
    const toolbarLeft = panX
      + (page.canvasPosition.x + 375 / 2) * zoom
      + shift * zoom
      - toolbarWidth / 2;
    expect(toolbarLeft).toBeCloseTo(metrics.left + 12);
    expect(pageElement?.style.getPropertyValue("--canvas-zoom")).toBe("0.8");
    expect(pageElement?.style.getPropertyValue("--canvas-chrome-scale")).toBe("1.25");
    expect(pageElement?.style.getPropertyValue("--canvas-page-title-gap")).toBe("12.5px");
    expect(pageElement?.style.getPropertyValue("--canvas-page-title-height")).toBe("27.5px");
    expect(pageElement?.style.getPropertyValue("--canvas-toolbar-gap")).toBe("15px");
    expect(Number.parseFloat(pageElement?.style.getPropertyValue("--canvas-toolbar-max-width") ?? ""))
      .toBeCloseTo(metrics.width - metrics.left - metrics.right - 24);
    expect(pageElement?.style.left).toBe(`${page.canvasPosition.x}px`);
    expect(pageElement?.style.top).toBe(`${page.canvasPosition.y}px`);
  });

  it("clears selection only for a primary click that starts on canvas whitespace", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    const onClearSelection = vi.fn();
    render(
      <CanvasView
        pages={[page]}
        activeBoardId={page.boardId}
        selectedPageId={page.id}
        onClearSelection={onClearSelection}
      />,
    );
    const viewport = document.querySelector<HTMLElement>(".canvas-viewport")!;

    firePointer(viewport, "pointerdown", { pointerId: 1, clientX: 12, clientY: 12 });
    firePointer(viewport, "pointerup", { pointerId: 1, clientX: 12, clientY: 12 });
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    const pageElement = document.querySelector<HTMLElement>("[data-canvas-page-id]")!;
    firePointer(pageElement, "pointerdown", { pointerId: 2, clientX: 60, clientY: 60 });
    firePointer(pageElement, "pointerup", { pointerId: 2, clientX: 60, clientY: 60 });
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    document.documentElement.setAttribute("data-codex-annotation-mode", "true");
    firePointer(viewport, "pointerdown", { pointerId: 3, clientX: 12, clientY: 12 });
    firePointer(viewport, "pointerup", { pointerId: 3, clientX: 12, clientY: 12 });
    document.documentElement.removeAttribute("data-codex-annotation-mode");
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it("does not clear after crossing the pan threshold or cancelling the gesture", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    const onClearSelection = vi.fn();
    render(
      <CanvasView pages={[page]} activeBoardId={page.boardId} onClearSelection={onClearSelection} />,
    );
    const viewport = document.querySelector<HTMLElement>(".canvas-viewport")!;

    firePointer(viewport, "pointerdown", { pointerId: 4, clientX: 20, clientY: 20 });
    firePointer(viewport, "pointermove", { pointerId: 4, clientX: 25, clientY: 20 });
    firePointer(viewport, "pointermove", { pointerId: 4, clientX: 20, clientY: 20 });
    firePointer(viewport, "pointerup", { pointerId: 4, clientX: 20, clientY: 20 });
    expect(onClearSelection).not.toHaveBeenCalled();

    firePointer(viewport, "pointerdown", { pointerId: 5, clientX: 20, clientY: 20 });
    firePointer(viewport, "pointercancel", { pointerId: 5, clientX: 20, clientY: 20 });
    expect(onClearSelection).not.toHaveBeenCalled();

    firePointer(viewport, "pointerdown", { pointerId: 6, clientX: 20, clientY: 20 });
    firePointer(viewport, "pointerup", { pointerId: 6, clientX: 40, clientY: 20 });
    expect(onClearSelection).not.toHaveBeenCalled();
  });

  it("keeps the dot-grid variables in sync with canvas pan and zoom", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    render(<CanvasView pages={[page]} activeBoardId={page.boardId} />);
    const viewport = document.querySelector<HTMLElement>(".canvas-viewport")!;
    const initial = readCanvasTransform();
    expect(viewport.style.getPropertyValue("--canvas-grid-size")).toBe("25.6px");
    expect(viewport.style.getPropertyValue("--canvas-grid-dot-color")).toBe("#C6C6CB");
    expect(viewport.style.getPropertyValue("--canvas-grid-x")).toBe(`${initial.panX}px`);
    expect(viewport.style.getPropertyValue("--canvas-grid-y")).toBe(`${initial.panY}px`);

    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(viewport.style.getPropertyValue("--canvas-grid-size")).toBe("28.8px");
    const pageElement = document.querySelector<HTMLElement>("[data-canvas-page-id]")!;
    expect(Number.parseFloat(pageElement.style.getPropertyValue("--canvas-chrome-scale"))).toBeCloseTo(1 / 0.9);
    expect(pageElement.style.getPropertyValue("--canvas-overlay-scale")).toBe("1");

    for (let count = 0; count < 8; count += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    }
    expect(screen.getByText("10%")).toBeInTheDocument();
    expect(viewport.style.getPropertyValue("--canvas-grid-dot-color")).toBe("rgba(198, 198, 203, 0)");

    firePointer(viewport, "pointerdown", { pointerId: 7, clientX: 10, clientY: 10 });
    firePointer(viewport, "pointermove", { pointerId: 7, clientX: 30, clientY: 25 });
    expect(viewport.style.getPropertyValue("--canvas-grid-x")).toBe(`${initial.panX + 20}px`);
    expect(viewport.style.getPropertyValue("--canvas-grid-y")).toBe(`${initial.panY + 15}px`);
    firePointer(viewport, "pointerup", { pointerId: 7, clientX: 30, clientY: 25 });
  });

  it("shows a canvas overview during zoom and tracks the safe visible area", () => {
    const metrics = { width: 1200, height: 800, top: 0, right: 0, bottom: 80, left: 320 };
    mockViewportMetrics(metrics);
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    render(<CanvasView pages={[page]} activeBoardId={page.boardId} selectedPageId={page.id} />);
    expect(screen.queryByLabelText("Canvas overview")).not.toBeInTheDocument();

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
      const overview = screen.getByLabelText("Canvas overview");
      const pageOutline = overview.querySelector<HTMLElement>(".canvas-minimap__item--page")!;
      const visibleOutline = screen.getByLabelText("Visible area");
      expect(pageOutline).toHaveClass("is-selected");
      expect(Number.parseFloat(visibleOutline.style.width)).toBeGreaterThan(Number.parseFloat(pageOutline.style.width));
      const relativeLeft = Number.parseFloat(pageOutline.style.left) - Number.parseFloat(visibleOutline.style.left);

      const viewport = document.querySelector<HTMLElement>(".canvas-viewport")!;
      firePointer(viewport, "pointerdown", { pointerId: 19, clientX: 20, clientY: 20 });
      firePointer(viewport, "pointermove", { pointerId: 19, clientX: 120, clientY: 20 });
      expect(Number.parseFloat(pageOutline.style.left) - Number.parseFloat(visibleOutline.style.left)).toBeGreaterThan(relativeLeft);
      firePointer(viewport, "pointerup", { pointerId: 19, clientX: 120, clientY: 20 });

      fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
      act(() => vi.advanceTimersByTime(1799));
      expect(screen.getByLabelText("Canvas overview")).toBeInTheDocument();
      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByLabelText("Canvas overview")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("caps page chrome at its 100% visual size when zooming in", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    render(<CanvasView pages={[page]} activeBoardId={page.boardId} selectedPageId={page.id} />);
    const pageElement = document.querySelector<HTMLElement>("[data-canvas-page-id]")!;

    for (let count = 0; count < 7; count += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    }

    expect(screen.getByText("145%")).toBeInTheDocument();
    expect(Number.parseFloat(pageElement.style.getPropertyValue("--canvas-overlay-scale"))).toBeCloseTo(1 / 1.45);
    expect(Number.parseFloat(pageElement.style.getPropertyValue("--canvas-card-chrome-gap"))).toBeCloseTo(8 / 1.45);
    expect(Number.parseFloat(pageElement.style.getPropertyValue("--canvas-preview-chrome-gap"))).toBeCloseTo(10 / 1.45);
    expect(Number.parseFloat(pageElement.style.getPropertyValue("--canvas-selection-ring"))).toBeCloseTo(2 / 1.45);
  });

  it("remeasures a changed layout inset without resetting pan or zoom", () => {
    const metrics = { width: 1131, height: 800, top: 0, right: 0, bottom: 80, left: 384 };
    mockViewportMetrics(metrics);
    mockCanvasToolbarWidth(653);
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    const pages = [page];
    const { rerender } = render(
      <CanvasView pages={pages} activeBoardId={page.boardId} layoutInsetKey={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    const before = document.querySelector<HTMLElement>(".canvas-space")?.style.transform;

    metrics.left = 0;
    rerender(<CanvasView pages={pages} activeBoardId={page.boardId} layoutInsetKey />);

    expect(document.querySelector<HTMLElement>(".canvas-space")?.style.transform).toBe(before);
    const pageElement = document.querySelector<HTMLElement>("[data-canvas-page-id]")!;
    expect(Number.parseFloat(pageElement.style.getPropertyValue("--canvas-toolbar-max-width")))
      .toBeCloseTo(metrics.width - 24);
  });
});
