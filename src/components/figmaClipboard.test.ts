import { afterEach, describe, expect, it, vi } from "vitest";
import { captureHtmlPage } from "../figma/capture";
import { parseFigmaHtml } from "../figma/h2d";
import { createSeedState } from "../test/fixtures";
import { copyPageToFigmaClipboard, writeRichClipboard } from "./figmaClipboard";

vi.mock("../figma/capture", () => ({ captureHtmlPage: vi.fn() }));

const htmlPage = () => createSeedState().pagesById["page-demo-welcome"];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Figma browser extension bridge", () => {
  it("writes H2D HTML and never uses writeText", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const writeText = vi.fn();
    class MockClipboardItem {
      constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {}
    }
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, writeText } });
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.mocked(captureHtmlPage).mockResolvedValue({
        version: 1,
        pageId: "page-demo-welcome",
        title: "Welcome concept",
        viewport: { width: 430, height: 600 },
        devicePixelRatio: 1,
        root: { id: "root", type: "frame", rect: { x: 0, y: 0, width: 430, height: 600 }, opacity: 1, radius: [0, 0, 0, 0], margin: [0, 0, 0, 0], layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" }, children: [] },
        assets: [],
        fonts: [],
        diagnostics: [],
      });

    await copyPageToFigmaClipboard(htmlPage());

    // The successful write carries a concrete HTML Blob, matching Figma's
    // Figma-compatible HTML export path.
    expect(write).toHaveBeenCalledTimes(1);
    expect(writeText).not.toHaveBeenCalled();
    const item = write.mock.calls[0][0][0] as MockClipboardItem;
    const htmlPayload = await item.items["text/html"] as Blob;
    expect(htmlPayload).toBeInstanceOf(Blob);
    expect(htmlPayload.type).toBe("text/html");
    expect(htmlPayload.size).toBeGreaterThan(0);
    const htmlText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(htmlPayload);
    });
    expect(htmlText).toContain('<span data-metadata="<!--(figmeta)');
    expect(htmlText).toContain('<span data-h2d="<!--(figh2d)');
    expect(htmlText).not.toContain("data-buffer");
    expect(htmlText).not.toContain("&lt;!--(figmeta)");
    expect(Object.keys(item.items)).toEqual(["text/html", "text/plain"]);
    const plainPayload = item.items["text/plain"] as Blob;
    expect(plainPayload).toBeInstanceOf(Blob);
    expect(plainPayload.type).toBe("text/plain");
    expect(plainPayload.size).toBe(0);
  });

  it("carries inherited line-height through the real copy entry point", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem {
      constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {}
    }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.mocked(captureHtmlPage).mockResolvedValue({
      version: 1,
      pageId: "page-line-height",
      title: "Inherited leading",
      viewport: { width: 320, height: 240 },
      devicePixelRatio: 1,
      root: {
        id: "root",
        type: "frame",
        rect: { x: 0, y: 0, width: 320, height: 240 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        computedStyles: { display: "block", lineHeight: "28px", fontSize: "18px" },
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
        children: [{
          id: "copy-text-wrapper",
          sourceTag: "DIV",
          type: "frame",
          rect: { x: 16, y: 16, width: 240, height: 56 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          computedStyles: { display: "block", lineHeight: "28px", fontSize: "18px" },
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
          children: [{
            id: "copy-text-run",
            sourceTag: "#text",
            type: "text",
            rect: { x: 0, y: 0, width: 220, height: 56 },
            opacity: 1,
            radius: [0, 0, 0, 0],
            margin: [0, 0, 0, 0],
            layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
            text: {
              content: "First line\nSecond line",
              fontFamily: "Inter",
              fontSize: 16,
              fontWeight: 400,
              lineHeight: 28,
              letterSpacing: 0,
              textAlign: "left",
            },
            children: [],
          }],
        }],
      },
      assets: [],
      fonts: [],
      diagnostics: [],
    });

    await copyPageToFigmaClipboard(htmlPage());

    const item = write.mock.calls[0][0][0] as MockClipboardItem;
    const payload = await item.items["text/html"] as Blob;
    const html = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(payload);
    });
    const parsed = parseFigmaHtml(html).h2d;
    const wrapper = parsed.root.childNodes[0];
    expect(wrapper.nodeType).toBe(1);
    if (wrapper.nodeType !== 1) return;
    expect(wrapper.styles).toMatchObject({ lineHeight: "28px", "line-height": "28px" });
    expect(wrapper.childNodes[0]).toMatchObject({
      nodeType: 1,
      attributes: { "data-open-canvas-line-height": "28px" },
    });
  });

  it("keeps explicit line-height wrappers in the plugin bridge payload", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: vi.fn() } });
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1", port: "5200" } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"ok":true,"pairingCode":"${"c".repeat(32)}"}`, { status: 200 })));
    vi.mocked(captureHtmlPage).mockResolvedValue({
      version: 1,
      pageId: "page-plugin-line-height",
      title: "Plugin inherited leading",
      viewport: { width: 320, height: 240 },
      devicePixelRatio: 1,
      root: {
        id: "root",
        type: "frame",
        rect: { x: 0, y: 0, width: 320, height: 240 },
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        computedStyles: { display: "block", lineHeight: "28px", fontSize: "18px" },
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
        children: [{
          id: "plugin-line-height-wrapper",
          sourceTag: "DIV",
          type: "frame",
          rect: { x: 16, y: 16, width: 240, height: 56 },
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          computedStyles: { display: "block", lineHeight: "28px", fontSize: "18px" },
          layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
          children: [{
            id: "plugin-line-height-run",
            sourceTag: "#text",
            type: "text",
            rect: { x: 0, y: 0, width: 220, height: 56 },
            opacity: 1,
            radius: [0, 0, 0, 0],
            margin: [0, 0, 0, 0],
            layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
            text: { content: "First\nSecond", fontFamily: "Inter", fontSize: 16, fontWeight: 400, lineHeight: 28, letterSpacing: 0, textAlign: "left" },
            children: [],
          }],
        }],
      },
      assets: [],
      fonts: [],
      diagnostics: [],
    });

    await copyPageToFigmaClipboard(htmlPage());

    const request = vi.mocked(fetch).mock.calls[0][1];
    const payload = JSON.parse(String(request?.body)) as { pluginHtml: string };
    const parsed = parseFigmaHtml(payload.pluginHtml).h2d;
    const wrapper = parsed.root.childNodes[0];
    expect(wrapper.nodeType).toBe(1);
    if (wrapper.nodeType !== 1) return;
    expect(wrapper.childNodes[0]).toMatchObject({
      nodeType: 1,
      attributes: { "data-open-canvas-line-height": "28px" },
    });
  });

  it("falls back to the legacy HTML selection bridge", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });
    const execCommand = vi.spyOn(document, "execCommand");
    await writeRichClipboard("<strong>layers</strong>");
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("keeps the async rich write path from an embedded document", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });
    const execCommand = vi.spyOn(document, "execCommand");
    const top = window.top;
    Object.defineProperty(window, "top", { configurable: true, value: {} });

    try {
      await writeRichClipboard("<span data-buffer=\"marker\"></span>");
      expect(write).toHaveBeenCalledTimes(1);
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "top", { configurable: true, value: top });
    }
  });

  it("prefers the system HTML bridge when the Vite annotation marker is present", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });
    const execCommand = vi.spyOn(document, "execCommand");
    const marker = document.createElement("meta");
    marker.name = "codex-annotation-server";
    marker.content = "1";
    document.head.append(marker);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"ok":true,"pairingCode":"${"a".repeat(32)}"}`, { status: 200 })));

    try {
      await writeRichClipboard("<span data-buffer=\"marker\"></span>");
      expect(fetch).toHaveBeenCalledWith("/__codex_clipboard__", expect.objectContaining({ method: "POST" }));
      expect(write).not.toHaveBeenCalled();
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      marker.remove();
    }
  });

  it("prefers the system HTML bridge on the normal localhost app route", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"ok":true,"pairingCode":"${"a".repeat(32)}"}`, { status: 200 })));
    vi.stubGlobal("window", { location: { hostname: "localhost", port: "5183" } });
    await writeRichClipboard("<span data-h2d=\"marker\"></span>");

    expect(fetch).toHaveBeenCalledWith("/__codex_clipboard__", expect.objectContaining({ method: "POST" }));
    expect(write).not.toHaveBeenCalled();
  });

  it("keeps the system HTML bridge on alternate Canvas ports", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: vi.fn() } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"ok":true,"pairingCode":"${"b".repeat(32)}"}`, { status: 200 })));
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1", port: "5200" } });

    await writeRichClipboard("<span data-h2d=\"alternate-port\"></span>", "<span data-open-canvas-scene=\"alternate-port\"></span>");

    expect(fetch).toHaveBeenCalledWith("/__codex_clipboard__", expect.objectContaining({ method: "POST" }));
    expect(navigator.clipboard.write).not.toHaveBeenCalled();
  });

  it("keeps the system HTML bridge on dynamically assigned loopback ports", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: vi.fn() } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"ok":true,"pairingCode":"${"d".repeat(32)}"}`, { status: 200 })));
    vi.stubGlobal("window", { location: { hostname: "localhost", port: "5217" } });
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);

    try {
      await writeRichClipboard("<span data-h2d=\"dynamic-port\"></span>", "<span data-open-canvas-scene=\"dynamic-port\"></span>");

      expect(fetch).toHaveBeenCalledWith("/__codex_clipboard__", expect.objectContaining({ method: "POST" }));
      expect(navigator.clipboard.write).not.toHaveBeenCalled();
    } finally {
      root.remove();
    }
  });

  it("includes a custom Canvas port in the copied pairing transport value", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: vi.fn() } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"ok":true,"pairingCode":"${"e".repeat(32)}"}`, { status: 200 })));
    vi.stubGlobal("window", { location: { hostname: "127.0.0.1", port: "5217" } });
    const root = document.createElement("div");
    root.id = "root";
    document.body.append(root);

    try {
      await expect(writeRichClipboard(
        "<span data-h2d=\"custom-port\"></span>",
        "<span data-open-canvas-scene=\"custom-port\"></span>",
      )).resolves.toBe(`${"e".repeat(32)}@5217`);
    } finally {
      root.remove();
    }
  });

  it("keeps the native clipboard payload separate from the plugin scene payload", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: vi.fn() } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"ok":true,"pairingCode":"${"a".repeat(32)}"}`, { status: 200 })));
    vi.stubGlobal("window", { location: { hostname: "localhost", port: "5183" } });

    expect(await writeRichClipboard("<span data-h2d=\"official\"></span>", "<span data-neuxmind-scene=\"enhanced\"></span>")).toBe("a".repeat(32));

    const request = vi.mocked(fetch).mock.calls[0][1];
    expect(request?.headers).toEqual({ "Content-Type": "application/json; charset=utf-8" });
    expect(JSON.parse(String(request?.body))).toEqual({
      clipboardHtml: "<span data-h2d=\"official\"></span>",
      pluginHtml: "<span data-neuxmind-scene=\"enhanced\"></span>",
    });
  });

  it("uses the system HTML bridge even when the embedded browser reports a regular Chrome UA", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write: vi.fn() } });
    const originalUserAgent = navigator.userAgent;
    Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 Chrome/140 Safari/537.36" });
    vi.stubGlobal("ClipboardItem", class MockClipboardItem {});
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });
    const execCommand = vi.spyOn(document, "execCommand");
    const marker = document.createElement("meta");
    marker.name = "codex-annotation-server";
    document.head.append(marker);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(`{"ok":true,"pairingCode":"${"a".repeat(32)}"}`, { status: 200 })));

    try {
      await writeRichClipboard("<span data-buffer=\"marker\"></span>");
      expect(fetch).toHaveBeenCalledWith("/__codex_clipboard__", expect.objectContaining({ method: "POST" }));
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      marker.remove();
      Object.defineProperty(navigator, "userAgent", { configurable: true, value: originalUserAgent });
    }
  });

  it("falls back to ClipboardItem when the local system bridge is unavailable", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });
    const execCommand = vi.spyOn(document, "execCommand");
    const marker = document.createElement("meta");
    marker.name = "codex-annotation-server";
    marker.content = "1";
    document.head.append(marker);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("bridge unavailable")));

    try {
    await expect(writeRichClipboard("<span data-buffer=\"marker\"></span>")).resolves.toBeUndefined();
      expect(write).toHaveBeenCalledTimes(1);
      expect(execCommand).not.toHaveBeenCalled();
    } finally {
      marker.remove();
    }
  });

  it("falls back when ClipboardItem permission is denied", async () => {
    const write = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });
    const execCommand = vi.spyOn(document, "execCommand");
    await writeRichClipboard("<strong>layers</strong>");
    expect(write).toHaveBeenCalledTimes(1);
    expect(execCommand).toHaveBeenCalledWith("copy");
  });

  it("does not read or overwrite a successful HTML clipboard write", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn();
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, read } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });
    const execCommand = vi.spyOn(document, "execCommand");

    await writeRichClipboard("<strong>layers</strong>");

    expect(write).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("starts an asynchronous HTML write without losing user activation", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    let resolveHtml!: (value: string) => void;
    const pendingHtml = new Promise<string>((resolve) => { resolveHtml = resolve; });

    const writePromise = writeRichClipboard(pendingHtml);
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as MockClipboardItem;
    expect(item.items["text/html"]).toBeInstanceOf(Promise);
    resolveHtml("<span data-buffer=\"marker\"></span>");
    await writePromise;
    const htmlBlob = await item.items["text/html"] as Blob;
    const htmlText = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(htmlBlob);
    });
    expect(htmlText).toContain("data-buffer");
  });

  it("does not reject a successful rich write when clipboard read permission is unavailable", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockRejectedValue(new DOMException("permission denied", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, read } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);

    await expect(writeRichClipboard("<strong>layers</strong>")).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("does not report success when both clipboard representations are unavailable", async () => {
    const write = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });

    await expect(writeRichClipboard("<strong>layers</strong>"))
      .rejects.toMatchObject({ code: "clipboard-unavailable" });
  });

  it("propagates a failed asynchronous capture instead of leaving the write pending", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);

    const captureError = new Error("capture failed");
    await expect(writeRichClipboard(Promise.reject(captureError))).rejects.toBe(captureError);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("keeps a capture failure visible when the rich write also falls back", async () => {
    const write = vi.fn().mockRejectedValue(new Error("permission denied"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(true) });

    const captureError = new Error("capture failed");
    await expect(writeRichClipboard(Promise.reject(captureError))).rejects.toBe(captureError);
  });

  it("does not downgrade a successful write when clipboard read is denied", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const read = vi.fn().mockRejectedValue(new DOMException("permission denied", "NotAllowedError"));
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { write, read } });
    class MockClipboardItem { constructor(public readonly items: Record<string, Blob>) {} }
    vi.stubGlobal("ClipboardItem", MockClipboardItem);
    Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn().mockReturnValue(false) });

    await expect(writeRichClipboard("<strong>layers</strong>")).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("rejects URL pages with an official Capture page instruction", async () => {
    const page = createSeedState().pagesById["page-demo-example"];
    await expect(copyPageToFigmaClipboard(page)).rejects.toMatchObject({ code: "url-source" });
  });
});
