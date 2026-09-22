#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { appReducer, type AppAction } from "../src/state/reducer";
import { createWebMcpTools, type ToolResult } from "../src/integrations/webmcp";
import { readProjectState, resolveLegacyProjectStatePath, resolveProjectStatePath, writeProjectState } from "./lib/board-state";
import { collectInlineIconAssets, syncInlineIconAssets } from "./lib/icon-assets";

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

All commands read and atomically update the local Board state outside the project. HTML imports
validate inline SVG path icons and synchronize standalone assets/icons files.
Use stable IDs returned by list-boards and list-pages.`;
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
