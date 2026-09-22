import { closestCenter, DndContext, DragEndEvent, DragOverlay, DragStartEvent, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { LayoutGrid } from "./huge-icons";
import type { Board, Page } from "../domain/model";
import { PageCard, PageName } from "./PageCard";
import type { PageActionProps } from "./types";
import { useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent } from "react";
import { isAnnotationPickerActive } from "./annotationInteraction";

export interface GridViewProps extends PageActionProps {
  pages: Page[];
  boards?: Board[];
  activeBoardId?: string;
  selectedPageId?: string | null;
  onReorderPage?: (pageId: string, targetIndex: number) => void;
  onClearSelection?: () => void;
}

interface BlankPointerGesture {
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

const BLANK_CLICK_THRESHOLD = 4;

export function GridView({
  pages,
  boards = [],
  activeBoardId,
  selectedPageId,
  onSelectPage,
  onEditPage,
  onDeletePage,
  onMovePage,
  onReorderPage,
  onClearSelection,
}: GridViewProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const blankPointerRef = useRef<BlankPointerGesture | null>(null);
  const activePage = activeId ? pages.find((page) => page.id === activeId) : undefined;

  const handleDragStart = ({ active }: DragStartEvent) => setActiveId(String(active.id));
  const handleDragCancel = () => setActiveId(null);
  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null);
    if (!over || active.id === over.id || !onReorderPage) return;
    const oldIndex = pages.findIndex((page) => page.id === active.id);
    const newIndex = pages.findIndex((page) => page.id === over.id);
    if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) return;
    // Keep the callback small and reducer-friendly; the parent owns the array.
    const reordered = arrayMove(pages, oldIndex, newIndex);
    const targetIndex = reordered.findIndex((page) => page.id === active.id);
    onReorderPage(String(active.id), targetIndex);
  };
  const handleBlankPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (
      event.button !== 0
      || event.target !== event.currentTarget
      || isAnnotationPickerActive(event.currentTarget.ownerDocument)
    ) return;
    blankPointerRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  };
  const handleBlankPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = blankPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId || gesture.moved) return;
    if (Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > BLANK_CLICK_THRESHOLD) {
      gesture.moved = true;
    }
  };
  const handleBlankPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const gesture = blankPointerRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    blankPointerRef.current = null;
    const finalDistance = Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y);
    if (
      !gesture.moved
      && finalDistance <= BLANK_CLICK_THRESHOLD
      && event.target === event.currentTarget
    ) onClearSelection?.();
  };
  const handleBlankPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    if (blankPointerRef.current?.pointerId === event.pointerId) blankPointerRef.current = null;
  };

  if (pages.length === 0) {
    return <GridEmptyState />;
  }

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragCancel={handleDragCancel} onDragEnd={handleDragEnd}>
      <SortableContext items={pages.map((page) => page.id)} strategy={rectSortingStrategy}>
        <div
          className="page-grid"
          role="list"
          aria-label="Pages in this board"
          onPointerDown={handleBlankPointerDown}
          onPointerMove={handleBlankPointerMove}
          onPointerUp={handleBlankPointerUp}
          onPointerCancel={handleBlankPointerCancel}
        >
          {pages.map((page, index) => (
            <SortableCard
              key={page.id}
              page={page}
              targetIndex={index}
              boards={boards}
              activeBoardId={activeBoardId}
              selected={selectedPageId === page.id}
              onSelectPage={onSelectPage}
              onEditPage={onEditPage}
              onDeletePage={onDeletePage}
              onMovePage={onMovePage}
              onReorderPage={onReorderPage}
            />
          ))}
        </div>
      </SortableContext>
      <DragOverlay dropAnimation={null}>
        {activePage ? (
          <div className="sortable-card sortable-card--overlay">
            <PageName page={activePage} />
            <PageCard page={activePage} boards={boards} activeBoardId={activeBoardId} isDragging />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

interface SortableCardProps extends PageActionProps {
  page: Page;
  targetIndex: number;
  onReorderPage?: (pageId: string, targetIndex: number) => void;
  boards?: Board[];
  activeBoardId?: string;
  selected?: boolean;
}

function SortableCard({ page, targetIndex, onReorderPage, ...props }: SortableCardProps) {
  const sortable = useSortable({ id: page.id });
  const style = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
    zIndex: sortable.isDragging ? 2 : undefined,
  };
  const handleNativeDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer.types);
    if (!types.includes("application/x-ai-board-page") && !types.includes("text/plain")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  };
  const handleNativeDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const draggedId = event.dataTransfer.getData("application/x-ai-board-page") || event.dataTransfer.getData("text/plain");
    if (!draggedId || draggedId === page.id) return;
    onReorderPage?.(draggedId, targetIndex);
  };
  return (
    <div
      ref={sortable.setNodeRef}
      style={style}
      className={`sortable-card${page.source.type === "html" ? " sortable-card--annotatable" : ""}${sortable.isDragging ? " is-dragging" : ""}`}
      role="listitem"
      onDragOver={handleNativeDragOver}
      onDrop={handleNativeDrop}
    >
      <PageName page={page} onSelectPage={props.onSelectPage} />
      <PageCard
        {...props}
        page={page}
        selected={props.selected}
        isDragging={sortable.isDragging}
        dragHandleProps={{ ...sortable.attributes, ...sortable.listeners }}
      />
    </div>
  );
}

function GridEmptyState() {
  return (
    <div className="empty-state">
      <div className="empty-state__icon"><LayoutGrid size={21} aria-hidden="true" /></div>
      <h2>No pages yet</h2>
      <p>Generate a page from the Codex project. It will appear here automatically.</p>
    </div>
  );
}
