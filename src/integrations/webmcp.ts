import {
  AppState,
  Board,
  CanvasPosition,
  CreateBoardInput,
  Page,
  PageSource,
  UpdatePageInput,
  createId,
  getDefaultCanvasPosition,
  isCanvasPosition,
  isLayoutMode,
  limits,
  nowIso,
  validateBoardName,
  validatePageSource,
  validatePageTitle,
} from "../domain/model";

/**
 * A deliberately small structural type for the WebMCP API. The API is still
 * rolling out in browsers, so the app must not import a browser-specific
 * package or assume that the property exists at runtime.
 */
export interface JsonSchema {
  type?: string;
  description?: string;
  properties?: Record<string, JsonSchema | Record<string, unknown>>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema | Record<string, unknown>;
  anyOf?: Array<JsonSchema | Record<string, unknown>>;
  oneOf?: Array<JsonSchema | Record<string, unknown>>;
  allOf?: Array<JsonSchema | Record<string, unknown>>;
  if?: JsonSchema | Record<string, unknown>;
  then?: JsonSchema | Record<string, unknown>;
  else?: JsonSchema | Record<string, unknown>;
  enum?: readonly unknown[];
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  format?: string;
  dependentRequired?: Record<string, string[]>;
}

export interface ModelContextTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  annotations?: {
    /** Tells Codex that a tool does not mutate application state. */
    readOnlyHint?: boolean;
    /** Tells Codex that a call can remove or overwrite user content. */
    destructiveHint?: boolean;
    /** Tells Codex repeated calls with the same input are safe. */
    idempotentHint?: boolean;
    /** Whether the tool reaches beyond the current page/session. */
    openWorldHint?: boolean;
    /** Standard WebMCP hint for actions with consequential side effects. */
    consequentialHint?: boolean;
    /** Standard WebMCP hint for results that contain user/untrusted content. */
    untrustedContentHint?: boolean;
  };
  // The WebMCP IDL declares tool callbacks as Promise-returning. Keeping the
  // promise in the public contract also makes host-side cancellation and
  // result serialization deterministic, while the adapter remains tolerant
  // of older mock hosts during registration.
  execute: (input: unknown, options?: ToolExecuteOptions) => Promise<unknown>;
}

export interface ToolExecuteOptions {
  signal: AbortSignal;
}

export interface ModelContext {
  /**
   * Register a tool on the current top-level document.
   *
   * The Codex browser currently exposes the one-argument WebMCP form. Keep
   * this structural type deliberately narrow so a native implementation is
   * never called with an unrecognised options object.
   */
  registerTool?: (tool: ModelContextTool) => unknown;
  unregisterTool?: (name: string) => unknown;
}

declare global {
  interface Document {
    /** Experimental WebMCP entry point, when exposed by the host browser. */
    modelContext?: ModelContext;
  }
}

/**
 * Keep the integration independent from React. `dispatch` is intentionally
 * structural so callers can pass a React reducer dispatch or a store adapter
 * without a cast to a package-specific type.
 */
export interface WebMcpRuntime<Action = unknown> {
  getState: () => AppState;
  dispatch: (action: Action) => unknown;
}

export interface WebMcpRegistration {
  supported: boolean;
  registered: boolean;
  /** True while one or more host registrations are still settling. */
  pending: boolean;
  toolNames: string[];
  errors: string[];
  unregister: () => void;
}

/** Snapshot emitted when an asynchronous host registration changes state. */
export interface WebMcpRegistrationStatus {
  supported: boolean;
  registered: boolean;
  pending: boolean;
  toolNames: string[];
  errors: string[];
}

/** Identifies which lifecycle phase produced a host integration error. */
export type WebMcpErrorPhase = "register" | "unregister";

type RecordInput = Record<string, unknown>;
type UsableModelContext = ModelContext & {
  registerTool: NonNullable<ModelContext["registerTool"]>;
};

function hasRegisterTool(context: ModelContext | undefined): context is UsableModelContext {
  try {
    return Boolean(context && typeof context.registerTool === "function");
  } catch {
    // A managed browser can expose a proxy whose getter throws while the
    // WebMCP surface is still initializing. Treat it as unavailable.
    return false;
  }
}

function reportWebMcpError(
  handler: ((error: unknown, toolName: string, phase: WebMcpErrorPhase) => void) | undefined,
  error: unknown,
  toolName: string,
  phase: WebMcpErrorPhase,
): void {
  try {
    handler?.(error, toolName, phase);
  } catch {
    // Diagnostics must never break registration or cleanup.
  }
}

export interface ToolError {
  code: string;
  message: string;
  field?: string;
}

export interface ToolFailure {
  ok: false;
  error: ToolError;
}

export interface ToolSuccess<T extends Record<string, unknown> = Record<string, unknown>> {
  ok: true;
  action: string;
  data: T;
}

export type ToolResult<T extends Record<string, unknown> = Record<string, unknown>> =
  | ToolSuccess<T>
  | ToolFailure;

function success<T extends Record<string, unknown>>(
  action: string,
  data: T,
): ToolSuccess<T> {
  return { ok: true, action, data };
}

function failure(code: string, message: string, field?: string): ToolFailure {
  return { ok: false, error: { code, message, ...(field ? { field } : {}) } };
}

