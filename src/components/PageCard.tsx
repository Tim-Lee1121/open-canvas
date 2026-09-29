import { Apply, ChevronDown, DesktopSize, MoveTo, PageSize, Pencil, Trash } from "./huge-icons";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import type { Board, Page } from "../domain/model";
import { PagePreview } from "./PagePreview";
import type { PageActionProps } from "./types";
import {
  DEFAULT_DEVICE_PRESET_ID,
  DEVICE_PRESETS,
  createCustomDeviceFrame,
  getDevicePreset,
  type DeviceFrame,
} from "./device-presets";

export interface PageCardProps extends PageActionProps {
  page: Page;
  boards?: Board[];
  activeBoardId?: string;
  selected?: boolean;
  canvas?: boolean;
  /** The selected canvas reference size. Omit to let this card manage it. */
  deviceFrame?: DeviceFrame;
  onDeviceFrameChange?: (pageId: string, frame: DeviceFrame) => void;
  style?: CSSProperties;
  isDragging?: boolean;
}

export interface PageNameProps {
  page: Page;
  onSelectPage?: (pageId: string) => void;
}

function DeviceSizeIcon({ width }: { width: number }) {
  const Icon = width >= 768 ? DesktopSize : PageSize;
  return <Icon size={20} aria-hidden="true" />;
}

export function PageName({ page, onSelectPage }: PageNameProps) {
  return (
    <button
      type="button"
      className="page-name"
      data-codex-annotation-chrome="true"
      onClick={() => onSelectPage?.(page.id)}
      title={page.title}
    >
      {page.title}
    </button>
  );
}

