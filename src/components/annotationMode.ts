/**
 * Mirror the managed browser's Annotation picker state onto the document.
 *
 * Dia mounts its comments runtime as a fixed host and toggles that host's
 * `pointer-events` value while the picker is active. The picker temporarily
 * changes the value back to `none` while it samples the page, so CSS cannot
 * reliably key off the host style directly. Keeping a document-level marker
 * lets the board hide its own chrome for the duration of that synchronous
 * sample without affecting ordinary browse mode.
 */
const COMMENTS_HOST_ID = "codex-browser-sidebar-comments-root";
const MODE_ATTRIBUTE = "data-codex-annotation-mode";

function isPickerHost(element: Element | null): element is HTMLElement {
  return Boolean(element && "style" in element);
}

function isPickerActive(host: HTMLElement | null): boolean {
  return host?.style.pointerEvents.trim().toLowerCase() === "auto";
}

/**
 * Install a lightweight marker bridge. The returned disposer restores the
 * document attribute exactly as it was before installation.
 */
export function installAnnotationModeMarker(doc: Document = document): () => void {
  const html = doc.documentElement;
  const Observer = doc.defaultView?.MutationObserver ?? globalThis.MutationObserver;
  if (!html || typeof Observer !== "function") return () => undefined;

  const previousMarker = html.getAttribute(MODE_ATTRIBUTE);
  let host: HTMLElement | null = null;
  let hostObserver: MutationObserver | null = null;
  let disposed = false;

  const setMarker = (active: boolean) => {
    if (disposed) return;
    if (active) html.setAttribute(MODE_ATTRIBUTE, "true");
    else if (previousMarker == null) html.removeAttribute(MODE_ATTRIBUTE);
    else html.setAttribute(MODE_ATTRIBUTE, previousMarker);
  };

  const observeHost = (nextHost: HTMLElement | null) => {
    if (nextHost === host) {
      setMarker(isPickerActive(host));
      return;
    }
    hostObserver?.disconnect();
    hostObserver = null;
    host = nextHost;
    if (host) {
      hostObserver = new Observer(() => setMarker(isPickerActive(host)));
      hostObserver.observe(host, { attributes: true, attributeFilter: ["style"] });
    }
    setMarker(isPickerActive(host));
  };

  const inspectHost = () => {
    const candidate = doc.getElementById(COMMENTS_HOST_ID);
    observeHost(isPickerHost(candidate) ? candidate : null);
  };

  // The host is created after the preload's DOMContentLoaded hook, so watch
  // document structure until it appears or is removed. Attribute changes on
  // the host itself are handled by the narrower observer above.
  const documentObserver = new Observer(inspectHost);
  documentObserver.observe(html, { childList: true, subtree: true });
  inspectHost();

  return () => {
    disposed = true;
    documentObserver.disconnect();
    hostObserver?.disconnect();
    hostObserver = null;
    host = null;
    if (previousMarker == null) html.removeAttribute(MODE_ATTRIBUTE);
    else html.setAttribute(MODE_ATTRIBUTE, previousMarker);
  };
}

