// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServer } from "vite";
import { resolveProjectStatePath } from "./board-state";
import { createPrivateFileGuard, isPrivateStaticPath } from "./private-file-guard";

describe("private static file guard", () => {
  it("blocks board state and non-demo generated pages", () => {
    expect(isPrivateStaticPath("/data/board-state.json")).toBe(true);
    expect(isPrivateStaticPath("/data/board-state.json.tmp")).toBe(true);
    expect(isPrivateStaticPath("/generated-pages/arena-house/index.html")).toBe(true);
    expect(isPrivateStaticPath("/generated-pages/%61rena-house/index.html")).toBe(true);
    expect(isPrivateStaticPath("/generated-pages/%2561rena-house/index.html")).toBe(true);
    expect(isPrivateStaticPath("/generated-pages/demo/../arena-house/index.html")).toBe(true);
    expect(isPrivateStaticPath("/@fs//repo/generated-pages/arena-house/index.html", "/repo")).toBe(true);
    expect(isPrivateStaticPath("/@fs//repo/data/board-state.json", "/repo")).toBe(true);
    expect(isPrivateStaticPath(`/@fs/${resolveProjectStatePath("/repo")}`, "/repo")).toBe(true);
    expect(isPrivateStaticPath(`/@fs/${resolveProjectStatePath("/repo")}.123.tmp`, "/repo")).toBe(true);
    expect(isPrivateStaticPath("/generated-pages/demo/index.html")).toBe(false);
    expect(isPrivateStaticPath("/")).toBe(false);
  });

  it("does not serve private files through Vite raw URLs", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-canvas-guard-"));
    const privateFile = join(root, "data", "board-state.json");
    const privatePage = join(root, "generated-pages", "private", "index.html");
    const externalState = resolveProjectStatePath(root);
    const demoPage = join(root, "generated-pages", "demo", "index.html");
    await Promise.all([
      mkdir(join(root, "data")),
      mkdir(join(root, "generated-pages", "private"), { recursive: true }),
      mkdir(join(root, "generated-pages", "demo"), { recursive: true }),
      mkdir(dirname(externalState), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(privateFile, "PRIVATE_BOARD_SENTINEL"),
      writeFile(privatePage, "PRIVATE_PAGE_SENTINEL"),
      writeFile(externalState, "PRIVATE_EXTERNAL_STATE_SENTINEL"),
      writeFile(demoPage, "PUBLIC_DEMO_SENTINEL"),
      writeFile(join(root, "index.html"), "<!doctype html><title>public app</title>"),
    ]);
    const server = await createServer({ configFile: false, root, plugins: [createPrivateFileGuard(root)], server: { host: "127.0.0.1", port: 0 } });
    try {
      await server.listen();
      const address = server.httpServer?.address();
      if (!address || typeof address === "string") throw new Error("Missing Vite port");
      const origin = `http://127.0.0.1:${address.port}`;
      for (const path of ["/data/board-state.json", "/generated-pages/private/index.html", "/generated-pages/%70rivate/index.html", `/@fs/${privateFile}`, `/@fs/${privatePage}`, `/@fs/${externalState}`]) {
        const response = await fetch(`${origin}${path}`);
        expect(response.status, path).toBe(404);
        expect(await response.text(), path).not.toMatch(/PRIVATE_(?:BOARD|PAGE|EXTERNAL_STATE)_SENTINEL/);
      }
      const demo = await fetch(`${origin}/generated-pages/demo/index.html`);
      expect(demo.status).toBe(200);
      expect(await demo.text()).toContain("PUBLIC_DEMO_SENTINEL");
    } finally {
      await server.close();
      await rm(dirname(externalState), { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});
