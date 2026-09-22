import { Add, Focus, Scan, Tag as TagIcon, ZoomIn, ZoomOut } from "./huge-icons";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { getDefaultCanvasPosition, type Board, type BoardTag, type CanvasPosition, type Page } from "../domain/model";
import { PageCard, PageName } from "./PageCard";
import type { PageActionProps } from "./types";
import {
  DEFAULT_DEVICE_PRESET_ID,
  type DeviceFrame,
  getDevicePreset,
} from "./device-presets";
import { isAnnotationPickerActive } from "./annotationInteraction";
import { CanvasTag } from "./CanvasTag";
import { CanvasMinimap } from "./CanvasMinimap";
import type { TagColor } from "../domain/model";

export interface CanvasViewProps extends PageActionProps {
  pages: Page[];
  boards?: Board[];
  activeBoardId?: string;
  selectedPageId?: string | null;
  layoutInsetKey?: string | boolean;
  onUpdateCanvasPosition?: (pageId: string, position: CanvasPosition) => void;
  onClearSelection?: () => void;
  tags?: Board["tags"];
  onCreateTag?: (position?: CanvasPosition) => string | void;
  onUpdateTag?: (tagId: string, changes: { text?: string; color?: TagColor; canvasPosition?: CanvasPosition; size?: { width: number; height: number } }) => void;
  onMoveTag?: (tagId: string, boardId: string) => void;
  onDeleteTag?: (tagId: string) => void;
  onCopyTag?: (tagId: string) => void;
}

interface CardDragState {
  id: string;
  pointerX: number;
  pointerY: number;
  originX: number;
  originY: number;
  zoom: number;
}

interface PanState {
  pointerId: number;
  pointerX: number;
  pointerY: number;
  originX: number;
  originY: number;
  moved: boolean;
}

// The selected-card toolbar and permanent page title both float above the
// device frame. Include their footprint when framing the canvas.
const CANVAS_PAGE_TITLE_HEIGHT = 22;
const CANVAS_PAGE_TITLE_GAP = 10;
const CANVAS_TOOLBAR_HEIGHT = 58;
const CANVAS_TOOLBAR_GAP = 12;
const CANVAS_TOOLBAR_EXTENT = CANVAS_PAGE_TITLE_GAP
  + CANVAS_PAGE_TITLE_HEIGHT
  + CANVAS_TOOLBAR_GAP
  + CANVAS_TOOLBAR_HEIGHT;
const CANVAS_FRAME_GAP = 40;
const CANVAS_GRID_SIZE = 32;
const CANVAS_GRID_FADE_START = 0.18;
const CANVAS_GRID_FADE_END = 0.45;
const PAN_CLICK_THRESHOLD = 4;
const INITIAL_ZOOM = 0.8;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 1.45;
const WHEEL_ZOOM_SENSITIVITY = 0.0005;
const WHEEL_ZOOM_MAX_STEP = 0.24;
const SNAP_THRESHOLD = 12;
const MINIMAP_HIDE_DELAY = 1800;

interface CanvasBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface SafeInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

interface ToolbarMeasurements {
  viewportWidth: number;
  viewportHeight: number;
  safeTop: number;
  safeLeft: number;
  safeRight: number;
  safeBottom: number;
  widths: Record<string, number>;
}

interface SnapGuides {
  vertical?: number;
  horizontal?: number;
}

