import type { CSSProperties } from "react";

interface MinimapItem {
  id: string;
  kind: "page" | "tag";
  x: number;
  y: number;
  width: number;
  height: number;
}

interface CanvasMinimapProps {
  items: MinimapItem[];
  selectedPageId?: string | null;
  pan: { x: number; y: number };
  zoom: number;
  viewport: { width: number; height: number; top: number; right: number; bottom: number; left: number };
}

const MAP_WIDTH = 204;
const MAP_HEIGHT = 128;
const MAP_PADDING = 10;

export function CanvasMinimap({ items, selectedPageId, pan, zoom, viewport }: CanvasMinimapProps) {
  if (viewport.width <= 0 || viewport.height <= 0 || items.length === 0) return null;

  const visible = {
    x: (viewport.left - pan.x) / zoom,
    y: (viewport.top - pan.y) / zoom,
    width: Math.max(1, viewport.width - viewport.left - viewport.right) / zoom,
    height: Math.max(1, viewport.height - viewport.top - viewport.bottom) / zoom,
  };
  const minX = Math.min(visible.x, ...items.map((item) => item.x));
  const minY = Math.min(visible.y, ...items.map((item) => item.y));
  const maxX = Math.max(visible.x + visible.width, ...items.map((item) => item.x + item.width));
  const maxY = Math.max(visible.y + visible.height, ...items.map((item) => item.y + item.height));
  const scale = Math.min(
    (MAP_WIDTH - MAP_PADDING * 2) / Math.max(maxX - minX, 1),
    (MAP_HEIGHT - MAP_PADDING * 2) / Math.max(maxY - minY, 1),
  );
  const offsetX = (MAP_WIDTH - (maxX - minX) * scale) / 2;
  const offsetY = (MAP_HEIGHT - (maxY - minY) * scale) / 2;
  const rectStyle = (rect: { x: number; y: number; width: number; height: number }): CSSProperties => ({
    left: offsetX + (rect.x - minX) * scale,
    top: offsetY + (rect.y - minY) * scale,
    width: rect.width * scale,
    height: rect.height * scale,
  });

  return (
    <div className="canvas-minimap" aria-label="Canvas overview">
      <div className="canvas-minimap__surface">
        {items.map((item) => (
          <div
            key={item.id}
            className={`canvas-minimap__item canvas-minimap__item--${item.kind}${item.id === selectedPageId ? " is-selected" : ""}`}
            style={rectStyle(item)}
            aria-hidden="true"
          />
        ))}
        <div className="canvas-minimap__viewport" style={rectStyle(visible)} aria-label="Visible area" />
      </div>
    </div>
  );
}
