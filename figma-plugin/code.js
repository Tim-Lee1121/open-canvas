/* global figma, __html__, atob, setTimeout */
figma.showUI(__html__, { width: 360, height: 300, themeColors: true });

// The browser capture is the visual source of truth. Keep the tolerance below
// a device pixel so fractional font/grid rounding cannot remain in an
// Auto Layout tree and compound into a visible downstream offset.
// Figma exposes many text and Auto Layout coordinates on half-pixel
// boundaries. Treat one half-pixel as host rounding rather than a visible
// geometry mismatch; larger offsets are still corrected and reported.
const GEOMETRY_EPSILON = 0.5;
const SIZE_EPSILON = 0.5;
const FLEX_SIZE_EPSILON = 1;

function parseColor(value) {
  if (!value) return null;
  if (value.trim().toLowerCase() === "transparent") {
    return { color: { r: 0, g: 0, b: 0 }, opacity: 0 };
  }
  const hex = value.trim().match(/^#([0-9a-f]{3,8})$/i);
  if (hex) {
    let raw = hex[1];
    if (raw.length === 3 || raw.length === 4) raw = raw.split("").map(char => char + char).join("");
    if (raw.length === 6) raw += "ff";
    if (raw.length !== 8 || !/^[0-9a-f]{8}$/i.test(raw)) return null;
    return {
      color: {
        r: parseInt(raw.slice(0, 2), 16) / 255,
        g: parseInt(raw.slice(2, 4), 16) / 255,
        b: parseInt(raw.slice(4, 6), 16) / 255,
      },
      opacity: parseInt(raw.slice(6, 8), 16) / 255,
    };
  }
  const match = value.match(/rgba?\(([^)]+)\)/i);
  if (!match) return null;
  const tokens = match[1].replaceAll("/", " ").trim().split(/[ ,]+/).filter(Boolean);
  const channel = token => {
    if (token.endsWith("%")) return Number.parseFloat(token) * 2.55;
    return Number.parseFloat(token);
  };
  const alpha = token => token?.endsWith("%") ? Number.parseFloat(token) / 100 : Number.parseFloat(token);
  const values = tokens.map(channel);
  return {
    color: { r: values[0] / 255, g: values[1] / 255, b: values[2] / 255 },
    opacity: Number.isFinite(values[3]) ? alpha(tokens[3]) : 1,
  };
}

function fill(node, color) {
  if (!color || !color.color || !("fills" in node)) return;
  const parsed = parseColor(color.color);
  if (!parsed) return;
  node.fills = [{ type: "SOLID", color: parsed.color, opacity: color.opacity ?? parsed.opacity }];
}

function solidPaint(color) {
  if (!color || !color.color) return null;
  const parsed = parseColor(color.color);
  if (!parsed) return null;
  return { type: "SOLID", color: parsed.color, opacity: color.opacity ?? parsed.opacity };
}

