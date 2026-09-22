import { describe, expect, it, vi } from "vitest";
import { limits } from "../domain/model";
import { createSeedState } from "../test/fixtures";
import { appReducer, type AppAction } from "../state/reducer";
import {
  createWebMcpTools,
  registerWebMcpTools,
  type ModelContext,
  type ModelContextTool,
  type ToolFailure,
  type ToolSuccess,
  type WebMcpRuntime,
} from "./webmcp";

function setupRuntime() {
  let state = createSeedState();
  const dispatched: AppAction[] = [];
  const runtime: WebMcpRuntime<AppAction> = {
    getState: () => state,
    dispatch: (action) => {
      dispatched.push(action);
      state = appReducer(state, action);
      return state;
    },
  };
  return {
    runtime,
    getState: () => state,
    dispatched,
  };
}

function toolMap(runtime: WebMcpRuntime<AppAction>) {
  return new Map(createWebMcpTools(runtime).map((tool) => [tool.name, tool]));
}

function data<T extends Record<string, unknown>>(result: unknown): T {
  expect(result).toMatchObject({ ok: true });
  return (result as ToolSuccess<T>).data;
}

function error(result: unknown): ToolFailure["error"] {
  expect(result).toMatchObject({ ok: false });
  return (result as ToolFailure).error;
}

describe("WebMCP board tools", () => {
  it("exposes all board and page operations", () => {
    const { runtime } = setupRuntime();
    const tools = toolMap(runtime);
    expect([...tools.keys()]).toEqual([
      "list_boards",
      "list_pages",
      "create_board",
      "rename_board",
      "delete_board",
      "create_page",
      "update_page",
      "move_page",
      "delete_page",
    ]);
    expect(tools.get("list_boards")?.annotations?.readOnlyHint).toBe(true);
    expect(tools.get("delete_page")?.annotations?.destructiveHint).toBe(true);

    const sourceLimits = (tools.get("create_page")?.inputSchema.allOf ?? [])
      .map((constraint) => {
        const item = constraint as { if?: { properties?: { sourceType?: { enum?: unknown[] } } }; then?: { properties?: { source?: { maxLength?: number } } } };
        const sourceType = item.if?.properties?.sourceType?.enum?.[0];
        return [sourceType, item.then?.properties?.source?.maxLength] as const;
      });
    expect(sourceLimits).toContainEqual(["url", limits.maxUrlLength]);
    expect(sourceLimits).toContainEqual(["html", limits.maxHtmlLength]);
  });

  it("creates, updates, moves, and deletes a page through the reducer", async () => {
    const { runtime, getState } = setupRuntime();
    const tools = toolMap(runtime);
    const boardId = getState().boards[0].id;
    const secondBoardId = getState().boards[1].id;

    const created = data<{ pageId: string; boardId: string; boardName: string }>(
      await tools.get("create_page")?.execute({
        boardId,
        title: "Generated screen",
        sourceType: "html",
        source: "<main>hello</main>",
      }),
    );
    expect(created.boardId).toBe(boardId);
    expect(created.boardName).toBe(getState().boards[0].name);
    expect(getState().pagesById[created.pageId].title).toBe("Generated screen");

    const updated = data<{ pageId: string }>(
      await tools.get("update_page")?.execute({
        pageId: created.pageId,
        title: "Generated screen v2",
        x: 80,
        y: 120,
      }),
    );
    expect(updated.pageId).toBe(created.pageId);
    expect(getState().pagesById[created.pageId].canvasPosition).toEqual({ x: 80, y: 120 });

    const moved = data<{ targetBoardId: string; targetBoardName: string }>(
      await tools.get("move_page")?.execute({
        pageId: created.pageId,
        targetBoardId: secondBoardId,
      }),
    );
    expect(moved.targetBoardId).toBe(secondBoardId);
    expect(moved.targetBoardName).toBe(getState().boards[1].name);
    expect(getState().pagesById[created.pageId].boardId).toBe(secondBoardId);

    await tools.get("delete_page")?.execute({ pageId: created.pageId });
    expect(getState().pagesById[created.pageId]).toBeUndefined();
  });

  it("uses the active board when list_pages receives no input", async () => {
    const { runtime, getState } = setupRuntime();
    const result = await toolMap(runtime).get("list_pages")?.execute(undefined);
    const listed = data<{ board: { id: string } }>(result);
    expect(listed.board.id).toBe(getState().activeBoardId);
  });

  it("rejects malformed inputs without dispatching", async () => {
    const { runtime, dispatched } = setupRuntime();
    const tools = toolMap(runtime);
    const result = await tools.get("create_page")?.execute({
      title: "Bad URL",
      sourceType: "url",
      source: "javascript:alert(1)",
    });
    expect(error(result).code).toBe("invalid_input");
    expect(dispatched).toHaveLength(0);
  });

  it("does not treat inherited fields as WebMCP input", async () => {
    const { runtime, getState, dispatched } = setupRuntime();
    const tools = toolMap(runtime);
    const activeBoardId = getState().activeBoardId;

    const pageInput = Object.create({ sourceType: "html", source: "<p>inherited</p>" }) as Record<string, unknown>;
    pageInput.title = "Own title";
    const pageResult = await tools.get("create_page")?.execute(pageInput);
    expect(error(pageResult).code).toBe("invalid_input");

    const nullSelectorResult = await tools.get("list_pages")?.execute({ boardId: null });
    expect(error(nullSelectorResult).code).toBe("invalid_input");

    const boardInput = Object.create({ layoutMode: "canvas", activate: false }) as Record<string, unknown>;
    boardInput.name = "Own board";
    const boardResult = data<{ boardId: string; board: { layoutMode: string } }>(await tools.get("create_board")?.execute(boardInput));
    expect(boardResult.board.layoutMode).toBe("grid");
    expect(getState().activeBoardId).not.toBe(activeBoardId);
    expect(getState().activeBoardId).toBe(boardResult.boardId);

    const updateInput = Object.create({ title: "Inherited title" }) as Record<string, unknown>;
    updateInput.pageId = getState().boards[0].pageIds[0];
    const updateResult = await tools.get("update_page")?.execute(updateInput);
    expect(error(updateResult).code).toBe("missing_input");
    expect(dispatched.filter((action) => action.type === "CREATE_PAGE")).toHaveLength(0);
  });

  it.each(["toString", "constructor"]) (
    "does not treat the Object.prototype key %s as a page",
    async (pageId) => {
      const { runtime, dispatched } = setupRuntime();
      const result = await toolMap(runtime).get("delete_page")?.execute({ pageId });

      expect(error(result).code).toBe("not_found");
      expect(dispatched).toHaveLength(0);
    },
  );

  it("filters inherited page-map keys when listing a malformed board", async () => {
    const state = createSeedState();
    state.boards[0].pageIds.push("toString");
    const runtime: WebMcpRuntime<AppAction> = {
      getState: () => state,
      dispatch: () => state,
    };

    const result = await toolMap(runtime).get("list_pages")?.execute({
      boardId: state.boards[0].id,
    });
    const listed = data<{ pages: Array<{ id: string }> }>(result);

    expect(listed.pages.map((page) => page.id)).toEqual(state.boards[0].pageIds.slice(0, 2));
  });

  it("protects the last board and requires a migration target", async () => {
    const { runtime, getState } = setupRuntime();
    const tools = toolMap(runtime);
    const nonEmptyBoardId = getState().boards[0].id;
    const emptyBoardResult = await tools.get("delete_board")?.execute({ boardId: nonEmptyBoardId });
    expect(error(emptyBoardResult).code).toBe("target_required");

    let state = getState();
    while (state.boards.length > 1) {
      const candidate = state.boards[state.boards.length - 1];
      // Use the injected runtime's reducer directly to make an isolated
      // one-board state for the protection assertion below.
      state = appReducer(state, {
        type: "DELETE_BOARD",
        payload: { boardId: candidate.id, targetBoardId: state.boards[0].id },
      });
    }
    const oneBoardRuntime: WebMcpRuntime<AppAction> = {
      getState: () => state,
      dispatch: (action) => {
        state = appReducer(state, action);
        return state;
      },
    };
    const lastResult = await toolMap(oneBoardRuntime).get("delete_board")?.execute({
      boardId: state.boards[0].id,
    });
    expect(error(lastResult).code).toBe("last_board");
  });
});

