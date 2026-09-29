import { BoardFile, Check, ChevronDown, Computer, MoreHorizontal, Moon, PanelLeftClose, Pencil, Plus, ProjectDocument, Sparkles, Sun, Trash2 } from "./huge-icons";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Board } from "../domain/model";
import type { BoardActionProps, PagesById } from "./types";
import { getFocusableElements } from "./focus";
import type { ThemeMode } from "../state/storage";

export interface SidebarProps extends BoardActionProps {
  boards: Board[];
  pagesById?: PagesById;
  activeBoardId?: string;
  workspaceView?: "canvas" | "design-system";
  onChangeWorkspaceView?: (view: "canvas" | "design-system") => void;
  projectName?: string;
  onProjectNameChange?: (name: string) => void;
  /** Whether the sidebar is rendered as the narrow-screen drawer. */
  isMobile?: boolean;
  isOpen?: boolean;
  isCollapsed?: boolean;
  onClose?: () => void;
  onDropPage?: (pageId: string, targetBoardId: string) => void;
  themeMode?: ThemeMode;
  onChangeThemeMode?: (mode: ThemeMode) => void;
}

export function Sidebar({
  boards,
  activeBoardId,
  workspaceView = "canvas",
  onChangeWorkspaceView,
  projectName = "Open Canvas",
  onProjectNameChange,
  isMobile = false,
  isOpen = false,
  isCollapsed = false,
  onClose,
  onSelectBoard,
  onCreateBoard,
  onRenameBoard,
  onDeleteBoard,
  onDropPage,
  themeMode = "light",
  onChangeThemeMode,
}: SidebarProps) {
  const activeBoard = boards.find((board) => board.id === activeBoardId);
  const [editingBoardId, setEditingBoardId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const cancelRenameOnBlur = useRef(false);
  const [editingProjectName, setEditingProjectName] = useState(false);
  const [projectNameDraft, setProjectNameDraft] = useState(projectName);
  const cancelProjectRenameOnBlur = useRef(false);
  const [dragOverBoardId, setDragOverBoardId] = useState<string | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  // Start closed so an initially-open mobile drawer receives focus as well as
  // drawers opened by a later state transition.
  const wasOpen = useRef(false);
  const isHidden = isMobile ? !isOpen : isCollapsed;
  const wasCollapsed = useRef(isCollapsed);

  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    if (isHidden) sidebar.setAttribute("inert", "");
    else sidebar.removeAttribute("inert");
  }, [isHidden]);

  useEffect(() => {
    if (isMobile && isOpen && !wasOpen.current) closeButtonRef.current?.focus();
    wasOpen.current = isOpen;
  }, [isMobile, isOpen]);

  useEffect(() => {
    if (!isMobile && wasCollapsed.current && !isCollapsed) closeButtonRef.current?.focus();
    wasCollapsed.current = isCollapsed;
  }, [isCollapsed, isMobile]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Element) || target.closest(".sidebar__theme-menu")) return;
      sidebarRef.current?.querySelectorAll(".sidebar__theme-menu[open]").forEach((menu) => menu.removeAttribute("open"));
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    if (!isMobile || !isOpen) return;
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // A modal opened from the drawer owns keyboard focus until it closes.
      // Avoid competing with its document-level trap while the drawer stays
      // mounted underneath the modal.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(sidebar);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !sidebar.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !sidebar.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isMobile, isOpen]);

  const startRename = (board: Board) => {
    cancelRenameOnBlur.current = false;
    setEditingBoardId(board.id);
    setEditingName(board.name);
  };
  const commitRename = (board: Board) => {
    if (cancelRenameOnBlur.current) {
      cancelRenameOnBlur.current = false;
      setEditingBoardId(null);
      return;
    }
    const nextName = editingName.trim();
    if (nextName && nextName !== board.name) onRenameBoard?.(board.id, nextName);
    setEditingBoardId(null);
  };
  const startProjectRename = () => {
    cancelProjectRenameOnBlur.current = false;
    setProjectNameDraft(projectName);
    setEditingProjectName(true);
  };
  const commitProjectRename = () => {
    if (cancelProjectRenameOnBlur.current) {
      cancelProjectRenameOnBlur.current = false;
      return;
    }
    const nextName = projectNameDraft.trim();
    if (nextName && nextName !== projectName) onProjectNameChange?.(nextName);
    setProjectNameDraft(nextName || projectName);
    setEditingProjectName(false);
  };
  const closeActionMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
  };
  const closeOpenMenus = () => {
    sidebarRef.current?.querySelectorAll("details[open]").forEach((details) => details.removeAttribute("open"));
  };
  const readPageId = (event: React.DragEvent) => event.dataTransfer.getData("application/x-ai-board-page") || event.dataTransfer.getData("text/plain");
  const themeLabel = themeMode === "system" ? "System" : themeMode === "dark" ? "Dark" : "Light";
  const ThemeIcon = themeMode === "system" ? Computer : themeMode === "dark" ? Moon : Sun;

  return (
    <aside id="boards-sidebar" ref={sidebarRef} className={`sidebar${isOpen ? " is-open" : ""}`} aria-label="Boards" aria-hidden={isHidden ? "true" : undefined}>
      <div className="sidebar__brand">
        <div className="brand-mark"><ProjectDocument size={32} aria-hidden="true" /></div>
        <div className="brand-copy">
          {editingProjectName ? (
            <input
              autoFocus
              className="sidebar__project-input"
              value={projectNameDraft}
              maxLength={80}
              onChange={(event) => setProjectNameDraft(event.target.value)}
              onBlur={commitProjectRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitProjectRename();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelProjectRenameOnBlur.current = true;
                  setProjectNameDraft(projectName);
                  setEditingProjectName(false);
                }
              }}
              aria-label="Project name"
            />
          ) : onProjectNameChange ? (
            <button type="button" className="sidebar__project-name" onClick={startProjectRename} aria-label="Rename project" title="Rename project">
              <span>{projectName}</span><Pencil size={14} aria-hidden="true" />
            </button>
          ) : <strong>{projectName}</strong>}
          <span className="sidebar__project-meta">{activeBoard ? `Last updated: ${formatUpdatedAt(activeBoard.updatedAt)}` : "Open Canvas"}</span>
        </div>
        <button ref={closeButtonRef} type="button" className="icon-button sidebar__collapse" onClick={onClose} aria-label={isMobile ? "Close boards" : "Collapse boards"} aria-controls="boards-sidebar" aria-expanded={!isHidden} title={isMobile ? "Close boards" : "Collapse boards"}><PanelLeftClose size={17} aria-hidden="true" /></button>
      </div>

      <div className="sidebar__view-toggle" data-layout={workspaceView} role="group" aria-label="Workspace">
        <button type="button" className={workspaceView === "canvas" ? "is-active" : ""} onClick={() => onChangeWorkspaceView?.("canvas")} aria-pressed={workspaceView === "canvas"}>Canvas</button>
        <button type="button" className={workspaceView === "design-system" ? "is-active" : ""} onClick={() => onChangeWorkspaceView?.("design-system")} aria-pressed={workspaceView === "design-system"}><Sparkles size={18} aria-hidden="true" /> Design System</button>
      </div>

      <div className="sidebar__section-heading">
        <span>Boards <small>{boards.length}</small></span>
        <button type="button" className="icon-button" onClick={() => onCreateBoard?.()} aria-label="Create board" title="Create board"><Plus size={17} aria-hidden="true" /></button>
      </div>

      <nav className="board-list">
        {boards.length === 0 ? <div className="sidebar__empty">No boards yet</div> : boards.map((board) => {
          // `pageIds` is the canonical ordered membership list. The map is
          // still accepted for preview lookups, but it must not make a valid
          // board appear empty while a caller is assembling state.
          const count = board.pageIds.length;
          const isActive = board.id === activeBoardId;
          const isEditing = editingBoardId === board.id;
          return (
            <div
              key={board.id}
              className={`board-item${isActive ? " is-active" : ""}${dragOverBoardId === board.id ? " is-drop-target" : ""}`}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDragOverBoardId(board.id); }}
              onDragLeave={() => setDragOverBoardId(null)}
              onDrop={(event) => {
                event.preventDefault();
                const pageId = readPageId(event);
                setDragOverBoardId(null);
                if (pageId) onDropPage?.(pageId, board.id);
              }}
            >
              {isEditing ? (
                <div className="board-item__edit-row">
                  <span className="board-item__icon"><BoardFile size={24} aria-hidden="true" /></span>
                  <input
                    autoFocus
                    className="board-item__input"
                    value={editingName}
                    maxLength={120}
                    onChange={(event) => setEditingName(event.target.value)}
                    onBlur={() => commitRename(board)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        event.stopPropagation();
                        commitRename(board);
                      }
                      if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelRenameOnBlur.current = true;
                        setEditingBoardId(null);
                      }
                    }}
                    onClick={(event) => event.stopPropagation()}
                    aria-label="Board name"
                  />
                </div>
              ) : (
                <button type="button" className="board-item__button" onClick={() => { closeOpenMenus(); onSelectBoard?.(board.id); }} aria-current={isActive ? "page" : undefined}>
                  <span className="board-item__icon"><BoardFile size={24} aria-hidden="true" /></span>
                  <span className="board-item__name">{board.name}</span>
                  <span className="board-item__count">{count}</span>
                </button>
              )}
              <details className="action-menu board-item__menu">
                <summary className="icon-button" aria-label={`Actions for ${board.name}`} title="Board actions"><MoreHorizontal size={16} aria-hidden="true" /></summary>
                <div className="action-menu__panel" role="menu">
                  <button type="button" role="menuitem" onClick={(event) => { closeActionMenu(event); startRename(board); }}><Pencil size={14} aria-hidden="true" /> Rename</button>
                  <button type="button" role="menuitem" className="danger-action" onClick={(event) => { closeActionMenu(event); onDeleteBoard?.(board.id); }}><Trash2 size={14} aria-hidden="true" /> Delete</button>
                </div>
              </details>
              {isActive ? <span className="board-item__active-mark"><Check size={13} aria-hidden="true" /></span> : null}
            </div>
          );
        })}
      </nav>

      <div className="sidebar__settings">
        <details className="action-menu sidebar__theme-menu">
          <summary className="sidebar__settings-trigger"><ThemeIcon size={17} aria-hidden="true" /><span>Appearance</span><span className="sidebar__theme-current">{themeLabel}</span><ChevronDown size={14} aria-hidden="true" /></summary>
          <div className="action-menu__panel" role="menu" aria-label="Appearance theme">
            <button type="button" role="menuitemradio" aria-checked={themeMode === "light"} className={themeMode === "light" ? "is-active" : ""} onClick={(event) => { onChangeThemeMode?.("light"); closeActionMenu(event); }}><Sun size={15} aria-hidden="true" /> Light</button>
            <button type="button" role="menuitemradio" aria-checked={themeMode === "dark"} className={themeMode === "dark" ? "is-active" : ""} onClick={(event) => { onChangeThemeMode?.("dark"); closeActionMenu(event); }}><Moon size={15} aria-hidden="true" /> Dark</button>
            <button type="button" role="menuitemradio" aria-checked={themeMode === "system"} className={themeMode === "system" ? "is-active" : ""} onClick={(event) => { onChangeThemeMode?.("system"); closeActionMenu(event); }}><Computer size={15} aria-hidden="true" /> Follow system</button>
          </div>
        </details>
      </div>

    </aside>
  );
}

function formatUpdatedAt(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "just now";
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(timestamp);
}