function gradientFunctions(value) {
  const functions = [];
  const pattern = /(linear|radial)-gradient\(/gi;
  let match;
  while ((match = pattern.exec(value || ""))) {
    let depth = 1;
    let index = pattern.lastIndex;
    for (; index < value.length && depth > 0; index += 1) {
      if (value[index] === "(") depth += 1;
      else if (value[index] === ")") depth -= 1;
    }
    if (depth === 0) {
      functions.push({ type: match[1].toLowerCase(), body: value.slice(pattern.lastIndex, index - 1) });
      pattern.lastIndex = index;
    }
  }
  return functions;
}

function splitCssArguments(value) {
  const parts = [];
  let start = 0;
  let depth = 0;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "(") depth += 1;
    else if (value[index] === ")") depth -= 1;
    else if (value[index] === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function gradientAngle(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (/^-?(?:\d+(?:\.\d*)?|\.\d+)deg$/.test(raw)) return Number.parseFloat(raw);
  if (!raw.startsWith("to ")) return 90;
  const directions = raw.slice(3).split(/\s+/);
  const has = direction => directions.includes(direction);
  if (has("top") && has("right")) return 45;
  if (has("bottom") && has("right")) return 135;
  if (has("bottom") && has("left")) return 225;
  if (has("top") && has("left")) return 315;
  if (has("top")) return 0;
  if (has("bottom")) return 180;
  if (has("left")) return 270;
  return 90;
}

function radialGradientCenter(value) {
  const raw = String(value || "").trim().toLowerCase();
  const atMatch = raw.match(/\bat\s+(.+)$/);
  if (!atMatch) return { x: 0.5, y: 0.5 };
  const tokens = atMatch[1].trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { x: 0.5, y: 0.5 };

  const keyword = {
    left: 0,
    center: 0.5,
    right: 1,
    top: 0,
    bottom: 1,
  };
  const parsePercent = token => {
    const percent = token.match(/^(-?(?:\d+(?:\.\d*)?|\.\d+))%$/);
    if (percent) return Math.max(0, Math.min(1, Number.parseFloat(percent[1]) / 100));
    return null;
  };
  const horizontal = token => token === "left" || token === "center" || token === "right";
  const vertical = token => token === "top" || token === "center" || token === "bottom";
  let x = 0.5;
  let y = 0.5;
  const first = tokens[0];
  const second = tokens[1];
  const firstPercent = parsePercent(first);
  const secondPercent = parsePercent(second || "");
  if (tokens.length === 1) {
    if (horizontal(first) || firstPercent !== null) x = firstPercent ?? keyword[first];
    else if (vertical(first)) y = keyword[first];
    return { x, y };
  }
  if (firstPercent !== null) x = firstPercent;
  else if (horizontal(first)) x = keyword[first];
  else if (vertical(first)) y = keyword[first];
  if (secondPercent !== null) {
    // Numeric positions are ordered x then y by CSS.
    if (firstPercent !== null || !vertical(first)) y = secondPercent;
    else x = secondPercent;
  } else if (horizontal(second)) x = keyword[second];
  else if (vertical(second)) y = keyword[second];
  return { x, y };
}

function radialGradientHandles(direction, width = 1, height = 1) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const center = radialGradientCenter(direction);
  const raw = String(direction || "").trim().toLowerCase();
  const isCircle = /\bcircle\b/.test(raw);
  const size = raw.match(/\b(closest|farthest)-(side|corner)\b/);
  const distanceMode = size ? `${size[1]}-${size[2]}` : "farthest-corner";
  const sideDistances = [
    center.x * safeWidth,
    (1 - center.x) * safeWidth,
    center.y * safeHeight,
    (1 - center.y) * safeHeight,
  ];
  const cornerDistances = [
    Math.hypot(center.x * safeWidth, center.y * safeHeight),
    Math.hypot((1 - center.x) * safeWidth, center.y * safeHeight),
    Math.hypot(center.x * safeWidth, (1 - center.y) * safeHeight),
    Math.hypot((1 - center.x) * safeWidth, (1 - center.y) * safeHeight),
  ];
  const extent = distanceMode.endsWith("corner")
    ? (distanceMode.startsWith("closest") ? Math.min(...cornerDistances) : Math.max(...cornerDistances))
    : (distanceMode.startsWith("closest") ? Math.min(...sideDistances) : Math.max(...sideDistances));
  // A CSS circle uses one pixel radius on both axes. An ellipse uses an
  // independent radius per axis, which is the natural representation for
  // Figma's two radial handles.
  const radiusX = isCircle ? extent : (distanceMode.startsWith("closest")
    ? Math.min(center.x * safeWidth, (1 - center.x) * safeWidth)
    : Math.max(center.x * safeWidth, (1 - center.x) * safeWidth));
  const radiusY = isCircle ? extent : (distanceMode.startsWith("closest")
    ? Math.min(center.y * safeHeight, (1 - center.y) * safeHeight)
    : Math.max(center.y * safeHeight, (1 - center.y) * safeHeight));
  return [
    center,
    { x: center.x + radiusX / safeWidth, y: center.y },
    { x: center.x, y: center.y + radiusY / safeHeight },
  ];
}

function linearGradientHandles(angle, width = 1, height = 1) {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  // CSS angles use 0deg for bottom-to-top and 90deg for left-to-right.
  // Compute the line's intersection with the node bounds so a diagonal
  // gradient uses the same aspect-ratio-aware endpoints as the capture SVG.
  const radians = angle * Math.PI / 180;
  const directionX = Math.sin(radians);
  const directionY = -Math.cos(radians);
  const extent = Math.min(
    Math.abs(directionX) > 0.0001 ? safeWidth / (2 * Math.abs(directionX)) : Number.POSITIVE_INFINITY,
    Math.abs(directionY) > 0.0001 ? safeHeight / (2 * Math.abs(directionY)) : Number.POSITIVE_INFINITY,
  );
  const dx = directionX * extent;
  const dy = directionY * extent;
  return [
    { x: 0.5 - dx / safeWidth, y: 0.5 - dy / safeHeight },
    { x: 0.5 + dx / safeWidth, y: 0.5 + dy / safeHeight },
  ];
}

function gradientTransformFromHandles(handles) {
  if (!Array.isArray(handles) || handles.length < 2) return [[1, 0, 0], [0, 1, 0]];
  const start = handles[0];
  const end = handles[1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const third = handles[2] || { x: start.x - dy, y: start.y + dx };
  return [
    [dx, third.x - start.x, start.x],
    [dy, third.y - start.y, start.y],
  ];
}

function gradientPaints(value, width = 1, height = 1) {
  return gradientFunctions(value).flatMap(({ type, body }) => {
    const args = splitCssArguments(body);
    if (args.length < 2) return [];
    const first = args[0];
    const hasDirection = !parseColor(first.replace(/\s+\d+(?:\.\d+)?%$/, ""));
    const direction = hasDirection ? first : "90deg";
    const stopArgs = hasDirection ? args.slice(1) : args;
    const stops = stopArgs.map((stop, index) => {
      const match = stop.match(/^(.*?)(?:\s+(\d+(?:\.\d+)?)%)?$/);
      const parsed = parseColor(match?.[1] || stop);
      return parsed ? { ...parsed, position: match?.[2] != null ? Number(match[2]) / 100 : index / Math.max(1, stopArgs.length - 1) } : null;
    }).filter(Boolean);
    if (stops.length < 2) return [];
    const gradientStops = stops.map(stop => ({ color: { ...stop.color, a: stop.opacity }, position: stop.position }));
    if (type === "radial") {
      const handles = radialGradientHandles(direction, width, height);
      return [{
        type: "GRADIENT_RADIAL",
        gradientTransform: gradientTransformFromHandles(handles),
        gradientStops,
      }];
    }
    const angle = gradientAngle(direction);
    const handles = linearGradientHandles(angle, width, height);
    return [{
      type: "GRADIENT_LINEAR",
      gradientTransform: gradientTransformFromHandles(handles),
      gradientStops,
    }];
  });
}

function gradient(node, value, baseColor) {
  if (!value || !("fills" in node)) return false;
  const paints = gradientPaints(value, node.width, node.height);
  if (!paints.length) return false;
  // CSS background-color is painted below every background-image layer. Figma
  // stores paints in the same front-to-back order, so append the solid paint
  // after gradients instead of replacing it. This matters for transparent
  // gradient stops and repeating map/grid backgrounds.
  const base = solidPaint(baseColor);
  node.fills = base ? [...paints, base] : paints;
  return true;
}

function backgroundBlendModes(value) {
  return String(value || "")
    .split(",")
    .map(mode => mode.trim().toLowerCase())
    .filter(Boolean);
}

function applyBackgroundBlendModes(node, scene) {
  if (!node || !Array.isArray(node.fills) || !scene?.computedStyles?.backgroundBlendMode) return;
  const modes = backgroundBlendModes(scene.computedStyles.backgroundBlendMode);
  if (!modes.length) return;
  // Figma paints use the same front-to-back order as the H2D background
  // layers. Skip the optional solid background color; blend modes describe
  // the image/gradient layers above it.
  let layerIndex = 0;
  for (const paint of node.fills) {
    if (!paint || paint.type === "SOLID") continue;
    const mode = modes[layerIndex] ?? modes[modes.length - 1];
    if (mode && mode !== "normal") paint.blendMode = blendModeValue(mode);
    layerIndex += 1;
  }
}

function cssImageUrls(value) {
  if (!value) return [];
  const urls = [];
  const pattern = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
  let match;
  while ((match = pattern.exec(String(value)))) {
    if (match[2]) urls.push(match[2]);
  }
  return urls;
}

function cssBackgroundLayers(value) {
  return splitCssArguments(String(value || "")).map(layer => ({
    layer,
    image: /url\(/i.test(layer),
    gradient: /(?:linear|radial)-gradient\(/i.test(layer),
  }));
}

function cssLayerValues(value) {
  return splitCssArguments(String(value || "")).map(layer => layer.trim()).filter(Boolean);
}

function cssLayerValue(value, index, fallback) {
  const values = cssLayerValues(value);
  if (!values.length) return fallback;
  return values[index] ?? values[values.length - 1] ?? fallback;
}

function recordAssetDegradation(report, scene, message) {
  if (!report) return;
  report.styleDegradations += 1;
  if (report.styleDegradationNodes.length < 100) {
    report.styleDegradationNodes.push({ id: scene.id, message });
  }
}

function createFigmaImage(asset, cacheKey, resources) {
  const bytes = assetBytes(asset);
  if (!bytes) return null;
  const cached = resources?.images?.get(cacheKey);
  if (cached) return cached;
  try {
    const image = figma.createImage(bytes);
    resources?.images?.set(cacheKey, image);
    return image;
  } catch {
    return null;
  }
}

function backgroundImage(node, scene, assets, resources, report) {
  if (!scene.backgroundImage || !("fills" in node)) return;
  const candidates = assetList(assets);
  const layers = cssBackgroundLayers(scene.backgroundImage);
  const imageLayerIndices = layers
    .map((layer, index) => layer.image ? index : -1)
    .filter(index => index >= 0);
  const sources = scene.backgroundAssetId ? [scene.backgroundAssetId] : cssImageUrls(scene.backgroundImage);
  const paints = [];
  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex];
    const asset = candidates.find(candidate => candidate.id === source || candidate.url === source);
    if (!asset) continue;
    const cacheKey = asset.id || asset.url || source;
    const image = createFigmaImage(asset, cacheKey, resources);
    if (!image) {
      recordAssetDegradation(report, scene, `background asset ${cacheKey} is not a Figma-supported bitmap; native paints were preserved`);
      continue;
    }
    const layerIndex = imageLayerIndices[sourceIndex] ?? sourceIndex;
    const size = cssLayerValue(scene.backgroundSize, layerIndex, scene.backgroundSize || "auto");
    const repeat = String(cssLayerValue(scene.backgroundRepeat, layerIndex, scene.backgroundRepeat || ""));
    const repeats = /^(?:repeat|repeat-x|repeat-y)$/.test(repeat.trim());
    const scaleMode = repeats || size === "repeat"
      ? "TILE"
      : size === "contain" ? "FIT" : size === "cover" ? "CROP" : "FILL";
    const paint = { type: "IMAGE", imageHash: image.hash, scaleMode };
    const imageFilters = cssImageFilters(scene.filter);
    if (imageFilters) paint.filters = imageFilters;
    const position = cssLayerValue(scene.backgroundPosition, layerIndex, scene.backgroundPosition || scene.objectPosition);
    applyImagePosition(paint, position);
    paints.push(paint);
  }
  if (!paints.length) return;
  const existing = Array.isArray(node.fills) ? node.fills.filter(paint => paint.type !== "IMAGE") : [];
  // A captured SVG fallback already contains every CSS background layer
  // (including repeating gradients). Replacing generated paints avoids
  // drawing the same visual twice. For ordinary URL layers, preserve CSS
  // source order: the first CSS layer is the topmost Figma paint. Mixed
  // gradient/URL backgrounds need to interleave the two generated paint
  // lists instead of putting every URL above every gradient.
  if (scene.backgroundAssetId) {
    node.fills = paints;
    return;
  }
  const gradients = existing.filter(paint => String(paint.type || "").startsWith("GRADIENT"));
  const base = existing.filter(paint => !String(paint.type || "").startsWith("GRADIENT"));
  if (!layers.some(layer => layer.gradient) || !layers.some(layer => layer.image)) {
    node.fills = [...paints, ...existing];
    return;
  }
  const ordered = [];
  let imageIndex = 0;
  let gradientIndex = 0;
  for (const layer of layers) {
    if (layer.image && paints[imageIndex]) ordered.push(paints[imageIndex++]);
    else if (layer.gradient && gradients[gradientIndex]) ordered.push(gradients[gradientIndex++]);
  }
  ordered.push(...paints.slice(imageIndex), ...gradients.slice(gradientIndex), ...base);
  node.fills = ordered;
}

function applyImagePosition(paint, value) {
  if (!paint || !value || value === "50% 50%") return;
  const parts = String(value).split(/\s+/);
  const parse = (part, fallback) => {
    if (!part) return fallback;
    if (part.endsWith("%")) return Math.max(0, Math.min(1, Number.parseFloat(part) / 100));
    if (part === "left" || part === "top") return 0;
    if (part === "right" || part === "bottom") return 1;
    return fallback;
  };
  const x = parse(parts[0], 0.5);
  const y = parse(parts[1], 0.5);
  // ImagePaint uses a normalized transform. Translation is intentionally
  // conservative: Figma applies the crop after scaleMode, so this preserves
  // the requested focal point without changing the image's aspect ratio.
  paint.imageTransform = [[1, 0, (0.5 - x)], [0, 1, (0.5 - y)]];
}

function applyTextRectOffset(node, scene) {
  if (!node || node.type !== "TEXT" || !scene?.textRect) return;
  const offsetX = Number(scene.textRect.x || 0);
  const offsetY = Number(scene.textRect.y || 0);
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
  // Figma's text box is based on font metrics, while the browser capture's
  // textRect is the actual glyph box. The scene rect remains the full element
  // box even for an absolute/measured layer, so the glyph inset is still
  // required. Anonymous direct text runs have no textRect and therefore do
  // not receive this correction twice.
  if ("x" in node && Math.abs(offsetX) > 0.25) node.x += offsetX;
  if ("y" in node && Math.abs(offsetY) > 0.25) node.y += offsetY;
}

function applyFlowTextGlyphOffset(node, scene, parentUsesAutoLayout) {
  if (!node || node.type !== "TEXT" || !scene?.textRect || !parentUsesAutoLayout) return;
  // Measured/absolute text already receives the glyph inset through
  // measuredTextPosition(). Applying it again would double the correction.
  if (scene.layout?.geometryLock || explicitPositioning(scene) || scene.transform) return;
  const offsetX = Number(scene.textRect.x || 0);
  const offsetY = Number(scene.textRect.y || 0);
  if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) return;
  const align = scene.text?.textAlign || "left";
  // Center/right-aligned text uses the captured range x as a glyph width
  // measurement, not as a visual inset. Only preserve x for left-aligned
  // flow text; vertical glyph metrics are safe for every alignment.
  const translateX = align === "left" ? offsetX : 0;
  const translateY = offsetY;
  if (Math.abs(translateX) <= 0.25 && Math.abs(translateY) <= 0.25) return;
  if ("relativeTransform" in node) {
    try {
      const current = node.relativeTransform;
      const a = Number(current?.[0]?.[0]);
      const c = Number(current?.[0]?.[1]);
      const e = Number(current?.[0]?.[2]);
      const b = Number(current?.[1]?.[0]);
      const d = Number(current?.[1]?.[1]);
      const f = Number(current?.[1]?.[2]);
      if ([a, b, c, d, e, f].every(Number.isFinite)) {
        node.relativeTransform = [[a, c, e + translateX], [b, d, f + translateY]];
        return;
      }
      node.relativeTransform = [[1, 0, translateX], [0, 1, translateY]];
      return;
    } catch {
      // Fall through for older host runtimes that expose a read-only matrix.
    }
  }
  // The fallback is only used by older Figma runtimes without a writable
  // matrix. Auto Layout still owns the flow slot; x/y are a visual nudge.
  if ("x" in node && Math.abs(translateX) > 0.25) node.x += translateX;
  if ("y" in node && Math.abs(translateY) > 0.25) node.y += translateY;
}

function translateRelative(node, translateX, translateY) {
  if (!node || !("relativeTransform" in node)) return false;
  if (Math.abs(translateX) <= GEOMETRY_EPSILON && Math.abs(translateY) <= GEOMETRY_EPSILON) return true;
  try {
    const current = node.relativeTransform;
    const a = Number(current?.[0]?.[0]);
    const c = Number(current?.[0]?.[1]);
    const e = Number(current?.[0]?.[2]);
    const b = Number(current?.[1]?.[0]);
    const d = Number(current?.[1]?.[1]);
    const f = Number(current?.[1]?.[2]);
    node.relativeTransform = [a, b, c, d, e, f].every(Number.isFinite)
      ? [[a, c, e + translateX], [b, d, f + translateY]]
      : [[1, 0, translateX], [0, 1, translateY]];
    return true;
  } catch {
    return false;
  }
}

function visuals(node, scene) {
  const hasGradient = gradient(node, scene.gradient, scene.fill);
  if (!hasGradient) {
    if (scene.fill) {
      fill(node, scene.fill);
    } else if (scene.type === "text" && "fills" in node) {
      // Figma creates Text nodes with a default black fill. A captured CSS
      // color can be transparent, in which case retaining that default adds
      // visible glyphs that do not exist in the source page.
      node.fills = [];
    } else if (scene.type === "frame" && "fills" in node) {
      // Figma creates frames with a default paint in some editor versions.
      // A CSS container with no background must remain transparent; otherwise
      // every transparent wrapper adds a visible layer to the imported page.
      node.fills = [];
    }
  }
  if (scene.radius) {
    if ("topLeftRadius" in node) {
      node.topLeftRadius = scene.radius[0] || 0;
      node.topRightRadius = scene.radius[1] || 0;
      node.bottomRightRadius = scene.radius[2] || 0;
      node.bottomLeftRadius = scene.radius[3] || 0;
    } else if ("cornerRadius" in node) node.cornerRadius = scene.radius[0] || 0;
  }
  if (scene.stroke && "strokes" in node) {
    const parsed = parseColor(scene.stroke.color);
    if (parsed) {
      node.strokes = [{ type: "SOLID", color: parsed.color, opacity: scene.stroke.opacity ?? parsed.opacity }];
      node.strokeWeight = scene.stroke.width || 1;
      if ("strokeAlign" in node) node.strokeAlign = "INSIDE";
    }
  }
  if (scene.borders && "strokes" in node) {
    const [top, right, bottom, left] = scene.borders;
    const first = top || right || bottom || left;
    const parsed = first && parseColor(first.color);
    if (parsed) {
      node.strokes = [{ type: "SOLID", color: parsed.color, opacity: first.opacity ?? parsed.opacity }];
      if ("strokeTopWeight" in node) {
        node.strokeTopWeight = top?.width || 0;
        node.strokeRightWeight = right?.width || 0;
        node.strokeBottomWeight = bottom?.width || 0;
        node.strokeLeftWeight = left?.width || 0;
      } else node.strokeWeight = first.width || 1;
      if ("strokeAlign" in node) node.strokeAlign = "INSIDE";
    } else if (scene.type === "frame") {
      // Do not leak a host default stroke onto a CSS element whose computed
      // border is none on every side.
      node.strokes = [];
    }
  }
  // CSS uses the border-box as the captured geometry. When the host exposes
  // this Auto Layout flag, include the stroke in the layout bounds so border
  // widths do not push padded children outward or inflate the parent.
  if (scene.borders?.some(Boolean) && "strokesIncludedInLayout" in node) {
    try { node.strokesIncludedInLayout = true; } catch { /* optional Figma API */ }
  }
  applyStrokePattern(node, scene);
  if ((scene.shadows?.length || scene.shadow) && "effects" in node) {
    const shadows = scene.shadows?.length ? scene.shadows : [scene.shadow];
    node.effects = shadows.filter(Boolean).map(shadow => {
      const parsed = parseColor(shadow.color) || { color: { r: 0, g: 0, b: 0 }, opacity: 0.18 };
      return { type: shadow.inset ? "INNER_SHADOW" : "DROP_SHADOW", color: { ...parsed.color, a: shadow.opacity ?? parsed.opacity ?? 0.18 }, offset: { x: shadow.offsetX, y: shadow.offsetY }, radius: shadow.blur, spread: shadow.spread, visible: true, blendMode: "NORMAL" };
    });
  }
  if (scene.type === "text" && scene.text?.textShadow && "effects" in node) {
    node.effects = cssShadows(scene.text.textShadow).map(shadow => {
      const parsed = parseColor(shadow.color) || { color: { r: 0, g: 0, b: 0 }, opacity: 0.18 };
      return { type: shadow.inset ? "INNER_SHADOW" : "DROP_SHADOW", color: { ...parsed.color, a: shadow.opacity ?? parsed.opacity ?? 0.18 }, offset: { x: shadow.offsetX, y: shadow.offsetY }, radius: shadow.blur, spread: shadow.spread, visible: true, blendMode: "NORMAL" };
    });
  }
  if (scene.filter && "effects" in node) {
    const filterShadows = cssFilterShadows(scene.filter);
    if (filterShadows.length) {
      const filterEffects = filterShadows.map(shadow => {
        const parsed = parseColor(shadow.color) || { color: { r: 0, g: 0, b: 0 }, opacity: 0.18 };
        return { type: "DROP_SHADOW", color: { ...parsed.color, a: shadow.opacity ?? parsed.opacity ?? 0.18 }, offset: { x: shadow.offsetX, y: shadow.offsetY }, radius: shadow.blur, spread: shadow.spread, visible: true, blendMode: "NORMAL" };
      });
      node.effects = [...(Array.isArray(node.effects) ? node.effects : []), ...filterEffects];
    }
    const layerBlurs = cssFilterBlurs(scene.filter);
    if (layerBlurs.length) {
      node.effects = [
        ...(Array.isArray(node.effects) ? node.effects : []),
        ...layerBlurs.map(radius => ({ type: "LAYER_BLUR", radius, visible: true })),
      ];
    }
  }
  if (scene.backdropFilter && "effects" in node) {
    const backgroundBlurs = cssFilterBlurs(scene.backdropFilter);
    if (backgroundBlurs.length) {
      node.effects = [
        ...(Array.isArray(node.effects) ? node.effects : []),
        ...backgroundBlurs.map(radius => ({ type: "BACKGROUND_BLUR", radius, visible: true })),
      ];
    }
  }
  if (scene.computedStyles?.mixBlendMode && "blendMode" in node) node.blendMode = blendModeValue(scene.computedStyles.mixBlendMode);
  if ("clipsContent" in node) {
    const overflowValues = [
      scene.overflow,
      scene.computedStyles?.overflow,
      scene.computedStyles?.overflowX,
      scene.computedStyles?.overflowY,
    ].map(value => String(value || "").toLowerCase());
    node.clipsContent = overflowValues.some(value => value === "hidden" || value === "clip");
  }
}

function applyStrokePattern(node, scene) {
  if (!("dashPattern" in node)) return;
  const borders = scene.borders || [];
  const style = (scene.stroke && scene.stroke.style) || borders.find(Boolean)?.style || "solid";
  if (style === "dashed") node.dashPattern = [6, 4];
  else if (style === "dotted") node.dashPattern = [1, 3];
  else node.dashPattern = [];
}

function mixBorderColor(value, amount) {
  const parsed = parseColor(value);
  if (!parsed) return null;
  const target = amount >= 0 ? 1 : 0;
  const ratio = Math.min(1, Math.abs(amount));
  return {
    color: {
      r: parsed.color.r + (target - parsed.color.r) * ratio,
      g: parsed.color.g + (target - parsed.color.g) * ratio,
      b: parsed.color.b + (target - parsed.color.b) * ratio,
    },
    opacity: parsed.opacity,
  };
}

function createBorderRect(parent, name, x, y, width, height, color) {
  if (!parent || typeof figma.createRectangle !== "function" || width <= 0 || height <= 0 || !color) return;
  const rect = figma.createRectangle();
  const parentUsesAutoLayout = "layoutMode" in parent && parent.layoutMode !== "NONE";
  rect.name = name;
  rect.resize(Math.max(1, width), Math.max(1, height));
  if ("fills" in rect) rect.fills = [{ type: "SOLID", color: color.color, opacity: color.opacity }];
  if ("strokes" in rect) rect.strokes = [];
  // Figma only accepts ABSOLUTE children inside an Auto Layout parent. A
  // regular frame still supports the same visual result through x/y, so keep
  // its decoration in normal flow instead of aborting the whole import.
  if ("x" in rect) rect.x = x;
  if ("y" in rect) rect.y = y;
  parent.appendChild(rect);
  // Parent-dependent properties are valid only after insertion.
  if (parentUsesAutoLayout && "layoutPositioning" in rect) rect.layoutPositioning = "ABSOLUTE";
  if ("layoutSizingHorizontal" in rect) rect.layoutSizingHorizontal = "FIXED";
  if ("layoutSizingVertical" in rect) rect.layoutSizingVertical = "FIXED";
}

function createBorderDecorations(node, scene) {
  if (!node || !scene?.borders?.some(Boolean) || typeof figma.createRectangle !== "function") return;
  const borders = scene.borders;
  const style = borders.find(Boolean)?.style || "solid";
  const widths = borders.map(border => Number(border?.width || 0));
  const colors = borders.map(border => String(border?.color || ""));
  const asymmetric = widths.some(width => width !== widths[0]) || colors.some(color => color !== colors[0]);
  const flatAsymmetric = asymmetric && borders.every(border => !border || border.style === "solid");
  if (style !== "outset" && style !== "inset" && style !== "double" && !flatAsymmetric) return;
  if ("strokes" in node) node.strokes = [];
  const width = Number(node.width || scene.rect?.width || 0);
  const height = Number(node.height || scene.rect?.height || 0);
  if (width <= 0 || height <= 0) return;
  const top = Math.max(0, Number(borders[0]?.width || 0));
  const right = Math.max(0, Number(borders[1]?.width || 0));
  const bottom = Math.max(0, Number(borders[2]?.width || 0));
  const left = Math.max(0, Number(borders[3]?.width || 0));
  const color = (side, amount = 0) => mixBorderColor(side?.color, amount) || parseColor(side?.color);
  const light = 0.42;
  const dark = -0.42;
  const topColor = style === "solid" ? color(borders[0]) : color(borders[0], style === "inset" ? dark : light);
  const leftColor = style === "solid" ? color(borders[3]) : color(borders[3], style === "inset" ? dark : light);
  const bottomColor = style === "solid" ? color(borders[2]) : color(borders[2], style === "inset" ? light : dark);
  const rightColor = style === "solid" ? color(borders[1]) : color(borders[1], style === "inset" ? light : dark);
  if (style === "double") {
    const topLine = Math.max(1, Math.floor(top / 3));
    const leftLine = Math.max(1, Math.floor(left / 3));
    const bottomLine = Math.max(1, Math.floor(bottom / 3));
    const rightLine = Math.max(1, Math.floor(right / 3));
    createBorderRect(node, "__css-border-top-outer", 0, 0, width, topLine, topColor);
    createBorderRect(node, "__css-border-top-inner", 0, top - topLine, width, topLine, topColor);
    createBorderRect(node, "__css-border-left-outer", 0, top, leftLine, Math.max(0, height - top - bottom), leftColor);
    createBorderRect(node, "__css-border-left-inner", left - leftLine, top, leftLine, Math.max(0, height - top - bottom), leftColor);
    createBorderRect(node, "__css-border-bottom-outer", 0, height - bottom, width, bottomLine, bottomColor);
    createBorderRect(node, "__css-border-bottom-inner", 0, height - bottom + bottomLine, width, bottomLine, bottomColor);
    createBorderRect(node, "__css-border-right-outer", width - right, top, rightLine, Math.max(0, height - top - bottom), rightColor);
    createBorderRect(node, "__css-border-right-inner", width - right + rightLine, top, rightLine, Math.max(0, height - top - bottom), rightColor);
    return;
  }
  createBorderRect(node, "__css-border-top", 0, 0, width, top, topColor);
  createBorderRect(node, "__css-border-right", width - right, top, right, Math.max(0, height - top - bottom), rightColor);
  createBorderRect(node, "__css-border-bottom", 0, height - bottom, width, bottom, bottomColor);
  createBorderRect(node, "__css-border-left", 0, top, left, Math.max(0, height - top - bottom), leftColor);
}

function blendModeValue(value) {
  const map = {
    multiply: "MULTIPLY", screen: "SCREEN", overlay: "OVERLAY", darken: "DARKEN", lighten: "LIGHTEN",
    "color-dodge": "COLOR_DODGE", "color-burn": "COLOR_BURN", "hard-light": "HARD_LIGHT", "soft-light": "SOFT_LIGHT",
    difference: "DIFFERENCE", exclusion: "EXCLUSION", hue: "HUE", saturation: "SATURATION", color: "COLOR", luminosity: "LUMINOSITY",
  };
  return map[value] || "NORMAL";
}

function transformMatrix(value) {
  if (!value || value === "none") return null;
  const parseNumber = token => Number.parseFloat(String(token || "").trim());
  const parseLength = token => {
    const parsed = parseNumber(token);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const multiply = (left, right) => {
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
  const functionPattern = /([a-z0-9]+)\(([^)]*)\)/gi;
  const functions = [];
  let match;
  while ((match = functionPattern.exec(String(value)))) functions.push({ name: match[1].toLowerCase(), args: splitCssArguments(match[2].replace(/\s*,\s*/g, ",")) });
  if (!functions.length) return null;
  let result = [1, 0, 0, 1, 0, 0];
  for (const entry of functions) {
    const args = entry.args.length === 1 && /\s+/.test(entry.args[0])
      ? entry.args[0].trim().split(/\s+/)
      : entry.args;
    let current = null;
    if (entry.name === "matrix" && args.length === 6) current = args.map(parseNumber);
    else if (entry.name === "matrix3d" && args.length === 16) {
      const values = args.map(parseNumber);
      current = [values[0], values[1], values[4], values[5], values[12], values[13]];
    } else if (entry.name === "translate" || entry.name === "translate3d") {
      current = [1, 0, 0, 1, parseLength(args[0]), parseLength(args[1])];
    } else if (entry.name === "translatex") current = [1, 0, 0, 1, parseLength(args[0]), 0];
    else if (entry.name === "translatey") current = [1, 0, 0, 1, 0, parseLength(args[0])];
    else if (entry.name === "scale" || entry.name === "scale3d") {
      const sx = parseNumber(args[0]);
      const sy = Number.isFinite(parseNumber(args[1])) ? parseNumber(args[1]) : sx;
      current = [sx, 0, 0, sy, 0, 0];
    } else if (entry.name === "scalex") current = [parseNumber(args[0]), 0, 0, 1, 0, 0];
    else if (entry.name === "scaley") current = [1, 0, 0, parseNumber(args[0]), 0, 0];
    else if (["rotate", "rotatez"].includes(entry.name)) {
      const radians = parseNumber(args[0]) * Math.PI / 180;
      current = [Math.cos(radians), Math.sin(radians), -Math.sin(radians), Math.cos(radians), 0, 0];
    } else if (entry.name === "skewx") {
      current = [1, 0, Math.tan(parseNumber(args[0]) * Math.PI / 180), 1, 0, 0];
    } else if (entry.name === "skewy") {
      current = [1, Math.tan(parseNumber(args[0]) * Math.PI / 180), 0, 1, 0, 0];
    }
    if (current && current.every(Number.isFinite)) result = multiply(result, current);
  }
  return result.every(Number.isFinite) ? result : null;
}

function transformOrigin(value, width, height) {
  const parts = String(value || "50% 50%").split(/\s+/);
  const resolve = (part, size) => {
    const normalized = String(part || "").toLowerCase();
    if (normalized === "left" || normalized === "top") return 0;
    if (normalized === "center") return size / 2;
    if (normalized === "right" || normalized === "bottom") return size;
    return normalized.endsWith("%") ? Number.parseFloat(normalized) * size / 100 : numberValue(normalized, size / 2);
  };
  return { x: resolve(parts[0], width), y: resolve(parts[1] || "50%", height) };
}

function applyTransform(node, scene) {
  const matrix = transformMatrix(scene.transform);
  if (!matrix) return;
  const [a, b, c, d, e, f] = matrix;
  const origin = transformOrigin(scene.transformOrigin, scene.rect?.width || node.width || 0, scene.rect?.height || node.height || 0);
  const tx = e + origin.x - a * origin.x - c * origin.y;
  const ty = f + origin.y - b * origin.x - d * origin.y;
  if ("relativeTransform" in node) {
    try {
      node.relativeTransform = [[a, c, tx], [b, d, ty]];
      return;
    } catch {
      // Fall back to the rotation/translation properties below when a host
      // Figma runtime rejects a matrix for a particular node type.
    }
  }
  if (Math.abs(a - d) < 0.0001 && Math.abs(b + c) < 0.0001 && Math.abs(a * a + b * b - 1) < 0.0001 && "rotation" in node) {
    node.rotation = Math.atan2(b, a) * 180 / Math.PI;
  }
  if ("x" in node) node.x += tx;
  if ("y" in node) node.y += ty;
}

function fontStyleForWeight(weight, italic) {
  let style = weight >= 900 ? "Black"
    : weight >= 800 ? "Extra Bold"
      : weight >= 700 ? "Bold"
        : weight >= 600 ? "Semi Bold"
          : weight >= 500 ? "Medium"
            : weight >= 400 ? "Regular"
              : weight >= 300 ? "Light"
                : weight >= 200 ? "Extra Light"
                  : "Thin";
  if (italic) style += " Italic";
  return style;
}

function fontFamilyCandidates(value) {
  return String(value || "Inter")
    .split(",")
    .map(family => family.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

function fontStyleCandidates(weight, italic) {
  const base = fontStyleForWeight(weight, false);
  const aliases = {
    "Black": ["Black", "Heavy", "Bold"],
    "Extra Bold": ["Extra Bold", "ExtraBold", "Extrabold", "Ultra Bold", "UltraBold", "Bold"],
    "Semi Bold": ["Semi Bold", "SemiBold", "Semibold", "Demi Bold", "DemiBold", "Bold", "Medium"],
    "Bold": ["Bold", "Semi Bold", "SemiBold", "Medium"],
    "Medium": ["Medium", "Regular", "Book"],
    "Regular": ["Regular", "Book", "Normal", "Roman"],
    "Light": ["Light", "Book", "Regular"],
    "Extra Light": ["Extra Light", "ExtraLight", "Extralight", "Ultra Light", "UltraLight"],
  };
  const names = aliases[base] || [base];
  const styles = italic
    ? names.flatMap(name => [`${name} Italic`, `${name}Italic`])
    : names;
  if (italic) styles.push("Italic");
  return [...new Set(styles)];
}

const sceneFontCache = new Map();
let availableFontIndexPromise;
// Missing CSS fallback families can leave Figma's font loader pending. Font
// resolution is best-effort during import, so keep each probe short enough
// that one unavailable family cannot make the whole paste appear stuck.
const FONT_LOAD_TIMEOUT_MS = 300;
const MAX_FONT_FAMILIES_TO_PROBE = 3;
const MAX_FONT_STYLES_TO_PROBE = 4;

const GENERIC_FONT_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded", "math",
  "emoji", "fangsong",
]);

async function loadFontWithTimeout(font) {
  // A desktop Figma build can leave loadFontAsync pending when a CSS fallback
  // family is not installed. Do not let one unresolved candidate block the
  // whole scene import; the text layer will use the next candidate instead.
  return Promise.race([
    figma.loadFontAsync(font).then(() => true).catch(() => false),
    new Promise(resolve => setTimeout(() => resolve(false), FONT_LOAD_TIMEOUT_MS)),
  ]);
}

async function availableFontIndex() {
  if (typeof figma.listAvailableFontsAsync !== "function") return null;
  if (!availableFontIndexPromise) {
    availableFontIndexPromise = figma.listAvailableFontsAsync()
      .then((fonts) => {
        const index = new Map();
        for (const entry of fonts || []) {
          const fontName = entry?.fontName;
          if (!fontName?.family || !fontName?.style) continue;
          const key = fontName.family.toLowerCase();
          if (!index.has(key)) index.set(key, []);
          index.get(key).push(fontName);
        }
        return index;
      })
      .catch(() => null);
  }
  return availableFontIndexPromise;
}

async function loadSceneFont(text) {
  const requestedFamilies = fontFamilyCandidates(text?.fontFamily);
  const families = requestedFamilies
    .filter(family => !GENERIC_FONT_FAMILIES.has(family.toLowerCase()))
    .slice(0, MAX_FONT_FAMILIES_TO_PROBE);
  if (!families.some(family => family.toLowerCase() === "inter")) families.push("Inter");
  const styles = fontStyleCandidates(text?.fontWeight || 400, text?.fontStyle === "italic" || text?.fontStyle === "oblique")
    .slice(0, MAX_FONT_STYLES_TO_PROBE);
  const available = await availableFontIndex();
  for (const family of families) {
    const installed = available?.get(family.toLowerCase());
    // Installed metadata is cheap to inspect, so consider every compatible
    // alias (for example Arial Bold for CSS weight 800). The probe cap exists
    // only for runtimes that cannot list fonts, where a missing family can
    // leave loadFontAsync pending.
    const candidates = installed
      ? fontStyleCandidates(text?.fontWeight || 400, text?.fontStyle === "italic" || text?.fontStyle === "oblique")
        .map(style => installed.find(font => font.style.toLowerCase() === style.toLowerCase()))
        .filter(Boolean)
      : styles.map(style => ({ family, style }));
    for (const font of candidates) {
      const key = `${font.family}\u0000${font.style}`;
      const cached = sceneFontCache.get(key);
      if (cached === true) return { ...font, fallback: font.family.toLowerCase() !== families[0].toLowerCase() };
      if (cached === false) continue;
      if (await loadFontWithTimeout(font)) {
        sceneFontCache.set(key, true);
        return { ...font, fallback: font.family.toLowerCase() !== families[0].toLowerCase() };
      }
      sceneFontCache.set(key, false);
    }
  }
  // Inter is available in standard Figma documents and is a safer final
  // fallback than assigning an unloaded font name to a text node.
  const fallbackKey = "Inter\u0000Regular";
  if (sceneFontCache.get(fallbackKey) === true || await loadFontWithTimeout({ family: "Inter", style: "Regular" })) {
    sceneFontCache.set(fallbackKey, true);
    return { family: "Inter", style: "Regular", fallback: true };
  }
  sceneFontCache.set(fallbackKey, false);
  return { family: families[0] || "Inter", style: "Regular", fallback: true };
}

// The capture stage records browser line transitions as explicit newline
// characters. Keep the captured text box and authored letter spacing intact;
// deriving spacing from Figma's single-line intrinsic width changes the CSS
// style itself and is especially visible in headings and CJK text.
function fitTextToCapturedLines(node, scene) {
  const expectedLines = Number(scene?.text?.lineCount || 0);
  const targetWidth = Number(scene?.rect?.width || 0);
  if (!node || node.type !== "TEXT" || expectedLines < 2 || targetWidth <= 0) return;
  try {
    // `NONE` is the only mode that preserves both axes from the browser
    // capture. The explicit line breaks remain editable and prevent Figma's
    // font metrics from inventing an extra wrap line.
    node.textAutoResize = "NONE";
    node.resize(Math.max(1, targetWidth), Math.max(1, Number(scene?.rect?.height || node.height || 1)));
  } catch {
    // Some host test doubles and older plugin runtimes expose text sizing as
    // read-only. The caller already applies the captured dimensions once.
  }
}

function sceneChildren(node) {
  return (node.children || []).filter(child => child
    && !String(child.name || "").startsWith("__css-margin-spacer")
    && !String(child.name || "").startsWith("__css-margin-flow")
    && !String(child.name || "").startsWith("__css-geometry-flow")
    && !String(child.name || "").startsWith("__css-border-"));
}

function orderedSceneChildren(scene) {
  const entries = (scene?.children || []).map((child, index) => ({ child, index }));
  const childOrder = ({ child }) => Number.isFinite(Number(child?.layout?.order))
    ? Number(child.layout.order)
    : 0;
  if (entries.some((entry) => childOrder(entry) !== 0)) {
    entries.sort((left, right) => childOrder(left) - childOrder(right) || left.index - right.index);
  }
  if (scene?.layout?.reverse) entries.reverse();
  return entries.map(({ child }) => child);
}

function sceneChildNode(parent, childScene, index) {
  const children = sceneChildren(parent);
  // Positioned layers can be reordered for CSS stacking after creation. Match
  // by the stable scene id first so later geometry passes never apply a
  // child's captured coordinates to a sibling that moved across the stack.
  const named = children.find(child => child.name === childScene?.id);
  return named || children[index];
}

function reorderPositionedChildren(parent, scene) {
  if (!parent || !scene || typeof parent.insertChild !== "function") return;
  const allChildren = Array.from(parent.children || []);
  const actualChildren = sceneChildren(parent);
  const entries = (scene.children || []).map((childScene, index) => ({
    childScene,
    // Shared-scene imports may reverse or order flex children before they are
    // appended. Resolve by stable id so stacking correction never associates
    // a positioned layer with the wrong sibling after that reorder.
    node: actualChildren.find(candidate => candidate.name === childScene?.id) || actualChildren[index],
    index,
  })).filter(entry => entry.node);
  const positioned = entries.filter(({ childScene }) => {
    const layout = childScene.layout || {};
    return layout.position === "absolute"
      || childScene.positioning === "absolute"
      || childScene.positioning === "fixed"
      || childScene.positioning === "sticky"
      || Number.isFinite(Number(childScene.zIndex));
  });
  if (!positioned.length) return;

  const flow = entries
    .filter(entry => !positioned.includes(entry))
    .sort((left, right) => actualChildren.indexOf(left.node) - actualChildren.indexOf(right.node));
  const zIndex = (entry) => Number.isFinite(Number(entry.childScene.zIndex)) ? Number(entry.childScene.zIndex) : 0;
  const flowRank = (entry) => zIndex(entry);
  const ordered = flow.slice();
  positioned
    .slice()
    .sort((left, right) => zIndex(left) - zIndex(right) || left.index - right.index)
    .forEach((entry) => {
      // Keep normal-flow children in their captured Auto Layout order. Insert
      // only the positioned layer before the first flow layer with a higher
      // paint rank; this fixes pseudo-element stacking without reflowing text.
      const target = ordered.find(candidate => flowRank(candidate) > zIndex(entry));
      const targetIndex = target ? ordered.indexOf(target) : ordered.length;
      ordered.splice(targetIndex, 0, entry);
    });

  // `parent.children` also contains invisible margin spacers and flow
  // placeholders created during import. The scene-only index above must not
  // be passed directly to insertChild: doing so can move a positioned node
  // across a placeholder and change Auto Layout's measured flow. Build the
  // final full child sequence by replacing only the slots occupied by real
  // scene nodes, then apply that sequence with full-child indices.
  const sceneNodes = new Set(actualChildren);
  let orderedIndex = 0;
  const targetChildren = allChildren.map((child) => {
    if (!sceneNodes.has(child)) return child;
    const next = ordered[orderedIndex];
    orderedIndex += 1;
    return next ? next.node : child;
  });

  targetChildren.forEach((child, index) => {
    const currentIndex = Array.from(parent.children || []).indexOf(child);
    if (currentIndex >= 0 && currentIndex !== index) parent.insertChild(index, child);
  });
}

function createMarginSpacer(parent, size, axis, before, index) {
  if (!parent || !size || size <= 0 || typeof figma.createFrame !== "function") return null;
  const spacer = figma.createFrame();
  spacer.name = `__css-margin-spacer${before ? "-before" : "-after"}-${index}`;
  spacer.fills = [];
  spacer.strokes = [];
  spacer.opacity = 0;
  if (axis === "vertical") {
    spacer.resize(Math.max(1, parent.width || 1), Math.max(1, size));
  } else {
    spacer.resize(Math.max(1, size), Math.max(1, parent.height || 1));
  }
  if ("layoutMode" in spacer) spacer.layoutMode = "NONE";
  parent.appendChild(spacer);
  if ("layoutSizingHorizontal" in spacer) spacer.layoutSizingHorizontal = axis === "vertical" ? "FILL" : "FIXED";
  if ("layoutSizingVertical" in spacer) spacer.layoutSizingVertical = axis === "vertical" ? "FIXED" : "FILL";
  if ("layoutAlign" in spacer) spacer.layoutAlign = "STRETCH";
  return spacer;
}

function createMarginFlowPlaceholder(parent, node, axis, index, crossExtra = 0) {
  if (!parent || !node || typeof figma.createFrame !== "function") return null;
  const placeholder = figma.createFrame();
  placeholder.name = `__css-margin-flow-${index}`;
  placeholder.fills = [];
  placeholder.strokes = [];
  placeholder.opacity = 0;
  // A flow slot must preserve the captured item's cross-axis footprint. Using
  // the parent's size with FILL makes a horizontal wrapped row as tall as the
  // whole container (and similarly stretches vertical rows), which shifts
  // every later line. The visible item is already measured, so keep both axes
  // fixed and let the parent retain its own alignment semantics.
  const crossSize = Math.max(0, Number(crossExtra) || 0);
  placeholder.resize(
    Math.max(1, (node.width || 1) + (axis === "vertical" ? crossSize : 0)),
    Math.max(1, (node.height || 1) + (axis === "horizontal" ? crossSize : 0)),
  );
  // If the visible node is already attached, insert the slot immediately
  // before it. This preserves the captured flow position even though the
  // visible layer itself is absolute in Figma. The append fallback is kept
  // for callers that intentionally create a placeholder before attachment.
  const nodeIndex = Array.from(parent.children || []).indexOf(node);
  if (nodeIndex >= 0 && typeof parent.insertChild === "function") parent.insertChild(nodeIndex, placeholder);
  else parent.appendChild(placeholder);
  if ("layoutSizingHorizontal" in placeholder) placeholder.layoutSizingHorizontal = "FIXED";
  if ("layoutSizingVertical" in placeholder) placeholder.layoutSizingVertical = "FIXED";
  if ("layoutAlign" in placeholder) placeholder.layoutAlign = "INHERIT";
  return placeholder;
}

function createMeasuredFlowPlaceholder(parent, node, axis, index, crossExtra = 0) {
  if (!parent || !node || typeof figma.createFrame !== "function") return null;
  const marker = `__css-geometry-flow-${index}`;
  const existing = Array.from(parent.children || []).find((child) => child.name === marker);
  if (existing) return existing;

  const placeholder = figma.createFrame();
  placeholder.name = marker;
  placeholder.fills = [];
  placeholder.strokes = [];
  placeholder.opacity = 0;
  // This placeholder represents one measured child, not a full cross-axis
  // track. Keeping the exact child box prevents it from changing wrap line
  // heights or the parent's counter-axis distribution.
  const crossSize = Math.max(0, Number(crossExtra) || 0);
  placeholder.resize(
    Math.max(1, (node.width || 1) + (axis === "vertical" ? crossSize : 0)),
    Math.max(1, (node.height || 1) + (axis === "horizontal" ? crossSize : 0)),
  );
  // Insert the placeholder at the visible node's current flow slot. Appending
  // it would preserve the size but move the slot to the end of the parent,
  // changing both the Auto Layout order and the paint order of later siblings.
  const nodeIndex = Array.from(parent.children || []).indexOf(node);
  if (nodeIndex >= 0 && typeof parent.insertChild === "function") parent.insertChild(nodeIndex, placeholder);
  else parent.appendChild(placeholder);
  if ("layoutSizingHorizontal" in placeholder) placeholder.layoutSizingHorizontal = "FIXED";
  if ("layoutSizingVertical" in placeholder) placeholder.layoutSizingVertical = "FIXED";
  if ("layoutAlign" in placeholder) placeholder.layoutAlign = "INHERIT";
  return placeholder;
}

function marginForAutoLayout(scene, parent) {
  const margin = scene.margin || [0, 0, 0, 0];
  const mode = parent?.layoutMode === "HORIZONTAL" ? "horizontal" : parent?.layoutMode === "VERTICAL" ? "vertical" : "none";
  if (mode === "none") return { mode, before: 0, after: 0, crossStart: 0, crossEnd: 0 };
  return mode === "vertical"
    ? { mode, before: margin[0] || 0, after: margin[2] || 0, crossStart: margin[3] || 0, crossEnd: margin[1] || 0 }
    : { mode, before: margin[3] || 0, after: margin[1] || 0, crossStart: margin[0] || 0, crossEnd: margin[2] || 0 };
}

function crossMarginExtent(scene, axis) {
  const margin = scene?.margin || [0, 0, 0, 0];
  // The main-axis margin is already represented by margin spacers. Only the
  // counter-axis extent belongs in a measured flow slot (and affects wrapped
  // line/column sizing).
  return axis === "horizontal"
    ? (margin[0] || 0) + (margin[2] || 0)
    : axis === "vertical"
      ? (margin[1] || 0) + (margin[3] || 0)
      : 0;
}

function flowAxisGap(parentScene) {
  const layout = parentScene?.layout || {};
  return layout.mode === "horizontal"
    ? Number(layout.columnGap ?? layout.gap ?? 0)
    : layout.mode === "vertical"
      ? Number(layout.rowGap ?? layout.gap ?? 0)
      : 0;
}

function marginSpacerSize(value, parentScene) {
  const size = Math.max(0, Number(value) || 0);
  // A spacer is a real Auto Layout child. The parent contributes one
  // itemSpacing between the visible node and its spacer, while CSS margins
  // already coexist with the one flex gap between adjacent items. Subtract
  // that one synthetic gap so a margin edge does not become margin + 2*gap.
  return Math.max(0, size - Math.max(0, flowAxisGap(parentScene)));
}

function applyLayout(node, scene) {
  const layout = scene.layout || {};
  if ("layoutMode" in node) {
    node.layoutMode = layout.mode === "horizontal" ? "HORIZONTAL" : layout.mode === "vertical" ? "VERTICAL" : "NONE";
    if (node.layoutMode !== "NONE") {
      node.itemSpacing = (layout.mode === "horizontal" ? layout.columnGap : layout.rowGap) ?? layout.gap ?? 0;
      // Figma's SPACE_BETWEEN does not match CSS space-around/evenly: it has
      // no half/edge spacing model. Those distributions are marked for
      // measured child locks by the capture layer, so keep the parent at MIN
      // instead of introducing a second, incorrect spacing pass.
      node.primaryAxisAlignItems = layout.justifyContent === "center" ? "CENTER" : layout.justifyContent === "end" ? "MAX" : layout.justifyContent === "space-between" ? "SPACE_BETWEEN" : "MIN";
      // Figma has no stretch value for the counter axis. Stretch is applied
      // per child with layoutAlign below; BASELINE would visibly shift mixed
      // text and icon rows.
      node.counterAxisAlignItems = layout.alignItems === "center" ? "CENTER" : layout.alignItems === "end" ? "MAX" : "MIN";
      const wrapping = layout.wrap === true;
      if ("layoutWrap" in node) {
        try { node.layoutWrap = wrapping ? "WRAP" : "NO_WRAP"; } catch { /* optional API */ }
      }
      // Figma separates the primary-axis spacing from the spacing between
      // wrapped lines. CSS `row-gap` is the cross-axis gap for a horizontal
      // wrap, while `column-gap` is the cross-axis gap for a vertical wrap.
      // The Figma API rejects writes to counterAxisSpacing while wrapping is
      // disabled. Only apply the cross-axis gap for an actual wrapped track,
      // and keep the write guarded for older runtimes.
      if (wrapping && "counterAxisSpacing" in node) {
        try {
          node.counterAxisSpacing = layout.mode === "horizontal"
            ? (layout.rowGap ?? layout.gap ?? 0)
            : (layout.columnGap ?? layout.gap ?? 0);
        } catch { /* optional API */ }
      }
      // Figma exposes only AUTO and SPACE_BETWEEN for wrapped track
      // distribution. AUTO matches CSS start/center/end through
      // counterAxisAlignItems; SPACE_BETWEEN is the closest native mapping
      // for CSS align-content: space-between.
      if (wrapping && "counterAxisAlignContent" in node) {
        try {
          node.counterAxisAlignContent = layout.alignContent === "space-between" ? "SPACE_BETWEEN" : "AUTO";
        } catch { /* optional API */ }
      }
    }
  }
  // `layoutAlign` describes how this node participates in its *parent's*
  // Auto Layout. The node's own `alignItems` only describes its children and
  // must not be copied here. The parent-aware assignment lives in
  // `createNode`, where `parentScene.layout.alignItems` and this node's
  // `layout.alignSelf` are both available.
}

function resolveSizingConstraint(raw, axis, parentScene) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value || value === "none" || value === "auto" || value === "max-content" || value === "fit-content") return null;
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  if (!value.endsWith("%")) return parsed;
  const parentRect = parentScene?.rect;
  if (!parentRect) return null;
  const padding = parentScene.layout?.padding || [0, 0, 0, 0];
  const available = axis === "width"
    ? Number(parentRect.width || 0) - Number(padding[1] || 0) - Number(padding[3] || 0)
    : Number(parentRect.height || 0) - Number(padding[0] || 0) - Number(padding[2] || 0);
  return available > 0 ? available * parsed / 100 : null;
}

