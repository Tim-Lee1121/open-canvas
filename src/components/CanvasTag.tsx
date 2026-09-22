import { Check, Copy, MoveTo, Trash, ChevronDown } from "./huge-icons";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { BoardTag, CanvasPosition, TagColor } from "../domain/model";

const COLORS: TagColor[] = ["yellow", "blue", "pink"];

export interface CanvasTagProps {
  tag: BoardTag;
  zoom: number;
  selected?: boolean;
  onSelect?: (tagId: string) => void;
  otherBoards?: { id: string; name: string }[];
  onMove?: (tagId: string, boardId: string) => void;
  onDelete?: (tagId: string) => void;
  onCopy?: (tagId: string) => void;
  onSnapPosition?: (tagId: string, position: CanvasPosition, size: { width: number; height: number }) => { position: CanvasPosition; guides: { vertical?: number; horizontal?: number } };
  onSnapSize?: (tagId: string, position: CanvasPosition, size: { width: number; height: number }) => { size: { width: number; height: number }; guides: { vertical?: number; horizontal?: number } };
  onSnapGuidesChange?: (guides: { vertical?: number; horizontal?: number }) => void;
  onChange: (tagId: string, changes: { text?: string; color?: TagColor; canvasPosition?: CanvasPosition; size?: { width: number; height: number } }) => void;
}

export function CanvasTag({ tag, zoom, selected = false, onSelect, onChange, otherBoards = [], onMove, onDelete, onCopy, onSnapPosition, onSnapSize, onSnapGuidesChange }: CanvasTagProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(tag.text);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; origin: CanvasPosition; resize: boolean; size: { width: number; height: number } } | null>(null);

  useEffect(() => setDraft(tag.text), [tag.text]);
  useEffect(() => {
    if (!editing || !inputRef.current) return;
    const input = inputRef.current;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [editing]);

  const save = () => {
    const value = draft.trim();
    if (value && value !== tag.text) onChange(tag.id, { text: value });
    else if (!value) setDraft(tag.text);
    setEditing(false);
  };

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || editing) return;
    event.stopPropagation();
    onSelect?.(tag.id);
    const element = event.currentTarget.closest(".canvas-tag") as HTMLElement | null;
    element?.setPointerCapture(event.pointerId);
    const resize = Boolean((event.target as HTMLElement).closest(".canvas-tag__resize"));
    const bounds = element?.getBoundingClientRect();
    const measuredSize = bounds && zoom > 0
      ? { width: bounds.width / zoom, height: bounds.height / zoom }
      : undefined;
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      origin: tag.canvasPosition,
      resize,
      // Use the outer Tag frame dimensions. Inner text is deliberately never
      // inspected as a snap target or used to derive this size.
      size: measuredSize ?? tag.size ?? { width: 156, height: 56 },
    };
  };
  const move = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.stopPropagation();
    if (drag.resize) {
      const rawSize = {
        width: Math.max(96, drag.size.width + (event.clientX - drag.x) / Math.max(zoom, 0.01)),
        height: Math.max(34, drag.size.height + (event.clientY - drag.y) / Math.max(zoom, 0.01)),
      };
      const snapped = onSnapSize?.(tag.id, tag.canvasPosition, rawSize);
      onChange(tag.id, { size: snapped?.size ?? rawSize });
      onSnapGuidesChange?.(snapped?.guides ?? {});
    } else {
      const raw = { x: drag.origin.x + (event.clientX - drag.x) / Math.max(zoom, 0.01), y: drag.origin.y + (event.clientY - drag.y) / Math.max(zoom, 0.01) };
      const snapped = onSnapPosition?.(tag.id, raw, drag.size);
      onChange(tag.id, { canvasPosition: snapped?.position ?? raw });
      onSnapGuidesChange?.(snapped?.guides ?? {});
    }
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
    onSnapGuidesChange?.({});
    event.stopPropagation();
  };

  return (
    <div
      className={`canvas-tag canvas-tag--${tag.color}${selected ? " is-selected" : ""}`}
      style={{ left: tag.canvasPosition.x, top: tag.canvasPosition.y, ...(tag.size ? { width: tag.size.width, minHeight: tag.size.height } : {}) }}
      data-tag-id={tag.id}
      onPointerDown={beginDrag}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={(event) => { event.stopPropagation(); setEditing(true); }}
      role="note"
      aria-label={`Tag: ${tag.text}`}
    >
      {editing ? (
        <input ref={inputRef} value={draft} maxLength={120} onChange={(event) => setDraft(event.target.value)} onBlur={save} onKeyDown={(event) => { if (event.key === "Enter") save(); if (event.key === "Escape") { setDraft(tag.text); setEditing(false); } }} aria-label="Edit tag text" />
      ) : <span>{tag.text}</span>}
      {selected ? <div className="canvas-tag__toolbar" data-codex-annotation-chrome="true" style={{ transform: `translateX(-50%) scale(${1 / Math.max(zoom, 0.01)})` }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        {COLORS.map((color) => <button key={color} type="button" className={`canvas-tag__color canvas-tag__color--${color}${tag.color === color ? " is-active" : ""}`} aria-label={`${color} tag`} onClick={() => onChange(tag.id, { color })}><span />{tag.color === color ? <Check size={20} strokeWidth={2.25} aria-hidden="true" /> : null}</button>)}
        {otherBoards.length > 0 ? <details className="canvas-tag__move-menu"><summary><MoveTo size={18} aria-hidden="true" /><span>Move To</span><ChevronDown size={15} aria-hidden="true" /></summary><div role="menu">{otherBoards.map((board) => <button key={board.id} type="button" role="menuitem" onClick={() => { onMove?.(tag.id, board.id); }}><MoveTo size={16} aria-hidden="true" />{board.name}</button>)}</div></details> : <span className="canvas-tag__tool-spacer" />}
        <button type="button" className="canvas-tag__tool-button" onClick={() => { const copy = navigator.clipboard?.writeText(tag.text); if (copy) void copy.then(() => onCopy?.(tag.id)).catch(() => undefined); else onCopy?.(tag.id); }}><Copy size={18} aria-hidden="true" /><span>Copy Texts</span></button>
        <button type="button" className="canvas-tag__tool-button canvas-tag__tool-button--delete" onClick={() => onDelete?.(tag.id)}><Trash size={18} aria-hidden="true" /><span>Delete</span></button>
      </div> : null}
      {selected ? <button type="button" className="canvas-tag__resize" aria-label="Resize tag" title="Resize tag" onPointerDown={beginDrag} /> : null}
    </div>
  );
}
