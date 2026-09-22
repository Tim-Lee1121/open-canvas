import { X } from "./huge-icons";
import { useEffect, useId, useRef, useState, type FormEvent, type MouseEvent, type ReactNode } from "react";
import { getFocusableElements } from "./focus";

export const DIALOG_EXIT_MS = 240;

export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: "small" | "medium" | "large";
}

interface DialogFrame {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size: NonNullable<DialogProps["size"]>;
}

export function Dialog({ open, title, description, onClose, children, footer, size = "medium" }: DialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const lastOutsideFocusRef = useRef<HTMLElement | null>(null);
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [present, setPresent] = useState(open);
  const titleId = useId();
  const descriptionId = useId();
  const rendered = open || present;
  const closing = rendered && !open;
  const interactiveRef = useRef(open);
  const lastOpenFrameRef = useRef<DialogFrame>({ title, description, children, footer, size });
  if (open) lastOpenFrameRef.current = { title, description, children, footer, size };
  const frame = closing ? lastOpenFrameRef.current : { title, description, children, footer, size };
  onCloseRef.current = onClose;
  interactiveRef.current = open;

  useEffect(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;

    const reduceMotion = typeof window.matchMedia === "function"
      && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      setPresent(false);
      return;
    }
    exitTimerRef.current = setTimeout(() => {
      setPresent(false);
      exitTimerRef.current = null;
    }, DIALOG_EXIT_MS);
    return () => {
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    };
  }, [open, present]);

  // Capture the opener while this instance is closed. This runs before a
  // form's autoFocus can move focus into the newly mounted dialog.
  useEffect(() => {
    if (rendered) return;
    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return;
      // During the commit that mounts this dialog, autoFocus can fire before
      // the ref callback is observable to the passive effect. The ancestry
      // check still recognizes that target as dialog-internal in that window.
      const isInsideDialog = dialogRef.current?.contains(event.target) ||
        event.target.closest('[role="dialog"][aria-modal="true"]');
      if (!isInsideDialog) lastOutsideFocusRef.current = event.target;
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, [rendered]);

  useEffect(() => {
    if (!rendered) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousActiveElement = lastOutsideFocusRef.current ?? (
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    );

    // Child forms may declare autoFocus. Leave that focus in place; otherwise
    // put focus into the dialog even for confirmation-only surfaces.
    if (!dialog.contains(document.activeElement)) {
      getFocusableElements(dialog)[0]?.focus();
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!interactiveRef.current) {
        if (event.key === "Escape" || event.key === "Tab") event.preventDefault();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousActiveElement && previousActiveElement.isConnected) previousActiveElement.focus();
    };
  }, [rendered]);

  const requestClose = () => {
    if (!interactiveRef.current) return;
    onCloseRef.current();
  };
  const blockClosingInteraction = (event: MouseEvent<HTMLDivElement> | FormEvent<HTMLDivElement>) => {
    if (!closing) return;
    event.preventDefault();
    event.stopPropagation();
  };

  if (!rendered) return null;
  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      data-state={closing ? "closing" : "open"}
      onClickCapture={blockClosingInteraction}
      onSubmitCapture={blockClosingInteraction}
      onMouseDown={(event) => { if (event.target === event.currentTarget) requestClose(); }}
    >
      <section ref={dialogRef} className={`dialog dialog--${frame.size}`} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby={titleId} aria-describedby={frame.description ? descriptionId : undefined}>
        <header className="dialog__header">
          <div><h2 id={titleId}>{frame.title}</h2>{frame.description ? <p id={descriptionId}>{frame.description}</p> : null}</div>
          <button type="button" className="icon-button" onClick={requestClose} aria-label="Close dialog" title="Close"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="dialog__body">{frame.children}</div>
        {frame.footer ? <footer className="dialog__footer">{frame.footer}</footer> : null}
      </section>
    </div>
  );
}
