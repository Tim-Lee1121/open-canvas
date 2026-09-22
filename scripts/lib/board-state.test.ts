import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../../src/domain/model";
import {
  createProjectStateRevision,
  readProjectState,
  resolveLegacyProjectStatePath,
  resolveProjectStatePath,
  serializeProjectState,
  writeProjectState,
} from "./board-state";

describe("project board state file", () => {
  it("writes and reads a valid state with a stable content revision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-board-state-"));
    const filePath = join(directory, "data", "board-state.json");
    const state = createInitialState();
    state.boards[0] = { ...state.boards[0], name: "Client generated" };

    const written = await writeProjectState(state, filePath);
    const serialized = await readFile(filePath, "utf8");
    const loaded = await readProjectState(filePath);

    expect(loaded.state).toEqual(state);
    expect(loaded.revision).toBe(written.revision);
    expect(loaded.revision).toBe(createProjectStateRevision(serialized));
    expect(serialized).toBe(serializeProjectState(state));
  });

  it("rejects corrupt and schema-incompatible files instead of overwriting them", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-board-state-invalid-"));
    const filePath = join(directory, "board-state.json");

    await writeFile(filePath, "not-json", "utf8");
    await expect(readProjectState(filePath)).rejects.toThrow("not valid JSON");

    await writeFile(filePath, JSON.stringify({ schemaVersion: 99 }), "utf8");
    await expect(readProjectState(filePath)).rejects.toThrow("does not match schema version 1");
  });

  it("returns a clean state when the project file does not exist", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codex-board-state-missing-"));
    const snapshot = await readProjectState(join(directory, "missing.json"));
    expect(snapshot.state.boards).toHaveLength(1);
    expect(snapshot.state.boards[0]).toMatchObject({ id: "board-default", pageIds: [] });
    expect(snapshot.state.pagesById).toEqual({});
  });

  it("reads legacy state without changing it and writes the next update outside the project", async () => {
    const root = await mkdtemp(join(tmpdir(), "open-canvas-migration-"));
    const legacy = resolveLegacyProjectStatePath(root);
    const target = resolveProjectStatePath(root);
    const state = createInitialState();
    state.boards[0] = { ...state.boards[0], name: "Existing board" };
    await writeProjectState(state, legacy);
    expect(target.startsWith(`${root}/`)).toBe(false);

    expect((await readProjectState(target, legacy)).state).toEqual(state);
    await writeProjectState(state, target);
    expect((await readProjectState(target)).state).toEqual(state);
    expect((await readProjectState(legacy)).state).toEqual(state);
  });
});
