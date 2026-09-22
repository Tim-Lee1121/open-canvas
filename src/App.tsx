import { AlertCircle, CheckCircle2, Menu, PanelLeftClose, X } from "./components/huge-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppAction } from "./state/reducer";
import { getActiveBoard, getActivePages } from "./state/reducer";
import { useAppState, type AppStore } from "./state/hooks";
import {
  BoardDialog,
  CanvasView,
  ConfirmDialog,
  DeleteBoardDialog,
  GridView,
  MovePageDialog,
  PageDialog,
  Sidebar,
} from "./components";
import { installAnnotationModeMarker } from "./components/annotationMode";
import { installAnnotationInteraction } from "./components/annotationInteraction";
import { registerWebMcpTools, type WebMcpRegistration } from "./integrations/webmcp";
import { loadProjectName, saveProjectName } from "./state/storage";
import { copyPageToFigmaClipboard, FigmaExportError } from "./components/figmaClipboard";
import type { DeviceFrame } from "./components/device-presets";

type ModalState =
  | { type: "page"; pageId: string }
  | { type: "board"; boardId: string | null }
  | { type: "delete-page"; pageId: string }
  | { type: "delete-board"; boardId: string }
  | { type: "move-page"; pageId: string }
  | null;

const browserToolsEnabled = import.meta.env.VITE_ENABLE_BROWSER_TOOLS === "true";

/**
 * UI actions, the project-file bridge, and optional WebMCP commands share the
 * same store. In normal Codex desktop use the store is created by main.tsx
 * from the local Board state outside the project; direct component mounts retain localStorage as a
 * browser-only fallback.
 */
export interface AppProps {
  store?: AppStore;
}