function applySizingConstraints(node, scene, parentScene) {
  if (!node || !scene) return;
  const styles = scene.computedStyles || {};
  const constraints = [
    ["minWidth", "width", styles.minWidth],
    ["maxWidth", "width", styles.maxWidth],
    ["minHeight", "height", styles.minHeight],
    ["maxHeight", "height", styles.maxHeight],
  ];
  for (const [property, axis, raw] of constraints) {
    if (!(property in node)) continue;
    const parsed = resolveSizingConstraint(raw, axis, parentScene);
    if (parsed == null) continue;
    try { node[property] = parsed; } catch { /* optional Figma API */ }
  }
}

function recordSceneDegradations(scene, report) {
  if (!report || !scene) return;
  const styles = scene.computedStyles || {};
  const unsupported = [
    ["font-stretch", styles.fontStretch, "font stretch is not exposed by the Figma TextNode API"],
    ["font-variation-settings", styles.fontVariationSettings, "font variation axes are not exposed by the Figma TextNode API"],
    ["font-feature-settings", styles.fontFeatureSettings, "font feature settings are not exposed by the Figma TextNode API"],
    ["background-clip", styles.backgroundClip, "background clip is approximated by the Figma node bounds"],
  ];
  for (const [property, value, message] of unsupported) {
    if (!value || value === "normal" || value === "100%" || value === "border-box") continue;
    report.styleDegradations += 1;
    if (report.styleDegradationNodes.length < 100) report.styleDegradationNodes.push({ id: scene.id, message: `${property}: ${message}` });
  }
  const blendModes = backgroundBlendModes(styles.backgroundBlendMode);
  const unsupportedBlend = blendModes.find(mode => mode !== "normal" && blendModeValue(mode) === "NORMAL");
  if (unsupportedBlend) {
    report.styleDegradations += 1;
    if (report.styleDegradationNodes.length < 100) {
      report.styleDegradationNodes.push({
        id: scene.id,
        message: `background-blend-mode ${unsupportedBlend} is not supported by the native paint API`,
      });
    }
  }
  const borderStyles = (scene.borders || []).filter(Boolean).map(border => border.style || "solid");
  const unsupportedBorder = borderStyles.find(style => !["solid", "dashed", "dotted"].includes(style));
  if (unsupportedBorder) {
    report.styleDegradations += 1;
    if (report.styleDegradationNodes.length < 100) {
      report.styleDegradationNodes.push({
        id: scene.id,
        message: `border-style ${unsupportedBorder} is approximated with editable side layers`,
      });
    }
  }
}

