import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { resolveProjectStatePath } from "./board-state";

const GENERATED_PAGE_PATH = /^\/generated-pages\/([^/]+)(?:\/|$)/i;

export function isPrivateStaticPath(requestUrl: string, root = process.cwd()): boolean {
  let pathname: string;
  try {
    pathname = new URL(requestUrl, "http://open-canvas.local").pathname;
    for (let index = 0; index < 3; index += 1) {
      const decoded = decodeURIComponent(pathname);
      if (decoded === pathname) break;
      pathname = decoded;
    }
  } catch {
    return true;
  }
  if (pathname.includes("\0") || pathname.includes("\\")) return true;
  const absoluteRoot = resolve(root);
  const candidate = pathname.startsWith("/@fs/") ? resolve(pathname.slice(5)) : resolve(absoluteRoot, `.${pathname}`);
  const externalState = resolveProjectStatePath(absoluteRoot);
  if (candidate === externalState || candidate.startsWith(`${externalState}.`)) return true;
  const relative = candidate.startsWith(`${absoluteRoot}${sep}`)
    ? candidate.slice(absoluteRoot.length).split(sep).join("/")
    : "";
  if (/^\/data\/board-state\.json(?:\.|$)/i.test(relative)) return true;
  const generated = relative.match(GENERATED_PAGE_PATH);
  return Boolean(generated && generated[1].toLowerCase() !== "demo");
}

export function createPrivateFileGuard(root = process.cwd()): Plugin {
  const attach = (server: { middlewares: { use: (middleware: (request: IncomingMessage, response: ServerResponse, next: () => void) => void) => void } }) => {
    server.middlewares.use((request, response, next) => {
      if (!isPrivateStaticPath(request.url ?? "/", root)) {
        next();
        return;
      }
      response.statusCode = 404;
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      response.end("Not found");
    });
  };

  return { name: "open-canvas-private-file-guard", apply: "serve", configureServer: attach, configurePreviewServer: attach };
}
