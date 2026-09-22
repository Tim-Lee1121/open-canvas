import type { Page } from "../domain/model";
import type { DeviceFrame } from "./device-presets";
import { captureHtmlPage } from "../figma/capture";
import { buildFigmaHtml, wrapFigmaClipboardHtml } from "../figma/h2d";

export class FigmaExportError extends Error {
  readonly code: "url-source" | "capture-failed" | "clipboard-unavailable";

  constructor(code: FigmaExportError["code"], message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "FigmaExportError";
    this.code = code;
  }
}

type ClipboardHtml = string | Promise<string>;

const CLIPBOARD_WRITE_TIMEOUT_MS = 12_000;

async function resolveClipboardHtml(html: ClipboardHtml): Promise<string> {
  return typeof html === "string" ? html : html;
}

function requiresSystemClipboardBridge(): boolean {
  if (typeof document === "undefined") return false;
  // The in-app browser can expose a normal Chrome UA while still isolating
  // navigator.clipboard from the macOS pasteboard used by Figma Desktop. The
  // dev server owns a system clipboard endpoint on localhost, so prefer it for
  // every local Canvas page. The annotation marker remains a useful signal for
  // embedded previews, but it must not be required on the normal app route.
  if (typeof window === "undefined") return false;
  const localHost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
  const isCanvasDevServer = window.location.port === "5183";
  return localHost && (isCanvasDevServer || Boolean(document.querySelector('meta[name="codex-annotation-server"]')));
}

async function copyHtmlThroughLocalBridge(html: string, pluginHtml: string): Promise<string | null> {
  if (typeof window === "undefined" || typeof fetch !== "function") return null;
  if (!(window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost")) return null;
  try {
    const response = await fetch("/__codex_clipboard__", {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ clipboardHtml: html, pluginHtml }),
      credentials: "same-origin",
    });
    if (!response.ok) return null;
    const result = await response.json() as { pairingCode?: string };
    return result.pairingCode && /^[0-9a-f]{32}$/.test(result.pairingCode) ? result.pairingCode : null;
  } catch {
    return null;
  }
}

async function copyHtmlWithExecCommand(html: string): Promise<boolean> {
  if (typeof document === "undefined" || typeof document.execCommand !== "function") return false;
  const onCopy = (event: Event) => {
    const clipboardData = (event as ClipboardEvent).clipboardData;
    // The selection bridge lets Chromium perform its normal HTML clipboard
    // normalization. Keep the H2D marker comments intact when explicitly
    // supplying the rich flavor; Figma's extension contract uses the raw
    // `<!--(figmeta)...-->` and `<!--(figh2d)...-->` comments.
    clipboardData?.setData("text/html", html);
    event.preventDefault();
  };
  document.addEventListener("copy", onCopy);
  const holder = document.createElement("div");
  holder.contentEditable = "true";
  holder.setAttribute("aria-hidden", "true");
  holder.style.cssText = "position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;";
  holder.innerHTML = html;
  // H2D markers are intentionally comment-only. An empty selection makes
  // execCommand("copy") return false in Chromium, so keep one invisible
  // selectable character in the holder while the copy event supplies the
  // real HTML flavor.
  holder.append(document.createTextNode("\u200b"));
  (document.body ?? document.documentElement).append(holder);
  holder.focus();
  const selection = document.getSelection();
  const range = document.createRange();
  range.selectNodeContents(holder);
  selection?.removeAllRanges();
  selection?.addRange(range);
  try {
    return document.execCommand("copy");
  } finally {
    document.removeEventListener("copy", onCopy);
    selection?.removeAllRanges();
    holder.remove();
  }
}