function assetBytes(asset) {
  const encoded = asset?.blob?.base64Blob;
  // Official H2D stores a complete data URL in base64Blob. Accept the older
  // bare-payload form too so captures produced before this fix remain usable.
  const data = asset?.data || (encoded ? (encoded.startsWith("data:") ? encoded : `data:${asset.blob.type || "application/octet-stream"};base64,${encoded}`) : null);
  if (!data || !data.includes(",")) return null;
  const binary = atob(data.split(",", 2)[1]);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function assetList(assets) {
  return Array.isArray(assets) ? assets : Object.values(assets || {});
}

function mergeSceneAssets(sceneAssets, h2dAssets) {
  const primary = assetList(sceneAssets);
  const fallback = assetList(h2dAssets);
  if (!primary.length) return fallback;
  const fallbackById = new Map(fallback.map(asset => [asset.id, asset]));
  return primary.map(asset => {
    const fallbackAsset = fallbackById.get(asset.id);
    // The lossless scene marker intentionally carries the source URL and
    // stable id. Reuse the H2D blob when the scene marker omits binary data,
    // while preserving any data URL captured directly on the scene asset.
    return fallbackAsset ? { ...fallbackAsset, ...asset, data: asset.data || fallbackAsset.data } : asset;
  });
}

function numberValue(value, fallback) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : (fallback || 0);
}

function fontWeightValue(value, fallback = 400) {
  const normalized = String(value ?? "").trim().toLowerCase();
  const aliases = { normal: 400, bold: 700, lighter: 300, bolder: 700 };
  if (Object.prototype.hasOwnProperty.call(aliases, normalized)) return aliases[normalized];
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function cssColor(value) {
  return value && value !== "transparent" && value !== "rgba(0, 0, 0, 0)" ? { color: value } : undefined;
}

function cssRadius(styles) {
  return [
    numberValue(styles.borderTopLeftRadius, 0),
    numberValue(styles.borderTopRightRadius, 0),
    numberValue(styles.borderBottomRightRadius, 0),
    numberValue(styles.borderBottomLeftRadius, 0),
  ];
}

function cssShadow(value) {
  if (!value || value === "none") return undefined;
  const layer = splitCssArguments(value)[0] || String(value).trim();
  const colorValue = Array.from(layer.matchAll(/(?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}\b|\b(?:transparent|currentcolor|[a-z]+)\b/gi))
    .map(match => match[0])
    .find(candidate => candidate.toLowerCase() !== "inset") || "rgba(0,0,0,.18)";
  const withoutColor = colorValue ? layer.replace(colorValue, " ") : layer;
  const lengths = withoutColor.match(/-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)?/gi) || [];
  if (lengths.length < 3) return undefined;
  const parsedColor = parseColor(colorValue);
  const alpha = colorValue.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([\d.]+)\)/i);
  return {
    offsetX: numberValue(lengths[0], 0),
    offsetY: numberValue(lengths[1], 0),
    blur: numberValue(lengths[2], 0),
    spread: numberValue(lengths[3], 0),
    color: colorValue,
    opacity: parsedColor?.opacity ?? (alpha ? Number(alpha[1]) : 1),
    inset: /\binset\b/i.test(layer),
  };
}

function cssBorder(styles, side) {
  const width = numberValue(styles[`border${side}Width`], 0);
  const style = styles[`border${side}Style`] || "solid";
  if (width <= 0 || style === "none" || style === "hidden") return undefined;
  return {
    color: styles[`border${side}Color`],
    width,
    style,
  };
}

function cssShadows(value) {
  if (!value || value === "none") return [];
  const shadows = [];
  for (const layer of splitCssArguments(value)) {
    const parsed = cssShadow(layer);
    if (parsed) shadows.push(parsed);
  }
  return shadows;
}

function cssFilterShadows(value) {
  if (!value || value === "none") return [];
  const shadows = [];
  const pattern = /drop-shadow\(([^()]*(?:\([^)]*\)[^()]*)*)\)/gi;
  let match;
  while ((match = pattern.exec(value))) {
    const parsed = cssShadow(match[1]);
    if (parsed) shadows.push(parsed);
  }
  return shadows;
}

function cssFilterBlurs(value) {
  if (!value || value === "none") return [];
  const blurs = [];
  const pattern = /blur\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+))(?:px|pt|pc|in|cm|mm|q|em|rem|ex|ch|vw|vh|vmin|vmax|%)?\s*\)/gi;
  let match;
  while ((match = pattern.exec(value))) {
    const radius = Number.parseFloat(match[1]);
    if (Number.isFinite(radius) && radius > 0) blurs.push(radius);
  }
  return blurs;
}

function cssFilterHasUnsupportedParts(value, allowImageFilters = false) {
  if (!value || value === "none") return false;
  const stripped = String(value)
    .replace(/(?:blur|drop-shadow)\((?:[^()]|\([^()]*\))*\)/gi, "")
    .replace(allowImageFilters ? /(?:brightness|contrast|saturate)\((?:[^()]|\([^()]*\))*\)/gi : /$^/g, "")
    .replace(/\s+/g, "")
    .trim();
  return Boolean(stripped);
}

function cssImageFilters(value) {
  if (!value || value === "none") return null;
  const filters = {};
  const pattern = /\b(brightness|contrast|saturate)\(\s*(-?(?:\d+(?:\.\d*)?|\.\d+))%?\s*\)/gi;
  let match;
  while ((match = pattern.exec(String(value)))) {
    const name = match[1].toLowerCase() === "brightness" ? "exposure"
      : match[1].toLowerCase() === "saturate" ? "saturation"
        : "contrast";
    const raw = Number.parseFloat(match[2]);
    if (!Number.isFinite(raw)) continue;
    const factor = match[0].includes("%") ? raw / 100 : raw;
    const normalized = Math.round(Math.max(-1, Math.min(1, factor - 1)) * 10000) / 10000;
    filters[name] = normalized;
  }
  return Object.keys(filters).length ? filters : null;
}

function textChild(node) {
  return (node.childNodes || []).find(child => child && child.nodeType === 3);
}

function distributionSensitiveLayout(node) {
  const layout = node?.layout;
  if (!layout || layout.mode === "none") return false;
  const display = String(node.computedStyles?.display || "").toLowerCase();
  // Figma exposes equivalents for several CSS distributions, but its text
  // metrics and fractional rounding are not the browser's. A one-pixel
  // difference in a centered or space-between track moves every sibling and
  // becomes a large visual drift in nested layouts. Keep the parent as an
  // editable Auto Layout frame, while locking the visible children to the
  // measured browser rectangles and retaining invisible flow slots.
  return display === "grid"
    || display === "inline-grid"
    || layout.wrap === true
    || layout.reverse === true
    || layout.justifyContent === "center"
    || layout.justifyContent === "end"
    || layout.justifyContent === "space-between"
    || layout.justifyContent === "space-around"
    || layout.justifyContent === "space-evenly"
    || layout.alignContent === "center"
    || layout.alignContent === "end"
    || layout.alignContent === "space-between"
    || layout.alignContent === "space-around"
    || layout.alignContent === "space-evenly";
}

function mergeMeasuredGeometry(scene, _h2dRoot, options = {}) {
  if (!scene) return scene;
  // The native plugin can request a visual-lock import. In that mode the
  // shared scene still carries the authored Auto Layout metadata, but every
  // visible descendant keeps its browser-measured box. This is necessary for
  // 1:1 placement because Figma and the capture browser do not share font,
  // border-box, or fractional flex metrics.
  // `figh2d` is an official-browser visual snapshot. Its geometryLock flags
  // are deliberately synthetic and are not copied back into the native scene
  // when callers opt into the selective compatibility mode. The normal Canvas
  // import uses the explicit visual-lock mode below: it keeps measured
  // placement for a native import while retaining authored layout metadata on
  // every container.
  const merge = (node, parentNode, parentWasDistributionLocked = false, forceDirectChildLock = false) => {
    const sourceAbsolute = node.layout?.position === "absolute"
      || node.positioning === "absolute"
      || node.positioning === "fixed"
      || node.positioning === "sticky";
    const distributionLock = !parentWasDistributionLocked && distributionSensitiveLayout(parentNode);
    const rect = node.rect || { x: 0, y: 0, width: 0, height: 0 };
    const parentRect = parentNode?.rect;
    // A full-viewport shell can itself be centered by an outer wrapper while
    // its long vertical stack remains ordinary flow. Figma's font metrics can
    // then move every later section by the accumulated text delta. Lock only
    // the shell's direct sections when its captured border box fully covers
    // the parent; nested cards and ordinary full-width rows stay editable.
    const fullBleedVisualGroup = Boolean(
      node.layout?.geometryLock
      && node.layout.mode !== "none"
      && parentRect
      && Math.abs(rect.x || 0) <= GEOMETRY_EPSILON
      && Math.abs(rect.y || 0) <= GEOMETRY_EPSILON
      && rect.width >= (parentRect.width || 0) - SIZE_EPSILON
      && rect.height >= (parentRect.height || 0) - SIZE_EPSILON,
    ) || Boolean(
      // Once a full-bleed shell is locked, its large primary content stack is
      // the next place where browser/Figma text metrics can accumulate drift.
      // Propagate one level through a stack that spans the shell width and at
      // least half its height; short cards and rows remain normal Auto Layout.
      forceDirectChildLock
      && parentNode?.layout?.geometryLock
      && node.layout?.mode === "vertical"
      && parentRect
      && rect.width >= (parentRect.width || 0) - SIZE_EPSILON
      && rect.height >= (parentRect.height || 0) * 0.5,
    );
    const measured = Boolean(
      node.layout?.geometryLock
      || sourceAbsolute
      || node.layout?.alignSelf === "center"
      || node.layout?.alignSelf === "end"
      || distributionLock
      // `forceDirectChildLock` is only a propagation hint from the locked
      // shell. Apply it after checking the current node's size/layout so a
      // header, icon row, or text child does not inherit an absolute lock just
      // because it happens to be inside the same full-bleed viewport.
      || fullBleedVisualGroup,
    );
    // The snapshot marker describes the import root, not every nested frame.
    // Marking descendants as snapshots suppresses their own HUG/FILL restore
    // pass and leaves the whole tree permanently FIXED. Geometry locks remain
    // selective below for distribution-sensitive or explicitly positioned
    // children, while ordinary nested containers retain Auto Layout sizing.
    const visualSnapshot = Boolean(options.forceVisualLock && !parentNode);
    return {
      ...node,
      layout: {
        ...node.layout,
        ...(measured ? { geometryLock: true } : {}),
        // Keep authored Auto Layout frames in visual-snapshot imports. The
        // capture stage already marks the direct children whose browser
        // placement cannot be reproduced by Figma (wrapped, centered,
        // reversed, or explicitly positioned tracks). Do not broaden that
        // marker to every descendant here: turning ordinary text and card
        // children into absolute layers creates a placeholder for each one,
        // which makes padding and itemSpacing participate twice.
        ...(visualSnapshot ? { visualSnapshot: true } : {}),
      },
      // A synthetic geometry lock still occupies the source flow slot through
      // an invisible placeholder. Keep its original margin so the placeholder
      // preserves the distance to later siblings. Real CSS out-of-flow layers
      // already encode their inset in rect/x/y, so their margin must stay zero
      // to avoid applying that offset a second time.
      margin: sourceAbsolute
        ? [0, 0, 0, 0]
        : (node.margin ? [...node.margin] : node.margin),
      children: (node.children || []).map(child => merge(
        child,
        node,
        parentWasDistributionLocked || distributionLock,
        fullBleedVisualGroup,
      )),
    };
  };
  return merge(scene, undefined);
}

