import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectInlineIconAssets, syncInlineIconAssets } from "./icon-assets";

const ARROW = `<svg data-icon="arrow-right" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14"/><path d="m13 6 6 6-6 6" /></svg>`;

describe("generated page icon assets", () => {
  it("collects inline path icons and writes matching standalone SVG files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "neuxmind-icons-"));
    const htmlFile = join(directory, "generated-pages", "checkout", "index.html");
    const outputs = await syncInlineIconAssets(htmlFile, `<main>${ARROW}${ARROW}</main>`);

    expect(outputs).toHaveLength(1);
    const svg = await readFile(join(directory, "generated-pages", "checkout", "assets", "icons", "arrow-right.svg"), "utf8");
    expect(svg).toContain('data-icon="arrow-right"');
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('d="M5 12h14"');
    expect(svg).toContain('d="m13 6 6 6-6 6"');
  });

  it("allows pages without icons", () => {
    expect(collectInlineIconAssets("<main><h1>No icons</h1></main>")).toEqual([]);
  });

  it("requires data-icon, viewBox, and path-only geometry", () => {
    expect(() => collectInlineIconAssets('<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'))
      .toThrow("data-icon");
    expect(() => collectInlineIconAssets('<svg data-icon="close"><path d="M0 0"/></svg>'))
      .toThrow("viewBox");
    expect(() => collectInlineIconAssets('<svg data-icon="close" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>'))
      .toThrow("convert vector shapes");
    expect(() => collectInlineIconAssets('<svg data-icon="close" viewBox="0 0 24 24"><path d="M0 0"/>'))
      .toThrow("complete");
  });

  it("rejects inconsistent duplicate names and external icon mechanisms", () => {
    expect(() => collectInlineIconAssets(`${ARROW}<svg data-icon="arrow-right" viewBox="0 0 24 24"><path d="M0 0"/></svg>`))
      .toThrow("inconsistent");
    expect(() => collectInlineIconAssets('<svg data-icon="menu" viewBox="0 0 24 24"><use href="#menu"/></svg>'))
      .toThrow("<use>");
    expect(() => collectInlineIconAssets('<img src="icons/menu.svg" alt="Menu">'))
      .toThrow("<img>");
    expect(() => collectInlineIconAssets('<span class="material-icons">menu</span>'))
      .toThrow("Icon fonts");
  });
});
