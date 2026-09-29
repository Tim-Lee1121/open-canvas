import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Figma importer bridge URL order", () => {
  it("tries the manifest-allowed localhost bridge before the numeric loopback fallback", () => {
    const source = readFileSync("figma-plugin/ui.html", "utf8");
    const localhostUrl = source.indexOf("http://localhost:${candidate}/__codex_clipboard__");
    const numericLoopbackUrl = source.indexOf("http://127.0.0.1:${candidate}/__codex_clipboard__");
    expect(localhostUrl).toBeGreaterThan(-1);
    expect(numericLoopbackUrl).toBeGreaterThan(-1);
    expect(localhostUrl).toBeLessThan(numericLoopbackUrl);
  });
});
