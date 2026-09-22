import {
  AppState,
  STATE_SCHEMA_VERSION,
  STORAGE_KEY,
  createInitialState,
  isAppState,
} from "../domain/model";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export interface SaveStateResult {
  ok: boolean;
  error?: unknown;
}

export const PROJECT_NAME_STORAGE_KEY = "codex-ai-board.project-name.v1";
export const DEFAULT_PROJECT_NAME = "Open Canvas";
const LEGACY_DEFAULT_PROJECT_NAMES = new Set(["AI Page Board", "AI page board", "974 Project", "Neuxmind Canvas"]);
const MAX_PROJECT_NAME_LENGTH = 80;

function resolveStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    const candidate = typeof globalThis !== "undefined" ? globalThis.localStorage : undefined;
    if (candidate && typeof candidate.getItem === "function" && typeof candidate.setItem === "function") {
      return candidate;
    }
  } catch {
    // Access to localStorage may throw in privacy/sandboxed contexts.
  }
  return null;
}

function cloneState(state: AppState): AppState {
  // State is JSON-shaped by design. Cloning protects callers from mutating the
  // seed/fallback object returned by a previous load.
  return JSON.parse(JSON.stringify(state)) as AppState;
}

export function serializeState(state: AppState): string {
  return JSON.stringify({ ...state, schemaVersion: STATE_SCHEMA_VERSION });
}

export function deserializeState(raw: string | null | undefined, fallback: AppState = createInitialState()): AppState {
  if (!raw) return cloneState(fallback);
  try {
    const parsed = JSON.parse(raw) as { boards?: Array<Record<string, unknown>> };
    // v1 states created before Tags existed are upgraded in memory. Keeping
    // the schema version stable makes the addition backwards compatible.
    const candidate = parsed && Array.isArray(parsed.boards)
      ? { ...parsed, boards: parsed.boards.map((board) => ({ ...board, tags: Array.isArray(board.tags) ? board.tags : [] })) }
      : parsed;
    return isAppState(candidate) ? cloneState(parsed as unknown as AppState) : cloneState(fallback);
  } catch {
    return cloneState(fallback);
  }
}

/** Read persisted state. Corrupt, missing or incompatible data returns a clean board. */
export function loadState(storage?: StorageLike | null, fallback: AppState = createInitialState()): AppState {
  const target = resolveStorage(storage);
  if (!target) return cloneState(fallback);
  try {
    return deserializeState(target.getItem(STORAGE_KEY), fallback);
  } catch {
    return cloneState(fallback);
  }
}

/** Persist state under the versioned key. Returns false for quota/security errors. */
export function saveState(state: AppState, storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(STORAGE_KEY, serializeState(state));
    return true;
  } catch {
    return false;
  }
}

/** Detailed variant for UIs that need to surface the storage failure reason. */
export function trySaveState(state: AppState, storage?: StorageLike | null): SaveStateResult {
  const target = resolveStorage(storage);
  if (!target) return { ok: false, error: new Error("localStorage is unavailable") };
  try {
    target.setItem(STORAGE_KEY, serializeState(state));
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

export function clearState(storage?: StorageLike | null): boolean {
  const target = resolveStorage(storage);
  if (!target || typeof target.removeItem !== "function") return false;
  try {
    target.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function loadProjectName(
  storage?: StorageLike | null,
  fallback = DEFAULT_PROJECT_NAME,
): string {
  const target = resolveStorage(storage);
  if (!target) return fallback;
  try {
    const stored = target.getItem(PROJECT_NAME_STORAGE_KEY)?.trim() ?? "";
    // Migrate names that shipped before the product was branded while keeping
    // genuinely user-defined project names untouched.
    if (LEGACY_DEFAULT_PROJECT_NAMES.has(stored)) return fallback;
    return stored && stored.length <= MAX_PROJECT_NAME_LENGTH ? stored : fallback;
  } catch {
    return fallback;
  }
}

export function saveProjectName(name: string, storage?: StorageLike | null): boolean {
  const normalized = name.trim();
  if (!normalized || normalized.length > MAX_PROJECT_NAME_LENGTH) return false;
  const target = resolveStorage(storage);
  if (!target) return false;
  try {
    target.setItem(PROJECT_NAME_STORAGE_KEY, normalized);
    return true;
  } catch {
    return false;
  }
}

// Friendly aliases used by integrations and tests.
export const readState = loadState;
export const writeState = saveState;
export const loadPersistedState = loadState;
export const savePersistedState = saveState;

export { STORAGE_KEY, STATE_SCHEMA_VERSION };
