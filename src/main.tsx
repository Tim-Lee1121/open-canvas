import ReactDOM from "react-dom/client";
import App from "./App";
import {
  ANNOTATION_ROUTE_PREFIX,
  decodeAnnotationDocumentHash,
  getAnnotationToken,
  readAnnotationDocument,
} from "./components/annotation";
import { installAnnotationInteraction } from "./components/annotationInteraction";
import { createProjectStoreSession } from "./integrations/projectState";
import "./styles.css";
import "./motion.css";

let disposeAnnotationInteraction: (() => void) | null = null;
let disposeProjectStore: (() => void) | null = null;

function showMissingAnnotationDocument() {
  mountAnnotationDocument(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Annotation preview unavailable</title><style>body{font:16px system-ui,sans-serif;margin:40px;color:#20242d}main{max-width:38rem}</style></head><body><main><h1>Annotation preview unavailable</h1><p>This preview has expired. Return to Open Canvas.</p></main></body></html>`);
}

/**
 * Install generated markup without replacing the top-level Document object.
 * Some managed browser Annotation implementations attach their hit-testing
 * observer while the initial document is loading; document.open()/write() can
 * leave that observer attached to the discarded Vite shell. Mutating the
 * existing root keeps the navigation and document identity stable while still
 * re-creating scripts so generated interactions continue to work.
 */
export function mountAnnotationDocument(documentText: string): void {
  const parsed = new DOMParser().parseFromString(documentText, "text/html");
  const targetRoot = document.documentElement;
  const sourceRoot = parsed.documentElement;

  for (const attribute of Array.from(targetRoot.attributes)) {
    targetRoot.removeAttribute(attribute.name);
  }
  for (const attribute of Array.from(sourceRoot.attributes)) {
    targetRoot.setAttribute(attribute.name, attribute.value);
  }

  const nodes = Array.from(sourceRoot.childNodes).map((node) => document.importNode(node, true));
  targetRoot.replaceChildren(...nodes);

  // Scripts copied from an inert DOMParser document do not execute. Recreate
  // each element in document order so inline and external generated scripts
  // retain normal browser behaviour.
  for (const script of Array.from(targetRoot.querySelectorAll("script"))) {
    const replacement = document.createElement("script");
    for (const attribute of Array.from(script.attributes)) {
      replacement.setAttribute(attribute.name, attribute.value);
    }
    replacement.textContent = script.textContent ?? "";
    script.replaceWith(replacement);
  }
}

async function boot() {
  const pathname = typeof window === "undefined" ? "" : window.location.pathname;
  if (pathname.startsWith(ANNOTATION_ROUTE_PREFIX)) {
    const token = getAnnotationToken(pathname);
    // Prefer the self-contained fragment. Storage is only needed for very
    // large documents whose URL would exceed a browser's practical limit.
    const annotationDocument = decodeAnnotationDocumentHash(window.location.hash)
      ?? (token ? readAnnotationDocument(token) : null);
    if (annotationDocument) {
      // Codex Annotation mode does not traverse the board's preview iframe.
      // Keep this navigation's Document identity stable while replacing the
      // shell with the generated top-level page.
      mountAnnotationDocument(annotationDocument);
      disposeAnnotationInteraction?.();
      disposeAnnotationInteraction = installAnnotationInteraction();
      return;
    }
    showMissingAnnotationDocument();
    return;
  }

  const session = await createProjectStoreSession({
    onProjectSyncError: (error) => console.warn("[Project state] Local project sync unavailable", error),
  });
  disposeProjectStore = session.dispose;
  ReactDOM.createRoot(document.getElementById("root")!).render(<App store={session.store} />);
}

void boot();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposeProjectStore?.();
    disposeProjectStore = null;
  });
}
