import { AlertTriangle, Loader2, Trash2 } from "./huge-icons";
import { useState } from "react";
import type { MaybePromise } from "./types";
import { Dialog } from "./Dialog";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
  onClose: () => void;
  onConfirm: () => MaybePromise<void>;
}

export function ConfirmDialog({ open, title, description, confirmLabel = "Confirm", destructive = true, onClose, onConfirm }: ConfirmDialogProps) {
  const [working, setWorking] = useState(false);
  const confirm = async () => {
    setWorking(true);
    try { await onConfirm(); onClose(); } finally { setWorking(false); }
  };
  return <Dialog open={open} onClose={onClose} title={title} size="small" footer={<><button type="button" className="secondary-button" onClick={onClose} disabled={working}>Cancel</button><button type="button" className={destructive ? "danger-button" : "primary-button"} onClick={confirm} disabled={working}>{working ? <Loader2 size={16} className="spin" aria-hidden="true" /> : destructive ? <Trash2 size={16} aria-hidden="true" /> : null}{confirmLabel}</button></>}><div className="confirm-content"><div className="confirm-content__icon"><AlertTriangle size={21} aria-hidden="true" /></div><p>{description}</p></div></Dialog>;
}
