import {
  AppState,
  Board,
  CanvasPosition,
  CreateBoardInput,
  CreatePageInput,
  Page,
  cloneSource,
  createInitialState,
  createId,
  getDefaultCanvasPosition,
  isCanvasPosition,
  isLayoutMode,
  normalizeBoardName,
  normalizePageTitle,
  normalizePageSource,
  nowIso,
  isAppState,
  validateBoardName,
  validatePageSource,
  validatePageTitle,
  UpdatePageInput,
  BoardTag,
  TagColor,
  normalizeTagText,
  validateTagText,
  isTagColor,
  isTagSize,
} from "../domain/model";

export type AppAction =
  | { type: "SELECT_BOARD"; payload: { boardId: string } }
  | { type: "SELECT_PAGE"; payload: { pageId: string | null } }
  | { type: "CREATE_BOARD"; payload: { board: CreateBoardInput; activate?: boolean } }
  | { type: "RENAME_BOARD"; payload: { boardId: string; name: string } }
  | {
      type: "DELETE_BOARD";
      payload: { boardId: string; targetBoardId?: string | null };
    }
  | { type: "CREATE_PAGE"; payload: { page: CreatePageInput; index?: number; select?: boolean } }
  | { type: "UPDATE_PAGE"; payload: { pageId: string; changes: UpdatePageInput } }
  | { type: "DELETE_PAGE"; payload: { pageId: string } }
  | {
      type: "MOVE_PAGE";
      payload: { pageId: string; targetBoardId: string; targetIndex?: number };
    }
  | {
      type: "REORDER_PAGES";
      payload: { boardId: string; pageIds: string[] };
    }
  | {
      type: "UPDATE_CANVAS_POSITION";
      payload: { pageId: string; position: CanvasPosition };
    }
  | { type: "SET_LAYOUT_MODE"; payload: { boardId: string; layoutMode: "grid" | "canvas" } }
  | { type: "CREATE_TAG"; payload: { boardId: string; text?: string; color?: TagColor; canvasPosition?: CanvasPosition; size?: { width: number; height: number }; id?: string } }
  | { type: "UPDATE_TAG"; payload: { tagId: string; changes: { text?: string; color?: TagColor; canvasPosition?: CanvasPosition; size?: { width: number; height: number } } } }
  | { type: "DELETE_TAG"; payload: { tagId: string } }
  | { type: "MOVE_TAG"; payload: { tagId: string; targetBoardId: string } }
  | { type: "RESET_STATE"; payload?: { state?: AppState } };

/** Alias retained for consumers that call their reducer actions commands. */
export type Action = AppAction;

const unchanged = (state: AppState): AppState => state;

function boardIndex(state: AppState, boardId: string): number {
  return state.boards.findIndex((board) => board.id === boardId);
}

function getBoard(state: AppState, boardId: string): Board | undefined {
  return state.boards.find((board) => board.id === boardId);
}

function getPage(state: AppState, pageId: string): Page | undefined {
  // `pagesById` is a JSON object and can inherit names such as `constructor`
  // or `toString`. Only own properties are stored pages.
  if (!Object.prototype.hasOwnProperty.call(state.pagesById, pageId)) return undefined;
  return state.pagesById[pageId];
}

function updateBoard(
  state: AppState,
  boardId: string,
  updater: (board: Board) => Board,
  timestamp = nowIso(),
): AppState {
  const index = boardIndex(state, boardId);
  if (index < 0) return state;
  const previous = state.boards[index];
  const next = updater(previous);
  if (next === previous) return state;
  const boards = state.boards.slice();
  boards[index] = { ...next, updatedAt: timestamp };
  return { ...state, boards };
}

function withPage(state: AppState, pageId: string, updater: (page: Page) => Page): AppState {
  const previous = getPage(state, pageId);
  if (!previous) return state;
  const next = updater(previous);
  if (next === previous) return state;
  return { ...state, pagesById: { ...state.pagesById, [pageId]: next } };
}

