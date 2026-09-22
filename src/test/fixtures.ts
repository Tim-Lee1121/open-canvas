import {
  STATE_SCHEMA_VERSION,
  getDefaultCanvasPosition,
  type AppState,
  type Board,
  type Page,
} from "../domain/model";

const DEMO_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mobile welcome</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#f5f7fb;color:#172033}main{min-height:100vh;padding:32px;box-sizing:border-box;display:flex;flex-direction:column;justify-content:center}h1{font-size:32px;line-height:1.1;margin:0 0 12px}p{color:#5e6b82;line-height:1.5}button{border:0;border-radius:12px;background:#2457d6;color:#fff;padding:14px 18px;font-weight:650}</style></head>
<body><main><small>GENERATED CONCEPT</small><h1>Make space for better ideas.</h1><p>A calm starting point for your next mobile experience.</p><button>Get started</button></main></body></html>`;

/** Representative board data used only by automated tests. */
export function createSeedState(): AppState {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const boardOneId = "board-demo-explorations";
  const boardTwoId = "board-demo-review";
  const pageOneId = "page-demo-welcome";
  const pageTwoId = "page-demo-example";
  const pageThreeId = "page-demo-checkout";

  const boards: Board[] = [
    {
      id: boardOneId,
      name: "Explorations",
      pageIds: [pageOneId, pageTwoId],
      layoutMode: "grid",
      createdAt,
      updatedAt: createdAt,
    },
    {
      id: boardTwoId,
      name: "Review queue",
      pageIds: [pageThreeId],
      layoutMode: "canvas",
      createdAt,
      updatedAt: createdAt,
    },
  ];

  const pagesById: Record<string, Page> = {
    [pageOneId]: {
      id: pageOneId,
      boardId: boardOneId,
      title: "Welcome concept",
      source: { type: "html", value: DEMO_HTML },
      canvasPosition: getDefaultCanvasPosition(0),
      createdAt,
      updatedAt: createdAt,
    },
    [pageTwoId]: {
      id: pageTwoId,
      boardId: boardOneId,
      title: "Reference website",
      source: { type: "url", value: "https://www.example.com/" },
      canvasPosition: getDefaultCanvasPosition(1),
      createdAt,
      updatedAt: createdAt,
    },
    [pageThreeId]: {
      id: pageThreeId,
      boardId: boardTwoId,
      title: "Checkout flow",
      source: {
        type: "html",
        value: `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;padding:24px;color:#172033}h1{font-size:26px}label{display:block;margin-top:18px;font-size:13px;color:#657189}input{box-sizing:border-box;width:100%;margin-top:6px;padding:13px;border:1px solid #ccd3df;border-radius:10px}</style></head><body><h1>Complete purchase</h1><label>Card number<input placeholder="1234 5678 9012 3456"></label><label>Expiry<input placeholder="MM / YY"></label></body></html>`,
      },
      canvasPosition: getDefaultCanvasPosition(0),
      createdAt,
      updatedAt: createdAt,
    },
  };

  return {
    schemaVersion: STATE_SCHEMA_VERSION,
    boards,
    pagesById,
    activeBoardId: boardOneId,
    selectedPageId: pageOneId,
  };
}
