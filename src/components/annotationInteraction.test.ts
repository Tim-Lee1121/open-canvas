import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ANNOTATION_HOST_ID,
  ANNOTATION_MODE_ATTRIBUTE,
  installAnnotationInteraction,
  isAnnotationPickerActive,
  openAnnotationForElement,
  findAnnotationTarget,
} from "./annotationInteraction";

const originalElementsFromPointDescriptor = Object.getOwnPropertyDescriptor(document, "elementsFromPoint");
const interactionDisposers = new Set<() => void>();

function installTestInteraction() {
  const disposeInteraction = installAnnotationInteraction();
  const dispose = () => {
    interactionDisposers.delete(dispose);
    disposeInteraction();
  };
  interactionDisposers.add(dispose);
  return dispose;
}

afterEach(() => {
  interactionDisposers.forEach((dispose) => dispose());
  document.getElementById(ANNOTATION_HOST_ID)?.remove();
  document.body.replaceChildren();
  document.documentElement.removeAttribute(ANNOTATION_MODE_ATTRIBUTE);
  delete (document as Document & { openai?: unknown }).openai;
  if (originalElementsFromPointDescriptor) {
    Object.defineProperty(document, "elementsFromPoint", originalElementsFromPointDescriptor);
  } else {
    Reflect.deleteProperty(document, "elementsFromPoint");
  }
  vi.restoreAllMocks();
});

function buildSurface() {
  const surface = document.createElement("div");
  surface.setAttribute("data-codex-annotation-surface", "inline-html");
  surface.innerHTML = `<main><h1 data-openai-annotatable="true" data-openai-annotation-metadata='{"tag":"h1","text":"Heading"}' data-codex-annotation-target-id="target-heading">Heading</h1><button data-openai-annotatable="true" data-codex-annotation-metadata='{"tag":"button","text":"Continue"}' data-codex-annotation-target-id="target-button">Continue<span data-codex-annotation-hit="true" data-codex-annotation-proxy-for="target-button"></span></button></main>`;
  document.body.append(surface);
  return surface;
}

function pointer(): PointerEvent {
  // jsdom does not expose PointerEvent, but its MouseEvent carries the fields
  // used by the bridge and follows the same composed path for this test.
  return new MouseEvent("pointerdown", {
    bubbles: true,
    composed: true,
    cancelable: true,
    button: 0,
    clientX: 10,
    clientY: 10,
  }) as PointerEvent;
}

function setRect(element: Element, left: number, top: number, width: number, height: number) {
  Object.defineProperty(element, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      x: left,
      y: top,
      left,
      top,
      right: left + width,
      bottom: top + height,
      width,
      height,
      toJSON: () => undefined,
    }),
  });
}

function setPointStack(elements: Element[] | undefined) {
  Object.defineProperty(document, "elementsFromPoint", {
    configurable: true,
    value: elements === undefined ? undefined : vi.fn(() => elements),
  });
}

