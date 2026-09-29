import type { Page } from "../domain/model";
import type { DeviceFrame } from "../components/device-presets";
import {
  emptyLayout,
  type DesignAsset,
  type DesignColor,
  type DesignDocument,
  type DesignFontUsage,
  type DesignLayout,
  type DesignNode,
  type DesignRect,
  type DesignSemantics,
  type DesignTextStyle,
} from "./designModel";

const DEFAULT_VIEWPORT = { width: 430, height: 900 };
const CAPTURE_TIMEOUT_MS = 10_000;
const ASSET_WAIT_TIMEOUT_MS = 2_500;
const MAX_INLINE_IMAGE_BYTES = 4 * 1024 * 1024;
// Preserve explicit CSS leading below one pixel across the capture boundary.
// A tiny positive floor avoids serializing a zero geometry value into Figma.
const MIN_USED_LINE_HEIGHT = 0.01;
// Match the browser extension capture boundary: document metadata and head
// contents are not rendered page layers and must never enter the scene tree.
const IGNORED_TAGS = new Set(["HEAD", "SCRIPT", "STYLE", "META", "LINK", "NOSCRIPT"]);

interface CaptureContext {
  document: Document;
  rootFontSize: number;
  rootLineHeight: number;
  assets: DesignAsset[];
  assetBySource: Map<string, string>;
  fonts: Map<string, DesignFontUsage>;
  diagnostics: DesignDocument["diagnostics"];
  fontDiagnostics: Set<string>;
  imageData: Map<string, string>;
  nodeIdByElement: WeakMap<Element, string>;
  sequence: number;
}

function numberValue(value: string, fallback = 0): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const CSS_BORDER_WIDTH_KEYWORDS: Record<string, number> = {
  thin: 1,
  medium: 3,
  thick: 5,
};

function cssBorderWidthValue(value: string, fallback = 0, fontSize = 16, rootFontSize = 16): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(CSS_BORDER_WIDTH_KEYWORDS, normalized)) {
    return CSS_BORDER_WIDTH_KEYWORDS[normalized];
  }
  const match = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|pt|pc|in|cm|mm|q|rem|em|ex|ch)?$/i);
  if (!match) return fallback;
  const numeric = Number.parseFloat(match[1]);
  if (!Number.isFinite(numeric) || numeric < 0) return fallback;
  const unit = (match[2] || "px").toLowerCase();
  const factors: Record<string, number> = {
    px: 1,
    pt: 96 / 72,
    pc: 16,
    in: 96,
    cm: 96 / 2.54,
    mm: 96 / 25.4,
    q: 96 / 101.6,
    rem: Math.max(0.01, rootFontSize),
    em: Math.max(0.01, fontSize),
    ex: Math.max(0.01, fontSize) * 0.5,
    ch: Math.max(0.01, fontSize) * 0.5,
  };
  return numeric * (factors[unit] || 1);
}

function expandedCssBoxValues(value: string): string[] {
  const tokens = splitCssSpaceValues(String(value || "").trim());
  if (!tokens.length) return [];
  if (tokens.length === 1) return [tokens[0], tokens[0], tokens[0], tokens[0]];
  if (tokens.length === 2) return [tokens[0], tokens[1], tokens[0], tokens[1]];
  if (tokens.length === 3) return [tokens[0], tokens[1], tokens[2], tokens[1]];
  return tokens.slice(0, 4);
}

function authoredPositionValue(element: Element, property: SizingProperty): string {
  const direct = authoredStylesheetValue(element, property).trim();
  if (direct) return direct;
  const shorthand = property === "insetInlineStart" || property === "insetInlineEnd" ? "insetInline" :
    property === "insetBlockStart" || property === "insetBlockEnd" ? "insetBlock" : "inset";
  const raw = authoredStylesheetValue(element, shorthand).trim();
  if (!raw) return "";
  if (shorthand === "insetInline" || shorthand === "insetBlock") {
    const values = splitCssSpaceValues(raw);
    const start = values[0] || "";
    const end = values[1] || start;
    return property.endsWith("Start") ? start : end;
  }
  const values = expandedCssBoxValues(raw);
  if (property === "insetInlineStart") return values[3] || "";
  if (property === "insetInlineEnd") return values[1] || "";
  if (property === "insetBlockStart") return values[0] || "";
  if (property === "insetBlockEnd") return values[2] || "";
  if (property === "left") return values[3] || "";
  if (property === "right") return values[1] || "";
  if (property === "top") return values[0] || "";
  if (property === "bottom") return values[2] || "";
  return "";
}

/** Resolve CSS relative positioning, including the right/bottom-only form. */
export function relativePositionOffset(
  style: Pick<CSSStyleDeclaration, "left" | "right" | "top" | "bottom"> & Partial<Record<"insetInlineStart" | "insetInlineEnd" | "insetBlockStart" | "insetBlockEnd" | "writingMode" | "direction", string>>,
  references: {
    width?: number;
    height?: number;
    fontSize?: number;
    rootFontSize?: number;
    viewportWidth?: number;
    viewportHeight?: number;
  } = {},
): { left: number; top: number } | undefined {
  const mapped = logicalPositionTokens(style);
  const leftToken = mapped.left;
  const rightToken = mapped.right;
  const topToken = mapped.top;
  const bottomToken = mapped.bottom;
  const horizontalReference = Number.isFinite(references.width) ? Math.max(0, Number(references.width)) : 0;
  const verticalReference = Number.isFinite(references.height) ? Math.max(0, Number(references.height)) : 0;
  const fontSize = Number.isFinite(references.fontSize) ? Number(references.fontSize) : 16;
  const rootFontSize = Number.isFinite(references.rootFontSize) ? Number(references.rootFontSize) : 16;
  const resolve = (token: string, reference: number) => token === "auto" ? 0 : gapValue(
    token,
    reference,
    fontSize,
    rootFontSize,
    references.viewportWidth,
    references.viewportHeight,
    false,
  );
  const left = leftToken !== "auto" ? resolve(leftToken, horizontalReference) : rightToken !== "auto" ? -resolve(rightToken, horizontalReference) : 0;
  const top = topToken !== "auto" ? resolve(topToken, verticalReference) : bottomToken !== "auto" ? -resolve(bottomToken, verticalReference) : 0;
  return Math.abs(left) > 0.01 || Math.abs(top) > 0.01 ? { left, top } : undefined;
}

/**
 * Resolve the containing-block dimensions used by percentage relative offsets.
 * The H2D/plugin path uses the same content-box reference so a bordered or
 * padded parent cannot make the two import routes disagree.
 */
export function relativePositionContainingBlockSize(
  rect: { width?: number; height?: number } | undefined,
  style: Pick<CSSStyleDeclaration, "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft" | "borderTopWidth" | "borderRightWidth" | "borderBottomWidth" | "borderLeftWidth">,
): { width: number; height: number } {
  return {
    width: Math.max(0, Number(rect?.width || 0)
      - numberValue(style.paddingLeft)
      - numberValue(style.paddingRight)
      - numberValue(style.borderLeftWidth)
      - numberValue(style.borderRightWidth)),
    height: Math.max(0, Number(rect?.height || 0)
      - numberValue(style.paddingTop)
      - numberValue(style.paddingBottom)
      - numberValue(style.borderTopWidth)
      - numberValue(style.borderBottomWidth)),
  };
}

export function relativePositionExpressions(
  style: Pick<CSSStyleDeclaration, "left" | "right" | "top" | "bottom"> & Partial<Record<"insetInlineStart" | "insetInlineEnd" | "insetBlockStart" | "insetBlockEnd" | "writingMode" | "direction", string>>,
  element?: Element,
): { left?: string; right?: string; top?: string; bottom?: string } | undefined {
  const values = (["left", "right", "top", "bottom"] as const).reduce((result, property) => {
    const value = String((element ? authoredPositionValue(element, property) : style[property]) ?? "").trim();
    if (value && value.toLowerCase() !== "auto") result[property] = value;
    return result;
  }, {} as { left?: string; right?: string; top?: string; bottom?: string });
  const logical = logicalPositionTokens(style, element);
  for (const property of ["left", "right", "top", "bottom"] as const) {
    if (values[property]) continue;
    if (logical[property] && logical[property] !== "auto") values[property] = logical[property];
  }
  return Object.keys(values).length ? values : undefined;
}

type LogicalPositionStyle = Pick<CSSStyleDeclaration, "left" | "right" | "top" | "bottom">
  & Partial<Record<"insetInlineStart" | "insetInlineEnd" | "insetBlockStart" | "insetBlockEnd" | "writingMode" | "direction", string>>;

function logicalPositionTokens(style: LogicalPositionStyle, element?: Element): { left: string; right: string; top: string; bottom: string } {
  const cssStyle = style as CSSStyleDeclaration;
  const read = (property: "left" | "right" | "top" | "bottom" | "insetInlineStart" | "insetInlineEnd" | "insetBlockStart" | "insetBlockEnd"): string => {
    const cssName = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
    const authored = element ? authoredPositionValue(element, property as SizingProperty).trim() : "";
    if (authored) return authored.toLowerCase();
    const direct = String((style as CSSStyleDeclaration & Record<string, unknown>)[property] ?? "").trim();
    if (direct) return direct.toLowerCase();
    if (typeof cssStyle.getPropertyValue === "function") return cssStyle.getPropertyValue(cssName).trim().toLowerCase() || "auto";
    return "auto";
  };
  const physical = {
    left: read("left"), right: read("right"), top: read("top"), bottom: read("bottom"),
  };
  const logical = {
    inlineStart: read("insetInlineStart"), inlineEnd: read("insetInlineEnd"),
    blockStart: read("insetBlockStart"), blockEnd: read("insetBlockEnd"),
  };
  const logicalAuthored = element && ["insetInlineStart", "insetInlineEnd", "insetBlockStart", "insetBlockEnd"].some((property) => (
    authoredPositionValue(element, property as SizingProperty).trim()
  ));
  const hasLogical = Boolean(logicalAuthored)
    || Object.values(logical).some((value) => value !== "auto");
  if (!hasLogical) return physical;
  const writingMode = String(style.writingMode || cssStyle.getPropertyValue?.("writing-mode") || "horizontal-tb").trim().toLowerCase();
  const rtl = String(style.direction || cssStyle.getPropertyValue?.("direction") || "ltr").trim().toLowerCase().startsWith("rtl");
  const pick = (logicalValue: string, fallback: string): string => logicalValue !== "auto" ? logicalValue : fallback;
  if (writingMode.startsWith("vertical-") || writingMode.startsWith("sideways-")) {
    return {
      left: writingMode.includes("-lr") ? pick(logical.blockStart, physical.left) : pick(logical.blockEnd, physical.left),
      right: writingMode.includes("-lr") ? pick(logical.blockEnd, physical.right) : pick(logical.blockStart, physical.right),
      top: rtl ? pick(logical.inlineEnd, physical.top) : pick(logical.inlineStart, physical.top),
      bottom: rtl ? pick(logical.inlineStart, physical.bottom) : pick(logical.inlineEnd, physical.bottom),
    };
  }
  return {
    left: rtl ? pick(logical.inlineEnd, physical.left) : pick(logical.inlineStart, physical.left),
    right: rtl ? pick(logical.inlineStart, physical.right) : pick(logical.inlineEnd, physical.right),
    top: pick(logical.blockStart, physical.top),
    bottom: pick(logical.blockEnd, physical.bottom),
  };
}

function resolvedLengthValue(
  value: string,
  reference: number,
  fontSize = 16,
  rootFontSize = 16,
  viewportWidth = 0,
  viewportHeight = 0,
): number | undefined {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "normal") return undefined;
  const resolveTerm = (term: string): number | undefined => {
    const match = term.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px|%|rem|em|vw|vh|vmin|vmax|svw|svh|svmin|svmax|lvw|lvh|lvmin|lvmax|dvw|dvh|dvmin|dvmax)?$/);
    if (!match) return undefined;
    const parsed = Number.parseFloat(match[1]);
    if (!Number.isFinite(parsed)) return undefined;
    const unit = match[2] || "px";
    if (unit === "%") return reference * parsed / 100;
    // Computed styles normally resolve font-relative units, but retain the
    // captured typography for synthetic/legacy style objects as well.
    if (unit === "rem") return parsed * Math.max(1, rootFontSize || 16);
    if (unit === "em") return parsed * Math.max(1, fontSize || 16);
    // The capture iframe is rendered at the requested device viewport. The
    // small/large/dynamic viewport units therefore share that concrete
    // viewport at capture time; the authored expression remains preserved
    // separately for responsive metadata.
    if (["vw", "svw", "lvw", "dvw"].includes(unit)) return parsed * Math.max(0, viewportWidth) / 100;
    if (["vh", "svh", "lvh", "dvh"].includes(unit)) return parsed * Math.max(0, viewportHeight) / 100;
    if (["vmin", "svmin", "lvmin", "dvmin"].includes(unit)) return parsed * Math.min(Math.max(0, viewportWidth), Math.max(0, viewportHeight)) / 100;
    if (["vmax", "svmax", "lvmax", "dvmax"].includes(unit)) return parsed * Math.max(Math.max(0, viewportWidth), Math.max(0, viewportHeight)) / 100;
    return parsed;
  };
  const resolveExpression = (expression: string): number | undefined => {
    const raw = expression.trim();
    const functionMatch = raw.match(/^(min|max|clamp)\(/i);
    if (functionMatch && raw.endsWith(")")) {
      const name = functionMatch[1].toLowerCase();
      const body = raw.slice(functionMatch[0].length, -1);
      const values = splitCssArguments(body).map(resolveExpression);
      if (values.some((entry) => entry == null)) return undefined;
      const numbers = values as number[];
      if (name === "min") return numbers.length ? Math.min(...numbers) : undefined;
      if (name === "max") return numbers.length ? Math.max(...numbers) : undefined;
      return numbers.length === 3 ? Math.min(numbers[2], Math.max(numbers[0], numbers[1])) : undefined;
    }
    if (/^calc\(/i.test(raw) && raw.endsWith(")")) {
      const body = raw.slice(5, -1).replace(/\s+/g, "");
      const operandPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:%|px|rem|em|vw|vh|vmin|vmax|svw|svh|svmin|svmax|lvw|lvh|lvmin|lvmax|dvw|dvh|dvmin|dvmax)?/i;
      let cursor = 0;
      type CalcValue = { value: number; unitless: boolean };
      const combine = (left: CalcValue, operator: string, right: CalcValue): CalcValue | undefined => {
        if (operator === "+" || operator === "-") {
          if (left.unitless !== right.unitless) return undefined;
          return { value: operator === "+" ? left.value + right.value : left.value - right.value, unitless: left.unitless };
        }
        if (operator === "*" && !left.unitless && !right.unitless) return undefined;
        if (operator === "/" && (!right.unitless || Math.abs(right.value) < Number.EPSILON)) return undefined;
        return {
          value: operator === "*" ? left.value * right.value : left.value / right.value,
          unitless: operator === "*" ? left.unitless && right.unitless : left.unitless,
        };
      };
      const parseExpression = (): CalcValue | undefined => {
        let value = parseTerm();
        if (!value) return undefined;
        while (cursor < body.length && /[+-]/.test(body[cursor])) {
          const operator = body[cursor++];
          const right = parseTerm();
          if (!right) return undefined;
          value = combine(value, operator, right);
          if (!value) return undefined;
        }
        return value;
      };
      const parseTerm = (): CalcValue | undefined => {
        let value = parseFactor();
        if (!value) return undefined;
        while (cursor < body.length && /[*/]/.test(body[cursor])) {
          const operator = body[cursor++];
          const right = parseFactor();
          if (!right) return undefined;
          value = combine(value, operator, right);
          if (!value) return undefined;
        }
        return value;
      };
      const parseFactor = (): CalcValue | undefined => {
        let sign = 1;
        if (body[cursor] === "+" || body[cursor] === "-") {
          if (body[cursor] === "-") sign = -1;
          cursor += 1;
        }
        if (body[cursor] === "(") {
          cursor += 1;
          const value = parseExpression();
          if (!value || body[cursor] !== ")") return undefined;
          cursor += 1;
          return { value: sign * value.value, unitless: value.unitless };
        }
        const nestedFunction = body.slice(cursor).match(/^(?:min|max|clamp)\(/i);
        if (nestedFunction) {
          const start = cursor;
          let depth = 0;
          while (cursor < body.length) {
            if (body[cursor] === "(") depth += 1;
            else if (body[cursor] === ")") {
              depth -= 1;
              if (depth === 0) {
                cursor += 1;
                const resolved = resolveExpression(body.slice(start, cursor));
                return resolved == null ? undefined : { value: sign * resolved, unitless: false };
              }
            }
            cursor += 1;
          }
          return undefined;
        }
        const match = body.slice(cursor).match(operandPattern);
        if (!match || !match[0]) return undefined;
        const token = match[0];
        const resolved = resolveTerm(token);
        if (resolved == null) return undefined;
        cursor += token.length;
        return {
          value: sign * resolved,
          unitless: !/(?:%|px|rem|em|vw|vh|vmin|vmax|svw|svh|svmin|svmax|lvw|lvh|lvmin|lvmax|dvw|dvh|dvmin|dvmax)$/i.test(token),
        };
      };
      const result = parseExpression();
      return result && cursor === body.length ? result.value : undefined;
    }
    return resolveTerm(raw);
  };
  return resolveExpression(normalized);
}

function gapValue(
  value: string,
  reference: number,
  fontSize = 16,
  rootFontSize = 16,
  viewportWidth = 0,
  viewportHeight = 0,
  clampNegative = true,
): number {
  const resolved = resolvedLengthValue(
    value,
    reference,
    fontSize,
    rootFontSize,
    viewportWidth,
    viewportHeight,
  ) ?? 0;
  return clampNegative ? Math.max(0, resolved) : resolved;
}

function splitCssSpaceValues(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (/\s/.test(character) && depth === 0) {
      if (start < index) parts.push(value.slice(start, index));
      while (index + 1 < value.length && /\s/.test(value[index + 1])) index += 1;
      start = index + 1;
    }
  }
  if (start < value.length) parts.push(value.slice(start));
  return parts.filter(Boolean);
}

/**
 * Resolve the arithmetic subset of CSS `calc()` used by line-height.
 *
 * The old capture path only accepted additive terms (`calc(20px + 4px)`).
 * CSS also permits multiplication/division by a unitless number, for
 * example `calc(1.5 * 1em)` and `calc(28px / 2)`. Compatibility captures
 * can retain those authored expressions even when the browser normally
 * exposes a computed pixel value, so silently falling back to 1.2em loses
 * inherited leading at the H2D boundary.
 */
function resolveCssCalcExpression(
  body: string,
  resolveTerm: (term: string) => number | undefined,
): number | undefined {
  const compact = body.replace(/\s+/g, "");
  const values: Array<{ value: number; unitless: boolean }> = [];
  const operators: string[] = [];
  let cursor = 0;
  let expectingValue = true;
  const operandPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:px|em|rem|%|lh|rlh|pt|pc|in|cm|mm|q)?/i;
  while (cursor < compact.length) {
    if (expectingValue) {
      const match = compact.slice(cursor).match(operandPattern);
      if (!match) return undefined;
      const token = match[0];
      const unitless = !/(?:px|em|rem|%|lh|rlh|pt|pc|in|cm|mm|q)$/i.test(token);
      // Inside calc arithmetic a bare number is a scalar multiplier/divisor,
      // not CSS's standalone unitless line-height multiplier.
      const value = unitless ? Number.parseFloat(token) : resolveTerm(token);
      if (value === undefined || !Number.isFinite(value)) return undefined;
      values.push({
        value,
        unitless,
      });
      cursor += token.length;
      expectingValue = false;
    } else {
      const operator = compact[cursor];
      if (!/[+\-*/]/.test(operator)) return undefined;
      operators.push(operator);
      cursor += 1;
      expectingValue = true;
    }
  }
  if (expectingValue || values.length !== operators.length + 1) return undefined;

  // Collapse multiplication/division first, then apply additive operators.
  // Keep the unitless bit so invalid dimensional products do not become a
  // plausible-looking pixel value in the compatibility payload.
  const reduced: Array<{ value: number; unitless: boolean } | string> = [values[0]];
  for (let index = 0; index < operators.length; index += 1) {
    const operator = operators[index];
    const next = values[index + 1];
    if (operator === "*" || operator === "/") {
      const previous = reduced[reduced.length - 1];
      if (typeof previous === "string") return undefined;
      if (operator === "*" && !previous.unitless && !next.unitless) return undefined;
      if (operator === "/" && (!next.unitless || Math.abs(next.value) < Number.EPSILON)) return undefined;
      previous.value = operator === "*" ? previous.value * next.value : previous.value / next.value;
      previous.unitless = operator === "*" ? previous.unitless && next.unitless : previous.unitless;
    } else {
      reduced.push(operator, next);
    }
  }
  let result = 0;
  let sign = 1;
  for (const entry of reduced) {
    if (typeof entry === "string") {
      sign = entry === "+" ? 1 : -1;
    } else {
      result += sign * entry.value;
    }
  }
  return Number.isFinite(result) ? result : undefined;
}

export function textLineHeight(
  value: string,
  fontSize: number,
  rootFontSize = 16,
  lineHeightReference = fontSize * 1.2,
  rootLineHeight = rootFontSize * 1.2,
): number {
  const fallback = Math.max(1, fontSize * 1.2);
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "normal") return fallback;
  const resolveTerm = (term: string): number | undefined => {
    const match = term.trim().match(/^([+-]?(?:\d+\.?\d*|\.\d+))(px|em|rem|%|lh|rlh|pt|pc|in|cm|mm|q)?$/);
    if (!match) return undefined;
    const parsed = Number.parseFloat(match[1]);
    if (!Number.isFinite(parsed)) return undefined;
    const unit = match[2] || "unitless";
    if (unit === "%") return fontSize * parsed / 100;
    if (unit === "em") return fontSize * parsed;
    if (unit === "rem") return Math.max(1, rootFontSize || 16) * parsed;
    if (unit === "lh") return Math.max(MIN_USED_LINE_HEIGHT, lineHeightReference || fallback) * parsed;
    if (unit === "rlh") return Math.max(MIN_USED_LINE_HEIGHT, rootLineHeight || Math.max(1, rootFontSize || 16) * 1.2) * parsed;
    if (unit === "pt") return parsed * 96 / 72;
    if (unit === "pc") return parsed * 16;
    if (unit === "in") return parsed * 96;
    if (unit === "cm") return parsed * 96 / 2.54;
    if (unit === "mm") return parsed * 96 / 25.4;
    if (unit === "q") return parsed * 96 / 101.6;
    if (unit === "px") return parsed;
    return fontSize * parsed;
  };
  const resolveExpression = (expression: string, depth = 0): number | undefined => {
    if (depth > 8) return undefined;
    const candidate = expression.trim().toLowerCase();
    const direct = resolveTerm(candidate);
    if (direct !== undefined) return direct;
    if (candidate.startsWith("calc(") && candidate.endsWith(")")) {
      const body = candidate.slice(5, -1).trim();
      const resolved = resolveCssCalcExpression(body, resolveTerm);
      if (resolved === undefined) return undefined;
      // A calc() that resolves to a CSS <number> is still a line-height
      // multiplier. Treating it as pixels collapses `calc(1 + .5)` to 1.5px.
      const hasDimension = /(?:px|em|rem|lh|rlh|pt|pc|in|cm|mm|q)\b|%/i.test(body);
      return hasDimension ? resolved : fontSize * resolved;
    }
    const functionMatch = candidate.match(/^(min|max|clamp)\(([\s\S]*)\)$/i);
    if (!functionMatch) return undefined;
    const values = splitCssArguments(functionMatch[2])
      .map((entry) => resolveExpression(entry, depth + 1));
    if (values.length === 0 || !values.every((value): value is number => value !== undefined && Number.isFinite(value))) {
      return undefined;
    }
    const name = functionMatch[1].toLowerCase();
    if (name === "min") return Math.min(...values);
    if (name === "max") return Math.max(...values);
    return values.length === 3 ? Math.min(values[2], Math.max(values[0], values[1])) : undefined;
  };
  const resolved = resolveExpression(normalized);
  if (resolved === undefined) return fallback;
  return Math.max(MIN_USED_LINE_HEIGHT, resolved);
}

type LineHeightStyle = Pick<CSSStyleDeclaration, "lineHeight"> & Partial<Pick<CSSStyleDeclaration, "getPropertyValue">>;

// A compatibility CSSStyleDeclaration can expose a computed declaration only
// through getPropertyValue(), while leaving the camelCase property empty.
// Keep both channels equivalent before resolving inheritance or measuring a
// control's text box.
function cssStyleValue(style: unknown, camelProperty: string, cssProperty: string): string {
  const source = style as ({ getPropertyValue?: (property: string) => string } & Record<string, unknown>) | undefined;
  const direct = String(source?.[camelProperty] ?? "").trim();
  if (direct) return direct;
  if (typeof source?.getPropertyValue === "function") {
    return String(source.getPropertyValue(cssProperty) ?? "").trim();
  }
  return "";
}

function cssLineHeightValue(style: LineHeightStyle | undefined): string {
  return cssStyleValue(style, "lineHeight", "line-height");
}

/**
 * Resolve line-height custom-property references at the capture boundary.
 * Browsers normally expose a computed pixel value, but compatibility captures
 * can retain the authored `var(--token)` expression. Reading the custom
 * property from the same computed style keeps tokenized typography from
 * silently falling back to 1.2em.
 */
export function resolveLineHeightCustomProperties(
  value: string,
  style?: { getPropertyValue?: (property: string) => string },
  seen = new Set<string>(),
): string {
  const source = String(value ?? "").trim();
  const getPropertyValue = style?.getPropertyValue;
  if (!source || typeof getPropertyValue !== "function") return source;
  const replaceVariable = (token: string): string => {
    const match = token.match(/^var\(\s*(--[\w-]+)\s*(?:,\s*([\s\S]*))?\)$/i);
    if (!match) return token;
    const name = match[1];
    if (seen.has(name)) return String(match[2] ?? "").trim();
    const nextSeen = new Set(seen).add(name);
    const declared = String(getPropertyValue.call(style, name) ?? "").trim();
    const replacement = declared || String(match[2] ?? "").trim();
    return replacement ? resolveLineHeightCustomProperties(replacement, style, nextSeen) : token;
  };
  // Resolve a complete var() token first (the common line-height form), then
  // replace nested variables inside calc()/min()/max()/clamp() expressions.
  const whole = replaceVariable(source);
  if (whole !== source) return whole;
  return source.replace(/var\(\s*--[\w-]+(?:\s*,\s*[\s\S]*?)?\)/gi, (token) => replaceVariable(token));
}

/**
 * CSS keywords whose used line box can depend on the browser/font metrics.
 * `initial` is the CSS initial value for line-height, which is `normal`.
 *
 * Inheritance keywords are deliberately excluded here. They must resolve
 * against the ancestor's used line box first; measuring a single-line glyph
 * box would replace an inherited value such as `32px` with the font's ink
 * height and make the Figma import fall back to a much tighter leading.
 */
export function isMeasuredLineHeightKeyword(value: string): boolean {
  return ["normal", "initial"]
    .includes(String(value ?? "").trim().toLowerCase());
}

/**
 * Resolve a line-height declaration at the DOM boundary. Normally
 * getComputedStyle() already expands inherited values, but compatibility
 * captures and authored `inherit`/`unset` declarations can still expose the
 * keyword. In that case walk the parent chain so the resolved pixel line box
 * is retained instead of falling back to the default 1.2em leading.
 */
export function resolvedTextLineHeight(
  value: string,
  fontSize: number,
  rootFontSize = 16,
  inheritedValue?: string,
  inheritedFontSize?: number,
  lineHeightReference = fontSize * 1.2,
  rootLineHeight = rootFontSize * 1.2,
): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  const deferred = normalized.startsWith("var(") || normalized.startsWith("env(");
  const inherited = normalized === "inherit"
    || normalized === "unset"
    || normalized === "revert"
    || normalized === "revert-layer";
  // Compatibility captures can retain an authored custom-property token even
  // when the ancestor/computed-style channel already carries its resolved
  // line box. Use that resolved value instead of falling back to 1.2em.
  if (deferred && inheritedValue) {
    const resolvedInherited = String(inheritedValue).trim().toLowerCase();
    if (resolvedInherited && !resolvedInherited.startsWith("var(") && !resolvedInherited.startsWith("env(")) {
      return textLineHeight(inheritedValue, fontSize, rootFontSize, lineHeightReference, rootLineHeight);
    }
  }
  if (inherited && inheritedValue && String(inheritedValue).trim().toLowerCase() !== normalized) {
    const inheritedToken = String(inheritedValue).trim().toLowerCase();
    // Unitless line-height is inherited as a multiplier and must use the
    // receiving element's font size. Lengths and percentages are resolved on
    // the declaring ancestor before inheritance, so use that ancestor's
    // captured font size when the compatibility boundary still exposes the
    // authored token instead of a computed pixel value.
    const unitless = /^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(inheritedToken);
    const referenceFontSize = unitless
      ? fontSize
      : (Number.isFinite(inheritedFontSize) ? Number(inheritedFontSize) : fontSize);
    return textLineHeight(inheritedValue, referenceFontSize, rootFontSize, lineHeightReference, rootLineHeight);
  }
  return textLineHeight(value, fontSize, rootFontSize, lineHeightReference, rootLineHeight);
}

/**
 * Resolve inherited typography for generated content such as `::before`,
 * `::after`, and `::marker`. Compatibility captures can preserve inheritance
 * keywords on pseudo styles; falling back to 16px/1.2em changes both the
 * editable TextNode leading and the generated-content box height.
 */
export function resolvedGeneratedTextMetrics(
  style: Pick<CSSStyleDeclaration, "fontSize" | "lineHeight"> & Partial<Pick<CSSStyleDeclaration, "getPropertyValue">>,
  inheritedStyle?: Pick<CSSStyleDeclaration, "fontSize" | "lineHeight"> & Partial<Pick<CSSStyleDeclaration, "getPropertyValue">>,
  rootFontSize = 16,
  rootLineHeight = rootFontSize * 1.2,
): { fontSize: number; lineHeight: number } {
  const inheritedFontSize = numberValue(cssStyleValue(inheritedStyle, "fontSize", "font-size"), 16);
  const fontSizeToken = cssStyleValue(style, "fontSize", "font-size").toLowerCase();
  const inheritsFontSize = fontSizeToken === "inherit"
    || fontSizeToken === "unset"
    || fontSizeToken === "revert"
    || fontSizeToken === "revert-layer";
  const fontSize = Math.max(1, inheritsFontSize
    ? inheritedFontSize
    : numberValue(cssStyleValue(style, "fontSize", "font-size"), inheritedFontSize));
  const inheritedLineHeight = cssLineHeightValue(inheritedStyle);
  const lineHeightReference = inheritedLineHeight
    ? textLineHeight(inheritedLineHeight, inheritedFontSize, rootFontSize, rootLineHeight, rootLineHeight)
    : rootLineHeight;
  return {
    fontSize,
    lineHeight: resolvedTextLineHeight(
      resolveLineHeightCustomProperties(cssLineHeightValue(style), style),
      fontSize,
      rootFontSize,
      cssLineHeightValue(inheritedStyle),
      inheritedFontSize,
      lineHeightReference,
      rootLineHeight,
    ),
  };
}

function inheritedGeneratedTextValue(value: string | undefined, inheritedValue: string | undefined, fallback: string): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["inherit", "unset", "revert", "revert-layer"].includes(normalized)) {
    return String(inheritedValue ?? fallback).trim() || fallback;
  }
  return String(value ?? inheritedValue ?? fallback).trim() || fallback;
}

/** Resolve the common font properties used to measure generated text. */
export function resolvedGeneratedTextStyle(
  style: Pick<CSSStyleDeclaration, "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "letterSpacing" | "wordSpacing" | "lineHeight">,
  inheritedStyle?: Pick<CSSStyleDeclaration, "fontFamily" | "fontSize" | "fontWeight" | "fontStyle" | "letterSpacing" | "wordSpacing" | "lineHeight">,
  rootFontSize = 16,
  rootLineHeight = rootFontSize * 1.2,
): {
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  letterSpacing: number;
  wordSpacing: number;
  lineHeight: number;
} {
  const metrics = resolvedGeneratedTextMetrics(style, inheritedStyle, rootFontSize, rootLineHeight);
  const fontFamily = inheritedGeneratedTextValue(style.fontFamily, inheritedStyle?.fontFamily, "Inter");
  const fontWeight = inheritedGeneratedTextValue(style.fontWeight, inheritedStyle?.fontWeight, "400");
  const fontStyle = inheritedGeneratedTextValue(style.fontStyle, inheritedStyle?.fontStyle, "normal");
  const letterSpacing = numberValue(inheritedGeneratedTextValue(style.letterSpacing, inheritedStyle?.letterSpacing, "0px"), 0);
  const wordSpacing = numberValue(inheritedGeneratedTextValue(style.wordSpacing, inheritedStyle?.wordSpacing, "0px"), 0);
  return { ...metrics, fontFamily, fontWeight, fontStyle, letterSpacing, wordSpacing };
}

/**
 * Resolve a measured line box from Range top coordinates.  Range rectangles
 * are grouped by visual line first, then the median distance between adjacent
 * lines is used so a single accented glyph cannot skew the result.  This is
 * primarily a precision path for CSS `line-height: normal`, whose actual
 * value is font/platform dependent and cannot be represented by a universal
 * 1.2em constant.
 */
export function measuredLineHeightFromLineTops(tops: number[], minimum = 1): number | undefined {
  const finite = tops.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (finite.length < 2) return undefined;
  // Range rectangles describe glyph ink, not the CSS line box. Uppercase and
  // descender glyphs can therefore have tops a few pixels apart on the same
  // line. A bounded, font-relative tolerance groups those glyphs without
  // merging ordinary adjacent lines.
  const clusterTolerance = Math.max(1, Math.min(3.25, Math.max(1, minimum) * 0.2));
  const lines: number[] = [];
  for (const top of finite) {
    const previous = lines[lines.length - 1];
    if (previous == null || Math.abs(top - previous) > clusterTolerance) lines.push(top);
    else lines[lines.length - 1] = (previous + top) / 2;
  }
  if (lines.length < 2) return undefined;
  const deltas = lines.slice(1).map((top, index) => top - lines[index]).filter((value) => value > 0.75);
  if (!deltas.length) return undefined;
  deltas.sort((left, right) => left - right);
  const middle = Math.floor(deltas.length / 2);
  const median = deltas.length % 2 ? deltas[middle] : (deltas[middle - 1] + deltas[middle]) / 2;
  return Math.max(minimum, Math.round(median * 100) / 100);
}

/**
 * Recover a single-line `normal` line box from an auto-height text element.
 * Range glyph bounds are shorter than the CSS line box, while a fixed-height
 * button/card is not a trustworthy line-height source. Only use the element
 * border box when its own height is auto, it has no min-height constraint,
 * and its display mode can size itself around the text.
 */
export function measuredSingleLineLineHeight(
  element: Element,
  style: Pick<CSSStyleDeclaration, "display" | "height" | "minHeight" | "maxHeight" | "paddingTop" | "paddingBottom" | "borderTopWidth" | "borderBottomWidth">,
  fontSize: number,
  lineCount = 1,
  authoredSizing?: Pick<Partial<Record<"height" | "minHeight" | "maxHeight", string>>, "height" | "minHeight" | "maxHeight">,
): number | undefined {
  if (lineCount !== 1 || !element || !Number.isFinite(fontSize) || fontSize <= 0) return undefined;
  const display = String(style.display || "").trim().toLowerCase();
  if (!["block", "flow-root", "list-item", "inline-block", "table", "inline-table", "table-cell", "flex", "inline-flex", "grid", "inline-grid"].includes(display)) return undefined;
  // Computed styles expose the used pixel height even when the authored value
  // is `auto`. When the caller provides authored declarations, use those
  // tokens for the constraint decision and keep the computed style only for
  // the measured box geometry.
  const height = String(authoredSizing ? authoredSizing.height || "auto" : style.height || "").trim().toLowerCase();
  const minHeight = String(authoredSizing ? authoredSizing.minHeight || "auto" : style.minHeight || "").trim().toLowerCase();
  const maxHeight = String(authoredSizing ? authoredSizing.maxHeight || "none" : style.maxHeight || "").trim().toLowerCase();
  const intrinsicHeight = new Set(["", "auto", "unset", "initial", "revert", "revert-layer", "min-content", "max-content", "fit-content"]);
  const unconstrainedMinHeight = new Set(["", "auto", "unset", "initial", "revert", "revert-layer", "0", "0px", "min-content", "max-content", "fit-content"]);
  const unconstrainedMaxHeight = new Set(["", "none", "unset", "initial", "revert", "revert-layer", "min-content", "max-content", "fit-content"]);
  if (
    !intrinsicHeight.has(height)
    || !unconstrainedMinHeight.has(minHeight)
    || !unconstrainedMaxHeight.has(maxHeight)
  ) return undefined;
  const rect = element.getBoundingClientRect();
  const contentHeight = Number(rect.height)
    - numberValue(style.paddingTop)
    - numberValue(style.paddingBottom)
    - numberValue(style.borderTopWidth)
    - numberValue(style.borderBottomWidth);
  // Guard against a parent-imposed stretch or an unusual inline box. Normal
  // browser line boxes remain close to the font size; values outside this
  // range are safer left to the generic 1.2em fallback.
  if (!Number.isFinite(contentHeight) || contentHeight < fontSize * 0.75 || contentHeight > fontSize * 4) return undefined;
  return Math.round(contentHeight * 100) / 100;
}

/**
 * Recover a first-line text indent from measured glyph rectangles.  A Range
 * union only gives the outer bounds of a multi-line run, so a positive CSS
 * `text-indent` can otherwise disappear when the run is rebuilt as one Figma
 * TextNode.  Only callers that know they are measuring a block text box use
 * this helper; inline runs must keep their natural sibling-relative x offset.
 */
export function measuredTextIndentFromRects(
  rects: Array<{ top: number; left: number }>,
  tolerance = 1,
): number | undefined {
  const finite = rects
    .filter((rect) => Number.isFinite(rect.top) && Number.isFinite(rect.left))
    .sort((left, right) => left.top - right.top || left.left - right.left);
  if (finite.length < 2) return undefined;
  const lineTolerance = Math.max(1, Math.min(3.25, Number(tolerance) || 1));
  const lines: Array<{ top: number; left: number }> = [];
  for (const rect of finite) {
    const previous = lines[lines.length - 1];
    if (!previous || Math.abs(rect.top - previous.top) > lineTolerance) {
      lines.push({ top: rect.top, left: rect.left });
    } else {
      previous.top = (previous.top + rect.top) / 2;
      previous.left = Math.min(previous.left, rect.left);
    }
  }
  if (lines.length < 2) return undefined;
  const firstLineLeft = lines[0].left;
  const followingLineLeft = Math.min(...lines.slice(1).map((line) => line.left));
  const indent = firstLineLeft - followingLineLeft;
  return Math.abs(indent) > 0.5 ? Math.round(indent * 100) / 100 : undefined;
}

