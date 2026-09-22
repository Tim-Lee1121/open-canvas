import { describe, expect, it } from "vitest";
import { buildInlineHtmlPreview, getAnnotationProxyTarget, markNativeAnnotationTargets, scopeInlineCss } from "./inlineHtml";

describe("inline HTML preview", () => {
  it("keeps visible controls in ordinary DOM and removes active elements", () => {
    const preview = buildInlineHtmlPreview(`<!doctype html><html><head>
      <style>body{margin:0;background:#f5f5f5} h1, button{color:red}</style>
      <link rel="stylesheet" href="https://attacker.invalid/style.css">
    </head><body><main><h1>Annotatable screen</h1><button onclick="alert(1)">Continue</button>
      <script>document.body.innerHTML = "bad"</script><iframe src="https://attacker.invalid"></iframe>
    </main></body></html>`, "page-inline-test");

    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector("[data-codex-inline-preview]");
    expect(surface).not.toBeNull();
    expect(surface!.getAttribute("role")).toBeNull();
    expect(surface!.querySelector(".codex-inline-body")?.getAttribute("role")).toBeNull();
    expect(surface?.querySelector("h1")?.textContent).toContain("Annotatable screen");
    expect(surface?.querySelector("button")?.textContent).toContain("Continue");
    expect(surface?.querySelector("h1")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(surface?.querySelector("button")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(surface?.getAttribute("data-openai-annotation-container")).toBe("true");
    expect(surface?.querySelector("script, iframe, link")).toBeNull();
    expect(surface?.querySelector("[onclick]")).toBeNull();
    expect(preview.removedActiveContent).toBe(true);
    expect(preview.markup).toContain("display:contents");
    expect(surface?.querySelectorAll("[data-codex-annotation-hit]").length).toBeGreaterThan(0);
  });

  it("marks semantic generated elements without marking nested text wrappers", () => {
    const preview = buildInlineHtmlPreview(
      "<main><div class='shell'><h1>Heading</h1><p>Copy</p><button><span>Continue</span></button></div></main>",
      "page-native-annotation",
    );
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector("[data-codex-inline-preview]")!;
    expect(surface.getAttribute("data-openai-annotation-container")).toBe("true");
    expect(surface.querySelector("h1")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(surface.querySelector("p")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(surface.querySelector("button")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(surface.querySelector("span")?.hasAttribute("data-openai-annotatable")).toBe(false);
    expect(surface.querySelector("main")?.hasAttribute("data-openai-annotatable")).toBe(false);
    expect(surface.querySelector(".shell")?.hasAttribute("data-openai-annotatable")).toBe(false);
  });

  it("uses sibling proxies for void and replaced controls without changing their DOM shape", () => {
    const preview = buildInlineHtmlPreview(
      `<main><label>Card number<input placeholder="1234 5678" /></label><select aria-label="Plan"><option>Basic</option></select><textarea aria-label="Notes"></textarea><img alt="Preview" src="data:image/png;base64,AAAA" /><video aria-label="Demo"></video></main>`,
      "page-replaced-annotation",
    );
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector("[data-codex-inline-preview]")!;

    for (const selector of ["input", "select", "textarea", "img:not([data-codex-annotation-hit])", "video"]) {
      const target = surface.querySelector<HTMLElement>(selector);
      expect(target).not.toBeNull();
      expect(target?.getAttribute("data-openai-annotatable")).toBe("true");
      expect(target?.getAttribute("data-codex-annotation-target-id")).toBeTruthy();
      expect(target?.querySelector("[data-codex-annotation-hit]")).toBeNull();
      const proxy = target?.nextElementSibling as HTMLElement | null;
      expect(proxy).not.toBeNull();
      expect(proxy?.tagName).toBe("SPAN");
      expect(proxy?.getAttribute("data-codex-annotation-hit")).toBe("true");
      expect(proxy?.hasAttribute("data-openai-annotatable")).toBe(false);
      expect(proxy?.getAttribute("role")).toBeNull();
      expect(proxy?.getAttribute("aria-label")).toBeNull();
      expect(proxy?.getAttribute("data-codex-annotation-proxy-kind")).toBe("sibling");
      expect(proxy?.getAttribute("data-codex-annotation-proxy-for")).toBe(target?.getAttribute("data-codex-annotation-target-id"));
      expect(getAnnotationProxyTarget(proxy!, surface)).toBe(target);
    }
  });

  it("keeps proxy injection idempotent when the target marker runs again", () => {
    const preview = buildInlineHtmlPreview("<main><input placeholder='Email'><button>Save</button></main>", "page-idempotent");
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector("[data-codex-inline-preview]")!;
    const before = surface.querySelectorAll("[data-codex-annotation-hit]").length;

    markNativeAnnotationTargets(surface.querySelector(".codex-inline-body")!);

    expect(surface.querySelectorAll("[data-codex-annotation-hit]")).toHaveLength(before);
  });

  it("removes legacy full-page image proxies during normalization", () => {
    const preview = buildInlineHtmlPreview("<main><button>Continue</button></main>", "page-legacy-proxy");
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector("[data-codex-inline-preview]")!;
    const legacy = parsed.createElement("img");
    legacy.setAttribute("data-codex-annotation-hit", "true");
    legacy.setAttribute("data-codex-page-id", "page-legacy-proxy");
    parsed.body.append(legacy);
    const layer = parsed.createElement("div");
    layer.setAttribute("data-codex-annotation-hit-layer", "true");
    parsed.body.append(layer);

    markNativeAnnotationTargets(surface.querySelector(".codex-inline-body")!);

    expect(parsed.querySelector("img[data-codex-annotation-hit]")).toBeNull();
    expect(parsed.querySelector("[data-codex-annotation-hit-layer]")).toBeNull();
    expect(surface.querySelector("button")).not.toBeNull();
    expect(surface.querySelector("button")?.getAttribute("data-openai-annotatable")).toBe("true");
  });

  it("keeps neutral proxies out of the generic picker candidate path", () => {
    const preview = buildInlineHtmlPreview(
      "<main><h1>Heading</h1><p>Copy</p><button>Continue</button></main>",
      "page-picker-fallback",
    );
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector("[data-codex-inline-preview]")!;
    const proxies = Array.from(surface.querySelectorAll<HTMLElement>("[data-codex-annotation-hit]"));

    expect(proxies.length).toBeGreaterThan(0);
    proxies.forEach((proxy) => {
      expect(proxy.tagName).toBe("SPAN");
      expect(proxy.textContent).toBe("");
      expect(proxy.getAttribute("role")).toBeNull();
      expect(proxy.hasAttribute("data-openai-annotatable")).toBe(false);
    });
  });

  it("adds a neutral fallback role to custom generated targets", () => {
    const preview = buildInlineHtmlPreview(
      "<main><div class='cta'>Continue</div><small>Label</small></main>",
      "page-picker-role",
    );
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector("[data-codex-inline-preview]")!;

    const cta = surface.querySelector<HTMLElement>(".cta");
    const label = surface.querySelector<HTMLElement>("small");
    expect(cta).not.toBeNull();
    expect(cta?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(cta?.getAttribute("role")).toBe("generic");
    expect(label).not.toBeNull();
    expect(label?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(label?.getAttribute("role")).toBe("generic");
  });

  it("can omit generic picker proxies for an embedded board surface", () => {
    const preview = buildInlineHtmlPreview(
      "<main><h1>Heading</h1><button>Continue</button></main>",
      "page-no-proxy",
      { includeHitProxies: false },
    );
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector("[data-codex-inline-preview]")!;

    expect(surface.querySelector("[data-openai-annotatable]")) .not.toBeNull();
    expect(surface.querySelector("[data-codex-annotation-hit]")).toBeNull();
    expect(surface.querySelector("h1")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(surface.querySelector("button")?.getAttribute("data-openai-annotatable")).toBe("true");
  });

  it("constrains viewport-positioned elements to the embedded mobile frame", () => {
    const preview = buildInlineHtmlPreview(
      `<style>
        .top-nav { position: fixed; top: 0 }
        .bottom-nav { position: sticky !important; bottom: 0 }
        .label::before { content: "position: fixed" }
      </style>
      <body style="position: fixed; inset: 0">
        <nav class="top-nav">Top</nav>
        <footer class="bottom-nav" style="position: -webkit-sticky">Bottom</footer>
      </body>`,
      "page-viewport-constraint",
      { constrainViewportPosition: true },
    );
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const surface = parsed.querySelector<HTMLElement>("[data-codex-inline-preview]");
    const css = parsed.querySelector("[data-codex-inline-style]")?.textContent ?? "";

    expect(surface?.getAttribute("data-codex-viewport-constrained")).toBe("true");
    expect(surface?.querySelector(".codex-inline-body")?.getAttribute("style")).toContain("position: absolute");
    expect(surface?.querySelector("footer")?.getAttribute("style")).toContain("position: absolute");
    expect(css).toMatch(/\.top-nav\s*\{\s*position: absolute/);
    expect(css).toMatch(/\.bottom-nav\s*\{\s*position: absolute !important/);
    expect(css).toContain('content: "position: fixed"');
    expect(css).toContain("contain:layout paint!important");
    expect(css).toContain("overflow:hidden!important");
  });

  it("scopes document selectors and keeps body rules on the body proxy", () => {
    const css = scopeInlineCss(
      "html, body { margin: 0 } :root { --accent: red } @media (max-width: 500px) { body > main { padding: 8px } }",
      ".codex-page",
      ".codex-page > .codex-inline-body",
    );

    expect(css).toMatch(/\.codex-page, \.codex-page > \.codex-inline-body\s*\{\s*margin: 0\s*\}/);
    expect(css).toMatch(/\.codex-page\s*\{\s*--accent: red\s*\}/);
    expect(css).toMatch(/@media \(max-width: 500px\)\s*\{\.codex-page > \.codex-inline-body > main\s*\{\s*padding: 8px\s*\}\s*\}/);
    expect(scopeInlineCss("@font-face{font-family:x;src:url(https://attacker.invalid/x)} @keyframes spin{to{transform:rotate(1turn)}}", ".codex-page", ".codex-page > .codex-inline-body")).toBe("");
    expect(scopeInlineCss("[data-html='body']{color:red}", ".codex-page", ".codex-page > .codex-inline-body")).toContain("[data-html='body']");
  });

  it("removes dangerous resource protocols from attributes and styles", () => {
    const preview = buildInlineHtmlPreview(
      `<main style="background:url(javascript:alert(1));color:blue"><a href="javascript:alert(1)">bad</a><img src="data:text/html,<script>alert(1)</script>"><img src="data:image/png;base64,AAAA"></main>`,
      "page-protocol-test",
    );
    const parsed = new DOMParser().parseFromString(preview.markup, "text/html");
    const main = parsed.querySelector("main");
    expect(main?.getAttribute("style") ?? "").not.toContain("javascript:");
    expect(parsed.querySelector("a")?.hasAttribute("href")).toBe(false);
    const sourceImages = Array.from(parsed.querySelectorAll("img")).filter((image) => !image.hasAttribute("data-codex-annotation-hit"));
    expect(sourceImages[0]?.hasAttribute("src")).toBe(false);
    expect(sourceImages[1]?.getAttribute("src")).toBe("data:image/png;base64,AAAA");

    const obfuscated = buildInlineHtmlPreview(`<main style="background:url(j\\61vascript:alert(1))"><img src="\\6a avascript:alert(1)"></main>`, "page-obfuscated-test");
    const obfuscatedDocument = new DOMParser().parseFromString(obfuscated.markup, "text/html");
    expect(obfuscatedDocument.querySelector("main")?.getAttribute("style") ?? "").not.toContain("javascript");
    expect(obfuscatedDocument.querySelector("img")?.hasAttribute("src")).toBe(false);
  });
});