function promoteImportRoot(scene) {
  let root = scene;
  while (root?.type === "frame" && (root.sourceTag === "HTML" || root.sourceTag === "BODY")) {
    const children = root.children || [];
    if (children.length !== 1) break;
    const child = children[0];
    const rootRect = root.rect || {};
    const childRect = child?.rect || {};
    const fullWidth = Math.abs(Number(childRect.width || 0) - Number(rootRect.width || 0)) <= SIZE_EPSILON;
    const fullHeight = Math.abs(Number(childRect.height || 0) - Number(rootRect.height || 0)) <= SIZE_EPSILON;
    const sameOrigin = Math.abs(Number(childRect.x || 0)) <= GEOMETRY_EPSILON
      && Math.abs(Number(childRect.y || 0)) <= GEOMETRY_EPSILON;
    if (!child || !fullWidth || !fullHeight || !sameOrigin) break;
    root = child;
  }
  return root;
}

function wrapCrossAxisMargins(scene) {
  if (!scene) return scene;
  const wrapChildren = (parent) => {
    const parentMode = parent.layout?.mode;
    const children = (parent.children || []).map((child) => {
      const next = { ...child, children: wrapChildren(child) };
      const margin = Array.isArray(next.margin) ? next.margin : [0, 0, 0, 0];
      const sourceAbsolute = next.layout?.position === "absolute"
        || next.positioning === "absolute"
        || next.positioning === "fixed"
        || next.positioning === "sticky";
      const crossStart = parentMode === "vertical" ? Number(margin[3] || 0) : Number(margin[0] || 0);
      const crossEnd = parentMode === "vertical" ? Number(margin[1] || 0) : Number(margin[2] || 0);
      if ((parentMode !== "vertical" && parentMode !== "horizontal")
        || sourceAbsolute
        || (crossStart <= GEOMETRY_EPSILON && crossEnd <= GEOMETRY_EPSILON)) {
        return next;
      }

      const rect = next.rect || { x: 0, y: 0, width: 0, height: 0 };
      const verticalParent = parentMode === "vertical";
      const wrapperRect = verticalParent
        ? { x: rect.x - crossStart, y: rect.y, width: rect.width + crossStart + crossEnd, height: rect.height }
        : { x: rect.x, y: rect.y - crossStart, width: rect.width, height: rect.height + crossStart + crossEnd };
      const childRect = verticalParent
        ? { ...rect, x: crossStart, y: 0 }
        : { ...rect, x: 0, y: crossStart };
      const mainMargin = verticalParent
        ? [margin[0] || 0, 0, margin[2] || 0, 0]
        : [0, margin[1] || 0, 0, margin[3] || 0];

      return {
        id: `__css-cross-margin-${next.id}`,
        type: "frame",
        sourceTag: "CSS_MARGIN_WRAPPER",
        rect: wrapperRect,
        opacity: 1,
        radius: [0, 0, 0, 0],
        margin: mainMargin,
        layout: {
          mode: verticalParent ? "horizontal" : "vertical",
          gap: 0,
          rowGap: 0,
          columnGap: 0,
          padding: verticalParent
            ? [0, crossEnd, 0, crossStart]
            : [crossStart, 0, crossEnd, 0],
          alignItems: "stretch",
          justifyContent: "start",
          position: "flow",
          widthMode: next.layout?.widthMode || "fixed",
          heightMode: next.layout?.heightMode || "fixed",
        },
        children: [{
          ...next,
          rect: childRect,
          margin: [0, 0, 0, 0],
          layout: {
            ...next.layout,
            alignSelf: "stretch",
            widthMode: verticalParent ? "fill" : next.layout?.widthMode,
            heightMode: verticalParent ? next.layout?.heightMode : "fill",
          },
        }],
      };
    });
    return children;
  };
  return { ...scene, children: wrapChildren(scene) };
}

// The clipboard contains the browser-facing H2D shape. Convert it once at
// the plugin boundary so the rest of the importer can operate on the shared
// scene model and use parent-relative coordinates.
function sceneFromH2D(node, parentRect) {
  // H2D keeps source declarations and computed values separately. Normalized
  // styles win, while computed values fill gaps for inherited/variable CSS.
  const styles = { ...(node.computedStyles || {}), ...(node.styles || {}) };
  const isGrid = styles.display === "grid" || styles.display === "inline-grid";
  const absoluteRect = node.rect || { x: 0, y: 0, width: 0, height: 0 };
  const rect = {
    x: absoluteRect.x - (parentRect?.x || 0),
    y: absoluteRect.y - (parentRect?.y || 0),
    width: absoluteRect.width,
    height: absoluteRect.height,
  };
  const tag = String(node.tag || "DIV").toUpperCase();
  // Official H2D normally stores text in a TEXT_NODE child. A few older
  // bridge versions emitted a text-only element with its content field
  // populated instead. Accept both forms so a valid clipboard payload cannot
  // turn into an empty editable text layer in the native plugin.
  const rawText = textChild(node) || (tag !== "SVG" && typeof node.content === "string"
    ? { nodeType: 3, id: `${node.id || "node"}-text`, text: node.content, rect: absoluteRect, lineCount: 1 }
    : undefined);
  const pseudoElementChildren = [
    node.pseudoElementNodes?.before ? { ...node.pseudoElementNodes.before, __pseudoRole: "before" } : null,
    node.pseudoElementNodes?.after ? { ...node.pseudoElementNodes.after, __pseudoRole: "after" } : null,
  ].filter(Boolean);
  const elementChildren = [...pseudoElementChildren, ...(node.childNodes || [])]
    .filter(child => child && child.nodeType === 1);
  const hasPadding = ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft"]
    .some(property => numberValue(styles[property], 0) > 0.01);
  // A direct text child does not make an element a text layer by itself.
  // Buttons, badges, and other painted containers commonly contain only a
  // text node; flattening them into a Text node drops their fill, border,
  // radius, and padding. Keep those as Frames and let the text child become
  // its own editable layer below.
  const hasPaint = Boolean(
    (styles.backgroundColor && styles.backgroundColor !== "transparent" && styles.backgroundColor !== "rgba(0, 0, 0, 0)")
      || (styles.backgroundImage && styles.backgroundImage !== "none")
      || numberValue(styles.borderTopWidth, 0) > 0
      || numberValue(styles.borderRightWidth, 0) > 0
      || numberValue(styles.borderBottomWidth, 0) > 0
      || numberValue(styles.borderLeftWidth, 0) > 0
      || numberValue(styles.borderTopLeftRadius, 0) > 0
      || numberValue(styles.borderTopRightRadius, 0) > 0
      || numberValue(styles.borderBottomRightRadius, 0) > 0
      || numberValue(styles.borderBottomLeftRadius, 0) > 0
      || (styles.boxShadow && styles.boxShadow !== "none")
      || hasPadding
  );
  const type = tag === "IMG" ? "image" : tag === "SVG" ? "vector" : rawText && elementChildren.length === 0 && !hasPaint && tag !== "BUTTON" ? "text" : "frame";
  const layout = node.layout || {
    mode: styles.flexDirection === "row" || styles.flexDirection === "row-reverse" ? "horizontal" : styles.display === "flex" ? "vertical" : "none",
    reverse: styles.flexDirection === "row-reverse" || styles.flexDirection === "column-reverse" ? true : undefined,
    gap: numberValue(styles.gap, 0),
    rowGap: numberValue(styles.rowGap, numberValue(styles.gap, 0)),
    columnGap: numberValue(styles.columnGap, numberValue(styles.gap, 0)),
    padding: [numberValue(styles.paddingTop, 0), numberValue(styles.paddingRight, 0), numberValue(styles.paddingBottom, 0), numberValue(styles.paddingLeft, 0)],
    wrap: styles.flexWrap === "wrap",
    alignItems: "start",
    alignContent: styles.alignContent === "center" ? "center" : styles.alignContent === "flex-end" || styles.alignContent === "end" ? "end" : styles.alignContent === "space-between" ? "space-between" : styles.alignContent === "space-around" ? "space-around" : styles.alignContent === "space-evenly" ? "space-evenly" : styles.alignContent === "stretch" ? "stretch" : "start",
    justifyItems: styles.justifyItems === "center" ? "center" : styles.justifyItems === "end" || styles.justifyItems === "flex-end" ? "end" : styles.justifyItems === "stretch" ? "stretch" : "start",
    justifySelf: styles.justifySelf === "center" ? "center" : styles.justifySelf === "end" || styles.justifySelf === "flex-end" ? "end" : styles.justifySelf === "stretch" ? "stretch" : styles.justifySelf === "start" || styles.justifySelf === "flex-start" ? "start" : "auto",
    ...(styles.placeItems && styles.placeItems !== "normal" ? { placeItems: styles.placeItems } : {}),
    ...(styles.placeSelf && styles.placeSelf !== "auto" ? { placeSelf: styles.placeSelf } : {}),
    justifyContent: "start",
    widthMode: "fixed",
    heightMode: "fixed",
    position: styles.position === "absolute" ? "absolute" : "flow",
  };
  const scene = {
    id: node.id || `node-${tag.toLowerCase()}`,
    type,
    rect,
    opacity: numberValue(styles.opacity, 1),
    fill: cssColor(type === "text" ? styles.color : styles.backgroundColor),
    gradient: styles.backgroundImage && styles.backgroundImage.includes("gradient") ? styles.backgroundImage : undefined,
    backgroundImage: styles.backgroundImage && styles.backgroundImage !== "none" ? styles.backgroundImage : undefined,
    backgroundAssetId: node.backgroundAssetId,
    backgroundRepeat: styles.backgroundRepeat || "repeat",
    backgroundSize: styles.backgroundSize || "auto",
    backgroundPosition: styles.backgroundPosition || "0% 0%",
    transform: styles.transform && styles.transform !== "none" ? styles.transform : undefined,
    transformOrigin: styles.transformOrigin || "50% 50%",
    positioning: styles.position === "relative" || styles.position === "absolute" || styles.position === "fixed" || styles.position === "sticky" ? styles.position : "static",
    positionOffset: styles.position === "relative" ? { left: numberValue(styles.left, 0), top: numberValue(styles.top, 0) } : undefined,
    zIndex: Number.isFinite(Number.parseInt(styles.zIndex, 10)) ? Number.parseInt(styles.zIndex, 10) : undefined,
    filter: styles.filter && styles.filter !== "none" ? styles.filter : undefined,
    backdropFilter: styles.backdropFilter && styles.backdropFilter !== "none" ? styles.backdropFilter : undefined,
    computedStyles: node.computedStyles || {},
    stroke: cssBorder(styles, "Top"),
    borders: [cssBorder(styles, "Top"), cssBorder(styles, "Right"), cssBorder(styles, "Bottom"), cssBorder(styles, "Left")],
    radius: cssRadius(styles),
    margin: [numberValue(styles.marginTop, 0), numberValue(styles.marginRight, 0), numberValue(styles.marginBottom, 0), numberValue(styles.marginLeft, 0)],
    shadow: cssShadow(styles.boxShadow),
    shadows: cssShadows(styles.boxShadow),
    overflow: styles.overflow,
    objectFit: styles.objectFit || "fill",
    objectPosition: styles.objectPosition || "50% 50%",
    layout,
    assetId: node.assetId,
    svg: type === "vector" ? node.content : undefined,
    children: [],
  };
  if (type === "text") {
    // H2D keeps the range-measured glyph box on the direct text child. Carry
    // that inset across the plugin boundary so non-auto-layout text can be
    // positioned against the browser's actual glyph origin instead of only
    // Figma's font metrics. The element rect remains the editable text box
    // and therefore still preserves the captured wrapping width.
    if (rawText?.rect) {
      scene.textRect = {
        x: rawText.rect.x - absoluteRect.x,
        y: rawText.rect.y - absoluteRect.y,
        width: rawText.rect.width,
        height: rawText.rect.height,
      };
    }
    scene.text = {
      content: rawText?.text || "",
      lineCount: Number(rawText?.lineCount || 1),
      fontFamily: styles.fontFamily || "Inter",
      fontSize: numberValue(styles.fontSize, 16),
      fontWeight: fontWeightValue(styles.fontWeight, 400),
      lineHeight: numberValue(styles.lineHeight, numberValue(styles.fontSize, 16) * 1.2),
      letterSpacing: numberValue(styles.letterSpacing, 0),
      textAlign: styles.textAlign === "center" || styles.textAlign === "right" || styles.textAlign === "justified" ? styles.textAlign : "left",
      textTransform: styles.textTransform || "none",
      fontStyle: styles.fontStyle || "normal",
      textDecoration: styles.textDecoration || "none",
      textShadow: styles.textShadow || undefined,
      verticalAlign: styles.verticalAlign || "baseline",
      overflowWrap: styles.overflowWrap || "normal",
      wordBreak: styles.wordBreak || "normal",
      hyphens: styles.hyphens || "manual",
      whiteSpace: styles.whiteSpace || "pre-wrap",
      textIndent: numberValue(styles.textIndent, 0),
      direction: styles.direction || "ltr",
    };
  }
  if (type === "image") scene.attributes = node.attributes || {};
  // Official H2D keeps generated content out of childNodes. Rehydrate it into
  // the shared scene only at the plugin boundary so the native importer can
  // keep the pseudo layer editable without changing normal-flow ordering.
  let childNodes = [
    ...pseudoElementChildren.filter(child => child.__pseudoRole === "before"),
    ...(node.childNodes || []),
    ...pseudoElementChildren.filter(child => child.__pseudoRole === "after"),
  ];
  // Figma's canvas stacking order is the insertion order for non-auto-layout
  // frames. CSS z-index therefore needs a stable ordering pass; Auto Layout
  // children are handled separately below because CSS `order` can change
  // their visual sequence without changing DOM order.
  const hasStackingOrder = layout.mode === "none" && childNodes.some(child => child.nodeType === 1 && Number.isFinite(Number.parseInt(child.styles?.zIndex, 10)));
  if (hasStackingOrder) {
    childNodes.sort((left, right) => {
      const leftIndex = left.nodeType === 1 ? numberValue(left.styles?.zIndex, 0) : 0;
      const rightIndex = right.nodeType === 1 ? numberValue(right.styles?.zIndex, 0) : 0;
      return leftIndex - rightIndex;
    });
  }
  // CSS flex/grid order changes the visual position without changing DOM
  // order. Figma Auto Layout uses insertion order instead, so apply the
  // captured order before creating children. Keep the original index as a
  // stable tie-breaker, including anonymous text runs (which have no order).
  if (layout.mode === "horizontal" || layout.mode === "vertical") {
    const ordered = childNodes.map((child, index) => ({ child, index }));
    const childOrder = child => child.nodeType === 1
      ? numberValue(child.layout?.order, numberValue(child.styles?.order, 0))
      : 0;
    if (ordered.some(({ child }) => childOrder(child) !== 0)) {
      ordered.sort((left, right) => {
        return childOrder(left.child) - childOrder(right.child) || left.index - right.index;
      });
      childNodes = ordered.map(({ child }) => child);
    }
  }
  for (const child of childNodes) {
    if (!child) continue;
    if (child.nodeType === 1) {
      const childScene = sceneFromH2D(child, absoluteRect);
      if (child.__pseudoRole) childScene.pseudo = child.__pseudoRole;
      // Figma does not have a portable CSS-grid/flex-wrap track model. Keep
      // the parent as an editable frame, but pin wrapped direct children to
      // their measured cell coordinates so track rounding cannot move them.
      if ((isGrid || layout.wrap || layout.reverse) && childScene.layout?.position !== "absolute") {
        childScene.layout = { ...childScene.layout, geometryLock: true };
      }
      scene.children.push(childScene);
    } else if (child.nodeType === 3 && type === "frame") {
      const textRect = child.rect || absoluteRect;
      scene.children.push({
        id: child.id || `${scene.id}-text`,
        type: "text",
        rect: {
          x: textRect.x - absoluteRect.x,
          y: textRect.y - absoluteRect.y,
          width: textRect.width,
          height: textRect.height,
        },
        // The parent element already carries CSS opacity. A raw text run is
        // inherited content, so duplicating the value here would multiply it.
        opacity: 1,
        fill: cssColor(styles.color),
        radius: [0, 0, 0, 0],
        margin: [0, 0, 0, 0],
        layout: { mode: "none", gap: 0, padding: [0, 0, 0, 0], widthMode: "fixed", heightMode: "fixed", position: "flow" },
        text: {
          content: child.text || "",
          lineCount: Number(child.lineCount || 1),
          fontFamily: styles.fontFamily || "Inter",
          fontSize: numberValue(styles.fontSize, 16),
          fontWeight: fontWeightValue(styles.fontWeight, 400),
          lineHeight: numberValue(styles.lineHeight, numberValue(styles.fontSize, 16) * 1.2),
          letterSpacing: numberValue(styles.letterSpacing, 0),
          textAlign: styles.textAlign === "center" || styles.textAlign === "right" || styles.textAlign === "justified" ? styles.textAlign : "left",
          textTransform: styles.textTransform || "none",
          fontStyle: styles.fontStyle || "normal",
          textDecoration: styles.textDecoration || "none",
          whiteSpace: styles.whiteSpace || "pre-wrap",
        },
        children: [],
      });
    }
  }
  return scene;
}