function asRecord(value: unknown): RecordInput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as RecordInput;
}

function hasOwn(input: RecordInput, key: string): boolean {
  try {
    return Object.prototype.hasOwnProperty.call(input, key);
  } catch {
    return false;
  }
}

function ownValue(input: RecordInput, key: string): unknown {
  if (!hasOwn(input, key)) return undefined;
  try {
    return input[key];
  } catch {
    return undefined;
  }
}

function rejectUnknownKeys(input: RecordInput, allowed: readonly string[]): ToolFailure | null {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(input).find((key) => !allowedSet.has(key));
  return unknown ? failure("invalid_input", `Unknown input field: ${unknown}`, unknown) : null;
}

function rejectConflictingSelectors(
  input: RecordInput,
  idKey: string,
  indexKey: string,
): ToolFailure | null {
  const id = ownValue(input, idKey);
  const index = ownValue(input, indexKey);
  if (hasOwn(input, idKey) && id === null) {
    return failure("invalid_input", `${idKey} must be a string when provided`, idKey);
  }
  if (hasOwn(input, indexKey) && index === null) {
    return failure("invalid_input", `${indexKey} must be a number when provided`, indexKey);
  }
  const hasId = id !== undefined && id !== null;
  const hasIndex = index !== undefined && index !== null;
  if (hasId && hasIndex) {
    return failure("invalid_input", `Provide either ${idKey} or ${indexKey}, not both`, idKey);
  }
  return null;
}

function requiredString(
  input: RecordInput,
  key: string,
): { value: string } | { error: ToolFailure } {
  const value = ownValue(input, key);
  if (typeof value !== "string" || !value.trim()) {
    return { error: failure("invalid_input", `${key} must be a non-empty string`, key) };
  }
  return { value: value.trim() };
}

function optionalBoolean(
  input: RecordInput,
  key: string,
  fallback: boolean,
): { value: boolean } | { error: ToolFailure } {
  const value = ownValue(input, key);
  if (!hasOwn(input, key) || value === undefined) {
    return { value: fallback };
  }
  if (value === null) {
    return { error: failure("invalid_input", `${key} must be a boolean when provided`, key) };
  }
  if (typeof value !== "boolean") {
    return { error: failure("invalid_input", `${key} must be a boolean`, key) };
  }
  return { value };
}

function optionalInteger(
  input: RecordInput,
  key: string,
): { value?: number } | { error: ToolFailure } {
  const value = ownValue(input, key);
  if (!hasOwn(input, key) || value === undefined) return {};
  if (value === null) {
    return { error: failure("invalid_input", `${key} must be a non-negative integer when provided`, key) };
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return { error: failure("invalid_input", `${key} must be a non-negative integer`, key) };
  }
  return { value };
}

function optionalFiniteNumber(
  input: RecordInput,
  key: string,
): { value?: number } | { error: ToolFailure } {
  const value = ownValue(input, key);
  if (!hasOwn(input, key) || value === undefined) return {};
  if (value === null) {
    return { error: failure("invalid_input", `${key} must be a finite number when provided`, key) };
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { error: failure("invalid_input", `${key} must be a finite number`, key) };
  }
  return { value };
}

function boardFromSelector(
  state: AppState,
  input: RecordInput,
  options: { required?: boolean; defaultActive?: boolean } = {},
): { value: Board } | { error: ToolFailure } {
  const required = options.required ?? false;
  const defaultActive = options.defaultActive ?? true;
  const boardId = ownValue(input, "boardId");
  const boardIndex = ownValue(input, "boardIndex");

  if (hasOwn(input, "boardId") && boardId === null) {
    return { error: failure("invalid_input", "boardId must be a non-empty string when provided", "boardId") };
  }
  if (hasOwn(input, "boardIndex") && boardIndex === null) {
    return { error: failure("invalid_input", "boardIndex must be a non-negative integer when provided", "boardIndex") };
  }

  if (boardId !== undefined && boardId !== null) {
    if (typeof boardId !== "string" || !boardId.trim()) {
      return { error: failure("invalid_input", "boardId must be a non-empty string", "boardId") };
    }
    const board = state.boards.find((candidate) => candidate.id === boardId);
    if (!board) return { error: failure("not_found", `Board not found: ${boardId}`, "boardId") };
    return { value: board };
  }

  if (boardIndex !== undefined && boardIndex !== null) {
    if (typeof boardIndex !== "number" || !Number.isInteger(boardIndex) || boardIndex < 0) {
      return { error: failure("invalid_input", "boardIndex must be a non-negative integer", "boardIndex") };
    }
    const board = state.boards[boardIndex];
    if (!board) return { error: failure("not_found", `Board index out of range: ${boardIndex}`, "boardIndex") };
    return { value: board };
  }

  if (required && !defaultActive) {
    return { error: failure("invalid_input", "Provide boardId or boardIndex", "boardId") };
  }

  if (defaultActive) {
    const active = state.boards.find((candidate) => candidate.id === state.activeBoardId);
    if (active) return { value: active };
  }
  return { error: failure("state_invalid", "The app has no active board") };
}

function targetBoardFromSelector(
  state: AppState,
  input: RecordInput,
): { value: Board } | { error: ToolFailure } {
  return boardFromSelector(state, input, { required: true, defaultActive: false });
}