async function writeRichClipboard(html: ClipboardHtml, pluginHtml: ClipboardHtml = html): Promise<string | undefined> {
  if (requiresSystemClipboardBridge()) {
    const [resolvedHtml, resolvedPluginHtml] = await Promise.all([
      resolveClipboardHtml(html),
      resolveClipboardHtml(pluginHtml),
    ]);
    const pairingCode = await copyHtmlThroughLocalBridge(resolvedHtml, resolvedPluginHtml);
    if (pairingCode) return pairingCode;
    // A browser may expose the local marker while the dev server is being
    // restarted or when running on a non-macOS host. Continue through the
    // normal rich clipboard path instead of treating the bridge as exclusive.
    html = resolvedHtml;
  }

  // Keep ClipboardItem as the first attempt in every browser context.
  // The capture is asynchronous, so the item carries a Promise<Blob> and the
  // write itself starts during the button's user-activation task. Skipping
  // this path in an iframe forces execCommand after capture has completed,
  // which loses activation and silently produces no rich clipboard payload.
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
  const ClipboardItemConstructor = typeof ClipboardItem !== "undefined" ? ClipboardItem : undefined;
  let resolvedHtmlPromise: Promise<string> | undefined;
  let captureError: unknown;
  let captureSettled: Promise<void> | undefined;
  if (clipboard?.write && ClipboardItemConstructor) {
    try {
      // Start the write while the caller's click activation is still alive.
      // ClipboardItem accepts Promise<Blob> values and waits for the value
      // before committing the item. This matters because HTML capture is
      // asynchronous; waiting for capture first makes Chromium reject the
      // write with NotAllowedError even though the user clicked the button.
      resolvedHtmlPromise = resolveClipboardHtml(html).catch((error) => {
        // ClipboardItem implementations do not consistently propagate a
        // rejected Promise<Blob>; Chromium can leave write() pending forever.
        // Resolve the item with an empty payload, then surface the original
        // capture error after the write attempt has completed.
        captureError = error;
        return "";
      });
      captureSettled = resolvedHtmlPromise.then(() => undefined);
      // Do not round-trip through template.innerHTML here. ClipboardItem takes
      // the bytes verbatim, and entity-escaping the marker comments makes
      // some Figma Desktop builds treat the payload as ordinary HTML instead
      // of H2D data. The official capture extension writes the raw markers.
      const htmlValue = resolvedHtmlPromise.then((value) => new Blob([value], { type: "text/html" }));
      const item = new ClipboardItemConstructor({
        "text/html": htmlValue,
        // Chromium normally accompanies an HTML copy with a plain-text
        // flavor. Some Figma Desktop builds only dispatch their rich-paste
        // path when both standard flavors are present. Keep it empty so it
        // can never masquerade as a successful text-only export.
        "text/plain": new Blob([""], { type: "text/plain" }),
      });
      await Promise.race([
        clipboard.write([item]),
        new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("Clipboard write timed out")), CLIPBOARD_WRITE_TIMEOUT_MS)),
      ]);
      await captureSettled;
      if (captureError) throw captureError;
      return;
    } catch (error) {
      if (captureError) throw captureError;
      // Permission can be granted after a user gesture; try the legacy HTML
      // selection bridge before reporting that rich clipboard is unavailable.
      // Reuse the already-started capture rather than starting a second one.
      if (error instanceof Error && error.message === "Clipboard write timed out") {
        resolvedHtmlPromise = undefined;
      }
    }
  }

  const resolvedHtml = await (resolvedHtmlPromise ?? resolveClipboardHtml(html));
  if (captureError) throw captureError;
  if (await copyHtmlWithExecCommand(resolvedHtml)) return;
  throw new FigmaExportError("clipboard-unavailable", "Rich clipboard access is unavailable");
}

/** Capture an HTML page into Figma's editable H2D clipboard format. */
export async function copyPageToFigmaClipboard(page: Page, deviceFrame?: DeviceFrame): Promise<string | undefined> {
  if (page.source.type === "url") {
    throw new FigmaExportError("url-source", "URL pages require the official Figma Capture page flow");
  }
  // Keep the ClipboardItem write in the same user-activation task as the
  // button click. The capture itself can await fonts/images/layout, so pass a
  // lazy HTML promise instead of waiting for capture before calling write().
  const scenePromise = captureHtmlPage(page, deviceFrame)
    .catch((error) => {
      const detail = error instanceof Error && error.message ? `: ${error.message}` : "";
      throw new FigmaExportError("capture-failed", `The HTML page could not be prepared for Figma${detail}`, { cause: error });
    });
  const htmlPromise = scenePromise.then((scene) => wrapFigmaClipboardHtml(scene));
  const pluginHtmlPromise = scenePromise.then((scene) => buildFigmaHtml(scene));
  return writeRichClipboard(htmlPromise, pluginHtmlPromise);
}

export { writeRichClipboard };
