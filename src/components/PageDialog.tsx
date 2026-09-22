import { Code2, Globe2, Loader2, Save } from "./huge-icons";
import { useEffect, useState } from "react";
import type { Page, PageSource } from "../domain/model";
import { validatePageSource, validatePageTitle } from "../domain/model";
import type { PageFormValues, MaybePromise } from "./types";
import { Dialog } from "./Dialog";

export interface PageDialogProps {
  open: boolean;
  page?: Page | null;
  onClose: () => void;
  onSubmit: (values: PageFormValues) => MaybePromise<void>;
}

export function PageDialog({ open, page, onClose, onSubmit }: PageDialogProps) {
  const [title, setTitle] = useState("");
  const [sourceType, setSourceType] = useState<PageSource["type"]>("html");
  const [sourceValue, setSourceValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(page?.title ?? "");
    setSourceType(page?.source.type ?? "html");
    setSourceValue(page?.source.value ?? "");
    setError(null);
    setSaving(false);
  }, [open, page]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Pages are created by the Codex project integration. This dialog is intentionally
    // edit-only, so a missing page cannot fall through to a manual import.
    if (!page) {
      setError("Select an existing page to edit.");
      return;
    }
    const titleError = validatePageTitle(title);
    if (titleError) { setError(titleError); return; }
    const source: PageSource = { type: sourceType, value: sourceValue };
    const sourceError = validatePageSource(source);
    if (sourceError) { setError(sourceError); return; }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({ title: title.trim(), source });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save page");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open && Boolean(page)} onClose={onClose} title="Edit page" description="Update the title or source for this generated page." size="large" footer={<><button type="button" className="secondary-button" onClick={onClose} disabled={saving}>Cancel</button><button type="submit" form="page-dialog-form" className="primary-button" disabled={saving}>{saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}Save changes</button></>}>
      <form id="page-dialog-form" className="form-stack" onSubmit={submit}>
        <label className="field-label" htmlFor="page-title">Page title<span aria-hidden="true">*</span></label>
        <input id="page-title" className="text-input" value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Checkout · Mobile" autoComplete="off" autoFocus />
        <div className="source-toggle" role="tablist" aria-label="Page source type">
          <button type="button" role="tab" aria-selected={sourceType === "html"} className={sourceType === "html" ? "is-active" : ""} onClick={() => setSourceType("html")}><Code2 size={15} aria-hidden="true" /> HTML</button>
          <button type="button" role="tab" aria-selected={sourceType === "url"} className={sourceType === "url" ? "is-active" : ""} onClick={() => setSourceType("url")}><Globe2 size={15} aria-hidden="true" /> URL</button>
        </div>
        {sourceType === "html" ? <><label className="field-label" htmlFor="page-source">Generated HTML<span aria-hidden="true">*</span></label><textarea id="page-source" className="code-input" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder="<!doctype html>…" spellCheck={false} /></> : <><label className="field-label" htmlFor="page-source">Preview URL<span aria-hidden="true">*</span></label><input id="page-source" className="text-input" type="url" value={sourceValue} onChange={(event) => setSourceValue(event.target.value)} placeholder="https://example.com/mobile" /></>}
        <div className="field-meta"><span>Content is previewed in a sandboxed frame.</span><span>{sourceValue.length.toLocaleString()} characters</span></div>
        {error ? <p className="form-error" role="alert">{error}</p> : null}
      </form>
    </Dialog>
  );
}
