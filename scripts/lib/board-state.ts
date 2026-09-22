import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { createInitialState, isAppState, type AppState } from "../../src/domain/model";

export const PROJECT_STATE_RELATIVE_PATH = "data/board-state.json";

export function resolveProjectStatePath(root = process.cwd()): string {
  const projectRoot = resolve(root);
  const projectId = createHash("sha256").update(projectRoot).digest("hex").slice(0, 12);
  return resolve(projectRoot, "..", ".open-canvas-data", `${basename(projectRoot)}-${projectId}`, "board-state.json");
}

export function resolveLegacyProjectStatePath(root = process.cwd()): string {
  return resolve(root, PROJECT_STATE_RELATIVE_PATH);
}

export function serializeProjectState(state: AppState): string {
  if (!isAppState(state)) throw new Error("Refusing to write an invalid board state");
  return `${JSON.stringify(state, null, 2)}\n`;
}

export function createProjectStateRevision(serialized: string): string {
  return createHash("sha256").update(serialized).digest("hex");
}

export interface ProjectStateSnapshot {
  state: AppState;
  revision: string;
}

export async function readProjectState(
  filePath = resolveProjectStatePath(),
  legacyFilePath?: string,
): Promise<ProjectStateSnapshot> {
  let serialized: string;
  try {
    serialized = await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (legacyFilePath) {
      try {
        serialized = await readFile(legacyFilePath, "utf8");
      } catch (legacyError) {
        if ((legacyError as NodeJS.ErrnoException).code !== "ENOENT") throw legacyError;
        const state = createInitialState();
        serialized = serializeProjectState(state);
        return { state, revision: createProjectStateRevision(serialized) };
      }
    } else {
      const state = createInitialState();
      serialized = serializeProjectState(state);
      return { state, revision: createProjectStateRevision(serialized) };
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(`Board state is not valid JSON: ${filePath}`);
  }
  if (!isAppState(parsed)) {
    throw new Error(`Board state does not match schema version 1: ${filePath}`);
  }
  return { state: parsed, revision: createProjectStateRevision(serialized) };
}

export async function writeProjectState(
  state: AppState,
  filePath = resolveProjectStatePath(),
): Promise<ProjectStateSnapshot> {
  const serialized = serializeProjectState(state);
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, serialized, { encoding: "utf8", mode: 0o600 });
  await rename(temporaryPath, filePath);
  return { state, revision: createProjectStateRevision(serialized) };
}