function clampIndex(index: number | undefined, length: number): number {
  if (typeof index !== "number" || !Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, Math.floor(index)));
}

function makeBoard(input: CreateBoardInput, existingIds: Set<string>, timestamp: string): Board | null {
  if (!input || typeof input !== "object") return null;
  if (validateBoardName(input.name)) return null;
  const requestedId = typeof input.id === "string" ? input.id.trim() : "";
  const id = requestedId || createId("board");
  if (existingIds.has(id)) return null;
  const layoutMode = input.layoutMode ?? "grid";
  if (!isLayoutMode(layoutMode)) return null;
  const createdAt = typeof input.createdAt === "string" && input.createdAt.trim() ? input.createdAt : timestamp;
  return {
    id,
    name: normalizeBoardName(input.name),
    pageIds: [],
    layoutMode,
    createdAt,
    updatedAt: timestamp,
    tags: [],
  };
}

function getTag(state: AppState, tagId: string): BoardTag | undefined {
  for (const board of state.boards) {
    const tag = board.tags?.find((item) => item.id === tagId);
    if (tag) return tag;
  }
  return undefined;
}

function makePage(
  input: CreatePageInput,
  existingIds: Set<string>,
  boardPageCount: number,
  timestamp: string,
): Page | null {
  if (!input || typeof input !== "object" || typeof input.boardId !== "string") return null;
  if (validatePageTitle(input.title) || validatePageSource(input.source)) return null;
  const requestedId = typeof input.id === "string" ? input.id.trim() : "";
  const id = requestedId || createId("page");
  if (existingIds.has(id)) return null;
  const position = input.canvasPosition ?? getDefaultCanvasPosition(boardPageCount);
  if (!isCanvasPosition(position)) return null;
  const source = normalizePageSource(input.source);
  const createdAt = typeof input.createdAt === "string" && input.createdAt.trim() ? input.createdAt : timestamp;
  return {
    id,
    boardId: input.boardId,
    title: normalizePageTitle(input.title),
    source: cloneSource(source),
    canvasPosition: { x: position.x, y: position.y },
    createdAt,
    updatedAt: timestamp,
  };
}

function selectFirstPage(state: AppState, board: Board | undefined): string | null {
  if (!board) return null;
  return board.pageIds.find((pageId) => Boolean(getPage(state, pageId))) ?? null;
}