interface CanvasItemBounds {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface SnapResult {
  position: CanvasPosition;
  guides: SnapGuides;
}

interface SnapSizeResult {
  size: { width: number; height: number };
  guides: SnapGuides;
}


function parsePixelValue(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function wheelZoomDelta(deltaY: number, deltaMode: number, viewportHeight: number): number {
  // Magic Mouse and trackpads emit many small pixel deltas, while traditional
  // wheels commonly use line/page units. Normalize both to pixels, then cap a
  // single event so an accelerated swipe cannot jump across the whole range.
  const unit = deltaMode === 1 ? 16 : deltaMode === 2 ? Math.max(viewportHeight, 1) : 1;
  const pixels = deltaY * unit;
  const step = Math.max(-WHEEL_ZOOM_MAX_STEP, Math.min(WHEEL_ZOOM_MAX_STEP, -pixels * WHEEL_ZOOM_SENSITIVITY));
  return Number(step.toFixed(3));
}

function canvasGridDotColor(zoom: number): string {
  const opacity = Math.min(1, Math.max(0,
    (zoom - CANVAS_GRID_FADE_START) / (CANVAS_GRID_FADE_END - CANVAS_GRID_FADE_START),
  ));
  if (opacity >= 1) return "#C6C6CB";
  return `rgba(198, 198, 203, ${Number(opacity.toFixed(3))})`;
}

function readSafeInsets(viewport: HTMLElement): SafeInsets {
  const style = viewport.ownerDocument.defaultView?.getComputedStyle(viewport);
  return {
    top: parsePixelValue(style?.scrollPaddingTop ?? ""),
    right: parsePixelValue(style?.scrollPaddingRight ?? ""),
    bottom: parsePixelValue(style?.scrollPaddingBottom ?? ""),
    left: parsePixelValue(style?.scrollPaddingLeft ?? ""),
  };
}

function getCanvasBounds(
  pages: Page[],
  positions: Record<string, CanvasPosition>,
  getDevice: (pageId: string) => { width: number; height: number },
  tags: BoardTag[] = [],
): CanvasBounds | null {
  if (pages.length === 0 && tags.length === 0) return null;
  const pageBounds = pages.map((page) => {
    const position = positions[page.id] ?? { x: 0, y: 0 };
    const device = getDevice(page.id);
    return {
      minX: position.x,
      minY: position.y,
      maxX: position.x + device.width,
      maxY: position.y + device.height,
    };
  });
  const tagBounds = tags.map((tag) => ({ minX: tag.canvasPosition.x, minY: tag.canvasPosition.y, maxX: tag.canvasPosition.x + (tag.size?.width ?? 160), maxY: tag.canvasPosition.y + (tag.size?.height ?? 64) }));
  const allBounds = [...pageBounds, ...tagBounds];
  return { minX: Math.min(...allBounds.map((bounds) => bounds.minX)), minY: Math.min(...allBounds.map((bounds) => bounds.minY)), maxX: Math.max(...allBounds.map((bounds) => bounds.maxX)), maxY: Math.max(...allBounds.map((bounds) => bounds.maxY)) };
}

function rectanglesOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, gap = 16): boolean {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y;
}

function nearestSnap(value: number, candidates: Array<{ value: number; guide: number }>): { value: number; guide?: number } {
  let best = { value, distance: SNAP_THRESHOLD, guide: undefined as number | undefined };
  candidates.forEach((candidate) => {
    const distance = Math.abs(candidate.value - value);
    if (distance <= best.distance) best = { value: candidate.value, distance, guide: candidate.guide };
  });
  return { value: best.value, guide: best.guide };
}

function snapCanvasPosition(raw: CanvasPosition, size: { width: number; height: number }, movingId: string, items: CanvasItemBounds[]): SnapResult {
  const others = items.filter((item) => item.id !== movingId);
  const xCandidates: Array<{ value: number; guide: number }> = [];
  const yCandidates: Array<{ value: number; guide: number }> = [];
  others.forEach((item) => {
    const left = item.x;
    const centerX = item.x + item.width / 2;
    const right = item.x + item.width;
    xCandidates.push(
      { value: left, guide: left },
      { value: left - size.width / 2, guide: left },
      { value: left - size.width, guide: left },
      { value: centerX, guide: centerX },
      { value: centerX - size.width / 2, guide: centerX },
      { value: centerX - size.width, guide: centerX },
      { value: right, guide: right },
      { value: right - size.width / 2, guide: right },
      { value: right - size.width, guide: right },
    );
    const top = item.y;
    const centerY = item.y + item.height / 2;
    const bottom = item.y + item.height;
    yCandidates.push(
      { value: top, guide: top },
      { value: top - size.height / 2, guide: top },
      { value: top - size.height, guide: top },
      { value: centerY, guide: centerY },
      { value: centerY - size.height / 2, guide: centerY },
      { value: centerY - size.height, guide: centerY },
      { value: bottom, guide: bottom },
      { value: bottom - size.height / 2, guide: bottom },
      { value: bottom - size.height, guide: bottom },
    );
  });
  const x = nearestSnap(raw.x, xCandidates);
  const y = nearestSnap(raw.y, yCandidates);
  return {
    position: { x: Number(x.value.toFixed(3)), y: Number(y.value.toFixed(3)) },
    guides: { vertical: x.guide, horizontal: y.guide },
  };
}

function snapCanvasSize(
  position: CanvasPosition,
  rawSize: { width: number; height: number },
  movingId: string,
  items: CanvasItemBounds[],
): SnapSizeResult {
  const others = items.filter((item) => item.id !== movingId);
  const rightCandidates: Array<{ value: number; guide: number }> = [];
  const bottomCandidates: Array<{ value: number; guide: number }> = [];
  others.forEach((item) => {
    const centerX = item.x + item.width / 2;
    const right = item.x + item.width;
    rightCandidates.push(
      { value: item.x - position.x, guide: item.x },
      { value: centerX - position.x, guide: centerX },
      { value: right - position.x, guide: right },
    );
    const centerY = item.y + item.height / 2;
    const bottom = item.y + item.height;
    bottomCandidates.push(
      { value: item.y - position.y, guide: item.y },
      { value: centerY - position.y, guide: centerY },
      { value: bottom - position.y, guide: bottom },
    );
  });
  const width = nearestSnap(rawSize.width, rightCandidates);
  const height = nearestSnap(rawSize.height, bottomCandidates);
  return {
    size: { width: Math.max(96, Number(width.value.toFixed(3))), height: Math.max(34, Number(height.value.toFixed(3))) },
    guides: { vertical: width.guide, horizontal: height.guide },
  };
}

function initialPan(bounds: CanvasBounds, insets: SafeInsets) {
  return {
    x: insets.left + CANVAS_FRAME_GAP - bounds.minX * INITIAL_ZOOM,
    y: insets.top + CANVAS_FRAME_GAP + CANVAS_TOOLBAR_EXTENT - bounds.minY * INITIAL_ZOOM,
  };
}

function equalToolbarMeasurements(current: ToolbarMeasurements, next: ToolbarMeasurements): boolean {
  if (
    current.viewportWidth !== next.viewportWidth
    || current.viewportHeight !== next.viewportHeight
    || current.safeTop !== next.safeTop
    || current.safeLeft !== next.safeLeft
    || current.safeRight !== next.safeRight
    || current.safeBottom !== next.safeBottom
  ) return false;
  const currentIds = Object.keys(current.widths);
  const nextIds = Object.keys(next.widths);
  return currentIds.length === nextIds.length
    && nextIds.every((id) => current.widths[id] === next.widths[id]);
}

function horizontalToolbarShift(
  toolbarWidth: number,
  cardCenter: number,
  zoom: number,
  measurements: ToolbarMeasurements,
): number {
  if (toolbarWidth <= 0 || measurements.viewportWidth <= 0 || zoom <= 0) return 0;
  const visibleLeft = measurements.safeLeft + 12;
  const visibleRight = Math.max(visibleLeft, measurements.viewportWidth - measurements.safeRight - 12);
  // The toolbar counter-scales against the canvas, so its measured CSS width
  // is also its final on-screen width at every zoom level.
  const halfToolbarWidth = toolbarWidth / 2;
  const minCenter = visibleLeft + halfToolbarWidth;
  const maxCenter = visibleRight - halfToolbarWidth;
  const targetCenter = minCenter <= maxCenter
    ? Math.min(maxCenter, Math.max(minCenter, cardCenter))
    : (visibleLeft + visibleRight) / 2;
  return Number(((targetCenter - cardCenter) / zoom).toFixed(3));
}

export function CanvasView({
  pages,
  boards = [],
  activeBoardId,
  selectedPageId,
  layoutInsetKey,
  onSelectPage,
  onEditPage,
  onDeletePage,
  onMovePage,
  onCopyPageToFigma,
  onUpdateCanvasPosition,
  onClearSelection,
  tags = [],
  onCreateTag,
  onUpdateTag,
  onMoveTag,
  onDeleteTag,
  onCopyTag,
}: CanvasViewProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(INITIAL_ZOOM);
  const [pan, setPan] = useState({ x: 40, y: 40 });
  const [dragState, setDragState] = useState<CardDragState | null>(null);
  const [panState, setPanState] = useState<PanState | null>(null);
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null);
  const [snapGuides, setSnapGuides] = useState<SnapGuides>({});
  const panGestureRef = useRef<PanState | null>(null);
  const [draftPositions, setDraftPositions] = useState<Record<string, CanvasPosition>>({});
  // Device selection is canvas UI state rather than page content. Keep it in
  // the canvas so fit-all can use the same dimensions as the rendered frame.
  const [deviceFrames, setDeviceFrames] = useState<Record<string, DeviceFrame>>({});
  const [minimapVisible, setMinimapVisible] = useState(false);
  const minimapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [toolbarMeasurements, setToolbarMeasurements] = useState<ToolbarMeasurements>({
    viewportWidth: 0,
    viewportHeight: 0,
    safeTop: 0,
    safeLeft: 0,
    safeRight: 0,
    safeBottom: 0,
    widths: {},
  });

