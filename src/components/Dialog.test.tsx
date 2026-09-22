import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { DIALOG_EXIT_MS, Dialog } from "./Dialog";
import { Sidebar } from "./Sidebar";
import { createSeedState } from "../test/fixtures";
import { getFocusableElements } from "./focus";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Dialog focus management", () => {
  it("traps Tab and restores focus to the opener on Escape", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
          <Dialog
            open={open}
            title="Test dialog"
            onClose={() => setOpen(false)}
            footer={<button type="button">Confirm</button>}
          >
            <input aria-label="Dialog field" />
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Test dialog" });
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    const field = within(dialog).getByRole("textbox", { name: "Dialog field" });
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });

    expect(document.activeElement).toBe(close);
    await user.tab();
    expect(document.activeElement).toBe(field);
    await user.tab();
    expect(document.activeElement).toBe(confirm);
    await user.tab();
    expect(document.activeElement).toBe(close);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(confirm);

    await user.keyboard("{Escape}");
    expect(dialog.closest(".dialog-backdrop")).toHaveAttribute("data-state", "closing");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Test dialog" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });

  it("does not treat an auto-focused dialog field as its own opener", async () => {
    const user = userEvent.setup();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open dialog</button>
          <Dialog open={open} title="Auto focus dialog" onClose={() => setOpen(false)}>
            <input aria-label="Auto-focused field" autoFocus />
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open dialog" });
    await user.click(opener);
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "Auto-focused field" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Auto focus dialog" })).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });

  it("blocks repeated actions while exiting, cancels a stale exit when reopened, and restores focus", () => {
    vi.useFakeTimers();
    const onClose = vi.fn();

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open animated dialog</button>
          <Dialog
            open={open}
            title="Animated dialog"
            onClose={() => {
              onClose();
              setOpen(false);
            }}
          >
            <button type="button" onClick={onClose}>Child action</button>
          </Dialog>
        </>
      );
    }

    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open animated dialog" });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Animated dialog" });
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    const childAction = within(dialog).getByRole("button", { name: "Child action" });

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(dialog.closest(".dialog-backdrop")).toHaveAttribute("data-state", "closing");
    fireEvent.click(close);
    fireEvent.click(childAction);
    fireEvent.submit(dialog.querySelector("form") ?? dialog);
    expect(onClose).toHaveBeenCalledTimes(1);

    act(() => vi.advanceTimersByTime(DIALOG_EXIT_MS / 2));
    expect(screen.getByRole("dialog", { name: "Animated dialog" })).toBeInTheDocument();

    // A programmatic reopen during the exit window must cancel the old timer.
    fireEvent.click(opener);
    expect(screen.getByRole("dialog", { name: "Animated dialog" }).closest(".dialog-backdrop")).toHaveAttribute("data-state", "open");
    act(() => vi.advanceTimersByTime(DIALOG_EXIT_MS));
    expect(screen.getByRole("dialog", { name: "Animated dialog" })).toBeInTheDocument();

    fireEvent.click(within(screen.getByRole("dialog", { name: "Animated dialog" })).getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(2);
    act(() => vi.advanceTimersByTime(DIALOG_EXIT_MS));
    expect(screen.queryByRole("dialog", { name: "Animated dialog" })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it("keeps the last open content stable during exit", () => {
    vi.useFakeTimers();

    function Harness() {
      const [open, setOpen] = useState(true);
      const [replacement, setReplacement] = useState(false);
      return (
        <Dialog
          open={open}
          title={replacement ? "New board" : "Rename board"}
          description={replacement ? "Replacement description" : "Original description"}
          onClose={() => {
            setOpen(false);
            setReplacement(true);
          }}
          footer={<button type="button">{replacement ? "Create" : "Save name"}</button>}
        >
          <p>{replacement ? "Replacement body" : "Original body"}</p>
        </Dialog>
      );
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    const dialog = screen.getByRole("dialog", { name: "Rename board" });
    expect(dialog).toHaveTextContent("Original description");
    expect(dialog).toHaveTextContent("Original body");
    expect(within(dialog).getByRole("button", { name: "Save name" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "New board" })).not.toBeInTheDocument();
  });

  it("exits immediately when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })));

    function Harness() {
      const [open, setOpen] = useState(true);
      return <Dialog open={open} title="Reduced motion dialog" onClose={() => setOpen(false)}>Content</Dialog>;
    }

    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(screen.queryByRole("dialog", { name: "Reduced motion dialog" })).not.toBeInTheDocument();
  });
});

describe("mobile Sidebar focus management", () => {
  it("cycles focus inside the drawer and closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const boards = createSeedState().boards;
    const { rerender } = render(
      <Sidebar
        boards={boards}
        activeBoardId={boards[0].id}
        isMobile
        isOpen={false}
        onClose={onClose}
        onCreateBoard={vi.fn()}
      />,
    );
    rerender(
      <Sidebar
        boards={boards}
        activeBoardId={boards[0].id}
        isMobile
        isOpen
        onClose={onClose}
        onCreateBoard={vi.fn()}
      />,
    );

    const sidebar = screen.getByRole("complementary", { name: "Boards" });
    const close = screen.getByRole("button", { name: "Close boards" });
    await waitFor(() => expect(document.activeElement).toBe(close));

    const focusable = getFocusableElements(sidebar);
    expect(focusable.length).toBeGreaterThan(2);
    const last = focusable[focusable.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusable[0]);

    focusable[0].focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);

    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not compete with a modal opened above the drawer", () => {
    const onCloseSidebar = vi.fn();
    const onCloseDialog = vi.fn();
    const boards = createSeedState().boards;
    render(
      <>
        <Sidebar
          boards={boards}
          activeBoardId={boards[0].id}
          isMobile
          isOpen
          onClose={onCloseSidebar}
        />
        <Dialog open title="Modal above drawer" onClose={onCloseDialog}>
          <p>Content</p>
        </Dialog>
      </>,
    );

    const dialog = screen.getByRole("dialog", { name: "Modal above drawer" });
    const close = within(dialog).getByRole("button", { name: "Close dialog" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCloseDialog).toHaveBeenCalledTimes(1);
    expect(onCloseSidebar).not.toHaveBeenCalled();
  });

  it("keeps the drawer open when Escape cancels inline renaming", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const boards = createSeedState().boards;
    render(
      <Sidebar
        boards={boards}
        activeBoardId={boards[0].id}
        isMobile
        isOpen
        onClose={onClose}
        onRenameBoard={vi.fn()}
      />,
    );

    const actions = screen.getByLabelText(`Actions for ${boards[0].name}`);
    await user.click(actions);
    const actionMenu = actions.closest("details");
    expect(actionMenu).not.toBeNull();
    await user.click(within(actionMenu as HTMLElement).getByRole("menuitem", { name: "Rename" }));
    const input = screen.getByRole("textbox", { name: "Board name" });
    await user.type(input, " changed");
    await user.keyboard("{Escape}");

    expect(screen.queryByRole("textbox", { name: "Board name" })).not.toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "Boards" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
