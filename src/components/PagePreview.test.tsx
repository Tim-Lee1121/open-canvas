import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSeedState } from "../test/fixtures";
import { PagePreview } from "./PagePreview";

describe("PagePreview", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("removes the loading overlay after the current URL iframe loads", () => {
    const page = createSeedState().pagesById["page-demo-example"];

    render(<PagePreview page={page} />);

    expect(screen.getByLabelText("Loading preview")).toBeInTheDocument();
    const frame = screen.getByTitle("Reference website preview");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");

    fireEvent.load(frame);

    expect(screen.queryByLabelText("Loading preview")).not.toBeInTheDocument();
    expect(screen.getByTitle("Reference website preview")).toBeInTheDocument();
  });

  it("sandboxes external URL previews to protect the board origin", () => {
    const page = createSeedState().pagesById["page-demo-example"];

    render(<PagePreview page={page} />);

    const frame = screen.getByTitle("Reference website preview");
    expect(frame).toHaveAttribute("sandbox", "allow-scripts");
  });

  it("shows an actionable fallback when a URL frame never finishes", () => {
    vi.useFakeTimers();
    const page = createSeedState().pagesById["page-demo-example"];

    render(<PagePreview page={page} />);
    expect(screen.getByLabelText("Loading preview")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(8_000);
    });

    expect(screen.queryByLabelText("Loading preview")).not.toBeInTheDocument();
    expect(screen.getByText("This site blocked the preview")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open Reference website source" })).toBeInTheDocument();
  });

  it("renders generated HTML as same-document DOM for browser annotation", () => {
    const page = createSeedState().pagesById["page-demo-welcome"];

    render(<PagePreview page={page} />);

    expect(screen.queryByTitle("Welcome concept preview")).not.toBeInTheDocument();
    const surface = document.querySelector('[data-codex-annotation-surface="inline-html"]');
    expect(surface).toBeInTheDocument();
    const surfaceElement = surface as HTMLElement;
    expect(surfaceElement).toHaveClass("page-preview__inline");
    expect(surfaceElement).toHaveClass("page-preview__inline--annotatable");
    expect(surfaceElement).not.toHaveAttribute("role");
    expect(surfaceElement).toHaveAttribute("data-codex-annotation-page-id", page.id);
    const preview = surfaceElement.closest(".page-preview");
    expect(preview).not.toBeNull();
    expect(preview).toHaveClass("page-preview--html");
    expect(preview).not.toHaveAttribute("role");
    expect(surfaceElement.querySelector("h1")).toHaveTextContent("Make space for better ideas.");
    expect(surfaceElement.querySelector("button")).toHaveTextContent("Get started");
    expect(surfaceElement.querySelector("script")).not.toBeInTheDocument();
    expect(surfaceElement.querySelector("[onclick]")).not.toBeInTheDocument();
  });

  it("keeps generated controls exposed without a named preview container", () => {
    const page = createSeedState().pagesById["page-demo-welcome"];

    render(<PagePreview page={page} />);

    const preview = document.querySelector<HTMLElement>(".page-preview");
    expect(preview).not.toBeNull();
    expect(preview).not.toHaveAttribute("role");
    expect(preview).not.toHaveAttribute("aria-label");
    expect(preview?.querySelector("h1")).toHaveTextContent("Make space for better ideas.");
    expect(preview?.querySelector("button")).toHaveTextContent("Get started");
  });

  it("exposes generated controls through the browser's native annotation attributes", () => {
    const page = createSeedState().pagesById["page-demo-welcome"];

    render(<PagePreview page={page} />);

    const surface = document.querySelector<HTMLElement>("[data-codex-annotation-surface='inline-html']");
    expect(surface).toHaveAttribute("data-openai-annotation-container", "true");
    expect(surface?.querySelector("h1")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(surface?.querySelector("button")?.getAttribute("data-openai-annotatable")).toBe("true");
    expect(document.querySelector("[data-codex-annotation-hit-layer]")).not.toBeInTheDocument();
    expect(document.querySelector("[data-codex-annotation-hit]")).not.toBeInTheDocument();
    expect(surface?.querySelector("small")).toHaveAttribute("data-openai-annotatable", "true");
    expect(surface?.querySelector("small")).toHaveAttribute("role", "generic");
  });

  it("does not expose broad layout wrappers when concrete descendants exist", () => {
    const seedPage = createSeedState().pagesById["page-demo-welcome"];
    const page = {
      ...seedPage,
      source: {
        type: "html" as const,
        value: "<main><div class=\"shell\"><h1>Heading</h1><p>Copy</p><button><span>Continue</span></button></div></main>",
      },
    };

    render(<PagePreview page={page} />);

    const surface = document.querySelector("[data-codex-annotation-surface='inline-html']")!;
    const tags = Array.from(surface.querySelectorAll("[data-openai-annotatable]"))
      .map((element) => element.tagName.toLowerCase());
    expect(tags).toEqual(expect.arrayContaining(["h1", "p", "button"]));
    expect(tags).not.toContain("main");
    expect(tags).not.toContain("div");
    expect(tags).not.toContain("span");
  });

  it("keeps input and replaced controls annotatable without board hit proxies", () => {
    const seedPage = createSeedState().pagesById["page-demo-welcome"];
    const page = {
      ...seedPage,
      source: {
        type: "html" as const,
        value: "<main><label>Card number<input placeholder='1234 5678' /></label><img alt='Preview' src='data:image/png;base64,AAAA' /><select aria-label='Plan'><option>Basic</option></select></main>",
      },
    };

    render(<PagePreview page={page} />);

    const surface = document.querySelector<HTMLElement>("[data-codex-annotation-surface='inline-html']");
    expect(surface).not.toBeNull();
    expect(surface?.querySelectorAll("[data-codex-annotation-hit]").length).toBe(0);
    for (const selector of ["input", "img:not([data-codex-annotation-hit])", "select"]) {
      const target = surface?.querySelector<HTMLElement>(selector);
      expect(target).toHaveAttribute("data-openai-annotatable", "true");
      expect(target).toHaveAttribute("data-codex-annotation-target-id");
      expect(target?.querySelector("span[data-codex-annotation-hit]")).not.toBeInTheDocument();
    }
  });

  it("does not expose a standalone annotation action for generated HTML", () => {
    const page = {
      ...createSeedState().pagesById["page-demo-welcome"],
      source: { type: "html" as const, value: "<main>\ud800</main>" },
    };

    render(<PagePreview page={page} />);

    expect(screen.queryByRole("button", { name: /annotation/i })).not.toBeInTheDocument();
  });
});
