import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "../domain/model";
import { createProjectStoreSession, fetchProjectState, pushProjectState } from "./projectState";

afterEach(() => {
  vi.useRealTimers();
});

describe("Codex project state bridge", () => {
  it("validates state snapshots and sends state updates", async () => {
    const state = createInitialState();
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, state, revision: "r1" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, revision: "r2" }), { status: 200 }));

    await expect(fetchProjectState(fetcher)).resolves.toEqual({ state, revision: "r1" });
    await expect(pushProjectState(state, fetcher)).resolves.toBe("r2");
    expect(fetcher.mock.calls[1][1]).toMatchObject({ method: "PUT" });
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ state });
  });

  it("falls back cleanly when a host has no project state endpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("missing", { status: 404 }));
    await expect(fetchProjectState(fetcher)).resolves.toBeNull();
    const session = await createProjectStoreSession({ fetcher, persist: false });
    expect(session.projectBacked).toBe(false);
    expect(session.store.getState().boards[0].id).toBe("board-default");
  });

  it("pushes UI changes and pulls later Codex client writes", async () => {
    vi.useFakeTimers();
    let serverState = createInitialState();
    let revision = "r1";
    let revisionNumber = 1;
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      if (init?.method === "PUT") {
        serverState = (JSON.parse(String(init.body)) as { state: typeof serverState }).state;
        revisionNumber += 1;
        revision = `r${revisionNumber}`;
        return new Response(JSON.stringify({ ok: true, revision }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true, state: serverState, revision }), { status: 200 });
    });

    const session = await createProjectStoreSession({ fetcher, persist: false, pollIntervalMs: 200 });
    session.store.dispatch({
      type: "RENAME_BOARD",
      payload: { boardId: "board-default", name: "Changed in UI" },
    });
    await vi.advanceTimersByTimeAsync(130);
    expect(serverState.boards[0].name).toBe("Changed in UI");

    serverState = {
      ...serverState,
      boards: [{ ...serverState.boards[0], name: "Changed by Codex client" }],
    };
    revision = "external-r3";
    await vi.advanceTimersByTimeAsync(220);
    expect(session.store.getState().boards[0].name).toBe("Changed by Codex client");
    session.dispose();
  });
});