describe("WebMCP registration", () => {
  it("feature-detects an unavailable model context", () => {
    const { runtime } = setupRuntime();
    const registration = registerWebMcpTools(runtime, { modelContext: undefined });
    expect(registration.supported).toBe(false);
    expect(registration.registered).toBe(false);
    expect(registration.pending).toBe(false);
    expect(registration.toolNames).toEqual([]);
  });

  it("does not register from navigator.modelContext alone", () => {
    const { runtime } = setupRuntime();
    const context: ModelContext = { registerTool: vi.fn() };
    const navigatorObject = window.navigator as Navigator & { modelContext?: ModelContext };
    const previous = Object.getOwnPropertyDescriptor(navigatorObject, "modelContext");
    Object.defineProperty(navigatorObject, "modelContext", { configurable: true, value: context });

    try {
      const registration = registerWebMcpTools(runtime);
      expect(registration.supported).toBe(false);
      expect(registration.registered).toBe(false);
      expect(context.registerTool).not.toHaveBeenCalled();
      registration.unregister();
    } finally {
      if (previous) Object.defineProperty(navigatorObject, "modelContext", previous);
      else delete navigatorObject.modelContext;
    }
  });

  it("prefers the Codex document model context when both entry points exist", () => {
    const { runtime } = setupRuntime();
    const documentContext: ModelContext = { registerTool: vi.fn() };
    const navigatorContext: ModelContext = { registerTool: vi.fn() };
    const documentObject = document as Document & { modelContext?: ModelContext };
    const navigatorObject = window.navigator as Navigator & { modelContext?: ModelContext };
    const previousDocument = Object.getOwnPropertyDescriptor(documentObject, "modelContext");
    const previousNavigator = Object.getOwnPropertyDescriptor(navigatorObject, "modelContext");
    Object.defineProperty(documentObject, "modelContext", { configurable: true, value: documentContext });
    Object.defineProperty(navigatorObject, "modelContext", { configurable: true, value: navigatorContext });

    try {
      const registration = registerWebMcpTools(runtime);
      expect(registration.supported).toBe(true);
      expect(documentContext.registerTool).toHaveBeenCalledTimes(9);
      expect(navigatorContext.registerTool).not.toHaveBeenCalled();
      expect((documentContext.registerTool as ReturnType<typeof vi.fn>).mock.calls[0]).toHaveLength(1);
      registration.unregister();
    } finally {
      if (previousDocument) Object.defineProperty(documentObject, "modelContext", previousDocument);
      else delete documentObject.modelContext;
      if (previousNavigator) Object.defineProperty(navigatorObject, "modelContext", previousNavigator);
      else delete navigatorObject.modelContext;
    }
  });

  it("registers tools and unregisters returned callbacks", () => {
    const { runtime } = setupRuntime();
    const callbacks = new Map<string, ReturnType<typeof vi.fn>>();
    const context: ModelContext = {
      registerTool: (tool) => {
        const callback = vi.fn();
        callbacks.set(tool.name, callback);
        return callback;
      },
    };
    const registration = registerWebMcpTools(runtime, { modelContext: context });
    expect(registration.supported).toBe(true);
    expect(registration.registered).toBe(true);
    expect(registration.toolNames).toHaveLength(9);
    registration.unregister();
    expect(callbacks.get("create_page")).toHaveBeenCalledTimes(1);
    registration.unregister();
    expect(callbacks.get("create_page")).toHaveBeenCalledTimes(1);
  });

  it("clears connected status when asynchronous registration rejects", async () => {
    const { runtime } = setupRuntime();
    const statuses: Array<{ registered: boolean; pending: boolean; errors: string[] }> = [];
    const context: ModelContext = {
      // A browser host may perform registration asynchronously. Reject every
      // promise here to exercise the all-tools-failed state.
      registerTool: () => Promise.reject(new Error("host unavailable")),
    };

    const registration = registerWebMcpTools(runtime, {
      modelContext: context,
      onStatus: (status) => statuses.push({
        registered: status.registered,
        pending: status.pending,
        errors: status.errors,
      }),
    });

    expect(registration.pending).toBe(true);
    expect(registration.registered).toBe(false);

    // Flush the rejection handlers attached by registerWebMcpTools.
    await Promise.resolve();
    await Promise.resolve();

    expect(registration.pending).toBe(false);
    expect(registration.registered).toBe(false);
    expect(registration.errors).toHaveLength(9);
    expect(statuses.at(-1)).toMatchObject({ registered: false, pending: false });
    expect(statuses.at(-1)?.errors).toHaveLength(9);
  });

  it("reports whether a host error happened while registering or cleaning up", () => {
    const { runtime } = setupRuntime();
    const errors: Array<{ name: string; phase: string }> = [];
    const context: ModelContext = {
      registerTool: (tool) => {
        if (tool.name === "list_boards") throw new Error("duplicate tool");
        return () => {
          if (tool.name === "list_pages") throw new Error("cleanup failed");
        };
      },
    };

    const registration = registerWebMcpTools(runtime, {
      modelContext: context,
      onError: (_error, name, phase) => errors.push({ name, phase }),
    });

    expect(errors).toContainEqual({ name: "list_boards", phase: "register" });
    registration.unregister();
    expect(errors).toContainEqual({ name: "list_pages", phase: "unregister" });
  });

  it("does not invoke a late async cleanup handle after fallback removal", async () => {
    const { runtime } = setupRuntime();
    let resolveCleanup: ((value: () => void) => void) | undefined;
    const lateCleanup = vi.fn();
    const unregisterTool = vi.fn();
    const context: ModelContext = {
      registerTool: (tool) => {
        if (tool.name === "list_pages") {
          return new Promise<() => void>((resolve) => {
            resolveCleanup = resolve;
          });
        }
        return undefined;
      },
      unregisterTool,
    };

    const registration = registerWebMcpTools(runtime, { modelContext: context });
    // `registerTool` returns void for a normal synchronous host; those tools
    // still count as registered while the one promise is pending.
    expect(registration.registered).toBe(true);
    expect(registration.pending).toBe(true);
    registration.unregister();
    resolveCleanup?.(lateCleanup);
    await Promise.resolve();
    await Promise.resolve();

    expect(unregisterTool).toHaveBeenCalledWith("list_pages");
    expect(lateCleanup).not.toHaveBeenCalled();
  });

  it("blocks stale tool calls after the registration is unregistered", async () => {
    const { runtime, dispatched } = setupRuntime();
    let registeredTool: ModelContextTool | undefined;
    const context: ModelContext = {
      registerTool: (tool) => {
        if (tool.name === "create_page") registeredTool = tool;
      },
    };
    const registration = registerWebMcpTools(runtime, { modelContext: context });
    registration.unregister();

    const result = await registeredTool?.execute({
      title: "Stale page",
      sourceType: "html",
      source: "<main>stale</main>",
    });

    expect(error(result).code).toBe("registration_closed");
    expect(dispatched).toHaveLength(0);
  });
});
