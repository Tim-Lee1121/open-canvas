#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { appReducer, type AppAction } from "../src/state/reducer";
import { createWebMcpTools, type ToolResult } from "../src/integrations/webmcp";
import { readProjectState, resolveLegacyProjectStatePath, resolveProjectStatePath, writeProjectState } from "./lib/board-state";
import { collectInlineIconAssets, syncInlineIconAssets } from "./lib/icon-assets";
import { DGA_MANIFEST, getDesignContext, validateHtmlDesign } from "../src/design-system/dgaProvider";
import {
  providerById,
  readDesignSystemRegistry,
  resolveBinding,
  resolveDesignSystemRegistryPath,
  writeDesignSystemRegistry,
  type DesignSystemRegistry,
} from "../src/design-system/registry";
import type { DesignSystemBinding, DesignSystemManifest } from "../src/design-system/types";

const TOOL_COMMANDS = new Set([
  "list-boards",
  "list-pages",
  "create-board",
  "rename-board",
  "delete-board",
  "create-page",
  "update-page",
  "move-page",
  "delete-page",
  "list-design-systems",
  "register-design-system",
  "inspect-design-system",
  "bind-design-system",
  "get-design-context",
  "validate-page-design",
]);

const VALUE_FLAGS: Record<string, { key: string; type: "string" | "number" }> = {
  "--board-id": { key: "boardId", type: "string" },
  "--board-index": { key: "boardIndex", type: "number" },
  "--target-board-id": { key: "targetBoardId", type: "string" },
  "--target-board-index": { key: "targetBoardIndex", type: "number" },
  "--target-index": { key: "targetIndex", type: "number" },
  "--page-id": { key: "pageId", type: "string" },
  "--title": { key: "title", type: "string" },
  "--name": { key: "name", type: "string" },
  "--layout-mode": { key: "layoutMode", type: "string" },
  "--index": { key: "index", type: "number" },
  "--x": { key: "x", type: "number" },
  "--y": { key: "y", type: "number" },
  "--url": { key: "url", type: "string" },
  "--html-file": { key: "htmlFile", type: "string" },
  "--output": { key: "output", type: "string" },
  "--skill-file": { key: "skillFile", type: "string" },
  "--system-id": { key: "systemId", type: "string" },
  "--theme": { key: "theme", type: "string" },
  "--intent": { key: "intent", type: "string" },
};

const BOOLEAN_FLAGS: Record<string, { key: string; value: boolean }> = {
  "--activate": { key: "activate", value: true },
  "--no-activate": { key: "activate", value: false },
  "--select": { key: "select", value: true },
  "--no-select": { key: "select", value: false },
};

function usage(): string {
  return `Open Canvas CLI

Usage:
  npm run board -- list-boards
  npm run board -- list-pages [--board-id ID | --board-index N]
  npm run board -- create-board --name NAME [--layout-mode canvas|grid]
  npm run board -- create-page --title TITLE (--html-file FILE | --url URL) [--board-id ID]
  npm run board -- update-page --page-id ID [--title TITLE] [--html-file FILE | --url URL]
  npm run board -- move-page --page-id ID (--target-board-id ID | --target-board-index N)
  npm run board -- delete-page --page-id ID
  npm run board -- export-page --page-id ID --output FILE
  npm run board -- list-design-systems
  npm run board -- register-design-system --skill-file PATH
  npm run board -- inspect-design-system --system-id ID
  npm run board -- bind-design-system --system-id ID [--board-id ID] [--page-id ID] [--theme light|dark]
  npm run board -- get-design-context [--board-id ID] [--page-id ID] [--intent TEXT]
  npm run board -- validate-page-design --page-id ID

All commands read and atomically update the local Board state outside the project. HTML imports
validate inline SVG path icons and synchronize standalone assets/icons files.
Use stable IDs returned by list-boards and list-pages.`;
}

function bindingForManifest(manifest: DesignSystemManifest, theme = manifest.theme): DesignSystemBinding {
  return {
    primary: { id: manifest.id, name: manifest.name, version: manifest.version, source: manifest.source, theme, status: manifest.status },
  };
}