  const revealMinimap = useCallback(() => {
    setMinimapVisible(true);
    if (minimapTimerRef.current) clearTimeout(minimapTimerRef.current);
    minimapTimerRef.current = setTimeout(() => {
      setMinimapVisible(false);
      minimapTimerRef.current = null;
    }, MINIMAP_HIDE_DELAY);
  }, []);

  useEffect(() => () => {
    if (minimapTimerRef.current) clearTimeout(minimapTimerRef.current);
  }, []);

  const positions = useMemo(() => {
    // A null-prototype map keeps page IDs such as "constructor" or
    // "toString" from resolving inherited values as canvas coordinates.
    const result = Object.create(null) as Record<string, CanvasPosition>;
    pages.forEach((page, index) => {
      const draftPosition = Object.prototype.hasOwnProperty.call(draftPositions, page.id)
        ? draftPositions[page.id]
        : undefined;
      result[page.id] = draftPosition ?? (Number.isFinite(page.canvasPosition?.x) && Number.isFinite(page.canvasPosition?.y)
        ? page.canvasPosition
        : getDefaultCanvasPosition(index));
    });
    return result;
  }, [draftPositions, pages]);

  const getPageDevicePreset = useCallback((pageId: string) => (
    deviceFrames[pageId] ?? getDevicePreset(DEFAULT_DEVICE_PRESET_ID)
  ), [deviceFrames]);

