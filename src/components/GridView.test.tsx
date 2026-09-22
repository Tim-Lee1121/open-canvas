import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "../test/fixtures";
import { GridView } from "./GridView";

afterEach(cleanup);

function firePointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  init: { pointerId: number; clientX: number; clientY: number },
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    composed: true,
    button: 0,
    clientX: init.clientX,
    clientY: init.clientY,
  });
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  fireEvent(element, event);
}

describe("GridView", () => {
  it("keeps HTML preview controls exposed instead of naming the outer card", () => {
    const seed = createSeedState();
    const pages = [seed.pagesById["page-demo-welcome"]];

    render(<GridView pages={pages} boards={seed.boards} activeBoardId={pages[0].boardId} />);

    const card = document.querySelector<HTMLElement>(`[data-page-id="${pages[0].id}"]`);
    expect(card).not.toBeNull();
    expect(card).not.toHaveAttribute("role");
    expect(card).not.toHaveAttribute("aria-label");
    expect(card?.querySelector("h1")).toHaveTextContent("Make space for better ideas.");
    expect(card?.querySelector('[data-codex-annotation-surface="inline-html"] button')).toHaveTextContent("Get started");
    const pageTitle = card?.parentElement?.querySelector(':scope > .page-name[data-codex-annotation-chrome="true"]');
    expect(pageTitle).toHaveTextContent(pages[0].title);
    expect(pageTitle?.parentElement).toBe(card?.parentElement);
    expect(card?.contains(pageTitle ?? null)).toBe(false);
    expect(card?.querySelector('.page-card__header[data-codex-annotation-chrome="true"]')).toBeInTheDocument();
    expect(card?.querySelector('.page-preview__badge')).not.toBeInTheDocument();
    expect(card?.querySelector('.page-card__footer[data-codex-annotation-chrome="true"]')).not.toBeInTheDocument();
  });

  it("keeps native card dragging usable for same-board sorting", () => {
    const seed = createSeedState();
    const pages = seed.boards[0].pageIds.map((pageId) => seed.pagesById[pageId]);
    const onReorderPage = vi.fn();

    render(
      <GridView
        pages={pages}
        boards={seed.boards}
        activeBoardId={seed.boards[0].id}
        onReorderPage={onReorderPage}
      />,
    );

    // Locate the stable card boundary by its page id. The outer article has no
    // role so the browser picker cannot mistake it for generated content.
    const first = document.querySelector<HTMLElement>(`[data-page-id="${pages[0].id}"]`);
    const second = document.querySelector<HTMLElement>(`[data-page-id="${pages[1].id}"]`);
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    const target = second?.parentElement;
    expect(target).not.toBeNull();

    const dataTransfer = {
      types: ["application/x-ai-board-page", "text/plain"],
      getData: (type: string) => (type === "application/x-ai-board-page" ? pages[0].id : pages[0].id),
      setData: vi.fn(),
      dropEffect: "move",
    };

    fireEvent.dragOver(target!, { dataTransfer });
    fireEvent.drop(target!, { dataTransfer });

    expect(onReorderPage).toHaveBeenCalledWith(pages[0].id, 1);
    expect(first).toBeInTheDocument();
  });

  it("clears selection only when the grid whitespace is clicked", () => {
    const seed = createSeedState();
    const page = seed.pagesById["page-demo-welcome"];
    const onClearSelection = vi.fn();
    render(
      <GridView pages={[page]} activeBoardId={page.boardId} onClearSelection={onClearSelection} />,
    );
    const grid = document.querySelector<HTMLElement>(".page-grid")!;

    firePointer(grid, "pointerdown", { pointerId: 1, clientX: 500, clientY: 500 });
    firePointer(grid, "pointerup", { pointerId: 1, clientX: 500, clientY: 500 });
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    const card = document.querySelector<HTMLElement>("[data-page-id]")!;
    firePointer(card, "pointerdown", { pointerId: 2, clientX: 40, clientY: 40 });
    firePointer(card, "pointerup", { pointerId: 2, clientX: 40, clientY: 40 });
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    firePointer(grid, "pointerdown", { pointerId: 3, clientX: 500, clientY: 500 });
    firePointer(grid, "pointermove", { pointerId: 3, clientX: 505, clientY: 500 });
    firePointer(grid, "pointermove", { pointerId: 3, clientX: 500, clientY: 500 });
    firePointer(grid, "pointerup", { pointerId: 3, clientX: 500, clientY: 500 });
    expect(onClearSelection).toHaveBeenCalledTimes(1);

    firePointer(grid, "pointerdown", { pointerId: 4, clientX: 500, clientY: 500 });
    firePointer(grid, "pointerup", { pointerId: 4, clientX: 520, clientY: 500 });
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });
});