function pageFromId(
  state: AppState,
  input: RecordInput,
): { value: Page } | { error: ToolFailure } {
  const parsed = requiredString(input, "pageId");
  if ("error" in parsed) return parsed;
  // `pagesById` is a JSON object and therefore inherits Object.prototype.
  // Check for an own property before indexing so values such as `toString` or
  // `constructor` cannot be mistaken for a Page at this untrusted boundary.
  if (!Object.prototype.hasOwnProperty.call(state.pagesById, parsed.value)) {
    return { error: failure("not_found", `Page not found: ${parsed.value}`, "pageId") };
  }
  const page = state.pagesById[parsed.value];
  if (!page) return { error: failure("not_found", `Page not found: ${parsed.value}`, "pageId") };
  return { value: page };
}

/** Read a page only when the ID is an own key of the JSON-shaped page map. */
function ownPage(state: AppState, pageId: string): Page | undefined {
  if (!Object.prototype.hasOwnProperty.call(state.pagesById, pageId)) return undefined;
  const page = state.pagesById[pageId];
  return page && typeof page === "object" ? page : undefined;
}

function parseSource(
  input: RecordInput,
  sourceTypeRequired = true,
): { value: PageSource } | { error: ToolFailure } {
  const sourceType = ownValue(input, "sourceType");
  const source = ownValue(input, "source");
  if (sourceType === undefined && !sourceTypeRequired) {
    return { error: failure("missing_input", "sourceType and source must be provided together", "sourceType") };
  }
  if (sourceType !== "url" && sourceType !== "html") {
    return { error: failure("invalid_input", "sourceType must be url or html", "sourceType") };
  }
  if (typeof source !== "string") {
    return { error: failure("invalid_input", "source must be a string", "source") };
  }
  const candidate: PageSource = { type: sourceType, value: sourceType === "url" ? source.trim() : source };
  const validationError = validatePageSource(candidate);
  if (validationError) return { error: failure("invalid_input", validationError, "source") };
  return { value: candidate };
}

function parsePosition(
  input: RecordInput,
  options: { allowPartial?: boolean } = {},
): { value?: CanvasPosition } | { error: ToolFailure } {
  const x = optionalFiniteNumber(input, "x");
  if ("error" in x) return x;
  const y = optionalFiniteNumber(input, "y");
  if ("error" in y) return y;
  const hasX = x.value !== undefined;
  const hasY = y.value !== undefined;
  if (!hasX && !hasY) return {};
  if (!options.allowPartial && (!hasX || !hasY)) {
    return { error: failure("invalid_input", "x and y must be provided together", "x") };
  }
  return { value: { x: x.value ?? 0, y: y.value ?? 0 } };
}

function dispatch<Action>(
  runtime: WebMcpRuntime<Action>,
  action: Record<string, unknown>,
  verify?: (state: AppState) => boolean,
  verificationMessage = "The requested change was not applied",
): ToolFailure | null {
  try {
    // The adapter's action shape intentionally mirrors the public reducer
    // commands. The generic keeps callers' concrete AppAction type intact.
    runtime.dispatch(action as Action);
    if (verify && !verify(runtime.getState())) {
      return failure("conflict", verificationMessage);
    }
    return null;
  } catch (error) {
    const message = error instanceof Error ? error.message : "The requested action failed";
    return failure("action_failed", message);
  }
}

function pageSummary(page: Page): Record<string, unknown> {
  const sourcePreview = page.source.type === "html" ? page.source.value.slice(0, 12_000) : page.source.value;
  return {
    id: page.id,
    boardId: page.boardId,
    title: page.title,
    sourceType: page.source.type,
    source: sourcePreview,
    sourceTruncated: page.source.type === "html" && sourcePreview.length < page.source.value.length,
    canvasPosition: { x: page.canvasPosition.x, y: page.canvasPosition.y },
    createdAt: page.createdAt,
    updatedAt: page.updatedAt,
  };
}

function pageMatchesChanges(page: Page | undefined, changes: UpdatePageInput): boolean {
  if (!page) return false;
  if (changes.title !== undefined && page.title !== changes.title.trim()) return false;
  if (changes.source !== undefined) {
    const expectedSource = changes.source.type === "url" ? changes.source.value.trim() : changes.source.value;
    if (page.source.type !== changes.source.type || page.source.value !== expectedSource) return false;
  }
  if (changes.canvasPosition !== undefined &&
      (page.canvasPosition.x !== changes.canvasPosition.x || page.canvasPosition.y !== changes.canvasPosition.y)) {
    return false;
  }
  return true;
}

const selectorProperties: Record<string, JsonSchema> = {
  boardId: { type: "string", minLength: 1, description: "Stable board ID" },
  boardIndex: { type: "integer", minimum: 0, description: "Zero-based board index" },
};

const pageSelectorProperties: Record<string, JsonSchema> = {
  pageId: { type: "string", minLength: 1, description: "Stable page ID" },
};

const sourceProperties: Record<string, JsonSchema> = {
  sourceType: { type: "string", enum: ["url", "html"] },
  source: {
    type: "string",
    minLength: 1,
    maxLength: limits.maxHtmlLength,
    description: `URL or complete HTML document (URL max ${limits.maxUrlLength}; HTML max ${limits.maxHtmlLength} characters)`,
  },
};

