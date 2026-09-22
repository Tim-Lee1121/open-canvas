import { useRef, useSyncExternalStore } from "react";
import type { AppState } from "../domain/model";
import { appReducer, type AppAction } from "./reducer";
import { loadState, trySaveState, type StorageLike } from "./storage";

export interface AppStore {
  getState: () => AppState;
  dispatch: (action: AppAction) => AppState;
  subscribe: (listener: () => void) => () => void;
}

export interface CreateStoreOptions {
  initialState?: AppState;
  storage?: StorageLike | null;
  persist?: boolean;
  /** Called when a state transition could not be persisted. */
  onPersistError?: (error: unknown) => void;
}

/**
 * Small external store adapter. It makes the same reducer usable by React and
 * by WebMCP, whose tool callbacks are not React components.
 */
export function createAppStore(options: CreateStoreOptions = {}): AppStore {
  let state = options.initialState ?? loadState(options.storage);
  const shouldPersist = options.persist !== false;
  const listeners = new Set<() => void>();

  const store: AppStore = {
    getState: () => state,
    dispatch: (action) => {
      const next = appReducer(state, action);
      if (next !== state) {
        state = next;
        if (shouldPersist) {
          const result = trySaveState(state, options.storage);
          if (!result.ok) options.onPersistError?.(result.error);
        }
        listeners.forEach((listener) => listener());
      }
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return store;
}

export interface UseAppStateOptions extends CreateStoreOptions {
  /** Optional externally-created store, useful when several views share it. */
  store?: AppStore;
}

export interface UseAppStateResult {
  state: AppState;
  dispatch: AppStore["dispatch"];
  store: AppStore;
}

/** React hook backed by `useSyncExternalStore` for concurrent rendering. */
export function useAppState(options: UseAppStateOptions = {}): UseAppStateResult {
  const storeRef = useRef<AppStore | null>(options.store ?? null);
  if (!storeRef.current) storeRef.current = createAppStore(options);
  const store = storeRef.current;
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return { state, dispatch: store.dispatch, store };
}

// Alias for callers that use the product terminology.
export const useBoardState = useAppState;
