import { waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { installAnnotationModeMarker } from "./annotationMode";

const HOST_ID = "codex-browser-sidebar-comments-root";

afterEach(() => {
  document.getElementById(HOST_ID)?.remove();
  document.documentElement.removeAttribute("data-codex-annotation-mode");
});

describe("annotation mode marker", () => {
  it("tracks the browser comments host only while its picker is active", async () => {
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.pointerEvents = "none";
    document.documentElement.append(host);

    const dispose = installAnnotationModeMarker(document);
    expect(document.documentElement).not.toHaveAttribute("data-codex-annotation-mode");

    host.style.pointerEvents = "auto";
    await waitFor(() => expect(document.documentElement).toHaveAttribute("data-codex-annotation-mode", "true"));

    // The picker briefly changes the host to `none` while synchronously
    // sampling a point. The marker stays active until the observer processes
    // that mutation, so CSS chrome isolation remains in force for the sample.
    host.style.pointerEvents = "none";
    expect(document.documentElement).toHaveAttribute("data-codex-annotation-mode", "true");
    await waitFor(() => expect(document.documentElement).not.toHaveAttribute("data-codex-annotation-mode"));

    dispose();
  });

  it("restores a pre-existing marker when disposed", () => {
    document.documentElement.setAttribute("data-codex-annotation-mode", "external");
    const dispose = installAnnotationModeMarker(document);
    document.documentElement.removeAttribute("data-codex-annotation-mode");
    dispose();
    expect(document.documentElement).toHaveAttribute("data-codex-annotation-mode", "external");
  });
});

