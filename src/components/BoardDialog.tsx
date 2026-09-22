import { FolderPlus, Loader2, Save } from "./huge-icons";
import { useEffect, useState } from "react";
import { validateBoardName } from "../domain/model";
import type { Board } from "../domain/model";
import type { BoardFormValues, MaybePromise } from "./types";
import { Dialog } from "./Dialog";

export interface BoardDialogProps {
  open: boolean;
  board?: Board | null;
  onClose: () => void;
  onSubmit: (values: BoardFormValues) => MaybePromise<void>;
}

export function BoardDialog({ open, board, onClose, onSubmit }: BoardDialogProps) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    setName(board?.name ?? "");
    setError(null);
    setSaving(false);
  }, [board, open]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const validationError = validateBoardName(name);
    if (validationError) { setError(validationError); return; }
    setSaving(true);
    try { await onSubmit({ name: name.trim() }); onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save board"); } finally { setSaving(false); }
  };
  return <Dialog open={open} onClose={onClose} title={board ? "Rename board" : "New board"} description={board ? "Choose a clear name for this collection." : "Create a space for a new set of generated pages."} size="small" footer={<><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" form="board-dialog-form" className="primary-button" disabled={saving}>{saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : board ? <Save size={16} aria-hidden="true" /> : <FolderPlus size={16} aria-hidden="true" />}{board ? "Save name" : "Create board"}</button></>}><form id="board-dialog-form" className="form-stack" onSubmit={submit}><label className="field-label" htmlFor="board-name">Board name<span aria-hidden="true">*</span></label><input id="board-name" className="text-input" value={name} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="e.g. Q4 onboarding" autoFocus />{error ? <p className="form-error" role="alert">{error}</p> : null}</form></Dialog>;
}
