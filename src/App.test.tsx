import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App";
import { createSeedState } from "./test/fixtures";
import { createEmptyState } from "./state/reducer";
import { PROJECT_NAME_STORAGE_KEY, STORAGE_KEY, serializeState } from "./state/storage";

/**
 * App owns its store, so tests seed the same versioned storage that a browser
 * session uses. This keeps the interaction tests close to the real refresh
 * path without exposing a test-only provider through production code.
 */
function seedBrowserState() {
  window.localStorage.clear();
  window.localStorage.setItem(STORAGE_KEY, serializeState(createSeedState()));
}

function findPageCard(title: string) {
  const titleButton = Array.from(document.querySelectorAll<HTMLButtonElement>(".page-name"))
    .find((button) => button.textContent?.trim() === title);
  return titleButton?.parentElement?.querySelector<HTMLElement>(":scope > [data-page-id]") ?? null;
}

function pageCard(title: string) {
  const card = findPageCard(title);
  expect(card).not.toBeNull();
  return card as HTMLElement;
}

beforeEach(() => {
  seedBrowserState();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  delete document.modelContext;
  vi.restoreAllMocks();
});

describe("Open Canvas workspace", () => {
  it("shows the branded project name by default", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Rename project" })).toHaveTextContent("Open Canvas");
  });

  it("collapses and restores the sidebar without changing canvas state", async () => {
    const user = userEvent.setup();
    render(<App />);
    const sidebar = screen.getByRole("complementary", { name: "Boards" });
    await user.click(within(sidebar).getByRole("button", { name: "Canvas" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const canvas = document.querySelector(".canvas-space");
    const transform = canvas?.getAttribute("style");
    const selectedCard = pageCard("Welcome concept");

    await user.click(screen.getByRole("button", { name: "Collapse boards" }));
    expect(sidebar).toHaveAttribute("inert");
    expect(sidebar).toHaveAttribute("aria-hidden", "true");
    expect(screen.queryByRole("complementary", { name: "Boards" })).not.toBeInTheDocument();
    const expand = screen.getByRole("button", { name: "Expand boards" });
    expect(expand).toHaveFocus();
    expect(selectedCard).toHaveClass("is-selected");
    expect(document.querySelector(".canvas-space")).toBe(canvas);
    expect(canvas).toHaveAttribute("style", transform);

    await user.click(expand);
    expect(sidebar).not.toHaveAttribute("inert");
    expect(screen.getByRole("button", { name: "Collapse boards" })).toHaveFocus();
    expect(screen.getByText("90%")).toBeInTheDocument();
    expect(canvas).toHaveAttribute("style", transform);
  });

  it("can collapse and expand the sidebar in Grid mode", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Grid" }));
    const grid = screen.getByRole("list", { name: "Pages in this board" });
    await user.click(screen.getByRole("button", { name: "Collapse boards" }));
    expect(document.querySelector(".app-shell")).toHaveClass("app-shell--sidebar-collapsed");
    expect(grid).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Expand boards" }));
    expect(screen.getByRole("button", { name: "Grid" })).toHaveAttribute("aria-pressed", "true");
  });

  it("switches the active board from the sidebar", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(within(screen.getByRole("complementary", { name: "Boards" })).getByRole("button", { name: /Explorations/ })).toHaveAttribute("aria-current", "page");
    expect(pageCard("Welcome concept")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Review queue/ }));

    const boards = screen.getByRole("complementary", { name: "Boards" });
    expect(within(boards).getByRole("button", { name: /Review queue/ })).toHaveAttribute("aria-current", "page");
    expect(document.querySelector(".main-panel--canvas")).toBeInTheDocument();
    expect(document.querySelector(".board-header")).not.toBeInTheDocument();
    expect(pageCard("Checkout flow")).toBeInTheDocument();
    expect(findPageCard("Welcome concept")).toBeNull();
  });

  it("switches layout mode from the project sidebar control", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(within(screen.getByRole("complementary", { name: "Boards" })).getByRole("button", { name: "Canvas" }));

    expect(screen.getByRole("toolbar", { name: "Canvas controls" })).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Boards" })).getByRole("button", { name: "Canvas" })).toHaveAttribute("aria-pressed", "true");
    expect(document.querySelector(".app-shell")).toHaveClass("app-shell--canvas");
    expect(document.querySelector(".board-header")).not.toBeInTheDocument();

    await user.click(within(screen.getByRole("complementary", { name: "Boards" })).getByRole("button", { name: "Grid" }));
    expect(document.querySelector(".app-shell")).not.toHaveClass("app-shell--canvas");
    expect(document.querySelector(".board-header")).not.toBeInTheDocument();
  });

  it("does not expose manual page creation controls", () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: "New page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add first page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "Add page" })).not.toBeInTheDocument();
  });

  it("renames the project inline and restores it after remounting", async () => {
    const user = userEvent.setup();
    const firstRender = render(<App />);
    await user.click(screen.getByRole("button", { name: "Rename project" }));
    const projectName = screen.getByRole("textbox", { name: "Project name" });
    await user.clear(projectName);
    await user.type(projectName, "Mobile Design Team{Enter}");

    expect(screen.getByRole("button", { name: "Rename project" })).toHaveTextContent("Mobile Design Team");
    expect(window.localStorage.getItem(PROJECT_NAME_STORAGE_KEY)).toBe("Mobile Design Team");

    firstRender.unmount();
    render(<App />);
    expect(screen.getByRole("button", { name: "Rename project" })).toHaveTextContent("Mobile Design Team");
  });

  it("keeps board creation but omits the integration footer", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "Create board" })).toBeInTheDocument();
    expect(screen.queryByText("Codex tools connected")).not.toBeInTheDocument();
    expect(screen.queryByText("Checking Codex tools")).not.toBeInTheDocument();
    expect(screen.queryByText("WebMCP guide")).not.toBeInTheDocument();
  });

  it("does not register browser Site tools by default", () => {
    const registerTool = vi.fn();
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: { registerTool },
    });

    render(<App />);
    expect(registerTool).not.toHaveBeenCalled();
    delete document.modelContext;
  });

  it("does not expose a manual annotation action", () => {
    render(<App />);

    expect(screen.queryByRole("button", { name: /Annotate/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: /Annotate/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/for annotation/i)).not.toBeInTheDocument();
  });

  it("edits an existing page without exposing an add-page flow", async () => {
    const user = userEvent.setup();
    render(<App />);

    const existingCard = pageCard("Welcome concept");
    await user.click(within(existingCard).getByLabelText("Actions for Welcome concept"));
    await user.click(within(existingCard).getByRole("menuitem", { name: "Edit page" }));

    const editDialog = screen.getByRole("dialog", { name: "Edit page" });
    const titleInput = within(editDialog).getByLabelText(/Page title/);
    await user.clear(titleInput);
    await user.type(titleInput, "Welcome concept v2");
    const sourceInput = within(editDialog).getByLabelText(/Generated HTML/);
    await user.clear(sourceInput);
    await user.type(sourceInput, "<main><h1>Updated by the design team</h1></main>");
    await user.click(within(editDialog).getByRole("button", { name: "Save changes" }));

    expect(pageCard("Welcome concept v2")).toBeInTheDocument();
    expect(findPageCard("Welcome concept")).toBeNull();
  });

  it("moves a page through the card action menu and confirms page deletion", async () => {
    const user = userEvent.setup();
    render(<App />);

    const welcomeCard = pageCard("Welcome concept");
    await user.click(within(welcomeCard).getByLabelText("Actions for Welcome concept"));
    await user.click(within(welcomeCard).getByRole("menuitem", { name: "Review queue" }));

    expect(findPageCard("Welcome concept")).toBeNull();
    await user.click(screen.getByRole("button", { name: /Review queue/ }));
    expect(pageCard("Welcome concept")).toBeInTheDocument();

    const movedCard = pageCard("Welcome concept");
    await user.click(within(movedCard).getByRole("button", { name: "Delete" }));

    const deleteDialog = screen.getByRole("dialog", { name: "Delete page?" });
    expect(deleteDialog).toHaveTextContent("Welcome concept");
    await user.click(within(deleteDialog).getByRole("button", { name: "Delete page" }));
    expect(findPageCard("Welcome concept")).toBeNull();
  });

  it("protects the last board from the UI delete action", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(STORAGE_KEY, serializeState(createEmptyState()));
    render(<App />);

    await user.click(screen.getByLabelText("Actions for New board"));
    await user.click(screen.getByRole("menuitem", { name: "Delete" }));

    expect(screen.queryByRole("dialog", { name: "Delete board" })).not.toBeInTheDocument();
    expect(screen.getByText("At least one board must remain.")).toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Boards" })).getByRole("button", { name: /New board/ })).toHaveAttribute("aria-current", "page");
  });

  it("closes a board action menu before and after a delete confirmation", async () => {
    const user = userEvent.setup();
    render(<App />);

    const menu = screen.getByLabelText("Actions for Explorations");
    const details = menu.closest("details");
    expect(details).not.toBeNull();
    await user.click(menu);
    expect(details).toHaveAttribute("open");

    await user.click(within(details as HTMLElement).getByRole("menuitem", { name: "Delete" }));
    expect(details).not.toHaveAttribute("open");
    const dialog = screen.getByRole("dialog", { name: "Delete board" });
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(details).not.toHaveAttribute("open");
  });

  it("keeps adjacent board rows clickable while a menu is open", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByLabelText("Actions for Explorations"));
    await user.click(screen.getByRole("button", { name: /Review queue/ }));

    expect(document.querySelector(".main-panel--canvas")).toBeInTheDocument();
    expect(document.querySelector(".board-header")).not.toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Board name" })).not.toBeInTheDocument();
  });

  it("cancels inline board renaming with Escape", async () => {
    const user = userEvent.setup();
    render(<App />);

    const boardMenu = screen.getByLabelText("Actions for Explorations");
    const boardMenuDetails = boardMenu.closest("details");
    expect(boardMenuDetails).not.toBeNull();
    await user.click(boardMenu);
    await user.click(within(boardMenuDetails as HTMLElement).getByRole("menuitem", { name: "Rename" }));
    const boardInput = screen.getByRole("textbox", { name: "Board name" });
    await user.clear(boardInput);
    await user.type(boardInput, "Should not be saved");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: "Board name" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("complementary", { name: "Boards" })).getByRole("button", { name: /Explorations/ })).toBeInTheDocument();
  });
});
