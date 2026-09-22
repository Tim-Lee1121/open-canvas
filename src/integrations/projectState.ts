import { isAppState, type AppState } from "../domain/model";
import { createAppStore, type AppStore, type CreateStoreOptions } from "../state/hooks";

export const PROJECT_STATE_ENDPOINT = "/__codex_board__/state";
const DEFAULT_POLL_INTERVAL_MS = 800;

export interface ProjectStateSnapshot {
  state: AppState;
  revision: string;
}

export interface ProjectStoreSession {
  store: AppStore;
  projectBacked: boolean;
  dispose: () => void;
}

type Fetcher = typeof fetch;

function isSnapshot(value: unknown): value is ProjectStateSnapshot & { ok: true } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { ok?: unknown; state?: unknown; revision?: unknown };
  return candidate.ok === true && typeof candidate.revision === "string" && isAppState(candidate.state);
}

export async function fetchProjectState(fetcher: Fetcher = fetch): Promise<ProjectStateSnapshot | null> {
  const response = await fetcher(PROJECT_STATE_ENDPOINT, {
    method: "GET",
    cache: "no-store",
    headers: { Accept: "application/json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Project state request failed (${response.status})`);
  const body: unknown = await response.json();
  if (!isSnapshot(body)) throw new Error("Project state response is invalid");
  return { state: body.state, revision: body.revision };
}

export async function pushProjectState(
  state: AppState,
  fetcher: Fetcher = fetch,
): Promise<string> {
  const response = await fetcher(PROJECT_STATE_ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ state }),
  });
  if (!response.ok) throw new Error(`Project state save failed (${response.status})`);
  const body = await response.json() as { ok?: unknown; revision?: unknown };
  if (body.ok !== true || typeof body.revision !== "string") {
    throw new Error("Project state save response is invalid");
  }
  return body.revision;
}

export interface CreateProjectStoreOptions extends CreateStoreOptions {
  fetcher?: Fetcher;
  pollIntervalMs?: number;
  onProjectSyncError?: (error: unknown) => void;
}

export async function createProjectStoreSession(
  options: CreateProjectStoreOptions = {},
): Promise<ProjectStoreSession> {
  const fetcher = options.fetcher ?? fetch;
  let initial: ProjectStateSnapshot | null = null;
  try {
    initial = await fetchProjectState(fetcher);
  } catch (error) {
    options.onProjectSyncError?.(error);
  }

  const store = createAppStore({
    initialState: initial?.state ?? options.initialState,
    storage: options.storage,
    persist: options.persist,
    onPersistError: options.onPersistError,
  });
  if (!initial) return { store, projectBacked: false, dispose: () => undefined };

  let revision = initial.revision;
  let applyingProjectState = false;
  let dirty = false;
  let disposed = false;
  let saveInFlight = false;
  let refreshInFlight = false;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  const report = (error: unknown) => {
    try {
      options.onProjectSyncError?.(error);
    } catch {
      // Error reporting must not stop the synchronization loop.
    }
  };

  const flush = async () => {
    if (disposed || saveInFlight || !dirty) return;
    dirty = false;
    saveInFlight = true;
    const stateToSave = store.getState();
    try {
      revision = await pushProjectState(stateToSave, fetcher);
    } catch (error) {
      dirty = true;
      report(error);
    } finally {
      saveInFlight = false;
      if (dirty && !disposed) saveTimer = setTimeout(() => void flush(), 600);
    }
  };

  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void flush();
    }, 120);
  };

  const unsubscribe = store.subscribe(() => {
    if (applyingProjectState) return;
    dirty = true;
    scheduleSave();
  });

  const refresh = async () => {
    if (disposed || dirty || saveInFlight || refreshInFlight) return;
    refreshInFlight = true;
    try {
      const snapshot = await fetchProjectState(fetcher);
      // A local action may have happened while the GET was in flight. Let its
      // pending save finish instead of replacing it with the earlier response.
      if (snapshot && !dirty && !saveInFlight && snapshot.revision !== revision) {
        applyingProjectState = true;
        store.dispatch({ type: "RESET_STATE", payload: { state: snapshot.state } });
        applyingProjectState = false;
        revision = snapshot.revision;
      }
    } catch (error) {
      report(error);
    } finally {
      applyingProjectState = false;
      refreshInFlight = false;
    }
  };

  const pollTimer = setInterval(() => void refresh(), options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  const refreshOnFocus = () => void refresh();
  if (typeof window !== "undefined") {
    window.addEventListener("focus", refreshOnFocus);
    document.addEventListener("visibilitychange", refreshOnFocus);
  }

  return {
    store,
    projectBacked: true,
    dispose: () => {
      disposed = true;
      unsubscribe();
      clearInterval(pollTimer);
      if (saveTimer) clearTimeout(saveTimer);
      if (typeof window !== "undefined") {
        window.removeEventListener("focus", refreshOnFocus);
        document.removeEventListener("visibilitychange", refreshOnFocus);
      }
    },
  };
}
