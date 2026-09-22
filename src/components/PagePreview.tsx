import { ExternalLink, FileCode2, Globe2, RefreshCw } from "./huge-icons";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Page } from "../domain/model";
import { openAnnotationPreview } from "./annotation";
import {
  ANNOTATION_PROXY_KIND_ATTRIBUTE,
  buildInlineHtmlPreview,
  getAnnotationProxyTarget,
  markNativeAnnotationTargets,
} from "./inlineHtml";

const PREVIEW_TIMEOUT_MS = 8_000;
const ANNOTATION_PROXY_MIN_SCREEN_SIZE = 112;

/**
 * Keep a proxy at least 112px on screen. Canvas zoom is applied by a CSS
 * transform, so a fixed 112px CSS box would shrink below Dia's candidate
 * threshold at 80% or 45% zoom and lose to the canvas viewport.
 */
function resizeAnnotationProxy(proxy: HTMLElement, target: HTMLElement): void {
  const targetRect = target.getBoundingClientRect();
  if (targetRect.width <= 0 || targetRect.height <= 0) return;
  const scaleX = target.offsetWidth > 0 ? targetRect.width / target.offsetWidth : 1;
  const scaleY = target.offsetHeight > 0 ? targetRect.height / target.offsetHeight : 1;
  const cssWidth = Math.max(112, ANNOTATION_PROXY_MIN_SCREEN_SIZE / Math.max(scaleX, 0.01));
  const cssHeight = Math.max(112, ANNOTATION_PROXY_MIN_SCREEN_SIZE / Math.max(scaleY, 0.01));
  proxy.style.setProperty("width", `${cssWidth}px`, "important");
  proxy.style.setProperty("height", `${cssHeight}px`, "important");
  // The enlarged box only exists to satisfy the picker score. Clip its
  // painted/hit region back to the target so neighbouring controls cannot
  // steal a point that is visually inside this element.
  const targetWidth = target.offsetWidth > 0 ? target.offsetWidth : targetRect.width / Math.max(scaleX, 0.01);
  const targetHeight = target.offsetHeight > 0 ? target.offsetHeight : targetRect.height / Math.max(scaleY, 0.01);
  const clipTop = Math.max(0, (cssHeight - targetHeight) / 2);
  const clipRight = Math.max(0, (cssWidth - targetWidth) / 2);
  const clipBottom = clipTop;
  const clipLeft = clipRight;
  proxy.style.setProperty("clip-path", `inset(${clipTop}px ${clipRight}px ${clipBottom}px ${clipLeft}px)`, "important");

  if (proxy.getAttribute(ANNOTATION_PROXY_KIND_ATTRIBUTE) !== "sibling") return;

  // Void/replaced elements (input, img, select, textarea, video, ...) cannot
  // contain a child proxy. Their sibling proxy uses the nearest absolute
  // containing block; translate the target's viewport rect into that block's
  // untransformed coordinate space so canvas zoom, pan, and scrolling remain
  // aligned. Both target and proxy live under the same transformed tree.
  const offsetParent = proxy.offsetParent instanceof HTMLElement ? proxy.offsetParent : null;
  const documentElement = proxy.ownerDocument.documentElement;
  const containingBlock = offsetParent ?? documentElement;
  const containingRect = containingBlock.getBoundingClientRect();
  const scaleParentX = offsetParent && offsetParent.offsetWidth > 0
    ? containingRect.width / offsetParent.offsetWidth
    : 1;
  const scaleParentY = offsetParent && offsetParent.offsetHeight > 0
    ? containingRect.height / offsetParent.offsetHeight
    : 1;
  const safeScaleX = Math.max(scaleParentX, 0.01);
  const safeScaleY = Math.max(scaleParentY, 0.01);
  const scrollLeft = offsetParent?.scrollLeft ?? window.scrollX;
  const scrollTop = offsetParent?.scrollTop ?? window.scrollY;
  const borderLeft = offsetParent?.clientLeft ?? 0;
  const borderTop = offsetParent?.clientTop ?? 0;
  const centerX = (targetRect.left - containingRect.left) / safeScaleX
    + scrollLeft + borderLeft + targetRect.width / (2 * safeScaleX);
  const centerY = (targetRect.top - containingRect.top) / safeScaleY
    + scrollTop + borderTop + targetRect.height / (2 * safeScaleY);
  proxy.style.setProperty("left", `${centerX}px`, "important");
  proxy.style.setProperty("top", `${centerY}px`, "important");
}

