import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DesignSystemView } from "./DesignSystemView";

afterEach(cleanup);

describe("DesignSystemView visual catalogs", () => {
  it("renders token scales and keeps the provider index available", () => {
    render(<DesignSystemView />);

    fireEvent.click(screen.getByRole("tab", { name: /Tokens/ }));

    expect(screen.getByText("Color system")).toBeInTheDocument();
    expect(screen.getByText("Spacing scale")).toBeInTheDocument();
    expect(screen.getByText("Radius scale")).toBeInTheDocument();
    expect(screen.getByText("Typography scale")).toBeInTheDocument();
    expect(screen.getByText("Light theme semantic preview")).toBeInTheDocument();
    expect(screen.getByText("Token index")).toBeInTheDocument();
    expect(screen.getByText("Tailwind token contract")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Tokens" }).closest(".design-system-section-heading")).toHaveClass("design-system-section-heading--flush");
  });

  it("renders visual component previews with readiness metadata", () => {
    render(<DesignSystemView />);

    fireEvent.click(screen.getByRole("tab", { name: /Components/ }));

    expect(screen.getByText("Rendered previews for the documented DGA component contracts.")).toBeInTheDocument();
    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Workspace card")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Notifications" })).toBeInTheDocument();
    expect(screen.getAllByText("A · ready").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Complete").length).toBeGreaterThan(0);
  });

  it("keeps component interactions isolated inside their previews", () => {
    render(<DesignSystemView />);
    fireEvent.click(screen.getByRole("tab", { name: /Components/ }));

    const buttonCard = screen.getByText("Button", { selector: "h3" }).closest("article");
    expect(buttonCard).not.toBeNull();
    fireEvent.click(within(buttonCard as HTMLElement).getByRole("button", { name: "Primary" }));
    expect(within(buttonCard as HTMLElement).getByRole("status")).toHaveTextContent("Primary activated");

    const input = screen.getByLabelText("Text input");
    fireEvent.change(input, { target: { value: "Policy" } });
    expect(input).toHaveValue("Policy");
    expect(screen.getByText("6 characters")).toBeInTheDocument();

    const toggle = screen.getByRole("switch", { name: "Notifications" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-checked", "false");

    const detailsTab = screen.getByRole("tab", { name: "Details" });
    fireEvent.click(detailsTab);
    expect(screen.getByRole("tabpanel", { name: "Details" })).toHaveTextContent("Details panel");
    fireEvent.keyDown(detailsTab, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Activity" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel", { name: "Activity" })).toHaveTextContent("Activity panel");

    fireEvent.click(screen.getByRole("button", { name: "Open modal" }));
    const dialog = screen.getByRole("dialog", { name: "Overlay surface" });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close modal" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Overlay surface" })).not.toBeInTheDocument();
  });
});