export function PageCard({
  page,
  boards = [],
  activeBoardId = page.boardId,
  selected = false,
  canvas = false,
  deviceFrame,
  onDeviceFrameChange,
  style,
  isDragging = false,
  onSelectPage,
  onEditPage,
  onDeletePage,
  onMovePage,
  onCopyPageToFigma,
}: PageCardProps) {
  const otherBoards = boards.filter((board) => board.id !== activeBoardId);
  const [localDeviceFrame, setLocalDeviceFrame] = useState<DeviceFrame>(getDevicePreset(DEFAULT_DEVICE_PRESET_ID));
  const activeDevicePreset = deviceFrame ?? localDeviceFrame;
  const [customWidth, setCustomWidth] = useState(String(activeDevicePreset.width));
  const [customHeight, setCustomHeight] = useState(String(activeDevicePreset.height));
  const cardStyle = {
    ...style,
    // Keep dimensions on the card as well as the canvas wrapper so the frame
    // remains correct if it is rendered outside CanvasView in the future.
    "--device-width": `${activeDevicePreset.width}px`,
    "--device-height": `${activeDevicePreset.height}px`,
  } as CSSProperties;
  useEffect(() => {
    setCustomWidth(String(activeDevicePreset.width));
    setCustomHeight(String(activeDevicePreset.height));
  }, [activeDevicePreset.height, activeDevicePreset.width]);
  const selectDeviceFrame = (frame: DeviceFrame) => {
    if (onDeviceFrameChange) onDeviceFrameChange(page.id, frame);
    else setLocalDeviceFrame(frame);
  };
  const parsedCustomWidth = Number(customWidth.trim());
  const parsedCustomHeight = Number(customHeight.trim());
  const customSizeIsValid = Number.isFinite(parsedCustomWidth) && parsedCustomWidth > 0
    && Number.isFinite(parsedCustomHeight) && parsedCustomHeight > 0;
  return (
    <article
      className={`page-card page-card--canvas${selected ? " is-selected" : ""}${page.source.type === "html" ? " page-card--annotatable" : ""}${isDragging ? " is-dragging" : ""}`}
      style={cardStyle}
      data-page-id={page.id}
      data-device-preset={canvas ? activeDevicePreset.id : undefined}
      data-device-width={canvas ? activeDevicePreset.width : undefined}
      data-device-height={canvas ? activeDevicePreset.height : undefined}
      aria-label={page.source.type === "html" ? undefined : page.title}
    >
      {canvas ? (
        <div
          className="page-card__canvas-toolbar"
          data-codex-annotation-chrome="true"
          role="toolbar"
          aria-label={`Canvas controls for ${page.title}`}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <details className="page-card__device-menu">
            <summary className="page-card__device-trigger" aria-label="Device size" title="Device size">
              <DeviceSizeIcon width={activeDevicePreset.width} /><span>{activeDevicePreset.label}</span><ChevronDown size={16} aria-hidden="true" />
            </summary>
            <div className="page-card__device-options" role="menu">
              {DEVICE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  role="menuitem"
                  className={preset.id === activeDevicePreset.id ? "is-active" : undefined}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectDeviceFrame(preset);
                    event.currentTarget.closest("details")?.removeAttribute("open");
                  }}
                >
                  <DeviceSizeIcon width={preset.width} />{preset.label}
                </button>
              ))}
              <form
                className="page-card__custom-size"
                aria-label="Custom canvas size"
                onSubmit={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (!customSizeIsValid) return;
                  selectDeviceFrame(createCustomDeviceFrame(parsedCustomWidth, parsedCustomHeight));
                  event.currentTarget.closest("details")?.removeAttribute("open");
                }}
              >
                <label className="page-card__dimension-field">
                  <span>W</span>
                  <input type="text" inputMode="decimal" value={customWidth} onChange={(event) => setCustomWidth(event.target.value)} aria-label="Canvas width" />
                </label>
                <span className="page-card__dimension-separator" aria-hidden="true">×</span>
                <label className="page-card__dimension-field">
                  <span>H</span>
                  <input type="text" inputMode="decimal" value={customHeight} onChange={(event) => setCustomHeight(event.target.value)} aria-label="Canvas height" />
                </label>
                <button type="submit" className="icon-button page-card__apply-size" aria-label="Apply custom canvas size" title="Apply size" disabled={!customSizeIsValid}><Apply size={18} aria-hidden="true" /></button>
              </form>
            </div>
          </details>
          <span className="page-card__canvas-divider" aria-hidden="true" />
          <button type="button" className="page-card__canvas-action page-card__canvas-action--figma" title="Export editable layers for Figma" onClick={() => void onCopyPageToFigma?.(page, activeDevicePreset)}>Export for Figma</button>
          <button type="button" className="page-card__canvas-action" onClick={() => onEditPage?.(page)}><Pencil size={14} aria-hidden="true" /> Rename</button>
          {otherBoards.length > 0 ? (
            <details className="page-card__move-menu">
              <summary className="page-card__canvas-action"><MoveTo size={14} aria-hidden="true" /> Move to</summary>
              <div className="page-card__device-options" role="menu">
                {otherBoards.map((board) => (
                  <button
                    key={board.id}
                    type="button"
                    role="menuitem"
                    onClick={(event) => {
                      event.stopPropagation();
                      onMovePage?.(page.id, board.id);
                      event.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                  >
                    {board.name}
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          <button type="button" className="page-card__canvas-action page-card__canvas-action--danger" onClick={() => onDeletePage?.(page.id)}><Trash size={14} aria-hidden="true" /> Delete</button>
        </div>
      ) : null}
      {/* The preview contains its own iframe and external-link control, so it
          must remain a non-interactive container rather than a button wrapper. */}
      <div
        // HTML previews expose their generated controls as real same-document
        // nodes for Codex Annotation. A click listener on this full-size
        // wrapper makes some browser hosts attribute the whole card instead of
        // the control under the pointer, so selection stays on the header for
        // inline HTML. URL previews retain the card-click affordance.
        className={`page-card__preview-button${page.source.type === "html" ? " page-card__preview-button--annotation" : ""}`}
        onClick={page.source.type === "html" ? undefined : () => onSelectPage?.(page.id)}
      >
        <PagePreview
          page={page}
          variant={canvas ? "canvas" : "card"}
          showSourceBadge={page.source.type === "url"}
        />
      </div>
      {page.source.type === "url" ? (
        <footer className="page-card__footer" data-codex-annotation-chrome="true">
          <span>{page.source.value.replace(/^https?:\/\//, "")}</span>
        </footer>
      ) : null}
    </article>
  );
}