describe("annotation interaction bridge", () => {
  it("tracks the managed browser picker marker", () => {
    expect(isAnnotationPickerActive()).toBe(false);
    document.documentElement.setAttribute(ANNOTATION_MODE_ATTRIBUTE, "true");
    expect(isAnnotationPickerActive()).toBe(true);
    document.documentElement.removeAttribute(ANNOTATION_MODE_ATTRIBUTE);

    const host = document.createElement("div");
    host.id = ANNOTATION_HOST_ID;
    host.style.pointerEvents = "auto";
    document.documentElement.append(host);
    expect(isAnnotationPickerActive()).toBe(true);
  });

  it("resolves a transparent proxy to its generated target", () => {
    const surface = buildSurface();
    const proxy = surface.querySelector("[data-codex-annotation-hit]")!;
    const event = pointer();
    Object.defineProperty(event, "composedPath", { value: () => [proxy, surface, document.body, document.documentElement, document] });
    expect(findAnnotationTarget(event)?.target).toBe(surface.querySelector("button"));
  });

  it("uses the native annotations API when available", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    const open = vi.fn(() => true);
    Object.defineProperty(document, "openai", {
      configurable: true,
      value: { annotations: { open } },
    });

    expect(openAnnotationForElement(target)).toBe(true);
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ target }));
  });

  it("falls through when the native annotations API declines the request", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    const open = vi.fn(() => false);
    const listener = vi.fn((event: Event) => event.preventDefault());
    target.addEventListener("codex:open-annotation", listener);
    Object.defineProperty(document, "openai", {
      configurable: true,
      value: { annotations: { open } },
    });

    expect(openAnnotationForElement(target)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("falls through when the native annotations API returns void", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    const open = vi.fn();
    const listener = vi.fn((event: Event) => event.preventDefault());
    target.addEventListener("codex:open-annotation", listener);
    Object.defineProperty(document, "openai", {
      configurable: true,
      value: { annotations: { open } },
    });

    expect(openAnnotationForElement(target)).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("falls back to the codex open-annotation event", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    const listener = vi.fn((event: Event) => event.preventDefault());
    target.addEventListener("codex:open-annotation", listener);

    expect(openAnnotationForElement(target)).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect((listener.mock.calls[0]?.[0] as CustomEvent).detail.mode).toBe("default");
  });

  it("intercepts only generated targets while Annotation mode is active", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    const listener = vi.fn((event: Event) => event.preventDefault());
    target.addEventListener("codex:open-annotation", listener);
    const dispose = installTestInteraction();

    target.dispatchEvent(pointer());
    expect(listener).not.toHaveBeenCalled();

    document.documentElement.setAttribute(ANNOTATION_MODE_ATTRIBUTE, "true");
    const event = pointer();
    target.dispatchEvent(event);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    dispose();
  });

  it("keeps direct board chrome events instead of selecting a generated target underneath", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    setRect(target, 0, 0, 200, 80);
    const sidebar = document.createElement("aside");
    sidebar.id = "boards-sidebar";
    sidebar.className = "sidebar";
    const boardButton = document.createElement("button");
    boardButton.textContent = "Board";
    sidebar.append(boardButton);
    document.body.append(sidebar);
    setRect(sidebar, 0, 0, 240, 600);
    setRect(boardButton, 0, 0, 200, 80);
    setPointStack([boardButton, sidebar, target, surface]);

    const open = vi.fn(() => true);
    Object.defineProperty(document, "openai", {
      configurable: true,
      value: { annotations: { open } },
    });
    document.documentElement.setAttribute(ANNOTATION_MODE_ATTRIBUTE, "true");
    const dispose = installTestInteraction();
    const event = pointer();
    boardButton.dispatchEvent(event);

    expect(findAnnotationTarget(event)).toBeNull();
    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    dispose();
  });

  it.each([
    ["dialog", "dialog-backdrop", undefined],
    ["canvas toolbar", "canvas-toolbar", "true"],
    ["card toolbar", "page-card__canvas-toolbar", "true"],
  ])("does not cross visible %s chrome in the point stack", (_label, className, annotationChrome) => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    const chrome = document.createElement("div");
    chrome.className = className;
    if (annotationChrome) chrome.setAttribute("data-codex-annotation-chrome", annotationChrome);
    const control = document.createElement("button");
    chrome.append(control);
    document.body.append(chrome);
    setPointStack([control, chrome, target, surface]);

    const event = pointer();
    Object.defineProperty(event, "composedPath", {
      value: () => [control, chrome, document.body, document.documentElement, document],
    });
    expect(findAnnotationTarget(event)).toBeNull();
  });

  it("does not fall through an empty native point stack to geometry", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    setRect(target, 0, 0, 200, 80);
    setPointStack([]);

    expect(findAnnotationTarget(pointer())).toBeNull();
  });

  it.each(["toast", "canvas-toolbar", "dialog-backdrop", "mobile-topbar"])("keeps generated elements with the %s class annotatable", (className) => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    target.className = className;
    setRect(target, 0, 0, 200, 80);
    setPointStack([target, surface]);
    expect(findAnnotationTarget(pointer())?.target).toBe(target);
    setPointStack(undefined);
    expect(findAnnotationTarget(pointer())?.target).toBe(target);
  });

  it("resolves a pointer delivered through the browser interaction blocker", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    const open = vi.fn(() => true);
    Object.defineProperty(document, "openai", {
      configurable: true,
      value: { annotations: { open } },
    });
    const host = document.createElement("div");
    host.id = ANNOTATION_HOST_ID;
    host.style.pointerEvents = "auto";
    const shadow = host.attachShadow({ mode: "open" });
    const commentRoot = document.createElement("div");
    commentRoot.setAttribute("data-browser-comment-root", "true");
    commentRoot.style.pointerEvents = "all";
    const blocker = document.createElement("div");
    blocker.setAttribute("data-browser-comment-interaction-blocker", "true");
    blocker.style.pointerEvents = "auto";
    const interactionLayer = document.createElement("div");
    interactionLayer.setAttribute("data-browser-comment-interaction-layer", "true");
    interactionLayer.style.pointerEvents = "painted";
    commentRoot.append(blocker, interactionLayer);
    shadow.append(commentRoot);
    document.body.append(host);
    const overlayStylesDuringHitTest: string[] = [];
    Object.defineProperty(document, "elementsFromPoint", {
      configurable: true,
      value: vi.fn(() => {
        overlayStylesDuringHitTest.push(
          host.style.pointerEvents,
          commentRoot.style.pointerEvents,
          blocker.style.pointerEvents,
          interactionLayer.style.pointerEvents,
        );
        return [surface.querySelector("[data-codex-annotation-hit]")!];
      }),
    });
    document.documentElement.setAttribute(ANNOTATION_MODE_ATTRIBUTE, "true");
    const dispose = installTestInteraction();

    const event = new MouseEvent("pointerdown", { bubbles: true, composed: true, cancelable: true, button: 0, clientX: 10, clientY: 10 });
    blocker.dispatchEvent(event);

    expect(open).toHaveBeenCalledWith(expect.objectContaining({ target }));
    expect(event.defaultPrevented).toBe(true);
    expect(overlayStylesDuringHitTest).toEqual(["none", "none", "none", "none"]);
    expect(host.style.pointerEvents).toBe("auto");
    expect(commentRoot.style.pointerEvents).toBe("all");
    expect(blocker.style.pointerEvents).toBe("auto");
    expect(interactionLayer.style.pointerEvents).toBe("painted");
    dispose();
  });

  it("falls back to the smallest generated element when point hit-testing is unavailable", () => {
    const surface = buildSurface();
    const heading = surface.querySelector("h1") as HTMLElement;
    Object.defineProperty(document, "elementsFromPoint", { configurable: true, value: undefined });
    Object.defineProperty(heading, "getBoundingClientRect", {
      configurable: true,
      value: () => ({ left: 0, top: 0, right: 200, bottom: 40, width: 200, height: 40 }),
    });
    document.documentElement.setAttribute(ANNOTATION_MODE_ATTRIBUTE, "true");
    const event = pointer();
    expect(findAnnotationTarget(event)?.target).toBe(heading);
  });

  it("does not use geometry fallback through visible board chrome when point hit-testing is unavailable", () => {
    const surface = buildSurface();
    const target = surface.querySelector("button") as HTMLElement;
    setRect(target, 0, 0, 200, 80);
    const sidebar = document.createElement("aside");
    sidebar.id = "boards-sidebar";
    sidebar.className = "sidebar";
    document.body.append(sidebar);
    setRect(sidebar, 0, 0, 240, 600);
    setPointStack(undefined);

    expect(findAnnotationTarget(pointer())).toBeNull();
  });
});
