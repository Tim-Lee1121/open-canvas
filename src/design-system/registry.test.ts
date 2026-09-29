import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DGA_MANIFEST } from "./dgaProvider";
import { createInitialDesignSystemRegistry, readDesignSystemRegistry, resolveBinding, writeDesignSystemRegistry } from "./registry";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Design System registry", () => {
  it("resolves page, board, and project bindings in precedence order", () => {
    const registry = createInitialDesignSystemRegistry();
    const binding = (theme: string) => ({ primary: { id: DGA_MANIFEST.id, name: DGA_MANIFEST.name, version: DGA_MANIFEST.version, source: DGA_MANIFEST.source, status: DGA_MANIFEST.status, theme } });
    registry.bindings.project = binding("light");
    registry.bindings.boards.board = binding("dark");
    registry.bindings.pages.page = binding("light");
    expect(resolveBinding(registry, "board", "page")?.primary.theme).toBe("light");
    expect(resolveBinding(registry, "board", "other")?.primary.theme).toBe("dark");
    expect(resolveBinding(registry, "other", "other")?.primary.theme).toBe("light");
  });

  it("writes and reads the sidecar registry with private permissions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "open-canvas-registry-"));
    temporaryDirectories.push(directory);
    const filePath = join(directory, "nested", "design-system-registry.json");
    const registry = createInitialDesignSystemRegistry();
    await writeDesignSystemRegistry(registry, filePath);
    expect(JSON.parse(await readFile(filePath, "utf8"))).toMatchObject({ version: 1 });
    expect((await stat(filePath)).mode & 0o777).toBe(0o600);
    expect(await readDesignSystemRegistry(filePath)).toEqual(registry);
  });
});