function explicitPositioning(scene) {
  return scene?.positioning === "absolute"
    || scene?.positioning === "fixed"
    || scene?.positioning === "sticky"
    || scene?.layout?.position === "absolute";
}

// Official H2D captures may freeze every direct child of a container as an
// absolute, parent-local rectangle. The shared scene represents that freeze
// with either an explicit out-of-flow position or geometryLock. Keeping Auto
// Layout enabled on that container makes Figma interpret the same captured
// inset through its padding and alignment rules a second time, which moves the
// whole subtree. Such a container is already a visual snapshot; use a
// free-positioning frame for this import while leaving authored scene metadata
// untouched. A shared scene with ordinary flow children still keeps real Auto
// Layout.
function capturedAbsoluteContainer(scene) {
  const children = scene?.children || [];
  const layoutMode = scene?.layout?.mode;
  // The shared capture marks stable visual rectangles with geometryLock even
  // when their CSS position is still `flow`. Once every direct child has that
  // lock, Figma Auto Layout would only reinterpret the captured rectangles;
  // the visible children are imported as absolute layers and their captured
  // coordinates must remain authoritative. Require an explicit layout mode so
  // incomplete/legacy scene objects do not accidentally lose Auto Layout.
  const hasCapturedLayout = layoutMode === "horizontal" || layoutMode === "vertical" || layoutMode === "none";
  if (scene?.layout?.visualSnapshot) return false;
  const isCapturedChild = (child) => explicitPositioning(child) || Boolean(child?.layout?.geometryLock);
  return scene?.type === "frame"
    && children.length > 0
    && hasCapturedLayout
    && children.every(isCapturedChild);
}

// The shared scene stores every child rectangle in the parent's local
// border-box coordinate space. Figma's absolute Auto Layout children use the
// same parent-local coordinate space for `x`/`y`; unlike CSS `left`/`top`, the
// plugin API does not resolve those values from the parent's padding box.
// Therefore the native importer must keep the captured local coordinates
// unchanged. The official H2D HTML serializer has a separate CSS containing
// block correction in src/figma/h2d.ts and must not be reused here.
function measuredTextPosition(scene) {
  const rect = scene?.rect || { x: 0, y: 0 };
  const textRect = scene?.textRect;
  const isMeasuredText = scene?.type === "text" && textRect;
  const preserveGlyphX = isMeasuredText && scene.text?.textAlign !== "center" && scene.text?.textAlign !== "right";
  const position = {
    x: (rect.x || 0) + (preserveGlyphX ? Number(textRect.x || 0) : 0),
    y: (rect.y || 0) + (isMeasuredText ? Number(textRect.y || 0) : 0),
  };
  return position;
}

function visualNodePosition(node) {
  // The translation in `relativeTransform` is the node's complete visual
  // parent-local position, not a delta to add to `x`/`y`. Auto Layout can
  // leave `x`/`y` at the flow-slot origin after a relative nudge, while the
  // matrix contains the rendered position. Prefer that coordinate when it is
  // available; adding it to x/y doubles large offsets on real imports.
  const transform = node?.relativeTransform;
  const translateX = Number(transform?.[0]?.[2]);
  const translateY = Number(transform?.[1]?.[2]);
  return {
    x: Number.isFinite(translateX) ? translateX : Number(node?.x || 0),
    y: Number.isFinite(translateY) ? translateY : Number(node?.y || 0),
  };
}

function geometryDelta(scene, node, parentScene) {
  const expected = measuredTextPosition(scene, parentScene);
  const actual = visualNodePosition(node);
  return {
    x: actual.x - (expected.x || 0),
    y: actual.y - (expected.y || 0),
  };
}

function recordGeometryLock(report, scene, delta) {
  if (!report) return;
  report.geometryLocks += 1;
  const magnitude = Math.max(Math.abs(delta.x), Math.abs(delta.y));
  report.maxGeometryDelta = Math.max(report.maxGeometryDelta || 0, magnitude);
  if (report.geometryLockNodes.length < 100) {
    report.geometryLockNodes.push({
      id: scene.id,
      expected: { x: scene.rect?.x || 0, y: scene.rect?.y || 0 },
      actual: { x: (scene.rect?.x || 0) + delta.x, y: (scene.rect?.y || 0) + delta.y },
      delta,
    });
  }
}

function recordFlowNudge(report, scene, delta) {
  if (!report) return;
  const magnitude = Math.max(Math.abs(delta.x), Math.abs(delta.y));
  report.maxFlowNudge = Math.max(report.maxFlowNudge || 0, magnitude);
  const existing = report.flowNudgeNodes.find(entry => entry.id === scene.id);
  if (existing) {
    existing.delta = delta;
  } else if (report.flowNudgeNodes.length < 100) {
    report.flowNudges += 1;
    report.flowNudgeNodes.push({
      id: scene.id,
      expected: { x: scene.rect?.x || 0, y: scene.rect?.y || 0 },
      delta,
    });
  }
}

function recordGeometryResize(report, scene, node, delta) {
  if (!report) return;
  report.geometryResizes += 1;
  const magnitude = Math.max(Math.abs(delta.width), Math.abs(delta.height));
  report.maxGeometryResize = Math.max(report.maxGeometryResize || 0, magnitude);
  if (report.geometryResizeNodes.length < 100) {
    report.geometryResizeNodes.push({
      id: scene.id,
      expected: { width: scene.rect?.width || 0, height: scene.rect?.height || 0 },
      actual: { width: (scene.rect?.width || 0) + delta.width, height: (scene.rect?.height || 0) + delta.height },
      delta,
    });
  }
}

function auditMeasuredGeometry(report, scene, node, positionDelta, sizeDelta, parentScene) {
  if (!report) return;
  report.geometryAudited += 1;
  const positionMagnitude = Math.max(Math.abs(positionDelta.x), Math.abs(positionDelta.y));
  const sizeMagnitude = Math.max(Math.abs(sizeDelta.width), Math.abs(sizeDelta.height));
  report.preCorrectionAudited += 1;
  report.preCorrectionMaxMeasuredDelta = Math.max(report.preCorrectionMaxMeasuredDelta || 0, positionMagnitude);
  report.preCorrectionMaxMeasuredSizeDelta = Math.max(report.preCorrectionMaxMeasuredSizeDelta || 0, sizeMagnitude);
  if (positionMagnitude > GEOMETRY_EPSILON || sizeMagnitude > SIZE_EPSILON) {
    report.preCorrectionMismatches += 1;
    if (report.preCorrectionMismatchNodes.length < 100) {
      report.preCorrectionMismatchNodes.push({
        id: scene.id,
        label: geometryNodeLabel(scene),
        expected: { ...measuredTextPosition(scene, parentScene), width: scene.rect?.width || 0, height: scene.rect?.height || 0 },
        actual: {
          x: measuredTextPosition(scene, parentScene).x + positionDelta.x,
          y: measuredTextPosition(scene, parentScene).y + positionDelta.y,
          width: (scene.rect?.width || 0) + sizeDelta.width,
          height: (scene.rect?.height || 0) + sizeDelta.height,
        },
        positionDelta,
        sizeDelta,
      });
    }
  }
}

function auditRemainingGeometry(report, scene, node, parentScene) {
  if (!report || !scene || !node) return;
  const expected = scene.rect || { x: 0, y: 0, width: 0, height: 0 };
  const expectedPosition = measuredTextPosition(scene, parentScene);
  // A page root inserted into a user-selected Frame is positioned by that
  // Frame's existing Auto Layout context. Its local x/y therefore describe
  // the destination slot, not the captured document origin. Audit the root's
  // size there, but do not report the host placement as a page mismatch (and
  // never try to correct it by changing the imported page root).
  const rootPlacedInHostLayout = !parentScene
    && node.parent
    && node.parent.type !== "PAGE"
    && node.parent.type !== "DOCUMENT";
  const actualPosition = visualNodePosition(node);
  const positionDelta = {
    x: rootPlacedInHostLayout ? 0 : actualPosition.x - expectedPosition.x,
    y: rootPlacedInHostLayout ? 0 : actualPosition.y - expectedPosition.y,
  };
  const sizeDelta = {
    width: (node.width || 0) - (expected.width || 0),
    height: (node.height || 0) - (expected.height || 0),
  };
  const positionMagnitude = Math.max(Math.abs(positionDelta.x), Math.abs(positionDelta.y));
  const sizeMagnitude = Math.max(Math.abs(sizeDelta.width), Math.abs(sizeDelta.height));
  report.remainingGeometryAudited += 1;
  report.maxRemainingMeasuredDelta = Math.max(report.maxRemainingMeasuredDelta || 0, positionMagnitude);
  report.maxRemainingMeasuredSizeDelta = Math.max(report.maxRemainingMeasuredSizeDelta || 0, sizeMagnitude);
  if (positionMagnitude > GEOMETRY_EPSILON || sizeMagnitude > SIZE_EPSILON) {
    report.remainingMismatches += 1;
    if (report.remainingMismatchNodes.length < 100) {
      report.remainingMismatchNodes.push({
        id: scene.id,
        label: geometryNodeLabel(scene),
        expected: { x: expectedPosition.x, y: expectedPosition.y, width: expected.width || 0, height: expected.height || 0 },
        actual: { x: expectedPosition.x + positionDelta.x, y: expectedPosition.y + positionDelta.y, width: (expected.width || 0) + sizeDelta.width, height: (expected.height || 0) + sizeDelta.height },
        positionDelta,
        sizeDelta,
      });
    }
  }
  const children = scene.children || [];
  for (let index = 0; index < children.length; index += 1) {
    const childNode = sceneChildNode(node, children[index], index);
    if (childNode) auditRemainingGeometry(report, children[index], childNode, scene);
  }
}

function resetRemainingGeometryAudit(report) {
  report.remainingGeometryAudited = 0;
  report.remainingMismatches = 0;
  report.maxRemainingMeasuredDelta = 0;
  report.maxRemainingMeasuredSizeDelta = 0;
  report.remainingMismatchNodes = [];
}

function sortGeometryMismatchNodes(report) {
  if (!report || !Array.isArray(report.remainingMismatchNodes)) return;
  report.remainingMismatchNodes.sort((left, right) => {
    const magnitude = (entry) => Math.max(
      Math.abs(Number(entry?.positionDelta?.x || 0)),
      Math.abs(Number(entry?.positionDelta?.y || 0)),
      Math.abs(Number(entry?.sizeDelta?.width || 0)),
      Math.abs(Number(entry?.sizeDelta?.height || 0)),
    );
    return magnitude(right) - magnitude(left);
  });
  report.worstGeometryMismatch = report.remainingMismatchNodes[0] || null;
}

function geometryNodeLabel(scene) {
  if (!scene) return "unknown node";
  const text = String(scene.text?.content || "").replace(/\s+/g, " ").trim();
  const tag = String(scene.sourceTag || scene.type || "node").toLowerCase();
  return text ? `${tag}: ${text.slice(0, 80)}` : tag;
}

// Figma recalculates an Auto Layout parent's earlier children whenever a later
// child is appended. A one-shot check immediately after append therefore sees
// an incomplete layout and can miss a final vertical shift. Run this pass only
// after the complete sibling list exists, then lock measured coordinates for
// children whose final position differs from the browser capture.
// Auto Layout can resize a frame after its last child is appended, especially
// when the captured sizing intent was HUG or FILL. The browser capture already
// gives us the authoritative border-box dimensions, so restore those measured
// dimensions before and after correcting descendants. Keeping the container
// fixed prevents one expanded child from shifting every sibling in the tree.
function correctMeasuredSize(scene, node, report) {
  if (!scene || !node || node.type === "PAGE" || typeof node.resize !== "function") return;
  const expected = scene.rect || { width: 0, height: 0 };
  const current = { width: node.width || 0, height: node.height || 0 };
  const delta = {
    width: current.width - (expected.width || 0),
    height: current.height - (expected.height || 0),
  };
  const widthTolerance = axisKeepsFlexibleSizing(scene, node, "width") ? FLEX_SIZE_EPSILON : SIZE_EPSILON;
  const heightTolerance = axisKeepsFlexibleSizing(scene, node, "height") ? FLEX_SIZE_EPSILON : SIZE_EPSILON;
  const widthMismatch = Math.abs(delta.width) > widthTolerance;
  const heightMismatch = Math.abs(delta.height) > heightTolerance;
  if (!widthMismatch && !heightMismatch) return;
  // `resize()` alone does not hold an Auto Layout frame's border-box when
  // either axis is still AUTO/HUG. Figma recomputes that axis from the
  // captured children on the next layout pass, which moves every descendant
  // even though the scene rect is already authoritative. Freeze the frame
  // sizing modes only when correcting a real size mismatch; otherwise keep
  // the FILL/HUG intent restored after the tree was built.
  if (widthMismatch) freezeSizingAxis(scene, node, "width");
  if (heightMismatch) freezeSizingAxis(scene, node, "height");
  try {
    node.resize(
      widthMismatch ? Math.max(1, expected.width || 0) : Math.max(1, current.width || 0),
      heightMismatch ? Math.max(1, expected.height || 0) : Math.max(1, current.height || 0),
    );
    recordGeometryResize(report, scene, node, delta);
  } catch {
    // Keep the diagnostic pass non-fatal for node types that cannot resize.
  }
}

function correctMeasuredGeometry(scene, node, report) {
  correctMeasuredSize(scene, node, report);
  const children = scene.children || [];
  for (let index = 0; index < children.length; index += 1) {
    const childScene = children[index];
    const childNode = sceneChildNode(node, childScene, index);
    if (!childNode) continue;
    const alreadyAbsolute = childNode.layoutPositioning === "ABSOLUTE";
    const canPosition = "x" in childNode && "y" in childNode;
    const canLock = "layoutPositioning" in childNode
      && node.type !== "PAGE"
      && "layoutMode" in node
      && node.layoutMode !== "NONE"
      && childScene.layout?.position !== "absolute"
      && !childScene.layout?.geometryLock
      && !alreadyAbsolute;
    const expectedSize = childScene.rect || { width: 0, height: 0 };
    const sizeDelta = {
      width: (childNode.width || 0) - (expectedSize.width || 0),
      height: (childNode.height || 0) - (expectedSize.height || 0),
    };
    const initialDelta = geometryDelta(childScene, childNode, scene);
    auditMeasuredGeometry(report, childScene, childNode, initialDelta, sizeDelta, scene);
    const widthMismatch = Math.abs(sizeDelta.width) > (axisKeepsFlexibleSizing(childScene, childNode, "width") ? FLEX_SIZE_EPSILON : SIZE_EPSILON);
    const heightMismatch = Math.abs(sizeDelta.height) > (axisKeepsFlexibleSizing(childScene, childNode, "height") ? FLEX_SIZE_EPSILON : SIZE_EPSILON);
    if (canLock && (widthMismatch || heightMismatch) && "layoutSizingHorizontal" in childNode && "layoutSizingVertical" in childNode) {
      try {
        if (widthMismatch) freezeSizingAxis(childScene, childNode, "width");
        if (heightMismatch) freezeSizingAxis(childScene, childNode, "height");
        childNode.resize(
          widthMismatch ? Math.max(1, expectedSize.width) : Math.max(1, childNode.width || 0),
          heightMismatch ? Math.max(1, expectedSize.height) : Math.max(1, childNode.height || 0),
        );
        recordGeometryResize(report, childScene, childNode, sizeDelta);
      } catch {
        // Some node types expose sizing properties but reject a resize while
        // their parent is still resolving Auto Layout. Position correction
        // below remains useful and the report stays diagnostic.
      }
    }
    const finalDelta = geometryDelta(childScene, childNode, scene);
    if (canLock && Math.max(Math.abs(finalDelta.x), Math.abs(finalDelta.y)) > GEOMETRY_EPSILON) {
      // Keep ordinary CSS flow represented by a real Figma Auto Layout child.
      // A relative transform changes only the rendered offset; the child still
      // owns its HUG/FILL slot and responds when the parent is resized. This is
      // the native equivalent of CSS position:relative and avoids replacing
      // an editable constraint with an absolute layer plus a fake spacer.
      if (translateRelative(childNode, -finalDelta.x, -finalDelta.y)) {
        recordFlowNudge(report, childScene, finalDelta);
        correctMeasuredGeometry(childScene, childNode, report);
        continue;
      }
      // Figma can keep a previously assigned FILL/HUG sizing mode even after
      // an Auto Layout child becomes absolute. In that state assigning x/y is
      // not enough: the next layout pass may stretch the layer again and move
      // every following sibling. A measured lock is a fixed-size snapshot of
      // the browser result, so freeze both sizing axes before positioning it.
      if ("layoutSizingHorizontal" in childNode && "layoutSizingVertical" in childNode) {
        try {
          childNode.layoutSizingHorizontal = "FIXED";
          childNode.layoutSizingVertical = "FIXED";
          childNode.resize(Math.max(1, expectedSize.width), Math.max(1, expectedSize.height));
        } catch {
          // Keep the positional lock even when a node type rejects resizing.
        }
      }
      // Removing a normal-flow child from Auto Layout without preserving its
      // slot makes every later sibling move toward the origin. Keep an
      // invisible measured-size item in the original slot before absolute
      // positioning the visible layer, so the browser's captured flow remains
      // stable while the layer itself keeps its exact coordinates.
      const parentAxis = node.layoutMode === "VERTICAL" ? "vertical" : node.layoutMode === "HORIZONTAL" ? "horizontal" : "none";
      if (parentAxis !== "none") {
        createMeasuredFlowPlaceholder(node, childNode, parentAxis, childScene.id, crossMarginExtent(childScene, parentAxis));
      }
      childNode.layoutPositioning = "ABSOLUTE";
      const target = measuredTextPosition(childScene, scene);
      childNode.x = target.x;
      childNode.y = target.y;
      recordGeometryLock(report, childScene, finalDelta);
    } else if (canPosition && alreadyAbsolute
      && Math.max(Math.abs(finalDelta.x), Math.abs(finalDelta.y)) > GEOMETRY_EPSILON) {
      // A parent resize can trigger one more Figma layout pass after a child
      // was already made absolute. Re-apply the measured coordinates so the
      // final audit reflects the browser capture rather than that late pass.
      try {
        const target = measuredTextPosition(childScene, scene);
        childNode.x = target.x;
        childNode.y = target.y;
        recordGeometryLock(report, childScene, finalDelta);
      } catch {
        // Keep the residual discrepancy visible in the import report.
      }
    } else if (canPosition && "layoutMode" in node && node.layoutMode !== "NONE"
      && Math.max(Math.abs(finalDelta.x), Math.abs(finalDelta.y)) > GEOMETRY_EPSILON) {
      // Older Figma node types (notably imported SVG groups) may expose x/y
      // without the modern layoutPositioning property. They cannot be removed
      // from Auto Layout, but preserving the measured coordinates is still
      // better than accepting a large importer-computed offset.
      try {
        const target = measuredTextPosition(childScene, scene);
        childNode.x = target.x;
        childNode.y = target.y;
        recordGeometryLock(report, childScene, finalDelta);
      } catch {
        // Leave the diagnostic mismatch visible when the host exposes read-only
        // geometry for this node type.
      }
    }
    correctMeasuredGeometry(childScene, childNode, report);
  }
  // A child correction can trigger one more Auto Layout pass on its parent.
  // Re-apply the measured container size after descendants have settled.
  correctMeasuredSize(scene, node, report);
}

