import { describe, expect, it } from "vitest";
import { createClipboardPairingStore, isTrustedClipboardWrite, PAIRING_TTL_MS } from "./clipboard-access";

describe("local clipboard bridge access", () => {
  it("accepts only the matching loopback origin for writes", () => {
    expect(isTrustedClipboardWrite("http://127.0.0.1:5183", "127.0.0.1:5183")).toBe(true);
    expect(isTrustedClipboardWrite("http://localhost:5183", "localhost:5183")).toBe(true);
    expect(isTrustedClipboardWrite(undefined, "localhost:5183")).toBe(false);
    expect(isTrustedClipboardWrite("http://evil.test", "localhost:5183")).toBe(false);
    expect(isTrustedClipboardWrite("http://localhost:5184", "localhost:5183")).toBe(false);
    expect(isTrustedClipboardWrite("http://localhost:5183", "evil.test:5183")).toBe(false);
  });

  it("issues unpredictable, one-use codes that expire and replace previous exports", () => {
    let clock = 100;
    const store = createClipboardPairingStore(() => clock);
    const first = store.issue("first");
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(store.consume("wrong")).toBeNull();
    const second = store.issue("second");
    expect(store.consume(first)).toBeNull();
    expect(store.consume(second)).toBe("second");
    expect(store.consume(second)).toBeNull();
    const third = store.issue("third");
    clock += PAIRING_TTL_MS;
    expect(store.consume(third)).toBeNull();
  });
});