async function registerDesignSystem(input: Record<string, unknown>, registry: DesignSystemRegistry): Promise<Record<string, unknown>> {
  const skillFile = input.skillFile;
  if (typeof skillFile !== "string" || !skillFile) throw new Error("--skill-file is required");
  const entrypoint = resolve(process.cwd(), skillFile);
  const contents = await readFile(entrypoint, "utf8");
  const digest = createHash("sha256").update(contents).digest("hex");
  const isDga = entrypoint === DGA_MANIFEST.source.entrypoint || entrypoint.endsWith("/dga-design-system/SKILL.md");
  const manifest: DesignSystemManifest = isDga ? {
    ...DGA_MANIFEST,
    source: { ...DGA_MANIFEST.source, entrypoint, digest },
    updatedAt: new Date().toISOString(),
  } : {
    ...DGA_MANIFEST,
    id: `skill-${digest.slice(0, 12)}`,
    name: entrypoint.split("/").at(-2) || "Design System",
    version: "0.0.0-local",
    source: { kind: "skill", entrypoint, digest },
    knowledgeRoot: dirname(entrypoint),
    tokens: [], components: [], patterns: [], hardStops: ["Provider manifest requires review before page generation."],
    readiness: { total: 0, levelA: 0, levelB: 0, levelC: 0, levelD: 0, executionComplete: 0 },
    provenance: [entrypoint],
    qaChecks: ["Provider readability", "Theme consistency", "Provenance"],
    status: "needs-review",
    updatedAt: new Date().toISOString(),
  };
  const providers = registry.providers.filter((item) => item.id !== manifest.id);
  providers.push(manifest);
  registry.providers = providers;
  registry.updatedAt = new Date().toISOString();
  return { system: manifest, registry: resolveDesignSystemRegistryPath() };
}