function settleFigmaLayout() {
  // Figma recalculates Auto Layout synchronously in most builds, but some
  // desktop versions publish the final child coordinates on the next plugin
  // turn. Yield once before the authoritative measured-geometry pass so the
  // correction sees the completed sibling list rather than an intermediate
  // position.
  return new Promise(resolve => setTimeout(resolve, 0));
}

function sizingValue(value) {
  return value === "fill" ? "FILL" : value === "hug" ? "HUG" : "FIXED";
}

function intrinsicSizingProperty(scene, axis) {
  const horizontal = scene?.layout?.mode === "horizontal";
  if (axis === "width") return horizontal ? "primaryAxisSizingMode" : "counterAxisSizingMode";
  return horizontal ? "counterAxisSizingMode" : "primaryAxisSizingMode";
}

function parentSizingProperty(axis) {
  return axis === "width" ? "layoutSizingHorizontal" : "layoutSizingVertical";
}

function axisKeepsFlexibleSizing(scene, node, axis) {
  const mode = axis === "width" ? scene?.layout?.widthMode : scene?.layout?.heightMode;
  if (mode !== "fill" && mode !== "hug") return false;
  const parentValue = node?.[parentSizingProperty(axis)];
  const intrinsicValue = node?.[intrinsicSizingProperty(scene, axis)];
  return parentValue === "FILL" || parentValue === "HUG" || intrinsicValue === "AUTO";
}

function freezeSizingAxis(scene, node, axis) {
  const parentProperty = parentSizingProperty(axis);
  const intrinsicProperty = intrinsicSizingProperty(scene, axis);
  try {
    if (parentProperty in node) node[parentProperty] = "FIXED";
  } catch {
    // Some imported SVG groups expose sizing properties but reject writes.
  }
  try {
    if (intrinsicProperty in node) node[intrinsicProperty] = "FIXED";
  } catch {
    // Keep the other axis editable when only one property is read-only.
  }
}

function directGeometrySnapshot(scene, node) {
  if (!scene || !node) return [];
  return (scene.children || []).map((childScene, index) => {
    const childNode = sceneChildNode(node, childScene, index);
    return childNode ? {
      node: childNode,
      x: Number(childNode.x || 0),
      y: Number(childNode.y || 0),
      width: Number(childNode.width || 0),
      height: Number(childNode.height || 0),
    } : null;
  }).filter(Boolean);
}

function geometrySnapshotChanged(before, after) {
  if (!before || !after) return false;
  return Math.abs(before.x - after.x) > GEOMETRY_EPSILON
    || Math.abs(before.y - after.y) > GEOMETRY_EPSILON
    || Math.abs(before.width - after.width) > SIZE_EPSILON
    || Math.abs(before.height - after.height) > SIZE_EPSILON;
}

function recordSizingFallback(report, scene, kind, details = {}) {
  if (!report) return;
  report.sizingFallbacks = (report.sizingFallbacks || 0) + 1;
  report.sizingFallbackNodes = report.sizingFallbackNodes || [];
  if (report.sizingFallbackNodes.length < 100) {
    report.sizingFallbackNodes.push({ id: scene?.id || "unknown", kind, ...details });
  }
}

function restoreParentSizingAxis(scene, node, parentScene, parentNode, axis, report) {
  const property = parentSizingProperty(axis);
  if (!(property in node)) return;
  const desired = sizingValue(axis === "width" ? scene.layout?.widthMode : scene.layout?.heightMode);
  if (desired === "FIXED") {
    try { node[property] = "FIXED"; } catch { /* optional API */ }
    return;
  }
  const expectedWidth = Number(scene.rect?.width || 0);
  const expectedHeight = Number(scene.rect?.height || 0);
  const before = directGeometrySnapshot(parentScene, parentNode);
  try {
    node[property] = desired;
    const widthDelta = Math.abs(Number(node.width || 0) - expectedWidth);
    const heightDelta = Math.abs(Number(node.height || 0) - expectedHeight);
    const after = directGeometrySnapshot(parentScene, parentNode);
    const siblingReflowed = before.some((entry, entryIndex) => (
      entry.node !== node && geometrySnapshotChanged(entry, after[entryIndex])
    ));
    if (siblingReflowed || widthDelta > FLEX_SIZE_EPSILON || heightDelta > FLEX_SIZE_EPSILON) {
      recordSizingFallback(report, scene, `parent-facing-${axis}`, {
        axis, desired,
        expectedWidth, expectedHeight,
        actualWidth: Number(node.width || 0),
        actualHeight: Number(node.height || 0),
        widthDelta, heightDelta, siblingReflowed,
      });
      node[property] = "FIXED";
      node.resize(Math.max(1, expectedWidth), Math.max(1, expectedHeight));
    }
  } catch {
    recordSizingFallback(report, scene, `parent-facing-${axis}-error`, { axis, desired });
    try {
      node[property] = "FIXED";
      node.resize(Math.max(1, expectedWidth), Math.max(1, expectedHeight));
    } catch {
      // Keep the measured node if the host rejects sizing changes.
    }
  }
}

function restoreIntrinsicSizingAxis(scene, node, axis, report) {
  const mode = axis === "width" ? scene.layout?.widthMode : scene.layout?.heightMode;
  const property = intrinsicSizingProperty(scene, axis);
  if (!(property in node)) return;
  const desired = mode === "hug" ? "AUTO" : "FIXED";
  const previous = node[property];
  if (desired === "FIXED") {
    try { node[property] = "FIXED"; } catch { /* optional API */ }
    return;
  }
  const expectedWidth = Number(scene.rect?.width || 0);
  const expectedHeight = Number(scene.rect?.height || 0);
  try {
    node[property] = desired;
    const widthDelta = Math.abs(Number(node.width || 0) - expectedWidth);
    const heightDelta = Math.abs(Number(node.height || 0) - expectedHeight);
    if (widthDelta > FLEX_SIZE_EPSILON || heightDelta > FLEX_SIZE_EPSILON) {
      recordSizingFallback(report, scene, `intrinsic-${axis}`, {
        axis, desired,
        expectedWidth, expectedHeight,
        actualWidth: Number(node.width || 0),
        actualHeight: Number(node.height || 0),
        widthDelta, heightDelta,
      });
      node[property] = previous || "FIXED";
      node.resize(Math.max(1, expectedWidth), Math.max(1, expectedHeight));
    }
  } catch {
    recordSizingFallback(report, scene, `intrinsic-${axis}-error`, { axis, desired });
    try {
      node[property] = previous || "FIXED";
      node.resize(Math.max(1, expectedWidth), Math.max(1, expectedHeight));
    } catch {
      // Older plugin runtimes may expose these fields as read-only.
    }
  }
}

function restoreStableSizing(scene, node, report) {
  if (!scene || !node) return;
  const children = scene.children || [];
  for (let index = 0; index < children.length; index += 1) {
    const childScene = children[index];
    const childNode = sceneChildNode(node, childScene, index);
    if (!childNode) continue;
    // Restore the child's internal Auto Layout before asking its parent to
    // treat the child as HUG/FILL. Figma evaluates child-facing sizing
    // immediately; doing this in the opposite order measures the temporary
    // FIXED subtree, triggers a false geometry mismatch, and permanently
    // downgrades otherwise stable containers (for example the page <main>)
    // from Hug contents to Fixed.
    restoreStableSizing(childScene, childNode, report);
    const parentUsesAutoLayout = "layoutMode" in node && node.layoutMode !== "NONE";
    const explicitAbsolute = childScene.layout?.position === "absolute"
      || childScene.layout?.geometryLock
      || childScene.positioning === "absolute"
      || childScene.positioning === "fixed"
      || childScene.positioning === "sticky"
      // Measured snapshot children are made absolute during import while
      // their invisible flow placeholder preserves the parent's Auto Layout
      // track. Never restore FILL/HUG onto those visible layers.
      || childNode.layoutPositioning === "ABSOLUTE";
    if (parentUsesAutoLayout && !explicitAbsolute
      && "layoutSizingHorizontal" in childNode && "layoutSizingVertical" in childNode) {
      restoreParentSizingAxis(childScene, childNode, scene, node, "width", report);
      restoreParentSizingAxis(childScene, childNode, scene, node, "height", report);
    }
  }

  // The creation pass freezes every Auto Layout frame on both axes so later
  // siblings cannot be displaced while the tree is incomplete. Restore the
  // frame's own intrinsic sizing after its descendants are present as well;
  // restoring only the child-facing `layoutSizing*` flags leaves nested CSS
  // stacks permanently fixed in Figma. A measured/visual-snapshot frame is
  // intentionally kept fixed because its captured border box is authoritative.
  if (node.layoutMode !== "NONE" && !scene.layout?.geometryLock && !scene.layout?.visualSnapshot) {
    restoreIntrinsicSizingAxis(scene, node, "width", report);
    restoreIntrinsicSizingAxis(scene, node, "height", report);
  }
}

function reportImportProgress(progress, phase = "creating") {
  if (!progress || !figma.ui?.postMessage) return;
  const now = Date.now();
  // Avoid flooding the plugin bridge for large pages while still giving the
  // user a heartbeat during font/resource work.
  if (progress.created < progress.total && now - progress.lastPosted < 120) return;
  progress.lastPosted = now;
  figma.ui.postMessage({
    type: "import-progress",
    phase,
    created: progress.created,
    total: progress.total,
    nodeId: progress.nodeId || "",
    nodeType: progress.nodeType || "",
  });
}

function countSceneNodes(scene) {
  if (!scene) return 0;
  let count = 1;
  for (const child of scene.children || []) count += countSceneNodes(child);
  return count;
}

function importParentForPage(page) {
  const selection = Array.isArray(page?.selection) ? page.selection : [];
  if (selection.length !== 1) return page;
  const candidate = selection[0];
  return candidate && (candidate.type === "FRAME" || candidate.type === "COMPONENT") ? candidate : page;
}

const PAGE_IMPORT_GAP = 80;

function placeRootWithoutOverlap(root, parent) {
  if (!root || !parent || parent.type !== "PAGE" || root.parent !== parent) return;
  const siblings = Array.from(parent.children || []).filter((candidate) => (
    candidate !== root
      && Number.isFinite(Number(candidate?.x))
      && Number.isFinite(Number(candidate?.y))
      && Number.isFinite(Number(candidate?.width))
      && Number.isFinite(Number(candidate?.height))
  ));
  if (!siblings.length) return;
  const rootBounds = {
    left: Number(root.x || 0),
    top: Number(root.y || 0),
    right: Number(root.x || 0) + Number(root.width || 0),
    bottom: Number(root.y || 0) + Number(root.height || 0),
  };
  const overlaps = siblings.some((candidate) => {
    const left = Number(candidate.x || 0);
    const top = Number(candidate.y || 0);
    const right = left + Number(candidate.width || 0);
    const bottom = top + Number(candidate.height || 0);
    return rootBounds.left < right
      && rootBounds.right > left
      && rootBounds.top < bottom
      && rootBounds.bottom > top;
  });
  if (!overlaps) return;
  root.x = Math.max(...siblings.map((candidate) => Number(candidate.x || 0) + Number(candidate.width || 0))) + PAGE_IMPORT_GAP;
  root.y = Math.min(...siblings.map((candidate) => Number(candidate.y || 0)));
}

