import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

const ICON_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SVG_PATTERN = /<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi;
const PATH_PATTERN = /<path\b([^>]*)\/?\s*>/gi;
const NON_PATH_SHAPE_PATTERN = /<(?:circle|ellipse|line|polygon|polyline|rect)\b/i;

export interface InlineIconAsset {
  name: string;
  viewBox: string;
  pathData: string[];
  standaloneSvg: string;
}

function readAttribute(attributes: string, name: string): string | null {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"));
  return match?.[2]?.trim() || null;
}

function normalizePathData(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function assertNoExternalIconMechanisms(html: string): void {
  if (/<use\b/i.test(html)) {
    throw new Error("Generated page icons must contain inline path data; SVG <use> references are not allowed");
  }
  if (/<img\b[^>]*\bsrc\s*=\s*["'][^"']+\.svg(?:[?#][^"']*)?["']/i.test(html)) {
    throw new Error("Generated page icons must be inline SVG paths; SVG files cannot be rendered through <img>");
  }
  if (/<script\b[^>]*\bsrc\s*=\s*["'][^"']*(?:iconify|lucide|fontawesome|font-awesome|hugeicons?)[^"']*["']/i.test(html)) {
    throw new Error("Runtime icon libraries are not allowed in generated pages; inline their SVG path data");
  }
  if (/<(?:i|span)\b[^>]*\bclass\s*=\s*["'][^"']*(?:\bfa(?:s|r|l|b|d)?\b|material-icons|iconify)[^"']*["']/i.test(html)) {
    throw new Error("Icon fonts are not allowed in generated pages; use inline SVG path data");
  }
}

export function collectInlineIconAssets(html: string): InlineIconAsset[] {
  assertNoExternalIconMechanisms(html);
  const icons = new Map<string, InlineIconAsset>();
  const svgMatches = Array.from(html.matchAll(SVG_PATTERN));
  const svgOpenCount = html.match(/<svg\b/gi)?.length ?? 0;
  if (svgOpenCount !== svgMatches.length) {
    throw new Error("Every generated page SVG must use a complete <svg>...</svg> element");
  }

  for (const match of svgMatches) {
    const attributes = match[1] ?? "";
    const body = match[2] ?? "";
    const name = readAttribute(attributes, "data-icon");
    if (!name) {
      throw new Error("Every generated page SVG must include a data-icon attribute");
    }
    if (!ICON_NAME_PATTERN.test(name)) {
      throw new Error(`Icon name must use lowercase kebab-case: ${name}`);
    }
    const viewBox = readAttribute(attributes, "viewBox");
    if (!viewBox) throw new Error(`Inline icon ${name} must include a viewBox`);
    if (NON_PATH_SHAPE_PATTERN.test(body)) {
      throw new Error(`Inline icon ${name} must convert vector shapes to <path d="..."> elements`);
    }

    const pathData = Array.from(body.matchAll(PATH_PATTERN)).map((pathMatch) => {
      const value = readAttribute(pathMatch[1] ?? "", "d");
      if (!value) throw new Error(`Every path in inline icon ${name} must include d data`);
      return normalizePathData(value);
    });
    if (pathData.length === 0) {
      throw new Error(`Inline icon ${name} must contain at least one <path d="..."> element`);
    }

    const rootAttributes = /(?:^|\s)xmlns\s*=/i.test(attributes)
      ? attributes.trim()
      : `xmlns="http://www.w3.org/2000/svg" ${attributes.trim()}`.trim();
    const standaloneSvg = `<svg ${rootAttributes}>${body.trim()}</svg>\n`;
    const asset = { name, viewBox, pathData, standaloneSvg };
    const existing = icons.get(name);
    if (existing) {
      if (existing.viewBox !== viewBox || JSON.stringify(existing.pathData) !== JSON.stringify(pathData)) {
        throw new Error(`Inline icon ${name} is used with inconsistent viewBox or path data`);
      }
      continue;
    }
    icons.set(name, asset);
  }

  return Array.from(icons.values());
}

export async function syncInlineIconAssets(htmlFilePath: string, html: string): Promise<string[]> {
  const icons = collectInlineIconAssets(html);
  if (icons.length === 0) return [];
  const iconDirectory = join(dirname(htmlFilePath), "assets", "icons");
  await mkdir(iconDirectory, { recursive: true });
  const outputs: string[] = [];
  for (const icon of icons) {
    const outputPath = join(iconDirectory, `${icon.name}.svg`);
    await writeFile(outputPath, icon.standaloneSvg, "utf8");
    outputs.push(relative(process.cwd(), outputPath));
  }
  return outputs;
}