  const canvasItems = useMemo<CanvasItemBounds[]>(() => [
    ...pages.map((page) => {
      const position = positions[page.id] ?? { x: 0, y: 0 };
      const device = getPageDevicePreset(page.id);
      return { id: page.id, x: position.x, y: position.y, width: device.width, height: device.height };
    }),
    ...tags.map((tag) => ({
      id: tag.id,
      x: tag.canvasPosition.x,
      y: tag.canvasPosition.y,
      width: tag.size?.width ?? 156,
      height: tag.size?.height ?? 40,
    })),
  ], [getPageDevicePreset, pages, positions, tags]);

  const getSnappedPosition = useCallback((id: string, position: CanvasPosition, size: { width: number; height: number }) => {
    // Snap against rendered outer frames. Reading the .canvas-tag element
    // itself keeps text glyph contours out of the alignment model.
    const renderedItems = canvasItems.map((item) => {
      if (!tags.some((tag) => tag.id === item.id)) return item;
      const element = viewportRef.current?.querySelector<HTMLElement>(`[data-tag-id="${CSS.escape(item.id)}"]`);
      const bounds = element?.getBoundingClientRect();
      if (!bounds || zoom <= 0) return item;
      return { ...item, width: bounds.width / zoom, height: bounds.height / zoom };
    });
    return snapCanvasPosition(position, size, id, renderedItems);
  }, [canvasItems, tags, zoom]);

  const getSnappedSize = useCallback((id: string, position: CanvasPosition, size: { width: number; height: number }) => {
    const renderedItems = canvasItems.map((item) => {
      if (!tags.some((tag) => tag.id === item.id)) return item;
      const element = viewportRef.current?.querySelector<HTMLElement>(`[data-tag-id="${CSS.escape(item.id)}"]`);
      const bounds = element?.getBoundingClientRect();
      if (!bounds || zoom <= 0) return item;
      return { ...item, width: bounds.width / zoom, height: bounds.height / zoom };
    });
    return snapCanvasSize(position, size, id, renderedItems);
  }, [canvasItems, tags, zoom]);

  const handleDeviceFrameChange = useCallback((pageId: string, frame: DeviceFrame) => {
    setDeviceFrames((current) => {
      const active = current[pageId];
      if (active?.width === frame.width && active.height === frame.height) return current;
      return { ...current, [pageId]: frame };
    });
  }, []);

  const framingStateRef = useRef<{ boardId: string | undefined; hasPages: boolean } | null>(null);

  // Canvas viewport state is session-local. Frame a board before paint on the
  // first render, when switching boards, and when Codex adds the first page to
  // an empty board. Subsequent page updates leave the user's pan/zoom intact.
  useLayoutEffect(() => {
    const previous = framingStateRef.current;
    const boardChanged = previous === null || previous.boardId !== activeBoardId;
    const becameNonEmpty = pages.length > 0 && previous?.hasPages === false;
    framingStateRef.current = { boardId: activeBoardId, hasPages: pages.length > 0 };
    if (!boardChanged && !becameNonEmpty) return;

    setDragState(null);
    setPanState(null);
    setMinimapVisible(false);
    panGestureRef.current = null;
    if (boardChanged) setDraftPositions({});
    setZoom(INITIAL_ZOOM);

    const viewport = viewportRef.current;
    const bounds = getCanvasBounds(pages, positions, getPageDevicePreset, tags);
    if (!viewport || !bounds) {
      setPan({ x: CANVAS_FRAME_GAP, y: CANVAS_FRAME_GAP });
      return;
    }
    setPan(initialPan(bounds, readSafeInsets(viewport)));
  }, [activeBoardId, getPageDevicePreset, pages, positions, tags]);

  const toolbarMeasureKey = useMemo(() => JSON.stringify({
    pages: pages.map((page) => [page.id, page.title]),
    boards: boards.map((board) => [board.id, board.name]),
    frames: deviceFrames,
    selectedPageId,
  }), [boards, deviceFrames, pages, selectedPageId]);