async function createNode(
  scene,
  parent,
  assets,
  report,
  parentScene,
  resources = { images: new Map(), vectors: new Map() },
  progress,
) {
  if (progress) {
    progress.created += 1;
    progress.nodeId = scene?.id || "";
    progress.nodeType = scene?.type || "";
    reportImportProgress(progress, "creating");
  }
  let node;
  if (scene.type === "text") {
    node = figma.createText();
    const capturedFontFamily = scene.computedStyles?.fontFamily || scene.text?.fontFamily;
    const resolvedFont = await loadSceneFont(capturedFontFamily
      ? { ...scene.text, fontFamily: capturedFontFamily }
      : scene.text);
    if (resolvedFont.fallback && report) {
      report.fontFallbacks += 1;
      if (report.fontFallbackNodes.length < 100) {
        report.fontFallbackNodes.push({
          id: scene.id,
          requested: capturedFontFamily || scene.text?.fontFamily || "Inter",
          resolved: `${resolvedFont.family} ${resolvedFont.style}`,
        });
      }
    }
    try { node.fontName = { family: resolvedFont.family, style: resolvedFont.style }; } catch { /* keep the default font */ }
    node.fontSize = scene.text?.fontSize || 16;
    node.characters = scene.text?.content || "";
    node.textAlignHorizontal = scene.text?.textAlign === "center" ? "CENTER" : scene.text?.textAlign === "right" ? "RIGHT" : "LEFT";
    if (scene.text?.textAlign === "justified") node.textAlignHorizontal = "JUSTIFIED";
    if ("textCase" in node) node.textCase = scene.text?.textTransform === "uppercase" ? "UPPER" : scene.text?.textTransform === "lowercase" ? "LOWER" : scene.text?.textTransform === "capitalize" ? "TITLE" : "ORIGINAL";
    node.textAutoResize = "NONE";
    if ("textAlignVertical" in node) node.textAlignVertical = "TOP";
    node.lineHeight = { unit: "PIXELS", value: scene.text?.lineHeight || (scene.text?.fontSize || 16) * 1.2 };
    node.letterSpacing = { unit: "PIXELS", value: scene.text?.letterSpacing || 0 };
    fitTextToCapturedLines(node, scene);
    if ("paragraphIndent" in node && Number.isFinite(scene.text?.textIndent)) {
      node.paragraphIndent = scene.text.textIndent;
    }
    if ("textDirection" in node && scene.text?.direction) {
      try { node.textDirection = scene.text.direction.toLowerCase() === "rtl" ? "RTL" : "LTR"; } catch { /* optional Figma API */ }
    }
    if ("textDecoration" in node) {
      node.textDecoration = scene.text?.textDecoration?.includes("line-through") ? "STRIKETHROUGH" : scene.text?.textDecoration?.includes("underline") ? "UNDERLINE" : "NONE";
    }
  } else if (scene.type === "vector" && scene.svg) {
    const vectorKey = scene.assetId || scene.svg;
    const vectorCache = resources.vectors || (resources.vectors = new Map());
    const template = vectorCache.get(vectorKey);
    if (template && typeof template.clone === "function") {
      node = template.clone();
    } else {
      node = figma.createNodeFromSvg(scene.svg);
      // Keep one parsed vector as the template. Figma nodes are still cloned
      // per scene occurrence, so each instance remains independently editable.
      if (node && typeof node.clone === "function") vectorCache.set(vectorKey, node);
    }
  } else if (scene.type === "image") {
    const asset = assetList(assets).find(candidate => candidate.id === scene.assetId || candidate.url === scene.attributes?.src);
    const cacheKey = asset?.id || asset?.url || scene.attributes?.src;
    const image = asset ? createFigmaImage(asset, cacheKey, resources) : null;
    if (image) {
      node = figma.createRectangle();
      const fit = scene.objectFit === "contain" ? "FIT" : scene.objectFit === "cover" || scene.objectFit === "none" ? "CROP" : scene.objectFit === "repeat" ? "TILE" : "FILL";
      const paint = { type: "IMAGE", imageHash: image.hash, scaleMode: fit };
      const imageFilters = cssImageFilters(scene.filter);
      if (imageFilters) paint.filters = imageFilters;
      applyImagePosition(paint, scene.objectPosition);
      node.fills = [paint];
    } else {
      node = figma.createFrame();
      node.name = `${scene.id} (image unavailable)`;
      if ("fills" in node) node.fills = [];
      recordAssetDegradation(report, scene, `image asset ${cacheKey || scene.id} is missing or not a Figma-supported bitmap`);
    }
  } else {
    node = figma.createFrame();
    const freePositioning = capturedAbsoluteContainer(scene);
    const frameLayout = freePositioning ? { ...scene.layout, mode: "none" } : scene.layout;
    node.layoutMode = frameLayout?.mode === "horizontal" ? "HORIZONTAL" : frameLayout?.mode === "vertical" ? "VERTICAL" : "NONE";
    // Import the browser border-box first. Figma's default AUTO sizing can
    // otherwise hug only the currently attached placeholder/child list and
    // change the containing coordinate system while the tree is still being
    // built. Child sizing intent is restored later when it is geometrically
    // stable; the frame itself remains anchored to the measured capture.
    if (node.layoutMode !== "NONE") {
      if ("primaryAxisSizingMode" in node) {
        try { node.primaryAxisSizingMode = "FIXED"; } catch { /* optional API */ }
      }
      if ("counterAxisSizingMode" in node) {
        try { node.counterAxisSizingMode = "FIXED"; } catch { /* optional API */ }
      }
    }
    node.itemSpacing = (frameLayout?.mode === "horizontal" ? frameLayout?.columnGap : frameLayout?.rowGap) ?? frameLayout?.gap ?? 0;
    const padding = scene.layout?.padding || [0, 0, 0, 0];
    // `visuals()` enables `strokesIncludedInLayout` when the host supports it,
    // so the border itself already contributes to the Auto Layout content
    // origin. Keep the captured CSS padding unchanged; adding border widths
    // here would count the same inset twice.
    node.paddingTop = padding[0]; node.paddingRight = padding[1];
    node.paddingBottom = padding[2]; node.paddingLeft = padding[3];
  }
  node.name = scene.id;
  node.resize(Math.max(1, scene.rect.width), Math.max(1, scene.rect.height));
  // Preserve CSS min/max constraints after the measured border-box is set.
  // These constraints are especially important for percentage-sized flex
  // children: without them Figma can re-hug a container during append and
  // move every later sibling even when the captured rectangle was correct.
  applySizingConstraints(node, scene, parentScene);
  if (scene.opacity != null) node.opacity = scene.opacity;
  applyLayout(node, capturedAbsoluteContainer(scene) ? { ...scene, layout: { ...scene.layout, mode: "none" } } : scene);
  visuals(node, scene);
  recordSceneDegradations(scene, report);
  const unsupportedFilter = cssFilterHasUnsupportedParts(scene.filter, scene.type === "image");
  const unsupportedBackdropFilter = cssFilterHasUnsupportedParts(scene.backdropFilter);
  if (report && (unsupportedFilter || unsupportedBackdropFilter)) {
    report.styleDegradations += 1;
    if (report.styleDegradationNodes.length < 100) {
      report.styleDegradationNodes.push({
        id: scene.id,
        message: unsupportedFilter
          ? `filter ${scene.filter} contains effects that need manual review`
          : `backdrop-filter ${scene.backdropFilter} contains effects that need manual review`,
      });
    }
  }
  if (scene.type !== "image") backgroundImage(node, scene, assets, resources, report);
  applyBackgroundBlendModes(node, scene);
  const geometryLock = Boolean(scene.layout?.geometryLock);
  const cssAbsolute = scene.layout?.position === "absolute"
    || scene.positioning === "absolute"
    || scene.positioning === "fixed"
    || scene.positioning === "sticky";
  const explicitAbsolute = cssAbsolute;
  const measuredPosition = cssAbsolute || geometryLock;
  const parentUsesAutoLayout = parent.type !== "PAGE" && "layoutMode" in parent && parent.layoutMode !== "NONE";
  const relativeOffset = scene.positioning === "relative" ? scene.positionOffset || { left: 0, top: 0 } : { left: 0, top: 0 };
  const hasRelativeOffset = Math.abs(relativeOffset.left || 0) > 0.01 || Math.abs(relativeOffset.top || 0) > 0.01;
  const useAbsoluteForRelative = parentUsesAutoLayout && hasRelativeOffset;
  // Keep ordinary flex children in the parent's real Auto Layout flow. The
  // capture stage marks wrapped/grid cells and explicit out-of-flow layers
  // with geometryLock when a measured snapshot is required. Locking every
  // text or block child here would replace the editable hierarchy with
  // invisible placeholders and make gap/padding offsets compound.
  const useMeasuredSnapshot = parentUsesAutoLayout
    && !explicitAbsolute
    && !useAbsoluteForRelative
    && geometryLock;
  // Parent-dependent layout properties are applied after appendChild().
  // Figma rejects sizing, alignment, and ABSOLUTE positioning on a detached
  // node because it cannot validate the parent Auto Layout mode yet.
  // The browser capture is the geometry source of truth. Applying FILL/HUG
  // before a child has its font, text box, and descendants resolved makes
  // Figma reflow every existing sibling during append; one font-metric
  // difference then cascades through the entire page. Import every child at
  // its captured size first. The parent still keeps its Auto Layout mode,
  // direction, padding, and gap, while measured coordinates remain stable.
  // A later opt-in sizing pass can safely restore a flexible mode only when it
  // does not change the captured bounds.
  const parentDirection = parentScene?.layout?.mode;
  const shouldStretch = parentScene?.layout?.alignItems === "stretch"
    && ((parentDirection === "vertical" && scene.layout?.widthMode === "fill")
      || (parentDirection === "horizontal" && scene.layout?.heightMode === "fill"));
  const marginLayout = marginForAutoLayout(scene, parent);
  const hasCrossMargin = marginLayout.crossStart > 0.01 || marginLayout.crossEnd > 0.01;
  const beforeMarginSpacer = marginSpacerSize(marginLayout.before, parentScene);
  const afterMarginSpacer = marginSpacerSize(marginLayout.after, parentScene);
  if (parentUsesAutoLayout && beforeMarginSpacer > 0.01 && !explicitAbsolute) {
    createMarginSpacer(parent, beforeMarginSpacer, marginLayout.mode, true, scene.id);
  }
  parent.appendChild(node);
  // Figma only accepts child sizing/alignment writes after the node belongs
  // to an Auto Layout frame. Keep every imported child fixed while the tree
  // is assembled; restore safe HUG/FILL intent in restoreStableSizing().
  if (parentUsesAutoLayout && "layoutSizingHorizontal" in node && "layoutSizingVertical" in node) {
    try {
      node.layoutSizingHorizontal = "FIXED";
      node.layoutSizingVertical = "FIXED";
    } catch {
      // Keep the measured position path available for node types with
      // read-only sizing constraints.
    }
  }
  if (parentUsesAutoLayout && shouldStretch && "layoutAlign" in node) {
    // Figma has no per-child cross-axis margin. Keep the captured border-box
    // fixed when CSS consumes part of the available cross axis with margins;
    // the measured correction below applies the visual inset with a relative
    // transform while the node remains in the parent's Auto Layout flow.
    node.layoutAlign = hasCrossMargin ? "INHERIT" : "STRETCH";
  } else if (parentUsesAutoLayout && scene.layout?.alignSelf && scene.layout.alignSelf !== "auto" && "layoutAlign" in node) {
    node.layoutAlign = scene.layout.alignSelf === "stretch" ? "STRETCH" : "INHERIT";
  }
  // CSS 3D/double borders are not expressible as one Figma stroke. Add
  // small absolute paint layers after the parent exists so the browser's
  // per-side shading remains visible without entering Auto Layout flow.
  createBorderDecorations(node, scene);
  // The placeholder must be created after the visible node is attached. When
  // it is created before appendChild(), it has no source index and the helper
  // appends it to the end of the parent. That changes the Auto Layout order
  // for every later sibling, which is especially visible in wrapped/grid
  // captures and in relative children with cross-axis margins.
  if ((measuredPosition || useAbsoluteForRelative || useMeasuredSnapshot)
    && parentUsesAutoLayout
    && "layoutPositioning" in node) {
    if (useAbsoluteForRelative || useMeasuredSnapshot) {
      createMarginFlowPlaceholder(parent, node, marginLayout.mode, scene.id, marginLayout.crossStart + marginLayout.crossEnd);
    }
    node.layoutPositioning = "ABSOLUTE";
    if ("layoutSizingHorizontal" in node && "layoutSizingVertical" in node) {
      node.layoutSizingHorizontal = "FIXED";
      node.layoutSizingVertical = "FIXED";
    }
  }
  if ((measuredPosition || useAbsoluteForRelative || useMeasuredSnapshot) && "x" in node && "y" in node) {
    const measuredPosition = measuredTextPosition(scene, parentScene);
    node.x = measuredPosition.x;
    node.y = measuredPosition.y;
  } else if (parent.type === "PAGE" || ("layoutMode" in parent && parent.layoutMode === "NONE")) {
    node.x = scene.rect.x || 0;
    node.y = scene.rect.y || 0;
  }
  // Apply the measured glyph inset only when this node owns its coordinates.
  // A normal Auto Layout text child gets its x/y from the parent's flow; a
  // glyph-box correction written onto that child becomes a second layout
  // offset and shifts the baseline or following siblings.
  if (!measuredPosition && !parentUsesAutoLayout) applyTextRectOffset(node, scene);
  for (const child of orderedSceneChildren(scene)) {
    await createNode(child, node, assets, report, scene, resources, progress);
  }
  if (parentUsesAutoLayout && afterMarginSpacer > 0.01 && !explicitAbsolute) {
    createMarginSpacer(parent, afterMarginSpacer, marginLayout.mode, false, scene.id);
  }
  reorderPositionedChildren(node, scene);
  // Do not correct this subtree while its parent is still receiving siblings.
  // Center/space-between Auto Layout positions are intentionally provisional
  // during insertion; correcting them here would see an incomplete sibling
  // list and permanently convert a normal-flow child into an absolute layer.
  // The import entry point runs the authoritative correction after the entire
  // tree has been appended and Figma has settled its layout.
  applyTransform(node, scene);
  applyFlowTextGlyphOffset(node, scene, parentUsesAutoLayout);
  return node;
}

figma.ui.onmessage = async (message) => {
  if (message.type === "inspect-page") {
    const count = figma.currentPage.children.length;
    figma.ui.postMessage({
      type: "page-info",
      count,
    });
    return;
  }
  if (message.type !== "import-scene") return;
  try {
    // Prefer the shared scene marker when this clipboard was produced by
    // Neuxmind. The official H2D tree remains the compatibility fallback, but
    // rebuilding the scene from its HTML-shaped styles loses textRect and
    // rewrites geometry-locked positioning a second time.
    const sharedScene = message.scene && message.scene.root ? message.scene : null;
    const sourceNodeCount = countSceneNodes(sharedScene?.root || message.h2d?.root);
    // Repeated measured-geometry passes are expensive only for genuinely
    // large captures. Normal mobile pages are commonly 90-150 nodes; treating
    // those as limited leaves their final Auto Layout reflow uncorrected and
    // produces large downstream offsets. Keep the guard for unusually large
    // documents while giving normal captures the full audit cycle.
    const limitedGeometryCorrection = sourceNodeCount > 240;
    const rootScene = sharedScene
      // The native plugin's primary job is pixel-faithful editable output.
      // Keep every authored frame's Auto Layout metadata, but lock visible
      // descendants to the browser's measured parent-local rectangles. This
      // avoids cumulative font/border/fractional-flex drift while the flow
      // placeholders preserve the editable layout tracks.
      ? wrapCrossAxisMargins(mergeMeasuredGeometry(promoteImportRoot(sharedScene.root), message.h2d.root, { forceVisualLock: true }))
      : sceneFromH2D(message.h2d.root, { x: 0, y: 0 });
    const sceneAssets = sharedScene
      ? mergeSceneAssets(sharedScene.assets, message.h2d.assets)
      : (message.h2d.assets || []);
    // Keep imports inside the user's selected frame when there is one. This
    // makes repeated page imports usable in an existing composition while
    // preserving the page root as the default destination.
    // A stale selection is common after a previous import. Only treat a
    // single explicitly selected Frame/Component as the destination; using
    // the first matching node from a multi-selection can nest a fresh page
    // inside an older imported page and compound every captured coordinate.
    const parent = importParentForPage(figma.currentPage);
    const report = {
      geometryLocks: 0,
      maxGeometryDelta: 0,
      geometryLockNodes: [],
      flowNudges: 0,
      maxFlowNudge: 0,
      flowNudgeNodes: [],
      geometryResizes: 0,
      maxGeometryResize: 0,
      geometryResizeNodes: [],
      geometryAudited: 0,
      preCorrectionAudited: 0,
      preCorrectionMismatches: 0,
      preCorrectionMaxMeasuredDelta: 0,
      preCorrectionMaxMeasuredSizeDelta: 0,
      preCorrectionMismatchNodes: [],
      remainingGeometryAudited: 0,
      remainingMismatches: 0,
      maxRemainingMeasuredDelta: 0,
      maxRemainingMeasuredSizeDelta: 0,
      remainingMismatchNodes: [],
      geometryMismatches: 0,
      maxMeasuredDelta: 0,
      maxMeasuredSizeDelta: 0,
      geometryMismatchNodes: [],
      fontFallbacks: 0,
      fontFallbackNodes: [],
      styleDegradations: 0,
      styleDegradationNodes: [],
      sizingFallbacks: 0,
      sizingFallbackNodes: [],
      capturedDiagnostics: Array.isArray(message.diagnostics) ? message.diagnostics.length : 0,
      capturedDiagnosticNodes: Array.isArray(message.diagnostics) ? message.diagnostics.slice(0, 100) : [],
      visualSnapshot: Boolean(sharedScene),
      geometryCorrectionLimited: limitedGeometryCorrection,
      geometryCorrectionPasses: 0,
    };
    const progress = {
      created: 0,
      total: countSceneNodes(rootScene),
      lastPosted: 0,
    };
    reportImportProgress(progress, "creating");
    const root = await createNode(rootScene, parent, sceneAssets, report, undefined, {
      images: new Map(),
      vectors: new Map(),
    }, progress);
    reportImportProgress({ ...progress, created: progress.total, lastPosted: 0 }, "settling");
    await settleFigmaLayout();
    // Always perform one authoritative measured pass. Large scenes used to
    // skip this entirely to avoid the old multi-pass correction loop, which
    // left Figma's font metrics and Auto Layout rounding free to move locked
    // cards, headings, and navigation items by several pixels. One pass is
    // bounded, keeps the editable tree intact, and restores the browser
    // capture as the visual source of truth. Smaller scenes still receive the
    // additional settle/audit passes below because their cost is negligible.
    correctMeasuredGeometry(rootScene, root, report);
    report.geometryCorrectionPasses += 1;
    if (!limitedGeometryCorrection) {
      // Flexible sizing is restored only after the complete tree exists. This
      // preserves the captured Auto Layout intent where it is geometrically
      // stable, while preventing Figma from reflowing half-built branches.
      restoreStableSizing(rootScene, root, report);
      await settleFigmaLayout();
      correctMeasuredGeometry(rootScene, root, report);
      report.geometryCorrectionPasses += 1;
      for (let pass = 0; pass < 3; pass += 1) {
        resetRemainingGeometryAudit(report);
        auditRemainingGeometry(report, rootScene, root);
        if (report.remainingMismatches === 0) break;
        correctMeasuredGeometry(rootScene, root, report);
        report.geometryCorrectionPasses += 1;
        if (pass < 2) await settleFigmaLayout();
      }
    } else {
      // Very large imports still get one additional bounded pass. The first
      // correction can itself trigger a parent Auto Layout measurement, so an
      // immediate audit alone would report intermediate geometry and leave a
      // visible offset after the final layout turn.
      await settleFigmaLayout();
      correctMeasuredGeometry(rootScene, root, report);
      report.geometryCorrectionPasses += 1;
      resetRemainingGeometryAudit(report);
      auditRemainingGeometry(report, rootScene, root);
    }
    // Keep the existing summary fields stable for the UI while making them
    // reflect the final post-correction state. Detailed pre-correction data
    // remains available for diagnosing why a lock or resize was needed.
    report.geometryAudited = report.remainingGeometryAudited;
    report.geometryMismatches = report.remainingMismatches;
    report.maxMeasuredDelta = report.maxRemainingMeasuredDelta;
    report.maxMeasuredSizeDelta = report.maxRemainingMeasuredSizeDelta;
    report.geometryMismatchNodes = report.remainingMismatchNodes;
    sortGeometryMismatchNodes(report);
    // Repeated imports should remain independently inspectable. The captured
    // root coordinates are page-local and commonly start at (0, 0), so a new
    // top-level import would otherwise paint directly over previous results
    // and look like severe text/style drift. Only relocate a colliding root
    // on the Page itself; imports into an explicitly selected Frame retain
    // their authored local coordinates.
    placeRootWithoutOverlap(root, parent);
    figma.currentPage.selection = [root];
    figma.viewport.scrollAndZoomIntoView([root]);
    figma.ui.postMessage({ type: "import-complete", report });
  } catch (error) {
    figma.ui.postMessage({ type: "import-error", message: error instanceof Error ? error.message : "Import failed" });
  }
};
