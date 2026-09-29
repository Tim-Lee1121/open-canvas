import type {
  DesignContextBundle,
  DesignSystemComponentSummary,
  DesignSystemManifest,
  DesignSystemPatternSummary,
  DesignSystemTokenSummary,
  DesignValidationIssue,
  DesignValidationResult,
} from "./types";

// Keep provenance portable. A consumer may resolve this logical root to its
// local Skill installation, but the published source must not embed a
// maintainer's home-directory path.
const dgaRoot = "dga-design-system/references/design-system";

function manifestRef(theme = DGA_MANIFEST.theme) {
  return {
    id: DGA_MANIFEST.id,
    name: DGA_MANIFEST.name,
    version: DGA_MANIFEST.version,
    source: DGA_MANIFEST.source,
    theme,
    status: DGA_MANIFEST.status,
  } as const;
}

const components: DesignSystemComponentSummary[] = [
  ["button", "Button", "Actions"], ["card", "Card", "Data Display"], ["charts", "Charts", "Data Display"],
  ["metric", "Metric", "Data Display"], ["table", "Table", "Data Display"], ["tag", "Tag", "Data Display"],
  ["nav-header", "Nav Header", "UI Shell"], ["nav-drawer", "Nav Drawer", "UI Shell"],
  ["second-level-nav-header", "Second Level Nav Header", "UI Shell"], ["tabs", "Tabs", "Navigation"],
  ["content-switcher", "Content Switcher", "Navigation"], ["breadcrumb", "Breadcrumb", "Navigation"],
  ["search-box", "Search Box", "Inputs"], ["text-input", "Text Input", "Inputs"], ["textarea", "Textarea", "Inputs"],
  ["checkbox", "Checkbox", "Inputs"], ["radio", "Radio", "Inputs"], ["switch", "Switch", "Inputs"],
  ["modal", "Modal", "Overlays"], ["tooltip", "Tooltip", "Overlays"], ["inline-alert", "Inline Alert", "Feedback"],
].map(([slug, name, category]) => ({
  slug, name, category, readiness: "A", executionContract: "Complete",
  source: `${dgaRoot}/03-components/${slug}/README.md`,
}));

const patterns: DesignSystemPatternSummary[] = [
  { slug: "app-shell-dashboard", name: "App Shell Dashboard", source: `${dgaRoot}/04-patterns/app-shell-dashboard.md` },
  { slug: "data-workspace-page", name: "Data Workspace Page", source: `${dgaRoot}/04-patterns/data-workspace-page.md` },
  { slug: "chart-card-composition", name: "Chart Card Composition", source: `${dgaRoot}/04-patterns/chart-card-composition.md` },
];

const tokens: DesignSystemTokenSummary[] = [
  { id: "foundation.colors", label: "Colors", category: "foundation", value: "138 values", source: `${dgaRoot}/01-foundations/values-colors.md` },
  { id: "foundation.spacing", label: "Spacing", category: "foundation", value: "32 values", source: `${dgaRoot}/01-foundations/values-spacing.md` },
  { id: "foundation.radius", label: "Radius", category: "foundation", value: "7 values", source: `${dgaRoot}/01-foundations/values-radius.md` },
  { id: "foundation.typography", label: "Typography", category: "foundation", value: "68 values", source: `${dgaRoot}/01-foundations/values-typography.md` },
  { id: "theme.light", label: "Light theme", category: "theme", value: "366 tokens", source: `${dgaRoot}/02-themes/light/index.md` },
  { id: "theme.dark", label: "Dark theme", category: "theme", value: "366 tokens", source: `${dgaRoot}/02-themes/dark/index.md` },
  { id: "execution.tailwind", label: "Tailwind token contract", category: "semantic", source: `${dgaRoot}/00-execution/tailwind-token-contract.md` },
];

export const DGA_MANIFEST: DesignSystemManifest = {
  id: "dga-design-system",
  name: "DGA Design System",
  version: "1.0.0",
  source: { kind: "skill", entrypoint: "dga-design-system/SKILL.md", digest: "6a9facdf2da4c2c9fad186a2487f073fc7b1bec26f9bdd7b17b9b537e90c849e" },
  theme: "light",
  status: "ready",
  knowledgeRoot: dgaRoot,
  themes: ["light", "dark"],
  tokens,
  components,
  patterns,
  hardStops: [
    "Read ai-style-contract.md and tailwind-token-contract.md before implementation.",
    "Do not use Tailwind defaults as Figma token values.",
    "Do not mix Light and Dark theme tokens.",
    "Components below A readiness require visual review or Figma extraction.",
  ],
  qaChecks: ["Token traceability", "Theme consistency", "State coverage", "Semantic DOM/ARIA", "Responsive overflow", "Figma visual QA"],
  readiness: { total: 51, levelA: 51, levelB: 0, levelC: 0, levelD: 0, executionComplete: 51 },
  provenance: [
    `${dgaRoot}/00-execution/README.md`,
    `${dgaRoot}/00-execution/ai-style-contract.md`,
    `${dgaRoot}/00-execution/tailwind-token-contract.md`,
    `${dgaRoot}/99-maintenance/component-style-readiness-audit.md`,
    `${dgaRoot}/_rag/index.json`,
  ],
  updatedAt: "2026-09-23T00:00:00.000Z",
};