function normalizeSelection(state: AppState): AppState {
  if (state.selectedPageId === null) return state;
  const activeBoard = getBoard(state, state.activeBoardId);
  const selectedPage = getPage(state, state.selectedPageId);
  if (
    activeBoard &&
    selectedPage?.boardId === activeBoard.id &&
    activeBoard.pageIds.includes(state.selectedPageId)
  ) {
    return state;
  }
  // Reducer callers can provide an object that was not loaded through the
  // storage validator. Clear a cross-board selection before any action can
  // expose it to the UI or persistence layer.
  return { ...state, selectedPageId: null };
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function canvasPositionKey(position: CanvasPosition): string {
  return `${position.x}:${position.y}`;
}

/** Keep a page's deliberate position unless the destination already uses it. */
function chooseCanvasPosition(
  state: AppState,
  occupiedPageIds: readonly string[],
  preferred: CanvasPosition,
  fallbackIndex: number,
): CanvasPosition {
  const occupied = new Set(
    occupiedPageIds
      .map((pageId) => getPage(state, pageId)?.canvasPosition)
      .filter((position): position is CanvasPosition => isCanvasPosition(position))
      .map(canvasPositionKey),
  );
  if (!occupied.has(canvasPositionKey(preferred))) return { x: preferred.x, y: preferred.y };

  let index = Math.max(0, fallbackIndex);
  while (occupied.has(canvasPositionKey(getDefaultCanvasPosition(index)))) index += 1;
  return getDefaultCanvasPosition(index);
}

/**
 * Single state transition function shared by React, WebMCP and tests.
 * Invalid commands are intentionally no-ops: callers can run the exported
 * validation helpers before dispatching to present a useful error message.
 */
export function appReducer(state: AppState, action: AppAction): AppState {
  // Actions normally come from typed callers, but WebMCP/store adapters can
  // cross a runtime boundary. Fail closed instead of letting a malformed
  // payload crash the whole app.
  if (!action || typeof action !== "object") return state;
  if (
    action.type !== "RESET_STATE" &&
    (!action.payload || typeof action.payload !== "object" || Array.isArray(action.payload))
  ) {
    return state;
  }
  state = normalizeSelection(state);
  switch (action.type) {
    case "SELECT_BOARD": {
      const board = getBoard(state, action.payload.boardId);
      if (!board) return state;
      const selectedPageId =
        state.selectedPageId && board.pageIds.includes(state.selectedPageId)
          ? state.selectedPageId
          : selectFirstPage(state, board);
      if (state.activeBoardId === board.id && state.selectedPageId === selectedPageId) return state;
      return { ...state, activeBoardId: board.id, selectedPageId };
    }

    case "SELECT_PAGE": {
      const pageId = action.payload.pageId;
      if (pageId === null) return state.selectedPageId === null ? state : { ...state, selectedPageId: null };
      if (typeof pageId !== "string") return state;
      const page = getPage(state, pageId);
      if (!page) return state;
      const ownerBoard = getBoard(state, page.boardId);
      if (!ownerBoard || !ownerBoard.pageIds.includes(page.id)) return state;
      const nextActive = page.boardId === state.activeBoardId ? state.activeBoardId : page.boardId;
      if (state.selectedPageId === pageId && state.activeBoardId === nextActive) return state;
      return { ...state, activeBoardId: nextActive, selectedPageId: pageId };
    }

    case "CREATE_BOARD": {
      if (!action.payload?.board || typeof action.payload.board !== "object") return state;
      const timestamp = nowIso();
      const board = makeBoard(action.payload.board, new Set(state.boards.map((item) => item.id)), timestamp);
      if (!board) return state;
      return {
        ...state,
        boards: [...state.boards, board],
        activeBoardId: action.payload.activate === false ? state.activeBoardId : board.id,
        selectedPageId: action.payload.activate === false ? state.selectedPageId : null,
      };
    }

    case "RENAME_BOARD": {
      if (validateBoardName(action.payload.name)) return state;
      const name = normalizeBoardName(action.payload.name);
      return updateBoard(state, action.payload.boardId, (board) => (board.name === name ? board : { ...board, name }));
    }

    case "DELETE_BOARD": {
      if (state.boards.length <= 1) return state;
      const removeIndex = boardIndex(state, action.payload.boardId);
      if (removeIndex < 0) return state;
      const board = state.boards[removeIndex];
      const targetId = action.payload.targetBoardId ?? null;
      // Treat an explicitly supplied target as part of the command contract,
      // even when the board being removed is empty. Silently ignoring a bad
      // target makes direct reducer callers believe a migration was honored.
      if (targetId !== null && (!getBoard(state, targetId) || targetId === board.id)) return state;
      if (board.pageIds.length > 0) {
        if (!targetId) return state;
      }

      let pagesById = state.pagesById;
      let boards = state.boards;
      const timestamp = nowIso();
      if (board.pageIds.length > 0 && targetId) {
        const targetIndex = boardIndex(state, targetId);
        const target = state.boards[targetIndex];
        const movedPageIds = board.pageIds.filter((pageId) => Boolean(getPage(state, pageId)));
        const targetPageIds = [...target.pageIds, ...movedPageIds];
        boards = state.boards.map((item, index) => {
          if (index === removeIndex) return item;
          if (index === targetIndex) return { ...item, pageIds: targetPageIds, updatedAt: timestamp };
          return item;
        });
        const updatedPages: Record<string, Page> = { ...state.pagesById };
        const occupiedPageIds = target.pageIds.slice();
        for (const [offset, pageId] of movedPageIds.entries()) {
          const page = updatedPages[pageId];
          if (page) {
            const canvasPosition = chooseCanvasPosition(
              { ...state, pagesById: updatedPages },
              occupiedPageIds,
              page.canvasPosition,
              target.pageIds.length + offset,
            );
            updatedPages[pageId] = { ...page, boardId: targetId, canvasPosition, updatedAt: timestamp };
            occupiedPageIds.push(pageId);
          }
        }
        pagesById = updatedPages;
      }

      boards = boards.filter((item) => item.id !== board.id);
      const activeWasRemoved = state.activeBoardId === board.id;
      const nextActiveBoard = activeWasRemoved
        ? (targetId ? boards.find((item) => item.id === targetId) : undefined) ??
          boards[Math.min(removeIndex, boards.length - 1)]
        : getBoard({ ...state, boards }, state.activeBoardId);
      let selectedPageId = state.selectedPageId;
      if (selectedPageId && !Object.prototype.hasOwnProperty.call(pagesById, selectedPageId)) selectedPageId = null;
      if (activeWasRemoved && selectedPageId && nextActiveBoard && !nextActiveBoard.pageIds.includes(selectedPageId)) {
        selectedPageId = selectFirstPage({ ...state, pagesById }, nextActiveBoard);
      }
      return {
        ...state,
        boards,
        pagesById,
        activeBoardId: nextActiveBoard?.id ?? boards[0].id,
        selectedPageId,
      };
    }

    case "CREATE_PAGE": {
      const input = action.payload.page;
      if (!input || typeof input !== "object") return state;
      const board = getBoard(state, input.boardId);
      if (!board) return state;
      const page = makePage(input, new Set(Object.keys(state.pagesById)), board.pageIds.length, nowIso());
      if (!page) return state;
      const index = clampIndex(action.payload.index, board.pageIds.length);
      const pageIds = board.pageIds.slice();
      pageIds.splice(index, 0, page.id);
      const timestamp = page.updatedAt;
      const next = updateBoard(state, board.id, (item) => ({ ...item, pageIds }), timestamp);
      return {
        ...next,
        pagesById: { ...next.pagesById, [page.id]: page },
        activeBoardId: action.payload.select === false ? next.activeBoardId : board.id,
        selectedPageId: action.payload.select === false ? next.selectedPageId : page.id,
      };
    }

    case "UPDATE_PAGE": {
      const current = getPage(state, action.payload.pageId);
      if (!current) return state;
      const changes = action.payload.changes || {};
      if (changes.title !== undefined && validatePageTitle(changes.title)) return state;
      if (changes.source !== undefined && validatePageSource(changes.source)) return state;
      if (changes.canvasPosition !== undefined && !isCanvasPosition(changes.canvasPosition)) return state;
      const nextTitle = changes.title === undefined ? current.title : normalizePageTitle(changes.title);
      const nextSource = changes.source === undefined ? current.source : normalizePageSource(changes.source);
      const nextPosition = changes.canvasPosition === undefined ? current.canvasPosition : changes.canvasPosition;
      const changed =
        nextTitle !== current.title ||
        nextSource.type !== current.source.type ||
        nextSource.value !== current.source.value ||
        nextPosition.x !== current.canvasPosition.x ||
        nextPosition.y !== current.canvasPosition.y;
      if (!changed) return state;
      const timestamp = nowIso();
      const nextState = withPage(state, current.id, (page) => ({
        ...page,
        title: nextTitle,
        source: cloneSource(nextSource),
        canvasPosition: { x: nextPosition.x, y: nextPosition.y },
        updatedAt: timestamp,
      }));
      return updateBoard(nextState, current.boardId, (board) => ({ ...board }), timestamp);
    }

    case "DELETE_PAGE": {
      const page = getPage(state, action.payload.pageId);
      if (!page) return state;
      const board = getBoard(state, page.boardId);
      if (!board) return state;
      const boards = state.boards.map((item) =>
        item.id === board.id
          ? { ...item, pageIds: item.pageIds.filter((pageId) => pageId !== page.id), updatedAt: nowIso() }
          : item,
      );
      const pagesById = { ...state.pagesById };
      delete pagesById[page.id];
      return {
        ...state,
        boards,
        pagesById,
        selectedPageId: state.selectedPageId === page.id ? null : state.selectedPageId,
      };
    }

    case "MOVE_PAGE": {
      const page = getPage(state, action.payload.pageId);
      const target = getBoard(state, action.payload.targetBoardId);
      if (!page || !target) return state;
      const source = getBoard(state, page.boardId);
      if (!source || !source.pageIds.includes(page.id)) return state;
      const timestamp = nowIso();
      if (source.id === target.id) {
        const currentIndex = source.pageIds.indexOf(page.id);
        if (currentIndex < 0) return state;
        const without = source.pageIds.filter((pageId) => pageId !== page.id);
        // Omitting the index follows the cross-board behavior and appends the
        // page. This also gives WebMCP a useful single-call "send to end"
        // operation while an explicit index still supports precise sorting.
        const targetIndex = clampIndex(action.payload.targetIndex, without.length);
        without.splice(targetIndex, 0, page.id);
        if (arraysEqual(without, source.pageIds)) return state;
        return updateBoard(state, source.id, (item) => ({ ...item, pageIds: without }), timestamp);
      }

      const sourcePageIds = source.pageIds.filter((pageId) => pageId !== page.id);
      const targetPageIds = target.pageIds.filter((pageId) => pageId !== page.id);
      const targetIndex = clampIndex(action.payload.targetIndex, targetPageIds.length);
      targetPageIds.splice(targetIndex, 0, page.id);
      const boards = state.boards.map((item) => {
        if (item.id === source.id) return { ...item, pageIds: sourcePageIds, updatedAt: timestamp };
        if (item.id === target.id) return { ...item, pageIds: targetPageIds, updatedAt: timestamp };
        return item;
      });
      const pagesById = {
        ...state.pagesById,
        [page.id]: {
          ...page,
          boardId: target.id,
          canvasPosition: chooseCanvasPosition(state, targetPageIds.filter((pageId) => pageId !== page.id), page.canvasPosition, targetPageIds.length - 1),
          updatedAt: timestamp,
        },
      };
      // A move is a content operation, not navigation. Keep the active board
      // stable so a card dragged to another board disappears from the current
      // view and the caller can show a confirmation/toast.
      return {
        ...state,
        boards,
        pagesById,
        // The moved card is no longer rendered in the active board. Clear a
        // selection that pointed at it rather than leaving a dangling detail
        // selection in another board.
        selectedPageId: state.selectedPageId === page.id ? null : state.selectedPageId,
      };
    }

    case "REORDER_PAGES": {
      const board = getBoard(state, action.payload.boardId);
      if (!board) return state;
      if (!Array.isArray(action.payload.pageIds)) return state;
      const seen = new Set<string>();
      const requested = action.payload.pageIds.filter((pageId) => {
        if (typeof pageId !== "string" || seen.has(pageId) || !board.pageIds.includes(pageId)) return false;
        seen.add(pageId);
        return true;
      });
      const pageIds = [...requested, ...board.pageIds.filter((pageId) => !seen.has(pageId))];
      if (arraysEqual(pageIds, board.pageIds)) return state;
      return updateBoard(state, board.id, (item) => ({ ...item, pageIds }));
    }

    case "UPDATE_CANVAS_POSITION": {
      if (!isCanvasPosition(action.payload.position)) return state;
      const timestamp = nowIso();
      const page = getPage(state, action.payload.pageId);
      if (!page) return state;
      const nextState = withPage(state, action.payload.pageId, (currentPage) => {
        if (
          currentPage.canvasPosition.x === action.payload.position.x &&
          currentPage.canvasPosition.y === action.payload.position.y
        ) {
          return currentPage;
        }
        return {
          ...currentPage,
          canvasPosition: { x: action.payload.position.x, y: action.payload.position.y },
          updatedAt: timestamp,
        };
      });
      if (nextState === state) return state;
      return updateBoard(nextState, page.boardId, (board) => ({ ...board }), timestamp);
    }

    case "SET_LAYOUT_MODE": {
      if (!isLayoutMode(action.payload.layoutMode)) return state;
      return updateBoard(state, action.payload.boardId, (board) =>
        board.layoutMode === action.payload.layoutMode ? board : { ...board, layoutMode: action.payload.layoutMode },
      );
    }

    case "CREATE_TAG": {
      const payload = action.payload;
      const board = getBoard(state, payload.boardId);
      if (!board || !isTagColor(payload.color ?? "yellow")) return state;
      const text = normalizeTagText(payload.text);
      if (validateTagText(text)) return state;
      const id = typeof payload.id === "string" && payload.id.trim() ? payload.id.trim() : createId("tag");
      if (getTag(state, id)) return state;
      const position = payload.canvasPosition ?? { x: 32, y: 32 };
      if (!isCanvasPosition(position) || (payload.size !== undefined && !isTagSize(payload.size))) return state;
      const timestamp = nowIso();
      const tag: BoardTag = { id, boardId: board.id, text, color: payload.color ?? "yellow", canvasPosition: { x: position.x, y: position.y }, ...(payload.size ? { size: { ...payload.size } } : {}), createdAt: timestamp, updatedAt: timestamp };
      return updateBoard(state, board.id, (item) => ({ ...item, tags: [...(item.tags ?? []), tag] }), timestamp);
    }

    case "UPDATE_TAG": {
      const current = getTag(state, action.payload.tagId);
      if (!current) return state;
      const changes = action.payload.changes ?? {};
      if (changes.text !== undefined && validateTagText(changes.text)) return state;
      if (changes.color !== undefined && !isTagColor(changes.color)) return state;
      if (changes.canvasPosition !== undefined && !isCanvasPosition(changes.canvasPosition)) return state;
      if (changes.size !== undefined && !isTagSize(changes.size)) return state;
      const timestamp = nowIso();
      const next: BoardTag = { ...current, text: changes.text === undefined ? current.text : normalizeTagText(changes.text), color: changes.color ?? current.color, canvasPosition: changes.canvasPosition ? { ...changes.canvasPosition } : current.canvasPosition, ...(changes.size ? { size: { ...changes.size } } : {}), updatedAt: timestamp };
      return updateBoard(state, current.boardId, (board) => ({ ...board, tags: (board.tags ?? []).map((tag) => tag.id === current.id ? next : tag) }), timestamp);
    }

    case "DELETE_TAG": {
      const current = getTag(state, action.payload.tagId);
      if (!current) return state;
      return updateBoard(state, current.boardId, (board) => ({ ...board, tags: (board.tags ?? []).filter((tag) => tag.id !== current.id) }));
    }

    case "MOVE_TAG": {
      const current = getTag(state, action.payload.tagId);
      const target = getBoard(state, action.payload.targetBoardId);
      if (!current || !target || current.boardId === target.id) return state;
      const timestamp = nowIso();
      const boards = state.boards.map((board) => {
        if (board.id === current.boardId) return { ...board, tags: (board.tags ?? []).filter((tag) => tag.id !== current.id), updatedAt: timestamp };
        if (board.id === target.id) return { ...board, tags: [...(board.tags ?? []), { ...current, boardId: target.id, updatedAt: timestamp }], updatedAt: timestamp };
        return board;
      });
      return { ...state, boards };
    }

    case "RESET_STATE":
      return action.payload?.state && isAppState(action.payload.state)
        ? action.payload.state
        : state;

    default:
      return unchanged(state);
  }
}

// Conventional Redux-style alias.
export const reducer = appReducer;

export const actions = {
  selectBoard: (boardId: string): AppAction => ({ type: "SELECT_BOARD", payload: { boardId } }),
  selectPage: (pageId: string | null): AppAction => ({ type: "SELECT_PAGE", payload: { pageId } }),
  createBoard: (board: CreateBoardInput, activate = true): AppAction => ({
    type: "CREATE_BOARD",
    payload: { board, activate },
  }),
  renameBoard: (boardId: string, name: string): AppAction => ({
    type: "RENAME_BOARD",
    payload: { boardId, name },
  }),
  deleteBoard: (boardId: string, targetBoardId?: string | null): AppAction => ({
    type: "DELETE_BOARD",
    payload: { boardId, targetBoardId },
  }),
  createPage: (page: CreatePageInput, index?: number, select = true): AppAction => ({
    type: "CREATE_PAGE",
    payload: { page, index, select },
  }),
  updatePage: (pageId: string, changes: UpdatePageInput): AppAction => ({
    type: "UPDATE_PAGE",
    payload: { pageId, changes },
  }),
  deletePage: (pageId: string): AppAction => ({ type: "DELETE_PAGE", payload: { pageId } }),
  movePage: (pageId: string, targetBoardId: string, targetIndex?: number): AppAction => ({
    type: "MOVE_PAGE",
    payload: { pageId, targetBoardId, targetIndex },
  }),
  reorderPages: (boardId: string, pageIds: string[]): AppAction => ({
    type: "REORDER_PAGES",
    payload: { boardId, pageIds },
  }),
  updateCanvasPosition: (pageId: string, position: CanvasPosition): AppAction => ({
    type: "UPDATE_CANVAS_POSITION",
    payload: { pageId, position },
  }),
  setLayoutMode: (boardId: string, layoutMode: "grid" | "canvas"): AppAction => ({
    type: "SET_LAYOUT_MODE",
    payload: { boardId, layoutMode },
  }),
  createTag: (boardId: string, text?: string, color?: TagColor, canvasPosition?: CanvasPosition, id?: string, size?: { width: number; height: number }): AppAction => ({ type: "CREATE_TAG", payload: { boardId, text, color, canvasPosition, id, size } }),
  updateTag: (tagId: string, changes: { text?: string; color?: TagColor; canvasPosition?: CanvasPosition; size?: { width: number; height: number } }): AppAction => ({ type: "UPDATE_TAG", payload: { tagId, changes } }),
  deleteTag: (tagId: string): AppAction => ({ type: "DELETE_TAG", payload: { tagId } }),
  moveTag: (tagId: string, targetBoardId: string): AppAction => ({ type: "MOVE_TAG", payload: { tagId, targetBoardId } }),
  resetState: (state?: AppState): AppAction => ({ type: "RESET_STATE", payload: { state } }),
};

export function getBoardById(state: AppState, boardId: string): Board | undefined {
  return getBoard(state, boardId);
}

export function getPageById(state: AppState, pageId: string): Page | undefined {
  return getPage(state, pageId);
}

export function getActiveBoard(state: AppState): Board | undefined {
  return getBoard(state, state.activeBoardId);
}

export function getPagesForBoard(state: AppState, boardId: string): Page[] {
  const board = getBoard(state, boardId);
  if (!board) return [];
  return board.pageIds.map((pageId) => getPage(state, pageId)).filter((page): page is Page => Boolean(page));
}

export function getActivePages(state: AppState): Page[] {
  return getPagesForBoard(state, state.activeBoardId);
}

export function createEmptyState(): AppState {
  return createInitialState();
}
