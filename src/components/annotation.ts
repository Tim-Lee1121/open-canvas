import { createId, type Page } from "../domain/model";
import {
  markNativeAnnotationTargets,
} from "./inlineHtml";

/**
 * A real same-origin route is used for generated HTML annotation targets.
 * Codex's browser can annotate ordinary http(s) documents, while data/blob
 * documents are treated as opaque auxiliary resources by some host versions.
 * Normal screens carry their complete source in a URL fragment; payloads too
 * large for practical URL limits use a compact random storage token instead.
 */
export const ANNOTATION_ROUTE_PREFIX = "/__codex_annotation__/";
/** Vite dev/preview endpoint that turns a generated document into a real HTTP page. */
export const ANNOTATION_STAGE_PATH = `${ANNOTATION_ROUTE_PREFIX}stage`;
/** Prefix returned by the staging endpoint for direct top-level navigation. */
export const ANNOTATION_STAGED_ROUTE_PREFIX = `${ANNOTATION_ROUTE_PREFIX}staged/`;
/** Marker injected into the board shell by the local staging server. */
export const ANNOTATION_SERVER_MARKER = "codex-annotation-server";
export const ANNOTATION_STORAGE_PREFIX = "ai-board:annotation-target:";
export const ANNOTATION_INLINE_HASH_PREFIX = "#html=";
const ANNOTATION_INLINE_BASE64_MARKER = "b64.";
/** Keep ordinary generated screens self-contained while avoiding browser URL-size cliffs. */
export const ANNOTATION_INLINE_URL_LIMIT = 1_800_000;
/** Keep a staged document available while a managed browser is annotating it. */
export const ANNOTATION_CLEANUP_DELAY_MS = 5 * 60_000;
/** Leave room for timer/network skew before a server-side snapshot expires. */
const ANNOTATION_STAGING_SAFETY_MARGIN_MS = 10_000;

interface StoredAnnotationDocument {
  document: string;
  pageId: string;
  createdAt: number;
}

export interface AnnotationTarget {
  url: string;
  /** Reserved for hosts that require explicit cleanup of a temporary target. */
  revoke?: () => void;
}

type AnnotationStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

interface PreparedAnnotationTarget {
  revision: string;
  promise: Promise<string | null>;
  url: string | null;
  stagedAt: number | null;
}

// Staging is best-effort and process-local. Keeping this cache outside React
// lets card actions and the canvas share the same in-flight request.
const preparedAnnotationTargets = new Map<string, PreparedAnnotationTarget>();

function createStagedDocumentRevoke(
  storage: AnnotationStorage,
  key: string,
  createdAt: number,
): () => void {
  return () => {
    try {
      // A page can be opened more than once. Do not let an older timer remove
      // the newer snapshot stored under the same page-id key.
      const current = storage.getItem(key);
      if (!current) return;
      const payload = JSON.parse(current) as Partial<StoredAnnotationDocument>;
      if (payload.createdAt === createdAt) storage.removeItem(key);
    } catch {
      // Storage may become unavailable after the new tab has opened.
    }
  };
}

function getBrowserStorage(): AnnotationStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return typeof window.localStorage?.getItem === "function" ? window.localStorage : null;
  } catch {
    // Privacy modes and opaque documents can expose localStorage as a getter
    // that throws. Annotation must retain its self-contained fallback there.
    return null;
  }
}

/**
 * The Vite server adds this marker to the board shell when its staging route
 * is available. Static deployments omit it and continue to use the fragment
 * based fallback below.
 */
export function isAnnotationStagingAvailable(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(`meta[name="${ANNOTATION_SERVER_MARKER}"]`));
}

function isValidStagedTarget(value: unknown): value is string {
  if (typeof value !== "string" || typeof window === "undefined") return false;
  try {
    const target = new URL(value, window.location.href);
    return target.origin === window.location.origin &&
      target.pathname.startsWith(ANNOTATION_STAGED_ROUTE_PREFIX) &&
      target.pathname.length > ANNOTATION_STAGED_ROUTE_PREFIX.length;
  } catch {
    return false;
  }
}