function measuredLineHeightFromTextNode(textNode: Text, doc: Document, minimum: number): number | undefined {
  const tops: number[] = [];
  for (let index = 0; index < textNode.length; index += 1) {
    const range = doc.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + 1);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && Number.isFinite(rect.top)) tops.push(rect.top);
  }
  return measuredLineHeightFromLineTops(tops, minimum);
}

function measuredTextIndentFromTextNode(textNode: Text, doc: Document, tolerance: number): number | undefined {
  const rects: Array<{ top: number; left: number }> = [];
  for (let index = 0; index < textNode.length; index += 1) {
    const range = doc.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + 1);
    const rect = range.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0 && Number.isFinite(rect.top) && Number.isFinite(rect.left)) {
      rects.push({ top: rect.top, left: rect.left });
    }
  }
  return measuredTextIndentFromRects(rects, tolerance);
}

/**
 * `visibility: hidden/collapse` still participates in CSS layout. Keep such
 * nodes in the capture so their measured flow slot survives in Figma, then
 * let the importer set the resulting layer to `visible=false`. Only
 * `display:none` removes a node from layout altogether.
 */
export function isLayoutCapturable(style: Pick<CSSStyleDeclaration, "display" | "visibility">): boolean {
  return style.display !== "none";
}

/** CSS multi-column layout has no editable Figma Auto Layout equivalent. */
export function hasMultiColumnLayout(style: Pick<CSSStyleDeclaration, "columnCount" | "columnWidth">): boolean {
  return String(style.columnCount || "auto").trim().toLowerCase() !== "auto"
    || String(style.columnWidth || "auto").trim().toLowerCase() !== "auto";
}

/** CSS Grid's dense packing has no editable Figma Auto Layout equivalent. */
export function hasDenseGridAutoFlow(style: Pick<CSSStyleDeclaration, "gridAutoFlow">): boolean {
  return /\bdense\b/i.test(String(style.gridAutoFlow || ""));
}

function textMaxLines(style: CSSStyleDeclaration): number | undefined {
  const extended = style as CSSStyleDeclaration & { lineClamp?: string; webkitLineClamp?: string; WebkitLineClamp?: string };
  const raw = String(extended.lineClamp || extended.webkitLineClamp || extended.WebkitLineClamp || "").trim().toLowerCase();
  if (!raw || raw === "none" || raw === "normal") return undefined;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

export function textAlignValue(style: Pick<CSSStyleDeclaration, "textAlign" | "direction">): DesignTextStyle["textAlign"] {
  const value = String(style.textAlign || "start").trim().toLowerCase();
  if (value === "center") return "center";
  if (value === "justify") return "justified";
  if (value === "right") return "right";
  if (value === "left") return "left";
  // CSS logical alignment depends on the inline direction. Resolve it before
  // crossing into Figma, whose TextNode API exposes physical LEFT/RIGHT only.
  const rtl = String(style.direction || "ltr").toLowerCase().startsWith("rtl");
  if (value === "end") return rtl ? "left" : "right";
  return rtl ? "right" : "left";
}

export function textPaintFor(
  style: Pick<CSSStyleDeclaration, "color" | "backgroundColor" | "getPropertyValue">,
  clipsBackgroundToText = false,
): { fillColor: string; textFillColor?: string; strokeWidth: number; strokeColor?: string } {
  const rawTextFillColor = style.getPropertyValue("-webkit-text-fill-color").trim();
  const textFillColor = resolveCurrentColor(
    rawTextFillColor && rawTextFillColor.toLowerCase() !== "currentcolor" ? rawTextFillColor : style.color,
    style.color,
  );
  const strokeWidth = numberValue(style.getPropertyValue("-webkit-text-stroke-width"));
  const rawStrokeColor = style.getPropertyValue("-webkit-text-stroke-color").trim();
  const strokeColor = resolveCurrentColor(
    rawStrokeColor && rawStrokeColor.toLowerCase() !== "currentcolor" ? rawStrokeColor : style.color,
    style.color,
  );
  const fillColor = clipsBackgroundToText
    && ["transparent", "rgba(0, 0, 0, 0)"].includes(String(textFillColor || "").trim().toLowerCase())
    ? style.backgroundColor
    : textFillColor;
  return {
    fillColor,
    ...(rawTextFillColor && rawTextFillColor !== style.color ? { textFillColor: rawTextFillColor } : {}),
    strokeWidth,
    ...(strokeWidth > 0 ? { strokeColor } : {}),
  };
}

function camelCaseCssProperty(property: string): string {
  return property.replace(/-([a-z])/g, (_match, character: string) => character.toUpperCase());
}

const COMPUTED_STYLE_DEFAULTS: Record<string, string> = {
  alignContent: "normal", alignItems: "normal", alignSelf: "auto", appearance: "none", aspectRatio: "auto",
  backdropFilter: "none", backgroundAttachment: "scroll", backgroundBlendMode: "normal", backgroundClip: "border-box",
  backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none", backgroundOrigin: "padding-box", backgroundPosition: "0% 0%",
  backgroundRepeat: "repeat", backgroundSize: "auto", borderCollapse: "separate", borderSpacing: "0px", boxSizing: "content-box", contentVisibility: "visible",
  container: "normal", containerName: "none", containerType: "normal",
  bottom: "auto", boxShadow: "none", clear: "none", clip: "auto", clipPath: "none", color: "rgb(0, 0, 0)",
  columnCount: "auto", columnGap: "normal", columnWidth: "auto", contain: "none", content: "normal", display: "",
  filter: "none", flexBasis: "auto", flexDirection: "row", flexGrow: "0", flexShrink: "1", flexWrap: "nowrap", float: "none",
  fontFamily: "Times", fontFeatureSettings: "normal", fontKerning: "auto", fontOpticalSizing: "auto", fontSize: "16px",
  fontSizeAdjust: "none", fontStretch: "100%", fontStyle: "normal", fontSynthesis: "auto", fontSynthesisWeight: "auto", fontSynthesisStyle: "auto", fontSynthesisSmallCaps: "auto", fontSynthesisPosition: "auto", fontVariationSettings: "normal", fontWeight: "400",
  fontVariant: "normal", fontVariantAlternates: "normal", fontVariantCaps: "normal", fontVariantEastAsian: "normal",
  fontVariantLigatures: "normal", fontVariantNumeric: "normal", fontVariantPosition: "normal",
  gridAutoColumns: "auto", gridAutoFlow: "row", gridAutoRows: "auto", gridColumnEnd: "auto", gridColumnStart: "auto",
  gridRowEnd: "auto", gridRowStart: "auto", gridTemplateAreas: "none", gridTemplateColumns: "none", gridTemplateRows: "none",
  height: "auto", isolation: "auto", justifyContent: "normal", justifyItems: "normal", justifySelf: "auto", left: "auto", letterSpacing: "normal", lineHeight: "normal", gap: "normal",
  anchorName: "none", anchorScope: "none", insetArea: "none", positionAnchor: "none", positionArea: "none", positionTry: "none", positionTryFallbacks: "none", positionTryOrder: "normal", positionVisibility: "always",
  inset: "auto", insetInline: "auto", insetInlineStart: "auto", insetInlineEnd: "auto", insetBlock: "auto", insetBlockStart: "auto", insetBlockEnd: "auto",
  marginBottom: "0px", marginLeft: "0px", marginRight: "0px", marginTop: "0px",
  marginInlineStart: "0px", marginInlineEnd: "0px", marginBlockStart: "0px", marginBlockEnd: "0px",
  maxHeight: "none", maxWidth: "none",
  minHeight: "auto", minWidth: "auto", mixBlendMode: "normal", objectFit: "fill", objectPosition: "50% 50%", opacity: "1",
  order: "0", overflow: "visible", overflowX: "visible", overflowY: "visible", overflowClipMargin: "0px",
  overflowClipMarginBlock: "0px", overflowClipMarginBlockStart: "0px", overflowClipMarginBlockEnd: "0px",
  overflowClipMarginInline: "0px", overflowClipMarginInlineStart: "0px", overflowClipMarginInlineEnd: "0px",
  paddingBottom: "0px", paddingLeft: "0px",
  paddingRight: "0px", paddingTop: "0px", paddingInlineStart: "0px", paddingInlineEnd: "0px",
  paddingBlockStart: "0px", paddingBlockEnd: "0px", perspective: "none", position: "static", right: "auto", rowGap: "normal",
  maskImage: "none", maskMode: "match-source", maskPosition: "0% 0%", maskSize: "auto", maskRepeat: "repeat",
  maskClip: "border-box", maskOrigin: "border-box", maskComposite: "add", WebkitMaskImage: "none", webkitMaskImage: "none",
  WebkitMaskPosition: "0% 0%", webkitMaskPosition: "0% 0%", WebkitMaskSize: "auto", webkitMaskSize: "auto",
  WebkitMaskRepeat: "repeat", webkitMaskRepeat: "repeat", WebkitMaskClip: "border-box", webkitMaskClip: "border-box",
  WebkitMaskOrigin: "border-box", webkitMaskOrigin: "border-box", WebkitMaskComposite: "add", webkitMaskComposite: "add",
  textAlign: "start", textAlignLast: "auto", textJustify: "auto", textDecorationLine: "none", textDecorationStyle: "solid", textDecorationColor: "currentcolor", textDecorationThickness: "auto", textUnderlineOffset: "auto", textIndent: "0px", textOverflow: "clip", textShadow: "none", textTransform: "none", wordSpacing: "normal", top: "auto",
  textOrientation: "mixed", textRendering: "auto", textWrapMode: "wrap", textWrapStyle: "auto", whiteSpaceCollapse: "collapse", textBoxTrim: "none", textBoxEdge: "auto", unicodeBidi: "normal", transform: "none", transformOrigin: "50% 50%", placeContent: "normal", placeItems: "normal", placeSelf: "auto",
  transformBox: "border-box", transformStyle: "flat", translate: "none", rotate: "none", scale: "none", verticalAlign: "baseline",
  backfaceVisibility: "visible", borderImageOutset: "0", borderImageRepeat: "stretch", borderImageSlice: "100%",
  borderImageSource: "none", borderImageWidth: "1", captionSide: "top", clipRule: "nonzero", fontLanguageOverride: "normal", hyphens: "manual",
  objectViewBox: "none", overflowWrap: "normal", wordBreak: "normal",
  overscrollBehavior: "auto", overscrollBehaviorX: "auto", overscrollBehaviorY: "auto", scrollBehavior: "auto",
  scrollSnapAlign: "none", scrollSnapStop: "normal", scrollSnapType: "none",
  visibility: "visible", WebkitLineClamp: "none", webkitLineClamp: "none", lineClamp: "none", whiteSpace: "normal", width: "auto", writingMode: "horizontal-tb", zIndex: "auto",
};

// Chromium may serialize the CSS `font-synthesis: auto` shorthand as the
// expanded list of enabled synthesis features. These values are semantically
// the initial value and must not trigger an SVG shaping fallback.
const DEFAULT_FONT_SYNTHESIS_VALUES = new Set([
  "auto",
  "weight style small-caps",
  "weight style small-caps position",
]);

function isDefaultFontSynthesisValue(value: string | undefined): boolean {
  return DEFAULT_FONT_SYNTHESIS_VALUES.has(String(value || "").trim().toLowerCase().replace(/\s+/g, " "));
}

function capturedFontSynthesisValue(value: string | undefined): string | undefined {
  const normalized = String(value || "").trim();
  return normalized && !isDefaultFontSynthesisValue(normalized) ? normalized : undefined;
}

const PRESERVED_COMPUTED_STYLE_PROPERTIES = new Set([
  "backgroundPositionX", "backgroundPositionY", "objectFit", "objectPosition", "filter", "backdropFilter", "mixBlendMode", "isolation",
]);

/**
 * Chrome's user-agent stylesheet uses `unicode-bidi: isolate` on ordinary
 * block containers. That value is not an authored text-shaping request. If it
 * crosses the capture boundary unchanged, every heading/paragraph is treated
 * as needing the SVG bidi fallback even though the source page did not opt in.
 */
export function capturedUnicodeBidi(
  style: Pick<CSSStyleDeclaration, "unicodeBidi">,
  element?: Element,
): string {
  const value = String(style.unicodeBidi || "normal").trim().toLowerCase();
  if (value !== "isolate" || !element) return value || "normal";
  if (element.tagName.toUpperCase() === "BDI") return value;
  const authored = authoredStylesheetValue(element, "unicodeBidi").trim().toLowerCase();
  return authored ? value : "normal";
}

export function computedStyleMap(style: CSSStyleDeclaration): Record<string, string> {
  const values: Record<string, string> = {};
  for (let index = 0; index < style.length; index += 1) {
    const property = style.item(index);
    if (!property || property.startsWith("--")) continue;
    const value = style.getPropertyValue(property).trim();
    if (!value) continue;
    const camelProperty = camelCaseCssProperty(property);
    const defaultValue = COMPUTED_STYLE_DEFAULTS[camelProperty];
    if (defaultValue !== undefined && value === defaultValue) continue;
    if (camelProperty === "fontSynthesis" && isDefaultFontSynthesisValue(value)) continue;
    // Unknown browser-specific properties are omitted unless explicitly kept;
    // this prevents a 300-property default dump on every captured node while
    // retaining the visual/layout fields that H2D consumers can act on.
    if (defaultValue === undefined && !PRESERVED_COMPUTED_STYLE_PROPERTIES.has(camelProperty)) continue;
    values[camelProperty] = value;
  }
  if (values.backgroundAttachment && !hasNonDefaultBackgroundAttachment(values.backgroundAttachment)) {
    delete values.backgroundAttachment;
  }
  const textStrokeWidth = style.getPropertyValue("-webkit-text-stroke-width").trim();
  const textStrokeColor = style.getPropertyValue("-webkit-text-stroke-color").trim();
  const textFillColor = style.getPropertyValue("-webkit-text-fill-color").trim();
  if (numberValue(textStrokeWidth) > 0) {
    values.WebkitTextStrokeWidth = textStrokeWidth;
    if (textStrokeColor) values.WebkitTextStrokeColor = textStrokeColor;
  }
  if (textFillColor && textFillColor !== style.color) values.WebkitTextFillColor = textFillColor;
  // CSS Text Level 4 properties are not present in every TypeScript DOM
  // lib, and older Chromium builds may omit them from CSSStyleDeclaration's
  // enumerable property list. Read them explicitly when the browser exposes
  // a computed value so the H2D/plugin paths do not silently lose wrapping or
  // text-box geometry intent.
  const textLevel4 = [
    ["text-wrap-style", "textWrapStyle", "auto"],
    ["text-wrap-mode", "textWrapMode", "wrap"],
    ["white-space-collapse", "whiteSpaceCollapse", "collapse"],
    ["text-box-trim", "textBoxTrim", "none"],
    ["text-box-edge", "textBoxEdge", "auto"],
  ] as const;
  for (const [cssProperty, camelProperty, defaultValue] of textLevel4) {
    const value = style.getPropertyValue(cssProperty).trim();
    if (value && value !== defaultValue) values[camelProperty] = value;
  }
  const textAlignment = [
    ["text-align-last", "textAlignLast", "auto"],
    ["text-justify", "textJustify", "auto"],
  ] as const;
  for (const [cssProperty, camelProperty, defaultValue] of textAlignment) {
    const value = style.getPropertyValue(cssProperty).trim();
    if (value && value !== defaultValue) values[camelProperty] = value;
  }
  // A few clipboard/compatibility bridges expose computed declarations via
  // getPropertyValue() but omit them from CSSStyleDeclaration.length/item().
  // `line-height` is inherited, so losing it on an intermediate wrapper can
  // make the native H2D importer rebuild the text with Figma's AUTO leading.
  // Keep explicit non-default values even when the enumerable property list
  // is incomplete. The text capture still carries the resolved numeric used
  // line box; this channel preserves the inheritance source for wrappers.
  const explicitComputedProperties = [
    ["line-height", "lineHeight", "normal"],
    ["position", "position", "static"],
    ["left", "left", "auto"],
    ["right", "right", "auto"],
    ["top", "top", "auto"],
    ["bottom", "bottom", "auto"],
    ["writing-mode", "writingMode", "horizontal-tb"],
    ["direction", "direction", "ltr"],
    ["display", "display", ""],
    ["box-sizing", "boxSizing", "content-box"],
    ["width", "width", "auto"],
    ["height", "height", "auto"],
    ["gap", "gap", "normal"],
    ["row-gap", "rowGap", "normal"],
    ["column-gap", "columnGap", "normal"],
    ["flex-direction", "flexDirection", "row"],
    ["flex-wrap", "flexWrap", "nowrap"],
    ["align-items", "alignItems", "normal"],
    ["align-content", "alignContent", "normal"],
    ["justify-content", "justifyContent", "normal"],
    ["order", "order", "0"],
    ["outline-width", "outlineWidth", "medium"],
    ["outline-style", "outlineStyle", "none"],
    ["outline-color", "outlineColor", "currentcolor"],
    ["outline-offset", "outlineOffset", "0px"],
    ["inset", "inset", "auto"],
    ["inset-inline", "insetInline", "auto"],
    ["inset-inline-start", "insetInlineStart", "auto"],
    ["inset-inline-end", "insetInlineEnd", "auto"],
    ["inset-block", "insetBlock", "auto"],
    ["inset-block-start", "insetBlockStart", "auto"],
    ["inset-block-end", "insetBlockEnd", "auto"],
  ] as const;
  for (const [cssProperty, camelProperty, defaultValue] of explicitComputedProperties) {
    const value = style.getPropertyValue(cssProperty).trim();
    if (value && value.toLowerCase() !== defaultValue) values[camelProperty] = value;
  }
  return values;
}

function computedStyleMapWithResolvedMasks(style: CSSStyleDeclaration, doc: Document, element?: Element): Record<string, string> {
  const values = computedStyleMap(style);
  const unicodeBidi = capturedUnicodeBidi(style, element);
  if (unicodeBidi === "normal") delete values.unicodeBidi;
  else values.unicodeBidi = unicodeBidi;
  const currentColor = String(style.color || "rgb(0, 0, 0)");
  // Keep paint-bearing computed styles consistent with the concrete values
  // stored on the shared scene. Figma's importer does not resolve the CSS
  // currentColor keyword inside gradients or border-image sources.
  for (const property of [
    "backgroundImage", "backgroundColor", "borderImageSource",
    "borderTopColor", "borderRightColor", "borderBottomColor", "borderLeftColor",
    "outlineColor", "textDecorationColor", "WebkitTextStrokeColor", "WebkitTextFillColor",
    "boxShadow", "textShadow", "filter", "backdropFilter",
  ]) {
    const value = String(values[property] || "").trim();
    if (value) values[property] = resolveCurrentColor(value, currentColor);
  }
  for (const property of ["maskImage", "WebkitMaskImage", "webkitMaskImage"] as const) {
    const value = String(values[property] || "").trim();
    if (value) {
      values[property] = resolveCssImageUrls(
        normalizeImageSetForDevicePixelRatio(value, doc.defaultView?.devicePixelRatio ?? 1),
        doc,
      );
    }
  }
  return values;
}

/** Preserve resolved min/max bounds as a separate constraint channel. The
 * plugin applies this after the measured border box is set, so Auto Layout
 * cannot discard a captured responsive bound while the tree is assembled. */
export function sizingConstraintsFor(
  style: Pick<CSSStyleDeclaration, "minWidth" | "maxWidth" | "minHeight" | "maxHeight">,
  element?: Element,
): Partial<Record<"minWidth" | "maxWidth" | "minHeight" | "maxHeight", string>> {
  const properties: Array<"minWidth" | "maxWidth" | "minHeight" | "maxHeight"> = ["minWidth", "maxWidth", "minHeight", "maxHeight"];
  const computed = element?.ownerDocument.defaultView?.getComputedStyle(element);
  const writingMode = String(
    (computed as CSSStyleDeclaration & { writingMode?: string } | undefined)?.writingMode
      || computed?.getPropertyValue("writing-mode")
      || "horizontal-tb",
  ).trim().toLowerCase();
  const defaultConstraintTokens = new Set(["auto", "none", "normal", "initial", "unset", "revert", "revert-layer"]);
  const verticalWriting = writingMode.startsWith("vertical-") || writingMode.startsWith("sideways-");
  const logicalPropertyFor: Record<typeof properties[number], SizingProperty> = verticalWriting
    ? {
      minWidth: "minBlockSize",
      maxWidth: "maxBlockSize",
      minHeight: "minInlineSize",
      maxHeight: "maxInlineSize",
    }
    : {
      minWidth: "minInlineSize",
      maxWidth: "maxInlineSize",
      minHeight: "minBlockSize",
      maxHeight: "maxBlockSize",
    };
  return properties.reduce((result, property) => {
    // Computed styles can collapse responsive bounds (for example `50%` or
    // `clamp(...)`) to the current pixel result. Preserve the winning authored
    // declaration when the DOM element is available, while retaining the
    // computed value as the fallback for compatibility/fixture callers.
    const physical = element ? authoredStylesheetValue(element, property) : "";
    const physicalToken = physical.trim().toLowerCase();
    const authored = element
      ? (!physical || defaultConstraintTokens.has(physicalToken)
        ? authoredStylesheetValue(element, logicalPropertyFor[property]) || physical
        : physical)
      : "";
    const value = String(authored || style[property] || "").trim();
    if (value && !defaultConstraintTokens.has(value.toLowerCase())) result[property] = value;
    return result;
  }, {} as Partial<Record<"minWidth" | "maxWidth" | "minHeight" | "maxHeight", string>>);
}

/**
 * CSS individual transform properties participate in rendering even when the
 * shorthand `transform` remains `none`. Normalize them into the shared
 * transform channel so native Figma imports do not silently drop or double
 * apply a translate/rotate/scale declaration.
 */
export function effectiveTransform(style: Pick<CSSStyleDeclaration, "transform"> & Partial<Record<"translate" | "rotate" | "scale", string>>): string {
  const shorthand = String(style.transform || "none").trim();
  if (shorthand && shorthand !== "none") return shorthand;
  const individualProperties: Array<"translate" | "rotate" | "scale"> = ["translate", "rotate", "scale"];
  const individual = individualProperties
    .map((property) => {
      const value = String(style[property] || "none").trim();
      return value && value !== "none" ? `${property}(${value})` : "";
    })
    .filter((value) => value && value !== "none");
  return individual.length ? individual.join(" ") : "none";
}

/**
 * Preserve a non-default transform origin on the shared scene. The plugin
 * applies the captured affine matrix after the node has been positioned; if
 * this value is left only in computedStyles, the shared-scene path silently
 * falls back to Figma's center origin and moves transformed layers.
 */
export function transformOriginFor(
  style: Pick<CSSStyleDeclaration, "transform" | "transformOrigin"> & Partial<Record<"translate" | "rotate" | "scale", string>>,
): string | undefined {
  if (effectiveTransform(style) === "none") return undefined;
  const origin = String(style.transformOrigin || "50% 50%").trim();
  return origin && origin !== "50% 50%" ? origin : undefined;
}

interface TransformLengthContext {
  width?: number;
  height?: number;
  fontSize?: number;
  rootFontSize?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

export function transformMatrixValues(
  value: string,
  lengthContext: TransformLengthContext = {},
): [number, number, number, number, number, number] | undefined {
  const parseNumber = (token: string | undefined): number => {
    const match = String(token || "").trim().match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i);
    return match ? Number(match[0]) : Number.NaN;
  };
  const parseLength = (token: string | undefined, reference: number, allowPercentage = true): number => {
    const normalized = String(token || "").trim().toLowerCase();
    const unitless = normalized.match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i);
    if (unitless && Math.abs(Number(unitless[0])) > Number.EPSILON) return Number.NaN;
    if (!allowPercentage && /%/.test(normalized)) return Number.NaN;
    const resolved = resolvedLengthValue(
      normalized,
      reference,
      Number(lengthContext.fontSize) || 16,
      Number(lengthContext.rootFontSize) || 16,
      Number(lengthContext.viewportWidth) || 0,
      Number(lengthContext.viewportHeight) || 0,
    );
    return resolved == null || !Number.isFinite(resolved) ? Number.NaN : resolved;
  };
  const parseAngle = (token: string | undefined): number => {
    const normalized = String(token || "0").trim().toLowerCase();
    const match = normalized.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)?$/i);
    const parsed = match ? Number(match[1]) : Number.NaN;
    if (!Number.isFinite(parsed)) return Number.NaN;
    if (match?.[2] === "turn") return parsed * Math.PI * 2;
    if (match?.[2] === "grad") return parsed * Math.PI / 200;
    if (match?.[2] === "rad") return parsed;
    return parsed * Math.PI / 180;
  };
  const multiply = (left: [number, number, number, number, number, number], right: [number, number, number, number, number, number]): [number, number, number, number, number, number] => {
    const [a1, b1, c1, d1, e1, f1] = left;
    const [a2, b2, c2, d2, e2, f2] = right;
    return [
      a1 * a2 + c1 * b2,
      b1 * a2 + d1 * b2,
      a1 * c2 + c1 * d2,
      b1 * c2 + d1 * d2,
      a1 * e2 + c1 * f2 + e1,
      b1 * e2 + d1 * f2 + f1,
    ];
  };
  const functions: Array<{ name: string; args: string[] }> = [];
  const source = String(value || "");
  const functionPattern = /([a-z0-9]+)\(/gi;
  let match: RegExpExecArray | null;
  while ((match = functionPattern.exec(source))) {
    let depth = 1;
    let index = functionPattern.lastIndex;
    for (; index < source.length && depth > 0; index += 1) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") depth -= 1;
    }
    if (depth !== 0) return undefined;
    functions.push({
      name: match[1].toLowerCase(),
      args: splitCssArguments(source.slice(functionPattern.lastIndex, index - 1)),
    });
    functionPattern.lastIndex = index;
  }
  if (!functions.length) return undefined;
  let result: [number, number, number, number, number, number] = [1, 0, 0, 1, 0, 0];
  for (const entry of functions) {
    const args = entry.args.length === 1 && /\s+/.test(entry.args[0])
      ? splitCssSpaceValues(entry.args[0])
      : entry.args;
    let current: [number, number, number, number, number, number] | undefined;
    if (entry.name === "matrix" && args.length === 6) {
      current = args.map(parseNumber) as typeof current;
    } else if (entry.name === "matrix3d" && args.length === 16) {
      const values = args.map(parseNumber);
      const is2d = [values[2], values[3], values[6], values[7], values[8], values[9], values[11], values[14]]
        .every((item) => Math.abs(item) < 0.000001)
        && Math.abs(values[10] - 1) < 0.000001
        && Math.abs(values[15] - 1) < 0.000001;
      if (is2d) current = [values[0], values[1], values[4], values[5], values[12], values[13]];
      else return undefined;
    } else if (entry.name === "translate" || entry.name === "translate3d") {
      const x = parseLength(args[0], Number(lengthContext.width) || 0);
      const y = parseLength(args[1] ?? "0", Number(lengthContext.height) || 0);
      const z = entry.name === "translate3d" ? parseLength(args[2], 0, false) : 0;
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || Math.abs(z) > 0.000001) return undefined;
      current = [1, 0, 0, 1, x, y];
    } else if (["translatex", "translatey"].includes(entry.name)) {
      current = entry.name === "translatex"
        ? [1, 0, 0, 1, parseLength(args[0], Number(lengthContext.width) || 0), 0]
        : [1, 0, 0, 1, 0, parseLength(args[0], Number(lengthContext.height) || 0)];
    } else if (["scale", "scalex", "scaley"].includes(entry.name)) {
      const sx = parseNumber(args[0]);
      const parsedSy = parseNumber(args[1]);
      const sy = entry.name === "scalex" ? 1 : entry.name === "scaley" ? sx : Number.isFinite(parsedSy) ? parsedSy : sx;
      current = [sx, 0, 0, sy, 0, 0];
    } else if (entry.name === "scale3d") {
      const sz = parseNumber(args[2]);
      if (!Number.isFinite(sz) || Math.abs(sz - 1) > 0.000001) return undefined;
      const sx = parseNumber(args[0]);
      const sy = parseNumber(args[1]);
      current = [sx, 0, 0, sy, 0, 0];
    } else if (["rotate", "rotatez"].includes(entry.name)) {
      const radians = parseAngle(args[0]);
      current = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
    } else if (entry.name === "skewx") {
      current = [1, 0, Math.tan(parseAngle(args[0])), 1, 0, 0];
    } else if (entry.name === "skewy") {
      current = [1, Math.tan(parseAngle(args[0])), 0, 1, 0, 0];
    } else if (entry.name === "skew") {
      current = [1, Math.tan(parseAngle(args[1] || "0")), Math.tan(parseAngle(args[0])), 1, 0, 0];
    } else {
      return undefined;
    }
    if (!current || !current.every(Number.isFinite)) return undefined;
    result = multiply(result, current);
  }
  return result.every(Number.isFinite) ? result : undefined;
}

export function rectWithoutAxisTransform(element: Element, rect: DOMRect): DOMRect {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const transform = style ? effectiveTransform(style) : "none";
  if (!transform || transform === "none") return rect;
  const elementWithLayoutSize = element as Element & { offsetWidth?: number; offsetHeight?: number };
  const fallbackWidth = Number(elementWithLayoutSize.offsetWidth);
  const fallbackHeight = Number(elementWithLayoutSize.offsetHeight);
  const hasFallbackSize = Number.isFinite(fallbackWidth) && fallbackWidth > 0
    && Number.isFinite(fallbackHeight) && fallbackHeight > 0;
  const rootFontSize = numberValue(
    element.ownerDocument.defaultView?.getComputedStyle(element.ownerDocument.documentElement)?.fontSize || "16px",
    16,
  );
  const fontSize = numberValue(style?.fontSize || "16px", 16);
  const viewportWidth = Number(element.ownerDocument.defaultView?.innerWidth || 0);
  const viewportHeight = Number(element.ownerDocument.defaultView?.innerHeight || 0);
  const matrix = transformMatrixValues(transform, {
    width: Number.isFinite(fallbackWidth) && fallbackWidth > 0 ? fallbackWidth : rect.width,
    height: Number.isFinite(fallbackHeight) && fallbackHeight > 0 ? fallbackHeight : rect.height,
    fontSize,
    rootFontSize,
    viewportWidth,
    viewportHeight,
  });
  if (!matrix) return rect;
  const [a, b, c, d, e, f] = matrix;
  // getBoundingClientRect() is an axis-aligned box after CSS transforms. If
  // the same box is resized in Figma and the affine matrix is then applied,
  // rotated/skewed layers are transformed twice and visibly grow. Recover the
  // pre-transform width/height from the four-corner envelope first. The
  // absolute coefficients are intentional: the browser's bounding box uses
  // extrema, not signed matrix components.
  const aa = Math.abs(a);
  const bb = Math.abs(b);
  const cc = Math.abs(c);
  const dd = Math.abs(d);
  const determinant = aa * dd - cc * bb;
  const width = Number.isFinite(determinant) && Math.abs(determinant) > 1e-6
    ? (rect.width * dd - cc * rect.height) / determinant
    : hasFallbackSize ? fallbackWidth : Number.NaN;
  const height = Number.isFinite(determinant) && Math.abs(determinant) > 1e-6
    ? (aa * rect.height - bb * rect.width) / determinant
    : hasFallbackSize ? fallbackHeight : Number.NaN;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return rect;
  const origin = splitCssSpaceValues(String(style?.transformOrigin || "50% 50%")).slice(0, 2);
  const resolveOrigin = (value: string | undefined, size: number, axis: "x" | "y"): number => {
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || normalized === "center") return size / 2;
    if ((axis === "x" && normalized === "left") || (axis === "y" && normalized === "top")) return 0;
    if ((axis === "x" && normalized === "right") || (axis === "y" && normalized === "bottom")) return size;
    const resolved = gapValue(
      normalized,
      size,
      fontSize,
      rootFontSize,
      viewportWidth,
      viewportHeight,
      false,
    );
    return Number.isFinite(resolved) ? resolved : size / 2;
  };
  const firstOrigin = origin[0] || "50%";
  const secondOrigin = origin[1] || "";
  const horizontal = (value: string) => value === "left" || value === "right";
  const vertical = (value: string) => value === "top" || value === "bottom";
  const swap = vertical(firstOrigin.toLowerCase()) && !vertical(secondOrigin.toLowerCase())
    || horizontal(secondOrigin.toLowerCase()) && !horizontal(firstOrigin.toLowerCase());
  const originX = resolveOrigin(swap ? secondOrigin : firstOrigin, width, "x");
  const originY = resolveOrigin(swap ? firstOrigin : secondOrigin, height, "y");
  const corners = [
    [0, 0], [width, 0], [0, height], [width, height],
  ].map(([x, y]) => ({
    x: a * (x - originX) + c * (y - originY) + originX + e,
    y: b * (x - originX) + d * (y - originY) + originY + f,
  }));
  const minX = Math.min(...corners.map((corner) => corner.x));
  const minY = Math.min(...corners.map((corner) => corner.y));
  return new DOMRect(
    rect.left - minX,
    rect.top - minY,
    width,
    height,
  );
}

function rectFor(element: Element, parentRect?: DOMRect, parentScaleX = 1, parentScaleY = 1): DesignRect {
  const rect = rectWithoutAxisTransform(element, element.getBoundingClientRect());
  return {
    x: Math.round(((rect.left - (parentRect?.left ?? 0)) / Math.max(0.01, parentScaleX)) * 100) / 100,
    y: Math.round(((rect.top - (parentRect?.top ?? 0)) / Math.max(0.01, parentScaleY)) * 100) / 100,
    width: Math.round((rect.width / Math.max(0.01, parentScaleX)) * 100) / 100,
    height: Math.round((rect.height / Math.max(0.01, parentScaleY)) * 100) / 100,
  };
}

function axisTransformScale(style: CSSStyleDeclaration, element?: Element): { x: number; y: number } {
  const transform = effectiveTransform(style);
  if (!transform || transform === "none") return { x: 1, y: 1 };
  const layoutElement = element as (Element & { offsetWidth?: number; offsetHeight?: number }) | undefined;
  const rect = element?.getBoundingClientRect?.();
  const width = Number(layoutElement?.offsetWidth) > 0 ? Number(layoutElement?.offsetWidth) : Number(rect?.width || 0);
  const height = Number(layoutElement?.offsetHeight) > 0 ? Number(layoutElement?.offsetHeight) : Number(rect?.height || 0);
  const rootFontSize = numberValue(
    element?.ownerDocument.defaultView?.getComputedStyle(element.ownerDocument.documentElement)?.fontSize || "16px",
    16,
  );
  const fontSize = numberValue(style.fontSize || "16px", 16);
  const matrix = transformMatrixValues(transform, {
    width,
    height,
    fontSize,
    rootFontSize,
    viewportWidth: Number(element?.ownerDocument.defaultView?.innerWidth || 0),
    viewportHeight: Number(element?.ownerDocument.defaultView?.innerHeight || 0),
  });
  if (!matrix) return { x: 1, y: 1 };
  const [a, b, c, d] = matrix;
  if (![a, b, c, d].every(Number.isFinite) || Math.abs(b) > 1e-6 || Math.abs(c) > 1e-6) return { x: 1, y: 1 };
  return { x: Math.max(0.01, Math.abs(a)), y: Math.max(0.01, Math.abs(d)) };
}

function colorFromStyle(value: string): DesignColor | undefined {
  if (!value || value === "transparent" || value === "rgba(0, 0, 0, 0)") return undefined;
  return { color: value };
}

/**
 * Resolve the CSS currentColor keyword before a value crosses the capture
 * boundary. Browsers may keep currentColor inside gradient functions in the
 * computed background/border string; the Figma native paint parser and SVG
 * fallback both need the concrete inherited text color instead.
 */
export function resolveCurrentColor(value: string, currentColor: string): string {
  const source = String(value ?? "");
  const replacement = String(currentColor ?? "").trim() || "rgb(0, 0, 0)";
  return source.replace(/\bcurrentcolor\b/gi, replacement);
}

export function isTextBackgroundClip(style: CSSStyleDeclaration): boolean {
  const extended = style as CSSStyleDeclaration & { webkitBackgroundClip?: string; WebkitBackgroundClip?: string };
  return [style.backgroundClip, extended.webkitBackgroundClip, extended.WebkitBackgroundClip]
    .some(value => String(value || "").trim().toLowerCase() === "text");
}

/**
 * Keep blended gradient/image layers on the native paint path. Flattening
 * those layers into one SVG fallback loses the per-layer blend mode that the
 * plugin can reproduce with Figma paints.
 */
