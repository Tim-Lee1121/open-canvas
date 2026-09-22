import { LayoutGrid, MoreHorizontal, Pencil, Scan, Trash2 } from "./huge-icons";
import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Board } from "../domain/model";
import type { BoardActionProps, LayoutModeControlProps } from "./types";

export interface BoardHeaderProps extends BoardActionProps, LayoutModeControlProps {
  board?: Board;
  pageCount: number;
  webmcpAvailable?: boolean;
}

export function BoardHeader({
  board,
  pageCount,
  mode,
  onChange,
  onRenameBoard,
  onDeleteBoard,
  webmcpAvailable,
}: BoardHeaderProps) {
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(board?.name ?? "");
  const cancelRenameOnBlur = useRef(false);
  useEffect(() => {
    setName(board?.name ?? "");
    setRenaming(false);
    cancelRenameOnBlur.current = false;
  }, [board?.id, board?.name]);
  const commitRename = () => {
    if (cancelRenameOnBlur.current) {
      cancelRenameOnBlur.current = false;
      setRenaming(false);
      return;
    }
    if (board && name.trim() && name.trim() !== board.name) onRenameBoard?.(board.id, name.trim());
    setRenaming(false);
  };
  const closeActionMenu = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest("details")?.removeAttribute("open");
  };

  if (!board) {
    return <header className="board-header board-header--empty"><div><span className="eyebrow">Your workspace</span><h1>Select a board</h1></div></header>;
  }

  return (
    <header className="board-header" data-layout-mode={mode}>
      <div className="board-header__identity">
        <span className="eyebrow">Workspace / Board</span>
        {renaming ? (
          <input
            autoFocus
            className="board-header__rename"
            value={name}
            maxLength={120}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.stopPropagation();
                commitRename();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                cancelRenameOnBlur.current = true;
                setRenaming(false);
              }
            }}
            aria-label="Board name"
          />
        ) : (
          <h1>{board.name}<button type="button" className="icon-button board-header__edit" onClick={() => { cancelRenameOnBlur.current = false; setName(board.name); setRenaming(true); }} aria-label="Rename board" title="Rename board"><Pencil size={14} aria-hidden="true" /></button></h1>
        )}
        <span className="board-header__meta">{pageCount} {pageCount === 1 ? "page" : "pages"}<span className="meta-divider" />Updated {formatUpdatedAt(board.updatedAt)}</span>
      </div>

      <div className="board-header__actions" aria-label="Board controls">
        <div className="view-toggle board-header__view-toggle" role="group" aria-label="View mode">
          <button type="button" className={mode === "grid" ? "is-active" : ""} onClick={() => onChange("grid")} aria-pressed={mode === "grid"}><LayoutGrid size={15} aria-hidden="true" /> Grid</button>
          <button type="button" className={mode === "canvas" ? "is-active" : ""} onClick={() => onChange("canvas")} aria-pressed={mode === "canvas"}><Scan size={15} aria-hidden="true" /> Canvas</button>
        </div>
        <details className="action-menu board-header__menu">
          <summary className="icon-button" aria-label="Board actions" title="Board actions"><MoreHorizontal size={18} aria-hidden="true" /></summary>
          <div className="action-menu__panel" role="menu">
            <button type="button" role="menuitem" onClick={(event) => { closeActionMenu(event); setName(board.name); setRenaming(true); }}><Pencil size={14} aria-hidden="true" /> Rename board</button>
            <button type="button" role="menuitem" className="danger-action" onClick={(event) => { closeActionMenu(event); onDeleteBoard?.(board.id); }}><Trash2 size={14} aria-hidden="true" /> Delete board</button>
          </div>
        </details>
      </div>
      {webmcpAvailable === false ? <div className="board-header__notice" role="status">Codex tools are unavailable in this browser. Existing pages can still be edited.</div> : null}
    </header>
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
