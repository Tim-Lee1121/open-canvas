/**
 * Build a safe, same-document representation of generated HTML for the board
 * preview. Codex's Annotation mode can inspect ordinary DOM nodes, but it does
 * not cross an iframe boundary. Generated scripts therefore stay in the
 * top-level annotation route; the in-board representation is deliberately a
 * static, sanitized view.
 */

export interface InlineHtmlPreview {
  /** Markup for the preview root, including its scoped style element. */
  markup: string;
  /** Whether active content was removed from the generated source. */
  removedActiveContent: boolean;
  /** Stable class used as the CSS scope for this page. */
  scopeClass: string;
}

export interface InlineHtmlPreviewOptions {
  /**
   * Add transparent hit boxes for browsers that use the generic picker.
   * Standalone annotation documents keep this enabled; the board surface can
   * disable it so the browser samples the authored element directly.
   */
  includeHitProxies?: boolean;
  /**
   * Keep viewport-positioned generated chrome inside the mobile frame. The
   * standalone annotation document intentionally leaves this disabled so it
   * continues to behave like the authored top-level page.
   */
  constrainViewportPosition?: boolean;
}

const DROP_ELEMENTS = new Set([
  "APPLET",
  "BASE",
  "EMBED",
  "FRAME",
  "FRAMESET",
  "IFRAME",
  "LINK",
  "META",
  "NOFRAMES",
  "NOSCRIPT",
  "OBJECT",
  "PORTAL",
  "SCRIPT",
  "STYLE",
  "TEMPLATE",
]);

const URL_ATTRIBUTES = new Set([
  "ACTION",
  "CITE",
  "FORMACTION",
  "HREF",
  "POSTER",
  "SRC",
  "SRCSET",
  "XLINK:SHOW",
  "XLINK:HREF",
]);

const NON_SCOPED_AT_RULES = new Set([
  // These rules register global browser state. A static annotation preview
  // does not need them, and retaining them would let one card affect another.
  "@charset",
  "@counter-style",
  "@font-face",
  "@font-feature-values",
  "@keyframes",
  "@-webkit-keyframes",
  "@page",
  "@property",
  "@viewport",
]);

const SCOPED_AT_RULES = new Set([
  "@container",
  "@document",
  "@layer",
  "@media",
  "@supports",
  "@starting-style",
]);

function escapeAttribute(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function escapeStyleText(value: string): string {
  // A raw `</style>` would terminate the wrapper's style element when the
  // complete markup is assigned through dangerouslySetInnerHTML.
  return value.replace(/</g, "\\3c ");
}

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
  })[character] ?? character);
}

function hashPageId(pageId: string): string {
  // A tiny deterministic hash keeps arbitrary WebMCP IDs out of selectors.
  let hash = 2166136261;
  for (let index = 0; index < pageId.length; index += 1) {
    hash ^= pageId.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

function findMatchingBrace(value: string, openingIndex: number): number {
  let depth = 1;
  let quote = "";
  let comment = false;
  for (let index = openingIndex + 1; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return value.length - 1;
}

function findTopLevelBoundary(value: string, start: number): { index: number; kind: "brace" | "semicolon" | "end" } {
  let quote = "";
  let comment = false;
  let parentheses = 0;
  let brackets = 0;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (parentheses === 0 && brackets === 0 && character === "{") return { index, kind: "brace" };
    else if (parentheses === 0 && brackets === 0 && character === ";") return { index, kind: "semicolon" };
  }
  return { index: value.length, kind: "end" };
}

function splitSelectors(value: string): string[] {
  const selectors: string[] = [];
  let start = 0;
  let quote = "";
  let parentheses = 0;
  let brackets = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === "[") brackets += 1;
    else if (character === "]") brackets = Math.max(0, brackets - 1);
    else if (character === "," && parentheses === 0 && brackets === 0) {
      selectors.push(value.slice(start, index));
      start = index + 1;
    }
  }
  selectors.push(value.slice(start));
  return selectors;
}