async function runDesignSystemCommand(command: string, input: Record<string, unknown>, state: Awaited<ReturnType<typeof readProjectState>>["state"], registry: DesignSystemRegistry): Promise<{ result: Record<string, unknown>; write: boolean; writeState?: boolean }> {
  if (command === "list-design-systems") return { result: { ok: true, action: "list_design_systems", data: { systems: registry.providers.map((system) => ({ id: system.id, name: system.name, version: system.version, theme: system.theme, themes: system.themes, status: system.status, digest: system.source.digest, readiness: system.readiness, updatedAt: system.updatedAt })) } }, write: false };
  if (command === "register-design-system") return { result: { ok: true, action: "register_design_system", data: await registerDesignSystem(input, registry) }, write: true };
  if (command === "inspect-design-system") {
    const id = input.systemId;
    if (typeof id !== "string") throw new Error("--system-id is required");
    const system = providerById(registry, id);
    if (!system) throw new Error(`Design System not found: ${id}`);
    return { result: { ok: true, action: "inspect_design_system", data: { system } }, write: false };
  }
  if (command === "bind-design-system") {
    const id = input.systemId;
    if (typeof id !== "string") throw new Error("--system-id is required");
    const system = providerById(registry, id);
    if (!system) throw new Error(`Design System not found: ${id}`);
    const boardId = typeof input.boardId === "string" ? input.boardId : undefined;
    const pageId = typeof input.pageId === "string" ? input.pageId : undefined;
    if (boardId && !state.boards.some((board) => board.id === boardId)) throw new Error(`Board not found: ${boardId}`);
    if (pageId && !state.pagesById[pageId]) throw new Error(`Page not found: ${pageId}`);
    if (!boardId && !pageId) registry.bindings.project = bindingForManifest(system, typeof input.theme === "string" ? input.theme : system.theme);
    else if (pageId) {
      const binding = bindingForManifest(system, typeof input.theme === "string" ? input.theme : system.theme);
      registry.bindings.pages[pageId] = binding;
      const page = state.pagesById[pageId];
      page.designSystemBinding = { ...binding.primary, digest: binding.primary.source.digest };
    }
    else registry.bindings.boards[boardId!] = bindingForManifest(system, typeof input.theme === "string" ? input.theme : system.theme);
    registry.updatedAt = new Date().toISOString();
    return { result: { ok: true, action: "bind_design_system", data: { systemId: id, boardId, pageId, theme: typeof input.theme === "string" ? input.theme : system.theme } }, write: true, writeState: Boolean(pageId) };
  }
  if (command === "get-design-context") {
    const boardId = typeof input.boardId === "string" ? input.boardId : state.activeBoardId;
    const pageId = typeof input.pageId === "string" ? input.pageId : undefined;
    const binding = resolveBinding(registry, boardId, pageId);
    const system = binding ? providerById(registry, binding.primary.id) : undefined;
    if (!binding || !system) return { result: { ok: true, action: "get_design_context", data: { status: "unbound", context: null } }, write: false };
    const context = system.id === DGA_MANIFEST.id ? {
      ...getDesignContext(typeof input.intent === "string" ? input.intent : undefined, binding.primary.theme),
      system: binding.primary,
    } : {
      system: binding.primary, theme: binding.primary.theme, pageIntent: typeof input.intent === "string" ? input.intent : undefined,
      patterns: system.patterns, components: system.components, tokens: system.tokens, hardStops: system.hardStops,
      readiness: system.readiness, provenance: system.provenance, qaChecks: system.qaChecks,
    };
    return { result: { ok: true, action: "get_design_context", data: { status: "ready", context } }, write: false };
  }
  if (command === "validate-page-design") {
    const pageId = input.pageId;
    if (typeof pageId !== "string") throw new Error("--page-id is required");
    const page = state.pagesById[pageId];
    if (!page) throw new Error(`Page not found: ${pageId}`);
    if (page.source.type !== "html") return { result: { ok: true, action: "validate_page_design", data: { pageId, result: { status: "unbound", issues: [{ severity: "warning", code: "url-source", message: "URL pages require external capture." }] } } }, write: false };
    const binding = resolveBinding(registry, page.boardId, page.id);
    const expectedTheme = binding?.primary.theme ?? DGA_MANIFEST.theme;
    const result = validateHtmlDesign(page.source.value, expectedTheme, binding?.primary.source.digest ?? DGA_MANIFEST.source.digest);
    if (binding && page.designSystemBinding && (page.designSystemBinding.version !== binding.primary.version || page.designSystemBinding.digest !== binding.primary.source.digest)) {
      result.status = "blocked";
      result.issues.push({ severity: "block", code: "binding-digest-mismatch", message: "Page record binding does not match the resolved registry binding." });
    }
    return { result: { ok: true, action: "validate_page_design", data: { pageId, binding: binding ?? null, pageBinding: page.designSystemBinding ?? null, result } }, write: false };
  }
  throw new Error(`Unknown Design System command: ${command}`);
}

function parseArguments(args: string[]): Record<string, unknown> {
  const parsed: Record<string, unknown> = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const booleanFlag = BOOLEAN_FLAGS[flag];
    if (booleanFlag) {
      parsed[booleanFlag.key] = booleanFlag.value;
      continue;
    }
    const definition = VALUE_FLAGS[flag];
    if (!definition) throw new Error(`Unknown option: ${flag}`);
    const rawValue = args[index + 1];
    if (rawValue === undefined || rawValue.startsWith("--")) {
      throw new Error(`Missing value for ${flag}`);
    }
    index += 1;
    if (definition.type === "number") {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) throw new Error(`${flag} must be a number`);
      parsed[definition.key] = value;
    } else {
      parsed[definition.key] = rawValue;
    }
  }
  return parsed;
}

interface AttachedSource {
  input: Record<string, unknown>;
  htmlFilePath?: string;
  html?: string;
}

