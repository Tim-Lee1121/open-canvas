import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { DGA_MANIFEST } from "./dgaProvider";
import type { DesignSystemBinding, DesignSystemManifest } from "./types";

export interface DesignSystemRegistry {
  version: 1;
  providers: DesignSystemManifest[];
  bindings: {
    project?: DesignSystemBinding;
    boards: Record<string, DesignSystemBinding>;
    pages: Record<string, DesignSystemBinding>;
  };
  updatedAt: string;
}

export function resolveDesignSystemRegistryPath(root = process.cwd()): string {
  const projectRoot = resolve(root);
  const projectId = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(projectRoot, "..", ".open-canvas-data", `${basename(projectRoot)}-${projectId}`, "design-system-registry.json");
}

export function createInitialDesignSystemRegistry(): DesignSystemRegistry {
  return { version: 1, providers: [DGA_MANIFEST], bindings: { boards: {}, pages: {} }, updatedAt: new Date().toISOString() };
}

export async function readDesignSystemRegistry(filePath = resolveDesignSystemRegistryPath()): Promise<DesignSystemRegistry> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as DesignSystemRegistry;
    if (parsed?.version === 1 && Array.isArray(parsed.providers)) {
      return {
        ...parsed,
        bindings: {
          project: parsed.bindings?.project,
          boards: parsed.bindings?.boards ?? {},
          pages: parsed.bindings?.pages ?? {},
        },
      } as DesignSystemRegistry;
    }
  } catch {
    // Missing or malformed registries are rebuilt from the bundled provider.
  }
  return createInitialDesignSystemRegistry();
}

export async function writeDesignSystemRegistry(registry: DesignSystemRegistry, filePath = resolveDesignSystemRegistryPath()): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(registry, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
}

export async function digestFile(filePath: string): Promise<string> {
  return createHash("sha256").update(await readFile(resolve(filePath))).digest("hex");
}

export function resolveBinding(
  registry: DesignSystemRegistry,
  boardId?: string,
  pageId?: string,
): DesignSystemBinding | undefined {
  return (pageId ? registry.bindings.pages[pageId] : undefined)
    ?? (boardId ? registry.bindings.boards[boardId] : undefined)
    ?? registry.bindings.project;
}

export function providerById(registry: DesignSystemRegistry, id: string): DesignSystemManifest | undefined {
  return registry.providers.find((provider) => provider.id === id);
}
