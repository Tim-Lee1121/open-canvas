/**
 * Route a pointer in the board's generated HTML surface to Codex's native
 * browser-comments target.
 *
 * The browser normally derives the target from `elementFromPoint()`. A board
 * card has several layers around the generated screen (canvas transforms,
 * controls, and a preview frame), and some managed-browser builds resolve
 * that point to the card wrapper before the native annotation walk runs. The
 * site annotation API lets us pass the concrete generated element directly.
 * This bridge is active only while the browser comments picker is visible;
 * ordinary board interactions are unaffected.
 */

export const ANNOTATION_MODE_ATTRIBUTE = "data-codex-annotation-mode";
export const ANNOTATION_HOST_ID = "codex-browser-sidebar-comments-root";
export const ANNOTATION_PROXY_ATTRIBUTE = "data-codex-annotation-hit";
export const ANNOTATION_PROXY_FOR_ATTRIBUTE = "data-codex-annotation-proxy-for";
export const ANNOTATION_TARGET_ID_ATTRIBUTE = "data-codex-annotation-target-id";
export const ANNOTATION_NATIVE_ATTRIBUTE = "data-openai-annotatable";
export const ANNOTATION_METADATA_ATTRIBUTE = "data-openai-annotation-metadata";
export const ANNOTATION_CONTAINER_ATTRIBUTE = "data-openai-annotation-container";

const INLINE_SURFACE_SELECTOR = [
  '[data-codex-annotation-surface="inline-html"]',
  "[data-codex-inline-preview]",
  "[data-codex-inline-body]",
].join(",");

// These controls own their pointer even when a generated page is positioned
// underneath them. They must never become a route into that hidden page.
const BOARD_CHROME_SELECTOR = [
  "#boards-sidebar",
  ".sidebar-expand",
  ".sidebar-scrim",
  ".mobile-topbar",
  ".dialog-backdrop",
  ".canvas-toolbar",
  ".toast",
  "[data-codex-annotation-chrome]",
  ".page-preview__external",
  ".page-preview__badge",
].join(",");

interface AnnotationApi {
  open?: (options: { target: Element; metadata?: Record<string, string | boolean | number> }) => unknown;
}

interface AnnotationDocument extends Document {
  openai?: { annotations?: AnnotationApi };
}

interface TargetHit {
  target: HTMLElement;
  surface: Element;
}

function asElement(value: EventTarget | null): Element | null {
  if (!value || typeof value !== "object") return null;
  return "tagName" in value && typeof (value as Element).tagName === "string"
    ? value as Element
    : null;
}

function isBrowserInteractionLayer(value: EventTarget | null): boolean {
  const element = asElement(value);
  return Boolean(
    element?.hasAttribute("data-browser-comment-interaction-blocker")
      || element?.hasAttribute("data-browser-comment-interaction-layer"),
  );
}

function getHost(doc: Document): HTMLElement | null {
  const host = doc.getElementById(ANNOTATION_HOST_ID);
  return host instanceof HTMLElement ? host : null;
}

/** Whether the managed browser is currently accepting annotation pointers. */
export function isAnnotationPickerActive(doc: Document = document): boolean {
  if (doc.documentElement?.getAttribute(ANNOTATION_MODE_ATTRIBUTE) === "true") return true;
  const host = getHost(doc);
  return host?.style.pointerEvents.trim().toLowerCase() === "auto";
}

function getInlineSurface(element: Element, doc: Document): Element | null {
  const surface = element.closest(INLINE_SURFACE_SELECTOR);
  if (surface) return surface;
  // Standalone annotation documents carry the page metadata but do not use
  // the board's inline-surface attributes. Their body is the safe boundary.
  if (doc.querySelector('meta[name="codex-page-id"]')) {
    const body = doc.body;
    if (body?.hasAttribute(ANNOTATION_CONTAINER_ATTRIBUTE)) return body;
  }
  return null;
}

function isBoardChrome(element: Element): boolean {
  const chrome = element.closest(BOARD_CHROME_SELECTOR);
  if (!chrome) return false;
  // Generated HTML can legitimately use classes such as "toast" or
  // "canvas-toolbar". Its own content roots never become workbench chrome.
  if (chrome.closest("[data-codex-inline-preview], [data-codex-inline-body]")) return false;
  const surface = getInlineSurface(chrome, chrome.ownerDocument);
  // The PagePreview shell also contains our overlay buttons. Other inline
  // surfaces (including a standalone document body) contain generated UI.
  return !surface || (surface !== chrome.ownerDocument.body && surface.classList.contains("page-preview"));
}