export interface PagePreviewProps {
  page: Page;
  /** A compact preview is used in cards; the full variant is useful in dialogs. */
  variant?: "card" | "canvas" | "detail";
  className?: string;
  showSourceBadge?: boolean;
}

interface FrameStatus {
  key: string;
  loading: boolean;
  failed: boolean;
}

/**
 * Render a page preview. Generated HTML is sanitized into ordinary DOM so the
 * browser's Annotation mode can target its inner elements. URL sources remain
 * in an opaque sandbox because a remote document cannot be safely copied into
 * the workbench without a server-side proxy.
 */
export function PagePreview({
  page,
  variant = "card",
  className = "",
  showSourceBadge = true,
}: PagePreviewProps) {
  const previewRef = useRef<HTMLDivElement>(null);
  const sourceLabel = page.source.type === "url" ? "URL" : "HTML";
  const sourceIcon = page.source.type === "url" ? <Globe2 size={12} aria-hidden="true" /> : <FileCode2 size={12} aria-hidden="true" />;
  const isHtmlSource = page.source.type === "html";
  const inlineHtml = useMemo(
    // The board preview is already a same-document surface. Let Codex sample
    // the authored generated nodes directly; enlarged proxy boxes can mask a
    // nearby card wrapper in browsers whose site annotation API is disabled.
    () => isHtmlSource ? buildInlineHtmlPreview(page.source.value, page.id, {
      includeHitProxies: false,
      constrainViewportPosition: true,
    }) : null,
    [isHtmlSource, page.id, page.source.value],
  );
  // Rebuild the browsing context only when its source changes. Titles,
  // canvas coordinates, and other metadata can update without reloading a
  // generated screen or restarting its local state.
  const frameKey = useMemo(
    () => `${page.id}:${page.source.type}:${page.source.value}`,
    [page.id, page.source.type, page.source.value],
  );
  // Keep status tied to the frame identity. An srcDoc frame can emit `load`
  // during the same commit that mounts it; a separate effect-based reset can
  // then run afterwards and incorrectly put the loading veil back on screen.
  // Deriving the initial state for a new key avoids that race and also keeps
  // stale events from an old iframe from affecting the current one.
  const [frameStatus, setFrameStatus] = useState<FrameStatus>(() => ({
    key: frameKey,
    loading: !isHtmlSource,
    failed: false,
  }));
  const isCurrentFrame = frameStatus.key === frameKey;
  const loading = !isHtmlSource && (!isCurrentFrame || frameStatus.loading);
  const failed = !isHtmlSource && isCurrentFrame && frameStatus.failed;

  const markFrameLoaded = () => setFrameStatus({ key: frameKey, loading: false, failed: false });
  const markFrameFailed = () => setFrameStatus({ key: frameKey, loading: false, failed: true });

  useEffect(() => {
    if (isHtmlSource) return;
    // Browsers commonly report a successful `load` for an X-Frame-Options or
    // CSP-blocked URL, and some hosts leave a URL or srcDoc frame pending
    // forever. A bounded fallback keeps either source type actionable without
    // guessing from cross-origin frame contents. A real load/error event wins
    // before this timer, so ordinary previews keep their existing behavior.
    const timer = window.setTimeout(() => {
      setFrameStatus((current) =>
        current.key === frameKey && current.loading
          ? { key: frameKey, loading: false, failed: true }
          : current,
      );
    }, PREVIEW_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [frameKey, isHtmlSource]);

  useLayoutEffect(() => {
    if (!isHtmlSource || typeof window === "undefined") return;
    const preview = previewRef.current;
    if (!preview) return;

    // Vite can preserve the existing DOM during a hot update. Normalize the
    // current body once so legacy IMG proxies from an earlier bundle cannot
    // remain as the browser's first annotation hit.
    const inlineBody = preview.querySelector<HTMLElement>("[data-codex-inline-body]");
    if (inlineBody) markNativeAnnotationTargets(inlineBody, { includeHitProxies: false });

    const refresh = () => {
      const proxies = Array.from(preview.querySelectorAll<HTMLElement>("[data-codex-annotation-hit]"));
      proxies.forEach((proxy) => {
        const target = getAnnotationProxyTarget(proxy, preview);
        if (target) resizeAnnotationProxy(proxy, target);
      });
    };
    const targets = Array.from(preview.querySelectorAll<HTMLElement>("[data-openai-annotatable]"));
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(refresh) : null;
    // Canvas zoom/pan is represented by a transform on `.canvas-space`.
    // Transforms do not fire ResizeObserver callbacks, so watch that ancestor
    // explicitly and resize the proxies whenever its inline transform changes.
    const transformOwner = preview.closest<HTMLElement>(".canvas-space");
    const transformObserver = typeof MutationObserver !== "undefined" && transformOwner
      ? new MutationObserver(refresh)
      : null;
    if (transformObserver && transformOwner) {
      transformObserver.observe(transformOwner, { attributes: true, attributeFilter: ["style", "class"] });
    }
    targets.forEach((target) => resizeObserver?.observe(target));
    refresh();
    window.addEventListener("resize", refresh, true);
    window.addEventListener("scroll", refresh, true);
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);
    return () => {
      resizeObserver?.disconnect();
      transformObserver?.disconnect();
      window.removeEventListener("resize", refresh, true);
      window.removeEventListener("scroll", refresh, true);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
    };
  }, [inlineHtml, isHtmlSource, page.id]);

  const openExternal = () => {
    void openAnnotationPreview(page);
  };

  return (
    <div
      ref={previewRef}
      className={`page-preview page-preview--${variant} page-preview--${isHtmlSource ? "html" : "url"} ${className}`.trim()}
      data-codex-preview-source={page.source.type}
    >
      {loading && !failed ? <div className="page-preview__loading" aria-label="Loading preview"><span className="loading-dots" /></div> : null}
      {failed ? (
        <div className="page-preview__error" role="status">
          <div className="page-preview__error-icon"><RefreshCw size={18} aria-hidden="true" /></div>
          <p>{page.source.type === "url" ? "This site blocked the preview" : "Preview unavailable"}</p>
          <button type="button" className="text-button" onClick={openExternal}>
            <ExternalLink size={14} aria-hidden="true" /> Open source
          </button>
        </div>
      ) : isHtmlSource && inlineHtml ? (
        <div
          className="page-preview__inline page-preview__inline--annotatable"
          data-codex-annotation-surface="inline-html"
          data-codex-annotation-page-id={page.id}
          data-openai-annotation-container="true"
          data-codex-active-content={inlineHtml.removedActiveContent ? "removed" : "static"}
          dangerouslySetInnerHTML={{ __html: inlineHtml.markup }}
        />
      ) : (
        <iframe
          key={frameKey}
          title={`${page.title} preview`}
          className="page-preview__frame"
          src={page.source.type === "url" ? page.source.value : undefined}
          srcDoc={page.source.type === "html" ? page.source.value : undefined}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          onLoad={markFrameLoaded}
          onError={markFrameFailed}
        />
      )}
      {showSourceBadge ? <span className="page-preview__badge">{sourceIcon}{sourceLabel}</span> : null}
      {page.source.type === "url" ? (
        <button type="button" className="page-preview__external" onClick={openExternal} aria-label={`Open ${page.title} source`} title="Open source">
          <ExternalLink size={14} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}