  // Toolbars are measured only when their content, zoom, or viewport geometry
  // can change. Pan and card drags reuse these measurements and only update
  // CSS variables, avoiding a synchronous layout read on every pointermove.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    const measure = () => {
      const insets = readSafeInsets(viewport);
      const widths = Object.create(null) as Record<string, number>;
      viewport.querySelectorAll<HTMLElement>("[data-canvas-page-id]").forEach((pageElement) => {
        const pageId = pageElement.getAttribute("data-canvas-page-id");
        const toolbar = pageElement.querySelector<HTMLElement>(".page-card__canvas-toolbar");
        if (pageId && toolbar) widths[pageId] = toolbar.offsetWidth;
      });
      const rect = viewport.getBoundingClientRect();
      const next = {
        viewportWidth: rect.width,
        viewportHeight: rect.height,
        safeTop: insets.top,
        safeLeft: insets.left,
        safeRight: insets.right,
        safeBottom: insets.bottom,
        widths,
      };
      setToolbarMeasurements((current) => equalToolbarMeasurements(current, next) ? current : next);
    };

    measure();
    const ResizeObserverConstructor = viewport.ownerDocument.defaultView?.ResizeObserver;
    const observer = ResizeObserverConstructor ? new ResizeObserverConstructor(measure) : null;
    observer?.observe(viewport);
    viewport.querySelectorAll<HTMLElement>(".page-card__canvas-toolbar").forEach((toolbar) => observer?.observe(toolbar));
    const view = viewport.ownerDocument.defaultView;
    view?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      view?.removeEventListener("resize", measure);
    };
  }, [layoutInsetKey, toolbarMeasureKey, toolbarMeasurements.safeTop, toolbarMeasurements.safeLeft, toolbarMeasurements.safeRight, toolbarMeasurements.safeBottom, toolbarMeasurements.viewportWidth, toolbarMeasurements.viewportHeight, zoom]);

  const toolbarShifts = useMemo(() => {
    const shifts = Object.create(null) as Record<string, number>;
    pages.forEach((page) => {
      const position = positions[page.id] ?? { x: 0, y: 0 };
      const device = getPageDevicePreset(page.id);
      const cardCenter = pan.x + (position.x + device.width / 2) * zoom;
      shifts[page.id] = horizontalToolbarShift(
        toolbarMeasurements.widths[page.id] ?? 0,
        cardCenter,
        zoom,
        toolbarMeasurements,
      );
    });
    return shifts;
  }, [getPageDevicePreset, pages, pan.x, positions, toolbarMeasurements, zoom]);

  const toolbarMaxWidth = toolbarMeasurements.viewportWidth > 0
    ? Math.max(1, toolbarMeasurements.viewportWidth - toolbarMeasurements.safeLeft - toolbarMeasurements.safeRight - 24)
    : null;

  const beginCardDrag = (event: PointerEvent, page: Page) => {
    if (event.button !== 0) return;
    if (isAnnotationPickerActive(event.currentTarget.ownerDocument)) return;
    const target = event.target as HTMLElement;
    // The title button is the largest, most discoverable part of a canvas
    // card, so it should also start a drag. Keep actual commands (menus,
    // footer actions, links and form controls) click-only.
    if (target.closest("a, input, textarea, summary, details, iframe, .page-card__preview-button, .page-card__footer button, .page-card__canvas-toolbar")) return;
    onSelectPage?.(page.id);
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    setSnapGuides({});
    const position = positions[page.id] ?? { x: 0, y: 0 };
    setDragState({
      id: page.id,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: position.x,
      originY: position.y,
      zoom,
    });
  };

  const beginPan = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if (isAnnotationPickerActive(event.currentTarget.ownerDocument)) return;
    const target = event.target as HTMLElement;
    if (target.closest(".page-card, .canvas-toolbar, button, a")) return;
    if (panGestureRef.current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const gesture = {
      pointerId: event.pointerId,
      pointerX: event.clientX,
      pointerY: event.clientY,
      originX: pan.x,
      originY: pan.y,
      moved: false,
    };
    panGestureRef.current = gesture;
    setPanState(gesture);
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragState) {
      // Canvas coordinates are intentionally unbounded. Negative positions
      // let a page move above or to the left of the initial origin, while the
      // viewport's pan gesture remains available to bring it back into view.
      const next = {
        x: dragState.originX + (event.clientX - dragState.pointerX) / dragState.zoom,
        y: dragState.originY + (event.clientY - dragState.pointerY) / dragState.zoom,
      };
      const snapped = getSnappedPosition(dragState.id, next, getPageDevicePreset(dragState.id));
      setDraftPositions((current) => ({ ...current, [dragState.id]: snapped.position }));
      setSnapGuides(snapped.guides);
      return;
    }
    const panGesture = panGestureRef.current;
    if (panGesture && panGesture.pointerId === event.pointerId) {
      const deltaX = event.clientX - panGesture.pointerX;
      const deltaY = event.clientY - panGesture.pointerY;
      if (!panGesture.moved && Math.hypot(deltaX, deltaY) <= PAN_CLICK_THRESHOLD) return;
      panGesture.moved = true;
      setPan({ x: panGesture.originX + deltaX, y: panGesture.originY + deltaY });
    }
  };

  const clearDragDraft = (pageId: string) => {
    setDraftPositions((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, pageId)) return current;
      const next = { ...current };
      delete next[pageId];
      return next;
    });
    setDragState(null);
  };

  const endPointerAction = (event: PointerEvent<HTMLDivElement>) => {
    if (dragState) {
      // Compute from the pointer-up event itself so a final event that arrives
      // before React renders the last pointermove is not lost.
      const finalPosition = {
        x: dragState.originX + (event.clientX - dragState.pointerX) / dragState.zoom,
        y: dragState.originY + (event.clientY - dragState.pointerY) / dragState.zoom,
      };
      const snapped = getSnappedPosition(dragState.id, finalPosition, getPageDevicePreset(dragState.id));
      onUpdateCanvasPosition?.(dragState.id, snapped.position);
      setSnapGuides({});
      clearDragDraft(dragState.id);
    }
    const panGesture = panGestureRef.current;
    if (panGesture && panGesture.pointerId === event.pointerId) {
      panGestureRef.current = null;
      setPanState(null);
      const finalDistance = Math.hypot(
        event.clientX - panGesture.pointerX,
        event.clientY - panGesture.pointerY,
      );
      if (!panGesture.moved && finalDistance <= PAN_CLICK_THRESHOLD) { setSelectedTagId(null); onClearSelection?.(); }
    }
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer may have been released outside the viewport.
    }
  };

  const cancelPointerAction = (event: PointerEvent<HTMLDivElement>) => {
    if (dragState) clearDragDraft(dragState.id);
    setSnapGuides({});
    const panGesture = panGestureRef.current;
    if (panGesture && panGesture.pointerId === event.pointerId) {
      panGestureRef.current = null;
      setPanState(null);
    }
    try {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer may have been released outside the viewport.
    }
  };

  const changeZoom = useCallback((delta: number) => {
    setZoom((current) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + delta).toFixed(3)))));
    revealMinimap();
  }, [revealMinimap]);

  const applyWheelZoom = useCallback((event: Pick<WheelEvent, "deltaY" | "deltaMode">) => {
    const viewportHeight = viewportRef.current?.clientHeight ?? window.innerHeight;
    const step = wheelZoomDelta(event.deltaY, event.deltaMode, viewportHeight);
    if (step !== 0) changeZoom(step);
  }, [changeZoom]);

  // Canvas applications own pinch and zoom shortcuts. Capture them at the
  // document level so a gesture that begins over the floating sidebar cannot
  // become browser-page zoom and resize the application chrome.
  useEffect(() => {
    const ownerDocument = viewportRef.current?.ownerDocument ?? document;
    const handlePinch = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      applyWheelZoom(event);
    };
    const handleZoomShortcut = (event: KeyboardEvent) => {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey) return;
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        changeZoom(0.1);
      } else if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        changeZoom(-0.1);
      } else if (event.key === "0") {
        event.preventDefault();
        setZoom(INITIAL_ZOOM);
        revealMinimap();
      }
    };
    ownerDocument.addEventListener("wheel", handlePinch, { capture: true, passive: false });
    ownerDocument.addEventListener("keydown", handleZoomShortcut, true);
    return () => {
      ownerDocument.removeEventListener("wheel", handlePinch, true);
      ownerDocument.removeEventListener("keydown", handleZoomShortcut, true);
    };
  }, [applyWheelZoom, changeZoom, revealMinimap]);

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    // Modified wheel gestures are handled once by the document capture
    // listener above, including when the pointer is over the sidebar.
    if (event.ctrlKey || event.metaKey) return;
    if (Math.abs(event.deltaY) > 0) {
      event.preventDefault();
      applyWheelZoom(event);
    }
  };

  const fitAll = () => {
    if (!viewportRef.current || (pages.length === 0 && tags.length === 0)) {
      setPan({ x: CANVAS_FRAME_GAP, y: CANVAS_FRAME_GAP });
      setZoom(INITIAL_ZOOM);
      return;
    }
    const rect = viewportRef.current.getBoundingClientRect();
    const bounds = getCanvasBounds(pages, positions, getPageDevicePreset, tags);
    if (!bounds) return;
    const insets = readSafeInsets(viewportRef.current);
    const contentWidth = Math.max(bounds.maxX - bounds.minX, 1);
    const contentHeight = Math.max(bounds.maxY - bounds.minY, 1);
    const availableWidth = Math.max(1, rect.width - insets.left - insets.right - CANVAS_FRAME_GAP * 2);
    const availableHeight = Math.max(1, rect.height - insets.top - insets.bottom - CANVAS_FRAME_GAP * 2 - CANVAS_TOOLBAR_EXTENT);
    const clampedZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(availableWidth / contentWidth, availableHeight / contentHeight)));
    // Round down so displaying an integer percentage cannot push the furthest
    // page a few pixels back under the sidebar or bottom controls.
    const nextZoom = Math.max(MIN_ZOOM, Math.floor(clampedZoom * 100) / 100);
    setZoom(nextZoom);
    // Translate the whole bounds, including negative coordinates, into the
    // safe viewport center. Use the exact rounded zoom stored in state so the
    // rendered bounds and computed offsets cannot drift apart.
    setPan({
      x: insets.left + CANVAS_FRAME_GAP + (availableWidth - contentWidth * nextZoom) / 2 - bounds.minX * nextZoom,
      y: insets.top + CANVAS_FRAME_GAP + CANVAS_TOOLBAR_EXTENT
        + (availableHeight - contentHeight * nextZoom) / 2 - bounds.minY * nextZoom,
    });
    revealMinimap();
  };

  const getNewTagPosition = useCallback((): CanvasPosition => {
    const viewport = viewportRef.current;
    const width = 160;
    const height = 64;
    const visibleLeft = viewport ? (-pan.x / Math.max(zoom, 0.01)) : 32;
    const visibleTop = viewport ? (-pan.y / Math.max(zoom, 0.01)) : 32;
    const visibleWidth = viewport ? viewport.clientWidth / Math.max(zoom, 0.01) : 640;
    const visibleHeight = viewport ? viewport.clientHeight / Math.max(zoom, 0.01) : 640;
    const rightEdge = visibleLeft + visibleWidth;
    const bottomEdge = visibleTop + visibleHeight;
    const lastTag = tags[tags.length - 1];
    const baseX = lastTag ? lastTag.canvasPosition.x + (lastTag.size?.width ?? width) + 24 : visibleLeft + Math.max(24, (visibleWidth - width) / 2);
    const baseY = lastTag ? lastTag.canvasPosition.y : visibleTop + Math.max(24, (visibleHeight - height) / 2);
    const occupied = [
      ...tags.map((tag) => ({ x: tag.canvasPosition.x, y: tag.canvasPosition.y, width: tag.size?.width ?? width, height: tag.size?.height ?? height })),
      ...pages.map((page) => { const position = positions[page.id] ?? page.canvasPosition; const device = getPageDevicePreset(page.id); return { x: position.x, y: position.y, width: device.width, height: device.height }; }),
    ];
    for (let row = 0; row < 40; row += 1) {
      for (let column = 0; column < 40; column += 1) {
        let x = baseX + column * (width + 24);
        const y = baseY + row * (height + 24);
        if (x + width > rightEdge - 12) x = visibleLeft + 24 + column * (width + 24);
        if (x + width > rightEdge - 12) continue;
        if (y + height > bottomEdge - 12) continue;
        const candidate = { x, y, width, height };
        if (!occupied.some((item) => rectanglesOverlap(candidate, item))) return { x, y };
      }
    }
    return { x: visibleLeft + 24, y: visibleTop + 24 };
  }, [getPageDevicePreset, pan.x, pan.y, pages, positions, tags, zoom]);

  const addTag = () => {
    const id = onCreateTag?.(getNewTagPosition());
    if (id) setSelectedTagId(id);
  };

  if (pages.length === 0 && tags.length === 0) {
    return <div className="empty-state empty-state--canvas"><Scan size={25} aria-hidden="true" /><h2>Canvas is ready</h2><p>Generate a page from the Codex project. It will appear here automatically.</p><button type="button" className="secondary-button canvas-empty-add-tag" onClick={addTag}><TagIcon size={16} aria-hidden="true" /> Add Tag</button></div>;
  }

  const viewportStyle = {
    "--canvas-grid-dot-color": canvasGridDotColor(zoom),
    "--canvas-grid-zoom": String(zoom),
    "--canvas-grid-size": `${Number((CANVAS_GRID_SIZE * zoom).toFixed(3))}px`,
    "--canvas-grid-x": `${pan.x}px`,
    "--canvas-grid-y": `${pan.y}px`,
  } as CSSProperties;

  return (
    <div className="canvas-shell">
      <div className="canvas-toolbar" role="toolbar" aria-label="Canvas controls">
        <button type="button" className="canvas-toolbar__add-tag" onClick={addTag}><Add size={16} strokeWidth={2.25} aria-hidden="true" /><span>Add Tag</span></button>
        <span className="canvas-toolbar__divider" />
        <button type="button" className="icon-button" onClick={() => changeZoom(-0.1)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={16} strokeWidth={2.25} aria-hidden="true" /></button>
        <span className="canvas-toolbar__zoom" aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-button" onClick={() => changeZoom(0.1)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={16} strokeWidth={2.25} aria-hidden="true" /></button>
        <span className="canvas-toolbar__divider" />
        <button type="button" className="icon-button" onClick={fitAll} aria-label="Fit all pages" title="Fit all pages"><Focus size={16} strokeWidth={2.25} aria-hidden="true" /></button>
      </div>
      <div ref={viewportRef} style={viewportStyle} className={`canvas-viewport${dragState ? " is-dragging-card" : ""}${panState ? " is-panning" : ""}`} onPointerDown={beginPan} onPointerMove={handlePointerMove} onPointerUp={endPointerAction} onPointerCancel={cancelPointerAction} onWheel={handleWheel}>
        <div className="canvas-space" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
          <div className="canvas-grid-layer" aria-hidden="true" />
          {snapGuides.vertical !== undefined ? <div className="canvas-guide canvas-guide--vertical" style={{ left: snapGuides.vertical }} aria-hidden="true" /> : null}
          {snapGuides.horizontal !== undefined ? <div className="canvas-guide canvas-guide--horizontal" style={{ top: snapGuides.horizontal }} aria-hidden="true" /> : null}
          {tags.map((tag) => <CanvasTag key={tag.id} tag={tag} zoom={zoom} selected={selectedTagId === tag.id} otherBoards={boards.filter((board) => board.id !== activeBoardId)} onMove={onMoveTag} onDelete={onDeleteTag} onCopy={onCopyTag} onSnapPosition={getSnappedPosition} onSnapSize={getSnappedSize} onSnapGuidesChange={setSnapGuides} onSelect={(id) => { setSelectedTagId(id); onClearSelection?.(); }} onChange={onUpdateTag ?? (() => undefined)} />)}
          {pages.map((page) => {
            const position = positions[page.id] ?? { x: 0, y: 0 };
            const device = getPageDevicePreset(page.id);
            const overlayScale = 1 / Math.max(1, zoom);
            const pageStyle = {
              left: position.x,
              top: position.y,
              width: device.width,
              height: device.height,
              // Keep the selected page's chrome above every neighboring page,
              // including titles and open device menus from nearby frames.
              zIndex: selectedPageId === page.id ? 100 : undefined,
              "--device-width": `${device.width}px`,
              "--device-height": `${device.height}px`,
              "--canvas-zoom": String(zoom),
              "--canvas-chrome-scale": String(Number((1 / zoom).toFixed(5))),
              "--canvas-overlay-scale": String(Number(overlayScale.toFixed(5))),
              "--canvas-card-chrome-gap": `${Number((8 * overlayScale).toFixed(3))}px`,
              "--canvas-preview-chrome-gap": `${Number((10 * overlayScale).toFixed(3))}px`,
              "--canvas-selection-ring": `${Number((2 * overlayScale).toFixed(3))}px`,
              "--canvas-page-title-gap": `${Number((CANVAS_PAGE_TITLE_GAP / zoom).toFixed(3))}px`,
              "--canvas-page-title-height": `${Number((CANVAS_PAGE_TITLE_HEIGHT / zoom).toFixed(3))}px`,
              "--canvas-toolbar-gap": `${Number((CANVAS_TOOLBAR_GAP / zoom).toFixed(3))}px`,
              "--canvas-toolbar-enter-y": `${Number((4 / zoom).toFixed(3))}px`,
              "--canvas-toolbar-shift-x": `${toolbarShifts[page.id] ?? 0}px`,
              "--canvas-toolbar-max-width": toolbarMaxWidth == null ? undefined : `${toolbarMaxWidth}px`,
            } as CSSProperties;
            return (
              <div key={page.id} data-canvas-page-id={page.id} className={`canvas-page${page.source.type === "html" ? " canvas-page--annotatable" : ""}`} style={pageStyle} onPointerDown={(event) => beginCardDrag(event, page)}>
                <PageName page={page} onSelectPage={onSelectPage} />
                <PageCard
                  page={page}
                  canvas
                  deviceFrame={device}
                  onDeviceFrameChange={handleDeviceFrameChange}
                  boards={boards}
                  activeBoardId={activeBoardId}
                  selected={selectedPageId === page.id}
                  onSelectPage={onSelectPage}
                  onEditPage={onEditPage}
                  onDeletePage={onDeletePage}
                  onMovePage={onMovePage}
                  onCopyPageToFigma={onCopyPageToFigma}
                />
              </div>
            );
          })}
        </div>
      </div>
      {minimapVisible ? <CanvasMinimap
        items={canvasItems.map((item) => ({ ...item, kind: pages.some((page) => page.id === item.id) ? "page" as const : "tag" as const }))}
        selectedPageId={selectedPageId}
        pan={pan}
        zoom={zoom}
        viewport={{ width: toolbarMeasurements.viewportWidth, height: toolbarMeasurements.viewportHeight, top: toolbarMeasurements.safeTop, right: toolbarMeasurements.safeRight, bottom: toolbarMeasurements.safeBottom, left: toolbarMeasurements.safeLeft }}
      /> : null}
    </div>
  );
}
