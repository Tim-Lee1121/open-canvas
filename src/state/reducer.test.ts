import { describe, expect, it } from "vitest";
import { isAppState, type AppState } from "../domain/model";
import { createSeedState } from "../test/fixtures";
import { actions, appReducer, createEmptyState, getPagesForBoard } from "./reducer";

function reduce(state: AppState, action: ReturnType<(typeof actions)[keyof typeof actions]>): AppState {
  return appReducer(state, action);
}

describe("appReducer", () => {
  it("creates, renames, updates and deletes boards and pages", () => {
    let state = createEmptyState();
    const originalBoardId = state.activeBoardId;

    state = reduce(state, actions.createBoard({ id: "board-two", name: "Second board" }));
    expect(state.boards.map((board) => board.id)).toEqual([originalBoardId, "board-two"]);
    expect(state.activeBoardId).toBe("board-two");

    state = reduce(state, actions.renameBoard("board-two", "Renamed board"));
    expect(state.boards[1].name).toBe("Renamed board");

    state = reduce(
      state,
      actions.createPage({
        id: "page-one",
        boardId: "board-two",
        title: "First page",
        source: { type: "html", value: "<main>hello</main>" },
      }),
    );
    expect(state.pagesById["page-one"].title).toBe("First page");
    expect(state.selectedPageId).toBe("page-one");

    state = reduce(state, actions.updatePage("page-one", {
      title: "Updated page",
      source: { type: "url", value: "https://example.com/mobile" },
    }));
    expect(state.pagesById["page-one"]).toMatchObject({
      title: "Updated page",
      source: { type: "url", value: "https://example.com/mobile" },
    });
    expect(state.boards.find((board) => board.id === "board-two")?.updatedAt).toBe(
      state.pagesById["page-one"].updatedAt,
    );

    state = reduce(state, actions.deletePage("page-one"));
    expect(state.pagesById["page-one"]).toBeUndefined();
    expect(getPagesForBoard(state, "board-two")).toHaveLength(0);
    expect(state.selectedPageId).toBeNull();

    state = reduce(state, actions.deleteBoard("board-two"));
    expect(state.boards).toHaveLength(1);
    expect(state.activeBoardId).toBe(originalBoardId);
  });

  it("protects the last remaining board", () => {
    const state = createEmptyState();
    const next = reduce(state, actions.deleteBoard(state.activeBoardId));
    expect(next).toBe(state);
    expect(next.boards).toHaveLength(1);
  });

  it("treats malformed actions and payloads as safe no-ops", () => {
    const state = createSeedState();
    const malformedActions = [
      null,
      undefined,
      42,
      { type: "SELECT_BOARD" },
      { type: "MOVE_PAGE", payload: null },
      { type: "REORDER_PAGES", payload: [] },
    ] as unknown[];

    malformedActions.forEach((action) => {
      expect(() => appReducer(state, action as never)).not.toThrow();
      expect(appReducer(state, action as never)).toBe(state);
    });

    for (const pageId of ["toString", "constructor", "__proto__"]) {
      const suspiciousActions = [
        actions.updatePage(pageId, { title: "Should not apply" }),
        actions.deletePage(pageId),
        actions.movePage(pageId, state.boards[1].id),
        actions.updateCanvasPosition(pageId, { x: 1, y: 2 }),
      ];
      suspiciousActions.forEach((action) => {
        expect(() => appReducer(state, action)).not.toThrow();
        expect(appReducer(state, action)).toBe(state);
      });
    }
  });

  it("rejects and clears a selection that belongs to another active board", () => {
    const seed = createSeedState();
    const crossBoardSelection = {
      ...seed,
      selectedPageId: seed.boards[1].pageIds[0],
    };

    expect(isAppState(crossBoardSelection)).toBe(false);
    const next = reduce(crossBoardSelection, actions.renameBoard(seed.boards[0].id, "Explorations v2"));
    expect(next.selectedPageId).toBeNull();
  });

  it("rejects an explicitly invalid board target and inconsistent page membership", () => {
    const state = createEmptyState();
    const invalidTarget = reduce(state, actions.deleteBoard(state.activeBoardId, "missing-board"));
    expect(invalidTarget).toBe(state);

    const second = reduce(state, actions.createBoard({ id: "board-two", name: "Second board" }));
    const malformed = {
      ...second,
      pagesById: {
        "orphan-page": {
          id: "orphan-page",
          boardId: second.activeBoardId,
          title: "Orphan",
          source: { type: "html" as const, value: "<p>orphan</p>" },
          canvasPosition: { x: 0, y: 0 },
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      },
    };
    const moved = reduce(malformed, actions.movePage("orphan-page", state.activeBoardId));
    expect(moved).toBe(malformed);
  });

  it("requires a target when deleting a non-empty board and migrates atomically", () => {
    const seed = createSeedState();
    const source = seed.boards[0];
    const target = seed.boards[1];
    const withoutTarget = reduce(seed, actions.deleteBoard(source.id));
    expect(withoutTarget).toBe(seed);

    const next = reduce(seed, actions.deleteBoard(source.id, target.id));
    expect(next.boards.map((board) => board.id)).toEqual([target.id]);
    expect(next.boards[0].pageIds).toEqual([...target.pageIds, ...source.pageIds]);
    source.pageIds.forEach((pageId) => {
      expect(next.pagesById[pageId].boardId).toBe(target.id);
    });
    expect(next.activeBoardId).toBe(target.id);
    expect(next.selectedPageId).toBe(seed.selectedPageId);
  });

  it("moves pages across boards while preserving the active board", () => {
    const seed = createSeedState();
    const source = seed.boards[0];
    const target = seed.boards[1];
    const pageId = source.pageIds[0];

    const next = reduce(seed, actions.movePage(pageId, target.id));
    expect(next.activeBoardId).toBe(seed.activeBoardId);
    expect(next.boards.find((board) => board.id === source.id)?.pageIds).not.toContain(pageId);
    expect(next.boards.find((board) => board.id === target.id)?.pageIds).toContain(pageId);
    expect(next.pagesById[pageId].boardId).toBe(target.id);
    expect(next.selectedPageId).toBeNull();
  });

  it("keeps canvas positions across boards and avoids exact collisions", () => {
    const seed = createSeedState();
    const source = seed.boards[0];
    const target = seed.boards[1];
    const pageId = source.pageIds[0];

    const positioned = reduce(seed, actions.updateCanvasPosition(pageId, { x: 900, y: 720 }));
    const preserved = reduce(positioned, actions.movePage(pageId, target.id));
    expect(preserved.pagesById[pageId].canvasPosition).toEqual({ x: 900, y: 720 });

    const collided = reduce(seed, actions.movePage(pageId, target.id));
    expect(collided.pagesById[pageId].canvasPosition).not.toEqual(seed.pagesById[pageId].canvasPosition);
  });

  it("reorders pages in a board and supports explicit insertion indexes", () => {
    const seed = createSeedState();
    const board = seed.boards[0];
    const [first, second] = board.pageIds;
    const reordered = reduce(seed, actions.reorderPages(board.id, [second, first]));
    expect(reordered.boards[0].pageIds).toEqual([second, first]);

    const appended = reduce(reordered, actions.movePage(second, board.id));
    expect(appended.boards[0].pageIds).toEqual([first, second]);

    const inserted = reduce(reordered, actions.createPage({
      id: "page-inserted",
      boardId: board.id,
      title: "Inserted",
      source: { type: "html", value: "<p>new</p>" },
    }, 1));
    expect(inserted.boards[0].pageIds).toEqual([second, "page-inserted", first]);
  });

  it("updates canvas coordinates and per-board layout mode", () => {
    const seed = createSeedState();
    const board = seed.boards[0];
    const pageId = board.pageIds[0];
    const positioned = reduce(seed, actions.updateCanvasPosition(pageId, { x: 123.5, y: 456 }));
    expect(positioned.pagesById[pageId].canvasPosition).toEqual({ x: 123.5, y: 456 });
    expect(positioned.boards[0].updatedAt).toBe(positioned.pagesById[pageId].updatedAt);
    const canvas = reduce(positioned, actions.setLayoutMode(board.id, "canvas"));
    expect(canvas.boards.find((item) => item.id === board.id)?.layoutMode).toBe("canvas");
    expect(canvas.boards.find((item) => item.id === seed.boards[1].id)?.layoutMode).toBe("canvas");
    // Invalid references/values are safe no-ops.
    expect(reduce(canvas, actions.updateCanvasPosition("missing", { x: 1, y: 1 }))).toBe(canvas);
    expect(reduce(canvas, actions.setLayoutMode("missing", "grid"))).toBe(canvas);
  });

  it("places newly created pages in a horizontal sequence", () => {
    const seed = createEmptyState();
    const board = seed.boards[0];
    const first = reduce(seed, actions.createPage({
      id: "page-horizontal-first",
      boardId: board.id,
      title: "First",
      source: { type: "html", value: "<p>first</p>" },
    }));
    const second = reduce(first, actions.createPage({
      id: "page-horizontal-second",
      boardId: board.id,
      title: "Second",
      source: { type: "html", value: "<p>second</p>" },
    }));

    expect(second.pagesById["page-horizontal-first"].canvasPosition).toEqual({ x: 32, y: 32 });
    expect(second.pagesById["page-horizontal-second"].canvasPosition).toEqual({ x: 476, y: 32 });
  });
});
