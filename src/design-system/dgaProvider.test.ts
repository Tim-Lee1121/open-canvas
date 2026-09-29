import { describe, expect, it } from "vitest";
import { DGA_MANIFEST, getDesignContext, validateHtmlDesign } from "./dgaProvider";

describe("DGA Design System provider", () => {
  it("returns a bounded context bundle for the selected theme and intent", () => {
    const context = getDesignContext("analytics chart dashboard", "dark");
    expect(context.system).toMatchObject({ id: DGA_MANIFEST.id, version: DGA_MANIFEST.version, theme: "dark" });
    expect(context.patterns.map((pattern) => pattern.slug)).toEqual(["chart-card-composition"]);
    expect(context.tokens.some((token) => token.id === "theme.dark")).toBe(true);
    expect(context.tokens.some((token) => token.id === "theme.light")).toBe(false);
    expect(context.provenance).toContain(`${DGA_MANIFEST.knowledgeRoot}/_rag/index.json`);
  });

  it("keeps historical pages unbound until metadata is explicitly present", () => {
    expect(validateHtmlDesign("<main><button>Query</button></main>")).toMatchObject({ status: "unbound" });
  });

  it("blocks unknown contracts and reports missing digest provenance", () => {
    const result = validateHtmlDesign(`<!doctype html><html><head>
      <meta name="open-canvas-design-system" content="dga-design-system@1.0.0">
      <meta name="open-canvas-design-theme" content="light">
      </head><body><main data-ds-pattern="unknown-pattern"><button data-ds-component="unknown-control" aria-label="Query">Query</button></main></body></html>`);
    expect(result.status).toBe("blocked");
    expect(result.issues.map((item) => item.code)).toEqual(expect.arrayContaining(["provenance-missing", "unknown-component", "unknown-pattern"]));
  });
});
