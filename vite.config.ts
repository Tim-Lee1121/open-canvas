import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { resolveLegacyProjectStatePath, resolveProjectStatePath } from "./scripts/lib/board-state";
import { createPrivateFileGuard } from "./scripts/lib/private-file-guard";
import { createProjectStatePlugin } from "./scripts/lib/project-state-plugin";
import { createClipboardPairingStore, isTrustedClipboardWrite } from "./scripts/lib/clipboard-access";
import { isLoopbackRequest } from "./scripts/lib/loopback-access";

const ANNOTATION_ROUTE_PREFIX = "/__codex_annotation__/";
const CLIPBOARD_PATH = "/__codex_clipboard__";
const ANNOTATION_STAGE_PATH = `${ANNOTATION_ROUTE_PREFIX}stage`;
const ANNOTATION_STAGED_ROUTE_PREFIX = `${ANNOTATION_ROUTE_PREFIX}staged/`;
const STAGE_BODY_LIMIT = 2_500_000;
const STAGE_TTL_MS = 5 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]+$/;
const PROJECT_ROOT = fileURLToPath(new URL(".", import.meta.url));
const execFileAsync = promisify(execFile);
// Keep the last successful H2D document available to the local Figma plugin.
// Figma's cross-origin plugin iframe can reject both Clipboard API reads and
// paste events even though the macOS pasteboard contains the HTML flavor.
const clipboardPairing = createClipboardPairingStore();

async function writeMacHtmlClipboard(html: string, sourceUrl: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("system HTML clipboard is only available on macOS");
  // Match the official extension's public.html flavor: H2D markers remain
  // raw comments inside the data-* attributes on empty spans.
  const filePath = `/tmp/open-canvas-clipboard-${randomUUID()}.html`;
  await Promise.all([
    fs.writeFile(filePath, html, "utf8"),
  ]);
  try {
    const script = [
      'ObjC.import("AppKit");',
      'ObjC.import("Foundation");',
      `const html=$.NSString.stringWithContentsOfFileEncodingError(${JSON.stringify(filePath)},$.NSUTF8StringEncoding,null);`,
      "const pb=$.NSPasteboard.generalPasteboard;",
      "pb.clearContents;",
      "pb.setStringForType(html,$.NSPasteboardTypeHTML);",
      // Match a normal browser HTML copy closely enough for Figma Desktop to
      // select its rich-paste handler. The empty string is only a companion
      // flavor; it is never treated as a successful text export by Canvas.
      'pb.setStringForType("",$.NSPasteboardTypeString);',
      // Preserve the page origin Chromium normally adds to an HTML copy. This
      // is metadata only and does not expose page content or a URL fallback.
      `pb.setStringForType(${JSON.stringify(sourceUrl)},"org.chromium.source-url");`,
    ].join("");
    await execFileAsync("osascript", ["-l", "JavaScript", "-e", script]);
  } finally {
    await Promise.all([
      fs.rm(filePath, { force: true }),
    ]);
  }
}

interface StagedDocument {
  document: string;
  pageId: string;
  expiresAt: number;
}

interface StagePayload {
  document?: unknown;
  pageId?: unknown;
}

type MiddlewareNext = (error?: unknown) => void;

/**
 * Keep generated annotation documents in the dev/preview process so the
 * browser can navigate to a normal HTTP document. The browser cannot send a
 * URL fragment to the server, and a SPA shell followed by document.write is
 * too late for some Annotation hosts to discover the page's inner elements.
 */
