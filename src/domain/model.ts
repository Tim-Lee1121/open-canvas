/**
 * Domain model for the local AI-generated mobile interface board.
 *
 * This module intentionally has no React or browser dependencies (apart from
 * the optional crypto UUID implementation in `createId`).  Both the UI and
 * integrations can therefore use the same validation and normalization rules.
 */

export const STATE_SCHEMA_VERSION = 1 as const;
export const STORAGE_KEY = "ai-board-state:v1" as const;

export type LayoutMode = "grid" | "canvas";

export type PageSource =
  | { type: "url"; value: string }
  | { type: "html"; value: string };

export interface CanvasPosition {
  x: number;
  y: number;
}

export type TagColor = "yellow" | "blue" | "pink";

export interface BoardTag {
  id: string;
  boardId: string;
  text: string;
  color: TagColor;
  canvasPosition: CanvasPosition;
  size?: { width: number; height: number };
  createdAt: string;
  updatedAt: string;
}

export interface Board {
  id: string;
  name: string;
  pageIds: string[];
  layoutMode: LayoutMode;
  createdAt: string;
  updatedAt: string;
  tags?: BoardTag[];
}

export interface Page {
  id: string;
  boardId: string;
  title: string;
  source: PageSource;
  canvasPosition: CanvasPosition;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  schemaVersion: typeof STATE_SCHEMA_VERSION;
  boards: Board[];
  pagesById: Record<string, Page>;
  activeBoardId: string;
  selectedPageId: string | null;
}

export interface CreateBoardInput {
  id?: string;
  name: string;
  layoutMode?: LayoutMode;
  createdAt?: string;
}

export interface CreatePageInput {
  id?: string;
  boardId: string;
  title: string;
  source: PageSource;
  canvasPosition?: CanvasPosition;
  createdAt?: string;
}

export interface UpdatePageInput {
  title?: string;
  source?: PageSource;
  canvasPosition?: CanvasPosition;
}

const MAX_BOARD_NAME_LENGTH = 120;
const MAX_PAGE_TITLE_LENGTH = 240;
const MAX_URL_LENGTH = 8_192;
const MAX_HTML_LENGTH = 1_000_000;
const MAX_TAG_TEXT_LENGTH = 120;

export const limits = Object.freeze({
  maxBoardNameLength: MAX_BOARD_NAME_LENGTH,
  maxPageTitleLength: MAX_PAGE_TITLE_LENGTH,
  maxUrlLength: MAX_URL_LENGTH,
  maxHtmlLength: MAX_HTML_LENGTH,
  maxTagTextLength: MAX_TAG_TEXT_LENGTH,
});

