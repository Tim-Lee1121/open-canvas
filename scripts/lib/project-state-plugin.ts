import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { isAppState } from "../../src/domain/model";
import { readProjectState, writeProjectState } from "./board-state";
import { isLoopbackRequest } from "./loopback-access";

export const PROJECT_STATE_ROUTE = "/__codex_board__/state";
const PROJECT_STATE_BODY_LIMIT = 2_500_000;

type MiddlewareNext = (error?: unknown) => void;

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.end(JSON.stringify(body));
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > PROJECT_STATE_BODY_LIMIT) {
        reject(new Error("payload_too_large"));
        request.destroy();
        return;
      }
      chunks.push(buffer);
    });
    request.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
    request.on("aborted", () => reject(new Error("request_aborted")));
  });
}

export function createProjectStatePlugin(stateFile: string, legacyStateFile?: string): Plugin {
  let writeQueue: Promise<unknown> = Promise.resolve();

  const handle = async (
    request: IncomingMessage,
    response: ServerResponse,
    next: MiddlewareNext,
  ) => {
    const parsedUrl = new URL(request.url ?? "/", "http://codex-board.local");
    if (parsedUrl.pathname !== PROJECT_STATE_ROUTE) {
      next();
      return;
    }

    if (!isLoopbackRequest(request)) {
      sendJson(response, 403, { ok: false, error: "loopback_only" });
      return;
    }

    if (request.method === "GET") {
      try {
        const snapshot = await readProjectState(stateFile, legacyStateFile);
        sendJson(response, 200, { ok: true, ...snapshot });
      } catch (error) {
        sendJson(response, 500, {
          ok: false,
          error: "invalid_project_state",
          message: error instanceof Error ? error.message : "Could not read project state",
        });
      }
      return;
    }

    if (request.method === "PUT") {
      try {
        const body = JSON.parse(await readRequestBody(request)) as { state?: unknown };
        const state = body.state;
        if (!isAppState(state)) {
          sendJson(response, 400, { ok: false, error: "invalid_project_state" });
          return;
        }
        const operation = writeQueue.then(() => writeProjectState(state, stateFile));
        writeQueue = operation.catch(() => undefined);
        const snapshot = await operation;
        sendJson(response, 200, { ok: true, revision: snapshot.revision });
      } catch (error) {
        const tooLarge = error instanceof Error && error.message === "payload_too_large";
        sendJson(response, tooLarge ? 413 : 400, {
          ok: false,
          error: tooLarge ? "payload_too_large" : "invalid_request",
        });
      }
      return;
    }

    response.setHeader("Allow", "GET, PUT");
    sendJson(response, 405, { ok: false, error: "method_not_allowed" });
  };

  const attach = (server: {
    middlewares: {
      use: (middleware: (
        request: IncomingMessage,
        response: ServerResponse,
        next: MiddlewareNext,
      ) => void) => void;
    };
  }) => {
    server.middlewares.use((request, response, next) => {
      void handle(request, response, next);
    });
  };

  return {
    name: "codex-project-state",
    apply: "serve",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