// Keep the discoverable schema as strict as the runtime validators. A flat
// `source.maxLength` must use the HTML ceiling so generated documents remain
// usable; these conditional constraints narrow URL inputs to their smaller
// limit without duplicating the common source properties on every tool.
const sourceLengthConstraints: JsonSchema[] = [
  {
    if: { properties: { sourceType: { enum: ["url"] } }, required: ["sourceType"] },
    then: { properties: { source: { maxLength: limits.maxUrlLength } } },
  },
  {
    if: { properties: { sourceType: { enum: ["html"] } }, required: ["sourceType"] },
    then: { properties: { source: { maxLength: limits.maxHtmlLength } } },
  },
];

/** Build the tool descriptors without touching the browser global. */
export function createWebMcpTools<Action = unknown>(runtime: WebMcpRuntime<Action>): ModelContextTool[] {
  const listBoards: ModelContextTool = {
    name: "list_boards",
    description: "List all AI interface boards and their page counts.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      // Board names are user/AI-controlled text and must not be treated as
      // instructions by the host model.
      untrustedContentHint: true,
    },
    execute: async (rawInput) => {
      const input = asRecord(rawInput ?? {});
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, []);
      if (unknown) return unknown;
      const state = runtime.getState();
      return success("list_boards", {
        activeBoardId: state.activeBoardId,
        boards: state.boards.map((board) => ({
          id: board.id,
          name: board.name,
          pageCount: board.pageIds.length,
          layoutMode: board.layoutMode,
          createdAt: board.createdAt,
          updatedAt: board.updatedAt,
        })),
      });
    },
  };

  const listPages: ModelContextTool = {
    name: "list_pages",
    description: "List pages in a board. Omit the board selector to use the active board.",
    inputSchema: {
      type: "object",
      properties: selectorProperties,
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      idempotentHint: true,
      openWorldHint: false,
      untrustedContentHint: true,
    },
    execute: async (rawInput) => {
      const input = asRecord(rawInput ?? {});
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, ["boardId", "boardIndex"]);
      if (unknown) return unknown;
      const conflict = rejectConflictingSelectors(input, "boardId", "boardIndex");
      if (conflict) return conflict;
      const state = runtime.getState();
      const resolved = boardFromSelector(state, input);
      if ("error" in resolved) return resolved.error;
      const board = resolved.value;
      return success("list_pages", {
        board: { id: board.id, name: board.name, layoutMode: board.layoutMode },
        pages: board.pageIds
          .map((pageId) => ownPage(state, pageId))
          .filter((page): page is Page => Boolean(page))
          .map(pageSummary),
      });
    },
  };

  const createBoard: ModelContextTool = {
    name: "create_board",
    description: "Create a board and optionally make it active.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", minLength: 1, maxLength: limits.maxBoardNameLength, description: "Board name" },
        layoutMode: { type: "string", enum: ["grid", "canvas"] },
        activate: { type: "boolean", description: "Select the new board" },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    execute: async (rawInput) => {
      const input = asRecord(rawInput);
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, ["name", "layoutMode", "activate"]);
      if (unknown) return unknown;
      const name = requiredString(input, "name");
      if ("error" in name) return name.error;
      const nameError = validateBoardName(name.value);
      if (nameError) return failure("invalid_input", nameError, "name");
      const requestedLayoutMode = ownValue(input, "layoutMode");
      const layoutMode = requestedLayoutMode === undefined ? "grid" : requestedLayoutMode;
      if (!isLayoutMode(layoutMode)) {
        return failure("invalid_input", "layoutMode must be grid or canvas", "layoutMode");
      }
      const activate = optionalBoolean(input, "activate", true);
      if ("error" in activate) return activate.error;
      const board: CreateBoardInput = {
        id: createId("board"),
        name: name.value,
        layoutMode,
        createdAt: nowIso(),
      };
      const actionError = dispatch(runtime, {
        type: "CREATE_BOARD",
        payload: { board, activate: activate.value },
      }, (next) => next.boards.some((candidate) => candidate.id === board.id), "Board creation was not applied");
      if (actionError) return actionError;
      return success("create_board", {
        boardId: board.id,
        board: { id: board.id, name: board.name, layoutMode: board.layoutMode },
      });
    },
  };

  const renameBoard: ModelContextTool = {
    name: "rename_board",
    description: "Rename a board selected by ID or zero-based index. Defaults to the active board.",
    inputSchema: {
      type: "object",
      properties: {
        ...selectorProperties,
        name: { type: "string", minLength: 1, maxLength: limits.maxBoardNameLength },
      },
      required: ["name"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    execute: async (rawInput) => {
      const input = asRecord(rawInput);
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, ["boardId", "boardIndex", "name"]);
      if (unknown) return unknown;
      const conflict = rejectConflictingSelectors(input, "boardId", "boardIndex");
      if (conflict) return conflict;
      const board = boardFromSelector(runtime.getState(), input);
      if ("error" in board) return board.error;
      const name = requiredString(input, "name");
      if ("error" in name) return name.error;
      const nameError = validateBoardName(name.value);
      if (nameError) return failure("invalid_input", nameError, "name");
      const actionError = dispatch(runtime, {
        type: "RENAME_BOARD",
        payload: { boardId: board.value.id, name: name.value },
      }, (next) => next.boards.find((candidate) => candidate.id === board.value.id)?.name === name.value, "Board rename was not applied");
      if (actionError) return actionError;
      return success("rename_board", { boardId: board.value.id, name: name.value });
    },
  };

  const deleteBoard: ModelContextTool = {
    name: "delete_board",
    description:
      "Delete a board. The last board cannot be deleted; a non-empty board requires a target board for page migration.",
    inputSchema: {
      type: "object",
      properties: {
        ...selectorProperties,
        targetBoardId: { type: "string", description: "Board receiving existing pages" },
        targetBoardIndex: { type: "integer", minimum: 0 },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      consequentialHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async (rawInput) => {
      const input = asRecord(rawInput);
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, ["boardId", "boardIndex", "targetBoardId", "targetBoardIndex"]);
      if (unknown) return unknown;
      const sourceConflict = rejectConflictingSelectors(input, "boardId", "boardIndex");
      if (sourceConflict) return sourceConflict;
      const targetConflict = rejectConflictingSelectors(input, "targetBoardId", "targetBoardIndex");
      if (targetConflict) return targetConflict;
      const state = runtime.getState();
      const board = boardFromSelector(state, input);
      if ("error" in board) return board.error;
      if (state.boards.length <= 1) {
        return failure("last_board", "The last board cannot be deleted");
      }
      const targetBoardId = ownValue(input, "targetBoardId");
      const targetBoardIndex = ownValue(input, "targetBoardIndex");
      const targetInput: RecordInput = {
        ...(targetBoardId !== undefined ? { boardId: targetBoardId } : {}),
        ...(targetBoardIndex !== undefined ? { boardIndex: targetBoardIndex } : {}),
      };
      let target: Board | undefined;
      if (board.value.pageIds.length > 0) {
        if (Object.keys(targetInput).length === 0) {
          return failure("target_required", "Provide targetBoardId or targetBoardIndex for a non-empty board");
        }
        const resolvedTarget = targetBoardFromSelector(state, targetInput);
        if ("error" in resolvedTarget) return resolvedTarget.error;
        target = resolvedTarget.value;
      } else if (Object.keys(targetInput).length > 0) {
        const resolvedTarget = targetBoardFromSelector(state, targetInput);
        if ("error" in resolvedTarget) return resolvedTarget.error;
        target = resolvedTarget.value;
      }
      if (target && target.id === board.value.id) {
        return failure("invalid_input", "target board must differ from board being deleted", "targetBoardId");
      }
      const migratedPageIds = board.value.pageIds.filter((pageId) => Boolean(ownPage(state, pageId)));
      const actionError = dispatch(runtime, {
        type: "DELETE_BOARD",
        payload: { boardId: board.value.id, ...(target ? { targetBoardId: target.id } : {}) },
      }, (next) => {
        if (next.boards.some((candidate) => candidate.id === board.value.id)) return false;
        return target
          ? migratedPageIds.every((pageId) => ownPage(next, pageId)?.boardId === target?.id)
          : true;
      }, "Board deletion was not applied");
      if (actionError) return actionError;
      return success("delete_board", {
        boardId: board.value.id,
        ...(target ? { migratedToBoardId: target.id, migratedPageCount: board.value.pageIds.length } : {}),
      });
    },
  };

  const createPage: ModelContextTool = {
    name: "create_page",
    description:
      "Create a URL or HTML page in a board. Omit boardId/boardIndex to use the active board.",
    inputSchema: {
      type: "object",
      properties: {
        ...selectorProperties,
        title: { type: "string", minLength: 1, maxLength: limits.maxPageTitleLength },
        ...sourceProperties,
        x: { type: "number", description: "Canvas x coordinate" },
        y: { type: "number", description: "Canvas y coordinate" },
        index: { type: "integer", minimum: 0, description: "Grid insertion index" },
        select: { type: "boolean", description: "Select the new page" },
      },
      required: ["title", "sourceType", "source"],
      allOf: sourceLengthConstraints,
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
      untrustedContentHint: true,
    },
    execute: async (rawInput) => {
      const input = asRecord(rawInput);
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, [
        "boardId",
        "boardIndex",
        "title",
        "sourceType",
        "source",
        "x",
        "y",
        "index",
        "select",
      ]);
      if (unknown) return unknown;
      const conflict = rejectConflictingSelectors(input, "boardId", "boardIndex");
      if (conflict) return conflict;
      const state = runtime.getState();
      const board = boardFromSelector(state, input);
      if ("error" in board) return board.error;
      const title = requiredString(input, "title");
      if ("error" in title) return title.error;
      const titleError = validatePageTitle(title.value);
      if (titleError) return failure("invalid_input", titleError, "title");
      const source = parseSource(input);
      if ("error" in source) return source.error;
      const position = parsePosition(input);
      if ("error" in position) return position.error;
      const index = optionalInteger(input, "index");
      if ("error" in index) return index.error;
      const select = optionalBoolean(input, "select", true);
      if ("error" in select) return select.error;
      const insertionIndex = index.value === undefined ? undefined : Math.min(index.value, board.value.pageIds.length);
      const createdAt = nowIso();
      // Build a complete Page here so the returned ID/metadata exactly match
      // the object handed to the reducer (which also accepts CreatePageInput).
      const page: Page = {
        id: createId("page"),
        boardId: board.value.id,
        title: title.value,
        source: source.value,
        canvasPosition: position.value ?? getDefaultCanvasPosition(board.value.pageIds.length),
        createdAt,
        updatedAt: createdAt,
      };
      const actionError = dispatch(runtime, {
        type: "CREATE_PAGE",
        payload: { page, ...(insertionIndex === undefined ? {} : { index: insertionIndex }), select: select.value },
      }, (next) => ownPage(next, page.id)?.boardId === page.boardId, "Page creation was not applied");
      if (actionError) return actionError;
      const createdPage = ownPage(runtime.getState(), page.id) ?? page;
      return success("create_page", {
        pageId: page.id,
        boardId: page.boardId,
        boardName: board.value.name,
        page: pageSummary(createdPage),
      });
    },
  };

  const updatePage: ModelContextTool = {
    name: "update_page",
    description: "Update a page title, source, and/or canvas position.",
    inputSchema: {
      type: "object",
      properties: {
        ...pageSelectorProperties,
        title: { type: "string", minLength: 1, maxLength: limits.maxPageTitleLength },
        ...sourceProperties,
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["pageId"],
      anyOf: [
        { required: ["title"] },
        { required: ["sourceType", "source"] },
        { required: ["x", "y"] },
      ],
      dependentRequired: {
        sourceType: ["source"],
        source: ["sourceType"],
        x: ["y"],
        y: ["x"],
      },
      allOf: sourceLengthConstraints,
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    execute: async (rawInput) => {
      const input = asRecord(rawInput);
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, ["pageId", "title", "sourceType", "source", "x", "y"]);
      if (unknown) return unknown;
      const state = runtime.getState();
      const page = pageFromId(state, input);
      if ("error" in page) return page.error;
      const changes: UpdatePageInput = {};
      if (hasOwn(input, "title")) {
        const title = requiredString(input, "title");
        if ("error" in title) return title.error;
        const titleError = validatePageTitle(title.value);
        if (titleError) return failure("invalid_input", titleError, "title");
        changes.title = title.value;
      }
      const hasSourceType = hasOwn(input, "sourceType");
      const hasSource = hasOwn(input, "source");
      if (hasSourceType || hasSource) {
        const source = parseSource(input);
        if ("error" in source) return source.error;
        changes.source = source.value;
      }
      const position = parsePosition(input);
      if ("error" in position) return position.error;
      if (position.value) changes.canvasPosition = position.value;
      if (Object.keys(changes).length === 0) {
        return failure("missing_input", "Provide at least one field to update");
      }
      const actionError = dispatch(runtime, {
        type: "UPDATE_PAGE",
        payload: { pageId: page.value.id, changes },
      }, (next) => pageMatchesChanges(ownPage(next, page.value.id), changes), "Page update was not applied");
      if (actionError) return actionError;
      return success("update_page", { pageId: page.value.id, updatedFields: Object.keys(changes) });
    },
  };

  const movePage: ModelContextTool = {
    name: "move_page",
    description: "Move a page to another board or reorder it within its current board.",
    inputSchema: {
      type: "object",
      properties: {
        ...pageSelectorProperties,
        targetBoardId: { type: "string" },
        targetBoardIndex: { type: "integer", minimum: 0 },
        targetIndex: { type: "integer", minimum: 0 },
      },
      required: ["pageId"],
      // A destination is mandatory; the runtime also rejects both selectors
      // being supplied together and resolves the target by stable ID/index.
      oneOf: [{ required: ["targetBoardId"] }, { required: ["targetBoardIndex"] }],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: false },
    execute: async (rawInput) => {
      const input = asRecord(rawInput);
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, ["pageId", "targetBoardId", "targetBoardIndex", "targetIndex"]);
      if (unknown) return unknown;
      const targetConflict = rejectConflictingSelectors(input, "targetBoardId", "targetBoardIndex");
      if (targetConflict) return targetConflict;
      const state = runtime.getState();
      const page = pageFromId(state, input);
      if ("error" in page) return page.error;
      const targetBoardId = ownValue(input, "targetBoardId");
      const targetBoardIndex = ownValue(input, "targetBoardIndex");
      const targetInput: RecordInput = {
        ...(targetBoardId !== undefined ? { boardId: targetBoardId } : {}),
        ...(targetBoardIndex !== undefined ? { boardIndex: targetBoardIndex } : {}),
      };
      if (Object.keys(targetInput).length === 0) {
        return failure("invalid_input", "Provide targetBoardId or targetBoardIndex", "targetBoardId");
      }
      const target = targetBoardFromSelector(state, targetInput);
      if ("error" in target) return target.error;
      const targetIndex = optionalInteger(input, "targetIndex");
      if ("error" in targetIndex) return targetIndex.error;
      const maxIndex = target.value.pageIds.length - (target.value.id === page.value.boardId ? 1 : 0);
      const insertionIndex =
        targetIndex.value === undefined ? undefined : Math.min(targetIndex.value, Math.max(0, maxIndex));
      const actionError = dispatch(runtime, {
        type: "MOVE_PAGE",
        payload: {
          pageId: page.value.id,
          targetBoardId: target.value.id,
          ...(insertionIndex === undefined ? {} : { targetIndex: insertionIndex }),
        },
      }, (next) => {
        const moved = ownPage(next, page.value.id);
        const destination = next.boards.find((candidate) => candidate.id === target.value.id);
        if (!moved || moved.boardId !== target.value.id || !destination?.pageIds.includes(page.value.id)) return false;
        return insertionIndex === undefined || destination.pageIds[insertionIndex] === page.value.id;
      }, "Page move was not applied");
      if (actionError) return actionError;
      return success("move_page", {
        pageId: page.value.id,
        fromBoardId: page.value.boardId,
        targetBoardId: target.value.id,
        targetBoardName: target.value.name,
        ...(insertionIndex === undefined ? {} : { targetIndex: insertionIndex }),
      });
    },
  };

  const deletePage: ModelContextTool = {
    name: "delete_page",
    description: "Delete a page by its stable page ID.",
    inputSchema: {
      type: "object",
      properties: pageSelectorProperties,
      required: ["pageId"],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      consequentialHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
    execute: async (rawInput) => {
      const input = asRecord(rawInput);
      if (!input) return failure("invalid_input", "Input must be an object");
      const unknown = rejectUnknownKeys(input, ["pageId"]);
      if (unknown) return unknown;
      const page = pageFromId(runtime.getState(), input);
      if ("error" in page) return page.error;
      const actionError = dispatch(runtime, {
        type: "DELETE_PAGE",
        payload: { pageId: page.value.id },
      }, (next) => ownPage(next, page.value.id) === undefined, "Page deletion was not applied");
      if (actionError) return actionError;
      return success("delete_page", { pageId: page.value.id, boardId: page.value.boardId });
    },
  };

  return [
    listBoards,
    listPages,
    createBoard,
    renameBoard,
    deleteBoard,
    createPage,
    updatePage,
    movePage,
    deletePage,
  ];
}

function isTopLevelDocument(): boolean {
  if (typeof document === "undefined") return false;
  if (typeof window !== "undefined") {
    try {
      // Codex does not discover iframe registrations. Failing closed here also
      // prevents an accidental mount inside a preview from registering tools.
      if (window.self !== window.top) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function getDocumentModelContext(): ModelContext | undefined {
  if (!isTopLevelDocument()) return undefined;
  // Codex's built-in browser discovers Site tools from the top-level document
  // context. Read it defensively because a managed host may expose a throwing
  // getter while its WebMCP surface is being initialized.
  let context: ModelContext | undefined;
  try {
    // Codex's built-in browser exposes the document-scoped surface. The board
    // intentionally does not fall back to navigator.modelContext: the product
    // contract is scoped to the top-level workbench document, and registering
    // against a second surface can create duplicate Site tools.
    context = document.modelContext;
  } catch {
    return undefined;
  }
  return hasRegisterTool(context) ? context : undefined;
}

export function isWebMcpSupported(modelContext?: ModelContext): boolean {
  if (!isTopLevelDocument()) return false;
  const context = modelContext ?? getDocumentModelContext();
  return hasRegisterTool(context);
}

/**
 * Register tools on the top-level document only. Call this from the board
 * page's effect; never call it from a preview iframe.
 */
export function registerWebMcpTools<Action = unknown>(
  runtime: WebMcpRuntime<Action>,
  options: {
    modelContext?: ModelContext;
    onError?: (error: unknown, toolName: string, phase: WebMcpErrorPhase) => void;
    onStatus?: (status: WebMcpRegistrationStatus) => void;
  } = {},
): WebMcpRegistration {
  if (!isTopLevelDocument()) {
    return {
      supported: false,
      registered: false,
      pending: false,
      toolNames: [],
      errors: [],
      unregister: () => undefined,
    };
  }
  const context = options.modelContext ?? getDocumentModelContext();
  if (!hasRegisterTool(context)) {
    return {
      supported: false,
      registered: false,
      pending: false,
      toolNames: [],
      errors: [],
      unregister: () => undefined,
    };
  }

  // Keep accepted names separate from settled names. A host may return a
  // promise from registerTool; claiming those names as registered before the
  // promise resolves makes the UI report a connected integration that later
  // failed. Accepted names are still retained for unregisterTool fallback.
  const acceptedNames: string[] = [];
  const registeredNames: string[] = [];
  const pendingNames = new Set<string>();
  const errors: string[] = [];
  const unregisterCallbacks: Array<() => void> = [];
  const callbackNames = new Set<string>();
  const fallbackUnregisteredNames = new Set<string>();
  // The current WebMCP API uses an AbortSignal as the page-scoped lifecycle.
  // Keep the controller optional for older/non-DOM hosts used in tests.
  const lifecycle = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  let disposed = false;
  const tools = createWebMcpTools(runtime).map((tool) => ({
    ...tool,
    execute: async (input: unknown, executeOptions?: ToolExecuteOptions) => {
      if (disposed || executeOptions?.signal?.aborted) {
        return failure("registration_closed", "This WebMCP registration is no longer active");
      }
      return tool.execute(input, executeOptions);
    },
  }));

  const statusSnapshot = (): WebMcpRegistrationStatus => ({
    supported: true,
    registered: registeredNames.length > 0,
    pending: pendingNames.size > 0,
    toolNames: [...registeredNames],
    errors: [...errors],
  });
  const notifyStatus = () => {
    if (!disposed) {
      // A consumer callback must not turn a settled registration into a
      // rejected registration or produce an unhandled promise rejection.
      try {
        options.onStatus?.(statusSnapshot());
      } catch {
        // Status reporting is advisory; the registration lifecycle remains
        // owned by the host and continues regardless of callback failures.
      }
    }
  };
  const addRegisteredName = (name: string) => {
    if (!registeredNames.includes(name)) registeredNames.push(name);
  };

  for (const tool of tools) {
    try {
      // The documented Codex/WebMCP surface accepts the tool as its sole
      // argument. Keep lifecycle cancellation local to the wrapper below;
      // passing a second, host-specific options object can make a native
      // implementation reject registration before any tool is discoverable.
      const result = context.registerTool(tool);
      acceptedNames.push(tool.name);
      if (typeof result === "function") {
        addRegisteredName(tool.name);
        callbackNames.add(tool.name);
        unregisterCallbacks.push(() => {
          try {
            (result as () => unknown)();
          } catch (error) {
            reportWebMcpError(options.onError, error, tool.name, "unregister");
          }
        });
      } else if (result && typeof (result as Promise<unknown>).then === "function") {
        // Some hosts return a promise for registration. Keep the tool pending
        // until it settles so a rejected promise cannot leave a stale
        // "connected" status in the board UI.
        pendingNames.add(tool.name);
        void Promise.resolve(result as PromiseLike<unknown>).then(
          (resolved) => {
            pendingNames.delete(tool.name);
            if (typeof resolved === "function") {
              if (disposed) {
                // A legacy host may expose both a pending unregister handle
                // and an unregisterTool fallback. If cleanup already used the
                // fallback, invoking this late handle would unregister twice.
                if (!fallbackUnregisteredNames.has(tool.name)) {
                  try {
                    (resolved as () => unknown)();
                  } catch (error) {
                    reportWebMcpError(options.onError, error, tool.name, "unregister");
                  }
                }
                return;
              }
              addRegisteredName(tool.name);
              callbackNames.add(tool.name);
              unregisterCallbacks.push(() => {
                try {
                  (resolved as () => unknown)();
                } catch (error) {
                  reportWebMcpError(options.onError, error, tool.name, "unregister");
                }
              });
            } else if (!disposed) {
              addRegisteredName(tool.name);
            }
            notifyStatus();
          },
          (error) => {
            pendingNames.delete(tool.name);
            // Aborting a pending registration is an expected cleanup path,
            // especially when React StrictMode remounts an effect in dev.
            if (disposed && lifecycle?.signal.aborted) return;
            errors.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
            reportWebMcpError(options.onError, error, tool.name, "register");
            notifyStatus();
          },
        );
      } else {
        // The current WebMCP surface commonly returns void for a successful
        // synchronous registration.
        addRegisteredName(tool.name);
      }
    } catch (error) {
      errors.push(`${tool.name}: ${error instanceof Error ? error.message : String(error)}`);
      reportWebMcpError(options.onError, error, tool.name, "register");
    }
  }

  const registration: WebMcpRegistration = {
    supported: true,
    get registered() {
      return registeredNames.length > 0;
    },
    get pending() {
      return pendingNames.size > 0;
    },
    get toolNames() {
      return [...registeredNames];
    },
    get errors() {
      return [...errors];
    },
    unregister: () => {
      if (disposed) return;
      disposed = true;
      lifecycle?.abort();
      // Reflect the lifecycle transition on the returned handle as well as on
      // the host. This prevents callers that retain the handle from observing
      // a stale "connected" status after cleanup.
      registeredNames.splice(0);
      pendingNames.clear();
      for (const callback of unregisterCallbacks.splice(0)) callback();
      let unregisterTool: ModelContext["unregisterTool"];
      try {
        unregisterTool = context.unregisterTool;
      } catch {
        unregisterTool = undefined;
      }
      if (typeof unregisterTool === "function") {
        for (const name of acceptedNames) {
          // Hosts generally expose either a callback return value or
          // unregisterTool; avoid invoking both when a host happens to expose
          // both surfaces.
          if (callbackNames.has(name)) continue;
          try {
            const result = unregisterTool.call(context, name);
            fallbackUnregisteredNames.add(name);
            if (result && typeof (result as Promise<unknown>).then === "function") {
              (result as Promise<unknown>).catch((error) => {
                reportWebMcpError(options.onError, error, name, "unregister");
              });
            }
          } catch (error) {
            reportWebMcpError(options.onError, error, name, "unregister");
          }
        }
      }
    },
  };

  // Notify once for synchronous hosts as well. Consumers can use one callback
  // for both initial detection and later promise settlement.
  notifyStatus();
  return registration;
}

// Capitalized aliases match the WebMCP acronym and make the integration easy
// to discover for callers that use either naming convention.
export const registerWebMCP = registerWebMcpTools;
export const createWebMCPTools = createWebMcpTools;

// Keep these imports in the generated declaration surface for consumers that
// want to narrow values before calling a tool adapter.
export { isCanvasPosition, validatePageSource, validatePageTitle };