/** Return a UUID where available, with a deterministic-enough fallback. */
export function createId(prefix = "id"): string {
  try {
    const cryptoObject =
      typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
    if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
      return `${prefix}-${cryptoObject.randomUUID()}`;
    }
  } catch {
    // Some older browsers expose a partial crypto object. Fall through.
  }

  const random = Math.random().toString(36).slice(2, 10);
  const stamp = Date.now().toString(36);
  return `${prefix}-${stamp}-${random}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function trimText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function validateBoardName(value: unknown): string | null {
  const name = trimText(value);
  if (!name) return "Board name is required";
  if (name.length > MAX_BOARD_NAME_LENGTH) {
    return `Board name must be ${MAX_BOARD_NAME_LENGTH} characters or fewer`;
  }
  return null;
}

export function normalizeBoardName(value: unknown, fallback = "Untitled board"): string {
  const name = trimText(value);
  return name || fallback;
}

export function validatePageTitle(value: unknown): string | null {
  const title = trimText(value);
  if (!title) return "Page title is required";
  if (title.length > MAX_PAGE_TITLE_LENGTH) {
    return `Page title must be ${MAX_PAGE_TITLE_LENGTH} characters or fewer`;
  }
  return null;
}

export function normalizePageTitle(value: unknown, fallback = "Untitled page"): string {
  const title = trimText(value);
  return title || fallback;
}

export function validateUrl(value: unknown): string | null {
  const url = trimText(value);
  if (!url) return "URL is required";
  if (url.length > MAX_URL_LENGTH) return `URL must be ${MAX_URL_LENGTH} characters or fewer`;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Only http and https URLs are supported";
    }
  } catch {
    return "Enter a valid URL";
  }
  return null;
}

export function validateHtml(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return "HTML is required";
  if (value.length > MAX_HTML_LENGTH) {
    return `HTML must be ${MAX_HTML_LENGTH} characters or fewer`;
  }
  return null;
}

export function validatePageSource(source: unknown): string | null {
  if (!source || typeof source !== "object") return "Page source is required";
  const candidate = source as { type?: unknown; value?: unknown };
  if (candidate.type === "url") return validateUrl(candidate.value);
  if (candidate.type === "html") return validateHtml(candidate.value);
  return "Page source type must be url or html";
}

export function normalizePageSource(source: unknown): PageSource {
  if (source && typeof source === "object") {
    const candidate = source as { type?: unknown; value?: unknown };
    if (candidate.type === "url") {
      return { type: "url", value: trimText(candidate.value) };
    }
    if (candidate.type === "html") {
      return { type: "html", value: typeof candidate.value === "string" ? candidate.value : "" };
    }
  }
  return { type: "html", value: "" };
}

export function isLayoutMode(value: unknown): value is LayoutMode {
  return value === "grid" || value === "canvas";
}

export function isCanvasPosition(value: unknown): value is CanvasPosition {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { x?: unknown; y?: unknown };
  return (
    typeof candidate.x === "number" &&
    Number.isFinite(candidate.x) &&
    typeof candidate.y === "number" &&
    Number.isFinite(candidate.y)
  );
}

export function isTagColor(value: unknown): value is TagColor {
  return value === "yellow" || value === "blue" || value === "pink";
}

export function isTagSize(value: unknown): value is { width: number; height: number } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { width?: unknown; height?: unknown };
  return typeof candidate.width === "number" && Number.isFinite(candidate.width) && candidate.width >= 96
    && typeof candidate.height === "number" && Number.isFinite(candidate.height) && candidate.height >= 34;
}

export function validateTagText(value: unknown): string | null {
  const text = trimText(value);
  if (!text) return "Tag text is required";
  if (text.length > MAX_TAG_TEXT_LENGTH) return `Tag text must be ${MAX_TAG_TEXT_LENGTH} characters or fewer`;
  return null;
}

export function normalizeTagText(value: unknown, fallback = "New tag"): string {
  const text = trimText(value);
  return text || fallback;
}

export function getDefaultCanvasPosition(index: number): CanvasPosition {
  const safeIndex = Math.max(0, Math.floor(Number.isFinite(index) ? index : 0));
  // Leave enough room for the largest built-in mobile frame (412 x 915) plus
  // a visible gutter. New pages continue to the right so their insertion
  // order is immediately visible; explicit WebMCP coordinates still take
  // precedence.
  const cellWidth = 412;
  const gap = 32;
  return {
    x: safeIndex * (cellWidth + gap) + gap,
    y: gap,
  };
}

export function cloneSource(source: PageSource): PageSource {
  return { type: source.type, value: source.value };
}

/**
 * Basic runtime validation for persisted/imported state. It is deliberately
 * strict about references and IDs, while tolerating unknown extra properties
 * so future schema additions can be read by this version.
 */
export function isAppState(value: unknown): value is AppState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<AppState>;
  if (candidate.schemaVersion !== STATE_SCHEMA_VERSION) return false;
  if (
    !Array.isArray(candidate.boards) ||
    !candidate.pagesById ||
    typeof candidate.pagesById !== "object" ||
    Array.isArray(candidate.pagesById)
  ) {
    return false;
  }
  if (typeof candidate.activeBoardId !== "string") return false;
  if (!(candidate.selectedPageId === null || typeof candidate.selectedPageId === "string")) return false;

  const boardIds = new Set<string>();
  for (const board of candidate.boards) {
    if (!board || typeof board !== "object") return false;
    if (
      typeof board.id !== "string" ||
      !board.id ||
      boardIds.has(board.id) ||
      typeof board.name !== "string" ||
      validateBoardName(board.name) !== null ||
      !Array.isArray(board.pageIds) ||
      !isLayoutMode(board.layoutMode) ||
      typeof board.createdAt !== "string" ||
      typeof board.updatedAt !== "string" ||
      (!Array.isArray((board as Board).tags) && (board as { tags?: unknown }).tags !== undefined)
    ) {
      return false;
    }
    boardIds.add(board.id);
  }
  if (!boardIds.has(candidate.activeBoardId)) return false;

  const pageIds = new Set<string>();
  for (const [mapId, page] of Object.entries(candidate.pagesById as Record<string, unknown>)) {
    if (!page || typeof page !== "object") return false;
    const typedPage = page as Page;
    if (
      mapId !== typedPage.id ||
      !typedPage.id ||
      pageIds.has(typedPage.id) ||
      !boardIds.has(typedPage.boardId) ||
      typeof typedPage.title !== "string" ||
      validatePageTitle(typedPage.title) !== null ||
      validatePageSource(typedPage.source) !== null ||
      !isCanvasPosition(typedPage.canvasPosition) ||
      typeof typedPage.createdAt !== "string" ||
      typeof typedPage.updatedAt !== "string"
    ) {
      return false;
    }
    pageIds.add(typedPage.id);
  }

  const referencedPages = new Set<string>();
  for (const board of candidate.boards) {
    for (const pageId of board.pageIds) {
      if (typeof pageId !== "string" || referencedPages.has(pageId) || !pageIds.has(pageId)) {
        return false;
      }
      if ((candidate.pagesById as Record<string, Page>)[pageId].boardId !== board.id) return false;
      referencedPages.add(pageId);
    }
  }
  if (referencedPages.size !== pageIds.size) return false;
  for (const board of candidate.boards) {
    const tags = (board as Board).tags ?? [];
    if (!Array.isArray(tags)) return false;
    const tagIds = new Set<string>();
    for (const tag of tags) {
      if (!tag || typeof tag !== "object") return false;
      const candidateTag = tag as BoardTag;
      if (
        typeof candidateTag.id !== "string" || !candidateTag.id || tagIds.has(candidateTag.id) ||
        candidateTag.boardId !== board.id || validateTagText(candidateTag.text) !== null ||
        !isTagColor(candidateTag.color) || !isCanvasPosition(candidateTag.canvasPosition) ||
        (candidateTag.size !== undefined && !isTagSize(candidateTag.size)) ||
        typeof candidateTag.createdAt !== "string" || typeof candidateTag.updatedAt !== "string"
      ) return false;
      tagIds.add(candidateTag.id);
    }
  }
  if (
    candidate.selectedPageId !== null &&
    (!pageIds.has(candidate.selectedPageId) ||
      (candidate.pagesById as Record<string, Page>)[candidate.selectedPageId].boardId !== candidate.activeBoardId)
  ) return false;
  return true;
}

/** Build the clean, single-board state used by a fresh installation. */
export function createInitialState(): AppState {
  const createdAt = nowIso();
  const boardId = "board-default";
  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    boards: [
      {
        id: boardId,
        name: "New board",
        pageIds: [],
        layoutMode: "canvas",
        createdAt,
        updatedAt: createdAt,
        tags: [],
      },
    ],
    pagesById: {},
    activeBoardId: boardId,
    selectedPageId: null,
  };
}