async function attachSource(input: Record<string, unknown>): Promise<AttachedSource> {
  const htmlFile = input.htmlFile;
  const url = input.url;
  if (htmlFile !== undefined && url !== undefined) {
    throw new Error("Provide either --html-file or --url, not both");
  }
  const next = { ...input };
  delete next.htmlFile;
  delete next.url;
  if (typeof htmlFile === "string") {
    const htmlFilePath = resolve(process.cwd(), htmlFile);
    const html = await readFile(htmlFilePath, "utf8");
    collectInlineIconAssets(html);
    next.sourceType = "html";
    next.source = html;
    return { input: next, htmlFilePath, html };
  } else if (typeof url === "string") {
    next.sourceType = "url";
    next.source = url;
  }
  return { input: next };
}

async function exportPage(
  state: Awaited<ReturnType<typeof readProjectState>>["state"],
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const pageId = input.pageId;
  const output = input.output;
  if (typeof pageId !== "string" || !pageId) throw new Error("--page-id is required");
  if (typeof output !== "string" || !output) throw new Error("--output is required");
  const page = Object.prototype.hasOwnProperty.call(state.pagesById, pageId)
    ? state.pagesById[pageId]
    : undefined;
  if (!page) throw new Error(`Page not found: ${pageId}`);
  if (page.source.type !== "html") throw new Error("Only HTML page sources can be exported");
  const outputPath = resolve(process.cwd(), output);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, page.source.value, "utf8");
  const iconAssets = await syncInlineIconAssets(outputPath, page.source.value);
  return { ok: true, action: "export_page", data: { pageId, output: outputPath, iconAssets } };
}

async function run(): Promise<void> {
  const cliArgs = process.argv.slice(2);
  if (cliArgs[0] === "--") cliArgs.shift();
  const [command, ...rawArgs] = cliArgs;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (command !== "export-page" && !TOOL_COMMANDS.has(command)) {
    throw new Error(`Unknown command: ${command}\n\n${usage()}`);
  }

  const hasExplicitStateFile = Boolean(process.env.AI_PAGE_BOARD_STATE_FILE);
  const stateFile = hasExplicitStateFile
    ? resolve(process.env.AI_PAGE_BOARD_STATE_FILE as string)
    : resolveProjectStatePath();
  const snapshot = await readProjectState(stateFile, hasExplicitStateFile ? undefined : resolveLegacyProjectStatePath());
  const parsedInput = parseArguments(rawArgs);
  const registryPath = resolveDesignSystemRegistryPath();
  const registry = await readDesignSystemRegistry(registryPath);

  if (command.endsWith("design-system") || command === "list-design-systems" || command === "register-design-system" || command === "inspect-design-system" || command === "bind-design-system" || command === "get-design-context" || command === "validate-page-design") {
    const designSystem = await runDesignSystemCommand(command, parsedInput, snapshot.state, registry);
    if (designSystem.write) await writeDesignSystemRegistry(registry, registryPath);
    if (designSystem.writeState) await writeProjectState(snapshot.state, stateFile);
    process.stdout.write(`${JSON.stringify(designSystem.result, null, 2)}\n`);
    return;
  }

  if (command === "export-page") {
    process.stdout.write(`${JSON.stringify(await exportPage(snapshot.state, parsedInput), null, 2)}\n`);
    return;
  }

  let state = snapshot.state;
  const runtime = {
    getState: () => state,
    dispatch: (action: AppAction) => {
      state = appReducer(state, action);
      return state;
    },
  };
  const toolName = command.replaceAll("-", "_");
  const tool = createWebMcpTools<AppAction>(runtime).find((candidate) => candidate.name === toolName);
  if (!tool) throw new Error(`No board tool is registered for ${command}`);
  const attached = await attachSource(parsedInput);
  const result = await tool.execute(attached.input, { signal: new AbortController().signal }) as ToolResult;
  if (result.ok && attached.htmlFilePath && attached.html) {
    result.data.iconAssets = await syncInlineIconAssets(attached.htmlFilePath, attached.html);
  }
  if (result.ok && !command.startsWith("list-")) await writeProjectState(state, stateFile);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 1;
}

run().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: "cli_error", message } }, null, 2)}\n`);
  process.exitCode = 1;
});
