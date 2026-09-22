import { afterEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "../test/fixtures";
import {
  ANNOTATION_ROUTE_PREFIX,
  ANNOTATION_SERVER_MARKER,
  ANNOTATION_STORAGE_PREFIX,
  ANNOTATION_INLINE_HASH_PREFIX,
  ANNOTATION_CLEANUP_DELAY_MS,
  consumeAnnotationDocument,
  decodeAnnotationDocumentHash,
  encodeAnnotationDocumentHash,
  getAnnotationTarget,
  getAnnotationToken,
  getPreferredAnnotationTarget,
  navigateAnnotationTarget,
  openAnnotationPreview,
  openAnnotationPreviewWhenReady,
  openAnnotationTarget,
  prepareAnnotationPreview,
  readAnnotationDocument,
} from "./annotation";

const htmlPage = () => createSeedState().pagesById["page-demo-welcome"];

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.querySelector(`meta[name="${ANNOTATION_SERVER_MARKER}"]`)?.remove();
  window.localStorage.clear();
});

describe("annotation targets", () => {
  it("opens URL pages directly", () => {
    const page = createSeedState().pagesById["page-demo-example"];
    expect(getAnnotationTarget(page)).toBe("https://www.example.com/");
    expect(getPreferredAnnotationTarget(page)).toEqual({ url: "https://www.example.com/" });
  });

  it("builds a self-contained HTML fallback with page metadata", () => {
    const page = htmlPage();
    const target = getAnnotationTarget(page);
    expect(target.startsWith("data:text/html;charset=utf-8,")).toBe(true);
    const documentText = decodeURIComponent(target.slice(target.indexOf(",") + 1));
    expect(documentText).toContain('name="codex-page-id" content="page-demo-welcome"');
    expect(documentText).toContain('name="codex-page-title" content="Welcome concept"');
    expect(documentText).toContain("<title>Mobile welcome</title>");
  });

  it("round-trips non-ASCII generated HTML through the compact hash", () => {
    const source = "<!doctype html><main lang=\"zh-CN\">你好，标注页面</main>";
    const hash = encodeAnnotationDocumentHash(source);

    expect(hash).toMatch(/^#html=b64\./);
    expect(decodeAnnotationDocumentHash(hash)).toBe(source);
  });

  it("falls back to URI encoding when paired base64 codecs are unavailable", () => {
    vi.stubGlobal("TextDecoder", undefined);
    const source = "<main>codec fallback</main>";
    const hash = encodeAnnotationDocumentHash(source);

    expect(hash).not.toContain("b64.");
    expect(decodeAnnotationDocumentHash(hash)).toBe(source);
  });

  it("stages HTML in a same-origin top-level route for browser annotation", () => {
    const createObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL });

    const target = getPreferredAnnotationTarget(htmlPage());

    expect(target.url).toMatch(new RegExp(`${ANNOTATION_ROUTE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}page-demo-welcome#html=`));
    expect(target.revoke).toBeUndefined();
    expect(createObjectURL).not.toHaveBeenCalled();

    const pathname = target.url.slice(target.url.indexOf(ANNOTATION_ROUTE_PREFIX), target.url.indexOf("#"));
    const token = getAnnotationToken(pathname);
    expect(token).toBeTruthy();
    expect(decodeAnnotationDocumentHash(target.url.slice(target.url.indexOf("#")))).toContain('name="codex-page-id"');
    expect(consumeAnnotationDocument(token!)).toBeNull();
    expect(window.localStorage.getItem(`${ANNOTATION_STORAGE_PREFIX}${token}`)).toBeNull();
  });

  it("keeps the self-contained route when temporary storage is unavailable", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });

    const target = getPreferredAnnotationTarget(htmlPage());

    expect(target.url).toContain(`${ANNOTATION_ROUTE_PREFIX}page-demo-welcome#html=`);
    expect(target.revoke).toBeUndefined();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("uses the storage route only for documents larger than the inline URL budget", () => {
    const page = {
      ...htmlPage(),
      source: { type: "html" as const, value: `<main>${"%".repeat(2_000_000)}</main>` },
    };

    const target = getPreferredAnnotationTarget(page);

    expect(target.url).toMatch(new RegExp(`${ANNOTATION_ROUTE_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}annotation-`));
    expect(target.url).not.toContain(ANNOTATION_INLINE_HASH_PREFIX);
    expect(target.revoke).toEqual(expect.any(Function));
    const token = getAnnotationToken(target.url.slice(target.url.indexOf(ANNOTATION_ROUTE_PREFIX)));
    expect(token).toBeTruthy();
    expect(readAnnotationDocument(token!)).toContain("<main");
    expect(readAnnotationDocument(token!)).toContain("<main");
    expect(readAnnotationDocument(token!, undefined, Date.now() + ANNOTATION_CLEANUP_DELAY_MS + 1)).toBeNull();
  });

  it("uses a native target link when the popup API throws", () => {
    vi.spyOn(window, "open").mockImplementation(() => {
      throw new Error("popup unavailable");
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    expect(openAnnotationTarget("/annotation-preview")).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("uses a native target link when the popup API returns null", () => {
    vi.spyOn(window, "open").mockImplementation(() => null);
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);

    expect(openAnnotationTarget("/annotation-preview")).toBe(true);
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("clears the opener when a popup handle is available", () => {
    const popup = {} as Window;
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.spyOn(window, "open").mockReturnValue(popup);

    expect(openAnnotationTarget("/annotation-preview")).toBe(true);
    expect(popup.opener).toBeNull();
    expect(click).not.toHaveBeenCalled();
  });

  it("navigates the active tab to a top-level annotation target", () => {
    const navigations: Array<{ href: string; target: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      navigations.push({ href: this.href, target: this.target });
    });

    expect(navigateAnnotationTarget("/__codex_annotation__/page-demo")).toBe(true);
    expect(navigations[0]).toEqual({
      href: `${window.location.origin}/__codex_annotation__/page-demo`,
      target: "_self",
    });
  });

  it("opens HTML in the active tab through a real top-level annotation route", () => {
    const navigations: Array<{ href: string; target: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      navigations.push({ href: this.href, target: this.target });
    });

    expect(openAnnotationPreview(htmlPage())).toBe(true);
    expect(navigations[0]?.href).toContain(`${window.location.origin}${ANNOTATION_ROUTE_PREFIX}page-demo-welcome#html=`);
    expect(navigations[0]?.target).toBe("_self");
  });

  it("navigates immediately while staging continues in the background", () => {
    const marker = document.createElement("meta");
    marker.name = ANNOTATION_SERVER_MARKER;
    document.head.append(marker);
    let resolveFetch: (value: unknown) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
    const navigations: Array<{ href: string; target: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      navigations.push({ href: this.href, target: this.target });
    });
    const page = { ...htmlPage(), id: "page-pending-stage", updatedAt: "2026-02-01T00:00:00.000Z" };

    expect(openAnnotationPreview(page)).toBe(true);
    expect(navigations[0]?.href).toContain(`${window.location.origin}${ANNOTATION_ROUTE_PREFIX}page-pending-stage#html=`);
    expect(navigations[0]?.target).toBe("_self");
    resolveFetch({
      ok: true,
      json: async () => ({ url: `${window.location.origin}/__codex_annotation__/staged/annotation-pending` }),
    });
    return Promise.resolve().then(() => Promise.resolve()).then(() => {
      expect(navigations).toHaveLength(1);
    });
  });

  it("waits for a cold staging request before navigating", async () => {
    const marker = document.createElement("meta");
    marker.name = ANNOTATION_SERVER_MARKER;
    document.head.append(marker);
    let resolveFetch: (value: unknown) => void = () => undefined;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; })));
    const navigations: Array<{ href: string; target: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      navigations.push({ href: this.href, target: this.target });
    });
    const page = { ...htmlPage(), id: "page-cold-stage", updatedAt: "2026-02-02T00:00:00.000Z" };

    const opening = openAnnotationPreviewWhenReady(page);
    await Promise.resolve();
    expect(navigations).toHaveLength(0);

    resolveFetch({
      ok: true,
      json: async () => ({ url: `${window.location.origin}/__codex_annotation__/staged/annotation-cold` }),
    });
    await expect(opening).resolves.toBe(true);
    expect(navigations[0]?.href).toContain("/staged/annotation-cold");
    expect(navigations[0]?.target).toBe("_self");
  });

  it("re-stages a generated page after the server snapshot expires", async () => {
    const marker = document.createElement("meta");
    marker.name = ANNOTATION_SERVER_MARKER;
    document.head.append(marker);
    vi.useFakeTimers();
    const initialTime = Date.now();
    const stagedUrls = [
      `${window.location.origin}/__codex_annotation__/staged/annotation-first`,
      `${window.location.origin}/__codex_annotation__/staged/annotation-second`,
    ];
    const fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ url: stagedUrls.shift() }),
    }));
    vi.stubGlobal("fetch", fetch);
    const navigations: Array<{ href: string; target: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      navigations.push({ href: this.href, target: this.target });
    });
    const page = { ...htmlPage(), id: "page-expiring-stage", updatedAt: "2026-02-03T00:00:00.000Z" };

    prepareAnnotationPreview(page);
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    expect(openAnnotationPreview(page)).toBe(true);
    expect(navigations[0]?.href).toContain("annotation-first");

    vi.setSystemTime(initialTime + ANNOTATION_CLEANUP_DELAY_MS + 1);
    expect(openAnnotationPreview(page)).toBe(true);
    expect(navigations).toHaveLength(2);
    expect(navigations[1]?.href).toContain(`${ANNOTATION_ROUTE_PREFIX}page-expiring-stage#html=`);
    for (let index = 0; index < 6; index += 1) await Promise.resolve();
    expect(navigations).toHaveLength(2);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed annotation route tokens", () => {
    expect(getAnnotationToken("/other/annotation-token")).toBeNull();
    expect(getAnnotationToken(`${ANNOTATION_ROUTE_PREFIX}bad%2Ftoken`)).toBeNull();
    expect(getAnnotationToken(`${ANNOTATION_ROUTE_PREFIX}annotation-valid_token`)).toBe("annotation-valid_token");
    expect(getAnnotationToken(`${ANNOTATION_ROUTE_PREFIX}page.custom~id`)).toBe("page.custom~id");
  });

  it("injects metadata into a complete document that has no head", () => {
    const page = { ...htmlPage(), source: { type: "html" as const, value: "<!doctype html><html><body><main>screen</main></body></html>" } };
    const documentText = decodeURIComponent(getAnnotationTarget(page).split(",", 2)[1]);

    expect(documentText).toContain("<html><head>");
    expect(documentText).toContain('name="codex-page-id"');
    expect(documentText).toContain('http-equiv="Content-Security-Policy"');
    expect(documentText).toContain("<body");
    expect(documentText).toContain("<main");
  });

  it("does not treat head/title text inside comments or scripts as document structure", () => {
    const page = {
      ...htmlPage(),
      source: {
        type: "html" as const,
        value: "<!doctype html><html><head><!-- <title>fake</title> --><script>const sample = '<head>fake</head>';</script></head><body><main>screen</main></body></html>",
      },
    };
    const documentText = decodeURIComponent(getAnnotationTarget(page).split(",", 2)[1]);
    const parsed = new DOMParser().parseFromString(documentText, "text/html");

    expect(parsed.head.querySelectorAll("title")).toHaveLength(1);
    expect(parsed.head.querySelector("title")?.textContent).toBe(page.title);
    expect(parsed.head.querySelector('meta[name="codex-page-id"]')?.getAttribute("content")).toBe(page.id);
    expect(parsed.body.textContent).toContain("screen");
  });

  it("adds the annotation hit bridge to the standalone document", () => {
    const documentText = decodeURIComponent(getAnnotationTarget(htmlPage()).split(",", 2)[1]);
    const parsed = new DOMParser().parseFromString(documentText, "text/html");
    const bridge = parsed.querySelector('script[data-codex-annotation-bridge="true"]');

    expect(bridge).not.toBeNull();
    expect(bridge?.textContent).toContain("data-openai-annotatable");
    expect(bridge?.textContent).toContain("data-openai-annotation-container");
    expect(bridge?.textContent).toContain("data-codex-annotation-hit");
    expect(bridge?.textContent).toContain("MutationObserver");
    expect(bridge?.textContent).toContain("observer.observe(root");
    expect(() => new Function(bridge?.textContent ?? "")).not.toThrow();
  });

  it("replaces a source CSP instead of letting it block the annotation bridge", () => {
    const page = {
      ...htmlPage(),
      source: {
        type: "html" as const,
        value: "<!doctype html><html><head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; script-src 'none'\"></head><body><button>Review</button></body></html>",
      },
    };
    const documentText = decodeURIComponent(getAnnotationTarget(page).split(",", 2)[1]);
    const parsed = new DOMParser().parseFromString(documentText, "text/html");
    const policies = Array.from(parsed.head.querySelectorAll<HTMLMetaElement>('meta[http-equiv]')).filter((meta) => /content-security-policy/i.test(meta.httpEquiv));

    expect(policies).toHaveLength(1);
    expect(policies[0]?.content).toBe("sandbox allow-scripts");
    expect(parsed.querySelector('script[data-codex-annotation-bridge="true"]')).not.toBeNull();
  });

  it("marks standalone generated controls with native annotation attributes", () => {
    const page = {
      ...htmlPage(),
      source: { type: "html" as const, value: "<main><h1>Heading</h1><button><span>Continue</span></button></main>" },
    };
    const documentText = decodeURIComponent(getAnnotationTarget(page).split(",", 2)[1]);
    const parsed = new DOMParser().parseFromString(documentText, "text/html");
    expect(parsed.body.getAttribute("data-openai-annotation-container")).toBe("true");
    expect(parsed.querySelector("h1")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(parsed.querySelector("button")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(parsed.querySelector("span")?.hasAttribute("data-openai-annotatable")).toBe(false);
  });

  it("adds sizeable child proxies with traceable target metadata", () => {
    const page = {
      ...htmlPage(),
      source: { type: "html" as const, value: "<main><h1>Heading</h1><button>Continue</button><p>Details</p></main>" },
    };
    const documentText = decodeURIComponent(getAnnotationTarget(page).split(",", 2)[1]);
    const parsed = new DOMParser().parseFromString(documentText, "text/html");
    const button = parsed.querySelector("button");
    const proxy = button?.querySelector("span[data-codex-annotation-hit]") as HTMLElement | null;

    expect(proxy).not.toBeNull();
    expect(proxy?.tagName).toBe("SPAN");
    expect(proxy?.getAttribute("data-codex-annotation-tag")).toBe("button");
    expect(proxy?.getAttribute("data-codex-annotation-text")).toBe("Continue");
    expect(proxy?.getAttribute("data-codex-annotation-selector")).toContain("button");
    expect(proxy?.style.width).toBe("112px");
    expect(proxy?.style.height).toBe("112px");
    expect(proxy?.style.pointerEvents).toBe("auto");
    expect(proxy?.hasAttribute("data-openai-annotatable")).toBe(false);
    expect(proxy?.getAttribute("role")).toBeNull();
    expect(proxy?.getAttribute("aria-label")).toBeNull();
  });

  it("adds sibling proxies for replaced controls in the standalone document", () => {
    const page = {
      ...htmlPage(),
      source: {
        type: "html" as const,
        value: "<main><label>Card number<input placeholder='1234 5678' /></label><img alt='Preview' src='data:image/png;base64,AAAA' /><select aria-label='Plan'><option>Basic</option></select><textarea aria-label='Notes'></textarea></main>",
      },
    };
    const documentText = decodeURIComponent(getAnnotationTarget(page).split(",", 2)[1]);
    const parsed = new DOMParser().parseFromString(documentText, "text/html");

    for (const selector of ["input", "img:not([data-codex-annotation-hit])", "select", "textarea"]) {
      const target = parsed.querySelector<HTMLElement>(selector);
      expect(target?.getAttribute("data-openai-annotatable")).toBe("true");
      const targetId = target?.getAttribute("data-codex-annotation-target-id");
      expect(targetId).toBeTruthy();
      expect(target?.querySelector("span[data-codex-annotation-hit]")).toBeNull();
      const proxy = target?.nextElementSibling;
      expect(proxy?.tagName).toBe("SPAN");
      expect(proxy?.getAttribute("data-codex-annotation-hit")).toBe("true");
      expect(proxy?.getAttribute("data-codex-annotation-proxy-kind")).toBe("sibling");
      expect(proxy?.getAttribute("data-codex-annotation-proxy-for")).toBe(targetId);
      expect(proxy?.hasAttribute("data-openai-annotatable")).toBe(false);
    }
  });

  it("keeps malformed Unicode encodable", () => {
    const page = { ...htmlPage(), title: "Broken \ud800 title", source: { type: "html" as const, value: "<main>\udfff</main>" } };

    expect(() => getAnnotationTarget(page)).not.toThrow();
    const documentText = decodeURIComponent(getAnnotationTarget(page).split(",", 2)[1]);
    expect(documentText).toContain("Broken � title");
    expect(documentText).toContain("<main");
    const parsed = new DOMParser().parseFromString(documentText, "text/html");
    expect(parsed.querySelector("main")?.textContent).toContain("�");
  });
});
