import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Figma development manifest", () => {
  it("allows only the local clipboard bridge during development", () => {
    const manifest = JSON.parse(readFileSync("figma-plugin/manifest.json", "utf8"));
    expect(manifest.documentAccess).toBe("dynamic-page");
    expect(manifest.networkAccess.allowedDomains).toEqual(["none"]);
    expect(manifest.networkAccess.devAllowedDomains).toEqual(["http://localhost:5183"]);
  });
});