export function shouldUseBackgroundSvgFallback(style: Pick<CSSStyleDeclaration, "backgroundImage" | "backgroundColor" | "backgroundBlendMode" | "backgroundClip">): boolean {
  const blendModes = String(style.backgroundBlendMode || "normal")
    .split(/\s*,\s*/)
    .map(value => value.trim().toLowerCase())
    .filter(Boolean);
  if (blendModes.some(value => value !== "normal")) return false;
  if (isTextBackgroundClip(style as CSSStyleDeclaration)) return false;

  // Pure CSS gradients have a native editable representation in the Figma
  // importer. Do not eagerly flatten those layers into an SVG asset at the
  // capture boundary: doing so makes the later plugin import prefer a vector
  // image over the native GRADIENT_* paints. The plugin still retains an SVG
  // recovery path when a particular gradient cannot be parsed or fails its
  // Figma read-back verification.
  const backgroundImage = String(style.backgroundImage || "").trim();
  const hasGradient = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(backgroundImage);
  const hasUrl = /\burl\s*\(/i.test(backgroundImage);
  if (hasGradient && !hasUrl) return false;
  return true;
}

function shadowColorToken(layer: string): string | undefined {
  // CSS Color 4 functions can contain nested parentheses (notably
  // color-mix() with color() stops). Match the complete balanced function
  // before falling back to legacy named/hex colors so the shadow lengths are
  // not mistaken for a missing paint.
  const functionPattern = /(?:rgba?|hsla?|lab|lch|oklab|oklch|hwb|color(?:-mix)?)\(/gi;
  let match: RegExpExecArray | null;
  while ((match = functionPattern.exec(layer))) {
    let depth = 1;
    let index = functionPattern.lastIndex;
    for (; index < layer.length && depth > 0; index += 1) {
      if (layer[index] === "(") depth += 1;
      else if (layer[index] === ")") depth -= 1;
    }
    if (depth === 0) return layer.slice(match.index, index);
    break;
  }
  return Array.from(layer.matchAll(/#[0-9a-f]{3,8}\b|\b(?:transparent|currentcolor|[a-z]+)\b/gi))
    .map((entry) => entry[0])
    .find((candidate) => candidate.toLowerCase() !== "inset");
}

export function shadowFromStyle(value: string, currentColor?: string): DesignNode["shadow"] {
  if (!value || value === "none") return undefined;
  const layer = value.split(/,(?![^()]*\))/)[0]?.trim();
  if (!layer) return undefined;
  const color = shadowColorToken(layer);
  const withoutColor = color ? layer.replace(color, " ") : layer;
  const lengths = withoutColor.match(/(-?(?:\d+(?:\.\d*)?|\.\d+))(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)?/gi) ?? [];
  if (lengths.length < 3) return undefined;
  const match = lengths.slice(0, 4).map((token) => numberValue(token));
  return {
    offsetX: match[0],
    offsetY: match[1],
    blur: match[2],
    spread: match[3] ?? 0,
    color: color?.toLowerCase() === "currentcolor" && currentColor ? currentColor : color || "rgba(0,0,0,0.18)",
    inset: /\binset\b/i.test(layer),
  };
}

export function shadowsFromStyle(value: string, currentColor?: string): NonNullable<DesignNode["shadows"]> {
  if (!value || value === "none") return [];
  return value
    .split(/,(?![^()]*\))/)
    .map((layer) => shadowFromStyle(layer.trim(), currentColor))
    .filter((shadow): shadow is NonNullable<DesignNode["shadow"]> => Boolean(shadow));
}

type BoxEdgeKind = "padding" | "margin";

function authoredBoxEdgeValue(element: Element, kind: BoxEdgeKind, side: string): string {
  const prefix = kind === "padding" ? "padding" : "margin";
  const direct = authoredStylesheetValue(element, `${prefix}${side[0].toUpperCase()}${side.slice(1)}` as SizingProperty).trim();
  if (direct) return direct;
  const normalizedSide = side.toLowerCase();
  const logicalAxis = normalizedSide.startsWith("inline") ? "inline" : normalizedSide.startsWith("block") ? "block" : "";
  const shorthand = logicalAxis ? `${prefix}${logicalAxis[0].toUpperCase()}${logicalAxis.slice(1)}` : prefix;
  const raw = authoredStylesheetValue(element, shorthand as SizingProperty).trim();
  if (!raw) return "";
  if (logicalAxis) {
    const values = splitCssSpaceValues(raw);
    return side.endsWith("Start") ? (values[0] || "") : (values[1] || values[0] || "");
  }
  const values = expandedCssBoxValues(raw);
  const index = side === "Top" ? 0 : side === "Right" ? 1 : side === "Bottom" ? 2 : 3;
  return values[index] || "";
}

function logicalBoxEdges(
  style: CSSStyleDeclaration,
  element: Element | undefined,
  kind: BoxEdgeKind,
): [number, number, number, number] {
  const prefix = kind === "padding" ? "padding" : "margin";
  const physical = {
    top: numberValue(String(style[`${prefix}Top` as keyof CSSStyleDeclaration] ?? "")),
    right: numberValue(String(style[`${prefix}Right` as keyof CSSStyleDeclaration] ?? "")),
    bottom: numberValue(String(style[`${prefix}Bottom` as keyof CSSStyleDeclaration] ?? "")),
    left: numberValue(String(style[`${prefix}Left` as keyof CSSStyleDeclaration] ?? "")),
  };
  const read = (camel: string): number | undefined => {
    const cssName = camel.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
    let token = String((style as CSSStyleDeclaration & Record<string, unknown>)[camel] ?? "").trim();
    if (!token && typeof style.getPropertyValue === "function") token = style.getPropertyValue(cssName).trim();
    // A computed declaration is preferred. Authored fallbacks are limited to
    // absolute values because percentages/functions need a containing-block
    // reference and should remain represented by the browser's physical used
    // values instead of being parsed as raw numbers.
    if (element) {
      const authored = authoredBoxEdgeValue(element, kind, camel.slice(prefix.length));
      if (authored && /^[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(authored)) {
        // jsdom and a few compatibility bridges expose a shorthand's last
        // token for every physical longhand. Prefer the authored absolute
        // edge in that case; it is unambiguous and avoids spreading one side
        // across all four Figma edges.
        token = authored;
      } else if (!token || /^0(?:\.0+)?px$/i.test(token)) {
        if (authored) token = authored;
      }
    }
    if (!token || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:px)?$/i.test(token)) return undefined;
    return numberValue(token);
  };
  // Keep the computed physical edges as the fallback, but let authored
  // shorthand declarations participate when a compatibility capture exposes
  // only default/empty longhands. This is especially important for CSS
  // `padding`/`margin` shorthands, whose values are expanded by the browser
  // before the logical writing-mode remap runs.
  const resolvedPhysical = {
    top: read(`${prefix}Top`) ?? physical.top,
    right: read(`${prefix}Right`) ?? physical.right,
    bottom: read(`${prefix}Bottom`) ?? physical.bottom,
    left: read(`${prefix}Left`) ?? physical.left,
  };
  const logical = {
    inlineStart: read(`${prefix}InlineStart`),
    inlineEnd: read(`${prefix}InlineEnd`),
    blockStart: read(`${prefix}BlockStart`),
    blockEnd: read(`${prefix}BlockEnd`),
  };
  const logicalProperties = Object.keys(logical) as Array<keyof typeof logical>;
  const hasAuthoredLogical = Boolean(element && [
    ...logicalProperties.map((side) => `${prefix}${side[0].toUpperCase()}${side.slice(1)}` as SizingProperty),
    `${prefix}Inline` as SizingProperty,
    `${prefix}Block` as SizingProperty,
  ].some((property) => authoredStylesheetValue(element, property).trim()));
  const hasAuthoredPhysical = Boolean(element && [
    prefix as SizingProperty,
    `${prefix}Top` as SizingProperty,
    `${prefix}Right` as SizingProperty,
    `${prefix}Bottom` as SizingProperty,
    `${prefix}Left` as SizingProperty,
  ].some((property) => authoredStylesheetValue(element, property).trim()));
  // Some engines expose physical shorthand values through every logical
  // computed longhand. When the authored declaration is physical, those
  // synthetic logical values must not override the four resolved edges.
  const mappedLogical = hasAuthoredPhysical && !hasAuthoredLogical
    ? { inlineStart: undefined, inlineEnd: undefined, blockStart: undefined, blockEnd: undefined }
    : logical;
  const hasNonDefaultLogical = Object.values(mappedLogical).some((value) => value !== undefined && Math.abs(value) > 0.001);
  // Some engines expose every logical longhand as a computed `0px` even when
  // the page only authored physical edges. Keep the physical values in that
  // case; only an authored logical declaration or a non-default logical used
  // value should activate the writing-mode remap.
  if (!hasAuthoredLogical && !hasNonDefaultLogical) return [resolvedPhysical.top, resolvedPhysical.right, resolvedPhysical.bottom, resolvedPhysical.left];
  const writingMode = String(
    (style as CSSStyleDeclaration & { writingMode?: string }).writingMode
      || style.getPropertyValue("writing-mode")
      || "horizontal-tb",
  ).trim().toLowerCase();
  const direction = String(style.direction || style.getPropertyValue("direction") || "ltr").trim().toLowerCase();
  const rtl = direction.startsWith("rtl");
  const value = (candidate: number | undefined, fallback: number): number => candidate ?? fallback;
  if (writingMode.startsWith("vertical-") || writingMode.startsWith("sideways-")) {
    const right = writingMode.includes("-lr")
      ? value(mappedLogical.blockEnd, resolvedPhysical.right)
      : value(mappedLogical.blockStart, resolvedPhysical.right);
    const left = writingMode.includes("-lr")
      ? value(mappedLogical.blockStart, resolvedPhysical.left)
      : value(mappedLogical.blockEnd, resolvedPhysical.left);
    const top = rtl ? value(mappedLogical.inlineEnd, resolvedPhysical.top) : value(mappedLogical.inlineStart, resolvedPhysical.top);
    const bottom = rtl ? value(mappedLogical.inlineStart, resolvedPhysical.bottom) : value(mappedLogical.inlineEnd, resolvedPhysical.bottom);
    return [top, right, bottom, left];
  }
  const left = rtl ? value(mappedLogical.inlineEnd, resolvedPhysical.left) : value(mappedLogical.inlineStart, resolvedPhysical.left);
  const right = rtl ? value(mappedLogical.inlineStart, resolvedPhysical.right) : value(mappedLogical.inlineEnd, resolvedPhysical.right);
  return [value(mappedLogical.blockStart, resolvedPhysical.top), right, value(mappedLogical.blockEnd, resolvedPhysical.bottom), left];
}

function parsePadding(style: CSSStyleDeclaration, element?: Element): [number, number, number, number] {
  return logicalBoxEdges(style, element, "padding");
}

function parseMargin(style: CSSStyleDeclaration, element?: Element): [number, number, number, number] {
  return logicalBoxEdges(style, element, "margin");
}

/**
 * Keep CSS auto margins separate from their measured numeric edges. Auto
 * margins consume free space and cannot be represented by a fixed spacer in
 * Figma Auto Layout, so callers use this marker to preserve measured geometry
 * and retain the authored constraint for inspection.
 */
export function autoMarginEdges(
  style: CSSStyleDeclaration,
  element?: Element,
): [boolean, boolean, boolean, boolean] | undefined {
  const read = (side: "Top" | "Right" | "Bottom" | "Left" | "InlineStart" | "InlineEnd" | "BlockStart" | "BlockEnd"): string => {
    const authored = element ? authoredBoxEdgeValue(element, "margin", side) : "";
    if (authored) return authored.trim().toLowerCase();
    const camel = `margin${side}`;
    const direct = String((style as CSSStyleDeclaration & Record<string, unknown>)[camel] ?? "").trim();
    if (direct) return direct.toLowerCase();
    const cssName = camel.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
    return style.getPropertyValue?.(cssName).trim().toLowerCase() || "";
  };
  const physical = {
    top: read("Top") === "auto",
    right: read("Right") === "auto",
    bottom: read("Bottom") === "auto",
    left: read("Left") === "auto",
  };
  const logicalTokens = {
    inlineStart: read("InlineStart"),
    inlineEnd: read("InlineEnd"),
    blockStart: read("BlockStart"),
    blockEnd: read("BlockEnd"),
  };
  const hasAuthoredLogical = Boolean(element && [
    "marginInlineStart", "marginInlineEnd", "marginBlockStart", "marginBlockEnd", "marginInline", "marginBlock",
  ].some((property) => authoredStylesheetValue(element, property as SizingProperty).trim()));
  const hasLogicalAuto = Object.values(logicalTokens).some((value) => value === "auto");
  if (!hasAuthoredLogical && !hasLogicalAuto) {
    const result: [boolean, boolean, boolean, boolean] = [physical.top, physical.right, physical.bottom, physical.left];
    return result.some(Boolean) ? result : undefined;
  }
  const writingMode = String(
    (style as CSSStyleDeclaration & { writingMode?: string }).writingMode
      || style.getPropertyValue?.("writing-mode")
      || "horizontal-tb",
  ).trim().toLowerCase();
  const rtl = String(style.direction || style.getPropertyValue?.("direction") || "ltr").trim().toLowerCase().startsWith("rtl");
  const logical = {
    inlineStart: logicalTokens.inlineStart === "auto",
    inlineEnd: logicalTokens.inlineEnd === "auto",
    blockStart: logicalTokens.blockStart === "auto",
    blockEnd: logicalTokens.blockEnd === "auto",
  };
  let result: [boolean, boolean, boolean, boolean];
  if (writingMode.startsWith("vertical-") || writingMode.startsWith("sideways-")) {
    result = [
      rtl ? logical.inlineEnd || physical.top : logical.inlineStart || physical.top,
      writingMode.includes("-lr") ? logical.blockEnd || physical.right : logical.blockStart || physical.right,
      rtl ? logical.inlineStart || physical.bottom : logical.inlineEnd || physical.bottom,
      writingMode.includes("-lr") ? logical.blockStart || physical.left : logical.blockEnd || physical.left,
    ];
  } else {
    result = [
      logical.blockStart || physical.top,
      rtl ? logical.inlineStart || physical.right : logical.inlineEnd || physical.right,
      logical.blockEnd || physical.bottom,
      rtl ? logical.inlineEnd || physical.left : logical.inlineStart || physical.left,
    ];
  }
  return result.some(Boolean) ? result : undefined;
}

function radiusValue(value: string, horizontalSize: number, verticalSize: number): number {
  const parts = String(value || "0").trim().split(/\s+/).filter(Boolean);
  const resolve = (part: string, size: number): number => {
    if (part.endsWith("%")) return numberValue(part) * size / 100;
    return numberValue(part);
  };
  const horizontal = resolve(parts[0] || "0", horizontalSize);
  const vertical = resolve(parts[1] || parts[0] || "0", verticalSize);
  // Figma exposes one circular radius per corner. The smaller axis preserves
  // the CSS corner without making the imported shape overflow its box.
  return Math.max(0, Math.min(horizontal, vertical));
}

export function radiusFor(style: CSSStyleDeclaration, width: number, height: number): [number, number, number, number] {
  const radii = [
    radiusValue(style.borderTopLeftRadius, width, height),
    radiusValue(style.borderTopRightRadius, width, height),
    radiusValue(style.borderBottomRightRadius, width, height),
    radiusValue(style.borderBottomLeftRadius, width, height),
  ];
  // CSS scales all corner radii when adjacent radii exceed an edge. Figma's
  // per-corner API does not perform that browser normalization consistently,
  // so apply the same conservative scale before crossing into the native
  // scene model. The H2D path still retains the original CSS radius strings.
  const safeWidth = Math.max(0, Number(width) || 0);
  const safeHeight = Math.max(0, Number(height) || 0);
  const horizontalSum = Math.max(radii[0] + radii[1], radii[2] + radii[3]);
  const verticalSum = Math.max(radii[0] + radii[3], radii[1] + radii[2]);
  const horizontalScale = horizontalSum > safeWidth && horizontalSum > 0 ? safeWidth / horizontalSum : 1;
  const verticalScale = verticalSum > safeHeight && verticalSum > 0 ? safeHeight / verticalSum : 1;
  const scale = Math.min(horizontalScale, verticalScale);
  return scale < 1
    ? [radii[0] * scale, radii[1] * scale, radii[2] * scale, radii[3] * scale]
    : [radii[0], radii[1], radii[2], radii[3]];
}

function alignmentKeyword(value: string): string {
  return String(value || "").trim().toLowerCase().replace(/^(?:safe|unsafe)\s+/, "");
}

function alignValue(value: string): DesignLayout["alignItems"] {
  const normalized = alignmentKeyword(value);
  if (normalized === "center") return "center";
  if (normalized === "flex-end" || normalized === "end" || normalized === "self-end") return "end";
  if (normalized === "stretch") return "stretch";
  if (normalized === "baseline" || normalized === "first baseline" || normalized === "last baseline") return "baseline";
  return "start";
}

function alignSelfValue(value: string): NonNullable<DesignLayout["alignSelf"]> {
  const normalized = alignmentKeyword(value);
  if (normalized === "center") return "center";
  if (normalized === "flex-end" || normalized === "end") return "end";
  if (normalized === "stretch") return "stretch";
  if (normalized === "baseline" || normalized === "first baseline" || normalized === "last baseline") return "baseline";
  if (normalized === "flex-start" || normalized === "start" || normalized === "self-start") return "start";
  if (normalized === "self-end") return "end";
  return "auto";
}

function justifyValue(value: string, isGrid = false): DesignLayout["justifyContent"] {
  const normalized = alignmentKeyword(value);
  if (isGrid && (normalized === "normal" || normalized === "stretch")) return "stretch";
  if (normalized === "center") return "center";
  if (normalized === "flex-end" || normalized === "end") return "end";
  if (normalized === "space-between") return "space-between";
  if (normalized === "space-around") return "space-around";
  if (normalized === "space-evenly") return "space-evenly";
  return "start";
}

function contentAlignValue(value: string): NonNullable<DesignLayout["alignContent"]> {
  const normalized = alignmentKeyword(value);
  if (normalized === "normal") return "stretch";
  if (normalized === "center") return "center";
  if (normalized === "flex-end" || normalized === "end") return "end";
  if (normalized === "space-between") return "space-between";
  if (normalized === "space-around") return "space-around";
  if (normalized === "space-evenly") return "space-evenly";
  if (normalized === "stretch") return "stretch";
  return "start";
}

function justifyItemsValue(value: string): NonNullable<DesignLayout["justifyItems"]> {
  const normalized = alignmentKeyword(value);
  if (normalized === "center") return "center";
  if (normalized === "end" || normalized === "flex-end" || normalized === "self-end") return "end";
  if (normalized === "stretch") return "stretch";
  return "start";
}

function justifySelfValue(value: string): NonNullable<DesignLayout["justifySelf"]> {
  const normalized = alignmentKeyword(value);
  if (normalized === "center") return "center";
  if (normalized === "end" || normalized === "flex-end" || normalized === "self-end") return "end";
  if (normalized === "stretch") return "stretch";
  if (normalized === "start" || normalized === "flex-start" || normalized === "self-start") return "start";
  return "auto";
}

function stickyInsetValue(style: CSSStyleDeclaration, camelProperty: string, cssProperty: string): string {
  return String(cssStyleValue(style, camelProperty, cssProperty) || "auto").trim().toLowerCase();
}

function isActivePositionInset(value: string): boolean {
  return Boolean(value) && !["auto", "normal", "initial", "unset", "revert", "revert-layer"].includes(value);
}

/**
 * CSS sticky only differs from normal relative positioning when at least one
 * inset establishes a scroll threshold. With all insets set to `auto`, the
 * element participates in ordinary flow and must not be converted into a
 * measured absolute layer during Figma import.
 */
export function hasActiveStickyInset(style: CSSStyleDeclaration): boolean {
  return [
    ["top", "top"], ["right", "right"], ["bottom", "bottom"], ["left", "left"],
    ["insetBlockStart", "inset-block-start"], ["insetBlockEnd", "inset-block-end"],
    ["insetInlineStart", "inset-inline-start"], ["insetInlineEnd", "inset-inline-end"],
  ].some(([camelProperty, cssProperty]) => isActivePositionInset(stickyInsetValue(style, camelProperty, cssProperty)));
}

function positioningValue(value: string | CSSStyleDeclaration): NonNullable<DesignNode["positioning"]> {
  const position = typeof value === "string"
    ? value.trim().toLowerCase()
    : String(cssStyleValue(value, "position", "position") || "static").trim().toLowerCase();
  if (position === "sticky" && typeof value !== "string" && !hasActiveStickyInset(value)) return "relative";
  return position === "relative" || position === "absolute" || position === "fixed" || position === "sticky" ? position : "static";
}

export function establishesFixedContainingBlock(style: CSSStyleDeclaration): boolean {
  const extended = style as CSSStyleDeclaration & {
    backdropFilter?: string;
    WebkitBackdropFilter?: string;
    webkitBackdropFilter?: string;
  };
  const nonDefault = (value: string | undefined): boolean => Boolean(value && value !== "none" && value !== "normal");
  if (effectiveTransform(style) !== "none"
    || nonDefault(style.perspective)
    || nonDefault(style.filter)
    || nonDefault(extended.backdropFilter || extended.WebkitBackdropFilter || extended.webkitBackdropFilter)) return true;
  const contain = String(style.contain || "").trim().toLowerCase().split(/\s+/);
  if (contain.some((value) => ["layout", "paint", "strict", "content"].includes(value))) return true;
  if (String(style.contentVisibility || "").trim().toLowerCase() === "auto") return true;
  const willChange = String(style.willChange || "").toLowerCase().split(/\s*,\s*/);
  return willChange.some((value) => ["transform", "perspective", "filter", "backdrop-filter"].includes(value));
}

function fixedContainingBlockFor(element: Element, doc: Document): Element | null {
  let ancestor = element.parentElement;
  while (ancestor) {
    const style = doc.defaultView?.getComputedStyle(ancestor);
    if (style && establishesFixedContainingBlock(style)) return ancestor;
    ancestor = ancestor.parentElement;
  }
  return null;
}

const BLOCK_FLOW_CONTAINER_DISPLAYS = new Set(["block", "flow-root"]);
const BLOCK_FLOW_CHILD_DISPLAYS = new Set(["block", "flow-root", "flex", "inline-flex", "grid", "inline-grid", "list-item"]);
const TABLE_SECTION_TAGS = new Set(["THEAD", "TBODY", "TFOOT"]);

/**
 * A normal block formatting context is a vertical stack even though CSS does
 * not expose it as `display:flex`. Preserve that relationship as a Figma
 * vertical Auto Layout frame when every direct child is itself a block-like
 * in-flow box. Mixed inline content, floats, tables, and positioned children
 * stay on the measured free-positioning path because mapping those cases to
 * Auto Layout would change wrapping or margin-collapse semantics.
 */
function isRepresentableBlockFlowContainer(style: CSSStyleDeclaration, element?: Element): boolean {
  if (!element || !BLOCK_FLOW_CONTAINER_DISPLAYS.has(String(style.display || "").toLowerCase())) return false;
  if (String(style.position || "static") !== "static"
    || String(style.float || "none") !== "none"
    || String(style.clear || "none") !== "none"
    || String(style.columnCount || "auto") !== "auto"
    || String(style.columnWidth || "auto") !== "auto") return false;
  const childElements = Array.from(element.children).filter((child) => !IGNORED_TAGS.has(child.tagName.toUpperCase()));
  if (childElements.length === 0) return false;
  // Direct non-whitespace text participates in an inline formatting context;
  // a vertical Auto Layout frame cannot reproduce its relationship with the
  // surrounding block children without introducing an anonymous text frame.
  if (Array.from(element.childNodes).some((child) => child.nodeType === Node.TEXT_NODE && /\S/.test(child.textContent || ""))) return false;
  const view = element.ownerDocument.defaultView;
  if (!view) return false;
  const parentHasVerticalBoundary = numberValue(style.paddingTop) > 0
    || numberValue(style.paddingBottom) > 0
    || numberValue(style.borderTopWidth) > 0
    || numberValue(style.borderBottomWidth) > 0
    || String(style.display || "").toLowerCase() === "flow-root"
    || ["hidden", "clip", "auto", "scroll", "overlay"].includes(String(style.overflow || "").toLowerCase());
  let previousBottomMargin = 0;
  return childElements.every((child, index) => {
    const childStyle = view.getComputedStyle(child);
    if (!BLOCK_FLOW_CHILD_DISPLAYS.has(String(childStyle.display || "").toLowerCase())) return false;
    if (!["static", "relative"].includes(String(childStyle.position || "static"))) return false;
    if (String(childStyle.float || "none") !== "none" || String(childStyle.clear || "none") !== "none") return false;
    if (String(childStyle.transform || "none") !== "none") return false;
    const topMargin = numberValue(childStyle.marginTop);
    const bottomMargin = numberValue(childStyle.marginBottom);
    // Negative margins and overlapping adjacent margins require CSS's
    // collapse algorithm; Figma Auto Layout cannot express that max/sum
    // relationship without changing the captured geometry.
    if (topMargin < 0 || bottomMargin < 0) return false;
    if (index === 0 && topMargin > 0 && !parentHasVerticalBoundary) return false;
    if (previousBottomMargin > 0 && topMargin > 0) return false;
    if (index === childElements.length - 1 && bottomMargin > 0 && !parentHasVerticalBoundary) return false;
    previousBottomMargin = bottomMargin;
    return true;
  });
}

/** CSS padding belongs to a box, not to a Figma TextNode. Keep padded text
 * elements as an editable frame with a text child so the captured border box,
 * glyph origin, and content inset do not collapse into one over-wide text box. */
export function hasTextBoxInsets(style: Pick<CSSStyleDeclaration, "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft">): boolean {
  return [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft]
    .some((value) => numberValue(String(value || ""), 0) > 0);
}

export function isDisplayContents(style: Pick<CSSStyleDeclaration, "display">): boolean {
  return String(style.display || "").trim().toLowerCase() === "contents";
}

/**
 * Keep semantics from a flattened `display: contents` wrapper attached to the
 * first visual descendants without introducing a zero-size Figma layer.
 */
function addStructuralSemantics(
  node: DesignNode,
  semantics: DesignNode["structuralSemantics"],
  owners: string[] = [],
): DesignNode {
  if (!semantics?.length) return node;
  const existing = node.structuralSemantics ?? [];
  const existingOwners = node.structuralSemanticOwners ?? [];
  const merged = [...existing];
  const mergedOwners = existing.map((_entry, index) => existingOwners[index] ?? "");
  for (let index = 0; index < semantics.length; index += 1) {
    const candidate = semantics[index];
    const owner = owners[index] ?? "";
    const existingIndex = merged.findIndex((entry, existingIndex) => (
      JSON.stringify(entry) === JSON.stringify(candidate)
      && (mergedOwners[existingIndex] || "") === owner
    ));
    if (existingIndex >= 0) {
      if (!mergedOwners[existingIndex] && owner) mergedOwners[existingIndex] = owner;
      continue;
    }
    merged.push(candidate);
    mergedOwners.push(owner);
  }
  return {
    ...node,
    structuralSemantics: merged,
    ...(mergedOwners.some(Boolean) ? { structuralSemanticOwners: mergedOwners } : {}),
  };
}

export function formControlTextValue(element: Element): { text: string; placeholder: boolean } | null {
  const tag = element.tagName.toUpperCase();
  if (tag === "TEXTAREA") {
    const control = element as HTMLTextAreaElement;
    const value = String(control.value ?? "");
    if (value) return { text: value, placeholder: false };
    const placeholder = String(control.getAttribute("placeholder") || "");
    return placeholder ? { text: placeholder, placeholder: true } : null;
  }
  if (tag === "SELECT") {
    const selected = Array.from(element.querySelectorAll("option:checked"))
      .map((option) => String(option.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    return selected.length ? { text: selected.join("\n"), placeholder: false } : null;
  }
  if (tag !== "INPUT") return null;
  const type = String(element.getAttribute("type") || "text").toLowerCase();
  if (["hidden", "checkbox", "radio", "range", "file", "color"].includes(type)) return null;
  const control = element as HTMLInputElement;
  const rawValue = String(control.value ?? "");
  if (rawValue) return {
    // Password controls paint bullets in the browser; never export the
    // plaintext value into an editable Figma layer.
    text: type === "password" ? "•".repeat(rawValue.length) : rawValue,
    placeholder: false,
  };
  const placeholder = String(control.getAttribute("placeholder") || "");
  return placeholder ? { text: placeholder, placeholder: true } : null;
}

/** Native form controls paint their value internally. Their option/text
 * descendants are implementation details, not separate editable layers. */
export function formControlChildElements(element: Element): Element[] {
  const tag = element.tagName.toUpperCase();
  if (["INPUT", "TEXTAREA", "SELECT"].includes(tag)) return [];
  return Array.from(element.children);
}

function alphabeticMarker(value: number, uppercase: boolean): string {
  let remaining = Math.max(1, Math.floor(value));
  let result = "";
  while (remaining > 0) {
    remaining -= 1;
    result = String.fromCharCode((uppercase ? 65 : 97) + (remaining % 26)) + result;
    remaining = Math.floor(remaining / 26);
  }
  return result;
}

function romanMarker(value: number): string {
  let remaining = Math.max(1, Math.floor(value));
  const parts: Array<[number, string]> = [[1000, "m"], [900, "cm"], [500, "d"], [400, "cd"], [100, "c"], [90, "xc"], [50, "l"], [40, "xl"], [10, "x"], [9, "ix"], [5, "v"], [4, "iv"], [1, "i"]];
  let result = "";
  for (const [unit, glyph] of parts) {
    while (remaining >= unit) {
      result += glyph;
      remaining -= unit;
    }
  }
  return result;
}

/** Resolve the common CSS list marker forms into an editable text glyph. */
export function listMarkerText(
  style: Pick<CSSStyleDeclaration, "listStyleType" | "listStylePosition" | "listStyleImage">,
  ordinal = 1,
): string | null {
  const type = String(style.listStyleType || "disc").trim().toLowerCase();
  const image = String(style.listStyleImage || "none").trim().toLowerCase();
  // Custom marker images use their own asset path below. Text markers can be
  // kept independent even for `inside`: the browser-measured text range still
  // supplies the correct post-marker content origin.
  if (!type || type === "none" || image !== "none") return null;
  if (["disc", "circle", "square"].includes(type)) return type === "disc" ? "•" : type === "circle" ? "◦" : "▪";
  if (type === "decimal") return `${Math.floor(ordinal)}.`;
  if (type === "decimal-leading-zero") return `${String(Math.floor(ordinal)).padStart(2, "0")}.`;
  if (type === "lower-alpha" || type === "lower-latin") return `${alphabeticMarker(ordinal, false)}.`;
  if (type === "upper-alpha" || type === "upper-latin") return `${alphabeticMarker(ordinal, true)}.`;
  if (type === "lower-roman") return `${romanMarker(ordinal)}.`;
  if (type === "upper-roman") return `${romanMarker(ordinal).toUpperCase()}.`;
  return null;
}

export function listMarkerImageSource(style: Pick<CSSStyleDeclaration, "listStyleImage">): string | null {
  const value = String(style.listStyleImage || "").trim();
  const match = value.match(/^url\(\s*(['"]?)(.*?)\1\s*\)$/i);
  return match?.[2] ? match[2] : null;
}

export function tableCellNeedsGeometryLock(element: Element): boolean {
  const tag = element.tagName.toUpperCase();
  if (tag !== "TD" && tag !== "TH") return false;
  const colspan = Number.parseInt(String(element.getAttribute("colspan") || "1"), 10);
  const rowspan = Number.parseInt(String(element.getAttribute("rowspan") || "1"), 10);
  return (Number.isFinite(colspan) && colspan > 1) || (Number.isFinite(rowspan) && rowspan > 1);
}

export function tableCaptionIsBottom(style: Pick<CSSStyleDeclaration, "captionSide">): boolean {
  return String(style.captionSide || "top").trim().toLowerCase() === "bottom";
}

export function listItemOrdinal(element: Element, siblings: Element[]): number {
  const explicit = Number.parseInt(String(element.getAttribute("value") || ""), 10);
  if (Number.isFinite(explicit)) return explicit;
  const index = Math.max(0, siblings.indexOf(element));
  const parent = element.parentElement;
  if (parent?.tagName.toUpperCase() !== "OL") return index + 1;
  const reversed = parent.hasAttribute("reversed");
  const startAttribute = Number.parseInt(String(parent.getAttribute("start") || ""), 10);
  const start = Number.isFinite(startAttribute) ? startAttribute : reversed ? siblings.length : 1;
  return reversed ? start - index : start + index;
}

export function formControlTextRect(
  rect: Pick<DOMRect, "width" | "height">,
  style: Pick<CSSStyleDeclaration, "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft" | "borderTopWidth" | "borderRightWidth" | "borderBottomWidth" | "borderLeftWidth" | "lineHeight" | "fontSize">,
  multiline = false,
  rootFontSize = 16,
  rootLineHeight = rootFontSize * 1.2,
): DesignRect {
  const left = numberValue(style.borderLeftWidth) + numberValue(style.paddingLeft);
  const right = numberValue(style.borderRightWidth) + numberValue(style.paddingRight);
  const top = numberValue(style.borderTopWidth) + numberValue(style.paddingTop);
  const bottom = numberValue(style.borderBottomWidth) + numberValue(style.paddingBottom);
  const lineHeight = textLineHeight(cssLineHeightValue(style), numberValue(cssStyleValue(style, "fontSize", "font-size"), 16), rootFontSize, rootLineHeight, rootLineHeight);
  const contentHeight = Math.max(1, Number(rect.height) - top - bottom);
  return {
    x: left,
    y: multiline ? top : Math.max(top, (Number(rect.height) - lineHeight) / 2),
    width: Math.max(1, Number(rect.width) - left - right),
    height: multiline ? contentHeight : Math.min(contentHeight, lineHeight),
  };
}

export function unsupportedFilterFunctions(value: string, allowImageFilters = false, allowOpacity = true): string[] {
  if (!value || value === "none") return [];
  const visualFilters = allowOpacity ? "blur|drop-shadow|opacity" : "blur|drop-shadow";
  const imageFilters = "brightness|contrast|saturate|grayscale|sepia|invert|hue-rotate";
  const supported = new RegExp(`(?:${visualFilters})\\((?:[^()]|\\([^()]*\\))*\\)${allowImageFilters ? `|(?:${imageFilters})\\((?:[^()]|\\([^()]*\\))*\\)` : ""}`, "gi");
  const remaining = String(value).replace(supported, "").match(/[a-z-]+\s*\(/gi) || [];
  return remaining.map((entry) => entry.replace(/\s*\($/, "").toLowerCase());
}

export function unsupportedBlendModes(value: string): string[] {
  const supported = new Set(["normal", "multiply", "screen", "overlay", "darken", "lighten", "linear-burn", "linear-dodge", "plus-darker", "plus-lighter", "color-dodge", "color-burn", "hard-light", "soft-light", "difference", "exclusion", "hue", "saturation", "color", "luminosity"]);
  return String(value || "").split(",").map((mode) => mode.trim().toLowerCase()).filter((mode) => mode && !supported.has(mode));
}

/** Whether any CSS background layer uses non-default scroll attachment. */
export function hasNonDefaultBackgroundAttachment(value: string): boolean {
  const layers = splitCssArguments(String(value || "scroll").trim().toLowerCase());
  return layers.some((layer) => layer && layer !== "scroll");
}

/** Mask repeat forms that the editable SVG fallback can reproduce. */
export function supportedMaskRepeat(value: string): boolean {
  return splitCssArguments(String(value || "repeat").trim().toLowerCase()).every((layer) => (
    ["repeat", "no-repeat", "repeat-x", "repeat-y", "space", "round"].includes(layer)
    || splitCssSpaceValues(layer).length === 2
      && splitCssSpaceValues(layer).every((token) => ["repeat", "no-repeat", "space", "round"].includes(token))
  ));
}

export function supportedMaskGradientLayer(value: string): boolean {
  const normalized = String(value || "").trim();
  if (!normalized || /\burl\s*\(/i.test(normalized)) return false;
  // The importer renders conic gradients as editable SVG sectors, so they
  // belong to the same supported mask subset as linear/radial gradients.
  return cssGradientFunctions(normalized).length === 1;
}

export function supportedMaskMode(value: string, layerCount: number): boolean {
  if (layerCount <= 0) return false;
  const modes = splitCssArguments(String(value || "match-source").trim().toLowerCase());
  if (!modes.length || modes.some((mode) => !["match-source", "alpha", "luminance"].includes(mode))) return false;
  const effective = Array.from({ length: layerCount }, (_, index) => {
    const mode = modes[index] ?? modes[modes.length - 1] ?? "match-source";
    // Gradient and ordinary image mask sources use alpha for match-source.
    return mode === "luminance" ? "luminance" : "alpha";
  });
  // One Figma mask node exposes one mask type. Mixed alpha/luminance layers
  // need per-layer compositing and remain on the explicit degradation path.
  return effective.every((mode) => mode === effective[0]);
}

/**
 * CSS mask compositing is applied between adjacent mask layers. The plugin
 * can reproduce additive stacks and pure intersections with nested SVG masks;
 * subtractive/exclusion stacks are also representable by the SVG mask
 * compositor. Mixed operators and mixed alpha/luminance semantics still need
 * an explicit degradation because a single Figma vector mask cannot expose
 * the intermediate alpha buffers reliably.
 */
export function supportedMaskComposite(value: string, layerCount = 2): boolean {
  if (layerCount <= 1) return true;
  const values = splitCssArguments(String(value || "add").trim().toLowerCase());
  if (!values.length) return true;
  const operators = Array.from({ length: layerCount - 1 }, (_, index) => {
    const raw = values[index] ?? values[values.length - 1] ?? "add";
    if (raw === "source-over") return "add";
    if (raw === "source-in") return "intersect";
    if (raw === "source-out") return "subtract";
    if (raw === "xor") return "exclude";
    return raw;
  });
  return operators.every((operator) => ["add", "intersect", "subtract", "exclude"].includes(operator));
}

export function unsupportedBorderImageRepeat(value: string, sliceValue = "100%"): string[] {
  const tokens = String(value || "stretch").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const invalid = tokens.filter((token) => !["stretch", "repeat", "round", "space"].includes(token));
  if (invalid.length) return Array.from(new Set(invalid));
  const slice = String(sliceValue || "100%").trim().toLowerCase();
  const hasEditableNineSlice = slice !== "100%" && slice !== "1" && !hasUnsupportedBorderImageSlice(slice);
  return hasEditableNineSlice ? [] : Array.from(new Set(tokens.filter((token) => token !== "stretch")));
}

export function hasUnsupportedBorderImageSlice(value: string): boolean {
  const normalized = String(value || "100%").trim().toLowerCase();
  if (!normalized || normalized === "100%" || normalized === "1") return false;
  const tokens = splitCssSpaceValues(normalized);
  const slices = tokens.filter((token) => token !== "fill");
  return slices.length < 1
    || slices.length > 4
    || tokens.filter((token) => token === "fill").length > 1
    || slices.some((token) => !borderImageSliceTokenSupported(token));
}

/**
 * `border-image-slice` accepts number/percentage math expressions in modern
 * CSS. Keep the capture diagnostic aligned with the plugin's nine-slice
 * resolver: a supported `calc()`/`min()`/`max()`/`clamp()` must not be reported
 * as a degradation merely because it is not a plain literal token.
 */
function borderImageSliceTokenSupported(value: string): boolean {
  const normalized = String(value || "").trim().toLowerCase();
  if (/^(?:\d+(?:\.\d*)?|\.\d+)%?$/.test(normalized)) return true;
  const functionMatch = normalized.match(/^(calc|min|max|clamp)\((.*)\)$/i);
  if (!functionMatch) return false;
  const name = functionMatch[1].toLowerCase();
  const body = functionMatch[2].trim();
  if (name === "calc") {
    const compact = body.replace(/\s+/g, "");
    const operand = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)%?/y;
    const operators: string[] = [];
    const unitless: boolean[] = [];
    let cursor = 0;
    let expectingOperand = true;
    let operands = 0;
    while (cursor < compact.length) {
      if (expectingOperand) {
        operand.lastIndex = cursor;
        const match = operand.exec(compact);
        if (!match) return false;
        cursor = operand.lastIndex;
        operands += 1;
        unitless.push(!match[0].endsWith("%"));
        expectingOperand = false;
      } else {
        const operator = compact[cursor];
        if (!/[+\-*/]/.test(operator)) return false;
        operators.push(operator);
        cursor += 1;
        expectingOperand = true;
      }
    }
    if (expectingOperand || operands !== operators.length + 1) return false;
    // Products/divisions are only dimensionally valid when one side is a
    // unitless number. The plugin applies the same guard before resolving.
    return operators.every((operator, index) => operator === "+" || operator === "-"
      ? true
      : operator === "*"
        ? Boolean(unitless[index] || unitless[index + 1])
        : Boolean(unitless[index + 1]));
  }
  const args = splitCssArguments(body);
  const validArity = name === "clamp" ? args.length === 3 : args.length >= 2;
  return validArity && args.every((entry) => borderImageSliceTokenSupported(entry));
}

/** CSS transforms that cannot be represented by Figma's affine 2D matrix. */
export function unsupportedTransformFunctions(value: string): string[] {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || normalized === "none") return [];
  const names = new Set<string>();
  for (const match of normalized.matchAll(/([a-z0-9]+)\(/g)) names.add(match[1]);
  for (const name of ["rotatex", "rotatey", "rotate3d", "perspective", "translatez", "scalez"]) {
    if (names.has(name)) return [name];
  }
  const translate3d = normalized.match(/translate3d\(([^)]+)\)/)?.[1]
    ?.trim().split(/[\s,]+/).map(Number.parseFloat);
  if (translate3d && translate3d.length >= 3 && Number.isFinite(translate3d[2]) && Math.abs(translate3d[2]) > 0.000001) return ["translate3d"];
  const scale3d = normalized.match(/scale3d\(([^)]+)\)/)?.[1]
    ?.trim().split(/[\s,]+/).map(Number.parseFloat);
  if (scale3d && scale3d.length >= 3 && Number.isFinite(scale3d[2]) && Math.abs(scale3d[2] - 1) > 0.000001) return ["scale3d"];
  const matrix3d = normalized.match(/^matrix3d\(([^)]+)\)$/)?.[1]
    ?.split(/\s*,\s*/).map(Number);
  if (matrix3d?.length === 16 && matrix3d.every(Number.isFinite)) {
    const is2d = [matrix3d[2], matrix3d[3], matrix3d[6], matrix3d[7], matrix3d[8], matrix3d[9], matrix3d[11], matrix3d[14]]
      .every(item => Math.abs(item) < 0.000001)
      && Math.abs(matrix3d[10] - 1) < 0.000001
      && Math.abs(matrix3d[15] - 1) < 0.000001;
    if (!is2d) return ["matrix3d"];
  }
  return [];
}

function recordUnsupportedStyles(
  context: CaptureContext,
  style: CSSStyleDeclaration,
  nodeId: string,
  allowImageFilters = false,
  element?: Element,
): void {
  const filterUnsupported = unsupportedFilterFunctions(style.filter, allowImageFilters);
  if (filterUnsupported.length) context.diagnostics.push({ code: "style-degraded", message: `filter functions not recreated natively: ${filterUnsupported.join(", ")}`, nodeId });
  // `opacity()` on a normal filter maps to the node opacity, but the same
  // function in backdrop-filter changes the sampled backdrop rather than the
  // element itself. Figma has no equivalent backdrop-opacity effect, so keep
  // it visible as a real degradation instead of claiming support.
  const backdropUnsupported = unsupportedFilterFunctions(style.backdropFilter, false, false);
  if (backdropUnsupported.length) context.diagnostics.push({ code: "style-degraded", message: `backdrop-filter functions not recreated natively: ${backdropUnsupported.join(", ")}`, nodeId });
  const blendUnsupported = unsupportedBlendModes(style.backgroundBlendMode);
  if (blendUnsupported.length) context.diagnostics.push({ code: "style-degraded", message: `background-blend-mode values not supported natively: ${blendUnsupported.join(", ")}`, nodeId });
  const borderImageGradients = cssGradientFunctions(String(style.borderImageSource || ""));
  const borderImageUrls = cssImageUrlsIncludingData(String(style.borderImageSource || ""));
  const borderImageSlice = borderImageGradients.length
    ? String(style.borderImageSlice || "100%").trim()
    : "100%";
  const borderImageRepeatUnsupported = borderImageGradients.length
    ? unsupportedBorderImageRepeat(String(style.borderImageRepeat || "stretch"), borderImageSlice)
    : [];
  if (borderImageRepeatUnsupported.length) {
    context.diagnostics.push({
      code: "style-degraded",
      message: `border-image-repeat ${borderImageRepeatUnsupported.join("/")} is retained for inspection; the editable gradient vector currently uses stretch semantics`,
      nodeId,
    });
  }
  if (hasUnsupportedBorderImageSlice(borderImageSlice)) {
    context.diagnostics.push({
      code: "style-degraded",
      message: `border-image-slice ${borderImageSlice} is retained for inspection but cannot be mapped to editable nine-slice gradient geometry`,
      nodeId,
    });
  }
  if (borderImageUrls.length > 1) {
    context.diagnostics.push({
      code: "style-degraded",
      message: "border-image-source contains multiple image layers; only the first URL source is preserved for the editable fallback",
      nodeId,
    });
  }
  const mixBlendUnsupported = unsupportedBlendModes(style.mixBlendMode);
  if (mixBlendUnsupported.length) context.diagnostics.push({ code: "style-degraded", message: `mix-blend-mode values not supported natively: ${mixBlendUnsupported.join(", ")}`, nodeId });
  const backgroundAttachment = String(style.backgroundAttachment || "scroll").trim().toLowerCase();
  if (hasNonDefaultBackgroundAttachment(backgroundAttachment)) {
    context.diagnostics.push({ code: "style-degraded", message: `background-attachment ${backgroundAttachment} is retained as metadata but has no Figma scrolling-background equivalent`, nodeId });
  }
  if (/\b(?:-webkit-)?image-set\(/i.test(String(style.backgroundImage || ""))) {
    context.diagnostics.push({ code: "style-degraded", message: "CSS image-set contains resolution candidates; the Figma fallback selects the closest available candidate for the captured device pixel ratio while retaining the source declaration", nodeId });
  }
  const maskStyles = style as CSSStyleDeclaration & Record<string, string | undefined>;
  const maskImage = String(maskStyles.maskImage || maskStyles.webkitMaskImage || maskStyles.WebkitMaskImage || "none").trim();
  if (maskImage && maskImage.toLowerCase() !== "none") {
    const maskPosition = String(maskStyles.maskPosition || maskStyles.webkitMaskPosition || maskStyles.WebkitMaskPosition || "0% 0%").trim().toLowerCase();
    const maskSize = String(maskStyles.maskSize || maskStyles.webkitMaskSize || maskStyles.WebkitMaskSize || "auto").trim().toLowerCase();
    const maskRepeat = String(maskStyles.maskRepeat || maskStyles.webkitMaskRepeat || maskStyles.WebkitMaskRepeat || "repeat").trim().toLowerCase();
    const maskClip = String(maskStyles.maskClip || maskStyles.webkitMaskClip || maskStyles.WebkitMaskClip || "border-box").trim().toLowerCase();
    const maskOrigin = String(maskStyles.maskOrigin || maskStyles.webkitMaskOrigin || maskStyles.WebkitMaskOrigin || "border-box").trim().toLowerCase();
    const maskMode = String(maskStyles.maskMode || maskStyles.webkitMaskMode || maskStyles.WebkitMaskMode || "match-source").trim().toLowerCase();
    const maskComposite = String(maskStyles.maskComposite || maskStyles.webkitMaskComposite || maskStyles.WebkitMaskComposite || "add").trim().toLowerCase();
    const maskPositionSupported = splitCssArguments(maskPosition).every((layer) => {
      const tokens = splitCssSpaceValues(layer);
      return tokens.length <= 4 && tokens.every((token) => /^(?:left|right|top|bottom|center|[+-]?(?:\d+\.?\d*|\.\d+)(?:px|%)?)$/.test(token));
    });
    const maskSizeSupported = splitCssArguments(maskSize).every((layer) => {
      const tokens = splitCssSpaceValues(layer);
      return tokens.length <= 2 && tokens.every((token) => token === "auto" || token === "cover" || token === "contain" || /^[+-]?(?:\d+\.?\d*|\.\d+)(?:px|%)$/.test(token));
    });
    const maskRepeatSupported = supportedMaskRepeat(maskRepeat);
    const maskClipSupported = splitCssArguments(maskClip).every(layer => ["border-box", "padding-box", "content-box"].includes(layer));
    const maskOriginSupported = splitCssArguments(maskOrigin).every(layer => ["border-box", "padding-box", "content-box"].includes(layer));
    const maskLayers = splitCssArguments(maskImage);
    const maskModeSupported = supportedMaskMode(maskMode, maskLayers.length);
    const maskCompositeSupported = supportedMaskComposite(maskComposite, maskLayers.length);
    const maskLayersSupported = maskLayers.length > 0
      && maskLayers.every(layer => {
        const gradients = cssGradientFunctions(layer);
        if (supportedMaskGradientLayer(layer)) return true;
        if (gradients.length > 0 || cssImageUrlsIncludingData(layer).length !== 1) return false;
        const source = cssImageUrlsIncludingData(layer)[0];
        if (source.startsWith("data:")) return true;
        const resolvedSource = resolveResourceUrl(source, context.document);
        return Boolean(context.imageData.get(resolvedSource));
      })
      && maskCompositeSupported
      && maskClipSupported
      && maskOriginSupported
      && maskModeSupported
      && maskPositionSupported
      && maskSizeSupported
      && maskRepeatSupported;
    const gradientSizeSupported = maskLayers.every((layer, index) => {
      if (/\burl\s*\(/i.test(layer)) return true;
      const sizeValue = splitCssSpaceValues(splitCssArguments(maskSize)[index] || "auto");
      return !sizeValue.some(token => token === "cover" || token === "contain");
    });
    const simpleGradient = maskLayersSupported
      && gradientSizeSupported
      && maskCompositeSupported
      && maskClipSupported
      && maskOriginSupported
      && maskModeSupported
      && maskPositionSupported
      && maskSizeSupported
      && maskRepeatSupported;
    const simpleUrl = splitCssArguments(maskImage).length === 1
      && cssImageUrlsIncludingData(maskImage).length === 1
      && (() => {
        const source = cssImageUrlsIncludingData(maskImage)[0];
        return source.startsWith("data:") || Boolean(context.imageData.get(resolveResourceUrl(source, context.document)));
      })()
      && maskPositionSupported
      && maskSizeSupported
      && maskRepeatSupported
      && ["border-box", "padding-box", "content-box"].includes(maskClip)
      && ["border-box", "padding-box", "content-box"].includes(maskOrigin)
      && supportedMaskMode(maskMode, 1);
    if (!simpleGradient && !simpleUrl) {
      context.diagnostics.push({ code: "style-degraded", message: `mask-image ${maskImage} requires a native Figma mask fallback; supported layers must be gradients or successfully inlined URL assets with add/intersect/subtract/exclude geometry`, nodeId });
    }
  }
  const position = String(style.position || "static").trim().toLowerCase();
  if (position === "sticky" && hasActiveStickyInset(style)) {
    context.diagnostics.push({ code: "constraint-degraded", message: "position sticky is captured at the current viewport position; Figma has no scroll-linked sticky constraint", nodeId });
  }
  const scrollConstraints = [
    ["scroll-snap-type", String(style.scrollSnapType || "none").trim(), "none"],
    ["scroll-snap-align", String(style.scrollSnapAlign || "none").trim(), "none"],
    ["scroll-snap-stop", String(style.scrollSnapStop || "normal").trim(), "normal"],
    ["scroll-behavior", String(style.scrollBehavior || "auto").trim(), "auto"],
    ["overscroll-behavior", String(style.overscrollBehavior || "auto").trim(), "auto"],
    ["overscroll-behavior-x", String(style.overscrollBehaviorX || "auto").trim(), "auto"],
    ["overscroll-behavior-y", String(style.overscrollBehaviorY || "auto").trim(), "auto"],
  ].filter(([, value, defaultValue]) => value && value !== defaultValue);
  if (scrollConstraints.length) {
    context.diagnostics.push({
      code: "constraint-degraded",
      message: `${scrollConstraints.map(([property, value]) => `${property} ${value}`).join(", ")} is retained as metadata; Figma has no equivalent scroll constraint`,
      nodeId,
    });
  }
  const repeatValues = String(style.backgroundRepeat || "").toLowerCase().split(/\s*,\s*/).flatMap(value => value.split(/\s+/));
  const unsupportedRepeat = repeatValues.filter(value => value === "space" || value === "round");
  if (unsupportedRepeat.length) context.diagnostics.push({ code: "style-degraded", message: `background-repeat ${Array.from(new Set(unsupportedRepeat)).join("/")} uses a measured fallback`, nodeId });
  const transformUnsupported = unsupportedTransformFunctions(effectiveTransform(style));
  if (transformUnsupported.length) context.diagnostics.push({ code: "style-degraded", message: `transform functions not recreated natively: ${transformUnsupported.join(", ")}`, nodeId });
  const writingMode = String(style.writingMode || "horizontal-tb").trim().toLowerCase();
  if (writingMode && writingMode !== "horizontal-tb") {
    context.diagnostics.push({ code: "style-degraded", message: `writing-mode ${writingMode} is retained as metadata but is not recreated by Figma TextNode`, nodeId });
  }
  const textOrientation = String(style.textOrientation || "mixed").trim().toLowerCase();
  if (textOrientation && textOrientation !== "mixed") {
    context.diagnostics.push({ code: "style-degraded", message: `text-orientation ${textOrientation} is retained as metadata but is not recreated by Figma TextNode`, nodeId });
  }
  const unicodeBidi = capturedUnicodeBidi(style, element);
  if (unicodeBidi && unicodeBidi !== "normal" && unicodeBidi !== "normal-flow") {
    context.diagnostics.push({ code: "style-degraded", message: `unicode-bidi ${unicodeBidi} is retained as metadata but is not recreated by Figma TextNode`, nodeId });
  }
  const textWrapStyle = String(style.textWrapStyle || "auto").trim().toLowerCase();
  if (textWrapStyle && textWrapStyle !== "auto" && textWrapStyle !== "stable") {
    context.diagnostics.push({ code: "style-degraded", message: `text-wrap-style ${textWrapStyle} is retained as metadata but is not recreated by Figma TextNode`, nodeId });
  }
  const unsupportedFontSettings = [
    ["font-optical-sizing", String(style.fontOpticalSizing || "auto").trim(), "auto"],
    ["font-size-adjust", String(style.fontSizeAdjust || "none").trim(), "none"],
    ["font-kerning", String(style.fontKerning || "auto").trim(), "auto"],
    ["text-rendering", String(style.textRendering || "auto").trim(), "auto"],
    ["font-variant", String(style.fontVariant || "normal").trim(), "normal"],
    ["font-variant-alternates", String(style.fontVariantAlternates || "normal").trim(), "normal"],
    ["font-variant-caps", String(style.fontVariantCaps || "normal").trim(), "normal"],
    ["font-variant-east-asian", String(style.fontVariantEastAsian || "normal").trim(), "normal"],
    ["font-variant-ligatures", String(style.fontVariantLigatures || "normal").trim(), "normal"],
    ["font-variant-numeric", String(style.fontVariantNumeric || "normal").trim(), "normal"],
    ["font-variant-position", String(style.fontVariantPosition || "normal").trim(), "normal"],
  ].filter(([, value, defaultValue]) => value && value !== defaultValue);
  if (unsupportedFontSettings.length) {
    context.diagnostics.push({
      code: "style-degraded",
      message: `${unsupportedFontSettings.map(([property, value]) => `${property} ${value}`).join(", ")} is retained as metadata but is not exposed by Figma TextNode`,
      nodeId,
    });
  }
  const flexShrink = Number.parseFloat(String(style.flexShrink || "1"));
  // `flex-shrink: 0` is represented by a captured fixed main-axis box plus a
  // native min-width/min-height guard in the importer. Keep diagnostics for
  // weighted shrink values, which Figma still cannot express per child.
  if (Number.isFinite(flexShrink) && Math.abs(flexShrink - 1) > 0.001 && Math.abs(flexShrink) > 0.001) {
    context.diagnostics.push({ code: "constraint-degraded", message: `flex-shrink ${flexShrink} is retained as metadata; Figma Auto Layout has no equivalent child shrink factor`, nodeId });
  }
  const contain = String(style.contain || "none").trim().toLowerCase();
  const containTokens = contain.split(/\s+/).filter(Boolean);
  const unsupportedContain = containTokens.filter((token) => !["paint", "size", "inline-size", "none"].includes(token));
  if (unsupportedContain.length) {
    context.diagnostics.push({ code: "constraint-degraded", message: `contain ${contain} is retained as metadata; size containment is mapped to fixed captured axes, but Figma has no equivalent subtree constraint for ${unsupportedContain.join(" ")}`, nodeId });
  }
  if (hasMultiColumnLayout(style)) {
    context.diagnostics.push({ code: "constraint-degraded", message: "CSS multi-column layout is captured with measured geometry; Figma has no editable column-flow constraint", nodeId });
  }
  if (hasDenseGridAutoFlow(style)) {
    context.diagnostics.push({ code: "constraint-degraded", message: "CSS grid-auto-flow: dense is retained as metadata and measured geometry; Figma Auto Layout has no dense packing constraint", nodeId });
  }
  const contentVisibility = String(style.contentVisibility || "visible").trim().toLowerCase();
  if (contentVisibility && contentVisibility !== "visible" && contentVisibility !== "hidden") {
    context.diagnostics.push({ code: "constraint-degraded", message: `content-visibility ${contentVisibility} is retained as metadata but is not recreated by Figma`, nodeId });
  }
  const containerStyles = style as CSSStyleDeclaration & { container?: string; containerName?: string; containerType?: string };
  const containerValues = [
    ["container", String(containerStyles.container || "normal").trim()],
    ["container-name", String(containerStyles.containerName || "none").trim()],
    ["container-type", String(containerStyles.containerType || "normal").trim()],
  ].filter(([, value]) => value && value !== "normal" && value !== "none");
  if (containerValues.length) {
    context.diagnostics.push({
      code: "constraint-degraded",
      message: `${containerValues.map(([property, value]) => `${property} ${value}`).join(", ")} is retained as metadata and measured geometry; Figma has no native container-query constraint`,
      nodeId,
    });
  }
  const isolation = String(style.isolation || "auto").trim().toLowerCase();
  if (isolation && !["auto", "normal", "isolate"].includes(isolation)) {
    context.diagnostics.push({ code: "style-degraded", message: `isolation ${isolation} is retained as metadata but has no native Figma equivalent`, nodeId });
  }
}

export function borderFor(
  style: CSSStyleDeclaration,
  side: "Top" | "Right" | "Bottom" | "Left",
  borderImageArea?: { width?: number; height?: number },
  devicePixelRatio = 1,
  currentColor = String(style.color || "rgb(0, 0, 0)"),
): DesignNode["stroke"] {
  const width = cssBorderWidthValue(
    style[`border${side}Width` as keyof CSSStyleDeclaration] as string,
    0,
    numberValue(style.fontSize, 16),
  );
  const borderStyle = String(style[`border${side}Style` as keyof CSSStyleDeclaration] ?? "solid");
  if (width <= 0 || borderStyle === "none" || borderStyle === "hidden") return undefined;
  const borderImageSource = normalizeImageSetForDevicePixelRatio(
    resolveCurrentColor(String(style.borderImageSource ?? "").trim(), currentColor),
    devicePixelRatio,
  );
  const gradient = /(?:repeating-)?(?:linear|radial|conic)-gradient\(/i.test(borderImageSource)
    ? borderImageSource
    : undefined;
  const imageSource = !gradient ? cssImageUrlsIncludingData(borderImageSource)[0] : undefined;
  const hasBorderImage = Boolean(gradient || imageSource);
  const paintWidthReference = side === "Top" || side === "Bottom"
    ? Number(borderImageArea?.height || 0)
    : Number(borderImageArea?.width || 0);
  const paintWidth = hasBorderImage ? borderImagePaintWidth(style.borderImageWidth, side, width, paintWidthReference) : undefined;
  const paintOutset = hasBorderImage ? borderImageOutsetValue(style.borderImageOutset, side, width) : undefined;
  const paintSlice = hasBorderImage ? String(style.borderImageSlice ?? "").trim() : "";
  const paintRepeat = hasBorderImage ? String(style.borderImageRepeat ?? "").trim() : "";
  return {
    color: resolveCurrentColor(String(style[`border${side}Color` as keyof CSSStyleDeclaration] ?? "rgba(0, 0, 0, 0)"), currentColor),
    ...(gradient ? { gradient } : {}),
    ...(imageSource ? { imageSource } : {}),
    ...(paintWidth != null && Math.abs(paintWidth - width) > 0.01 ? { paintWidth } : {}),
    ...(paintOutset != null && paintOutset > 0.01 ? { paintOutset } : {}),
    ...(paintSlice && paintSlice !== "100%" ? { paintSlice } : {}),
    ...(paintRepeat && paintRepeat !== "stretch" ? { paintRepeat } : {}),
    width,
    style: borderStyle,
  };
}

function borderImagePaintWidth(
  value: string,
  side: "Top" | "Right" | "Bottom" | "Left",
  borderWidth: number,
  percentageReference = 0,
): number | undefined {
  const tokens = splitCssSpaceValues(String(value || "1").trim());
  if (!tokens.length) return undefined;
  const expanded = tokens.length === 1
    ? [tokens[0], tokens[0], tokens[0], tokens[0]]
    : tokens.length === 2
      ? [tokens[0], tokens[1], tokens[0], tokens[1]]
      : tokens.length === 3
        ? [tokens[0], tokens[1], tokens[2], tokens[1]]
        : tokens.slice(0, 4);
  const index = side === "Top" ? 0 : side === "Right" ? 1 : side === "Bottom" ? 2 : 3;
  const token = String(expanded[index] || "1").trim().toLowerCase();
  if (token === "auto") return borderWidth;
  const resolveTerm = (term: string, scalar = false): number | undefined => {
    const match = term.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|%)?$/);
    if (!match) return undefined;
    const numeric = Number.parseFloat(match[1]);
    if (!Number.isFinite(numeric)) return undefined;
    if (!match[2]) return scalar ? numeric : numeric * borderWidth;
    if (match[2] === "%") return percentageReference > 0 ? percentageReference * numeric / 100 : undefined;
    return numeric;
  };
  const resolveExpression = (expression: string): number | undefined => {
    const normalized = expression.trim().toLowerCase();
    const direct = resolveTerm(normalized);
    if (direct !== undefined) return direct;
    const calc = normalized.match(/^calc\((.*)\)$/i);
    if (calc) {
      const compact = calc[1].replace(/\s+/g, "");
      const terms = compact.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)?/g) || [];
      if (!terms.length || terms.join("") !== compact) return undefined;
      let result: number | undefined;
      for (const term of terms) {
        const value = resolveTerm(term, !/(?:px|%)$/i.test(term));
        if (value === undefined) return undefined;
        const sign = term.startsWith("-") ? -1 : 1;
        result = (result ?? 0) + sign * value;
      }
      return result;
    }
    const fn = normalized.match(/^(min|max|clamp)\((.*)\)$/i);
    if (!fn) return undefined;
    const values = splitCssArguments(fn[2]).map(entry => resolveExpression(entry));
    if (!values.length || values.some(value => value === undefined)) return undefined;
    const numbers = values as number[];
    if (fn[1] === "min") return Math.min(...numbers);
    if (fn[1] === "max") return Math.max(...numbers);
    return numbers.length === 3 ? Math.min(numbers[2], Math.max(numbers[0], numbers[1])) : undefined;
  };
  const resolved = resolveExpression(token);
  return resolved !== undefined && resolved >= 0 ? resolved : undefined;
}

function borderImageOutsetValue(value: string, side: "Top" | "Right" | "Bottom" | "Left", borderWidth: number): number | undefined {
  const tokens = splitCssSpaceValues(String(value || "0").trim());
  if (!tokens.length) return undefined;
  const expanded = tokens.length === 1
    ? [tokens[0], tokens[0], tokens[0], tokens[0]]
    : tokens.length === 2
      ? [tokens[0], tokens[1], tokens[0], tokens[1]]
      : tokens.length === 3
        ? [tokens[0], tokens[1], tokens[2], tokens[1]]
        : tokens.slice(0, 4);
  const index = side === "Top" ? 0 : side === "Right" ? 1 : side === "Bottom" ? 2 : 3;
  const token = String(expanded[index] || "0").trim().toLowerCase();
  const resolveTerm = (term: string, scalar = false): number | undefined => {
    const match = term.trim().match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px)?$/);
    if (!match) return undefined;
    const numeric = Number.parseFloat(match[1]);
    if (!Number.isFinite(numeric)) return undefined;
    return match[2] ? numeric : scalar ? numeric : numeric * borderWidth;
  };
  const resolveExpression = (expression: string): number | undefined => {
    const normalized = expression.trim().toLowerCase();
    const direct = resolveTerm(normalized);
    if (direct !== undefined) return direct;
    const calc = normalized.match(/^calc\((.*)\)$/i);
    if (calc) {
      const compact = calc[1].replace(/\s+/g, "");
      const terms = compact.match(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:px)?/g) || [];
      if (!terms.length || terms.join("") !== compact) return undefined;
      let result = 0;
      for (const term of terms) {
        const resolved = resolveTerm(term, true);
        if (resolved === undefined) return undefined;
        result += term.startsWith("-") ? -resolved : resolved;
      }
      return result;
    }
    const fn = normalized.match(/^(min|max|clamp)\((.*)\)$/i);
    if (!fn) return undefined;
    const values = splitCssArguments(fn[2]).map(entry => resolveExpression(entry));
    if (!values.length || values.some(value => value === undefined)) return undefined;
    const numbers = values as number[];
    if (fn[1] === "min") return Math.min(...numbers);
    if (fn[1] === "max") return Math.max(...numbers);
    return numbers.length === 3 ? Math.min(numbers[2], Math.max(numbers[0], numbers[1])) : undefined;
  };
  const resolved = resolveExpression(token);
  return resolved !== undefined && resolved >= 0 ? resolved : undefined;
}

function registerBorderImageAssets(
  context: CaptureContext,
  borders: DesignNode["borders"],
  nodeId: string,
): void {
  // Pseudo-elements use the same border-image paint model as ordinary
  // elements, but they do not pass through the regular element asset loop.
  // Register their URL sources here so the plugin can build the editable
  // nine-slice fallback instead of leaving only an unresolved CSS URL.
  for (const border of borders || []) {
    if (!border?.imageSource) continue;
    const resolvedSource = resolveResourceUrl(border.imageSource, context.document);
    border.imageSource = resolvedSource;
    border.imageAssetId = addAsset(
      context,
      "image",
      resolvedSource,
      resolvedSource.startsWith("data:") ? resolvedSource : context.imageData.get(resolvedSource),
    );
    if (!resolvedSource.startsWith("data:") && !context.imageData.has(resolvedSource)) {
      context.diagnostics.push({
        code: "image-external",
        message: "border-image is referenced by URL and could not be inlined for the Figma export",
        nodeId,
      });
    }
  }
}

export function outlineFor(style: CSSStyleDeclaration): DesignNode["outline"] {
  const width = cssBorderWidthValue(style.outlineWidth, 0, numberValue(style.fontSize, 16));
  const outlineStyle = String(style.outlineStyle ?? "none");
  if (width <= 0 || outlineStyle === "none" || outlineStyle === "hidden") return undefined;
  const rawColor = String(style.outlineColor ?? "");
  const inheritedColor = resolveCurrentColor(
    String(style.color ?? "rgba(0, 0, 0, 0)"),
    "rgb(0, 0, 0)",
  );
  const color = resolveCurrentColor(
    /^(?:auto|currentcolor)$/i.test(rawColor.trim()) ? inheritedColor : rawColor || "rgba(0, 0, 0, 0)",
    inheritedColor,
  );
  return {
    color,
    width,
    style: outlineStyle,
  };
}

type SizingProperty = "width" | "height" | "minWidth" | "maxWidth" | "minHeight" | "maxHeight"
  | "inlineSize" | "blockSize" | "minInlineSize" | "maxInlineSize" | "minBlockSize" | "maxBlockSize"
  | "paddingInlineStart" | "paddingInlineEnd" | "paddingBlockStart" | "paddingBlockEnd"
  | "marginInlineStart" | "marginInlineEnd" | "marginBlockStart" | "marginBlockEnd"
  | "padding" | "paddingInline" | "paddingBlock" | "margin" | "marginInline" | "marginBlock"
  | "insetInlineStart" | "insetInlineEnd" | "insetBlockStart" | "insetBlockEnd"
  | "insetInline" | "insetBlock" | "inset"
  | "gap" | "rowGap" | "columnGap" | "left" | "right" | "top" | "bottom"
  | "unicodeBidi";
type SizingAxis = "width" | "height";

interface SizingContext {
  element?: Element;
  rect?: DOMRect;
  parentStyle?: CSSStyleDeclaration;
  rootFontSize?: number;
  viewportWidth?: number;
  viewportHeight?: number;
}

function typedSizingValue(element: Element | undefined, property: string): string {
  if (!element) return "";
  const typedElement = element as Element & {
    computedStyleMap?: () => { get(property: string): unknown };
  };
  if (typeof typedElement.computedStyleMap !== "function") return "";
  try {
    // Keep the long-standing `width`/`height` Typed OM keys unchanged for
    // physical axes; logical properties use their CSS hyphenated spelling.
    const typedProperty = property === "width" || property === "height"
      ? property
      : property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
    const value = typedElement.computedStyleMap().get(typedProperty) as {
      unit?: string;
      value?: unknown;
      toString?: () => string;
    } | null | undefined;
    if (!value) return "";
    const numeric = Number(value.value);
    if (value.unit === "percent" && Number.isFinite(numeric)) return `${numeric}%`;
    if (value.unit && Number.isFinite(numeric)) return `${numeric}${value.unit === "number" ? "" : value.unit}`;
    const serialized = typeof value.toString === "function" ? value.toString().trim() : "";
    return serialized && serialized !== "[object Object]" ? serialized : "";
  } catch {
    // Typed OM is optional and can reject unsupported/custom properties.
    return "";
  }
}

function selectorSpecificity(selector: string): [number, number, number] {
  const normalized = selector.replace(/:where\([^)]*\)/g, "");
  return [
    (normalized.match(/#[\w-]+/g) || []).length,
    (normalized.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+(?:\([^)]*\))?/g) || []).length,
    (normalized.match(/(^|[\s>+~,(])([a-zA-Z][\w-]*)/g) || []).length,
  ];
}

function compareSpecificity(left: [number, number, number], right: [number, number, number]): number {
  return left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
}

function authoredStylesheetValue(element: Element, property: SizingProperty): string {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  if (!view) return "";
  const cssProperty = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
  const inlineValue = "style" in element
    ? String((element.style as CSSStyleDeclaration)[property] || "").trim()
    : "";
  const inlineImportant = "style" in element
    && (element.style as CSSStyleDeclaration).getPropertyPriority(cssProperty) === "important";
  let winner: { value: string; important: boolean; specificity: [number, number, number]; order: number } | undefined = inlineValue
    ? { value: inlineValue, important: inlineImportant, specificity: [1_000_000, 0, 0], order: Number.MAX_SAFE_INTEGER }
    : undefined;
  let order = 0;
  const visitRules = (rules: CSSRuleList | undefined, active = true): void => {
    if (!rules || !active) return;
    for (let index = 0; index < rules.length; index += 1) {
      const rule = rules[index];
      order += 1;
      const nested = "cssRules" in rule ? (rule as CSSGroupingRule).cssRules : undefined;
      if (nested) {
        let nestedActive: boolean = active;
        if ("media" in rule && typeof (rule as CSSMediaRule).media?.mediaText === "string" && typeof view.matchMedia === "function") {
          try { nestedActive = view.matchMedia((rule as CSSMediaRule).media.mediaText).matches; } catch { nestedActive = active; }
        } else if (rule.constructor?.name === "CSSSupportsRule" && "conditionText" in rule && view.CSS?.supports) {
          try { nestedActive = view.CSS.supports((rule as CSSConditionRule).conditionText); } catch { nestedActive = active; }
        }
        visitRules(nested, nestedActive);
      }
      const selector = "selectorText" in rule ? String((rule as CSSStyleRule).selectorText || "") : "";
      if (!selector || !active) continue;
      const matchingSelectors = splitCssArguments(selector).filter((candidate) => {
        try { return element.matches(candidate); } catch { return false; }
      });
      if (!matchingSelectors.length) continue;
      const declaration = (rule as CSSStyleRule).style;
      const raw = declaration?.getPropertyValue(cssProperty).trim() || "";
      if (!raw) continue;
      const important = declaration.getPropertyPriority(cssProperty) === "important";
      const specificity = matchingSelectors
        .map(selectorSpecificity)
        .reduce((best, candidate) => compareSpecificity(candidate, best) > 0 ? candidate : best);
      const specificityDelta = winner
        ? compareSpecificity(specificity, winner.specificity)
        : 1;
      const better = !winner
        || Number(important) > Number(winner.important)
        || (important === winner.important && (specificityDelta > 0 || (specificityDelta === 0 && order >= winner.order)));
      if (better) winner = { value: raw, important, specificity, order };
    }
  };
  for (const sheet of Array.from(doc.styleSheets)) {
    try {
      visitRules(sheet.cssRules);
    } catch {
      // Cross-origin stylesheets can reject cssRules access. Keep inspecting
      // readable sheets; Typed OM and geometry remain the final fallback.
    }
  }
  return winner?.value || "";
}

function authoredSizingValue(element: Element | undefined, axis: SizingAxis): string {
  if (!element) return "";
  // A physical declaration remains the most direct source for the Figma
  // width/height axis. If it is absent, map the logical axis through the
  // element's writing mode so `inline-size`/`block-size` preserve their
  // authored responsive token rather than falling back to a used pixel size.
  const physical = authoredStylesheetValue(element, axis);
  if (physical && !["auto", "none", "normal"].includes(physical.trim().toLowerCase())) return physical;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const writingMode = String(
    (style as CSSStyleDeclaration & { writingMode?: string } | undefined)?.writingMode
      || style?.getPropertyValue("writing-mode")
      || "horizontal-tb",
  ).trim().toLowerCase();
  const verticalWriting = writingMode.startsWith("vertical-") || writingMode.startsWith("sideways-");
  const logical = axis === "width"
    ? (verticalWriting ? "blockSize" : "inlineSize")
    : (verticalWriting ? "inlineSize" : "blockSize");
  const logicalAuthored = authoredStylesheetValue(element, logical);
  if (logicalAuthored) return logicalAuthored;
  const logicalTyped = typedSizingValue(element, logical);
  if (logicalTyped && !["auto", "none", "normal"].includes(logicalTyped.trim().toLowerCase())) return logicalTyped;
  const typedPhysical = typedSizingValue(element, axis);
  return typedPhysical && !["auto", "none", "normal"].includes(typedPhysical.trim().toLowerCase())
    ? typedPhysical
    : physical;
}

function sizingExpression(value: string): string | undefined {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized || ["auto", "none", "normal"].includes(normalized)) return undefined;
  return String(value).trim();
}

/**
 * Infer Figma's sizing intent from the flex relationship instead of the
 * computed pixel value. getComputedStyle() resolves percentages and `auto`
 * to pixels, so checking `style.width.endsWith('%')` loses the information
 * that distinguishes fill, hug, and fixed children.
 */
function sizingModeFor(style: CSSStyleDeclaration, context: SizingContext, axis: SizingAxis): DesignLayout["widthMode"] {
  const element = context.element;
  const parent = element?.parentElement;
  const parentStyle = context.parentStyle ?? (parent ? parent.ownerDocument.defaultView?.getComputedStyle(parent) : undefined);
  const parentAutoLayoutHint = String(parent?.getAttribute("data-figma-auto-layout") || "").trim().toLowerCase();
  const hintedParentDirection = parentAutoLayoutHint === "horizontal" || parentAutoLayoutHint === "vertical"
    ? parentAutoLayoutHint
    : undefined;
  const blockParent = Boolean(parentStyle && parent && isRepresentableBlockFlowContainer(parentStyle, parent));
  const flexOrGridParent = Boolean(parentStyle && parent && (parentStyle.display === "flex" || parentStyle.display === "inline-flex" || parentStyle.display === "grid" || parentStyle.display === "inline-grid"));
  const flexParent = Boolean(parentStyle && parent && (parentStyle.display === "flex" || parentStyle.display === "inline-flex"));
  const hintedAutoLayoutParent = Boolean(parentStyle && parent && hintedParentDirection);
  if (!parentStyle || !parent || (!flexOrGridParent && !blockParent && !hintedAutoLayoutParent)) {
    return "fixed";
  }

  const parentWritingMode = String(
    (parentStyle as CSSStyleDeclaration & { writingMode?: string }).writingMode
      || parentStyle.getPropertyValue?.("writing-mode")
      || "horizontal-tb",
  ).trim().toLowerCase();
  const verticalInlineAxis = parentWritingMode.startsWith("vertical-") || parentWritingMode.startsWith("sideways-");
  const parentDirection = hintedParentDirection ?? (blockParent
    ? (verticalInlineAxis ? "horizontal" : "vertical")
    : flexParent
      ? ((parentStyle.flexDirection === "row" || parentStyle.flexDirection === "row-reverse")
        ? (verticalInlineAxis ? "vertical" : "horizontal")
        : (verticalInlineAxis ? "horizontal" : "vertical"))
      : "vertical");
  const isMainAxis = axis === "width" ? parentDirection === "horizontal" : parentDirection === "vertical";
  const childMargin = axis === "width"
    ? numberValue(style.marginLeft) + numberValue(style.marginRight)
    : numberValue(style.marginTop) + numberValue(style.marginBottom);
  const flexGrow = numberValue(style.flexGrow);
  const flexBasis = String(style.flexBasis || "auto").trim();
  // The capture document lives in a sandboxed iframe, so its elements belong
  // to a different realm and fail `instanceof HTMLElement` in the host
  // window. Use the structural `style` property instead.
  // CSSStyleDeclaration only exposes declarations authored directly on the
  // element. CSS Typed OM retains percentage/keyword computed values from
  // classes and media queries before they collapse into the pixel string
  // returned by getComputedStyle(), preserving responsive sizing intent.
  const authoredValue = authoredSizingValue(element, axis);
  const normalizedAuthoredValue = authoredValue.trim().toLowerCase();
  const explicitIntrinsicAuthoredSizing = new Set([
    "auto", "none", "normal", "initial", "unset", "revert", "revert-layer",
    "content", "min-content", "max-content", "fit-content",
  ]);
  const fullPercentage = /^100(?:\.0+)?%$/.test(normalizedAuthoredValue);
  const nonFillResponsiveSizing = !fullPercentage
    && (/%|(?:\d|\.)+(?:vw|vh|vmin|vmax|svw|svh|svmin|svmax|lvw|lvh|lvmin|lvmax|dvw|dvh|dvmin|dvmax)\b|\b(?:calc|min|max|clamp|fit-content)\s*\(/i.test(authoredValue));

  // Stylesheet declarations are not reflected in `element.style`. When a
  // flex item already occupies the complete content-box span of its parent,
  // the rendered geometry is stronger evidence than the missing authored
  // declaration and should map to Figma FILL. Missing this case turns common
  // `width: 100%` / `height: 100%` rules into HUG, which lets Figma reflow the
  // entire subtree around its intrinsic content size.
  if (isMainAxis) {
    const parentRect = parent.getBoundingClientRect();
    const parentSize = axis === "width" ? parentRect.width : parentRect.height;
    const parentPadding = axis === "width"
      ? numberValue(parentStyle.paddingLeft) + numberValue(parentStyle.paddingRight) + numberValue(parentStyle.borderLeftWidth) + numberValue(parentStyle.borderRightWidth)
      : numberValue(parentStyle.paddingTop) + numberValue(parentStyle.paddingBottom) + numberValue(parentStyle.borderTopWidth) + numberValue(parentStyle.borderBottomWidth);
    const childRect = context.rect ?? element.getBoundingClientRect();
    const childSize = axis === "width" ? childRect.width : childRect.height;
    const available = Math.max(0, parentSize - parentPadding - childMargin);
    if (available > 0 && Math.abs(childSize - available) <= 1.5 && !nonFillResponsiveSizing
      && !explicitIntrinsicAuthoredSizing.has(normalizedAuthoredValue)) {
      return "fill";
    }
  }

  // Only a growing item or an authored percentage consumes the remaining
  // main-axis space in Figma. A fixed `flex-basis` is an initial size, not a
  // request to fill the parent; treating `flex-basis: 240px` as FILL makes
  // Figma stretch cards that are fixed-width in the browser.
  // Figma has no percentage flex-basis equivalent. Treating it as FILL
  // consumes all remaining space when siblings are present, which is not the
  // CSS result for `flex: 0 0 50%`. Keep the measured size fixed and retain
  // the authored basis in the plugin metadata instead.
  // A partial percentage (for example `width: 50%`) is not equivalent to
  // Figma FILL: FILL consumes all remaining space and stretches the layer to
  // the parent's edge. Keep the captured box FIXED for partial/functional
  // percentages and retain the authored token as metadata instead. Only a
  // full 100% declaration (or real flex growth) maps to FILL.
  if (flexGrow > 0 || fullPercentage) return "fill";

  // The browser stretches flex children on the cross axis when no child
  // override is present. Compare against the parent's content box so borders
  // and padding do not turn a genuinely filled child into a fixed one.
  if (!isMainAxis) {
    const parentRect = parent.getBoundingClientRect();
    const parentSize = axis === "width" ? parentRect.width : parentRect.height;
    const parentPadding = axis === "width"
      ? numberValue(parentStyle.paddingLeft) + numberValue(parentStyle.paddingRight) + numberValue(parentStyle.borderLeftWidth) + numberValue(parentStyle.borderRightWidth)
      : numberValue(parentStyle.paddingTop) + numberValue(parentStyle.paddingBottom) + numberValue(parentStyle.borderTopWidth) + numberValue(parentStyle.borderBottomWidth);
    const childRect = context.rect ?? element.getBoundingClientRect();
    const childSize = axis === "width" ? childRect.width : childRect.height;
    const childAlign = style.alignSelf || "auto";
    const parentAlign = parentStyle.alignItems || "normal";
    if (!nonFillResponsiveSizing
      && (childAlign === "auto" || childAlign === "stretch")
      && (parentAlign === "stretch" || parentAlign === "normal")
      && Math.abs(childSize - Math.max(0, parentSize - parentPadding - childMargin)) <= 1.5) return "fill";
  }

  // Remaining flex items size to their content on the main axis. This is the
  // useful `hug` signal for Figma; fixed is reserved for explicitly sized or
  // non-flex content where there is no layout relationship to preserve.
  const normalizedFlexBasis = flexBasis.toLowerCase();
  const intrinsicFlexBasis = ["auto", "content", "min-content", "max-content", "fit-content"].includes(normalizedFlexBasis);
  // An explicit intrinsic basis is the sizing contract for the flex item.
  // CSS may still expose a width declaration as a fallback or preferred size,
  // but Figma must keep the item content-sized when the basis says otherwise.
  // Parameterized fit-content(<length>) is intentionally excluded: its upper
  // bound is finite and remains on the measured/fixed path.
  const explicitIntrinsicBasis = ["content", "min-content", "max-content", "fit-content"].includes(normalizedFlexBasis);
  if (isMainAxis && !flexGrow && intrinsicFlexBasis
    && (explicitIntrinsicBasis || normalizedAuthoredValue === "" || explicitIntrinsicAuthoredSizing.has(normalizedAuthoredValue))) {
    return "hug";
  }
  return "fixed";
}

export function layoutFor(style: CSSStyleDeclaration, context: SizingContext = {}): DesignLayout {
  const tag = context.element?.tagName.toUpperCase() || "";
  const isTable = tag === "TABLE";
  const isTableSection = TABLE_SECTION_TAGS.has(tag);
  const isTableRow = tag === "TR";
  const isFlex = style.display === "flex" || style.display === "inline-flex";
  const isGrid = style.display === "grid" || style.display === "inline-grid";
  const isBlockFlow = !isFlex && !isGrid && isRepresentableBlockFlowContainer(style, context.element);
  const writingMode = String(
    (style as CSSStyleDeclaration & { writingMode?: string }).writingMode
      || style.getPropertyValue?.("writing-mode")
      || "horizontal-tb",
  ).trim().toLowerCase();
  const verticalInlineAxis = writingMode.startsWith("vertical-") || writingMode.startsWith("sideways-");
  const directionRtl = String(style.direction || style.getPropertyValue?.("direction") || "ltr").trim().toLowerCase().startsWith("rtl");
  const direction = style.flexDirection === "row" || style.flexDirection === "row-reverse"
    ? (verticalInlineAxis ? "vertical" : "horizontal")
    : (verticalInlineAxis ? "horizontal" : "vertical");
  const flexRow = style.flexDirection === "row" || style.flexDirection === "row-reverse";
  // CSS `row` follows the inline direction. Figma's horizontal Auto Layout
  // axis is physically left-to-right, so an RTL row needs the same measured
  // child-order reversal as `row-reverse` in LTR. Column flow is unaffected
  // by bidi direction here.
  const flexReverse = isFlex && (flexRow
    ? (style.flexDirection === "row-reverse") !== directionRtl
    : style.flexDirection === "column-reverse");
  const rect = context.rect;
  const fontSize = numberValue(cssStyleValue(style, "fontSize", "font-size"), 16);
  const rootStyle = context.element?.ownerDocument.defaultView?.getComputedStyle(context.element.ownerDocument.documentElement);
  const rootFontSize = context.rootFontSize ?? numberValue(rootStyle?.fontSize || "", 16);
  const viewportWidth = context.viewportWidth
    ?? context.element?.ownerDocument.defaultView?.innerWidth
    ?? context.element?.ownerDocument.documentElement.clientWidth
    ?? 0;
  const viewportHeight = context.viewportHeight
    ?? context.element?.ownerDocument.defaultView?.innerHeight
    ?? context.element?.ownerDocument.documentElement.clientHeight
    ?? 0;
  const horizontalReference = rect
    ? Math.max(0, rect.width - numberValue(style.paddingLeft) - numberValue(style.paddingRight) - numberValue(style.borderLeftWidth) - numberValue(style.borderRightWidth))
    : 0;
  const verticalReference = rect
    ? Math.max(0, rect.height - numberValue(style.paddingTop) - numberValue(style.paddingBottom) - numberValue(style.borderTopWidth) - numberValue(style.borderBottomWidth))
    : 0;
  const shorthandGap = splitCssSpaceValues(String(style.gap || "").trim());
  const shorthandRowGap = shorthandGap[0] || String(style.gap || "");
  const shorthandColumnGap = shorthandGap[1] || shorthandRowGap;
  // Computed styles intentionally expose resolved pixels, but a percentage,
  // calc(), or font-relative gap is still part of the authored responsive
  // contract. Preserve the winning declaration independently so Figma/plugin
  // consumers can inspect it without replacing the captured pixel geometry.
  const authoredGap = context.element ? authoredStylesheetValue(context.element, "gap") : "";
  const authoredRowGap = context.element ? authoredStylesheetValue(context.element, "rowGap") : "";
  const authoredColumnGap = context.element ? authoredStylesheetValue(context.element, "columnGap") : "";
  const authoredGapParts = splitCssSpaceValues(authoredGap);
  const authoredRowGapExpression = authoredRowGap || authoredGapParts[0] || undefined;
  const authoredColumnGapExpression = authoredColumnGap || authoredGapParts[1] || authoredGapParts[0] || undefined;
  const authoredGapExpression = authoredGap || undefined;
  const tableElement = isTableRow || isTableSection
    ? context.element?.closest("table")
    : undefined;
  const tableStyle = tableElement && context.element?.ownerDocument.defaultView
    ? context.element.ownerDocument.defaultView.getComputedStyle(tableElement)
    : style;
  const effectiveTableStyle = isTableRow || isTableSection || isTable ? tableStyle : style;
  const tableCollapsed = String(effectiveTableStyle.borderCollapse || "separate").trim().toLowerCase() === "collapse";
  const borderSpacing = splitCssSpaceValues(String(effectiveTableStyle.borderSpacing || "").trim());
  const tableColumnSpacing = tableCollapsed ? 0 : borderSpacing.length ? numberValue(borderSpacing[0]) : 0;
  const tableRowSpacing = tableCollapsed ? 0 : borderSpacing.length > 1 ? numberValue(borderSpacing[1]) : tableColumnSpacing;
  const autoMargins = autoMarginEdges(style, context.element);
  const rowGapToken = String(style.rowGap || "").trim().toLowerCase();
  const columnGapToken = String(style.columnGap || "").trim().toLowerCase();
  // CSS row/column gap percentages follow the container's block/inline
  // axes, not the physical screen axes. Vertical and sideways writing modes
  // therefore swap the percentage references before resolving the captured
  // pixel values; the authored expressions remain unchanged below.
  const rowGapReference = verticalInlineAxis ? horizontalReference : verticalReference;
  const columnGapReference = verticalInlineAxis ? verticalReference : horizontalReference;
  const rowGap = rowGapToken && rowGapToken !== "normal"
    ? gapValue(rowGapToken, rowGapReference, fontSize, rootFontSize, viewportWidth, viewportHeight)
    : gapValue(shorthandRowGap, rowGapReference, fontSize, rootFontSize, viewportWidth, viewportHeight);
  const columnGap = columnGapToken && columnGapToken !== "normal"
    ? gapValue(columnGapToken, columnGapReference, fontSize, rootFontSize, viewportWidth, viewportHeight)
    : gapValue(shorthandColumnGap, columnGapReference, fontSize, rootFontSize, viewportWidth, viewportHeight);
  const resolvedRowGap = isTable ? tableRowSpacing : isTableRow || isTableSection ? 0 : rowGap;
  const resolvedColumnGap = isTableRow ? tableColumnSpacing : columnGap;
  const gap = resolvedRowGap;
  // Generated pages may opt into an editable Figma Auto Layout frame with a
  // data attribute even when the browser uses ordinary block flow for the
  // visual page. Preserve that explicit contract at capture time; relying
  // only on computed `display` would otherwise turn the hint into a fixed
  // frame during Figma import.
  const autoLayoutHint = String(context.element?.getAttribute("data-figma-auto-layout") || "").trim().toLowerCase();
  const hintedMode = autoLayoutHint === "horizontal" || autoLayoutHint === "vertical" ? autoLayoutHint : undefined;
  // CSS size containment deliberately prevents descendants from contributing
  // to the containing box's intrinsic size. Figma's HUG mode has the opposite
  // behavior, so keep the captured axis fixed when the source uses
  // `contain: size` (or the size-inclusive `strict`/`content` shorthands).
  // `inline-size` only locks the physical inline axis; vertical writing modes
  // therefore map it to height instead of width.
  const containTokens = String(style.contain || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const containsBothSizes = containTokens.some((token) => ["size", "strict", "content"].includes(token));
  const containsInlineSize = containTokens.includes("inline-size");
  let widthMode = sizingModeFor(style, context, "width");
  let heightMode = sizingModeFor(style, context, "height");
  if (containsBothSizes) {
    widthMode = "fixed";
    heightMode = "fixed";
  } else if (containsInlineSize) {
    if (verticalInlineAxis) heightMode = "fixed";
    else widthMode = "fixed";
  }
  return {
    ...emptyLayout(),
    // H2D has reliable support for flex wrapping, while CSS grid support is
    // inconsistent across Figma importers. Grid children already carry their
    // measured widths, so a wrapped row preserves the rendered geometry and
    // remains editable as an Auto Layout frame.
    mode: hintedMode ?? (isTableRow ? "horizontal" : isTable || isTableSection ? "vertical" : isFlex ? direction : isGrid ? "horizontal" : isBlockFlow ? "vertical" : "none"),
    reverse: flexReverse ? true : undefined,
    ...(autoMargins ? { autoMargins } : {}),
    wrap: isGrid || (isFlex && (style.flexWrap === "wrap" || style.flexWrap === "wrap-reverse")),
    wrapReverse: isFlex && style.flexWrap === "wrap-reverse" ? true : undefined,
    gap,
    // `0` is an authored value, not a missing value. Do not let a shorthand
    // gap re-enter when CSS explicitly sets row-gap: 0.
    rowGap: resolvedRowGap,
    columnGap: resolvedColumnGap,
    ...(authoredGapExpression && authoredGapExpression.toLowerCase() !== "normal" ? { gapExpression: authoredGapExpression } : {}),
    ...(authoredRowGapExpression && authoredRowGapExpression.toLowerCase() !== "normal" ? { rowGapExpression: authoredRowGapExpression } : {}),
    ...(authoredColumnGapExpression && authoredColumnGapExpression.toLowerCase() !== "normal" ? { columnGapExpression: authoredColumnGapExpression } : {}),
    padding: isTable && !tableCollapsed ? [tableRowSpacing, tableColumnSpacing, tableRowSpacing, tableColumnSpacing] : parsePadding(style, context.element),
    // In CSS block, flex, and grid formatting contexts, `align-items: normal`
    // resolves to the stretch behavior (with the usual flex/grid exceptions
    // for baseline-aligned items). Treating flex `normal` as start makes
    // imported text cards hug their content after crossing into Figma; that
    // changes the available text width/height and can make captured leading
    // appear to have been lost even when TextNode.lineHeight is preserved.
    alignItems: isBlockFlow || ((isFlex || isGrid) && String(style.alignItems || "").trim().toLowerCase() === "normal")
      ? "stretch"
      : alignValue(style.alignItems),
    alignSelf: alignSelfValue(style.alignSelf),
    alignContent: contentAlignValue(style.alignContent),
    justifyItems: isGrid && String(style.justifyItems || "").trim().toLowerCase() === "normal"
      ? "stretch"
      : justifyItemsValue(style.justifyItems),
    justifySelf: isGrid && String(style.justifySelf || "").trim().toLowerCase() === "normal"
      ? "stretch"
      : justifySelfValue(style.justifySelf),
    ...(style.placeContent && style.placeContent !== "normal" ? { placeContent: style.placeContent } : {}),
    ...(style.placeItems && style.placeItems !== "normal" ? { placeItems: style.placeItems } : {}),
    ...(style.placeSelf && style.placeSelf !== "auto" ? { placeSelf: style.placeSelf } : {}),
    order: Number.isFinite(Number.parseInt(style.order, 10)) ? Number.parseInt(style.order, 10) : 0,
    justifyContent: justifyValue(style.justifyContent, isGrid),
    widthMode,
    heightMode,
    ...(sizingExpression(authoredSizingValue(context.element, "width")) ? { widthExpression: sizingExpression(authoredSizingValue(context.element, "width")) } : {}),
    ...(sizingExpression(authoredSizingValue(context.element, "height")) ? { heightExpression: sizingExpression(authoredSizingValue(context.element, "height")) } : {}),
    position: style.position === "absolute" || style.position === "fixed" ? "absolute" : "flow",
    ...(isGrid ? {
      gridTemplateColumns: style.gridTemplateColumns,
      gridTemplateRows: style.gridTemplateRows,
      gridTemplateAreas: style.gridTemplateAreas,
      gridAutoFlow: style.gridAutoFlow,
      gridAutoColumns: style.gridAutoColumns,
      gridAutoRows: style.gridAutoRows,
    } : {}),
    ...(style.gridColumnStart && style.gridColumnStart !== "auto" ? { gridColumnStart: style.gridColumnStart } : {}),
    ...(style.gridColumnEnd && style.gridColumnEnd !== "auto" ? { gridColumnEnd: style.gridColumnEnd } : {}),
    ...(style.gridRowStart && style.gridRowStart !== "auto" ? { gridRowStart: style.gridRowStart } : {}),
    ...(style.gridRowEnd && style.gridRowEnd !== "auto" ? { gridRowEnd: style.gridRowEnd } : {}),
    ...(style.gridArea && style.gridArea !== "auto / auto / auto / auto" ? { gridArea: style.gridArea } : {}),
  };
}

function makeId(context: CaptureContext, element: Element): string {
  const existing = context.nodeIdByElement.get(element);
  if (existing) return existing;
  const authoredId = element.getAttribute("id");
  const id = authoredId ? `node-${authoredId}` : `node-${context.sequence++}`;
  context.nodeIdByElement.set(element, id);
  return id;
}

function addAsset(context: CaptureContext, kind: DesignAsset["kind"], src: string, data?: string): string {
  const existing = context.assetBySource.get(`${kind}:${src}`);
  if (existing) return existing;
  const id = `asset-${context.assets.length}`;
  context.assets.push({ id, kind, src, data });
  context.assetBySource.set(`${kind}:${src}`, id);
  return id;
}

function imageSource(image: HTMLImageElement): { src: string; data?: string } | null {
  const src = image.currentSrc || image.getAttribute("src") || "";
  if (!src) return null;
  if (src.startsWith("data:") || src.startsWith("blob:")) return { src, data: src };
  return { src };
}

function cssImageUrlsIncludingData(value: string): string[] {
  const urls: string[] = [];
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    const url = match[2].trim();
    if (url && !url.startsWith("blob:") && !url.startsWith("#")) urls.push(url);
  }
  return urls;
}

/**
 * Collect every CSS image source that can become an imported asset. Keep this
 * independent from DOM traversal so ordinary elements and pseudo-elements use
 * exactly the same URL/data-URL handling.
 */
export function cssStyleImageSources(style?: CSSStyleDeclaration | null): string[] {
  if (!style) return [];
  const values = style as CSSStyleDeclaration & Record<string, string | undefined>;
  const maskImage = values.maskImage || values.WebkitMaskImage || values.webkitMaskImage || "";
  return Array.from(new Set([
    ...cssImageUrlsIncludingData(style.backgroundImage || ""),
    ...cssImageUrlsIncludingData(style.borderImageSource || ""),
    ...cssImageUrlsIncludingData(maskImage),
  ]));
}

export function normalizeImageSetForDevicePixelRatio(value: string, devicePixelRatio = 1): string {
  const source = String(value || "");
  if (!/\b(?:-webkit-)?image-set\(/i.test(source)) return source;
  const dpr = Number.isFinite(Number(devicePixelRatio)) && Number(devicePixelRatio) > 0
    ? Number(devicePixelRatio)
    : 1;
  let output = "";
  let cursor = 0;
  const matcher = /(?:-webkit-)?image-set\(/ig;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source))) {
    const start = match.index;
    if (start < cursor) continue;
    output += source.slice(cursor, start);
    let depth = 1;
    let quote = "";
    let end = matcher.lastIndex;
    for (; end < source.length; end += 1) {
      const character = source[end];
      if (quote) {
        if (character === quote && source[end - 1] !== "\\") quote = "";
        continue;
      }
      if (character === "\"" || character === "'") quote = character;
      else if (character === "(") depth += 1;
      else if (character === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    if (depth !== 0) {
      output += source.slice(start);
      cursor = source.length;
      break;
    }
    const entries = splitCssArguments(source.slice(matcher.lastIndex, end)).flatMap((candidate) => {
      const text = candidate.trim();
      const url = text.match(/url\(\s*(['"]?)(.*?)\1\s*\)/i);
      const string = !url && text.match(/^(['"])(.*?)\1/i);
      const selected = url || string;
      if (!selected || !selected[2]) return [];
      const density = text.match(/(?:^|\s)([+-]?(?:\d+\.?\d*|\.\d+))x(?:\s|$)/i);
      return [{
        source: url ? url[0] : `url(${JSON.stringify(selected[2])})`,
        density: density ? Number.parseFloat(density[1]) : 1,
        hasDensity: Boolean(density),
      }];
    });
    if (!entries.length) {
      output += source.slice(start, end + 1);
    } else {
      // An omitted resolution descriptor is CSS's 1x candidate. Keep it in
      // mixed candidate lists instead of silently dropping it when another
      // image-set entry carries an explicit density.
      const candidates = entries.filter((entry) => Number.isFinite(entry.density) && entry.density > 0);
      const atOrAbove = candidates.filter((entry) => entry.density >= dpr);
      const pool = atOrAbove.length ? atOrAbove : candidates;
      const chosen = pool.slice().sort((left, right) => atOrAbove.length
        ? left.density - right.density
        : right.density - left.density)[0];
      output += chosen.source;
    }
    cursor = end + 1;
    matcher.lastIndex = cursor;
  }
  return output + source.slice(cursor);
}

interface SvgGradientStop {
  color: string;
  opacity: number;
  offset: number;
}

interface ParsedCssGradient {
  kind: "linear" | "radial" | "conic";
  repeating: boolean;
  body: string;
}

function expandGradientStops(stops: SvgGradientStop[]): SvgGradientStop[] {
  if (stops.length < 2) return stops;
  const expanded: SvgGradientStop[] = [];
  const colorChannels = (value: string): [number, number, number] | undefined => {
    const match = value.match(/^#([0-9a-f]{6})$/i);
    if (!match) return undefined;
    return [
      Number.parseInt(match[1].slice(0, 2), 16),
      Number.parseInt(match[1].slice(2, 4), 16),
      Number.parseInt(match[1].slice(4, 6), 16),
    ];
  };
  const hexColor = (channels: [number, number, number]): string => `#${channels.map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
  for (let index = 0; index < stops.length - 1; index += 1) {
    const start = stops[index];
    const end = stops[index + 1];
    const startChannels = colorChannels(start.color);
    const endChannels = colorChannels(end.color);
    if (!startChannels || !endChannels || end.offset <= start.offset) {
      expanded.push(start);
      continue;
    }
    expanded.push(start);
    const steps = Math.max(1, Math.ceil((end.offset - start.offset) / 0.05));
    for (let step = 1; step < steps; step += 1) {
      const ratio = step / steps;
      expanded.push({
        color: hexColor([
          startChannels[0] + (endChannels[0] - startChannels[0]) * ratio,
          startChannels[1] + (endChannels[1] - startChannels[1]) * ratio,
          startChannels[2] + (endChannels[2] - startChannels[2]) * ratio,
        ]),
        opacity: start.opacity + (end.opacity - start.opacity) * ratio,
        offset: start.offset + (end.offset - start.offset) * ratio,
      });
    }
  }
  expanded.push(stops[stops.length - 1]);
  return expanded;
}

function splitCssArguments(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function cssGradientFunctions(value: string): ParsedCssGradient[] {
  const functions: ParsedCssGradient[] = [];
  // Do not match the `linear-gradient` suffix inside
  // `repeating-linear-gradient`; the negative lookbehind keeps the prefix
  // attached so repeating layers retain their pattern semantics.
  const pattern = /(?<![\w-])(repeating-)?(linear|radial|conic)-gradient\(/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value))) {
    let depth = 1;
    let index = pattern.lastIndex;
    for (; index < value.length && depth > 0; index += 1) {
      if (value[index] === "(") depth += 1;
      else if (value[index] === ")") depth -= 1;
    }
    if (depth === 0) {
      functions.push({ kind: match[2].toLowerCase() as ParsedCssGradient["kind"], repeating: Boolean(match[1]), body: value.slice(pattern.lastIndex, index - 1) });
      pattern.lastIndex = index;
    }
  }
  return functions;
}

function srgbColorChannel(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

// Keep CSS named colors accepted by the capture-side Color 4 fallback in
// sync with the Figma plugin parser. `color-mix()` resolves its stops before
// SVG serialization, so a named stop that SVG itself could render would still
// be lost if this intermediate parser rejected it.
const CSS_NAMED_COLORS: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", blue: "#0000ff", green: "#008000",
  lime: "#00ff00", yellow: "#ffff00", orange: "#ffa500", purple: "#800080", pink: "#ffc0cb",
  gray: "#808080", grey: "#808080", silver: "#c0c0c0", navy: "#000080", teal: "#008080",
  aqua: "#00ffff", cyan: "#00ffff", fuchsia: "#ff00ff", magenta: "#ff00ff", maroon: "#800000",
  olive: "#808000",
};

function modernSvgColor(value: string): { color: string; opacity: number } | null {
  const match = value.trim().match(/^(lab|lch|oklab|oklch|hwb|color|color-mix)\((.*)\)$/i);
  if (!match) return null;
  const name = match[1].toLowerCase();
  const body = match[2].trim();
  const number = (token: string, percentageScale = 1): number | null => {
    const parsed = Number.parseFloat(token);
    if (!Number.isFinite(parsed)) return null;
    return token.trim().endsWith("%") ? parsed / 100 * percentageScale : parsed;
  };
  const toHex = (channel: number): string => Math.round(Math.max(0, Math.min(1, srgbColorChannel(channel))) * 255).toString(16).padStart(2, "0");
  if (name === "color-mix") {
    const args = splitCssArguments(body);
    if (args.length < 3 || !/^in\s+srgb(?:\s+shorter)?$/i.test(args[0])) return null;
    const parseStop = (token: string): { parsed: { color: string; opacity: number }; weight: number | null } | null => {
      const stop = token.trim().match(/^(.*?)(?:\s+(-?(?:\d+(?:\.\d*)?|\.\d+))%)?$/);
      if (!stop) return null;
      const colorToken = CSS_NAMED_COLORS[stop[1].trim().toLowerCase()] || stop[1];
      const parsed = svgColor(colorToken);
      return parsed ? { parsed, weight: stop[2] == null ? null : Math.max(0, Number(stop[2]) / 100) } : null;
    };
    const first = parseStop(args[1]);
    const second = parseStop(args[2]);
    if (!first || !second) return null;
    let firstWeight = first.weight;
    let secondWeight = second.weight;
    if (firstWeight == null && secondWeight == null) firstWeight = secondWeight = 0.5;
    else if (firstWeight == null) firstWeight = Math.max(0, 1 - (secondWeight ?? 0));
    else if (secondWeight == null) secondWeight = Math.max(0, 1 - firstWeight);
    const resolvedFirstWeight = firstWeight ?? 0;
    const resolvedSecondWeight = secondWeight ?? 0;
    const total = resolvedFirstWeight + resolvedSecondWeight;
    if (!(total > 0)) return null;
    const left = resolvedFirstWeight / total;
    const right = resolvedSecondWeight / total;
    const red = first.parsed.color.match(/^#([0-9a-f]{6})$/i);
    const blue = second.parsed.color.match(/^#([0-9a-f]{6})$/i);
    if (!red || !blue) return null;
    const channel = (source: RegExpMatchArray, index: number): number => Number.parseInt(source[1].slice(index, index + 2), 16) / 255;
    return {
      color: `#${toHex(channel(red, 0) * left + channel(blue, 0) * right)}${toHex(channel(red, 2) * left + channel(blue, 2) * right)}${toHex(channel(red, 4) * left + channel(blue, 4) * right)}`,
      opacity: first.parsed.opacity * left + second.parsed.opacity * right,
    };
  }
  if (name === "color") {
    const tokens = body.replace(/\s*\/\s*/g, " ").trim().split(/[\s,]+/).filter(Boolean);
    if (tokens.length < 4) return null;
    const profile = tokens[0].toLowerCase();
    if (!["srgb", "srgb-linear", "display-p3"].includes(profile)) return null;
    const channels = tokens.slice(1, 4).map(token => number(token));
    if (channels.some(channel => channel == null)) return null;
    const alphaToken = body.match(/\/(?:\s*)([^\s]+)\s*$/)?.[1];
    const opacity = alphaToken == null ? 1 : number(alphaToken);
    if (opacity == null) return null;
    const clamp = (channel: number): number => Math.max(0, Math.min(1, channel));
    const encodedHex = (channel: number): string => Math.round(clamp(channel) * 255).toString(16).padStart(2, "0");
    const linearHex = (channel: number): string => toHex(channel);
    if (profile === "srgb") {
      return { color: `#${channels.map(channel => encodedHex(channel as number)).join("")}`, opacity: clamp(opacity) };
    }
    if (profile === "srgb-linear") {
      return { color: `#${channels.map(channel => linearHex(channel as number)).join("")}`, opacity: clamp(opacity) };
    }
    const [r, g, b] = channels.map(channel => clamp(channel as number));
    const x = 0.4865709486482162 * r + 0.2656676931699633 * g + 0.1982172852343625 * b;
    const y = 0.2289745640697488 * r + 0.6917385218365064 * g + 0.079286914093745 * b;
    const z = 0.04511338185890264 * g + 1.043944368900976 * b;
    const srgbLinear = [
      3.240969941904522 * x - 1.537383177570093 * y - 0.4986107602930034 * z,
      -0.9692436362808798 * x + 1.8759675015077202 * y + 0.04155505740717559 * z,
      0.05563007969699366 * x - 0.20397695888897652 * y + 1.0569715142428786 * z,
    ];
    return { color: `#${srgbLinear.map(channel => linearHex(channel)).join("")}`, opacity: clamp(opacity) };
  }
  if (name === "hwb") {
    const tokens = body.replace(/\s*\/\s*/g, " ").trim().split(/[\s,]+/).filter(Boolean);
    if (tokens.length < 3) return null;
    const hueToken = tokens[0].toLowerCase();
    const hueValue = Number.parseFloat(hueToken);
    if (!Number.isFinite(hueValue)) return null;
    const hue = ((hueToken.endsWith("turn") ? hueValue * 360
      : hueToken.endsWith("rad") ? hueValue * 180 / Math.PI
        : hueToken.endsWith("grad") ? hueValue * 0.9
          : hueValue) % 360 + 360) % 360 / 360;
    const whiteness = number(tokens[1]);
    const blackness = number(tokens[2]);
    const alphaToken = body.match(/\/(?:\s*)([^\s]+)\s*$/)?.[1];
    const opacity = alphaToken == null ? 1 : number(alphaToken);
    if (whiteness == null || blackness == null || opacity == null) return null;
    const white = Math.max(0, Math.min(1, whiteness));
    const black = Math.max(0, Math.min(1, blackness));
    const directHex = (channel: number): string => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, "0");
    if (white + black >= 1) {
      const gray = (white + black) > 0 ? white / (white + black) : 0;
      return { color: `#${directHex(gray)}${directHex(gray)}${directHex(gray)}`, opacity: Math.max(0, Math.min(1, opacity)) };
    }
    const hueToRgb = (t: number): number => {
      const normalized = (t + 1) % 1;
      if (normalized < 1 / 6) return 6 * normalized;
      if (normalized < 1 / 2) return 1;
      if (normalized < 2 / 3) return (2 / 3 - normalized) * 6;
      return 0;
    };
    const base = [hueToRgb(hue + 1 / 3), hueToRgb(hue), hueToRgb(hue - 1 / 3)];
    const scale = 1 - white - black;
    const channels = base.map(channel => channel * scale + white);
    return { color: `#${channels.map(directHex).join("")}`, opacity: Math.max(0, Math.min(1, opacity)) };
  }
  if (name === "lab" || name === "lch") {
    const tokens = body.replace(/\s*\/\s*/g, " ").trim().split(/[\s,]+/).filter(Boolean);
    if (tokens.length < 3) return null;
    const lightness = number(tokens[0], 100);
    const second = number(tokens[1], name === "lab" ? 125 : 150);
    const alphaToken = body.match(/\/(?:\s*)([^\s]+)\s*$/)?.[1];
    const opacity = alphaToken == null ? 1 : number(alphaToken);
    if (lightness == null || second == null || opacity == null) return null;
    const L = Math.max(0, Math.min(100, lightness));
    let a: number;
    let b: number;
    if (name === "lab") {
      const third = number(tokens[2], 125);
      if (third == null) return null;
      a = second;
      b = third;
    } else {
      const chroma = second;
      const hueToken = tokens[2].toLowerCase();
      const hueValue = Number.parseFloat(hueToken);
      if (!Number.isFinite(hueValue)) return null;
      const hue = hueToken.endsWith("turn") ? hueValue * Math.PI * 2
        : hueToken.endsWith("rad") ? hueValue
          : hueToken.endsWith("grad") ? hueValue * Math.PI / 200
            : hueValue * Math.PI / 180;
      a = chroma * Math.cos(hue);
      b = chroma * Math.sin(hue);
    }
    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;
    const inverse = (input: number): number => {
      const cube = input * input * input;
      return cube > epsilon ? cube : (116 * input - 16) / kappa;
    };
    const fy = (L + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const xD50 = 0.96422 * inverse(fx);
    const yD50 = inverse(fy);
    const zD50 = 0.82521 * inverse(fz);
    const x = 0.9554734 * xD50 - 0.0230985 * yD50 + 0.0632593 * zD50;
    const y = -0.0283697 * xD50 + 1.0099955 * yD50 + 0.0210414 * zD50;
    const z = 0.0123140 * xD50 - 0.0205077 * yD50 + 1.3303659 * zD50;
    const linear = [
      3.24096994 * x - 1.53738318 * y - 0.49861076 * z,
      -0.96924364 * x + 1.8759675 * y + 0.04155506 * z,
      0.05563008 * x - 0.20397696 * y + 1.05697151 * z,
    ];
    return { color: `#${linear.map(toHex).join("")}`, opacity: Math.max(0, Math.min(1, opacity)) };
  }
  const tokens = body.replace(/\s*\/\s*/g, " ").trim().split(/[\s,]+/).filter(Boolean);
  if (tokens.length < 3) return null;
  const lightness = number(tokens[0]);
  const alphaToken = body.match(/\/(?:\s*)([^\s]+)\s*$/)?.[1];
  const opacity = alphaToken ? number(alphaToken) : 1;
  if (lightness == null || opacity == null) return null;
  let a: number | null;
  let b: number | null;
  if (name === "oklab") {
    a = number(tokens[1], 0.4);
    b = number(tokens[2], 0.4);
  } else {
    const chroma = number(tokens[1], 0.4);
    const hueToken = tokens[2].toLowerCase();
    const hueValue = Number.parseFloat(hueToken);
    if (chroma == null || !Number.isFinite(hueValue)) return null;
    const hue = hueToken.endsWith("turn") ? hueValue * Math.PI * 2
      : hueToken.endsWith("rad") ? hueValue
        : hueToken.endsWith("grad") ? hueValue * Math.PI / 200
          : hueValue * Math.PI / 180;
    a = chroma * Math.cos(hue);
    b = chroma * Math.sin(hue);
  }
  if (a == null || b == null) return null;
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  return {
    color: `#${toHex(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s)}${toHex(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s)}${toHex(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)}`,
    opacity: Math.max(0, Math.min(1, opacity)),
  };
}

function svgColor(value: string): { color: string; opacity: number } | null {
  const raw = value.trim();
  if (!raw) return null;
  if (raw.toLowerCase() === "transparent") return { color: "#000000", opacity: 0 };
  const modern = modernSvgColor(raw);
  if (modern) return modern;
  const hex = raw.match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let valueHex = hex[1];
    if (valueHex.length === 3 || valueHex.length === 4) valueHex = valueHex.split("").map((character) => character + character).join("");
    if (valueHex.length === 6) valueHex += "ff";
    if (valueHex.length !== 8) return null;
    return { color: `#${valueHex.slice(0, 6)}`, opacity: Number.parseInt(valueHex.slice(6), 16) / 255 };
  }
  const rgb = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgb) return { color: raw, opacity: 1 };
  const tokens = rgb[1].replaceAll("/", " ").trim().split(/[ ,]+/).filter(Boolean);
  const channel = (token: string): number => token.endsWith("%") ? Number.parseFloat(token) * 2.55 : Number.parseFloat(token);
  const alpha = (token: string | undefined): number => token?.endsWith("%") ? Number.parseFloat(token) / 100 : Number.parseFloat(token ?? "1");
  const channels = tokens.slice(0, 3).map(channel);
  if (channels.length !== 3 || channels.some((channelValue) => !Number.isFinite(channelValue))) return null;
  const toHex = (channelValue: number): string => Math.max(0, Math.min(255, Math.round(channelValue))).toString(16).padStart(2, "0");
  return { color: `#${channels.map(toHex).join("")}`, opacity: Number.isFinite(alpha(tokens[3])) ? alpha(tokens[3]) : 1 };
}

function parseGradientStopParts(value: string): { parsed: { color: string; opacity: number }; positions: string[] } | null {
  // CSS permits a unitless zero as a length. Normalize only zero so other
  // unitless numbers cannot be mistaken for pixel stops.
  const normalized = value.trim().replace(/\s+(-?0)(?=\s|$)/g, " $1px");
  const match = normalized.match(/^(.*?)(?:\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px|deg|grad|rad|turn)))?(?:\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:%|px|deg|grad|rad|turn)))?$/);
  if (!match) return null;
  const parsed = svgColor(match[1]);
  if (!parsed) return null;
  return { parsed, positions: [match[2], match[3]].filter((position): position is string => Boolean(position)) };
}

function parseGradientStopPosition(
  position: string,
  kind: ParsedCssGradient["kind"],
  direction: string,
  width: number,
  height: number,
  cycle?: number,
): number {
  const numeric = Number.parseFloat(position);
  if (position.endsWith("%")) return numeric / 100;
  if (cycle && cycle > 0) return numeric / cycle;
  if (kind === "conic") {
    const raw = position.trim().toLowerCase();
    const angle = cssAngleDegrees(raw) ?? numeric;
    const from = direction.match(/\bfrom\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(?:deg|grad|rad|turn))/i)?.[1];
    if (!from) return ((angle % 360) + 360) % 360 / 360;
    const fromAngle = cssAngleDegrees(from) ?? Number.parseFloat(from);
    return ((((angle - fromAngle) % 360) + 360) % 360) / 360;
  }
  if (kind === "linear") {
    const angle = gradientAngle(direction) * Math.PI / 180;
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const extent = Math.min(
      Math.abs(dx) > 0.0001 ? width / (2 * Math.abs(dx)) : Number.POSITIVE_INFINITY,
      Math.abs(dy) > 0.0001 ? height / (2 * Math.abs(dy)) : Number.POSITIVE_INFINITY,
    );
    return numeric / Math.max(1, extent * 2);
  }
  const geometry = radialGradientGeometry(direction, width, height);
  return numeric / Math.max(1, geometry.radius);
}

function repeatingGradientCycle(records: Array<{ positions: string[] }>, kind: ParsedCssGradient["kind"], direction: string, width: number, height: number): number | undefined {
  const pixelPositions = records.flatMap((record) => record.positions)
    .filter((position) => position.endsWith("px"))
    .map((position) => Number.parseFloat(position))
    .filter(Number.isFinite);
  if (pixelPositions.length < 2) return undefined;
  const first = Math.min(...pixelPositions);
  const last = Math.max(...pixelPositions);
  if (kind === "linear") {
    const angle = gradientAngle(direction) * Math.PI / 180;
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const extent = Math.min(
      Math.abs(dx) > 0.0001 ? width / (2 * Math.abs(dx)) : Number.POSITIVE_INFINITY,
      Math.abs(dy) > 0.0001 ? height / (2 * Math.abs(dy)) : Number.POSITIVE_INFINITY,
    );
    const length = Math.max(1, extent * 2);
    return Math.max(1, last - first || length);
  }
  if (kind === "conic") {
    return Math.max(1, last - first || 360);
  }
  const geometry = radialGradientGeometry(direction, width, height);
  return Math.max(1, last - first || geometry.radius);
}

function cssAngleDegrees(value: string): number | undefined {
  const raw = value.trim().toLowerCase();
  const match = raw.match(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(deg|grad|rad|turn)$/i);
  if (!match) return raw === "0" ? 0 : undefined;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return undefined;
  const unit = match[2].toLowerCase();
  if (unit === "turn") return amount * 360;
  if (unit === "rad") return amount * 180 / Math.PI;
  if (unit === "grad") return amount * 0.9;
  return amount;
}

function gradientAngle(value: string): number {
  const raw = value.trim().toLowerCase();
  const numericAngle = cssAngleDegrees(raw);
  if (numericAngle !== undefined) return numericAngle;
  if (!raw.startsWith("to ")) return 180;
  const directions = raw.slice(3).split(/\s+/);
  const has = (direction: string) => directions.includes(direction);
  if (has("top") && has("right")) return 45;
  if (has("bottom") && has("right")) return 135;
  if (has("bottom") && has("left")) return 225;
  if (has("top") && has("left")) return 315;
  if (has("top")) return 0;
  if (has("bottom")) return 180;
  if (has("left")) return 270;
  return 180;
}

function linearGradientCoordinates(angle: number, width: number, height: number): [number, number, number, number] {
  const radians = angle * Math.PI / 180;
  const directionX = Math.sin(radians);
  const directionY = -Math.cos(radians);
  const extent = Math.min(
    Math.abs(directionX) > 0.0001 ? width / (2 * Math.abs(directionX)) : Number.POSITIVE_INFINITY,
    Math.abs(directionY) > 0.0001 ? height / (2 * Math.abs(directionY)) : Number.POSITIVE_INFINITY,
  );
  const dx = directionX * extent;
  const dy = directionY * extent;
  return [0.5 - dx / width, 0.5 - dy / height, 0.5 + dx / width, 0.5 + dy / height];
}

function radialGradientGeometry(direction: string, width: number, height: number): { cx: number; cy: number; radius: number; scaleY: number } {
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const raw = direction.trim().toLowerCase();
  // Parenthesis-aware tokenization preserves calc()/min()/max()/clamp()
  // positions as one axis value instead of splitting at their inner spaces.
  const at = splitCssSpaceValues(raw.match(/\bat\s+(.+)$/)?.[1] ?? "");
  const keyword: Record<string, number> = { left: 0, center: 0.5, right: 1, top: 0, bottom: 1 };
  const percent = (value: string | undefined): number | undefined => {
    const match = value?.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))%$/);
    return match ? Number.parseFloat(match[1]) / 100 : undefined;
  };
  const position = (value: string | undefined, size: number): number | undefined => {
    const percentage = percent(value);
    if (percentage != null) return percentage;
    const normalized = String(value ?? "").trim().toLowerCase();
    const simple = normalized.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))(px|em|rem)$/i);
    const functional = /^(?:calc|min|max|clamp)\(/i.test(normalized)
      && normalized.endsWith(")")
      && !/(?:^|[^a-z])(?:vw|vh|vmin|vmax|svw|svh|svmin|svmax|lvw|lvh|lvmin|lvmax|dvw|dvh|dvmin|dvmax)\b/i.test(normalized);
    if (!simple && !functional) return undefined;
    const resolved = gapValue(normalized, Math.max(1, size), 16, 16, 0, 0, false);
    return resolved / Math.max(1, size);
  };
  let cx = 0.5;
  let cy = 0.5;
  if (at.length >= 3) {
    let hasX = false;
    let hasY = false;
    for (let index = 0; index < at.length; index += 1) {
      const token = at[index];
      if (token === "left" || token === "right") {
        const offset = position(at[index + 1], safeWidth);
        cx = offset == null ? keyword[token] : token === "right" ? 1 - offset : offset;
        hasX = true;
        if (offset != null) index += 1;
        continue;
      }
      if (token === "top" || token === "bottom") {
        const offset = position(at[index + 1], safeHeight);
        cy = offset == null ? keyword[token] : token === "bottom" ? 1 - offset : offset;
        hasY = true;
        if (offset != null) index += 1;
        continue;
      }
      if (token === "center") {
        if (!hasX) { cx = 0.5; hasX = true; }
        else if (!hasY) { cy = 0.5; hasY = true; }
        continue;
      }
      if (!hasX) {
        const parsed = position(token, safeWidth);
        if (parsed != null) { cx = parsed; hasX = true; }
      } else if (!hasY) {
        const parsed = position(token, safeHeight);
        if (parsed != null) { cy = parsed; hasY = true; }
      }
    }
  } else if (at.length === 1) {
    const parsed = position(at[0], safeWidth);
    if (parsed != null) cx = parsed;
    else if (at[0] in keyword) {
      if (at[0] === "top" || at[0] === "bottom") cy = keyword[at[0]];
      else cx = keyword[at[0]];
    }
  } else if (at.length >= 2) {
    const first = position(at[0], safeWidth);
    const second = position(at[1], safeHeight);
    if (first != null) {
      cx = first;
      if (second != null) cy = second;
      else if (["top", "center", "bottom"].includes(at[1])) cy = keyword[at[1]];
    } else if (at[0] === "center") {
      cx = 0.5;
      if (second != null) cy = second;
      else if (["top", "center", "bottom"].includes(at[1])) cy = keyword[at[1]];
      else if (["left", "right"].includes(at[1])) cx = keyword[at[1]];
    } else if (["top", "bottom"].includes(at[0])) {
      cy = keyword[at[0]];
      if (second != null) cx = second;
      else if (["left", "center", "right"].includes(at[1])) cx = keyword[at[1]];
    } else if (["left", "right"].includes(at[0])) {
      cx = keyword[at[0]];
      if (second != null) cy = second;
      else if (["top", "center", "bottom"].includes(at[1])) cy = keyword[at[1]];
    }
  }
  const sideDistances = [
    Math.abs(cx * safeWidth),
    Math.abs((1 - cx) * safeWidth),
    Math.abs(cy * safeHeight),
    Math.abs((1 - cy) * safeHeight),
  ];
  const cornerDistances = [
    Math.hypot(cx * safeWidth, cy * safeHeight),
    Math.hypot((1 - cx) * safeWidth, cy * safeHeight),
    Math.hypot(cx * safeWidth, (1 - cy) * safeHeight),
    Math.hypot((1 - cx) * safeWidth, (1 - cy) * safeHeight),
  ];
  const size = raw.match(/\b(closest|farthest)-(side|corner)\b/i);
  const distanceMode = size ? `${size[1].toLowerCase()}-${size[2].toLowerCase()}` : "farthest-corner";
  const distances = distanceMode.endsWith("corner") ? cornerDistances : sideDistances;
  const radius = distanceMode.startsWith("closest") ? Math.min(...distances) : Math.max(...distances);
  const ellipse = !/^circle\b/i.test(raw);
  const radiusX = ellipse
    ? (distanceMode.endsWith("corner") ? Math.max(Math.abs(cx * safeWidth), Math.abs((1 - cx) * safeWidth)) : (distanceMode.startsWith("closest") ? Math.min(Math.abs(cx * safeWidth), Math.abs((1 - cx) * safeWidth)) : Math.max(Math.abs(cx * safeWidth), Math.abs((1 - cx) * safeWidth))))
    : radius;
  const radiusY = ellipse
    ? (distanceMode.endsWith("corner") ? Math.max(Math.abs(cy * safeHeight), Math.abs((1 - cy) * safeHeight)) : (distanceMode.startsWith("closest") ? Math.min(Math.abs(cy * safeHeight), Math.abs((1 - cy) * safeHeight)) : Math.max(Math.abs(cy * safeHeight), Math.abs((1 - cy) * safeHeight))))
    : radius;
  const safeRadius = Math.max(0.001, radiusX);
  return { cx, cy, radius: safeRadius, scaleY: Math.max(0.001, radiusY / safeRadius) };
}