/** Submit a generated document to the local HTTP staging endpoint. */
export async function stageAnnotationDocument(page: Page): Promise<string | null> {
  if (page.source.type !== "html" || !isAnnotationStagingAvailable()) return null;
  if (typeof window === "undefined" || typeof fetch !== "function") return null;

  let documentText: string;
  try {
    documentText = toWellFormed(buildAnnotationDocument(page));
  } catch {
    return null;
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = window.setTimeout(() => controller?.abort(), 10_000);
  try {
    const response = await fetch(ANNOTATION_STAGE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ pageId: page.id, document: documentText }),
      signal: controller?.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json() as { url?: unknown };
    return isValidStagedTarget(payload.url) ? new URL(payload.url, window.location.href).href : null;
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

/** Start staging a page ahead of a click so the browser opens a static page. */
export function prepareAnnotationPreview(page: Page): void {
  if (page.source.type !== "html" || !isAnnotationStagingAvailable()) return;
  const revision = `${page.updatedAt}:${page.source.value.length}:${page.source.value.slice(0, 32)}`;
  const current = preparedAnnotationTargets.get(page.id);
  if (current?.revision === revision) return;
  const entry: PreparedAnnotationTarget = {
    revision,
    url: null,
    stagedAt: null,
    promise: Promise.resolve(null),
  };
  entry.promise = stageAnnotationDocument(page).then((url) => {
    if (preparedAnnotationTargets.get(page.id) === entry) {
      if (url) {
        entry.url = url;
        entry.stagedAt = Date.now();
      } else {
        // A transient server/network failure should not poison this revision
        // forever. The next click or state effect can attempt staging again.
        preparedAnnotationTargets.delete(page.id);
      }
    }
    return url;
  });
  preparedAnnotationTargets.set(page.id, entry);
}

function getPreparedAnnotationTarget(page: Page): string | null {
  if (page.source.type !== "html") return null;
  const revision = `${page.updatedAt}:${page.source.value.length}:${page.source.value.slice(0, 32)}`;
  const entry = preparedAnnotationTargets.get(page.id);
  if (entry?.revision !== revision || !entry.url) return null;
  // The Vite staging server expires documents after the same interval. Do not
  // navigate to a cached URL that is likely to have become a 404 while the
  // board was left open; the caller will use the self-contained route and
  // start a fresh staging request instead.
  if (!entry.stagedAt || Date.now() - entry.stagedAt >= ANNOTATION_CLEANUP_DELAY_MS - ANNOTATION_STAGING_SAFETY_MARGIN_MS) {
    preparedAnnotationTargets.delete(page.id);
    return null;
  }
  return entry.url;
}

function getPageRevision(page: Page): string {
  return `${page.updatedAt}:${page.source.value.length}:${page.source.value.slice(0, 32)}`;
}

function getOrPrepareAnnotationEntry(page: Page): PreparedAnnotationTarget | null {
  if (page.source.type !== "html" || !isAnnotationStagingAvailable()) return null;
  const revision = getPageRevision(page);
  const current = preparedAnnotationTargets.get(page.id);
  if (current?.revision === revision) return current;
  prepareAnnotationPreview(page);
  const prepared = preparedAnnotationTargets.get(page.id);
  return prepared?.revision === revision ? prepared : null;
}

/** Encode a complete generated document into a URL fragment without touching storage. */
export function encodeAnnotationDocumentHash(documentText: string): string {
  const wellFormed = toWellFormed(documentText);
  try {
    if (
      typeof TextEncoder === "undefined" ||
      typeof TextDecoder === "undefined" ||
      typeof btoa !== "function" ||
      typeof atob !== "function"
    ) {
      throw new Error("Base64 text codecs are unavailable");
    }
    // Base64url keeps non-ASCII and CSS-heavy documents compact enough to stay
    // in the self-contained route. Chunk the conversion so large generated
    // screens do not overflow the argument limit of String.fromCharCode.
    const bytes = new TextEncoder().encode(wellFormed);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    const encoded = btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
    return `${ANNOTATION_INLINE_HASH_PREFIX}${ANNOTATION_INLINE_BASE64_MARKER}${encoded}`;
  } catch {
    // Older/restricted hosts may not expose TextEncoder or btoa. The escaped
    // Unicode path remains a valid, if less compact, fallback.
    return `${ANNOTATION_INLINE_HASH_PREFIX}${encodeURIComponent(wellFormed)}`;
  }
}

/** Decode the optional self-contained document carried by an annotation URL. */
export function decodeAnnotationDocumentHash(hash: string): string | null {
  if (!hash.startsWith(ANNOTATION_INLINE_HASH_PREFIX)) return null;
  const encoded = hash.slice(ANNOTATION_INLINE_HASH_PREFIX.length);
  try {
    if (encoded.startsWith(ANNOTATION_INLINE_BASE64_MARKER)) {
      const base64 = encoded
        .slice(ANNOTATION_INLINE_BASE64_MARKER.length)
        .replace(/-/g, "+")
        .replace(/_/g, "/");
      const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
      const binary = atob(padded);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return toWellFormed(new TextDecoder().decode(bytes));
    }
    const decoded = decodeURIComponent(encoded);
    return decoded ? toWellFormed(decoded) : null;
  } catch {
    return null;
  }
}

/**
 * Build a self-contained data URL for the final constrained-environment
 * fallback. The normal HTML path uses `getPreferredAnnotationTarget` below so
 * the browser receives an ordinary http(s) document instead.
 */
export function getAnnotationTarget(page: Page): string {
  if (page.source.type === "url") return page.source.value;
  // `encodeURIComponent` throws on lone UTF-16 surrogates. Generated content
  // can arrive from external tools, so normalize malformed Unicode before
  // constructing the portable data document.
  return `data:text/html;charset=utf-8,${encodeURIComponent(toWellFormed(buildAnnotationDocument(page)))}`;
}

/**
 * Return a portable target for hosts that can navigate a normal top-level HTTP
 * route. HTML normally travels in the fragment. Very large documents use a
 * short storage token to stay below browser URL limits.
 */
export function getPreferredAnnotationTarget(page: Page): AnnotationTarget {
  if (page.source.type === "url") return { url: page.source.value };

  const documentText = toWellFormed(buildAnnotationDocument(page));
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  if (!origin || origin === "null") return { url: getAnnotationTarget(page) };

  const documentHash = encodeAnnotationDocumentHash(documentText);
  const inlineUrl = `${origin}${ANNOTATION_ROUTE_PREFIX}${encodeURIComponent(page.id)}${documentHash}`;
  const fitsInlineUrl = inlineUrl.length <= ANNOTATION_INLINE_URL_LIMIT;
  if (fitsInlineUrl) return { url: inlineUrl };

  // A very large generated screen can exceed browser URL limits. Use a short
  // random token for that uncommon case; unlike a fragment, it stays compact
  // enough for managed browser navigation.
  const storage = getBrowserStorage();
  if (!storage) return { url: getAnnotationTarget(page) };
  const token = createId("annotation");
  const key = `${ANNOTATION_STORAGE_PREFIX}${token}`;
  const createdAt = Date.now();
  const payload: StoredAnnotationDocument = {
    document: documentText,
    pageId: page.id,
    createdAt,
  };
  try {
    storage.setItem(key, JSON.stringify(payload));
    return {
      url: `${origin}${ANNOTATION_ROUTE_PREFIX}${encodeURIComponent(token)}`,
      revoke: createStagedDocumentRevoke(storage, key, createdAt),
    };
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // Ignore cleanup failures and keep the self-contained fallback.
    }
    return { url: getAnnotationTarget(page) };
  }
}

/** Extract a staged annotation token from the top-level route pathname. */
export function getAnnotationToken(pathname: string): string | null {
  if (!pathname.startsWith(ANNOTATION_ROUTE_PREFIX)) return null;
  const encodedToken = pathname.slice(ANNOTATION_ROUTE_PREFIX.length).split("/", 1)[0];
  if (!encodedToken) return null;
  try {
    const token = decodeURIComponent(encodedToken);
    return token && /^[A-Za-z0-9._~-]+$/.test(token) ? token : null;
  } catch {
    return null;
  }
}

/**
 * Consume and remove a staged top-level annotation document. This legacy
 * helper remains available for callers that explicitly want one-shot
 * semantics; the application route uses `readAnnotationDocument` so a large
 * page can be refreshed while it is being annotated.
 */
export function consumeAnnotationDocument(
  token: string,
  storage?: Pick<Storage, "getItem" | "removeItem"> | null,
): string | null {
  const target = storage === undefined ? getBrowserStorage() : storage;
  if (!target) return null;
  const key = `${ANNOTATION_STORAGE_PREFIX}${token}`;
  let serialized: string | null = null;
  try {
    serialized = target.getItem(key);
    target.removeItem(key);
  } catch {
    return null;
  }
  if (!serialized) return null;
  try {
    const payload = JSON.parse(serialized) as Partial<StoredAnnotationDocument>;
    return typeof payload.document === "string" ? payload.document : null;
  } catch {
    return null;
  }
}

/**
 * Read a staged document without consuming it. The route can be reloaded
 * during annotation, so successful reads remain available until the opener
 * cleanup timer (or the TTL check below) removes them.
 */
export function readAnnotationDocument(
  token: string,
  storage?: Pick<Storage, "getItem" | "removeItem"> | null,
  now = Date.now(),
): string | null {
  const target = storage === undefined ? getBrowserStorage() : storage;
  if (!target) return null;
  const key = `${ANNOTATION_STORAGE_PREFIX}${token}`;
  let serialized: string | null = null;
  try {
    serialized = target.getItem(key);
  } catch {
    return null;
  }
  if (!serialized) return null;
  try {
    const payload = JSON.parse(serialized) as Partial<StoredAnnotationDocument>;
    if (
      typeof payload.document !== "string" ||
      typeof payload.createdAt !== "number" ||
      !Number.isFinite(payload.createdAt) ||
      now - payload.createdAt > ANNOTATION_CLEANUP_DELAY_MS
    ) {
      try {
        target.removeItem(key);
      } catch {
        // Ignore cleanup failures in restricted storage contexts.
      }
      return null;
    }
    return payload.document;
  } catch {
    try {
      target.removeItem(key);
    } catch {
      // Ignore cleanup failures in restricted storage contexts.
    }
    return null;
  }
}

/**
 * Navigate the current browser tab to a top-level annotation target.
 *
 * Annotation mode is attached to the active tab in the managed browser. A
 * popup opened with `window.open` can remain in the background while the user
 * keeps annotating the board shell, which makes the iframe/card the selected
 * target. A real same-tab anchor navigation keeps the active tab and gives the
 * browser a normal top-level document whose generated elements are visible to
 * Annotation mode. The browser Back action returns to the board.
 */
export function navigateAnnotationTarget(url: string): boolean {
  if (typeof document === "undefined") return false;
  try {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_self";
    link.rel = "noreferrer";
    link.setAttribute("aria-hidden", "true");
    link.style.display = "none";
    const parent = document.body ?? document.documentElement;
    if (!parent) return false;
    parent.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a top-level annotation target in a separate tab for callers that need
 * to inspect a generated document outside the board.
 */
export function openAnnotationTarget(url: string): boolean {
  if (typeof window !== "undefined" && typeof window.open === "function") {
    try {
      // Avoid passing `noopener` as a window feature: Chromium may return a
      // null WindowProxy even when that navigation succeeded, which would
      // make the fallback open a duplicate tab. Clear the opener explicitly
      // while the returned handle is still available, then use the native
      // link only when the popup API genuinely reports a blocked navigation.
      const popup = window.open(url, "_blank", "");
      if (popup) {
        try {
          popup.opener = null;
        } catch {
          // Cross-origin WindowProxy setters can be read-only in some hosts.
        }
        return true;
      }
    } catch {
      // Fall through to a native link for constrained documents.
    }
  }
  if (typeof document === "undefined") return false;
  try {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-hidden", "true");
    link.style.display = "none";
    const parent = document.body ?? document.documentElement;
    if (!parent) return false;
    parent.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch {
    return false;
  }
}

/**
 * Open a generated page at its real same-origin route. Navigating directly is
 * important for managed browsers: their annotation surface attaches to a
 * normal top-level HTTP document, not the board's sandboxed preview iframe.
 * The route bootstraps the generated HTML from its fragment or short-lived
 * storage token. When the dev server has already staged the document, that
 * static URL is used; otherwise the self-contained route is navigated to
 * immediately so the user never remains on the board shell. Browser Back
 * returns to the board after annotation.
 */
function openAnnotationFallback(page: Page): boolean {
  let target: AnnotationTarget;
  try {
    target = getPreferredAnnotationTarget(page);
  } catch {
    return false;
  }
  const opened = navigateAnnotationTarget(target.url);
  if (target.revoke) window.setTimeout(target.revoke, ANNOTATION_CLEANUP_DELAY_MS);
  return opened;
}

/**
 * Preserve the original synchronous helper for hosts that call it directly.
 * When staging is already warm, it navigates to the raw HTTP document;
 * otherwise it keeps the portable top-level route as a best-effort fallback.
 */
export function openAnnotationPreview(page: Page): boolean {
  if (typeof window === "undefined") return false;
  if (page.source.type === "html") {
    const preparedTarget = getPreparedAnnotationTarget(page);
    if (preparedTarget) return navigateAnnotationTarget(preparedTarget);
    const stagingEntry = getOrPrepareAnnotationEntry(page);
    void stagingEntry?.promise.catch(() => null);
  }
  return openAnnotationFallback(page);
}

/**
 * Open a generated page only after its dev-server staging document is ready.
 * The board uses this variant so Annotation mode never lands on the SPA shell
 * while a staging POST is still in flight. Static hosts still receive the
 * self-contained top-level route when no staging endpoint is available.
 */
export async function openAnnotationPreviewWhenReady(page: Page): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (page.source.type !== "html") return openAnnotationPreview(page);

  const preparedTarget = getPreparedAnnotationTarget(page);
  const stagingEntry = preparedTarget ? null : getOrPrepareAnnotationEntry(page);
  const stagedTarget = preparedTarget ?? (stagingEntry ? await stagingEntry.promise : null);
  if (stagedTarget) return navigateAnnotationTarget(stagedTarget);
  return openAnnotationFallback(page);
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function escapeHtmlText(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  })[character] ?? character);
}

function toWellFormed(value: string): string {
  const native = (value as string & { toWellFormed?: () => string }).toWellFormed;
  if (typeof native === "function") return native.call(value);

  let result = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        result += value[index] + value[index + 1];
        index += 1;
      } else {
        result += "\ufffd";
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      result += "\ufffd";
    } else {
      result += value[index];
    }
  }
  return result;
}