export function getDesignContext(intent?: string, theme = DGA_MANIFEST.theme): DesignContextBundle {
  const selectedPattern = intent?.toLowerCase().includes("chart")
    ? patterns.find((pattern) => pattern.slug === "chart-card-composition")
    : patterns.find((pattern) => pattern.slug === "data-workspace-page");
  return {
    system: manifestRef(theme),
    theme,
    pageIntent: intent,
    patterns: selectedPattern ? [selectedPattern] : patterns,
    components: components.slice(0, 12),
    tokens: tokens.filter((token) => token.category !== "theme" || token.id === `theme.${theme}`),
    hardStops: DGA_MANIFEST.hardStops,
    readiness: DGA_MANIFEST.readiness,
    provenance: DGA_MANIFEST.provenance,
    qaChecks: DGA_MANIFEST.qaChecks,
  };
}

function issue(severity: DesignValidationIssue["severity"], code: string, message: string, source?: string): DesignValidationIssue {
  return { severity, code, message, ...(source ? { source } : {}) };
}

export function validateHtmlDesign(html: string, expectedTheme = DGA_MANIFEST.theme, expectedDigest = DGA_MANIFEST.source.digest): DesignValidationResult {
  const metaSystem = html.match(/<meta[^>]+name=["']open-canvas-design-system["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const metaTheme = html.match(/<meta[^>]+name=["']open-canvas-design-theme["'][^>]+content=["']([^"']+)["']/i)?.[1];
  const issues: DesignValidationIssue[] = [];
  if (!metaSystem) return { status: "unbound", issues: [issue("warning", "unbound", "Page does not declare an Open Canvas Design System binding.")] };
  if (metaSystem !== `${DGA_MANIFEST.id}@${DGA_MANIFEST.version}`) issues.push(issue("block", "system-mismatch", `Page binding ${metaSystem} does not match ${DGA_MANIFEST.id}@${DGA_MANIFEST.version}.`));
  if (!metaTheme) issues.push(issue("block", "theme-missing", "Page does not declare a Design System theme."));
  if (metaTheme && metaTheme !== expectedTheme) issues.push(issue("block", "theme-mismatch", `Page theme ${metaTheme} does not match expected ${expectedTheme}.`));
  const digest = html.match(/<meta[^>]+name=["']open-canvas-design-system-digest["'][^>]+content=["']([^"']+)["']/i)?.[1];
  if (!digest) issues.push(issue("warning", "provenance-missing", "Page does not declare a Design System source digest."));
  else if (expectedDigest && digest !== expectedDigest) issues.push(issue("block", "digest-mismatch", `Page digest ${digest} does not match the resolved provider digest.`));
  const componentCount = (html.match(/data-ds-component=/g) ?? []).length;
  const patternCount = (html.match(/data-ds-pattern=/g) ?? []).length;
  if (componentCount === 0) issues.push(issue("warning", "components-unmarked", "No data-ds-component markers were found."));
  if (patternCount === 0) issues.push(issue("warning", "pattern-unmarked", "No data-ds-pattern marker was found."));
  const componentIds = [...html.matchAll(/data-ds-component=["']([^"']+)["']/gi)].map((match) => match[1]);
  const patternIds = [...html.matchAll(/data-ds-pattern=["']([^"']+)["']/gi)].map((match) => match[1]);
  for (const id of componentIds.filter((item, index, all) => all.indexOf(item) === index)) {
    if (!components.some((component) => component.slug === id)) issues.push(issue("block", "unknown-component", `Unknown Design System component marker: ${id}.`));
  }
  for (const id of patternIds.filter((item, index, all) => all.indexOf(item) === index)) {
    if (!patterns.some((pattern) => pattern.slug === id)) issues.push(issue("block", "unknown-pattern", `Unknown Design System pattern marker: ${id}.`));
  }
  if (!/<button\b[^>]*aria-|<input\b[^>]*aria-|role=/i.test(html)) issues.push(issue("warning", "semantic-review", "Interactive semantics require browser/ARIA review."));
  if (issues.some((item) => item.severity === "block")) return { status: "blocked", system: manifestRef(metaTheme ?? expectedTheme), theme: metaTheme, issues };
  if (issues.length > 0) return { status: "passed-with-warning", system: manifestRef(metaTheme ?? expectedTheme), theme: metaTheme, issues };
  return { status: "passed", system: manifestRef(metaTheme ?? expectedTheme), theme: metaTheme, issues: [issue("pass", "validated", "Design System binding and page markers are valid.")] };
}