function replaceDocumentSelectors(selector: string, scope: string, bodyScope: string): string {
  let result = "";
  let index = 0;
  let quote = "";
  let bracketDepth = 0;
  while (index < selector.length) {
    const character = selector[index];
    if (quote) {
      result += character;
      if (character === "\\" && index + 1 < selector.length) {
        result += selector[index + 1];
        index += 2;
        continue;
      }
      if (character === quote) quote = "";
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      result += character;
      index += 1;
      continue;
    }
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (bracketDepth === 0 && /[A-Za-z_]/.test(character)) {
      let end = index + 1;
      while (end < selector.length && /[A-Za-z0-9_-]/.test(selector[end] ?? "")) end += 1;
      const token = selector.slice(index, end);
      const previous = selector[index - 1] ?? "";
      if (token === "html" && !/[.#_-]/.test(previous)) result += scope;
      else if (token === "body" && !/[.#_-]/.test(previous)) result += bodyScope;
      else result += token;
      index = end;
      continue;
    }
    result += character;
    index += 1;
  }
  return result;
}

function scopeSelector(selector: string, scope: string, bodyScope: string): string {
  let result = selector.trim();
  if (!result) return "";
  // These selectors refer to the document shell in a complete HTML file. The
  // inline preview uses a body proxy so those rules retain their intent.
  result = result.replace(/:root\b/g, scope).replace(/:host(?:\([^)]*\))?/g, scope);
  result = replaceDocumentSelectors(result, scope, bodyScope);
  if (result === scope || result.startsWith(`${scope} `) || result.startsWith(`${scope}>`) || result.startsWith(`${scope}+`) || result.startsWith(`${scope}~`)) {
    return result;
  }
  if (result === bodyScope || result.startsWith(`${bodyScope} `) || result.startsWith(`${bodyScope}>`)) {
    return result;
  }
  return `${scope} ${result}`;
}

function decodeCssEscapes(value: string): string {
  return value.replace(/\\([0-9a-f]{1,6})(?:\s)?/gi, (_match, hex: string) => {
    const codePoint = Number.parseInt(hex, 16);
    return Number.isFinite(codePoint) ? String.fromCodePoint(Math.min(codePoint, 0x10ffff)) : "";
  });
}

function compactProtocolValue(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code > 32 && code !== 127;
    })
    .join("");
}

function sanitizeCssUrl(value: string): string {
  const normalized = compactProtocolValue(decodeCssEscapes(value)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .trim())
    .toLowerCase();
  if (
    /^(?:javascript|vbscript|file|blob|filesystem):/.test(normalized) ||
    /^data:(?!image\/(?:gif|jpe?g|png|webp);)/.test(normalized)
  ) {
    return "none";
  }
  return value.trim() ? `url("${value.replace(/["\\]/g, "\\$&")}")` : "none";
}

function sanitizeCssUrls(value: string): string {
  return value.replace(/url\(\s*(["']?)([\s\S]*?)\1\s*\)/gi, (_match, _quote: string, url: string) => sanitizeCssUrl(url));
}

function constrainViewportPositionDeclarations(value: string): string {
  const rewriteDeclaration = (declaration: string) => declaration.replace(
    /^((?:\s|\/\*[\s\S]*?\*\/)*position\s*:\s*)(?:fixed|(?:-webkit-)?sticky)\b/i,
    "$1absolute",
  );
  let output = "";
  let start = 0;
  let quote = "";
  let comment = false;
  let parentheses = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const next = value[index + 1];
    if (comment) {
      if (character === "*" && next === "/") {
        comment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "/" && next === "*") {
      comment = true;
      index += 1;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "(") parentheses += 1;
    else if (character === ")") parentheses = Math.max(0, parentheses - 1);
    else if (character === ";" && parentheses === 0) {
      output += `${rewriteDeclaration(value.slice(start, index))};`;
      start = index + 1;
    }
  }
  return output + rewriteDeclaration(value.slice(start));
}

function sanitizeCss(value: string, options: InlineHtmlPreviewOptions = {}): string {
  const sanitized = sanitizeCssUrls(value)
    .replace(/@import[^;]*(?:;|$)/gi, "")
    .replace(/(?:expression|behavior|-moz-binding)\s*:/gi, "blocked:")
    .replace(/<\/?style/gi, "");
  return options.constrainViewportPosition
    ? constrainViewportPositionDeclarations(sanitized)
    : sanitized;
}

/** Scope generated CSS so a preview cannot restyle the board shell. */
export function scopeInlineCss(
  css: string,
  scope: string,
  bodyScope: string,
  options: InlineHtmlPreviewOptions = {},
): string {
  const source = sanitizeCss(toWellFormed(css));
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const boundary = findTopLevelBoundary(source, cursor);
    if (boundary.kind === "end") {
      output += source.slice(cursor);
      break;
    }
    const prelude = source.slice(cursor, boundary.index).trim();
    if (boundary.kind === "semicolon") {
      // Imports and other top-level statements are safe only when they cannot
      // introduce another stylesheet into the host document.
      if (!/^@import\b/i.test(prelude)) output += `${prelude};`;
      cursor = boundary.index + 1;
      continue;
    }
    const closingIndex = findMatchingBrace(source, boundary.index);
    const body = source.slice(boundary.index + 1, closingIndex);
    const atRule = prelude.match(/^@[\w-]+/i)?.[0].toLowerCase() ?? "";
    if (atRule && NON_SCOPED_AT_RULES.has(atRule)) {
      // Global registration rules (fonts, keyframes, print pages, custom
      // properties) would escape the preview scope. The top-level annotation
      // route retains the original document when those features are needed.
      output += "";
    } else if (atRule && SCOPED_AT_RULES.has(atRule)) {
      output += `${prelude}{${scopeInlineCss(body, scope, bodyScope, options)}}`;
    } else if (atRule) {
      // Fail closed for unknown at-rules. Some of them register global state
      // or accept nested imports that cannot be safely scoped here.
      output += "";
    } else {
      const selectors = splitSelectors(prelude)
        .map((selector) => scopeSelector(selector, scope, bodyScope))
        .filter(Boolean)
        .join(", ");
      if (selectors) output += `${selectors}{${sanitizeCss(body, options)}}`;
    }
    cursor = Math.max(closingIndex + 1, boundary.index + 1);
  }

  return output;
}

function isSafeUrl(value: string, attribute: string): boolean {
  const normalized = compactProtocolValue(decodeCssEscapes(value).trim())
    .toLowerCase();
  if (!normalized) return false;
  if (/^(?:javascript|vbscript|file|blob|filesystem):/.test(normalized)) return false;
  if (/^data:/.test(normalized)) {
    return (attribute === "SRC" || attribute === "POSTER") && /^data:image\/(?:gif|jpe?g|png|webp);/i.test(value.trim());
  }
  // Relative, hash, protocol-relative, http, and https links are sufficient
  // for a visual preview. Other schemes can trigger external handlers.
  return /^(?:[a-z][a-z0-9+.-]*:)/i.test(normalized)
    ? /^(?:https?):/i.test(normalized)
    : true;
}

function sanitizeSrcSet(value: string): string {
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter((candidate) => isSafeUrl(candidate.split(/\s+/, 1)[0] ?? "", "SRC"))
    .join(", ");
}

function sanitizeElement(element: Element, options: InlineHtmlPreviewOptions = {}): boolean {
  let removedActiveContent = false;
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name;
    const upperName = name.toUpperCase();
    const lowerName = name.toLowerCase();
    if (lowerName.startsWith("on") || lowerName === "srcdoc" || lowerName === "autofocus") {
      element.removeAttribute(name);
      removedActiveContent = true;
      continue;
    }
    if (upperName === "STYLE") {
      const style = sanitizeCss(attribute.value, options);
      if (style) element.setAttribute(name, style);
      else element.removeAttribute(name);
      continue;
    }
    if (upperName === "SRCSET") {
      const srcSet = sanitizeSrcSet(attribute.value);
      if (srcSet) element.setAttribute(name, srcSet);
      else element.removeAttribute(name);
      continue;
    }
    if (URL_ATTRIBUTES.has(upperName) && !isSafeUrl(attribute.value, upperName)) {
      element.removeAttribute(name);
      removedActiveContent = true;
    }
  }

  // Codex's generic Annotation picker treats the presence of *any* `role`
  // attribute as a candidate, including `presentation` and `none`. Those
  // roles are only accessibility hints and do not describe an actionable
  // generated element, so keeping them on layout wrappers makes the picker
  // stop at the whole preview instead of the heading/control underneath.
  const role = element.getAttribute("role")?.trim().toLowerCase();
  if (role === "presentation" || role === "none") element.removeAttribute("role");

  if (element.tagName === "A" && element.hasAttribute("href")) {
    // Keep the destination available as inspectable metadata, but remove the
    // live navigation affordance from the board preview. The top-level
    // annotation route preserves the original interactive document.
    const href = element.getAttribute("href") ?? "";
    if (isSafeUrl(href, "HREF")) element.setAttribute("data-codex-href", href);
    element.removeAttribute("href");
    element.removeAttribute("target");
    element.removeAttribute("rel");
  }
  if (element.tagName === "FORM") {
    element.setAttribute("data-codex-static-form", "true");
    element.setAttribute("action", "#codex-preview");
    element.setAttribute("method", "get");
    for (const control of Array.from(element.querySelectorAll("button, input, select, textarea"))) {
      if (control.tagName === "BUTTON" && (control.getAttribute("type") ?? "submit").toLowerCase() === "submit") {
        control.setAttribute("type", "button");
      }
    }
  }
  if (element.tagName === "IMG") {
    element.setAttribute("loading", "lazy");
    element.setAttribute("draggable", "false");
  }
  return removedActiveContent;
}

function sanitizeTree(root: Element, options: InlineHtmlPreviewOptions = {}): boolean {
  let removedActiveContent = false;
  for (const element of Array.from(root.querySelectorAll("*"))) {
    if (!element.isConnected) continue;
    if (DROP_ELEMENTS.has(element.tagName)) {
      element.remove();
      removedActiveContent = true;
      continue;
    }
    removedActiveContent = sanitizeElement(element, options) || removedActiveContent;
  }
  return removedActiveContent;
}

const NATIVE_ANNOTATION_TAGS = new Set([
  "H1", "H2", "H3", "H4", "H5", "H6", "P", "BUTTON", "A",
  "INPUT", "TEXTAREA", "SELECT", "LABEL", "IMG", "VIDEO", "AUDIO", "CANVAS",
]);

const NATIVE_ANNOTATION_WRAPPER_TAGS = new Set([
  "NAV", "MAIN", "HEADER", "FOOTER", "SECTION", "ARTICLE", "FORM",
  "FIGURE", "TABLE", "LI", "DIV", "SPAN", "SMALL", "STRONG", "EM",
  "B", "I", "MARK",
]);

/**
 * Dia's picker gives a negative score to boxes whose smallest dimension is
 * below 100px. Mobile controls are commonly much smaller than that, so the
 * generated screen's real button/heading can lose to its surrounding card.
 * A transparent, semantically empty inline element is used as a picker proxy.
 * It keeps a small target's hit box stable while allowing both picker paths to
 * walk to the generated element: Codex's native path follows the ancestor
 * chain, and its generic fallback ignores an empty span before reaching the
 * real heading, paragraph, or control. An IMG proxy would be returned
 * immediately by that fallback, so proxies must never be images or carry a
 * role/label of their own.
 */
const ANNOTATION_PROXY_MIN_SIZE = 112;
/** Attribute shared by the board preview, standalone route, and browser bridge. */
export const ANNOTATION_PROXY_ATTRIBUTE = "data-codex-annotation-hit";
export const ANNOTATION_PROXY_HOST_ATTRIBUTE = "data-codex-annotation-proxy-host";
export const ANNOTATION_PROXY_TARGET_ATTRIBUTE = "data-codex-annotation-target-id";
export const ANNOTATION_PROXY_FOR_ATTRIBUTE = "data-codex-annotation-proxy-for";
export const ANNOTATION_PROXY_KIND_ATTRIBUTE = "data-codex-annotation-proxy-kind";
export const ANNOTATION_NATIVE_ATTRIBUTE = "data-openai-annotatable";
export const ANNOTATION_METADATA_ATTRIBUTE = "data-openai-annotation-metadata";
const ANNOTATION_PROXY_TARGET_PREFIX = "codex-annotation-target-";
const VOID_ANNOTATION_PROXY_TAGS = new Set([
  "AREA", "BASE", "BR", "COL", "EMBED", "HR", "IMG", "INPUT", "LINK",
  "META", "PARAM", "SELECT", "TEXTAREA", "SOURCE", "TRACK", "VIDEO", "AUDIO", "CANVAS", "WBR",
]);

/**
 * Remove hit proxies emitted by pre-span builds. Those proxies were IMG
 * siblings attached to the preview/body and could remain alive during Vite
 * HMR (or in a DOM preserved by a managed browser). The generic picker treats
 * every IMG as an immediate candidate, so leaving one behind makes the whole
 * preview win over the generated control under the pointer.
 */
function removeLegacyAnnotationProxies(root: Element): void {
  // A legacy proxy was appended beside the preview body (and in some builds
  // directly to <body>), so limiting the query to `root` would leave that
  // full-page candidate in place. The owner document is safe here: the
  // reserved attributes are only emitted by this annotation bridge, and the
  // query never removes ordinary generated images.
  root.ownerDocument.querySelectorAll<HTMLElement>(
    `img[${ANNOTATION_PROXY_ATTRIBUTE}], [data-codex-annotation-hit-layer]`,
  ).forEach((proxy) => proxy.remove());
}

function removeAnnotationProxies(root: Element): void {
  root.querySelectorAll<HTMLElement>(`[${ANNOTATION_PROXY_ATTRIBUTE}]`).forEach((proxy) => proxy.remove());
  root.querySelectorAll<HTMLElement>(`[${ANNOTATION_PROXY_HOST_ATTRIBUTE}]`).forEach((target) => {
    target.removeAttribute(ANNOTATION_PROXY_HOST_ATTRIBUTE);
  });
}

function annotationProxyLabel(element: Element): string {
  const labelled = element.getAttribute("aria-label")
    || element.getAttribute("alt")
    || element.getAttribute("placeholder")
    || element.textContent
    || element.tagName.toLowerCase();
  return labelled.replace(/\s+/g, " ").trim().slice(0, 160);
}

function annotationProxySelector(element: Element): string {
  if (element instanceof HTMLElement && element.id && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(element.id)) {
    return `#${element.id}`;
  }
  const parts: string[] = [];
  let current: Element | null = element;
  while (current && current.tagName !== "BODY" && parts.length < 6) {
    let part = current.tagName.toLowerCase();
    if (current instanceof HTMLElement) {
      const className = Array.from(current.classList).find((name) => /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name));
      if (className) part += `.${className}`;
    }
    let ordinal = 1;
    let sibling = current.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === current.tagName) ordinal += 1;
      sibling = sibling.previousElementSibling;
    }
    part += `:nth-of-type(${ordinal})`;
    parts.unshift(part);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

/**
 * Native Annotation metadata is deliberately small and plain JSON. The
 * browser accepts at most six keys, 256 characters per string, and 2 KiB per
 * serialized value; shorter limits here leave room for multibyte labels.
 */
function annotationMetadataText(value: string, limit: number): string {
  const sanitized = toWellFormed(value)
    .replace(/[\p{Cc}\p{Cf}\p{Cs}\u2028\u2029]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return toWellFormed(sanitized.slice(0, limit));
}

function annotationProxyMetadata(element: HTMLElement, targetId: string, sibling: boolean): string {
  return JSON.stringify({
    selector: annotationMetadataText(annotationProxySelector(element), 192),
    tag: annotationMetadataText(element.tagName.toLowerCase(), 32),
    text: annotationMetadataText(annotationProxyLabel(element), 128),
    id: annotationMetadataText(element.id, 128),
    targetId: annotationMetadataText(targetId, 128),
    proxyKind: sibling ? "sibling" : "child",
  });
}

function annotationProxyPriority(element: Element): number {
  const tag = element.tagName;
  if (/^(BUTTON|A|INPUT|TEXTAREA|SELECT|LABEL)$/.test(tag)) return 6;
  if (/^H[1-6]$/.test(tag)) return 5;
  if (/^(P|IMG|VIDEO|AUDIO|CANVAS)$/.test(tag) || hasMeaningfulAnnotationRole(element) || element.hasAttribute("tabindex")) return 4;
  if (/^(DIV|SPAN|SMALL|STRONG|EM|B|I|MARK)$/.test(tag)) return 3;
  return 2;
}

function annotationProxyDepth(element: Element): number {
  let depth = 0;
  let current: Element | null = element;
  while (current && current.parentElement && depth < 64) {
    depth += 1;
    current = current.parentElement;
  }
  return depth;
}

function directAnnotationProxy(element: Element): HTMLElement | null {
  const targetId = element.getAttribute(ANNOTATION_PROXY_TARGET_ATTRIBUTE);
  const child = Array.from(element.children).find((candidate) => (
    candidate.hasAttribute(ANNOTATION_PROXY_ATTRIBUTE)
    && (!targetId || candidate.getAttribute(ANNOTATION_PROXY_FOR_ATTRIBUTE) === targetId)
  ));
  if (child instanceof HTMLElement) return child;

  // Replaced/void elements cannot contain a child proxy. Their proxy is an
  // absolutely positioned sibling, linked with a stable target id instead.
  if (!targetId || !element.parentElement) return null;
  return Array.from(element.parentElement.children).find((candidate) => (
    candidate !== element
    && candidate.getAttribute(ANNOTATION_PROXY_ATTRIBUTE) === "true"
    && candidate.getAttribute(ANNOTATION_PROXY_FOR_ATTRIBUTE) === targetId
  )) as HTMLElement | undefined ?? null;
}

function ensureAnnotationTargetId(element: HTMLElement, index: number): string {
  const existing = element.getAttribute(ANNOTATION_PROXY_TARGET_ATTRIBUTE);
  if (existing?.startsWith(ANNOTATION_PROXY_TARGET_PREFIX)) return existing;
  const root = element.closest("[data-codex-inline-preview]") ?? element.ownerDocument.body ?? element.ownerDocument.documentElement;
  const used = new Set(Array.from(root.querySelectorAll(`[${ANNOTATION_PROXY_TARGET_ATTRIBUTE}]`))
    .map((candidate) => candidate.getAttribute(ANNOTATION_PROXY_TARGET_ATTRIBUTE))
    .filter((value): value is string => Boolean(value)));
  let serial = Math.max(0, index);
  let targetId = `${ANNOTATION_PROXY_TARGET_PREFIX}${serial}`;
  while (used.has(targetId)) {
    serial += 1;
    targetId = `${ANNOTATION_PROXY_TARGET_PREFIX}${serial}`;
  }
  element.setAttribute(ANNOTATION_PROXY_TARGET_ATTRIBUTE, targetId);
  return targetId;
}

function configureAnnotationProxy(proxy: HTMLElement, element: HTMLElement, index: number, sibling: boolean): void {
  const label = annotationProxyLabel(element);
  const targetId = ensureAnnotationTargetId(element, index);
  const metadata = annotationProxyMetadata(element, targetId, sibling);
  proxy.setAttribute(ANNOTATION_PROXY_ATTRIBUTE, "true");
  // The proxy is deliberately not a native annotation target. Native picker
  // mode must walk through it to the original generated node, while the
  // generic fallback must ignore this empty span and do the same. Remove the
  // marker as well as legacy image semantics so hot updates cannot leave an
  // IMG/label candidate behind.
  proxy.removeAttribute(ANNOTATION_NATIVE_ATTRIBUTE);
  proxy.setAttribute(ANNOTATION_METADATA_ATTRIBUTE, metadata);
  proxy.setAttribute(ANNOTATION_PROXY_KIND_ATTRIBUTE, sibling ? "sibling" : "child");
  proxy.setAttribute(ANNOTATION_PROXY_FOR_ATTRIBUTE, targetId);
  proxy.setAttribute("data-codex-annotation-hit-index", String(index));
  proxy.setAttribute("data-codex-annotation-tag", element.tagName.toLowerCase());
  proxy.setAttribute("data-codex-annotation-text", label);
  proxy.setAttribute("data-codex-annotation-selector", annotationProxySelector(element));
  proxy.removeAttribute("src");
  proxy.removeAttribute("alt");
  proxy.removeAttribute("aria-label");
  proxy.setAttribute("aria-hidden", "true");
  // Keep the original target useful when the pointer lands outside the
  // clipped proxy hit box, and refresh this metadata when generated content
  // changes in place.
  element.setAttribute(ANNOTATION_METADATA_ATTRIBUTE, metadata);
  proxy.setAttribute("draggable", "false");
  proxy.style.setProperty("position", "absolute", "important");
  proxy.style.setProperty("left", sibling ? "0px" : "50%", "important");
  proxy.style.setProperty("top", sibling ? "0px" : "50%", "important");
  proxy.style.setProperty("width", `${ANNOTATION_PROXY_MIN_SIZE}px`, "important");
  proxy.style.setProperty("height", `${ANNOTATION_PROXY_MIN_SIZE}px`, "important");
  proxy.style.setProperty("transform", "translate(-50%, -50%)", "important");
  // Keep concrete controls above nearby paragraphs when their 112px hit
  // boxes overlap. The value is intentionally below the browser's chrome
  // controls, which are rendered outside the generated surface.
  proxy.style.setProperty("z-index", String(100000 + annotationProxyPriority(element) * 1000 + annotationProxyDepth(element)), "important");
  proxy.style.setProperty("display", "block", "important");
  proxy.style.setProperty("visibility", "visible", "important");
  proxy.style.setProperty("opacity", "1", "important");
  proxy.style.setProperty("pointer-events", "auto", "important");
  proxy.style.setProperty("box-sizing", "border-box", "important");
  proxy.style.setProperty("max-width", "none", "important");
  proxy.style.setProperty("max-height", "none", "important");
  proxy.style.setProperty("margin", "0", "important");
  proxy.style.setProperty("padding", "0", "important");
  proxy.style.setProperty("border", "0", "important");
  proxy.style.setProperty("background", "transparent", "important");
  proxy.style.setProperty("color", "transparent", "important");
  proxy.style.setProperty("font-size", "0", "important");
  proxy.style.setProperty("line-height", "0", "important");
  proxy.style.setProperty("user-select", "none", "important");
}

/** Add one transparent, picker-friendly proxy to a concrete generated target. */
function addAnnotationProxy(element: HTMLElement, index: number): void {
  const sibling = VOID_ANNOTATION_PROXY_TAGS.has(element.tagName);
  let existing = directAnnotationProxy(element);
  // Older hot-reloaded markup may still contain an IMG proxy. Replacing it is
  // necessary because merely removing its attributes would still make the
  // generic picker return the image by tag name.
  if (existing?.tagName === "IMG") {
    existing.remove();
    existing = null;
  }
  if (existing) {
    // Dynamic generated screens can replace text or attributes without
    // replacing the target node. Refresh the proxy metadata in place so the
    // browser comment contains the current label/selector.
    configureAnnotationProxy(existing, element, index, sibling);
    element.setAttribute(ANNOTATION_PROXY_HOST_ATTRIBUTE, "true");
    if (sibling && existing.parentElement !== element.parentElement) {
      element.parentElement?.insertBefore(existing, element.nextSibling);
    }
    return;
  }

  const proxy = element.ownerDocument.createElement("span");
  configureAnnotationProxy(proxy, element, index, sibling);
  element.setAttribute(ANNOTATION_PROXY_HOST_ATTRIBUTE, "true");

  if (sibling) {
    // A void/replaced element cannot contain children (and browsers may drop
    // them during parsing). Keep the generated node untouched and place the
    // transparent candidate beside it. Runtime layout code positions this
    // sibling over the target's actual client rect.
    element.parentElement?.insertBefore(proxy, element.nextSibling);
    return;
  }

  // Relative positioning does not move the target itself. It gives the
  // absolute child a stable containing block while leaving authored sizing
  // and spacing intact for ordinary generated screens.
  const position = element.style.getPropertyValue("position");
  if (!position || position === "static") element.style.setProperty("position", "relative", "important");
  element.append(proxy);
}

function hasMeaningfulAnnotationRole(element: Element): boolean {
  const role = element.getAttribute("role")?.trim().toLowerCase();
  return Boolean(role && role !== "none" && role !== "presentation");
}

/**
 * The browser's non-site picker (`Ph`) accepts any element carrying a role,
 * while the native site-annotation path uses `data-openai-annotatable`.
 * Generated screens often use plain div/span/small wrappers for controls;
 * give those wrappers a neutral role so both picker paths resolve the same
 * element. Native HTML controls retain their implicit accessibility roles.
 */
function ensurePickerFallbackRole(element: HTMLElement): void {
  if (element.hasAttribute("role")) return;
  if (NATIVE_ANNOTATION_TAGS.has(element.tagName)) return;
  element.setAttribute("role", "generic");
}

function isPotentiallyHidden(element: Element): boolean {
  if (element.hasAttribute("hidden") || element.getAttribute("aria-hidden") === "true") return true;
  const style = element.getAttribute("style") ?? "";
  return /(?:^|[;\s])(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0)(?:[;\s]|$)/i.test(style);
}

function hasAnnotatedAncestor(element: Element, root: Element): boolean {
  for (let current = element.parentElement; current && current !== root; current = current.parentElement) {
    if (current.hasAttribute("data-openai-annotatable")) return true;
  }
  return false;
}

/**
 * Mark actual generated elements for Codex's native Annotation picker. The
 * picker starts at elementFromPoint() and walks ancestors for this attribute;
 * using the original nodes preserves their selector and live element identity.
 */
export function markNativeAnnotationTargets(root: Element, options: InlineHtmlPreviewOptions = {}): void {
  const includeHitProxies = options.includeHitProxies !== false;
  removeLegacyAnnotationProxies(root);
  if (!includeHitProxies) removeAnnotationProxies(root);
  const elements = Array.from(root.querySelectorAll<HTMLElement>("*"));

  elements.forEach((element) => {
    // Proxies are already concrete picker candidates. Treating the IMG proxy
    // itself as a fresh semantic target on a later pass would recursively
    // append more sibling proxies (especially for void elements).
    if (element.hasAttribute(ANNOTATION_PROXY_ATTRIBUTE)) return;
    const role = element.getAttribute("role")?.trim().toLowerCase();
    // `Ph`, the browser's generic fallback, treats any role as a candidate;
    // inert layout roles would therefore mask the generated target. Remove
    // them before the first picker pass, including on standalone documents.
    if (role === "presentation" || role === "none") element.removeAttribute("role");
    if (isPotentiallyHidden(element)) return;
    const explicit = NATIVE_ANNOTATION_TAGS.has(element.tagName)
      || hasMeaningfulAnnotationRole(element)
      || element.hasAttribute("tabindex")
      || Boolean(element.getAttribute("aria-label")?.trim())
      || element.hasAttribute("data-codex-annotatable")
      || element.hasAttribute("data-openai-annotatable");
    if (explicit) {
      element.setAttribute("data-openai-annotatable", "true");
      ensurePickerFallbackRole(element);
    }
  });

  // For anonymous generated cards, expose only the deepest text-bearing
  // wrapper that has no concrete annotated descendant. This avoids a full
  // screen shell masking its heading or controls.
  for (let index = elements.length - 1; index >= 0; index -= 1) {
    const element = elements[index];
    if (!element || isPotentiallyHidden(element) || element.hasAttribute("data-openai-annotatable")) continue;
    if (!NATIVE_ANNOTATION_WRAPPER_TAGS.has(element.tagName)) continue;
    if (hasAnnotatedAncestor(element, root)) continue;
    if (hasMeaningfulAnnotationRole(element) || element.hasAttribute("tabindex") || element.hasAttribute("aria-label") || element.hasAttribute("data-codex-annotatable")) {
      element.setAttribute("data-openai-annotatable", "true");
      ensurePickerFallbackRole(element);
      continue;
    }
    if (element.querySelector("[data-openai-annotatable]")) continue;
    if (!(element.textContent ?? "").replace(/\s+/g, " ").trim()) continue;
    element.setAttribute("data-openai-annotatable", "true");
    ensurePickerFallbackRole(element);
  }

  // Keep a stable identity on every real annotation target even when the
  // board surface disables transparent hit proxies. The direct interaction
  // bridge and the standalone annotation route both use this id to resolve a
  // browser-selected node back to the generated page element.
  const annotatedTargets = Array.from(root.querySelectorAll<HTMLElement>(
    `[${ANNOTATION_NATIVE_ATTRIBUTE}]`,
  )).filter((element) => !element.hasAttribute(ANNOTATION_PROXY_ATTRIBUTE));
  annotatedTargets.forEach((element, index) => {
    const targetId = ensureAnnotationTargetId(element, index);
    if (!element.hasAttribute(ANNOTATION_METADATA_ATTRIBUTE)) {
      element.setAttribute(ANNOTATION_METADATA_ATTRIBUTE, JSON.stringify({
        selector: annotationMetadataText(annotationProxySelector(element), 192),
        tag: annotationMetadataText(element.tagName.toLowerCase(), 32),
        text: annotationMetadataText(annotationProxyLabel(element), 128),
        id: annotationMetadataText(element.id, 128),
        targetId: annotationMetadataText(targetId, 128),
      }));
    }
  });

  // Keep the original generated node as the semantic source of truth, but
  // give Dia a sizeable painted candidate at the same point. Proxies remain
  // inside the generated surface (children where possible, local siblings
  // for void elements), so transforms, canvas zoom, and scrolling stay local.
  if (includeHitProxies) {
    const annotated = Array.from(root.querySelectorAll<HTMLElement>(`[${ANNOTATION_NATIVE_ATTRIBUTE}]`))
      .filter((element) => !element.hasAttribute(ANNOTATION_PROXY_ATTRIBUTE));
    annotated.forEach((element, index) => addAnnotationProxy(element, index));
  }
}

/**
 * Resolve the generated element represented by an annotation proxy. Child
 * proxies can be resolved through their parent, while proxies for void or
 * replaced elements sit beside the target and use the shared target id.
 */
export function getAnnotationProxyTarget(
  proxy: Element,
  root: ParentNode = proxy.ownerDocument,
): HTMLElement | null {
  const targetId = proxy.getAttribute(ANNOTATION_PROXY_FOR_ATTRIBUTE);
  if (!targetId) {
    return proxy.parentElement instanceof HTMLElement ? proxy.parentElement : null;
  }
  const candidates = root.querySelectorAll<HTMLElement>(`[${ANNOTATION_PROXY_TARGET_ATTRIBUTE}]`);
  for (const candidate of Array.from(candidates)) {
    if (candidate.getAttribute(ANNOTATION_PROXY_TARGET_ATTRIBUTE) === targetId) return candidate;
  }
  return null;
}

function serializeBodyAttributes(body: HTMLElement, options: InlineHtmlPreviewOptions = {}): string {
  const attributes = Array.from(body.attributes).filter((attribute) => {
    const name = attribute.name.toLowerCase();
    if (name === "data-openai-annotatable" || name === "data-openai-annotation-container" || name === "data-openai-annotation-metadata") return false;
    return name === "class" || name === "dir" || name === "lang" || name === "style" || name.startsWith("data-") || name.startsWith("aria-");
  });
  return attributes.map((attribute) => {
    const value = attribute.name.toLowerCase() === "style" ? sanitizeCss(attribute.value, options) : attribute.value;
    return value ? ` ${attribute.name}="${escapeAttribute(value)}"` : "";
  }).join("");
}

function fallbackMarkup(source: string, scopeClass: string): string {
  return `<div class="${scopeClass} codex-inline-body" data-codex-inline-body="true" data-openai-annotation-container="true">${escapeText(toWellFormed(source))}</div>`;
}

/** Parse and sanitize generated HTML into a same-document annotation surface. */
export function buildInlineHtmlPreview(source: string, pageId: string, options: InlineHtmlPreviewOptions = {}): InlineHtmlPreview {
  const includeHitProxies = options.includeHitProxies !== false;
  const scopeClass = `codex-inline-preview-${hashPageId(pageId)}`;
  const scope = `.${scopeClass}`;
  const bodyScope = `${scope} > .codex-inline-body`;

  if (typeof DOMParser === "undefined") {
    return { markup: fallbackMarkup(source, scopeClass), removedActiveContent: true, scopeClass };
  }

  try {
    const parsed = new DOMParser().parseFromString(toWellFormed(source), "text/html");
    const styles = Array.from(parsed.querySelectorAll("style"))
      .map((style) => style.textContent ?? "")
      .filter(Boolean)
      .map((style) => scopeInlineCss(style, scope, bodyScope, options));
    const removedActiveContent = sanitizeTree(parsed.documentElement, options);
    parsed.querySelectorAll("style").forEach((style) => style.remove());
    const body = parsed.body ?? parsed.createElement("body");
    markNativeAnnotationTargets(body, { includeHitProxies });
    const bodyAttributes = serializeBodyAttributes(body, options);
    const bodyMarkup = body.innerHTML;
    // Keep wrappers boxless while preserving the generated layout's normal
    // hit-testing. The browser walks from the deepest real node to the
    // official annotation container, so no overlay or pointer-event trap is
    // needed here.
    const baseCss = `${scope}{display:contents!important;position:static!important;width:auto!important;height:auto!important;min-height:0!important;max-height:none!important;overflow:visible!important;background:transparent;color:#20242d;font-family:Inter,system-ui,-apple-system,sans-serif;} ${scope} *{box-sizing:border-box;} ${bodyScope}{display:contents!important;position:static!important;min-height:0!important;max-height:none!important;width:auto!important;height:auto!important;overflow:visible!important;} ${scope} img{max-width:100%;} ${scope} a{cursor:pointer;} ${scope} [data-codex-annotation-hit]{position:absolute!important;display:block!important;visibility:visible!important;opacity:1!important;pointer-events:auto!important;max-width:none!important;max-height:none!important;}`;
    const viewportConstraintCss = options.constrainViewportPosition
      ? `${scope}{display:block!important;position:relative!important;width:100%!important;height:100%!important;min-height:0!important;max-height:100%!important;overflow:hidden!important;contain:layout paint!important;} ${bodyScope}{display:block!important;position:relative!important;width:100%!important;height:100%!important;min-height:0!important;max-height:100%!important;overflow:hidden!important;}`
      : "";
    const styleMarkup = `<style data-codex-inline-style="true">${escapeStyleText(`${baseCss}${styles.join(" ")}${viewportConstraintCss}`)}</style>`;
    const viewportAttribute = options.constrainViewportPosition ? ' data-codex-viewport-constrained="true"' : "";
    const rootAttributes = `class="${scopeClass}" data-codex-inline-preview="true" data-codex-page-id="${escapeAttribute(pageId)}" data-openai-annotation-container="true"${viewportAttribute}`;
    const markup = `${styleMarkup}<div ${rootAttributes}><div class="codex-inline-body" data-codex-inline-body="true"${bodyAttributes}>${bodyMarkup}</div></div>`;
    return { markup, removedActiveContent, scopeClass };
  } catch {
    return { markup: fallbackMarkup(source, scopeClass), removedActiveContent: true, scopeClass };
  }
}