function isPointInside(element: Element, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0
    && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function boardChromeCoversPoint(event: PointerEvent | MouseEvent, doc: Document): boolean {
  return Array.from(doc.querySelectorAll(BOARD_CHROME_SELECTOR)).some((element) => {
    if (!isBoardChrome(element)) return false;
    if (element.closest("[inert]") || !isPointInside(element, event.clientX, event.clientY)) return false;
    const style = doc.defaultView?.getComputedStyle(element);
    return style?.display !== "none" && style?.visibility !== "hidden" && style?.pointerEvents !== "none";
  });
}

function findTargetById(id: string, surface: Element): HTMLElement | null {
  const candidates = surface.querySelectorAll<HTMLElement>(`[${ANNOTATION_TARGET_ID_ATTRIBUTE}]`);
  for (const candidate of Array.from(candidates)) {
    if (candidate.getAttribute(ANNOTATION_TARGET_ID_ATTRIBUTE) === id) return candidate;
  }
  return null;
}

function resolveTarget(element: Element, surface: Element): HTMLElement | null {
  if (element.hasAttribute(ANNOTATION_PROXY_ATTRIBUTE)) {
    const id = element.getAttribute(ANNOTATION_PROXY_FOR_ATTRIBUTE);
    if (id) return findTargetById(id, surface);
    return element.parentElement instanceof HTMLElement ? element.parentElement : null;
  }

  let current: Element | null = element;
  while (current && current !== surface.parentElement) {
    if (
      current instanceof HTMLElement
      && current.hasAttribute(ANNOTATION_NATIVE_ATTRIBUTE)
      && !current.hasAttribute(ANNOTATION_CONTAINER_ATTRIBUTE)
    ) {
      return current;
    }
    if (current === surface) break;
    current = current.parentElement;
  }
  return null;
}

function metadataFor(target: HTMLElement): Record<string, string | boolean | number> | undefined {
  const raw = target.getAttribute(ANNOTATION_METADATA_ATTRIBUTE);
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const result: Record<string, string | boolean | number> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!/^[A-Za-z][A-Za-z0-9_-]*(?: [A-Za-z0-9_-]+)*$/.test(key)) continue;
      if (
        typeof value === "string"
        || typeof value === "boolean"
        || (typeof value === "number" && Number.isFinite(value))
      ) {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : undefined;
  } catch {
    return undefined;
  }
}

function temporarilyDisableBrowserOverlay(doc: Document): () => void {
  const selectors = [
    "[data-browser-comment-root]",
    "[data-browser-comment-interaction-blocker]",
    "[data-browser-comment-interaction-layer]",
  ];
  const host = getHost(doc);
  const elementSet = new Set<HTMLElement>();
  if (host) elementSet.add(host);
  for (const selector of selectors) {
    doc.querySelectorAll<HTMLElement>(selector).forEach((element) => elementSet.add(element));
    host?.shadowRoot?.querySelectorAll<HTMLElement>(selector).forEach((element) => elementSet.add(element));
  }
  const elements = Array.from(elementSet);
  const previous = elements.map((element) => element.style.pointerEvents);
  elements.forEach((element) => { element.style.pointerEvents = "none"; });
  return () => elements.forEach((element, index) => { element.style.pointerEvents = previous[index] ?? ""; });
}

function hitFromCandidates(candidates: Element[], doc: Document): TargetHit | null {
  for (const candidate of candidates) {
    const surface = getInlineSurface(candidate, doc);
    if (!surface) continue;
    const target = resolveTarget(candidate, surface);
    if (target) return { target, surface };
  }
  return null;
}

function hitFromGeometry(event: PointerEvent | MouseEvent, doc: Document, boundary?: Element): TargetHit | null {
  let best: { hit: TargetHit; area: number; depth: number } | null = null;
  const surfaces = Array.from(doc.querySelectorAll<Element>(INLINE_SURFACE_SELECTOR));
  for (const surface of surfaces) {
    if (boundary && surface !== boundary && !boundary.contains(surface)) continue;
    const candidates = Array.from(surface.querySelectorAll<HTMLElement>(
      `[${ANNOTATION_NATIVE_ATTRIBUTE}]`,
    ));
    for (const target of candidates) {
      if (target.hasAttribute(ANNOTATION_CONTAINER_ATTRIBUTE)) continue;
      const rect = target.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) continue;
      let depth = 0;
      for (let current: Element | null = target; current && current !== surface; current = current.parentElement) depth += 1;
      const area = rect.width * rect.height;
      if (!best || area < best.area || (area === best.area && depth > best.depth)) {
        best = { hit: { target, surface }, area, depth };
      }
    }
  }
  return best?.hit ?? null;
}