/**
 * Dia's Annotation picker filters very small boxes before it presents a
 * candidate. Mobile controls are often only 32-48px high, so they can lose to
 * a surrounding section or the page shell even when the pointer is directly
 * over the control. The standalone annotation document installs this small
 * bridge: it keeps the generated page visually untouched, but exposes one
 * transparent, >=112px hit box for the semantic element under the pointer.
 * Proxies are empty spans, never images: Codex's generic picker treats an image
 * as an immediate target and would otherwise report the proxy itself.
 * Ordinary elements get a child proxy; void/replaced elements get a positioned
 * sibling because they cannot legally render children.
 *
 * Keep this script self-contained. It is serialized into a generated document
 * and therefore cannot import the board bundle. This page is intentionally a
 * read-only annotation target, not the live workbench.
 */
const ANNOTATION_NATIVE_BRIDGE_SCRIPT = String.raw`(function () {
  "use strict";
  var targetSelectors = "h1,h2,h3,h4,h5,h6,p,button,a,input,textarea,select,label,img,video,audio,canvas,[role],[tabindex],[aria-label],[data-codex-annotatable],[data-openai-annotatable]";
  var wrapperSelectors = "nav,main,header,footer,section,article,form,figure,table,li,div,span,small,strong,em,b,i,mark";
  var proxyAttribute = "data-codex-annotation-hit";
  var proxyHostAttribute = "data-codex-annotation-proxy-host";
  var proxyTargetAttribute = "data-codex-annotation-target-id";
  var proxyForAttribute = "data-codex-annotation-proxy-for";
  var proxyKindAttribute = "data-codex-annotation-proxy-kind";
  var nativeAnnotationAttribute = "data-openai-annotatable";
  var annotationMetadataAttribute = "data-openai-annotation-metadata";
  var targetPrefix = "codex-annotation-target-";
  var minProxySize = 112;
  var voidTags = { AREA: 1, BASE: 1, BR: 1, COL: 1, EMBED: 1, HR: 1, IMG: 1, INPUT: 1, LINK: 1, META: 1, PARAM: 1, SELECT: 1, TEXTAREA: 1, SOURCE: 1, TRACK: 1, VIDEO: 1, AUDIO: 1, CANVAS: 1, WBR: 1 };
  var queued = false;

  // The bridge observes generated DOM mutations. Avoid writing an identical
  // attribute/style value on every pass: browsers dispatch MutationObserver
  // records even when setAttribute/setProperty receives the current value,
  // which would otherwise keep the observer in a microtask loop.
  function setAttributeIfChanged(element, name, value) {
    if (element.getAttribute(name) !== String(value)) element.setAttribute(name, String(value));
  }

  function removeAttributeIfPresent(element, name) {
    if (element.hasAttribute(name)) element.removeAttribute(name);
  }

  function setImportantStyleIfChanged(element, name, value) {
    var normalized = String(value);
    if (element.style.getPropertyValue(name) !== normalized || element.style.getPropertyPriority(name) !== "important") {
      element.style.setProperty(name, normalized, "important");
    }
  }

  function hasMeaningfulRole(element) {
    var role = String(element.getAttribute("role") || "").trim().toLowerCase();
    return Boolean(role && role !== "none" && role !== "presentation");
  }

  function isPotentiallyHidden(element) {
    if (!element || element.nodeType !== 1 || element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return true;
    var style = String(element.getAttribute("style") || "");
    return /(?:^|[;\s])(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0)(?:[;\s]|$)/i.test(style);
  }

  function removeInertRole(element) {
    var role = String(element.getAttribute("role") || "").trim().toLowerCase();
    // The browser's generic picker treats the presence of any role as a
    // candidate. Presentation/none are layout semantics, so they must not
    // mask a real generated heading, paragraph, or control underneath.
    if (role === "presentation" || role === "none") removeAttributeIfPresent(element, "role");
  }

  function textOf(element) {
    var labelled = element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("placeholder");
    return String(labelled || element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 400);
  }

  function labelOf(element) {
    return (element.getAttribute("aria-label") || element.getAttribute("alt") || element.getAttribute("placeholder") || textOf(element) || String(element.tagName || "element").toLowerCase()).slice(0, 160);
  }

  function selectorOf(element) {
    if (element.id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(element.id)) return "#" + element.id;
    var parts = [];
    var current = element;
    while (current && current.nodeType === 1 && current !== document.body && parts.length < 6) {
      var part = current.tagName.toLowerCase();
      if (current.classList && current.classList.length) {
        var className = Array.prototype.slice.call(current.classList).find(function (name) { return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name); });
        if (className) part += "." + className;
      }
      var ordinal = 1;
      for (var sibling = current.previousElementSibling; sibling; sibling = sibling.previousElementSibling) if (sibling.tagName === current.tagName) ordinal += 1;
      part += ":nth-of-type(" + ordinal + ")";
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  }

  function metadataText(value, limit) {
    return String(value || "")
      .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, limit)
      .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, " ");
  }

  function metadataFor(element, targetId, sibling) {
    var metadata = {
      selector: metadataText(selectorOf(element), 192),
      tag: metadataText(String(element.tagName || "").toLowerCase(), 32),
      text: metadataText(labelOf(element), 128),
      id: metadataText(element.id, 128),
      targetId: metadataText(targetId, 128),
      proxyKind: sibling ? "sibling" : "child"
    };
    try { return JSON.stringify(metadata); } catch (_) { return "{}"; }
  }

  function directProxy(element) {
    for (var index = 0; index < element.children.length; index += 1) {
      if (element.children[index].hasAttribute(proxyAttribute)) return element.children[index];
    }
    var targetId = element.getAttribute(proxyTargetAttribute);
    if (!targetId || !element.parentElement) return null;
    for (var sibling = 0; sibling < element.parentElement.children.length; sibling += 1) {
      var candidate = element.parentElement.children[sibling];
      if (candidate !== element && candidate.getAttribute(proxyAttribute) === "true" && candidate.getAttribute(proxyForAttribute) === targetId) return candidate;
    }
    return null;
  }

  function ensureTargetId(element, index, root) {
    var existing = element.getAttribute(proxyTargetAttribute);
    if (existing && existing.indexOf(targetPrefix) === 0) return existing;
    var used = {};
    var known = root && root.querySelectorAll ? root.querySelectorAll("[" + proxyTargetAttribute + "]") : [];
    for (var knownIndex = 0; knownIndex < known.length; knownIndex += 1) {
      var knownId = known[knownIndex].getAttribute(proxyTargetAttribute);
      if (knownId) used[knownId] = true;
    }
    var serial = Math.max(0, index);
    var targetId = targetPrefix + serial;
    while (used[targetId]) {
      serial += 1;
      targetId = targetPrefix + serial;
    }
    setAttributeIfChanged(element, proxyTargetAttribute, targetId);
    return targetId;
  }

  function ensureProxyHostPosition(element) {
    var position = element.style && element.style.getPropertyValue("position");
    if (!position || position === "static") setImportantStyleIfChanged(element, "position", "relative");
  }

  function resizeProxy(proxy, target) {
    if (!proxy || !target || !target.getBoundingClientRect) return;
    var rect;
    try { rect = target.getBoundingClientRect(); } catch (_) { return; }
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    // The generated page may be displayed inside a zoomed canvas before it is
    // opened top-level. Keep the proxy at least 112 CSS pixels *after* any
    // transform so it remains a positive-score candidate in every viewport.
    var scaleX = target.offsetWidth > 0 ? rect.width / target.offsetWidth : 1;
    var scaleY = target.offsetHeight > 0 ? rect.height / target.offsetHeight : 1;
    var width = Math.max(minProxySize, minProxySize / Math.max(scaleX, 0.01));
    var height = Math.max(minProxySize, minProxySize / Math.max(scaleY, 0.01));
    setImportantStyleIfChanged(proxy, "width", width + "px");
    setImportantStyleIfChanged(proxy, "height", height + "px");
    var targetWidth = target.offsetWidth > 0 ? target.offsetWidth : rect.width / Math.max(scaleX, 0.01);
    var targetHeight = target.offsetHeight > 0 ? target.offsetHeight : rect.height / Math.max(scaleY, 0.01);
    var clipTop = Math.max(0, (height - targetHeight) / 2);
    var clipRight = Math.max(0, (width - targetWidth) / 2);
    setImportantStyleIfChanged(proxy, "clip-path", "inset(" + clipTop + "px " + clipRight + "px " + clipTop + "px " + clipRight + "px)");

    if (proxy.getAttribute(proxyKindAttribute) !== "sibling") return;
    // Sibling proxies for void/replaced elements use the nearest absolute
    // containing block. Convert the viewport rect back into that block's
    // untransformed coordinates so zoom, pan, and scrolling stay aligned.
    var offsetParent = proxy.offsetParent && proxy.offsetParent.nodeType === 1 ? proxy.offsetParent : null;
    var documentElement = document.documentElement;
    var containingBlock = offsetParent || documentElement;
    var containingRect;
    try { containingRect = containingBlock.getBoundingClientRect(); } catch (_) { containingRect = { left: 0, top: 0, width: 0, height: 0 }; }
    var parentScaleX = offsetParent && offsetParent.offsetWidth > 0 ? containingRect.width / offsetParent.offsetWidth : 1;
    var parentScaleY = offsetParent && offsetParent.offsetHeight > 0 ? containingRect.height / offsetParent.offsetHeight : 1;
    var safeScaleX = Math.max(parentScaleX, 0.01);
    var safeScaleY = Math.max(parentScaleY, 0.01);
    var scrollLeft = offsetParent ? offsetParent.scrollLeft : (window.scrollX || 0);
    var scrollTop = offsetParent ? offsetParent.scrollTop : (window.scrollY || 0);
    var borderLeft = offsetParent && offsetParent.clientLeft ? offsetParent.clientLeft : 0;
    var borderTop = offsetParent && offsetParent.clientTop ? offsetParent.clientTop : 0;
    var centerX = (rect.left - containingRect.left) / safeScaleX + scrollLeft + borderLeft + rect.width / (2 * safeScaleX);
    var centerY = (rect.top - containingRect.top) / safeScaleY + scrollTop + borderTop + rect.height / (2 * safeScaleY);
    setImportantStyleIfChanged(proxy, "left", centerX + "px");
    setImportantStyleIfChanged(proxy, "top", centerY + "px");
  }

  function addProxy(element, index, root) {
    if (!element) return;
    var sibling = Boolean(voidTags[element.tagName]);
    var targetId = ensureTargetId(element, index, root);
    var metadata = metadataFor(element, targetId, sibling);
    var existing = directProxy(element);
    // A previous version used IMG proxies. Remove those nodes so generic
    // picker fallback does not return the image by tag name after a reload.
    if (existing && existing.tagName === "IMG") {
      existing.parentNode && existing.parentNode.removeChild(existing);
      existing = null;
    }
    if (existing) {
      // Refresh metadata when a generated script mutates the existing target
      // node in place, rather than leaving a stale label or selector behind.
      setAttributeIfChanged(existing, proxyKindAttribute, sibling ? "sibling" : "child");
      setAttributeIfChanged(existing, proxyForAttribute, targetId);
      setAttributeIfChanged(existing, "data-codex-annotation-hit-index", String(index));
      setAttributeIfChanged(existing, "data-codex-annotation-tag", String(element.tagName || "").toLowerCase());
      setAttributeIfChanged(existing, "data-codex-annotation-text", textOf(element));
      setAttributeIfChanged(existing, "data-codex-annotation-selector", selectorOf(element));
      removeAttributeIfPresent(existing, nativeAnnotationAttribute);
      setAttributeIfChanged(existing, annotationMetadataAttribute, metadata);
      removeAttributeIfPresent(existing, "src");
      removeAttributeIfPresent(existing, "alt");
      removeAttributeIfPresent(existing, "aria-label");
      setAttributeIfChanged(existing, "aria-hidden", "true");
      setAttributeIfChanged(element, annotationMetadataAttribute, metadata);
      resizeProxy(existing, element);
      return;
    }
    var proxy = document.createElement("span");
    setAttributeIfChanged(proxy, proxyAttribute, "true");
    setAttributeIfChanged(proxy, annotationMetadataAttribute, metadata);
    setAttributeIfChanged(proxy, proxyKindAttribute, sibling ? "sibling" : "child");
    setAttributeIfChanged(proxy, proxyForAttribute, targetId);
    setAttributeIfChanged(proxy, "data-codex-annotation-hit-index", String(index));
    setAttributeIfChanged(proxy, "data-codex-annotation-tag", String(element.tagName || "").toLowerCase());
    setAttributeIfChanged(proxy, "data-codex-annotation-text", textOf(element));
    setAttributeIfChanged(proxy, "data-codex-annotation-selector", selectorOf(element));
    setAttributeIfChanged(proxy, "aria-hidden", "true");
    setAttributeIfChanged(element, annotationMetadataAttribute, metadata);
    setAttributeIfChanged(proxy, "draggable", "false");
    setImportantStyleIfChanged(proxy, "position", "absolute");
    setImportantStyleIfChanged(proxy, "left", sibling ? "0px" : "50%");
    setImportantStyleIfChanged(proxy, "top", sibling ? "0px" : "50%");
    setImportantStyleIfChanged(proxy, "width", minProxySize + "px");
    setImportantStyleIfChanged(proxy, "height", minProxySize + "px");
    setImportantStyleIfChanged(proxy, "transform", "translate(-50%, -50%)");
    setImportantStyleIfChanged(proxy, "z-index", "2147483647");
    setImportantStyleIfChanged(proxy, "display", "block");
    setImportantStyleIfChanged(proxy, "visibility", "visible");
    setImportantStyleIfChanged(proxy, "opacity", "1");
    setImportantStyleIfChanged(proxy, "pointer-events", "auto");
    setImportantStyleIfChanged(proxy, "box-sizing", "border-box");
    setImportantStyleIfChanged(proxy, "max-width", "none");
    setImportantStyleIfChanged(proxy, "max-height", "none");
    setImportantStyleIfChanged(proxy, "margin", "0");
    setImportantStyleIfChanged(proxy, "padding", "0");
    setImportantStyleIfChanged(proxy, "border", "0");
    setImportantStyleIfChanged(proxy, "background", "transparent");
    setImportantStyleIfChanged(proxy, "color", "transparent");
    setImportantStyleIfChanged(proxy, "font-size", "0");
    setImportantStyleIfChanged(proxy, "line-height", "0");
    setImportantStyleIfChanged(proxy, "user-select", "none");
    setAttributeIfChanged(element, proxyHostAttribute, "true");
    if (sibling) {
      // Keep the source element untouched: HTML void/replaced elements cannot
      // contain a child proxy. The sibling is positioned over its client rect
      // after layout, and remains in the same stacking/transform tree.
      if (element.parentElement) element.parentElement.insertBefore(proxy, element.nextSibling);
    } else {
      ensureProxyHostPosition(element);
      element.appendChild(proxy);
    }
    resizeProxy(proxy, element);
  }

  function shouldMark(element) {
    if (isPotentiallyHidden(element) || element.hasAttribute(proxyAttribute)) return false;
    if (/^(H[1-6]|P|BUTTON|A|INPUT|TEXTAREA|SELECT|LABEL|IMG|VIDEO)$/.test(element.tagName)) return true;
    return hasMeaningfulRole(element)
      || element.hasAttribute("tabindex")
      || Boolean(String(element.getAttribute("aria-label") || "").trim())
      || element.hasAttribute("data-codex-annotatable")
      || element.hasAttribute("data-openai-annotatable");
  }

  function hasAnnotatedAncestor(element, root) {
    for (var current = element.parentElement; current && current !== root; current = current.parentElement) {
      if (current.hasAttribute("data-openai-annotatable")) return true;
    }
    return false;
  }

  function removeLegacyProxies(root) {
    // Older bridge revisions appended one full-size IMG per generated page.
    // Remove those nodes before marking fresh targets: the browser's generic
    // picker always accepts IMG and would otherwise select the stale overlay.
    var legacy = root.querySelectorAll("img[" + proxyAttribute + "], [data-codex-annotation-hit-layer]");
    for (var index = 0; index < legacy.length; index += 1) {
      legacy[index].parentNode && legacy[index].parentNode.removeChild(legacy[index]);
    }
  }

  function markDocument() {
    queued = false;
    var root = document.body || document.documentElement;
    if (!root) return;
    removeLegacyProxies(root);
    if (!root.hasAttribute("data-openai-annotation-container")) setAttributeIfChanged(root, "data-openai-annotation-container", "true");

    var allElements = Array.prototype.slice.call(root.querySelectorAll("*"));
    for (var roleIndex = 0; roleIndex < allElements.length; roleIndex += 1) removeInertRole(allElements[roleIndex]);

    var targets = Array.prototype.slice.call(root.querySelectorAll(targetSelectors));
    for (var index = 0; index < targets.length; index += 1) {
      var target = targets[index];
      if (shouldMark(target) && !target.hasAttribute("data-openai-annotatable")) setAttributeIfChanged(target, "data-openai-annotatable", "true");
    }

    var wrappers = Array.prototype.slice.call(root.querySelectorAll(wrapperSelectors));
    for (var wrapperIndex = wrappers.length - 1; wrapperIndex >= 0; wrapperIndex -= 1) {
      var wrapper = wrappers[wrapperIndex];
      if (isPotentiallyHidden(wrapper) || wrapper.hasAttribute("data-openai-annotatable")) continue;
      if (hasAnnotatedAncestor(wrapper, root) || wrapper.querySelector("[data-openai-annotatable]")) continue;
      if (!String(wrapper.textContent || "").replace(/\s+/g, " ").trim()) continue;
      setAttributeIfChanged(wrapper, "data-openai-annotatable", "true");
    }

    var annotated = Array.prototype.slice.call(root.querySelectorAll("[" + nativeAnnotationAttribute + "]"))
      .filter(function (element) { return !element.hasAttribute(proxyAttribute); });
    for (var proxyIndex = 0; proxyIndex < annotated.length; proxyIndex += 1) addProxy(annotated[proxyIndex], proxyIndex, root);
    var proxies = Array.prototype.slice.call(root.querySelectorAll("[data-codex-annotation-hit]"));
    for (var resizeIndex = 0; resizeIndex < proxies.length; resizeIndex += 1) {
      var proxy = proxies[resizeIndex];
      var targetId = proxy.getAttribute(proxyForAttribute);
      var target = null;
      if (targetId) {
        var targetCandidates = root.querySelectorAll("[" + proxyTargetAttribute + "]");
        for (var targetIndex = 0; targetIndex < targetCandidates.length; targetIndex += 1) {
          if (targetCandidates[targetIndex].getAttribute(proxyTargetAttribute) === targetId) {
            target = targetCandidates[targetIndex];
            break;
          }
        }
      }
      if (!target && proxy.parentElement && proxy.parentElement.hasAttribute(proxyHostAttribute)) target = proxy.parentElement;
      resizeProxy(proxy, target);
    }
  }

  function scheduleMarking() {
    if (queued) return;
    queued = true;
    if (typeof queueMicrotask === "function") queueMicrotask(markDocument);
    else Promise.resolve().then(markDocument);
  }

  function annotationPickerActive() {
    var host = document.getElementById("codex-browser-sidebar-comments-root");
    return Boolean(host && String(host.style.pointerEvents || "").trim().toLowerCase() === "auto");
  }

  function proxyTarget(proxy) {
    var targetId = proxy.getAttribute(proxyForAttribute);
    if (!targetId) return proxy.parentElement && proxy.parentElement.hasAttribute(proxyHostAttribute) ? proxy.parentElement : null;
    var candidates = document.querySelectorAll("[" + proxyTargetAttribute + "]");
    for (var index = 0; index < candidates.length; index += 1) {
      if (candidates[index].getAttribute(proxyTargetAttribute) === targetId) return candidates[index];
    }
    return null;
  }

  function targetFromElement(element) {
    if (!element || element.nodeType !== 1) return null;
    if (element.hasAttribute(proxyAttribute)) return proxyTarget(element);
    var current = element;
    while (current && current !== document.body && current !== document.documentElement) {
      if (current.hasAttribute(nativeAnnotationAttribute) && !current.hasAttribute("data-openai-annotation-container")) return current;
      current = current.parentElement;
    }
    return null;
  }

  function directTargetForEvent(event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [event.target];
    for (var index = 0; index < path.length; index += 1) {
      var fromPath = targetFromElement(path[index]);
      if (fromPath) return fromPath;
    }

    if (typeof document.elementsFromPoint !== "function") return null;
    var overlaySelector = "[data-browser-comment-root], [data-browser-comment-interaction-blocker], [data-browser-comment-interaction-layer]";
    var overlays = Array.prototype.slice.call(document.querySelectorAll("#codex-browser-sidebar-comments-root, " + overlaySelector));
    var host = document.getElementById("codex-browser-sidebar-comments-root");
    if (host && host.shadowRoot) {
      var shadowOverlays = Array.prototype.slice.call(host.shadowRoot.querySelectorAll(overlaySelector));
      for (var shadowIndex = 0; shadowIndex < shadowOverlays.length; shadowIndex += 1) {
        if (overlays.indexOf(shadowOverlays[shadowIndex]) === -1) overlays.push(shadowOverlays[shadowIndex]);
      }
    }
    var previous = overlays.map(function (overlay) { return overlay.style.pointerEvents; });
    for (var overlayIndex = 0; overlayIndex < overlays.length; overlayIndex += 1) overlays[overlayIndex].style.pointerEvents = "none";
    try {
      var candidates = document.elementsFromPoint(event.clientX, event.clientY);
      for (var candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
        var fromPoint = targetFromElement(candidates[candidateIndex]);
        if (fromPoint) return fromPoint;
      }
    } finally {
      for (var restoreIndex = 0; restoreIndex < overlays.length; restoreIndex += 1) overlays[restoreIndex].style.pointerEvents = previous[restoreIndex] || "";
    }
    return null;
  }

  function metadataObject(element) {
    var raw = element.getAttribute(annotationMetadataAttribute);
    if (!raw) return undefined;
    try {
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : undefined;
    } catch (_) {
      return undefined;
    }
  }

  function openDirectAnnotation(target) {
    var metadata = metadataObject(target);
    try {
      var annotations = document.openai && document.openai.annotations;
      if (annotations && typeof annotations.open === "function") {
        // The managed browser returns true when the annotation request is
        // accepted (open() is backed by a cancelable event). Returning the
        // inverse lets the browser generic picker handle the same pointer a
        // second time and replace this concrete target with its parent.
        return annotations.open({ target: target, metadata: metadata }) === true;
      }
    } catch (_) {}
    var detail = { mode: "default", enterAnnotationMode: false };
    if (metadata) detail.metadata = metadata;
    var request = new CustomEvent("codex:open-annotation", { bubbles: true, cancelable: true, composed: true, detail: detail });
    return !target.dispatchEvent(request);
  }

  function installDirectInteraction() {
    var lastHandledAt = 0;
    var lastX = -1;
    var lastY = -1;
    var handle = function (event) {
      if (!annotationPickerActive() || event.button !== 0) return;
      var target = directTargetForEvent(event);
      if (!target) return;
      var now = Date.now();
      if (now - lastHandledAt < 500 && Math.abs(event.clientX - lastX) < 4 && Math.abs(event.clientY - lastY) < 4) return;
      if (!openDirectAnnotation(target)) return;
      lastHandledAt = now;
      lastX = event.clientX;
      lastY = event.clientY;
      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
    };
    window.addEventListener("pointerdown", handle, true);
    window.addEventListener("mousedown", handle, true);
  }

  function install() {
    markDocument();
    installDirectInteraction();
    var root = document.documentElement;
    if (!root || typeof MutationObserver !== "function") return;
    var observer = new MutationObserver(scheduleMarking);
    observer.observe(root, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["id", "class", "style", "hidden", "aria-hidden", "role", "aria-label", "alt", "placeholder", "tabindex", "data-codex-annotatable", "data-openai-annotatable", "data-openai-annotation-metadata"]
    });
    var reposition = function () {
      var proxies = Array.prototype.slice.call(document.querySelectorAll("[data-codex-annotation-hit]"));
      for (var index = 0; index < proxies.length; index += 1) {
        var proxy = proxies[index];
        var targetId = proxy.getAttribute(proxyForAttribute);
        var target = null;
        if (targetId) {
          var candidates = document.querySelectorAll("[" + proxyTargetAttribute + "]");
          for (var targetIndex = 0; targetIndex < candidates.length; targetIndex += 1) {
            if (candidates[targetIndex].getAttribute(proxyTargetAttribute) === targetId) {
              target = candidates[targetIndex];
              break;
            }
          }
        }
        if (!target && proxy.parentElement && proxy.parentElement.hasAttribute(proxyHostAttribute)) target = proxy.parentElement;
        resizeProxy(proxy, target);
      }
    };
    window.addEventListener("resize", reposition, true);
    window.addEventListener("scroll", reposition, true);
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", reposition);
      window.visualViewport.addEventListener("scroll", reposition);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();`;

