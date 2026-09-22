import { ArrowRight, FolderKanban, Loader2, Trash2 } from "./huge-icons";
import { useEffect, useMemo, useState } from "react";
import type { Board } from "../domain/model";
import type { MaybePromise } from "./types";
import { Dialog } from "./Dialog";

export interface DeleteBoardDialogProps {
  open: boolean;
  board?: Board;
  boards: Board[];
  onClose: () => void;
  onConfirm: (targetBoardId?: string) => MaybePromise<void>;
}

/** Confirmation flow that makes page migration explicit before board deletion. */
export function DeleteBoardDialog({ open, board, boards, onClose, onConfirm }: DeleteBoardDialogProps) {
  const destinations = useMemo(() => boards.filter((candidate) => candidate.id !== board?.id), [board?.id, boards]);
  const isLastBoard = boards.length <= 1;
  const [targetBoardId, setTargetBoardId] = useState(destinations[0]?.id ?? "");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTargetBoardId(destinations[0]?.id ?? "");
    setError(null);
    setWorking(false);
  }, [destinations, open]);

  const submit = async () => {
    if (isLastBoard) {
      setError("At least one board must remain.");
      return;
    }
    if (board && board.pageIds.length > 0 && !targetBoardId) {
      setError("Choose a destination board for the pages first.");
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await onConfirm(board?.pageIds.length ? targetBoardId : undefined);
      onClose();
    } finally {
      setWorking(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Delete board"
      description={isLastBoard ? "At least one board must remain." : board?.pageIds.length ? "Move the pages to another board, then remove this board." : "This board is empty and can be removed."}
      size="small"
      footer={<><button type="button" className="secondary-button" onClick={onClose} disabled={working}>Cancel</button><button type="button" className="danger-button" onClick={submit} disabled={working || !board || isLastBoard}>{working ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}Delete board</button></>}
    >
      {isLastBoard ? (
        <div className="confirm-content"><div className="confirm-content__icon"><Trash2 size={19} aria-hidden="true" /></div><p>This is the only board in the workspace. Create another board before deleting it.</p></div>
      ) : board?.pageIds.length ? (
        <div className="delete-board-flow">
          <div className="delete-board-flow__summary"><FolderKanban size={17} aria-hidden="true" /><span><strong>{board.pageIds.length} {board.pageIds.length === 1 ? "page" : "pages"}</strong> will be migrated.</span></div>
          <label className="field-label" htmlFor="delete-board-target">Destination board<span aria-hidden="true">*</span></label>
          <select id="delete-board-target" className="text-input" value={targetBoardId} onChange={(event) => setTargetBoardId(event.target.value)}>
            {destinations.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name} ({candidate.pageIds.length})</option>)}
          </select>
          <p className="field-meta"><span><ArrowRight size={12} aria-hidden="true" /> Pages keep their order.</span></p>
          {error ? <p className="form-error" role="alert">{error}</p> : null}
        </div>
      ) : <div className="confirm-content"><div className="confirm-content__icon"><Trash2 size={19} aria-hidden="true" /></div><p>Any pages already removed from this board stay deleted. This action cannot be undone.</p></div>}
    </Dialog>
  );
}