function createAnnotationServerPlugin(): Plugin {
  const staged = new Map<string, StagedDocument>();

  const sendJson = (response: ServerResponse, status: number, body: unknown) => {
    const serialized = JSON.stringify(body);
    response.statusCode = status;
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.end(serialized);
  };

  const readRequestBody = (request: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      size += Buffer.byteLength(chunk);
      if (size > STAGE_BODY_LIMIT) {
        reject(new Error("annotation payload is too large"));
        request.destroy();
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
    request.on("aborted", () => reject(new Error("annotation request aborted")));
  });

  const createToken = () => {
    let token = `annotation-${randomUUID()}`;
    while (staged.has(token)) token = `annotation-${randomUUID()}`;
    return token;
  };

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: MiddlewareNext,
  ) => {
    const rawUrl = request.url ?? "/";
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(rawUrl, "http://codex-annotation.local");
    } catch {
      next();
      return;
    }

    if (parsedUrl.pathname === ANNOTATION_STAGE_PATH) {
      if (!isLoopbackRequest(request)) {
        sendJson(response, 403, { error: "loopback_only" });
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "POST");
        sendJson(response, 405, { error: "method_not_allowed" });
        return;
      }
      try {
        const payload = JSON.parse(await readRequestBody(request)) as StagePayload;
        if (
          typeof payload.document !== "string" ||
          payload.document.length === 0 ||
          payload.document.length > STAGE_BODY_LIMIT ||
          typeof payload.pageId !== "string" ||
          payload.pageId.length === 0 ||
          payload.pageId.length > 240 ||
          !TOKEN_PATTERN.test(payload.pageId)
        ) {
          sendJson(response, 400, { error: "invalid_annotation_payload" });
          return;
        }
        const token = createToken();
        const expiresAt = Date.now() + STAGE_TTL_MS;
        staged.set(token, { document: payload.document, pageId: payload.pageId, expiresAt });
        const cleanup = setTimeout(() => {
          const current = staged.get(token);
          if (current?.expiresAt === expiresAt) staged.delete(token);
        }, STAGE_TTL_MS);
        // A pending timer must not keep a preview process alive during shutdown.
        cleanup.unref?.();
        sendJson(response, 201, { url: `${ANNOTATION_STAGED_ROUTE_PREFIX}${token}`, token });
      } catch (error) {
        if (!response.writableEnded) {
          const isTooLarge = error instanceof Error && error.message === "annotation payload is too large";
          sendJson(response, isTooLarge ? 413 : 400, { error: isTooLarge ? "payload_too_large" : "invalid_json" });
        }
      }
      return;
    }

    if (parsedUrl.pathname === CLIPBOARD_PATH) {
      if (!isLoopbackRequest(request)) {
        sendJson(response, 403, { error: "loopback_only" });
        return;
      }
      if (request.method === "OPTIONS") {
        response.statusCode = 204;
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
        response.setHeader("Access-Control-Allow-Headers", "X-Open-Canvas-Code");
        response.end();
        return;
      }
      if (request.method === "GET") {
        const html = clipboardPairing.consume(request.headers["x-open-canvas-code"] as string | undefined);
        if (!html) {
          response.statusCode = 404;
          response.setHeader("Access-Control-Allow-Origin", "*");
          response.setHeader("Cache-Control", "no-store");
          response.end("Pairing code is invalid, expired, or already used");
          return;
        }
        response.statusCode = 200;
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(html);
        return;
      }
      if (request.method !== "POST") {
        response.setHeader("Allow", "GET, POST, OPTIONS");
        sendJson(response, 405, { error: "method_not_allowed" });
        return;
      }
      if (!isTrustedClipboardWrite(request.headers.origin, request.headers.host)) {
        sendJson(response, 403, { error: "forbidden_origin" });
        return;
      }
      try {
        const rawBody = await readRequestBody(request);
        const isJson = String(request.headers["content-type"] ?? "").toLowerCase().includes("application/json");
        const payload = isJson ? JSON.parse(rawBody) as { clipboardHtml?: unknown; pluginHtml?: unknown } : undefined;
        const html = typeof payload?.clipboardHtml === "string" ? payload.clipboardHtml : rawBody;
        const pluginHtml = typeof payload?.pluginHtml === "string" ? payload.pluginHtml : html;
        if (!html || html.length > STAGE_BODY_LIMIT || !pluginHtml || pluginHtml.length > STAGE_BODY_LIMIT) {
          sendJson(response, 413, { error: "payload_too_large" });
          return;
        }
        const host = request.headers.host;
        const sourceUrl = host && /^(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host)
          ? `http://${host}/`
          : "http://127.0.0.1/";
        await writeMacHtmlClipboard(html, sourceUrl);
        const pairingCode = clipboardPairing.issue(pluginHtml);
        sendJson(response, 200, { ok: true, pairingCode });
      } catch (error) {
        sendJson(response, 503, { error: error instanceof Error ? error.message : "clipboard_unavailable" });
      }
      return;
    }

    if (parsedUrl.pathname.startsWith(ANNOTATION_STAGED_ROUTE_PREFIX)) {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        response.statusCode = 405;
        response.end();
        return;
      }
      const token = parsedUrl.pathname.slice(ANNOTATION_STAGED_ROUTE_PREFIX.length);
      const entry = TOKEN_PATTERN.test(token) ? staged.get(token) : undefined;
      if (!entry || entry.expiresAt <= Date.now()) {
        if (entry) staged.delete(token);
        response.statusCode = 404;
        response.setHeader("Content-Type", "text/plain; charset=utf-8");
        response.end("Annotation preview expired");
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.setHeader("X-Content-Type-Options", "nosniff");
      // The response header (unlike a meta tag) gives generated HTML an
      // opaque origin while still allowing its own scripts to run.
      response.setHeader("Content-Security-Policy", "sandbox allow-scripts");
      response.end(request.method === "HEAD" ? undefined : entry.document);
      return;
    }

    next();
  };

  const attach = (server: { middlewares: { use: (middleware: (request: IncomingMessage, response: ServerResponse, next: MiddlewareNext) => void) => void } }) => {
    server.middlewares.use((request, response, next) => {
      void handle(request, response, next);
    });
  };

  return {
    name: "codex-annotation-server",
    apply: "serve",
    configureServer: attach,
    configurePreviewServer: attach,
    transformIndexHtml(html) {
      // The client uses this marker to distinguish a Vite host with the
      // staging endpoint from a static deployment and choose the right path.
      const marker = '<meta name="codex-annotation-server" content="1">';
      return html.includes('name="codex-annotation-server"')
        ? html
        : html.replace(/<head(?:\s[^>]*)?>/i, (head) => `${head}${marker}`);
    },
  };
}

export default defineConfig({
  // Keep the Codex browser pointed at one durable origin. The board state is
  // written by the project sync endpoint while Vite is running; ignore those
  // data-only changes so updates do not trigger unrelated HMR work. Refuse an
  // occupied port instead of silently moving the workbench to another origin.
  server: {
    host: "127.0.0.1",
    port: Number(process.env.PORT ?? 5183),
    strictPort: true,
    watch: { ignored: ["**/data/board-state.json", "**/data/board-state.json.*.tmp"] },
  },
  preview: {
    host: "127.0.0.1",
    port: Number(process.env.PREVIEW_PORT ?? 5184),
    strictPort: true,
  },
  plugins: [
    createPrivateFileGuard(PROJECT_ROOT),
    react(),
    createProjectStatePlugin(resolveProjectStatePath(PROJECT_ROOT), resolveLegacyProjectStatePath(PROJECT_ROOT)),
    createAnnotationServerPlugin(),
  ],
});
