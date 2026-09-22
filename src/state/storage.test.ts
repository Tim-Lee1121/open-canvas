import { describe, expect, it } from "vitest";
import { createInitialState } from "../domain/model";
import { createSeedState } from "../test/fixtures";
import {
  STORAGE_KEY,
  DEFAULT_PROJECT_NAME,
  PROJECT_NAME_STORAGE_KEY,
  deserializeState,
  loadProjectName,
  loadState,
  saveState,
  saveProjectName,
  serializeState,
  type StorageLike,
} from "./storage";

class MemoryStorage implements StorageLike {
  private values = new Map<string, string>();
  throwOnSet = false;

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.throwOnSet) throw new Error("quota exceeded");
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("state storage", () => {
  it("round-trips a valid state under the versioned key", () => {
    const storage = new MemoryStorage();
    const seed = createSeedState();
    expect(saveState(seed, storage)).toBe(true);
    expect(storage.getItem(STORAGE_KEY)).toContain('"schemaVersion":1');
    const loaded = loadState(storage);
    expect(loaded).toEqual(seed);
    expect(loaded).not.toBe(seed);
  });

  it("falls back to the provided data for missing, corrupt and incompatible values", () => {
    const fallback = createSeedState();
    const storage = new MemoryStorage();
    expect(loadState(storage, fallback)).toEqual(fallback);

    storage.setItem(STORAGE_KEY, "not-json");
    expect(loadState(storage, fallback)).toEqual(fallback);

    const incompatible = { ...fallback, schemaVersion: 999 };
    storage.setItem(STORAGE_KEY, JSON.stringify(incompatible));
    expect(loadState(storage, fallback)).toEqual(fallback);
    expect(deserializeState(JSON.stringify(incompatible), fallback)).toEqual(fallback);

    const invalidName = JSON.parse(serializeState(fallback)) as { boards: Array<{ name: string }> };
    invalidName.boards[0].name = "";
    storage.setItem(STORAGE_KEY, JSON.stringify(invalidName));
    expect(loadState(storage, fallback)).toEqual(fallback);

    const invalidShape = { ...fallback, pagesById: [] };
    storage.setItem(STORAGE_KEY, JSON.stringify(invalidShape));
    expect(loadState(storage, fallback)).toEqual(fallback);
  });

  it("returns false instead of throwing when storage is unavailable or over quota", () => {
    const seed = createSeedState();
    const failing = new MemoryStorage();
    failing.throwOnSet = true;
    expect(() => saveState(seed, failing)).not.toThrow();
    expect(saveState(seed, failing)).toBe(false);
    expect(saveState(seed, null)).toBe(false);
    expect(loadState(null)).toMatchObject({
      boards: [{ id: "board-default", name: "New board", pageIds: [], layoutMode: "canvas" }],
      pagesById: {},
      activeBoardId: "board-default",
      selectedPageId: null,
    });
  });

  it("serializes a normalized schema version", () => {
    const seed = createSeedState();
    const parsed = JSON.parse(serializeState({ ...seed, schemaVersion: 1 }));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.boards).toHaveLength(2);
  });

  it("persists a validated project name separately from board state", () => {
    const storage = new MemoryStorage();
    expect(loadProjectName(storage)).toBe(DEFAULT_PROJECT_NAME);
    expect(saveProjectName("  Mobile concepts  ", storage)).toBe(true);
    expect(storage.getItem(PROJECT_NAME_STORAGE_KEY)).toBe("Mobile concepts");
    expect(loadProjectName(storage)).toBe("Mobile concepts");
    expect(saveProjectName("   ", storage)).toBe(false);
    expect(saveProjectName("x".repeat(81), storage)).toBe(false);
  });

  it("migrates shipped default project names to the current product name", () => {
    const storage = new MemoryStorage();
    storage.setItem(PROJECT_NAME_STORAGE_KEY, "AI Page Board");
    expect(loadProjectName(storage)).toBe(DEFAULT_PROJECT_NAME);

    storage.setItem(PROJECT_NAME_STORAGE_KEY, "Neuxmind Canvas");
    expect(loadProjectName(storage)).toBe(DEFAULT_PROJECT_NAME);

    storage.setItem(PROJECT_NAME_STORAGE_KEY, "Design exploration");
    expect(loadProjectName(storage)).toBe("Design exploration");
  });

  it("starts a fresh installation with one empty canvas board", () => {
    const initial = createInitialState();
    expect(initial.boards).toHaveLength(1);
    expect(initial.boards[0]).toMatchObject({
      id: "board-default",
      name: "New board",
      pageIds: [],
      layoutMode: "canvas",
    });
    expect(initial.pagesById).toEqual({});
    expect(initial.selectedPageId).toBeNull();
  });
});