/** Resolve the concrete generated node underneath a browser pointer event. */
export function findAnnotationTarget(event: PointerEvent | MouseEvent, doc: Document = document): TargetHit | null {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
  const elements = path.map(asElement).filter((value): value is Element => value !== null);
  if (elements.some(isBoardChrome)) return null;
  const fromPath = hitFromCandidates(elements, doc);
  if (fromPath) return fromPath;

  const view = doc.defaultView;
  if (!view) return null;
  const restoreOverlay = temporarilyDisableBrowserOverlay(doc);
  try {
    if (typeof doc.elementsFromPoint === "function") {
      // Native hit testing is ordered front to back. Only the frontmost
      // element can authorize a generated target; scanning the full stack
      // would look through the floating sidebar, dialogs, or another page.
      const front = doc.elementsFromPoint(event.clientX, event.clientY)[0];
      if (!front || isBoardChrome(front)) return null;
      const pointHit = hitFromCandidates([front], doc);
      if (pointHit) return pointHit;

      // Some browser builds report a preview wrapper. A geometry fallback is
      // valid inside that same preview, never in a different page behind it.
      const boundary = getInlineSurface(front, doc) ?? front.closest(".page-card");
      return boundary ? hitFromGeometry(event, doc, boundary) : null;
    }
    // Older browser builds without point hit-testing still need the fallback,
    // but visible board chrome remains an occlusion boundary in this path.
    return boardChromeCoversPoint(event, doc) ? null : hitFromGeometry(event, doc);
  } finally {
    restoreOverlay();
  }
}

/**
 * Ask the browser-comments runtime to open an annotation for `target`.
 * Returns true only when a runtime listener accepted the request.
 */
export function openAnnotationForElement(target: HTMLElement, doc: Document = document): boolean {
  const metadata = metadataFor(target);
  const annotationApi = (doc as AnnotationDocument).openai?.annotations;
  if (annotationApi?.open) {
    try {
      // `open()` dispatches the same cancelable site event used by the native
      // runtime, while preserving the current user-activation gesture.
      // The managed browser returns `true` when its listener accepts the
      // annotation request (the API implementation is `!dispatchEvent(...)`).
      // The injected API returns `!target.dispatchEvent(...)`, so only an
      // explicit `true` means the browser runtime accepted the request.
      const accepted = annotationApi.open.call(annotationApi, { target, ...(metadata ? { metadata } : {}) });
      if (accepted === true) return true;
    } catch {
      // A browser may expose a partial API while its comments runtime is
      // still starting. Fall through to the event form below.
    }
  }

  const event = new CustomEvent("codex:open-annotation", {
    bubbles: true,
    cancelable: true,
    composed: true,
    detail: { mode: "default", enterAnnotationMode: false, ...(metadata ? { metadata } : {}) },
  });
  return !target.dispatchEvent(event);
}

/** Install the direct target bridge on the board's top-level document. */
export function installAnnotationInteraction(doc: Document = document): () => void {
  const view = doc.defaultView;
  if (!view) return () => undefined;

  let lastHandledAt = 0;
  let lastX = -1;
  let lastY = -1;
  const handlePointer = (event: PointerEvent | MouseEvent) => {
    if (!isAnnotationPickerActive(doc) || event.button !== 0) return;
    const source = asElement(event.target);
    const path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    const fromInteractionLayer = path.some(isBrowserInteractionLayer);
    // The comments runtime's interaction blocker lives in an open shadow root
    // attached to the host. Window-capture still sees those events, allowing
    // us to resolve the underlying page after temporarily disabling the host.
    // Events from the sidebar/editor itself must remain owned by the browser.
    if (source?.closest(`#${ANNOTATION_HOST_ID}, [data-browser-comment-root]`) && !fromInteractionLayer) return;
    if (source?.closest("[data-browser-comment-interaction-blocker]") && !fromInteractionLayer) return;
    const hit = findAnnotationTarget(event, doc);
    if (!hit) return;

    // Pointer and mouse events for one gesture can both reach this bridge.
    // Avoid opening two editors for the same activation.
    const now = Date.now();
    if (now - lastHandledAt < 500 && Math.abs(event.clientX - lastX) < 4 && Math.abs(event.clientY - lastY) < 4) return;
    if (!openAnnotationForElement(hit.target, doc)) return;

    lastHandledAt = now;
    lastX = event.clientX;
    lastY = event.clientY;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };

  view.addEventListener("pointerdown", handlePointer, true);
  // A few managed-browser releases expose mouse events without PointerEvent
  // on the embedded page. Keep the fallback listener cheap and idempotent.
  view.addEventListener("mousedown", handlePointer, true);
  return () => {
    view.removeEventListener("pointerdown", handlePointer, true);
    view.removeEventListener("mousedown", handlePointer, true);
  };
}