function buildAnnotationDocument(page: Page): string {
  const metadata = `<meta name="codex-page-id" content="${escapeHtmlAttribute(page.id)}"><meta name="codex-page-title" content="${escapeHtmlAttribute(page.title)}">`;
  const title = `<title>${escapeHtmlText(page.title)}</title>`;
  const source = toWellFormed(page.source.value);

  // Parse as inert text before adding metadata. Regex insertion can match a
  // literal "<head>" or "<title>" inside a comment/script and corrupt the
  // generated document. DOMParser never executes the supplied markup, while
  // the resulting standalone document still runs its scripts once loaded in
  // the browser's isolated annotation context.
  if (typeof DOMParser !== "undefined") {
    try {
      const parsed = new DOMParser().parseFromString(source, "text/html");
      const head = parsed.head ?? parsed.createElement("head");
      if (!parsed.head) parsed.documentElement.insertBefore(head, parsed.body ?? null);
      const pageIdMeta = parsed.createElement("meta");
      pageIdMeta.name = "codex-page-id";
      pageIdMeta.content = page.id;
      head.insertBefore(pageIdMeta, head.firstChild);
      const pageTitleMeta = parsed.createElement("meta");
      pageTitleMeta.name = "codex-page-title";
      pageTitleMeta.content = page.title;
      head.insertBefore(pageTitleMeta, pageIdMeta.nextSibling);
      const sandboxMeta = parsed.createElement("meta");
      sandboxMeta.httpEquiv = "Content-Security-Policy";
      sandboxMeta.content = "sandbox allow-scripts";
      // Generated screens may carry their own restrictive CSP. It can block
      // the annotation bridge (or replace the sandbox policy), so the staged
      // response's CSP is the single authority for this read-only document.
      parsed.querySelectorAll('meta[http-equiv="Content-Security-Policy"], meta[http-equiv="content-security-policy"], meta[http-equiv="Content-Security-Policy-Report-Only"], meta[http-equiv="content-security-policy-report-only"]').forEach((meta) => meta.remove());
      head.insertBefore(sandboxMeta, pageTitleMeta.nextSibling);
      // The opener is also cleared from inside the generated document. The
      // opening helper clears Window.opener when a handle is available, while
      // this guard covers hosts that expose a read-only WindowProxy setter.
      const openerGuard = parsed.createElement("script");
      openerGuard.textContent = "try { window.opener = null; } catch {}";
      head.insertBefore(openerGuard, sandboxMeta.nextSibling);
      if (!head.querySelector("title")) {
        const pageTitle = parsed.createElement("title");
        pageTitle.textContent = page.title;
        head.insertBefore(pageTitle, head.firstChild);
      }
      const body = parsed.body ?? parsed.createElement("body");
      body.setAttribute("data-openai-annotation-container", "true");
      markNativeAnnotationTargets(body);
      // Install after the source styles/scripts in the head so the bridge's
      // native target attributes are already present before the page loads;
      // the bridge then covers dynamically inserted generated elements.
      const annotationBridge = parsed.createElement("script");
      annotationBridge.setAttribute("data-codex-annotation-bridge", "true");
      annotationBridge.textContent = ANNOTATION_NATIVE_BRIDGE_SCRIPT;
      head.appendChild(annotationBridge);
      const doctype = parsed.doctype ? `<!doctype ${parsed.doctype.name}>` : "<!doctype html>";
      return toWellFormed(`${doctype}${parsed.documentElement.outerHTML}`);
    } catch {
      // Fall through to the string-only path for very old or restricted hosts.
    }
  }

  // Fallback for hosts without DOMParser. This path is intentionally kept
  // conservative and is only used when the inert parser is unavailable.
  const headContent = `${metadata}<meta http-equiv="Content-Security-Policy" content="sandbox allow-scripts"><script>try{window.opener=null}catch{}</script>${title}<script data-codex-annotation-bridge="true">${ANNOTATION_NATIVE_BRIDGE_SCRIPT}</script>`;
  return toWellFormed(/<head(?:\s[^>]*)?>/i.test(source)
    ? source.replace(/<head(?:\s[^>]*)?>/i, (match) => `${match}${headContent}`)
    : /<html(?:\s[^>]*)?>/i.test(source)
      ? source.replace(/<html(?:\s[^>]*)?>/i, (match) => `${match}<head>${headContent}</head>`)
      : `<!doctype html><html><head>${headContent}</head><body>${source}</body></html>`);
}