function conicGradientAngle(direction: string): number {
  const match = direction.match(/\bfrom\s+(-?(?:\d+(?:\.\d*)?|\.\d+)(deg|grad|rad|turn))/i);
  if (!match) return 0;
  const value = Number.parseFloat(match[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = match[2].toLowerCase();
  return unit === "turn" ? value * 360 : unit === "rad" ? value * 180 / Math.PI : unit === "grad" ? value * 0.9 : value;
}

function hexChannels(value: string): [number, number, number] | undefined {
  const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return undefined;
  return [
    Number.parseInt(match[1].slice(0, 2), 16),
    Number.parseInt(match[1].slice(2, 4), 16),
    Number.parseInt(match[1].slice(4, 6), 16),
  ];
}

function conicGradientColor(stops: SvgGradientStop[], offset: number, repeating = false): { color: string; opacity: number } {
  if (repeating && stops.length >= 2) {
    const first = stops[0].offset;
    const last = stops[stops.length - 1].offset;
    const cycle = last - first;
    if (cycle > 0.000001) {
      // Repeating conic gradients wrap the final stop back to the first stop
      // instead of clamping the paint at 100%. Sample the cyclic interval and
      // let the normal interpolation below handle the seam between them.
      const wrapped = first + ((((offset - first) % cycle) + cycle) % cycle);
      const cyclicStops = [
        ...stops,
        { ...stops[0], offset: first + cycle },
      ];
      let left = cyclicStops[0];
      let right = cyclicStops[cyclicStops.length - 1];
      for (let index = 1; index < cyclicStops.length; index += 1) {
        if (cyclicStops[index].offset >= wrapped) {
          right = cyclicStops[index];
          left = cyclicStops[index - 1];
          break;
        }
      }
      const span = Math.max(0.000001, right.offset - left.offset);
      const ratio = Math.max(0, Math.min(1, (wrapped - left.offset) / span));
      const a = hexChannels(left.color);
      const b = hexChannels(right.color);
      if (!a || !b) return { color: left.color, opacity: left.opacity };
      const channels = a.map((channel, index) => Math.round(channel + (b[index] - channel) * ratio));
      return {
        color: `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`,
        opacity: left.opacity + (right.opacity - left.opacity) * ratio,
      };
    }
  }
  const normalized = Math.max(0, Math.min(1, offset));
  let left = stops[0];
  let right = stops[stops.length - 1];
  for (let index = 1; index < stops.length; index += 1) {
    if (stops[index].offset >= normalized) {
      right = stops[index];
      left = stops[index - 1];
      break;
    }
  }
  const start = left.offset;
  const span = Math.max(0.000001, right.offset - start);
  const ratio = Math.max(0, Math.min(1, (normalized - start) / span));
  const a = hexChannels(left.color);
  const b = hexChannels(right.color);
  if (!a || !b) return { color: left.color, opacity: left.opacity };
  const channels = a.map((channel, index) => Math.round(channel + (b[index] - channel) * ratio));
  const color = `#${channels.map(channel => channel.toString(16).padStart(2, "0")).join("")}`;
  return { color, opacity: left.opacity + (right.opacity - left.opacity) * ratio };
}

function conicGradientSectors(stops: SvgGradientStop[], direction: string, width: number, height: number, repeating = false): string[] {
  if (stops.length < 2) return [];
  const geometry = radialGradientGeometry(direction, width, height);
  const centerX = geometry.cx * width;
  const centerY = geometry.cy * height;
  const radius = Math.max(
    Math.hypot(centerX, centerY),
    Math.hypot(width - centerX, centerY),
    Math.hypot(centerX, height - centerY),
    Math.hypot(width - centerX, height - centerY),
  );
  const completeStops = stops.slice().sort((left, right) => left.offset - right.offset);
  if (!repeating) {
    if (completeStops[0].offset > 0) completeStops.unshift({ ...completeStops[0], offset: 0 });
    if (completeStops[completeStops.length - 1].offset < 1) completeStops.push({ ...completeStops[completeStops.length - 1], offset: 1 });
  }
  const startAngle = conicGradientAngle(direction) - 90;
  const segments = 180;
  const paths: string[] = [];
  for (let index = 0; index < segments; index += 1) {
    const from = index / segments;
    const to = (index + 1) / segments;
    const color = conicGradientColor(completeStops, (from + to) / 2, repeating);
    const fromRadians = (startAngle + from * 360) * Math.PI / 180;
    const toRadians = (startAngle + to * 360) * Math.PI / 180;
    const x1 = centerX + Math.cos(fromRadians) * radius;
    const y1 = centerY + Math.sin(fromRadians) * radius;
    const x2 = centerX + Math.cos(toRadians) * radius;
    const y2 = centerY + Math.sin(toRadians) * radius;
    const opacity = color.opacity < 1 ? ` fill-opacity="${color.opacity}"` : "";
    paths.push(`<path d="M ${centerX} ${centerY} L ${x1} ${y1} A ${radius} ${radius} 0 0 1 ${x2} ${y2} Z" fill="${color.color}"${opacity}/>`);
  }
  return paths;
}

function gradientStops(body: string, kind: ParsedCssGradient["kind"], repeating: boolean, width: number, height: number): { stops: SvgGradientStop[]; direction: string; cycle?: number } {
  const args = splitCssArguments(body);
  let direction = "180deg";
  let stopArgs = args;
  if (kind === "linear" && args.length > 1 && (/^(?:to\s+|[-+]?(?:\d|\.))/i.test(args[0]))) {
    direction = args[0];
    stopArgs = args.slice(1);
  } else if (kind === "radial" && args.length > 1 && /^(?:circle|ellipse|closest|farthest|at\s+)/i.test(args[0])) {
    direction = args[0];
    stopArgs = args.slice(1);
  } else if (kind === "conic" && args.length > 1 && /^(?:from\s+|at\s+)/i.test(args[0])) {
    direction = args[0];
    stopArgs = args.slice(1);
  }
  const records = stopArgs.map((stop) => parseGradientStopParts(stop));
  const cycle = repeating
    ? repeatingGradientCycle(records.filter((record): record is NonNullable<typeof record> => Boolean(record)), kind, direction, width, height)
    : undefined;
  const primaryPositions = records.map((record) => record?.positions[0]
    ? parseGradientStopPosition(record.positions[0], kind, direction, width, height, cycle)
    : undefined);
  // CSS distributes omitted positions between the surrounding explicit
  // stops. Resolve those positions before expanding two-position stops so the
  // SVG fallback and native Figma Paint use the same stop coordinates.
  for (let index = 0; index < primaryPositions.length; index += 1) {
    if (primaryPositions[index] != null) continue;
    let left = index - 1;
    while (left >= 0 && primaryPositions[left] == null) left -= 1;
    let right = index + 1;
    while (right < primaryPositions.length && primaryPositions[right] == null) right += 1;
    const start = left >= 0 ? primaryPositions[left] as number : 0;
    const end = right < primaryPositions.length ? primaryPositions[right] as number : 1;
    primaryPositions[index] = start + (end - start) * ((index - left) / Math.max(1, right - left));
  }
  return {
    stops: records.flatMap((record, index) => {
      if (!record) return [];
      const offsets = record.positions.length
        ? record.positions.map((position) => parseGradientStopPosition(position, kind, direction, width, height, cycle))
        : [primaryPositions[index] ?? index / Math.max(1, stopArgs.length - 1)];
      return offsets.map((offset) => ({
        color: record.parsed.color,
        opacity: record.parsed.opacity,
        offset: Math.max(0, Math.min(1, offset)),
      }));
    }),
    direction,
    cycle,
  };
}

export function backgroundSvgDataUrl(
  backgroundImage: string,
  backgroundColor: string,
  width: number,
  height: number,
  currentColor = "rgb(0, 0, 0)",
): string | undefined {
  backgroundImage = resolveCurrentColor(backgroundImage, currentColor);
  backgroundColor = resolveCurrentColor(backgroundColor, currentColor);
  const functions = cssGradientFunctions(backgroundImage);
  // Figma-compatible importers may reinterpret CSS gradients with their own color
  // interpolation and alpha compositing. That produces visible differences
  // even for a single opaque linear gradient. Capture gradient-only layers as
  // SVG so the browser-resolved stops and geometry become the visual source
  // of truth. Backgrounds containing external image URLs stay on the native
  // URL path because a partial SVG would otherwise drop those resources.
  if (!functions.length || /\burl\s*\(/i.test(backgroundImage)) return undefined;
  const defs: string[] = [];
  const layers: string[] = [];
  const base = svgColor(backgroundColor);
  if (base) layers.push(`<rect width="${width}" height="${height}" fill="${base.color}" fill-opacity="${base.opacity}"/>`);
  // CSS paints the first background image on top. SVG paints later elements on
  // top, so walk the CSS layers in reverse order.
  for (let index = functions.length - 1; index >= 0; index -= 1) {
    const gradient = functions[index];
    const parsed = gradientStops(gradient.body, gradient.kind, gradient.repeating, width, height);
    if (parsed.stops.length < 2) continue;
    const stops = expandGradientStops(parsed.stops);
    const id = `gradient-${index}`;
    if (gradient.repeating && gradient.kind === "linear" && parsed.cycle) {
      const angle = gradientAngle(parsed.direction);
      const horizontal = Math.abs(Math.sin(angle * Math.PI / 180)) > 0.9;
      const vertical = Math.abs(Math.cos(angle * Math.PI / 180)) > 0.9;
      if (horizontal || vertical) {
        const patternWidth = horizontal ? parsed.cycle : width;
        const patternHeight = vertical ? parsed.cycle : height;
        const x2 = horizontal ? parsed.cycle : 0;
        const y1 = vertical ? parsed.cycle : 0;
        const y2 = vertical ? 0 : 0;
        const stopMarkup = stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join("");
        defs.push(`<linearGradient id="${id}-linear" color-interpolation="sRGB" gradientUnits="userSpaceOnUse" x1="0" y1="${y1}" x2="${x2}" y2="${y2}">${stopMarkup}</linearGradient>`);
        defs.push(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="${patternWidth}" height="${patternHeight}"><rect width="${patternWidth}" height="${patternHeight}" fill="url(#${id}-linear)"/></pattern>`);
        layers.push(`<rect width="${width}" height="${height}" fill="url(#${id})"/>`);
        continue;
      }
    }
    if (gradient.kind === "conic") {
      // SVG 1.1 has no conic-gradient primitive. Render the captured conic
      // paint as a finite set of editable vector sectors so Figma receives
      // the browser's center, start angle, and color interpolation instead
      // of silently dropping the background. Repeating conic gradients use
      // cyclic stop sampling so the final sector wraps back to the first.
      const sectors = conicGradientSectors(parsed.stops, parsed.direction, width, height, gradient.repeating);
      if (sectors.length) layers.push(sectors.join(""));
      continue;
    }
    if (gradient.kind === "linear") {
      const [x1, y1, x2, y2] = linearGradientCoordinates(gradientAngle(parsed.direction), width, height);
      const stopMarkup = stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join("");
      const spread = gradient.repeating ? ` spreadMethod="repeat"` : "";
      defs.push(`<linearGradient id="${id}" color-interpolation="sRGB" gradientUnits="objectBoundingBox" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"${spread}>${stopMarkup}</linearGradient>`);
      layers.push(`<rect width="${width}" height="${height}" fill="url(#${id})"/>`);
    } else {
      const geometry = radialGradientGeometry(parsed.direction, width, height);
      const stopMarkup = stops.map((stop) => `<stop offset="${stop.offset * 100}%" stop-color="${stop.color}" stop-opacity="${stop.opacity}"/>`).join("");
      const centerX = geometry.cx * width;
      const centerY = geometry.cy * height;
      const transform = geometry.scaleY === 1 ? "" : ` gradientTransform="matrix(1 0 0 ${geometry.scaleY} 0 ${centerY * (1 - geometry.scaleY)})"`;
      const spread = gradient.repeating ? ` spreadMethod="repeat"` : "";
      defs.push(`<radialGradient id="${id}" color-interpolation="sRGB" gradientUnits="userSpaceOnUse" cx="${centerX}" cy="${centerY}" r="${geometry.radius}"${transform}${spread}>${stopMarkup}</radialGradient>`);
      layers.push(`<rect width="${width}" height="${height}" fill="url(#${id})"/>`);
    }
  }
  if (!layers.length) return undefined;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs>${defs.join("")}</defs>${layers.join("")}</svg>`;
  const bytes = new TextEncoder().encode(svg);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

function resolveResourceUrl(source: string, doc: Document): string {
  try {
    return new URL(source, doc.baseURI || window.location.href).href;
  } catch {
    return source;
  }
}

function resolveCssImageUrls(value: string, doc: Document): string {
  return value.replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (full, quote: string, source: string) => {
    if (!source || source.startsWith("data:") || source.startsWith("blob:") || source.startsWith("#")) return full;
    const resolved = resolveResourceUrl(source, doc);
    return `url(${quote}${resolved}${quote})`;
  });
}

async function inlineImageUrl(source: string, context: CaptureContext): Promise<void> {
  const resolvedSource = resolveResourceUrl(source, context.document);
  if (!resolvedSource || context.imageData.has(resolvedSource)) return;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeout = window.setTimeout(() => controller?.abort(), ASSET_WAIT_TIMEOUT_MS);
  try {
    const response = await fetch(resolvedSource, { credentials: "same-origin", signal: controller?.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.size > MAX_INLINE_IMAGE_BYTES) {
      context.diagnostics.push({ code: "image-too-large", message: `Image exceeds the ${MAX_INLINE_IMAGE_BYTES / (1024 * 1024)} MB inline limit` });
      return;
    }
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = "";
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    context.imageData.set(resolvedSource, `data:${blob.type || "application/octet-stream"};base64,${btoa(binary)}`);
  } catch {
    // Keep the source URL so H2D can report an unresolved remote resource.
  } finally {
    window.clearTimeout(timeout);
  }
}

async function inlineAccessibleImages(doc: Document, context: CaptureContext): Promise<void> {
  const imageSources = new Set<string>();
  for (const image of Array.from(doc.images)) {
    const source = imageSource(image);
    if (source && !source.data?.startsWith("data:")) imageSources.add(source.src);
  }
  for (const element of Array.from(doc.querySelectorAll("*"))) {
    // CSS generated content is not represented by a DOM element, so its
    // background/border-image/mask URLs must be scanned explicitly. Without
    // this, pseudo-element border-image records keep only a remote URL and
    // cannot reach the editable image-backed fallback in Figma.
    const styles = [
      doc.defaultView?.getComputedStyle(element),
      doc.defaultView?.getComputedStyle(element, "::before"),
      doc.defaultView?.getComputedStyle(element, "::after"),
    ];
    for (const style of styles) {
      for (const source of cssStyleImageSources(style)) {
        if (source.startsWith("data:")) addAsset(context, "image", source, source);
        else imageSources.add(source);
      }
    }
    const style = styles[0];
    const markerSource = listMarkerImageSource(style ?? ({ listStyleImage: "none" } as CSSStyleDeclaration));
    if (markerSource) {
      if (markerSource.startsWith("data:")) addAsset(context, "image", markerSource, markerSource);
      else imageSources.add(markerSource);
    }
  }
  await Promise.all(Array.from(imageSources, async (source) => {
    await inlineImageUrl(source, context);
    const resolvedSource = resolveResourceUrl(source, context.document);
    addAsset(context, "image", resolvedSource, context.imageData.get(resolvedSource));
  }));
}

const SVG_PRESENTATION_PROPERTIES = [
  ["fill", "fill"],
  ["fill-opacity", "fill-opacity"],
  ["fill-rule", "fill-rule"],
  ["stroke", "stroke"],
  ["stroke-opacity", "stroke-opacity"],
  ["stroke-width", "stroke-width"],
  ["stroke-linecap", "stroke-linecap"],
  ["stroke-linejoin", "stroke-linejoin"],
  ["stroke-miterlimit", "stroke-miterlimit"],
  ["stroke-dasharray", "stroke-dasharray"],
  ["stroke-dashoffset", "stroke-dashoffset"],
  ["opacity", "opacity"],
  ["clip-rule", "clip-rule"],
  ["stop-color", "stop-color"],
  ["stop-opacity", "stop-opacity"],
  ["color-interpolation", "color-interpolation"],
  ["color-interpolation-filters", "color-interpolation-filters"],
  ["paint-order", "paint-order"],
  ["vector-effect", "vector-effect"],
  ["shape-rendering", "shape-rendering"],
  ["marker-start", "marker-start"],
  ["marker-mid", "marker-mid"],
  ["marker-end", "marker-end"],
  ["flood-color", "flood-color"],
  ["flood-opacity", "flood-opacity"],
  ["lighting-color", "lighting-color"],
] as const;

export function inlineSvgStyles(element: Element, doc: Document): string {
  const clone = element.cloneNode(true) as Element;
  const sourceNodes = [element, ...Array.from(element.querySelectorAll("*"))];
  const cloneNodes = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const defaultView = doc.defaultView;
  const resolvedBySource = new Map<Element, Map<string, string>>();
  for (let index = 0; index < sourceNodes.length; index += 1) {
    const source = sourceNodes[index];
    const target = cloneNodes[index];
    const computed = defaultView?.getComputedStyle(source);
    if (!computed) continue;
    const inherited = source.parentElement ? resolvedBySource.get(source.parentElement) : undefined;
    const color = computed.color?.trim() || inherited?.get("color") || "rgb(0, 0, 0)";
    const resolved = new Map<string, string>([["color", color]]);
    // Figma receives the SVG without the source document stylesheet. Inline
    // every final presentation value, including values inherited by child
    // paths from a class on the root SVG. Explicit authored attributes still
    // win; only currentColor needs resolving before the stylesheet is gone.
    for (const [attribute, property] of SVG_PRESENTATION_PROPERTIES) {
      const authored = target.getAttribute(attribute);
      const computedValue = computed.getPropertyValue(property).trim();
      // A few SVG presentation properties are not exposed by older DOM
      // implementations' CSSStyleDeclaration even though the stylesheet
      // declaration is readable. Keep the stylesheet value as a fallback so
      // vector paint order, non-scaling strokes, and gradient metadata survive
      // serialization in those runtimes too.
      const authoredStylesheet = authoredStylesheetValue(source, property as SizingProperty).trim();
      const finalValue = (authored || computedValue || authoredStylesheet || inherited?.get(property) || "").replaceAll("currentColor", color);
      if (!finalValue) continue;
      resolved.set(property, finalValue);
      if (!authored || authored.includes("currentColor")) target.setAttribute(attribute, finalValue);
    }
    const authoredColor = target.getAttribute("color");
    if (!authoredColor || authoredColor.includes("currentColor")) target.setAttribute("color", color);
    resolvedBySource.set(source, resolved);
  }
  return (clone as Element).outerHTML;
}

const INLINE_TEXT_TAGS = new Set([
  "A", "ABBR", "B", "BDI", "BDO", "CITE", "CODE", "DEL", "DFN", "EM", "I", "INS",
  "KBD", "MARK", "Q", "S", "SAMP", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "TIME", "U", "VAR",
]);

function textContent(element: Element): string {
  const collect = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";
    const child = node as Element;
    if (child.tagName.toUpperCase() === "BR") return "\n";
    return Array.from(child.childNodes, collect).join("");
  };
  return collect(element)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
}

export function normalizeRenderedText(value: string, whiteSpace = "normal", whiteSpaceCollapse = "collapse"): string {
  const collapse = String(whiteSpaceCollapse || "collapse").trim().toLowerCase();
  const preservesWhitespace = ["pre", "pre-wrap", "break-spaces"].includes(String(whiteSpace).toLowerCase())
    || ["preserve", "preserve-spaces", "break-spaces"].includes(collapse);
  const preservesBreaks = preservesWhitespace
    || String(whiteSpace).toLowerCase() === "pre-line"
    || collapse === "preserve-breaks";
  // Collapse browser whitespace without trimming the boundaries. Boundary
  // spaces are meaningful when a text run sits next to an inline element,
  // e.g. `Hello <strong>world</strong>`.
  if (preservesWhitespace) {
    return value.replace(/\r\n?/g, "\n");
  }
  if (preservesBreaks) {
    return value
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ");
  }
  return value
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n");
}

function containsOnlyInlineText(element: Element): boolean {
  for (const child of Array.from(element.children)) {
    const tag = child.tagName.toUpperCase();
    if (tag === "BR" || INLINE_TEXT_TAGS.has(tag)) {
      if (!containsOnlyInlineText(child)) return false;
      continue;
    }
    return false;
  }
  return true;
}

const INLINE_TEXT_STYLE_PROPERTIES = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStretch",
  "fontKerning",
  "fontFeatureSettings",
  "fontVariationSettings",
  "fontSynthesis",
  "fontSynthesisWeight",
  "fontSynthesisStyle",
  "fontSynthesisSmallCaps",
  "fontSynthesisPosition",
  "fontVariant",
  "fontVariantAlternates",
  "fontVariantCaps",
  "fontVariantEastAsian",
  "fontVariantLigatures",
  "fontVariantNumeric",
  "fontVariantPosition",
  "fontOpticalSizing",
  "fontSizeAdjust",
  "textRendering",
  "lineHeight",
  "letterSpacing",
  "wordSpacing",
  "color",
  "textTransform",
  "textShadow",
  "fontStyle",
  "textDecorationLine",
  "textDecorationStyle",
  "textDecorationColor",
  "textDecorationThickness",
  "textUnderlineOffset",
  "verticalAlign",
  "whiteSpace",
  "overflowWrap",
  "wordBreak",
  "hyphens",
  "textIndent",
  "direction",
  "writingMode",
  "textOrientation",
  "unicodeBidi",
  "textAlignLast",
  "textJustify",
] as const;

const INLINE_TEXT_VENDOR_STYLE_PROPERTIES = [
  "-webkit-text-fill-color",
  "-webkit-text-stroke-color",
  "-webkit-text-stroke-width",
] as const;

const INLINE_TEXT_LEVEL4_STYLE_PROPERTIES = [
  "text-wrap-mode",
  "white-space-collapse",
  "text-box-trim",
  "text-box-edge",
] as const;

export function hasDistinctInlineTextStyle(element: Element, parentStyle: CSSStyleDeclaration, doc: Document): boolean {
  const readInlineStyle = (style: CSSStyleDeclaration, property: string): string => {
    if (property.startsWith("fontSynthesis") || property === "textAlignLast" || property === "textJustify") {
      const kebab = property.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
      return style.getPropertyValue(kebab);
    }
    return String((style as unknown as Record<string, unknown>)[property] ?? "");
  };
  for (const child of Array.from(element.children)) {
    if (child.tagName.toUpperCase() === "BR") continue;
    const childStyle = doc.defaultView?.getComputedStyle(child);
    if (!childStyle) continue;
    if (INLINE_TEXT_STYLE_PROPERTIES.some((property) => readInlineStyle(childStyle, property) !== readInlineStyle(parentStyle, property))) return true;
    const extendedChildStyle = childStyle as CSSStyleDeclaration & { textWrapStyle?: string };
    const extendedParentStyle = parentStyle as CSSStyleDeclaration & { textWrapStyle?: string };
    if (extendedChildStyle.textWrapStyle !== extendedParentStyle.textWrapStyle) return true;
    if (INLINE_TEXT_LEVEL4_STYLE_PROPERTIES.some((property) => childStyle.getPropertyValue(property) !== parentStyle.getPropertyValue(property))) return true;
    if (INLINE_TEXT_VENDOR_STYLE_PROPERTIES.some((property) => childStyle.getPropertyValue(property) !== parentStyle.getPropertyValue(property))) return true;
    if (hasDistinctInlineTextStyle(child, parentStyle, doc)) return true;
  }
  return false;
}

export function renderedTextContent(element: Element, doc: Document): string {
  let previousTop: number | undefined;
  let value = "";
  const style = doc.defaultView?.getComputedStyle(element);
  const fontSize = numberValue(String(style?.fontSize ?? ""), 16);
  // Different inline runs can have slightly different glyph tops while still
  // sharing one CSS line box (for example regular + bold text or mixed CJK and
  // Latin glyphs). A fixed 0.5px threshold turns that metric noise into real
  // newline characters, which then changes Figma's line count and spacing.
  // Keep the tolerance well below a normal line advance while scaling it with
  // the captured font size.
  const lineTopTolerance = Math.max(1, Math.min(3.25, fontSize * 0.2));
  const appendText = (current: Text): void => {
    const text = current.nodeValue ?? "";
    for (let index = 0; index < text.length; index += 1) {
      const character = text[index];
      const range = doc.createRange();
      range.setStart(current, index);
      range.setEnd(current, index + 1);
      const rect = range.getBoundingClientRect();
      const top = rect.top;
      if (character !== "\n" && previousTop !== undefined && Number.isFinite(top) && Math.abs(top - previousTop) > lineTopTolerance && value && !value.endsWith("\n")) {
        value += "\n";
      }
      value += character;
      if (character !== "\n" && Number.isFinite(top)) previousTop = top;
    }
  };
  const visit = (node: Node): void => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        appendText(child as Text);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      if ((child as Element).tagName.toUpperCase() === "BR") {
        // BR has no text node for TreeWalker to visit. Preserve every break,
        // including consecutive breaks that represent an intentional empty
        // line and therefore affect the captured line-height and box height.
        value += "\n";
        previousTop = undefined;
        continue;
      }
      visit(child);
    }
  }
  visit(element);
  return normalizeRenderedText(value, style?.whiteSpace, style?.getPropertyValue("white-space-collapse"));
}

export function renderedTextNodeContent(textNode: Text, doc: Document): string {
  const text = textNode.nodeValue ?? "";
  let previousTop: number | undefined;
  let value = "";
  const style = textNode.parentElement ? doc.defaultView?.getComputedStyle(textNode.parentElement) : undefined;
  const fontSize = numberValue(String(style?.fontSize ?? ""), 16);
  const lineTopTolerance = Math.max(1, Math.min(3.25, fontSize * 0.2));
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const range = doc.createRange();
    range.setStart(textNode, index);
    range.setEnd(textNode, index + 1);
    const top = range.getBoundingClientRect().top;
    if (character !== "\n" && previousTop !== undefined && Number.isFinite(top) && Math.abs(top - previousTop) > lineTopTolerance && value && !value.endsWith("\n")) {
      value += "\n";
    }
    value += character;
    if (character !== "\n" && Number.isFinite(top)) previousTop = top;
  }
  return normalizeRenderedText(value, style?.whiteSpace, style?.getPropertyValue("white-space-collapse"));
}

function textNodeRect(textNode: Text, parentRect: DOMRect, doc: Document): DesignRect | null {
  const range = doc.createRange();
  range.selectNodeContents(textNode);
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    x: Math.round((rect.left - parentRect.left) * 100) / 100,
    y: Math.round((rect.top - parentRect.top) * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
  };
}

/** Keep anonymous multi-line text boxes tall enough for their CSS line boxes. */
export function textLineBoxRect(rect: DesignRect, lineCount: number, lineHeight: number, anonymous = true): DesignRect {
  if (!anonymous || lineCount <= 1 || !Number.isFinite(lineHeight) || lineHeight <= 0) return rect;
  return { ...rect, height: Math.max(rect.height, lineCount * lineHeight) };
}

/**
 * Promote measured Range line fragments to the anonymous text node metadata.
 * A direct text node can wrap without containing a literal newline, so its
 * content-based line count is otherwise still one when it crosses into H2D.
 */
export function applyMeasuredTextLineRects(textLayer: DesignNode, lineRects: DesignRect[]): void {
  if (textLayer.type !== "text" || !textLayer.text || lineRects.length === 0) return;
  textLayer.textLineRects = lineRects;
  const lineCount = Math.max(1, textLayer.text.lineCount ?? 1, lineRects.length);
  textLayer.text.lineCount = lineCount;
  if (!textLayer.textRect) textLayer.rect = textLineBoxRect(textLayer.rect, lineCount, textLayer.text.lineHeight, true);
}

/**
 * Apply a measured line box to an anonymous text run without retaining the
 * provisional `normal`-leading height used before Range geometry was read.
 * The capture path may initially over-estimate the line count/height and then
 * discover a different browser line box; rebuilding from the original glyph
 * rect avoids carrying that stale synthetic height into Figma.
 */
export function applyMeasuredTextLineHeight(
  textLayer: DesignNode,
  sourceRect: DesignRect | null | undefined,
  lineHeight: number,
): void {
  if (textLayer.type !== "text" || !textLayer.text || !Number.isFinite(lineHeight) || lineHeight <= 0) return;
  const baseRect = sourceRect ?? textLayer.rect;
  const explicitLines = String(textLayer.text.content || "").split(/\r?\n/).length;
  const measuredLines = textLayer.textLineRects?.length ?? 0;
  const geometricLines = baseRect.height > 0 ? Math.max(1, Math.round(baseRect.height / lineHeight)) : 1;
  const lineCount = Math.max(1, explicitLines, measuredLines, geometricLines);
  textLayer.text.lineHeight = lineHeight;
  textLayer.text.lineCount = lineCount;
  if (!textLayer.textRect) textLayer.rect = textLineBoxRect(baseRect, lineCount, lineHeight, true);
}

function textContentRect(element: Element, parentRect: DOMRect | undefined, doc: Document, scaleX = 1, scaleY = 1): DesignRect | null {
  if (!parentRect) return null;
  const range = doc.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    x: Math.round(((rect.left - parentRect.left) / Math.max(0.01, scaleX)) * 100) / 100,
    y: Math.round(((rect.top - parentRect.top) / Math.max(0.01, scaleY)) * 100) / 100,
    width: Math.round((rect.width / Math.max(0.01, scaleX)) * 100) / 100,
    height: Math.round((rect.height / Math.max(0.01, scaleY)) * 100) / 100,
  };
}

function textElementRect(element: Element, doc: Document): DesignRect | null {
  const range = doc.createRange();
  range.selectNodeContents(element);
  const rangeRect = range.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  if (rangeRect.width <= 0 && rangeRect.height <= 0) return null;
  return {
    x: Math.round((rangeRect.left - elementRect.left) * 100) / 100,
    y: Math.round((rangeRect.top - elementRect.top) * 100) / 100,
    width: Math.round(rangeRect.width * 100) / 100,
    height: Math.round(rangeRect.height * 100) / 100,
  };
}

/**
 * Capture the painted width of each visual text line. A single Range union
 * loses line boundaries, which makes a multi-line decoration fallback span
 * the whole text box instead of the actual glyph runs. Range fragments are
 * grouped by their top coordinate so mixed inline styles on one line merge
 * into one decoration segment.
 */
function textLineRectsForTarget(target: Element | Text, doc: Document, reference: DOMRect): DesignRect[] {
  const range = doc.createRange();
  range.selectNodeContents(target);
  const fragments = Array.from(range.getClientRects())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: rect.left - reference.left,
      y: rect.top - reference.top,
      width: rect.width,
      height: rect.height,
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  if (!fragments.length) return [];
  const styleElement = target.nodeType === Node.ELEMENT_NODE ? target as Element : target.parentElement;
  const tolerance = Math.max(1, Math.min(3.25, Number.parseFloat(String(styleElement ? doc.defaultView?.getComputedStyle(styleElement).fontSize : "16") || "16") * 0.2));
  const lines: DesignRect[] = [];
  for (const fragment of fragments) {
    const previous = lines[lines.length - 1];
    if (!previous || Math.abs(fragment.y - previous.y) > tolerance) {
      lines.push({ ...fragment });
      continue;
    }
    const right = Math.max(previous.x + previous.width, fragment.x + fragment.width);
    const bottom = Math.max(previous.y + previous.height, fragment.y + fragment.height);
    previous.x = Math.min(previous.x, fragment.x);
    previous.y = Math.min(previous.y, fragment.y);
    previous.width = right - previous.x;
    previous.height = Math.max(previous.height, bottom - previous.y);
  }
  return lines.map((line) => ({
    x: Math.round(line.x * 100) / 100,
    y: Math.round(line.y * 100) / 100,
    width: Math.round(line.width * 100) / 100,
    height: Math.round(line.height * 100) / 100,
  }));
}

export function textLineRectsForElement(element: Element, doc: Document): DesignRect[] {
  return textLineRectsForTarget(element, doc, element.getBoundingClientRect());
}

export function textLineRectsForTextNode(textNode: Text, doc: Document): DesignRect[] {
  const range = doc.createRange();
  range.selectNodeContents(textNode);
  return textLineRectsForTarget(textNode, doc, range.getBoundingClientRect());
}

/**
 * Inline elements such as <b> and <span> report their containing line box
 * from getBoundingClientRect(). Using that box for separate Figma text layers
 * makes adjacent runs share the same x/y and overlap. Range geometry is the
 * browser's actual glyph placement and keeps mixed-style inline runs apart.
 */
export function inlineTextRect(
  element: Element,
  parentRect: DOMRect | undefined,
  doc: Document,
  parentScaleX = 1,
  parentScaleY = 1,
): DesignRect | null {
  if (!parentRect) return null;
  const style = doc.defaultView?.getComputedStyle(element);
  const parentStyle = element.parentElement ? doc.defaultView?.getComputedStyle(element.parentElement) : undefined;
  const inlineDisplay = style?.display === "inline" || style?.display === "inline-block";
  const parentIsLayout = parentStyle && ["flex", "inline-flex", "grid", "inline-grid"].includes(parentStyle.display);
  if (!inlineDisplay || parentIsLayout) return null;
  const range = doc.createRange();
  range.selectNodeContents(element);
  const rect = range.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return null;
  return {
    x: Math.round(((rect.left - parentRect.left) / Math.max(0.01, parentScaleX)) * 100) / 100,
    y: Math.round(((rect.top - parentRect.top) / Math.max(0.01, parentScaleY)) * 100) / 100,
    width: Math.round((rect.width / Math.max(0.01, parentScaleX)) * 100) / 100,
    height: Math.round((rect.height / Math.max(0.01, parentScaleY)) * 100) / 100,
  };
}

function pseudoContentSize(
  content: string,
  style: CSSStyleDeclaration,
  doc?: Document,
  rootFontSize = 16,
  inheritedStyle?: CSSStyleDeclaration,
  rootLineHeight = rootFontSize * 1.2,
): { width: number; height: number } {
  const textStyle = resolvedGeneratedTextStyle(style, inheritedStyle, rootFontSize, rootLineHeight);
  const { fontSize, lineHeight } = textStyle;
  const lines = content.split(/\r?\n/);
  let width = 0;
  const canvas = doc?.createElement("canvas");
  const canvasContext = canvas?.getContext("2d");
  if (canvasContext) {
    canvasContext.font = `${textStyle.fontStyle} ${textStyle.fontWeight} ${fontSize}px ${textStyle.fontFamily}`;
    width = Math.max(...lines.map((line) => canvasContext.measureText(line).width), 0);
  } else {
    width = Math.max(...lines.map((line) => Array.from(line).length * fontSize * 0.6), 0);
  }
  const padding = numberValue(style.paddingLeft) + numberValue(style.paddingRight);
  const verticalPadding = numberValue(style.paddingTop) + numberValue(style.paddingBottom);
  const border = numberValue(style.borderLeftWidth) + numberValue(style.borderRightWidth);
  const verticalBorder = numberValue(style.borderTopWidth) + numberValue(style.borderBottomWidth);
  return {
    width: width + padding + border,
    height: lines.length * lineHeight + verticalPadding + verticalBorder,
  };
}

function pseudoPosition(
  elementRect: DOMRect,
  style: CSSStyleDeclaration,
  content = "",
  doc?: Document,
  rootFontSize = 16,
  inheritedStyle?: CSSStyleDeclaration,
  rootLineHeight = rootFontSize * 1.2,
): DesignRect {
  const widthValue = numberValue(style.width, 0);
  const heightValue = numberValue(style.height, 0);
  const measuredContent = content ? pseudoContentSize(content, style, doc, rootFontSize, inheritedStyle, rootLineHeight) : { width: 0, height: 0 };
  const horizontalInset = numberValue(style.left) + numberValue(style.right);
  const verticalInset = numberValue(style.top) + numberValue(style.bottom);
  const width = widthValue > 0
    ? widthValue
    : style.left !== "auto" && style.right !== "auto"
      ? Math.max(0, elementRect.width - horizontalInset)
      : measuredContent.width > 0 ? measuredContent.width : Math.max(0, elementRect.width);
  const height = heightValue > 0
    ? heightValue
    : style.top !== "auto" && style.bottom !== "auto"
      ? Math.max(1, elementRect.height - verticalInset)
      : measuredContent.height > 0
        ? measuredContent.height
        : Math.max(1, resolvedGeneratedTextMetrics(style, inheritedStyle, rootFontSize, rootLineHeight).fontSize * 1.2);
  const left = style.left !== "auto" ? numberValue(style.left) : style.right !== "auto" ? elementRect.width - width - numberValue(style.right) : 0;
  const top = style.top !== "auto" ? numberValue(style.top) : style.bottom !== "auto" ? elementRect.height - height - numberValue(style.bottom) : 0;
  // Inline pseudo content without an explicit box uses its parent's content
  // width. The measured parent rect keeps wrapping deterministic in Figma.
  return {
    x: Math.round(left * 100) / 100,
    y: Math.round(top * 100) / 100,
    width: Math.round(width * 100) / 100,
    height: Math.round(height * 100) / 100,
  };
}

/**
 * Find the nearest concrete ancestor line-height for a text capture.
 *
 * Direct text nodes have no Element boundary of their own, so callers pass
 * their containing `styleElement` as the origin. Walking from that element's
 * parent keeps an explicit ancestor leading available when a compatibility
 * bridge leaves `inherit`/`unset` on the containing style instead of the
 * browser's resolved pixel value.
 */
export function inheritedLineHeightFromAncestors(
  origin: Element | undefined,
  getComputedStyle: (element: Element) => Pick<CSSStyleDeclaration, "lineHeight" | "fontSize" | "getPropertyValue">,
): { value?: string; fontSize?: number } {
  let ancestor = origin?.parentElement;
  while (ancestor) {
    const style = getComputedStyle(ancestor);
    const candidate = cssLineHeightValue(style);
    const normalized = candidate.toLowerCase();
    if (candidate && !["inherit", "unset", "revert", "revert-layer"].includes(normalized)) {
      const ancestorFontSize = numberValue(cssStyleValue(style, "fontSize", "font-size"), NaN);
      return {
        value: candidate,
        ...(Number.isFinite(ancestorFontSize) && ancestorFontSize > 0 ? { fontSize: ancestorFontSize } : {}),
      };
    }
    ancestor = ancestor.parentElement;
  }
  return {};
}

export function pseudoContentValue(value: string, element?: Element): string {
  if (!value || value === "none" || value === "normal") return "";
  if (value.startsWith("url(")) return "";
  const resolved = value.replace(/attr\(\s*([\w:-]+)(?:\s*,\s*([^)]*))?\s*\)/gi, (_match, name: string, fallback?: string) => {
    const actual = element?.getAttribute(name);
    if (actual != null) return actual;
    const defaultValue = String(fallback || "").trim();
    return defaultValue.replace(/^['"]|['"]$/g, "");
  });
  return resolved
    .replace(/["']/g, "")
    .replace(/\\A/g, "\n");
}

function textNodeFor(
  context: CaptureContext,
  id: string,
  rect: DesignRect,
  style: CSSStyleDeclaration,
  content: string,
  sourceElement?: Element,
  margin: [number, number, number, number] = [0, 0, 0, 0],
  layout: DesignLayout = emptyLayout(),
  rectOrigin: "element" | "glyph" = "element",
  styleElement?: Element,
): DesignNode {
  const fontWeight = numberValue(style.fontWeight, 400);
  const fontFamily = style.fontFamily.split(",")[0].trim().replace(/["']/g, "") || "Inter";
  const fontSize = numberValue(style.fontSize, 16);
  const fontStyle = style.fontStyle || "normal";
  const fontStretch = style.fontStretch || "100%";
  const textPaint = textPaintFor(style, isTextBackgroundClip(style));
  const sample = content.slice(0, 32);
  const measuredTextRect = sourceElement ? textElementRect(sourceElement, context.document) : undefined;
  const measuredTextLineRects = sourceElement ? textLineRectsForElement(sourceElement, context.document) : undefined;
  // Inline text callers pass the already-measured glyph box as `rect` rather
  // than the containing element's border box. `textElementRect()` is relative
  // to the outer element, so preserve its size but normalize the origin to
  // the glyph node. Block text leaves keep the true glyph inset.
  const textRect = rectOrigin === "glyph" && measuredTextRect
    ? { ...measuredTextRect, x: 0, y: 0 }
    : measuredTextRect;
  // renderedTextContent() preserves browser line transitions (including
  // wrapping that is not present in textContent). Use that normalized value
  // for the captured line count so downstream Figma imports do not re-wrap a
  // measured multi-line box with different font metrics.
  const renderedContent = sourceElement ? renderedTextContent(sourceElement, context.document) || content : content;
  const measuredLineCount = Math.max(1, renderedContent.split(/\r?\n/).length);
  const fontKey = `${fontFamily}|${fontWeight}|${fontStyle}|${fontStretch}|${fontSize}`;
  if (!context.fonts.has(fontKey)) {
    let metrics: DesignFontUsage["metrics"];
    const canvas = context.document.createElement("canvas");
    const canvasContext = canvas.getContext("2d");
    if (canvasContext) {
      canvasContext.font = `${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}"`;
      const measured = canvasContext.measureText(sample || "Hg");
      metrics = {
        fontBoundingBoxAscent: Number.isFinite(measured.fontBoundingBoxAscent) ? measured.fontBoundingBoxAscent : undefined,
        fontBoundingBoxDescent: Number.isFinite(measured.fontBoundingBoxDescent) ? measured.fontBoundingBoxDescent : undefined,
      };
    }
    context.fonts.set(fontKey, { family: fontFamily, weight: fontWeight, style: fontStyle, stretch: fontStretch, size: fontSize, sample, metrics });
    const fontSet = context.document.fonts;
    if (fontSet && typeof fontSet.check === "function" && !fontSet.check(`${fontStyle} ${fontWeight} ${fontSize}px "${fontFamily}"`, sample || "Hg") && !context.fontDiagnostics.has(fontKey)) {
      context.fontDiagnostics.add(fontKey);
      context.diagnostics.push({ code: "font-unavailable", message: `Font may be unavailable in the capture or Figma: ${fontFamily} ${fontWeight}`, nodeId: id });
    }
  }
  // A Range/glyph rectangle is the painted ink box, not the CSS line box.
  // Using its height for `normal` collapses the inherited leading when the
  // scene is rebuilt in Figma. Use the CSS-compatible 1.2em fallback instead;
  // explicit px/unitless line-heights still retain their authored value.
  let inheritedLineHeight: string | undefined;
  let inheritedLineHeightFontSize: number | undefined;
  if ((sourceElement || styleElement) && context.document.defaultView) {
    const inherited = inheritedLineHeightFromAncestors(
      sourceElement ?? styleElement,
      context.document.defaultView.getComputedStyle.bind(context.document.defaultView),
    );
    inheritedLineHeight = inherited.value;
    inheritedLineHeightFontSize = inherited.fontSize;
  }
  const resolvedLineHeightToken = resolveLineHeightCustomProperties(cssLineHeightValue(style), style);
  const lineHeightToken = String(resolvedLineHeightToken || "").trim().toLowerCase();
  const measuredNormalLineHeight = sourceElement
    // `initial` resets line-height to the CSS initial value (`normal`).
    // Treat it like the other browser-dependent keywords so the capture can
    // use the actual measured line box instead of freezing a generic 1.2em
    // fallback before the text reaches Figma.
    && isMeasuredLineHeightKeyword(lineHeightToken)
    ? (() => {
      const tops: number[] = [];
      const walker = context.document.createTreeWalker(sourceElement, NodeFilter.SHOW_TEXT);
      let current: Node | null = walker.nextNode();
      while (current) {
        const textNode = current as Text;
        for (let index = 0; index < textNode.length; index += 1) {
          const range = context.document.createRange();
          range.setStart(textNode, index);
          range.setEnd(textNode, index + 1);
          const rangeRect = range.getBoundingClientRect();
          if (rangeRect.width > 0 && rangeRect.height > 0 && Number.isFinite(rangeRect.top)) tops.push(rangeRect.top);
        }
        current = walker.nextNode();
      }
      return measuredLineHeightFromLineTops(tops, fontSize);
    })()
    : undefined;
  const measuredSingleLineHeight = sourceElement
    && !measuredNormalLineHeight
    && isMeasuredLineHeightKeyword(lineHeightToken)
    ? measuredSingleLineLineHeight(sourceElement, style, fontSize, measuredLineCount, {
      height: authoredStylesheetValue(sourceElement, "height"),
      minHeight: authoredStylesheetValue(sourceElement, "minHeight"),
      maxHeight: authoredStylesheetValue(sourceElement, "maxHeight"),
    })
    : undefined;
  const lineHeight = measuredNormalLineHeight
    ?? measuredSingleLineHeight
    ?? resolvedTextLineHeight(
      resolvedLineHeightToken,
      fontSize,
      context.rootFontSize,
      inheritedLineHeight,
      inheritedLineHeightFontSize,
      inheritedLineHeight
        ? textLineHeight(inheritedLineHeight, inheritedLineHeightFontSize ?? fontSize, context.rootFontSize, context.rootLineHeight, context.rootLineHeight)
        : context.rootLineHeight,
      context.rootLineHeight,
    );
  const lineCount = Math.max(
    measuredLineCount,
    Math.round((measuredTextRect?.height ?? rect.height) / Math.max(1, lineHeight)),
  );
  // A Range over an anonymous text node reports the union of painted glyphs,
  // which can be shorter than the CSS line boxes (especially with generous
  // leading or descenders). Preserve the minimum editable line-box height so
  // the Figma TextNode can actually render the captured spacing instead of
  // clipping the last line inside a glyph-only rectangle. Element-backed text
  // keeps its border/padding box unchanged.
  const capturedRect = textLineBoxRect(rect, lineCount, lineHeight, !sourceElement);
  return {
    id,
    ...(sourceElement ? {} : { sourceTag: "#text" }),
    type: "text",
    rect: capturedRect,
    ...(sourceElement ? { textRect: textRect ?? undefined } : {}),
    ...(measuredTextLineRects && measuredTextLineRects.length > 0 ? {
      textLineRects: measuredTextLineRects.map((line) => rectOrigin === "glyph" && measuredTextRect
        ? { ...line, x: line.x - measuredTextRect.x, y: line.y - measuredTextRect.y }
        : line),
    } : {}),
    opacity: numberValue(style.opacity, 1),
    radius: [0, 0, 0, 0],
    margin,
    layout,
    // With `background-clip: text`, a transparent CSS text color lets the
    // background paint become the glyph fill. Preserve that solid fallback
    // for text-only backgrounds as well as gradient backgrounds with
    // transparent stops.
    fill: colorFromStyle(textPaint.fillColor),
    computedStyles: computedStyleMapWithResolvedMasks(style, context.document, styleElement ?? sourceElement),
    text: {
      content: renderedContent,
      lineCount,
      fontFamily,
      fontSize,
      fontWeight,
      fontSynthesis: capturedFontSynthesisValue(style.fontSynthesis),
      fontSynthesisWeight: style.fontSynthesisWeight,
      fontSynthesisStyle: style.fontSynthesisStyle,
      fontSynthesisSmallCaps: style.fontSynthesisSmallCaps,
      fontSynthesisPosition: style.getPropertyValue("font-synthesis-position") || undefined,
      lineHeight,
      letterSpacing: numberValue(style.letterSpacing),
      wordSpacing: numberValue(style.wordSpacing),
      textAlign: textAlignValue(style),
      textAlignLast: style.getPropertyValue("text-align-last") || undefined,
      textJustify: style.getPropertyValue("text-justify") || undefined,
      textTransform: style.textTransform === "uppercase" || style.textTransform === "lowercase" || style.textTransform === "capitalize" ? style.textTransform : "none",
      fontStyle: style.fontStyle,
      textDecoration: style.textDecorationLine || style.textDecoration,
      textDecorationStyle: style.textDecorationStyle,
      textDecorationColor: style.textDecorationColor && style.textDecorationColor !== style.color && style.textDecorationColor !== "currentcolor" ? style.textDecorationColor : undefined,
      textDecorationThickness: style.textDecorationThickness,
      textUnderlineOffset: style.textUnderlineOffset,
      textOverflow: style.textOverflow,
      maxLines: textMaxLines(style),
      textShadow: style.textShadow !== "none" ? style.textShadow : undefined,
      textStrokeWidth: textPaint.strokeWidth > 0 ? textPaint.strokeWidth : undefined,
      textStrokeColor: textPaint.strokeColor,
      textFillColor: textPaint.textFillColor,
      verticalAlign: style.verticalAlign,
      overflowWrap: style.overflowWrap,
      wordBreak: style.wordBreak,
      hyphens: style.hyphens,
      whiteSpace: style.whiteSpace,
      textIndent: numberValue(style.textIndent),
      direction: style.direction,
      textWrapMode: style.getPropertyValue("text-wrap-mode") || undefined,
      whiteSpaceCollapse: style.getPropertyValue("white-space-collapse") || undefined,
      textBoxTrim: style.getPropertyValue("text-box-trim") || undefined,
      textBoxEdge: style.getPropertyValue("text-box-edge") || undefined,
      },
    children: [],
  };
}

function normalizedSemanticText(value: string | null | undefined): string | undefined {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || undefined;
}

function referencedSemanticText(element: Element, attribute: string, doc: Document): string | undefined {
  const ids = String(element.getAttribute(attribute) ?? "").trim().split(/\s+/).filter(Boolean);
  return normalizedSemanticText(ids.map((id) => doc.getElementById(id)?.textContent ?? "").join(" "));
}

function implicitRoleFor(element: Element): string | undefined {
  const tag = element.tagName.toUpperCase();
  if (tag === "A" && element.hasAttribute("href")) return "link";
  if (tag === "BUTTON") return "button";
  if (/^H[1-6]$/.test(tag)) return "heading";
  if (tag === "IMG") return "img";
  if (tag === "NAV") return "navigation";
  if (tag === "MAIN") return "main";
  if (tag === "ASIDE") return "complementary";
  if (tag === "HEADER") return "banner";
  if (tag === "FOOTER") return "contentinfo";
  if (tag === "UL" || tag === "OL") return "list";
  if (tag === "LI") return "listitem";
  if (tag === "TABLE") return "table";
  if (tag === "TR") return "row";
  if (tag === "TH") return element.getAttribute("scope") === "row" ? "rowheader" : "columnheader";
  if (tag === "TD") return "cell";
  if (tag === "DIALOG") return "dialog";
  if (tag === "SELECT") return element.hasAttribute("multiple") ? "listbox" : "combobox";
  if (tag === "TEXTAREA") return "textbox";
  if (tag === "INPUT") {
    const type = (element.getAttribute("type") || "text").toLowerCase();
    if (type === "hidden") return undefined;
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "number") return "spinbutton";
    if (["button", "submit", "reset", "image"].includes(type)) return "button";
    return "textbox";
  }
  return undefined;
}

export function semanticsFor(element: Element, doc: Document): DesignSemantics | undefined {
  const explicitRole = normalizedSemanticText(element.getAttribute("role"));
  const role = explicitRole && explicitRole !== "presentation" && explicitRole !== "none"
    ? explicitRole
    : implicitRoleFor(element);
  const htmlElement = element as HTMLElement;
  const label = referencedSemanticText(element, "aria-labelledby", doc)
    ?? normalizedSemanticText(element.getAttribute("aria-label"))
    ?? (element instanceof HTMLImageElement ? normalizedSemanticText(element.alt) : undefined)
    ?? (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type)
      ? normalizedSemanticText(element.value)
      : undefined)
    ?? ("labels" in htmlElement && Array.from((htmlElement as HTMLInputElement).labels ?? [])
      .map((candidate) => candidate.textContent ?? "").join(" ")
      ? normalizedSemanticText(Array.from((htmlElement as HTMLInputElement).labels ?? [])
        .map((candidate) => candidate.textContent ?? "").join(" "))
      : undefined)
    ?? (role && ["button", "link", "heading", "tab", "menuitem", "option"].includes(role)
      ? normalizedSemanticText(element.textContent)
      : undefined)
    ?? (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement
      ? normalizedSemanticText(element.getAttribute("placeholder"))
      : undefined)
    ?? normalizedSemanticText(element.getAttribute("title"));
  const description = referencedSemanticText(element, "aria-describedby", doc)
    ?? normalizedSemanticText(element.getAttribute("aria-description"))
    ?? (normalizedSemanticText(element.getAttribute("title")) !== label
      ? normalizedSemanticText(element.getAttribute("title"))
      : undefined);
  const states: Record<string, string> = {};
  for (const attribute of [
    "aria-checked", "aria-current", "aria-disabled", "aria-expanded", "aria-invalid", "aria-pressed",
    "aria-required", "aria-selected", "aria-level", "aria-valuemax", "aria-valuemin", "aria-valuenow",
    "aria-valuetext", "aria-live", "aria-orientation", "aria-haspopup", "aria-controls",
    "aria-activedescendant", "aria-setsize", "aria-posinset", "aria-roledescription",
  ]) {
    const value = normalizedSemanticText(element.getAttribute(attribute));
    if (value) states[attribute.slice(5)] = value;
  }
  if (element instanceof HTMLInputElement) {
    const inputType = String(element.type || "text").toLowerCase();
    // Keep live form values inspectable for editable Figma metadata, but
    // never serialize password contents into the clipboard or plugin data.
    if (inputType !== "password" && !["checkbox", "radio", "file", "color", "button", "submit", "reset", "image"].includes(inputType)) {
      const value = normalizedSemanticText(element.value);
      if (value) states.value = value;
      else {
        const placeholder = normalizedSemanticText(element.getAttribute("placeholder"));
        if (placeholder) states.placeholder = placeholder;
      }
    }
    if (["checkbox", "radio"].includes(inputType)) states.checked = String(element.checked);
    if (element.disabled) states.disabled = "true";
    if (element.required) states.required = "true";
    if (element.readOnly) states.readonly = "true";
  } else if (element instanceof HTMLSelectElement) {
    const value = normalizedSemanticText(element.value);
    if (value) states.value = value;
    if (element.multiple) states.multiple = "true";
    if (element.disabled) states.disabled = "true";
    if (element.required) states.required = "true";
  } else if (element instanceof HTMLTextAreaElement) {
    const value = normalizedSemanticText(element.value);
    if (value) states.value = value;
    else {
      const placeholder = normalizedSemanticText(element.getAttribute("placeholder"));
      if (placeholder) states.placeholder = placeholder;
    }
    if (element.disabled) states.disabled = "true";
    if (element.required) states.required = "true";
  } else if (element instanceof HTMLOptionElement && element.selected) {
    states.selected = "true";
    const value = normalizedSemanticText(element.value);
    if (value) states.value = value;
  }
  if (!role && !label && !description && Object.keys(states).length === 0) return undefined;
  return {
    ...(role ? { role } : {}),
    ...(label ? { label } : {}),
    ...(description ? { description } : {}),
    ...(Object.keys(states).length ? { states } : {}),
  };
}

function createNode(element: Element, context: CaptureContext, parentRect?: DOMRect, parentScaleX = 1, parentScaleY = 1): DesignNode | null {
  const tag = element.tagName.toUpperCase();
  if (IGNORED_TAGS.has(tag)) return null;
  const style = context.document.defaultView?.getComputedStyle(element);
  if (!style || !isLayoutCapturable(style)) return null;
  const displayContents = isDisplayContents(style);
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0 && !textContent(element)) return null;
  const id = makeId(context, element);
  const positioning = positioningValue(style);
  const fixedContainingBlock = positioning === "fixed"
    ? fixedContainingBlockFor(element, context.document)
    : null;
  const fixedContainingBlockRect = fixedContainingBlock?.getBoundingClientRect();
  const fixedScope: DesignNode["fixedScope"] = positioning === "fixed" && fixedContainingBlock
    ? "ancestor"
    : positioning === "fixed"
      ? "viewport"
      : undefined;
  const normalizedRect = rectFor(
    element,
    positioning === "fixed"
      ? (fixedContainingBlock ? parentRect : undefined)
      : parentRect,
    positioning === "fixed" && !fixedContainingBlockRect ? 1 : parentScaleX,
    positioning === "fixed" && !fixedContainingBlockRect ? 1 : parentScaleY,
  );
  if (fixedContainingBlock && fixedContainingBlockRect) {
    context.diagnostics.push({
      code: "fixed-containing-block",
      message: "Fixed-position content is anchored to a transformed/contained ancestor rather than the viewport",
      nodeId: id,
    });
  }
  // `background-clip: text` uses the gradient as the glyph fill. Converting
  // it to a full-box SVG fallback would paint a rectangle behind the text and
  // prevent the downstream importer from keeping an editable TEXT layer.
  const captureDevicePixelRatio = context.document.defaultView?.devicePixelRatio ?? 1;
  const captureCurrentColor = String(style.color || "rgb(0, 0, 0)");
  const captureBackgroundImage = normalizeImageSetForDevicePixelRatio(
    resolveCurrentColor(style.backgroundImage, captureCurrentColor),
    captureDevicePixelRatio,
  );
  const captureBackgroundColor = resolveCurrentColor(style.backgroundColor, captureCurrentColor);
  const backgroundFallback = shouldUseBackgroundSvgFallback(style)
    ? backgroundSvgDataUrl(captureBackgroundImage, captureBackgroundColor, normalizedRect.width, normalizedRect.height)
    : undefined;
  const backgroundAssetId = backgroundFallback
    ? addAsset(context, "svg", backgroundFallback, backgroundFallback)
    : undefined;
  if (backgroundAssetId) {
    context.diagnostics.push({ code: "background-svg-fallback", message: "Complex CSS background layers were preserved as an inline SVG asset for Figma", nodeId: id });
  }
  recordUnsupportedStyles(context, style, id, tag === "IMG", element);
  const autoLayoutHint = element.getAttribute("data-figma-auto-layout");
  const capturedAttributes = [
    "role", "aria-label", "aria-labelledby", "aria-describedby", "aria-description",
    "aria-checked", "aria-current", "aria-disabled", "aria-expanded", "aria-invalid",
    "aria-pressed", "aria-required", "aria-selected", "aria-level", "aria-valuemax",
    "aria-valuemin", "aria-valuenow", "aria-valuetext", "aria-live", "aria-orientation",
    "aria-haspopup", "aria-controls", "aria-activedescendant", "aria-setsize", "aria-posinset",
    "aria-roledescription", "alt", "title", "href", "type",
    "name", "placeholder", "value", "scope", "for", "data-figma-name",
  ].reduce<Record<string, string>>((result, attribute) => {
    // A password input can expose its initial value as an HTML attribute
    // even though the rendered control only paints bullets. Keep the visual
    // masking guarantee across the compatibility payload as well.
    if (attribute === "value" && tag === "INPUT" && String(element.getAttribute("type") || "text").toLowerCase() === "password") return result;
    const value = element.getAttribute(attribute);
    if (value != null && value !== "") result[attribute] = value;
    return result;
  }, {});
  if (autoLayoutHint === "horizontal" || autoLayoutHint === "vertical") capturedAttributes["data-figma-auto-layout"] = autoLayoutHint;
  const attributes = Object.keys(capturedAttributes).length ? capturedAttributes : undefined;
  const computedStyles = computedStyleMapWithResolvedMasks(style, context.document, element);
  // A sticky declaration with no active inset is CSS-relative flow, not a
  // scroll-linked layer. Normalize the replay style too so H2D consumers do
  // not reintroduce `position: sticky` after the shared scene was corrected.
  if (positioning === "relative" && String(computedStyles.position || "").trim().toLowerCase() === "sticky") {
    computedStyles.position = "relative";
  }
  const common = {
    id,
    sourceTag: tag,
    ...(displayContents ? { displayContents: true } : {}),
    semantics: semanticsFor(element, context.document),
    rect: normalizedRect,
    opacity: numberValue(style.opacity, 1),
    fill: colorFromStyle(captureBackgroundColor),
    gradient: captureBackgroundImage !== "none" && captureBackgroundImage.includes("gradient") ? captureBackgroundImage : undefined,
    backgroundImage: style.backgroundImage !== "none"
      ? resolveCssImageUrls(
        captureBackgroundImage,
        context.document,
      )
      : undefined,
    backgroundAssetId,
    stroke: borderFor(style, "Top", normalizedRect, captureDevicePixelRatio, captureCurrentColor),
    outline: outlineFor(style),
    outlineOffset: numberValue(style.outlineOffset),
    borders: [
      borderFor(style, "Top", normalizedRect, captureDevicePixelRatio, captureCurrentColor),
      borderFor(style, "Right", normalizedRect, captureDevicePixelRatio, captureCurrentColor),
      borderFor(style, "Bottom", normalizedRect, captureDevicePixelRatio, captureCurrentColor),
      borderFor(style, "Left", normalizedRect, captureDevicePixelRatio, captureCurrentColor),
    ] as DesignNode["borders"],
    shadow: shadowFromStyle(style.boxShadow, style.color),
    shadows: shadowsFromStyle(style.boxShadow, style.color),
    shadowCss: style.boxShadow !== "none" ? style.boxShadow : undefined,
    backgroundSize: style.backgroundSize !== "auto" ? style.backgroundSize : undefined,
    backgroundPosition: style.backgroundPosition !== "0% 0%" ? style.backgroundPosition : undefined,
    backgroundRepeat: style.backgroundRepeat !== "repeat" ? style.backgroundRepeat : undefined,
    backgroundAttachment: hasNonDefaultBackgroundAttachment(style.backgroundAttachment) ? style.backgroundAttachment : undefined,
    transform: effectiveTransform(style) !== "none" ? effectiveTransform(style) : undefined,
    transformOrigin: transformOriginFor(style),
    zIndex: Number.isFinite(Number.parseInt(style.zIndex, 10)) ? Number.parseInt(style.zIndex, 10) : undefined,
    geometryIncludesTransform: effectiveTransform(style) !== "none",
    positioning,
    fixedScope,
    ...(fixedContainingBlock ? { fixedContainingBlockId: makeId(context, fixedContainingBlock) } : {}),
    ...(fixedContainingBlockRect ? {
      fixedOffset: {
        x: Math.round((rect.left - fixedContainingBlockRect.left) * 100) / 100,
        y: Math.round((rect.top - fixedContainingBlockRect.top) * 100) / 100,
      },
    } : {}),
    ...(positioning === "relative" ? (() => {
      const parentRect = element.parentElement?.getBoundingClientRect();
      const viewportRect = !parentRect && context.document.defaultView
        ? { width: context.document.defaultView.innerWidth, height: context.document.defaultView.innerHeight }
        : parentRect;
      const parentStyle = element.parentElement && context.document.defaultView
        ? context.document.defaultView.getComputedStyle(element.parentElement)
        : undefined;
      const rootStyle = context.document.defaultView?.getComputedStyle(context.document.documentElement);
      const containingBlock = parentStyle
        ? relativePositionContainingBlockSize(parentRect, parentStyle)
        : { width: viewportRect?.width, height: viewportRect?.height };
      const references = {
        width: containingBlock.width,
        height: containingBlock.height,
        fontSize: numberValue(style.fontSize, 16),
        rootFontSize: numberValue(rootStyle?.fontSize || "", context.rootFontSize),
        viewportWidth: context.document.defaultView?.innerWidth,
        viewportHeight: context.document.defaultView?.innerHeight,
      };
      return {
        positionOffset: relativePositionOffset(style, references),
        positionOffsetExpression: relativePositionExpressions(style, element),
      };
    })() : {}),
    objectFit: style.objectFit !== "fill" ? style.objectFit : undefined,
    objectPosition: style.objectPosition !== "50% 50%" ? style.objectPosition : undefined,
    objectViewBox: style.getPropertyValue("object-view-box") !== "none"
      ? style.getPropertyValue("object-view-box") || undefined
      : undefined,
    overflow: style.overflow !== "visible" ? style.overflow : undefined,
    filter: style.filter !== "none" ? style.filter : undefined,
    backdropFilter: style.backdropFilter !== "none" ? style.backdropFilter : undefined,
    computedStyles,
    sizingConstraints: sizingConstraintsFor(style, element),
    attributes,
    radius: radiusFor(style, normalizedRect.width, normalizedRect.height),
    margin: parseMargin(style, element),
    layout: layoutFor(style, {
      element,
      rect,
      parentStyle: element.parentElement ? context.document.defaultView?.getComputedStyle(element.parentElement) : undefined,
      viewportWidth: context.document.defaultView?.innerWidth,
      viewportHeight: context.document.defaultView?.innerHeight,
    }),
    children: [] as DesignNode[],
  };
  // Border-image URL sources are independent paints from the element's fill.
  // Register them against the shared asset table so the plugin can construct
  // an image-backed nine-slice/vector fallback instead of silently using the
  // computed border color.
  registerBorderImageAssets(context, common.borders, id);
  if (tableCellNeedsGeometryLock(element)) common.layout = { ...common.layout, geometryLock: true };
  if (hasMultiColumnLayout(style)) common.layout = { ...common.layout, geometryLock: true };

  if (element instanceof HTMLImageElement || tag === "IMG") {
    const source = imageSource(element as HTMLImageElement);
    const resolvedSource = source ? resolveResourceUrl(source.src, context.document) : "";
    const assetId = source ? addAsset(context, "image", resolvedSource, source.data ?? context.imageData.get(resolvedSource)) : undefined;
    if (!assetId) context.diagnostics.push({ code: "image-missing-src", message: "Image has no readable source", nodeId: id });
    else if (source && !source.data && !source.src.startsWith("data:")) {
      context.diagnostics.push({ code: "image-external", message: "Image is referenced by URL and may require network access in Figma", nodeId: id });
    }
    return { ...common, type: "image", assetId };
  }

  if (tag === "SVG") {
    const svg = inlineSvgStyles(element, context.document);
    const assetId = addAsset(context, "svg", `inline:${id}`, svg);
    return { ...common, type: "vector", assetId, svg };
  }

  const isFormControl = ["INPUT", "TEXTAREA", "SELECT"].includes(tag);
  const childElements = formControlChildElements(element)
    .filter((child) => !IGNORED_TAGS.has(child.tagName.toUpperCase()));
  const controlText = formControlTextValue(element);
  // For native controls, the live value is separate from DOM textContent
  // (notably for textarea/select), so prefer the painted value/placeholder.
  const content = isFormControl ? (controlText?.text || "") : textContent(element);
  const clipsBackgroundToText = isTextBackgroundClip(style);
  const hasVisualTextContainer = tag === "BUTTON"
    || hasTextBoxInsets(style)
    || Boolean((common.fill && !clipsBackgroundToText) || (common.gradient && !clipsBackgroundToText) || common.stroke || common.outline || common.shadow || common.radius.some((value) => value > 0));
  const isTextLeaf = Boolean(content)
    && !isFormControl
    && !hasVisualTextContainer
    && (childElements.length === 0
      || (style.display !== "flex"
        && style.display !== "inline-flex"
        && style.display !== "grid"
        && containsOnlyInlineText(element)
        && !hasDistinctInlineTextStyle(element, style, context.document)));
  if (isTextLeaf) {
    const inlineRect = displayContents
      ? textContentRect(element, parentRect, context.document, parentScaleX, parentScaleY)
      : inlineTextRect(element, parentRect, context.document, parentScaleX, parentScaleY);
    // Preserve the browser's visual line transitions for every text leaf,
    // not only `display: contents` wrappers. A plain `<p>`/`<div>` with
    // wrapped text otherwise crosses the H2D boundary as one unbroken string;
    // Figma then re-wraps it with different font metrics and can effectively
    // lose the inherited line-height while rebuilding the editable TextNode.
    const renderedContent = renderedTextContent(element, context.document) || content;
    return {
      ...common,
      ...textNodeFor(
        context,
        id,
        inlineRect || common.rect,
        style,
        renderedContent,
        displayContents ? undefined : element,
        common.margin,
        common.layout,
        inlineRect ? "glyph" : "element",
        element,
      ),
      type: "text",
      ...(displayContents ? { displayContents: true } : {}),
      ...(displayContents && common.semantics ? {
        structuralSemantics: [common.semantics],
        structuralSemanticOwners: [id],
      } : {}),
    };
  }

  let directTextSequence = 0;
  const childScale = axisTransformScale(style, element);
  const hasInlineChildren = childElements.some((child) => INLINE_TEXT_TAGS.has(child.tagName.toUpperCase()));
  const preservesInlineWhitespace = hasInlineChildren
    && !["flex", "inline-flex", "grid", "inline-grid"].includes(style.display);
  const appendElementChild = (childElement: Element): void => {
    const node = createNode(childElement, context, displayContents && parentRect ? parentRect : rect, childScale.x, childScale.y);
    if (!node) return;
    if (!node.displayContents) {
      common.children.push(node);
      return;
    }
    // Flatten the transparent wrapper while retaining its generated content.
    const structuralSemantics = [
      ...(node.structuralSemantics ?? []),
      ...(node.semantics ? [node.semantics] : []),
    ];
    const structuralSemanticOwners = [
      ...(node.structuralSemanticOwners ?? []),
      ...(node.semantics ? [node.id] : []),
    ];
    if (node.type === "text") {
      common.children.push(addStructuralSemantics(node, structuralSemantics, structuralSemanticOwners));
      return;
    }
    const inheritedOpacity = Number.isFinite(node.opacity) ? node.opacity : 1;
    for (const child of node.children) {
      const flattenedChild = addStructuralSemantics(child, structuralSemantics, structuralSemanticOwners);
      if (inheritedOpacity !== 1) flattenedChild.opacity *= inheritedOpacity;
      common.children.push(flattenedChild);
    }
  };
  const appendBreakToLastText = (nodes: DesignNode[]): boolean => {
    for (let index = nodes.length - 1; index >= 0; index -= 1) {
      const candidate = nodes[index];
      if (candidate.type === "text" && candidate.text) {
        candidate.text.content = `${candidate.text.content}\n`;
        candidate.text.lineCount = Math.max(
          Number(candidate.text.lineCount || 1),
          candidate.text.content.split(/\r?\n/).length,
        );
        return true;
      }
      if (candidate.children.length && appendBreakToLastText(candidate.children)) return true;
    }
    return false;
  };
  let pendingBreaks = "";
  // Native controls paint their internal option/text content themselves.
  // Traversing a <select>'s implementation children would duplicate the
  // selected label beside the control's editable value layer.
  const sourceChildNodes = isFormControl ? [] : Array.from(element.childNodes);
  for (const child of sourceChildNodes) {
    if (child.nodeType === Node.ELEMENT_NODE && (child as Element).tagName.toUpperCase() === "BR") {
      // BR has no editable text node of its own. Attach the break to the
      // preceding text run when possible; otherwise carry it to the next run
      // so leading/consecutive breaks are not dropped from painted containers.
      if (!appendBreakToLastText(common.children)) pendingBreaks += "\n";
      continue;
    }
    if (child.nodeType === Node.TEXT_NODE) {
      const textNode = child as Text;
      const text = `${pendingBreaks}${renderedTextNodeContent(textNode, context.document)}`;
      pendingBreaks = "";
      const textRect = text ? textNodeRect(textNode, displayContents && parentRect ? parentRect : rect, context.document) : null;
      const normalizedTextRect = textRect
        ? {
          x: textRect.x / childScale.x,
          y: textRect.y / childScale.y,
          width: textRect.width / childScale.x,
          height: textRect.height / childScale.y,
        }
        : null;
      const isWhitespaceRun = Boolean(text) && !/\S/.test(text) && !text.includes("\n");
      if (normalizedTextRect && (/\S/.test(text) || (preservesInlineWhitespace && isWhitespaceRun && normalizedTextRect.width > 0.01))) {
        const textLayer = textNodeFor(
          context,
          `${id}-text-${directTextSequence++}`,
          normalizedTextRect,
          style,
          text,
          undefined,
          common.margin,
          common.layout,
          "element",
          element,
        );
        const directTextLineRects = textLineRectsForTextNode(textNode, context.document);
        applyMeasuredTextLineRects(textLayer, directTextLineRects);
        const lineHeightToken = cssLineHeightValue(style).toLowerCase();
        if (isMeasuredLineHeightKeyword(lineHeightToken) && textLayer.text) {
          const measuredLineHeight = measuredLineHeightFromTextNode(textNode, context.document, textLayer.text.fontSize)
            ?? (textLayer.text.lineCount === 1 && element.childElementCount === 0
              ? measuredSingleLineLineHeight(element, style, textLayer.text.fontSize, 1, {
                height: authoredStylesheetValue(element, "height"),
                minHeight: authoredStylesheetValue(element, "minHeight"),
                maxHeight: authoredStylesheetValue(element, "maxHeight"),
              })
              : undefined);
          if (measuredLineHeight) applyMeasuredTextLineHeight(textLayer, normalizedTextRect, measuredLineHeight);
        }
        // A direct text node can begin on an indented first line when an
        // earlier inline sibling occupies the first line. Its union Range
        // rect starts at the leftmost later line, so preserve the measured
        // first-line offset as Figma's paragraph indent. Do not replace an
        // authored CSS text-indent; that declaration is already authoritative.
        if (textLayer.text
          && textLayer.text.textAlign === "left"
          && !String(textLayer.text.direction || "ltr").toLowerCase().startsWith("rtl")
          && Math.abs(textLayer.text.textIndent ?? 0) < 0.01) {
          const measuredIndent = measuredTextIndentFromTextNode(textNode, context.document, textLayer.text.fontSize * 0.2);
          if (measuredIndent !== undefined) textLayer.text.textIndent = measuredIndent;
        }
        // The container owns CSS opacity. A raw text run is inherited content,
        // so carrying the same value on both layers would make H2D/Figma
        // multiply it and render the text too faint.
        textLayer.opacity = 1;
        common.children.push(textLayer);
      }
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    appendElementChild(child as Element);
  }
  if (isFormControl && controlText) {
    const controlTextRect = formControlTextRect(rect, style, tag === "TEXTAREA", context.rootFontSize, context.rootLineHeight);
    const textLayer = textNodeFor(
      context,
      `${id}-control-text`,
      controlTextRect,
      style,
      controlText.text,
      undefined,
      common.margin,
      common.layout,
      "element",
      element,
    );
    textLayer.opacity = 1;
    if (controlText.placeholder) {
      const placeholderStyle = context.document.defaultView?.getComputedStyle(element, "::placeholder");
      if (placeholderStyle?.color) textLayer.fill = colorFromStyle(placeholderStyle.color) ?? textLayer.fill;
    }
    common.children.push(textLayer);
  }
  if (tag === "LI") {
    const markerStyle = context.document.defaultView?.getComputedStyle(element, "::marker") ?? style;
    const siblings = element.parentElement
      ? Array.from(element.parentElement.children).filter((candidate) => candidate.tagName.toUpperCase() === "LI")
      : [];
    const ordinal = listItemOrdinal(element, siblings);
    const markerText = listMarkerText(markerStyle, ordinal);
    const markerImageSource = markerText ? null : listMarkerImageSource(markerStyle);
    if (markerText || markerImageSource) {
      const markerTextStyle = resolvedGeneratedTextStyle(markerStyle, style, context.rootFontSize, context.rootLineHeight);
      const markerFontSize = markerTextStyle.fontSize;
      const markerLineHeight = markerTextStyle.lineHeight;
      const canvas = context.document.createElement("canvas");
      const canvasContext = canvas.getContext("2d");
      if (canvasContext) canvasContext.font = `${markerTextStyle.fontStyle} ${markerTextStyle.fontWeight} ${markerFontSize}px ${markerTextStyle.fontFamily}`;
      const markerWidth = markerImageSource
        ? Math.max(4, numberValue(markerStyle.width, markerFontSize))
        : Math.max(4, canvasContext?.measureText(markerText || "").width ?? (markerText || "").length * markerFontSize * 0.6);
      const elementRect = element.getBoundingClientRect();
      const range = context.document.createRange();
      range.selectNodeContents(element);
      const contentRect = range.getBoundingClientRect();
      const contentOffset = Number.isFinite(contentRect.left - elementRect.left) ? contentRect.left - elementRect.left : markerWidth + 4;
      const markerInside = String(markerStyle.listStylePosition || "outside").trim().toLowerCase() === "inside";
      const markerRect: DesignRect = {
        x: markerInside ? 0 : Math.min(0, (contentOffset - markerWidth - 4) / Math.max(0.01, childScale.x)),
        y: 0,
        width: markerWidth / Math.max(0.01, childScale.x),
        height: markerLineHeight / Math.max(0.01, childScale.y),
      };
      const markerNode: DesignNode = markerImageSource
        ? {
          id: `${id}-marker`,
          sourceTag: "IMG",
          type: "image",
          rect: markerRect,
          opacity: 1,
          radius: [0, 0, 0, 0],
          margin: [0, 0, 0, 0],
          layout: { ...emptyLayout(), position: "absolute", geometryLock: true },
          attributes: { "data-open-canvas-marker": "true", src: resolveResourceUrl(markerImageSource, context.document) },
          assetId: addAsset(context, "image", resolveResourceUrl(markerImageSource, context.document), context.imageData.get(resolveResourceUrl(markerImageSource, context.document))),
          children: [],
        }
        : textNodeFor(context, `${id}-marker`, markerRect, markerStyle, markerText!);
      if (!markerImageSource) {
        // Use a normal H2D-compatible element tag; the pseudo marker identity
        // remains inspectable without emitting an invalid `::MARKER` tag.
        markerNode.sourceTag = "SPAN";
        markerNode.attributes = { "data-open-canvas-marker": "true" };
        if (markerNode.text) {
          markerNode.text.fontFamily = markerTextStyle.fontFamily.split(",")[0].trim().replace(/["']/g, "") || "Inter";
          markerNode.text.fontSize = markerTextStyle.fontSize;
          markerNode.text.fontWeight = numberValue(markerTextStyle.fontWeight, numberValue(style.fontWeight, 400));
          markerNode.text.fontStyle = markerTextStyle.fontStyle;
          markerNode.text.lineHeight = markerTextStyle.lineHeight;
          markerNode.text.letterSpacing = markerTextStyle.letterSpacing;
          markerNode.text.wordSpacing = markerTextStyle.wordSpacing;
        }
      }
      markerNode.positioning = "absolute";
      markerNode.positionOffset = { left: markerRect.x, top: markerRect.y };
      markerNode.layout = { ...emptyLayout(), position: "absolute", geometryLock: true };
      markerNode.opacity = 1;
      common.children.unshift(markerNode);
    }
  }
  for (const pseudo of ["::before", "::after"] as const) {
    const pseudoStyle = context.document.defaultView?.getComputedStyle(element, pseudo);
    if (!pseudoStyle) continue;
    const pseudoTextStyle = resolvedGeneratedTextStyle(pseudoStyle, style, context.rootFontSize, context.rootLineHeight);
    const pseudoContent = pseudoContentValue(pseudoStyle.content, element);
    const pseudoRect = pseudoPosition(
      displayContents && parentRect ? parentRect : rect,
      pseudoStyle,
      pseudoContent,
      context.document,
      context.rootFontSize,
      style,
      context.rootLineHeight,
    );
    const pseudoHasVisualBox = pseudoStyle.width !== "auto"
      || pseudoStyle.height !== "auto"
      || pseudoStyle.backgroundColor !== "rgba(0, 0, 0, 0)"
      || pseudoStyle.backgroundImage !== "none"
      || pseudoStyle.borderTopWidth !== "0px"
      || pseudoStyle.boxShadow !== "none";
    if (!pseudoContent && !pseudoHasVisualBox) continue;
    const pseudoId = `${id}-${pseudo.slice(2)}`;
    recordUnsupportedStyles(context, pseudoStyle, pseudoId, false);
    const pseudoTextPaint = textPaintFor(pseudoStyle, isTextBackgroundClip(pseudoStyle));
    const pseudoCurrentColor = String(pseudoStyle.color || style.color || "rgb(0, 0, 0)");
    const pseudoBackgroundImage = normalizeImageSetForDevicePixelRatio(
      resolveCurrentColor(pseudoStyle.backgroundImage, pseudoCurrentColor),
      context.document.defaultView?.devicePixelRatio ?? 1,
    );
    const pseudoBackgroundColor = resolveCurrentColor(pseudoStyle.backgroundColor, pseudoCurrentColor);
    const pseudoBorders = [
      borderFor(pseudoStyle, "Top", pseudoRect, context.document.defaultView?.devicePixelRatio ?? 1, pseudoCurrentColor),
      borderFor(pseudoStyle, "Right", pseudoRect, context.document.defaultView?.devicePixelRatio ?? 1, pseudoCurrentColor),
      borderFor(pseudoStyle, "Bottom", pseudoRect, context.document.defaultView?.devicePixelRatio ?? 1, pseudoCurrentColor),
      borderFor(pseudoStyle, "Left", pseudoRect, context.document.defaultView?.devicePixelRatio ?? 1, pseudoCurrentColor),
    ] as NonNullable<DesignNode["borders"]>;
    registerBorderImageAssets(context, pseudoBorders, pseudoId);
    const pseudoCommon = {
      id: pseudoId,
      pseudo: pseudo.slice(2) as "before" | "after",
      rect: pseudoRect,
      opacity: numberValue(pseudoStyle.opacity, 1),
      fill: colorFromStyle(pseudoBackgroundColor),
      gradient: pseudoBackgroundImage !== "none" && pseudoBackgroundImage.includes("gradient") ? pseudoBackgroundImage : undefined,
      backgroundImage: pseudoBackgroundImage !== "none"
        ? resolveCssImageUrls(
          pseudoBackgroundImage,
          context.document,
        )
        : undefined,
      stroke: pseudoBorders[0],
      borders: pseudoBorders,
      shadow: shadowFromStyle(pseudoStyle.boxShadow, pseudoStyle.color),
      shadows: shadowsFromStyle(pseudoStyle.boxShadow, pseudoStyle.color),
      shadowCss: pseudoStyle.boxShadow !== "none" ? pseudoStyle.boxShadow : undefined,
      backgroundSize: pseudoStyle.backgroundSize !== "auto" ? pseudoStyle.backgroundSize : undefined,
      backgroundPosition: pseudoStyle.backgroundPosition !== "0% 0%" ? pseudoStyle.backgroundPosition : undefined,
      backgroundRepeat: pseudoStyle.backgroundRepeat !== "repeat" ? pseudoStyle.backgroundRepeat : undefined,
      backgroundAttachment: hasNonDefaultBackgroundAttachment(pseudoStyle.backgroundAttachment) ? pseudoStyle.backgroundAttachment : undefined,
      transform: effectiveTransform(pseudoStyle) !== "none" ? effectiveTransform(pseudoStyle) : undefined,
      transformOrigin: transformOriginFor(pseudoStyle),
      zIndex: Number.isFinite(Number.parseInt(pseudoStyle.zIndex, 10)) ? Number.parseInt(pseudoStyle.zIndex, 10) : undefined,
      geometryIncludesTransform: effectiveTransform(pseudoStyle) !== "none",
      positioning: positioningValue(pseudoStyle),
      positionOffset: positioningValue(pseudoStyle) === "relative"
        && (pseudoStyle.left !== "auto" || pseudoStyle.top !== "auto")
        ? { left: numberValue(pseudoStyle.left), top: numberValue(pseudoStyle.top) }
        : undefined,
      computedStyles: (() => {
        const pseudoComputedStyles = computedStyleMapWithResolvedMasks(pseudoStyle, context.document);
        if (positioningValue(pseudoStyle) === "relative" && String(pseudoComputedStyles.position || "").trim().toLowerCase() === "sticky") {
          pseudoComputedStyles.position = "relative";
        }
        return pseudoComputedStyles;
      })(),
      outline: outlineFor(pseudoStyle),
      outlineOffset: numberValue(pseudoStyle.outlineOffset),
      radius: radiusFor(pseudoStyle, pseudoRect.width, pseudoRect.height),
      margin: [0, 0, 0, 0] as [number, number, number, number],
      layout: layoutFor(pseudoStyle),
      children: [] as DesignNode[],
    };
    if (pseudoContent) {
      const pseudoText = {
        ...pseudoCommon,
        id: `${pseudoId}-text`,
        // The generated-content role belongs to the pseudo wrapper. When a
        // painted pseudo has an editable text child, that child must remain a
        // normal child of the pseudo node rather than becoming a nested
        // pseudoElementNodes entry.
        pseudo: pseudoHasVisualBox ? undefined : pseudoCommon.pseudo,
        rect: {
          x: 0,
          y: 0,
          width: pseudoRect.width,
          height: pseudoRect.height,
        },
        type: "text" as const,
        // The pseudo Frame owns CSS opacity; applying it again to the text
        // child would multiply the value in Figma.
        opacity: 1,
        fill: colorFromStyle(pseudoTextPaint.fillColor),
        text: {
          content: pseudoContent,
          lineCount: Math.max(1, pseudoContent.split(/\r?\n/).length),
          fontFamily: pseudoTextStyle.fontFamily.split(",")[0].trim().replace(/["']/g, "") || "Inter",
          fontSize: pseudoTextStyle.fontSize,
          fontWeight: numberValue(pseudoTextStyle.fontWeight, 400),
          lineHeight: pseudoTextStyle.lineHeight,
          letterSpacing: pseudoTextStyle.letterSpacing,
          wordSpacing: pseudoTextStyle.wordSpacing,
          textAlign: textAlignValue(pseudoStyle),
          textAlignLast: pseudoStyle.getPropertyValue("text-align-last") || undefined,
          textJustify: pseudoStyle.getPropertyValue("text-justify") || undefined,
          fontStyle: pseudoStyle.fontStyle,
          textDecoration: pseudoStyle.textDecorationLine || pseudoStyle.textDecoration,
          textDecorationStyle: pseudoStyle.textDecorationStyle,
          textDecorationColor: pseudoStyle.textDecorationColor && pseudoStyle.textDecorationColor !== pseudoStyle.color && pseudoStyle.textDecorationColor !== "currentcolor" ? pseudoStyle.textDecorationColor : undefined,
          textDecorationThickness: pseudoStyle.textDecorationThickness,
          textUnderlineOffset: pseudoStyle.textUnderlineOffset,
          textOverflow: pseudoStyle.textOverflow,
          maxLines: textMaxLines(pseudoStyle),
          textShadow: pseudoStyle.textShadow !== "none" ? pseudoStyle.textShadow : undefined,
          textStrokeWidth: pseudoTextPaint.strokeWidth || undefined,
          textStrokeColor: pseudoTextPaint.strokeColor,
          textFillColor: pseudoTextPaint.textFillColor,
          verticalAlign: pseudoStyle.verticalAlign,
          overflowWrap: pseudoStyle.overflowWrap,
          wordBreak: pseudoStyle.wordBreak,
          hyphens: pseudoStyle.hyphens,
          whiteSpace: pseudoStyle.whiteSpace,
          textIndent: numberValue(pseudoStyle.textIndent),
          direction: pseudoStyle.direction,
          textWrapMode: pseudoStyle.getPropertyValue("text-wrap-mode") || undefined,
          whiteSpaceCollapse: pseudoStyle.getPropertyValue("white-space-collapse") || undefined,
          textBoxTrim: pseudoStyle.getPropertyValue("text-box-trim") || undefined,
          textBoxEdge: pseudoStyle.getPropertyValue("text-box-edge") || undefined,
        } satisfies DesignTextStyle,
      };
      // A pseudo-element with a painted box is a real layer plus a text run.
      // Keeping the text as a child preserves the box fill/stroke/radius while
      // still allowing the generated glyph to remain editable in Figma.
      common.children.push(pseudoHasVisualBox
        ? { ...pseudoCommon, type: "frame" as const, children: [pseudoText] }
        : pseudoText);
    } else {
      common.children.push({ ...pseudoCommon, type: "frame" });
    }
  }
  // Pseudo-elements participate in the source stacking order. They are
  // collected after real children above so their computed styles are easy to
  // read, then placed back into the browser order before returning the node.
  const beforeChildren = common.children.filter((child) => child.id === `${id}-before`);
  const afterChildren = common.children.filter((child) => child.id === `${id}-after`);
  if (beforeChildren.length || afterChildren.length) {
    const pseudoIds = new Set([...beforeChildren, ...afterChildren].map((child) => child.id));
    const regularChildren = common.children.filter((child) => !pseudoIds.has(child.id));
    common.children = [...beforeChildren, ...regularChildren, ...afterChildren];
  }
  if (tag === "TABLE") {
    const captionIndex = common.children.findIndex((child) => child.sourceTag === "CAPTION");
    if (captionIndex >= 0) {
      const [caption] = common.children.splice(captionIndex, 1);
      const captionAtBottom = tableCaptionIsBottom({ captionSide: caption.computedStyles?.captionSide || "top" });
      if (captionAtBottom) common.children.push(caption);
      else common.children.unshift(caption);
    }
  }
  return {
    ...common,
    type: "frame",
    ...(displayContents ? { displayContents: true } : {}),
    ...(displayContents && common.semantics ? {
      structuralSemantics: [common.semantics],
      structuralSemanticOwners: [id],
    } : {}),
  };
}

/**
 * Figma's importer can legitimately rebuild Auto Layout, but its font metrics
 * and fractional flex rounding are not guaranteed to match the capture
 * browser. Preserve the measured relative placement as a second channel so
 * the importer can keep the parent layout semantics without moving children.
 */
export function lockMeasuredGeometry(node: DesignNode): void {
  // Keep the shared scene model editable by default. A geometry lock turns a
  // child into an absolute visual snapshot in both the H2D document and the
  // native Figma bridge; applying it to every flex child destroys the very
  // Auto Layout structure we are trying to preserve and causes placeholder,
  // gap, and padding offsets to accumulate. Only layouts that cannot be
  // represented reliably by a single Auto Layout pass need this second
  // channel: wrapped/grid tracks, distribution-sensitive tracks, and
  // explicitly out-of-flow positioned layers.
  // Figma and the browser can resolve main-axis distributions such as
  // `space-between`/centered tracks differently once font metrics, borders,
  // or fractional widths are applied. Cross-axis `align-items: center` is
  // already represented by Figma's counter-axis alignment and stays flowable.
  // Preserve the parent Auto Layout metadata, but pin the visible children to
  // the browser's measured coordinates for distribution-sensitive containers.
  // Ordinary start-aligned stacks remain real flow children so they stay
  // editable and responsive in the native plugin.
  // A distribution lock belongs to the direct children of the sensitive
  // container. Once that child is locked, its own Auto Layout subtree must
  // remain a real flow tree; recursively locking icon/text grandchildren
  // turns a vertical nav item into several unrelated absolute layers.
  const measuredParentLayout = !node.layout.geometryLock && node.layout.mode !== "none" && (
    node.layout.wrap === true
      || node.layout.reverse === true
      || node.layout.justifyContent === "center"
      || node.layout.justifyContent === "end"
      || node.layout.justifyContent === "space-between"
      || node.layout.justifyContent === "space-around"
      || node.layout.justifyContent === "space-evenly"
      || node.layout.alignContent === "center"
      || node.layout.alignContent === "end"
      || node.layout.alignContent === "space-between"
      || node.layout.alignContent === "space-around"
      || node.layout.alignContent === "space-evenly"
  );
  const measuredVisualGroup = node.layout.geometryLock && node.layout.mode === "none";
  const flexDisplay = String(node.computedStyles?.display || "").trim().toLowerCase();
  const isFlexContainer = node.layout.mode !== "none"
    && (flexDisplay === "flex" || flexDisplay === "inline-flex");
  const positiveFlexGrow = isFlexContainer
    ? node.children
      .map((child) => Number.parseFloat(String(child.computedStyles?.flexGrow ?? "")))
      .filter((value) => Number.isFinite(value) && value > 0)
    : [];
  // Figma's layoutGrow is a boolean. When multiple flex items use different
  // positive grow factors (for example 1:2), mapping each one to `1` changes
  // the browser's distribution on resize. Keep the captured geometry for the
  // growing items while retaining their authored grow values in metadata.
  const hasUnequalFlexGrow = positiveFlexGrow.length > 1
    && positiveFlexGrow.some((value) => Math.abs(value - positiveFlexGrow[0]) > 0.001);
  const flexBasisSensitiveChildren = new Set<string>();
  if (isFlexContainer && positiveFlexGrow.length > 1) {
    const growingChildren = node.children.filter((child) => {
      const grow = Number.parseFloat(String(child.computedStyles?.flexGrow ?? ""));
      return Number.isFinite(grow) && grow > 0;
    });
    const basisTokens = growingChildren.map((child) => String(child.computedStyles?.flexBasis ?? "auto").trim().toLowerCase() || "auto");
    const hasUnequalFlexBasis = basisTokens.some((value) => value !== basisTokens[0]);
    const mainAxis = node.layout.mode === "horizontal" ? "width" : node.layout.mode === "vertical" ? "height" : undefined;
    const intrinsicBasis = basisTokens.every((value) => ["auto", "content", "min-content", "max-content", "fit-content"].includes(value));
    const measuredSizes = mainAxis
      ? growingChildren.map((child) => Number(child.rect[mainAxis]))
      : [];
    const hasUnequalIntrinsicSize = intrinsicBasis
      && measuredSizes.length > 1
      && measuredSizes.every((value) => Number.isFinite(value))
      && measuredSizes.some((value) => Math.abs(value - measuredSizes[0]) > 0.5);
    // Figma's FILL maps flex-grow to a boolean and has no per-child
    // flex-basis. Different bases therefore redistribute the same remaining
    // space differently when the parent is resized. Keep all participating
    // growing children at their captured rectangles while preserving the
    // original grow/basis metadata for inspection and future editing.
    if (hasUnequalFlexBasis || hasUnequalIntrinsicSize) {
      growingChildren.forEach((child) => flexBasisSensitiveChildren.add(child.id));
    }
  }
  const flexShrinkSensitiveChildren = new Set<string>();
  if (isFlexContainer) {
    const shrinkingChildren = node.children.filter((child) => {
      const shrink = Number.parseFloat(String(child.computedStyles?.flexShrink ?? "1"));
      return Number.isFinite(shrink) && shrink > 0;
    });
    const shrinkTokens = shrinkingChildren.map((child) => Number.parseFloat(String(child.computedStyles?.flexShrink ?? "1")));
    const hasUnequalFlexShrink = shrinkTokens.length > 1
      && shrinkTokens.some((value) => Math.abs(value - shrinkTokens[0]) > 0.001);
    // Figma has no child-level flex-shrink weight. Equal non-default
    // weights are mathematically equivalent to the default distribution, but
    // unequal positive weights change which siblings absorb negative free
    // space. Preserve the affected measured boxes while keeping the source
    // shrink values in computed-style metadata.
    if (hasUnequalFlexShrink) {
      shrinkingChildren.forEach((child) => flexShrinkSensitiveChildren.add(child.id));
    }
  }
  for (const child of node.children) {
    // A geometry-locked non-layout parent is a measured visual group rather
    // than a reliable browser flow container. If one child is removed from
    // normal flow (for example a measured heading), leaving its siblings in
    // flow changes every following y-position during H2D replay. Pin all
    // direct children to their captured coordinates while keeping the group
    // itself editable as a frame.
    const isOutOfFlow = child.positioning === "absolute"
      || child.positioning === "fixed"
      || child.positioning === "sticky";
    // CSS auto margins consume the parent's free space. Figma Auto Layout
    // has no equivalent per-child auto-margin primitive, so keep the captured
    // placement as a measured layer while retaining the authored marker.
    const hasAutoMargin = child.layout.autoMargins?.some(Boolean) === true;
    // Figma only exposes STRETCH as a per-child cross-axis override. CSS
    // align-self center/end therefore needs the measured snapshot path even
    // when the parent itself is start-aligned. An explicit start override is
    // sensitive too when the parent aligns its other children to center/end;
    // otherwise the layer inherits that parent alignment during import.
    const isCrossAxisAlignmentSensitive = (child.layout.alignSelf === "start" && node.layout.alignItems !== "start")
      || child.layout.alignSelf === "center"
      || child.layout.alignSelf === "end"
      || child.layout.alignSelf === "baseline";
    // Inline sub/sup runs are positioned against the browser's text baseline.
    // Figma Auto Layout has no per-child baseline alignment, so preserve their
    // measured parent-relative rectangle while keeping the text layer editable.
    const verticalAlign = String(child.text?.verticalAlign || "").trim().toLowerCase();
    const isBaselineSensitive = child.type === "text"
      && verticalAlign !== ""
      && verticalAlign !== "baseline"
      && verticalAlign !== "auto";
    const childFlexGrow = Number.parseFloat(String(child.computedStyles?.flexGrow ?? ""));
    const isFlexGrowRatioSensitive = hasUnequalFlexGrow
      && Number.isFinite(childFlexGrow)
      && childFlexGrow > 0;
    const isFlexBasisSensitive = flexBasisSensitiveChildren.has(child.id);
    const isFlexShrinkSensitive = flexShrinkSensitiveChildren.has(child.id);
    // Small static decorations (status dots, badges, and similar inline
    // marks) are already stable in a non-wrapped flex row. Removing one from
    // that flow changes the anonymous text run's starting position and makes
    // the H2D importer render the following label too far left. Keep these
    // leaves in flow; explicit CSS positioning and wrapped/grid tracks still
    // use the measured snapshot path.
    const isTinyInlineDecoration = child.positioning === "static"
      && child.layout.position !== "absolute"
      && child.type !== "text"
      && child.rect.width <= 12
      && child.rect.height <= 12
      // A tiny decoration is safe to keep in normal flow only when the
      // parent starts its track at the captured origin. Distributed tracks
      // (center/space-around/space-evenly/etc.) are measured-lock parents;
      // leaving one tiny child flowable there makes Figma place it at MIN
      // while the other children use captured coordinates.
      && node.layout.wrap !== true
      && !measuredParentLayout;
    const shouldLockForParent = measuredParentLayout && !isTinyInlineDecoration;
    if (isOutOfFlow || hasAutoMargin || shouldLockForParent || measuredVisualGroup || isCrossAxisAlignmentSensitive || isBaselineSensitive || isFlexGrowRatioSensitive || isFlexBasisSensitive || isFlexShrinkSensitive) {
      child.layout = { ...child.layout, geometryLock: true };
    }
    lockMeasuredGeometry(child);
  }
}

export function sanitizeSource(source: string): string {
  if (typeof DOMParser === "undefined") return source;
  const parsed = new DOMParser().parseFromString(source, "text/html");
  parsed.querySelectorAll("script, iframe, object, embed").forEach((node) => node.remove());
  // Keep the authored stylesheet intact, including the generated page's
  // marked Figma Auto Layout compatibility rules. Those rules are part of the
  // rendered page the user sees in the Board (for example, they intentionally
  // turn map controls into a vertical flex layout), so removing them here
  // would measure a different document and produce visibly shifted H2D data.
  parsed.querySelectorAll("*").forEach((element) => {
    Array.from(element.attributes).forEach((attribute) => {
      if (attribute.name.toLowerCase().startsWith("on") || attribute.name.startsWith("data-codex-")) element.removeAttribute(attribute.name);
    });
  });
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

function waitForAssets(doc: Document): Promise<void> {
  const images = Array.from(doc.images);
  const imageWait = Promise.all(images.map((image) => image.complete
    ? Promise.resolve()
    : new Promise<void>((resolve) => {
      image.addEventListener("load", () => resolve(), { once: true });
      image.addEventListener("error", () => resolve(), { once: true });
    })));
  const fonts = doc.fonts?.ready ?? Promise.resolve();
  const settled = Promise.all([imageWait, fonts]).then(() => undefined);
  // A cross-origin image or a browser font can leave its promise pending
  // forever. Continue with the captured layout after a bounded wait; the
  // resulting node keeps its source URL so the importer can report the asset
  // limitation instead of leaving the copy action stuck.
  return Promise.race([
    settled,
    new Promise<void>((resolve) => window.setTimeout(resolve, ASSET_WAIT_TIMEOUT_MS)),
  ]);
}

function nextFrames(win: Window): Promise<void> {
  // A fixed, transparent capture iframe can be throttled by Chromium when
  // the host window is backgrounded. Keep the two-frame stability requirement
  // when rAF is scheduled, but never let a throttled iframe block clipboard
  // export indefinitely. The capture still waits for fonts/images separately.
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timeout = window.setTimeout(finish, 160);
    const frame = () => {
      if (settled) return;
      win.requestAnimationFrame(() => {
        if (settled) return;
        win.requestAnimationFrame(() => {
          window.clearTimeout(timeout);
          finish();
        });
      });
    };
    try {
      frame();
    } catch {
      window.clearTimeout(timeout);
      finish();
    }
  });
}

export async function captureHtmlPage(page: Page, deviceFrame?: Pick<DeviceFrame, "width" | "height">): Promise<DesignDocument> {
  if (page.source.type !== "html") throw new Error("URL pages require official Figma Capture page");
  if (typeof document === "undefined") throw new Error("HTML capture requires a browser document");
  const viewport = {
    width: deviceFrame?.width ?? DEFAULT_VIEWPORT.width,
    height: deviceFrame?.height ?? DEFAULT_VIEWPORT.height,
  };
  const iframe = document.createElement("iframe");
  iframe.title = `Figma export for ${page.title}`;
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("sandbox", "allow-same-origin");
  // Keep the iframe at the viewport origin so fixed-position descendants are
  // measured in the same coordinate space as the captured document. It is
  // still invisible and non-interactive, so it cannot affect the workbench.
  iframe.style.cssText = `position:fixed;left:0;top:0;width:${viewport.width}px;height:${viewport.height}px;border:0;opacity:0;pointer-events:none;`;
  document.body.appendChild(iframe);
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Timed out waiting for HTML capture")), CAPTURE_TIMEOUT_MS);
      const cleanup = () => window.clearTimeout(timeout);
      iframe.addEventListener("load", () => { cleanup(); resolve(); }, { once: true });
      iframe.addEventListener("error", () => { cleanup(); reject(new Error("HTML capture failed")); }, { once: true });
      // Register listeners before assigning srcdoc. Some Chromium builds can
      // deliver the initial about:srcdoc load before the next task boundary.
      iframe.srcdoc = sanitizeSource(page.source.value);
    });
    const frameDocument = iframe.contentDocument;
    const frameWindow = iframe.contentWindow;
    if (!frameDocument || !frameWindow) throw new Error("Capture document is unavailable");
    await waitForAssets(frameDocument);
    await nextFrames(frameWindow);
    const rootStyle = frameWindow.getComputedStyle(frameDocument.documentElement);
    const rootFontSize = numberValue(rootStyle.fontSize, 16);
    const rootLineHeight = textLineHeight(rootStyle.lineHeight, rootFontSize, rootFontSize);
    const context: CaptureContext = {
      document: frameDocument,
      rootFontSize,
      rootLineHeight,
      assets: [],
      assetBySource: new Map(),
      fonts: new Map(),
      diagnostics: [],
      fontDiagnostics: new Set(),
      imageData: new Map(),
      nodeIdByElement: new WeakMap(),
      sequence: 0,
    };
    await inlineAccessibleImages(frameDocument, context);
    // Inlining an accessible image can change its intrinsic dimensions even
    // after the source document's initial load has settled. Wait for the
    // replacement resources and another two animation frames before reading
    // any rectangles, otherwise one image can shift every later flex sibling
    // and the transient layout is what gets exported to Figma.
    await waitForAssets(frameDocument);
    await nextFrames(frameWindow);
    // Match the compatibility serializer's document capture boundary. The
    // browser extension starts at `document.documentElement` and skips HEAD
    // during node serialization, leaving the rendered BODY as its child. A
    // BODY-only root is visually equivalent in replay but is not accepted by
    // some Figma Desktop importers because the document shape no longer
    // matches the extension's H2D contract.
    const documentRoot = frameDocument.documentElement;
    const documentRootRect = documentRoot.getBoundingClientRect();
    const root = createNode(documentRoot, context, undefined) ?? {
      id: "node-root",
      type: "frame",
      rect: { x: 0, y: 0, width: viewport.width, height: 0 },
      opacity: 1,
      radius: [0, 0, 0, 0],
      margin: [0, 0, 0, 0],
      layout: emptyLayout(),
      children: [],
    };
    const hasViewportAnchoredNode = Array.from(frameDocument.querySelectorAll("*"))
      .some((candidate) => {
        const candidateStyle = frameWindow.getComputedStyle(candidate);
        return candidateStyle.position === "fixed" || candidateStyle.position === "sticky";
      });
    if (hasViewportAnchoredNode) {
      context.diagnostics.push({ code: "fixed-position", message: "Fixed-position content is captured at the selected viewport coordinates" });
    }
    const viewportHeight = Math.max(frameDocument.body.scrollHeight, documentRootRect.height, viewport.height, root.rect.height);
    if (root.rect.height < viewportHeight) root.rect.height = viewportHeight;
    // Keep the shared scene model's browser-measured placement for consumers
    // that build native Figma nodes. The H2D serializer omits the private flag
    // from its marker metadata, but uses it to pin only distribution-sensitive
    // layers to their measured parent-relative coordinates.
    lockMeasuredGeometry(root);
    return {
      version: 1,
      pageId: page.id,
      title: page.title,
      viewport: { width: viewport.width, height: viewportHeight },
      viewportRect: { x: 0, y: 0, width: viewport.width, height: viewport.height },
      devicePixelRatio: frameWindow.devicePixelRatio || 1,
      root,
      assets: context.assets,
      fonts: Array.from(context.fonts.values()),
      diagnostics: context.diagnostics,
    };
  } finally {
    iframe.remove();
  }
}