export default function App({ store: providedStore }: AppProps = {}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [figmaPairingCode, setFigmaPairingCode] = useState<string | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const announce = useCallback((message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3600);
  }, []);

  const { state, dispatch, store } = useAppState({
    store: providedStore,
    onPersistError: () => announce("Changes could not be saved locally. Check browser storage permissions."),
  });
  const activeBoard = getActiveBoard(state) ?? state.boards[0];
  const activePages = activeBoard ? getActivePages({ ...state, activeBoardId: activeBoard.id }) : [];
  const [modal, setModal] = useState<ModalState>(null);
  const [projectName, setProjectName] = useState(() => loadProjectName());
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(() => (
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia("(max-width: 680px)").matches
      : false
  ));
  const mobileSidebarTriggerRef = useRef<HTMLButtonElement>(null);
  const sidebarExpandRef = useRef<HTMLButtonElement>(null);
  const wasSidebarOpen = useRef(false);
  const isSidebarCollapsed = !isMobileViewport && sidebarCollapsed;

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  // Dia mounts its browser-comments host outside the React tree. Mirror its
  // active picker state onto <html> so the inline preview can temporarily
  // remove board chrome from hit-testing while Annotation mode samples a
  // point. The bridge is inert in browsers without MutationObserver.
  useEffect(() => {
    const disposeMarker = installAnnotationModeMarker();
    const disposeInteraction = installAnnotationInteraction();
    return () => {
      disposeInteraction();
      disposeMarker();
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(max-width: 680px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);
    updateViewport();
    mediaQuery.addEventListener?.("change", updateViewport);
    return () => mediaQuery.removeEventListener?.("change", updateViewport);
  }, []);

  useEffect(() => {
    if (isMobileViewport && wasSidebarOpen.current && !sidebarOpen) {
      mobileSidebarTriggerRef.current?.focus();
    }
    wasSidebarOpen.current = sidebarOpen;
  }, [isMobileViewport, sidebarOpen]);

  useEffect(() => {
    if (isSidebarCollapsed) sidebarExpandRef.current?.focus();
  }, [isSidebarCollapsed]);

  useEffect(() => {
    // The repository Skill + CLI is the default generation path. Browser Site
    // tools are opt-in so an open preview cannot accidentally become the
    // execution environment for generated source files.
    if (!browserToolsEnabled) return;
    let effectActive = true;
    let registration: WebMcpRegistration | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryCount = 0;
    const maxRetries = 6;
    const runtime = {
      getState: store.getState,
      dispatch: (action: AppAction) => store.dispatch(action),
    };
    const onError = (error: unknown, toolName: string, phase: "register" | "unregister") => {
      // Keep the experimental integration non-blocking. StrictMode can invoke
      // effect cleanup during development, so cleanup failures are diagnostic
      // noise rather than a registration outage.
      if (phase === "unregister") {
        console.debug(`[WebMCP] ${toolName} cleanup failed`, error);
      } else {
        console.warn(`[WebMCP] ${toolName} registration failed`, error);
      }
    };
    const register = () => {
      if (!effectActive) return;
      registration = registerWebMcpTools<AppAction>(runtime, {
        onError,
      });
      const retrying = !registration.supported && retryCount < maxRetries;
      if (retrying) {
        const delay = Math.min(8_000, 250 * (2 ** retryCount));
        retryCount += 1;
        retryTimer = setTimeout(register, delay);
      }
    };
    const retryIfUnavailable = () => {
      if (!effectActive || registration?.supported) return;
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = null;
      register();
    };
    register();
    window.addEventListener("focus", retryIfUnavailable);
    document.addEventListener("visibilitychange", retryIfUnavailable);
    return () => {
      effectActive = false;
      if (retryTimer) clearTimeout(retryTimer);
      window.removeEventListener("focus", retryIfUnavailable);
      document.removeEventListener("visibilitychange", retryIfUnavailable);
      registration?.unregister();
    };
  }, [store]);

  const boardById = useMemo(() => new Map(state.boards.map((board) => [board.id, board])), [state.boards]);
  const pageById = state.pagesById;

  const selectBoard = (boardId: string) => {
    dispatch({ type: "SELECT_BOARD", payload: { boardId } });
    setSidebarOpen(false);
  };

  const selectPage = (pageId: string) => dispatch({ type: "SELECT_PAGE", payload: { pageId } });
  const clearSelection = () => dispatch({ type: "SELECT_PAGE", payload: { pageId: null } });

  const requestDeleteBoard = (boardId: string) => {
    if (state.boards.length <= 1) {
      announce("At least one board must remain.");
      return;
    }
    setModal({ type: "delete-board", boardId });
  };
  const requestDeletePage = (pageId: string) => setModal({ type: "delete-page", pageId });
  const movePage = (pageId: string, targetBoardId?: string) => {
    if (targetBoardId) {
      const page = pageById[pageId];
      dispatch({ type: "MOVE_PAGE", payload: { pageId, targetBoardId } });
      if (page) announce(`Moved “${page.title}” to ${boardById.get(targetBoardId)?.name ?? "the selected board"}.`);
      return;
    }
    setModal({ type: "move-page", pageId });
  };

  const copyPageToFigma = async (page: (typeof activePages)[number], deviceFrame?: DeviceFrame) => {
    setFigmaPairingCode(null);
    announce(`Preparing Figma-compatible export for “${page.title}”…`);
    try {
      const pairingCode = await copyPageToFigmaClipboard(page, deviceFrame);
      setFigmaPairingCode(pairingCode ?? null);
      announce(pairingCode
        ? `Generated Figma-compatible editable layers for “${page.title}”. Paste in a compatible Figma Desktop workflow, or enter the pairing code in Open Canvas Importer.`
        : `Generated Figma-compatible editable layers for “${page.title}”. Paste in a compatible Figma Desktop workflow.`);
    } catch (error) {
      if (error instanceof FigmaExportError && error.code === "url-source") {
        announce("URL pages require Figma's official Capture page flow.");
      } else if (error instanceof FigmaExportError && error.code === "clipboard-unavailable") {
        announce("Rich clipboard access is unavailable. Allow clipboard access and try again.");
      } else if (error instanceof FigmaExportError && error.code === "capture-failed") {
        announce(`Figma export could not capture this HTML page: ${error.message}`);
      } else {
        announce("Figma export failed while preparing the page. Try again.");
      }
    }
  };

  const boardToDelete = modal?.type === "delete-board" ? boardById.get(modal.boardId) : undefined;
  const pageToDelete = modal?.type === "delete-page" ? pageById[modal.pageId] : undefined;
  const pageToMove = modal?.type === "move-page" ? pageById[modal.pageId] : undefined;
  const editingPage = modal?.type === "page" ? pageById[modal.pageId] : undefined;
  const editingBoard = modal?.type === "board" && modal.boardId ? boardById.get(modal.boardId) : undefined;

  return (
    <div className={`app-shell${activeBoard?.layoutMode === "canvas" ? " app-shell--canvas" : ""}${isSidebarCollapsed ? " app-shell--sidebar-collapsed" : ""}`}>
      <Sidebar
        boards={state.boards}
        pagesById={pageById}
        activeBoardId={activeBoard?.id}
        layoutMode={activeBoard?.layoutMode}
        projectName={projectName}
        onProjectNameChange={(name) => {
          setProjectName(name);
          if (!saveProjectName(name)) announce("The project name could not be saved locally.");
        }}
        isMobile={isMobileViewport}
        isOpen={sidebarOpen}
        isCollapsed={isSidebarCollapsed}
        onClose={() => isMobileViewport ? setSidebarOpen(false) : setSidebarCollapsed(true)}
        onSelectBoard={selectBoard}
        onCreateBoard={() => setModal({ type: "board", boardId: null })}
        onRenameBoard={(boardId, name) => { dispatch({ type: "RENAME_BOARD", payload: { boardId, name } }); }}
        onDeleteBoard={requestDeleteBoard}
        onDropPage={(pageId, targetBoardId) => {
          const page = pageById[pageId];
          if (!page || page.boardId === targetBoardId) return;
          dispatch({ type: "MOVE_PAGE", payload: { pageId, targetBoardId } });
          announce(`Moved “${page.title}” to ${boardById.get(targetBoardId)?.name ?? "the selected board"}.`);
        }}
        onChangeLayout={(layoutMode) => activeBoard && dispatch({ type: "SET_LAYOUT_MODE", payload: { boardId: activeBoard.id, layoutMode } })}
      />

      {isSidebarCollapsed ? (
        <button ref={sidebarExpandRef} type="button" className="icon-button sidebar-expand" onClick={() => setSidebarCollapsed(false)} aria-label="Expand boards" aria-controls="boards-sidebar" aria-expanded="false" title="Expand boards">
          <PanelLeftClose size={24} aria-hidden="true" />
        </button>
      ) : null}

      <main className={`main-panel${activeBoard?.layoutMode === "canvas" ? " main-panel--canvas" : ""}`}>
        <div className="mobile-topbar">
          <button ref={mobileSidebarTriggerRef} type="button" className="icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open boards" aria-controls="boards-sidebar" aria-expanded={sidebarOpen} title="Open boards"><Menu size={19} aria-hidden="true" /></button>
          <span>Open Canvas</span>
        </div>
        <div className="main-content">
          <div key={`${activeBoard?.id}:${activeBoard?.layoutMode}`} className="main-content__inner board-view-enter">
            {activeBoard ? (
              activeBoard.layoutMode === "canvas" ? (
                <CanvasView
                  pages={activePages}
                  tags={activeBoard.tags ?? []}
                  boards={state.boards}
                  activeBoardId={activeBoard.id}
                  selectedPageId={state.selectedPageId}
                  layoutInsetKey={isSidebarCollapsed}
                  onSelectPage={selectPage}
                  onClearSelection={clearSelection}
                  onEditPage={(page) => setModal({ type: "page", pageId: page.id })}
                  onDeletePage={requestDeletePage}
                  onMovePage={movePage}
                  onCopyPageToFigma={copyPageToFigma}
                  onUpdateCanvasPosition={(pageId, position) => dispatch({ type: "UPDATE_CANVAS_POSITION", payload: { pageId, position } })}
                  onCreateTag={(position) => {
                    if (!activeBoard) return;
                    const before = new Set((activeBoard.tags ?? []).map((tag) => tag.id));
                    const next = dispatch({ type: "CREATE_TAG", payload: { boardId: activeBoard.id, canvasPosition: position } });
                    return (next.boards.find((board) => board.id === activeBoard.id)?.tags ?? []).find((tag) => !before.has(tag.id))?.id;
                  }}
                  onUpdateTag={(tagId, changes) => dispatch({ type: "UPDATE_TAG", payload: { tagId, changes } })}
                  onMoveTag={(tagId, boardId) => dispatch({ type: "MOVE_TAG", payload: { tagId, targetBoardId: boardId } })}
                  onDeleteTag={(tagId) => dispatch({ type: "DELETE_TAG", payload: { tagId } })}
                  onCopyTag={() => announce("Tag text copied.")}
                />
              ) : (
                <GridView
                  pages={activePages}
                  boards={state.boards}
                  activeBoardId={activeBoard.id}
                  selectedPageId={state.selectedPageId}
                  onSelectPage={selectPage}
                  onClearSelection={clearSelection}
                  onEditPage={(page) => setModal({ type: "page", pageId: page.id })}
                  onDeletePage={requestDeletePage}
                  onMovePage={movePage}
                  onReorderPage={(pageId, targetIndex) => dispatch({ type: "MOVE_PAGE", payload: { pageId, targetBoardId: activeBoard.id, targetIndex } })}
                />
              )
            ) : (
              <div className="empty-state"><AlertCircle size={24} aria-hidden="true" /><h2>No boards yet</h2><p>Create a board to start collecting generated mobile interfaces.</p><button type="button" className="primary-button" onClick={() => setModal({ type: "board", boardId: null })}>Create board</button></div>
            )}
          </div>
        </div>
      </main>

      {sidebarOpen ? <button type="button" className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close boards" /> : null}

      {figmaPairingCode ? <div className="figma-pairing" role="status"><span>Figma plugin pairing code (valid for 5 minutes, one use)</span><code>{figmaPairingCode}</code><button type="button" className="icon-button" onClick={() => setFigmaPairingCode(null)} aria-label="Dismiss pairing code" title="Dismiss pairing code"><X size={15} aria-hidden="true" /></button></div> : null}
      {notice ? <div className="toast" role="status"><CheckCircle2 size={16} strokeWidth={2} aria-hidden="true" /><span>{notice}</span><button type="button" className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss notification" title="Dismiss"><X size={15} strokeWidth={2} aria-hidden="true" /></button></div> : null}

      <BoardDialog
        open={modal?.type === "board"}
        board={editingBoard}
        onClose={() => setModal(null)}
        onSubmit={({ name }) => {
          if (editingBoard) dispatch({ type: "RENAME_BOARD", payload: { boardId: editingBoard.id, name } });
          else dispatch({ type: "CREATE_BOARD", payload: { board: { name }, activate: true } });
        }}
      />
      <PageDialog
        open={modal?.type === "page"}
        page={editingPage}
        onClose={() => setModal(null)}
        onSubmit={({ title, source }) => {
          if (editingPage) {
            dispatch({ type: "UPDATE_PAGE", payload: { pageId: editingPage.id, changes: { title, source } } });
          }
        }}
      />
      <ConfirmDialog
        open={Boolean(pageToDelete)}
        title="Delete page?"
        description={pageToDelete ? `“${pageToDelete.title}” will be removed from this board. This cannot be undone.` : "This page will be removed."}
        confirmLabel="Delete page"
        onClose={() => setModal(null)}
        onConfirm={() => {
          if (pageToDelete) {
            dispatch({ type: "DELETE_PAGE", payload: { pageId: pageToDelete.id } });
            announce("Page deleted.");
          }
        }}
      />
      <DeleteBoardDialog
        open={Boolean(boardToDelete)}
        board={boardToDelete}
        boards={state.boards}
        onClose={() => setModal(null)}
        onConfirm={(targetBoardId) => {
          if (boardToDelete) {
            dispatch({ type: "DELETE_BOARD", payload: { boardId: boardToDelete.id, targetBoardId } });
            announce(boardToDelete.pageIds.length ? "Board deleted and pages migrated." : "Board deleted.");
          }
        }}
      />
      <MovePageDialog
        open={Boolean(pageToMove)}
        page={pageToMove}
        boards={state.boards}
        onClose={() => setModal(null)}
        onMove={(targetBoardId) => {
          if (pageToMove) {
            dispatch({ type: "MOVE_PAGE", payload: { pageId: pageToMove.id, targetBoardId } });
            announce(`Moved “${pageToMove.title}”.`);
          }
        }}
      />
    </div>
  );
}
