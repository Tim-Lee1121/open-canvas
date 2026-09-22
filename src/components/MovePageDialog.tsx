import { ArrowRight, Check, MoveRight } from "./huge-icons";
import { useEffect, useMemo, useState } from "react";
import type { Board, Page } from "../domain/model";
import type { MaybePromise } from "./types";
import { Dialog } from "./Dialog";

export interface MovePageDialogProps {
  open: boolean;
  page?: Page | null;
  boards: Board[];
  onClose: () => void;
  onMove: (targetBoardId: string) => MaybePromise<void>;
}

export function MovePageDialog({ open, page, boards, onClose, onMove }: MovePageDialogProps) {
  const available = useMemo(() => boards.filter((board) => board.id !== page?.boardId), [boards, page?.boardId]);
  const availableBoardIds = available.map((board) => board.id).join(",");
  const [targetId, setTargetId] = useState(available[0]?.id ?? "");
  const [working, setWorking] = useState(false);
  useEffect(() => { if (open) { setTargetId(available[0]?.id ?? ""); setWorking(false); } }, [availableBoardIds, available, open, page?.id]);
  const submit = async () => { if (!targetId) return; setWorking(true); try { await onMove(targetId); onClose(); } finally { setWorking(false); } };
  return <Dialog open={open} onClose={onClose} title="Move page" description={page ? `Choose a destination for “${page.title}”.` : undefined} size="small" footer={<><button type="button" className="secondary-button" onClick={onClose} disabled={working}>Cancel</button><button type="button" className="primary-button" onClick={submit} disabled={!targetId || working}><ArrowRight size={16} aria-hidden="true" /> Move page</button></>}>
    {available.length === 0 ? <div className="empty-inline"><MoveRight size={18} aria-hidden="true" /><p>Create another board before moving this page.</p></div> : <div className="board-choice-list" role="radiogroup" aria-label="Destination board">{available.map((board) => <button type="button" key={board.id} className={`board-choice${targetId === board.id ? " is-selected" : ""}`} onClick={() => setTargetId(board.id)} role="radio" aria-checked={targetId === board.id}><span className="board-choice__icon"><MoveRight size={15} aria-hidden="true" /></span><span><strong>{board.name}</strong><small>{board.pageIds.length} {board.pageIds.length === 1 ? "page" : "pages"}</small></span>{targetId === board.id ? <Check size={16} aria-hidden="true" /> : null}</button>)}</div>}
  </Dialog>;
}
